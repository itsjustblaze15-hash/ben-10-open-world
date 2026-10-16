// ALBEDO - the third AI-only boss (never playable, never in the Omnitrix). Human form: his own Mixamo model (assets/albedo.glb). Alien forms: second instances of the real alien controllers
// (src/albedo_forms.js) running on a puppet context (src/albedo_ctx.js) and flown by an AI pilot (src/albedo_ai.js). Ultimate Wildmutt (src/albedo_uw.js) is only reachable from Wildmutt.
//
//   states    HUMAN (can transform) -> TRANSFORMING -> ALIEN  <-> SWITCHING (direct alien -> alien, never via Albedo)  ->  REVERTING -> RECHARGING (human, cannot transform) -> HUMAN ...
//             DEFEATED (stays down until RESPAWN / DESPAWN)
//   timers    ONE shared transformation timer (cfg.transformTime = 120 s) that starts with the first alien form and is never reset by a switch or by Ultimate Wildmutt;
//             at 0 he reverts to Albedo and a recharge (cfg.rechargeTime = 60 s) begins during which he cannot transform. Both run on world time and stop while the game is paused.
//   hp        ONE pool for every form (transforming never heals); incoming hits are collected per frame and resolved once through Albedo's own impact body (same physics as the player's).
import * as THREE from 'three';
import { Dummy } from './dummies.js';
import { attackImpact, BODY } from './impact.js';
import { KevinHud } from './kevin_fx.js';
import { buildAlbedoRig } from '../animations/albedorig.js';
import { AlbedoHuman } from './albedo_human.js';
import { makeCtx, inSink } from './albedo_ctx.js';
import { ALIENS, UW, buildForm } from './albedo_forms.js';
import { PROFILES, Pilot, pickAlien, FORM_NAMES } from './albedo_ai.js';
import { clamp, damp, rand, angleDelta } from './util.js';

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _dir = new THREE.Vector3();
const hyp = Math.hypot;

/** tunables - everything is per-instance, so the player / a test can change it live (albedo.cfg.switchMin = ...) */
export const ACFG = {
  hp: 5500, dmgMulAlien: 0.8, dmgMulHuman: 1.15, hitCap: 0.05,                 // one pool; between Kevin (4000) and Vilgax (7000)
  transformTime: 120, rechargeTime: 60,                                         // the spec's 120 s / 60 s
  switchMin: 10, switchMax: 25,                                                 // seconds between direct alien -> alien switches (configurable; never below 10 in play)
  humanMinWait: 4, humanMaxWait: 9,                                             // how long he fights as Albedo before he transforms
  xformIn: 0.95, switchLock: 0.45, revertLock: 0.6,                             // Omnitrix raise before the first alien / lock after a switch / after reverting
  sight: 95, walk: 2.6, run: 5.4, dmgScaleHuman: 2.0, dmgScaleAlien: 0.62, kbScaleHuman: 1.0, kbScaleAlien: 0.8,
  uwDamageMul: 2.0,                                                             // Ultimate Wildmutt: 2x Wildmutt's physical damage / knockback / strength (NOT speed, attack speed or HP)
  maxSwitchWait: 5,                                                             // a queued switch (grab / throw in progress) is forced after this long
};

