// Cannonbolt's abilities. Everything is PHYSICAL contact: no energy, no shockwave rings, no projectiles.
//  Normal form : LMB punch (wind-up -> strike -> recover, 3-hit alternating combo, the last is a haymaker) · E heavy overhead double-fist slam (hits what is in front of him, breaks weak walls / props)
//  Ball form   : LMB rolling impact (a burst of forward momentum; damage + knockback come from the real speed and masses) · E unroll attack · F capture / release · Q curl / unroll
//  Rolling hits use momentum exchange with the target's real size / mass (cbPhys): small targets fly off and barely slow him, big ones stop him, immovable ones bounce him.
import * as THREE from 'three';
import { V, D } from '../animations/stinkflyrig.js';
import { BALL_R, SIDES } from '../animations/cannonboltrig.js';
import { BALL } from './cb_ball.js';
import { clamp, damp, lerp, rand, easeOutCubic } from './util.js';

const $ = id => document.getElementById(id);
const sin = Math.sin, cos = Math.cos, sm = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
export const CB_CD = { lmb: 0.42, e: 1.1, q: 0.5, f: 0.45, slam: 0.9 };
const SMALL = { h: 1.3, w: 1.1 }, MEDIUM_H = 2.1, CAP_VOL = 0.85, VOL_D = 1.56;

