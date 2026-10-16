// Wildmutt's physical attacks and senses: Bite (LMB), Claw Swipe (F), Pounce (R), tearing apart weak objects, Tracking Sense (Q), climb / interact (E).
// Every hit is a real contact test (jaw point / claw sphere / body sphere against the enemy's capsule or the prop's box) - nothing damages from a distance, nothing homes.
import * as THREE from 'three';
import { clamp, damp, lerp, rand, angleDelta, smoothstep } from './util.js';
import { V, D, mkPose, sm, pawF, pawN } from './wildmutt.js';

const $ = id => document.getElementById(id);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
export const WM_CD = { lmb: 0.6, f: 0.08, r: 3.4, e: 0.4, q: 0.35 };
/** what Wildmutt can actually damage: material + how much of his damage the material takes. Anything not listed (concrete walls, rocks, trees, lamp posts, barriers) is immune. */
const MAT = { crate: ['wood', 2.2], fence: ['wood', 2.4], bench: ['wood', 1.8], bush: ['plant', 3.5], trash: ['metal', 0.9], barrel: ['metal', 0.9], computer: ['plastic', 0.8], robot: ['metal', 0.25], dumpster: ['metal', 0.3], car: ['metal', 0.45], truck: ['metal', 0.25], chunk: ['stone', 0.15] };
export const matOf = (p) => MAT[p.kind] || null;

