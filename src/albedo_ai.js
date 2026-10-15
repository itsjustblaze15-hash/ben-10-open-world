// ALBEDO - the pilot. It flies whichever controller Albedo currently has (his human form or one of the alien forms) the way a player would: it sets the movement input, aims the puppet camera
// at the real player and PRESSES the same keys / mouse button the player would press. Every ability is the controller's own code - the pilot only decides when.
//
//   PROFILES   per form: preferred fighting distance, the list of real attacks (key, edge-distance window, own cooldown, weight) and the form's "unsafe to cut off" test
//   pickAlien  intelligent RANDOM choice of the next form: weighted by the situation (never a fixed sequence, never a rule)
//   Pilot      movement + attack decisions for the active form
import * as THREE from 'three';
import { clamp, rand, angleDelta } from './util.js';

const hyp = Math.hypot;
const _v = new THREE.Vector3();

export const FORM_NAMES = { human: 'ALBEDO', diamondhead: 'DIAMONDHEAD', xlr8: 'XLR8', fourarms: 'FOUR ARMS', heatblast: 'HEATBLAST', upgrade: 'UPGRADE', wildmutt: 'WILDMUTT', ghostfreak: 'GHOSTFREAK', ripjaws: 'RIPJAWS', stinkfly: 'STINKFLY', cannonbolt: 'CANNONBOLT', greymatter: 'GREY MATTER', waybig: 'WAY BIG', ultimatewildmutt: 'ULTIMATE WILDMUTT' };

// k: 'LMB' | key code | 'fn:<name>' ; min/max: EDGE distance window (centre distance minus both radii) ; cd: pilot-side cooldown (the controller has its own) ; w: weight ; hold: seconds the button stays down
const M = (k, min, max, cd, w = 1, extra) => Object.assign({ k, min, max, cd, w }, extra);
const busyOf = (c, x) => !!(c.act || c.combo || c.climb || (x && x.p2 && c === x.dh && (x.p2.busy || x.power.busy)));

export const PROFILES = {
  human: { range: [0.6, 1.6], moves: [M('LMB', 0, 1.7, 0.18, 1)] },
  diamondhead: { range: [2.5, 14], moves: [M('KeyQ', 0, 3.2, 0.3, 1.2), M('LMB', 3, 14, 0.55, 1, { hold: 0.12 }), M('KeyG', 1, 7, 6, 0.6), M('KeyX', 5, 14, 9, 0.5)] },
  xlr8: { range: [0.8, 4], moves: [M('LMB', 0, 2.6, 0.2, 1.4), M('KeyQ', 1, 10, 2.6, 0.9), M('KeyE', 0, 3.5, 5, 0.7), M('KeyF', 0, 7, 8, 0.4), M('KeyX', 2, 14, 12, 0.35)] },
  fourarms: { range: [0.8, 3.2], moves: [M('LMB', 0, 4.5, 0.25, 1.4), M('KeyE', 0, 9, 3, 0.8), M('KeyF', 0, 4.5, 4, 0.6), M('KeyR', 0, 9, 8, 0.5), M('KeyZ', 0, 3.6, 3, 0.5)] },
  heatblast: { range: [5, 20], moves: [M('LMB', 2, 10, 0.45, 1.2), M('KeyQ', 3, 45, 3, 0.8), M('KeyE', 0, 2.6, 0.4, 0.8), M('KeyF', 0, 7, 5, 0.6), M('KeyR', 0, 8, 7, 0.5)] },
  upgrade: { range: [3, 14], moves: [M('KeyQ', 0, 40, 2.8, 1)] },
  wildmutt: { range: [0.7, 3], moves: [M('LMB', 0, 3.0, 0.3, 1.3), M('KeyF', 0, 2.0, 2.2, 1), M('KeyR', 1.5, 10, 5, 0.9)] },
  ghostfreak: { range: [1, 4], moves: [M('LMB', 0, 3.0, 0.3, 1.2)] },
  ripjaws: { range: [0.8, 3.2], moves: [M('LMB', 0, 2.0, 0.3, 1.2), M('KeyE', 0, 2.5, 2.5, 0.9)] },
  stinkfly: { range: [3, 14], moves: [M('KeyQ', 0, 2.2, 1.8, 1), M('KeyE', 0, 1.6, 3, 0.7), M('LMB', 2, 45, 1.2, 0.9)] },
  cannonbolt: { range: [0.8, 3.2], moves: [M('LMB', 0, 2.0, 0.3, 1.2), M('KeyE', 0, 3.0, 4, 0.8)] },
  greymatter: { range: [0.05, 0.35], moves: [M('LMB', 0, 0.7, 0.3, 1)] },
  waybig: { range: [6, 40], moves: [M('LMB', 0, 8, 0.8, 1), M('KeyQ', 0, 40, 6, 0.8), M('KeyR', 0, 22, 5, 0.9)] },
  ultimatewildmutt: { range: [0.8, 3.6], moves: [M('LMB', 0, 3.6, 0.28, 1.3), M('KeyF', 0, 2.4, 2.0, 1), M('KeyR', 1.5, 12, 4, 1)] },
};
// grabs / throws / merges / possessions are never cut off mid-way: the switch is queued until the form says it is safe
PROFILES.fourarms.unsafe = (c) => !!(c.holds && c.holds.length) || !!(c.act && (c.act.kind === 'grab' || c.act.kind === 'throw'));
PROFILES.waybig.unsafe = (c) => !!c.hold || !!(c.act && (c.act.kind === 'grab' || c.act.kind === 'throw'));
PROFILES.ghostfreak.unsafe = (c) => !!c.poss || !!(c.act && c.act.kind === 'tentacle');
PROFILES.upgrade.unsafe = (c) => !!c.merged || !!c.techAnim;
PROFILES.cannonbolt.unsafe = (c) => false;
PROFILES.diamondhead.unsafe = (c, a) => !!(a.ctx.p2 && a.ctx.p2.act && a.ctx.p2.act.kind === 'build');

