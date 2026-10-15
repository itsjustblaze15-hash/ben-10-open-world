// Four Arms controller: heavy locomotion (walk / run / jump / heavy landing / climb / vault), procedural four-arm animation driven by
// IK on the supplied GLB's real skeleton, grip layers for carried objects, block pose, rage aura. Powers live in fa_powers.js.
// Runs on PLAYER time (real seconds). Everything it hits reacts on WORLD time in the target's own update.
import * as THREE from 'three';
import { FaPoser, FA_SCALE } from '../animations/fourarmsrig.js';
import { clamp, damp, lerp, angleDelta, rand, smoothstep } from './util.js';
import { ARMS, SIDE, V, hand, mkPose, arm, smooth, K, D, squat, layer } from './fa_pose.js';
import { powers } from './fa_powers.js';

export const FCFG = { walk: 4.4, run: 8.8, accelG: 24, brake: 36, accelA: 7, latG: 26, jumpV: 16.5, grav: 34, radius: 0.85, height: 3.0, crouchT: 0.2, hp: 400 };
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const TAU = Math.PI * 2;

export class FaPlayer {
  constructor(game, rig) {
    this.g = game; this.rig = rig; this.kind = 'fourarms';
    this.root = new THREE.Group(); this.root.name = 'FourArms'; rig.modelGroup.scale.setScalar(FA_SCALE); this.root.add(rig.modelGroup); game.scene.add(this.root);
    this.poser = new FaPoser(rig);
    this.pos = this.root.position; this.vel = new THREE.Vector3(); this.yaw = Math.PI; this.grounded = true; this.mode = 'ground';
    this.speed = 0; this.crouchT = 0; this.jumpBuffer = 0; this.landImpact = 0; this.hasInput = false; this.state = 'IDLE'; this.colH = FCFG.height;
    this.hp = FCFG.hp; this.hpT = 0; this.hurtT = 0; this.stats = { punches: 0, hits: 0, grabs: 0, throws: 0, slams: 0, pounds: 0, seismic: 0, propHits: 0, walls: 0, climbs: 0, vaults: 0, rage: 0, blocks: 0, pushes: 0 };
    this.an = { t: 0, ps: 0, mv: 0, rn: 0, air: 0, land: 0, landV: 0, crouch: 0, clm: 0, blk: 0, rage: 0, accel: 0, prevSpeed: 0, stepSide: 0, lean: 0, turn: 0 };
    this.climb = null; this.pushT = 0; this.lastCharge = 0;
    this.initPowers(game);
    this.root.rotation.y = this.yaw; this.root.visible = false;
    this.poser.apply(this.locoPose(0.016));
  }

  // ------------------------------------------------------------------------------------------------ plumbing
  activate(from) {
    this.pos.copy(from.pos); this.vel.copy(from.vel); this.vel.y = from.vel.y; this.yaw = from.yaw; this.grounded = from.grounded; this.mode = this.grounded ? 'ground' : 'air';
    this.root.rotation.y = this.yaw; this.root.visible = true; this.cancelAll(); this.climb = null; this.an.land = this.an.landV = 0;
    const w = this.g.world; w.resolveXZ(this.pos, FCFG.radius, this.pos.y, FCFG.height, 0.4);
    this.root.updateMatrixWorld(true); this.poser.apply(this.locoPose(0.016));
  }
  deactivate() { this.cancelAll(); this.root.visible = false; this.aura.visible = false; this.light.intensity = 0; this.arcLine.visible = false; this.arcEnd.visible = false; this.mark.visible = false; $('ragefx') && ($('ragefx').style.opacity = '0'); }
  get busy() { return !!(this.act || this.combo || this.holds.length || this.blocking); }
  get dmgMul() { return this.rage.on ? 1.8 : 1; }
  get kbMul() { return this.rage.on ? 1.6 : 1; }
  get tempoMul() { return this.rage.on ? 0.72 : 1; }

