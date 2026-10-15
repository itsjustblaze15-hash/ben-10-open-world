// Way Big's world: a city district OUTSIDE the 72 m training arena (the arena itself is untouched - an 80 m giant simply steps over its walls).
//  - Buildings are a lattice of solid 6 x 5 x 6 m cells (one InstancedMesh). Every cell has its own hit points; a destroyed cell is gone from the lattice (collision, rays, rendering all use the live lattice),
//    and after every destruction a breadth-first support check from the ground cells makes anything no longer connected to the ground fall as pooled falling cells. Indestructible buildings only get an impact flash.
//  - District props (cars, trucks, street lights, trees, dumpsters, barrels) are ordinary PropSystem props (so Way Big can grab / throw / crush them); they are taken out of the PropSystem list while Way Big is not the active alien.
//  - Foes: small troopers + tanks (they shoot at him) and two GIANT enemies (Titan 34 m, Colossus 62 m) that walk, smash through buildings, punch back, and are knocked back according to their mass.
//  Nothing here exists for the other aliens: the whole district (buildings, props, foes) is hidden / dormant and not in any collision list while another alien is active, and it keeps its state (destroyed buildings stay destroyed).
import * as THREE from 'three';
import { Hittable } from './dummies.js';
import { clamp, rand, mulberry32, lerp, damp } from './util.js';

export const CELL = { x: 6, y: 5, z: 6 };
const CX = CELL.x, CY = CELL.y, CZ = CELL.z, NX = 160, NY = 28, NZ = 160, X0 = -480, Z0 = -480, CAP = 11000, PITCH = 66, LIMIT = 288;
const idxOf = (ix, iy, iz) => (iy * NZ + iz) * NX + ix;
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _c = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

function facadeTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#cfcfcf'; g.fillRect(0, 0, 256, 128);
  // left half: a facade bay (frame + window glass), right half: flat roof / floor concrete
  g.fillStyle = '#b9b9b6'; g.fillRect(128, 0, 128, 128);
  for (let i = 0; i < 700; i++) { const x = Math.random() * 256, y = Math.random() * 128, a = Math.random() * 0.06; g.fillStyle = `rgba(${Math.random() < 0.5 ? 0 : 255},${Math.random() < 0.5 ? 0 : 255},${Math.random() < 0.5 ? 0 : 255},${a})`; g.fillRect(x, y, 2, 2); }
  g.fillStyle = '#8a8a88'; g.fillRect(0, 0, 128, 4); g.fillRect(0, 124, 128, 4); g.fillRect(0, 0, 4, 128); g.fillRect(124, 0, 4, 128);
  const gr = g.createLinearGradient(0, 26, 0, 100); gr.addColorStop(0, '#2c3d4f'); gr.addColorStop(1, '#6a8398');
  g.fillStyle = '#6d6d6a'; g.fillRect(18, 22, 92, 82); g.fillStyle = gr; g.fillRect(24, 28, 80, 70);
  g.fillStyle = 'rgba(255,255,255,.18)'; g.beginPath(); g.moveTo(24, 98); g.lineTo(60, 28); g.lineTo(76, 28); g.lineTo(40, 98); g.fill();
  g.fillStyle = '#6d6d6a'; g.fillRect(62, 28, 4, 70);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function asphaltTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d'), P = 512, k = P / PITCH;
  g.fillStyle = '#3d3f42'; g.fillRect(0, 0, P, P);
  const img = g.getImageData(0, 0, P, P), d = img.data; for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 18; d[i] += n; d[i + 1] += n; d[i + 2] += n; } g.putImageData(img, 0, 0);
  // block (48 m) + 2 m kerb ring in the middle of the tile; roads are the tile border
  g.fillStyle = '#8d8d8a'; g.fillRect((PITCH / 2 - 25) * k, (PITCH / 2 - 25) * k, 50 * k, 50 * k);
  g.fillStyle = '#a5a5a1'; g.fillRect((PITCH / 2 - 24) * k, (PITCH / 2 - 24) * k, 48 * k, 48 * k);
  g.strokeStyle = '#d9b43a'; g.lineWidth = 1.3 * k; g.setLineDash([5 * k, 4 * k]);
  g.beginPath(); g.moveTo(0, 0); g.lineTo(P, 0); g.moveTo(0, P); g.lineTo(P, P); g.moveTo(0, 0); g.lineTo(0, P); g.moveTo(P, 0); g.lineTo(P, P); g.stroke();
  g.setLineDash([]); g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 0.6 * k; for (const o of [-6.5, 6.5]) { g.beginPath(); g.moveTo(0, o * k + 0); g.lineTo(P, o * k); g.moveTo(0, P + o * k); g.lineTo(P, P + o * k); g.moveTo(o * k, 0); g.lineTo(o * k, P); g.moveTo(P + o * k, 0); g.lineTo(P + o * k, P); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

// =============================================================================================================== foes
const FOES = {
  trooper:  { name: 'TROOPER',  h: 1.85, mass: 95,    hp: 24,   r: 0.5,  speed: 5.5, range: 220, fire: 0.7 },
  tank:     { name: 'TANK',     h: 3.2,  mass: 42000, hp: 380,  r: 3.7,  speed: 8.5, range: 330, fire: 3.2 },
  titan:    { name: 'TITAN',    h: 34,   mass: 2.0e5, hp: 1500, r: 7,    speed: 7.5, reach: 26, impulse: 1.2e7, dmg: 150 },
  colossus: { name: 'COLOSSUS', h: 62,   mass: 8.0e5, hp: 4200, r: 12,   speed: 5.5, reach: 44, impulse: 4.6e7, dmg: 320 },
};
const mat = (c, met = 0.5, r = 0.55, extra = {}) => new THREE.MeshStandardMaterial({ color: c, metalness: met, roughness: r, ...extra });
function bx(parent, w, h, d, m, x, y, z) { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; parent.add(o); return o; }
function pivot(parent, x, y, z) { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; }
/** blocky humanoid, built in metres from a height h (proportions are fractions of h) */
function buildRobot(h, c1, c2, eye, gun = false) {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body); const M1 = mat(c1, 0.55, 0.5), M2 = mat(c2, 0.6, 0.45), ME = new THREE.MeshStandardMaterial({ color: eye, emissive: eye, emissiveIntensity: 1.6 }); const P = {};
  P.torso = pivot(body, 0, 0.5 * h, 0); bx(P.torso, 0.3 * h, 0.3 * h, 0.17 * h, M1, 0, 0.17 * h, 0); bx(P.torso, 0.22 * h, 0.12 * h, 0.2 * h, M2, 0, 0.27 * h, 0); bx(P.torso, 0.1 * h, 0.07 * h, 0.02 * h, ME, 0, 0.16 * h, 0.095 * h);
  bx(body, 0.22 * h, 0.1 * h, 0.15 * h, M2, 0, 0.52 * h, 0);
  P.head = pivot(P.torso, 0, 0.33 * h, 0); bx(P.head, 0.13 * h, 0.12 * h, 0.12 * h, M2, 0, 0.05 * h, 0); bx(P.head, 0.1 * h, 0.03 * h, 0.02 * h, ME, 0, 0.06 * h, 0.065 * h);
  for (const s of [-1, 1]) {
    const k = s < 0 ? 'R' : 'L';
    P['leg' + k] = pivot(body, s * 0.085 * h, 0.5 * h, 0); bx(P['leg' + k], 0.11 * h, 0.26 * h, 0.12 * h, M1, 0, -0.13 * h, 0);
    P['shin' + k] = pivot(P['leg' + k], 0, -0.26 * h, 0); bx(P['shin' + k], 0.1 * h, 0.24 * h, 0.11 * h, M2, 0, -0.12 * h, 0); bx(P['shin' + k], 0.11 * h, 0.04 * h, 0.2 * h, M1, 0, -0.24 * h + 0.02 * h, 0.04 * h);
    P['arm' + k] = pivot(P.torso, s * 0.2 * h, 0.3 * h, 0); bx(P['arm' + k], 0.09 * h, 0.2 * h, 0.09 * h, M1, 0, -0.09 * h, 0);
    P['fore' + k] = pivot(P['arm' + k], 0, -0.2 * h, 0); bx(P['fore' + k], 0.085 * h, 0.2 * h, 0.085 * h, M2, 0, -0.09 * h, 0); bx(P['fore' + k], 0.11 * h, 0.1 * h, 0.11 * h, M1, 0, -0.22 * h, 0);
  }
  if (gun) bx(P.foreR, 0.04 * h, 0.04 * h, 0.5 * h, mat(0x222222, 0.6, 0.4), 0, -0.2 * h, 0.22 * h);
  root.userData.P = P; return root;
}
function buildTank() {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body); const M1 = mat(0x59623f, 0.4, 0.65), M2 = mat(0x2d3320, 0.5, 0.6), MT = mat(0x1b1b1b, 0.2, 0.9); const P = {};
  bx(body, 3.4, 1.0, 6.4, M1, 0, 1.0, 0); for (const s of [-1, 1]) { bx(body, 0.9, 1.1, 7.0, MT, s * 1.95, 0.6, 0); }
  P.turret = pivot(body, 0, 1.5, -0.3); bx(P.turret, 2.3, 0.85, 2.7, M1, 0, 0.4, 0); P.barrel = pivot(P.turret, 0, 0.45, 1.3); bx(P.barrel, 0.28, 0.28, 4.4, M2, 0, 0, 2.1);
  root.userData.P = P; return root;
}

