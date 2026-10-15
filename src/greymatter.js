// Grey Matter controller - a 13 cm tall alien in a normal-size world. NOTHING about the world is scaled: his collision capsule (r 3.5 cm, 13 cm tall / 8.5 cm crouched), ground probe, step height,
// jump, reach, climb / mantle limits, hit sphere, camera and interaction range are all his own size, and he uses the SAME world collision (boxes / ramps / cylinders) as everyone else.
//  - gaps: a 20 cm gap is passable standing, a 5 cm gap is not (capsule is 7 cm wide); Ctrl crouch / crawl (8.5 cm) passes under cars (28 cm), benches, 10 cm vents.
//  - up: step 3 cm; ledges up to 20 cm are mantled (reach, pull, over, stand); airborne he can grab ledges up to ~45 cm; only boxes flagged `grip` (crates, machinery, pipes, shelves) can be climbed (<= 1.3 m).
//  - procedural animation on the real skeleton (animations/greymatterrig.js): idle (breathing, head / eyes, weight shift, gestures), walk, run, sprint, jump (prepare / air / land), crouch, crawl, climb, mantle,
//    technology (inspect / computer / repair / gadget), punch, hit reaction.
import * as THREE from 'three';
import { GmPoser, GM_SCALE as S, SIDES } from '../animations/greymatterrig.js';
import { V, D, mkPose } from '../animations/stinkflyrig.js';
import { clamp, damp, lerp, angleDelta, rand, smoothstep } from './util.js';

export const GMCFG = { r: 0.035, h: 0.13, hc: 0.085, step: 0.03, walk: 0.42, sprint: 1.3, crawl: 0.28, accelG: 7, accelS: 3.2, brake: 14, accelA: 2.5, grav: 12, jump: 2.6, hp: 90, prepT: 0.1, mantleGround: 0.2, mantleAir: 0.22, climbMax: 1.3, climbSpeed: 0.16, reach: 0.14, punchReach: 0.075 };
const PIV = 3.5 * S, TAU = Math.PI * 2, UP = new THREE.Vector3(0, 1, 0);
const sin = Math.sin, cos = Math.cos, ease = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const $ = id => document.getElementById(id);
const U = (x, y, z) => V(x * S, y * S, z * S);
const GOFF = { L: 0, R: 0.5 };

