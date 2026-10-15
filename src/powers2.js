// Powers 2-6: Crystal Weapons (Q), Crystal Shield (F), Crystal Spikes (G), Crystal Constructs (E), Crystal Cannon (X).
// Each power drives an "action layer" for the Animator (per-bone poses from keyframes) plus its own meshes, FX,
// damage and colliders. Only one action runs at a time; Crystal Projectiles (LMB) lives in powers.js.
import { meleeAim } from './aimassist.js';
import * as THREE from 'three';
import { makeCrystalGeometry, crystalMaterial } from './effects.js';
import { clamp, lerp, easeOutCubic, easeOutBack, easeInOutCubic, rand, damp, smoothstep } from './util.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion();
const Z = new THREE.Vector3(0, 0, 1), UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0);
const TAU = Math.PI * 2;

// ------------------------------------------------------------------------------------------ keyframes
/** keys: [{t, p:{bone:[x,y,z]}}]; bones missing from one key hold the other key's value */
function sample(keys, t, out) {
  for (const k in out) delete out[k];
  let a = keys[0], b = keys[0], u = 0;
  if (t >= keys[keys.length - 1].t) a = b = keys[keys.length - 1];
  else if (t > keys[0].t) { for (let i = 0; i < keys.length - 1; i++) if (t >= keys[i].t && t <= keys[i + 1].t) { a = keys[i]; b = keys[i + 1]; u = easeInOutCubic((t - a.t) / Math.max(1e-6, b.t - a.t)); break; } }
  const names = new Set([...Object.keys(a.p), ...Object.keys(b.p)]);
  for (const n of names) {
    const va = a.p[n] || b.p[n], vb = b.p[n] || a.p[n];
    out[n] = [lerp(va[0], vb[0], u), lerp(va[1], vb[1], u), lerp(va[2], vb[2], u)];
  }
  return out;
}

// Conventions (see animator.js): rotation.x < 0 swings a limb forward; uarm.z*side > 0 lifts it out; chest.y > 0 turns left (+X).
const SLASH1 = [
  { t: 0, p: { chest: [0.05, 0, 0], uarmR: [-0.5, 0, -0.3], farmR: [-0.6, 0, 0] } },
  { t: 0.17, p: { hips: [0.05, -0.25, 0], spine: [0.1, -0.3, 0], chest: [0.15, -0.75, 0], head: [0, 0.5, 0], uarmR: [-1.2, -0.3, -1.15], farmR: [-0.5, 0, 0], handR: [0, 0, 0], uarmL: [-0.4, 0, 0.5], farmL: [-0.9, 0, 0], thighL: [-0.45, 0, 0.1], shinL: [0.5, 0, 0], thighR: [0.35, 0, -0.1], shinR: [0.3, 0, 0] } },
  { t: 0.3, p: { hips: [0.1, 0.3, 0], spine: [0.12, 0.35, 0], chest: [0.2, 0.85, 0], head: [0, -0.5, 0], uarmR: [-1.45, 0.5, 0.55], farmR: [-0.1, 0, 0], uarmL: [0.3, 0, 0.75], farmL: [-0.7, 0, 0], thighL: [-0.75, 0, 0.1], shinL: [0.85, 0, 0], thighR: [0.5, 0, -0.1], shinR: [0.4, 0, 0] } },
  { t: 0.62, p: { hips: [0.05, 0.1, 0], spine: [0.08, 0.1, 0], chest: [0.1, 0.3, 0], uarmR: [-0.8, 0.2, 0.1], farmR: [-0.7, 0, 0], thighL: [-0.4, 0, 0.1], shinL: [0.5, 0, 0], thighR: [0.3, 0, -0.1], shinR: [0.3, 0, 0] } },
];
const PUNCH = [
  { t: 0, p: { chest: [0.05, 0.2, 0], uarmL: [0.3, 0, 0.3], farmL: [-1.0, 0, 0] } },
  { t: 0.22, p: { hips: [0.05, 0.3, 0], spine: [0.08, 0.3, 0], chest: [0.1, 0.65, 0], head: [0, -0.35, 0], uarmL: [0.9, 0, 0.25], farmL: [-1.9, 0, 0], handL: [-0.2, 0, 0], uarmR: [-1.1, 0, -0.35], farmR: [-1.3, 0, 0], thighL: [0.35, 0, 0.1], shinL: [0.4, 0, 0], thighR: [-0.55, 0, -0.1], shinR: [0.6, 0, 0] } },
  { t: 0.31, p: { hips: [0.2, -0.25, 0], spine: [0.3, -0.25, 0], chest: [0.35, -0.6, 0], head: [-0.1, 0.3, 0], uarmL: [-1.5, 0, -0.08], farmL: [-0.02, 0, 0], handL: [0, 0, 0], uarmR: [-0.2, 0, -0.7], farmR: [-1.2, 0, 0], thighL: [-0.9, 0, 0.15], shinL: [0.9, 0, 0], thighR: [0.55, 0, -0.1], shinR: [0.5, 0, 0] } },
  { t: 0.42, p: { hips: [0.2, -0.25, 0], spine: [0.3, -0.25, 0], chest: [0.35, -0.6, 0], uarmL: [-1.5, 0, -0.08], farmL: [-0.02, 0, 0], thighL: [-0.9, 0, 0.15], shinL: [0.9, 0, 0] } },
  { t: 0.7, p: { hips: [0.05, 0, 0], spine: [0.05, 0, 0], chest: [0.1, 0, 0], uarmL: [-0.5, 0, 0.3], farmL: [-0.8, 0, 0], thighL: [-0.3, 0, 0.1], shinL: [0.4, 0, 0] } },
];
const SWEEP = [
  { t: 0, p: { chest: [0.2, -0.3, 0], uarmR: [-0.2, 0, -0.4], farmR: [-0.6, 0, 0] } },
  { t: 0.22, p: { hips: [0.25, -0.3, 0], spine: [0.5, -0.3, 0], chest: [0.35, -0.6, 0], head: [-0.2, 0.4, 0], uarmR: [0.5, 0, -0.6], farmR: [-0.3, 0, 0], uarmL: [-0.6, 0, 0.6], farmL: [-0.8, 0, 0], thighL: [-1.0, 0, 0.2], shinL: [1.3, 0, 0], thighR: [0.2, 0, -0.2], shinR: [0.9, 0, 0] } },
  { t: 0.36, p: { hips: [0, 0.35, 0], spine: [-0.15, 0.4, 0], chest: [-0.1, 0.9, 0], head: [0.1, -0.5, 0], uarmR: [-2.5, -0.2, -0.7], farmR: [-0.1, 0, 0], uarmL: [-0.3, 0, 1.0], farmL: [-0.5, 0, 0], thighL: [-0.6, 0, 0.2], shinL: [0.6, 0, 0], thighR: [0.4, 0, -0.2], shinR: [0.4, 0, 0] } },
  { t: 0.8, p: { hips: [0.05, 0.1, 0], spine: [0.05, 0.1, 0], chest: [0.1, 0.2, 0], uarmR: [-0.9, 0, -0.2], farmR: [-0.6, 0, 0], thighL: [-0.4, 0, 0.1], shinL: [0.5, 0, 0] } },
];
const SPIN = [
  { t: 0, p: { chest: [0.1, 0, 0], uarmL: [-0.5, 0, 0.4], uarmR: [-0.5, 0, -0.4], farmL: [-0.8, 0, 0], farmR: [-0.8, 0, 0] } },
  { t: 0.12, p: { hips: [0.2, 0, 0], spine: [0.25, 0, 0], chest: [0.15, 0, 0], uarmL: [-0.15, 0, 1.45], uarmR: [-0.15, 0, -1.45], farmL: [-0.15, 0, 0], farmR: [-0.15, 0, 0], thighL: [-0.5, 0, 0.35], thighR: [-0.5, 0, -0.35], shinL: [0.8, 0, 0], shinR: [0.8, 0, 0] } },
  { t: 0.64, p: { hips: [0.2, 0, 0], spine: [0.25, 0, 0], chest: [0.15, 0, 0], uarmL: [-0.15, 0, 1.45], uarmR: [-0.15, 0, -1.45], farmL: [-0.15, 0, 0], farmR: [-0.15, 0, 0], thighL: [-0.5, 0, 0.35], thighR: [-0.5, 0, -0.35], shinL: [0.8, 0, 0], shinR: [0.8, 0, 0] } },
  { t: 0.85, p: { hips: [0.05, 0, 0], spine: [0.05, 0, 0], chest: [0.1, 0, 0], uarmL: [-0.4, 0, 0.3], uarmR: [-0.4, 0, -0.3], farmL: [-0.7, 0, 0], farmR: [-0.7, 0, 0], thighL: [-0.3, 0, 0.1], thighR: [-0.3, 0, -0.1], shinL: [0.4, 0, 0], shinR: [0.4, 0, 0] } },
];
const MELEE = [
  { name: 'CRYSTAL BLADE', keys: SLASH1, dur: 0.62, hits: [0.22], side: 'R', tool: 'blade', range: 3.6, half: 1.25, dmg: 18, knock: 6, launch: 0, lunge: 6, shake: 0.3, arc: { tilt: 0.25, size: 3.4 } },
  { name: 'HEAVY PUNCH', keys: PUNCH, dur: 0.7, hits: [0.29], side: 'L', tool: 'gaunt', range: 3.3, half: 0.65, dmg: 34, knock: 13, launch: 0, lunge: 9, shake: 0.55, arc: null },
  { name: 'SWEEPING SLASH', keys: SWEEP, dur: 0.8, hits: [0.32], side: 'R', tool: 'blade', range: 4.0, half: 1.8, dmg: 26, knock: 9, launch: 6, lunge: 5, shake: 0.4, arc: { tilt: -1.0, size: 4.4 } },
  { name: 'SPIN ATTACK', keys: SPIN, dur: 0.85, hits: [0.2, 0.36, 0.52], side: 'B', tool: 'blade', range: 4.4, half: Math.PI, dmg: 15, knock: 9, launch: 3.5, lunge: 0, shake: 0.35, arc: { tilt: 0, size: 4.6, ring: true } },
];

