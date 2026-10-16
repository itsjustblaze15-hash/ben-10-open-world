// V30 DAY / NIGHT. One clock drives everything: sun + moon directions, sky colours / sunrise + sunset glow / stars, fog, hemisphere + key light, water tint, reflections,
// the lit windows of every building (shared NIGHT uniform in the facade shader - each window has its own switch-on time, so the city lights up and goes dark in a staggered way),
// street / porch / floodlight glow points (one draw call) with a small pool of real point lights near the camera, and the clock under the minimap.
// Default: one full 24 h day = 30 real minutes (DN.dayMinutes, or ?day=<minutes> in the URL, or game.dayNight.setDayMinutes(m)). The clock only advances while the game runs (paused = frozen).
import * as THREE from 'three';
import { NIGHT } from './style.js';
import { clamp, smoothstep } from '../util.js';

export const DN = { dayMinutes: 30, start: 0.30, speeds: [0.5, 1, 2, 5, 10, 50, 100], key: 'ben10_world_v31' };          // start 0.30 = 7:12 AM
const TAU = Math.PI * 2, C = (r, g, b) => new THREE.Color(r, g, b);
const DAY = { top: C(0.13, 0.42, 0.86), hor: C(0.72, 0.88, 0.98), gnd: C(0.62, 0.80, 0.92), fog: C(0.737, 0.851, 0.937), hemiS: C(0.847, 0.925, 1), hemiG: C(0.49, 0.54, 0.416), sun: C(1, 0.94, 0.847) };
const NGT = { top: C(0.006, 0.012, 0.05), hor: C(0.03, 0.055, 0.14), gnd: C(0.02, 0.035, 0.08), fog: C(0.025, 0.04, 0.09), hemiS: C(0.2, 0.26, 0.5), hemiG: C(0.09, 0.11, 0.17), moon: C(0.55, 0.65, 1) };
const RISE = C(1.0, 0.52, 0.5), SET = C(1.0, 0.4, 0.15);
const _c = new THREE.Color(), _v = new THREE.Vector3();
const POINT_VS = `attribute float aOn; attribute float aOff; attribute vec3 aCol; attribute float aSize; uniform float uNight; uniform float uScale; varying vec3 vC; varying float vA;
  void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); float on = step(aOn * 0.8 + 0.05, uNight) * (1.0 - aOff); float dist = -mv.z; vA = on * (1.0 - smoothstep(220.0, 520.0, dist)); vC = aCol; gl_PointSize = aSize * uScale / max(dist, 1.0); gl_Position = projectionMatrix * mv; }`;
const POINT_FS = `varying vec3 vC; varying float vA; void main(){ if (vA < 0.01) discard; float d = length(gl_PointCoord - 0.5) * 2.0; float core = exp(-d * d * 14.0), halo = exp(-d * d * 3.2) * 0.45; gl_FragColor = vec4(vC * (core * 1.6 + halo), (core + halo) * vA); gl_FragColor.rgb *= vA; }`;

