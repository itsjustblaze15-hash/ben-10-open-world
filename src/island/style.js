// CARTOON STYLE KIT for the island: one toon ramp, cached toon materials, a soft rim light, inverted-hull outlines for instanced meshes,
// and the procedural BUILDING material (windows / storefronts / parapets / doors drawn in the shader from each instance's real size, so one instanced box = one detailed facade).
import * as THREE from 'three';
import { RAMP } from './terrain.js';

const cache = new Map();
/** V30: shared night factor (0 day .. 1 full night) driving the lit windows of every building; set by DayNight */
export const NIGHT = { value: 0 };
/** shared toon material per colour (+ options) */
export function toon(color, o = {}) {
  const key = color + JSON.stringify(o); let m = cache.get(key); if (m) return m;
  m = new THREE.MeshToonMaterial({ color, gradientMap: RAMP, ...o }); addRim(m); cache.set(key, m); return m;
}
/** soft rim light on a toon / standard material (keeps any existing onBeforeCompile) */
export function addRim(m, k = 0.22) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `{ vec3 nV = normalize(normal); float rimK = pow(1.0 - clamp(dot(nV, normalize(vViewPosition)), 0.0, 1.0), 3.0); outgoingLight += vec3(1.0, 0.98, 0.92) * rimK * ${k.toFixed(2)}; }\n#include <opaque_fragment>`);
  };
  const key0 = m.customProgramCacheKey ? m.customProgramCacheKey.bind(m) : () => ''; m.customProgramCacheKey = () => key0() + '|rim' + k; return m;
}
/** inverted-hull outline for an InstancedMesh (same geometry, back faces pushed out along the normal; width grows a little with distance) */
export function outlineFor(inst, color = 0x26283a, width = 0.06) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uW: { value: width }, fogColor: { value: new THREE.Color() }, fogNear: { value: 1 }, fogFar: { value: 2 } }, side: THREE.BackSide, fog: true,
    vertexShader: `uniform float uW; varying float vFogDepth;
      void main(){ vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0); vec3 wn = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        float d = length(cameraPosition - wp.xyz); wp.xyz += wn * (uW + d * 0.0016); vec4 mv = viewMatrix * wp; vFogDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform vec3 fogColor; uniform float fogNear; uniform float fogFar; varying float vFogDepth;
      void main(){ float f = smoothstep(fogNear, fogFar, vFogDepth); gl_FragColor = vec4(mix(uColor, fogColor, f), 1.0); if (f > 0.97) discard;
      #include <colorspace_fragment>
      }`,
  });
  const o = new THREE.InstancedMesh(inst.geometry, mat, inst.count); o.instanceMatrix = inst.instanceMatrix; o.frustumCulled = inst.frustumCulled; o.castShadow = false; o.receiveShadow = false; o.matrixAutoUpdate = false; o.matrix.copy(inst.matrix); o.renderOrder = -1;
  return o;
}

