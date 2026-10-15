// BOSSES IN THE OPEN WORLD.
//  - random VALID spawn point per Boss Manager spawn (layout.BOSS_SPAWNS + jitter, checked: dry land, gentle ground, no buildings / props / trees in the footprint, not on the player)
//  - while the player is not engaged, a boss roams its neighbourhood and CAUSES CHAOS: walks to a car / bin / light / bench / crate, hits it with its own attack
//    animation (Kevin + Vilgax: their real melee acts; Albedo: whatever alien he is, driven by his pilot toward the object), wrecks / knocks it away; civilians flee from it
//  - as soon as the player comes into view the normal combat AI takes over (Kevin / Vilgax sight checks; Albedo engages inside 110 m)
import * as THREE from 'three';
import { BOSS_SPAWNS } from './layout.js';
import { Kevin } from '../kevin.js';
import { Albedo } from '../albedo.js';
import { Pilot } from '../albedo_ai.js';

const rand = (a, b) => a + Math.random() * (b - a);
const LIKE = { car: 3, truck: 2, dumpster: 2, light: 1.5, bench: 1.2, trash: 1, barrel: 1.4, crate: 1.2, fence: 1, container: 0.8, forklift: 1.5 };
const _v = new THREE.Vector3();

export function pickBossSpawn(game, boss) {
  const w = game.world, T = w.terrain, P = game.player, rad = (boss.cfg && boss.cfg.rad) || 1.2, list = BOSS_SPAWNS.slice().sort(() => Math.random() - 0.5);
  const ok = (x, z) => {
    if (T.dl(x, z) < 10) return false; if (Math.hypot(x - P.pos.x, z - P.pos.z) < 40) return false;
    for (const o of game.bossList || []) if (o !== boss && o.present) { const q = o.home || o.pos; if (Math.hypot(q.x - x, q.z - z) < 90) return false; }
    const y0 = T.height(x, z); for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2, r = rad * 2 + 3; if (Math.abs(T.height(x + Math.cos(a) * r, z + Math.sin(a) * r) - y0) > 1.2) return false; }
    const m = rad + 2.5; if (w.staticsIn(x - m, z - m, x + m, z + m).some(b => b.max.y > y0 + 0.6)) return false;
    for (const p of game.props.props) if (!p.dead && Math.abs(p.pos.x - x) < m + 2 && Math.abs(p.pos.z - z) < m + 2) return false;
    for (const b of w.boxes) if (!b.isl && b.max.x > x - m && b.min.x < x + m && b.max.z > z - m && b.min.z < z + m) return false;
    return true;
  };
  for (const s of list) for (let k = 0; k < 6; k++) { const x = s.x + (k ? rand(-14, 14) : 0), z = s.z + (k ? rand(-14, 14) : 0); if (ok(x, z)) return { x, y: T.height(x, z), z, region: s.region }; }
  const s = list[0]; return { x: s.x, y: T.height(s.x, s.z), z: s.z, region: s.region };
}

function chooseProp(game, x, z, R = 42) {
  let best = null, bs = -1;
  for (const p of game.props.props) { if (p.dead || p.held || p.driven || p.dormant || p.temp && p.kind === 'chunk') continue; const L = LIKE[p.kind]; if (!L) continue; const d = Math.hypot(p.pos.x - x, p.pos.z - z); if (d > R || d < 2) continue; const s = L * (1.2 - d / R) * (0.6 + Math.random() * 0.8); if (s > bs) { bs = s; best = p; } }
  return best;
}
/** a boss's blow lands on a prop: damage + knock it away + effects + panic */
export function smashProp(game, src, p, power = 1) {
  const P = game.props; if (!p || p.dead) return; const dx = p.pos.x - src.x, dz = p.pos.z - src.z, L = Math.hypot(dx, dz) || 1, dir = _v.set(dx / L, 0, dz / L);
  const c = p.center; P.impactFX(c, 1.2 * power, p.debris, true); game.world.danger(c.x, c.z, 40, 2);
  P.hurt(p, (110 + Math.random() * 120) * power, dir.clone()); if (p.dead) return;
  if (!p.planted) { P.removeBox(p); p.state = 'fly'; const k = 14 * power / Math.sqrt(p.mass / 400 + 1); p.vel.x += dir.x * k; p.vel.z += dir.z * k; p.vel.y = Math.max(p.vel.y, 3 + 4 * power / Math.sqrt(p.mass / 400 + 1)); p.spin.set(rand(-2, 2), rand(-1, 1), rand(-2, 2)); p.hit.clear(); }
  else if (p.hp < p.hpMax * 0.5) P.hurt(p, p.hp + 1, dir.clone());
}

