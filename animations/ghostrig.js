// Ghostfreak rig wrapper. The supplied GLB is a real skinned biped (45 bones: pelvis / 2 spine / neck / head / eye, two arms with four-finger hands, and an 8-bone tail that is
// his whole lower body) with NO animation clips, so the pose is driven procedurally here. Geometry / textures / materials / bones are used exactly as shipped.
//  - The file is in metres and faces +X: the glTF scene node is turned -90 deg about Y so the wrapper ("model space") faces +Z, model-left = +X, Y up.
//  - The loose Omnitrix meshes the author left unskinned are re-parented to the chest bone (world transform kept) so the symbol follows the body.
//  - FK deltas are model-space euler angles on top of the bind pose (children follow). Each arm is solved with a two-bone IK that can also STRETCH: the bones are scaled
//    along their own limb axis (a matrix per bone, no shear) so the real arm geometry elongates into a tentacle that is still part of the body.
//  - Fingers curl about a hinge axis computed from the bind pose.
//  - Materials get a tiny shader patch (uniforms default to 0 = original look) for the invisibility fade + the phasing shimmer; nothing else about them changes.
import * as THREE from 'three';

export const GF_SCALE = 1.7;
const V3 = THREE.Vector3, Q4 = THREE.Quaternion, M4 = THREE.Matrix4;
const find = (scene, re) => { let r = null; scene.traverse(o => { if (!r && o.isBone && re.test(o.name)) r = o; }); return r; };

export function buildGhostRig(gltfScene) {
  const scene = gltfScene, modelGroup = new THREE.Group(); modelGroup.add(scene);
  scene.rotation.y = -Math.PI / 2; scene.updateMatrixWorld(true);
  const B = { hips: find(scene, /^bip_pelvis/), spine: find(scene, /^bip_spine_0/), chest: find(scene, /^bip_spine_1/), neck: find(scene, /^bip_neck/), head: find(scene, /^bip_head/), eye: find(scene, /^bip_eye/) };
  const tail = []; for (let i = 0; i < 8; i++) tail.push(find(scene, new RegExp('^bip_tail_' + i + '_')));
  for (const k in B) if (!B[k]) console.warn('Ghostfreak rig: bone missing', k);
  tail.forEach((t, i) => { if (!t) console.warn('Ghostfreak rig: tail bone missing', i); });
  { const p = new V3().setFromMatrixPosition(B.hips.matrixWorld); scene.position.set(-p.x, 0, -p.z); scene.updateMatrixWorld(true); }
  // unskinned Omnitrix parts -> chest bone children
  const attached = []; scene.traverse(o => { if (!o.isBone && /^omni_cl_/.test(o.name)) attached.push(o); });
  for (const n of attached) B.chest.attach(n);
  const arms = {};
  for (const [k, side] of [['L', 1], ['R', -1]]) {
    arms[k] = { a: find(scene, new RegExp('^bip_upperArm_' + k)), e: find(scene, new RegExp('^bip_lowerArm_' + k)), w: find(scene, new RegExp('^bip_hand_' + k)), side, fingers: [] };
    for (const n of ['a', 'e', 'w']) if (!arms[k][n]) console.warn('Ghostfreak rig: arm bone missing', k, n);
    arms[k].w.traverse(o => { if (o.isBone && o !== arms[k].w) arms[k].fingers.push(o); });
  }
  const skinned = []; scene.traverse(o => { if (o.isSkinnedMesh) { skinned.push(o); o.frustumCulled = false; o.castShadow = true; o.receiveShadow = false; } else if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; } });
  scene.updateMatrixWorld(true);
  const bones = []; scene.traverse(o => { if (o.isBone) bones.push(o); });
  const inv = new M4().copy(modelGroup.matrixWorld).invert(), info = new Map(), m = new M4();
  for (const b of bones) { m.copy(b.matrixWorld).premultiply(inv); const p = new V3(), q = new Q4(), s = new V3(); m.decompose(p, q, s); info.set(b, { restLocalQ: b.quaternion.clone(), restLocalP: b.position.clone(), restLocalS: b.scale.clone(), restModelQ: q.clone(), restModelP: p.clone() }); }
  // limb axes (local frame) + rest lengths, finger hinge axes
  const lens = {}, axes = {};
  for (const k in arms) {
    const A = arms[k], ie = info.get(A.e), iw = info.get(A.w);
    axes[k] = { a: ie.restLocalP.clone().normalize(), e: iw.restLocalP.clone().normalize() };
    lens[k] = { l1: info.get(A.a).restModelP.distanceTo(ie.restModelP), l2: ie.restModelP.distanceTo(iw.restModelP) };
  }
  const down = new V3(0, -1, 0), curl = new Map();       // finger bone -> { axis (local), depth }
  for (const k in arms) {
    for (const f of arms[k].fingers) {
      const kid = f.children.find(c => c.isBone); let dir;
      if (kid) dir = info.get(kid).restModelP.clone().sub(info.get(f).restModelP).normalize(); else { const p = f.parent; dir = info.get(f).restModelP.clone().sub(info.get(p).restModelP).normalize(); }
      const hMod = new V3().crossVectors(dir, down).normalize(), hLoc = hMod.applyQuaternion(info.get(f).restModelQ.clone().invert());
      let depth = 0, o = f; while (o && o !== arms[k].w) { depth++; o = o.parent; }
      curl.set(f, { axis: hLoc, depth: depth - 1, isThumb: /thumb/.test(f.name) });
    }
  }
  const rest = {}; for (const k in B) if (B[k]) rest[k] = info.get(B[k]).restModelP.clone();
  const mats = new Map(); scene.traverse(o => { if (o.isMesh) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const mm of ms) if (!mats.has(mm.uuid)) mats.set(mm.uuid, mm); } });
  const armBones = []; for (const k in arms) armBones.push(arms[k].a, arms[k].e, arms[k].w);
  return { modelGroup, scene, bones: B, tail, arms, skinned, info, allBones: bones, rest, lens, axes, curl, mats: [...mats.values()], armBones, attached, kmax: 14 };
}

