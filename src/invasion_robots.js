// V32 INVASION ARMY. Four robot classes of Vilgax's army (dark green armour, deep red plating, black frames, glowing red sensors) + the manager that deploys them from the mothership.
//   1 DRONE   - small flying attack drone: hovers, patrols, detects, strafes and shoots fast red bolts, jinks away from hits. Fragile.
//   2 STANDARD- the training-robot body in army colours: walks / runs, shoots, punches, blocks and counters. Weakest ground unit.
//   3 HEAVY   - 1.5x: broad pauldrons, thick arms, slow telegraphed heavy punches with big knockback, stronger bolts.
//   4 GIANT   - "Enforcer", ~Vilgax height (2.4x, far smaller than Way Big): very durable, telegraphed ground slam (red ring on the floor), triple bolts, limited environmental damage. Always weaker than Vilgax.
// Ground robots extend the existing TrainBot / Guard / Dummy body (so every alien can punch, shove, launch, grab and throw them like any other enemy) with their own AI:
//   they only react to what they DETECT (line of sight + range + a forward field of view; combat noise alerts nearby ones), they threaten civilians, and they search briefly before going back to patrol.
//   Vilgax's PERSONAL force (`personal = true`) is the one exception: it always knows where the player is.
// Everything is pooled (bodies are built once, then parked / reused), populations are capped, AI only runs near the player, deployment is on gameplay-time intervals (never on world-time speed).
import * as THREE from 'three';
import { TrainBot } from './island/trainbots.js';
import { Dummy } from './dummies.js';
import { attackImpact } from './impact.js';
import { clamp, rand, angleDelta, damp } from './util.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
export const INV = {
  maxDrone: 8, maxStd: 6, maxHeavy: 3, maxGiant: 2, maxPersonal: 5,       // simultaneously alive (the pool sizes)
  waveMin: 14, waveMax: 22, firstWave: 5,                                  // seconds of gameplay time between waves (never world time)
  activeR: 520, sleepR: 640,                                                // player distance to the city centre: deployment happens only while the player is this close; robots further away go back to the pool
  weights: { drone: 0.46, std: 0.32, heavy: 0.17, giant: 0.05 },
};
export const CLS = {
  std:   { name: 'INVASION ROBOT', scale: 1.0, hp: 150, walk: 2.6, run: 5.8, sight: 32, civSight: 24, melee: 2.2, shotMin: 6, shotMax: 30, batDmg: 14, batKb: 8, batWind: 0.4, batCd: 0.8, boltDmg: 11, boltKb: 3.4, boltSpeed: 24, shotCd: [2.0, 3.0], block: 0.35, stunMax: 0.32, kbMul: 1 },
  heavy: { name: 'HEAVY ASSAULT ROBOT', scale: 1.5, hp: 480, walk: 2.2, run: 4.6, sight: 36, civSight: 26, melee: 3.2, shotMin: 8, shotMax: 30, batDmg: 30, batKb: 15, batWind: 0.78, batCd: 1.5, boltDmg: 15, boltKb: 4.5, boltSpeed: 24, shotCd: [3.0, 4.5], block: 0.5, stunMax: 0.16, kbMul: 0.55 },
  giant: { name: 'GIANT ENFORCER', scale: 2.4, hp: 1200, walk: 2.0, run: 3.9, sight: 46, civSight: 30, melee: 4.9, shotMin: 10, shotMax: 42, batDmg: 44, batKb: 22, batWind: 0.98, batCd: 2.0, boltDmg: 18, boltKb: 5.5, boltSpeed: 26, shotCd: [3.2, 5.0], block: 0.55, stunMax: 0.0, kbMul: 0.22, burst: 3, slam: { r: 8.5, dmg: 32, wind: 1.15, cd: 9 } },
};
const GREEN = 0x1d4a2a, RED = 0x8a1519, DARKRED = 0x5a0f14, BLACK = 0x14181a;

