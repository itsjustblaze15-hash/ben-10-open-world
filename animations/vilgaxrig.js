// VILGAX (original 2005 series) - rig adapter for the SUPPLIED GLB ("Fusionfall-Vilgax (OG Ben 10)" by Nexelecstar, CC-BY-4.0).
// The GLB already has a full Biped skeleton (80 joints: pelvis / spine / neck / head / clavicles / arms / fingers / forearm spikes / four facial tentacle chains / legs) and 10 clips
// (stand1-3, walk, run, ready, melee1, dodge, wound, death). NOTHING is replaced or regenerated: geometry, texture, materials and colours are used exactly as supplied.
// This module only (1) wraps the scene in a group that scales it to the game (native 2.0 m -> VG.scale x) and turns it to face +Z, (2) finds the bones, (3) adds marker points
// (fists, arm-cannon muzzle, tentacle tips, chest) used by the combat code, and (4) keeps the clips.
import * as THREE from 'three';

export const VG = {
  scale: 2.2,            // native height 2.0 m  ->  4.6 m (~15 ft): Four Arms is 3.0 m (~10 ft), Diamondhead ~2.4 m
  rad: 1.45, h: 4.6,     // collision cylinder
};

const NAMES = {
  pelvis: 'Bip01_Pelvis_02', spine: 'Bip01_Spine_01', spine1: 'Bip01_Spine1_03', neck: 'Bip01_Neck_04', head: 'Bip01_Head_05',
  LClav: 'Bip01_L_Clavicle_09', LUpper: 'Bip01_L_UpperArm_012', LFore: 'Bip01_L_Forearm_011', LHand: 'Bip01_L_Hand_013',
  RClav: 'Bip01_R_Clavicle_033', RUpper: 'Bip01_R_UpperArm_034', RFore: 'Bip01_R_Forearm_035', RHand: 'Bip01_R_Hand_036',
  LThigh: 'Bip01_L_Thigh_065', LCalf: 'Bip01_L_Calf_066', LFoot: 'Bip01_L_Foot_067', LToe: 'Bip01_L_Toe0_068',
  RThigh: 'Bip01_R_Thigh_069', RCalf: 'Bip01_R_Calf_070', RFoot: 'Bip01_R_Foot_071', RToe: 'Bip01_R_Toe0_072',
};
// facial tentacle chains (base bone first); each chain points along its local +Z
const FEELERS = [
  ['Bip01_feeler1_1_054', 'Bip01_feeler1_2_057', 'Bip01_feeler1_3_056'], ['Bip01_feeler2_1_058', 'Bip01_feeler2_2_059', 'Bip01_feeler2_3_060'],
  ['Bip01_feeler3_1_061', 'Bip01_feeler3_2_062'], ['Bip01_feeler4_1_063', 'Bip01_feeler4_2_064'],
];

export function buildVilgaxRig(gltf) {
  const scene = gltf.scene, modelGroup = new THREE.Group(); modelGroup.name = 'VilgaxModel';
  modelGroup.add(scene); modelGroup.rotation.y = Math.PI;                                 // the GLB faces -Z, the game faces +Z
  const bones = {}, byName = {}; scene.traverse(o => { if (o.isBone) byName[o.name] = o; });
  for (const k in NAMES) { bones[k] = byName[NAMES[k]]; if (!bones[k]) console.warn('[Vilgax rig] missing bone', k, NAMES[k]); }
  const feelers = FEELERS.map(ch => ch.map(n => byName[n]).filter(Boolean));
  const skinned = []; scene.traverse(o => { if (o.isSkinnedMesh) { o.frustumCulled = false; o.castShadow = true; o.receiveShadow = false; skinned.push(o); } });
  // materials: keep exactly as supplied; only make sure each has an emissive channel the hit-flash can use (MeshStandardMaterial already does)
  const mats = []; for (const s of skinned) for (const m of [].concat(s.material)) if (m && !mats.includes(m)) mats.push(m);
  // markers: positions in the bone's own units (centimetres), +X is along the bone
  const mk = {}, put = (name, bone, x, y = 0, z = 0) => { const o = new THREE.Object3D(); o.name = 'mk_' + name; o.position.set(x, y, z); bone.add(o); mk[name] = o; };
  put('fistL', bones.LHand, 9); put('fistR', bones.RHand, 9);
  put('cannon', bones.RHand, 20);                                                          // the arm-equipment muzzle: the right gauntlet / forearm armour
  put('chestC', bones.spine1, 14);
  put('headTop', bones.head, 14);
  feelers.forEach((ch, i) => put('tip' + i, ch[ch.length - 1], 7, 0, 0));
  // calibrate the standing pose: scale / ground offset
  scene.updateMatrixWorld(true);
  modelGroup.scale.setScalar(VG.scale);
  const clips = {}; for (const c of gltf.animations) clips[c.name] = c;
  // root motion is removed (physics owns the position): the translation tracks of the two root joints are frozen at their first key, so the clips only ever bend the body
  for (const c of gltf.animations) for (const t of c.tracks) if (/^(Bip01|Bip01_Pelvis_02)\.position$/.test(t.name)) { const v = t.values, n = t.times.length; for (let i = 1; i < n; i++) { v[i * 3] = v[0]; v[i * 3 + 1] = v[1]; v[i * 3 + 2] = v[2]; } }
  const rig = { modelGroup, scene, bones, byName, feelers, skinned, mats, markers: mk, clips, groundY: 0, report: '' };
  // ground offset: lowest skinned vertex of the stand1 pose rests on y = 0
  const mx = new THREE.AnimationMixer(scene); const a = mx.clipAction(clips.stand1); a.play(); mx.setTime(0); modelGroup.updateMatrixWorld(true);
  const bb = new THREE.Box3(); for (const s of skinned) { s.computeBoundingBox(); bb.union(s.boundingBox.clone().applyMatrix4(s.matrixWorld)); }
  mx.stopAllAction(); mx.uncacheRoot(scene);
  rig.groundY = -bb.min.y; modelGroup.position.y = rig.groundY;
  rig.height = bb.max.y - bb.min.y;
  rig.report = `Vilgax GLB: ${skinned.length} skinned meshes, ${Object.keys(byName).length} bones, clips [${Object.keys(clips).join(', ')}], height ${(rig.height).toFixed(2)} m, ground offset ${rig.groundY.toFixed(3)}`;
  return rig;
}
