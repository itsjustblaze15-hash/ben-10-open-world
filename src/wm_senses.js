// Wildmutt's Tracking Sense (Q).
// While it is on, the frame is drawn in three steps:
//   1. the normal scene into a half-float render target (with a depth texture),
//   2. ONLY the tracked enemies into a small mask target, flat-coloured with their real view distance (they are drawn from their true world position through the same camera,
//      so the silhouette tracks them exactly, around walls, vehicles and corners),
//   3. one full-screen composite: amber grade, reduced saturation, depth-weighted background blur, faint UV warp, depth-edge definition, vignette, activation pulse and the enemy outlines.
// The composite compares each enemy's distance with the scene depth at the same pixel: where a wall is in front, only a red outline (plus a faint hatched fill) is drawn - the enemy is NOT fully visible
// through geometry. Outlines fade out with distance (full strength near, gone at the range limit).
// Cost: nothing at all while the sense is off (the normal renderer path is used). While on: enemy lookup runs at 10 Hz over the (small) list of enemies, the mask pass only draws meshes of enemies
// currently in range, nothing is scanned per frame and no scene objects are duplicated (the enemies get a second render *layer* bit, nothing else).
import * as THREE from 'three';
import { clamp, damp, smoothstep, rand } from './util.js';

const MASK_LAYER = 1, RANGE = 46, EXTRA = 4;
const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

const MASK_FRAG = 'varying float vZ; void main(){ gl_FragColor = vec4(1.0, vZ, 0.0, 1.0); }';
const MASK_VERT = 'varying float vZ; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vZ = -mv.z; gl_Position = projectionMatrix * mv; }';