export class GmPlayer {
  constructor(game, rig) {
    this.g = game; this.rig = rig; this.kind = 'greymatter'; this.cfg = GMCFG; this.rad = GMCFG.r; this.colH = GMCFG.h;
    this.root = new THREE.Group(); this.root.name = 'GreyMatter';
    this.yawG = new THREE.Group(); this.root.add(this.yawG);
    this.tiltG = new THREE.Group(); this.tiltG.position.set(0, PIV, 0); this.yawG.add(this.tiltG);
    rig.modelGroup.scale.setScalar(S); rig.modelGroup.position.set(0, -PIV, 0); this.tiltG.add(rig.modelGroup); game.scene.add(this.root);
    this.blob = new THREE.Mesh(new THREE.CircleGeometry(0.05, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.38, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })); this.blob.rotation.x = -Math.PI / 2; this.blob.renderOrder = 2; this.root.add(this.blob);
    this.poser = new GmPoser(rig);
    this.pos = this.root.position; this.vel = new THREE.Vector3(); this.yaw = Math.PI; this.grounded = true; this.mode = 'ground'; this.speed = 0; this.camYaw = 0; this.state = 'IDLE';
    this.crouched = false; this.hp = GMCFG.hp; this.hpT = 0; this.hitSphere = { y: 0.065, r: 0.045 }; this.input = null; this.stealthSize = 0.5; this.sightY = 0.07; this.batonReach = 1.3;
    this.prepT = 0; this.landT = 0; this.flashT = 0; this.climb = null; this.mant = null; this.pushT = 0; this.act = null; this.cd = { lmb: 0 }; this.tech = null; this.lmbHeld = false; this.ctrlTurret = null;
    this.tight = { up: 9, side: 9 }; this.sideIdx = 0; this.lastFist = { L: new THREE.Vector3(), R: new THREE.Vector3() };
    this.stats = { hits: 0, punches: 0, steps: 0, jumps: 0, mantles: 0, climbs: 0, crawlTime: 0, flinches: 0, techUses: 0, gadgetUses: 0 };
    this.an = { t: 0, mv: 0, rn: 0, air: 0, crouch: 0, crawl: 0, land: 0, landV: 0, lean: 0, roll: 0, turn: 0, gp: 0, cl: 0, cp: 0, mt: 0, tk: 0, flinch: 0, flinchDir: new THREE.Vector3(), look: 0, dropX: 0, blink: 0, blinkT: 2.5, gest: 0, gestT: 5, gestSide: 'R', prevSpeed: 0 };
    // ---- bind-pose calibration (root at origin, yaw 0): where the feet / hips rest
    this.yawG.rotation.y = 0; this.root.updateMatrixWorld(true); this.poser.apply(mkPose());
    this.footRest = {}; this.plant = {}; this.footNow = {}; this.hipRest = {};
    for (const k of SIDES) { this.footRest[k] = this.poser.ankleW[k].clone(); this.plant[k] = new THREE.Vector3(); this.footNow[k] = new THREE.Vector3(); this.hipRest[k] = rig.legs[k].hip.getWorldPosition(new THREE.Vector3()); }
    this.restY = (this.footRest.L.y + this.footRest.R.y) / 2; this.step = null; this.armBase = { L: V(0, 0, 0), R: V(0, 0, 0) };
    this.yawG.rotation.y = this.yaw; this.root.visible = false; this.snapFeet(); this.finalize(); this.poser.apply(this.locoPose(0.016));
  }
  get flying() { return false; }
  get busy() { return !!this.tech || !!this.mant || this.mode === 'prep'; }
  aimYaw() { const y = this.camYaw ?? 0; return Math.atan2(-sin(y), -cos(y)); }

  // ------------------------------------------------------------------------------------------------ switching
  activate(from) {
    const w = this.g.world; this.cancelAll(); this.pos.copy(from.pos); this.yaw = from.yaw; this.vel.set(from.vel.x * 0.1, clamp(from.vel.y, -3, 3) * 0.3, from.vel.z * 0.1);
    this.crouched = false; this.colH = GMCFG.h; this.rad = GMCFG.r; this.climb = null; this.mant = null; this.tech = null; this.ctrlTurret = null;
    const gy = w.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.02, GMCFG.step, 0.02); this.grounded = this.pos.y <= gy + 0.05; this.mode = this.grounded ? 'ground' : 'air';
    // the big body's position is rarely a legal tiny-body position (e.g. inside a car's footprint): resolve with his own size
    w.resolveXZ(this.pos, this.rad, this.pos.y, this.colH, GMCFG.step); if (this.grounded) this.pos.y = Math.max(gy, w.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.02, GMCFG.step, 0.02));
    const A = this.an; A.land = A.landV = 0; A.crouch = A.crawl = A.cl = A.mt = A.tk = A.flinch = 0; A.air = this.grounded ? 0 : 1; this.speed = 0;
    this.yawG.rotation.y = this.yaw; this.root.visible = true; this.snapFeet(); this.finalize(); this.poser.apply(this.locoPose(0.016)); this.root.updateMatrixWorld(true); this.hint('');
  }
  /** C pressed while Grey Matter: leave any vent / gap for a NEARBY legal spot of the next alien (never a far teleport), end interactions. Returns the safe spot used (also used by main.js). */
  leave() {
    this.cancelAll(); this.g.gmt && this.g.gmt.closeAll(this); this.input = null; this.hint('');
    const best = this.safeSpot(); if (best) { this.pos.set(best.x, best.y, best.z); this.vel.set(0, 0, 0); this.grounded = true; this.mode = 'ground'; }
    this.crouched = false; this.climb = null; this.mant = null; this.tech = null;
  }
  deactivate() { this.root.visible = false; }
  hint(txt) { const e = $('gmhint'); if (!e) return; if (e._t !== txt) { e._t = txt; e.innerHTML = txt; } e.hidden = !txt; }
  /** nearest spot (spiral search from where he is, up to ~1.6 m) where a standard-size alien (radius 0.55, height 2.3) fits: no wall / ceiling / car / vent overlap, ground below. null if none (rare). */
  safeSpot() {
    const w = this.g.world, p0 = this.pos, rad = 0.55, H = 2.3, tmp = new THREE.Vector3();
    const ok = (x, z) => {
      const gy = w.groundAt(x, z, p0.y + 0.5, 0.5, 0.2); tmp.set(x, gy, z); w.resolveXZ(tmp, rad, gy, H, 0.4); if (Math.hypot(tmp.x - x, tmp.z - z) > 0.02) return null;
      for (const b of w.boxes) if (b.max.y > gy + 0.4 && b.min.y < gy + H && x > b.min.x - rad && x < b.max.x + rad && z > b.min.z - rad && z < b.max.z + rad) return null;
      if (w.lagoon && w.lagoon.inRect(x, z, rad) && w.lagoon.blockOn) return null;
      for (const [ox, oz] of [[0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]]) { const ng = w.groundAt(x + ox, z + oz, gy + 0.4, 0.4, 0.1); if (gy - ng > 0.06 || ng - gy > 0.3) return null; }   // not perched on something small (a duct, a pipe): stand on a real surface
      if (Math.hypot(x - p0.x, z - p0.z) > 0.01 && w.raySolid(_a.set(p0.x, p0.y + 0.2, p0.z), _b.set(x - p0.x, 0, z - p0.z).normalize(), Math.hypot(x - p0.x, z - p0.z) - 0.01, true)) return null;   // never through a wall
      return { x, y: gy, z };
    };
    const first = ok(p0.x, p0.z); if (first) return first;
    for (let d = 0.15; d <= 3.2; d += 0.15) for (let i = 0; i < 16; i++) { const a = i / 16 * TAU, r = ok(p0.x + cos(a) * d, p0.z + sin(a) * d); if (r) return r; }
    return null;
  }
  cancelAll() { this.act = null; this.lmbHeld = false; this.stopTurret(); if (this.g.gmt) this.g.gmt.cancel(this); }

  // ------------------------------------------------------------------------------------------------ physics
  headroom(x = this.pos.x, z = this.pos.z, y = this.pos.y) {
    let m = 9; const r = this.rad * 0.9;
    for (const b of this.g.world.boxes) { if (b.min.y <= y + 0.03 || x < b.min.x - r || x > b.max.x + r || z < b.min.z - r || z > b.max.z + r) continue; const d = b.min.y - y; if (d < m) m = d; }
    return m;
  }
  /** free space around him (for the camera): ceiling above his head and the nearest wall left / right */
  probeSpace() {
    const w = this.g.world, p = this.pos; this.tight.up = Math.min(this.headroom() - this.colH, 2);
    const fx = sin(this.camYaw + Math.PI), fz = cos(this.camYaw + Math.PI); let side = 2; const o = _a.set(p.x, p.y + 0.05, p.z);
    for (const s of [-1, 1]) { const h = w.raySolid(o, _b.set(cos(this.camYaw) * s, 0, -sin(this.camYaw) * s), 1, true); if (h) side = Math.min(side, h.t); } void fx; void fz;
    this.tight.side = side;
  }
  updatePhysics(dt, input, camYaw) {
    this.camYaw = camYaw; const G = GMCFG; const gm = this.g.gmt; const locked = this.tech || (gm && gm.puzzle) || this.mant;
    const inp = locked ? { moveX: 0, moveY: 0, run: false, jump: false, jumpHeld: false, down: input.down } : input; this.input = inp; this.landImpact = 0;
    if (this.hp < G.hp) { this.hpT = Math.max(0, this.hpT - dt); if (this.hpT <= 0) this.hp = Math.min(G.hp, this.hp + dt * 5); }
    if (this.flashT > 0 && (this.flashT -= dt) <= 0) this.restoreMats();
    this.cd.lmb = Math.max(0, this.cd.lmb - dt);
    const fwd = _a.set(-sin(camYaw), 0, -cos(camYaw)), right = _b.set(cos(camYaw), 0, -sin(camYaw));
    const want = _c.set(0, 0, 0).addScaledVector(fwd, inp.moveY).addScaledVector(right, inp.moveX); const hasInput = want.lengthSq() > 1e-4; if (hasInput) want.normalize();
    this.hasInput = hasInput; this.wantDir = this.wantDir || new THREE.Vector3(); this.wantDir.copy(want);
    if (this.mant) { this.tickMantle(dt); this.probeSpace(); return; }
    if (this.mode === 'climb') { this.tickClimb(dt, inp, want, hasInput); this.probeSpace(); return; }
    // ---- crouch: Ctrl held; stays crouched while there is no room to stand
    if (inp.down && this.mode !== 'air') this.crouched = true; else if (this.crouched && this.headroom() >= G.h + 0.004) this.crouched = false;
    if (this.crouched && this.mode === 'air') { /* keep the low body in the air only if room is lacking */ if (this.headroom() >= G.h + 0.004 && !inp.down) this.crouched = false; }
    this.colH = this.crouched ? G.hc : G.h;
    if (this.tech) { this.tickTech(dt); }
    if (inp.jump && this.mode === 'ground' && this.grounded && !this.crouched && !this.tech && this.headroom() > G.h + 0.12) { this.mode = 'prep'; this.prepT = 0; }
    if (this.mode === 'prep') {
      this.prepT += dt; this.vel.x *= Math.exp(-9 * dt); this.vel.z *= Math.exp(-9 * dt); this.integrate(dt, this.pos.y); this.faceUpdate(dt, want, hasInput);
      if (this.prepT >= G.prepT) { this.mode = 'air'; this.grounded = false; this.vel.y = G.jump; this.pos.y += 0.004; this.stats.jumps++; this.g.sfx.thud(0.05); }
      this.probeSpace(); return;
    }
    let top = this.crouched ? G.crawl : (inp.run ? G.sprint : G.walk); if (this.tech) top = 0;
    if (!this.grounded) top = Math.max(top, 0.5);
    const tx = hasInput ? want.x * top : 0, tz = hasInput ? want.z * top : 0, dx = tx - this.vel.x, dz = tz - this.vel.z, dl = Math.hypot(dx, dz);
    const rate = (this.grounded ? (hasInput ? (inp.run && !this.crouched ? G.accelS : G.accelG) : G.brake) : G.accelA) * dt, m = Math.min(dl, rate); if (dl > 1e-6) { this.vel.x += dx / dl * m; this.vel.z += dz / dl * m; }
    const prevY = this.pos.y; if (!this.grounded) this.vel.y = Math.max(-12, this.vel.y - G.grav * dt);
    this.integrate(dt, prevY);
    if (this.mode === 'landing') { this.landT += dt; if (this.landT >= 0.16) this.mode = 'ground'; }
    this.faceUpdate(dt, want, hasInput); this.tryTraverse(dt, want, hasInput);
    if (this.crouched && this.speed > 0.05) this.stats.crawlTime += dt;
    this.probeSpace();
  }
  integrate(dt, prevY) {
    const w = this.g.world, H = this.colH, hsp = Math.hypot(this.vel.x, this.vel.z) * dt, n = Math.max(1, Math.min(10, Math.ceil(hsp / 0.012))), h = dt / n, rad = this.rad, sH = this.grounded ? GMCFG.step : 0.0;
    for (let i = 0; i < n; i++) {
      this.pos.x += this.vel.x * h; this.pos.z += this.vel.z * h; const ox = this.pos.x, oz = this.pos.z;
      w.resolveXZ(this.pos, rad, this.pos.y, H, sH);
      const moved = Math.hypot(this.pos.x - ox, this.pos.z - oz);
      if (moved > 1e-6) { const nx = (this.pos.x - ox) / moved, nz = (this.pos.z - oz) / moved, vn = this.vel.x * nx + this.vel.z * nz; if (vn < 0) { this.vel.x -= nx * vn; this.vel.z -= nz * vn; } }
    }
    const y0 = this.pos.y; this.pos.y += this.vel.y * dt;
    if (this.vel.y > 0) for (const b of w.boxes) {           // ceiling
      if (b.min.y >= y0 + H - 0.004 && b.min.y < this.pos.y + H && this.pos.x > b.min.x - rad * 0.8 && this.pos.x < b.max.x + rad * 0.8 && this.pos.z > b.min.z - rad * 0.8 && this.pos.z < b.max.z + rad * 0.8) { this.pos.y = b.min.y - H; this.vel.y = 0; }
    }
    const gy = w.groundAt(this.pos.x, this.pos.z, prevY + 0.002, this.grounded ? GMCFG.step : 0.004, rad * 0.5);
    if (this.pos.y <= gy + 1e-5 && this.vel.y <= 0) {
      if (!this.grounded && this.vel.y < -1.2) { this.landImpact = -this.vel.y; this.landFX(this.landImpact); }
      this.pos.y = gy; this.vel.y = 0; this.grounded = true;
      if (this.mode === 'air') { this.mode = this.landImpact > 1.4 ? 'landing' : 'ground'; this.landT = 0; }
    } else if (this.grounded && this.pos.y > gy + 0.012) { this.grounded = false; if (this.mode === 'ground') this.mode = 'air'; }
    if (this.grounded) this.pos.y = gy;
    this.speed = Math.hypot(this.vel.x, this.vel.z);
  }
  faceUpdate(dt, want, hasInput) {
    let target = this.yaw, k = 10; const T = this.tech;
    if (T && T.face !== undefined) { target = T.face; k = 12; } else if (this.act && this.act.faceYaw !== undefined) { target = this.act.faceYaw; k = 22; }
    else if (this.speed > 0.08 && hasInput) { target = Math.atan2(this.vel.x, this.vel.z); k = this.grounded ? 12 : 5; } else if (hasInput) { target = Math.atan2(want.x, want.z); k = 9; }
    const dy = angleDelta(this.yaw, target), st = dy * (1 - Math.exp(-k * dt)); this.yaw += st; this.an.turn = damp(this.an.turn, st / Math.max(dt, 1e-4), 9, dt); this.yawG.rotation.y = this.yaw;
  }
  landFX(v) { this.an.landV += 1.5 + 2.5 * clamp(v / 4, 0, 1); this.g.sfx.thud(0.04 + 0.05 * clamp(v / 4, 0, 1)); this.dust(5); }
  dust(n) { const g = this.g; for (let i = 0; i < n; i++) { const a = rand(0, TAU), s = rand(0.05, 0.2); g.fx.dust.emit({ pos: _a.set(this.pos.x, this.pos.y + 0.004, this.pos.z), vel: _b.set(cos(a) * s, rand(0.02, 0.1), sin(a) * s), size: rand(0.012, 0.025), life: rand(0.3, 0.6), drag: 2.5, grav: 0.1, color: [0.7, 0.66, 0.57], alpha: 0.4 }); } }

  // ------------------------------------------------------------------------------------------------ climbing / mantling (real heights, real boxes)
  /** nearest box face in front of him that rises above the step height: { b, t, nx, nz, px, pz, top } */
  probe(dx, dz) {
    const o = this.pos, len = Math.hypot(dx, dz); if (len < 1e-5) return null; dx /= len; dz /= len; const reach = this.rad + 0.03, y = o.y + 0.045; let best = null;
    for (const b of this.g.world.boxes) {
      if (b.max.y <= o.y + GMCFG.step + 0.003 || b.min.y > y + 0.015 || b.max.y - o.y > GMCFG.climbMax + 0.2) continue;
      let t0 = 0, t1 = reach, nx = 0, nz = 0;
      for (const ax of ['x', 'z']) {
        const d = ax === 'x' ? dx : dz, oo = ax === 'x' ? o.x : o.z, lo = b.min[ax], hi = b.max[ax];
        if (Math.abs(d) < 1e-6) { if (oo < lo || oo > hi) { t1 = -1; break; } continue; }
        let a = (lo - oo) / d, c = (hi - oo) / d, sgn = -1; if (a > c) { [a, c] = [c, a]; sgn = 1; }
        if (a > t0) { t0 = a; nx = ax === 'x' ? sgn : 0; nz = ax === 'z' ? sgn : 0; }
        t1 = Math.min(t1, c); if (t0 > t1) { t1 = -1; break; }
      }
      if (t1 < 0 || (nx === 0 && nz === 0)) continue;
      if (!best || t0 < best.t) best = { b, t: t0, nx, nz, px: o.x + dx * t0, pz: o.z + dz * t0, top: b.max.y };
    }
    return best;
  }
  /** a legal standing spot on top of the face (inside the top surface, with headroom) or null */
  topSpot(h) {
    const w = this.g.world, inx = -h.nx, inz = -h.nz, d = this.rad + 0.012, x = h.px + inx * d, z = h.pz + inz * d, top = h.top;
    if (w.groundAt(x, z, top + 0.002, 0, this.rad * 0.6) < top - 0.003) return null;
    _a.set(x, top, z); w.resolveXZ(_a, this.rad, top, GMCFG.h, GMCFG.step); if (Math.hypot(_a.x - x, _a.z - z) > 0.006) return null;
    if (this.headroom(x, z, top) < GMCFG.h + 0.004) return null;
    return new THREE.Vector3(x, top, z);
  }
  tryTraverse(dt, want, hasInput) {
    if (this.crouched || !hasInput || this.mode === 'prep' || this.tech) { this.pushT = 0; return; }
    const h = this.probe(want.x, want.z); if (!h) { this.pushT = 0; return; }
    const toward = -(want.x * h.nx + want.z * h.nz); if (toward < 0.6) { this.pushT = 0; return; }
    const rise = h.top - this.pos.y; this.pushT += dt;
    if (this.grounded) {
      if (rise <= GMCFG.mantleGround && this.pushT > 0.1) { const s = this.topSpot(h); if (s) this.startMantle(h, s); }
      else if (rise > GMCFG.mantleGround && rise <= GMCFG.climbMax && h.b.grip && this.pushT > 0.15) this.startClimb(h);
    } else if (rise <= GMCFG.mantleAir && rise > -0.02) { const s = this.topSpot(h); if (s) this.startMantle(h, s); }       // grabbed a ledge in mid-jump
  }
  startMantle(h, spot) {
    const rise = h.top - this.pos.y, dur = 0.6 + Math.max(0, rise) * 2.2; this.mant = { t: 0, dur, from: this.pos.clone(), to: spot, h, edge: new THREE.Vector3(h.px, h.top, h.pz), nx: h.nx, nz: h.nz, u: 0 };
    this.yaw = Math.atan2(-h.nx, -h.nz); this.yawG.rotation.y = this.yaw; this.vel.set(0, 0, 0); this.grounded = false; this.mode = 'mantle'; this.stats.mantles++; this.climb = null;
  }
  tickMantle(dt) {
    const m = this.mant; m.t += dt; const u = clamp(m.t / m.dur, 0, 1); m.u = u;
    const yy = ease((u - 0.2) / 0.55), xz = ease((u - 0.68) / 0.32);
    this.pos.set(lerp(m.from.x, m.to.x, xz), lerp(m.from.y, m.to.y, yy), lerp(m.from.z, m.to.z, xz)); this.vel.set(0, 0, 0); this.speed = 0;
    if (u >= 1) { this.pos.copy(m.to); this.mant = null; this.mode = 'ground'; this.grounded = true; this.an.landV += 0.8; this.snapFeet(); }
  }
  startClimb(h) {
    const c = { b: h.b, nx: h.nx, nz: h.nz, ph: 0 }; this.climb = c; this.mode = 'climb'; this.grounded = false; this.vel.set(0, 0, 0); this.stats.climbs++;
    this.pos.x = h.px + h.nx * 0.024; this.pos.z = h.pz + h.nz * 0.024; this.yaw = Math.atan2(-h.nx, -h.nz); this.yawG.rotation.y = this.yaw; this.crouched = false; this.colH = GMCFG.h; this.snapFeet();
  }
  tickClimb(dt, inp, want, hasInput) {
    const c = this.climb, b = c.b, w = this.g.world; this.speed = 0;
    if (!c || w.boxes.indexOf(b) < 0) { this.releaseClimb(0); return; }
    // W / S = up / down, A / D slide along the face (relative to the camera)
    const tx = c.nz, tz = -c.nx, r = _a.set(cos(this.camYaw), 0, -sin(this.camYaw)), side = Math.sign(r.x * tx + r.z * tz) || 1;
    const vy = inp.moveY * GMCFG.climbSpeed, vs = inp.moveX * side * 0.09; this.pos.y += vy * dt; c.vy = vy;
    const nx = this.pos.x + tx * vs * dt, nz = this.pos.z + tz * vs * dt;
    if (Math.abs(c.nx) > 0.5) this.pos.z = clamp(nz, b.min.z + 0.02, b.max.z - 0.02); else this.pos.x = clamp(nx, b.min.x + 0.02, b.max.x - 0.02);
    c.ph += (Math.abs(vy) + Math.abs(vs) * 0.7) * dt; c.moving = Math.abs(vy) + Math.abs(vs) > 0.01;
    const gy = w.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.1, 0.1, 0.02);
    if (vy < 0 && this.pos.y <= gy + 0.002) { this.pos.y = gy; this.releaseClimb(0, true); return; }
    if (this.pos.y + 0.11 >= b.max.y && vy > 0) {       // head over the edge: pull up onto the top
      const h = { b, nx: c.nx, nz: c.nz, px: this.pos.x - c.nx * 0.024, pz: this.pos.z - c.nz * 0.024, top: b.max.y }, s = this.topSpot(h);
      if (s) { this.climb = null; this.startMantle(h, s); return; } this.pos.y = b.max.y - 0.112;
    }
    if (inp.jump) this.releaseClimb(0.7);
  }
  releaseClimb(push, stand = false) { const c = this.climb; if (c && push) { this.vel.set(c.nx * push, 1.2, c.nz * push); this.grounded = false; this.mode = 'air'; } else { this.mode = stand ? 'ground' : 'air'; this.grounded = stand; this.vel.set(0, 0, 0); } this.climb = null; }

  // ------------------------------------------------------------------------------------------------ technology (state held here, devices live in gm_tech.js)
  startTech(kind, port, face, dur, hold = false, onDone = null) {
    if (this.tech || this.mant || this.mode === 'climb' || this.mode === 'air' || this.mode === 'prep') return false; this.cancelAct();
    this.tech = { kind, t: 0, dur, port: port.clone(), face, hold, onDone, prog: 0 }; this.vel.set(0, 0, 0); return true;
  }
  cancelAct() { this.act = null; }
  endTech(done = true) { const T = this.tech; if (!T) return; this.tech = null; if (done && T.onDone) T.onDone(); }
  tickTech(dt) {
    const T = this.tech; T.t += dt; T.prog = clamp(T.t / T.dur, 0, 1);
    if (!T.hold && T.t >= T.dur) this.endTech(true);
  }
  keyDown(code) {
    const gm = this.g.gmt; if (gm && gm.puzzle) { gm.puzzleKey(code, this); return; }
    if (code === 'KeyE') gm && gm.pressE(this); else if (code === 'KeyQ') gm && gm.pressQ(this);
  }
  keyUp(code) { const gm = this.g.gmt; if (code === 'KeyE' && gm) gm.releaseE(this); }
  mouseDown() { this.lmbHeld = true; if (this.g.gmt && this.g.gmt.puzzle) return; if (this.ctrlTurret) return; this.startPunch(); }
  mouseUp() { this.lmbHeld = false; }
  stopTurret() { const gm = this.g.gmt; if (this.ctrlTurret && gm) gm.releaseTurret(this); this.ctrlTurret = null; }

  // ------------------------------------------------------------------------------------------------ combat: a quick shove-punch
  startPunch() {
    if (this.cd.lmb > 0 || this.act || this.busy || this.mode === 'climb' || this.mode === 'air') return;
    const tg = this.nearFoe(); const a = this.act = { kind: 'punch', stage: 'windup', t: 0, side: this.sideIdx++ % 2 ? 'L' : 'R', hit: new Set(), faceYaw: tg ? Math.atan2(tg.p.x - this.pos.x, tg.p.z - this.pos.z) : this.aimYaw() };
    this.stats.punches++; this.g.sfx.whoosh && this.g.sfx.whoosh(); void a;
  }
  nearFoe() {
    let best = null; const c = _a.set(this.pos.x, this.pos.y + 0.06, this.pos.z);
    for (const h of this.g.world.hittables) { if (h.dead || h.held || !h.spheres || !h.root) continue; for (const s of h.spheres) { _b.copy(s.local); h.root.localToWorld(_b); const d = _b.distanceTo(c) - s.r; if (d < 0.3 && (!best || d < best.d)) best = { h, d, p: _b.clone() }; } }
    return best;
  }
  tickPunch(dt) {
    const a = this.act; a.t += dt;
    if (a.stage === 'windup' && a.t >= 0.07) { a.stage = 'strike'; a.t = 0; } else if (a.stage === 'strike') {
      this.fistContact(a); if (a.t >= 0.09) { a.stage = 'recover'; a.t = 0; }
    } else if (a.stage === 'recover' && a.t >= 0.18) { this.act = null; this.cd.lmb = 0.22; if (this.lmbHeld) this.startPunch(); }
  }
  /** only what his fist can really touch: targets whose hit sphere is within punchReach of the fist tip (a giant's body is metres above his head, a car is not a "hittable") */
  fistContact(a) {
    const g = this.g, tip = this.poser.fist(a.side, this.lastFist[a.side]);
    for (const h of g.world.hittables) {
      if (h.dead || h.held || a.hit.has(h) || !h.spheres || !h.root) continue;
      for (const s of h.spheres) {
        _b.copy(s.local); h.root.localToWorld(_b); if (_b.distanceTo(tip) < s.r + GMCFG.punchReach * 0.5) {
          a.hit.add(h); const dir = _c.copy(_b).sub(this.pos).setY(0); if (dir.lengthSq() < 1e-6) dir.set(sin(this.yaw), 0, cos(this.yaw)); dir.normalize();
          h.applyHit(tip.clone(), dir.clone(), 7); if (h.shove) h.shove(dir, 0.6); g.hud.hit(tip.clone(), 7, h); g.sfx.hit(false); this.stats.hits++; break;
        }
      }
    }
  }
  onHit(dmg, pt, dir) {
    const g = this.g; g.hud.hurt(); g.camera.addTrauma(0.22); const A = this.an; A.flinch = 1; if (dir) A.flinchDir.set(dir.x, 0, dir.z);
    for (const m of this.rig.bodyMats) m.emissive.setRGB(0.5, 0.1, 0.06); this.flashT = 0.16; this.stats.flinches++; this.act = null;
    this.hp = Math.max(0, this.hp - dmg); this.hpT = 4;
    if (this.hp <= 0) { this.hp = GMCFG.hp * 0.6; g.hud.toast('SECOND WIND'); }
  }
  knock(dir, v) { const k = Math.min(v, 8) * 0.12; this.vel.x += dir.x * k; this.vel.z += dir.z * k; if (this.grounded && this.mode === 'ground') { this.vel.y = 0.8; this.grounded = false; this.mode = 'air'; } }
  restoreMats() { for (const m of this.rig.bodyMats) if (m.emissive && m.userData.e0) m.emissive.copy(m.userData.e0); this.flashT = 0; }

  updatePowers(dt, aimPoint) {
    if (this.act) this.tickPunch(dt);
    const gm = this.g.gmt; if (gm) gm.update(dt, this, aimPoint);
  }

  // ------------------------------------------------------------------------------------------------ animation
  snapFeet() {
    const c = cos(this.yaw), s = sin(this.yaw);
    for (const k of SIDES) { const r = this.footRest[k]; this.plant[k].set(this.pos.x + r.x * c + r.z * s, 0, this.pos.z - r.x * s + r.z * c); this.footNow[k].copy(this.plant[k]); }
    this.step = null;
  }
  /** feet: planted in the world (no sliding): a foot steps only when the body has moved too far from it; walking / running: the stance foot moves back at exactly the body speed */
  footTargets(dt) {
    const A = this.an, w = this.g.world, c = cos(this.yaw), s = sin(this.yaw), grounded = this.grounded;
    const vf = this.vel.x * s + this.vel.z * c, vl = this.vel.x * c - this.vel.z * s, sp = Math.hypot(vf, vl), mv = A.mv, rn = A.rn;
    const dx = sp > 0.03 ? vl / sp : 0, dz = sp > 0.03 ? vf / sp : 1, amp = lerp(1.15, 1.9, rn) * S * lerp(1, 0.7, A.crouch), beta = lerp(0.66, 0.5, rn);
    if (grounded) A.gp = (A.gp + dt * sp * beta / (2 * amp)) % 1;
    const lift = lerp(0.55, 1.2, rn) * S;
    if (mv > 0.12) this.step = null; else if (!this.step && grounded) {
      let worst = null, wd = 1.5 * S;
      for (const k of SIDES) { const r = this.footRest[k], wx = this.pos.x + r.x * c + r.z * s, wz = this.pos.z - r.x * s + r.z * c, d = Math.hypot(this.plant[k].x - wx, this.plant[k].z - wz); if (d > wd) { wd = d; worst = k; } }
      if (worst) { this.step = { k: worst, t: 0, from: this.plant[worst].clone() }; this.stats.steps++; }
    }
    if (this.step) {
      const St = this.step; St.t += dt / 0.16; const u = ease(St.t), r = this.footRest[St.k], tx = this.pos.x + r.x * c + r.z * s, tz = this.pos.z - r.x * s + r.z * c;
      this.footNow[St.k].set(lerp(St.from.x, tx, u), 0, lerp(St.from.z, tz, u)); St._lift = sin(Math.PI * clamp(St.t, 0, 1)); if (St.t >= 1) { this.plant[St.k].set(tx, 0, tz); this.step = null; }
    }
    const out = {};
    for (const k of SIDES) {
      const r = this.footRest[k], ph = (A.gp + GOFF[k]) % 1; let z, ly = 0;
      if (ph < beta) z = amp - 2 * amp * (ph / beta); else { const u = (ph - beta) / (1 - beta), e = ease(u); z = -amp + 2 * amp * e; ly = lift * sin(Math.PI * u); }
      const lx = r.x + dx * z, lz = r.z + dz * z, gx = this.pos.x + lx * c + lz * s, gz = this.pos.z - lx * s + lz * c;
      let tx, tz, tl = 0; const stepping = this.step && this.step.k === k;
      if (stepping) { tx = this.footNow[k].x; tz = this.footNow[k].z; tl = 1.0 * S * this.step._lift; } else { tx = this.plant[k].x; tz = this.plant[k].z; }
      if (mv > 0.12) this.plant[k].set(gx, 0, gz);
      const X = lerp(tx, gx, mv), Z = lerp(tz, gz, mv), Y = ly * mv + tl * (1 - mv); this.footNow[k].set(X, 0, Z);
      const gy = w.groundAt(X, Z, this.pos.y + 0.02, 0.02, 0.004);
      out[k] = V(X, gy + this.restY + Y, Z);
    }
    return out;
  }
  W(x, y, z) { const c = cos(this.yaw), s = sin(this.yaw); return V(this.pos.x + (x * c + z * s) * S, this.pos.y + y * S, this.pos.z + (-x * s + z * c) * S); }
  locoPose(dt) {
    const A = this.an, sp = this.speed, P = mkPose(); A.t += dt; const t = A.t;
    const grd = this.grounded && (this.mode === 'ground' || this.mode === 'landing') && !this.mant;
    A.mv = damp(A.mv, grd ? smoothstep(0.04, 0.25, sp) : 0, 12, dt); A.rn = damp(A.rn, grd && !this.crouched ? smoothstep(0.6, 1.1, sp) : 0, 8, dt);
    A.air = damp(A.air, this.mode === 'air' ? 1 : 0, 14, dt);
    A.crouch = damp(A.crouch, this.crouched ? 1 : this.mode === 'prep' ? 0.85 * clamp(this.prepT / GMCFG.prepT, 0, 1) : this.mode === 'landing' ? 0.5 : 0, 16, dt);
    A.crawl = damp(A.crawl, this.crouched ? smoothstep(0.03, 0.12, sp) : 0, 10, dt);
    A.cl = damp(A.cl, this.mode === 'climb' ? 1 : 0, 10, dt); A.mt = damp(A.mt, this.mode === 'mantle' ? 1 : 0, 12, dt); A.tk = damp(A.tk, this.tech ? 1 : 0, 9, dt);
    if (dt > 0) { A.landV += (-260 * A.land - 16 * A.landV) * dt; A.land = clamp(A.land + A.landV * dt, -0.3, 1.1); }
    A.flinch = Math.max(0, A.flinch - dt * 3.2);
    A.blinkT -= dt; if (A.blinkT <= 0) { A.blink = 1; A.blinkT = rand(2.2, 5); } A.blink = Math.max(0, A.blink - dt * 7);
    A.gestT -= dt; if (A.gestT <= 0) { A.gest = 1; A.gestT = rand(6, 11); A.gestSide = Math.random() < 0.5 ? 'L' : 'R'; } A.gest = Math.max(0, A.gest - dt * 0.55);
    const mv = A.mv, rn = A.rn, cr = A.crouch, cw = A.crawl, air = A.air, ground = 1 - air, cl = A.cl, mt = A.mt, tk = A.tk, land = clamp(A.land, 0, 1.1);
    const idle = (1 - mv) * (1 - cl) * (1 - mt) * (1 - tk) * (1 - cr * 0.7), b = sin(t * 2.2), gpA = A.gp * TAU, rock = sin(gpA);
    const tkT = this.tech ? this.tech.kind : '', lean = 0.05 + 0.13 * rn + 0.5 * cr + 0.4 * cw + 0.18 * land + 0.22 * tk - 0.06 * air + 0.16 * cl;
    A.lean = damp(A.lean, lean, 9, dt);
    // ---- head / eyes: curious look-around, follows the camera when idle
    const aimLook = clamp(angleDelta(this.yaw, this.aimYaw()), -0.8, 0.8) * idle * 0.5, curious = (0.35 * sin(t * 0.43) + 0.2 * sin(t * 1.13 + 1)) * idle;
    A.look = damp(A.look, aimLook + curious, 5, dt);
    const L = A.lean;
    P.d.hips = D(L * 0.4 + 0.025 * b * idle + 0.05 * sin(gpA * 2) * mv, 0.2 * rock * mv, -0.07 * rock * mv + 0.05 * sin(t * 0.55) * idle);
    P.d.spine = D(L * 0.35 + 0.015 * b, -0.16 * rock * mv * (1 + rn) - 0.3 * A.look, 0.05 * rock * mv - 0.025 * sin(t * 0.55) * idle);
    P.d.chest = D(L * 0.25 + 0.03 * b * idle, 0.14 * rock * mv + 0.4 * A.look, 0.03 * sin(t * 0.7 + 0.6) * idle);
    P.d.neck = D(-L * 0.25 + 0.02 * sin(t * 0.8) * idle, 0.3 * A.look, 0.05 * sin(t * 0.7) * idle);
    P.d.head = D(-L * 0.35 + 0.05 * sin(t * 0.6 + 2) * idle - 0.1 * cr * 0, 0.45 * A.look + 0.25 * curious, 0.09 * sin(t * 0.7) * idle);
    const bl = A.blink; P.d.lidLU = D(0.55 * bl, 0, 0); P.d.lidRU = D(0.55 * bl, 0, 0); P.d.lidLL = D(-0.3 * bl, 0, 0); P.d.lidRL = D(-0.3 * bl, 0, 0);
    // flinch
    if (A.flinch > 0.01) { const fl = A.flinch, hf = A.flinchDir.x * sin(this.yaw) + A.flinchDir.z * cos(this.yaw); P.d.hips[0] += 0.3 * fl * hf; P.d.chest[0] += 0.45 * fl * hf; P.d.head[0] += 0.3 * fl * hf; P.d.spine[2] += 0.25 * fl; P.d.head[2] += 0.3 * fl; }
    // ---- legs (IK to planted / stepping feet); climbing and mantling replace them
    const wl = clamp(1 - cl - mt * 0.6, 0, 1);
    if (wl > 0.01) {
      const T = this.footTargets(dt), c = cos(this.yaw), sn = sin(this.yaw);
      for (const k of SIDES) {
        const s = k === 'L' ? 1 : -1, tp = T[k].clone(); tp.y += air * (this.vel.y > 0.3 ? 0.9 : 0.35) * S * 1.4 + (air * 0.4 * S) * s * 0; tp.x += 0; tp.z += 0;
        P.legs[k] = { p: tp, pole: V(s * 0.25 * c + sn, 0.6, -s * 0.25 * sn + c), w: wl, poleW: 1 };
      }
      P.foot = { q: _q.setFromAxisAngle(UP, this.yaw).clone(), w: 1 };
    }
    if (cl > 0.01 || mt > 0.01) this.climbLegs(P, cl, mt);
    // ---- arms: offsets (model units) from the shoulder in the body frame
    for (const k of SIDES) {
      const s = k === 'L' ? 1 : -1, ph2 = k === 'L' ? 0 : Math.PI, bp = sin(t * 2.2 + (k === 'L' ? 0 : 1.2)), o = this.armBase[k];
      o.set(s * (0.5 + 0.12 * bp), -3.15 + 0.08 * bp, 0.2 + 0.1 * sin(t * 0.9 + (k === 'L' ? 0 : 2)));
      const swing = sin(gpA + ph2 + Math.PI), sw = (0.9 + 1.0 * rn) * mv * (1 - cr * 0.6); o.z += swing * sw; o.y += 0.5 * Math.max(0, swing) * mv + 0.6 * rn * mv; o.x += s * 0.2 * mv;
      o.z += 0.9 * rn; o.y += 0.5 * rn; o.x += s * -0.2 * rn;
      o.lerp(V(s * 2.4, -1.3, 0.9), air * 0.85); o.lerp(V(s * 0.6, -2.9, -0.4), clamp(land, 0, 1) * 0.5); o.lerp(V(s * 0.9, -2.5, 1.4), cr * 0.55);
      if (cw > 0.01) { const crawlPh = sin(gpA + ph2 + Math.PI); o.lerp(V(s * 0.9, -2.4 + 0.7 * Math.max(0, crawlPh), 2.5 + 1.1 * crawlPh), cw * 0.9); }
      if (A.gest > 0.01 && k === A.gestSide && idle > 0.4) { const g = Math.sin(clamp(A.gest, 0, 1) * Math.PI); o.lerp(V(s * 0.6, -0.9 + 0.3 * Math.sin(t * 9), 2.1), g * idle); }     // a curious gesture: raises a hand and rubs his fingers
      o.x += s * 0.6 * A.flinch; o.y += 0.5 * A.flinch;
      P.curl[k] = 0.3 + 0.2 * rn + 0.12 * sin(t * 0.8 + s) * idle;
    }
    return P;
  }
  /** climbing / mantling: feet on the face (absolute targets), alternate */
  climbLegs(P, cl, mt) {
    const c = this.climb, A = this.an, ph = c ? c.ph / 0.06 : 0, m = this.mant, u = m ? m.u : 0;
    for (const k of SIDES) {
      const s = k === 'L' ? 1 : -1, o = k === 'L' ? 0 : 0.5, y = 1.6 + 1.0 * sin(TAU * (ph + o)) * (c && c.moving ? 1 : 0.2) + mt * (0.6 + 0.8 * sin(TAU * (u * 3 + o)));
      let p = this.W(s * 0.8, y, 0.4); const sn = P.legs[k];
      if (m && u > 0.7) { const f = ease((u - 0.7) / 0.3); p = this.W(s * 0.8, lerp(y, 0.1, f) + (m.to.y - this.pos.y) / S * f * 0, lerp(0.4, -0.2, f)); p.y = lerp(p.y, Math.max(p.y, m.to.y + this.restY), f); }
      P.legs[k] = { p, pole: V(0, 0.6, 1), w: Math.max(cl, mt * 0.9, sn ? sn.w : 0), poleW: 1 };
    }
    P.foot = { q: _q.setFromAxisAngle(UP, this.yaw).clone(), w: 0.5 };
  }
  finalize() {
    const A = this.an; this.yawG.rotation.y = this.yaw;
    const land = clamp(A.land, 0, 1.1);
    // the figure is lowered by moving the wrapper (the legs hang off the root joint); the IK-error feedback (dropX) sinks it further whenever a planted foot is out of the leg's reach
    const drop = -(0.08 + 0.3 * A.mv + 0.3 * A.rn + 1.75 * A.crouch + 0.45 * A.crawl + 0.5 * land + 0.35 * A.tk * 0) * S - A.dropX + 0.25 * S * A.air + 0.9 * S * A.cl + 0.8 * S * A.mt;
    this.tiltG.position.y = PIV + drop; this.tiltG.rotation.set(0, 0, A.roll, 'XYZ'); this.root.updateMatrixWorld(true);
  }
  updateAnim(dt) {
    if (!this.root.visible) return;
    this.finalize();
    const P = this.locoPose(dt); this.layerAct(P, dt);
    this.finalize(); P.frameQ = this.tiltG.getWorldQuaternion(_q2).clone();
    for (const k of SIDES) { const t = P.armT && P.armT[k]; if (t) P.arms[k] = t; else { const off = this.armBase[k].clone().multiplyScalar(S); P.arms[k] = { off, pole: V(k === 'L' ? 0.8 : -0.8, -0.1, -0.7), w: 1, poleW: 1 }; } }
    this.poser.apply(P); this.root.updateMatrixWorld(true);
    let err = 0; for (const k of SIDES) { const t = P.legs[k]; if (t && t.w > 0.5 && this.an.cl < 0.5 && this.an.mt < 0.5) err = Math.max(err, this.poser.ankleW[k].distanceTo(t.p)); }
    this.an.dropX = clamp(this.an.dropX + (err > 0.04 * S ? err * 0.9 : -1.4 * S * dt), 0, 2.2 * S);
    const gy = this.g.world.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.02, 0.5, 0.01); this.blob.position.y = gy - this.pos.y + 0.0015; this.blob.scale.setScalar(1 - 0.5 * clamp((this.pos.y - gy) / 0.3, 0, 1));
    this.updateState();
  }
  /** arm layers: climb / mantle / technology / punch (absolute or relative targets) + body additions */
  layerAct(P, dt) {
    const A = this.an, t = A.t; P.armT = P.armT || {};
    if (A.cl > 0.05 && this.climb) {
      const c = this.climb, ph = c.ph / 0.06;
      for (const k of SIDES) { const s = k === 'L' ? 1 : -1, o = k === 'L' ? 0.5 : 0, y = 6.4 + 1.1 * sin(TAU * (ph + o)) * (c.moving ? 1 : 0.15); P.armT[k] = { p: this.W(s * 1.2, y, 1.8), pole: V(s * 0.8, -0.3, -0.5), w: A.cl, poleW: 1 }; }
      P.d.hips[0] += 0.1 * A.cl; P.d.chest[0] += 0.18 * A.cl;
    }
    const m = this.mant;
    if (m && A.mt > 0.05) {
      const u = m.u, rise = 1 - ease((u - 0.2) / 0.55);
      for (const k of SIDES) {
        const s = k === 'L' ? 1 : -1; let p = _a.copy(m.edge); p.x += -m.nx * 0.012 + (s * m.nz * -0.014) * 1; p.z += -m.nz * 0.012 + (s * m.nx * 0.014); p = p.clone();
        if (u > 0.68) { const f = ease((u - 0.68) / 0.32); p.x += -m.nx * 0.03 * f; p.z += -m.nz * 0.03 * f; p.y = lerp(p.y, m.to.y + 0.002, f * 0.0 + 0.0); }
        P.armT[k] = { p, pole: V(s * 0.8, -0.2, -0.3), w: A.mt, poleW: 1 };
      }
      P.d.hips[0] += 0.3 * A.mt * rise; P.d.chest[0] += 0.2 * A.mt; void rise;
    }
    const T = this.tech;
    if (T && A.tk > 0.05) {
      const port = T.port, tt = T.t, k0 = T.kind, wv = A.tk; const rr = V(cos(this.yaw), 0, -sin(this.yaw));
      for (const k of SIDES) {
        const s = k === 'L' ? 1 : -1; const p = port.clone().addScaledVector(rr, s * 0.012); let q = p.clone();
        if (k0 === 'inspect') { const ph = tt * 4 + (k === 'L' ? 1.5 : 0); if (k === 'R') { q.x += 0.006 * sin(ph); q.y += 0.006 * cos(ph); q.y += 0.01; } else { q.y -= 0.012; q.x += 0.004 * sin(ph * 0.6); } }
        else if (k0 === 'computer') { const ph = tt * 14 + (k === 'L' ? Math.PI : 0); q.y += 0.004 * Math.max(0, sin(ph)) + 0.004; q.addScaledVector(rr, 0.008 * sin(tt * 3)); }
        else if (k0 === 'repair') { const ph = tt * 9; if (k === 'R') { q.addScaledVector(rr, 0.01 * cos(ph)); q.y += 0.01 * sin(ph) + 0.01; } else q.y -= 0.006; }
        else { const ph = tt * 6 + (k === 'L' ? 1 : 0); q.y += 0.006 + 0.003 * Math.max(0, sin(ph)); q.addScaledVector(rr, s * -0.004); }
        P.armT[k] = { p: q, pole: V(s * 0.8, -0.3, -0.6), w: wv, poleW: 1 };
      }
      P.d.hips[0] += 0.12 * wv; P.d.chest[0] += 0.1 * wv; P.d.head[0] += 0.15 * wv * (k0 === 'computer' ? -1 : 1); P.d.head[1] += 0.18 * sin(tt * 1.7) * wv;
    }
    const a = this.act;
    if (a && a.kind === 'punch') {
      const s = a.side === 'L' ? 1 : -1, w = a.stage === 'windup' ? ease(a.t / 0.07) : a.stage === 'strike' ? 1 : 1 - ease(a.t / 0.18);
      const back = V(s * 1.2, -2.0, -1.1), reach = V(s * 0.6, -1.4, GMCFG.punchReach / S + 1.8), cur = a.stage === 'windup' ? this.armBase[a.side].clone().lerp(back, w) : a.stage === 'strike' ? back.clone().lerp(reach, ease(a.t / 0.09)) : reach.clone().lerp(this.armBase[a.side], 1 - w);
      const off = cur.multiplyScalar(S); P.armT[a.side] = { off, pole: V(s * 0.8, -0.1, -0.7), w: 1, poleW: 1 };
      const tw = a.stage === 'windup' ? w * 0.45 : a.stage === 'strike' ? 0.45 - 0.95 * ease(a.t / 0.09) : -0.5 * w; P.d.chest[1] += s * tw; P.d.spine[1] += s * tw * 0.5; P.d.hips[0] += 0.15;
      P.curl[a.side] = 1.0;
    }
    // idle-only look at: lids stay on the head (no extra layer)
  }
  updateState() {
    const A = this.an, a = this.act, T = this.tech, sp = this.speed;
    this.state = this.mant ? 'MANTLE' : this.mode === 'climb' ? 'CLIMB' : T ? (T.kind === 'computer' ? 'COMPUTER' : T.kind === 'repair' ? 'REPAIR' : T.kind === 'gadget' ? 'GADGET' : 'INSPECT') : this.ctrlTurret ? 'TURRET' : a ? 'ATTACK' : A.flinch > 0.3 ? 'HIT'
      : this.mode === 'prep' ? 'JUMP:PREPARE' : this.mode === 'landing' ? 'LANDING' : this.mode === 'air' ? (this.vel.y > 0.3 ? 'JUMP' : 'FALL') : this.crouched ? (sp > 0.05 ? 'CRAWL' : 'CROUCH') : sp > 1.05 ? 'SPRINT' : sp > 0.62 ? 'RUN' : sp > 0.05 ? 'WALK' : 'IDLE';
  }

  // ------------------------------------------------------------------------------------------------ HUD / debug
  hudUpdate() {
    const I = this.input || {}, gm = this.g.gmt, set = (k, on) => { const e = $('gmslot-' + k); if (e) e.classList.toggle('active', !!on); };
    set('lmb', this.act); set('e', this.tech && this.tech.kind !== 'gadget'); set('q', (this.tech && this.tech.kind === 'gadget') || this.ctrlTurret); set('ct', this.crouched); set('sh', I.run && this.speed > 0.8); set('sp', this.mode === 'air' || this.mode === 'prep'); set('c', false);
    $('gm-hp').style.width = (this.hp / GMCFG.hp * 100) + '%'; const st = $('gm-state'); if (st) st.textContent = this.state; this.hint(gm ? gm.promptHTML(this) : '');
  }
  debugText() {
    const p = this.pos; return `FPS ${this.g.fps ? this.g.fps.toFixed(0) : '-'}   GREY MATTER   state ${this.state}\nspeed ${this.speed.toFixed(2)} m/s   vy ${this.vel.y.toFixed(2)}   mode ${this.mode}   crouch ${this.crouched ? 'y' : 'n'}   colH ${this.colH.toFixed(3)}   grounded ${this.grounded ? 'y' : 'n'}   hp ${this.hp.toFixed(0)}\npos ${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${p.z.toFixed(3)}   headroom ${this.tight.up.toFixed(2)}   side ${this.tight.side.toFixed(2)}   mantles ${this.stats.mantles} climbs ${this.stats.climbs} tech ${this.stats.techUses}`;
  }
  prewarm(renderer, scene, camera) {
    const vis = this.root.visible, p = this.root.position.clone(), dir = new THREE.Vector3(); camera.getWorldDirection(dir);
    this.root.visible = true; this.root.position.copy(camera.position).addScaledVector(dir, 0.6); this.root.updateMatrixWorld(true); const near = camera.near; camera.near = 0.01; camera.updateProjectionMatrix();
    renderer.render(scene, camera); camera.near = near; camera.updateProjectionMatrix(); this.root.visible = vis; this.root.position.copy(p); this.root.updateMatrixWorld(true);
  }
}
