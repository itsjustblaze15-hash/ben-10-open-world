// VILGAX (original 2005 series) - AI-controlled FINAL BOSS.  Never playable, never in the Omnitrix list.  He re-uses the Kevin 11 boss architecture (perception -> combat state machine ->
// weighted candidate list with anti-spam -> telegraphed acts -> swept hit tests -> shared ImpactBody) and adds his own: size 15 ft, 1.75x Kevin's HP, blocking + counters, a signature CHARGE, jump, SWIMMING (aquatic: unlimited breath, 3D swimming, underwater melee / tentacle grab / swim-charge) - he does NOT fly,
// tentacle whip / tentacle grab, arm-cannon energy blasts, ground slam shockwave, hand grab-and-throw, prop throwing, three phases.
//
//   walk (heavy, slow turning)  /  run  /  CHARGE (accelerating, dodgeable)  /  JUMP (aimed leap, small landing shockwave)  /  SWIM (deep water: 3D movement, swim-charge, melee, tentacle grabs)
//   punch, backhand, heavy punch, combos | tentacle whip | tentacle grab (+ pull) | hand grab-and-throw | ground slam (expanding, jumpable shockwave) | arm-cannon blast + charged blast | lifts and throws props
//   block (directional, limited, can be broken) -> counter   |   dodge (side-step)   |   phases at 70 % and 30 %
import * as THREE from 'three';
import { Kevin, KCFG, ATK as KATK } from './kevin.js';
import { BODY, attackImpact, groundFX } from './impact.js';
import { VilgaxAnim } from '../animations/vilgaxanim.js';
import { VG } from '../animations/vilgaxrig.js';
import { KevinHud, segSeg2, playerSegHit } from './kevin_fx.js';
import { clamp, damp, rand, angleDelta } from './util.js';

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _f = new THREE.Vector3(), _o = new THREE.Vector3(), _dir = new THREE.Vector3(), _g = new THREE.Vector3();
const _s1 = new THREE.Vector3(), _s2 = new THREE.Vector3(), _s3 = new THREE.Vector3(), _s4 = new THREE.Vector3(), _s5 = new THREE.Vector3(), _q4 = new THREE.Quaternion(), AXX = new THREE.Vector3(1, 0, 0), AXZ = new THREE.Vector3(0, 0, 1);
const sm = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const hyp = (x, z) => Math.hypot(x, z);

export const VCFG = Object.assign({}, KCFG, {
  name: 'VILGAX', hp: 7000, atkMul: 1.25, rad: VG.rad, h: VG.h, chestY: 3.2, eyeY: 4.1,
  walk: 3.2, stalk: 2.0, run: 8.4, rush: 15, sight: 110, aggression: 0.62, dodgeChance: 0.14, dodgeV: 8, noFlight: true,
  dmgMul: 0.85, hitCap: 0.04, phases: [0.70, 0.30], turnMul: 0.55, stand: 3.1, standTiny: 2.7,
  grabCd: 11, grabReach: 1.6, grabStand: 2.1, grabStandLow: 1.8, grabMaxMass: 500, grabMaxH: 4.6, throwSpeed: 21, throwSpeedTiny: 17, throwVy: 7.5, throwDmg: 55, grabDmg: 14,
  tinyY: 2.9, tinyR: 2.1, tinyAll: true, backDepth: 1.55, settleY: 0.55, blockCd: 4.5, blockMax: 5, breakDmg: 48, tentReach: 11.5, slamR: 9,
  // water (the lagoon): the swim centre is PV above his feet; deep water = he swims, shallow = he wades / walks. Unlimited breath: nothing here ever drains or damages him.
  PV: 2.3, swimR: 1.3, swimDeep: 2.4, swimWant: 1.7, swimExit: 1.2, swimCruise: 5.4, swimRun: 8.2, swimRush: 12.5, chargeSteer: 0.35,
});

/** attack table (same fields as Kevin's; kd / lt = knockdown / launch thresholds on the victim's effective speed) */
export const VATK = {
  punch:        { name: 'punch', anim: 'punch', hit: 'S', dmg: 22, kb: 16, up: 1.0, stag: 0.40, wind: 0.55, strike: 0.14, rec: 0.50, reach: 3.9, cd: 0, lunge: 6.5, R: 1.15, track: 3.6 },
  backhand:     { name: 'backhand', anim: 'backhand', hit: 'S', dmg: 26, kb: 19, up: 1.2, stag: 0.50, wind: 0.62, strike: 0.20, rec: 0.55, reach: 3.9, cd: 2.5, lunge: 5.0, R: 1.25, track: 3.0 },
  heavy:        { name: 'heavy', anim: 'heavy', hit: 'SS', dmg: 52, kb: 30, up: 3.4, stag: 0.80, wind: 1.10, strike: 0.20, rec: 1.00, reach: 4.0, cd: 3.5, lunge: 7.0, R: 1.4, track: 2.2, big: true, lt: 19, smash: 3.8 },
  slam:         { name: 'slam', anim: 'slam', custom: true, dmg: 40, kb: 22, up: 5, stag: 0.7, wind: 1.0, strike: 0.22, rec: 1.1, reach: 9, cd: 9, track: 3.0, big: true },
  tentWhip:     { name: 'tentWhip', anim: 'tentWhip', hit: 'T', custom: true, dmg: 26, kb: 17, up: 1.5, stag: 0.5, wind: 0.65, strike: 0.5, rec: 0.7, reach: 8.5, cd: 5.5, track: 4.0 },
  grab:         { name: 'grab', anim: 'grab', grab: true, dmg: 0, kb: 0, up: 0, stag: 0, wind: 0.5, strike: 0.3, rec: 0.7, cd: 0, track: 4.0 },
  tentGrab:     { name: 'tentGrab', anim: 'grab', grab: true, tent: true, dmg: 0, kb: 0, up: 0, stag: 0, wind: 0.7, strike: 0.3, rec: 0.7, cd: 0, track: 5.0 },
  blast:        { name: 'blast', anim: 'blast', custom: true, ranged: true, dmg: 30, kb: 15, up: 1, stag: 0.5, wind: 0.7, strike: 0.25, rec: 0.6, cd: 4.2, track: 6.0 },
  chargedBlast: { name: 'chargedBlast', anim: 'charged', custom: true, ranged: true, dmg: 70, kb: 28, up: 4, stag: 1.0, wind: 1.7, strike: 0.3, rec: 1.2, cd: 14, track: 3.5, big: true },
  charge:       { name: 'charge', anim: 'charge', custom: true, keepAv: true, dmg: 42, kb: 30, up: 3, stag: 0.9, wind: 0.85, strike: 1.2, rec: 1.1, cd: 6.5, track: 3.0, big: true },
  swimCharge:   { name: 'swimCharge', anim: 'swimCharge', custom: true, keepAv: true, dmg: 38, kb: 26, up: 0, stag: 0.9, wind: 0.8, strike: 1.4, rec: 1.0, cd: 6.0, track: 3.0, big: true },
  jump:         { name: 'jump', anim: 'jump', custom: true, keepAv: true, dmg: 26, kb: 20, up: 3, stag: 0.6, wind: 0.5, strike: 1.0, rec: 0.6, cd: 8, track: 4.0 },
  block:        { name: 'block', anim: 'block', custom: true, wind: 0.12, strike: 1.4, rec: 0.35, cd: 6, track: 5.0 },
  propThrow:    { name: 'propThrow', anim: 'prop', custom: true, wind: 0.1, strike: 3, rec: 0.5, cd: 14, track: 3.0 },
};
for (const k of ['roar', 'timeSlow']) void k;
const VCOMBOS = [['punch', 'punch'], ['punch', 'backhand'], ['punch', 'heavy'], ['backhand', 'punch'], ['punch', 'punch', 'heavy'], ['punch', 'tentWhip'], ['heavy', 'tentWhip'], ['backhand', 'heavy'], ['tentWhip', 'punch']];
const CUSTOM = new Set(['slam', 'tentWhip', 'blast', 'chargedBlast', 'charge', 'swimCharge', 'jump', 'block', 'propThrow']);
/** per-alien tuning of the weights (the spec's adaptive behaviour) */
const ADAPT = {
  fourarms:    { heavy: 1.3, slam: 1.4, grab: 0.7, tentGrab: 0.8, block: 1.3, punch: 0.8 },
  diamondhead: { tentWhip: 1.3, grab: 1.2, tentGrab: 1.3, chargedBlast: 1.3, blast: 0.9, block: 1.4 },
  xlr8:        { charge: 0.35, tentWhip: 1.6, tentGrab: 1.9, slam: 1.6, blast: 0.6, chargedBlast: 0.5, jump: 1.3, grab: 0.8 },
  heatblast:   { charge: 1.5, jump: 1.5, blast: 0.7, punch: 1.2, heavy: 1.2, block: 1.5 },
  stinkfly:    { tentWhip: 1.6, blast: 1.6, jump: 1.6, propThrow: 1.5, chargedBlast: 1.3 },
  cannonbolt:  { slam: 2.2, jump: 1.6, tentWhip: 1.3, block: 1.3, propThrow: 1.4, grab: 0, tentGrab: 0.2, charge: 0.8 },
  greymatter:  { slam: 2.6, heavy: 2.2, tentWhip: 1.9, punch: 0.3, backhand: 0.4, blast: 0.4, chargedBlast: 0.3, grab: 1.5, tentGrab: 1.3 },
  wildmutt:    { tentGrab: 1.6, slam: 1.5, jump: 1.4, charge: 0.7 },
  ripjaws:     { grab: 1.2, tentGrab: 1.3, slam: 1.2, swimCharge: 1.2 },
  upgrade:     { tentWhip: 1.2, blast: 1.2, grab: 0.9 },
};