// ======================================================================================================== ground robots
export class InvRobot extends TrainBot {
  constructor(scene, world, game, cls) {
    super(scene, world, game);
    const C = this.C = CLS[cls], S = C.scale; this.cls = cls; this.isInv = true; this.kindName = C.name; this.name = C.name; this.label = C.name; this.maxHp = this.hp = C.hp; this.h = 2.2 * S;
    this.suitM.color.set(GREEN); this.armorM.color.set(DARKRED); this.armorM.metalness = 0.7; this.trimM.color.set(RED); this.blackM.color.set(BLACK);
    this.visorM.color.set(0x200505); this.visorM.emissive.setRGB(1, 0.08, 0.05); this.tipM.color.set(0x300505); this.tipM.emissive.setRGB(1, 0.15, 0.05);
    this.plateM = new THREE.MeshStandardMaterial({ color: DARKRED, roughness: 0.45, metalness: 0.7 }); this.glowM = new THREE.MeshStandardMaterial({ color: 0x300505, emissive: 0xff2a10, emissiveIntensity: 1.6, roughness: 0.5 });
    const add = (par, geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; par.add(m); return m; };
    if (cls !== 'std') {                                                       // broad shoulders, thick arms, glowing chest core
      for (const s of [-1, 1]) { const pad = add(this.torso, new THREE.BoxGeometry(0.4, 0.24, 0.5), this.plateM, s * 0.5, 0.78, 0); pad.rotation.z = -s * 0.22; add(this.torso, new THREE.BoxGeometry(0.36, 0.06, 0.46), this.glowM, s * 0.5, 0.9, 0).rotation.z = -s * 0.22; }
      add(this.torso, new THREE.BoxGeometry(0.26, 0.26, 0.06), this.glowM, 0, 0.4, 0.24); this.arms.forEach(a => a.scale.set(1.5, 1, 1.5)); this.torso.scale.set(1.28, 1.05, 1.22);
    }
    if (cls === 'giant') {                                                     // back spikes + head crest + wider stance
      for (let i = 0; i < 4; i++) { const sp = add(this.torso, new THREE.ConeGeometry(0.07, 0.5, 6), this.plateM, (i - 1.5) * 0.17, 0.78, -0.26); sp.rotation.x = -0.5; }
      add(this.head, new THREE.BoxGeometry(0.08, 0.2, 0.34), this.plateM, 0, 0.26, -0.02); this.legs.forEach(l => l.scale.set(1.35, 1, 1.35));
    }
    this.root.scale.setScalar(S); this.collider.r = 0.55 * S; this.collider.h = 2.2 * S; this.slamCd = 4; this.civT = 0; this.civ = null; this.personal = false; this.lastAir = 0; this.stats.slams = 0; this.grudge = 0; this.poiseT = 0; this.dodgeT = 0; this.dodgeCd = rand(1, 3); this.ddx = this.ddz = 0; this.slotA = rand(0, 6.283); this.slotV = new THREE.Vector3(); this.stats.dodges = 0; this.stats.blocks = 0; this.stats.retaliations = 0;
  }
  get present() { return !this.parked && !this.dead; }
  /** put this body into the world at (x,z); descend = drops in from above on a controlled thruster fall */
  deploy(x, z, o = {}) {
    const C = this.C, gy = this.world.groundAt(x, z, 60, 70, 0.25);
    this.parked = false; this.dead = false; this.deadAge = 0; this.deathFX = false; this.stun = 0; this.atk = null; this.blocking = false; this.blockT = 0; this.counterQ = false; this.held = false; this.kv.set(0, 0, 0); this.air = this.airV = 0; this.thrown = 0;
    let hp = C.hp; if (this.cls === 'giant') { const v = this.g.vilgax; if (v && v.maxHp) hp = Math.min(hp, Math.round(v.maxHp * 0.55)); } this.maxHp = this.hp = hp;
    this.home.set(x, gy, z); this.spawn.copy(this.home); this.post = this.home.clone(); this.yaw = this.postYaw = rand(0, 6.28); this.root.visible = true; this.collider.dead = false; this.tilt.set(0, 0); this.tiltV.set(0, 0); this.slide.set(0, 0, 0); this.slideV.set(0, 0, 0);
    this.drawBar(); this.st = 'idle'; this.stT = 0; this.root.position.copy(this.home); this.wpI = 0; this.wait = rand(0.4, 2); this.mem.copy(this.home); this.personal = !!o.personal; this.civ = null; this.civT = rand(0, 0.4);
    this.wp = []; for (let k = 0; k < 3; k++) { const a = k * 2.1 + rand(0, 1), r = rand(9, 24); this.wp.push(new THREE.Vector3(x + Math.cos(a) * r, 0, z + Math.sin(a) * r)); }
    this.slamCd = rand(3, 6); this.fireCool = rand(1, 2.5); this.batCool = 0; this.blockCd = 0;
    if (o.descend) { this.air = 80; this.airV = 0; } this.lastAir = this.air; this.root.rotation.y = this.yaw; this.root.updateMatrixWorld(true);
  }
  park() { this.parked = true; this.dead = true; this.collider.dead = true; this.root.visible = false; this.home.set(0, -500, 0); this.root.position.copy(this.home); this.atk = null; this.personal = false; this.air = this.airV = 0; }
  // ---------------------------------------------------------------------------------------------------- perception / movement
  sees(P, d) {
    const g = this.g, S = g.stealth; if (S.gf && S.gf.possessing) return false;
    const C = this.C, range = S.hidden ? 2 : (this.st === 'chase' ? C.sight * 1.35 : C.sight) * (P.stealthSize ?? 1) * (this.alarm > 0 ? 1.4 : 1); if (d > range) return false; if (S.hidden) return true;
    const h = this.home, dx = P.pos.x - h.x, dz = P.pos.z - h.z, dot = d > 1e-3 ? (dx * Math.sin(this.yaw) + dz * Math.cos(this.yaw)) / d : 1;
    if (d > 4 && dot < 0.15 && this.st !== 'chase' && !(this.alarm > 0)) return false;                           // not alerted yet: only looks ahead (+-80 deg)
    const S1 = this.C.scale; _a.set(h.x, this.root.position.y + 1.85 * S1, h.z); _b.set(P.pos.x, P.pos.y + (P.sightY ?? 1.3), P.pos.z).sub(_a); const L = _b.length(); if (L < 1e-3) return true; _b.multiplyScalar(1 / L);
    return !g.world.raySolid(_a, _b, L - 0.3);
  }
  step(dx, dz, speed, dt) {
    const h = this.home, S = this.C.scale; speed *= (this.slimeMul ?? 1); h.x += dx * speed * dt; h.z += dz * speed * dt;
    this.collider.dead = true; this.world.resolveXZ(h, 0.55 * S, h.y, 2.2 * S, 0.45); this.collider.dead = this.dead; if (this.world.lagoon) this.world.lagoon.keepOut(h, 0.7 * S);
  }
  // ---------------------------------------------------------------------------------------------------- AI
  ai(dt) {
    const g = this.g, h = this.home, P = g.player, C = this.C; this.speed = 0;
    const sm = this.slimeMul ?? 1; this.stun = Math.max(0, this.stun - dt); this.fireCool -= dt * sm; this.batCool -= dt * sm; this.blockCd -= dt; this.slamCd -= dt; this.alert = Math.max(0, this.alert - dt); this.alarm = Math.max(0, (this.alarm || 0) - dt);
    this.grudge = Math.max(0, this.grudge - dt); this.poiseT = Math.max(0, this.poiseT - dt); this.dodgeCd -= dt;
    if (this.stun > 0 || this.held || this.air > 0.02) { this.atk = null; this.blocking = false; this.vx = this.vz = 0; return; }
    if (this.dodgeT > 0) { this.dodgeT -= dt; this.step(this.ddx, this.ddz, 9 * (this.cls === 'heavy' ? 0.7 : 1), dt); this.face(P.pos.x, P.pos.z, 8, dt); return; }
    if (this.frozen || this.possessed) return; if (this.slimeStuck) { this.atk = null; this.face(P.pos.x, P.pos.z, 3, dt); return; }
    const hostile = g.enemies && g.enemies.enabled, dp = Math.hypot(P.pos.x - h.x, P.pos.z - h.z);
    let seen = false, tgt = null, kind = '', d = dp;
    const know = !!(g.invasion && g.invasion.knowsPlayer && g.invasion.knowsPlayer()), prov = this.grudge > 0;       // V33: provoked (the player hit me) > player visible > civilians; after Vilgax arrives every robot knows where the player is
    if (hostile && dp < (prov ? 700 : know ? 900 : 480) && (this.personal || prov || know || this.sees(P, dp))) { seen = true; tgt = P.pos; kind = 'player'; this.mem.copy(P.pos); this.lostT = 0; }
    else if (!this.personal) {                                                                                    // civilians: nearest one in sight range (twice a second)
      this.civT -= dt; if (this.civT <= 0) { this.civT = 0.45; this.civ = g.invasion ? g.invasion.nearestCivilian(h.x, h.z, C.civSight) : null; }
      const c = this.civ; if (c && !c.dead) { const dc = Math.hypot(c.x - h.x, c.z - h.z); if (dc < C.civSight + 4) { seen = true; kind = 'civ'; d = dc; this.civTgt = this.civTgt || new THREE.Vector3(); this.civTgt.set(c.x, c.y, c.z); tgt = this.civTgt; } else this.civ = null; }
    }
    if (seen && this.st !== 'chase') { this.st = 'chase'; this.stT = 0; this.alert = kind === 'player' ? 0.45 : 0.2; if (kind === 'player') { g.sfx.beep && g.sfx.beep(false); if (g.invasion) g.invasion.alarmNear(h.x, h.z, 38); } }
    this.stT += dt;
    if (this.blocking) {
      this.blockT -= dt; this.face(P.pos.x, P.pos.z, 14, dt);
      if (this.blockT <= 0) { this.blocking = false; this.blockCd = 2.4; if (this.counterQ) { this.counterQ = false; this.batCool = 0; this.startBaton(); } }
      return;
    }
    if (this.st === 'chase') {
      if (this.alert > 0) { if (tgt) this.face(tgt.x, tgt.z, 12, dt); }
      else if (seen) {
        this.face(tgt.x, tgt.z, 11, dt);
        if (this.atk) this.updateAtk(dt, kind === 'player' ? P : null, tgt);
        else if (kind === 'player' && d < C.melee + 1.5 && this.blockCd <= 0 && P.act && !P.ignoreHits && Math.random() < dt * 2.2 * C.block * (prov ? 2.5 : 1)) { this.blocking = true; this.blockT = 0.8; this.atk = null; this.stats.blocks++; }
        else if (kind === 'player' && this.cls !== 'giant' && d < C.melee + 3.5 && this.dodgeCd <= 0 && P.act && !this.atk && Math.random() < dt * 1.4) { const L = d || 1, sg = Math.random() < 0.5 ? 1 : -1; this.ddx = -(P.pos.z - h.z) / L * sg; this.ddz = (P.pos.x - h.x) / L * sg; this.dodgeT = 0.32; this.dodgeCd = rand(2.2, 4.2); this.stats.dodges++; }
        else if (this.cls === 'giant' && kind === 'player' && d < C.slam.r * 0.95 && this.slamCd <= 0) { this.startBaton(true); this.slamCd = C.slam.cd * rand(0.8, 1.2); }
        else if (d < C.melee + 0.4 && this.batCool <= 0) this.startBaton(false);
        else if (d > C.shotMin && d < C.shotMax && this.fireCool <= 0 && (kind === 'civ' || hostile)) this.startShot(tgt);
        else if (d > C.melee - 0.2) { let go = tgt; if (kind === 'player' && (know || this.personal) && d > C.melee * 3) { const a = this.slotA + this.stT * 0.04, rr = C.melee * 1.5; go = this.slotV.set(P.pos.x + Math.cos(a) * rr, P.pos.y, P.pos.z + Math.sin(a) * rr); } this.goTo(go, C.run, dt, 11); }
        this.lostT = 0;
      } else {
        this.atk = null; this.lostT = (this.lostT || 0) + dt;
        if (this.goTo(this.mem, C.run * 0.8, dt) < 1.2 || this.lostT > 6) { this.st = 'search'; this.stT = 0; this.lostT = 0; }
      }
    } else if (this.st === 'search') {
      this.yaw += Math.sin(this.stT * 1.6) * dt * 1.1; if (this.stT > 3.5) { this.st = 'idle'; this.stT = 0; }
    } else {                                                                                                       // patrol between waypoints, pausing at each
      if (this.wait > 0) { this.wait -= dt; this.yaw += Math.sin(this.an.t * 0.7) * dt * 0.4; }
      else if (this.wp.length) { const p = this.wp[this.wpI]; if (this.goTo(p, C.walk, dt, 7) < 0.8) { this.wpI = (this.wpI + 1) % this.wp.length; this.wait = rand(1, 3); } }
    }
    if (this.atk && this.st !== 'chase') this.atk = null;
  }
  // ---------------------------------------------------------------------------------------------------- attacks
  startBaton(slam = false) {
    if (this.atk || this.dead) return false; const C = this.C;
    this.atk = { kind: 'baton', t: 0, windup: slam ? C.slam.wind : C.batWind, strike: 0.14, rec: slam ? 0.9 : 0.42, hit: new Set(), done: false, slam }; this.stats.batons++;
    if (slam) { this.stats.slams++; const r = this.root.position; this.g.fx.surface.ring(_a.set(r.x + Math.sin(this.yaw) * 1.5 * C.scale, r.y + 0.12, r.z + Math.cos(this.yaw) * 1.5 * C.scale), UP, C.slam.r, C.slam.wind, 0xff3a2a); }       // the red floor ring is the telegraph
    return true;
  }
  updateAtk(dt, P, tgt) { const k = this.atk && this.atk.kind; super.updateAtk(dt, P, tgt); if (k && !this.atk) { if (k === 'baton') this.batCool = this.C.batCd; else this.fireCool = rand(this.C.shotCd[0], this.C.shotCd[1]); } }
  muzzle(out) { const S = this.C.scale; return out.set(this.root.position.x + Math.sin(this.yaw) * 0.75 * S + Math.cos(this.yaw) * 0.38 * S, this.root.position.y + 1.45 * S, this.root.position.z + Math.cos(this.yaw) * 0.75 * S - Math.sin(this.yaw) * 0.38 * S); }
  fireBolt(a, P, tgt) {
    const g = this.g, C = this.C, o = this.muzzle(new THREE.Vector3()), t = tgt || P.pos, hs = P && P.hitSphere, sc = hs ? hs.r / 0.95 : 1, n = C.burst || 1;
    for (let k = 0; k < n; k++) {
      const spread = n > 1 ? (k - (n - 1) / 2) * 0.16 : 0, dir = _b.set(t.x + rand(-0.4, 0.4) * sc, (t.y || 0) + (hs ? hs.y : 1.3) + rand(-0.25, 0.25) * sc, t.z + rand(-0.4, 0.4) * sc).sub(o).normalize(); if (spread) { const sx = dir.x, sz = dir.z; dir.x = sx * Math.cos(spread) - sz * Math.sin(spread); dir.z = sx * Math.sin(spread) + sz * Math.cos(spread); }
      g.enemies.spawnBolt(o, dir.clone(), this, 'enemy', { dmgP: C.boltDmg, kb: C.boltKb, speed: C.boltSpeed, scale: 0.8 + 0.35 * C.scale, red: true });
    }
    g.fx.glow.emit({ pos: o, size: 1.2 * C.scale, life: 0.12, drag: 0, color: [1, 0.2, 0.1] }); g.sfx.zap(0.18);
    if (a && !P && g.invasion && this.civ && tgt) g.invasion.hitCivilian(this.civ, 0.7);                                // shot at a civilian
  }
  batonContact(a, P, tgt) {
    if (a.done) return; const g = this.g, C = this.C, S = C.scale, r = this.root.position, sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    if (a.slam) {                                                                                                    // GIANT ground slam: radius damage to the player + shockwave on props / walls (limited, bounded)
      a.done = true; const c = _c.set(r.x + sy * 1.5 * S, r.y, r.z + cy * 1.5 * S).clone(), R = C.slam.r;
      g.fx.dust.emit({ pos: c.clone().setY(c.y + 0.4), size: R * 1.1, grow: 3, life: 0.8, drag: 1.5, color: [0.6, 0.57, 0.52], alpha: 0.55 }); g.fx.surface.ring(c.clone().setY(c.y + 0.15), UP, R * 1.1, 0.45, 0xffb060); g.sfx.boom && g.sfx.boom(0.35); g.camera.addTrauma(clamp(0.55 - Math.hypot(P.pos.x - c.x, P.pos.z - c.z) / 70, 0, 0.55));
      const dx = P.pos.x - c.x, dz = P.pos.z - c.z, dp = Math.hypot(dx, dz); if (!P.ignoreHits && dp < R && P.pos.y < r.y + 2.6) g.impact.hitPlayer(attackImpact({ damage: C.slam.dmg * (0.55 + 0.45 * (1 - dp / R)), knockbackForce: 14, upwardForce: 4, staggerDuration: 0.5, knockdownThreshold: 9, launchThreshold: 30, point: c.clone(), dir: _b.set(dx || 1, 0, dz).normalize().clone(), src: this }));
      if (g.props) g.props.shockwave(c, R * 0.9, 9, 40, 70); g.world.danger && g.world.danger(c.x, c.z, 40, 2); return;
    }
    const c = _c.set(r.x + sy * 1.3 * S, r.y + 1.25 * S, r.z + cy * 1.3 * S), R = 0.95 * S;
    if (P && !P.ignoreHits) { const dx = P.pos.x - c.x, dz = P.pos.z - c.z, rr = R + (P.rad ?? 0.5); if (dx * dx + dz * dz < rr * rr && c.y > P.pos.y - 0.4 && c.y < P.pos.y + (P.colH ?? 2.3) + (P.batonReach ?? 0.4) + 1.2 * S) { a.done = true; const dir = _b.set(dx, 0, dz).normalize().clone(); g.sfx.hit(false); g.impact.hitPlayer(attackImpact({ damage: C.batDmg, knockbackForce: C.batKb, upwardForce: this.cls === 'std' ? 0 : 2, staggerDuration: 0.3 + 0.1 * (S - 1), ordinary: this.cls === 'std', point: c.clone(), dir, quiet: true, src: this })); } }
    else if (!P && this.civ && !this.civ.dead && Math.hypot(this.civ.x - c.x, this.civ.z - c.z) < R + 0.8) { a.done = true; if (g.invasion) g.invasion.hitCivilian(this.civ, 1); }
  }
  // ---------------------------------------------------------------------------------------------------- damage
  applyHit(point, dir, dmg) {
    const was = this.dead; super.applyHit(point, dir, dmg); if (!this.dead) {
      this.stun = Math.min(this.stun, this.C.stunMax); this.alarm = 4; this.grudge = 8; if (this.st !== 'chase') { this.st = 'chase'; this.stT = 0; } this.alert = Math.min(this.alert, 0.1); this.civ = null;                       // retaliate at once: whoever hit me is the target now
      if (this.stun > 0) { if (this.poiseT > 0) this.stun = 0; else this.poiseT = this.stun + 1.3; }         // no stun-lock: after a stagger he is poised for a moment
      this.batCool = Math.min(this.batCool, 0.25); this.stats.retaliations++; if (this.g.player && this.g.player.pos) this.mem.copy(this.g.player.pos);
    }
    if (this.dead && !was) { this.atk = null; this.blocking = false; if (this.g.invasion) this.g.invasion.onRobotDown(this); }
  }
  shove(dir, speed) { super.shove(dir, speed * this.C.kbMul); }
  launch(vy) { if (this.cls === 'giant') return; super.launch(this.cls === 'heavy' ? vy * 0.5 : vy); }
  update(dt) {
    if (this.parked) return;
    if (this.air > 0.5 && this.airV < -14) this.airV = -14;                                                       // controlled drop: terminal speed 14 m/s
    super.update(dt);
    if (this.air > 0.5 && this.airV < -14) this.airV = -14;
    if (this.air > 2 && Math.random() < dt * 40) this.g.fire.flame(_a.set(this.home.x + rand(-0.4, 0.4), this.home.y + this.air + 0.2, this.home.z + rand(-0.4, 0.4)), _b.set(0, rand(-5, -2), 0), 0.5 * this.C.scale, 0.4, 1);   // thruster flames while descending
    if (this.lastAir > 0.05 && this.air <= 0.001) this.landFX();
    this.lastAir = this.air;
    this.visorM.emissive.setRGB(1, this.st === 'chase' ? 0.06 : 0.22, 0.05); if (this.stun > 0.01) this.visorM.emissive.setRGB(0.4, 0.05, 0.05);    // red eyes in every state
  }
  landFX() { const g = this.g, c = this.home, S = this.C.scale; g.fx.dust.emit({ pos: _a.set(c.x, c.y + 0.3, c.z).clone(), size: 3 * S, grow: 3, life: 0.9, drag: 1.5, color: [0.6, 0.57, 0.52], alpha: 0.5 }); g.fx.surface.ring(_a.set(c.x, c.y + 0.1, c.z).clone(), UP, 3.5 * S, 0.4, 0xff6030); g.camera.addTrauma(clamp(0.25 * S - Math.hypot(g.player.pos.x - c.x, g.player.pos.z - c.z) / 90, 0, 0.35)); if (this.cls === 'giant') g.sfx.boom && g.sfx.boom(0.25); }
}

