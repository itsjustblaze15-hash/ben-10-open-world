// Third-person over-the-shoulder camera: mouse orbit, smooth follow, wheel zoom, collision, trauma shake.
import * as THREE from 'three';
import { clamp, damp, rand } from './util.js';

export class CameraRig {
  constructor(camera, world) {
    this.cam = camera; this.world = world;
    this.yaw = 0; this.pitch = 0.22; this.dist = 7.2; this.targetDist = 7.2; this.curDist = 7.2;
    this.focus = new THREE.Vector3(0, 2, 14); this.trauma = 0; this.t = 0; this.fovKick = 0; this.baseFov = 60;
    this.speedFov = 0; this.distBonus = 0; this.heightGoal = 2.15; this.shoulderGoal = 0.95; this.roll = 0;
    this.shakeLevel = 2; this.cs = 1; this.minD = null; this.noClip = false; this.pitchMin = -0.28; this.pitchMax = 1.25; this.floorFn = null; this.sens = 0.0022; this.shoulder = 0.95; this.height = 2.15;
    this.aimOrigin = new THREE.Vector3(); this.aimDir = new THREE.Vector3(0, 0, -1); this._dir = new THREE.Vector3(); this._start = new THREE.Vector3(); this._des = new THREE.Vector3(); this._sd = new THREE.Vector3();
  }
  addLook(dx, dy) { this.yaw -= dx * this.sens; this.pitch = clamp(this.pitch + dy * this.sens, this.pitchMin, this.pitchMax); }
  zoom(d) { this.targetDist = clamp(this.targetDist + d * 0.004 * this.cs, 3.2 * this.cs, 13 * this.cs); }
  addTrauma(a) { this.trauma = Math.min(1, this.trauma + a); }
  kick(f) { this.fovKick = Math.max(this.fovKick, f); }
  forward(out = new THREE.Vector3()) { return this.cam.getWorldDirection(out); }

