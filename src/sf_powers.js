// Stinkfly's abilities: Slime Projectile (LMB), Claw Attack (Q), Tail Strike (E). Flight / takeoff / landing live in stinkfly.js.
//  - Slime: a real projectile, pooled (SHOT_MAX blobs). It leaves the actual tips of the model's eyestalks (found from the skin weights), the eyestalks are IK-aimed at the crosshair target first.
//    It flies on a slight arc and collides with: living targets (their hit spheres), every solid (walls, roofs, crates, cars, rocks, props) and the ground. Targets get SLOWED / RESTRICTED / TRAPPED through
//    src/slime.js; surfaces get a splat that stays on them for a while (and rides with a moving prop).
//  - Claw: the real claw tips (hand bone + the tip found from its skin weights) are the contact points, alternating arms, works in the air.
//  - Tail strike: the real stinger tip is the contact point; physical only (no poison, no energy).
//  - Both melee attacks turn him toward the target and step (or glide, in the air) the last bit of the way so the contact is real; knockback is small.
import * as THREE from 'three';
import { V, D, mkPose, layerS, EYES } from '../animations/stinkflyrig.js';
import { clamp, damp, lerp, angleDelta, rand, easeOutCubic } from './util.js';
import { SLIME } from './slime.js';
import { playerSegHit } from './kevin_fx.js';

const $ = id => document.getElementById(id);
const sin = Math.sin, cos = Math.cos;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3(), _f = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
export const SF_CD = { lmb: 0.2, q: 0.26, e: 0.85 };
export const SHOT_MAX = 26;
const sm = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const SHOT = { speed: 36, grav: 7, life: 1.9, r: 0.17, dmg: 5, amount: 0.6 };

