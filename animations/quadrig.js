// Wildmutt rig wrapper. The supplied GLB already has a real 84-bone skinned skeleton (spine, neck/head/jaw/tongue, two forelimbs with fingers, two hind legs with toes)
// but NO animation clips, so the pose is driven procedurally here. Geometry / textures / materials / bones of the GLB are used untouched.
//  - The file is authored in centimetres, faces +X, arms spread wide. The glTF scene node is turned -90 deg about Y so the wrapper ("model space") faces +Z, model-left = +X, Y up,
//    and the origin is moved to the middle of the body (butt .. nose) so it can be used as the collision centre.
//  - FK deltas are euler angles in MODEL space on top of the bind pose (spine / neck / head / jaw); children follow.
//  - All four limbs are solved with a two-bone IK to a wrist / ankle target in character space, then the paw is oriented (forward + dorsal direction) and the digits curl.
import * as THREE from 'three';

export const WM_SCALE = 0.019;
export const LIMBS = ['FL', 'FR', 'HL', 'HR'];
const TMP = { q: new THREE.Quaternion(), q2: new THREE.Quaternion(), v: new THREE.Vector3(), e: new THREE.Euler(), m: new THREE.Matrix4(), m2: new THREE.Matrix4() };

export const WM_CFG = {
  faceRot: -Math.PI / 2,
  bones: { hips: /^bip_pelvis_01$/, spine0: /^bip_spine_0_02$/, spine1: /^bip_spine_1_03$/, spine2: /^bip_spine_2_04$/, neck: /^bip_neck_023$/, head: /^bip_head_024$/, jaw: /^bip_Jaw_025$/,
    tongue0: /^bip_tongue_0_026$/, tongue1: /^bip_tongue_1_027$/, tongue2: /^bip_tongue_2_028$/, tongue3: /^bip_tongue_3_029$/ },
  limbs: {
    FL: { front: true, side: 1, a: /^bip_upperArm_L_05$/, e: /^bip_lowerArm_L_06$/, w: /^bip_hand_L_07$/, digits: [/^bip_index_0_L_08$/, /^bip_middle_0_L_012$/, /^bip_pinky_0_L_016$/], index: /^bip_index_0_L_08$/, pinky: /^bip_pinky_0_L_016$/ },
    FR: { front: true, side: -1, a: /^bip_upperArm_R_031$/, e: /^bip_lowerArm_R_032$/, w: /^bip_hand_R_033$/, digits: [/^bip_index_0_R_038$/, /^bip_middle_0_R_042$/, /^bip_pinky_0_R_046$/], index: /^bip_index_0_R_038$/, pinky: /^bip_pinky_0_R_046$/ },
    HL: { front: false, side: 1, a: /^bip_hip_L_050$/, e: /^bip_knee_L_051$/, w: /^bip_foot_L_052$/, digits: [/^bip_toe_index_L_057$/, /^bip_toe_middle_L_053$/, /^bip_toe_pinky_L_055$/], index: /^bip_toe_index_L_057$/, pinky: /^bip_toe_pinky_L_055$/ },
    HR: { front: false, side: -1, a: /^bip_hip_R_059$/, e: /^bip_knee_R_060$/, w: /^bip_foot_R_061$/, digits: [/^bip_toe_index_R_064$/, /^bip_toe_middle_R_062$/, /^bip_toe_pinky_R_066$/], index: /^bip_toe_index_R_064$/, pinky: /^bip_toe_pinky_R_066$/ },
  },
  attach: [[/^omnitirx$/, 'FL']],        // the loose Omnitrix dial mesh follows the left upper arm (the skinned watch parts already do)
};

const find = (scene, re) => { let r = null; scene.traverse(o => { if (!r && o.isBone && re.test(o.name)) r = o; }); return r; };
const findNode = (scene, re) => { let r = null; scene.traverse(o => { if (!r && !o.isBone && re.test(o.name)) r = o; }); return r; };

