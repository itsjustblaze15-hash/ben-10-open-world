// Enemy test dummies and bullseye targets. Pure test props (not other aliens).
import * as THREE from 'three';
import { clamp, damp, easeOutBack } from './util.js';

function segSphere(o, d, maxT, c, r) {
  const m = new THREE.Vector3().subVectors(o, c), b = m.dot(d), cc = m.lengthSq() - r * r;
  if (cc > 0 && b > 0) return null;
  const disc = b * b - cc; if (disc < 0) return null;
  const t = Math.max(0, -b - Math.sqrt(disc)); return t <= maxT ? t : null;
}

export class Hittable {
  constructor(world) { this.world = world; this.hp = 100; this.maxHp = 100; this.dead = false; this.hitFlash = 0; this.spheres = []; this.tilt = new THREE.Vector2(); this.tiltV = new THREE.Vector2(); }
  intersect(o, d, maxT) {
    if (this.dead && this.deadT > 0.3) return null;
    let best = null; const c = new THREE.Vector3();
    for (const s of this.spheres) {
      c.copy(s.local); this.root.localToWorld(c);
      const t = segSphere(o, d, maxT, c, s.r);
      if (t !== null && (!best || t < best.t)) { const p = o.clone().addScaledVector(d, t); best = { t, point: p, normal: p.clone().sub(c).normalize(), target: this }; }
    }
    return best;
  }
}

