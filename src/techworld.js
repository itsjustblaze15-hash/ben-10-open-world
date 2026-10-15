// Upgrade's test grounds: every machine in the world is registered with the TechSystem (cars, the box truck, robots, consoles, security turrets, an electronic door),
// plus a small "liquid course" in the north-west corner (a crawl-under beam, a 0.8 m slot in a wall, a sealed pocket holding a terminal) and a locked tech bay.
// Everything is a real collision box, so what Upgrade can or cannot get through is decided by the same collision code as everything else.
import * as THREE from 'three';
import { Door } from './tech.js';

export function buildTechWorld(game, tech) {
  const { world, props } = game;
  const concrete = new THREE.MeshStandardMaterial({ color: 0x8f969c, roughness: 0.9 }), hazard = new THREE.MeshStandardMaterial({ color: 0xd8a41c, roughness: 0.7, emissive: 0x3a2a00 });
  const wall = (x0, x1, z0, z1, h = 3.4, hp = 420, name = 'LAB WALL') => { world.addBox((x0 + x1) / 2, 0, (z0 + z1) / 2, x1 - x0, h, z1 - z0, concrete); props.addWall(world.boxes[world.boxes.length - 1], hp, name); };
  // ---- tech bay (north-west corner), entered through an electronic door
  wall(-24.9, -24.3, -36, -28.2); wall(-36, -30.6, -28.5, -27.9); wall(-27.4, -24.3, -28.5, -27.9);
  const door = new Door(game, -29, -28.2, 3.2, 0.6, 3.2); tech.addDoor(door); tech.bayDoor = door;
  // ---- liquid course: squeeze wall with a 0.8 m slot, sealed pocket behind it, crawl-under beam in front
  wall(-36, -24.45, -24.6, -24.0, 3.4, 420, 'POCKET WALL');
  wall(-36, -30.4, -19.3, -18.7, 3.4, 460, 'SQUEEZE WALL'); wall(-29.6, -24.45, -19.3, -18.7, 3.4, 460, 'SQUEEZE WALL');
  world.addBox(-30.2, 0.75, -15, 11.6, 0.35, 3.0, hazard);                                   // underside 0.75 m: only the flat liquid body (0.6 m) fits underneath
  // ---- machines
  const car = props.props.filter(p => p.kind === 'car'); car.forEach((p, i) => tech.addProp(p, 'vehicle', i ? 'BLUE COUPE' : 'RED COUPE'));
  const truck = props.props.find(p => p.kind === 'truck'); if (truck) tech.addProp(truck, 'vehicle', 'BOX TRUCK');
  const bayCar = props.add('car', -31, -33.2, { yaw: Math.PI / 2, color: 0x3a8f55 }); tech.addProp(bayCar, 'vehicle', 'PROTOTYPE COUPE');
  const r1 = props.add('robot', -20.5, -9.5, { yaw: 0.6 }); tech.addProp(r1, 'robot', 'SECURITY ROBOT R1');
  const r2 = props.add('robot', -27.2, -31.2, { yaw: 2.4 }); tech.addProp(r2, 'robot', 'SECURITY ROBOT R2');
  const c1 = props.add('computer', -15, 3, { yaw: 0.5, planted: true });
  tech.addConsole(c1, 'CONTROL CONSOLE', [
    { name: 'TURRET LINK', lvl: 0, on: () => tech.grid.turrets, run: () => { tech.grid.turrets = !tech.grid.turrets; } },
    { name: 'TURRET OVERDRIVE', lvl: 1, on: () => tech.grid.overdrive, run: () => { tech.grid.overdrive = !tech.grid.overdrive; } },
    { name: 'FLOODLIGHTS', lvl: 0, on: () => tech.grid.floods, run: () => tech.setGroup('floods', !tech.grid.floods) },
  ]);
  const c2 = props.add('computer', -30, -23.2, { yaw: 0, planted: true });
  tech.addConsole(c2, 'MAINTENANCE TERMINAL', [
    { name: 'BAY DOOR', lvl: 0, on: () => door.holdOpen, run: () => { door.holdOpen = !door.holdOpen; door.keepOpen = door.holdOpen; door.target = door.holdOpen ? 1 : 0; } },
    { name: 'BAY LIGHTS', lvl: 0, on: () => tech.grid.bay, run: () => tech.setGroup('bay', !tech.grid.bay) },
    { name: 'DIAGNOSTICS', lvl: 1, on: () => tech.scanT > 0, run: () => tech.scan() },
  ]);
  for (const t of game.enemies.turrets) tech.addTurret(t);
  for (const [x, z] of [[-17, -9], [17, -5], [-17, 12], [17, 18]]) tech.addLamp('floods', x, z);
  for (const [x, z] of [[-35.2, -35.2], [-25.6, -35.2], [-30.2, -29.2]]) tech.addLamp('bay', x, z, 3.0);
  return { door, c1, c2, r1, r2, bayCar };
}
