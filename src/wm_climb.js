// Wildmutt climbing (E). Not a free "crawl on anything": a climb needs a real vertical face that the collision world already has (crate stacks, barriers, cars, the truck, cover walls,
// the brick building, step platforms, the climb tower) and depends on
//   - the SURFACE  : rough concrete / brick / wood give a good grip; smooth metal and smooth concrete give a poor one; poles, trees, bushes and glass-smooth things give none,
//   - the HEIGHT   : rough surfaces up to ~5.8 m above his feet, smooth ones only ~3.4 m (the 9 m arena walls are simply too high),
//   - the GRIP     : a stamina-like value that drains while hanging (faster on smooth surfaces and when shimmying); at zero he slips and drops,
//   - head room    : the ledge needs free space above it for his body (nothing to climb *into*).
// Stages: grab (swing on and tilt up) -> up (W/S climb, A/D shimmy, Space push off, E let go) -> mantle (pull over the ledge, level out) | drop (push off / climb down) | slip.
// Position is kinematic during the climb (never inside the wall: he hangs 0.6 m from the face), the paws are IK-planted on the face with a diagonal gait.
import * as THREE from 'three';
import { clamp, damp, lerp, angleDelta, rand } from './util.js';
import { V, D, mkPose, sm, pawF, pawN, PIV } from './wildmutt.js';
import { LIMBS } from '../animations/quadrig.js';

const CL = { reach: 2.0, d0: 0.60, minRise: 0.5, tilt: -1.30, grabT: 0.22, dropT: 0.16, ledge: 2.05, stride: 0.55, duty: 0.6 };
const GRIP = {
  rough: { name: 'ROUGH', max: 1e4, speed: 2.6, drain: 0 },        // V29: Wildmutt climbs EVERYTHING - any height, any surface, his grip never gives out
  wood: { name: 'WOOD', max: 1e4, speed: 2.6, drain: 0 },
  smooth: { name: 'SMOOTH', max: 1e4, speed: 2.4, drain: 0 },
  none: { name: 'POLE', max: 1e4, speed: 2.2, drain: 0 },
};
const LAT = 1.1;
const _p = new THREE.Vector3();

function gripOf(b) {
  const p = b.prop;
  if (p) {
    switch (p.kind) {
      case 'crate': case 'bench': case 'fence': return GRIP.wood;
      case 'barrier': case 'rock': case 'pebble': case 'chunk': return GRIP.rough;
      case 'light': case 'tree': case 'bush': return GRIP.none;
      default: return GRIP.smooth;                                   // cars, truck, dumpsters, robots, consoles: painted / sheet metal
    }
  }
  if (b.wall) return /LAB|POCKET|SQUEEZE/.test(b.wall.name) ? GRIP.smooth : GRIP.rough;
  if (b.mesh && b.mesh.material && b.mesh.material.metalness > 0.6) return GRIP.smooth;
  if (b.door || (b.mesh && b.mesh.userData && b.mesh.userData.door)) return GRIP.smooth;
  return GRIP.rough;
}
/** ray (XZ) against the footprint of a box: entry distance + which face (axis, sign of its outward normal) */
function hitRect(b, ox, oz, dx, dz, maxT) {
  let t0 = 0, t1 = maxT, axis = null, s = 0;
  for (let i = 0; i < 2; i++) {
    const o = i ? oz : ox, d = i ? dz : dx, lo = i ? b.min.z : b.min.x, hi = i ? b.max.z : b.max.x;
    if (Math.abs(d) < 1e-6) { if (o < lo || o > hi) return null; continue; }
    let ta = (lo - o) / d, tb = (hi - o) / d, sg = -1; if (ta > tb) { const t = ta; ta = tb; tb = t; sg = 1; }
    if (ta > t0) { t0 = ta; axis = i ? 'z' : 'x'; s = sg; }
    t1 = Math.min(t1, tb); if (t0 > t1) return null;
  }
  return axis ? { t: t0, axis, s } : null;
}

