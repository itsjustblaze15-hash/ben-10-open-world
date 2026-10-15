// Ripjaws rig. The supplied GLB (ripjaws_ben_10 (1).glb) is a STATIC model: 5 meshes, 2 materials, NO skeleton, NO skin, NO animation clips, NO morph targets
// (verified by inspecting the file). To animate it we attach a runtime bone hierarchy and compute skin weights from the vertex positions.
// Vertex positions / normals / UVs / materials / textures are NOT edited: the node transform is baked into the vertices (a rigid change of units only) and each mesh only gains
// skinIndex / skinWeight attributes. Everything below is expressed in "mesh units" (mu, the model is ~8 mu tall, +Y up, faces +Z, character-left = +X).
//
// The model's pieces are separate connected components, which makes the skinning clean:
//   mesh1 "body"  : torso + head + teeth + black loin-cloth / tail-flap + the four-clawed fingers + toe-nails + the black shoulder pad
//   mesh2         : the two arms, the pelvis + legs (+ the inner lining of the loin-cloth) and the green dorsal fin
//   mesh0         : the Omnitrix symbol (on the shoulder pad)      mesh3: antenna bulb      mesh4: the two eyes
// There is no lower-jaw mesh: the jaw is skinned from the head mesh with a plane through the (permanently open) mouth, so the lower teeth + chin can hinge.
import * as THREE from 'three';
import { FaPoser } from './fourarmsrig.js';

export const RJ_SCALE = 0.32;                 // metres per mesh unit (7.97 mu antenna tip -> 2.55 m)
export const RJ_MU = 1 / RJ_SCALE;

// ----------------------------------------------------------------------------------- joint tree (left side listed, right side mirrored)
// [name, parent, [x,y,z], sided]
const TREE = [
  ['hips',  null,    [0, 3.45, -0.12]],
  ['spine', 'hips',  [0, 4.15, -0.12]],
  ['chest', 'spine', [0, 4.95, -0.08]],
  ['neck',  'chest', [0, 5.95, -0.02]],
  ['head',  'neck',  [0, 6.40, 0.05]],
  ['jaw',   'head',  [0, 6.62, 0.14]],
  ['ant0',  'head',  [0, 7.62, 0.85]],
  ['ant1',  'ant0',  [0, 7.80, 1.40]],
  ['fin0',  'spine', [0, 4.60, -0.60]],
  ['fin1',  'chest', [0, 5.50, -0.75]],
  ['fin2',  'neck',  [0, 6.40, -0.45]],
  ['skA',   'hips',  [0, 3.05, -0.15]],
  ['skB',   'skA',   [0, 2.00, -0.15]],
  ['skC',   'skB',   [0, 1.00, -0.15]],
  ['uarm',  'chest', [1.05, 5.85, -0.20], true],
  ['farm',  'uarm',  [1.35, 4.65, -0.25], true],
  ['hand',  'farm',  [1.65, 3.30, 0.15], true],
  ['fing',  'hand',  [1.70, 2.85, 0.50], true],
  ['thigh', 'hips',  [0.60, 3.30, -0.10], true],
  ['knee',  'thigh', [0.85, 2.00, -0.20], true],
  ['ankle', 'knee',  [0.85, 0.42, -0.40], true],
  ['toe',   'ankle', [1.05, 0.12, 0.35], true],
];
const MARK = [   // [name, parent, pos, sided]
  ['mouth',  'head', [0, 6.92, 1.30]],
  ['jawTip', 'jaw',  [0, 6.72, 1.40]],
  ['tail',   'skC',  [0, 0.30, -0.15]],
  ['claw',   'fing', [1.70, 2.15, 0.95], true],
  ['heel',   'ankle', [0.85, 0.05, -0.55], true],
  ['tip',    'toe',  [1.30, 0.04, 0.80], true],
];
export const RJ_REST = {};   // name -> mu position (left side, sided names get L/R suffix)

const side = (n, sgn) => n + (sgn > 0 ? 'L' : 'R');
const V3 = (a, sgn = 1) => new THREE.Vector3(a[0] * sgn, a[1], a[2]);

