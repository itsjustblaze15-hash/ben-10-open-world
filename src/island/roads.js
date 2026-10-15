// ROADS: the city street grid is ONE flat plane whose shader draws asphalt, lane lines, crosswalks, kerbs, sidewalks, parks and parking lots from the same grid numbers the
// city layout uses; every other road is a ribbon draped on the terrain (highway / avenue / street / lane / dirt shading by type). Bridges get a deck, railings and pillars,
// with real colliders (deck + railings) so everybody can cross them and swimmers pass underneath.
import * as THREE from 'three';
import { CITY, SEA } from './layout.js';
import { DECK } from './terrain_gen.js';
import { toon, addRim } from './style.js';
import { RAMP } from './terrain.js';

const ROADFN = `
  float rh(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float rn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(rh(i), rh(i + vec2(1, 0)), f.x), mix(rh(i + vec2(0, 1)), rh(i + vec2(1, 1)), f.x), f.y); }
  vec3 asphalt(vec2 p){ float n = rn(p * 0.8) * 0.5 + rn(p * 3.1) * 0.3 + rn(p * 9.0) * 0.2; return mix(vec3(0.085, 0.09, 0.105), vec3(0.15, 0.155, 0.17), n); }
  vec3 walk(vec2 p){ vec2 g = fract(p / 1.5); float j = step(g.x, 0.04) + step(g.y, 0.04); return mix(vec3(0.62, 0.62, 0.60), vec3(0.42, 0.42, 0.42), min(j, 1.0)) * (0.95 + 0.05 * rn(p)); }`;

