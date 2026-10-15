// Ben Tennyson rig. The supplied GLB (assets/ben.glb, "Ben 10" by gaddiellartey2010, CC-BY-4.0) is ONE static, unskinned mesh set in a T-pose:
//   4 meshes (body+clothes+watch, eyes, hair, mouth), no skeleton, no clips.  Vertices, UVs, textures, materials and colours are NOT edited.
// To animate him the same way Diamondhead's GLB is animated, a procedural bone tree is attached and skin weights are computed from vertex positions.
// The only transform baked into the vertices is the file's own node rotation, a +90 deg turn about Y (the model faces -X in the file; the game's model space faces +Z)
// and a lift so the soles sit at y = 0 - the proportions, face and clothing are exactly the ones in the file. The T-pose is the bind pose; the "arms down" stance is a bone pose.
import * as THREE from 'three';

export const BEN_SCALE = 0.58;     // GLB is 2.5 units tall -> 1.45 m (a ten-year-old next to the 2.6-3 m aliens)
const FOOT = -1.25;                // sole of the shoe in the file's (rotated) space

// joints measured from the mesh, in model space: +X = Ben's left, +Y up, +Z forward, feet at y = 0 (units of the file; +X side listed, -X mirrored)
const TREE = [
  ['hips',  null,    [0, 0.96, 0]],
  ['spine', 'hips',  [0, 1.14, 0]],
  ['chest', 'spine', [0, 1.38, 0]],
  ['neck',  'chest', [0, 1.70, 0.0]],
  ['head',  'neck',  [0, 1.84, 0.0]],
  ['uarm',  'chest', [0.36, 1.58, 0.0], true],
  ['farm',  'uarm',  [0.70, 1.58, 0.0], true],
  ['hand',  'farm',  [0.98, 1.58, 0.0], true],
  ['thigh', 'hips',  [0.13, 0.96, 0.0], true],
  ['shin',  'thigh', [0.14, 0.55, 0.0], true],
  ['foot',  'shin',  [0.15, 0.20, 0.0], true],
];
const HAND_TIP = [1.14, 1.58, 0.0], TOE = [0.15, 0.05, 0.28], HEEL = [0.15, 0.05, -0.13], WATCH = [0.80, 1.58, 0.0];
const SEGS = [
  ['hips',  [0, 0.88, 0], [0, 1.05, 0]],
  ['spine', [0, 1.05, 0], [0, 1.30, 0]],
  ['chest', [0, 1.30, 0], [0, 1.64, 0]],
  ['head',  [0, 1.76, 0], [0, 2.30, 0]],
  ['uarm',  [0.36, 1.58, 0], [0.70, 1.58, 0], true],
  ['farm',  [0.70, 1.58, 0], [0.98, 1.58, 0], true],
  ['hand',  [0.98, 1.58, 0], [1.14, 1.58, 0], true],
  ['thigh', [0.13, 0.96, 0], [0.14, 0.55, 0], true],
  ['shin',  [0.14, 0.55, 0], [0.15, 0.20, 0], true],
  ['foot',  [0.15, 0.20, 0], [0.15, 0.06, 0.28], true],
];
const V = (a, s = 1) => new THREE.Vector3(a[0] * s, a[1], a[2]);
const sm = (x, a, b) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function segDist(p, a, b) { const ab = b.clone().sub(a), t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1); return p.distanceTo(a.clone().addScaledVector(ab, t)); }

/** the procedural 17-bone tree + markers (shared by Ben and by Albedo's human form, whose own Mixamo skeleton is driven from this tree) */
export function buildBenTree() {
  const modelGroup = new THREE.Group(); modelGroup.name = 'BenModel';
  const bones = {}, absPos = {}, order = [];
  for (const [name, parent, pos, sided] of TREE) {
    for (const [sfx, sgn] of sided ? [['L', 1], ['R', -1]] : [['', 1]]) {
      const b = new THREE.Bone(); b.name = name + sfx; const abs = V(pos, sgn); absPos[b.name] = abs;
      if (parent) { const pn = parent + (TREE.find(t => t[0] === parent)[3] ? sfx : ''); bones[pn].add(b); b.position.copy(abs).sub(absPos[pn]); } else { modelGroup.add(b); b.position.copy(abs); }
      bones[b.name] = b; order.push(b);
    }
  }
  const markers = {};
  const mk = (nm, parent, world, sgn) => { const o = new THREE.Object3D(); o.name = nm; o.position.copy(V(world, sgn)).sub(absPos[parent]); bones[parent].add(o); markers[nm] = o; };
  for (const [sfx, sgn] of [['L', 1], ['R', -1]]) { mk('tip' + sfx, 'hand' + sfx, HAND_TIP, sgn); mk('toe' + sfx, 'foot' + sfx, TOE, sgn); mk('heel' + sfx, 'foot' + sfx, HEEL, sgn); }
  mk('watch', 'farmL', WATCH, 1);                                   // the Omnitrix on his left wrist (the mesh's own watch rides the same bone)
  mk('chestM', 'chest', [0, 1.5, 0.2], 1); mk('headM', 'head', [0, 2.1, 0], 1);
  return { modelGroup, bones, absPos, order, markers };
}