// ----------------------------------------------------------------------------------- skin weight segments
// [bone, a, b, exponent, sided]
const SEG = [
  ['hips',  [0, 3.20, -0.12], [0, 3.90, -0.12], 2.2],
  ['spine', [0, 3.90, -0.12], [0, 4.70, -0.10], 2.2],
  ['chest', [0, 4.70, -0.10], [0, 5.70, -0.05], 2.2],
  ['chest', [0.30, 5.85, -0.12], [0.95, 5.92, -0.16], 3, true],       // clavicle girdle: shoulder / pad skin follows the chest
  ['neck',  [0, 5.70, -0.05], [0, 6.40, 0.05], 2.4],
  ['head',  [0, 6.40, 0.05], [0, 7.20, 0.45], 2.4],
  ['uarm',  [1.05, 5.85, -0.20], [1.35, 4.65, -0.25], 3.4, true],
  ['farm',  [1.35, 4.65, -0.25], [1.65, 3.30, 0.15], 3.4, true],
  ['hand',  [1.65, 3.30, 0.15], [1.70, 2.85, 0.50], 3.4, true],
  ['fing',  [1.70, 2.85, 0.50], [1.70, 2.20, 0.90], 3.4, true],
  ['thigh', [0.60, 3.30, -0.10], [0.85, 2.00, -0.20], 3.6, true],
  ['knee',  [0.85, 2.00, -0.20], [0.85, 0.42, -0.40], 3.6, true],       // 'knee' bone = the shin segment
  ['ankle', [0.85, 0.42, -0.40], [1.05, 0.12, 0.35], 3.6, true],        // 'ankle' bone = the foot
  ['toe',   [1.05, 0.12, 0.35], [1.35, 0.05, 0.80], 3.6, true],
];
function segDist(p, a, b) { const ab = b.clone().sub(a), t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1); return p.distanceTo(a.clone().addScaledVector(ab, t)); }
const sstep = (x, a, b) => THREE.MathUtils.smoothstep(x, a, b);
const lerpN = THREE.MathUtils.lerp;

/** component classification (done once from the connectivity of each mesh: welded by position, union-find over the triangles) */
function components(geo) {
  const pos = geo.attributes.position, n = pos.count, idx = geo.index.array, parent = new Int32Array(n).map((_, i) => i);
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const key = new Map(), rep = new Int32Array(n);
  for (let i = 0; i < n; i++) { const k = Math.round(pos.getX(i) * 1e4) + ',' + Math.round(pos.getY(i) * 1e4) + ',' + Math.round(pos.getZ(i) * 1e4); if (key.has(k)) rep[i] = key.get(k); else { key.set(k, i); rep[i] = i; } }
  for (let t = 0; t < idx.length; t += 3) for (const [u, v] of [[idx[t], idx[t + 1]], [idx[t + 1], idx[t + 2]]]) { const a = find(rep[u]), b = find(rep[v]); if (a !== b) parent[a] = b; }
  const root = new Int32Array(n), cnt = new Map(), sum = new Map();
  for (let i = 0; i < n; i++) { const r = find(rep[i]); root[i] = r; cnt.set(r, (cnt.get(r) || 0) + 1); const s = sum.get(r) || [0, 0, 0]; s[0] += pos.getX(i); s[1] += pos.getY(i); s[2] += pos.getZ(i); sum.set(r, s); }
  return { root, cnt, centroid: r => { const s = sum.get(r), c = cnt.get(r); return [s[0] / c, s[1] / c, s[2] / c]; } };
}

