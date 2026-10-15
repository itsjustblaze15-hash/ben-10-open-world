// Ghostfreak's abilities: Invisibility (Shift, hold), Intangibility (F), Possession (Q), Claw attack (LMB), Tentacle attack + grab (E).
//  - Invisibility drives Stealth (src/stealth.js): enemies lose detection, walk to the last place they saw him, and never aim at his live position. Attacking reveals him briefly.
//  - Intangibility is a real collision change in the controller (nothing solid exists while it is on; arena bounds / floor stay); turning it off inside geometry ejects him.
//  - Possession only works on living Guards. While possessed the host runs from the player's buttons using only its own moves (walk / run / baton / blaster) and its AI is off.
//  - Claw: real hand-sphere contact + knockback. Tentacle: the model's OWN arms stretched by the rig's two-bone IK (no separate objects), contact at the tip, grab -> pull -> throw / release.
import * as THREE from 'three';
import { V, D, mkPose } from '../animations/ghostrig.js';
import { clamp, damp, lerp, angleDelta, rand, easeOutCubic } from './util.js';
import { Dummy } from './dummies.js';
import { Guard } from './guards.js';
import { Turret } from './turrets.js';

const $ = id => document.getElementById(id);
const sin = Math.sin, cos = Math.cos, TAU = Math.PI * 2;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _m = new THREE.Matrix4();
export const GF_CD = { lmb: 0.5, e: 3.0, q: 0.9, f: 0.35 };
export const POSS_RANGE = 10, TENT_REACH = 7.0;
const MACHINES = new Set(['car', 'truck', 'computer', 'robot', 'dumpster', 'barrel', 'trash', 'light']);
const sm = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

