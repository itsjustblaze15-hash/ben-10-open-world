// Physical props for Four Arms: reusable grabbable objects (small/medium/heavy props, vehicles, long poles), breakable walls, impact damage, debris.
// Props register an axis-aligned box in world.boxes while resting (so every alien collides with them and the camera sees them), and leave it while held/flying.
// Physics = lightweight AABB sweep per axis + gravity + friction + momentum transfer (no external physics library).
import * as THREE from 'three';
import { clamp, rand } from './util.js';
import { DebrisSystem, CrackField } from './fa_fx.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RAMP } from './island/terrain.js';

const G = 26;
const MERGE = new Set(['car', 'dumpster', 'trash', 'bench', 'light', 'bush', 'fence', 'barrel', 'tree', 'truck', 'container', 'crate', 'forklift', 'rock', 'pebble']);
const MERGED = new Map(); let PMAT = null;
function propMaterial() { if (!PMAT) PMAT = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: RAMP }); return PMAT; }
const _v = new THREE.Vector3(), _d = new THREE.Vector3();
const M = (c, r = 0.85, m = 0.1, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, ...extra });
const box = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; return m; };
const cyl = (rt, rb, h, mat, x, y, z, seg = 14) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; return m; };

export const CATS = {
  small:   { label: 'SMALL PROP',  lift: 0.35, carry: 0.92, throwV: 30, arms: 2 },
  medium:  { label: 'MEDIUM PROP', lift: 0.6,  carry: 0.78, throwV: 26, arms: 2 },
  heavy:   { label: 'HEAVY PROP',  lift: 0.95, carry: 0.58, throwV: 21, arms: 4 },
  vehicle: { label: 'VEHICLE',     lift: 1.35, carry: 0.42, throwV: 17, arms: 4 },
  long:    { label: 'POLE',        lift: 0.7,  carry: 0.7,  throwV: 28, arms: 2 },
};

