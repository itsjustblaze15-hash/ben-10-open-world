// NATURE: forests (dense stands + clearings), foothill woods, mountain pines with snowy tops above the tree line, desert cacti / dry brush / red boulders / shacks / the
// natural arch, beach palms, islet trees, underwater seaweed + rocks, fallen logs, the mountain stream and the waterfall. Everything is placed on the real terrain, off the roads and out of the water.
import * as THREE from 'three';
import { SEA, STREAM, FALLS, TARN, POI, makeNoise, resample } from './layout.js';
import { REGION_IDS } from './terrain_gen.js';

export function buildNature(world, B, D, T) {
  const N = makeNoise(9091), rnd = N.rnd, TR = world.terrain, spawns = [];
  const at = (x, z) => { const i = Math.round((x - T.x0) / T.cell), j = Math.round((z - T.z0) / T.cell); return j * T.nx + i; };
  const ok = (x, z, o = {}) => { const k = at(x, z); if (k < 0 || k >= T.H.length) return false; if (T.DL[k] < (o.shore ?? 4)) return false; if (T.RM[k] > (o.road ?? 0.04)) return false; if (TR.slope(x, z) > (o.slope ?? 1.0)) return false; return true; };
  const reg = (x, z) => REGION_IDS[T.RG[at(x, z)]];
  // ---- forests + foothills + mountains (jittered grid)
  const step = 8;
  for (let z = -880; z < 320; z += step) for (let x = -1000; x < 200; x += step) {
    const px = x + (rnd() - 0.5) * step * 0.9, pz = z + (rnd() - 0.5) * step * 0.9, r = reg(px, pz);
    if (r !== 'forest' && r !== 'foothills' && r !== 'mountains') continue;
    if (!ok(px, pz, { slope: r === 'mountains' ? 0.85 : 1.0 })) continue;
    const y = TR.height(px, pz), dens = N.fbm(px * 0.008 + 3, pz * 0.008, 3);            // clearings where the noise is low
    if (r === 'mountains') {
      if (y > 150) continue; const p = (y < 110 ? 0.32 : 0.12) * (dens > -0.05 ? 1 : 0.3); if (rnd() > p) continue;
      D.add(y > 108 ? 'pineSnow' : 'pine', px, y - 0.2, pz, rnd() * 6.28, { scale: 0.9 + rnd() * 0.8, collider: [0.8, 7, 0.8], kind: 'tree', dist: 1300 });
      if (rnd() < 0.08) D.add('rock', px + 3, TR.height(px + 3, pz) - 0.3, pz, rnd() * 6, { scale: 1 + rnd() * 2, collider: true, kind: 'rock', dist: 900 });
      continue;
    }
    const p = r === 'forest' ? (dens > 0.08 ? 0.72 : dens > -0.12 ? 0.32 : 0.05) : (dens > 0.0 ? 0.45 : 0.12); if (rnd() > p) { if (rnd() < 0.04) D.add(rnd() < 0.5 ? 'bush' : 'rock', px, y - 0.1, pz, rnd() * 6, { scale: 0.8 + rnd(), dist: 450, shadow: false }); continue; }
    const pine = y > 26 ? rnd() < 0.7 : rnd() < 0.3;
    D.add(pine ? 'pine' : (rnd() < 0.5 ? 'broadleaf' : 'broadleaf2'), px, y - 0.2, pz, rnd() * 6.28, { scale: 1.0 + rnd() * 0.9, collider: [0.8, 7, 0.8], kind: 'tree', dist: 1300 });
    if (rnd() < 0.02 && ok(px + 4, pz)) D.add('log', px + 4, TR.height(px + 4, pz) - 0.1, pz, rnd() * 6, { collider: [5, 0.9, 1], kind: 'log', small: true, dist: 500 });
  }
  // ---- desert
  for (let z = -260; z < 420; z += 14) for (let x = 60; x < 780; x += 14) {
    const px = x + (rnd() - 0.5) * 12, pz = z + (rnd() - 0.5) * 12; if (reg(px, pz) !== 'desert' || !ok(px, pz, { slope: 0.7 })) continue; const y = TR.height(px, pz), u = rnd();
    if (u < 0.05) D.add('cactus', px, y - 0.1, pz, rnd() * 6, { scale: 0.8 + rnd() * 0.6, collider: [1.2, 4, 1.2], kind: 'cactus', dist: 900 });
    else if (u < 0.12) D.add('dryBush', px, y - 0.1, pz, rnd() * 6, { scale: 0.8 + rnd() * 0.8, dist: 500, shadow: false });
    else if (u < 0.14) D.add('rockRed', px, y - 0.4, pz, rnd() * 6, { scale: 1.2 + rnd() * 2.6, collider: true, kind: 'rock', small: true, dist: 1000 });
    else if (u < 0.15) spawns.push({ kind: 'rock', x: px, z: pz, r: 0.6 + rnd() * 0.7 });
  }
  for (const [x, z, yaw] of [[520, 64, 0.4], [536, 80, 1.9], [300, 230, 2.6], [610, 160, -0.6], [470, -60, 1.2]]) { const y = TR.height(x, z); D.add('shack', x, y, z, yaw, { collider: [5.4, 3.3, 4.4], kind: 'shack', small: false, dist: 900 }); spawns.push({ kind: 'barrel', x: x + 4, z: z + 2 }); }
  { const a = POI.find(p => p.id === 'arch'), y = TR.height(a.x, a.z) - 1; D.add('arch', a.x, y, a.z, 0.3, { dist: 2200 });
    const c = Math.cos(0.3), s = Math.sin(0.3); for (const sx of [-1, 1]) { const px = a.x + sx * 18 * c, pz = a.z - sx * 18 * s; world.addStatic(new THREE.Vector3(px - 4, y, pz - 4.5), new THREE.Vector3(px + 4, y + 9, pz + 4.5), { kind: 'arch' }); }
    world.addStatic(new THREE.Vector3(a.x - 9, y + 15.5, a.z - 5), new THREE.Vector3(a.x + 9, y + 22, a.z + 5), { kind: 'arch' }); }
  // ---- beach palms (sand within ~45 m of the water), south + suburb coast
  for (let z = 250; z < 680; z += 10) for (let x = -900; x < 720; x += 10) {
    const px = x + (rnd() - 0.5) * 8, pz = z + (rnd() - 0.5) * 8, k = at(px, pz), dl = T.DL[k], r = reg(px, pz); if (dl < 10 || dl > 50) continue; if (r !== 'beach' && r !== 'suburb') continue;
    if (!ok(px, pz, { shore: 10, slope: 0.6 }) || rnd() > (r === 'beach' ? 0.16 : 0.05)) continue; D.add('palm', px, TR.height(px, pz) - 0.1, pz, rnd() * 6, { scale: 0.85 + rnd() * 0.4, collider: [0.7, 8, 0.7], kind: 'tree', dist: 1200 });
  }
  // ---- islets: a few trees and rocks
  for (let k = 0; k < 900; k++) { const x = -1100 + rnd() * 2100, z = -1000 + rnd() * 1900; const kk = at(x, z); if (kk < 0 || kk >= T.H.length || T.DL[kk] < 2) continue; if (T.H[kk] < 1.2) continue;
    const r = reg(x, z); const inMain = x > -980 && x < 780 && z > -840 && z < 680 && Math.hypot(x + 100, z + 60) < 900; if (inMain && r !== 'beach') continue;
    if (!inMain && rnd() < 0.25) D.add(rnd() < 0.5 ? 'pine' : 'palm', x, TR.height(x, z) - 0.2, z, rnd() * 6, { scale: 0.8 + rnd() * 0.5, dist: 1500 }); }
  // ---- underwater: seaweed + rocks in the bay / along the shores (Ripjaws' playground)
  for (let k = 0; k < 2600; k++) {
    const x = -950 + rnd() * 1750, z = -900 + rnd() * 1650, kk = at(x, z); if (kk < 0 || kk >= T.H.length) continue; const d = SEA - T.H[kk]; if (d < 1.5 || d > 16) continue;
    if (rnd() < 0.75) D.add('seaweed', x, T.H[kk] - 0.1, z, rnd() * 6, { scale: 0.8 + rnd() * 1.4, dist: 160, shadow: false });
    else D.add('rock', x, T.H[kk] - 0.3, z, rnd() * 6, { scale: 0.8 + rnd() * 1.8, collider: true, kind: 'rock', small: true, dist: 300, shadow: false });
  }
  // ---- the mountain stream + the waterfall into the forest lake
  buildStream(world, TR);
  return { spawns };
}

