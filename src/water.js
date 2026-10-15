// The lagoon: Ripjaws' water. The arena's decorative pool is replaced by a real basin that is carved out of the training ground:
//   - a walkable beach ramp (the shallows) that slopes down into a 4+ m deep bed with dunes, rock pillars, an arch, a reef wall, a rock island and sunken props
//   - vertical rock walls on three sides (real collision boxes, so the camera / projectiles / swimmers all respect them)
//   - a translucent animated surface, caustics + depth tint on everything below it, light rays, bubbles, marine snow and an underwater fog / tint when the camera is submerged
// Everybody else keeps the old flat virtual ground (y = 0): they wade through the shallows only down to ~1 m of water (blockDeep slides them back and says so), fly / hover / water-run (XLR8) across it,
// and cannot dive - only Ripjaws asks THIS module for the real floor, the water depth and the swim volume. The water level is a single plane (waterY); the volume is the lagoon rectangle below it.
import * as THREE from 'three';
import { clamp, damp, lerp, rand, smoothstep, mulberry32 } from './util.js';
import { ARENA } from './world.js';

export const LG = { x0: -16, x1: 0, z0: 19, z1: 34, waterY: -0.12, bed: 4.3 };
const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3();

// ------------------------------------------------------------------------------------------------ procedural textures
function canvas(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); return c; }
function tex(c, rx = 1, ry = 1, srgb = true) { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = 4; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; }
function sandCanvas() {
  return canvas(512, 512, (g, w, h) => {
    const rnd = mulberry32(21); g.fillStyle = '#b8a67b'; g.fillRect(0, 0, w, h);
    const img = g.getImageData(0, 0, w, h), d = img.data; for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * 26; d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.9; } g.putImageData(img, 0, 0);
    for (let i = 0; i < 26; i++) { g.strokeStyle = `rgba(${rnd() < 0.5 ? '120,100,66' : '226,210,160'},${0.10 + rnd() * 0.14})`; g.lineWidth = 2 + rnd() * 5; const y0 = rnd() * h, a = 3 + rnd() * 7, f = 0.012 + rnd() * 0.02, ph = rnd() * 6; g.beginPath(); for (let x = 0; x <= w; x += 8) { const y = y0 + Math.sin(x * f + ph) * a; x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
    for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '90,80,58' : '240,230,190'},${rnd() * 0.35})`; g.beginPath(); g.arc(rnd() * w, rnd() * h, 0.6 + rnd() * 2.4, 0, 7); g.fill(); }
  });
}
function rockCanvas(seed = 7) {
  return canvas(256, 256, (g, w, h) => {
    const rnd = mulberry32(seed); g.fillStyle = '#6a655d'; g.fillRect(0, 0, w, h);
    const img = g.getImageData(0, 0, w, h), d = img.data; for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * 36; d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.9; } g.putImageData(img, 0, 0);
    for (let i = 0; i < 70; i++) { const x = rnd() * w, y = rnd() * h, r = 14 + rnd() * 56, a = rnd() * 0.16, k = rnd(); const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(${k < 0.55 ? '28,26,24' : k < 0.85 ? '172,166,150' : '70,96,60'},${a})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
    for (let i = 0; i < 18; i++) { g.strokeStyle = `rgba(22,21,19,${0.12 + rnd() * 0.2})`; g.lineWidth = 1 + rnd() * 2.2; const y = rnd() * h; g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= w; x += 16) g.lineTo(x, y + Math.sin(x * 0.045 + i) * 4 + (rnd() - 0.5) * 5); g.stroke(); }
  });
}
function plankCanvas() {
  return canvas(256, 256, (g, w, h) => {
    const rnd = mulberry32(5); g.fillStyle = '#8b6a3e'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '60,40,20' : '170,130,80'},${0.12 + rnd() * 0.14})`; g.fillRect(0, i * 32, w, 30); g.fillStyle = 'rgba(30,18,8,0.55)'; g.fillRect(0, i * 32, w, 2); }
    for (let i = 0; i < 70; i++) { g.strokeStyle = `rgba(50,32,14,${0.1 + rnd() * 0.2})`; g.beginPath(); const y = rnd() * h, x = rnd() * w; g.moveTo(x, y); g.lineTo(x + 20 + rnd() * 60, y + (rnd() - 0.5) * 3); g.stroke(); }
    g.strokeStyle = '#3b2813'; g.lineWidth = 12; g.strokeRect(6, 6, w - 12, h - 12); g.lineWidth = 7; g.beginPath(); g.moveTo(10, 10); g.lineTo(w - 10, h - 10); g.moveTo(w - 10, 10); g.lineTo(10, h - 10); g.stroke();
  });
}

const CAUS = `
float caus(vec2 p, float t){
  vec2 q = p * 1.55;
  float a = sin(q.x * 1.3 + t * 0.9 + sin(q.y * 1.1 - t * 0.7));
  float b = sin(q.y * 1.5 - t * 0.8 + sin(q.x * 0.9 + t * 0.6));
  float c = sin((q.x + q.y) * 0.9 + t * 0.5);
  float v = (a * b + c) * 0.5;
  return pow(clamp(1.0 - abs(v), 0.0, 1.0), 7.0);
}`;
const TINT = (k) => `
{ float wet = smoothstep(uWaterY + 0.05, uWaterY - 0.35, vWPt.y);
  float dk = clamp((uWaterY - vWPt.y) / 8.0, 0.0, 1.0);
  float cs = caus(vWPt.xz, uTime);
  vec3 col = gl_FragColor.rgb;
  col *= mix(vec3(1.0), vec3(0.74, 0.94, 1.0), wet * ${k.toFixed(2)});
  col += vec3(0.34, 0.62, 0.60) * cs * 0.5 * wet * (1.0 - 0.45 * dk);
  col = mix(col, vec3(0.02, 0.20, 0.27), dk * 0.5 * wet);
  gl_FragColor.rgb = col; }`;