// ------------------------------------------------------------------------------------------------------------------------------ choosing the next form
// traits are tendencies, never rules: each one only nudges the weights
const TR = {
  diamondhead: { melee: 0.6, ranged: 0.9, tank: 0.6 }, xlr8: { mobile: 1, melee: 0.8, escape: 1 }, fourarms: { melee: 1, tank: 1 }, heatblast: { ranged: 1, air: 0.7 },
  upgrade: { ranged: 0.6, melee: 0.2 }, wildmutt: { melee: 0.9, mobile: 0.8 }, ghostfreak: { melee: 0.5, escape: 0.8 }, ripjaws: { melee: 0.8, water: 1 },
  stinkfly: { ranged: 0.8, air: 1, mobile: 0.6, escape: 0.6 }, cannonbolt: { melee: 1, mobile: 0.9, tank: 0.9 }, greymatter: { small: 1, escape: 0.7 }, waybig: { giant: 1, melee: 1, tank: 1 },
};
const POOL = ['diamondhead', 'xlr8', 'fourarms', 'heatblast', 'upgrade', 'wildmutt', 'ghostfreak', 'ripjaws', 'stinkfly', 'cannonbolt', 'greymatter', 'waybig'];

export function situation(a) {
  const g = a.g, P = g.player, pos = a.pos, w = g.world, lag = w.lagoon; const d = hyp(P.pos.x - pos.x, P.pos.z - pos.z);
  const gy = w.groundAt(P.pos.x, P.pos.z, P.pos.y + 0.5, 1.2, 0.3);
  return {
    d, pid: g.chars.id, pFly: P.mode === 'fly' || P.mode === 'takeoff' || (gy > -50 && P.pos.y - gy > 3.5), pSwim: P.mode === 'swim',
    pFast: hyp(P.vel.x, P.vel.z) > 9, pBig: g.chars.id === 'waybig', pTiny: g.chars.id === 'greymatter',
    inWater: !!(lag && lag.depthAt && lag.depthAt(pos.x, pos.z) > 0.8), nearWater: !!(lag && lag.depthAt && (lag.depthAt(pos.x, pos.z) > 0.15 || lag.depthAt(pos.x + 8, pos.z) > 0.3 || lag.depthAt(pos.x - 8, pos.z) > 0.3 || lag.depthAt(pos.x, pos.z + 8) > 0.3 || lag.depthAt(pos.x, pos.z - 8) > 0.3)),
    low: a.hp / a.maxHp < 0.35, hurt: a.hp / a.maxHp < 0.6,
  };
}
/** Way Big is 80 m tall and needs open ground: no buildings, props or other bosses on top of him, and the real player must not already be Way Big (they share the city) */
export function roomForWayBig(a) {
  const w = a.g.world, p = a.pos; for (const b of w.boxes || []) { if (b.noCollide) continue; if (p.x > b.min.x - 3 && p.x < b.max.x + 3 && p.z > b.min.z - 3 && p.z < b.max.z + 3 && b.max.y > p.y + 1.2) return false; }
  if (Math.abs(p.x) > 250 || Math.abs(p.z) > 250) return false; return true;
}
export function pickAlien(a, opt = {}) {
  const s = situation(a), cur = a.curId, hist = a.hist || [], W = [];
  if (cur === 'wildmutt' && !opt.start && a.uwEnabled && Math.random() < 0.3) return 'ultimatewildmutt';       // the ONLY route into Ultimate Wildmutt: from regular Wildmutt, never from the pool
  for (const id of POOL) {
    if (id === cur && !(cur === 'ultimatewildmutt')) continue; if (id === cur) continue;
    if (id === 'waybig' && (s.pBig || !roomForWayBig(a) || s.inWater)) continue;
    if (id === 'ripjaws' && !(s.inWater || s.nearWater || s.pSwim) ) { if (Math.random() < 0.85) continue; }
    if (s.inWater && id !== 'ripjaws' && id !== 'stinkfly' && id !== 'heatblast') continue;                  // a form that would just be dropped in deep water is not offered
    const t = TR[id]; let w = 1;
    if (s.d > 28) w += (t.ranged || 0) * 1.2 + (t.mobile || 0) * 1.0 + (t.air || 0) * 0.6; else if (s.d < 7) w += (t.melee || 0) * 1.2 + (t.tank || 0) * 0.5; else w += (t.ranged || 0) * 0.4 + (t.melee || 0) * 0.4 + (t.mobile || 0) * 0.5;
    if (s.pFly) w += (t.air || 0) * 1.6 + (t.ranged || 0) * 1.2 - (t.melee || 0) * 0.3 - (id === 'cannonbolt' || id === 'fourarms' ? 0.5 : 0);
    if (s.pSwim) w += (t.water || 0) * 2.5;
    if (s.pFast) w += (t.mobile || 0) * 1.0 + (t.ranged || 0) * 0.4;
    if (s.pBig) w += (t.ranged || 0) * 0.8 + (t.escape || 0) * 0.5;
    if (s.pTiny) w += (t.tank || 0) * 0.8 + (t.melee || 0) * 0.4;
    if (s.low) w += (t.escape || 0) * 1.4 + (t.mobile || 0) * 0.8 + (t.tank || 0) * 0.6 - (t.small || 0) * 0.3; else if (s.hurt) w += (t.tank || 0) * 0.4;
    if (id === 'greymatter') w *= 0.55; if (id === 'upgrade') w *= 0.7; if (id === 'waybig') w *= 0.6;
    const e = a.eff && a.eff[id]; if (e !== undefined) w *= clamp(0.55 + e, 0.45, 1.8);                    // how well that form did the last time he used it
    const hi = hist.indexOf(id); if (hi >= 0) w *= [0.25, 0.5, 0.7, 0.85][hi] || 0.9;                          // recently used forms are less likely, never forbidden
    w *= opt.start ? (id === 'waybig' ? 0.5 : 1) : 1;
    W.push([id, Math.max(0.05, w)]);
  }
  let tot = 0; for (const [, w] of W) tot += w; let r = Math.random() * tot; for (const [id, w] of W) { r -= w; if (r <= 0) return id; }
  return W.length ? W[W.length - 1][0] : 'diamondhead';
}

