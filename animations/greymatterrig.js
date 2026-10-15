// Grey Matter rig wrapper. The supplied GLB (grey_matter_ben_10_vilgax_attacks_fan_model) is a real skinned model: ONE skinned mesh (2523 vertices, one textured material), 38 bones
// (hips / spine / chest / neck / head, four eyelid bones, shoulder-upper arm-lower arm-hand with two-bone fingers, two 3-bone legs hanging off the root joint), NO animation clips, 8.1 units tall,
// facing +Z. Geometry / texture / materials / bones are used exactly as shipped - nothing is redesigned or recoloured.
//  - The ONLY scaling is ONE uniform factor (same on x / y / z) applied to the wrapper group: GM_SCALE = 0.13 m / 8.1 units.
//  - The pose is driven procedurally on top of the bind pose (same pose driver as Cannonbolt: FK euler deltas in model space + FABRIK IK for arms / legs + hinge finger curl).
//  - Because the legs hang off the root joint (not the hips) the whole figure is lowered by moving the wrapper, and the legs follow with IK.
import * as THREE from 'three';
import { CbPoser } from './cannonboltrig.js';

export const GM_UNITS = 8.1, GM_HEIGHT = 0.13, GM_SCALE = GM_HEIGHT / GM_UNITS;     // one uniform scale
const V3 = THREE.Vector3, Q4 = THREE.Quaternion, M4 = THREE.Matrix4;
const find = (scene, re) => { let r = null; scene.traverse(o => { if (!r && o.isBone && re.test(o.name)) r = o; }); return r; };
export const SIDES = ['L', 'R'];      // L = model-left = +X

export function buildGreyMatterRig(scene) {
  const modelGroup = new THREE.Group(); modelGroup.add(scene); scene.updateMatrixWorld(true);
  const B = { hips: find(scene, /^Hips_/), spine: find(scene, /^Spine_/), chest: find(scene, /^Chest_/), neck: find(scene, /^Neck_/), head: find(scene, /^Head_/),
    lidLU: find(scene, /^LeftUpperEyelid/), lidLL: find(scene, /^LeftLo/), lidRU: find(scene, /^RightUpperEyelid/), lidRL: find(scene, /^RightLo/) };
  const arms = {}, legs = {};
  for (const k of SIDES) {
    const nm = k === 'L' ? 'Left' : 'Right';
    arms[k] = { sh: find(scene, new RegExp('^' + nm + 'Shoulder_')), a: find(scene, new RegExp('^' + nm + 'UpperArm_')), e: find(scene, new RegExp('^' + nm + 'LowerArm_')), w: find(scene, new RegExp('^' + nm + 'Hand_')), fingers: [], side: k === 'L' ? 1 : -1 };
    arms[k].w.traverse(o => { if (o.isBone && o !== arms[k].w) arms[k].fingers.push(o); });
    legs[k] = { hip: find(scene, new RegExp('^' + nm + 'UpperLeg_')), knee: find(scene, new RegExp('^' + nm + 'LowerLeg_')), ankle: find(scene, new RegExp('^' + nm + 'Foot_')), foot: [] };
    legs[k].ankle.traverse(o => { if (o.isBone) legs[k].foot.push(o); });
  }
  for (const k in B) if (!B[k]) console.warn('Grey Matter rig: bone missing', k);
  // feet on y = 0 (the file's lowest vertex is at -0.001), centred on the hips in x / z
  { const box = new THREE.Box3().setFromObject(scene); scene.position.y -= box.min.y; const p = new V3().setFromMatrixPosition(B.hips.matrixWorld); scene.position.x -= p.x; scene.position.z -= p.z; scene.updateMatrixWorld(true); }
  const skinned = []; scene.traverse(o => { if (o.isSkinnedMesh) { skinned.push(o); o.frustumCulled = false; o.castShadow = true; o.receiveShadow = false; } else if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; } });
  const bones = []; scene.traverse(o => { if (o.isBone) bones.push(o); });
  const inv = new M4().copy(modelGroup.matrixWorld).invert(), info = new Map(), m = new M4();
  for (const b of bones) { m.copy(b.matrixWorld).premultiply(inv); const p = new V3(), q = new Q4(), s = new V3(); m.decompose(p, q, s); info.set(b, { restLocalQ: b.quaternion.clone(), restLocalP: b.position.clone(), restLocalS: b.scale.clone(), restModelQ: q.clone(), restModelP: p.clone() }); }
  const sk = skinned.find(s => s.skeleton.bones.length) || skinned[0], bi = (b) => sk.skeleton.boneInverses[sk.skeleton.bones.indexOf(b)], _v = new V3();
  const eachVert = (set, fn) => {
    for (const mesh of skinned) {
      const g = mesh.geometry, pos = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, bn = mesh.skeleton.bones;
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
  const down = new V3(0, -1, 0), curl = new Map();
  for (const k of SIDES) for (const f of arms[k].fingers) {
    const kid = f.children.find(c => c.isBone); let dir;
    if (kid) dir = info.get(kid).restModelP.clone().sub(info.get(f).restModelP).normalize(); else dir = info.get(f).restModelP.clone().sub(info.get(f.parent).restModelP).normalize();
    const hMod = new V3().crossVectors(dir, down).normalize(), hLoc = hMod.applyQuaternion(info.get(f).restModelQ.clone().invert());
    let depth = 0, o = f; while (o && o !== arms[k].w) { depth++; o = o.parent; }
    curl.set(f, { axis: hLoc, depth: depth - 1, isThumb: /thumb/i.test(f.name), end: false });
  }
  const mats = new Map(); scene.traverse(o => { if (o.isMesh) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const mm of ms) if (!mats.has(mm.uuid)) mats.set(mm.uuid, mm); } });
  const bodyMats = [...mats.values()].filter(mm => mm.emissive); for (const mm of bodyMats) mm.userData.e0 = mm.emissive.clone();
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene), size = box.getSize(new V3());
  let verts = 0; skinned.forEach(s => verts += s.geometry.attributes.position.count);
  const report = { bones: bones.length, skinnedMeshes: skinned.length, verts, units: size.toArray().map(v => +v.toFixed(3)), scale: +GM_SCALE.toFixed(5), worldHeight: +(size.y * GM_SCALE).toFixed(4), armTip: SIDES.map(k => +tips.arm[k].length().toFixed(3)), soleDrop: SIDES.map(k => +tips.soleDrop[k].toFixed(3)) };
  return { modelGroup, scene, bones: B, arms, legs, skinned, info, allBones: bones, tips, curl, mats: [...mats.values()], bodyMats, report };
}

/** same pose driver as Cannonbolt; the finger-curl tolerance and the IK tolerance are scaled for a 13 cm figure */
export class GmPoser extends CbPoser { constructor(rig) { super(rig); this.eps = 0.01; } }
