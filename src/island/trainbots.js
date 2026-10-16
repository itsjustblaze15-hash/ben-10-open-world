// V30 HOSTILE TRAINING ROBOTS for the open world. The sentry robots of the test facility (the same body / baton as the Guards: src/guards.js) now patrol training grounds around the island.
//   patrol -> walks between waypoints round its post    chase -> spotted the player (sight ~26 m, line of sight, a tiny / invisible player is harder to see): runs him down
//   attack -> baton combo up close (visible wind-up)    block -> raises both arms for ~0.8 s when you swing at it (takes 25 % damage, no flinch; a very heavy blow breaks the guard)
//   counter -> a blocked hit is answered with a fast baton swing       knockback -> they are ordinary Dummy bodies: every alien can punch, shove, launch, grab and throw them
//   defeat -> falls over, sparks and smoke, vanishes; the post respawns it after TB.respawnMin..respawnMax seconds (2-4 min) and never right next to the player
// A pool of TB.maxActive bodies is shared by ~20 validated training posts (dry flat ground, nothing built there, away from roads' centre); posts only wake up when the player is within TB.wakeR.
import * as THREE from 'three';
import { Guard, GUARD } from '../guards.js';
import { Dummy } from '../dummies.js';
import { BOSS_SPAWNS, POI } from './layout.js';
import { clamp, rand, angleDelta } from '../util.js';

export const TB = { hp: 170, walk: 2.3, run: 5.4, sight: 26, lose: 70, melee: 2.3, respawnMin: 120, respawnMax: 240, maxActive: 8, wakeR: 170, sleepR: 280, safeR: 30, perSite: 2 };
const _a = new THREE.Vector3();