export function buildQuadRig(gltfScene) {
  const scene = gltfScene, modelGroup = new THREE.Group(); modelGroup.add(scene);
  const cfg = WM_CFG;
  scene.rotation.y = cfg.faceRot; scene.updateMatrixWorld(true);
  const B = {}; for (const k in cfg.bones) { B[k] = find(scene, cfg.bones[k]); if (!B[k]) console.warn('Wildmutt rig: bone missing', k); }
  const limbs = {};
  for (const k of LIMBS) {
    const d = cfg.limbs[k], L = limbs[k] = { key: k, side: d.side, front: d.front, a: find(scene, d.a), e: find(scene, d.e), w: find(scene, d.w), digits: d.digits.map(r => find(scene, r)), idx: find(scene, d.index), pin: find(scene, d.pinky), fingers: [], tips: [] };
    for (const n of ['a', 'e', 'w', 'idx', 'pin']) if (!L[n]) console.warn('Wildmutt rig: limb bone missing', k, n);
    L.w.traverse(o => { if (o.isBone && o !== L.w) { if (/end_end/i.test(o.name)) L.tips.push(o); else if (!/end/i.test(o.name)) L.fingers.push(o); } });
  }
  // origin: middle of the body (nose..butt along Z), centred between the shoulders in X
  { const bb = new THREE.Box3().setFromObject(scene); const sx = (new THREE.Vector3().setFromMatrixPosition(limbs.FL.a.matrixWorld).x + new THREE.Vector3().setFromMatrixPosition(limbs.FR.a.matrixWorld).x) / 2; scene.position.set(-sx, 0, -(bb.min.z + bb.max.z) / 2); scene.updateMatrixWorld(true); }
  // unskinned decoration -> bone children (world transform kept)
  const attached = [];
  for (const [re, key] of cfg.attach) { const n = findNode(scene, re), tgt = limbs[key] ? limbs[key].a : B[key]; if (n && tgt) { tgt.attach(n); attached.push(n); } else console.warn('Wildmutt rig: attach target missing', re); }
  const skinned = []; scene.traverse(o => { if (o.isSkinnedMesh) { skinned.push(o); o.frustumCulled = false; o.castShadow = true; o.receiveShadow = false; } else if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
  scene.updateMatrixWorld(true);
  const bones = []; scene.traverse(o => { if (o.isBone) bones.push(o); });
  const inv = new THREE.Matrix4().copy(modelGroup.matrixWorld).invert(), info = new Map();
  for (const b of bones) { const m = TMP.m.copy(b.matrixWorld); m.premultiply(inv); const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); m.decompose(p, q, s); info.set(b, { restLocalQ: b.quaternion.clone(), restLocalP: b.position.clone(), restModelQ: q.clone(), restModelP: p.clone(), scale: s.clone() }); }
  const P = (b) => info.get(b).restModelP;
  // per-limb geometry: segment lengths, paw forward / dorsal directions (in the wrist bone's own frame) and the curl axis of the digits
  for (const k of LIMBS) {
    const L = limbs[k]; L.l1 = P(L.a).distanceTo(P(L.e)); L.l2 = P(L.e).distanceTo(P(L.w));
    const mid = new THREE.Vector3(); for (const d of L.digits) mid.add(P(d)); mid.multiplyScalar(1 / L.digits.length);
    const f0 = mid.clone().sub(P(L.w)); L.pawLen = f0.length(); f0.normalize();
    const across = P(L.idx).clone().sub(P(L.pin)); across.addScaledVector(f0, -across.dot(f0)); across.normalize();
    // dorsal = the side that points up in the bind pose (hands / feet are palm-down / sole-down there)
    let n0 = new THREE.Vector3().crossVectors(across, f0).normalize(); if (n0.y < 0) n0.negate();
    L.f0 = f0; L.across0 = across; L.n0 = n0; L.tipLen = 0; for (const t of L.tips) L.tipLen = Math.max(L.tipLen, P(t).distanceTo(P(L.w)));
    const qi = info.get(L.w).restModelQ.clone().invert(); L.fl = f0.clone().applyQuaternion(qi); L.nl = n0.clone().applyQuaternion(qi);
    // digit curl: rotate about the across axis; sign chosen so the tips move toward the palm side (-dorsal)
    const tip = L.tips.length ? P(L.tips[0]).clone() : mid.clone().addScaledVector(f0, 0.1), piv = P(L.digits[0]);
    const rot = new THREE.Quaternion().setFromAxisAngle(across, 0.5), moved = tip.clone().sub(piv).applyQuaternion(rot).add(piv);
    L.curlSign = moved.sub(tip).dot(n0) < 0 ? 1 : -1;
    L.curlAxisLocal = {}; for (const f of L.fingers) L.curlAxisLocal[f.id] = across.clone().applyQuaternion(info.get(f).restModelQ.clone().invert());
    L.fingerRoots = L.digits;
  }
  // muzzle: the front of the teeth, stored in the head bone's own frame so it follows head / jaw movement
  let muzzle = null;
  { let teeth = null; for (const m of skinned) { const ms = Array.isArray(m.material) ? m.material : [m.material]; if (ms.some(x => x.name === 'Teeth')) teeth = m; }
    if (teeth) { const bb = new THREE.Box3().setFromObject(teeth), c = bb.getCenter(new THREE.Vector3()), tgt = new THREE.Vector3(c.x, c.y, bb.max.z); const mi = new THREE.Matrix4().copy(B.jaw.matrixWorld).invert(); muzzle = { bone: B.jaw, local: tgt.applyMatrix4(mi) }; } }
  const rest = {}; for (const k in B) if (B[k]) rest[k] = P(B[k]).clone();
  const restLimb = {}; for (const k of LIMBS) restLimb[k] = { a: P(limbs[k].a).clone(), e: P(limbs[k].e).clone(), w: P(limbs[k].w).clone() };
  const mats = new Map(); scene.traverse(o => { if (o.isMesh) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) if (!mats.has(m.name)) mats.set(m.name, m); } });
  return { modelGroup, scene, bones: B, limbs, skinned, info, order: bones.slice(), rest, restLimb, allBones: bones, attached, mats, cfg, muzzle };
}

