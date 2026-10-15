// Pooled camera-facing ribbon trails (speed streaks). One preallocated mesh per emitter; no allocation per frame.
import * as THREE from 'three';

export class RibbonTrails {
  /** @param emitters [{name, color:[r,g,b], width, points}] */
  constructor(scene, camera, emitters) {
    this.cam = camera; this.list = []; this.group = new THREE.Group(); this.group.frustumCulled = false; scene.add(this.group);
    for (const e of emitters) {
      const N = e.points || 26, geo = new THREE.BufferGeometry();
      const pos = new Float32Array(N * 2 * 3), col = new Float32Array(N * 2 * 3), idx = [];
      for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setIndex(idx);
      const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false });
      const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.visible = false; this.group.add(mesh);
      this.list.push({ name: e.name, N, mesh, pos, col, geo, color: e.color, width: e.width ?? 0.14, life: e.life ?? 0.45, hist: Array.from({ length: N }, () => ({ p: new THREE.Vector3(), age: 99 })), head: 0, count: 0, last: new THREE.Vector3(), has: false, gain: 0 });
    }
    this._d = new THREE.Vector3(); this._s = new THREE.Vector3(); this._v = new THREE.Vector3();
  }
  /** feed the current world position of an emitter. gain 0..1 scales brightness (e.g. from speed). */
  push(name, p, gain) {
    const t = this.list.find(x => x.name === name); if (!t) return;
    t.gain = gain;
    if (!t.has || p.distanceToSquared(t.last) > 0.0036) {
      t.head = (t.head + 1) % t.N; const h = t.hist[t.head]; h.p.copy(p); h.age = 0; t.count = Math.min(t.N, t.count + 1); t.last.copy(p); t.has = true;
    }
  }
  clear() { for (const t of this.list) { t.count = 0; t.has = false; t.mesh.visible = false; } }
  update(dt) {
    const cam = this.cam.position;
    for (const t of this.list) {
      for (let i = 0; i < t.count; i++) t.hist[(t.head - i + t.N) % t.N].age += dt;
      let n = 0;
      for (let i = 0; i < t.count; i++) { if (t.hist[(t.head - i + t.N) % t.N].age < t.life) n++; else break; }
      if (n < 2 || t.gain <= 0.01 && t.hist[t.head].age > t.life) { t.mesh.visible = false; continue; }
      t.mesh.visible = true;
      for (let i = 0; i < t.N; i++) {
        const k = Math.min(i, n - 1), h = t.hist[(t.head - k + t.N) % t.N], hp = t.hist[(t.head - Math.min(k + 1, n - 1) + t.N) % t.N], hn = t.hist[(t.head - Math.max(k - 1, 0) + t.N) % t.N];
        const dir = this._d.subVectors(hn.p, hp.p); if (dir.lengthSq() < 1e-8) dir.set(0, 0, 1); dir.normalize();
        const toCam = this._v.subVectors(cam, h.p).normalize(); const side = this._s.crossVectors(dir, toCam); if (side.lengthSq() < 1e-6) side.set(0, 1, 0); side.normalize();
        const u = Math.min(1, h.age / t.life), fade = i >= n ? 0 : (1 - u) * (1 - u), w = t.width * (1 - 0.85 * u) * (i >= n ? 0 : 1);
        const dc = Math.hypot(cam.x - h.p.x, cam.y - h.p.y, cam.z - h.p.z), near = Math.min(1, Math.max(0, (dc - 1.2) / 3.5)), a = fade * Math.min(1, t.gain * 1.1) * 0.65 * near * near * (3 - 2 * near), o = i * 6;
        t.pos[o] = h.p.x + side.x * w; t.pos[o + 1] = h.p.y + side.y * w; t.pos[o + 2] = h.p.z + side.z * w;
        t.pos[o + 3] = h.p.x - side.x * w; t.pos[o + 4] = h.p.y - side.y * w; t.pos[o + 5] = h.p.z - side.z * w;
        for (let j = 0; j < 2; j++) { t.col[o + j * 3] = t.color[0] * a; t.col[o + j * 3 + 1] = t.color[1] * a; t.col[o + j * 3 + 2] = t.color[2] * a; }
      }
      t.geo.attributes.position.needsUpdate = true; t.geo.attributes.color.needsUpdate = true;
    }
  }
}
