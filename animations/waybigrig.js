// Way Big rig wrapper. The supplied GLB (gigante / grandao / waybig - Ben 10, by Nathan_zica, CC-BY-4.0) is a FULLY RIGGED, SKINNED model: 15 skinned meshes (body, eyes, crest, head plates, shoulder spikes, wrist cuffs,
// feet ...), 12 materials (body + emissive + normal map textures), ONE Mixamo-style skeleton (hips / 3 spines / neck / head, shoulder - arm - forearm - hand, 4 fingers x 3 joints + thumb, up-leg - leg - foot - toe),
// modelled in a T-pose facing +Z, ~54.6 file units tall, NO animation clips. Geometry, skin weights, UVs, textures and materials are used exactly as shipped - nothing is redesigned or recoloured.
//  - The file's own scene graph is used unchanged (it is parented under one wrapper group). Every bone keeps its authored rest pose; the procedural pose driver only adds rotations on top of it.
//  - The ONLY scaling is ONE uniform factor (same on x / y / z) applied to the wrapper group: scale = WB_HEIGHT / (height of the file's bounding box).
//  - Attachment points are Object3Ds parented to the file's own bones: `att.chest` (the Omnitrix on the chest - the ONLY place the energy blast starts), `att.grip` (palm of each hand) and `att.sole` (the middle of each sole).
import * as THREE from 'three';
import { CbPoser } from './cannonboltrig.js';

export const WB_HEIGHT = 80;          // gameplay height in metres (1 unit = 1 m)
export const SIDES = ['L', 'R'];      // L = +X (model-left), R = -X
const V3 = THREE.Vector3, Q4 = THREE.Quaternion, M4 = THREE.Matrix4;

