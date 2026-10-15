// KEVIN 11 - AI-controlled boss villain (never a playable alien). Extends Dummy so every existing attack (shots, punches, beams, thrown props, rolling balls ...) already damages him;
// hits are collected per frame and resolved ONCE through the shared ImpactBody (src/impact.js), so Kevin staggers / slides / falls / is launched exactly like the player does.
//
//   perception  idle patrol -> spot (roar) -> combat -> lose sight -> search -> patrol
//   movement    walk (patrol, search, stalk, nearby approach, circling)  /  run (approach)  /  SUPER-SPEED (tactical only: far or fleeing player, speed-rush punch; cooldown)  /  flight
//   attacks     punch, heavy punch, crystal punch, fire punch, speed-rush punch, crystal shard, fire blast, goo spit, crystal spikes   (weighted by distance, player state, selected alien, own hp)
//   V8 (Four Arms' real strength moves, run through his own AI): overhead SMASH (Four Arms' combo finisher / strongest punch), GROUND SLAM + shockwave (ground pound), SEISMIC slam (phase II+),
//               grab-and-SLAM variant, heavy-OBJECT throw (vehicles / crates / barrels), BLOCK + counter. Standing height = Four Arms' (see KV_SIZE).
//   phases      100-70 % balanced - 70-35 % more aggressive / combos / repositioning - below 35 % existing powers used more often (no new abilities)
//   fairness    visible wind-ups, recovery after strong attacks, cannot act while staggered / knocked down, no damage through walls, no teleports, post-knockdown grace window
import * as THREE from 'three';
import { BossCombat, COMBAT } from './boss_combat.js';
import { Dummy } from './dummies.js';
import { ImpactBody, BODY, attackImpact, groundFX } from './impact.js';
import { KevinAnim } from '../animations/kevinanim.js';
import { KV_SCALE, KV_SIZE } from '../animations/kevinrig.js';
import { KevinShots, KevinHud, segSeg2 } from './kevin_fx.js';
import { clamp, damp, rand, angleDelta, smoothstep } from './util.js';

