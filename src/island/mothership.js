// V31 SPACESHIP EVENT (approach only). The supplied capital mother ship (assets/mothership_game.glb = the user's GLB, geometry thinned for the web, nothing redesigned) starts extremely far
// to the SOUTH (beach side) and flies continuously toward the exact centre of Main City over TEN in-game days of the WORLD clock (DayNight.elapsed: pause-card time speed scales it,
// gameplay time never does). It slows down, stops high above the city and hovers there for good. NO weapons, NO Vilgax, NO invasion, nothing spawns - it only approaches and parks.
//   progress = clamp(elapsed days / 10); path keyframes put it over the coastline around day 7, inland on day 8, near the city on day 9, parked at the end of day 10.
//   Far away the ship is drawn with the usual "sky object" trick (same direction, compressed distance, scaled down) so it is never clipped by the camera far plane or lost in the fog.
import * as THREE from 'three';
import { CITY } from './layout.js';

export const SHIP = { length: 460, altEnd: 240, altStart: 620, startZ: 6300, startX: 140, days: 10, farD: 2700, bob: 1.6 };
const KZ = [[0, 6300], [0.1, 5000], [0.2, 3900], [0.3, 3000], [0.4, 2200], [0.5, 1500], [0.6, 1000], [0.7, 650], [0.8, 330], [0.9, 110], [1, 0]];     // fraction of the journey -> distance (m) still to go, measured along the path (the coast is 660 m from the centre)
function lerpKey(p) { p = Math.min(1, Math.max(0, p)); let i = 0; while (i < KZ.length - 2 && p > KZ[i + 1][0]) i++; const [p0, z0] = KZ[i], [p1, z1] = KZ[i + 1], u = (p - p0) / (p1 - p0);
  // Catmull-Rom through the neighbours so the speed never jumps at a key
  const zm = i > 0 ? KZ[i - 1][1] : z0 + (z0 - z1), zp = i + 2 < KZ.length ? KZ[i + 2][1] : z1 - (z0 - z1) * 0.5, u2 = u * u, u3 = u2 * u;
  return 0.5 * ((2 * z0) + (-zm + z1) * u + (2 * zm - 5 * z0 + 4 * z1 - zp) * u2 + (-zm + 3 * z0 - 3 * z1 + zp) * u3); }