// ------------------------------------------------------------------------------------------------ particles
/** small pool of bubbles (ring + highlight sprites). They rise, wobble and pop at the surface. */
class Bubbles {
  constructor(scene, lagoon, cap = 520) {
    this.L = lagoon; this.cap = cap; this.n = 0; this.alive = 0;
    this.pos = new Float32Array(cap * 3); this.size = new Float32Array(cap); this.alpha = new Float32Array(cap);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1)); geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    this.uScale = { value: 500 };
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: this.uScale }, transparent: true, depthWrite: false,
      vertexShader: 'attribute float aSize; attribute float aAlpha; uniform float uScale; varying float vA; void main(){ vA=aAlpha; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=clamp(aSize*uScale/max(0.1,-mv.z),1.0,64.0); gl_Position=projectionMatrix*mv; }',
      fragmentShader: 'varying float vA; void main(){ vec2 p=gl_PointCoord*2.0-1.0; float d=length(p); if(d>1.0) discard; float ring=smoothstep(0.5,0.86,d)*(1.0-smoothstep(0.9,1.0,d)); float hi=smoothstep(0.36,0.0,length(p-vec2(-0.34,0.34)))*0.95; float a=(ring*0.75+hi+0.07)*vA; gl_FragColor=vec4(vec3(0.84,0.96,1.0),a); }',
    });
    this.points = new THREE.Points(geo, mat); this.points.frustumCulled = false; this.points.renderOrder = 6; scene.add(this.points);
    this.p = Array.from({ length: cap }, () => ({ on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: 0.05, life: 0, max: 1, ph: 0, wob: 0 }));
  }
  emit(x, y, z, vx = 0, vy = 0.8, vz = 0, size = 0.06, life = 3) {
    const q = this.p[this.n]; this.n = (this.n + 1) % this.cap; if (!q.on) this.alive++;
    q.on = true; q.x = x; q.y = y; q.z = z; q.vx = vx; q.vy = vy; q.vz = vz; q.s = size; q.life = q.max = life * rand(0.8, 1.15); q.ph = rand(0, 6.28); q.wob = rand(0.15, 0.5);
  }
  update(dt, renderer, camera) {
    this.uScale.value = renderer.domElement.height * 0.5 / Math.tan(camera.fov * Math.PI / 360);
    const wy = this.L.waterY, t = this.L.t;
    for (let i = 0; i < this.cap; i++) {
      const q = this.p[i]; if (!q.on) { this.alpha[i] = 0; continue; }
      q.life -= dt; q.vy += (0.85 + q.s * 5 - q.vy) * Math.min(1, 1.6 * dt);   // buoyancy: terminal rise speed grows a little with size
      const k = Math.exp(-2.0 * dt); q.vx *= k; q.vz *= k;
      q.x += (q.vx + Math.sin(t * 3.2 + q.ph) * q.wob * 0.45) * dt; q.z += (q.vz + Math.cos(t * 2.7 + q.ph) * q.wob * 0.45) * dt; q.y += q.vy * dt;
      if (q.y >= wy - 0.02 || q.life <= 0) { if (q.y >= wy - 0.02 && q.s > 0.045 && Math.random() < 0.25 && this.L.inRect(q.x, q.z)) this.L.ripple(q.x, q.z, 0.25); q.on = false; this.alive--; this.alpha[i] = 0; continue; }
      this.pos[i * 3] = q.x; this.pos[i * 3 + 1] = q.y; this.pos[i * 3 + 2] = q.z; this.size[i] = q.s; this.alpha[i] = Math.min(1, q.life * 2.2) * 0.9;
    }
    const g = this.points.geometry; g.attributes.position.needsUpdate = g.attributes.aSize.needsUpdate = g.attributes.aAlpha.needsUpdate = true;
  }
  clear() { for (const q of this.p) q.on = false; this.alive = 0; this.alpha.fill(0); }
}

