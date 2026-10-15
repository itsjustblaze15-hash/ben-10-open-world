// Upgrade (Galvanic Mechamorph) controller. Reuses the biped locomotion of HbPlayer (same procedural FaPoser rig, ground physics, collision) and replaces the powers:
//   LMB merge with technology (tech.js)  ·  Q Eye Laser  ·  E Enhance  ·  F Control machine  ·  G Liquid body  ·  T Detach
// His body is "liquid": it squashes / stretches with movement and jumps (non-uniform scale of the model root) and, in liquid mode, flattens so that it fits through narrow slots and under low
// obstacles. He never teleports, never passes through solid walls and cannot fly: every gap he uses is a real, measured opening in the collision world.
import * as THREE from 'three';
import { HbPlayer, HCFG } from './heatblast.js';
import { clamp, damp, lerp, rand } from './util.js';
import { hand, mkPose, arm, smooth, D, layer } from './fa_pose.js';

export const UP_SCALE = 0.0145, UP_LEG = 0.82;
export const UCFG = { walk: 3.4, run: 7.2, accelG: 26, brake: 34, accelA: 8, latG: 28, jumpV: 10.2, jump2V: 0, grav: 28, radius: 0.5, height: 2.0, crouchT: 0.08, hp: 260, fly: HCFG.fly };
export const LCFG = { ...UCFG, walk: 3.6, run: 6.4, accelG: 40, brake: 40, jumpV: 0, radius: 0.3, height: 0.6 };
export const UP_CD = { lmb: 0.5, q: 3.2, e: 1.2, f: 0.5, g: 0.6, t: 0.5 };
const LASER = { charge: 0.42, fire: 0.42, recover: 0.25, cost: 30, range: 60, dps: 130 };
const GREEN = [0.2, 1, 0.5], $ = id => document.getElementById(id);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3(), _f = new THREE.Vector3(), UPV = new THREE.Vector3(0, 1, 0), _inv = new THREE.Matrix4();
const LIQ_INPUT = { moveX: 0, moveY: 0, run: false, jump: false, jumpHeld: false, down: false };

export class UpPlayer extends HbPlayer {
  constructor(game, rig, tech) {
    super(game, rig, { kind: 'upgrade', cfg: UCFG, leg: UP_LEG, scale: UP_SCALE, name: 'Upgrade' });
    this.tech = tech; this.eyeLocal = new THREE.Vector3(0.0, 0.14, -0.065);       // eye position in head-bone space (bone units: 1 = 1.43 m; the bone's +Z points out of the back of the head; calibrated against the GLB)
    this.glowMat = rig.mats.get('Glow') || null; if (this.glowMat) this.glowMat.userData.c0 = this.glowMat.color.clone();
    const mk = (r, col, op) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 10, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    this.beam = new THREE.Group(); this.beamGlow = mk(1, 0x1fff6a, 0.55); this.beamCore = mk(0.45, 0xc8ffdc, 0.8); this.beam.add(this.beamGlow, this.beamCore); this.beam.visible = false; this.beam.renderOrder = 6; game.scene.add(this.beam);
    this.root.visible = false;
  }

