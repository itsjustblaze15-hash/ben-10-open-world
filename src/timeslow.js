// Quicksilver-style time slow: two separate time domains.
//   PLAYER time = real elapsed time (XLR8, camera, input, the ability's own 10 s timer and 20 s cooldown).
//   WORLD time  = real time x scale (enemies, enemy AI/animation, turret bolts, knockback, falling debris).
export class TimeSystem {
  constructor(game, cfg = {}) {
    this.g = game; this.dur = cfg.dur ?? 10; this.cdDur = cfg.cd ?? 20; this.slow = cfg.scale ?? 0.07; this.rampIn = 0.3; this.rampOut = 0.7;
    this.scale = 1; this.phase = 'idle'; this.t = 0; this.outT = 0; this.cd = 0;
  }
  get active() { return this.phase === 'in' || this.phase === 'hold'; }
  get busy() { return this.phase !== 'idle'; }
  get remaining() { return this.active ? Math.max(0, this.dur - this.t) : 0; }
  /** 0 = normal world, 1 = fully slowed (drives the visual treatment) */
  get depth() { return (1 - this.scale) / (1 - this.slow); }
  canStart() { return this.phase === 'idle' && this.cd <= 0; }
  start() { if (!this.canStart()) return false; this.phase = 'in'; this.t = 0; this.outT = 0; return true; }
  /** end now (used when switching away); the cooldown starts at the moment the effect ends */
  end() { if (this.active) { this.phase = 'out'; this.outT = 0; this.cd = this.cdDur; } }
  /** @param rdt REAL (unscaled) seconds */
  update(rdt) {
    if (this.cd > 0) this.cd = Math.max(0, this.cd - rdt);     // cooldown is real time and starts when the effect ends
    if (this.phase === 'in' || this.phase === 'hold') {
      this.t += rdt;
      if (this.t >= this.dur) { this.phase = 'out'; this.outT = 0; this.cd = this.cdDur; this.t = this.dur; }
      else if (this.t >= this.rampIn) this.phase = 'hold';
    }
    const ease = x => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
    if (this.phase === 'in') this.scale = 1 + (this.slow - 1) * ease(this.t / this.rampIn);
    else if (this.phase === 'hold') this.scale = this.slow;
    else if (this.phase === 'out') { this.outT += rdt; this.scale = this.slow + (1 - this.slow) * ease(this.outT / this.rampOut); if (this.outT >= this.rampOut) { this.phase = 'idle'; this.scale = 1; } }
    else this.scale = 1;
  }
}
