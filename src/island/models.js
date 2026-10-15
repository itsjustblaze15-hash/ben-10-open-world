// Low-poly cartoon models for the island's static scenery, each one merged into a SINGLE geometry with vertex colours (one draw call per model type per chunk when instanced).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _c = new THREE.Color();
function part(geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, jitter = 0, seed = 1) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone(); g.deleteAttribute('uv'); if (g.attributes.uv1) g.deleteAttribute('uv1');
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz)); g.applyMatrix4(m);
  if (jitter) { const p = g.attributes.position; let s = seed; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; }; const map = new Map();
    for (let i = 0; i < p.count; i++) { const k = p.getX(i).toFixed(2) + ',' + p.getY(i).toFixed(2) + ',' + p.getZ(i).toFixed(2); let d = map.get(k); if (!d) map.set(k, d = [r() * jitter, r() * jitter, r() * jitter]); p.setXYZ(i, p.getX(i) + d[0], p.getY(i) + d[1], p.getZ(i) + d[2]); } g.computeVertexNormals(); }
  const n = g.attributes.position.count, col = new Float32Array(n * 3); _c.set(color); for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); return g;
}
const merge = (parts) => { const g = mergeGeometries(parts, false); g.computeBoundingSphere(); g.computeBoundingBox(); return g; };
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d), CY = (rt, rb, h, s = 8) => new THREE.CylinderGeometry(rt, rb, h, s), CO = (r, h, s = 8) => new THREE.ConeGeometry(r, h, s), IC = (r, d = 1) => new THREE.IcosahedronGeometry(r, d), SP = (r, w = 10, h = 7) => new THREE.SphereGeometry(r, w, h);

