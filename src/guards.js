// Guards: the game's first LIVING enemies. Training dummies and turrets never needed a mind, but Ghostfreak's stealth and possession are about minds, so these exist:
// a sentry with a stun baton (melee) and a blaster (the same slow orange bolts the turrets fire). They extend Dummy, so every earlier alien can hit, shove, launch, grab and
// throw them exactly like a dummy - only their AI is new.
//   idle  -> stands his post, sweeps his gaze            chase  -> spotted the player: closes in, shoots at range, batons up close
//   search-> went to where he LAST saw the player, looks around         return -> walks back to his post
// Detection goes through Stealth (src/stealth.js): an invisible player is only noticed from ~1.7 m, and a guard that loses him walks to the last place he saw him.
// A guard under Ghostfreak's control (`possessed`) skips the AI entirely; it moves from `ctrl` and can only do what it already can: walk / run, baton, blaster.
import * as THREE from 'three';
import { Dummy } from './dummies.js';
import { clamp, damp, lerp, angleDelta, rand, easeOutCubic } from './util.js';
import { CLOSE } from './stealth.js';
import { attackImpact } from './impact.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
export const GUARD = { hp: 130, walk: 3.0, run: 5.8, sight: 20, alertSight: 28, melee: 2.1, shotMin: 5.5, shotMax: 26, baton: 16, respawn: 7, radius: 0.55, height: 2.2 };
const sm = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
let TEX = null;
function tags() {
  if (TEX) return TEX;
  const mk = (txt, col) => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); x.fillStyle = 'rgba(0,0,0,.6)'; x.beginPath(); x.arc(32, 32, 29, 0, 7); x.fill(); x.strokeStyle = col; x.lineWidth = 3; x.stroke(); x.fillStyle = col; x.font = 'bold 42px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(txt, 32, 35); return new THREE.CanvasTexture(c); };
  return (TEX = { '!': mk('!', '#ff5040'), '?': mk('?', '#ffd24a') });
}

