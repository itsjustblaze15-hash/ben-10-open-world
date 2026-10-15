// Runtime skeleton for the supplied XLR8 GLB.
//
// The XLR8 GLB has NO skeleton and NO animation clips (verified: 12 static meshes, 0 skins, 0 animations, no UVs/textures,
// just flat materials). So - exactly like Diamondhead - a procedural bone hierarchy is attached and skin weights are computed
// from the ORIGINAL vertex positions. Vertex positions, normals and the original material objects are not edited; the node
// rest transforms are baked into the vertices so the model sits exactly as it does in the file. Only skinIndex/skinWeight
// attributes are added.
import * as THREE from 'three';

export const XLR8_SCALE = 0.45;      // GLB is ~4.85 units tall (crest) with a 6.6 unit tail -> ~2.2 m tall in the arena
export const XLR8_SOLE_Y = 0.14;     // lowest point of the foot pads in GLB space
export const XLR8_UNIT = 0.45;

// Rest-pose joints measured from the supplied mesh with orthographic side/front views (GLB space, +X side listed, -X mirrored).
const TREE = [
  ['hips',  null,    [0, 2.50, -0.50]],
  ['spine', 'hips',  [0, 2.95, -0.30]],
  ['chest', 'spine', [0, 3.45, -0.10]],
  ['neck',  'chest', [0, 3.85, 0.15]],
  ['head',  'neck',  [0, 4.02, 0.30]],
  ['tail1', 'hips',  [0, 2.65, -1.20]],
  ['tail2', 'tail1', [0, 2.58, -2.40]],
  ['tail3', 'tail2', [0, 2.48, -3.60]],
  ['tail4', 'tail3', [0, 2.40, -4.90]],
  ['uarm',  'chest', [0.95, 3.55, -0.10], true],
  ['farm',  'uarm',  [1.20, 3.10, -0.50], true],
  ['hand',  'farm',  [0.90, 2.65, 0.25], true],
  ['thigh', 'hips',  [0.50, 2.45, -0.45], true],
  ['shin',  'thigh', [0.95, 1.75, 0.20], true],
  ['foot',  'shin',  [0.85, 1.10, -0.80], true],
];
export const X_HAND_TIP = [0.95, 2.40, 0.90];
const BALL = [0.90, XLR8_SOLE_Y, -0.15], TIPTOE = [0.95, 0.30, 0.28];
export const X_BONE_NAMES = [];
for (const [n, , , sided] of TREE) { if (sided) X_BONE_NAMES.push(n + 'L', n + 'R'); else X_BONE_NAMES.push(n); }

// segments for distance-based skin weights: [bone, a, b, sided?, xFade?]  (several segments may share one bone)
const SEGS = [
  ['hips',  [0, 2.45, -0.55], [0, 2.62, -0.9]],
  ['hips',  [0.35, 2.5, -0.5], [0.35, 2.7, -0.5], false],
  ['hips',  [-0.35, 2.5, -0.5], [-0.35, 2.7, -0.5], false],
  ['spine', [0, 2.75, -0.4], [0, 3.2, -0.2]],
  ['spine', [0.4, 2.9, -0.35], [0.4, 3.1, -0.3], false],
  ['spine', [-0.4, 2.9, -0.35], [-0.4, 3.1, -0.3], false],
  ['chest', [0, 3.2, -0.15], [0, 3.75, 0.05]],
  ['chest', [0.5, 3.35, -0.1], [0.55, 3.75, 0.0], false],
  ['chest', [-0.5, 3.35, -0.1], [-0.55, 3.75, 0.0], false],
  ['neck',  [0, 3.78, 0.1], [0, 4.0, 0.3]],
  ['head',  [0, 4.05, 0.32], [0, 4.5, 0.58]],
  ['head',  [0, 4.4, 0.45], [0, 4.97, -0.02]],
  ['tail1', [0, 2.62, -1.0], [0, 2.58, -2.4]],
  ['tail2', [0, 2.58, -2.4], [0, 2.48, -3.6]],
  ['tail3', [0, 2.48, -3.6], [0, 2.4, -4.9]],
  ['tail4', [0, 2.4, -4.9], [0, 2.3, -6.7]],
  ['uarm',  [0.95, 3.55, -0.1], [1.2, 3.1, -0.5], true, [0.62, 0.98]],
  ['farm',  [1.2, 3.1, -0.5], [0.9, 2.65, 0.25], true, [0.62, 0.98]],
  ['farm',  [1.2, 3.1, -0.5], [1.3, 3.85, -0.75], true, [0.62, 0.98]],   // elbow fin
  ['hand',  [0.9, 2.65, 0.25], [0.95, 2.4, 0.9], true, [0.62, 0.98]],
  ['thigh', [0.5, 2.45, -0.45], [0.95, 1.75, 0.2], true, [0.05, 0.4]],
  ['shin',  [0.95, 1.75, 0.2], [0.85, 1.1, -0.8], true, [0.3, 0.6]],
  ['foot',  [0.85, 1.1, -0.8], [0.9, 0.5, -0.2], true, [0.3, 0.6]],
  ['foot',  [0.9, 0.5, -0.2], [0.95, 0.3, 0.3], true, [0.3, 0.6]],
  ['foot',  [0.85, 1.1, -0.85], [0.8, 1.3, -1.4], true, [0.3, 0.6]],      // heel spur
];