const UP = new THREE.Vector3(0, 1, 0), AX = new THREE.Vector3(1, 0, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _f = new THREE.Vector3(), _o = new THREE.Vector3(), _dir = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const KS = KV_SIZE;                                                           // V8: Kevin is scaled to Four Arms' height; every length that belongs to his body / reach is multiplied by this
const sm = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const hyp = (x, z) => Math.hypot(x, z);

/** tunables (the spec's anti-spam block + speeds); everything is per-instance so a test / the player can change it live */
export const KCFG = {
  name: 'KEVIN 11', hp: 4000, atkMul: 1.3, rad: 0.85 * KS, h: 2.6 * KS, chestY: 1.6 * KS, eyeY: 2.3 * KS, stand: 2.2 * KS, standTiny: 1.9 * KS, grabStand: 1.7 * KS, grabStandLow: 1.1 * KS, tinyY: 1.4 * KS, tinyR: 1.5 * KS, backDepth: 0.62 * KS, settleY: 0.22 * KS,
  walk: 2.4, stalk: 1.5, run: 7.6, rush: 26, fly: 13.5, flyAlt: 9.5,
  sight: 95, aggression: 0.65, superSpeedCooldown: 12, flightCooldown: 8, dodgeChance: 0.3,
  dmgMul: 0.8, hitCap: 0.05, phases: [0.70, 0.35], maxFlight: 9.5,
  // V6 grab-and-throw (Four Arms' strength). Everything here is live-tunable (KCFG or kevin.cfg).
  grabCd: 15, grabReach: 1.0 * KS, grabMaxMass: 500, grabMaxH: 3.4, throwSpeed: 14, throwSpeedTiny: 11, throwVy: 6.6, throwDmg: 34, grabDmg: 8,
};

/** attack table. kb = knockback force (m/s at the reference mass), up = upward force, kd / lt = knockdown / launch thresholds on the *effective* speed */
export const ATK = {
  punch:        { name: 'punch', anim: 'punch', hit: 'S', dmg: 14, kb: 6.0, up: 0, stag: 0.30, ord: true, wind: 0.36, strike: 0.13, rec: 0.36, reach: 2.65, cd: 0, lunge: 4.2, R: 0.62, track: 5.0 },
  heavy:        { name: 'heavy', anim: 'heavy', hit: 'SS', dmg: 38, kb: 12.8, up: 1.8, stag: 0.75, wind: 0.95, strike: 0.17, rec: 0.95, reach: 3.05, cd: 3.0, lunge: 6.5, R: 0.9, track: 2.6, big: true },
  crystalPunch: { name: 'crystalPunch', anim: 'crystal', hit: 'BR', dmg: 25, kb: 9.2, up: 1.0, stag: 0.50, wind: 0.56, strike: 0.14, rec: 0.60, reach: 2.95, cd: 3.5, lunge: 5.0, R: 0.78, track: 4.0, color: [0.4, 0.95, 1], big: true },
  firePunch:    { name: 'firePunch', anim: 'fire', hit: 'BL', dmg: 20, fire: 10, kb: 8.4, up: 0.6, stag: 0.50, wind: 0.56, strike: 0.14, rec: 0.60, reach: 2.95, cd: 3.5, lunge: 5.0, R: 0.78, track: 4.0, color: [1, 0.55, 0.15], big: true },
  rushPunch:    { rush: true, name: 'rushPunch', anim: 'rush', hit: 'S', dmg: 32, kb: 15.5, up: 2.4, stag: 0.80, wind: 0.60, strike: 0.46, rec: 0.90, reach: 15, minReach: 5.5, cd: 0, R: 0.85, track: 6.0, big: true, color: [0.6, 0.85, 1] },
  flankPunch:   { rush: true, flank: true, name: 'flankPunch', anim: 'rush', hit: 'S', dmg: 18, kb: 7.5, up: 0.6, stag: 0.5, wind: 0.26, strike: 0.42, rec: 0.30, reach: 6, cd: 0, R: 0.8, track: 6.0, color: [0.6, 0.85, 1] },
  timeSlow:     { name: 'timeSlow', anim: 'roar', dmg: 0, kb: 0, up: 0, stag: 0, wind: 1.25, strike: 0.25, rec: 0.7, cd: 0, track: 3.0 },
  crystalShot:  { name: 'crystalShot', anim: 'crystalShot', dmg: 18, kb: 6.4, up: 0.8, stag: 0.40, wind: 0.56, strike: 0.14, rec: 0.50, cd: 3.4, track: 6.0, ranged: true },
  fireBlast:    { name: 'fireBlast', anim: 'fireBlast', dmg: 14, fire: 7, kb: 5.4, up: 0.4, stag: 0.35, wind: 0.50, strike: 0.18, rec: 0.50, cd: 3.0, track: 6.0, ranged: true },
  spikes:       { name: 'spikes', anim: 'crystalShot', dmg: 15, kb: 5.0, up: 3.6, stag: 0.65, wind: 0.80, strike: 0.20, rec: 0.75, cd: 8.0, track: 3.0, ranged: true },
  grab:         { name: 'grab', anim: 'grab', grab: true, dmg: 0, kb: 0, up: 0, stag: 0, wind: 0.55, strike: 0.3, rec: 0.7, cd: 0, track: 5.0 },
  goo:          { name: 'goo', anim: 'goo', dmg: 4, kb: 0, up: 0, stag: 0, wind: 0.62, strike: 0.30, rec: 0.65, cd: 9.0, track: 5.0, ranged: true },
};
const COMBOS = [['flankPunch', 'flankPunch', 'rushPunch'], ['punch', 'heavy'], ['punch', 'punch'], ['punch', 'crystalPunch'], ['firePunch', 'crystalPunch'], ['crystalPunch', 'firePunch'], ['punch', 'punch', 'heavy'], ['firePunch', 'heavy']];
/** V8 Four Arms strength moves (Kevin-only table; Vilgax keeps his own). shockR = radius of the shockwave / area; wind = readable wind-up (arms overhead), cd = cooldown, big = punishable recovery */
const NEW_ATK = {
  smash:   { name: 'smash', anim: 'smash', shockR: 5.5, dmg: 44, kb: 19, up: 3.0, stag: 0.90, wind: 1.15, strike: 0.24, rec: 1.0, reach: 3.7, cd: 6.0, track: 2.2, big: true, color: [1, 0.8, 0.5] },
  slam:    { name: 'slam', anim: 'slam', shockR: 9.5, dmg: 26, kb: 13, up: 4.2, stag: 0.60, wind: 0.95, strike: 0.24, rec: 0.9, reach: 9.5, cd: 8.0, track: 2.4, big: true, color: [1, 0.78, 0.45] },
  seismic: { name: 'seismic', anim: 'slam', shockR: 15, seismic: true, dmg: 40, kb: 20, up: 5.5, stag: 0.80, wind: 1.65, strike: 0.28, rec: 1.3, reach: 15, cd: 24.0, track: 2.0, big: true, color: [1, 0.55, 0.2] },
  propThrow: { name: 'propThrow', anim: 'prop', wind: 0.1, strike: 3, rec: 0.5, cd: 12, track: 3.0 },
  block:   { name: 'block', anim: 'block', wind: 0.16, strike: 0.7, rec: 0.25, cd: 5.0, track: 6.0 },
};
/** Kevin's attack table: the base table with every reach / lunge / hit radius scaled to his new height, plus the Four Arms moves */
const scaleAtk = (T) => { const o = {}; for (const k in T) { const a = Object.assign({}, T[k]); for (const f of ['reach', 'minReach', 'lunge', 'R']) if (a[f] !== undefined && !(f === 'reach' && a.rush && a.reach >= 15)) a[f] *= KS; o[k] = a; } return o; };
export const KATK_K = scaleAtk(Object.assign({}, ATK, NEW_ATK));
const KCOMBOS = [...COMBOS, ['punch', 'punch', 'smash'], ['heavy', 'smash'], ['crystalPunch', 'smash']];

export class Kevin extends Dummy {
  constructor(scene, world, pos, yaw, game, rig) {
    super(scene, world, pos, yaw, 'KEVIN 11');
    this.scene = scene; this.g = game; this.rig = rig; const cfg = this.cfg = Object.assign({}, this.baseCfg());
    this.isBoss = true; this.present = true; this.isKevin = this.baseCfg() === KCFG; this.ks = this.isKevin ? KS : 1; this.name = cfg.name;
    this.root.traverse(o => { if (o.isMesh) o.visible = false; });             // the mannequin Dummy builds is replaced by the Kevin model
    this.bar.visible = false; this.drawBar = () => {}; this.mats = [];
    this.maxHp = this.hp = cfg.hp; this.collider.r = cfg.rad; this.collider.h = cfg.h;
    this.spheres = this.makeSpheres();
    this.setupModel(rig);
    this.matList = []; for (const s of rig.skinned) for (const m of [].concat(s.material)) if (m && m.emissive && !this.matList.includes(m)) { m.userData.e0 = m.emissive.clone(); this.matList.push(m); }
    this.shots = new KevinShots(game, this); this.hudK = this.makeHud();
    this.ib = new ImpactBody(game, Object.assign({}, BODY[this.bodyKey()], {
      getPos: () => this.home, rad: cfg.rad, colH: cfg.h, step: 0.45, ownVertical: true, liftK: 0.2, wallDmg: 1.1,
      damageFn: (d, kind) => this.takeDamage(d * (kind === 'wall' ? 0.7 : 0.55), kind),
      collide: (on) => { if (on) { this._cd = this.collider.dead; this.collider.dead = true; } else this.collider.dead = this._cd; },
      onEvent: (t, d) => this.onBody(t, d),
    }));
    this.bc = new BossCombat(this, COMBAT[this.isKevin ? 'kevin' : 'vilgax']);
    this.spawnYaw = yaw; this.aiOn = true; this.pend = { n: 0, dmg: 0, kx: 0, kz: 0, dx: 0, dz: 0, up: 0, pt: null };
    this.stats = { hits: 0, dmgTaken: 0, dodged: 0, attacks: {}, played: {}, downs: 0, launches: 0, poiseBreaks: 0, rush: 0, flights: 0, landings: 0, combos: 0, phase: 0, playerHits: 0, playerDowns: 0, steps: 0 };
    this.reset0();
  }
  reset0() {
    if (this.bc) this.bc.reset(); const cfg = this.cfg; this.t = 0; this.yaw = this.spawnYaw; this.yawT = this.yaw; this.turnRate = 0; this.spd = 0; this.wantSpd = 0; this.hd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)); this.av = new THREE.Vector3();
    this.st = 'idle'; this.mode = 'ground'; this.act = null; this.intent = { kind: 'approach', t: 0, dur: 1, side: 1 }; this.phase = 0; this.phaseRoar = false; this.alert = 0; this.lostT = 0; this.engageT = 0; this.mem = this.home.clone();
    this.cd = {}; this.tsCd = 8; this.superCd = 4; this.flyCd = 5; this.dodgeCd = 0; this.recoverT = 0; this.decideT = 0.5; this.iframe = 0; this.hitstop = 0; this.counterT = 0; this.surprise = 0; this.flinch = 0; this.fallV = 0; this.fvy = 0; this.flyK = 0;
    this.lastAtk = ''; this.rep = 0; this.hist = []; this.combo = null; this.rushing = null; this.plan = null; this.hitLog = []; this.lastPA = null; this.handFlip = false; this.steerSide = 1; this.stuckT = 0; this.sideT = 0;
    this.wp = null; this.pauseT = 1; this.srchT = 0; this.confuse = 0; this.pGraceT = 0; this.prevPState = 'ok'; this.stepCount = 0; this.trailT = 0; this.lastSeenAt = -99; this.forceMelee = false; this.dead = false; this.deadT = 0; this.hitFlash = 0; this.landT = 0;
    this.ctx = null; this.dbgForce = null;
    this.releaseKProp(); this.kvWaveList = []; this.kvThrownList = []; this.kvBlocking = false; this.kPropCand = null; this.kPropScanT = 0;
  }
  // ---- subclass hooks (Vilgax overrides these; Kevin's own behaviour is unchanged)
  baseCfg() { return KCFG; }
  bodyKey() { return 'kevin'; }
  get ATK() { return KATK_K; }
  get COMBOS() { return KCOMBOS; }
  makeSpheres() { const k = this.ks; return [{ local: new THREE.Vector3(0, 0.2, 0), r: 0.8 }, { local: new THREE.Vector3(0, 0.55, 0), r: 0.55 }, { local: new THREE.Vector3(0, 1.15, 0.05), r: 0.62 }, { local: new THREE.Vector3(0, 1.7, 0.1), r: 0.7 }, { local: new THREE.Vector3(0, 2.25, 0.15), r: 0.42 }, { local: new THREE.Vector3(0.45, 1.65, 0.45), r: 0.4 }, { local: new THREE.Vector3(-0.45, 1.65, 0.45), r: 0.4 }].map(o => { o.local.multiplyScalar(k); o.r *= k; return o; }); }
  setupModel(rig) { rig.modelGroup.scale.setScalar(KV_SCALE); this.root.add(rig.modelGroup); this.anim = new KevinAnim(rig); this.mk = rig.markers; }
  makeHud() { return new KevinHud(); }
  hitPoints() { return null; }
  standDist(c) { return c.tiny ? (this.cfg.standTiny ?? 1.9) : (this.cfg.stand ?? 2.2); }
  onDefeatFX() {}
  get seen() { return this.alert >= 1; }
  // ============================================================================================================================ incoming hits (collected, resolved once per frame)
  applyHit(point, dir, dmg) {
    if (this.dead) return; const p = this.pend; p.n++; p.dmg += dmg; const w = Math.max(dmg, 1); p.dx += dir.x * w; p.dz += dir.z * w; if (point) p.pt = point.clone(); this.hitFlash = 0.14;
  }
  shove(dir, speed) { const p = this.pend; p.n++; p.kx += dir.x * speed; p.kz += dir.z * speed; }
  launch(vy) { const p = this.pend; p.n++; p.up = Math.max(p.up, vy); }
  knock(dir, force) { this.shove(dir, force * 0.9); }
  release() { /* bosses cannot be grabbed */ }
  intersect(o, d, maxT) { if (this.dead && this.deadT > 2.5) return null; return super.intersect(o, d, maxT); }
  resolveHits() {
    const p = this.pend; if (!p.n) return; const g = this.g, P = g.player, cfg = this.cfg, ib = this.ib;
    let dmg = p.dmg, sh = hyp(p.kx, p.kz), up = p.up, mag = hyp(p.dx, p.dz), dx, dz; const pt = p.pt;
    if (sh > 0.05) { dx = p.kx / sh; dz = p.kz / sh; } else if (mag > 1e-4) { dx = p.dx / mag; dz = p.dz / mag; } else { dx = this.home.x - P.pos.x; dz = this.home.z - P.pos.z; const m = hyp(dx, dz) || 1; dx /= m; dz /= m; }
    this.pend = { n: 0, dmg: 0, kx: 0, kz: 0, dx: 0, dz: 0, up: 0, pt: null };
    if (this.dead) return;
    const cx = this.ctx, shE = sh < 0.05 ? clamp(dmg * 0.11, 0, 4.5) : sh, strongHit = this.bc.isStrong(dmg, shE);
    this.bc.incoming(dmg, shE, cx);                                                                                                   // V27: reactive dodge / block (chance, cooldowns), commitment + stun-resistance bookkeeping
    if (this.iframe > 0) { this.stats.dodged++; g.hud.tag(this.home.clone().setY(this.home.y + 2.2), 'DODGED'); return; }              // sidestep i-frames: the hit finds nothing
    if (sh < 0.05) sh = clamp(dmg * 0.11, 0, 4.5);
    { const m = this.mitigate(dmg, sh, up, dx, dz); if (m.skip) return; dmg = m.dmg; sh = m.sh; up = m.up; }                                  // every successful attack moves him a little, even a pure-damage one
    sh = Math.min(sh, 60); this.stats.hits++; this.hitLog.push(this.t);
    let dm = dmg * cfg.dmgMul; if (this.punishing()) dm *= 1.2; dm = Math.min(dm, this.maxHp * cfg.hitCap);
    const r = ib.hit(attackImpact({ damage: dmg, knockbackForce: sh, upwardForce: up * 0.8, staggerDuration: 0.24 + dmg * 0.004, knockdownThreshold: 13, launchThreshold: 24, ordinary: sh < 7, dir: _dir.set(dx, 0, dz).clone() }));
    this.takeDamage(dm, 'hit'); this.flinch = Math.max(this.flinch, clamp(dmg / (this.bc.cur && this.bc.cur.capped ? 70 : 45), 0.16, 0.65));
    { const cap = this.bc.cur && this.bc.cur.capped; if (cap) { const k = cap === 'commit' ? this.bc.cfg.commitPush : 0.7, sp = Math.hypot(ib.kv.x, ib.kv.z), mx = 5.5 * k; if (sp > mx) ib.kv.multiplyScalar(mx / sp); } }   // a disturbed-but-undeterred boss is pushed only a little
    this.bc.afterHit(cx, strongHit);
    if (this.st !== 'combat' && !this.dead) { this.st = 'combat'; this.alert = 1; this.mem.copy(P.pos); this.engageT = 4; }
    if (r.tier >= 2 && this.act && this.act.name !== 'land') this.cancelAct();
    if (pt && r.tier >= 1 && !this.dead) this.g.fx.glow.emit({ pos: pt, size: 1.2, life: 0.1, drag: 0, color: [1, 0.9, 0.7], alpha: 0.8 });
  }
  punishing() { const a = this.act; return !!(a && a.def && a.def.big && a.phase === 'rec'); }
  takeDamage(dm, kind) {
    if (this.dead || dm <= 0) return; this.hp = Math.max(0, this.hp - dm); this.stats.dmgTaken += dm; this.hitFlash = Math.max(this.hitFlash, 0.1);
    const f = this.hp / this.maxHp, ph = f < this.cfg.phases[1] ? 2 : f < this.cfg.phases[0] ? 1 : 0;
    if (this.hp <= 0) return this.die();
    if (ph > this.phase) this.enterPhase(ph);
  }
  enterPhase(ph) {
    this.phase = ph; this.stats.phase = ph; this.phaseRoar = true; this.ib.poise = this.ib.poiseMax; this.g.hud.toast(this.cfg.name + (ph === 1 ? ' — PHASE II · MORE AGGRESSIVE' : ' — PHASE III · ALL-OUT')); this.g.camera.addTrauma(0.2);
    this.combo = null; if (ph === 2) this.superCd = Math.min(this.superCd, 3);
  }
  die() {
    this.hp = 0; this.dead = true; this.deadT = 0; this.defT = 0; this.defLanded = false; this.defBounce = 0; this.bossState = 'defeated'; this.cancelAct(); this.mode = 'ground'; this.plan = null; this.rushing = null; this.retreat = null; this.combo = null; this.aiOn && 0;
    this.shots.clear(); if (this.isKevin) this.g.kTime.end(); this.g.hud.toast(this.cfg.name + ' DEFEATED'); this.onDefeatFX(); this.g.sfx.boom(0.5); this.g.camera.addTrauma(0.3);
    this.av.set(0, 0, 0); this.spd = 0; this.wantSpd = 0; this.fvy = Math.min(this.fvy || 0, 0);
  }
  /** Kevin-only defeat: brief reaction to the last hit, then a controlled fall onto his back (rotation about his heels, lifted so the back rests on the floor), a small settle, then he stays down. No ragdoll. */
  defeatPose(dt) {
    const h = this.home, gy = this.floor(); if (h.y > gy + 0.1) return 0;                          // still airborne: descend first (vertical() does it)
    if (!this.defLanded) { this.defLanded = true; this.defT = 0; }
    this.defT += dt; const t = this.defT, T1 = 0.32, T2 = 0.62;                                    // react, fall duration
    let phi;
    if (t < T1) phi = 0.2 * (t / T1) ** 0.7;                                                       // final-hit recoil: slight lean back
    else if (t < T1 + T2) { const u = (t - T1) / T2; phi = 0.2 + (1.5 - 0.2) * u * u; }            // gravity-like acceleration
    else { const u = t - T1 - T2; phi = 1.5 + 0.06 * Math.exp(-u * 7) * Math.sin(u * 22) * -1 + 0.045 * (1 - Math.exp(-u * 8)); }   // thud + settle at ~92 deg (flat on the back)
    if (!this.defThud && t >= T1 + T2) { this.defThud = true; groundFX(this.g, h, 1); this.g.camera.addTrauma(0.35); this.g.sfx.boom(0.4); }
    return phi;
  }
  respawn() {
    this.dropHeld(); this.grabLive = false; this.releaseKProp(); if (this.kvThrownList) for (const p of this.kvThrownList) p.kv = null;
    this.shots.clear(); if (this.isKevin) { this.g.kTime.end(); this.g.kTime.cd = 0; } this.tsHits = 0; this.hp = this.maxHp; this.home.copy(this.spawn); this.root.position.copy(this.home); this.ib.reset(); this.collider.dead = false; this.reset0(); this.pend = { n: 0, dmg: 0, kx: 0, kz: 0, dx: 0, dz: 0, up: 0, pt: null };
    this.anim.t = 0; this.root.quaternion.identity(); this.hudK.trail = 1;
    this.dead = false; this.deadT = 0; this.defAdj = 0; this.defT = 0; this.defLanded = false; this.defThud = false; this.retreat = null; this.bossState = 'respawning'; this.respawnT = 0.5; this.fallV = 0; this.fvy = 0; this.mode = 'ground';
    this.placeAtSpawn();
  }
  // ============================================================================================================================ BOSS MANAGER hooks (V9)
  /** manager state: despawned (not in the world at all) / alive / defeated (body on the ground, waiting for RESPAWN) */
  get mgrState() { return !this.present ? 'despawned' : this.dead ? 'defeated' : 'alive'; }
  /** SPAWN: put the ONE instance into the world (hittables + collision + visible), full reset, placed at a safe designated spot. Repeated calls while present do nothing (no duplicates). */
  bossSpawn() {
    if (this.present) return false; const w = this.world;
    if (!w.hittables.includes(this)) w.hittables.push(this); if (!w.cylinders.includes(this.collider)) w.cylinders.push(this.collider);
    this.present = true; this.root.visible = true; this.aiOn = true; this.respawn(); return true;
  }
  /** DESPAWN: complete removal from play (not just invisible): AI / update stop (it leaves world.hittables), no collision, no hits, no projectiles / waves / props, any grab or goo it caused on the player is released, bar hidden */
  bossDespawn() {
    if (!this.present) return false; const g = this.g, w = this.world, imp = g.impact;
    this.respawn();                                                                                   // the shared reset: drops held things, clears shots / waves / thrown props / time slow, resets the AI + the body
    if (imp.ctrl.by === this || (imp.ctrl.mode === 'sticky' && this.isKevin)) { if (imp.ctrl.mode === 'grabbed') imp.release(null, 0, 0); else imp.unlock(); }
    this.act = null; this.aiOn = false; this.present = false; this.collider.dead = true;
    const hi = w.hittables.indexOf(this); if (hi >= 0) w.hittables.splice(hi, 1); const ci = w.cylinders.indexOf(this.collider); if (ci >= 0) w.cylinders.splice(ci, 1);
    this.root.visible = false; this.hudK.hide(); return true;
  }
  /** a valid boss spawn: not inside a building, not under the map, not on top of the player */
  placeAtSpawn() {
    const g = this.g, w = g.world, P = g.player, sp = this.spawn, cand = [[0, 0]]; for (let r = 4; r <= 16; r += 4) for (let k = 0; k < 8; k++) cand.push([Math.cos(k * 0.785) * r, Math.sin(k * 0.785) * r]);
    let best = null;
    for (const [ox, oz] of cand) {
      const p = _a.set(sp.x + ox, sp.y, sp.z + oz).clone(), y0 = p.y; const cd = this.collider.dead; this.collider.dead = true; w.resolveXZ(p, this.cfg.rad, y0 + 0.2, this.cfg.h, 0.45); this.collider.dead = cd;
      const moved = Math.hypot(p.x - (sp.x + ox), p.z - (sp.z + oz)); if (moved > 0.05) continue;
      const gy = w.groundAt(p.x, p.z, y0 + 0.5, 1.0, this.cfg.rad * 0.5); if (!(gy > -1) || Math.abs(gy - sp.y) > 1.5) continue;
      if (w.lagoon && w.lagoon.depthAt && w.lagoon.depthAt(p.x, p.z) > 0.3) continue;
      if (Math.hypot(p.x - P.pos.x, p.z - P.pos.z) < 8) continue;
      if ((g.bossList || []).some(o => o !== this && o.present && o.home && Math.hypot(p.x - o.home.x, p.z - o.home.z) < 7)) continue;     // never on top of another boss
      best = [p.x, gy, p.z]; break;
    }
    if (!best) best = [sp.x, sp.y, sp.z];
    this.home.set(best[0], best[1], best[2]); this.root.position.copy(this.home);
    const dx = P.pos.x - this.home.x, dz = P.pos.z - this.home.z; this.yaw = this.yawT = Math.atan2(dx, dz);
  }
  // ============================================================================================================================ body events
  onBody(t, d) {
    switch (t) {
      case 'heavy': case 'knockdown': case 'launch':
        if (this.act && this.act.name !== 'land') this.cancelAct();
        if (t !== 'heavy') { this.mode = 'ground'; this.plan = null; this.rushing = null; this.combo = null; this.av.set(0, 0, 0); this.spd = 0; this.stats[t === 'launch' ? 'launches' : 'downs']++; this.g.hud.tag(this.home.clone().setY(this.home.y + 2.8), t === 'launch' ? 'LAUNCHED' : 'KNOCKED DOWN'); }
        else this.combo = null;
        break;
      case 'upright': this.recoverT = 0.5; this.intent = { kind: 'approach', t: 0, dur: 1, side: 1 }; this.decideT = 0.45; this.counterT = 0; this.combo = null; break;
      case 'poiseBreak': this.stats.poiseBreaks++; this.g.hud.tag(this.home.clone().setY(this.home.y + 2.8), 'POISE BROKEN'); break;
      case 'land': this.mode = 'ground'; break;
    }
  }
  onPlayerHit(name, res) { if (this.g.kTime.active) this.tsHits = (this.tsHits || 0) + 1; this.stats.playerHits++; this.stats.played[name] = (this.stats.played[name] || 0) + 1; if (res && res.tier >= 3) this.stats.playerDowns++; }
  stateLabel() {
    const ib = this.ib, a = this.act; if (this.dead) return 'DEFEATED';
    if (ib.state === 'air') return 'LAUNCHED'; if (a && a.name === 'timeSlow' && a.phase === 'wind') return 'TIME SLOW!'; if (this.g.kTime.active) return 'TIME SLOW'; if (ib.state === 'stagger' && ib.tier >= 2) return 'STAGGERED';
    if (this.rushing || (a && a.def && a.def.rush && a.phase !== 'rec')) return 'SUPER-SPEED'; if (a && a.def && a.def.big && a.phase === 'wind') return 'WINDING UP'; if (a && a.def && a.def.big && a.phase === 'rec') return 'RECOVERING';
    if (this.kvBlocking) return 'BLOCKING'; if (this.mode === 'fly') return 'AIRBORNE'; if (this.st === 'idle') return 'UNAWARE'; if (this.st === 'search') return 'SEARCHING'; return '';
  }
  // ============================================================================================================================ perception
  sense(dt) {
    const g = this.g, P = g.player, h = this.home, cfg = this.cfg, id = g.chars.id, pr = P.rad ?? 0.5, ph = P.colH ?? 2.2;
    const giant = id === 'waybig', tiny = id === 'greymatter' || ph < 0.7;
    const dx = P.pos.x - h.x, dz = P.pos.z - h.z, dc = hyp(dx, dz) || 1e-3, cy = P.pos.y + Math.min(ph * 0.5, giant ? 18 : 1.15);
    const pv = P.form === 'ball' ? P.v : P.vel, pvx = pv ? pv.x : 0, pvz = pv ? pv.z : 0, pspeed = hyp(pvx, pvz), radial = (pvx * dx + pvz * dz) / dc;          // radial < 0: closing in
    const dy = cy - (h.y + (cfg.chestY ?? 1.6)), d3 = Math.hypot(dc - pr * 0.5, dy);
    const hidden = !!(g.stealth && g.stealth.hidden) && dc > 7, pSwim = P.pos.y < -0.8 || (P.mode === 'swim' && P.pos.y < -0.2);
    let los = false;
    if (dc < cfg.sight * (tiny ? 0.5 : 1)) { _o.set(h.x, h.y + (cfg.eyeY ?? 2.3), h.z); _dir.set(P.pos.x - h.x, cy - (h.y + (cfg.eyeY ?? 2.3)), P.pos.z - h.z); const L = _dir.length(); _dir.multiplyScalar(1 / L); los = !g.world.raySolid(_o, _dir, Math.max(0.1, L - Math.min(pr + 0.3, L * 0.5))); }
    const imp = g.impact, ibp = imp.body;
    const c = {
      P, id, giant, tiny, dc, dy, d3, dx, dz, cy, pr, ph, los, vis: los && !hidden && !pSwim, hidden, pSwim, pspeed, still: pspeed < 0.9, fleeing: radial > 3.2 && dc > 9, closing: radial < -3, fast: pspeed > 8,
      ghost: !!P.ignoreHits || hidden || this.confuse > 0, pAir: !giant && (P.pos.y > h.y + 2.2 || P.flying || P.mode === 'fly'), pDown: imp.down || ibp.state === 'air', pStagger: ibp.state === 'stagger' && ibp.tier >= 2,
      stuck: imp.stuck, grabbed: imp.grabbed, pGrace: this.pGraceT > 0, tx: P.pos.x, tz: P.pos.z, surprise: this.surprise > 0, counter: this.counterT > 0, dEdge: Math.max(0, dc - pr - cfg.rad),
    };
    this.ctx = c; return c;
  }
  playerAct() {
    const g = this.g, P = g.player, id = g.chars.id; if (id === 'diamondhead') return g.p2.act || (g.power.state && g.power.state !== 'idle' ? 'p' + g.power.stats.fired : null);
    return P.act || null;
  }
  // ============================================================================================================================ main update
  update(dt) {
    if (dt <= 1e-6) return;
    const g = this.g, cfg = this.cfg, ib = this.ib; this.t += dt; this._dt = dt;
    for (const k in this.cd) if (this.cd[k] > 0) this.cd[k] -= dt;
    this.superCd -= dt; this.flyCd -= dt; this.dodgeCd -= dt; this.recoverT -= dt; this.iframe -= dt; this.counterT -= dt; this.surprise -= dt; this.flinch = Math.max(0, this.flinch - dt * 2.6); this.pGraceT -= dt; this.confuse = Math.max(0, this.confuse - dt); this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.hitstop = Math.max(0, this.hitstop - dt); if (this.hitLog.length && this.t - this.hitLog[0] > 2.5) this.hitLog.shift();
    this.resolveHits();
    this.bc.update(dt, this.ctx);
    ib.update(dt, false);
    if (this.dead) { this.deadT += dt; } else if (this.bossState === 'respawning') { this.respawnT -= dt; if (this.respawnT <= 0) this.bossState = 'active'; }
    const P = g.player, c = this.sense(dt);
    // player recovery window: after the player stands up from a knockdown Kevin waits a beat (the player gets to act; no knockdown loops)
    const ps = g.impact.body.state; if (this.prevPState !== 'ok' && ps === 'ok' && (this.prevPState === 'getup' || this.prevPState === 'down')) this.pGraceT = 0.75; this.prevPState = ps;
    this.wantSpd = 0;
    if (!this.dead && this.aiOn) this.ai(dt, c); else if (this.act && !this.dead) { if (this.ib.canAct) this.stepAct(dt, c); else this.cancelAct(); } else if (this.act) this.cancelAct();
    this.integrate(dt, c);
    this.vertical(dt);
    this.finish(dt, c);
  }
  // ------------------------------------------------------------------------------------------------------------------ AI top level
  ai(dt, c) {
    const P = c.P;
    if (c.vis) { this.alert = Math.min(1, this.alert + dt * (c.dc < 30 ? 1.7 : c.dc < 60 ? 1.0 : 0.55)); this.mem.copy(P.pos); this.lostT = 0; this.lastSeenAt = this.t; } else { this.lostT += dt; this.alert = Math.max(0, this.alert - dt * (this.st === 'combat' ? 0.05 : 0.25)); }
    if (this.mode === 'ground' && this.ib.canAct) this.dodgeCheck(c); else this.lastPA = this.playerAct();
    switch (this.st) {
      case 'idle': this.patrol(dt, c); if (this.alert >= 1) this.spot(c, true); break;
      case 'search': {
        this.srchT += dt; if (this.alert >= 1) { this.spot(c, false); break; }
        const d = this.drive(dt, this.mem.x, this.mem.z, this.cfg.walk * 1.1, false); if (d < 2 || this.srchT > 12) { this.pauseT = (this.pauseT || 0) + dt; this.wantSpd = 0; this.yawT += Math.sin(this.t * 1.3) * dt * 0.8; if (this.pauseT > 2.4) { this.st = 'idle'; this.pauseT = 0; this.alert = 0; } }
        this.turn(dt, 4); break;
      }
      case 'combat':
        if (this.lostT > 14 && !this.act && this.mode === 'ground') { this.st = 'search'; this.srchT = 0; this.pauseT = 0; break; }
        this.engageT += dt; this.combat(dt, c); break;
    }
  }
  spot(c, roar) {
    this.st = 'combat'; this.engageT = 0; this.alert = 1; this.srchT = 0; const quick = this.t - this.lastSeenAt < 8 && !roar;
    if (!quick && this.ib.canAct && !this.act) { this.startAct('roar'); this.g.sfx.roar(); }
  }
  patrol(dt, c) {
    const h = this.home;
    if (!this.wp || hyp(this.wp.x - h.x, this.wp.z - h.z) < 1.6) { if (this.wp) { this.pauseT -= dt; this.wantSpd = 0; this.yawT += Math.sin(this.t * 0.9) * dt * 0.6; if (this.pauseT <= 0) this.wp = null; this.turn(dt, 3); return; } this.wp = this.pickWp(); this.pauseT = rand(1.2, 2.6); }
    this.drive(dt, this.wp.x, this.wp.z, this.cfg.walk * 0.85, false); this.turn(dt, 3.5);
    if (this.stuckT > 1.2) { this.wp = null; this.stuckT = 0; }
  }
  pickWp() {
    for (let i = 0; i < 12; i++) { const x = rand(-28, 28), z = rand(-28, 28); _c.set(x, 0, z); this.g.world.resolveXZ(_c, this.cfg.rad + 0.25, 0, this.cfg.h, 0.45); if (hyp(_c.x - x, _c.z - z) < 0.05 && !(this.g.world.lagoon && this.g.world.lagoon.floorAt && this.g.world.lagoon.floorAt(x, z) < -0.1)) return { x, z }; }
    return { x: this.spawn.x, z: this.spawn.z };
  }
  // ============================================================================================================================ combat
  combat(dt, c) {
    const ib = this.ib, cfg = this.cfg;
    if (!ib.canAct) { if (this.act && this.act.name !== 'land') this.cancelAct(); this.faceP(dt, c, 2); return; }
    if (this.act) this.stepAct(dt, c);
    if (this.mode === 'fly') { this.flyAI(dt, c); return; }
    if (this.act) return;
    if (this.retreat) { this.retreatMove(dt, c); return; }
    if (this.rushing) { this.rushMove(dt, c); return; }
    if (this.recoverT > 0) { this.faceP(dt, c, 3); return; }
    if (this.phaseRoar && !c.pDown) { this.phaseRoar = false; this.startAct('roar'); this.g.sfx.roar(); return; }
    if (this.combo && this.combo.length) { const nx = this.combo[0]; if (this.comboOK(nx, c)) { this.combo.shift(); this.startAct(nx, { fast: true }); return; } this.combo = null; }
    this.decideT -= dt; this.tsCd -= dt; if (this.g.kTime.active) this.decideT -= dt * 0.8;
    if (this.forceMelee && c.d3 < 3.0 * this.ks) { this.forceMelee = false; this.begin(this.pickMelee(c), c); return; }
    if (this.decideT <= 0) this.decide(c);
    this.groundMove(dt, c);
  }
  comboOK(name, c) { const A = this.ATK[name]; return c.d3 < (A.reach || 3) + 0.5 && c.los && !c.pDown && !c.ghost && this.ib.canAct && (this.cd[name] || 0) <= 0.0001; }
  faceP(dt, c, rate) { this.yawT = Math.atan2(c.dx, c.dz); this.turn(dt, rate); }
  turn(dt, rate) { rate *= this.cfg.turnMul ?? 1; const da = angleDelta(this.yaw, this.yawT), s = clamp(da, -rate * dt, rate * dt); this.yaw += s; this.turnRate = damp(this.turnRate, s / dt, 10, dt); }
  /** pick an action */
  decide(c) {
    const cfg = this.cfg, ph = this.phase; this.decideT = rand(0.28, 0.6) * (1 - 0.12 * ph);
    const list = this.candidates(c);
    const ra = list.find(e => e[0] === 'rushApproach'); if (ra && Math.random() < (c.dc > 40 ? 0.7 : 0.4)) { this.begin('rushApproach', c); return; }
    const rf = c.dc < 4 ? 1 : c.dc < 14 ? 0.62 : 0.4, aggr = clamp(cfg.aggression + 0.12 * ph, 0, 0.95);
    if (list.length && Math.random() < aggr * rf) { let tot = 0; for (const e of list) tot += e[1]; let r = Math.random() * tot, pick = list[0][0]; for (const e of list) { r -= e[1]; if (r <= 0) { pick = e[0]; break; } } this.begin(pick, c); return; }
    this.reposition(c);
  }
  pickMelee(c) { const l = this.candidates(c).filter(e => this.ATK[e[0]] && this.ATK[e[0]].hit && e[0] !== 'rushPunch'); if (!l.length) return c.tiny ? 'heavy' : 'punch'; let tot = 0; for (const e of l) tot += e[1]; let r = Math.random() * tot; for (const e of l) { r -= e[1]; if (r <= 0) return e[0]; } return l[0][0]; }
  spamMul(k) { let m = 1; if (k === this.lastAtk) m *= Math.pow(0.28, Math.min(this.rep, 3)); for (const h of this.hist.slice(-3)) if (h === k) m *= 0.75; return m; }
  /** weighted candidate list (distance, player movement / state, selected alien, own hp & phase, cooldowns, obstacles, recent actions) */
  candidates(c) {
    const L = [], cds = this.cd, ph = this.phase, id = c.id, hpF = this.hp / this.maxHp;
    const add = (k, w) => { if (w <= 0) return; if ((cds[k] || 0) > 0) return; L.push([k, w * this.spamMul(k)]); };
    if (c.ghost || c.pDown || c.pGrace || c.pSwim || this.confuse > 0) return L;
    const KT = this.g.kTime, tsOn = KT.active;
    if (tsOn) {                                                       // while the player is in slow time: only quick, close attacks - capped number of hits, then he lets go
      if ((this.tsHits || 0) >= 5 || c.giant) return L;
      add('punch', 2.4); add('heavy', 1.0); add('crystalPunch', 1.0); add('firePunch', 1.0); if (c.d3 > 3.0 && c.d3 < 12 && c.los) add('flankPunch', 3.0);
      return L;
    }
    const D = c.dc, mul = (k) => ({ xlr8: { crystalShot: 0.7, heavy: 1.2, rushPunch: 0.7, goo: 1.7, spikes: 1.4 }, fourarms: { crystalShot: 1.4, fireBlast: 1.3, heavy: 1.3, punch: 0.6 }, diamondhead: { fireBlast: 1.3, punch: 0.7, heavy: 1.3 }, heatblast: { fireBlast: 0.3, firePunch: 0.4, crystalShot: 1.4, crystalPunch: 1.2 }, cannonbolt: { goo: 2.0, spikes: 2.0, heavy: 1.2 }, wildmutt: { goo: 1.5, spikes: 1.4 }, stinkfly: { crystalShot: 1.2, fireBlast: 1.2 } }[id] || {})[k] ?? 1;
    // ---- melee (needs the player inside the arm's reach and a clear line)
    if (!c.giant && c.d3 <= 3.05 * this.ks && c.los) {
      add('punch', (c.tiny ? 0.5 : 3.2) * mul('punch') * (c.counter ? 2.5 : 1));
      add('heavy', (c.tiny ? 4.5 : 1.7) * (c.still ? 1.4 : 1) * (c.surprise ? 1.6 : 1) * (c.counter ? 1.5 : 1) * mul('heavy') * (1 + 0.15 * ph));
      add('crystalPunch', (c.tiny ? 1.4 : 1.2) * mul('crystalPunch')); add('firePunch', (c.tiny ? 1.4 : 1.2) * mul('firePunch'));
    }
    // ---- (V8) Four Arms' strength moves, chosen by distance / the player's state / cooldowns / own hp (a power move is a punishable commitment, never the default)
    if (this.isKevin && !c.giant && c.los) {
      const ks = this.ks;
      if (c.d3 <= 3.4 * ks) add('smash', 1.3 * (c.still ? 1.4 : 1) * (c.surprise ? 1.4 : 1) * (c.tiny ? 1.6 : 1) * (c.stuck ? 3 : 1) * (1 + 0.15 * ph));
      if (D > 2.5 && D < 9.5 && !c.pAir) add('slam', 1.5 * (c.tiny ? 2 : 1) * (c.fast ? 1.4 : 1) * (c.closing ? 1.3 : 1) * (hpF < 0.5 ? 1.2 : 1) * (1 + 0.2 * ph));
      if (D > 3.5 && D < 14 && !c.pAir && ph >= 1) add('seismic', 0.8 * (1 + 0.4 * (ph - 1)) * (c.fast ? 1.3 : 1));
    }
    if (!c.ghost) { const pn = this.kvPropNearby(c); if (pn && c.los && D > 6 && D < 45) add('propThrow', 0.9 * (c.pAir ? 0.5 : 1) * (c.still ? 1.3 : 1) * (1 + 0.2 * ph)); }
    // ---- grab-and-throw: an occasional close-range power move (cooldown + weighting; never against giants / flyers / intangible targets)
    if (this.canGrab(c)) add('grab', 0.9 * (1 + 0.18 * ph) * (c.still ? 1.5 : 1) * (c.stuck ? 5 : 1) * (c.pStagger ? 0.4 : 1) * (this.recentMelee() ? 1.4 : 1));
    // ---- ranged
    if (c.los && D > 4.5 && D < 62) {
      const far = D > 14 ? 1.3 : 1, mid = D < 8 ? 0.5 : D < 13 ? 0.7 : 1, w = 2.0 * far * mid * (1 + 0.25 * ph) * (hpF < 0.35 ? 1.2 : 1);
      add('crystalShot', w * mul('crystalShot')); add('fireBlast', w * mul('fireBlast'));
      if (!c.giant) {
        if (D < 30 && g_gooFree(this.g)) add('goo', 1.1 * mul('goo') * (c.fast ? 1.3 : 1) * (c.pAir ? 2.2 : 1));
        if (D < 24 && !c.pAir) add('spikes', 1.4 * mul('spikes') * (c.tiny ? 2 : 1) * (1 + 0.2 * ph));
      }
    }
    // ---- super-speed punch / super-speed approach
    if (this.superCd <= 0 && !c.giant) {
      if (c.los && D > 5.5 && D < 17 && this.pathClear(c, 1)) { add('flankPunch', (1.5 + (c.fleeing ? 2 : 0) + (this.surprise > 0 ? 1.5 : 0)) * mul('rushPunch') * (1 + 0.2 * ph)); }
      if ((D > 28 || (c.fleeing && D > 15)) && this.engageT > 3.2 && this.pathClear(c, 30)) add('rushApproach', 3.5);
    }
    // ---- XLR8's time slow, used on the player now and then (visible wind-up; real-time 10 s + 20 s cooldown owned by game.kTime)
    // (V5) Kevin no longer slows time: his XLR8 power is a super-speed burst that only changes HIS speed.
    // ---- flight (tactical: player airborne / unreachable, blocked path, or just to vary the fight; never permanent)
    if (this.flyCd <= 0 && !c.pSwim && (c.pAir || c.giant || this.stuckT > 1.0 || this.engageT > 6)) add('takeoff', c.pAir ? 5 : this.stuckT > 1.0 ? 5 : (D > 9 ? 0.25 + 0.2 * ph : 0) * (hpF < 0.35 ? 1.6 : 1) + (c.giant ? 4 : 0));
    return L;
  }
  pathClear(c, L) { const h = this.home; _o.set(h.x, h.y + 0.8, h.z); _dir.set(c.dx, 0, c.dz).normalize(); const dist = Math.min(c.dc - 2, L, 12); return dist <= 0 || !this.g.world.raySolid(_o, _dir, dist, true); }
  begin(name, c) {
    if (name === 'rushApproach') { this.rushing = { t: 0, max: clamp((c.dc - 9) / 26 + 0.5, 0.9, 2.6), stopD: 11 }; this.stats.rush++; this.g.sfx.whoosh(); return; }
    if (name === 'timeSlow') { this.g.hud.toast('KEVIN IS CHARGING TIME SLOW!'); this.g.sfx.charge && this.g.sfx.charge(0.8); }
    this.startAct(name);
  }
  /** the SAME TimeSystem XLR8 uses (two time domains, 10 s / 20 s in real time) - but the PLAYER is the one living in slow time; Kevin keeps world time */
  castTimeSlow(a, c) {
    const g = this.g; if (!g.kTime.start()) return; this.tsHits = 0; this.tsCd = 6; g.sfx.slowIn(); g.hud.toast('KEVIN SLOWS TIME'); g.camera.kick(0.1); g.camera.addTrauma(0.25);
    g.fx.surface.ring(_a.set(this.home.x, this.home.y + 0.08, this.home.z), UP, 9, 0.7, 0x4db8ff);
  }
  reposition(c) {
    const it = this.intent, recent = this.hitLog.length, D = c.dc;
    if (c.giant) { it.kind = D < 14 + c.pr ? 'retreat' : 'circle'; it.t = 0; it.dur = rand(1.2, 2.2); it.side = Math.random() < 0.5 ? 1 : -1; return; }
    if (c.ghost || c.pSwim) { it.kind = D > 9 ? 'approach' : 'circle'; it.t = 0; it.dur = 1.4; it.side = Math.random() < 0.5 ? 1 : -1; if (D < 9) it.kind = 'wait'; return; }
    const r = Math.random();
    if (recent >= 3 && r < 0.55 && D < 6) { it.kind = 'retreat'; it.t = 0; it.dur = rand(0.7, 1.1); return; }
    if (c.still && D > 6 && D < 24 && r < 0.3 && it.kind !== 'stalk') { it.kind = 'stalk'; it.t = 0; return; }              // walks slowly toward a standing player ... then suddenly punches
    if (D > 3 && D < 11 && r < 0.34 + 0.12 * this.phase + (recent ? 0.2 : 0)) { it.kind = 'circle'; it.t = 0; it.dur = rand(0.9, 1.9); it.side = Math.random() < 0.5 ? 1 : -1; return; }
    if (it.kind !== 'stalk' || c.pspeed > 2.2) it.kind = 'approach';
  }
  // ------------------------------------------------------------------------------------------------------------------ ground locomotion
  groundMove(dt, c) {
    const it = this.intent, cfg = this.cfg, h = this.home, D = c.dc; it.t += dt; let tx = c.tx, tz = c.tz, sp = 0, face = 'player';
    const toward = _a.set(c.dx, 0, c.dz).multiplyScalar(1 / D), stand = c.giant ? 24 + c.pr : this.standDist(c);
    const slowStart = this.engageT < 1.8 ? 1 : this.engageT < 3.4 ? 2 : 3;                                  // first sighting: walks -> runs -> (super-speed may follow)
    switch (it.kind) {
      case 'approach':
        if (c.giant) { if (D > 40 + c.pr) sp = cfg.run; else if (D > stand) sp = cfg.walk * 1.3; else { it.kind = 'circle'; it.t = 0; it.dur = 1.6; it.side = 1; } break; }
        if (D > stand + 0.15) sp = (D > 15 || c.fleeing || this.g.kTime.active) && (slowStart >= 2 || this.g.kTime.active) ? cfg.run : D > 6 ? cfg.walk * 1.25 : cfg.walk; face = 'move'; break;
      case 'stalk':
        sp = cfg.stalk; face = 'player';
        if (D <= 2.9 * this.ks && c.los) { this.forceMelee = true; it.kind = 'approach'; }
        else if (c.pspeed > 2.4 || it.t > 9 || D > 28) it.kind = 'approach'; break;
      case 'circle': {
        const sdir = _b.set(-c.dz, 0, c.dx).multiplyScalar(it.side / D); tx = h.x + sdir.x * 4 + toward.x * (c.giant ? 0 : 1.2); tz = h.z + sdir.z * 4 + toward.z * (c.giant ? 0 : 1.2); sp = cfg.walk * 0.95; face = 'mix';
        if (c.giant && D < 24 + c.pr) { tx -= toward.x * 5; tz -= toward.z * 5; }
        if (it.t > it.dur) it.kind = 'approach'; break;
      }
      case 'retreat': tx = h.x - toward.x * 6; tz = h.z - toward.z * 6; sp = cfg.walk * 1.35; face = 'player'; if (it.t > (it.dur || 1)) it.kind = 'approach'; break;
      case 'wait': sp = 0; face = 'player'; if (D > 10 || (!c.ghost && !c.pSwim)) it.kind = 'approach'; break;
    }
    if (sp > 0) { const d = this.drive(dt, tx, tz, sp, true); void d; }
    if (face === 'player') this.yawT = Math.atan2(c.dx, c.dz); else if (face === 'mix') { _c.set(Math.sin(Math.atan2(c.dx, c.dz)) * 0.55 + this.hd.x * 0.45, 0, Math.cos(Math.atan2(c.dx, c.dz)) * 0.55 + this.hd.z * 0.45); this.yawT = Math.atan2(_c.x, _c.z); } else if (sp > 0.3) this.yawT = Math.atan2(this.hd.x, this.hd.z); else this.yawT = Math.atan2(c.dx, c.dz);
    this.turn(dt, sp > 5 ? 6 : 5);
  }
  /** short super-speed backstep after a burst, then a recovery window and the full cooldown */
  retreatMove(dt, c) {
    const r = this.retreat; r.t += dt; this.wantSpd = this.cfg.rush * 0.8; this.hd.set(-c.dx, 0, -c.dz).multiplyScalar(1 / Math.max(c.dc, 0.5)); const s = this.steer(this.hd.x, this.hd.z, 18); this.hd.set(s.x, 0, s.z);
    this.yawT = Math.atan2(-this.hd.x, -this.hd.z); this.turn(dt, 10);                                    // keeps facing the player while backing away
    if (r.t > r.max || this.stuckT > 0.3) { this.retreat = null; this.superCd = this.cfg.superSpeedCooldown * (this.phase === 2 ? 0.65 : 1); this.recoverT = 0.9; this.decideT = 0.3; this.intent.kind = 'approach'; this.stuckT = 0; this.stats.bursts = (this.stats.bursts || 0) + 1; }
  }
  rushMove(dt, c) {
    const r = this.rushing; r.t += dt;
    this.wantSpd = this.cfg.rush; this.hd.set(c.dx, 0, c.dz).multiplyScalar(1 / c.dc); const s = this.steer(this.hd.x, this.hd.z, 26); this.hd.set(s.x, 0, s.z);
    this.yawT = Math.atan2(this.hd.x, this.hd.z); this.turn(dt, 8);
    if (c.dc < r.stopD || r.t > r.max || this.stuckT > 0.35 || !c.los && r.t > 0.5) {
      this.rushing = null; this.superCd = this.cfg.superSpeedCooldown * (this.phase === 2 ? 0.65 : 1); this.surprise = 1.8; this.decideT = 0.12; this.intent.kind = 'approach'; this.stuckT = 0;
    }
  }
  /** set the wanted heading + speed toward a point (with obstacle whiskers); returns the distance */
  drive(dt, tx, tz, speed, combat) {
    const h = this.home; let dx = tx - h.x, dz = tz - h.z; const d = hyp(dx, dz);
    if (d < 0.05) return d; dx /= d; dz /= d;
    if (this.sideT > 0) { this.sideT -= dt; dx = -dz * this.steerSide; dz = dx === 0 ? 0 : dz; }
    const s = this.steer(dx, dz, speed); this.hd.set(s.x, 0, s.z); this.wantSpd = speed; if (!combat) this.yawT = Math.atan2(s.x, s.z);
    return d;
  }
  steer(dx, dz, sp) {
    const h = this.home, w = this.g.world, L = 2.8 + Math.min(sp, 14) * 0.38; _o.set(h.x, h.y + 0.75, h.z);
    const probe = (ang) => { const co = Math.cos(ang), si = Math.sin(ang); _dir.set(dx * co - dz * si, 0, dx * si + dz * co); const hit = w.raySolid(_o, _dir, L, true); return hit ? hit.t : L + 1; };
    if (probe(0) > L) return { x: dx, z: dz };
    const order = [0.5, 1.0, 1.5, 2.0], sgn = this.steerSide;
    for (const a of order) for (const s of [sgn, -sgn]) { if (probe(a * s) > L) { this.steerSide = s; const co = Math.cos(a * s), si = Math.sin(a * s); return { x: dx * co - dz * si, z: dx * si + dz * co }; } }
    this.steerSide = -this.steerSide; return { x: dx, z: dz };
  }
  /** apply the wanted speed + act impulses to the position; walls / props / cylinders stop him, the player is not walked through */
  integrate(dt, c) {
    const ib = this.ib, h = this.home, cfg = this.cfg, flying = this.mode === 'fly';
    let want = this.wantSpd * (flying ? 1 : ib.moveScale); if (this.slimeStuck) want *= 0.15; else if (this.slimeMul !== undefined) want *= this.slimeMul;
    if (!ib.canAct && !flying) want = 0;
    const up = want > this.spd; this.spd = up ? Math.min(want, this.spd + (want > 10 ? 70 : 14) * dt) : Math.max(want, this.spd - (this.spd > 10 ? 55 : 24) * dt);
    this.av.multiplyScalar(Math.exp(-(this.act && this.act.def && (this.act.def.rush || this.act.def.keepAv) ? 0.5 : 7) * dt));
    const vx = this.hd.x * this.spd + this.av.x, vz = this.hd.z * this.spd + this.av.z, sp = hyp(vx, vz);
    if (sp > 0.02 && (ib.state === 'ok' || ib.state === 'stagger' || ib.state === 'air' && false)) {
      const n = clamp(Math.ceil(sp * dt / 0.3), 1, 6), hh = dt / n, x0 = h.x, z0 = h.z;
      for (let i = 0; i < n; i++) { h.x += vx * hh; h.z += vz * hh; this.collideXZ(c); }
      const moved = hyp(h.x - x0, h.z - z0), intended = sp * dt;
      if (this.spd > 1 && intended > 0.01 && moved < intended * 0.35) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt * 2);
      if (this.stuckT > 0.7 && this.sideT <= 0 && this.spd < 12) { this.sideT = 0.7; this.steerSide = -this.steerSide; }
      if (this.stuckT > 2.4 && this.mode === 'ground' && this.st === 'combat') this.stuckT = 1.0;
    } else this.stuckT = Math.max(0, this.stuckT - dt);
    this.landT = Math.max(0, this.landT - dt);
  }
  collideXZ(c) {
    const h = this.home, w = this.g.world, cd = this.collider.dead; this.collider.dead = true; w.resolveXZ(h, this.cfg.rad, h.y, this.cfg.h, 0.45); if (w.lagoon && w.lagoon.keepOut) w.lagoon.keepOut(h, this.cfg.rad); this.collider.dead = cd;
    if (c && c.P && !c.giant && this.mode === 'ground' && !this.dead) {                                  // do not walk through the player
      const P = c.P, dx = h.x - P.pos.x, dz = h.z - P.pos.z, d = hyp(dx, dz), min = this.cfg.rad + (P.rad ?? 0.5) * 0.9;
      if (d < min && d > 1e-4 && Math.abs(P.pos.y - h.y) < 2.0 && !P.ignoreHits && c.ph > 0.8) { h.x = P.pos.x + dx / d * min; h.z = P.pos.z + dz / d * min; w.resolveXZ(h, this.cfg.rad, h.y, this.cfg.h, 0.45); }
    }
  }
  /** ground height for a held player at (x, z, y) (Vilgax overrides it for the lagoon) */
  gAt(x, z, y) { return this.g.world.groundAt(x, z, y + 0.6, 1.2, 0.3); }
  floor() { const h = this.home; return this.g.world.groundAt(h.x, h.z, h.y + (this.mode === 'fly' || this.ib.state === 'air' ? 0.5 : 0.1), 0.45, this.cfg.rad * 0.5); }
  vertical(dt) {
    const h = this.home, ib = this.ib; if (ib.state === 'air') { this.collider.dead = true; return; }
    const gy = this.floor();
    if (this.mode === 'fly') { if (h.y < gy) h.y = gy; }
    else if (h.y > gy + 0.08) { this.fallV -= 26 * dt; h.y += this.fallV * dt; if (h.y <= gy) { if (this.fallV < -8) groundFX(this.g, h, clamp(-this.fallV / 14, 0.4, 1)); h.y = gy; this.fallV = 0; } }
    else { h.y = gy; this.fallV = 0; }
    this.collider.dead = this.dead && this.deadT > 1.5 || h.y > gy + this.cfg.h - 0.3;
  }
  // ============================================================================================================================ actions
  startAct(name, o = {}) {
    const ph = this.phase, A = this.ATK[name], c = this.ctx; let a;
    if (A) {
      const wm = Math.max(0.26 / A.wind, (o.fast ? 0.82 : 1) * (1 - 0.05 * ph)), rm = 1 - 0.08 * ph;
      a = { name, def: A, kind: A.anim, t: 0, windup: A.wind * wm, strike: A.strike, rec: A.rec * rm, hand: (this.handFlip = !this.handFlip) ? 'L' : 'R', hit: new Set(), fast: !!o.fast, prevF: [], aimY: 0, recoil: 0, w: 0, phase: 'wind', landed: false };
      a.dur = a.windup + a.strike + a.rec;
      if (name === 'fireBlast') { a.nshots = ph === 2 ? 3 : ph === 1 && Math.random() < 0.5 ? 2 : Math.random() < 0.25 ? 2 : 1; a.strike = 0.18 + 0.15 * (a.nshots - 1); a.dur = a.windup + a.strike + a.rec; }
      if (name === 'crystalShot') { a.nshots = ph === 2 && Math.random() < 0.55 ? 3 : ph === 1 && Math.random() < 0.3 ? 3 : 1; }
      if (name === 'spikes') a.aimY = -0.4;
      if (A.grab) this.initGrab(a, c);
      if (name === 'propThrow') { a.dur = 99; a.pph = 'reach'; a.pt = 0; a.pu = 0; a.prop = this.kPropCand; this.kPropCand = null; }
      if (name === 'block') { a.dur = a.windup + a.strike + a.rec; }
      this.cd[name] = (A.grab ? this.cfg.grabCd * (1 - 0.1 * ph) : (A.cd || 0) * (1 - 0.1 * ph)) * (A.ranged && ph === 2 ? 0.75 : 1);
      if (A.hit && !o.fast && ph >= 0) this.combo = null;
      if (name === this.lastAtk) this.rep++; else { this.rep = 0; this.lastAtk = name; } this.hist.push(name); if (this.hist.length > 8) this.hist.shift(); this.stats.attacks[name] = (this.stats.attacks[name] || 0) + 1;
      if ((name === 'rushPunch' && !o.fast) || (name === 'flankPunch' && !o.fast)) { this.superCd = this.cfg.superSpeedCooldown * (ph === 2 ? 0.65 : 1); this.stats.rush++; }
    } else if (name === 'takeoff') a = { name, kind: 'takeoff', t: 0, windup: 0.5, strike: 0.3, rec: 0.1, dur: 0.9, w: 0, phase: 'wind', hit: new Set() };
    else if (name === 'land') a = { name, kind: 'land', t: 0, windup: 0, strike: 0, rec: 0.55, dur: 0.55, w: 0, phase: 'rec', hit: new Set() };
    else if (name === 'dodge') a = { name, kind: 'dodge', t: 0, windup: 0, strike: 0, rec: 0.42, dur: 0.42, dir: o.dir || 1, w: 0, phase: 'rec', hit: new Set() };
    else if (name === 'roar') a = { name, kind: 'roar', t: 0, windup: 0, strike: 0, rec: 1.25, dur: 1.25, w: 0, phase: 'rec', hit: new Set() };
    else return;
    this.act = a; this.av.multiplyScalar(0.3);
  }
  cancelAct() { const a = this.act; if (a && a.def && a.def.grab) this.dropHeld(); if (a && a.name === 'propThrow') this.releaseKProp(); this.kvBlocking = false; this.act = null; this.rushing = null; this.retreat = null; this.combo = null; this.av.multiplyScalar(0.3); this.decideT = Math.max(this.decideT, 0.3); if (a && a.name === 'takeoff' && this.mode !== 'fly') this.flyCd = 2; }
  actRecovering(a) { return a.phase === 'rec' && a.dur - a.t > 0.12; }
  endAct(c) {
    const a = this.act; this.act = null; if (!a) return; if (a.def && a.def.grab) this.dropHeld();
    if (a.name === 'land' || a.name === 'roar' || a.name === 'dodge' || (a.name === 'block' && this.isKevin)) { this.decideT = a.name === 'dodge' || a.name === 'block' ? 0.05 : 0.25; if (a.name === 'dodge') this.counterT = 1.1; if (a.name === 'block') { this.kvBlocking = false; this.counterT = Math.max(this.counterT, 0.9); } return; }
    if (a.name === 'propThrow' && this.isKevin) { this.recoverT = Math.max(this.recoverT, 0.3); return; }
    if (a.name === 'takeoff') return;
    if (a.name === 'rushPunch' && a.fast) { this.retreat = { t: 0, max: 0.42 }; this.combo = null; return; }               // burst finisher -> quick super-speed retreat
    this.decideT = rand(0.12, 0.4) * (1 - 0.15 * this.phase);
    // combos (occasional; more often in later phases and after a clean hit)
    if (a.def.hit && this.mode === 'ground' && !this.combo && c && c.los) {
      let p = [0.16, 0.34, 0.42][this.phase] * (a.landed ? 1.5 : 0.45) * (a.def.big ? 0.4 : 1); if (a.name === 'rushPunch') p = 0; if (a.name === 'flankPunch') p = a.fast ? 0 : 0.9;       // a landed speed rush chains into 2 side punches + a heavy finisher (max 4 hits)
      if (Math.random() < p) { const cands = this.COMBOS.filter(l => l[0] === a.name); if (cands.length) { this.combo = cands[Math.floor(Math.random() * cands.length)].slice(1); this.stats.combos++; } }
    }
  }
  stepAct(dt, c) {
    const a = this.act, A = a.def, cfg = this.cfg; if (this.hitstop > 0) dt = 0;
    const slow = this.slimeStuck ? 0.3 : this.slimeMul ?? 1; a.t += dt * slow; const t = a.t, W = a.windup, S = a.strike;
    a.phase = t < W ? 'wind' : t < W + S ? 'strike' : 'rec'; a.w = sm(Math.min(t / 0.09, 1)) * sm(Math.min((a.dur - t) / 0.2, 1));
    const ground = this.mode === 'ground';
    switch (a.name) {
      case 'roar':
        this.faceP(dt, c, 3); if (!a.fired && t > 0.3) { a.fired = true; groundFX(this.g, this.home, 0.7); this.g.camera.addTrauma(0.12); for (let i = 0; i < 10; i++) this.g.fx.dust.emit({ pos: _a.set(this.home.x + rand(-1, 1), this.home.y + 0.2, this.home.z + rand(-1, 1)).clone(), vel: _b.set(rand(-1, 1), rand(0.2, 1), rand(-1, 1)).multiplyScalar(2).clone(), size: 0.8, grow: 1.5, life: 0.8, drag: 2, color: [0.75, 0.72, 0.66], alpha: 0.4 }); }
        break;
      case 'dodge': break;
      case 'takeoff':
        this.faceP(dt, c, 4);
        if (t >= W && !a.fired) { a.fired = true; this.mode = 'fly'; this.plan = { stage: 'up', t: 0, max: rand(this.cfg.maxFlight * 0.7, this.cfg.maxFlight), shots: 0, ls: null }; this.fvy = 10; this.stats.flights++; groundFX(this.g, this.home, 0.9); this.g.sfx.whoosh(); this.g.camera.addTrauma(0.08); }
        break;
      case 'land': break;
      case 'grab': case 'tentGrab': this.stepGrab(a, dt, c); break;
      case 'propThrow': if (!this.isKevin) break; this.stepKProp(a, dt, c); break;
      case 'block': if (!this.isKevin) break; this.faceP(dt, c, 6); this.kvBlocking = a.t > 0.1 && a.t < a.windup + a.strike; this.av.multiplyScalar(Math.exp(-12 * dt)); break;
      default: {
        if (A.ranged || (a.def && a.def.rush)) { if (!((a.def && a.def.rush) && a.phase === 'strike')) { const k = a.phase === 'wind' ? A.track : a.phase === 'strike' ? 1 : 0; if (k > 0) { this.faceP(dt, c, k); } } }
        else if (a.phase === 'wind') this.faceP(dt, c, A.track * (1 - 0.2 * this.phase * 0) );
        else if (a.phase === 'strike' && !a.struck) { /* locked facing */ }
        if (a.phase === 'wind') {
          this.windFX(a, dt);
        }
        if (a.phase === 'strike' && !a.struck && (!A.shockR || a.t >= a.windup + a.strike * 0.8)) { a.struck = true; this.onStrike(a, c); }          // power moves land when the fists reach the ground (80 % through the swing)
        if (a.phase === 'strike') {
          if ((a.def && a.def.rush)) { // the dash: a real fast run in a locked direction, stopping at the target
            const P = c.P, dist = c.dc; let near = dist < 1.9 * this.ks + (P.rad ?? 0.5);
            if (A.flank && a.dest) { const dd = hyp(a.dest.x - this.home.x, a.dest.z - this.home.z); if (dd < 0.9 || near) { near = true; this.yawT = Math.atan2(c.dx, c.dz); this.turn(dt, 16); } else a.dashDir.set(a.dest.x - this.home.x, 0, a.dest.z - this.home.z).normalize(); }
            if (!a.landed && !near) { this.av.set(a.dashDir.x * cfg.rush * 0.92, 0, a.dashDir.z * cfg.rush * 0.92); } else this.av.multiplyScalar(Math.exp(-16 * dt));
            this.trail(dt, 1);
          } else if (A.lunge && ground && !a.lunged) { a.lunged = true; this.av.set(Math.sin(this.yaw) * A.lunge, 0, Math.cos(this.yaw) * A.lunge); }
          if (a.name === 'fireBlast' || a.name === 'crystalShot') this.multiShot(a, c);
        }
        if (A.ranged) a.recoil = a.phase === 'strike' ? Math.max(0, 1 - (t - W) / 0.25) : a.phase === 'rec' ? Math.max(0, 1 - (t - W) / 0.25) : 0;
      }
    }
    if (a.t >= a.dur) this.endAct(c);
  }
  windFX(a, dt) {
    const A = a.def, g = this.g, mk = this.mk;
    if (A.shockR) { const k = clamp(a.t / Math.max(0.1, a.windup), 0, 1); for (const m of [mk.fireTip, mk.crysTip]) { if (Math.random() < 0.55) { m.getWorldPosition(_f); g.fx.glow.emit({ pos: _f, size: 0.35 + 1.1 * k, life: 0.12, drag: 0, color: A.color, alpha: 0.5 + 0.4 * k }); } } if (A.seismic && Math.random() < 0.5) g.fx.glow.emit({ pos: _a.set(this.home.x + rand(-5, 5), this.home.y + 0.2, this.home.z + rand(-5, 5)), vel: _b.set(0, rand(1, 3), 0), size: rand(0.3, 0.7), life: 0.5, drag: 1, color: [1, 0.55, 0.15] }); return; }
    if (a.name === 'timeSlow') { if (Math.random() < 0.6) { const p = this.root.position; g.fx.glow.emit({ pos: new THREE.Vector3(p.x + (Math.random() - .5) * 1.6, p.y + 0.4 + Math.random() * 2, p.z + (Math.random() - .5) * 1.6), size: 1.6 + Math.random() * 1.4, life: 0.5, drag: 0, color: [0.4, 0.7, 1], alpha: 0.9 }); } return; }
    if (!A.hit && !(A.rush)) return; if (Math.random() > 0.7) return;
    const m = A.hit === 'BR' ? mk.crysTip : A.hit === 'BL' ? mk.fireTip : A.hit === 'SS' ? (Math.random() < 0.5 ? mk.fistL : mk.fistR) : (a.hand === 'L' ? mk.fistL : mk.fistR); m.getWorldPosition(_f);
    const col = A.color || (a.name === 'heavy' ? [1, 0.45, 0.2] : [1, 0.9, 0.7]), k = clamp(a.t / Math.max(0.1, a.windup), 0, 1);
    g.fx.glow.emit({ pos: _f, size: 0.25 + 0.7 * k * (A.big ? 1 : 0.4), life: 0.12, drag: 0, color: col, alpha: 0.5 + 0.4 * k });
    if ((a.def && a.def.rush)) g.fx.glow.emit({ pos: _a.set(this.home.x, this.home.y + 1.3, this.home.z), size: 1.4 + k, life: 0.14, drag: 0, color: [0.55, 0.85, 1], alpha: 0.4 + 0.4 * k });
  }
  onStrike(a, c) {
    const g = this.g, P = c.P, A = a.def, mk = this.mk;
    if (a.name === 'timeSlow') { this.castTimeSlow(a, c); return; }
    if (A.shockR) { this.bigStrike(a, c); return; }
    if (A.flank) {                                                                  // super-speed left / right punches: dash to the player's side, face him, punch from that angle
      const D = Math.max(c.dc, 0.5), side = (this.flankSide = -(this.flankSide || 1));
      for (const sg of [side, -side]) {
        const px = -c.dz / D * sg, pz = c.dx / D * sg, dest = new THREE.Vector3(P.pos.x + px * 2.4 * this.ks, this.home.y, P.pos.z + pz * 2.4 * this.ks); _o.set(this.home.x, this.home.y + 0.8, this.home.z); _dir.set(dest.x - this.home.x, 0, dest.z - this.home.z); const L = _dir.length(); _dir.normalize();
        if (!g.world.raySolid(_o, _dir, L, true) || sg === -side) { a.dest = dest; a.sideSign = sg; break; }
      }
      a.dashDir = _a.set(a.dest.x - this.home.x, 0, a.dest.z - this.home.z).normalize().clone(); this.yawT = this.yaw = Math.atan2(a.dashDir.x, a.dashDir.z); g.sfx.whoosh(); g.camera.addTrauma(0.05); return;
    }
    if ((a.def && a.def.rush)) { a.dashDir = _a.set(c.dx + (c.P.vel ? c.P.vel.x * 0.18 : 0), 0, c.dz + (c.P.vel ? c.P.vel.z * 0.18 : 0)).normalize().clone(); this.yawT = this.yaw = Math.atan2(a.dashDir.x, a.dashDir.z); g.sfx.whoosh(); g.camera.addTrauma(0.06); return; }
    if (A.hit) { g.sfx.whoosh(); return; }
    if (a.name === 'crystalShot') { a.shotsLeft = a.nshots; a.nextShot = 0; }
    else if (a.name === 'fireBlast') { a.shotsLeft = a.nshots; a.nextShot = 0; }
    else if (a.name === 'spikes') this.castSpikes(a, c);
    else if (a.name === 'goo') this.spitGoo(a, c);
  }
  aimAt(from, c, speed, lead = 0.4) {
    const P = c.P, pv = P.form === 'ball' ? P.v : P.vel; _b.set(P.pos.x, c.cy, P.pos.z); const dist = from.distanceTo(_b), tt = dist / speed;
    if (pv) { _b.x += pv.x * tt * lead; _b.z += pv.z * tt * lead; if (!P.grounded && P.vel) _b.y += clamp(P.vel.y * tt * lead * 0.5, -2, 2); }
    return _dir.copy(_b).sub(from).normalize();
  }
  /** crystal arm -> Diamondhead's own CrystalProjectiles.spawn (same shard geometry, speed 46, trail, shatter);  Heatblast arm -> Heatblast's own spawnShot('fireball') with HIS ballistic solution + FireSystem.explode */
  multiShot(a, c) {
    if (!a.shotsLeft || a.t < a.windup + a.nextShot) return; const A = a.def, g = this.g, ph = this.phase, dmgK = (1 + 0.07 * ph) * this.cfg.atkMul;
    const crystal = a.name === 'crystalShot', mk = crystal ? this.mk.crysTip : this.mk.fireTip; mk.getWorldPosition(_f);
    const imp = attackImpact({ damage: A.dmg * dmgK, knockbackForce: A.kb, upwardForce: A.up, staggerDuration: A.stag, knockdownThreshold: 10.5, launchThreshold: 21, name: A.name, color: crystal ? [0.4, 0.95, 1] : [1, 0.6, 0.2], ordinary: false });
    if (crystal) {
      const d = this.aimAt(_f, c, 46, 0.45).clone(); a.aimY = clamp(d.y, -0.7, 0.7);
      const fan = a.nshots === 3 ? [-0.12, 0, 0.12][a.nshots - a.shotsLeft] : 0; if (fan) { const co = Math.cos(fan), si = Math.sin(fan); const x = d.x * co - d.z * si, z = d.x * si + d.z * co; d.x = x; d.z = z; }
      const per = 2; for (let k = 0; k < per; k++) {                       // Diamondhead fires a volley of shards: here a pair per shot, slightly spread
        const dd = d.clone(); dd.x += (k - 0.5) * 0.03; dd.y += rand(-0.01, 0.01); dd.normalize();
        g.power.spawn(_f, dd, 46 + rand(-3, 3), this, imp);
      }
      g.fx.glow.emit({ pos: _f, size: 1.1, life: 0.12, color: [0.7, 1, 0.85], drag: 0 }); g.sfx.zap(0.2); this.shots.stats.crystal++;
    } else {
      const P = c.P, pv = P.form === 'ball' ? P.v : P.vel, spd = 31, G = 11, dist = _f.distanceTo(_a.set(P.pos.x, c.cy, P.pos.z)), tt = dist / spd;
      const tgt = _o.set(P.pos.x + (pv ? pv.x * tt * 0.35 : 0), c.cy, P.pos.z + (pv ? pv.z * tt * 0.35 : 0)), to = _b.copy(tgt).sub(_f), dx = Math.hypot(to.x, to.z), dy = to.y; let vel;
      const disc = spd ** 4 - G * (G * dx * dx + 2 * dy * spd * spd);
      if (dx > 2 && disc > 0) { const ang = Math.atan2(spd * spd - Math.sqrt(disc), G * dx), h = _a.set(to.x, 0, to.z).normalize(); vel = new THREE.Vector3(h.x * Math.cos(ang) * spd, Math.sin(ang) * spd, h.z * Math.cos(ang) * spd); }
      else vel = to.normalize().multiplyScalar(spd).clone();
      a.aimY = clamp(vel.y / spd, -0.7, 0.7); imp.damage = (A.dmg + (A.fire || 0)) * dmgK + 8; imp.knockbackForce = A.kb + 2;
      g.hb.spawnShot('fireball', _f, vel, { dmg: 40, r: 0.7, life: 4.5, heat: 60, grav: G, owner: this, imp });
      this.shots.stats.fire++; g.sfx.boom(0.3); g.camera.addTrauma(0.04); g.fire.lights.flash(_f.clone(), [1, 0.6, 0.2], 24, 0.2, 16);
      for (let i = 0; i < 12; i++) g.fire.flame(_f, _c.copy(vel).normalize().multiplyScalar(rand(2, 8)).add(_b.set(rand(-2, 2), rand(-1, 2), rand(-2, 2))), rand(0.4, 0.8), rand(0.3, 0.5), 1.2);
    }
    a.shotsLeft--; a.nextShot += 0.18; a.recoil = 1;
  }
  castSpikes(a, c) {
    const g = this.g, h = this.home, A = a.def, P = c.P; const dir = _a.set(c.dx, 0, c.dz).normalize().clone(), pts = [];
    _o.set(h.x, h.y + 0.5, h.z); const wall = g.world.raySolid(_o, dir, 19, true), maxL = wall ? Math.max(0, wall.t - 1.2) : 18, n = Math.min(8, Math.floor((maxL - 2) / 1.9) + 1);
    const base = Math.min(3, Math.max(2.2, c.dc - 8));
    for (let i = 0; i < n; i++) { const L = (2.4 + i * 1.9) * (this.isKevin ? KS : 1); pts.push({ x: h.x + dir.x * L, z: h.z + dir.z * L, y: g.world.groundAt(h.x + dir.x * L, h.z + dir.z * L, h.y + 0.6, 0.6, 0.3) }); }
    // a second, narrow line aimed at the player's position when it is nearer than the end of the first line
    if (c.dc > 4 && c.dc < 18) pts.push({ x: P.pos.x, z: P.pos.z, y: g.world.groundAt(P.pos.x, P.pos.z, P.pos.y + 0.6, 0.6, 0.3) });
    void base; const imp = attackImpact({ damage: A.dmg * (1 + 0.07 * this.phase) * this.cfg.atkMul, knockbackForce: A.kb, upwardForce: A.up, staggerDuration: A.stag, knockdownThreshold: 14, launchThreshold: 26, name: 'spikes' }); imp.set = { hit: false };
    this.shots.spikeLine(pts, 0.55, imp); g.sfx.whoosh();
  }
  /** from the MOUTH, through Stinkfly's own sticky blob (SfPlayer.spawnShot): the same pooled blob, arc, splash and SlimeSystem status (slowed -> restricted -> trapped, wears off) */
  spitGoo(a, c) {
    const g = this.g, A = a.def; this.mk.mouth.getWorldPosition(_f); const sp = 36 * 0.8, imp = attackImpact({ damage: A.dmg, knockbackForce: 0, staggerDuration: 0, name: 'goo', color: [0.5, 1, 0.2], quiet: true });
    const d = this.aimAt(_f, c, sp, 0.5).clone(), tt = _f.distanceTo(_a.set(c.P.pos.x, c.cy, c.P.pos.z)) / sp; d.y += 0.5 * 7 * tt / sp; d.normalize();   // aim a little above: the blob arcs down onto the target
    for (let k = 0; k < 3; k++) { const dd = d.clone(); dd.x += (k - 1) * 0.045 + rand(-0.01, 0.01); dd.z += (k - 1) * 0.045 * 0 + rand(-0.01, 0.01); dd.normalize(); g.sf.spawnShot(_f, dd, this, imp, 0.8); }
    for (let i = 0; i < 6; i++) g.fx.dust.emit({ pos: _f, vel: _c.copy(d).multiplyScalar(rand(2, 6)).add(_b.set(rand(-1, 1), rand(-0.3, 1), rand(-1, 1))), size: rand(0.08, 0.16), life: rand(0.3, 0.5), drag: 2, grav: 5, color: [0.4, 0.88, 0.1], alpha: 0.95 });
    g.sfx.squelch && g.sfx.squelch(0.3); this.shots.stats.goo++;
  }
  // ------------------------------------------------------------------------------------------------------------------ dodge reaction
  dodgeCheck(c) {
    const pa = this.playerAct(); const cfg = this.cfg;
    if (pa && pa !== this.lastPA) {
      this.lastPA = pa;
      if (c.vis && c.dc < 14 && this.dodgeCd <= 0 && this.ib.canAct && !this.dead && this.mode === 'ground' && !c.giant && (!this.act || this.actRecovering(this.act) || this.act.phase === 'wind' && !this.act.def.big)) {
        if (this.isKevin && c.dc < 6.5 * this.ks && !((this.cd.block || 0) > 0) && Math.random() < 0.22) { this.cancelAct(); this.startAct('block'); this.dodgeCd = 1.0; }          // (V8) a close melee attack coming: he guards instead of sidestepping
        else if (Math.random() < cfg.dodgeChance * (1 + 0.12 * this.phase)) this.startDodge(c);
      }
    } else if (!pa) this.lastPA = null;
  }
  startDodge(c) {
    const h = this.home; const left = _b.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); let side = Math.random() < 0.5 ? 1 : -1;
    for (const s of [side, -side]) { _o.set(h.x, h.y + 0.8, h.z); _dir.copy(left).multiplyScalar(s); if (!this.g.world.raySolid(_o, _dir, 3.5, true)) { side = s; break; } }
    this.cancelAct(); this.startAct('dodge', { dir: side }); this.av.set(left.x * side * (this.cfg.dodgeV ?? 11), 0, left.z * side * (this.cfg.dodgeV ?? 11)); this.iframe = 0.3; this.dodgeCd = this.phase === 2 ? 1.9 : 2.4; this.g.sfx.whoosh();
    for (let i = 0; i < 6; i++) this.g.fx.glow.emit({ pos: _a.set(h.x, h.y + 1.2, h.z).clone(), vel: _b.set(-left.x * side * 3, rand(-0.5, 0.5), -left.z * side * 3).clone(), size: 0.8, life: 0.2, drag: 3, color: [0.8, 0.9, 1], alpha: 0.4 });
  }
  // ------------------------------------------------------------------------------------------------------------------ flight
  flyAI(dt, c) {
    const h = this.home, cfg = this.cfg, plan = this.plan || (this.plan = { stage: 'hunt', t: 0, max: 6, shots: 0, ls: null }), ib = this.ib, P = c.P; plan.t += dt;
    const gy = this.floor(), giant = c.giant;
    const alt = giant ? clamp(P.pos.y + 24, 22, 32) : clamp(c.cy + 3.4, cfg.flyAlt, 16);
    if (plan.stage === 'up' && h.y > Math.min(alt, 7.5) - 0.3) plan.stage = 'hunt';
    // when to come down: time is up, or the player is on the ground and has been shot at enough, or the player can no longer be seen for a while
    if ((plan.stage === 'hunt') && (plan.t > plan.max + (c.pAir ? 3.5 : 0) || (!c.pAir && !giant && plan.shots >= 4 && plan.t > 3) || (this.lostT > 3.5))) { plan.stage = 'descend'; plan.ls = this.findLanding(c); }
    let vyT = 0, tx = h.x, tz = h.z, sp = 0, face = 'player';
    if (plan.stage === 'up') { vyT = clamp((alt - h.y) * 2.4, 3, 9.5); sp = cfg.fly * 0.25; tx = c.tx; tz = c.tz; }
    else if (plan.stage === 'hunt') {
      vyT = clamp((alt + Math.sin(this.t * 1.3) * 0.6 - h.y) * 2.0, -8, 9);
      const ring = giant ? 34 + c.pr : c.pAir ? 3.4 : 11 + Math.sin(this.t * 0.7) * 2.5, D = c.dc, side = Math.sin(this.t * 0.45) > 0 ? 1 : -1;
      const to = _a.set(c.dx, 0, c.dz).multiplyScalar(1 / D); tx = c.tx - to.x * ring + (-to.z) * side * 4; tz = c.tz - to.z * ring + to.x * side * 4; sp = cfg.fly; if (Math.abs(D - ring) < 1.5) sp = cfg.fly * 0.45;
    } else {                                                                                             // descend: over the landing spot, then straight down
      const ls = plan.ls || { x: h.x, z: h.z }, dh = hyp(ls.x - h.x, ls.z - h.z); tx = ls.x; tz = ls.z; face = 'move';
      sp = dh > 1.2 ? cfg.fly * 0.75 : 0; const above = h.y - gy; vyT = dh < 2.2 ? -clamp(3 + above * 1.1, 3, 10) : clamp((12 - h.y) * 0.5, -1, 1);
    }
    this.fvy = damp(this.fvy, vyT, 4.5, dt); if (this.act) sp *= 0.3; if (!ib.canAct) { sp = 0; this.fvy *= 0.8; }
    h.y += this.fvy * dt;
    if (plan.stage === 'up' && h.y < 3) sp = 0;
    if (sp > 0.1) { this.drive(dt, tx, tz, sp, face === 'player'); } else this.wantSpd = 0;
    if (face === 'player' || this.act) this.faceP(dt, c, 4.5); else { this.yawT = Math.atan2(this.hd.x, this.hd.z); this.turn(dt, 4); }
    if (plan.stage === 'descend' && h.y <= gy + 0.06) { h.y = gy; this.mode = 'ground'; this.fvy = 0; this.plan = null; this.flyCd = cfg.flightCooldown * (this.phase === 2 ? 0.8 : 1); this.stats.landings++; this.landing(c); return; }
    if (h.y < gy) h.y = gy;
    // decisions in the air
    if (!this.act && ib.canAct && plan.stage === 'hunt') { this.decideT -= dt; if (this.decideT <= 0) this.decideFly(c); }
  }
  decideFly(c) {
    const plan = this.plan, ph = this.phase; this.decideT = rand(0.3, 0.6); if (c.ghost || c.pSwim || c.pDown) return;
    const L = [], add = (k, w) => { if (w > 0 && !(this.cd[k] > 0)) L.push([k, w * this.spamMul(k)]); };
    if (!c.giant && c.d3 <= 3.05 * this.ks && c.los) { add('punch', 3); add('heavy', 1.3); add('crystalPunch', 1); add('firePunch', 1); }
    if (c.los && c.dc > 5.5) { add('crystalShot', 2.4 * (1 + 0.25 * ph)); add('fireBlast', 2.4 * (1 + 0.25 * ph)); }
    if (L.length && Math.random() < clamp(this.cfg.aggression + 0.12 * ph, 0, 0.95)) { let tot = 0; for (const e of L) tot += e[1]; let r = Math.random() * tot, pick = L[0][0]; for (const e of L) { r -= e[1]; if (r <= 0) { pick = e[0]; break; } } this.startAct(pick); if (this.ATK[pick].ranged) plan.shots++; }
  }
  findLanding(c) {
    const w = this.g.world, P = c.P, base = Math.atan2(-c.dz, -c.dx);
    for (const r of [7, 5.5, 9, 11, 4]) for (let i = 0; i < 8; i++) {
      const ang = base + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.55, x = P.pos.x + Math.cos(ang) * r, z = P.pos.z + Math.sin(ang) * r;
      const T = w.island && w.terrain, y0 = (T ? T.height(x, z) : 0) + 0.2; if (T && Math.abs(y0 - P.pos.y) > 4) continue;
      _c.set(x, y0, z); w.resolveXZ(_c, this.cfg.rad + 0.25, y0, this.cfg.h, 0.45);
      if (hyp(_c.x - x, _c.z - z) < 0.05 && (T ? w.lagoon.depthAt(x, z) < 0.3 : Math.abs(x) < 33 && Math.abs(z) < 33 && !(w.lagoon && w.lagoon.floorAt && w.lagoon.floorAt(x, z) < -0.1))) return { x, z };
    }
    return { x: this.home.x, z: this.home.z };
  }
  landing(c) {
    const g = this.g, h = this.home, P = c.P; groundFX(g, h, 1.1); g.sfx.thud(0.5); g.camera.addTrauma(0.12);
    for (let i = 0; i < 14; i++) g.fx.dust.emit({ pos: _a.set(h.x + rand(-1, 1), h.y + 0.15, h.z + rand(-1, 1)).clone(), vel: _b.set(rand(-1, 1), rand(0.1, 0.6), rand(-1, 1)).normalize().multiplyScalar(rand(2, 5)).clone(), size: 0.9, grow: 1.8, life: 0.8, drag: 2, color: [0.75, 0.72, 0.66], alpha: 0.42 });
    this.startAct('land');
    const dx = P.pos.x - h.x, dz = P.pos.z - h.z, d = hyp(dx, dz);
    if (!c.giant && d < 3.4 * this.ks + (P.rad ?? 0.5) && Math.abs(P.pos.y - h.y) < 2.2 && !P.ignoreHits) { const res = g.impact.hitPlayer(attackImpact({ damage: 9, knockbackForce: 6.5, upwardForce: 1, staggerDuration: 0.4, point: P.pos.clone().setY(P.pos.y + 1), dir: _a.set(dx, 0, dz).normalize().clone(), name: 'landing', src: this })); this.onPlayerHit('landing', res); }
  }
  // ------------------------------------------------------------------------------------------------------------------ melee hit test (after the pose was applied: the fists / arm tips are where the animation really puts them)
  // ============================================================================================================================ GRAB-AND-THROW (V6)
  recentMelee() { return this.hist.slice(-3).some(h => this.ATK[h] && this.ATK[h].hit); }
  /** size / mass / state checks: Way Big (and anything huge) can never be grabbed; flyers, rolling balls and intangible targets cannot either */
  canGrab(c) {
    const g = this.g, P = c.P, cfg = this.cfg, imp = g.impact; if (this.mode !== 'ground' || this.dead || !this.ib.canAct || imp.grabbed || (this.cd.grab || 0) > 0) return false;
    if (c.giant || c.ghost || c.pDown || c.pAir || c.pSwim || !c.los || c.d3 > 3.2 * this.ks || imp.cls(P) !== 'ground') return false;
    const m = BODY[c.id] || BODY.dummy; if (m.mass > cfg.grabMaxMass || (P.colH ?? 2.2) > cfg.grabMaxH) return false;
    const sc = P.root ? P.root.getWorldScale(_o).y : 1; return sc < 2.5;
  }
  initGrab(a, c) {
    const P = c.P; a.arm = c.dx * Math.cos(this.yaw) - c.dz * Math.sin(this.yaw) >= 0 ? 'BL' : 'BR';        // reaches with the big arm on the player's side
    a.low = (P.colH ?? 2.2) < 1.4; a.gph = 'prep'; a.gt = 0; a.gu = 0; a.held = false; a.dur = 99; this.combo = null; this.grabLive = false; a.prevHand = null; a.attach = 0;
    this.g.hud.toast && this.g.hud.toast(this.isKevin ? 'KEVIN GOES FOR A GRAB!' : this.cfg.name + ' GOES FOR A GRAB!');
  }
  handMarker(a) { return a.arm === 'BL' ? this.mk.fireTip : this.mk.crysTip; }
  setGrabPhase(a, ph, dur) { a.gph = ph; a.gt = 0; a.gdur = dur; a.gu = 0; }
  stepGrab(a, dt, c) {
    const g = this.g, cfg = this.cfg, imp = g.impact, P = c.P, slow = this.slimeStuck ? 0.3 : this.slimeMul ?? 1;
    if (a.gdur === undefined) this.setGrabPhase(a, 'prep', 0.55);
    a.gt += dt * slow; a.gu = clamp(a.gt / a.gdur, 0, 1); a.w = sm(Math.min(a.t / 0.12, 1)) * (a.fade ? sm(Math.min((a.dur - a.t) / 0.25, 1)) : 1);
    const next = (ph, d) => this.setGrabPhase(a, ph, d);
    switch (a.gph) {
      case 'prep':
        this.faceP(dt, c, 5); if (a.gt > 0.12) this.windFXHand(a, a.gu);
        if (a.gu >= 1) { next('reach', 0.3); g.sfx.whoosh(); }
        break;
      case 'reach': {
        this.faceP(dt, c, 1.2);                                                  // barely turns while reaching: sidestepping works
        if (c.dc > (a.low ? (this.cfg.grabStandLow ?? 1.1) : (this.cfg.grabStand ?? 1.7)) + (P.rad ?? 0.5) && a.gu < 0.8) this.av.set(Math.sin(this.yaw) * 6.5, 0, Math.cos(this.yaw) * 6.5); else this.av.multiplyScalar(Math.exp(-16 * dt));      // a short step-in lunge synced with the reach (never a teleport)
        const m = this.handMarker(a); m.getWorldPosition(_f); const prev = a.prevHand || _f.clone(); a.prevHand = _f.clone();
        if (a.gu > 0.25 && this.grabConnects(prev, _f, c)) { this.beginHold(a, c); break; }
        if (a.gu >= 1) { next('whiff', 0.6); a.fade = true; a.dur = a.t + 0.6 + 0.01; this.recoverT = Math.max(this.recoverT, 0.2); this.stats.grabMiss = (this.stats.grabMiss || 0) + 1; }
        break;
      }
      case 'whiff': this.faceP(dt, c, 2); break;
      case 'lift': {
        if (!a.held) { this.abortGrab(a); break; }
        this.yawT = a.throwYaw; this.turn(dt, 5);
        if (a.gu >= 1) next('back', 0.28);
        break;
      }
      case 'back': if (!a.held) { this.abortGrab(a); break; } this.yawT = a.throwYaw; this.turn(dt, 6); if (a.gu >= 1) next('snap', 0.16); break;
      case 'snap': {
        if (a.held && a.gu >= 0.45) { if (a.slamMode) this.doSlamHeld(a, c); else this.doThrow(a, c); }
        if (a.gu >= 1) { next('follow', 0.6); a.fade = true; a.dur = a.t + 0.6 + 0.01; this.recoverT = Math.max(this.recoverT, 0.3); }
        break;
      }
      case 'follow': break;
    }
  }
  abortGrab(a) { this.dropHeld(); this.setGrabPhase(a, 'whiff', 0.5); a.fade = true; a.dur = a.t + 0.5; }
  windFXHand(a, k) { if (Math.random() > 0.5) return; const m = this.handMarker(a); m.getWorldPosition(_a); this.g.fx.glow.emit({ pos: _a, size: 0.3 + 0.5 * k, life: 0.12, drag: 0, color: [1, 0.85, 0.6], alpha: 0.5 }); }
  /** the reach hitbox: the hand's swept segment against the player's capsule, a short radius, and a clear line (walls block the reach). The player is never pulled from further than the reach. */
  grabConnects(prev, cur, c) {
    const g = this.g, P = c.P, a = this.act, cap = this.shots.playerCapsule(P, this._pc || (this._pc = {})); if (!this.canGrab2(c)) return false;
    const R = this.cfg.grabReach + cap.r + (a && a.low ? 0.55 : 0); if (segSeg2(prev, cur, cap.a, cap.b) > R * R) return false;
    const contact = _c.copy(cap.a).lerp(cap.b, 0.5); _o.set(this.home.x, this.home.y + (this.cfg.chestY ?? 1.6) + 0.2, this.home.z); _dir.subVectors(contact, _o); const L = _dir.length(); _dir.multiplyScalar(1 / L);
    return !g.world.raySolid(_o, _dir, Math.max(0, L - (cap.r + 0.1)), true);
  }
  canGrab2(c) { const imp = this.g.impact, P = c.P; if (imp.grabbed || c.giant || c.ghost || c.pAir || c.pSwim || imp.cls(P) !== 'ground') return false; const m = BODY[c.id] || BODY.dummy; return m.mass <= this.cfg.grabMaxMass && (P.colH ?? 2.2) <= this.cfg.grabMaxH; }
  beginHold(a, c) {
    const g = this.g, imp = g.impact, P = c.P; a.held = true; this.grabLive = true; a.start = P.pos.clone(); a.attach = 0; this.stats.grabs = (this.stats.grabs || 0) + 1;
    const hp = this.holdTarget(a, c, _a); imp.grab(this, a.start, P.yaw ?? 0);
    // throw direction: where Kevin faces, but away from walls
    let best = this.yaw, bestL = -1;                       // throw straight ahead unless a wall is close: then the clearest of a few nearby directions
    for (const off of [0, 0.7, -0.7, 1.4, -1.4]) { const y = this.yaw + off; _o.set(this.home.x, this.home.y + 1.2, this.home.z); _dir.set(Math.sin(y), 0, Math.cos(y)); const hs = g.world.raySolid(_o, _dir, 14, true), L = hs ? hs.t : 14; if (L > bestL) { best = y; bestL = L; } if (L > 9) { best = y; break; } }
    a.throwYaw = best; a.slamMode = this.isKevin && Math.random() < 0.4; this.setGrabPhase(a, 'lift', 0.62);
    const dir = _b.set(c.dx, 0, c.dz).normalize(); g.impact.damagePlayer(this.cfg.grabDmg * this.cfg.atkMul, hp, dir, false); g.sfx.thud && g.sfx.thud(0.4); g.camera.addTrauma(0.15); this.hitstop = 0.06;
    this.onPlayerHit('grab', { tier: 2 }); g.hud.tag && g.hud.tag(hp, 'GRABBED'); this.av.multiplyScalar(0.1);
  }
  /** where the player's feet go so his body hangs from Kevin's hand (scaled by his size) */
  holdTarget(a, c, out) {
    const P = c.P, m = this.handMarker(a); m.getWorldPosition(out); const H = P.colH ?? 2.2, drop = clamp(H * 0.52, 0.3, 1.6);
    out.y -= drop; out.x += Math.sin(this.yaw) * 0.15; out.z += Math.cos(this.yaw) * 0.15; return out;
  }
  /** called at the end of Kevin's frame (after the pose is final): tells the impact system where the held player goes this frame */
  updateHold() {
    const a = this.act; if (!a || !(a.def && a.def.grab) || !a.held || !this.grabLive) return; const g = this.g, imp = g.impact, c = this.ctx, P = g.player, ctl = imp.ctrl;
    if (!imp.grabbed || ctl.by !== this) { a.held = false; this.grabLive = false; return; }
    this.holdTarget(a, c, _a); a.attach = Math.min(1, a.attach + (this._dt || 0.016) / 0.2); const k = sm(a.attach);
    _a.x = a.start.x + (_a.x - a.start.x) * k; _a.y = a.start.y + (_a.y - a.start.y) * k; _a.z = a.start.z + (_a.z - a.start.z) * k;
    const gy = this.gAt(_a.x, _a.z, _a.y); if (gy > -1) _a.y = Math.max(_a.y, gy + 0.05);
    const pe = _b.set(_a.x, _a.y, _a.z); g.world.resolveXZ(pe, P.rad ?? 0.5, pe.y, P.colH ?? 2.2, 0.3); ctl.hold.copy(pe);
  }
  doThrow(a, c) {
    const g = this.g, cfg = this.cfg, imp = g.impact, P = c.P; a.held = false; this.grabLive = false;
    const tiny = (P.colH ?? 2.2) < 1.2, v = tiny ? cfg.throwSpeedTiny : cfg.throwSpeed, dir = _b.set(Math.sin(a.throwYaw), 0, Math.cos(a.throwYaw)).clone();
    this.holdTarget(a, c, _a); const pt = _a.clone().setY(_a.y + 1);
    imp.release(dir, v, cfg.throwVy);                                                  // clears goo, drops the grab lock, starts the controlled air trajectory
    imp.damagePlayer(cfg.throwDmg * cfg.atkMul * (c.tiny ? 0.55 : 1), pt, dir, false);
    g.hud.hurt && g.hud.hurt(); g.camera.addTrauma(0.45); g.camera.kick(0.08); g.sfx.boom && g.sfx.boom(0.35); g.sfx.whoosh();
    for (let i = 0; i < 10; i++) g.fx.dust.emit({ pos: pt, vel: _c.set(dir.x + rand(-0.5, 0.5), rand(0, 0.8), dir.z + rand(-0.5, 0.5)).multiplyScalar(rand(2, 5)).clone(), size: rand(0.3, 0.7), grow: 1.2, life: 0.5, drag: 2, color: [0.8, 0.78, 0.72], alpha: 0.5 });
    this.stats.throws = (this.stats.throws || 0) + 1; this.onPlayerHit('throw', { tier: 3 }); this.cd.grab = Math.max(this.cd.grab || 0, cfg.grabCd * 0.8);
  }
  /** Four Arms' Grab & Slam: instead of hurling the player away he brings him down into the ground in front of him (damage + a small shockwave); the controlled trajectory is straight down, never a teleport */
  doSlamHeld(a, c) {
    const g = this.g, cfg = this.cfg, imp = g.impact; a.held = false; this.grabLive = false; this.holdTarget(a, c, _a); const pt = _a.clone().setY(_a.y + 1), dir = _b.set(Math.sin(a.throwYaw), 0, Math.cos(a.throwYaw)).clone();
    imp.release(dir, 2.5, -16); imp.damagePlayer(cfg.throwDmg * 0.9 * cfg.atkMul * (c.tiny ? 0.55 : 1), pt, dir, false);
    g.hud.hurt && g.hud.hurt(); g.camera.addTrauma(0.6); g.camera.kick(0.07); g.sfx.crash && g.sfx.crash(0.7);
    const cx = this.home.x + dir.x * 2.6 * this.ks, cz = this.home.z + dir.z * 2.6 * this.ks, cy = this.groundY(cx, cz), ctr = new THREE.Vector3(cx, cy, cz);
    groundFX(g, ctr, 0.9); if (g.props) { g.props.shockwave(ctr, 5, 12, 80, 30); g.props.cracks.add(cx, cy, cz, 4.4, 10); g.props.debris.burst(_c.set(cx, cy + 0.3, cz).clone(), 24, 8, 0.2, 0xa8a49c, 1); }
    g.fx.surface.ring(_c.set(cx, cy + 0.1, cz), UP, 6, 0.4, 0xffcf90);
    this.stats.throws = (this.stats.throws || 0) + 1; this.stats.grabSlams = (this.stats.grabSlams || 0) + 1; this.onPlayerHit('grabSlam', { tier: 3 }); this.cd.grab = Math.max(this.cd.grab || 0, cfg.grabCd * 0.8);
  }
  /** let go of the player (interrupted, switched alien, respawn, death): no throw, he simply falls */
  dropHeld() { const imp = this.g.impact, a = this.act; this.grabLive = false; if (a && a.def && a.def.grab) a.held = false; if (imp && imp.ctrl.mode === 'grabbed' && imp.ctrl.by === this) imp.release(null, 0, 0); }

  // ============================================================================================================================ V8: FOUR ARMS STRENGTH MOVES
  // smash / slam / seismic share one strike: the fists hit the ground, the environment reacts (cracks, debris, props, destructible walls via the same PropSystem Four Arms uses) and a shockwave ring
  // travels outward. The ring only hurts a target that is ON THE GROUND when it arrives (jump / fly over it), never through the range limit, and knocks away radially.
  groundY(x, z) { const h = this.home; const gy = this.g.world.groundAt(x, z, h.y + 0.8, 1.2, 0.3); return gy > -1 ? gy : h.y; }
  bigStrike(a, c) {
    const g = this.g, A = a.def, h = this.home, P = c.P, fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), ks = this.ks, R = A.shockR;
    const cx = A.seismic ? h.x : h.x + fx * 2.4 * ks, cz = A.seismic ? h.z : h.z + fz * 2.4 * ks, cy = this.groundY(cx, cz), ctr = new THREE.Vector3(cx, cy, cz), env = g.props;
    groundFX(g, ctr, A.seismic ? 1.3 : A.name === 'slam' ? 1.0 : 0.8); g.sfx.crash && g.sfx.crash(A.seismic ? 1 : 0.8); g.sfx.roar && A.seismic && g.sfx.roar();
    const near = clamp(1 - c.dc / 60, 0.15, 1); g.camera.addTrauma((A.seismic ? 0.85 : 0.55) * near); g.camera.kick(0.05 * near);
    if (env) {                                                                                           // destructibles / vehicles / debris react exactly like they do to Four Arms' own slams
      env.shockwave(ctr, R, A.seismic ? 30 : 16, A.seismic ? 420 : 120, A.seismic ? 140 : 60);
      env.cracks.add(ctr.x, cy, ctr.z, R * 0.55, A.seismic ? 18 : 11); env.debris.burst(_a.set(ctr.x, cy + 0.3, ctr.z).clone(), A.seismic ? 70 : 34, A.seismic ? 13 : 9, 0.24, 0xa8a49c, 1.2);
      if (A.seismic) for (let i = 1; i <= 5; i++) env.cracks.add(ctr.x + fx * i * 3.2, cy, ctr.z + fz * i * 3.2, 5.6 - i * 0.3, 16);
    }
    g.fx.surface.ring(_a.set(ctr.x, cy + 0.1, ctr.z), UP, R, R / 17, 0xffc080); if (A.seismic) g.fx.surface.ring(_a.set(ctr.x, cy + 0.12, ctr.z), UP, R * 0.65, 0.45, 0xffffff);
    for (let i = 0; i < (A.seismic ? 30 : 16); i++) g.fx.dust.emit({ pos: _a.set(ctr.x, cy + 0.2, ctr.z).clone(), vel: _b.set(rand(-1, 1), rand(0.05, 0.4), rand(-1, 1)).normalize().multiplyScalar(rand(4, 11)).clone(), size: rand(1.2, 2.4), grow: 2, life: rand(0.8, 1.3), drag: 2.4, color: [0.68, 0.66, 0.62], alpha: 0.5 });
    const dmg = A.dmg * (1 + 0.07 * this.phase) * this.cfg.atkMul * (c.tiny ? 0.55 : 1);
    if (A.name === 'smash') {                                                                             // the direct blow: only inside the fists' reach, in front, with a clear line
      const cap = this.shots.playerCapsule(P, this._pc || (this._pc = {})), dx = P.pos.x - ctr.x, dz = P.pos.z - ctr.z, d = hyp(dx, dz), pd = Math.max(0, hyp(P.pos.x - h.x, P.pos.z - h.z));
      const ang = Math.acos(clamp(((P.pos.x - h.x) * fx + (P.pos.z - h.z) * fz) / (pd || 1), -1, 1));
      _o.set(h.x, h.y + (this.cfg.chestY ?? 1.6) + 0.1, h.z); _dir.set(P.pos.x - h.x, cap.a.y - _o.y + 0.5, P.pos.z - h.z); const L = _dir.length(); _dir.multiplyScalar(1 / L);
      if (d < A.R + cap.r && ang < 1.1 && !g.world.raySolid(_o, _dir, Math.max(0, L - (cap.r + 0.1)), true) && !c.ghost && Math.abs(P.pos.y - h.y) < 2.6) {
        const dir = _b.set(dx, 0, dz).normalize().clone(), res = g.impact.hitPlayer(attackImpact({ damage: dmg, knockbackForce: A.kb, upwardForce: A.up, staggerDuration: A.stag, knockdownThreshold: 10.5, launchThreshold: 21, point: _c.copy(cap.a).lerp(cap.b, 0.5).clone(), dir, name: 'smash', src: this, color: A.color }));
        if (!(res && res.passed)) { a.landed = !(res && res.dodged); this.onPlayerHit('smash', res); this.hitstop = 0.07; a.hitDirect = true; }
      }
    }
    this.kvWaveList.push({ c: ctr, r: 0.5, max: R, speed: A.name === 'smash' ? 13 : 17, dmg: dmg * (A.name === 'smash' ? 0.45 : 1), kb: A.kb * (A.name === 'smash' ? 0.5 : 1), up: A.up, stag: A.stag, name: A.name, color: A.color, hit: a.hitDirect === true, seismic: !!A.seismic });
    this.stats.slams = (this.stats.slams || 0) + 1;
  }
  /** expanding shockwaves: damage a ground-bound target once when the ring front reaches him (falloff with distance); a jump / flight over it is a real dodge */
  kvWaves(dt, c) {
    const g = this.g, P = g.player, L = this.kvWaveList; if (!L.length) return;
    for (let i = L.length - 1; i >= 0; i--) {
      const w = L[i]; w.r += w.speed * dt; const dx = P.pos.x - w.c.x, dz = P.pos.z - w.c.z, d = hyp(dx, dz), pr = (P.rad ?? 0.5) * 0.7;
      if (!w.hit && d - pr <= w.r && d <= w.max + pr && !(P.ignoreHits) && !(this.dead)) {
        const gy = this.groundY(P.pos.x, P.pos.z), off = P.pos.y - gy, airborne = off > (w.seismic ? 0.8 : 0.9) || P.flying || P.mode === 'fly' || P.mode === 'swim';
        w.hit = true;
        if (airborne) { g.hud.tag && g.hud.tag(_a.set(P.pos.x, P.pos.y + 1.4, P.pos.z).clone(), 'JUMPED IT'); this.stats.dodged = this.stats.dodged; }
        else {
          const f = 1 - 0.5 * clamp(d / w.max, 0, 1), dir = _b.set(dx, 0, dz); if (dir.lengthSq() < 1e-4) dir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); dir.normalize();
          const res = g.impact.hitPlayer(attackImpact({ damage: w.dmg * f, knockbackForce: w.kb * f, upwardForce: w.up * f, staggerDuration: w.stag, knockdownThreshold: 10.5, launchThreshold: 21, point: _c.set(P.pos.x, P.pos.y + 0.6, P.pos.z).clone(), dir: dir.clone(), name: w.name, src: this, color: w.color }));
          if (res && !res.passed) this.onPlayerHit(w.name, res);
        }
      }
      if (w.r >= w.max + 1.5) L.splice(i, 1);
    }
  }
  // ---- heavy objects: Four Arms' environmental attack (vehicles, crates, barrels ...): he walks to one, lifts it over his head with both big arms and hurls it at the player
  kvPropNearby(c) {
    if (this.kheld || !this.g.props) return null; this.kPropScanT -= this._dt || 0.016; if (this.kPropScanT > 0) return this.kPropCand;
    this.kPropScanT = 0.5; const h = this.home; this.kPropCand = this.g.props.candidate(h, this.yaw, 10, p => !p.planted && !p.dead && !p.held && p.state !== 'fly' && p.mass >= 60 && p.mass <= 1700 && p.size.h < 3.6 && !p.vg && !p.kv && p.pos.y < h.y + 1); return this.kPropCand;
  }
  releaseKProp() { const p = this.kheld; if (!p) return; this.kheld = null; if (this.g && this.g.props) { this.g.props.release(p, null, null); p.kv = null; } }
  stepKProp(a, dt, c) {
    const g = this.g, h = this.home, P = g.props, p = a.prop, ks = this.ks; a.pt += dt; const q = a.pph;
    const fin = () => { a.dur = a.t + 0.5; a.pph = 'rec'; a.pu = 0; a.strike = 0; a.windup = 0; };
    if (q === 'rec') { this.faceP(dt, c, 2); if (a.t >= a.dur) this.endAct(c); return; }
    if (!p || p.dead || (q === 'reach' && (p.held || p.state === 'fly'))) { if (q !== 'reach') this.releaseKProp(); a.dur = 0; this.endAct(c); return; }
    const hold = _a.set(h.x + Math.sin(this.yaw) * 0.5 * ks, h.y + 3.4 * ks + p.size.h * 0.5 - 0.3, h.z + Math.cos(this.yaw) * 0.5 * ks);
    if (q === 'reach') {
      const d = hyp(p.pos.x - h.x, p.pos.z - h.z), need = 2.3 * ks + Math.max(p.half.x, p.half.z); this.yawT = Math.atan2(p.pos.x - h.x, p.pos.z - h.z); this.turn(dt, 3.5);
      if (d > need) { this.av.set(Math.sin(this.yaw) * 6, 0, Math.cos(this.yaw) * 6); a.pu = 0.2; a.pt = Math.min(a.pt, 0.2); if (a.t > 5) fin(); return; }
      this.av.multiplyScalar(Math.exp(-10 * dt)); a.pu = clamp(a.pt / 0.5, 0, 1);
      if (a.pt > 0.5) { P.setHeld(p); this.kheld = p; p.kv = this; a.from = p.pos.clone(); a.pph = 'lift'; a.pt = 0; a.pu = 0; g.sfx.thud(0.4); }
      return;
    }
    if (q === 'lift') {
      a.pu = clamp(a.pt / 0.6, 0, 1); const k = sm(a.pu); p.pos.set(a.from.x + (hold.x - a.from.x) * k, a.from.y + (hold.y - p.size.h / 2 - a.from.y) * k, a.from.z + (hold.z - a.from.z) * k); P.syncRoot(p);
      this.faceP(dt, c, 3); if (a.pt >= 0.6) { a.pph = 'hold'; a.pt = 0; } return;
    }
    p.pos.set(hold.x, hold.y - p.size.h / 2, hold.z); P.syncRoot(p);
    if (q === 'hold') { this.faceP(dt, c, 4); a.pu = 0; if (a.pt >= 0.3 || c.dc > 80) { a.pph = 'throw'; a.pt = 0; } return; }
    if (q === 'throw') {
      a.pu = clamp(a.pt / 0.22, 0, 1); this.faceP(dt, c, 6);
      if (a.pu >= 0.55 && !a.thrown) {
        a.thrown = true; const spd = 22, from = p.center, tgt = _b.set(c.P.pos.x, c.cy, c.P.pos.z), to = _c.copy(tgt).sub(from), dx = hyp(to.x, to.z), tt = Math.max(dx / spd, 0.25);
        const v = new THREE.Vector3(to.x / tt, to.y / tt + 0.5 * 26 * tt, to.z / tt); if (v.length() > 36) v.setLength(36);
        P.release(p, v, new THREE.Vector3(rand(-3, 3), rand(-3, 3), rand(-3, 3))); this.kheld = null; p.kvT = 0; p.kvPrev = p.center.clone(); this.kvThrownList.push(p); if (this.kvThrownList.length > 3) { const o = this.kvThrownList.shift(); o.kv = null; }
        g.sfx.whoosh(); g.camera.addTrauma(0.12); this.stats.propThrows = (this.stats.propThrows || 0) + 1;
      }
      if (a.pt >= 0.45) fin();
    }
  }
  /** a thrown object hurts the player once if it is still fast when it reaches him (capsule vs swept centre) */
  kvThrown(dt) {
    const g = this.g, P = g.player, L = this.kvThrownList; if (!L.length) return;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i]; if (!p || p.dead || p.held || p.kv !== this) { L.splice(i, 1); continue; }
      p.kvT += dt; const sp = p.vel.length(), c = p.center; if (p.kvT > 7 || (p.state === 'rest' && p.kvT > 0.4)) { p.kv = null; L.splice(i, 1); continue; }
      if (p.kvHit || sp < 5.5 || P.ignoreHits || P.mode === 'swim') { p.kvPrev.copy(c); continue; }
      const cap = this.shots.playerCapsule(P, this._pc || (this._pc = {})), R = Math.max(p.half.x, p.half.z) * 0.85 + cap.r + 0.15;
      if (segSeg2(p.kvPrev, c, cap.a, cap.b) < R * R && Math.abs(c.y - (P.pos.y + 1)) < p.size.h / 2 + (P.colH ?? 2.2) / 2 + 0.4) {
        p.kvHit = true; const dir = _b.copy(p.vel).setY(0); if (dir.lengthSq() < 1e-4) dir.set(P.pos.x - c.x, 0, P.pos.z - c.z); dir.normalize().clone();
        const dmg = clamp(Math.sqrt(p.mass) * sp * 0.22, 12, 52) * (this.cfg.atkMul / 1.3), imp = attackImpact({ damage: dmg, knockbackForce: 8 + sp * 0.4, upwardForce: 3, staggerDuration: 0.55, knockdownThreshold: 10.5, launchThreshold: 24, point: cap.a.clone().lerp(cap.b, 0.5), dir, name: 'thrownProp', src: this });
        const res = g.impact.hitPlayer(imp); this.onPlayerHit('thrownProp', res); g.props.hurt(p, dmg * 0.4, dir); g.props.impactFX(p.center, 1.2, p.debris, true); p.vel.multiplyScalar(0.35);
      }
      p.kvPrev.copy(c);
    }
  }
  /** block: while the guard is up (arms crossed) damage / knockback are cut; a very heavy blow breaks it. A blocked attack opens a counter window (counterT). Kevin only. */
  mitigate(dmg, sh, up, dx, dz) {
    if (!this.isKevin || !this.kvBlocking) return { dmg, sh, up };
    const g = this.g, big = dmg >= 40 || sh >= 20;
    g.hud.tag && g.hud.tag(this.home.clone().setY(this.home.y + 3.0), big ? 'GUARD BROKEN' : 'BLOCKED'); g.sfx.thud && g.sfx.thud(0.35);
    if (big) { this.kvBlocking = false; this.stats.guardBreaks = (this.stats.guardBreaks || 0) + 1; return { dmg: dmg * 0.7, sh, up }; }
    this.counterT = Math.max(this.counterT, 1.2); this.bc.onBlocked(); this.stats.blocked = (this.stats.blocked || 0) + 1; return { dmg: dmg * 0.3, sh: sh * 0.35, up: 0 };
  }
  meleeTest(c) {
    const a = this.act; if (!a || !a.def || !a.def.hit) return; const A = a.def, g = this.g, P = c.P, mk = this.mk;
    const inWin = a.phase === 'strike' || (a.phase === 'rec' && a.t - a.windup - a.strike < 0.05); if (!inWin) { a.prevF.length = 0; return; }
    const pts = this.hitPoints(a, A, mk) || (A.hit === 'SS' ? [mk.fistL, mk.fistR] : A.hit === 'S' ? [a.hand === 'L' ? mk.fistL : mk.fistR] : A.hit === 'BR' ? [mk.crysTip] : [mk.fireTip]);
    const cap = this.shots.playerCapsule(P, this._pc || (this._pc = {}));
    pts.forEach((m, i) => {
      m.getWorldPosition(_f); const prev = a.prevF[i] || _f.clone(); a.prevF[i] = _f.clone();
      if (a.landed || a.spent) return;
      let hit = false; const R = A.R + cap.r;
      if (segSeg2(prev, _f, cap.a, cap.b) < R * R) hit = true;
      if (!hit && i === 0 && A.rush) { const h = this.home, ph0 = a.prevH || (a.prevH = h.clone()); _o.set(ph0.x, ph0.y + 1.3, ph0.z); _dir.set(h.x, h.y + 1.3, h.z); if (segSeg2(_o, _dir, cap.a, cap.b) < (0.9 * this.ks + cap.r) ** 2) hit = true; ph0.copy(h); }      // swept BODY test: a 26 m/s dash cannot tunnel through the player
      if (!hit && c.tiny && (A.big || this.cfg.tinyAll) && _f.y < (this.cfg.tinyY ?? 1.4) && hyp(_f.x - P.pos.x, _f.z - P.pos.z) < (this.cfg.tinyR ?? 1.5)) hit = true;       // ground-slam reach against a tiny target
      if (!hit) return;
      // no damage through walls: chest -> contact must be clear
      const contact = _c.copy(cap.a).lerp(cap.b, 0.5).clone(); _o.set(this.home.x, this.home.y + (this.cfg.chestY ?? 1.6) + 0.1, this.home.z); _dir.subVectors(contact, _o); const L = _dir.length(); _dir.multiplyScalar(1 / L);
      if (g.world.raySolid(_o, _dir, Math.max(0, L - (cap.r + 0.1)), true)) return;
      a.spent = true; this.strike(a, A, c, contact);
    });
  }
  strike(a, A, c, contact) {
    const g = this.g, P = c.P, ph = this.phase, dir = _b.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(0.6).add(_a.set(c.dx, 0, c.dz).normalize().multiplyScalar(0.4)).setY(0).normalize().clone();
    if ((a.def && a.def.rush) && a.dashDir && !A.flank) dir.copy(a.dashDir); if (a.dirO) dir.copy(a.dirO);
    const dmg = A.dmg * (1 + 0.07 * ph) * this.cfg.atkMul * (c.tiny ? 0.55 : 1);
    const imp = attackImpact({ damage: dmg, knockbackForce: A.kb, upwardForce: A.up, staggerDuration: A.stag, knockdownThreshold: A.kd ?? 10.5, launchThreshold: A.lt ?? 21, ordinary: !!A.ord, point: contact, dir, name: A.name, src: this, color: A.color });
    const res = g.impact.hitPlayer(imp);
    if (res && res.passed) { a.spent = false; return; }                                     // intangible: the fist passed through
    a.landed = !(res && res.dodged); this.onPlayerHit(A.name, res);
    if (res && res.dodged) return;
    if (A.fire && g.chars.id !== 'heatblast') g.impact.damagePlayer(A.fire, contact, dir, true);
    this.hitstop = A.big ? 0.07 : 0.04; g.camera.addTrauma(A.big ? 0.16 : 0.06);
    if (A.name === 'firePunch') for (let i = 0; i < 14; i++) g.fx.fire.emit({ pos: contact, vel: _c.set(rand(-1, 1), rand(0.2, 1.4), rand(-1, 1)).multiplyScalar(rand(2, 5)).clone(), size: rand(0.5, 1.0), grow: 0.9, life: rand(0.3, 0.6), drag: 2, color: [1, rand(0.35, 0.7), 0.1], alpha: 0.9 });
    if (A.name === 'crystalPunch') for (let i = 0; i < 8; i++) g.fx.shards.emit({ pos: contact, vel: _c.set(rand(-1, 1), rand(0.2, 1.3), rand(-1, 1)).normalize().multiplyScalar(rand(3, 7)).clone(), size: rand(0.08, 0.2), life: 0.8, grav: 1 });
    if ((a.def && a.def.rush)) { this.av.multiplyScalar(0.15); g.fx.surface.ring(_c.set(contact.x, contact.y, contact.z), dir, 3.4, 0.35, 0xa0d8ff); }
  }
  /** lift so the back (and folded wings) rests on the floor instead of clipping through it: depth of the back behind the heel pivot x sin(phi) */
  defeatLift(phi) { const back = this.cfg.backDepth ?? 0.62; return back * Math.sin(Math.min(phi, 1.57)) + (this.defAdj || 0); }
  /** measured ground contact: lowest skeleton joint of the lying body is kept ~0.25 m above the floor (joints sit inside the mesh), so he rests on the ground without clipping or floating */
  defeatSettle() {
    if (!this.bones) { this.bones = []; this.root.traverse(o => { if (o.isBone && !/tail/i.test(o.name)) this.bones.push(o); }); }
    let minY = 99; for (const b of this.bones) { b.getWorldPosition(_f); if (_f.y < minY) minY = _f.y; }
    const err = (this.home.y + (this.cfg.settleY ?? 0.22)) - minY; this.defAdj = clamp((this.defAdj || 0) + err * 0.2, -1, 3);
  }
  // ============================================================================================================================ pose, FX, HUD
  trail(dt, k) {
    this.trailT -= dt; if (this.trailT > 0) return; this.trailT = 0.025; const g = this.g, h = this.home, dir = _b.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    for (let i = 0; i < 3; i++) g.fx.glow.emit({ pos: _a.set(h.x - dir.x * rand(0, 1.4) + rand(-0.4, 0.4), h.y + rand(0.3, 2.3), h.z - dir.z * rand(0, 1.4) + rand(-0.4, 0.4)).clone(), vel: _c.set(-dir.x * 3, 0, -dir.z * 3).clone(), size: rand(0.9, 1.7) * k, life: 0.28, drag: 3, color: [0.55, 0.85, 1], alpha: 0.5 });
    g.fx.dust.emit({ pos: _a.set(h.x, h.y + 0.15, h.z).clone(), vel: _c.set(-dir.x * 2, 0.5, -dir.z * 2).clone(), size: 0.9, grow: 1.5, life: 0.5, drag: 2, color: [0.75, 0.72, 0.66], alpha: 0.3 });
  }
  finish(dt, c) {
    const g = this.g, h = this.home, ib = this.ib, root = this.root, an = this.anim, a = this.act;
    if (this.landT <= 0 && false) this.landT = 0;
    _q.setFromAxisAngle(UP, this.yaw); let defLift = 0;
    if (this.dead) { const phi = this.defeatPose(dt); _q2.setFromAxisAngle(AX, -phi); root.quaternion.copy(_q).multiply(_q2); defLift = this.defeatLift(phi); }
    else if (ib.theta > 0.012 || Math.abs(ib.spin) > 0.01) { ib.tipQuat(_q2, ib.state === 'stagger' ? 0.45 : 1); root.quaternion.copy(_q2).multiply(_q); } else root.quaternion.copy(_q);
    root.position.set(h.x, h.y + ib.lift + defLift, h.z);
    if (this.rootHook) this.rootHook(root);
    const fly = this.mode === 'fly', sp = ib.state === 'ok' || ib.state === 'stagger' ? this.spd : 0, rushV = Math.max(this.spd, this.av.length() * (this.act && (this.act.def && this.act.def.rush) ? 1 : 0.0));
    const aliveGround = !this.dead && !fly && !((this.swimK || 0) > 0.05);
    if (a && a.def && a.def.ranged) { a.recoil = a.recoil || 0; }
    const s = {
      speed: fly ? 0 : Math.max(sp, this.animBoost || 0), run: smoothstep(3.0, 5.6, sp), rush: smoothstep(12, 19, rushV) * (fly ? 0 : 1), fly: fly ? 1 : 0, flapRate: fly ? (this.plan && this.plan.stage === 'descend' ? 4.2 : 5.6) : 0, wingOpen: a && a.name === 'takeoff' ? 0.5 : 0,
      combat: aliveGround && this.st === 'combat' ? 1 : 0, act: a, turn: clamp(this.turnRate / 4, -1, 1), dead: this.dead,
      react: { state: ib.state, theta: ib.theta, lean: Math.max(ib.lean, this.flinch), fallU: ib.fallMax > 0 ? ib.fallT / ib.fallMax : 0, getT: ib.getT, getMax: ib.getMax, downT: ib.downT },
    };
    if (this.animState) this.animState(s);
    an.update(dt, s); root.updateMatrixWorld(true);
    if (this.dead && this.defLanded && this.defT > 0.9) this.defeatSettle();
    // hit-flash
    const f = this.hitFlash > 0 ? clamp(this.hitFlash / 0.14, 0, 1) : 0; for (const m of this.matList) { m.emissive.copy(m.userData.e0); if (f > 0) m.emissive.r += f * 0.55, m.emissive.g += f * 0.4, m.emissive.b += f * 0.3; }
    if (!this.dead && a) this.meleeTest(c);
    // footsteps / locomotion FX
    if (aliveGround && ib.state === 'ok' && sp > 1.2) {
      const st = Math.floor(an.ph / Math.PI); if (st !== this.stepCount) { this.stepCount = st; this.stats.steps++; const near = clamp(1 - c.dc / 45, 0.1, 1); g.sfx.thud(clamp(0.07 + sp * 0.02, 0.07, 0.3) * near); if (sp > 5.5) { g.camera.addTrauma(0.012 * near); g.fx.dust.emit({ pos: _a.set(h.x + rand(-0.3, 0.3), h.y + 0.1, h.z + rand(-0.3, 0.3)).clone(), vel: _b.set(rand(-0.5, 0.5), 0.6, rand(-0.5, 0.5)).clone(), size: 0.7, grow: 1.2, life: 0.5, drag: 2, color: [0.72, 0.69, 0.63], alpha: 0.3 }); } }
    }
    if (sp > 14 && ib.state === 'ok') this.trail(dt, 1);
    if (fly) { this.flapSfx = (this.flapSfx || 0) - dt; if (this.flapSfx <= 0) { this.flapSfx = 0.34; g.sfx.flap(clamp(0.12 * (1 - c.dc / 70), 0.02, 0.12)); } if (h.y < 5) { const gy = this.floor(); if (h.y - gy < 4.5 && Math.random() < 0.6) g.fx.dust.emit({ pos: _a.set(h.x + rand(-2, 2), gy + 0.15, h.z + rand(-2, 2)).clone(), vel: _b.set(rand(-1, 1), 0.3, rand(-1, 1)).multiplyScalar(2.5).clone(), size: 0.9, grow: 1.5, life: 0.6, drag: 2, color: [0.75, 0.72, 0.66], alpha: 0.28 }); } }
    this.updateHold(); if (this.isKevin) { this.kvWaves(dt, c); this.kvThrown(dt); }
    this.shots.update(dt);
    this.hudK.update(dt, this, g);
  }
  // ============================================================================================================================ debug
  debugText() {
    const ib = this.ib, a = this.act, h = this.home, c = this.ctx || {}; return `${this.cfg.name}  hp ${this.hp.toFixed(0)}/${this.maxHp}  phase ${this.phase + 1}  ${this.st}/${this.mode}  body ${ib.state}${ib.tier ? ' t' + ib.tier : ''}  poise ${ib.poise.toFixed(0)}  ai ${this.aiOn ? 'ON' : 'OFF'}\n` +
      `pos ${h.x.toFixed(1)}, ${h.y.toFixed(1)}, ${h.z.toFixed(1)}  spd ${this.spd.toFixed(1)}  dist ${c.dc ? c.dc.toFixed(1) : '-'}  act ${a ? a.name + ' ' + a.phase : '-'}  intent ${this.intent.kind}  super cd ${Math.max(0, this.superCd).toFixed(1)}  fly cd ${Math.max(0, this.flyCd).toFixed(1)}\n` +
      `attacks ${Object.entries(this.stats.attacks).map(([k, v]) => k + ':' + v).join(' ') || '-'}  landed on player ${this.stats.playerHits} (downs ${this.stats.playerDowns})  combos ${this.stats.combos}  rush ${this.stats.rush}  flights ${this.stats.flights}`;
  }
}
function g_gooFree(g) { return !g.impact.stuck; }