const BUILD = {
  car(inner, o) {
    const body = M(o.color ?? 0xc0392b, 0.45, 0.35), dark = M(0x1d2630, 0.3, 0.2), glass = M(0x7ec8e8, 0.15, 0.4, { transparent: true, opacity: 0.85 }), tyre = M(0x151515, 0.9, 0), chrome = M(0xcfd4d8, 0.25, 0.8);
    inner.add(box(1.9, 0.62, 4.3, body, 0, 0.62, 0), box(1.74, 0.58, 2.25, body, 0, 1.2, -0.25), box(1.78, 0.4, 2.1, glass, 0, 1.22, -0.25), box(1.92, 0.2, 4.34, dark, 0, 0.36, 0));
    inner.add(box(1.7, 0.08, 2.2, body, 0, 1.52, -0.25), box(0.5, 0.18, 0.06, M(0xffe9a0, 0.3, 0, { emissive: 0xffd060, emissiveIntensity: 0.6 }), 0.6, 0.72, 2.16), box(0.5, 0.18, 0.06, M(0xffe9a0, 0.3, 0, { emissive: 0xffd060, emissiveIntensity: 0.6 }), -0.6, 0.72, 2.16),
      box(0.5, 0.16, 0.06, M(0xff3030, 0.4, 0, { emissive: 0xaa1010, emissiveIntensity: 0.6 }), 0.6, 0.76, -2.16), box(0.5, 0.16, 0.06, M(0xff3030, 0.4, 0, { emissive: 0xaa1010, emissiveIntensity: 0.6 }), -0.6, 0.76, -2.16), box(1.6, 0.1, 0.1, chrome, 0, 0.42, 2.18));
    for (const [x, z] of [[0.95, 1.4], [-0.95, 1.4], [0.95, -1.4], [-0.95, -1.4]]) { const w = cyl(0.4, 0.4, 0.3, tyre, x, 0.4, z, 16); w.rotation.z = Math.PI / 2; inner.add(w); const hub = cyl(0.2, 0.2, 0.32, chrome, x, 0.4, z, 10); hub.rotation.z = Math.PI / 2; inner.add(hub); }
  },
  dumpster(inner) {
    const g = M(0x2e7d4f, 0.7, 0.3), d = M(0x1c3d2b, 0.8, 0.3), rust = M(0x8a5a35, 0.9, 0.2);
    inner.add(box(1.3, 1.1, 2.4, g, 0, 0.75, 0), box(1.36, 0.14, 2.46, d, 0, 1.38, 0), box(1.4, 0.1, 2.5, d, 0, 0.18, 0), box(0.05, 0.6, 2.0, rust, 0.66, 0.8, 0), box(0.05, 0.6, 2.0, rust, -0.66, 0.8, 0));
    for (const [x, z] of [[0.5, 1], [-0.5, 1], [0.5, -1], [-0.5, -1]]) inner.add(cyl(0.12, 0.12, 0.14, M(0x111111), x, 0.08, z, 8));
  },
  trash(inner) { const m = M(0x6e7479, 0.5, 0.5); inner.add(cyl(0.38, 0.32, 0.9, m, 0, 0.45, 0, 14), cyl(0.41, 0.41, 0.1, M(0x4a4f54, 0.5, 0.5), 0, 0.95, 0, 14), box(0.12, 0.08, 0.12, M(0x222222), 0, 1.04, 0)); for (let i = 0; i < 3; i++) inner.add(cyl(0.39, 0.39, 0.03, M(0x4a4f54), 0, 0.2 + i * 0.28, 0, 14)); },
  bench(inner) {
    const wood = M(0x9a6b3c, 0.85, 0), iron = M(0x2b2f33, 0.5, 0.6);
    inner.add(box(0.5, 0.08, 2.0, wood, 0, 0.5, 0), box(0.08, 0.5, 2.0, wood, -0.22, 0.85, 0), box(0.08, 0.5, 2.0, wood, -0.22, 0.85, 0));
    for (const z of [-0.85, 0.85]) inner.add(box(0.6, 0.06, 0.08, iron, 0, 0.46, z), box(0.08, 0.5, 0.08, iron, 0.2, 0.25, z), box(0.08, 0.5, 0.08, iron, -0.2, 0.25, z), box(0.08, 0.5, 0.08, iron, -0.25, 0.7, z));
  },
  light(inner) { const m = M(0x4c545c, 0.5, 0.6); inner.add(cyl(0.3, 0.4, 0.25, m, 0, 0.12, 0, 10), cyl(0.07, 0.11, 4.2, m, 0, 2.3, 0, 8), box(0.1, 0.1, 0.9, m, 0, 4.4, 0.35), box(0.3, 0.12, 0.5, M(0xfff1b0, 0.3, 0, { emissive: 0xffe080, emissiveIntensity: 0.9 }), 0, 4.34, 0.75)); },
  bush(inner, o) {
    const g1 = M(0x2f7d3a, 0.95, 0, { flatShading: true }), g2 = M(0x3b9446, 0.95, 0, { flatShading: true }), br = M(0x5a3d22, 0.9);
    inner.add(cyl(0.08, 0.1, 0.4, br, 0, 0.2, 0, 6));
    for (const [x, y, z, r, m] of [[0, 0.7, 0, 0.62, g1], [0.5, 0.55, 0.2, 0.46, g2], [-0.45, 0.52, -0.1, 0.5, g2], [0.1, 0.55, -0.5, 0.42, g1], [-0.1, 1.0, 0.1, 0.4, g2]]) { const q = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), m); q.position.set(x, y, z); q.scale.y = 0.85; q.castShadow = q.receiveShadow = true; inner.add(q); }
  },
  fence(inner) {
    const wood = M(0x9a6b3c, 0.9), dark = M(0x7a5230, 0.9);
    for (const x of [-1.4, 0, 1.4]) inner.add(box(0.14, 1.3, 0.16, dark, x, 0.65, 0));
    for (const y of [0.45, 0.95]) inner.add(box(3.0, 0.14, 0.07, wood, 0, y, 0.09));
    for (let i = 0; i < 7; i++) inner.add(box(0.1, 1.05, 0.04, wood, -1.2 + i * 0.4, 0.55, -0.07));
  },
  barrel(inner) {
    const red = M(0xc0322a, 0.5, 0.5), band = M(0x7a1d18, 0.5, 0.6), top = M(0x2b2b2b, 0.6, 0.4);
    inner.add(cyl(0.42, 0.42, 1.2, red, 0, 0.6, 0, 16), cyl(0.44, 0.44, 0.07, band, 0, 0.25, 0, 16), cyl(0.44, 0.44, 0.07, band, 0, 0.95, 0, 16), cyl(0.36, 0.36, 0.05, top, 0, 1.22, 0, 12), box(0.22, 0.2, 0.02, M(0xffd23a, 0.6), 0, 0.62, 0.42));
  },
  tree(inner) {
    const bark = M(0x5a3d22, 0.95), leaf = M(0x2f7d3a, 0.95, 0, { flatShading: true }), leaf2 = M(0x3b9446, 0.95, 0, { flatShading: true });
    inner.add(cyl(0.28, 0.4, 3.2, bark, 0, 1.6, 0, 8));
    for (const [x, y, z, r, m] of [[0, 4.1, 0, 1.55, leaf], [0.8, 3.6, 0.3, 1.0, leaf2], [-0.8, 3.7, -0.3, 1.1, leaf2], [0.1, 5.1, 0.1, 0.95, leaf]]) { const q = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), m); q.position.set(x, y, z); q.castShadow = q.receiveShadow = true; inner.add(q); }
  },
  truck(inner, o) {
    const body = M(o.color ?? 0xd9d6cf, 0.55, 0.25), cab = M(0x2b6cb0, 0.45, 0.35), dark = M(0x1d2630, 0.3, 0.2), glass = M(0x7ec8e8, 0.15, 0.4, { transparent: true, opacity: 0.85 }), tyre = M(0x151515, 0.9, 0), chrome = M(0xcfd4d8, 0.25, 0.8);
    inner.add(box(2.3, 2.1, 4.2, body, 0, 1.75, -1.15), box(2.2, 1.3, 1.8, cab, 0, 1.3, 2.1), box(2.2, 0.9, 0.2, glass, 0, 1.55, 3.05), box(2.3, 0.35, 6.4, dark, 0, 0.45, 0.2), box(2.0, 0.12, 0.1, chrome, 0, 0.62, 3.25));
    for (const [x, z] of [[1.05, 2.2], [-1.05, 2.2], [1.05, -2.2], [-1.05, -2.2], [1.05, -0.9], [-1.05, -0.9]]) { const w = cyl(0.5, 0.5, 0.35, tyre, x, 0.5, z, 16); w.rotation.z = Math.PI / 2; inner.add(w); }
  },
  robot(inner, o) {
    const body = M(o.color ?? 0xe0a31c, 0.5, 0.45), dark = M(0x2d3238, 0.45, 0.6), joint = M(0x555b63, 0.5, 0.6), visor = M(0x300808, 0.4, 0.2, { emissive: 0xff3a22, emissiveIntensity: 1.2 });
    const parts = {}; const pivot = (x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); inner.add(g); return g; };
    parts.legL = pivot(0.38, 1.05, 0); parts.legR = pivot(-0.38, 1.05, 0);
    for (const L of [parts.legL, parts.legR]) { L.add(box(0.42, 0.95, 0.5, body, 0, -0.5, 0), box(0.5, 0.18, 0.8, dark, 0, -1.0, 0.12)); }
    inner.add(box(1.3, 0.3, 0.8, dark, 0, 1.15, 0), box(1.5, 1.0, 0.95, body, 0, 1.8, 0), box(0.9, 0.5, 0.05, dark, 0, 1.85, 0.5), box(0.3, 0.2, 0.06, M(0x13351c, 0.4, 0.2, { emissive: 0xffd23a, emissiveIntensity: 0.5 }), 0, 1.85, 0.54));
    parts.head = pivot(0, 2.5, 0); parts.head.add(box(0.7, 0.55, 0.65, body, 0, 0.1, 0), box(0.58, 0.16, 0.06, visor, 0, 0.12, 0.34), box(0.08, 0.3, 0.08, dark, 0.2, 0.52, 0));
    parts.armL = pivot(0.95, 2.1, 0); parts.armR = pivot(-0.95, 2.1, 0);
    for (const A of [parts.armL, parts.armR]) { A.add(box(0.36, 0.5, 0.4, joint, 0, 0, 0), box(0.32, 0.7, 0.34, body, 0, -0.5, 0.1), cyl(0.15, 0.17, 0.75, dark, 0, -0.9, 0.45, 10)); A.children[2].rotation.x = Math.PI / 2; }
    parts.muzzleL = pivot(0.95, 1.2, 0.95); parts.muzzleR = pivot(-0.95, 1.2, 0.95); parts.armL.add(parts.muzzleL); parts.armR.add(parts.muzzleR); parts.muzzleL.position.set(0, -0.9, 0.9); parts.muzzleR.position.set(0, -0.9, 0.9);
    inner.userData.parts = parts;
  },
  computer(inner, o) {
    const shell = M(0x4a5058, 0.45, 0.5), dark = M(0x1a1d22, 0.5, 0.4), accent = M(0x2a8aff, 0.4, 0.3, { emissive: 0x2a8aff, emissiveIntensity: 0.5 });
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 176; const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.76), new THREE.MeshBasicMaterial({ map: tex })); scr.position.set(0, 1.25, 0.2); scr.rotation.x = -0.25; scr.userData.noOverlay = true;
    inner.add(box(1.3, 0.8, 0.7, shell, 0, 0.4, 0), box(1.2, 0.1, 0.6, dark, 0, 0.85, 0), box(1.25, 0.9, 0.2, shell, 0, 1.25, -0.12).rotateX(-0.25), box(1.0, 0.06, 0.2, accent, 0, 0.62, 0.36), scr);
    for (let i = 0; i < 3; i++) inner.add(box(0.2, 0.04, 0.02, i === 1 ? accent : dark, -0.4 + i * 0.4, 0.3, 0.36));
    inner.userData.screen = { canvas: cv, tex, mesh: scr };
  },
  rock(inner, o) { const r = o.r ?? 0.7; const g = new THREE.IcosahedronGeometry(r, 1), a = g.attributes.position; for (let i = 0; i < a.count; i++) { _v.fromBufferAttribute(a, i); const k = 0.82 + 0.3 * Math.abs(Math.sin(_v.x * 7.3 + _v.y * 3.1 + _v.z * 5.7)); a.setXYZ(i, _v.x * k, _v.y * k * 0.85, _v.z * k); } g.computeVertexNormals(); const m = new THREE.Mesh(g, M(0x7d7a74, 0.95, 0, { flatShading: true })); m.position.y = r * 0.8; m.castShadow = m.receiveShadow = true; inner.add(m); },
  container(inner, o) {
    const c = M(o.color ?? 0xd8452a, 0.7, 0.3), d = M(0x2a2e33, 0.7, 0.4);
    inner.add(box(2.5, 2.6, 6.1, c, 0, 1.3, 0)); for (let i = -5; i <= 5; i++) inner.add(box(2.54, 2.3, 0.08, d, 0, 1.3, i * 0.5)); inner.add(box(2.4, 2.4, 0.08, M(0x3a3f46, 0.6, 0.4), 0, 1.3, 3.06), box(0.08, 2.3, 0.08, M(0xd0d4d8), 0.4, 1.3, 3.11), box(0.08, 2.3, 0.08, M(0xd0d4d8), -0.4, 1.3, 3.11));
  },
  crate(inner) { const w = M(0xb4884a, 0.8, 0.05), d = M(0x7a5a30, 0.85); inner.add(box(1.2, 1.2, 1.2, w, 0, 0.6, 0)); for (const s of [-1, 1]) { inner.add(box(1.24, 0.14, 0.14, d, 0, 0.6 + s * 0.53, 0.56), box(1.24, 0.14, 0.14, d, 0, 0.6 + s * 0.53, -0.56), box(0.14, 1.24, 0.14, d, s * 0.53, 0.6, 0.56), box(0.14, 1.24, 0.14, d, s * 0.53, 0.6, -0.56)); } },
  forklift(inner, o) {
    const y = M(o.color ?? 0xf0b81c, 0.5, 0.3), dark = M(0x2a2e33, 0.6, 0.4), tyre = M(0x151515, 0.9);
    inner.add(box(1.3, 1.0, 2.2, y, 0, 0.75, -0.2), box(1.3, 0.1, 1.2, dark, 0, 2.2, -0.3), box(0.1, 1.3, 0.1, dark, 0.6, 1.6, 0.25), box(0.1, 1.3, 0.1, dark, -0.6, 1.6, 0.25), box(0.1, 1.3, 0.1, dark, 0.6, 1.6, -0.9), box(0.1, 1.3, 0.1, dark, -0.6, 1.6, -0.9));
    inner.add(box(0.12, 2.4, 0.12, dark, 0.4, 1.3, 1.0), box(0.12, 2.4, 0.12, dark, -0.4, 1.3, 1.0), box(0.15, 0.06, 1.1, dark, 0.3, 0.3, 1.55), box(0.15, 0.06, 1.1, dark, -0.3, 0.3, 1.55), box(1.2, 0.5, 0.5, dark, 0, 0.6, -1.3));
    for (const [x, z] of [[0.62, 0.6], [-0.62, 0.6], [0.62, -0.9], [-0.62, -0.9]]) { const w = cyl(0.3, 0.3, 0.24, tyre, x, 0.3, z, 12); w.rotation.z = Math.PI / 2; inner.add(w); }
  },
  chunk(inner, o) { inner.add(box(o.w, o.h, o.d, M(o.color ?? 0xb9b6ae, 0.95, 0, { flatShading: true }), 0, o.h / 2, 0)); },
};