  /** swimming camera: if the eased pull-in left the camera inside a solid, move it out through the nearest face (never through the player's side) */
  pushOut(pos) {
    const pad = 0.14;
    for (let it = 0; it < 3; it++) {
      let moved = false;
      for (const b of this.world.boxes) {
        if (b.max.y < -6 || pos.x <= b.min.x - pad || pos.x >= b.max.x + pad || pos.y <= b.min.y - pad || pos.y >= b.max.y + pad || pos.z <= b.min.z - pad || pos.z >= b.max.z + pad) continue;
        const d = [pos.x - (b.min.x - pad), (b.max.x + pad) - pos.x, pos.y - (b.min.y - pad), (b.max.y + pad) - pos.y, pos.z - (b.min.z - pad), (b.max.z + pad) - pos.z]; let k = 0; for (let i = 1; i < 6; i++) if (d[i] < d[k]) k = i;
        if (k === 0) pos.x = b.min.x - pad; else if (k === 1) pos.x = b.max.x + pad; else if (k === 2) pos.y = b.min.y - pad; else if (k === 3) pos.y = b.max.y + pad; else if (k === 4) pos.z = b.min.z - pad; else pos.z = b.max.z + pad; moved = true;
      }
      if (!moved) break;
    }
  }
  update(dt, playerPos, snap = false) {
    this.t += dt;
    if (this.pitch < this.pitchMin) this.pitch = damp(this.pitch, this.pitchMin, 7, dt); else if (this.pitch > this.pitchMax) this.pitch = damp(this.pitch, this.pitchMax, 7, dt);   // a wider swim range eases back to the normal one when the alien changes
    const goal = this._des.set(playerPos.x, playerPos.y + this.height, playerPos.z);
    if (snap) this.focus.copy(goal); else { this.focus.x = damp(this.focus.x, goal.x, 16, dt); this.focus.z = damp(this.focus.z, goal.z, 16, dt); this.focus.y = damp(this.focus.y, goal.y, 9, dt); }
    this.height = damp(this.height, this.heightGoal, 5, dt); this.shoulder = damp(this.shoulder, this.shoulderGoal, 5, dt);
    this.dist = damp(this.dist, this.targetDist + this.distBonus, 5, dt);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const back = this._dir.set(Math.sin(this.yaw) * cp, sp, Math.cos(this.yaw) * cp);
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    let sho = this.shoulder;
    if (this.floorFn && !this.noClip && Math.abs(sho) > 0.05) { const sg = Math.sign(sho), hs = this.world.raySolid(this.focus, this._sd.copy(right).multiplyScalar(sg), Math.abs(sho) + 0.3 * this.cs, true); if (hs) sho = sg * Math.max(0, hs.t - 0.3 * this.cs); }   // swimming beside a rock: the over-the-shoulder offset shrinks instead of ending up inside it
    const start = this._start.copy(this.focus).addScaledVector(right, sho);
    // desired camera position + collision (walls/props via ray, ground via clamp)
    let maxD = this.dist;
    const cs = this.cs, hit = this.noClip ? null : this.world.raySolid(start, back, this.dist + 0.4 * cs, !!this.floorFn); if (hit) maxD = Math.max(this.minD ?? 0.8 * cs, hit.t - 0.4 * cs);   // noClip: Ghostfreak phasing - the camera glides with him instead of snapping in
    const fl = this.floorFn;                                 // Ripjaws: the lagoon bed is the camera's floor (swimming camera never clips the sand)
    const TR = this.world.terrain, tfl = TR ? (x, z) => TR.height(x, z) + 0.35 * cs : null;                // island: the terrain is the camera's floor (hills, slopes, beaches)
    if (!fl && !tfl) { if (back.y < 0) maxD = Math.min(maxD, (start.y - 0.35 * cs) / -back.y); }
    else if (!fl) { const N = 12; let prev = 0; for (let i = 1; i <= N; i++) { const t = maxD * i / N; if (start.y + back.y * t < tfl(start.x + back.x * t, start.z + back.z * t)) { maxD = Math.max(0.6 * cs, prev); break; } prev = t; } }
    else { const N = 16; let prev = 0; for (let i = 1; i <= N; i++) { const t = maxD * i / N, px = start.x + back.x * t, py = start.y + back.y * t, pz = start.z + back.z * t; if (py < fl(px, pz)) { maxD = Math.max(0.9, prev); break; } prev = t; } }
    this.curDist = maxD < this.curDist ? (fl ? damp(this.curDist, maxD, 26, dt) : maxD) : damp(this.curDist, maxD, 6, dt);   // swimming camera: a pull-in eases over ~6 frames instead of a one-frame pop (the push-out below keeps it out of the rock meanwhile)
    const pos = start.clone().addScaledVector(back, this.curDist); pos.y = Math.max(pos.y, fl ? fl(pos.x, pos.z) : tfl ? tfl(pos.x, pos.z) : 0.35 * cs);
    if (fl && !this.noClip) this.pushOut(pos);
    this.aimOrigin.copy(start); this.aimDir.copy(back).negate();
    // trauma shake (decays quickly, squared for punchiness)
    this.trauma = Math.max(0, this.trauma - dt * 1.7);
    const sh = this.trauma * this.trauma * [0, 0.3, 1][this.shakeLevel ?? 2], tt = this.t * 38;
    pos.x += Math.sin(tt * 1.3) * 0.22 * sh * cs; pos.y += Math.sin(tt * 1.9 + 2) * 0.18 * sh * cs; pos.z += Math.sin(tt * 1.1 + 5) * 0.22 * sh * cs;
    if (this.fix) this.fix(pos);                              // Way Big: keeps the camera out of buildings
    this.cam.position.copy(pos);
    this.cam.lookAt(start.x, start.y + 0.0 - Math.sin(this.pitch) * 0.0, start.z);
    // look target: aim past the player along the camera forward for a stable crosshair
    this.cam.rotateZ(Math.sin(tt * 0.9 + 1) * 0.012 * sh);
    if (this.roll) this.cam.rotateZ(this.roll);
    this.fovKick = damp(this.fovKick, 0, 9, dt);
    this.cam.fov = this.baseFov * (1 + this.fovKick) + this.speedFov; this.cam.updateProjectionMatrix();
  }
}
