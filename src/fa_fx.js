// Effects used by Four Arms: pooled rock debris (instanced boxes with gravity/bounce) and pooled ground-crack decals.
import * as THREE from 'three';
import { rand } from './util.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _c = new THREE.Color();

export class DebrisSystem {
  constructor(scene, world, cap = 360) {
    this.world = world; this.cap = cap; this.n = 0;
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0.05 }), cap);
    this.mesh.castShadow = true; this.mesh.frustumCulled = false; this.mesh.count = cap; scene.add(this.mesh);
    this.p = Array.from({ length: cap }, () => ({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Vector3(), rv: new THREE.Vector3(), size: new THREE.Vector3(), life: 0, max: 1, col: 0, rest: false }));
    _m.makeScale(0, 0, 0); for (let i = 0; i < cap; i++) { this.mesh.setMatrixAt(i, _m); this.mesh.setColorAt(i, _c.set(0x888888)); }
  }
  emit({ pos, vel, size = 0.25, life = 4, color = 0x9a9a98, spin = 8 }) {
    const q = this.p[this.n++ % this.cap]; q.pos.copy(pos); q.vel.copy(vel); q.size.set(size * rand(0.6, 1.4), size * rand(0.5, 1.1), size * rand(0.6, 1.4)); q.life = life; q.max = life; q.rest = false;
    q.rot.set(rand(0, 6), rand(0, 6), rand(0, 6)); q.rv.set(rand(-spin, spin), rand(-spin, spin), rand(-spin, spin)); q.col = color;
    this.mesh.setColorAt(this.p.indexOf(q), _c.set(color).multiplyScalar(rand(0.8, 1.1))); this.mesh.instanceColor.needsUpdate = true;
  }
  /** burst of chunks (radial, with upward bias) */
  burst(pos, count, speed, size, color, up = 0.6) {
    const v = new THREE.Vector3();
    for (let i = 0; i < count; i++) { v.set(rand(-1, 1), rand(0.1, 1) * (1 + up), rand(-1, 1)).normalize().multiplyScalar(rand(0.4, 1) * speed); this.emit({ pos, vel: v, size: size * rand(0.5, 1.3), life: rand(2.5, 5), color }); }
  }
  update(dt) {
    for (let i = 0; i < this.cap; i++) {
      const q = this.p[i]; if (q.life <= 0) continue;
      q.life -= dt;
      if (q.life <= 0) { _m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, _m); continue; }
      if (!q.rest) {
        const L = this.world.lagoon, wet = L && q.pos.y < L.waterY && L.inRect(q.pos.x, q.pos.z);       // under the lagoon's water line: slow sink, heavy drag, rests on the bed
        if (wet) { q.vel.y -= 5 * dt; const k = Math.exp(-2.4 * dt); q.vel.x *= k; q.vel.z *= k; q.vel.y *= Math.exp(-1.3 * dt); q.rv.multiplyScalar(k); } else q.vel.y -= 24 * dt;
        q.pos.addScaledVector(q.vel, dt); q.rot.addScaledVector(q.rv, dt);
        const gy = (wet ? L.groundFor(q.pos.x, q.pos.z, q.pos.y + 0.3, 0.3, 0.05) : this.world.groundAt(q.pos.x, q.pos.z, q.pos.y + 0.3, 0.3, 0.05)) + q.size.y * 0.4;
        if (q.pos.y < gy) { q.pos.y = gy; if (q.vel.y < -2) { q.vel.y *= -0.32; q.vel.x *= 0.6; q.vel.z *= 0.6; q.rv.multiplyScalar(0.55); } else { q.vel.set(0, 0, 0); q.rest = true; q.rv.set(0, 0, 0); } }
      }
      const sc = Math.min(1, q.life / 0.6);
      _e.set(q.rot.x, q.rot.y, q.rot.z); _q.setFromEuler(_e); _s.copy(q.size).multiplyScalar(sc);
      _m.compose(q.pos, _q, _s); this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  clear() { for (const q of this.p) q.life = 0; _m.makeScale(0, 0, 0); for (let i = 0; i < this.cap; i++) this.mesh.setMatrixAt(i, _m); this.mesh.instanceMatrix.needsUpdate = true; }
}

function crackTexture(seed) {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); g.clearRect(0, 0, 256, 256);
  let s = seed * 9301 + 49297; const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  g.lineCap = 'round'; g.strokeStyle = 'rgba(15,12,10,0.9)';
  const branch = (x, y, a, len, w, depth) => {
    if (len < 6 || depth > 4) return; const steps = 5;
    for (let i = 0; i < steps; i++) {
      const na = a + (r() - 0.5) * 0.7, nx = x + Math.cos(na) * len / steps, ny = y + Math.sin(na) * len / steps;
      g.lineWidth = w; g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke(); x = nx; y = ny; a = na;
      if (r() < 0.35) branch(x, y, a + (r() < 0.5 ? 1 : -1) * (0.5 + r() * 0.6), len * 0.55, w * 0.65, depth + 1);
    }
  };
  const N = 9 + (seed % 3); for (let i = 0; i < N; i++) branch(128, 128, (i / N) * Math.PI * 2 + r() * 0.4, 120 + r() * 8, 4, 0);
  g.fillStyle = 'rgba(20,16,12,0.45)'; g.beginPath(); g.arc(128, 128, 14, 0, 7); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class CrackField {
  constructor(scene, cap = 18) {
    this.cap = cap; this.i = 0; this.items = [];
    const texs = [crackTexture(1), crackTexture(2), crackTexture(3)];
    for (let k = 0; k < cap; k++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: texs[k % 3], transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, opacity: 0 }));
      m.rotation.x = -Math.PI / 2; m.visible = false; m.renderOrder = 2; scene.add(m); this.items.push({ m, t: 0, life: 0, grow: 0, size: 1 });
    }
  }
  /** a crack decal of diameter `size` lying on the surface at (x, y, z) */
  add(x, y, z, size, life = 9) { const it = this.items[this.i++ % this.cap]; it.m.position.set(x, y + 0.03, z); it.m.rotation.set(-Math.PI / 2, 0, rand(0, 6)); it.wall = false; it.size = size; it.t = 0; it.life = life; it.m.visible = true; it.m.scale.setScalar(size * 0.3); it.m.material.opacity = 0.95; }
  /** crack decal on a vertical face (normal n) */
  addWall(x, y, z, n, size, life = 60) {
    const it = this.items[this.i++ % this.cap], m = it.m; m.position.set(x + n.x * 0.03, y, z + n.z * 0.03); m.rotation.set(0, 0, 0); m.lookAt(m.position.x + n.x, m.position.y, m.position.z + n.z); m.rotateZ(rand(0, 6));
    it.size = size; it.t = 0; it.life = life; m.visible = true; m.scale.setScalar(size * 0.3); m.material.opacity = 0.95; it.wall = true;
  }
  update(dt) { for (const it of this.items) { if (!it.m.visible) continue; it.t += dt; const g = Math.min(1, it.t / 0.18); it.m.scale.setScalar(it.size * (0.3 + 0.7 * (1 - Math.pow(1 - g, 3)))); const f = it.t > it.life - 2 ? Math.max(0, (it.life - it.t) / 2) : 1; it.m.material.opacity = 0.95 * f; if (it.t >= it.life) it.m.visible = false; } }
  clear() { for (const it of this.items) it.m.visible = false; }
}
