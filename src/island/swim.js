// SURFACE SWIMMING + XLR8 WATER RUNNING (V30).
//  - every playable character except Ripjaws (own full swim system) and Way Big (walks through the sea) floats on the surface in deep water: body partly submerged, head above the
//    water, slow swim speed, smooth entry (splash) and exit. They cannot dive: the height is pinned to the surface.
//  - XLR8 keeps running ON the water above WATER_RUN_SPEED (feet at the surface, splashes + a wake behind him); below WATER_RUN_END he sinks into the ordinary surface swim; on land he runs again.
//  - fliers (Stinkfly / Heatblast in flight, Ghostfreak hover), Upgrade's merged machines and Cannonbolt's ball are left alone.
import * as THREE from 'three';
export const SWIM = { speed: 3.4, speedXlr8: 4.6, WATER_RUN_SPEED: 22, WATER_RUN_END: 15 };
const _p = new THREE.Vector3();
export class SurfaceSwim {
  constructor(game) { this.g = game; this.state = 'none'; this.t = 0; this.stats = { swimTime: 0, runTime: 0, entries: 0, runs: 0 }; this.splashT = 0; }
  eligible(id, P) {
    if (!this.g.world.island || id === 'ripjaws' || id === 'waybig') return false;
    if (P.flying || P.flightActive || (P.alt || 0) > 1.2 || P.merged || P.form === 'ball' || P.mode === 'climb' || P.mode === 'wall') return false;
    return true;
  }
  /** call BEFORE the controller's physics: lets the player's own position through the deep-water barrier */
  pre(id, P) { const L = this.g.lagoon; L.allowPos = this.eligible(id, P) ? P.pos : null; }
  /** call AFTER the controller's physics */
  post(dt, id, P) {
    const g = this.g, L = g.lagoon;
    if (id === 'waybig' && g.world.island) { this.giant(dt, P); return; }
    if (!L.allowPos) { this.leave(P); return; }
    const x = P.pos.x, z = P.pos.z, floor = L.floorAt(x, z), wy = L.waterY, depth = wy - floor;
    const hsp = Math.hypot(P.vel.x, P.vel.z), X = id === 'xlr8';
    const drop = Math.min(1.2, Math.max(0.35, (P.colH || 1.5) * 0.42)), surf = wy - drop;
    if (depth < 0.5 || floor > surf - 0.05) { this.leave(P); return; }                 // shallow: ordinary wading
    this.t += dt;
    if (X && (this.state === 'run' ? hsp > SWIM.WATER_RUN_END : hsp > SWIM.WATER_RUN_SPEED) && P.mode !== 'crouch') {
      if (this.state !== 'run') { this.state = 'run'; this.stats.runs++; g.hud.toast('WATER RUN'); }
      P.pos.y += (wy + 0.02 - P.pos.y) * Math.min(1, dt * 18); P.vel.y = 0; P.grounded = true; P.waterRun = true; this.stats.runTime += dt;
      if (P.waterFX) P.waterFX(dt);
      this.splashT -= dt; if (this.splashT <= 0) { this.splashT = 0.09; const f = _p.set(P.vel.x, 0, P.vel.z).normalize(); L.ripple && L.ripple(x - f.x * 1.2, z - f.z * 1.2, 0.5); g.fx.surface.ring(new THREE.Vector3(x - f.x * 1.6, wy + 0.05, z - f.z * 1.6), new THREE.Vector3(0, 1, 0), 2.2 + hsp * 0.05, 0.55, 0xd6f1ff); for (let i = 0; i < 3; i++) g.fx.glow.emit({ pos: new THREE.Vector3(x - f.x * (0.6 + i * 0.9) + (Math.random() - 0.5) * 0.8, wy + 0.1, z - f.z * (0.6 + i * 0.9) + (Math.random() - 0.5) * 0.8), vel: new THREE.Vector3((Math.random() - 0.5) * 2, 2 + Math.random() * 3, (Math.random() - 0.5) * 2), size: 0.3 + Math.random() * 0.3, life: 0.55, drag: 1.2, color: [0.75, 0.93, 1], alpha: 0.8 }); }
      return;
    }
    // surface swim
    if (this.state !== 'swim') { if (this.state !== 'run') { this.stats.entries++; L.splash && L.splash(x, z, Math.min(1.4, 0.5 + hsp * 0.05), P.vel); } this.state = 'swim'; }
    P.waterRun = false; this.stats.swimTime += dt;
    const top = X ? SWIM.speedXlr8 : SWIM.speed; if (hsp > top) { const k = Math.max(top / hsp, 1 - dt * 6); P.vel.x *= k; P.vel.z *= k; }
    const bob = Math.sin(this.t * 2.2) * 0.035;
    P.pos.y += (surf + bob - P.pos.y) * Math.min(1, dt * 9); P.vel.y = 0; P.grounded = true; if (P.mode === 'air') P.mode = 'ground';
    this.splashT -= dt; if (hsp > 0.8 && this.splashT <= 0) { this.splashT = 0.35; L.ripple && L.ripple(x, z, 0.35); g.fx.glow.emit({ pos: new THREE.Vector3(x, wy + 0.05, z), vel: new THREE.Vector3((Math.random() - 0.5), 1.2, (Math.random() - 0.5)), size: 0.2, life: 0.4, drag: 2, color: [0.8, 0.95, 1], alpha: 0.7 }); }
  }
  /** Way Big wades through the sea: his lower legs are under water (feet on the bed), in water deeper than ~60 % of his height he is held at chest depth; splashes + ripples round his legs */
  giant(dt, P) {
    const g = this.g, L = g.lagoon, x = P.pos.x, z = P.pos.z, wy = L.waterY, floor = L.floorAt(x, z), depth = wy - floor; if (depth < 0.6) { this.splashT = 0; return; }
    const cap = 0.6 * (P.colH || 20), hsp = Math.hypot(P.vel.x, P.vel.z);
    if (depth > cap) { P.pos.y += (wy - cap - P.pos.y) * Math.min(1, dt * 6); P.vel.y = 0; P.grounded = true; if (P.mode === 'air') P.mode = 'ground'; }
    this.splashT -= dt; if (this.splashT <= 0 && hsp > 1) { this.splashT = 0.28; const f = _p.set(P.vel.x, 0, P.vel.z).normalize(); for (const s of [-1, 1]) { const px = x + f.z * s * 3.2, pz = z - f.x * s * 3.2; L.splash && L.splash(px, pz, 1.3, P.vel); L.ripple && L.ripple(px, pz, 1.6); } g.fx.surface.ring(new THREE.Vector3(x, wy + 0.05, z), new THREE.Vector3(0, 1, 0), 14, 0.9, 0xcfeeff); }
    this.stats.swimTime += dt;
  }
  leave(P) { if (this.state !== 'none') { this.state = 'none'; if (P && P.waterRun) P.waterRun = false; } }
}