export function buildWayBigRig(gltfScene) {
  const modelGroup = new THREE.Group(), scene = gltfScene; modelGroup.add(scene); modelGroup.updateMatrixWorld(true); scene.updateMatrixWorld(true);
  const allBones = []; scene.traverse(o => { if (o.isBone) allBones.push(o); });
  const find = (re) => { const b = allBones.find(x => re.test(x.name)); if (!b) throw new Error('Way Big rig: bone ' + re + ' not found in the GLB'); return b; };

  const skinned = []; scene.traverse(o => { if (o.isSkinnedMesh) { o.frustumCulled = false; o.castShadow = true; o.receiveShadow = false; skinned.push(o); } else if (o.isMesh) o.frustumCulled = false; });
  const mats = []; for (const m of skinned) { const mm = Array.isArray(m.material) ? m.material : [m.material]; for (const x of mm) { x.side = THREE.DoubleSide; if (x.map) x.map.anisotropy = 4; mats.push(x); } }

  // feet on y = 0 (the file's lowest vertex is at -0.01) and centred on the hips in x / z - a pure translation of the file's scene, nothing is re-proportioned
  { const bx = new THREE.Box3().setFromObject(scene), hp = new V3().setFromMatrixPosition(find(/^mixamorig_Hips/).matrixWorld); scene.position.y -= bx.min.y; scene.position.x -= hp.x; scene.position.z -= hp.z; scene.updateMatrixWorld(true); }
  const box = new THREE.Box3().setFromObject(scene), size = box.getSize(new V3()), scale = WB_HEIGHT / size.y;
  const B = { hips: find(/^mixamorig_Hips/), spine: find(/^mixamorig_Spine_/), chest: find(/^mixamorig_Spine1_/), spine2: find(/^mixamorig_Spine2_/), neck: find(/^mixamorig_Neck/), head: find(/^mixamorig_Head_\d+$/) };
  const arms = {}, legs = {}, fingerNames = ['Thumb', 'Index', 'Middle', 'Ring'];
  for (const k of SIDES) {
    const Sd = k === 'L' ? 'Left' : 'Right';
    arms[k] = { sh: find(new RegExp('^mixamorig_' + Sd + 'Shoulder_')), a: find(new RegExp('^mixamorig_' + Sd + 'Arm_\\d+$')), e: find(new RegExp('^mixamorig_' + Sd + 'ForeArm_\\d+$')), w: find(new RegExp('^mixamorig_' + Sd + 'Hand_\\d+$')), fingers: [], digits: {}, ends: {}, side: k === 'L' ? 1 : -1 };
    for (const f of fingerNames) { const ds = [1, 2, 3].map(i => find(new RegExp('^mixamorig_' + Sd + 'Hand' + f + i + '_\\d+$'))); arms[k].digits[f] = ds; arms[k].ends[f] = find(new RegExp('^mixamorig_' + Sd + 'Hand' + f + '4_\\d+$')); arms[k].fingers.push(...ds); }
    legs[k] = { hip: find(new RegExp('^mixamorig_' + Sd + 'UpLeg_')), knee: find(new RegExp('^mixamorig_' + Sd + 'Leg_\\d+$')), ankle: find(new RegExp('^mixamorig_' + Sd + 'Foot_')), toe: find(new RegExp('^mixamorig_' + Sd + 'ToeBase_')), foot: [] };
    legs[k].ankle.traverse(o => { if (o.isBone) legs[k].foot.push(o); });
  }
  const info = new Map(), inv = new M4().copy(modelGroup.matrixWorld).invert(), m = new M4();
  for (const b of allBones) { m.copy(b.matrixWorld).premultiply(inv); const p = new V3(), q = new Q4(), s = new V3(); m.decompose(p, q, s); info.set(b, { restLocalQ: b.quaternion.clone(), restLocalP: b.position.clone(), restLocalS: b.scale.clone(), restModelQ: q.clone(), restModelP: p.clone() }); }

  // ---- attachment points
  const mk = (name, parent, worldPoint) => { const o = new THREE.Object3D(); o.name = name; parent.add(o); o.position.copy(parent.worldToLocal(worldPoint.clone())); return o; };
  const att = { chest: null, grip: {}, sole: {} };
  // chest emitter: the Omnitrix on the chest. Ray the bind-pose body from the front at the symbol's height -> the real surface point, then 0.25 units out.
  { const rc = new THREE.Raycaster(), hit = [], cx = new V3(0, 0, 40); let best = null;
    for (const y of [36.8, 36.6, 37.0]) { rc.set(new V3(0, y, 40), new V3(0, 0, -1)); rc.far = 80; hit.length = 0; for (const s of skinned) rc.intersectObject(s, false, hit); hit.sort((a, b) => a.distance - b.distance); if (hit.length) { best = hit[0].point.clone(); break; } }
    void cx; if (!best) best = new V3(0, 36.8, 3.2);
    best.z += 0.25; att.chest = mk('ChestEmitter', B.spine2, best); att.chestRest = best.clone(); }
  for (const k of SIDES) {
    const w = arms[k].w, mid = arms[k].digits.Middle[0].getWorldPosition(new V3()), h0 = w.getWorldPosition(new V3());
    att.grip[k] = mk('Grip_' + k, w, h0.clone().lerp(mid, 0.75));
    const f = legs[k].ankle.getWorldPosition(new V3()); att.sole[k] = mk('Sole_' + k, legs[k].ankle, new V3(f.x, 0, f.z + 3.2));
  }
  scene.updateMatrixWorld(true);
  // ---- tips for the IK: knuckle line of the fist in the wrist frame; ankle in the knee frame
  const tips = { arm: {}, ankleInKnee: {}, soleDrop: {} };
  for (const k of SIDES) {
    const w = arms[k].w; tips.arm[k] = w.worldToLocal(att.grip[k].getWorldPosition(new V3()));
    const L = legs[k]; tips.ankleInKnee[k] = L.knee.worldToLocal(L.ankle.getWorldPosition(new V3())); tips.soleDrop[k] = L.ankle.getWorldPosition(new V3()).applyMatrix4(inv).y;
  }
  // digit curl hinge axes (perpendicular to the finger and to world-down in the bind pose); depth 0 = proximal .. 2 = distal
  const down = new V3(0, -1, 0), curl = new Map();
  for (const k of SIDES) for (const f of fingerNames) {
    const ds = arms[k].digits[f], end = arms[k].ends[f], P = [...ds, end].map(b => info.get(b).restModelP);
    for (let i = 0; i < 3; i++) { const dir = P[i + 1].clone().sub(P[i]).normalize(), ref = f === 'Thumb' ? new V3(0, -1, 0.35).normalize() : down, hMod = new V3().crossVectors(dir, ref).normalize(); curl.set(ds[i], { axis: hMod.applyQuaternion(info.get(ds[i]).restModelQ.clone().invert()), depth: i, isThumb: f === 'Thumb', end: false }); }
  }
  const report = { meshes: skinned.length, verts: skinned.reduce((a, s) => a + s.geometry.attributes.position.count, 0), bones: allBones.length, skinned: true, ownSkeleton: true, clips: 0, fileUnits: size.toArray().map(v => +v.toFixed(2)), scale: +scale.toFixed(5), worldHeight: +(size.y * scale).toFixed(2), materials: [...new Set(mats.map(x => x.name))], textured: mats.some(x => !!x.map), emissiveMaps: mats.filter(x => x.emissiveMap).length };
  return { modelGroup, scene, mesh: skinned[0], bones: B, arms, legs, att, tips, curl, info, allBones, skinned, mats, scale, size, report };
}

/** same pose driver as Cannonbolt / Grey Matter (FK euler deltas in model space + FABRIK IK for arms / legs + hinge digit curl) */
export class WbPoser extends CbPoser { constructor(rig) { super(rig); this.eps = 0.01; } }
