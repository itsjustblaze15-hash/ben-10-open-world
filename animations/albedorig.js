// ALBEDO human-form rig. assets/albedo.glb ("Ben 10 Albedo") is a Mixamo-skinned character (66 joints, T-pose, no clips). The file is NOT edited: its scene is cloned (geometry shared, materials cloned,
// skeleton re-created by src/clone.js) and its own bones are driven every frame from the same procedural 17-bone tree Ben uses (animations/benrig.js buildBenTree). Retargeting is by orientation:
//     Mixamo bone world rotation = (proxy bone rotation in model space) x (that bone's own T-pose world rotation)
// so the rest pose, bone roll and skin weights of the file are preserved exactly; only the pose changes. The hips follow the proxy's translation (scaled), the spine chain is split over the three
// Mixamo spine bones, and the fingers curl into a fist for punches.
import * as THREE from 'three';
import { cloneScene } from '../src/clone.js';
import { buildBenTree, BEN_SCALE } from './benrig.js';

export const ALBEDO_HEIGHT = 1.62;                   // metres (a bit taller than the ten-year-old Ben: the Albedo of the series is the older Ben's size)
const MAP = {                                        // proxy bone  ->  Mixamo name (without the "mixamorig:" prefix and the "_NN" suffix)
  hips: 'Hips', spine: 'Spine', chest: 'Spine2', neck: 'Neck', head: 'Head',
  uarmL: 'LeftArm', farmL: 'LeftForeArm', handL: 'LeftHand', thighL: 'LeftUpLeg', shinL: 'LeftLeg', footL: 'LeftFoot',
  uarmR: 'RightArm', farmR: 'RightForeArm', handR: 'RightHand', thighR: 'RightUpLeg', shinR: 'RightLeg', footR: 'RightFoot',
};
const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'];
const strip = (n) => n.replace(/^mixamorig:?/, '').replace(/_\d+$/, '');
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _r = new THREE.Quaternion();
const AZ = new THREE.Vector3(0, 0, 1);


/** The jacket mesh ("MA_campera") in the supplied file is ~1.5x too tall for its own skeleton (its Y coordinates are stretched; X / Z are right), so it floats above the head in the bind pose. The file is NOT touched:
 *  the CLONED geometry is rescaled in Y so the jacket's hip-weighted vertices sit at the skeleton's hip joint and its cuffs at the hand joints (factor measured from the file itself, not hard-coded). */
function fixJacket(scene) {
  const out = { applied: false };
  scene.updateMatrixWorld(true);
  scene.traverse(o => {
    if (!o.isSkinnedMesh || !/campera/i.test(Array.isArray(o.material) ? o.material[0].name : o.material.name)) return;
    const bones = o.skeleton.bones, inv = o.skeleton.boneInverses, geo = o.geometry.clone(), pos = geo.attributes.position, si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
    const idx = (re) => bones.findIndex(b => re.test(b.name)), bindY = (i) => new THREE.Vector3().setFromMatrixPosition(inv[i].clone().invert()).y, bindX = (i) => new THREE.Vector3().setFromMatrixPosition(inv[i].clone().invert()).x;
    const iH = idx(/Hips_/), iL = idx(/LeftHand_/), iR = idx(/RightHand_/); if (iH < 0 || iL < 0 || iR < 0) return;
    let sh = 0, nh = 0, sc = 0, nc = 0;
    for (let i = 0; i < pos.count; i++) {
      let k = 0, bw = -1; for (let j = 0; j < 4; j++) if (sw.getComponent(i, j) > bw) { bw = sw.getComponent(i, j); k = si.getComponent(i, j); }
      if (bw < 0.6) continue; if (k === iH) { sh += pos.getY(i); nh++; } else if (k === iL || k === iR) { sc += pos.getY(i); nc++; }
    }
    if (!nh || !nc) return;
    const fH = bindY(iH) / (sh / nh), fC = bindY(iL) / (sc / nc), f = (fH + fC) / 2;
    if (Math.abs(f - 1) < 0.03) return;                                         // already consistent: leave it alone
    for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) * f);
    const nor = geo.attributes.normal; if (nor) { for (let i = 0; i < nor.count; i++) { const x = nor.getX(i), y = nor.getY(i) / f, z = nor.getZ(i), l = Math.hypot(x, y, z) || 1; nor.setXYZ(i, x / l, y / l, z / l); } nor.needsUpdate = true; }
    pos.needsUpdate = true; geo.computeBoundingBox(); geo.computeBoundingSphere(); o.geometry = geo;
    out.applied = true; out.factor = +f.toFixed(4); out.hipsFactor = +fH.toFixed(4); out.cuffFactor = +fC.toFixed(4); out.verts = pos.count;
  });
  return out;
}

