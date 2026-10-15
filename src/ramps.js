// Sloped solids (wedge ramps, mounds). The arena was built from axis-aligned boxes only, so Cannonbolt's ramps are a small height-field solid with three views of the SAME surface:
//  - height(x, z)       walking surface (groundAt)           - every alien can walk up / down slopes the usual way (step height limits still apply)
//  - push(pos, r, y, s) side / back walls + "too steep to step onto" (resolveXZ)  - same contract as the boxes
//  - ray(o, d, maxT)    camera / aim / projectile rays       - the camera never goes through a ramp
//  - tris / sphereHits  the triangle soup the rolling ball collides with (closest point, normal) - real slopes, edges, side walls
// The mesh that is drawn is built from the same triangles.
import * as THREE from 'three';

const DIRS = []; for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; DIRS.push([Math.cos(a), Math.sin(a)]); }
const _ab = new THREE.Vector3(), _ac = new THREE.Vector3(), _ap = new THREE.Vector3(), _bp = new THREE.Vector3(), _cp = new THREE.Vector3();

/** closest point on triangle (a,b,c) to p -> written into out (Ericson, Real-Time Collision Detection) */
export function closestOnTri(p, a, b, c, out) {
  _ab.subVectors(b, a); _ac.subVectors(c, a); _ap.subVectors(p, a);
  const d1 = _ab.dot(_ap), d2 = _ac.dot(_ap); if (d1 <= 0 && d2 <= 0) return out.copy(a);
  _bp.subVectors(p, b); const d3 = _ab.dot(_bp), d4 = _ac.dot(_bp); if (d3 >= 0 && d4 <= d3) return out.copy(b);
  const vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return out.copy(a).addScaledVector(_ab, v); }
  _cp.subVectors(p, c); const d5 = _ab.dot(_cp), d6 = _ac.dot(_cp); if (d6 >= 0 && d5 <= d6) return out.copy(c);
  const vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return out.copy(a).addScaledVector(_ac, w); }
  const va = d3 * d6 - d5 * d4; if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return out.copy(b).addScaledVector(_cp.subVectors(c, b), w); }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; return out.copy(a).addScaledVector(_ab, v).addScaledVector(_ac, w);
}

