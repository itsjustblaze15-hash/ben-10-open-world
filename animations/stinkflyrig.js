// Stinkfly rig wrapper. The supplied GLB is a real skinned model (67 bones: pelvis / 3 spine / neck / head / jaw, FOUR 4-bone legs, two arms with 3-finger claws, a single bone per wing,
// FOUR 3-bone eyestalks and a 3-bone tail with a stinger) with NO animation clips, so the pose is driven procedurally here. Geometry / textures / materials / bones are used exactly as shipped.
//  - The file is in metres and faces +X: the glTF scene node is turned -90 deg about Y so the wrapper ("model space") faces +Z, model-left = +X, Y up.
//  - The loose Omnitrix meshes the author left unskinned are re-parented to the head bone (world transform kept) so the symbol follows the body.
//  - FK deltas are model-space euler angles on top of the bind pose (children follow): body, neck, head, jaw, tail, wings, eyestalks, fingers.
//  - Legs and arms use a chain IK (FABRIK + pole) that only rotates the bones (lengths never change): feet stay planted on the ground, claws reach the target.
//  - Where the mesh sticks out past the last bone (leg tips, claws, eyestalk tips, stinger) the true tip is found from the skin weights (farthest vertex of the bone) - so the
//    slime leaves the REAL eyestalk tip and the tail / claw contact points are the real geometry's ends.
//  - Wing flapping rotates the wing bones (the wing mesh is skinned to them) - nothing is detached or replaced. A faint swept-arc "blur" is drawn only while the flap is fast.
import * as THREE from 'three';

export const SF_SCALE = 1.9;
const V3 = THREE.Vector3, Q4 = THREE.Quaternion, M4 = THREE.Matrix4;
const find = (scene, re) => { let r = null; scene.traverse(o => { if (!r && o.isBone && re.test(o.name)) r = o; }); return r; };
export const LEGS = ['L1', 'R1', 'L2', 'R2'];          // L1/R1 = front pair (attached to the upper spine), L2/R2 = rear pair (attached to the pelvis)
export const EYES = ['L1', 'L2', 'R1', 'R2'];

