// Four Arms rig wrapper. The supplied GLB already has a real 99-bone skeleton (4 arms with fingers, spine, legs) but NO animation clips,
// so the pose is driven procedurally here. Geometry / textures / materials / bones of the GLB are used untouched.
//  - FK deltas are expressed in MODEL space (x = model left, y = up, z = forward) on top of the bind pose, children follow.
//  - Each of the four arms is solved with a two-bone IK to a hand target (character space), so grabbing / holding / punching always lands on a point.
//  - Fingers curl from a 0..1 value per hand.
import * as THREE from 'three';

export const FA_SCALE = 2.0;
const TMP = { q: new THREE.Quaternion(), q2: new THREE.Quaternion(), v: new THREE.Vector3(), v2: new THREE.Vector3(), e: new THREE.Euler(), m: new THREE.Matrix4() };

const find = (scene, re) => { let r = null; scene.traverse(o => { if (!r && o.isBone && re.test(o.name.replace(/_/g, ' '))) r = o; }); return r; };

export const FA_ARMS = {
  UL: { sh: /^Left shoulder 06$/, a: /^Left arm 07$/, e: /^Left elbow 08$/, w: /^Left wrist 09$/, side: 1 },
  UR: { sh: /^Right shoulder 0?22$/, a: /^Right arm 0?23$/, e: /^Right elbow 0?24$/, w: /^Right wrist 0?25$/, side: -1 },
  LL: { sh: /^Left shoulderLower 0?37$/, a: /^Left armLower 0?38$/, e: /^Left elbowLower 0?39$/, w: /^Left wristLower 0?40$/, side: 1 },
  LR: { sh: /^Right shoulderLower 0?53$/, a: /^Right armLower 0?54$/, e: /^Right elbowLower 0?55$/, w: /^Right wristLower 0?56$/, side: -1 },
};

export function buildFourArmsRig(gltfScene) {
  const scene = gltfScene, modelGroup = new THREE.Group(); modelGroup.add(scene);
  scene.updateMatrixWorld(true);
  const skinned = []; scene.traverse(o => { if (o.isSkinnedMesh) { skinned.push(o); o.frustumCulled = false; o.castShadow = true; o.receiveShadow = true; } });
  const B = {
    hips: find(scene, /^Hips 01$/), spine: find(scene, /^Spine 02$/), chest: find(scene, /^Chest 03$/), neck: find(scene, /^Neck 04$/), head: find(scene, /^Head 05$/),
    thighL: find(scene, /^Left leg 069$/), kneeL: find(scene, /^Left knee 070$/), ankleL: find(scene, /^Left ankle 071$/), toeL: find(scene, /^Left ankle end 094$/),
    thighR: find(scene, /^Right leg 073$/), kneeR: find(scene, /^Right knee 074$/), ankleR: find(scene, /^Right ankle 075$/), toeR: find(scene, /^Right ankle end 096$/),
  };
  const arms = {};
  for (const k in FA_ARMS) { const d = FA_ARMS[k]; arms[k] = { sh: find(scene, d.sh), a: find(scene, d.a), e: find(scene, d.e), w: find(scene, d.w), side: d.side, fingers: [] }; }
  for (const k in B) if (!B[k]) console.warn('FourArms rig: bone missing', k);
  for (const k in arms) for (const n of ['sh', 'a', 'e', 'w']) if (!arms[k][n]) console.warn('FourArms rig: arm bone missing', k, n);
  // fingers: every bone below the wrist that is not an _end bone
  for (const k in arms) arms[k].w.traverse(o => { if (o.isBone && o !== arms[k].w && !/end/i.test(o.name)) arms[k].fingers.push(o); });
  // ---- rest data in MODEL space (modelGroup is at the origin with unit scale while we read it)
  const bones = []; scene.traverse(o => { if (o.isBone) bones.push(o); });
  const inv = new THREE.Matrix4().copy(modelGroup.matrixWorld).invert();
  const info = new Map();
  for (const b of bones) {
    const m = TMP.m.copy(b.matrixWorld); m.premultiply(inv); const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); m.decompose(p, q, s);
    info.set(b, { restLocalQ: b.quaternion.clone(), restLocalP: b.position.clone(), restModelQ: q.clone(), restModelP: p.clone(), scale: s.clone() });
  }
  const rest = {}; for (const k in B) rest[k] = info.get(B[k]).restModelP.clone();
  const restHand = {}; for (const k in arms) restHand[k] = info.get(arms[k].w).restModelP.clone();
  const lens = {}; for (const k in arms) { const r = arms[k]; lens[k] = { l1: info.get(r.a).restModelP.distanceTo(info.get(r.e).restModelP.clone()), l2: info.get(r.e).restModelP.distanceTo(info.get(r.w).restModelP.clone()) }; }
  // bone order (parents first) for the FK pass
  const order = bones.slice();
  return { modelGroup, scene, bones: B, arms, skinned, info, order, rest, restHand, lens, allBones: bones };
}

