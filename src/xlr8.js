// XLR8 controller: super-speed locomotion (accelerate / sprint / drift / skid / jump), trails, and the Speed Combo.
// Runs on PLAYER time (real seconds) - it is never slowed by the time-slow ability.
import * as THREE from 'three';
import { XlrAnimator } from '../animations/xlr8anim.js';
import { XLR8_SCALE } from '../animations/xlr8rig.js';
import { RibbonTrails } from './trails.js';
import { clamp, damp, angleDelta, rand, smoothstep } from './util.js';
import { powers, findWall } from './xlr8powers.js';

export const XCFG = {
  run: 16, sprint: 44, accelRun: 52, accelSprint: 24, latGround: 56, brake: 84, coast: 40, accelAir: 6, latAir: 7,
  jumpV: 12.8, gravity: 33, crouchTime: 0.09, radius: 0.5, height: 2.1,
};
const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
const BLUE = [0.16, 0.55, 1.0], WHITE = [0.5, 0.78, 1.0];

export class XlrPlayer {
  constructor(game, rig) {
    this.g = game; this.rig = rig; this.kind = 'xlr8';
    this.root = new THREE.Group(); this.root.name = 'XLR8'; rig.modelGroup.scale.setScalar(XLR8_SCALE); this.root.add(rig.modelGroup); game.scene.add(this.root);
    this.pos = this.root.position; this.vel = new THREE.Vector3(); this.yaw = Math.PI;
    this.grounded = true; this.mode = 'ground'; this.crouchT = 0; this.jumpBuffer = 0; this.speed = 0; this.prevSpeed = 0; this.turnRate = 0;
    this.landImpact = 0; this.justJumped = false; this.skid = 0; this.hasInput = false; this.lastStep = 0; this.dustT = 0; this.state = 'IDLE';
    this.animator = new XlrAnimator(rig);
    this.trails = new RibbonTrails(game.scene, game.cam3, [
      { name: 'crest', color: WHITE, width: 0.07, life: 0.4 }, { name: 'tailtip', color: BLUE, width: 0.09, life: 0.55 },
      { name: 'tipL', color: BLUE, width: 0.05, life: 0.4 }, { name: 'tipR', color: BLUE, width: 0.05, life: 0.4 },
      { name: 'toeL', color: [0.25, 0.7, 1.0], width: 0.06, life: 0.38 }, { name: 'toeR', color: [0.25, 0.7, 1.0], width: 0.06, life: 0.38 },
    ]);
    this.act = null; this.cd = { q: 0, e: 0, f: 0, g: 0, x: 0 }; this.cdMax = { q: 2, e: 3, f: 6, g: 4, x: 12 }; this.ghosts = []; this.colH = XCFG.height; this.slideT = 0; this.wallT = 0; this.wall = null; this.wallCool = 0; this.waterT = 0; this.sink = 0; this.wading = false; this.waterRun = false; this.pstats = { dash: 0, spin: 0, clones: 0, throws: 0, hyper: 0, hits: 0, impacts: 0, wall: 0, slide: 0, water: 0 };
    this.combo = null; this.layer = { rot: {}, w: 0, spinY: 0 }; this.trailBoost = 0; this.stats = { combos: 0, hits: 0, finishers: 0 };
    this.root.rotation.y = this.yaw; this.root.visible = false;
  }

  // ----------------------------------------------------------------------------------------------- state plumbing
  activate(from) {
    this.pos.copy(from.pos); this.vel.copy(from.vel); this.vel.y = from.vel.y; this.yaw = from.yaw; this.grounded = from.grounded; this.mode = this.grounded ? 'ground' : 'air';
    this.root.rotation.y = this.yaw; this.root.visible = true; this.combo = null; this.cancelAct(); this.layer.w = 0; this.trails.clear(); this.skid = 0;
    this.animator.update(0.016, this.params(0), this.grounded); this.root.updateMatrixWorld(true);
  }
  deactivate() { this.root.visible = false; this.combo = null; this.cancelAct(); this.trails.clear(); }
  cancelAct() {
    const a = this.act; if (a && a.target && a.target.held) a.target.release();
    this.act = null; this.mode = this.grounded ? 'ground' : 'air'; this.colH = XCFG.height; this.root.rotation.z = 0; this.wall = null; this.sink = 0;
    for (const G of this.ghosts) G.grp.visible = false;
  }
  get busy() { return !!(this.combo || this.act); }
  get lockFacing() { return !!(this.combo || this.act); }
  get speedMul() { return this.combo ? 0.25 : this.act ? 0.25 : undefined; }

  // ----------------------------------------------------------------------------------------------- input
  keyDown(code) { this.powerKey(code); }
  mouseDown() { this.startCombo(); }