export function buildStinkflyRig(gltfScene) {
  const scene = gltfScene, modelGroup = new THREE.Group(); modelGroup.add(scene);
  scene.rotation.y = -Math.PI / 2; scene.updateMatrixWorld(true);
  const B = { hips: find(scene, /^bip_pelvis/), spine: find(scene, /^bip_spine_0/), chest: find(scene, /^bip_spine_1/), spine2: find(scene, /^bip_spine_2/), neck: find(scene, /^bip_neck/), head: find(scene, /^bip_head/), jaw: find(scene, /^Jaw_/), wingL: find(scene, /^bip_wing_L/), wingR: find(scene, /^bip_wing_R/) };
  for (const k in B) if (!B[k]) console.warn('Stinkfly rig: bone missing', k);
  const tail = []; for (let i = 0; i < 3; i++) tail.push(find(scene, new RegExp('^bip_tail_' + i + '_')));
  const legs = {}; for (const k of LEGS) { legs[k] = []; for (let i = 0; i < 4; i++) legs[k].push(find(scene, new RegExp('^bip_leg_' + k + '_' + i + '_'))); }
  const eyes = {}; for (const k of EYES) { eyes[k] = []; for (let i = 0; i < 3; i++) eyes[k].push(find(scene, new RegExp('^bip_eyetub_' + k + '_' + i + '_'))); }
  const arms = {};
  for (const k of ['L', 'R']) {
    arms[k] = { a: find(scene, new RegExp('^bip_upperArm_' + k)), e: find(scene, new RegExp('^bip_lowerArm_' + k)), w: find(scene, new RegExp('^bip_hand_' + k)), fingers: [], side: k === 'L' ? 1 : -1 };
    arms[k].w.traverse(o => { if (o.isBone && o !== arms[k].w) arms[k].fingers.push(o); });
  }
  { const p = new V3().setFromMatrixPosition(B.chest.matrixWorld); scene.position.set(-p.x, 0, -p.z); scene.updateMatrixWorld(true); }
  // the unskinned Omnitrix parts ride on the head bone (nothing about them is changed)
  const attached = []; scene.traverse(o => { if (!o.isBone && /^omni_cl_/.test(o.name)) attached.push(o); });
  for (const n of attached) B.head.attach(n);
  const skinned = []; scene.traverse(o => { if (o.isSkinnedMesh) { skinned.push(o); o.frustumCulled = false; o.castShadow = true; o.receiveShadow = false; } else if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; } });
  scene.updateMatrixWorld(true);
  const bones = []; scene.traverse(o => { if (o.isBone) bones.push(o); });
  const inv = new M4().copy(modelGroup.matrixWorld).invert(), info = new Map(), m = new M4();
  for (const b of bones) { m.copy(b.matrixWorld).premultiply(inv); const p = new V3(), q = new Q4(), s = new V3(); m.decompose(p, q, s); info.set(b, { restLocalQ: b.quaternion.clone(), restLocalP: b.position.clone(), restLocalS: b.scale.clone(), restModelQ: q.clone(), restModelP: p.clone() }); }

  // ---- true tips from the skin weights: farthest vertex (in the target bone's own space) among the vertices dominated by `set`
  const sk = skinned[0], bi = (b) => sk.skeleton.boneInverses[sk.skeleton.bones.indexOf(b)];
  const _v = new V3();
  const tipOf = (target, set) => {
    let best = null, bd = -1; const bm = bi(target);
    for (const mesh of skinned) {
      const g = mesh.geometry, pos = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, bones2 = mesh.skeleton.bones;
      for (let i = 0; i < pos.count; i++) {
        let dom = -1, dw = 0.45; for (let j = 0; j < 4; j++) { const w = sw.getComponent(i, j); if (w > dw) { dw = w; dom = si.getComponent(i, j); } }
        if (dom < 0 || !set.has(bones2[dom])) continue;
        _v.fromBufferAttribute(pos, i).applyMatrix4(mesh.bindMatrix).applyMatrix4(bm); const d = _v.length(); if (d > bd) { bd = d; best = _v.clone(); }
      }
    }
    return best || new V3(0, 0.05, 0);
  };
  const tips = { legs: {}, eyes: {}, claw: {}, tail: null };
  for (const k of LEGS) tips.legs[k] = tipOf(legs[k][3], new Set([legs[k][3]]));
  for (const k of EYES) tips.eyes[k] = tipOf(eyes[k][2], new Set([eyes[k][2]]));
  for (const k of ['L', 'R']) tips.claw[k] = tipOf(arms[k].w, new Set([arms[k].w, ...arms[k].fingers]));
  tips.tail = tipOf(tail[2], new Set([tail[2]]));
  tips.jaw = tipOf(B.jaw, new Set([B.jaw, ...(B.jaw.children.filter(c => c.isBone))]));

  // ---- finger curl hinge axes (about the axis perpendicular to the finger and to world-up in the bind pose)
  const down = new V3(0, -1, 0), curl = new Map();
  for (const k in arms) {
    for (const f of arms[k].fingers) {
      const kid = f.children.find(c => c.isBone); let dir;
      if (kid) dir = info.get(kid).restModelP.clone().sub(info.get(f).restModelP).normalize(); else dir = info.get(f).restModelP.clone().sub(info.get(f.parent).restModelP).normalize();
      const hMod = new V3().crossVectors(dir, down).normalize(), hLoc = hMod.applyQuaternion(info.get(f).restModelQ.clone().invert());
      let depth = 0, o = f; while (o && o !== arms[k].w) { depth++; o = o.parent; }
      curl.set(f, { axis: hLoc, depth: depth - 1, isThumb: /thumb/.test(f.name) });
    }
  }
  const rest = {}; for (const k in B) if (B[k]) rest[k] = info.get(B[k]).restModelP.clone();
  const mats = new Map(); scene.traverse(o => { if (o.isMesh) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const mm of ms) if (!mats.has(mm.uuid)) mats.set(mm.uuid, mm); } });
  const bodyMats = [...mats.values()].filter(mm => /Black_Body|White_Body|Body_1/.test(mm.name));
  for (const mm of bodyMats) { mm.userData.e0 = mm.emissive ? mm.emissive.clone() : new THREE.Color(0); }
  const wingMat = [...mats.values()].find(mm => /Glass/.test(mm.name)) || null;
  // ---- wing "blur": a faint swept arc (one per wing), only visible while the flap is fast. Lives in the wrapper (body-lean frame), centred on the wing pivots.
  const blur = {}, N = 14;
  for (const k of ['L', 'R']) {
    const pw = new V3().setFromMatrixPosition(B['wing' + k].matrixWorld).applyMatrix4(inv);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((N + 1) * 2 * 3), 3));
    const idx = []; for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } geo.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({ color: 0xd9e6a0, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, fog: true, toneMapped: false });
    const mesh = new THREE.Mesh(geo, mat); mesh.position.copy(pw); mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = 4; modelGroup.add(mesh);
    blur[k] = { mesh, geo, mat, N, pivot: pw.clone() };
  }
  scene.updateMatrixWorld(true);
  const report = { bones: bones.length, legs: LEGS.map(k => legs[k].length), eyestalks: EYES.length, wings: 2, tipLegs: LEGS.map(k => +tips.legs[k].length().toFixed(3)), tipEye: EYES.map(k => +tips.eyes[k].length().toFixed(3)), tipClaw: ['L', 'R'].map(k => +tips.claw[k].length().toFixed(3)), tipTail: +tips.tail.length().toFixed(3) };
  return { modelGroup, scene, bones: B, tail, legs, eyes, arms, skinned, info, allBones: bones, rest, curl, tips, mats: [...mats.values()], bodyMats, wingMat, attached, blur, report };
}