// ======================================================================================================== flying drone
export class InvDrone extends Dummy {
  constructor(scene, world, game) {
    super(scene, world, new THREE.Vector3(0, -500, 0), 0, 'ATTACK DRONE');
    this.g = game; this.isInv = true; this.isDrone = true; this.kindName = 'ATTACK DRONE'; this.cls = 'drone'; this.maxHp = this.hp = 46; this.h = 1.2; this.mass = 40;
    this.root.traverse(o => { if (o.isMesh) o.visible = false; });                                                   // the Dummy mannequin is replaced by the drone body
    this.collider.dead = true; this.collider.r = 0.6; this.collider.h = 1.2; this.bar.position.set(0, 1.35, 0); this.drawBar();
    this.spheres = [{ local: new THREE.Vector3(0, 0, 0), r: 0.62 }];
    this.pos = new THREE.Vector3(0, -500, 0); this.vel = new THREE.Vector3(); this.parked = true; this.dead = true; this.root.visible = false; this.st = 'patrol'; this.stT = 0; this.t = rand(0, 6);
    const M = (c, r = 0.5, m = 0.5, e) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, ...(e ? { emissive: e, emissiveIntensity: 1.6 } : {}) });
    this.bodyM = M(GREEN, 0.45, 0.6); this.plateM = M(DARKRED, 0.4, 0.7); this.eyeM = M(0x300505, 0.3, 0.2, 0xff1a0a); this.mats = [this.bodyM, this.plateM];
    const B = this.body, add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; B.add(m); return m; };
    add(new THREE.SphereGeometry(0.4, 14, 10), this.bodyM, 0, 0, 0);
    add(new THREE.TorusGeometry(0.46, 0.07, 6, 16), this.plateM, 0, 0, 0).rotation.x = Math.PI / 2;
    this.eye = add(new THREE.SphereGeometry(0.17, 12, 8), this.eyeM, 0, 0.02, 0.34);
    for (let i = 0; i < 6; i++) { const a = i / 6 * 6.283, sp = add(new THREE.ConeGeometry(0.07, 0.34, 6), this.plateM, Math.cos(a) * 0.42, 0.12, Math.sin(a) * 0.42); sp.rotation.set(Math.sin(a) * 1.2, 0, -Math.cos(a) * 1.2); }
    this.rotors = []; for (const [x, z] of [[-0.62, -0.1], [0.62, -0.1]]) { const r = add(new THREE.TorusGeometry(0.2, 0.025, 5, 12), this.eyeM, x, 0.08, z); r.rotation.x = Math.PI / 2; this.rotors.push(r); add(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 5), this.bodyM, x * 0.7, 0.04, z).rotation.z = Math.PI / 2; }
    add(new THREE.CylinderGeometry(0.1, 0.13, 0.16, 8), this.plateM, 0, -0.4, 0);
    this.fireCool = rand(1, 2); this.jinkT = 0; this.jink = 0; this.civ = null; this.civT = 0; this.alarm = 0; this.deathT = 0; this.orb = rand(0, 6.28); this.rayT = 0; this.flash = 0; this.speed = 0;
  }
  get present() { return !this.parked && !this.dead; }
  deploy(x, y, z, o = {}) {
    this.parked = false; this.dead = false; this.deathT = 0; this.deathFX = false; this.hp = this.maxHp = 46; this.pos.set(x, y, z); this.vel.set(0, o.fromShip ? -9 : 0, 0); this.home.set(x, 0, z); this.cx = o.cx ?? x; this.cz = o.cz ?? z; this.personal = !!o.personal;
    this.root.visible = true; this.root.position.copy(this.pos); this.st = 'patrol'; this.stT = 0; this.kv.set(0, 0, 0); this.air = this.airV = 0; this.tilt.set(0, 0); this.tiltV.set(0, 0); this.drawBar(); this.civ = null; this.fireCool = rand(1.2, 2.4); this.alarm = 0; this.mem = this.mem || new THREE.Vector3(); this.mem.copy(this.pos); this.root.rotation.set(0, rand(0, 6.28), 0); this.root.updateMatrixWorld(true);
  }
  park() { this.parked = true; this.dead = true; this.root.visible = false; this.pos.set(0, -500, 0); this.root.position.copy(this.pos); this.collider.dead = true; }
  sees(P, d) {
    const g = this.g, S = g.stealth; if (S.gf && S.gf.possessing) return false; const range = S.hidden ? 2 : (this.st === 'chase' ? 58 : 42) * (P.stealthSize ?? 1) * (this.alarm > 0 ? 1.4 : 1); if (d > range) return false; if (S.hidden) return true;
    _a.copy(this.pos); _b.set(P.pos.x, P.pos.y + (P.sightY ?? 1.3), P.pos.z).sub(_a); const L = _b.length(); if (L < 1e-3) return true; _b.multiplyScalar(1 / L); return !g.world.raySolid(_a, _b, L - 0.3);
  }
  applyHit(point, dir, dmg) {
    if (this.dead || this.parked) return; const was = this.dead; this.hp = Math.max(0, this.hp - dmg); this.hitFlash = 0.14; this.drawBar();
    const k = Math.hypot(dir.x, dir.z) || 1; this.vel.x += dir.x / k * 6; this.vel.z += dir.z / k * 6; this.vel.y += 2; this.tiltV.x += (dir.z / k) * 5; this.tiltV.y -= (dir.x / k) * 5; this.alarm = 5; if (this.st !== 'chase') { this.st = 'chase'; this.stT = 0; }
    this.jinkT = 0;                                                                                                   // dodge: jink at once
    if (this.hp <= 0 && !was) { this.dead = true; this.deathT = 0; this.vel.addScaledVector(dir, 5); if (this.g.invasion) this.g.invasion.onRobotDown(this); }
  }
  shove(dir, speed) { this.vel.x += dir.x * speed * 0.8; this.vel.z += dir.z * speed * 0.8; }
  launch(vy) { this.vel.y += vy * 0.6; }
  knock(dir, force) { this.shove(dir, force); }
  update(dt) {
    if (this.parked) return; const g = this.g, P = g.player, p = this.pos; this.t += dt;
    if (this.dead) {                                                                                                    // tumbling wreck: falls, then bursts
      this.deathT += dt; this.vel.y -= 22 * dt; p.addScaledVector(this.vel, dt); this.root.rotation.x += dt * 6; this.root.rotation.z += dt * 4; const gy = g.world.groundAt(p.x, p.z, p.y + 1, 1, 0.3);
      if (Math.random() < dt * 30) g.fire.smoke(p.clone(), _b.set(0, 1, 0), 0.7, 1);
      if ((p.y <= gy + 0.4 || this.deathT > 2.2) && !this.deathFX) { this.deathFX = true; g.fire.burst(p.clone(), 12, 6, 0.9, 0.5, 0.6); g.fx.glow.emit({ pos: p.clone(), size: 4, life: 0.2, drag: 0, color: [1, 0.5, 0.2] }); g.sfx.crash && g.sfx.crash(0.18); this.root.visible = false; this.bar.visible = false; }
      this.root.position.copy(p); this.root.updateMatrixWorld(true); if (this.deathFX) { this.deadAge = (this.deadAge || 0) + dt; if (this.deadAge > 1.5) { this.deadAge = 0; this.park(); if (g.invasion) g.invasion.stats.dronesDown++; } } return;
    }
    // ---- perception
    const hostile = g.enemies && g.enemies.enabled, dp = Math.hypot(P.pos.x - p.x, P.pos.z - p.z, (P.pos.y - p.y) * 0.5); this.alarm = Math.max(0, this.alarm - dt); this.fireCool -= dt; this.stT += dt;
    let seen = false, tgt = null, kind = '';
    const know = !!(g.invasion && g.invasion.knowsPlayer && g.invasion.knowsPlayer()), prov = this.alarm > 3;
    if (hostile && dp < (prov || know ? 600 : 320) && (this.personal || prov || know || this.sees(P, dp))) { seen = true; tgt = P.pos; kind = 'player'; this.mem.copy(P.pos); this.lostT = 0; }
    else if (!this.personal) { this.civT -= dt; if (this.civT <= 0) { this.civT = 0.6; this.civ = g.invasion ? g.invasion.nearestCivilian(p.x, p.z, 34) : null; } const c = this.civ; if (c && !c.dead && Math.hypot(c.x - p.x, c.z - p.z) < 38) { seen = true; kind = 'civ'; this.civTgt = this.civTgt || new THREE.Vector3(); tgt = this.civTgt.set(c.x, c.y + 1, c.z); } }
    if (seen && this.st !== 'chase') { this.st = 'chase'; this.stT = 0; if (kind === 'player' && g.invasion) g.invasion.alarmNear(p.x, p.z, 38); }
    if (!seen && this.st === 'chase') { this.lostT = (this.lostT || 0) + dt; if (this.lostT > 4) { this.st = 'search'; this.stT = 0; } }
    if (this.st === 'search' && this.stT > 4) { this.st = 'patrol'; this.stT = 0; }
    // ---- steering target
    const gy = g.world.groundAt(p.x, p.z, p.y + 2, 4, 0.5); let wx, wy, wz, sp = 5;
    if (this.st === 'chase' && tgt) {
      this.orb += dt * (0.7 + 0.3 * Math.sin(this.t)); const want = kind === 'player' ? 16 : 12, tx = tgt.x, tz = tgt.z, dx0 = p.x - tx, dz0 = p.z - tz, dl0 = Math.hypot(dx0, dz0) || 1, ox = Math.cos(this.orb) * want, oz = Math.sin(this.orb) * want;
      wx = tx + ox * 0.7 + dx0 / dl0 * want * 0.3; wz = tz + oz * 0.7 + dz0 / dl0 * want * 0.3; wy = Math.max(gy + 6, (kind === 'player' ? P.pos.y : gy) + 5 + 2 * Math.sin(this.t * 1.7)); sp = 12;
      this.jinkT -= dt; if (this.jinkT <= 0) { this.jinkT = rand(0.9, 2.2); const a = rand(0, 6.28); this.vel.x += Math.cos(a) * 7; this.vel.z += Math.sin(a) * 7; this.vel.y += rand(-2, 3); }       // dodging jink
      this.face(tgt.x, tgt.z, dt);
      if (this.fireCool <= 0 && seen && dp > 5 && (kind === 'civ' || hostile)) { this.flash = 0.4; this.fireCool = rand(1.4, 2.3); this.shotQ = 0.4; this.shotKind = kind; this.shotTgt = tgt; }
    } else if (this.st === 'search') { wx = this.mem.x + Math.cos(this.t * 0.8) * 8; wz = this.mem.z + Math.sin(this.t * 0.8) * 8; wy = gy + 9; sp = 7; }
    else { this.orb += dt * 0.25; wx = this.cx + Math.cos(this.orb) * 22; wz = this.cz + Math.sin(this.orb) * 22; wy = gy + 12 + 2 * Math.sin(this.t * 0.9); sp = 6; }
    if (this.shotQ > 0) { this.shotQ -= dt; if (this.shotQ <= 0) this.fireShot(this.shotTgt, this.shotKind); }
    const dx = wx - p.x, dy = wy - p.y, dz = wz - p.z, dl = Math.hypot(dx, dy, dz) || 1, k = 1 - Math.exp(-2.4 * dt), vmax = Math.min(sp, dl * 2);
    this.vel.x += (dx / dl * vmax - this.vel.x) * k; this.vel.y += (dy / dl * vmax - this.vel.y) * k; this.vel.z += (dz / dl * vmax - this.vel.z) * k;
    // ---- obstacles: look ahead for a wall / roof and climb; never go under the ground
    this.rayT -= dt; if (this.rayT <= 0) { this.rayT = 0.14; const sp2 = Math.hypot(this.vel.x, this.vel.z); if (sp2 > 1) { _a.copy(p); _b.set(this.vel.x / sp2, 0, this.vel.z / sp2); if (g.world.raySolid(_a, _b, 7)) this.climb = 0.7; } }
    if (this.climb > 0) { this.climb -= dt; this.vel.y += 14 * dt; }
    p.addScaledVector(this.vel, dt); if (p.y < gy + 2.2) { p.y = gy + 2.2; if (this.vel.y < 0) this.vel.y = 0; }
    this.home.set(p.x, p.y - this.air, p.z); this.speed = Math.hypot(this.vel.x, this.vel.z);
    // ---- visuals
    this.tiltV.x += ((this.vel.z * 0.03 - this.tilt.x) * 40 - this.tiltV.x * 6) * dt; this.tiltV.y += ((-this.vel.x * 0.03 - this.tilt.y) * 40 - this.tiltV.y * 6) * dt; this.tilt.x += this.tiltV.x * dt; this.tilt.y += this.tiltV.y * dt;
    this.body.rotation.x = clamp(this.tilt.x, -0.5, 0.5); this.body.rotation.z = clamp(this.tilt.y, -0.5, 0.5); this.body.position.y = Math.sin(this.t * 3.1) * 0.08;
    for (const r of this.rotors) r.rotation.z += dt * 40; this.flash = Math.max(0, this.flash - dt); this.hitFlash = Math.max(0, (this.hitFlash || 0) - dt);
    this.eyeM.emissiveIntensity = 1.6 + this.flash * 8 + (this.st === 'chase' ? 1 : 0); this.bodyM.emissive.setRGB(this.hitFlash * 4, this.hitFlash * 2, this.hitFlash * 2);
    if (Math.random() < dt * 25) g.fx.glow.emit({ pos: _c.set(p.x, p.y - 0.45, p.z).clone(), vel: _b.set(rand(-0.3, 0.3), -1.5, rand(-0.3, 0.3)).clone(), size: 0.35, life: 0.25, drag: 1, color: [1, 0.25, 0.1], alpha: 0.7 });
    this.bar.visible = this.hp < this.maxHp; this.root.position.copy(p); this.root.updateMatrixWorld(true);
  }
  face(x, z, dt) { const want = Math.atan2(x - this.pos.x, z - this.pos.z); this.root.rotation.y += angleDelta(this.root.rotation.y, want) * (1 - Math.exp(-8 * dt)); }
  fireShot(tgt, kind) {
    const g = this.g, o = _c.copy(this.pos); o.x += Math.sin(this.root.rotation.y) * 0.5; o.z += Math.cos(this.root.rotation.y) * 0.5; if (!tgt) return;
    const hs = kind === 'player' && g.player.hitSphere; const dir = _b.set(tgt.x + rand(-0.5, 0.5), (kind === 'player' ? tgt.y + (hs ? hs.y : 1.3) : tgt.y) + rand(-0.3, 0.3), tgt.z + rand(-0.5, 0.5)).sub(o).normalize();
    g.enemies.spawnBolt(o.clone(), dir.clone(), this, 'enemy', { dmgP: 8, kb: 2.2, speed: 29, scale: 0.6, red: true }); g.fx.glow.emit({ pos: o.clone(), size: 0.9, life: 0.1, drag: 0, color: [1, 0.2, 0.1] }); g.sfx.zap(0.1);
    if (kind === 'civ' && g.invasion && this.civ) g.invasion.hitCivilian(this.civ, 0.5);
  }
  respawn() { /* the manager owns the lifecycle */ }
}