/** Pose driver. pose = { d:{ boneKey:[rx,ry,rz] model-space euler deltas }, off:[x,y,z] hips offset (meters, model space/unscaled), ik:{UL:{p:Vector3 modelSpace, pole:Vector3, twist}}, curl:{UL:0..1} } */
export class FaPoser {
  constructor(rig) {
    this.rig = rig; this.dq = new Map(); this.keyOf = new Map();
    for (const k in rig.bones) if (rig.bones[k]) this.keyOf.set(rig.bones[k], k);
    for (const k in rig.arms) { const a = rig.arms[k]; this.keyOf.set(a.a, 'a' + k); this.keyOf.set(a.e, 'e' + k); this.keyOf.set(a.w, 'w' + k); this.keyOf.set(a.sh, 's' + k); }
    this.restFingerAxis = new THREE.Vector3(1, 0, 0);
    this.fingerSign = { UL: 1, UR: 1, LL: 1, LR: 1 };
  }
  apply(pose) {
    const R = this.rig, info = R.info, d = pose.d || {};
    // ---- FK in model space
    const Dt = new Map(), Wm = new Map();
    for (const b of R.allBones) {
      const key = this.keyOf.get(b), e = key && d[key];
      const par = b.parent && info.has(b.parent) ? b.parent : null;
      const Dp = par ? Dt.get(par) : null;
      const D = TMP.q.identity(); let Dtot;
      if (e) { TMP.e.set(e[0], e[1], e[2], 'XYZ'); D.setFromEuler(TMP.e); }
      Dtot = Dp ? D.clone().multiply(Dp) : D.clone();
      Dt.set(b, Dtot);
      const inf = info.get(b), rq = inf.restModelQ;
      const Wb = Dtot.clone().multiply(rq); Wm.set(b, Wb);
      if (par) { const Wp = Wm.get(par); b.quaternion.copy(Wp.clone().invert().multiply(Wb)); }
      else b.quaternion.copy(inf.restLocalQ);
      b.position.copy(inf.restLocalP);
    }
    if (pose.off) {                   // pelvis offset (model space) -> local of hips' parent frame
      const h = R.bones.hips, par = h.parent, pq = info.has(par) ? Wm.get(par) : info.get(par)?.restModelQ || new THREE.Quaternion();
      const v = TMP.v.set(pose.off[0], pose.off[1], pose.off[2]).applyQuaternion(pq.clone().invert());
      const ps = info.get(par)?.scale || new THREE.Vector3(1, 1, 1); h.position.add(v.divide(ps).divideScalar(R.modelGroup.scale.x));
    }
    R.scene.updateMatrixWorld(true);
    this.Dt = Dt;
    { const g0 = R.modelGroup, inv0 = new THREE.Matrix4().copy(g0.matrixWorld).invert(); this.cp = new THREE.Vector3().setFromMatrixPosition(R.bones.chest.matrixWorld).applyMatrix4(inv0).multiplyScalar(g0.scale.x); this.Dtc = Dt.get(R.bones.chest).clone(); }
    // ---- IK arms (targets relative to the chest by default so hands follow torso lean/twist; frame:'w' = character space)
    if (pose.ik) {
      const g = R.modelGroup, sc = g.scale.x, inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
      const cp = new THREE.Vector3().setFromMatrixPosition(R.bones.chest.matrixWorld).applyMatrix4(inv).multiplyScalar(sc), Dtc = Dt.get(R.bones.chest);
      for (const k in pose.ik) {
        const t = pose.ik[k]; if (!t || !t.p) continue; let p = t.p, pole = t.pole;
        if (t.frame !== 'w') { p = p.clone().applyQuaternion(Dtc).add(cp); if (pole) pole = pole.clone().applyQuaternion(Dtc); }
        this.ik(k, { p, pole, twist: t.twist });
      }
    }
    // ---- fingers
    for (const k in R.arms) { const c = pose.curl ? (pose.curl[k] ?? 0.25) : 0.25; for (const f of R.arms[k].fingers) { const inf = info.get(f); f.quaternion.copy(inf.restLocalQ); if (c !== 0) { TMP.q2.setFromAxisAngle(this.restFingerAxis, this.fingerSign[k] * c * 1.15); f.quaternion.multiply(TMP.q2); } } }
    R.modelGroup.updateMatrixWorld(true);
  }
  /** two-bone IK; target is in MODEL space (unscaled meters of the model) */
  ik(k, t) {
    const R = this.rig, A = R.arms[k], g = R.modelGroup, sc = g.scale.x;
    const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
    const wp = (o) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).applyMatrix4(inv);
    const a = wp(A.a), e = wp(A.e), w = wp(A.w), T = t.p.clone().divideScalar(sc);
    const l1 = a.distanceTo(e), l2 = e.distanceTo(w); let dir = T.clone().sub(a), dist = dir.length(); if (dist < 1e-5) return; dir.multiplyScalar(1 / dist);
    const reach = Math.min(dist, (l1 + l2) * 0.999), minr = Math.abs(l1 - l2) * 1.001 + 1e-3, dd = Math.max(reach, minr);
    // elbow position: along dir by x, perpendicular toward the pole by h
    const x = (l1 * l1 - l2 * l2 + dd * dd) / (2 * dd), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
    const pole = (t.pole || new THREE.Vector3(side(A) * 0.6, -0.8, -0.5)).clone(); pole.addScaledVector(dir, -pole.dot(dir)); if (pole.lengthSq() < 1e-6) pole.set(0, -1, 0); pole.normalize();
    const E = a.clone().addScaledVector(dir, x).addScaledVector(pole, h), W = a.clone().addScaledVector(dir, dd);
    const rot = (bone, from, to) => {      // rotate bone so its child direction (from) -> (to), in model space
      const q = TMP.q.setFromUnitVectors(from.clone().normalize(), to.clone().normalize());
      const cur = new THREE.Quaternion(); const bm = new THREE.Matrix4().multiplyMatrices(inv, bone.matrixWorld); bm.decompose(new THREE.Vector3(), cur, new THREE.Vector3());
      const nw = q.clone().multiply(cur);
      const pm = new THREE.Matrix4().multiplyMatrices(inv, bone.parent.matrixWorld), pq = new THREE.Quaternion(); pm.decompose(new THREE.Vector3(), pq, new THREE.Vector3());
      bone.quaternion.copy(pq.invert().multiply(nw)); bone.updateMatrixWorld(true);
    };
    rot(A.a, e.clone().sub(a), E.clone().sub(a));
    const e2 = wp(A.e), w2 = wp(A.w); rot(A.e, w2.clone().sub(e2), W.clone().sub(e2));
    if (t.twist) { const wq = TMP.q2.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.twist); A.e.quaternion.multiply(wq); }
    A.e.updateMatrixWorld(true);
  }
}
const side = (A) => A.side;