export class Vilgax extends Kevin {
  baseCfg() { return VCFG; }
  bodyKey() { return 'vilgax'; }
  get ATK() { return this._ATK || (this._ATK = Object.assign({}, KATK, VATK)); }
  get COMBOS() { return VCOMBOS; }
  makeSpheres() { const S = (x, y, z, r) => ({ local: new THREE.Vector3(x, y, z), r }); return [S(0, 0.5, 0, 1.15), S(0, 1.4, 0, 1.05), S(0, 2.3, 0.1, 1.3), S(0, 3.2, 0.15, 1.35), S(0, 4.05, 0.2, 0.85), S(1.25, 2.9, 0.4, 0.75), S(-1.25, 2.9, 0.4, 0.75)]; }
  setupModel(rig) { this.root.add(rig.modelGroup); this.anim = new VilgaxAnim(rig); this.anim.owner = this; this.mk = rig.markers; this.rigV = rig; this.tent = { ext: 0, dir: new THREE.Vector3(0, 0, 1), reach: 4, spread: 0.1 }; }
  makeHud() { return new KevinHud({ id: 'vilbar', name: 'VILGAX', vitals: false, n1: 70, n2: 30 }); }
  reset0() {
    super.reset0(); this.bolts = []; this.waves = []; this.thrown = []; this.heldProp = null; this.blocking = false; this.tentTarget = 0; if (this.tent) this.tent.ext = 0; this.animBoost = 0; this.cd.block = 0;
    this.stats.blocked = 0; this.stats.guardBreaks = 0; this.stats.counters = 0; this.stats.slams = 0; this.stats.blasts = 0; this.stats.charges = 0; this.stats.jumps = 0; this.stats.tentWhips = 0; this.stats.tentGrabs = 0; this.stats.propThrows = 0; this.stats.shockHits = 0;
    this.blockedNow = 0; this.propScanT = 0; this.propCand = null; this.counterQ = null;
    // flight does not exist for him (Kevin's flight code is never reachable: no takeoff act, no 'fly' mode, cooldown never expires)
    this.flyCd = 1e9; this.mode = 'ground';
    // water state: vv = swim velocity, swimWant / swimSpd = what the AI asks for this frame, swimK = 0..1 render blend, pitch / bank = body tilt about the pelvis (a visual layer on the root, never touches the physics position)
    this.vv = this.vv || new THREE.Vector3(); this.vv.set(0, 0, 0); this.swimWant = this.swimWant || new THREE.Vector3(); this.swimWant.set(0, 0, 0); this.swimSpd = 0; this.swimK = 0; this.pitch = 0; this.bank = 0; this.swimHold = false; this.swimEnterT = 0; this.swimExitT = 0; this.swimNudge = 0; this.swimStuck = 0; this.swimSp = 0; this.wadeT = 0;
    this.stats.swimTime = 0; this.stats.swimEntries = 0; this.stats.swimExits = 0; this.stats.swimCharges = 0; this.stats.chargeHits = 0; this.stats.chargeMiss = 0;
    if (this.ib) {                                                                                                // the knock-back body may wade / swim: no lagoon keep-out, no slide-back, no launch while wet
      const L = this.g.world.lagoon, o = this.ib.o, prevCap = o.capTier; o.noLagoon = true; o.floorFn = () => this.floor();
      o.collide = (on) => { if (on) { this._cd = this.collider.dead; this.collider.dead = true; this._bo = L ? L.blockOn : false; if (L) L.blockOn = false; } else { this.collider.dead = this._cd; if (L) L.blockOn = this._bo; } };
      o.capTier = (b) => (this.mode === 'swim' || this.waterDepthAt(this.home.x, this.home.z) > 0.6) ? 2 : (prevCap ? prevCap(b) : 4);
    }
  }
  respawn() { this.clearExtras(); super.respawn(); this.tent.ext = 0; this.tentTarget = 0; this.mode = 'ground'; this.vv.set(0, 0, 0); this.swimK = 0; this.pitch = 0; this.bank = 0; this.swimHold = false; this.swimEnterT = this.swimExitT = 0; this.flyCd = 1e9; }
  clearExtras() { this.releaseProp(false); this.bolts.length = 0; this.waves.length = 0; for (const p of this.thrown) p.vg = null; this.thrown.length = 0; this.blocking = false; this.animBoost = 0; }
  cancelAct() { const a = this.act; if (a && a.name === 'propThrow') this.releaseProp(false); this.blocking = false; this.animBoost = 0; super.cancelAct(); }
  die() { this.clearExtras(); super.die(); }
  onDefeatFX() { const g = this.g, h = this.home; groundFX(g, h, 1.5); g.camera.addTrauma(0.5); for (let i = 0; i < 20; i++) g.fx.dust.emit({ pos: _a.set(h.x + rand(-2, 2), h.y + 0.3, h.z + rand(-2, 2)).clone(), vel: _b.set(rand(-1, 1), rand(0.3, 1), rand(-1, 1)).multiplyScalar(3).clone(), size: 1.4, grow: 2, life: 1.2, drag: 2, color: [0.7, 0.68, 0.62], alpha: 0.4 }); }
  // ============================================================================================================================ incoming damage: block / light-hit resistance / heavy-hit vulnerability
  mitigate(dmg, sh, up, dx, dz) {
    const a = this.act, cfg = this.cfg, g = this.g, m = { dmg, sh, up };
    if (this.mode === 'swim' || this.waterDepthAt(this.home.x, this.home.z) > 0.8) { m.sh *= 0.4; m.up = 0; }          // water resistance: pushed less, never launched
    if (a && a.name === 'block' && this.blocking && !this.dead) {
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), front = -(dx * fx + dz * fz) > 0.25;                  // the push direction points away from the attacker: the attacker is in front when it opposes the facing
      if (front) {
        a.blocked = (a.blocked || 0) + 1; this.blockedNow++; const p = this.home;
        if (dmg >= cfg.breakDmg || a.blocked > cfg.blockMax) {                                                    // a powerful attack (or too many hits) overwhelms the guard
          this.stats.guardBreaks++; this.blocking = false; g.hud.tag(_a.set(p.x, p.y + 5, p.z).clone(), 'GUARD BROKEN'); this.cancelAct(); this.recoverT = 0.5; this.cd.block = cfg.blockCd * 1.5; m.dmg *= 0.8; m.sh *= 0.8; return m;
        }
        this.stats.blocked++; this.bc.onBlocked(); m.dmg *= 0.2; m.sh *= 0.22; m.up = 0; this.hitFlash = 0; g.hud.tag(_a.set(p.x, p.y + 5, p.z).clone(), 'BLOCKED');
        _f.set(p.x + fx * 1.6, p.y + 3.4, p.z + fz * 1.6); g.fx.glow.emit({ pos: _f, size: 1.6, life: 0.12, drag: 0, color: [1, 0.85, 0.5], alpha: 1 }); for (let i = 0; i < 6; i++) g.fx.glow.emit({ pos: _f, vel: _b.set(rand(-1, 1), rand(-0.3, 1), rand(-1, 1)).multiplyScalar(rand(3, 7)).clone(), size: 0.18, life: 0.3, drag: 2, color: [1, 0.8, 0.4], alpha: 1 });
        g.sfx.clang && g.sfx.clang(0.4); return m;
      }
    }
    if (dmg < 10) m.dmg *= 0.55; else if (dmg < 28) m.dmg *= 0.85; else if (dmg >= 60) m.dmg *= 1.15;       // light attacks are resisted, heavy ones are not
    return m;
  }
  // ============================================================================================================================ perception / reactions
  update(dt) {
    if (dt <= 1e-6) return;
    this.animBoost = 0; this.tentTarget = 0; this.blockedNow = 0; this.swimHold = false; this.flyCd = 1e9;
    if (!this.dead && this.g.player.mode === 'swim') this.g.impact.aquaT = 0.3;                                 // he can reach a submerged swimmer (everyone else cannot)
    this.updateSwimPose(dt);
    super.update(dt);
  }
  /** a swimming player is not hidden from him: the base class treats a submerged player as unseen / untouchable, he is aquatic */
  sense(dt) {
    const c = super.sense(dt), g = this.g, P = c.P, h = this.home, cfg = this.cfg;
    c.inWater = P.mode === 'swim' || c.pSwim;
    if (c.inWater || h.y < -0.3 || P.pos.y < 0.3) {                                                           // the base ray is blocked by the virtual y = 0 ground plane
      const ey = h.y + (this.mode === 'swim' ? cfg.PV + 1.4 : cfg.eyeY); _o.set(h.x, ey, h.z); _dir.set(P.pos.x - h.x, c.cy - ey, P.pos.z - h.z); const L = _dir.length() || 1; _dir.multiplyScalar(1 / L);
      c.los = c.dc < cfg.sight * (c.tiny ? 0.5 : 1) && !g.world.raySolid(_o, _dir, Math.max(0.1, L - Math.min(c.pr + 0.3, L * 0.5)), true);
      if (!c.los && c.inWater && c.dc < cfg.sight && P.pos.y < 0.5) {                                          // a diver is seen through the surface: look at the water above them
        const wy = (this.lag() ? this.lag().waterY : 0) + 0.4; _dir.set(P.pos.x - h.x, wy - ey, P.pos.z - h.z); const L2 = _dir.length() || 1; _dir.multiplyScalar(1 / L2); c.los = !g.world.raySolid(_o, _dir, Math.max(0.1, L2 - 0.5), true) || c.dc < 45;   // the ripples and bubbles give a nearby diver away even behind rocks / reefs
      }
    }
    c.vis = c.los && !c.hidden; c.ghost = this.noHit(P) || c.hidden || this.confuse > 0; c.sw = this.mode === 'swim';
    return c;
  }
  noHit(P) { return !!P.ignoreHits && P.mode !== 'swim'; }
  // ============================================================================================================================ water: wading, swimming, transitions
  lag() { return this.g.world.lagoon; }
  /** depth of the water over the bed under (x, z); 0 on dry ground */
  waterDepthAt(x, z) { const L = this.lag(); return L && L.inRect(x, z) ? Math.max(0, L.waterY - L.floorRing(x, z, this.cfg.rad * 0.5)) : 0; }
  floor() { const h = this.home, L = this.lag(); if (L && L.inRect(h.x, h.z, this.cfg.rad + 0.4)) return L.groundFor(h.x, h.z, h.y + 0.6, 0.5, this.cfg.rad * 0.5); return super.floor(); }
  gAt(x, z, y) { const L = this.lag(); if (L && L.inRect(x, z, 0.3) && y < L.waterY + 0.6) return L.groundFor(x, z, y + 0.6, 0.3, 0.3); return super.gAt(x, z, y); }
  vertical(dt) { if (this.mode === 'swim') { this.collider.dead = this.dead; this.fallV = 0; return; } super.vertical(dt); }
  launch(vy) { if (this.mode === 'swim' || this.waterDepthAt(this.home.x, this.home.z) > 0.6) return; super.launch(vy); }
  onBody(t, d) { const m = this.mode; super.onBody(t, d); if (m === 'swim') this.mode = 'swim'; }
  /** like Kevin's, but he may wade and swim: no lagoon keep-out and no "too deep" slide-back for him */
  collideXZ(c) {
    const h = this.home, w = this.g.world, L = w.lagoon, bo = L ? L.blockOn : false, cd = this.collider.dead; this.collider.dead = true; if (L) L.blockOn = false;
    w.resolveXZ(h, this.cfg.rad, h.y, this.cfg.h, 0.45); if (L) L.blockOn = bo; this.collider.dead = cd;
    if (c && c.P && !c.giant && this.mode === 'ground' && !this.dead) {                                       // do not walk through the player
      const P = c.P, dx = h.x - P.pos.x, dz = h.z - P.pos.z, d = hyp(dx, dz), min = this.cfg.rad + (P.rad ?? 0.5) * 0.9;
      if (d < min && d > 1e-4 && Math.abs(P.pos.y - h.y) < 2.0 && !this.noHit(P) && c.ph > 0.8) { h.x = P.pos.x + dx / d * min; h.z = P.pos.z + dz / d * min; const bo2 = L ? L.blockOn : false; if (L) L.blockOn = false; w.resolveXZ(h, this.cfg.rad, h.y, this.cfg.h, 0.45); if (L) L.blockOn = bo2; }
    }
  }
  integrate(dt, c) {
    if (this.mode === 'swim') { this.swimIntegrate(dt, c); return; }
    super.integrate(dt, c); this.checkEnterSwim(c);
  }
  /** deep enough to swim (and nothing else going on): feet on the bed, water above his waist -> swimming */
  checkEnterSwim(c) {
    const h = this.home, cfg = this.cfg, L = this.lag(); if (!L || this.dead || !this.ib.canAct || this.ib.state === 'air' || this.act) return;
    if (!L.inRect(h.x, h.z, -0.5)) return;
    const d = this.waterDepthAt(h.x, h.z), under = c && c.P.pos.y < L.waterY - 0.3 && c.inWater, need = under ? cfg.swimWant : cfg.swimDeep;
    if (d >= need && h.y <= L.floorRing(h.x, h.z, cfg.rad * 0.5) + 0.15) this.enterSwim();
  }
  enterSwim() {
    const h = this.home, L = this.lag(), cfg = this.cfg; this.mode = 'swim'; this.stats.swimEntries++; this.swimEnterT = 0.9; this.swimExitT = 0;
    this.vv.set(this.hd.x * this.spd + this.av.x, 0, this.hd.z * this.spd + this.av.z).multiplyScalar(0.5); this.av.set(0, 0, 0); this.spd = 0; this.wantSpd = 0; this.fallV = 0;
    L.splash(h.x, h.z, 1.5, this.vv); L.bubbleBurst(_a.set(h.x, L.waterY - 1.2, h.z), 24, 1.0, 1.2, 0.12); this.g.camera.addTrauma(0.12); this.g.sfx.splash && this.g.sfx.splash(0.5);
  }
  exitSwim() {
    const h = this.home, L = this.lag(); this.mode = 'ground'; this.stats.swimExits++; this.swimExitT = 0.7; this.swimWant.set(0, 0, 0); this.swimSpd = 0; this.vv.multiplyScalar(0.3); this.av.set(0, 0, 0); this.fallV = 0;
    const gy = this.floor(); if (h.y < gy) h.y = gy; if (L) L.splash(h.x, h.z, 0.9, this.vv); this.collider.dead = false;
  }
  /** 3D swimming: velocity toward swimWant (set by the AI), water drag, the swim sphere collides with the bed / rocks / walls through the lagoon's own collision, ceiling at the surface */
  swimIntegrate(dt, c) {
    const h = this.home, cfg = this.cfg, L = this.lag(), v = this.vv, ib = this.ib, PV = cfg.PV, want = _s1, tot = _s2;
    const slow = this.slimeStuck ? 0.15 : this.slimeMul ?? 1, has = this.swimWant.lengthSq() > 1e-4;
    this.stats.swimTime += dt;
    if (!this.swimHold) { want.copy(this.swimWant).multiplyScalar(this.swimSpd * (ib.canAct ? ib.moveScale : 0) * slow); const k = has ? 3.0 : 1.7; const f = 1 - Math.exp(-k * dt); v.x += (want.x - v.x) * f; v.y += (want.y - v.y) * f; v.z += (want.z - v.z) * f; if (!has) v.y += Math.sin(this.t * 0.9) * 0.25 * dt; }
    this.av.multiplyScalar(Math.exp(-(this.act && this.act.def && (this.act.def.rush || this.act.def.keepAv) ? 0.5 : 5) * dt));
    tot.copy(v).add(this.av); const sp = tot.length(); const cap = 16; if (sp > cap) tot.multiplyScalar(cap / sp);
    const cc = _s3.set(h.x, h.y + PV, h.z), x0 = cc.x, y0 = cc.y, z0 = cc.z, n = clamp(Math.ceil(sp * dt / 0.3), 1, 6), hh = dt / n, cd = this.collider.dead; this.collider.dead = true;
    for (let i = 0; i < n; i++) { cc.addScaledVector(tot, hh); L.collideSphere(cc, cfg.swimR, tot); }
    this.collider.dead = cd;
    const ceil = L.waterY + 0.55; if (cc.y > ceil) { cc.y = ceil; if (v.y > 0) v.y = 0; if (tot.y > 0) tot.y = 0; }
    v.copy(tot).sub(this.av); h.set(cc.x, cc.y - PV, cc.z);
    const moved = Math.hypot(cc.x - x0, cc.y - y0, cc.z - z0);
    const cmd = has && !this.swimHold ? this.swimSpd * (ib.canAct ? ib.moveScale : 0) : 0;
    if (cmd > 2 && !this.act && moved < dt * cmd * 0.25) this.swimStuck += dt; else this.swimStuck = Math.max(0, this.swimStuck - dt * 2);
    if (this.swimStuck > 0.8) { this.swimNudge = 1.1; this.swimStuck = 0; this.nudgeDir = (this.nudgeDir || 1) * -1; }
    this.swimNudge = Math.max(0, this.swimNudge - dt); this.spd = hyp(v.x, v.z); this.swimSp = v.length();
    // water FX: a wake at the surface, bubbles behind him
    const surf = cc.y > L.waterY - 1.3; if (sp > 2 && surf && Math.random() < dt * 9) { L.ripple(cc.x, cc.z, clamp(sp / 9, 0.3, 1)); L.splash(cc.x - Math.sin(this.yaw) * 0.5, cc.z - Math.cos(this.yaw) * 0.5, 0.18, v); }
    if (sp > 1.0 && Math.random() < dt * 14) L.bubble(cc.x + rand(-0.7, 0.7), cc.y + rand(-0.6, 1.4), cc.z + rand(-0.7, 0.7), rand(0.1, 0.3), 0.8, 0, rand(0.05, 0.12), 3);
    // out of the deep: feet near the bed in shallow water (or out of the basin) -> he walks again
    if (!L.inRect(h.x, h.z, 0.05)) { this.exitSwim(); return; }
    const fl = L.floorRing(h.x, h.z, cfg.rad * 0.5), dW = L.waterY - fl;
    if (dW <= cfg.swimExit && h.y - fl < 0.9 && !(this.act && this.act.def && this.act.def.grab && this.act.held)) this.exitSwim();
  }
  /** body tilt for the swim animation: pitch about the pelvis, a small bank into turns (the tilt is a render layer; physics stays upright) */
  updateSwimPose(dt) {
    const sw = this.mode === 'swim', a = this.act; this.swimK = damp(this.swimK, sw ? 1 : 0, sw ? 6 : 4.5, dt); this.swimEnterT = Math.max(0, this.swimEnterT - dt); this.swimExitT = Math.max(0, this.swimExitT - dt);
    let pt = 0, bk = 0;
    if (sw) {
      const v = this.vv, hs = hyp(v.x, v.z); pt = clamp(0.2 + hs * 0.13, 0.2, 1.2) + clamp(-v.y / 6, 0, 1) * 0.55 - clamp(v.y / 6, 0, 1) * 0.55;
      if (a) { const n = a.name; if (n === 'swimCharge') pt = a.phase === 'wind' ? 0.45 : 1.3; else if (n === 'punch' || n === 'backhand' || n === 'heavy' || n === 'tentWhip' || n === 'grab' || n === 'tentGrab' || n === 'block') pt = 0.18; }
      bk = clamp(-this.turnRate * 0.09, -0.5, 0.5);
    }
    this.pitch = damp(this.pitch, pt, 6, dt); this.bank = damp(this.bank, bk, 5, dt);
  }
  rootHook(root) {
    const k = this.swimK; if (k < 0.004) return; const PV = this.cfg.PV;
    _q4.setFromAxisAngle(AXX, this.pitch * k); root.quaternion.multiply(_q4); if (Math.abs(this.bank) > 0.003) { _q4.setFromAxisAngle(AXZ, this.bank * k); root.quaternion.multiply(_q4); }
    _s4.set(0, PV, 0).applyQuaternion(root.quaternion); root.position.x += -_s4.x; root.position.y += PV - _s4.y; root.position.z += -_s4.z;
  }
  animState(s) { s.swim = this.swimK; s.sv = this.vv; s.swimSp = this.swimSp; s.enter = clamp(this.swimEnterT / 0.9, 0, 1); s.exit = clamp(this.swimExitT / 0.7, 0, 1); s.fly = 0; const wet = clamp(this.swimK * 1.5, 0, 1); s.speed *= 1 - wet; s.run *= 1 - wet; s.rush *= 1 - wet; }
  /** shore / seabed splash while wading (ground mode, feet in water) */
  waterFX(dt, c) {
    if (this.mode === 'swim' || this.dead) return; const L = this.lag(), h = this.home; if (!L) return; const d = this.waterDepthAt(h.x, h.z); if (d < 0.25) return;
    this.wadeT -= dt; if (this.wadeT <= 0 && this.spd > 0.6) { this.wadeT = 0.28; L.wade(h.x + rand(-0.8, 0.8), h.z + rand(-0.8, 0.8), h.y, clamp(this.spd / 6, 0.5, 1.6)); }
  }
  combat(dt, c) { if (this.mode === 'swim') { this.swimCombat(dt, c); return; } this.reactiveBlock(c); super.combat(dt, c); }
  ai(dt, c) { if (this.mode === 'swim' && this.st !== 'combat') { this.st = 'combat'; this.engageT = Math.max(this.engageT, 4); this.alert = 1; } super.ai(dt, c); }
  reposition(c) { if (c.pSwim || this.mode === 'swim') { const it = this.intent; it.kind = 'approach'; it.t = 0; it.dur = 1; return; } super.reposition(c); }
  // ---- underwater AI: same decision loop as on land (decide -> candidates -> startAct), 3D movement
  swimCombat(dt, c) {
    const ib = this.ib; this.swimWant.set(0, 0, 0); this.swimSpd = 0;
    if (!ib.canAct) { if (this.act) this.cancelAct(); this.faceP(dt, c, 2); return; }
    if (this.act) this.stepAct(dt, c);
    if (this.act) return;
    if (this.recoverT > 0) { this.faceP(dt, c, 3); this.swimMove(dt, c, 0.3); return; }
    if (this.phaseRoar && !c.pDown) { this.phaseRoar = false; this.startAct('roar'); this.g.sfx.roar(); return; }
    if (this.combo && this.combo.length) { const nx = this.combo[0]; if (this.comboOK(nx, c)) { this.combo.shift(); this.startAct(nx, { fast: true }); return; } this.combo = null; }
    this.decideT -= dt; if (this.decideT <= 0) this.decide(c);
    this.swimMove(dt, c, 1);
  }
  swimMove(dt, c, mul) {
    const h = this.home, cfg = this.cfg, L = this.lag(), P = c.P, PV = cfg.PV, it = this.intent; it.t += dt;
    let tx = P.pos.x, ty = c.cy, tz = P.pos.z, stand = this.standDist(c) + 0.5;
    if (!c.inWater) { tx = clamp(P.pos.x, L.x0 + 3, L.x1 - 3); tz = L.z0 + 1.0; ty = L.waterY + 1.7; stand = 0.4; }                    // the player left the water: he heads for the beach
    const cyC = h.y + PV, goalY = ty - 1.3, dx = tx - h.x, dz = tz - h.z, dy = goalY - cyC, Dh = hyp(dx, dz);
    let sp = 0; if (Dh > stand + 0.2) sp = (Dh > 14 ? cfg.swimRun : Dh > 6 ? cfg.swimCruise * 1.2 : cfg.swimCruise * 0.75) * mul; else sp = 0;
    let wy = clamp(dy * 1.6, -4.2, 4.2) * (mul > 0 ? 1 : 0.5);
    if (this.swimNudge > 0) { _s5.set(-dz, 0, dx).normalize(); const sg = this.nudgeDir || 1; this.swimWant.set(_s5.x * sg * 4, 3.2, _s5.z * sg * 4); this.swimSpd = 1; this.swimWant.setLength(1); this.swimSpd = 5; return; }
    let ddx = Dh > 1e-3 ? dx / Dh : 0, ddz = Dh > 1e-3 ? dz / Dh : 0;
    if (sp > 0 && Dh > 3) {                                                                               // no path-finding in the lagoon: feel for rocks ahead and steer to the nearest free heading
      const base = Math.atan2(ddx, ddz), look = Math.min(5, Dh - 1), side = this.avoidSide || 1, cd0 = this.collider.dead; let pick = null; this.collider.dead = true;
      for (const off of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.2, -2.2]) {
        const o = off * side, ang = base + o, hx = Math.sin(ang), hz = Math.cos(ang); let ok = true;
        for (let st = 1.0; st <= look + 0.01; st += 1.0) { _s4.set(h.x + hx * st, h.y + PV, h.z + hz * st); if (L.collideSphere(_s4, cfg.swimR * 0.9, null) & 1) { ok = false; break; } }
        if (ok) { pick = o; break; }
      }
      this.collider.dead = cd0;
      if (pick === null) pick = 0;
      if (Math.abs(pick) > 0.01) { const ang = base + pick; ddx = Math.sin(ang); ddz = Math.cos(ang); if (pick * side !== 0) this.avoidSide = Math.sign(pick) || side; sp *= 0.8; }
    }
    _s5.set(ddx * sp, wy, ddz * sp); const m = _s5.length(); if (m > 0.05) { this.swimWant.copy(_s5).multiplyScalar(1 / m); this.swimSpd = m; } else { this.swimWant.set(0, 0, 0); this.swimSpd = 0; }
    if (Dh > 0.5) { this.yawT = Math.atan2(c.inWater ? c.dx : dx, c.inWater ? c.dz : dz); } this.turn(dt, sp > 6 ? 5 : 4);
  }
  /** repeated hits (spamming punches) make him raise his guard; he also sometimes guards when the player starts an attack at close range */
  reactiveBlock(c) {
    if (this.dead || this.mode !== 'ground' || !this.ib.canAct || (this.cd.block || 0) > 0 || c.ghost) return;
    const a = this.act; if (a && !(this.actRecovering(a) && a.name !== 'block') || (a && a.name === 'block')) return; if (a && a.def && a.def.grab) return;
    if (c.dc > 12 && !c.pAir) return;
    // (V27) the per-frame 'guard after 3 hits' roll made him block almost continuously under punch spam: reactive blocking is now decided once per incoming hit by the shared combat layer (boss_combat.js)
  }
  dodgeCheck(c) {
    const pa = this.playerAct(), cfg = this.cfg;
    if (pa && pa !== this.lastPA) {
      this.lastPA = pa;
      if (c.vis && c.dc < 16 && this.ib.canAct && !this.dead && this.mode === 'ground' && !c.giant) {
        const busy = this.act && !(this.actRecovering(this.act) || this.act.phase === 'wind' && !this.act.def.big);
        if (!busy && (this.cd.block || 0) <= 0 && !(this.act && this.act.name === 'block') && Math.random() < 0.2 + 0.08 * this.phase + (c.dc < 8 ? 0.1 : 0)) { this.cancelAct(); this.startAct('block'); }
        else if (!busy && this.dodgeCd <= 0 && Math.random() < cfg.dodgeChance * (1 + 0.15 * this.phase) * (c.fast ? 0.5 : 1)) this.startDodge(c);
      }
    } else if (!pa) this.lastPA = null;
  }
  startDodge(c) { super.startDodge(c); this.dodgeCd = 3.6 - 0.5 * this.phase; }
  enterPhase(ph) { super.enterPhase(ph); this.cd.block = 0; for (const k in this.cd) if (this.cd[k] > 2) this.cd[k] = Math.min(this.cd[k], 2); }
  /** he stands where his arm can reach the target's chest: a short target means he has to come closer (his hands are 3.8 m above the ground) */
  standDist(c) { const dy = this.home.y + 3.8 - c.cy; return clamp(Math.sqrt(Math.max(3.4 * 3.4 - dy * dy, 0.8)) - 0.1, c.tiny ? 1.9 : 2.0, 3.1); }
  /** where the hands go: at the target's chest (height relative to the shoulder + distance), updated until the strike */
  aimHand(a, c) { if (a.phase === 'strike' && a.hy !== undefined) return; a.hy = clamp(c.cy + 0.25 - (this.home.y + 3.8), -3.0, 0.3); a.hf = clamp(c.dc - 0.5, 1.2, 2.7); }
  // ============================================================================================================================ decision making
  propNearby(c) {
    if (this.heldProp) return null; this.propScanT -= this._dt || 0.016; if (this.propScanT > 0) return this.propCand;
    this.propScanT = 0.5; const g = this.g; this.propCand = g.props ? g.props.candidate(this.home, this.yaw, 10, p => !p.planted && !p.dead && p.mass <= 2600 && p.size.h < 4.2 && !p.vg && p.pos.y < this.home.y + 1) : null; return this.propCand;
  }
  candidates(c) {
    const L = [], cds = this.cd, ph = this.phase, id = c.id, hpF = this.hp / this.maxHp, ad = ADAPT[id] || {};
    const add = (k, w) => { if (w <= 0) return; if ((cds[k] || 0) > 0) return; L.push([k, w * (ad[k] ?? 1) * this.spamMul(k)]); };
    if (this.mode === 'swim') return this.swimCandidates(c);
    if (c.ghost || c.pDown || c.pGrace || this.confuse > 0) return L;
    if (c.pSwim && c.cy < this.home.y - 0.9) return L;                                                   // a diver below his hands: he wades in after him instead
    const D = c.dc, cfg = this.cfg, near = c.dc <= this.standDist(c) + 1.2 && c.los, last = this.hist[this.hist.length - 1], gate = ph >= 1 ? 1 : 0.0, ctr = c.counter ? 1 : 0;
    if (c.giant) {                                                                                   // Way Big: ordinary punches would not reach; energy, thrown vehicles and the air
      if (c.los && D > 8) { add('blast', 2.6); add('chargedBlast', (ph >= 1 ? 2.2 : 0.8)); }
      const p = this.propNearby(c); if (p && D < 70) add('propThrow', 1.6);
      if (c.los && D < 60 && D > 18) add('jump', 1.0);
      return L;
    }
    // ---- melee
    if (near) {
      add('punch', (c.tiny ? 0.8 : 3.0) * (ctr ? 2 : 1)); add('backhand', (c.tiny ? 0.5 : 1.3) * (1 + 0.1 * ph));
      add('heavy', (c.tiny ? 3.2 : 1.7) * (c.still ? 1.4 : 1) * (c.surprise ? 1.5 : 1) * (ctr ? 2.2 : 1) * (1 + 0.2 * ph));
      add('slam', gate * (c.tiny ? 2.6 : 1.1) * (c.pStagger ? 0.5 : 1) * (ctr ? 1.8 : 1) * (1 + 0.3 * (ph - 1)));
    }
    // ---- tentacles (whip at mid range, grab from further away)
    if (c.los && c.d3 > 3.0 && c.d3 < 9.5 && c.dy < 7) add('tentWhip', gate * 2.0 * (ctr ? 1.8 : 1) * (1 + 0.25 * (ph - 1)) * (c.fleeing ? 1.4 : 1));
    if (this.canTentGrab(c)) add('tentGrab', gate * 1.5 * (c.still ? 1.3 : 1) * (c.stuck ? 4 : 1) * (c.pAir ? 2 : 1) * (c.fleeing ? 1.5 : 1) * (1 + 0.3 * (ph - 1)));
    if (this.canGrab(c)) add('grab', gate * 1.7 * (c.still ? 1.5 : 1) * (c.stuck ? 5 : 1) * (c.pStagger ? 0.4 : 1) * (ctr ? 1.8 : 1) * (this.recentMelee() ? 1.4 : 1) * (1 + 0.3 * (ph - 1)));
    // ---- ranged (arm cannon)
    if (c.los && D > 7 && D < 80 && !c.pSwim) {
      const far = D > 18 ? 1.3 : 1, mid = D < 11 ? 0.6 : 1; add('blast', 2.0 * far * mid * (1 + 0.2 * ph) * (c.fleeing || c.pAir ? 1.4 : 1));
      if (ph >= 1 && D > 12) add('chargedBlast', (ph >= 2 ? 1.9 : 0.9) * (c.still ? 1.6 : 1) * (hpF < 0.3 ? 1.3 : 1));
    }
    // ---- movement attacks
    // the CHARGE is his signature: frequent at medium range (9 - 30 m), only an opportunity when far, never at close range (there he punches / grabs / blocks / counters); the cooldown + the anti-repeat weight stop spam
    if (c.los && D > 8.5 && D < 48 && this.pathClear(c, 26) && !c.pAir && !c.pSwim) add('charge', (4.6 + (c.still ? 0.8 : 0) + (c.fleeing ? 0.7 : 0)) * (D < 30 ? 1 : 0.35) * (1 + 0.2 * ph) * (this.engageT > 1.2 ? 1 : 0.4));
    if (c.los && D > 8 && D < 36 && !c.pSwim) add('jump', 1.2 * (c.pAir ? 1.8 : 1) * (1 + 0.2 * ph) * (c.fleeing ? 1.6 : 1));
    const p = this.propNearby(c); if (p && D > 7 && D < 55 && c.los) add('propThrow', 0.9);
    void last; void cfg; void id; void hpF;
    return L;
  }
  /** underwater choices: melee / tentacles when the target is within his reach, the SWIM-CHARGE from a distance */
  swimCandidates(c) {
    const L = [], cds = this.cd, ph = this.phase, ad = ADAPT[c.id] || {}, cfg = this.cfg;
    const add = (k, w) => { if (w <= 0) return; if ((cds[k] || 0) > 0) return; L.push([k, w * (ad[k] ?? 1) * this.spamMul(k)]); };
    if (c.ghost || c.pDown || c.pGrace || this.confuse > 0 || !c.inWater || c.giant) return L;
    const D = c.dc, shY = this.home.y + cfg.PV + 1.5, vert = Math.abs(c.cy - shY), near = D <= this.standDist(c) + 1.2 && vert < 2.4 && c.los, gate = Math.max(ph >= 1 ? 1 : 0, 0.5), ctr = c.counter ? 1 : 0;
    if (near) {
      add('punch', 3.0 * (ctr ? 2 : 1)); add('backhand', 1.3); add('heavy', 1.7 * (ctr ? 2.2 : 1) * (1 + 0.2 * ph));
      if (this.canGrab(c)) add('grab', gate * 1.7 * (c.still ? 1.5 : 1) * (ctr ? 1.8 : 1));
    }
    if (c.los && c.d3 > 3.0 && c.d3 < 9.5 && vert < 6) add('tentWhip', gate * 2.0 * (1 + 0.25 * (ph - 1)));
    if (this.canTentGrab(c)) add('tentGrab', gate * 1.6 * (c.still ? 1.3 : 1) * (c.fleeing ? 1.6 : 1));
    if (c.los && D > 6.5 && D < 46 && this.swimClear(c)) add('swimCharge', (5.5 + (c.fleeing ? 1.4 : 0) + (c.still ? 0.6 : 0)) * (D < 30 ? 1 : 0.5) * (1 + 0.2 * ph) * (this.engageT > 1.0 ? 1 : 0.5));
    return L;
  }
  /** is the straight lane to the diver free of rocks / reef walls (the torpedo run has no path-finding)? three rays: centre and one body-radius to each side */
  swimClear(c) {
    const h = this.home, w = this.g.world, cy = h.y + this.cfg.PV, dx = c.dx, dz = c.dz, d = hyp(dx, dz) || 1, nx = -dz / d, nz = dx / d;
    for (const o of [0]) { _o.set(h.x + nx * o, cy, h.z + nz * o); _dir.set(dx, c.cy - cy, dz); const L = _dir.length() || 1; _dir.multiplyScalar(1 / L); if (w.raySolid(_o, _dir, Math.max(0.1, L - 1.8), true)) return false; }
    return true;
  }
  canTentGrab(c) {
    const imp = this.g.impact; if ((this.mode !== 'ground' && this.mode !== 'swim') || this.dead || !this.ib.canAct || imp.grabbed || (this.cd.tentGrab || 0) > 0 || (this.cd.grab || 0) > 0) return false;
    return c.d3 > 3.6 && c.d3 < 10.5 && c.los && this.canGrab2(c) && !c.pDown;
  }
  canGrab(c) {
    const imp = this.g.impact; if ((this.mode !== 'ground' && this.mode !== 'swim') || this.dead || !this.ib.canAct || imp.grabbed || (this.cd.grab || 0) > 0) return false;
    return !c.tiny && c.dc <= this.standDist(c) + 1.4 && c.los && !c.pDown && this.canGrab2(c) && (this.g.player.root ? this.g.player.root.getWorldScale(_o).y < 2.5 : true);
  }
  /** a swimming player is grabbable (the base class only grabs ground walkers); Way Big / flyers / the massive are not */
  canGrab2(c) { const imp = this.g.impact, P = c.P; if (imp.grabbed || c.giant || c.ghost || c.pAir) return false; if (imp.cls(P) !== 'ground' && !(c.inWater || P.mode === 'swim')) return false; const m = BODY[c.id] || BODY.dummy; return m.mass <= this.cfg.grabMaxMass && (P.colH ?? 2.2) <= this.cfg.grabMaxH; }
  pickMelee(c) { const l = this.candidates(c).filter(e => this.ATK[e[0]] && this.ATK[e[0]].hit && this.ATK[e[0]].hit !== 'T'); if (!l.length) return c.tiny ? 'heavy' : 'punch'; let tot = 0; for (const e of l) tot += e[1]; let r = Math.random() * tot; for (const e of l) { r -= e[1]; if (r <= 0) return e[0]; } return l[0][0]; }
  // ============================================================================================================================ acts
  startAct(name, o = {}) {
    if (name === 'takeoff' || name === 'land') return;                                                  // he cannot fly: no takeoff / flight-landing acts exist for him
    super.startAct(name, o); const a = this.act; if (!a || a.name !== name) return; const A = a.def;
    if (A && A.grab) { this.cd.grab = this.cd.tentGrab = Math.max(this.cd.grab || 0, this.cd.tentGrab || 0, this.cfg.grabCd * (1 - 0.1 * this.phase)); }
    if (name === 'block') { a.strike = rand(1.0, 1.7); a.dur = a.windup + a.strike + a.rec; a.blocked = 0; this.blocking = true; this.cd.block = this.cfg.blockCd * (1 - 0.15 * this.phase); }
    if (name === 'chargedBlast') this.g.hud.toast('VILGAX IS CHARGING A BLAST!');
    if (name === 'tentGrab') { this.g.hud.toast('VILGAX LASHES OUT WITH HIS TENTACLES!'); }
    if (name === 'propThrow') { a.dur = 99; a.pph = 'reach'; a.pt = 0; a.pu = 0; a.prop = this.propCand; }
    if (name === 'charge') this.g.hud.toast('VILGAX CHARGES!');
    if (name === 'swimCharge') this.g.hud.toast('VILGAX SWIM-CHARGES!');
    if (name === 'jump') a.jph = 'wind';
    if (A && A.hit && !o.fast && name !== 'punch') void 0;
  }
  initGrab(a, c) { super.initGrab(a, c); a.tent = !!a.def.tent; if (a.tent) { a.gph = 'prep'; this.stats.tentGrabs++; } }
  handMarker(a) {
    if (a.tent && (a.gph === 'prep' || a.gph === 'reach' || a.gph === 'whiff')) return this.tipProxy || (this.tipProxy = { getWorldPosition: (v) => v.copy(this._tipPos) });
    return a.arm === 'BL' ? this.mk.fistL : this.mk.fistR;
  }
  /** tentacle tip = the end of the longest feeler chain */
  updateTent(c) {
    const ch = this.rigV.feelers; let best = 0, bl = -1; for (let i = 0; i < ch.length; i++) { if (!ch[i].length) continue; const l = ch[i][0].getWorldPosition(_a).distanceTo(this.mk['tip' + i].getWorldPosition(_b)); if (l > bl) { bl = l; best = i; } }
    this.mk['tip' + best].getWorldPosition(this._tipPos || (this._tipPos = new THREE.Vector3())); this.tipBase = ch[best][0].getWorldPosition(this._tipBase || (this._tipBase = new THREE.Vector3()));
  }
  stepGrab(a, dt, c) {
    if (a.tent) {
      this.updateTent(c); const T = this.tent, g = a.gph, P = c.P; this.tentTarget = Math.max(this.tentTarget, g === 'prep' ? 0.5 : g === 'reach' ? 1 : g === 'pull' ? 1 : 0);
      this.headPos(_g); T.dir.set(P.pos.x - _g.x, (c.cy - _g.y), P.pos.z - _g.z).normalize(); T.spread = 0.05;
      if (g === 'prep') { T.reach = 3; }
      if (g === 'reach') { T.reach = clamp(a.gu * (c.dc + 2) * 1.35, 3, this.cfg.tentReach + 2); }
      if (g === 'pull') { this.pullStep(a, dt, c); return; }
    }
    super.stepGrab(a, dt, c);
  }
  headPos(out) { return this.mk.headTop.getWorldPosition(out); }
  grabConnects(prev, cur, c) {
    const a = this.act;
    if (a && a.tent && (a.gph === 'reach')) {                                                                  // the tentacle's whole length is the hitbox, not only its tip
      const cap = this.shots.playerCapsule(c.P, this._pc || (this._pc = {})); if (!this.canGrab2(c)) return false; this.updateTent(c);
      const R = 0.9 + cap.r; if (segSeg2(this.tipBase, this._tipPos, cap.a, cap.b) > R * R) return false;
      const contact = _c.copy(cap.a).lerp(cap.b, 0.5); _dir.subVectors(contact, this.headPos(_o)); const L = _dir.length(); _dir.multiplyScalar(1 / L);
      return !this.g.world.raySolid(_o, _dir, Math.max(0, L - (cap.r + 0.1)), true);
    }
    return super.grabConnects(prev, cur, c);
  }
  beginHold(a, c) {
    super.beginHold(a, c);
    if (a.tent) { a.pullFrom = c.P.pos.clone(); this.setGrabPhase(a, 'pull', 0.55); this.g.sfx.whoosh(); }
  }
  /** the held player is reeled in along the tentacle to Vilgax's hand (never teleported: the position moves a little each frame and is wall-resolved by updateHold) */
  pullStep(a, dt, c) {
    const slow = this.slimeStuck ? 0.3 : this.slimeMul ?? 1; a.gt += dt * slow; a.gu = clamp(a.gt / a.gdur, 0, 1); a.w = 1;
    this.faceP(dt, c, 3); this.updateTent(c);
    if (!a.held) { this.abortGrab(a); return; }
    this.tent.reach = Math.max(2, this._tipPos.distanceTo(this.tipBase));
    if (a.gu >= 1) { a.tent = false; const P = c.P; this.yawT = a.throwYaw; this.setGrabPhase(a, 'lift', 0.62); a.attach = 1; }
  }
  doThrow(a, c) {
    if (this.mode !== 'swim') { super.doThrow(a, c); return; }
    const g = this.g, cfg = this.cfg, imp = g.impact, L = this.lag(); a.held = false; this.grabLive = false;
    const dir = _b.set(Math.sin(a.throwYaw), 0, Math.cos(a.throwYaw)).clone(); this.holdTarget(a, c, _a); const pt = _a.clone().setY(_a.y + 1);
    imp.release(dir, 9.5, 0.6);                                                                      // water resistance: a push through the water (the swimmer's own drag stops him), not an air trajectory
    imp.damagePlayer(cfg.throwDmg * cfg.atkMul * 0.85, pt, dir, false); g.hud.hurt && g.hud.hurt(); g.camera.addTrauma(0.35); g.sfx.boom && g.sfx.boom(0.3); L.bubbleBurst(pt, 24, 0.9, 1.6, 0.12); L.splash(pt.x, pt.z, 0.5, null);
    this.stats.throws = (this.stats.throws || 0) + 1; this.onPlayerHit('throw', { tier: 3 }); this.cd.grab = Math.max(this.cd.grab || 0, cfg.grabCd * 0.8);
  }
  holdTarget(a, c, out) {
    const P = c.P, H = P.colH ?? 2.2, drop = clamp(H * 0.52, 0.3, 1.8); this.mk[a.arm === 'BL' ? 'fistL' : 'fistR'].getWorldPosition(out); out.y -= drop; out.x += Math.sin(this.yaw) * 0.2; out.z += Math.cos(this.yaw) * 0.2;
    if (a.tent && a.gph === 'pull' && a.pullFrom) { const k = sm(a.gu); out.set(a.pullFrom.x + (out.x - a.pullFrom.x) * k, a.pullFrom.y + (out.y - a.pullFrom.y) * k, a.pullFrom.z + (out.z - a.pullFrom.z) * k); }
    return out;
  }
  updateHold() {
    const a = this.act; if (a && a.def && a.def.grab && a.tent && a.gph === 'pull') { const ctl = this.g.impact.ctrl; if (a.held && this.grabLive && this.g.impact.grabbed && ctl.by === this) { this.holdTarget(a, this.ctx, _a); a.attach = 1; const pe = _b.copy(_a); this.g.world.resolveXZ(pe, this.g.player.rad ?? 0.5, pe.y, this.g.player.colH ?? 2.2, 0.3); const gy = this.gAt(pe.x, pe.z, pe.y); if (gy > -1 || this.mode === 'swim') pe.y = Math.max(pe.y, gy + 0.05); ctl.hold.copy(pe); return; } }
    super.updateHold();
  }
  // ---- act dispatcher ---------------------------------------------------------------------------------------------------------------------------------------------------------------
  stepAct(dt, c) {
    const a = this.act, A = a.def;
    if (!CUSTOM.has(a.name)) {
      if (a.name === 'punch' || a.name === 'backhand' || a.name === 'heavy') { this.aimHand(a, c); const was = a.struck, ph0 = a.phase; super.stepAct(dt, c); if (this.mode === 'swim' && this.act === a && a.phase === 'strike' && A.lunge && !a.lunged) { a.lunged = true; this.av.set(Math.sin(this.yaw) * A.lunge * 0.5, 0, Math.cos(this.yaw) * A.lunge * 0.5); } void ph0; if (!was && a.struck && this.act === a && this.mode !== 'swim') this.smash(a, c); return; }
      if (a.def && a.def.grab && (a.gph === 'prep' || a.gph === 'reach' || a.gph === undefined)) { a.hy = clamp(c.cy + 0.25 - (this.home.y + 3.8), -3.0, 0.3); a.hf = clamp(c.dc - 0.5, 1.2, 2.7); }
      return super.stepAct(dt, c);
    }
    if (this.hitstop > 0) dt = 0;
    const slow = this.slimeStuck ? 0.3 : this.slimeMul ?? 1; a.t += dt * slow; const t = a.t, W = a.windup, S = a.strike;
    a.phase = t < W ? 'wind' : t < W + S ? 'strike' : 'rec'; a.w = sm(Math.min(t / 0.12, 1)) * sm(Math.min((a.dur - t) / 0.2, 1));
    this.aimHand(a, c); this['do_' + a.name](a, dt, c, A);
    if (this.act === a && a.t >= a.dur) this.endAct(c);
  }
  endAct(c) {
    const a = this.act; const nm = a && a.name, blocked = a && a.blocked;
    if (nm === 'block') this.blocking = false;
    super.endAct(c);
    if (nm === 'block') { this.decideT = 0.1; if (blocked > 0 && c && Math.random() < 0.7 + 0.1 * this.phase) { this.counterQ = this.pickCounter(c); if (this.counterQ) { this.counterT = 1.2; this.stats.counters++; } } }
    if (this.counterQ && !this.act && this.ib.canAct) { const k = this.counterQ; this.counterQ = null; if (c && (this.cd[k] || 0) <= 0.0001 && c.los) { this.startAct(k, { fast: true }); } }
  }
  /** a counter chosen by distance + cooldowns (not automatic) */
  pickCounter(c) {
    const L = [], add = (k, w) => { if (w > 0 && !((this.cd[k] || 0) > 0)) L.push([k, w]); };
    if (c.giant || c.ghost) return null;
    if (c.dc <= this.standDist(c) + 1.2) { add('heavy', 2.2); add('punch', 1.0); add('slam', this.phase >= 1 ? 1.6 : 0.4); if (this.canGrab(c)) add('grab', this.phase >= 1 ? 1.6 : 0.6); add('tentWhip', this.phase >= 1 ? 1.3 : 0.4); }
    else if (c.d3 < 9) { add('tentWhip', 2.0); if (this.canTentGrab(c)) add('tentGrab', this.phase >= 1 ? 1.5 : 0.3); add('blast', 0.8); }
    if (!L.length) return null; let tot = 0; for (const e of L) tot += e[1]; let r = Math.random() * tot; for (const e of L) { r -= e[1]; if (r <= 0) return e[0]; } return L[0][0];
  }
  smash(a, c) {                                                                                       // heavy blows damage what they hit: destructible walls and props near the fists
    const g = this.g, A = a.def; if (!g.props) return; this.mk.fistL.getWorldPosition(_a); this.mk.fistR.getWorldPosition(_b); const mid = _c.copy(_a).add(_b).multiplyScalar(0.5); const gy = g.world.groundAt(mid.x, mid.z, mid.y + 0.5, 3, 0.3);
    const fwd = _dir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); const w = g.props.nearestWall(this.home, this.yaw, 5.2); if (w) g.props.damageWall(w, A.dmg * 2.2, mid.clone(), fwd.clone());
    if (A.smash) { const gp = new THREE.Vector3(mid.x, gy > -1 ? gy : this.home.y, mid.z); g.props.shockwave(gp, A.smash, 9, 60, 40); groundFX(g, gp, 0.7); g.camera.addTrauma(0.12); }
  }
  // ---- block ----------------------------------------------------------------------------------------------------------------------------------------------------------------------
  do_block(a, dt, c) {
    this.faceP(dt, c, 5); this.blocking = a.phase !== 'rec' && this.ib.canAct;
    if (!this.ib.canAct) { this.blocking = false; this.cancelAct(); return; }
    if (c.dc > 22 && !c.pAir && a.t > 0.6) a.strike = Math.min(a.strike, a.t - a.windup);
    if (a.phase === 'rec') this.blocking = false;
  }
  // ---- arm cannon -----------------------------------------------------------------------------------------------------------------------------------------------------------------
  do_blast(a, dt, c, A) { this.stepBlast(a, dt, c, A, false); }
  do_chargedBlast(a, dt, c, A) { this.stepBlast(a, dt, c, A, true); }
  stepBlast(a, dt, c, A, charged) {
    const g = this.g; this.faceP(dt, c, a.phase === 'rec' ? 0 : A.track * (charged && a.phase === 'strike' ? 0.4 : 1)); const m = this.mk.cannon; m.getWorldPosition(_f);
    if (a.phase === 'wind') {
      const k = clamp(a.t / a.windup, 0, 1);
      if (charged) {                                                                                 // visible warning: red energy gathers at the cannon and a red light grows
        if (Math.random() < 0.8) { g.fx.glow.emit({ pos: _f, size: 0.6 + 2.4 * k, life: 0.1, drag: 0, color: [1, 0.15 + 0.2 * k, 0.1], alpha: 0.6 + 0.4 * k }); }
        for (let i = 0; i < 2; i++) { _a.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(2.6 * (1 - k) + 0.3); g.fx.glow.emit({ pos: _b.copy(_f).add(_a).clone(), vel: _a.clone().multiplyScalar(-4), size: 0.25, life: 0.22, drag: 0, color: [1, 0.3, 0.15], alpha: 0.9 }); }
        if (k > 0.1 && !a.lit) { a.lit = true; } g.fire.lights.flash(_f.clone(), [1, 0.15, 0.1], 18 + 40 * k, 0.1, 14);
        if (!a.warn && k > 0.2) { a.warn = true; g.sfx.charge && g.sfx.charge(1.0); }
      } else if (Math.random() < 0.5) g.fx.glow.emit({ pos: _f, size: 0.3 + 0.8 * k, life: 0.1, drag: 0, color: [1, 0.45, 0.25], alpha: 0.7 });
    }
    if (a.phase === 'strike' && !a.fired) {
      a.fired = true; const d = this.aimAt(_f, c, charged ? 30 : 38, charged ? 0.35 : 0.5).clone(); a.aimY = clamp(d.y, -0.7, 0.7); this.fireBolt(_f, d, charged); this.stats.blasts++;
    }
  }
  fireBolt(from, dir, charged) {
    const g = this.g, A = this.ATK[charged ? 'chargedBlast' : 'blast']; const b = { pos: from.clone(), prev: from.clone(), vel: dir.clone().multiplyScalar(charged ? 30 : 38), life: 3.2, r: charged ? 1.1 : 0.55, charged, dmg: A.dmg * this.cfg.atkMul * (1 + 0.06 * this.phase), A, age: 0 };
    this.bolts.push(b); if (this.bolts.length > 8) this.bolts.shift(); g.sfx.zap && g.sfx.zap(charged ? 0.5 : 0.3); g.sfx.boom && g.sfx.boom(charged ? 0.4 : 0.15); g.camera.addTrauma(charged ? 0.18 : 0.06);
    g.fx.glow.emit({ pos: from, size: charged ? 3.5 : 1.8, life: 0.15, drag: 0, color: [1, 0.35, 0.2], alpha: 1 });
  }
  updateBolts(dt) {
    const g = this.g, P = g.player;
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i]; b.age += dt; b.prev.copy(b.pos); b.pos.addScaledVector(b.vel, dt); b.life -= dt; let end = null;
      // world: walls / ground
      _dir.copy(b.vel).normalize(); const L = b.prev.distanceTo(b.pos); const hit = g.world.raySolid(b.prev, _dir, L + b.r * 0.4, false);
      if (hit) end = { pt: b.prev.clone().addScaledVector(_dir, hit.t), world: true };
      else { const gy = g.world.groundAt(b.pos.x, b.pos.z, b.pos.y + 1, 2, 0.1); if (gy > -1 && b.pos.y - b.r * 0.5 < gy) end = { pt: new THREE.Vector3(b.pos.x, gy + 0.1, b.pos.z), world: true }; }
      // player (swept segment against the capsule)
      const ph = playerSegHit(g, b.prev, end ? end.pt : b.pos, b.r);
      if (ph && !this.noHit(P)) end = { pt: ph.point.clone(), player: true };
      if (end) { this.boltEnd(b, end); this.bolts.splice(i, 1); continue; }
      if (b.life <= 0) { this.bolts.splice(i, 1); continue; }
      // look
      const k = b.charged ? 1 : 0.5; g.fx.glow.emit({ pos: b.pos, size: (b.charged ? 2.4 : 1.2), life: 0.07, drag: 0, color: [1, b.charged ? 0.18 : 0.42, 0.18], alpha: 1 });
      g.fx.glow.emit({ pos: b.pos, size: (b.charged ? 1.0 : 0.5), life: 0.06, drag: 0, color: [1, 0.9, 0.8], alpha: 1 });
      if (Math.random() < 0.7) g.fx.glow.emit({ pos: b.pos, vel: _b.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(k * 2).clone(), size: 0.25 * (b.charged ? 2 : 1), life: 0.25, drag: 2, color: [1, 0.3, 0.1], alpha: 0.8 });
      if (b.charged && (Math.floor(b.age * 30) % 3 === 0)) g.fire.lights.flash(b.pos.clone(), [1, 0.25, 0.12], 24, 0.1, 14);
    }
  }
  boltEnd(b, end) {
    const g = this.g, P = g.player, pt = end.pt, A = b.A; const R = b.charged ? 4.6 : 1.8;
    g.fx.glow.emit({ pos: pt, size: R * 1.4, life: 0.16, drag: 0, color: [1, 0.5, 0.25], alpha: 1 });
    for (let k = 0; k < (b.charged ? 22 : 10); k++) g.fx.glow.emit({ pos: pt, vel: _a.set(rand(-1, 1), rand(0.1, 1.3), rand(-1, 1)).normalize().multiplyScalar(rand(3, b.charged ? 12 : 8)).clone(), size: rand(0.2, 0.5), life: rand(0.25, 0.6), drag: 2, grav: 2, color: [1, rand(0.25, 0.6), 0.12], alpha: 1 });
    g.fx.surface.ring(_a.copy(pt), UP, R * 1.6, 0.4, 0xff5a2a); g.sfx.boom(b.charged ? 0.7 : 0.35); g.camera.addTrauma((b.charged ? 0.3 : 0.1) * clamp(1 - pt.distanceTo(P.pos) / 50, 0.1, 1)); g.fire.lights.flash(pt.clone(), [1, 0.4, 0.2], b.charged ? 90 : 40, 0.3, 24);
    // what the blast actually touches: destructible walls / props in the blast radius, and the player if inside it (distance check, line clear)
    if (g.props) { g.props.shockwave(pt, R * 1.1, b.charged ? 14 : 6, b.charged ? 260 : 90, b.charged ? 120 : 45); }
    const cap = this.shots.playerCapsule(P, this._pc || (this._pc = {})); const d2 = segSeg2(pt, pt, cap.a, cap.b);
    if (!this.noHit(P) && d2 < (R + cap.r) * (R + cap.r) && (end.player || b.charged || d2 < (1.6 + cap.r) ** 2)) {
      const dir = _b.set(P.pos.x - pt.x, 0, P.pos.z - pt.z); if (dir.lengthSq() < 1e-4) dir.set(b.vel.x, 0, b.vel.z); dir.normalize().clone();
      const f = end.player ? 1 : 1 - Math.sqrt(d2) / (R + cap.r) * 0.6;
      const imp = attackImpact({ damage: b.dmg * f * (g.chars.id === 'greymatter' ? 0.6 : 1), knockbackForce: A.kb * f, upwardForce: A.up, staggerDuration: A.stag, knockdownThreshold: 10.5, launchThreshold: 22, point: pt.clone(), dir, name: A.name, src: this, color: [1, 0.4, 0.2] });
      const res = g.impact.hitPlayer(imp); this.onPlayerHit(A.name, res);
    }
  }
  // ---- slam / shockwaves --------------------------------------------------------------------------------------------------------------------------------------------------------------
  do_slam(a, dt, c, A) {
    this.faceP(dt, c, a.phase === 'wind' ? A.track : 0);
    if (a.phase === 'wind' && Math.random() < 0.5) { this.mk.fistL.getWorldPosition(_f); this.g.fx.glow.emit({ pos: _f, size: 0.3 + 0.7 * (a.t / a.windup), life: 0.1, drag: 0, color: [1, 0.5, 0.2], alpha: 0.7 }); }
    if (a.phase === 'strike' && !a.fired) {
      a.fired = true; this.mk.fistL.getWorldPosition(_a); this.mk.fistR.getWorldPosition(_b); const mid = _c.copy(_a).add(_b).multiplyScalar(0.5); const gy = this.g.world.groundAt(mid.x, mid.z, mid.y + 0.5, 3, 0.3);
      const gp = new THREE.Vector3(mid.x, gy > -1 ? gy : this.home.y, mid.z); this.stats.slams++; this.quake(gp, this.cfg.slamR, A.dmg * this.cfg.atkMul * (1 + 0.06 * this.phase), A.kb, A.up, 'slam'); this.hitstop = 0.06;
      const w = this.g.props && this.g.props.nearestWall(this.home, this.yaw, 5.0); if (w) this.g.props.damageWall(w, 220, gp.clone(), _dir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).clone());
    }
  }
  /** an expanding ring: damages the player only when the wavefront really passes his feet (and he is on the ground): jump it, fly over it, or walk out of the radius */
  quake(pos, R, dmg, kb, up, name) {
    const g = this.g; groundFX(g, pos, clamp(R / 8, 0.6, 1.3)); g.camera.addTrauma(clamp(R / 25, 0.15, 0.5) * clamp(1 - pos.distanceTo(g.player.pos) / 60, 0.2, 1)); g.sfx.boom(0.5);
    g.fx.surface.ring(_a.set(pos.x, pos.y + 0.08, pos.z), UP, R * 1.1, 0.55, 0xffc08a);
    for (let i = 0; i < 16; i++) g.fx.dust.emit({ pos: _b.set(pos.x + rand(-1, 1), pos.y + 0.2, pos.z + rand(-1, 1)).clone(), vel: _c.set(rand(-1, 1), rand(0.1, 0.7), rand(-1, 1)).normalize().multiplyScalar(rand(3, 8)).clone(), size: 1.0, grow: 2, life: 0.9, drag: 2, color: [0.75, 0.72, 0.66], alpha: 0.42 });
    if (g.props) g.props.shockwave(pos, R, clamp(kb * 0.5, 6, 14), dmg * 5, dmg * 2);
    if (this.waves.length < 4) this.waves.push({ pos: pos.clone(), r: 0.6, R, dmg, kb, up, hit: false, name });
  }
  updateWaves(dt) {
    const g = this.g, P = g.player;
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i]; w.r += dt * 20;
      if (w.r > w.R + 1.5) { this.waves.splice(i, 1); continue; }
      for (let k = 0; k < 3; k++) { const ang = Math.random() * 6.283; g.fx.dust.emit({ pos: _a.set(w.pos.x + Math.cos(ang) * w.r, w.pos.y + 0.2, w.pos.z + Math.sin(ang) * w.r).clone(), vel: _b.set(Math.cos(ang) * 2, 1.2, Math.sin(ang) * 2).clone(), size: 0.7, grow: 1.4, life: 0.5, drag: 2, color: [0.78, 0.74, 0.68], alpha: 0.32 }); }
      if (w.hit || this.noHit(P) || P.mode === 'swim') continue;
      const pr = P.rad ?? 0.5, d = hyp(P.pos.x - w.pos.x, P.pos.z - w.pos.z), giant = g.chars.id === 'waybig';
      const gy = g.world.groundAt(P.pos.x, P.pos.z, P.pos.y + 0.6, 1.5, 0.3), onGround = giant || (gy > -1 ? P.pos.y - gy < 0.9 : P.pos.y < w.pos.y + 0.9);
      if (onGround && Math.abs(d - pr * 0.6 - w.r) < 1.3 + pr * 0.5 && d < w.R + pr) {
        w.hit = true; const f = clamp(1 - d / (w.R * 1.25), 0.35, 1), dir = _b.set(P.pos.x - w.pos.x, 0, P.pos.z - w.pos.z); if (dir.lengthSq() < 1e-4) dir.set(1, 0, 0); dir.normalize().clone();
        const imp = attackImpact({ damage: w.dmg * f, knockbackForce: w.kb * f, upwardForce: w.up * f, staggerDuration: 0.6, knockdownThreshold: 10.5, launchThreshold: 24, point: P.pos.clone().setY(P.pos.y + 0.6), dir, name: w.name, src: this });
        const res = g.impact.hitPlayer(imp); this.onPlayerHit(w.name, res); this.stats.shockHits++;
      }
    }
  }
  // ---- tentacle whip --------------------------------------------------------------------------------------------------------------------------------------------------------------
  do_tentWhip(a, dt, c, A) {
    this.updateTent(c); const T = this.tent; this.headPos(_g);
    const base = Math.atan2(c.dx, c.dz); a.sweepBase = a.sweepBase ?? base; const u = a.phase === 'strike' ? clamp((a.t - a.windup) / a.strike, 0, 1) : a.phase === 'wind' ? 0 : 1;
    if (a.phase === 'wind') { this.faceP(dt, c, A.track); a.sweepBase = Math.atan2(c.dx, c.dz); }
    const sgn = a.hand === 'L' ? 1 : -1, ang = a.sweepBase + sgn * (a.phase === 'wind' ? 1.0 * sm(a.t / a.windup) : lerp(1.0, -1.0, sm(u)) * (a.phase === 'rec' ? 1 : 1)) * (a.phase === 'rec' ? 1 - sm((a.t - a.windup - a.strike) / (a.dur - a.windup - a.strike)) : 1);
    T.dir.set(Math.sin(ang), a.phase === 'wind' ? 0.35 : clamp((c.cy - this.home.y - 4.1) / Math.max(c.dc, 3), -0.2, 0.85), Math.cos(ang)).normalize(); T.spread = 0.14; T.reach = clamp(c.dc + 1.5, 5, this.cfg.tentReach - 2) * (a.phase === 'wind' ? 0.55 + 0.45 * sm(a.t / a.windup) : 1);
    this.tentTarget = a.phase === 'rec' ? 0.35 * (1 - sm((a.t - a.windup - a.strike) / (a.dur - a.windup - a.strike))) : 1; if (a.phase === 'strike' && !a.fired) { a.fired = true; this.g.sfx.whoosh(); this.stats.tentWhips++; this.g.camera.addTrauma(0.06); }
    if (a.phase === 'strike') { a.dirO = _b.set(Math.cos(ang) * -sgn, 0, -Math.sin(ang) * -sgn).clone(); }
  }
  meleeTest(c) {
    const a = this.act;
    if (a && a.name === 'tentWhip') {
      if (a.phase !== 'strike' || a.spent) return; const g = this.g, P = c.P, cap = this.shots.playerCapsule(P, this._pc || (this._pc = {})), ch = this.rigV.feelers;
      for (let i = 0; i < ch.length; i++) {
        if (!ch[i].length) continue; ch[i][0].getWorldPosition(_a); this.mk['tip' + i].getWorldPosition(_b);
        if (segSeg2(_a, _b, cap.a, cap.b) < (0.95 + cap.r) ** 2) {
          const contact = _c.copy(cap.a).lerp(cap.b, 0.5).clone(); this.headPos(_o); _dir.subVectors(contact, _o); const L = _dir.length(); _dir.multiplyScalar(1 / L);
          if (g.world.raySolid(_o, _dir, Math.max(0, L - (cap.r + 0.1)), true)) continue;                                      // no hits through walls
          a.spent = true; this.strike(a, a.def, c, contact); return;
        }
      }
      return;
    }
    super.meleeTest(c);
  }
  // ---- charge ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
  do_charge(a, dt, c, A) {
    const cfg = this.cfg, g = this.g, h = this.home;
    if (a.phase === 'wind') {                                                                                    // readable telegraph: he turns to the target, digs in (stomp + dust), roars, leans forward
      this.faceP(dt, c, 2.6); a.stompT = (a.stompT || 0) - dt;
      if (a.stompT <= 0) { a.stompT = 0.3; _f.set(h.x + rand(-1, 1), h.y + 0.2, h.z + rand(-1, 1)); g.fx.dust.emit({ pos: _f, vel: _b.set(rand(-1, 1), 0.6, rand(-1, 1)).clone(), size: 1.1, grow: 1.6, life: 0.6, drag: 2, color: [0.75, 0.72, 0.66], alpha: 0.4 }); g.sfx.thud(0.25); g.camera.addTrauma(0.05); }
      if (!a.roar && a.t > 0.25) { a.roar = true; g.sfx.roar && g.sfx.roar(); }
      return;
    }
    if (a.phase === 'strike') {
      if (!a.go) {                                                                                             // the heading starts on the player and can only be bent a little afterwards
        a.go = true; a.dashDir = _a.set(c.dx, 0, c.dz).normalize().clone(); this.yawT = this.yaw = Math.atan2(a.dashDir.x, a.dashDir.z); a.strike = clamp((c.dc + 3.0) / (cfg.rush * 0.8) + 0.45, 0.9, 2.4); a.dur = a.windup + a.strike + a.rec; a.t0 = a.t; this.stats.charges++; g.camera.addTrauma(0.1);
      }
      // LIMITED STEERING: he only corrects his heading while the target is still far (> 7 m) and during the first 0.9 s of the run; after that the heading is locked, so a sidestep makes him run past
      const el = a.t - a.t0;
      if (c.dc > 7 && el < 0.5) { const cur = Math.atan2(a.dashDir.x, a.dashDir.z), da = clamp(angleDelta(cur, Math.atan2(c.dx, c.dz)), -cfg.chargeSteer * (1 + 0.2 * this.phase) * dt, cfg.chargeSteer * (1 + 0.2 * this.phase) * dt); a.dashDir.set(Math.sin(cur + da), 0, Math.cos(cur + da)); }
      const k = sm(el / 0.5), sp = cfg.rush * k; this.av.set(a.dashDir.x * sp, 0, a.dashDir.z * sp); this.animBoost = Math.max(this.animBoost, 6.5 + 4 * k);
      this.yawT = Math.atan2(a.dashDir.x, a.dashDir.z); this.turn(dt, 1.0);
      a.stepT = (a.stepT || 0) - dt; if (a.stepT <= 0) { a.stepT = 0.2; g.fx.dust.emit({ pos: _f.set(h.x, h.y + 0.2, h.z), vel: _b.set(-a.dashDir.x * 2, 0.7, -a.dashDir.z * 2).clone(), size: 1.1, grow: 1.6, life: 0.6, drag: 2, color: [0.75, 0.72, 0.66], alpha: 0.4 }); if (g.props) g.props.shockwave(_o.set(h.x + a.dashDir.x * 2.6, h.y, h.z + a.dashDir.z * 2.6), 3.4, 9, 90, 55); g.camera.addTrauma(0.03); }
      // collision with the player: the swept body (a real body width, not a huge cone)
      if (!a.spent) { const cap = this.shots.playerCapsule(c.P, this._pc || (this._pc = {})); const p0 = a.prevH || (a.prevH = h.clone()); _o.set(p0.x, p0.y + 1.8, p0.z); _dir.set(h.x, h.y + 1.8, h.z); if (segSeg2(_o, _dir, cap.a, cap.b) < (cfg.rad * 0.9 + 0.45 + cap.r) ** 2 && !this.noHit(c.P)) { a.spent = true; this.stats.chargeHits++; this.strike(a, A, c, _c.copy(cap.a).lerp(cap.b, 0.5).clone()); this.av.multiplyScalar(0.3); this.hitstop = 0.08; a.strike = Math.min(a.strike, a.t - a.windup); a.dur = a.windup + a.strike + a.rec; } p0.copy(h); }
      if (this.stuckT > 0.25 && this.spd < 1 && hyp(this.av.x, this.av.z) > 3) { this.wallCrash(a, c); }
    } else {
      if (!a.spent && !a.missed) { a.missed = true; this.stats.chargeMiss++; a.dur = Math.max(a.dur, a.t + 1.4); this.g.hud.tag(_a.set(h.x, h.y + 5, h.z).clone(), 'MISSED'); }   // ran past: a long recovery, the player may counter
      this.av.multiplyScalar(Math.exp(-5 * dt)); this.animBoost = Math.max(this.animBoost, hyp(this.av.x, this.av.z) * 0.8);
    }
  }
  /** the underwater charge: a torpedo run along a heading that is only bent a little, collides with the swimmer, long recovery on a miss */
  do_swimCharge(a, dt, c, A) {
    const cfg = this.cfg, g = this.g, h = this.home, L = this.lag(), cc = _s3.set(h.x, h.y + cfg.PV, h.z);
    this.swimWant.set(0, 0, 0); this.swimSpd = 0;
    if (a.phase === 'wind') {
      this.faceP(dt, c, 2.4); a.bt = (a.bt || 0) - dt; if (a.bt <= 0) { a.bt = 0.12; L.bubbleBurst(cc, 4, 1.0, 1.0, 0.1); }
      if (!a.roar && a.t > 0.25) { a.roar = true; g.sfx.roar && g.sfx.roar(); }
      this.vv.multiplyScalar(Math.exp(-3 * dt)); return;
    }
    if (a.phase === 'strike') {
      if (!a.go) { a.go = true; a.dash = new THREE.Vector3(c.dx, c.cy - cc.y, c.dz).normalize(); a.t0 = a.t; a.strike = clamp((c.dc + 3.0) / (cfg.swimRush * 0.8) + 0.4, 0.8, 2.2); a.dur = a.windup + a.strike + a.rec; a.pc = cc.clone(); this.stats.swimCharges++; this.stats.charges++; g.camera.addTrauma(0.08); }
      const el = a.t - a.t0, to = _s5.set(c.dx, c.cy - cc.y, c.dz), dist = to.length();
      if (dist > 7 && el < 0.5 && dist > 1e-3) { to.multiplyScalar(1 / dist); const ang = a.dash.angleTo(to), mx = cfg.chargeSteer * dt; if (ang > 1e-4) a.dash.lerp(to, Math.min(1, mx / ang)).normalize(); }
      const k = sm(el / 0.45), sp = cfg.swimRush * k; this.swimHold = true; this.vv.copy(a.dash).multiplyScalar(sp); this.av.set(0, 0, 0);
      this.yawT = Math.atan2(a.dash.x, a.dash.z); this.turn(dt, 2.0); this.animBoost = Math.max(this.animBoost, 6);
      a.dirO = a.dirO || new THREE.Vector3(); a.dirO.set(a.dash.x, 0, a.dash.z).normalize();
      if (Math.random() < dt * 20) L.bubble(cc.x - a.dash.x * 1.5 + rand(-0.8, 0.8), cc.y + rand(-0.8, 0.8), cc.z - a.dash.z * 1.5 + rand(-0.8, 0.8), 0.12, 0, 0.6, 0, 3);
      if (!a.spent) { const cap = this.shots.playerCapsule(c.P, this._pc || (this._pc = {})); if (segSeg2(a.pc, cc, cap.a, cap.b) < (cfg.rad * 0.9 + 0.45 + cap.r) ** 2) { a.spent = true; this.stats.chargeHits++; this.strike(a, A, c, _c.copy(cap.a).lerp(cap.b, 0.5).clone()); this.vv.multiplyScalar(0.3); this.hitstop = 0.08; L.bubbleBurst(_c, 18, 0.8, 1.6, 0.1); a.strike = Math.min(a.strike, a.t - a.windup); a.dur = a.windup + a.strike + a.rec; } }
      a.pc.copy(cc); if (this.swimStuck > 0.4) { a.strike = Math.min(a.strike, Math.max(0.05, a.t - a.windup)); a.dur = a.windup + a.strike + a.rec; this.vv.multiplyScalar(0.2); }
    } else {
      if (!a.spent && !a.missed) { a.missed = true; this.stats.chargeMiss++; a.dur = Math.max(a.dur, a.t + 1.3); g.hud.tag(_a.set(h.x, h.y + 5, h.z).clone(), 'MISSED'); }
      this.vv.multiplyScalar(Math.exp(-3.2 * dt));
    }
  }
  wallCrash(a, c) {
    const g = this.g, h = this.home; this.av.set(0, 0, 0); this.stuckT = 0; a.strike = Math.min(a.strike, Math.max(0.05, a.t - a.windup)); a.dur = a.windup + a.strike + a.rec + 0.4; g.camera.addTrauma(0.35); g.sfx.boom(0.6);
    const pt = _a.set(h.x + a.dashDir.x * 2.0, h.y + 2, h.z + a.dashDir.z * 2.0); groundFX(g, h, 1.0); if (g.props) { const w = g.props.nearestWall(h, this.yaw, 4.5); if (w) g.props.damageWall(w, 320, pt.clone(), a.dashDir.clone()); g.props.shockwave(pt, 5, 9, 160, 80); }
    g.hud.tag(pt.clone(), 'CRASH'); this.recoverT = 0.4;
  }
  // ---- jump -----------------------------------------------------------------------------------------------------------------------------------------------------------------------
  do_jump(a, dt, c, A) {
    const cfg = this.cfg, g = this.g, h = this.home;
    if (a.jph === 'wind') {
      this.faceP(dt, c, 4); if (a.t >= a.windup) {                                                           // take off toward where the player is going to be (clamped, not a teleport)
        const P = c.P, pv = P.form === 'ball' ? P.v : P.vel, T = 1.05, lx = P.pos.x + (pv ? pv.x * 0.35 : 0) - h.x, lz = P.pos.z + (pv ? pv.z * 0.35 : 0) - h.z, d = hyp(lx, lz) || 1, dist = clamp(d - 2.4, 3, 24);
        a.vx = lx / d * dist / T; a.vz = lz / d * dist / T; this.fallV = 26 * T / 2; h.y += 0.15; a.jph = 'air'; a.tL = a.t; a.air = 0; a.strike = 2.6; a.dur = 99; this.stats.jumps++; this.yawT = this.yaw = Math.atan2(lx, lz); g.sfx.whoosh(); groundFX(g, h, 0.7); g.camera.addTrauma(0.1);
      } return;
    }
    if (a.jph === 'air') {
      a.air = clamp((a.t - a.tL) / 1.0, 0, 1); this.av.set(a.vx, 0, a.vz); this.animBoost = 5.5; this.yawT = Math.atan2(a.vx, a.vz); this.turn(dt, 3);
      const gy = this.floor(); if (a.t - a.tL > 0.2 && this.fallV === 0 && h.y <= gy + 0.12) {
        a.jph = 'land'; a.landT = 0; this.av.set(0, 0, 0); a.dur = a.t + A.rec; a.windup = 0; a.strike = 0; groundFX(g, h, 1.2); g.sfx.thud(0.6);
        this.quake(h, 7.0, A.dmg * cfg.atkMul, A.kb, A.up, 'jumpLanding'); this.recoverT = 0.2;
      } else if (a.t - a.tL > 2.5) { a.dur = a.t + 0.3; a.jph = 'land'; }
      return;
    }
    a.landT = (a.landT || 0) + dt; this.av.multiplyScalar(Math.exp(-8 * dt));
  }
  // ---- props ------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  releaseProp(throwIt) { const p = this.heldProp; if (!p) return; this.heldProp = null; if (this.g.props) { this.g.props.release(p, null, null); p.vg = null; } void throwIt; }
  do_propThrow(a, dt, c, A) {
    const g = this.g, h = this.home, P = this.g.props, p = a.prop; a.pt += dt; const q = a.pph;
    const fin = () => { a.dur = a.t + 0.5; a.pph = 'rec'; a.pu = 0; a.strike = 0; a.windup = 0; };
    if (q === 'rec') { this.faceP(dt, c, 2); if (a.t >= a.dur) this.endAct(c); return; }
    if (!p || p.dead || (q === 'reach' && (p.held || p.state === 'fly'))) { if (q !== 'reach') this.releaseProp(false); this.endAct(c); a.dur = 0; return; }
    const hold = _a.set(h.x + Math.sin(this.yaw) * 0.6, h.y + 5.5 + p.size.h * 0.5, h.z + Math.cos(this.yaw) * 0.6);
    if (q === 'reach') {
      const d = hyp(p.pos.x - h.x, p.pos.z - h.z), need = 3.0 + Math.max(p.half.x, p.half.z); this.yawT = Math.atan2(p.pos.x - h.x, p.pos.z - h.z); this.turn(dt, 3.5);
      if (d > need) { this.av.set(Math.sin(this.yaw) * 6, 0, Math.cos(this.yaw) * 6); this.animBoost = 4; a.pu = 0.2; a.pt = Math.min(a.pt, 0.2); if (a.t > 5) fin(); return; }
      this.av.multiplyScalar(Math.exp(-10 * dt)); a.pu = clamp(a.pt / 0.5, 0, 1); if (a.pt > 0.5) { P.setHeld(p); this.heldProp = p; p.vg = this; a.from = p.pos.clone(); a.pph = 'lift'; a.pt = 0; a.pu = 0; g.sfx.thud(0.4); }
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
        a.thrown = true; const spd = 24, from = p.center, tgt = _b.set(c.P.pos.x, c.cy, c.P.pos.z), to = _c.copy(tgt).sub(from), dx = hyp(to.x, to.z), tt = Math.max(dx / spd, 0.25);
        const v = new THREE.Vector3(to.x / tt, to.y / tt + 0.5 * 26 * tt, to.z / tt); if (v.length() > 40) v.setLength(40);
        P.release(p, v, new THREE.Vector3(rand(-3, 3), rand(-3, 3), rand(-3, 3))); this.heldProp = null; p.vgT = 0; p.vgPrev = p.center.clone(); this.thrown.push(p); if (this.thrown.length > 3) { const o = this.thrown.shift(); o.vg = null; }
        g.sfx.whoosh(); g.camera.addTrauma(0.12); this.stats.propThrows++;
      }
      if (a.pt >= 0.45) fin();
    }
  }
  updateThrown(dt) {
    const g = this.g, P = g.player;
    for (let i = this.thrown.length - 1; i >= 0; i--) {
      const p = this.thrown[i]; if (!p || p.dead || p.held || p.vg !== this) { this.thrown.splice(i, 1); continue; }
      p.vgT += dt; const sp = p.vel.length(); const c = p.center; if (p.vgT > 7 || (p.state === 'rest' && p.vgT > 0.4)) { p.vg = null; this.thrown.splice(i, 1); continue; }
      if (p.hitP || sp < 5.5 || P.ignoreHits || P.mode === 'swim') { p.vgPrev.copy(c); continue; }
      const cap = this.shots.playerCapsule(P, this._pc || (this._pc = {})), R = Math.max(p.half.x, p.half.z) * 0.85 + cap.r + 0.15;
      if (segSeg2(p.vgPrev, c, cap.a, cap.b) < R * R && Math.abs(c.y - (P.pos.y + 1)) < p.size.h / 2 + (P.colH ?? 2.2) / 2 + 0.4) {
        p.hitP = true; const dir = _b.copy(p.vel).setY(0); if (dir.lengthSq() < 1e-4) dir.set(P.pos.x - c.x, 0, P.pos.z - c.z); dir.normalize().clone();
        const dmg = clamp(Math.sqrt(p.mass) * sp * 0.3, 14, 66); const imp = attackImpact({ damage: dmg, knockbackForce: 8 + sp * 0.5, upwardForce: 3, staggerDuration: 0.6, knockdownThreshold: 10.5, launchThreshold: 24, point: cap.a.clone().lerp(cap.b, 0.5), dir, name: 'thrownProp', src: this });
        const res = g.impact.hitPlayer(imp); this.onPlayerHit('thrownProp', res); g.props.hurt(p, dmg * 0.4, dir); g.props.impactFX(p.center, 1.2, p.debris, true); p.vel.multiplyScalar(0.35);
      }
      p.vgPrev.copy(c);
    }
  }
  // ============================================================================================================================ frame end: effects, tentacle smoothing, projectiles
  finish(dt, c) {
    const T = this.tent; T.ext = damp(T.ext, this.tentTarget, this.tentTarget > T.ext ? 16 : 7, dt);
    const s0 = this.stats.steps; super.finish(dt, c);
    if (this.stats.steps !== s0 && !this.dead && this.ib.state === 'ok') { const near = clamp(1 - c.dc / 55, 0.05, 1); this.g.sfx.thud(0.3 * near); this.g.camera.addTrauma((this.spd > 5 ? 0.05 : 0.025) * near); this.g.fx.dust.emit({ pos: _a.set(this.home.x + rand(-0.5, 0.5), this.home.y + 0.1, this.home.z + rand(-0.5, 0.5)).clone(), vel: _b.set(rand(-0.5, 0.5), 0.6, rand(-0.5, 0.5)).clone(), size: 1.0, grow: 1.4, life: 0.6, drag: 2, color: [0.72, 0.69, 0.63], alpha: 0.32 }); }
    this.updateBolts(dt); this.updateWaves(dt); this.updateThrown(dt); this.waterFX(dt, c);
    if (this.act && this.act.name === 'propThrow' && this.act.pph === 'rec') { /* ends via dispatcher */ }
  }
  /** readable AI state (the spec's state list) */
  aiState() {
    const ib = this.ib, a = this.act; if (this.dead) return 'DEFEATED'; if (ib.state === 'air') return 'KNOCKED BACK'; if (ib.state === 'stagger' && ib.tier >= 2) return 'STAGGER'; if (ib.state !== 'ok' && ib.state !== 'stagger') return 'STAGGER';
    if (this.mode === 'swim' && !a) return this.recoverT > 0 ? 'RECOVERY' : this.swimSp > 7 ? 'UNDERWATER CHASE' : 'SWIMMING';
    if (a) { const n = a.name; return ({ block: 'BLOCK', dodge: 'DODGE', jump: 'JUMP', charge: 'CHARGE', roar: 'DETECT', swimCharge: 'SWIM-CHARGE', land: 'RECOVERY', blast: 'RANGED', chargedBlast: 'RANGED · CHARGING', grab: 'GRAB', tentGrab: 'TENTACLE GRAB', tentWhip: 'TENTACLE WHIP', slam: 'GROUND SLAM', propThrow: 'THROWING OBJECT', heavy: 'MELEE', punch: 'MELEE', backhand: 'MELEE' })[n] || n.toUpperCase(); }
    if (this.counterT > 0) return 'COUNTERATTACK'; if (this.recoverT > 0) return 'RECOVERY';
    if (this.st === 'idle') return this.wp ? 'PATROL' : 'IDLE'; if (this.st === 'search') return 'SEARCHING';
    return this.intent.kind === 'circle' ? 'POSITIONING' : this.spd > 6 ? 'CHASE' : 'APPROACH';
  }
  stateLabel() { return this.aiState(); }
  debugText() {
    const ib = this.ib, a = this.act, h = this.home, c = this.ctx || {};
    return `VILGAX  hp ${this.hp.toFixed(0)}/${this.maxHp.toFixed(0)}  phase ${this.phase + 1}  ${this.aiState()}  ${this.mode}  body ${ib.state}${ib.tier ? ' t' + ib.tier : ''}  poise ${ib.poise.toFixed(0)}  ai ${this.aiOn ? 'ON' : 'OFF'}\n` +
      `pos ${h.x.toFixed(1)}, ${h.y.toFixed(1)}, ${h.z.toFixed(1)}  spd ${this.spd.toFixed(1)}  dist ${c.dc ? c.dc.toFixed(1) : '-'}  act ${a ? a.name + ' ' + a.phase : '-'}  blocked ${this.stats.blocked}  counters ${this.stats.counters}  water ${this.mode === 'swim' ? 'SWIM' : this.waterDepthAt(h.x, h.z) > 0.25 ? 'WADE' : 'dry'}  charges ${this.stats.charges}/${this.stats.chargeHits}h/${this.stats.chargeMiss}m\n` +
      `attacks ${Object.entries(this.stats.attacks).map(([k, v]) => k + ':' + v).join(' ') || '-'}  landed on player ${this.stats.playerHits}  grabs ${this.stats.grabs || 0}  throws ${this.stats.throws || 0}`;
  }
}
const lerp = (a, b, u) => a + (b - a) * u;