export class Ramp {
  /** o: { x, z, yaw, hu, hv, fn(u,v) -> height, cell, material, name }.  Local axes: u = (cos yaw, -sin yaw), v = (sin yaw, cos yaw); a wedge rises along +v. */
  constructor(scene, o) {
    this.x = o.x; this.z = o.z; this.yaw = o.yaw || 0; this.hu = o.hu; this.hv = o.hv; this.fn = o.fn; this.name = o.name || 'RAMP'; this.surface = o.surface || 'concrete';
    this.c = Math.cos(this.yaw); this.s = Math.sin(this.yaw);
    const cell = o.cell || 0.5, nu = Math.max(1, Math.round(2 * this.hu / cell)), nv = Math.max(1, Math.round(2 * this.hv / cell)); this.nu = nu; this.nv = nv;
    this.H = new Float32Array((nu + 1) * (nv + 1)); let hmax = 0;
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) { const h = Math.max(0, this.fn(-this.hu + 2 * this.hu * i / nu, -this.hv + 2 * this.hv * j / nv)); this.H[i * (nv + 1) + j] = h; hmax = Math.max(hmax, h); }
    this.hmax = hmax;
    const cs = [[-this.hu, -this.hv], [this.hu, -this.hv], [-this.hu, this.hv], [this.hu, this.hv]].map(([u, v]) => this.toWorld(u, v));
    this.minx = Math.min(...cs.map(p => p[0])); this.maxx = Math.max(...cs.map(p => p[0])); this.minz = Math.min(...cs.map(p => p[1])); this.maxz = Math.max(...cs.map(p => p[1]));
    this.buildTris(); this.buildMesh(scene, o.material);
  }
  toLocal(x, z) { const dx = x - this.x, dz = z - this.z; return [dx * this.c - dz * this.s, dx * this.s + dz * this.c]; }
  toWorld(u, v) { return [this.x + u * this.c + v * this.s, this.z - u * this.s + v * this.c]; }
  hAt(i, j) { return this.H[i * (this.nv + 1) + j]; }
  /** surface height (bilinear on the same grid the triangles use); -Infinity outside the footprint */
  height(x, z) {
    if (x < this.minx || x > this.maxx || z < this.minz || z > this.maxz) return -Infinity;
    const [u, v] = this.toLocal(x, z); if (u < -this.hu || u > this.hu || v < -this.hv || v > this.hv) return -Infinity;
    const fu = (u + this.hu) / (2 * this.hu) * this.nu, fv = (v + this.hv) / (2 * this.hv) * this.nv, i = Math.min(this.nu - 1, Math.floor(fu)), j = Math.min(this.nv - 1, Math.floor(fv)), a = fu - i, b = fv - j;
    return this.hAt(i, j) * (1 - a) * (1 - b) + this.hAt(i + 1, j) * a * (1 - b) + this.hAt(i, j + 1) * (1 - a) * b + this.hAt(i + 1, j + 1) * a * b;
  }
  /** unit surface normal at (x, z) (outside the footprint: straight up) */
  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 0.2, hx = (this.height(x + e, z) - this.height(x - e, z)) / (2 * e), hz = (this.height(x, z + e) - this.height(x, z - e)) / (2 * e);
    if (!isFinite(hx) || !isFinite(hz)) return out.set(0, 1, 0); return out.set(-hx, 1, -hz).normalize();
  }
  blocked(x, z, r, lim) { return this.height(x, z) > lim || this.height(x + r, z) > lim || this.height(x - r, z) > lim || this.height(x, z + r) > lim || this.height(x, z - r) > lim; }
  /** keep a walker (circle r, feet at y, can step stepH) out of the part of the solid that is higher than it can step onto - nearest free position */
  push(pos, r, y, stepH) {
    if (pos.x < this.minx - r - 0.1 || pos.x > this.maxx + r + 0.1 || pos.z < this.minz - r - 0.1 || pos.z > this.maxz + r + 0.1 || y + stepH >= this.hmax) return;
    const lim = y + stepH; if (!this.blocked(pos.x, pos.z, r, lim)) return;
    for (let d = 0.08; d <= 6; d += 0.08) for (const [dx, dz] of DIRS) { const px = pos.x + dx * d, pz = pos.z + dz * d; if (!this.blocked(px, pz, r, lim)) { pos.x = px; pos.z = pz; return; } }
  }
  // ----------------------------------------------------------------------------------------------- triangles
  buildTris() {
    const T = [], P = (i, j) => { const u = -this.hu + 2 * this.hu * i / this.nu, v = -this.hv + 2 * this.hv * j / this.nv, [x, z] = this.toWorld(u, v); return new THREE.Vector3(x, this.hAt(i, j), z); };
    const G = (i, j) => { const p = P(i, j); return new THREE.Vector3(p.x, 0, p.z); };
    const add = (a, b, c, top) => { const n = new THREE.Vector3().subVectors(b, a).cross(_ac.subVectors(c, a)).normalize(); const cen = new THREE.Vector3().add(a).add(b).add(c).multiplyScalar(1 / 3);
      if (top ? n.y < 0 : n.dot(_ab.set(cen.x - this.x, 0, cen.z - this.z)) < 0) { n.negate(); T.push({ a, b: c, c: b, n, top }); } else T.push({ a, b, c, n, top }); };
    for (let i = 0; i < this.nu; i++) for (let j = 0; j < this.nv; j++) { const p00 = P(i, j), p10 = P(i + 1, j), p01 = P(i, j + 1), p11 = P(i + 1, j + 1); add(p00, p10, p11, true); add(p00, p11, p01, true); }
    const wall = (p, q, gp, gq) => { if (p.y > 0.004 || q.y > 0.004) { add(gp, gq, q, false); add(gp, q, p, false); } };
    for (let i = 0; i < this.nu; i++) { wall(P(i, 0), P(i + 1, 0), G(i, 0), G(i + 1, 0)); wall(P(i, this.nv), P(i + 1, this.nv), G(i, this.nv), G(i + 1, this.nv)); }
    for (let j = 0; j < this.nv; j++) { wall(P(0, j), P(0, j + 1), G(0, j), G(0, j + 1)); wall(P(this.nu, j), P(this.nu, j + 1), G(this.nu, j), G(this.nu, j + 1)); }
    this.tris = T; for (const t of T) { t.minx = Math.min(t.a.x, t.b.x, t.c.x); t.maxx = Math.max(t.a.x, t.b.x, t.c.x); t.miny = Math.min(t.a.y, t.b.y, t.c.y); t.maxy = Math.max(t.a.y, t.b.y, t.c.y); t.minz = Math.min(t.a.z, t.b.z, t.c.z); t.maxz = Math.max(t.a.z, t.b.z, t.c.z); }
  }
  /** contacts of a sphere (centre c, radius R) with this solid -> pushes { n, pen, p } into out (n points from the surface to the sphere) */
  sphereHits(c, R, out) {
    if (c.x < this.minx - R || c.x > this.maxx + R || c.z < this.minz - R || c.z > this.maxz + R || c.y > this.hmax + R) return;
    const q = new THREE.Vector3();
    for (const t of this.tris) {
      if (c.x < t.minx - R || c.x > t.maxx + R || c.y < t.miny - R || c.y > t.maxy + R || c.z < t.minz - R || c.z > t.maxz + R) continue;
      closestOnTri(c, t.a, t.b, t.c, q); const dx = c.x - q.x, dy = c.y - q.y, dz = c.z - q.z, d2 = dx * dx + dy * dy + dz * dz; if (d2 >= R * R) continue;
      const d = Math.sqrt(d2), side = dx * t.n.x + dy * t.n.y + dz * t.n.z;
      if (side < 0) out.push({ n: t.n.clone(), pen: R + d, p: q.clone(), tri: t, surface: this.surface, ramp: this });          // centre behind the face (tunnelled): use the face normal
      else if (d > 1e-5) out.push({ n: new THREE.Vector3(dx / d, dy / d, dz / d), pen: R - d, p: q.clone(), tri: t, surface: this.surface, ramp: this });
      else out.push({ n: t.n.clone(), pen: R, p: q.clone(), tri: t, surface: this.surface, ramp: this });
    }
  }
  /** ray (origin o, direction d, 0..maxT in units of |d|) -> { t, normal } | null  (Moller-Trumbore, front or back faces) */
  ray(o, d, maxT) {
    const ex = o.x + d.x * maxT, ez = o.z + d.z * maxT, ey = o.y + d.y * maxT;
    if (Math.max(o.x, ex) < this.minx || Math.min(o.x, ex) > this.maxx || Math.max(o.z, ez) < this.minz || Math.min(o.z, ez) > this.maxz || Math.min(o.y, ey) > this.hmax) return null;
    let best = null;
    for (const tr of this.tris) {
      _ab.subVectors(tr.b, tr.a); _ac.subVectors(tr.c, tr.a);
      const px = d.y * _ac.z - d.z * _ac.y, py = d.z * _ac.x - d.x * _ac.z, pz = d.x * _ac.y - d.y * _ac.x, det = _ab.x * px + _ab.y * py + _ab.z * pz; if (Math.abs(det) < 1e-9) continue;
      const inv = 1 / det, tx = o.x - tr.a.x, ty = o.y - tr.a.y, tz = o.z - tr.a.z, u = (tx * px + ty * py + tz * pz) * inv; if (u < 0 || u > 1) continue;
      const qx = ty * _ab.z - tz * _ab.y, qy = tz * _ab.x - tx * _ab.z, qz = tx * _ab.y - ty * _ab.x, v = (d.x * qx + d.y * qy + d.z * qz) * inv; if (v < 0 || u + v > 1) continue;
      const t = (_ac.x * qx + _ac.y * qy + _ac.z * qz) * inv; if (t >= 0 && t <= maxT && (!best || t < best.t)) best = { t, normal: det < 0 ? tr.n.clone() : tr.n.clone().negate() };
    }
    if (best && best.normal.dot(d) > 0) best.normal.negate(); return best;
  }
  // ----------------------------------------------------------------------------------------------- mesh
  buildMesh(scene, material) {
    const pos = [], nor = [], uv = [], e = 0.25;
    for (const t of this.tris) for (const p of [t.a, t.b, t.c]) {
      pos.push(p.x, p.y, p.z);
      if (t.top) { const n = this.normalAt(p.x, p.z); nor.push(n.x, n.y, n.z); uv.push(p.x * e, p.z * e); } else { nor.push(t.n.x, t.n.y, t.n.z); uv.push((p.x + p.z) * e, p.y * e); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    this.mesh = new THREE.Mesh(g, material); this.mesh.castShadow = true; this.mesh.receiveShadow = true; this.mesh.name = this.name; scene.add(this.mesh);
  }
}

export const wedge = (H, hv) => (u, v) => H * (v + hv) / (2 * hv);
export const mound = (H, R) => (u, v) => { const d = Math.hypot(u, v); return d >= R ? 0 : H * 0.5 * (1 + Math.cos(Math.PI * d / R)); };
