// Cannonbolt roll course (free area x -8..10, z 6..17): a launch ramp, a mound (gentle slope), a steep wedge (too steep to climb at low speed), a kerb, a low barrier, stairs, wooden crates, pebbles and
// five small "minion" dummies that are small enough to be captured. Ramps are real slopes (src/ramps.js) - every alien walks on them and the camera collides with them.
import * as THREE from 'three';
import { canvasTex, drawConcrete } from './world.js';
import { wedge, mound } from './ramps.js';
import { Dummy } from './dummies.js';

export function buildCbWorld(game, world, props, dummies) {
  const scene = game.scene;
  const conc = (tint, seed) => new THREE.MeshStandardMaterial({ color: tint, roughness: 0.92, map: canvasTex(256, 256, (g, w, h) => drawConcrete(g, w, h, seed, false), { repeat: [2, 2] }) });
  const wood = new THREE.MeshStandardMaterial({ color: 0x9a7440, roughness: 0.85 }), curbM = conc(0xc9c3a8, 31), stepM = conc(0xb4b6b8, 32);
  const R = {};
  R.launch = world.addRamp({ x: -5, z: 11, yaw: Math.PI / 2, hu: 1.7, hv: 3, fn: wedge(2.0, 3), cell: 0.5, material: conc(0xd0b24a, 33), name: 'LAUNCH RAMP' });
  R.mound = world.addRamp({ x: 3.5, z: 7.5, yaw: 0, hu: 4, hv: 4, fn: mound(1.0, 4), cell: 0.5, material: conc(0x9fb0a0, 34), name: 'MOUND' });
  R.steep = world.addRamp({ x: 10, z: 8, yaw: -Math.PI / 2, hu: 1.4, hv: 2, fn: wedge(2.6, 2), cell: 0.5, material: conc(0xb86a4a, 35), name: 'STEEP WEDGE' });
  world.addBox(-2, 0, 0, 5, 0.18, 0.4, curbM);                                                   // kerb strip
  world.addBox(2.5, 0, 0, 2.4, 0.55, 0.5, stepM);                                                   // low barrier
  for (let i = 0; i < 3; i++) world.addBox(6.5 + i * 0.9, 0, 11.0, 0.9, 0.2 * (i + 1), 3, stepM);   // stairs 0.2 / 0.4 / 0.6
  const find = (x, z) => world.boxes.find(b => Math.abs((b.min.x + b.max.x) / 2 - x) < 0.02 && Math.abs((b.min.z + b.max.z) / 2 - z) < 0.02);
  const crates = [];
  for (const [x, z] of [[2.2, 13], [3.0, 13.15], [2.6, 13.9], [-8.5, 14.5]]) { world.addBox(x, 0, z, 0.55, 0.55, 0.55, wood); const e = find(x, z); if (e) crates.push(props.wrap(e, 'small', 40, 50, 'crate', 0x9a7440)); }
  for (const [x, z, r] of [[1.0, 15.0, 0.22], [-1.6, 14.6, 0.28], [4.6, 14.6, 0.25]]) props.add('pebble', x, z, { r });
  props.add('rock', -3, 6.4, { r: 0.45 });
  // minions: the same dummy, 0.42 x the size (1.0 m tall) - small enough to be picked up by the ball. Hit spheres are scaled with the model.
  const minions = [], S = 0.42;
  for (const [x, z] of [[1.5, 16.6], [3.2, 17.2], [5, 16.4], [-6.5, 7.5], [-8, 9]]) {
    const d = new Dummy(scene, world, new THREE.Vector3(x, 0, z), Math.PI); d.root.scale.setScalar(S); d.maxHp = d.hp = 60; d.mass = 16; d.isMinion = true;
    for (const s of d.spheres) s.r *= S; d.collider.r *= S; d.collider.h *= S; d.drawBar();
    for (const m of d.mats) m.color.multiplyScalar(0.8).lerp(new THREE.Color(0x7a9ad8), 0.35);
    dummies.push(d); minions.push(d);
  }
  // two mid-size enemies (0.75 x = 1.8 m): too big to capture, they are pushed / knocked away by the ball's momentum
  const mediums = [];
  for (const [x, z] of [[-3, -3], [1, -3.6]]) {
    const d = new Dummy(scene, world, new THREE.Vector3(x, 0, z), Math.PI); d.root.scale.setScalar(0.75); d.maxHp = d.hp = 80; d.isMedium = true;
    for (const sp of d.spheres) sp.r *= 0.75; d.collider.r *= 0.75; d.collider.h *= 0.75; d.drawBar();
    for (const m of d.mats) m.color.lerp(new THREE.Color(0xd89a5a), 0.3);
    dummies.push(d); mediums.push(d);
  }
  return { ramps: R, crates, minions, mediums };
}