// ======================================================================================================== manager
export class InvasionForce {
  constructor(game) {
    this.g = game; this.bots = []; this.drones = []; this.built = false; this.t = 0; this.waveT = INV.firstWave; this.scanT = 0; this.stats = { deployed: 0, defeated: 0, waves: 0, personalSpawned: 0 }; this.active = false; this.personalT = 0;
  }
  /** build the pools (once) */
  build() {
    if (this.built) return; this.built = true; const g = this.g;
    for (let i = 0; i < INV.maxDrone; i++) this.drones.push(new InvDrone(g.scene, g.world, g));
    const mk = (cls, n) => { for (let i = 0; i < n; i++) this.bots.push(new InvRobot(g.scene, g.world, g, cls)); };
    mk('std', INV.maxStd); mk('heavy', INV.maxHeavy); mk('giant', INV.maxGiant);
    for (const b of this.bots) b.park(); for (const d of this.drones) d.park();
  }
  all() { return this.bots.concat(this.drones); }
  alive() { return this.all().filter(b => b.present); }
  count(cls) { return (cls === 'drone' ? this.drones : this.bots.filter(b => b.cls === cls)).filter(b => !b.parked).length; }
  cap(cls) { return { drone: INV.maxDrone, std: INV.maxStd, heavy: INV.maxHeavy, giant: INV.maxGiant }[cls]; }
  freeOne(cls) { return (cls === 'drone' ? this.drones : this.bots.filter(b => b.cls === cls)).find(b => b.parked); }
  /** a valid, open landing spot: a city sidewalk node 45-260 m from the player (or near the city centre), never inside a building */
  groundSpot(cityOnly = true) {
    const g = this.g, P = g.player, civ = g.civ; if (!civ || !civ.nodes) return null;
    const ok = n => (!cityOnly || n.reg === 'city'), dist = n => Math.hypot(n.x - P.pos.x, n.z - P.pos.z);
    let pool = civ.nodes.filter(n => ok(n) && dist(n) > 45 && dist(n) < 260); if (!pool.length) pool = civ.nodes.filter(n => ok(n) && Math.hypot(n.x + 278, n.z + 22) < 200 && dist(n) > 30); if (!pool.length) return null;
    for (let k = 0; k < 8; k++) { const n = pool[Math.floor(Math.random() * pool.length)], x = n.x + rand(-1.5, 1.5), z = n.z + rand(-1.5, 1.5), w = g.world; if (w.staticsIn && w.staticsIn(x - 2, z - 2, x + 2, z + 2).some(b => b.max.y > w.terrain.height(x, z) + 0.6)) continue; return { x, z }; }
    return null;
  }
  deployOne(cls, o = {}) {
    const g = this.g, inv = g.invasion; if (this.count(cls) >= this.cap(cls)) return null; const b = this.freeOne(cls); if (!b) return null;
    if (cls === 'drone') {
      const s = o.at || this.groundSpot(false) || { x: -278, z: -22 }, sp = inv && inv.ship ? inv.ship.pos : null;
      const sx = sp ? sp.x + rand(-100, 100) : s.x, sz = sp ? sp.z + rand(-170, 170) : s.z, sy = sp ? sp.y - 50 : 150;
      b.deploy(sx, sy, sz, { fromShip: true, cx: s.x, cz: s.z, personal: o.personal }); this.stats.deployed++; return b;
    }
    const s = o.at || this.groundSpot(true); if (!s) return null; b.deploy(s.x, s.z, { descend: o.descend !== false, personal: o.personal }); this.stats.deployed++;
    if (o.descend !== false && inv && inv.ship) { const sp = inv.ship.pos; g.fx.glow.emit({ pos: _a.set(sp.x + (s.x - sp.x) * 0.1, sp.y - 45, sp.z + (s.z - sp.z) * 0.1).clone(), size: 14, life: 0.5, drag: 0, color: [0.3, 1, 0.45] }); }
    return b;
  }
  pickClass() { const W = INV.weights; let r = Math.random(), best = null; const order = ['drone', 'std', 'heavy', 'giant']; for (const c of order) { r -= W[c]; if (r <= 0) { best = c; break; } } best = best || 'drone'; for (let k = 0; k < 4 && this.count(best) >= this.cap(best); k++) best = order[(order.indexOf(best) + 1) % 4]; return best; }
  deployWave() {
    this.stats.waves++; const n = 1 + (Math.random() < 0.55 ? 1 : 0) + (Math.random() < 0.25 ? 1 : 0);
    for (let i = 0; i < n; i++) { const cls = this.pickClass(); if (this.count(cls) < this.cap(cls)) this.deployOne(cls); }
  }
  /** Vilgax's escort: robots that always know where the player is; topped up to INV.maxPersonal while he lives */
  escort(at, n) {
    for (let i = 0; i < n; i++) {
      const cls = i === 0 ? 'heavy' : i === 3 ? 'giant' : i % 2 ? 'std' : 'drone', a = rand(0, 6.28), r = rand(8, 20), spot = { x: at.x + Math.cos(a) * r, z: at.z + Math.sin(a) * r };
      const b = this.deployOne(cls, { at: spot, personal: true, descend: true }); if (b) this.stats.personalSpawned++;
    }
  }
  personalAlive() { return this.all().filter(b => b.present && b.personal).length; }
  clear() { for (const b of this.all()) if (!b.parked) b.park(); this.waveT = INV.firstWave; }
  update(dt, mode) {
    // mode: { active: bool (deploy waves), centre: {x,z}, escortAt?: {x,z} }
    if (!this.built) return; this.t += dt; const g = this.g, P = g.player;
    for (const b of this.bots) if (!b.parked && b.dead) { b.deadAge += dt; if (!b.deathFX) { b.deathFX = true; this.defeatFX(b); } if (b.deadAge > 3.5) { b.park(); this.stats.defeated++; } }
    this.scanT -= dt; if (this.scanT <= 0) {
      this.scanT = 0.8; const cx = mode.centre.x, cz = mode.centre.z, far = Math.hypot(P.pos.x - cx, P.pos.z - cz);
      for (const b of this.bots) if (!b.parked && !b.dead && !b.personal && Math.hypot(b.home.x - P.pos.x, b.home.z - P.pos.z) > INV.sleepR) b.park();
      for (const d of this.drones) if (!d.parked && !d.dead && !d.personal && Math.hypot(d.pos.x - P.pos.x, d.pos.z - P.pos.z) > INV.sleepR) d.park();
      this.near = far < INV.activeR;
    }
    if (mode.active && this.near) { this.waveT -= dt; if (this.waveT <= 0) { this.waveT = rand(INV.waveMin, INV.waveMax); this.deployWave(); } }
    this.personalT -= dt; if (mode.escortAt && this.personalT <= 0) { this.personalT = 25; const need = INV.maxPersonal - this.personalAlive(); if (need > 0) this.escort(mode.escortAt, Math.min(need, 2)); }
    this.panicT = (this.panicT || 0) - dt; if (this.panicT <= 0 && g.world.danger) { this.panicT = 0.5; let k = 0; for (const b of this.alive()) { const p = b.isDrone ? b.pos : b.home; if (Math.hypot(p.x - P.pos.x, p.z - P.pos.z) > 170) continue; g.world.danger(p.x, p.z, b.isDrone ? 16 : 14 + 4 * (b.C ? b.C.scale : 1), 1); if (++k >= 8) break; } }
  }
  defeatFX(b) {
    const g = this.g, c = b.root.position, S = b.C ? b.C.scale : 1; for (let i = 0; i < 14; i++) g.fx.glow.emit({ pos: _a.set(c.x, c.y + 1.2 * S, c.z).clone(), vel: new THREE.Vector3(rand(-1, 1), rand(0.3, 1.4), rand(-1, 1)).normalize().multiplyScalar(rand(2, 7) * S), size: rand(0.2, 0.5) * S, life: rand(0.4, 0.9), drag: 1.6, color: [1, 0.35, 0.12] });
    g.fire.burst(_a.set(c.x, c.y + 1 * S, c.z).clone(), Math.round(8 * S), 5 * S, 0.8 * S, 0.5, 0.5); g.fire.smoke(_a.set(c.x, c.y + 1 * S, c.z).clone(), _b.set(0, 1.5, 0), 1.4 * S, 1.6); g.sfx.crash && g.sfx.crash(0.2 + 0.1 * S);
  }
}
