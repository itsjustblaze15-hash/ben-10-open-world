// POWER 1 — Crystal Projectiles (Left Mouse).
// Sequence: AIM (arm raises to the target) -> FORM (crystals grow around the forearm)
//           -> FIRE (arm thrusts; crystals launch from the forearm one after another)
//           -> RECOVER.  Projectiles start at the real forearm crystals on the real hand, never at the camera.
import * as THREE from 'three';
import { makeCrystalGeometry, crystalMaterial } from './effects.js';
import { UNIT } from '../animations/rig.js';
import { clamp, lerp, easeOutCubic, easeOutBack, easeInOutCubic, rand } from './util.js';
import { playerSegHit } from './kevin_fx.js';

const T = { aim: 0.17, form: 0.26, fire: 0.15, recover: 0.42 };
const DAMAGE = 14, SPEED = 46, N_SHARDS = 6, RANGE = 90;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _z = new THREE.Vector3(0, 0, 1);

export class CrystalProjectiles {
  constructor(game) {
    this.g = game; this.state = 'idle'; this.t = 0; this.side = 1; this.held = false; this.queue = []; this.projectiles = [];
    this.aimObj = { w: 0, side: 1, target: new THREE.Vector3(), form: 0, thrust: 0, push: 0 };
    this.stats = { fired: 0, hits: 0 };
    // projectile visuals (shared)
    this.geoOuter = makeCrystalGeometry({ length: 1.55, radius: 0.105, tip: 0.46, seed: 7, jitter: 0.1 });
    this.geoCore = makeCrystalGeometry({ length: 1.5, radius: 0.045, tip: 0.5, seed: 7, jitter: 0.02 });
    this.matOuter = crystalMaterial({ color: 0x4af0a0, emissive: 0x19d97a, emissiveIntensity: 1.1, opacity: 0.9 });
    this.matCore = new THREE.MeshBasicMaterial({ color: 0xd8fff0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    // forearm crystals (one set per arm) — parented to the forearm bones of the real model
    this.form = {};
    for (const [sfx, sg] of [['L', 1], ['R', -1]]) {
      const grp = new THREE.Group(); grp.visible = false; const shards = [];
      for (let k = 0; k < N_SHARDS; k++) {
        const a = k * (Math.PI * 2 / N_SHARDS) + (sg > 0 ? 0.4 : 1.1), radial = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
        const m = new THREE.Mesh(makeCrystalGeometry({ length: 1, radius: 0.15, tip: 0.42, seed: 20 + k + (sg > 0 ? 0 : 9) }), this.matOuter);
        const dir = radial.clone().multiplyScalar(0.28).add(new THREE.Vector3(0, -1, 0)).normalize();
        m.quaternion.setFromUnitVectors(_z, dir);
        m.position.copy(radial).multiplyScalar(0.2).add(new THREE.Vector3(0, -0.3 - (k % 3) * 0.28, 0));
        m.userData = { len: 0.85 + (k % 3) * 0.18, base: m.position.clone(), launched: false, k };
        m.castShadow = true; grp.add(m); shards.push(m);
      }
      grp.scale.setScalar(UNIT); game.dh.rig.bones['farm' + sfx].add(grp); this.form[sfx] = { grp, shards };
    }
  }

  get busy() { return this.state !== 'idle'; }
  /** keep the character facing where the camera aims while firing */
  get lockFacing() { return this.state !== 'idle' && !(this.state === 'recover' && this.t > 0.22); }

  press() { this.held = true; if (this.g.p2 && this.g.p2.busy) return; this.tryStart(); }
  release() { this.held = false; }
  tryStart() {
    if (this.state === 'idle') { this.side = this.lastSide ? -this.lastSide : -1; this.begin('aim'); }
    else if (this.state === 'recover' && this.t > 0.1) this.begin('form');  // chain: same arm, skip the raise
  }
  begin(s) {
    this.state = s; this.t = 0;
    if (s === 'aim') { this.lastSide = this.side; this.resetShards(); }
    if (s === 'form') this.resetShards();
    if (s === 'fire') { this.fireIdx = 0; this.fireStart = 0; }
  }
  resetShards() {
    const f = this.form[this.side > 0 ? 'L' : 'R']; f.grp.visible = true;
    for (const m of f.shards) { m.userData.launched = false; m.visible = true; m.scale.setScalar(0.0001); }
  }

  /** returns aim-layer params for the Animator (or null if the arm is free) */
  update(dt, aimPoint) {
    const A = this.aimObj, P = this.g.dh; this.t += dt;
    const fx = this.g.fx;
    if (this.state !== 'idle') {
      A.side = this.side; A.target.copy(aimPoint);
      const sfx = this.side > 0 ? 'L' : 'R', f = this.form[sfx];
      let w = 1, formAmt = 0, thrust = 0, push = 0;
      if (this.state === 'aim') {
        w = easeOutCubic(this.t / T.aim); formAmt = 0.25 * (this.t / T.aim); push = -0.1 * w;
        if (this.t >= T.aim) this.begin('form');
      } else if (this.state === 'form') {
        const u = clamp(this.t / T.form, 0, 1); formAmt = 0.25 + 0.75 * u; push = -0.1 - 0.2 * easeOutCubic(u);
        // crystal energy gathers on the forearm
        if (Math.random() < 0.8) this.emitForearmGlow(f, 0.6 + u);
        if (this.t >= T.form) this.begin('fire');
      } else if (this.state === 'fire') {
        const u = clamp(this.t / T.fire, 0, 1); formAmt = 1;
        if (u < 0.3) { push = -0.3 - 0.12 * (u / 0.3); thrust = 0; }
        else { const k = easeOutCubic((u - 0.3) / 0.7); push = lerp(-0.42, 0.55, k); thrust = k; }
        // launch shards one by one as the arm drives forward
        while (this.fireIdx < N_SHARDS && this.t >= T.fire * 0.3 + this.fireIdx * 0.022) this.launchOne(f, this.fireIdx++);
        if (this.t >= T.fire) this.begin('recover');
      } else if (this.state === 'recover') {
        const u = clamp(this.t / T.recover, 0, 1);
        w = this.t < 0.1 ? 1 : 1 - easeInOutCubic((this.t - 0.1) / (T.recover - 0.1)); formAmt = 1; thrust = 1; push = 0.55 * (1 - easeOutCubic(u));
        f.grp.visible = false;
        if (this.held && this.t > 0.12) { this.begin('form'); }
        else if (this.t >= T.recover) { this.state = 'idle'; this.t = 0; }
      }
      // grow forearm crystals (staggered, with overshoot)
      if (this.state !== 'recover' && this.state !== 'idle') {
        f.grp.visible = true;
        for (const m of f.shards) {
          if (m.userData.launched) continue;
          const g = easeOutBack(clamp(formAmt * 1.5 - m.userData.k * 0.1, 0, 1));
          m.scale.setScalar(Math.max(0.0001, m.userData.len * g));
          m.position.copy(m.userData.base);
        }
      }
      A.w = w; A.form = formAmt; A.thrust = thrust; A.push = push;
    } else {
      this.form.L.grp.visible = this.form.R.grp.visible = false;
    }
    this.updateProjectiles(dt);
    return this.state === 'idle' ? null : A;
  }

  emitForearmGlow(f, k) {
    const fx = this.g.fx; f.grp.parent.updateMatrixWorld(true);
    const m = f.shards[(Math.random() * f.shards.length) | 0]; m.getWorldPosition(_v);
    _v2.set(rand(-1, 1), rand(-0.4, 1), rand(-1, 1)).multiplyScalar(1.5);
    fx.glow.emit({ pos: _v, vel: _v2, size: rand(0.15, 0.3) * k, life: rand(0.25, 0.45), drag: 3, color: [0.35, 1, 0.65] });
  }

  launchOne(f, k) {
    const g = this.g, m = f.shards[k]; m.userData.launched = true; m.visible = false;
    g.dh.rig.modelGroup.updateMatrixWorld(true);
    m.getWorldPosition(_v);                                    // starts on the actual forearm crystal
    const origin = _v.clone(), target = this.aimObj.target;
    const dir = target.clone().sub(origin).normalize();
    // fan the volley: a spread sideways + a bit vertical, tighter at long range
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize(), up = new THREE.Vector3().crossVectors(right, dir);
    const fan = (k - (N_SHARDS - 1) / 2);
    dir.addScaledVector(right, fan * 0.028 + rand(-0.006, 0.006)).addScaledVector(up, ((k % 2) - 0.5) * 0.03 + rand(-0.006, 0.006)).normalize();
    this.spawn(origin, dir, SPEED + rand(-3, 3));
    // muzzle burst
    g.fx.glow.emit({ pos: origin, size: 1.1, life: 0.12, color: [0.7, 1, 0.85], drag: 0 });
    for (let i = 0; i < 4; i++) g.fx.glow.emit({ pos: origin, vel: dir.clone().multiplyScalar(rand(4, 10)).add(new THREE.Vector3(rand(-2, 2), rand(-2, 2), rand(-2, 2))), size: 0.28, life: 0.3, drag: 3, color: [0.4, 1, 0.65] });
    for (let i = 0; i < 2; i++) g.fx.shards.emit({ pos: origin, vel: dir.clone().multiplyScalar(rand(2, 6)).add(new THREE.Vector3(rand(-2, 2), rand(0, 3), rand(-2, 2))), size: rand(0.07, 0.14), life: 0.7, grav: 0.8 });
    if (k === 0) { g.camera.addTrauma(0.22); g.camera.kick(0.05); }
    this.stats.fired++;
  }

  /** owner (optional): an AI enemy firing the SAME projectile. Owned projectiles never hurt their owner, test against the player instead, and run in WORLD time. imp = attackImpact() bag */
  spawn(origin, dir, speed, owner = null, imp = null) {
    const grp = new THREE.Group();
    const a = new THREE.Mesh(this.geoOuter, this.matOuter), c = new THREE.Mesh(this.geoCore, this.matCore);
    a.castShadow = false; grp.add(a, c);
    const s = rand(0.9, 1.15); grp.scale.set(s, s, s * rand(0.9, 1.15));
    grp.position.copy(origin); grp.lookAt(origin.clone().add(dir)); grp.rotateZ(rand(0, 6.28));
    this.g.scene.add(grp);
    this.projectiles.push({ mesh: grp, pos: origin.clone(), prev: origin.clone(), dir: dir.clone(), speed, life: RANGE / speed, shed: 0, owner, imp });
    return this.projectiles[this.projectiles.length - 1];
  }

  updateProjectiles(dt0) {
    const g = this.g, fx = g.fx;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i], dt = p.owner ? (g.kdt ?? dt0) : dt0; p.life -= dt;
      p.prev.copy(p.pos); const step = p.speed * dt; p.pos.addScaledVector(p.dir, step);
      // collision: nearest of world solids and damageable targets along this frame's segment
      let hit = null;
      const s = g.world.raySolid(p.prev, p.dir, step); if (s) hit = { t: s.t, point: s.point, normal: s.normal, solid: true };
      for (const h of g.world.hittables) { if (p.owner && h === p.owner) continue; const r = h.intersect(p.prev, p.dir, step); if (r && (!hit || r.t < hit.t)) hit = r; }
      if (p.owner) { const pp = playerSegHit(g, p.prev, p.pos, 0.38); if (pp && (!hit || pp.t * step < hit.t)) hit = { t: pp.t * step, point: pp.point, normal: p.dir.clone().negate(), player: true }; }
      if (hit) { this.impact(hit, p); g.scene.remove(p.mesh); this.projectiles.splice(i, 1); continue; }
      if (p.life <= 0 || p.pos.y < 0) { g.scene.remove(p.mesh); this.projectiles.splice(i, 1); continue; }
      p.mesh.position.copy(p.pos);
      // glowing trail + shedding shards
      const n = Math.max(1, Math.round(step / 0.35));
      for (let k = 0; k < n; k++) {
        _v.copy(p.prev).lerp(p.pos, k / n);
        fx.glow.emit({ pos: _v, vel: _v2.set(rand(-0.4, 0.4), rand(-0.4, 0.4), rand(-0.4, 0.4)), size: 0.42, life: 0.3, drag: 2, color: [0.3, 1, 0.6], alpha: 0.9 });
        fx.glow.emit({ pos: _v, size: 0.18, life: 0.14, drag: 0, color: [0.85, 1, 0.95] });
      }
      p.shed -= dt; if (p.shed <= 0) { p.shed = 0.05; _v.copy(p.pos).addScaledVector(p.dir, -0.6); fx.shards.emit({ pos: _v, vel: _v2.set(rand(-1.2, 1.2), rand(-0.4, 1.4), rand(-1.2, 1.2)), size: rand(0.05, 0.1), life: 0.7, grav: 0.35, spin: 12 }); }
    }
  }