export class Mothership {
  constructor(game, island, loadGLB) {
    this.g = game; this.loaded = false; this.error = null; this.root = new THREE.Group(); this.root.name = 'Mothership'; this.root.visible = false; game.scene.add(this.root);
    this.hold = new THREE.Group(); this.root.add(this.hold); this.t = 0; this.pos = new THREE.Vector3(); this.baseScale = 1; this.dest = new THREE.Vector3(-278, SHIP.altEnd, -22);
    const c = CITY, cx = (c.ringX[0] + c.ringX[1]) / 2, cz = (c.avenueZ + (c.ringZ[0] + c.ringZ[1]) / 2) / 2;     // centre of Main City (between the avenue crossing and the block-grid centre)
    this.dest.set(c.avenueX, SHIP.altEnd, c.avenueZ); void cx; void cz;
    this.progressNow = 0; this.arrived = false; this.speed = 0; this.prev = new THREE.Vector3();
    this.load(loadGLB);
  }
  get progress() { const dn = this.g.dayNight; return dn ? Math.min(1, dn.elapsed / SHIP.days) : 0; }
  async load(loadGLB) {
    try {
      const gltf = await loadGLB('mothership_game'); const m = gltf.scene, box = new THREE.Box3().setFromObject(m), size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
      m.position.sub(ctr); this.hold.add(m); this.size = size;
      const longX = size.x >= size.z; this.hold.rotation.y = longX ? Math.PI / 2 : 0;     // the model's long axis (bow = +X) points along the flight direction (north, -Z)
      this.baseScale = SHIP.length / Math.max(size.x, size.z); this.hold.scale.setScalar(this.baseScale);
      m.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = false; const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const mt of ms) { if (mt) mt.fog = false; } } });
      this.buildLights(); this.thick = size.y * this.baseScale; this.span = Math.min(size.x, size.z) * this.baseScale; this.len = SHIP.length;
      this.loaded = true; this.root.visible = true; this.update(0, this.g.camera.camera || null);
    } catch (e) { this.error = String(e && e.message || e); console.error('MOTHERSHIP GLB FAILED TO LOAD:', e); try { this.g.hud.toast('SPACESHIP MODEL FAILED TO LOAD'); } catch { /* hud not ready */ } }
  }
  /** V32: engine glow at the stern + small underside lights (sprites in the ship's own frame, fog-free, additive; the model itself is untouched) */
  buildLights() {
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 1, 32, 32, 31); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c), sz = this.size, mk = (col, s, x0, y0, z0) => { const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: col, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })); m.scale.setScalar(s); m.position.set(x0, y0, z0); this.hold.add(m); return m; };
    this.engines = []; this.blink = [];
    for (let i = 0; i < 5; i++) this.engines.push(mk(0x66b8ff, sz.x * 0.05, -sz.x * 0.5 + 0.02, 0.02 * sz.y + (i - 2) * sz.y * 0.06, (this.cz || 0) + (i % 2 ? 1 : -1) * sz.z * 0.1 * (i > 2 ? 1.6 : 0.6)));
    for (let i = 0; i < 16; i++) { const t = i / 15; this.blink.push(mk(i % 3 ? 0xff3030 : 0xfff0d0, sz.x * 0.012, (t - 0.5) * sz.x * 0.82, -sz.y * 0.42, ((i * 7) % 5 - 2) * sz.z * 0.08)); }
  }
  lightsUpdate() { if (!this.engines) return; const k = this.arrived ? 1 : 0.55 + 0.35 * Math.min(1, this.progress * 3), t = this.t; for (let i = 0; i < this.engines.length; i++) this.engines[i].material.opacity = k * (0.8 + 0.2 * Math.sin(t * 5 + i)); for (let i = 0; i < this.blink.length; i++) this.blink[i].material.opacity = (Math.sin(t * 2.2 + i * 1.7) > 0.15) ? 1 : 0.25; }
  /** true world position for journey fraction p */
  place(p, out) {
    const rem = lerpKey(p), u = 1 - Math.min(1, rem / SHIP.startZ), ease = u;      // u: 0 at the start, 1 at the centre
    out.set(SHIP.startX + (this.dest.x - SHIP.startX) * ease, SHIP.altStart + (this.dest.y - SHIP.altStart) * ease, this.dest.z + rem * Math.cos(0) );
    out.z = this.dest.z + rem; return out;
  }
  update(dt, cam) {
    if (!this.loaded) return; this.t += dt; const p = this.progress; this.progressNow = p; const arrived = p >= 1; if (arrived && !this.arrived) this.arrived = true;
    this.place(p, this.pos);
    const bob = arrived ? SHIP.bob : SHIP.bob * 0.4; this.pos.y += Math.sin(this.t * 0.35) * bob; this.pos.x += Math.sin(this.t * 0.21) * bob * 0.5;
    this.hold.rotation.z = Math.sin(this.t * 0.27) * 0.004; this.hold.rotation.x = Math.sin(this.t * 0.19) * 0.003;
    const F = this.fin; if (F && F.mode !== 'hover') { this.pos.copy(F.pos); this.root.rotation.set(F.rx, F.ry, F.rz, 'YXZ'); } else if (this.root.rotation.x || this.root.rotation.y || this.root.rotation.z) this.root.rotation.set(0, 0, 0);
    const c = cam || this.g.cam3; let sc = 1; this.root.position.copy(this.pos);
    if (c) { const d = this.pos.distanceTo(c.position); if (d > SHIP.farD) { sc = SHIP.farD / d; this.root.position.lerpVectors(c.position, this.pos, sc); } }
    this.root.scale.setScalar(sc);
    this.lightsUpdate(); this.root.visible = true; this.root.updateMatrixWorld(true);
  }
}