/** shared ribbon material per road kind; uv.x = 0..1 across (including sidewalks), uv.y = metres along */
function ribbonMaterial(kind, w, side) {
  const tot = w + 2 * side;
  const m = new THREE.MeshToonMaterial({ gradientMap: RAMP, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vRU; varying vec3 vRW;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvRU = uv;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvRW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vRU; varying vec3 vRW;' + ROADFN).replace('#include <color_fragment>', `#include <color_fragment>
      { float x = (vRU.x - 0.5) * ${tot.toFixed(2)}, ax = abs(x), v = vRU.y, hw = ${(w / 2).toFixed(2)};
        vec3 c;
        if (ax > hw) { c = ${kind === 'dirt' ? 'vec3(0.62,0.52,0.36)' : 'walk(vRW.xz)'}; if (ax < hw + 0.25) c = vec3(0.72, 0.72, 0.70); }
        else {
          ${kind === 'dirt' ? `c = mix(vec3(0.66, 0.53, 0.36), vec3(0.55, 0.43, 0.28), rn(vRW.xz * 0.9)); if (abs(ax - hw * 0.45) < 0.35) c *= 0.85;` : `c = asphalt(vRW.xz);
          float edge = hw - 0.45; if (abs(ax - edge) < 0.09) c = vec3(0.95);
          ${kind === 'highway' || kind === 'avenue' ? `if (abs(ax - 0.22) < 0.08) c = vec3(0.98, 0.78, 0.15); if (abs(ax - hw * 0.5) < 0.08 && fract(v / 9.0) < 0.5) c = vec3(0.95);` : kind === 'lane' ? '' : `if (ax < 0.09 && fract(v / 8.0) < 0.55) c = vec3(0.98, 0.84, 0.25);`}`}
        }
        diffuseColor.rgb = c; }`);
  };
  m.customProgramCacheKey = () => 'road-' + kind + tot; addRim(m, 0.08); return m;
}

export function buildRoads(world, T) {
  const scene = world.scene, group = new THREE.Group(); group.name = 'Roads'; scene.add(group);
  const out = { group, bridges: [], ribbons: [] };
  // ------------------------------------------------------------------ city plane
  out.city = cityPlane(); group.add(out.city);
  // ------------------------------------------------------------------ ribbons
  const SIDE = { highway: 1.5, avenue: 3.2, street: 3.0, lane: 2.2, dirt: 0.8, path: 0 };
  const mats = {};
  for (const R of T.roads) {
    if (R.city) continue; const side = SIDE[R.type] ?? 0, key = R.type + R.w + side; const mat = mats[key] || (mats[key] = ribbonMaterial(R.type, R.w, side));
    const g = ribbon(T, R, R.w / 2 + side, world.terrain); const m = new THREE.Mesh(g, mat); m.receiveShadow = true; group.add(m); out.ribbons.push(m);
    if (R.bridge && R.deckSpan) out.bridges.push(buildBridge(world, R, group));
  }
  return out;
}

function ribbon(T, R, half, terrain) {
  const P = R.pts, n = P.length, pos = new Float32Array(n * 2 * 3), uv = new Float32Array(n * 2 * 2), idx = []; let along = 0;
  for (let i = 0; i < n; i++) {
    const p = P[i]; if (i) along += Math.hypot(p.x - P[i - 1].x, p.z - P[i - 1].z);
    const lx = -p.dz, lz = p.dx; for (let s = 0; s < 2; s++) {
      const sg = s ? -1 : 1, x = p.x + lx * half * sg, z = p.z + lz * half * sg; let y = p.deck ? DECK : Math.max(p.y, terrain.height(x, z) - 0.02);
      if (!p.deck && terrain.height(x, z) < SEA) y = Math.max(p.y, SEA + 0.05);
      const v = i * 2 + s; pos[v * 3] = x; pos[v * 3 + 1] = y + (p.deck ? 0.03 : 0.07); pos[v * 3 + 2] = z; uv[v * 2] = s ? 0 : 1; uv[v * 2 + 1] = along;
    }
    if (i) { const a = (i - 1) * 2, b = i * 2; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere(); return g;
}

function buildBridge(world, R, group) {
  const [a, b] = R.deckSpan, P = R.pts, half = R.w / 2 + 1.0, p0 = P[a], p1 = P[b];
  const x0 = Math.min(p0.x, p1.x) - (Math.abs(p0.dx) < 0.5 ? half : 0), x1 = Math.max(p0.x, p1.x) + (Math.abs(p0.dx) < 0.5 ? half : 0);
  const z0 = Math.min(p0.z, p1.z) - (Math.abs(p0.dz) < 0.5 ? half : 0), z1 = Math.max(p0.z, p1.z) + (Math.abs(p0.dz) < 0.5 ? half : 0);
  const alongX = Math.abs(p1.x - p0.x) > Math.abs(p1.z - p0.z), L = alongX ? x1 - x0 : z1 - z0;
  const deckM = toon(0xb8b4ac), railM = toon(0x6a7f9a), pilM = toon(0x9c978e);
  // deck slab (its top is the road surface) - collider + mesh
  world.addStatic(new THREE.Vector3(x0, DECK - 1.3, z0), new THREE.Vector3(x1, DECK, z1), { kind: 'bridge', name: R.id });
  const slab = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 1.3, z1 - z0), deckM); slab.position.set((x0 + x1) / 2, DECK - 0.65, (z0 + z1) / 2); slab.castShadow = slab.receiveShadow = true; group.add(slab);
  // railings (solid, waist-high)
  for (const s of [-1, 1]) {
    const rx0 = alongX ? x0 : (s < 0 ? x0 : x1 - 0.45), rx1 = alongX ? x1 : (s < 0 ? x0 + 0.45 : x1), rz0 = alongX ? (s < 0 ? z0 : z1 - 0.45) : z0, rz1 = alongX ? (s < 0 ? z0 + 0.45 : z1) : z1;
    world.addStatic(new THREE.Vector3(rx0, DECK, rz0), new THREE.Vector3(rx1, DECK + 1.1, rz1), { kind: 'rail', small: true });
    const r = new THREE.Mesh(new THREE.BoxGeometry(rx1 - rx0, 0.18, rz1 - rz0), railM); r.position.set((rx0 + rx1) / 2, DECK + 1.0, (rz0 + rz1) / 2); group.add(r);
    const lo = new THREE.Mesh(new THREE.BoxGeometry(rx1 - rx0, 0.32, rz1 - rz0), deckM); lo.position.set((rx0 + rx1) / 2, DECK + 0.16, (rz0 + rz1) / 2); group.add(lo);
    const nPost = Math.floor(L / 2.5); const pg = new THREE.BoxGeometry(0.16, 1.0, 0.16), posts = new THREE.InstancedMesh(pg, railM, nPost + 1);
    for (let i = 0; i <= nPost; i++) { const t = i / nPost, m = new THREE.Matrix4().makeTranslation(alongX ? x0 + t * (x1 - x0) : (rx0 + rx1) / 2, DECK + 0.5, alongX ? (rz0 + rz1) / 2 : z0 + t * (z1 - z0)); posts.setMatrixAt(i, m); }
    group.add(posts);
  }
  // pillars every ~22 m (into the bed)
  const nP = Math.max(1, Math.floor(L / 22)); const pg = new THREE.CylinderGeometry(0.9, 1.1, 1, 10);
  for (let i = 1; i < nP; i++) {
    const t = i / nP, x = alongX ? x0 + t * (x1 - x0) : (x0 + x1) / 2, z = alongX ? (z0 + z1) / 2 : z0 + t * (z1 - z0), bed = world.terrain.height(x, z), h = DECK - 1.3 - bed;
    if (h < 0.5) continue;
    for (const s of [-1, 1]) { const px = alongX ? x : x + s * (half - 2), pz = alongX ? z + s * (half - 2) : z; const c = new THREE.Mesh(pg, pilM); c.scale.y = h + 1; c.position.set(px, bed - 1 + (h + 1) / 2, pz); group.add(c);
      world.addStatic(new THREE.Vector3(px - 1, bed - 2, pz - 1), new THREE.Vector3(px + 1, DECK - 1.3, pz + 1), { kind: 'pillar', small: true }); }
  }
  return { id: R.id, x0, x1, z0, z1, alongX };
}

// ------------------------------------------------------------------------------------------------ the city ground (streets, crosswalks, sidewalks, parks, lots)
function cityPlane() {
  const C = CITY, xs = [C.ringX[0], ...C.xs, C.ringX[1]], zs = [C.ringZ[0], ...C.zs, C.ringZ[1]];
  const wOf = (v, ring, av) => ring ? 18 : v === av ? 16 : 12;
  const xw = xs.map((x, i) => wOf(x, i === 0 || i === xs.length - 1, C.avenueX)), zw = zs.map((z, i) => wOf(z, i === 0 || i === zs.length - 1, C.avenueZ));
  const x0 = C.ringX[0] - 22, x1 = C.ringX[1] + 22, z0 = C.ringZ[0] - 22, z1 = C.ringZ[1] + 18;
  const blk = (k) => { const ix = xs.indexOf(k[0]), iz = zs.indexOf(k[1]); return new THREE.Vector4(xs[ix] + xw[ix] / 2, zs[iz] + zw[iz] / 2, xs[ix + 1] - xw[ix + 1] / 2, zs[iz + 1] - zw[iz + 1] / 2); };
  const parks = C.parks.map(blk), lots = C.lots.map(blk), plaza = blk(C.plaza);
  const U = { uXs: { value: xs }, uXw: { value: xw }, uZs: { value: zs }, uZw: { value: zw }, uPark: { value: parks }, uLot: { value: lots }, uPlaza: { value: plaza } };
  const NX = xs.length, NZ = zs.length;
  const m = new THREE.MeshToonMaterial({ gradientMap: RAMP, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRW;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvRW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vRW; uniform float uXs[${NX}]; uniform float uXw[${NX}]; uniform float uZs[${NZ}]; uniform float uZw[${NZ}]; uniform vec4 uPark[${parks.length}]; uniform vec4 uLot[${lots.length}]; uniform vec4 uPlaza;` + ROADFN +
      `bool inR(vec4 r, vec2 p){ return p.x > r.x && p.x < r.z && p.y > r.y && p.y < r.w; }`).replace('#include <color_fragment>', `#include <color_fragment>
      {
        vec2 p = vRW.xz; float bx = 1e9, bz = 1e9, wx = 12.0, wz = 12.0, cx = 0.0, cz = 0.0;
        for (int i = 0; i < ${NX}; i++) { float d = abs(p.x - uXs[i]) - uXw[i] * 0.5; if (d < bx) { bx = d; wx = uXw[i]; cx = uXs[i]; } }
        for (int i = 0; i < ${NZ}; i++) { float d = abs(p.y - uZs[i]) - uZw[i] * 0.5; if (d < bz) { bz = d; wz = uZw[i]; cz = uZs[i]; } }
        bool outside = p.x < uXs[0] - uXw[0] * 0.5 - 4.0 || p.x > uXs[${NX - 1}] + uXw[${NX - 1}] * 0.5 + 4.0 || p.y < uZs[0] - uZw[0] * 0.5 - 4.0 || p.y > uZs[${NZ - 1}] + uZw[${NZ - 1}] * 0.5 + 4.0;
        vec3 c;
        if (bx < 0.0 || bz < 0.0) {
          c = asphalt(p);
          bool xRoad = bx < 0.0, zRoad = bz < 0.0;
          if (xRoad && zRoad) { /* intersection: plain asphalt + stop-box edges */ }
          else if (xRoad) {
            float ax = abs(p.x - cx), hw = wx * 0.5;
            if (abs(ax - (hw - 0.45)) < 0.09) c = vec3(0.95);
            if (wx > 13.0) { if (abs(ax - 0.22) < 0.08) c = vec3(0.98, 0.78, 0.15); if (abs(ax - hw * 0.5) < 0.08 && fract(p.y / 9.0) < 0.5) c = vec3(0.95); } else if (ax < 0.09 && fract(p.y / 8.0) < 0.55) c = vec3(0.98, 0.84, 0.25);
            float dc = abs(bz) - 0.0; if (bz > 0.0 && bz < 4.2 && bz > 0.6) { if (fract(p.x / 1.1) < 0.55) c = vec3(0.96); }       // crosswalk
            if (bz > 4.3 && bz < 4.75) c = vec3(0.96);                                                                              // stop line
          } else {
            float az = abs(p.y - cz), hw = wz * 0.5;
            if (abs(az - (hw - 0.45)) < 0.09) c = vec3(0.95);
            if (wz > 13.0) { if (abs(az - 0.22) < 0.08) c = vec3(0.98, 0.78, 0.15); if (abs(az - hw * 0.5) < 0.08 && fract(p.x / 9.0) < 0.5) c = vec3(0.95); } else if (az < 0.09 && fract(p.x / 8.0) < 0.55) c = vec3(0.98, 0.84, 0.25);
            if (bx > 0.6 && bx < 4.2) { if (fract(p.y / 1.1) < 0.55) c = vec3(0.96); }
            if (bx > 4.3 && bx < 4.75) c = vec3(0.96);
          }
        } else if (min(bx, bz) < 4.2 && !outside) { c = walk(p); if (min(bx, bz) < 0.3) c = vec3(0.70, 0.70, 0.68); }
        else if (outside) { c = walk(p) * 0.98; }
        else {
          c = vec3(0.74, 0.74, 0.72) * (0.94 + 0.06 * rn(p * 0.5));                                       // building lots (mostly hidden under buildings)
          for (int i = 0; i < ${parks.length}; i++) if (inR(uPark[i], p)) { c = mix(vec3(0.38, 0.72, 0.28), vec3(0.45, 0.80, 0.33), rn(p * 0.3)); vec4 r = uPark[i]; vec2 m = (r.xy + r.zw) * 0.5; float dpath = min(abs(p.x - m.x), abs(p.y - m.y)); if (dpath < 1.6 || abs(length(p - m) - 12.0) < 1.4) c = vec3(0.86, 0.80, 0.66); }
          for (int i = 0; i < ${lots.length}; i++) if (inR(uLot[i], p)) { c = asphalt(p); if (fract(p.x / 2.8) < 0.04 && fract((p.y - uLot[i].y) / 12.0) < 0.42) c = vec3(0.95); }
          if (inR(uPlaza, p)) { vec2 g = fract(p / 2.0); c = mix(vec3(0.86, 0.80, 0.70), vec3(0.75, 0.68, 0.58), step(0.5, abs(g.x - g.y))); }
        }
        diffuseColor.rgb = c;
      }`);
  };
  m.customProgramCacheKey = () => 'city-ground-v1';
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, 1, 1); g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, 0.035, (z0 + z1) / 2);
  const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true; mesh.name = 'CityGround'; mesh.userData.grid = { xs, zs, xw, zw, parks, lots, plaza }; return mesh;
}
