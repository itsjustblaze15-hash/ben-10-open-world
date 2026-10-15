// Cannonbolt rig wrapper. TWO untouched GLB files are used:
//  - cannonbolt_ben_10.glb : the standing alien. A real skinned model (62 joints: hips / spine / chest, 4-bone arms with 4 fingers + thumb, short 3-bone legs + foot bones), NO animation clips,
//    modelled in a T-pose, facing +Z, 0.95 m tall. It has no neck / head / tail bone (the head is part of the chest mesh), so the head "turn" is a small chest twist.
//    Geometry / textures / materials / bones are used exactly as shipped. The only thing not drawn is the separate "Ultimate Spikes" mesh (it is the Ultimate-form add-on: it collapses to a blob
//    inside the chest in the normal bind pose).
//  - cannonball.glb : the ball form. One static mesh (622 vertices, 64x64 texture), node transform -90 deg about X; it is re-centred on its own bounding box and uniformly scaled to the collision radius.
//    Nothing is recoloured, re-proportioned or re-textured.
//  - The pose is driven procedurally on top of the bind pose: FK model-space euler deltas for the body, FABRIK IK for both arms (fist reaches the target) and both legs (feet stay planted),
//    finger curl about hinge axes found from the bind pose. Feet are held flat on the ground (ankle orientation = body yaw only).
import * as THREE from 'three';
import { SfPoser } from './stinkflyrig.js';

export const CB_SCALE = 2.5;       // standing model: 0.95 m -> 2.38 m
export const BALL_R = 0.95;        // physical ball radius (m)
const V3 = THREE.Vector3, Q4 = THREE.Quaternion, M4 = THREE.Matrix4;
const find = (scene, re) => { let r = null; scene.traverse(o => { if (!r && o.isBone && re.test(o.name)) r = o; }); return r; };
export const SIDES = ['L', 'R'];      // L = model-left = +X