/** swept-arc blur: stroke angle range [a0, a1] (radians from vertical, measured outward) per wing; `len` = wing length in model units, `chord` = fore/aft extent. Alpha scales with flap speed. */
export function updateWingBlur(rig, a0, a1, alpha) {
  for (const k of ['L', 'R']) {
    const b = rig.blur[k], s = k === 'L' ? 1 : -1, pos = b.geo.attributes.position, N = b.N, r0 = 0.42, r1 = 0.98;
    b.mesh.visible = alpha > 0.01; if (!b.mesh.visible) continue; b.mat.opacity = alpha;
    for (let i = 0; i <= N; i++) { const a = a0 + (a1 - a0) * i / N, sx = Math.sin(a) * s, cy = Math.cos(a); pos.setXYZ(i * 2, sx * r0, cy * r0, -0.42); pos.setXYZ(i * 2 + 1, sx * r1, cy * r1, -0.42); }
    pos.needsUpdate = true;
  }
}

const _P = new M4();
/** Pose driver. pose = { d:{ key:[rx,ry,rz] model-space euler deltas }, legs:{ L1:{p,w,pole} }, arms:{ L:{p,w,pole} }, curl:{L,R} }
 *  keys: hips spine chest spine2 neck head jaw tail0..2 wingL wingR e<K>_<i> (eyestalks) lg<K>_<i> (legs) uaL laL haL uaR laR haR. IK targets are WORLD positions. */
