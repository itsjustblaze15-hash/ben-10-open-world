// Kevin 11 rig. The supplied GLB (kevin_11_1.glb, "Kevin 11" by kidomni367) is a STATIC model: 2 meshes, 2 materials / 2 textures, NO skeleton, NO skin, NO animation clips
// (verified by inspecting the file). To animate him we attach a runtime bone hierarchy and compute skin weights from the vertex positions.
// Vertex positions / normals / UVs / materials / textures are NOT edited: the node transform (+ a rigid turn so he faces +Z, feet on y = 0, centred on x = 0) is baked into the
// vertices and each mesh only gains skinIndex / skinWeight attributes. His look is exactly the supplied model.
// Everything below is expressed in "mesh units" (mu): after the rigid re-orientation he is 1.65 mu tall (head top), the wings reach 2.5 mu, +Y up, faces +Z, his left = +X.
//
// Connected pieces of the two meshes (found by welding vertices, see tools/kcomp.py):
//   mesh0 "Object_2": body (torso, shorts, tail, the two ordinary arms with fists, the black back plate) · head · eye details
//   mesh1 "Object_3": the big FIRE arm (red, cream hand; his left, +X) · the big CRYSTAL arm (Diamondhead; his right, -X) · two legs · two wings · eyes
// The two big forward arms are the ones that carry his borrowed powers (fire = Heatblast arm, crystal = Diamondhead arm); the two ordinary arms throw the normal / heavy punches.
import * as THREE from 'three';

/** V8: Kevin stands exactly as tall as Four Arms. Measured in-game (skinned vertices, idle pose, feet on the floor): Four Arms top of head = 2.924 m; Kevin's head top at the old scale 1.5 = 2.563 m
 *  -> uniform factor 2.924 / 2.563 = 1.141 applied to the WHOLE model (legs, torso, arms, wings, tail, head scale together; nothing is stretched on its own). */
export const FA_STAND_H = 2.924, KV_BASE_H = 2.563, KV_SIZE = FA_STAND_H / KV_BASE_H;
export const KV_SCALE = 1.5 * KV_SIZE;          // metres per mesh unit -> 2.92 m body (head top), wings ~4.3 m, tail ~1.7 m
export const KV_MU = 1 / KV_SCALE;

// [name, parent, [x,y,z], sided]   sided: left (+x) listed, right mirrored
const TREE = [
  ['hips',  null,    [0, 0.90, 0.02]],
  ['spine', 'hips',  [0, 1.08, 0.03]],
  ['chest', 'spine', [0, 1.26, 0.05]],
  ['neck',  'chest', [0, 1.42, 0.05]],
  ['head',  'neck',  [0, 1.47, 0.07]],
  ['wing0', 'chest', [0.20, 1.56, -0.10], true],
  ['wing1', 'wing0', [0.45, 1.80, -0.33], true],
  ['wing2', 'wing1', [0.72, 2.30, -0.45], true],
  ['tail0', 'hips',  [0, 0.95, -0.20]],
  ['tail1', 'tail0', [0, 0.72, -0.40]],
  ['tail2', 'tail1', [0, 0.60, -0.62]],
  ['tail3', 'tail2', [0, 0.52, -0.82]],
  ['sa',    'chest', [0.38, 1.38, 0.00], true],         // ordinary arm: shoulder / elbow / wrist(fist)
  ['ea',    'sa',    [0.58, 1.02, -0.05], true],
  ['wa',    'ea',    [0.58, 0.82, 0.22], true],
  ['thigh', 'hips',  [0.24, 0.78, 0.06], true],
  ['knee',  'thigh', [0.27, 0.46, 0.17], true],
  ['ankle', 'knee',  [0.25, 0.17, 0.04], true],
  ['toe',   'ankle', [0.25, 0.04, 0.17], true],
  // the two big arms are not mirror images of each other
  ['bsL', 'chest', [0.40, 1.40, -0.08]], ['beL', 'bsL', [0.76, 1.27, 0.22]], ['bwL', 'beL', [0.92, 1.25, 0.50]], ['bhL', 'bwL', [1.02, 1.22, 0.64]],
  ['bsR', 'chest', [-0.40, 1.41, -0.10]], ['beR', 'bsR', [-0.70, 1.27, 0.20]], ['bwR', 'beR', [-0.80, 1.22, 0.50]], ['bhR', 'bwR', [-0.90, 1.15, 0.64]],
];
const MARK = [   // [name, parent, pos, sided]
  ['mouth',   'head',  [0, 1.395, 0.285]],
  ['fireTip', 'bhL',   [1.10, 1.20, 0.80]],
  ['crysTip', 'bhR',   [-1.0, 1.10, 0.78]],
  ['fistL',   'waL',   [0.58, 0.72, 0.30]],
  ['fistR',   'waR',   [-0.58, 0.72, 0.30]],
  ['wingTipL', 'wing2L', [0.93, 2.50, -0.60]],
  ['wingTipR', 'wing2R', [-0.93, 2.50, -0.60]],
  ['tailTip', 'tail3', [0, 0.43, -1.0]],
  ['heelL',   'ankleL', [0.25, 0.03, -0.06]], ['heelR', 'ankleR', [-0.25, 0.03, -0.06]],
  ['toeTipL', 'toeL',  [0.25, 0.02, 0.30]], ['toeTipR', 'toeR', [-0.25, 0.02, 0.30]],
  ['chestC',  'chest', [0, 1.28, 0.2]],
];
export const KV_REST = {};
const side = (n, sgn) => n + (sgn > 0 ? 'L' : 'R');
const V3 = (a, sgn = 1) => new THREE.Vector3(a[0] * sgn, a[1], a[2]);
const sstep = (x, a, b) => THREE.MathUtils.smoothstep(x, a, b);

