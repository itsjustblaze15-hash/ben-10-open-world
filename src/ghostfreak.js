// Ghostfreak controller: floating idle, glide movement, free flight (hover <-> fast flight with lean), real intangibility (collision off, bounded, safe eject on return),
// and the procedural animation on the supplied GLB's real skeleton (animations/ghostrig.js). Powers (invisibility, possession, claw, tentacles) live in gf_powers.js.
// Runs on PLAYER time. pos = bottom of the body capsule (the tail tip); root.y = pos.y.
import * as THREE from 'three';
import { GhostPoser, makeGhostFX, GF_SCALE, mkPose, V, D, layerG } from '../animations/ghostrig.js';
import { clamp, damp, lerp, angleDelta, rand, smoothstep } from './util.js';
import { ARENA } from './world.js';
import { gfPowers } from './gf_powers.js';

export const GCFG = { r: 0.5, h: 2.3, hover: 0.5, walk: 7.0, fly: 17.5, accel: 12, brake: 7.5, vspeed: 8.5, maxAlt: 46, hp: 300 };
const A_IN = ARENA - 0.6, TAU = Math.PI * 2, PIV = 1.0;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const sin = Math.sin, cos = Math.cos;

export class GfPlayer {
  constructor(game, rig) {
    this.g = game; this.rig = rig; this.kind = 'ghostfreak'; this.rad = GCFG.r; this.colH = GCFG.h;
    this.root = new THREE.Group(); this.root.name = 'Ghostfreak';
    this.tiltG = new THREE.Group(); this.tiltG.position.set(0, PIV, 0); this.tiltG.name = 'GhostfreakLean'; this.root.add(this.tiltG);
    rig.modelGroup.scale.setScalar(GF_SCALE); rig.modelGroup.position.set(0, -PIV, 0); this.tiltG.add(rig.modelGroup); game.scene.add(this.root);
    this.poser = new GhostPoser(rig); this.fx = makeGhostFX(rig);
    this.pos = this.root.position; this.vel = new THREE.Vector3(); this.yaw = Math.PI; this.grounded = false; this.mode = 'air'; this.speed = 0; this.alt = 0; this.camYaw = 0; this.state = 'IDLE';
    this.hp = GCFG.hp; this.hpT = 0; this.hitSphere = { y: 1.35, r: 0.95 }; this.input = null; this.wantDir = new THREE.Vector3(); this.hasInput = false;
    this.invis = 0; this.phaseOn = false; this.phaseK = 0; this.eject = null; this.xray = false; this.reveal01 = 0;
    this.an = { t: 0, mv: 0, fly: 0, vy: 0, lean: 0, roll: 0, turn: 0, bob: 0, look: { t: 1.5, yaw: 0, pitch: 0, ty: 0, tp: 0 }, gest: null, shrink: 1, alpha: 1, tiltInv: new THREE.Quaternion(), tail: 0 };
    this.stats = { claws: 0, clawHits: 0, tentacles: 0, tentHits: 0, grabs: 0, throws: 0, possessions: 0, phases: 0, ejects: 0, invisTime: 0, hits: 0 };
    this.initPowers(game);
    this.root.rotation.y = this.yaw; this.root.visible = false;
    this.poser.apply(this.locoPose(0.016));
  }