export function buildRipjawsRig(gltfScene) {
  gltfScene.updateMatrixWorld(true);
  const modelGroup = new THREE.Group(); modelGroup.name = 'RipjawsModel';
  // ---- bones
  const bones = {}, absPos = {}, order = [];
  for (const [name, parent, pos, sided] of TREE) {
    for (const sgn of sided ? [1, -1] : [0]) {
      const bn = sided ? side(name, sgn) : name, b = new THREE.Bone(); b.name = bn;
      const abs = V3(pos, sgn || 1); absPos[bn] = abs; RJ_REST[bn] = abs.toArray();
      if (parent) { const pn = TREE.find(t => t[0] === parent)[3] ? side(parent, sgn) : parent; bones[pn].add(b); b.position.copy(abs).sub(absPos[pn]); } else { modelGroup.add(b); b.position.copy(abs); }
      bones[bn] = b; order.push(b);
    }
  }
  const markers = {};
  for (const [name, parent, pos, sided] of MARK) for (const sgn of sided ? [1, -1] : [0]) {
    const bn = sided ? side(name, sgn) : name, pn = TREE.find(t => t[0] === parent)[3] ? side(parent, sgn) : parent, o = new THREE.Object3D(); o.name = bn;
    const abs = V3(pos, sgn || 1); o.position.copy(abs).sub(absPos[pn]); bones[pn].add(o); markers[bn] = o; absPos[bn] = abs;
  }
  const boneIndex = {}; order.forEach((b, i) => { boneIndex[b.name] = i; });

  // ---- candidate segments (sided ones are duplicated for L / R)
  const segs = [];
  for (const [bone, a, b, ex, sided] of SEG) {
    if (sided) for (const sgn of [1, -1]) segs.push({ bone: side(bone, sgn), a: V3(a, sgn), b: V3(b, sgn), ex, side: sgn });
    else segs.push({ bone, a: V3(a), b: V3(b), ex, side: 0 });
  }
  const segsOf = (names) => segs.filter(s => names.includes(s.bone.replace(/[LR]$/, '')) || names.includes(s.bone));
  const p = new THREE.Vector3(), q = new THREE.Vector3();

  /** distance weights over a subset of segments -> sorted [index, weight] (top 4 normalised) */
  function distWeights(pt, list, sideOnly = 0, gate = null) {
    const cand = [];
    for (const s of list) {
      let w = 1 / (Math.pow(segDist(pt, s.a, s.b), s.ex) + 1e-4);
      if (s.side && sideOnly) w *= (s.side === sideOnly ? 1 : 1e-6);
      else if (s.side) w *= sstep(pt.x * s.side, -0.15, 0.2) * 0.999 + 0.001;
      if (gate) w *= gate(s);
      cand.push([boneIndex[s.bone], w]);
    }
    cand.sort((a, b) => b[1] - a[1]); return cand;
  }
  const put = (si, sw, i, cand) => { let tot = 0; const k = Math.min(4, cand.length); for (let j = 0; j < k; j++) tot += cand[j][1]; for (let j = 0; j < 4; j++) { si[i * 4 + j] = j < k ? cand[j][0] : 0; sw[i * 4 + j] = j < k ? cand[j][1] / tot : 0; } };
  const pure = (si, sw, i, bn) => { si[i * 4] = boneIndex[bn]; sw[i * 4] = 1; for (let j = 1; j < 4; j++) { si[i * 4 + j] = 0; sw[i * 4 + j] = 0; } };
  /** linear blend of a vertical chain of joints: returns [[bone, w],...] */
  const chain = (y, ys, names) => {
    if (y >= ys[0]) return [[names[0], 1]]; const n = ys.length; if (y <= ys[n - 1]) return [[names[n - 1], 1]];
    let i = 0; while (ys[i + 1] > y) i++; const u = (ys[i] - y) / (ys[i] - ys[i + 1]); return [[names[i], 1 - u], [names[i + 1], u]];
  };

  const spineSegs = segs.filter(s => ['hips', 'spine', 'chest', 'neck', 'head'].includes(s.bone) || (s.bone.startsWith('chest') && s.side));
  const bodySegs = segs.filter(s => /^(hips|spine|chest|neck|head|uarm)/.test(s.bone));
  const armSegsL = segs.filter(s => /^(uarm|farm|hand|fing)L$/.test(s.bone) || (s.bone === 'chestL')), armSegsR = segs.filter(s => /^(uarm|farm|hand|fing)R$/.test(s.bone) || (s.bone === 'chestR'));
  const legSegsL = segs.filter(s => /^(thigh|knee|ankle|toe)L$/.test(s.bone) || s.bone === 'hips'), legSegsR = segs.filter(s => /^(thigh|knee|ankle|toe)R$/.test(s.bone) || s.bone === 'hips');
  const hipSeg = segs.filter(s => s.bone === 'hips' || s.bone === 'spine');

  // plane through the (open) mouth that separates the lower jaw (+ lower teeth + chin) from the head. y_s(z): hinge height at the back of the mouth, 6.88 along the tooth rows.
  const jawPlane = z => lerpN(6.62, 6.88, THREE.MathUtils.clamp((z - 0.12) / 0.48, 0, 1));
  const jawWeight = (pt) => sstep(jawPlane(pt.z) - pt.y, -0.02, 0.10) * sstep(pt.y, 6.30, 6.46) * sstep(pt.z, 0.12, 0.46) * (1 - sstep(Math.abs(pt.x), 0.62, 0.8));

  const meshInfo = [];
  gltfScene.traverse(o => { if (o.isMesh) meshInfo.push(o); });
  const skinned = [], byIndex = [];
  // pass 1: bake geometry (mu) + classify components
  for (const o of meshInfo) {
    const geo = o.geometry.clone(); geo.applyMatrix4(o.matrixWorld); geo.scale(100, 100, 100);   // the node chain is exactly 0.01 x identity (checked at load): back to mesh units, a rigid change of units only
    byIndex.push({ o, geo });
  }
  const label = (mi, geo) => {
    const n = geo.attributes.position.count, lab = new Array(n).fill('');
    const nm = byIndex[mi].o.name;
    if (/^mesh0/.test(nm)) lab.fill('omnitrix'); else if (/^mesh3/.test(nm)) lab.fill('antennaTip'); else if (/^mesh4/.test(nm)) lab.fill('eye');
    else { const C = components(geo); for (let i = 0; i < n; i++) { const r = C.root[i], c = C.centroid(r), cnt = C.cnt.get(r);
      if (/^mesh1/.test(nm)) lab[i] = cnt > 5000 ? 'body' : cnt > 700 ? 'pad' : c[1] < 0.2 ? 'toenail' : 'claw';
      else lab[i] = cnt > 2500 ? 'legs' : cnt > 1400 ? (c[0] > 0 ? 'armL' : 'armR') : 'fin'; } }
    return lab;
  };
  const labels = byIndex.map((e, mi) => label(mi, e.geo));
  // pad weights are reused by the Omnitrix symbol (nearest pad vertex), so compute the pad first
  const padPts = [], padW = [];
  let omniMi = -1; byIndex.forEach((e, mi) => { if (/^mesh0/.test(e.o.name)) omniMi = mi; });

  function weightsFor(mi) {
    const geo = byIndex[mi].geo, lab = labels[mi], pos = geo.attributes.position, n = pos.count, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      p.fromBufferAttribute(pos, i); const L = lab[i];
      if (L === 'eye') { pure(si, sw, i, 'head'); continue; }
      if (L === 'antennaTip') { pure(si, sw, i, 'ant1'); continue; }
      if (L === 'omnitrix') continue;                                                                    // second pass
      if (L === 'claw') { const sd = p.x >= 0 ? 1 : -1; pure(si, sw, i, side('fing', sd)); continue; }
      if (L === 'toenail') { pure(si, sw, i, side('toe', p.x >= 0 ? 1 : -1)); continue; }
      let cand;
      if (L === 'armL' || L === 'armR') {
        const sd = L === 'armL' ? 1 : -1, list = sd > 0 ? armSegsL : armSegsR; cand = distWeights(p, list, sd);
        // the elbow / wrist / hand bands: smoother hand -> fingers ramp (fingers curl from y 3.0 down)
      } else if (L === 'pad') {
        cand = distWeights(p, bodySegs.filter(s => !s.bone.endsWith('R')), 1, s => /^uarm/.test(s.bone) ? 0.55 : 1);
      } else if (L === 'fin') {
        const wy = chain(p.y, [7.2, 6.4, 5.5, 4.6], ['head', 'fin2', 'fin1', 'fin0']); cand = wy.map(([b, w]) => [boneIndex[b], w]);
      } else if (L === 'legs') {
        const sd = p.x >= 0 ? 1 : -1, ax = Math.abs(p.x);
        if (ax < 0.42 && p.y < 3.3) { cand = chain(p.y, [3.5, 3.05, 2.0, 1.0, 0.3], ['hips', 'skA', 'skB', 'skC', 'skC']).map(([b, w]) => [boneIndex[b], w]); }   // inner lining of the loin-cloth
        else {
          cand = distWeights(p, sd > 0 ? legSegsL : legSegsR, sd);
          if (ax < 0.7 && p.y > 3.2) { cand = distWeights(p, [...(sd > 0 ? legSegsL : legSegsR)], sd); }
        }
      } else {                                                                                             // 'body' (mesh1 main component)
        if (p.y < 3.95) { cand = chain(p.y, [3.5, 3.05, 2.0, 1.0, 0.3], ['hips', 'skA', 'skB', 'skC', 'skC']).map(([b, w]) => [boneIndex[b], w]); }       // loin-cloth / tail flap
        else if (p.y > 7.55 && p.z > 0.82) {                                                                // antenna stalk: head -> ant0 -> ant1
          const u = THREE.MathUtils.clamp((p.z - 0.85) / 1.1, 0, 1), a0 = sstep(u, 0.0, 0.35) * (1 - sstep(u, 0.5, 0.95)), a1 = sstep(u, 0.45, 0.95), h = 1 - sstep(u, 0.0, 0.35);
          cand = [['head', h], ['ant0', a0], ['ant1', a1]].filter(c => c[1] > 1e-4).map(([b, w]) => [boneIndex[b], w]);
        } else {
          cand = distWeights(p, bodySegs, 0, s => /^uarm/.test(s.bone) ? 0.5 * sstep(Math.abs(p.x), 0.55, 0.95) : 1);
          const J = p.y > 6.3 ? jawWeight(p) : 0;
          if (J > 1e-3) { const tot = cand.reduce((a, c) => a + c[1], 0); cand = cand.map(([b, w]) => [b, w / tot * (1 - J)]); cand.push([boneIndex['jaw'], J]); cand.sort((a, b) => b[1] - a[1]); }
        }
      }
      cand = cand.filter(c => c[1] > 1e-9); if (!cand.length) cand = [[boneIndex['hips'], 1]];
      put(si, sw, i, cand);
      if (L === 'pad') { padPts.push(p.clone()); padW.push([si.slice(i * 4, i * 4 + 4), sw.slice(i * 4, i * 4 + 4)]); }
    }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    return { si, sw };
  }
  const W = byIndex.map((e, mi) => mi === omniMi ? null : weightsFor(mi));
  if (omniMi >= 0) {                                                                                         // Omnitrix symbol: copies the nearest shoulder-pad vertex so it never slides on the pad
    const geo = byIndex[omniMi].geo, pos = geo.attributes.position, n = pos.count, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { p.fromBufferAttribute(pos, i); let best = 0, bd = 1e9; for (let k = 0; k < padPts.length; k++) { const d = p.distanceToSquared(padPts[k]); if (d < bd) { bd = d; best = k; } } for (let j = 0; j < 4; j++) { si[i * 4 + j] = padW[best][0][j]; sw[i * 4 + j] = padW[best][1][j]; } }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  }
  void q;
  for (const { o, geo } of byIndex) {
    const sm = new THREE.SkinnedMesh(geo, o.material); sm.name = o.name; sm.frustumCulled = false; sm.castShadow = true; sm.receiveShadow = false; modelGroup.add(sm); skinned.push(sm);
  }
  modelGroup.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(order);
  for (const sm of skinned) sm.bind(skeleton, new THREE.Matrix4());

  // ---- rest data (model space = the modelGroup's local space; identity rest rotations)
  const allBones = order.slice(), inv = new THREE.Matrix4().copy(modelGroup.matrixWorld).invert(), info = new Map(), TM = new THREE.Matrix4();
  for (const b of allBones) { TM.copy(b.matrixWorld).premultiply(inv); const pp = new THREE.Vector3(), qq = new THREE.Quaternion(), ss = new THREE.Vector3(); TM.decompose(pp, qq, ss); info.set(b, { restLocalQ: b.quaternion.clone(), restLocalP: b.position.clone(), restModelQ: qq.clone(), restModelP: pp.clone(), scale: ss.clone() }); }
  const B = {}; for (const n of ['hips', 'spine', 'chest', 'neck', 'head', 'jaw', 'ant0', 'ant1', 'fin0', 'fin1', 'fin2', 'skA', 'skB', 'skC']) B[n] = bones[n];
  for (const s of ['L', 'R']) for (const n of ['thigh', 'knee', 'ankle', 'toe']) B[n + s] = bones[n + s];
  const arms = {};
  for (const [k, s] of [['UL', 'L'], ['UR', 'R']]) arms[k] = { sh: null, a: bones['uarm' + s], e: bones['farm' + s], w: bones['hand' + s], side: s === 'L' ? 1 : -1, fingers: [bones['fing' + s]] };
  const rest = {}; for (const k in B) rest[k] = info.get(B[k]).restModelP.clone();
  const restHand = {}; for (const k in arms) restHand[k] = info.get(arms[k].w).restModelP.clone();
  const lens = {}; for (const k in arms) { const r = arms[k]; lens[k] = { l1: info.get(r.a).restModelP.distanceTo(info.get(r.e).restModelP), l2: info.get(r.e).restModelP.distanceTo(info.get(r.w).restModelP) }; }
  const report = { meshes: skinned.map(s => s.name), verts: skinned.reduce((n, s) => n + s.geometry.attributes.position.count, 0), bones: allBones.length };
  return { modelGroup, scene: modelGroup, bones: B, arms, skinned, info, order: allBones, allBones, rest, restHand, lens, markers, boneByName: bones, report, mats: new Map(skinned.map(s => [s.material.name, s.material])) };
}

