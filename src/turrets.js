// Training turrets (test props, not aliens): they shoot slow orange bolts at the player so the Crystal Shield has
// something real to block. Bolts collide with the shield, walls and the player; a deflected bolt flies back and
// damages whatever it hits. Turrets can be shot down too.
import * as THREE from 'three';
import { Hittable } from './dummies.js';
import { clamp, rand, angleDelta } from './util.js';
import { attackImpact } from './impact.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

export class Turret extends Hittable {
  constructor(scene, world, pos, game, phase = 0) {
    super(world); this.kind = 'dummy'; this.g = game; this.maxHp = this.hp = 150; this.deadT = 0; this.respawnT = 0;
    this.cool = 1.5 + phase; this.yaw = 0;
    const r = this.root = new THREE.Group(); r.position.copy(pos); scene.add(r);
    const metal = new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.45, metalness: 0.7 });
    const trim = new THREE.MeshStandardMaterial({ color: 0xc2432d, roughness: 0.6, metalness: 0.3 });
    this.glowMat = new THREE.MeshStandardMaterial({ color: 0x401200, emissive: 0xff6a1f, emissiveIntensity: 1.6 });
    const add = (par, geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; par.add(m); return m; };
    add(r, new THREE.CylinderGeometry(0.85, 1.0, 0.25, 8), metal, 0, 0.12, 0);
    add(r, new THREE.CylinderGeometry(0.28, 0.4, 1.1, 8), metal, 0, 0.8, 0);
    this.head = new THREE.Group(); this.head.position.y = 1.55; r.add(this.head);
    add(this.head, new THREE.BoxGeometry(1.0, 0.75, 1.15), metal, 0, 0, 0);
    add(this.head, new THREE.BoxGeometry(1.06, 0.14, 0.7), trim, 0, 0.3, -0.05);
    add(this.head, new THREE.CylinderGeometry(0.17, 0.2, 0.9, 10), metal, 0, 0, 0.9).rotation.x = Math.PI / 2;
    add(this.head, new THREE.CylinderGeometry(0.2, 0.2, 0.08, 10), this.glowMat, 0, 0, 1.36).rotation.x = Math.PI / 2;
    this.muzzle = new THREE.Object3D(); this.muzzle.position.set(0, 0, 1.45); this.head.add(this.muzzle);
    this.spheres = [{ local: new THREE.Vector3(0, 1.55, 0), r: 0.85 }, { local: new THREE.Vector3(0, 0.6, 0), r: 0.6 }];
    this.collider = { pos: r.position, r: 0.8, h: 2.2, dead: false }; world.cylinders.push(this.collider);
    const c = this.barCanvas = document.createElement('canvas'); c.width = 128; c.height = 16; this.barTex = new THREE.CanvasTexture(c);
    this.bar = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.barTex, transparent: true, depthWrite: false })); this.bar.scale.set(1.3, 0.16, 1); this.bar.position.set(0, 2.55, 0); r.add(this.bar);
    this.drawBar(); this.home = pos.clone(); world.hittables.push(this);
  }
  drawBar() {
    const g = this.barCanvas.getContext('2d'); g.clearRect(0, 0, 128, 16); g.fillStyle = 'rgba(0,0,0,0.65)'; g.fillRect(0, 0, 128, 16);
    g.fillStyle = this.hp / this.maxHp > 0.35 ? '#ffb347' : '#ff5a4a'; g.fillRect(3, 3, 122 * clamp(this.hp / this.maxHp, 0, 1), 10); this.barTex.needsUpdate = true;
  }
  applyHit(point, dir, dmg) {
    if (this.dead) return;
    this.hp = Math.max(0, this.hp - dmg); this.hitFlash = 0.14; this.drawBar();
    if (this.hp <= 0) {
      this.dead = true; this.deadT = 0; this.respawnT = 5; this.collider.dead = true; this.bar.visible = false; this.head.rotation.x = 0.5;
      const p = this.root.position.clone(); p.y += 1.5;
      for (let i = 0; i < 24; i++) this.g.fx.shards.emit({ pos: p, vel: _v.set(rand(-1, 1), rand(0.2, 1.4), rand(-1, 1)).normalize().multiplyScalar(rand(3, 9)), size: rand(0.12, 0.3), life: 1.4, grav: 1 });
      for (let i = 0; i < 12; i++) this.g.fx.glow.emit({ pos: p, vel: _v.set(rand(-1, 1), rand(-0.3, 1), rand(-1, 1)).multiplyScalar(5), size: rand(0.4, 0.9), life: 0.5, color: [1, 0.55, 0.2] });
    }
  }
  update(dt) {
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    if (this.override && !this.dead) { this.glowMat.emissiveIntensity = 1.3 + this.hitFlash * 6; this.root.updateMatrixWorld(true); return; }   // linked to Upgrade: he aims it, it never shoots him
    this.glowMat.emissiveIntensity = this.dead ? 0 : 1.3 + this.hitFlash * 6 + Math.max(0, 0.5 - this.cool) * 3;
    if (this.dead) { this.deadT += dt; this.respawnT -= dt; this.head.rotation.x = 0.5; if (this.respawnT <= 0) this.respawn(); this.root.updateMatrixWorld(true); return; }
    this.bar.visible = true;
    // stealth: while the player is invisible the turret has no lock - it keeps facing the last place it saw him, then sweeps, and never fires at a target it cannot see
    const S = this.g.stealth, hid = !!S && S.hidden, P = hid ? S.lastSeen : this.g.player.pos, dx = P.x - this.root.position.x, dz = P.z - this.root.position.z, dist = Math.hypot(dx, dz);
    this.lostT = hid ? (this.lostT || 0) + dt : 0; this.scanT = (this.scanT || 0) + dt; const sweep = hid && this.lostT > 2.5;
    const sm = this.slimeMul ?? 1; this.yaw += angleDelta(this.yaw, sweep ? Math.sin(this.scanT * 0.55 + this.root.position.x) * 1.0 : Math.atan2(dx, dz)) * Math.min(1, dt * sm * (sweep ? 1.6 : 4)); this.head.rotation.y = this.yaw;
    this.cool -= dt * sm;
    if (this.cool <= 0 && !hid && this.g.enemies.enabled && dist < 48 && dist > 5) { this.cool = rand(2.3, 3.1); this.fire(); }
    this.root.updateMatrixWorld(true);
  }
  fire() {
    this.muzzle.getWorldPosition(_v); const origin = _v.clone();
    const hs = this.g.player.hitSphere, sc = hs ? hs.r / 0.95 : 1, tgt = _v2.copy(this.g.player.pos); tgt.y += (hs ? hs.y : 1.5) + rand(-0.3, 0.3) * sc; tgt.x += rand(-0.4, 0.4) * sc;       // aims at the player's REAL hit sphere (a 13 cm alien is aimed at near the ground)
    this.g.enemies.spawnBolt(origin, tgt.sub(origin).normalize(), this);
    this.g.fx.glow.emit({ pos: origin, size: 1.4, life: 0.15, color: [1, 0.7, 0.3], drag: 0 });
  }
  respawn() { this.dead = false; this.hp = this.maxHp; this.collider.dead = false; this.head.rotation.x = 0; this.cool = 2; this.drawBar(); }
}