export class WbFoe extends Hittable {
  constructor(D, kind, x, z, o = {}) {
    super(D.world); const T = FOES[kind]; this.D = D; this.g = D.g; this.type = kind; this.kind = 'foe'; this.cfg = T; this.name = T.name; this.h = T.h; this.mass = T.mass; this.maxHp = this.hp = T.hp; this.rad = T.r; this.giant = kind === 'titan' || kind === 'colossus';
    this.home = new THREE.Vector3(x, 0, z); this.yaw = o.yaw ?? 0; this.role = o.role || 'hold'; this.kv = new THREE.Vector3(); this.vy = 0; this.air = 0; this.deadT = 0; this.respawnT = 0; this.held = false; this.thrown = 0; this.thrownBy = null;
    this.atk = null; this.cd = rand(0.5, 2); this.phase = rand(0, 6); this.walk = 0; this.hitFlash = 0; this.smashT = 0; this.stagger = 0; this.fall = 0; this.alert = false; this.lastDir = new THREE.Vector3(0, 0, 1);
    const root = this.root = new THREE.Group(); root.position.copy(this.home); root.rotation.y = this.yaw; this.vis = kind === 'tank' ? buildTank() : kind === 'trooper' ? buildRobot(T.h, 0x4d5a3a, 0x2a2f24, 0xffc23a, true) : kind === 'titan' ? buildRobot(T.h, 0x9a5a2c, 0x3a2a22, 0xff7a2a) : buildRobot(T.h, 0x3b4048, 0x1b1d22, 0xff3030);
    root.add(this.vis); this.P = this.vis.userData.P; this.D.group.add(root);
    const h = T.h; this.spheres = this.giant ? [{ local: new THREE.Vector3(0, 0.62 * h, 0), r: 0.2 * h }, { local: new THREE.Vector3(0, 0.84 * h, 0), r: 0.11 * h }, { local: new THREE.Vector3(0, 0.45 * h, 0), r: 0.16 * h }, { local: new THREE.Vector3(0, 0.2 * h, 0), r: 0.14 * h }]
      : kind === 'tank' ? [{ local: new THREE.Vector3(0, 1.3, 0), r: 2.6 }] : [{ local: new THREE.Vector3(0, 0.55 * h, 0), r: 0.5 * h }];
    this.mats = []; this.vis.traverse(o => { if (o.isMesh && o.material.emissive !== undefined) { if (!this.mats.includes(o.material)) this.mats.push(o.material); } });
    const c = this.barCanvas = document.createElement('canvas'); c.width = 128; c.height = 16; this.barTex = new THREE.CanvasTexture(c);
    this.bar = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.barTex, transparent: true, depthWrite: false, depthTest: false })); this.bar.renderOrder = 30; const bw = this.giant ? 0.5 * h : Math.max(1.3, h * 0.9); this.bar.scale.set(bw, bw * 0.12, 1); this.bar.position.set(0, h * 1.12 + (this.giant ? 0 : 0.5), 0); root.add(this.bar); this.drawBar();
  }
  drawBar() { const g = this.barCanvas.getContext('2d'); g.clearRect(0, 0, 128, 16); g.fillStyle = 'rgba(0,0,0,.65)'; g.fillRect(0, 0, 128, 16); g.fillStyle = this.hp / this.maxHp > 0.35 ? '#ff9a3a' : '#ff4a3a'; g.fillRect(3, 3, 122 * clamp(this.hp / this.maxHp, 0, 1), 10); this.barTex.needsUpdate = true; }
  get pos() { return this.root.position; }
  /** Hittable interface (the other aliens' projectiles, props thrown at it...) */
  applyHit(point, dir, dmg) { this.hurt(dmg, dir, 0, null); }
  /** damage + an impulse (N s): the velocity change is impulse / (mass + 30 t), so a trooper flies, a tank slides, a Titan is pushed back by a heavy punch, a Colossus barely moves */
  hurt(dmg, dir, impulse = 0, by = null) {
    if (this.dead) return; this.hp = Math.max(0, this.hp - dmg); this.hitFlash = 0.16; this.drawBar(); this.alert = true; if (dir) this.lastDir.set(dir.x, 0, dir.z).normalize();
    if (impulse > 0 && dir) { const v = Math.min(45, impulse / (this.mass + 3e4)); if (v > 0.6) { this.kv.x += dir.x * v; this.kv.z += dir.z * v; if (this.giant ? v > 20 : (v > 5 || this.cfg.hp < 60)) { this.vy = Math.max(this.vy, this.giant ? Math.min(12, v * 0.25) : Math.min(26, 3 + v * 0.5)); this.air = Math.max(this.air, 0.01); } if (v > (this.giant ? 3 : 6)) { this.stagger = Math.min(1.4, 0.3 + v * 0.05); this.atk = null; } this.lastKnock = v; } }
    if (this.hp <= 0) this.die(dir);
  }
  shove(dir, sp) { this.kv.x += dir.x * sp; this.kv.z += dir.z * sp; }
  launch(vy) { this.vy = Math.max(this.vy, vy); this.air = Math.max(this.air, 0.01); }
  die(dir) {
    this.dead = true; this.deadT = 0; this.respawnT = this.giant ? 28 : 18; this.atk = null; this.fallDir = dir ? Math.atan2(dir.x, dir.z) : this.yaw + Math.PI; const g = this.g, c = this.root.position;
    this.D.fx.crashAt(c.clone().setY(this.h * 0.4), this.giant ? this.h * 0.5 : this.h * 2, this.giant ? 1.2 : 0.4); g.hud.toast(this.name + ' DESTROYED'); if (this.D.wb) this.D.wb.stats.kills++;
    if (this.D.onKill) this.D.onKill(this);
  }
  /** nearest horizontal distance from the foot of this foe to Way Big's feet circle */
  update(dt) {
    const D = this.D, wb = D.wb, root = this.root, T = this.cfg; this.hitFlash = Math.max(0, this.hitFlash - dt);
    for (const m of this.mats) { if (!m.emissive) continue; if (!m.userData.e0) m.userData.e0 = m.emissive.clone(); m.emissive.copy(m.userData.e0).addScalar(this.hitFlash * 3); }
    if (this.held) { this.kv.set(0, 0, 0); this.vy = 0; return; }
    if (this.dead) {
      this.deadT += dt; const k = clamp(this.deadT / (this.giant ? 1.7 : 0.5), 0, 1), e = k * k; root.rotation.set(0, this.fallDir, 0); this.vis.rotation.set(0, 0, 0); this.vis.rotation.x = e * (this.giant ? 1.45 : 1.5);
      this.bar.visible = false; if (this.deadT > this.respawnT - 3 && this.deadT < this.respawnT) this.vis.visible = ((this.deadT * 6) | 0) % 2 === 0; if (this.deadT >= this.respawnT) this.respawn(); return;
    }
    // ---- external motion (knock-back, launches, falls)
    const wasAir = this.air > 0;
    if (this.kv.lengthSq() > 1e-3) {
      const hs = Math.hypot(this.kv.x, this.kv.z), n = Math.max(1, Math.ceil(hs * dt / Math.max(1.5, this.rad * 0.6))), hh = dt / n; let hit = false;
      for (let i = 0; i < n; i++) {
        const ox = this.home.x, oz = this.home.z; this.home.x += this.kv.x * hh; this.home.z += this.kv.z * hh;
        if (D.collideCircle(this.home, this.rad, this.home.y + this.air + 0.3, this.home.y + this.air + this.h, 0.25 * this.h * 0)) { hit = true; const moved = Math.hypot(this.home.x - ox, this.home.z - oz); void moved; }
      }
      if (hit && hs > 6) { const m = this.mass * hs * hs * 0.5; D.damageSphere(_v.set(this.home.x + this.kv.x / hs * this.rad, this.air + Math.max(2, this.h * 0.4), this.home.z + this.kv.z / hs * this.rad), clamp(this.rad * 1.2, 4, 18), clamp(m / 3500, 30, 900), { dir: this.kv, src: 'body' }); this.hurt(clamp(hs * (this.giant ? 3 : 1.2), 1, 90), null); this.kv.multiplyScalar(0.25); if (this.thrown > 0) this.thrown = 0; }
      this.home.x = clamp(this.home.x, -LIMIT, LIMIT); this.home.z = clamp(this.home.z, -LIMIT, LIMIT);
      this.kv.multiplyScalar(Math.exp(-(this.air > 0 ? 0.15 : 2.2) * dt)); if (this.kv.lengthSq() < 0.01) this.kv.set(0, 0, 0);
    }
    if (this.air > 0 || this.vy !== 0) {
      this.vy -= 30 * dt; this.air += this.vy * dt;
      if (this.air <= 0) { const v = -this.vy; this.air = 0; this.vy = 0; if (v > 9) { const d = clamp((v - 9) * (this.giant ? 6 : 3), 0, 400); this.hurt(d, null); D.fx.landAt(root.position, v, this.h, this.mass); D.damageSphere(_v.set(this.home.x, 1, this.home.z), clamp(this.rad * 1.3, 3, 16), clamp(this.mass * v * 0.0006, 20, 600), { src: 'fall' }); } if (this.thrown > 0) { this.thrown = 0; } this.kv.multiplyScalar(0.5); }
    }
    if (wasAir && this.air === 0) this.stagger = Math.max(this.stagger, 0.4);
    // ---- AI
    this.stagger = Math.max(0, this.stagger - dt); this.cd -= dt; this.smashT -= dt;
    const tp = wb && wb.root.visible ? wb.pos : null; const dx = tp ? tp.x - this.home.x : 0, dz = tp ? tp.z - this.home.z : 0, dist = Math.hypot(dx, dz) || 1, active = !!tp && wb.alive;
    if (this.air === 0 && this.stagger <= 0 && !this.thrown) this.think(dt, dx, dz, dist, active);
    // ---- pose
    this.walk = damp(this.walk, this.moving ? 1 : 0, 8, dt); this.phase += dt * (this.moving ? this.cfg.speed / Math.max(0.6, this.h * 0.35) : 0) * 1.1;
    this.pose(dt); root.position.set(this.home.x, this.home.y + this.air, this.home.z); root.rotation.y = this.yaw; root.updateMatrixWorld(true);
    if (this.stagger > 0 && this.giant) this.vis.rotation.x = -0.2 * Math.min(1, this.stagger * 2); else if (this.air > 0) this.vis.rotation.x = clamp(-this.vy * 0.02, -0.4, 0.4); else this.vis.rotation.x = 0;
  }
  respawn() { this.dead = false; this.hp = this.maxHp; this.vis.visible = true; this.vis.rotation.set(0, 0, 0); this.home.set(this.spawn.x, 0, this.spawn.z); this.kv.set(0, 0, 0); this.air = this.vy = 0; this.atk = null; this.alert = false; this.drawBar(); this.root.position.copy(this.home); this.bar.visible = true; }
  moveToward(tx, tz, sp, dt) {
    const dx = tx - this.home.x, dz = tz - this.home.z, d = Math.hypot(dx, dz) || 1; if (d < 0.3) return false; const want = Math.atan2(dx, dz); let da = (want - this.yaw) % (Math.PI * 2); if (da > Math.PI) da -= Math.PI * 2; if (da < -Math.PI) da += Math.PI * 2; this.yaw += da * Math.min(1, dt * (this.giant ? 2.2 : 6));
    const k = Math.abs(da) < 1.0 ? 1 : 0.2, step = sp * k * dt, ox = this.home.x, oz = this.home.z; this.home.x += dx / d * step; this.home.z += dz / d * step;
    const pushed = this.D.collideCircle(this.home, this.rad, this.home.y + 0.3, this.home.y + this.h, 0);
    if (pushed && this.giant && this.smashT <= 0) { this.smashT = 1.1; this.D.damageSphere(_v.set(this.home.x + Math.sin(this.yaw) * this.rad * 1.2, this.h * 0.45, this.home.z + Math.cos(this.yaw) * this.rad * 1.2), this.h * 0.3, 450, { dir: _w.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)), src: 'foe' }); this.smash = 0.6; }
    this.home.x = clamp(this.home.x, -LIMIT, LIMIT); this.home.z = clamp(this.home.z, -LIMIT, LIMIT);
    return Math.hypot(this.home.x - ox, this.home.z - oz) > step * 0.2;
  }
  think(dt, dx, dz, dist, active) {
    const T = this.cfg, D = this.D, wb = D.wb; this.moving = false;
    if (this.type === 'trooper' || this.type === 'tank') {
      const sees = active && dist < T.range * (this.alert ? 1.5 : 1) && D.sightClear(this, wb);
      if (sees) {
        this.alert = true; const face = Math.atan2(dx, dz); let da = (face - this.yaw) % (Math.PI * 2); if (da > Math.PI) da -= Math.PI * 2; if (da < -Math.PI) da += Math.PI * 2; this.yaw += da * Math.min(1, dt * 8);
        const near = this.type === 'trooper' ? 70 : 140;
        if (this.role === 'flee' && dist < near) { this.moving = this.moveToward(this.home.x - dx / dist * 40, this.home.z - dz / dist * 40, T.speed, dt); }
        else if (this.type === 'tank' && dist > 190) this.moving = this.moveToward(this.home.x + dx, this.home.z + dz, T.speed, dt);
        else if (this.type === 'tank' && dist < 90) this.moving = this.moveToward(this.home.x - dx, this.home.z - dz, T.speed, dt);
        if (this.cd <= 0 && Math.abs(da) < 0.6) { this.cd = T.fire * rand(0.9, 1.4); D.shoot(this, wb); }
      } else if (this.alert && active && dist < T.range * 2) this.moving = this.moveToward(wb.pos.x, wb.pos.z, T.speed * 0.8, dt);
      else if (!active || !this.alert) { const d0 = Math.hypot(this.home.x - this.spawn.x, this.home.z - this.spawn.z); if (d0 > 3) this.moving = this.moveToward(this.spawn.x, this.spawn.z, T.speed * 0.6, dt); }
      return;
    }
    // giants: wake up when Way Big is within 150 m (or when hit), walk to him, punch when in reach
    if (!active) { this.alert = false; return; } if (!this.alert && dist < 150) this.alert = true; if (!this.alert) return;
    const a = this.atk, face = Math.atan2(dx, dz);
    if (a) {
      a.t += dt; let da = (face - this.yaw) % (Math.PI * 2); if (da > Math.PI) da -= Math.PI * 2; if (da < -Math.PI) da += Math.PI * 2; if (a.stage < 2) this.yaw += da * Math.min(1, dt * 3.5);
      if (a.stage === 0 && a.t >= 0.75) { a.stage = 1; a.t = 0; } else if (a.stage === 1 && a.t >= 0.16) { a.stage = 2; a.t = 0; D.foeStrike(this, wb); } else if (a.stage === 2 && a.t >= 0.7) { this.atk = null; this.cd = this.type === 'titan' ? 2.2 : 3.0; }
      return;
    }
    const gapB = wb.nearestBody(_v.set(this.home.x, this.h * 0.6, this.home.z)).d;       // distance from his chest to the nearest part of Way Big's body: he walks until a fist can really reach it
    if (gapB > this.h * 0.5) { this.moving = this.moveToward(wb.pos.x, wb.pos.z, T.speed, dt); }
    else { let da = (face - this.yaw) % (Math.PI * 2); if (da > Math.PI) da -= Math.PI * 2; if (da < -Math.PI) da += Math.PI * 2; this.yaw += da * Math.min(1, dt * 3); if (this.cd <= 0 && Math.abs(da) < 0.5) this.atk = { stage: 0, t: 0 }; }
  }
  pose(dt) {
    const P = this.P, ph = this.phase, w = this.walk, a = this.atk; if (!P) return;
    if (this.type === 'tank') { if (P.turret) P.turret.rotation.y = damp(P.turret.rotation.y, 0, 4, dt); return; }
    const sw = Math.sin(ph) * 0.65 * w; P.legL.rotation.x = sw; P.legR.rotation.x = -sw; P.shinL.rotation.x = Math.max(0, -Math.sin(ph)) * 0.8 * w; P.shinR.rotation.x = Math.max(0, Math.sin(ph)) * 0.8 * w;
    P.armL.rotation.x = -sw * 0.8; P.armR.rotation.x = sw * 0.8; P.torso.rotation.y = Math.sin(ph) * 0.12 * w; P.torso.rotation.x = 0.04;
    if (this.type === 'trooper') { P.armR.rotation.x = -1.3 * (this.alert ? 1 : 0.2); P.foreR.rotation.x = -0.3; }
    if (a) {
      const u = a.stage === 0 ? a.t / 0.75 : a.stage === 1 ? 1 : 1 - a.t / 0.7; P.armR.rotation.x = a.stage === 0 ? -0.4 - 2.3 * u : a.stage === 1 ? -2.7 + 3.4 * (a.t / 0.16) : 0.7 - 0.5 * (1 - u); P.foreR.rotation.x = a.stage === 0 ? -0.6 * u : -0.1;
      P.torso.rotation.y = a.stage === 0 ? -0.45 * u : a.stage === 1 ? -0.45 + 0.9 * (a.t / 0.16) : 0.45 * u; P.torso.rotation.x = a.stage === 0 ? -0.12 * u : 0.3 * (a.stage === 1 ? 1 : u);
    } else if (this.air > 0) { P.armL.rotation.x = P.armR.rotation.x = -1.6; }
  }
}

