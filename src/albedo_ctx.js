// ALBEDO - puppet context.
// Albedo's alien forms are SECOND INSTANCES of the real alien controllers (same classes, same GLBs / rigs, same powers). Each one is built against a "puppet game": an Object.create(game) that
// shares the world, props, effects and audio, but has its OWN camera (aim only), HUD (silent), hit-target list (the real player and nothing else), impact system (Albedo's body) and fire / slime
// systems. DOM overlays that the controllers write to (rage vignette, speed lines, ...) are redirected to a detached sink so they can never touch the real player's screen.
import * as THREE from 'three';
import { Hittable } from './dummies.js';
import { ImpactSystem, attackImpact, BODY } from './impact.js';
import { clamp } from './util.js';

const _v = new THREE.Vector3();

// ------------------------------------------------------------------------------------------------------------------------------ DOM sink
const realGet = document.getElementById.bind(document);
const sinkCache = new Map();
const sinkEl = (id) => { let e = sinkCache.get(id); if (!e) { e = document.createElement('div'); e.dataset.sink = id; sinkCache.set(id, e); } return e; };
let sinkDepth = 0;
/** run fn with document.getElementById redirected to detached elements (puppet controllers never draw on the real HUD) */
export function inSink(fn) {
  if (sinkDepth++ === 0) document.getElementById = sinkEl;
  try { return fn(); } finally { if (--sinkDepth === 0) document.getElementById = realGet; }
}

// ------------------------------------------------------------------------------------------------------------------------------ camera stand-in
/** the controllers only read yaw / aimDir / aimOrigin and push shake + fov kicks; here the aim is set by Albedo's AI and shake is forwarded (attenuated by distance) to the real camera */
export class PuppetCam {
  constructor(game, owner) {
    this.g = game; this.owner = owner; this.yaw = 0; this.pitch = 0; this.aimDir = new THREE.Vector3(0, 0, -1); this.aimOrigin = new THREE.Vector3(); this.shakeLevel = 2;
    this.noClip = false; this.pitchMin = -0.28; this.pitchMax = 1.25; this.trauma = 0; this.fovKick = 0; this.cam = game.cam3;
  }
  addTrauma(a) { const rc = this.g.camera, P = this.g.player, o = this.owner.pos; if (!o || !P) return; const d = Math.hypot(P.pos.x - o.x, P.pos.z - o.z); rc.addTrauma(a * clamp(1 - d / 45, 0, 1) * 0.8); }
  kick() {}
  addLook() {} zoom() {} update() {}
  forward(out = new THREE.Vector3()) { return out.copy(this.aimDir); }
  /** point the aim at a world position */
  aimAt(from, to) { this.aimOrigin.copy(from); this.aimDir.subVectors(to, from); const l = this.aimDir.length() || 1; this.aimDir.divideScalar(l); this.yaw = Math.atan2(-this.aimDir.x, -this.aimDir.z); this.pitch = Math.asin(clamp(this.aimDir.y, -1, 1)); }
}

/** silent HUD (the real one belongs to the player) */
export const puppetHud = (game) => ({ crosshair: null, hitmark: null, floats: [], toast() {}, hit() {}, tag() {}, hurt() {}, update() {} });

// ------------------------------------------------------------------------------------------------------------------------------ the player as a hit target
/** What the alien controllers (Albedo's puppets) hit when they "hit a dummy": the REAL player. Hits are buffered during the puppet's update and resolved once per frame through the real
 *  ImpactSystem (so blocking, XLR8 dodging, knockback, stagger, ghost / swim immunity and the giant class all apply exactly as for Kevin's attacks). */