export function buildAlbedoRig(gltf) {
  const scene = cloneScene(gltf.scene);
  scene.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; o.receiveShadow = true; } });
  const fix = fixJacket(scene);
  scene.traverse(o => { if (o.isMesh && /campera/i.test(o.material.name || '')) { o.material.polygonOffset = true; o.material.polygonOffsetFactor = -3; o.material.polygonOffsetUnits = -3; o.renderOrder = 1; } });   // the jacket sleeves lie exactly on the arms of the body mesh: pull the jacket forward so the two surfaces never z-fight
  const tree = buildBenTree(); const { modelGroup } = tree;
  const wrap = new THREE.Group(); wrap.name = 'AlbedoScene'; wrap.add(scene); modelGroup.add(wrap); wrap.updateMatrixWorld(true);
  // ---- find the Mixamo bones
  const byName = {}; scene.traverse(o => { if (o.isBone) byName[strip(o.name)] = o; });
  const need = [...Object.values(MAP), 'Spine1', 'LeftToeBase', 'RightToeBase']; const missing = need.filter(n => !byName[n]);
  if (missing.length) throw new Error('albedo.glb: missing bones ' + missing.join(','));
  // ---- measure the rest pose (armature frame == model frame: the file's node chain nets to identity rotation)
  const hips = byName.Hips; const hipsY = hips.getWorldPosition(new THREE.Vector3()).y;
  const sA = tree.absPos.hips.y / hipsY;                                    // armature units -> Ben-tree units, so the hips line up with the tree's hip height
  wrap.scale.setScalar(sA); wrap.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene); const h = box.max.y - box.min.y;          // in Ben-tree units
  const feetLift = -box.min.y;                                              // soles on y = 0
  wrap.position.y = feetLift; wrap.updateMatrixWorld(true);
  const rest = new Map();                                                   // bone -> { local quat, local pos, world quat (armature frame) }
  const worldQ = (b) => b.getWorldQuaternion(new THREE.Quaternion());
  const all = []; hips.traverse(o => { if (o.isBone) all.push(o); });
  for (const b of all) rest.set(b, { lq: b.quaternion.clone(), lp: b.position.clone(), wq: _r.copy(wrap.getWorldQuaternion(new THREE.Quaternion())).invert().multiply(worldQ(b)).clone() });   // wq relative to the wrap (= armature frame)
  const hipsParentQ = (() => { const q = new THREE.Quaternion(); hips.parent.getWorldQuaternion(q); return q.premultiply(wrap.getWorldQuaternion(new THREE.Quaternion()).invert()); })();
  const hipsParentScale = (() => { hips.parent.getWorldScale(_s); return _s.x / wrap.scale.x; })();      // armature units per hips-local unit
  const hipsRest = rest.get(hips).lp.clone();
  // ---- the retarget plan: bones in parent-first order with their proxy source
  const plan = []; const proxyOf = new Map();
  for (const k in MAP) proxyOf.set(byName[MAP[k]], k);
  const side = (S) => ({ hand: byName[S + 'Hand'], fing: FINGERS.map(f => [1, 2, 3].map(i => byName[S + 'Hand' + f + i]).filter(Boolean)) });
  const fingers = { L: side('Left'), R: side('Right') };
  const fingerBones = new Map(); for (const S of ['L', 'R']) fingers[S].fing.forEach((chain, fi) => chain.forEach((b, i) => fingerBones.set(b, { S, fi, i })));
  const thumbs = { L: [1, 2, 3].map(i => byName['LeftHandThumb' + i]).filter(Boolean), R: [1, 2, 3].map(i => byName['RightHandThumb' + i]).filter(Boolean) };
  const thumbOf = new Map(); for (const S of ['L', 'R']) thumbs[S].forEach((b, i) => thumbOf.set(b, { S, i }));
  const order = []; const visit = (b) => { order.push(b); for (const c of b.children) if (c.isBone) visit(c); }; visit(hips);
  for (const b of order) plan.push({ b, parent: b === hips ? null : b.parent, src: proxyOf.get(b) || null });

  const rig = {
    modelGroup, bones: tree.bones, markers: tree.markers, absPos: tree.absPos, rest: {}, skinned: [], scale: ALBEDO_HEIGHT / h, strideMul: (ALBEDO_HEIGHT / h) / BEN_SCALE, scene, wrap, byName, fist: 0, hair: null,
    report: { jacketFix: fix, bones: all.length, meshes: 0, height: ALBEDO_HEIGHT, sA: +sA.toFixed(4), hipsY: +hipsY.toFixed(3), heightBenUnits: +h.toFixed(3) },
  };
  scene.traverse(o => { if (o.isSkinnedMesh) { rig.skinned.push(o); rig.report.meshes++; } });
  for (const k in tree.bones) rig.rest[k] = { pos: tree.bones[k].position.clone() };
  modelGroup.scale.setScalar(1);
  const M = {};                                                             // model-space rotation of every proxy bone this frame
  const wq = new Map();                                                     // armature-frame world rotation of every Mixamo bone this frame
  const qModel = (name) => {
    if (M[name]) return M[name]; const b = tree.bones[name]; const par = b.parent; const pq = par && par.isBone ? qModel(par.name) : null;
    return (M[name] = pq ? pq.clone().multiply(b.quaternion) : b.quaternion.clone());
  };
  /** copy the proxy tree's current pose onto the Mixamo skeleton (call after BenPlayer.pose()) */
  rig.sync = function (fist = this.fist) {
    for (const k in M) delete M[k];
    for (const { b, parent, src } of plan) {
      const R = rest.get(b); let dq;
      if (src) dq = qModel(src);
      else if (b.name.includes('Spine1')) dq = _q.copy(qModel('spine')).slerp(qModel('chest'), 0.5).clone();
      else if (fingerBones.has(b)) {
        const f = fingerBones.get(b), S = f.S === 'L' ? 'handL' : 'handR', sg = f.S === 'L' ? -1 : 1;
        const ang = sg * (0.2 + 1.15 * fist) * (f.i === 0 ? 0.85 : f.i === 1 ? 1.0 : 0.8);
        const pd = f.i === 0 ? qModel(S) : wq.get(b.parent).delta;
        dq = pd.clone().multiply(_q2.setFromAxisAngle(AZ, ang));
      } else if (thumbOf.has(b)) {
        const t = thumbOf.get(b), S = t.S === 'L' ? 'handL' : 'handR', sg = t.S === 'L' ? -1 : 1;
        const pd = t.i === 0 ? qModel(S) : wq.get(b.parent).delta;
        dq = pd.clone().multiply(_q2.setFromAxisAngle(AZ, sg * (0.05 + 0.3 * fist) * (t.i === 0 ? 0.5 : 1)));
      } else {
        // everything else (shoulders, toes, head top ...) keeps its rest orientation relative to the nearest driven ancestor
        const pe = wq.get(parent); dq = pe ? pe.delta : new THREE.Quaternion();
      }
      const desired = dq.clone().multiply(R.wq);                                    // world rotation (armature frame)
      const pW = parent && wq.get(parent) ? wq.get(parent).w : hipsParentQ;
      b.quaternion.copy(pW).invert().multiply(desired);
      wq.set(b, { w: desired, delta: dq });
    }
    // hips translation: proxy hips displacement (Ben-tree units) -> hips-local units
    const hp = tree.bones.hips.position, hr = tree.absPos.hips; hips.position.copy(hipsRest).add(_p.set(hp.x - hr.x, hp.y - hr.y, hp.z - hr.z).multiplyScalar(1 / sA / hipsParentScale));
    scene.updateMatrixWorld(true);
  };
  rig.sync(0);
  return rig;
}
