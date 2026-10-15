// ULTIMATE WILDMUTT rig (auto-rig).
// The supplied ultimatewildmutt.glb is a STATIC, skeleton-less 3-mesh model (Body / Chin_Hairs / Omni_Logo, T-pose, forward = +Z, 6.8 m long incl. tail, 6.1 m arm span, 2.7 m tall).
// It is never edited. At load time a skeleton is generated for it and the mesh is skinned to it in memory:
//   1. the real Wildmutt skeleton (same 84 bones, names, rest orientations - so the real Wildmutt animation / IK / gait code can pose it) is cloned and its JOINTS are moved by a
//      per-axis fit (width x1.16, height x1.31, length x1.65 + shift) onto Ultimate Wildmutt's anatomy; bone rotations / lengths follow from the new positions;
//   2. every vertex of the three meshes is bound to its 4 nearest bone segments with inverse-distance weights (limb bones are damped near the torso so the body does not follow the arms / legs);
//   3. the result is the same `rig` object buildQuadRig() returns, so UwPlayer = the Wildmutt controller on this rig.
// This is an automatic rig, not an artist-made one: joints can look slightly soft under extreme poses. That is reported honestly in the README / report.
import * as THREE from 'three';
import { cloneScene } from '../src/clone.js';
import { buildQuadRig, WM_CFG, WM_SCALE, LIMBS } from './quadrig.js';