export function installChaos(game) {
  if (game._chaos) return; game._chaos = true;
  // ---------------------------------------------------------------- Kevin / Vilgax (shared class)
  const KP = Kevin.prototype, oPatrol = KP.patrol, oPickWp = KP.pickWp;
  KP.pickWp = function () {
    if (!this.g.world.island) return oPickWp.call(this);
    const w = this.g.world, T = w.terrain, h = this.spawn;
    for (let i = 0; i < 14; i++) { const x = h.x + rand(-45, 45), z = h.z + rand(-45, 45); if (T.dl(x, z) < 6 || T.slope(x, z) > 0.4) continue; const p = new THREE.Vector3(x, 0, z); w.resolveXZ(p, this.cfg.rad + 0.25, T.height(x, z), this.cfg.h, 0.45); if (Math.hypot(p.x - x, p.z - z) < 0.05) return { x, z }; }
    return { x: h.x, z: h.z };
  };
  KP.patrol = function (dt, c) {
    if (!this.g.world.island) return oPatrol.call(this, dt, c);
    const ch = this.chaos || (this.chaos = { p: null, t: rand(2, 4), swings: 0, walk: 0 }); ch.t -= dt; this.chaosT = Math.max(0, (this.chaosT || 0) - dt);
    const h = this.home;
    if (this.act) {                                                                                  // swinging at the object
      const p = ch.p, cc = p ? Object.assign({}, c, { dx: p.pos.x - h.x, dz: p.pos.z - h.z, dc: Math.hypot(p.pos.x - h.x, p.pos.z - h.z), tx: p.pos.x, tz: p.pos.z }) : c;
      if (this.ib.canAct) this.stepAct(dt, cc); else this.cancelAct();
      if (p && this.act && this.act.phase === 'strike' && !ch.hit) { ch.hit = true; if (Math.hypot(p.pos.x - h.x, p.pos.z - h.z) < (this.cfg.rad || 1) + Math.max(p.half.x, p.half.z) + 3.2 * (this.ks || 1)) smashProp(this.g, h, p, this.isKevin ? 1.0 : 1.4); }
      return;
    }
    if (!ch.p && ch.t <= 0) { ch.p = chooseProp(this.g, h.x, h.z); ch.t = rand(5, 10); ch.swings = 0; ch.walk = 0; }
    const p = ch.p;
    if (p) {
      if (p.dead || p.held || p.dormant || ch.swings > 3 || ch.walk > 14) { ch.p = null; ch.t = rand(3, 7); return oPatrol.call(this, dt, c); }
      this.chaosT = 2;
      const d = Math.hypot(p.pos.x - h.x, p.pos.z - h.z), reach = (this.cfg.rad || 1) + Math.max(p.half.x, p.half.z) + 1.4 * (this.ks || 1);
      if (d > reach) { ch.walk += dt; this.drive(dt, p.pos.x, p.pos.z, this.cfg.walk * 1.25, false); this.turn(dt, 4); return; }
      this.wantSpd = 0; this.yawT = Math.atan2(p.pos.x - h.x, p.pos.z - h.z); this.turn(dt, 6);
      if (Math.abs(Math.atan2(Math.sin(this.yawT - this.yaw), Math.cos(this.yawT - this.yaw))) < 0.35) {
        const names = ['heavy', 'punch', 'backhand', 'smash', 'crystalPunch', 'firePunch'].filter(n => this.ATK[n] && !this.ATK[n].custom && !this.ATK[n].rush && !this.ATK[n].ranged && !((this.cd[n] || 0) > 0));
        if (names.length) { this.startAct(names[Math.floor(Math.random() * names.length)]); ch.hit = false; ch.swings++; }
      }
      return;
    }
    oPatrol.call(this, dt, c);
  };
  const oReset = KP.reset0; KP.reset0 = function () { this.chaos = null; this.chaosT = 0; return oReset.call(this); };
  // ---------------------------------------------------------------- Albedo: his pilot steers toward the object instead of the player while he has not engaged
  const AP = Albedo.prototype, oStep = AP.step;
  AP.step = function (dt) {
    if (this.g.world.island && !this.dead) {
      const P = this.g.player, me = this.pos, dP = Math.hypot(P.pos.x - me.x, P.pos.z - me.z), ch = this.chaos || (this.chaos = { p: null, t: rand(1, 3), hitT: 0, swings: 0, walk: 0 });
      if (dP < 110 || this.engaged) { this.engaged = this.engaged || dP < 90; this.chaosTarget = null; ch.p = null; }
      else {
        ch.t -= dt; ch.hitT -= dt; this.chaosT = 2;
        if (!ch.p && ch.t <= 0) { ch.p = chooseProp(this.g, me.x, me.z, 50); ch.t = rand(4, 8); ch.swings = 0; ch.walk = 0; }
        const p = ch.p;
        if (p && (p.dead || p.held || p.dormant || ch.swings > 4 || ch.walk > 16)) { ch.p = null; }
        if (ch.p) {
          const c = p.center, d = Math.hypot(c.x - me.x, c.z - me.z); this.chaosTarget = this.chaosTarget || { pos: new THREE.Vector3(), vel: new THREE.Vector3(), rad: 1, colH: 1.5, mode: 'ground' };
          this.chaosTarget.pos.set(c.x, p.pos.y, c.z); this.chaosTarget.rad = Math.max(p.half.x, p.half.z); this.chaosTarget.colH = p.size.h;
          if (d > 6) ch.walk += dt; const reach = (this.cur && this.cur.rad || 0.6) + this.chaosTarget.rad + 2.2;
          if (d < reach && ch.hitT <= 0 && this.state !== 'transforming' && this.pilot.last !== 'none') { ch.hitT = 1.2; ch.swings++; smashProp(this.g, me, p, this.curId === 'fourarms' || this.curId === 'ultimatewildmutt' || this.curId === 'waybig' ? 1.6 : 1.0); }
        } else this.chaosTarget = null;
      }
    }
    return oStep.call(this, dt);
  };
  const oDesp = AP.bossDespawn; AP.bossDespawn = function () { this.chaos = null; this.chaosTarget = null; this.engaged = false; return oDesp.call(this); };
  const oResp = AP.respawn; AP.respawn = function () { this.chaos = null; this.chaosTarget = null; this.engaged = false; return oResp.apply(this, arguments); };
  // the pilot reads its target through this hook
  const oThink = Pilot.prototype.think;
  Pilot.prototype.think = function (dt, locked) { const a = this.a; if (a.chaosTarget) { const g = a.g, real = g.player; try { a.g = Object.create(g, { player: { value: a.chaosTarget } }); return oThink.call(this, dt, locked); } finally { a.g = g; } } return oThink.call(this, dt, locked); };
  // ---------------------------------------------------------------- random spawn points from the Boss Manager
  const M = game.bosses, oSpawn = M.spawn.bind(M);
  M.spawn = function (id) {
    const e = this.byId[id]; if (e && !e.boss.present && game.world.island) { const s = pickBossSpawn(game, e.boss); e.boss.spawn.set(s.x, s.y, s.z); e.boss.lastSpawnRegion = s.region; }
    return oSpawn(id);
  };
  const oRespawn = M.respawn.bind(M);
  M.respawn = function (id) {           // a respawn also rolls a new valid location
    const e = this.byId[id]; if (e && e.boss.present && game.world.island) { const s = pickBossSpawn(game, e.boss); e.boss.spawn.set(s.x, s.y, s.z); e.boss.lastSpawnRegion = s.region; }
    return oRespawn(id);
  };
}
