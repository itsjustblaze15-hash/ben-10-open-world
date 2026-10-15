// ISLAND TERRAIN (rendering + queries). Geometry, colours and every height query come from the same generated heightfield (terrain_gen.js).
//  - 72 chunks of 256 m, three levels of detail (4 / 8 / 16 m) chosen by distance, skirts hide the cracks between levels
//  - cartoon look: toon ramp + vertex colours by region / slope / height / shore, a little world-space noise, underwater caustics + depth tint below sea level
//  - queries: height(x, z), slope, normal, ray(o, d, maxT) (march + bisection)
import * as THREE from 'three';
import { hAt, dlAt, regionAt, REGION_IDS, WATER } from './terrain_gen.js';
import { SEA, makeNoise } from './layout.js';

const CH = 64;                              // cells per chunk side
const LOD_STEP = [1, 2, 4], LOD_DIST = [330, 720];
const _v = new THREE.Vector3();

export function toonRamp(steps = [0.42, 0.68, 0.86, 1.0]) {
  const data = new Uint8Array(steps.length * 4); steps.forEach((s, i) => { const v = Math.round(s * 255); data.set([v, v, v, 255], i * 4); });
  const t = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t;
}
export const RAMP = toonRamp();

// cartoon palette
const C = (h) => new THREE.Color(h);
const PAL = {
  grass: C(0x5cbf3f), grassDark: C(0x3f9a35), lawn: C(0x72cc46), forest: C(0x3b8f37), meadow: C(0x86c84a), dryGrass: C(0xb7b257),
  sand: C(0xf1d999), wetSand: C(0xd9bd80), desert: C(0xe9a45e), desertDark: C(0xd27f45), redRock: C(0xc25c3c), redRock2: C(0xa94a33),
  rock: C(0x8e8a84), rockDark: C(0x6f6b66), snow: C(0xf4f8fc), concrete: C(0xb9bec6), labs: C(0xd5e2e2), lot: C(0x9da1a8), industrial: C(0xa39d94),
  seabed: C(0xd8c591), seabedDeep: C(0x4f7d78), dirt: C(0xa98a5f), road: C(0x8d8e90),
};
const tmpC = new THREE.Color(), tmpC2 = new THREE.Color();