export class TrainBot extends Guard {
  constructor(scene, world, game) {
    super(scene, world, new THREE.Vector3(0, -500, 0), 0, game, 'TRAINING ROBOT');
    this.isTrainBot = true; this.isGuard = false; this.maxHp = this.hp = TB.hp; this.parked = true; this.dead = true; this.collider.dead = true; this.root.visible = false; this.respawnT = 1e9;
    this.suitM.color.set(0x3b4f66); this.armorM.color.set(0xe9e4d8); this.trimM.color.set(0x23b36a); this.blackM.color.set(0x1a2128);
    this.blocking = false; this.blockT = 0; this.blockCd = 0; this.counterQ = false; this.deadAge = 0; this.site = null; this.wp = []; this.wpI = 0; this.wait = 0; this.st = 'idle'; this.deathFX = false;
    this.stats.blocks = 0; this.stats.counters = 0;
  }
  get present() { return !this.parked && !this.dead; }
  /** put this body on a post, fresh and alive */
  assign(site) {
    this.site = site; this.parked = false; this.dead = false; this.deadAge = 0; this.deathFX = false; this.hp = this.maxHp; this.stun = 0; this.atk = null; this.blocking = false; this.blockT = 0; this.counterQ = false; this.held = false; this.kv.set(0, 0, 0); this.air = this.airV = 0;
    this.home.set(site.x, this.world.terrain.height(site.x, site.z), site.z); this.spawn.copy(this.home); this.post = this.home.clone(); this.postYaw = rand(0, 6.28); this.yaw = this.postYaw; this.root.visible = true; this.collider.dead = false; this.tilt.set(0, 0); this.tiltV.set(0, 0); this.slide.set(0, 0, 0); this.slideV.set(0, 0, 0);
    this.drawBar(); this.st = 'idle'; this.root.position.copy(this.home); this.wp = site.wp.map(p => new THREE.Vector3(p[0], 0, p[1])); this.wpI = 0; this.wait = rand(0.5, 3); this.mem.copy(this.home);
  }
  park() { this.parked = true; this.dead = true; this.collider.dead = true; this.root.visible = false; this.home.set(0, -500, 0); this.root.position.copy(this.home); this.atk = null; this.site = null; }
  // ---------------------------------------------------------------------------------------------------- movement (no arena clamp; the island is open)
  step(dx, dz, speed, dt) {
    const h = this.home; speed *= (this.slimeMul ?? 1); h.x += dx * speed * dt; h.z += dz * speed * dt;
    this.collider.dead = true; this.world.resolveXZ(h, GUARD.radius, h.y, GUARD.height, 0.3); this.collider.dead = this.dead; if (this.world.lagoon) this.world.lagoon.keepOut(h, 0.7);
  }
  // ---------------------------------------------------------------------------------------------------- AI
  ai(dt) {
    const g = this.g, h = this.home, P = g.player; this.speed = 0;
    const sm = this.slimeMul ?? 1; this.stun = Math.max(0, this.stun - dt); this.batCool -= dt * sm; this.blockCd -= dt; this.alert = Math.max(0, this.alert - dt);
    if (this.stun > 0 || this.held || this.air > 0.02) { this.atk = null; this.blocking = false; this.vx = this.vz = 0; return; }
    if (this.frozen || this.possessed) return; if (this.slimeStuck) { this.atk = null; this.face(P.pos.x, P.pos.z, 3, dt); return; }
    const d = Math.hypot(P.pos.x - h.x, P.pos.z - h.z), hostile = g.enemies && g.enemies.enabled;
    const seen = hostile && d < TB.sight && this.sees(P, d);
    if (this.blocking) {                                                   // guard up: face the player, no walking
      this.blockT -= dt; this.face(P.pos.x, P.pos.z, 14, dt);
      if (this.blockT <= 0) { this.blocking = false; this.blockCd = 2.2; if (this.counterQ) { this.counterQ = false; this.batCool = 0; this.startBaton(); this.stats.counters++; } }
      return;
    }
    if (seen && this.st !== 'chase') { this.st = 'chase'; this.stT = 0; this.alert = 0.45; this.stats.spotted++; g.sfx.beep && g.sfx.beep(false); }
    if (seen) this.mem.copy(P.pos);
    this.stT += dt;
    if (this.st === 'chase') {
      if (this.alert > 0) { this.face(P.pos.x, P.pos.z, 12, dt); }
      else if (seen || d < 6) {
        this.face(P.pos.x, P.pos.z, 11, dt);
        if (this.atk) this.updateAtk(dt, P, P.pos);
        else if (d < 4.6 && this.blockCd <= 0 && P.act && !P.ignoreHits && Math.random() < dt * 2.2) { this.blocking = true; this.blockT = 0.8; this.stats.blocks++; this.atk = null; }
        else if (d < TB.melee + 0.4 && this.batCool <= 0) this.startBaton();
        else if (d > TB.melee - 0.2) this.goTo(P.pos, TB.run, dt, 11);
        this.lostT = 0;
      } else {
        this.atk = null; this.lostT = (this.lostT || 0) + dt;
        if (this.goTo(this.mem, TB.run * 0.8, dt) < 1.2 || this.lostT > 6) { this.st = 'search'; this.stT = 0; this.lostT = 0; }
      }
      if (Math.hypot(h.x - this.post.x, h.z - this.post.z) > TB.lose && !seen) { this.st = 'return'; this.stT = 0; }
    } else if (this.st === 'search') {
      this.yaw += Math.sin(this.stT * 1.6) * dt * 1.1; if (this.stT > 3.5) { this.st = 'return'; this.stT = 0; }
    } else if (this.st === 'return') {
      if (this.goTo(this.post, TB.walk * 1.6, dt, 6) < 0.6) { this.st = 'idle'; this.stT = 0; }
    } else {                                                               // patrol between waypoints, pausing at each
      if (this.wait > 0) { this.wait -= dt; this.yaw += Math.sin(this.an.t * 0.7) * dt * 0.4; }
      else if (this.wp.length) { const p = this.wp[this.wpI]; if (this.goTo(p, TB.walk, dt, 7) < 0.8) { this.wpI = (this.wpI + 1) % this.wp.length; this.wait = rand(1, 3.5); } }
    }
    if (this.atk && this.st !== 'chase') this.atk = null;
  }
  // ---------------------------------------------------------------------------------------------------- damage
  applyHit(point, dir, dmg) {
    if (this.parked || this.dead) return; const was = this.dead;
    if (this.blocking && dmg < 60) {                                      // guarded: a fraction of the damage, no flinch, then the counter
      Dummy.prototype.applyHit.call(this, point, dir, dmg * 0.25); this.counterQ = true; this.blockT = Math.min(this.blockT, 0.28);
      if (this.dead) { this.respawnT = 1e9; return; } const g = this.g; g.sfx.hit && g.sfx.hit(false); for (let i = 0; i < 6; i++) g.fx.glow.emit({ pos: point.clone(), vel: _a.set(rand(-1, 1), rand(0, 1), rand(-1, 1)).normalize().multiplyScalar(rand(3, 6)).clone(), size: rand(0.1, 0.22), life: 0.25, drag: 2, color: [0.5, 0.9, 1] });
      return;
    }
    if (this.blocking) { this.blocking = false; this.stun = 0.9; this.blockCd = 3; dmg *= 0.7; }
    super.applyHit(point, dir, dmg); this.respawnT = this.dead ? 1e9 : this.respawnT; void was;
  }
  respawn() { /* the post respawns it (TrainBots.update); the Dummy timer never fires */ }
  update(dt) {
    if (this.parked) return;
    super.update(dt);
    if (this.blocking) { this.arms[0].rotation.set(-1.75, 0, -0.35); this.arms[1].rotation.set(-1.75, 0, 0.35); this.torso.rotation.x = 0.15; this.visorM.emissive.setRGB(0.2, 0.8, 1); }
  }
}