  // ------------------------------------------------------------------------------------------------ plumbing
  get ignoreHits() { return this.phaseK > 0.4 || this.possessing; }
  get busy() { return !!this.act || !!this.poss; }
  /** true from the moment he is inside the host until he starts coming out */
  get possessing() { const p = this.poss; return !!p && (p.stage === 'enter' || p.stage === 'active'); }
  /** switched TO Ghostfreak: keep position / facing / momentum; never start inside geometry */
  activate(from) {
    this.cancelAll(true); this.pos.copy(from.pos); this.yaw = from.yaw; this.vel.set(from.vel.x, clamp(from.vel.y, -6, 6), from.vel.z);
    const hs = Math.hypot(this.vel.x, this.vel.z); if (hs > 14) { this.vel.x *= 14 / hs; this.vel.z *= 14 / hs; }
    if (this.hitsSolid(this.pos.x, this.pos.y, this.pos.z, GCFG.r, GCFG.h)) { const s = this.findSafe(this.pos); if (s) this.pos.copy(s); }
    this.invis = 0; this.phaseOn = false; this.phaseK = 0; this.eject = null; this.fx.reset(); this.root.visible = true; this.an.gest = null; this.an.lean = this.an.roll = 0;
    this.root.rotation.y = this.yaw; this.root.updateMatrixWorld(true); this.poser.apply(this.locoPose(0.016)); this.finalize(); this.tickFX(0.016);
  }
  /** C pressed while Ghostfreak: resolve every special state first so the next alien never inherits one (called by the character manager's onLeave) */
  leave() {
    this.cancelAll(true);                                  // possession ends at once (host released), tentacles retract, grabs dropped, invisibility + phasing off
    this.settleForNext();
  }
  /** make sure the position handed to the next alien is open space for the biggest alien (r 0.9, 2.8 m tall) */
  settleForNext() {
    const p = this.pos; if (this.hitsSolid(p.x, p.y, p.z, 0.9, 2.8)) { const s = this.findSafe(p, 0.9, 2.8); if (s) p.copy(s); }
    if (this.g.world.island) this.g.world.clampXZ(p, 1); else { p.x = clamp(p.x, -A_IN, A_IN); p.z = clamp(p.z, -A_IN, A_IN); } p.y = Math.max(p.y, this.g.world.groundAt(p.x, p.z, p.y, 0.3, 0.3)); this.vel.multiplyScalar(0.6);
    this.root.updateMatrixWorld(true);
  }
  deactivate() { this.cancelAll(true); this.fx.reset(); this.root.visible = false; const e = document.getElementById('gffx'); if (e) e.style.opacity = '0'; }
  onHit(dmg, pt, dir) {
    if (this.ignoreHits) return; const g = this.g; g.hud.hurt(); g.camera.addTrauma(0.3); this.hp = Math.max(0, this.hp - dmg); this.hpT = 4; this.stats.hits++;
    if (this.hp <= 0) { this.hp = GCFG.hp * 0.6; g.hud.toast('SECOND WIND'); }
  }
  knock(dir, v) { if (this.possessing || this.phaseK > 0.4) return; this.vel.x += dir.x * v; this.vel.z += dir.z * v; }

  // ------------------------------------------------------------------------------------------------ queries
  boxHit(x, y, z, r, H, pad = 0) {
    for (const b of this.g.world.boxes) if (x + r > b.min.x + pad && x - r < b.max.x - pad && z + r > b.min.z + pad && z - r < b.max.z - pad && y + H > b.min.y + pad && y < b.max.y - pad) return b;
    return null;
  }
  hitsSolid(x, y, z, r, H) {
    if (this.boxHit(x, y, z, r, H, 0.005)) return true;
    for (const c of this.g.world.cylinders) { if (c.dead) continue; const dx = x - c.pos.x, dz = z - c.pos.z, rr = r + c.r; if (dx * dx + dz * dz < rr * rr && y < c.pos.y + c.h && y + H > c.pos.y) return true; }
    return false;
  }
  /** nearest open spot (horizontal rings + above / below every box we overlap). Never outside the arena, never under the floor. */
  findSafe(from, r = GCFG.r, H = GCFG.h, maxR = 14) {
    const w = this.g.world, B = w.island ? w.bounds : { x0: -A_IN, x1: A_IN, z0: -A_IN, z1: A_IN }, ok = (x, y, z) => x > B.x0 && x < B.x1 && z > B.z0 && z < B.z1 && y >= (w.island ? w.groundAt(x, z, y + 1, 0.3, 0.3) - 0.05 : 0) && y + H < GCFG.maxAlt + 6 && !this.hitsSolid(x, y, z, r, H);
    if (ok(from.x, from.y, from.z)) return from.clone();
    const ys = [from.y]; for (const b of w.boxes) if (x_overlap(b, from, r, H)) { if (b.max.y + 0.02 >= 0) ys.push(b.max.y + 0.02); if (b.min.y - H - 0.02 >= 0) ys.push(b.min.y - H - 0.02); }
    let best = null, bd = 1e9;
    for (const y of ys) if (ok(from.x, y, from.z)) { const d = Math.abs(y - from.y) * 0.8; if (d < bd) { bd = d; best = new THREE.Vector3(from.x, y, from.z); } }
    for (let ring = 0.35; ring <= maxR; ring += 0.35) {
      for (let k = 0; k < 24; k++) {
        const a = k / 24 * TAU, x = from.x + cos(a) * ring, z = from.z + sin(a) * ring;
        for (const y of ys) { if (!ok(x, y, z)) continue; const d = Math.hypot(ring, (y - from.y) * 0.8); if (d < bd) { bd = d; best = new THREE.Vector3(x, y, z); } }
      }
      if (best && bd <= ring) break;
    }
    return best;
  }
  surfaceY() {
    const w = this.g.world, p = this.pos, v = this.vel, r = GCFG.r + 0.1;
    return Math.max(w.groundAt(p.x, p.z, p.y, 1.1, r), w.groundAt(p.x + v.x * 0.3, p.z + v.z * 0.3, p.y, 1.1, r));
  }

