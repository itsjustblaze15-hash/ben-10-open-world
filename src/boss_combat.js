// BOSS COMBAT LAYER (V27): "bosses fight back".  Shared by Kevin 11 and Vilgax (Albedo has its own small pilot-side version, see albedo_ai.js).
// Damage is NEVER reduced by this layer (except by an actual successful block); it only decides how much a hit INTERRUPTS the boss:
//   1. diminishing hit-stun   - after `stunAfter` non-strong hits inside `stunWin` s the boss resists further stagger for `resistT` s (resets after ~1.2 s without hits)
//   2. attack commitment      - while a committed attack is winding up / striking, non-strong hits cannot interrupt it (strong hits still do)
//   3. reactive block         - a chance on each incoming hit (rises with the hit streak, has a cooldown, strong hits break the guard)
//   4. reactive dodge         - a chance (cooldown) to slip the hit: Kevin side-steps with his speed, Vilgax takes a short back-step
//   5. counter                - after a successful block / dodge, an occasional immediate counter-attack (cooldown, interruptible by strong hits)
//   6. retaliation            - after taking a hit in melee range the boss usually starts its own attack at once instead of waiting
// Every number below is configurable.  A "strong" hit (damage / knockback above the boss's thresholds) ignores 1, 2 and 6 and can stagger / interrupt normally.
import { clamp } from './util.js';

export const COMBAT = {
  kevin: {                                // fast and aggressive: reacts briefly, recovers quickly, counters fast
    strongDmg: 30, strongSh: 15, stunAfter: 3, stunWin: 1.8, resistT: 2.2, commitAll: false, commitFrom: 0.3, commitPush: 0.45,
    blockBase: 0.07, blockPerHit: 0.06, blockMax: 0.30, blockCd: 4.6,
    dodgeBase: 0.06, dodgePerHit: 0.04, dodgeMax: 0.22, dodgeCd: 3.0,
    counterP: 0.55, counterCd: 3.2, retaliate: 0.7, retaliateT: 0.05,
  },
  vilgax: {                               // heavy and hard to interrupt: commits to every attack, blocks more, counters hard
    strongDmg: 62, strongSh: 26, stunAfter: 2, stunWin: 2.0, resistT: 3.2, commitAll: true, commitFrom: 0.22, commitPush: 0.3,
    blockBase: 0.09, blockPerHit: 0.07, blockMax: 0.34, blockCd: 6.5,
    dodgeBase: 0.03, dodgePerHit: 0.02, dodgeMax: 0.09, dodgeCd: 5.0,
    counterP: 0.75, counterCd: 4.2, retaliate: 0.6, retaliateT: 0.08,
  },
};
const NO_COMMIT = new Set(['dodge', 'land', 'roar', 'takeoff']);