  // ------------------------------------------------------------------------------------------------ physics
  updatePhysics(dt, input, camYaw) {
    const w = this.g.world, A = this.an, R = FCFG, H = this.colH; this.landImpact = 0;
    const fwd = _a.set(-Math.sin(camYaw), 0, -Math.cos(camYaw)), right = _b.set(Math.cos(camYaw), 0, -Math.sin(camYaw));
    const want = _c.set(0, 0, 0).addScaledVector(fwd, input.moveY).addScaledVector(right, input.moveX); const hasInput = want.lengthSq() > 1e-4; if (hasInput) want.normalize();
    this.hasInput = hasInput; this.wantDir.copy(want); this.jumpBuffer = Math.max(0, this.jumpBuffer - dt); if (input.jump) this.jumpBuffer = 0.16;
    // ---- climbing / vaulting is a scripted motion
    if (this.climb) { this.updateClimb(dt); this.speed = 0; this.root.rotation.y = this.yaw; this.root.updateMatrixWorld(true); return; }
    // ---- speed limits
    const a = this.act, locked = a && a.lockMove;
    let top = (input.run ? R.run : R.walk) * (this.rage.on ? 1.12 : 1) * this.speedMulHold() * (this.blocking ? 0.45 : 1) * (a ? (a.speedMul ?? 0.35) : 1) * (this.combo ? 0.4 : 1);
    if (locked) top = 0;
    // ---- jump (crouch -> launch)
    if (this.jumpBuffer > 0 && this.grounded && this.mode === 'ground' && !a && !this.combo && !this.holdLifting()) {
      if (!this.tryClimb(want, true)) { this.mode = 'crouch'; this.crouchT = 0; this.jumpBuffer = 0; }
    }
    if (this.mode === 'crouch') {
      this.crouchT += dt; top *= 0.3;
      if (this.crouchT >= R.crouchT) { this.vel.y = R.jumpV * (this.holds.length ? 0.82 : 1); this.grounded = false; this.mode = 'air'; this.jumpFX(); }
    }
    if (this.mode === 'air' && !a && this.vel.y < 7 && hasInput && !this.holds.length) this.tryClimb(want, false);
    if (this.climb) { this.root.rotation.y = this.yaw; this.root.updateMatrixWorld(true); return; }
    // ---- horizontal velocity
    const mvv = a ? a.moveVel : (this.combo ? this.combo.moveVel : null);
    if (mvv) { this.vel.x = mvv.x; this.vel.z = mvv.z; }
    else {
      const tx = hasInput ? want.x * top : 0, tz = hasInput ? want.z * top : 0, dx = tx - this.vel.x, dz = tz - this.vel.z, dl = Math.hypot(dx, dz);
      const spd0 = Math.hypot(this.vel.x, this.vel.z), turning = hasInput && spd0 > 1 ? (this.vel.x * want.x + this.vel.z * want.z) / spd0 : 1;
      const rate = this.grounded ? (hasInput ? (turning < 0.2 ? R.latG : R.accelG) : R.brake) : R.accelA; const m = Math.min(dl, rate * dt * (this.rage.on ? 1.2 : 1));
      if (dl > 1e-6) { this.vel.x += dx / dl * m; this.vel.z += dz / dl * m; }
    }
    // ---- vertical
    const prevY = this.pos.y;
    if (!this.grounded) this.vel.y = Math.max(-60, this.vel.y - (this.act && this.act.grav ? this.act.grav : R.grav) * dt);
    if (a && a.hover) this.vel.y = 0;
    // ---- integrate + collide (sub-stepped)
    const hsp = Math.hypot(this.vel.x, this.vel.z) * dt, n = Math.max(1, Math.min(8, Math.ceil(hsp / 0.3))), h = dt / n; this.pushing = null;
    for (let i = 0; i < n; i++) {
      this.pos.x += this.vel.x * h; this.pos.z += this.vel.z * h; const ox = this.pos.x, oz = this.pos.z;
      w.resolveXZ(this.pos, R.radius, this.pos.y, H, this.grounded ? 0.4 : 0.05);
      const moved = Math.hypot(this.pos.x - ox, this.pos.z - oz);
      if (moved > 1e-4) {
        const nx = (this.pos.x - ox) / moved, nz = (this.pos.z - oz) / moved, vn = this.vel.x * nx + this.vel.z * nz;
        if (vn < -1) this.contact(nx, nz, -vn, hasInput);
        if (vn < 0) { this.vel.x -= nx * vn; this.vel.z -= nz * vn; }
      }
    }
    this.pos.y += this.vel.y * dt;
    const gy = w.groundAt(this.pos.x, this.pos.z, prevY, this.grounded ? 0.4 : 0.05, R.radius * 0.6);
    if (this.mode === 'crouch') { /* planted */ }
    else if (this.pos.y <= gy + 1e-4 && this.vel.y <= 0) {
      if (!this.grounded && this.vel.y < -5) { this.landImpact = -this.vel.y; this.landFX(this.landImpact); }
      this.pos.y = gy; this.vel.y = 0; this.grounded = true; if (this.mode === 'air') this.mode = 'ground';
    } else if (this.grounded && this.pos.y > gy + 0.06) { this.grounded = false; if (this.mode === 'ground') this.mode = 'air'; }
    if (this.grounded && this.mode !== 'crouch') this.pos.y = gy;
    for (const b of w.boxes) {
      if (b.min.y > this.pos.y + H - 0.6 && b.min.y < this.pos.y + H + 0.1 && this.vel.y > 0 && this.pos.x > b.min.x - 0.5 && this.pos.x < b.max.x + 0.5 && this.pos.z > b.min.z - 0.5 && this.pos.z < b.max.z + 0.5) this.vel.y = 0;
    }
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    // ---- facing (heavy: turns noticeably slower than XLR8)
    let target = this.yaw, k = 9;
    if (a && a.faceYaw !== undefined) { target = a.faceYaw; k = a.faceK ?? 22; }
    else if (this.combo) { target = this.combo.faceYaw; k = 20; }
    else if (this.holds.length && this.holds.some(x => x.aimFace)) { target = Math.atan2(this.camAim().x, this.camAim().z); k = 12; }
    else if (this.blocking) { target = Math.atan2(-Math.sin(camYaw), -Math.cos(camYaw)); k = 14; }
    else if (this.speed > 0.7 && hasInput) { target = Math.atan2(this.vel.x, this.vel.z); k = this.grounded ? 9 : 4; }
    else if (hasInput) { target = Math.atan2(want.x, want.z); k = 8; }
    const dy = angleDelta(this.yaw, target), step = dy * (1 - Math.exp(-k * dt)); this.yaw += step; this.an.turn = damp(this.an.turn, step / Math.max(dt, 1e-4), 10, dt);
    this.root.rotation.y = this.yaw; this.root.updateMatrixWorld(true);
  }
  camAim() { const y = this.g.camera.yaw; return _a.set(-Math.sin(y), 0, -Math.cos(y)); }
  speedMulHold() { let m = 1; for (const h of this.holds) m = Math.min(m, h.carry * (this.rage.on ? 1.3 : 1)); return Math.min(1, m); }