const COMP_FRAG = /* glsl */`
#include <packing>
varying vec2 vUv;
uniform sampler2D tScene, tDepth, tMask;
uniform vec2 uPx;           // 1 / scene target size
uniform vec2 uMaskPx;       // 1 / mask size
uniform float uK, uTime, uNear, uFar, uRange, uHas, uScale, uAspect, uPulse;
uniform vec2 uPulseC;

float zAt(vec2 uv){ return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar); }
vec3 cAt(vec2 uv){ return texture2D(tScene, uv).rgb; }
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float plum(vec3 c){ return dot(sqrt(max(c, 0.0)), vec3(0.299, 0.587, 0.114)); }

// compact FXAA (the scene target has no MSAA because the depth texture is needed)
vec3 fxaa(vec2 uv){
  vec2 px = uPx;
  vec3 cM = cAt(uv), cNW = cAt(uv + vec2(-1.0,-1.0) * px), cNE = cAt(uv + vec2(1.0,-1.0) * px), cSW = cAt(uv + vec2(-1.0,1.0) * px), cSE = cAt(uv + vec2(1.0,1.0) * px);
  float lM = plum(cM), lNW = plum(cNW), lNE = plum(cNE), lSW = plum(cSW), lSE = plum(cSE);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE))), lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  if (lMax - lMin < max(0.04, lMax * 0.12)) return cM;
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));
  float red = max((lNW + lNE + lSW + lSE) * 0.03125, 0.0078125);
  dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + red), -8.0, 8.0) * px;
  vec3 a = 0.5 * (cAt(uv + dir * (1.0/3.0 - 0.5)) + cAt(uv + dir * (2.0/3.0 - 0.5)));
  vec3 b = a * 0.5 + 0.25 * (cAt(uv + dir * -0.5) + cAt(uv + dir * 0.5));
  float lB = plum(b);
  return (lB < lMin || lB > lMax) ? a : b;
}

void main(){
  float k = uK;
  vec2 uv = vUv, cen = uv - 0.5;
  float edge = dot(cen, cen) * 4.0;
  // very subtle warp: a slow ripple, a little stronger towards the screen edges, plus a faint barrel pull
  vec2 q = uv + vec2(sin(uv.y * 21.0 + uTime * 1.6), cos(uv.x * 17.0 - uTime * 1.3)) * (0.0007 + 0.0020 * edge) * k - cen * 0.010 * k * edge;
  q = clamp(q, vec2(0.002), vec2(0.998));

  float z = zAt(q);
  vec3 raw;
  float blurPx = k * smoothstep(9.0, 60.0, z) * 3.4 * uScale;       // near stays sharp, the far background softens
  if (blurPx < 0.7) raw = fxaa(q);
  else {
    vec3 acc = cAt(q); float ws = 1.0;
    for (int i = 0; i < 12; i++) {
      float fi = float(i), a = fi * 2.39996, r = sqrt((fi + 0.5) / 12.0) * blurPx;
      vec2 o = vec2(cos(a), sin(a)) * r * uPx; float tz = zAt(q + o), w = tz > z - 1.2 ? 1.0 : 0.0;
      acc += cAt(q + o) * w; ws += w;
    }
    raw = acc / ws;
  }

  // ---- amber grade (linear light): desaturate, tint, lift the shadows, add contrast
  float l = luma(raw);
  vec3 g = mix(vec3(l), raw, 0.50);
  g *= vec3(1.14, 0.91, 0.50) * 0.96;
  g += vec3(0.022, 0.012, 0.0) * (1.0 - clamp(l * 2.0, 0.0, 1.0));
  g = max(mix(g, (g - 0.18) * 1.20 + 0.18, 0.85), 0.0);

  // ---- structure stays readable: a thin dark/amber contour wherever depth jumps (roads, walls, stairs, vehicles, silhouettes)
  vec2 e = uPx * 1.5 * uScale;
  float zl = zAt(q - vec2(e.x, 0.0)), zr = zAt(q + vec2(e.x, 0.0)), zu = zAt(q + vec2(0.0, e.y)), zd = zAt(q - vec2(0.0, e.y));
  float dz = max(max(abs(zl - z), abs(zr - z)), max(abs(zu - z), abs(zd - z)));
  float cont = smoothstep(0.035, 0.12, dz / max(z, 1.5));
  g = mix(g, g * 0.50 + vec3(0.050, 0.026, 0.0), cont * 0.60);

  // ---- enemy data
  vec3 ov = vec3(0.0); float ovA = 0.0, glowA = 0.0, fillA = 0.0; vec3 oc = vec3(1.0, 0.5, 0.1); float halo = 0.0;
  if (uHas > 0.5) {
    vec4 m0 = texture2D(tMask, q);
    float cov0 = m0.r;
    float dil = cov0, ero = cov0, zE = 1.0e5;
    if (cov0 > 0.2) zE = m0.g / cov0;
    float rr = 1.9 * uScale;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.785398; vec2 d = vec2(cos(a), sin(a));
      vec4 m = texture2D(tMask, q + d * uPx * rr);
      dil = max(dil, m.r); ero = min(ero, m.r);
      if (m.r > 0.2) zE = min(zE, m.g / m.r);
      // soft glow (outside the silhouette) and the "important object" halo
      vec4 g1 = texture2D(tMask, q + d * uPx * rr * 3.4), g2 = texture2D(tMask, q + d * uPx * rr * 6.5), h1 = texture2D(tMask, q + d * uPx * rr * 11.0);
      glowA += g1.r * 0.6 + g2.r * 0.4; halo += h1.r;
    }
    glowA = glowA / 8.0; halo = halo / 8.0;
    float rim = clamp(dil - ero, 0.0, 1.0);
    if (zE < 9.0e4) {
      float zS = z, eps = max(0.25, 0.02 * zE);
      float occ = zE > zS + eps ? 1.0 : 0.0;
      float fade = 1.0 - smoothstep(uRange * 0.55, uRange, zE);
      float pulse = 0.70 + 0.30 * sin(uTime * 4.4 - zE * 0.30);
      oc = mix(vec3(1.0, 0.52, 0.10), vec3(1.0, 0.15, 0.05), occ);
      ovA = rim * fade * pulse; glowA *= fade * pulse * (1.0 - cov0 * 0.6);
      float hatch = 0.5 + 0.5 * sin((gl_FragCoord.x + gl_FragCoord.y) * 0.85 + uTime * 5.0);
      fillA = cov0 * occ * fade * (0.10 + 0.07 * hatch) * pulse;
      halo *= fade;
    } else { glowA = 0.0; halo = 0.0; }
  }
  // stronger contrast around tracked enemies
  g = mix(g, max((g - 0.18) * 1.55 + 0.19, 0.0), clamp(halo * 1.4, 0.0, 1.0) * 0.55);

  // vignette + activation pulse (a ring that sweeps out from the character)
  float vg = smoothstep(0.30, 1.0, length(cen) * 1.45);
  g *= 1.0 - 0.36 * vg; g += vec3(0.028, 0.011, 0.0) * vg;
  if (uPulse >= 0.0 && uPulse < 1.0) {
    vec2 d = (uv - uPulseC) * vec2(uAspect, 1.0); float r = length(d), R = uPulse * 1.9, w = (r - R) * 8.0;
    g += vec3(1.0, 0.62, 0.22) * exp(-w * w * 1.6) * (1.0 - uPulse) * 0.42;
  }

  gl_FragColor = vec4(mix(raw, g, k), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // enemy overlay in display space (so the outline stays a clean orange / red)
  vec3 rgb = gl_FragColor.rgb;
  rgb = mix(rgb, oc, clamp(fillA * k, 0.0, 1.0));
  rgb += oc * glowA * 0.80 * k;
  rgb = mix(rgb, oc * 1.15, clamp(ovA * 1.25, 0.0, 1.0) * k);
  gl_FragColor = vec4(rgb, 1.0);
}`;

