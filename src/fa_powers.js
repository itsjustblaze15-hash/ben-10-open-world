// Four Arms powers, mixed into FaPlayer.prototype:
//   grab system (V / G) with 4 independent arms  ·  LMB punch combo  ·  Q Grab & Slam  ·  E Double-Fist Ground Pound  ·  F Multi-Grab
//   G Environmental Attack  ·  T Rage  ·  R Seismic Slam  ·  RMB/B Block  ·  Z Shove
// Held things (props or enemies) follow a carry point in the character's local frame with a spring, and the matching hands are IK'd onto
// the object's REAL position, so attachments never teleport. Releasing hands the object back to the physics (PropSystem / Dummy).
import { meleeAim } from './aimassist.js';
import * as THREE from 'three';
import { clamp, damp, lerp, rand, angleDelta } from './util.js';
import { ARMS, SIDE, V, hand, mkPose, arm, smooth, easeOut, easeIn, K, D, squat } from './fa_pose.js';
import { CATS } from './props.js';
import { Dummy } from './dummies.js';

const GRAV = 26, TAU = Math.PI * 2;
const PAIRS = [['UL', 'UR'], ['LL', 'LR']];
const ALT = { UL: 'LL', UR: 'LR', LL: 'UL', LR: 'UR' };
export const FA_CD = { q: 5, e: 7, f: 9, g: 0.5, r: 16, z: 1.6, t: 20 };
const $ = id => document.getElementById(id);
const _t = new THREE.Vector3(), _u = new THREE.Vector3(), _w = new THREE.Vector3();

