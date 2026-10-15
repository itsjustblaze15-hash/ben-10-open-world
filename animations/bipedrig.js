// Generic humanoid rig wrapper for the Heatblast and Upgrade GLBs. Both files already contain a real skinned skeleton ("bip_*" biped, ~70 bones) but NO animation clips,
// so the pose is driven procedurally by FaPoser (FK euler deltas + two-bone IK for the hands). Geometry / textures / materials / bones are used untouched.
//  - Both models are authored in centimetres and face +X: the glTF scene node is turned -90 deg about Y so that the wrapper ("model space") faces +Z, model-left = +X, Y up.
//  - Loose meshes that the author left unskinned (Heatblast's head flames, the Omnitrix on the chest) are re-parented to a bone with their world transform kept, so they follow the body.
import * as THREE from 'three';

const find = (scene, re) => { let r = null; scene.traverse(o => { if (!r && o.isBone && re.test(o.name)) r = o; }); return r; };
const findNode = (scene, re) => { let r = null; scene.traverse(o => { if (!r && !o.isBone && re.test(o.name)) r = o; }); return r; };
const TMP = { m: new THREE.Matrix4() };

export const HB_CFG = {
  name: 'Heatblast', faceRot: -Math.PI / 2,
  bones: {
    hips: /^bip_pelvis_01$/, spine: /^bip_spine_1_03$/, chest: /^bip_spine_3_05$/, neck: /^bip_neck_06$/, head: /^bip_head_07$/, jaw: /^bip_Jaw_08$/,
    thighL: /^bip_hip_L_052$/, kneeL: /^bip_knee_L_053$/, ankleL: /^bip_foot_L_054$/, toeL: /^bip_toe_L_055$/,
    thighR: /^bip_hip_R_047$/, kneeR: /^bip_knee_R_048$/, ankleR: /^bip_foot_R_049$/, toeR: /^bip_toe_R_050$/,
  },
  arms: {
    UL: { sh: null, a: /^bip_upperArm_L_029$/, e: /^bip_lowerArm_L_030$/, w: /^bip_hand_L_031$/, side: 1 },
    UR: { sh: null, a: /^bip_upperArm_R_010$/, e: /^bip_lowerArm_R_011$/, w: /^bip_hand_R_012$/, side: -1 },
  },
  attach: [[/^Fire_Firesmd$/, 'head'], [/^Fire006_Fire006smd$/, 'head'], [/^Cylinder001$/, 'chest']],
};
export const UP_CFG = {
  name: 'Upgrade', faceRot: -Math.PI / 2,
  bones: {
    hips: /^bip_pelvis_01$/, spine: /^bip_spine_1_03$/, chest: /^bip_spine_2_04$/, neck: /^bip_neck_05$/, head: /^bip_head_06$/,
    thighL: /^bip_hip_L_047$/, kneeL: /^bip_knee_L_048$/, ankleL: /^bip_foot_L_049$/, toeL: /^bip_foot_L_end_050$/,
    thighR: /^bip_hip_R_051$/, kneeR: /^bip_knee_R_052$/, ankleR: /^bip_foot_R_053$/, toeR: /^bip_foot_R_end_054$/,
  },
  arms: {
    UL: { sh: /^bip_collar_L_08$/, a: /^bip_upperarm_L_09$/, e: /^bip_lowerarm_L_010$/, w: /^bip_hand_L_011$/, side: 1 },
    UR: { sh: /^bip_collar_R_028$/, a: /^bip_upperarm_R_029$/, e: /^bip_lowerarm_R_030$/, w: /^bip_hand_R_031$/, side: -1 },
  },
  attach: [[/^Watch_Watchsmd$/, 'chest']],
};

export function buildBipedRig(gltfScene, cfg) {
  const scene = gltfScene, modelGroup = new THREE.Group(); modelGroup.add(scene);
  scene.rotation.y = cfg.faceRot; scene.updateMatrixWorld(true);
  const B = {}; for (const k in cfg.bones) { B[k] = find(scene, cfg.bones[k]); if (!B[k]) console.warn(cfg.name + ' rig: bone missing', k); }
  { const p = new THREE.Vector3().setFromMatrixPosition(B.hips.matrixWorld); scene.position.set(-p.x, 0, -p.z); scene.updateMatrixWorld(true); }   // centre the pelvis over the character origin
  // unskinned decoration -> bone children (world transform kept)
  const attached = [];
  for (const [re, key] of cfg.attach) { const n = findNode(scene, re); if (n && B[key]) { B[key].attach(n); attached.push(n); } else console.warn(cfg.name + ' rig: attach target missing', re); }
  const arms = {};
  for (const k in cfg.arms) { const d = cfg.arms[k]; arms[k] = { sh: d.sh ? find(scene, d.sh) : null, a: find(scene, d.a), e: find(scene, d.e), w: find(scene, d.w), side: d.side, fingers: [] }; for (const n of ['a', 'e', 'w']) if (!arms[k][n]) console.warn(cfg.name + ' rig: arm bone missing', k, n); }
  for (const k in arms) arms[k].w.traverse(o => { if (o.isBone && o !== arms[k].w && !/end/i.test(o.name)) arms[k].fingers.push(o); });
  const skinned = []; scene.traverse(o => { if (o.isSkinnedMesh) { skinned.push(o); o.frustumCulled = false; o.castShadow = true; o.receiveShadow = false; } else if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
  scene.updateMatrixWorld(true);
  const bones = []; scene.traverse(o => { if (o.isBone) bones.push(o); });
  const inv = new THREE.Matrix4().copy(modelGroup.matrixWorld).invert(), info = new Map();
  for (const b of bones) { const m = TMP.m.copy(b.matrixWorld); m.premultiply(inv); const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); m.decompose(p, q, s); info.set(b, { restLocalQ: b.quaternion.clone(), restLocalP: b.position.clone(), restModelQ: q.clone(), restModelP: p.clone(), scale: s.clone() }); }
  const rest = {}; for (const k in B) if (B[k]) rest[k] = info.get(B[k]).restModelP.clone();
  const restHand = {}; for (const k in arms) restHand[k] = info.get(arms[k].w).restModelP.clone();
  const lens = {}; for (const k in arms) { const r = arms[k]; lens[k] = { l1: info.get(r.a).restModelP.distanceTo(info.get(r.e).restModelP), l2: info.get(r.e).restModelP.distanceTo(info.get(r.w).restModelP) }; }
  // all bone materials used (for runtime tinting of flame / circuit parts without touching the asset on disk)
  const mats = new Map(); scene.traverse(o => { if (o.isMesh) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) if (!mats.has(m.name)) mats.set(m.name, m); } });
  return { modelGroup, scene, bones: B, arms, skinned, info, order: bones.slice(), rest, restHand, lens, allBones: bones, attached, mats, cfg };
}
