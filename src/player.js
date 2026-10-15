// Player controller: camera-relative movement, jump (crouch -> launch -> air -> land), crystal dash, facing/turning.
import * as THREE from 'three';
import { Animator } from '../animations/animator.js';
import { MODEL_SCALE } from '../animations/rig.js';
import { clamp, damp, angleDelta, rand } from './util.js';

export const CFG = {
  walk: 3.4, run: 7.6, accelGround: 38, decelGround: 30, accelAir: 12,
  jumpV: 11.6, gravity: 29, crouchTime: 0.13, radius: 0.55, height: 2.6,
  dashSpeed: 25, dashTime: 0.22, dashCooldown: 0.85, aimSpeedMul: 0.7,
};
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

export class Player {
  constructor(game, rig) {
    this.g = game; this.rig = rig;
    this.root = new THREE.Group(); this.root.name = 'Player';
    rig.modelGroup.scale.setScalar(MODEL_SCALE); this.root.add(rig.modelGroup);
    game.scene.add(this.root);
    this.pos = this.root.position; this.pos.set(0, 0, 14);
    this.vel = new THREE.Vector3(); this.yaw = Math.PI;      // faces -Z (toward the range)
    this.grounded = true; this.mode = 'ground'; this.crouchT = 0; this.dashT = 0; this.dashCd = 0; this.dashDir = new THREE.Vector3(0, 0, -1);
    this.jumpBuffer = 0; this.speed = 0; this.prevSpeed = 0; this.turnRate = 0; this.landImpact = 0; this.justJumped = false;
    this.animator = new Animator(rig); this.lastStep = 0; this.trailT = 0;
    this.root.rotation.y = this.yaw; this.root.updateMatrixWorld(true);
    this.animator.update(0.016, this.baseParams(), true);
  }

  baseParams() { return { speed: 0, signedSpeed: 0, crouch: 0, airborne: false, vy: 0, dash: false, landImpact: 0, justJumped: false, turnRate: 0, accel: 0, moving: false, aim: null }; }

  /** @param input {moveX, moveY (forward +), run, jump (edge), jumpHeld, dash (edge)}  @param camYaw camera yaw  @param power CrystalProjectiles */
  updatePhysics(dt, input, camYaw, power) {
    const g = this.g, w = g.world, fx = g.fx;
    // ---- intent
    const fwd = _v.set(-Math.sin(camYaw), 0, -Math.cos(camYaw)), right = _v2.set(Math.cos(camYaw), 0, -Math.sin(camYaw));
    const want = _v3.set(0, 0, 0).addScaledVector(fwd, input.moveY).addScaledVector(right, input.moveX);
    const hasInput = want.lengthSq() > 1e-4; if (hasInput) want.normalize();
    const aiming = power.busy;
    let topSpeed = (input.run ? CFG.run : CFG.walk) * (aiming ? (power.speedMul ?? CFG.aimSpeedMul) : 1);
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt); if (input.jump) this.jumpBuffer = 0.14;
    this.justJumped = false; this.landImpact = 0;

    // ---- dash
    if (input.dash && this.dashCd <= 0 && this.mode !== 'crouch' && !power.noDash) this.startDash(hasInput ? want : null, camYaw);
    // ---- jump
    if (this.jumpBuffer > 0 && this.grounded && (this.mode === 'ground')) { this.mode = 'crouch'; this.crouchT = 0; this.jumpBuffer = 0; }