  // ------------------------------------------------------------------------------------------------ setup / plumbing
  initPowers(game) {
    this.act = null; this.tail = null; this.lastL = null; this.aimPt = new THREE.Vector3(0, 0, -20); this.lmbHeld = false; this.fireHeld = false; this.blastCd = 0;
    this.cd = { lmb: 0, q: 0, e: 0, f: 0, g: 0, t: 0 }; this.cdMax = UP_CD; this.prot = { on: false, k: 0, t: 0, dur: 1, tick: 0 }; this.shots = []; this.waves = []; this.light = { intensity: 0 };
    this.hintEl = $('uphint'); this.energy = 100; this.enMax = 100; this.liquid = { on: false, k: 0, wantOff: false }; this.merged = null; this.techAnim = null; this.eyeGlow = 0; this.laserT = 0; this.hpT = 0; this.mergeFlash = 0;
    Object.assign(this.stats, { lasers: 0, laserHits: 0, liquidTime: 0, squeezes: 0, merges: 0 });
    this.fxU = { liq: 0, tick: 0, eye: 0 };
  }
  activate(from) {
    this.liquid.on = false; this.liquid.k = 0; this.cfg = UCFG; this.rad = UCFG.radius; this.colH = UCFG.height; this.merged = null; this.techAnim = null;
    super.activate(from); this.root.scale.set(1, 1, 1);
  }
  deactivate() { this.cancelAll(); this.root.visible = false; if (this.hintEl) this.hintEl.hidden = true; const e = $('upfx'); if (e) e.style.opacity = '0'; this.beam.visible = false; this.liquid.on = false; this.liquid.k = 0; this.root.scale.set(1, 1, 1); }
  /** called when the player switches to another alien: a merged / merging Upgrade is released first so the machine is left safely */
  leave() { this.tech.forceRelease(this); this.liquid.on = false; this.liquid.k = 0; this.root.visible = true; this.root.scale.set(1, 1, 1); }
  cancelAll() {
    this.act = null; this.tail = null; this.lastL = null; this.lmbHeld = false; this.fireHeld = false; if (this.beam) this.beam.visible = false; this.eyeGlow = 0;
    if (this.hintEl) this.hintEl.hidden = true;
  }
  cancelAct() { this.act = null; this.tail = null; this.beam.visible = false; this.eyeGlow = 0; }
  get busy() { return !!this.act || !!this.techAnim || !!this.merged; }
  get flying() { return false; }
  get hitSphere() {
    if (this.merged) return { y: this.merged.hitY, r: this.merged.hitR };
    return this.liquid.on ? { y: 0.3, r: 0.55 } : { y: 1.0, r: 0.85 };
  }
  canStart() { return !this.act && !this.techAnim && !this.merged && this.mode !== 'crouch'; }
  get mergedKind() { return this.merged ? this.merged.kind : ''; }

