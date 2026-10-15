// Heatblast powers, mixed into HbPlayer.prototype:
//   LMB Fire Blast (hand jet, aimed by the camera)  ·  Q Fireball (ballistic, explodes)  ·  E Flame Punch (3-hit combo, the fist really connects)
//   F Fire Wave (gather, low stance, ground-hugging wave)  ·  G Fire Protection (timed aura, contact burn)  ·  X flight (see heatblast.js)  ·  R Large Fire Burst (charged AoE)
// Every ability is a timed "act" with its own pose layer on top of the locomotion pose (FaPoser, two-bone IK for the hands), plus pooled particles / lights from fire.js.
// Damage / ignition go through the same hooks the other aliens use: Dummy.applyHit / shove / launch, PropSystem.hurt / damageWall / shockwave, FireSystem.
import * as THREE from 'three';
import { playerSegHit } from './kevin_fx.js';
import { clamp, damp, lerp, rand } from './util.js';
import { SIDE, V, hand, mkPose, arm, smooth, easeOut, K, D } from './fa_pose.js';
import { squat2 } from './heatblast.js';
import { FLAM } from './fire.js';

const $ = id => document.getElementById(id);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
export const HB_CD = { lmb: 0.2, q: 2.2, e: 1.1, f: 6.5, g: 9, r: 14 };
const SHOT_CAP = 28;

