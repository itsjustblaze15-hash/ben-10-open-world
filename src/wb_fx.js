// Way Big's visual / audio effects: giant-scale dust + debris, impact flashes, the chest-beam mesh and the chest glow. Everything is pooled (the shared GlowSystem / DebrisSystem pools, two reusable beam meshes).
import * as THREE from 'three';
import { clamp, rand } from './util.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0), _q = new THREE.Quaternion();

export class WbFx {
  constructor(game) {
    this.g = game; const mk = (color, r) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 18, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })); m.visible = false; m.frustumCulled = false; m.renderOrder = 15; m.userData.r = r; game.scene.add(m); return m; };
    this.beamOuter = mk(0xff2a1a, 4.2); this.beamCore = mk(0xfff0e0, 1.7); this.beamMid = mk(0xff7a50, 2.8); this.beamOn = false; this.shakeBase = 0;
  }
  /** a generic collapse / impact: dust, chunks, a sound and a camera shake that all fall off with the distance from the player */
  crashAt(pos, size = 8, trauma = 0.2) {
    const g = this.g, d = pos.distanceTo(g.player.pos), near = clamp(1.3 - d / 450, 0.08, 1);
    const n = clamp(Math.round(3 + size * 0.45), 3, 14);
    for (let i = 0; i < n; i++) g.fx.dust.emit({ pos, vel: _v.set(rand(-1, 1), rand(0.1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(0.4, 1.2) * (6 + size)), size: size * rand(0.8, 1.7), grow: 2.2, life: rand(1, 2.2), drag: 1.7, color: [0.66, 0.64, 0.6], alpha: 0.5 });
    g.props.debris.burst(pos, clamp(Math.round(3 + size * 0.5), 3, 16), 14 + size * 1.2, 0.5 + size * 0.07, 0xb9b6ae);
    if (trauma > 0.05) g.fx.glow.emit({ pos, size: size * 1.8, life: 0.12, drag: 0, color: [1, 0.9, 0.7], alpha: 0.8 });
    g.camera.addTrauma(trauma * near); g.sfx.crash(Math.min(0.9, 0.1 + size * 0.015) * near);
  }
  /** something heavy lands: a dust skirt on the ground */
  landAt(pos, v, h, mass) { const k = clamp(Math.log10(mass) - 1.5, 0.5, 4.5); this.crashAt(_w.set(pos.x, (this.g.world.terrain ? this.g.world.terrain.height(pos.x, pos.z) : 0) + 1, pos.z), 3 + k * 2.5, 0.05 * k); void v; void h; }
  /** a footfall / stomp dust skirt: n puffs spread on a ring of radius r around the foot (no glow - plain dust) */
  skirt(x, z, r, n, size, speed = 1) {
    const g = this.g, gy = g.world.terrain ? g.world.terrain.height(x, z) : 0;
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2 + rand(-0.2, 0.2); g.fx.dust.emit({ pos: _v.set(x + Math.cos(a) * r * 0.5, gy + 0.8, z + Math.sin(a) * r * 0.5), vel: _w.set(Math.cos(a) * rand(6, 14) * speed, rand(1, 4), Math.sin(a) * rand(6, 14) * speed), size: size * rand(0.7, 1.3), grow: 1.8, life: rand(0.9, 1.7), drag: 1.8, color: [0.64, 0.62, 0.58], alpha: 0.42 }); }
  }
  // ---------------------------------------------------------------------------------------- chest beam
  beam(o, d, len, k) {
    // k 0..1: width / brightness envelope. The beam is a stretched cylinder from the chest emitter `o` along `d`
    for (const m of [this.beamOuter, this.beamMid, this.beamCore]) {
      m.visible = k > 0.01; if (!m.visible) continue; const r = m.userData.r * (0.5 + 0.5 * k) * (1 + 0.06 * Math.sin(performance.now() * 0.05 + m.userData.r));
      m.position.copy(o).addScaledVector(d, len / 2); _q.setFromUnitVectors(UP, d); m.quaternion.copy(_q); m.scale.set(r, len, r); m.material.opacity = (m === this.beamCore ? 0.95 : m === this.beamMid ? 0.6 : 0.4) * k;
    }
    this.beamOn = k > 0.01;
  }
  hideBeam() { this.beamOuter.visible = this.beamMid.visible = this.beamCore.visible = false; this.beamOn = false; }
  chestGlow(p, k) {
    const g = this.g; if (k <= 0.02) return;
    g.fx.glow.emit({ pos: p, size: 5 + 22 * k, life: 0.06, drag: 0, color: [1, 0.35 + 0.5 * k, 0.25 + 0.55 * k], alpha: 0.5 + 0.5 * k });
    if (Math.random() < 0.6 * k) g.fx.glow.emit({ pos: p, vel: _v.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(12, 40) * (0.4 + k)), size: rand(0.8, 2.2), life: rand(0.2, 0.4), drag: 2.2, color: [1, 0.55, 0.35] });
  }
}