export class SfPoser {
  constructor(rig) {
    this.rig = rig; this.keyOf = new Map(); const R = rig;
    for (const k in R.bones) if (R.bones[k]) this.keyOf.set(R.bones[k], k);
    R.tail.forEach((b, i) => this.keyOf.set(b, 'tail' + i));
    for (const k of LEGS) R.legs[k].forEach((b, i) => this.keyOf.set(b, 'lg' + k + '_' + i));
    for (const k of EYES) R.eyes[k].forEach((b, i) => this.keyOf.set(b, 'e' + k + '_' + i));
    for (const k in R.arms) { const A = R.arms[k]; this.keyOf.set(A.a, 'ua' + k); this.keyOf.set(A.e, 'la' + k); this.keyOf.set(A.w, 'ha' + k); }
    this.e1 = new THREE.Euler(); this.q1 = new Q4(); this.zero = new V3();
    this.tipW = { L: new V3(), R: new V3() }; this.footW = {}; for (const k of LEGS) this.footW[k] = new V3();
  }
  apply(pose) {
    const R = this.rig, info = R.info, d = pose.d || {}, Dt = new Map(), Wm = new Map(), q1 = this.q1;
    for (const b of R.allBones) {
      const key = this.keyOf.get(b), e = key && d[key], inf = info.get(b), par = b.parent && info.has(b.parent) ? b.parent : null, Dp = par ? Dt.get(par) : null;
      q1.identity(); if (e) { this.e1.set(e[0], e[1], e[2], 'XYZ'); q1.setFromEuler(this.e1); }
      const Dtot = Dp ? q1.clone().multiply(Dp) : q1.clone(); Dt.set(b, Dtot);
      const Wb = Dtot.clone().multiply(inf.restModelQ); Wm.set(b, Wb);
      if (par) b.quaternion.copy(Wm.get(par).clone().invert().multiply(Wb)); else b.quaternion.copy(inf.restLocalQ);
      b.position.copy(inf.restLocalP); b.scale.copy(inf.restLocalS);
    }
    R.scene.updateMatrixWorld(true);
    if (pose.legs) for (const k of LEGS) { const t = pose.legs[k]; if (t && t.w > 0.001) this.solveChain(R.legs[k], R.tips.legs[k], t.p, t.pole, t.w, t.poleW ?? 1); }
    if (pose.arms) for (const k of ['L', 'R']) { const t = pose.arms[k]; if (t && t.w > 0.001) this.solveChain([R.arms[k].a, R.arms[k].e, R.arms[k].w], R.tips.claw[k], t.p, t.pole, t.w, t.poleW ?? 1); }
    if (pose.eyes) for (const k of EYES) { const t = pose.eyes[k]; if (t && t.w > 0.001) this.solveChain(R.eyes[k], R.tips.eyes[k], t.p, null, t.w, 0); }
    // fingers: curl about the hinge axis computed from the bind pose (base joint bends least, middle most, tip some)
    const amt = [0.55, 1.15, 0.7];
    for (const k in R.arms) {
      const c = pose.curl ? (pose.curl[k] ?? 0.2) : 0.2;
      for (const f of R.arms[k].fingers) { const inf = info.get(f), cf = R.curl.get(f); f.quaternion.copy(inf.restLocalQ); if (c !== 0 && cf) { q1.setFromAxisAngle(cf.axis, c * amt[Math.min(2, cf.depth)] * (cf.isThumb ? 0.8 : 1)); f.quaternion.multiply(q1); } }
    }
    R.modelGroup.updateMatrixWorld(true);
    for (const k of ['L', 'R']) R.arms[k].w.localToWorld(this.tipW[k].copy(R.tips.claw[k]));
    for (const k of LEGS) R.legs[k][3].localToWorld(this.footW[k].copy(R.tips.legs[k]));
  }
  /** FABRIK on the chain's joint positions (world), pole = direction the middle joints should bow toward, then the bones are turned to follow (rigid: only rotations change). w = IK weight (0 = keep the FK pose). */
  solveChain(bones, tipLocal, targetW, poleW, w, poleK) {
    const n = bones.length, P = [], L = [], pre = bones.map(b => b.quaternion.clone());
    for (const b of bones) P.push(b.getWorldPosition(new V3())); P.push(bones[n - 1].localToWorld(tipLocal.clone()));
    for (let i = 0; i < n; i++) L.push(P[i + 1].distanceTo(P[i]));
    const total = L.reduce((a, b) => a + b, 0), root = P[0].clone(); let T = targetW.clone(); const dist = T.distanceTo(root);
    if (dist > total * 0.998) { const dir0 = T.clone().sub(root).normalize(); T.copy(root).addScaledVector(dir0, total * 0.998); }
    for (let it = 0; it < 10; it++) {
      P[n].copy(T); for (let i = n - 1; i >= 0; i--) { const dir = P[i].clone().sub(P[i + 1]).normalize(); P[i].copy(P[i + 1]).addScaledVector(dir, L[i]); }
      P[0].copy(root); for (let i = 0; i < n; i++) { const dir = P[i + 1].clone().sub(P[i]).normalize(); P[i + 1].copy(P[i]).addScaledVector(dir, L[i]); }
      if (P[n].distanceTo(T) < 1e-3 * (this.eps ?? 1)) break;
    }
    if (poleW && poleK > 0 && n >= 2) {
      const axis = T.clone().sub(root).normalize(), a = P[1].clone().sub(root), wnt = poleW.clone();
      a.addScaledVector(axis, -a.dot(axis)); wnt.addScaledVector(axis, -wnt.dot(axis));
      if (a.lengthSq() > 1e-8 && wnt.lengthSq() > 1e-8) {
        a.normalize(); wnt.normalize(); let ang = Math.acos(THREE.MathUtils.clamp(a.dot(wnt), -1, 1)); if (new V3().crossVectors(a, wnt).dot(axis) < 0) ang = -ang; ang *= poleK;
        const qr = new Q4().setFromAxisAngle(axis, ang); for (let i = 1; i < n; i++) { P[i].sub(root).applyQuaternion(qr).add(root); }
      }
    }
    const qw = new Q4(), qp = new Q4(), qd = new Q4(), cur = new V3(), nxt = new V3(), bp = new V3(), cp = new V3();
    for (let i = 0; i < n; i++) {
      const b = bones[i]; b.updateMatrixWorld(true); b.getWorldPosition(bp); if (i < n - 1) bones[i + 1].getWorldPosition(cp); else cp.copy(bones[n - 1].localToWorld(tipLocal.clone()));
      cur.copy(cp).sub(bp).normalize(); nxt.copy(P[i + 1]).sub(P[i]).normalize(); if (cur.lengthSq() < 1e-9 || nxt.lengthSq() < 1e-9) continue;
      qd.setFromUnitVectors(cur, nxt); b.getWorldQuaternion(qw); qw.premultiply(qd);
      if (b.parent) { b.parent.getWorldQuaternion(qp); b.quaternion.copy(qp.invert().multiply(qw)); } else b.quaternion.copy(qw);
      b.updateMatrixWorld(true);
    }
    if (w < 0.999) { for (let i = 0; i < n; i++) { const ik = bones[i].quaternion.clone(); bones[i].quaternion.copy(pre[i]).slerp(ik, w); } bones[0].updateMatrixWorld(true); }
  }
  /** world position of the real eyestalk tip / stinger / claw tip */
  eyeTip(k, out) { return this.rig.eyes[k][2].localToWorld(out.copy(this.rig.tips.eyes[k])); }
  tailTip(out) { return this.rig.tail[2].localToWorld(out.copy(this.rig.tips.tail)); }
  clawTip(k, out) { return this.rig.arms[k].w.localToWorld(out.copy(this.rig.tips.claw[k])); }
  mouth(out) { return this.rig.bones.jaw.localToWorld(out.copy(this.rig.tips.jaw)); }
}