export class Enemies {
  constructor(game) {
    this.g = game; this.bolts = []; this.enabled = true; this.turrets = [];
    this.geo = new THREE.IcosahedronGeometry(0.3, 1);
    this.matE = new THREE.MeshBasicMaterial({ color: 0xffa040 }); this.matP = new THREE.MeshBasicMaterial({ color: 0x9bffd0 });
    this.stats = { blocked: 0, reflected: 0, hitPlayer: 0 };
  }
  add(t) { this.turrets.push(t); return t; }
  spawnBolt(origin, dir, owner, side = 'enemy', opt = null) {      // V32: opt = { dmgP, kb, speed, scale, red } for the invasion robots / drones (default: the slow orange test bolt)
    const mat = opt && opt.red ? (this.matI || (this.matI = new THREE.MeshBasicMaterial({ color: 0xff3a2a }))) : side === 'player' ? this.matP : this.matE;
    const mesh = new THREE.Mesh(this.geo, mat); mesh.position.copy(origin); if (opt && opt.scale) mesh.scale.setScalar(opt.scale); this.g.scene.add(mesh);
    this.bolts.push({ mesh, pos: origin.clone(), prev: origin.clone(), dir: dir.clone(), speed: opt && opt.speed || 21, life: 4, owner: side, src: owner, dmg: 24, dmgP: opt && opt.dmgP, kb: opt && opt.kb, red: !!(opt && opt.red) });
  }
  update(dt) {
    const g = this.g, fx = g.fx;
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i]; b.life -= dt; b.prev.copy(b.pos); const step = b.speed * dt; b.pos.addScaledVector(b.dir, step);
      let hit = null;
      const s = g.world.raySolid(b.prev, b.dir, step); if (s) hit = { t: s.t, point: s.point, normal: s.normal, kind: 'solid' };
      if (b.owner === 'enemy') {
        const sh = g.p2.shieldHit(b.prev, b.dir, step); if (sh && (!hit || sh.t < hit.t)) hit = { t: sh.t, point: sh.point, normal: sh.normal, kind: 'shield' };
        // player body
        const hs = g.player.hitSphere || { y: 1.4, r: 0.95 }; _v.set(g.player.pos.x, g.player.pos.y + hs.y, g.player.pos.z);
        _v2.copy(_v).sub(b.prev); const tt = clamp(_v2.dot(b.dir), 0, step); const cp = b.prev.clone().addScaledVector(b.dir, tt);
        if (!g.player.ignoreHits && cp.distanceTo(_v) < hs.r && (!hit || tt < hit.t)) hit = { t: tt, point: cp, normal: b.dir.clone().negate(), kind: 'player' };
      } else {
        for (const h of g.world.hittables) { if (h.override || h === b.src) continue; const r = h.intersect(b.prev, b.dir, step); if (r && (!hit || r.t < hit.t)) hit = { t: r.t, point: r.point, normal: r.normal, kind: 'target', target: r.target }; }
      }
      if (hit) {
        if (hit.kind === 'shield') {
          g.p2.shieldAbsorb(hit.point, hit.normal, 15);
          // deflect: send it back at whoever fired it (or mirror it if the shooter is gone)
          const back = b.src ? _v.copy(b.src.root.position).setY(b.src.root.position.y + 1.5).sub(hit.point).normalize() : b.dir.clone().reflect(hit.normal);
          b.dir.copy(back).add(new THREE.Vector3(rand(-0.02, 0.02), rand(-0.02, 0.02), rand(-0.02, 0.02))).normalize(); b.owner = 'player'; b.mesh.material = this.matP; b.speed = 36; b.life = 3; b.pos.copy(hit.point).addScaledVector(b.dir, 0.5); b.mesh.position.copy(b.pos);
          this.stats.blocked++; this.stats.reflected++; continue;
        }
        if (hit.kind === 'player') { g.impact.hitPlayer(attackImpact({ damage: b.dmgP ?? 14, knockbackForce: b.kb ?? 3.4, staggerDuration: 0.22, ordinary: true, point: hit.point.clone(), dir: b.dir.clone(), fx: false })); this.stats.hitPlayer++; }
        if (hit.kind === 'target') { const bd = b.dmg || 24; hit.target.applyHit(hit.point, b.dir, bd); g.hud.hit(hit.point, bd, hit.target); }
        for (let k = 0; k < 8; k++) fx.glow.emit({ pos: hit.point, vel: _v.set(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).normalize().multiplyScalar(rand(3, 8)), size: rand(0.2, 0.4), life: 0.35, drag: 2, color: b.owner === 'enemy' ? [1, 0.55, 0.2] : [0.4, 1, 0.7] });
        fx.glow.emit({ pos: hit.point, size: 2, life: 0.12, drag: 0, color: [1, 0.9, 0.7] });
        fx.surface.ring(hit.point, hit.normal, 1.3, 0.3, b.owner === 'enemy' ? 0xffa050 : 0x7dffc0);
        g.scene.remove(b.mesh); this.bolts.splice(i, 1); continue;
      }
      if (b.life <= 0) { g.scene.remove(b.mesh); this.bolts.splice(i, 1); continue; }
      b.mesh.position.copy(b.pos); const col = b.red ? [1, 0.18, 0.1] : b.owner === 'enemy' ? [1, 0.5, 0.15] : [0.3, 1, 0.6];
      fx.glow.emit({ pos: b.pos, size: 0.9, life: 0.12, drag: 0, color: col, alpha: 0.9 });
      fx.glow.emit({ pos: b.pos, vel: _v.set(rand(-0.5, 0.5), rand(-0.5, 0.5), rand(-0.5, 0.5)), size: 0.4, life: 0.3, drag: 2, color: col, alpha: 0.8 });
    }
  }
}
