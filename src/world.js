// World: sky, lights, ground + colliders. V28: the ground is the ISLAND (heightfield terrain, src/island/*); the old 72 m training arena became the Omnitrix Labs research yard at the origin.
// Colliders: `boxes` = what every system iterates (legacy / dynamic entries + the island's static colliders NEAR the player and the active bosses, refreshed as they move);
// `statics` = every static island collider in a coarse grid (the source of that refresh). groundAt / resolveXZ / raySolid add the terrain itself.
import * as THREE from 'three';
import { mulberry32, clamp } from './util.js';
import { Ramp } from './ramps.js';
import { Terrain } from './island/terrain.js';
import { generateTerrain } from './island/terrain_gen.js';
import { BOUNDS } from './island/layout.js';

export const ARENA = 36; // half-size (m)

export function canvasTex(w, h, draw, { repeat = [1, 1], srgb = true, aniso = 8 } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat);
  t.anisotropy = aniso; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function drawConcrete(g, w, h, seed = 3, joints = true) {
  const rnd = mulberry32(seed);
  g.fillStyle = '#8c8e8f'; g.fillRect(0, 0, w, h);
  const img = g.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * 30; d[i] += n; d[i + 1] += n; d[i + 2] += n * 1.02; }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < 90; i++) { // soft mottling
    const x = rnd() * w, y = rnd() * h, r = 30 + rnd() * 140, a = rnd() * 0.07, dark = rnd() < 0.6;
    const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(${dark ? '40,42,44' : '210,212,212'},${a})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 14; i++) { // hairline cracks
    let x = rnd() * w, y = rnd() * h, a = rnd() * 6.28; g.strokeStyle = `rgba(35,36,38,${0.25 + rnd() * 0.3})`; g.lineWidth = 0.8 + rnd(); g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 14; k++) { a += (rnd() - 0.5) * 0.9; x += Math.cos(a) * (8 + rnd() * 16); y += Math.sin(a) * (8 + rnd() * 16); g.lineTo(x, y); }
    g.stroke();
  }
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(20,20,20,${rnd() * 0.25})`; g.beginPath(); g.arc(rnd() * w, rnd() * h, 0.6 + rnd() * 2.2, 0, 7); g.fill(); } // pits
  if (joints) { // expansion joints on the tile edge
    g.fillStyle = 'rgba(25,26,28,0.85)'; g.fillRect(0, 0, w, 5); g.fillRect(0, 0, 5, h);
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, 5, w, 2); g.fillRect(5, 0, 2, h);
  }
}
function drawCrate(g, w, h) {
  g.fillStyle = '#4b5a43'; g.fillRect(0, 0, w, h);
  const rnd = mulberry32(9); const img = g.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * 18; d[i] += n; d[i + 1] += n; d[i + 2] += n; } g.putImageData(img, 0, 0);
  g.strokeStyle = '#2a3226'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
  g.lineWidth = 6; g.beginPath(); g.moveTo(10, 10); g.lineTo(w - 10, h - 10); g.moveTo(w - 10, 10); g.lineTo(10, h - 10); g.stroke();
  g.fillStyle = '#d8d27a'; g.font = 'bold 34px sans-serif'; g.fillText('TEST', 22, 62); g.fillRect(20, h - 42, 90, 6);
}

export class World {
  constructor(scene, renderer, opts = {}) {
    this.scene = scene; this.renderer = renderer; this.island = opts.island !== false;
    this.boxes = [];       // AABB colliders {min,max} (legacy + dynamic + active island statics)
    this.cylinders = [];   // dummy colliders {pos, r, h}
    this.hittables = [];   // things projectiles can damage
    this.ramps = [];       // sloped solids (src/ramps.js): walkable surface + walls + rays, one source of truth
    this._tmp = new THREE.Vector3();
    this.statics = { cell: 32, map: new Map(), all: [] }; this.activeStatic = []; this.actT = 0; this.actCenters = [];
    this.bounds = this.island ? { ...BOUNDS } : { x0: -A_IN, x1: A_IN, z0: -A_IN, z1: A_IN };
    this.buildSky();
    this.buildLights();
    if (this.island) { this.terrain = new Terrain(scene, generateTerrain()); this.buildArena(true); }
    else { this.buildGround(); this.buildArena(false); }
  }
  // ------------------------------------------------------------ island static colliders (grid + active set)
  /** register a static island collider (axis-aligned box). info: { kind, mesh, small } - small colliders (trees, poles, rocks) use a shorter activation radius */
  addStatic(min, max, info = {}) {
    const b = Object.assign({ min: min.clone ? min.clone() : new THREE.Vector3(...min), max: max.clone ? max.clone() : new THREE.Vector3(...max), isl: true }, info), S = this.statics, c = S.cell;
    const i0 = Math.floor(b.min.x / c), i1 = Math.floor(b.max.x / c), j0 = Math.floor(b.min.z / c), j1 = Math.floor(b.max.z / c);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = i * 4096 + j; let a = S.map.get(k); if (!a) S.map.set(k, a = []); a.push(b); }
    S.all.push(b); return b;
  }
  /** static colliders overlapping a rectangle (unique) */
  staticsIn(x0, z0, x1, z1, out = [], stamp = ++this._stamp) {
    const S = this.statics, c = S.cell, i0 = Math.floor(x0 / c), i1 = Math.floor(x1 / c), j0 = Math.floor(z0 / c), j1 = Math.floor(z1 / c);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const a = S.map.get(i * 4096 + j); if (!a) continue; for (const b of a) { if (b._st === stamp || b.off) continue; b._st = stamp; if (b.max.x < x0 || b.min.x > x1 || b.max.z < z0 || b.min.z > z1) continue; out.push(b); } }
    return out;
  }
  /** rebuild the active part of `boxes` around the given centres [{x, z, r}] (big colliders within r, small ones within min(r, 95)) */
  refreshActive(centers) {
    this._stamp = (this._stamp || 0) + 1; const st = this._stamp, want = [];
    for (const c of centers) { const tmp = this.staticsIn(c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r, [], st); for (const b of tmp) { if (b.small) { const rr = Math.min(c.r, c.rs || 95); if (b.max.x < c.x - rr || b.min.x > c.x + rr || b.max.z < c.z - rr || b.min.z > c.z + rr) { b._st = 0; continue; } } want.push(b); } }
    const keep = this.boxes.filter(b => !b.isl); this.boxes.length = 0; for (const b of keep) this.boxes.push(b); for (const b of want) this.boxes.push(b); this.activeStatic = want;
  }
  /** called every frame with the player + active bosses; refreshes when someone moved far enough or periodically */
  updateActive(dt, list) {
    if (!this.island) return; this.actT -= dt; let need = this.actT <= 0 || list.length !== this.actCenters.length;
    if (!need) for (let i = 0; i < list.length; i++) { const a = list[i], b = this.actCenters[i]; if (Math.hypot(a.x - b.x, a.z - b.z) > 14 || Math.abs(a.r - b.r) > 1) { need = true; break; } }
    if (!need) return; this.actT = 0.6; this.actCenters = list.map(c => ({ ...c })); this.refreshActive(list.map(c => ({ ...c, r: c.r + 20 })));
  }
  // ------------------------------------------------------------ sky + environment
  buildSky() {
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uSun: { value: new THREE.Vector3(0.45, 0.62, 0.35).normalize() } },
      vertexShader: 'varying vec3 vD; void main(){ vD=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `varying vec3 vD; uniform vec3 uSun;
        float h(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
        float fbm(vec2 p){ float a=.5,s=0.; for(int i=0;i<5;i++){ s+=a*n(p); p*=2.03; a*=.5; } return s; }
        void main(){
          vec3 d=normalize(vD); float y=d.y;
          vec3 top=vec3(0.13,0.42,0.86), hor=vec3(0.72,0.88,0.98), gnd=vec3(0.62,0.80,0.92);
          vec3 c = y>0.0 ? mix(hor,top,pow(clamp(y,0.,1.),0.55)) : mix(hor,gnd,clamp(-y*3.,0.,1.));
          float sd=max(dot(d,normalize(uSun)),0.);
          c += vec3(1.0,0.93,0.75)*(pow(sd,900.)*6.+pow(sd,24.)*0.28);
          if(y>0.02){ vec2 uv=d.xz/(y+0.25)*1.6; float cl=smoothstep(0.52,0.86,fbm(uv+vec2(3.1,1.7))); c=mix(c,vec3(1.0),cl*0.9*smoothstep(0.02,0.25,y)); }
          gl_FragColor=vec4(c,1.0);
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(this.island ? 2800 : 400, 32, 16), skyMat);
    this.sky.renderOrder = -10; this.sky.frustumCulled = false; this.scene.add(this.sky);
    this.sunDir = skyMat.uniforms.uSun.value.clone();
    // reflections for crystals/concrete come from this same sky
    const envScene = new THREE.Scene(); envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat));
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.envMap = pm.fromScene(envScene, 0.02).texture; this.scene.environment = this.envMap; pm.dispose();
    this.scene.fog = this.island ? new THREE.Fog(0xbcd9ef, 260, 1500) : new THREE.Fog(0xb7c8d8, 70, 230);
  }
  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xd8ecff, this.island ? 0x7d8a6a : 0x6c6a66, this.island ? 0.9 : 0.55));
    const sun = this.sun = new THREE.DirectionalLight(0xfff0d8, 3.4);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera, sp = this.island ? 40 : 26; sc.left = -sp; sc.right = sp; sc.top = sp; sc.bottom = -sp; sc.near = 1; sc.far = this.island ? 220 : 140; this.shadowSpan = sp; this.sunDist = this.island ? 90 : 70;
    sun.shadow.bias = this.island ? -0.0006 : -0.0005; sun.shadow.normalBias = this.island ? 0.4 : 0.05;
    this.scene.add(sun, sun.target);
  }
  /** shadow frustum half-size / sun distance / far plane (Way Big enlarges all three) */
  setShadow(span, dist, far) { this.shadowSpan = span; this.sunDist = dist; const sc = this.sun.shadow.camera; sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span; sc.far = far; sc.updateProjectionMatrix(); this.sun.shadow.normalBias = span > 100 ? 1.4 : this.island ? 0.4 : 0.05; this.sun.shadow.bias = span > 100 ? -0.0015 : -0.0005; }
  followSun(p) { // keep the shadow frustum centred on the player (snapped to texels to avoid shimmer)
    const span = this.shadowSpan || 26, step = span * 2 / 2048; const sn = v => Math.round(v / step) * step;
    this.sun.target.position.set(sn(p.x), 0, sn(p.z));
    this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDir, this.sunDist || 70);
    this.sun.target.updateMatrixWorld();
  }

  // ------------------------------------------------------------ ground + structures
  buildGround() {
    const rep = (ARENA * 2) / 4;
    const map = canvasTex(1024, 1024, (g, w, h) => drawConcrete(g, w, h, 3, true), { repeat: [rep, rep] });
    const bump = canvasTex(1024, 1024, (g, w, h) => drawConcrete(g, w, h, 3, true), { repeat: [rep, rep], srgb: false });
    const mat = new THREE.MeshStandardMaterial({ map, bumpMap: bump, bumpScale: 1.4, roughness: 0.9, metalness: 0 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(ARENA * 2, ARENA * 2), mat);
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; this.scene.add(ground); this.ground = ground;
    // beyond the arena walls: darker apron so the horizon is not empty
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ color: 0x5c5e60, roughness: 1 }));
    apron.rotation.x = -Math.PI / 2; apron.position.y = -0.05; this.scene.add(apron); this.apron = apron;
    // floor markings
    const paint = (geo, color, x, z, ry = 0) => { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, transparent: true, opacity: 0.85 })); m.rotation.x = -Math.PI / 2; m.rotation.z = ry; m.position.set(x, 0.01, z); this.scene.add(m); return m; };
    paint(new THREE.RingGeometry(5.6, 5.8, 64), 0xe8c43a, 0, 12);
    paint(new THREE.RingGeometry(0.3, 0.45, 32), 0xe8c43a, 0, 12);
    for (let i = -3; i <= 3; i++) paint(new THREE.PlaneGeometry(0.25, 3), 0xe8c43a, i * 2.2, -4);       // firing-line hash marks
    paint(new THREE.PlaneGeometry(26, 0.22), 0xffffff, 0, -1.2);
    paint(new THREE.PlaneGeometry(26, 0.22), 0xffffff, 0, -22);
  }

  addBox(x, y, z, w, h, d, mat, { collide = true, cast = true } = {}) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y + h / 2, z); m.castShadow = cast; m.receiveShadow = true; this.scene.add(m);
    if (collide) this.boxes.push({ min: new THREE.Vector3(x - w / 2, y, z - d / 2), max: new THREE.Vector3(x + w / 2, y + h, z + d / 2), mesh: m });
    return m;
  }

  buildArena(island = false) {
    const concrete = (rx, ry, tint = 0xffffff, seed = 5) => new THREE.MeshStandardMaterial({
      color: tint, roughness: 0.88,
      map: canvasTex(512, 512, (g, w, h) => drawConcrete(g, w, h, seed, true), { repeat: [rx, ry] }),
      bumpMap: canvasTex(512, 512, (g, w, h) => drawConcrete(g, w, h, seed, true), { repeat: [rx, ry], srgb: false }), bumpScale: 1.1,
    });
    const A = ARENA;
    if (island) {
      // Omnitrix Labs research yard: concrete pad + a 3.2 m compound wall with gates on the west (z 4), south (x 0) and east (z 0) sides
      const rep = (A * 2) / 4, map = canvasTex(1024, 1024, (g, w, h) => drawConcrete(g, w, h, 3, true), { repeat: [rep, rep] });
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(A * 2 + 2, A * 2 + 2), new THREE.MeshStandardMaterial({ map, color: 0xe4eaea, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      pad.rotation.x = -Math.PI / 2; pad.position.y = 0.012; pad.receiveShadow = true; this.scene.add(pad); this.ground = pad;
      const wallM = new THREE.MeshToonMaterial({ color: 0xe9f1f0 }), trimM = new THREE.MeshToonMaterial({ color: 0x2fbf62 });
      const seg = (x0, x1, z0, z1) => { this.addBox((x0 + x1) / 2, 0, (z0 + z1) / 2, x1 - x0, 3.2, z1 - z0, wallM); const t = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 0.06, 0.25, z1 - z0 + 0.06), trimM); t.position.set((x0 + x1) / 2, 2.6, (z0 + z1) / 2); this.scene.add(t); };
      const W = A + 1, T = 0.8;
      seg(-W, W, -W - T, -W);                                             // north: closed (the main lab building stands behind it)
      seg(-W, -7, W, W + T); seg(7, W, W, W + T);                         // south gate at x = 0
      seg(-W - T, -W, -W, -3); seg(-W - T, -W, 11, W + T);                // west gate at z = 4
      seg(W, W + T, -W, -7); seg(W, W + T, 7, W + T);                     // east gate at z = 0
      for (const [x, z] of [[-W, -3], [-W, 11], [-7, W], [7, W], [W, -7], [W, 7]]) { const p = new THREE.Mesh(new THREE.BoxGeometry(1.6, 4.2, 1.6), trimM); p.position.set(x + (x < 0 ? -0.4 : 0.4) * (Math.abs(x) > 30 ? 1 : 0), 2.1, z + (z > 30 ? 0.4 : 0)); this.scene.add(p); this.addBox(p.position.x, 0, p.position.z, 1.6, 4.2, 1.6, trimM, { collide: true }); p.visible = false; }
    } else {
      // perimeter walls + pillars
      const wallM = concrete(14, 3, 0xd5d5d5, 11);
      this.addBox(0, 0, -A - 1, A * 2 + 4, 9, 2, wallM); this.addBox(0, 0, A + 1, A * 2 + 4, 9, 2, wallM);
      this.addBox(-A - 1, 0, 0, 2, 9, A * 2, wallM); this.addBox(A + 1, 0, 0, 2, 9, A * 2, wallM);
      const pilM = concrete(1, 3, 0xbdbdbd, 12);
      for (let i = -3; i <= 3; i++) for (const [px, pz] of [[i * 11, -A + 0.6], [i * 11, A - 0.6], [-A + 0.6, i * 11], [A - 0.6, i * 11]]) this.addBox(px, 0, pz, 1.7, 9.8, 1.7, pilM, { collide: false });
    }
    // cover walls (curved layout around the firing area)
    const coverM = concrete(4, 1, 0xdadada, 21);
    this.addBox(-14, 0, -6, 10, 3, 0.9, coverM); this.addBox(14, 0, -8, 0.9, 3, 9, coverM); this.addBox(10, 0, -12.5, 8, 3, 0.9, coverM);
    this.addBox(-24, 0, -18, 0.9, 3.4, 12, coverM);
    // jersey-style barriers
    const barM = concrete(1.5, 0.5, 0xcfcfcf, 31);
    for (const [x, z, ry] of [[-6, 4, 0], [6, 5, 0], [-2, -10, 0], [3, -17, 0]]) this.addBox(x, 0, z, 3.4, 1, 0.8, barM);
    // crates (stacked)
    const crateM = new THREE.MeshStandardMaterial({ map: canvasTex(256, 256, drawCrate, { repeat: [1, 1] }), roughness: 0.7, metalness: 0.3 });
    for (const [x, y, z, s] of [[22, 0, 8, 2.2], [22, 2.2, 8, 2.2], [24.4, 0, 9.4, 2.2], [20, 0, 11, 1.6], [-26, 0, 6, 2.2], [-26, 2.2, 6.4, 1.8]]) this.addBox(x, y, z, s, s, s, crateM);
    // step platforms (jump tests): 1.2 / 2.4 / 3.6
    const stepM = concrete(2, 1, 0xc9c9c9, 41);
    this.addBox(-22, 0, 20, 8, 1.2, 8, stepM); this.addBox(-23, 1.2, 21, 5.5, 1.2, 5.5, stepM); this.addBox(-24, 2.4, 22, 3, 1.2, 3, stepM);
    // open pavilion with four pillars + roof slab
    const pav = concrete(2, 1, 0xd0d0d0, 51);
    for (const [x, z] of [[14, 20], [22, 20], [14, 28], [22, 28]]) this.addBox(x, 0, z, 1.2, 5.2, 1.2, pav);
    this.addBox(18, 5.2, 24, 11, 0.9, 11, pav);
    // low wall that frames the target range
    this.addBox(0, 0, -29, 40, 1.4, 1.2, coverM);
  }

  addRamp(o) { const r = new Ramp(this.scene, o); this.ramps.push(r); return r; }

  // ------------------------------------------------------------ queries
  /** highest walkable surface under (x,z) that is at/below y+step (the island terrain is always a floor) */
  groundAt(x, z, y, step = 0.4, r = 0.25) {
    let g = this.terrain ? this.terrain.height(x, z) : 0;
    for (const b of this.boxes) {
      if (x > b.min.x - r && x < b.max.x + r && z > b.min.z - r && z < b.max.z + r && b.max.y <= y + step && b.max.y > g) g = b.max.y;
    }
    for (const rp of this.ramps) { if (x < rp.minx || x > rp.maxx || z < rp.minz || z > rp.maxz) continue; const hh = rp.height(x, z); if (hh <= y + step && hh > g) g = hh; }
    return g;
  }
  /** push a vertical capsule out of solid boxes + dummy cylinders (XZ); terrain too steep to walk up acts like a wall */
  resolveXZ(pos, r, y, h, stepH = 0.4) {
    for (const b of this.boxes) {
      if (b.max.y <= y + stepH || b.min.y >= y + h) continue; // stepped on / above head
      const cx = clamp(pos.x, b.min.x, b.max.x), cz = clamp(pos.z, b.min.z, b.max.z);
      let dx = pos.x - cx, dz = pos.z - cz; const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 > 1e-8) { const d = Math.sqrt(d2), k = (r - d) / d; pos.x += dx * k; pos.z += dz * k; }
        else { // centre inside box: push out the shortest way
          const ox = Math.min(pos.x - b.min.x, b.max.x - pos.x), oz = Math.min(pos.z - b.min.z, b.max.z - pos.z);
          if (ox < oz) pos.x += (pos.x - b.min.x < b.max.x - pos.x ? -1 : 1) * (ox + r); else pos.z += (pos.z - b.min.z < b.max.z - pos.z ? -1 : 1) * (oz + r);
        }
      }
    }
    for (const rp of this.ramps) rp.push(pos, r, y, stepH);
    for (const c of this.cylinders) {
      if (c.dead) continue;
      const dx = pos.x - c.pos.x, dz = pos.z - c.pos.z, rr = r + c.r, d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && y < c.pos.y + c.h) { const d = Math.sqrt(d2) || 1e-4, k = (rr - d) / d; pos.x += dx * k; pos.z += dz * k; }
    }
    if (this.terrain && stepH < 6) this.steepPush(pos, y, stepH);
    const lg = this.lagoon; if (lg && lg.blockOn && y < 0.6) lg.blockDeep(pos, r);                   // ground walkers other than Ripjaws cannot go into deep water
    const B = this.bounds; pos.x = clamp(pos.x, B.x0, B.x1); pos.z = clamp(pos.z, B.z0, B.z1);
  }
  /** cliffs: a walker standing near the ground cannot be moved onto terrain that rises steeper than ~50 deg above its feet (it slides back down the slope instead) */
  steepPush(pos, y, stepH) {
    const T = this.terrain, gnd = T.height(pos.x, pos.z); if (gnd <= y + Math.max(stepH, 0.25)) return;
    const s = T.slope(pos.x, pos.z); if (s < 1.15) return;                                            // walkable slope: the controller simply climbs it
    const g = T.gradient(pos.x, pos.z, _gr), L = Math.hypot(g.x, g.z) || 1;
    for (let k = 0; k < 8 && T.height(pos.x, pos.z) > y + Math.max(stepH, 0.25); k++) { pos.x -= g.x / L * 0.25; pos.z -= g.z / L * 0.25; }
  }
  /** segment vs boxes/ground -> {t, point, normal} | null (t in 0..1) */
  raySolid(o, d, maxT, noGround = false) {   // noGround: ignore the flat y=0 plane of the old arena (the island terrain is always tested - it is the real ground everywhere)
    let best = null;
    const tryHit = (t, n) => { if (t >= 0 && t <= maxT && (!best || t < best.t)) best = { t, normal: n }; };
    if (this.terrain) { const th = this.terrain.ray(o, d, maxT); if (th) tryHit(th.t, th.normal); }
    else if (!noGround && d.y < -1e-6) tryHit(-o.y / d.y, new THREE.Vector3(0, 1, 0));
    const ex = o.x + d.x * maxT, ez = o.z + d.z * maxT, mnx = Math.min(o.x, ex) - 0.01, mxx = Math.max(o.x, ex) + 0.01, mnz = Math.min(o.z, ez) - 0.01, mxz = Math.max(o.z, ez) + 0.01;
    for (const b of this.boxes) {
      if (b.max.x < mnx || b.min.x > mxx || b.max.z < mnz || b.min.z > mxz) continue;
      let tmin = 0, tmax = best ? best.t : maxT, nrm = null;
      for (const ax of ['x', 'y', 'z']) {
        const inv = 1 / (d[ax] || 1e-9); let t1 = (b.min[ax] - o[ax]) * inv, t2 = (b.max[ax] - o[ax]) * inv, s = -1;
        if (t1 > t2) { [t1, t2] = [t2, t1]; s = 1; }
        if (t1 > tmin) { tmin = t1; nrm = new THREE.Vector3(); nrm[ax] = s; }
        tmax = Math.min(tmax, t2); if (tmin > tmax) { nrm = null; tmin = Infinity; break; }
      }
      if (nrm && isFinite(tmin)) tryHit(tmin, nrm);
    }
    for (const rp of this.ramps) { const h = rp.ray(o, d, maxT); if (h) tryHit(h.t, h.normal); }
    if (best) best.point = o.clone().addScaledVector(d, best.t);
    return best;
  }
  /** island bounds clamp for anything that used the old arena limit */
  clampXZ(p, m = 0) { const B = this.bounds; p.x = clamp(p.x, B.x0 + m, B.x1 - m); p.z = clamp(p.z, B.z0 + m, B.z1 - m); return p; }
}
const _gr = { x: 0, z: 0 };
const A_IN = ARENA - 0.6;
