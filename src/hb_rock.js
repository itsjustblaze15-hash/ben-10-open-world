// V30 Heatblast flight platform: a floating slab of cooled lava rock that carries him while he flies (visual only - no terrain is touched, no collision is added).
// Grows out of a fire burst at take-off, jets flames and embers downwards, tilts with the flight direction and burns away when flight ends.
import * as THREE from 'three';
import { clamp, damp, rand } from './util.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3();
export class HbRock {
  constructor(game) {
    this.g = game; this.k = 0; this.t = 0; this.fxT = 0; this.tiltX = 0; this.tiltZ = 0;
    const g = new THREE.Group(); g.name = 'HB_RockPlatform'; g.visible = false;
    // V31 REWORK: a compact, flat-topped chunk of stylised stone (3 stacked tapering layers + a jet nozzle), a hand-painted stone texture, glowing cracks (emissive map), fire propulsion and a few orbiting pebbles
    let seed = 11; const rn = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const tex = (crack) => { const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
      if (!crack) { x.fillStyle = '#6a5a52'; x.fillRect(0, 0, 256, 256); for (let k = 0; k < 90; k++) { const px = rn() * 256, py = rn() * 256, r = 10 + rn() * 26, l = 70 + rn() * 50; x.fillStyle = 'hsl(24,' + (10 + rn() * 12) + '%,' + (22 + rn() * 22) + '%)'; x.beginPath(); for (let a = 0; a < 6; a++) { const an = a / 6 * 6.283 + rn() * 0.5, rr = r * (0.7 + rn() * 0.5); x.lineTo(px + Math.cos(an) * rr, py + Math.sin(an) * rr); } x.closePath(); x.fill(); x.strokeStyle = 'rgba(20,12,10,.55)'; x.lineWidth = 2; x.stroke(); void l; } }
      else { x.fillStyle = '#000'; x.fillRect(0, 0, 256, 256); x.lineCap = 'round'; for (let k = 0; k < 9; k++) { let px = rn() * 256, py = rn() * 256, an = rn() * 6.28; x.strokeStyle = 'rgb(255,' + (90 + rn() * 70 | 0) + ',20)'; x.lineWidth = 2 + rn() * 3; x.beginPath(); x.moveTo(px, py); for (let n = 0; n < 6; n++) { an += (rn() - 0.5) * 1.3; px += Math.cos(an) * (14 + rn() * 18); py += Math.sin(an) * (14 + rn() * 18); x.lineTo(px, py); } x.stroke(); } }
      const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = crack ? THREE.NoColorSpace : THREE.SRGBColorSpace; return t; };
    const rock = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex(false), emissive: 0xff5a14, emissiveMap: tex(true), emissiveIntensity: 1.3, roughness: 0.92, metalness: 0.02, flatShading: true });
    const lava = new THREE.MeshStandardMaterial({ color: 0xff5a10, emissive: 0xff4a08, emissiveIntensity: 1.6, roughness: 0.6 });
    const layer = (rt, rb, h, y, seg, jit, rot) => { const geo = new THREE.CylinderGeometry(rt, rb, h, seg, 1); const p = geo.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), a = Math.atan2(z, x); const j = 1 + jit * Math.sin(a * 3 + rot) + jit * 0.6 * Math.sin(a * 7 + rot * 2); p.setX(i, x * j); p.setZ(i, z * j); if (Math.abs(p.getY(i)) < h * 0.49) p.setY(i, p.getY(i) + (rn() - 0.5) * h * 0.12); }
      geo.computeVertexNormals(); const m = new THREE.Mesh(geo, rock); m.position.y = y; m.castShadow = true; g.add(m); return m; };
    layer(1.42, 1.32, 0.3, -0.15, 12, 0.05, 0.4);                      // the standing deck: broad, almost flat top
    layer(1.32, 0.98, 0.42, -0.5, 10, 0.08, 1.7);                      // body
    layer(0.98, 0.5, 0.5, -0.92, 8, 0.09, 2.9);                        // taper
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.24, 0.22, 10), lava); nozzle.position.y = -1.27; g.add(nozzle);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.36, 0.045, 6, 24), lava); ring.rotation.x = Math.PI / 2; ring.position.y = -0.005; g.add(ring); this.ring = ring;
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 7), lava); core.scale.set(1, 0.55, 1); core.position.y = -1.42; g.add(core); this.core = core;
    this.pebbles = []; for (let i = 0; i < 4; i++) { const pb = new THREE.Mesh(new THREE.DodecahedronGeometry(0.1 + 0.05 * (i % 2), 0), rock); pb.userData = { a: i * 1.57, r: 1.7 + 0.15 * i, y: -0.6 - 0.2 * (i % 2), sp: 0.8 + 0.2 * i }; g.add(pb); this.pebbles.push(pb); }
    this.rock = rock;
    game.scene.add(g); this.group = g;
  }
  /** pl: the Heatblast controller */
  update(dt, pl) {
    const on = pl.root.visible && pl.flying, g = this.g, G = this.group;
    this.k = damp(this.k, on ? 1 : 0, on ? 7 : 4, dt); this.t += dt;
    if (this.k < 0.02) { G.visible = false; return; }
    if (!this._was) this.burst(pl); this._was = on || this.k > 0.05; if (!on && this.k < 0.05) this._was = false;
    G.visible = true; const k = this.k, s = 0.25 + 0.75 * k;
    G.scale.set(s, s, s); G.position.set(pl.pos.x, pl.pos.y - 0.04 + 0.04 * Math.sin(this.t * 2.1), pl.pos.z);
    const fx = Math.sin(pl.yaw), fz = Math.cos(pl.yaw), vf = pl.vel.x * fx + pl.vel.z * fz, vl = pl.vel.x * fz - pl.vel.z * fx;
    this.tiltX = damp(this.tiltX, clamp(vf / 90, -0.26, 0.26), 3.2, dt); this.tiltZ = damp(this.tiltZ, clamp(vl / 90, -0.26, 0.26), 3.2, dt);
    G.rotation.set(this.tiltX, pl.yaw, -this.tiltZ, 'YXZ');
    const nk = g.dayNight ? g.dayNight.night : 0; this.rock.emissiveIntensity = (1.0 + 0.6 * nk) * (0.85 + 0.15 * Math.sin(this.t * 3.3)); for (const pb of this.pebbles) { const u = pb.userData; u.a += dt * u.sp; pb.position.set(Math.cos(u.a) * u.r, u.y + 0.08 * Math.sin(this.t * 2 + u.a), Math.sin(u.a) * u.r); pb.rotation.x += dt; pb.rotation.y += dt * 0.7; }
    this.ring.material.emissiveIntensity = 1.4 + 0.5 * Math.sin(this.t * 6); this.core.material.emissiveIntensity = 1.6 + 0.6 * Math.sin(this.t * 9);
    this.fxT -= dt; if (this.fxT <= 0 && on) {
      this.fxT = 0.035; const F = g.fire, y = pl.pos.y - 0.9;
      for (let i = 0; i < 3; i++) F.flame(_a.set(pl.pos.x + rand(-0.6, 0.6), y, pl.pos.z + rand(-0.6, 0.6)), _b.set(rand(-0.6, 0.6) - pl.vel.x * 0.1, rand(-5.5, -3), rand(-0.6, 0.6) - pl.vel.z * 0.1), rand(0.4, 0.8), rand(0.35, 0.7), 1.1);
      if (Math.random() < 0.6) F.spark(_a.set(pl.pos.x + rand(-1, 1), pl.pos.y - 0.5, pl.pos.z + rand(-1, 1)), _b.set(rand(-1.5, 1.5) - pl.vel.x * 0.2, rand(-3, 0.5), rand(-1.5, 1.5) - pl.vel.z * 0.2), rand(0.6, 1.1));
      const spd = Math.hypot(pl.vel.x, pl.vel.z); if (spd > 6) { const bx = -pl.vel.x / spd, bz = -pl.vel.z / spd; F.flame(_a.set(pl.pos.x + bx * 1.2 + rand(-0.3, 0.3), pl.pos.y - 0.6, pl.pos.z + bz * 1.2 + rand(-0.3, 0.3)), _b.set(bx * spd * 0.25, rand(-0.6, 0.4), bz * spd * 0.25), rand(0.3, 0.55), 0.5 + 0.02 * Math.min(spd, 30), 1.05); }     // smooth trail behind the slab
      if (Math.random() < 0.25) F.smoke(_a.set(pl.pos.x, pl.pos.y - 1.2, pl.pos.z), _b.set(-pl.vel.x * 0.2, -1, -pl.vel.z * 0.2), rand(0.9, 1.4), 1.2);
    }
  }
  burst(pl) { const F = this.g.fire; for (let i = 0; i < 20; i++) F.flame(_a.set(pl.pos.x, pl.pos.y - 0.2, pl.pos.z), _b.set(rand(-1, 1), rand(-0.3, 0.8), rand(-1, 1)).normalize().multiplyScalar(rand(2, 5)).clone(), rand(0.5, 1), rand(0.4, 0.7), 1.1); }
}