// =============================================================================================================== district
export class WbDistrict {
  constructor(game) {
    this.g = game; this.scene = game.scene; this.world = game.world; this.active = false; this.group = new THREE.Group(); this.group.visible = false; this.scene.add(this.group); this.wb = null; this.props = []; this.foes = []; this.limit = LIMIT;
    this.grid = new Int32Array(NX * NY * NZ).fill(-1); this.cix = new Int16Array(CAP); this.ciy = new Int16Array(CAP); this.ciz = new Int16Array(CAP); this.chp = new Float32Array(CAP); this.cmax = new Float32Array(CAP); this.cb = new Int16Array(CAP); this.col = new Float32Array(CAP * 3); this.n = 0; this.buildings = []; this.mark = new Int32Array(CAP); this.stamp = 0; this.queue = new Int32Array(CAP);
    this.stats = { cellsDestroyed: 0, collapses: 0, falls: 0, indestructibleHits: 0, kills: 0, footfalls: 0 }; this.flashCd = 0; this.toastCd = 0; this.fx = null; this.pending = new Set();
    this.build(); this.buildGround(); this.buildDecor(); this.initDebris();
  }
  // ----------------------------------------------------------------------------------------------- construction
  build() {
    const rnd = mulberry32(2024), tex = facadeTexture();
    const geo = new THREE.BoxGeometry(CX, CY, CZ), uv = geo.attributes.uv; for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i, u = uv.getX(k); uv.setX(k, f === 2 || f === 3 ? 0.5 + u * 0.5 : u * 0.5); }
    this.cellGeo = geo; this.cellMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82, metalness: 0.06 });
    this.mesh = new THREE.InstancedMesh(geo, this.cellMat, CAP); this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.castShadow = true; this.mesh.receiveShadow = true; this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3); this.group.add(this.mesh);
    const tones = [0xd7cfc3, 0xc2b8a8, 0xb48a74, 0xa9b3b9, 0xcfc4a6, 0x9fa3a6, 0xbfa58f], glass = 0x7f98ae;
    const towers = new Set(['2,-1', '-2,2']), lowKeys = new Set(['1,1', '-1,-2', '3,0', '-3,-1', '0,2', '0,-3', '2,3', '-2,-3']);      // low-rise shop blocks (two floors: they can be stepped on)
    for (let bi = -3; bi <= 3; bi++) for (let bj = -3; bj <= 3; bj++) {
      if (!bi && !bj) continue; const key = bi + ',' + bj, tower = towers.has(key); if (!tower && !lowKeys.has(key) && rnd() < 0.2) continue;
      const low = lowKeys.has(key); let nx = tower ? 5 : 4 + (rnd() * 4 | 0), nz = tower ? 5 : 4 + (rnd() * 4 | 0), floors = tower ? 22 : low || rnd() < 0.1 ? 2 : 6 + (rnd() * 9 | 0);
      if (this.n + nx * nz * floors > CAP) { const fl = Math.floor((CAP - this.n) / (nx * nz)); if (fl < 2) continue; floors = Math.min(floors, fl); }
      const ox = (rnd() * (8 - nx + 1)) | 0, oz = (rnd() * (8 - nz + 1)) | 0, ix0 = (bi * 66 + 480) / 6 - 4 + ox, iz0 = (bj * 66 + 480) / 6 - 4 + oz;
      const tier = tower ? 'tower' : floors <= 2 ? 'shop' : floors > 11 ? 'tall' : 'mid', hp = { tower: Infinity, shop: 70, mid: 120, tall: 170 }[tier], name = { tower: 'RESERVE TOWER', shop: 'SHOPS', mid: 'APARTMENTS', tall: 'OFFICE BLOCK' }[tier];
      const tone = new THREE.Color(tower ? 0x6d7f93 : tones[(rnd() * tones.length) | 0]); const b = { id: this.buildings.length, name, tier, indestructible: tower, cells: [], alive: 0, total: 0, ix0, iz0, nx, nz, floors, collapsed: false, cx: X0 + (ix0 + nx / 2) * CX, cz: Z0 + (iz0 + nz / 2) * CZ };
      this.buildings.push(b);
      for (let iy = 0; iy < floors; iy++) for (let iz = iz0; iz < iz0 + nz; iz++) for (let ix = ix0; ix < ix0 + nx; ix++) {
        const id = this.n++; this.cix[id] = ix; this.ciy[id] = iy; this.ciz[id] = iz; this.cb[id] = b.id; this.chp[id] = this.cmax[id] = hp; this.grid[idxOf(ix, iy, iz)] = id; b.cells.push(id);
        const v = 0.93 + rnd() * 0.12; _c.copy(tone).multiplyScalar(v * (iy === 0 ? 0.88 : 1)); this.col[id * 3] = _c.r; this.col[id * 3 + 1] = _c.g; this.col[id * 3 + 2] = _c.b; void glass;
      }
      b.alive = b.total = b.cells.length;
    }
    this.mesh.count = this.n; for (let i = 0; i < this.n; i++) this.setCell(i, true); this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true;
  }
  setCell(id, on) {
    if (on) { _s.set(1, 1, 1); _v.set(X0 + (this.cix[id] + 0.5) * CX, (this.ciy[id] + 0.5) * CY, Z0 + (this.ciz[id] + 0.5) * CZ); _m.compose(_v, _q.identity(), _s); this.mesh.setMatrixAt(id, _m); this.mesh.instanceColor.setXYZ(id, this.col[id * 3], this.col[id * 3 + 1], this.col[id * 3 + 2]); }
    else this.mesh.setMatrixAt(id, ZERO);
  }
  buildGround() {
    const t = asphaltTexture(), W = 21 * PITCH; t.repeat.set(21, 21);
    const g = this.ground = new THREE.Mesh(new THREE.PlaneGeometry(W, W), new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 })); g.rotation.x = -Math.PI / 2; g.position.y = -0.12; g.receiveShadow = true; this.group.add(g);
  }
  buildDecor() {
    // distant skyline (visual only; the playable area ends at the city limit +-288 m, inside the fog-lit skyline ring)
    const rnd = mulberry32(5), n = 110, geo = new THREE.BoxGeometry(1, 1, 1), m = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x9aa3ab, roughness: 0.9 }), n); m.frustumCulled = false;
    for (let i = 0; i < n; i++) { const a = rnd() * Math.PI * 2, r = 330 + rnd() * 160, w = 24 + rnd() * 40, d = 24 + rnd() * 40, h = 50 + rnd() * rnd() * 220; _v.set(Math.cos(a) * r, h / 2, Math.sin(a) * r); _m.compose(_v, _q.identity(), _s.set(w, h, d)); m.setMatrixAt(i, _m); _c.setHSL(0.58, 0.07, 0.5 + rnd() * 0.2); m.setColorAt(i, _c); }
    this.group.add(m); this.skyline = m;
  }
  /** props + foes (called by main once the PropSystem exists) */
  populate(props) {
    this.propSys = props; const rnd = mulberry32(31), add = (kind, x, z, o = {}) => { const p = props.add(kind, x, z, o); p.wb = true; p.root.visible = false; props.removeBox(p); const i = props.props.indexOf(p); if (i >= 0) props.props.splice(i, 1); this.props.push(p); return p; };
    const roads = []; for (let k = -3; k <= 4; k++) roads.push(33 + (k - 1) * 66);       // road centre lines: ..., -165, -99, -33, 33, 99, 165, 231 ... (blocks sit between them)
    let cars = 0; const carCols = [0xc0392b, 0x2f6fb0, 0xd8d8d0, 0x222a30, 0xe0b020, 0x3c8a4e, 0x8a3c8a];
    for (const r of roads) for (const horizontal of [false, true]) {
      for (let t = -270; t < 270; t += 14 + rnd() * 16) {
        if (Math.abs(t) < 60 && Math.abs(r) < 60) continue; if (rnd() < 0.55 || cars >= 34) continue; const side = rnd() < 0.5 ? -1 : 1, off = side * (5.6 + rnd() * 1.2);
        const x = horizontal ? t : r + off, z = horizontal ? r + off : t; if (Math.abs(x) < 42 && Math.abs(z) < 42) continue; add('car', x, z, { yaw: horizontal ? Math.PI / 2 : 0, color: carCols[(rnd() * carCols.length) | 0] }); cars++;
      }
    }
    for (const [x, z, yaw] of [[33, 33, 0], [-33, 99, Math.PI / 2], [99, -33, 0], [-99, -99, Math.PI / 2], [33, -165, 0], [165, 33, Math.PI / 2]]) add('truck', x + 4, z, { yaw });
    for (const r of roads) for (let t = -264; t <= 264; t += 66) { if (rnd() < 0.35) continue; for (const [x, z] of [[r + 8.2, t + 24], [t + 24, r - 8.2]]) { if (Math.abs(x) < 44 && Math.abs(z) < 44) continue; if (Math.abs(x) > LIMIT || Math.abs(z) > LIMIT) continue; add('light', x, z); } }
    for (let i = 0; i < 18; i++) { const x = (rnd() - 0.5) * 520, z = (rnd() - 0.5) * 520; if (Math.abs(x) < 50 && Math.abs(z) < 50) continue; if (this.cellAtPoint(x, 1, z) >= 0 || this.cellAtPoint(x + 4, 1, z) >= 0 || this.cellAtPoint(x - 4, 1, z) >= 0) continue; add(rnd() < 0.7 ? 'tree' : 'dumpster', x, z, { yaw: rnd() * 6 }); }
    for (let i = 0; i < 10; i++) { const x = (rnd() - 0.5) * 400, z = (rnd() - 0.5) * 400; if (Math.abs(x) < 50 && Math.abs(z) < 50) continue; if (this.cellAtPoint(x, 1, z) >= 0) continue; add('barrel', x, z); }
    for (const p of this.props) { p.hpMax = p.hp; }
    const spawnFoe = (kind, x, z, o = {}) => { const f = new WbFoe(this, kind, x, z, o); f.spawn = new THREE.Vector3(x, 0, z); f.root.visible = false; this.foes.push(f); return f; };
    this.spawnFoe = spawnFoe;
    spawnFoe('titan', -99, 165, { yaw: 0.5 }); spawnFoe('colossus', 165, -165, { yaw: 2.4 });      // road intersections (open ground between the blocks)
    spawnFoe('tank', 99, 66, { yaw: 3 }); spawnFoe('tank', -99, -140, { yaw: 1 });
    const roles = ['hold', 'hold', 'flee', 'hold', 'flee', 'hold', 'hold', 'flee'];
    for (let i = 0; i < 8; i++) { const a = rnd() * 6.28, r = 90 + rnd() * 150; let x = Math.cos(a) * r, z = Math.sin(a) * r; const k = Math.round((x - 33) / 66) * 66 + 33; x = k + 7; spawnFoe('trooper', clamp(x, -260, 260), clamp(z, -260, 260), { role: roles[i], yaw: rnd() * 6 }); }
  }
  // ----------------------------------------------------------------------------------------------- activation (the district only exists for Way Big)
  setActive(on) {
    if (this.disabled) on = false;                                                                  // V28: retired on the island (its lattice city overlapped the island; Way Big uses the island itself)
    if (on === this.active) return; this.active = on; this.group.visible = on; const P = this.propSys, W = this.world; if (W.apron) W.apron.visible = !on;
    // district props are only in the PropSystem list while Way Big is the active alien, so no other alien ever sees / touches them
    for (const p of this.props) {
      if (on) { if (!P.props.includes(p)) P.props.push(p); p.root.visible = !p.dead; if (!p.dead && p.state === 'rest' && !p.held) P.addBox(p); }
      else { const i = P.props.indexOf(p); if (i >= 0) P.props.splice(i, 1); P.removeBox(p); p.root.visible = false; }
    }
    for (const f of this.foes) { f.root.visible = on; const i = W.hittables.indexOf(f); if (on && i < 0) W.hittables.push(f); else if (!on && i >= 0) W.hittables.splice(i, 1); }
    P.limit = on ? LIMIT : 34.5;
  }
  /** props that ended up outside the arena (thrown there) belong to the district while another alien plays: park them (temporary chunks are simply removed) */
  parkStrays() {
    const P = this.propSys; if (this.disabled || !P) return; for (const p of P.props.slice()) { if (p.held || this.props.includes(p)) continue; if (Math.abs(p.pos.x) > 34.6 || Math.abs(p.pos.z) > 34.6) { if (p.temp) { P.remove(p); continue; } p.wb = true; this.props.push(p); } }
  }
  reset() {
    for (let id = 0; id < this.n; id++) { this.grid[idxOf(this.cix[id], this.ciy[id], this.ciz[id])] = id; this.chp[id] = this.cmax[id]; this.setCell(id, true); }
    for (const b of this.buildings) { b.alive = b.total; b.collapsed = false; } this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true;
    for (const d of this.debris) { d.state = 0; this.deb.setMatrixAt(d.i, ZERO); } this.deb.instanceMatrix.needsUpdate = true;
    const P = this.propSys; if (P) { const saved = P.props; P.props = this.props.slice(); P.reset(); P.props = saved; for (const p of this.props) { if (!this.active) { p.root.visible = false; P.removeBox(p); } else p.root.visible = !p.dead; } }
    for (const f of this.foes) { f.respawn(); f.dead = false; f.deadT = 0; f.stagger = 0; f.thrown = 0; f.held = false; }
    this.pending.clear(); this.stats.cellsDestroyed = this.stats.collapses = this.stats.falls = this.stats.indestructibleHits = 0;
  }
  // ----------------------------------------------------------------------------------------------- queries
  cellAtPoint(x, y, z) { if (!this.active) return -1; const ix = Math.floor((x - X0) / CX), iy = Math.floor(y / CY), iz = Math.floor((z - Z0) / CZ); if (ix < 0 || ix >= NX || iy < 0 || iy >= NY || iz < 0 || iz >= NZ) return -1; return this.grid[idxOf(ix, iy, iz)]; }
  topAt(x, z) { if (!this.active) return 0; const ix = Math.floor((x - X0) / CX), iz = Math.floor((z - Z0) / CZ); if (ix < 0 || ix >= NX || iz < 0 || iz >= NZ) return 0; for (let iy = NY - 1; iy >= 0; iy--) if (this.grid[idxOf(ix, iy, iz)] >= 0) return (iy + 1) * CY; return 0; }
  /** push a vertical cylinder (centre pos, radius r) out of every building cell whose top is above y0 and whose bottom is below y1. Returns true if it moved. */
  collideCircle(pos, r, y0, y1, _unused) {
    if (!this.active) return false; let moved = false;
    const ix0 = Math.floor((pos.x - r - X0) / CX), ix1 = Math.floor((pos.x + r - X0) / CX), iz0 = Math.floor((pos.z - r - Z0) / CZ), iz1 = Math.floor((pos.z + r - Z0) / CZ);
    if (ix1 < 0 || iz1 < 0 || ix0 >= NX || iz0 >= NZ) return false;
    const iy0 = Math.max(0, Math.floor(y0 / CY)), iy1 = Math.min(NY - 1, Math.floor(y1 / CY)); if (iy1 < iy0) return false;
    for (let it = 0; it < 2; it++) {
      let any = false;
      for (let iz = Math.max(0, iz0); iz <= Math.min(NZ - 1, iz1); iz++) for (let ix = Math.max(0, ix0); ix <= Math.min(NX - 1, ix1); ix++) {
        let solid = false; for (let iy = iy0; iy <= iy1; iy++) if (this.grid[idxOf(ix, iy, iz)] >= 0 && (iy + 1) * CY > y0 + 1e-6) { solid = true; break; } if (!solid) continue;
        const minx = X0 + ix * CX, maxx = minx + CX, minz = Z0 + iz * CZ, maxz = minz + CZ, cx = clamp(pos.x, minx, maxx), cz = clamp(pos.z, minz, maxz), dx = pos.x - cx, dz = pos.z - cz, d2 = dx * dx + dz * dz;
        if (d2 < r * r) {
          if (d2 > 1e-8) { const d = Math.sqrt(d2), k = (r - d) / d; pos.x += dx * k; pos.z += dz * k; } else { const ox = Math.min(pos.x - minx, maxx - pos.x), oz = Math.min(pos.z - minz, maxz - pos.z); if (ox < oz) pos.x += (pos.x - minx < maxx - pos.x ? -1 : 1) * (ox + r); else pos.z += (pos.z - minz < maxz - pos.z ? -1 : 1) * (oz + r); }
          any = moved = true;
        }
      }
      if (!any) break;
    }
    return moved;
  }
  /** segment vs the live lattice (3D DDA). Returns { t, point, normal, id } or null. */
  ray(o, d, maxT) {
    if (!this.active) return null;
    const bx0 = X0, bx1 = X0 + NX * CX, by1 = NY * CY, bz0 = Z0, bz1 = Z0 + NZ * CZ; let t0 = 0, t1 = maxT;
    for (const [oo, dd, lo, hi] of [[o.x, d.x, bx0, bx1], [o.y, d.y, 0, by1], [o.z, d.z, bz0, bz1]]) {
      if (Math.abs(dd) < 1e-9) { if (oo < lo || oo > hi) return null; continue; } let a = (lo - oo) / dd, b = (hi - oo) / dd; if (a > b) { const x = a; a = b; b = x; } t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) return null;
    }
    const e = 1e-4, px = o.x + d.x * (t0 + e), py = o.y + d.y * (t0 + e), pz = o.z + d.z * (t0 + e);
    let ix = clamp(Math.floor((px - X0) / CX), 0, NX - 1), iy = clamp(Math.floor(py / CY), 0, NY - 1), iz = clamp(Math.floor((pz - Z0) / CZ), 0, NZ - 1);
    const sx = d.x > 0 ? 1 : -1, sy = d.y > 0 ? 1 : -1, sz = d.z > 0 ? 1 : -1, dx = Math.abs(d.x) < 1e-9 ? 1e9 : CX / Math.abs(d.x), dy = Math.abs(d.y) < 1e-9 ? 1e9 : CY / Math.abs(d.y), dz = Math.abs(d.z) < 1e-9 ? 1e9 : CZ / Math.abs(d.z);
    let tx = Math.abs(d.x) < 1e-9 ? 1e9 : ((sx > 0 ? X0 + (ix + 1) * CX : X0 + ix * CX) - o.x) / d.x, ty = Math.abs(d.y) < 1e-9 ? 1e9 : ((sy > 0 ? (iy + 1) * CY : iy * CY) - o.y) / d.y, tz = Math.abs(d.z) < 1e-9 ? 1e9 : ((sz > 0 ? Z0 + (iz + 1) * CZ : Z0 + iz * CZ) - o.z) / d.z;
    let t = t0, ax = -1;
    for (let it = 0; it < 900; it++) {
      const id = this.grid[idxOf(ix, iy, iz)];
      if (id >= 0) { const n = new THREE.Vector3(); if (ax === 0) n.x = -sx; else if (ax === 1) n.y = -sy; else if (ax === 2) n.z = -sz; else n.y = 1; return { t: Math.max(0, t), point: o.clone().addScaledVector(d, Math.max(0, t)), normal: n, id }; }
      if (tx < ty && tx < tz) { t = tx; if (t > t1) return null; ix += sx; tx += dx; ax = 0; } else if (ty < tz) { t = ty; if (t > t1) return null; iy += sy; ty += dy; ax = 1; } else { t = tz; if (t > t1) return null; iz += sz; tz += dz; ax = 2; }
      if (ix < 0 || ix >= NX || iy < 0 || iy >= NY || iz < 0 || iz >= NZ) return null;
    }
    return null;
  }
  /** can `foe` see Way Big (no building between)? */
  sightClear(foe, wb) {
    const o = _v.set(foe.home.x, Math.max(1.2, foe.h * 0.7), foe.home.z), tgt = _w.set(wb.pos.x, 30, wb.pos.z).sub(o), L = tgt.length(); tgt.multiplyScalar(1 / L); const h = this.ray(o, tgt, L - 12); return !h;
  }
  buildingOf(id) { return this.buildings[this.cb[id]]; }
  // ----------------------------------------------------------------------------------------------- destruction
  /** damage every live cell within r of c (falloff to the edge). Returns the number of cells destroyed. Indestructible buildings only flash. */
  damageSphere(c, r, dmg, o = {}) {
    if (!this.active || dmg <= 0) return 0;
    const rr = r + 3.2, ix0 = Math.max(0, Math.floor((c.x - rr - X0) / CX)), ix1 = Math.min(NX - 1, Math.floor((c.x + rr - X0) / CX)), iz0 = Math.max(0, Math.floor((c.z - rr - Z0) / CZ)), iz1 = Math.min(NZ - 1, Math.floor((c.z + rr - Z0) / CZ)), iy0 = Math.max(0, Math.floor((c.y - rr) / CY)), iy1 = Math.min(NY - 1, Math.floor((c.y + rr) / CY));
    const dead = [], bset = new Set(); let flash = null, touched = false;
    for (let iy = iy0; iy <= iy1; iy++) for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const id = this.grid[idxOf(ix, iy, iz)]; if (id < 0) continue; const cx = X0 + (ix + 0.5) * CX, cy = (iy + 0.5) * CY, cz = Z0 + (iz + 0.5) * CZ, d = Math.hypot(cx - c.x, cy - c.y, cz - c.z); if (d > rr) continue;
      const b = this.buildings[this.cb[id]]; touched = true; if (b.indestructible) { flash = flash || new THREE.Vector3(cx, cy, cz); continue; }
      const k = 1 - clamp((d - 3.2) / Math.max(1, r), 0, 1) * 0.8; this.chp[id] -= dmg * k; bset.add(b);
      if (this.chp[id] <= 0) dead.push(id); else { const f = clamp(this.chp[id] / this.cmax[id], 0, 1), v = 0.55 + 0.45 * f; this.mesh.instanceColor.setXYZ(id, this.col[id * 3] * v, this.col[id * 3 + 1] * v, this.col[id * 3 + 2] * v); }
    }
    if (flash) this.indestructibleHit(c, flash);
    if (touched) this.mesh.instanceColor.needsUpdate = true;
    if (dead.length) { this.destroyCells(dead, o.dir || null, dmg); for (const b of bset) this.checkSupport(b); }
    return dead.length;
  }
  indestructibleHit(c, cellPos) {
    this.stats.indestructibleHits++; if (this.flashCd > 0) return; this.flashCd = 0.25; const g = this.g, p = c.clone();
    g.fx.glow.emit({ pos: p, size: 18, life: 0.16, drag: 0, color: [1, 0.95, 0.8], alpha: 0.9 }); for (let i = 0; i < 10; i++) g.fx.glow.emit({ pos: p, vel: _v.set(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).normalize().multiplyScalar(rand(30, 70)), size: 1.4, life: 0.35, drag: 1.5, color: [1, 0.8, 0.4] });
    if (this.toastCd <= 0) { g.hud.toast('RESERVE TOWER - REINFORCED, NO DAMAGE'); this.toastCd = 3; } void cellPos;
  }
  destroyCells(ids, dir, power = 200) {
    const g = this.g; let dust = 0; const ctr = new THREE.Vector3(); let n = 0;
    for (const id of ids) {
      if (this.grid[idxOf(this.cix[id], this.ciy[id], this.ciz[id])] !== id) continue; this.grid[idxOf(this.cix[id], this.ciy[id], this.ciz[id])] = -1; this.setCell(id, false); const b = this.buildings[this.cb[id]]; b.alive--; this.stats.cellsDestroyed++;
      const p = _v.set(X0 + (this.cix[id] + 0.5) * CX, (this.ciy[id] + 0.5) * CY, Z0 + (this.ciz[id] + 0.5) * CZ); ctr.add(p); n++;
      const vel = _w.set(rand(-6, 6), rand(2, 10), rand(-6, 6)); if (dir) vel.addScaledVector(dir, clamp(power * 0.04, 6, 36));
      this.spawnDebris(p, vel, id, 0.9);
      if (dust < 18) { dust++; g.fx.dust.emit({ pos: p, vel: _w.set(rand(-1, 1), rand(0.2, 1.2), rand(-1, 1)).normalize().multiplyScalar(rand(8, 22)), size: rand(10, 20), grow: 2.4, life: rand(1.2, 2.2), drag: 1.6, color: [0.66, 0.64, 0.6], alpha: 0.5 }); }
      if (dust < 9) this.g.props.debris.burst(p, 2, 24, 0.9, 0xb9b6ae);
    }
    this.mesh.instanceMatrix.needsUpdate = true; if (n) { ctr.multiplyScalar(1 / n); this.shakeAt(ctr, 0.04 + 0.012 * Math.min(n, 18), n); }
  }
  shakeAt(p, a, n) { const g = this.g; const d = p.distanceTo(g.player.pos); g.camera.addTrauma(a * clamp(1.3 - d / 400, 0.15, 1)); if (n > 3) g.sfx.crash(Math.min(0.9, 0.12 + n * 0.02) * clamp(1.2 - d / 500, 0.2, 1)); }
  /** breadth-first support check: every live cell must be connected to a ground cell through live neighbours; the rest fall */
  checkSupport(b) {
    if (b.collapsed || b.alive <= 0) return; this.stamp++; const st = this.stamp, mk = this.mark, q = this.queue; let h = 0, t = 0;
    for (const id of b.cells) { if (this.grid[idxOf(this.cix[id], this.ciy[id], this.ciz[id])] !== id) continue; if (this.ciy[id] === 0) { mk[id] = st; q[t++] = id; } }
    const D = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    while (h < t) { const id = q[h++], ix = this.cix[id], iy = this.ciy[id], iz = this.ciz[id]; for (const [a, bb, c] of D) { const x = ix + a, y = iy + bb, z = iz + c; if (x < 0 || y < 0 || z < 0 || x >= NX || y >= NY || z >= NZ) continue; const nid = this.grid[idxOf(x, y, z)]; if (nid < 0 || mk[nid] === st || this.cb[nid] !== b.id) continue; mk[nid] = st; q[t++] = nid; } }
    const fall = []; for (const id of b.cells) { if (this.grid[idxOf(this.cix[id], this.ciy[id], this.ciz[id])] !== id) continue; if (mk[id] !== st) fall.push(id); }
    if (!fall.length) return;
    let sx = 0, sz = 0; for (const id of fall) { sx += this.cix[id]; sz += this.ciz[id]; } sx /= fall.length; sz /= fall.length;
    for (const id of fall) { this.grid[idxOf(this.cix[id], this.ciy[id], this.ciz[id])] = -1; this.setCell(id, false); b.alive--; this.stats.cellsDestroyed++; this.stats.falls++;
      _v.set(X0 + (this.cix[id] + 0.5) * CX, (this.ciy[id] + 0.5) * CY, Z0 + (this.ciz[id] + 0.5) * CZ); _w.set((this.cix[id] - sx) * 0.7 + rand(-3, 3), rand(-1, 2), (this.ciz[id] - sz) * 0.7 + rand(-3, 3)); this.spawnDebris(_v, _w, id, 1); }
    this.mesh.instanceMatrix.needsUpdate = true; this.stats.collapses++;
    const cp = _v.set(X0 + (sx + 0.5) * CX, 12, Z0 + (sz + 0.5) * CZ);
    for (let i = 0; i < Math.min(26, fall.length); i++) this.g.fx.dust.emit({ pos: cp.clone().add(_w.set(rand(-14, 14), rand(0, 30), rand(-14, 14))), vel: _w.set(rand(-1, 1), rand(0, 0.6), rand(-1, 1)).normalize().multiplyScalar(rand(6, 20)), size: rand(14, 28), grow: 2.6, life: rand(2, 3.4), drag: 1.4, color: [0.64, 0.62, 0.58], alpha: 0.5 });
    this.shakeAt(cp, 0.1 + Math.min(0.4, fall.length * 0.01), fall.length); if (fall.length >= 25 && b.alive < b.total * 0.7 || b.alive <= 0) { if (!b.collapsed && fall.length >= 25) { this.g.hud.toast(b.name + ' COLLAPSING'); } }
    if (b.alive <= 0) b.collapsed = true;
  }
  // ----------------------------------------------------------------------------------------------- falling cells (pooled)
  initDebris() {
    const N = 160; this.deb = new THREE.InstancedMesh(this.cellGeo, this.cellMat, N); this.deb.frustumCulled = false; this.deb.castShadow = true; this.deb.receiveShadow = true; this.deb.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3); this.group.add(this.deb);
    this.debris = []; for (let i = 0; i < N; i++) { this.debris.push({ i, state: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Vector3(), rv: new THREE.Vector3(), t: 0, sc: 1, hit: 0, col: 0 }); this.deb.setMatrixAt(i, ZERO); } this.debN = 0;
  }
  spawnDebris(p, vel, id, sc) {
    let d = null; for (let k = 0; k < this.debris.length; k++) { const c = this.debris[(this.debN + k) % this.debris.length]; if (!c.state) { d = c; this.debN = (this.debN + k + 1) % this.debris.length; break; } }
    if (!d) return; d.state = 1; d.pos.copy(p); d.vel.copy(vel); d.rot.set(rand(0, 6), rand(0, 6), rand(0, 6)); d.rv.set(rand(-3, 3), rand(-3, 3), rand(-3, 3)); d.t = 0; d.sc = sc * rand(0.82, 1); d.hit = 0;
    this.deb.instanceColor.setXYZ(d.i, this.col[id * 3] * 0.8, this.col[id * 3 + 1] * 0.8, this.col[id * 3 + 2] * 0.8); this.deb.instanceColor.needsUpdate = true;
  }
  updateDebris(dt) {
    let dirty = false;
    for (const d of this.debris) {
      if (!d.state) continue; dirty = true; d.t += dt;
      if (d.state === 1) {
        d.vel.y -= 32 * dt; d.pos.addScaledVector(d.vel, dt); d.rot.addScaledVector(d.rv, dt);
        const cid = this.cellAtPoint(d.pos.x, d.pos.y, d.pos.z);     // a falling cell that strikes a standing one damages it and breaks up
        if (cid >= 0 && d.t > 0.15) { const sp = d.vel.length(); d.vel.multiplyScalar(0.3); this.damageSphere(d.pos, 4, clamp(sp * 6, 20, 160), { src: 'rubble' }); d.state = 3; d.t = 0; this.burstAt(d.pos, 4); continue; }
        if (d.pos.y < 2.6) { const sp = -d.vel.y; d.pos.y = 2.5 * d.sc; if (sp > 8) this.landDebris(d, sp); d.vel.set(0, 0, 0); d.rv.set(0, 0, 0); d.state = 2; d.t = 0; }
      } else if (d.state === 2) { if (d.t > 9) { d.state = 3; d.t = 0; } } else if (d.state === 3) { if (d.t > 1.2) { d.state = 0; _m.makeScale(0, 0, 0); this.deb.setMatrixAt(d.i, _m); continue; } }
      const sc = d.sc * (d.state === 3 ? Math.max(0, 1 - d.t / 1.2) : 1); _e.set(d.rot.x, d.rot.y, d.rot.z); _q.setFromEuler(_e); _m.compose(d.pos, _q, _s.set(sc, sc, sc)); this.deb.setMatrixAt(d.i, _m);
    }
    if (dirty) this.deb.instanceMatrix.needsUpdate = true;
  }
  burstAt(p, n) { this.g.props.debris.burst(p, n, 22, 0.8, 0xb9b6ae); this.g.fx.dust.emit({ pos: p, vel: _w.set(0, 3, 0), size: 14, grow: 2.2, life: 1.6, drag: 1.5, color: [0.66, 0.64, 0.6], alpha: 0.45 }); }
  landDebris(d, sp) {
    this.burstAt(d.pos, 4); const near = this.g.player.pos.distanceTo(d.pos); if (sp > 14) this.g.camera.addTrauma(0.03 * clamp(1.3 - near / 300, 0.1, 1));
    const P = this.propSys; if (P) for (const p of P.props) { if (p.dormant || p.held || p.dead || p.planted) continue; if (Math.hypot(p.pos.x - d.pos.x, p.pos.z - d.pos.z) < 5.5 && p.pos.y < 5) P.hurt(p, sp * 12); }
    for (const f of this.foes) { if (f.dead) continue; if (Math.hypot(f.home.x - d.pos.x, f.home.z - d.pos.z) < 5.5 + f.rad * 0.6) f.hurt(f.giant ? clamp(sp * 0.5, 0, 12) : clamp(sp * 14, 4, 200), null); }
    for (const h of this.world.hittables) { if (h.kind === 'foe' || h.dead || !h.root) continue; if (Math.hypot(h.root.position.x - d.pos.x, h.root.position.z - d.pos.z) < 5) h.applyHit(h.root.position.clone(), _v.set(0, 0, 1), clamp(sp * 6, 5, 80)); }
  }
  /** damage everything under a foot / flat contact area (an oriented rectangle on the ground): low-rise cells, small cars, ... Returns cells destroyed. */
  crushArea(x, z, hw, hl, yaw, dmg, maxY = 12) {
    if (!this.active) return 0; const c = Math.cos(yaw), s = Math.sin(yaw), R = Math.hypot(hw, hl) + 3.2, ids = []; const ix0 = Math.max(0, Math.floor((x - R - X0) / CX)), ix1 = Math.min(NX - 1, Math.floor((x + R - X0) / CX)), iz0 = Math.max(0, Math.floor((z - R - Z0) / CZ)), iz1 = Math.min(NZ - 1, Math.floor((z + R - Z0) / CZ)), iy1 = Math.min(NY - 1, Math.floor(maxY / CY));
    let any = false;
    for (let iy = 0; iy <= iy1; iy++) for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const id = this.grid[idxOf(ix, iy, iz)]; if (id < 0) continue; const cx = X0 + (ix + 0.5) * CX - x, cz = Z0 + (iz + 0.5) * CZ - z, lx = cx * c - cz * s, lz = cx * s + cz * c; if (Math.abs(lx) > hw + 3 || Math.abs(lz) > hl + 3) continue;
      const b = this.buildings[this.cb[id]]; if (b.indestructible) { any = true; continue; } this.chp[id] -= dmg; ids.push(id); any = true; if (this.chp[id] > 0) { const v = 0.5 + 0.5 * clamp(this.chp[id] / this.cmax[id], 0, 1); this.mesh.instanceColor.setXYZ(id, this.col[id * 3] * v, this.col[id * 3 + 1] * v, this.col[id * 3 + 2] * v); }
    }
    this.mesh.instanceColor.needsUpdate = any || this.mesh.instanceColor.needsUpdate; const dead = ids.filter(id => this.chp[id] <= 0); if (dead.length) { this.destroyCells(dead, null, dmg); const bs = new Set(dead.map(id => this.buildings[this.cb[id]])); for (const b of bs) this.checkSupport(b); } return dead.length;
  }
  /** carve a line (Way Big's chest beam): hits cells along the ray, stops after maxCells destroyed cells. Returns { end, cells } */
  carve(o, d, len, radius, dmg, maxCells = 28) {
    if (!this.active) return { end: o.clone().addScaledVector(d, len), cells: 0, hits: 0 }; let t = 0, total = 0, hits = 0; const p = new THREE.Vector3();
    for (let i = 0; i < 12 && total < maxCells; i++) {
      const h = this.ray(_w.copy(o).addScaledVector(d, t), d, len - t); if (!h) { t = len; break; } t += h.t; p.copy(o).addScaledVector(d, t); hits++;
      const n = this.damageSphere(p.clone().addScaledVector(d, 3), radius, dmg, { dir: d, src: 'beam' }); total += n; t += 1.5;
      if (!n) { const b = this.buildings[this.cb[h.id]]; if (b && b.indestructible) { return { end: p.clone(), cells: total, hits }; } }
    }
    return { end: o.clone().addScaledVector(d, Math.min(len, t)), cells: total, hits };
  }
  // ----------------------------------------------------------------------------------------------- foes: attacks on Way Big
  shoot(foe, wb) {
    const g = this.g, o = _v.set(foe.home.x, foe.type === 'tank' ? 3.2 : 1.5, foe.home.z); if (foe.type === 'tank' && foe.P.turret) o.addScaledVector(_w.set(Math.sin(foe.yaw), 0, Math.cos(foe.yaw)), 5);
    const tp = wb.chestWorld(_w), dir = tp.clone().sub(o), L = dir.length(); dir.multiplyScalar(1 / L); const sp = foe.type === 'tank' ? 150 : 260, tt = L / sp, big = foe.type === 'tank';
    g.fx.glow.emit({ pos: o.clone(), vel: dir.clone().multiplyScalar(sp), size: big ? 3.4 : 1.8, life: tt, drag: 0, color: big ? [1, 0.7, 0.3] : [1, 0.9, 0.5], alpha: 1 }); g.fx.glow.emit({ pos: o.clone(), size: big ? 8 : 3, life: 0.1, drag: 0, color: [1, 0.8, 0.4], alpha: 1 });
    if (big) g.sfx.crash(0.18 * clamp(1.3 - L / 400, 0.1, 1)); this.pending.add({ t: tt, foe, dmg: big ? 36 : 1.2, big, dir: dir.clone(), kb: big ? 4.0e6 : 0 });
  }
  foeStrike(foe, wb) {
    const T = foe.cfg, P = foe.P, f = _v; P.foreR.updateWorldMatrix(true, false); f.set(0, -0.22 * foe.h, 0).applyMatrix4(P.foreR.matrixWorld); const hit = wb.nearestBody(f); this.fx.crashAt(f.clone().setY(Math.max(1, f.y)), foe.h * 0.25, 0.5);
    // the blow lands if Way Big's body is within the foe's arm reach, measured from the foe's chest (the same distance the approach logic stops at)
    const ch = new THREE.Vector3(foe.home.x, foe.h * 0.6, foe.home.z), body = wb.nearestBody(ch), reach = foe.h * 0.55;
    if (body.d <= reach) { const dir = _w.set(wb.pos.x - foe.home.x, 0, wb.pos.z - foe.home.z).normalize(); const pt = (body.point || f).clone(); this.fx.crashAt(pt.clone().setY(Math.max(1, pt.y)), foe.h * 0.3, 0.3); wb.takeHit(T.dmg, pt, dir.clone(), T.impulse * 1.0, 'giant'); }
    else this.damageSphere(f, foe.h * 0.28, 500, { dir: _w.set(Math.sin(foe.yaw), 0, Math.cos(foe.yaw)), src: 'foe' });
    const P2 = this.propSys; if (P2) P2.shockwave(f, foe.h * 0.9, 12, 80, 160);
  }
  update(dt) {
    this.flashCd = Math.max(0, this.flashCd - dt); this.toastCd = Math.max(0, this.toastCd - dt);
    if (!this.active) return;
    this.updateDebris(dt);
    for (const f of this.foes) f.update(dt);
    for (const s of this.pending) { s.t -= dt; if (s.t <= 0) { this.pending.delete(s); if (this.wb && this.wb.alive && this.wb.root.visible) { const wb = this.wb, tgt = wb.chestWorld(_w); if (wb.nearestBody(tgt).d < 30 || true) { const pt = wb.nearestBody(_v.set(tgt.x, tgt.y, tgt.z)).point || tgt; this.fx.crashAt(pt.clone(), s.big ? 6 : 1.2, s.big ? 0.12 : 0); wb.takeHit(s.dmg, pt.clone(), s.dir, s.kb, s.big ? 'shell' : 'bullet'); } } } }
  }
}
