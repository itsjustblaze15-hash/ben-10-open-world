// Builds a runtime skeleton for the supplied GLB.
//
// The GLB has NO skeleton and NO animation clips (verified by inspecting it), so to animate it
// we attach a procedural bone hierarchy and compute skin weights from vertex positions.
// Vertex positions, normals, materials and colours are NOT edited - the only thing added to each
// mesh is skinIndex/skinWeight attributes (and the node's rest transform is baked into the vertices
// so the mesh sits exactly where it did in the file).
import * as THREE from 'three';

export const MODEL_SCALE = 1.12;    // GLB is ~2.3 units tall -> ~2.6 m in the arena
export const SOLE_Y = 0.07;         // sole of the foot in GLB space
export const UNIT = 0.57;           // size factor for effects authored for a 0.625-scale rig (0.625 / ~1.1)

// Rest-pose joint positions measured from the supplied mesh (GLB space; +X side listed, -X mirrored).
const TREE = [
  ['hips',  null,    [0, 1.12, 0]],
  ['spine', 'hips',  [0, 1.30, 0]],
  ['chest', 'spine', [0, 1.55, 0]],
  ['neck',  'chest', [0, 1.88, 0.0]],
  ['head',  'neck',  [0, 1.97, -0.02]],
  ['uarm',  'chest', [0.42, 1.72, 0.0], true],
  ['farm',  'uarm',  [0.52, 1.40, 0.0], true],
  ['hand',  'farm',  [0.55, 0.88, 0.05], true],
  ['thigh', 'hips',  [0.17, 1.08, 0.0], true],
  ['shin',  'thigh', [0.20, 0.58, 0.0], true],
  ['foot',  'shin',  [0.22, 0.28, -0.03], true],
];
export const SHOULDER = [0.42, 1.72, 0.0];
export const HAND_TIP = [0.54, 0.62, 0.09];     // fingertip rest position (+X side)
const TOE = [0.26, SOLE_Y, 0.27], HEEL = [0.26, SOLE_Y, -0.15];

export const BONE_NAMES = [];
for (const [n, , , sided] of TREE) { if (sided) BONE_NAMES.push(n + 'L', n + 'R'); else BONE_NAMES.push(n); }

// Segments used for distance-based skin weights: [bone, a, b]
const SEGS = [
  ['hips',  [0, 1.02, 0], [0, 1.25, 0]],
  ['spine', [0, 1.25, 0], [0, 1.55, 0]],
  ['chest', [0, 1.55, 0], [0, 1.85, 0]],
  ['head',  [0, 2.0, -0.02], [0, 2.3, -0.1]],
  ['uarm',  [0.42, 1.72, 0], [0.52, 1.40, 0], true],
  ['farm',  [0.52, 1.40, 0], [0.55, 0.88, 0.05], true],
  ['hand',  [0.55, 0.88, 0.05], [0.54, 0.62, 0.1], true],
  ['thigh', [0.17, 1.08, 0], [0.20, 0.58, 0], true],
  ['shin',  [0.20, 0.58, 0], [0.22, 0.28, -0.03], true],
  ['foot',  [0.22, 0.28, -0.03], [0.26, 0.09, 0.16], true],
];

const V = (a, s = 1) => new THREE.Vector3(a[0] * s, a[1], a[2]);

function segDist(p, a, b) {
  const ab = b.clone().sub(a), t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1);
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}

