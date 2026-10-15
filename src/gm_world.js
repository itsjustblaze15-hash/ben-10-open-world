// Grey Matter's MICRO DISTRICT (x -11..9, z -29..-20): small-scale details that sit on top of the existing map - nothing is rebuilt, nothing else is scaled.
//   * service wall with a 16 cm vent (10.5 cm high: standing is blocked, crouch / crawl fits) leading through a 1.5 m duct into the utility alcove behind the wall
//   * a gap-test wall: a 20 cm gap (passable standing) and a 5 cm gap (not passable at all), marked on the floor
//   * a car (28 cm ground clearance), a bench (22 cm) - crawl / walk under; stacked crates, a machinery cabinet (climbable, `grip`), a 18 cm pipe (mantle)
//   * technology: a broken generator, a security console, a circuit panel and an electronic vault door; two security cameras; micro training dummies
//   * ports for the existing consoles, the bay door and control boxes for the two turrets
import * as THREE from 'three';
import { canvasTex, drawConcrete } from './world.js';
import { Door } from './tech.js';
import { Dummy } from './dummies.js';

export function buildGmWorld(game, world, props, dummies, tech) {
  const gmt = game.gmt, scene = game.scene;
  const conc = (tint, seed) => new THREE.MeshStandardMaterial({ color: tint, roughness: 0.92, map: canvasTex(256, 256, (g, w, h) => drawConcrete(g, w, h, seed, false), { repeat: [3, 2] }) });
  const wallM = conc(0xb9b4a6, 41), ductM = new THREE.MeshStandardMaterial({ color: 0x8c949a, roughness: 0.55, metalness: 0.55 }), wood = new THREE.MeshStandardMaterial({ color: 0xa27a45, roughness: 0.85 });
  const cab = new THREE.MeshStandardMaterial({ color: 0x4f6a78, roughness: 0.55, metalness: 0.45 }), pipeM = new THREE.MeshStandardMaterial({ color: 0xb06a2a, roughness: 0.5, metalness: 0.6 });
  const box = (x0, x1, z0, z1, y0, y1, mat, grip = false, o) => { world.addBox((x0 + x1) / 2, y0, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, mat, o); const b = world.boxes[world.boxes.length - 1]; if (grip) b.grip = true; return b; };
  const out = {};
  // ---- service wall (z -26.55 .. -26.25) with the vent
  box(-11, -6.08, -26.55, -26.25, 0, 2.6, wallM); box(-5.92, 9, -26.55, -26.25, 0, 2.6, wallM); box(-6.08, -5.92, -26.55, -26.25, 0.105, 2.6, wallM);       // lintel: 10.5 cm opening
  box(-6.12, -6.08, -26.25, -24.75, 0, 0.105, ductM); box(-5.92, -5.88, -26.25, -24.75, 0, 0.105, ductM); box(-6.12, -5.88, -26.25, -24.75, 0.105, 0.145, ductM);   // 1.5 m duct in front of the vent
  // ---- vault (east of the alcove), closed by an electronic door
  box(3.0, 3.3, -28.4, -26.55, 0, 2.6, wallM);
  const door = new Door(game, -3.0, -27.475, 0.3, 1.85, 2.4); door.label = 'VAULT DOOR'; tech.addDoor(door); out.door = door;
  // ---- gap-test wall (z -22.7 .. -22.5): 20 cm gap at x -7, 5 cm gap at x -4
  box(-10, -7.1, -22.7, -22.5, 0, 1.2, wallM); box(-6.9, -4.025, -22.7, -22.5, 0, 1.2, wallM); box(-3.975, -1, -22.7, -22.5, 0, 1.2, wallM);
  const mark = (x, w, color) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.04, 0.5), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.004, -22.6); m.renderOrder = 1; scene.add(m); };
  mark(-7, 0.2, 0x3aff7a); mark(-4, 0.05, 0xff4a3a);
  // ---- props: a car, a bench, crates, a cabinet, a pipe
  const car = props.add('car', 3.2, -22.8, { yaw: 0 }); void car;
  props.add('bench', -2.2, -20.4, { yaw: Math.PI / 2 });
  box(5.8, 6.25, -21.75, -21.3, 0, 0.45, wood, true); box(6.25, 6.7, -21.75, -21.3, 0, 0.9, wood, true);                     // crate (45 cm) and a taller crate (90 cm) next to it: a staircase for him
  box(7.5, 8.5, -22.0, -21.5, 0, 1.1, cab, true);                                                                              // machinery cabinet (grip), 1.1 m
  box(5.5, 8.8, -26.25, -26.11, 0, 0.18, pipeM, true);                                                                          // 18 cm pipe along the wall: a low ledge to mantle
  // ---- technology devices
  const gen = gmt.addGenerator(-9.0, -27.7, 0, world); out.gen = gen;
  const cam1 = gmt.addCamera(-8.6, -25.6, 0, 0.9, 'CAM 1'), cam2 = gmt.addCamera(8.6, -25.6, 0, 0.9, 'CAM 2');
  const sec = props.add('computer', -4.9, -27.5, { yaw: 0, planted: true });
  const T = tech.addConsole(sec, 'SECURITY CONSOLE', [
    { name: 'CAMERA 1 TRACKING', lvl: 0, on: () => cam1.enabled, run: () => { cam1.enabled = !cam1.enabled; if (!cam1.enabled) gmt.stats.camsDisabled++; } },
    { name: 'CAMERA 2 TRACKING', lvl: 0, on: () => cam2.enabled, run: () => { cam2.enabled = !cam2.enabled; if (!cam2.enabled) gmt.stats.camsDisabled++; } },
    { name: 'DISTRICT LIGHTS', lvl: 0, on: () => tech.grid.gm, run: () => tech.setGroup('gm', !tech.grid.gm) },
  ]);
  out.sec = gmt.addConsole(T, { needsPower: true }); out.T = T;
  const panel = gmt.addPanel(-3.21, -27.9, -Math.PI / 2, null, null); out.panel = panel;
  const vdev = gmt.addDoorPort(door, -3.164, -26.95, -Math.PI / 2, { label: 'VAULT DOOR', unlocked: false, lockedMsg: () => 'VAULT LOCKED — REPAIR THE SECURITY CIRCUIT PANEL', vault: true }); out.vdev = vdev; panel.unlockDoor = vdev;
  gmt.vault = { door, dev: vdev, x0: -2.8, x1: 3.0, z: -27.475, hz: 0.9 };
  gmt.coreMat = new THREE.MeshStandardMaterial({ color: 0x102020, emissive: 0x30ffd0, emissiveIntensity: 0.1 }); const core = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), gmt.coreMat); core.position.set(0.3, 0.55, -27.5); scene.add(core); const pedestal = box(-0.05, 0.65, -27.85, -27.15, 0, 0.38, ductM); void pedestal; out.core = core;
  tech.lamps.gm = tech.lamps.gm || []; tech.grid.gm = tech.grid.gm ?? false;
  tech.addLamp('gm', -7.2, -27.2, 2.3); tech.addLamp('gm', 1.6, -27.9, 2.3);
  // ---- ports on existing technology: consoles, the bay door, turret control boxes
  for (const t of tech.list.slice()) if (t.kind === 'computer' && t !== T) gmt.addConsole(t);
  if (tech.bayDoor) gmt.addDoorPort(tech.bayDoor, -28.0, -27.886, 0, { label: 'BAY DOOR' });
  for (const t of tech.list.slice()) if (t.kind === 'turret') { const r = t.turret.root.position; const ang = r.x < 0 ? Math.PI / 2 : -Math.PI / 2; gmt.addTurretBox(t.turret, t, r.x + Math.sin(ang) * 1.9, r.z, ang); }
  // ---- micro training dummies: 9 % scale (about 22 cm), real hit spheres scaled with the model
  out.micro = [];
  for (const [x, z] of [[-1.5, -24.0], [-2.7, -24.7], [-0.6, -24.9]]) {
    const d = new Dummy(scene, world, new THREE.Vector3(x, 0, z), 0); d.root.scale.setScalar(0.09); d.maxHp = d.hp = 40; d.isMicro = true; for (const s of d.spheres) s.r *= 0.09; d.collider.r *= 0.09; d.collider.h *= 0.09; d.drawBar();
    for (const m of d.mats) m.color.lerp(new THREE.Color(0x7aa0d8), 0.35); dummies.push(d); out.micro.push(d);
  }
  return out;
}