export class Albedo extends Dummy {
  constructor(scene, world, pos, yaw, game, A) {
    super(scene, world, pos, yaw, 'ALBEDO');
    this.scene = scene; this.g = game; this.A = A; this.cfg = Object.assign({}, ACFG); this.isBoss = true; this.isAlbedo = true; this.present = true; this.name = 'ALBEDO'; this.label = 'ALBEDO';
    this.root.traverse(o => { if (o.isMesh) o.visible = false; }); this.bar.visible = false; this.drawBar = () => {}; this.mats = [];
    this.maxHp = this.hp = this.cfg.hp; this.spawnYaw = yaw; this.aiOn = true;
    this.hudK = new KevinHud({ id: 'albbar', name: 'ALBEDO', vitals: false });
    this.hudK.boss.id = 'albbar';
    // ---- puppet context + the human form (always built; the 12 alien forms are built on demand / in the background)
    this.ctx = makeCtx(game, this); this.ctx.owner = this;
    inSink(() => { this.rigH = buildAlbedoRig(A.albedo); this.human = new AlbedoHuman(this.ctx, this.rigH); });
    this.human.root.visible = false; this.forms = { human: this.human }; this.cur = this.human; this.curId = 'human'; this.ctx.player = this.human; this.ctx.chars.id = 'ben';
    this.target = this.ctx.target; this.pilot = new Pilot(this);
    this.orb = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: 0xff2a3a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false })); this.orb.visible = false; this.orb.renderOrder = 20; scene.add(this.orb);
    this.dmgScale = this.cfg.dmgScaleHuman; this.kbScale = this.cfg.kbScaleHuman; this.takenMul = this.cfg.dmgMulHuman; this.hitsOff = false; this.invuln = false;
    this.pend = { n: 0, dmg: 0, kx: 0, kz: 0, dx: 0, dz: 0, up: 0, pt: null };
    this.hist = []; this.eff = {}; this.stats = { switches: 0, uw: 0, transforms: 0, reverts: 0, hits: 0, dmgTaken: 0, playerHits: 0, built: 0, queued: 0, forced: 0, byForm: {} };
    this.pos = this.root.position; this.home = this.root.position;
    this.buildQueue = []; this.buildT = 0;
    this.reset0();
  }
  // ============================================================================================================================ state
  reset0() {
    this.t = 0; this.state = 'human'; this.xfRemain = 0; this.rcRemain = 0; this.swT = 0; this.xfIn = 0; this.lock = 0; this.humanWait = 0; this.queued = null; this.queuedT = 0; this.uwEnabled = true;
    this.dead = false; this.deadT = 0; this.hitFlash = 0; this.invuln = false; this.hitsOff = false; this.fx = 0; this.lastSwitchT = -99; this.form = 'human'; this.stuckT = 0;
    this.pilot.reset(); this.hist.length = 0; this.eff = {}; this.pend = { n: 0, dmg: 0, kx: 0, kz: 0, dx: 0, dz: 0, up: 0, pt: null };
  }
  get mgrState() { return !this.present ? 'despawned' : this.dead ? 'defeated' : 'alive'; }
  get isAlien() { return this.curId !== 'human'; }
  get xfActive() { return this.state === 'alien' || this.state === 'switching' || this.state === 'uw'; }
  get phase() { const f = this.hp / this.maxHp; return f < 0.35 ? 2 : f < 0.7 ? 1 : 0; }
  phaseLabel() { if (this.dead) return 'DEFEATED'; if (this.curId === 'human') return this.state === 'recharging' ? 'ALBEDO · RECHARGING ' + Math.ceil(this.rcRemain) + 's' : this.state === 'transforming' ? 'ALBEDO · TRANSFORMING' : 'ALBEDO'; return (FORM_NAMES[this.curId] || this.curId.toUpperCase()) + ' · ' + Math.ceil(this.xfRemain) + 's'; }
  stateLabel() { const ib = this.ctx.impact.body; if (this.dead) return 'DEFEATED'; if (ib.state === 'air') return 'LAUNCHED'; if (ib.state === 'stagger' && ib.tier >= 2) return 'STAGGERED'; if (this.state === 'transforming') return 'TRANSFORMING!'; if (this.lock > 0 && this.state === 'switching') return 'SWITCHING'; if (this.curId === UW) return 'ULTIMATE WILDMUTT'; return ''; }
  // ============================================================================================================================ BOSS MANAGER hooks
  /** SPAWN: the one instance enters the world: full HP, human form, timers reset, normal model, collision + combat on, safe spawn spot */
  bossSpawn() {
    if (this.present) return false; const w = this.world;
    if (!w.hittables.includes(this)) w.hittables.push(this); if (!w.cylinders.includes(this.collider)) w.cylinders.push(this.collider);
    this.present = true; this.root.visible = true; this.aiOn = true; this.respawn(); this.startBuilding(); this.hudK.update(0.016, this, this.g); return true;
  }
  /** DESPAWN: complete removal (model, AI, attacks, projectiles, effects, collision, hitboxes, timers, bar) - not just hidden */
  bossDespawn() {
    if (!this.present) return false; const g = this.g, w = this.world, imp = g.impact;
    this.respawn();                                              // the shared reset: every alien ability / projectile / hazard of every built form, timers, state, body
    this.aiOn = false; this.present = false; this.collider.dead = true; this.cur.root.visible = false; this.human.root.visible = false; this.orb.visible = false;
    const hi = w.hittables.indexOf(this); if (hi >= 0) w.hittables.splice(hi, 1); const ci = w.cylinders.indexOf(this.collider); if (ci >= 0) w.cylinders.splice(ci, 1);
    this.root.visible = false; this.hudK.hide(); this.buildQueue.length = 0; this.xfRemain = 0; this.rcRemain = 0;
    if (imp.ctrl.by === this) { if (imp.ctrl.mode === 'grabbed') imp.release(null, 0, 0); else imp.unlock(); }
    return true;
  }
  /** RESPAWN / SPAWN reset: HP, forms, timers, cooldowns, AI memory; the model goes back to Albedo */
  respawn() {
    const g = this.g; this.clearAbilities(); this.dead = false; this.hp = this.maxHp = this.cfg.hp;
    if (this.curId !== 'human') this.swapController('human', true);
    this.human.setDown(false); this.human.cancelAll(); this.human.omni.raise = 0; this.human.omni.press = 0; this.human.popScale(1); this.human.root.rotation.x = 0; this.human.root.rotation.z = 0;
    this.ctx.impact.reset(); this.ctx.impact.body.reset(); this.ctx.impact.configure();
    this.reset0(); this.collider.dead = false; this.ctx.target.pend = this.ctx.target.fresh(); this.ctx.target.dot = 0; this.hudK.trail = 1;
    this.home.copy(this.spawn); this.root.position.copy(this.home); this.placeAtSpawn();
    this.human.pos.copy(this.home); this.human.vel.set(0, 0, 0); this.human.yaw = this.yaw; this.human.grounded = true; this.human.mode = 'ground'; this.human.root.visible = this.present !== false; this.human.root.rotation.y = this.yaw;
    this.human.root.updateMatrixWorld(true); this.human.pose(0.016);
    this.humanWait = rand(this.cfg.humanMinWait, this.cfg.humanMaxWait); this.sizeBody(); this.syncBody();
  }
  placeAtSpawn() {
    const g = this.g, w = g.world, P = g.player, sp = this.spawn, cand = [[0, 0]]; for (let r = 4; r <= 16; r += 4) for (let k = 0; k < 8; k++) cand.push([Math.cos(k * 0.785) * r, Math.sin(k * 0.785) * r]);
    let best = null;
    for (const [ox, oz] of cand) {
      const p = _a.set(sp.x + ox, sp.y, sp.z + oz).clone(), y0 = p.y; const cd = this.collider.dead; this.collider.dead = true; w.resolveXZ(p, 0.5, y0 + 0.2, 1.7, 0.45); this.collider.dead = cd;
      if (Math.hypot(p.x - (sp.x + ox), p.z - (sp.z + oz)) > 0.05) continue;
      const gy = w.groundAt(p.x, p.z, y0 + 0.5, 1.0, 0.3); if (!(gy > -1) || Math.abs(gy - sp.y) > 1.5) continue;
      if (w.lagoon && w.lagoon.depthAt && w.lagoon.depthAt(p.x, p.z) > 0.3) continue;
      if (Math.hypot(p.x - P.pos.x, p.z - P.pos.z) < 8) continue;
      if ((g.bossList || []).some(o => o !== this && o.present && o.home && Math.hypot(p.x - o.home.x, p.z - o.home.z) < 7)) continue;
      best = [p.x, gy, p.z]; break;
    }
    if (!best) best = [sp.x, sp.y, sp.z];
    this.home.set(best[0], best[1], best[2]); this.root.position.copy(this.home);
    this.yaw = Math.atan2(P.pos.x - this.home.x, P.pos.z - this.home.z);
  }
  /** background building of the 12 alien controllers (one per ~0.35 s) so the first switch never hitches; a form that is needed earlier is built at once */
  startBuilding() { this.buildQueue = [...ALIENS, UW].filter(id => !this.forms[id]); this.buildT = 1.0; }
  ensure(id) {
    if (this.forms[id]) return this.forms[id];
    const c = buildForm(this.ctx, this.A, id); this.forms[id] = c; this.stats.built++; c.root.visible = false; return c;
  }
  // ============================================================================================================================ incoming hits (collected per frame, resolved once)
  applyHit(point, dir, dmg) { if (this.dead || !this.present) return; const p = this.pend; p.n++; p.dmg += dmg; const w = Math.max(dmg, 1); p.dx += dir.x * w; p.dz += dir.z * w; if (point) p.pt = point.clone(); this.hitFlash = 0.14; }
  shove(dir, speed) { const p = this.pend; p.n++; p.kx += dir.x * speed; p.kz += dir.z * speed; }
  launch(vy) { const p = this.pend; p.n++; p.up = Math.max(p.up, vy); }
  knock(dir, force) { this.shove(dir, force * 0.9); }
  release() { /* bosses cannot be grabbed */ }
  intersect(o, d, maxT) { if (this.dead && this.deadT > 2.5) return null; return super.intersect(o, d, maxT); }
  resolveHits() {
    const p = this.pend; if (!p.n) return; const g = this.g, P = g.player; let dmg = p.dmg, sh = hyp(p.kx, p.kz), up = p.up, mag = hyp(p.dx, p.dz), dx, dz; const pt = p.pt;
    if (sh > 0.05) { dx = p.kx / sh; dz = p.kz / sh; } else if (mag > 1e-4) { dx = p.dx / mag; dz = p.dz / mag; } else { dx = this.pos.x - P.pos.x; dz = this.pos.z - P.pos.z; const m = hyp(dx, dz) || 1; dx /= m; dz /= m; }
    this.pend = { n: 0, dmg: 0, kx: 0, kz: 0, dx: 0, dz: 0, up: 0, pt: null };
    if (this.dead || this.invuln) return;
    if (sh < 0.05) sh = clamp(dmg * 0.11, 0, 4.5);
    sh = Math.min(sh, 60); this.stats.hits++;
    { const d = this.pilot.defend(dmg, sh); if (d.dodged) { this.stats.dodged = (this.stats.dodged || 0) + 1; return; } dmg *= d.mul; sh *= d.shMul; }       // V27: block / dodge by the current form
    const imp = attackImpact({ damage: dmg, knockbackForce: sh, upwardForce: up * 0.8, staggerDuration: 0.24 + dmg * 0.004, knockdownThreshold: 13, launchThreshold: 24, ordinary: sh < 7, dir: _dir.set(dx, 0, dz).clone(), point: pt || this.pos.clone().setY(this.pos.y + 1), fx: false });
    const r = this.ctx.impact.hitPlayer(imp);
    this.pilot.onHurt(dmg, r);
  }
  /** all damage lands here (AlbedoImpact.damagePlayer / fall + wall damage of the body): one shared pool for every form */
  takeDamage(dm, kind) {
    if (this.dead || dm <= 0 || !this.present) return; if (kind !== 'test') dm = Math.min(dm, this.maxHp * this.cfg.hitCap); this.hp = Math.max(0, this.hp - dm); this.stats.dmgTaken += dm; this.hitFlash = Math.max(this.hitFlash, 0.1);
    this.stats.byForm[this.curId] = (this.stats.byForm[this.curId] || 0) + dm;
    if (this.hp <= 0) this.die();
  }
  // ============================================================================================================================ defeat
  die() {
    if (this.dead) return; this.hp = 0; this.dead = true; this.deadT = 0;
    this.clearAbilities();                                                         // attacks, projectiles, hazards, flight / swim / ball state, queued switches, timers
    this.queued = null; this.state = 'dead'; this.xfRemain = 0; this.rcRemain = 0; this.pilot.reset(); this.invuln = false; this.hitsOff = true;
    const wasAlien = this.curId !== 'human'; const pos = this.cur.pos.clone(), yaw = this.cur.yaw;
    if (wasAlien) { this.swapController('human', true); this.flash(pos, 0.8); }
    const h = this.human; h.cancelAll(); h.vel.set(0, 0, 0); h.pos.copy(pos); h.pos.y = Math.max(h.pos.y, this.floor(pos) ); h.grounded = true; h.mode = 'ground'; h.yaw = yaw; h.root.rotation.y = yaw; h.setDown(true);
    this.ctx.impact.body.reset(); this.ctx.impact.unlock();
    this.g.hud.toast('ALBEDO DEFEATED'); this.g.sfx.boom(0.5); this.g.camera.addTrauma(0.3); this.sizeBody();
  }
  floor(p = this.pos) { return this.g.world.groundAt(p.x, p.z, p.y + 0.5, 1.2, 0.3); }
  /** drop everything every built form may be doing (called on defeat, despawn, respawn, revert) */
  clearAbilities() {
    for (const id in this.forms) { const c = this.forms[id]; if (id === 'human') { c.cancelAll(); continue; } this.cleanForm(id, c); }
    this.ctx.target.pend = this.ctx.target.fresh(); const x = this.ctx; if (x.slime && this.g.gooProxy) x.slime.clear(this.g.gooProxy);
  }
  cleanForm(id, c) {
    const x = this.ctx; inSink(() => {
      try { if (id === 'diamondhead') { x.power.release(); x.p2.releaseAll(); x.p2.act = null; x.p2.noDash = false; x.p2.layer.w = 0; x.power.state = 'idle'; x.power.queue.length = 0; x.power.held = false; if (x.p2.clearAll) x.p2.clearAll(); }
        else if (id === 'xlr8') { c.combo = null; c.cancelAct(); c.layer.w = 0; }
        else if (id === 'heatblast') { c.cancelAll(); if (c.mode === 'fly' || c.mode === 'takeoff') { c.mode = c.grounded ? 'ground' : 'air'; } c.flyBoost = 0; c.softLand = false; c.lmbHeld = false; }
        else if (c.leave) { c.leave(); c.cancelAll && c.cancelAll(); }
        else if (c.cancelAll) c.cancelAll(); } catch (e) { console.warn('albedo cleanForm', id, e); }
      if (c.deactivate) { try { c.deactivate(); } catch (e) { console.warn('albedo deactivate', id, e); } } else c.root.visible = false;
      c.root.visible = false;
    });
    if (x.fire && (id === 'heatblast' || id === 'upgrade')) x.fire.clear();
  }
  // ============================================================================================================================ switching
  /** replace the active controller (the single place where model / collision / physics state change) */
  swapController(id, quiet = false) {
    const from = this.cur, to = this.ensure(id) || this.human, x = this.ctx;
    if (from === to) return;
    inSink(() => {
      x.impact.pre();
      if (from !== this.human) this.cleanForm(this.curId, from); else { from.cancelAll(); from.root.visible = false; }
      // the new body takes over the old one's position / facing / velocity (no teleport)
      const st = { pos: from.pos.clone(), vel: from.vel.clone(), yaw: from.yaw, grounded: from.grounded };
      if (st.vel && from.form === 'ball' && from.v) st.vel.copy(from.v);
      if (to.activate) to.activate(st); else { to.pos.copy(st.pos); to.vel.copy(st.vel); to.yaw = st.yaw; to.grounded = st.grounded; to.mode = st.grounded ? 'ground' : 'air'; to.root.rotation.y = to.yaw; }
      x.player = to; x.chars.id = id === 'human' ? 'ben' : id === UW ? 'wildmutt' : id; x.impact.onSwitch(); x.impact.configure(); to.root.visible = true; to.root.updateMatrixWorld(true);
      if (id !== 'human' && to.activate === undefined) to.root.visible = true;
    });
    this.cur = to; this.curId = id; this.form = id; this.pilot.onForm(id, to);
    this.dmgScale = id === 'human' ? this.cfg.dmgScaleHuman : this.cfg.dmgScaleAlien * (id === UW ? this.cfg.uwDamageMul : 1); this.kbScale = id === 'human' ? this.cfg.kbScaleHuman : this.cfg.kbScaleAlien * (id === UW ? this.cfg.uwDamageMul : 1);
    this.takenMul = id === 'human' ? this.cfg.dmgMulHuman : this.cfg.dmgMulAlien;
    this.sizeBody(); this.syncBody();
  }
  /** Omnitrix-red transformation burst at a position */
  flash(p, sc = 1) {
    const g = this.g, c = _a.set(p.x, p.y + 1.1 * sc, p.z).clone(); this.orb.position.copy(c); this.orb.visible = true; this.fx = 0.0001; this.orbSc = sc;
    g.fx.surface.ring(new THREE.Vector3(p.x, p.y + 0.08, p.z), UP, 5.5 * sc, 0.5, 0xff3a4a);
    g.fx.glow.emit({ pos: c, size: 3.0 * sc, life: 0.18, drag: 0, color: [1, 0.25, 0.3], alpha: 1 });
    for (let i = 0; i < 40; i++) g.fx.glow.emit({ pos: c, vel: new THREE.Vector3(rand(-1, 1), rand(-0.4, 1), rand(-1, 1)).normalize().multiplyScalar(rand(4, 11) * sc), size: rand(0.3, 0.8) * sc, life: rand(0.3, 0.6), drag: 2.2, color: [1, rand(0.1, 0.35), rand(0.15, 0.3)] });
    const d = Math.hypot(g.player.pos.x - p.x, g.player.pos.z - p.z); g.camera.addTrauma(0.12 * clamp(1 - d / 40, 0.1, 1)); g.sfx.transform();
  }
  /** direct alien -> alien switch: a real transformation (model, collider, movement, animations, attacks) - HP and the 120 s timer are untouched */
  switchTo(id) {
    if (this.dead || id === this.curId) return false; const from = this.curId;
    this.ensure(id); const p = this.cur.pos.clone(); this.flash(p, Math.min(2.4, Math.max(0.5, (this.cur.fxScale || 1))));
    this.swapController(id); this.lock = this.cfg.switchLock; this.state = id === UW ? 'uw' : 'switching'; this.lastSwitchT = this.t; this.stats.switches++; if (id === UW) this.stats.uw++;
    this.hist.unshift(id); if (this.hist.length > 4) this.hist.pop();
    this.swT = rand(this.cfg.switchMin, this.cfg.switchMax); this.g.hud.toast('ALBEDO → ' + (FORM_NAMES[id] || id.toUpperCase())); void from;
    return true;
  }
  /** first transformation (human -> alien): random starting alien, then the shared 120 s timer starts */
  beginAlien() {
    const id = pickAlien(this, { start: true }); this.stats.transforms++; this.ensure(id); this.flash(this.cur.pos, 1);
    this.swapController(id); this.xfRemain = this.cfg.transformTime; this.lock = this.cfg.switchLock; this.state = 'alien'; this.lastSwitchT = this.t; this.hist.unshift(id);
    this.swT = rand(this.cfg.switchMin, this.cfg.switchMax); this.human.omni.raise = 0; this.human.omni.press = 0; this.g.hud.toast('ALBEDO → ' + FORM_NAMES[id]);
  }
  /** timer ran out: every alien ability off, the alien model is removed, Albedo is restored and the 60 s recharge begins */
  revert() {
    const p = this.cur.pos.clone(); this.flash(p, 1); this.swapController('human'); this.stats.reverts++;
    this.state = 'recharging'; this.xfRemain = 0; this.rcRemain = this.cfg.rechargeTime; this.lock = this.cfg.revertLock; this.queued = null; this.swT = 0;
    this.human.cancelAll(); this.g.hud.toast('ALBEDO REVERTS — RECHARGING'); this.pilot.reset();
  }
  /** safe to swap right now? (grabs, throws, possessions, merged tech and held objects are never cut off mid-way - the switch is queued) */
  safeNow() { const c = this.cur, f = PROFILES[this.curId]; if (this.curId === 'human') return true; const ib = this.ctx.impact.body; if (ib.state === 'air') return false; return f && f.unsafe ? !f.unsafe(c, this) : true; }
  // ============================================================================================================================ main update
  update(dt) {
    if (!this.present || dt <= 1e-6) return;
    if (this.held && !this.dead) { this.root.updateMatrixWorld(true); this.pend && (this.pend.n = 0); return; }       // V30: carried by Way Big - the hand drives it
    const g = this.g, cfg = this.cfg; this.t += dt; this.hitFlash = Math.max(0, this.hitFlash - dt);
    // background form building
    if (this.buildQueue.length && !this.dead) { this.buildT -= dt; if (this.buildT <= 0) { this.buildT = 0.35; const id = this.buildQueue.shift(); if (!this.forms[id]) { try { this.ensure(id); } catch (e) { console.warn('albedo build', id, e); } } } }
    if (this.fx > 0) this.updateFlash(dt);
    this.resolveHits();
    if (this.dead) { this.updateDead(dt); this.hudK.update(dt, this, g); return; }
    // ---- timers + state machine
    this.lock = Math.max(0, this.lock - dt);
    this.updateStates(dt);
    // ---- the controller step (puppet)
    this.step(dt);
    this.syncBody();
    this.hudK.update(dt, this, g);
  }
  updateStates(dt) {
    const cfg = this.cfg, g = this.g, h = this.human;
    switch (this.state) {
      case 'human': {
        this.humanWait -= dt; h.omni.raise = damp(h.omni.raise, 0, 8, dt);
        if (this.humanWait <= 0 && this.rcRemain <= 0 && this.seesPlayer()) { this.state = 'transforming'; this.xfIn = cfg.xformIn; this.human.cancelAll(); this.human.blocking = false; }
        break;
      }
      case 'transforming': {
        this.xfIn -= dt; const k = 1 - this.xfIn / cfg.xformIn; h.omni.raise = clamp(k * 3, 0, 1); h.omni.press = clamp((k - 0.45) * 3.5, 0, 1);
        if (this.xfIn <= 0) this.beginAlien();
        break;
      }
      case 'recharging': {
        this.rcRemain -= dt; if (this.rcRemain <= 0) { this.rcRemain = 0; this.state = 'human'; this.humanWait = rand(cfg.humanMinWait * 0.5, cfg.humanMaxWait * 0.7); }
        break;
      }
      case 'alien': case 'switching': case 'uw': {
        this.xfRemain -= dt;                                                      // THE ONE timer - never reset by a switch or by Ultimate Wildmutt
        if (this.xfRemain <= 0) { this.revert(); break; }
        if (this.state === 'switching' && this.lock <= 0) this.state = 'alien';
        this.swT -= dt;
        if (this.queued) { this.queuedT += dt; if (this.safeNow() || this.queuedT > cfg.maxSwitchWait) { if (!this.safeNow()) { this.stats.forced++; } const id = this.queued; this.queued = null; this.switchTo(id); } }
        else if (this.swT <= 0 && this.lock <= 0) {
          const id = pickAlien(this, {});
          if (id && id !== this.curId) { if (this.safeNow()) this.switchTo(id); else { this.queued = id; this.queuedT = 0; this.stats.queued++; } } else this.swT = 2;
        }
        break;
      }
    }
  }
  seesPlayer() { const P = this.g.player, d = hyp(P.pos.x - this.pos.x, P.pos.z - this.pos.z); return d < this.cfg.sight; }
  /** one frame of the active controller, driven by the pilot (same call order as the player's step() in main.js) */
  step(dt) {
    const g = this.g, x = this.ctx, c = this.cur, id = this.curId, P = g.player, T = x.target;
    T.sync(); const inp = this.pilot.think(dt, this.lock > 0 || this.state === 'transforming');
    x.impact.pre();
    this.collider.dead = true;                                                     // the puppet does not collide with its own boss collider
    inSink(() => {
      x.impact.begin(inp);
      const aimPt = this.pilot.aimPt; x.camera.aimAt(_a.set(c.pos.x, c.pos.y + Math.min((c.colH || 1.6) * 0.7, 3), c.pos.z), aimPt); x.camera.yaw = this.pilot.camYaw;
      this.pilot.presses(dt);
      if (id === 'diamondhead') {
        c.updatePhysics(dt, inp, this.pilot.camYaw, c.combat);
        const aim = x.power.update(dt, aimPt), layer = x.p2.update(dt, aimPt); c.updateAnim(dt, aim, layer);
      } else if (id === UW || id === 'wildmutt' || c.updatePowers) {
        c.updatePhysics(dt, inp, this.pilot.camYaw); c.updatePowers(dt, aimPt, true);
        c.updateAnim(dt);
      } else { c.updatePhysics(dt, inp, this.pilot.camYaw); c.updateAnim(dt); }
      if (id === 'human') { c.updatePowers && c.updatePowers(dt); }
      this.extraUpdates(dt, id, c);
      x.impact.post(dt);
    });
    T.resolve(dt);
    this.collider.dead = this.dead;
  }
  /** projectile / system updates that the player's step() runs separately (shots, fire, slime) */
  extraUpdates(dt, id, c) {
    const x = this.ctx;
    if (x.fire && (id === 'heatblast' || id === 'upgrade')) x.fire.update(dt);
    if (c.updateShots) c.updateShots(dt, false);
  }
  updateDead(dt) {
    this.deadT += dt; const h = this.human; inSink(() => { h.updateAnim(dt); }); this.syncBody();
  }
  updateFlash(dt) {
    this.fx += dt; const T = 0.5, k = clamp(this.fx / T, 0, 1), sc = this.orbSc || 1; const p = this.cur.pos; this.orb.position.set(p.x, p.y + 1.1 * sc, p.z); this.orb.scale.setScalar((0.7 + 3.2 * (1 - Math.pow(1 - k, 3))) * sc); this.orb.material.opacity = 0.55 * Math.pow(1 - k, 1.6);
    if (this.fx >= T) { this.fx = 0; this.orb.visible = false; this.orb.material.opacity = 0; }
  }
  /** collider / hit spheres / hit-test radius follow the active body; the root marker sits on its feet */
  sizeBody() {
    const c = this.cur, H = Math.max(c.colH || 1.6, 0.2), R = Math.max(c.rad || 0.4, 0.1); this.collider.r = R; this.collider.h = H; this.meleeRadius = Math.max(0.8, R * 1.1);
    const s = this.spheres; s.length = 0; const r = Math.max(R, H * 0.2);
    s.push({ local: new THREE.Vector3(0, H * 0.22, 0), r }, { local: new THREE.Vector3(0, H * 0.5, 0), r }, { local: new THREE.Vector3(0, H * 0.8, 0), r: r * 0.85 });
    if (this.curId === 'waybig') this.meleeRadius = R;
  }
  syncBody() {
    const c = this.cur; this.root.position.copy(c.pos); this.root.rotation.y = c.yaw || 0; this.root.updateMatrixWorld(true);
    if (this.curId !== 'human' && c.colH && Math.abs(c.colH - this.collider.h) > 0.05) this.sizeBody();
    this.yaw = c.yaw;
  }
  debugText() {
    const c = this.cur, p = this.pos, ib = this.ctx.impact.body; if (!this.present) return 'ALBEDO  despawned';
    return `ALBEDO  ${this.dead ? 'DEFEATED' : this.state.toUpperCase()}  form ${this.curId}  hp ${Math.ceil(this.hp)}/${this.maxHp}\nxf ${this.xfRemain.toFixed(1)}s  recharge ${this.rcRemain.toFixed(1)}s  nextSwitch ${Math.max(0, this.swT).toFixed(1)}s${this.queued ? ' queued ' + this.queued : ''}  lock ${this.lock.toFixed(2)}  body ${ib.state}\npos ${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}  switches ${this.stats.switches} uw ${this.stats.uw} built ${Object.keys(this.forms).length - 1}/12  hist ${this.hist.join('>')}\n${this.pilot.debug()}`;
  }
}