export class BossCombat {
  constructor(boss, cfg) {
    this.b = boss; this.cfg = Object.assign({}, cfg); this.cur = null; this.times = []; this.resist = 0; this.sinceHit = 9; this.counterQ = null; this.counterCdT = 0; this.blockCdT = 0;
    this.stats = { resisted: 0, committed: 0, blocks: 0, dodges: 0, counters: 0, retaliations: 0, strong: 0 };
    boss.ib.o.capTier = () => this.capTier();
  }
  reset() { this.cur = null; this.times.length = 0; this.resist = 0; this.sinceHit = 9; this.counterQ = null; this.counterCdT = 0; this.blockCdT = 0; }
  isStrong(dmg, sh) { return dmg >= this.cfg.strongDmg || sh >= this.cfg.strongSh; }
  /** is the boss inside the protected part of an attack (or a guard)? */
  committed() {
    const b = this.b, a = b.act; if (!a || NO_COMMIT.has(a.name) || b.dead) return false;
    if (a.name === 'block') return true;
    if (!a.def || a.phase === 'rec') return false;
    const attack = a.def.hit || a.def.big || a.def.grab || a.def.custom || a.def.ranged || a.def.rush; if (!attack) return false;
    if (!this.cfg.commitAll && !a.def.big && a.phase !== 'strike') return false;                       // Kevin: quick jabs can be disturbed in the wind-up, heavy moves cannot
    return a.phase === 'strike' || a.t >= a.windup * this.cfg.commitFrom;
  }
  /** called by ImpactBody.hit through o.capTier: how far this hit may disturb the boss */
  capTier() {
    const h = this.cur; if (!h || h.strong || this.cfg.off) return 4;
    if (this.committed()) { h.capped = 'commit'; return 0; }
    if (this.resist > 0) { h.capped = 'resist'; return 0; }
    return 4;
  }
  /** an attack is about to be resolved.  Returns 'dodge' | 'block' | null (the boss started one of them) */
  incoming(dmg, sh, c) {
    const b = this.b, cf = this.cfg, strong = this.isStrong(dmg, sh); this.cur = { dmg, sh, strong, capped: null };
    if (strong) this.stats.strong++;
    if (cf.off) return null;
    if (b.dead || !c || b.mode !== 'ground' || !b.ib.canAct || c.giant) return null;
    const a = b.act; if (a && a.def && a.def.grab) return null;
    if (this.committed() && !(a && a.name === 'block')) return null;                                          // busy attacking through the hit
    const recent = b.hitLog.length;
    if (!(b.iframe > 0) && b.dodgeCd <= 0 && c.vis) {
      const p = clamp(cf.dodgeBase + cf.dodgePerHit * recent, 0, cf.dodgeMax) * (1 + 0.1 * b.phase);
      if (Math.random() < p) { this.slip(c); this.stats.dodges++; return 'dodge'; }
    }
    if (!(a && a.name === 'block') && (b.cd.block || 0) <= 0 && this.blockCdT <= 0 && !strong) {
      const p = clamp(cf.blockBase + cf.blockPerHit * recent, 0, cf.blockMax) * (1 + 0.08 * b.phase);
      if (Math.random() < p) { b.cancelAct(); b.startAct('block'); if (b.isKevin) b.kvBlocking = true; else if (b.act) { const ba = b.act; ba.strike = 0.6 + Math.random() * 0.5; ba.dur = ba.windup + ba.strike + ba.rec; }      // Vilgax: a short guard (the normal AI block lasts longer)
      this.blockCdT = cf.blockCd; b.cd.block = cf.blockCd; this.stats.blocks++; return 'block'; }
    }
    return null;
  }
  /** Kevin: a quick side-step with his speed.  Vilgax: a short defensive back-step */
  slip(c) {
    const b = this.b;
    if (b.isKevin) { b.startDodge(c); b.dodgeCd = this.cfg.dodgeCd; }
    else { b.cancelAct(); b.startAct('dodge', { dir: Math.random() < 0.5 ? 1 : -1 }); b.av.set(-Math.sin(b.yaw) * 6.5, 0, -Math.cos(b.yaw) * 6.5); b.iframe = 0.22; b.dodgeCd = this.cfg.dodgeCd; b.g.sfx.whoosh && b.g.sfx.whoosh(); }
    this.armCounter(0.9);
  }
  /** after a successful block / dodge: maybe queue a counter-attack */
  armCounter(mult = 1) {
    if (this.counterCdT > 0 || this.counterQ) return;
    if (Math.random() < this.cfg.counterP * mult) this.counterQ = { t: 0 };
  }
  /** a hit was applied (not dodged): hit bookkeeping + retaliation */
  afterHit(c, strong) {
    const b = this.b, cf = this.cfg; this.sinceHit = 0;
    if (!strong) { this.times.push(b.t); while (this.times.length && b.t - this.times[0] > cf.stunWin) this.times.shift(); if (this.times.length >= cf.stunAfter && this.resist <= 0) this.resist = cf.resistT; else if (this.resist > 0) this.resist = Math.max(this.resist, cf.resistT * 0.6); }
    if (this.cur && this.cur.capped === 'commit') this.stats.committed++; else if (this.cur && this.cur.capped === 'resist') this.stats.resisted++;
    if (cf.off || !c || b.dead || b.mode !== 'ground' || strong) return;
    // fight back: if he is idle and close, start an attack right away instead of waiting
    if (!b.act && b.ib.canAct && c.d3 < (b.isKevin ? 3.3 : 4.4) * b.ks && b.recoverT <= 0 && Math.random() < cf.retaliate) { b.forceMelee = true; b.decideT = Math.min(b.decideT, cf.retaliateT); this.stats.retaliations++; }
  }
  onBlocked() { this.armCounter(1); }
  update(dt, c) {
    const b = this.b; this.counterCdT -= dt; this.blockCdT -= dt; this.sinceHit += dt;
    if (this.resist > 0) { this.resist -= dt; if (this.sinceHit > 1.2) this.resist = 0; }
    if (this.sinceHit > 1.2 && this.times.length) this.times.length = 0;
    if (!this.counterQ) return;
    const q = this.counterQ; q.t += dt;
    if (b.dead || b.mode !== 'ground' || !c || q.t > 1.4) { this.counterQ = null; return; }
    const a = b.act, blocking = a && a.name === 'block', free = !a || (blocking && a.t > a.windup + 0.12) || (a && a.name === 'dodge' && a.t > 0.12);
    if (!free || !b.ib.canAct) return;
    const k = this.pick(c); if (!k) { if (q.t > 0.6) this.counterQ = null; return; }
    this.counterQ = null; this.counterCdT = this.cfg.counterCd; b.cancelAct(); b.startAct(k, { fast: true }); b.counterT = 1.2; b.stats.counters = (b.stats.counters || 0) + 1; this.stats.counters++;
    b.g.hud.tag && b.g.hud.tag(b.home.clone().setY(b.home.y + (b.cfg.chestY || 1.6) + 1.2), 'COUNTER');
  }
  /** counter-attack choice: heavy melee in reach; otherwise nothing (the normal AI takes over) */
  pick(c) {
    const b = this.b; if (c.ghost || c.pDown) return null;
    if (b.pickCounter) return b.pickCounter(c);                                                                // Vilgax: his own table
    const L = [], add = (k, w) => { const A = b.ATK[k]; if (A && !((b.cd[k] || 0) > 0) && c.d3 < (A.reach || 3) + 0.4 && c.los) L.push([k, w]); };
    add('heavy', 2.4); add('smash', b.phase >= 1 ? 1.4 : 0.6); add('crystalPunch', 1.2); add('firePunch', 1.2); add('punch', 1.0);
    if (!L.length) return null; let tot = 0; for (const e of L) tot += e[1]; let r = Math.random() * tot; for (const e of L) { r -= e[1]; if (r <= 0) return e[0]; } return L[0][0];
  }
  debug() { const s = this.stats; return `combat resist ${this.resist.toFixed(1)} hits${this.times.length} | blk ${s.blocks} dod ${s.dodges} ctr ${s.counters} commit ${s.committed} resisted ${s.resisted} retal ${s.retaliations}`; }
}