export class DayNight {
  constructor(game, island) {
    this.g = game; this.world = game.world; this.island = island; this.renderer = game.renderer;
    const q = new URLSearchParams(location.search); const dm = parseFloat(q.get('day')); if (dm > 0.05) DN.dayMinutes = dm; const ts = parseFloat(q.get('time')); if (ts >= 0) DN.start = (ts % 24) / 24;
    // V31: WORLD time is its own clock: `scale` (0.5x..100x, pause-card setting) multiplies ONLY this clock (sky, lights, day counter, the spaceship) - never player movement, combat, physics or animation
    this.scale = 1; this.elapsed = 0; this.saveT = 0; this.t = DN.start;
    try { const sv = JSON.parse(localStorage.getItem(DN.key) || 'null'); if (sv && !q.get('time') && isFinite(sv.elapsed) && isFinite(sv.t) && !q.get('ship')) { this.elapsed = Math.max(0, sv.elapsed); this.t = ((sv.t % 1) + 1) % 1; } if (sv && [0.5, 1, 2, 5, 10, 50, 100].includes(sv.scale)) this.scale = sv.scale; } catch { /* storage unavailable */ }
    if (q.get('ship') === 'reset') this.elapsed = 0; const sd = parseFloat(q.get('shipday')); if (sd >= 0) this.elapsed = sd; const sc = parseFloat(q.get('timescale')); if (DN.speeds.includes(sc)) this.scale = sc;
    this.es = 1; this.night = 0; this.clock = 0; this.envKey = Math.floor(this.t * 12); this.envT = 0; this.lampT = 0; this.lightT = 0;
    this.sunV = new THREE.Vector3(); this.moonV = new THREE.Vector3();
    this.buildLamps(); this.buildClock(); this.buildSettings(); this.apply(0);
  }
  get dayNo() { return Math.floor(this.elapsed) + 1; }
  /** V32: the ship arrives at the END of day 10 (elapsed 10) and the invasion runs through day 10 -> Vilgax on day 11; the clock label never reads past 11 */
  get dayLabel() { const e = this.elapsed; return e < 10 ? Math.floor(e) + 1 : e < 11 ? 10 : 11; }
  save() { try { localStorage.setItem(DN.key, JSON.stringify({ elapsed: this.elapsed, t: this.t, scale: this.scale })); } catch { /* ignore */ } }
  setScale(k) { if (!DN.speeds.includes(k)) return; this.scale = k; this.save(); this.syncSettings(); }
  resetJourney() { this.elapsed = 0; this.save(); if (this.g.invasion) this.g.invasion.reset(); }
  setDayMinutes(m) { DN.dayMinutes = Math.max(0.1, +m || 30); }
  setTime(hours) { this.t = ((hours % 24) + 24) % 24 / 24; this.apply(0); this.regenEnv(); }
  get hours() { return this.t * 24; }
  get phase() { const h = this.hours; return h >= 5 && h < 7 ? 'SUNRISE' : h >= 7 && h < 17 ? 'DAY' : h >= 17 && h < 19.2 ? 'SUNSET' : 'NIGHT'; }
  // ---------------------------------------------------------------------------------------------------- per frame
  update(dt, camera) {
    if (dt > 0) { const dd = Math.min(dt, 0.1) / (DN.dayMinutes * 60) * this.scale; this.t = (this.t + dd) % 1; this.elapsed += dd; this.saveT -= dt; if (this.saveT <= 0) { this.saveT = 2; this.save(); } }
    this.apply(dt); this.lampsUpdate(dt, camera); this.clockUpdate(dt);
    const key = Math.floor(this.t * 12); if (key !== this.envKey) { this.envT += dt; if (this.envT > 3 || dt === 0) { this.envKey = key; this.envT = 0; this.regenEnv(); } }
  }
  apply(dt) {
    const w = this.world, a = TAU * (this.t - 0.25), es = Math.sin(a); this.es = es;
    this.sunV.set(Math.cos(a) * 0.95, es, 0.3).normalize(); this.moonV.set(-Math.cos(a) * 0.9, -es, 0.25).normalize();
    const day = smoothstep(-0.12, 0.28, es), twi = Math.exp(-Math.pow(es / 0.2, 2)), morning = this.t < 0.5; this.day = day; this.twi = twi;
    const U = w.skyMat.uniforms; U.uSun.value.copy(this.sunV); U.uMoon.value.copy(this.moonV); U.uDay.value = day; U.uTwi.value = twi; U.uTime.value += dt;
    _c.copy(NGT.top).lerp(DAY.top, day); U.uTop.value.set(_c.r, _c.g, _c.b); _c.copy(NGT.hor).lerp(DAY.hor, day); U.uHor.value.set(_c.r, _c.g, _c.b); _c.copy(NGT.gnd).lerp(DAY.gnd, day); U.uGnd.value.set(_c.r, _c.g, _c.b);
    _c.copy(morning ? RISE : SET); U.uGlow.value.set(_c.r, _c.g, _c.b);
    const fog = w.scene.fog; fog.color.copy(NGT.fog).lerp(DAY.fog, day).lerp(_c, twi * 0.32);
    // key light: the sun while it is up, otherwise the moon (both fade to 0 at the horizon, so the switch never pops)
    const sun = w.sun, up = es > 0;
    w.sunDir.copy(up ? this.sunV : this.moonV);
    if (up) { sun.intensity = 3.4 * smoothstep(0.0, 0.3, es) + 0.04; sun.color.copy(DAY.sun).lerp(_c, twi * 0.8); }
    else { sun.intensity = 0.5 * smoothstep(0.0, 0.25, -es); sun.color.copy(NGT.moon); }
    sun.visible = sun.intensity > 0.02;
    w.hemi.intensity = 0.24 + 0.66 * day + 0.22 * twi; w.hemi.color.copy(NGT.hemiS).lerp(DAY.hemiS, day).lerp(_c, twi * 0.18); w.hemi.groundColor.copy(NGT.hemiG).lerp(DAY.hemiG, day);
    const hr = this.t * 24, late = smoothstep(23, 27, hr < 12 ? hr + 24 : hr); this.night = 1 - smoothstep(-0.18, 0.12, es); NIGHT.value = this.night * (1 - 0.45 * late);      // fewer windows stay lit in the small hours
    const L = w.lagoon && w.lagoon.surfU; if (L) { L.uSun.value.copy(w.sunDir); L.uDay.value = clamp(day * 0.92 + 0.08 * (1 - this.night), 0, 1) * (up ? 1 : 0.85); L.uHazeC.value.set(fog.color.r, fog.color.g, fog.color.b); }
    if (this.pts) { this.pts.material.visible = this.night > 0.01; this.pts.material.uniforms.uNight.value = this.night; }
  }
  regenEnv() {
    const w = this.world; try {
      const pm = new THREE.PMREMGenerator(this.renderer), rt = pm.fromScene(w.envScene, 0.02), old = w.scene.environment; w.scene.environment = rt.texture; w.envMap = rt.texture; pm.dispose(); if (old && old.dispose) old.dispose();
    } catch (e) { console.warn('env regen', e); }
  }
  // ---------------------------------------------------------------------------------------------------- lamps (street lights, porch lights, floodlights, lab beacons)
  buildLamps() {
    const w = this.world, T = w.terrain, isl = this.island, pos = [], on = [], col = [], size = [], keys = new Map(); let n = 0;
    const add = (x, y, z, r, g, b, s, key, bld) => { pos.push(x, y, z); on.push(Math.random()); col.push(r, g, b); size.push(s); if (key) keys.set(key, n); if (bld) this.bldLamps.push({ i: n, b: bld }); n++; };
    this.bldLamps = [];
    for (const s of isl.spawns) if (s.kind === 'light') add(s.x, T.height(s.x, s.z) + 4.55, s.z, 1.0, 0.78, 0.42, 520, Math.round(s.x) + ',' + Math.round(s.z));
    for (const b of isl.B.list) {
      const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw), rot = Math.abs(Math.sin(b.yaw)) > 0.5, hd = (rot ? b.w : b.d) / 2 + 0.25;
      if (b.style === 4) add(b.x + fx * hd + fz * 0.95, b.y0 + 2.35, b.z + fz * hd - fx * 0.95, 1.0, 0.8, 0.45, 150, null, b);
      else if (b.style === 3) { const hw = (rot ? b.d : b.w) / 2 * 0.8; for (const sd of [-1, 1]) add(b.x + fx * hd + fz * hw * sd, b.y0 + Math.min(b.h, 9) - 0.5, b.z + fz * hd - fx * hw * sd, 1.0, 0.95, 0.75, 420, null, b); }
      else if (b.style === 5) add(b.x, b.y0 + b.h + 1.2, b.z, 0.3, 1.0, 0.6, 380, null, b);
      else if (b.style === 0 && b.h > 30) add(b.x, b.y0 + b.h + 1.0, b.z, 1.0, 0.2, 0.15, 300, null, b);          // red aircraft beacon on the tall towers
    }
    this.lampKeys = keys; this.nLamp = n; if (!n) return;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aOn', new THREE.Float32BufferAttribute(on, 1)); g.setAttribute('aOff', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
    g.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1)); g.computeBoundingSphere();
    this.pos = pos; const mat = new THREE.ShaderMaterial({ uniforms: { uNight: { value: 0 }, uScale: { value: 1 } }, vertexShader: POINT_VS, fragmentShader: POINT_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.pts = new THREE.Points(g, mat); this.pts.frustumCulled = false; this.pts.renderOrder = 5; this.pts.name = 'NightLamps'; w.scene.add(this.pts);
    this.lamps = this.pos.length / 3; this.lampOn = on; this.offAttr = g.attributes.aOff;
    { const N = 80, g2 = new THREE.BufferGeometry(); this.cpos = new Float32Array(N * 3); const cc = new Float32Array(N * 3), on2 = new Float32Array(N), off2 = new Float32Array(N), sz = new Float32Array(N).fill(330);
      for (let i = 0; i < N; i++) { const head = (i % 4) < 2; cc.set(head ? [1, 0.95, 0.8] : [1, 0.12, 0.08], i * 3); if (!head) sz[i] = 200; this.cpos[i * 3 + 1] = -500; }
      g2.setAttribute('position', new THREE.BufferAttribute(this.cpos, 3)); g2.setAttribute('aOn', new THREE.BufferAttribute(on2, 1)); g2.setAttribute('aOff', new THREE.BufferAttribute(off2, 1)); g2.setAttribute('aCol', new THREE.BufferAttribute(cc, 3)); g2.setAttribute('aSize', new THREE.BufferAttribute(sz, 1)); g2.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
      this.carPts = new THREE.Points(g2, new THREE.ShaderMaterial({ uniforms: { uNight: { value: 0 }, uScale: this.pts.material.uniforms.uScale }, vertexShader: POINT_VS, fragmentShader: POINT_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })); this.carPts.frustumCulled = false; this.carPts.renderOrder = 5; w.scene.add(this.carPts); }
    this.pool = []; for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xffc870, 0, 26, 2); l.castShadow = false; w.scene.add(l); this.pool.push(l); }
  }
  lampsUpdate(dt, camera) {
    if (!this.pts) return; const rh = this.renderer.getPixelRatio ? 1 : 1; this.pts.material.uniforms.uScale.value = this.renderer.domElement.height * 0.5 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * 0.012 * rh;
    if (this.carPts) { const cp = this.cpos, cars = (this.g.traffic && this.g.traffic.cars) || []; this.carPts.material.uniforms.uNight.value = this.night; this.carPts.visible = this.night > 0.02; let k = 0;
      for (let i = 0; i < 20; i++) { const c = cars[i]; for (let j = 0; j < 4; j++, k++) { if (!c) { cp[k * 3 + 1] = -500; continue; } const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw), side = j % 2 ? 0.75 : -0.75, fwd = j < 2 ? 2.2 : -2.2; cp[k * 3] = c.pos.x + fx * fwd + fz * side; cp[k * 3 + 1] = c.pos.y + 0.75; cp[k * 3 + 2] = c.pos.z + fz * fwd - fx * side; } }
      this.carPts.geometry.attributes.position.needsUpdate = true; }
    this.lampT -= dt; if (this.lampT <= 0) {                    // knocked-down street lights go dark (checked twice a second)
      this.lampT = 0.5; const P = this.g.props; if (P && P.props) { let ch = false; for (const p of P.props) { if (p.kind !== 'light') continue; const h = p.home ? p.home.pos : p.pos, i = this.lampKeys.get(Math.round(h.x) + ',' + Math.round(h.z)); if (i === undefined) continue; const off = (p.dead || p.wrecked || p.state === 'fly' || p.state === 'slide') ? 1 : 0; if (this.offAttr.array[i] !== off) { this.offAttr.array[i] = off; ch = true; } } for (const e of this.bldLamps) { const k = e.b.dm ? e.b.dm.k : 1, off = k < 0.97 ? 1 : 0; if (this.offAttr.array[e.i] !== off) { this.offAttr.array[e.i] = off; ch = true; } } if (ch) this.offAttr.needsUpdate = true; }
    }
    this.lightT -= dt; if (this.lightT <= 0) {                   // the 4 real point lights sit on the nearest lit lamps around the camera
      this.lightT = 0.35; const cp = camera.position, cand = []; const pa = this.pos;
      if (this.night > 0.05) for (let i = 0; i < this.lamps; i++) { if (this.offAttr.array[i]) continue; const dx = pa[i * 3] - cp.x, dz = pa[i * 3 + 2] - cp.z, d = dx * dx + dz * dz; if (d < 2500 && this.lampOn[i] * 0.8 + 0.05 < this.night && pa[i * 3 + 1] - cp.y < 60) cand.push([d, i]); }
      cand.sort((a, b) => a[0] - b[0]); this.targets = cand.slice(0, 4).map(c => c[1]);
    }
    for (let k = 0; k < 4; k++) { const L = this.pool[k], i = this.targets && this.targets[k]; if (i !== undefined) { L.position.set(this.pos[i * 3], this.pos[i * 3 + 1] - 0.3, this.pos[i * 3 + 2]); L.intensity += (4.2 * this.night - L.intensity) * Math.min(1, dt * 5); } else L.intensity += (0 - L.intensity) * Math.min(1, dt * 5); L.visible = L.intensity > 0.05; }
  }
  // ---------------------------------------------------------------------------------------------------- clock under the minimap
  buildClock() {
    const wrap = this.g.minimap && this.g.minimap.el; const el = document.createElement('div'); el.id = 'mm-clock';
    el.innerHTML = '<div class="ck-row"><span class="ck-ico"></span><b class="ck-time">7:12 AM</b><span class="ck-phase">DAY</span></div><div class="ck-bar"><i></i><u></u></div><div class="ck-day"><b class="ck-dn">DAY 1 / 10</b><span class="ck-ship" title="Spaceship approach"><i></i></span></div>';
    (wrap || document.getElementById('hud') || document.body).appendChild(el); this.el = el; this.timeEl = el.querySelector('.ck-time'); this.phaseEl = el.querySelector('.ck-phase'); this.icoEl = el.querySelector('.ck-ico'); this.barEl = el.querySelector('.ck-bar u'); this.dayEl = el.querySelector('.ck-dn'); this.shipEl = el.querySelector('.ck-ship i'); this.shown = '';
  }
  clockUpdate(dt) {
    const h = this.hours, hh = Math.floor(h), mm = Math.floor((h - hh) * 60), h12 = ((hh + 11) % 12) + 1, txt = h12 + ':' + String(mm).padStart(2, '0') + ' ' + (hh < 12 ? 'AM' : 'PM'), ph = this.phase, key = txt + ph;
    if (key !== this.shown) { this.shown = key; this.timeEl.textContent = txt; this.phaseEl.textContent = ph; this.el.dataset.phase = ph.toLowerCase(); this.icoEl.className = 'ck-ico ' + (ph === 'NIGHT' ? 'moon' : 'sun'); }
    this.barEl.style.left = (this.t * 100).toFixed(1) + '%';
    const ship = this.g.mothership, p = ship ? ship.progress : Math.min(1, this.elapsed / 10), dtxt = p >= 1 ? 'DAY ' + this.dayLabel + ' · SHIP ARRIVED' : 'DAY ' + this.dayNo + ' / 10' + (this.scale !== 1 ? ' · ' + this.scale + 'x' : '');
    if (dtxt !== this.dshown) { this.dshown = dtxt; this.dayEl.textContent = dtxt; } this.shipEl.style.width = (p * 100).toFixed(1) + '%';
  }
  /** pause-card section: WORLD TIME SPEED (affects only the world clock) */
  buildSettings() {
    const card = document.querySelector('#overlay .card'); if (!card) return; const sec = document.createElement('div'); sec.id = 'world-settings';
    sec.innerHTML = '<h4>WORLD SETTINGS</h4><div class="os-row"><span>WORLD TIME SPEED</span><div class="os-seg" id="ws-speed">' + DN.speeds.map(k => '<button type="button" data-v="' + k + '">' + k + '×</button>').join('') + '</div></div>' +
      '<div class="os-row"><span>SPACESHIP JOURNEY</span><div class="os-seg"><button type="button" id="ws-reset">Restart</button></div></div>' +
      '<p class="os-note">Speeds up ONLY the day / night clock, the day counter and the spaceship approach (10 in-game days). Player, combat and physics keep normal speed. 1 day = ' + DN.dayMinutes + ' min at 1×.</p>';
    const stop = e => e.stopPropagation(); for (const ev of ['click', 'mousedown', 'mouseup', 'pointerdown']) sec.addEventListener(ev, stop);
    sec.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; if (b.id === 'ws-reset') this.resetJourney(); else this.setScale(+b.dataset.v); b.blur(); });
    card.appendChild(sec); this.syncSettings();
  }
  syncSettings() { document.querySelectorAll('#ws-speed button').forEach(b => b.classList.toggle('on', +b.dataset.v === this.scale)); }
}