  impact(hit, p) {
    const g = this.g, fx = g.fx, n = hit.normal, pt = hit.point, onTarget = !!hit.target || !!hit.player;
    if (hit.player) {
      const o = p.owner, res = g.impact.hitPlayer(Object.assign({}, p.imp, { dir: p.dir.clone().setY(0), point: pt.clone(), src: o, fx: false })); if (o && o.onPlayerHit && !(res && res.passed)) o.onPlayerHit((p.imp && p.imp.name) || 'crystalShot', res);
    } else if (onTarget) {
      hit.target.applyHit(pt, p.dir, DAMAGE); this.stats.hits++;
      g.hud.hit(pt, DAMAGE, hit.target);
    }
    // shatter: fragments burst out along the surface normal + a random spray
    const cnt = onTarget ? 11 : 15;
    for (let i = 0; i < cnt; i++) {
      const v = _v2.set(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).normalize().multiplyScalar(rand(2, 7)).addScaledVector(n, rand(2, 6)).clone();
      fx.shards.emit({ pos: pt, vel: v, size: rand(0.09, 0.3), life: rand(0.9, 1.5), grav: 1 });
    }
    for (let i = 0; i < 16; i++) fx.glow.emit({ pos: pt, vel: new THREE.Vector3(rand(-1, 1), rand(-0.3, 1), rand(-1, 1)).normalize().multiplyScalar(rand(3, 10)).addScaledVector(n, 3), size: rand(0.15, 0.3), life: rand(0.25, 0.55), drag: 2.5, color: [0.4, 1, 0.7] });
    fx.glow.emit({ pos: pt.clone().addScaledVector(n, 0.15), size: 2.8, life: 0.13, drag: 0, color: [0.8, 1, 0.9] });
    fx.surface.ring(pt, n, onTarget ? 1.5 : 2.0);
    if (!onTarget) {
      fx.surface.decal(pt, n, 1.1);
      for (let i = 0; i < 6; i++) fx.dust.emit({ pos: pt.clone().addScaledVector(n, 0.1), vel: new THREE.Vector3(rand(-1, 1), rand(0.2, 1.4), rand(-1, 1)).addScaledVector(n, 1.2), size: rand(0.6, 1.2), grow: 1.2, life: rand(0.5, 0.9), drag: 2, color: [0.62, 0.6, 0.57], alpha: 0.55 });
    }
    const d = g.dh.pos.distanceTo(pt); g.camera.addTrauma(d < 18 ? 0.12 : 0.05);
  }
}
