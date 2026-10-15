// SHARED COMBAT IMPACT SYSTEM.
// One implementation of "what happens physically when something is hit", used by Kevin 11, by the player (all playable aliens) and fed by every existing attack
// (aliens -> enemies go through Kevin.shove / launch / applyHit, which feed the same ImpactBody; enemies -> aliens go through ImpactSystem.hitPlayer).
//
//   attackImpact({ damage, knockbackForce, upwardForce, staggerDuration, knockdownThreshold, launchThreshold })     <- per-attack properties
//   BODY[id] = { mass, resist, launch, ... }                                                                       <- per-character modifiers (the only per-character part)
//
//   effective speed  v = knockbackForce * (REF_MASS / mass)^0.55 * launch - resist          (heavier = moves less, lighter = flies further)
//   v <  1.0  -> nothing but a flash                v >= 4.2 -> HEAVY hit (stumble, longer stagger)       v >= knockdownThreshold -> KNOCKDOWN (falls, lies, gets up)
//   v >= launchThreshold (or a big upward force) -> LAUNCH (leaves the ground, flies, lands, slides, lies, gets up)
//
// Knockback always follows the attack's WORLD-SPACE direction (never the camera). Movement is done with velocities that decay (no teleporting): ground friction, wall collision with a
// bounce + extra damage, destructible walls take damage when the hit is hard enough, launched bodies collide with buildings / props / cars through the same World.resolveXZ.
// V2: NO ragdoll, NO falling, NO lying down, NO get-up. Every hit is a physical push in world space while the body stays upright (stagger lean only); the strongest hits launch it
// into a CONTROLLED airborne reaction that ends in a normal landing and a short stagger. (Tier names kept: DOWN = strong standing push.)
// Fairness (old text): a knocked-down body cannot act; after it stands up it has a short "recovery window" (grace) in which it can be hit but not knocked down again (no infinite loops);
// bosses additionally have poise (light hits cannot stun-lock them, a poise break gives a short staggered window followed by a short armoured window).
import * as THREE from 'three';
import { clamp, damp, rand, easeOutCubic, easeInOutCubic } from './util.js';

export const REF_MASS = 100;
const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion(), _k = new THREE.Vector3();

/** per-character modifiers (the ONLY per-character part of the impact system).  mass: kg-ish   resist: flat m/s removed from the effective speed   launch: flight multiplier   dodge: chance to slip a hit while fast */
export const BODY = {
  ben:         { mass: 42,  resist: 0,   launch: 1.15 },           // a ten-year-old: light, flies a bit further, no armour at all
  diamondhead: { mass: 130, resist: 2.4, launch: 1.0 },            // crystal body: shrugs off weak hits
  xlr8:        { mass: 55,  resist: 0,   launch: 1.1, dodge: 0.4 }, // light and fast: flies further, but slips many hits
  fourarms:    { mass: 300, resist: 4.0, launch: 0.9 },            // ordinary punches barely move him
  heatblast:   { mass: 75,  resist: 0,   launch: 1.0 },
  upgrade:     { mass: 70,  resist: 0,   launch: 1.05 },
  wildmutt:    { mass: 95,  resist: 0.5, launch: 1.0 },
  ghostfreak:  { mass: 60,  resist: 0,   launch: 1.1 },
  ripjaws:     { mass: 140, resist: 1.0, launch: 1.0 },
  stinkfly:    { mass: 45,  resist: 0,   launch: 1.2 },
  cannonbolt:  { mass: 260, resist: 3.2, launch: 0.9 },
  greymatter:  { mass: 8,   resist: 0,   launch: 1.7, maxV: 26 },  // tiny: launched much farther
  waybig:      { mass: 2.5e6, resist: 99, launch: 0 },              // an 80 m giant: ordinary hits do not move him at all
  kevin:       { mass: 115, resist: 1.2, launch: 1.0, poise: 55 },  // boss: heavy, with poise
  vilgax:      { mass: 500, resist: 1.0, launch: 1.0, poise: 260 },  // 15 ft boss: far heavier than Four Arms - Ben barely moves him, Four Arms shoves him a little, Way Big a lot (V27: shown by the shared combat layer, which keeps him from being stun-locked)
  dummy:       { mass: 70,  resist: 0,   launch: 1.0 },
};
export const PLAYER_HP = { ben: 100, diamondhead: 300, xlr8: 260, fourarms: 400, heatblast: 300, upgrade: 260, wildmutt: 380, ghostfreak: 300, ripjaws: 320, stinkfly: 280, cannonbolt: 420, greymatter: 90, waybig: 3000 };

/** build the property bag of one attack */
export const attackImpact = (o = {}) => Object.assign({ damage: 10, knockbackForce: 6, upwardForce: 0, staggerDuration: 0.35, knockdownThreshold: 9, launchThreshold: 17, ordinary: false }, o);

export const TIER = { NONE: 0, LIGHT: 1, HEAVY: 2, DOWN: 3, LAUNCH: 4 };
const TIER_NAME = ['none', 'light', 'heavy', 'knockdown', 'launch'];

const hFlat = (v) => Math.hypot(v.x, v.z);