export class Guard extends Dummy {
  constructor(scene, world, pos, yaw, game, name = 'GUARD') {
    super(scene, world, pos, yaw, name);
    this.g = game; this.name = name; this.isGuard = true; this.maxHp = this.hp = GUARD.hp;
    this.root.traverse(o => { if (o.isMesh) o.visible = false; });                  // the mannequin Dummy builds is replaced by the guard model below
    this.collider.r = GUARD.radius; this.collider.h = GUARD.height;
    this.spheres = [{ local: new THREE.Vector3(0, 0.55, 0), r: 0.46 }, { local: new THREE.Vector3(0, 1.05, 0), r: 0.5 }, { local: new THREE.Vector3(0, 1.55, 0), r: 0.5 }, { local: new THREE.Vector3(0, 2.0, 0), r: 0.3 }];
    this.bar.position.set(0, 2.62, 0); this.drawBar();
    this.post = pos.clone(); this.postYaw = yaw; this.yaw = yaw; this.st = 'idle'; this.stT = 0; this.alert = 0; this.stun = 0; this.fireCool = rand(1, 2); this.batCool = 0; this.atk = null;
    this.mem = pos.clone(); this.possessed = false; this.frozen = false; this.rogue = 0; this.speed = 0; this.vx = 0; this.vz = 0; this.look = 0;
    this.ctrl = { mx: 0, my: 0, run: false, yaw: 0, aimYaw: null }; this.an = { t: rand(0, 6), ph: 0, mv: 0, aura: 0 }; this.stats = { spotted: 0, batons: 0, shots: 0, hitsTaken: 0 };
    this.buildModel();
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tags()['!'], transparent: true, depthWrite: false, depthTest: false })); this.tag.scale.set(0.6, 0.6, 1); this.tag.position.set(0, 3.15, 0); this.tag.visible = false; this.tag.renderOrder = 15; this.root.add(this.tag);
    this.mats = [this.suitM, this.armorM];
  }
  buildModel() {
    const B = this.body, M = (c, r = 0.55, m = 0.4, e) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, ...(e ? { emissive: e, emissiveIntensity: 1.2 } : {}) });
    this.suitM = M(0x2d343b, 0.6, 0.35); this.armorM = M(0x4a545e, 0.45, 0.6); this.trimM = M(0xc2432d, 0.6, 0.3); this.blackM = M(0x15191d, 0.7, 0.2); this.visorM = M(0x1a0d05, 0.3, 0.2, 0xff8a1a); this.tipM = M(0x301005, 0.4, 0.2, 0xff6a1f);
    const add = (par, geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; par.add(m); return m; };
    this.legs = [-1, 1].map(s => { const g = new THREE.Group(); g.position.set(s * 0.16, 0.98, 0); B.add(g); add(g, new THREE.CapsuleGeometry(0.115, 0.6, 4, 10), this.suitM, 0, -0.42, 0); add(g, new THREE.BoxGeometry(0.2, 0.12, 0.34), this.blackM, 0, -0.92, 0.06); add(g, new THREE.BoxGeometry(0.17, 0.2, 0.12), this.armorM, 0, -0.6, 0.1); return g; });
    add(B, new THREE.BoxGeometry(0.52, 0.2, 0.3), this.blackM, 0, 1.03, 0);
    this.torso = new THREE.Group(); this.torso.position.set(0, 1.1, 0); B.add(this.torso);
    add(this.torso, new THREE.CapsuleGeometry(0.27, 0.34, 4, 12), this.suitM, 0, 0.32, 0).scale.set(1.1, 1, 0.8);
    add(this.torso, new THREE.BoxGeometry(0.62, 0.46, 0.34), this.armorM, 0, 0.42, 0.04); add(this.torso, new THREE.BoxGeometry(0.64, 0.08, 0.36), this.trimM, 0, 0.6, 0.04); add(this.torso, new THREE.BoxGeometry(0.2, 0.2, 0.05), this.trimM, 0, 0.36, 0.23);
    this.head = new THREE.Group(); this.head.position.set(0, 0.95, 0); this.torso.add(this.head);
    add(this.head, new THREE.SphereGeometry(0.21, 18, 14), this.blackM, 0, 0, 0);
    add(this.head, new THREE.SphereGeometry(0.245, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), this.armorM, 0, 0.02, -0.01);
    add(this.head, new THREE.BoxGeometry(0.34, 0.09, 0.12), this.visorM, 0, 0.0, 0.16);
    this.arms = [-1, 1].map(s => { const g = new THREE.Group(); g.position.set(s * 0.4, 0.62, 0); this.torso.add(g); add(g, new THREE.CapsuleGeometry(0.085, 0.56, 4, 10), this.suitM, 0, -0.32, 0); add(g, new THREE.SphereGeometry(0.14, 12, 10), this.armorM, 0, 0, 0); add(g, new THREE.SphereGeometry(0.1, 10, 8), this.blackM, 0, -0.68, 0); return g; });
    add(this.arms[0], new THREE.CylinderGeometry(0.04, 0.04, 0.78, 8), this.blackM, 0, -1.05, 0); add(this.arms[0], new THREE.CylinderGeometry(0.052, 0.052, 0.16, 8), this.tipM, 0, -1.42, 0);       // stun baton (right hand)
    add(this.arms[1], new THREE.BoxGeometry(0.11, 0.4, 0.15), this.blackM, 0, -0.9, 0); add(this.arms[1], new THREE.BoxGeometry(0.06, 0.1, 0.06), this.tipM, 0, -1.12, 0);                            // sidearm (left hand): barrel points along the forearm
  }

  // ------------------------------------------------------------------------------------------------------------------ perception
  get hostileActive() { return this.g.enemies.enabled; }
  sees(P, d) {
    const g = this.g, S = g.stealth; if (S.gf && S.gf.possessing) return false;     // the "player" is inside a host: nobody has anything to look at
    const range = S.hidden ? CLOSE : (this.st === 'chase' ? GUARD.alertSight : GUARD.sight) * (P.stealthSize ?? 1);   // a tiny player is harder to spot
    if (d > range) return false; if (S.hidden) return true;                          // invisible: noticed only when practically touching him
    const h = this.home, dx = P.pos.x - h.x, dz = P.pos.z - h.z, dot = d > 1e-3 ? (dx * Math.sin(this.yaw) + dz * Math.cos(this.yaw)) / d : 1;
    if (d > 3.5 && dot < 0.15 && this.st === 'idle') return false;                  // sentries only look ahead (±80 deg) until they are alerted
    _a.set(h.x, this.root.position.y + 1.85, h.z); _b.set(P.pos.x, P.pos.y + (P.sightY ?? 1.3), P.pos.z).sub(_a); const L = _b.length(); if (L < 1e-3) return true; _b.multiplyScalar(1 / L);
    return !g.world.raySolid(_a, _b, L - 0.3);
  }

  // ------------------------------------------------------------------------------------------------------------------ movement
  step(dx, dz, speed, dt) {
    const h = this.home; speed *= (this.slimeMul ?? 1); h.x += dx * speed * dt; h.z += dz * speed * dt;
    this.collider.dead = true; this.world.resolveXZ(h, GUARD.radius, 0, GUARD.height, 0.3); this.collider.dead = this.dead;
    h.x = clamp(h.x, -33, 33); h.z = clamp(h.z, -33, 33);
  }
  face(x, z, k, dt) { this.yaw += angleDelta(this.yaw, Math.atan2(x - this.home.x, z - this.home.z)) * (1 - Math.exp(-k * dt)); }
  goTo(p, speed, dt, k = 9) { const dx = p.x - this.home.x, dz = p.z - this.home.z, d = Math.hypot(dx, dz); if (d < 0.05) return 0; const s = Math.min(speed, d / Math.max(dt, 1e-3)); this.step(dx / d, dz / d, s, dt); this.face(p.x, p.z, k, dt); this.speed = s; return d; }

  // ------------------------------------------------------------------------------------------------------------------ AI (world time)
  ai(dt) {
    const g = this.g, h = this.home, P = g.player; this.speed = 0;
    const sm = this.slimeMul ?? 1; this.stun = Math.max(0, this.stun - dt); this.fireCool -= dt * sm; this.batCool -= dt * sm; this.rogue = Math.max(0, this.rogue - dt); this.alert = Math.max(0, this.alert - dt);
    if (this.stun > 0 || this.held || this.air > 0.02) { if (!this.possessed) this.atk = null; this.vx = this.vz = 0; return; }
    if (this.frozen) return;
    if (this.slimeStuck && !this.possessed) { this.atk = null; this.vx = this.vz = 0; this.speed = 0; this.face(P.pos.x, P.pos.z, 3, dt); return; }       // stuck in slime: can only turn on the spot (no move, no attack)
    if (this.possessed) { this.drive(dt); return; }
    let tgt = null, kind = '', d = 99, seen = false;
    if (this.hostileActive) { d = Math.hypot(P.pos.x - h.x, P.pos.z - h.z); if (this.sees(P, d)) { seen = true; tgt = P.pos; kind = 'player'; this.mem.copy(P.pos); this.mem.x = clamp(this.mem.x, -32.5, 32.5); this.mem.z = clamp(this.mem.z, -32.5, 32.5); this.lostT = 0; } }
    if (!seen && this.hostileActive) for (const o of g.guards) {                           // a possessed guard that has attacked is treated as hostile by the others
      if (o === this || !o.possessed || o.rogue <= 0 || o.dead) continue; const op = o.root.position; d = Math.hypot(op.x - h.x, op.z - h.z); if (d > 17) continue;
      _a.set(h.x, h.y + 1.85, h.z); _b.set(op.x, op.y + 1.3, op.z).sub(_a); const L = _b.length(); _b.multiplyScalar(1 / L); if (g.world.raySolid(_a, _b, L - 0.3)) continue;
      seen = true; tgt = op; kind = 'rogue'; this.mem.copy(op); break;
    }
    if (seen && (this.st === 'idle' || this.st === 'search' || this.st === 'return')) { this.st = 'chase'; this.stT = 0; this.alert = 0.4; this.stats.spotted++; if (kind === 'player') g.sfx.beep(false); }
    if (!seen && this.st === 'chase' && this.stT > 0.01) { /* lost him: handled below */ }
    this.stT += dt;
    if (this.st === 'idle') {
      const want = this.postYaw + Math.sin(this.an.t * 0.55) * 0.75; this.yaw += angleDelta(this.yaw, want) * (1 - Math.exp(-2.2 * dt));
    } else if (this.st === 'chase') {
      if (this.alert > 0) { if (tgt) this.face(tgt.x, tgt.z, 12, dt); }
      else if (seen) {
        this.face(tgt.x, tgt.z, 11, dt);
        if (this.atk) this.updateAtk(dt, kind === 'player' ? P : null, tgt);
        else if (d < GUARD.melee + 0.35 && this.batCool <= 0) this.startBaton();
        else if (kind === 'player' && d > GUARD.shotMin && d < GUARD.shotMax && this.fireCool <= 0 && g.enemies.enabled) this.startShot(tgt);
        else if (d > GUARD.melee - 0.2) this.goTo(tgt, GUARD.run, dt, 11);
      } else {
        this.atk = null; this.lostT = (this.lostT || 0) + dt;
        if (this.goTo(this.mem, GUARD.run * 0.8, dt) < 1.1 || this.lostT > 7) { this.st = 'search'; this.stT = 0; this.lostT = 0; g.stealth.stats.lostTrack++; }
      }
    } else if (this.st === 'search') {
      this.yaw += angleDelta(this.yaw, this.yaw + Math.sin(this.stT * 1.5) * 0.6) * 0.2; this.yaw += Math.sin(this.stT * 1.6) * dt * 1.1;
      if (this.stT > 3.8) { this.st = 'return'; this.stT = 0; }
    } else if (this.st === 'return') {
      if (this.goTo(this.post, GUARD.walk, dt, 6) < 0.25) { this.st = 'idle'; this.stT = 0; }
    }
    if (this.atk && this.st !== 'chase') this.atk = null;
  }
  /** under Ghostfreak's control: walk / run from the camera-relative stick, attacks start from the possessor's buttons */
  drive(dt) {
    const c = this.ctrl, h = this.home, fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw), rx = Math.cos(c.yaw), rz = -Math.sin(c.yaw);
    let wx = fx * c.my + rx * c.mx, wz = fz * c.my + rz * c.mx; const L = Math.hypot(wx, wz); if (L > 1) { wx /= L; wz /= L; }
    const top = (c.run ? GUARD.run : GUARD.walk) * (this.atk ? 0.3 : 1), tx = wx * top, tz = wz * top, k = 1 - Math.exp(-14 * dt);
    this.vx += (tx - this.vx) * k; this.vz += (tz - this.vz) * k; const s = Math.hypot(this.vx, this.vz);
    if (s > 0.02) this.step(this.vx / s, this.vz / s, s, dt); this.speed = s;
    if (this.atk && c.aimYaw !== null) this.yaw += angleDelta(this.yaw, c.aimYaw) * (1 - Math.exp(-16 * dt));
    else if (s > 0.4) this.yaw += angleDelta(this.yaw, Math.atan2(this.vx, this.vz)) * (1 - Math.exp(-10 * dt));
    if (this.q) {                                                                    // a button pressed during the tail of the previous attack is remembered for 0.4 s
      this.q.t -= dt; if (!this.atk) { const q = this.q; this.q = null; if (q.kind === 'baton') this.startBaton(); else this.startShot(q.aim); } else if (this.q.t <= 0) this.q = null;
    }
    this.updateAtk(dt, null, null);
  }
  queue(kind, aim) { this.q = { kind, aim: aim ? aim.clone() : null, t: 0.4 }; }

  // ------------------------------------------------------------------------------------------------------------------ attacks (its own: baton + blaster)
  startBaton() { if (this.atk || this.dead) return false; this.atk = { kind: 'baton', t: 0, windup: 0.36, strike: 0.14, rec: 0.42, hit: new Set(), done: false }; this.stats.batons++; if (this.possessed) this.rogue = 8; return true; }
  startShot(aim) { if (this.atk || this.dead || this.fireCool > 0) return false; this.atk = { kind: 'shot', t: 0, windup: 0.5, rec: 0.35, done: false, aim: aim ? aim.clone() : null }; this.stats.shots++; if (this.possessed) this.rogue = 8; return true; }
  updateAtk(dt, P, tgt) {
    const a = this.atk; if (!a) return; a.t += dt * (this.slimeMul ?? 1);
    if (a.kind === 'baton') {
      if (a.t >= a.windup && a.t < a.windup + a.strike + 0.06) this.batonContact(a, P, tgt);
      if (a.t >= a.windup + a.strike + 0.12 + a.rec) { this.atk = null; this.batCool = this.possessed ? 0.25 : 0.8; }
    } else {
      if (!a.done && a.t >= a.windup) { a.done = true; this.fireBolt(a, P, tgt); }
      if (a.t >= a.windup + a.rec) { this.atk = null; this.fireCool = this.possessed ? 0.8 : rand(2.2, 3.1); }
    }
  }
  batonContact(a, P, tgt) {
    const g = this.g, root = this.root.position, sy = Math.sin(this.yaw), cy = Math.cos(this.yaw); const c = _c.set(root.x + sy * 1.3, root.y + 1.25, root.z + cy * 1.3), R = 0.95;
    if (!this.possessed && !a.done) {
      if (P && !P.ignoreHits) { const dx = P.pos.x - c.x, dz = P.pos.z - c.z, rr = R + (P.rad ?? 0.5); if (dx * dx + dz * dz < rr * rr && c.y > P.pos.y - 0.4 && c.y < P.pos.y + (P.colH ?? 2.3) + (P.batonReach ?? 0.4)) { a.done = true; const dir = _b.set(dx, 0, dz).normalize().clone(); g.sfx.hit(false); g.impact.hitPlayer(attackImpact({ damage: GUARD.baton, knockbackForce: 8, staggerDuration: 0.3, ordinary: true, point: c.clone(), dir, quiet: true, src: this })); } }
      else if (!P && tgt && tgt.isVector3) { for (const o of g.guards) { if (o === this || !o.possessed || o.dead || a.hit.has(o)) continue; if (this.touch(o, c, R)) { a.hit.add(o); a.done = true; this.strike(o, c, 10, 7); } } }
      return;
    }
    if (this.possessed) for (const h of g.world.hittables) { if (h === this || h.dead || h.held || a.hit.has(h) || !h.root) continue; if (this.touch(h, c, R)) { a.hit.add(h); this.strike(h, c, GUARD.baton * 1.1, 8, true); } }
  }
  touch(h, c, r) { const hp = h.root.position, col = h.collider, rr = (col ? col.r : 0.6) + r, hh = col ? col.h : 2.2, dx = hp.x - c.x, dz = hp.z - c.z; return dx * dx + dz * dz < rr * rr && c.y > hp.y - r && c.y < hp.y + hh + r; }
  strike(h, c, dmg, kb, hud = false) {
    const g = this.g, hp = h.root.position, dir = new THREE.Vector3(hp.x - this.root.position.x, 0, hp.z - this.root.position.z); if (dir.lengthSq() < 1e-4) dir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); dir.normalize();
    h.applyHit(c.clone(), dir.clone(), dmg); if (h.shove) h.shove(dir, kb); if (h.launch) h.launch(0.7); if (hud) g.hud.hit(c.clone(), Math.round(dmg), h); g.sfx.hit(false); g.camera.addTrauma(this.possessed ? 0.12 : 0.05);
    for (let i = 0; i < 5; i++) g.fx.glow.emit({ pos: c, vel: _a.set(rand(-1, 1), rand(0, 1), rand(-1, 1)).normalize().multiplyScalar(rand(2, 5)).clone(), size: rand(0.12, 0.25), life: 0.25, drag: 2, color: [1, 0.6, 0.25] });
  }
  muzzle(out) { return out.set(this.root.position.x + Math.sin(this.yaw) * 0.75 + Math.cos(this.yaw) * 0.38, this.root.position.y + 1.45, this.root.position.z + Math.cos(this.yaw) * 0.75 - Math.sin(this.yaw) * 0.38); }
  fireBolt(a, P, tgt) {
    const g = this.g, o = this.muzzle(new THREE.Vector3()); let dir;
    if (this.possessed) { const aim = a.aim || _a.set(o.x + Math.sin(this.yaw) * 20, o.y, o.z + Math.cos(this.yaw) * 20); dir = _b.copy(aim).sub(o).normalize().clone(); }
    else { const t = tgt || P.pos, hs = P && P.hitSphere, sc = hs ? hs.r / 0.95 : 1; dir = _b.set(t.x + rand(-0.4, 0.4) * sc, (t.y || 0) + (hs ? hs.y : 1.3) + rand(-0.25, 0.25) * sc, t.z + rand(-0.4, 0.4) * sc).sub(o).normalize().clone(); }
    g.enemies.spawnBolt(o, dir, this, this.possessed ? 'player' : 'enemy');
    g.fx.glow.emit({ pos: o, size: 1.2, life: 0.12, drag: 0, color: [1, 0.7, 0.3] }); g.sfx.zap(0.18);
  }

  // ------------------------------------------------------------------------------------------------------------------ damage / lifecycle
  applyHit(point, dir, dmg) {
    const was = this.dead; super.applyHit(point, dir, dmg); this.stats.hitsTaken++;
    if (this.dead && !was) { this.respawnT = GUARD.respawn; this.atk = null; if (this.possessed && this.g.gf) this.g.gf.endPossession('host down'); return; }
    if (!this.dead && !this.possessed && !this.frozen) { this.stun = Math.max(this.stun, 0.32); this.atk = null; if (this.st === 'idle' || this.st === 'search' || this.st === 'return') { this.st = 'chase'; this.alert = 0.2; this.mem.copy(this.g.player.pos); } }
  }
  respawn() {
    if (this.possessed && this.g.gf) this.g.gf.endPossession('reset');
    super.respawn(); this.st = 'idle'; this.stT = 0; this.atk = null; this.q = null; this.stun = 0; this.alert = 0; this.frozen = false; this.possessed = false; this.rogue = 0; this.vx = this.vz = 0; this.yaw = this.postYaw; this.root.rotation.y = this.yaw; this.mem.copy(this.post); this.collider.r = GUARD.radius; this.collider.h = GUARD.height; this.fireCool = rand(1, 2);
  }
  /** Ghostfreak reaches the host: it locks up (no AI, no attacks) until he is inside */
  freeze(on) { this.frozen = on; if (on) { this.atk = null; this.vx = this.vz = 0; } }
  /** Ghostfreak leaves: the host staggers, then resumes normal AI (alert, looking for what hit it) */
  unpossess(stunT = 0.7) {
    this.possessed = false; this.frozen = false; this.atk = null; this.q = null; this.vx = this.vz = 0; this.stun = Math.max(this.stun, stunT); this.st = 'search'; this.stT = 0; this.mem.copy(this.home); this.fireCool = 1.5; this.batCool = 0.5;
    this.held = false; if (!this.dead) this.collider.dead = false;
  }

  // ------------------------------------------------------------------------------------------------------------------ per frame
  update(dt) {
    if (!this.dead) this.ai(dt);
    super.update(dt);
    this.root.rotation.y = this.yaw; this.animate(dt);
  }
  animate(dt) {
    const A = this.an; A.t += dt; const sp = this.speed; A.mv = damp(A.mv, clamp(sp / 4.5, 0, 1.3), 9, dt); A.ph += dt * (2.0 + sp * 1.9); const s = Math.sin(A.ph), mv = A.mv, a = this.atk;
    let rArm = -s * 0.85 * mv + 0.04 + Math.sin(A.t * 1.3) * 0.02, lArm = s * 0.85 * mv + 0.04, tX = 0.07 * mv, tY = 0, rZ = 0.07, lZ = -0.07, hx = 0, hy = 0;
    if (a && a.kind === 'baton') {
      const fin = a.windup + a.strike + 0.12;
      if (a.t < a.windup) { const u = sm(a.t / a.windup); rArm = lerp(rArm, -3.3, u); tX = lerp(tX, -0.2, u); tY = lerp(0, 0.5, u); }
      else if (a.t < fin) { const u = easeOutCubic((a.t - a.windup) / (a.strike + 0.12)); rArm = lerp(-3.3, -1.2, u); tX = lerp(-0.2, 0.4, u); tY = lerp(0.5, -0.55, u); }
      else { const u = clamp((a.t - fin) / a.rec, 0, 1); rArm = lerp(-1.2, 0.04, sm(u)); tX = lerp(0.4, 0.07, sm(u)); tY = lerp(-0.55, 0, sm(u)); }
    } else if (a && a.kind === 'shot') { const u = sm(a.t / (a.windup * 0.8)), r = a.t > a.windup ? clamp((a.t - a.windup) / a.rec, 0, 1) : 0, k = u * (1 - sm(r)); lArm = lerp(lArm, -1.5, k); lZ = lerp(lZ, 0.03, k); tY = lerp(tY, -0.22, k); tX = lerp(tX, 0.02, k); }
    const stunK = clamp(this.stun / 0.3, 0, 1); tX += 0.5 * stunK; hx += 0.3 * stunK; A.look = damp(A.look || 0, this.st === 'idle' ? Math.sin(A.t * 0.7) * 0.4 : this.st === 'search' ? Math.sin(A.t * 2.2) * 0.8 : 0, 4, dt);
    if (this.frozen) { tX += Math.sin(A.t * 38) * 0.04; tY += Math.sin(A.t * 31) * 0.05; }
    this.legs[0].rotation.x = s * 0.8 * mv; this.legs[1].rotation.x = -s * 0.8 * mv;
    this.arms[0].rotation.set(rArm, 0, -rZ); this.arms[1].rotation.set(lArm, 0, -lZ);
    this.torso.rotation.set(tX, tY, 0); this.head.rotation.set(hx, A.look - tY * 0.5, 0);
    this.body.position.y = Math.abs(Math.sin(A.ph)) * 0.05 * mv + (this.frozen ? Math.sin(A.t * 50) * 0.01 : 0);
    // visor tells you what it is doing
    const vm = this.visorM; let r = 1, gcol = 0.54, b = 0.1;
    if (this.possessed || this.frozen) { r = 0.6; gcol = 0.35; b = 1; } else if (this.stun > 0) { r = 0.25; gcol = 0.25; b = 0.25; } else if (this.st === 'chase') { r = 1; gcol = 0.12; b = 0.08; } else if (this.st === 'search') { r = 1; gcol = 0.85; b = 0.25; }
    vm.emissive.setRGB(r, gcol, b); vm.emissiveIntensity = this.dead ? 0 : 1.2 + (this.st === 'search' ? 0.6 * Math.sin(A.t * 8) : 0);
    this.tipM.emissiveIntensity = a && a.kind === 'baton' && a.t > a.windup * 0.6 ? 3 : 1.2;
    // alert tag ("!" when it has spotted something, "?" while it searches)
    const T = tags(), tagOn = !this.dead && !this.possessed && !this.frozen && ((this.st === 'chase' && this.alert > 0) || this.st === 'search'); this.tag.visible = tagOn; if (tagOn) { const m = this.alert > 0 || this.st === 'chase' ? T['!'] : T['?']; if (this.tag.material.map !== m) { this.tag.material.map = m; this.tag.material.needsUpdate = true; } this.tag.position.y = 3.15 + Math.sin(A.t * 6) * 0.05; }
    // possessed: faint violet wisps rising off the host (the only outward sign)
    if (this.possessed && !this.dead && Math.random() < dt * 14) this.g.fx.glow.emit({ pos: _a.set(this.root.position.x + rand(-0.3, 0.3), this.root.position.y + rand(0.4, 2.0), this.root.position.z + rand(-0.3, 0.3)), vel: _b.set(rand(-0.2, 0.2), rand(0.4, 1.0), rand(-0.2, 0.2)), size: rand(0.18, 0.34), life: 0.7, drag: 1, color: [0.62, 0.42, 1], alpha: 0.55 });
  }
}