export class Prop {
  constructor(sys, def) {
    this.sys = sys; this.clear = def.clear || 0; this.name = def.name; this.cat = def.cat; this.mass = def.mass; this.size = { ...def.size }; this.hpMax = this.hp = def.hp ?? 100;
    this.pos = new THREE.Vector3(def.x, def.y ?? 0, def.z); this.vel = new THREE.Vector3(); this.yaw = def.yaw ?? 0; this.tumble = new THREE.Vector3(); this.spin = new THREE.Vector3();
    this.home = { pos: this.pos.clone(), yaw: this.yaw }; this.state = 'rest'; this.held = false; this.dead = false; this.planted = !!def.planted; this.debris = def.debris ?? 0xa8a49c;
    this.temp = !!def.temp; this.life = def.life ?? 0; this.hit = new Set(); this.wrecked = false; this.fric = def.fric ?? (def.cat === 'heavy' || def.cat === 'vehicle' ? 5 : 3);
    this.root = new THREE.Group(); this.inner = new THREE.Group(); this.inner.position.y = -this.size.h / 2; this.root.add(this.inner); sys.scene.add(this.root);
    this.boxEntry = null; this.tint = 1;
  }
  get half() { const c = Math.abs(Math.cos(this.yaw)), s = Math.abs(Math.sin(this.yaw)); return { x: c * this.size.w / 2 + s * this.size.d / 2, z: s * this.size.w / 2 + c * this.size.d / 2 }; }
  get center() { return new THREE.Vector3(this.pos.x, this.pos.y + this.size.h / 2, this.pos.z); }
  get speed() { return this.vel.length(); }
}