/** shader patch shared by every Ghostfreak material: uGhost = invisibility depth (0..1), uPhase = intangible depth (0..1). Both 0 => exactly the original shading. */
export function makeGhostFX(rig) {
  const U = { uGhost: { value: 0 }, uPhase: { value: 0 }, uTime: { value: 0 }, uAlpha: { value: 1 } };
  for (const mat of rig.mats) {
    mat.userData.gfBase = { transparent: mat.transparent, depthWrite: mat.depthWrite, opacity: mat.opacity };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = 'uniform float uPhase; uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed += normal * (sin(position.y * 13.0 + uTime * 4.1) * 0.010 + sin(position.y * 29.0 - uTime * 6.3 + position.x * 7.0) * 0.005) * uPhase;`);
      sh.fragmentShader = 'uniform float uGhost; uniform float uPhase; uniform float uTime; uniform float uAlpha;\n' + sh.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
        { vec3 gn = normalize(vNormal); float rim = 1.0 - abs(dot(gn, normalize(vViewPosition)));
          float a = uAlpha;
          a *= mix(1.0, 0.075 + 0.36 * pow(rim, 2.0), uGhost);                                   // invisible: almost nothing, a faint edge line only the player can make out
          a *= 1.0 - uPhase * (0.40 + 0.10 * sin(uTime * 3.2 + vViewPosition.y * 2.0));          // intangible: translucent with a slow wobble
          gl_FragColor.a *= clamp(a, 0.0, 1.0); }`);
    };
    mat.customProgramCacheKey = () => 'gf-ghost-v1';
    mat.needsUpdate = true;
  }
  let vis = false, xr = false;
  return {
    U,
    /** call once per frame: translucent only while an effect is running (opaque path otherwise = original rendering) */
    set(ghost, phase, alpha, time, xray = false) {
      U.uGhost.value = ghost; U.uPhase.value = phase; U.uAlpha.value = alpha; U.uTime.value = time;
      const on = ghost > 0.002 || phase > 0.002 || alpha < 0.998;
      if (on !== vis) { vis = on; for (const m of rig.mats) { m.transparent = on ? true : m.userData.gfBase.transparent; m.depthWrite = on && (ghost > 0.25 || alpha < 0.9) ? false : m.userData.gfBase.depthWrite; m.needsUpdate = true; } }
      else if (on) { const dw = !(ghost > 0.25 || alpha < 0.9); for (const m of rig.mats) if (m.depthWrite !== dw) m.depthWrite = dw; }
      const shadow = ghost < 0.5 && alpha > 0.5 && phase < 0.9; for (const s of rig.skinned) { s.castShadow = shadow; s.renderOrder = xray ? 30 : 0; }
      if (xray !== xr) { xr = xray; for (const m of rig.mats) m.depthTest = !xray; }
    },
    reset() { this.set(0, 0, 1, 0, false); },
  };
}

const _S = new M4(), _R = new M4(), _G = new M4(), _P = new M4();
/** T * R * S with S = kr*I + (ka-kr) * ax ax^T (stretch along the bone's own axis, no shear) */
function trs(pos, q, ax, ka, kr, out) {
  const x = ax.x, y = ax.y, z = ax.z, d = ka - kr;
  _S.set(kr + d * x * x, d * x * y, d * x * z, 0, d * y * x, kr + d * y * y, d * y * z, 0, d * z * x, d * z * y, kr + d * z * z, 0, 0, 0, 0, 1);
  _R.makeRotationFromQuaternion(q); out.copy(_R).multiply(_S); out.setPosition(pos); return out;
}

/** Pose driver. pose = { d:{ key:[rx,ry,rz] model-space euler deltas }, ik:{ L:{p, pole, twist, frame, ext, thick, hand} }, curl:{ L:0..1 }, w }
 *  keys: hips spine chest neck head tail0..tail7 aL eL wL aR eR wR.  ik.p is in CHARACTER space (metres at world scale), relative to the chest unless frame === 'w'. */
export class GhostPoser {
  constructor(rig) {
    this.rig = rig; this.keyOf = new Map();
    for (const k in rig.bones) if (rig.bones[k]) this.keyOf.set(rig.bones[k], k);
    rig.tail.forEach((b, i) => { if (b) this.keyOf.set(b, 'tail' + i); });
    for (const k in rig.arms) { const A = rig.arms[k]; this.keyOf.set(A.a, 'a' + k); this.keyOf.set(A.e, 'e' + k); this.keyOf.set(A.w, 'w' + k); }
    this.cp = new V3(); this.Dtc = new Q4(); this.inv = new M4(); this.e1 = new THREE.Euler(); this.tipW = { L: new V3(), R: new V3() };
    this.reach = { L: 0, R: 0 };
  }
  apply(pose) {
    const R = this.rig, info = R.info, d = pose.d || {}, Dt = new Map(), Wm = new Map(), q1 = new Q4();
    for (const b of R.armBones) b.matrixAutoUpdate = true;
    for (const b of R.allBones) {
      const key = this.keyOf.get(b), e = key && d[key], inf = info.get(b), par = b.parent && info.has(b.parent) ? b.parent : null, Dp = par ? Dt.get(par) : null;
      q1.identity(); if (e) { this.e1.set(e[0], e[1], e[2], 'XYZ'); q1.setFromEuler(this.e1); }
      const Dtot = Dp ? q1.clone().multiply(Dp) : q1.clone(); Dt.set(b, Dtot);
      const Wb = Dtot.clone().multiply(inf.restModelQ); Wm.set(b, Wb);
      if (par) b.quaternion.copy(Wm.get(par).clone().invert().multiply(Wb)); else b.quaternion.copy(inf.restLocalQ);
      b.position.copy(inf.restLocalP); b.scale.copy(inf.restLocalS);
    }
    R.scene.updateMatrixWorld(true);
    const g = R.modelGroup, sc = g.scale.x; this.inv.copy(g.matrixWorld).invert();
    this.cp.setFromMatrixPosition(R.bones.chest.matrixWorld).applyMatrix4(this.inv).multiplyScalar(sc); this.Dtc = Dt.get(R.bones.chest).clone();
    if (pose.ik) for (const k in pose.ik) {
      const t = pose.ik[k]; if (!t || !t.p) continue; let p = t.p, pole = t.pole;
      if (t.frame !== 'w') { p = p.clone().applyQuaternion(this.Dtc).add(this.cp); if (pole) pole = pole.clone().applyQuaternion(this.Dtc); }
      this.solveArm(k, p, pole, t.twist || 0, t.ext || false, t.thick || 1, t.hand || 1);
    }
    // fingers: curl about the hinge axis computed from the bind pose (base joint bends least, middle most, tip some)
    const amt = [0.55, 1.15, 0.7];
    for (const k in R.arms) {
      const c = pose.curl ? (pose.curl[k] ?? 0.25) : 0.25;
      for (const f of R.arms[k].fingers) { const inf = info.get(f), cf = R.curl.get(f); f.quaternion.copy(inf.restLocalQ); if (c !== 0 && cf) { q1.setFromAxisAngle(cf.axis, c * amt[Math.min(2, cf.depth)] * (cf.isThumb ? 0.8 : 1)); f.quaternion.multiply(q1); } }
    }
    R.modelGroup.updateMatrixWorld(true);
  }
  /** model-space position of a bone (unscaled model units) */
  wp(o, out = new V3()) { return out.setFromMatrixPosition(o.matrixWorld).applyMatrix4(this.inv); }
  solveArm(k, T0, poleIn, twist, ext, thick, handS) {
    const R = this.rig, A = R.arms[k], g = R.modelGroup, sc = g.scale.x, inv = this.inv;
    const a = this.wp(A.a), e0 = this.wp(A.e), w0 = this.wp(A.w), T = T0.clone().divideScalar(sc);
    const decomp = (o) => { const mm = new M4().multiplyMatrices(inv, o.matrixWorld), p = new V3(), q = new Q4(), s = new V3(); mm.decompose(p, q, s); return q; };
    const qa = decomp(A.a), qe = decomp(A.e), qw = decomp(A.w);
    const l1 = R.lens[k].l1, l2 = R.lens[k].l2; let dir = T.clone().sub(a), dist = dir.length(); if (dist < 1e-5) return; dir.multiplyScalar(1 / dist);
    const kk = ext ? Math.min(R.kmax, Math.max(1, dist * (ext === true ? 1.035 : ext) / (l1 + l2))) : 1, L1 = l1 * kk, L2 = l2 * kk;
    const dd = Math.min(Math.max(dist, Math.abs(L1 - L2) * 1.001 + 1e-3), (L1 + L2) * 0.999);
    const x = (L1 * L1 - L2 * L2 + dd * dd) / (2 * dd), h = Math.sqrt(Math.max(0, L1 * L1 - x * x));
    const pole = (poleIn ? poleIn.clone() : new V3(A.side * 0.6, -0.8, -0.5)); pole.addScaledVector(dir, -pole.dot(dir)); if (pole.lengthSq() < 1e-6) pole.set(0, -1, 0); pole.normalize();
    const E = a.clone().addScaledVector(dir, x).addScaledVector(pole, h), W = a.clone().addScaledVector(dir, dd);
    this.reach[k] = dd;
    // world (model-space) orientations: upper arm -> elbow, forearm -> wrist, hand follows the forearm
    const rotA = new Q4().setFromUnitVectors(e0.clone().sub(a).normalize(), E.clone().sub(a).normalize()), qA = rotA.clone().multiply(qa);
    const qE0 = qA.clone().multiply(qa.clone().invert().multiply(qe)), dirE0 = w0.clone().sub(e0).normalize().applyQuaternion(rotA);
    const rotE = new Q4().setFromUnitVectors(dirE0, W.clone().sub(E).normalize()), qE = rotE.clone().multiply(qE0);
    let qW = qE.clone().multiply(qe.clone().invert().multiply(qw));
    if (twist) qW = new Q4().setFromAxisAngle(W.clone().sub(E).normalize(), twist).multiply(qW);
    const ax = R.axes[k];
    this.setBone(A.a, a, qA, ax.a, kk, thick);
    this.setBone(A.e, E, qE, ax.e, kk, thick);
    this.setBone(A.w, W, qW, ax.e, handS, handS);
    this.tipW[k].copy(W).multiplyScalar(sc);
  }
  /** make `bone` take the model-space transform T(pos) R(q) S(ax: ka, radial: kr) */
  setBone(bone, pos, q, ax, ka, kr) {
    trs(pos, q, ax, ka, kr, _P); _G.copy(this.rig.modelGroup.matrixWorld).multiply(_P);
    const pw = bone.parent.matrixWorld; bone.matrixAutoUpdate = false; bone.matrix.copy(_R.copy(pw).invert()).multiply(_G); bone.matrixWorld.multiplyMatrices(pw, bone.matrix);
    bone.updateMatrixWorld(true);
  }
}

// ---------------------------------------------------------------------------------------------------------------- pose helpers
export const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const D = (x = 0, y = 0, z = 0) => [x, y, z];
export const mkPose = () => ({ d: {}, ik: {}, curl: {}, w: 1 });
const lerp = (a, b, t) => a + (b - a) * t, clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ZERO = [0, 0, 0];
/** blend layer A over pose P with weight A.w (ik entries blend position / pole / twist; ext & thick take the stronger value) */
export function layerG(P, A, poser) {
  const w = A.w ?? 1; if (w <= 0.001) return P;
  for (const key in A.d) { const a = P.d[key] || ZERO, b = A.d[key]; P.d[key] = [lerp(a[0], b[0], w), lerp(a[1], b[1], w), lerp(a[2], b[2], w)]; }
  for (const k in A.ik) {
    const e = A.ik[k], wt = clamp((e.w ?? 1) * w, 0, 1), b = P.ik[k]; if (wt <= 0.001) continue;
    if (!b) { P.ik[k] = { ...e, w: 1 }; continue; }
    let bp = b.p, bpole = b.pole, ep = e.p, epole = e.pole, frame = b.frame;
    if (b.frame !== e.frame) {
      const toW = (p, pole, fr) => fr === 'w' ? [p, pole] : [p.clone().applyQuaternion(poser.Dtc).add(poser.cp), pole ? pole.clone().applyQuaternion(poser.Dtc) : null];
      [bp, bpole] = toW(b.p, b.pole, b.frame); [ep, epole] = toW(e.p, e.pole, e.frame); frame = 'w';
    }
    P.ik[k] = { p: bp.clone().lerp(ep, wt), pole: bpole && epole ? bpole.clone().lerp(epole, wt) : (epole || bpole), twist: lerp(b.twist || 0, e.twist || 0, wt), frame, w: 1, ext: wt > 0.35 ? (e.ext || b.ext) : (b.ext || false), thick: lerp(b.thick || 1, e.thick || 1, wt), hand: lerp(b.hand || 1, e.hand || 1, wt) };
  }
  if (A.curl) for (const k in A.curl) P.curl[k] = lerp(P.curl[k] ?? 0.25, A.curl[k], w);
  return P;
}