export class Dummy extends Hittable {
  constructor(scene, world, pos, yaw = 0, label = 'DUMMY') {
    super(world); this.kind = 'dummy'; this.home = pos.clone(); this.spawn = pos.clone(); this.air = 0; this.airV = 0; this.deadT = 0; this.respawnT = 0; this.slide = new THREE.Vector3(); this.slideV = new THREE.Vector3(); this.kv = new THREE.Vector3(); this.chase = null; this.walkT = 0; this.confuse = 0; this.held = false; this.thrown = 0; this.onImpact = null;
    const r = this.root = new THREE.Group(); r.position.copy(pos); r.rotation.y = yaw; scene.add(r);
    const fabric = new THREE.MeshStandardMaterial({ color: 0xc4a572, roughness: 0.95 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x343a40, roughness: 0.6, metalness: 0.4 });
    const red = new THREE.MeshStandardMaterial({ color: 0xc23b2e, roughness: 0.8 });
    this.mats = [fabric, red];
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; r.add(m); return m; };
    this.body = new THREE.Group(); r.add(this.body); // pivots at the base so tilting rocks it
    const bAdd = (geo, mat, x, y, z) => { const m = add(geo, mat, x, y, z); r.remove(m); this.body.add(m); return m; };
    add(new THREE.CylinderGeometry(0.75, 0.85, 0.14, 24), dark, 0, 0.07, 0);
    bAdd(new THREE.CylinderGeometry(0.1, 0.1, 0.9, 10), dark, 0, 0.55, 0);
    bAdd(new THREE.CapsuleGeometry(0.42, 0.75, 6, 16), fabric, 0, 1.35, 0);
    bAdd(new THREE.CylinderGeometry(0.44, 0.44, 0.5, 20), red, 0, 1.45, 0).scale.set(1, 1, 0.82);
    bAdd(new THREE.SphereGeometry(0.29, 20, 14), fabric, 0, 2.1, 0);
    bAdd(new THREE.CylinderGeometry(0.1, 0.12, 0.2, 10), dark, 0, 1.88, 0);
    for (const sx of [-1, 1]) { const a = bAdd(new THREE.CapsuleGeometry(0.11, 0.7, 4, 10), fabric, sx * 0.62, 1.4, 0); a.rotation.z = sx * 0.12; }
    // target patch on chest
    const patch = bAdd(new THREE.CircleGeometry(0.2, 24), new THREE.MeshBasicMaterial({ color: 0xffffff }), 0, 1.5, 0.36); this.patch = patch;
    this.spheres = [{ local: new THREE.Vector3(0, 0.7, 0), r: 0.5 }, { local: new THREE.Vector3(0, 1.15, 0), r: 0.55 }, { local: new THREE.Vector3(0, 1.6, 0), r: 0.55 }, { local: new THREE.Vector3(0, 2.1, 0), r: 0.34 }];
    this.collider = { pos: r.position, r: 0.62, h: 2.4, dead: false }; world.cylinders.push(this.collider);
    // hp bar
    const c = this.barCanvas = document.createElement('canvas'); c.width = 128; c.height = 16; this.barTex = new THREE.CanvasTexture(c);
    this.bar = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.barTex, transparent: true, depthWrite: false })); this.bar.scale.set(1.3, 0.16, 1); this.bar.position.set(0, 2.75, 0); r.add(this.bar);
    this.drawBar(); world.hittables.push(this);
  }
  drawBar() {
    const g = this.barCanvas.getContext('2d'); g.clearRect(0, 0, 128, 16);
    g.fillStyle = 'rgba(0,0,0,0.65)'; g.fillRect(0, 0, 128, 16);
    g.fillStyle = this.hp / this.maxHp > 0.35 ? '#46e88a' : '#ff5a4a'; g.fillRect(3, 3, 122 * clamp(this.hp / this.maxHp, 0, 1), 10);
    this.barTex.needsUpdate = true;
  }
  applyHit(point, dir, dmg) {
    if (this.dead) return;
    this.hp = Math.max(0, this.hp - dmg); this.hitFlash = 0.14; this.drawBar();
    const kx = dir.x, kz = dir.z; const k = Math.hypot(kx, kz) || 1;
    // tilt away from the hit and slide a little
    this.tiltV.x += (kz / k) * 3.2; this.tiltV.y -= (kx / k) * 3.2;
    this.slideV.x += (kx / k) * 2.2; this.slideV.z += (kz / k) * 2.2;
    this.lastDir = new THREE.Vector2(kx / k, kz / k);
    if (this.hp <= 0) { this.dead = true; this.deadT = 0; this.respawnT = 3.5; this.collider.dead = true; this.tiltV.x += (kz / k) * 3; this.tiltV.y -= (kx / k) * 3; }
  }
  update(dt) {
    // spring tilt (x rotates about X axis: +z lean => rotation.x positive)
    const target = this.dead ? new THREE.Vector2(this.lastDir ? this.lastDir.y * 1.45 : 1.45, this.lastDir ? -this.lastDir.x * 1.45 : 0) : new THREE.Vector2();
    const k = this.dead ? 14 : 70, c = this.dead ? 5.5 : 5.5;
    this.tiltV.x += ((target.x - this.tilt.x) * k - this.tiltV.x * c) * dt; this.tiltV.y += ((target.y - this.tilt.y) * k - this.tiltV.y * c) * dt;
    this.tilt.x += this.tiltV.x * dt; this.tilt.y += this.tiltV.y * dt;
    this.body.rotation.x = this.tilt.x; this.body.rotation.z = this.tilt.y;
    // slide spring
    // accumulated knockback velocity: impulses add up while time is slowed and keep carrying once normal time returns (also for a fallen dummy)
    if (this.kv.lengthSq() > 1e-4) {
      this.home.x += this.kv.x * dt; this.home.z += this.kv.z * dt; this.kv.multiplyScalar(Math.exp(-2.4 * dt)); if (this.kv.lengthSq() < 1e-3) this.kv.set(0, 0, 0);
      const bx = this.home.x, bz = this.home.z;
      const was = this.collider.dead; this.collider.dead = true; this.world.resolveXZ(this.home, 0.62, 0, 2.4, 0.3); this.collider.dead = was; if (this.world.lagoon) this.world.lagoon.keepOut(this.home, 0.62);
      if (this.thrown > 0 && Math.hypot(this.home.x - bx, this.home.z - bz) > 0.02 && this.kv.length() > 10) {   // slammed into something while thrown
        this.thrown = 0; const sp = this.kv.length(); this.kv.multiplyScalar(0.15);
        if (!this.dead) { this.applyHit(this.root.position.clone().setY(this.root.position.y + 1.3), new THREE.Vector3(this.kv.x, 0, this.kv.z).normalize(), 12); if (this.onImpact) this.onImpact(this, sp); }
      }
      if (!this.world.island) { this.home.x = clamp(this.home.x, -33, 33); this.home.z = clamp(this.home.z, -33, 33); }       // V30: the arena is walled, the island is not
      if (this.dead) this.root.position.set(this.home.x + this.slide.x, this.root.position.y, this.home.z + this.slide.z);
    }
    if (!this.dead) {
      // training-runner AI (runs on WORLD time: slows down with the time-slow ability)
      let walking = false;
      if (this.confuse > 0) this.confuse = Math.max(0, this.confuse - dt);
      if (this.held) this.kv.set(0, 0, 0);
      if (this.chase && this.air === 0 && !this.held && this.confuse <= 0 && !this.slimeStuck) {
        const t = this.chase.pos, dx = t.x - this.home.x, dz = t.z - this.home.z, d = Math.hypot(dx, dz);
        if (d > 2.4 && d < 45) { const sm = this.slimeMul ?? 1, sp = 3.2 * sm; this.home.x += dx / d * sp * dt; this.home.z += dz / d * sp * dt; walking = sm > 0.05; this.walkT += dt * 9 * sm;
          const want = Math.atan2(dx, dz); let da = (want - this.root.rotation.y) % (Math.PI * 2); if (da > Math.PI) da -= Math.PI * 2; if (da < -Math.PI) da += Math.PI * 2; this.root.rotation.y += da * Math.min(1, dt * 6); }
      }
      this.body.position.y = walking ? Math.abs(Math.sin(this.walkT)) * 0.07 : this.body.position.y * Math.max(0, 1 - 8 * dt);
      if (walking) { this.collider.dead = true; this.world.resolveXZ(this.home, 0.62, 0, 2.4, 0.3); this.collider.dead = false; if (this.world.lagoon) this.world.lagoon.keepOut(this.home, 0.62); }
      this.slideV.addScaledVector(this.slide, -60 * dt).multiplyScalar(Math.max(0, 1 - 6 * dt)); this.slide.addScaledVector(this.slideV, dt);
      this.root.position.set(this.home.x + this.slide.x, this.home.y, this.home.z + this.slide.z);
    }
    if (this.air > 0 || this.airV > 0) { this.airV -= 26 * dt; this.air += this.airV * dt; if (this.air <= 0) { this.air = 0; this.airV = 0; if (!this.held) this.thrown = 0; this.tiltV.multiplyScalar(0.3); } }
    if (this.world.island && this.world.groundAt && this.air <= 0.001 && !this.held) { const gy = this.world.groundAt(this.home.x, this.home.z, this.home.y + 2.2, 0.5, 0.3); if (Number.isFinite(gy)) this.home.y += (gy - this.home.y) * Math.min(1, dt * 14); }       // V30: stand on the island ground
    this.root.position.y = this.home.y + this.air;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    for (const m of this.mats) { m.emissive = m.emissive || new THREE.Color(); }
    this.mats[0].emissive.setRGB(this.hitFlash * 4, this.hitFlash * 8, this.hitFlash * 5);
    this.bar.visible = !this.dead;
    this.root.updateMatrixWorld(true);
    if (this.dead) { this.deadT += dt; this.respawnT -= dt; if (this.respawnT <= 0) this.respawn(); }
  }
  /** shove the dummy away (it stays where it lands) */
  knock(dir, force) { const L = this.world.island ? 1e5 : 33; this.home.x = clamp(this.home.x + dir.x * force * 0.4, -L, L); this.home.z = clamp(this.home.z + dir.z * force * 0.4, -L, L); this.slideV.x += dir.x * force * 0.5; this.slideV.z += dir.z * force * 0.5; }
  /** add a real momentum impulse (m/s) - accumulates and is integrated on world time */
  shove(dir, speed) { this.kv.x += dir.x * speed; this.kv.z += dir.z * speed; const m = this.kv.length(); if (m > 42) this.kv.multiplyScalar(42 / m); }
  /** throw the dummy into the air */
  launch(vy) { this.airV = Math.max(this.airV, vy); this.air = Math.max(this.air, 0.02); this.tiltV.x += (Math.random() - 0.5) * 9; this.tiltV.y += (Math.random() - 0.5) * 9; }
  release() { this.held = false; if (!this.dead) this.collider.dead = false; }
  respawn() {
    this.held = false; this.thrown = 0; this.confuse = 0; this.collider.dead = false;
    this.home.copy(this.spawn); this.air = 0; this.airV = 0; this.kv.set(0, 0, 0);
    this.dead = false; this.hp = this.maxHp; this.tilt.set(0, 0); this.tiltV.set(0, 0); this.collider.dead = false; this.slide.set(0, 0, 0); this.slideV.set(0, 0, 0);
    this.root.position.copy(this.home); this.drawBar(); this.popT = 0;
  }
}