export function buildCannonboltRig(standScene, ballScene) {
  const scene = standScene, modelGroup = new THREE.Group(); modelGroup.add(scene); scene.updateMatrixWorld(true);
  const B = { hips: find(scene, /^Hips_/), spine: find(scene, /^Spine_/), chest: find(scene, /^Chest_/) };
  const arms = {}, legs = {};
  for (const k of SIDES) {
    const nm = k === 'L' ? 'Left' : 'Right';
    arms[k] = { sh: find(scene, new RegExp('^' + nm + '[ _]shoulder_')), a: find(scene, new RegExp('^' + nm + '[ _]arm_')), e: find(scene, new RegExp('^' + nm + '[ _]elbow_')), w: find(scene, new RegExp('^' + nm + '[ _]wrist')), fingers: [], side: k === 'L' ? 1 : -1 };
    arms[k].w.traverse(o => { if (o.isBone && o !== arms[k].w) arms[k].fingers.push(o); });
    legs[k] = { hip: find(scene, new RegExp('^Right_WideLeg_' + k + '_')), knee: find(scene, new RegExp('^Right_WideKnee_' + k + '_')), ankle: find(scene, new RegExp('^Right_WideAnkle_' + k + '_\\d+$')), foot: [] };
    legs[k].ankle.traverse(o => { if (o.isBone) legs[k].foot.push(o); });
  }
  for (const k in B) if (!B[k]) console.warn('Cannonbolt rig: bone missing', k);
  // feet on y = 0 (the file's lowest vertex is at -0.01), centred on the hips in x / z
  { const box = new THREE.Box3().setFromObject(scene); scene.position.y -= box.min.y; const p = new V3().setFromMatrixPosition(B.hips.matrixWorld); scene.position.x -= p.x; scene.position.z -= p.z; scene.updateMatrixWorld(true); }
  // the Ultimate-form spike mesh is not part of the normal form
  const hidden = []; scene.traverse(o => { if (o.isMesh) { const ms = Array.isArray(o.material) ? o.material : [o.material]; if (ms.some(m => /Ultimate/i.test(m.name || '')) || /Ultimate/i.test(o.name)) { o.visible = false; hidden.push(o.name); } } });
  const skinned = []; scene.traverse(o => { if (o.isSkinnedMesh) { skinned.push(o); o.frustumCulled = false; o.castShadow = true; o.receiveShadow = false; } else if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; } });
  const bones = []; scene.traverse(o => { if (o.isBone) bones.push(o); });
  const inv = new M4().copy(modelGroup.matrixWorld).invert(), info = new Map(), m = new M4();
  for (const b of bones) { m.copy(b.matrixWorld).premultiply(inv); const p = new V3(), q = new Q4(), s = new V3(); m.decompose(p, q, s); info.set(b, { restLocalQ: b.quaternion.clone(), restLocalP: b.position.clone(), restLocalS: b.scale.clone(), restModelQ: q.clone(), restModelP: p.clone() }); }

  // ---- true extremities from the skin weights (farthest vertex of the bone's own vertices, in that bone's space); and the lowest point of each foot
  const sk = skinned.find(s => s.skeleton.bones.length) || skinned[0], bi = (b) => sk.skeleton.boneInverses[sk.skeleton.bones.indexOf(b)], _v = new V3();
  const eachVert = (set, fn) => {
    for (const mesh of skinned) {
      if (!mesh.visible) continue; const g = mesh.geometry, pos = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, bn = mesh.skeleton.bones;
      for (let i = 0; i < pos.count; i++) {
        let dom = -1, dw = 0.45; for (let j = 0; j < 4; j++) { const w = sw.getComponent(i, j); if (w > dw) { dw = w; dom = si.getComponent(i, j); } }
        if (dom < 0 || !set.has(bn[dom])) continue; fn(_v.fromBufferAttribute(pos, i).applyMatrix4(mesh.bindMatrix), mesh, bn[dom]);
      }
    }
  };
  const tipOf = (target, set) => { let best = null, bd = -1; const bm = bi(target); eachVert(set, (v) => { const q = v.clone().applyMatrix4(bm), d = q.length(); if (d > bd) { bd = d; best = q; } }); return best || new V3(0, 0.05, 0); };
  const tips = { arm: {}, ankleInKnee: {}, soleDrop: {} };
  for (const k of SIDES) {
    tips.arm[k] = tipOf(arms[k].w, new Set([arms[k].w, ...arms[k].fingers]));
    const L = legs[k]; tips.ankleInKnee[k] = L.knee.worldToLocal(L.ankle.getWorldPosition(new V3()));
    let low = Infinity; const fs = new Set(L.foot); const bw = new V3();
    eachVert(fs, (v, mesh, bone) => { bw.copy(v).applyMatrix4(bi(bone)); bone.localToWorld(bw); modelGroup.worldToLocal(bw); low = Math.min(low, bw.y); });
    tips.soleDrop[k] = L.ankle.getWorldPosition(new V3()).applyMatrix4(inv).y - (isFinite(low) ? low : 0);
  }
  // ---- finger curl hinge axes (perpendicular to the finger and to world-up in the bind pose)
  const down = new V3(0, -1, 0), curl = new Map();
  for (const k of SIDES) for (const f of arms[k].fingers) {
    const kid = f.children.find(c => c.isBone); let dir;
    if (kid) dir = info.get(kid).restModelP.clone().sub(info.get(f).restModelP).normalize(); else dir = info.get(f).restModelP.clone().sub(info.get(f.parent).restModelP).normalize();
    const hMod = new V3().crossVectors(dir, down).normalize(), hLoc = hMod.applyQuaternion(info.get(f).restModelQ.clone().invert());
    let depth = 0, o = f; while (o && o !== arms[k].w) { depth++; o = o.parent; }
    curl.set(f, { axis: hLoc, depth: depth - 1, isThumb: /thumb/i.test(f.name), end: /_end/.test(f.name) });
  }
  const rest = {}; for (const k in B) if (B[k]) rest[k] = info.get(B[k]).restModelP.clone();
  const mats = new Map(); scene.traverse(o => { if (o.isMesh) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const mm of ms) if (!mats.has(mm.uuid)) mats.set(mm.uuid, mm); } });
  const bodyMats = [...mats.values()].filter(mm => mm.emissive); for (const mm of bodyMats) mm.userData.e0 = mm.emissive.clone();
  scene.updateMatrixWorld(true);

  // ---- the ball: its own group, centred, scaled to BALL_R
  const ball = new THREE.Group(); ball.name = 'CannonboltBall'; const inner = new THREE.Group(); inner.add(ballScene); ball.add(inner); ball.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(ballScene), ctr = bb.getCenter(new V3()), size = bb.getSize(new V3()), avgR = (size.x + size.y + size.z) / 6;
  ballScene.position.sub(ctr); ballScene.updateMatrixWorld(true); inner.scale.setScalar(BALL_R / avgR);
  let ballVerts = 0, ballMesh = null; ballScene.traverse(o => { if (o.isMesh) { ballVerts += o.geometry.attributes.position.count; o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false; ballMesh = o; } });
  const ballMats = []; ballScene.traverse(o => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach(mm => ballMats.push(mm)); });
  const report = { bones: bones.length, hidden, armTip: SIDES.map(k => +tips.arm[k].length().toFixed(3)), soleDrop: SIDES.map(k => +tips.soleDrop[k].toFixed(3)), ball: { verts: ballVerts, size: size.toArray().map(v => +v.toFixed(3)), scale: +(BALL_R / avgR).toFixed(3), R: BALL_R } };
  return { modelGroup, scene, bones: B, arms, legs, skinned, info, allBones: bones, rest, curl, tips, mats: [...mats.values()], bodyMats, ball: { group: ball, inner, mesh: ballMesh, mats: ballMats, radius: BALL_R }, report };
}

