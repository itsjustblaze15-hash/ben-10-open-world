// Instanced scenery batches: Decor (merged vertex-colour models, one InstancedMesh per model per 256 m chunk, hidden past a draw distance) and Buildings
// (one InstancedMesh of boxes with the procedural facade shader + an outline hull, every building also registered as a static collider).
import * as THREE from 'three';
import { model } from './models.js';
import { buildingMaterial, outlineFor, unitBox } from './style.js';
import { RAMP } from './terrain.js';
import { addRim } from './style.js';

const CHUNK = 384;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler(), _col = new THREE.Color();
let VC = null; export function vcMaterial() { if (!VC) { VC = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: RAMP }); addRim(VC, 0.2); } return VC; }

export class Decor {
  constructor(world) { this.world = world; this.items = new Map(); this.meshes = []; this.group = new THREE.Group(); this.group.name = 'Decor'; world.scene.add(this.group); this.count = 0; }
  /** o: { scale, sy, collider: [w, h, d] | true (auto), small, dist, shadow, tint } */
  add(name, x, y, z, yaw = 0, o = {}) {
    const ck = name + '|' + Math.floor(x / CHUNK) + ',' + Math.floor(z / CHUNK); let L = this.items.get(ck); if (!L) this.items.set(ck, L = { name, list: [], dist: o.dist ?? 1100, shadow: o.shadow ?? true });
    const sc = o.scale ?? 1; L.list.push({ x, y, z, yaw, sx: sc * (o.sx ?? 1), sy: sc * (o.sy ?? 1), sz: sc * (o.sz ?? 1), tint: o.tint }); this.count++;
    if (o.collider) { const g = model(name).boundingBox; let w, h, d; if (Array.isArray(o.collider)) [w, h, d] = o.collider; else { w = (g.max.x - g.min.x) * sc * 0.5; d = (g.max.z - g.min.z) * sc * 0.5; h = (g.max.y - g.min.y) * sc * (o.sy ?? 1); }
      const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw)), hw = (c * w + s * d) / 2, hd = (s * w + c * d) / 2;
      this.world.addStatic(new THREE.Vector3(x - hw, y + (o.y0 ?? 0), z - hd), new THREE.Vector3(x + hw, y + h, z + hd), { kind: o.kind || name, small: o.small ?? true }); }
  }
  build() {
    const mat = vcMaterial();
    for (const L of this.items.values()) {
      const geo = model(L.name), im = new THREE.InstancedMesh(geo, mat, L.list.length); let cx = 0, cz = 0, r = 0;
      const anyTint = L.list.some(it => it.tint !== undefined); if (anyTint) L.list.forEach((it, i) => im.setColorAt(i, _col.set(it.tint ?? 0xffffff)));
      L.list.forEach((it, i) => { _p.set(it.x, it.y, it.z); _q.setFromEuler(_e.set(0, it.yaw, 0)); _s.set(it.sx, it.sy, it.sz); im.setMatrixAt(i, _m.compose(_p, _q, _s)); cx += it.x; cz += it.z; });
      cx /= L.list.length; cz /= L.list.length; for (const it of L.list) r = Math.max(r, Math.hypot(it.x - cx, it.z - cz));
      im.computeBoundingSphere(); im.castShadow = L.shadow; im.receiveShadow = false; im.userData = { cx, cz, r, dist: L.dist }; this.group.add(im); this.meshes.push(im);
    }
  }
  update(cam) { for (const m of this.meshes) { const u = m.userData; m.visible = Math.hypot(cam.x - u.cx, cam.z - u.cz) - u.r < u.dist; } }
}

export class Buildings {
  constructor(world) { this.world = world; this.list = []; }
  /** axis-aligned building block. yaw only turns the facade pattern (multiples of PI/2); w/d are world X/Z extents. o: { style, color, fh, ws, collide } */
  add(x, y0, z, w, h, d, o = {}) {
    const b = { x, y0, z, w, h, d, yaw: o.yaw || 0, style: o.style ?? 1, color: o.color ?? 0xd8d0c0, fh: o.fh ?? 3.4, ws: o.ws ?? 3.0, seed: o.seed ?? Math.floor(Math.random() * 50), name: o.name };
    this.list.push(b);
    if (o.collide !== false) b.col = this.world.addStatic(new THREE.Vector3(x - w / 2, y0, z - d / 2), new THREE.Vector3(x + w / 2, y0 + h, z + d / 2), { kind: o.kind || 'building', name: o.name, bld: b });
    return b;
  }
  build() {
    const geo = unitBox(), mat = buildingMaterial(), n = this.list.length; const im = new THREE.InstancedMesh(geo, mat, n);
    const st = new Float32Array(n * 4);
    this.list.forEach((b, i) => { const rot = Math.abs(Math.sin(b.yaw)) > 0.5; _p.set(b.x, b.y0, b.z); _q.setFromEuler(_e.set(0, b.yaw, 0)); _s.set(rot ? b.d : b.w, b.h, rot ? b.w : b.d); im.setMatrixAt(i, _m.compose(_p, _q, _s)); im.setColorAt(i, _col.set(b.color)); st.set([b.style, b.fh, b.ws, b.seed], i * 4); });
    geo.setAttribute('aStyle', new THREE.InstancedBufferAttribute(st, 4));
    im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere(); im.frustumCulled = false;
    this.mesh = im; this.world.scene.add(im); this.outline = outlineFor(im); this.outline.frustumCulled = false; this.world.scene.add(this.outline);
    return im;
  }
}