  // ------------------------------------------------------------------------------------------------ input
  keyDown(code) {
    switch (code) {
      case 'KeyQ': return this.startLaser();
      case 'KeyE': return this.keyE();
      case 'KeyF': return this.keyF();
      case 'KeyG': return this.keyG();
      case 'KeyT': return this.keyT();
    }
  }
  keyUp() {}
  mouseDown() {
    this.lmbHeld = true; this.fireHeld = true; const g = this.g;
    if (this.techAnim) return;
    if (this.merged) { this.tech.primary(this); return; }
    if (this.liquid.on) { g.hud.toast('REFORM FIRST [G] TO MERGE'); return; }
    if (this.act) return; if (this.cd.lmb > 0) return;
    if (this.tech.tryMerge(this)) { this.cd.lmb = 0.3; }
  }
  mouseUp() { this.lmbHeld = false; this.fireHeld = false; }
  keyE() { if (this.cd.e > 0 || this.techAnim) return; if (!this.merged) { this.g.hud.toast('MERGE WITH A MACHINE FIRST [LMB]'); return; } this.tech.enhance(this); }
  keyF() { if (this.techAnim || this.cd.f > 0) return; if (this.liquid.on) { this.g.hud.toast('REFORM FIRST [G]'); return; } this.cd.f = 0.4; this.tech.toggleControl(this); }
  keyT() { if (this.techAnim) return; if (!this.merged) { this.g.hud.toast('NOT MERGED'); return; } this.tech.detach(this); }
  keyG() {
    const g = this.g, L = this.liquid; if (this.merged || this.techAnim) { g.hud.toast('DETACH FIRST [T]'); return; } if (this.cd.g > 0) return; this.cd.g = 0.35;
    if (!L.on) {
      if (this.act) return; if (this.energy < 8) { g.hud.toast('NOT ENOUGH ENERGY'); return; }
      L.on = true; L.wantOff = false; this.mode = this.grounded ? 'ground' : this.mode; g.sfx.merge(true); g.hud.toast('LIQUID BODY'); this.liquidBurst(1);
    } else this.requestReform();
  }
  requestReform() { this.liquid.wantOff = true; }
  /** can the full-height body reform here? (nothing solid above the flat body within the standing volume) */
  headroom() {
    const w = this.g.world, y = this.pos.y, r = UCFG.radius * 0.9, top = y + UCFG.height;
    for (const b of w.boxes) { if (b.max.y <= y + LCFG.height + 0.02 || b.min.y >= top) continue; if (this.pos.x > b.min.x - r && this.pos.x < b.max.x + r && this.pos.z > b.min.z - r && this.pos.z < b.max.z + r) return false; }
    return true;
  }
  /** is the standing body free of every collider at (x, z)? */
  standFree(x, z) {
    const w = this.g.world, y = this.pos.y, r = UCFG.radius * 0.95, top = y + UCFG.height;
    for (const b of w.boxes) { if (b.max.y <= y + 0.45 || b.min.y >= top) continue; if (x > b.min.x - r && x < b.max.x + r && z > b.min.z - r && z < b.max.z + r) return false; }
    for (const q of w.cylinders) { if (q.dead) continue; if (Math.hypot(x - q.pos.x, z - q.pos.z) < q.r + r) return false; }
    return true;
  }
  /** wants to reform but something solid is over / beside him: flow a short way (<= 1 m) to the nearest spot where the full body fits */
  findReformSpot() {
    for (let ring = 1; ring <= 5; ring++) for (let i = 0; i < 16; i++) {
      const a = i * Math.PI / 8, x = this.pos.x + Math.sin(a) * ring * 0.2, z = this.pos.z + Math.cos(a) * ring * 0.2;
      if (this.standFree(x, z) && this.g.world.groundAt(x, z, this.pos.y + 0.3, 0.3, 0.3) <= this.pos.y + 0.35) return new THREE.Vector3(x, this.pos.y, z);
    }
    return null;
  }
  updateLiquid(dt) {
    const L = this.liquid;
    if (L.on) {
      this.stats.liquidTime += dt; this.energy = Math.max(0, this.energy - 4.5 * dt); if (this.energy <= 0) L.wantOff = true;
      if (L.wantOff) {
        if (this.headroom()) { L.on = false; L.wantOff = false; L.nudge = null; this.g.sfx.merge(false); this.liquidBurst(0.6); this.g.hud.toast('BODY REFORMED'); }
        else {
          if (!L.nudge) L.nudge = this.findReformSpot();
          if (L.nudge) { const d = _a.copy(L.nudge).sub(this.pos); d.y = 0; const dl = d.length(); if (dl > 0.03) { d.multiplyScalar(Math.min(dl, 2.2 * dt) / dl); this.pos.add(d); this.vel.set(0, 0, 0); } }
          else if (!L.warned || L.warned < this.stats.liquidTime - 2) { L.warned = this.stats.liquidTime; this.g.hud.toast('NO ROOM TO REFORM — MOVE OUT FROM UNDER IT'); }
        }
      } else L.nudge = null;
    }
    const want = L.on ? LCFG : UCFG; if (this.cfg !== want) { this.cfg = want; this.rad = want.radius; this.colH = want.height; }
  }
  liquidBurst(k) {
    const g = this.g; g.fx.surface.ring(_a.set(this.pos.x, this.pos.y + 0.08, this.pos.z), UPV, 3.6 * k, 0.4, 0x4cff7a);
    for (let i = 0; i < 18 * k; i++) g.fx.glow.emit({ pos: _a.set(this.pos.x + rand(-0.5, 0.5), this.pos.y + rand(0.1, 1.5), this.pos.z + rand(-0.5, 0.5)), vel: _b.set(rand(-1, 1), rand(0.2, 2), rand(-1, 1)).multiplyScalar(2.4), size: rand(0.2, 0.45), life: 0.45, drag: 2, color: GREEN });
  }

  // ------------------------------------------------------------------------------------------------ physics
  updatePhysics(dt, input, camYaw) {
    this.camYaw = camYaw; this.input = input; this.landImpact = 0;
    if (this.techAnim) { this.vel.set(0, 0, 0); this.speed = 0; this.hasInput = false; return; }        // tech.update() animates position + scale
    if (this.merged) { this.tech.updateControl(this, dt, input, camYaw); this.speed = this.merged.v ? Math.abs(this.merged.v.speed) : this.merged.r ? Math.hypot(this.merged.r.vx || 0, this.merged.r.vz || 0) : 0; this.grounded = true; this.hasInput = false; return; }
    this.updateLiquid(dt);
    let inp = input; if (this.liquid.on) { Object.assign(LIQ_INPUT, input); LIQ_INPUT.jump = false; LIQ_INPUT.jumpHeld = false; inp = LIQ_INPUT; }
    if (this.act && this.act.kind === 'laser') { /* aiming: handled in updateLaser */ }
    this.jumped2 = true;                                                                                  // Upgrade has no double jump
    super.updatePhysics(dt, inp, camYaw);
    if (this.liquid.on && this.speed > 1.5 && this.grounded) { if (!this._sq) { this._sq = true; } }
  }
  /** keep him from sinking into the ground / ceilings when the body shape changes (liquid -> standing is only allowed with headroom, see updateLiquid) */
  onHit(dmg, pt, dir) {
    const g = this.g; if (this.merged) { this.tech.hurtMachine(this.merged, dmg); g.camera.addTrauma(0.25); return; }
    g.hud.hurt(); g.camera.addTrauma(0.3); this.hp = Math.max(0, this.hp - dmg * (this.liquid.on ? 0.7 : 1)); this.hpT = 4;
    for (let i = 0; i < 6; i++) g.fx.glow.emit({ pos: pt, vel: _b.set(rand(-1, 1), rand(0, 1), rand(-1, 1)).multiplyScalar(4), size: rand(0.15, 0.3), life: 0.35, drag: 2, color: GREEN });
    if (this.hp <= 0) { this.hp = UCFG.hp * 0.6; g.hud.toast('BODY REFORMED'); }
  }