const _tq = new Q4(), _pq = new Q4(), _qi = new Q4(), _ap = new V3(), _ao = new V3(), _po = new V3();
/** Pose driver. pose = { d:{ key:[rx,ry,rz] model-space euler deltas }, legs:{ L:{p,w,pole} }, arms:{ L:{p,w,pole} }, curl:{L,R}, foot:{ q: Quaternion (world yaw), w } }
 *  keys: hips spine chest shL shR uaL laL haL uaR laR haR lgL_0 lgL_1 lgL_2 lgR_0 lgR_1 lgR_2.  IK targets are WORLD positions. */
export class CbPoser {
  constructor(rig) {
    this.rig = rig; this.keyOf = new Map(); const R = rig;
    for (const k in R.bones) if (R.bones[k]) this.keyOf.set(R.bones[k], k);
    for (const k of SIDES) { const A = R.arms[k]; this.keyOf.set(A.sh, 'sh' + k); this.keyOf.set(A.a, 'ua' + k); this.keyOf.set(A.e, 'la' + k); this.keyOf.set(A.w, 'ha' + k); const L = R.legs[k]; this.keyOf.set(L.hip, 'lg' + k + '_0'); this.keyOf.set(L.knee, 'lg' + k + '_1'); this.keyOf.set(L.ankle, 'lg' + k + '_2'); }
    this.e1 = new THREE.Euler(); this.q1 = new Q4(); this.fistW = { L: new V3(), R: new V3() }; this.ankleW = { L: new V3(), R: new V3() }; this.kneeW = { L: new V3(), R: new V3() };
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
    if (pose.legs) for (const k of SIDES) { const t = pose.legs[k]; if (t && t.w > 0.001) { this.solveChain([R.legs[k].hip, R.legs[k].knee], R.tips.ankleInKnee[k], t.p, t.pole, t.w, t.poleW ?? 1); if (pose.foot) this.flatFoot(R.legs[k], pose.foot.q, t.w * (pose.foot.w ?? 1)); } }
    if (pose.arms) for (const k of SIDES) { const t = pose.arms[k]; if (t && t.w > 0.001) {
      let p = t.p;
      if (!p && t.off) { const A = R.arms[k].a; A.getWorldPosition(_ap); p = _ap.add(_ao.copy(t.off).applyQuaternion(pose.frameQ || _qi)); }
      const pole = t.pole && pose.frameQ && t.poleLocal !== false ? _po.copy(t.pole).applyQuaternion(pose.frameQ) : t.pole;
      this.solveChain([R.arms[k].a, R.arms[k].e, R.arms[k].w], R.tips.arm[k], p, pole, t.w, t.poleW ?? 1);
    } }
    const amt = [0.55, 1.1, 0.8, 0.5];
    for (const k of SIDES) {
      const c = pose.curl ? (pose.curl[k] ?? 0.25) : 0.25;
      for (const f of R.arms[k].fingers) { const inf = info.get(f), cf = R.curl.get(f); f.quaternion.copy(inf.restLocalQ); if (c !== 0 && cf && !cf.end) { q1.setFromAxisAngle(cf.axis, (pose.fingerSign ?? 1) * c * amt[Math.min(3, cf.depth)] * (cf.isThumb ? 0.8 : 1)); f.quaternion.multiply(q1); } }
    }
    R.modelGroup.updateMatrixWorld(true);
    for (const k of SIDES) { R.arms[k].w.localToWorld(this.fistW[k].copy(R.tips.arm[k])); R.legs[k].ankle.getWorldPosition(this.ankleW[k]); R.legs[k].knee.getWorldPosition(this.kneeW[k]); }
  }
  /** hold the ankle (and the foot below it) flat: its world orientation = the given yaw quaternion * the ankle's bind orientation in the model frame */
  flatFoot(L, yawQ, w) {
    const R = this.rig, a = L.ankle, inf = R.info.get(a); _tq.copy(yawQ).multiply(inf.restModelQ); if (a.parent) { a.parent.updateMatrixWorld(true); a.parent.getWorldQuaternion(_pq); _pq.invert().multiply(_tq); } else _pq.copy(_tq);
    if (w < 0.999) a.quaternion.slerp(_pq, w); else a.quaternion.copy(_pq); a.updateMatrixWorld(true);
  }
  fist(k, out) { return out.copy(this.fistW[k]); }
}
CbPoser.prototype.solveChain = SfPoser.prototype.solveChain;