    if (this.mode === 'crouch') {
      this.crouchT += dt; topSpeed *= 0.55;
      if (this.crouchT >= CFG.crouchTime) { this.vel.y = CFG.jumpV; this.grounded = false; this.mode = 'air'; this.justJumped = true; this.takeoffFX(); }
    }
    if (this.mode === 'dash') {
      this.dashT -= dt;
      this.vel.x = this.dashDir.x * CFG.dashSpeed; this.vel.z = this.dashDir.z * CFG.dashSpeed;
      this.dashFX(dt);
      if (this.dashT <= 0) { this.mode = this.grounded ? 'ground' : 'air'; this.vel.x *= 0.45; this.vel.z *= 0.45; }
    } else {
      const tx = want.x * topSpeed * (hasInput ? 1 : 0), tz = want.z * topSpeed * (hasInput ? 1 : 0);
      const dx = tx - this.vel.x, dz = tz - this.vel.z, dl = Math.hypot(dx, dz);
      const rate = this.grounded ? (hasInput ? CFG.accelGround : CFG.decelGround) : CFG.accelAir;
      const m = Math.min(dl, rate * dt); if (dl > 1e-6) { this.vel.x += dx / dl * m; this.vel.z += dz / dl * m; }
    }

    // ---- vertical
    const prevY = this.pos.y;
    if (!this.grounded || this.mode === 'crouch') {
      if (!(this.mode === 'crouch')) {
        const grav = this.mode === 'dash' ? CFG.gravity * 0.15 : CFG.gravity;
        if (!input.jumpHeld && this.vel.y > 4.5 && this.mode === 'air') this.vel.y -= grav * 1.6 * dt; // short hop when released early
        this.vel.y = Math.max(-45, this.vel.y - grav * dt);
      }
    }
    // ---- integrate + collide
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    if (this.lunge && this.lunge.t > 0) { this.lunge.t -= dt; this.pos.x += this.lunge.dir.x * this.lunge.speed * dt; this.pos.z += this.lunge.dir.z * this.lunge.speed * dt; }
    const stepH = this.grounded ? 0.4 : 0.05;
    w.resolveXZ(this.pos, CFG.radius, this.pos.y, CFG.height, stepH);
    if (this.mode !== 'crouch') this.pos.y += this.vel.y * dt;
    const gy = w.groundAt(this.pos.x, this.pos.z, prevY, this.grounded ? 0.4 : 0.05, CFG.radius * 0.6);
    if (this.pos.y <= gy + 1e-4 && this.vel.y <= 0) {
      if (!this.grounded && this.vel.y < -3.5) { this.landImpact = -this.vel.y; this.landFX(this.landImpact); }
      this.pos.y = gy; this.vel.y = 0; this.grounded = true; if (this.mode === 'air') this.mode = 'ground';
    } else if (this.grounded && this.pos.y > gy + 0.06) { this.grounded = false; if (this.mode === 'ground') this.mode = 'air'; }
    if (this.grounded && this.mode !== 'crouch') this.pos.y = gy;
    // head bump
    for (const b of w.boxes) {
      if (b.min.y > this.pos.y + CFG.height - 0.5 && b.min.y < this.pos.y + CFG.height + 0.1 && this.vel.y > 0 &&
          this.pos.x > b.min.x - 0.4 && this.pos.x < b.max.x + 0.4 && this.pos.z > b.min.z - 0.4 && this.pos.z < b.max.z + 0.4) this.vel.y = 0;
    }
    this.speed = Math.hypot(this.vel.x, this.vel.z);