export function buildRig(gltfScene) {
  gltfScene.updateMatrixWorld(true);
  const modelGroup = new THREE.Group();
  modelGroup.name = 'DiamondheadModel';

  // ---- bones
  const bones = {}, absPos = {}, order = [];
  for (const [name, parent, pos, sided] of TREE) {
    const sides = sided ? [['L', 1], ['R', -1]] : [['', 1]];
    for (const [sfx, sgn] of sides) {
      const b = new THREE.Bone(); b.name = name + sfx;
      const abs = V(pos, sgn); absPos[b.name] = abs;
      if (parent) {
        const pn = parent + (TREE.find(t => t[0] === parent)[3] ? sfx : '');
        bones[pn].add(b); b.position.copy(abs).sub(absPos[pn]);
      } else { modelGroup.add(b); b.position.copy(abs); }
      bones[b.name] = b; order.push(b);
    }
  }
  // markers: fingertip + foot sole points (parented to bones so they follow the animation)
  const markers = {};
  for (const [sfx, sgn] of [['L', 1], ['R', -1]]) {
    const mk = (nm, parent, world) => { const o = new THREE.Object3D(); o.name = nm; o.position.copy(V(world, sgn)).sub(absPos[parent]); bones[parent].add(o); markers[nm] = o; };
    mk('tip' + sfx, 'hand' + sfx, HAND_TIP); mk('toe' + sfx, 'foot' + sfx, TOE); mk('heel' + sfx, 'foot' + sfx, HEEL);
  }

  // ---- skin weights (computed from the original vertex positions)
  const segs = [];
  for (const [bone, a, b, sided] of SEGS) {
    if (sided) { segs.push({ bone: bone + 'L', a: V(a, 1), b: V(b, 1), side: 1 }); segs.push({ bone: bone + 'R', a: V(a, -1), b: V(b, -1), side: -1 }); }
    else segs.push({ bone, a: V(a), b: V(b), side: 0 });
  }
  const boneIndex = {}; order.forEach((b, i) => boneIndex[b.name] = i);
  const p = new THREE.Vector3();
  function weightsFor(geo, meshName) {
    const pos = geo.attributes.position, n = pos.count;
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    const forced = /^Eye/.test(meshName) ? 'head' : /Omnitrix/.test(meshName) ? 'chest' : null;
    const isCrystal = /^Diamond/.test(meshName);
    const isTorso = /^Body/.test(meshName);
    const cand = new Array(segs.length);
    for (let i = 0; i < n; i++) {
      p.fromBufferAttribute(pos, i);
      if (forced) { si[i * 4] = boneIndex[forced]; sw[i * 4] = 1; continue; }
      const backSpike = isCrystal && p.z < -0.3 && p.y > 1.7;   // back crystal blades ride the shoulders, not the head
      for (let k = 0; k < segs.length; k++) {
        const s = segs[k]; let w = 1 / (Math.pow(segDist(p, s.a, s.b), 4) + 2e-4);
        if (s.side) w *= THREE.MathUtils.smoothstep(p.x * s.side, -0.1, 0.1) * 0.999 + 0.001; // keep limbs on their own side
        if (isTorso && /^(uarm|farm|hand)/.test(s.bone)) w *= 0.25; // torso skin follows the chest, not the raised arm
        if (backSpike) w = s.bone === 'chest' ? 1 : 1e-9;
        cand[k] = [boneIndex[s.bone], w];
      }
      cand.sort((x, y) => y[1] - x[1]);
      let tot = 0; for (let k = 0; k < 4; k++) tot += cand[k][1];
      for (let k = 0; k < 4; k++) { si[i * 4 + k] = cand[k][0]; sw[i * 4 + k] = cand[k][1] / tot; }
    }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  }

  // ---- convert every mesh of the GLB into a SkinnedMesh sharing the original material instance
  const skinned = [], src = [];
  gltfScene.traverse(o => { if (o.isMesh) src.push(o); });
  for (const o of src) {
    const geo = o.geometry.clone();
    geo.applyMatrix4(o.matrixWorld);   // bake the node's rest transform (rigid; look is unchanged)
    weightsFor(geo, o.name);
    const sm = new THREE.SkinnedMesh(geo, o.material);
    sm.name = o.name; sm.frustumCulled = false; sm.castShadow = true; sm.receiveShadow = true;
    modelGroup.add(sm); skinned.push(sm);
  }
  modelGroup.updateMatrixWorld(true);  // group is at identity here, so bone inverses are in GLB space
  const skeleton = new THREE.Skeleton(order);
  for (const sm of skinned) sm.bind(skeleton, new THREE.Matrix4());

  const rest = {};
  for (const b of order) rest[b.name] = { pos: b.position.clone() };
  return { modelGroup, bones, skeleton, skinned, markers, rest, absPos };
}