/** Pose driver. pose = { d:{ boneKey:[rx,ry,rz] model-space euler deltas }, off:[x,y,z] pelvis offset (character metres),
 *  ik:{ FL:{ p:Vector3 wrist/ankle target (character metres), pole:Vector3 (bend direction), f:Vector3 paw forward, n:Vector3 paw dorsal, w } }, curl:{ FL:0..1 } } */
export class QuadPoser {
  constructor(rig) {
    this.rig = rig; this.keyOf = new Map();
    for (const k in rig.bones) if (rig.bones[k]) this.keyOf.set(rig.bones[k], k);
    this.inv = new THREE.Matrix4(); this.last = {};
  }
  apply(pose) {
    const R = this.rig, info = R.info, d = pose.d || {};
    const Dt = new Map(), Wm = new Map();
    for (const b of R.allBones) {
      const key = this.keyOf.get(b), e = key && d[key];
      const par = b.parent && info.has(b.parent) ? b.parent : null;
      const Dp = par ? Dt.get(par) : null;
      const D = TMP.q.identity(); if (e) { TMP.e.set(e[0], e[1], e[2], 'XYZ'); D.setFromEuler(TMP.e); }
      const Dtot = Dp ? D.clone().multiply(Dp) : D.clone(); Dt.set(b, Dtot);
      const inf = info.get(b), Wb = Dtot.clone().multiply(inf.restModelQ); Wm.set(b, Wb);
      if (par) b.quaternion.copy(Wm.get(par).clone().invert().multiply(Wb)); else b.quaternion.copy(inf.restLocalQ);
      b.position.copy(inf.restLocalP);
    }
    if (pose.off) {
      const h = R.bones.hips, par = h.parent, pq = info.has(par) ? Wm.get(par) : new THREE.Quaternion();
      const v = TMP.v.set(pose.off[0], pose.off[1], pose.off[2]).applyQuaternion(pq.clone().invert());
      const ps = info.get(par)?.scale || new THREE.Vector3(1, 1, 1); h.position.add(v.divide(ps).divideScalar(R.modelGroup.scale.x));
    }
    R.scene.updateMatrixWorld(true);
    this.inv.copy(R.modelGroup.matrixWorld).invert();
    if (pose.ik) for (const k of LIMBS) { const t = pose.ik[k]; if (t && t.p) this.solve(R.limbs[k], t); }
    // digits
    for (const k of LIMBS) {
      const L = R.limbs[k], c = pose.curl ? (pose.curl[k] ?? 0.3) : 0.3;
      for (let i = 0; i < L.fingers.length; i++) { const f = L.fingers[i], inf = info.get(f); f.quaternion.copy(inf.restLocalQ); if (c !== 0) { TMP.q2.setFromAxisAngle(L.curlAxisLocal[f.id], L.curlSign * c * (L.front ? 0.95 : 0.8)); f.quaternion.multiply(TMP.q2); } }
    }
    R.modelGroup.updateMatrixWorld(true);
    // ground contact: a limb with `ground` (character-space height of the surface under the paw) is re-solved so its lowest claw tip rests exactly on ground + lift
    if (pose.ik) {
      const sc = R.modelGroup.scale.x, lv = new THREE.Vector3();
      for (const k of LIMBS) {
        const t = pose.ik[k]; if (!t || !t.p || t.ground === undefined) continue; const L = R.limbs[k]; if (!L.tips.length) continue;
        let lo = 1e9; for (const tp of L.tips) lo = Math.min(lo, this.wp(tp, lv).y); lo *= sc;
        const dy = lo - (t.ground + (t.lift || 0));
        if (Math.abs(dy) > 5e-4) { const p2 = t.p.clone(); p2.y -= dy; this.solve(L, { ...t, p: p2 }); }
      }
      R.modelGroup.updateMatrixWorld(true);
    }
  }
  /** model-local (cm) quaternion of a bone's current world transform */
  wq(bone, out) { const m = TMP.m2.multiplyMatrices(this.inv, bone.matrixWorld); m.decompose(TMP.v, out, new THREE.Vector3()); return out; }
  wp(bone, out = new THREE.Vector3()) { return out.setFromMatrixPosition(bone.matrixWorld).applyMatrix4(this.inv); }
  /** swing bone so that its child direction `from` points along `to` (all model-local) */
  swing(bone, from, to) {
    const q = new THREE.Quaternion().setFromUnitVectors(from.clone().normalize(), to.clone().normalize());
    const cur = this.wq(bone, new THREE.Quaternion()), nw = q.multiply(cur), pq = this.wq(bone.parent, new THREE.Quaternion());
    bone.quaternion.copy(pq.invert().multiply(nw)); bone.updateMatrixWorld(true);
  }
  solve(L, t) {
    const sc = this.rig.modelGroup.scale.x, a = this.wp(L.a), e = this.wp(L.e), w = this.wp(L.w), T = t.p.clone().divideScalar(sc);
    const l1 = a.distanceTo(e), l2 = e.distanceTo(w); const dir = T.clone().sub(a); let dist = dir.length(); if (dist < 1e-5) return; dir.multiplyScalar(1 / dist);
    const reach = Math.min(dist, (l1 + l2) * 0.999), minr = Math.abs(l1 - l2) * 1.001 + 1e-3, dd = Math.max(reach, minr);
    const x = (l1 * l1 - l2 * l2 + dd * dd) / (2 * dd), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
    const pole = (t.pole || new THREE.Vector3(L.side * 0.6, 0.2, L.front ? -0.7 : 0.9)).clone(); pole.addScaledVector(dir, -pole.dot(dir)); if (pole.lengthSq() < 1e-6) pole.set(0, 1, 0); pole.normalize();
    const E = a.clone().addScaledVector(dir, x).addScaledVector(pole, h), W = a.clone().addScaledVector(dir, dd);
    this.swing(L.a, e.clone().sub(a), E.clone().sub(a));
    const e2 = this.wp(L.e), w2 = this.wp(L.w); this.swing(L.e, w2.clone().sub(e2), W.clone().sub(e2));
    // paw orientation: forward axis -> t.f, dorsal axis -> t.n (twist about the forward axis)
    if (t.f) {
      L.e.updateMatrixWorld(true); const qW = this.wq(L.w, new THREE.Quaternion()), f = t.f.clone().normalize();
      const fCur = L.fl.clone().applyQuaternion(qW), nCur = L.nl.clone().applyQuaternion(qW);
      const q = new THREE.Quaternion().setFromUnitVectors(fCur, f); nCur.applyQuaternion(q);
      if (t.n) {
        const pr = (v) => v.clone().addScaledVector(f, -v.dot(f)).normalize(), A = pr(nCur), Bn = pr(t.n), ang = Math.atan2(f.dot(new THREE.Vector3().crossVectors(A, Bn)), A.dot(Bn));
        q.premultiply(new THREE.Quaternion().setFromAxisAngle(f, ang));
      }
      const nw = q.multiply(qW), pq = this.wq(L.w.parent, new THREE.Quaternion()); L.w.quaternion.copy(pq.invert().multiply(nw)); L.w.updateMatrixWorld(true);
    }
  }
}