// ------------------------------------------------------------------------------------------------ buildings
// style ids: 0 glass office tower, 1 apartment, 2 shop row (storefront ground floor), 3 warehouse / factory, 4 house, 5 lab, 6 plain (garage / kiosk)
export const BSTYLE = { TOWER: 0, APARTMENT: 1, SHOP: 2, WAREHOUSE: 3, HOUSE: 4, LAB: 5, PLAIN: 6 };
export function buildingMaterial() {
  const m = new THREE.MeshToonMaterial({ gradientMap: RAMP, vertexColors: false });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = NIGHT;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      attribute vec4 aStyle; attribute float aDmg; flat varying float vDm; varying vec3 vLP; varying vec3 vLN; varying vec3 vSz; flat varying vec4 vSt;`).replace('#include <begin_vertex>', `#include <begin_vertex>
      { vec3 iS = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz)); vSz = iS; vLP = position * iS; vLN = normal; vSt = aStyle; vDm = aDmg; }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vLP; varying vec3 vLN; varying vec3 vSz; flat varying vec4 vSt; flat varying float vDm; uniform float uNight; vec3 gEmit = vec3(0.0);
      float bh(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      vec3 litWin(vec2 cell, float seed, vec3 tint){ float r = bh(cell * 1.37 + seed + 9.1), o = bh(cell + seed + 3.3); float on = step(0.28, o) * step(r * 0.85 + 0.05, uNight); float tv = step(0.92, bh(cell + seed * 2.0)); return on * mix(tint, vec3(0.55, 0.75, 1.0), tv) * (0.6 + 0.25 * bh(cell + 4.0)); }
      vec3 glass(vec2 cell, float vy, float seed){ float r = bh(cell + seed); vec3 g = mix(vec3(0.38, 0.63, 0.86), vec3(0.62, 0.84, 0.97), vy); g = mix(g, vec3(0.25, 0.42, 0.62), step(0.82, r) * 0.6); g += step(0.94, r) * vec3(0.35, 0.3, 0.12); return g; }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        float st = floor(vSt.x + 0.5), fh = vSt.y, ws = vSt.z, seed = floor(vSt.w + 0.5); vec3 wall = diffuseColor.rgb;
        vec3 n = vLN; float H = vSz.y, y = vLP.y;
        if (abs(n.y) > 0.5) {                                   // roof
          if (n.y > 0.0) { float ex = min(min(vLP.x + vSz.x * 0.5, vSz.x * 0.5 - vLP.x), min(vLP.z + vSz.z * 0.5, vSz.z * 0.5 - vLP.z)); vec3 roof = st == 4.0 ? wall * 0.55 : mix(vec3(0.55, 0.56, 0.6), wall, 0.15); diffuseColor.rgb = ex < 0.55 ? wall * 0.72 : roof * (0.92 + 0.08 * bh(floor(vLP.xz * 0.5))); }
          else diffuseColor.rgb = wall * 0.5;
          if (vDm > 0.02 && n.y > 0.0) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.12, 0.11, 0.11) * (0.7 + 0.3 * bh(floor(vLP.xz * 1.5))), min(vDm / 3.0, 1.0));
        } else {
          float u = abs(n.x) > 0.5 ? vLP.z + vSz.z * 0.5 : vLP.x + vSz.x * 0.5; float L = abs(n.x) > 0.5 ? vSz.z : vSz.x; bool front = n.z > 0.5;
          float faceSeed = seed + (n.x > 0.5 ? 1.7 : n.x < -0.5 ? 3.1 : n.z > 0.5 ? 5.3 : 7.9);
          vec3 c = wall;
          float par = H - 0.7;                                   // parapet band
          if (st == 0.0) {                                       // glass curtain wall: vertical mullions, horizontal spandrels
            float cu = fract(u / ws), cv = fract(y / fh); vec2 cell = vec2(floor(u / ws), floor(y / fh));
            bool mull = cu < 0.08 || cu > 0.92; bool spand = cv < 0.16;
            c = mull ? wall * 0.85 : spand ? wall * 0.95 : glass(cell, cv, faceSeed);
            if (!mull && !spand && y > fh * 1.2) gEmit = litWin(cell, faceSeed, vec3(1.0, 0.9, 0.62));
            if (y < fh * 1.2) c = (cu < 0.05 || cu > 0.95) ? wall * 0.6 : mix(vec3(0.20, 0.30, 0.38), vec3(0.45, 0.6, 0.7), cv);
          } else if (st == 3.0) {                                // warehouse: corrugated panels, a band of high windows, a big roller door on the front
            float rib = step(0.5, fract(u / 0.9)); c = wall * (0.9 + 0.1 * rib);
            if (y > H - 2.6 && y < H - 1.4 && fract(u / ws) > 0.15 && fract(u / ws) < 0.85) { c = glass(vec2(floor(u / ws), 0.0), 0.5, faceSeed) * 0.9; gEmit = litWin(vec2(floor(u / ws), 0.0), faceSeed, vec3(1.0, 0.95, 0.7)) * 0.9; }
            if (front && abs(u - L * 0.5) < min(4.0, L * 0.3) && y < min(5.0, H * 0.7)) c = vec3(0.62, 0.64, 0.66) * (0.86 + 0.14 * step(0.5, fract(y / 0.45)));
            if (y < 0.5) c = wall * 0.6;
          } else if (st == 4.0) {                                // house: two rows of windows, a door + porch light on the front
            float cu = fract(u / ws), row = floor(y / fh), cv = fract(y / fh);
            bool win = cu > 0.3 && cu < 0.7 && cv > 0.32 && cv < 0.78 && row < 2.0 && y < H - 0.4;
            c = win ? glass(vec2(floor(u / ws), row), cv, faceSeed) : wall;
            if (win) gEmit = litWin(vec2(floor(u / ws), row), faceSeed, vec3(1.0, 0.8, 0.45));
            if (front && abs(u - L * 0.5 - 0.95) < 0.13 && abs(y - 2.35) < 0.13) gEmit = vec3(1.0, 0.82, 0.45) * 1.8 * step(0.2, uNight);
            if (win && (abs(cu - 0.5) < 0.025 || abs(cv - 0.55) < 0.025)) c = vec3(0.95);
            if (front && abs(u - L * 0.5) < 0.55 && y < 2.15) c = vec3(0.55, 0.32, 0.18) * (y > 2.05 ? 0.6 : 1.0);
            if (y < 0.35) c = wall * 0.7;
          } else if (st == 5.0) {                                // lab: white panels, glass ribbons, a green stripe
            float cv = fract(y / fh); bool rib = cv > 0.45 && cv < 0.85; c = rib ? glass(vec2(floor(u / 6.0), floor(y / fh)), cv, faceSeed) * vec3(0.8, 1.0, 0.95) : wall;
            if (rib) gEmit = vec3(0.55, 1.0, 0.9) * uNight * 0.95;
            if (abs(y - fh * 1.0 - 0.1) < 0.18) gEmit = vec3(0.2, 1.0, 0.45) * uNight * 0.8;
            if (abs(y - fh * 1.0 - 0.1) < 0.18) c = vec3(0.18, 0.78, 0.38);
            if (fract(u / 3.0) < 0.03) c *= 0.85;
          } else if (st == 6.0) { c = wall * (0.94 + 0.06 * step(0.5, fract(y / 0.6))); if (y < 0.4) c = wall * 0.65; }
          else {                                                 // apartments (1) and shops (2): punched windows, ledges; shops get storefronts + an awning stripe
            float cu = fract(u / ws), cv = fract(y / fh); vec2 cell = vec2(floor(u / ws), floor(y / fh));
            bool win = cu > 0.2 && cu < 0.8 && cv > 0.28 && cv < 0.8 && y > fh;
            c = win ? glass(cell, cv, faceSeed) : wall;
            if (win) gEmit = litWin(cell, faceSeed, vec3(1.0, 0.82, 0.5));
            if (win && abs(cu - 0.5) < 0.02) c = wall * 1.1;
            if (!win && cv < 0.08 && y > fh) c = wall * 0.82;   // floor ledge
            if (st == 1.0 && win && cv < 0.36) c = wall * 0.6;  // balcony rail line
            if (y < fh) {                                       // ground floor
              if (st == 2.0) { float su = fract(u / 6.0); bool door = su > 0.42 && su < 0.58 && y < 2.4; bool shop = su > 0.08 && su < 0.92 && y > 0.5 && y < fh - 0.9;
                c = door ? vec3(0.25, 0.3, 0.36) : shop ? mix(vec3(0.3, 0.45, 0.55), vec3(0.7, 0.86, 0.95), (y - 0.5) / (fh - 1.4)) : wall * 0.85;
                if (shop) gEmit = vec3(1.0, 0.88, 0.62) * uNight * (0.05 + 0.09 * bh(vec2(floor(u / 6.0), faceSeed))) * step(0.15, bh(vec2(floor(u / 6.0) + 2.0, faceSeed)));
                if (y > fh - 0.85 && y < fh - 0.25) { float hue = bh(vec2(floor(u / 6.0), faceSeed)); c = mix(vec3(0.85, 0.22, 0.2), mix(vec3(0.2, 0.55, 0.85), vec3(0.95, 0.7, 0.15), step(0.5, hue)), step(0.33, hue)) * (0.85 + 0.15 * step(0.5, fract(u / 0.6))); } }
              else { bool lob = front && abs(u - L * 0.5) < 2.0 && y < 3.0; c = lob ? vec3(0.28, 0.36, 0.44) : wall * 0.88; }
            }
          }
          if (y > par && st != 4.0) c = wall * 0.75;          // parapet
          if (u < 0.12 || u > L - 0.12) c *= 0.82;              // corner trim
          if (vDm > 0.02) {                                     // V30 damage: soot, cracks, blown-out windows, breaches (stage = vDm, 0..4)
            vec2 dc = vec2(u, y); float soot = smoothstep(0.0, 1.0, bh(floor(dc * 0.35) + faceSeed) * 0.6 + 0.4 * (1.0 - y / max(H, 1.0))) * min(vDm / 2.0, 1.0);
            c = mix(c, c * vec3(0.32, 0.30, 0.30), soot * 0.75);
            float cr = abs(fract((u + y * 0.7) * 0.31 + bh(floor(dc * 0.12) + faceSeed) * 3.0) - 0.5); c = mix(c, vec3(0.06), step(cr, 0.012 + 0.006 * vDm) * step(0.9, bh(floor(dc * 0.25) + faceSeed + 2.0) + vDm * 0.12) * step(0.5, vDm));
            float hl = bh(floor(dc * vec2(0.22, 0.2)) + faceSeed * 3.0); float hr = bh(floor(dc * vec2(0.7, 0.6)) + faceSeed); float br = step(1.0 - 0.07 * max(vDm - 1.0, 0.0), hl) * step(0.25 + 0.1 * vDm, hr);
            c = mix(c, vec3(0.05, 0.045, 0.045), br); gEmit *= 1.0 - max(br, step(1.0 - 0.18 * vDm, bh(floor(dc * 0.5) + faceSeed))); }
          diffuseColor.rgb = c;
        }
      }`).replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance += gEmit;`);
  };
  m.customProgramCacheKey = () => 'island-building-v4'; addRim(m, 0.18); return m;
}

/** helper: matrices for axis-aligned boxes (base at y0) */
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
export function boxMatrix(x, y0, z, w, h, d, yaw = 0) { _p.set(x, y0, z); _s.set(w, h, d); _q.setFromEuler(_e.set(0, yaw, 0)); return _m.compose(_p, _q, _s).clone(); }
export function unitBox() { const g = new THREE.BoxGeometry(1, 1, 1); g.translate(0, 0.5, 0); return g; }