export class Target extends Hittable {
  constructor(scene, world, pos, yaw = 0) {
    super(world); this.kind = 'target'; this.root = new THREE.Group(); this.root.position.copy(pos); this.root.rotation.y = yaw; scene.add(this.root);
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
    const cols = ['#f4f4f0', '#d8342a', '#f4f4f0', '#d8342a', '#f4f4f0', '#d8342a'];
    for (let i = 0; i < 6; i++) { g.fillStyle = cols[i]; g.beginPath(); g.arc(128, 128, 124 - i * 20, 0, 7); g.fill(); }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const dark = new THREE.MeshStandardMaterial({ color: 0x30343a, roughness: 0.6, metalness: 0.5 });
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.6, 10), dark); post.position.y = 1.3; post.castShadow = true; this.root.add(post);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 0.12, 20), dark); base.position.y = 0.06; base.castShadow = base.receiveShadow = true; this.root.add(base);
    this.board = new THREE.Group(); this.board.position.y = 2.35; this.root.add(this.board);
    this.faceMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: 0x000000 });
    const face = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.12, 40), [dark, this.faceMat, dark]); face.rotation.x = Math.PI / 2; face.castShadow = true; this.board.add(face);
    this.spheres = [{ local: new THREE.Vector3(0, 2.35, 0.05), r: 0.85 }];
    this.hits = 0; world.hittables.push(this); this.home = pos.clone();
  }
  applyHit(point, dir, dmg) {
    this.hits++; this.hitFlash = 0.18; const k = Math.hypot(dir.x, dir.z) || 1;
    this.tiltV.x += (dir.z / k) * 4; this.tiltV.y -= (dir.x / k) * 4;
  }
  update(dt) {
    this.tiltV.x += (-this.tilt.x * 90 - this.tiltV.x * 4) * dt; this.tiltV.y += (-this.tilt.y * 90 - this.tiltV.y * 4) * dt;
    this.tilt.x += this.tiltV.x * dt; this.tilt.y += this.tiltV.y * dt;
    this.root.rotation.x = this.tilt.x * 0.5; this.root.rotation.z = this.tilt.y * 0.5;
    this.hitFlash = Math.max(0, this.hitFlash - dt); this.faceMat.emissive.setRGB(0, this.hitFlash * 3, this.hitFlash * 1.4);
    this.root.updateMatrixWorld(true);
  }
}