  /** the body was pushed back by solid geometry: shoulder-charge breakable walls, shove heavy props */
  contact(nx, nz, vn, hasInput) {
    const P = this.g.props; if (!P) return;
    // wall charge
    if (vn > 6 && this.mode === 'ground' && this.lastCharge <= 0) {
      const w = P.nearestWall(this.pos, Math.atan2(-nx, -nz), 2.2);
      if (w) { const dmg = vn * 16 * this.dmgMul; this.lastCharge = 0.45; P.damageWall(w, dmg, new THREE.Vector3(this.pos.x - nx * 0.9, this.pos.y + 1.6, this.pos.z - nz * 0.9), new THREE.Vector3(-nx, 0, -nz)); this.stats.walls++; this.g.camera.addTrauma(0.35); this.g.sfx.thud(0.7); this.vel.x -= nx * 0 ; }
    }
  }

  /** walking into a loose prop pushes it: it slides ahead of you at a pace set by its weight */
  pushProps(dt, want) {
    const P = this.g.props; if (!P || !this.hasInput || !this.grounded || this.act || this.holds.length) return;
    const cap = this.capacity(); let best = null;
    for (const p of P.props) {
      if (p.held || p.dead || p.planted || p.mass > cap * 1.25 || (p.state !== 'rest' && p.state !== 'slide')) continue;
      if (p.pos.y > this.pos.y + 1.2 || p.pos.y + p.size.h < this.pos.y + 0.3) continue;
      const h = p.half, cx = clamp(this.pos.x, p.pos.x - h.x, p.pos.x + h.x), cz = clamp(this.pos.z, p.pos.z - h.z, p.pos.z + h.z), dx = cx - this.pos.x, dz = cz - this.pos.z, d = Math.hypot(dx, dz);
      if (d > FCFG.radius + 0.25) continue; const dot = d > 1e-3 ? (dx * want.x + dz * want.z) / d : 1; if (dot < 0.5) continue;
      if (!best || d < best.d) best = { p, d };
    }
    if (!best) return; const p = best.p, ps = clamp(5.5 - p.mass / 450, 1.3, 4.8) * (this.rage.on ? 1.3 : 1);
    P.removeBox(p); p.state = 'slide'; p.vel.x = want.x * ps * 1.04; p.vel.z = want.z * ps * 1.04; this.pushing = p;
    const sp = Math.hypot(this.vel.x, this.vel.z); if (sp > ps) { this.vel.x *= ps / sp; this.vel.z *= ps / sp; this.speed = ps; }
    this.pushT += dt; if (this.pushT > 0.5) { this.pushT = 0; this.stats.pushes++; this.g.sfx.thud(0.15); this.g.fx.dust.emit({ pos: new THREE.Vector3(p.pos.x, 0.2, p.pos.z), vel: new THREE.Vector3(rand(-1, 1), 0.6, rand(-1, 1)), size: 0.8, grow: 1.5, life: 0.6, drag: 2, color: [0.6, 0.58, 0.55], alpha: 0.4 }); }
  }