export function hitFX(g, pt, dir, k = 1, o = {}) {
  if (g.world && g.world.danger) g.world.danger(pt.x, pt.z, 20 + 10 * k);                     // V28: civilians nearby notice the fight
  const col = o.color || [1, 0.85, 0.55], n = Math.round(3 + 5 * k);
  g.fx.glow.emit({ pos: pt, size: 0.8 + 1.4 * k, life: 0.12, drag: 0, color: col, alpha: 1 });
  for (let i = 0; i < n; i++) g.fx.glow.emit({ pos: pt, vel: _a.set(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).normalize().multiplyScalar(rand(2, 5 + 4 * k)).addScaledVector(dir, 2 + 3 * k).clone(), size: rand(0.08, 0.2) * (0.7 + k * 0.5), life: rand(0.18, 0.34), drag: 2.2, grav: 3, color: col });
  if (k > 0.5) g.fx.dust.emit({ pos: pt, vel: _a.set(rand(-1, 1), rand(0.2, 1), rand(-1, 1)).clone(), size: 0.7, grow: 1.4, life: 0.5, drag: 2.5, color: [0.75, 0.72, 0.66], alpha: 0.35 });
  if (!o.quiet) g.sfx.hit(k > 1.1);
  if (!o.noShake) { const p = g.player.pos, d = Math.hypot(p.x - pt.x, p.z - pt.z), near = clamp(1 - d / 40, 0.15, 1); g.camera.addTrauma((o.trauma ?? 0.06 + 0.12 * k) * near); }
}
export function groundFX(g, p, k = 1) {
  g.fx.surface.ring(_a.set(p.x, p.y + 0.06, p.z), UP, 2.6 + 2.4 * k, 0.4, 0xd8d0c0);
  for (let i = 0; i < 5 + 6 * k; i++) g.fx.dust.emit({ pos: _b.set(p.x + rand(-0.5, 0.5), p.y + 0.1, p.z + rand(-0.5, 0.5)).clone(), vel: _a.set(rand(-1, 1), rand(0.3, 1.2), rand(-1, 1)).multiplyScalar(1.6).clone(), size: 0.7, grow: 1.6, life: 0.7, drag: 2, color: [0.72, 0.69, 0.63], alpha: 0.42 });
  g.sfx.thud(clamp(0.25 + 0.3 * k, 0, 0.9));
  const q = g.player.pos, d = Math.hypot(q.x - p.x, q.z - p.z); g.camera.addTrauma((0.07 + 0.12 * k) * clamp(1 - d / 40, 0.15, 1));
}

/** The physical body model.  o = { getPos(): Vector3 (feet, authoritative), rad, colH, step, mass, resist, launch, maxV, poise, ownVertical, launchFn(vy), groundedFn(), vyFn(),
 *                                   damageFn(dmg, kind), onEvent(type, data), collide(on:boolean)  (disable the host's own collider while resolving) } */
export class ImpactBody {
  constructor(game, o) {
    this.g = game; this.o = Object.assign({ rad: 0.5, colH: 2.2, step: 0.4, mass: 100, resist: 0, launch: 1, wallDmg: 1.4 }, o);
    this.kv = new THREE.Vector3(); this.state = 'ok'; this.stateT = 0; this.tier = 0;
    this.staggerT = 0; this.staggerMax = 0.3; this.lean = 0; this.leanMax = 0; this.theta = 0; this.fdir = new THREE.Vector3(0, 0, 1); this.ldir = new THREE.Vector3(0, 0, 1);
    this.fallT = 0; this.fallMax = 0.42; this.downT = 0; this.downMax = 1.2; this.getT = 0; this.getMax = 0.8; this.grace = 0; this.airT = 0; this.vy = 0; this.vyPrev = 0;
    this.poiseMax = this.o.poise || 0; this.poise = this.poiseMax; this.armor = 0; this.sinceHit = 9; this.spin = 0; this.spinV = 0; this.bounce = 0; this.wantUp = false;
    this.last = { tier: 0, v: 0, dmg: 0 }; this.stats = { hits: 0, light: 0, heavy: 0, knockdowns: 0, launches: 0, wall: 0, wallBreaks: 0, lands: 0, getups: 0, rolls: 0 };
    this.lift = 0; this.slamT = 0;
  }
  get pos() { return this.o.getPos(); }
  /** false while the body cannot act at all */
  get canAct() { return this.state === 'ok' || (this.state === 'stagger' && this.tier <= 1 && this.staggerT < this.staggerMax * 0.55); }
  get incapacitated() { return this.state === 'air'; }
  /** 0..1 factor on voluntary movement */
  get moveScale() { switch (this.state) { case 'ok': return 1; case 'stagger': return this.tier >= 2 ? (this.staggerT > this.staggerMax * 0.5 ? 0.15 : 0.7) : 0.55; case 'air': return 0.22; default: return 0; } }
  get tierName() { return TIER_NAME[this.last.tier]; }
  setMass(m) { Object.assign(this.o, m); this.poiseMax = m.poise || 0; if (!this.poiseMax) this.poise = 0; else if (this.poise > this.poiseMax) this.poise = this.poiseMax; }
  ev(type, data) { if (this.o.onEvent) this.o.onEvent(type, data); }

