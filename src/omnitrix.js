// THE OMNITRIX: Ben <-> alien state machine, selection interface, random mode, 120 s transformation, 60 s recharge, HUD and settings.
//
//   READY (green watch, Ben)  --C-->  custom: MENU (centre of the screen, A / D rotate, C / Enter confirm, Q / Backspace cancel)
//                                     random: straight to ACTIVATING with a weighted pick
//   ACTIVATING  Ben raises the watch -> flips the dial -> green light -> existing Omnitrix flash (CharacterManager.switchTo) -> the alien is in control
//   ALIEN       120 s on the clock. A C TAP does nothing; HOLDING C for OMNI_CFG.holdRevertS (1 s default, a setting) reverts to Ben early. From 15 s left the watch BLINKS red (a warning only).
//   expiry      CharacterManager.switchTo('ben'): every alien's own onLeave() stops its abilities, Ben appears at the CURRENT valid spot, camera resets
//   RECHARGE    60 s with the RED watch (Ben can move / jump / punch; C is refused), then the watch turns GREEN again. A manual revert starts exactly the same 60 s recharge.
//   DIAL        every A / D press turns the watch EXACTLY 90 deg (D clockwise, A counter-clockwise). The alien symbol lives in a separate, never-rotated layer: it fades out, the icon swaps at the
//               half-way point, it fades back in, so it is always upright. Rapid presses go through a queue: one press = one alien, never skipped, never overlapping.
//
// Only TWO watch colours exist (green / red). The durations are fixed rules; no setting can shorten them, and changing the mode never touches a running timer.
import * as THREE from 'three';
import { clamp, lerp, rand, smoothstep } from './util.js';

export const OMNI_ORDER = ['diamondhead', 'xlr8', 'fourarms', 'heatblast', 'upgrade', 'wildmutt', 'ghostfreak', 'ripjaws', 'stinkfly', 'cannonbolt', 'greymatter', 'waybig'];     // the EXACT order of the spec (Part 3)
export const OMNI_NAMES = { diamondhead: 'DIAMONDHEAD', xlr8: 'XLR8', fourarms: 'FOUR ARMS', heatblast: 'HEATBLAST', upgrade: 'UPGRADE', wildmutt: 'WILDMUTT', ghostfreak: 'GHOSTFREAK', ripjaws: 'RIPJAWS', stinkfly: 'STINKFLY', cannonbolt: 'CANNONBOLT', greymatter: 'GREY MATTER', waybig: 'WAY BIG' };
export const OMNI_WEIGHTS = { diamondhead: 10, xlr8: 10, fourarms: 10, heatblast: 10, upgrade: 10, wildmutt: 10, ghostfreak: 10, ripjaws: 10, stinkfly: 10, cannonbolt: 10, greymatter: 3, waybig: 3 };   // total 106: ten aliens at 9.43 %, Grey Matter and Way Big at 2.83 % each
/** configurable defaults (also exposed in the pause-card settings): dial turn time in ms (200-350) and how long C must be held as an alien to revert (seconds) */
export const OMNI_CFG = { rotationMs: 280, holdRevertS: 1.0, queueMax: 6 };
export const TRANSFORM_TIME = 120, RECHARGE_TIME = 60, WARN_TIME = 15;      // fixed gameplay rules (seconds)

/** Asset manifest (spec Part 15). Every slot is filled with the supplied, background-removed artwork; originals are kept untouched in assets/omnitrix/original/.
 *  watchAnimations: frames of the watch-turn animation (none supplied yet) - put the URLs in this array and they are played on every A / D step instead of the built-in turn. */
export const omnitrixAssets = {
  benModel: 'assets/ben.glb',
  watch: { green: 'assets/omnitrix/watch_green.png', red: 'assets/omnitrix/watch_red.png' },
  alienIcons: {
    diamondhead: 'assets/omnitrix/icon_diamondhead.png', xlr8: 'assets/omnitrix/icon_xlr8.png', fourarms: 'assets/omnitrix/icon_fourarms.png', heatblast: 'assets/omnitrix/icon_heatblast.png',
    upgrade: 'assets/omnitrix/icon_upgrade.png', wildmutt: 'assets/omnitrix/icon_wildmutt.png', ghostfreak: 'assets/omnitrix/icon_ghostfreak.png', ripjaws: 'assets/omnitrix/icon_ripjaws.png',
    stinkfly: 'assets/omnitrix/icon_stinkfly.png', cannonbolt: 'assets/omnitrix/icon_cannonbolt.png', greymatter: 'assets/omnitrix/icon_greymatter.png', waybig: 'assets/omnitrix/icon_waybig.png',
  },
  watchAnimations: [],
  watchAnimationFps: 30,
};