  // ------------------------------------------------------------------------------------------------ physics
  updatePhysics(dt, input, camYaw) {
    const R = GCFG, a = this.act; this.camYaw = camYaw; this.input = input; this.hpT = Math.max(0, this.hpT - dt); if (this.hpT <= 0 && this.hp < GCFG.hp) this.hp = Math.min(GCFG.hp, this.hp + 10 * dt);
    this.stealthStep(dt, input);
    if (this.poss) { this.possPhysics(dt, input, camYaw); return; }
    if (this.eject) { this.ejectStep(dt); this.postMove(dt, 0); return; }
    const fwd = _a.set(-sin(camYaw), 0, -cos(camYaw)), right = _b.set(cos(camYaw), 0, -sin(camYaw));
    const want = _c.set(0, 0, 0).addScaledVector(fwd, input.moveY).addScaledVector(right, input.moveX); const hasInput = want.lengthSq() > 1e-4; if (hasInput) want.normalize();
    this.hasInput = hasInput; this.wantDir.copy(want);
    const surf = this.surfaceY(), alt = this.pos.y - surf; this.alt = alt;
    const flyK = smoothstep(2.2, 5.5, alt) * 0.75 + smoothstep(4, 10, alt) * 0.25;
    let top = lerp(R.walk, R.fly, flyK) * (a ? (a.speedMul ?? 0.7) : 1) * (this.phaseOn ? 1.06 : 1);
    if (a && a.lockMove) top = 0;
    const tx = hasInput ? want.x * top : 0, tz = hasInput ? want.z * top : 0, dx = tx - this.vel.x, dz = tz - this.vel.z, dl = Math.hypot(dx, dz);
    const sp0 = Math.hypot(this.vel.x, this.vel.z), turning = hasInput && sp0 > 1 ? (this.vel.x * want.x + this.vel.z * want.z) / sp0 : 1;
    const rate = hasInput ? R.accel * (turning < 0 ? 1.25 : 1) : R.brake, m = Math.min(dl, rate * dt);
    if (dl > 1e-6) { this.vel.x += dx / dl * m; this.vel.z += dz / dl * m; }
    if (a && a.push) { this.vel.x += sin(a.faceYaw) * a.push * dt; this.vel.z += cos(a.faceYaw) * a.push * dt; }
    // vertical: Space up, Ctrl down, otherwise hold height (and drift up to the hover height above the surface)
    const vIn = (input.jumpHeld ? 1 : 0) - (input.down ? 1 : 0); let tvy = vIn * R.vspeed * (this.phaseOn ? 1.15 : 1) * (a && a.vMul !== undefined ? a.vMul : 1);
    if (!vIn) { const minY = this.phaseOn ? (this.g.world.island && this.g.world.terrain ? this.g.world.terrain.height(this.pos.x, this.pos.z) + 0.1 : 0.1) : surf + R.hover; if (this.pos.y < minY) tvy = (minY - this.pos.y) * 5; else if (a && a.holdY !== undefined) tvy = (a.holdY - this.pos.y) * 3; }
    this.vel.y = damp(this.vel.y, tvy, vIn ? 7 : 5.5, dt);
    this.move(dt);
    this.faceUpdate(dt, camYaw, want, hasInput);
    this.postMove(dt, surf);
  }
  /** integrate + collide. Tangible: swept per axis against every box and the dummy / turret cylinders. Intangible: nothing solid exists. */
  move(dt) {
    const R = GCFG, p = this.pos, v = this.vel, w = this.g.world;
    if (this.phaseOn) { p.addScaledVector(v, dt); return; }
    const n = Math.max(1, Math.min(14, Math.ceil(Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)) * dt / 0.25))), h = dt / n, r = R.r, H = R.h, e = 1e-3;
    for (let i = 0; i < n; i++) {
      p.x += v.x * h; for (const b of w.boxes) if (p.x + r > b.min.x && p.x - r < b.max.x && p.z + r > b.min.z && p.z - r < b.max.z && p.y + H > b.min.y && p.y < b.max.y) { p.x = v.x > 0 ? b.min.x - r - e : b.max.x + r + e; v.x = 0; }
      p.z += v.z * h; for (const b of w.boxes) if (p.x + r > b.min.x && p.x - r < b.max.x && p.z + r > b.min.z && p.z - r < b.max.z && p.y + H > b.min.y && p.y < b.max.y) { p.z = v.z > 0 ? b.min.z - r - e : b.max.z + r + e; v.z = 0; }
      p.y += v.y * h; for (const b of w.boxes) if (p.x + r > b.min.x && p.x - r < b.max.x && p.z + r > b.min.z && p.z - r < b.max.z && p.y + H > b.min.y && p.y < b.max.y) { if (v.y > 0) p.y = b.min.y - H - e; else p.y = b.max.y + e; v.y = 0; }
      for (const c of w.cylinders) {
        if (c.dead || p.y >= c.pos.y + c.h || p.y + H <= c.pos.y) continue; const dx = p.x - c.pos.x, dz = p.z - c.pos.z, rr = r + c.r, d2 = dx * dx + dz * dz;
        if (d2 < rr * rr) { const d = Math.sqrt(d2) || 1e-4, k = (rr - d) / d; p.x += dx * k; p.z += dz * k; const vn = (v.x * dx + v.z * dz) / d; if (vn < 0) { v.x -= dx / d * vn; v.z -= dz / d * vn; } }
      }
    }
  }
  /** bounds, depenetration, bookkeeping */
  postMove(dt, surf) {
    const R = GCFG, p = this.pos, w = this.g.world;
    if (this.g.world.island) this.g.world.clampXZ(p, 1); else { p.x = clamp(p.x, -A_IN, A_IN); p.z = clamp(p.z, -A_IN, A_IN); }
    const T = w.island && w.terrain, base = T ? Math.max(T.height(p.x, p.z), this.g.lagoon ? this.g.lagoon.waterY : -0.12) : 0;     // V28: altitude limits follow the island's ground (and sea surface)
    if (p.y > base + R.maxAlt) { p.y = base + R.maxAlt; if (this.vel.y > 0) this.vel.y = 0; }
    if (p.y < base + 0.02) { p.y = base + 0.02; if (this.vel.y < 0) this.vel.y = 0; }
    if (!this.phaseOn && !this.eject && this.phaseK < 0.05 && this.hitsSolid(p.x, p.y, p.z, R.r, R.h)) { const s = this.findSafe(p); if (s) { p.copy(s); this.vel.multiplyScalar(0.3); } }
    this.speed = Math.hypot(this.vel.x, this.vel.z); const sf = surf !== undefined ? surf : this.surfaceY(); this.alt = p.y - sf; this.grounded = this.alt < 1.2; this.mode = this.grounded ? 'ground' : 'air';
  }
  faceUpdate(dt, camYaw, want, hasInput) {
    const a = this.act; let target = this.yaw, k = 6;
    if (a && a.faceYaw !== undefined) { target = a.faceYaw; k = a.faceK ?? 14; }
    else if (this.speed > 1.4 && hasInput) { target = Math.atan2(this.vel.x, this.vel.z); k = 4.5; }
    else if (hasInput) { target = Math.atan2(want.x, want.z); k = 5; }
    const step = angleDelta(this.yaw, target) * (1 - Math.exp(-k * dt)); this.yaw += step; this.an.turn = damp(this.an.turn, step / Math.max(dt, 1e-4), 8, dt);
  }
  aimYaw() { const y = this.camYaw ?? this.g.camera.yaw; return Math.atan2(-sin(y), -cos(y)); }

  // ------------------------------------------------------------------------------------------------ animation
  /** continuous pose: floating idle <-> slow glide <-> fast flight (+ ascend / descend), all on top of the bind pose */
  locoPose(dt) {
    const A = this.an, P = mkPose(), t = (A.t += dt), sp = this.speed, yaw = this.yaw;
    const vf = this.vel.x * sin(yaw) + this.vel.z * cos(yaw), vl = this.vel.x * cos(yaw) - this.vel.z * sin(yaw);
    A.mv = damp(A.mv, clamp(sp / 7, 0, 1.4), 5, dt); A.fly = damp(A.fly, smoothstep(9, 16, sp), 3.2, dt); A.vy = damp(A.vy, this.vel.y, 6, dt);
    const up = clamp(A.vy / 7, 0, 1), dn = clamp(-A.vy / 7, 0, 1), idle = 1 - clamp(A.mv * 1.4, 0, 1);
    const leanT = (vf >= 0 ? 0.17 * clamp(vf / 7, 0, 1) + 0.72 * A.fly * clamp(vf / 17, 0, 1) : 0.2 * clamp(vf / 7, -1, 0)) - 0.08 * up;
    A.lean = damp(A.lean, leanT, 4.2, dt);
    A.roll = damp(A.roll, clamp(-vl / 14, -0.4, 0.4) * 0.7 + clamp(-A.turn * 0.06, -0.3, 0.3) * clamp(sp / 6, 0, 1), 4.5, dt);
    _e.set(A.lean, 0, A.roll, 'XYZ'); _q.setFromEuler(_e); A.tiltInv.copy(_q).invert();
    A.bob = (sin(t * 1.6) * 0.045 + sin(t * 0.9 + 1) * 0.02) * (0.4 + 0.6 * idle) * (1 - A.fly * 0.8);
    const br = sin(t * 1.15), s1 = sin(t * 0.5), s2 = sin(t * 0.71 + 1.3), L = A.look; L.t -= dt; if (L.t <= 0) { L.t = rand(2, 4.6); L.ty = rand(-0.7, 0.7); L.tp = rand(-0.1, 0.12); } L.yaw = damp(L.yaw, L.ty, 2.2, dt); L.pitch = damp(L.pitch, L.tp, 2.6, dt);
    const lk = idle * (1 - this.phaseK * 0.3);
    P.d.hips = D(0.02 * br, 0.05 * s1 * (0.5 + 0.5 * idle), 0.035 * s2);
    P.d.spine = D(0.03 * br - 0.05 * A.fly - 0.05 * up, -0.04 * s1, -0.03 * s2);
    P.d.chest = D(0.04 * br - 0.09 * A.fly - 0.07 * up, 0.03 * s1 + 0.2 * L.yaw * lk * 0.3, 0);
    P.d.neck = D(-A.lean * 0.35 + 0.03 * br + L.pitch * 0.5 * lk, L.yaw * 0.55 * lk, 0.02 * s2);
    P.d.head = D(-A.lean * 0.25 + L.pitch * 0.5 * lk + 0.1 * A.fly, L.yaw * 0.45 * lk, 0.03 * s2);
    // tail = the whole lower body: swims in a travelling wave, streams behind when moving fast, lags in turns
    const trail = 0.5 * A.fly + 0.2 * A.mv + 0.25 * dn + 0.1 * up, turn = clamp(A.turn * 0.05, -0.35, 0.35), amp = 0.5 + 0.5 * A.mv + 0.4 * this.phaseK;
    for (let i = 0; i < 8; i++) P.d['tail' + i] = D(trail * (0.05 + 0.035 * i) + sin(t * 1.7 - i * 0.55) * (0.045 + 0.011 * i) * amp - 0.012 * up * i, -turn * (0.03 + 0.012 * i) * (1 + i * 0.1), sin(t * 1.2 - i * 0.5 + 1) * (0.055 + 0.01 * i) * amp);
    // arms (upright-space targets relative to the chest, rotated into the leaned body so they hang / trail in the world)
    const mvK = clamp(A.mv, 0, 1) * (1 - A.fly);
    for (const k of ['L', 'R']) {
      const s = k === 'L' ? 1 : -1, ph = s * 0.9;
      let p = V(0.46 * s, -0.4 + 0.04 * sin(t * 0.9 + ph), 0.14 + 0.04 * sin(t * 0.7 + ph)), pole = V(0.45 * s, -0.2, -0.9), curl = 0.3;
      const mix = (pp, pl, w, c) => { if (w > 0.001) { p.lerp(pp, w); pole.lerp(pl, w); curl = lerp(curl, c, w); } };
      mix(V(0.44 * s, -0.55, -0.28), V(0.5 * s, -0.1, -0.9), mvK * 0.7, 0.3);
      mix(V(0.4 * s, -0.5 + 0.05 * sin(t * 5 + ph), -0.95), V(0.7 * s, 0.15, -0.2), A.fly, 0.12);
      mix(V(0.8 * s, 0.35 + 0.05 * sin(t * 2 + ph), 0.15), V(0.5 * s, 0.5, -0.9), up * (1 - A.fly), 0.15);
      mix(V(0.95 * s, 0.18 + 0.05 * sin(t * 2.4 + ph), -0.05), V(0.6 * s, 0.4, -0.9), dn * (1 - A.fly), 0.1);
      const ti = A.tiltInv; P.ik[k] = { p: p.applyQuaternion(ti), pole: pole.applyQuaternion(ti), ext: 1.035 }; P.curl[k] = curl;
    }
    return P;
  }
  /** short body gestures: invisibility on / off, phase on / off, possession reach / emerge (layers over the loco pose) */
  gestLayer(dt) {
    const G = this.an.gest; if (!G) return null; G.t += dt; const u = G.t / G.dur; if (u >= 1) { this.an.gest = null; return null; }
    const w = sin(Math.PI * clamp(u, 0, 1)) ** 0.7, L = { d: {}, ik: {}, curl: {}, w }, ti = this.an.tiltInv;
    const arms = (pl, pr, poleMul = 1) => { for (const [k, p] of [['L', pl], ['R', pr]]) { const s = k === 'L' ? 1 : -1; L.ik[k] = { p: p.clone().applyQuaternion(ti), pole: V(0.9 * s, -0.2 * poleMul, 0.3).applyQuaternion(ti), ext: 1.035 }; } };
    switch (G.kind) {
      case 'invOn': arms(V(-0.2, 0.08, 0.42), V(0.2, 0.08, 0.42)); L.d.spine = D(0.16 * w, 0, 0); L.d.chest = D(0.14 * w, 0, 0); L.d.head = D(0.18 * w, 0, 0); L.curl = { L: 0.7, R: 0.7 }; break;
      case 'invOff': arms(V(1.0, 0.3, 0.3), V(-1.0, 0.3, 0.3)); L.d.chest = D(-0.14 * w, 0, 0); L.d.head = D(-0.2 * w, 0, 0); L.curl = { L: 0.0, R: 0.0 }; break;
      case 'phaseOn': arms(V(0.8, -0.1, 0.55), V(-0.8, -0.1, 0.55)); L.d.hips = D(0, 0, 0.05 * sin(G.t * 40) * w); L.d.chest = D(-0.1 * w, 0, 0.04 * sin(G.t * 33) * w); L.d.head = D(-0.22 * w, 0, 0); L.curl = { L: 0.05, R: 0.05 }; break;
      case 'phaseOff': arms(V(0.22, 0.0, 0.45), V(-0.22, 0.0, 0.45)); L.d.spine = D(0.14 * w, 0, 0); L.d.chest = D(0.12 * w, 0, 0); L.d.head = D(0.14 * w, 0, 0); L.curl = { L: 0.8, R: 0.8 }; break;
      case 'possReach': arms(V(0.3, 0.15, 1.3), V(-0.3, 0.15, 1.3)); L.d.spine = D(0.12 * w, 0, 0); L.d.chest = D(0.1 * w, 0, 0); L.curl = { L: 0.1, R: 0.1 }; L.w = Math.min(1, w * 1.6); break;
      case 'possExit': arms(V(1.05, 0.25, 0.15), V(-1.05, 0.25, 0.15)); L.d.chest = D(-0.2 * w, 0, 0); L.d.neck = D(-0.2 * w, 0, 0); L.d.head = D(-0.25 * w, 0, 0); L.curl = { L: 0.0, R: 0.0 }; break;
    }
    return L;
  }
  playGest(kind, dur = 0.55) { this.an.gest = { kind, t: 0, dur }; }
  /** tilt about the torso + hover bob; keeps the world matrices current for the poser */
  finalize() {
    const A = this.an; this.root.rotation.y = this.yaw; this.tiltG.rotation.set(A.lean + (this.tiltKick || 0), 0, A.roll, 'XYZ'); this.tiltG.position.y = PIV + A.bob; this.rig.modelGroup.scale.setScalar(GF_SCALE * A.shrink);
    this.root.updateMatrixWorld(true);
  }
  /** compile every shader variant the ghost effects use (faded / phasing / x-ray) once, up front, so the first Shift / F never stalls a frame */
  prewarm(renderer, scene, camera) {
    const vis = this.root.visible, p = this.root.position.clone(), dir = new THREE.Vector3(); camera.getWorldDirection(dir);
    this.root.visible = true; this.root.position.copy(camera.position).addScaledVector(dir, 6); this.root.updateMatrixWorld(true);
    for (const st of [[0, 0, 1, 0, false], [1, 0, 1, 0, false], [0.4, 0.8, 0.6, 1, false], [0, 1, 1, 2, true], [1, 0.5, 0.5, 3, true]]) { this.fx.set(...st); renderer.render(scene, camera); }
    this.fx.reset(); this.root.visible = vis; this.root.position.copy(p); this.root.updateMatrixWorld(true);
  }
  /** the material uniforms: invisibility fade (silhouette only), phase shimmer, possession alpha; x-ray silhouette while buried in solid geometry */
  tickFX(dt) {
    const A = this.an, S = this.g.stealth, t = A.t;
    this.reveal01 = S ? clamp(S.reveal * 3, 0, 1) : 0;
    const ghost = clamp(this.invis, 0, 1), vis = smoothstep(0, 1, ghost) * (1 - 0.8 * this.reveal01);
    const inSolid = this.phaseOn && this.phaseK > 0.5 && !!this.boxHit(this.pos.x, this.pos.y + 0.6, this.pos.z, 0.2, 1.3, -0.1);
    this.xray = inSolid; this.fx.set(vis, this.phaseK, A.alpha, t, inSolid);
    if (this.gffx === undefined) this.gffx = document.getElementById('gffx'); if (this.gffx) { const o = this.root.visible || this.poss ? (this.g.player === this ? clamp(ghost * 0.9 + this.phaseK * 0.5, 0, 1) : 0) : 0; this.gffx.style.opacity = o.toFixed(3); }
  }
  updateAnim(dt) {
    this.tickFX(dt);
    if (!this.root.visible) { this.updateState(); return; }
    const P = this.locoPose(dt); this.finalize();                       // matrices are fresh before any world-space IK target is converted
    const L = this.actLayer(dt); if (L) layerG(P, L, this.poser);
    const G = this.gestLayer(dt); if (G) layerG(P, G, this.poser);
    this.poser.apply(P); this.root.updateMatrixWorld(true); this.updateState();
  }
  updateState() {
    const a = this.act, A = this.an;
    this.state = this.poss ? 'POSSESS:' + this.poss.stage.toUpperCase() : a ? a.kind.toUpperCase() + ':' + a.stage.toUpperCase() : this.eject ? 'EJECT' : this.phaseOn ? (this.speed > 3 ? 'PHASE-GLIDE' : 'PHASED') : this.invis > 0.5 ? 'INVISIBLE' : A.vy > 1.5 ? 'ASCEND' : A.vy < -1.5 ? 'DESCEND' : A.fly > 0.5 ? 'FLIGHT' : A.mv > 0.25 ? 'GLIDE' : 'FLOAT';
  }
}
function x_overlap(b, f, r, H) { return f.x + r > b.min.x && f.x - r < b.max.x && f.z + r > b.min.z && f.z - r < b.max.z && f.y + H > b.min.y && f.y < b.max.y; }
Object.assign(GfPlayer.prototype, gfPowers);