export const sfPowers = {
  initPowers(game) {
    this.act = null; this.cd = { lmb: 0, q: 0, e: 0 }; this.cdMax = SF_CD; this.lmbHeld = false; this.clawIdx = 0; this.queued = null; this.volley = 0; this.hintT = 0;
    this.aimPt = new THREE.Vector3(0, 1, -20); this.hintEl = $('sfhint'); this.shots = [];
    this.pool = []; const geo = new THREE.SphereGeometry(1, 12, 9);
    this.shotMat = new THREE.MeshStandardMaterial({ color: 0x7be31a, emissive: 0x2f8a08, emissiveIntensity: 0.6, roughness: 0.12, metalness: 0, envMapIntensity: 1.6 });
    for (let i = 0; i < SHOT_MAX; i++) { const m = new THREE.Mesh(geo, this.shotMat); m.visible = false; m.castShadow = false; game.scene.add(m); this.pool.push(m); } this.poolN = 0;
    this.eyeLen = {}; this.tipsTmp = { L1: new THREE.Vector3(), L2: new THREE.Vector3(), R1: new THREE.Vector3(), R2: new THREE.Vector3() };
    this.stats.slimeShots = 0; this.stats.slimeHits = 0; this.stats.surfaceHits = 0; this.stats.claws = 0; this.stats.clawHits = 0; this.stats.tails = 0; this.stats.tailHits = 0; this.stats.flinches = 0;
    this.lastTip = { claw: new THREE.Vector3(), tail: new THREE.Vector3() };
  },

  // ============================================================================================== helpers
  canStart() { return !this.act && this.mode !== 'crouch' && this.mode !== 'landing'; },
  beginAct(kind, extra) {
    this.act = Object.assign({ kind, stage: 'start', t: 0, st: 0, speedMul: 0.7, flySpeedMul: 0.8, lockMove: false, moveVel: null, faceYaw: this.aimYaw(), faceK: 18, hit: new Set(), done: false }, extra); return this.act;
  },
  setStage(a, s, extra) { a.stage = s; a.st = 0; if (extra) Object.assign(a, extra); },
  endAct(cdKey = null, cd = 0) { const a = this.act; if (!a) return; if (cdKey) this.cd[cdKey] = cd || SF_CD[cdKey]; this.act = null; },
  /** everything Stinkfly started is stopped: attacks, held button, projectiles still in the air (the splats and the coats on enemies are world state and wear off by themselves) */
  cancelAll() {
    this.act = null; this.queued = null; this.lmbHeld = false; for (const s of this.shots) s.mesh.visible = false; this.shots.length = 0; if (this.hintEl) this.hintEl.hidden = true;
    for (const k of EYES) this.eyeAimW = 0;
  },
  toast(m) { this.g.hud.toast(m); },
  aimDirFrom(from, out) { out.copy(this.aimPt).sub(from); if (out.lengthSq() < 4) out.copy(this.g.camera.aimDir); return out.normalize(); },
  /** living things in front of him: nearest point of their hit spheres within maxD of the body centre, inside the cone (cosMin) around `yaw` */
  foes(maxD, cosMin = -1, yaw = this.aimYaw()) {
    const fx = sin(yaw), fz = cos(yaw), c = _a.set(this.pos.x, this.pos.y + 1.4, this.pos.z), res = [];
    for (const h of this.g.world.hittables) {
      if (h.dead || h.held || h.override || !h.spheres || !h.root) continue; let best = 1e9, bp = null;
      for (const s of h.spheres) { _b.copy(s.local); h.root.localToWorld(_b); const d = _b.distanceTo(c) - s.r; if (d < best) { best = d; bp = _c.copy(_b); } }
      if (best > maxD) continue; const dx = bp.x - c.x, dz = bp.z - c.z, L = Math.hypot(dx, dz), dot = L > 0.05 ? (dx * fx + dz * fz) / L : 1; if (dot < cosMin) continue;
      res.push({ h, d: best, dot, score: best - dot * 2.2, p: bp.clone() });
    } return res.sort((a, b) => a.score - b.score);
  },
  propOk(p) { return !p.dead && !p.held && !p.temp; },
  shoveProp(p, dir, k) {
    if (p.planted || p.held) return; const P = this.g.props; P.removeBox(p); p.state = 'fly'; const m = k / Math.sqrt(p.mass / 40 + 1);
    p.vel.x += dir.x * m; p.vel.z += dir.z * m; p.vel.y = Math.max(p.vel.y, Math.min(5, m * 0.25)); p.spin.set(rand(-3, 3), rand(-3, 3), rand(-3, 3)); p.hit.clear(); p.dmgMul = 0.5;
  },
  hurtFoe(h, pt, dir, dmg, kb) {
    const g = this.g; h.applyHit(pt, dir.clone(), dmg); if (h.shove && kb) h.shove(dir, kb); if (h.launch) h.launch(0.5); g.hud.hit(pt, Math.round(dmg), h); g.sfx.hit(false); this.stats.hits++;
  },
  /** the solid whose surface the point is on (a prop's box wins over scenery it stands next to) */
  boxAt(pt) { let best = null; for (const b of this.g.world.boxes) if (pt.x > b.min.x - 0.2 && pt.x < b.max.x + 0.2 && pt.y > b.min.y - 0.2 && pt.y < b.max.y + 0.2 && pt.z > b.min.z - 0.2 && pt.z < b.max.z + 0.2) { if (b.prop) return b; if (!best) best = b; } return best; },

  // ============================================================================================== input
  keyDown(code) { switch (code) { case 'KeyQ': return this.startClaw(); case 'KeyE': return this.startTail(); } },
  keyUp() {},
  mouseDown() { this.lmbHeld = true; this.startSlime(); },
  mouseUp() { this.lmbHeld = false; },

  // ============================================================================================== slime projectile (LMB)
  startSlime() {
    if (this.cd.lmb > 0 || this.mode === 'crouch' || this.mode === 'landing') return; const a = this.act;
    if (a) { if (a.kind === 'slime') return; if (a.kind === 'claw' && a.stage === 'recover') { this.queued = 'slime'; } return; }
    const a2 = this.beginAct('slime', { speedMul: 0.8, flySpeedMul: 0.9, faceK: 20 }); a2.stage = 'aim'; a2.dur = 0.11;
  },
  tickSlime(dt, a) {
    a.faceYaw = this.aimYaw();
    if (a.stage === 'aim') { if (a.st >= a.dur) { this.fireVolley(); this.setStage(a, 'recover'); } }
    else if (a.stage === 'recover') { if (a.st >= 0.2) { this.endAct('lmb', SF_CD.lmb); if (this.lmbHeld) this.startSlime(); } }
  },
  /** one blob from the next eyestalk in turn, toward the crosshair target (each blob is one "hit": 1 slows, 2 restrict, 3 may trap) */
  fireVolley() {
    const g = this.g, pair = [EYES[this.volley++ % 4]]; this.stats.slimeShots++;          // one blob per shot, from each of the four eyestalks in turn (L1, L2, R1, R2)
    for (const k of pair) {
      this.poser.eyeTip(k, _a); this.aimDirFrom(_a, _b); { const tt = Math.min(_a.distanceTo(this.aimPt), 70) / SHOT.speed; _b.y += 0.5 * SHOT.grav * tt / SHOT.speed; _b.normalize(); }   // aim a little above the target: the blob arcs down onto it
      _b.x += rand(-0.012, 0.012); _b.y += rand(-0.008, 0.012); _b.z += rand(-0.012, 0.012); _b.normalize();
      this.spawnShot(_a, _b);
      for (let i = 0; i < 4; i++) g.fx.dust.emit({ pos: _a, vel: _c.copy(_b).multiplyScalar(rand(2, 6)).add(_d.set(rand(-1, 1), rand(-0.3, 1), rand(-1, 1))), size: rand(0.08, 0.16), life: rand(0.3, 0.5), drag: 2, grav: 5, color: [0.4, 0.88, 0.1], alpha: 0.95 });
    }
    g.sfx.squelch && g.sfx.squelch(0.2); g.camera.addTrauma(0.02);
    this.slimeKick = 1;
  },
  /** owner (optional): an AI enemy (Kevin) firing the SAME blob. imp = attackImpact() bag for the player it lands on */
  spawnShot(origin, dir, owner = null, imp = null, speedMul = 1) {
    const m = this.pool[this.poolN]; this.poolN = (this.poolN + 1) % this.pool.length;
    const old = this.shots.findIndex(s => s.mesh === m); if (old >= 0) this.shots.splice(old, 1);          // pool exhausted: the oldest blob is recycled
    const s = { mesh: m, pos: origin.clone(), prev: origin.clone(), vel: dir.clone().multiplyScalar(SHOT.speed * speedMul), life: SHOT.life * (owner ? 1.5 : 1), age: 0, r: owner ? SHOT.r * 2.1 : SHOT.r, trail: 0, wob: Math.random() * 6, owner, imp };
    m.visible = true; m.position.copy(s.pos); this.shots.push(s);
  },
  /** own = false: the player's blobs (player time); own = true: blobs fired by an AI owner, run in WORLD time every frame */
  updateShots(dt0, own = false) {
    const g = this.g, w = g.world, lg = g.lagoon;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      if (!!this.shots[i].owner !== own) continue;
      const s = this.shots[i], dt = own ? (g.kdt ?? dt0) : dt0; s.life -= dt; s.age += dt; if (s.life <= 0) { this.killShot(i, null); continue; }
      const sub = clamp(Math.ceil(s.vel.length() * dt / 0.6), 1, 8), h = dt / sub; let done = false;
      for (let k = 0; k < sub && !done; k++) {
        s.prev.copy(s.pos); s.pos.addScaledVector(s.vel, h); s.vel.y -= SHOT.grav * h; const seg = _b.copy(s.pos).sub(s.prev), len = seg.length(); if (len < 1e-6) continue; const dir = _c.copy(seg).multiplyScalar(1 / len);
        let tHit = Infinity, kind = null, target = null, normal = null;
        const sh = w.raySolid(s.prev, dir, len, true); if (sh) { tHit = sh.t; kind = 'solid'; normal = sh.normal; }
        for (const hh of w.hittables) {
          if (hh.dead || hh.held || !hh.spheres || (s.owner && hh === s.owner)) continue;
          for (const sp of hh.spheres) { _d.copy(sp.local); hh.root.localToWorld(_d); _e.copy(_d).sub(s.prev); const tt = clamp(_e.dot(dir), 0, len); if (_e.addScaledVector(dir, -tt).length() < sp.r + s.r * 0.8 && tt < tHit) { tHit = tt; kind = 'foe'; target = hh; } }
        }
        if (s.owner) { const pp = playerSegHit(g, s.prev, s.pos, s.r * 0.8); if (pp && pp.t * len < tHit) { tHit = pp.t * len; kind = 'player'; } }
        const gy = w.groundAt(s.pos.x, s.pos.z, s.pos.y + 0.5, 0.6, 0.05);
        if (!kind && s.pos.y < gy) { kind = 'ground'; tHit = clamp((s.prev.y - gy) / Math.max(1e-6, s.prev.y - s.pos.y), 0, 1) * len; normal = UP; }
        if (!kind && lg && lg.inRect(s.pos.x, s.pos.z) && s.pos.y < lg.waterY) { kind = 'water'; tHit = len; normal = UP; }
        if (kind) { const pt = s.prev.clone().addScaledVector(dir, Math.min(tHit, len)); this.shotHit(s, kind, pt, dir.clone(), normal, target); this.killShot(i, null); done = true; }
      }
      if (done) continue;
      // blob shape: stretched along its travel, a little wobble, a few droplets shaken off
      const sp3 = s.vel.length(), st = 1 + clamp(sp3 / 60, 0, 1) * 1.1, wob = 1 + 0.08 * sin(s.age * 40 + s.wob);
      s.mesh.position.copy(s.pos); s.mesh.scale.set(s.r * wob, s.r * wob, s.r * st); _d.copy(s.pos).add(s.vel); s.mesh.lookAt(_d);
      s.trail -= dt; if (s.trail <= 0) { s.trail = 0.028; g.fx.dust.emit({ pos: s.pos, vel: _d.set(rand(-0.5, 0.5), rand(-0.2, 0.4), rand(-0.5, 0.5)), size: rand(0.06, 0.11), life: rand(0.3, 0.5), drag: 1.5, grav: 8, color: [0.4, 0.86, 0.1], alpha: 0.9 }); }
    }
  },
  killShot(i, _) { const s = this.shots[i]; s.mesh.visible = false; this.shots.splice(i, 1); },
  shotHit(s, kind, pt, dir, normal, target) {
    const g = this.g, P = g.props, SL = g.slime; this.stats.slimeHits++; g.sfx.squelch && g.sfx.squelch(0.28);
    const splash = (n, up = 3.5) => { for (let i = 0; i < 12; i++) g.fx.dust.emit({ pos: pt, vel: _a.set(rand(-1, 1), rand(0.1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(1.5, up)).addScaledVector(n || UP, rand(0.5, 2.5)), size: rand(0.07, 0.17), life: rand(0.4, 0.8), drag: 1.2, grav: 9, color: [0.4, 0.88, 0.1], alpha: 0.95 }); };
    if (kind === 'player') {                       // the SAME slime status as on any target: SLOWED -> RESTRICTED -> TRAPPED, wears off by itself (src/slime.js)
      const gt = g.gooTarget(), d2 = dir.clone().setY(0).normalize(), was = SL.state(gt), res = g.impact.hitPlayer(Object.assign({}, s.imp, { dir: d2, point: pt.clone(), src: s.owner, fx: false }));
      if (!(res && (res.passed || res.dodged))) { const st = SL.hit(gt, SHOT.amount); g.impact.stick(); g.hud.tag(pt, 'STUCK'); if (s.owner.onPlayerHit) s.owner.onPlayerHit('goo', res); }
      splash(d2.clone().negate()); g.camera.addTrauma(0.05); return;
    }
    if (kind === 'foe') {
      const d2 = dir.clone().setY(0); if (d2.lengthSq() < 1e-4) d2.copy(dir); d2.normalize(); const was = SL.state(target);
      target.applyHit(pt, d2, SHOT.dmg); g.hud.hit(pt, SHOT.dmg, target); this.stats.hits++;
      const st = SL.hit(target, SHOT.amount); splash(d2.clone().negate());
      if (st && st !== 'COATED' && st !== was) { g.hud.tag(pt, st); this.say(target.name ? target.name + ' — ' + st : st, 1.1); } else if (st === 'COATED') g.hud.tag(pt, 'SLIME');
      g.camera.addTrauma(0.04); return;
    }
    if (kind === 'water') { for (let i = 0; i < 6; i++) g.fx.dust.emit({ pos: pt, vel: _a.set(rand(-1, 1), rand(1, 3), rand(-1, 1)), size: rand(0.08, 0.16), life: 0.6, drag: 1, grav: 9, color: [0.6, 0.85, 0.8], alpha: 0.7 }); return; }
    // a surface: ground / wall / roof / prop. The splat is stuck to it (and to the prop, which then resists sliding).
    const b = kind === 'solid' ? (this.boxAt(_b.copy(pt).addScaledVector(dir, 0.12)) || this.boxAt(pt)) : null, prop = b && b.prop ? b.prop : null, n = (normal || UP).clone();
    SL.decal(pt, n, rand(0.8, 1.35), prop); this.stats.surfaceHits++; splash(n, 2.6);
    if (prop) { SL.stickProp(prop); }
  },
  say(msg, t = 1.2) { this.hintTxt = msg; this.hintT = t; },

  // ============================================================================================== claw attack (Q)
  startClaw() {
    const a = this.act; if (this.mode === 'crouch' || this.mode === 'landing') return;
    if (a && a.kind === 'claw') { if (a.stage !== 'windup') this.queued = 'claw'; return; }
    if (a && a.kind === 'tail' && a.stage === 'recover') { this.queued = 'claw'; return; }
    if (a || this.cd.q > 0) return;
    const side = this.clawIdx++ % 2 === 0 ? 'L' : 'R'; this.stats.claws++;
    const tg = this.foes(3.3, 0.0)[0], a2 = this.beginAct('claw', { speedMul: 0.55, flySpeedMul: 0.65, side, faceK: 24 });
    a2.stage = 'windup'; a2.tgt = tg ? tg.h : null; if (tg) a2.faceYaw = Math.atan2(tg.p.x - this.pos.x, tg.p.z - this.pos.z); this.g.sfx.whoosh && this.g.sfx.whoosh();
  },
  tickClaw(dt, a) {
    if (a.tgt && !a.tgt.dead) { const hp = a.tgt.root.position; a.faceYaw = Math.atan2(hp.x - this.pos.x, hp.z - this.pos.z); }
    if (a.stage === 'windup') { if (a.st >= 0.11) { this.setStage(a, 'strike'); this.lungeFor(a, 0.85, 0.13, 9); } }
    else if (a.stage === 'strike') {
      this.contact(a, this.poser.clawTip(a.side, this.lastTip.claw), 0.75, 24, 7, 'claw', 0.4);
      if (a.st >= 0.13) this.setStage(a, 'recover', { moveVel: null });
    } else if (a.stage === 'recover') {
      if (a.st >= 0.2) { const q = this.queued; this.queued = null; this.endAct('q', SF_CD.q); if (q === 'claw') this.startClaw(); else if (q === 'slime') this.startSlime(); else if (q === 'tail') this.startTail(); }
    }
  },
  /** step / glide toward the target so the strike actually connects: stop short of its surface by `stop` metres */
  lungeFor(a, stop, dur, cap) {
    const tg = a.tgt && !a.tgt.dead ? a.tgt : null; if (!tg) { a.moveVel = null; return; }
    const c = _a.set(this.pos.x, this.pos.y + 1.4, this.pos.z); let best = 1e9, bp = _b; for (const s of tg.spheres) { _c.copy(s.local); tg.root.localToWorld(_c); const d = _c.distanceTo(c) - s.r; if (d < best) { best = d; bp.copy(_c); } }
    const to = _d.copy(bp).sub(c); const L = to.length(); if (L < 1e-3) { a.moveVel = null; return; }
    const travel = Math.max(0, best - stop); if (travel < 0.05) { a.moveVel = null; return; }
    const sp = Math.min(cap, travel / dur); to.multiplyScalar(1 / L); a.moveVel = new THREE.Vector3(to.x * sp, this.flying ? to.y * sp : 0, to.z * sp);
  },
  /** one contact test per frame during the strike window: the real tip (a sphere of radius r) against every living target / weak prop not yet hit by this attack */
  contact(a, tip, r, dmg, kb, kind, propK) {
    const g = this.g; let n = 0;
    for (const h of g.world.hittables) {
      if (h.dead || h.held || a.hit.has(h) || !h.spheres || !h.root) continue;
      for (const s of h.spheres) {
        _b.copy(s.local); h.root.localToWorld(_b); if (_b.distanceTo(tip) < s.r + r) {
          a.hit.add(h); const dir = _c.copy(_b).sub(this.pos).setY(0); if (dir.lengthSq() < 1e-4) dir.set(sin(this.yaw), 0, cos(this.yaw)); dir.normalize();
          this.hurtFoe(h, tip.clone(), dir, dmg, kb); n++; this.stats[kind === 'claw' ? 'clawHits' : 'tailHits']++; g.camera.addTrauma(0.1); this.impactFX(tip, 0.7); break;
        }
      }
    }
    for (const p of g.props.props) {
      if (!this.propOk(p) || a.hit.has(p)) continue; const dx = clamp(tip.x, p.pos.x - p.half.x, p.pos.x + p.half.x) - tip.x, dz = clamp(tip.z, p.pos.z - p.half.z, p.pos.z + p.half.z) - tip.z, dy = clamp(tip.y, p.pos.y, p.pos.y + p.size.h) - tip.y;
      if (dx * dx + dz * dz + dy * dy < r * r) { a.hit.add(p); const dir = _c.set(p.pos.x - this.pos.x, 0, p.pos.z - this.pos.z).normalize().clone(); this.shoveProp(p, dir, 5 * propK); g.props.impactFX(tip, 0.5, p.debris); g.props.hurt(p, kind === 'tail' ? 22 : 14, dir); n++; g.sfx.hit(false); }
    }
    return n;
  },
  impactFX(pt, k) { const g = this.g; for (let i = 0; i < 6; i++) g.fx.glow.emit({ pos: pt, vel: _a.set(rand(-1, 1), rand(0, 1), rand(-1, 1)).normalize().multiplyScalar(rand(2, 5)), size: rand(0.1, 0.22) * k, life: 0.22, drag: 2, color: [0.95, 0.95, 0.8] }); },

  // ============================================================================================== tail strike (E)
  startTail() {
    const a = this.act; if (this.mode === 'crouch' || this.mode === 'landing') return;
    if (a) { if (a.kind === 'claw' && a.stage === 'recover') this.queued = 'tail'; return; } if (this.cd.e > 0) return;
    const tg = this.foes(3.6, -0.2)[0], a2 = this.beginAct('tail', { speedMul: 0.4, flySpeedMul: 0.5, faceK: 22 }); a2.stage = 'windup'; a2.tgt = tg ? tg.h : null; this.stats.tails++;
    if (tg) a2.faceYaw = Math.atan2(tg.p.x - this.pos.x, tg.p.z - this.pos.z); this.g.sfx.servo && this.g.sfx.servo(0.12);
  },
  tickTail(dt, a) {
    if (a.tgt && !a.tgt.dead) { const hp = a.tgt.root.position; a.faceYaw = Math.atan2(hp.x - this.pos.x, hp.z - this.pos.z); }
    if (a.stage === 'windup') { if (a.st >= 0.24) { this.setStage(a, 'strike'); this.lungeFor(a, 0.55, 0.17, 10); this.g.sfx.whoosh && this.g.sfx.whoosh(); } }
    else if (a.stage === 'strike') {
      this.contact(a, this.poser.tailTip(this.lastTip.tail), 0.9, 34, 8, 'tail', 0.6);
      if (a.st >= 0.17) this.setStage(a, 'recover', { moveVel: null });
    } else if (a.stage === 'recover') {
      if (a.st >= 0.34) { const q = this.queued; this.queued = null; this.endAct('e', SF_CD.e); if (q === 'claw') this.startClaw(); else if (q === 'slime') this.startSlime(); }
    }
  },

  // ============================================================================================== per frame
  updatePowers(dt, aimPoint) {
    this.aimPt.copy(aimPoint); for (const k in this.cd) this.cd[k] = Math.max(0, this.cd[k] - dt); this.hintT = Math.max(0, this.hintT - dt); this.slimeKick = Math.max(0, (this.slimeKick || 0) - dt * 6);
    const a = this.act; if (a) { a.t += dt; a.st += dt; if (a.kind === 'slime') this.tickSlime(dt, a); else if (a.kind === 'claw') this.tickClaw(dt, a); else if (a.kind === 'tail') this.tickTail(dt, a); }
    else if (this.lmbHeld && this.cd.lmb <= 0) this.startSlime();
    this.updateShots(dt);
    if (this.hintEl) { const on = this.hintT > 0 && this.g.player === this; if (this.hintEl.hidden === on) this.hintEl.hidden = !on; if (on && this.hintEl.textContent !== this.hintTxt) this.hintEl.textContent = this.hintTxt; }
  },

  // ============================================================================================== poses of the attacks (layers over the locomotion pose)
  actLayer(dt) {
    const a = this.act; if (!a) return null; const t = a.st, L = { d: {}, arms: {}, eyes: {}, legs: {}, curl: {}, w: 1 }, A = this.an;
    if (a.kind === 'slime') {
      // eyestalks swing out and point at the target; the head dips toward it; a small recoil as the blobs leave
      const w = a.stage === 'aim' ? sm(t / a.dur) : 1 - sm(t / 0.2) * 0.9, kick = this.slimeKick || 0;
      L.w = Math.max(w, 0); this.eyeAimW = L.w;
      L.d.head = D(0.12 * w - 0.06 * kick, 0, 0); L.d.neck = D(0.08 * w, 0, 0); L.d.jaw = D(0.18 * w, 0, 0); L.d.spine = D(-0.06 * kick, 0, 0); L.d.chest = D(-0.05 * kick, 0, 0);
      return L;
    }
    const s = a.side === 'L' ? 1 : -1;
    if (a.kind === 'claw') {
      const wind = a.stage === 'windup' ? sm(t / 0.11) : 1, str = a.stage === 'strike' ? easeOutCubic(t / 0.13) : a.stage === 'recover' ? 1 : 0, rec = a.stage === 'recover' ? sm(t / 0.2) : 0;
      // arm target (body frame, relative to the shoulder): raised + back -> across the body toward the target -> back to guard
      const wp = V(s * 0.7, 0.55, 0.0); let mid = V(s * 0.1, 0.1, 0.95), en = V(-s * 0.6, -0.35, 0.9);
      // the sweep passes through the target (nearest of its hit spheres, body frame, from this shoulder) so the claw connects at any height - flying low over a dummy, or up at a tall one
      if (a.tgt && !a.tgt.dead && a.tgt.spheres && a.tgt.root) {
        const sh = this.rig.modelGroup.localToWorld(this.shoulderRest[a.side].clone()); let best = 1e9, bp = null;
        for (const sp of a.tgt.spheres) { _d.copy(sp.local); a.tgt.root.localToWorld(_d); const dd = _d.distanceTo(sh); if (dd < best) { best = dd; bp = _e.copy(_d); } }
        if (bp) { const rel = bp.clone().sub(sh), L = rel.length(); if (L > 1.1) rel.multiplyScalar(1.1 / L); rel.applyQuaternion(this.tiltG.getWorldQuaternion(new THREE.Quaternion()).invert());
          en = V(rel.x - s * 0.55, rel.y - 0.2, rel.z + 0.1); mid = V(2 * rel.x - 0.5 * (wp.x + en.x), 2 * rel.y - 0.5 * (wp.y + en.y), 2 * rel.z - 0.5 * (wp.z + en.z)); }
      }
      const q = a.stage === 'windup' ? wp.clone().multiplyScalar(wind) : a.stage === 'strike' ? bez(wp, mid, en, str) : bez(wp, mid, en, 1).lerp(V(s * 0.35, -0.4, 0.5), rec);
      L.armOff = { [a.side]: q, [a.side === 'L' ? 'R' : 'L']: V(-s * 0.2, -0.3, 0.55) };
      const tw = a.stage === 'windup' ? -wind * 0.32 : a.stage === 'strike' ? -0.32 + str * 0.78 : 0.46 * (1 - rec);
      L.d.chest = D(0.1 * (wind - rec), s * tw, 0); L.d.spine = D(0.08 * (wind - rec), s * tw * 0.6, 0); L.d.head = D(0, -s * tw * 0.5, 0); L.curl = { [a.side]: a.stage === 'strike' ? 0.0 : 0.65 };
      L.w = a.stage === 'recover' ? 1 - rec * 0.6 : 1; return L;
    }
    // tail strike: the stinger coils up behind, whips forward over the back, springs back. The body bows into it.
    const wd = a.stage === 'windup' ? sm(t / 0.24) : 1, sk = a.stage === 'strike' ? easeOutCubic(t / 0.17) : a.stage === 'recover' ? 1 : 0, rc = a.stage === 'recover' ? sm(t / 0.34) : 0;
    const t0 = lerp(lerp(0, 0.95, wd), 2.5, sk) * (1 - rc), t1 = lerp(lerp(0, 0.55, wd), 0.85, sk) * (1 - rc), t2 = lerp(lerp(0, 0.5, wd), 0.55, sk) * (1 - rc);
    L.d.tail0 = D(t0, 0.12 * sin(t * 30) * (1 - sk) * wd, 0); L.d.tail1 = D(t1, 0, 0); L.d.tail2 = D(t2, 0, 0);
    const bow = (a.stage === 'windup' ? -0.18 * wd : 0.55 * sk) * (1 - rc); L.d.hips = D(-bow * 0.8, 0, 0); L.d.spine = D(bow * 0.7, 0, 0); L.d.chest = D(bow * 0.6, 0, 0); L.d.head = D(-0.1 * sk, 0, 0);
    L.armOff = { L: V(0.55, -0.55 + 0.5 * sk, 0.2 + 0.4 * sk), R: V(-0.55, -0.55 + 0.5 * sk, 0.2 + 0.4 * sk) };
    L.w = 1; return L;
  },

  // ============================================================================================== damage taken
  onHit(dmg, pt, dir) {
    const g = this.g; g.hud.hurt(); g.camera.addTrauma(0.3); this.hp = Math.max(0, this.hp - dmg); this.hpT = 4; this.stats.flinches++;
    this.an.flinch = 1; if (dir) { this.an.flinchDir.set(dir.x, 0, dir.z); }
    if (this.hp <= 0) { this.hp = this.cfg.hp * 0.6; g.hud.toast('SECOND WIND'); }
    for (const m of this.rig.bodyMats) { m.emissive.setRGB(0.6, 0.12, 0.08); } this.flashT = 0.16;
  },
  knock(dir, v) { this.vel.x += dir.x * v * 0.6; this.vel.z += dir.z * v * 0.6; },

  // ============================================================================================== HUD
  hudUpdate() {
    const a = this.act ? this.act.kind : '', I = this.input || {}, set = (k, on, cd = 0, mx = 1) => { const e = $('sfslot-' + k); if (e) e.classList.toggle('active', !!on); const c = $('sfcd-' + k); if (c) c.style.width = (cd > 0 ? cd / mx * 100 : 0) + '%'; };
    set('lmb', a === 'slime', this.cd.lmb, SF_CD.lmb); set('q', a === 'claw', this.cd.q, SF_CD.q); set('e', a === 'tail', this.cd.e, SF_CD.e); set('sh', I.run, 0, 1); set('sp', I.jumpHeld, 0, 1); set('ct', I.down && this.flying, 0, 1);
    const hp = $('sf-hp'); if (hp) hp.style.width = (this.hp / this.cfg.hp * 100) + '%';
    const f = $('sf-flight'); if (f) { const on = this.flightActive, t = on ? 'FLIGHT: ACTIVE' : 'FLIGHT: INACTIVE'; if (f.textContent !== t) f.textContent = t; f.dataset.on = on ? '1' : '0'; }
  },
};
const _bz = new THREE.Vector3();
function bez(p0, p1, p2, u) { const k = 1 - u; return _bz.set(k * k * p0.x + 2 * k * u * p1.x + u * u * p2.x, k * k * p0.y + 2 * k * u * p1.y + u * u * p2.y, k * k * p0.z + 2 * k * u * p1.z + u * u * p2.z).clone(); }
export { SHOT };