  // ------------------------------------------------------------------------------------------------ eye laser (Q)
  startLaser() {
    const g = this.g;
    if (this.merged || this.techAnim) { g.hud.toast('EYE LASER OFFLINE WHILE MERGED — DETACH [T]'); return; }
    if (this.liquid.on) { g.hud.toast('REFORM FIRST [G] FOR EYE LASER'); return; }
    if (this.act || this.mode === 'crouch') return; if (this.cd.q > 0) { g.hud.toast('LASER RECHARGING ' + this.cd.q.toFixed(1) + 's'); return; }
    if (this.energy < LASER.cost) { g.hud.toast('NOT ENOUGH ENERGY'); return; }
    this.beginAct('laser', { speedMul: 0.25, noJump: true, tick: 0, dur: LASER.charge + LASER.fire + LASER.recover }); g.sfx.laserCharge && g.sfx.laserCharge();
  }
  beginAct(kind, extra) { this.tail = null; this.act = Object.assign({ kind, stage: 'charge', t: 0, st: 0, w: 0, speedMul: 0.6, lockMove: false, moveVel: null, faceYaw: this.aimYaw(), faceK: 20, once: new Set() }, extra); return this.act; }
  endAct(cdKey = null, cd = 0) { const a = this.act; if (!a) return; if (cdKey) this.cd[cdKey] = cd || UP_CD[cdKey]; if (this.lastL) this.tail = { L: this.lastL, t: 0.2 }; this.act = null; this.beam.visible = false; }
  updateLaser(dt, a) {
    const g = this.g; a.t += dt; a.st += dt; a.faceYaw = this.aimYaw(); const eye = this.eyeWorld(_c);
    if (a.stage === 'charge') {
      const u = a.st / LASER.charge; this.eyeGlow = u;
      for (let i = 0; i < 2; i++) g.fx.glow.emit({ pos: _a.set(eye.x + rand(-1, 1) * 0.7 * (1 - u), eye.y + rand(-1, 1) * 0.7 * (1 - u), eye.z + rand(-1, 1) * 0.7 * (1 - u)), vel: _b.set(0, 0, 0), size: 0.18 + 0.1 * u, life: 0.1, drag: 0, color: GREEN, alpha: 0.9 });
      g.fx.glow.emit({ pos: eye, size: 0.2 + 0.7 * u, life: 0.05, drag: 0, color: [0.6, 1, 0.75], alpha: 0.9 });
      if (a.st >= LASER.charge) { this.setStage(a, 'fire'); this.energy -= LASER.cost; this.stats.lasers++; g.sfx.laserFire && g.sfx.laserFire(); g.camera.addTrauma(0.22); g.camera.kick && g.camera.kick(0.05); }
    } else if (a.stage === 'fire') {
      this.eyeGlow = 1; this.fireBeam(dt, a, eye);
      if (a.st >= LASER.fire) { this.setStage(a, 'recover'); this.beam.visible = false; }
    } else { this.eyeGlow = Math.max(0, 1 - a.st / LASER.recover); if (a.st >= LASER.recover) this.endAct('q', UP_CD.q); }
  }
  setStage(a, s) { a.stage = s; a.st = 0; }
  fireBeam(dt, a, eye) {
    const g = this.g, w = g.world, dir = this.aimFrom(eye, _d).clone(), R = LASER.range; let tEnd = R, kind = null, target = null, nrm = null;
    const sh = w.raySolid(eye, dir, R); if (sh) { tEnd = sh.t; kind = 'solid'; nrm = sh.normal; }
    for (const h of w.hittables) {
      if (h.dead || h.held || h.override) continue;
      for (const sp of h.spheres) { _e.copy(sp.local); h.root.localToWorld(_e); _f.copy(_e).sub(eye); const tt = _f.dot(dir); if (tt < 0 || tt > tEnd) continue; if (_f.addScaledVector(dir, -tt).length() < sp.r) { tEnd = tt; kind = 'foe'; target = h; nrm = null; } }
    }
    const end = eye.clone().addScaledVector(dir, tEnd);
    // beam visual: two additive cylinders from the eye to the impact
    const flick = 1 + 0.18 * Math.sin(a.t * 90); this.beam.visible = true; this.beam.position.copy(eye).lerp(end, 0.5); this.beam.quaternion.setFromUnitVectors(UPV, dir); this.beam.scale.set(1, tEnd, 1);
    this.beamGlow.scale.set(0.1 * flick, 1, 0.1 * flick); this.beamCore.scale.set(0.032 * flick, 1, 0.032 * flick);
    for (let i = 0; i < 4; i++) g.fx.glow.emit({ pos: _a.copy(eye).addScaledVector(dir, rand(0, Math.min(tEnd, 40))), size: rand(0.1, 0.22), life: 0.1, drag: 0, color: GREEN, alpha: 0.7 });
    g.fx.glow.emit({ pos: eye, size: 0.9, life: 0.05, drag: 0, color: [0.7, 1, 0.8], alpha: 1 });
    // damage tick
    a.tick -= dt; if (a.tick > 0) { this.impactFX(end, nrm, false); return; } a.tick = 0.05; const dmg = LASER.dps * 0.05;
    this.impactFX(end, nrm, true);
    if (kind === 'foe') { this.hurtFoe(target, end, _e.copy(dir).setY(0).normalize(), dmg, 1.5, {}); this.stats.laserHits++; }
    else if (kind === 'solid') {
      const b = this.boxAt(_b.copy(end).addScaledVector(dir, 0.15)) || this.boxAt(end);
      if (b && b.prop) { const p = b.prop; if (b.prop.tech && b.prop.tech.isMerged) return; g.props.hurt(p, dmg * 0.9, dir.clone()); g.fire.heatProp && g.fire.heatProp(p, 0.15); this.stats.laserHits++; }
      else if (b && b.wall) { g.props.damageWall(b.wall, dmg * 0.8, end.clone(), dir.clone()); this.stats.laserHits++; }
      else if (b && b.tech) { /* doors etc. are not damaged */ }
    }
  }
  impactFX(pt, nrm, strong) {
    const g = this.g; if (strong || Math.random() < 0.5) { for (let i = 0; i < 3; i++) g.fx.glow.emit({ pos: pt, vel: _b.set(rand(-1, 1), rand(0, 1.4), rand(-1, 1)).normalize().multiplyScalar(rand(3, 7)), size: rand(0.1, 0.22), life: 0.3, drag: 1.5, color: GREEN, alpha: 1 }); }
    g.fx.glow.emit({ pos: pt, size: 1.1, life: 0.06, drag: 0, color: [0.8, 1, 0.85], alpha: 1 });
    if (strong) { g.fire.lights.flash(pt.clone(), GREEN, 9, 0.08, 9); if (nrm && nrm.y > 0.7) g.fire.scorchAt(pt.x, pt.y, pt.z, 0.35, 4); }
  }
  eyeWorld(out) {
    // eye = a point in front of / slightly above the head bone, in the model's own space (the supplied GLB's single eye); moves with the head and the body deformation
    const h = this.rig.bones.head; h.updateWorldMatrix(true, false);
    out.copy(this.eyeLocal).applyMatrix4(h.matrixWorld); return out;
  }