// ----------------------------------------------------------------------------------- skin weight segments  [bone, a, b, exponent, sided]
const SEG = [
  ['hips',  [0, 0.78, 0.02], [0, 1.00, 0.03], 2.4],
  ['spine', [0, 1.00, 0.03], [0, 1.20, 0.05], 2.4],
  ['chest', [0, 1.20, 0.05], [0, 1.38, 0.05], 2.2],
  ['chest', [0.0, 1.40, 0.0], [0.36, 1.42, -0.02], 3, true],             // clavicle girdle: shoulder / back plate skin follows the chest
  ['neck',  [0, 1.38, 0.05], [0, 1.46, 0.07], 2.6],
  ['head',  [0, 1.46, 0.07], [0, 1.60, 0.14], 2.6],
  ['sa',    [0.38, 1.38, 0.00], [0.58, 1.02, -0.05], 3.4, true],
  ['ea',    [0.58, 1.02, -0.05], [0.58, 0.82, 0.22], 3.4, true],
  ['wa',    [0.58, 0.82, 0.22], [0.58, 0.68, 0.34], 3.4, true],
  ['thigh', [0.24, 0.78, 0.06], [0.27, 0.46, 0.17], 3.6, true],
  ['knee',  [0.27, 0.46, 0.17], [0.25, 0.17, 0.04], 3.6, true],
  ['ankle', [0.25, 0.17, 0.04], [0.25, 0.04, 0.17], 3.6, true],
  ['toe',   [0.25, 0.04, 0.17], [0.25, 0.02, 0.30], 3.6, true],
  ['tail0', [0, 0.95, -0.20], [0, 0.72, -0.40], 3.0],
  ['tail1', [0, 0.72, -0.40], [0, 0.60, -0.62], 3.0],
  ['tail2', [0, 0.60, -0.62], [0, 0.52, -0.82], 3.0],
  ['tail3', [0, 0.52, -0.82], [0, 0.43, -1.0], 3.0],
  ['wing0', [0.20, 1.56, -0.10], [0.45, 1.80, -0.33], 2.2, true],
  ['wing1', [0.45, 1.80, -0.33], [0.72, 2.30, -0.45], 2.2, true],
  ['wing2', [0.72, 2.30, -0.45], [0.93, 2.50, -0.60], 2.2, true],
  // big arms (explicit sides)
  ['bsL', [0.40, 1.40, -0.08], [0.76, 1.27, 0.22], 3.2, false, 1], ['beL', [0.76, 1.27, 0.22], [0.92, 1.25, 0.50], 3.2, false, 1], ['bwL', [0.92, 1.25, 0.50], [1.02, 1.22, 0.64], 3.2, false, 1], ['bhL', [1.02, 1.22, 0.64], [1.10, 1.20, 0.80], 3.2, false, 1],
  ['bsR', [-0.40, 1.41, -0.10], [-0.70, 1.27, 0.20], 3.2, false, -1], ['beR', [-0.70, 1.27, 0.20], [-0.80, 1.22, 0.50], 3.2, false, -1], ['bwR', [-0.80, 1.22, 0.50], [-0.90, 1.15, 0.64], 3.2, false, -1], ['bhR', [-0.90, 1.15, 0.64], [-1.0, 1.10, 0.78], 3.2, false, -1],
];
function segDist(p, a, b) { const ab = b.clone().sub(a), t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1); return p.distanceTo(a.clone().addScaledVector(ab, t)); }