const V = (a, s = 1) => new THREE.Vector3(a[0] * s, a[1], a[2]);
const segDist = (() => { const ab = new THREE.Vector3(), ap = new THREE.Vector3(), q = new THREE.Vector3();
  return (p, a, b) => { ab.subVectors(b, a); ap.subVectors(p, a); const t = THREE.MathUtils.clamp(ap.dot(ab) / ab.lengthSq(), 0, 1); q.copy(a).addScaledVector(ab, t); return p.distanceTo(q); }; })();

export function buildXlr8Rig(gltfScene) {
  gltfScene.updateMatrixWorld(true);
  const modelGroup = new THREE.Group(); modelGroup.name = 'XLR8Model';
  const bones = {}, absPos = {}, order = [];
  for (const [name, parent, pos, sided] of TREE) {
    const sides = sided ? [['L', 1], ['R', -1]] : [['', 1]];
    for (const [sfx, sgn] of sides) {
      const b = new THREE.Bone(); b.name = name + sfx;
      const abs = V(pos, sgn); absPos[b.name] = abs;
      if (parent) { const pn = parent + (TREE.find(t => t[0] === parent)[3] ? sfx : ''); bones[pn].add(b); b.position.copy(abs).sub(absPos[pn]); }
      else { modelGroup.add(b); b.position.copy(abs); }
      bones[b.name] = b; order.push(b);
    }
  }
  const markers = {};
  for (const [sfx, sgn] of [['L', 1], ['R', -1]]) {
    const mk = (nm, parent, world) => { const o = new THREE.Object3D(); o.name = nm; o.position.copy(V(world, sgn)).sub(absPos[parent]); bones[parent].add(o); markers[nm] = o; };
    mk('tip' + sfx, 'hand' + sfx, X_HAND_TIP); mk('ball' + sfx, 'foot' + sfx, BALL); mk('toe' + sfx, 'foot' + sfx, TIPTOE);
  }
  { const o = new THREE.Object3D(); o.name = 'crest'; o.position.set(0, 4.95, 0.0).sub(absPos.head); bones.head.add(o); markers.crest = o; }
  { const o = new THREE.Object3D(); o.name = 'tailtip'; o.position.set(0, 2.3, -6.6).sub(absPos.tail4); bones.tail4.add(o); markers.tailtip = o; }

  // ---- skin weights from original vertex positions (several segments per bone: the nearest one counts)
  const boneIndex = {}; order.forEach((b, i) => boneIndex[b.name] = i);
  const segs = [];
  for (const [bone, a, b, sided, fade] of SEGS) {
    if (sided === true) { for (const sgn of [1, -1]) segs.push({ bone: bone + (sgn > 0 ? 'L' : 'R'), a: V(a, sgn), b: V(b, sgn), side: sgn, fade }); }
    else segs.push({ bone, a: V(a), b: V(b), side: 0 });
  }
  const names = [...new Set(segs.map(s => s.bone))];
  const p = new THREE.Vector3();
  function weightsFor(geo, meshName) {
    const pos = geo.attributes.position, n = pos.count, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    const forced = /^Omnitrex/.test(meshName) ? 'chest' : null;
    const best = {};
    for (let i = 0; i < n; i++) {
      p.fromBufferAttribute(pos, i);
      if (forced) { si[i * 4] = boneIndex[forced]; sw[i * 4] = 1; continue; }
      for (const nm of names) best[nm] = 0;
      for (const s of segs) {
        let w = 1 / (Math.pow(segDist(p, s.a, s.b), 4) + 2e-4);
        if (s.side) { const x = p.x * s.side; w *= THREE.MathUtils.smoothstep(x, s.fade[0], s.fade[1]) * 0.999 + 0.001; }
        if (w > best[s.bone]) best[s.bone] = w;
      }
      const cand = names.map(nm => [boneIndex[nm], best[nm]]).sort((x, y) => y[1] - x[1]);
      let tot = 0; for (let k = 0; k < 4; k++) tot += cand[k][1];
      for (let k = 0; k < 4; k++) { si[i * 4 + k] = cand[k][0]; sw[i * 4 + k] = cand[k][1] / tot; }
    }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  }

  const skinned = [], src = [];
  gltfScene.traverse(o => { if (o.isMesh) src.push(o); });
  for (const o of src) {
    const geo = o.geometry.clone(); geo.applyMatrix4(o.matrixWorld);
    weightsFor(geo, o.name);
    const sm = new THREE.SkinnedMesh(geo, o.material);   // original material instances are shared, untouched
    sm.name = o.name; sm.frustumCulled = false; sm.castShadow = true; sm.receiveShadow = true;
    modelGroup.add(sm); skinned.push(sm);
  }
  modelGroup.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(order);
  for (const sm of skinned) sm.bind(skeleton, new THREE.Matrix4());
  const rest = {}; for (const b of order) rest[b.name] = { pos: b.position.clone() };
  return { modelGroup, bones, skeleton, skinned, markers, rest, absPos };
}