  // ----------------------------------------------------------------------------------------------- physics
  updatePhysics(dt, input, camYaw) {
    const w = this.g.world, c = this.combo || this.act, H = this.colH;
    for (const k in this.cd) if (this.cd[k] > 0) this.cd[k] = Math.max(0, this.cd[k] - dt);
    this.wallCool = Math.max(0, this.wallCool - dt);
    const fwd = _a.set(-Math.sin(camYaw), 0, -Math.cos(camYaw)), right = _b.set(Math.cos(camYaw), 0, -Math.sin(camYaw));
    const want = _c.set(0, 0, 0).addScaledVector(fwd, input.moveY).addScaledVector(right, input.moveX);
    const hasInput = want.lengthSq() > 1e-4; if (hasInput) want.normalize();
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt); if (input.jump) this.jumpBuffer = 0.14;
    this.justJumped = false; this.landImpact = 0;
    let top = (input.run ? XCFG.sprint : XCFG.run) * (c ? 0.25 : 1);
    const spd0 = Math.hypot(this.vel.x, this.vel.z);

    if (this.jumpBuffer > 0 && this.grounded && this.mode === 'ground' && !c) { this.mode = 'crouch'; this.crouchT = 0; this.jumpBuffer = 0; }
    if (this.mode === 'crouch') {
      this.crouchT += dt; top *= 0.6;
      if (this.crouchT >= XCFG.crouchTime) {
        const fast = smoothstep(18, 40, spd0);
        this.vel.y = XCFG.jumpV + 2.4 * fast; this.grounded = false; this.mode = 'air'; this.justJumped = true;
        if (fast > 0.05 && spd0 > 0.1) { const k = 1 + 0.16 * fast; this.vel.x *= k; this.vel.z *= k; }   // long jump: carries (and adds to) momentum
        this.takeoffFX(fast);
      }
    }

    // ---- water: wade slowly, or run across the surface when fast enough
    const wz = w.water, inW = wz && this.pos.x > wz.x0 && this.pos.x < wz.x1 && this.pos.z > wz.z0 && this.pos.z < wz.z1 && this.pos.y < 0.5 && this.mode !== 'wall';
    this.wading = false;
    if (inW && !c) {
      if (this.waterRun && spd0 > 19 && this.grounded) { this.waterT += dt; this.waterFX(dt); if (this.waterT > 3.2) this.waterRun = false; }
      else if (!this.waterRun && this.waterT < 0.01 && spd0 > 27 && this.grounded) { this.waterRun = true; this.pstats.water++; this.g.hud.toast('WATER RUN'); }
      if (!(this.waterRun && spd0 > 19)) { this.wading = true; top *= 0.5; if (this.grounded) { this.waterRun = false; this.waterT = 0.01; } }
    } else if (!inW) { this.waterRun = false; this.waterT = 0; }
    this.sink = damp(this.sink, this.wading && this.grounded ? 0.55 : 0, 10, dt);
    // ---- wall run: airborne, fast, steering into a tall wall
    if ((this.mode === 'air') && !c && this.wallCool <= 0 && spd0 > 20 && hasInput && input.run) {
      const hit = findWall(w, this.pos, want, this.pos.y); if (hit) {
        const tg = new THREE.Vector3(-hit.n.z, 0, hit.n.x); if (tg.x * this.vel.x + tg.z * this.vel.z < 0) tg.negate();
        this.mode = 'wall'; this.wall = { n: hit.n, tg, t: 0, box: hit.box, side: Math.sign(tg.x * hit.n.z * -1 + tg.z * hit.n.x) || 1, speed: Math.max(18, spd0) }; this.vel.y = 3; this.pstats.wall++; this.g.sfx.whoosh(); this.g.camera.kick(0.05);
      }
    }
    if (this.mode === 'wall') {
      const W = this.wall; W.t += dt; const hit = findWall(w, this.pos, null, this.pos.y);
      if (W.t > 0.12) { const prog = Math.hypot(this.pos.x - (W.lx ?? this.pos.x), this.pos.z - (W.lz ?? this.pos.z)) / Math.max(dt, 1e-4); W.stuck = prog < W.speed * 0.35 ? (W.stuck || 0) + dt : 0; } W.lx = this.pos.x; W.lz = this.pos.z;
      if (this.jumpBuffer > 0) { this.mode = 'air'; this.jumpBuffer = 0; this.vel.x = W.n.x * 9 + W.tg.x * W.speed * 0.8; this.vel.z = W.n.z * 9 + W.tg.z * W.speed * 0.8; this.vel.y = 12.5; this.wallCool = 0.35; this.wall = null; this.justJumped = true; this.takeoffFX(0.6); }
      else if (!hit || W.t > 1.7 || !input.run || (W.stuck || 0) > 0.06) { this.mode = 'air'; this.wallCool = 0.4; this.wall = null; this.vel.x = W.tg.x * W.speed * 0.8; this.vel.z = W.tg.z * W.speed * 0.8; }
      else { W.n.copy(hit.n); W.tg.set(-hit.n.z, 0, hit.n.x); if (W.tg.x * Math.sin(this.yaw) + W.tg.z * Math.cos(this.yaw) < 0) W.tg.negate();
        this.vel.x = W.tg.x * W.speed - W.n.x * 3; this.vel.z = W.tg.z * W.speed - W.n.z * 3; this.vel.y = Math.max(-2.5, 3 - 4.2 * W.t); this.wallFX(dt, hit); }
    }
    if (this.mode === 'slide') {
      if (this.jumpBuffer > 0 || !this.slideStep(dt)) { this.mode = 'ground'; if (this.jumpBuffer > 0) { this.mode = 'ground'; } this.colH = XCFG.height; }
    }
    if (c && c.moveVel) { this.vel.x = c.moveVel.x; this.vel.z = c.moveVel.z; }
    else {
      // velocity steering: longitudinal change uses accel/brake rates, lateral change uses a stronger "grip" rate -> drift arcs at speed
      const tx = hasInput ? want.x * top : 0, tz = hasInput ? want.z * top : 0, dx = tx - this.vel.x, dz = tz - this.vel.z;
      if (spd0 > 0.6) {
        const vx = this.vel.x / spd0, vz = this.vel.z / spd0, lon = dx * vx + dz * vz, lx = dx - lon * vx, lz = dz - lon * vz, lm = Math.hypot(lx, lz);
        const accel = this.grounded ? (spd0 > XCFG.run * 1.05 ? XCFG.accelSprint : XCFG.accelRun) : XCFG.accelAir;
        const dec = this.grounded ? (hasInput ? XCFG.coast : XCFG.brake) : 3;
        const ls = Math.min(lm, (this.grounded ? XCFG.latGround : XCFG.latAir) * dt);
        const lo = lon >= 0 ? Math.min(lon, accel * dt) : -Math.min(-lon, dec * dt);
        this.vel.x += vx * lo + (lm > 1e-6 ? lx / lm * ls : 0); this.vel.z += vz * lo + (lm > 1e-6 ? lz / lm * ls : 0);
      } else {
        const dl = Math.hypot(dx, dz), m = Math.min(dl, (this.grounded ? XCFG.accelRun : XCFG.accelAir) * dt); if (dl > 1e-6) { this.vel.x += dx / dl * m; this.vel.z += dz / dl * m; }
      }
    }
    // skid (quick stop / hard reversal): body leans back, feet slide, dust
    const vdot = spd0 > 0.1 ? (this.vel.x * want.x + this.vel.z * want.z) / spd0 : 1;
    const wantSkid = this.grounded && !c && this.mode !== 'slide' && this.mode === 'ground' && spd0 > 9 && (!hasInput || vdot < -0.25) ? 1 : 0;
    this.skid = wantSkid ? 1 : (spd0 < 4 || this.skid <= 0 ? 0 : Math.max(0, this.skid - dt * 3.5));
    if (this.skid > 0.2 && spd0 > 3) this.skidFX(dt);