function waterMat(uScroll = 1.2) {
  const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uTime: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `uniform float uTime; varying vec2 vUv; float h(vec2 p){ vec3 p3=fract(vec3(p.xyx)*0.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
      void main(){ float v = vUv.y * 3.0 - uTime * ${uScroll.toFixed(2)}; float s = sin(v * 6.0 + sin(vUv.x * 9.0) * 1.5) * 0.5 + 0.5; float f = step(0.86, fract(v * 1.7 + h(floor(vec2(vUv.x * 8.0, v * 3.0)))));
        vec3 c = mix(vec3(0.24, 0.66, 0.86), vec3(0.62, 0.90, 0.98), s * 0.6); c = mix(c, vec3(1.0), f * 0.7 + (1.0 - smoothstep(0.0, 0.12, min(vUv.x, 1.0 - vUv.x))) * 0.5); gl_FragColor = vec4(c, 0.88);
        #include <colorspace_fragment>
      }` });
  return m;
}
function buildStream(world, TR) {
  const pts = resample(STREAM.pts, 4), n = pts.length, pos = [], uv = [], idx = []; let along = 0;
  for (let i = 0; i < n; i++) { const [x, z] = pts[i], [px, pz] = pts[Math.max(0, i - 1)], [nx, nz] = pts[Math.min(n - 1, i + 1)]; if (i) along += Math.hypot(x - px, z - pz); let dx = nx - px, dz = nz - pz; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    for (const s of [-1, 1]) { const vx = x - dz * s * STREAM.w * 0.42, vz = z + dx * s * STREAM.w * 0.42; pos.push(vx, Math.max(TR.height(vx, vz), TR.height(x, z)) + 0.35, vz); uv.push(s < 0 ? 0 : 1, along / 20); }
    if (i) { const a = (i - 1) * 2, b = i * 2; idx.push(a, b, a + 1, a + 1, b, b + 1); } }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  const sm = waterMat(1.4), stream = new THREE.Mesh(g, sm); stream.renderOrder = 2; world.scene.add(stream);
  // waterfall: a curved sheet from the end of the stream down to the lake + a foam ring at the bottom
  const top = TR.height(FALLS.x, FALLS.z) + 0.8, bot = SEA, fg = new THREE.PlaneGeometry(9, Math.max(4, top - bot), 1, 8); fg.translate(0, (top + bot) / 2, 0);
  const fm = waterMat(2.4), fall = new THREE.Mesh(fg, fm); fall.position.set(FALLS.x - 3, 0, FALLS.z + 4); fall.rotation.y = 0.5; fall.renderOrder = 2; world.scene.add(fall);
  const foam = new THREE.Mesh(new THREE.RingGeometry(1, 6, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false })); foam.rotation.x = -Math.PI / 2; foam.position.set(FALLS.x - 3, SEA + 0.06, FALLS.z + 6); world.scene.add(foam);
  world.animated = world.animated || []; world.animated.push((dt) => { sm.uniforms.uTime.value += dt; fm.uniforms.uTime.value += dt; foam.rotation.z += dt * 0.3; });
}