export const powers = {
  initPowers(game) {
    const sc = game.scene;
    this.holds = []; this.act = null; this.combo = null; this.blocking = false; this.tail = null; this.cand = null; this.aimPt = new THREE.Vector3(0, 0, -20); this.wantDir = new THREE.Vector3();
    this.cd = { q: 0, e: 0, f: 0, g: 0, r: 0, z: 0 }; this.cdMax = FA_CD; this.rage = { on: false, t: 0, dur: 10, cd: 0, cdDur: 20 };
    this.aura = new THREE.Mesh(new THREE.CapsuleGeometry(1.2, 1.9, 8, 20), new THREE.MeshBasicMaterial({ color: 0xff2a10, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide, fog: false }));
    this.aura.position.y = 1.5; this.aura.visible = false; this.root.add(this.aura);
    this.light = new THREE.PointLight(0xff3010, 0, 16, 2); this.light.position.y = 2.2; this.root.add(this.light);
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(52 * 3), 3));
    this.arcLine = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xffb040, transparent: true, opacity: 0.9, depthTest: false })); this.arcLine.frustumCulled = false; this.arcLine.renderOrder = 12; this.arcLine.visible = false; sc.add(this.arcLine);
    const ringMat = c => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
    this.arcEnd = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.75, 32), ringMat(0xffa030)); this.arcEnd.rotation.x = -Math.PI / 2; this.arcEnd.visible = false; this.arcEnd.renderOrder = 12; sc.add(this.arcEnd);
    this.mark = new THREE.Mesh(new THREE.RingGeometry(0.88, 1, 40), ringMat(0xffe45a)); this.mark.rotation.x = -Math.PI / 2; this.mark.visible = false; this.mark.renderOrder = 11; sc.add(this.mark);
    this.hintEl = $('grabhint'); this.ragefx = $('ragefx'); this.emberT = 0; this.shockT = 0;
  },

  // ============================================================================================== queries
  capacity() { return this.rage.on ? 5200 : 1700; },
  holdLifting() { return this.holds.some(h => h.lift); },
  usedArms() { const s = new Set(); for (const h of this.holds) for (const k of h.arms) s.add(k); return s; },
  freePairs() { const u = this.usedArms(); return PAIRS.filter(p => !u.has(p[0]) && !u.has(p[1])); },
  freeArm(k) { const u = this.usedArms(); return !u.has(k) ? k : !u.has(ALT[k]) ? ALT[k] : null; },
  canAct() { return !this.act && !this.combo && !this.climb && this.mode !== 'crouch' && (this.mode === 'ground' || this.mode === 'air'); },
  edgeDist(p) { const h = p.half, dx = Math.max(p.pos.x - h.x - this.pos.x, 0, this.pos.x - (p.pos.x + h.x)), dz = Math.max(p.pos.z - h.z - this.pos.z, 0, this.pos.z - (p.pos.z + h.z)); return Math.hypot(dx, dz); },
  enemies(maxD, cosMin = -1) {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), res = [];
    for (const h of this.g.world.hittables) { if (!(h instanceof Dummy) || h.isBoss || h.dead || h.held) continue; const dx = h.root.position.x - this.pos.x, dz = h.root.position.z - this.pos.z, d = Math.hypot(dx, dz); if (d > maxD || Math.abs(h.root.position.y - this.pos.y) > 3) continue; const dot = d > 0.05 ? (dx * fx + dz * fz) / d : 1; if (dot < cosMin) continue; res.push({ h, d, dot, score: d - dot * 2 }); }
    return res.sort((a, b) => a.score - b.score);
  },
  /** what V (or G) would grab right now: { type:'enemy'|'prop'|'wall', obj, ok, label, why } */
  pickTarget(envOnly = false) {
    const P = this.g.props, fx = Math.sin(this.yaw), fz = Math.cos(this.yaw); let best = null;
    if (!envOnly) { const e = this.enemies(4.4, 0.15)[0]; if (e) best = { type: 'enemy', obj: e.h, score: e.score, label: 'ENEMY', cat: 'enemy' }; }
    const pr = P.candidate(this.pos, this.yaw, envOnly ? 7 : 3.8, envOnly ? (p => p.cat === 'vehicle' || p.cat === 'heavy' || p.cat === 'long') : null) || (envOnly ? P.candidate(this.pos, this.yaw, 7, null) : null);
    if (pr) { const sc = this.edgeDist(pr) - 0.4; if (!best || sc < best.score) best = { type: 'prop', obj: pr, score: sc, label: pr.kind.toUpperCase().replace('_', ' '), cat: pr.cat }; }
    if (!best && !envOnly) { const w = P.nearestWall(this.pos, this.yaw, 3.2); if (w) best = { type: 'wall', obj: w, label: w.name, cat: 'destructible' }; }
    if (!best) return null;
    best.ok = true; const free = this.freePairs();
    if (best.type === 'enemy') { if (!free.length) { best.ok = false; best.why = 'ARMS FULL'; } }
    else if (best.type === 'wall') { if (!free.length) { best.ok = false; best.why = 'ARMS FULL'; } }
    else {
      const need = CATS[best.obj.cat].arms; if (best.obj.mass > this.capacity()) { best.ok = false; best.why = 'TOO HEAVY — USE RAGE (T)'; } else if (free.length * 2 < need) { best.ok = false; best.why = need === 4 ? 'NEEDS ALL FOUR ARMS' : 'ARMS FULL'; }
    }
    return best;
  },

  // ============================================================================================== input
  keyDown(code) {
    switch (code) {
      case 'KeyQ': return this.startSlam(); case 'KeyE': return this.startPound(); case 'KeyF': return this.startMulti(); case 'KeyG': return this.keyG();
      case 'KeyT': return this.startRage(); case 'KeyR': return this.startSeismic(); case 'KeyV': return this.keyV(); case 'KeyZ': return this.startShove();
      case 'KeyX': return this.dropAll(true); case 'KeyL': return this.setBlock(true);
    }
  },
  keyUp(code) { if (code === 'KeyL') this.setBlock(false); },
  setBlock(b) { if (b && (this.act || this.combo || this.climb)) return; if (b && !this.blocking) this.g.sfx.thud(0.2); this.blocking = b && !this.act && !this.combo; },
  mouseDown() {
    if (this.combo) { this.combo.queued = true; return; }
    if (!this.canAct() || this.mode === 'air' && false) return;
    this.blocking = false;
    if (this.freePairs().length) return this.startCombo();
    const h = this.holds.find(x => !x.lift); if (h) this.throwHold(h);               // all four arms busy: LMB throws instead
  },
  keyV() {
    if (!this.canAct() && !(this.act && this.act.kind === 'grab')) return; if (this.act) return;
    const c = this.pickTarget(); this.blocking = false;
    if (c && c.ok) return this.startReach(c);
    if (c && !c.ok) { this.g.hud.toast(c.why); if (this.holds.length) this.dropOldest(); return; }
    if (this.holds.length) this.dropOldest(); else this.g.hud.toast('NOTHING TO GRAB');
  },
  keyG() {
    if (!this.canAct()) return; this.blocking = false;
    if (this.cd.g > 0) return;
    const h = this.holds.find(x => !x.lift); if (h) return this.throwHold(h);
    if (this.holds.length) return;                                                       // still lifting
    const c = this.pickTarget(true);
    if (!c) { this.g.hud.toast('NO OBJECT IN RANGE'); return; } if (!c.ok) { this.g.hud.toast(c.why); return; }
    this.startReach(c, true);
  },

  // ============================================================================================== acts (scripted, one at a time)
  beginAct(kind, extra) { this.blocking = false; this.tail = null; this.act = Object.assign({ kind, stage: 'start', t: 0, st: 0, w: 0, speedMul: 0.2, lockMove: false, moveVel: null, faceYaw: this.yaw, once: new Set() }, extra); return this.act; },
  setStage(a, s, extra) { a.stage = s; a.st = 0; if (extra) Object.assign(a, extra); },
  endAct(cdKey = null) {
    const a = this.act; if (!a) return; if (cdKey) this.cd[cdKey] = FA_CD[cdKey]; if (this.lastL) this.tail = { L: this.lastL, t: 0.2 }; this.act = null;
    if (this.mode === 'crouch') this.mode = 'ground';
  },
  cancelAll() {
    this.dropAll(false); this.act = null; this.combo = null; this.blocking = false; this.tail = null; if (this.rage && this.rage.on) this.endRage(true);
    this.arcLine.visible = false; this.arcEnd.visible = false;
  },
  stageTime(a, dt) { a.t += dt; a.st += dt; },

  // ---------------------------------------------------------------------------------------------- hold system
  carryPt(o, kind) {
    if (kind === 'enemy') return V(0, 2.5, 1.25);
    const c = o.cat; if (c === 'heavy' || c === 'vehicle') return V(0, 3.15 + o.size.h / 2, 0.55); if (c === 'long') return V(0, 2.5, 1.4); return c === 'medium' ? V(0, 2.35, 1.5) : V(0, 2.2, 1.3);
  },
  startHold(kind, obj, arms) {
    const P = this.g.props, h = { kind, obj, arms, t: 0, w: 0, lift: true, carry: 0.8, liftT: 0.45, aimFace: false, cur: new THREE.Vector3(), pt: this.carryPt(obj, kind), tilt: new THREE.Vector2(), twist: 0, mass: 60 };
    if (kind === 'prop') { const c = CATS[obj.cat]; h.carry = c.carry; h.liftT = c.lift; h.mass = obj.mass; P.setHeld(obj); h.cur.copy(obj.center); obj.dmgMul = this.dmgMul; obj.knockMul = this.kbMul; }
    else { obj.held = true; obj.collider.dead = true; obj.kv.set(0, 0, 0); h.cur.set(obj.root.position.x, obj.root.position.y + 1.3, obj.root.position.z); }
    this.holds.push(h); this.stats.grabs++; const g = this.g; g.camera.addTrauma(0.15); g.sfx.thud(0.5); g.camera.kick(0.02);
    g.fx.dust.emit({ pos: h.cur.clone().setY(this.pos.y + 0.2), vel: V(0, 0.6, 0), size: 1.3, grow: 1.6, life: 0.5, drag: 2, color: [0.65, 0.63, 0.6], alpha: 0.4 });
    return h;
  },
  /** lunge to the target if it is out of reach, then grab it */
  startReach(c, env = false) {
    const need = c.type === 'prop' ? CATS[c.obj.cat].arms : 2, free = this.freePairs();
    const a = this.beginAct('grab', { stage: 'reach', cand: c, speedMul: 1, env, arms: need === 4 ? ['UL', 'UR', 'LL', 'LR'] : free[0], faceYaw: this.yaw });
    a.lockMove = false; a.moveVel = new THREE.Vector3();
  },
  finishGrab(c, env) {
    const P = this.g.props, free = this.freePairs();
    if (c.type === 'enemy') { if (c.obj.dead || c.obj.held || !free.length) return; this.startHold('enemy', c.obj, free[0]); }
    else if (c.type === 'wall') { const ch = P.ripChunk(c.obj, this.pos); if (ch && free.length) { this.startHold('prop', ch, free[0]); this.g.hud.toast('PULLED A SLAB'); } }
    else {
      const p = c.obj; if (p.dead || p.held) return; const need = CATS[p.cat].arms;
      if (p.planted) this.ripLight(p);
      this.startHold('prop', p, need === 4 ? ['UL', 'UR', 'LL', 'LR'] : free[0]);
    }
    this.g.hud.toast((c.label) + (c.cat ? ' · ' + (CATS[c.cat] ? CATS[c.cat].label : c.cat.toUpperCase()) : ''));
  },
  /** a streetlight is bolted to the ground: tear it out (dirt + concrete burst) and turn it into a throwable pole */
  ripLight(p) {
    const P = this.g.props; p.planted = false; P.removeBox(p); const base = new THREE.Vector3(p.pos.x, p.pos.y + 0.1, p.pos.z);
    P.debris.burst(base, 26, 9, 0.22, 0x8a8a84, 1.2); P.cracks.add(base.x, p.pos.y, base.z, 4.2, 25); P.impactFX(base, 1.5, 0x7d7a74, true); this.g.camera.addTrauma(0.4); this.g.sfx.crash(0.7);
    p.size = { w: 0.7, h: 0.7, d: 4.6 }; p.inner.position.set(0, 0, -2.3); p.inner.rotation.x = Math.PI / 2; p.mass = 150; P.stats.rips++;
  },
  dropOldest() { const h = this.holds[0]; if (h) this.dropHold(h); },
  dropAll(toast) { for (const h of this.holds.slice()) this.dropHold(h); if (toast && this.g.hud) this.g.hud.toast('DROPPED'); },
  dropHold(h, vel = null) {
    const i = this.holds.indexOf(h); if (i >= 0) this.holds.splice(i, 1); const P = this.g.props;
    if (h.kind === 'prop') { P.release(h.obj, vel || new THREE.Vector3(Math.sin(this.yaw) * 1.2, 0, Math.cos(this.yaw) * 1.2)); h.obj.thrown = false; h.obj.convertedBack = true; }
    else { h.obj.release(); h.obj.slide.set(0, 0, 0); h.obj.slideV.set(0, 0, 0); h.obj.tiltV.set(2, 0); h.obj.thrown = 0; }
  },
  /** every frame: carried things follow their carry point (spring), so they lag and sway a little with their weight */
  updateHolds(dt) {
    const P = this.g.props;
    for (let i = this.holds.length - 1; i >= 0; i--) {
      const h = this.holds[i]; h.t += dt; const o = h.obj;
      if ((h.kind === 'enemy' && (o.dead && false)) || (h.kind === 'prop' && o.dead)) { this.holds.splice(i, 1); continue; }
      const tgt = this.root.localToWorld(_t.copy(h.pt));
      h.w = damp(h.w, 1, 9, dt);
      if (h.kind === 'prop') {
        const bob = Math.sin(this.an.ps) * 0.06 * this.an.mv, k = (h.lift ? 9 : 17) / (1 + o.mass / 1100);
        h.cur.x = damp(h.cur.x, tgt.x, k, dt); h.cur.z = damp(h.cur.z, tgt.z, k, dt); h.cur.y = damp(h.cur.y, tgt.y + bob, k * 0.9, dt);
        o.pos.set(h.cur.x, Math.max(0, h.cur.y - o.size.h / 2), h.cur.z);
        const want = this.yaw + (o.cat === 'long' ? Math.PI / 2 : 0); o.yaw += angleDelta(o.yaw, want) * (1 - Math.exp(-8 * dt));
        o.tumble.set(clamp((h.cur.y - tgt.y) * 0.08, -0.2, 0.2), 0, Math.sin(this.an.ps) * 0.035 * this.an.mv); P.syncRoot(o);
        if (h.lift && (h.cur.distanceTo(tgt) < 0.45 || h.t > h.liftT + 1.4)) h.lift = false;
        if (o.pos.y < 0.02 && h.cur.y < o.size.h / 2) o.pos.y = 0;
      } else {
        const ks = h.stiff || 26; h.cur.x = damp(h.cur.x, tgt.x, ks, dt); h.cur.z = damp(h.cur.z, tgt.z, ks, dt); h.cur.y = damp(h.cur.y, tgt.y, ks, dt);
        o.home.x = h.cur.x; o.home.z = h.cur.z; o.air = Math.max(0, h.cur.y - 1.3); o.airV = 0; o.kv.set(0, 0, 0); o.slide.set(0, 0, 0); o.slideV.set(0, 0, 0); o.confuse = 1; o.held = true;
        o.root.rotation.y = this.yaw + Math.PI + h.twist; const wob = Math.sin(h.t * 9) * 0.1 * (1 - h.tilt.length() * 0.3); o.tilt.set(h.tilt.x + wob, h.tilt.y + Math.cos(h.t * 7) * 0.06); o.tiltV.set(0, 0);
        if (h.lift && (h.cur.distanceTo(tgt) < 0.5 || h.t > 0.8)) h.lift = false;
      }
    }
  },
  /** arm layer for everything carried: each hand is IK'd to the held object's real position */
  holdLayer(dt) {
    const L = mkPose(); if (!this.holds.length) { L.w = 0; return L; }
    let crouch = 0, load = 0; L.w = 1;
    for (const h of this.holds) {
      this.root.worldToLocal(_u.copy(h.cur)); const c = _u.clone(), o = h.obj, w = clamp(h.w * 1.2, 0, 1);
      let lat = 0.55, up = 0.1, fb = 0;
      if (h.kind === 'prop') { const dl = Math.abs(Math.cos(o.yaw - this.yaw)) * o.size.w / 2 + Math.abs(Math.sin(o.yaw - this.yaw)) * o.size.d / 2; lat = clamp(dl + 0.05, 0.45, 1.3); up = h.arms.length === 4 ? Math.min(0.5, o.size.h * 0.3) : 0.1; fb = h.arms.length === 4 ? 0.55 : 0; if (o.cat === 'heavy' || o.cat === 'vehicle') c.y -= o.size.h * 0.32; }
      for (const k of h.arms) {
        const upper = k[0] === 'U', p = V(c.x + SIDE[k] * lat, c.y + (h.arms.length === 4 ? (upper ? up : -up) : 0), c.z + (h.arms.length === 4 ? (upper ? fb : -fb) : 0));
        arm(L, k, p, V(SIDE[k] * 1, -0.6, -0.3), 0, 'w', w); L.curl[k] = 1;
      }
      if (h.lift) crouch = Math.max(crouch, (1 - smooth(h.t / Math.max(h.liftT, 0.2))) * (c.y < 1.8 ? 1 : 0.4)); load = Math.max(load, clamp(h.mass / 1500, 0, 1) * (h.kind === 'enemy' ? 0.3 : 1));
    }
    const act = this.act; if (crouch > 0.01 && !(act && act.kind !== 'grab')) { squat(L, 0.85 * crouch, 0.15); L.d.spine = D(0.55 * crouch, 0, 0); L.d.chest = D(0.35 * crouch, 0, 0); }
    else { L.d.spine = D(-0.04 - 0.1 * load, 0, 0); L.d.chest = D(-0.04 - 0.08 * load, 0, 0); L.off[1] = -0.12 * load; }
    return L;
  },
  /** ballistic launch velocity from `from` toward `to` at `speed` (low arc), with a lofted fallback when out of range */
  solveThrow(from, to, speed) {
    const dx = to.x - from.x, dz = to.z - from.z, d = Math.hypot(dx, dz), hy = to.y - from.y, s2 = speed * speed;
    if (d < 1.5) return V(Math.sin(this.yaw) * speed * 0.7, speed * 0.25, Math.cos(this.yaw) * speed * 0.7);
    const disc = s2 * s2 - GRAV * (GRAV * d * d + 2 * hy * s2); let th;
    th = disc < 0 ? Math.PI / 4.4 : Math.atan((s2 - Math.sqrt(disc)) / (GRAV * d));
    return V(dx / d * Math.cos(th) * speed, Math.sin(th) * speed, dz / d * Math.cos(th) * speed);
  },
  throwSpeed(h) { return h.kind === 'prop' ? CATS[h.obj.cat].throwV * (this.rage.on ? 1.3 : 1) : 26 * this.kbMul; },
  throwHold(h) {
    if (this.act) return; const a = this.beginAct('throw', { stage: 'wind', hold: h, speedMul: 0.3, faceYaw: Math.atan2(this.aimPt.x - this.pos.x, this.aimPt.z - this.pos.z), faceK: 20 }); a.faceYaw = this.aimYaw(); this.cd.g = FA_CD.g;
  },
  aimYaw() { const dx = this.aimPt.x - this.pos.x, dz = this.aimPt.z - this.pos.z; return Math.hypot(dx, dz) > 2 ? Math.atan2(dx, dz) : this.yaw; },
  releaseThrow(h, extraAng = 0) {
    const P = this.g.props, g = this.g; const i = this.holds.indexOf(h); if (i < 0) return; this.holds.splice(i, 1);
    if (h.kind === 'prop') {
      const p = h.obj, v = this.solveThrow(h.cur, this.aimPt, this.throwSpeed(h)); if (extraAng) { const c = Math.cos(extraAng), s = Math.sin(extraAng), x = v.x * c - v.z * s; v.z = v.x * s + v.z * c; v.x = x; }
      if (p.cat === 'long') p.yaw = Math.atan2(v.x, v.z) ; P.release(p, v, V(rand(-2, 2), p.cat === 'long' ? 0 : rand(-3, 3), rand(-2, 2) + (p.cat === 'long' ? 0 : 3))); p.dmgMul = this.dmgMul; p.knockMul = this.kbMul; p.tumble.set(0, 0, 0);
      if (p.cat === 'long') { p.tumble.set(0, 0, 0); p.spin.set(0, 0, 0); }
      g.camera.kick(0.05); g.camera.addTrauma(0.2 + 0.2 * clamp(p.mass / 1400, 0, 1)); g.sfx.whoosh(); g.sfx.thud(0.4);
    } else {
      const d = h.obj, yaw = this.aimYaw() + extraAng, dir = V(Math.sin(yaw), 0, Math.cos(yaw)), pt = V(d.root.position.x, d.root.position.y + 1.3, d.root.position.z);
      d.release(); d.home.x = d.root.position.x; d.home.z = d.root.position.z; d.slide.set(0, 0, 0); d.applyHit(pt, dir.clone(), 22 * this.dmgMul); d.shove(dir, 34 * this.kbMul); d.airV = 9; d.air = Math.max(d.air, 0.1); d.thrown = 1; d._hit = new Set(); d.tiltV.x += rand(-6, 6);
      g.hud.hit(pt, Math.round(22 * this.dmgMul), d); g.sfx.whoosh(); g.camera.kick(0.04);
    }
    this.stats.throws++;
  },
  /** arc preview while carrying a prop */
  updateArc() {
    const h = this.holds.find(x => x.kind === 'prop' && !x.lift), ok = !!h && (!this.act || this.act.kind === 'throw' && this.act.stage === 'wind' || this.act.kind === 'throw'); this.arcLine.visible = this.arcEnd.visible = !!h && ok;
    if (!h) return; const v = this.solveThrow(h.cur, this.aimPt, this.throwSpeed(h)), pos = h.cur.clone(), pa = this.arcLine.geometry.attributes.position, pv = v.clone(); let n = 0, last = null;
    for (let i = 0; i < 52; i++) {
      pa.setXYZ(i, pos.x, pos.y, pos.z); n = i + 1; last = pos.clone(); const prev = pos.clone(); pv.y -= GRAV * 0.04; pos.addScaledVector(pv, 0.04);
      const seg = _u.copy(pos).sub(prev), len = seg.length(); if (len > 1e-4) { const hit = this.g.world.raySolid(prev, seg.normalize(), len); if (hit) { last = hit.point; pa.setXYZ(i + 1 < 52 ? i + 1 : i, hit.point.x, hit.point.y, hit.point.z); n = Math.min(52, i + 2); break; } }
      if (pos.y < 0.05) { last = pos.clone().setY(0.05); pa.setXYZ(i + 1 < 52 ? i + 1 : i, pos.x, 0.05, pos.z); n = Math.min(52, i + 2); break; }
    }
    for (let i = n; i < 52; i++) pa.setXYZ(i, last.x, last.y, last.z); pa.needsUpdate = true; this.arcEnd.position.set(last.x, Math.max(0.06, last.y), last.z);
    const pulse = 1 + 0.12 * Math.sin(this.an.t * 8); this.arcEnd.scale.setScalar(pulse * clamp(Math.cbrt(h.obj.size.w * h.obj.size.h * h.obj.size.d) / 1.2, 0.8, 2.2));
  },

  // ---------------------------------------------------------------------------------------------- hit helpers
  hitFX(pt, dir, big) {
    const g = this.g; g.props.impactFX(pt, big ? 1.5 : 0.8, 0xa8a49c, big); g.fx.glow.emit({ pos: pt, size: big ? 3.2 : 1.8, life: 0.12, drag: 0, color: [1, 0.85, 0.55], alpha: 1 });
    if (big) g.fx.surface.ring(pt.clone().setY(this.pos.y + 0.1), V(0, 1, 0), 5, 0.35, 0xffcf90);
  },
  /** cone-shaped melee: enemies (damage + knockback + launch), loose props (shoved + damaged), breakable walls */
  meleeHit(o) {
    const g = this.g, P = g.props, fy = o.yaw ?? this.yaw, fx = Math.sin(fy), fz = Math.cos(fy), cx = this.pos.x + fx * (o.fwd ?? 1.0), cz = this.pos.z + fz * (o.fwd ?? 1.0), once = o.once || new Set(); let n = 0;
    for (const h of g.world.hittables) {
      if (h.dead || h.held || once.has(h)) continue; const hp = h.root.position, dx = hp.x - cx, dz = hp.z - cz, d = Math.hypot(dx, dz);
      if (d > o.reach || Math.abs(hp.y - this.pos.y) > 3.2) continue; const dot = d > 0.1 ? (dx * fx + dz * fz) / d : 1; if (dot < o.cos && d > 1.2) continue;
      if (d > 1.5 && g.world.raySolid(V(this.pos.x, this.pos.y + 1.2, this.pos.z), V(dx, 0, dz).normalize(), d - 0.6)) continue;       // walls block punches
      const dir = d > 0.1 ? V(dx / d * 0.6 + fx * 0.4, 0, dz / d * 0.6 + fz * 0.4).normalize() : V(fx, 0, fz), pt = V(hp.x, hp.y + 1.4, hp.z), dmg = o.dmg * this.dmgMul;
      h.applyHit(pt, dir.clone(), dmg); if (h.shove) h.shove(dir, o.push * this.kbMul); if (o.launch && h.launch) h.launch(o.launch * (this.rage.on ? 1.3 : 1)); g.hud.hit(pt, Math.round(dmg), h); this.hitFX(pt, dir, o.final); once.add(h); n++; this.stats.hits++;
    }
    const dirF = V(fx, 0, fz);
    for (const p of P.props) {
      if (p.held || p.dead || once.has(p)) continue; const h = p.half, qx = clamp(cx, p.pos.x - h.x, p.pos.x + h.x), qz = clamp(cz, p.pos.z - h.z, p.pos.z + h.z), dx = qx - cx, dz = qz - cz, d = Math.hypot(dx, dz);
      if (d > o.reach * 0.85 || p.pos.y > this.pos.y + 3.2 || p.pos.y + p.size.h < this.pos.y) continue; const dot = d > 0.1 ? (dx * fx + dz * fz) / d : 1; if (dot < o.cos * 0.7 && d > 1.2) continue;
      const dir = d > 0.1 ? V(dx / d * 0.5 + fx * 0.5, 0, dz / d * 0.5 + fz * 0.5).normalize() : dirF.clone(); once.add(p); n++;
      if (!p.planted) { const k = (o.prop ?? 14) * this.kbMul / Math.sqrt(p.mass / 40 + 1); P.removeBox(p); p.state = 'fly'; p.vel.x += dir.x * k; p.vel.z += dir.z * k; p.vel.y = Math.max(p.vel.y, Math.min(9, k * 0.3)); p.spin.set(rand(-3, 3), rand(-3, 3), rand(-3, 3)); p.hit.clear(); p.dmgMul = 0.6; }
      P.impactFX(p.center, 0.8 * P.fxScale(p), p.debris, true); P.hurt(p, (o.propDmg ?? 30) * this.dmgMul, dir);
    }
    const w = P.nearestWall(this.pos, fy, o.reach + 0.5);
    if (w && !once.has(w) && o.wall) { once.add(w); const b = w.entry, pt = V(clamp(this.pos.x + fx * 2, b.min.x, b.max.x), this.pos.y + 1.8, clamp(this.pos.z + fz * 2, b.min.z, b.max.z)); P.damageWall(w, o.wall * this.dmgMul, pt, dirF.clone()); n++; this.stats.walls++; }
    if (n) { g.camera.addTrauma(o.final ? 0.6 : 0.18); g.camera.kick(o.final ? 0.05 : 0.015); g.sfx.hit(!!o.final); }
    return n;
  },
  /** radial shock on enemies, props and walls (ground pound / slam / seismic) */
  shock(c, radius, dmg, push, launch, wallDmg, propForce, propDmg) {
    const g = this.g;
    for (const h of g.world.hittables) {
      if (h.dead || h.held) continue; const hp = h.root.position, dx = hp.x - c.x, dz = hp.z - c.z, d = Math.hypot(dx, dz); if (d > radius || Math.abs(hp.y - c.y) > 5) continue;
      const f = 1 - 0.75 * d / radius, dir = d > 0.05 ? V(dx / d, 0, dz / d) : V(Math.sin(this.yaw), 0, Math.cos(this.yaw)), pt = V(hp.x, hp.y + 1.3, hp.z), dm = dmg * f * this.dmgMul;
      h.applyHit(pt, dir.clone(), dm); if (h.shove) h.shove(dir, push * f * this.kbMul); if (launch && h.launch) h.launch(launch * (0.4 + 0.6 * f) * (this.rage.on ? 1.25 : 1)); g.hud.hit(pt, Math.round(dm), h); this.stats.hits++;
    }
    g.props.shockwave(c, radius, propForce * this.kbMul, wallDmg * this.dmgMul, propDmg * this.dmgMul);
  },

  // ============================================================================================== LMB: heavy punch combo
  startCombo() {
    const free = this.freePairs(); if (!free.length) return; this.blocking = false; this.tail = null;
    this.combo = { n: 0, t: 0, queued: false, hit: new Set(), faceYaw: this.yaw, done: false, fired: 0 }; this.comboSetup();
  },
  camYawFace() { return this.mode === 'air' || this.hasInput ? this.yaw : this.yaw; },
  COMBO: [
    { dur: 0.56, strikes: [{ k: 'UR', t0: 0.15, th: 0.25, te: 0.5, dmg: 16, push: 6, kind: 'straight', tw: 1 }] },
    { dur: 0.58, strikes: [{ k: 'UL', t0: 0.1, th: 0.21, te: 0.5, dmg: 16, push: 6, kind: 'hook', tw: -1 }, { k: 'LR', t0: 0.12, th: 0.23, te: 0.52, dmg: 12, push: 5, kind: 'hook', tw: -1 }] },
    { dur: 0.78, strikes: [{ k: 'LL', t0: 0.05, th: 0.16, te: 0.4, dmg: 10, push: 3, kind: 'upper', tw: -1 }, { k: 'LR', t0: 0.11, th: 0.22, te: 0.46, dmg: 10, push: 3, kind: 'upper', tw: 1 }, { k: 'UL', t0: 0.17, th: 0.28, te: 0.52, dmg: 12, push: 4, kind: 'straight', tw: -1 }, { k: 'UR', t0: 0.23, th: 0.34, te: 0.6, dmg: 14, push: 9, kind: 'straight', tw: 1 }] },
    { dur: 1.12, smash: true },
  ],
  /** turn toward whatever the crosshair is on (world-Y only). snap = immediate combat-facing at the start of a punch */
  aimFace(c, snap) {
    const a = meleeAim(this.g, this.pos, 8.5); c.faceYaw = a.yaw; c.target = a.target;
    if (snap) { const dy = angleDelta(this.yaw, a.yaw); this.yaw += dy * (Math.abs(dy) > 1.2 ? 0.8 : 1); this.root.rotation.y = this.yaw; }
  },
  comboSetup() {
    const c = this.combo, S = this.COMBO[c.n]; c.t = 0; c.hit = new Set(); c.fired = 0; c.queued = false; this.aimFace(c, true); c.strikes = null; c.dur = S.dur;
    if (S.strikes) c.strikes = S.strikes.map(s => ({ ...s, k: this.freeArm(s.k), fired: false })).filter(s => s.k);
    if (c.n === 3) c.smashFired = false;
    this.stats.punches++; this.g.sfx.whoosh();
  },
  updateCombo(dt) {
    const c = this.combo, tm = this.tempoMul; c.t += dt / tm; const S = this.COMBO[c.n], t = c.t;
    if (!(c.strikes && c.strikes.some(x => x.fired)) && !c.smashFired) this.aimFace(c, false);      // keep tracking the crosshair target until the first strike lands
    const nearT = S.smash ? 0.3 : Math.max(...c.strikes.map(x => x.th)); c.moveVel = t < nearT && t > 0.04 ? V(Math.sin(this.yaw) * 4.2, 0, Math.cos(this.yaw) * 4.2) : null;
    if (S.smash) {
      if (!c.smashFired && t >= 0.62) {
        c.smashFired = true; const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), ctr = V(this.pos.x + fx * 2.6, this.pos.y, this.pos.z + fz * 2.6), P = this.g.props;
        this.meleeHit({ reach: 4.6, fwd: 1.4, cos: -0.1, dmg: 46, push: 24, launch: 7, wall: 190, prop: 22, propDmg: 70, final: true, once: c.hit, yaw: c.faceYaw });
        this.shock(ctr, 6, 18, 14, 5, 90, 20, 40); P.cracks.add(ctr.x, this.pos.y, ctr.z, 5.5, 10); P.debris.burst(V(ctr.x, this.pos.y + 0.3, ctr.z), 28, 9, 0.22, 0xa8a49c, 1);
        this.g.camera.addTrauma(0.85); this.g.camera.kick(0.07); this.g.sfx.crash(0.8); this.g.fx.surface.ring(V(ctr.x, this.pos.y + 0.1, ctr.z), V(0, 1, 0), 9, 0.45, 0xffc080); this.stats.slams++;
      }
    } else for (const s of c.strikes) if (!s.fired && t >= s.th) { s.fired = true; this.meleeHit({ reach: 3.7, fwd: 1.2, cos: 0.2, dmg: s.dmg, push: s.push, launch: s.kind === 'upper' ? 4 : 0, wall: 55, prop: 13, propDmg: 26, once: c.hit, yaw: c.faceYaw }); }
    // next strike (queued click) once the hit has landed, otherwise recover and finish
    const hitDone = S.smash ? c.smashFired : c.strikes.every(s => s.fired), earliest = S.smash ? 9 : Math.max(...c.strikes.map(s => s.th)) + 0.06;
    if (c.queued && hitDone && t >= earliest && c.n < 3) { c.n++; this.comboSetup(); return; }
    if (t >= c.dur) { const wasLast = c.n === 3; this.cd.z = Math.max(this.cd.z, 0); this.combo = null; if (this.lastL) this.tail = { L: this.lastL, t: 0.2 }; void wasLast; }
  },
  comboLayer(dt) {
    const c = this.combo, S = this.COMBO[c.n], t = c.t, L = mkPose(), free = new Set(PAIRS.flat().filter(k => !this.usedArms().has(k)));
    L.w = smooth(t / 0.08) * (t > c.dur - 0.12 ? smooth((c.dur - t) / 0.12) : 1); let twist = 0, bump = 0;
    if (S.smash) {
      const raise = smooth(t / 0.5), slam = easeIn((t - 0.5) / 0.12), rec = smooth((t - 0.66) / 0.4);
      for (const k of ARMS) { if (!free.has(k)) continue; const up = k[0] === 'U'; const R = hand(k, up ? 0.3 : 0.5, up ? 1.5 : 1.25, 0.2), Sx = hand(k, up ? 0.35 : 0.45, up ? -0.9 : -1.0, 1.15), G = up ? hand(k, 0.5, 0.45, 0.75) : hand(k, 0.5, 0.05, 0.62);
        let p = G.clone().lerp(R, raise); p = p.lerp(Sx, slam); p = p.lerp(G, rec); arm(L, k, p, hand(k, 0.9, 0.3, -0.5)); L.curl[k] = 1; }
      L.d.spine = D(-0.45 * raise + 1.0 * slam * (1 - rec), 0, 0); L.d.chest = D(-0.2 * raise + 0.6 * slam * (1 - rec), 0, 0); L.d.head = D(0.1 * raise - 0.3 * slam, 0, 0); squat(L, 0.15 + 0.35 * slam * (1 - rec) - 0.1 * raise, 0.15); L.off[2] = 0.35 * slam * (1 - rec);
    } else {
      const guard = k => k[0] === 'U' ? hand(k, 0.5, 0.45, 0.75) : hand(k, 0.5, 0.05, 0.62), fxd = {};
      for (const k of ARMS) { if (!free.has(k)) continue; arm(L, k, guard(k), hand(k, 0.9, 0.3, -0.4)); L.curl[k] = 1; }
      for (const s of c.strikes) {
        const k = s.k, up = k[0] === 'U', G = guard(k), Wd = up ? hand(k, 0.95, 0.55, -0.1) : hand(k, 0.85, 0.1, -0.1);
        let E = up ? hand(k, 0.35, 0.55, 1.3) : hand(k, 0.4, 0.15, 0.98); if (s.kind === 'hook') E = up ? hand(k, 1.15, 0.5, 0.85) : hand(k, 1.0, 0.1, 0.8); if (s.kind === 'upper') E = up ? hand(k, 0.4, 1.0, 0.9) : hand(k, 0.4, 0.7, 0.8);
        let p; if (t < s.t0) p = G.clone().lerp(Wd, smooth(t / s.t0)); else if (t < s.th) p = Wd.clone().lerp(E, easeOut((t - s.t0) / (s.th - s.t0))); else p = E.clone().lerp(G, smooth((t - s.th) / (s.te - s.th)));
        arm(L, k, p, hand(k, 0.9, s.kind === 'hook' ? 0.5 : 0.1, -0.4)); const pulse = smooth(1 - Math.abs(t - s.th) / 0.14); twist += s.tw * pulse; bump = Math.max(bump, pulse);
      }
      twist = clamp(twist, -1, 1); L.d.chest = D(0.15 * bump, -0.5 * twist, 0); L.d.spine = D(0.3 * bump, -0.25 * twist, 0); L.d.hips = D(0.05, 0.2 * twist, 0); L.d.head = D(-0.1 * bump, 0.3 * twist, 0); squat(L, 0.18 + 0.1 * bump, 0.2); L.off[2] = 0.18 * bump;
    }
    return L;
  },

  // ============================================================================================== Q Grab & Slam
  startSlam() {
    if (!this.canAct()) return; if (this.cd.q > 0) return this.g.hud.toast('GRAB & SLAM  ' + this.cd.q.toFixed(1) + 's'); this.blocking = false;
    let hold = this.holds.find(h => h.kind === 'enemy');
    if (!hold) {
      if (!this.freePairs().length) return this.g.hud.toast('ARMS FULL'); const e = this.enemies(7, 0.0)[0]; if (!e) return this.g.hud.toast('NO ENEMY IN RANGE');
      const a = this.beginAct('slam', { stage: 'reach', target: e.h, speedMul: 1, faceYaw: Math.atan2(e.h.root.position.x - this.pos.x, e.h.root.position.z - this.pos.z) }); a.moveVel = new THREE.Vector3(); return;
    }
    this.beginAct('slam', { stage: 'lift', hold, speedMul: 0.15 });
  },
  updateSlam(dt, a) {
    this.stageTime(a, dt); const tm = this.tempoMul;
    if (a.stage === 'reach') {
      const d = a.target; if (d.dead || d.held) { this.endAct(); return; }
      const dx = d.root.position.x - this.pos.x, dz = d.root.position.z - this.pos.z, dist = Math.hypot(dx, dz); a.faceYaw = Math.atan2(dx, dz); a.moveVel.set(dx / (dist || 1) * 12, 0, dz / (dist || 1) * 12); a.faceK = 24;
      if (dist < 2.1 || a.st > 0.45) {
        a.moveVel = null; const free = this.freePairs(); if (!free.length) { this.endAct(); return; }
        a.hold = this.startHold('enemy', d, free[0]); a.hold.pt = V(0, 1.9, 1.5); this.setStage(a, 'grab');
      }
    } else if (a.stage === 'grab') { a.hold.pt.set(0, 1.9, 1.5); if (a.st > 0.14 * tm) this.setStage(a, 'lift'); }
    else if (a.stage === 'lift') {
      const u = smooth(a.st / (0.36 * tm)); a.hold.pt.set(0, lerp(1.9, 4.25, u), lerp(1.5, 0.35, u)); a.hold.tilt.set(-0.25 * u, 0); if (u >= 1) this.setStage(a, 'peak');
    } else if (a.stage === 'peak') { if (a.st > 0.1 * tm) { this.setStage(a, 'slam'); a.hold.stiff = 90; this.g.sfx.whoosh(); } }
    else if (a.stage === 'slam') {
      const u = easeIn(a.st / (0.17 * tm)); const ang = u * 1.75; a.hold.pt.set(0, lerp(4.25, 1.1, u), lerp(0.35, 2.75, Math.sin(ang * 0.9) / Math.sin(1.75 * 0.9))); a.hold.tilt.set(lerp(-0.25, -1.4, u), 0);
      if (a.st >= 0.17 * tm) {
        const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), c = V(this.pos.x + fx * 2.9, this.pos.y, this.pos.z + fz * 2.9), h = a.hold, d = h.obj, dir = V(fx, 0, fz);
        this.holds.splice(this.holds.indexOf(h), 1); d.release(); d.slide.set(0, 0, 0); d.air = Math.min(d.air, 0.3); d.airV = 0; d.tilt.set(-1.4, 0); d.tiltV.set(-6, 0);
        d.applyHit(V(c.x, 1.2, c.z), dir.clone(), 38 * this.dmgMul); this.g.hud.hit(V(c.x, 1.6, c.z), Math.round(38 * this.dmgMul), d); d.shove(dir, 7 * this.kbMul);
        this.shock(c, 4.2, 14, 10, 4, 70, 14, 30); const P = this.g.props; P.cracks.add(c.x, this.pos.y, c.z, 4.4, 10); P.debris.burst(V(c.x, this.pos.y + 0.3, c.z), 22, 8, 0.2, 0xa8a49c, 1); P.impactFX(V(c.x, this.pos.y + 0.4, c.z), 1.5, 0xa8a49c, true);
        this.g.fx.surface.ring(V(c.x, this.pos.y + 0.1, c.z), V(0, 1, 0), 7, 0.4, 0xffcf90); this.g.camera.addTrauma(0.75); this.g.camera.kick(0.06); this.g.sfx.crash(0.8); this.stats.slams++; this.setStage(a, 'recover');
      }
    } else if (a.stage === 'recover') { if (a.st > 0.42 * tm) this.endAct('q'); }
  },
  slamLayer(a) {
    const L = mkPose(), st = a.st; L.w = clamp(a.t / 0.08, 0, 1);
    const lean = { reach: 0.5, grab: 0.45, lift: lerp(0.45, -0.4, smooth(st / 0.36)), peak: -0.4, slam: lerp(-0.4, 0.95, easeIn(st / 0.17)), recover: lerp(0.95, 0.1, smooth(st / 0.42)) }[a.stage];
    L.d.spine = D(lean * 0.6, 0, 0); L.d.chest = D(lean * 0.5, 0, 0); L.d.head = D(-lean * 0.3, 0, 0); squat(L, a.stage === 'reach' ? 0.35 : a.stage === 'slam' || a.stage === 'recover' ? 0.3 : 0.18, 0.15);
    if (a.stage === 'reach') for (const k of ['UL', 'UR']) arm(L, k, hand(k, 0.4, 0.4, 1.3), hand(k, 0.9, 0.3, -0.3));
    if (a.stage === 'recover' || !this.holds.length) { const f = a.stage === 'recover' ? 1 - smooth(st / 0.3) : 0; for (const k of ['UL', 'UR']) arm(L, k, hand(k, 0.4, -0.4 * (1 - f) + 0.3 * f, 1.0 + 0.1 * f), hand(k, 0.9, 0.2, -0.3), 0, 'c', 1); }
    return L;
  },

  // ============================================================================================== E Double-Fist Ground Pound
  startPound() {
    if (!this.canAct() || this.holdLifting()) return; if (this.cd.e > 0) return this.g.hud.toast('GROUND POUND  ' + this.cd.e.toFixed(1) + 's'); this.dropAll(false);
    const a = this.beginAct('pound', { stage: this.grounded ? 'crouch' : 'rise', speedMul: 0.3, grav: 34 }); if (!this.grounded) { a.grav = 12; }
  },
  updatePound(dt, a) {
    this.stageTime(a, dt);
    if (a.stage === 'crouch') { a.speedMul = 0.15; if (a.st >= 0.22) { this.vel.y = 19; this.grounded = false; this.mode = 'air'; this.setStage(a, 'rise'); this.jumpFX(); this.g.sfx.roar(); } }
    else if (a.stage === 'rise') { a.grav = 34; if ((this.vel.y < 1.5 && a.st > 0.25) || a.st > 1.0) this.setStage(a, 'hang'); }
    else if (a.stage === 'hang') { a.hover = true; this.vel.y = 0; if (a.st > 0.14) { a.hover = false; this.vel.y = -46; a.grav = 40; a.speedMul = 0; this.setStage(a, 'slam'); this.g.sfx.whoosh(); this.g.camera.kick(0.05); } }
    else if (a.stage === 'slam') {
      this.vel.x *= 0.9; this.vel.z *= 0.9; if (this.grounded) {
        const c = V(this.pos.x, this.pos.y, this.pos.z), P = this.g.props; this.shock(c, 11, 34, 22, 12, 160, 30, 90); this.shockRing(c, 11, 0xffd9a0, 1); P.cracks.add(c.x, this.pos.y, c.z, 8.5, 14); P.cracks.add(c.x + 1.2, this.pos.y, c.z - 1, 5.5, 12);
        P.debris.burst(V(c.x, c.y + 0.3, c.z), 46, 11, 0.24, 0xa8a49c, 1.2); P.impactFX(V(c.x, c.y + 0.4, c.z), 2, 0xa8a49c, true); this.g.camera.addTrauma(1); this.g.camera.kick(0.09); this.g.sfx.crash(1);
        for (let i = 0; i < 28; i++) this.g.fx.dust.emit({ pos: V(c.x, c.y + 0.2, c.z), vel: V(rand(-1, 1), rand(0.05, 0.4), rand(-1, 1)).normalize().multiplyScalar(rand(5, 12)), size: rand(1.4, 2.8), grow: 2, life: rand(0.8, 1.4), drag: 2.4, color: [0.68, 0.66, 0.62], alpha: 0.55 });
        this.an.landV += 14; this.stats.pounds++; a.speedMul = 0; a.lockMove = true; this.setStage(a, 'recover');
      }
    } else if (a.stage === 'recover') { a.lockMove = true; if (a.st > 0.55 * this.tempoMul) this.endAct('e'); }
  },
  poundLayer(a) {
    const L = mkPose(), st = a.st; L.w = clamp(a.t / 0.08, 0, 1);
    const up = (k) => k[0] === 'U' ? hand(k, 0.28, 1.25, 0.25) : hand(k, 0.4, 0.85, 0.2), dn = (k) => hand(k, 0.32, k[0] === 'U' ? -1.25 : -1.15, 1.05);
    for (const k of ARMS) {
      let p, cr = 1;
      if (a.stage === 'crouch') p = hand(k, 0.9, -0.9, -0.5).lerp(hand(k, 1.0, -0.7, -0.7), smooth(st / 0.22)); else if (a.stage === 'rise') p = hand(k, 0.9, -0.9, -0.5).lerp(up(k), smooth(st / 0.18)); else if (a.stage === 'hang') p = up(k); else if (a.stage === 'slam') p = up(k).lerp(dn(k), smooth(st / 0.08)); else p = dn(k);
      arm(L, k, p, hand(k, 0.9, 0.2, -0.5)); L.curl[k] = cr;
    }
    const m = a.stage; if (m === 'crouch') { squat(L, 0.95 * smooth(a.st / 0.2), 0.15); L.d.spine = D(0.4, 0, 0); } else if (m === 'rise' || m === 'hang') { L.d.spine = D(-0.28, 0, 0); L.d.chest = D(-0.2, 0, 0); L.d.thighL = D(-0.6, 0, 0.15); L.d.thighR = D(-0.6, 0, -0.15); L.d.kneeL = D(1.0); L.d.kneeR = D(1.0); L.d.head = D(0.2, 0, 0); }
    else if (m === 'slam') { L.d.spine = D(0.6, 0, 0); L.d.chest = D(0.4, 0, 0); L.d.thighL = D(-0.25, 0, 0.12); L.d.thighR = D(-0.25, 0, -0.12); L.d.kneeL = D(0.35); L.d.kneeR = D(0.35); }
    else { const k = 1 - smooth(st / 0.5); squat(L, 0.85 * k, 0.15); L.d.spine = D(0.55 * k, 0, 0); L.d.chest = D(0.3 * k, 0, 0); }
    return L;
  },
  shockRing(c, radius, color, k) {
    const g = this.g; g.fx.surface.ring(V(c.x, c.y + 0.1, c.z), V(0, 1, 0), radius, 0.55, color); g.fx.surface.ring(V(c.x, c.y + 0.12, c.z), V(0, 1, 0), radius * 0.7, 0.4, 0xffffff);
    for (let i = 0; i < 40 * k; i++) { const a = rand(0, TAU); g.fx.glow.emit({ pos: V(c.x + Math.cos(a) * 1.2, c.y + 0.3, c.z + Math.sin(a) * 1.2), vel: V(Math.cos(a) * rand(8, 20), rand(1, 4), Math.sin(a) * rand(8, 20)), size: rand(0.4, 0.9), life: rand(0.3, 0.6), drag: 2.2, color: [1, 0.75, 0.4] }); }
  },

  // ============================================================================================== F Multi-Grab
  startMulti() {
    if (!this.canAct() || this.holdLifting()) return; if (this.cd.f > 0) return this.g.hud.toast('MULTI-GRAB  ' + this.cd.f.toFixed(1) + 's'); this.blocking = false;
    const have = this.holds.filter(h => h.kind === 'enemy').slice(0, 2);
    let targets = have.map(h => h.obj); const free = this.freePairs(), need = 2 - have.length;
    if (need > 0) { const es = this.enemies(8, -0.2).map(e => e.h).filter(h => !targets.includes(h)).slice(0, Math.min(need, free.length)); targets = targets.concat(es); }
    if (!targets.length) return this.g.hud.toast('NO ENEMIES IN RANGE');
    const a = this.beginAct('multi', { stage: have.length >= targets.length ? 'lift' : 'reach', targets, speedMul: 1, moveVel: new THREE.Vector3(), spin: 0 });
    if (a.stage === 'lift') { a.moveVel = null; a.speedMul = 0.1; a.holdsM = have; }
  },
  updateMulti(dt, a) {
    this.stageTime(a, dt); const tm = this.tempoMul;
    if (a.stage === 'reach') {
      const t0 = a.targets[0]; if (!t0 || t0.dead) { this.endAct(); return; } const mid = V(0, 0, 0); for (const t of a.targets) mid.add(t.root.position); mid.multiplyScalar(1 / a.targets.length);
      const dx = mid.x - this.pos.x, dz = mid.z - this.pos.z, d = Math.hypot(dx, dz); a.faceYaw = Math.atan2(dx, dz); a.moveVel.set(dx / (d || 1) * 11, 0, dz / (d || 1) * 11);
      const near = a.targets.every(t => Math.hypot(t.root.position.x - this.pos.x, t.root.position.z - this.pos.z) < 3.4);
      if (near || a.st > 0.55) {
        a.moveVel = null; a.holdsM = []; const free = this.freePairs();
        a.targets.forEach((t, i) => { if (t.dead || t.held || !free[i]) return; const h = this.startHold('enemy', t, free[i]); h.pt = i ? V(0, 1.5, 1.4) : V(0, 2.6, 1.3); a.holdsM.push(h); });
        if (!a.holdsM.length) { this.endAct(); return; } this.setStage(a, 'lift'); a.speedMul = 0.1; this.g.hud.toast(a.holdsM.length > 1 ? 'MULTI-GRAB' : 'GRABBED');
      }
    } else if (a.stage === 'lift') {
      const u = smooth(a.st / (0.38 * tm)); a.holdsM.forEach((h, i) => { h.pt.set(i ? -0.5 : 0.5, lerp(i ? 1.5 : 2.6, i ? 3.5 : 4.3, u), lerp(1.35, 0.5, u)); h.tilt.set(-0.2 * u, 0); }); if (u >= 1) this.setStage(a, 'smash');
    } else if (a.stage === 'smash') {
      const u = easeIn(a.st / (0.2 * tm)); a.holdsM.forEach((h, i) => { h.stiff = 70; h.pt.set(lerp(i ? -0.5 : 0.5, 0, u), lerp(i ? 3.5 : 4.3, i ? 1.9 : 2.2, u), lerp(0.5, 2.3, u)); h.tilt.set(lerp(-0.2, i ? -0.9 : 0.5, u), 0); });
      if (a.st >= 0.2 * tm) {
        const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), c = V(this.pos.x + fx * 2.6, this.pos.y, this.pos.z + fz * 2.6), P = this.g.props;
        a.holdsM.forEach(h => { h.obj.applyHit(V(c.x, 1.6, c.z), V(fx, 0, fz), 28 * this.dmgMul); this.g.hud.hit(V(c.x, 2, c.z), Math.round(28 * this.dmgMul), h.obj); });
        this.shock(c, 3.8, 10, 8, 3, 30, 10, 20); P.impactFX(V(c.x, this.pos.y + 1.6, c.z), 1.7, 0xa8a49c, true); this.g.fx.glow.emit({ pos: V(c.x, this.pos.y + 1.8, c.z), size: 5, life: 0.18, drag: 0, color: [1, 0.85, 0.6], alpha: 1 }); this.g.camera.addTrauma(0.7); this.g.sfx.crash(0.8); this.stats.slams++;
        this.setStage(a, 'spin'); a.faceK = 0; a.spinYaw = this.yaw; a.hitT = 0;
      }
    } else if (a.stage === 'spin') {
      const dur = 1.0 * tm, rate = TAU * 2.4 / dur; a.spinYaw += rate * dt; a.faceYaw = a.spinYaw; a.faceK = 60;
      const u = smooth(a.st / 0.15); a.holdsM.forEach((h, i) => { h.stiff = 40; h.pt.set(lerp(0, i ? 1.4 : -1.4, u), lerp(2, 2.7, u), lerp(2.3, 0.55, u)); h.tilt.set(-1.2 * u, 0); h.twist = a.st * 6; });
      a.hitT -= dt; if (a.hitT <= 0 && a.st > 0.12) { a.hitT = 0.2; const mine = new Set(a.holdsM.map(h => h.obj)); const before = this.g.world.hittables.filter(x => !mine.has(x)); this.spinHit(before, a); }
      if (a.st >= dur) { this.setStage(a, 'throw'); }
    } else if (a.stage === 'throw') {
      a.faceK = 18; a.faceYaw = this.aimYaw(); const hs = a.holdsM.slice(); hs.forEach((h, i) => this.releaseThrow(h, (hs.length > 1 ? (i ? -1 : 1) : 0) * 0.62)); this.g.camera.addTrauma(0.5); this.g.camera.kick(0.06); this.setStage(a, 'recover');
    } else if (a.stage === 'recover') { if (a.st > 0.4 * tm) this.endAct('f'); }
  },
  spinHit(list, a) {
    const g = this.g, P = g.props; let n = 0;
    for (const h of list) {
      if (h.dead || h.held) continue; const hp = h.root.position, dx = hp.x - this.pos.x, dz = hp.z - this.pos.z, d = Math.hypot(dx, dz); if (d > 3.8) continue; const dir = V(dx / (d || 1), 0, dz / (d || 1)); h.applyHit(V(hp.x, hp.y + 1.3, hp.z), dir.clone(), 12 * this.dmgMul); if (h.shove) h.shove(dir, 18 * this.kbMul); if (h.launch) h.launch(4); g.hud.hit(V(hp.x, hp.y + 1.8, hp.z), Math.round(12 * this.dmgMul), h); n++;
    }
    for (const p of P.props) { if (p.held || p.dead || p.planted) continue; const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z, d = Math.hypot(dx, dz); if (d > 3.8 || p.pos.y > this.pos.y + 3) continue; const k = 16 / Math.sqrt(p.mass / 40 + 1); P.removeBox(p); p.state = 'fly'; p.vel.x += dx / (d || 1) * k; p.vel.z += dz / (d || 1) * k; p.vel.y = 3; p.hit.clear(); n++; }
    if (n) { g.camera.addTrauma(0.25); g.sfx.hit(false); }
    g.fx.surface.ring(V(this.pos.x, this.pos.y + 0.1, this.pos.z), V(0, 1, 0), 7, 0.3, 0xffe0a8);
  },
  multiLayer(a) {
    const L = mkPose(), st = a.st; L.w = clamp(a.t / 0.08, 0, 1);
    const sp = a.stage === 'spin' ? 1 : 0, lean = { reach: 0.5, lift: lerp(0.3, -0.35, smooth(st / 0.38)), smash: lerp(-0.35, 0.8, easeIn(st / 0.2)), spin: -0.12, throw: 0.4, recover: 0.2 * (1 - smooth(st / 0.4)) }[a.stage] ?? 0;
    L.d.spine = D(lean * 0.6, 0, 0); L.d.chest = D(lean * 0.5, 0, 0); squat(L, a.stage === 'spin' ? 0.4 : 0.2, 0.2);
    if (a.stage === 'reach') for (const k of ARMS) arm(L, k, hand(k, 0.45, k[0] === 'U' ? 0.4 : 0.1, 1.2), hand(k, 0.9, 0.2, -0.3));
    if (a.stage === 'throw' || a.stage === 'recover') for (const k of ARMS) arm(L, k, hand(k, 0.7, k[0] === 'U' ? 0.5 : 0.1, 1.0), hand(k, 0.9, 0.2, -0.3));
    void sp; return L;
  },

  // ============================================================================================== G (environment) reach, throw, Z shove, grab reach
  updateGrab(dt, a) {
    this.stageTime(a, dt); const c = a.cand;
    if (c.type === 'enemy' ? (c.obj.dead || c.obj.held) : c.type === 'prop' ? (c.obj.dead || c.obj.held) : !c.obj.alive) { this.endAct(); return; }
    let tx, tz, dist;
    if (c.type === 'prop') { dist = this.edgeDist(c.obj); tx = c.obj.pos.x; tz = c.obj.pos.z; } else if (c.type === 'enemy') { tx = c.obj.root.position.x; tz = c.obj.root.position.z; dist = Math.hypot(tx - this.pos.x, tz - this.pos.z) - 0.8; } else { const b = c.obj.entry; tx = clamp(this.pos.x, b.min.x, b.max.x); tz = clamp(this.pos.z, b.min.z, b.max.z); dist = Math.hypot(tx - this.pos.x, tz - this.pos.z); }
    const dx = tx - this.pos.x, dz = tz - this.pos.z, d = Math.hypot(dx, dz) || 1; a.faceYaw = Math.atan2(dx, dz); a.faceK = 24; a.reachT = (a.reachT || 0) + dt;
    const stand = c.type === 'prop' ? 0.9 : 1.2;
    if (dist > stand && a.st < 0.5) { a.moveVel.set(dx / d * 9, 0, dz / d * 9); a.speedMul = 1; } else { a.moveVel = null; a.speedMul = 0.1; }
    if ((dist <= stand + 0.2 && a.st > 0.14) || a.st > 0.55) { this.finishGrab(c, a.env); this.endAct(); }
  },
  updateThrow(dt, a) {
    this.stageTime(a, dt); const h = a.hold, tm = this.tempoMul; a.faceYaw = this.aimYaw();
    if (!this.holds.includes(h)) { this.endAct(); return; }
    if (a.stage === 'wind') { const u = smooth(a.st / (0.22 * tm)); if (!a.base) a.base = h.pt.clone(); h.pt.set(a.base.x, a.base.y + 0.5 * u, a.base.z - 0.7 * u); if (a.st >= 0.22 * tm) { this.releaseThrow(h); this.setStage(a, 'follow'); } }
    else if (a.stage === 'follow') { if (a.st > 0.34 * tm) this.endAct(); }
  },
  throwLayer(a) {
    const L = mkPose(), st = a.st; L.w = clamp(a.t / 0.08, 0, 1); const big = a.hold && a.hold.kind === 'prop' && a.hold.arms.length === 4;
    if (a.stage === 'wind') { const u = smooth(st / 0.22); L.d.spine = D(-0.35 * u, 0, 0); L.d.chest = D(-0.3 * u, 0.3 * u, 0); squat(L, 0.25 * u, 0.15); }
    else { const u = smooth(st / 0.14), r = smooth(st / 0.34); L.d.spine = D(lerp(-0.35, 0.55, u) * (1 - r) + 0.1 * r, 0, 0); L.d.chest = D(lerp(-0.3, 0.4, u) * (1 - r), 0, 0); squat(L, 0.3, 0.15); L.off[2] = 0.25 * u * (1 - r);
      for (const k of ARMS) { if (this.usedArms().has(k)) continue; arm(L, k, hand(k, 0.55, (k[0] === 'U' ? 0.55 : 0.1) + 0.3 * (1 - u), 1.15 * u + 0.6 * (1 - u)), hand(k, 0.9, 0.2, -0.3)); L.curl[k] = 0.4; } void big; }
    return L;
  },
  startShove() {
    if (!this.canAct() || this.holdLifting()) return; if (this.cd.z > 0) return; this.blocking = false;
    const used = this.usedArms(); this.beginAct('shove', { stage: 'push', speedMul: 1, free: ARMS.filter(k => !used.has(k)) }); this.act.moveVel = V(Math.sin(this.yaw) * 7.5, 0, Math.cos(this.yaw) * 7.5); this.g.sfx.whoosh();
  },
  updateShove(dt, a) {
    this.stageTime(a, dt); if (a.st > 0.22 && a.moveVel) a.moveVel = null; a.faceYaw = this.yaw;
    if (!a.did && a.st >= 0.16) { a.did = true; this.meleeHit({ reach: 3.5, fwd: 1.2, cos: 0.2, dmg: 8, push: 26, launch: 2, wall: 45, prop: 24, propDmg: 14, once: a.once }); this.g.camera.addTrauma(0.2); this.g.sfx.thud(0.6); this.g.fx.dust.emit({ pos: V(this.pos.x + Math.sin(this.yaw) * 1.8, this.pos.y + 1.4, this.pos.z + Math.cos(this.yaw) * 1.8), size: 2.6, grow: 2, life: 0.4, drag: 2, color: [0.8, 0.78, 0.74], alpha: 0.4 }); }
    if (a.st > 0.5) this.endAct('z');
  },
  shoveLayer(a) {
    const L = mkPose(), st = a.st, u = smooth(st / 0.15), r = smooth((st - 0.3) / 0.2); L.w = clamp(a.t / 0.06, 0, 1);
    for (const k of a.free) arm(L, k, hand(k, 0.28, k[0] === 'U' ? 0.55 : 0.2, lerp(0.6, 1.3, u)).lerp(hand(k, 0.5, 0.3, 0.7), r), hand(k, 0.9, 0.2, -0.3)), L.curl[k] = 0.3;
    L.d.spine = D(0.5 * u * (1 - r), 0, 0); L.d.chest = D(0.3 * u * (1 - r), 0, 0); squat(L, 0.3 * (1 - r), 0.2); L.off[2] = 0.3 * u * (1 - r); return L;
  },

  // ============================================================================================== T Rage, R Seismic Slam
  startRage() {
    if (this.rage.on) return this.g.hud.toast('RAGE ACTIVE  ' + this.rage.t.toFixed(1) + 's'); if (this.rage.cd > 0) return this.g.hud.toast('RAGE RECHARGING  ' + this.rage.cd.toFixed(0) + 's');
    if (this.climb || this.mode === 'crouch') return; if (this.act || this.combo) { this.act = null; this.combo = null; } this.blocking = false;
    this.rage.on = true; this.rage.t = this.rage.dur; this.stats.rage++; const a = this.beginAct('roar', { stage: 'roar', speedMul: 0.1, lockMove: this.grounded });
    const g = this.g; g.sfx.roar(); g.camera.addTrauma(0.7); g.camera.kick(0.07); g.hud.toast('RAGE MODE'); this.shockRing(V(this.pos.x, this.pos.y, this.pos.z), 9, 0xff4020, 0.8);
    g.props.shockwave(this.pos, 6, 6, 0, 0);
  },
  endRage(silent) { if (!this.rage.on) return; this.rage.on = false; this.rage.t = 0; this.rage.cd = this.rage.cdDur; if (!silent) this.g.hud.toast('RAGE ENDED'); this.aura.visible = false; this.light.intensity = 0; if (this.ragefx) this.ragefx.style.opacity = '0'; },
  updateRoar(dt, a) { this.stageTime(a, dt); if (a.st > 0.85) this.endAct(); },
  roarLayer(a) {
    const L = mkPose(), st = a.st, u = smooth(st / 0.25), r = smooth((a.st - 0.65) / 0.2); L.w = clamp(a.t / 0.08, 0, 1) * (1 - r * 0.0); const sh = Math.sin(a.t * 40) * 0.03;
    for (const k of ARMS) { const up = k[0] === 'U'; arm(L, k, hand(k, up ? 1.0 : 1.05, (up ? 1.0 : 0.6) + sh, up ? 0.5 : 0.4).lerp(hand(k, 0.5, 0.45, 0.75), r), hand(k, 0.9, 0.2, -0.5)); L.curl[k] = 1; }
    L.d.spine = D(-0.28 * u * (1 - r), 0, 0); L.d.chest = D(-0.32 * u * (1 - r), 0, 0); L.d.head = D(-0.45 * u * (1 - r), 0, 0); squat(L, 0.22 * u * (1 - r), 0.28); return L;
  },
  rageVisuals(dt) {
    const R = this.rage, on = R.on;
    if (R.cd > 0 && !on) R.cd = Math.max(0, R.cd - dt);
    if (on) { R.t -= dt; if (R.t <= 0) this.endRage(false); }
    this.aura.visible = on; this.light.intensity = on ? 28 + 8 * Math.sin(this.an.t * 12) : 0;
    if (on) {
      const p = 1 + 0.08 * Math.sin(this.an.t * 9); this.aura.scale.set(p * (1 + 0.1 * Math.sin(this.an.t * 4)), p, p); this.aura.material.opacity = 0.15 + 0.06 * Math.sin(this.an.t * 13);
      this.emberT -= dt; if (this.emberT <= 0) { this.emberT = 0.025; const g = this.g; g.fx.glow.emit({ pos: V(this.pos.x + rand(-0.9, 0.9), this.pos.y + rand(0.2, 2.8), this.pos.z + rand(-0.9, 0.9)), vel: V(rand(-0.6, 0.6), rand(2, 5), rand(-0.6, 0.6)), size: rand(0.25, 0.6), life: rand(0.5, 0.9), drag: 0.5, color: [1, rand(0.15, 0.4), 0.05], alpha: 0.9 }); }
    }
    if (this.ragefx) this.ragefx.style.opacity = on ? (0.5 + 0.2 * Math.sin(this.an.t * 8)).toFixed(2) : '0';
  },
  startSeismic() {
    if (!this.canAct() || this.holdLifting()) return; if (this.cd.r > 0) return this.g.hud.toast('SEISMIC SLAM  ' + this.cd.r.toFixed(1) + 's'); this.dropAll(false);
    this.beginAct('seismic', { stage: this.grounded ? 'charge' : 'leap', speedMul: 0, lockMove: true, grav: 34 }); this.act.stomps = 0; this.g.hud.toast('SEISMIC SLAM');
  },
  updateSeismic(dt, a) {
    this.stageTime(a, dt); const g = this.g;
    if (a.stage === 'charge') {
      g.camera.addTrauma(dt * 0.9); if (Math.random() < 0.5) g.fx.glow.emit({ pos: V(this.pos.x + rand(-5, 5), this.pos.y + 0.2, this.pos.z + rand(-5, 5)), vel: V(0, rand(1, 3), 0), size: rand(0.3, 0.7), life: 0.5, drag: 1, color: [1, 0.55, 0.15] });
      for (const t of [0.22, 0.5]) if (a.stomps < (t > 0.3 ? 2 : 1) && a.st >= t) { a.stomps++; g.camera.addTrauma(0.35); g.sfx.thud(0.9); g.props.shockwave(this.pos, 5, 6, 0, 0); g.fx.surface.ring(V(this.pos.x, this.pos.y + 0.1, this.pos.z), V(0, 1, 0), 5 + a.stomps * 2, 0.35, 0xff9040); g.props.debris.burst(V(this.pos.x, this.pos.y + 0.2, this.pos.z), 8, 5, 0.14, 0xa8a49c); }
      if (a.st >= 0.78) { this.vel.y = 25; this.grounded = false; this.mode = 'air'; a.lockMove = false; this.setStage(a, 'leap'); this.jumpFX(); g.sfx.roar(); g.camera.kick(0.08); }
    } else if (a.stage === 'leap') { a.lockMove = false; this.vel.x *= 0.96; this.vel.z *= 0.96; if ((this.vel.y < 0.5 && a.st > 0.3) || a.st > 1.3) this.setStage(a, 'hang'); }
    else if (a.stage === 'hang') { a.hover = true; this.vel.y = 0; this.vel.x = this.vel.z = 0; if (Math.random() < 0.7) g.fx.glow.emit({ pos: V(this.pos.x + rand(-1, 1), this.pos.y + rand(2, 4), this.pos.z + rand(-1, 1)), vel: V(0, 3, 0), size: 0.6, life: 0.4, drag: 1, color: [1, 0.5, 0.1] }); if (a.st > 0.2) { a.hover = false; this.vel.y = -58; a.grav = 45; this.setStage(a, 'slam'); g.sfx.whoosh(); g.camera.kick(0.1); } }
    else if (a.stage === 'slam') {
      this.vel.x = this.vel.z = 0; if (this.grounded) {
        const c = V(this.pos.x, this.pos.y, this.pos.z), P = g.props, fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
        this.shock(c, 24, 62, 32, 16, 760, 42, 200); P.cracks.add(c.x, c.y, c.z, 12, 20); P.cracks.add(c.x + 2, c.y, c.z + 1.5, 7, 16);
        for (let i = 1; i <= 6; i++) P.cracks.add(c.x + fx * i * 3.4, c.y, c.z + fz * i * 3.4, 6.2 - i * 0.3, 18);                       // the fissure runs away from the player
        a.rings = 0; a.ringT = 0; a.fissure = 0; P.debris.burst(V(c.x, c.y + 0.4, c.z), 90, 15, 0.34, 0xa8a49c, 1.4); P.impactFX(V(c.x, c.y + 0.5, c.z), 2.4, 0xa8a49c, true);
        g.camera.addTrauma(1); g.camera.kick(0.16); g.sfx.crash(1); g.sfx.roar(); this.an.landV += 18; this.stats.seismic++; this.stats.slams++; a.lockMove = true; this.setStage(a, 'recover');
        const fl = $('gflash'); if (fl) { fl.style.background = 'radial-gradient(ellipse at center, rgba(255,220,160,.95), rgba(255,120,30,.5) 50%, rgba(255,60,0,0) 80%)'; fl.style.opacity = '0.9'; setTimeout(() => { fl.style.opacity = '0'; fl.style.background = ''; }, 140); }
      }
    } else if (a.stage === 'recover') {
      a.ringT += dt; if (a.rings < 3 && a.ringT >= a.rings * 0.13) { a.rings++; const c = V(this.pos.x, this.pos.y, this.pos.z); this.shockRing(c, 10 + a.rings * 7, a.rings === 1 ? 0xffe0a8 : 0xff8a40, a.rings === 1 ? 1.2 : 0.6); g.camera.addTrauma(0.3); }
      a.fissure += dt; if (a.fissure < 0.8) { const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), d = a.fissure * 28; g.fx.glow.emit({ pos: V(this.pos.x + fx * d + rand(-0.5, 0.5), this.pos.y + 0.3, this.pos.z + fz * d + rand(-0.5, 0.5)), vel: V(rand(-1, 1), rand(3, 7), rand(-1, 1)), size: rand(0.5, 1.1), life: rand(0.4, 0.8), drag: 1.5, color: [1, 0.5, 0.12] }); g.fx.dust.emit({ pos: V(this.pos.x + fx * d, this.pos.y + 0.3, this.pos.z + fz * d), vel: V(0, 3, 0), size: 1.8, grow: 2, life: 0.8, drag: 2, color: [0.6, 0.58, 0.55], alpha: 0.5 }); }
      if (a.st > 0.95) this.endAct('r');
    }
  },
  seismicLayer(a) {
    const L = mkPose(), st = a.st; L.w = clamp(a.t / 0.1, 0, 1);
    const wide = k => k[0] === 'U' ? hand(k, 1.15, 0.8, 0.25) : hand(k, 1.2, 0.35, 0.2), up = k => k[0] === 'U' ? hand(k, 0.3, 1.4, 0.2) : hand(k, 0.45, 1.0, 0.15), dn = k => hand(k, 0.3, k[0] === 'U' ? -1.25 : -1.15, 1.0);
    for (const k of ARMS) {
      let p; const shake = a.stage === 'charge' ? Math.sin(a.t * 60 + k.length) * 0.03 : 0;
      if (a.stage === 'charge') p = hand(k, 0.9, -0.8, 0.1).lerp(wide(k), smooth(st / 0.35)); else if (a.stage === 'leap') p = wide(k).lerp(up(k), smooth(st / 0.25)); else if (a.stage === 'hang') p = up(k); else if (a.stage === 'slam') p = up(k).lerp(dn(k), smooth(st / 0.07)); else p = dn(k);
      p.y += shake; arm(L, k, p, hand(k, 0.9, 0.2, -0.5)); L.curl[k] = 1;
    }
    if (a.stage === 'charge') { const s = a.stomps; const sq = 0.5 + 0.4 * Math.abs(Math.sin(st * 9)); squat(L, sq, 0.3); L.d.spine = D(0.25, 0, 0); L.d.chest = D(-0.25, 0, 0); L.d.head = D(-0.3, 0, 0); void s; }
    else if (a.stage === 'leap' || a.stage === 'hang') { L.d.spine = D(-0.32, 0, 0); L.d.chest = D(-0.22, 0, 0); L.d.thighL = D(-0.7, 0, 0.2); L.d.thighR = D(-0.7, 0, -0.2); L.d.kneeL = D(1.1); L.d.kneeR = D(1.1); L.d.head = D(0.25, 0, 0); }
    else if (a.stage === 'slam') { L.d.spine = D(0.7, 0, 0); L.d.chest = D(0.45, 0, 0); L.d.thighL = D(-0.2, 0, 0.12); L.d.thighR = D(-0.2, 0, -0.12); L.d.kneeL = D(0.3); L.d.kneeR = D(0.3); }
    else { const k = 1 - smooth(st / 0.8); squat(L, 0.95 * k, 0.2); L.d.spine = D(0.6 * k, 0, 0); L.d.chest = D(0.35 * k, 0, 0); }
    return L;
  },

  // ============================================================================================== damage taken (turret bolts etc.)
  hitSphere: { y: 1.5, r: 1.4 },
  onHit(dmg, pt, dir) {
    const g = this.g; let d = dmg;
    if (this.blocking && !this.act) { d *= 0.15; this.stats.blocks++; g.sfx.hit(true); g.camera.addTrauma(0.15); g.fx.glow.emit({ pos: pt, size: 3, life: 0.14, drag: 0, color: [1, 0.85, 0.5], alpha: 1 }); g.fx.surface.ring(pt, dir.clone().negate(), 2.2, 0.3, 0xffd9a0); g.props.debris.burst(pt, 6, 6, 0.1, 0x888888); }
    else { if (this.rage.on) d *= 0.5; g.hud.hurt(); g.camera.addTrauma(0.35); }
    this.hp = Math.max(0, this.hp - d); this.hpT = 4; if (this.hp <= 0) { this.hp = 400 * 0.6; g.hud.toast('SECOND WIND'); }
  },

  // ============================================================================================== per-frame
  updatePowers(dt, aimPoint) {
    this.aimPt.copy(aimPoint); for (const k in this.cd) if (this.cd[k] > 0) this.cd[k] = Math.max(0, this.cd[k] - dt);
    if (this.lastCharge > 0) this.lastCharge -= dt; if (this.hpT > 0) this.hpT -= dt; else if (this.hp < 400) this.hp = Math.min(400, this.hp + 30 * dt);
    if (this.act && this.climb) this.act = null;
    const a = this.act; if (a) { ({ slam: this.updateSlam, pound: this.updatePound, multi: this.updateMulti, grab: this.updateGrab, throw: this.updateThrow, shove: this.updateShove, roar: this.updateRoar, seismic: this.updateSeismic })[a.kind].call(this, dt, a); }
    else if (this.combo) this.updateCombo(dt);
    this.updateHolds(dt); this.updateArc(); this.thrownEnemies(dt);
    if (!this.act && !this.combo) this.pushProps(dt, this.wantDir);
    // ---- interaction hint
    let txt = ''; this.mark.visible = false;
    if (!this.act && !this.combo && !this.climb && this.canAct()) {
      const c = this.pickTarget();
      if (c) {
        const o = c.obj, ok = c.ok; this.mark.visible = true; this.mark.material.color.set(ok ? 0xffe45a : 0xff5040);
        if (c.type === 'prop') { this.mark.position.set(o.pos.x, o.pos.y + 0.08, o.pos.z); this.mark.scale.setScalar(Math.max(o.half.x, o.half.z) * 1.3 + 0.35); }
        else if (c.type === 'enemy') { this.mark.position.set(o.root.position.x, o.root.position.y + 0.08, o.root.position.z); this.mark.scale.setScalar(1.0); }
        else { const b = o.entry; this.mark.position.set(clamp(this.pos.x, b.min.x, b.max.x), this.pos.y + 0.08, clamp(this.pos.z, b.min.z, b.max.z)); this.mark.scale.setScalar(1.3); }
        this.mark.scale.multiplyScalar(1 + 0.05 * Math.sin(this.an.t * 7));
        const cat = c.cat === 'enemy' ? 'ENEMY' : c.cat === 'destructible' ? 'DESTRUCTIBLE' : (CATS[c.cat] ? CATS[c.cat].label : c.cat);
        txt = ok ? '[V] ' + (c.type === 'wall' ? 'PULL SLAB — ' : c.type === 'prop' && o.planted ? 'RIP OUT — ' : 'GRAB — ') + c.label + ' · ' + cat : c.why + ' — ' + c.label + ' · ' + cat;
        if (c.type === 'wall') txt += '   (punch · charge · shove to break)';
      }
      if (this.holds.length) { const h = this.holds.find(x => !x.lift); txt = (txt ? txt + '   |   ' : '') + (h ? '[G]/[LMB-if-arms-full] THROW · [V] DROP · [X] DROP ALL' : 'LIFTING…'); }
      else if (!txt) { const pu = this.g.props.props.find(p => p.planted && !p.dead); void pu; }
    }
    if (this.hintEl) { if (this.hintEl.textContent !== txt) this.hintEl.textContent = txt; this.hintEl.hidden = !txt; }
  },
  /** thrown enemies are projectiles too: they hit other enemies on the way */
  thrownEnemies(dt) {
    const g = this.g;
    for (const d of g.world.hittables) {
      if (!(d instanceof Dummy) || !d.thrown || d.dead || d.kv.length() < 9) continue; d._hit = d._hit || new Set();
      for (const o of g.world.hittables) {
        if (o === d || o.dead || o.held || d._hit.has(o) || !(o instanceof Dummy)) continue; if (Math.hypot(o.root.position.x - d.root.position.x, o.root.position.z - d.root.position.z) > 1.5) continue;
        d._hit.add(o); const dir = V(d.kv.x, 0, d.kv.z).normalize(), pt = V(o.root.position.x, 1.5, o.root.position.z), dmg = 24 * this.dmgMul; o.applyHit(pt, dir.clone(), dmg); o.shove(dir, 16 * this.kbMul); o.launch(4); g.hud.hit(pt, Math.round(dmg), o); this.hitFX(pt, dir, true); d.kv.multiplyScalar(0.7); g.camera.addTrauma(0.35); g.sfx.hit(true);
      }
    }
  },
  actLayer(dt) {
    let L = null; const a = this.act;
    if (a) { a.w = 1; L = ({ slam: this.slamLayer, pound: this.poundLayer, multi: this.multiLayer, throw: this.throwLayer, shove: this.shoveLayer, roar: this.roarLayer, seismic: this.seismicLayer, grab: this.grabLayer })[a.kind].call(this, a); }
    else if (this.combo) L = this.comboLayer(dt);
    if (L) { this.lastL = L; this.tail = null; return L; }
    if (this.tail) { this.tail.t -= dt; if (this.tail.t <= 0) { this.tail = null; return null; } const T = this.tail.L; T.w = smooth(this.tail.t / 0.2); return T; }
    return null;
  },
  grabLayer(a) {
    const L = mkPose(), u = smooth(a.st / 0.25); L.w = clamp(a.t / 0.08, 0, 1); const c = a.cand;
    if (c && c.type === 'prop') this.root.worldToLocal(_u.copy(c.obj.center)); else if (c && c.type === 'enemy') this.root.worldToLocal(_u.set(c.obj.root.position.x, 1.3, c.obj.root.position.z)); else _u.set(0, 1.5, 1.5);
    const tgt = _u.clone();
    for (const k of (a.arms || [])) arm(L, k, V(SIDE[k] * 0.55 + tgt.x * 0.4, Math.max(0.3, tgt.y), Math.min(tgt.z, 1.9)), V(SIDE[k], -0.6, -0.3), 0, 'w', u);
    L.d.spine = D(0.5 * u, 0, 0); L.d.chest = D(0.3 * u, 0, 0); squat(L, 0.4 * u, 0.15); return L;
  },
};