export const hbPowers = {
  initPowers(game) {
    this.act = null; this.tail = null; this.lastL = null; this.aimPt = new THREE.Vector3(0, 0, -20); this.lmbHeld = false; this.blastCd = 0;
    this.cd = { lmb: 0, q: 0, e: 0, f: 0, g: 0, r: 0 }; this.cdMax = HB_CD; this.prot = { on: false, k: 0, t: 0, dur: 10, tick: 0 };
    this.shots = []; this.waves = []; this.light = { intensity: 0 }; this.hintEl = $('hbhint'); this.punchCombo = 0; this.hitFlashT = 0;
    this.lastShotPos = new THREE.Vector3();
  },

  // ============================================================================================== helpers
  canStart() { return (!this.act || this.act.kind === 'blast') && this.mode !== 'crouch' && this.mode !== 'takeoff'; },
  beginAct(kind, extra) { this.tail = null; this.act = Object.assign({ kind, stage: 'start', t: 0, st: 0, w: 0, speedMul: 0.6, lockMove: false, moveVel: null, faceYaw: this.aimYaw(), faceK: 20, once: new Set() }, extra); return this.act; },
  setStage(a, s, extra) { a.stage = s; a.st = 0; if (extra) Object.assign(a, extra); },
  endAct(cdKey = null, cd = 0) { const a = this.act; if (!a) return; if (cdKey) this.cd[cdKey] = cd || HB_CD[cdKey]; if (this.lastL) this.tail = { L: this.lastL, t: 0.2 }; this.act = null; if (this.mode === 'crouch') this.mode = 'ground'; },
  cancelAll() {
    this.act = null; this.tail = null; this.lastL = null; this.lmbHeld = false; this.prot.on = false; this.prot.k = 0; this.prot.t = 0;
    for (const s of this.shots) if (s.mesh) { s.mesh.visible = false; } this.shots.length = 0; this.waves.length = 0; if (this.light) this.light.intensity = 0;
    if (this.hintEl) this.hintEl.hidden = true;
  },
  muzzle(out, k = 'UR') { return this.handTip(k, out); },
  /** direction from `from` to the crosshair target (falls back to the camera ray when the target is right in front of the hand) */
  aimFrom(from, out) {
    out.copy(this.aimPt).sub(from); if (out.lengthSq() < 4) out.copy(this.g.camera.aimDir); return out.normalize();
  },
  foes(maxD, cosMin = -1) {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), res = [];
    for (const h of this.g.world.hittables) {
      if (h.dead || h.held || h.kind !== 'dummy') continue; const dx = h.root.position.x - this.pos.x, dz = h.root.position.z - this.pos.z, d = Math.hypot(dx, dz); if (d > maxD || Math.abs(h.root.position.y - this.pos.y) > (this.flying ? 6 : 3)) continue;
      const dot = d > 0.05 ? (dx * fx + dz * fz) / d : 1; if (dot < cosMin) continue; res.push({ h, d, dot, score: d - dot * 3 });
    } return res.sort((a, b) => a.score - b.score);
  },
  boxAt(pt) { for (const b of this.g.world.boxes) if (pt.x > b.min.x - 0.2 && pt.x < b.max.x + 0.2 && pt.y > b.min.y - 0.2 && pt.y < b.max.y + 0.2 && pt.z > b.min.z - 0.2 && pt.z < b.max.z + 0.2) return b; return null; },
  groundY(x, z, y) { return this.g.world.groundAt(x, z, y + 1, 80, 0.3); },
  chestLocal(out) { return this.root.worldToLocal(out.setFromMatrixPosition(this.rig.bones.chest.matrixWorld)); },
  hurtFoe(h, pt, dir, dmg, kb, o = {}) {
    const g = this.g; h.applyHit(pt, dir.clone(), dmg); if (h.shove && kb) h.shove(dir, kb); if (o.launch && h.launch) h.launch(o.launch); g.hud.hit(pt, Math.round(dmg), h);
    if (o.ignite) g.fire.igniteDummy(h, o.ignite); this.stats.hits++;
  },
  shoveProp(p, dir, k) {
    if (p.planted || p.held) return; const P = this.g.props; P.removeBox(p); p.state = 'fly'; const m = k / Math.sqrt(p.mass / 40 + 1);
    p.vel.x += dir.x * m; p.vel.z += dir.z * m; p.vel.y = Math.max(p.vel.y, Math.min(8, m * 0.3)); p.spin.set(rand(-3, 3), rand(-3, 3), rand(-3, 3)); p.hit.clear(); p.dmgMul = 0.6;
  },
  propOk(p) { return !p.dead && !p.held && !p.temp; },

  // ============================================================================================== input
  keyDown(code) {
    switch (code) {
      case 'KeyQ': return this.startFireball(); case 'KeyE': return this.keyE(); case 'KeyF': return this.startWave(); case 'KeyG': return this.keyG();
      case 'KeyR': return this.startBurst(); case 'KeyX': return this.toggleFlight();
    }
  },
  keyUp() {},
  mouseDown() { this.lmbHeld = true; this.tryBlast(); },
  mouseUp() { this.lmbHeld = false; },
  keyE() {
    const a = this.act;
    if (a && a.kind === 'punch') { a.queued = true; return; }
    this.startPunch(0);
  },
  keyG() {
    if (this.prot.on) { this.endProtection(true); return; }
    if (this.cd.g > 0) { this.g.hud.toast('FIRE PROTECTION RECHARGING ' + this.cd.g.toFixed(0) + 's'); return; }
    if (!this.canStart()) return; const a = this.beginAct('guard', { speedMul: 0.9, flySpeedMul: 0.9 }); a.dur = 0.5; this.g.sfx.boom(0.4); this.g.sfx.flame(0.5);
  },

  // ============================================================================================== LMB: fire blast
  tryBlast() {
    if (this.blastCd > 0 || !this.canStart() || this.mode === 'takeoff') return;
    const chain = this.act && this.act.kind === 'blast'; this.blastCd = HB_CD.lmb; const a = this.beginAct('blast', { speedMul: 0.8, flySpeedMul: 0.9, noJump: false }); a.dur = 0.3; a.fired = false; a.recoil = 0; if (chain) a.t = 0.06;
  },
  updateBlast(dt, a) {
    this.stageTime(a, dt); a.faceYaw = this.aimYaw();
    if (!a.fired && a.t >= 0.05) { a.fired = true; this.fireBlast(); a.recoil = 1; }
    a.recoil = Math.max(0, a.recoil - dt * 6);
    if (this.lmbHeld && this.blastCd <= 0 && a.t >= 0.18) { this.tryBlast(); return; }
    if (a.t >= a.dur) this.endAct();
  },
  fireBlast() {
    const g = this.g, m = this.muzzle(_a), dir = this.aimFrom(m, _b); this.stats.blasts++;
    const s = this.spawnShot('blast', m, dir.clone().multiplyScalar(58), { dmg: 15, r: 0.45, life: 0.62, heat: 16, grav: 0 });
    for (let i = 0; i < 9; i++) g.fire.flame(_c.copy(m).addScaledVector(dir, rand(0, 0.5)), _d.copy(dir).multiplyScalar(rand(6, 16)).add(_e.set(rand(-1.2, 1.2), rand(-1, 1.5), rand(-1.2, 1.2))), rand(0.25, 0.5), rand(0.2, 0.4), 1.1);
    for (let i = 0; i < 3; i++) g.fire.spark(m, _d.copy(dir).multiplyScalar(rand(8, 18)).add(_e.set(rand(-3, 3), rand(-1, 3), rand(-3, 3))).clone(), rand(0.3, 0.5));
    g.fx.fire.emit({ pos: m, size: 1.6, life: 0.09, drag: 0, color: [1, 0.95, 0.65], alpha: 1 }); g.fire.lights.flash(m.clone(), [1, 0.6, 0.2], 14, 0.12, 12);
    g.sfx.flame(0.38); g.camera.addTrauma(0.03); void s;
  },
  spawnShot(kind, pos, vel, o) {
    if (this.shots.length >= SHOT_CAP) this.shots.shift();
    const s = Object.assign({ kind, pos: pos.clone(), prev: pos.clone(), vel: vel.clone(), life: 3, dmg: 10, r: 0.4, heat: 10, grav: 0, trail: 0, age: 0 }, o); this.shots.push(s); return s;
  },

  // ============================================================================================== Q: fireball
  startFireball() {
    if (this.cd.q > 0 || !this.canStart()) return;
    const a = this.beginAct('fireball', { speedMul: 0.45, flySpeedMul: 0.5, noJump: true }); a.charge = 0; this.g.sfx.charge(0.35);
  },
  updateFireball(dt, a) {
    this.stageTime(a, dt); a.faceYaw = this.aimYaw();
    if (a.stage === 'start') {
      a.charge = clamp(a.st / 0.38, 0, 1); const o = this.orbPos(_a);
      if (Math.random() < 0.9) this.g.fire.flame(_c.copy(o).add(_d.set(rand(-0.5, 0.5), rand(-0.5, 0.5), rand(-0.5, 0.5))), _e.set(rand(-1, 1), rand(0.5, 2), rand(-1, 1)), 0.25 + 0.5 * a.charge, 0.3, 1.2);
      if (a.st >= 0.38) { this.setStage(a, 'throw'); this.launchFireball(); }
    } else if (a.stage === 'throw') { if (a.st >= 0.32) this.endAct('q'); }
  },
  orbPos(out) { return out.copy(this.handTip('UL', _d)).add(this.handTip('UR', _e)).multiplyScalar(0.5).addScaledVector(UP, 0.05); },
  /** ballistic solution: lowest arc that reaches the crosshair target at the launch speed (falls back to a direct shot) */
  launchFireball() {
    const g = this.g, o = this.orbPos(_a).clone(), spd = 31, G = 11; const to = this.aimPt.clone().sub(o); const dx = Math.hypot(to.x, to.z), dy = to.y; let vel;
    const disc = spd ** 4 - G * (G * dx * dx + 2 * dy * spd * spd);
    if (dx > 2 && disc > 0) { const ang = Math.atan2(spd * spd - Math.sqrt(disc), G * dx); const h = _b.set(to.x, 0, to.z).normalize(); vel = new THREE.Vector3(h.x * Math.cos(ang) * spd, Math.sin(ang) * spd, h.z * Math.cos(ang) * spd); }
    else vel = this.aimFrom(o, _b).clone().multiplyScalar(spd);
    this.spawnShot('fireball', o, vel, { dmg: 40, r: 0.7, life: 4.5, heat: 60, grav: G });
    this.stats.fireballs++; g.sfx.boom(0.4); g.camera.addTrauma(0.12); g.camera.kick(0.03); g.fire.lights.flash(o.clone(), [1, 0.6, 0.2], 24, 0.2, 16);
    for (let i = 0; i < 14; i++) g.fire.flame(o, _c.copy(vel).normalize().multiplyScalar(rand(2, 9)).add(_d.set(rand(-2, 2), rand(-1, 2), rand(-2, 2))), rand(0.4, 0.8), rand(0.3, 0.5), 1.2);
  },

  // ============================================================================================== E: flame punch combo
  startPunch(idx) {
    if (idx === 0 && (this.cd.e > 0 || !this.canStart())) return; if (idx > 0 && this.act && this.act.kind !== 'punch') return;
    const fin = idx === 2, a = this.beginAct('punch', { speedMul: 0.5, flySpeedMul: 0.6, noJump: true, noBoost: true }); a.idx = idx; a.fin = fin; a.windT = fin ? 0.3 : 0.16; a.strikeT = fin ? 0.17 : 0.12; a.recT = fin ? 0.5 : 0.3; a.queued = false; a.hit = new Set(); a.hands = fin ? ['UL', 'UR'] : [idx ? 'UL' : 'UR'];
    const f = this.foes(5.5, 0.35)[0]; if (f) a.faceYaw = Math.atan2(f.h.root.position.x - this.pos.x, f.h.root.position.z - this.pos.z); else a.faceYaw = this.aimYaw();
    if (idx > 0) a.t = 0.06; a.faceK = 24; this.punchCombo = idx; this.g.sfx.flame(0.35); this.stats.punches++;
  },
  updatePunch(dt, a) {
    this.stageTime(a, dt); const g = this.g;
    if (a.stage === 'start') { if (a.st >= a.windT) { this.setStage(a, 'strike'); const sp = a.fin ? 9 : 6.5, fx = Math.sin(a.faceYaw), fz = Math.cos(a.faceYaw); g.sfx.whoosh(); if (this.flying) { this.vel.x += fx * sp * 0.8; this.vel.z += fz * sp * 0.8; } else a.moveVel = { x: fx * sp, z: fz * sp }; } }
    else if (a.stage === 'strike') {
      a.faceYaw = a.faceYaw; this.punchContacts(a);
      const k = a.st / a.strikeT; for (const hnd of a.hands) { const tip = this.handTip(hnd, _a); if (Math.random() < 0.9) g.fire.flame(tip, _b.set(rand(-1, 1), rand(0, 1.5), rand(-1, 1)), 0.45, 0.3, 1.2); }
      if (a.st >= a.strikeT) { if (!a.hit.size) this.punchWhiffAssist(a); this.setStage(a, 'recover'); a.moveVel = null; }
    } else if (a.stage === 'recover') {
      if (a.queued && a.idx < 2 && a.st > 0.07) { this.startPunch(a.idx + 1); return; }
      if (a.st >= a.recT) this.endAct('e', a.fin || !a.hit.size ? 1.1 : 0.35);
    }
  },
  /** the fist (hand tip) physically touches enemies / props / walls: the hit lands when the glove overlaps them during the strike */
  punchContacts(a) {
    const g = this.g, fwd = _d.set(Math.sin(a.faceYaw), 0, Math.cos(a.faceYaw)); let n = 0;
    for (const hnd of a.hands) {
      const tip = this.handTip(hnd, _a).clone();
      for (const h of g.world.hittables) {
        if (h.dead || h.held || h.kind !== 'dummy' || a.hit.has(h)) continue; const hp = h.root.position;
        if (Math.hypot(hp.x - tip.x, hp.z - tip.z) > 1.25 || tip.y < hp.y - 0.4 || tip.y > hp.y + 2.8) continue; this.punchHit(a, h, tip); n++;
      }
      for (const p of g.props.props) {
        if (!this.propOk(p) || a.hit.has(p)) continue; const hh = p.half; const qx = clamp(tip.x, p.pos.x - hh.x, p.pos.x + hh.x), qz = clamp(tip.z, p.pos.z - hh.z, p.pos.z + hh.z);
        if (Math.hypot(qx - tip.x, qz - tip.z) > 0.7 || tip.y < p.pos.y - 0.4 || tip.y > p.pos.y + p.size.h + 0.4) continue; a.hit.add(p); n++;
        const dir = _e.set(p.pos.x - this.pos.x, 0, p.pos.z - this.pos.z).normalize().clone(); this.shoveProp(p, dir, (a.fin ? 16 : 9)); g.props.impactFX(tip, 0.8, p.debris, a.fin); g.props.hurt(p, a.fin ? 40 : 18, dir);
        if (FLAM[p.kind]) g.fire.heatProp(p, a.fin ? 40 : 28); this.punchFX(tip, a.fin);
      }
      const w = g.props.nearestWall(this.pos, a.faceYaw, 2.5);
      if (w && !a.hit.has(w) && Math.hypot(clamp(tip.x, w.entry.min.x, w.entry.max.x) - tip.x, clamp(tip.z, w.entry.min.z, w.entry.max.z) - tip.z) < 0.7) { a.hit.add(w); g.props.damageWall(w, a.fin ? 55 : 22, tip.clone(), fwd.clone()); this.punchFX(tip, a.fin); n++; this.stats.walls = (this.stats.walls || 0) + 1; }
    }
    return n;
  },
  punchWhiffAssist(a) {
    // arm's-reach safety net: an enemy standing right in front of the chosen foe cone still gets hit (the lunge ends at his feet)
    const f = this.foes(2.3, 0.55)[0]; if (f && !a.hit.has(f.h)) this.punchHit(a, f.h, this.handTip(a.hands[0], _a).clone());
  },
  punchHit(a, h, tip) {
    const g = this.g, dir = _e.set(h.root.position.x - this.pos.x, 0, h.root.position.z - this.pos.z); if (dir.lengthSq() < 1e-4) dir.set(Math.sin(a.faceYaw), 0, Math.cos(a.faceYaw)); dir.normalize(); a.hit.add(h);
    const pt = new THREE.Vector3(h.root.position.x, Math.max(h.root.position.y + 1.4, 0.5), h.root.position.z);
    this.hurtFoe(h, pt, dir.clone(), a.fin ? 50 : 24, a.fin ? 26 : 12, { ignite: a.fin ? 5 : 3.5, launch: a.fin ? 5 : 1.5 }); this.punchFX(tip, a.fin);
  },
  punchFX(tip, big) {
    const g = this.g; g.fire.burst(tip, big ? 28 : 14, big ? 9 : 6, big ? 1.1 : 0.7, 0.5, 0.3); for (let i = 0; i < (big ? 12 : 5); i++) g.fire.spark(tip, _a.set(rand(-1, 1), rand(0, 1), rand(-1, 1)).normalize().multiplyScalar(rand(5, 12)).clone(), rand(0.3, 0.6));
    g.fx.fire.emit({ pos: tip, size: big ? 4.2 : 2.4, life: 0.12, drag: 0, color: [1, 0.9, 0.55], alpha: 1 }); g.fx.surface.ring(tip.clone(), V(0, 1, 0), big ? 6 : 3.2, 0.3, 0xff8a2a);
    g.fire.lights.flash(tip.clone(), [1, 0.6, 0.2], big ? 50 : 26, 0.2, big ? 20 : 14); g.camera.addTrauma(big ? 0.5 : 0.2); g.camera.kick(big ? 0.05 : 0.018); g.sfx.hit(!!big); g.sfx.flame(0.4);
  },

  // ============================================================================================== F: fire wave
  startWave() {
    if (this.cd.f > 0 || !this.canStart()) return;
    const a = this.beginAct('wave', { speedMul: 0, lockMove: true, noJump: true, noBoost: true }); a.charge = 0; this.g.sfx.charge(0.55);
  },
  updateWave(dt, a) {
    this.stageTime(a, dt); a.faceYaw = a.faceYaw0 ?? (a.faceYaw0 = this.aimYaw()); const g = this.g;
    if (a.stage === 'start') {
      a.charge = clamp(a.st / 0.55, 0, 1);
      for (const k of ['UL', 'UR']) if (Math.random() < 0.8) g.fire.flame(this.handTip(k, _a), _b.set(rand(-0.6, 0.6), rand(0.5, 1.8), rand(-0.6, 0.6)), 0.3 + 0.5 * a.charge, 0.35, 1.1);
      if (this.grounded && Math.random() < 0.6) g.fire.flame(_a.set(this.pos.x + rand(-1.2, 1.2), this.pos.y + 0.1, this.pos.z + rand(-1.2, 1.2)), _b.set(0, rand(1, 2.5), 0), 0.4, 0.4, 1);
      if (a.st >= 0.55) { this.setStage(a, 'release'); this.releaseWave(a); }
    } else if (a.stage === 'release') { if (a.st >= 0.2) this.setStage(a, 'recover'); }
    else if (a.stage === 'recover') { if (a.st >= 0.4) this.endAct('f'); }
  },
  releaseWave(a) {
    const g = this.g, gy = this.groundY(this.pos.x, this.pos.z, this.pos.y); this.stats.waves++; g.sfx.boom(0.55); g.camera.addTrauma(0.45); g.camera.kick(0.04);
    this.waves.push({ c: new THREE.Vector3(this.pos.x, gy, this.pos.z), yaw: a.faceYaw, r: 0.9, speed: 15.5, max: 13, half: 1.2, hit: new Set(), next: 3, y: gy });
    g.fx.surface.ring(new THREE.Vector3(this.pos.x, gy + 0.08, this.pos.z), UP, 7, 0.55, 0xff8a2a); g.fire.lights.flash(new THREE.Vector3(this.pos.x, gy + 1, this.pos.z), [1, 0.6, 0.2], 50, 0.5, 22);
    if (g.props) g.props.shockwave(this.waves[this.waves.length - 1].c, 3.5, 5, 0, 0);
  },
  updateWaves(dt) {
    const g = this.g, w0 = g.world;
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const W = this.waves[i], r0 = W.r; W.r += W.speed * dt; const r = W.r;
      if (r >= W.max) { this.waves.splice(i, 1); continue; }
      const arc = 2 * W.half * r, n = Math.min(20, Math.max(2, Math.round(arc * 0.75)));
      for (let k = 0; k < n; k++) {
        const ang = W.yaw + (Math.random() * 2 - 1) * W.half, dx = Math.sin(ang), dz = Math.cos(ang), px = W.c.x + dx * r, pz = W.c.z + dz * r;
        _a.set(W.c.x, W.y + 0.6, W.c.z); _b.set(dx, 0, dz); const blk = w0.raySolid(_a, _b, r); if (blk) continue;
        const gy = this.groundY(px, pz, W.y + 0.5); if (Math.abs(gy - W.y) > 1.6) continue;
        g.fire.flame(_c.set(px, gy + 0.15, pz), _d.set(dx * 3 + rand(-0.6, 0.6), rand(2.4, 5), dz * 3 + rand(-0.6, 0.6)), rand(0.8, 1.5), rand(0.45, 0.8), 1.2);
        if (Math.random() < 0.07) g.fire.smoke(_c.setY(gy + 0.9), _d.set(0, 2, 0), rand(1, 1.5), 1.4);
      }
      if (r >= W.next && W.next <= W.max - 2) { W.next += 3; for (let k = 0; k < 3; k++) { const ang = W.yaw + (Math.random() * 2 - 1) * W.half * 0.9; g.fire.groundFire(W.c.x + Math.sin(ang) * r, W.c.z + Math.cos(ang) * r, rand(1.1, 1.6), rand(3.2, 4.8), W.y, 7); } }
      g.fire.lights.flash(_c.set(W.c.x + Math.sin(W.yaw) * r, W.y + 0.8, W.c.z + Math.cos(W.yaw) * r), [1, 0.58, 0.2], 18, 0.1, 14);
      // damage as the front passes
      const reach = W.speed * dt + 1.0;
      for (const h of w0.hittables) {
        if (h.dead || h.held || h.kind !== 'dummy' || W.hit.has(h)) continue; const hp = h.root.position, dx = hp.x - W.c.x, dz = hp.z - W.c.z, d = Math.hypot(dx, dz); if (Math.abs(d - r) > reach || hp.y > W.y + 3) continue;
        const dd = Math.abs(((Math.atan2(dx, dz) - W.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI); if (dd > W.half + 0.12) continue; W.hit.add(h);
        const dir = _e.set(dx, 0, dz).normalize(); this.hurtFoe(h, new THREE.Vector3(hp.x, hp.y + 1.2, hp.z), dir.clone(), 30 * (1 - 0.4 * d / W.max), 16, { ignite: 4, launch: 3 });
        g.fire.burst(_c.set(hp.x, hp.y + 0.8, hp.z), 10, 5, 0.8, 0.5);
      }
      for (const p of g.props.props) {
        if (!this.propOk(p) || W.hit.has(p)) continue; const dx = p.pos.x - W.c.x, dz = p.pos.z - W.c.z, d = Math.hypot(dx, dz); if (Math.abs(d - r) > reach + Math.max(p.half.x, p.half.z) || p.pos.y > W.y + 3) continue;
        const dd = Math.abs(((Math.atan2(dx, dz) - W.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI); if (dd > W.half + 0.2) continue; W.hit.add(p);
        _e.set(dx, 0, dz).normalize(); if (FLAM[p.kind]) g.fire.heatProp(p, 36); if (p.mass < 300) this.shoveProp(p, _e.clone(), 9); g.props.hurt(p, 14, _e.clone());
      }
    }
  },

  // ============================================================================================== G: fire protection
  endProtection(early) {
    const P = this.prot; if (!P.on) return; P.on = false; this.cd.g = early ? HB_CD.g * 0.6 : HB_CD.g; this.g.hud.toast('FIRE PROTECTION ENDED');
  },
  updateGuard(dt, a) {
    this.stageTime(a, dt);
    if (!a.done && a.t >= 0.28) { a.done = true; const P = this.prot; P.on = true; P.t = 0; this.stats.prot++; this.g.hud.toast('FIRE PROTECTION'); this.g.fx.surface.ring(new THREE.Vector3(this.pos.x, this.pos.y + 0.08, this.pos.z), UP, 7, 0.5, 0xffa040); this.g.camera.addTrauma(0.15); }
    if (a.t >= a.dur) this.endAct();
  },
  updateProtection(dt) {
    const P = this.prot, g = this.g; P.k = damp(P.k, P.on ? 1 : 0, P.on ? 6 : 4, dt);
    if (!P.on) return; P.t += dt; if (P.t >= P.dur) { this.endProtection(false); return; }
    P.tick -= dt; if (P.tick > 0) return; P.tick = 0.25;
    for (const h of g.world.hittables) {         // anything that touches him burns
      if (h.dead || h.held || h.kind !== 'dummy') continue; const hp = h.root.position, dx = hp.x - this.pos.x, dz = hp.z - this.pos.z, d = Math.hypot(dx, dz); if (d > 2.7 || Math.abs(hp.y - this.pos.y) > 3.2) continue;
      _e.set(dx, 0, dz).normalize(); this.hurtFoe(h, _c.set(hp.x, hp.y + 1.3, hp.z).clone(), _e.clone(), 5, 3.2, { ignite: 3 });
    }
    for (const p of g.props.props) { if (!this.propOk(p) || !FLAM[p.kind]) continue; const d = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) - Math.max(p.half.x, p.half.z); if (d < 1.6 && Math.abs(p.pos.y - this.pos.y) < 3) g.fire.heatProp(p, 8); }
  },

  // ============================================================================================== R: large fire burst
  startBurst() {
    if (this.cd.r > 0) { if (this.cd.r > 0 && this.canStart()) this.g.hud.toast('LARGE FIRE BURST RECHARGING ' + this.cd.r.toFixed(0) + 's'); return; } if (!this.canStart()) return;
    const a = this.beginAct('burst', { speedMul: 0, lockMove: true, noJump: true, noBoost: true, faceYaw: this.yaw }); a.charge = 0; a.faceYaw = this.yaw; a.fixed = true; this.g.sfx.charge(1.2);
  },
  updateBurst(dt, a) {
    this.stageTime(a, dt); const g = this.g;
    if (a.stage === 'start') {
      a.charge = clamp(a.st / 1.2, 0, 1); const c = a.charge;
      for (let i = 0; i < 4; i++) {       // fire spirals inward and rises along the body
        const ang = rand(0, 6.283), rad = (2.8 - 1.9 * c) * rand(0.6, 1.2);
        g.fire.flame(_a.set(this.pos.x + Math.cos(ang) * rad, this.pos.y + rand(0.1, 2.4), this.pos.z + Math.sin(ang) * rad), _b.set(-Math.cos(ang) * 4 + Math.sin(ang) * 3, rand(1, 4), -Math.sin(ang) * 4 - Math.cos(ang) * 3), rand(0.4, 0.9), rand(0.35, 0.6), 1.3);
      }
      if (c > 0.3 && Math.random() < 0.5) g.fire.spark(_a.set(this.pos.x, this.pos.y + 1.2, this.pos.z), _b.set(rand(-4, 4), rand(2, 8), rand(-4, 4)).clone(), 0.6);
      g.camera.addTrauma(dt * (0.2 + 0.7 * c)); if (this.flying) this.vel.y *= Math.exp(-5 * dt);
      if (a.st >= 1.2) { this.setStage(a, 'release'); this.releaseBurst(); }
    } else if (a.stage === 'release') { if (a.st >= 0.3) this.setStage(a, 'recover'); }
    else if (a.stage === 'recover') { if (a.st >= 0.6) this.endAct('r'); }
  },
  releaseBurst() {
    const g = this.g, c = _a.set(this.pos.x, this.pos.y + 1.2, this.pos.z).clone(), gy = this.groundY(c.x, c.z, c.y); this.stats.bursts++;
    g.fire.explode(c, 12, 85, 26, { big: true, heat: 85, wall: 0.8, prop: 1.0, kbMul: 1, scorch: 1.5, noRing: false });
    g.fx.surface.ring(new THREE.Vector3(c.x, gy + 0.1, c.z), UP, 20, 0.7, 0xffb050); g.fx.surface.ring(new THREE.Vector3(c.x, gy + 0.14, c.z), UP, 11, 0.5, 0xff6a20);
    for (let i = 0; i < 70; i++) { const ang = rand(0, 6.283), sp = rand(8, 20); g.fire.flame(c, _b.set(Math.cos(ang) * sp, rand(-1, 6), Math.sin(ang) * sp), rand(0.8, 1.6), rand(0.5, 0.9), 1.3); }
    if (gy < this.pos.y + 3) for (let i = 0; i < 6; i++) { const ang = i * 1.047 + rand(-0.3, 0.3), d = rand(4, 9); g.fire.groundFire(c.x + Math.cos(ang) * d, c.z + Math.sin(ang) * d, rand(1.2, 1.9), rand(3.5, 5.5), gy, 8); }
    g.camera.addTrauma(0.95); g.camera.kick(0.09); g.sfx.boom(1); const e = $('firefx'); if (e) { e.style.transition = 'none'; e.style.opacity = '0.9'; requestAnimationFrame(() => { e.style.transition = 'opacity 0.8s'; e.style.opacity = '0'; }); }
    this.burstPulse = 1;
  },

  // ============================================================================================== projectiles
  /** own = false: the player's shots (run in player time from updatePowers); own = true: shots fired by an AI owner (Kevin) - run in WORLD time every frame, whatever alien is active */
  updateShots(dt0, own = false) {
    const g = this.g, w = g.world;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      if (!!this.shots[i].owner !== own) continue;
      const s = this.shots[i], dt = own ? (g.kdt ?? dt0) : dt0; s.life -= dt; s.age += dt; if (s.life <= 0) { if (s.kind === 'fireball') this.fireballBoom(s, s.pos, null); this.shots.splice(i, 1); continue; }
      const sub = clamp(Math.ceil(s.vel.length() * dt / 0.7), 1, 8), h = dt / sub; let done = false;
      for (let k = 0; k < sub && !done; k++) {
        s.prev.copy(s.pos); s.pos.addScaledVector(s.vel, h); s.vel.y -= s.grav * h; const seg = _b.copy(s.pos).sub(s.prev), len = seg.length(); if (len < 1e-6) continue; const dir = _c.copy(seg).multiplyScalar(1 / len);
        // earliest of: solid (walls / props / ground), foes (sphere test along the segment)
        let tHit = Infinity, kind = null, target = null; const sh = w.raySolid(s.prev, dir, len); if (sh) { tHit = sh.t; kind = 'solid'; }
        for (const hh of w.hittables) {
          if (hh.dead || hh.held || (s.owner && hh === s.owner)) continue;
          for (const sp of hh.spheres) {
            _d.copy(sp.local); hh.root.localToWorld(_d); _e.copy(_d).sub(s.prev); const tt = clamp(_e.dot(dir), 0, len); if (_e.addScaledVector(dir, -tt).length() < sp.r + s.r * 0.8 && tt < tHit) { tHit = tt; kind = 'foe'; target = hh; }
          }
        }
        if (s.owner) { const pp = playerSegHit(g, s.prev, s.pos, s.r * 0.8); if (pp && pp.t * len < tHit) { tHit = pp.t * len; kind = 'player'; } }
        if (!kind && s.pos.y < w.groundAt(s.pos.x, s.pos.z, s.pos.y + 0.5, 0.6, 0.1)) { kind = 'solid'; tHit = len; }
        if (kind) { const pt = s.prev.clone().addScaledVector(dir, Math.min(tHit, len)); this.shotHit(s, kind, pt, dir.clone(), kind === 'solid' ? (sh ? sh.normal : UP) : null, target); this.shots.splice(i, 1); done = true; }
      }
      if (done) continue;
      // trail
      s.trail -= dt; const fb = s.kind === 'fireball';
      if (s.trail <= 0) {
        s.trail = fb ? 0.012 : 0.016;
        if (fb) { for (let j = 0; j < 3; j++) g.fire.flame(_a.copy(s.pos).add(_b.set(rand(-0.4, 0.4), rand(-0.4, 0.4), rand(-0.4, 0.4))), _c.set(rand(-1, 1) - s.vel.x * 0.08, rand(-0.5, 1.2), rand(-1, 1) - s.vel.z * 0.08), rand(0.6, 1.1), rand(0.3, 0.55), 1.2); if (Math.random() < 0.6) g.fire.smoke(s.pos, _c.set(rand(-0.5, 0.5), rand(0, 1), rand(-0.5, 0.5)), rand(0.7, 1.1), 1.3); if (Math.random() < 0.4) g.fire.spark(s.pos, _c.set(rand(-3, 3), rand(-2, 3), rand(-3, 3)).clone(), 0.4); g.fx.fire.emit({ pos: s.pos, size: 1.9, life: 0.05, drag: 0, color: [1, 0.85, 0.45], alpha: 1 }); g.fire.lights.flash(s.pos, [1, 0.58, 0.2], 22, 0.1, 15); }
        else { g.fire.flame(s.pos, _c.set(rand(-1, 1), rand(-0.5, 1), rand(-1, 1)), rand(0.3, 0.55), rand(0.18, 0.3), 1.2); g.fx.fire.emit({ pos: s.pos, size: 0.8, life: 0.05, drag: 0, color: [1, 0.9, 0.6], alpha: 1 }); }
      }
    }
  },
  shotHit(s, kind, pt, dir, normal, target) {
    const g = this.g, P = g.props;
    if (s.kind === 'fireball') { this.fireballBoom(s, pt, normal); return; }
    if (kind === 'player') { const res = g.impact.hitPlayer(Object.assign({}, s.imp, { dir: dir.clone().setY(0), point: pt.clone(), src: s.owner })); g.fire.burst(pt, 8, 4, 0.5, 0.35); if (s.owner.onPlayerHit && !(res && res.passed)) s.owner.onPlayerHit(s.imp.name || 'fireBlast', res); return; }
    this.stats.hitsBlast = (this.stats.hitsBlast || 0) + 1;
    g.fire.burst(pt, 8, 4, 0.5, 0.35); for (let i = 0; i < 4; i++) g.fire.spark(pt, _a.set(rand(-1, 1), rand(0.2, 1), rand(-1, 1)).normalize().multiplyScalar(rand(4, 9)).clone(), rand(0.3, 0.5));
    g.fx.fire.emit({ pos: pt, size: 1.7, life: 0.1, drag: 0, color: [1, 0.9, 0.6], alpha: 1 }); g.fire.lights.flash(pt.clone(), [1, 0.6, 0.2], 14, 0.15, 11); g.sfx.hit(false);
    if (kind === 'foe') { this.hurtFoe(target, pt, dir.clone().setY(0).normalize(), s.dmg, 6, { ignite: 3 }); g.camera.addTrauma(0.06); return; }
    // solid: what did we hit?
    const b = this.boxAt(_b.copy(pt).addScaledVector(dir, 0.15)) || this.boxAt(pt);
    if (b && b.prop) { const p = b.prop; if (FLAM[p.kind]) g.fire.heatProp(p, s.heat); P.hurt(p, 7, dir.clone()); P.impactFX(pt, 0.4, p.debris); }
    else if (b && b.wall) P.damageWall(b.wall, 7, pt.clone(), dir.clone());
    if (normal && normal.y > 0.7) g.fire.scorchAt(pt.x, pt.y, pt.z, 0.55, 5);
  },
  fireballBoom(s, pt, normal) {
    const g = this.g, c = pt.clone(); if (normal) c.addScaledVector(normal, 0.5);
    g.fire.explode(c, 5.8, s.dmg + 20, 15, { heat: s.heat, wall: 0.55, prop: 0.8, big: true, kbMul: 1, owner: s.owner, imp: s.imp });
    const gy = this.groundY(c.x, c.z, c.y); if (c.y - gy < 2.5) g.fire.groundFire(c.x + rand(-0.8, 0.8), c.z + rand(-0.8, 0.8), 1.7, 4.2, gy, 8);
    this.stats.hitsBall = (this.stats.hitsBall || 0) + 1;
  },

  // ============================================================================================== damage taken (turret bolts etc.)
  hitSphere: { y: 1.2, r: 1.2 },
  onHit(dmg, pt, dir) {
    const g = this.g; let d = dmg; if (this.prot.on) { d *= 0.5; g.fire.burst(pt, 8, 4, 0.5, 0.3); g.fire.lights.flash(pt.clone(), [1, 0.6, 0.2], 14, 0.12, 10); g.sfx.flame(0.3); } else g.hud.hurt();
    g.camera.addTrauma(this.prot.on ? 0.1 : 0.3); this.hp = Math.max(0, this.hp - d); this.hpT = 4; if (this.hp <= 0) { this.hp = HCFG_HP * 0.6; g.hud.toast('SECOND WIND'); }
  },

  // ============================================================================================== per frame
  updatePowers(dt, aimPoint) {
    this.aimPt.copy(aimPoint); for (const k in this.cd) if (this.cd[k] > 0) this.cd[k] = Math.max(0, this.cd[k] - dt);
    if (this.blastCd > 0) this.blastCd -= dt; if (this.hpT > 0) this.hpT -= dt; else if (this.hp < HCFG_HP) this.hp = Math.min(HCFG_HP, this.hp + 30 * dt);
    const a = this.act;
    if (a) ({ blast: this.updateBlast, fireball: this.updateFireball, punch: this.updatePunch, wave: this.updateWave, burst: this.updateBurst, guard: this.updateGuard })[a.kind].call(this, dt, a);
    if (!this.act && this.lmbHeld) this.tryBlast();                                    // hold LMB: automatic fire; every click is also handled instantly in mouseDown
    this.updateShots(dt); this.updateWaves(dt); this.updateProtection(dt);
    if (this.burstPulse > 0) this.burstPulse = Math.max(0, this.burstPulse - dt * 2);
    // hint line
    if (this.hintEl) {
      let txt = ''; if (this.flying) txt = 'FLYING  ALT ' + Math.max(0, this.alt).toFixed(0) + ' m   ·   SPACE ascend   CTRL descend   SHIFT boost   X land'; else if (this.softLand) txt = 'LANDING…';
      if (this.hintEl.textContent !== txt) this.hintEl.textContent = txt; this.hintEl.hidden = !txt;
    }
  },

  // ============================================================================================== pose layers
  actLayer(dt) {
    let L = null; const a = this.act;
    if (a) { a.w = 1; L = ({ blast: this.blastLayer, fireball: this.fireballLayer, punch: this.punchLayer, wave: this.waveLayer, burst: this.burstLayer, guard: this.guardLayer })[a.kind].call(this, a); }
    if (L) { this.lastL = L; this.tail = null; return L; }
    if (this.tail) { this.tail.t -= dt; if (this.tail.t <= 0) { this.tail = null; return null; } const T = this.tail.L; T.w = smooth(this.tail.t / 0.2); return T; }
    return null;
  },
  /** aim direction / point in the character's local frame */
  localDir(from, out) { return out.copy(this.aimFrom(from, _e)).transformDirection(_inv.copy(this.root.matrixWorld).invert()); },
  blastLayer(a) {
    const L = mkPose(); L.w = clamp(a.t / 0.06, 0, 1) * (a.t > a.dur - 0.1 ? clamp((a.dur - a.t) / 0.1, 0, 1) : 1);
    const C = this.chestLocal(new THREE.Vector3()), mz = this.muzzle(_a, 'UR'); const dl = this.localDir(mz, new THREE.Vector3()), sh = C.clone().add(V(-0.28, 0.12, 0.05));
    const p = sh.clone().addScaledVector(dl, 0.82 - 0.14 * a.recoil); arm(L, 'UR', p, V(-1, -0.45, -0.25), 0, 'w'); L.curl.UR = 0.05;
    arm(L, 'UL', hand('UL', 0.55, -0.35, 0.28), hand('UL', 1, -0.6, -0.3), 0, 'c', 0.9); L.curl.UL = 0.7;
    L.d.spine = D(-0.06 * a.recoil, -0.18, 0); L.d.chest = D(-0.08 * a.recoil, -0.2, 0); L.d.hips = D(0, 0.08, 0); return L;
  },
  fireballLayer(a) {
    const L = mkPose(); L.w = clamp(a.t / 0.08, 0, 1); const u = smooth(a.st / (a.stage === 'start' ? 0.38 : 0.28));
    if (a.stage === 'start') {
      for (const k of ['UL', 'UR']) { arm(L, k, hand(k, lerp(0.32, 0.12, u), lerp(-0.4, -0.05, u), lerp(0.3, 0.6, u)), hand(k, 1, -0.7, -0.4)); L.curl[k] = 0.25; }
      L.d.spine = D(-0.12 * u, 0, 0); L.d.chest = D(-0.1 * u, 0, 0); L.d.head = D(0.08 * u, 0, 0); const q = this.grounded ? 0.3 * u : 0; if (q > 0.01) squat2(L, q, 0.9, 0.1);
    } else {
      const C = this.chestLocal(new THREE.Vector3()), mz = this.muzzle(_a, 'UR'), dl = this.localDir(mz, new THREE.Vector3());
      const e = easeOut(u); for (const k of ['UL', 'UR']) { const sh = C.clone().add(V(SIDE[k] * 0.28, 0.12, 0.05)); arm(L, k, sh.addScaledVector(dl, lerp(0.35, 0.95, e)), V(SIDE[k], -0.6, -0.4), 0, 'w'); L.curl[k] = 0.1; }
      L.d.spine = D(0.28 * e, 0, 0); L.d.chest = D(0.2 * e, 0, 0); if (this.grounded) squat2(L, 0.3 * (1 - e), 0.9, 0.1);
    }
    return L;
  },
  punchLayer(a) {
    const L = mkPose(); L.w = clamp(a.t / 0.06, 0, 1); const side = a.fin ? 0 : (a.idx ? 1 : -1);        // -1: right hand punches (torso winds to the right), +1: left
    let wind = 0, strike = 0;
    if (a.stage === 'start') wind = smooth(a.st / a.windT); else if (a.stage === 'strike') { wind = 1 - smooth(a.st / (a.strikeT * 0.6)); strike = smooth(a.st / (a.strikeT * 0.9)); } else { strike = 1 - smooth(a.st / a.recT); }
    for (const k of ['UL', 'UR']) {
      const act = a.hands.includes(k); let p;
      if (act) { const Hm = hand(k, 0.35, -0.35, 0.2), Hw = a.fin ? hand(k, 0.4, 0.55, -0.15) : hand(k, 0.32, -0.12, -0.28), Hs = a.fin ? hand(k, 0.28, -0.35, 1.55) : hand(k, 0.14, 0.06, 1.45); p = Hm.clone().lerp(Hw, wind).lerp(Hs, strike); }
      else p = hand(k, 0.45, -0.3, 0.3 + 0.3 * strike);
      arm(L, k, p, hand(k, 1.1, -0.6, -0.5)); L.curl[k] = act ? 1 : 0.7;
    }
    L.d.spine = D(0.12 * strike + 0.05 * wind, side * (0.25 * wind - 0.2 * strike), 0); L.d.chest = D(0.2 * strike, side * (0.5 * wind - 0.45 * strike), 0); L.d.hips = D(0.1 * strike, side * (0.2 * wind - 0.15 * strike), 0);
    if (a.fin) { L.d.spine = D(-0.25 * wind + 0.5 * strike, 0, 0); L.d.chest = D(-0.2 * wind + 0.35 * strike, 0, 0); }
    if (this.grounded) { const q = 0.18 * wind + 0.12 * strike + (a.fin ? 0.15 * wind : 0); if (q > 0.01) squat2(L, q, 0.9, 0.12); }
    return L;
  },
  waveLayer(a) {
    const L = mkPose(); L.w = clamp(a.t / 0.1, 0, 1); const g = this.grounded;
    if (a.stage === 'start') {
      const u = smooth(a.st / 0.55); for (const k of ['UL', 'UR']) { arm(L, k, hand(k, lerp(0.4, 0.55, u), lerp(-0.5, -1.05, u), lerp(0.1, -0.25, u)), hand(k, 1, -0.5, -0.6)); L.curl[k] = 0.4 + 0.3 * u; }
      L.d.spine = D(0.45 * u, 0, 0); L.d.chest = D(0.25 * u, 0, 0); L.d.head = D(-0.25 * u, 0, 0); if (g) squat2(L, 0.95 * u, 0.9, 0.22);
    } else {
      const u = smooth(a.st / (a.stage === 'release' ? 0.2 : 0.4)), r = a.stage === 'release' ? u : 1;
      for (const k of ['UL', 'UR']) { const A = hand(k, 0.55, -1.05, -0.25), B = hand(k, 1.15, -0.35, 1.0); arm(L, k, a.stage === 'release' ? A.lerp(B, r) : B.lerp(hand(k, 0.45, -0.6, 0.2), u), hand(k, 1, -0.5, -0.5)); L.curl[k] = 0; }
      const q = a.stage === 'release' ? 0.95 * (1 - 0.3 * r) : 0.66 * (1 - u); L.d.spine = D(a.stage === 'release' ? 0.45 - 0.25 * r : 0.2 * (1 - u), 0, 0); L.d.chest = D(0.1 * (1 - u), 0, 0); if (g) squat2(L, q, 0.9, 0.22);
    }
    return L;
  },
  burstLayer(a) {
    const L = mkPose(); L.w = clamp(a.t / 0.12, 0, 1);
    if (a.stage === 'start') {
      const u = smooth(a.st / 1.2), sh = Math.sin(a.st * 55) * 0.012 * u;
      for (const k of ['UL', 'UR']) { arm(L, k, hand(k, lerp(0.45, 0.3, u) + sh, lerp(-0.4, 0.95, u), lerp(0.1, 0.12, u)), hand(k, 1.2, 0.0, -0.4)); L.curl[k] = 0.6 * u; }
      L.d.spine = D(-0.3 * u, 0, 0); L.d.chest = D(-0.3 * u, 0, 0); L.d.head = D(-0.2 * u, 0, 0); if (this.grounded) squat2(L, 0.3 * u, 0.9, 0.2);
    } else {
      const u = a.stage === 'release' ? smooth(a.st / 0.2) : 1 - smooth(a.st / 0.6); const e = a.stage === 'release' ? u : 0.2 + 0.8 * u;
      for (const k of ['UL', 'UR']) { arm(L, k, hand(k, lerp(0.3, 1.15, e), lerp(0.95, 0.15, e), lerp(0.12, 0.35, e)), hand(k, 1.4, -0.2, -0.2)); L.curl[k] = 0; }
      L.d.spine = D(-0.3 + 0.55 * e - 0.25, 0, 0); L.d.chest = D(-0.3 + 0.5 * e - 0.2, 0, 0); if (this.grounded) squat2(L, 0.3 * (1 - e) + 0.2 * e, 0.9, 0.2);
    }
    return L;
  },
  guardLayer(a) {
    const L = mkPose(); L.w = clamp(a.t / 0.1, 0, 1) * clamp((a.dur - a.t) / 0.15, 0, 1) ; const u = K(a.t, [[0, 0], [0.2, 1], [0.5, 0.6]]);
    for (const k of ['UL', 'UR']) { arm(L, k, hand(k, 0.15 + 0.85 * u, -0.5 + 0.7 * u, 0.2), hand(k, 1.4, -0.5, -0.5)); L.curl[k] = 0.1; }
    L.d.chest = D(-0.22 * u, 0, 0); L.d.spine = D(-0.1 * u, 0, 0); L.d.head = D(-0.2 * u, 0, 0); return L;
  },
  stageTime(a, dt) { a.t += dt; a.st += dt; },
};
const _inv = new THREE.Matrix4();
const HCFG_HP = 300;