    // ---- vertical
    const prevY = this.pos.y;
    if (!this.grounded && this.mode !== 'wall') {
      if (!input.jumpHeld && this.vel.y > 5 && this.mode === 'air') this.vel.y -= XCFG.gravity * 1.5 * dt;
      this.vel.y = Math.max(-50, this.vel.y - XCFG.gravity * dt);
    }
    if (c && c.hover) this.vel.y = 0;
    // ---- integrate + collide (sub-stepped: sprint is ~44 m/s and walls are thin)
    const hsp = Math.hypot(this.vel.x, this.vel.z) * dt, n = Math.max(1, Math.min(12, Math.ceil(hsp / 0.22))), h = dt / n;
    for (let i = 0; i < n; i++) {
      this.pos.x += this.vel.x * h; this.pos.z += this.vel.z * h;
      const ox = this.pos.x, oz = this.pos.z;
      w.resolveXZ(this.pos, XCFG.radius, this.pos.y, H, this.grounded ? 0.4 : 0.05);
      const moved = Math.hypot(this.pos.x - ox, this.pos.z - oz);
      if (moved > 1e-4 && !c && this.mode !== 'wall') { // slide along the surface: remove the velocity component into the push
        const nx = (this.pos.x - ox) / moved, nz = (this.pos.z - oz) / moved, vn = this.vel.x * nx + this.vel.z * nz; if (vn < 0) { this.vel.x -= nx * vn; this.vel.z -= nz * vn; }
      }
    }
    if (this.mode !== 'crouch') this.pos.y += this.vel.y * dt;
    const gy = w.groundAt(this.pos.x, this.pos.z, prevY, this.grounded ? 0.4 : 0.05, XCFG.radius * 0.6);
    if (this.mode === 'wall') { /* stays on the wall */ }
    else if (this.pos.y <= gy + 1e-4 && this.vel.y <= 0) {
      if (!this.grounded && this.vel.y < -3.5) { this.landImpact = -this.vel.y; this.landFX(this.landImpact); }
      this.pos.y = gy; this.vel.y = 0; this.grounded = true; if (this.mode === 'air') this.mode = 'ground';
    } else if (this.grounded && this.pos.y > gy + 0.06) { this.grounded = false; if (this.mode === 'ground') this.mode = 'air'; }
    if (this.grounded && this.mode !== 'crouch') this.pos.y = gy;
    if (this.mode === 'wall' && this.pos.y <= gy + 0.02) { this.mode = 'air'; this.wall = null; this.wallCool = 0.3; }
    for (const b of w.boxes) {
      if (b.min.y > this.pos.y + XCFG.height - 0.5 && b.min.y < this.pos.y + XCFG.height + 0.1 && this.vel.y > 0 &&
          this.pos.x > b.min.x - 0.4 && this.pos.x < b.max.x + 0.4 && this.pos.z > b.min.z - 0.4 && this.pos.z < b.max.z + 0.4) this.vel.y = 0;
    }
    this.speed = Math.hypot(this.vel.x, this.vel.z);