    // ---- facing
    let target = this.yaw, k = 13;
    if (this.mode === 'dash') { target = Math.atan2(this.dashDir.x, this.dashDir.z); k = 30; }
    else if (power.lockFacing) { target = power.faceYaw !== undefined ? power.faceYaw : Math.atan2(-Math.sin(camYaw), -Math.cos(camYaw)); k = 20; }
    else if (this.speed > 0.6 && hasInput) { target = Math.atan2(this.vel.x, this.vel.z); k = this.grounded ? 12 : 8; }
    const dy = angleDelta(this.yaw, target); const step = dy * (1 - Math.exp(-k * dt));
    this.yaw += step; this.turnRate = damp(this.turnRate, step / Math.max(dt, 1e-4), 14, dt);
    this.root.rotation.y = this.yaw; this.root.updateMatrixWorld(true);
    this.hasInput = hasInput;
  }

  lungeStart(dir, speed, dur) { this.lunge = { dir: dir.clone().setY(0).normalize(), speed, t: dur }; }

  updateAnim(dt, aim, layer = null) {
    const fwdX = Math.sin(this.yaw), fwdZ = Math.cos(this.yaw);
    const signed = this.vel.x * fwdX + this.vel.z * fwdZ;
    const crouch = this.mode === 'crouch' ? clamp(this.crouchT / CFG.crouchTime, 0, 1) : 0;
    const accel = clamp((this.speed - this.prevSpeed) / Math.max(dt, 1e-4) / 40, -1, 1); this.prevSpeed = this.speed;
    const p = {
      speed: this.speed, signedSpeed: signed, crouch, airborne: !this.grounded, vy: this.vel.y, dash: this.mode === 'dash',
      landImpact: this.landImpact, justJumped: this.justJumped, turnRate: this.turnRate, accel, moving: this.speed > 1, aim, layer,
    };
    this.animator.update(dt, p, this.grounded || this.mode === 'crouch');
    this.footsteps(dt);
    this.state = this.mode === 'dash' ? 'DASH' : this.mode === 'crouch' ? 'JUMP-CROUCH' : !this.grounded ? (this.vel.y > 0 ? 'JUMP-RISE' : 'FALL') : this.animator.landDepth > 0.25 ? 'LAND' : this.animator.runW > 0.55 ? 'RUN' : this.animator.walkW > 0.4 ? 'WALK' : 'IDLE';
  }

  // ------------------------------------------------------------ gameplay FX
  startDash(dirIn, camYaw) {
    this.mode = 'dash'; this.dashT = CFG.dashTime; this.dashCd = CFG.dashCooldown;
    this.dashDir.copy(dirIn || _v.set(Math.sin(this.yaw), 0, Math.cos(this.yaw))).setY(0).normalize();
    const fx = this.g.fx; this.g.camera.addTrauma(0.18); this.g.camera.kick(0.09);
    const p = this.pos.clone(); p.y += 0.1;
    if (this.grounded) fx.surface.ring(p, new THREE.Vector3(0, 1, 0), 2.6, 0.4);
    for (let i = 0; i < 10; i++) fx.dust.emit({ pos: p.clone().add(new THREE.Vector3(rand(-0.6, 0.6), 0.1, rand(-0.6, 0.6))), vel: new THREE.Vector3(-this.dashDir.x * rand(1, 5) + rand(-1, 1), rand(0.3, 1.6), -this.dashDir.z * rand(1, 5) + rand(-1, 1)), size: rand(0.7, 1.4), grow: 1.6, life: rand(0.5, 0.9), drag: 2.2, color: [0.62, 0.6, 0.57], alpha: 0.6 });
    for (let i = 0; i < 8; i++) fx.shards.emit({ pos: p.clone().add(new THREE.Vector3(0, 0.4, 0)), vel: new THREE.Vector3(-this.dashDir.x * rand(2, 8) + rand(-2, 2), rand(1, 5), -this.dashDir.z * rand(2, 8) + rand(-2, 2)), size: rand(0.1, 0.24), life: 1.0 });
  }
  dashFX(dt) {
    const fx = this.g.fx; this.trailT -= dt;
    // crystal energy trail: dense glow along the path + crystals left behind
    for (let i = 0; i < 4; i++) {
      _v.copy(this.pos); _v.y += rand(0.2, 2.3); _v.x += rand(-0.5, 0.5) - this.dashDir.x * rand(0, 0.8); _v.z += rand(-0.5, 0.5) - this.dashDir.z * rand(0, 0.8);
      fx.glow.emit({ pos: _v, vel: _v2.set(rand(-0.6, 0.6), rand(-0.3, 0.6), rand(-0.6, 0.6)), size: rand(0.5, 0.95), life: rand(0.25, 0.45), drag: 3, color: [0.25, 1, 0.55], alpha: 0.9 });
    }
    if (this.trailT <= 0) {
      this.trailT = 0.03; _v.copy(this.pos); _v.y += rand(0.1, 0.5);
      fx.shards.emit({ pos: _v, vel: _v2.set(-this.dashDir.x * 2 + rand(-1, 1), rand(0.5, 2.5), -this.dashDir.z * 2 + rand(-1, 1)), size: rand(0.1, 0.28), life: 0.8, grav: 0.8 });
    }
    if (this.grounded) { _v.copy(this.pos); _v.y += 0.15; fx.dust.emit({ pos: _v, vel: _v2.set(rand(-0.5, 0.5), rand(0.2, 0.8), rand(-0.5, 0.5)), size: rand(0.6, 1.1), grow: 1.4, life: 0.6, drag: 2, color: [0.62, 0.6, 0.57], alpha: 0.5 }); }
  }
  takeoffFX() {
    const fx = this.g.fx, p = this.pos.clone(); p.y += 0.08;
    fx.surface.ring(p, new THREE.Vector3(0, 1, 0), 2.0, 0.35);
    for (let i = 0; i < 6; i++) fx.dust.emit({ pos: p.clone(), vel: new THREE.Vector3(rand(-1, 1), rand(0.2, 0.6), rand(-1, 1)).normalize().multiplyScalar(rand(1.5, 3.5)), size: rand(0.6, 1.0), grow: 1.2, life: 0.6, drag: 2.5, color: [0.62, 0.6, 0.57], alpha: 0.5 });
    this.g.camera.addTrauma(0.05);
  }
  landFX(impact) {
    const fx = this.g.fx, k = clamp(impact / 16, 0.15, 1.2), p = this.pos.clone(); p.y = Math.max(p.y, 0) + 0.08;
    fx.surface.ring(p, new THREE.Vector3(0, 1, 0), 1.8 + 2.5 * k, 0.45);
    for (let i = 0; i < 6 + 10 * k; i++) fx.dust.emit({ pos: p.clone(), vel: new THREE.Vector3(rand(-1, 1), rand(0.1, 0.4), rand(-1, 1)).normalize().multiplyScalar(rand(2, 5) * (0.5 + k)), size: rand(0.7, 1.3), grow: 1.5, life: rand(0.5, 0.9), drag: 2.2, color: [0.62, 0.6, 0.57], alpha: 0.6 });
    for (let i = 0; i < 4 + 8 * k; i++) fx.shards.emit({ pos: p.clone(), vel: new THREE.Vector3(rand(-1, 1), rand(0.4, 1.2), rand(-1, 1)).normalize().multiplyScalar(rand(2, 6) * (0.6 + k)), size: rand(0.06, 0.18), life: 1.0 });
    this.g.camera.addTrauma(0.1 + 0.3 * k);
  }
  footsteps(dt) { // heavy-footed puffs on run footfalls
    const a = this.animator; if (!this.grounded || a.runW < 0.5) { this.lastStep = Math.floor(a.phase / Math.PI); return; }
    const s = Math.floor(a.phase / Math.PI); if (s === this.lastStep) return; this.lastStep = s;
    const fx = this.g.fx, side = ((s % 2) + 2) % 2 ? 'footR' : 'footL';
    this.rig.markers[side === 'footL' ? 'toeL' : 'toeR'].getWorldPosition(_v); _v.y = 0.1;
    for (let i = 0; i < 3; i++) fx.dust.emit({ pos: _v, vel: _v2.set(rand(-1, 1), rand(0.2, 0.7), rand(-1, 1)), size: rand(0.4, 0.7), grow: 1.1, life: 0.5, drag: 2.5, color: [0.62, 0.6, 0.57], alpha: 0.4 });
    this.g.camera.addTrauma(0.012);
  }
}