export class TrackingSense {
  constructor(game) {
    this.g = game; this.on = false; this.p = 0; this.k = 0; this.time = 0; this.pulse = -1; this.nTracked = 0; this.entries = new Map(); this.scanT = 0; this.trails = []; this.active = false; this.stats = { toggles: 0, maxTracked: 0, trailsMade: 0 };
    this.rt = null; this.maskRT = null; this.size = new THREE.Vector2(); this._v = new THREE.Vector2(); this._c = new THREE.Color(); this._p = new THREE.Vector3();
    this.maskMat = new THREE.ShaderMaterial({ vertexShader: MASK_VERT, fragmentShader: MASK_FRAG, side: THREE.DoubleSide, fog: false, toneMapped: false, blending: THREE.NoBlending });
    this.comp = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: COMP_FRAG, depthTest: false, depthWrite: false,
      uniforms: { tScene: { value: null }, tDepth: { value: null }, tMask: { value: null }, uPx: { value: new THREE.Vector2(1, 1) }, uMaskPx: { value: new THREE.Vector2(1, 1) }, uK: { value: 0 }, uTime: { value: 0 }, uNear: { value: 0.1 }, uFar: { value: 700 }, uRange: { value: RANGE }, uHas: { value: 0 }, uScale: { value: 1 }, uAspect: { value: 1 }, uPulse: { value: -1 }, uPulseC: { value: new THREE.Vector2(0.5, 0.45) } },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.comp); this.quad.frustumCulled = false; this.qScene = new THREE.Scene(); this.qScene.add(this.quad); this.qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    // short-lived, fading scent marks left by tracked enemies that move (only exist while the sense is on)
    const N = 128; this.trailMax = N;
    const geo = new THREE.RingGeometry(0.10, 0.27, 14); geo.rotateX(-Math.PI / 2);
    this.trailMesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false }), N);
    this.trailMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.trailMesh.count = 0; this.trailMesh.frustumCulled = false; this.trailMesh.visible = false; this.trailMesh.renderOrder = 5; game.scene.add(this.trailMesh);
    this.el = document.getElementById('tsstate'); this.setText();
  }
  setText() { if (!this.el) return; const t = 'TRACKING SENSE: ' + (this.on ? 'ACTIVE' : 'OFF'); if (this.el.textContent !== t) this.el.textContent = t; this.el.classList.toggle('on', this.on); }
  toggle() { this.setOn(!this.on); }
  /** instant = no transition (switching alien): the grade, the outlines and the marks vanish in the same frame */
  setOn(v, instant = false) {
    v = !!v; if (v !== this.on) { this.on = v; this.stats.toggles++; if (v) { this.pulse = 0; this.scanT = 0; } }
    if (instant) { this.p = v ? 1 : 0; this.k = v ? 1 : 0; if (!v) { this.pulse = -1; this.cleanup(); } }
    this.setText();
  }
  get busy() { return this.on || this.p > 0.001; }

  // ------------------------------------------------------------------ per frame (player time)
  update(dt) {
    this.time += dt; const rate = this.on ? 1 / 0.42 : 1 / 0.34;
    this.p = clamp(this.p + (this.on ? 1 : -1) * dt * rate, 0, 1); this.k = smoothstep(0, 1, this.p);
    if (this.pulse >= 0) { this.pulse += dt / 0.95; if (this.pulse >= 1) this.pulse = -1; }
    if (this.p <= 0 && !this.on) { if (this.active) this.cleanup(); return; }
    this.active = true;
    this.scanT -= dt; if (this.scanT <= 0) { this.scanT = 0.1; this.scan(); }
    this.updateTrails(dt);
  }
  /** 10 Hz: which enemies are in range (hysteresis), tag their meshes for the mask pass, drop scent marks behind the ones that move */
  scan() {
    const g = this.g, P = g.player.pos; let n = 0; const seen = new Set();
    for (const h of g.world.hittables) {
      if (h.kind !== 'dummy') continue; seen.add(h); let en = this.entries.get(h);
      if (!en) { en = { h, meshes: [], tracked: false, lx: h.root.position.x, lz: h.root.position.z }; h.root.traverse(o => { if (o.isMesh) en.meshes.push(o); }); this.entries.set(h, en); }
      const dx = h.root.position.x - P.x, dz = h.root.position.z - P.z, d = Math.hypot(dx, dz);
      const want = !h.dead && !h.held && (en.tracked ? d < RANGE + EXTRA : d < RANGE) && this.on;
      if (want !== en.tracked) { en.tracked = want; for (const m of en.meshes) { if (want) m.layers.enable(MASK_LAYER); else m.layers.disable(MASK_LAYER); } }
      if (want) {
        n++;
        const mv = Math.hypot(h.root.position.x - en.lx, h.root.position.z - en.lz);
        if (mv > 0.4 && this.on) { this.addTrail(h.root.position.x, h.root.position.z); en.lx = h.root.position.x; en.lz = h.root.position.z; }
      } else { en.lx = h.root.position.x; en.lz = h.root.position.z; }
    }
    for (const [h, en] of this.entries) if (!seen.has(h)) { for (const m of en.meshes) m.layers.disable(MASK_LAYER); this.entries.delete(h); }
    this.nTracked = n; this.stats.maxTracked = Math.max(this.stats.maxTracked, n);
  }
  addTrail(x, z) {
    if (this.trails.length >= this.trailMax) this.trails.shift();
    this.trails.push({ x, z, age: 0, life: rand(4.5, 5.5), s: rand(0.9, 1.15) }); this.stats.trailsMade++;
  }
  updateTrails(dt) {
    const T = this.trails, M = this.trailMesh; let w = 0; const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = this._c;
    for (let i = 0; i < T.length; i++) {
      const t = T[i]; t.age += dt; if (t.age >= t.life) continue; T[w] = t;
      const a = Math.pow(1 - t.age / t.life, 1.6), sc = t.s * (1 + 0.7 * t.age / t.life); s.set(sc, 1, sc); p.set(t.x, 0.05, t.z); m.compose(p, q, s); M.setMatrixAt(w, m);
      col.setRGB(1.0 * a * 1.5, 0.52 * a * 1.5, 0.12 * a * 1.5); M.setColorAt(w, col); w++;
    }
    T.length = w; M.count = w; M.visible = w > 0 && this.k > 0.02; M.instanceMatrix.needsUpdate = true; if (M.instanceColor) M.instanceColor.needsUpdate = true;
  }
  /** everything the sense put into the world is removed: render layer bits, marks, mask state */
  cleanup() {
    for (const [, en] of this.entries) { en.tracked = false; for (const m of en.meshes) m.layers.disable(MASK_LAYER); }
    this.entries.clear(); this.trails.length = 0; this.trailMesh.count = 0; this.trailMesh.visible = false; this.nTracked = 0; this.active = false; this.comp.uniforms.uHas.value = 0;
  }

  // ------------------------------------------------------------------ rendering
  ensureTargets(renderer) {
    renderer.getDrawingBufferSize(this._v); let w = this._v.x, h = this._v.y; const cap = Math.min(1, 2048 / Math.max(w, h)); w = Math.max(2, Math.round(w * cap)); h = Math.max(2, Math.round(h * cap));
    if (!this.rt) {
      const dt = new THREE.DepthTexture(w, h, THREE.UnsignedIntType); dt.minFilter = dt.magFilter = THREE.NearestFilter;
      this.rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true, depthTexture: dt, generateMipmaps: false });
      this.maskRT = new THREE.WebGLRenderTarget(Math.max(2, w >> 1), Math.max(2, h >> 1), { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true, generateMipmaps: false });
      this.comp.uniforms.tScene.value = this.rt.texture; this.comp.uniforms.tDepth.value = dt; this.comp.uniforms.tMask.value = this.maskRT.texture; this.size.set(0, 0);
    }
    if (this.size.x !== w || this.size.y !== h) {
      this.rt.setSize(w, h); this.maskRT.setSize(Math.max(2, w >> 1), Math.max(2, h >> 1)); this.size.set(w, h);
      const u = this.comp.uniforms; u.uPx.value.set(1 / w, 1 / h); u.uMaskPx.value.set(2 / w, 2 / h); u.uScale.value = clamp(h / 900, 0.8, 2.2); u.uAspect.value = w / h;
    }
  }
  /** returns false when the normal renderer path should be used (sense fully off) */
  render(renderer, scene, camera) {
    if (this.k < 0.002 && !this.on) return false;
    this.ensureTargets(renderer); const u = this.comp.uniforms;
    renderer.setRenderTarget(this.rt); renderer.render(scene, camera);
    const has = this.nTracked > 0 && this.k > 0.01; u.uHas.value = has ? 1 : 0;
    if (has) {
      const oldMask = camera.layers.mask, oldOv = scene.overrideMaterial, auto = renderer.shadowMap.autoUpdate, cc = renderer.getClearColor(this._c).clone(), ca = renderer.getClearAlpha();
      camera.layers.set(MASK_LAYER); scene.overrideMaterial = this.maskMat; renderer.shadowMap.autoUpdate = false; renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(this.maskRT); renderer.render(scene, camera);
      camera.layers.mask = oldMask; scene.overrideMaterial = oldOv; renderer.shadowMap.autoUpdate = auto; renderer.setClearColor(cc, ca);
    }
    u.uK.value = this.k; u.uTime.value = this.time; u.uNear.value = camera.near; u.uFar.value = camera.far; u.uPulse.value = this.pulse;
    const P = this.g.player; if (this.pulse >= 0 && P) { this._p.set(P.pos.x, P.pos.y + 1.0, P.pos.z).project(camera); u.uPulseC.value.set(this._p.x * 0.5 + 0.5, this._p.y * 0.5 + 0.5); }
    renderer.setRenderTarget(null); renderer.render(this.qScene, this.qCam);
    return true;
  }
}