// ----------------------------------------------------------------------------------- pose driver (FK euler deltas in model space + 2-bone IK for arms AND legs)
const TMP = { q: new THREE.Quaternion(), q2: new THREE.Quaternion(), e: new THREE.Euler() };
export class RjPoser extends FaPoser {
  constructor(rig) {
    super(rig);
    for (const k in rig.bones) if (rig.bones[k]) this.keyOf.set(rig.bones[k], k);       // arms were registered after the bone keys; keep the plain bone names for chain bones
    for (const k in rig.arms) { const a = rig.arms[k]; this.keyOf.set(a.a, 'a' + k); this.keyOf.set(a.e, 'e' + k); this.keyOf.set(a.w, 'w' + k); }
    this.fingerSign = { UL: -1, UR: -1 };
    this.rig.arms.LL = { sh: null, a: rig.bones.thighL, e: rig.bones.kneeL, w: rig.bones.ankleL, side: 1, fingers: [] };      // legs reuse the arm solver (registered AFTER the key map is built)
    this.rig.arms.LR = { sh: null, a: rig.bones.thighR, e: rig.bones.kneeR, w: rig.bones.ankleR, side: -1, fingers: [] };
    this.legs = true;
  }
  apply(pose) {
    const R = this.rig, legsIK = pose.legs; super.apply(pose);
    if (legsIK) {
      const g = R.modelGroup, inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
      for (const [k, s] of [['LL', 'L'], ['LR', 'R']]) {
        const t = legsIK[s]; if (!t || !t.p) continue;
        this.ik(k, { p: t.p, pole: t.pole || new THREE.Vector3(0, 0, 1) });
        // flat foot: world orientation of the ankle = pitch about X only (the model's own toe-out is baked into the mesh); toe flexes about X
        const knee = R.bones['knee' + s], ankle = R.bones['ankle' + s], toe = R.bones['toe' + s];
        const km = new THREE.Matrix4().multiplyMatrices(inv, knee.matrixWorld), kq = new THREE.Quaternion(); km.decompose(new THREE.Vector3(), kq, new THREE.Vector3());
        TMP.e.set(t.pitch || 0, t.yaw || 0, t.roll || 0, 'YXZ'); ankle.quaternion.copy(kq.invert().multiply(TMP.q.setFromEuler(TMP.e)));
        toe.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), t.toe || 0); ankle.updateMatrixWorld(true);
      }
      g.updateMatrixWorld(true);
    }
  }
}