/** connected components (welded by position) with bounding boxes */
function components(geo) {
  const pos = geo.attributes.position, n = pos.count, idx = geo.index.array, parent = new Int32Array(n).map((_, i) => i);
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const key = new Map(), rep = new Int32Array(n);
  for (let i = 0; i < n; i++) { const k = Math.round(pos.getX(i) * 1e4) + ',' + Math.round(pos.getY(i) * 1e4) + ',' + Math.round(pos.getZ(i) * 1e4); if (key.has(k)) rep[i] = key.get(k); else { key.set(k, i); rep[i] = i; } }
  for (let t = 0; t < idx.length; t += 3) for (const [u, v] of [[idx[t], idx[t + 1]], [idx[t + 1], idx[t + 2]]]) { const a = find(rep[u]), b = find(rep[v]); if (a !== b) parent[a] = b; }
  const root = new Int32Array(n), info = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(rep[i]); root[i] = r; let s = info.get(r); if (!s) { s = { cnt: 0, sum: [0, 0, 0], min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] }; info.set(r, s); }
    s.cnt++; for (let a = 0; a < 3; a++) { const v = a === 0 ? pos.getX(i) : a === 1 ? pos.getY(i) : pos.getZ(i); s.sum[a] += v; if (v < s.min[a]) s.min[a] = v; if (v > s.max[a]) s.max[a] = v; }
  }
  return { root, info: r => { const s = info.get(r); return { cnt: s.cnt, c: s.sum.map(v => v / s.cnt), min: s.min, max: s.max }; } };
}

// the rigid re-orientation: node matrix (z-up export) -> +Y up; turn so the model's -X (forward in the file) becomes +Z; feet on y = 0; centred (x +0.05, z -0.10)
const REORIENT = new THREE.Matrix4().makeTranslation(0.05, 1.25, -0.1).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2));