  /** effective knock speed for an attack */
  effective(imp) {
    const o = this.o, mf = clamp(Math.pow(REF_MASS / o.mass, 0.55), 0.0, 2.6);
    let v = imp.knockbackForce * mf * (o.launch ?? 1) - (o.resist ?? 0) * (imp.ordinary ? 1 : 0.55);
    return clamp(v, 0, o.maxV ?? 34);
  }
  /** apply one hit. imp: attackImpact() + { dir: Vector3 (world, direction the victim is pushed) }. Returns { tier, v } */
  hit(imp) {
    const o = this.o, p = this.pos; this.stats.hits++; this.sinceHit = 0;
    const d = _k.set(imp.dir ? imp.dir.x : 0, 0, imp.dir ? imp.dir.z : 0); if (d.lengthSq() < 1e-6) d.set(Math.sin(imp.yawFallback ?? 0), 0, Math.cos(imp.yawFallback ?? 0)); d.normalize();
    const mf = clamp(Math.pow(REF_MASS / o.mass, 0.55), 0, 2.6);
    let v = this.effective(imp), up = (imp.upwardForce || 0) * mf * (o.launch ?? 1);
    let tier = 0;
    if (v >= imp.launchThreshold || up >= 6.5) tier = 4; else if (v >= imp.knockdownThreshold) tier = 3; else if (v >= 4.2) tier = 2; else if (v >= 1.0 || imp.damage >= 5) tier = 1;
    if (v < 0.35 && up < 0.5) tier = Math.min(tier, 1);
    // ---- poise: bosses cannot be stun-locked by light hits, but are not immune
    if (this.poiseMax) {
      this.poise -= Math.max(imp.damage * 0.9, v * 2.2);
      if (tier <= 2) {
        if (this.armor > 0) tier = Math.min(tier, 1);
        else if (this.poise <= 0) { tier = Math.max(tier, 2); this.poise = this.poiseMax * 1.25; this.armor = 1.7; this.ev('poiseBreak', {}); }
        else tier = Math.max(0, tier - 1);
      }
    }
    // ---- fairness windows
    const airborne = this.state !== 'air' && (o.ownVertical ? p.y > this.groundY() + 0.15 : !o.groundedFn());
    if (this.grace > 0 && tier >= 3) tier = 2;                                   // just recovered: can be hurt, but not pushed hard again at once (no push-lock loops)
    if (o.capTier != null) tier = Math.min(tier, o.capTier(this));
    this.last = { tier, v, dmg: imp.damage };
    if (tier === 0) { this.kv.addScaledVector(d, v * (this.poiseMax ? 1.2 : 0.5)); return { tier, v }; }
    this.ldir.copy(d);
    const slideK = 1;
    if (tier === 1 || tier === 2) {
      const heavy = tier === 2; this.tier = tier; if (heavy) this.stats.heavy++; else this.stats.light++;
      const dur = clamp(imp.staggerDuration * (heavy ? 1.9 : 1) * (0.8 + 0.3 * clamp(v / 6, 0, 2)), 0.12, 1.5);
      if (this.state === 'ok' || this.state === 'stagger') {
        this.state = 'stagger'; this.staggerMax = Math.max(this.staggerT, dur); this.staggerT = this.staggerMax; this.leanMax = heavy ? 0.62 : 0.3;
        this.tier = Math.max(this.tier, tier);
      }
      this.kv.addScaledVector(d, Math.min(heavy ? v * 1.1 : v * 0.95, heavy ? 8.5 : 6.5) * slideK);
      if (this.state === 'air') this.kv.addScaledVector(d, v * 0.3);
      this.ev(heavy ? 'heavy' : 'light', { v, dir: d.clone(), tier });
    } else if (tier === 3) {
      // strong standing push: slides back several metres, leans hard, stays on its feet
      this.stats.knockdowns++; this.tier = 3; const dur = clamp(imp.staggerDuration * 2.1, 0.3, 1.2);
      if (this.state === 'air') this.kv.addScaledVector(d, v * 0.5);
      else {
        this.state = 'stagger'; this.staggerMax = Math.max(this.staggerT, dur); this.staggerT = this.staggerMax; this.leanMax = 0.7; this.tier = 3;
        this.kv.addScaledVector(d, Math.min(v * 1.15, 12));
      }
      this.ev('knockdown', { v, dir: d.clone() });
    } else {
      this.stats.launches++; this.tier = 4;
      const vy = clamp(3.6 + up * 0.55 + (v - imp.launchThreshold) * 0.24, 3.6, 11.5);
      this.startAir(d, v, vy);
      this.ev('launch', { v, dir: d.clone(), vy });
    }
    return { tier, v };
  }
  startFall(d, v) {
    this.state = 'fall'; this.fallT = 0; this.fallMax = clamp(0.36 + v * 0.008, 0.36, 0.55); this.fdir.copy(d); this.kv.addScaledVector(d, v * 0.95);
    this.downMax = clamp(0.95 + v * 0.05, 0.95, 2.1); this.staggerT = 0; this.bounce = 0; this.spinV = 0;
  }
  startAir(d, v, vy) {
    this.state = 'air'; this.airT = 0; this.fdir.copy(d); this.kv.addScaledVector(d, v); const m = hFlat(this.kv), cap = this.o.maxV ?? 34; if (m > cap) this.kv.multiplyScalar(cap / m);
    this.staggerT = 0; this.downMax = clamp(1.1 + v * 0.045, 1.1, 2.4); this.spinV = 0;
    if (this.o.ownVertical) { this.vy = Math.max(vy, this.vy * 0.5); if (vy > 0) this.pos.y += 0.05; } else if (vy > 0) { this.o.launchFn(vy); }
    this.vyPrev = vy;
  }
  /** called by hosts that want to drop straight into the knocked-down state (e.g. slammed into a wall) */
  forceDown(d, v = 8) {                                                       // slammed into a wall: a heavy stagger away from it, still standing
    if (this.grace > 0 || this.state === 'air') return;
    this.state = 'stagger'; this.tier = 2; this.staggerMax = this.staggerT = 0.5; this.leanMax = 0.6; this.ldir.copy(d); this.kv.addScaledVector(d, Math.min(v * 0.25, 3));
  }
  land(vy) {
    const p = this.pos, sp = hFlat(this.kv); this.stats.lands++;
    groundFX(this.g, p, clamp(Math.abs(vy) / 12, 0.4, 1.3));
    const dmg = Math.max(0, (Math.abs(vy) - 6) * 1.5 + sp * 0.25); if (dmg > 0.5 && this.o.damageFn) this.o.damageFn(dmg, 'fall');
    this.state = 'stagger'; this.tier = 1; this.staggerMax = this.staggerT = clamp(0.18 + Math.abs(vy) * 0.015, 0.2, 0.4); this.leanMax = 0.35; this.kv.multiplyScalar(0.55); this.grace = 0.6; this.ldir.copy(this.fdir); this.ev('land', { vy, sp });
  }
  wallHit(vn, n, pt) {
    const o = this.o, g = this.g; this.stats.wall++;
    this.kv.addScaledVector(n, vn * 1.2);                                           // stop and rebound a little
    if (vn < 4.5) return;
    const dmg = (vn - 3.5) * o.wallDmg; if (o.damageFn && dmg > 0.6) o.damageFn(dmg, 'wall');
    g.fx.glow.emit({ pos: pt, size: 1.4, life: 0.12, drag: 0, color: [1, 0.95, 0.8], alpha: 0.9 });
    for (let i = 0; i < 8; i++) g.fx.dust.emit({ pos: pt, vel: _a.set(n.x + rand(-0.8, 0.8), rand(0, 1), n.z + rand(-0.8, 0.8)).multiplyScalar(2).clone(), size: 0.8, grow: 1.5, life: 0.6, drag: 2, color: [0.7, 0.68, 0.64], alpha: 0.4 });
    g.sfx.crash(clamp(0.15 + vn * 0.03, 0, 0.7)); const q = g.player.pos, dd = Math.hypot(q.x - pt.x, q.z - pt.z); g.camera.addTrauma((0.08 + vn * 0.012) * clamp(1 - dd / 40, 0.2, 1));
    // destructible walls (the same breakable walls Four Arms / Way Big smash)
    const P = g.props; if (P && vn >= 7) for (const w of P.walls) {
      if (!w.alive) continue; const b = w.entry, dx = clamp(pt.x, b.min.x, b.max.x) - pt.x, dz = clamp(pt.z, b.min.z, b.max.z) - pt.z;
      if (dx * dx + dz * dz < 1.0 && pt.y < b.max.y + 0.5) { const was = w.alive; P.damageWall(w, (vn - 5) * 34 * (clamp(o.mass / REF_MASS, 0.4, 2)), pt.clone(), _b.set(-n.x, 0, -n.z).clone()); if (was && !w.alive) this.stats.wallBreaks++; break; }
    }
    if (vn >= 9 && (this.state === 'ok' || this.state === 'stagger')) this.forceDown(_a.set(-n.x, 0, -n.z).clone(), vn);   // slammed: loses his feet
    this.ev('wall', { vn });
  }
  /** moves the body by kv; wall / prop / car collisions go through World.resolveXZ */
  move(dt) {
    const o = this.o, w = this.g.world, p = this.pos; let sp = hFlat(this.kv); if (sp < 0.03) { this.kv.set(0, 0, 0); return; }
    const n = clamp(Math.ceil(sp * dt / 0.3), 1, 6), h = dt / n;
    for (let i = 0; i < n; i++) {
      const tx = p.x + this.kv.x * h, tz = p.z + this.kv.z * h; p.x = tx; p.z = tz;
      if (o.collide) o.collide(true); w.resolveXZ(p, o.rad, p.y, o.colH, o.step); if (w.lagoon && !o.noLagoon) w.lagoon.keepOut && w.lagoon.keepOut(p, o.rad); if (o.collide) o.collide(false);
      const ex = p.x - tx, ez = p.z - tz, pen = Math.hypot(ex, ez);
      if (pen > 0.002) {
        const nx = ex / pen, nz = ez / pen, vn = -(this.kv.x * nx + this.kv.z * nz);
        if (vn > 1.2) this.wallHit(vn, _b.set(nx, 0, nz).clone(), _a.set(p.x - nx * o.rad, p.y + o.colH * 0.5, p.z - nz * o.rad).clone());
        else { this.kv.x += nx * vn; this.kv.z += nz * vn; }                   // slide along it
      }
    }
  }
  update(dt, wantUp = false) {
    const o = this.o, p = this.pos; this.sinceHit += dt; this.grace = Math.max(0, this.grace - dt); this.armor = Math.max(0, this.armor - dt);
    if (this.poiseMax && this.sinceHit > 1.6) this.poise = Math.min(this.poiseMax, this.poise + 16 * dt);
    this.stateT += dt;
    switch (this.state) {
      case 'stagger': this.staggerT -= dt; if (this.staggerT <= 0) { this.state = 'ok'; this.tier = 0; this.ev('recover', {}); } break;
      case 'air': {
        this.airT += dt;
        if (o.ownVertical) {
          this.vyPrev = this.vy; this.vy -= 26 * dt; p.y += this.vy * dt; const gy = this.groundY();
          if (p.y <= gy) { p.y = gy; if (this.airT > 0.08) { this.land(this.vyPrev); } else { this.state = 'ok'; } this.vy = 0; }
        } else if (this.airT > 0.14 && o.groundedFn()) this.land(this.vyPrev);
        else this.vyPrev = o.vyFn ? o.vyFn() : this.vyPrev;
        break;
      }
    }
    // friction: ground = quick stop, sliding after a hard fall = long, air = almost none
    const k = this.state === 'air' ? 0.28 : this.state === 'stagger' && this.tier >= 2 ? 2.0 : 2.4;
    if (hFlat(this.kv) > 0.03) { this.move(dt); this.kv.multiplyScalar(Math.exp(-k * dt)); }
    // pose numbers
    const lt = this.state === 'stagger' ? this.leanMax * clamp(this.staggerT / this.staggerMax, 0, 1) : 0; this.lean = damp(this.lean, lt, 26, dt);
    let th = 0;
    switch (this.state) {
      case 'air': th = clamp(0.12 + hFlat(this.kv) * 0.012, 0.1, 0.3); break;      // a slight backward lean while flying, never a flip
      default: th = this.lean;
    }
    this.theta = Math.min(damp(this.theta, th, 24, dt), 0.07); this.spin = 0;
    this.lift = Math.sin(Math.min(this.theta, 1.5)) * o.colH * (o.liftK ?? 0.09);
  }
  groundY() { const p = this.pos, o = this.o; return o.floorFn ? o.floorFn() : this.g.world.groundAt(p.x, p.z, p.y + 0.5, o.step + 0.4, o.rad * 0.5); }
  /** quaternion that tips an upright body by theta toward fdir (about its feet) */
  tipQuat(out, scale = 1) {
    const dir = this.state === 'stagger' ? this.ldir : this.fdir, kx = dir.z, kz = -dir.x;          // axis = up x dir
    _k.set(kx, 0, kz); if (_k.lengthSq() < 1e-6) return out.identity(); _k.normalize();
    out.setFromAxisAngle(_k, this.theta * scale); if (this.spin !== 0) { _q.setFromAxisAngle(UP, this.spin); out.premultiply(_q); } return out;
  }
  reset() { this.kv.set(0, 0, 0); this.state = 'ok'; this.tier = 0; this.staggerT = 0; this.theta = 0; this.lean = 0; this.grace = 0; this.armor = 0; this.poise = this.poiseMax; this.vy = 0; this.spin = 0; this.lift = 0; }
}

