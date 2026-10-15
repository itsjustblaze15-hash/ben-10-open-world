// Technology system for Upgrade. Every machine in the world is registered as a "technology" with
//   { isTechnology, technologyType: vehicle|robot|computer|device|turret, canMerge, canControl, canEnhance, isMerged, upgradeLevel, ... }
// and Upgrade can: MERGE (animated flow + spreading green circuitry) -> CONTROL (machine specific) -> ENHANCE (only what the machine can already do) -> DETACH (circuitry retracts,
// body flows out and reforms at a safe spot). Vehicles drive (own physics + collisions), robots walk and fire their arm cannons, turrets aim and fire, consoles run their connected systems,
// doors open. Nothing here teleports: every transition is an animation and every machine keeps its collision box.
import * as THREE from 'three';
import { clamp, damp, lerp, rand, angleDelta, smoothstep } from './util.js';
import { Dummy } from './dummies.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
const GREEN = [0.2, 1, 0.5], ARENA = 34.6;
const $ = id => document.getElementById(id);
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------------------------------------ circuitry overlay (green traces that spread from the contact point)
const CIRCUIT_VS = `varying vec3 vW; varying vec3 vP; void main(){ vP = position; vec4 w = modelMatrix * vec4(position + normal * 0.012, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const CIRCUIT_FS = `uniform float uFront; uniform float uTime; uniform float uFade; uniform float uLevel; uniform vec3 uOrigin; varying vec3 vW; varying vec3 vP;
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
  float d = distance(vW, uOrigin); float rv = smoothstep(uFront, uFront - 0.9, d); if (rv <= 0.001 || uFade <= 0.001) discard;
  vec3 n = normalize(cross(dFdx(vW), dFdy(vW))); vec3 an = abs(n); vec2 uv = an.y > an.x && an.y > an.z ? vW.xz : (an.x > an.z ? vW.zy : vW.xy);
  uv *= 3.4; vec2 c = floor(uv), f = fract(uv); float h = h21(c), h2 = h21(c + 7.3);
  float horiz = step(abs(f.y - 0.5), 0.07) * step(h, 0.62), vert = step(abs(f.x - 0.5), 0.07) * step(0.38, h) * step(h2, 0.7);
  float node = step(length(f - 0.5), 0.17) * step(0.55, h2); float tr = clamp(horiz + vert + node, 0.0, 1.0);
  float pulse = 0.62 + 0.38 * sin(uTime * 3.2 + h * 6.283 + d * 1.7); float edge = smoothstep(uFront - 0.35, uFront, d);
  vec3 col = mix(vec3(0.1, 1.0, 0.42), vec3(0.85, 1.0, 0.9), edge * 0.8 + 0.12 * uLevel);
  gl_FragColor = vec4(col * (0.8 + 0.5 * pulse), tr * rv * uFade);
}`;

// ------------------------------------------------------------------------------------------------ electronic door (a device)
export class Door {
  constructor(game, x, z, w, d, h = 3.2) {
    this.g = game; this.w = w; this.d = d; this.h = h; this.x = x; this.z = z; this.open = 0; this.target = 0; this.speed = 1.0; this.solid = true; this.holdOpen = false; this.autoClose = 0;
    const mat = new THREE.MeshStandardMaterial({ color: 0x3b4650, roughness: 0.4, metalness: 0.7 });
    this.mesh = game.world.addBox(x, 0, z, w, h, d, mat); this.box = game.world.boxes[game.world.boxes.length - 1];
    this.glow = new THREE.MeshStandardMaterial({ color: 0x101010, emissive: 0xff3322, emissiveIntensity: 1.2 });
    const along = w > d; for (const k of [-0.28, 0, 0.28]) { const s = new THREE.Mesh(new THREE.BoxGeometry(along ? 0.12 : d + 0.06, h * 0.78, along ? d + 0.06 : 0.12), this.glow); s.position.set(along ? k * w : 0, 0, along ? 0 : k * d); s.userData.noOverlay = true; this.mesh.add(s); }
    this.label = 'ELECTRONIC DOOR';
  }
  center(out) { return out.set(this.x, this.h * 0.5, this.z); }
  blocked() {
    const g = this.g, hx = this.w / 2 + 0.7, hz = this.d / 2 + 0.7, p = g.player.pos;
    if (Math.abs(p.x - this.x) < hx && Math.abs(p.z - this.z) < hz && p.y < this.h) return true;
    for (const h of g.world.hittables) if (!h.dead && h.root && Math.abs(h.root.position.x - this.x) < hx && Math.abs(h.root.position.z - this.z) < hz) return true;
    for (const q of g.props.props) if (!q.dead && !q.held && !q.driven && Math.abs(q.pos.x - this.x) < hx + q.half.x * 0.5 && Math.abs(q.pos.z - this.z) < hz + q.half.z * 0.5) return true;
    return false;
  }
  update(dt) {
    const w = this.g.world; if (this.target === 0 && this.holdOpen) this.target = 1;
    if (this.target === 1 && !this.holdOpen && this.autoClose > 0) { this.autoClose -= dt; if (this.autoClose <= 0) this.target = 0; }
    if (this.target === 1) this.open = Math.min(1, this.open + dt * this.speed); else if (this.target === 0 && !(this.open > 0 && this.open < 0.5 && this.blocked() && this.solid === false)) this.open = Math.max(0, this.open - dt * this.speed * 0.8);
    // the doorway stays passable until it is fully shut again: closing waits while somebody stands in it
    const want = this.open < 0.25; const idx = w.boxes.indexOf(this.box);
    if (want && idx < 0) { if (!this.blocked()) { w.boxes.push(this.box); this.solid = true; } else this.open = Math.max(this.open, 0.3); }
    else if (!want && idx >= 0) { w.boxes.splice(idx, 1); this.solid = false; }
    this.mesh.position.y = this.h / 2 + this.open * (this.h - 0.15);
    const on = this.open > 0.05; this.glow.emissive.setRGB(on ? 0.1 : 1, on ? 1 : 0.2, on ? 0.4 : 0.13); this.glow.emissiveIntensity = 1.1 + 0.4 * Math.sin(performance.now() * 0.006);
  }
}

// ------------------------------------------------------------------------------------------------ the technology registry
export class TechSystem {
  constructor(game) {
    this.g = game; this.list = []; this.doors = []; this.t = 0; this.stats = { merges: 0, controls: 0, enhances: 0, detaches: 0, vehicleKm: 0, hits: 0, shots: 0, uses: 0 };
    this.grid = { turrets: false, overdrive: false, floods: false, bay: false }; this.lamps = { floods: [], bay: [] }; this.lampMat = { floods: null, bay: null };
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.88, 1, 40), new THREE.MeshBasicMaterial({ color: 0x4cff7a, transparent: true, opacity: 0.8, depthWrite: false, depthTest: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    this.marker.rotation.x = -Math.PI / 2; this.marker.visible = false; this.marker.renderOrder = 12; game.scene.add(this.marker);
    this.beamGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true); this.scanT = 0;
  }

  // ---------------------------------------------------------------------------------------------- registration
  base(kind, label, extra) {
    const T = Object.assign({ isTechnology: true, technologyType: kind, kind, label, canMerge: true, canControl: true, canEnhance: true, isMerged: false, upgradeLevel: 0, maxLevel: 3, controlled: false, front: 0, frontMax: 6, origin: new THREE.Vector3(), tint: 0, overlay: [], fx: [], camBonus: 2, camH: 2.2, hitY: 1, hitR: 1.2, hp: 100, hpMax: 100 }, extra);
    T.uniforms = { uFront: { value: 0 }, uTime: { value: 0 }, uFade: { value: 1 }, uLevel: { value: 0 }, uOrigin: { value: T.origin } };
    T.mat = new THREE.ShaderMaterial({ uniforms: T.uniforms, vertexShader: CIRCUIT_VS, fragmentShader: CIRCUIT_FS, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.list.push(T); return T;
  }
  buildOverlay(T, root) {
    root.traverse(o => { if (o.isMesh && !o.userData.noOverlay && !o.userData.isOverlay && o.geometry && o.geometry.attributes.normal) { const m = new THREE.Mesh(o.geometry, T.mat); m.userData.isOverlay = true; m.visible = false; m.renderOrder = 3; m.castShadow = false; m.frustumCulled = false; o.add(m); T.overlay.push(m); } });
    T.root = root;
  }
  addProp(prop, kind, label, o = {}) {
    const T = this.base(kind, label, Object.assign({ prop, obj: prop, size: prop.size, hp: prop.hp, hpMax: prop.hpMax }, o)); prop.tech = T; this.buildOverlay(T, prop.inner);
    T.frontMax = Math.max(prop.size.w, prop.size.d, prop.size.h) * 1.3 + 1.5; T.hitY = prop.size.h * 0.5; T.hitR = Math.max(prop.size.w, prop.size.d) * 0.55;
    if (kind === 'vehicle') { const truck = prop.kind === 'truck'; T.spec = truck ? { vmax: 14, accel: 7.5, brake: 16, steer: 1.05, rev: 5, len: prop.size.d, wid: prop.size.w } : { vmax: 20, accel: 13, brake: 24, steer: 1.7, rev: 6.5, len: prop.size.d, wid: prop.size.w }; T.v = { speed: 0, steer: 0, boost: 1, hitCd: new Map(), snd: 0 }; T.camBonus = truck ? 5.5 : 3.6; T.camH = truck ? 3.4 : 2.6; }
    if (kind === 'robot') { T.r = { phase: 0, mv: 0, fire: 0, side: 1, vy: 0, aim: 0, hitCd: new Map() }; T.camBonus = 3; T.camH = 3.1; T.maxLevel = 3; }
    return T;
  }
  addConsole(prop, label, fns) {
    const T = this.addProp(prop, 'computer', label, { maxLevel: 2, fns, sel: 0, dirty: true }); T.camBonus = 0.5; T.camH = 1.8; T.canControl = true; T.screenT = 0; this.drawScreen(T); return T;
  }
  addDoor(door) {
    const T = this.base('device', door.label, { door, obj: door, maxLevel: 1, hp: 500, hpMax: 500 }); door.tech = T; this.buildOverlay(T, door.mesh); this.doors.push(door);
    T.frontMax = Math.max(door.w, door.d, door.h) * 1.4 + 1; T.camBonus = 2; T.camH = 2; T.hitY = 1.5; T.hitR = 1.2; T.canControl = true; return T;
  }
  addTurret(turret, label = 'SECURITY TURRET') {
    const T = this.base('turret', label, { turret, obj: turret, maxLevel: 3, hp: 150, hpMax: 150 }); turret.tech = T; this.buildOverlay(T, turret.root); T.frontMax = 4.5; T.camBonus = 1.2; T.camH = 2.5; T.hitY = 1.4; T.hitR = 1.1; T.tr = { cool: 0, yaw: turret.yaw || 0 }; return T;
  }
  addLamp(group, x, z, h = 4.4) {
    const g = this.g, pole = new THREE.MeshStandardMaterial({ color: 0x4c545c, roughness: 0.5, metalness: 0.6 });
    if (!this.lampMat[group]) this.lampMat[group] = new THREE.MeshStandardMaterial({ color: 0x555555, emissive: 0xfff1b0, emissiveIntensity: 0.05 });
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, h, 8), pole); p.position.set(x, h / 2, z); p.castShadow = true; g.scene.add(p);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.18, 0.5), this.lampMat[group]); head.position.set(x, h + 0.05, z); g.scene.add(head); this.lamps[group].push(head);
  }
  setGroup(name, on) { this.grid[name] = on; if (this.lampMat[name]) this.lampMat[name].emissiveIntensity = on ? 2.4 : 0.05; }

  // ---------------------------------------------------------------------------------------------- queries
  centerOf(T, out) { if (T.prop) return out.copy(T.prop.center); if (T.turret) return out.set(T.turret.root.position.x, 1.3, T.turret.root.position.z); if (T.door) return T.door.center(out); return out.set(0, 0, 0); }
  edgeDist(T, p) {
    if (T.prop) { const q = T.prop, h = q.half, dx = Math.max(q.pos.x - h.x - p.x, 0, p.x - (q.pos.x + h.x)), dz = Math.max(q.pos.z - h.z - p.z, 0, p.z - (q.pos.z + h.z)); return Math.hypot(dx, dz); }
    if (T.door) { const d = T.door, dx = Math.max(d.x - d.w / 2 - p.x, 0, p.x - (d.x + d.w / 2)), dz = Math.max(d.z - d.d / 2 - p.z, 0, p.z - (d.z + d.d / 2)); return Math.hypot(dx, dz); }
    const c = T.turret.root.position; return Math.max(0, Math.hypot(c.x - p.x, c.z - p.z) - 0.9);
  }
  alive(T) { if (T.prop) return !T.prop.dead; if (T.turret) return !T.turret.dead; return true; }
  /** best machine in front of Upgrade (within reach) */
  candidate(up, reach = 3.6) {
    let best = null, bs = 1e9; const fx = Math.sin(up.yaw), fz = Math.cos(up.yaw);
    for (const T of this.list) {
      if (T.isMerged || !T.canMerge || !this.alive(T)) continue; if (T.prop && (T.prop.held || T.prop.driven)) continue;
      const c = this.centerOf(T, _d), d = this.edgeDist(T, up.pos); if (d > reach || Math.abs(c.y - up.pos.y) > 4.5 + T.hitY) continue;
      const dx = c.x - up.pos.x, dz = c.z - up.pos.z, dl = Math.hypot(dx, dz), dot = dl > 0.05 ? (dx * fx + dz * fz) / dl : 1; if (dot < 0.1 && d > 1.0) continue;
      const aim = up.aimPt ? Math.hypot(up.aimPt.x - c.x, up.aimPt.z - c.z) : 9, sc = d - 1.2 * dot + 0.12 * Math.min(aim, 10); if (sc < bs) { bs = sc; best = T; }
    }
    return best;
  }
  hint(up) {
    const T = up.merged;
    if (up.techAnim) return up.techAnim.kind === 'merge' ? 'MERGING…' : 'DETACHING…';
    if (T) {
      const ctl = T.controlled, lv = T.upgradeLevel + '/' + T.maxLevel;
      let s = T.label + ' · LV ' + lv + ' · ' + this.statusLine(T);
      s += ctl ? '   |   ' + this.controlsLine(T) + '   |   [E] ENHANCE  [F] RELEASE  [T] DETACH' : '   |   [F] CONTROL  [E] ENHANCE  [T] DETACH';
      return s;
    }
    const c = this.candidate(up); return c ? '[LMB] MERGE — ' + c.label + ' · ' + c.technologyType.toUpperCase() + (c.upgradeLevel ? ' · LV ' + c.upgradeLevel : '') : '';
  }
  statusLine(T) {
    if (T.kind === 'vehicle') return Math.round(Math.abs(T.v.speed) * 3.6) + ' km/h · HP ' + Math.round(T.prop.hp / T.prop.hpMax * 100) + '%';
    if (T.kind === 'robot') return 'HP ' + Math.round(T.prop.hp / T.prop.hpMax * 100) + '%';
    if (T.kind === 'turret') return 'HP ' + Math.round(T.turret.hp / T.turret.maxHp * 100) + '%';
    if (T.kind === 'computer') { const f = T.fns[T.sel]; return f.name + ': ' + (f.on() ? 'ON' : 'OFF'); }
    return T.door.open > 0.5 ? 'OPEN' : 'CLOSED';
  }
  controlsLine(T) {
    if (T.kind === 'vehicle') return 'WASD DRIVE · SHIFT BOOST · SPACE BRAKE';
    if (T.kind === 'robot') return 'WASD WALK · SPACE JUMP · [LMB] FIRE CANNON';
    if (T.kind === 'turret') return 'MOUSE AIM · [LMB] FIRE';
    if (T.kind === 'computer') return 'A/D SELECT · [LMB]/SPACE RUN';
    return '[LMB] TOGGLE DOOR';
  }

  // ---------------------------------------------------------------------------------------------- merge / control / enhance / detach
  tryMerge(up) {
    if (up.techAnim || up.merged) return false; const T = this.candidate(up);
    if (!T) { this.g.hud.toast('NO TECHNOLOGY IN REACH'); return false; }
    this.startMerge(up, T); return true;
  }
  startMerge(up, T) {
    const g = this.g; up.liquid.on = false; up.cancelAct(); const c = this.centerOf(T, new THREE.Vector3()); T.origin.set(up.pos.x, up.pos.y + 1, up.pos.z); T.origin.lerp(c, 0.12); T.uniforms.uOrigin.value = T.origin;
    up.techAnim = { kind: 'merge', T, t: 0, dur: 1.0, from: new THREE.Vector3(up.pos.x, up.pos.y, up.pos.z), to: c.clone(), yaw0: up.yaw };
    for (const m of T.overlay) m.visible = true; T.front = 0; g.sfx.merge(true); g.camera.addTrauma(0.15); this.stats.merges++;
    this.snapshotColors(T);
  }
  snapshotColors(T) {
    T.root.traverse(o => { if (o.isMesh && !o.userData.isOverlay && o.material && o.material.color && !o.userData.noOverlay) { if (!o.userData.tc0) { o.userData.tc0 = o.material.color.clone(); if (!o.userData.cl) { o.material = o.material.clone(); o.userData.cl = true; } } } });
  }
  tintBase(T, k) {
    T.root.traverse(o => { if (o.userData.tc0 && o.material && o.material.color) { const c0 = o.userData.tc0, lum = c0.r * 0.3 + c0.g * 0.59 + c0.b * 0.11, tgt = lum > 0.42 ? 0.92 : 0.07; o.material.color.setRGB(lerp(c0.r, tgt, k * 0.8), lerp(c0.g, tgt, k * 0.8), lerp(c0.b, tgt, k * 0.8)); } });
  }
  finishMerge(up, T) {
    T.isMerged = true; up.merged = T; up.techAnim = null; up.root.visible = false; T.front = T.frontMax; T.tint = 1; this.tintBase(T, 1); T.controlled = false;
    if (T.prop) { const P = this.g.props; T.prop.driven = true; P.removeBox(T.prop); T.prop.state = 'rest'; T.prop.vel.set(0, 0, 0); T.prop.planted = false; if (T.prop.tumble) T.prop.tumble.set(0, 0, 0); }
    if (T.turret) { T.turret.override = true; T.tr.yaw = T.turret.yaw; }
    if (T.door) { T.door.target = 1; T.door.holdOpen = true; }
    up.pos.copy(this.centerOf(T, _a)); up.pos.y = T.prop ? T.prop.pos.y : 0; up.vel.set(0, 0, 0); this.g.hud.toast('MERGED — ' + T.label);
    if (T.canControl && (T.kind === 'vehicle' || T.kind === 'robot' || T.kind === 'turret')) this.startControl(up);          // vehicles / robots / turrets come alive immediately; F releases or retakes
  }
  startControl(up) {
    const T = up.merged; if (!T || !T.canControl || T.controlled) return; T.controlled = true; this.stats.controls++; this.g.sfx.servo(0.25);
    if (T.kind === 'computer') { T.screenT = 0; T.dirty = true; } this.g.hud.toast('CONTROLLING ' + T.label);
  }
  stopControl(up) { const T = up.merged; if (!T || !T.controlled) return; T.controlled = false; if (T.kind === 'vehicle') T.v.speed *= 0.5; this.g.hud.toast('CONTROL RELEASED'); }
  toggleControl(up) {
    if (up.techAnim) return; if (!up.merged) { const c = this.candidate(up); if (c) { this.startMerge(up, c); up.techAnim.control = true; } else this.g.hud.toast('NO TECHNOLOGY IN REACH — MERGE FIRST [LMB]'); return; }
    if (up.merged.controlled) this.stopControl(up); else this.startControl(up);
  }
  /** E: upgrade the merged machine by one level. Only improves what that machine can already do. */
  enhance(up) {
    const T = up.merged, g = this.g; if (!T) { g.hud.toast('MERGE WITH A MACHINE FIRST'); return false; } if (up.techAnim) return false;
    if (T.upgradeLevel >= T.maxLevel) { g.hud.toast(T.label + ' ALREADY AT MAX LEVEL'); return false; }
    if (up.energy < 25) { g.hud.toast('NOT ENOUGH ENERGY'); return false; } up.energy -= 25; up.cd.e = 1.2;
    T.upgradeLevel++; T.uniforms.uLevel.value = T.upgradeLevel / T.maxLevel; this.stats.enhances++; g.sfx.merge(true); g.camera.addTrauma(0.2);
    const L = T.upgradeLevel; let msg = T.label + ' LV' + L + ' — ';
    if (T.kind === 'vehicle') { const p = T.prop; p.hpMax = Math.round(p.hpMax0 || (p.hpMax0 = p.hpMax)) * (1 + 0.5 * L); p.hp = p.hpMax; msg += 'FASTER · BETTER HANDLING · TOUGHER'; this.addGlowParts(T, L); }
    else if (T.kind === 'robot') { const p = T.prop; p.hpMax = Math.round(p.hpMax0 || (p.hpMax0 = p.hpMax)) * (1 + 0.5 * L); p.hp = p.hpMax; msg += L === 2 ? 'SHOULDER CANNONS ONLINE' : 'STRONGER · FASTER FIRE · TOUGHER'; this.addGlowParts(T, L); }
    else if (T.kind === 'turret') { T.turret.maxHp = 150 * (1 + 0.5 * L); T.turret.hp = T.turret.maxHp; msg += 'FASTER FIRE · MORE DAMAGE · TOUGHER'; this.addGlowParts(T, L); }
    else if (T.kind === 'computer') { msg += T.fns.filter(f => f.lvl === L).map(f => f.name + ' UNLOCKED').join(', ') || 'FASTER PROCESSING'; T.dirty = true; this.addGlowParts(T, L); }
    else if (T.kind === 'device') { T.door.speed = 2.6; T.door.holdOpen = true; msg += 'FASTER MOTOR · STAYS OPEN'; this.addGlowParts(T, L); }
    g.hud.toast(msg); this.pulse(T, 28); return true;
  }
  scan() { this.scanT = 3; let n = 0; for (const T of this.list) if (this.alive(T)) { n++; this.pulse(T, 14); } this.g.hud.toast('DIAGNOSTICS: ' + n + ' MACHINES ONLINE'); }
  pulse(T, n = 20) { const c = this.centerOf(T, _c); for (let i = 0; i < n; i++) this.g.fx.glow.emit({ pos: _a.set(c.x + rand(-1, 1) * T.hitR, c.y + rand(-0.6, 0.8) * (T.prop ? T.prop.size.h * 0.6 : 1), c.z + rand(-1, 1) * T.hitR), vel: _b.set(rand(-1, 1), rand(0.5, 3), rand(-1, 1)), size: rand(0.25, 0.6), life: rand(0.4, 0.8), drag: 1.6, color: GREEN }); }
  /** visible tech on the machine for each enhancement level (it stays after detaching: the machine keeps what it was given) */
  addGlowParts(T, L) {
    const mk = (w, h, d, x, y, z, parent) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: 0x0a1a10, emissive: 0x22ff77, emissiveIntensity: 1.6 })); m.position.set(x, y, z); m.userData.noOverlay = true; parent.add(m); T.fx.push(m); return m; };
    const root = T.root, S = T.prop ? T.prop.size : { w: 2, h: 2, d: 2 }, base = T.prop ? -S.h / 2 : 0;
    if (T.kind === 'vehicle') { if (L === 1) { mk(S.w * 0.84, 0.05, S.d * 0.8, 0, 0.3, 0, root); mk(0.07, 0.12, S.d * 0.5, S.w * 0.51, 0.7, 0, root); mk(0.07, 0.12, S.d * 0.5, -S.w * 0.51, 0.7, 0, root); } if (L === 2) { mk(S.w * 0.9, 0.08, 0.5, 0, S.h * 0.95, -S.d * 0.42, root); mk(0.1, 0.34, 0.1, S.w * 0.4, S.h * 0.8, -S.d * 0.42, root); mk(0.1, 0.34, 0.1, -S.w * 0.4, S.h * 0.8, -S.d * 0.42, root); } if (L === 3) { mk(0.5, 0.4, 0.5, 0.45, 0.6, -S.d * 0.52, root); mk(0.5, 0.4, 0.5, -0.45, 0.6, -S.d * 0.52, root); mk(S.w * 0.7, 0.06, 0.06, 0, 0.62, S.d * 0.52, root); } }
    else if (T.kind === 'robot') { const P = T.prop.parts; if (L === 1) { mk(0.5, 0.5, 0.1, 0, 1.0, 0.55, root.children[0] || root); T.prop.parts.head.children[1].material.emissive.setRGB(0.2, 1, 0.4); } if (L === 2) { mk(0.3, 0.3, 0.9, 0.55, 0.45, 0.45, P.head.parent); mk(0.3, 0.3, 0.9, -0.55, 0.45, 0.45, P.head.parent); T.shoulder = true; } if (L === 3) { mk(0.9, 0.12, 0.12, 0, 0.5, 0, P.head); mk(0.12, 0.8, 0.12, 0.45, -0.7, 0.2, P.armL); mk(0.12, 0.8, 0.12, -0.45, -0.7, 0.2, P.armR); } }
    else if (T.kind === 'turret') { const hd = T.turret.head; if (L === 1) mk(0.1, 0.1, 0.9, 0.36, 0.1, 0.6, hd); if (L === 2) mk(0.1, 0.1, 0.9, -0.36, 0.1, 0.6, hd); if (L === 3) mk(1.1, 0.06, 1.0, 0, 0.42, 0, hd); }
    else if (T.kind === 'computer') { mk(0.12, 1.0, 0.12, 0.55 - 0.3 * (L - 1), 1.6 + 0.2 * L, -0.2, root); mk(1.0, 0.04, 0.04, 0, 0.9 + 0.1 * L, 0.5, root); }
    else if (T.kind === 'device') { const d = T.door; mk(d.w > d.d ? d.w * 0.9 : 0.05, 0.08, d.w > d.d ? 0.05 : d.d * 0.9, 0, 0.9, 0, root); }
    void base;
  }
  /** T: end the merge. Safe spot first, then circuitry retracts, Upgrade flows out of the machine and reforms there. */
  detach(up, instant = false) {
    const T = up.merged; if (!T || up.techAnim) return false; const spot = this.safeSpot(T, up);
    if (instant) { this.finishDetach(up, T, spot); return true; }
    T.controlled = false; up.techAnim = { kind: 'detach', T, t: 0, dur: 1.1, from: this.centerOf(T, new THREE.Vector3()), to: spot, spawned: false };
    this.g.sfx.merge(false); this.g.camera.addTrauma(0.12); this.stats.detaches++; return true;
  }
  finishDetach(up, T, spot) {
    T.isMerged = false; T.controlled = false; T.front = 0; T.tint = 0; for (const m of T.overlay) m.visible = false; this.tintBase(T, 0); T.uniforms.uFade.value = 1;
    if (T.prop) { const P = this.g.props, p = T.prop; p.driven = false; p.state = 'rest'; p.vel.set(0, 0, 0); p.tumble.set(0, 0, 0); P.addBox(p); P.syncRoot(p); P.syncBox(p); if (T.parkSnap) T.parkSnap = false; }
    if (T.turret) T.turret.override = this.grid.turrets; if (T.door) { T.door.holdOpen = T.door.keepOpen || T.upgradeLevel >= 1; T.door.target = 1; T.door.autoClose = 7; }
    up.merged = null; up.techAnim = null; up.pos.copy(spot); up.vel.set(0, 0, 0); up.grounded = true; up.mode = 'ground'; up.root.visible = true; up.root.scale.set(1, 1, 1); up.liquid.k = 0; up.root.position.copy(up.pos); up.root.updateMatrixWorld(true); up.energy = Math.max(up.energy, 20);
  }
  /** a standing spot outside the machine that is inside the arena, not inside any collider, on real ground, not over a dummy */
  safeSpot(T, up) {
    const w = this.g.world, c = this.centerOf(T, new THREE.Vector3()), R = (T.prop ? Math.hypot(T.prop.half.x, T.prop.half.z) : T.door ? Math.max(T.door.w, T.door.d) * 0.5 : 1.2) + 0.9;
    const free = (x, z, y) => {
      if (!w.island && (Math.abs(x) > ARENA - 0.6 || Math.abs(z) > ARENA - 0.6)) return false;
      for (const b of w.boxes) { if (b.max.y <= y + 0.45 || b.min.y >= y + 1.9) continue; if (x > b.min.x - 0.55 && x < b.max.x + 0.55 && z > b.min.z - 0.55 && z < b.max.z + 0.55) return false; }
      for (const q of w.cylinders) { if (q.dead) continue; if (Math.hypot(x - q.pos.x, z - q.pos.z) < q.r + 0.55) return false; }
      for (const q of this.list) if (q !== T && q.prop && !q.prop.dead && q.prop.driven) { const h = q.prop.half; if (Math.abs(x - q.prop.pos.x) < h.x + 0.6 && Math.abs(z - q.prop.pos.z) < h.z + 0.6) return false; }
      return true;
    };
    const face = Math.atan2(up.camYaw !== undefined ? Math.sin(up.camYaw) : 0, up.camYaw !== undefined ? Math.cos(up.camYaw) : 1);   // prefer the side the camera looks from
    const gy = (x, z) => w.groundAt(x, z, 0.6, 0.5, 0.3);
    for (let ring = 0; ring < 9; ring++) for (let i = 0; i < 16; i++) {
      const a = face + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI * 2 / 16), r = R + ring * 0.9, x = c.x + Math.sin(a) * r, z = c.z + Math.cos(a) * r, y = gy(x, z);
      if (free(x, z, y)) return new THREE.Vector3(x, y, z);
    }
    return new THREE.Vector3(c.x, gy(c.x, c.z + R), c.z + R);
  }
  /** leaving the alien (C) or a reset while merged / mid-animation: end it instantly and safely */
  forceRelease(up) {
    const A = up.techAnim; if (A) { this.finishDetach(up, A.T, this.safeSpot(A.T, up)); return; }
    if (up.merged) this.detach(up, true);
  }
  hurtMachine(T, dmg) {
    if (T.prop) { const p = T.prop; p.hp -= dmg; if (p.hp <= 0) this.destroyMerged(T); }
    else if (T.turret) { T.turret.applyHit(T.turret.root.position, UP, dmg); if (T.turret.dead) this.destroyMerged(T); }
    this.g.hud.hurt();
  }
  destroyMerged(T) {
    const up = this.g.up; if (up.merged === T) { this.detach(up, true); up.hp = Math.max(40, up.hp - 30); }
    if (T.prop) { if (T.kind === 'vehicle') this.g.fire.carBlast(T.prop); else this.g.props.destroy(T.prop, null); }
  }

  // ---------------------------------------------------------------------------------------------- per-frame
  update(dt) {
    this.t += dt; this.scanT = Math.max(0, this.scanT - dt); const up = this.g.up, active = this.g.chars && this.g.chars.id === 'upgrade';
    for (const d of this.doors) d.update(dt);
    for (const T of this.list) {
      T.uniforms.uTime.value = this.t; T.uniforms.uFront.value = T.front;
      if (T.kind === 'computer') this.updateScreen(T, dt);
      for (const f of T.fx) if (f.material) f.material.emissiveIntensity = 1.3 + 0.5 * Math.sin(this.t * 4 + f.id);
      if (T.isMerged && T.prop && Math.random() < 6 * dt && !T.prop.dead) { const c = T.prop.center; this.g.fx.glow.emit({ pos: _a.set(c.x + rand(-1, 1) * T.prop.half.x, c.y + rand(-0.4, 0.8) * T.prop.size.h, c.z + rand(-1, 1) * T.prop.half.z), vel: _b.set(rand(-0.5, 0.5), rand(0.5, 1.5), rand(-0.5, 0.5)), size: 0.22, life: 0.5, drag: 1.5, color: GREEN, alpha: 0.9 }); }
    }
    this.updateFriendlyTurrets(dt);
    // merge / detach animation
    const A = up.techAnim; if (A) this.updateAnim(up, A, dt);
    // marker ring for the machine Upgrade would merge with
    this.marker.visible = false;
    if (active && !up.merged && !A) { const c = this.candidate(up); if (c) { const cc = this.centerOf(c, _a); this.marker.visible = true; this.marker.position.set(cc.x, (c.prop ? c.prop.pos.y : 0) + 0.1, cc.z); this.marker.scale.setScalar(Math.max(1.2, c.hitR * 1.3) * (1 + 0.05 * Math.sin(this.t * 7))); } }
  }
  updateAnim(up, A, dt) {
    A.t += dt; const u = clamp(A.t / A.dur, 0, 1), g = this.g, T = A.T, e = smooth(u);
    if (A.kind === 'merge') {
      _a.copy(A.from).lerp(A.to, e); _a.y += Math.sin(Math.PI * e) * 0.9 + 0.2 * (1 - e); up.pos.copy(_a); const dir = _b.copy(A.to).sub(A.from); dir.y = 0; if (dir.lengthSq() > 1e-4) up.yaw = Math.atan2(dir.x, dir.z); up.root.rotation.y = up.yaw;
      const stretch = 1 + 1.3 * Math.sin(Math.PI * Math.min(1, u * 1.1)), shrink = 1 - 0.88 * smooth((u - 0.4) / 0.6);
      up.root.scale.set(shrink / Math.sqrt(stretch), shrink * 0.8, shrink * stretch); up.root.position.copy(up.pos); up.root.updateMatrixWorld(true);
      T.front = smooth((u - 0.35) / 0.65) * T.frontMax; this.tintBase(T, smooth((u - 0.5) / 0.5));
      for (let i = 0; i < 3; i++) g.fx.glow.emit({ pos: _c.set(up.pos.x + rand(-0.3, 0.3), up.pos.y + rand(0.2, 1.4) * shrink, up.pos.z + rand(-0.3, 0.3)), vel: _d.set(rand(-1, 1), rand(-0.5, 1.5), rand(-1, 1)), size: rand(0.2, 0.5), life: 0.4, drag: 2, color: GREEN });
      if (u >= 1) { this.finishMerge(up, T); if (A.control && T.canControl) this.startControl(up); }
    } else {
      const k = smooth(u / 0.65);
      T.front = (1 - k) * T.frontMax; this.tintBase(T, 1 - k); T.uniforms.uFade.value = 1 - 0.0 * k;
      if (u > 0.25 && !A.spawned) { A.spawned = true; up.root.visible = true; up.liquid.k = 0; up.mode = 'ground'; g.fx.surface.ring(new THREE.Vector3(A.from.x, A.from.y + 0.1, A.from.z), UP, 4, 0.5, 0x4cff7a); }
      if (A.spawned) {
        const s = smooth((u - 0.25) / 0.75); _a.copy(A.from).lerp(A.to, s); _a.y = lerp(A.from.y, A.to.y, s) + Math.sin(Math.PI * s) * 0.8; up.pos.copy(_a); const dir = _b.copy(A.to).sub(A.from); dir.y = 0; if (dir.lengthSq() > 1e-4) { up.yaw = Math.atan2(dir.x, dir.z); up.root.rotation.y = up.yaw; }
        const grow = 0.12 + 0.88 * s, wob = 1 + 0.25 * Math.sin(s * 14) * (1 - s), st = 1 + 0.5 * Math.sin(Math.PI * s);
        up.root.scale.set(grow / Math.sqrt(st) * wob, grow * (0.55 + 0.45 * s) / wob, grow * st); up.root.position.copy(up.pos); up.root.updateMatrixWorld(true);
        for (let i = 0; i < 2; i++) g.fx.glow.emit({ pos: _c.set(up.pos.x + rand(-0.3, 0.3), up.pos.y + rand(0.1, 1.2), up.pos.z + rand(-0.3, 0.3)), vel: _d.set(rand(-1, 1), rand(0, 1.5), rand(-1, 1)), size: rand(0.2, 0.4), life: 0.4, drag: 2, color: GREEN });
      } else { up.pos.copy(A.from); }
      if (u >= 1) { this.finishDetach(up, T, A.to); g.hud.toast('DETACHED'); }
    }
  }

  // ---------------------------------------------------------------------------------------------- control: called by Upgrade's updatePhysics while merged
  updateControl(up, dt, inp, camYaw) {
    const T = up.merged; if (!T) return; up.camYaw = camYaw;
    if (T.kind === 'vehicle') this.driveVehicle(T, up, dt, T.controlled ? inp : NO_INPUT, camYaw);
    else if (T.kind === 'robot') this.walkRobot(T, up, dt, T.controlled ? inp : NO_INPUT, camYaw);
    else if (T.kind === 'turret') this.aimTurret(T, up, dt, camYaw);
    else if (T.kind === 'computer') this.useComputer(T, up, dt, T.controlled ? inp : NO_INPUT);
    up.pos.copy(this.centerOf(T, _a)); up.pos.y = T.prop ? T.prop.pos.y : 0;
  }
  /** LMB while merged: the machine's own main action */
  primary(up) {
    const T = up.merged; if (!T) return; const g = this.g;
    if (!T.controlled) { if (T.canControl) this.startControl(up); return; }
    if (T.kind === 'robot') this.robotFire(T, up);
    else if (T.kind === 'turret') this.turretFire(T, up);
    else if (T.kind === 'computer') this.runFunction(T);
    else if (T.kind === 'device') { const d = T.door; d.holdOpen = !d.holdOpen; d.target = d.holdOpen ? 1 : 0; g.hud.toast('DOOR ' + (d.holdOpen ? 'OPEN' : 'CLOSED')); g.sfx.servo(0.3); }
    else if (T.kind === 'vehicle') { T.v.boost = Math.min(1, T.v.boost + 0.0); g.sfx.beep(true); this.hornFX(T); }
  }
  hornFX(T) { const c = T.prop.center; this.g.fx.surface.ring(_a.set(c.x, T.prop.pos.y + 0.1, c.z), UP, 7, 0.5, 0x4cff7a); for (const h of this.g.world.hittables) if (h instanceof Dummy && !h.dead && Math.hypot(h.root.position.x - c.x, h.root.position.z - c.z) < 7) h.confuse = 1.5; }

  // ------------------------------------------------------------------ vehicles
  unstick(p) {
    const P = this.g.props; for (let it = 0; it < 4; it++) {
      const hs = P.hits(p, p.pos); if (!hs.length) break; const h = p.half;
      for (const b of hs) { const ox = Math.min(p.pos.x + h.x - b.min.x, b.max.x - (p.pos.x - h.x)), oz = Math.min(p.pos.z + h.z - b.min.z, b.max.z - (p.pos.z - h.z)); if (ox < oz) p.pos.x += p.pos.x < (b.min.x + b.max.x) / 2 ? -ox : ox; else p.pos.z += p.pos.z < (b.min.z + b.max.z) / 2 ? -oz : oz; }
    }
  }
  driveVehicle(T, up, dt, inp, camYaw) {
    const g = this.g, p = T.prop, P = g.props, V = T.v, S = T.spec, L = T.upgradeLevel; if (p.dead) return;
    const boost = inp.run && V.boost > 0.06 && V.speed > -0.5; const vmax = S.vmax * (1 + 0.22 * L) * (boost ? 1.4 : 1);
    let acc = 0; if (inp.moveY > 0) acc = S.accel * (1 + 0.3 * L) * (boost ? 1.7 : 1) * inp.moveY; else if (inp.moveY < 0) acc = V.speed > 0.6 ? -S.brake * (1 + 0.1 * L) : -S.accel * 0.55;
    V.speed += acc * dt; V.speed -= V.speed * (inp.moveY === 0 ? 0.7 : 0.18) * dt; if (inp.jumpHeld) { const d = Math.min(Math.abs(V.speed), 30 * dt); V.speed -= Math.sign(V.speed) * d; }
    V.speed = clamp(V.speed, -S.rev * (1 + 0.1 * L), vmax); V.boost = clamp(V.boost + (boost ? -0.38 : 0.14) * dt, 0, 1);
    V.steer = damp(V.steer, -inp.moveX, 7, dt); const grip = clamp(Math.abs(V.speed) / 4, 0, 1) * (1 - 0.35 * clamp((Math.abs(V.speed) - 14) / 14, 0, 1)); p.yaw += V.steer * S.steer * (1 + 0.14 * L) * grip * (V.speed >= 0 ? 1 : -1) * dt;
    this.unstick(p);
    const n = clamp(Math.ceil(Math.abs(V.speed) * dt / 0.45), 1, 8), step = V.speed * dt / n, fx = Math.sin(p.yaw), fz = Math.cos(p.yaw); let bumped = false; const oldx = p.pos.x, oldz = p.pos.z;
    for (let i = 0; i < n; i++) {
      p.pos.x += fx * step; let hs = P.hits(p, p.pos); if (hs.length) { p.pos.x -= fx * step; if (!bumped) { this.vehicleBump(T, up, V.speed, 'x', hs[0]); bumped = true; } }
      p.pos.z += fz * step; hs = P.hits(p, p.pos); if (hs.length) { p.pos.z -= fz * step; if (!bumped) { this.vehicleBump(T, up, V.speed, 'z', hs[0]); bumped = true; } }
    }
    if (g.world.island) g.world.clampXZ(p.pos, 3); else { p.pos.x = clamp(p.pos.x, -ARENA + p.half.x, ARENA - p.half.x); p.pos.z = clamp(p.pos.z, -ARENA + p.half.z, ARENA - p.half.z); }
    this.stats.vehicleKm += Math.hypot(p.pos.x - oldx, p.pos.z - oldz) / 1000;
    const gy = P.support(p); p.pos.y = damp(p.pos.y, gy, 18, dt);
    // hit dummies / loose props with the body
    const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
    for (const h of g.world.hittables) {
      if (!(h instanceof Dummy) || h.dead) continue; const dx = h.root.position.x - p.pos.x, dz = h.root.position.z - p.pos.z, lz = dx * s + dz * c, lx = dx * c - dz * s;
      if (Math.abs(lz) < S.len / 2 + 0.45 && Math.abs(lx) < S.wid / 2 + 0.45 && Math.abs(V.speed) > 2.5 && (V.hitCd.get(h) || 0) <= this.t) {
        V.hitCd.set(h, this.t + 0.7); const dir = _a.set(dx, 0, dz).normalize(), dmg = clamp(Math.abs(V.speed) * 4.2, 10, 70) * (1 + 0.3 * L);
        h.applyHit(_b.set(h.root.position.x, 1.3, h.root.position.z), dir.clone(), dmg); h.shove(dir, 8 + Math.abs(V.speed) * 0.8); h.launch(3 + Math.abs(V.speed) * 0.2); g.hud.hit(_b.clone(), Math.round(dmg), h); g.camera.addTrauma(0.3); g.sfx.hit(true); this.stats.hits++; V.speed *= 0.93;
        for (let i = 0; i < 6; i++) g.fx.glow.emit({ pos: _b, vel: _c.set(rand(-1, 1), rand(0.2, 1), rand(-1, 1)).multiplyScalar(5), size: 0.3, life: 0.35, drag: 2, color: GREEN });
      }
    }
    // visuals: pitch with acceleration, roll in turns, wheels shake, speed lines / boost flame
    p.tumble.x = damp(p.tumble.x, -clamp(acc, -20, 20) * 0.0035, 6, dt); p.tumble.z = damp(p.tumble.z, V.steer * clamp(V.speed / 20, -1, 1) * 0.06, 6, dt); P.syncRoot(p);
    if (boost || (L >= 3 && V.speed > 10)) for (let i = 0; i < 2; i++) { const bx = p.pos.x - fx * S.len * 0.52 + rand(-0.4, 0.4), bz = p.pos.z - fz * S.len * 0.52 + rand(-0.4, 0.4); g.fx.glow.emit({ pos: _a.set(bx, p.pos.y + 0.6, bz), vel: _b.set(-fx * 5, rand(0, 1), -fz * 5), size: rand(0.4, 0.8), life: 0.3, drag: 1, color: GREEN }); }
    V.snd -= dt; if (V.snd <= 0) { V.snd = 0.11; g.sfx.engine(0.05 + 0.04 * Math.abs(V.speed) / 20, 48 + Math.abs(V.speed) * 5); }
    // chase camera: gently swing behind the car while it drives
    if (Math.abs(V.speed) > 3 && inp.moveY !== 0) { const want = p.yaw + (V.speed > 0 ? 0 : Math.PI); g.camera.yaw += angleDelta(g.camera.yaw, want) * Math.min(1, dt * 0.9) * clamp(Math.abs(V.speed) / 12, 0, 1); }
    up.yaw = p.yaw;
  }
  vehicleBump(T, up, spd, axis, hitBox) {
    const g = this.g, p = T.prop, P = g.props, V = T.v, imp = Math.abs(spd), dirx = axis === 'x' ? Math.sign(Math.sin(p.yaw) * spd) : 0, dirz = axis === 'z' ? Math.sign(Math.cos(p.yaw) * spd) : 0;
    const lit = hitBox && hitBox.prop && hitBox.prop !== p ? hitBox.prop : null;
    if (lit && !lit.planted && !lit.held && !lit.driven && lit.mass < p.mass * 0.35) {              // light loose prop (bench, barrel, bin): the vehicle shoves it aside instead of stopping dead
      P.removeBox(lit); lit.state = 'fly'; const k = Math.max(imp, 3.5); lit.vel.x += dirx * k * 0.9; lit.vel.z += dirz * k * 0.9; lit.vel.y = Math.max(lit.vel.y, 1.5 + k * 0.1); lit.spin.set(rand(-2, 2), rand(-2, 2), rand(-2, 2)); lit.hit.clear();
      P.hurt(lit, imp * 1.2); V.speed *= 0.82; return;
    }
    V.speed *= -0.22; if (imp < 4) return;
    const c = p.center, dmg = (imp - 3) * 5.5;
    _c.set(c.x + dirx * p.half.x, c.y, c.z + dirz * p.half.z); const b = (hitBox && (hitBox.prop || hitBox.wall) ? hitBox : null) || this.boxNear(_c);
    P.impactFX(_c.clone(), clamp(imp / 14, 0.4, 1.6), p.debris, imp > 12); this.stats.hits++;
    if (b && b.wall) P.damageWall(b.wall, dmg * (1 + 0.3 * T.upgradeLevel) * 1.4, _c.clone(), _d.set(dirx, 0, dirz).clone());
    if (b && b.prop && b.prop !== p) { const o = b.prop; P.hurt(o, dmg * 0.9); if (!o.planted) { P.removeBox(o); o.state = 'fly'; o.vel.x += dirx * imp * 0.7; o.vel.z += dirz * imp * 0.7; o.vel.y = Math.min(6, imp * 0.25); o.spin.set(rand(-2, 2), rand(-2, 2), rand(-2, 2)); o.hit.clear(); } }
    this.hurtMachine(T, dmg * 0.25 / (1 + 0.5 * T.upgradeLevel)); g.camera.addTrauma(clamp(imp / 20, 0.15, 0.6)); g.sfx.crash(clamp(imp / 20, 0.2, 0.7));
  }
  boxNear(pt) { for (const b of this.g.world.boxes) if (pt.x > b.min.x - 0.35 && pt.x < b.max.x + 0.35 && pt.z > b.min.z - 0.35 && pt.z < b.max.z + 0.35 && pt.y > b.min.y - 0.3 && pt.y < b.max.y + 0.3) return b; return null; }

  // ------------------------------------------------------------------ robots
  walkRobot(T, up, dt, inp, camYaw) {
    const g = this.g, p = T.prop, R = T.r, P = g.props, L = T.upgradeLevel, w = g.world; if (p.dead) return;
    const fwd = _a.set(-Math.sin(camYaw), 0, -Math.cos(camYaw)), right = _b.set(Math.cos(camYaw), 0, -Math.sin(camYaw)), want = _c.set(0, 0, 0).addScaledVector(fwd, inp.moveY).addScaledVector(right, inp.moveX); const has = want.lengthSq() > 1e-4; if (has) want.normalize();
    const top = (inp.run ? 6.6 : 3.9) * (1 + 0.12 * L); R.vx = R.vx || 0; R.vz = R.vz || 0; const ax = has ? want.x * top : 0, az = has ? want.z * top : 0, rate = 26 * dt;
    R.vx += clamp(ax - R.vx, -rate, rate); R.vz += clamp(az - R.vz, -rate, rate);
    const firing = R.fire > 0 || R.aiming > 0; const target = firing ? Math.atan2(-Math.sin(camYaw), -Math.cos(camYaw)) : has ? Math.atan2(R.vx, R.vz) : p.yaw;
    p.yaw += angleDelta(p.yaw, target) * (1 - Math.exp(-(firing ? 14 : 7) * dt));
    if (R.grounded === undefined) R.grounded = true; if (inp.jump && R.grounded) { R.vy = 8.8; R.grounded = false; g.sfx.servo(0.3); }
    R.vy = (R.vy || 0) - 26 * dt; const oy = p.pos.y; p.pos.y += R.vy * dt; const sup = P.support(p); if (p.pos.y <= sup) { if (!R.grounded && R.vy < -6) { g.camera.addTrauma(0.2); g.sfx.thud(0.4); P.shockwave(_d.set(p.pos.x, p.pos.y, p.pos.z), 3, 6, 0, 8); } p.pos.y = sup; R.vy = 0; R.grounded = true; } else R.grounded = false; void oy;
    p.pos.x += R.vx * dt; p.pos.z += R.vz * dt; const tmp = _d.set(p.pos.x, p.pos.y, p.pos.z); w.resolveXZ(tmp, 0.85, p.pos.y, 2.9, 0.4); p.pos.x = tmp.x; p.pos.z = tmp.z;
    const sp = Math.hypot(R.vx, R.vz); R.mv = damp(R.mv, clamp(sp / 4, 0, 1.4), 10, dt); R.phase += dt * sp * 1.7;
    // bump into dummies = shoulder charge
    for (const h of w.hittables) { if (!(h instanceof Dummy) || h.dead) continue; const dx = h.root.position.x - p.pos.x, dz = h.root.position.z - p.pos.z; if (Math.hypot(dx, dz) < 1.6 && sp > 3.5 && (R.hitCd.get(h) || 0) <= this.t) { R.hitCd.set(h, this.t + 0.8); const dir = _a.set(dx, 0, dz).normalize(); h.applyHit(_b.set(h.root.position.x, 1.3, h.root.position.z), dir.clone(), 14 * (1 + 0.3 * L)); h.shove(dir, 10); h.launch(3); g.hud.hit(_b.clone(), 14, h); g.sfx.hit(false); } }
    // walk cycle + aiming arms
    const pt = p.parts, s = Math.sin(R.phase), aim = clamp(R.fire > 0 || R.aiming > 0 ? 1 : 0, 0, 1); R.aim = damp(R.aim, aim, 12, dt);
    pt.legL.rotation.x = s * 0.7 * R.mv; pt.legR.rotation.x = -s * 0.7 * R.mv; const pitch = clamp(Math.asin(clamp(g.camera.aimDir.y, -0.8, 0.8)), -0.6, 0.6);
    pt.armL.rotation.x = lerp(-s * 0.6 * R.mv, -Math.PI / 2 - pitch + 0.05, R.aim) + 0.12 * R.fire; pt.armR.rotation.x = lerp(s * 0.6 * R.mv, -Math.PI / 2 - pitch + 0.05, R.aim) + 0.12 * R.fire;
    pt.head.rotation.y = 0.15 * Math.sin(this.t * 1.3); p.inner.position.y = p.in0.y + Math.abs(s) * 0.07 * R.mv; R.fire = Math.max(0, R.fire - dt * 4); R.aiming = Math.max(0, (R.aiming || 0) - dt);
    p.tumble.set(0, 0, 0); P.syncRoot(p); up.yaw = p.yaw;
  }
  robotFire(T, up) {
    const g = this.g, p = T.prop, R = T.r, L = T.upgradeLevel; if (R.cd > this.t) return; R.cd = this.t + 0.42 / (1 + 0.28 * L); R.fire = 1; R.aiming = 1.2; this.stats.shots++;
    const pt = p.parts, sides = L >= 2 ? ['L', 'R', 'S'] : [R.side > 0 ? 'L' : 'R']; R.side *= -1;
    for (const sd of sides) {
      let o; if (sd === 'S') { o = _c.set(p.pos.x, p.pos.y + 2.5, p.pos.z); o.x += Math.cos(p.yaw) * 0.5; o.z -= Math.sin(p.yaw) * 0.5; } else { pt['muzzle' + sd].getWorldPosition(_c); o = _c; }
      const origin = o.clone(), dir = _d.copy(this.aimPoint(up)).sub(origin).normalize();
      this.playerBolt(origin, dir, 16 * (1 + 0.4 * L), L > 0);
    }
    g.camera.addTrauma(0.08); g.sfx.zap(0.3);
  }
  aimPoint(up) { return up.aimPt; }
  /** player-owned projectile (shared by robots and turrets): uses the Enemies bolt pipeline, tinted green when the machine has been enhanced */
  playerBolt(origin, dir, dmg, green) {
    const E = this.g.enemies; E.spawnBolt(origin.clone(), dir.clone(), null, 'player'); const b = E.bolts[E.bolts.length - 1]; b.dmg = dmg; b.speed = 44; b.life = 2.2; b.green = true;
    this.g.fx.glow.emit({ pos: origin, size: 1.3, life: 0.1, drag: 0, color: green ? GREEN : [1, 0.85, 0.5] });
  }

  // ------------------------------------------------------------------ turrets
  aimTurret(T, up, dt, camYaw) {
    const t = T.turret, tr = T.tr; if (t.dead) return; const want = Math.atan2(-Math.sin(camYaw), -Math.cos(camYaw)); tr.yaw += angleDelta(tr.yaw, want) * (1 - Math.exp(-10 * dt)); t.yaw = tr.yaw; t.head.rotation.y = tr.yaw;
    t.head.rotation.x = damp(t.head.rotation.x, -clamp(Math.asin(clamp(this.g.camera.aimDir.y, -0.7, 0.7)), -0.4, 0.5) * 0.6, 8, dt); t.root.updateMatrixWorld(true); tr.cool = Math.max(0, tr.cool - dt); t.hitFlash = Math.max(0, t.hitFlash - dt);
    if (this.g.up.fireHeld && T.controlled) this.turretFire(T, up);
  }
  turretFire(T, up) {
    const tr = T.tr, t = T.turret, L = T.upgradeLevel; if (tr.cool > 0 || t.dead) return; tr.cool = 0.55 / (1 + 0.3 * L) / (this.grid.overdrive ? 1.6 : 1); t.muzzle.getWorldPosition(_c); const origin = _c.clone(), dir = _d.copy(up.aimPt).sub(origin).normalize();
    this.playerBolt(origin, dir, 24 * (1 + 0.4 * L), true); this.stats.shots++; this.g.camera.addTrauma(0.05); this.g.sfx.zap(0.35);
  }
  /** turrets linked from a console fight for the player: they shoot the nearest training dummy */
  updateFriendlyTurrets(dt) {
    const g = this.g; for (const T of this.list) {
      if (T.kind !== 'turret') continue; const t = T.turret; t.override = T.isMerged || this.grid.turrets; if (!this.grid.turrets || T.isMerged || t.dead) continue;
      const tr = T.tr; tr.cool -= dt; let best = null, bd = 40; for (const h of g.world.hittables) { if (!(h instanceof Dummy) || h.dead) continue; const d = Math.hypot(h.root.position.x - t.root.position.x, h.root.position.z - t.root.position.z); if (d < bd) { bd = d; best = h; } }
      if (best) { const want = Math.atan2(best.root.position.x - t.root.position.x, best.root.position.z - t.root.position.z); tr.yaw += angleDelta(tr.yaw, want) * Math.min(1, dt * 4); t.yaw = tr.yaw; t.head.rotation.y = tr.yaw; t.root.updateMatrixWorld(true);
        if (tr.cool <= 0 && Math.abs(angleDelta(tr.yaw, want)) < 0.12) { tr.cool = 1.5 / (1 + 0.3 * T.upgradeLevel) / (this.grid.overdrive ? 2 : 1); t.muzzle.getWorldPosition(_c); const origin = _c.clone(), dir = _d.set(best.root.position.x, 1.5, best.root.position.z).sub(origin).normalize(); this.playerBolt(origin, dir, 20 * (1 + 0.4 * T.upgradeLevel), true); } }
    }
  }

  // ------------------------------------------------------------------ computers
  useComputer(T, up, dt, inp) {
    const c = T.prop; if (c.dead) return; T.edge = T.edge || { l: false, r: false };
    if (inp.moveX < -0.5 && !T.edge.l) { T.sel = (T.sel + T.fns.length - 1) % T.fns.length; T.dirty = true; this.g.sfx.beep(true); } if (inp.moveX > 0.5 && !T.edge.r) { T.sel = (T.sel + 1) % T.fns.length; T.dirty = true; this.g.sfx.beep(true); }
    T.edge.l = inp.moveX < -0.5; T.edge.r = inp.moveX > 0.5; if (inp.jump) this.runFunction(T);
  }
  runFunction(T) {
    const f = T.fns[T.sel], g = this.g; if (f.lvl > T.upgradeLevel) { g.hud.toast(f.name + ' LOCKED — ENHANCE [E] TO LV' + f.lvl); g.sfx.beep(false); return; }
    f.run(); T.dirty = true; this.stats.uses++; g.sfx.beep(true); g.hud.toast(f.name + ': ' + (f.on() ? 'ON' : 'OFF')); this.pulse(T, 10);
  }
  drawScreen(T) {
    const s = T.prop.screen; if (!s) return; const c = s.canvas, g = c.getContext('2d'), L = T.upgradeLevel, merged = T.isMerged;
    g.fillStyle = merged ? '#06140c' : '#07121c'; g.fillRect(0, 0, 256, 176); g.fillStyle = merged ? '#2dff7a' : '#3aa0ff'; g.font = 'bold 15px monospace'; g.fillText(T.label, 8, 20); g.font = '11px monospace'; g.fillText('LV ' + L + '/' + T.maxLevel + (merged ? '  · UPGRADE LINKED' : '  · STANDBY'), 8, 36);
    T.fns.forEach((f, i) => { const y = 62 + i * 30, sel = i === T.sel && merged, locked = f.lvl > L; g.fillStyle = sel ? 'rgba(45,255,122,.22)' : 'rgba(255,255,255,.05)'; g.fillRect(6, y - 16, 244, 24); g.fillStyle = locked ? '#7a8a80' : sel ? '#aaffcc' : '#9fd0ff'; g.font = '13px monospace'; g.fillText((sel ? '> ' : '  ') + f.name, 12, y); g.fillStyle = locked ? '#ff7a6a' : f.on() ? '#2dff7a' : '#cc7777'; g.fillText(locked ? 'LOCKED' : f.on() ? 'ON' : 'OFF', 198, y); });
    s.tex.needsUpdate = true; T.dirty = false;
  }
  updateScreen(T, dt) { T.screenT -= dt; if (T.dirty || T.screenT <= 0) { T.screenT = 0.6; this.drawScreen(T); } }

  // ---------------------------------------------------------------------------------------------- reset
  reset() {
    const up = this.g.up; if (up) this.forceRelease(up);
    for (const T of this.list) { T.upgradeLevel = 0; T.uniforms.uLevel.value = 0; T.controlled = false; for (const f of T.fx) f.parent && f.parent.remove(f); T.fx.length = 0; if (T.prop) { T.prop.hpMax = T.prop.hpMax0 || T.prop.hpMax; T.prop.hp = T.prop.hpMax; T.prop.driven = false; } if (T.turret) { T.turret.maxHp = 150; T.turret.override = false; } if (T.v) { T.v.speed = 0; T.v.boost = 1; } if (T.sel !== undefined) { T.sel = 0; T.dirty = true; } }
    this.setGroup('turrets', false); this.setGroup('overdrive', false); this.setGroup('floods', false); this.setGroup('bay', false); this.grid.turrets = false; this.grid.overdrive = false;
    for (const d of this.doors) { d.holdOpen = false; d.target = 0; d.open = 0; d.speed = 1; }
  }
};
const NO_INPUT = { moveX: 0, moveY: 0, run: false, jump: false, jumpHeld: false };
