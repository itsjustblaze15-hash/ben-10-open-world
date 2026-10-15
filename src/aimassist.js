// Crosshair-based melee aiming, shared by every player melee attack.
// Casts the camera's aim ray, picks the living target under / near the crosshair that is inside melee range and not behind a wall,
// and returns the HORIZONTAL yaw from the attacker's body to it (never the model's old facing). Falls back to the crosshair world point,
// then to the camera heading. Only a world-Y yaw is ever returned - nothing here tilts a model.
import * as THREE from 'three';
const _c = new THREE.Vector3(), _d = new THREE.Vector3();
export function meleeAim(g, pos, maxR = 8) {
  const cam = g.camera, o = cam.aimOrigin, d = cam.aimDir; let best = null, bs = 1e9;
  for (const h of g.world.hittables) {
    if (h.dead || h.held || h.override || !h.root) continue; const hp = h.root.position; const dx = hp.x - pos.x, dz = hp.z - pos.z, dist = Math.hypot(dx, dz);
    if (dist > maxR + (h.meleeRadius || 0.8) || Math.abs(hp.y - pos.y) > 4) continue;
    const cy = hp.y + (h.aimHeight ?? 1.2), vx = hp.x - o.x, vy = cy - o.y, vz = hp.z - o.z, t = vx * d.x + vy * d.y + vz * d.z; if (t < 0) continue;
    const qx = vx - d.x * t, qy = vy - d.y * t, qz = vz - d.z * t, perp = Math.hypot(qx, qy, qz), tol = 1.5 + 0.06 * t;
    if (perp > tol || perp >= bs) continue;
    _c.set(pos.x, pos.y + 1.2, pos.z); _d.set(hp.x - pos.x, 0, hp.z - pos.z); const L = _d.length();
    if (L > 1.5 && g.world.raySolid(_c, _d.multiplyScalar(1 / L), L - 0.8)) continue;       // a wall between us: not a valid target
    bs = perp; best = { h, yaw: Math.atan2(dx, dz), dist };
  }
  if (best) return { yaw: best.yaw, target: best.h, dist: best.dist };
  const ap = g.aimPointRef, ax = ap ? ap.x - pos.x : 0, az = ap ? ap.z - pos.z : 0;
  if (ap && Math.hypot(ax, az) > 2) return { yaw: Math.atan2(ax, az), target: null, dist: Math.hypot(ax, az) };
  return { yaw: Math.atan2(d.x, d.z), target: null, dist: 0 };
}