export class PlayerTarget extends Hittable {
  constructor(game, owner) {
    super(game.world); this.rg = game; this.owner = owner; this.kind = 'dummy'; this.isBoss = true; this.isPlayerTarget = true; this.name = 'player'; this.label = 'player'; this.held = false; this.possessed = false;
    this.root = new THREE.Object3D(); this.pend = this.fresh(); this.dot = 0; this.dotT = 0; this.mass = 100; this.spheres = [{ local: new THREE.Vector3(), r: 0.5 }, { local: new THREE.Vector3(), r: 0.5 }, { local: new THREE.Vector3(), r: 0.5 }];
    this.kv = new THREE.Vector3(); this.home = this.root.position; this.collider = { pos: this.root.position, r: 0.5, h: 1.8, dead: false }; this.meleeRadius = 0.8; this.stats = { hits: 0, dmg: 0 };
  }
  // `dead` is a read-only view: an untouchable player (deep swimmer / phasing ghost) is simply not a target
  get dead() { const P = this.rg.player; return !!(P && P.ignoreHits && !(P.mode === 'swim' && this.rg.impact.aquaT > 0)); }
  set dead(v) {}
  get hp() { return this.rg.impact.hp().hp; } set hp(v) {}
  get maxHp() { return this.rg.impact.hp().max; } set maxHp(v) {}
  fresh() { return { n: 0, dmg: 0, kx: 0, kz: 0, dx: 0, dz: 0, up: 0, pt: null }; }
  /** follow the real player (position, height, radius) */
  sync() {
    const P = this.rg.player, r = this.root; r.position.copy(P.pos); r.rotation.y = P.yaw || 0; r.updateMatrixWorld(true);
    const h = Math.max(P.colH ?? 1.8, 0.2), rad = Math.max(P.rad ?? 0.4, 0.1), s = this.spheres, hs = P.hitSphere; this.collider.r = rad; this.collider.h = h; this.meleeRadius = Math.max(0.8, rad * 1.1);
    if (hs && h < 1.2) { s[0].local.set(0, hs.y, 0); s[0].r = hs.r; s[1].local.set(0, hs.y, 0); s[1].r = hs.r * 0.8; s[2].local.set(0, hs.y, 0); s[2].r = hs.r * 0.7; return; }
    const R = Math.max(rad, h * 0.2);
    s[0].local.set(0, h * 0.22, 0); s[0].r = R; s[1].local.set(0, h * 0.5, 0); s[1].r = R; s[2].local.set(0, h * 0.8, 0); s[2].r = R * 0.8;
  }
  intersect(o, d, maxT) { if (this.dead) return null; return super.intersect(o, d, maxT); }
  applyHit(point, dir, dmg) {
    if (this.dead || this.owner.hitsOff) return; const p = this.pend; p.n++; p.dmg += dmg; const w = Math.max(dmg, 1); p.dx += dir.x * w; p.dz += dir.z * w; if (point) p.pt = point.clone();
  }
  shove(dir, speed) { if (this.dead || this.owner.hitsOff) return; const p = this.pend; p.n++; p.kx += dir.x * speed; p.kz += dir.z * speed; }
  launch(vy) { if (this.dead || this.owner.hitsOff) return; const p = this.pend; p.n++; p.up = Math.max(p.up, vy); }
  knock(dir, force) { this.shove(dir, force * 0.9); }
  stagger() {} burn() {} freeze() {} stun() {} confuse() {} wobble() {} release() {}
  update() {}
  /** end of the puppet's update: turn the buffered hits into one real hit on the player */
  resolve(dt) {
    const p = this.pend, o = this.owner, g = this.rg; this.dotT = Math.max(0, this.dotT - dt);
    if (!p.n) { if (this.dot > 0 && this.dotT <= 0) this.flushDot(); return; }
    this.pend = this.fresh(); const P = g.player;
    let sh = Math.hypot(p.kx, p.kz), mag = Math.hypot(p.dx, p.dz), dx, dz;
    if (sh > 0.05) { dx = p.kx / sh; dz = p.kz / sh; } else if (mag > 1e-4) { dx = p.dx / mag; dz = p.dz / mag; } else { dx = P.pos.x - o.pos.x; dz = P.pos.z - o.pos.z; const m = Math.hypot(dx, dz) || 1; dx /= m; dz /= m; }
    let dmg = p.dmg * o.dmgScale; sh = sh * o.kbScale; const up = p.up * o.kbScale;
    // continuous effects (fire, acid, damage-over-time ticks) are summed and applied a few times a second instead of re-staggering the player every frame
    if (p.dmg > 0 && p.dmg < 2.2 && sh < 0.5 && up < 0.5) { this.dot += dmg; if (this.dotT <= 0) this.flushDot(dx, dz, p.pt); return; }
    if (sh < 0.05) sh = clamp(dmg * 0.11, 0, 4.5);
    this.stats.hits++; this.stats.dmg += dmg;
    const imp = attackImpact({ damage: dmg, knockbackForce: sh, upwardForce: up * 0.8, staggerDuration: 0.24 + dmg * 0.004, knockdownThreshold: 10.5, launchThreshold: 21, ordinary: sh < 7, point: p.pt || P.pos.clone().setY(P.pos.y + 1.1), dir: _v.set(dx, 0, dz).clone(), name: o.formId, src: o });
    const r = g.impact.hitPlayer(imp); if (o.onPlayerHit) o.onPlayerHit(r, imp);
  }
  flushDot(dx = 0, dz = 1, pt = null) {
    const d = this.dot; this.dot = 0; this.dotT = 0.3; if (d <= 0.05) return; const g = this.rg, P = g.player;
    g.impact.hitPlayer(attackImpact({ damage: d, knockbackForce: 0.3, upwardForce: 0, staggerDuration: 0.1, point: pt || P.pos.clone().setY(P.pos.y + 1), dir: _v.set(dx, 0, dz).clone(), name: 'dot', src: this.owner, fx: false }));
  }
}

// ------------------------------------------------------------------------------------------------------------------------------ Albedo's body (ImpactSystem on the puppet game)
/** Same physics as the player's body (stagger / knockback / launch, XLR8-style dodge, blocking, goo) - but the "player" is Albedo's active controller and damage goes to Albedo's ONE shared HP pool */
export class AlbedoImpact extends ImpactSystem {
  constructor(game, owner) {
    super(game); this.owner = owner;
    this.body.o.damageFn = (d, kind) => this.owner.takeDamage(d * (kind === 'wall' ? 0.7 : 0.55), kind);
  }
  damagePlayer(dmg, pt, dir, silent = false) {
    const o = this.owner; if (o.invuln || o.dead) return false;
    o.takeDamage(dmg * o.takenMul, 'hit'); o.hitFlash = 0.14; return true;
  }
}

// ------------------------------------------------------------------------------------------------------------------------------ the puppet game
/** Object.create(game): everything not overridden (scene, fx, sfx, props, effects, audio, world queries) is the real, shared one */
export function makeCtx(game, owner) {
  const ctx = Object.create(game);
  ctx.puppet = true; ctx.owner = owner; ctx.realFire = game.fire; ctx.realGame = game;
  ctx.camera = new PuppetCam(game, owner); ctx.hud = puppetHud(game);
  ctx.target = new PlayerTarget(game, owner);
  ctx.world = Object.create(game.world, { hittables: { value: [ctx.target], writable: true } });
  ctx.chars = { id: 'ben', def: { name: 'ALBEDO' }, pending: null, switchTo() {}, cycle() {} };
  ctx.player = null; ctx.fire = null; ctx.slime = null; ctx.gooProxy = null;
  ctx.impact = new AlbedoImpact(ctx, owner);
  return ctx;
}
