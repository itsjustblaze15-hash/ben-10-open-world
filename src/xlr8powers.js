// XLR8 powers for the later phases, mixed into XlrPlayer.prototype:
//   Q Speed Dash · E Spin Attack · F Speed Clones · G Speed Throw · X Hyper Drive · Z Slide  (+ wall-run / water-run live in xlr8.js physics)
// Every power is a scripted "act" with its own stages, its own pose layer and its own damage rules. They run on PLAYER time,
// while the targets they hit react on WORLD time (so all of them also work during Time Slow).
import * as THREE from 'three';
import { buildXlr8Rig } from '../animations/xlr8rig.js';
import { XLR8_SCALE } from '../animations/xlr8rig.js';
import { clamp, rand, angleDelta } from './util.js';

const TAU = Math.PI * 2, UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _e = new THREE.Vector3();
export const CD = { q: 2.0, e: 3.0, f: 6.0, g: 4.0, x: 12.0 };

export const powers = {
  initPowers(gltfScene, count = 7) {
    this.act = null; this.cdMax = CD;
    this.ghosts = [];
    for (let i = 0; i < count; i++) {
      const r = buildXlr8Rig(gltfScene), grp = new THREE.Group(); r.modelGroup.scale.setScalar(XLR8_SCALE); grp.add(r.modelGroup); grp.visible = false; this.g.scene.add(grp);
      const mat = new THREE.MeshBasicMaterial({ color: 0x4db8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      for (const sm of r.skinned) { sm.material = mat; sm.castShadow = false; sm.receiveShadow = false; }
      this.ghosts.push({ rig: r, grp, mat, t: 0, life: 0, a0: 0 });
    }
    this.ghostN = 0;
  },
  /** copy the current pose into a pooled translucent afterimage */
  ghost(life = 0.6, a0 = 0.55) {
    if (!this.ghosts.length) return; const G = this.ghosts[this.ghostN++ % this.ghosts.length], src = this.rig, dst = G.rig;
    for (const n in src.bones) dst.bones[n].quaternion.copy(src.bones[n].quaternion);
    dst.modelGroup.position.copy(src.modelGroup.position); dst.modelGroup.rotation.copy(src.modelGroup.rotation);
    G.grp.position.copy(this.pos); G.grp.rotation.copy(this.root.rotation); G.grp.visible = true; G.life = life; G.t = 0; G.a0 = a0; G.mat.opacity = a0; G.grp.updateMatrixWorld(true);
  },
  updateGhosts(dt) { for (const G of this.ghosts) { if (!G.grp.visible) continue; G.t += dt; const k = G.t / G.life; if (k >= 1) { G.grp.visible = false; continue; } G.mat.opacity = G.a0 * (1 - k) * (1 - k); } },

  // ------------------------------------------------------------------------------------------------ input
  powerKey(code) {
    if (code === 'KeyZ') return this.startSlide();
    const k = ({ KeyQ: 'q', KeyE: 'e', KeyF: 'f', KeyG: 'g', KeyX: 'x' })[code]; if (!k) return;
    if (this.act || this.combo || this.mode === 'wall' || this.mode === 'slide' || this.mode === 'crouch') return;
    if (this.mode !== 'ground' && this.mode !== 'air') return;
    if (this.cd[k] > 0) { this.g.hud.toast('RECHARGING ' + this.cd[k].toFixed(1) + 's'); return; }
    if (k !== 'q' && k !== 'e' && !this.grounded) return;
    ({ q: this.startDash, e: this.startSpin, f: this.startClones, g: this.startThrow, x: this.startHyper })[k].call(this);
  },
  camDir(out = _a) { const y = this.g.camera.yaw; return out.set(-Math.sin(y), 0, -Math.cos(y)); },
  begin(kind, extra) { this.act = Object.assign({ kind, stage: 'start', t: 0, moveVel: null, faceYaw: this.yaw, hits: new Set() }, extra); this.trailBoost = 1; return this.act; },
  endAct(key) { this.cd[key] = this.cdMax[key]; this.act = null; },

  /** damage + momentum to every living hittable within `r` (horizontal) of c. dirFn: radial (default) or a fixed direction */
  burst(c, r, dmg, push, launch, fixedDir = null, once = null, final = false) {
    const g = this.g; let n = 0;
    for (const h of g.world.hittables) {
      if (h.dead || (once && once.has(h)) || h.held) continue; const hp = h.root.position, dx = hp.x - c.x, dz = hp.z - c.z, d = Math.hypot(dx, dz);
      if (d > r || Math.abs(hp.y - c.y) > 3.2) continue;
      const dir = fixedDir ? _b.copy(fixedDir) : _b.set(dx, 0, dz); if (dir.lengthSq() < 1e-4) dir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); dir.normalize();
      const pt = _c.set(hp.x, hp.y + 1.3 + rand(-0.2, 0.2), hp.z).clone();
      h.applyHit(pt, dir.clone(), dmg); if (h.shove) h.shove(dir, push); if (launch && h.launch) h.launch(launch);
      g.hud.hit(pt, dmg, h); this.hitFX(pt, dir, final); this.stats.hits++; this.pstats.hits++; n++; if (once) once.add(h);
    }
    if (n) { g.camera.addTrauma(final ? 0.7 : 0.1); g.sfx.hit(final); }
    return n;
  },
  nearest(maxD, needFront = false) {
    let best = null, bd = 1e9; const f = this.camDir(_e);
    for (const h of this.g.world.hittables) {
      if (h.dead || (h.kind !== 'dummy' && !h.isBoss) || h.held || h.present === false) continue; const dx = h.root.position.x - this.pos.x, dz = h.root.position.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d > maxD || d < 0.01) continue; if (needFront && (dx * f.x + dz * f.z) / d < 0.2) continue;
      const s = d - (needFront ? 6 * (dx * f.x + dz * f.z) / d : 0); if (s < bd) { bd = s; best = h; }
    }
    return best;
  },

  // ------------------------------------------------------------------------------------------------ Q  SPEED DASH
  startDash() {
    const dir = this.camDir(new THREE.Vector3()), a = this.begin('dash', { dir, stage: 'crouch', speed: 46, last: this.pos.clone(), stuck: 0 }); a.faceYaw = Math.atan2(dir.x, dir.z);
    this.pstats.dash++; this.g.sfx.whoosh();
  },
  updateDash(dt, a, R) {
    if (a.stage === 'crouch') { this.crouchPose(R, a.t / 0.12); if (a.t >= 0.12) { a.stage = 'go'; a.t = 0; this.g.camera.kick(0.1); this.g.camera.addTrauma(0.2); this.g.fx.surface.ring(this.pos.clone().setY(this.pos.y + 0.08), UP, 3, 0.35, 0x7fd8ff); } return; }
    if (a.stage === 'go') {
      const want = this.camDir(_e), ang = angleDelta(Math.atan2(a.dir.x, a.dir.z), Math.atan2(want.x, want.z)), turn = clamp(ang, -3.2 * dt, 3.2 * dt), cur = Math.atan2(a.dir.x, a.dir.z) + turn;
      a.dir.set(Math.sin(cur), 0, Math.cos(cur)); a.faceYaw = cur; a.moveVel = _e.copy(a.dir).multiplyScalar(a.speed).clone();
      this.burst(this.pos, 1.7, 14, 12, 3.5, a.dir, a.hits); this.ghostTick(a, 0.05); this.trailBoost = 1; this.dashGlow();
      const moved = Math.hypot(this.pos.x - a.last.x, this.pos.z - a.last.z) / Math.max(dt, 1e-4); a.last.copy(this.pos);
      if (a.t > 0.06 && moved < a.speed * 0.4) a.stuck += dt; else a.stuck = 0;
      if (a.t >= 0.34 || a.stuck > 0.04) { a.stage = 'recover'; a.t = 0; a.moveVel = null; this.vel.x = a.dir.x * 16; this.vel.z = a.dir.z * 16; if (a.stuck > 0.04) this.g.camera.addTrauma(0.3); }
      this.dashPose(R); return;
    }
    a.w = 1 - a.t / 0.2; this.dashPose(R); if (a.t >= 0.2) this.endAct('q');
  },
  dashGlow() { _e.copy(this.pos); _e.y += rand(0.2, 1.8); this.g.fx.glow.emit({ pos: _e, size: rand(0.5, 1), life: 0.25, drag: 3, color: [0.35, 0.8, 1], alpha: 0.85 }); },
  ghostTick(a, every) { a.gt = (a.gt || 0) - 0.0167; if (a.gt <= 0) { a.gt = every; this.ghost(0.4, 0.4); } },
  crouchPose(R, u) {
    u = clamp(u, 0, 1); R.hips = [0.35 * u, 0, 0]; R.spine = [0.25 * u, 0, 0]; R.head = [-0.3 * u, 0, 0]; R.uarmL = [0.9 * u, 0, 0.1]; R.uarmR = [0.9 * u, 0, -0.1];
    R.thighL = [-0.8 * u, 0, 0]; R.thighR = [-0.8 * u, 0, 0]; R.shinL = [1.2 * u, 0, 0]; R.shinR = [1.2 * u, 0, 0]; R.tail1 = [0.3 * u, 0, 0];
  },

  // ------------------------------------------------------------------------------------------------ E  SPIN ATTACK
  startSpin() { this.begin('spin', { stage: 'crouch', speedMul: 0.4, pulses: 0 }); this.pstats.spin++; this.g.sfx.whoosh(); },
  updateSpin(dt, a, R, L) {
    if (a.stage === 'crouch') { this.crouchPose(R, a.t / 0.16); if (a.t >= 0.16) { a.stage = 'spin'; a.t = 0; a.faceYaw = this.yaw; } return; }
    if (a.stage === 'spin') {
      const T = 0.75, u = a.t / T, rate = 16 + 10 * Math.sin(Math.min(1, u) * Math.PI);        // winds up, whirls, slows
      a.ang = (a.ang || 0) + rate * dt; L.spinY = a.ang;
      R.hips = [0.45, 0, 0]; R.spine = [0.2, 0, 0]; R.head = [-0.35, 0, 0]; R.uarmL = [-0.3, 0, 1.25]; R.uarmR = [-0.3, 0, -1.25]; R.farmL = [-0.3, 0, 0]; R.farmR = [-0.3, 0, 0];
      R.thighL = [-0.7, 0, 0.15]; R.thighR = [-0.7, 0, -0.15]; R.shinL = [1.1, 0, 0]; R.shinR = [1.1, 0, 0]; R.tail1 = [0.1, 0, 0]; R.tail2 = [0, 0.5, 0];
      const fx = this.g.fx; this.trailBoost = 1;
      for (let i = 0; i < 3; i++) { const t = a.ang * 1 + i * TAU / 3 + rand(-0.2, 0.2), r = rand(1.2, 3.4); _e.set(this.pos.x + Math.cos(t) * r, this.pos.y + rand(0.2, 1.9), this.pos.z + Math.sin(t) * r); fx.glow.emit({ pos: _e, vel: _b.set(-Math.sin(t) * 9, rand(-0.3, 0.6), Math.cos(t) * 9), size: rand(0.25, 0.5), life: 0.28, drag: 2, color: [0.45, 0.85, 1], alpha: 0.9 }); }
      if (a.t >= a.pulses * 0.22 + 0.06 && a.pulses < 3) { a.pulses++; fx.surface.ring(this.pos.clone().setY(this.pos.y + 0.1), UP, 7.2, 0.4, 0x7fd8ff); this.burst(this.pos, 3.8, 10, 10, 4, null, null, a.pulses === 3); this.g.camera.addTrauma(0.15); if (a.pulses === 3) { this.burst(this.pos, 3.8, 6, 6, 5, null, null, true); } }
      if (a.t >= T) { a.stage = 'recover'; a.t = 0; }
      return;
    }
    a.w = 1 - a.t / 0.2; R.hips = [0.2, 0, 0]; if (a.t >= 0.2) this.endAct('e');
  },

  // ------------------------------------------------------------------------------------------------ F  SPEED CLONES
  startClones() {
    const t = this.nearest(14, false), center = t ? t.root.position.clone() : this.pos.clone().addScaledVector(this.camDir(_e), 4);
    const a = this.begin('clones', { stage: 'hop', i: 0, center, target: t, a0: Math.atan2(this.pos.x - center.x, this.pos.z - center.z), N: 4, pause: 0, seg: null });
    this.pstats.clones++; this.g.sfx.whoosh();
    for (const h of this.g.world.hittables) { if (h.kind === 'dummy' && Math.hypot(h.root.position.x - center.x, h.root.position.z - center.z) < 12) h.confuse = 2.8; }   // confused: they lose track of the real XLR8
    this.g.hud.toast('SPEED CLONES');
  },
  updateClones(dt, a, R) {
    if (a.target && !a.target.dead) a.center.copy(a.target.root.position);
    if (a.stage === 'hop') {
      if (!a.seg) {
        this.ghost(0.8, 0.5);                                              // leave an afterimage where he was
        const ang = a.a0 + (a.i + 1) * TAU / a.N + 0.4, p = new THREE.Vector3(a.center.x + Math.sin(ang) * 2.1, 0, a.center.z + Math.cos(ang) * 2.1);
        const dx = p.x - this.pos.x, dz = p.z - this.pos.z, d = Math.hypot(dx, dz); a.seg = { p, t: 0, dur: Math.max(0.07, Math.min(0.16, d / 55)), dir: new THREE.Vector3(dx / d, 0, dz / d) };
        a.faceYaw = Math.atan2(dx, dz);
      }
      const s = a.seg; s.t += dt; const dx = s.p.x - this.pos.x, dz = s.p.z - this.pos.z, d = Math.hypot(dx, dz);
      a.moveVel = d > 0.4 ? _e.set(dx / d, 0, dz / d).multiplyScalar(Math.min(60, d / Math.max(dt, 0.008))).clone() : null; this.dashGlow(); this.ghostTick(a, 0.045);
      this.dashPose(R);
      if (d <= 0.5 || s.t > s.dur + 0.1) {
        a.moveVel = null; this.vel.set(0, 0, 0); a.faceYaw = Math.atan2(a.center.x - this.pos.x, a.center.z - this.pos.z); this.yaw = a.faceYaw;
        this.burst(this.pos, 3.0, 9, 4, a.i === a.N - 1 ? 6 : 0, _a.set(Math.sin(a.faceYaw), 0, Math.cos(a.faceYaw)).clone(), null, a.i === a.N - 1);
        a.i++; a.seg = null; a.stage = a.i >= a.N ? 'recover' : 'strike'; a.t = 0;
      }
      return;
    }
    if (a.stage === 'strike') { R.hips = [0.3, 0, 0]; R.uarmR = [-1.4, 0, -0.1]; R.uarmL = [0.5, 0, 0.1]; R.spine = [0.1, 0.4, 0]; R.farmL = [-0.9, 0, 0]; if (a.t >= 0.07) { a.stage = 'hop'; a.t = 0; } return; }
    a.w = 1 - a.t / 0.25; R.hips = [0.25, 0, 0]; if (a.t >= 0.25) this.endAct('f');
  },

  // ------------------------------------------------------------------------------------------------ G  SPEED THROW
  startThrow() {
    const t = this.nearest(18, true); if (!t) { this.g.hud.toast('NO TARGET IN FRONT'); return; }
    const a = this.begin('throw', { stage: 'seek', target: t, dir: this.camDir(new THREE.Vector3()), v: 12 }); this.g.sfx.whoosh(); this.pstats.throws++;
  },
  updateThrow(dt, a, R) {
    const t = a.target, P = this.pos;
    if (a.stage === 'seek') {
      if (!t || t.dead) { this.act = null; return; }
      const dx = t.root.position.x - P.x, dz = t.root.position.z - P.z, d = Math.hypot(dx, dz); a.faceYaw = Math.atan2(dx, dz);
      this.dashPose(R); this.dashGlow(); this.ghostTick(a, 0.06);
      if (t.isBoss && (d <= 2.2 || a.t > 0.5)) { a.moveVel = null; const hd = _e.set(dx, 0, dz).normalize().clone(); t.applyHit(t.root.position.clone().setY(t.root.position.y + 1.3), hd.clone(), 18); t.shove(hd, 16); this.g.camera.addTrauma(0.25); this.g.sfx.hit(false); this.act = null; return; }   // a boss cannot be picked up: the dash ends in a hard hit instead
      if (d <= 1.9 || a.t > 0.5) { a.moveVel = null; a.stage = 'grab'; a.t = 0; this.vel.set(0, 0, 0); t.held = true; t.collider.dead = true; t.kv.set(0, 0, 0); this.g.camera.addTrauma(0.25); this.g.sfx.hit(false); }
      else a.moveVel = _e.set(dx / d, 0, dz / d).multiplyScalar(Math.min(52, Math.max(20, d / 0.08))).clone();
      return;
    }
    // hold the enemy in the claws (follows the hand), whatever the stage
    this.rig.markers.tipL.getWorldPosition(_c); this.rig.markers.tipR.getWorldPosition(_b); _c.add(_b).multiplyScalar(0.5);
    if (a.stage !== 'release' && a.stage !== 'recover') { t.home.set(_c.x, 0, _c.z); t.root.position.set(_c.x, Math.max(0, _c.y - 1.5), _c.z); t.air = Math.max(0, _c.y - 1.5); t.airV = 0; }
    if (a.stage === 'grab') { R.hips = [0.3, 0, 0]; R.uarmL = [-1.2, 0, 0.35]; R.uarmR = [-1.2, 0, -0.35]; R.spine = [0.15, 0, 0]; if (a.t >= 0.14) { a.stage = 'carry'; a.t = 0; a.dir = this.camDir(new THREE.Vector3()); a.faceYaw = Math.atan2(a.dir.x, a.dir.z); } return; }
    if (a.stage === 'carry') {
      a.v = Math.min(34, a.v + 70 * dt); a.moveVel = _e.copy(a.dir).multiplyScalar(a.v).clone(); this.dashPose(R); R.uarmL = [-1.0, 0, 0.35]; R.uarmR = [-1.0, 0, -0.35]; this.dashGlow(); this.ghostTick(a, 0.05);
      if (a.t >= 0.42) { a.stage = 'release'; a.t = 0; a.moveVel = null; this.vel.x = a.dir.x * 14; this.vel.z = a.dir.z * 14; t.release(); t.home.set(_c.x, 0, _c.z); t.root.position.set(_c.x, 0, _c.z);
        t.air = Math.max(0.2, _c.y - 1.5); t.applyHit(_c.clone(), a.dir.clone(), 18); t.shove(a.dir, 36); t.airV = 4; t.thrown = 1; this.g.hud.hit(_c.clone(), 18, t); this.hitFX(_c.clone(), a.dir, true); this.stats.hits++; this.pstats.hits++; this.g.camera.addTrauma(0.6); this.g.camera.kick(0.12); this.g.sfx.hit(true); }
      return;
    }
    if (a.stage === 'release') { R.hips = [0.2, 0, 0]; R.uarmL = [-1.7, 0, 0.2]; R.uarmR = [-1.7, 0, -0.2]; R.spine = [0.2, 0, 0]; if (a.t >= 0.18) { a.stage = 'recover'; a.t = 0; } return; }
    a.w = 1 - a.t / 0.25; R.hips = [0.15, 0, 0]; if (a.t >= 0.25) this.endAct('g');
  },

  // ------------------------------------------------------------------------------------------------ X  HYPER DRIVE (ultimate)
  startHyper() {
    const list = []; for (const h of this.g.world.hittables) { if ((h.kind === 'dummy' || h.isBoss && h.present !== false) && !h.dead) { const d = Math.hypot(h.root.position.x - this.pos.x, h.root.position.z - this.pos.z); if (d < 28) list.push([d, h]); } }
    list.sort((p, q) => p[0] - q[0]);
    this.begin('hyper', { stage: 'charge', targets: list.slice(0, 6).map(x => x[1]), k: 0, fwd: this.camDir(new THREE.Vector3()), hitT: 0, last: this.pos.clone() }); this.pstats.hyper++;
    this.g.hud.toast('HYPER DRIVE'); this.g.sfx.slowIn(); this.g.camera.kick(0.14);
  },
  updateHyper(dt, a, R) {
    const fx = this.g.fx;
    if (a.stage === 'charge') {
      const u = clamp(a.t / 0.5, 0, 1); this.crouchPose(R, u); R.uarmL = [1.4 * u, 0, 0.4]; R.uarmR = [1.4 * u, 0, -0.4]; R.hips = [0.5 * u, 0, 0]; R.tail1 = [0.5 * u, 0, 0];
      for (let i = 0; i < 4; i++) { const t = rand(0, TAU), r = rand(2.2, 4); _e.set(this.pos.x + Math.cos(t) * r, this.pos.y + rand(0.1, 2), this.pos.z + Math.sin(t) * r); fx.glow.emit({ pos: _e, vel: _b.set(this.pos.x - _e.x, this.pos.y + 1 - _e.y, this.pos.z - _e.z).multiplyScalar(5), size: rand(0.2, 0.45), life: 0.3, drag: 0, color: [0.4, 0.8, 1], alpha: 0.9 }); }
      if (a.t < 0.05 || a.t > 0.25 && Math.random() < dt * 8) fx.surface.ring(this.pos.clone().setY(this.pos.y + 0.1), UP, 4 + 3 * u, 0.4, 0x4db8ff);
      this.g.camera.addTrauma(dt * 0.9);
      if (a.t >= 0.5) { a.stage = 'rush'; a.t = 0; this.g.sfx.whoosh(); this.g.camera.kick(0.18); this.g.camera.addTrauma(0.4); }
      return;
    }
    if (a.stage === 'rush') {
      let tgt = a.targets[a.k]; while (tgt && tgt.dead && a.k < a.targets.length) tgt = a.targets[++a.k];
      let dir;
      if (tgt) { dir = _a.set(tgt.root.position.x - this.pos.x, 0, tgt.root.position.z - this.pos.z); } else { dir = _a.copy(a.fwd); }
      const d = dir.length(); if (d > 1e-3) dir.multiplyScalar(1 / d);
      // weave: a sideways sine makes the rush curve through the group instead of running one straight line
      const side = _b.set(-dir.z, 0, dir.x).multiplyScalar(Math.sin(a.t * 18) * 0.35); const mv = _e.copy(dir).add(side).normalize();
      a.faceYaw = Math.atan2(mv.x, mv.z); a.moveVel = mv.multiplyScalar(62).clone(); this.ghostTick(a, 0.035); this.dashGlow(); this.dashGlow(); this.trailBoost = 1;
      this.hyperPose(R, a.t);
      if (tgt && d < 2.3) { a.hitT -= dt; if (a.hitT <= 0) { a.hitT = 0.06; a.hitsOn = (a.hitsOn || 0) + 1; this.burst(this.pos, 2.6, 7, 3, 0, dir.clone(), null, false); } if ((a.hitsOn || 0) >= 4) { a.hitsOn = 0; a.k++; a.last.copy(this.pos); } }
      const moved = Math.hypot(this.pos.x - a.last.x, this.pos.z - a.last.z);
      if (a.k >= a.targets.length && (!a.targets.length ? a.t > 0.5 : true) || a.t >= 2.2) { a.stage = 'finale'; a.t = 0; a.moveVel = null; this.vel.set(0, 0, 0); }
      return;
    }
    if (a.stage === 'finale') {
      if (!a.fired) { a.fired = true; fx.surface.ring(this.pos.clone().setY(this.pos.y + 0.1), UP, 14, 0.7, 0xbfe9ff); fx.surface.ring(this.pos.clone().setY(this.pos.y + 0.1), UP, 8, 0.5, 0x4db8ff);
        this.burst(this.pos, 7.5, 32, 26, 9.5, null, null, true); this.g.camera.addTrauma(1); this.g.camera.kick(0.2);
        for (let i = 0; i < 40; i++) fx.glow.emit({ pos: _e.set(this.pos.x, this.pos.y + 1, this.pos.z), vel: _b.set(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).normalize().multiplyScalar(rand(8, 22)), size: rand(0.3, 0.8), life: rand(0.3, 0.6), drag: 2, color: [0.5, 0.85, 1] });
        for (let i = 0; i < 24; i++) fx.dust.emit({ pos: this.pos.clone().setY(this.pos.y + 0.2), vel: _b.set(rand(-1, 1), rand(0, 0.5), rand(-1, 1)).normalize().multiplyScalar(rand(4, 12)), size: rand(1.4, 2.6), grow: 2.5, life: rand(0.7, 1.2), drag: 2, color: [0.62, 0.6, 0.57], alpha: 0.55 });
        this.g.sfx.hit(true); this.ghost(0.9, 0.6); }
      this.finisherPose(R, null, 1, true); a.w = 1; if (a.t >= 0.5) { a.stage = 'recover'; a.t = 0; } return;
    }
    a.w = 1 - a.t / 0.3; this.finisherPose(R, null, 1, true); if (a.t >= 0.3) this.endAct('x');
  },
  hyperPose(R, t) {   // flat, horizontal sprint with claws raking out to both sides (clearly different from the Speed Dash pose)
    const s = Math.sin(t * 40);
    R.hips = [0.75, 0, 0]; R.spine = [0.2, 0.2 * s, 0]; R.chest = [0.1, 0, 0]; R.head = [-0.6, 0, 0];
    R.uarmL = [-1.3, 0, 0.9 + 0.3 * s]; R.uarmR = [-1.3, 0, -0.9 - 0.3 * s]; R.farmL = [-0.2, 0, 0]; R.farmR = [-0.2, 0, 0];
    R.thighL = [-1.1 * s, 0, 0]; R.thighR = [1.1 * s, 0, 0]; R.shinL = [0.9 + 0.5 * s, 0, 0]; R.shinR = [0.9 - 0.5 * s, 0, 0]; R.tail1 = [0.55, 0, 0]; R.tail2 = [0.3, 0, 0];
  },

  // ------------------------------------------------------------------------------------------------ Z  SLIDE
  startSlide() {
    if (this.act || this.combo || !this.grounded || this.mode !== 'ground' || this.speed < 8) return;
    this.mode = 'slide'; this.pstats.slide++; this.slideT = 0; this.colH = 0.9; this.g.sfx.whoosh(); this.g.camera.kick(0.05);
    this.g.fx.surface.ring(this.pos.clone().setY(this.pos.y + 0.08), UP, 2.6, 0.35, 0xbfe9ff);
  },
  /** called from physics each frame while sliding; returns true to keep sliding */
  slideStep(dt) {
    this.slideT += dt;
    const sp = Math.hypot(this.vel.x, this.vel.z), k = Math.max(0, 1 - 0.9 * dt * (sp > 12 ? 1 : 2));   // glides, slowly losing speed
    this.vel.x *= k; this.vel.z *= k;
    this.skidFX(dt);
    // stay down while there is a low ceiling above (so he can slide out from under obstacles)
    let roof = false; for (const b of this.g.world.boxes) { if (b.min.y > this.pos.y + 0.8 && b.min.y < this.pos.y + XCFG_H && this.pos.x > b.min.x - 0.6 && this.pos.x < b.max.x + 0.6 && this.pos.z > b.min.z - 0.6 && this.pos.z < b.max.z + 0.6) roof = true; }
    return this.slideT < 0.9 || roof && sp > 2.5;
  },
};
const XCFG_H = 2.1;

/** wall detection for wall-running: nearest tall box face within reach that the player is moving into */
export function findWall(world, pos, want, y) {
  let best = null, bd = 1.0;
  for (const b of world.boxes) {
    if (b.tmp || b.max.y < y + 1.2 || b.min.y > y + 0.5) continue;
    const cx = clamp(pos.x, b.min.x, b.max.x), cz = clamp(pos.z, b.min.z, b.max.z), dx = pos.x - cx, dz = pos.z - cz, d = Math.hypot(dx, dz);
    if (d > bd || d < 1e-4) continue;
    const n = new THREE.Vector3(dx / d, 0, dz / d);
    if (want && -(want.x * n.x + want.z * n.z) < 0.35) continue;      // must be steering toward the wall
    bd = d; best = { n, d, box: b };
  }
  return best;
}