  // ------------------------------------------------------------------------------------------------ per frame
  updatePowers(dt, aimPoint) {
    this.aimPt.copy(aimPoint); for (const k in this.cd) if (this.cd[k] > 0) this.cd[k] = Math.max(0, this.cd[k] - dt);
    if (this.hpT > 0) this.hpT -= dt; else if (this.hp < UCFG.hp) this.hp = Math.min(UCFG.hp, this.hp + 25 * dt);
    if (!this.liquid.on && !this.techAnim) this.energy = Math.min(this.enMax, this.energy + 9 * dt);
    if (this.merged) this.energy = Math.min(this.enMax, this.energy + 6 * dt);
    const a = this.act; if (a && a.kind === 'laser') this.updateLaser(dt, a); else this.eyeGlow = Math.max(0, this.eyeGlow - dt * 4);
    if (this.hintEl) { const txt = this.root.visible || this.merged || this.techAnim ? this.tech.hint(this) : ''; if (this.hintEl.textContent !== txt) this.hintEl.textContent = txt; this.hintEl.hidden = !txt; }
    const fx = $('upfx'); if (fx) fx.style.opacity = String(Math.min(1, this.mergeFlash + (this.techAnim ? 0.9 : 0) + (this.merged ? 0.35 : 0) + this.liquid.k * 0.4).toFixed(2)); this.mergeFlash = Math.max(0, this.mergeFlash - dt * 2);
  }