export const wmClimb = {
  initClimb() { this.climb = null; this.nearClimb = false; this.climbScanT = 0; },

  // ============================================================================================== finding something to climb
  /** @returns null (nothing there) | {ok:false,msg} | {ok:true, ...climb data} */
  findClimb() {
    const w = this.g.world, pos = this.pos; let best = null; const bx = w.boxes.slice();
    if (w.island && w.staticsIn) { const seen = new Set(bx); for (const c of w.staticsIn(pos.x - 14, pos.z - 14, pos.x + 14, pos.z + 14)) if (!seen.has(c)) { seen.add(c); bx.push(c); } }      // V29: island buildings / walls live in the static grid
    for (const da of [0, 0.38, -0.38, 0.75, -0.75]) {
      const a = this.yaw + da, dx = Math.sin(a), dz = Math.cos(a);
      for (const b of bx) {
        if (b.max.y < pos.y + CL.minRise || b.min.y > pos.y + 1.5) continue;
        const h = hitRect(b, pos.x, pos.z, dx, dz, CL.reach); if (!h) continue;
        const sc = h.t + Math.abs(da) * 0.6; if (!best || sc < best.sc) best = { b, h, sc };
      }
    }
    if (!best) return null;
    const { b, h } = best, ax = h.axis, lat = ax === 'x' ? 'z' : 'x', nx = ax === 'x' ? h.s : 0, nz = ax === 'z' ? h.s : 0;
    const planeOf = bb => (h.s > 0 ? bb.max[ax] : bb.min[ax]);
    const plane = planeOf(b), chain = [b]; let top = b.max.y, lo = b.min[lat], hi = b.max[lat], topBox = b;
    for (let n = 0; n < 6; n++) {                                                         // stacked boxes sharing the face (crate stacks, wall + parapet) form one climbable face
      let nxt = null;
      for (const c of bx) {
        if (chain.includes(c) || Math.abs(planeOf(c) - plane) > 0.12 || c.min.y > top + 0.08 || c.max.y <= top + 0.02) continue;
        if (Math.min(hi, c.max[lat]) - Math.max(lo, c.min[lat]) < 0.9) continue; nxt = c; break;
      }
      if (!nxt) break; chain.push(nxt); top = nxt.max.y; topBox = nxt; lo = Math.max(lo, nxt.min[lat]); hi = Math.min(hi, nxt.max[lat]);
    }
    const rise = top - pos.y; if (rise < CL.minRise) return null;
    if (hi - lo < 0.25) return { ok: false, msg: 'TOO NARROW TO CLIMB' };
    let gp = GRIP.wood; for (const c of chain) { const g2 = gripOf(c); if (g2.max < gp.max) gp = g2; }
    if (gp.max <= 0) return { ok: false, msg: 'NO GRIP HERE' };
    if (rise > gp.max) return { ok: false, msg: gp === GRIP.smooth ? 'TOO SMOOTH TO CLIMB THAT HIGH' : 'TOO HIGH TO CLIMB' };
    const ulo = lo + 0.5, uhi = hi - 0.5, u0 = (ax === 'x' ? pos.z : pos.x), uC = ulo > uhi ? (lo + hi) / 2 : clamp(u0, ulo, uhi);
    const depthTop = (ax === 'x' ? topBox.max.x - topBox.min.x : topBox.max.z - topBox.min.z), inset = Math.min(1.0, depthTop * 0.5);
    const sx = ax === 'x' ? plane - nx * inset : uC, sz = ax === 'z' ? plane - nz * inset : uC;
    for (const c of bx) {                                                               // head room above the ledge + room to hang on the face
      if (chain.includes(c)) continue;
      if (c.min.y < top + 1.9 && c.max.y > top + 0.05 && sx > c.min.x - 0.55 && sx < c.max.x + 0.55 && sz > c.min.z - 0.55 && sz < c.max.z + 0.55) return { ok: false, msg: 'NO WAY UP' };
      const wx = ax === 'x' ? plane + nx * CL.d0 : uC, wz = ax === 'z' ? plane + nz * CL.d0 : uC;
      if (c.max.y > pos.y + 0.4 && c.min.y < pos.y + 1.7 && wx > c.min.x - 0.4 && wx < c.max.x + 0.4 && wz > c.min.z - 0.4 && wz < c.max.z + 0.4) return { ok: false, msg: 'NO ROOM TO CLIMB' };
    }
    return { ok: true, ax, lat, nx, nz, plane, lo, hi, ulo, uhi, uC, top, rise, gp, chain, inset, sx, sz, latSgn: ax === 'x' ? -nx : nz, wy: Math.atan2(-nx, -nz), name: b.prop ? b.prop.name : b.wall ? b.wall.name : 'LEDGE' };
  },
  /** cheap 5 Hz probe for the "E — climb" hint */
  scanClimb(dt) {
    this.climbScanT -= dt; if (this.climbScanT > 0) return; this.climbScanT = 0.2;
    if (this.act || this.mode === 'crouch') { this.nearClimb = false; return; }
    const r = this.findClimb(); this.nearClimb = !!(r && r.ok);
  },
  tryClimb() {
    if (this.climb || this.cd.e > 0 || this.act || this.mode === 'crouch') return;
    const r = this.findClimb(); if (!r) { this.toast('NOTHING TO CLIMB'); return; } if (!r.ok) { this.toast(r.msg); return; }
    this.startClimb(r);
  },
  startClimb(r) {
    const g = this.g, p = this.pos;
    this.climb = { ...r, stage: 'grab', t: 0, st: 0, h: p.y, u: r.uC, x0: p.x, z0: p.z, blend: 0, ph: 0, vv: 0, vl: 0, grip: 1, wasU: {}, m: 0, mDur: 0.6, fall: 0, yaw0: this.yaw, relV: null };
    this.vel.set(0, 0, 0); this.grounded = false; this.mode = 'climb'; this.stats.climbs++; this.jumpBuffer = 0; this.an.landV = 0; this.an.land = 0;
    g.sfx.whoosh && g.sfx.whoosh(); g.camera.kick(0.012); this.dustAt(_p.set(p.x + r.nx * -0.2, p.y + 0.1, p.z + r.nz * -0.2), 6);
  },
  dustAt(pt, n = 4, k = 1) {
    const g = this.g; for (let i = 0; i < n; i++) g.fx.dust.emit({ pos: pt.clone(), vel: new THREE.Vector3(rand(-1, 1), rand(0.1, 0.9), rand(-1, 1)).normalize().multiplyScalar(rand(1, 3) * k), size: rand(0.3, 0.6) * k, grow: 1.4, life: rand(0.35, 0.7), drag: 2.4, color: [0.66, 0.63, 0.58], alpha: 0.38 });
  },
  /** leave the wall. silent = alien switch / cancel (no animation) */
  endClimb(silent) {
    const C = this.climb; if (!C) return;
    if (silent) { this.climb = null; this.vel.set(0, 0, 0); this.grounded = false; this.mode = 'air'; this.tiltOverride = null; this.an.tx = 0; this.an.tz = 0; return; }
    if (C.stage === 'mantle' || C.stage === 'drop') return;
    this.beginDrop(C, 'let go');
  },
  beginDrop(C, why) {
    C.stage = 'drop'; C.st = 0; C.why = why; C.yawA = this.yaw; C.hold = { x: this.pos.x, z: this.pos.z, y: this.pos.y }; C.vv = 0; C.vl = 0;
  },
  wallPos(C, u, dist, out) { return C.ax === 'x' ? out.set(C.plane + C.nx * dist, 0, u) : out.set(u, 0, C.plane + C.nz * dist); },

  // ============================================================================================== per frame
  updateClimb(dt, input, camYaw, want, hasInput) {
    const C = this.climb, w = this.g.world, g = this.g; C.t += dt; C.st += dt; this.vel.set(0, 0, 0); this.speed = 0; this.grounded = false; this.mode = 'climb';
    const face = (dy = 18) => { this.yaw += angleDelta(this.yaw, C.wy) * (1 - Math.exp(-dy * dt)); this.root.rotation.y = this.yaw; };
    const at = (u, dist, y) => { this.wallPos(C, u, dist, _p); this.pos.set(_p.x, y, _p.z); };
    if (C.stage === 'grab') {
      const k = sm(C.st / CL.grabT); this.wallPos(C, C.u, CL.d0, _p); this.pos.set(C.x0 + (_p.x - C.x0) * k, C.h, C.z0 + (_p.z - C.z0) * k); face(14);
      if (C.st >= CL.grabT) { C.stage = 'up'; C.st = 0; at(C.u, CL.d0, C.h); this.dustAt(this.pawPos('FL', _p).clone(), 4, 0.7); g.sfx.thud(0.12); }
    } else if (C.stage === 'up') {
      face(18);
      const sp = C.gp.speed * (0.5 + 0.5 * clamp(C.grip * 2, 0, 1));
      C.vv = damp(C.vv, input.moveY * sp, 9, dt); C.vl = damp(C.vl, input.moveX * LAT * (C.gp.speed / 1.9), 9, dt);
      C.h += C.vv * dt; C.u = clamp(C.u + C.vl * dt * C.latSgn, C.ulo, Math.max(C.ulo, C.uhi)); if (C.ulo > C.uhi) C.u = (C.lo + C.hi) / 2;
      const mv = Math.max(Math.abs(C.vv) / Math.max(C.gp.speed, 0.1), Math.abs(C.vl) / LAT), still = mv < 0.12;
      C.grip = clamp(C.grip - C.gp.drain * dt * (still ? 0.55 : 1 + 0.7 * Math.abs(C.vl) / LAT) , 0, 1);
      C.ph += Math.sign(C.vv || C.vl) * dt * mv * 1.15; this.stepFX(C);
      this.wallPos(C, C.u, 0.85, _p); const gb = w.groundAt(_p.x, _p.z, C.h + 0.3, 0.3, 0.3);
      if (C.h <= gb + 0.005) { C.h = gb; if (C.vv < -0.05 || input.moveY < 0) { this.beginDrop(C, 'down'); return; } }
      at(C.u, CL.d0, C.h);
      if (C.h >= C.top - CL.ledge) { C.stage = 'mantle'; C.st = 0; C.m = 0; C.h0 = C.h; C.mDur = 0.52 + 0.12 * clamp((C.top - C.h) / 2, 0, 1); this.g.sfx.whoosh && this.g.sfx.whoosh(); return; }
      if (input.jump) { this.beginDrop(C, 'jump'); this.jumpBuffer = 0; return; }
      if (C.grip <= 0) { C.stage = 'slip'; C.st = 0; this.toast('GRIP LOST'); g.camera.addTrauma(0.12); return; }
    } else if (C.stage === 'mantle') {
      face(18); C.m = clamp(C.st / C.mDur, 0, 1);
      const mY = sm(clamp(C.m / 0.62, 0, 1)), mS = sm(clamp((C.m - 0.28) / 0.72, 0, 1));
      C.sRoot = -CL.d0 + (CL.d0 + C.inset) * mS; C.hRoot = C.h0 + (C.top - C.h0) * mY;
      at(C.u, -C.sRoot, C.hRoot);
      if (C.m >= 1) {
        this.climb = null; this.grounded = true; this.mode = 'ground'; this.vel.set(-C.nx * 1.2, 0, -C.nz * 1.2); this.pos.y = C.top; this.cd.e = WM_E_CD;
        this.an.landV += 3.5; g.camera.kick(0.012); g.camera.addTrauma(0.06); g.sfx.thud(0.3); this.dustAt(_p.set(this.pos.x + C.nx * C.inset, this.pos.y + 0.06, this.pos.z + C.nz * C.inset), 8, 1.1);
        this.an.tx = this.an.tz = 0; this.root.rotation.y = this.yaw; this.root.updateMatrixWorld(true); return;
      }
    } else if (C.stage === 'slip') {
      face(18); C.h -= (3 + 9 * C.st) * dt; C.ph -= dt * 3.2;
      this.wallPos(C, C.u, 0.85, _p); const gb = w.groundAt(_p.x, _p.z, C.h + 0.3, 0.3, 0.3); if (C.h < gb) C.h = gb;
      at(C.u, CL.d0 + 0.04 * Math.sin(C.st * 40), C.h); if (C.st > 0.4 || C.h <= gb + 0.001) this.beginDrop(C, C.h <= gb + 0.001 ? 'down' : 'slip');
    } else if (C.stage === 'drop') {
      const k = sm(C.st / CL.dropT); this.yaw = C.yawA + angleDelta(C.yawA, C.wy + Math.PI) * k; this.root.rotation.y = this.yaw;
      const dist = lerp(CL.d0, CL.d0 + 0.9, k); at(C.u, dist, C.hold.y);
      if (C.st >= CL.dropT) {
        const why = C.why; this.climb = null; this.cd.e = WM_E_CD; this.an.tx = this.an.tz = 0;
        const sp = why === 'jump' ? 7.2 : why === 'slip' ? 2.2 : 1.8;
        this.vel.set(C.nx * sp, why === 'jump' ? 9.8 : 0, C.nz * sp); this.mode = 'air'; this.grounded = false;
        if (why === 'jump') { this.jumpFX(); }
        this.wallPos(C, C.u, CL.d0 + 0.9, _p);
        if (why === 'down') { const gy = w.groundAt(_p.x, _p.z, this.pos.y + 0.4, 0.4, 0.3); this.pos.y = Math.max(this.pos.y, gy); this.vel.set(C.nx * 1.2, 0, C.nz * 1.2); }
      }
    }
    this.root.rotation.y = this.yaw; this.root.updateMatrixWorld(true);
  },
  /** claws biting into the face: a scrape of dust + a soft sound each time a paw plants */
  stepFX(C) {
    for (const k of LIMBS) {
      const off = (k === 'FL' || k === 'HR') ? 0 : 0.5, u = (((C.ph + off) % 1) + 1) % 1, was = C.wasU[k]; C.wasU[k] = u;
      if (was !== undefined && u < was - 0.5 && Math.abs(C.vv) + Math.abs(C.vl) > 0.3) { this.dustAt(this.pawPos(k, _p).clone(), 2, 0.6); if (k === 'FL' || k === 'HR') this.g.sfx.thud(0.05); }
    }
  },

  // ============================================================================================== pose
  climbLayer(C, dt) {
    const L = mkPose(), st = C.stage, d0 = CL.d0; let w = 1, tiltK = 1;
    if (st === 'grab') { const k = sm(C.st / CL.grabT); w = k; tiltK = k; }
    else if (st === 'mantle') { tiltK = 1 - sm((C.m - 0.12) / 0.7); w = 1 - sm((C.m - 0.8) / 0.2); }
    else if (st === 'drop') { const k = sm(C.st / CL.dropT); w = 1 - 0.85 * k; tiltK = 1 - sm(k * 1.3); }
    const sp = Math.max(C.gp.speed, 0.1), vy = clamp(C.vv / sp, -1, 1), vx = clamp(C.vl / LAT, -1, 1), mvN = Math.max(Math.abs(vy), Math.abs(vx));
    const idle = 1 - clamp(mvN * 3, 0, 1), t = this.an.t, ph = C.ph * Math.PI * 2;
    const mk = st === 'mantle' ? C.m : 0, lipK = sm(mk / 0.3), stK = sm((mk - 0.55) / 0.35);
    for (const k of LIMBS) {
      const front = k[0] === 'F', sd = k[1] === 'L' ? 1 : -1, off = (k === 'FL' || k === 'HR') ? 0 : 0.5, u = (((C.ph + off) % 1) + 1) % 1;
      let y, lift = 0; if (u < CL.duty) { y = 0.5 - u / CL.duty; } else { const s = (u - CL.duty) / (1 - CL.duty); y = -0.5 + sm(s); lift = Math.sin(Math.PI * s); }
      const yOff = y * CL.stride * vy, xOff = -y * CL.stride * 0.6 * vx, hang = 0.012 * Math.sin(t * 1.6 + (front ? 0 : 1.5)) * idle;
      let p, pole, f, n, curl = 0.55, ground, lw = 1;
      if (front) {
        p = V(sd * 0.52 + xOff, PIV + 1.02 + yOff + hang, d0 - 0.04 - 0.22 * lift); pole = V(sd * 0.9, -0.25, -0.35); f = pawF(70); n = pawN(70);
        if (mk > 0) { const lip = V(sd * 0.5, C.top - C.hRoot + 0.0, 0.62 - C.sRoot); p.lerp(lip, lipK); f = pawF(lerp(70, -6, lipK)); n = pawN(lerp(70, -6, lipK)); curl = lerp(0.55, 0.3, lipK); pole = V(sd * 0.9, 0.2, -0.45); }
      } else {
        p = V(sd * 0.40 + xOff, PIV - 0.88 + yOff + hang, d0 - 0.06 - 0.22 * lift); pole = V(sd * 0.95, -0.2, 0.35); f = pawF(70); n = pawN(70); curl = 0.5;
        if (mk > 0) {
          const wallP = V(p.x, C.h0 + PIV - 0.88 - C.hRoot, -0.06 - C.sRoot), stance = V(sd * 0.40, 0.22, -0.84);
          p = wallP.lerp(stance, stK); f = pawF(lerp(70, -14, stK)); n = pawN(lerp(70, -14, stK)); ground = stK > 0.6 ? 0.015 : undefined; curl = lerp(0.5, 0.26, stK); pole = V(sd * 0.35, 0.15, 1).lerp(pole, 1 - stK);
        }
      }
      L.ik[k] = { p, pole, f, n, ground, lift: 0, w: lw }; L.curl[k] = curl;
    }
    // the body: stretched along the face, spine arched a little, head up looking for the ledge, hips / shoulders counter-rotate with the paws
    const sw = Math.sin(ph) * mvN * 0.10, br = 0.012 * Math.sin(t * 1.9);
    L.d.hips = D(0, 0.8 * sw, 0); L.d.spine0 = D(-0.06 + br, -sw * 0.8, 0); L.d.spine1 = D(-0.08 + br, -sw * 0.4, 0); L.d.spine2 = D(-0.12, sw * 0.9, 0);
    L.d.neck = D(-0.50 - 0.2 * (st === 'mantle' ? 1 - mk : 0), sw * 0.5, 0); L.d.head = D(-0.22, sw * 0.4, 0); L.d.jaw = D(0.10 + 0.05 * Math.sin(t * 9) * mvN, 0, 0);
    L.off = [0, 0, 0];
    L.tilt = [CL.tilt * tiltK, 0]; L.w = w; return L;
  },
};
const WM_E_CD = 0.4;