export function buildKevinRig(gltfScene) {
  gltfScene.updateMatrixWorld(true);
  const modelGroup = new THREE.Group(); modelGroup.name = 'KevinModel';
  const bones = {}, absPos = {}, order = [];
  for (const [name, parent, pos, sided] of TREE) {
    for (const sgn of sided ? [1, -1] : [0]) {
      const bn = sided ? side(name, sgn) : name, b = new THREE.Bone(); b.name = bn;
      const abs = V3(pos, sgn || 1); absPos[bn] = abs; KV_REST[bn] = abs.toArray();
      if (parent) { const ptree = TREE.find(t => t[0] === parent), pn = ptree && ptree[3] ? side(parent, sgn) : parent; bones[pn].add(b); b.position.copy(abs).sub(absPos[pn]); } else { modelGroup.add(b); b.position.copy(abs); }
      bones[bn] = b; order.push(b);
    }
  }
  const markers = {};
  for (const [name, parent, pos, sided] of MARK) for (const sgn of sided ? [1, -1] : [0]) {
    const bn = sided ? side(name, sgn) : name, o = new THREE.Object3D(); o.name = bn; const abs = V3(pos, sgn || 1);
    o.position.copy(abs).sub(absPos[parent]); bones[parent].add(o); markers[bn] = o; absPos[bn] = abs;
  }
  const boneIndex = {}; order.forEach((b, i) => { boneIndex[b.name] = i; });

  // ---- candidate segments (sided ones duplicated L / R)
  const segs = [];
  for (const [bone, a, b, ex, sided, fixed] of SEG) {
    if (sided) for (const sgn of [1, -1]) segs.push({ bone: side(bone, sgn), a: V3(a, sgn), b: V3(b, sgn), ex, side: sgn });
    else segs.push({ bone, a: V3(a), b: V3(b), ex, side: fixed || 0, big: !!fixed });
  }
  const p = new THREE.Vector3();
  const segsFor = (re) => segs.filter(s => re.test(s.bone));
  const core = segsFor(/^(hips|spine|chest|neck|head|chestL|chestR)$/);
  const distW = (pt, list, gate) => { const cand = []; for (const s of list) { let w = 1 / (Math.pow(segDist(pt, s.a, s.b), s.ex) + 1e-4); if (gate) w *= gate(s); cand.push([boneIndex[s.bone], w]); } cand.sort((a, b) => b[1] - a[1]); return cand; };
  const put = (si, sw, i, cand) => { let tot = 0; const k = Math.min(4, cand.length); for (let j = 0; j < k; j++) tot += cand[j][1]; for (let j = 0; j < 4; j++) { si[i * 4 + j] = j < k ? cand[j][0] : 0; sw[i * 4 + j] = j < k ? cand[j][1] / tot : 0; } };
  const pure = (si, sw, i, bn) => { si[i * 4] = boneIndex[bn]; sw[i * 4] = 1; for (let j = 1; j < 4; j++) { si[i * 4 + j] = 0; sw[i * 4 + j] = 0; } };

  const meshes = []; gltfScene.traverse(o => { if (o.isMesh) meshes.push(o); });
  const skinned = [];
  const classify = (geo, mi) => {
    const n = geo.attributes.position.count, lab = new Array(n).fill(''), C = components(geo);
    for (let i = 0; i < n; i++) {
      const I = C.info(C.root[i]); const w = I.c[0] >= 0 ? 1 : -1, h = I.max[1] - I.min[1];
      if (mi === 0) lab[i] = I.cnt > 5000 ? 'body' : 'head';
      else if (I.c[1] < 0.5) lab[i] = w > 0 ? 'legL' : 'legR';                      // legs: centroid near the floor
      else if (I.c[1] < 1.45) lab[i] = w > 0 ? 'bigL' : 'bigR';                      // the two big arms (fire = +x, crystal = -x)
      else if (h > 0.5) lab[i] = w > 0 ? 'wingL' : 'wingR';                           // wings reach up to 2.5 mu
      else lab[i] = 'head';                                                            // eyes
    }
    return lab;
  };
  for (const o of meshes) {
    const geo = o.geometry.clone(); geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(REORIENT, o.matrixWorld)); geo.computeBoundingBox();
    const mi = /Object_3/.test(o.name) ? 1 : 0, lab = classify(geo, mi), pos = geo.attributes.position, n = pos.count, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    const bigSegs = { L: segsFor(/^b[shew]L$|^bhL$/).filter(s => /^b[s-w]L$|^bhL$/.test(s.bone)), R: segsFor(/^b[shew]R$/) };
    const bigL = segs.filter(s => /^b[sewh]L$/.test(s.bone)), bigR = segs.filter(s => /^b[sewh]R$/.test(s.bone));
    const hangL = segs.filter(s => /^(sa|ea|wa)L$/.test(s.bone) || s.bone === 'chestL'), hangR = segs.filter(s => /^(sa|ea|wa)R$/.test(s.bone) || s.bone === 'chestR');
    const legL = segs.filter(s => /^(thigh|knee|ankle|toe)L$/.test(s.bone) || s.bone === 'hips'), legR = segs.filter(s => /^(thigh|knee|ankle|toe)R$/.test(s.bone) || s.bone === 'hips');
    const wingL = segs.filter(s => /^wing[012]L$/.test(s.bone)), wingR = segs.filter(s => /^wing[012]R$/.test(s.bone));
    const tailS = segs.filter(s => /^tail[0-3]$/.test(s.bone));
    const bodyCands = segs.filter(s => /^(hips|spine|chest|neck|head|chestL|chestR|saL|saR|eaL|eaR|waL|waR|thighL|thighR|kneeL|kneeR|ankleL|ankleR|toeL|toeR|tail[0-3])$/.test(s.bone));
    for (let i = 0; i < n; i++) {
      p.fromBufferAttribute(pos, i); const L = lab[i]; let cand;
      if (L === 'head') { pure(si, sw, i, 'head'); continue; }
      if (L === 'bigL') cand = distW(p, [...bigL, ...segs.filter(s => s.bone === 'chestL')], s => s.bone === 'chestL' ? 0.35 : 1);
      else if (L === 'bigR') cand = distW(p, [...bigR, ...segs.filter(s => s.bone === 'chestR')], s => s.bone === 'chestR' ? 0.35 : 1);
      else if (L === 'legL' || L === 'legR') cand = distW(p, L === 'legL' ? legL : legR, s => s.bone === 'hips' ? (p.y > 0.7 ? 1 : 1e-4) : 1);
      else if (L === 'wingL' || L === 'wingR') { cand = distW(p, L === 'wingL' ? wingL : wingR); }
      else {                                                                                            // 'body'
        const side = p.x >= 0 ? 1 : -1;
        cand = distW(p, bodyCands, s => {
          const b = s.bone;
          if (/^tail/.test(b)) return sstep(-p.z, 0.10, 0.30) * (1 - sstep(p.y, 0.95, 1.10)) + 1e-5;       // tail: only the low, rear verts
          if (s.side && /^(sa|ea|wa)/.test(b)) return (s.side === side ? 1 : 1e-4) * sstep(Math.abs(p.x), 0.22, 0.38) * (1 - sstep(p.y, 1.46, 1.6)) + 1e-5;   // ordinary arms: outside the torso only
          if (s.side && /^(thigh|knee|ankle|toe)/.test(b)) return (s.side === side ? 1 : 1e-4) * (1 - sstep(p.y, 0.86, 1.0)) + 1e-5;
          if (b === 'chestL' || b === 'chestR') return (s.side === side ? 1 : 1e-3);
          return 1;
        });
      }
      cand = cand.filter(c => c[1] > 1e-12); if (!cand.length) cand = [[boneIndex.hips, 1]];
      put(si, sw, i, cand);
    }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    const sm = new THREE.SkinnedMesh(geo, o.material); sm.name = o.name; sm.frustumCulled = false; sm.castShadow = true; sm.receiveShadow = false; modelGroup.add(sm); skinned.push(sm);
    void bigSegs; void hangL; void hangR; void tailS; void core;
  }
  modelGroup.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(order);
  for (const sm of skinned) sm.bind(skeleton, new THREE.Matrix4());

  // ---- rest data (model space = the modelGroup's local space; identity rest rotations)
  const allBones = order.slice(), inv = new THREE.Matrix4().copy(modelGroup.matrixWorld).invert(), info = new Map(), TM = new THREE.Matrix4();
  for (const b of allBones) { TM.copy(b.matrixWorld).premultiply(inv); const pp = new THREE.Vector3(), qq = new THREE.Quaternion(), ss = new THREE.Vector3(); TM.decompose(pp, qq, ss); info.set(b, { restLocalQ: b.quaternion.clone(), restLocalP: b.position.clone(), restModelQ: qq.clone(), restModelP: pp.clone(), scale: ss.clone() }); }
  const B = {}; for (const n of ['hips', 'spine', 'chest', 'neck', 'head', 'tail0', 'tail1', 'tail2', 'tail3']) B[n] = bones[n];
  for (const s of ['L', 'R']) for (const n of ['thigh', 'knee', 'ankle', 'toe', 'wing0', 'wing1', 'wing2']) B[n + s] = bones[n + s];
  const arms = {};
  for (const s of ['L', 'R']) {
    arms['B' + s] = { sh: bones['bs' + s], a: bones['bs' + s], e: bones['be' + s], w: bones['bw' + s], side: s === 'L' ? 1 : -1, fingers: [], hand: bones['bh' + s] };
    arms['S' + s] = { sh: null, a: bones['sa' + s], e: bones['ea' + s], w: bones['wa' + s], side: s === 'L' ? 1 : -1, fingers: [] };
  }
  const rest = {}; for (const k in B) rest[k] = info.get(B[k]).restModelP.clone();
  const lens = {}; for (const k in arms) { const r = arms[k]; lens[k] = { l1: info.get(r.a).restModelP.distanceTo(info.get(r.e).restModelP), l2: info.get(r.e).restModelP.distanceTo(info.get(r.w).restModelP) }; }
  const report = { meshes: skinned.map(s => s.name), verts: skinned.reduce((n, s) => n + s.geometry.attributes.position.count, 0), bones: allBones.length };
  return { modelGroup, scene: modelGroup, bones: B, arms, skinned, info, order: allBones, allBones, rest, lens, markers, boneByName: bones, report, skeleton };
}