export const gfPowers = {
  initPowers(game) {
    this.act = null; this.poss = null; this.cd = { lmb: 0, e: 0, q: 0, f: 0 }; this.cdMax = GF_CD; this.lmbHeld = false; this.clawIdx = 0; this.toastT = 0; this.invWant = false;
    this.aimPt = new THREE.Vector3(0, 0, -20); this.hintEl = $('gfhint'); this.hintTxt = ''; this.tipW = [new THREE.Vector3(), new THREE.Vector3()];
  },
  toast(m) { if (this.toastT <= 0) { this.g.hud.toast(m); this.toastT = 1.3; } },

  // ============================================================================================== input
  keyDown(code) { switch (code) { case 'KeyQ': return this.keyQ(); case 'KeyE': return this.keyE(); case 'KeyF': return this.keyF(); } },
  keyUp() {},
  mouseDown() { this.lmbHeld = true; this.keyLMB(); },
  mouseUp() { this.lmbHeld = false; },

  // ============================================================================================== invisibility (Shift, hold)
  stealthStep(dt, input) {
    if (this.g.player !== this) { this.invis = 0; this.invWant = false; return; }
    const want = !!input.run && !this.poss; this.stats.invisTime += this.invis > 0.72 ? dt : 0;
    if (want !== this.invWant) { this.invWant = want; if (!this.act) this.playGest(want ? 'invOn' : 'invOff', 0.5); this.g.sfx.ghost(want, 0.13); }
    this.invis = clamp(this.invis + (want ? 2.0 : -1.4) * dt, 0, 1);
  },

  // ============================================================================================== intangibility (F)
  keyF() {
    if (this.poss) { this.toast('EXIT POSSESSION FIRST  [Q]'); return; }
    if (this.cd.f > 0) return; this.cd.f = GF_CD.f; this.setPhase(!this.phaseOn);
  },
  setPhase(on, instant = false) {
    if (on === this.phaseOn) return; const g = this.g;
    if (on) {
      this.cancelAct(); this.phaseOn = true; this.stats.phases++; this.playGest('phaseOn', 0.6); g.sfx.ghost(true, 0.2); g.hud.toast('INTANGIBLE');
      for (let i = 0; i < 14; i++) g.fx.glow.emit({ pos: _a.set(this.pos.x + rand(-0.5, 0.5), this.pos.y + rand(0.2, 2.2), this.pos.z + rand(-0.5, 0.5)), vel: _b.set(rand(-0.5, 0.5), rand(0.2, 1.2), rand(-0.5, 0.5)), size: rand(0.2, 0.4), life: 0.7, drag: 1.2, color: [0.55, 0.8, 1], alpha: 0.5 });
    } else {
      this.phaseOn = false; this.playGest('phaseOff', 0.5); g.sfx.ghost(false, 0.2);
      if (this.hitsSolid(this.pos.x, this.pos.y, this.pos.z, 0.5, 2.3)) {          // inside geometry: find the nearest open space and slide there before the body turns solid
        const s = this.findSafe(this.pos);
        if (s) { this.stats.ejects++; if (instant) this.pos.copy(s); else this.eject = { from: this.pos.clone(), to: s, t: 0, dur: clamp(this.pos.distanceTo(s) / 6, 0.2, 0.55) }; g.hud.toast('SOLID AGAIN — MOVED OUT OF THE WALL'); }
      } else g.hud.toast('TANGIBLE');
    }
  },
  ejectStep(dt) {
    const e = this.eject; e.t += dt; const u = clamp(e.t / e.dur, 0, 1), k = u * u * (3 - 2 * u); this.pos.lerpVectors(e.from, e.to, k); this.vel.multiplyScalar(Math.exp(-6 * dt)); this.vel.y = 0;
    if (u >= 1) this.eject = null;
  },

  // ============================================================================================== possession (Q)
  keyQ() {
    const P = this.poss;
    if (P) { if (P.stage === 'active') this.endPossession('player'); else if (P.stage === 'approach') this.endPossession('cancel'); return; }
    if (this.cd.q > 0 || this.eject) return;
    const host = this.findHost(); if (host) this.startPossession(host);
  },
  /** nearest living guard in front of the camera (range 10 m); otherwise explain why nothing qualified */
  findHost() {
    const g = this.g, p = this.pos, aim = this.aimYaw(), sy = sin(aim), cy = cos(aim); let best = null, bs = 1e9;
    for (const o of g.guards) {
      if (o.dead || o.held || o.possessed || o.frozen) continue; const hp = o.root.position, dx = hp.x - p.x, dz = hp.z - p.z, dy = hp.y + 1.2 - (p.y + 1.3), d = Math.hypot(dx, dz, dy); if (d > POSS_RANGE) continue;
      const dot = (dx * sy + dz * cy) / Math.max(1e-3, Math.hypot(dx, dz)); if (dot < 0.1 && d > 3) continue; const sc = d - dot * 3; if (sc < bs) { bs = sc; best = o; }
    }
    if (best) return best;
    let msg = 'NO LIVING TARGET IN RANGE', bd = POSS_RANGE;
    for (const h of g.world.hittables) { if (h.dead || h instanceof Guard) continue; const d = Math.hypot(h.root.position.x - p.x, h.root.position.z - p.z); if (d >= bd) continue; if (h instanceof Dummy) { bd = d; msg = 'TRAINING DUMMY — NOT A LIVING TARGET'; } else if (h instanceof Turret) { bd = d; msg = 'TURRET IS A MACHINE — CAN\'T POSSESS'; } }
    for (const pr of g.props.props) { if (pr.dead || !MACHINES.has(pr.kind)) continue; const d = Math.hypot(pr.pos.x - p.x, pr.pos.z - p.z); if (d < bd) { bd = d; msg = 'MACHINES BELONG TO UPGRADE — CAN\'T POSSESS'; } }
    this.toast(msg); return null;
  },
  startPossession(o) {
    this.cancelAct(); this.phaseOn = false; this.invWant = false; this.stats.possessions++; this.cd.q = GF_CD.q; this.eject = null;
    const hp = o.root.position, dx0 = hp.x - this.pos.x, dz0 = hp.z - this.pos.z, d0 = Math.hypot(dx0, dz0) || 1e-3, stop = Math.min(d0, 1.05);
    this.poss = { stage: 'approach', t: 0, host: o, from: this.pos.clone(), to: new THREE.Vector3(hp.x - dx0 / d0 * stop, hp.y + 0.4, hp.z - dz0 / d0 * stop), dur: clamp(d0 / 12, 0.5, 0.95) }; o.freeze(true);
    this.playGest('possReach', 0.75); this.g.sfx.ghost(true, 0.2); this.g.hud.toast('POSSESSING ' + o.name);
  },
  possPhysics(dt, input, camYaw) {
    const P = this.poss, o = P.host, g = this.g, A = this.an, hp = o.root.position; P.t += dt; this.speed = this.speed * Math.exp(-6 * dt);
    if (P.stage === 'approach') {
      const dx = hp.x - this.pos.x, dz = hp.z - this.pos.z, d = Math.hypot(dx, dz) || 1e-3; this.yaw += angleDelta(this.yaw, Math.atan2(dx, dz)) * (1 - Math.exp(-12 * dt));
      const u = sm(P.t / P.dur); this.pos.lerpVectors(P.from, P.to, u); this.vel.set(dx / d * 3, 0, dz / d * 3);        // one smooth glide (ease in / out), no snap
      A.alpha = damp(A.alpha, 0.5, 8, dt);
      if (o.dead || o.held) { this.endPossession('cancel'); return; }
      if (P.t >= P.dur) { P.stage = 'enter'; P.t = 0; }
    } else if (P.stage === 'enter') {
      const k = clamp(P.t / 0.5, 0, 1), e = sm(k);
      _a.set(hp.x, hp.y + 0.05, hp.z); this.pos.lerp(_a, 1 - Math.exp(-12 * dt)); A.alpha = lerp(0.5, 0, e); A.shrink = lerp(1, 0.55, e);
      for (let i = 0; i < 2; i++) g.fx.glow.emit({ pos: _b.set(this.pos.x + rand(-0.35, 0.35), this.pos.y + rand(0.5, 2.0), this.pos.z + rand(-0.35, 0.35)), vel: _c.set(hp.x - this.pos.x, hp.y + 1.3 - this.pos.y - 0.6, hp.z - this.pos.z).multiplyScalar(2.5).add(_d.set(rand(-0.6, 0.6), rand(0, 1), rand(-0.6, 0.6))), size: rand(0.2, 0.42), life: 0.45, drag: 1, color: [0.62, 0.42, 1], alpha: 0.7 });
      if (o.dead) { this.endPossession('host down'); return; }
      if (k >= 1) {
        P.stage = 'active'; P.t = 0; o.possessed = true; o.freeze(false); o.frozen = false; o.ctrl.yaw = camYaw; this.root.visible = false; A.shrink = 1; A.alpha = 1; this.an.gest = null; g.hud.toast('POSSESSED — ' + o.name); g.camera.kick(0.04); g.sfx.ghost(true, 0.2);
        for (let i = 0; i < 18; i++) g.fx.glow.emit({ pos: _b.set(hp.x, hp.y + 1.4, hp.z), vel: _c.set(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).normalize().multiplyScalar(rand(1.5, 4)), size: rand(0.25, 0.5), life: 0.5, drag: 2, color: [0.62, 0.42, 1], alpha: 0.7 });
      }
    } else if (P.stage === 'active') {
      if (o.dead) { this.endPossession('host down'); return; }
      const c = o.ctrl; c.mx = input.moveX; c.my = input.moveY; c.run = input.run; c.yaw = camYaw; c.aimYaw = this.aimYaw();
      this.pos.copy(hp); this.vel.set(o.vx, 0, o.vz); this.speed = o.speed; this.yaw = o.yaw; this.alt = 0; this.grounded = true; this.mode = 'ground';
    } else if (P.stage === 'exit') {
      const k = sm(P.t / P.dur); this.pos.lerpVectors(P.from, P.to, k); A.alpha = clamp(k * 1.3, 0, 1); A.shrink = lerp(0.55, 1, k); this.vel.multiplyScalar(Math.exp(-5 * dt)); this.speed = 0;
      this.yaw += angleDelta(this.yaw, Math.atan2(hp.x - this.pos.x, hp.z - this.pos.z) + 0) * (1 - Math.exp(-4 * dt));
      if (P.t >= P.dur) this.finishExit();
    }
    this.postMovePoss();
  },
  postMovePoss() { this.grounded = this.poss ? this.poss.stage === 'active' || this.grounded : this.grounded; },
  /** Q again (or the host dying / a reset / switching alien): Ghostfreak reforms in open space next to the host, which staggers and resumes its AI */
  endPossession(reason = 'player', instant = false) {
    const P = this.poss; if (!P) return; const o = P.host, g = this.g, A = this.an;
    if (P.stage === 'approach') { o.freeze(false); this.poss = null; A.alpha = 1; A.shrink = 1; return; }
    if (P.stage === 'exit') { if (instant) this.finishExit(); return; }
    const hp = o.root.position;
    this.root.visible = true; this.pos.set(hp.x, hp.y + 0.05, hp.z);
    const base = _a.set(hp.x - sin(o.yaw) * 1.6, hp.y + 0.55, hp.z - cos(o.yaw) * 1.6); let to = this.findSafe(base.clone(), 0.5, 2.3, 10) || this.findSafe(_b.set(hp.x, hp.y + 3, hp.z), 0.5, 2.3, 10) || new THREE.Vector3(hp.x, hp.y + 0.6, hp.z);
    o.unpossess(reason === 'reset' ? 0.1 : reason === 'host down' ? 0 : 0.8); o.ctrl.mx = o.ctrl.my = 0;
    this.poss = { stage: 'exit', t: 0, dur: 0.65, host: o, from: this.pos.clone(), to };
    this.invis = 0; this.phaseOn = false; A.alpha = 0; A.shrink = 0.55;
    if (instant) { this.finishExit(); return; }
    this.playGest('possExit', 0.7); g.sfx.ghost(false, 0.22); g.hud.toast(reason === 'host down' ? 'HOST DOWN — GHOSTFREAK REFORMS' : 'GHOSTFREAK EMERGES');
    for (let i = 0; i < 16; i++) g.fx.glow.emit({ pos: _b.set(hp.x, hp.y + 1.4, hp.z), vel: _c.set(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).normalize().multiplyScalar(rand(1.5, 4.5)), size: rand(0.25, 0.5), life: 0.5, drag: 2, color: [0.62, 0.42, 1], alpha: 0.7 });
  },
  finishExit() {
    const P = this.poss; if (!P) return; this.pos.copy(P.to); this.poss = null; this.an.alpha = 1; this.an.shrink = 1; this.vel.set(0, 0, 0); this.root.visible = true; this.alt = 0.5;
  },

  // ============================================================================================== helpers (contact)
  /** living things Ghostfreak's body can hit: dummies, turrets, guards; alive, not carried; nearest first, optional cone in front of yaw */
  foes(maxD, cosMin = -1, yaw = this.yaw) {
    const fx = sin(yaw), fz = cos(yaw), res = [];
    for (const h of this.g.world.hittables) {
      if (h.dead || h.held || h.kind !== 'dummy' || h.possessed) continue; const dx = h.root.position.x - this.pos.x, dz = h.root.position.z - this.pos.z, d = Math.hypot(dx, dz); if (d > maxD || Math.abs(h.root.position.y - this.pos.y) > 4.5) continue;
      const dot = d > 0.05 ? (dx * fx + dz * fz) / d : 1; if (dot < cosMin) continue; res.push({ h, d, dot, score: d - dot * 3 });
    } return res.sort((a, b) => a.score - b.score);
  },
  touchEnemy(h, c, r) { const hp = h.root.position, col = h.collider, rr = (col ? col.r : 0.62) + r, hh = col ? col.h : 2.4, dx = hp.x - c.x, dz = hp.z - c.z; if (dx * dx + dz * dz > rr * rr) return false; return c.y > hp.y - r && c.y < hp.y + hh + r; },
  hurtFoe(h, pt, dir, dmg, kb, o = {}) {
    const g = this.g; h.applyHit(pt, dir.clone(), dmg); if (h.shove && kb) h.shove(dir, kb); if (o.launch && h.launch) h.launch(o.launch); if (o.tilt && h.tiltV) { h.tiltV.x += dir.z * o.tilt; h.tiltV.y -= dir.x * o.tilt; }
    g.hud.hit(pt, Math.round(dmg), h); this.stats.hits++;
  },
  hitFX(pt, k = 1) {
    const g = this.g; g.fx.glow.emit({ pos: pt, size: 1.5 * k, life: 0.12, drag: 0, color: [0.8, 0.85, 1], alpha: 1 });
    for (let i = 0; i < 6 * k; i++) g.fx.glow.emit({ pos: pt.clone(), vel: _d.set(rand(-1, 1), rand(0, 1), rand(-1, 1)).normalize().multiplyScalar(rand(2, 5)).clone(), size: rand(0.12, 0.25), life: 0.3, drag: 2, color: [0.7, 0.75, 1], alpha: 0.9 });
    g.camera.addTrauma(0.08 * k); g.camera.kick(0.01 * k); g.sfx.hit(false);
  },
  beginAct(kind, extra) { this.act = Object.assign({ kind, stage: 'start', t: 0, st: 0, speedMul: 0.6, faceYaw: this.aimYaw(), faceK: 16 }, extra); this.an.gest = null; return this.act; },
  endAct() { this.act = null; },
  /** drop whatever is going on with the arms (dropping a grabbed enemy cleanly) */
  cancelAct() { const a = this.act; if (!a) return; if (a.kind === 'tentacle' && a.holdObj) this.dropHeld(a, false); this.act = null; },
  cancelAll(instant = false) {
    this.cancelAct(); this.lmbHeld = false;
    if (this.poss) this.endPossession('switch', true);
    if (this.eject) { this.pos.copy(this.eject.to); this.eject = null; }
    if (this.phaseOn) this.setPhase(false, true);
    this.phaseOn = false; this.phaseK = 0; this.invWant = false; this.invis = 0; this.an.gest = null; this.an.alpha = 1; this.an.shrink = 1; this.root.visible = true; this.tiltKick = 0;
    this.cd.lmb = this.cd.e = this.cd.f = 0; this.fx.reset(); if (this.g.stealth) this.g.stealth.reset(); if (this.hintEl) this.hintEl.hidden = true;
  },
  /** world-space point -> the rig's model space (metres at world scale), for IK targets in the 'w' frame */
  toModel(p, out = new THREE.Vector3()) { const g = this.rig.modelGroup, sc = g.scale.x; _m.copy(g.matrixWorld).invert(); return out.copy(p).applyMatrix4(_m).multiplyScalar(sc); },
  dirToModel(d, out = new THREE.Vector3()) { const g = this.rig.modelGroup; g.getWorldQuaternion(_q0).invert(); return out.copy(d).applyQuaternion(_q0); },
  chestW(out) { return out.set(this.pos.x, this.pos.y + 1.3, this.pos.z); },
  handW(k, out) { const A = this.rig.arms[k]; return out.setFromMatrixPosition(A.w.matrixWorld); },
  elbowW(k, out) { const A = this.rig.arms[k]; return out.setFromMatrixPosition(A.e.matrixWorld); },

  // ============================================================================================== LMB: claw
  keyLMB() {
    const P = this.poss;
    if (P) { if (P.stage === 'active') { if (P.host.startBaton()) this.g.sfx.whoosh(); else P.host.queue('baton'); } return; }
    if (this.phaseOn || this.eject) { this.toast('SOLIDIFY TO ATTACK  [F]'); return; }
    if (this.cd.lmb > 0) return; const cur = this.act; if (cur && !(cur.kind === 'claw' && cur.stage === 'rec')) return; if (cur) this.endAct();
    const side = (this.clawIdx++ % 2) ? 'R' : 'L', a = this.beginAct('claw', { side, stage: 'wind', speedMul: 0.5, wind: 0.14, swipe: 0.17, rec: 0.34, hit: new Set(), push: 0, faceK: 22 });
    const f = this.foes(4.8, 0.2, this.aimYaw())[0]; a.target = f ? f.h : null; a.faceYaw = f ? Math.atan2(f.h.root.position.x - this.pos.x, f.h.root.position.z - this.pos.z) : this.aimYaw();
    this.cd.lmb = GF_CD.lmb; this.stats.claws++; this.g.stealth.poke(0.9);
  },
  updateClaw(dt, a) {
    a.t += dt; const g = this.g;
    if (a.target && !a.target.dead) a.faceYaw = Math.atan2(a.target.root.position.x - this.pos.x, a.target.root.position.z - this.pos.z);
    if (a.stage === 'wind' && a.t >= a.wind) { a.stage = 'swipe'; a.push = 26; g.sfx.whoosh(); }
    if (a.stage === 'swipe') {
      if (a.t >= a.wind + 0.09) a.push = 0;
      const h = this.handW(a.side, _a), e = this.elbowW(a.side, _b), c = _c.copy(h).addScaledVector(_d.copy(h).sub(e).normalize(), 0.22);
      for (const o of g.world.hittables) {
        if (o.dead || o.held || a.hit.has(o) || o.possessed || o.kind !== 'dummy' || !this.touchEnemy(o, c, 0.8)) continue; a.hit.add(o);
        const dir = _d.set(o.root.position.x - this.pos.x, 0, o.root.position.z - this.pos.z); if (dir.lengthSq() < 1e-4) dir.set(sin(this.yaw), 0, cos(this.yaw)); dir.normalize();
        const side = a.side === 'L' ? -1 : 1; dir.x += cos(this.yaw) * side * 0.25; dir.z += -sin(this.yaw) * side * 0.25; dir.normalize();
        this.hurtFoe(o, c.clone(), dir.clone(), 22, 9, { launch: 0.9, tilt: 2.4 }); this.hitFX(c.clone(), 1.2); this.stats.clawHits++;
      }
      if (a.t >= a.wind + a.swipe) { a.stage = 'rec'; a.push = 0; if (!a.hit.size) g.sfx.whoosh(); }
    } else if (a.stage === 'rec' && a.t >= a.wind + a.swipe + a.rec) this.endAct();
  },
  clawLayer(a) {
    const s = a.side === 'L' ? 1 : -1, so = -s, ti = this.an.tiltInv, t = a.t, wind = a.wind, sw = a.swipe, rec = a.rec;
    const uw = clamp(t / wind, 0, 1), us = clamp((t - wind) / sw, 0, 1), ur = clamp((t - wind - sw) / rec, 0, 1);
    let phi, R, y, twist, w;
    if (t < wind) { phi = lerp(0.9, 1.75, sm(uw)); R = lerp(1.0, 1.15, uw); y = lerp(0.2, 0.62, sm(uw)); twist = lerp(0, 0.75, sm(uw)); w = sm(uw * 1.4); }
    else if (t < wind + sw) { const e = easeOutCubic(us); phi = lerp(1.75, -0.55, e); R = 1.15 + 0.85 * sin(Math.PI * clamp(us * 0.95 + 0.04, 0, 1)); y = lerp(0.62, -0.22, e); twist = lerp(0.75, -0.6, e); w = 1; }
    else { phi = lerp(-0.55, 0.3, sm(ur)); R = lerp(1.4, 1.0, sm(ur)); y = lerp(-0.22, -0.2, ur); twist = lerp(-0.6, 0, sm(ur)); w = 1 - sm(ur); }
    const L = { d: {}, ik: {}, curl: {}, w };
    L.ik[a.side] = { p: V(s * R * sin(phi), y, R * cos(phi)).applyQuaternion(ti), pole: V(s * 0.5, -0.8, -0.2).applyQuaternion(ti), ext: 1.06, hand: 1.08 }; L.curl[a.side] = t < wind + sw ? 0.0 : 0.35;
    L.ik[a.side === 'L' ? 'R' : 'L'] = { p: V(so * 0.6, -0.15, 0.35).applyQuaternion(ti), pole: V(so * 0.7, -0.4, -0.6).applyQuaternion(ti), w: 0.6 }; L.curl[a.side === 'L' ? 'R' : 'L'] = 0.4;
    L.d.hips = D(0.05 * w, twist * 0.25 * s, 0); L.d.spine = D(0.06 * w, twist * 0.45 * s, 0); L.d.chest = D(0.05 * w, twist * 0.55 * s, 0); L.d.head = D(0, -twist * 0.3 * s, 0);
    L.d.neck = D(0, -twist * 0.2 * s, 0); return L;
  },

  // ============================================================================================== E: tentacles (the model's own arms, stretched)
  keyE() {
    const P = this.poss;
    if (P) { if (P.stage === 'active') { const ok = P.host.startShot(this.aimPt); if (ok) this.g.sfx.whoosh(); else if (P.host.atk) P.host.queue('shot', this.aimPt); } return; }
    if (this.phaseOn || this.eject) { this.toast('SOLIDIFY TO ATTACK  [F]'); return; }
    const a = this.act; if (a && a.kind === 'tentacle') { if (a.stage === 'hold') this.throwHeld(a); return; }
    if (a || this.cd.e > 0) { if (!a && this.cd.e > 0) this.toast('TENTACLES RECOVERING  ' + this.cd.e.toFixed(1) + 's'); return; }
    this.startTentacle();
  },
  startTentacle() {
    const g = this.g, a = this.beginAct('tentacle', { stage: 'raise', speedMul: 0.35, vMul: 0.25, holdObj: null, hits: new Set(), faceK: 12, holdY: this.pos.y, tip: [new THREE.Vector3(), new THREE.Vector3()], from: [new THREE.Vector3(), new THREE.Vector3()], goal: new THREE.Vector3(), dur: 0.3, w: 0 });
    const f = this.foes(TENT_REACH + 1.5, 0.25, this.aimYaw())[0]; a.target = f ? f.h : null; a.faceYaw = f ? Math.atan2(f.h.root.position.x - this.pos.x, f.h.root.position.z - this.pos.z) : this.aimYaw();
    this.cd.e = GF_CD.e; this.stats.tentacles++; g.stealth.poke(1.4); g.sfx.ghost(false, 0.14);
    for (let j = 0; j < 2; j++) this.raisePos(j, a.tip[j]);
    for (let j = 0; j < 2; j++) a.from[j].copy(a.tip[j]);
  },
  /** world position of tentacle j (0 = left, 1 = right) when the arm is raised */
  raisePos(j, out) { const s = j === 0 ? 1 : -1, y = this.yaw; this.chestW(out); return out.add(_d.set(cos(y) * s * 0.85 + sin(y) * 0.3, 1.0, -sin(y) * s * 0.85 + cos(y) * 0.3)); },
  restPos(j, out) { const s = j === 0 ? 1 : -1, y = this.yaw; this.chestW(out); return out.add(_d.set(cos(y) * s * 0.46 + sin(y) * 0.14, -0.4, -sin(y) * s * 0.46 + cos(y) * 0.14)); },
  targetChest(h, out) { return out.set(h.root.position.x, h.root.position.y + (h.air || 0) + 1.2, h.root.position.z); },
  updateTentacle(dt, a) {
    a.t += dt; a.st += dt; const g = this.g, y = a.faceYaw;
    if (a.target && !a.target.dead && !a.holdObj) a.faceYaw = Math.atan2(a.target.root.position.x - this.pos.x, a.target.root.position.z - this.pos.z);
    if (a.stage === 'raise') {
      for (let j = 0; j < 2; j++) this.raisePos(j, a.tip[j]); a.w = sm(a.st / 0.14);
      if (a.st >= a.dur) {
        // choose the goal: the target's chest, else the aim point in front of us (never beyond reach), shortened by walls so the arms never go through anything
        const ch = this.chestW(_a); let goal = a.target && !a.target.dead ? this.targetChest(a.target, _b) : _b.copy(this.aimPt);
        const dir = _c.copy(goal).sub(ch); let L = dir.length(); if (L < 1.2) { dir.set(sin(a.faceYaw), 0.05, cos(a.faceYaw)); L = 1.2; } dir.normalize(); const reach = Math.min(L, TENT_REACH);
        const hit = g.world.raySolid(ch, dir, reach + 0.3); const Lg = hit ? Math.max(1.2, hit.t - 0.3) : reach;
        a.goal.copy(ch).addScaledVector(dir, Lg); a.dir = dir.clone(); a.stage = 'extend'; a.st = 0; a.dur = clamp(Lg / 15, 0.17, 0.46); for (let j = 0; j < 2; j++) a.from[j].copy(a.tip[j]); g.sfx.whoosh();
      }
    } else if (a.stage === 'extend') {
      const u = clamp(a.st / a.dur, 0, 1), e = easeOutCubic(u), L = _d.set(cos(y), 0, -sin(y));
      for (let j = 0; j < 2; j++) { const s = j === 0 ? 1 : -1; a.tip[j].lerpVectors(a.from[j], _a.copy(a.goal).addScaledVector(L, s * 0.22).addScaledVector(_b.set(0, 1, 0), j === 0 ? 0.12 : -0.12), e); }
      let contact = null; for (let j = 0; j < 2 && !contact; j++) for (const o of g.world.hittables) { if (o.dead || o.held || o.possessed || o.kind !== 'dummy' || !this.touchEnemy(o, a.tip[j], 0.75)) continue; contact = o; break; }
      if (contact) this.tentContact(a, contact);
      else if (u >= 1) { a.stage = 'retract'; a.st = 0; a.dur = 0.38; for (let j = 0; j < 2; j++) a.from[j].copy(a.tip[j]); }
    } else if (a.stage === 'pull' || a.stage === 'hold') {
      const h = a.holdObj; if (!h || h.dead) { this.dropHeld(a, false); a.stage = 'retract'; a.st = 0; a.dur = 0.38; for (let j = 0; j < 2; j++) a.from[j].copy(a.tip[j]); return; }
      const hold = _a.set(this.pos.x + sin(this.yaw) * 2.3, 0, this.pos.z + cos(this.yaw) * 2.3), dx = hold.x - h.home.x, dz = hold.z - h.home.z, d = Math.hypot(dx, dz);
      const sp = a.stage === 'pull' ? 13 : 20, m = Math.min(d, sp * dt); if (d > 1e-4) { h.home.x += dx / d * m; h.home.z += dz / d * m; }
      this.g.world.resolveXZ(h.home, 0.55, h.home.y, 2.2, 0.3); if (this.g.world.island) this.g.world.clampXZ(h.home, 1); else { h.home.x = clamp(h.home.x, -33, 33); h.home.z = clamp(h.home.z, -33, 33); }
      h.air = lerp(h.air, 0.55, 1 - Math.exp(-8 * dt)); h.airV = 0; h.kv.set(0, 0, 0); h.confuse = 1; h.held = true; h.collider.dead = true; h.slideV.set(0, 0, 0);
      const tc = this.targetChest(h, _b), L = _d.set(cos(y), 0, -sin(y));
      for (let j = 0; j < 2; j++) a.tip[j].copy(tc).addScaledVector(L, (j === 0 ? 1 : -1) * 0.34);
      if (a.stage === 'pull' && (d < 0.35 || a.st > 0.7)) { a.stage = 'hold'; a.st = 0; }
      else if (a.stage === 'hold' && a.st > 1.3) { this.throwHeld(a, true); }
    } else if (a.stage === 'retract') {
      const u = clamp(a.st / a.dur, 0, 1), e = sm(u); for (let j = 0; j < 2; j++) { this.restPos(j, _a); a.tip[j].lerpVectors(a.from[j], _a, e); } a.w = 1 - e;
      if (u >= 1) this.endAct();
    }
  },
  tentContact(a, o) {
    const g = this.g, tc = this.targetChest(o, new THREE.Vector3()), dir = _d.set(o.root.position.x - this.pos.x, 0, o.root.position.z - this.pos.z).normalize().clone(); this.stats.tentHits++;
    if (o instanceof Dummy && !o.held && !o.isBoss) {                                   // dummies and guards can be restrained
      this.hurtFoe(o, tc.clone(), dir, 8, 0, { tilt: 1.5 }); this.hitFX(tc.clone(), 1.0); this.stats.grabs++;
      a.holdObj = o; o.held = true; o.collider.dead = true; o.kv.set(0, 0, 0); o.confuse = 1; if (o.atk) o.atk = null; a.stage = 'pull'; a.st = 0; g.sfx.hit(false);
    } else {                                                               // turrets are machines: just a strike
      this.hurtFoe(o, tc.clone(), dir, 18, 0, {}); this.hitFX(tc.clone(), 1.1); a.stage = 'retract'; a.st = 0; a.dur = 0.38; for (let j = 0; j < 2; j++) a.from[j].copy(a.tip[j]);
    }
  },
  /** E again while holding = throw (modest, physically reasonable); timing out = a gentle release. Either way the host / dummy is back under its own control. */
  throwHeld(a, gentle = false) {
    const h = a.holdObj; if (!h) return; const dir = _a.set(sin(this.yaw), 0, cos(this.yaw)).clone(); this.dropHeld(a, true);
    if (gentle) { h.shove(dir, 3); h.launch(0.8); }
    else { h.thrown = 1; h.shove(dir, 14); h.launch(3.6); h.tiltV.x += rand(-4, 4); this.stats.throws++; this.g.sfx.whoosh(); this.hitFX(this.targetChest(h, _b).clone(), 0.8); }
    a.stage = 'retract'; a.st = 0; a.dur = 0.38; for (let j = 0; j < 2; j++) a.from[j].copy(a.tip[j]);
  },
  dropHeld(a, keepStun) {
    const h = a.holdObj; if (!h) return; a.holdObj = null; h.release(); if (h.stun !== undefined) h.stun = Math.max(h.stun, keepStun ? 0.6 : 0.3);
  },
  tentacleLayer(a) {
    const L = { d: {}, ik: {}, curl: {}, w: a.w }, mdl = this.rig.modelGroup;
    for (let j = 0; j < 2; j++) {
      const k = j === 0 ? 'L' : 'R', s = j === 0 ? 1 : -1, p = this.toModel(a.tip[j]);
      const out = _d.set(cos(this.yaw) * s, 0.9, -sin(this.yaw) * s).normalize(), pole = this.dirToModel(out, new THREE.Vector3());
      const raised = a.stage === 'raise';
      L.ik[k] = { p, pole, frame: 'w', ext: raised ? 1.035 : 1.32, thick: raised ? 1 : 1.12, hand: 1.12 }; L.curl[k] = a.stage === 'hold' || a.stage === 'pull' ? 0.9 : 0.15;
    }
    const lean = a.stage === 'extend' ? 0.14 : a.stage === 'raise' ? -0.1 : 0.06; L.d.spine = D(lean * 0.5, 0, 0); L.d.chest = D(lean * 0.6, 0, 0); L.d.head = D(-lean * 0.4, 0, 0);
    return L;
  },
  actLayer(dt) {
    const a = this.act; if (!a) return null; if (a.kind === 'claw') return this.clawLayer(a); if (a.kind === 'tentacle') return this.tentacleLayer(a); return null;
  },

  // ============================================================================================== per frame
  updatePowers(dt, aimPoint) {
    this.aimPt.copy(aimPoint); this.toastT = Math.max(0, this.toastT - dt); for (const k in this.cd) this.cd[k] = Math.max(0, this.cd[k] - dt);
    this.phaseK = damp(this.phaseK, this.phaseOn ? 1 : 0, 6, dt);
    const a = this.act; if (a) { if (a.kind === 'claw') this.updateClaw(dt, a); else if (a.kind === 'tentacle') this.updateTentacle(dt, a); }
    this.updateHint();
  },
  /** context line above the ability bar */
  updateHint() {
    const el = this.hintEl; if (!el) return; let txt = '';
    const P = this.poss, a = this.act;
    if (P && P.stage === 'active') txt = 'POSSESSING ' + P.host.name + ' — LMB baton · E blaster · Q exit';
    else if (a && a.kind === 'tentacle' && a.stage === 'hold') txt = 'E — THROW';
    else if (this.phaseOn) txt = 'INTANGIBLE — F to become solid (you will be moved out of walls)';
    else if (!P && this.cd.q <= 0) { let best = null, bd = POSS_RANGE; for (const o of this.g.guards) { if (o.dead || o.held || o.possessed) continue; const d = Math.hypot(o.root.position.x - this.pos.x, o.root.position.z - this.pos.z); if (d < bd) { bd = d; best = o; } } if (best && bd < 7) txt = 'Q — POSSESS ' + best.name; }
    if (txt !== this.hintTxt) { this.hintTxt = txt; el.textContent = txt; el.hidden = !txt; }
  },
  /** HUD: status lines + ability slots + bars (the DOM is only touched when something changed) */
  hudUpdate() {
    const set = (id, txt) => { const el = $(id); if (el && el.textContent !== txt) el.textContent = txt; }, cls = (id, c, on) => { const el = $(id); if (el) el.classList.toggle(c, !!on); };
    const S = this.g.stealth, inv = this.invis > 0.5, ph = this.phaseOn, ps = !!this.poss && this.poss.stage !== 'exit';
    set('gf-inv', 'INVISIBILITY: ' + (inv ? (S.reveal > 0 ? 'ON (REVEALED)' : 'ON') : 'OFF')); set('gf-phase', 'INTANGIBILITY: ' + (ph ? 'ON' : 'OFF'));
    set('gf-poss', 'POSSESSION: ' + (ps ? 'ACTIVE — ' + this.poss.host.name : 'INACTIVE'));
    cls('gf-inv', 'on', inv); cls('gf-phase', 'on', ph); cls('gf-poss', 'on', ps);
    const slot = (k, act, cd, mx) => { cls('gfslot-' + k, 'active', act); const el = $('gfcd-' + k); if (el) el.style.width = (cd > 0 ? cd / mx * 100 : 0) + '%'; }, a = this.act ? this.act.kind : '';
    slot('lmb', a === 'claw' || (this.poss && this.poss.stage === 'active' && this.poss.host.atk && this.poss.host.atk.kind === 'baton'), this.cd.lmb, GF_CD.lmb); slot('e', a === 'tentacle', this.cd.e, GF_CD.e); slot('q', ps, this.cd.q, GF_CD.q);
    slot('f', ph, this.cd.f, GF_CD.f); slot('sh', inv, 0, 1); slot('sp', this.an.vy > 1.5 || this.an.vy < -1.5, 0, 1);
    const hp = $('gf-hp'); if (hp) hp.style.width = (this.hp / 300 * 100) + '%';
    const nAl = this.g.guards.filter(o => !o.dead && !o.possessed && o.st === 'chase').length, ns = this.g.guards.filter(o => !o.dead && !o.possessed && o.st === 'search').length;
    set('gf-aware', S.hidden ? (nAl + ns ? 'UNSEEN · ' + (nAl + ns) + ' GUARD' + (nAl + ns > 1 ? 'S' : '') + ' SEARCHING' : 'UNSEEN') : (nAl ? 'SPOTTED · ' + nAl + ' GUARD' + (nAl > 1 ? 'S' : '') + ' ALERT' : ns ? 'HIDING · ' + ns + ' SEARCHING' : 'NOT DETECTED'));
    const aw = $('gf-awarebar'); if (aw) aw.classList.toggle('alert', nAl > 0 && !S.hidden);
  },
};
const _q0 = new THREE.Quaternion();