/** weighted random alien (rng() in [0,1)) */
export function pickRandomAlien(rng = Math.random) {
  let tot = 0; for (const id of OMNI_ORDER) tot += OMNI_WEIGHTS[id];
  let r = rng() * tot; for (const id of OMNI_ORDER) { r -= OMNI_WEIGHTS[id]; if (r < 0) return id; }
  return OMNI_ORDER[OMNI_ORDER.length - 1];
}

export const MODES = ['custom', 'random', 'freedom', 'cycle'];
const SETTINGS_KEY = 'ben10.omnitrix.settings.v1';
const fmt = (s) => { s = Math.max(0, Math.ceil(s - 1e-6)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const $ = id => document.getElementById(id);

export class Omnitrix {
  constructor(game, ben) {
    this.g = game; this.ben = ben; this.state = 'ready'; this.t = 0; this.remaining = 0; this.cd = 0; this.sel = 0; this.target = null; this.menuAge = 0; this.shown = 0; this.turn = null; this.queue = []; this.rotBase = 0; this.rotDeg = 0; this.confirmWait = false; this.hold = null; this.iconOpacity = 1; this.free = false; this.menuFrom = 'ben'; this.tapQ = 0; this.keep = null;
    this.stats = { transforms: 0, reverts: 0, manualReverts: 0, taps: 0, random: 0, custom: 0, refused: 0, steps: 0, droppedSteps: 0 }; this.log = [];
    this.settings = { mode: 'custom', showHud: true, showTimer: true, rotationMs: OMNI_CFG.rotationMs, holdRevertS: OMNI_CFG.holdRevertS };
    try { const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'); if (s) { if (MODES.includes(s.mode)) this.settings.mode = s.mode; this.settings.showHud = s.showHud !== false; this.settings.showTimer = s.showTimer !== false; if (+s.rotationMs >= 200 && +s.rotationMs <= 350) this.settings.rotationMs = +s.rotationMs; if (+s.holdRevertS >= 0.5 && +s.holdRevertS <= 2) this.settings.holdRevertS = +s.holdRevertS; } } catch { /* storage may be blocked: defaults */ }
    this.icons = {}; for (const id of OMNI_ORDER) { const i = new Image(); i.src = omnitrixAssets.alienIcons[id]; this.icons[id] = i; }
    this.frames = omnitrixAssets.watchAnimations.map(u => { const i = new Image(); i.src = u; return i; });
    this.cache = {}; this.build(); this.applySettingsUI(); this.renderHud(true);
  }

  // ------------------------------------------------------------------------------------------------ queries
  get menuOpen() { return this.state === 'menu'; }
  /** while true: no locomotion / attack / alien input reaches the controllers (the camera still turns) */
  get blocksInput() { return this.state === 'menu' || this.state === 'activating'; }
  get isBen() { return this.g.chars.id === 'ben'; }
  get freeMode() { return this.settings.mode === 'freedom' || this.settings.mode === 'cycle'; }
  get ready() { return this.state === 'ready'; }
  get watchColor() { return this.state === 'ready' || this.state === 'menu' || this.state === 'activating' || (this.state === 'alien' && !this.warning) ? 'green' : this.state === 'alien' ? (this.blinkOn ? 'red' : 'green') : 'red'; }
  get warning() { return this.state === 'alien' && !this.free && this.remaining <= WARN_TIME; }
  get selected() { return OMNI_ORDER[this.sel]; }

  // ------------------------------------------------------------------------------------------------ input
  /** KEY DOWN (auto-repeat is already filtered out by the caller). Returns true when the key was consumed by the Omnitrix interface */
  key(code) {
    if (code === 'KeyC') { this.pressC(); return true; }
    if (this.state !== 'menu') return false;
    if (code === 'KeyA' || code === 'ArrowLeft') { this.step(-1); return true; }
    if (code === 'KeyD' || code === 'ArrowRight') { this.step(1); return true; }
    if (code === 'Enter' || code === 'NumpadEnter') { this.confirm(); return true; }
    if (code === 'KeyQ' || code === 'Backspace') { this.closeMenu(); return true; }
    return true;           // the menu swallows every other key (W/S/Space/... must not move or jump Ben behind it)
  }
  /** KEY UP. Only a C that was PRESSED while the alien was fully active can be a hold: a C that confirmed the menu (or opened it) never starts one, so one press can never confirm AND revert. */
  keyUp(code) {
    if (code !== 'KeyC') return false;
    const h = this.hold; this.hold = null; this.renderHold();
    if (h && !h.done) { this.stats.taps++; if (h.tap) this.tapAction(); }       // released early: a TAP (FREEDOM: open the selector, CYCLE: next alien; CUSTOM / RANDOM: nothing)
    return !!h;
  }
  /** window lost focus / game paused: a hold in progress is abandoned (never completes by itself) */
  cancelHold() { if (this.hold) { this.hold = null; this.renderHold(); } }
  pressC() {
    const g = this.g;
    if (this.freeMode && (this.state === 'ready' || this.state === 'alien' || this.state === 'recharge')) { this.state === 'recharge' && this.endRecharge(); this.hold = { t: 0, done: false, tap: true }; return; }      // FREEDOM / CYCLE: the key's meaning is decided on RELEASE (tap) or after the hold time (hold)
    if (this.freeMode && this.state === 'activating') { if (this.settings.mode === 'cycle' && this.tapQ < 2) this.tapQ++; return; }
    switch (this.state) {
      case 'ready': if (this.settings.mode === 'random') this.beginTransform(pickRandomAlien(), 'random'); else this.openMenu(); break;
      case 'menu': this.confirm(); break;
      case 'alien': this.hold = { t: 0, done: false }; break;       // start timing; update() reverts when the hold reaches settings.holdRevertS
      case 'recharge': this.stats.refused++; g.hud.toast('OMNITRIX RECHARGING  ' + fmt(this.cd)); g.sfx.beep(false); break;
      default: break;                                                 // activating / reverting: C does nothing
    }
  }
  endRecharge() { this.state = 'ready'; this.cd = 0; this.renderHud(true); }
  /** a C TAP in FREEDOM (open the selector, also while transformed) or CYCLE (instantly the next alien in OMNI_ORDER; from Ben: Diamondhead) */
  tapAction() {
    if (this.settings.mode === 'freedom') { if (this.state === 'ready' || this.state === 'alien') this.openMenu(); }
    else if (this.settings.mode === 'cycle') this.cycleNext();
  }
  cycleNext() {
    if (this.state !== 'ready' && this.state !== 'alien') return; const id = this.g.chars.id, i = OMNI_ORDER.indexOf(id), next = OMNI_ORDER[(i + 1) % OMNI_ORDER.length];
    this.sel = OMNI_ORDER.indexOf(next); this.beginTransform(next, 'cycle');
  }
  openMenu() {
    if (this.state !== 'ready' && !(this.state === 'alien' && this.freeMode) ) return; this.menuFrom = this.state === 'alien' ? 'alien' : 'ben'; if (this.menuFrom === 'alien') { const k = OMNI_ORDER.indexOf(this.g.chars.id); if (k >= 0) this.sel = k; } this.state = 'menu'; this.menuAge = 0; this.queue.length = 0; this.turn = null; this.confirmWait = false; this.rotBase = 0; this.shown = this.sel; this.rotDeg = 0;
    this.g.sfx.beep(true); this.renderMenu(); this.applyDial(); $('hud').classList.add('omni-open'); $('omnimenu').hidden = false; requestAnimationFrame(() => $('omnimenu').classList.add('open'));
  }
  closeMenu() { if (this.state !== 'menu') return; this.queue.length = 0; this.turn = null; this.confirmWait = false; this.state = this.menuFrom === 'alien' && !this.isBen ? 'alien' : 'ready'; $('hud').classList.remove('omni-open'); $('omnimenu').classList.remove('open'); $('omnimenu').hidden = true; }
  /** one accepted press = exactly one alien. The press is queued; updateMenu() plays the queue one 90 deg turn at a time. */
  step(d) {
    if (this.state !== 'menu') return; const n = OMNI_ORDER.length;
    if (this.queue.length >= OMNI_CFG.queueMax) { this.stats.droppedSteps++; return; }       // absurdly fast mashing is refused as a whole press (never half-applied)
    this.queue.push(d); this.sel = (this.sel + d + n) % n; this.stats.steps++; this.g.sfx.blip && this.g.sfx.blip(0.1);
  }
  confirm() {
    if (this.state !== 'menu' || this.menuAge < 0.12) return;
    if (this.turn || this.queue.length) { this.confirmWait = true; return; }          // let the dial settle on the last pressed alien first (it takes < 0.3 s)
    const id = this.selected, fromAlien = this.menuFrom === 'alien' && !this.isBen; this.closeMenuQuiet(); if (fromAlien && id === this.g.chars.id) return; this.beginTransform(id, fromAlien || this.settings.mode === 'freedom' ? 'freedom' : 'custom');
  }
  closeMenuQuiet() { this.queue.length = 0; this.turn = null; this.confirmWait = false; $('hud').classList.remove('omni-open'); $('omnimenu').classList.remove('open'); $('omnimenu').hidden = true; this.state = this.menuFrom === 'alien' && !this.isBen ? 'alien' : 'ready'; }

  // ------------------------------------------------------------------------------------------------ transformation
  beginTransform(id, how) {
    const fromAlien = !this.isBen, direct = how === 'cycle' || how === 'freedom';
    if (!OMNI_ORDER.includes(id) || id === this.g.chars.id) return false;
    if (!((this.state === 'ready' && !fromAlien) || (direct && this.state === 'alien' && fromAlien))) return false;
    if (fromAlien && !direct) return false;
    this.ratio = null; if (fromAlien) { const h = this.g.impact.hp(); this.ratio = h.hp / Math.max(1, h.max); }       // alien -> alien: health is carried over, never refilled
    this.state = 'activating'; this.t = (direct ? 1.0 : 0); this.target = id; this.how = how; this.swapStarted = false; this.lit = direct;
    if (!fromAlien) { this.ben.cancelAll(); this.ben.vel.x *= 0.3; this.ben.vel.z *= 0.3; }
    this.stats[how] = (this.stats[how] || 0) + 1;
    if (how !== 'cycle') this.g.hud.toast(how === 'random' ? 'RANDOM  ·  ' + OMNI_NAMES[id] : OMNI_NAMES[id]);
    return true;
  }
  /** a timeline in seconds: 0-0.45 raise the arm, 0.30-0.60 flip the dial, 0.60-1.0 green light builds on the watch, 1.0 flash + swap */
  tickActivating(dt) {
    const g = this.g, b = this.ben; this.t += dt; const t = this.t;
    b.omni.raise = smoothstep(0, 0.45, t); b.omni.press = smoothstep(0.3, 0.45, t) * (1 - smoothstep(0.5, 0.62, t));
    if (t > 0.45 && t < 1.0) { b.vel.x *= 0.9; b.vel.z *= 0.9; }
    const wp = b.watchPos(this.cache.wp || (this.cache.wp = new THREE.Vector3()));
    if (t > 0.55 && t < 1.02) {                         // green light: a growing glow at the watch, motes streaming off it, one soft ring
      const k = smoothstep(0.55, 1.0, t);
      g.fx.glow.emit({ pos: wp, size: 0.25 + 0.9 * k, life: 0.09, drag: 0, color: [0.35, 1, 0.45], alpha: 0.9 });
      if (Math.random() < 0.7) g.fx.glow.emit({ pos: wp, vel: new THREE.Vector3(rand(-1, 1), rand(0.2, 1.4), rand(-1, 1)), size: rand(0.08, 0.2), life: rand(0.25, 0.5), drag: 2, color: [0.3, 1, 0.45] });
      if (!this.lit) { this.lit = true; g.sfx.transform && g.sfx.beep(true); g.fx.surface.ring(new THREE.Vector3(b.pos.x, b.pos.y + 0.06, b.pos.z), new THREE.Vector3(0, 1, 0), 2.4, 0.5, 0x4cff7a); }
    }
    if (t >= 1.0 && !this.swapStarted) { this.swapStarted = true; g.chars.switchTo(this.target); }
    if (this.swapStarted && !g.chars.pending && g.chars.id === this.target) this.onTransformed();
  }
  onTransformed() {
    const g = this.g; this.state = 'alien'; this.free = this.freeMode; this.remaining = this.free ? 0 : TRANSFORM_TIME; this.ben.omni.raise = 0; this.ben.omni.press = 0; this.warnBeep = -1; this.blinkOn = false;
    if (this.ratio != null) { this.setHpRatio(this.ratio); this.ratio = null; } else this.fillVitals(); this.stats.transforms++; this.log.push(['transform', this.target, g.player.pos.x, g.player.pos.y, g.player.pos.z]); this.renderHud(true);
  }
  setHpRatio(r) { const g = this.g, P = g.player, id = g.chars.id, h = g.impact.hp(), v = Math.max(1, h.max * r); if (typeof P.hp === 'number') P.hp = v; else if (g.impact.vit[id]) g.impact.vit[id].hp = v; }
  /** a fresh transformation starts with the alien at full health / energy */
  fillVitals() {
    const g = this.g, P = g.player, id = g.chars.id, h = g.impact.hp();
    if (typeof P.hp === 'number') P.hp = h.max; else if (g.impact.vit[id]) g.impact.vit[id].hp = g.impact.vit[id].max;
    if (typeof P.energy === 'number' && P.enMax) P.energy = P.enMax;
  }
  /** the timer ran out (or a test forced it): back to Ben where the alien stands */
  revert(how = 'timer') {
    if (this.g && this.g.finale && this.g.finale.busy()) { if (how === 'timer') this.remaining = Math.max(this.remaining, 0.25); return; }       // V33: never cut an Ultimate evolve / ship grab / throw short
    if (this.state !== 'alien') return false; const g = this.g; this.how = how; if (how === 'manual') { this.stats.manualReverts++; if (this.hold) this.hold.done = true; } else this.hold = null;
    this.state = 'reverting'; this.t = 0; this.ben.protectLand = true; this.ben.omni.raise = 0; this.ben.omni.press = 0;
    this.tapQ = 0; g.chars.switchTo('ben'); if (!g.chars.pending && g.chars.id === 'ben') this.onReverted(); return true;
  }
  onReverted() {
    const g = this.g; if (this.freeMode) { this.state = 'ready'; this.cd = 0; this.free = false; this.remaining = 0; this.stats.reverts++; this.log.push(['revert', g.player.pos.x, g.player.pos.y, g.player.pos.z]); g.hud.toast('BEN  ·  NO COOLDOWN'); this.renderHud(true); return; }
    this.state = 'recharge'; this.cd = RECHARGE_TIME; this.remaining = 0; this.stats.reverts++; this.blinkOn = false; this.log.push(['revert', g.player.pos.x, g.player.pos.y, g.player.pos.z]);
    g.hud.toast(this.how === 'manual' ? 'REVERTED  ·  OMNITRIX RECHARGING' : 'BACK TO BEN  ·  OMNITRIX RECHARGING'); this.renderHud(true);
  }

  // ------------------------------------------------------------------------------------------------ per frame
  update(dt) {
    const g = this.g;
    if (this.state === 'menu') {
      this.menuAge += dt; this.updateMenu(dt);
      if (!this.isBen && this.menuFrom !== 'alien') this.closeMenuQuiet();
    } else if (this.state === 'activating') this.tickActivating(dt);
    else if (this.state === 'alien') {
      if (!this.free) this.remaining = Math.max(0, this.remaining - dt);
      if (this.tapQ > 0 && this.settings.mode === 'cycle') { this.tapQ--; this.cycleNext(); }
      if (this.hold && !this.hold.done && this.state === 'alien') { this.hold.t += dt; if (this.hold.t >= this.settings.holdRevertS) { this.revert('manual'); this.renderHud(true); } }
      const w = this.warning && !this.free; this.blinkOn = w && (Math.floor((WARN_TIME - this.remaining) * 3) % 2 === 0);        // 3 blinks a second from 15 s on (red watch on / off)
      if (w) { const sec = Math.ceil(this.remaining); if (sec !== this.warnBeep) { this.warnBeep = sec; g.sfx.beep(false); } }
      if (this.state === 'alien' && !this.free && this.remaining <= 0) this.revert('timer');
    } else if (this.state === 'reverting') { if (!g.chars.pending && g.chars.id === 'ben') this.onReverted(); }
    else if (this.state === 'recharge') {
      this.cd = Math.max(0, this.cd - dt);
      if (this.cd <= 0) { this.state = 'ready'; this.cd = 0; g.hud.toast('OMNITRIX READY'); g.sfx.beep(true); this.renderHud(true); }
    }
    if (this.state === 'ready' && this.hold && !this.hold.done && this.hold.tap) { this.hold.t += dt; if (this.hold.t >= this.settings.holdRevertS) this.hold.done = true; }      // Ben: a long hold does nothing (and its release does nothing)
    else if (this.state !== 'alien' && this.hold && !this.hold.done) this.hold = null;
    if (this.state === 'ready' && this.tapQ > 0) { this.tapQ--; if (this.settings.mode === 'cycle') this.cycleNext(); }       // the alien state ended under a held key (timer / swap): drop it
    this.renderHold(); this.renderHud(false);
  }

  // ------------------------------------------------------------------------------------------------ DOM: HUD / menu / settings
  build() {
    const mk = (tag, id, cls, html, parent) => { const e = document.createElement(tag); if (id) e.id = id; if (cls) e.className = cls; if (html != null) e.innerHTML = html; (parent || document.getElementById('hud')).appendChild(e); return e; };
    // top-left HUD: the watch (green / red) + the character panel (alien icon / name / HP / energy / timer / status; Ben: name + HP only, never a portrait)
    const hud = mk('div', 'omni', '', '<div id="omni-watch"><img id="omni-watch-img" alt="Omnitrix" draggable="false"></div>' +
      '<div id="omni-info"><div id="omni-row"><img id="omni-icon" alt="" draggable="false" hidden><div id="omni-name">BEN TENNYSON</div></div>' +
      '<div class="omni-bar" id="omni-hpbar"><span id="omni-hplabel">HP</span><i><b id="omni-hp"></b></i></div>' +
      '<div class="omni-bar" id="omni-enbar"><span id="omni-enlabel">ENERGY</span><i><b id="omni-en"></b></i></div>' +
      '<div id="omni-timer"></div><div id="omni-status"></div><div id="omni-hold" hidden><i><b id="omni-holdfill"></b></i><span>HOLD C · REVERTING…</span></div></div>');
    void hud;
    // centred selection interface
    mk('div', 'omnimenu', '', '<div id="om-dim"></div><div id="om-stage"><div id="om-ring"></div><div id="om-holo"><img id="om-icon" alt="" draggable="false"></div>' +
      '<div id="om-dial"><img id="om-watch" alt="Omnitrix" draggable="false"></div></div>' +
      '<div id="om-label"><b id="om-name"></b><span id="om-count"></span></div><div id="om-help"><kbd>A</kbd> ↺ previous · <kbd>D</kbd> ↻ next · <kbd>C</kbd> / <kbd>Enter</kbd> transform · <kbd>Q</kbd> cancel</div>').hidden = true;
    const ring = $('om-ring'); this.pips = []; for (let i = 0; i < 12; i++) { const p = document.createElement('i'); p.style.setProperty('--a', (i * 30) + 'deg'); ring.appendChild(p); this.pips.push(p); }
    // settings section in the pause card
    const card = document.querySelector('#overlay .card');
    if (card) {
      const s = document.createElement('div'); s.id = 'omni-settings';
      s.innerHTML = '<h4>OMNITRIX SETTINGS</h4>' +
        '<div class="os-row"><span>OMNITRIX MODE</span><div class="os-seg" data-k="mode"><button type="button" data-v="custom">CUSTOM</button><button type="button" data-v="random">RANDOM</button><button type="button" data-v="freedom">FREEDOM</button><button type="button" data-v="cycle">CYCLE</button></div></div>' +
        '<div class="os-row"><span>SHOW ALIEN HUD</span><div class="os-seg" data-k="showHud"><button type="button" data-v="1">On</button><button type="button" data-v="0">Off</button></div></div>' +
        '<div class="os-row"><span>SHOW TRANSFORMATION TIMER</span><div class="os-seg" data-k="showTimer"><button type="button" data-v="1">On</button><button type="button" data-v="0">Off</button></div></div>' +
        '<div class="os-row"><span>DIAL TURN SPEED</span><div class="os-seg" data-k="rotationMs"><button type="button" data-v="200">Fast</button><button type="button" data-v="280">Normal</button><button type="button" data-v="350">Smooth</button></div></div>' +
        '<div class="os-row"><span>HOLD C TO REVERT</span><div class="os-seg" data-k="holdRevertS"><button type="button" data-v="0.5">0.5 s</button><button type="button" data-v="1">1 s</button><button type="button" data-v="1.5">1.5 s</button><button type="button" data-v="2">2 s</button></div></div>' +
        '<p class="os-note">CUSTOM / RANDOM: transformation 2:00 · recharge 1:00 (fixed) · hold C to revert early<br>FREEDOM: tap C = selector (also as an alien) · hold C = Ben · no timer, no cooldown<br>CYCLE: tap C = next alien (Diamondhead first) · hold C = Ben · no timer, no cooldown</p>';
      const stop = e => e.stopPropagation(); for (const ev of ['click', 'mousedown', 'mouseup', 'pointerdown']) s.addEventListener(ev, stop);
      s.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const k = b.parentElement.dataset.k, v = b.dataset.v; if (k === 'mode') this.setMode(v); else if (k === 'showHud') this.setShowHud(v === '1'); else if (k === 'showTimer') this.setShowTimer(v === '1'); else this.setNum(k, +v); b.blur(); });
      card.appendChild(s);
    }
    $('om-watch').src = omnitrixAssets.watch.green; $('omni-watch-img').src = omnitrixAssets.watch.green;
    this.preload();
  }
  preload() { for (const u of Object.values(omnitrixAssets.watch)) { const i = new Image(); i.src = u; } }
  applySettingsUI() {
    const s = this.settings, set = (k, val) => document.querySelectorAll('#omni-settings .os-seg[data-k="' + k + '"] button').forEach(b => b.classList.toggle('on', b.dataset.v === val));
    set('rotationMs', String(s.rotationMs)); set('holdRevertS', String(s.holdRevertS)); set('mode', s.mode); set('showHud', s.showHud ? '1' : '0'); set('showTimer', s.showTimer ? '1' : '0');
    $('omni').classList.toggle('nohud', !s.showHud); $('omni').classList.toggle('notimer', !s.showTimer);
  }
  save() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* ignore */ } }
  /** switching the mode never touches a running transformation or a cooldown (only an open, unconfirmed menu is closed) */
  setMode(m) {
    if (!MODES.includes(m)) return; this.settings.mode = m; if (this.state === 'menu' && (m === 'random' || m === 'cycle')) this.closeMenu();
    const f = m === 'freedom' || m === 'cycle'; this.hold = null;
    if (f && this.state === 'recharge') this.endRecharge();                                      // these modes have no cooldown
    if (this.state === 'alien') { if (f && !this.free) { this.free = true; this.remaining = 0; } else if (!f && this.free) { this.free = false; this.remaining = TRANSFORM_TIME; } }      // a timed transformation becomes free (no timer) / a free one gets the normal 2:00
    if (this.state === 'menu' && !f && this.menuFrom === 'alien') this.closeMenu(); this.applySettingsUI(); this.save(); }
  setNum(k, v) { if (k === 'rotationMs' && v >= 200 && v <= 350) this.settings.rotationMs = v; else if (k === 'holdRevertS' && v >= 0.5 && v <= 2) this.settings.holdRevertS = v; else return; this.applySettingsUI(); this.save(); }
  setShowHud(v) { this.settings.showHud = !!v; this.applySettingsUI(); this.save(); this.renderHud(true); }
  setShowTimer(v) { this.settings.showTimer = !!v; this.applySettingsUI(); this.save(); this.renderHud(true); }

  setText(el, v) { if (this.cache[el.id] !== v) { this.cache[el.id] = v; el.textContent = v; } }
  setStyle(el, k, v) { const key = el.id + k; if (this.cache[key] !== v) { this.cache[key] = v; el.style[k] = v; } }
  setSrc(el, v) { if (this.cache[el.id + 'src'] !== v) { this.cache[el.id + 'src'] = v; el.src = v; } }
  setHidden(el, v) { if (this.cache[el.id + 'h'] !== v) { this.cache[el.id + 'h'] = v; el.hidden = v; } }
  renderHud(force) {
    const g = this.g, id = g.chars.id, ben = id === 'ben', st = this.state;
    if (force) this.cache = Object.assign(this.cache.wp ? { wp: this.cache.wp } : {}, {});
    const color = this.watchColor; this.setSrc($('omni-watch-img'), omnitrixAssets.watch[color]);
    const root = $('omni'); const cls = 'omni ' + (ben ? 'isben ' : 'isalien ') + (this.warning ? 'warn ' : '') + (color === 'red' ? 'red ' : 'green ') + (this.settings.showHud ? '' : 'nohud ') + (this.settings.showTimer ? '' : 'notimer ');
    if (this.cache.cls !== cls) { this.cache.cls = cls; root.className = cls.trim(); }
    const icon = $('omni-icon'); if (ben) this.setHidden(icon, true); else { this.setHidden(icon, false); this.setSrc(icon, omnitrixAssets.alienIcons[id] || ''); }          // an alien: its icon. Ben: no portrait, ever
    this.setText($('omni-name'), ben ? 'BEN TENNYSON' : (OMNI_NAMES[id] || id.toUpperCase()));
    const h = g.impact.hp(); { const bar = $('omni-hpbar'); if (bar) bar.classList.toggle('low', h.hp / Math.max(1, h.max) < 0.3); } this.setText($('omni-hplabel'), 'HP  ' + Math.ceil(h.hp) + ' / ' + Math.ceil(h.max)); this.setStyle($('omni-hp'), 'width', clamp(h.hp / Math.max(1, h.max) * 100, 0, 100).toFixed(1) + '%');
    const P = g.player, hasEn = !ben && typeof P.energy === 'number' && P.enMax > 0; this.setHidden($('omni-enbar'), !hasEn);
    if (hasEn) { this.setText($('omni-enlabel'), 'ENERGY  ' + Math.ceil(P.energy) + ' / ' + Math.ceil(P.enMax)); this.setStyle($('omni-en'), 'width', clamp(P.energy / P.enMax * 100, 0, 100).toFixed(1) + '%'); }
    let timer = '', status = '';
    if (st === 'alien' && this.free) { status = this.settings.mode === 'cycle' ? 'CYCLE · TAP C: NEXT · HOLD C: BEN' : 'FREEDOM · TAP C: SELECT · HOLD C: BEN'; }
    else if (st === 'alien') { timer = fmt(this.remaining); status = this.warning ? 'OMNITRIX WARNING · HOLD C TO REVERT' : 'OMNITRIX ACTIVE · HOLD C TO REVERT'; }
    else if (st === 'recharge') { timer = fmt(this.cd); status = 'OMNITRIX RECHARGING'; }
    else if (st === 'activating' || st === 'reverting') status = 'OMNITRIX ACTIVATING';
    else status = st === 'menu' ? 'SELECT AN ALIEN' : 'OMNITRIX READY' + (this.settings.mode === 'random' ? ' · RANDOM' : this.freeMode ? ' · ' + this.settings.mode.toUpperCase() : '');
    this.setText($('omni-timer'), timer); this.setText($('omni-status'), status); this.setHidden($('omni-timer'), !timer);
  }
  /** the menu: label + pip ring + hologram symbol for the alien that is SHOWN right now (the symbol layer never rotates) */
  renderMenu() {
    const id = OMNI_ORDER[this.shown], icon = $('om-icon');
    $('om-name').textContent = OMNI_NAMES[id]; $('om-count').textContent = (this.shown + 1) + ' / ' + OMNI_ORDER.length;
    if (icon.getAttribute('src') !== omnitrixAssets.alienIcons[id]) icon.src = omnitrixAssets.alienIcons[id];
    this.pips.forEach((p, i) => p.classList.toggle('on', i === this.shown)); this.symbolStyle(1);
  }
  symbolStyle(o) { this.iconOpacity = o; const icon = $('om-icon'); icon.style.opacity = o.toFixed(3); icon.style.transform = 'scale(' + (0.72 + 0.28 * o).toFixed(3) + ')'; }
  applyDial() { $('om-dial').style.transform = 'rotate(' + this.rotDeg.toFixed(2) + 'deg)'; }
  /** the dial: take one queued press, turn the WATCH exactly 90 deg (D = +90 clockwise, A = -90 counter-clockwise, eased), fade the symbol out, swap it at the half-way point, fade it in. Always upright. */
  updateMenu(dt) {
    const n = OMNI_ORDER.length, ease = x => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    let guard = 0;
    while (guard++ < 8) {
      if (!this.turn && this.queue.length) { const dir = this.queue.shift(), dur = this.settings.rotationMs / 1000 * (this.queue.length > 1 ? 0.55 : this.queue.length ? 0.75 : 1); this.turn = { dir, t: 0, dur, swapped: false, to: (this.shown + dir + n) % n }; if (this.frames.length) this.playFrames(); }
      const T = this.turn; if (!T) break;
      T.t = Math.min(1, T.t + dt / T.dur); dt = 0;
      this.rotDeg = this.rotBase + T.dir * 90 * ease(T.t);
      if (T.t >= 0.5 && !T.swapped) { T.swapped = true; this.shown = T.to; this.renderMenu(); this.symbolStyle(0); }
      this.symbolStyle(T.t < 0.5 ? 1 - smoothstep(0, 0.5, T.t) : smoothstep(0.5, 1, T.t));
      if (T.t >= 1) { this.rotBase = ((this.rotBase + T.dir * 90) % 360 + 360) % 360; this.rotDeg = this.rotBase; this.symbolStyle(1); this.turn = null; continue; }      // finished: exactly a multiple of 90, symbol fully shown
      break;
    }
    this.applyDial();
    if (this.confirmWait && !this.turn && !this.queue.length) { this.confirmWait = false; this.confirm(); }
  }
  /** integration point for the supplied watch-turn animation: assets/omnitrix frames, in order, shown on the dial at watchAnimationFps */
  playFrames() { const img = $('om-watch'), n = this.frames.length, fps = omnitrixAssets.watchAnimationFps; let i = 0; clearInterval(this._fi); this._fi = setInterval(() => { if (i >= n) { clearInterval(this._fi); img.src = omnitrixAssets.watch.green; return; } img.src = this.frames[i++].src; }, 1000 / fps); }
  /** the hold-to-revert ring in the HUD (appears after a short delay so a tap shows nothing) */
  renderHold() {
    const h = this.hold, show = !!h && !h.done && h.t > 0.12 && this.state === 'alien';
    this.setHidden($('omni-hold'), !show); if (show) this.setStyle($('omni-holdfill'), 'width', clamp(h.t / this.settings.holdRevertS * 100, 0, 100).toFixed(1) + '%');
  }
  debugText() { return `OMNITRIX ${this.state}  mode ${this.settings.mode}  sel ${this.selected}  remaining ${this.remaining.toFixed(1)}s  recharge ${this.cd.toFixed(1)}s  watch ${this.watchColor}   transforms ${this.stats.transforms} (random ${this.stats.random}, custom ${this.stats.custom})  reverts ${this.stats.reverts}  refused C ${this.stats.refused}  manual reverts ${this.stats.manualReverts}  taps ${this.stats.taps}  hold ${this.hold ? this.hold.t.toFixed(2) : '-'}  dial ${this.rotDeg.toFixed(0)}deg`; }
}
