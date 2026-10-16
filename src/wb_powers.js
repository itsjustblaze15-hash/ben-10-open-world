// Way Big's abilities (installed onto WbPlayer): punch, charged heavy punch (both are PHYSICAL punches - no energy on the fists), the chest energy blast (the ONLY ranged attack, it starts at the chest emitter
// attached to the GLB's Omnitrix chest symbol), grab / lift / carry / throw (real reach, mass limit, the object follows the hand - nothing teleports), stomp, defensive stance, footstep contacts and taking hits.
// Contacts are real: the fist / foot / thrown object has to touch the thing (sphere test against the fist, oriented rectangle under the foot, ray through the building lattice).
import * as THREE from 'three';
import { SIDES } from '../animations/waybigrig.js';
import { V, D } from '../animations/stinkflyrig.js';
import { clamp, damp, lerp, rand, angleDelta } from './util.js';

const sin = Math.sin, cos = Math.cos, ease = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
const ARM = 37, EN_MAX = 100, COST = 40, BLAST_CD = 1.4, MAXLIFT = 3.0e5, FISTR = 4.6, BEAM_LEN = 230;
const massText = m => m >= 1e5 ? (m / 1e3 | 0) + ' t' : m >= 1000 ? (m / 1e3).toFixed(1) + ' t' : (m | 0) + ' kg';
const hMass = h => h.mass ?? (h.type ? 0 : (h.constructor && /Turret/.test(h.constructor.name) ? 700 : /Guard/.test(h.constructor.name) ? 95 : 80));