export function buildBenRig(gltfScene) {
  gltfScene.updateMatrixWorld(true);
  const { modelGroup, bones, absPos, order, markers } = buildBenTree();

  const segs = [];
  for (const [bone, a, b, sided] of SEGS) { if (sided) { segs.push({ bone: bone + 'L', a: V(a, 1), b: V(b, 1), side: 1 }); segs.push({ bone: bone + 'R', a: V(a, -1), b: V(b, -1), side: -1 }); } else segs.push({ bone, a: V(a), b: V(b), side: 0 }); }
  const boneIndex = {}; order.forEach((b, i) => boneIndex[b.name] = i);
  const p = new THREE.Vector3();
  const weightsFor = (geo, meshName) => {
    const pos = geo.attributes.position, n = pos.count, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    const forced = /Object_3|Object_4|Object_5/.test(meshName) ? 'head' : null;         // eyes, hair and mouth meshes ride the head
    const cand = new Array(segs.length);
    for (let i = 0; i < n; i++) {
      p.fromBufferAttribute(pos, i);
      if (forced) { si[i * 4] = boneIndex[forced]; sw[i * 4] = 1; continue; }
      for (let k = 0; k < segs.length; k++) {
        const s = segs[k]; let w = 1 / (Math.pow(segDist(p, s.a, s.b), 4) + 2e-4);
        if (s.side) w *= sm(p.x * s.side, -0.06, 0.06) * 0.999 + 0.001;                 // keep limbs on their own side
        if (/^(uarm|farm|hand)/.test(s.bone)) w *= sm(Math.abs(p.x), 0.31, 0.44) * 0.995 + 0.005;   // the torso stays on the chest: arms only own what is outside the shirt
        if (/^(thigh|shin|foot)/.test(s.bone) && p.y > 0.98) w *= 0.05;
        cand[k] = [boneIndex[s.bone], w];
      }
      cand.sort((x, y) => y[1] - x[1]);
      let tot = 0; for (let k = 0; k < 4; k++) tot += cand[k][1];
      for (let k = 0; k < 4; k++) { si[i * 4 + k] = cand[k][0]; sw[i * 4 + k] = cand[k][1] / tot; }
    }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  };
  const skinned = [], src = [];
  gltfScene.traverse(o => { if (o.isMesh) src.push(o); });
  const fix = new THREE.Matrix4().makeRotationY(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(0, -FOOT, 0));   // face +Z, soles on y = 0
  for (const o of src) {
    const geo = o.geometry.clone(); geo.applyMatrix4(o.matrixWorld); geo.applyMatrix4(fix);     // node rotation (-90 deg about X, from the file) + facing + lift
    weightsFor(geo, o.name);
    const sm_ = new THREE.SkinnedMesh(geo, o.material); sm_.name = o.name; sm_.frustumCulled = false; sm_.castShadow = true; sm_.receiveShadow = true;
    modelGroup.add(sm_); skinned.push(sm_);
  }
  modelGroup.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(order); for (const m of skinned) m.bind(skeleton, new THREE.Matrix4());
  const rest = {}; for (const b of order) rest[b.name] = { pos: b.position.clone() };
  return { modelGroup, bones, skeleton, skinned, markers, rest, absPos, scale: BEN_SCALE, report: { bones: order.length, meshes: skinned.length, verts: skinned.reduce((a, m) => a + m.geometry.attributes.position.count, 0), height: 2.5 * BEN_SCALE } };
}