export const wmPowers = {
  initPowers(game) {
    this.act = null; this.tail = null; this.lastL = null; this.aimPt = new THREE.Vector3(0, 0, -20); this.lmbHeld = false; this.clawIdx = 0;
    this.cd = { lmb: 0, f: 0, r: 0, e: 0, q: 0 }; this.cdMax = WM_CD; this.hintEl = $('wmhint'); this.bk = { jaw: 0.05, nk: 0, hd: 0, sp: 0, oz: 0, hy: 0 }; this.toastT = 0; this.hitFlashT = 0;
  },
  // ============================================================================================== helpers
  canStart() { return !this.act && !this.climb && this.mode !== 'crouch'; },
  beginAct(kind, extra) { this.tail = null; this.act = Object.assign({ kind, stage: 'start', t: 0, st: 0, w: 0, speedMul: 0.7, lockMove: false, moveVel: null, faceYaw: this.aimYaw(), faceK: 18, once: new Set(), hit: new Set() }, extra); return this.act; },
  setStage(a, s, extra) { a.stage = s; a.st = 0; if (extra) Object.assign(a, extra); },
  endAct(cdKey = null, cd = 0) { const a = this.act; if (!a) return; if (cdKey) this.cd[cdKey] = cd || WM_CD[cdKey]; if (this.lastL) this.tail = { L: this.lastL, t: 0.22 }; this.act = null; this.tiltOverride = null; },
  cancelAll() {
    this.act = null; this.tail = null; this.lastL = null; this.lmbHeld = false; this.tiltOverride = null; if (this.climb) this.endClimb(true);
    this.bk.jaw = 0.05; this.bk.nk = this.bk.hd = this.bk.sp = this.bk.oz = this.bk.hy = 0; if (this.hintEl) this.hintEl.hidden = true;
  },
  stageTime(a, dt) { a.t += dt; a.st += dt; },
  toast(m) { if (this.toastT <= 0) { this.g.hud.toast(m); this.toastT = 1.2; } },
  /** enemies (dummies / turrets): alive, not carried, nearest first; optional range + cone in front of `yaw` */
  foes(maxD, cosMin = -1, yaw = this.yaw) {
    const fx = Math.sin(yaw), fz = Math.cos(yaw), res = [];
    for (const h of this.g.world.hittables) {
      if (h.dead || h.held || h.kind !== 'dummy') continue; const dx = h.root.position.x - this.pos.x, dz = h.root.position.z - this.pos.z, d = Math.hypot(dx, dz); if (d > maxD || Math.abs(h.root.position.y - this.pos.y) > 3.2) continue;
      const dot = d > 0.05 ? (dx * fx + dz * fz) / d : 1; if (dot < cosMin) continue; res.push({ h, d, dot, score: d - dot * 3 });
    } return res.sort((a, b) => a.score - b.score);
  },
  /** does a sphere (c, r) touch the enemy's body (a vertical capsule)? */
  touchEnemy(h, c, r) {
    const hp = h.root.position, col = h.collider, rr = (col ? col.r : 0.62) + r, hh = col ? col.h : 2.4, dx = hp.x - c.x, dz = hp.z - c.z;
    if (dx * dx + dz * dz > rr * rr) return false; return c.y > hp.y - r && c.y < hp.y + hh + r;
  },
  touchProp(p, c, r) {
    const hh = p.half, qx = clamp(c.x, p.pos.x - hh.x, p.pos.x + hh.x), qz = clamp(c.z, p.pos.z - hh.z, p.pos.z + hh.z), qy = clamp(c.y, p.pos.y, p.pos.y + p.size.h);
    return (qx - c.x) ** 2 + (qy - c.y) ** 2 + (qz - c.z) ** 2 <= r * r;
  },
  hurtFoe(h, pt, dir, dmg, kb, o = {}) {
    const g = this.g; h.applyHit(pt, dir.clone(), dmg); if (h.shove && kb) h.shove(dir, kb); if (o.launch && h.launch) h.launch(o.launch); if (o.tilt && h.tiltV) { h.tiltV.x += dir.z * o.tilt; h.tiltV.y -= dir.x * o.tilt; }
    g.hud.hit(pt, Math.round(dmg), h); this.stats.hits++;
  },
  /** damage a prop if its material allows it (wood crates, fences, benches, bushes, small metal things...) - concrete / stone things just spark */
  tearProp(p, dmg, pt, dir, how = 'bite') {
    const g = this.g, m = matOf(p); if (!m) return false;
    const before = p.hp; g.props.hurt(p, dmg * m[1], dir); const dead = p.dead;
    if (!dead) { p.tumble.x += rand(-0.07, 0.07); p.tumble.z += rand(-0.07, 0.07); g.props.syncRoot(p); }
    g.props.impactFX(pt, clamp(g.props.fxScale(p) * 0.9, 0.6, 1.6), p.debris, dead);
    if (m[0] === 'wood' || m[0] === 'plant') for (let i = 0; i < 4; i++) g.fx.shards.emit({ pos: pt, vel: _e.set(rand(-1, 1), rand(0.3, 1.2), rand(-1, 1)).normalize().multiplyScalar(rand(2, 6)).clone(), size: rand(0.06, 0.16), life: 1.1, grav: 1 });
    g.sfx.crash(dead ? 0.55 : 0.28); if (dead) { this.stats.torn++; g.camera.addTrauma(0.12); } void before; void how; return true;
  },
  /** walls / indestructible boxes: show that it did nothing (sparks + a one-line hint) */
  clink(pt) {
    const g = this.g; for (let i = 0; i < 5; i++) g.fx.glow.emit({ pos: pt, vel: _e.set(rand(-1, 1), rand(0, 1), rand(-1, 1)).normalize().multiplyScalar(rand(3, 8)).clone(), size: rand(0.1, 0.22), life: 0.25, drag: 2, color: [1, 0.85, 0.5], alpha: 1 });
    g.sfx.hit(false); this.toast('TOO HARD TO BITE THROUGH');
  },
  boxAt(pt, pad = 0.15) { for (const b of this.g.world.boxes) if (pt.x > b.min.x - pad && pt.x < b.max.x + pad && pt.y > b.min.y - pad && pt.y < b.max.y + pad && pt.z > b.min.z - pad && pt.z < b.max.z + pad) return b; return null; },
  hitFX(pt, k = 1) {
    const g = this.g; g.fx.glow.emit({ pos: pt, size: 1.8 * k, life: 0.13, drag: 0, color: [1, 0.9, 0.7], alpha: 1 });
    for (let i = 0; i < 6 * k; i++) g.fx.dust.emit({ pos: pt.clone(), vel: _e.set(rand(-1, 1), rand(0, 1), rand(-1, 1)).normalize().multiplyScalar(rand(2, 5)).clone(), size: rand(0.3, 0.7), grow: 1.3, life: rand(0.3, 0.6), drag: 2.2, color: [0.8, 0.75, 0.68], alpha: 0.4 });
    g.camera.addTrauma(0.1 * k); g.camera.kick(0.012 * k); g.sfx.hit(k > 1.3);
  },

  // ============================================================================================== input
  keyDown(code) {
    switch (code) {
      case 'KeyQ': return this.toggleSense(); case 'KeyE': return this.keyE(); case 'KeyF': return this.startClaw(); case 'KeyR': return this.startPounce();
    }
  },
  keyUp() {},
  mouseDown() { this.lmbHeld = true; this.tryBite(); },
  mouseUp() { this.lmbHeld = false; },
  keyE() { if (this.climb) { this.endClimb(false); return; } this.tryClimb(); },
  toggleSense() {
    const S = this.g.sense; if (!S) return; if (this.cd.q > 0) return; this.cd.q = WM_CD.q; S.toggle(); this.stats.senses++;
    this.an.senseKick = 1; this.an.senseAmp = S.on ? 1 : 0.5; if (S.on) { this.an.sniff = 1; this.g.sfx.whoosh(); this.g.hud.toast('TRACKING SENSE'); } else this.g.hud.toast('SENSE OFF');
  },

  // ============================================================================================== LMB: bite
  tryBite() {
    if (this.cd.lmb > 0 || this.climb || this.mode === 'crouch') return; const cur = this.act; if (cur && !(cur.kind === 'claw' && cur.stage === 'recover')) return;
    if (cur) this.endAct(); const a = this.beginAct('bite', { speedMul: 0.55 }); this.cd.lmb = WM_CD.lmb; this.stats.bites++;
    const f = this.foes(5.2, 0.15, this.aimYaw())[0] || this.foes(2.4, -1)[0]; a.target = f ? f.h : null; a.faceYaw = f ? Math.atan2(f.h.root.position.x - this.pos.x, f.h.root.position.z - this.pos.z) : this.aimYaw();
    a.windT = 0.11; a.lungeT = 0.15; a.snapT = 0.085; a.recT = 0.3; a.faceK = 24; this.g.sfx.roar && this.g.sfx._tone && this.g.sfx._tone('sawtooth', 220, 110, 0.2, 0.25);
  },
  updateBite(dt, a) {
    this.stageTime(a, dt); const g = this.g;
    if (a.target && !a.target.dead) a.faceYaw = Math.atan2(a.target.root.position.x - this.pos.x, a.target.root.position.z - this.pos.z);
    if (a.stage === 'start') { if (a.st >= a.windT) { this.setStage(a, 'lunge'); const fx = Math.sin(a.faceYaw), fz = Math.cos(a.faceYaw); let sp = 13.5;
        if (a.target) { const m = this.muzzlePos(_a), dx = a.target.root.position.x - m.x, dz = a.target.root.position.z - m.z, d = Math.hypot(dx, dz) - ((a.target.collider ? a.target.collider.r : 0.62) + 0.2); sp = clamp(d / a.lungeT, 0, 15); }
        a.moveVel = { x: fx * sp, z: fz * sp }; g.sfx.whoosh(); } }
    else if (a.stage === 'lunge') { if (a.st >= a.lungeT * 0.55) this.biteContacts(a); if (a.st >= a.lungeT) { this.setStage(a, 'snap'); a.moveVel = null; this.vel.x *= 0.2; this.vel.z *= 0.2; this.biteContacts(a); } }
    else if (a.stage === 'snap') { this.biteContacts(a); if (a.st >= a.snapT) { if (!a.hit.size) this.biteWhiff(a); this.setStage(a, 'recover'); } }
    else if (a.stage === 'recover') { if (a.st >= a.recT * (a.hit.size ? 1 : 1.3)) this.endAct(); }
  },
  /** the jaws close on whatever is inside the muzzle sphere: enemies first, then props (tear), nothing else */
  biteContacts(a) {
    const g = this.g, m = this.muzzlePos(_a).clone(); let n = 0;
    for (const h of g.world.hittables) {
      if (h.dead || h.held || h.kind !== 'dummy' || a.hit.has(h)) continue; if (!this.touchEnemy(h, m, 0.75)) continue; a.hit.add(h); n++;
      const dir = _b.set(h.root.position.x - this.pos.x, 0, h.root.position.z - this.pos.z); if (dir.lengthSq() < 1e-4) dir.set(Math.sin(a.faceYaw), 0, Math.cos(a.faceYaw)); dir.normalize();
      const pt = new THREE.Vector3(m.x, Math.max(m.y, 0.6), m.z); this.hurtFoe(h, pt, dir.clone(), 30, 7, { launch: 0.8, tilt: 2 }); this.hitFX(pt, 1.2);
    }
    for (const p of g.props.props) { if (p.dead || p.held || p.temp || a.hit.has(p) || !this.touchProp(p, m, 0.7)) continue; a.hit.add(p); const dir = _b.set(p.pos.x - this.pos.x, 0, p.pos.z - this.pos.z).normalize().clone(); if (this.tearProp(p, 32, m.clone(), dir, 'bite')) n++; else if (!a.clinked) { a.clinked = true; this.clink(m.clone()); } }
    if (!n && !a.clinked) { const w = g.props.nearestWall(this.pos, a.faceYaw, 2.6); if (w && this.boxAt(m, 0.5)) { a.clinked = true; this.clink(m.clone()); } }
    return n;
  },
  biteWhiff() { this.g.sfx.whoosh(); },

  // ============================================================================================== F: claw swipe (alternating left / right)
  startClaw() {
    if (this.climb || this.mode === 'crouch') return; const cur = this.act;
    if (cur && cur.kind === 'claw') { cur.queued = true; return; }
    if (this.cd.f > 0 || !this.canStart()) return;
    const a = this.beginAct('claw', { speedMul: 0.6 }); this.startSwipe(a, false);
  },
  startSwipe(a, chain) {
    a.limb = this.clawIdx++ % 2 ? 'FR' : 'FL'; a.side = a.limb === 'FL' ? 1 : -1; a.windT = chain ? 0.07 : 0.11; a.swipeT = 0.12; a.recT = 0.22; a.queued = false; a.hit = new Set(); a.stage = 'start'; a.st = 0; a.clinked = false;
    const f = this.foes(3.4, 0.1, this.aimYaw())[0]; a.target = f ? f.h : null; a.faceYaw = f ? Math.atan2(f.h.root.position.x - this.pos.x, f.h.root.position.z - this.pos.z) : this.aimYaw(); a.faceK = 22; this.stats.claws++; this.g.sfx.whoosh();
  },
  updateClaw(dt, a) {
    this.stageTime(a, dt); const g = this.g;
    if (a.target && !a.target.dead) a.faceYaw = Math.atan2(a.target.root.position.x - this.pos.x, a.target.root.position.z - this.pos.z);
    if (a.stage === 'start') { if (a.st >= a.windT) { this.setStage(a, 'swipe'); const fx = Math.sin(a.faceYaw), fz = Math.cos(a.faceYaw); a.moveVel = { x: fx * 3.2, z: fz * 3.2 }; } }
    else if (a.stage === 'swipe') { this.clawContacts(a); if (a.st >= a.swipeT) { this.setStage(a, 'recover'); a.moveVel = null; if (!a.hit.size) g.sfx.whoosh(); } }
    else if (a.stage === 'recover') { if (a.queued && a.st > 0.05) { this.startSwipe(a, true); return; } if (a.st >= a.recT) this.endAct('f', a.hit.size ? 0.05 : 0.14); }
  },
  /** the swiping paw (centre of its claws) physically touches an enemy / a weak prop */
  clawContacts(a) {
    const g = this.g, L = this.rig.limbs[a.limb], wr = this.boneWorld(L.w, _a), tp = this.pawPos(a.limb, _b), c = _c.copy(wr).add(tp).multiplyScalar(0.5); let n = 0;
    for (const h of g.world.hittables) {
      if (h.dead || h.held || h.kind !== 'dummy' || a.hit.has(h)) continue; if (!this.touchEnemy(h, c, 0.62) && !this.touchEnemy(h, tp, 0.45)) continue; a.hit.add(h); n++;
      const dir = _d.set(h.root.position.x - this.pos.x, 0, h.root.position.z - this.pos.z); if (dir.lengthSq() < 1e-4) dir.set(Math.sin(a.faceYaw), 0, Math.cos(a.faceYaw)); dir.normalize();
      dir.addScaledVector(_e.set(Math.cos(a.faceYaw), 0, -Math.sin(a.faceYaw)), -a.side * 0.35).normalize();       // the swipe carries the target sideways across the body
      const pt = new THREE.Vector3(c.x, Math.max(c.y, 0.7), c.z); this.hurtFoe(h, pt, dir.clone(), 17, 5, { launch: 0.4, tilt: 1.6 }); this.hitFX(pt, 0.9);
    }
    for (const p of g.props.props) { if (p.dead || p.held || p.temp || a.hit.has(p) || !(this.touchProp(p, c, 0.6) || this.touchProp(p, tp, 0.4))) continue; a.hit.add(p); const dir = _d.set(p.pos.x - this.pos.x, 0, p.pos.z - this.pos.z).normalize().clone(); if (this.tearProp(p, 16, c.clone(), dir, 'claw')) n++; else if (!a.clinked) { a.clinked = true; this.clink(c.clone()); } }
    return n;
  },

  // ============================================================================================== R: pounce (a real ballistic leap, aimed once at launch - no steering, no teleport)
  startPounce() {
    if (this.climb) return; if (this.cd.r > 0) { this.toast('POUNCE RECOVERING ' + this.cd.r.toFixed(1) + 's'); return; } if (!this.canStart() || !this.grounded) return;
    const a = this.beginAct('pounce', { speedMul: 0.1, lockMove: true, noJump: true }); this.stats.pounces++; a.windT = 0.27; a.faceK = 16;
    const f = this.foes(13, 0.15, this.aimYaw())[0]; a.target = f ? f.h : null; a.faceYaw = f ? Math.atan2(f.h.root.position.x - this.pos.x, f.h.root.position.z - this.pos.z) : this.aimYaw();
    this.g.sfx._tone && this.g.sfx._tone('sawtooth', 160, 90, 0.3, 0.25);
  },
  updatePounce(dt, a) {
    this.stageTime(a, dt); const g = this.g;
    if (a.stage === 'start') {
      if (a.target && !a.target.dead) a.faceYaw = Math.atan2(a.target.root.position.x - this.pos.x, a.target.root.position.z - this.pos.z);
      if (a.st >= a.windT) {
        const G = 24, fx = Math.sin(a.faceYaw), fz = Math.cos(a.faceYaw); let dist = 9.5, dy = 0;
        if (a.target && !a.target.dead) { const hp = a.target.root.position; dist = Math.hypot(hp.x - this.pos.x, hp.z - this.pos.z) - 1.15; dy = (hp.y + 1.0) - (this.pos.y + 0.9); }
        dist = clamp(dist, 1.5, 15); const T = clamp(0.30 + dist * 0.036, 0.4, 0.85), vy = (dy + 0.5 * G * T * T) / T;       // flight time grows with distance: a 9 m pounce arcs ~1.2 m high (clears a low barrier), still a plain ballistic arc
        this.vel.set(fx * dist / T, clamp(vy, 4.5, 17), fz * dist / T); this.grounded = false; this.mode = 'air'; a.ballistic = true; a.grav = G; a.lockMove = false; this.setStage(a, 'air'); a.air = 0; a.hitAny = false; a.noJump = true; a.faceYaw = undefined;
        this.jumpFX(); g.sfx.whoosh(); g.camera.kick(0.03);
      }
    } else if (a.stage === 'air') {
      a.air += dt; if (!a.hitAny) this.pounceContacts(a);
      const hv = Math.hypot(this.vel.x, this.vel.z); this.tiltOverride = [-Math.atan2(this.vel.y, Math.max(hv, 2)) * 0.8, 0];
      if (this.grounded && a.air > 0.08) { this.tiltOverride = null; this.setStage(a, 'recover'); a.ballistic = false; a.grav = 0; a.speedMul = 0.12; a.recT = a.hitAny ? 0.5 : 0.8; this.vel.x *= 0.3; this.vel.z *= 0.3; }
      else if (a.air > 1.6) { this.endAct('r', WM_CD.r); }
    } else if (a.stage === 'recover') { if (a.st >= a.recT) this.endAct('r', WM_CD.r); }
  },
  /** body sphere in front of the chest + the muzzle: first contact in flight lands the hit and ends the leap (he rebounds off, no pass-through) */
  pounceContacts(a) {
    const g = this.g, fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), ch = _a.set(this.pos.x + fx * 0.55, this.pos.y + 1.0, this.pos.z + fz * 0.55).clone(), mz = this.muzzlePos(_b).clone(); let n = 0;
    for (const h of g.world.hittables) {
      if (h.dead || h.held || h.kind !== 'dummy' || a.hit.has(h)) continue; if (!this.touchEnemy(h, ch, 1.0) && !this.touchEnemy(h, mz, 0.7)) continue; a.hit.add(h); n++;
      const dir = _c.set(this.vel.x, 0, this.vel.z); if (dir.lengthSq() < 1e-4) dir.set(fx, 0, fz); dir.normalize(); const pt = new THREE.Vector3(h.root.position.x, Math.max(h.root.position.y + 1.2, 0.6), h.root.position.z);
      this.hurtFoe(h, pt, dir.clone(), 40, 13, { launch: 3.5, tilt: 4.5 }); this.hitFX(pt, 2); g.camera.addTrauma(0.22);
    }
    for (const p of g.props.props) { if (p.dead || p.held || p.temp || a.hit.has(p) || !this.touchProp(p, ch, 0.9)) continue; a.hit.add(p); const dir = _c.set(this.vel.x, 0, this.vel.z).normalize().clone(); if (this.tearProp(p, 70, ch.clone(), dir, 'pounce')) { n++; if (!p.dead && !p.planted) { g.props.removeBox(p); p.state = 'fly'; p.vel.x += dir.x * 5; p.vel.z += dir.z * 5; p.vel.y = Math.max(p.vel.y, 2.5); p.hit.clear(); } } }
    if (n) { a.hitAny = true; this.stats.pounceHits += n; this.vel.x *= 0.22; this.vel.z *= 0.22; this.vel.y = Math.max(Math.min(this.vel.y, 0) , -2) + 3.2; }
  },

  // ============================================================================================== damage taken is in wildmutt.js; per frame:
  updatePowers(dt, aimPoint) {
    this.aimPt.copy(aimPoint); for (const k in this.cd) if (this.cd[k] > 0) this.cd[k] = Math.max(0, this.cd[k] - dt); if (this.toastT > 0) this.toastT -= dt;
    if (this.hpT > 0) this.hpT -= dt; else if (this.hp < 380) this.hp = Math.min(380, this.hp + 25 * dt);
    const a = this.act; if (a) ({ bite: this.updateBite, claw: this.updateClaw, pounce: this.updatePounce })[a.kind].call(this, dt, a);
    if (!this.act && this.lmbHeld) this.tryBite();
    const S = this.g.sense, on = S && S.on; if (this.hintEl) { const txt = this.climb ? (this.climb.charge > 0 ? 'WALL JUMP CHARGE ' + Math.round(this.climb.charge / 0.9 * 100) + '%  ·  release Space to launch (aim with the camera)' : 'CLIMBING  ·  W/S/A/D move  Shift fast  HOLD Space = charge wall jump  E let go') : (!this.climb && this.nearClimb ? 'E — climb' : ''); if (this.hintEl.textContent !== txt) this.hintEl.textContent = txt; this.hintEl.hidden = !txt; }
    void on;
  },

  // ============================================================================================== pose layers
  actLayer(dt) {
    let L = null; const a = this.act;
    if (this.climb) { L = this.climbLayer(this.climb, dt); this.lastL = null; this.tail = null; return L; }
    if (a) { a.w = clamp(a.w + dt * 16, 0, 1); L = ({ bite: this.biteLayer, claw: this.clawLayer, pounce: this.pounceLayer })[a.kind].call(this, a, dt); L.w = a.w; }
    if (L) { this.lastL = L; this.tail = null; return L; }
    const B = this.bk; B.jaw = damp(B.jaw, 0.05, 14, dt); B.nk = damp(B.nk, 0, 14, dt); B.hd = damp(B.hd, 0, 14, dt); B.sp = damp(B.sp, 0, 14, dt); B.oz = damp(B.oz, 0, 14, dt); B.hy = damp(B.hy, 0, 14, dt);
    if (this.tail) { this.tail.t -= dt; if (this.tail.t <= 0) { this.tail = null; return null; } const T = this.tail.L; T.w = sm(this.tail.t / 0.22); return T; }
    return null;
  },
  /** bite: head draws back with the jaw open, the whole body surges forward, the jaws snap shut with a shake, then it recoils */
  biteLayer(a, dt) {
    const L = mkPose(), B = this.bk, st = a.stage; let jaw = 0.05, nk = 0, hd = 0, sp = 0, oz = 0, hy = 0;
    if (st === 'start') { const k = sm(a.st / a.windT); jaw = lerp(0.05, 0.95, k); nk = lerp(0, -0.34, k); hd = lerp(0, -0.2, k); sp = lerp(0, 0.16, k); oz = lerp(0, -0.12, k); }
    else if (st === 'lunge') { const k = sm(a.st / a.lungeT); jaw = 1.0; nk = lerp(-0.34, 0.42, k); hd = lerp(-0.2, 0.22, k); sp = lerp(0.16, 0.08, k); oz = lerp(-0.12, 0.3, k); }
    else if (st === 'snap') { const k = sm(a.st / a.snapT); jaw = lerp(1.0, -0.05, k); nk = 0.42; hd = 0.22; sp = 0.08; oz = 0.3; hy = Math.sin(a.st * 90) * 0.14 * (1 - k); }
    else { const k = sm(a.st / a.recT); jaw = lerp(-0.05, 0.05, k); nk = lerp(0.42, 0, k); hd = lerp(0.22, 0, k); sp = lerp(0.08, 0, k); oz = lerp(0.3, 0, k); hy = Math.sin(a.st * 40) * 0.07 * (1 - k); }
    const r = st === 'snap' ? 60 : 30; B.jaw = damp(B.jaw, jaw, r, dt); B.nk = damp(B.nk, nk, 26, dt); B.hd = damp(B.hd, hd, 26, dt); B.sp = damp(B.sp, sp, 26, dt); B.oz = damp(B.oz, oz, 22, dt); B.hy = damp(B.hy, hy, 60, dt);
    L.d.jaw = D(B.jaw * 0.85, 0, 0); L.d.neck = D(B.nk, B.hy * 0.6, 0); L.d.head = D(B.hd, B.hy, 0); L.d.spine0 = D(B.sp * 0.5, 0, 0); L.d.spine1 = D(B.sp * 0.4, 0, 0); L.d.spine2 = D(B.sp * 0.3, 0, 0); L.off = [0, -0.04 * Math.abs(B.nk), B.oz * 0.5];
    return L;
  },
  /** claw: one forearm rises back and out, sweeps across the front of the body (weight shifts the other way), then returns to the stance */
  clawLayer(a, dt) {
    const L = mkPose(), s = a.side, st = a.stage; let k = 0, tw = 0, wgt = 1;
    if (st === 'start') { k = -sm(a.st / a.windT); tw = -1; } else if (st === 'swipe') { k = sm(a.st / a.swipeT); tw = lerp(-1, 1, k); } else { k = 1 - sm(a.st / a.recT); tw = k; wgt = k > 0 ? 1 : 0; }
    const wind = V(s * 0.95, 1.28, 0.05), end = V(-s * 0.18, 0.92, 1.38), mid = V(s * 0.45, 1.5, 0.95);
    let p; if (k < 0) p = V(s * 0.62, 0.8, 0.45).lerp(wind, -k); else { const e = k; p = wind.clone().lerp(end, e); p.y += 0.35 * Math.sin(Math.PI * e); p.lerp(mid, 0.0); }
    if (st === 'recover') { const r = sm(a.st / a.recT); p = end.clone().lerp(V(s * 0.62, 0.45, 0.45), r); p.y += 0.2 * Math.sin(Math.PI * r); }
    const f = pawF(lerp(30, -25, clamp(k < 0 ? 0 : st === 'recover' ? 1 : k, 0, 1))), n = pawN(lerp(30, -25, clamp(k < 0 ? 0 : st === 'recover' ? 1 : k, 0, 1)));
    L.ik[a.limb] = { p, pole: V(s * 0.85, 0.5, -0.5), f, n, ground: undefined, lift: 0, w: st === 'recover' ? clamp(1 - a.st / a.recT * 0.9, 0, 1) : 1 }; L.curl[a.limb] = st === 'swipe' ? 0.0 : 0.12;
    const tws = tw * 0.3 * s; L.d.spine1 = D(0.05, -tws * 0.7, 0); L.d.spine2 = D(0.04, -tws, 0); L.d.hips = D(0, tws * 0.25, 0); L.d.neck = D(0, tws * 0.5, 0); L.d.head = D(0, tws * 0.4, 0); L.d.jaw = D(0.25, 0, 0);
    L.off = [-s * 0.07 * (tw * 0.5 + 0.5), -0.03, 0.04 * (k > 0 ? k : 0)]; return L;
  },
  /** pounce: coil low, eyes (nose) on the target, launch, fly stretched with the claws forward and the jaws open, absorb the landing */
  pounceLayer(a, dt) {
    const L = mkPose(), st = a.stage;
    if (st === 'start') {
      const k = sm(a.st / a.windT); L.off = [0, -0.34 * k, -0.1 * k]; L.d.spine0 = D(0.28 * k, 0, 0); L.d.spine1 = D(0.24 * k, 0, 0); L.d.spine2 = D(0.12 * k, 0, 0); L.d.neck = D(-0.15 * k, 0, 0); L.d.head = D(-0.1 * k, 0, 0); L.d.jaw = D(0.3 * k + 0.05 * Math.sin(a.st * 30), 0, 0);
      for (const lk of ['FL', 'FR']) { const sd = lk === 'FL' ? 1 : -1; L.ik[lk] = { p: V(sd * 0.55, 0.4, 0.5), pole: V(sd * 0.8, 0.3, -0.5), f: pawF(-28), n: pawN(-28), ground: 0.015, lift: 0 }; }
    } else if (st === 'air') {
      const hit = a.hitAny ? 1 : 0; L.d.jaw = D(0.85 - 0.5 * hit, 0, 0); L.d.neck = D(0.12, 0, 0); L.d.head = D(0.08, 0, 0);
      for (const lk of ['FL', 'FR']) { const sd = lk === 'FL' ? 1 : -1; L.ik[lk] = { p: V(sd * 0.5, 1.0 - 0.15 * hit, 1.5), pole: V(sd * 0.7, 0.4, -0.5), f: pawF(2), n: pawN(2), ground: undefined, lift: 0 }; L.curl[lk] = 0.0; }
    } else {
      const k = sm(a.st / a.recT); L.off = [0, -0.3 * (1 - k), 0]; L.d.spine0 = D(0.2 * (1 - k), 0, 0); L.d.spine1 = D(0.16 * (1 - k), 0, 0); L.d.jaw = D(0.2 * (1 - k), 0, 0); L.d.neck = D(-0.08 * (1 - k), 0, 0);
    }
    return L;
  },
};