// ======================================================================================================================================================================
// The player side
// ======================================================================================================================================================================
export const STICKY_T = 3.2;      // seconds the goo holds the player (configurable; repeat hits refresh it)
export class ImpactSystem {
  constructor(game) {
    this.g = game; this.vit = {}; for (const k in PLAYER_HP) this.vit[k] = { hp: PLAYER_HP[k], max: PLAYER_HP[k], t: 0 };
    this.aquaT = 0; this.mod = null; this.pos0 = new THREE.Vector3(); this.gooT = 0; this.gooMul = 1; this.toastT = 0; this.stats = { dodged: 0, hits: 0, blocked: 0 };
    this.body = new ImpactBody(game, {
      getPos: () => this.g.player.pos, rad: 0.5, colH: 2.2, step: 0.45, mass: 100,
      launchFn: (vy) => { const P = this.g.player; P.vel.y = Math.max(P.vel.y, vy); P.grounded = false; P.mode = 'air'; P.pos.y += 0.06; },
      groundedFn: () => !!this.g.player.grounded, vyFn: () => this.g.player.vel.y,
      damageFn: (d) => this.damagePlayer(d, this.g.player.pos.clone().setY(this.g.player.pos.y + 1), UP.clone(), true),
      onEvent: (t, d) => this.onEvent(t, d),
      capTier: () => this.tierCap(),
    });
    this.id = null; this.kevin = null; this.wantUp = false;
    // V6 control lock. ONE state at a time, priority GRABBED > STICKY > none, and exactly one writer of the player's root position per frame (post()).
    //   STICKY : root x/z + yaw are stored at the first hit and re-applied every frame until the timer ends (repeat hits only refresh the timer). No knockback is accepted.
    //   GRABBED: Kevin owns the position (ctrl.hold, written by Kevin each frame); the sticky lock is suspended and cleared on a throw.
    this.ctrl = { mode: 'none', t: 0, pos: new THREE.Vector3(), yaw: 0, by: null, hold: new THREE.Vector3(), holdYaw: 0, lift: 0, ready: false };
  }
  get mode() { return this.ctrl.mode; }
  get stuck() { return this.ctrl.mode === 'sticky'; }
  get grabbed() { return this.ctrl.mode === 'grabbed'; }
  onEvent(t, d) { if (this.cb) this.cb(t, d); }
  get state() { return this.body.state; }
  get down() { return false; }       // V2: nobody lies on the ground
  /** can the player start a normal attack right now? */
  get blocksAttack() { const b = this.body, s = b.state; return this.ctrl.mode === 'grabbed' || s === 'air' || (s === 'stagger' && b.tier >= 2 && b.staggerT > b.staggerMax * 0.45); }
  cls(P = this.g.player) {
    if (this.g.chars.id === 'waybig') return 'giant';
    if (P.ignoreHits && !(P.mode === 'swim' && this.aquaT > 0)) return 'ghost';       // a deep swimmer is out of reach of everything except an aquatic boss (Vilgax sets aquaT)
    if (this.g.chars.id === 'ghostfreak') return 'fly';
    if (P.form === 'ball' || P.flying || P.mode === 'fly' || P.mode === 'takeoff' || P.mode === 'swim' || P.climb) return 'fly';
    return 'ground';
  }
  tierCap() { const c = this.cls(); return c === 'ground' ? 4 : c === 'giant' ? 0 : 2; }
  configure() {
    const id = this.g.chars.id, P = this.g.player; if (id === this.id && this._P === P) return; this.id = id; this._P = P;
    const m = BODY[id] || BODY.dummy; this.body.setMass({ mass: m.mass, resist: m.resist, launch: m.launch, maxV: m.maxV, poise: 0 });
    this.body.o.rad = P.rad ?? 0.5; this.body.o.colH = P.colH ?? 2.2; this.body.o.step = id === 'greymatter' ? 0.03 : 0.45;
    this.body.o.wallDmg = id === 'waybig' ? 0 : 1.4; this.body.o.noLagoon = id === 'ripjaws';
  }
  hp() { const P = this.g.player, id = this.g.chars.id; if (typeof P.hp === 'number') return { hp: P.hp, max: P.cfg?.hp ?? PLAYER_HP[id] ?? 300 }; const v = this.vit[id]; return v ? { hp: v.hp, max: v.max } : { hp: 1, max: 1 }; }
  /** restore the root pose the controller owns before anything else reads / copies it (switching, controllers) */
  pre() { const m = this.mod; if (m) { m.root.rotation.x = m.ex; m.root.rotation.z = m.ez; this.mod = null; } }
  begin(inp) {
    this.configure(); const P = this.g.player, b = this.body; this.pos0.copy(P.pos);
    this.toastT = Math.max(0, this.toastT - 0.016);
    if (b.moveScale < 0.5) { inp.jump = false; inp.dash = false; }
    this.wantUp = !!(inp.moveX || inp.moveY || inp.jump);
    if (this.ctrl.mode !== 'none') { inp.moveX = 0; inp.moveY = 0; inp.jump = false; inp.jumpHeld = false; inp.dash = false; inp.run = false; this.wantUp = false; }      // no locomotion input while stuck / held (aim, attacks and the camera are untouched)
    if (this.gooT > 0.01 && this.gooMul < 0.4) inp.jump = false;
  }
  /** after the controller moved and animated: apply knockback motion, stagger / fall pose, goo slow */
  post(dt) {
    const g = this.g, P = g.player, b = this.body, cls = this.cls(P);
    this.gooT = Math.max(0, this.gooT - dt); this.aquaT = Math.max(0, this.aquaT - dt);
    // vitals regen for the two aliens that have no hp of their own
    const v = this.vit[g.chars.id]; if (v && typeof P.hp !== 'number') { v.t = Math.max(0, v.t - dt); if (v.t <= 0 && v.hp < v.max) v.hp = Math.min(v.max, v.hp + 14 * dt); }
    // motion scale (stagger / goo / air control): scale what the controller moved this frame
    let ms = cls === 'ground' ? b.moveScale : (cls === 'fly' ? (b.state === 'stagger' ? 0.35 : 1) : 1);
    if (this.gooT > 0) ms *= this.gooMul;
    if (ms < 0.999 && cls !== 'giant' && P.form !== 'ball') { const dx = P.pos.x - this.pos0.x, dz = P.pos.z - this.pos0.z; P.pos.x = this.pos0.x + dx * ms; P.pos.z = this.pos0.z + dz * ms; if (ms < 0.05) { P.vel.x *= 0.5; P.vel.z *= 0.5; } }
    if (cls !== 'ground') {                            // non-ground bodies: the push was applied to their own velocity; just run the timers
      if (b.state === 'stagger') { b.staggerT -= dt; if (b.staggerT <= 0) { b.state = 'ok'; b.tier = 0; } }
      else if (b.state !== 'ok') { b.state = 'ok'; b.tier = 0; b.kv.set(0, 0, 0); b.theta = 0; }
      b.lean = damp(b.lean, b.state === 'stagger' ? b.leanMax * clamp(b.staggerT / b.staggerMax, 0, 1) : 0, 20, dt); b.theta = b.lean; b.sinceHit += dt; b.grace = Math.max(0, b.grace - dt);
    } else if (this.ctrl.mode === 'none') b.update(dt, this.wantUp);
    else { b.kv.set(0, 0, 0); b.state = 'ok'; b.tier = 0; b.theta = 0; b.lean = 0; b.staggerT = 0; }
    this.applyLock(dt, P, cls);
    // pose on the root (restored again in pre())
    const root = P.root; this.mod = null;
    // V3: a hit never tips the body. Only a barely-visible (<=4 deg) settle on grounded characters; flying / rolling / swimming bodies keep their own orientation.
    if (cls !== 'ground') { b.theta = 0; b.spin = 0; b.lift = 0; } else { b.theta = Math.min(b.theta, 0.07); b.spin = 0; b.lift = 0; }
    if ((b.theta > 0.01) && cls === 'ground') {
      // The settle is written straight into the root's Euler X/Z (small angles, world axes) - never through the quaternion. Controllers only ever write rotation.y, so this can neither
      // flip the yaw nor leave a re-derived Euler behind (the old bug: (0,pi,0) became (pi,0,pi) and the next `rotation.y = yaw` turned the model around).
      const d = b.ldir, ex = root.rotation.x, ez = root.rotation.z; root.rotation.x = ex + d.z * b.theta; root.rotation.z = ez - d.x * b.theta; this.mod = { root, ex, ez };
    }
  }
  /** the single writer of the root while STICKY / GRABBED (runs after the controller + animation of this frame) */
  applyLock(dt, P, cls) {
    const c = this.ctrl; if (c.mode === 'none') return;
    if (c.mode === 'sticky') {
      c.t -= dt; if (c.t <= 0) { this.unlock(); return; }
      P.pos.x = c.pos.x; P.pos.z = c.pos.z; P.vel.x = 0; P.vel.z = 0; if (P.v && P.form === 'ball') { P.v.x = 0; P.v.z = 0; }
      this.holdYaw(P, c.yaw);
    } else if (c.mode === 'grabbed') {
      if (!c.by || c.by.dead || !c.by.grabLive) { this.release(null, 0, 0); return; }
      P.pos.copy(c.hold); P.vel.set(0, 0, 0); P.grounded = false; if (P.mode !== 'swim') P.mode = 'air'; if (P.v && P.form === 'ball') P.v.set(0, 0, 0);
      this.holdYaw(P, c.holdYaw);
    }
    if (P.root) P.root.updateMatrixWorld(true);
  }
  holdYaw(P, yaw) { P.yaw = yaw; if (P.turnRate !== undefined) P.turnRate = 0; if (P.root) P.root.rotation.y = yaw; }
  /** Kevin's goo landed: freeze the root where it is (first hit stores the pose; later hits only refresh the timer) */
  stick(dur = STICKY_T) {
    const c = this.ctrl, P = this.g.player; if (c.mode === 'grabbed') return false; if (this.cls(P) === 'giant' || P.ignoreHits) return false;
    if (c.mode === 'sticky') { c.t = Math.max(c.t, dur); return true; }
    c.mode = 'sticky'; c.t = dur; c.pos.copy(P.pos); c.yaw = P.yaw ?? (P.root ? P.root.rotation.y : 0);
    const b = this.body; b.kv.set(0, 0, 0); b.state = 'ok'; b.tier = 0; b.staggerT = 0; b.theta = 0; P.vel.x = 0; P.vel.z = 0; this.gooT = 0;
    this.g.hud.toast('STUCK'); return true;
  }
  unlock() { const c = this.ctrl; c.mode = 'none'; c.t = 0; c.by = null; c.ready = false; if (this.g.gooProxy) this.g.slime.clear(this.g.gooProxy); }
  /** Kevin's hand has the player. Overrides (and suspends) STICKY; the player keeps no velocity of his own. */
  grab(by, pos, yaw) {
    const c = this.ctrl, P = this.g.player; if (c.mode === 'grabbed') return false;
    c.mode = 'grabbed'; c.by = by; c.t = 0; c.hold.copy(pos); c.holdYaw = yaw; const b = this.body; b.kv.set(0, 0, 0); b.state = 'ok'; b.tier = 0; b.staggerT = 0; P.vel.set(0, 0, 0);
    if (this.interrupt) { try { this.interrupt(P, this.g.chars.id); } catch (e) { console.warn('interrupt', e); } }
    return true;
  }
  /** let go: clears goo (consistent rule), then a controlled throw (horizontal v along dir, vy) or a simple drop */
  release(dir, v, vy) {
    const c = this.ctrl, P = this.g.player; if (c.mode !== 'grabbed') return; this.unlock();
    this.body.reset(); this.gooT = 0; P.vel.set(0, 0, 0);
    if (P.mode === 'swim') { if (dir && v > 0) P.vel.set(dir.x * v, vy, dir.z * v); return; }       // underwater: pushed through the water (the swimmer's own drag stops him), no air trajectory
    if (dir && v > 0) { this.body.startAir(dir, v, vy); } else { P.grounded = false; P.mode = 'air'; }
  }
  /** an enemy hit the player: damage + physical reaction. imp = attackImpact() + { dir, point, src } */
  hitPlayer(imp) {
    const g = this.g, P = g.player, id = g.chars.id, cls = this.cls(P); this.configure(); this.stats.hits++;
    const pt = imp.point ? imp.point.clone() : P.pos.clone().setY(P.pos.y + 1.1), dir = imp.dir ? imp.dir.clone().setY(0) : new THREE.Vector3(0, 0, 1); if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1); dir.normalize();
    if (cls === 'giant') { if (P.takeHit) P.takeHit(imp.damage * 0.6, pt, dir, imp.knockbackForce * 1.2e5, 'kevin'); return { tier: 0, v: 0 }; }
    if (cls === 'ghost') return { tier: 0, v: 0, passed: true };
    if (this.ctrl.mode !== 'none' && !imp.force) {            // STICKY / GRABBED: damage and flash only - no knockback, no stagger, no tilt, no velocity (cancels + blocks horizontal knockback)
      this.damagePlayer(imp.damage, pt, dir, false); this.hitFXAt(pt, dir, imp, { tier: 0, v: 0 }); return { tier: 0, v: 0, locked: true };
    }
    // XLR8: fast enough to slip many hits
    const bm = BODY[id]; if (bm && bm.dodge && (P.speed || 0) > 7 && !imp.unavoidable && Math.random() < bm.dodge) { this.stats.dodged++; g.hud.toast('DODGED'); return { tier: 0, v: 0, dodged: true }; }
    let k = 1; if (id === 'fourarms' && P.blocking && !P.act) { k = 0.35; this.stats.blocked++; }
    const imp2 = Object.assign({}, imp, { knockbackForce: imp.knockbackForce * k, damage: imp.damage });
    this.damagePlayer(imp.damage, pt, dir, false);
    const b = this.body; let r;
    if (cls === 'ground') {
      r = b.hit(Object.assign({}, imp2, { dir }));
      if (r.tier >= 1) { P.vel.x *= 0.35; P.vel.z *= 0.35; }
      if (r.tier >= 2 && this.interrupt) { try { this.interrupt(P, id); } catch (e) { console.warn('interrupt', e); } }
    } else {                                           // flying / ball / swimming: pushed off his line, brief loss of control
      const v = b.effective(imp2), ball = P.form === 'ball'; r = { tier: v >= 4 ? 2 : v >= 1 ? 1 : 0, v };
      const T = ball ? P.v : P.vel; const vv = Math.min(v, 9) * 0.55; T.x += dir.x * vv; T.z += dir.z * vv; if (!ball) T.y += (imp.upwardForce || 0) * 0.35 + (v >= imp.knockdownThreshold ? 3 : 0);
      if (r.tier >= 1 && !ball) { b.state = 'stagger'; b.tier = r.tier; b.staggerMax = b.staggerT = clamp(imp.staggerDuration * (r.tier === 2 ? 1.8 : 1), 0.15, 1.2); b.leanMax = 0.4; b.ldir.copy(dir); }
    }
    this.hitFXAt(pt, dir, imp, r);
    return r;
  }
  hitFXAt(pt, dir, imp, r) { if (imp.fx === false) return; hitFX(this.g, pt, dir, clamp(0.5 + (r.v || 0) / 14, 0.5, 1.6), { color: imp.color, quiet: imp.quiet }); }
  damagePlayer(dmg, pt, dir, silent = false) {
    const g = this.g, P = g.player, id = g.chars.id; if (P.ignoreHits && !(P.mode === 'swim' && this.aquaT > 0)) return false;
    if (P.onHit) { P.onHit(dmg, pt, dir); return true; }
    const v = this.vit[id]; if (!v) return false;
    if (!silent) { g.hud.hurt(); g.camera.addTrauma(0.25); }
    v.hp = Math.max(0, v.hp - dmg); v.t = 4; if (v.hp <= 0) { v.hp = v.max * 0.6; g.hud.toast('SECOND WIND'); } return true;
  }
  /** goo / slow zones */
  slow(mul, dur) { this.gooMul = Math.min(this.gooT > 0 ? this.gooMul : 1, mul); this.gooT = Math.max(this.gooT, dur); }
  /** alien switch: restore the old root's tilt, clear the body, goo and any control lock - HP is kept */
  onSwitch() { this.pre(); this.body.reset(); this.gooT = 0; if (this.ctrl.mode === 'grabbed' && this.ctrl.by && this.ctrl.by.dropHeld) this.ctrl.by.dropHeld(); this.unlock(); if (this.g.gooProxy) this.g.slime.clear(this.g.gooProxy); }
  reset() { this.pre(); this.body.reset(); this.gooT = 0; this.unlock(); if (this.g.gooProxy) this.g.slime.clear(this.g.gooProxy); for (const k in this.vit) this.vit[k].hp = this.vit[k].max; }
}