// ----------------------------------------------------------------------------------- pose driver (FK euler deltas in model space + 2-bone IK for the four arms and two legs)
const TMP = { q: new THREE.Quaternion(), q2: new THREE.Quaternion(), e: new THREE.Euler(), m: new THREE.Matrix4(), v: new THREE.Vector3(), m2: new THREE.Matrix4() };
export class KvPoser {
  /** pose = { d:{ boneKey:[rx,ry,rz] model-space euler deltas }, off:[x,y,z] hips offset (metres), ik:{ BL|BR|SL|SR:{p:Vector3 chest-relative metres, pole} }, legs:{L:{p:Vector3 model metres,pole,pitch,toe},R:{...}} } */
  constructor(rig) {
    this.rig = rig; this.keyOf = new Map();
    for (const k in rig.bones) if (rig.bones[k]) this.keyOf.set(rig.bones[k], k);
    for (const k in rig.arms) { const a = rig.arms[k]; this.keyOf.set(a.a, 'a' + k); this.keyOf.set(a.e, 'e' + k); this.keyOf.set(a.w, 'w' + k); if (a.hand) this.keyOf.set(a.hand, 'h' + k); }
    rig.arms.LL = { sh: null, a: rig.bones.thighL, e: rig.bones.kneeL, w: rig.bones.ankleL, side: 1, fingers: [] };
    rig.arms.LR = { sh: null, a: rig.bones.thighR, e: rig.bones.kneeR, w: rig.bones.ankleR, side: -1, fingers: [] };
    this.cp = new THREE.Vector3(); this.Dtc = new THREE.Quaternion();
  }
  apply(pose) {
    const R = this.rig, info = R.info, d = pose.d || {}, g = R.modelGroup, sc = g.scale.x;
    const Dt = new Map(), Wm = new Map();
    for (const b of R.allBones) {
      const key = this.keyOf.get(b), e = key && d[key], par = b.parent && info.has(b.parent) ? b.parent : null, Dp = par ? Dt.get(par) : null;
      const D = TMP.q.identity(); if (e) { TMP.e.set(e[0], e[1], e[2], 'XYZ'); D.setFromEuler(TMP.e); }
      const Dtot = Dp ? D.clone().multiply(Dp) : D.clone(); Dt.set(b, Dtot);
      const Wb = Dtot.clone().multiply(info.get(b).restModelQ); Wm.set(b, Wb);
      if (par) b.quaternion.copy(Wm.get(par).clone().invert().multiply(Wb)); else b.quaternion.copy(info.get(b).restLocalQ);
      b.position.copy(info.get(b).restLocalP);
    }
    if (pose.off) { const h = R.bones.hips; h.position.add(TMP.v.set(pose.off[0], pose.off[1], pose.off[2]).divideScalar(sc)); }
    g.updateMatrixWorld(true); this.Dt = Dt;
    const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
    const cp = new THREE.Vector3().setFromMatrixPosition(R.bones.chest.matrixWorld).applyMatrix4(inv).multiplyScalar(sc), Dtc = Dt.get(R.bones.chest); this.cp.copy(cp); this.Dtc.copy(Dtc);
    if (pose.ik) for (const k in pose.ik) {
      const t = pose.ik[k]; if (!t || !t.p) continue; let pp = t.p, pole = t.pole;
      if (t.frame !== 'w') { pp = pp.clone().applyQuaternion(Dtc).add(cp); if (pole) pole = pole.clone().applyQuaternion(Dtc); }
      this.ik(k, { p: pp, pole, twist: t.twist });
    }
    if (pose.legs) for (const [k, s] of [['LL', 'L'], ['LR', 'R']]) {
      const t = pose.legs[s]; if (!t || !t.p) continue;
      this.ik(k, { p: t.p, pole: t.pole || new THREE.Vector3(0, 0, 1) });
      const knee = R.bones['knee' + s], ankle = R.bones['ankle' + s], toe = R.bones['toe' + s];
      const km = new THREE.Matrix4().multiplyMatrices(inv, knee.matrixWorld), kq = new THREE.Quaternion(); km.decompose(new THREE.Vector3(), kq, new THREE.Vector3());
      TMP.e.set(t.pitch || 0, t.yaw || 0, t.roll || 0, 'YXZ'); ankle.quaternion.copy(kq.invert().multiply(TMP.q.setFromEuler(TMP.e)));
      toe.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), t.toe || 0); ankle.updateMatrixWorld(true);
    }
    g.updateMatrixWorld(true);
  }
  /** two-bone IK; target in MODEL space metres */
  ik(k, t) {
    const R = this.rig, A = R.arms[k], g = R.modelGroup, sc = g.scale.x, inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
    const wp = (o) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).applyMatrix4(inv);
    const a = wp(A.a), e = wp(A.e), w = wp(A.w), T = t.p.clone().divideScalar(sc);
    const l1 = a.distanceTo(e), l2 = e.distanceTo(w); const dir = T.clone().sub(a), dist = dir.length(); if (dist < 1e-5) return; dir.multiplyScalar(1 / dist);
    const dd = Math.max(Math.min(dist, (l1 + l2) * 0.999), Math.abs(l1 - l2) * 1.001 + 1e-3);
    const x = (l1 * l1 - l2 * l2 + dd * dd) / (2 * dd), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
    const pole = (t.pole || new THREE.Vector3(A.side * 0.6, -0.8, -0.5)).clone(); pole.addScaledVector(dir, -pole.dot(dir)); if (pole.lengthSq() < 1e-6) pole.set(0, -1, 0); pole.normalize();
    const E = a.clone().addScaledVector(dir, x).addScaledVector(pole, h), W = a.clone().addScaledVector(dir, dd);
    const rot = (bone, from, to) => {
      const q = TMP.q.setFromUnitVectors(from.clone().normalize(), to.clone().normalize()), cur = new THREE.Quaternion();
      TMP.m.multiplyMatrices(inv, bone.matrixWorld).decompose(new THREE.Vector3(), cur, new THREE.Vector3());
      const nw = q.clone().multiply(cur), pq = new THREE.Quaternion(); TMP.m2.multiplyMatrices(inv, bone.parent.matrixWorld).decompose(new THREE.Vector3(), pq, new THREE.Vector3());
      bone.quaternion.copy(pq.invert().multiply(nw)); bone.updateMatrixWorld(true);
    };
    rot(A.a, e.clone().sub(a), E.clone().sub(a));
    const e2 = wp(A.e), w2 = wp(A.w); rot(A.e, w2.clone().sub(e2), W.clone().sub(e2));
    if (t.twist) A.e.quaternion.multiply(TMP.q2.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.twist));
    A.e.updateMatrixWorld(true);
  }
}
