// V30 Four Arms wall climbing: Space at a tall wall grabs it (any height), W/S climbs, A/D shimmies, Shift climbs faster, hold Space = charge a wall jump
// (release: straight up the wall, or an arc across to another wall / building when the camera aims away from it). Slower and heavier than Wildmutt (fa speeds ~1.7 m/s, jump tuning WJ_FA).
import * as THREE from 'three';
import { clamp, damp, lerp, angleDelta, rand } from './util.js';
import './wildmutt.js';
import { wmClimb, WJ_FA, wallJumpPlan } from './wm_climb.js';
import { hand, mkPose, arm, smooth, D, layer, ARMS } from './fa_pose.js';

export const FW = { d0: 1.1, speed: 1.7, shift: WJ_FA.speedShift, lat: 0.9, ledge: 2.5, grabT: 0.3, dropT: 0.2 };
const _p = new THREE.Vector3();
const wallPos = (C, u, dist, out) => C.ax === 'x' ? out.set(C.plane + C.nx * dist, 0, u) : out.set(u, 0, C.plane + C.nz * dist);

export const faWall = {
  faWallTry(want, fromGround) {
    if (this.wall || !this.hasInput) return false;
    if (fromGround) this.yaw = Math.atan2(want.x, want.z);
    const r = wmClimb.findClimb.call(this); if (!r || !r.ok || r.rise < 3.0) return false;
    this.wall = { ...r, stage: 'grab', st: 0, h: this.pos.y, u: r.uC, x0: this.pos.x, z0: this.pos.z, ph: 0, vv: 0, vl: 0, charge: 0, t: 0 };
    this.vel.set(0, 0, 0); this.grounded = false; this.mode = 'climb'; this.jumpBuffer = 0; this.stats.wallClimbs = (this.stats.wallClimbs || 0) + 1; this.g.sfx.whoosh && this.g.sfx.whoosh(); this.g.camera.addTrauma(0.1);
    return true;
  },
  faWallAssist(dt) {
    if (!(this.wjT > 0)) return; this.wjT -= dt; if (this.wall || this.mode !== 'air') { if (this.grounded) this.wjT = 0; return; }
    const sp = Math.hypot(this.vel.x, this.vel.z); if (sp > 2) this.yaw = Math.atan2(this.vel.x, this.vel.z);
    const r = wmClimb.findClimb.call(this); if (r && r.ok && r.rise > 2.0) { this.wjT = 0; this.wall = { ...r, stage: 'grab', st: 0, h: this.pos.y, u: r.uC, x0: this.pos.x, z0: this.pos.z, ph: 0, vv: 0, vl: 0, charge: 0, t: 0 }; this.vel.set(0, 0, 0); this.mode = 'climb'; this.grounded = false; this.g.sfx.thud && this.g.sfx.thud(0.5); this.g.camera.addTrauma(0.2); }
  },
  faWallDrop(C, why) { C.stage = 'drop'; C.st = 0; C.why = why; C.hold = { y: this.pos.y }; },
  faWallUpdate(dt, input) {
    const C = this.wall, w = this.g.world, g = this.g; C.t += dt; C.st += dt; this.vel.set(0, 0, 0); this.speed = 0; this.grounded = false; this.mode = 'climb';
    const face = () => { this.yaw += angleDelta(this.yaw, C.wy) * (1 - Math.exp(-12 * dt)); };
    const at = (u, d, y) => { wallPos(C, u, d, _p); this.pos.set(_p.x, y, _p.z); };
    const dust = (n) => { for (let i = 0; i < n; i++) g.fx.dust.emit({ pos: new THREE.Vector3(this.pos.x - C.nx * 0.6, this.pos.y + rand(0.5, 2), this.pos.z - C.nz * 0.6), vel: new THREE.Vector3(rand(-1, 1), rand(0, 1), rand(-1, 1)).multiplyScalar(2), size: rand(0.5, 0.9), grow: 1.4, life: 0.5, drag: 2 }); };
    if (C.stage === 'grab') {
      face(); const k = smooth(C.st / FW.grabT); wallPos(C, C.u, FW.d0, _p); this.pos.set(C.x0 + (_p.x - C.x0) * k, C.h, C.z0 + (_p.z - C.z0) * k);
      if (C.st >= FW.grabT) { C.stage = 'up'; C.st = 0; at(C.u, FW.d0, C.h); dust(6); g.sfx.thud(0.4); g.camera.addTrauma(0.12); }
    } else if (C.stage === 'up') {
      face(); const sp = FW.speed * (input.run ? FW.shift : 1);
      C.vv = damp(C.vv, input.moveY * sp, 8, dt); C.vl = damp(C.vl, input.moveX * FW.lat * (input.run ? 1.4 : 1), 8, dt);
      C.h += C.vv * dt; C.u = clamp(C.u + C.vl * dt * C.latSgn, C.ulo, Math.max(C.ulo, C.uhi)); if (C.ulo > C.uhi) C.u = (C.lo + C.hi) / 2;
      C.ph += (C.vv + C.vl) * dt * 0.9;
      wallPos(C, C.u, 1.2, _p); const gb = w.groundAt(_p.x, _p.z, C.h + 0.3, 0.3, 0.3);
      if (C.h <= gb + 0.005) { C.h = gb; if (input.moveY < 0) { this.faWallDrop(C, 'down'); return; } }
      at(C.u, FW.d0, C.h);
      if (C.h >= C.top - FW.ledge) { C.stage = 'mantle'; C.st = 0; C.h0 = C.h; C.mDur = 0.8; g.sfx.whoosh && g.sfx.whoosh(); return; }
      if (input.jumpHeld) { C.charge = Math.min(WJ_FA.chargeMax, C.charge + dt); if (Math.random() < dt * 20) dust(1); }
      else if (C.charge > 0) { const ch = C.charge; C.charge = 0; if (ch < 0.15) { this.faWallDrop(C, 'jump'); return; } this.faWallLaunch(C, ch); }
    } else if (C.stage === 'wjump') {
      face(); const J = C.wj, u = clamp(C.st / J.dur, 0, 1), e = 1 - Math.pow(1 - u, 2.2); C.h = J.h0 + J.H * e; C.ph += dt * 2.6; at(C.u, FW.d0 + 0.2 * Math.sin(Math.PI * u), C.h);
      if (C.h >= C.top - FW.ledge) { C.stage = 'mantle'; C.st = 0; C.h0 = C.h; C.mDur = 0.8; return; }
      if (u >= 1) { C.stage = 'up'; C.st = 0; C.vv = 0; g.sfx.thud(0.3); dust(4); }
    } else if (C.stage === 'mantle') {
      face(); C.m = clamp(C.st / C.mDur, 0, 1); const mY = smooth(clamp(C.m / 0.62, 0, 1)), mS = smooth(clamp((C.m - 0.3) / 0.7, 0, 1));
      at(C.u, -(-FW.d0 + (FW.d0 + C.inset) * mS), C.h0 + (C.top - C.h0) * mY);
      if (C.m >= 1) { this.wall = null; this.grounded = true; this.mode = 'ground'; this.vel.set(-C.nx * 1.2, 0, -C.nz * 1.2); this.pos.y = C.top; this.an.landV += 4; g.camera.addTrauma(0.2); g.sfx.thud(0.6); dust(10); }
    } else if (C.stage === 'drop') {
      const k = smooth(C.st / FW.dropT); at(C.u, lerp(FW.d0, FW.d0 + 0.9, k), C.hold.y);
      if (C.st >= FW.dropT) {
        const why = C.why; this.wall = null; this.mode = 'air'; this.grounded = false; const s = why === 'jump' ? 6 : 1.5;
        this.vel.set(C.nx * s, why === 'jump' ? 11 : 0, C.nz * s); if (why === 'jump') this.jumpFX();
      }
    }
    this.root.rotation.y = this.yaw; this.root.updateMatrixWorld(true);
  },
  faWallLaunch(C, charge) {
    const g = this.g, plan = wallJumpPlan(g, C, charge, WJ_FA); this.stats.wallJumps = (this.stats.wallJumps || 0) + 1; g.sfx.whoosh && g.sfx.whoosh(); g.camera.kick(0.03); g.camera.addTrauma(0.2);
    if (plan.kind === 'vertical') { const top = C.top - FW.ledge - 0.2; C.wj = { h0: C.h, H: Math.max(1, Math.min(plan.H, top - C.h + 0.6)), dur: plan.dur }; C.stage = 'wjump'; C.st = 0; return; }
    this.wall = null; this.mode = 'air'; this.grounded = false; this.vel.copy(plan.v); this.yaw = Math.atan2(plan.v.x, plan.v.z); this.wjT = 2.4; this.jumpFX();
  },
  /** pose overlay while on a wall (called from locoPose) */
  faWallPose(P, A) {
    const C = this.wall; A.wl = damp(A.wl || 0, C ? 1 : 0, C ? 14 : 8, 1 / 60); if (!C || A.wl < 0.01) return;
    const Q = mkPose(), s = Math.sin(C.ph * 3), pull = C.stage === 'mantle' ? smooth((C.m - 0.3) / 0.5) : 0, ch = C.charge ? C.charge / WJ_FA.chargeMax : 0;
    const up = 1.2 - 1.2 * pull - 0.25 * ch;
    arm(Q, 'UL', hand('UL', 0.4, up + 0.3 * s, 1.0), hand('UL', 0.9, 0, -0.3)); arm(Q, 'UR', hand('UR', 0.4, up - 0.3 * s, 1.0), hand('UR', 0.9, 0, -0.3));
    arm(Q, 'LL', hand('LL', 0.5, 0.5 - 0.6 * pull - 0.3 * s, 0.95), hand('LL', 0.9, 0, -0.3)); arm(Q, 'LR', hand('LR', 0.5, 0.5 - 0.6 * pull + 0.3 * s, 0.95), hand('LR', 0.9, 0, -0.3));
    Q.d.spine = D(0.25 * pull + 0.1 + 0.2 * ch, 0, 0); Q.d.chest = D(0.2 * pull, 0, 0); Q.d.thighL = D(-1.1 + 0.4 * s, 0, 0.1); Q.d.kneeL = D(1.5); Q.d.thighR = D(-1.1 - 0.4 * s, 0, -0.1); Q.d.kneeR = D(1.5); Q.d.ankleL = D(-0.5); Q.d.ankleR = D(-0.5); Q.off = [0, -0.1, 0];
    Q.curl = { UL: 1, UR: 1, LL: 1, LR: 1 }; Q.w = A.wl; layer(P, Q, this.poser);
  },
};