// ------------------------------------------------------------------------------------------------------------------------------ the pilot
export class Pilot {
  constructor(a) { this.a = a; this.aimPt = new THREE.Vector3(); this.camYaw = 0; this.inp = { moveX: 0, moveY: 0, run: false, jump: false, jumpHeld: false, dash: false, down: false }; this.reset(); }
  reset() {
    this.cd = {}; this.rel = []; this.strafe = 1; this.strafeT = 0; this.stuckT = 0; this.sideT = 0; this.sideDir = 1; this.jumpT = rand(2, 5); this.thinkT = 0; this.prof = PROFILES.human; this.c = null; this.id = 'human';
    this.blockT = 0; this.evadeCd = 0; this.aggr = 0; this.fly = false; this.last = 'none'; this.lastPos = null; this.tsum = 0; this.retreatT = 0; this.mood = 0;
    this.dc = 99; this.de = 99;
    this.clock = 0; this.hitT = []; this.blockCd = 0; this.counterQ = null; this.counterCd = 0; this.dashBoost = 0; this.dodgeBack = 0; this.jumpNow = false; this.guardT = 0;
  }
  onForm(id, c) { this.id = id; this.c = c; this.prof = PROFILES[id] || PROFILES.human; this.cd = {}; this.rel.length = 0; this.thinkT = 0.15; this.blockT = 0; this.fly = false; this.stuckT = 0; this.sideT = 0; this.strafeT = 0; this.mood = 0; }
  onHurt(dmg, r) {
    const a = this.a; this.retreatT = 0; this.aggr = Math.min(1, this.aggr + dmg / 90);
    if (this.id === 'human' && !a.dead) { if (this.evadeCd <= 0 && Math.random() < 0.3) { this.c.startEvade(Math.random() < 0.5 ? 1 : -1); this.evadeCd = 2.5; } }
  }
  /** V27: reactive defence of the ALIEN forms (human keeps its own block / evade).  Returns { dodged, mul, shMul, blocked }.  Uses what the current alien really has:
   *  Four Arms raises his guard (key L), everybody can sidestep / hop away (cooldown), and a successful block or dodge can be followed by an immediate counter. Strong hits break guards. */
  defend(dmg, sh) {
    const a = this.a, c = a.cur, id = this.id, x = a.ctx, r = { dodged: false, mul: 1, shMul: 1, blocked: false };
    this.hitT.push(this.clock); while (this.hitT.length && this.clock - this.hitT[0] > 2.5) this.hitT.shift();
    if (!c || id === 'human' || a.dead || a.state === 'transforming') return r;
    const strong = dmg >= 45 || sh >= 22, recent = this.hitT.length;
    if (id === 'fourarms' && c.blocking) {                                         // guard is up
      if (strong) { c.setBlock && c.setBlock(false); this.guardT = 0; r.mul = 0.75; r.shMul = 0.8; a.g.hud.tag && a.g.hud.tag(a.pos.clone().setY(a.pos.y + 3.2), 'GUARD BROKEN'); }
      else { r.mul = 0.3; r.shMul = 0.35; r.blocked = true; a.g.hud.tag && a.g.hud.tag(a.pos.clone().setY(a.pos.y + 3.2), 'BLOCKED'); a.g.sfx.thud && a.g.sfx.thud(0.3); this.armCounter(1); a.stats.blocks = (a.stats.blocks || 0) + 1; }
      return r;
    }
    const busy = busyOf(c, x), ok = !(c.form === 'ball') && id !== 'waybig' && c.mode !== 'swim' && (c.mode !== 'fly' || id === 'stinkfly');
    const free = !busy || id === 'xlr8' || id === 'wildmutt' || id === 'ultimatewildmutt';
    if (ok && free && this.evadeCd <= 0 && Math.random() < clamp(0.06 + 0.045 * recent, 0, 0.26)) {            // slip it
      this.evadeCd = 2.4; r.dodged = true; this.sideT = 0.42; this.sideDir = Math.random() < 0.5 ? -1 : 1; this.dashBoost = 0.42; this.dodgeBack = 0.25; this.jumpNow = id === 'stinkfly' || id === 'wildmutt';
      a.g.hud.tag && a.g.hud.tag(a.pos.clone().setY(a.pos.y + (c.colH || 2) + 0.6), 'DODGED'); a.stats.dodges = (a.stats.dodges || 0) + 1; this.armCounter(0.9); return r;
    }
    if (id === 'fourarms' && !c.act && !c.climb && !strong && this.blockCd <= 0 && Math.random() < clamp(0.08 + 0.08 * recent, 0, 0.34)) {     // raise the guard (this hit already meets it)
      c.keyDown && c.keyDown('KeyL'); this.rel.push({ t: rand(0.6, 1.2), f: () => c.keyUp && c.keyUp('KeyL') }); this.blockCd = 3.2; r.mul = 0.3; r.shMul = 0.35; r.blocked = true;
      a.g.hud.tag && a.g.hud.tag(a.pos.clone().setY(a.pos.y + 3.2), 'BLOCKED'); a.stats.blocks = (a.stats.blocks || 0) + 1; this.armCounter(1);
    }
    return r;
  }
  armCounter(m = 1) { if (this.counterCd <= 0 && !this.counterQ && Math.random() < 0.55 * m) this.counterQ = { t: 0 }; }
  /** Is the player attacking right now? (used for blocking / evading) */
  playerAttacking() { const g = this.a.g, P = g.player; return !!(P.act || P.combo || (g.p2 && g.chars.id === 'diamondhead' && g.p2.act)); }
  think(dt, locked) {
    const a = this.a, g = a.g, P = g.player, c = a.cur, inp = this.inp, id = a.curId; if (this.c !== c) this.onForm(id, c);
    for (const k in this.cd) if (this.cd[k] > 0) this.cd[k] -= dt; this.clock += dt; this.blockCd -= dt; this.counterCd -= dt; this.dashBoost -= dt; this.dodgeBack -= dt; this.evadeCd -= dt; this.aggr = Math.max(0, this.aggr - dt * 0.05); this.retreatT = Math.max(0, this.retreatT - dt);
    const dx = P.pos.x - c.pos.x, dz = P.pos.z - c.pos.z, dc = hyp(dx, dz) || 0.001; this.dc = dc; this.de = Math.max(0, dc - (c.rad || 0.4) - (P.rad || 0.4));
    // aim: the player's chest, lead a little for slow projectiles
    this.aimPt.set(P.pos.x + (P.vel ? P.vel.x * 0.12 : 0), P.pos.y + Math.min((P.colH || 1.8) * 0.6, 3), P.pos.z + (P.vel ? P.vel.z * 0.12 : 0));
    if (id === 'waybig') this.aimPt.set(P.pos.x, P.pos.y + 0.5, P.pos.z);
    this.camYaw = Math.atan2(-dx, -dz);
    inp.moveX = 0; inp.moveY = 0; inp.run = false; inp.jump = false; inp.jumpHeld = false; inp.dash = false; inp.down = false;
    if (locked || a.dead || this.frozen) return inp;
    const prof = this.prof, [near, far] = prof.range; const wantFar = Math.max(far, 1);
    const human = id === 'human';
    // retreat at low HP (human), or when hurt and the form is fragile
    const retreat = (human && a.hp / a.maxHp < 0.28 && this.retreatT <= 0 && Math.random() < 0.002) ? (this.retreatT = rand(1.2, 2.4)) : 0;
    let fwd = 0;
    if (this.retreatT > 0) fwd = -1; else if (this.de > wantFar) fwd = 1; else if (this.de < near * 0.55 && !human) fwd = -0.7; else fwd = 0;
    if (human && this.de > 1.4) fwd = 1;
    // strafe around the target inside the fighting band
    this.strafeT -= dt; if (this.strafeT <= 0) { this.strafeT = rand(0.9, 2.4); this.strafe = Math.random() < 0.5 ? -1 : 1; if (Math.random() < 0.3) this.strafe = 0; }
    let sx = (this.de < wantFar * 1.4 && this.retreatT <= 0) ? this.strafe * (human ? 0.35 : 0.55) : 0;
    if (this.sideT > 0) { this.sideT -= dt; sx = this.sideDir; if (fwd < 0.4) fwd = 0.4; }
    if (this.dodgeBack > 0) fwd = -0.7;
    inp.moveY = fwd; inp.moveX = sx; inp.run = this.de > 5 || this.retreatT > 0 || (!human && this.de > wantFar * 0.9) || this.dashBoost > 0;
    if (this.jumpNow && c.grounded) { inp.jump = true; inp.jumpHeld = true; this.jumpNow = false; }
    // obstacles: walking into something -> hop / sidestep
    if (Math.abs(fwd) > 0.2) { const sp = hyp(c.vel.x, c.vel.z); if (sp < 0.5 && c.grounded && !(c.act || c.combo)) { this.stuckT += dt; } else this.stuckT = Math.max(0, this.stuckT - dt * 2); } else this.stuckT = 0;
    if (this.stuckT > 0.35) { inp.jump = true; inp.jumpHeld = true; if (this.stuckT > 0.7) { this.sideT = 0.9; this.sideDir = Math.random() < 0.5 ? -1 : 1; this.stuckT = 0.1; } }
    this.jumpT -= dt; if (this.jumpT <= 0 && c.grounded && this.de > 3 && id !== 'waybig' && Math.random() < 0.5) { inp.jump = true; inp.jumpHeld = true; this.jumpT = rand(3, 7); } else if (this.jumpT <= 0) this.jumpT = 1;
    // vertical control of flyers / swimmers
    if (c.mode === 'fly' || c.mode === 'takeoff' || c.mode === 'swim') { const dy = this.aimPt.y - (c.pos.y + 1.2); if (dy > 1.5) inp.jumpHeld = true; else if (dy < -1.8) inp.down = true; if (c.mode === 'fly') { if (this.de < near) inp.moveY = Math.min(inp.moveY, 0); } }
    if (prof.drive) prof.drive(this, c, a, dt, inp);
    if (this.id === 'cannonbolt') this.driveBall(c, a, dt, inp);
    if (this.id === 'heatblast' || this.id === 'stinkfly') this.driveFlight(c, a, dt, inp);
    if (this.id === 'ripjaws') this.driveSwim(c, a, dt, inp);
    return inp;
  }
  // -------------------------------------------------------------------------------------------------- stateful movement behaviours
  driveBall(c, a, dt, inp) {
    this.mood -= dt;
    if (c.form === 'stand') { if (this.mood <= 0 && this.de > 7 && this.de < 40 && !c.act && (this.cd.curl || 0) <= 0) { c.keyDown('KeyQ'); this.cd.curl = 7; this.mood = rand(2.5, 4.5); } }
    else if (c.form === 'ball') { inp.moveY = 1; inp.moveX = 0; inp.run = true; if ((this.mood <= 0 || this.de < 1.6) && this.mood < 0.6) { c.keyDown('KeyQ'); this.cd.curl = 5; this.mood = 0; } }
  }
  driveFlight(c, a, dt, inp) {
    const hb = this.id === 'heatblast'; this.mood -= dt; if (this.mood > 0) return;
    const P = a.g.player, pf = P.mode === 'fly' || P.mode === 'takeoff' || (P.pos.y - (a.pos.y) > 4);
    if (c.mode === 'fly') { if (this.de < 6 && !pf && this.mood <= 0 && Math.random() < 0.02) { if (hb) c.keyDown('KeyX'); else { inp.down = true; } this.mood = 1.5; } }
    else if (c.grounded && (this.de > 24 || pf) && Math.random() < 0.02) { if (hb) c.keyDown('KeyX'); else { inp.jump = true; inp.jumpHeld = true; } this.mood = 2; }
  }
  driveSwim(c, a, dt, inp) { if (c.mode === 'swim') { inp.run = this.de > 4; } }
  // -------------------------------------------------------------------------------------------------- attacks
  press(c, id, k, hold) {
    const a = this.a, x = a.ctx;
    if (id === 'human') { if (k === 'LMB') { c.mouseDown(); this.rel.push({ t: 0.05, f: () => c.mouseUp() }); } return; }
    if (id === 'diamondhead') {
      if (k === 'LMB') { x.power.press(); this.rel.push({ t: hold || 0.1, f: () => x.power.release() }); } else { x.p2.keyDown(k); if (k === 'KeyF') this.rel.push({ t: 1.2, f: () => x.p2.keyUp('KeyF') }); } return;
    }
    if (k === 'LMB') { c.mouseDown(); this.rel.push({ t: hold || 0.12, f: () => c.mouseUp && c.mouseUp() }); } else { c.keyDown(k); this.rel.push({ t: 0.12, f: () => c.keyUp && c.keyUp(k) }); }
  }
  /** called inside the puppet frame (so overlays go to the sink): fires releases and picks an attack */
  presses(dt) {
    const a = this.a, c = a.cur, id = a.curId, x = a.ctx; if (a.dead || !c) return;
    for (let i = this.rel.length - 1; i >= 0; i--) { const r = this.rel[i]; r.t -= dt; if (r.t <= 0) { this.rel.splice(i, 1); try { r.f(); } catch (e) { } } }
    if (a.state === 'transforming' || a.lock > 0 || this.frozen) return;
    // human form: guard / evade reactions
    if (id === 'human') {
      this.blockT -= dt; const pa = this.playerAttacking();
      if (this.blockT <= 0 && c.blocking) c.setBlock(false);
      if (pa && this.de < 4 && !c.blocking && !c.act && this.blockT < -0.8 && Math.random() < 0.04) { c.setBlock(true); this.blockT = rand(0.5, 1.1); }
      if (c.blocking) { this.inp.moveY = 0; this.inp.moveX = 0; }
      if (c.blocking) return;
    }
    if (this.counterQ) {                                                                                         // V27: counter-attack after a block / dodge
      const q = this.counterQ; q.t += dt; if (q.t > 1.2 || id === 'human') this.counterQ = null;
      else if (this.dashBoost <= 0 && !c.blocking) {
        const best = []; for (const m of this.prof.moves) if ((this.cd[m.k] || 0) <= 0 && this.de >= m.min && this.de <= Math.min(m.max, 9)) best.push(m);
        if (best.length && !busyOf(c, x)) { let tot = 0; for (const m of best) tot += m.w; let rr = Math.random() * tot, m = best[0]; for (const e of best) { rr -= e.w; if (rr <= 0) { m = e; break; } }
          this.cd[m.k] = m.cd; this.last = 'counter:' + m.k; this.counterQ = null; this.counterCd = 3.6; this.thinkT = 0.25; a.stats.counters = (a.stats.counters || 0) + 1; a.g.hud.tag && a.g.hud.tag(a.pos.clone().setY(a.pos.y + (c.colH || 2) + 0.6), 'COUNTER'); this.press(c, id, m.k, m.hold); return; }
      }
    }
    this.thinkT -= dt; if (this.thinkT > 0) return; this.thinkT = rand(0.08, 0.2);
    const busy = busyOf(c, x); if (busy && !(id === 'human' || id === 'xlr8' || id === 'fourarms' || id === 'wildmutt' || id === 'ultimatewildmutt' || id === 'cannonbolt')) return;
    if (c.mode === 'crouch' || c.mode === 'climb' || (c.mode === 'swim' && id !== 'ripjaws')) return;
    const de = this.de, el = [];
    for (const m of this.prof.moves) {
      if ((this.cd[m.k] || 0) > 0 || de < m.min || de > m.max) continue;
      if (id === 'cannonbolt' && c.form === 'ball' && m.k !== 'LMB') continue; if (id === 'cannonbolt' && c.form === 'ball') continue;
      if (id === 'heatblast' && c.mode === 'fly' && (m.k === 'KeyE' || m.k === 'KeyR')) continue;
      if (busy && m.k !== 'LMB') continue;                                                                    // chains (combos) are LMB presses; special moves wait for a free body
      el.push(m);
    }
    if (!el.length) return;
    // aggression: pause between attacks so he is beatable; more relentless as he gets hurt
    const gap = this.aggr * 0.3; if (Math.random() < 0.18 - gap * 0.5) return;
    let tot = 0; for (const m of el) tot += m.w; let r = Math.random() * tot, m = el[0]; for (const e of el) { r -= e.w; if (r <= 0) { m = e; break; } }
    this.cd[m.k] = m.cd * (id === 'ultimatewildmutt' ? 0.8 : 1); this.last = m.k; a.stats.byForm['m:' + id + ':' + m.k] = (a.stats.byForm['m:' + id + ':' + m.k] || 0) + 1;
    this.press(c, id, m.k, m.hold);
  }
  debug() { const a = this.a; return `pilot ${this.id} de ${this.de.toFixed(1)} last ${this.last} aggr ${this.aggr.toFixed(2)} retreat ${this.retreatT.toFixed(1)} stuck ${this.stuckT.toFixed(2)}`; }
}