/** drifting marine snow around the camera (only visible while submerged): the cue that gives swimming its sense of speed */
class Motes {
  constructor(scene, cap = 170) {
    this.cap = cap; this.pos = new Float32Array(cap * 3); this.off = new Float32Array(cap * 3); this.rng = mulberry32(99);
    for (let i = 0; i < cap * 3; i++) this.off[i] = (this.rng() - 0.5) * 2;
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.uK = { value: 0 }; this.uScale = { value: 500 };
    this.points = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: { uK: this.uK, uScale: this.uScale }, transparent: true, depthWrite: false,
      vertexShader: 'uniform float uScale; varying float vD; void main(){ vec4 mv=modelViewMatrix*vec4(position,1.0); vD=-mv.z; gl_PointSize=clamp(0.05*uScale/max(0.2,-mv.z),1.0,6.0); gl_Position=projectionMatrix*mv; }',
      fragmentShader: 'uniform float uK; varying float vD; void main(){ vec2 p=gl_PointCoord*2.0-1.0; float d=length(p); if(d>1.0) discard; gl_FragColor=vec4(0.8,0.95,0.95,(1.0-d)*0.5*uK*(1.0-smoothstep(10.0,16.0,vD))); }',
    }));
    this.points.frustumCulled = false; this.points.visible = false; this.points.renderOrder = 5; scene.add(this.points);
  }
  update(dt, t, cam, k, renderer) {
    this.uK.value = k; this.points.visible = k > 0.03; if (!this.points.visible) return;
    this.uScale.value = renderer.domElement.height * 0.5 / Math.tan(cam.fov * Math.PI / 360);
    const R = 8.5, c = cam.position;
    for (let i = 0; i < this.cap; i++) {
      const ox = this.off[i * 3], oy = this.off[i * 3 + 1], oz = this.off[i * 3 + 2];
      let x = (ox * R + t * (0.06 + 0.04 * oy) + Math.sin(t * 0.3 + i) * 0.3), y = (oy * R * 0.6 + t * 0.05 * (1 + ox) + Math.sin(t * 0.37 + i * 1.7) * 0.25), z = (oz * R + t * 0.04 * oz + Math.cos(t * 0.27 + i * 0.7) * 0.3);
      x = ((x + R * 3) % (2 * R)) - R; y = ((y + R * 3) % (1.2 * R)) - 0.6 * R; z = ((z + R * 3) % (2 * R)) - R;
      this.pos[i * 3] = c.x + x; this.pos[i * 3 + 1] = c.y + y; this.pos[i * 3 + 2] = c.z + z;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

// ------------------------------------------------------------------------------------------------ the lagoon
export class Lagoon {
  constructor(game) {
    this.g = game; this.scene = game.scene; this.world = game.world; this.t = 0; this.uw = 0; this.depthCam = 0; this.camMode = false; this.ripN = 0; this.enabled = true; this.blockOn = false; this.blockT = 0;
    const { x0, x1, z0, z1, waterY } = LG; this.x0 = x0; this.x1 = x1; this.z0 = z0; this.z1 = z1; this.waterY = waterY; this.rect = { x0, x1, z0, z1 };
    this.U = { uTime: { value: 0 }, uWaterY: { value: waterY } };
    this.rips = Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, 99, 0));
    this.mounds = [[-9.5, 28.8, 0.9, 1.9], [-3.6, 31.4, 0.8, 1.5], [-13.2, 32.2, 0.7, 1.4], [-5.5, 22.5, 0.35, 1.2]];
    this.stats = { splashes: 0, bubbles: 0 };
    this.lights = {}; this.scene.traverse(o => { if (o.isHemisphereLight) this.lights.hemi = o; });
    this.lights.sun = this.world.sun; this.fog = this.scene.fog; this.fog0 = { c: this.fog.color.clone(), near: this.fog.near, far: this.fog.far };
    this.lights.hemi0 = this.lights.hemi ? { i: this.lights.hemi.intensity, c: this.lights.hemi.color.clone(), g: this.lights.hemi.groundColor.clone() } : null; this.lights.sun0 = this.lights.sun.intensity;
    this.fxEl = document.getElementById('rjfx');
    this.mats = {
      sand: new THREE.MeshStandardMaterial({ map: tex(sandCanvas(), 5, 5), roughness: 1, metalness: 0 }),
      rock: new THREE.MeshStandardMaterial({ map: tex(rockCanvas(7), 1.6, 2.4), roughness: 0.95, metalness: 0 }),
      rock2: new THREE.MeshStandardMaterial({ map: tex(rockCanvas(13), 1, 1), roughness: 0.95, metalness: 0, color: 0xd8d4cc }),
      crate: new THREE.MeshStandardMaterial({ map: tex(plankCanvas(), 1, 1), roughness: 0.8, metalness: 0.05 }),
    };
    for (const m of Object.values(this.mats)) this.tint(m, 1);
    this.carve(); this.buildFloor(); this.buildWalls(); this.buildRocks(); this.buildSurface(); this.buildFX();
    this.world.lagoon = this; this.world.water = { x0, x1, z0, z1 };
  }

  // ------------------------------------------------------------------------------------------ rendering helpers
  /** patch a standard material: bluish depth tint + animated caustics below the water line (fragment only; cheap) */
  tint(mat, k = 1) {
    if (mat.userData.lagoonTint) return mat; mat.userData.lagoonTint = true; const U = this.U;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = U.uTime; sh.uniforms.uWaterY = U.uWaterY;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPt;').replace('#include <project_vertex>', '#include <project_vertex>\nvWPt = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPt; uniform float uTime; uniform float uWaterY;\n' + CAUS).replace('#include <opaque_fragment>', '#include <opaque_fragment>\n' + TINT(k));
    };
    mat.customProgramCacheKey = () => 'lagoon-tint-' + k; mat.needsUpdate = true; return mat;
  }
  tintObject(root) { root.traverse(o => { if (o.isMesh && o.material && !o.isSkinnedMesh) { if (Array.isArray(o.material)) o.material.forEach(m => this.tint(m, 0.8)); else this.tint(o.material, 0.8); } }); }

  /** the ground plane and the dark apron get a rectangular hole (UVs stay world-aligned so the concrete pattern is unchanged) */
  carve() {
    const w = this.world, A = ARENA, { x0, x1, z0, z1 } = this;
    this.scene.remove(w.ground); this.scene.remove(w.apron);
    const strip = (xa, xb, za, zb, src, y = 0, uv = true) => {
      const geo = new THREE.PlaneGeometry(xb - xa, zb - za); geo.rotateX(-Math.PI / 2); geo.translate((xa + xb) / 2, y, (za + zb) / 2);
      if (uv) { const p = geo.attributes.position, t = geo.attributes.uv; for (let i = 0; i < p.count; i++) t.setXY(i, (p.getX(i) + A) / (2 * A), 1 - (p.getZ(i) + A) / (2 * A)); }
      const m = new THREE.Mesh(geo, src.material); m.receiveShadow = src.receiveShadow; this.scene.add(m); return m;
    };
    this.strips = [strip(-A, A, -A, z0, w.ground), strip(-A, A, z1, A, w.ground), strip(-A, x0, z0, z1, w.ground), strip(x1, A, z0, z1, w.ground)];
    const B = 450, y = -0.05;
    this.strips.push(strip(-B, B, -B, z0, w.apron, y, false), strip(-B, B, z1, B, w.apron, y, false), strip(-B, x0, z0, z1, w.apron, y, false), strip(x1, B, z0, z1, w.apron, y, false));
  }

  /** height of the lagoon bed (y) at (x, z); 0 outside the basin. Smooth, so it is used directly for collision and for the visible mesh. */
  floorAt(x, z) {
    const { x0, x1, z0, z1 } = this; if (x <= x0 || x >= x1 || z <= z0 || z >= z1) return 0;
    const u = z - z0, dW = x - x0, dE = x1 - x, dS = z1 - z;
    let h = -LG.bed * smoothstep(0.1, 11.5, u);
    const bedK = smoothstep(7.5, 12.5, u);
    h += bedK * (0.3 * Math.sin(x * 0.85 + 0.6) * Math.sin(z * 0.65) + 0.18 * Math.sin(z * 1.7 + x * 1.1));
    for (const m of this.mounds) { const dx = x - m[0], dz = z - m[1]; h += m[2] * Math.exp(-(dx * dx + dz * dz) / (2 * m[3] * m[3])); }
    h += 1.3 * (1 - smoothstep(0, 2.4, Math.min(dW, dE, dS))) * smoothstep(3, 7, u);
    return Math.min(h, 0);
  }
  /** water depth over the bed (0 when dry / outside the basin) */
  depthAt(x, z) { return this.inRect(x, z) ? Math.max(0, this.waterY - this.floorAt(x, z)) : 0; }
  inRect(x, z, m = 0) { return x > this.x0 - m && x < this.x1 + m && z > this.z0 - m && z < this.z1 + m; }
  /** highest bed point under a footprint of radius r */
  floorRing(x, z, r) {
    if (!this.inRect(x, z, r + 0.2)) return 0; let g = this.floorAt(x, z);
    if (r > 0) g = Math.max(g, this.floorAt(x + r, z), this.floorAt(x - r, z), this.floorAt(x, z + r), this.floorAt(x, z - r)); return g;
  }
  /** walking ground for Ripjaws: the bed + the top of any box he can step onto (y + step) */
  groundFor(x, z, y, step = 0.45, r = 0.3) {
    let g = this.floorRing(x, z, r * 0.6);
    for (const b of this.world.boxes) if (x > b.min.x - r && x < b.max.x + r && z > b.min.z - r && z < b.max.z + r && b.max.y <= y + step && b.max.y > g) g = b.max.y;
    return g;
  }
  /** the bed height under a point that is below the water line (props resting on the bottom) */
  bedAt(x, z) { return this.inRect(x, z) ? this.floorAt(x, z) : 0; }
  /** floor for things that ended up below the water line (sunken props / debris): the bed + box tops; 0 anywhere else */
  sunkFloor(x, z, y) { return this.inRect(x, z) && y < this.waterY + 0.15 ? this.groundFor(x, z, y + 0.3, 0.3, 0.05) : 0; }
  /** minimum camera height at (x, z) (generalises the old flat 0.35 clamp) */
  camFloor(x, z) { return this.camMode && this.inRect(x, z, 0.3) ? this.floorAt(x, z) + 0.35 : 0.35; }
  /** keep land-bound entities (training dummies) out of the basin */
  keepOut(p, r) {
    const m = r + 0.15, { x0, x1, z0, z1 } = this; if (!(p.x > x0 - m && p.x < x1 + m && p.z > z0 - m && p.z < z1 + m)) return;
    const dl = p.x - (x0 - m), dr = (x1 + m) - p.x, dn = p.z - (z0 - m), ds = (z1 + m) - p.z, mn = Math.min(dl, dr, dn, ds);
    if (mn === dl) p.x = x0 - m; else if (mn === dr) p.x = x1 + m; else if (mn === dn) p.z = z0 - m; else p.z = z1 + m;
  }
  /** every ground walker except Ripjaws (and XLR8 while he water-runs) can wade the shallows but not enter water deeper than ~1 m: they slide back toward the beach (flyers / hoverers are above it) */
  blockDeep(p, r) {
    if (!this.inRect(p.x, p.z, 0.3)) return; const lim = 1.0, d = this.depthAt(p.x, p.z); if (d <= lim) return;
    const gz = (this.floorAt(p.x, p.z - 0.2) - this.floorAt(p.x, p.z + 0.2)) / 0.4;       // bed rise per metre toward the beach (north)
    p.z -= Math.min(0.25, gz > 0.08 ? (d - lim) / gz : 0.25);
    if (p === this.g.player.pos && this.blockT <= 0) { this.blockT = 2.5; this.g.hud.toast('TOO DEEP — ONLY RIPJAWS CAN DIVE'); }
  }
  /** 3D sphere vs every collider (boxes, standing enemies, the sloped bed, arena bounds): pushes p out, removes the velocity going into the surface. Returns bit flags 1 solid, 2 bed. */
  collideSphere(p, r, v = null, o = {}) {
    let hit = 0, nx = 0, ny = 0, nz = 0; const w = this.world;
    const into = () => { if (v) { const vn = v.x * nx + v.y * ny + v.z * nz; if (vn < 0) { v.x -= nx * vn; v.y -= ny * vn; v.z -= nz * vn; } } };
    for (const b of w.boxes) {
      if (b.max.y < p.y - r || b.min.y > p.y + r || p.x + r < b.min.x || p.x - r > b.max.x || p.z + r < b.min.z || p.z - r > b.max.z) continue;
      const cx = clamp(p.x, b.min.x, b.max.x), cy = clamp(p.y, b.min.y, b.max.y), cz = clamp(p.z, b.min.z, b.max.z), dx = p.x - cx, dy = p.y - cy, dz = p.z - cz, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) { const d = Math.sqrt(d2), k = (r - d) / d; p.x += dx * k; p.y += dy * k; p.z += dz * k; nx = dx / d; ny = dy / d; nz = dz / d; }
      else {                                                         // centre inside the box: leave through the nearest face
        const fx0 = p.x - b.min.x, fx1 = b.max.x - p.x, fy0 = p.y - b.min.y, fy1 = b.max.y - p.y, fz0 = p.z - b.min.z, fz1 = b.max.z - p.z, m = Math.min(fx0, fx1, fy0, fy1, fz0, fz1); nx = ny = nz = 0;
        if (m === fx0) { p.x = b.min.x - r; nx = -1; } else if (m === fx1) { p.x = b.max.x + r; nx = 1; } else if (m === fy0) { p.y = b.min.y - r; ny = -1; } else if (m === fy1) { p.y = b.max.y + r; ny = 1; } else if (m === fz0) { p.z = b.min.z - r; nz = -1; } else { p.z = b.max.z + r; nz = 1; }
      }
      into(); hit |= 1; if (o.onHit) o.onHit(b);
    }
    for (const c of w.cylinders) {
      if (c.dead || p.y + r < c.pos.y || p.y - r > c.pos.y + c.h) continue; const dx = p.x - c.pos.x, dz = p.z - c.pos.z, rr = r + c.r, d2 = dx * dx + dz * dz;
      if (d2 < rr * rr) { const d = Math.sqrt(d2) || 1e-4, k = (rr - d) / d; p.x += dx * k; p.z += dz * k; nx = dx / d; ny = 0; nz = dz / d; into(); hit |= 1; }
    }
    if (this.inRect(p.x, p.z, r)) {                                    // the bed (a smooth heightfield): clearance measured along its normal so slopes slide instead of stick
      const e = 0.25, f = this.floorAt(p.x, p.z), gx = (this.floorAt(p.x + e, p.z) - this.floorAt(p.x - e, p.z)) / (2 * e), gz = (this.floorAt(p.x, p.z + e) - this.floorAt(p.x, p.z - e)) / (2 * e), iy = 1 / Math.sqrt(1 + gx * gx + gz * gz);
      if ((p.y - f) * iy < r) { p.y = f + r / iy; nx = -gx * iy; ny = iy; nz = -gz * iy; into(); hit |= 2; }
    } else if (p.y < r) { p.y = r; nx = nz = 0; ny = 1; into(); hit |= 2; }
    const A = ARENA - 0.6; if (p.x < -A + r * 0.5) { p.x = -A + r * 0.5; if (v && v.x < 0) v.x = 0; } if (p.x > A - r * 0.5) { p.x = A - r * 0.5; if (v && v.x > 0) v.x = 0; } if (p.z < -A + r * 0.5) { p.z = -A + r * 0.5; if (v && v.z < 0) v.z = 0; } if (p.z > A - r * 0.5) { p.z = A - r * 0.5; if (v && v.z > 0) v.z = 0; }
    this.lastN = { x: nx, y: ny, z: nz }; return hit;
  }
  /** XZ position is over water deep enough to swim in (>= d) */
  swimmable(x, z, d = 1.4) { return this.depthAt(x, z) >= d; }

  // ------------------------------------------------------------------------------------------ geometry
  buildFloor() {
    const { x0, x1, z0, z1 } = this, sx = 64, sz = 60, geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0, sx, sz); geo.rotateX(-Math.PI / 2); geo.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const p = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, this.floorAt(clamp(x, x0 + 1e-4, x1 - 1e-4), clamp(z, z0 + 1e-4, z1 - 1e-4))); uv.setXY(i, x * 0.3, z * 0.3); }
    geo.computeVertexNormals(); this.floor = new THREE.Mesh(geo, this.mats.sand); this.floor.receiveShadow = true; this.scene.add(this.floor);
  }
  buildWalls() {
    const { x0, x1, z0, z1 } = this, w = this.world, top = 0, bot = -8, h = top - bot, T = 3;
    const wall = (xa, xb, za, zb) => {
      w.addBox((xa + xb) / 2, bot, (za + zb) / 2, xb - xa, h, zb - za, this.mats.rock, { cast: true });
      const e = w.boxes[w.boxes.length - 1]; e.lagoonWall = true; e.mesh.scale.y = 0.9985; e.mesh.position.y = bot + h / 2 - 0.0012 * h;     // the visible top sits a hair under the ground so the strips never z-fight with it
    };
    wall(x0 - T, x0, z0, ARENA); wall(x1, x1 + T, z0, ARENA); wall(x0, x1, z1, ARENA);
  }
  /** a rock formation as a real box collider (angular slabs read as rock); base sinks into the bed */
  rockBox(x, z, w, d, topY, mat = this.mats.rock2, name = 'rock') {
    const base = this.floorAt(x, z) - 1.2, h = topY - base; this.world.addBox(x, base, z, w, h, d, mat); const e = this.world.boxes[this.world.boxes.length - 1]; e.rockName = name; e.mesh.castShadow = true; return e;
  }
  buildRocks() {
    this.rocks = [];
    const R = (...a) => this.rocks.push(this.rockBox(...a));
    R(-8.0, 25.8, 3.4, 2.6, 0.85, this.mats.rock2, 'island');          // the rock island: breaks the surface, climbable from the water
    R(-3.8, 27.6, 1.3, 1.3, -1.1, this.mats.rock, 'pillar'); R(-14.2, 26.5, 1.5, 1.5, -0.2, this.mats.rock, 'pillar'); R(-6.5, 32.6, 1.2, 1.2, -2.0, this.mats.rock, 'pillar');
    // swim-through arch
    R(-13.3, 31, 1.1, 1.4, -1.35, this.mats.rock, 'arch'); R(-9.9, 31, 1.1, 1.4, -1.35, this.mats.rock, 'arch');
    { const base = -1.95, e = this.world.addBox(-11.6, base, 31, 5.2, 0.7, 1.4, this.mats.rock); void e; this.rocks.push(this.world.boxes[this.world.boxes.length - 1]); this.world.boxes[this.world.boxes.length - 1].rockName = 'arch'; }
    R(-2.7, 23.6, 0.9, 5.0, -0.55, this.mats.rock, 'reef');             // low reef wall that forms a swim lane along the east wall
    for (const [x, z, w, d, s] of [[-6.2, 29.8, 1.4, 1.1, 0.9], [-11.8, 28.4, 1.1, 1.3, 0.8], [-1.6, 29.5, 1.2, 1.0, 0.7], [-8.5, 22.2, 1.0, 1.0, 0.3], [-14.0, 29.6, 1.3, 1.1, 0.5]]) R(x, z, w, d, this.floorAt(x, z) + s, this.mats.rock2, 'boulder');
  }
  /** sunken test props: wooden crates + barriers (biteable), steel barrels, a trash can, a terminal (small machine part), a car shell (too hard) */
  populate(props) {
    const w = this.world, put = (p) => { p.planted = true; this.tintObject(p.root); return p; };
    const crate = (x, z, s, y0 = null) => { const y = y0 ?? this.floorAt(x, z) - 0.05; w.addBox(x, y, z, s, s, s, this.mats.crate); const e = w.boxes[w.boxes.length - 1]; return put(props.wrap(e, s > 1.7 ? 'heavy' : 'medium', s > 1.7 ? 420 : 170, s > 1.7 ? 160 : 110, 'crate', 0x8a6a3a)); };
    const c1 = crate(-4.6, 30.2, 1.5), c2 = crate(-6.2, 31.0, 1.5), c3 = crate(-5.3, 30.6, 1.3, null); c3.pos.y = c1.pos.y + 1.5; c3.home.pos.copy(c3.pos); props.syncRoot(c3); props.syncBox(c3);
    void c2;
    put(props.add('fence', -10.2, 24.6, { y: this.floorAt(-10.2, 24.6) - 0.05, yaw: 0.35 })); put(props.add('fence', -12.8, 27.4, { y: this.floorAt(-12.8, 27.4) - 0.05, yaw: -0.5 }));
    put(props.add('barrel', -1.5, 26.6, { y: this.floorAt(-1.5, 26.6) - 0.05 })); put(props.add('barrel', -2.4, 27.5, { y: this.floorAt(-2.4, 27.5) - 0.05 }));
    put(props.add('trash', -8.2, 29.6, { y: this.floorAt(-8.2, 29.6) - 0.05 })); put(props.add('computer', -1.3, 31.4, { y: this.floorAt(-1.3, 31.4) - 0.05, yaw: 2.6 }));
    put(props.add('car', -11.4, 22.4, { y: this.floorAt(-11.4, 22.4) - 0.05, yaw: 0, color: 0x5d7a6a }));   // lengthways to the shore so its box leaves a wide lane on both sides
    // beach scatter so the shallows are not bare
    props.add('pebble', -12.9, 19.9, { r: 0.4 }); props.add('pebble', -4.6, 20.3, { r: 0.35 });   // keep every shore obstacle low (<= step height) and well clear of the walls: nothing in the shallows can wedge a walker
  }

  buildSurface() {
    const { x0, x1, z0, z1, waterY } = this, geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0, 80, 80); geo.rotateX(-Math.PI / 2); geo.translate((x0 + x1) / 2, waterY, (z0 + z1) / 2);
    this.surfU = { uTime: this.U.uTime, uRip: { value: this.rips }, uSun: { value: this.world.sunDir.clone() }, uRect: { value: new THREE.Vector4(x0, z0, x1, z1) }, uK: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.surfU, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: `uniform float uTime; uniform vec4 uRip[8]; varying vec3 vW; varying vec3 vN;
        float rip(vec2 p){ float h=0.0; for(int i=0;i<8;i++){ vec4 r=uRip[i]; if(r.w<=0.0) continue; float d=length(p-r.xy); float f=r.z*2.4; h+=sin((d-f)*7.0)*exp(-abs(d-f)*2.2)*exp(-r.z*1.1)*r.w*0.07; } return h; }
        float H(vec2 p){ return 0.020*sin(p.x*1.7+uTime*1.2)+0.016*sin(p.y*2.1-uTime*1.0+1.3)+0.010*sin((p.x+p.y)*3.1+uTime*1.9)+rip(p); }
        void main(){ vec3 p=position; float e=0.12; float h=H(p.xz); float hx=H(p.xz+vec2(e,0.0)); float hz=H(p.xz+vec2(0.0,e)); vN=normalize(vec3(-(hx-h)/e,1.0,-(hz-h)/e)); p.y+=h; vW=p; gl_Position=projectionMatrix*viewMatrix*vec4(p,1.0); }`,
      fragmentShader: `uniform float uTime; uniform vec3 uSun; uniform vec4 uRect; varying vec3 vW; varying vec3 vN;
        void main(){
          vec3 N=normalize(vN); vec3 V=normalize(cameraPosition-vW); vec2 q=vW.xz;
          N.xz += 0.045*vec2(sin(q.x*9.0+uTime*2.3+sin(q.y*7.0)), cos(q.y*8.0-uTime*2.1+sin(q.x*6.0))); N=normalize(N);
          bool top=gl_FrontFacing; if(!top) N=-N;
          float ndv=clamp(dot(N,V),0.0,1.0); float fres=pow(1.0-ndv,3.0);
          vec3 R=reflect(-V,N); float sk=clamp(R.y*0.5+0.5,0.0,1.0); vec3 skyC=mix(vec3(0.62,0.78,0.9),vec3(0.2,0.45,0.82),sk);
          float edge=min(min(vW.x-uRect.x,uRect.z-vW.x),min(vW.z-uRect.y,uRect.w-vW.z));
          float foam=(1.0-smoothstep(0.0,0.3,edge))*(0.55+0.45*sin(vW.x*6.0+uTime*1.5)*sin(vW.z*5.0-uTime));
          vec3 col; float a;
          if(top){ float spec=pow(max(dot(R,uSun),0.0),180.0)*2.4; col=mix(vec3(0.03,0.30,0.38),skyC,fres*0.85)+spec+foam*0.55; a=clamp(mix(0.46,0.94,fres)+foam*0.4+spec*0.3,0.0,1.0); }
          else { float k=pow(1.0-ndv,2.0); float glare=pow(max(dot(-V,uSun),0.0),10.0)*0.5; col=mix(vec3(0.07,0.46,0.54),vec3(0.38,0.82,0.86),k)+vec3(0.5,0.85,0.8)*glare; a=mix(0.5,0.9,k); }
          gl_FragColor=vec4(col,a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.surface = new THREE.Mesh(geo, mat); this.surface.frustumCulled = false; this.surface.renderOrder = 3; this.scene.add(this.surface);
  }

  buildFX() {
    this.bubbles = new Bubbles(this.scene, this); this.motes = new Motes(this.scene);
    // light shafts: tall additive quads that hang from the surface (only drawn while the camera is submerged)
    this.rays = []; const rnd = mulberry32(31), { x0, x1, z0, z1, waterY } = this;
    const rg = new THREE.PlaneGeometry(1, 1); rg.translate(0, -0.5, 0);
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Mesh(rg, new THREE.ShaderMaterial({ uniforms: { uA: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader: 'uniform float uA; varying vec2 vUv; void main(){ float x=1.0-abs(vUv.x*2.0-1.0); float a=x*x*pow(vUv.y,1.6)*uA; gl_FragColor=vec4(vec3(0.55,0.95,0.9)*a,a); }' }));
      const wdt = 1.2 + rnd() * 1.8, len = 6 + rnd() * 2.5; m.scale.set(wdt, len, 1); m.position.set(lerp(x0 + 2, x1 - 2, rnd()), waterY, lerp(z0 + 5, z1 - 1.5, rnd()));
      m.rotation.set(0, rnd() * Math.PI, 0); m.rotateZ(0.16 + (rnd() - 0.5) * 0.1); m.userData = { ph: rnd() * 6.28, base: 0.1 + rnd() * 0.12 }; m.visible = false; m.renderOrder = 4; this.scene.add(m); this.rays.push(m);
    }
  }

  // ------------------------------------------------------------------------------------------ effects API
  ripple(x, z, amp = 1) { const r = this.rips[this.ripN++ % this.rips.length]; r.set(x, z, 0, amp); }
  bubble(x, y, z, size = 0.06, vx = 0, vy = 0.9, vz = 0, life = 3.5) { this.bubbles.emit(x, y, z, vx, vy, vz, size, life); this.stats.bubbles++; }
  /** a puff of n bubbles around p (radius spread) - breathing out, hits, impacts */
  bubbleBurst(p, n = 8, spread = 0.3, speed = 0.8, size = 0.06) {
    for (let i = 0; i < n; i++) this.bubbles.emit(p.x + rand(-spread, spread), p.y + rand(-spread, spread), p.z + rand(-spread, spread), rand(-speed, speed) * 0.4, rand(0.3, 1.2) * speed + 0.4, rand(-speed, speed) * 0.4, size * rand(0.5, 1.6), rand(2, 4));
    this.stats.bubbles += n;
  }
  /** soft cloud of silt (kicked up sand / impact haze) */
  silt(p, n = 6, size = 0.9) {
    const fx = this.g.fx; for (let i = 0; i < n; i++) fx.dust.emit({ pos: _a.set(p.x + rand(-0.3, 0.3), p.y + rand(-0.1, 0.3), p.z + rand(-0.3, 0.3)), vel: _b.set(rand(-1, 1), rand(0.1, 0.9), rand(-1, 1)).multiplyScalar(rand(0.4, 1.4)), size: rand(0.5, 1) * size, grow: 0.9, life: rand(0.7, 1.3), drag: 2.2, color: [0.55, 0.62, 0.55], alpha: 0.32 });
  }
  /** water surface splash at (x, z): rings, droplets, a bubble column below */
  splash(x, z, power = 1, vel = null) {
    const fx = this.g.fx, wy = this.waterY, p = clamp(power, 0.15, 2.2); this.stats.splashes++;
    fx.surface.ring(_a.set(x, wy + 0.04, z), UP, 1.2 + 2.6 * p, 0.55 + 0.25 * p, 0xcfeeff); if (p > 0.6) fx.surface.ring(_a.set(x, wy + 0.05, z), UP, 0.8 + 1.6 * p, 0.8, 0x9fd8ff);
    const n = Math.round(8 + 26 * p); for (let i = 0; i < n; i++) { const a = rand(0, 6.28), s = rand(0.8, 3.2) * (0.5 + 0.6 * p); fx.dust.emit({ pos: _a.set(x + Math.cos(a) * rand(0, 0.4), wy + 0.05, z + Math.sin(a) * rand(0, 0.4)), vel: _b.set(Math.cos(a) * s + (vel ? vel.x * 0.25 : 0), rand(2.5, 6.5) * (0.5 + 0.55 * p), Math.sin(a) * s + (vel ? vel.z * 0.25 : 0)), size: rand(0.1, 0.28), life: rand(0.55, 1.0), drag: 0.35, grav: 20, color: [0.85, 0.95, 1], alpha: 0.85 }); }
    this.bubbleBurst(_a.set(x, wy - 0.45, z), Math.round(6 + 16 * p), 0.35, 1.0, 0.07); this.ripple(x, z, p); this.g.camera.addTrauma(0.05 * p); if (this.g.sfx.splash) this.g.sfx.splash(clamp(0.3 * p, 0.1, 0.6));
  }
  /** wading splash (feet in the shallows) */
  wade(x, z, y, k = 1) {
    const fx = this.g.fx; for (let i = 0; i < 3 * k; i++) fx.dust.emit({ pos: _a.set(x + rand(-0.15, 0.15), this.waterY + 0.03, z + rand(-0.15, 0.15)), vel: _b.set(rand(-1, 1), rand(1.2, 3), rand(-1, 1)), size: rand(0.08, 0.2), life: rand(0.35, 0.6), drag: 0.4, grav: 16, color: [0.85, 0.95, 1], alpha: 0.7 });
    if (Math.random() < 0.5 * k) fx.surface.ring(_a.set(x, this.waterY + 0.03, z), UP, 0.7 + 0.4 * k, 0.45, 0xcfeeff); this.ripple(x, z, 0.35 * k);
  }
  clearFX() { this.bubbles.clear(); }

  // ------------------------------------------------------------------------------------------ per frame
  /** cam = the render camera. Under-water look: fog, light tint, DOM overlay, motes, light rays. */
  update(dt, cam, renderer) {
    this.t += dt; this.U.uTime.value = this.t; if (this.blockT > 0) this.blockT -= dt;
    for (const r of this.rips) if (r.w > 0) { r.z += dt; if (r.z > 4.5) r.w = 0; }
    const c = cam.position, inR = this.inRect(c.x, c.z, 0.1);
    const target = inR ? smoothstep(this.waterY + 0.04, this.waterY - 0.14, c.y) : 0;
    this.uw = Math.abs(target - this.uw) < 1e-3 ? target : damp(this.uw, target, 22, dt); const u = this.uw;
    this.depthCam = inR ? Math.max(0, this.waterY - c.y) : 0;
    // fog / light grade
    const F = this.fog, f0 = this.fog0; F.color.copy(f0.c).lerp(_UWFOG, u); F.near = lerp(f0.near, 3.5, u); F.far = lerp(f0.far, 46, u);
    const L = this.lights; if (L.hemi && L.hemi0) { L.hemi.intensity = lerp(L.hemi0.i, L.hemi0.i * 1.5, u); L.hemi.color.copy(L.hemi0.c).lerp(_UWHEMI, u * 0.75); L.hemi.groundColor.copy(L.hemi0.g).lerp(_UWGND, u * 0.7); }
    L.sun.intensity = lerp(L.sun0, L.sun0 * 0.62, u);
    if (this.fxEl) { const o = (0.55 + 0.45 * u) * u; this.fxEl.style.opacity = o.toFixed(3); }
    this.surfU.uK.value = u;
    for (const m of this.rays) { m.visible = u > 0.05; if (m.visible) m.material.uniforms.uA.value = u * m.userData.base * (0.55 + 0.45 * Math.sin(this.t * 0.6 + m.userData.ph)) * (1.0 - smoothstep(-2.0, -5.0, c.y) * 0.4); }
    this.motes.update(dt, this.t, cam, u, renderer);
    this.bubbles.update(dt, renderer, cam);
  }
  reset() { this.clearFX(); }
}
const _UWFOG = new THREE.Color(0x1b6f84), _UWHEMI = new THREE.Color(0x5fd0dc), _UWGND = new THREE.Color(0x14505e);