export class Terrain {
  constructor(scene, T, { lagoonTint = null } = {}) {
    this.scene = scene; this.T = T; this.N = makeNoise(77); this.chunks = []; this.group = new THREE.Group(); this.group.name = 'Terrain'; scene.add(this.group);
    this.colors = this.bakeColors();
    this.material = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: RAMP });
    this.material.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.uTime; sh.uniforms.uWaterY = { value: SEA };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vWP; uniform float uTime; uniform float uWaterY;
        float th(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float tn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(th(i), th(i + vec2(1, 0)), f.x), mix(th(i + vec2(0, 1)), th(i + vec2(1, 1)), f.x), f.y); }
        float caus(vec2 p, float t){ vec2 q = p * 1.1; float a = sin(q.x * 1.3 + t * 0.9 + sin(q.y * 1.1 - t * 0.7)); float b = sin(q.y * 1.5 - t * 0.8 + sin(q.x * 0.9 + t * 0.6)); float c = sin((q.x + q.y) * 0.9 + t * 0.5); float v = (a * b + c) * 0.5; return pow(clamp(1.0 - abs(v), 0.0, 1.0), 7.0); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
        { float n = tn(vWP.xz * 0.35) * 0.6 + tn(vWP.xz * 1.7) * 0.4; diffuseColor.rgb *= 0.93 + 0.12 * n; }`)
        .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        { float wet = smoothstep(uWaterY + 0.05, uWaterY - 0.4, vWP.y); float dk = clamp((uWaterY - vWP.y) / 14.0, 0.0, 1.0);
          vec3 col = gl_FragColor.rgb; col *= mix(vec3(1.0), vec3(0.72, 0.93, 1.0), wet); col += vec3(0.34, 0.62, 0.60) * caus(vWP.xz, uTime) * 0.45 * wet * (1.0 - 0.6 * dk);
          col = mix(col, vec3(0.03, 0.22, 0.30), dk * 0.55 * wet); gl_FragColor.rgb = col; }`);
    };
    this.uTime = { value: 0 };
    this.buildChunks();
  }
  // ------------------------------------------------------------------------------------------------ queries
  height(x, z) { return hAt(this.T, x, z); }
  dl(x, z) { return dlAt(this.T, x, z); }
  region(x, z) { return regionAt(this.T, x, z); }
  /** gradient magnitude (rise per metre) */
  slope(x, z) { const e = 1.5; const gx = (this.height(x + e, z) - this.height(x - e, z)) / (2 * e), gz = (this.height(x, z + e) - this.height(x, z - e)) / (2 * e); return Math.hypot(gx, gz); }
  gradient(x, z, out) { const e = 1.5; out.x = (this.height(x + e, z) - this.height(x - e, z)) / (2 * e); out.z = (this.height(x, z + e) - this.height(x, z - e)) / (2 * e); return out; }
  normal(x, z, out = new THREE.Vector3()) { const e = 1.5; const gx = (this.height(x + e, z) - this.height(x - e, z)) / (2 * e), gz = (this.height(x, z + e) - this.height(x, z - e)) / (2 * e); return out.set(-gx, 1, -gz).normalize(); }
  /** first crossing of the segment o + d t (t in 0..maxT, |d| = 1) from above the ground to below it -> { t, normal } | null. A ray that starts below the ground is ignored until it rises above it. */
  ray(o, d, maxT) {
    if (maxT <= 0) return null; const step = Math.max(0.5, Math.min(3, maxT / 12)); let prevT = 0, prevAbove = o.y >= this.height(o.x, o.z) - 0.02;
    for (let t = step; ; t += step) {
      const tt = Math.min(t, maxT), x = o.x + d.x * tt, y = o.y + d.y * tt, z = o.z + d.z * tt, above = y >= this.height(x, z);
      if (prevAbove && !above) { let a = prevT, b = tt; for (let k = 0; k < 10; k++) { const m = (a + b) / 2, mx = o.x + d.x * m, mz = o.z + d.z * m; if (o.y + d.y * m >= this.height(mx, mz)) a = m; else b = m; } const hx = o.x + d.x * b, hz = o.z + d.z * b; return { t: b, normal: this.normal(hx, hz) }; }
      prevAbove = above; prevT = tt; if (tt >= maxT) break;
    }
    return null;
  }
  // ------------------------------------------------------------------------------------------------ colours (per grid vertex, baked once)
  bakeColors() {
    const T = this.T, { nx, nz, cell, x0, z0, H, DL, RG, RM, WK } = T, col = new Float32Array(nx * nz * 3), N = this.N;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, x = x0 + i * cell, z = z0 + j * cell, h = H[k], dl = DL[k], reg = REGION_IDS[RG[k]];
      const iL = Math.max(0, i - 1), iR = Math.min(nx - 1, i + 1), jU = Math.max(0, j - 1), jD = Math.min(nz - 1, j + 1);
      const sl = Math.hypot((H[j * nx + iR] - H[j * nx + iL]) / ((iR - iL) * cell), (H[jD * nx + i] - H[jU * nx + i]) / ((jD - jU) * cell));
      const n1 = N.fbm(x * 0.02, z * 0.02, 3), n2 = N.n2(x * 0.11, z * 0.11);
      let c = tmpC;
      if (dl < 0) { const dk = Math.min(1, (SEA - h) / 18); c.copy(PAL.seabed).lerp(PAL.seabedDeep, dk); if (WK[k] === WATER.LAKE || WK[k] === WATER.RIVER) c.lerp(PAL.dirt, 0.25); }
      else {
        switch (reg) {
          case 'city': c.copy(PAL.lawn).lerp(PAL.grass, 0.3 + 0.4 * n1); break;
          case 'labs': c.copy(PAL.labs); break;
          case 'industrial': c.copy(PAL.industrial).lerp(PAL.lot, 0.4 + 0.4 * n1); break;
          case 'beach': c.copy(PAL.sand).lerp(PAL.meadow, Math.max(0, n1 * 1.5 - 0.2) * Math.min(1, dl / 90)); break;
          case 'suburb': c.copy(PAL.lawn).lerp(PAL.grass, 0.4 + 0.4 * n1); break;
          case 'desert': { c.copy(PAL.desert).lerp(PAL.desertDark, 0.5 + 0.5 * n1); if (h > 6) { const band = Math.sin(h * 0.9) * 0.5 + 0.5; tmpC2.copy(PAL.redRock).lerp(PAL.redRock2, band); c.lerp(tmpC2, Math.min(1, (h - 6) / 8)); } if (dl < 140 && dl > 0) c.lerp(PAL.dryGrass, 0.35 * (1 - dl / 140)); break; }
          case 'mountains': { c.copy(PAL.grassDark).lerp(PAL.rock, Math.min(1, Math.max(0, (h - 45) / 40))); if (h > 140 + 12 * n1 && sl < 1.1) c.lerp(PAL.snow, Math.min(1, (h - 140 - 12 * n1) / 12)); break; }
          case 'foothills': c.copy(PAL.grass).lerp(PAL.meadow, 0.35 + 0.4 * n1); break;
          default: c.copy(PAL.forest).lerp(PAL.grass, 0.35 + 0.5 * n1);
        }
        if (sl > 0.75 && reg !== 'city' && reg !== 'labs') { tmpC2.copy(reg === 'desert' ? PAL.redRock2 : PAL.rockDark).lerp(reg === 'desert' ? PAL.redRock : PAL.rock, 0.5 + 0.5 * n2); c.lerp(tmpC2, Math.min(1, (sl - 0.75) * 1.6)); }
        if (dl < 14 && reg !== 'city' && reg !== 'labs' && reg !== 'industrial') c.lerp(dl < 5 ? PAL.wetSand : PAL.sand, (1 - dl / 14) * 0.9);         // a sandy shore everywhere
        if (RM[k] > 0.4 && reg !== 'city') c.lerp(PAL.dirt, (RM[k] - 0.4) * 0.6);
      }
      col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
    }
    return col;
  }
  // ------------------------------------------------------------------------------------------------ meshes
  buildChunks() {
    const T = this.T, ncx = Math.ceil((T.nx - 1) / CH), ncz = Math.ceil((T.nz - 1) / CH);
    for (let cz = 0; cz < ncz; cz++) for (let cx = 0; cx < ncx; cx++) {
      const i0 = cx * CH, j0 = cz * CH, i1 = Math.min(T.nx - 1, i0 + CH), j1 = Math.min(T.nz - 1, j0 + CH);
      const ch = { i0, j0, i1, j1, lod: -1, meshes: [], cx: T.x0 + (i0 + i1) / 2 * T.cell, cz: T.z0 + (j0 + j1) / 2 * T.cell, half: (i1 - i0) * T.cell / 2 };
      let lo = 1e9, hi = -1e9; for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const h = T.H[j * T.nx + i]; if (h < lo) lo = h; if (h > hi) hi = h; } ch.lo = lo; ch.hi = hi;
      ch.underSea = hi < SEA - 6;                                                             // deep ocean floor only: drawn at the coarsest level
      for (let l = 0; l < 3; l++) { const m = new THREE.Mesh(this.chunkGeo(ch, LOD_STEP[l]), this.material); m.receiveShadow = l === 0; m.visible = false; m.matrixAutoUpdate = false; m.updateMatrix(); this.group.add(m); ch.meshes.push(m); }
      this.chunks.push(ch);
    }
  }
  chunkGeo(ch, step) {
    const T = this.T, { i0, j0, i1, j1 } = ch, nI = Math.floor((i1 - i0) / step) + 1, nJ = Math.floor((j1 - j0) / step) + 1;
    const vcount = nI * nJ + 2 * (nI + nJ), pos = new Float32Array(vcount * 3), nor = new Float32Array(vcount * 3), col = new Float32Array(vcount * 3), idx = [];
    const iAt = (a) => Math.min(i1, i0 + a * step), jAt = (b) => Math.min(j1, j0 + b * step);
    const put = (v, i, j, drop = 0) => {
      const k = j * T.nx + i, x = T.x0 + i * T.cell, z = T.z0 + j * T.cell;
      pos[v * 3] = x; pos[v * 3 + 1] = T.H[k] - drop; pos[v * 3 + 2] = z;
      const iL = Math.max(0, i - 1), iR = Math.min(T.nx - 1, i + 1), jU = Math.max(0, j - 1), jD = Math.min(T.nz - 1, j + 1);
      const gx = (T.H[j * T.nx + iR] - T.H[j * T.nx + iL]) / ((iR - iL) * T.cell), gz = (T.H[jD * T.nx + i] - T.H[jU * T.nx + i]) / ((jD - jU) * T.cell);
      _v.set(-gx, 1, -gz).normalize(); nor[v * 3] = _v.x; nor[v * 3 + 1] = _v.y; nor[v * 3 + 2] = _v.z;
      col[v * 3] = this.colors[k * 3]; col[v * 3 + 1] = this.colors[k * 3 + 1]; col[v * 3 + 2] = this.colors[k * 3 + 2];
    };
    for (let b = 0; b < nJ; b++) for (let a = 0; a < nI; a++) put(b * nI + a, iAt(a), jAt(b));
    for (let b = 0; b < nJ - 1; b++) for (let a = 0; a < nI - 1; a++) { const p = b * nI + a; idx.push(p, p + nI, p + 1, p + 1, p + nI, p + nI + 1); }
    // skirts (hang 3 m below every edge so neighbouring levels of detail never show a gap)
    let v = nI * nJ; const skirt = (edge) => {
      const start = v;
      for (let s = 0; s < edge.length; s++) { const [a, b] = edge[s]; put(v++, iAt(a), jAt(b), step * 1.6 + 2); }
      for (let s = 0; s < edge.length - 1; s++) { const top0 = edge[s][1] * nI + edge[s][0], top1 = edge[s + 1][1] * nI + edge[s + 1][0], bot0 = start + s, bot1 = start + s + 1; idx.push(top0, bot0, top1, top1, bot0, bot1, top0, top1, bot0, top1, bot1, bot0); }
    };
    const N = [], S = [], Wd = [], E = []; for (let a = 0; a < nI; a++) { N.push([a, 0]); S.push([a, nJ - 1]); } for (let b = 0; b < nJ; b++) { Wd.push([0, b]); E.push([nI - 1, b]); }
    skirt(N); skirt(S); skirt(Wd); skirt(E);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx); g.computeBoundingSphere(); g.computeBoundingBox(); return g;
  }
  /** pick the level of detail per chunk from the camera distance */
  update(dt, camPos) {
    this.uTime.value += dt;
    for (const ch of this.chunks) {
      const dx = Math.max(0, Math.abs(camPos.x - ch.cx) - ch.half), dz = Math.max(0, Math.abs(camPos.z - ch.cz) - ch.half), d = Math.hypot(dx, dz);
      const lod = ch.underSea ? 2 : d < LOD_DIST[0] ? 0 : d < LOD_DIST[1] ? 1 : 2;
      if (lod !== ch.lod) { if (ch.lod >= 0) ch.meshes[ch.lod].visible = false; ch.meshes[lod].visible = true; ch.lod = lod; }
    }
  }
}