  // ------------------------------------------------------------------------------------------------ animation + body deformation
  updateAnim(dt) {
    const L = this.liquid, A = this.an; L.k = damp(L.k, L.on ? 1 : 0, 9, dt);
    if (this.merged) { this.root.visible = false; this.updateState(); return; }
    if (!this.techAnim) this.deform(dt);
    const P = this.locoPose(dt); const Lyr = this.actLayer(dt); if (Lyr) layer(P, Lyr, this.poser);
    this.poser.apply(P); this.root.updateMatrixWorld(true); this.updateFX(dt); this.updateState(); void A;
  }
  deform(dt) {
    const A = this.an, k = this.liquid.k, t = A.t, sp = this.speed, mv = clamp(sp / 5, 0, 1);
    const rise = this.grounded ? 0 : clamp(this.vel.y / 10, -1, 1), land = clamp(A.land, 0, 1.2);
    let sx = 1, sy = 1, sz = 1;
    // alive, flowing body: slow breathing wobble + stretch along the direction of travel
    sy *= 1 + 0.014 * Math.sin(t * 2.3) + 0.03 * mv * Math.sin(t * 9) ; sx *= 1 - 0.01 * Math.sin(t * 2.3) + 0.02 * mv * Math.sin(t * 9 + 1);
    sz *= 1 + 0.05 * mv; sy *= 1 - 0.02 * mv;
    // jump stretch / landing squash
    sy *= 1 + 0.16 * Math.max(0, rise) - 0.08 * Math.max(0, -rise); const q = 1 / Math.sqrt(sy); sx *= q; sz *= q;
    sy *= 1 - 0.2 * land; sx *= 1 + 0.1 * land; sz *= 1 + 0.1 * land;
    // liquid: a flat, wide, elongated puddle that flows
    const flow = 1 + 0.05 * Math.sin(t * 7.5 + sp) * k, e = smooth(k);
    sx = lerp(sx, 1.38 * flow, e); sy = lerp(sy, 0.3 + 0.015 * Math.sin(t * 5), e); sz = lerp(sz, (1.55 + 0.5 * clamp(sp / 6, 0, 1)) / flow, e);
    this.root.scale.set(sx, sy, sz);
  }
  actLayer(dt) {
    let L = null; const a = this.act;
    if (a && a.kind === 'laser') { a.w = 1; L = this.laserLayer(a); }
    if (L) { this.lastL = L; this.tail = null; return L; }
    if (this.tail) { this.tail.t -= dt; if (this.tail.t <= 0) { this.tail = null; return null; } const T = this.tail.L; T.w = smooth(this.tail.t / 0.2); return T; }
    return null;
  }
  laserLayer(a) {
    const L = mkPose(); L.w = clamp(a.t / 0.1, 0, 1) * (a.stage === 'recover' ? clamp(1 - a.st / LASER.recover, 0, 1) : 1); const u = a.stage === 'charge' ? smooth(a.st / LASER.charge) : 1;
    const dl = _d.copy(this.aimPt).sub(this.eyeWorld(_c)).normalize(), pitch = Math.asin(clamp(dl.y, -0.7, 0.7));
    for (const k of ['UL', 'UR']) { arm(L, k, hand(k, lerp(0.38, 0.5, u), lerp(-0.62, -0.45, u), lerp(0.1, 0.18, u)), hand(k, 1.1, -0.5, -0.5)); L.curl[k] = 0.95; }
    L.d.spine = D(-0.05 * u, 0, 0); L.d.chest = D(-0.1 * u - pitch * 0.2, 0, 0); L.d.neck = D(-pitch * 0.35 + 0.1 * u, 0, 0); L.d.head = D(-pitch * 0.5 + (a.stage === 'fire' ? 0.02 * Math.sin(a.t * 80) : 0), 0, 0);
    L.d.hips = D(0.03 * u, 0, 0); return L;
  }
  /** green circuitry on the model glows brighter while he is charging / merging / in liquid form; eye flare; liquid trail; merge hum */
  updateFX(dt) {
    const g = this.g, A = this.an, ft = this.fxU; if (!this.root.visible) return;
    if (this.glowMat) { const pulse = 1 + 0.18 * Math.sin(A.t * 3.2) + 0.9 * this.eyeGlow + 0.5 * this.liquid.k + (this.techAnim ? 0.8 : 0); this.glowMat.color.copy(this.glowMat.userData.c0).multiplyScalar(pulse); }
    const eye = this.eyeWorld(_c);
    if (this.eyeGlow > 0.02 && !(this.act && this.act.kind === 'laser' && this.act.stage === 'charge')) g.fx.glow.emit({ pos: eye, size: 0.25 + 0.6 * this.eyeGlow, life: 0.05, drag: 0, color: [0.6, 1, 0.75], alpha: 0.9 });
    if (this.liquid.k > 0.4 && this.grounded) {
      ft.liq -= dt; if (ft.liq <= 0) { ft.liq = 0.06; g.fx.glow.emit({ pos: _a.set(this.pos.x + rand(-0.4, 0.4), this.pos.y + 0.08, this.pos.z + rand(-0.4, 0.4)), vel: _b.set(rand(-0.4, 0.4), rand(0.2, 0.8), rand(-0.4, 0.4)), size: rand(0.15, 0.3), life: 0.5, drag: 1.5, color: [0.15, 1, 0.45], alpha: 0.8 });
        if (this.speed > 1.5 && Math.random() < 0.3) g.fx.surface.ring(_a.set(this.pos.x, this.pos.y + 0.06, this.pos.z), UPV, 1.6, 0.35, 0x39e07a); }
    }
    // faint circuit sparks when running
    if (this.grounded && A.rn > 0.5 && !this.liquid.on) { ft.tick -= dt; if (ft.tick <= 0) { ft.tick = 0.12; g.fx.glow.emit({ pos: _a.set(this.pos.x + rand(-0.3, 0.3), this.pos.y + 0.1, this.pos.z + rand(-0.3, 0.3)), vel: _b.set(rand(-1, 1), rand(0.3, 1), rand(-1, 1)), size: 0.12, life: 0.25, drag: 2, color: GREEN, alpha: 0.7 }); } }
  }
  footstep(side) { const g = this.g, A = this.an; g.camera.addTrauma(0.005 + 0.012 * A.rn); g.sfx.thud(0.03 + 0.06 * A.rn); }
  jumpFX() { const g = this.g; this.an.landV -= 2; g.sfx.servo && g.sfx.servo(0.15); g.fx.surface.ring(_a.set(this.pos.x, this.pos.y + 0.06, this.pos.z), UPV, 2.6, 0.3, 0x4cff7a); }
  jetFX() {}
  landFX(v) {
    const g = this.g, k = clamp((v - 4) / 20, 0, 1); this.an.landV += 3 + 7 * k; g.camera.addTrauma(0.04 + 0.25 * k); g.sfx.thud(0.15 + 0.4 * k);
    const c = _a.set(this.pos.x, this.pos.y + 0.06, this.pos.z); for (let i = 0; i < 6 + 10 * k; i++) g.fx.glow.emit({ pos: c, vel: _b.set(rand(-1, 1), rand(0.2, 1), rand(-1, 1)).normalize().multiplyScalar(rand(2, 5)), size: rand(0.12, 0.25), life: 0.35, drag: 2, color: GREEN });
    if (k > 0.25) g.fx.surface.ring(c.clone(), UPV, 3 + 3 * k, 0.35, 0x4cff7a);
  }
  setFireTint() {}
  updateState() {
    if (this.techAnim) { this.state = this.techAnim.kind === 'merge' ? 'MERGING' : 'DETACHING'; return; }
    if (this.merged) { this.state = 'MERGED:' + this.merged.kind.toUpperCase() + (this.merged.controlled ? ':CONTROL' : ''); return; }
    if (this.act) { this.state = 'LASER:' + this.act.stage.toUpperCase(); return; }
    if (this.liquid.on) { this.state = this.speed > 0.5 ? 'LIQUID:FLOW' : 'LIQUID'; return; }
    super.updateState();
  }
}