// ---------------------------------------------------------------------------------------------------------------- pose helpers
export const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const D = (x = 0, y = 0, z = 0) => [x, y, z];
export const mkPose = () => ({ d: {}, legs: {}, arms: {}, eyes: {}, curl: {}, w: 1 });
const lerp = (a, b, t) => a + (b - a) * t, clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ZERO = [0, 0, 0];
/** blend layer A over pose P with weight A.w (d: euler lerp; legs/arms: target + weight lerp; curl lerp) */
export function layerS(P, A) {
  const w = A.w ?? 1; if (w <= 0.001) return P;
  for (const key in A.d) { const a = P.d[key] || ZERO, b = A.d[key]; P.d[key] = [lerp(a[0], b[0], w), lerp(a[1], b[1], w), lerp(a[2], b[2], w)]; }
  for (const grp of ['legs', 'arms', 'eyes']) for (const k in (A[grp] || {})) {
    const e = A[grp][k], b = P[grp][k], wt = clamp((e.w ?? 1) * w, 0, 1); if (wt <= 0.001) continue;
    if (!b || b.w < 0.001) { P[grp][k] = { p: e.p, pole: e.pole, w: wt, poleW: e.poleW }; continue; }
    P[grp][k] = { p: b.p.clone().lerp(e.p, wt), pole: b.pole && e.pole ? b.pole.clone().lerp(e.pole, wt) : (e.pole || b.pole), w: Math.max(b.w, wt), poleW: e.poleW ?? b.poleW };
  }
  if (A.curl) for (const k in A.curl) P.curl[k] = lerp(P.curl[k] ?? 0.2, A.curl[k], w);
  return P;
}
export { _P };
