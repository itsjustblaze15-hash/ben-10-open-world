// Tiny WebAudio synth for the sounds this test needs (no audio files are bundled). Created lazily on the first key press.
export class Sfx {
  constructor() { this.ctx = null; this.master = null; this.on = true; }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try { const C = window.AudioContext || window.webkitAudioContext; this.ctx = new C(); this.master = this.ctx.createGain(); this.master.gain.value = 0.22; this.master.connect(this.ctx.destination); } catch { this.ctx = null; }
  }
  _noise(dur) { const c = this.ctx, b = c.createBuffer(1, Math.max(1, c.sampleRate * dur | 0), c.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; const s = c.createBufferSource(); s.buffer = b; return s; }
  _tone(type, f0, f1, dur, vol, delay = 0) {
    if (!this.ctx || !this.on) return; const c = this.ctx, t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.03, dur * 0.3)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  /** Omnitrix-style transformation: rising sweep, a "dial" ping and a bright whoosh */
  transform() {
    if (!this.ctx || !this.on) return; const c = this.ctx, t = c.currentTime;
    this._tone('sawtooth', 260, 1500, 0.32, 0.5); this._tone('square', 880, 880, 0.08, 0.25, 0.0); this._tone('sine', 1760, 2640, 0.35, 0.3, 0.12); this._tone('sine', 120, 60, 0.4, 0.5, 0.28);
    const n = this._noise(0.5), f = c.createBiquadFilter(), g = c.createGain(); f.type = 'bandpass'; f.frequency.setValueAtTime(600, t); f.frequency.exponentialRampToValueAtTime(5000, t + 0.3);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.12); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5); n.connect(f); f.connect(g); g.connect(this.master); n.start(t);
  }
  slowIn() { this._tone('sine', 700, 70, 0.7, 0.6); this._tone('triangle', 240, 40, 0.9, 0.35, 0.05); }
  slowOut() { this._tone('sine', 60, 900, 0.5, 0.5); this._tone('sawtooth', 120, 1200, 0.4, 0.2, 0.1); }
  hit(final = false) { this._tone('square', final ? 180 : 320, 60, final ? 0.22 : 0.07, final ? 0.6 : 0.3); if (!this.ctx || !this.on) return; const n = this._noise(0.08), g = this.ctx.createGain(); g.gain.value = final ? 0.5 : 0.18; n.connect(g); g.connect(this.master); n.start(); }
  whoosh() { if (!this.ctx || !this.on) return; const c = this.ctx, t = c.currentTime, n = this._noise(0.35), f = c.createBiquadFilter(), g = c.createGain(); f.type = 'bandpass'; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(3200, t + 0.25); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.33); n.connect(f); f.connect(g); g.connect(this.master); n.start(t); }
  /** Stinkfly: wet slime squelch (blob leaving an eyestalk / splatting) */
  squelch(vol = 0.25) { this._tone('sine', 420, 90, 0.12, vol); this._tone('triangle', 240, 120, 0.1, vol * 0.6, 0.02); }
  /** Stinkfly: a burst of wing-beat flutter (rate-limited by the caller) */
  flap(vol = 0.12) { if (!this.ctx || !this.on) return; const c = this.ctx, t = c.currentTime, n = this._noise(0.12), f = c.createBiquadFilter(), g = c.createGain(); f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 1.2; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11); n.connect(f); f.connect(g); g.connect(this.master); n.start(t); }
  /** heavy footstep / landing thud */
  thud(vol = 0.5) { this._tone('sine', 110, 38, 0.18, Math.min(1, vol)); this._tone('triangle', 60, 30, 0.22, Math.min(1, vol) * 0.7, 0.01); }
  /** big crash: low boom + noise burst (shatter / slam / explosion) */
  crash(vol = 0.7) {
    this._tone('sine', 90, 28, 0.55, Math.min(1, vol)); this._tone('sawtooth', 200, 40, 0.3, 0.3 * vol);
    if (!this.ctx || !this.on) return; const c = this.ctx, t = c.currentTime, n = this._noise(0.5), f = c.createBiquadFilter(), g = c.createGain(); f.type = 'lowpass'; f.frequency.setValueAtTime(3000, t); f.frequency.exponentialRampToValueAtTime(200, t + 0.45);
    g.gain.setValueAtTime(Math.min(1, vol), t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5); n.connect(f); f.connect(g); g.connect(this.master); n.start(t);
  }
  roar() { this._tone('sawtooth', 120, 70, 0.9, 0.5); this._tone('sawtooth', 90, 55, 0.9, 0.4, 0.05); this._tone('square', 60, 40, 0.8, 0.25, 0.1); }
  /** fire: crackling whoosh (short, called per stream tick) */
  flame(vol = 0.3) { if (!this.ctx || !this.on) return; const c = this.ctx, t = c.currentTime, n = this._noise(0.16), f = c.createBiquadFilter(), g = c.createGain(); f.type = 'bandpass'; f.frequency.setValueAtTime(700, t); f.frequency.exponentialRampToValueAtTime(2400, t + 0.14); f.Q.value = 0.8; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16); n.connect(f); f.connect(g); g.connect(this.master); n.start(t); }
  /** fireball launch / big explosion: low boom + rushing noise */
  boom(vol = 0.7) { this._tone('sine', 120, 26, 0.7, Math.min(1, vol)); this._tone('sawtooth', 240, 36, 0.4, 0.35 * vol); if (!this.ctx || !this.on) return; const c = this.ctx, t = c.currentTime, n = this._noise(0.9), f = c.createBiquadFilter(), g = c.createGain(); f.type = 'lowpass'; f.frequency.setValueAtTime(2600, t); f.frequency.exponentialRampToValueAtTime(120, t + 0.8); g.gain.setValueAtTime(Math.min(1, vol), t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9); n.connect(f); f.connect(g); g.connect(this.master); n.start(t); }
  /** rising roar while gathering the large fire burst */
  charge(dur = 1.0) { this._tone('sawtooth', 60, 340, dur, 0.4); this._tone('triangle', 120, 520, dur, 0.25, 0.05); if (!this.ctx || !this.on) return; const c = this.ctx, t = c.currentTime, n = this._noise(dur), f = c.createBiquadFilter(), g = c.createGain(); f.type = 'bandpass'; f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(3000, t + dur); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + dur * 0.9); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05); n.connect(f); f.connect(g); g.connect(this.master); n.start(t); }
  /** Upgrade's eye laser: charge whine (call once) */
  laserCharge(dur = 0.35) { this._tone('sine', 400, 2400, dur, 0.35); this._tone('square', 200, 900, dur, 0.1); }
  laserFire() { this._tone('sawtooth', 1800, 500, 0.8, 0.35); this._tone('square', 600, 300, 0.8, 0.12); this._tone('sine', 90, 80, 0.8, 0.4); }
  /** Upgrade merging into / out of a machine: liquid slither + electric chirps */
  merge(up = true) { const a = up ? 180 : 900, b = up ? 900 : 180; this._tone('sawtooth', a, b, 0.7, 0.28); this._tone('sine', a * 2, b * 2, 0.7, 0.22, 0.05); this._tone('square', 1200, 2400, 0.08, 0.15, 0.5); this._tone('square', 1600, 3200, 0.08, 0.12, 0.62); }
  servo(vol = 0.2) { this._tone('sawtooth', 140, 90, 0.18, vol); this._tone('square', 420, 300, 0.1, vol * 0.5); }
  zap(vol = 0.3) { this._tone('square', 900, 200, 0.12, vol); this._tone('sawtooth', 1400, 400, 0.1, vol * 0.6); }
  beep(ok = true) { this._tone('square', ok ? 880 : 220, ok ? 1320 : 180, 0.12, 0.25); if (ok) this._tone('square', 1320, 1760, 0.1, 0.2, 0.1); }
  /** Ghostfreak: airy shimmer (fade / phase / possession in = falling pitch, out = rising) */
  ghost(inward = true, vol = 0.16) { const a = inward ? 880 : 240, b = inward ? 240 : 880; this._tone('sine', a, b, 0.5, vol); this._tone('triangle', a * 1.5, b * 1.5, 0.45, vol * 0.5, 0.04); this._tone('sine', a * 0.5, b * 0.5, 0.6, vol * 0.6, 0.08); }
  /** water: a splash (entry / exit / breach) - low-passed noise burst + a dull plop */
  splash(vol = 0.3) { if (!this.ctx || !this.on) return; const c = this.ctx, t = c.currentTime, n = this._noise(0.55), f = c.createBiquadFilter(), g = c.createGain(); f.type = 'lowpass'; f.frequency.setValueAtTime(5200, t); f.frequency.exponentialRampToValueAtTime(380, t + 0.5); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.min(1, vol * 1.6), t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55); n.connect(f); f.connect(g); g.connect(this.master); n.start(t); this._tone('sine', 220, 70, 0.22, vol * 0.8); }
  /** muffled underwater swish / stroke */
  swish(vol = 0.1) { if (!this.ctx || !this.on) return; const c = this.ctx, t = c.currentTime, n = this._noise(0.3), f = c.createBiquadFilter(), g = c.createGain(); f.type = 'bandpass'; f.frequency.setValueAtTime(260, t); f.frequency.exponentialRampToValueAtTime(700, t + 0.2); f.Q.value = 0.6; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3); n.connect(f); f.connect(g); g.connect(this.master); n.start(t); }
  /** jaws snapping shut */
  chomp(vol = 0.5) { this._tone('square', 300, 80, 0.06, vol * 0.7); this._tone('sawtooth', 150, 50, 0.1, vol * 0.7, 0.02); if (!this.ctx || !this.on) return; const n = this._noise(0.05), g = this.ctx.createGain(); g.gain.value = vol * 0.5; n.connect(g); g.connect(this.master); n.start(); }
  blip(vol = 0.06) { this._tone('sine', 420 + Math.random() * 200, 900 + Math.random() * 400, 0.05, vol); }
  engine(vol = 0.1, f = 60) { this._tone('sawtooth', f, f * 0.9, 0.12, vol); }
}