export const cbPowers = {
  initPowers() {
    this.act = null; this.cd = { lmb: 0, e: 0, q: 0, f: 0 }; this.cdMax = CB_CD; this.queued = null; this.lmbHeld = false; this.combo = 0; this.comboT = 0; this.hintT = 0; this.hintTxt = ''; this.hintEl = $('cbhint');
    this.passengers = []; this.capacity = CAP_VOL; this.cap = null; this.rel = null; this.capK = 0; this.slam = null; this.sideIdx = 0; this.lastFist = { L: new THREE.Vector3(), R: new THREE.Vector3() };
    this.stats.captured = 0; this.stats.releases = 0; this.stats.refused = 0; this.stats.slams = 0;
  },
  canStart() { return !this.act && !this.tr && this.mode !== 'prep' && this.form === 'stand'; },
  beginAct(kind, extra) { this.act = Object.assign({ kind, stage: 'start', t: 0, st: 0, speedMul: 0.6, lockMove: false, moveVel: null, faceYaw: this.aimYaw(), faceK: 16, hit: new Set(), done: false }, extra); return this.act; },
  setStage(a, s, extra) { a.stage = s; a.st = 0; if (extra) Object.assign(a, extra); },
  endAct(key = null, cd = 0) { if (!this.act) return; if (key) this.cd[key] = cd || CB_CD[key]; this.act = null; },
  /** everything Cannonbolt started is dropped (attacks, held buttons, an unfinished capture); passengers are NOT touched here (releaseAll does that) */
  cancelAll() { this.act = null; this.queued = null; this.lmbHeld = false; this.slam = null; if (this.cap) this.abortCapture(); this.rel = null; this.capK = 0; if (this.hintEl) this.hintEl.hidden = true; },
  hintMsg(msg, t = 1.2) { this.hintTxt = msg; this.hintT = Math.max(this.hintT, t); },
  toast(m) { this.g.hud.toast(m); },

  // ============================================================================================== size / mass system (from the real hit spheres, nothing is decided by name)
  /** collisionRadius, height, mass, canBeCarriedByCannonbolt for any hittable. small (fits inside the ball) / medium (only pushed) / large (cannot be carried, resists). Cached on the object. */
  cbPhys(h) {
    if (h.cbPhys && h.cbPhys.n === h.spheres.length) return h.cbPhys;
    const r0 = h.root.position, sc = h.root.scale.y || 1; let top = 0, rmax = 0;
    for (const s of h.spheres) { _a.copy(s.local); h.root.localToWorld(_a); top = Math.max(top, _a.y - (h.root.position.y - (h.air || 0)) + s.r); rmax = Math.max(rmax, Math.hypot(_a.x - r0.x, _a.z - r0.z) + s.r); }
    void sc; const height = top, width = 2 * rmax, mass = h.mass ?? clamp(80 * Math.pow(height / 1.8, 3), 6, 900);
    const dim = Math.max(height, width), fits = height <= SMALL.h && width <= SMALL.w, movable = !!h.shove && h.kind !== 'diver';
    const size = fits && movable && h.canBeCarriedByCannonbolt !== false ? 'small' : height <= MEDIUM_H ? 'medium' : 'large';
    return (h.cbPhys = { n: h.spheres.length, collisionRadius: rmax, height, width, mass, dim, vol: Math.pow(dim / VOL_D, 3), size, canBeCarriedByCannonbolt: size === 'small', movable });
  },
  usedVol() { let u = 0; for (const p of this.passengers) u += p.vol; return u; },
  /** HUD maximum: what is inside + how many more of a typical small enemy (1 m) still fit */
  maxPassengers() { return this.passengers.length + Math.max(0, Math.floor((this.capacity - this.usedVol() + 1e-6) / Math.pow(1.0 / VOL_D, 3))); },

  // ============================================================================================== input
  keyDown(code) {
    switch (code) {
      case 'KeyQ': if (this.cd.q > 0) return; this.cd.q = CB_CD.q; return this.form === 'stand' ? this.startCurl() : this.startUnroll(false);
      case 'KeyE': if (this.form === 'ball') return this.startUnroll(true); return this.startHeavy(false);
      case 'KeyF': return this.fPress();
    }
  },
  keyUp() {},
  mouseDown() { this.lmbHeld = true; if (this.form === 'ball') this.startRollSlam(); else this.startPunch(); },
  mouseUp() { this.lmbHeld = false; },

  // ============================================================================================== helpers (same contact vocabulary as the other melee aliens)
  foes(maxD, cosMin = -1, yaw = this.aimYaw()) {
    const fx = sin(yaw), fz = cos(yaw), c = _a.set(this.pos.x, this.pos.y + 1.4, this.pos.z), res = [];
    for (const h of this.g.world.hittables) {
      if (h.dead || h.held || h.override || !h.spheres || !h.root) continue; let best = 1e9, bp = null;
      for (const s of h.spheres) { _b.copy(s.local); h.root.localToWorld(_b); const d = _b.distanceTo(c) - s.r; if (d < best) { best = d; bp = _c.copy(_b); } }
      if (best > maxD) continue; const dx = bp.x - c.x, dz = bp.z - c.z, L = Math.hypot(dx, dz), dot = L > 0.05 ? (dx * fx + dz * fz) / L : 1; if (dot < cosMin) continue;
      res.push({ h, d: best, dot, score: best - dot * 2.2, p: bp.clone() });
    } return res.sort((a, b) => a.score - b.score);
  },
  propOk(p) { return !p.dead && !p.held && !p.temp; },
  shoveProp(p, dir, k) {
    if (p.planted || p.held) return; const P = this.g.props; P.removeBox(p); p.state = 'fly'; const m = k / Math.sqrt(p.mass / 40 + 1);
    p.vel.x += dir.x * m; p.vel.z += dir.z * m; p.vel.y = Math.max(p.vel.y, Math.min(5, m * 0.25)); p.spin.set(rand(-3, 3), rand(-3, 3), rand(-3, 3)); p.hit.clear(); p.dmgMul = 0.5;
  },
  hurtFoe(h, pt, dir, dmg, kb) {
    const g = this.g; h.applyHit(pt, dir.clone(), dmg); if (h.shove && kb) h.shove(dir, kb); if (h.launch) h.launch(0.5 + kb * 0.08); g.hud.hit(pt, Math.round(dmg), h); g.sfx.hit(dmg > 45); this.stats.hits++;
  },
  lungeFor(a, stop, dur, cap) {
    const tg = a.tgt && !a.tgt.dead ? a.tgt : null; if (!tg) { a.moveVel = null; return; }
    const c = _a.set(this.pos.x, this.pos.y + 1.4, this.pos.z); let best = 1e9; const bp = _b;
    for (const s of tg.spheres) { _c.copy(s.local); tg.root.localToWorld(_c); const d = _c.distanceTo(c) - s.r; if (d < best) { best = d; bp.copy(_c); } }
    const to = _d.copy(bp).sub(c); const L = to.length(); if (L < 1e-3) { a.moveVel = null; return; }
    const travel = Math.max(0, best - stop); if (travel < 0.05) { a.moveVel = null; return; }
    const sp = Math.min(cap, travel / dur); to.multiplyScalar(1 / L); a.moveVel = new THREE.Vector3(to.x * sp, 0, to.z * sp);
  },

  // ============================================================================================== LMB (normal form): punch
  startPunch() {
    if (this.cd.lmb > 0 || !this.canStart() && !(this.act && this.act.kind === 'punch' && this.act.stage === 'recover')) return;
    if (this.act) { this.queued = 'punch'; return; }
    if (this.form !== 'stand' || this.tr || this.mode === 'prep') return;
    const n = this.comboT > 0 ? this.combo % 3 : 0; this.combo = n + 1; this.comboT = 0.85; const hay = n === 2;
    const tg = this.foes(3.3, 0.0)[0], a = this.beginAct('punch', { speedMul: 0.4, side: hay ? 'R' : (this.sideIdx++ % 2 === 0 ? 'R' : 'L'), n, hay, faceK: 22, windT: hay ? 0.3 : 0.18, strikeT: hay ? 0.16 : 0.12, recT: hay ? 0.4 : 0.26, dmg: hay ? 58 : 32 + 6 * n, kb: hay ? 14 : 8 });
    a.stage = 'windup'; a.tgt = tg ? tg.h : null; if (tg) a.faceYaw = Math.atan2(tg.p.x - this.pos.x, tg.p.z - this.pos.z); this.stats.punches++; this.g.sfx.whoosh && this.g.sfx.whoosh();
  },
  tickPunch(dt, a) {
    if (a.tgt && !a.tgt.dead) { const hp = a.tgt.root.position; a.faceYaw = Math.atan2(hp.x - this.pos.x, hp.z - this.pos.z); }
    if (a.stage === 'windup') { if (a.st >= a.windT) { this.setStage(a, 'strike'); this.lungeFor(a, 1.05, a.strikeT, 8); } }
    else if (a.stage === 'strike') { this.fistContact(a, a.side, a.dmg, a.kb); if (a.st >= a.strikeT) this.setStage(a, 'recover', { moveVel: null }); }
    else if (a.stage === 'recover') {
      if (a.st < 0.05) this.fistContact(a, a.side, a.dmg, a.kb);
      if (a.st >= a.recT) { const q = this.queued; this.queued = null; this.endAct('lmb', a.hay ? 0.5 : 0.1); if (q === 'punch' || this.lmbHeld) this.startPunch(); }
    }
  },
  /** one contact test per frame during the strike: the real fist (hand bone + the farthest skinned vertex) against every living target / weak prop that this punch has not hit yet */
  fistContact(a, side, dmg, kb) {
    const g = this.g, tip = this.poser.fist(side, this.lastFist[side]), r = 0.6; let n = 0;
    for (const h of g.world.hittables) {
      if (h.dead || h.held || a.hit.has(h) || !h.spheres || !h.root) continue;
      for (const s of h.spheres) {
        _b.copy(s.local); h.root.localToWorld(_b); if (_b.distanceTo(tip) < s.r + r) {
          a.hit.add(h); const dir = _c.copy(_b).sub(this.pos).setY(0); if (dir.lengthSq() < 1e-4) dir.set(sin(this.yaw), 0, cos(this.yaw)); dir.normalize();
          this.hurtFoe(h, tip.clone(), dir, dmg, kb); n++; g.camera.addTrauma(a.hay ? 0.28 : 0.14); this.impactSparks(tip, a.hay ? 1 : 0.7); break;
        }
      }
    }
    for (const p of g.props.props) {
      if (!this.propOk(p) || a.hit.has(p)) continue; const dx = clamp(tip.x, p.pos.x - p.half.x, p.pos.x + p.half.x) - tip.x, dz = clamp(tip.z, p.pos.z - p.half.z, p.pos.z + p.half.z) - tip.z, dy = clamp(tip.y, p.pos.y, p.pos.y + p.size.h) - tip.y;
      if (dx * dx + dz * dz + dy * dy < r * r) { a.hit.add(p); const dir = _c.set(p.pos.x - this.pos.x, 0, p.pos.z - this.pos.z).normalize().clone(); this.shoveProp(p, dir, kb * 0.7); g.props.impactFX(tip, 0.6, p.debris); g.props.hurt(p, dmg * 0.7, dir); n++; g.sfx.hit(false); this.stats.propHits++; }
    }
    return n;
  },
  impactSparks(pt, k) { const g = this.g; for (let i = 0; i < 7; i++) g.fx.glow.emit({ pos: pt, vel: _a.set(rand(-1, 1), rand(0, 1), rand(-1, 1)).normalize().multiplyScalar(rand(2, 5)), size: rand(0.1, 0.22) * k, life: 0.2, drag: 2, color: [1, 0.92, 0.7] }); },

  // ============================================================================================== E (normal form): heavy overhead slam
  startHeavy(fast = false) {
    if (!fast && (this.cd.e > 0 || !this.canStart())) return; if (this.form !== 'stand') return; if (fast) this.cancelAll();
    else if (this.act) return;
    const tg = this.foes(3.8, -0.2)[0], a = this.beginAct('heavy', { speedMul: 0.25, lockMove: true, faceK: 20, windT: fast ? 0.1 : 0.42 }); a.stage = 'windup'; a.tgt = tg ? tg.h : null; a.fast = fast; this.stats.heavies++;
    if (tg) a.faceYaw = Math.atan2(tg.p.x - this.pos.x, tg.p.z - this.pos.z); this.g.sfx.servo && this.g.sfx.servo(0.15);
  },
  tickHeavy(dt, a) {
    if (a.tgt && !a.tgt.dead) { const hp = a.tgt.root.position; a.faceYaw = Math.atan2(hp.x - this.pos.x, hp.z - this.pos.z); }
    if (a.stage === 'windup') { if (a.st >= a.windT) { this.setStage(a, 'strike'); this.g.sfx.whoosh && this.g.sfx.whoosh(); } }
    else if (a.stage === 'strike') { if (a.st >= 0.07 && !a.done) { a.done = true; this.groundImpact(a); } if (a.st >= 0.16) this.setStage(a, 'recover', { lockMove: false, speedMul: 0.3 }); }
    else if (a.stage === 'recover') { if (a.st >= 0.5) this.endAct('e', CB_CD.e); }
  },
  /** both fists land on the ground in front of him: a contact zone around the impact point (physical: debris + dust where the fists hit, no expanding ring) */
  groundImpact(a) {
    const g = this.g, yaw = a.faceYaw, d = a.tgt && !a.tgt.dead ? clamp(Math.hypot(a.tgt.root.position.x - this.pos.x, a.tgt.root.position.z - this.pos.z) - 0.5, 1.3, 2.2) : 1.8, R = 1.9;
    const I = _e.set(this.pos.x + sin(yaw) * d, this.pos.y, this.pos.z + cos(yaw) * d).clone(); I.y = g.world.groundAt(I.x, I.z, this.pos.y + 0.6, 0.6, 0.1);
    for (const h of g.world.hittables) {
      if (h.dead || h.held || !h.spheres || !h.root) continue; let best = 1e9, bp = null;
      for (const s of h.spheres) { _b.copy(s.local); h.root.localToWorld(_b); const dd = Math.hypot(_b.x - I.x, _b.z - I.z) - s.r; if (dd < best && _b.y - s.r < I.y + 2) { best = dd; bp = _b.clone(); } }
      if (best > R * 0.8) continue; const f = 1 - clamp(best / (R * 0.8), 0, 1) * 0.45; const dir = _c.set(bp.x - I.x, 0, bp.z - I.z); if (dir.lengthSq() < 1e-3) dir.set(sin(yaw), 0, cos(yaw)); dir.normalize();
      this.hurtFoe(h, bp, dir, 62 * f, 12 * f); if (h.launch) h.launch(3.5);
    }
    for (const p of g.props.props) { if (!this.propOk(p)) continue; const dx = clamp(I.x, p.pos.x - p.half.x, p.pos.x + p.half.x) - I.x, dz = clamp(I.z, p.pos.z - p.half.z, p.pos.z + p.half.z) - I.z; if (dx * dx + dz * dz < R * R * 0.6 && p.pos.y < I.y + 2.5) { const dir = _c.set(p.pos.x - I.x, 0, p.pos.z - I.z); if (dir.lengthSq() < 1e-3) dir.set(sin(yaw), 0, cos(yaw)); dir.normalize(); this.shoveProp(p, dir.clone(), 7); g.props.hurt(p, 70, dir.clone()); this.stats.propHits++; } }
    for (const w of g.props.walls) { if (!w.alive) continue; const b = w.entry, dx = clamp(I.x, b.min.x, b.max.x) - I.x, dz = clamp(I.z, b.min.z, b.max.z) - I.z; if (dx * dx + dz * dz < 1.6 * 1.6) g.props.damageWall(w, 95, new THREE.Vector3(I.x + dx, I.y + 1, I.z + dz), _c.set(sin(yaw), 0, cos(yaw)).clone()); }
    g.props.debris.burst(I.clone().setY(I.y + 0.2), 18, 6, 0.14, 0xa8a49c); for (let i = 0; i < 14; i++) { const an = rand(0, 6.28), s = rand(1, 4); g.fx.dust.emit({ pos: I, vel: _a.set(Math.cos(an) * s, rand(0.3, 1.6), Math.sin(an) * s), size: rand(0.3, 0.7), life: rand(0.5, 1), drag: 2.2, grav: 0.4, color: [0.7, 0.66, 0.57], alpha: 0.5 }); }
    g.camera.addTrauma(0.38); g.sfx.crash(0.5); this.stats.slams++;
  },

  // ============================================================================================== LMB (ball form): rolling impact
  startRollSlam() {
    if (this.form !== 'ball' || this.tr || this.cap || this.rel || this.cd.lmb > 0) return;
    const v = this.v, dir = this.hasInput ? _a.copy(this.wantDir) : _a.set(v.x, 0, v.z); if (dir.lengthSq() < 1e-4) dir.set(sin(this.yaw), 0, cos(this.yaw)); dir.normalize();
    const M = this.ballMass(), imp = 9 * (BALL.mass / M); v.x += dir.x * imp; v.z += dir.z * imp; const hs = Math.hypot(v.x, v.z), cap = 24; if (hs > cap) { v.x *= cap / hs; v.z *= cap / hs; }
    this.slam = { t: 0.55 }; this.cd.lmb = CB_CD.slam; this.stats.slams++; this.g.sfx.whoosh && this.g.sfx.whoosh(); this.g.camera.kick(0.04); this.sq.k = Math.max(this.sq.k, -0.12); this.sq.axis.copy(dir);
  },
  /** ball form: cooldowns, capture / release progress, passengers follow the ball, safety checks */
  tickBallPowers(dt) {
    for (const k in this.cd) this.cd[k] = Math.max(0, this.cd[k] - dt); this.comboT = Math.max(0, this.comboT - dt); this.hintT = Math.max(0, this.hintT - dt);
    if (this.slam) { this.slam.t -= dt; if (this.slam.t <= 0) this.slam = null; }
    if (this.cap) this.tickCapture(dt); if (this.rel) this.tickRelease(dt); this.attachPassengers();
    // serious physics conflict: the ball is embedded in solid geometry (or a huge impact) -> passengers are let out, he is put somewhere free
    if (this.passengers.length && (this.imp.t < 0.05 && this.imp.speed > 24)) this.releaseAll('IMPACT');
    if (this.lmbHeld && this.cd.lmb <= 0) this.startRollSlam();
  },

  // ============================================================================================== rolling hits on living targets: momentum exchange with the real mass
  ballCombat(dt) {
    const g = this.g, w = g.world, c = this.c, v = this.v, R = BALL_R, sp = v.length(), M = this.ballMass();
    for (const [h, t] of this.hitCd) { if (t - dt <= 0 || h.dead) this.hitCd.delete(h); else this.hitCd.set(h, t - dt); }
    for (const h of w.hittables) {
      if (h.dead || h.held || !h.spheres || !h.root || h.kind === 'diver' || h.override) continue;
      let best = null, bd = 1e9; for (const s of h.spheres) { _b.copy(s.local); h.root.localToWorld(_b); const d = _b.distanceTo(c) - s.r - R; if (d < bd) { bd = d; best = _d.copy(_b); } }
      if (bd > 0.04) continue;
      const dir = _e.copy(best).sub(c); if (dir.lengthSq() < 1e-6) dir.set(v.x, 0, v.z); dir.normalize();
      const closing = v.dot(dir), cd = this.hitCd.get(h) || 0;
      if (cd > 0) { if (closing > 0.5) v.addScaledVector(dir, -closing * 0.3); continue; }          // just hit: do not ghost through the body while it is still being flung
      if (closing < 2.0 || sp < 3.5) continue;
      this.rollHit(h, this.cbPhys(h), dir.clone(), closing, best.clone(), M);
    }
  },
  rollHit(h, ph, dir, closing, pt, M) {
    const g = this.g, immovable = !h.shove, big = ph.size === 'large', slamK = this.slam ? 1.8 : 1, mt = immovable ? 1e6 : ph.mass * (big ? 1.8 : 1), e = immovable ? 0.35 : 0.22;
    const dmg = clamp(0.5 * M * closing * closing / 700 * slamK, 4, 130), dh = _a.set(dir.x, 0, dir.z); if (dh.lengthSq() < 1e-4) dh.set(this.v.x, 0, this.v.z); dh.normalize();
    const vt = immovable ? 0 : (1 + e) * M / (M + mt) * closing * (this.slam ? 1.25 : 1);
    h.applyHit(pt, dh.clone(), dmg); if (h.shove && vt > 0) h.shove(dh, vt); if (h.launch) h.launch(clamp(closing * 0.16, 1, 6)); g.hud.hit(pt, Math.round(dmg), h); g.sfx.hit(dmg > 50);
    const after = immovable ? -e * closing : (M - e * mt) / (M + mt) * closing; this.v.addScaledVector(dir, after - closing);
    this.hitCd.set(h, 0.5); this.stats.hits++; this.bs.enemiesHit++; g.camera.addTrauma(clamp(closing / 40, 0.05, 0.22)); this.sq.k = Math.max(this.sq.k, clamp(closing / 40, 0.03, 0.14)); this.sq.axis.copy(dir);
    this.impactSparks(pt, 0.9); if (immovable) this.hintMsg('IMMOVABLE — BOUNCED OFF', 0.9); else if (big && closing > 8) this.hintMsg('TOO HEAVY — IT RESISTS', 0.9);
  },

  // ============================================================================================== F: capture / release
  /** nearest living thing within contact reach that has line of sight; reason says why a near one can not be taken */
  captureScan() {
    const w = this.g.world, c = this.c, R = BALL_R; let best = null, bd = 1e9, near = null, nd = 1e9;
    for (const h of w.hittables) {
      if (h.dead || h.held || !h.spheres || !h.root || h.kind === 'diver' || h.override) continue;
      let d0 = 1e9, bp = null; for (const s of h.spheres) { _b.copy(s.local); h.root.localToWorld(_b); const d = _b.distanceTo(c) - s.r - R; if (d < d0) { d0 = d; bp = _b.clone(); } }
      if (d0 > 0.6) continue;                                            // close physical contact only: nothing is pulled in from a distance
      const L = bp.distanceTo(c), ray = w.raySolid(c, _c.copy(bp).sub(c).normalize(), L); if (ray && ray.t < L - 0.2) continue;       // never through a wall
      const ph = this.cbPhys(h); if (d0 < nd) { nd = d0; near = { h, ph }; }
      if (ph.size === 'small' && d0 < bd) { bd = d0; best = { h, ph }; }
    }
    return { best, near };
  },
  fPress() {
    if (this.cd.f > 0 || this.cap || this.rel || this.tr) return;
    if (this.form !== 'ball') { if (this.passengers.length) { this.cd.f = CB_CD.f; return this.beginRelease(); } return this.hintMsg('ROLL INTO A BALL (Q), THEN F NEXT TO A SMALL ENEMY', 1.6); }
    const { best, near } = this.captureScan();
    if (best) {
      if (this.usedVol() + best.ph.vol <= this.capacity + 1e-6) { this.cd.f = CB_CD.f; return this.beginCapture(best.h, best.ph); }
      if (!this.passengers.length) { this.stats.refused++; return this.hintMsg('NO ROOM INSIDE', 1.2); }
    }
    if (this.passengers.length) { this.cd.f = CB_CD.f; return this.beginRelease(); }
    if (near) { this.stats.refused++; this.cd.f = 0.3; this.hintMsg(near.ph.size === 'medium' ? 'TOO BIG TO CARRY — ONLY SMALL ENEMIES FIT' : 'TOO LARGE TO CAPTURE', 1.4); this.v.multiplyScalar(0.98); this.sq.k = Math.max(this.sq.k, 0.05); this.sq.axis.copy(_a.copy(near.h.root.position).sub(this.c).normalize()); return; }
    this.hintMsg('NO TARGET IN RANGE', 1.0);
  },
  beginCapture(h, ph) {
    h.held = true; if (h.collider) h.collider.dead = true; this.hitCd.set(h, 9);
    this.cap = { h, ph, t: 0, dur: 0.4, from: h.root.position.clone(), s0: h.root.scale.x }; this.g.sfx.servo && this.g.sfx.servo(0.2); this.g.sfx.whoosh && this.g.sfx.whoosh();
  },
  tickCapture(dt) {
    const k = this.cap; if (!k.h || k.h.dead && !k.h.held) { this.cap = null; this.capK = 0; return; }
    k.t += dt; const u = clamp(k.t / k.dur, 0, 1), e = sm(u); this.capK = u;
    const tgt = _a.copy(this.c); k.h.home.set(lerp(k.from.x, tgt.x, e), lerp(k.from.y, tgt.y - 0.3, e), lerp(k.from.z, tgt.z, e)); k.h.root.scale.setScalar(lerp(k.s0, k.s0 * 0.2, e)); k.h.kv.set(0, 0, 0);
    this.v.multiplyScalar(Math.exp(-1.2 * dt));
    if (u >= 1) { this.passengers.push({ h: k.h, mass: k.ph.mass, vol: k.ph.vol, dim: k.ph.dim, s0: k.s0, rad: k.ph.collisionRadius, height: k.ph.height }); k.h.root.visible = false; this.cap = null; this.capK = 0; this.stats.captured++; this.stats.captures++; this.g.sfx.thud(0.3); this.g.hud.toast('CAPTURED  ' + this.passengers.length + ' / ' + this.maxPassengers()); this.sq.k = Math.max(this.sq.k, 0.1); this.sq.axis.set(0, 1, 0); }
  },
  abortCapture() { const k = this.cap; this.cap = null; this.capK = 0; if (!k) return; const h = k.h; h.root.scale.setScalar(k.s0); h.held = false; if (h.collider) h.collider.dead = h.dead; h.home.copy(k.from); this.hitCd.delete(h); },
  attachPassengers() { for (const p of this.passengers) { p.h.home.set(this.c.x, this.c.y - BALL_R * 0.5, this.c.z); p.h.kv.set(0, 0, 0); p.h.root.visible = false; p.h.held = true; } },
  beginRelease() {
    if (!this.passengers.length || this.rel) return; this.rel = { t: 0, dur: 0.34, done: false, tries: 0 }; this.g.sfx.servo && this.g.sfx.servo(0.2);
  },
  tickRelease(dt) {
    const r = this.rel; r.t += dt; this.capK = clamp(r.t / r.dur, 0, 1); this.v.multiplyScalar(Math.exp(-2.4 * dt));       // the ball slows and opens a little
    if (!r.done && r.t >= 0.16) {
      const p = this.passengers[this.passengers.length - 1], spot = this.releaseSpot(p, this.c, BALL_R, this.yaw);
      if (spot) { this.passengers.pop(); this.placePassenger(p, spot, true); r.done = true; this.stats.releases++; this.g.hud.toast('RELEASED  ' + this.passengers.length + ' / ' + this.maxPassengers()); }
      else if ((r.tries += 1) > 20) { this.rel = null; this.capK = 0; this.hintMsg('NO ROOM TO RELEASE', 1.2); return; } else { r.t = 0.15; this.hintMsg('NO ROOM TO RELEASE', 0.4); }
    }
    if (r.t >= r.dur) { this.rel = null; this.capK = 0; }
  },
  /** a valid place around `center` for a passenger: on the ground level, not in a wall, not in the lagoon, line of sight to the centre */
  releaseSpot(p, center, base, yaw0) {
    const w = this.g.world, hr = Math.max(0.3, p.rad), gyB = center.y - (base === BALL_R ? BALL_R : 0);
    for (let ring = 0; ring < 3; ring++) {
      const d = (base + hr + 0.2) * (1 + 0.35 * ring);
      for (let i = 0; i < 12; i++) {
        const a = yaw0 + Math.PI * 0.5 * (i % 2 ? 1 : -1) * Math.ceil(i / 2) / 3 + (i === 0 ? 0 : 0), px = center.x + sin(a) * d, pz = center.z + cos(a) * d;
        const gy = w.groundAt(px, pz, gyB + 0.5, 0.5, hr * 0.5); if (Math.abs(gy - gyB) > 0.8) continue;
        _a.set(px, gy, pz); w.resolveXZ(_a, hr, gy, p.height, 0.4); if (Math.hypot(_a.x - px, _a.z - pz) > 0.05) continue;
        const lg = w.lagoon; if (lg && lg.inRect(px, pz, hr)) continue;
        _b.set(px - center.x, 0, pz - center.z); const L = _b.length(); _b.normalize(); const ray = w.raySolid(_c.set(center.x, gy + 0.6, center.z), _b, L); if (ray && ray.t < L - 0.05) continue;
        return { x: px, y: gy, z: pz, dir: _b.clone() };
      }
    }
    return null;
  },
  placePassenger(p, spot, hop) {
    const h = p.h; h.root.visible = true; h.root.scale.setScalar(p.s0); h.home.set(spot.x, spot.y, spot.z); h.root.position.copy(h.home); h.air = 0; h.airV = 0; h.kv.set(0, 0, 0); h.slide && h.slide.set(0, 0, 0); h.slideV && h.slideV.set(0, 0, 0);
    if (h.release) h.release(); else { h.held = false; if (h.collider) h.collider.dead = !!h.dead; } h.held = false; if (h.collider && !h.dead) h.collider.dead = false;
    if (hop) { if (h.shove && spot.dir) h.shove(spot.dir, 2.2); if (h.launch) h.launch(2.2); } this.hitCd.set(h, 1.0);
  },
  /** all passengers out (alien switch, unroll, defeat, reset, impact): around `at` ({x,y,z}, standing Cannonbolt) or around the ball; a spot is always found (falls back to the nearest free one) */
  releaseAll(reason, at = null, immediate = false) {
    if (this.cap) this.abortCapture(); this.rel = null; this.capK = 0; if (!this.passengers.length) return;
    const w = this.g.world, center = at ? _e.set(at.x, at.y, at.z).clone() : this.c.clone(), base = at ? this.rad : BALL_R, yaw0 = this.yaw, list = this.passengers.splice(0);
    if (at) { center.y = at.y + 0.9; }
    let i = 0; for (const p of list) {
      let spot = immediate ? null : this.releaseSpot(p, center, at ? this.rad + 0.6 : base, yaw0 + i * 0.9);
      if (!spot) { const hr = Math.max(0.3, p.rad), a = yaw0 + 1.5 + i * 1.3, d = base + hr + 0.4, px = center.x + sin(a) * d, pz = center.z + cos(a) * d, gy = w.groundAt(px, pz, center.y + 0.5, 0.5, 0.1); _a.set(px, gy, pz); w.resolveXZ(_a, hr, gy, p.height, 0.4); if (w.lagoon) w.lagoon.keepOut(_a, hr); spot = { x: _a.x, y: gy, z: _a.z, dir: _b.set(sin(a), 0, cos(a)).clone() }; }
      this.placePassenger(p, spot, !immediate); i++;
    }
    if (reason !== 'RESET' && reason !== 'SWITCH') this.g.hud.toast('PASSENGERS RELEASED'); this.stats.releases += list.length;
  },

  // ============================================================================================== per frame (all forms)
  updatePowers(dt, aimPoint) {
    if (this.form === 'stand' || (this.tr && this.tr.kind === 'unroll')) {
      for (const k in this.cd) this.cd[k] = Math.max(0, this.cd[k] - dt); this.comboT = Math.max(0, this.comboT - dt); this.hintT = Math.max(0, this.hintT - dt);
      const a = this.act; if (a) { a.t += dt; a.st += dt; if (a.kind === 'punch') this.tickPunch(dt, a); else if (a.kind === 'heavy') this.tickHeavy(dt, a); }
      else if (this.lmbHeld && this.cd.lmb <= 0 && this.form === 'stand' && !this.tr) this.startPunch();
    }
    void aimPoint;
    if (this.hintEl) { const on = this.hintT > 0 && this.g.player === this; if (this.hintEl.hidden === on) this.hintEl.hidden = !on; if (on && this.hintEl.textContent !== this.hintTxt) this.hintEl.textContent = this.hintTxt; }
  },

  // ============================================================================================== attack poses (layers over the locomotion pose)
  actLayer(dt) {
    const a = this.act; if (!a) return null; const t = a.st, L = { d: {}, armOff: {}, curl: {}, w: 1, armW: 1 };
    if (a.kind === 'punch') {
      const s = a.side === 'L' ? 1 : -1, wind = a.stage === 'windup' ? sm(t / a.windT) : a.stage === 'strike' ? 1 : 1 - sm(t / a.recT), str = a.stage === 'strike' ? easeOutCubic(t / a.strikeT) : a.stage === 'recover' ? 1 : 0, rec = a.stage === 'recover' ? sm(t / a.recT) : 0;
      let reach = V(s * 0.12, -0.1, 1.55);
      if (a.tgt && !a.tgt.dead && a.tgt.spheres && a.tgt.root) {
        const sh = this.rig.arms[a.side].a.getWorldPosition(_a.clone()); let best = 1e9, bp = null;
        for (const sp of a.tgt.spheres) { _d.copy(sp.local); a.tgt.root.localToWorld(_d); const dd = _d.distanceTo(sh); if (dd < best) { best = dd; bp = _e.clone().copy(_d); } }
        if (bp) { const rel = bp.sub(sh), len = rel.length(); if (len > 1.5) rel.multiplyScalar(1.5 / len); rel.applyQuaternion(this.tiltG.getWorldQuaternion(new THREE.Quaternion()).invert()); reach = rel; }
      }
      const back = V(s * 0.55, -0.2, -0.75), off = a.stage === 'windup' ? this.armBase[a.side].clone().lerp(back, wind) : a.stage === 'strike' ? back.clone().lerp(reach, str) : reach.clone().lerp(this.armBase[a.side], rec);
      L.armOff[a.side] = off; L.armOff[a.side === 'L' ? 'R' : 'L'] = V(-s * 0.3, -0.75, 0.55).lerp(this.armBase[a.side === 'L' ? 'R' : 'L'], 0.25);
      const tw = a.stage === 'windup' ? wind * 0.5 : a.stage === 'strike' ? 0.5 - 1.05 * str : -0.55 * (1 - rec), lean = a.stage === 'windup' ? -0.1 * wind : 0.3 * str * (1 - rec) - (a.hay ? 0.1 : 0);
      L.d.hips = D(lean * 0.8, s * tw * 0.5, 0); L.d.spine = D(lean * 0.6, s * tw * 0.6, 0); L.d.chest = D(lean * 0.6, s * tw * 0.8, 0); L.curl = { [a.side]: a.stage === 'strike' ? 1.1 : 0.7, [a.side === 'L' ? 'R' : 'L']: 0.9 };
      L.w = a.stage === 'recover' ? 1 - rec * 0.5 : 1; L.armW = a.stage === 'recover' ? 1 - rec * 0.6 : 1; return L;
    }
    const wd = a.stage === 'windup' ? sm(t / a.windT) : 1, sk = a.stage === 'strike' ? easeOutCubic(t / 0.16) : a.stage === 'recover' ? 1 : 0, rc = a.stage === 'recover' ? sm(t / 0.5) : 0;
    for (const k of SIDES) { const s = k === 'L' ? 1 : -1; const up = V(s * 0.3, 1.0, -0.15), down = V(s * 0.28, -0.55, 1.45); L.armOff[k] = a.stage === 'windup' ? this.armBase[k].clone().lerp(up, wd) : a.stage === 'strike' ? up.clone().lerp(down, sk) : down.clone().lerp(this.armBase[k], rc); }
    const lean = a.stage === 'windup' ? -0.28 * wd : -0.28 + 1.0 * sk * (1 - rc) * 1 - 0.0; L.d.hips = D(lean * 0.35, 0, 0); L.d.spine = D(lean * 0.5, 0, 0); L.d.chest = D(lean * 0.55, 0, 0); L.curl = { L: 1.0, R: 1.0 };
    L.w = 1; L.armW = a.stage === 'recover' ? 1 - rc * 0.7 : 1; return L;
  },

  // ============================================================================================== damage taken
  onHit(dmg, pt, dir) {
    const g = this.g; g.hud.hurt(); let d = dmg;
    if (this.form === 'ball') { d = dmg * (0.3 + 0.5 * clamp((dmg - 20) / 60, 0, 1)); g.camera.addTrauma(0.12); this.sq.k = Math.max(this.sq.k, 0.05); if (dir) this.sq.axis.set(-dir.x, 0, -dir.z).normalize(); g.sfx.thud(0.25); }
    else { g.camera.addTrauma(0.3); this.an.flinch = 1; if (dir) this.an.flinchDir.set(dir.x, 0, dir.z); for (const m of this.rig.bodyMats) m.emissive.setRGB(0.5, 0.1, 0.06); this.flashT = 0.16; this.stats.flinches++; }
    this.hp = Math.max(0, this.hp - d); this.hpT = 4;
    if (this.hp <= 0) { this.hp = this.cfg.hp * 0.6; this.releaseAll('DEFEAT'); g.hud.toast('SECOND WIND'); }
  },
  knock(dir, v) { const k = this.form === 'ball' ? BALL.mass / this.ballMass() : 1; if (this.form === 'ball') { this.v.x += dir.x * v * 0.5 * k; this.v.z += dir.z * v * 0.5 * k; } else { this.vel.x += dir.x * v * 0.4; this.vel.z += dir.z * v * 0.4; } },

  // ============================================================================================== HUD
  hudUpdate() {
    const a = this.act ? this.act.kind : '', I = this.input || {}, ball = this.form === 'ball', set = (k, on, cd = 0, mx = 1) => { const e = $('cbslot-' + k); if (e) e.classList.toggle('active', !!on); const c = $('cbcd-' + k); if (c) c.style.width = (cd > 0 ? cd / mx * 100 : 0) + '%'; };
    set('lmb', a === 'punch' || !!this.slam, this.cd.lmb, ball ? CB_CD.slam : 0.5); set('e', a === 'heavy' || (this.tr && this.tr.attack), this.cd.e, CB_CD.e); set('q', ball || !!this.tr, this.cd.q, CB_CD.q); set('f', !!this.cap || !!this.rel, this.cd.f, CB_CD.f);
    set('sh', I.run, 0, 1); set('sp', I.jumpHeld, 0, 1); set('ct', I.down && ball, 0, 1);
    const lab = (id, t) => { const e = $(id); if (e && e.textContent !== t) e.textContent = t; };
    lab('cbslot-lmb-l', ball ? 'Roll Impact' : 'Punch'); lab('cbslot-e-l', ball ? 'Unroll Attack' : 'Heavy Slam'); lab('cbslot-sp-l', ball ? 'Rolling Jump' : 'Jump'); lab('cbslot-sh-l', ball ? 'Roll Faster' : 'Run'); lab('cbslot-q-l', ball ? 'Unroll' : 'Ball');
    const hp = $('cb-hp'); if (hp) hp.style.width = (this.hp / this.cfg.hp * 100) + '%';
    lab('cb-form', 'FORM: ' + (ball || (this.tr && this.tr.kind === 'curl' && this.form === 'ball') ? 'BALL' : this.tr && this.tr.kind === 'unroll' ? 'BALL' : 'NORMAL'));
    lab('cb-speed', 'SPEED: ' + (ball ? this.v.length() : this.speed).toFixed(1) + ' m/s'); lab('cb-pass', 'PASSENGERS: ' + this.passengers.length + ' / ' + this.maxPassengers());
    const fe = $('cb-form'); if (fe) fe.dataset.ball = ball ? '1' : '0';
  },
};