export const MODELS = {
  // ---- vegetation
  broadleaf: () => merge([part(CY(0.28, 0.42, 3.4, 7), 0x7a4e2a, 0, 1.7), part(IC(2.1, 1), 0x3e9e3a, 0, 4.6, 0, 0, 0, 0, 1, 0.85, 1, 0.5, 3), part(IC(1.5, 1), 0x4fb544, 0.9, 5.4, 0.3, 0, 0, 0, 1, 0.9, 1, 0.4, 5), part(IC(1.4, 1), 0x379033, -1.0, 4.1, -0.4, 0, 0, 0, 1, 0.9, 1, 0.4, 7)]),
  broadleaf2: () => merge([part(CY(0.24, 0.36, 2.8, 7), 0x6e4524, 0, 1.4), part(IC(1.8, 1), 0x58b83e, 0, 3.9, 0, 0, 0, 0, 1.1, 1, 1.1, 0.45, 11), part(IC(1.2, 1), 0x6cc84a, 0.3, 5.0, 0.2, 0, 0, 0, 1, 1, 1, 0.3, 13)]),
  pine: () => merge([part(CY(0.22, 0.34, 2.2, 6), 0x6a4426, 0, 1.1), part(CO(2.3, 3.2, 8), 0x2f7d45, 0, 3.0), part(CO(1.8, 2.8, 8), 0x37904e, 0, 4.6), part(CO(1.2, 2.4, 8), 0x40a056, 0, 6.1)]),
  pineSnow: () => merge([part(CY(0.22, 0.34, 2.2, 6), 0x6a4426, 0, 1.1), part(CO(2.3, 3.2, 8), 0x2f7d45, 0, 3.0), part(CO(1.8, 2.8, 8), 0x37904e, 0, 4.6), part(CO(1.2, 2.4, 8), 0xeef4f8, 0, 6.1)]),
  palm: () => { const parts = [], trunkC = 0x9a7347; for (let i = 0; i < 6; i++) parts.push(part(CY(0.2 - i * 0.012, 0.24 - i * 0.012, 1.25, 7), i % 2 ? trunkC : 0x8a6540, Math.sin(i * 0.25) * 0.35 * i * 0.25, 0.62 + i * 1.18, 0, 0, 0, -0.06 * i));
    const top = new THREE.Vector3(0.6, 7.6, 0); for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2; parts.push(part(B(0.9, 0.12, 3.6), k % 2 ? 0x3fa244 : 0x52b84a, top.x + Math.cos(a) * 1.5, top.y - 0.35, Math.sin(a) * 1.5, 0, -a + Math.PI / 2, 0.38)); }
    parts.push(part(SP(0.35, 6, 5), 0x6b4a22, top.x, top.y - 0.3, 0.2), part(SP(0.33, 6, 5), 0x6b4a22, top.x - 0.25, top.y - 0.35, -0.2)); return merge(parts); },
  bush: () => merge([part(IC(0.9, 1), 0x3f9a3a, 0, 0.6, 0, 0, 0, 0, 1.2, 0.8, 1.2, 0.25, 21), part(IC(0.6, 1), 0x52b048, 0.5, 0.7, 0.2, 0, 0, 0, 1, 1, 1, 0.2, 23)]),
  dryBush: () => merge([part(IC(0.7, 0), 0xa59a55, 0, 0.45, 0, 0, 0, 0, 1.3, 0.7, 1.3, 0.2, 31), part(IC(0.45, 0), 0x8e8446, 0.4, 0.4, 0.3, 0, 0, 0, 1, 1, 1, 0.15, 33)]),
  cactus: () => merge([part(CY(0.42, 0.48, 4.2, 8), 0x3e8f4a, 0, 2.1), part(SP(0.42, 8, 5), 0x3e8f4a, 0, 4.2), part(CY(0.28, 0.28, 1.6, 8), 0x46a052, 0.95, 2.6, 0, 0, 0, 0), part(CY(0.28, 0.28, 0.9, 8), 0x46a052, 0.55, 1.85, 0, 0, 0, Math.PI / 2), part(SP(0.28, 8, 5), 0x46a052, 0.95, 3.4), part(CY(0.24, 0.24, 1.2, 8), 0x46a052, -0.85, 3.0), part(CY(0.24, 0.24, 0.75, 8), 0x46a052, -0.5, 2.4, 0, 0, 0, Math.PI / 2), part(SP(0.24, 8, 5), 0x46a052, -0.85, 3.6)]),
  rock: () => merge([part(IC(1, 0), 0x8f8a82, 0, 0.45, 0, 0, 0, 0, 1.3, 0.85, 1.1, 0.35, 41)]),
  rockRed: () => merge([part(IC(1, 0), 0xb4583a, 0, 0.45, 0, 0, 0, 0, 1.3, 0.9, 1.1, 0.35, 43)]),
  log: () => merge([part(CY(0.45, 0.45, 5.0, 9), 0x7a4e2a, 0, 0.45, 0, 0, 0, Math.PI / 2), part(CY(0.38, 0.38, 0.06, 9), 0xc79a62, 2.52, 0.45, 0, 0, 0, Math.PI / 2), part(CY(0.38, 0.38, 0.06, 9), 0xc79a62, -2.52, 0.45, 0, 0, 0, Math.PI / 2)]),
  seaweed: () => merge([part(CO(0.25, 2.2, 5), 0x2f8a52, 0, 1.1, 0, 0.1, 0, 0.12), part(CO(0.2, 1.6, 5), 0x3aa060, 0.3, 0.8, 0.2, -0.15, 0, -0.1), part(CO(0.18, 1.9, 5), 0x2a7a4a, -0.25, 0.95, -0.15, 0.12, 0, 0.05)]),
  grass: () => merge([part(CO(0.12, 0.7, 3), 0x5ec244, 0, 0.35, 0, 0.2, 0, 0.1), part(CO(0.1, 0.6, 3), 0x6fd250, 0.15, 0.3, 0.05, -0.2, 0, -0.15), part(CO(0.1, 0.55, 3), 0x4fb03c, -0.1, 0.28, 0.12, 0.1, 0, 0.25)]),
  // ---- street furniture / props that stay static
  trafficLight: () => merge([part(CY(0.12, 0.15, 5.4, 8), 0x3c434a, 0, 2.7), part(B(3.6, 0.18, 0.18), 0x3c434a, 1.8, 5.2, 0), part(B(0.5, 1.3, 0.45), 0xe0b11c, 3.3, 4.6, 0), part(SP(0.14, 8, 6), 0x481010, 3.3, 5.0, 0.24), part(SP(0.14, 8, 6), 0x4a3a08, 3.3, 4.6, 0.24), part(SP(0.14, 8, 6), 0x0d3a12, 3.3, 4.2, 0.24)]),
  hydrant: () => merge([part(CY(0.18, 0.2, 0.7, 8), 0xd8352a, 0, 0.35), part(SP(0.19, 8, 5), 0xd8352a, 0, 0.72), part(CY(0.07, 0.07, 0.5, 6), 0xd8352a, 0, 0.45, 0, 0, 0, Math.PI / 2)]),
  mailbox: () => merge([part(CY(0.05, 0.05, 1.0, 6), 0x5a3d22, 0, 0.5), part(B(0.3, 0.32, 0.55), 0x2e66b8, 0, 1.12), part(CY(0.15, 0.15, 0.55, 8, 1), 0x2e66b8, 0, 1.28, 0, Math.PI / 2, 0, 0)]),
  acUnit: () => merge([part(B(1.6, 1.0, 1.2), 0xc9ccd0, 0, 0.5), part(CY(0.4, 0.4, 0.05, 12), 0x6a7076, 0, 1.03), part(B(1.62, 0.08, 1.22), 0x9aa0a6, 0, 0.98)]),
  waterTank: () => merge([part(CY(1.4, 1.4, 2.6, 12), 0x8a5a3a, 0, 3.0), part(CO(1.5, 0.9, 12), 0x5a3d26, 0, 4.75), ...[[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([x, z]) => part(CY(0.1, 0.1, 1.7, 5), 0x3a3a3a, x, 0.85, z))]),
  antenna: () => merge([part(CY(0.06, 0.12, 9, 6), 0xd0d4d8, 0, 4.5), part(SP(0.22, 8, 6), 0xff3a2a, 0, 9.1), part(B(1.6, 0.08, 0.08), 0xd0d4d8, 0, 6, 0), part(B(1.1, 0.08, 0.08), 0xd0d4d8, 0, 7.5, 0)]),
  fountain: () => merge([part(CY(6, 6.3, 0.8, 24), 0xd8d2c4, 0, 0.4), part(CY(5.3, 5.3, 0.82, 24), 0x58b8e0, 0, 0.42), part(CY(0.9, 1.2, 2.4, 12), 0xd8d2c4, 0, 1.2), part(CY(2.2, 1.6, 0.4, 16), 0xd8d2c4, 0, 2.5), part(CY(0.45, 0.6, 1.2, 10), 0xd8d2c4, 0, 3.2), part(SP(0.5, 10, 7), 0x8fe0ff, 0, 4.0)]),
  umbrella: () => merge([part(CY(0.05, 0.05, 2.4, 6), 0xeeeeee, 0, 1.2), part(CO(1.4, 0.6, 8), 0xe8483a, 0, 2.45), part(CO(1.38, 0.58, 8), 0xffffff, 0, 2.47, 0, 0, Math.PI / 8, 0, 1, 1, 1)]),
  chair: () => merge([part(B(0.7, 0.08, 1.7), 0x3aa0e0, 0, 0.35, 0), part(B(0.7, 0.08, 0.8), 0x3aa0e0, 0, 0.6, -0.95, -0.9, 0, 0), ...[[0.3, 0.6], [-0.3, 0.6], [0.3, -0.6], [-0.3, -0.6]].map(([x, z]) => part(B(0.06, 0.35, 0.06), 0xdddddd, x, 0.17, z))]),
  lifeguard: () => merge([...[[1.2, 1.2], [-1.2, 1.2], [1.2, -1.2], [-1.2, -1.2]].map(([x, z]) => part(B(0.22, 3.2, 0.22), 0xf4f0e6, x, 1.6, z)), part(B(3.0, 0.2, 3.0), 0xf4f0e6, 0, 3.2), part(B(2.8, 1.8, 2.8), 0xe8483a, 0, 4.2), part(B(2.0, 0.9, 0.06), 0x8fd0f0, 0, 4.4, 1.42), part(CO(2.4, 1.0, 4), 0xf4f0e6, 0, 5.6, 0, 0, Math.PI / 4, 0), part(B(1.2, 0.08, 2.2), 0xc9a06a, 0, 1.6, 2.2, -0.9, 0, 0)]),
  crane: () => { const P = [], y = 0xe8a417, d = 0x3a3f46; for (const [x, z] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) P.push(part(B(1.0, 30, 1.0), y, x, 15, z)); for (const h of [8, 16, 24]) { P.push(part(B(11, 0.6, 0.6), y, 0, h, -5), part(B(11, 0.6, 0.6), y, 0, h, 5), part(B(0.6, 0.6, 11), y, -5, h, 0), part(B(0.6, 0.6, 11), y, 5, h, 0)); }
    P.push(part(B(3, 3, 52), y, 0, 31.5, -12), part(B(8, 5, 8), 0xd85a2a, 0, 35, 0), part(B(1.6, 1.6, 6), d, 0, 31, 13), part(CY(0.08, 0.08, 14, 4), d, 0, 23, -32), part(B(3, 0.8, 2), d, 0, 16, -32)); return merge(P); },
  tank: () => merge([part(CY(7, 7, 12, 20), 0xdfe3e6, 0, 6), part(CY(7.05, 7.05, 0.6, 20), 0x2fbf62, 0, 9), part(CO(7.2, 2.2, 20), 0xc9ced2, 0, 13.1), part(B(0.8, 12, 0.8), 0x7a8086, 7.1, 6, 0)]),
  pipeRack: () => merge([...[-9, 0, 9].map(x => part(B(0.5, 5, 0.5), 0x7a8086, x, 2.5, 0)), part(B(19, 0.4, 1.4), 0x7a8086, 0, 5, 0), part(CY(0.4, 0.4, 19, 10), 0xc8742a, 0, 5.6, -0.3, 0, 0, Math.PI / 2), part(CY(0.3, 0.3, 19, 10), 0x3a8ad0, 0, 5.5, 0.4, 0, 0, Math.PI / 2)]),
  ship: () => merge([part(B(18, 7, 90), 0x2b4f86, 0, 3.5), part(B(18.2, 1.4, 90.2), 0xc23a2a, 0, 0.7), part(CO(9.1, 14, 4), 0x2b4f86, 0, 3.5, 51.5, Math.PI / 2, Math.PI / 4, 0, 1, 1, 0.5), part(B(14, 10, 12), 0xf0f0f0, 0, 12, -36), part(B(14.2, 1.6, 12.2), 0x2fbf62, 0, 16.6, -36), part(CY(1.4, 1.6, 6, 10), 0xe0b11c, 0, 20, -38),
    ...[0, 1, 2, 3, 4].flatMap(i => [part(B(5.6, 2.6, 12), [0xd8452a, 0x2f8ad0, 0x2faf5a, 0xe0b11c, 0x8a4ad0][i], -4.4, 8.3, -12 + i * 12.5), part(B(5.6, 2.6, 12), [0x2f8ad0, 0xe0b11c, 0xd8452a, 0x2faf5a, 0xe0b11c][i], 1.4, 8.3, -12 + i * 12.5), part(B(5.6, 2.6, 12), [0x2faf5a, 0xd8452a, 0x8a4ad0, 0x2f8ad0, 0xd8452a][i], 4.4, 10.9, -12 + i * 12.5)])]),
  lighthouse: () => { const P = []; for (let i = 0; i < 6; i++) P.push(part(CY(2.6 - i * 0.22, 2.8 - i * 0.22, 3.4, 16), i % 2 ? 0xd83a2a : 0xf6f2ea, 0, 1.7 + i * 3.4)); P.push(part(CY(1.9, 1.9, 0.4, 16), 0x3a3f46, 0, 20.6), part(CY(1.4, 1.4, 2.4, 16), 0xfff3a0, 0, 22), part(CO(1.9, 1.8, 16), 0xd83a2a, 0, 24.1), part(CY(3.2, 3.6, 1.4, 16), 0xb8b2a6, 0, 0.7)); return merge(P); },
  ferris: () => { const P = []; for (const z of [-1.4, 1.4]) { P.push(part(new THREE.TorusGeometry(13, 0.35, 6, 40), 0xf2f2f2, 0, 16, z)); for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; P.push(part(B(0.25, 13, 0.25), 0xf2f2f2, Math.cos(a) * 6.5, 16 + Math.sin(a) * 6.5, z, 0, 0, a + Math.PI / 2)); } }
    for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; P.push(part(B(2.2, 1.8, 2.2), [0xe8483a, 0x3aa0e0, 0xf0c020, 0x50c060][k % 4], Math.cos(a) * 13, 16 + Math.sin(a) * 13 - 1.4, 0)); }
    P.push(part(B(0.8, 17, 0.8), 0x3a3f46, -5, 8, -2.6, 0, 0, -0.3), part(B(0.8, 17, 0.8), 0x3a3f46, 5, 8, -2.6, 0, 0, 0.3), part(B(0.8, 17, 0.8), 0x3a3f46, -5, 8, 2.6, 0, 0, -0.3), part(B(0.8, 17, 0.8), 0x3a3f46, 5, 8, 2.6, 0, 0, 0.3)); return merge(P); },
  shack: () => merge([part(B(5, 3, 4), 0xa98a5f, 0, 1.5), part(B(5.6, 0.3, 4.6), 0x6a5038, 0, 3.15, 0, 0.08, 0, 0), part(B(1.1, 2.0, 0.08), 0x4a3a28, 0.8, 1.0, 2.02), part(B(1.0, 0.8, 0.08), 0x3a5868, -1.3, 1.8, 2.02)]),
  dish: () => merge([part(CY(0.5, 0.8, 6, 10), 0xdfe3e6, 0, 3), part(SP(4, 16, 8), 0xf4f6f8, 0, 8, 0, -1.0, 0, 0, 1, 0.3, 1), part(CY(0.1, 0.1, 3, 6), 0x7a8086, 0, 9.2, 1.0, -1.0, 0, 0)]),
  dome: () => merge([part(SP(14, 24, 12), 0xeaf3f2, 0, 0, 0, 0, 0, 0, 1, 0.75, 1), part(CY(14.2, 14.2, 1.2, 24), 0x2fbf62, 0, 0.3)]),
  swing: () => merge([part(B(0.15, 2.6, 0.15), 0xd8452a, -1.6, 1.3, -0.8, 0.3, 0, 0), part(B(0.15, 2.6, 0.15), 0xd8452a, -1.6, 1.3, 0.8, -0.3, 0, 0), part(B(0.15, 2.6, 0.15), 0xd8452a, 1.6, 1.3, -0.8, 0.3, 0, 0), part(B(0.15, 2.6, 0.15), 0xd8452a, 1.6, 1.3, 0.8, -0.3, 0, 0), part(B(3.4, 0.15, 0.15), 0xd8452a, 0, 2.55, 0), part(B(0.5, 0.06, 0.25), 0x2f6fd0, -0.7, 0.6, 0), part(B(0.5, 0.06, 0.25), 0x2f6fd0, 0.7, 0.6, 0)]),
  slide: () => merge([part(B(1.4, 0.15, 1.4), 0xf0c020, 0, 2.2, -1.2), ...[[0.6, -0.6], [-0.6, -0.6], [0.6, -1.8], [-0.6, -1.8]].map(([x, z]) => part(B(0.12, 2.2, 0.12), 0x2f6fd0, x, 1.1, z)), part(B(0.9, 0.1, 3.4), 0xe8483a, 0, 1.15, 1.0, 0.62, 0, 0), part(B(0.9, 0.1, 2.4), 0x2f6fd0, 0, 1.1, -2.6, -0.9, 0, 0)]),
  pumps: () => merge([part(B(14, 0.5, 8), 0xf2f2f2, 0, 5.6), ...[[-5, -2.5], [5, -2.5], [-5, 2.5], [5, 2.5]].map(([x, z]) => part(B(0.5, 5.4, 0.5), 0xf2f2f2, x, 2.7, z)), part(B(14.1, 0.6, 8.1), 0xd8452a, 0, 5.2), part(B(0.8, 1.6, 0.6), 0xd8452a, -2, 0.8, 0), part(B(0.8, 1.6, 0.6), 0xd8452a, 2, 0.8, 0)]),
  arch: () => { const P = []; for (let k = 0; k <= 12; k++) { const a = k / 12 * Math.PI, x = Math.cos(a) * 18, y = Math.sin(a) * 16; P.push(part(B(7, 6.5, 8), k % 2 ? 0xc25c3c : 0xb44f34, x, y + 3, 0, 0, 0, a - Math.PI / 2, 1, 1, 1, 0.6, 50 + k)); } return merge(P); },
  roof: () => { const g = new THREE.BufferGeometry(); const v = [-0.55, 0, -0.55, 0.55, 0, -0.55, 0, 1, -0.55, -0.55, 0, 0.55, 0.55, 0, 0.55, 0, 1, 0.55];
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.setIndex([0, 2, 1, 3, 4, 5, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 4, 0, 1, 4, 0, 4, 3]); const ng = g.toNonIndexed(); ng.computeVertexNormals();
    const c = new Float32Array(ng.attributes.position.count * 3).fill(1); ng.setAttribute('color', new THREE.BufferAttribute(c, 3)); ng.computeBoundingBox(); ng.computeBoundingSphere(); return ng; },
  slab: () => merge([part(B(1, 1, 1), 0xffffff, 0, 0.5, 0)]),
  disc: () => merge([part(CY(1, 1, 1, 28), 0xffffff, 0, 0.5, 0)]),
  sign: () => merge([part(CY(0.06, 0.06, 2.6, 6), 0x7a8086, 0, 1.3), part(B(1.6, 0.9, 0.06), 0x2f8a52, 0, 2.6, 0)]),
};

const built = new Map();
export function model(name) { let g = built.get(name); if (!g) { g = MODELS[name](); built.set(name, g); } return g; }