export const UW_FIT = { sx: 1.16, sy: 1.31, sz: 1.65, dz: 0.25 };          // Wildmutt model space (m) -> Ultimate Wildmutt space (m)
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function buildUwRig(gltfWm, gltfUw) {
  const wm = cloneScene(gltfWm.scene, true), F = UW_FIT, K = 1 / WM_SCALE;
  // --- 0. strip the Wildmutt visuals (the skeleton stays)
  const kill = []; wm.traverse(o => { if (o.isMesh) kill.push(o); }); for (const o of kill) o.parent && o.parent.remove(o);
  wm.rotation.y = WM_CFG.faceRot; wm.updateMatrixWorld(true);
  // --- 1. fit the joints
  const bones = []; wm.traverse(o => { if (o.isBone) bones.push(o); });
  const P0 = new Map(); for (const b of bones) P0.set(b, new THREE.Vector3().setFromMatrixPosition(b.matrixWorld));
  const fit = (p) => new THREE.Vector3(p.x * F.sx, p.y * F.sy, p.z * F.sz + F.dz * K);
  // the arms are fitted to the mesh's own arm axis (Ultimate Wildmutt's arms are held out horizontally, Wildmutt's slope down): rotate + scale each arm chain onto it
  const src = gltfUw.scene.clone(true); src.updateMatrixWorld(true);
  const uw = []; { const t = new THREE.Vector3(); src.traverse(o => { if (o.isMesh && o.material.name === 'Body') { const pa = o.geometry.attributes.position; for (let i = 0; i < pa.count; i++) uw.push(t.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld).clone()); } }); }
  const fitted = new Map();
  for (const key of ['FL', 'FR']) {
    const lim = WM_CFG.limbs[key], sd = lim.side, aB = bones.find(b => lim.a.test(b.name)), wB = bones.find(b => lim.w.test(b.name)); if (!aB || !wB) continue;
    const pts = uw.filter(p => sd * p.x > 1.0 && p.y > 1.1), maxX = Math.max(...pts.map(p => sd * p.x));
    const mean = (q) => q.reduce((m, p) => m.add(p), new THREE.Vector3()).multiplyScalar(1 / q.length);
    const tip = mean(pts.filter(p => sd * p.x > maxX - 0.25)), root = mean(pts.filter(p => sd * p.x < 1.3)), dir = tip.clone().sub(root).normalize();
    const S = root.clone().addScaledVector(dir, -(sd * root.x - 0.5) / Math.max(0.2, sd * dir.x));            // the shoulder: the axis at |x| = 0.5 m
    const a0 = P0.get(aB).clone().multiplyScalar(WM_SCALE), w0 = P0.get(wB).clone().multiplyScalar(WM_SCALE), u0 = w0.clone().sub(a0), len0 = u0.length(); u0.normalize();
    const lam = 0.85 * tip.clone().sub(S).length() / len0, R = new THREE.Quaternion().setFromUnitVectors(u0, dir);
    aB.traverse(o => { if (!o.isBone) return; const rel = P0.get(o).clone().multiplyScalar(WM_SCALE).sub(a0).applyQuaternion(R).multiplyScalar(lam); fitted.set(o, S.clone().add(rel).multiplyScalar(K)); });
  }
  const order = []; const walk = (o) => { if (o.isBone) order.push(o); for (const c of o.children) walk(c); }; walk(wm);
  for (const b of order) {
    const np = (fitted.get(b) || fit(P0.get(b))).clone(); b.parent.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(b.parent.matrixWorld).invert(); b.position.copy(np.applyMatrix4(inv)); b.updateMatrixWorld(true);
  }
  wm.updateMatrixWorld(true);
  // buildQuadRig centres the scene on the bounding box of its meshes (nose .. rump): a proxy box stands in for Ultimate Wildmutt's body (tail excluded) while it runs
  const proxy = new THREE.Mesh(new THREE.BoxGeometry(6.14 * K, 2.69 * K, 3.9 * K)); proxy.position.set(0, 1.35 * K, 0.25 * K).applyMatrix4(new THREE.Matrix4().makeRotationY(-WM_CFG.faceRot)); proxy.rotation.y = -WM_CFG.faceRot; wm.add(proxy); wm.updateMatrixWorld(true);
  const rig = buildQuadRig(wm); wm.remove(proxy); proxy.geometry.dispose();             // (rest data comes from the fitted joints)
  // --- 2. segments of the fitted skeleton in the PRE-centring model frame (the frame the mesh is placed in)
  const pre = new THREE.Matrix4().makeRotationY(WM_CFG.faceRot), preInv = pre.clone().invert();
  const posOf = new Map(); for (const b of bones) posOf.set(b, (fitted.get(b) || fit(P0.get(b))).clone());
  const isLimbBone = new Map();
  const tag = (root, kind) => root.traverse(o => { if (o.isBone) isLimbBone.set(o, kind); });
  for (const k of LIMBS) tag(rig.limbs[k].a, rig.limbs[k].front ? 'arm' : 'leg');
  const segs = [];
  for (const b of bones) {
    const kids = b.children.filter(c => c.isBone); const pb = posOf.get(b);
    if (kids.length) for (const c of kids) segs.push({ b, a: pb, c: posOf.get(c) });
    else { const par = b.parent && posOf.get(b.parent); const dir = par ? pb.clone().sub(par).normalize() : new THREE.Vector3(0, 0, 1); segs.push({ b, a: pb, c: pb.clone().addScaledVector(dir, 0.04 * K) }); }
  }
  const bi = new Map(bones.map((b, i) => [b, i]));
  // arm / leg roots in the pre-centring frame (for the torso damping)
  const armRootX = Math.abs(posOf.get(rig.limbs.FL.a).x), hipY = posOf.get(rig.limbs.HL.a).y;
  const segDist = (p, s, out) => { const ab = _ab.subVectors(s.c, s.a), t = Math.max(0, Math.min(1, _ap.subVectors(p, s.a).dot(ab) / (ab.lengthSq() || 1))); return out.copy(s.a).addScaledVector(ab, t).distanceTo(p); };
  const _ab = new THREE.Vector3(), _ap = new THREE.Vector3(), _t = new THREE.Vector3();
  // --- 3. skin the three meshes
  const meshes = [], v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3();
  const skeleton = new THREE.Skeleton(bones);
  let nose = null, noseZ = -1e9;
  src.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry.clone(), pa = g.attributes.position, na = g.attributes.normal, N = pa.count; nm.getNormalMatrix(o.matrixWorld);
    const si = new Uint16Array(N * 4), sw = new Float32Array(N * 4), cand = [];
    for (let i = 0; i < N; i++) {
      v.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld).multiplyScalar(K);                  // UW world (m) -> model frame (cm, pre-centring)
      const per = new Map();
      for (const s of segs) { const d = segDist(v, s, _t) / K; const kind = isLimbBone.get(s.b); let pen = 1;
        // damp limb bones near the torso: arms only count outboard of the shoulder, legs only below the hip
        if (kind === 'arm') pen = 0.12 + 0.88 * smooth(armRootX * 0.55, armRootX * 1.15, Math.abs(v.x));
        else if (kind === 'leg') pen = 0.12 + 0.88 * smooth(hipY * 0.97, hipY * 0.55, v.y);
        const dd = d / pen; const cur = per.get(s.b); if (cur === undefined || dd < cur) per.set(s.b, dd); }
      cand.length = 0; for (const [b, d] of per) cand.push([b, d]); cand.sort((a, b) => a[1] - b[1]);
      let tot = 0; for (let k = 0; k < 4; k++) { const w = 1 / Math.pow(cand[k][1] + 0.06, 3); sw[i * 4 + k] = w; si[i * 4 + k] = bi.get(cand[k][0]); tot += w; }
      for (let k = 0; k < 4; k++) sw[i * 4 + k] /= tot;
      v.applyMatrix4(preInv); pa.setXYZ(i, v.x, v.y, v.z);                                          // into the scene's native frame
      n.fromBufferAttribute(na, i).applyMatrix3(nm).normalize().transformDirection(preInv); na.setXYZ(i, n.x, n.y, n.z);
      if (o.material.name === 'Body') { const zz = v.clone().applyMatrix4(pre).z; if (zz > noseZ) { noseZ = zz; nose = v.clone(); } }
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    pa.needsUpdate = true; na.needsUpdate = true; g.computeBoundingSphere(); g.computeBoundingBox();
    const m = Array.isArray(o.material) ? o.material.map(x => x.clone()) : o.material.clone();
    const sm = new THREE.SkinnedMesh(g, m); sm.name = o.name; sm.frustumCulled = false; sm.castShadow = true; sm.receiveShadow = false; wm.add(sm); meshes.push(sm);
  });
  wm.updateMatrixWorld(true);
  for (const m of meshes) m.bind(skeleton, m.matrixWorld);
  rig.skinned = meshes; rig.mats = new Map(); for (const m of meshes) { const ms = Array.isArray(m.material) ? m.material : [m.material]; for (const x of ms) rig.mats.set(x.name, x); }
  // muzzle: the nose tip, in the jaw bone's own frame
  if (nose) { const w = nose.clone().applyMatrix4(wm.matrixWorld); rig.muzzle = { bone: rig.bones.jaw, local: w.applyMatrix4(new THREE.Matrix4().copy(rig.bones.jaw.matrixWorld).invert()) }; }
  rig.isUw = true; rig.fit = F;
  return rig;
}