const mat = (o) => crystalMaterial(o);
const edgeMat = () => new THREE.LineBasicMaterial({ color: 0xd8fff0, transparent: true, opacity: 0.6 });

export class PowerSet {
  constructor(game) {
    this.g = game; this.act = null; this.t = 0; this.layer = { w: 0, rot: {}, spinY: 0 }; this.timers = [];
    this.stats = { melee: 0, blocked: 0, spikes: 0, built: 0, cannon: 0, hits: 0 };
    this.cd = { q: 0, f: 0, g: 0, e: 0, x: 0 }; this.cdMax = { q: 0.001, f: 3.5, g: 3.2, e: 1.0, x: 7 };
    this.comboIdx = 0; this.comboWin = 0; this.queued = false; this.noDash = false;
    this.buildMode = 0; this.modeNames = ['BRIDGE', 'PLATFORM', 'STAIRS', 'WALL'];
    const bones = game.dh.rig.bones;
    // ---- weapon crystals parented to the real forearm bones
    this.blade = {}; this.gaunt = {}; this.cannonGrp = {}; this.toolAmt = { bladeL: 0, bladeR: 0, gauntL: 0, gauntR: 0, cannon: 0 };
    const bladeGeo = makeCrystalGeometry({ length: 1.4, radius: 0.24, sides: 4, tip: 0.32, jitter: 0.05, seed: 3 });
    const bladeGeo2 = makeCrystalGeometry({ length: 0.7, radius: 0.1, sides: 5, tip: 0.5, seed: 4 });
    this.matBlade = mat({ color: 0x7bffd0, emissive: 0x1fe08a, emissiveIntensity: 1.3, opacity: 0.93 });
    this.matTool = mat({ color: 0x45f0a0, emissive: 0x18d070, emissiveIntensity: 1.0, opacity: 0.92 });
    for (const s of ['L', 'R']) {
      const bg = new THREE.Group(); bg.visible = false; const bl = new THREE.Mesh(bladeGeo, this.matBlade); bl.quaternion.setFromUnitVectors(Z, DOWN); bl.scale.set(0.85, 0.85, 1); bl.position.set(0, -0.15, 0.02); bl.castShadow = true; bg.add(bl);
      for (const k of [-1, 1]) { const sp = new THREE.Mesh(bladeGeo2, this.matBlade); sp.quaternion.setFromUnitVectors(Z, new THREE.Vector3(k * 0.45, -1, 0.1).normalize()); sp.position.set(k * 0.09, -0.32, 0); bg.add(sp); }
      const tip = new THREE.Object3D(); tip.position.set(0, -1.5, 0); bg.add(tip); bones['farm' + s].add(bg); this.blade[s] = { grp: bg, tip };
      const gg = new THREE.Group(); gg.visible = false;
      for (let k = 0; k < 8; k++) {
        const a = k / 8 * TAU, geo = makeCrystalGeometry({ length: 0.55 + (k % 3) * 0.16, radius: 0.13, tip: 0.45, seed: 30 + k });
        const m = new THREE.Mesh(geo, this.matTool); const out = new THREE.Vector3(Math.cos(a), -0.9, Math.sin(a)).normalize(); m.quaternion.setFromUnitVectors(Z, out); m.position.set(Math.cos(a) * 0.22, -0.28 - (k % 4) * 0.12, Math.sin(a) * 0.22); gg.add(m);
      }
      const knuckle = new THREE.Mesh(makeCrystalGeometry({ length: 0.85, radius: 0.24, tip: 0.5, seed: 77 }), this.matBlade); knuckle.quaternion.setFromUnitVectors(Z, DOWN); knuckle.position.set(0, -0.85, 0.05); gg.add(knuckle);
      const gtip = new THREE.Object3D(); gtip.position.set(0, -1.1, 0.05); gg.add(gtip); bones['farm' + s].add(gg); this.gaunt[s] = { grp: gg, tip: gtip };
      const cg = new THREE.Group(); cg.visible = false;
      for (let k = 0; k < 12; k++) {
        const a = k / 12 * TAU + 0.3, geo = makeCrystalGeometry({ length: 0.7 + (k % 4) * 0.18, radius: 0.16, tip: 0.45, seed: 60 + k });
        const m = new THREE.Mesh(geo, this.matBlade); const out = new THREE.Vector3(Math.cos(a) * 0.8, -1, Math.sin(a) * 0.8).normalize(); m.quaternion.setFromUnitVectors(Z, out); m.position.set(Math.cos(a) * 0.2, -0.15 - (k % 5) * 0.12, Math.sin(a) * 0.2); cg.add(m);
      }
      bones['farm' + s].add(cg); this.cannonGrp[s] = cg;
    }
    // ---- slash arcs (pooled)
    this.arcs = []; const arcGeo = this.arcGeo = new THREE.RingGeometry(0.62, 1, 40, 1, 0, 2.5);
    for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(arcGeo, new THREE.MeshBasicMaterial({ color: 0xaaffdd, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })); m.visible = false; m.userData = { t: 9, dur: 0.28, size: 3 }; game.scene.add(m); this.arcs.push(m); }
    this.arcN = 0;
    this.buildShield(); this.buildSpikes(); this.buildBeam();
    this.constructs = []; this.spikes = [];
    this.matCon = mat({ color: 0x86ffd6, emissive: 0x16c27c, emissiveIntensity: 0.55, opacity: 0.8 });
    this.edgeM = edgeMat();
    this.rig = game.dh.rig;
  }

  // ------------------------------------------------------------------------------------------ input
  get busy() { return !!this.act; }
  get lockFacing() { return !!this.act && (this.act.kind !== 'build' || this.act.t < 0.5); }
  get speedMul() { const k = this.act && this.act.kind; return k === 'cannon' ? 0.0 : k === 'shield' ? 0.55 : k === 'spikes' ? 0.15 : k === 'build' ? 0.3 : 0.45; }
  grounded() { const P = this.g.dh; return P.grounded && P.mode !== 'dash' && P.mode !== 'crouch'; }
  free() { return !this.act && !this.g.power.busy; }
  keyDown(code) {
    const hud = this.g.hud;
    if (code === 'Digit1' || code === 'Digit2' || code === 'Digit3' || code === 'Digit4') { this.buildMode = +code.slice(5) - 1; hud.toast('CONSTRUCT: ' + this.modeNames[this.buildMode] + '  (press E)'); return; }
    if (code === 'KeyQ') {
      if (this.act && this.act.kind === 'melee') { if (this.act.t > 0.1) this.queued = true; return; }
      if (this.free() && this.grounded()) this.startMelee();
    } else if (code === 'KeyF') { if (this.free() && this.cd.f <= 0 && !this.sh.broken) this.startShield(); }
    else if (code === 'KeyG') { if (this.free() && this.grounded() && this.cd.g <= 0) this.startSpikes(); }
    else if (code === 'KeyE') { if (this.free() && this.grounded() && this.cd.e <= 0) this.startBuild(); }
    else if (code === 'KeyX') { if (this.free() && this.grounded() && this.cd.x <= 0) this.startCannon(); }
  }
  keyUp(code) { if (code === 'KeyF' && this.act && this.act.kind === 'shield') this.act.held = false; }
  releaseAll() { if (this.act && this.act.kind === 'shield') this.act.held = false; }

  // ------------------------------------------------------------------------------------------ helpers
  flatAim() { if (this.act && this.act.kind === 'melee' && this.act.face !== undefined) return new THREE.Vector3(Math.sin(this.act.face), 0, Math.cos(this.act.face)); const d = this.g.camera.aimDir; const f = _v.set(d.x, 0, d.z); if (f.lengthSq() < 1e-6) f.set(Math.sin(this.g.dh.yaw), 0, Math.cos(this.g.dh.yaw)); return f.normalize().clone(); }
  later(t, fn) { this.timers.push({ t, fn }); }
  toolWorld(side, kind, out) { const o = kind === 'blade' ? this.blade[side].tip : this.gaunt[side].tip; return o.getWorldPosition(out); }
  impactFX(pt, n, k = 1) {
    const fx = this.g.fx;
    for (let i = 0; i < 9 * k; i++) fx.shards.emit({ pos: pt, vel: _v.set(rand(-1, 1), rand(-0.1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(3, 9) * (0.6 + k * 0.4)).addScaledVector(n, rand(1, 4)), size: rand(0.08, 0.28) * (0.8 + k * 0.3), life: rand(0.9, 1.5), grav: 1 });
    for (let i = 0; i < 10 * k; i++) fx.glow.emit({ pos: pt, vel: _v.set(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).normalize().multiplyScalar(rand(3, 10)), size: rand(0.15, 0.35), life: rand(0.25, 0.5), drag: 2.5, color: [0.4, 1, 0.7] });
    fx.glow.emit({ pos: _v.copy(pt).addScaledVector(n, 0.15), size: 1.8 + k, life: 0.12, drag: 0, color: [0.85, 1, 0.93] });
    fx.surface.ring(pt, n, 1.4 + k * 0.8, 0.32);
  }
  /** damage everything in range/arc; returns hit count */
  arcDamage(range, half, dmg, knock, launch, origin = null) {
    const g = this.g, P = g.dh, f = this.flatAim(), O = origin || P.pos; let n = 0;
    for (const h of g.world.hittables) {
      if (h.dead) continue; const hp = h.root.position, dx = hp.x - O.x, dz = hp.z - O.z, d = Math.hypot(dx, dz); if (d > range + 0.7) continue;
      if (half < Math.PI) { const ang = Math.acos(clamp((dx * f.x + dz * f.z) / (d || 1), -1, 1)); if (ang > half + 0.12) continue; }
      const dir = d > 0.05 ? new THREE.Vector3(dx / d, 0, dz / d) : f.clone(); const pt = new THREE.Vector3(hp.x, O.y + 1.4, hp.z).addScaledVector(dir, -0.4);
      h.applyHit(pt, dir, dmg); if (h.knock) h.knock(dir, knock); if (launch && h.launch) h.launch(launch);
      g.hud.hit(pt, dmg, h); this.impactFX(pt, dir.clone().negate().setY(0.3).normalize(), 1); this.stats.hits++; n++;
    }
    return n;
  }
  arcFx(pos, yaw, tilt, size, ring) {
    const m = this.arcs[this.arcN]; this.arcN = (this.arcN + 1) % this.arcs.length; m.visible = true; m.userData.t = 0; m.userData.size = size; m.userData.dur = ring ? 0.4 : 0.26;
    m.position.copy(pos); m.rotation.order = 'YXZ'; m.rotation.set(0, 0, 0);
    if (ring) { m.geometry = this.ringGeo || (this.ringGeo = new THREE.RingGeometry(0.62, 1, 48)); m.rotation.x = -Math.PI / 2; }
    else { m.geometry = this.arcGeo; m.rotation.y = yaw - Math.PI / 2 - 1.25; m.rotation.x = -Math.PI / 2 + tilt * 0.6; }
  }
  trail(a, b, n, color = [0.4, 1, 0.7]) { const fx = this.g.fx; for (let i = 0; i < n; i++) { _v3.lerpVectors(a, b, i / Math.max(1, n - 1)); fx.glow.emit({ pos: _v3, vel: _v2.set(rand(-0.5, 0.5), rand(-0.3, 0.8), rand(-0.5, 0.5)), size: rand(0.25, 0.5), life: 0.3, drag: 2.5, color }); } }

  // ------------------------------------------------------------------------------------------ Q: crystal weapons
  startMelee() {
    if (this.comboWin <= 0) this.comboIdx = 0;
    const M = MELEE[this.comboIdx % MELEE.length];
    this.act = { kind: 'melee', M, t: 0, hitI: 0, idx: this.comboIdx % MELEE.length }; this.queued = false; this.noDash = true;
    this.g.hud.toast(M.name + '  (' + (this.act.idx + 1) + '/4)');
    const sides = M.side === 'B' ? ['L', 'R'] : [M.side];
    this.act.sides = sides;
    this.later(0, () => { }); // placeholder keeps API symmetric
    this.comboIdx++; this.stats.melee++;
  }
  updateMelee(dt, a) {
    const M = a.M, t = a.t, P = this.g.dh, cam = this.g.camera;
    if (a.hitI === 0) a.face = meleeAim(this.g, P.pos, 7.5).yaw;       // crosshair target decides the swing direction until the first strike
    sample(M.keys, t, this.layer.rot);
    this.layer.w = Math.min(1, t / 0.07, (M.dur - t) / 0.16 + 0.05);
    // weapons grow just before the strike, retract after
    const near = t < M.dur - 0.12, want = new Set(a.sides.map(s => (M.tool === 'blade' ? 'blade' : 'gaunt') + s));
    for (const key of ['bladeL', 'bladeR', 'gauntL', 'gauntR']) { const on = near && want.has(key); this.toolAmt[key] = damp(this.toolAmt[key], on ? 1 : 0, on ? 26 : 14, dt); }
    this.layer.spinY = M.side === 'B' ? easeInOutCubic((t - 0.1) / 0.55) * TAU : 0;
    // strike events
    while (a.hitI < M.hits.length && t >= M.hits[a.hitI]) {
      const f = this.flatAim(); const lunge = M.lunge; if (lunge) P.lungeStart(f, lunge, 0.12);
      const center = _v3.copy(P.pos); center.y += 1.5;
      if (M.arc) this.arcFx(center.clone().addScaledVector(f, M.arc.ring ? 0 : 0.8), Math.atan2(f.x, f.z), M.arc.tilt, M.arc.size, M.arc.ring);
      const n = this.arcDamage(M.range, M.half, M.dmg, M.knock, M.launch);
      cam.addTrauma(M.shake * (n ? 1.2 : 0.7)); cam.kick(0.04);
      if (M.tool === 'gaunt') { const gp = this.toolWorld(a.sides[0], 'gaunt', new THREE.Vector3()); this.g.fx.surface.ring(P.pos.clone().setY(P.pos.y + 0.05).addScaledVector(f, 1.6), UP, 3.5, 0.4); this.impactFX(gp, f.clone().negate(), 0.8); }
      a.hitI++;
    }
    // swing trail from the active weapon
    const swinging = t > M.hits[0] - 0.1 && t < M.hits[M.hits.length - 1] + 0.14;
    if (swinging) for (const s of a.sides) { const tipp = this.toolWorld(s, M.tool === 'blade' ? 'blade' : 'gaunt', new THREE.Vector3()); const base = this.blade[s].grp.getWorldPosition(new THREE.Vector3()); if (a.last && a.last[s]) this.trail(a.last[s], tipp, 5); this.trail(base, tipp, 3, [0.6, 1, 0.85]); (a.last = a.last || {})[s] = tipp; }
    // chain input
    if (this.queued && t > M.dur * 0.72) { this.queued = false; this.finishMelee(true); return; }
    if (t >= M.dur) this.finishMelee(false);
  }
  finishMelee(chain) {
    const g = this.act; this.act = null; this.noDash = false; this.comboWin = 0.55; this.cd.q = 0;
    this.layer.spinY = 0;
    if (chain && this.grounded() && !this.g.power.busy) this.startMelee();
  }

  // ------------------------------------------------------------------------------------------ F: crystal shield
  buildShield() {
    const g = this.g, grp = this.shGrp = new THREE.Group(); grp.visible = false; g.scene.add(grp);
    this.shMat = mat({ color: 0x8dffd8, emissive: 0x1fe08a, emissiveIntensity: 0.9, opacity: 0.74 });
    this.shCrystals = [];
    for (let row = 0; row < 2; row++) for (let i = -6; i <= 6; i++) {
      if (row === 1 && (i + 7) % 2) continue;
      const geo = makeCrystalGeometry({ length: 1, radius: 0.42, sides: 6, tip: 0.45, jitter: 0.18, seed: 100 + i + row * 40 });
      const m = new THREE.Mesh(geo, this.shMat); const x = i * 0.42 + (row ? 0.2 : 0), z = x * x * 0.065 - (row ? 0.5 : 0);
      const len = (row ? 2.6 : 3.7) - Math.abs(i) * (row ? 0.1 : 0.2) + rand(-0.15, 0.25);
      m.position.set(x, 0, z); m.userData = { len, i, lean: new THREE.Vector3(x * 0.05, 1, 0.12 + (row ? -0.06 : 0)).normalize() }; m.quaternion.setFromUnitVectors(Z, m.userData.lean); m.castShadow = true; grp.add(m); this.shCrystals.push(m);
    }
    this.shPane = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 3.4), new THREE.MeshPhysicalMaterial({ color: 0x9bffe0, emissive: 0x16c27c, emissiveIntensity: 0.5, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false, roughness: 0.05, metalness: 0.2 }));
    this.shPane.position.set(0, 1.7, 0.1); grp.add(this.shPane);
    this.sh = { amt: 0, hp: 120, max: 120, broken: false, flash: 0, center: new THREE.Vector3(), yaw: 0, hx: 2.75, hy: 1.9, hz: 0.55 };
  }
  startShield() { this.act = { kind: 'shield', t: 0, held: true }; this.noDash = true; this.shGrp.visible = true; this.g.hud.toast('CRYSTAL SHIELD — hold F'); this.stats.shield = (this.stats.shield || 0) + 1; }
  updateShield(dt, a) {
    const P = this.g.dh, S = this.sh, t = a.t;
    const hold = a.held || t < 0.35; a.dropT = hold ? 0 : (a.dropT || 0) + dt;
    const raise = smoothstep(0, 0.16, t), drop = a.dropT ? smoothstep(0, 0.22, a.dropT) : 0;
    this.layer.w = Math.min(raise, 1 - drop * 0.95);
    const k = 0.04 * Math.sin(t * 9);
    this.layer.rot = { hips: [0.08, 0.15, 0], spine: [0.1, 0.12, 0], chest: [0.1, 0.25, 0], head: [0, -0.15, 0], uarmL: [-1.05 + k, 0.25, 0.65], farmL: [-1.45, 0, 0], handL: [-0.3, 0, 0], uarmR: [-0.5, 0, -0.5], farmR: [-1.1, 0, 0], thighL: [-0.3, 0, 0.18], shinL: [0.5, 0, 0], thighR: [0.22, 0, -0.18], shinR: [0.45, 0, 0] };
    S.amt = damp(S.amt, hold && !S.broken ? 1 : 0, hold ? 7 : 16, dt);
    if (S.broken) S.amt = 0;
    this.updateShieldMesh(dt);
    if (!hold && S.amt < 0.02 || (S.broken && a.dropT > 0.2) || (!hold && a.dropT > 0.3)) { this.endShield(); }
  }
  endShield() { this.act = null; this.noDash = false; this.cd.f = this.sh.broken ? 3.5 : 0.35; }
  shieldActive() { return this.sh.amt > 0.55 && !this.sh.broken; }
  updateShieldMesh(dt) {
    const S = this.sh, P = this.g.dh;
    const f = _v.set(Math.sin(P.yaw), 0, Math.cos(P.yaw)); S.yaw = P.yaw; S.center.set(P.pos.x + f.x * 2.5, P.pos.y + S.hy, P.pos.z + f.z * 2.5);
    this.shGrp.position.set(P.pos.x + f.x * 2.5, P.pos.y, P.pos.z + f.z * 2.5); this.shGrp.rotation.y = P.yaw;
    S.flash = Math.max(0, S.flash - dt * 4);
    this.shMat.emissiveIntensity = 0.9 + S.flash * 3.5; this.shMat.opacity = 0.74 + S.flash * 0.2;
    this.shPane.material.opacity = (0.12 + S.flash * 0.35) * clamp(S.amt * 1.2, 0, 1);
    for (const m of this.shCrystals) { const u = easeOutBack(clamp(S.amt * 1.7 - Math.abs(m.userData.i) * 0.07, 0, 1)); const s = Math.max(1e-4, u); m.scale.set(s, s, m.userData.len * s); }
    this.shGrp.visible = S.amt > 0.003;
    // sparkle while up
    if (this.shieldActive() && Math.random() < 0.5) { const x = rand(-2.4, 2.4); _v2.set(x, rand(0.4, 3), x * x * 0.065); this.shGrp.localToWorld(_v2); this.g.fx.glow.emit({ pos: _v2, vel: _v3.set(0, rand(0.3, 1), 0), size: rand(0.12, 0.25), life: 0.5, color: [0.5, 1, 0.8], alpha: 0.7 }); }
  }
  /** segment vs the shield's oriented box. returns {t, point, normal} */
  shieldHit(o, d, maxT) {
    if (!this.shieldActive()) return null; const S = this.sh, c = Math.cos(S.yaw), s = Math.sin(S.yaw);
    // local axes: x = (c,0,-s) (width), z = (s,0,c) (depth)
    const rx = o.x - S.center.x, ry = o.y - S.center.y, rz = o.z - S.center.z;
    const lo = [rx * c - rz * s, ry, rx * s + rz * c], ld = [d.x * c - d.z * s, d.y, d.x * s + d.z * c], h = [S.hx, S.hy, S.hz];
    let tmin = 0, tmax = maxT, ax = -1, sg = 1;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(ld[i]) < 1e-8) { if (Math.abs(lo[i]) > h[i]) return null; continue; }
      let t1 = (-h[i] - lo[i]) / ld[i], t2 = (h[i] - lo[i]) / ld[i], sgn = -1; if (t1 > t2) { [t1, t2] = [t2, t1]; sgn = 1; }
      if (t1 > tmin) { tmin = t1; ax = i; sg = sgn; } tmax = Math.min(tmax, t2); if (tmin > tmax) return null;
    }
    const pt = o.clone().addScaledVector(d, tmin); const nl = [0, 0, 0]; nl[ax < 0 ? 2 : ax] = sg || 1;
    const n = new THREE.Vector3(nl[0] * c + nl[2] * s, nl[1], -nl[0] * s + nl[2] * c);
    return { t: tmin, point: pt, normal: n };
  }
  shieldAbsorb(pt, n, dmg) {
    const S = this.sh, fx = this.g.fx; S.hp -= dmg; S.flash = 1; this.stats.blocked++;
    this.impactFX(pt, n, 0.9); this.g.camera.addTrauma(0.22);
    for (let i = 0; i < 6; i++) fx.glow.emit({ pos: pt, vel: _v.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(4, 9)), size: 0.25, life: 0.3, color: [1, 0.7, 0.35] });
    if (S.hp <= 0) this.breakShield();
  }
  breakShield() {
    const S = this.sh, fx = this.g.fx; S.broken = true; this.g.hud.toast('SHIELD SHATTERED');
    for (const m of this.shCrystals) { m.getWorldPosition(_v); _v.y += 1.2; for (let k = 0; k < 3; k++) fx.shards.emit({ pos: _v, vel: _v2.set(rand(-1, 1), rand(0.2, 1.5), rand(-1, 1)).normalize().multiplyScalar(rand(4, 11)), size: rand(0.15, 0.4), life: 1.5, grav: 1 }); }
    fx.surface.ring(S.center.clone().setY(this.g.dh.pos.y + 0.1), UP, 6, 0.5); this.g.camera.addTrauma(0.6);
    if (this.act) this.act.held = false;
  }

  // ------------------------------------------------------------------------------------------ G: crystal spikes
  buildSpikes() {
    this.spikeMat = mat({ color: 0x3ee890, emissive: 0x16c866, emissiveIntensity: 0.8, opacity: 0.93 });
    this.spikeGeo = [0, 1, 2, 3, 4, 5].map(i => makeCrystalGeometry({ length: 1, radius: 0.5, sides: 6, tip: 0.62, jitter: 0.16, seed: 200 + i }));
  }
  startSpikes() {
    this.act = { kind: 'spikes', t: 0, slammed: false }; this.noDash = true; this.cd.g = this.cdMax.g; this.stats.spikes++;
    this.g.hud.toast('CRYSTAL SPIKES');
  }
  updateSpikes(dt, a) {
    const t = a.t, P = this.g.dh;
    const keys = SPIKE_KEYS; sample(keys, t, this.layer.rot); this.layer.w = Math.min(1, t / 0.1, (1.05 - t) / 0.2 + 0.05);
    if (t < 0.32 && Math.random() < 0.8) { // energy gathers at the raised fists
      for (const s of ['L', 'R']) { this.rig.markers['tip' + s].getWorldPosition(_v3); this.g.fx.glow.emit({ pos: _v3, vel: _v2.set(rand(-1, 1), rand(0.5, 2), rand(-1, 1)), size: rand(0.3, 0.6) * (0.4 + t * 2), life: 0.35, color: [0.4, 1, 0.65] }); }
    }
    if (!a.slammed && t >= 0.42) { a.slammed = true; this.slam(); }
    if (t >= 1.05) { this.act = null; this.noDash = false; }
  }
  slam() {
    const g = this.g, P = g.dh, fx = g.fx, f = this.flatAim(); const C = P.pos.clone(); const T = g.world.island && g.world.terrain, gyAt = (x, z) => T ? T.height(x, z) : 0; C.y = T ? gyAt(C.x, C.z) : 0;   // V28: the ground under him (terrain on the island)
    g.camera.addTrauma(0.75); g.camera.kick(0.07);
    fx.surface.ring(C.clone().setY(C.y + 0.06), UP, 8, 0.55); fx.surface.ring(C.clone().setY(C.y + 0.06), UP, 13, 0.8);
    for (let k = 0; k < 6; k++) { const a = k / 6 * TAU, p = C.clone().add(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(1.3 + k % 2 * 1.4)); fx.surface.decal(p.setY(gyAt(p.x, p.z) + 0.02), UP, 4.2); }
    for (let i = 0; i < 20; i++) fx.dust.emit({ pos: C.clone().setY(C.y + 0.2), vel: _v.set(rand(-1, 1), rand(0.1, 0.5), rand(-1, 1)).normalize().multiplyScalar(rand(3, 8)), size: rand(1, 2), grow: 2, life: rand(0.6, 1.1), drag: 2, color: [0.62, 0.6, 0.57], alpha: 0.6 });
    // spike layout: three expanding rings plus one massive spike straight ahead
    const list = [];
    [[2.7, 6, 2.3], [4.8, 10, 3.2], [7.0, 14, 4.0]].forEach(([r, n, len], ri) => { for (let i = 0; i < n; i++) { const a = i / n * TAU + ri * 0.35 + rand(-0.08, 0.08); list.push({ x: C.x + Math.cos(a) * r, z: C.z + Math.sin(a) * r, len: len * rand(0.8, 1.2), r, out: new THREE.Vector3(Math.cos(a), 0, Math.sin(a)) }); } });
    list.push({ x: C.x + f.x * 6.2, z: C.z + f.z * 6.2, len: 7.5, r: 6.2, out: f.clone(), big: true });
    for (const s of list) {
      if (!T && (Math.abs(s.x) > 34 || Math.abs(s.z) > 34)) continue;
      s.gy = gyAt(s.x, s.z); if (T && (Math.abs(s.gy - C.y) > 3 || (g.lagoon && g.lagoon.depthAt(s.x, s.z) > 1.2))) continue;
      if (g.world.boxes.some(b => !b.tmp && s.x > b.min.x - 0.5 && s.x < b.max.x + 0.5 && s.z > b.min.z - 0.5 && s.z < b.max.z + 0.5 && b.max.y > s.gy + 0.4 && b.min.y < s.gy + 2)) continue;
      this.later(0.04 + s.r / 24, () => this.erupt(s));
    }
    // launch enemies in the blast
    for (const h of g.world.hittables) {
      if (h.dead) continue; const hp = h.root.position, dx = hp.x - C.x, dz = hp.z - C.z, d = Math.hypot(dx, dz); if (d > 8.8) continue;
      const dir = d > 0.1 ? new THREE.Vector3(dx / d, 0, dz / d) : f.clone();
      this.later(0.05 + d / 24, () => {
        if (h.dead) return; const pt = h.root.position.clone(); pt.y += 1.2; h.applyHit(pt, dir, 38); if (h.knock) h.knock(dir, 5); if (h.launch) h.launch(13); g.hud.hit(pt, 38, h); this.impactFX(pt, UP, 1.4); this.stats.hits++;
      });
    }
  }
  erupt(s) {
    const g = this.g, fx = g.fx; const mesh = new THREE.Mesh(this.spikeGeo[(Math.random() * 6) | 0], this.spikeMat); mesh.castShadow = true;
    const tilt = s.big ? 0.05 : 0.2 + rand(0, 0.12), dir = s.out.clone().multiplyScalar(Math.sin(tilt)).add(new THREE.Vector3(0, Math.cos(tilt), 0)).normalize();
    mesh.quaternion.setFromUnitVectors(Z, dir); mesh.rotateZ(rand(0, 6.28)); const gy = s.gy || 0; mesh.position.set(s.x, gy - 0.1, s.z); g.scene.add(mesh);
    const sxy = s.len * (s.big ? 0.36 : 0.32), baseR = 0.5 * sxy;
    const half = baseR * 0.75, box = { min: new THREE.Vector3(s.x - half, gy, s.z - half), max: new THREE.Vector3(s.x + half, gy + 0.01, s.z + half), tmp: true };
    g.world.boxes.push(box);
    const sp = { mesh, box, len: s.len, sxy, h: s.len * 0.55, t: 0, life: 7 + rand(0, 1.2), dead: false, x: s.x, z: s.z, gy };
    this.spikes.push(sp);
    for (let i = 0; i < 6; i++) fx.shards.emit({ pos: _v.set(s.x, gy + 0.2, s.z), vel: _v2.set(rand(-1, 1), rand(2, 6), rand(-1, 1)).multiplyScalar(1.2), size: rand(0.1, 0.25), life: 1.1, grav: 1 });
    fx.glow.emit({ pos: _v.set(s.x, gy + 0.3, s.z), size: 2.2, life: 0.2, drag: 0, color: [0.6, 1, 0.8] });
    for (let i = 0; i < 3; i++) fx.dust.emit({ pos: _v.set(s.x, gy + 0.15, s.z), vel: _v2.set(rand(-1, 1), rand(0.2, 1), rand(-1, 1)), size: rand(0.8, 1.4), grow: 1.5, life: 0.7, drag: 2, color: [0.62, 0.6, 0.57], alpha: 0.5 });
  }
  updateSpikeMeshes(dt) {
    for (let i = this.spikes.length - 1; i >= 0; i--) {
      const sp = this.spikes[i]; sp.t += dt; sp.life -= dt;
      let u = easeOutBack(clamp(sp.t / 0.3, 0, 1)); const fade = sp.life < 0.5 ? clamp(sp.life / 0.5, 0, 1) : 1; u *= fade; const lu = Math.max(1e-4, u);
      sp.mesh.scale.set(sp.sxy * Math.max(0.01, Math.min(1, lu * 1.1)), sp.sxy * Math.max(0.01, Math.min(1, lu * 1.1)), sp.len * lu);
      sp.box.max.y = sp.gy + Math.max(0.01, sp.h * Math.min(1, u * (sp.life < 0.5 ? 1 : 1)));
      if (sp.life <= 0) {
        this.g.world.boxes.splice(this.g.world.boxes.indexOf(sp.box), 1); this.g.scene.remove(sp.mesh); this.spikes.splice(i, 1);
        for (let k = 0; k < 6; k++) this.g.fx.shards.emit({ pos: _v.set(sp.x, sp.gy + rand(0.4, sp.h), sp.z), vel: _v2.set(rand(-1, 1), rand(0.5, 3), rand(-1, 1)).multiplyScalar(2), size: rand(0.15, 0.35), life: 1.2, grav: 1 });
      }
    }
  }

  // ------------------------------------------------------------------------------------------ E: crystal constructs
  startBuild() {
    this.act = { kind: 'build', t: 0, made: false }; this.noDash = true; this.cd.e = this.cdMax.e; this.stats.built++;
    this.g.hud.toast('CRYSTAL ' + this.modeNames[this.buildMode]);
  }
  updateBuild(dt, a) {
    const t = a.t, m = this.buildMode; const dn = m === 1 ? 0.5 : 0;
    sample(m === 1 ? BUILD_DOWN : BUILD_FWD, t, this.layer.rot); this.layer.w = Math.min(1, t / 0.08, (0.62 - t) / 0.15 + 0.05);
    if (t < 0.22) for (const s of ['L', 'R']) { this.rig.markers['tip' + s].getWorldPosition(_v3); this.g.fx.glow.emit({ pos: _v3, vel: _v2.set(rand(-1, 1), rand(-0.5, 1), rand(-1, 1)), size: rand(0.3, 0.55), life: 0.3, color: [0.45, 1, 0.75] }); }
    if (!a.made && t >= 0.22) { a.made = true; this.makeConstruct(m); }
    if (t >= 0.62) { this.act = null; this.noDash = false; }
  }
  addPiece(c, group, box, x, y, z, w, h, d, { crown = 0, delay = 0, solid = true } = {}) {
    // piece = faceted slab/column with glowing edges, grows upward from its base
    const piv = new THREE.Group(); piv.position.set(x, y, z); const geo = new THREE.BoxGeometry(w, h, d); const body = new THREE.Mesh(geo, this.matCon); body.position.y = h / 2; body.castShadow = body.receiveShadow = true; piv.add(body);
    { const ln = new THREE.LineSegments(new THREE.EdgesGeometry(geo), this.edgeM); ln.position.set(0, h / 2, 0); piv.add(ln); }
    for (let i = 0; i < crown; i++) { const cr = new THREE.Mesh(this.spikeGeo[i % 6], this.matCon); const L = rand(0.5, 1.3) * Math.min(w, 2); cr.scale.set(0.3 * L + 0.1, 0.3 * L + 0.1, L); cr.position.set(rand(-w / 2, w / 2) * 0.85, h, rand(-d / 2, d / 2) * 0.8); cr.quaternion.setFromUnitVectors(Z, new THREE.Vector3(rand(-0.25, 0.25), 1, rand(-0.25, 0.25)).normalize()); piv.add(cr); }
    piv.scale.y = 0.001; group.add(piv);
    const entry = { piv, box: null, h, delay, solid, y0: y };
    if (solid) { entry.box = { min: new THREE.Vector3(x - w / 2, y, z - d / 2), max: new THREE.Vector3(x + w / 2, y + 0.01, z + d / 2), tmp: true }; this.g.world.boxes.push(entry.box); }
    c.pieces.push(entry); return entry;
  }
  makeConstruct(mode) {
    const g = this.g, P = g.dh, f = this.flatAim(), grp = new THREE.Group(); g.scene.add(grp);
    const c = { grp, pieces: [], t: 0, life: 16, mode, rise: null }; const y0 = P.pos.y;
    const cardinal = Math.abs(f.x) > Math.abs(f.z) ? new THREE.Vector3(Math.sign(f.x), 0, 0) : new THREE.Vector3(0, 0, Math.sign(f.z));
    const perp = new THREE.Vector3(-cardinal.z, 0, cardinal.x);
    if (mode === 0) { // bridge: a trail of hex-shaped crystal slabs straight out from his feet
      c.life = 22;
      for (let i = 0; i < 9; i++) {
        const p = P.pos.clone().addScaledVector(f, 2.0 + i * 1.85); p.y = y0;
        const geo = new THREE.CylinderGeometry(1.25, 1.25, 0.55, 6); const piv = new THREE.Group(); piv.position.set(p.x, y0 - 0.25, p.z); const body = new THREE.Mesh(geo, this.matCon); body.position.y = 0.275; body.rotation.y = Math.atan2(f.x, f.z) + Math.PI / 6; body.castShadow = body.receiveShadow = true; piv.add(body);
        const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), this.edgeM); e.position.y = 0.275; e.rotation.y = body.rotation.y; piv.add(e); piv.scale.y = 0.001; grp.add(piv);
        const entry = { piv, h: 1, delay: i * 0.07, solid: true, y0, tile: true, box: { min: new THREE.Vector3(p.x - 1.05, y0 - 0.25, p.z - 1.05), max: new THREE.Vector3(p.x + 1.05, y0 - 0.24, p.z + 1.05), tmp: true }, top: y0 + 0.3, bot: y0 - 0.25 }; g.world.boxes.push(entry.box); c.pieces.push(entry);
      }
    } else if (mode === 1) { // platform: a crystal pillar lifts him up
      c.life = 11; const e = this.addPiece(c, grp, null, P.pos.x, 0, P.pos.z, 4.4, 1, 4.4, { crown: 0, solid: true });
      c.rise = { entry: e, top: y0 + 3.4, cur: y0, x: P.pos.x, z: P.pos.z }; e.piv.visible = true;
      const col = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.6, 1, 6), this.matCon); col.castShadow = true; grp.add(col); c.rise.col = col;
      for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; const cr = new THREE.Mesh(this.spikeGeo[i], this.matCon); cr.scale.set(0.7, 0.7, rand(1.2, 2)); cr.position.set(P.pos.x + Math.cos(a) * 2.0, y0 + 0.05, P.pos.z + Math.sin(a) * 2.0); cr.quaternion.setFromUnitVectors(Z, new THREE.Vector3(Math.cos(a) * 0.5, 1, Math.sin(a) * 0.5).normalize()); grp.add(cr); c.rise.crystals = c.rise.crystals || []; c.rise.crystals.push(cr); }
      e.box.min.y = 0; e.box.max.y = y0; delete e.growFromScale;
    } else if (mode === 2) { // stairs: ten climbable steps (0.38 m rise each)
      c.life = 22; const run = 1.25, rise = 0.38, W = 3.6;
      for (let i = 0; i < 10; i++) {
        const along = 2.0 + i * run + run / 2, ctr = P.pos.clone().addScaledVector(cardinal, along); const w = cardinal.x ? run : W, d = cardinal.x ? W : run;
        const e = this.addPiece(c, grp, null, ctr.x, y0, ctr.z, w, rise * (i + 1), d, { crown: i === 9 ? 3 : 0, delay: i * 0.06 }); e.target = rise * (i + 1);
      }
    } else { // wall: a jagged crystal barrier
      c.life = 18; const ctr = P.pos.clone().addScaledVector(cardinal, 3.6); const w = cardinal.x ? 1.1 : 7, d = cardinal.x ? 7 : 1.1;
      const e = this.addPiece(c, grp, null, ctr.x, y0, ctr.z, w, 3.8, d, { crown: 8 }); e.target = 3.8;
      for (const sgn of [-1, 1]) { const q = ctr.clone().addScaledVector(perp, sgn * 4.0); this.addPiece(c, grp, null, q.x, y0, q.z, cardinal.x ? 0.9 : 1.6, 2.6, cardinal.x ? 1.6 : 0.9, { crown: 3, solid: true, delay: 0.1 }).target = 2.6; }
    }
    for (const e of c.pieces) if (e.target === undefined && !c.rise) e.target = e.h;
    this.constructs.push(c);
    while (this.constructs.length > 5) this.removeConstruct(this.constructs[0]);
    g.camera.addTrauma(0.3); g.fx.surface.ring(P.pos.clone().setY(y0 + 0.06), UP, 5, 0.45);
  }
  removeConstruct(c, fx = true) {
    const g = this.g; for (const e of c.pieces) if (e.box) { const i = g.world.boxes.indexOf(e.box); if (i >= 0) g.world.boxes.splice(i, 1); }
    if (fx) c.grp.traverse(o => { if (o.isMesh && Math.random() < 0.4) { o.getWorldPosition(_v); for (let k = 0; k < 2; k++) g.fx.shards.emit({ pos: _v, vel: _v2.set(rand(-1, 1), rand(0.3, 2), rand(-1, 1)).multiplyScalar(2.5), size: rand(0.15, 0.35), life: 1.2, grav: 1 }); } });
    g.scene.remove(c.grp); const i = this.constructs.indexOf(c); if (i >= 0) this.constructs.splice(i, 1);
  }
  updateConstructs(dt) {
    for (let i = this.constructs.length - 1; i >= 0; i--) {
      const c = this.constructs[i]; c.t += dt; const dying = c.life - c.t;
      const fade = dying < 0.7 ? clamp(dying / 0.7, 0, 1) : 1;
      if (c.rise) {
        const R = c.rise, e = R.entry, y0 = R.cur;
        const up = dying > 2.2 && c.t < 3;
        R.cur = up ? Math.min(R.top, R.cur + 5.5 * dt) : (dying < 2.2 ? Math.max(0, R.cur - 1.8 * dt) : R.cur);
        e.box.max.y = Math.max(0.01, R.cur); e.box.min.y = Math.max(0, R.cur - 0.7); e.piv.scale.y = 1; e.piv.position.y = R.cur - 0.7; e.piv.children[0].scale.y = 0.7; e.piv.children[0].position.y = 0.35; if (e.piv.children[1]) { e.piv.children[1].scale.y = 0.7; e.piv.children[1].position.y = 0.35; }
        R.col.scale.set(1, Math.max(0.01, R.cur - 0.7), 1); R.col.position.set(R.x, (R.cur - 0.7) / 2, R.z);
        for (const cr of R.crystals) cr.scale.z = Math.max(0.01, cr.scale.z);
        if (up && Math.random() < 0.7) this.g.fx.dust.emit({ pos: _v.set(R.x + rand(-1.5, 1.5), 0.2, R.z + rand(-1.5, 1.5)), vel: _v2.set(rand(-1, 1), 0.4, rand(-1, 1)), size: 1, grow: 1.2, life: 0.6, drag: 2, color: [0.62, 0.6, 0.57], alpha: 0.5 });
      } else {
        for (const e of c.pieces) {
          const u = easeOutBack(clamp((c.t - e.delay) / 0.38, 0, 1)) * fade; const uu = Math.max(0.001, u);
          if (e.tile) { e.piv.scale.y = uu; e.box.max.y = u > 0.5 ? e.top : e.bot + 0.01; if (fade < 1) e.box.max.y = e.bot + 0.01; }
          else { e.piv.scale.y = uu; if (e.box) e.box.max.y = e.y0 + Math.max(0.01, e.target * Math.min(1, u)); }
        }
      }
      if (dying <= 0) this.removeConstruct(c);
    }
  }

  // ------------------------------------------------------------------------------------------ X: crystal cannon
  buildBeam() {
    const g = this.g, grp = this.beam = new THREE.Group(); grp.visible = false; g.scene.add(grp);
    const m = (r, col, op) => { const me = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 20, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); grp.add(me); return me; };
    this.beamCore = m(0.32, 0xffffff, 0.95); this.beamMid = m(0.75, 0x7dffc8, 0.55); this.beamOut = m(1.3, 0x1fe08a, 0.22);
    this.orb = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: 0xbfffe6, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })); this.orb.visible = false; g.scene.add(this.orb);
  }
  muzzle(out) { return out.copy(this.rig.markers.tipL.getWorldPosition(_v)).add(this.rig.markers.tipR.getWorldPosition(_v2)).multiplyScalar(0.5); }
  startCannon() { this.act = { kind: 'cannon', t: 0, fired: false, tick: 0, endBoom: false }; this.noDash = true; this.cd.x = this.cdMax.x; this.stats.cannon++; this.g.hud.toast('CRYSTAL CANNON'); }
  updateCannon(dt, a, aimPoint) {
    const g = this.g, fx = g.fx, t = a.t, CH = 0.62, FIRE = 0.95, END = CH + FIRE;
    const mz = this.muzzle(new THREE.Vector3());
    // aim pitch for the arms
    const toT = _v3.copy(aimPoint).sub(mz); const dist = toT.length(); toT.normalize(); const pitch = Math.asin(clamp(toT.y, -0.9, 0.9));
    const rot = this.layer.rot; for (const k in rot) delete rot[k];
    if (t < CH) {
      sample(CANNON_CHARGE, t, rot);
    } else {
      sample(CANNON_FIRE, Math.min(t - CH, 0.2), rot); const sh = (t < END ? 1 : 0) * 0.02 * Math.sin(t * 90);
      for (const s of ['L', 'R']) { rot['uarm' + s] = [-1.57 - pitch + sh, 0, s === 'L' ? -0.1 : 0.1]; rot['farm' + s] = [0, 0, 0]; rot['hand' + s] = [0, 0, 0]; }
      if (t > END) { const u = smoothstep(END, END + 0.4, t); for (const k in rot) rot[k] = rot[k].map(v => v * (1 - u)); }
    }
    this.layer.w = Math.min(1, t / 0.12, (END + 0.45 - t) / 0.3 + 0.05);
    // crystal growth around both forearms
    const grow = t < CH ? easeOutBack(clamp((t - 0.05) / 0.4, 0, 1)) : (t < END ? 1 : 1 - smoothstep(END, END + 0.35, t));
    for (const s of ['L', 'R']) { const cg = this.cannonGrp[s]; cg.visible = grow > 0.01; cg.scale.setScalar(Math.max(0.001, grow)); }
    // charge: swirling energy converges on the muzzle, orb grows
    if (t < CH) {
      const k = t / CH; g.camera.addTrauma(0.012 + k * 0.02);
      for (let i = 0; i < 3; i++) { const a2 = rand(0, TAU), r = rand(2.5, 4.2), p = _v.set(Math.cos(a2) * r, rand(-1.5, 1.5), Math.sin(a2) * r).add(mz); fx.glow.emit({ pos: p, vel: _v2.copy(mz).sub(p).multiplyScalar(2.6 + k * 2), size: rand(0.25, 0.5), life: 0.42, drag: 0.3, color: [0.4, 1, 0.7] }); }
      this.orb.visible = true; this.orb.position.copy(mz); this.orb.scale.setScalar(0.1 + k * k * 0.95 + Math.sin(t * 40) * 0.03);
      fx.glow.emit({ pos: mz, size: 0.8 + k * 3.2, life: 0.06, drag: 0, color: [0.7, 1, 0.9] });
    }
    // fire
    if (t >= CH && t < END) {
      this.orb.visible = false; const first = !a.fired;
      // beam from the muzzle to wherever the crosshair is
      const dir = toT.clone(); const len = Math.max(1, dist);
      const hit = g.world.raySolid(mz, dir, 120); let end = aimPoint.clone(); if (hit && hit.t < dist) end = hit.point.clone();
      const L = end.distanceTo(mz); this.beam.visible = true; this.beam.position.copy(mz).addScaledVector(dir, L / 2); this.beam.quaternion.setFromUnitVectors(UP, dir);
      const pulse = 1 + 0.12 * Math.sin(t * 70), env = smoothstep(0, 0.06, t - CH) * (1 - smoothstep(END - 0.15, END, t));
      this.beamCore.scale.set(env * pulse, L, env * pulse); this.beamMid.scale.set(env * pulse, L, env * pulse); this.beamOut.scale.set(env * (1 + 0.2 * Math.sin(t * 55)), L, env * (1 + 0.2 * Math.sin(t * 55)));
      // body of the beam: sparks + crystal fragments along it
      for (let i = 0; i < 7; i++) { _v.copy(mz).addScaledVector(dir, rand(0, L)); fx.glow.emit({ pos: _v, vel: _v2.set(rand(-2, 2), rand(-2, 2), rand(-2, 2)), size: rand(0.4, 0.9), life: 0.25, drag: 2, color: [0.45, 1, 0.75], alpha: 0.7 }); }
      for (let i = 0; i < 2; i++) { _v.copy(mz).addScaledVector(dir, rand(0, L)); fx.shards.emit({ pos: _v, vel: _v2.set(rand(-4, 4), rand(-1, 4), rand(-4, 4)), size: rand(0.1, 0.25), life: 0.8, grav: 0.4 }); }
      fx.glow.emit({ pos: mz, size: 3.2, life: 0.06, drag: 0, color: [0.85, 1, 0.95] });
      // impact end: continuous burst
      const n = hit ? hit.normal : UP;
      for (let i = 0; i < 6; i++) fx.glow.emit({ pos: end, vel: _v.set(rand(-1, 1), rand(0, 1.4), rand(-1, 1)).normalize().multiplyScalar(rand(5, 14)).addScaledVector(n, 5), size: rand(0.4, 0.9), life: 0.45, drag: 2, color: [0.5, 1, 0.78] });
      for (let i = 0; i < 2; i++) fx.shards.emit({ pos: end, vel: _v.set(rand(-1, 1), rand(0.5, 1.6), rand(-1, 1)).normalize().multiplyScalar(rand(5, 13)), size: rand(0.12, 0.3), life: 1.2, grav: 1 });
      fx.glow.emit({ pos: end, size: 4.5, life: 0.08, drag: 0, color: [0.8, 1, 0.92] });
      g.camera.addTrauma(0.1); g.camera.kick(0.05);
      if (first) { a.fired = true; g.camera.addTrauma(0.9); g.camera.kick(0.14); this.explosion(end, n, 1); fx.glow.emit({ pos: mz, size: 8, life: 0.2, drag: 0, color: [0.8, 1, 0.95] }); }
      a.tick -= dt; if (a.tick <= 0) { a.tick = 0.09; this.beamDamage(mz, dir, L); }
      a.endPt = end; a.endN = n;
    }
    if (t >= END && !a.endBoom) { a.endBoom = true; this.beam.visible = false; if (a.endPt) { this.explosion(a.endPt, a.endN, 0.7); g.camera.addTrauma(0.6); } }
    if (t >= END + 0.45) { this.act = null; this.noDash = false; this.beam.visible = false; this.orb.visible = false; for (const s of ['L', 'R']) this.cannonGrp[s].visible = false; }
  }
  beamDamage(o, d, L) {
    const g = this.g;
    for (const h of g.world.hittables) {
      if (h.dead) continue; const c = _v.copy(h.root.position); c.y += 1.2; const rel = _v2.copy(c).sub(o); const t = clamp(rel.dot(d), 0, L); const cp = _v3.copy(o).addScaledVector(d, t);
      if (cp.distanceTo(c) > 2.1) continue; const dir = new THREE.Vector3(d.x, 0, d.z).normalize(); const pt = c.clone();
      h.applyHit(pt, dir, 7); if (h.knock) h.knock(dir, 1.2); if (h.launch && Math.random() < 0.25) h.launch(4); g.hud.hit(pt, 7, h); this.stats.hits++;
      for (let i = 0; i < 3; i++) g.fx.glow.emit({ pos: pt, vel: _v2.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(6), size: 0.5, life: 0.3, color: [0.6, 1, 0.85] });
    }
  }
  explosion(pt, n, k) {
    const g = this.g, fx = g.fx, P = pt.clone();
    fx.surface.ring(P, n, 13 * k, 0.65); fx.surface.ring(P.clone().addScaledVector(n, 0.05), n, 8 * k, 0.45); fx.surface.decal(P, n, 6.5 * k);
    for (let i = 0; i < 55 * k; i++) fx.shards.emit({ pos: P, vel: _v.set(rand(-1, 1), rand(0.1, 1.2), rand(-1, 1)).normalize().multiplyScalar(rand(6, 20)).addScaledVector(n, rand(2, 6)), size: rand(0.15, 0.5), life: rand(1, 1.8), grav: 1 });
    for (let i = 0; i < 40 * k; i++) fx.glow.emit({ pos: P, vel: _v.set(rand(-1, 1), rand(-0.2, 1.2), rand(-1, 1)).normalize().multiplyScalar(rand(6, 18)), size: rand(0.5, 1.4), life: rand(0.3, 0.7), drag: 2.2, color: [0.45, 1, 0.75] });
    fx.glow.emit({ pos: P, size: 14 * k, life: 0.18, drag: 0, color: [0.9, 1, 0.95] });
    for (let i = 0; i < 18 * k; i++) fx.dust.emit({ pos: P, vel: _v.set(rand(-1, 1), rand(0, 0.6), rand(-1, 1)).normalize().multiplyScalar(rand(4, 12)), size: rand(1.5, 3), grow: 3, life: rand(0.8, 1.4), drag: 2, color: [0.6, 0.6, 0.58], alpha: 0.6 });
    for (const h of g.world.hittables) {
      if (h.dead) continue; const hp = h.root.position, dx = hp.x - P.x, dz = hp.z - P.z, d = Math.hypot(dx, dz, hp.y - P.y); if (d > 10 * k) continue;
      const dir = new THREE.Vector3(dx, 0, dz); if (dir.lengthSq() < 0.01) dir.copy(this.flatAim()); dir.normalize(); const dm = Math.round(45 * k * (1 - d / (11 * k)) + 10);
      const pt = hp.clone(); pt.y += 1.2; h.applyHit(pt, dir, dm); if (h.knock) h.knock(dir, 14 * k); if (h.launch) h.launch(12 * k); g.hud.hit(pt, dm, h); this.stats.hits++;
    }
  }

  // ------------------------------------------------------------------------------------------ per-frame
  update(dt, aimPoint) {
    const L = this.layer; for (const k of Object.keys(this.cd)) this.cd[k] = Math.max(0, this.cd[k] - dt);
    this.comboWin = Math.max(0, this.comboWin - dt); if (!this.act && this.comboWin <= 0) this.comboIdx = 0;
    // shield regenerates while down
    if (!(this.act && this.act.kind === 'shield')) { this.sh.hp = Math.min(this.sh.max, this.sh.hp + 45 * dt); if (this.sh.broken && this.cd.f <= 0) { this.sh.broken = false; this.sh.hp = this.sh.max * 0.6; } this.sh.amt = damp(this.sh.amt, 0, 14, dt); this.updateShieldMesh(dt); }
    for (const k of ['L', 'R']) { for (const [name, grp] of [['blade', this.blade], ['gaunt', this.gaunt]]) { const key = name + k, o = grp[k]; this.toolAmt[key] = this.act && this.act.kind === 'melee' ? this.toolAmt[key] : damp(this.toolAmt[key], 0, 14, dt); const u = easeOutBack(clamp(this.toolAmt[key], 0, 1)); o.grp.visible = this.toolAmt[key] > 0.01; if (name === 'blade') { o.grp.children[0].scale.set(0.85 * Math.max(0.001, u), 0.85 * Math.max(0.001, u), Math.max(0.001, u)); for (let i = 1; i < 3; i++) o.grp.children[i].scale.setScalar(Math.max(0.001, u)); } else o.grp.scale.setScalar(Math.max(0.001, u)); } }
    for (const m of this.arcs) { if (!m.visible) continue; const u = m.userData; u.t += dt; const k = u.t / u.dur; if (k >= 1) { m.visible = false; continue; } m.scale.setScalar(u.size * (0.5 + 0.7 * easeOutCubic(k))); m.material.opacity = 0.9 * (1 - k) * (1 - k); }
    for (let i = this.timers.length - 1; i >= 0; i--) { const tm = this.timers[i]; tm.t -= dt; if (tm.t <= 0) { this.timers.splice(i, 1); tm.fn(); } }
    this.updateSpikeMeshes(dt); this.updateConstructs(dt);
    let out = null;
    const a = this.act;
    if (a) {
      a.t += dt; L.rot = L.rot || {}; L.spinY = 0;
      if (a.kind === 'melee') this.updateMelee(dt, a); else if (a.kind === 'shield') this.updateShield(dt, a); else if (a.kind === 'spikes') this.updateSpikes(dt, a);
      else if (a.kind === 'build') this.updateBuild(dt, a); else if (a.kind === 'cannon') this.updateCannon(dt, a, aimPoint);
      out = this.act || a.kind === 'melee' ? L : L; if (!this.act && L.w > 0.001) L.w = Math.max(0, L.w - dt * 6);
    } else if (L.w > 0.001) { L.w = Math.max(0, L.w - dt * 7); L.spinY = 0; out = L; }
    return out && L.w > 0.001 ? L : null;
  }
}