// ======================================================================================================== manager
export class TrainBots {
  constructor(game, island) {
    this.g = game; this.world = game.world; this.T = this.world.terrain; this.list = []; this.t = 0; this.scanT = 0; this.sites = this.pickSites();
    for (let i = 0; i < TB.maxActive; i++) this.list.push(new TrainBot(game.scene, this.world, game));
    this.stats = { defeated: 0, respawned: 0 };
    const q = new URLSearchParams(location.search); if (q.get('botres')) { const [a, b] = q.get('botres').split(',').map(Number); if (a > 0) { TB.respawnMin = a; TB.respawnMax = b > a ? b : a; } }
  }
  setRespawn(min, max) { TB.respawnMin = Math.max(3, min); TB.respawnMax = Math.max(TB.respawnMin, max ?? min); }
  pickSites() {
    const w = this.world, T = this.T, cand = [], seen = [];
    const base = BOSS_SPAWNS.map(b => [b.x, b.z]).concat(POI.filter(p => ['labs', 'port', 'pier', 'suburbPark', 'canyon', 'downtown'].includes(p.id)).map(p => [p.x, p.z]));
    for (const [bx, bz] of base) for (let k = 0; k < 14; k++) cand.push([bx + (Math.random() - 0.5) * 70, bz + (Math.random() - 0.5) * 70]);
    for (const [x, z] of cand) {
      if (T.dl(x, z) < 8 || T.slope(x, z) > 0.18) continue; if (seen.some(s => Math.hypot(s[0] - x, s[1] - z) < 55)) continue;
      const y = T.height(x, z); if (y < 0.4) continue; if (w.staticsIn(x - 4, z - 4, x + 4, z + 4).some(b => b.max.y > y + 0.5)) continue;
      const wp = []; for (let k = 0; k < 3; k++) { const a = k * 2.1 + Math.random(), r = 8 + Math.random() * 8, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; if (T.dl(px, pz) > 5 && T.slope(px, pz) < 0.3 && !w.staticsIn(px - 1.5, pz - 1.5, px + 1.5, pz + 1.5).some(b => b.max.y > T.height(px, pz) + 0.5)) wp.push([px, pz]); }
      if (wp.length < 2) continue; seen.push([x, z]); this.addSite(seen.length, x, z, wp);
    }
    return this.sitesArr || [];
  }
  addSite(id, x, z, wp) { (this.sitesArr = this.sitesArr || []).push({ id, x, z, wp, bots: [], cool: 0, due: 0 }); }
  update(dt) {
    this.t += dt; const P = this.g.player; this.scanT -= dt;
    for (const b of this.list) if (!b.parked && b.dead) { b.deadAge += dt; if (!b.deathFX) { b.deathFX = true; this.defeatFX(b); } if (b.deadAge > 4) { const s = b.site; if (s) { s.bots = s.bots.filter(o => o !== b); s.due = this.t + rand(TB.respawnMin, TB.respawnMax); } b.park(); this.stats.defeated++; } }
    if (this.scanT > 0) return; this.scanT = 0.8;
    for (const b of this.list) if (!b.parked && !b.dead && Math.hypot(b.home.x - P.pos.x, b.home.z - P.pos.z) > TB.sleepR) { const s = b.site; if (s) s.bots = s.bots.filter(o => o !== b); b.park(); }       // far away: back to the pool
    let free = this.list.filter(b => b.parked);
    for (const s of this.sites) {
      if (!free.length) break; const d = Math.hypot(s.x - P.pos.x, s.z - P.pos.z); if (d > TB.wakeR || d < TB.safeR || this.t < s.due) continue;
      while (s.bots.length < TB.perSite && free.length) { const b = free.pop(); const off = s.bots.length * 3.5; b.assign({ ...s, x: s.x + off, wp: s.wp }); b.site = s; s.bots.push(b); if (s.due > 0) this.stats.respawned++; }
      s.due = 0;
    }
  }
  defeatFX(b) { const g = this.g, c = b.root.position; for (let i = 0; i < 14; i++) g.fx.glow.emit({ pos: _a.set(c.x, c.y + 1.2, c.z).clone(), vel: new THREE.Vector3(rand(-1, 1), rand(0.3, 1.4), rand(-1, 1)).normalize().multiplyScalar(rand(2, 6)), size: rand(0.12, 0.3), life: 0.5, drag: 2, color: [0.4, 0.9, 1] });
    g.fire && g.fire.smoke(new THREE.Vector3(c.x, c.y + 1, c.z), new THREE.Vector3(0, 1.5, 0), 1.2, 1.4); g.sfx.crash && g.sfx.crash(0.25); }
}
void clamp; void angleDelta;