    // ---- facing
    let target = this.yaw, k = 14;
    if (c) { target = c.faceYaw; k = 40; }
    else if (this.mode === 'wall' && this.wall) { target = Math.atan2(this.wall.tg.x, this.wall.tg.z); k = 20; }
    else if (this.mode === 'slide') { k = 0; }
    else if (this.skid > 0.2) { k = 0; }
    else if (this.speed > 0.6 && (hasInput || this.speed > 2)) { target = Math.atan2(this.vel.x, this.vel.z); k = this.grounded ? 15 : 9; }
    else if (hasInput) { target = Math.atan2(want.x, want.z); k = 12; }
    const dy = angleDelta(this.yaw, target), step = k ? dy * (1 - Math.exp(-k * dt)) : 0;
    this.yaw += step; this.turnRate = damp(this.turnRate, step / Math.max(dt, 1e-4), 14, dt);
    this.root.rotation.y = this.yaw;
    { const W = this.wall; let rz = 0; if (this.mode === 'wall' && W) { const lx = Math.cos(this.yaw), lz = -Math.sin(this.yaw); rz = (W.n.x * lx + W.n.z * lz) < 0 ? 1.15 : -1.15; } this.rollTarget = rz; this.root.rotation.z = damp(this.root.rotation.z, rz, 14, dt); }
    this.root.updateMatrixWorld(true);
    this.hasInput = hasInput;
  }

  // ----------------------------------------------------------------------------------------------- per-frame animation, FX
  params(dt) {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const crouch = this.mode === 'crouch' ? clamp(this.crouchT / XCFG.crouchTime, 0, 1) : 0;
    const accel = dt > 0 ? clamp((this.speed - this.prevSpeed) / Math.max(dt, 1e-4) / 40, -1, 1) : 0; this.prevSpeed = this.speed;
    return { speed: this.speed, signedSpeed: this.vel.x * fx + this.vel.z * fz, crouch, airborne: !this.grounded, vy: this.vel.y, landImpact: this.landImpact, turnRate: this.turnRate, accel, skid: this.skid, sink: this.sink, layer: this.layer.w > 0.001 ? this.layer : null };
  }
  updateAnim(dt, camera) {
    this.updateCombo(dt); this.updateAct(dt); this.updateGhosts(dt);
    this.animator.update(dt, this.params(dt), this.grounded || this.mode === 'crouch');
    this.root.updateMatrixWorld(true);
    this.footsteps();
    this.updateTrails(dt);
    const A = this.animator;
    this.state = this.combo ? 'COMBO:' + this.combo.stage.toUpperCase() : this.act ? this.act.kind.toUpperCase() + ':' + this.act.stage.toUpperCase() : this.mode === 'wall' ? 'WALL-RUN' : this.mode === 'slide' ? 'SLIDE' : this.waterRun && this.pos.y < 0.5 && this.inWater() ? 'WATER-RUN' : this.wading ? 'WADE' : this.skid > 0.3 ? 'SKID' : this.mode === 'crouch' ? 'JUMP-CROUCH' : !this.grounded ? (this.vel.y > 0 ? 'JUMP-RISE' : 'FALL') : A.landDepth > 0.25 ? 'LAND' : A.sprintW > 0.5 ? 'SPRINT' : A.runW > 0.5 ? 'RUN' : A.walkW > 0.4 ? 'WALK' : 'IDLE';
  }
  updateTrails(dt) {
    const T = this.trails, M = this.rig.markers, v = _d, sp = this.speed;
    const gain = Math.max(smoothstep(16, 38, sp), this.trailBoost), body = Math.max(gain, this.skid * 0.3);
    for (const [name, mk, m] of [['crest', 'crest', 1], ['tailtip', 'tailtip', 1], ['tipL', 'tipL', 1], ['tipR', 'tipR', 1], ['toeL', 'toeL', 0.9], ['toeR', 'toeR', 0.9]]) { M[mk].getWorldPosition(v); T.push(name, v, body * m); }
    T.update(dt);
    // sprint wind: streak particles and dust
    if (sp > 24 && !this.combo) {
      const f = smoothstep(24, 44, sp);
      for (let i = 0; i < 1 + (f * 2 | 0); i++) { _e.copy(this.pos); _e.y += rand(0.3, 2.0); _e.x += rand(-0.9, 0.9); _e.z += rand(-0.9, 0.9); this.g.fx.glow.emit({ pos: _e, vel: _b.set(-this.vel.x * 0.25, rand(-0.1, 0.3), -this.vel.z * 0.25), size: rand(0.18, 0.38), life: rand(0.2, 0.34), drag: 2, color: [0.4, 0.78, 1], alpha: 0.7 }); }
    }
    this.dustT -= dt;
    if (this.grounded && sp > 10 && this.dustT <= 0) { this.dustT = 0.05; _e.copy(this.pos); _e.y += 0.1; _e.x += rand(-0.3, 0.3); _e.z += rand(-0.3, 0.3); this.g.fx.dust.emit({ pos: _e, vel: _b.set(-this.vel.x * 0.1 + rand(-0.4, 0.4), rand(0.2, 0.8), -this.vel.z * 0.1 + rand(-0.4, 0.4)), size: rand(0.5, 0.9), grow: 1.4, life: 0.55, drag: 2.2, color: [0.62, 0.6, 0.57], alpha: 0.4 }); }
  }
  footsteps() {
    const A = this.animator; if (!this.grounded || A.runW + A.sprintW < 0.4) { this.lastStep = Math.floor(A.phase / Math.PI); return; }
    const s = Math.floor(A.phase / Math.PI); if (s === this.lastStep) return; this.lastStep = s;
    const side = ((s % 2) + 2) % 2 ? 'ballR' : 'ballL'; this.rig.markers[side].getWorldPosition(_a); _a.y = 0.1;
    for (let i = 0; i < 3; i++) this.g.fx.dust.emit({ pos: _a, vel: _b.set(rand(-1, 1), rand(0.2, 0.7), rand(-1, 1)), size: rand(0.3, 0.55), grow: 1.1, life: 0.45, drag: 2.5, color: [0.62, 0.6, 0.57], alpha: 0.4 });
    if (A.sprintW > 0.5) this.g.camera.addTrauma(0.01);
  }
  takeoffFX(fast) {
    const fx = this.g.fx, p = this.pos.clone(); p.y += 0.08; fx.surface.ring(p, UP, 1.8 + 2 * fast, 0.35, 0x7fd8ff);
    for (let i = 0; i < 6; i++) fx.dust.emit({ pos: p.clone(), vel: new THREE.Vector3(rand(-1, 1), rand(0.2, 0.6), rand(-1, 1)).normalize().multiplyScalar(rand(1.5, 4)), size: rand(0.5, 0.9), grow: 1.2, life: 0.55, drag: 2.5, color: [0.62, 0.6, 0.57], alpha: 0.5 });
  }
  landFX(imp) {
    const fx = this.g.fx, k = clamp(imp / 16, 0.15, 1.2), p = this.pos.clone(); p.y = Math.max(p.y, 0) + 0.08;
    fx.surface.ring(p, UP, 1.6 + 2.2 * k, 0.4, 0x7fd8ff);
    for (let i = 0; i < 5 + 9 * k; i++) fx.dust.emit({ pos: p.clone(), vel: new THREE.Vector3(rand(-1, 1), rand(0.1, 0.4), rand(-1, 1)).normalize().multiplyScalar(rand(2, 5) * (0.5 + k)), size: rand(0.6, 1.1), grow: 1.5, life: rand(0.5, 0.8), drag: 2.2, color: [0.62, 0.6, 0.57], alpha: 0.55 });
    this.g.camera.addTrauma(0.06 + 0.25 * k);
  }
  skidFX(dt) {
    const fx = this.g.fx; _e.copy(this.pos); _e.y += 0.1;
    for (let i = 0; i < 2; i++) fx.dust.emit({ pos: _e.clone().add(new THREE.Vector3(rand(-0.5, 0.5), 0, rand(-0.5, 0.5))), vel: _b.set(this.vel.x * 0.12 + rand(-1, 1), rand(0.4, 1.4), this.vel.z * 0.12 + rand(-1, 1)), size: rand(0.7, 1.3), grow: 1.7, life: rand(0.5, 0.8), drag: 2, color: [0.64, 0.62, 0.58], alpha: 0.55 });
    if (Math.random() < dt * 40) fx.glow.emit({ pos: _e, vel: _b.set(rand(-1, 1), rand(0.5, 2), rand(-1, 1)), size: rand(0.15, 0.3), life: 0.25, drag: 2, color: [0.5, 0.85, 1] });
  }

  // ----------------------------------------------------------------------------------------------- Phase 4: SPEED COMBO (LMB)
  /** targets: living hittables, preferring what the camera is looking at */
  pickTarget(camYaw) {
    const f = _a.set(-Math.sin(camYaw), 0, -Math.cos(camYaw)); let best = null, bs = 1e9;
    for (const h of this.g.world.hittables) {
      if (h.dead || h.kind !== 'dummy') continue;
      const dx = h.root.position.x - this.pos.x, dz = h.root.position.z - this.pos.z, d = Math.hypot(dx, dz); if (d > 18 || d < 0.01) continue;
      const dot = (dx * f.x + dz * f.z) / d; if (dot < 0.3) continue;
      const score = d - 8 * dot; if (score < bs) { bs = score; best = h; }
    }
    return best;
  }
  startCombo() {
    if (this.act || this.mode === 'wall' || this.mode === 'slide') return;
    if (this.combo && this.combo.stage !== 'recover') return;
    const camYaw = this.g.camera.yaw, t = this.pickTarget(camYaw);
    const dir = new THREE.Vector3(-Math.sin(camYaw), 0, -Math.cos(camYaw));
    if (t) { dir.set(t.root.position.x - this.pos.x, 0, t.root.position.z - this.pos.z).normalize(); }
    this.combo = { stage: 'dash', t: 0, target: t, dir, faceYaw: Math.atan2(dir.x, dir.z), moveVel: null, strike: 0, nextAt: 0, hits: 0, struck: false, N: 5, dashT: t ? 0.34 : 0.1 };
    this.stats.combos++; this.g.sfx.whoosh(); this.g.camera.kick(0.07); this.trailBoost = 1;
  }
  /** damage everything in the strike arc: real damage + momentum impulse (accumulates in slow motion) */
  strikeHit(dmg, push, launch, final) {
    const c = this.combo, g = this.g; let any = false;
    const fwd = _a.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    for (const h of g.world.hittables) {
      if (h.dead) continue; const hp = h.root.position, dx = hp.x - this.pos.x, dz = hp.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d > 2.9 || Math.abs(hp.y - this.pos.y) > 2.6) continue;
      if (d > 0.7 && (dx * fwd.x + dz * fwd.z) / d < 0.15) continue;
      const dir = _b.set(dx, 0, dz); if (dir.lengthSq() < 1e-4) dir.copy(fwd); dir.normalize();
      const pt = _c.set(hp.x, hp.y + 1.3 + rand(-0.25, 0.25), hp.z).clone();
      h.applyHit(pt, dir.clone(), dmg); if (h.shove) h.shove(dir, push); if (launch && h.launch) h.launch(launch);
      g.hud.hit(pt, dmg, h); this.hitFX(pt, dir, final); this.stats.hits++; c.hits++; any = true;
    }
    if (any) { g.camera.addTrauma(final ? 0.6 : 0.12); if (final) g.camera.kick(0.12); g.sfx.hit(final); }
    return any;
  }
  hitFX(pt, dir, final) {
    const fx = this.g.fx, k = final ? 2.4 : 1;
    fx.glow.emit({ pos: pt, size: 1.5 * k, life: final ? 0.22 : 0.12, drag: 0, color: [0.85, 0.95, 1], alpha: 1 });
    for (let i = 0; i < 7 * k; i++) fx.glow.emit({ pos: pt, vel: _e.set(rand(-1, 1), rand(-0.3, 1), rand(-1, 1)).normalize().multiplyScalar(rand(4, 11) * (final ? 1.5 : 1)).addScaledVector(dir, 3), size: rand(0.12, 0.3), life: rand(0.15, 0.35), drag: 2, color: [0.45, 0.85, 1] });
    for (let i = 0; i < 3 * k; i++) fx.shards.emit({ pos: pt, vel: _e.set(rand(-1, 1), rand(0.4, 1.4), rand(-1, 1)).normalize().multiplyScalar(rand(3, 8)), size: rand(0.05, 0.12), life: 0.8, grav: 1 });
    if (final) fx.surface.ring(pt.clone().setY(this.pos.y + 0.08), UP, 4, 0.4, 0x9fe4ff);
  }
  updateCombo(dt) {
    const L = this.layer, c = this.combo;
    if (!c) { if (L.w > 0.001) L.w = Math.max(0, L.w - dt * 9); this.trailBoost = Math.max(0, this.trailBoost - dt * 3); return; }
    c.t += dt; const P = this.pos;
    // keep the camera-facing/target-facing direction fresh (the target may be pushed around)
    if (c.target && !c.target.dead && c.stage !== 'dash') { const dx = c.target.root.position.x - P.x, dz = c.target.root.position.z - P.z; if (Math.hypot(dx, dz) > 0.2) { c.dir.set(dx, 0, dz).normalize(); c.faceYaw = Math.atan2(c.dir.x, c.dir.z); } }
    const R = {}; let w = 1;
    if (c.stage === 'dash') {
      let reach = 1.75; const t = c.target; let dist = 99;
      if (t && !t.dead) { dist = Math.hypot(t.root.position.x - P.x, t.root.position.z - P.z); c.dir.set(t.root.position.x - P.x, 0, t.root.position.z - P.z).normalize(); c.faceYaw = Math.atan2(c.dir.x, c.dir.z); }
      if ((t && dist <= reach) || c.t >= c.dashT) { c.moveVel = null; c.stage = 'strikes'; c.t = 0; c.strike = 0; c.nextAt = 0; this.vel.x *= 0.2; this.vel.z *= 0.2; }
      else { c.moveVel = _e.copy(c.dir).multiplyScalar(t ? Math.min(48, Math.max(20, dist / 0.07)) : 36).clone(); this.dashPose(R); this.dashFX(); }
    }
    if (c.stage === 'strikes') {
      // close the gap again if knockback pushed the target away (it must be able to follow rapid hits)
      const t = c.target; if (t && !t.dead) { const d = Math.hypot(t.root.position.x - P.x, t.root.position.z - P.z); c.moveVel = d > 1.9 ? _e.copy(c.dir).multiplyScalar(Math.min(30, (d - 1.7) / dt * 0.6)).clone() : null; } else c.moveVel = null;
      const gap = 0.075;
      if (c.t >= c.nextAt && c.strike < c.N) { c.strikeStart = c.t; this.strikeHit(8, 2.6, 0, false); c.strike++; c.nextAt += gap; }
      this.strikePose(R, c);
      if (c.strike >= c.N && c.t >= c.nextAt) { c.stage = 'windup'; c.t = 0; c.moveVel = null; }
    } else if (c.stage === 'windup') {
      this.finisherPose(R, c, c.t / 0.13, false);
      if (c.t >= 0.13) { c.stage = 'final'; c.t = 0; c.struck = false; }
    } else if (c.stage === 'final') {
      if (!c.struck) { c.struck = true; this.strikeHit(20, 15, 7.5, true); this.stats.finishers++; this.finalFX(); }
      this.finisherPose(R, c, c.t / 0.2, true);
      if (c.t >= 0.2) { c.stage = 'recover'; c.t = 0; }
    } else if (c.stage === 'recover') {
      w = 1 - c.t / 0.22; this.finisherPose(R, c, 1, true);
      if (c.t >= 0.22) { this.combo = null; w = 0; }
    }
    L.rot = R; L.w = Math.max(L.w, 0) + (Math.min(1, w) - L.w) * Math.min(1, dt * 28);
  }
  dashFX() { this.trailBoost = 1; if (Math.random() < 0.8) { _e.copy(this.pos); _e.y += rand(0.2, 1.8); this.g.fx.glow.emit({ pos: _e, size: rand(0.5, 0.9), life: 0.25, drag: 3, color: [0.35, 0.8, 1], alpha: 0.8 }); } }
  finalFX() { const fx = this.g.fx; fx.surface.ring(this.pos.clone().setY(this.pos.y + 0.08), UP, 5.5, 0.45, 0x9fe4ff); for (let i = 0; i < 14; i++) fx.dust.emit({ pos: this.pos.clone().setY(this.pos.y + 0.2), vel: _e.set(rand(-1, 1), rand(0, 0.5), rand(-1, 1)).normalize().multiplyScalar(rand(3, 8)), size: rand(1, 1.8), grow: 2, life: rand(0.5, 0.9), drag: 2, color: [0.62, 0.6, 0.57], alpha: 0.5 }); }
  dashPose(R) {
    R.hips = [0.5, 0, 0]; R.spine = [0.15, 0, 0]; R.chest = [0.1, 0, 0]; R.head = [-0.45, 0, 0];
    R.uarmL = [1.35, 0, 0.1]; R.uarmR = [1.35, 0, -0.1]; R.farmL = [-0.1, 0, 0]; R.farmR = [-0.1, 0, 0];
    R.thighL = [-0.95, 0, 0]; R.shinL = [0.9, 0, 0]; R.thighR = [0.35, 0, 0]; R.shinR = [0.55, 0, 0]; R.footL = [-0.2, 0, 0]; R.footR = [0.4, 0, 0];
    R.tail1 = [0.4, 0, 0]; R.tail2 = [0.2, 0, 0]; R.tail3 = [0.1, 0, 0];
  }
  strikePose(R, c) {
    // alternating claw strikes: the striking arm snaps forward and back while the torso twists into it
    const gap = 0.075, i = Math.max(0, c.strike - 1), u = clamp((c.t - (c.nextAt - gap)) / gap, 0, 1), ext = Math.sin(Math.PI * Math.min(1, u * 1.15));
    const side = i % 2 ? 'L' : 'R', other = side === 'L' ? 'R' : 'L', sg = side === 'L' ? -1 : 1;
    R.hips = [0.28, 0.0, 0]; R.spine = [0.12, sg * 0.5 * ext, 0]; R.chest = [0.05, sg * 0.35 * ext, 0]; R.head = [-0.25, -sg * 0.2 * ext, 0];
    R['uarm' + side] = [-1.45 * ext + 0.1, 0, 0.12 * sg]; R['farm' + side] = [-0.35 * ext, 0, 0]; R['hand' + side] = [-0.5 * ext, 0, sg * 0.5 * ext];
    R['uarm' + other] = [0.55, 0, -0.12 * sg]; R['farm' + other] = [-0.95, 0, 0];
    R.thighL = [-0.55, 0.1, 0]; R.shinL = [0.6, 0, 0]; R.thighR = [-0.2, -0.1, 0]; R.shinR = [0.5, 0, 0]; R.footL = [-0.2, 0, 0];
    R.tail1 = [0.3, -sg * 0.25 * ext, 0]; R.tail2 = [0.1, -sg * 0.4 * ext, 0];
  }
  finisherPose(R, c, u, striking) {
    u = clamp(u, 0, 1);
    if (!striking) {            // wind-up: both arms drawn back, torso coiled
      R.hips = [0.2, 0.3 * u, 0]; R.spine = [0.1, 0.7 * u, 0]; R.chest = [0.05, 0.5 * u, 0]; R.head = [-0.2, -0.3 * u, 0];
      R.uarmR = [1.5 * u, 0, -0.3 * u]; R.farmR = [-0.8 * u, 0, 0]; R.uarmL = [0.6 * u, 0, 0.1]; R.farmL = [-0.8 * u, 0, 0];
      R.thighL = [-0.6 * u, 0, 0]; R.shinL = [0.7 * u, 0, 0]; R.thighR = [0.3 * u, 0, 0]; R.shinR = [0.7 * u, 0, 0];
      R.tail1 = [0.2, 0.3 * u, 0]; return;
    }
    const e = 1 - Math.pow(1 - u, 3);
    R.hips = [0.32, -0.25 * e, 0]; R.spine = [0.15, 0.7 - 1.4 * e, 0]; R.chest = [0.05, 0.5 - 1.0 * e, 0]; R.head = [-0.3, 0.3, 0];
    R.uarmR = [1.5 - 3.3 * e, 0, -0.1]; R.farmR = [-0.8 + 0.7 * e, 0, 0]; R.handR = [-0.4, 0, -0.4]; R.uarmL = [0.7, 0, 0.3]; R.farmL = [-0.9, 0, 0];
    R.thighL = [-0.9, 0, 0]; R.shinL = [1.0, 0, 0]; R.thighR = [0.5, 0, 0]; R.shinR = [0.9, 0, 0]; R.footR = [0.4, 0, 0];
    R.tail1 = [0.3, 0.6 * e, 0]; R.tail2 = [0.1, 0.8 * e, 0]; R.tail3 = [0, 0.5 * e, 0];
  }

  inWater() { const L = this.g.world.lagoon; if (L && L.island) return L.inRect(this.pos.x, this.pos.z); const z = this.g.world.water; return !!z && this.pos.x > z.x0 && this.pos.x < z.x1 && this.pos.z > z.z0 && this.pos.z < z.z1; }
  waterFX(dt) { const fx = this.g.fx; for (const m of ['ballL', 'ballR']) { if (Math.random() < dt * 30) { this.rig.markers[m].getWorldPosition(_a); _a.y = 0.05; fx.glow.emit({ pos: _a, vel: _b.set(rand(-1, 1), rand(1, 3.5), rand(-1, 1)), size: rand(0.2, 0.4), life: 0.4, drag: 1, color: [0.6, 0.9, 1], alpha: 0.8 }); } } if (Math.random() < dt * 8) this.g.fx.surface.ring(this.pos.clone().setY(this.pos.y + 0.06), UP, 1.6, 0.35, 0xbfe9ff); }
  wallFX(dt, hit) { _a.copy(this.pos).addScaledVector(hit.n, -0.45); _a.y += rand(0.1, 0.5); if (Math.random() < dt * 40) this.g.fx.dust.emit({ pos: _a, vel: _b.set(rand(-1, 1), rand(0, 1.5), rand(-1, 1)), size: rand(0.4, 0.8), grow: 1.3, life: 0.5, drag: 2, color: [0.65, 0.63, 0.6], alpha: 0.5 }); if (Math.random() < dt * 20) this.g.fx.glow.emit({ pos: _a, vel: _b.set(rand(-1, 1), rand(0.5, 2), rand(-1, 1)), size: rand(0.15, 0.3), life: 0.25, drag: 2, color: [0.5, 0.85, 1] }); this.trailBoost = 1; }
  /** dispatcher for scripted powers + the slide / wall-run pose layers */
  updateAct(dt) {
    const L = this.layer, a = this.act;
    if (this.combo) return;
    const R = {}; let w = 1; L.spinY = 0;
    if (a) {
      a.t += dt; a.w = undefined;
      ({ dash: () => this.updateDash(dt, a, R), spin: () => this.updateSpin(dt, a, R, L), clones: () => this.updateClones(dt, a, R), throw: () => this.updateThrow(dt, a, R), hyper: () => this.updateHyper(dt, a, R) })[a.kind]();
      if (!this.act) { w = 0; } else if (a.w !== undefined) w = clamp(a.w, 0, 1);
    } else if (this.mode === 'slide') this.slidePose(R);
    else if (this.mode === 'wall') this.wallPose(R, this.wall ? this.wall.t : 0);
    else { if (L.w > 0.001) L.w = Math.max(0, L.w - dt * 9); if (this.trailBoost > 0) this.trailBoost = Math.max(0, this.trailBoost - dt * 3); L.rot = L.rot || {}; return; }
    L.rot = R; L.w += (w - L.w) * Math.min(1, dt * 28);
  }
  slidePose(R) {
    R.hips = [-0.5, 0, 0]; R.spine = [-0.45, 0, 0]; R.chest = [-0.2, 0, 0]; R.head = [0.5, 0, 0]; R.neck = [0.2, 0, 0];
    R.thighL = [-1.45, 0, 0.1]; R.thighR = [-1.3, 0, -0.1]; R.shinL = [0.15, 0, 0]; R.shinR = [0.3, 0, 0]; R.footL = [0.3, 0, 0]; R.footR = [0.3, 0, 0];
    R.uarmL = [-0.2, 0, 0.9]; R.uarmR = [-0.2, 0, -0.9]; R.farmL = [-0.3, 0, 0]; R.farmR = [-0.3, 0, 0]; R.tail1 = [-0.1, 0, 0];
  }
  wallPose(R, t) {
    const s = Math.sin(t * 22);
    R.hips = [0.35, 0, 0]; R.spine = [0.1, 0, 0]; R.head = [-0.3, 0, 0];
    R.thighL = [-0.9 * s, 0, 0]; R.thighR = [0.9 * s, 0, 0]; R.shinL = [0.8 + 0.5 * s, 0, 0]; R.shinR = [0.8 - 0.5 * s, 0, 0];
    R.uarmL = [-0.8 * s, 0, 0.3]; R.uarmR = [0.8 * s, 0, -0.3]; R.farmL = [-0.5, 0, 0]; R.farmR = [-0.5, 0, 0]; R.tail1 = [0.3, 0, 0]; R.tail2 = [0.2, 0, 0];
  }
}
Object.assign(XlrPlayer.prototype, powers);