export function installWbPowers(Cls) {
  const P = Cls.prototype;
  P.initPowers = function () {
    this.act = null; this.cd = { lmb: 0, q: 0, e: 0, r: 0 }; this.energy = EN_MAX; this.enMax = EN_MAX; this.enT = 0; this.lmbDown = false; this.hold = null; this.sideIdx = 0; this.extraDrop = 0; this.stompFoot = null; this.stompSide = 0;
    this.chestW = new THREE.Vector3(); this.aim = new THREE.Vector3(0, 0, -50); this.aimHit = false; this.bodyS = []; for (let i = 0; i < 9; i++) this.bodyS.push({ p: new THREE.Vector3(), r: 8 }); this.heavyCharge = 0; this.beamT = 0; this.beamK = 0; this.beamDir = new THREE.Vector3(0, 0, 1); this.beamEnd = new THREE.Vector3();
    this.toastT = 0; this.reachGoal = 0; this.leanGoal = 0; this.grabHint = null; this.hint2T = 0;
  };
  // ---------------------------------------------------------------------------------------------------- input
  P.keyDown = function (code) {
    if (code === 'KeyQ') this.startBlast(); else if (code === 'KeyE') { if (this.hold) this.releaseHold(); else this.startGrab(); } else if (code === 'KeyR') this.startStomp();
  };
  P.keyUp = function () {};
  P.mouseDown = function () { this.lmbDown = true; if (this.hold) { this.startThrow(); return; } this.startPunch(); };
  P.mouseUp = function () { this.lmbDown = false; };
  P.cancelAll = function () {
    if (this.hold) this.dropHold(); this.act = null; this.lmbDown = false; this.heavyCharge = 0; this.stompFoot = null; this.extraDrop = 0; this.reachGoal = this.leanGoal = 0; if (this.fx) this.fx.hideBeam(); this.beamK = 0;
  };
  P.toast = function (m) { if (this.toastT > 0) return; this.toastT = 1.2; this.g.hud.toast(m); };

  // ---------------------------------------------------------------------------------------------------- per-frame
  P.updatePowers = function (dt, aimPoint, aimHit) {
    this.toastT = Math.max(0, this.toastT - dt); this.aim.copy(aimPoint); this.aimHit = !!aimHit;
    if (this.energy < EN_MAX) { this.enT -= dt; if (this.enT <= 0 && !(this.act && this.act.kind === 'blast')) this.energy = Math.min(EN_MAX, this.energy + 11 * dt); }
    if (this.act) this.tickAct(dt);
    else { this.reachGoal = damp(this.reachGoal, 0, 6, dt); this.leanGoal = damp(this.leanGoal, 0, 6, dt); }
    this.extraDrop = damp(this.extraDrop, this.act || this.hold ? this.reachGoal : 0, 8, dt); this.an.rc = damp(this.an.rc, this.leanGoal, 7, dt);
    if (this.hold) this.tickHold(dt);
    this.updateThrown(dt);
    // beam envelope + glow
    if (this.fx) { const a = this.act; if (a && a.kind === 'blast') { const k = a.stage === 'charge' ? clamp(a.t / a.chargeT, 0, 1) : a.stage === 'fire' ? 1 : 0.4; this.fx.chestGlow(this.chestW, k); } if (this.beamK < 0.01) this.fx.hideBeam(); }
    this.grabHintUpdate(dt);
  };
  P.chestWorld = function (out) { return out.copy(this.chestW); };
  P.updateAttachments = function () {
    const R = this.rig; R.att.chest.getWorldPosition(this.chestW);
    const sp = this.bodyS, B = R.bones; const gp = (b, o) => b.getWorldPosition(o);
    gp(B.head, sp[0].p); sp[0].p.y += 2; sp[0].r = 8.5; gp(B.spine2, sp[1].p); sp[1].r = 13.5; gp(B.hips, sp[2].p); sp[2].r = 13;
    for (const [i, k] of [[3, 'L'], [4, 'R']]) { gp(R.legs[k].hip, _a); gp(R.legs[k].knee, _b); sp[i].p.copy(_a).lerp(_b, 0.5); sp[i].r = 8; gp(R.legs[k].ankle, _c); sp[i + 2].p.copy(_b).lerp(_c, 0.5); sp[i + 2].r = 7.5; }
    for (const [i, k] of [[7, 'L'], [8, 'R']]) { gp(R.arms[k].e, sp[i].p); sp[i].r = 5.5; }
  };
  /** distance from point p to the nearest part of his body (surface) + the closest surface point */
  P.nearestBody = function (p) {
    let best = { d: 1e9, point: null, i: -1 }; for (let i = 0; i < this.bodyS.length; i++) { const s = this.bodyS[i], d = s.p.distanceTo(p) - s.r; if (d < best.d) best = { d, point: s.p.clone().sub(p).setLength(Math.max(0, s.p.distanceTo(p) - s.r)).add(p), i }; }
    return best;
  };
  /** segment vs his body (for projectiles): first sphere hit or null */
  P.intersectBody = function (o, d, maxT) {
    let best = null; for (const s of this.bodyS) { const m = _a.subVectors(o, s.p), b = m.dot(d), c = m.lengthSq() - s.r * s.r; if (c > 0 && b > 0) continue; const disc = b * b - c; if (disc < 0) continue; const t = Math.max(0, -b - Math.sqrt(disc)); if (t <= maxT && (!best || t < best)) best = t; }
    return best;
  };
  P.tickAct = function (dt) {
    const a = this.act; a.t += dt; a.age = (a.age || 0) + dt;
    if (a.kind === 'punch' || a.kind === 'heavy') this.tickPunch(dt, a); else if (a.kind === 'blast') this.tickBlast(dt, a); else if (a.kind === 'grab') this.tickGrab(dt, a); else if (a.kind === 'throw') this.tickThrow(dt, a); else if (a.kind === 'stomp') this.tickStomp(dt, a); else if (a.kind === 'putdown') this.tickPutdown(dt, a);
  };

  // ---------------------------------------------------------------------------------------------------- targeting helpers
  P.shoulder = function (side) { return this.shW[side]; };
  /** how far a point is beyond comfortable standing reach, and the body adjustment (crouch / lean) that closes it */
  P.setReach = function (T, side) {
    const sh = this.shW[side], hd = Math.hypot(T.x - this.pos.x, T.z - this.pos.z), vy = T.y - 57.5 * this.U, dist = Math.hypot(hd - 2, vy), need = Math.max(0, dist - (ARM*this.U) * 0.86);
    this.reachGoal = clamp(need * (T.y < 40 ? 0.85 : 0.35), 0, 19); this.leanGoal = clamp(need * 0.017 + (T.y < 25 ? 0.12 : 0), 0, 0.85); void sh;
    return { hd, dist, need };
  };
  P.aimPointOrForward = function (h = 40) {
    if (this.aimHit || this.aim.distanceTo(this.pos) < 400) { return this.aim.clone(); }
    return this.fwdV(_e).multiplyScalar(40).add(this.pos).setY(h);
  };

  /** where this punch will really land: the crosshair direction from the shoulder, cut at the first thing inside striking range (building cell, wall, prop, enemy, ground) or at maximum reach (a punch into empty air) */
  P.punchTarget = function (side, out = new THREE.Vector3()) {
    const sh = this.shW[side], far = this.aimPointOrForward(), dir = _e.copy(far).sub(sh); let L = dir.length(); if (L < 1) { dir.copy(this.fwdV(_a)); L = 1; } else dir.multiplyScalar(1 / L);
    let t = Math.min(L, (ARM*this.U) * 0.86 + 20); const w = this.g.world, hit = w.raySolid(sh, dir, t); if (hit) t = hit.t;
    for (const h of w.hittables) { if (h.dead || h.held || !h.intersect) continue; const r = h.intersect(sh, dir, t); if (r) t = r.t; }
    return out.copy(sh).addScaledVector(dir, t);
  };

  // ---------------------------------------------------------------------------------------------------- punch / heavy punch
  P.startPunch = function () {
    if (this.act || this.hold || this.cd.lmb > 0 || this.mode !== 'ground' || this.flinchT > 0.25 || this.guard) return;
    const side = this.sideIdx++ % 2 ? 'L' : 'R', far = this.aimPointOrForward(), T = this.punchTarget(side); const fy = Math.atan2(far.x - this.pos.x, far.z - this.pos.z);
    this.act = { kind: 'punch', label: 'PUNCH', stage: 'wind', t: 0, side, heavy: false, charge: 0, faceYaw: fy, faceK: 9, hit: new Set(), T, lockMove: false, moveMul: 0.25, prev: new THREE.Vector3().copy(this.poser.fistW[side]), contact: false, windT: 0.26, lunged: 0 };
    this.setReach(T, side); this.g.sfx.whoosh && this.g.sfx.whoosh(); this.stats.punches++;
  };
  P.tickPunch = function (dt, a) {
    const k = a.side;
    if (a.stage !== 'strike' && a.stage !== 'hold' && a.stage !== 'recover') { const far = this.aimPointOrForward(); this.punchTarget(k, a.T); a.faceYaw = Math.atan2(far.x - this.pos.x, far.z - this.pos.z); this.setReach(a.T, k); }
    if (a.stage === 'wind') {
      if (!this.lmbDown && a.t >= a.windT) { this.beginStrike(a); }
      else if (this.lmbDown && a.t >= a.windT + 0.14) { a.kind = 'heavy'; a.label = 'HEAVY PUNCH'; a.heavy = true; a.stage = 'charge'; a.t = 0; this.stats.heavies++; this.g.sfx.charge && this.g.sfx.charge(0.9); }
    } else if (a.stage === 'charge') {
      a.charge = clamp(a.t / 1.05, 0, 1); this.heavyCharge = a.charge; a.lockMove = true; this.g.camera.addTrauma(0.002 + 0.01 * a.charge * dt * 20); if (!this.lmbDown) { this.beginStrike(a); } else if (a.t > 4) this.beginStrike(a);
    } else if (a.stage === 'strike') {
      this.punchContact(a, dt); if (a.t >= a.sd || (a.contact && a.t > a.sd * 0.45)) { a.stage = 'hold'; a.t = 0; }
      if (a.lunged < 1 && a.lungeV) { this.vel.x += a.lungeV.x * dt * 10; this.vel.z += a.lungeV.z * dt * 10; }
    } else if (a.stage === 'hold') { if (a.t >= (a.heavy ? 0.14 : 0.06)) { a.stage = 'recover'; a.t = 0; } }
    else if (a.stage === 'recover') {
      if (a.t >= a.rd) { this.cd.lmb = a.heavy ? 0.4 : 0.05; this.act = null; this.heavyCharge = 0; if (this.lmbDown && !a.heavy && !this.hold) { this.startPunch(); } }
    }
  };
  P.beginStrike = function (a) {
    const T = a.T, sh = this.shW[a.side], hd = Math.hypot(T.x - this.pos.x, T.z - this.pos.z); a.stage = 'strike'; a.t = 0; a.sd = a.heavy ? 0.3 : 0.22; a.rd = a.heavy ? 0.8 : 0.5; a.dir = _a.copy(T).sub(sh).normalize().clone(); a.lockMove = false; a.moveMul = 0.1; a.prev.copy(this.poser.fistW[a.side]);
    a.power = a.heavy ? 0.45 + 0.75 * a.charge : 0.3; a.lungeV = null;
    // lunge: step into the blow when the target is farther than a comfortable standing reach
    const gap = hd - ((ARM*this.U) * 0.8 + this.rad); if (gap > 0) { const lv = Math.min(gap, a.heavy ? 20 : 12) / 0.2; a.lungeV = new THREE.Vector3(T.x - this.pos.x, 0, T.z - this.pos.z).normalize().multiplyScalar(lv * 0.1); this.vel.x += a.lungeV.x * 6; this.vel.z += a.lungeV.z * 6; }
    this.g.sfx.whoosh && this.g.sfx.whoosh(); this.g.camera.addTrauma(a.heavy ? 0.1 : 0.03);
  };
  /** the fist really touches things: buildings (lattice ray along the fist's path), the ground, props, walls, enemies */
  P.punchContact = function (a, dt) {
    const g = this.g, k = a.side, f = this.poser.fistW[k], prev = a.prev, mv = _b.copy(f).sub(prev), mvl = mv.length(), dir = mvl > 0.05 ? mv.clone().multiplyScalar(1 / mvl) : a.dir.clone(), heavy = a.heavy, pw = a.power ?? 0.3; void dt;
    const lead = _c.copy(f).addScaledVector(dir, (FISTR*this.U) * 0.8), D = this.D;
    // 1) buildings
    if (!a.hitB) {
      let hp = null; const id = D.cellAtPoint(lead.x, lead.y, lead.z); if (id >= 0) hp = { point: lead.clone() }; else if (mvl > 0.1) { const h = D.ray(prev, dir, mvl + (FISTR*this.U)); if (h) hp = { point: h.point }; }
      if (hp && _d.copy(hp.point).sub(this.shW[k]).dot(a.dir) < 0) hp = null;   // a building behind the cocked fist is not what this punch is aimed at
      if (hp) { a.hitB = true; a.contact = true; const r = (heavy ? 11 + 7 * pw : 9) * this.U, dmg = (heavy ? 380 + 900 * pw : 260) * this.pwr; const n = D.damageSphere(hp.point.clone().addScaledVector(dir, 3), r, dmg, { dir, src: 'punch' }); this.stats.cells += n; this.fx.crashAt(hp.point, heavy ? 12 + 8 * pw : 7, heavy ? 0.25 + 0.3 * pw : 0.1); g.sfx.hit(heavy); this.stats.hits++; if (heavy) g.camera.kick(0.06); }
    }
    // 2) ground
    const fgy = this.g.world.terrain ? this.g.world.terrain.height(f.x, f.z) : 0;
    if (!a.hitG && f.y - fgy < 3.2 && dir.y < -0.15) { a.hitG = true; a.contact = true; const x = f.x, z = f.z; this.fx.crashAt(_d.set(x, fgy + 1, z), heavy ? 10 : 5, heavy ? 0.22 : 0.06); this.fx.skirt(x, z, heavy ? 12 : 6, heavy ? 12 : 6, heavy ? 10 : 6); this.crushDisk(x, z, heavy ? 10 : 6, 900, heavy ? 320 : 160, 5.0e6 * (heavy ? 1.2 : 0.4)); g.props.cracks.add(x, 0, z, heavy ? 22 : 12, 14); g.sfx.thud(heavy ? 0.8 : 0.5); }
    // 3) enemies, props, walls (sphere around the fist)
    const R = (FISTR*this.U) + (heavy ? 1.4 : 0), J = (heavy ? 1.2e7 : 2.4e6) * (heavy ? 0.4 + pw : 1);
    for (const h of g.world.hittables) {
      if (h.dead || h.held || a.hit.has(h) || !h.spheres || !h.root) continue;
      for (const s of h.spheres) { _d.copy(s.local); h.root.localToWorld(_d); if (_d.distanceTo(f) < s.r + R) { a.hit.add(h); a.contact = true; this.hitTarget(h, _d.clone(), dir, (heavy ? 520 : 190) * (heavy ? 0.5 + pw : 1), J); break; } }
    }
    const PS = g.props;
    for (const p of PS.props) {
      if (p.dormant || p.held || p.dead || a.hit.has(p)) continue; const hh = p.half, cx = clamp(f.x, p.pos.x - hh.x, p.pos.x + hh.x), cy = clamp(f.y, p.pos.y, p.pos.y + p.size.h), cz = clamp(f.z, p.pos.z - hh.z, p.pos.z + hh.z);
      if (Math.hypot(cx - f.x, cy - f.y, cz - f.z) < R) { a.hit.add(p); a.contact = true; this.hitProp(p, dir, J, heavy ? 900 : 650); }
    }
    for (const w of PS.walls) { if (!w.alive || a.hit.has(w)) continue; const b = w.entry, cx = clamp(f.x, b.min.x, b.max.x), cy = clamp(f.y, b.min.y, b.max.y), cz = clamp(f.z, b.min.z, b.max.z); if (Math.hypot(cx - f.x, cy - f.y, cz - f.z) < R) { a.hit.add(w); a.contact = true; PS.damageWall(w, heavy ? 1200 : 700, f.clone(), dir.clone()); this.stats.hits++; } }
    prev.copy(f);
  };
  /** damage + impulse on one hittable (Dummy / Guard / Turret / Target / WbFoe) */
  P.hitTarget = function (h, point, dir, dmg, J) {
    dmg *= this.pwr; J *= this.pwr;
    const g = this.g; this.stats.hits++; this.stats.hitsDealt = (this.stats.hitsDealt || 0) + 1;
    if (h.hurt) { h.hurt(dmg, dir, J, 'wb'); if (h.dead) this.stats.kills = this.stats.kills; } else {
      h.applyHit(point.clone(), dir.clone(), dmg); const m = hMass(h); const v = Math.min(42, J / Math.max(30, m));
      if (h.shove) h.shove(_e.copy(dir).setY(0).normalize(), v); if (h.launch) h.launch(clamp(v * 0.3, 3, 14));
    }
    g.hud.hit(point.clone(), Math.round(dmg), h); g.sfx.hit(dmg > 300); g.camera.addTrauma(clamp(dmg / 1600, 0.04, 0.3)); g.fx.glow.emit({ pos: point, size: 9, life: 0.1, drag: 0, color: [1, 0.95, 0.8], alpha: 0.9 });
  };
  P.hitProp = function (p, dir, J, dmg) {
    dmg *= this.pwr; J *= this.pwr;
    const PS = this.g.props; this.stats.hits++; PS.hurt(p, dmg); if (p.dead) { this.fx.crashAt(p.center, 5, 0.1); return; }
    if (!p.planted) { const v = Math.min(60, J / p.mass); PS.removeBox(p); p.state = 'fly'; p.vel.x += dir.x * v; p.vel.z += dir.z * v; p.vel.y = Math.max(p.vel.y, Math.min(22, 4 + v * 0.25)); p.spin.set(rand(-3, 3), rand(-3, 3), rand(-3, 3)); p.hit.clear(); p.age = 0; }
    this.fx.crashAt(p.center, 4, 0.06);
  };
  /** a flat disk of damage on the ground (fist / foot slam contact) */
  P.crushDisk = function (x, z, r, dmgProp, dmgFoe, J) {
    dmgProp *= this.pwr; dmgFoe *= this.pwr; J *= this.pwr;
    const g = this.g, PS = g.props;
    for (const p of PS.props) { if (p.dormant || p.held || p.dead) continue; const d = Math.hypot(p.pos.x - x, p.pos.z - z); if (d < r + Math.max(p.half.x, p.half.z) && p.pos.y < 6) { if (p.planted || p.mass < 6000) PS.hurt(p, dmgProp); else PS.hurt(p, dmgProp * 0.5); if (!p.dead && !p.planted) { const dir = _e.set(p.pos.x - x, 0, p.pos.z - z).normalize(); PS.removeBox(p); p.state = 'fly'; p.vel.x += dir.x * 14; p.vel.z += dir.z * 14; p.vel.y = 8; p.spin.set(rand(-2, 2), rand(-2, 2), rand(-2, 2)); } this.stats.crushed++; } }
    for (const h of g.world.hittables) { if (h.dead || h.held || !h.root) continue; const rp = h.root.position, rad = h.kind === 'foe' ? h.rad : 1; if (Math.hypot(rp.x - x, rp.z - z) < r + rad && rp.y < 8) { const dir = _e.set(rp.x - x, 0, rp.z - z).normalize(); this.hitTarget(h, new THREE.Vector3(rp.x, rp.y + 1, rp.z), dir.clone(), h.kind === 'foe' && h.giant ? dmgFoe * 0.25 : dmgFoe, J); this.stats.crushed++; } }
    for (const w of PS.walls) { if (!w.alive) continue; const b = w.entry, cx = clamp(x, b.min.x, b.max.x), cz = clamp(z, b.min.z, b.max.z); if (Math.hypot(cx - x, cz - z) < r) PS.damageWall(w, 700, new THREE.Vector3(cx, 1, cz), _e.set(cx - x, 0, cz - z).normalize().clone()); }
    this.D.crushArea(x, z, r, r, 0, dmgFoe * 1.4, 14);
  };

  // ---------------------------------------------------------------------------------------------------- chest energy blast
  P.startBlast = function () {
    if (this.act || this.hold || this.mode !== 'ground' || this.flinchT > 0.25) { return; }
    if (this.cd.q > 0) { this.toast('CHEST BLAST RECHARGING'); return; } if (this.energy < COST) { this.toast('NOT ENOUGH ENERGY'); return; }
    this.energy -= COST; this.enT = 1.6; this.cd.q = BLAST_CD + 0.9;
    this.act = { kind: 'blast', label: 'CHEST BLAST', stage: 'charge', t: 0, chargeT: 0.6, lockMove: true, faceYaw: this.aimYaw(), faceK: 7, tickT: 0, dmgSet: new Set(), moveMul: 0 }; this.stats.blasts++; this.g.sfx.charge && this.g.sfx.charge(0.6);
  };
  /** blast direction: from the chest emitter toward the crosshair target, limited to +-70 deg of where he faces and -45..+35 deg of pitch */
  P.blastDir = function (out) {
    const o = this.chestW, T = this.aimPointOrForward(), d = out.copy(T).sub(o); if (d.lengthSq() < 4) d.copy(this.fwdV(_e)); d.normalize();
    const fy = this.yaw, ay = Math.atan2(d.x, d.z), dy = clamp(angleDelta(fy, ay), -1.2, 1.2), pitch = clamp(Math.asin(clamp(d.y, -1, 1)), -0.8, 0.6);
    const yy = fy + dy; return out.set(sin(yy) * cos(pitch), sin(pitch), cos(yy) * cos(pitch)).normalize();
  };
  P.tickBlast = function (dt, a) {
    a.faceYaw = this.aimYaw();
    if (a.stage === 'charge') { this.beamK = 0; if (a.t >= a.chargeT) { a.stage = 'fire'; a.t = 0; this.g.sfx.boom && this.g.sfx.boom(0.7); this.g.camera.addTrauma(0.35); this.g.camera.kick(0.05); this.vel.x -= sin(this.yaw) * 5; this.vel.z -= cos(this.yaw) * 5; } }
    else if (a.stage === 'fire') {
      const dur = 0.85, k = clamp(Math.min(a.t / 0.08, (dur - a.t) / 0.15), 0, 1); this.beamK = k; this.blastDir(this.beamDir); a.tickT -= dt; this.g.camera.addTrauma(0.012);
      if (a.tickT <= 0) { a.tickT = 0.085; this.blastTick(a); } this.fx.beam(this.chestW, this.beamDir, this.beamLen || (BEAM_LEN*this.U), k);
      if (a.t >= dur) { a.stage = 'cool'; a.t = 0; this.beamK = 0; this.fx.hideBeam(); }
    } else if (a.stage === 'cool' && a.t >= 0.4) { this.act = null; }
  };
  P.blastTick = function (a) {
    const g = this.g, o = this.chestW, d = this.beamDir, D = this.D; let len = (BEAM_LEN*this.U); this.blastDir(d);
    if (d.y < -1e-3) len = Math.min(len, -o.y / d.y);
    const res = D.carve(o, d, len, 6.5, 200, 20); let end = res.end.clone(), L = end.distanceTo(o); this.stats.cells += res.cells;
    const w = g.world; const sb = w.raySolid(o, d, L, true); if (sb) { L = sb.t; end = o.clone().addScaledVector(d, L); }   // arena structure that is not part of the district stops the beam
    // enemies on the segment
    for (const h of w.hittables) {
      if (h.dead || !h.spheres || !h.root) continue; for (const s of h.spheres) { _c.copy(s.local); h.root.localToWorld(_c); const t = clamp(_a.copy(_c).sub(o).dot(d), 0, L), dist = _b.copy(o).addScaledVector(d, t).distanceTo(_c); if (dist < s.r + 3.2) { this.hitTarget(h, _c.clone(), d.clone(), 55, 1.4e6); break; } }
    }
    for (const p of g.props.props) { if (p.dormant || p.dead || p.held) continue; const c = p.center, t = clamp(_a.copy(c).sub(o).dot(d), 0, L), dist = _b.copy(o).addScaledVector(d, t).distanceTo(c); if (dist < Math.max(p.half.x, p.half.z, p.size.h / 2) + 3.5) this.hitProp(p, d, 2.0e6, 140); }
    for (const wl of g.props.walls) { if (!wl.alive) continue; const b = wl.entry, c = _c.set((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2), t = clamp(_a.copy(c).sub(o).dot(d), 0, L); if (_b.copy(o).addScaledVector(d, t).distanceTo(c) < Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2 + 2.5) g.props.damageWall(wl, 160, c.clone(), d.clone()); }
    this.beamLen = L; this.beamEnd.copy(end);
    g.fx.glow.emit({ pos: end, size: 24, life: 0.1, drag: 0, color: [1, 0.55, 0.35], alpha: 0.9 }); g.fx.dust.emit({ pos: end, vel: _a.set(rand(-1, 1), rand(0, 1), rand(-1, 1)).multiplyScalar(14), size: 12, grow: 2, life: 1, drag: 1.6, color: [0.55, 0.52, 0.5], alpha: 0.4 });
    if (end.y < 3) { g.props.cracks.add(end.x, 0, end.z, 14, 8); }
  };

  // ---------------------------------------------------------------------------------------------------- grab / lift / carry / throw
  /** things he could grab (props + enemies) in front of him, within his real arm reach, picked by the crosshair */
  P.adapt = function (o) {
    if (o.cat !== undefined && o.pos) return { kind: 'prop', o, mass: o.mass, name: o.kind.toUpperCase(), size: Math.max(o.size.w, o.size.h, o.size.d), center: () => o.center.clone(), setCenter: v => { o.pos.set(v.x, v.y - o.size.h / 2, v.z); this.g.props.syncRoot(o); }, dead: () => o.dead };
    if (o.isBoss || o.isTrainBot) { const hh = (o.cfg && o.cfg.h) || o.h || 2.4; return { kind: 'boss', o, mass: o.cfg && o.cfg.mass || 400, name: o.label || o.name || 'ENEMY', size: hh, center: () => { const q = (o.isAlbedo && o.cur) ? o.cur.pos : o.root.position; return new THREE.Vector3(q.x, q.y + hh * 0.5, q.z); }, setCenter: v => { o.root.position.set(v.x, v.y - hh * 0.5, v.z); if (o.isAlbedo && o.cur) { o.cur.pos.set(v.x, v.y - hh * 0.5, v.z); o.cur.vel && o.cur.vel.set(0, 0, 0); o.cur.root.updateMatrixWorld(true); } if (o.home && o.home !== o.root.position) o.home.set(v.x, v.y - hh * 0.5, v.z); o.root.updateMatrixWorld(true); }, dead: () => o.dead || o.present === false }; }
    return { kind: 'foe', o, mass: o.mass, name: o.name, size: o.h, center: () => new THREE.Vector3(o.home.x, o.air + o.h * 0.5, o.home.z), setCenter: v => { o.home.x = v.x; o.home.z = v.z; o.air = v.y - o.h * 0.5; o.root.position.set(o.home.x, o.air, o.home.z); o.root.updateMatrixWorld(true); }, dead: () => o.dead };
  };
  P.findGrab = function (strict = true) {
    const g = this.g, fw = this.fwdV(_e), cam = g.camera, ao = cam.aimOrigin, ad = cam.aimDir; let best = null, bs = 1e9; const c = new THREE.Vector3(); let tooHeavy = null;
    const consider = (ob, cen, mass, size, bias = 1) => {
      const dx = cen.x - this.pos.x, dz = cen.z - this.pos.z, hd = Math.hypot(dx, dz) || 1; if (hd > (ARM*this.U) + 14 + size * 0.4 || cen.y > 70) return; if ((dx * fw.x + dz * fw.z) / hd < 0.15 && hd > 14) return;
      if (strict && mass > (MAXLIFT*this.pwr)) { tooHeavy = tooHeavy || ob; return; }
      const perp = _a.copy(cen).sub(ao).cross(ad).length(), sc = (perp + 0.25 * hd) * bias; if (sc < bs) { bs = sc; best = ob; }
    };
    for (const p of g.props.props) { if (p.dormant || p.held || p.dead || (p.state !== 'rest' && p.state !== 'slide')) continue; if (p.size.w > 40) continue; consider(p, p.center, p.mass, Math.max(p.size.w, p.size.h, p.size.d)); }
    for (const f of this.D.foes) { if (f.dead || f.held || f.air > 0.5) continue; consider(f, c.set(f.home.x, f.h * 0.5, f.home.z), f.mass, f.h); }
    for (const b of (g.bossList || []).concat(g.trainBots ? g.trainBots.list : [])) { if (!b || b.dead || b.held || b.present === false || !b.root || !b.root.visible) continue; const hh = (b.cfg && b.cfg.h) || b.h || 2.4, bp = (b.isAlbedo && b.cur) ? b.cur.pos : b.root.position; consider(b, c.set(bp.x, bp.y + hh * 0.5, bp.z), 400, hh, 0.3); }      // V30: Kevin / Vilgax / Albedo / training robots
    for (const d of g.world.hittables) { if (d.kind !== 'foe' && d.constructor.name === 'Guard' && !d.dead && !d.held) { /* guards / dummies are too small to pick up with a 12 m hand: they are punched or stepped on */ } }
    return { best, tooHeavy };
  };
  P.startGrab = function () {
    if (this.act || this.hold || this.mode !== 'ground' || this.flinchT > 0.25 || this.guard || this.cd.e > 0) return;
    const r = this.findGrab(true); if (!r.best) {
      if (r.tooHeavy) { this.toast(r.tooHeavy.name + ' IS TOO HEAVY TO LIFT'); this.cd.e = 0.6; return; }
      // a building directly ahead is not liftable
      const h = this.D.ray(_a.copy(this.pos).setY(30), this.fwdV(_b), 70); if (h) { this.toast('BUILDINGS CAN\'T BE LIFTED'); } else this.toast('NOTHING TO GRAB IN REACH'); this.cd.e = 0.5; return;
    }
    const ob = this.adapt(r.best), cen = ob.center(), two = ob.mass > 6000 || ob.size > 9, gp = cen.clone(); gp.y += Math.min(ob.size * 0.28, 6) - (ob.kind === 'foe' ? 0 : 0);
    const gap = Math.hypot(cen.x - this.pos.x, cen.z - this.pos.z);
    this.act = { kind: 'grab', label: 'GRAB', stage: 'reach', t: 0, ob, two, gp, side: 'R', lockMove: true, moveMul: 0, faceYaw: Math.atan2(cen.x - this.pos.x, cen.z - this.pos.z), faceK: 6, dur: 0.6 + gap / 75, start: this.poser.fistW.R.clone(), startL: this.poser.fistW.L.clone() };
    this.setReach(gp, 'R'); this.stats.grabs++;
  };
  P.tickGrab = function (dt, a) {
    const ob = a.ob; if (ob.dead() || (ob.o.held && !this.hold)) { this.act = null; return; }
    const cen = ob.center(); a.gp.copy(cen); a.gp.y += Math.min(ob.size * 0.28, 6); a.faceYaw = Math.atan2(cen.x - this.pos.x, cen.z - this.pos.z); this.setReach(a.gp, 'R');
    const hd = Math.hypot(cen.x - this.pos.x, cen.z - this.pos.z), need = hd - ((ARM*this.U) * 0.8 + this.rad + ob.size * 0.2);
    if (a.stage === 'reach') {
      // walk up to it if it is farther than his reach (he does not teleport the object; the object only moves once it is gripped)
      if (need > 0) { const dir = _a.set(cen.x - this.pos.x, 0, cen.z - this.pos.z).normalize(); this.vel.x = dir.x * Math.min(16, 4 + need); this.vel.z = dir.z * Math.min(16, 4 + need); }
      const f = this.poser.fistW.R, dist = f.distanceTo(a.gp);
      if (a.t >= a.dur && dist < 10 + ob.size * 0.18) { a.stage = 'grip'; a.t = 0; this.g.sfx.servo && this.g.sfx.servo(0.2); }
      else if (a.t > a.dur + 1.6) { this.toast('OUT OF REACH'); this.act = null; this.cd.e = 0.6; }
    } else if (a.stage === 'grip') {
      if (a.t >= 0.28) { this.beginHold(a); }
    }
  };
  P.beginHold = function (a) {
    const ob = a.ob, k = 'R', fist = this.poser.fistW[k], cen = ob.center(); const o = ob.o;
    if (ob.kind === 'prop') { this.g.props.setHeld(o); o.planted = false; o.driven = false; } else if (ob.kind === 'boss') { o.held = true; if (o.cancelAct) try { o.cancelAct(); } catch (e) { } } else { o.held = true; o.kv.set(0, 0, 0); o.vy = 0; o.atk = null; }
    this.hold = { ob, name: ob.name, mass: ob.mass, massText: massText(ob.mass), speedMul: 1 - 0.45 * clamp((Math.log10(ob.mass) - 2.5) / 3.5, 0, 1), side: k, off: cen.clone().sub(fist), stage: 'lift', t: 0, dur: clamp(0.7 + Math.pow(ob.mass, 0.22) * 0.1, 0.9, 2.4), from: fist.clone(), two: a.two, carryOff: null };
    this.act = null; this.cd.e = 0.3; this.g.sfx.thud(0.3); this.D.wb = this;
  };
  P.holdTarget = function (out, h = this.hold) {
    // carry position: in front of the chest, hand at the object's side
    const s = h.side === 'L' ? 1 : -1; return this.W(-s * 4, 49 + (h.ob.size > 20 ? 4 : 0), 20 + Math.min(10, h.ob.size * 0.25)).clone().copy ? out.copy(this.W(-s * 4, 49 + (h.ob.size > 20 ? 4 : 0), 20 + Math.min(10, h.ob.size * 0.25))) : out;
  };
  P.tickHold = function (dt) {
    const h = this.hold; h.t += dt; const ob = h.ob; if (ob.dead()) { this.hold = null; return; }
    const fist = this.poser.fistW[h.side]; _a.copy(fist).add(h.off); ob.setCenter(_a);
    if (ob.kind === 'prop') { ob.o.vel.set(0, 0, 0); ob.o.yaw = lerpAngle(ob.o.yaw, this.yaw, 1 - Math.exp(-3 * dt)); this.g.props.syncRoot(ob.o); } else if (ob.kind === 'boss') { ob.o.root.rotation.y = lerpAngle(ob.o.root.rotation.y, this.yaw + Math.PI, 1 - Math.exp(-3 * dt)); ob.o.yaw = ob.o.root.rotation.y; } else { ob.o.yaw = lerpAngle(ob.o.yaw, this.yaw + Math.PI, 1 - Math.exp(-3 * dt)); }
    if (h.stage === 'lift' && h.t >= h.dur) { h.stage = 'carry'; h.t = 0; }
    // very hard hit: he drops what he holds
    if (this.flinchT > 0.7) this.dropHold();
  };
  function lerpAngle(a, b, k) { return a + angleDelta(a, b) * k; }
  P.dropHold = function () {
    const h = this.hold; if (!h) return; this.hold = null; const ob = h.ob; if (ob.dead()) return;
    if (ob.kind === 'prop') { this.g.props.release(ob.o, _a.set(0, 0, 0)); ob.o.state = 'fly'; ob.o.thrown = false; ob.o.wbThrown = false; } else if (ob.kind === 'boss') { ob.o.held = false;  if (ob.o.launch) ob.o.launch(0); } else { ob.o.held = false; ob.o.kv.set(0, 0, 0); ob.o.vy = 0; ob.o.air = Math.max(0.01, ob.o.air); ob.o.stagger = 0.8; }
  };
  P.releaseHold = function () {
    const h = this.hold; if (!h || this.act) return; if (h.stage === 'lift') return;
    this.act = { kind: 'putdown', label: 'PUT DOWN', stage: 'lower', t: 0, lockMove: true, moveMul: 0.1, faceYaw: this.yaw, start: this.poser.fistW[h.side].clone() };
  };
  P.tickPutdown = function (dt, a) {
    const h = this.hold; if (!h) { this.act = null; return; }
    if (a.stage === 'lower' && a.t >= 0.85) { a.stage = 'open'; a.t = 0; this.dropHold(); } else if (a.stage === 'open' && a.t >= 0.4) { this.act = null; this.cd.e = 0.4; }
  };
  P.startThrow = function () {
    const h = this.hold; if (!h || this.act || h.stage === 'lift') return; const T = this.aimPointOrForward(20);
    this.act = { kind: 'throw', label: 'THROW', stage: 'wind', t: 0, lockMove: true, moveMul: 0.15, faceYaw: Math.atan2(T.x - this.pos.x, T.z - this.pos.z), faceK: 8, T, released: false }; this.stats.throws++; this.g.sfx.whoosh && this.g.sfx.whoosh();
  };
  P.throwSpeed = function (m) { return 98 * clamp(Math.pow(2000 / m, 0.18), 0.42, 1); };
  P.tickThrow = function (dt, a) {
    const h = this.hold; if (!h) { this.act = null; return; } const T = this.aimPointOrForward(20); if (a.stage !== 'strike') { a.T.copy(T); a.faceYaw = Math.atan2(T.x - this.pos.x, T.z - this.pos.z); }
    if (a.stage === 'wind' && a.t >= 0.42 + 0.1 * clamp(Math.log10(h.mass) - 3, 0, 3)) { a.stage = 'strike'; a.t = 0; }
    else if (a.stage === 'strike') { if (!a.released && a.t >= 0.09) { a.released = true; this.releaseThrow(a); } if (a.t >= 0.2) { a.stage = 'recover'; a.t = 0; } }
    else if (a.stage === 'recover' && a.t >= 0.45) { this.act = null; this.cd.e = 0.5; }
  };
  P.releaseThrow = function (a) {
    const h = this.hold; if (!h) return; this.hold = null; const ob = h.ob, o = ob.o, c = ob.center(), T = a.T, v0 = this.throwSpeed(ob.mass), G = ob.kind === 'prop' ? 26 : 30;
    const dxz = Math.hypot(T.x - c.x, T.z - c.z) || 1, dy = T.y - c.y, ux = (T.x - c.x) / dxz, uz = (T.z - c.z) / dxz;
    // low-angle ballistic solution to the crosshair target; if it is out of range, the 45 deg lob
    const disc = v0 ** 4 - G * (G * dxz * dxz + 2 * dy * v0 * v0); let th = Math.PI / 4;
    if (disc >= 0 && this.aimHit) th = Math.atan((v0 * v0 - Math.sqrt(disc)) / (G * dxz)); else if (!this.aimHit) th = 0.3;
    th = clamp(th, 0.04, 0.9); const vel = new THREE.Vector3(ux * Math.cos(th) * v0, Math.sin(th) * v0, uz * Math.cos(th) * v0);
    if (ob.kind === 'prop') { this.g.props.release(o, vel, new THREE.Vector3(rand(-3, 3), rand(-3, 3), rand(-3, 3))); o.state = 'fly'; o.wbThrown = true; o.dmgMul = 2.5; o.knockMul = 2; o.thrownMass = ob.mass; o.thrown = true; }
    else if (ob.kind === 'boss') { o.held = false; _a.set(ux, 0, uz); const sp = clamp(v0 * 0.32, 14, 30); if (o.shove) o.shove(_a, sp); if (o.launch) o.launch(clamp(vel.y * 0.5, 7, 15)); if (o.applyHit) o.applyHit(c, _a.clone(), 40); o.thrownT = 2.5; this.stats.bossThrows = (this.stats.bossThrows || 0) + 1; }
    else { o.held = false; o.kv.set(vel.x, 0, vel.z); o.vy = vel.y; o.air = Math.max(0.05, c.y - o.h * 0.5); o.thrown = 1; o.thrownBy = this; o.stagger = 2; }
    this.g.camera.addTrauma(0.08 + 0.05 * clamp(Math.log10(ob.mass) - 2, 0, 3)); this.g.sfx.whoosh && this.g.sfx.whoosh(); this.g.sfx.crash && this.g.sfx.crash(0.18);
  };
  /** thrown props against the district (cells) and against enemies: real collisions with mass / speed based damage */
  P.updateThrown = function (dt) {
    const g = this.g, PS = g.props, D = this.D;
    for (const p of PS.props) {
      if (!p.wbThrown || p.dead) continue; if (p.held) { p.wbThrown = false; continue; }
      const sp = p.vel.length(); if (p.state !== 'fly' && sp < 6) { p.wbThrown = false; p.dmgMul = 1; p.knockMul = 1; continue; }
      const c = p.center, r = Math.max(p.half.x, p.half.z, p.size.h * 0.5);
      if (sp > 8 && D.active) {
        _a.copy(p.vel).multiplyScalar(1 / sp); const ray = D.ray(c, _a, sp * dt + r);
        if (ray) { const E = 0.5 * p.mass * sp * sp; D.damageSphere(ray.point.clone().addScaledVector(_a, 2), clamp(Math.cbrt(p.mass) * 0.55, 4, 17), clamp(E / 9000, 40, 950), { dir: _a.clone(), src: 'thrown' }); this.fx.crashAt(ray.point, clamp(r * 2, 5, 16), 0.12); PS.hurt(p, E / 3500); if (!p.dead) { p.vel.multiplyScalar(0.18); p.vel.y = Math.max(p.vel.y, 3); } this.stats.hits++; continue; }
      }
      for (const f of D.foes) {
        if (f.dead || p.hit.has(f)) continue; if (Math.hypot(f.home.x - c.x, f.home.z - c.z) < f.rad + r && c.y < f.air + f.h + 2 && sp > 10) { p.hit.add(f); const E = 0.5 * p.mass * sp * sp; f.hurt(clamp(E / 6000, 5, 900), _a.copy(p.vel).setY(0).normalize(), p.mass * sp * 0.8, 'thrown'); p.vel.multiplyScalar(0.45); PS.hurt(p, E / 5000); this.fx.crashAt(c, 5, 0.06); g.hud.hit(c.clone(), Math.round(E / 6000), f); this.stats.hits++; }
      }
    }
  };
  P.grabHintUpdate = function (dt) {
    this.hint2T -= dt; if (this.hint2T > 0) return; this.hint2T = 0.15;
    let txt = ''; if (this.hold) txt = this.hold.stage === 'lift' ? '<b>LIFTING</b> ' + this.hold.name + ' (' + this.hold.massText + ')' : '<b>E</b> put down · <b>LMB</b> throw ' + this.hold.name.toLowerCase();
    else if (!this.act && this.mode === 'ground') { const r = this.findGrab(false); if (r.best) { const ob = this.adapt(r.best); txt = ob.mass > (MAXLIFT*this.pwr) ? '<b>' + ob.name + '</b> · ' + massText(ob.mass) + ' - too heavy' : '<b>E</b> grab ' + ob.name.toLowerCase() + ' · ' + massText(ob.mass); } }
    this.hint(txt);
  };

  // ---------------------------------------------------------------------------------------------------- stomp
  P.startStomp = function () {
    if (this.act || this.hold || this.mode !== 'ground' || this.flinchT > 0.25 || this.cd.r > 0 || this.guard) return;
    const side = this.stompSide++ % 2 ? 'L' : 'R', T = this.aimPointOrForward(0), fw = this.fwdV(_a); let tx = T.x, tz = T.z; const hd = Math.hypot(tx - this.pos.x, tz - this.pos.z);
    if (hd > 30 || !this.aimHit) { tx = this.pos.x + fw.x * 15; tz = this.pos.z + fw.z * 15; } else if (hd < 6) { tx = this.pos.x + fw.x * 9; tz = this.pos.z + fw.z * 9; }
    this.act = { kind: 'stomp', label: 'STOMP', stage: 'lift', t: 0, side, lockMove: true, moveMul: 0, faceYaw: Math.atan2(tx - this.pos.x, tz - this.pos.z), faceK: 8, tx, tz, start: this.footNow[side].clone() }; this.stompFoot = side; this.step = null; this.stats.stomps++;
  };
  P.tickStomp = function (dt, a) {
    if (a.stage === 'lift' && a.t >= 0.55) { a.stage = 'slam'; a.t = 0; }
    else if (a.stage === 'slam' && a.t >= 0.17) { a.stage = 'recover'; a.t = 0; this.plant[a.side].set(a.tx, 0, a.tz); this.footNow[a.side].copy(this.plant[a.side]); this.stompImpact(a.tx, a.tz, { r: 38, dmg: 900, tremor: 0.6, both: false, side: a.side, big: true }); }
    else if (a.stage === 'recover' && a.t >= 0.6) { this.act = null; this.stompFoot = null; this.cd.r = 0.8; }
  };
  /** the foot comes down on (x, z): everything under the sole is crushed; a physical shock (no glow) shoves / stuns smaller things around it with distance falloff */
  P.stompImpact = function (x, z, o = {}) {
    const g = this.g, R = o.r ?? 38, big = !!o.big; this.fx.skirt(x, z, 14, big ? 18 : 10, big ? 14 : 9, big ? 1.3 : 1);
    this.crushFoot(x, z, this.yaw, o.dmg ?? 400, big ? 1.5 : 1);
    this.fx.crashAt(_d.set(x, 1, z), big ? 14 : 8, 0.35 * (o.tremor ?? 0.5)); g.camera.addTrauma(0.4 * (o.tremor ?? 0.5)); g.sfx.crash(big ? 0.8 : 0.5);
    g.props.cracks.add(x, 0, z, big ? 30 : 18, 18);
    // shock: props + enemies within R, falling off with distance from the FOOT
    const PS = g.props;
    for (const p of PS.props) { if (p.dormant || p.held || p.dead || p.planted) continue; const d = Math.hypot(p.pos.x - x, p.pos.z - z); if (d > R || p.pos.y > 8) continue; const f = 1 - d / R; if (d > 11) { PS.removeBox(p); p.state = 'fly'; const dir = _e.set(p.pos.x - x, 0, p.pos.z - z).normalize(); p.vel.x += dir.x * 22 * f; p.vel.z += dir.z * 22 * f; p.vel.y = Math.max(p.vel.y, 5 + 14 * f); p.spin.set(rand(-2, 2) * f, rand(-2, 2), rand(-2, 2) * f); p.hit.clear(); PS.hurt(p, 160 * f); } }
    for (const h of g.world.hittables) { if (h.dead || h.held || !h.root) continue; const rp = h.root.position, d = Math.hypot(rp.x - x, rp.z - z) - (h.kind === 'foe' ? h.rad : 0); if (d > R || d < 6 || rp.y > 8) continue; const f = 1 - d / R, dir = _e.set(rp.x - x, 0, rp.z - z).normalize(); this.hitTarget(h, new THREE.Vector3(rp.x, rp.y + 1, rp.z), dir.clone(), (h.kind === 'foe' && h.giant ? 90 : 120) * f, 1.4e6 * f); }
    this.D.damageSphere(_d.set(x, 4, z), 15, 120, { src: 'stomp' });
  };
  P.footBoth = function (k, hard) { for (const s of SIDES) { const f = this.footNow[s]; this.footfallAt(f.x, f.z, s, k * (hard ? 1.2 : 1), true); } };

  // ---------------------------------------------------------------------------------------------------- footsteps: real contact areas
  P.footfall = function (k, strength) {
    if (!this.grounded) return; const sole = this.rig.att.sole[k].getWorldPosition(_a); this.footfallAt(sole.x, sole.z, k, strength, false);
  };
  P.footfallAt = function (x, z, k, strength, both) {
    const g = this.g, st = clamp(strength, 0.2, 1.6); this.stats.footfalls++; g.sfx.thud(clamp(0.28 + 0.3 * st, 0.2, 0.7)); g.camera.addTrauma(0.03 + 0.05 * st);
    this.fx.skirt(x, z, 8, 3 + Math.round(4 * st), 5 + 4 * st, 0.7); if (this.noCrush > 0) return;
    this.crushFoot(x, z, this.yaw, 520 * st, st);
    if (st > 0.8 && Math.random() < 0.5) g.props.cracks.add(x, 0, z, 10 + 6 * st, 9);
    void k; void both;
  };
  /** damage everything inside the sole rectangle (7 x 11.6 m) at (x, z) */
  P.crushFoot = function (x, z, yaw, dmg, st = 1) {
    dmg *= this.pwr;
    const g = this.g, PS = g.props, hw = 3.5 * (st > 1.3 ? 1.3 : 1), hl = 5.8 * (st > 1.3 ? 1.2 : 1), c = cos(yaw), s = sin(yaw), inFoot = (px, pz, pad) => { const dx = px - x, dz = pz - z, lx = dx * c - dz * s, lz = dx * s + dz * c; return Math.abs(lx) < hw + pad && Math.abs(lz) < hl + pad; };
    for (const p of PS.props) { if (p.dormant || p.held || p.dead || p.pos.y > 4) continue; if (inFoot(p.pos.x, p.pos.z, Math.max(p.half.x, p.half.z) * 0.8)) { PS.hurt(p, dmg + 100); this.stats.crushed++; if (p.dead) this.fx.crashAt(p.center, 5, 0.05); else if (!p.planted) { PS.removeBox(p); p.state = 'fly'; p.vel.set(rand(-4, 4), 5, rand(-4, 4)); } } }
    for (const w of PS.walls) { if (!w.alive) continue; const b = w.entry; if (b.max.y > 12) continue; const cx = clamp(x, b.min.x, b.max.x), cz = clamp(z, b.min.z, b.max.z); if (inFoot(cx, cz, 0.6)) PS.damageWall(w, dmg * 1.2, new THREE.Vector3(cx, 1, cz), _e.set(cx - x, 0, cz - z).normalize().clone()); }
    for (const h of g.world.hittables) { if (h.dead || h.held || !h.root) continue; const rp = h.root.position; if (rp.y > 5) continue; const pad = h.kind === 'foe' ? h.rad * 0.7 : 0.7; if (inFoot(rp.x, rp.z, pad)) { this.hitTarget(h, new THREE.Vector3(rp.x, rp.y + 0.8, rp.z), _e.set(rp.x - x, 0, rp.z - z).normalize().clone(), h.kind === 'foe' && h.giant ? 45 * st : dmg * 0.6, 6e5 * st); this.stats.crushed++; } }
    const n = this.D.crushArea(x, z, hw, hl, yaw, dmg * 0.5, 12); this.stats.cells += n;
  };

  // ---------------------------------------------------------------------------------------------------- getting hit
  /** damage + impulse from an enemy. Small hits (bullets, troopers) do almost nothing and never move him; a giant's punch staggers him. Defensive stance cuts damage and knock-back. */
  P.takeHit = function (dmg, pt, dir, impulse = 0, src = '') {
    if (!this.alive || !this.root.visible) return; const g = this.g, gd = this.guard ? 1 : 0, A = this.an;
    dmg *= gd ? 0.3 : 1; this.hp = Math.max(0, this.hp - dmg); this.hpT = 5; this.stats.hitsTaken++; this.lastHit = dmg;
    const kv = (impulse / this.massW) * (gd ? 0.3 : 1);       // m/s he is pushed: impulse / his mass
    if (kv >= 2.4 && !(this.act && this.act.kind === 'stomp' && this.act.stage === 'slam')) {
      A.flinch = 1; A.flinchDir.set(dir.x, 0, dir.z); this.flinchT = clamp(0.5 + kv * 0.08, 0.5, 1.2); this.vel.x += dir.x * Math.min(kv * 2.2, 26); this.vel.z += dir.z * Math.min(kv * 2.2, 26); this.stats.flinches++; this.act = null; this.heavyCharge = 0; this.beamK = 0; this.fx.hideBeam();
      g.camera.addTrauma(0.45); g.camera.kick(0.05); g.hud.hurt(); g.sfx.crash(0.55); this.fx.skirt(this.pos.x, this.pos.z, 14, 8, 9, 1);
    } else if (dmg >= 12) { A.flinch = Math.max(A.flinch, 0.35 + (dmg > 40 ? 0.15 : 0)); A.flinchDir.set(dir.x, 0, dir.z); g.camera.addTrauma(0.08 + dmg / 800); if (dmg >= 80) g.hud.hurt(); g.sfx.hit(false); }
    else if (dmg > 0) { g.sfx.hit(false); }
    if (pt && dmg > 8) g.fx.glow.emit({ pos: pt, size: 10 + dmg * 0.1, life: 0.1, drag: 0, color: [1, 0.8, 0.5], alpha: 0.8 });
    if (this.hp <= 0) { this.hp = this.maxHp * 0.5; g.hud.toast('WAY BIG REGENERATES'); this.flinchT = 1.2; A.flinch = 1; this.act = null; if (this.hold) this.dropHold(); }
  };
  /** compat with the arena's turrets / guards (they call onHit(dmg, point, dir)): their small arms barely scratch him */
  P.onHit = function (dmg, pt, dir) { this.takeHit(Math.min(dmg, 14) * 0.25, pt, dir || _d.set(0, 0, 1), 0, 'small'); };
  const WB_MASS = 2.5e6;

  // ---------------------------------------------------------------------------------------------------- arm / body poses for the actions
  P.layerAct = function (P_, dt) {
    const A = this.an, t = A.t; P_.armT = P_.armT || {}; const a = this.act, h = this.hold, yawC = cos(this.yaw), yawS = sin(this.yaw);
    const X = _a.set(yawC, 0, -yawS), Zf = _b.set(yawS, 0, yawC); const Xv = X.clone(), Zv = Zf.clone();
    const rel = (sh, x, y, z) => sh.clone().addScaledVector(Xv, x).addScaledVector(Zv, z).add(V(0, y, 0));
    const set = (k, p, w = 1, pole = null) => { const s = k === 'L' ? 1 : -1; P_.armT[k] = { p, pole: pole || V(s * 0.6, -0.8, -0.25), w, poleW: 1 }; };
    if (this.shipPose) { const sp = this.shipPose; set('L', sp.L, 1, V(0.7, -0.2, -0.3)); set('R', sp.R, 1, V(-0.7, -0.2, -0.3)); P_.curl.L = P_.curl.R = sp.curl; P_.d.chest[0] += sp.lean || 0; P_.d.spine[0] += (sp.lean || 0) * 0.5; return; }
    // ---- defensive stance (Ctrl): knees bent, forearms crossed in front of the chest
    if (A.gd > 0.02) {
      const w = A.gd; for (const k of SIDES) { const s = k === 'L' ? 1 : -1; set(k, this.W(-s * 5.5, 55, 17 + 2 * sin(t * 2 + s)), w, V(s * 0.3, 0.8, 0.3)); }
      P_.d.hips[0] += 0.18 * w; P_.d.spine[0] += 0.18 * w; P_.d.chest[0] += 0.2 * w; P_.d.head[0] -= 0.2 * w; for (const k of SIDES) P_.curl[k] = 0.9 * w + P_.curl[k] * (1 - w);
    }
    // ---- carried object: the gripping hand brings it in front of the chest, the other arm supports
    if (h && !a) {
      const k = h.side, s = k === 'L' ? 1 : -1, u = h.stage === 'lift' ? ease(h.t / h.dur) : 1, tgt = this.W(-s * 4, 50 + (h.ob.size > 20 ? 4 : 0), 20 + Math.min(10, h.ob.size * 0.25));
      const from = h.from; const p = from.clone().lerp(tgt, u); p.y += 4 * Math.sin(Math.PI * u) * (h.stage === 'lift' ? 1 : 0); if (h.stage === 'carry') p.y += 0.7 * sin(t * 2.4) + 0.8 * this.an.mv * sin(this.an.gp * Math.PI * 4);
      set(k, p, 1, V(s * 0.9, -0.5, -0.4)); P_.curl[k] = 1.0; const o = -s; const sup = this.W(o * -2 + (-s) * 1, 47, 17 + Math.min(8, h.ob.size * 0.2)); if (h.two || h.ob.size > 8) { set(o === 1 ? 'L' : 'R', sup, 1, V(o * 0.6, -0.6, -0.3)); P_.curl[o === 1 ? 'L' : 'R'] = 0.9; }
      P_.d.hips[0] += 0.08; P_.d.chest[0] += 0.1 - 0.02 * Math.min(1, Math.log10(h.mass) / 5);
    }
    if (!a) return;
    const k = a.side || 'R', s = k === 'L' ? 1 : -1, o2 = k === 'L' ? 'R' : 'L', sh = this.shW[k];
    if (a.kind === 'punch' || a.kind === 'heavy') {
      const heavy = a.heavy, ch = a.charge || 0;
      const wind = rel(sh, s * (heavy ? 7 + 4 * ch : 3.5), heavy ? -3 + 5 * ch : -6, heavy ? -20 - 8 * ch : -14);
      let p = wind, tw = 0, w = 1, lean = 0;
      if (a.stage === 'wind') { const u = ease(a.t / a.windT); const rest = rel(sh, s * 5, -29, 2.5); p = rest.lerp(wind, u); tw = u * 0.5; lean = -0.05 * u; }
      else if (a.stage === 'charge') { p = wind.clone(); p.y += 0.5 * sin(t * 40) * ch; p.x += 0.4 * sin(t * 33) * ch; tw = 0.5 + 0.35 * ch; lean = -0.1 * ch; }
      else { const tgtv = a.dir.clone(), reach = Math.hypot(a.T.x - sh.x, a.T.y - sh.y, a.T.z - sh.z), L = Math.min(reach, (ARM*this.U) * 0.97), tip = sh.clone().addScaledVector(tgtv, L); const dur = a.sd;
        if (a.stage === 'strike') { const u = ease(a.t / dur); p = wind.clone().lerp(tip, u); tw = 0.5 - 1.15 * u; lean = 0.2 * u; a.last = p.clone(); } else { const u = a.stage === 'hold' ? 0 : ease(a.t / a.rd); p = (a.last || tip).clone(); p = p.lerp(rel(sh, s * 5, -29, 2.5), u); tw = -0.65 * (1 - u); lean = 0.2 * (1 - u); } }
      set(k, p, w, V(s * 0.5, -0.9, -0.2)); P_.curl[k] = 1.0;
      const op = rel(this.shW[o2], -s * -4, -16 + 5 * (a.stage === 'strike' ? 1 : 0), 10); set(o2, op, 1, V(-s * 0.6, -0.8, -0.3)); P_.curl[o2] = 0.9;
      P_.d.chest[1] += s * tw * 0.9; P_.d.spine[1] += s * tw * 0.45; P_.d.hips[1] += s * tw * 0.25; P_.d.hips[0] += lean * 0.6; P_.d.spine[0] += lean * 0.5; P_.d.chest[0] += lean * 0.5;
    } else if (a.kind === 'blast') {
      const u = a.stage === 'charge' ? ease(a.t / a.chargeT) : 1, fire = a.stage === 'fire' ? 1 : 0;
      for (const kk of SIDES) { const ss = kk === 'L' ? 1 : -1, rest = this.armBase[kk].clone(); const tp = this.W(ss * 15, 44, -5 + 4 * fire); set(kk, this.shW[kk].clone().add(rest).lerp(tp, u), 1, V(ss * 0.7, -0.8, -0.5)); P_.curl[kk] = 0.2; }
      const arch = -0.22 * u + 0.28 * fire * ease(Math.min(1, a.t / 0.15)); P_.d.hips[0] += arch * 0.5; P_.d.spine[0] += arch * 0.6; P_.d.chest[0] += arch * 0.8 - 0.1 * u; P_.d.neck[0] -= arch * 0.4; P_.d.head[0] -= arch * 0.3;
    } else if (a.kind === 'grab') {
      const gp = a.gp, u = a.stage === 'reach' ? ease(a.t / a.dur) : 1, start = a.start; let p = start.clone().lerp(gp.clone(), u); if (a.stage === 'reach') p.y += 6 * Math.sin(Math.PI * u) * 0.5;
      set('R', p, 1, V(-0.7, -0.6, -0.4)); P_.curl.R = a.stage === 'grip' ? 0.35 + 0.65 * ease(a.t / 0.28) : 0.15;
      if (a.two) { const side = _c.set(cos(this.yaw), 0, -sin(this.yaw)); const q = gp.clone().addScaledVector(side, 2 + a.ob.size * 0.28).setY(gp.y); set('L', a.startL.clone().lerp(q, u), 1, V(0.7, -0.6, -0.4)); P_.curl.L = a.stage === 'grip' ? 0.3 + 0.7 * ease(a.t / 0.28) : 0.15; }
      else { set('L', rel(this.shW.L, 6, -20, 12), 1, V(0.7, -0.7, -0.3)); P_.curl.L = 0.5; }
      P_.d.chest[1] += -0.25 * u; P_.d.hips[0] += 0.05; P_.d.spine[0] += 0.05;
    } else if (a.kind === 'putdown') {
      const hk = h ? h.side : 'R', ss = hk === 'L' ? 1 : -1, u = a.stage === 'lower' ? ease(a.t / 0.85) : 1, ground = this.W(-ss * 3, 4, 22 + 6); const p = a.start.clone().lerp(ground, u); set(hk, p, 1, V(ss * 0.5, -0.9, -0.3)); P_.curl[hk] = a.stage === 'open' ? 1 - ease(a.t / 0.4) : 1; this.reachGoal = 12 * u; this.leanGoal = 0.3 * u;
    } else if (a.kind === 'throw') {
      const hk = h ? h.side : 'R', ss = hk === 'L' ? 1 : -1, hh = h ? h.ob.size : 4;
      const back = this.W(-ss * 6, 68, -16 - Math.min(8, hh * 0.3)), fwd = this.W(-ss * 3, 56, 40);
      const cur = this.poser.fistW[hk]; let p = back, u = 1, tw = 0;
      if (a.stage === 'wind') { u = ease(a.t / 0.45); p = (h && h.stage ? this.W(-ss * 4, 50, 20) : back.clone()).lerp(back, u); tw = 0.55 * u; } else if (a.stage === 'strike') { u = ease(a.t / 0.2); p = back.clone().lerp(fwd, u); tw = 0.55 - 1.2 * u; a.last = p.clone(); } else { u = ease(a.t / 0.45); p = (a.last || fwd).clone().lerp(rel(sh, ss, -29, 3), u); tw = -0.65 * (1 - u); }
      set(hk, p, 1, V(ss * 0.6, -0.5, -0.5)); P_.curl[hk] = a.released ? 0.1 : 1.0; void cur;
      const op = this.W(ss * 10, 46, 22); set(hk === 'L' ? 'R' : 'L', op, 1, V(-ss * 0.6, -0.5, -0.3)); P_.d.chest[1] += ss * tw * 0.95 * -1 * -1; P_.d.spine[1] += ss * tw * 0.4; P_.d.hips[0] += 0.1 * (a.stage === 'strike' ? 1 : 0); P_.d.chest[0] += -0.18 * (a.stage === 'wind' ? u : 0) + 0.2 * (a.stage === 'strike' ? u : 0);
    } else if (a.kind === 'stomp') {
      const sk = a.side, ss = sk === 'L' ? 1 : -1, other = sk === 'L' ? 'R' : 'L', fw = this.fwdV(_c);
      const lift = a.stage === 'lift' ? ease(a.t / 0.55) : a.stage === 'slam' ? 1 - Math.pow(a.t / 0.17, 2) : 0, land = new THREE.Vector3(a.tx, 0, a.tz);
      // the leg override is applied in stompLegs() (called from updateAnim through P_.stomp)
      P_.stomp = { k: sk, lift, land, up: new THREE.Vector3(a.tx - fw.x * 4, 19, a.tz - fw.z * 4), start: a.start, stage: a.stage, u: a.stage === 'slam' ? a.t / 0.17 : 1 };
      for (const kk of SIDES) { const sx = kk === 'L' ? 1 : -1; set(kk, this.W(sx * (17 + 5 * lift), 40 + 12 * lift, 6), 1, V(sx * 0.7, -0.6, -0.4)); P_.curl[kk] = 0.4; }
      P_.d.hips[2] += -ss * 0.14 * lift; P_.d.spine[2] += ss * 0.1 * lift; P_.d.hips[0] += -0.08 * lift; this.extraDrop = 3 * lift;
      void other;
    }
  };
  // leg override for the stomp (applied after locoPose by the base updateAnim through this hook)
  const baseLoco = Cls.prototype.locoPose;
  Cls.prototype.locoPose = function (dt) {
    const P_ = baseLoco.call(this, dt); const a = this.act; this.stompTmp = null;
    if (a && a.kind === 'stomp') {
      const lift = a.stage === 'lift' ? ease(a.t / 0.55) : a.stage === 'slam' ? 1 - Math.pow(a.t / 0.17, 2) : 0, k = a.side, fw = this.fwdV(_a), up = V(a.tx - fw.x * 4, 19 + this.restY, a.tz - fw.z * 4), land = V(a.tx, this.restY, a.tz), st = a.start.clone().setY(this.restY);
      const p = (a.stage === 'recover') ? land : st.clone().lerp(up, lift).lerp(land, a.stage === 'slam' ? 1 - lift : 0); if (a.stage === 'slam') { const u = clamp(a.t / 0.17, 0, 1); p.copy(up).lerp(land, u * u); }
      const s = k === 'L' ? 1 : -1; P_.legs[k] = { p, pole: V(s * 0.1 * cos(this.yaw) + sin(this.yaw), 0.7, -s * 0.1 * sin(this.yaw) + cos(this.yaw)), w: 1, poleW: 1 };
    }
    return P_;
  };
}