const SPIKE_KEYS = [
  { t: 0, p: { chest: [0.05, 0, 0], uarmL: [-0.4, 0, 0.3], uarmR: [-0.4, 0, -0.3], farmL: [-0.5, 0, 0], farmR: [-0.5, 0, 0] } },
  { t: 0.3, p: { hips: [-0.1, 0, 0], spine: [-0.2, 0, 0], chest: [-0.35, 0, 0], head: [0.2, 0, 0], uarmL: [-2.85, 0, 0.25], uarmR: [-2.85, 0, -0.25], farmL: [-0.05, 0, 0], farmR: [-0.05, 0, 0], handL: [0, 0, 0], handR: [0, 0, 0], thighL: [-0.15, 0, 0.12], thighR: [-0.15, 0, -0.12], shinL: [0.2, 0, 0], shinR: [0.2, 0, 0] } },
  { t: 0.46, p: { hips: [0.35, 0, 0], spine: [0.55, 0, 0], chest: [0.55, 0, 0], head: [-0.3, 0, 0], uarmL: [-0.35, 0, 0.12], uarmR: [-0.35, 0, -0.12], farmL: [-0.2, 0, 0], farmR: [-0.2, 0, 0], thighL: [-0.85, 0, 0.3], thighR: [-0.85, 0, -0.3], shinL: [1.3, 0, 0], shinR: [1.3, 0, 0] } },
  { t: 0.7, p: { hips: [0.35, 0, 0], spine: [0.55, 0, 0], chest: [0.55, 0, 0], uarmL: [-0.35, 0, 0.12], uarmR: [-0.35, 0, -0.12], thighL: [-0.85, 0, 0.3], thighR: [-0.85, 0, -0.3], shinL: [1.3, 0, 0], shinR: [1.3, 0, 0] } },
  { t: 1.05, p: { hips: [0.05, 0, 0], spine: [0.05, 0, 0], chest: [0.1, 0, 0], uarmL: [-0.2, 0, 0.2], uarmR: [-0.2, 0, -0.2], farmL: [-0.4, 0, 0], farmR: [-0.4, 0, 0], thighL: [-0.2, 0, 0.1], thighR: [-0.2, 0, -0.1], shinL: [0.3, 0, 0], shinR: [0.3, 0, 0] } },
];
const BUILD_FWD = [
  { t: 0, p: { chest: [0.1, 0, 0], uarmL: [-0.4, 0, 0.3], uarmR: [-0.4, 0, -0.3] } },
  { t: 0.22, p: { hips: [0.15, 0, 0], spine: [0.35, 0, 0], chest: [0.3, 0, 0], head: [-0.15, 0, 0], uarmL: [-1.2, 0, 0.1], uarmR: [-1.2, 0, -0.1], farmL: [-0.15, 0, 0], farmR: [-0.15, 0, 0], thighL: [-0.4, 0, 0.15], thighR: [-0.4, 0, -0.15], shinL: [0.6, 0, 0], shinR: [0.6, 0, 0] } },
  { t: 0.62, p: { hips: [0.1, 0, 0], spine: [0.2, 0, 0], chest: [0.2, 0, 0], uarmL: [-1.0, 0, 0.15], uarmR: [-1.0, 0, -0.15], thighL: [-0.3, 0, 0.1], thighR: [-0.3, 0, -0.1], shinL: [0.45, 0, 0], shinR: [0.45, 0, 0] } },
];
const BUILD_DOWN = [
  { t: 0, p: { chest: [0.1, 0, 0], uarmL: [-0.2, 0, 0.3], uarmR: [-0.2, 0, -0.3] } },
  { t: 0.22, p: { hips: [0.3, 0, 0], spine: [0.55, 0, 0], chest: [0.45, 0, 0], head: [-0.3, 0, 0], uarmL: [-0.15, 0, 0.35], uarmR: [-0.15, 0, -0.35], farmL: [-0.3, 0, 0], farmR: [-0.3, 0, 0], thighL: [-0.85, 0, 0.25], thighR: [-0.85, 0, -0.25], shinL: [1.3, 0, 0], shinR: [1.3, 0, 0] } },
  { t: 0.62, p: { hips: [0.2, 0, 0], spine: [0.4, 0, 0], chest: [0.35, 0, 0], uarmL: [-0.1, 0, 0.35], uarmR: [-0.1, 0, -0.35], thighL: [-0.6, 0, 0.2], thighR: [-0.6, 0, -0.2], shinL: [0.9, 0, 0], shinR: [0.9, 0, 0] } },
];
const CANNON_CHARGE = [
  { t: 0, p: { chest: [0.05, 0, 0], uarmL: [-0.2, 0, 0.9], uarmR: [-0.2, 0, -0.9], farmL: [-0.4, 0, 0], farmR: [-0.4, 0, 0] } },
  { t: 0.3, p: { hips: [0.05, 0, 0], spine: [-0.12, 0, 0], chest: [-0.2, 0, 0], head: [0.1, 0, 0], uarmL: [-0.5, 0, 1.15], uarmR: [-0.5, 0, -1.15], farmL: [-0.6, 0, 0], farmR: [-0.6, 0, 0], thighL: [-0.3, 0, 0.3], thighR: [-0.3, 0, -0.3], shinL: [0.55, 0, 0], shinR: [0.55, 0, 0] } },
  { t: 0.62, p: { hips: [0.05, 0, 0], spine: [-0.18, 0, 0], chest: [-0.25, 0, 0], uarmL: [-1.25, 0, 0.5], uarmR: [-1.25, 0, -0.5], farmL: [-0.8, 0, 0], farmR: [-0.8, 0, 0], thighL: [-0.4, 0, 0.32], thighR: [-0.4, 0, -0.32], shinL: [0.7, 0, 0], shinR: [0.7, 0, 0] } },
];
const CANNON_FIRE = [
  { t: 0, p: { hips: [0.12, 0, 0], spine: [0.1, 0, 0], chest: [0.12, 0, 0], head: [-0.1, 0, 0], thighL: [-0.55, 0, 0.3], thighR: [0.3, 0, -0.3], shinL: [0.8, 0, 0], shinR: [0.5, 0, 0] } },
  { t: 0.2, p: { hips: [0.2, 0, 0], spine: [0.22, 0, 0], chest: [0.28, 0, 0], head: [-0.2, 0, 0], thighL: [-0.6, 0, 0.3], thighR: [0.4, 0, -0.3], shinL: [0.85, 0, 0], shinR: [0.6, 0, 0] } },
];