  // ------------------------------------------------------------------------------------------------ climb / vault
  /** returns true when a vault/climb started. fromGround: Space pressed on the ground; otherwise an airborne ledge grab */
  tryClimb(want, fromGround) {
    const w = this.g.world, f = _a.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)), hasI = this.hasInput; if (!hasI) return false;
    const dir = (fromGround ? want : f).clone().setY(0).normalize(), R = FCFG.radius, pd = R + 0.5 + (fromGround ? Math.min(this.speed, 9) * 0.14 : 0), pr = V(this.pos.x + dir.x * pd, 0, this.pos.z + dir.z * pd);
    let box = null; for (const b of w.boxes) { if (b.prop && b.prop.held) continue; if (pr.x > b.min.x - 0.05 && pr.x < b.max.x + 0.05 && pr.z > b.min.z - 0.05 && pr.z < b.max.z + 0.05 && b.max.y > this.pos.y + 0.5 && b.min.y < this.pos.y + 1.0) { if (!box || b.max.y > box.max.y) box = b; } }
    if (!box) return false; const rise = box.max.y - this.pos.y;
    let t0 = -1e9, t1 = 1e9; for (const ax of ['x', 'z']) { const d = dir[ax], o = this.pos[ax]; if (Math.abs(d) < 1e-4) continue; const a1 = (box.min[ax] - o) / d, a2 = (box.max[ax] - o) / d; t0 = Math.max(t0, Math.min(a1, a2)); t1 = Math.min(t1, Math.max(a1, a2)); }
    const tEnter = Math.max(0, t0), tExit = t1, thick = tExit - tEnter;
    const free = (x, z, y0) => { for (const b of w.boxes) { if (b === box) continue; if (x + 0.8 > b.min.x && x - 0.8 < b.max.x && z + 0.8 > b.min.z && z - 0.8 < b.max.z && b.max.y > y0 + 0.3 && b.min.y < y0 + FCFG.height) return false; } if (w.island) { const B = w.bounds; return x > B.x0 + 1 && x < B.x1 - 1 && z > B.z0 + 1 && z < B.z1 - 1; } return Math.abs(x) < 34 && Math.abs(z) < 34; };
    const start = (kind, p1, dur, extra) => { this.climb = { kind, t: 0, dur, p0: this.pos.clone(), p1, top: box.max.y, dir: dir.clone(), toWall: tEnter, prev: this.pos.clone(), ...extra }; this.grounded = false; this.vel.set(0, 0, 0); this.yaw = Math.atan2(dir.x, dir.z); this.jumpBuffer = 0; };
    if (fromGround && rise >= 1.2 && rise <= 2.0 && thick <= 3.2 && this.speed > 3) {          // vault over a low obstacle
      const ex = this.pos.x + dir.x * (tExit + 1.3), ez = this.pos.z + dir.z * (tExit + 1.3), ey = w.groundAt(ex, ez, box.max.y, 6, 0.4); if (!free(ex, ez, ey)) return false;
      start('vault', V(ex, ey, ez), 0.62); this.mode = 'vault'; this.vel.set(dir.x * 5, 0, dir.z * 5); this.stats.vaults++; return true;
    }
    if (rise < (fromGround ? 2.9 : 1.4) || rise > 5.4 || (!fromGround && rise > 3.9) || tEnter > pd) return false;                    // climb a tall ledge
    if (thick >= 1.8) {                                                                       // haul up and stand on top
      const ex = this.pos.x + dir.x * (tEnter + 0.95), ez = this.pos.z + dir.z * (tEnter + 0.95); if (!free(ex, ez, box.max.y)) return false;
      start('climb', V(ex, box.max.y, ez), 0.55 + 0.2 * rise);
    } else {                                                                                  // thin wall: climb up and drop over the far side
      const ex = this.pos.x + dir.x * (tExit + R + 0.4), ez = this.pos.z + dir.z * (tExit + R + 0.4), ey = w.groundAt(ex, ez, box.max.y, 6, 0.4); if (!free(ex, ez, ey)) return false;
      start('climb', V(ex, ey, ez), 0.8 + 0.2 * rise, { over: true });
    }
    this.mode = 'climb'; this.stats.climbs++; this.g.sfx.whoosh(); return true;
  }
  updateClimb(dt) {
    const c = this.climb; c.t += dt; const u = clamp(c.t / c.dur, 0, 1);
    if (c.kind === 'vault') {
      const ux = smooth(u), y = lerp(c.p0.y, c.p1.y, u) + Math.sin(Math.PI * u) * ((c.top - c.p0.y) * 0.9 + 0.4);
      this.pos.set(lerp(c.p0.x, c.p1.x, ux), y, lerp(c.p0.z, c.p1.z, ux));
    } else {
      const wu = 0.6, reach = Math.max(0, c.toWall - 0.8) * smooth(u / 0.2), sx = c.p0.x + c.dir.x * reach, sz = c.p0.z + c.dir.z * reach;
      if (u < wu) { const k = smooth(u / wu); this.pos.set(sx, lerp(c.p0.y, c.top, k) - 0.15 * (1 - k) * 0 , sz); }
      else { const k = smooth((u - wu) / (1 - wu)); this.pos.set(lerp(sx, c.p1.x, k), lerp(c.top, c.p1.y, k) + (c.over ? Math.sin(Math.PI * k) * 0.45 : 0), lerp(sz, c.p1.z, k)); }
    }
    this.vel.set((this.pos.x - c.prev.x) / Math.max(dt, 1e-4), 0, (this.pos.z - c.prev.z) / Math.max(dt, 1e-4)); c.prev.copy(this.pos);
    if (u >= 1) {
      this.pos.copy(c.p1); const clm = c; this.climb = null; this.mode = 'air'; this.grounded = false; this.vel.set(clm.kind === 'vault' ? clm.dir.x * 4 : 0, 0, clm.kind === 'vault' ? clm.dir.z * 4 : 0);
      if (clm.kind === 'climb') { this.vel.set(clm.over ? clm.dir.x * 1.5 : 0, 0, clm.over ? clm.dir.z * 1.5 : 0); this.mode = 'ground'; this.grounded = true; this.an.landV += 2.5; this.g.camera.addTrauma(0.12); this.g.sfx.thud(0.4); }
    }
  }

  // ------------------------------------------------------------------------------------------------ FX
  jumpFX() {
    const g = this.g; this.an.landV -= 2; g.camera.addTrauma(0.1); g.sfx.thud(0.5);
    g.fx.surface.ring(new THREE.Vector3(this.pos.x, this.pos.y + 0.06, this.pos.z), new THREE.Vector3(0, 1, 0), 5, 0.4, 0xb8b0a0);
    for (let i = 0; i < 12; i++) g.fx.dust.emit({ pos: new THREE.Vector3(this.pos.x + rand(-0.7, 0.7), this.pos.y + 0.2, this.pos.z + rand(-0.7, 0.7)), vel: new THREE.Vector3(rand(-1, 1), rand(0.2, 1), rand(-1, 1)).normalize().multiplyScalar(rand(2, 5)), size: rand(0.7, 1.4), grow: 1.6, life: rand(0.5, 0.9), drag: 2, color: [0.66, 0.64, 0.6], alpha: 0.5 });
  }
  /** heavy landing: camera shake, dust ring, nearby small props hop, spring squash in the animation */
  landFX(v) {
    const g = this.g, k = clamp((v - 5) / 17, 0, 1), P = g.props; this.an.landV += 5 + 9 * k; g.camera.addTrauma(0.2 + 0.5 * k); g.camera.kick(0.02 * k); g.sfx.thud(0.4 + 0.6 * k);
    const c = new THREE.Vector3(this.pos.x, this.pos.y + 0.06, this.pos.z);
    g.fx.surface.ring(c, new THREE.Vector3(0, 1, 0), 4 + 8 * k, 0.45, 0xc8c0b0);
    for (let i = 0; i < 10 + 20 * k; i++) g.fx.dust.emit({ pos: new THREE.Vector3(c.x + rand(-0.8, 0.8), c.y + 0.1, c.z + rand(-0.8, 0.8)), vel: new THREE.Vector3(rand(-1, 1), rand(0.1, 0.6), rand(-1, 1)).normalize().multiplyScalar(rand(3, 8) * (0.6 + k)), size: rand(0.8, 1.8), grow: 1.8, life: rand(0.6, 1.1), drag: 2.2, color: [0.66, 0.64, 0.6], alpha: 0.5 });
    if (P) { P.debris.burst(c, Math.round(4 + 10 * k), 4 + 5 * k, 0.12, 0xa8a49c); if (k > 0.25) P.shockwave(c, 4 + 5 * k, 5 + 14 * k, 0, 0); if (k > 0.8) P.cracks.add(c.x, this.pos.y, c.z, 3.2, 8); }
  }
  footstep(side) {
    const g = this.g, A = this.an, k = 0.3 + 0.7 * A.rn, off = _a.set(Math.cos(this.yaw) * 0.45 * side, 0, -Math.sin(this.yaw) * 0.45 * side);
    g.camera.addTrauma(0.025 + 0.05 * A.rn); g.sfx.thud(0.12 + 0.2 * k);
    for (let i = 0; i < 2 + 3 * A.rn; i++) g.fx.dust.emit({ pos: new THREE.Vector3(this.pos.x + off.x, this.pos.y + 0.1, this.pos.z + off.z), vel: new THREE.Vector3(rand(-1, 1), rand(0.2, 0.8), rand(-1, 1)).multiplyScalar(1.8), size: rand(0.4, 0.8), grow: 1.4, life: 0.45, drag: 2, color: [0.65, 0.63, 0.6], alpha: 0.3 });
    if (A.rn > 0.5 && g.props) g.props.shockwave(this.pos, 2.2, 3, 0, 0);
  }

  // ------------------------------------------------------------------------------------------------ animation
  /** continuous locomotion pose (idle <-> walk <-> run, crouch, air, heavy land, climb) */
  locoPose(dt) {
    const A = this.an, sp = this.speed, P = mkPose(), grounded = this.grounded || this.mode === 'crouch';
    A.t += dt; const t = A.t;
    A.mv = damp(A.mv, grounded && this.mode !== 'vault' ? smoothstep(0.4, 3.6, sp) : 0, 9, dt); A.rn = damp(A.rn, grounded ? smoothstep(6, 8.6, sp) : 0, 7, dt);
    A.air = damp(A.air, grounded ? 0 : 1, 14, dt); A.crouch = damp(A.crouch, this.mode === 'crouch' ? clamp(this.crouchT / FCFG.crouchT, 0, 1) : 0, 22, dt);
    A.clm = damp(A.clm, this.climb ? 1 : 0, this.climb ? 16 : 10, dt);
    const stride = lerp(3.1, 5.0, A.rn); const prevPs = A.ps; if (grounded) A.ps += dt * (sp / stride) * TAU; A.ps %= TAU * 50;
    if (grounded && A.mv > 0.5 && dt > 0) {                                  // foot hits the ground twice per cycle
      const a0 = Math.floor(prevPs / Math.PI), a1 = Math.floor(A.ps / Math.PI); if (a1 !== a0) this.footstep(a1 % 2 ? 1 : -1);
    }
    const accel = dt > 0 ? clamp((sp - A.prevSpeed) / dt / 28, -1, 1) : 0; A.prevSpeed = sp; A.accel = damp(A.accel, accel, 8, dt);
    // landing spring (heavy squash and recoil)
    if (dt > 0) { A.landV += (-110 * A.land - 11 * A.landV) * dt; A.land = clamp(A.land + A.landV * dt, -0.3, 1.2); }
    const ps = A.ps, s = Math.sin(ps), c = Math.cos(ps), mv = A.mv, rn = A.rn, idle = 1 - mv, air = A.air, ground = 1 - air;
    const b = Math.sin(t * 1.7), land = clamp(A.land, 0, 1.2), cr = A.crouch;
    // ---------- torso
    const lean = (0.03 + 0.05 * mv + 0.27 * rn + 0.16 * A.accel) * ground + 0.12 * air + 0.38 * cr + 0.3 * land;
    P.d.hips = D(lean * 0.18, -0.12 * s * mv * ground, 0.03 * s * mv + 0.012 * Math.sin(t * 0.4) * idle);
    P.d.spine = D(lean * 0.4 + 0.012 * b, 0.1 * s * mv, 0); P.d.chest = D(lean * 0.4 + 0.02 * b * idle + 0.03 * Math.sin(ps * 2) * mv, 0.22 * s * (0.5 * mv + 0.5 * rn) * ground, -0.03 * s * mv);
    P.d.neck = D(-lean * 0.35, -0.08 * s * mv, 0); P.d.head = D(-lean * 0.35 + 0.015 * Math.sin(t * 0.9) * idle, 0.06 * Math.sin(t * 0.45) * idle, 0);
    for (const k of ARMS) P.d['s' + k] = D(0, 0, SIDE[k] * (0.05 * b * idle + 0.1 * air + 0.03 * mv));
    P.off[0] = 0.03 * s * mv * ground + 0.014 * Math.sin(t * 0.4) * idle; P.off[1] = (-0.05 * mv - 0.09 * rn * (0.5 + 0.5 * Math.cos(2 * ps)) + 0.008 * b) * ground; P.off[2] = lean * 0.1;
    // ---------- legs
    const A_th = lerp(0.42, 0.78, rn), K_k = lerp(0.65, 1.3, rn), sw = [s, -s], th = [0, 0], kn = [0, 0];
    for (let i = 0; i < 2; i++) {
      const sv = sw[i], cv = i ? -c : c; th[i] = (-A_th * sv - 0.04) * mv * ground - 0.05 * idle * ground; kn[i] = (K_k * Math.max(0, cv) * (0.6 + 0.4 * Math.abs(sv)) + 0.1) * mv * ground + 0.06 * idle * ground;
      // air: one knee tucked, one trailing; falling spreads the stride
      const rise = clamp(this.vel.y / 14, -1, 1), tuck = i ? 0.35 : 0.9; th[i] += air * (-0.35 - 0.3 * Math.max(0, rise) * (i ? 0.2 : 1)); kn[i] += air * (0.25 + tuck * Math.max(0, rise) * 0.8 + 0.2 * (i ? 0 : 1));
    }
    P.d.thighL = D(th[0], 0, 0.09 * idle + 0.04); P.d.thighR = D(th[1], 0, -0.09 * idle - 0.04); P.d.kneeL = D(kn[0]); P.d.kneeR = D(kn[1]);
    P.d.ankleL = D(-(th[0] + kn[0]) * 0.85 + 0.2 * Math.max(0, -s) * mv); P.d.ankleR = D(-(th[1] + kn[1]) * 0.85 + 0.2 * Math.max(0, s) * mv);
    // crouch + landing squash (feet stay planted: knee/thigh/hip drop are tied together)
    const sq = Math.max(cr * 0.95, land * 0.85); if (sq > 0.01) { const keep = { l: P.d.thighL, r: P.d.thighR }; squat(P, sq, 0.12); P.d.thighL[0] += th[0] * 0.3; P.d.thighR[0] += th[1] * 0.3; void keep; }
    // ---------- arms (IK targets in the chest frame)
    const swing = lerp(0.36, 0.72, rn), swU = [-s, s], idx = { UL: 0, UR: 1, LL: 0, LR: 1 };
    for (const k of ARMS) {
      const upper = k[0] === 'U', i = idx[k], sv = swU[i] * (upper ? 1 : -0.8), bp = Math.sin(t * 1.7 + (upper ? 0 : 1.5) + i);
      // idle / walk / run base targets
      let H0 = upper ? hand(k, 0.82, -0.55 + 0.012 * bp, 0.18) : hand(k, 0.8, -0.72 + 0.012 * bp, 0.1);
      const Hr = upper ? hand(k, 0.72, -0.05, 0.62) : hand(k, 0.66, -0.3, 0.5);
      H0 = H0.lerp(Hr, rn);
      H0.z += sv * swing * mv * (upper ? 1 : 0.8); H0.y += Math.max(0, sv) * (upper ? 0.28 : 0.2) * mv * (0.5 + rn); H0.x -= SIDE[k] * 0.1 * Math.max(0, sv) * mv;
      // airborne: arms flung up and out for balance; crouch/landing: braced down and back / slammed to the sides
      const Ha = upper ? hand(k, 1.15, 0.95 + 0.2 * Math.sin(t * 5 + i), 0.3) : hand(k, 1.35, 0.15, 0.2);
      const Hc = upper ? hand(k, 0.9, -0.95, -0.45) : hand(k, 0.95, -0.85, -0.3), Hl = upper ? hand(k, 1.3, -0.85, 0.45) : hand(k, 1.35, -0.7, 0.3);
      const p = H0.clone().lerp(Ha, air).lerp(Hc, cr).lerp(Hl, clamp(land, 0, 1) * 0.9);
      arm(P, k, p, hand(k, 0.55, -0.15, -0.9)); P.curl[k] = lerp(0.35, 0.9, rn) * ground + 0.55 * air + 0.8 * cr + 0.9 * land;
    }
    // ---------- climb / vault overlay
    if (A.clm > 0.01 && this.climb) {
      const cl = this.climb, u = clamp(cl.t / cl.dur, 0, 1), W = A.clm, Q = mkPose();
      if (cl.kind === 'climb') {
        const pull = smooth((u - 0.4) / 0.4), reachUp = 1.15 - 1.2 * pull, fw = 1.0 - 0.45 * pull, alt = Math.sin(u * 14) * 0.18 * (1 - pull);
        arm(Q, 'UL', hand('UL', 0.4, reachUp + alt, fw), hand('UL', 0.9, 0, -0.3)); arm(Q, 'UR', hand('UR', 0.4, reachUp - alt, fw), hand('UR', 0.9, 0, -0.3));
        arm(Q, 'LL', hand('LL', 0.5, 0.55 - 0.6 * pull - alt * 0.5, 0.95), hand('LL', 0.9, 0, -0.3)); arm(Q, 'LR', hand('LR', 0.5, 0.55 - 0.6 * pull + alt * 0.5, 0.95), hand('LR', 0.9, 0, -0.3));
        Q.d.spine = D(0.35 * pull + 0.1, 0, 0); Q.d.chest = D(0.3 * pull, 0, 0); Q.d.thighL = D(-1.0 + 0.7 * pull, 0, 0.1); Q.d.kneeL = D(1.5 - 1.0 * pull); Q.d.thighR = D(-0.5, 0, -0.1); Q.d.kneeR = D(1.0); Q.d.ankleL = D(-0.5); Q.d.ankleR = D(-0.4); Q.off = [0, -0.1, 0];
      } else {
        const over = Math.sin(Math.PI * u); for (const k of ARMS) arm(Q, k, hand(k, 0.45, -0.15 - 0.5 * over, 0.8 + 0.4 * over), hand(k, 0.9, 0.2, -0.3));
        Q.d.spine = D(0.45 * over, 0, 0); Q.d.chest = D(0.3 * over, 0, 0); Q.d.thighL = D(-1.2 * over, 0, 0.1); Q.d.kneeL = D(1.5 * over); Q.d.thighR = D(-0.7 * over, 0, -0.1); Q.d.kneeR = D(1.2 * over); Q.d.ankleL = D(-0.3 * over); Q.d.ankleR = D(-0.3 * over);
      }
      Q.curl = { UL: 1, UR: 1, LL: 1, LR: 1 }; Q.w = W; layer(P, Q, this.poser);
    }
    return P;
  }

  /** per-frame: compose locomotion + carry layer + block + action, pose the skeleton */
  updateAnim(dt) {
    const A = this.an, P = this.locoPose(dt);
    this.rageVisuals(dt);
    layer(P, this.holdLayer(dt), this.poser);
    A.blk = damp(A.blk, this.blocking && !this.act ? 1 : 0, 14, dt); if (A.blk > 0.01) layer(P, this.blockLayer(A.blk), this.poser);
    const L = this.actLayer(dt); if (L) layer(P, L, this.poser);
    if (this.rage.on || A.rage > 0.01) { A.rage = damp(A.rage, this.rage.on ? 1 : 0, 6, dt); const f = A.rage, pulse = Math.sin(A.t * 11); for (const k of ARMS) P.curl[k] = Math.max(P.curl[k] ?? 0, 0.6 * f); P.off[1] -= 0.03 * f; P.d.chest = P.d.chest || D(); P.d.chest = [P.d.chest[0] - 0.05 * f, P.d.chest[1], P.d.chest[2]]; void pulse; }
    this.poser.apply(P); this.root.updateMatrixWorld(true);
    this.updateState();
  }
  blockLayer(w) {
    const B = mkPose(); B.w = w;
    arm(B, 'UL', hand('UL', -0.25, 0.7, 1.05), hand('UL', 1.0, 0.4, 0)); arm(B, 'UR', hand('UR', -0.25, 0.76, 1.1), hand('UR', 1.0, 0.4, 0));
    arm(B, 'LL', hand('LL', 0.35, 0.05, 1.0), hand('LL', 1.0, -0.2, 0)); arm(B, 'LR', hand('LR', 0.35, 0.05, 1.0), hand('LR', 1.0, -0.2, 0)); B.curl = { UL: 1, UR: 1, LL: 1, LR: 1 };
    B.d.spine = D(0.2, 0, 0); B.d.chest = D(0.15, 0, 0); B.d.head = D(-0.15, 0, 0); B.off = [0, -0.2, 0.05]; squat(B, 0.35, 0.18);
    return B;
  }
  updateState() {
    const A = this.an;
    this.state = this.act ? this.act.kind.toUpperCase() + ':' + this.act.stage.toUpperCase() : this.combo ? 'PUNCH:' + (this.combo.n + 1) : this.climb ? this.climb.kind.toUpperCase() : this.blocking ? 'BLOCK' : this.mode === 'crouch' ? 'JUMP-CROUCH' : !this.grounded ? (this.vel.y > 0 ? 'JUMP-RISE' : 'FALL') : A.land > 0.3 ? 'HEAVY-LAND' : this.holds.length ? 'CARRY' : A.rn > 0.5 ? 'RUN' : A.mv > 0.4 ? 'WALK' : 'IDLE';
  }
}
const $ = id => document.getElementById(id);
Object.assign(FaPlayer.prototype, powers);