export class PropSystem {
  constructor(game) {
    this.g = game; this.scene = game.scene; this.world = game.world; this.props = []; this.walls = []; this.t = 0; this.limit = 34.5;
    this.debris = new DebrisSystem(this.scene, this.world); this.cracks = new CrackField(this.scene);
    this.stats = { impacts: 0, broken: 0, wallsBroken: 0, rips: 0 };
  }
  // -------------------------------------------------------------------------------------------------- creation
  add(kind, x, z, o = {}) {
    const T = {
      car:      { clear: 0.28, cat: 'vehicle', mass: 1400, size: { w: 1.9, h: 1.55, d: 4.3 }, hp: 520, debris: 0x9a2b2b },
      dumpster: { cat: 'heavy', mass: 650, size: { w: 1.3, h: 1.5, d: 2.4 }, hp: 320, debris: 0x2e7d4f },
      trash:    { cat: 'small', mass: 14, size: { w: 0.85, h: 1.05, d: 0.85 }, hp: 45, debris: 0x6e7479 },
      bench:    { clear: 0.22, cat: 'medium', mass: 70, size: { w: 0.7, h: 1.1, d: 2.0 }, hp: 90, debris: 0x9a6b3c },
      light:    { cat: 'long', mass: 160, size: { w: 0.7, h: 4.6, d: 0.7 }, hp: 140, debris: 0x4c545c, planted: true },
      rock:     { cat: 'heavy', mass: 420, size: { w: 1.5, h: 1.2, d: 1.5 }, hp: 400, debris: 0x7d7a74 },
      pebble:   { cat: 'small', mass: 30, size: { w: 0.7, h: 0.55, d: 0.7 }, hp: 140, debris: 0x7d7a74 },
      bush:     { cat: 'small', mass: 22, size: { w: 1.6, h: 1.4, d: 1.6 }, hp: 40, debris: 0x2f7d3a, planted: true },
      fence:    { cat: 'medium', mass: 90, size: { w: 3.0, h: 1.3, d: 0.3 }, hp: 90, debris: 0x9a6b3c, planted: true },
      barrel:   { cat: 'small', mass: 60, size: { w: 0.9, h: 1.3, d: 0.9 }, hp: 50, debris: 0xc0322a },
      tree:     { cat: 'heavy', mass: 900, size: { w: 1.1, h: 6.2, d: 1.1 }, hp: 260, debris: 0x4a6b2a, planted: true },
      truck:    { clear: 0.4, cat: 'vehicle', mass: 3200, size: { w: 2.4, h: 2.9, d: 6.5 }, hp: 820, debris: 0x6a6f75 },
      robot:    { cat: 'heavy', mass: 520, size: { w: 1.8, h: 3.0, d: 1.2 }, hp: 260, debris: 0xe0a31c },
      computer: { cat: 'medium', mass: 110, size: { w: 1.4, h: 1.8, d: 0.8 }, hp: 140, debris: 0x4a5058 },
      container: { cat: 'heavy', mass: 2600, size: { w: 2.5, h: 2.6, d: 6.1 }, hp: 900, debris: 0xd8452a },
      crate:    { cat: 'small', mass: 45, size: { w: 1.2, h: 1.2, d: 1.2 }, hp: 60, debris: 0xb4884a },
      forklift: { clear: 0.2, cat: 'vehicle', mass: 2500, size: { w: 1.4, h: 2.3, d: 3.2 }, hp: 420, debris: 0xf0b81c },
      chunk:    { cat: 'small', mass: 35, size: { w: o.w ?? 0.8, h: o.h ?? 0.6, d: o.d ?? 0.7 }, hp: 60, debris: 0xb9b6ae },
    }[kind];
    const p = new Prop(this, { ...T, name: kind, clear: T.clear || 0, x, z, y: o.y ?? 0, yaw: o.yaw ?? 0, temp: o.temp, life: o.life, planted: o.planted ?? T.planted });
    if (kind === 'rock') { const r = o.r ?? 0.75; p.size = { w: r * 2, h: r * 1.6, d: r * 2 }; p.mass = 560 * (r / 0.75) ** 3; p.inner.position.y = -p.size.h / 2; BUILD.rock(p.inner, { r }); }
    else if (kind === 'pebble') { const r = o.r ?? 0.35; p.size = { w: r * 2, h: r * 1.6, d: r * 2 }; p.mass = 30 * (r / 0.35) ** 3; p.inner.position.y = -p.size.h / 2; BUILD.rock(p.inner, { r }); }
    else if (kind === 'chunk') BUILD.chunk(p.inner, { w: p.size.w, h: p.size.h, d: p.size.d, color: o.color });
    else BUILD[kind](p.inner, o);
    if (MERGE.has(kind) && !o.noMerge) this.mergeInner(p, kind + '|' + (o.color ?? '') + '|' + (kind === 'rock' || kind === 'pebble' ? (o.r ?? 0).toFixed(1) : ''));
    p.kind = kind; p.parts = p.inner.userData.parts || null; p.screen = p.inner.userData.screen || null; p.size0 = { ...p.size }; p.in0 = p.inner.position.clone(); p.mass0 = p.mass; this.props.push(p); this.syncRoot(p); this.addBox(p); return p;
  }
  /** V28: replace a prop's many small meshes by ONE merged vertex-colour toon mesh (cached per kind + colour): one draw call per prop, same look in the cartoon style */
  mergeInner(p, key) {
    let geo = MERGED.get(key);
    if (!geo) {
      const parts = []; p.inner.updateMatrix(); const base = new THREE.Matrix4().copy(p.inner.matrix).invert(); p.inner.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(p.inner.matrixWorld).invert();
      p.inner.traverse(o => { if (!o.isMesh || !o.geometry || !o.material || Array.isArray(o.material)) return; let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone(); g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
        for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
        const c = o.material.color || new THREE.Color(1, 1, 1), e = o.material.emissive && o.material.emissiveIntensity ? o.material.emissive.clone().multiplyScalar(o.material.emissiveIntensity * 0.6) : null, n = g.attributes.position.count, col = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { col[i * 3] = Math.min(1, c.r + (e ? e.r : 0)); col[i * 3 + 1] = Math.min(1, c.g + (e ? e.g : 0)); col[i * 3 + 2] = Math.min(1, c.b + (e ? e.b : 0)); }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3)); parts.push(g); });
      geo = parts.length ? mergeGeometries(parts, false) : null; if (geo) { geo.computeBoundingSphere(); geo.computeBoundingBox(); } MERGED.set(key, geo);
    }
    if (!geo) return; for (let i = p.inner.children.length - 1; i >= 0; i--) p.inner.remove(p.inner.children[i]);
    const m = new THREE.Mesh(geo, propMaterial()); m.castShadow = true; m.receiveShadow = true; p.inner.add(m);
  }
  templateGeo(kind, color) { const key = kind + '|' + (color ?? '') + '|'; if (!MERGED.has(key)) { const p = this.add(kind, 0, -9000, { color }); this.remove(p); } return MERGED.get(key); }
  carMaterial() { return propMaterial(); }
  // -------------------------------------------------------------------------------------------------- V28 streaming: island props exist only near the player / active bosses
  setSpawns(list) { this.spawns = list.map((s, i) => ({ ...s, i, prop: null })); this.spawnGrid = new Map(); for (const s of this.spawns) { const k = Math.floor(s.x / 64) * 4096 + Math.floor(s.z / 64); let a = this.spawnGrid.get(k); if (!a) this.spawnGrid.set(k, a = []); a.push(s); } this.streamT = 0; this.stats.created = 0; }
  stream(dt, centers, rOn = 135, rOff = 185) {
    if (!this.spawns) return; this.streamT -= dt; if (this.streamT > 0) return; this.streamT = 0.4; const now = this.t;
    const near = (x, z, r) => centers.some(c => Math.abs(x - c.x) < r && Math.abs(z - c.z) < r && Math.hypot(x - c.x, z - c.z) < r);
    let made = 0;
    for (const c of centers) { const i0 = Math.floor((c.x - rOn) / 64), i1 = Math.floor((c.x + rOn) / 64), j0 = Math.floor((c.z - rOn) / 64), j1 = Math.floor((c.z + rOn) / 64);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const a = this.spawnGrid.get(i * 4096 + j); if (!a) continue;
        for (const s of a) { const p = s.prop; if (p && !p.dormant) continue; if (Math.hypot(s.x - c.x, s.z - c.z) > rOn) continue;
          if (!p) { if (made > 40) continue; made++; s.prop = this.spawnProp(s); this.stats.created++; continue; }
          this.wake(p, now); } } }
    for (let k = this.props.length - 1; k >= 0; k--) { const p = this.props[k]; if (!p.spawn || p.held || p.driven || p.burn) continue; if ((p.state !== 'rest' && !p.dead) || near(p.pos.x, p.pos.z, rOff) || near(p.home.pos.x, p.home.pos.z, rOff)) continue; this.sleep(p, k); }
  }
  spawnProp(s) {
    const o = { yaw: s.yaw ?? 0, color: s.color, r: s.r, planted: s.planted }; if (s.y !== undefined) o.y = s.y; else o.y = this.world.terrain ? Math.max(this.world.terrain.height(s.x, s.z), 0) : 0;
    const p = this.add(s.kind, s.x, s.z, o); p.spawn = s; p.home.pos.y = p.pos.y; p.island = true;
    if (this.g.tech && (s.kind === 'car' || s.kind === 'truck' || s.kind === 'forklift')) this.g.tech.addProp(p, 'vehicle', s.kind === 'car' ? 'CAR' : s.kind === 'truck' ? 'TRUCK' : 'FORKLIFT');
    return p;
  }
  sleep(p, k) { p.dormant = true; this.removeBox(p); p.root.visible = false; this.props.splice(k, 1); p.sleptAt = this.t; }
  wake(p, now) {
    p.dormant = false; if (p.dead && now - (p.diedAt ?? now) > 60) { p.dead = false; p.hp = p.hpMax; p.wrecked = false; p.pos.copy(p.home.pos); p.yaw = p.home.yaw; p.vel.set(0, 0, 0); p.tumble.set(0, 0, 0); p.state = 'rest'; p.inner.traverse(o => { if (o.isMesh && o.userData.c0) o.material.color.copy(o.userData.c0); }); if (p.kind === 'light') p.planted = true; }
    if (!this.props.includes(p)) this.props.push(p); p.root.visible = !p.dead; if (!p.dead && p.state === 'rest' && !p.held) { this.addBox(p); this.syncBox(p); } this.syncRoot(p);
  }
  /** turn an existing static world box (crate / barrier) into a prop, reusing its mesh and material */
  wrap(entry, cat, mass, hp, name, debris) {
    const idx = this.world.boxes.indexOf(entry); if (idx >= 0) this.world.boxes.splice(idx, 1);
    const w = entry.max.x - entry.min.x, h = entry.max.y - entry.min.y, d = entry.max.z - entry.min.z;
    const p = new Prop(this, { name, cat, mass, size: { w, h, d }, hp, x: (entry.min.x + entry.max.x) / 2, y: entry.min.y, z: (entry.min.z + entry.max.z) / 2, debris });
    this.scene.remove(entry.mesh); entry.mesh.position.set(0, h / 2, 0); p.inner.add(entry.mesh); p.kind = name; p.size0 = { ...p.size }; p.in0 = p.inner.position.clone(); p.mass0 = p.mass; this.props.push(p); this.syncRoot(p); this.addBox(p); return p;
  }
  /** a static wall that Four Arms (and heavy impacts) can break */
  addWall(entry, hp = 320, name = 'WALL') {
    const w = { entry, hp, hpMax: hp, name, alive: true, mesh: entry.mesh, mat0: entry.mesh.material, stage: 0 }; entry.wall = w; this.walls.push(w); return w;
  }
  addBox(p) { if (p.boxEntry) return; const e = { min: new THREE.Vector3(), max: new THREE.Vector3(), mesh: p.root, prop: p }; p.boxEntry = e; this.syncBox(p); this.world.boxes.push(e); }
  removeBox(p) { if (!p.boxEntry) return; const i = this.world.boxes.indexOf(p.boxEntry); if (i >= 0) this.world.boxes.splice(i, 1); p.boxEntry = null; }
  syncBox(p) { const e = p.boxEntry; if (!e) return; const h = p.half; e.min.set(p.pos.x - h.x, p.pos.y + (p.clear || 0), p.pos.z - h.z); e.max.set(p.pos.x + h.x, p.pos.y + p.size.h, p.pos.z + h.z); }
  syncRoot(p) { p.root.position.set(p.pos.x, p.pos.y + p.size.h / 2, p.pos.z); p.root.rotation.set(p.tumble.x, p.yaw + p.tumble.y, p.tumble.z, 'YXZ'); }

  // -------------------------------------------------------------------------------------------------- queries
  /** best grabbable prop in front of `pos` (facing yaw) within reach */
  candidate(pos, yaw, reach = 3.2, filter = null) {
    const fx = Math.sin(yaw), fz = Math.cos(yaw); let best = null, bs = 1e9;
    for (const p of this.props) {
      if (p.held || p.dead || (p.state !== 'rest' && p.state !== 'slide') || (filter && !filter(p))) continue;
      const h = p.half, cx = clamp(pos.x, p.pos.x - h.x, p.pos.x + h.x), cz = clamp(pos.z, p.pos.z - h.z, p.pos.z + h.z), dx = cx - pos.x, dz = cz - pos.z, d = Math.hypot(dx, dz);
      if (d > reach) continue; if (p.pos.y > pos.y + 3.6 || p.pos.y + p.size.h < pos.y - 0.2) continue;
      const dot = d > 0.05 ? (dx * fx + dz * fz) / d : 1; if (dot < 0.25 && d > 0.9) continue;
      const sc = d - 1.4 * dot - p.size.h * 0.2; if (sc < bs) { bs = sc; best = p; }
    }
    return best;
  }
  nearestWall(pos, yaw, reach = 3.4) {
    const fx = Math.sin(yaw), fz = Math.cos(yaw); let best = null, bd = 1e9;
    for (const w of this.walls) {
      if (!w.alive) continue; const b = w.entry, cx = clamp(pos.x, b.min.x, b.max.x), cz = clamp(pos.z, b.min.z, b.max.z), dx = cx - pos.x, dz = cz - pos.z, d = Math.hypot(dx, dz);
      if (d > reach || (d > 0.8 && (dx * fx + dz * fz) / d < 0.3)) continue; if (d < bd) { bd = d; best = w; }
    }
    return best;
  }

  // -------------------------------------------------------------------------------------------------- state changes
  setHeld(p) { p.held = true; p.state = 'held'; this.removeBox(p); p.vel.set(0, 0, 0); p.hit.clear(); }
  /** let go: restores collisions + physics; optional launch velocity and spin (thrown) */
  release(p, vel = null, spin = null) {
    p.held = false; p.state = 'fly'; p.hit.clear(); p.age = 0; p.thrown = !!vel; if (vel) p.vel.copy(vel); else p.vel.set(0, 0, 0);
    if (spin) p.spin.copy(spin); else p.spin.set(0, 0, 0);
    p.planted = false;
  }
  fxScale(p) { return clamp(Math.cbrt(p.size.w * p.size.h * p.size.d) / 1.2, 0.5, 2.2); }
  near(pt) { const d = pt.distanceTo(this.g.player.pos); return clamp(1.15 - d / 40, 0, 1); }

  impactFX(pt, k, color, big = false) {
    const fx = this.g.fx, p = pt.clone(); if (this.world.danger) this.world.danger(pt.x, pt.z, 18 + 12 * k);
    fx.glow.emit({ pos: p, size: 1.5 * k, life: 0.14, drag: 0, color: [1, 0.92, 0.75], alpha: 1 });
    for (let i = 0; i < 6 * k; i++) fx.dust.emit({ pos: p, vel: _v.set(rand(-1, 1), rand(0.2, 1), rand(-1, 1)).normalize().multiplyScalar(rand(2, 6) * k), size: rand(0.5, 1.1) * k, grow: 1.4, life: rand(0.4, 0.8), drag: 2.2, color: [0.66, 0.64, 0.6], alpha: 0.5 });
    this.debris.burst(p, Math.round(5 + 6 * k), 5 + 3 * k, 0.12 * k, color);
    const n = this.near(pt); this.g.camera.addTrauma(0.1 * k * n * (big ? 2 : 1)); if (k > 0.8) this.g.sfx.crash(Math.min(0.8, 0.25 * k * n + 0.05));
  }
  /** apply impact damage to a prop; destroys it at 0 hp */
  hurt(p, dmg, dir = null) {
    if (p.dead || dmg <= 0) return; p.hp -= dmg;
    if (p.hp <= 0) { this.destroy(p, dir); return; }
    if (p.kind === 'car' && !p.wrecked && p.hp < p.hpMax * 0.5) { p.wrecked = true; p.inner.traverse(o => { if (o.isMesh && o.material.color) { o.userData.c0 = o.material.color.clone(); o.material = o.material.clone(); o.material.color.multiplyScalar(0.45); } }); this.impactFX(p.center, 1.6, 0x333333); }
  }
  destroy(p, dir = null) {
    if (p.dead) return; if (p.tech && p.tech.isMerged && this.g.up) { const u = this.g.up; this.g.tech.detach(u, true); u.hp = Math.max(40, u.hp - 30); } p.dead = true; p.diedAt = this.t; p.held = false; p.driven = false; this.removeBox(p); p.root.visible = false; this.stats.broken++;
    const c = p.center, k = this.fxScale(p), fx = this.g.fx; if (this.world.danger) this.world.danger(c.x, c.z, 30);
    this.debris.burst(c, Math.round(10 + 14 * k), 8 + 3 * k, 0.2 * k, p.debris, 0.8);
    fx.glow.emit({ pos: c, size: 4 * k, life: 0.25, drag: 0, color: p.kind === 'car' ? [1, 0.6, 0.2] : [1, 0.9, 0.7], alpha: 1 });
    for (let i = 0; i < 10 * k; i++) fx.dust.emit({ pos: c, vel: _v.set(rand(-1, 1), rand(0, 1), rand(-1, 1)).normalize().multiplyScalar(rand(3, 9) * k), size: rand(1, 2) * k, grow: 2, life: rand(0.6, 1.2), drag: 2, color: p.kind === 'car' ? [0.25, 0.25, 0.25] : [0.66, 0.64, 0.6], alpha: 0.55 });
    fx.surface.ring(new THREE.Vector3(c.x, p.pos.y + 0.08, c.z), new THREE.Vector3(0, 1, 0), 3.5 * k, 0.4, 0xd8d0c0);
    const n = this.near(c); this.g.camera.addTrauma(0.35 * k * n); this.g.sfx.crash(Math.min(1, 0.5 * k * n + 0.1));
    if (p.cat !== 'small' && p.kind !== 'chunk') for (let i = 0; i < (p.cat === 'vehicle' ? 4 : 2); i++) { const ch = this.add('chunk', c.x + rand(-0.5, 0.5), c.z + rand(-0.5, 0.5), { y: p.pos.y + 0.6, temp: true, life: 25, w: rand(0.5, 1.0), h: rand(0.4, 0.7), d: rand(0.5, 0.9), color: p.debris }); this.release(ch, new THREE.Vector3(rand(-4, 4), rand(4, 8), rand(-4, 4))); ch.spin.set(rand(-4, 4), rand(-4, 4), rand(-4, 4)); }
    if (p.kind === 'light') this.g.hud.toast('STREETLIGHT DOWN');
  }
  damageWall(w, dmg, pt = null, dir = null) {
    if (w.isBld) { if (this.g.destruct) this.g.destruct.damage(w, dmg, pt, dir); return; }       // V30: island buildings
    if (!w.alive || dmg <= 0) return; w.hp -= dmg; const b = w.entry, c = new THREE.Vector3((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2); const at = pt || c;
    const stage = w.hp <= 0 ? 3 : w.hp < w.hpMax * 0.35 ? 2 : w.hp < w.hpMax * 0.7 ? 1 : 0;
    this.debris.burst(at, 5, 5, 0.18, 0xbdb9b0); this.g.fx.dust.emit({ pos: at, vel: _v.set(rand(-1, 1), rand(0, 1), rand(-1, 1)), size: 1.4, grow: 1.8, life: 0.7, drag: 2, color: [0.7, 0.68, 0.64], alpha: 0.5 });
    if (stage > w.stage && stage < 3) { this.crackWall(w); w.stage = stage; w.mesh.material = w.mesh.material === w.mat0 ? w.mat0.clone() : w.mesh.material; w.mesh.material.color.setScalar(1 - 0.17 * stage); this.debris.burst(at, 14, 8, 0.28, 0xbdb9b0); this.g.camera.addTrauma(0.15 * this.near(at)); this.g.sfx.crash(0.35); this.g.hud.toast(w.name + (stage === 1 ? ' CRACKED' : ' CRUMBLING')); }
    if (w.hp <= 0) this.collapseWall(w, dir);
  }
  /** visible crack decal on the wall face that points toward the player */
  crackWall(w) {
    const b = w.entry, lx = b.max.x - b.min.x, lz = b.max.z - b.min.z, p = this.g.player.pos, alongX = lx >= lz, h = b.max.y - b.min.y;
    const n = alongX ? new THREE.Vector3(0, 0, p.z > (b.min.z + b.max.z) / 2 ? 1 : -1) : new THREE.Vector3(p.x > (b.min.x + b.max.x) / 2 ? 1 : -1, 0, 0);
    const along = alongX ? clamp(p.x, b.min.x + 1.2, b.max.x - 1.2) + rand(-1.5, 1.5) : clamp(p.z, b.min.z + 1.2, b.max.z - 1.2) + rand(-1.5, 1.5);
    const x = alongX ? clamp(along, b.min.x + 0.6, b.max.x - 0.6) : (n.x > 0 ? b.max.x : b.min.x), z = alongX ? (n.z > 0 ? b.max.z : b.min.z) : clamp(along, b.min.z + 0.6, b.max.z - 0.6);
    this.cracks.addWall(x, b.min.y + h * rand(0.45, 0.75), z, n, Math.min(h * 1.1, 3.4), 60);
  }
  collapseWall(w, dir = null) {
    w.alive = false; w.stage = 3; const b = w.entry, i = this.world.boxes.indexOf(b); if (i >= 0) this.world.boxes.splice(i, 1); w.mesh.visible = false; this.stats.wallsBroken++;
    const lx = b.max.x - b.min.x, lz = b.max.z - b.min.z, long = Math.max(lx, lz), h = b.max.y - b.min.y, n = clamp(Math.round(long / 1.4), 3, 8), alongX = lx >= lz;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n - 0.5, x = (b.min.x + b.max.x) / 2 + (alongX ? t * lx : rand(-0.2, 0.2)), z = (b.min.z + b.max.z) / 2 + (alongX ? rand(-0.2, 0.2) : t * lz);
      const ch = this.add('chunk', x, z, { y: rand(0.3, h * 0.8), temp: true, life: 30, w: rand(0.7, 1.3), h: rand(0.6, 1.0), d: rand(0.6, 1.0), color: 0xc9c6bd }); ch.yaw = rand(0, 6);
      this.release(ch, new THREE.Vector3(rand(-3, 3) + (dir ? dir.x * 3 : 0), rand(2, 6), rand(-3, 3) + (dir ? dir.z * 3 : 0))); ch.spin.set(rand(-3, 3), rand(-3, 3), rand(-3, 3));
    }
    const c = new THREE.Vector3((b.min.x + b.max.x) / 2, h * 0.5, (b.min.z + b.max.z) / 2);
    this.debris.burst(c, 40, 10, 0.3, 0xbdb9b0, 0.8);
    for (let k = 0; k < 18; k++) this.g.fx.dust.emit({ pos: c.clone().add(_d.set(rand(-lx / 2, lx / 2), rand(-1, 1), rand(-lz / 2, lz / 2))), vel: _v.set(rand(-1, 1), rand(0, 1), rand(-1, 1)).normalize().multiplyScalar(rand(2, 7)), size: rand(1.5, 3), grow: 2.2, life: rand(0.8, 1.5), drag: 2, color: [0.7, 0.68, 0.64], alpha: 0.55 });
    const nr = this.near(c); this.g.camera.addTrauma(0.55 * nr); this.g.sfx.crash(Math.min(1, 0.9 * nr + 0.1)); this.g.hud.toast(w.name + ' DESTROYED');
  }
  /** tear a rock-sized slab out of a wall (pull structure) -> returns the new chunk prop */
  ripChunk(w, from) {
    const b = w.entry, lx = b.max.x - b.min.x, lz = b.max.z - b.min.z, alongX = lx >= lz; this.damageWall(w, w.hpMax * 0.2, null, null); if (!w.alive) return null;
    const cx = clamp(from.x, b.min.x + 0.7, b.max.x - 0.7), cz = clamp(from.z, b.min.z + 0.7, b.max.z - 0.7), h = b.max.y - b.min.y;
    const ch = this.add('chunk', alongX ? cx : (b.min.x + b.max.x) / 2, alongX ? (b.min.z + b.max.z) / 2 : cz, { y: 0, w: alongX ? 1.7 : 0.9, h: Math.min(1.3, h * 0.4), d: alongX ? 0.9 : 1.7, temp: true, life: 60, color: 0xc9c6bd }); ch.mass = 220; ch.cat = 'heavy'; ch.hp = 260; this.stats.rips++;
    return ch;
  }

  // -------------------------------------------------------------------------------------------------- simulation
  hits(p, pos, skipAbove = true) {
    const h = p.half, res = [], y0 = pos.y, y1 = pos.y + p.size.h;
    for (const b of this.world.boxes) {
      if (b === p.boxEntry || b.max.y <= y0 + 0.1 || b.min.y >= y1 - 0.05) continue;
      if (pos.x + h.x > b.min.x && pos.x - h.x < b.max.x && pos.z + h.z > b.min.z && pos.z - h.z < b.max.z) res.push(b);
    }
    return res;
  }
  support(p) {
    const h = p.half, L = this.world.lagoon; let g = this.world.terrain ? Math.max(this.world.terrain.height(p.pos.x, p.pos.z), this.world.terrain.height(p.pos.x + h.x * 0.7, p.pos.z + h.z * 0.7) - 0.25, this.world.terrain.height(p.pos.x - h.x * 0.7, p.pos.z - h.z * 0.7) - 0.25) : L && p.pos.y < L.waterY + 0.15 ? L.bedAt(p.pos.x, p.pos.z) : 0;      // props that are below the lagoon's water line rest on its bed (everything else keeps the flat ground)
    for (const b of this.world.boxes) { if (b === p.boxEntry) continue; if (p.pos.x + h.x > b.min.x + 0.02 && p.pos.x - h.x < b.max.x - 0.02 && p.pos.z + h.z > b.min.z + 0.02 && p.pos.z - h.z < b.max.z - 0.02 && b.max.y <= p.pos.y + 0.3 && b.max.y > g) g = b.max.y; }
    return g;
  }
  bump(p, b, axis, spd) {
    // collision with a world box along `axis`: damage + momentum exchange
    const o = b.prop; const imp = Math.abs(spd);
    if (imp > 4.5) {
      const dmg = (imp - 4) * Math.sqrt(p.mass) * 0.5; this.stats.impacts++;
      const pt = p.center.clone(); pt[axis] += Math.sign(spd) * (axis === 'x' ? p.half.x : p.half.z);
      this.impactFX(pt, clamp(imp / 14, 0.4, 1.8) * this.fxScale(p), p.debris);
      if (b.wall) this.damageWall(b.wall, dmg * 0.9, pt, _v.set(axis === 'x' ? Math.sign(spd) : 0, 0, axis === 'z' ? Math.sign(spd) : 0).clone());
      if (o) { this.hurt(o, dmg * 0.7); o.vel[axis] += spd * p.mass / (p.mass + o.mass) * 1.15; if (o.state === 'rest') o.state = 'slide'; }
      this.hurt(p, dmg * (o || b.wall ? 0.35 : 0.2));
    }
    p.vel[axis] = o ? p.vel[axis] * (o.mass / (p.mass + o.mass)) * 0.4 : -p.vel[axis] * (p.cat === 'small' ? 0.3 : 0.12);
  }
  stepProp(p, dt) {
    const w = this.world; p.age = (p.age || 0) + dt;
    if (p.temp && p.life > 0 && !p.held) { p.life -= dt; if (p.life <= 0) { this.remove(p); return; } }
    const moving = p.vel.lengthSq() > 0.0004;
    const sup = this.support(p), airborne = p.pos.y > sup + 0.02;
    if (!moving && !airborne) { p.state = 'rest'; this.settleTumble(p, dt); return; }
    if (p.state === 'rest') { p.state = airborne ? 'fly' : 'slide'; this.removeBox(p); }
    else if (!p.boxEntry && p.state !== 'fly') { /* slide keeps its box off while moving */ }
    const wet = this.world.lagoon && p.pos.y < this.world.lagoon.waterY - 0.1 && this.world.lagoon.inRect(p.pos.x, p.pos.z);
    p.vel.y -= G * (wet ? 0.25 : 1) * dt; if (wet) { const k = Math.exp(-2.2 * dt); p.vel.x *= k; p.vel.z *= k; p.vel.y *= Math.exp(-1.4 * dt); p.spin.multiplyScalar(k); }
    const sub = clamp(Math.ceil(p.vel.length() * dt / 0.35), 1, 6), h = dt / sub;
    for (let s = 0; s < sub; s++) {
      for (const ax of ['x', 'z']) {
        const dv = p.vel[ax] * h; if (dv === 0) continue; p.pos[ax] += dv;
        const hs = this.hits(p, p.pos); if (hs.length) { p.pos[ax] -= dv; this.bump(p, hs[0], ax, p.vel[ax]); }
      }
      const oy = p.pos.y; p.pos.y += p.vel.y * h;
      if (p.vel.y > 0) { const hs = this.hits(p, p.pos); if (hs.length) { p.pos.y = oy; p.vel.y = 0; } }
      const g = this.support(p);
      if (p.pos.y <= g) {
        const vy = p.vel.y; p.pos.y = g;
        if (vy < -5) { const dmg = (-vy - 4) * Math.sqrt(p.mass) * 0.3; this.impactFX(p.center.setY(g + 0.1), clamp(-vy / 16, 0.3, 1.4) * this.fxScale(p), p.debris); this.hurt(p, dmg * 0.3); if (p.dead) return; if (p.cat === 'heavy' || p.cat === 'vehicle') this.shockNear(p, -vy); }
        p.vel.y = vy < -6 && p.cat === 'small' ? -vy * 0.28 : 0; if (p.vel.y === 0 && p.state === 'fly') p.state = 'slide';
        const k = Math.exp(-p.fric * h); p.vel.x *= k; p.vel.z *= k; p.spin.multiplyScalar(0.4);
      }
    }
    // dummies hit by a fast prop
    if (p.state === 'fly' || p.vel.lengthSq() > 16) this.hitDummies(p);
    if (this.world.island) this.world.clampXZ(p.pos, 1); else { p.pos.x = clamp(p.pos.x, -this.limit, this.limit); p.pos.z = clamp(p.pos.z, -this.limit, this.limit); }
    if (p.state === 'fly') { p.tumble.addScaledVector(p.spin, dt); } else { this.settleTumble(p, dt); }
    if (p.state === 'slide' && p.vel.lengthSq() < 0.04 && p.pos.y <= this.support(p) + 0.02) { p.vel.set(0, 0, 0); p.state = 'rest'; p.thrown = false; this.addBox(p); }
    this.syncRoot(p); if (p.boxEntry) this.syncBox(p);
  }
  settleTumble(p, dt) { if (p.tumble.lengthSq() > 1e-4) { p.tumble.multiplyScalar(Math.exp(-14 * dt)); if (p.tumble.lengthSq() < 1e-4) p.tumble.set(0, 0, 0); this.syncRoot(p); } }
  shockNear(p, vy) { for (const h of this.g.world.hittables) { if (h.dead || h.kind !== 'dummy') continue; const d = Math.hypot(h.root.position.x - p.pos.x, h.root.position.z - p.pos.z); if (d < 4) { h.applyHit(h.root.position.clone(), _v.set(h.root.position.x - p.pos.x, 0, h.root.position.z - p.pos.z).normalize().clone(), 6); h.launch && h.launch(3); } } }
  hitDummies(p) {
    const sp = p.vel.length(); if (sp < 3.5) return; const c = p.center, rr = Math.max(p.half.x, p.half.z) * 0.8 + 0.62;
    for (const h of this.g.world.hittables) {
      if (h.dead || h.held || h.kind !== 'dummy' || p.hit.has(h)) continue; const hp = h.root.position;
      if (Math.hypot(hp.x - c.x, hp.z - c.z) > rr || p.pos.y > hp.y + 2.4 || p.pos.y + p.size.h < hp.y) continue;
      p.hit.add(h); const dir = _v.copy(p.vel).setY(0); if (dir.lengthSq() < 1e-4) dir.set(hp.x - c.x, 0, hp.z - c.z); dir.normalize();
      const dmg = clamp(Math.sqrt(p.mass) * sp * 0.42 * (p.dmgMul || 1), 4, 160), pt = new THREE.Vector3(hp.x, hp.y + 1.3, hp.z);
      h.applyHit(pt, dir.clone(), dmg); h.shove && h.shove(dir, sp * 0.8 * (p.knockMul || 1)); h.launch && h.launch(Math.min(9, 2 + sp * 0.18)); this.g.hud.hit(pt, Math.round(dmg), h); this.impactFX(pt, clamp(sp / 14, 0.5, 1.6), p.debris, true);
      p.vel.multiplyScalar(1 - clamp(70 / p.mass, 0.12, 0.5)); this.hurt(p, dmg * 0.15); if (this.g.player.stats) this.g.player.stats.propHits = (this.g.player.stats.propHits || 0) + 1;
      if (p.dead) return;
    }
  }
  remove(p) { this.removeBox(p); this.scene.remove(p.root); const i = this.props.indexOf(p); if (i >= 0) this.props.splice(i, 1); }
  update(dt) {
    this.t += dt;
    for (let i = this.props.length - 1; i >= 0; i--) { const p = this.props[i]; if (p.held || p.dead || p.planted || p.driven) continue; this.stepProp(p, dt); }
    this.debris.update(dt); this.cracks.update(dt);
  }
  /** area effect (ground pound / slam shockwave) on props & walls: hop + shove + damage */
  shockwave(c, radius, force, wallDmg, propDmg) {
    for (const p of this.props) {
      if (p.held || p.dead || p.driven) continue; const d = Math.hypot(p.pos.x - c.x, p.pos.z - c.z); if (d > radius || p.pos.y > c.y + 4) continue; const f = 1 - d / radius, k = f * force / Math.sqrt(p.mass / 12 + 1);
      if (p.planted) { if (f > 0.5) this.hurt(p, propDmg * f); continue; }
      _v.set(p.pos.x - c.x, 0, p.pos.z - c.z); if (_v.lengthSq() < 1e-4) _v.set(1, 0, 0); _v.normalize();
      this.removeBox(p); p.state = 'fly'; p.vel.x += _v.x * k * 0.7; p.vel.z += _v.z * k * 0.7; p.vel.y = Math.max(p.vel.y, Math.min(11, k * 0.45)); p.spin.set(rand(-2, 2) * f, rand(-2, 2), rand(-2, 2) * f); p.hit.clear(); this.hurt(p, propDmg * f);
    }
    for (const w of this.walls) { if (!w.alive) continue; const b = w.entry, cx = clamp(c.x, b.min.x, b.max.x), cz = clamp(c.z, b.min.z, b.max.z), d = Math.hypot(cx - c.x, cz - c.z); if (d < radius) this.damageWall(w, wallDmg * (1 - d / radius), new THREE.Vector3(cx, 1.5, cz), _v.set(cx - c.x, 0, cz - c.z).normalize().clone()); }
  }
  reset() {
    for (let i = this.props.length - 1; i >= 0; i--) { const p = this.props[i]; if (p.temp) { this.remove(p); continue; }
      p.dead = false; p.held = false; p.driven = false; p.root.visible = true; p.hp = p.hpMax; p.pos.copy(p.home.pos); p.yaw = p.home.yaw; p.vel.set(0, 0, 0); p.tumble.set(0, 0, 0); p.spin.set(0, 0, 0); p.state = 'rest'; p.wrecked = false;
      if (p.kind === 'light') p.planted = true; if (p.size0) { p.size = { ...p.size0 }; p.inner.position.copy(p.in0); p.inner.rotation.set(0, 0, 0); p.mass = p.mass0; } this.addBox(p); this.syncRoot(p); this.syncBox(p);
      p.inner.traverse(o => { if (o.isMesh && o.userData.c0) o.material.color.copy(o.userData.c0); }); }
    for (const w of this.walls) { if (w.isBld) continue; w.hp = w.hpMax; w.stage = 0; if (!w.alive) { this.world.boxes.push(w.entry); } w.alive = true; w.mesh.visible = true; w.mesh.material = w.mat0; }
    this.debris.clear(); this.cracks.clear();
  }
}
