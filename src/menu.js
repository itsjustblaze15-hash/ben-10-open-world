// V34 CINEMATIC STARTUP SCREEN + MAIN MENU + PAUSE MENU.
// The menu is an HTML layer over the REAL game scene: Ben (the existing GLB rig), the existing mothership GLB and the existing Main City are posed for a looping, slow camera drift at sunset.
// Nothing of the gameplay simulation runs while it is open (no step(): no AI, no combat, no invasion timeline, no destruction): only the visual updates (sky / sun, terrain + city streaming, water, the ship's lights, particles)
// plus a handful of lightweight props made for the menu (red beams, five drones, fire / smoke emitters on rooftops, distant blasts, embers).
import * as THREE from 'three';
import { clamp, damp, rand } from './util.js';
import { readSave, writeSave, applySave, describe } from './savegame.js';
import { DN } from './island/daynight.js';

const SKEY = 'ben10.settings.v1';
const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/></svg>',
  cont: '<svg viewBox="0 0 24 24"><path d="M5 3h11l3 3v15H5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8 3v6h7V3M8 21v-7h8v7" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  set: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  ctl: '<svg viewBox="0 0 24 24"><path d="M6.5 8h11a4.5 4.5 0 0 1 4.4 5.4l-.7 3.3a2.6 2.6 0 0 1-4.4 1.3L14.5 16h-5l-2.3 2a2.6 2.6 0 0 1-4.4-1.3l-.7-3.3A4.5 4.5 0 0 1 6.5 8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8 10.5v3M6.5 12h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="16" cy="11" r="1" fill="currentColor"/><circle cx="18" cy="13" r="1" fill="currentColor"/></svg>',
  exit: '<svg viewBox="0 0 24 24"><path d="M10 3H4v18h6M14 7l5 5-5 5M19 12H9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  save: '<svg viewBox="0 0 24 24"><path d="M5 3h11l3 3v15H5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8 3v6h7V3M8 21v-7h8v7" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  home: '<svg viewBox="0 0 24 24"><path d="M3 11.5 12 4l9 7.5M6 10v10h12V10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/></svg>',
};
const OMNI_ZERO = '<svg class="mm-zero" viewBox="0 0 100 130"><ellipse cx="50" cy="65" rx="44" ry="58" fill="#0b1510" stroke="#39ffa0" stroke-width="9"/><path d="M26 28h48L50 64zM26 102h48L50 66z" fill="#fff"/><ellipse cx="50" cy="65" rx="44" ry="58" fill="none" stroke="#fff" stroke-width="2.5" opacity=".7"/></svg>';
const CTL_NAMES = { 'ctl-ben': 'BEN', 'ctl-dh': 'DIAMONDHEAD', 'ctl-x': 'XLR8', 'ctl-fa': 'FOUR ARMS', 'ctl-hb': 'HEATBLAST', 'ctl-up': 'UPGRADE', 'ctl-wm': 'WILDMUTT', 'ctl-gf': 'GHOSTFREAK', 'ctl-rj': 'RIPJAWS', 'ctl-sf': 'STINKFLY', 'ctl-cb': 'CANNONBOLT', 'ctl-gm': 'GREY MATTER', 'ctl-wb': 'WAY BIG' };
const GENERAL = [      // every row below is read from the real key handlers in main.js
  ['W A S D', 'Move'], ['Mouse', 'Look · wheel = camera zoom'], ['Shift', 'Run / sprint'], ['Space', 'Jump'], ['Left Click', 'Attack / main power'], ['C', 'Omnitrix (see the BEN tab for the four modes)'],
  ['Tab', 'World map'], ['B / button', 'Boss Manager (pauses the game while open)'], ['Y / button', 'Other AI on / off'], ['T / 0', 'Reset world (props, cars, bosses)'], ['N', 'Camera shake: off / low / full'], ['M', 'Sound on / off'], ['H', 'Show / hide the controls list in the game'], ['F3', 'Developer overlay'], ['Esc', 'Pause menu'],
];

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const frames = n => new Promise(r => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
function glowTex() { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,.55)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }

export class GameMenu {
  constructor(game, ctl) {
    this.g = game; this.ctl = ctl; this.on = false; this.pmOn = false; this.mode = 'main'; this.T = 0; this.busy = false;
    this.S = { sens: 100, shake: 2, vol: 50, mute: false, quality: 1 };
    try { Object.assign(this.S, JSON.parse(localStorage.getItem(SKEY) || '{}')); } catch { /* defaults */ }
    this.q = new URLSearchParams(location.search); this.stack = []; this.panelFrom = null;
    this.buildDOM(); this.bindKeys(); this.applyAll(true);
    this.overlayWatch = new MutationObserver(() => this.onOverlay()); this.overlayWatch.observe(document.getElementById('overlay'), { attributes: true, attributeFilter: ['hidden'] });
    this.scene3d = null;
  }

  // ------------------------------------------------------------------ DOM
  buildDOM() {
    const root = (id, cls) => { const e = el('div', cls); e.id = id; e.hidden = true; document.body.appendChild(e); for (const ev of ['mousedown', 'mouseup', 'click', 'pointerdown', 'wheel', 'contextmenu', 'dblclick']) e.addEventListener(ev, x => { x.stopPropagation(); if (ev === 'contextmenu') x.preventDefault(); }, { passive: ev !== 'wheel' ? undefined : true }); return e; };
    const mm = this.mm = root('mm', 'mm');
    mm.innerHTML = '<div class="mm-vig"></div><div class="mm-scan"></div>' +
      '<div class="mm-left"><div class="mm-logo"><div class="mm-l1"><b>BEN</b><b class="w">1</b>' + OMNI_ZERO + '</div><div class="mm-l3">OPEN WORLD</div></div>' +
      '<nav class="mm-btns" role="menu"></nav></div>' +
      '<div class="mm-foot"><span>↑ ↓ SELECT · ENTER CONFIRM · ESC BACK</span><span id="mm-ver">V34</span></div><div class="mm-msg" id="mm-msg" hidden></div>';
    const nav = mm.querySelector('.mm-btns');
    this.mainBtns = [['play', 'PLAY', 'START YOUR ADVENTURE', ICON.play], ['cont', 'CONTINUE', 'LOAD YOUR SAVE', ICON.cont], ['set', 'SETTINGS', 'ADJUST GAME OPTIONS', ICON.set], ['ctl', 'CONTROLS', 'VIEW CONTROLS', ICON.ctl], ['exit', 'EXIT', 'QUIT GAME', ICON.exit]].map(([a, t, s, i]) => this.mkBtn(nav, a, t, s, i));
    const pm = this.pm = root('pm', 'mm pm'); pm.innerHTML = '<div class="pm-dim"></div><div class="pm-card"><div class="pm-title">PAUSED</div><nav class="mm-btns" role="menu"></nav><div class="pm-status" id="pm-status"></div></div>';
    this.pmBtns = [['resume', 'RESUME', 'BACK TO THE GAME', ICON.play], ['set', 'SETTINGS', 'ADJUST GAME OPTIONS', ICON.set], ['ctl', 'CONTROLS', 'VIEW CONTROLS', ICON.ctl], ['save', 'SAVE GAME', 'WRITE YOUR PROGRESS', ICON.save], ['home', 'MAIN MENU', 'LEAVE THE GAME', ICON.home]].map(([a, t, s, i]) => this.mkBtn(pm.querySelector('.mm-btns'), a, t, s, i));
    const pn = this.panel = root('mmp', 'mm mmp'); pn.innerHTML = '<div class="mmp-card"><div class="mmp-head"><span id="mmp-title"></span></div><div class="mmp-body" id="mmp-body"></div><div class="mmp-foot"><button type="button" class="mm-small" data-act="back">← BACK</button></div></div>';
    pn.querySelector('[data-act=back]').addEventListener('click', () => this.back());
    const cf = this.confirmEl = root('mmc', 'mm mmc'); cf.innerHTML = '<div class="mmc-card"><div class="mmc-t" id="mmc-t"></div><div class="mmc-p" id="mmc-p"></div><div class="mmc-b" id="mmc-b"></div></div>';
    const ld = this.loadEl = root('mml', 'mm mml'); ld.innerHTML = '<div class="mm-logo sm"><div class="mm-l1"><b>BEN</b><b class="w">1</b>' + OMNI_ZERO + '</div><div class="mm-l3">OPEN WORLD</div></div><div class="mml-bar"><i id="mml-bar"></i></div><div class="mml-msg" id="mml-msg">Loading…</div>';
    this.toastEl = el('div', 'mm-toast'); this.toastEl.hidden = true; document.body.appendChild(this.toastEl);
  }
  mkBtn(nav, act, title, sub, icon) {
    const b = el('button', 'mm-btn', '<span class="ic">' + icon + '</span><span class="tx"><b>' + title + '</b><small>' + sub + '</small></span>'); b.type = 'button'; b.dataset.act = act; b.setAttribute('role', 'menuitem'); nav.appendChild(b);
    b.addEventListener('mouseenter', () => this.select(b)); b.addEventListener('focus', () => this.select(b));
    b.addEventListener('click', e => { e.stopPropagation(); this.activate(b); b.blur(); }); return b;
  }
  toast(msg, ms = 2200) { this.toastEl.textContent = msg; this.toastEl.hidden = false; clearTimeout(this._tt); this._tt = setTimeout(() => { this.toastEl.hidden = true; }, ms); }

  // ------------------------------------------------------------------ settings (the game's own: sensitivity, shake, volume, render resolution, fullscreen) - persisted + applied
  saveSettings() { try { localStorage.setItem(SKEY, JSON.stringify(this.S)); } catch { /* ignore */ } }
  applyAll() {
    const g = this.g, S = this.S;
    this.ctl.camRig.sens = 0.0022 * S.sens / 100; this.ctl.camRig.shakeLevel = S.shake;
    const sfx = g.sfx; sfx.vol = S.vol / 100; sfx.on = !S.mute; if (sfx.setVol) sfx.setVol(S.vol / 100);
    this.ctl.setRenderScale(S.quality);
  }
  // ------------------------------------------------------------------ open / close the MAIN menu
  open() {
    if (this.on) return; const g = this.g, c = this.ctl, dn = g.dayNight; this.on = true; this.mode = 'main'; this.T = 0; this.busy = false; this.stack = [];
    document.body.classList.add('in-menu'); this.mm.hidden = false; this.pm.hidden = true; this.pmOn = false;
    this.refreshContinue(); this.select(this.mainBtns[0]);
    // freeze the world clock at sunset for the menu (the real clock is put back when it closes); nothing is written to the save while it is open
    this.real = { t: dn.t, elapsed: dn.elapsed }; dn.save = () => { try { localStorage.setItem(DN.key, JSON.stringify({ elapsed: dn.elapsed, t: this.real.t, scale: dn.scale })); } catch { /* ignore */ } };
    this.buildScene3d(); c.releaseHeldInput(); this.settle();
  }
  closeMain() {
    if (!this.on) return; const g = this.g, c = this.ctl, dn = g.dayNight; this.on = false; this.mm.hidden = true; document.body.classList.remove('in-menu');
    delete dn.save; this.real = null; this.teardownScene3d(); c.camera.clearViewOffset(); c.camera.updateProjectionMatrix();
  }
  refreshContinue() {
    const s = this.saveData = readSave(this.g), b = this.mainBtns[1]; b.classList.toggle('dis', !s); b.setAttribute('aria-disabled', s ? 'false' : 'true');
    b.querySelector('small').textContent = s ? describe(s) || 'LOAD YOUR SAVE' : 'NO SAVED GAME AVAILABLE';
  }

  // ------------------------------------------------------------------ selection / activation (mouse hover selects, click activates; keyboard Up / Down / Enter / Esc)
  list() { return this.pmOn && this.mode === 'pause' ? this.pmBtns : this.mainBtns; }
  select(b) { const L = this.list(); if (!L.includes(b)) return; for (const x of L) x.classList.toggle('sel', x === b); this.sel = b; }
  move(d) {
    if (this.mode === 'panel') { const f = [...this.panel.querySelectorAll('button,input')].filter(x => x.offsetParent); if (!f.length) return; let i = f.indexOf(document.activeElement); i = i < 0 ? (d > 0 ? 0 : f.length - 1) : (i + d + f.length) % f.length; f[i].focus(); f[i].scrollIntoView({ block: 'nearest' }); return; }
    if (this.mode === 'confirm') { const f = [...this.confirmEl.querySelectorAll('button')]; let i = f.indexOf(document.activeElement); i = (i + d + f.length) % f.length; f[i].focus(); return; }
    const L = this.list(); let i = Math.max(0, L.indexOf(this.sel)); i = (i + d + L.length) % L.length; this.select(L[i]);
  }
  bindKeys() {
    addEventListener('keydown', e => {
      if (!this.on && !this.pmOn && !this.busy) return;                                   // gameplay: untouched
      if (e.ctrlKey || e.metaKey || e.altKey || /^F([1-9]|1[0-2])$/.test(e.code) && e.code !== 'F3') return;   // browser shortcuts (F5 / F11 / F12 ...) keep working
      e.preventDefault(); e.stopImmediatePropagation();                                   // while a menu is open NO gameplay key (C, Space, B, T, ...) reaches the game
      if (this.busy || e.repeat && e.code === 'Enter') return;
      const t = e.target, rng = t && t.type === 'range';
      if (e.code === 'ArrowDown' || (e.code === 'KeyS' && this.mode !== 'panel')) this.move(1);
      else if (e.code === 'ArrowUp' || (e.code === 'KeyW' && this.mode !== 'panel')) this.move(-1);
      else if ((e.code === 'ArrowLeft' || e.code === 'ArrowRight') && rng) { t.value = +t.value + (e.code === 'ArrowRight' ? 1 : -1) * (+t.step || 1) * 2; t.dispatchEvent(new Event('input')); }
      else if (e.code === 'Enter' || e.code === 'NumpadEnter') { const a = document.activeElement; if (this.mode === 'panel' || this.mode === 'confirm') { if (a && a.tagName === 'BUTTON') a.click(); } else if (this.sel) this.activate(this.sel); }
      else if (e.code === 'Escape') this.back();
    }, true);
    for (const ev of ['keyup', 'keypress']) addEventListener(ev, e => { if (this.on || this.pmOn || this.busy) { if (!(e.ctrlKey || e.metaKey || e.altKey)) e.stopImmediatePropagation(); } }, true);
  }
  back() {
    if (this.busy) return;
    if (this.mode === 'confirm') { this.closeConfirm(); return; }
    if (this.mode === 'panel') { this.closePanel(); return; }
    if (this.mode === 'msg') { this.mm.querySelector('#mm-msg').hidden = true; this.mode = 'main'; return; }
    if (this.mode === 'pause') this.resume();
  }
  activate(b) {
    const a = b.dataset.act; if (this.busy) return; this.ctl.sfxInit && this.ctl.sfxInit();
    b.classList.remove('hit'); void b.offsetWidth; b.classList.add('hit');
    if (a === 'play') this.askNewGame(); else if (a === 'cont') this.doContinue(); else if (a === 'set') this.openPanel('settings'); else if (a === 'ctl') this.openPanel('controls'); else if (a === 'exit') this.doExit();
    else if (a === 'resume') this.resume(); else if (a === 'save') this.doSave(); else if (a === 'home') this.askMainMenu();
  }

  // ------------------------------------------------------------------ PLAY / CONTINUE
  askNewGame() {
    if (readSave(this.g)) this.confirm('START A NEW GAME?', 'A saved game exists. Starting a new game does not delete it - it is only replaced when you press SAVE GAME later.', [['START NEW GAME', () => this.newGame()], ['CANCEL', null]]);
    else this.newGame();
  }
  async runSteps(title, steps) {
    this.busy = true; this.mode = 'loading'; this.loadEl.hidden = false; this.loadEl.classList.remove('out'); const bar = document.getElementById('mml-bar'), msg = document.getElementById('mml-msg'); bar.style.width = '0%'; msg.textContent = title;
    await frames(2);
    for (let i = 0; i < steps.length; i++) {
      msg.textContent = steps[i][0] + '…'; await frames(2);
      try { await steps[i][1](); } catch (e) { console.error('menu step failed:', steps[i][0], e); this.loadEl.hidden = true; this.busy = false; this.mode = 'main'; this.toast('SOMETHING WENT WRONG - SEE CONSOLE'); return false; }
      bar.style.width = ((i + 1) / steps.length * 100).toFixed(0) + '%'; await frames(2);
    }
    return true;
  }
  async newGame() {
    const g = this.g, c = this.ctl, dn = g.dayNight;
    const ok = await this.runSteps('STARTING A NEW GAME', [
      ['Resetting the world clock and the invasion timeline', () => { const sc = dn.scale; delete dn.save; dn.resetJourney(); dn.t = DN.start; dn.scale = sc; dn.apply(0); try { dn.regenEnv(); } catch { /* optional */ } dn.save(); if (g.finale) g.finale.reset(); const v = g.vilgax; if (v && v.present) { try { v.bossDespawn(); g.bosses.updateUI(); } catch { /* ignore */ } } }],
      ['Placing Ben at the start', () => c.newPlayer()],
      ['Resetting props, enemies and fires', () => c.resetWorld()],
      ['Streaming the terrain and the city', () => c.stream(7)],
      ['Starting', () => this.leaveMenu()],
    ]);
    if (ok) this.finishStart();
  }
  async doContinue() {
    const s = readSave(this.g); if (!s) { this.refreshContinue(); this.toast('NO SAVED GAME AVAILABLE'); const b = this.mainBtns[1]; b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); return; }
    const g = this.g, c = this.ctl;
    const ok = await this.runSteps('LOADING YOUR SAVED GAME', [
      ['Reading the save', () => { if (!readSave(g)) throw new Error('save became invalid'); }],
      ['Restoring the world clock and the invasion', () => { delete g.dayNight.save; return applySave(g, c, s); }],
      ['Streaming the terrain and the city', () => c.stream(7)],
      ['Starting', () => this.leaveMenu()],
    ]);
    if (ok) this.finishStart();
  }
  /** the menu layer goes away (fade) and the gameplay systems take over; the pointer is captured on the same click gesture */
  leaveMenu() { this.closeMain(); this.ctl.snapCamera(); }
  finishStart() {
    this.loadEl.classList.add('out'); this.ctl.beginPlay(); const lk = () => { this.loadEl.hidden = true; this.busy = false; this.mode = 'main'; };
    setTimeout(lk, 450);
    setTimeout(() => { if (!this.ctl.started()) this.showPause('CLICK RESUME TO CAPTURE THE MOUSE'); }, 3000);      // the browser refused the pointer capture: the pause menu is the safe fallback
  }

  // ------------------------------------------------------------------ EXIT
  doExit() {
    this.busy = true; try { window.close(); } catch { /* ignore */ }
    setTimeout(() => {
      this.busy = false; if (document.visibilityState === 'hidden' && window.closed) return;
      const m = document.getElementById('mm-msg'); m.innerHTML = '<b>THE BROWSER DID NOT CLOSE THE PAGE</b><span>Pages cannot always close themselves. You can close this tab or window yourself - the game stays safely in the main menu.</span><button type="button" class="mm-small">OK</button>';
      m.hidden = false; this.mode = 'msg'; m.querySelector('button').onclick = () => { m.hidden = true; this.mode = 'main'; };
    }, 300);
  }

  // ------------------------------------------------------------------ pause menu
  showPause(status = '') {
    if (this.on || this.pmOn) return; this.pmOn = true; this.mode = 'pause'; this.pm.hidden = false; document.getElementById('pm-status').textContent = status; this.select(this.pmBtns[0]); this.ctl.releaseHeldInput();
    document.body.classList.add('in-pause');
  }
  hidePause() { this.pmOn = false; this.pm.hidden = true; document.body.classList.remove('in-pause'); if (this.mode === 'pause') this.mode = 'main'; }
  resume() { this.hidePause(); this.ctl.resume(); }
  onOverlay() {
    const ov = document.getElementById('overlay'); if (ov.hidden) { if (this.pmOn && this.mode === 'pause' && this.ctl.playing()) this.hidePause(); return; }
    ov.hidden = true;                                       // the old "PAUSED - CLICK TO RESUME" card is replaced by the pause menu
    if (this.on || this.busy) return; if (this.ctl.started()) this.showPause(); else this.open();
  }
  doSave() { const ok = writeSave(this.g, this.ctl); const st = document.getElementById('pm-status'); st.textContent = ok ? 'GAME SAVED' : 'COULD NOT SAVE (BROWSER STORAGE BLOCKED)'; st.dataset.ok = ok ? '1' : '0'; this.refreshContinue(); }
  askMainMenu() {
    this.confirm('RETURN TO THE MAIN MENU?', 'The current game stops completely. Progress since your last save is lost unless you save first.', [['SAVE & EXIT', () => { writeSave(this.g, this.ctl); this.toMain(); }], ['EXIT WITHOUT SAVING', () => this.toMain()], ['CANCEL', null]]);
  }
  /** a clean return to the main menu = a fresh page load: every gameplay system (invasion, AI, particles, audio) is disposed with the old page, so nothing keeps running unseen */
  toMain() { this.busy = true; this.confirmEl.hidden = true; this.loadEl.hidden = false; document.getElementById('mml-msg').textContent = 'Returning to the main menu…'; document.getElementById('mml-bar').style.width = '100%'; try { document.exitPointerLock && document.exitPointerLock(); } catch { /* ignore */ } setTimeout(() => location.reload(), 120); }

  confirm(title, text, btns) {
    const prev = this.mode; this.mode = 'confirm'; this.confirmEl.hidden = false; document.getElementById('mmc-t').textContent = title; document.getElementById('mmc-p').textContent = text; const box = document.getElementById('mmc-b'); box.innerHTML = '';
    btns.forEach(([t, fn], i) => { const b = el('button', 'mm-small' + (i === 0 ? ' pri' : '')); b.type = 'button'; b.textContent = t; b.addEventListener('click', e => { e.stopPropagation(); this.closeConfirm(prev); if (fn) fn(); }); box.appendChild(b); });
    this._prevMode = prev; box.querySelector('button').focus();
  }
  closeConfirm(prev) { this.confirmEl.hidden = true; this.mode = prev || this._prevMode || (this.pmOn ? 'pause' : 'main'); }

  // ------------------------------------------------------------------ panels: SETTINGS (the game's own settings re-parented + the game options) and CONTROLS (read from the real tables)
  openPanel(kind) {
    const from = this.pmOn ? 'pause' : 'main'; this.panelFrom = from; this.panelKind = kind; this.mode = 'panel'; const body = document.getElementById('mmp-body'); body.innerHTML = ''; this.panel.hidden = false; this.panel.dataset.kind = kind;
    document.getElementById('mmp-title').textContent = kind === 'settings' ? 'SETTINGS' : 'CONTROLS';
    if (kind === 'settings') this.buildSettings(body); else this.buildControls(body);
    const f = this.panel.querySelector(kind === 'controls' ? '.mmp-tabs button' : 'button,input'); if (f) f.focus();
  }
  closePanel() {
    const card = document.querySelector('#overlay .card'); for (const id of ['omni-settings', 'world-settings']) { const n = document.getElementById(id); if (n && card && n.parentElement !== card) card.appendChild(n); }       // hand the game's own settings back to their original home
    this.panel.hidden = true; this.mode = this.panelFrom === 'pause' ? 'pause' : 'main'; if (this.panelFrom === 'pause') this.pmOn = true;
  }
  buildSettings(body) {
    const S = this.S, sec = (t) => { const d = el('div', 'mmp-sec'); d.innerHTML = '<h4>' + t + '</h4>'; body.appendChild(d); return d; };
    const seg = (parent, label, opts, get, set) => { const r = el('div', 'os-row', '<span>' + label + '</span>'); const s = el('div', 'os-seg'); opts.forEach(([t, v]) => { const b = el('button', '', t); b.type = 'button'; b.addEventListener('click', e => { e.stopPropagation(); set(v); [...s.children].forEach(x => x.classList.toggle('on', x === b)); }); if (get() === v) b.classList.add('on'); s.appendChild(b); }); r.appendChild(s); parent.appendChild(r); return s; };
    const rng = (parent, label, min, max, get, set, fmt) => { const r = el('div', 'os-row', '<span>' + label + '</span>'); const w = el('div', 'mmp-rng'); const i = el('input'); i.type = 'range'; i.min = min; i.max = max; i.step = 1; i.value = get(); const o = el('em', '', fmt(get())); i.addEventListener('input', () => { set(+i.value); o.textContent = fmt(+i.value); }); w.append(i, o); r.appendChild(w); parent.appendChild(r); };
    const g = sec('GAME OPTIONS');
    seg(g, 'GRAPHICS QUALITY (RENDER RESOLUTION)', [['LOW', 0.6], ['MEDIUM', 0.8], ['HIGH', 1], ['ULTRA', 1.5]], () => S.quality, v => { S.quality = v; this.ctl.setRenderScale(v); this.saveSettings(); });
    const fsRow = el('div', 'os-row', '<span>FULLSCREEN</span>'); const fsb = el('div', 'os-seg'); const on = el('button', '', 'ON'), off = el('button', '', 'OFF'); on.type = off.type = 'button'; fsb.append(on, off); fsRow.appendChild(fsb); g.appendChild(fsRow);
    const sync = () => { const f = !!document.fullscreenElement; on.classList.toggle('on', f); off.classList.toggle('on', !f); };
    on.addEventListener('click', async e => { e.stopPropagation(); try { await document.documentElement.requestFullscreen(); } catch { this.toast('THE BROWSER BLOCKED FULLSCREEN HERE - PRESS F11'); } sync(); });
    off.addEventListener('click', async e => { e.stopPropagation(); try { if (document.fullscreenElement) await document.exitFullscreen(); } catch { /* ignore */ } sync(); }); sync();
    rng(g, 'MASTER VOLUME', 0, 100, () => S.vol, v => { S.vol = v; this.applyAll(); this.saveSettings(); }, v => v + '%');
    seg(g, 'SOUND', [['ON', false], ['OFF', true]], () => S.mute, v => { S.mute = v; this.applyAll(); this.saveSettings(); });
    rng(g, 'MOUSE SENSITIVITY', 20, 220, () => S.sens, v => { S.sens = v; this.applyAll(); this.saveSettings(); }, v => v + '%');
    seg(g, 'CAMERA SHAKE', [['OFF', 0], ['LOW', 1], ['FULL', 2]], () => S.shake, v => { S.shake = v; this.applyAll(); this.saveSettings(); });
    // the game's EXISTING settings (Omnitrix + world time) - the same nodes, moved here while this panel is open
    for (const id of ['omni-settings', 'world-settings']) { const n = document.getElementById(id); if (n) { body.appendChild(n); n.classList.add('in-mm'); } }
    const o = this.g.omni; if (o && o.applySettingsUI) o.applySettingsUI(); if (this.g.dayNight) this.g.dayNight.syncSettings();
  }
  buildControls(body) {
    const tabs = el('div', 'mmp-tabs'), view = el('div', 'mmp-view'); body.append(tabs, view);
    const mk = (name, build) => { const b = el('button', '', name); b.type = 'button'; b.addEventListener('click', e => { e.stopPropagation(); [...tabs.children].forEach(x => x.classList.toggle('on', x === b)); view.innerHTML = ''; view.appendChild(build()); view.scrollTop = 0; }); tabs.appendChild(b); return b; };
    const first = mk('GENERAL', () => { const t = el('table'); for (const [k, v] of GENERAL) { const r = t.insertRow(); r.insertCell().textContent = k; r.insertCell().textContent = v; } return t; });
    for (const id of Object.keys(CTL_NAMES)) { const src = document.getElementById(id); if (!src) continue; mk(CTL_NAMES[id], () => { const t = src.cloneNode(true); t.removeAttribute('id'); t.hidden = false; t.querySelectorAll('tr').forEach(r => { r.className = ''; }); return t; }); }
    first.click();
  }

  // ------------------------------------------------------------------ the cinematic background
  settle() { const c = this.ctl; this.stepScene(0.05, true); c.stream(10, this.cam); }
  buildScene3d() {
    const g = this.g, c = this.ctl, W = c.world, THREE_ = THREE, q = this.q;
    const sx = +q.get('mmx') || -335, sz = +q.get('mmz') || 306, ben = g.ben; this.hd = q.get('mmr') != null ? +q.get('mmr') : 0.12;
    this.spot = new THREE.Vector3(sx, 0, sz);
    const gy = W.groundAt ? W.groundAt(sx, sz, 40, 80, 0.3) : 1; this.spot.y = isFinite(gy) && gy > -5 ? gy : 1.2;
    this.saved = { fov: c.camera.fov, benVisible: ben.root.visible };
    // Ben: the existing GLB rig, standing at the overlook, facing the city; idle breathing + head drift come from his own animator
    c.useBen(); ben.pos.copy(this.spot); ben.vel && ben.vel.set(0, 0, 0); ben.yaw = Math.PI - this.hd; ben.root.position.copy(this.spot); ben.root.rotation.y = Math.PI - this.hd; ben.root.visible = true; ben.root.updateMatrixWorld(true);
    // the mothership (existing GLB) hovering over the city
    const sh = g.mothership, F = sh.fin; this.shipOld = { mode: F.mode, pos: F.pos.clone(), rx: F.rx, ry: F.ry, rz: F.rz };
    F.mode = 'menu'; F.pos.set(+q.get('shx') || -290, +q.get('shy') || 205, +q.get('shz') || -110); F.rx = 0.05; F.ry = q.get('shr') != null ? +q.get('shr') : 1.25; F.rz = -0.03; this.ship = sh;
    // glow sprites: the Omnitrix on Ben's wrist, the red core under the ship, one per drone
    const tex = this.tex || (this.tex = glowTex()), mkS = (col, s) => { const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); m.scale.setScalar(s); return m; };
    this.watchGlow = mkS(0x39ffa0, 0.7); this.watchGlow.material.depthTest = false; this.watchGlow.renderOrder = 20; try { ben.rig.markers.watch.add(this.watchGlow); } catch { g.scene.add(this.watchGlow); }
    this.coreGlow = mkS(0xff2a18, 160); g.scene.add(this.coreGlow);
    // red energy beams (pooled, additive, flickering)
    this.beams = []; const bg = new THREE.CylinderGeometry(1.1, 3.4, 1, 10, 1, true); bg.translate(0, 0.5, 0);
    for (let i = 0; i < 6; i++) { const m = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({ color: 0xff2a18, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })); m.visible = false; m.frustumCulled = false; g.scene.add(m); const core = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({ color: 0xffc8b8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })); core.visible = false; core.frustumCulled = false; g.scene.add(core); const hit = mkS(0xff6a30, 30); hit.visible = false; g.scene.add(hit); this.beams.push({ m, core, hit, st: 'idle', t: rand(0, 4), dur: 3, tgt: new THREE.Vector3(), from: new THREE.Vector3(), fu: rand(0.15, 0.85), fv: rand(0.2, 0.8) }); }
    // five drones (simple cartoon bodies; no AI)
    this.drones = []; const dm = new THREE.MeshStandardMaterial({ color: 0x1f3a2c, roughness: 0.5, metalness: 0.5 }), em = new THREE.MeshBasicMaterial({ color: 0xff2a18 }), rm = new THREE.MeshBasicMaterial({ color: 0xaaffcc });
    for (let i = 0; i < 5; i++) { const gr = new THREE.Group(), body = new THREE.Mesh(new THREE.SphereGeometry(0.8, 14, 10), dm), eye = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), em); eye.position.z = 0.68; gr.add(body, eye); const rots = []; for (const x of [-1.2, 1.2]) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 5, 14), rm); r.position.set(x, 0.18, -0.1); r.rotation.x = Math.PI / 2; gr.add(r); rots.push(r); } const gl = mkS(0xff3a20, 5); gr.add(gl); gr.scale.setScalar(2.4); g.scene.add(gr); this.drones.push({ gr, rots, ph: i * 1.26 + rand(0, 1), rad: rand(70, 150), spd: rand(0.05, 0.09) * (i % 2 ? -1 : 1), h: rand(35, 85), cz: rand(-60, 10), cx: -278 + rand(-40, 40) }); }
    // rooftop fires (picked from the real city's tall buildings, spread out, in front of the camera)
    const list = (g.destruct && g.destruct.list) || [], cam0 = new THREE.Vector3(sx, 0, sz), pick = [];
    const cand = list.filter(b => b && isFinite(b.h) && b.h >= 30 && b.z < sz - 90 && b.z > sz - 560 && Math.abs(b.x - sx) < 260).sort((a, b) => b.h - a.h);
    for (const b of cand) { b.topY = (b.y0 || 0) + b.h; for (const c of list) if (c !== b && Math.abs(c.x - b.x) < b.w / 2 + 2 && Math.abs(c.z - b.z) < b.d / 2 + 2) b.topY = Math.max(b.topY, (c.y0 || 0) + c.h); }      // towers are stacked boxes: the real roof is the highest tier
    cand.sort((a, b) => b.topY - a.topY);
    for (const b of cand) { if (pick.length >= 16) break; if (pick.every(p => Math.hypot(p.x - b.x, p.z - b.z) > 55)) pick.push(b); }
    this.roofs = pick.length >= 4 ? pick : (cand.length ? cand.slice(0, 12) : []); this.fi = 0; this.expT = 2.5; void cam0; this.emT = 0;
    this.cam = new THREE.Vector3(); this.shipBox = new THREE.Box3(); this.boxT = 0;
    this.wind = new THREE.Vector3(3.2, 0, -0.6);
    this.look = new THREE.Vector3(); this.glanceT = 6; this.glance = 0; this.glanceGoal = 0;
  }
  teardownScene3d() {
    const g = this.g; if (this.ship) { const F = this.ship.fin, o = this.shipOld; F.mode = o.mode; F.pos.copy(o.pos); F.rx = o.rx; F.ry = o.ry; F.rz = o.rz; }
    for (const b of this.beams || []) { g.scene.remove(b.m); g.scene.remove(b.core); g.scene.remove(b.hit); b.m.material.dispose(); b.core.material.dispose(); }
    for (const d of this.drones || []) g.scene.remove(d.gr);
    if (this.watchGlow && this.watchGlow.parent) this.watchGlow.parent.remove(this.watchGlow); if (this.coreGlow) g.scene.remove(this.coreGlow);
    this.beams = this.drones = null; this.coreGlow = this.watchGlow = null; this.ctl.camera.fov = this.saved ? this.saved.fov : 60; this.ctl.camera.updateProjectionMatrix();
  }
  /** per-frame, MENU ONLY: replaces step() (no AI / combat / invasion / destruction run) */
  frame(dt) { this.T += dt; this.stepScene(dt); }
  stepScene(dt, quick = false) {
    const g = this.g, c = this.ctl, W = c.world, dn = g.dayNight, T = this.T, ben = g.ben, cam = c.camera;
    // sunset with a slow, subtle change of light (the clock itself is frozen: scale 0 for this call)
    const sc = dn.scale; dn.scale = 0; dn.t = ((+this.q.get('mmt') || 17.85) + Math.sin(T * 0.045) * 0.18 + Math.sin(T * 0.11) * 0.05) / 24; dn.update(dt, cam); dn.scale = sc;
    { const U = W.skyMat.uniforms, es = 0.06 + 0.03 * Math.sin(T * 0.045), az = +this.q.get('mmsa') || 0.62;      // the setting sun sits low behind the skyline (right of the ship): orange glow behind the city, long warm light
      dn.sunV.set(Math.sin(this.hd) + az, es, -0.8).normalize(); U.uSun.value.copy(dn.sunV); W.sunDir.copy(dn.sunV);
      // the burning-city grade: a warm, smoky sunset sky + haze (menu only; the real sky is restored by the very next dn.update in the game)
      const mix = (v, r, g, b, k) => { const x = v.x ?? v.r, y = v.y ?? v.g, z = v.z ?? v.b; v.set(x + (r - x) * k, y + (g - y) * k, z + (b - z) * k); };
      mix(U.uHor.value, 1.0, 0.42, 0.14, 0.8); mix(U.uTop.value, 0.34, 0.14, 0.17, 0.62); mix(U.uGlow.value, 1.0, 0.46, 0.12, 0.9); mix(W.scene.fog.color, 0.72, 0.34, 0.2, 0.5); }
    // Ben: idle only. A slow glance to the side now and then (towards the ship / the city), the rest of the idle life comes from his animator
    this.glanceT -= dt; if (this.glanceT <= 0) { this.glanceGoal = this.glanceGoal ? 0 : (Math.random() < 0.5 ? 0.42 : -0.34); this.glanceT = this.glanceGoal ? rand(3, 4.5) : rand(8, 13); }
    this.glance = damp(this.glance, this.glanceGoal, 1.6, dt); ben.yaw = Math.PI - this.hd + this.glance; ben.pos.x = this.spot.x; ben.pos.z = this.spot.z; ben.pos.y = this.spot.y;
    ben.updatePhysics(dt, { moveX: 0, moveY: 0, run: false, jump: false, jumpHeld: false, dash: false, down: false }, 0, g.combat); ben.updateAnim(dt);
    // camera: slow looping drift (no jumps, no spins, no fast zoom). Ben stays in the lower-left third, the ship and the skyline above.
    const bx = this.spot.x, by = this.spot.y, bz = this.spot.z, d = +this.q.get('mmd') || 3.1, hgt = +this.q.get('mmh') || 1.5;
    const hd = this.hd, fx_ = Math.sin(hd), fz_ = -Math.cos(hd), rx_ = Math.cos(hd), rz_ = Math.sin(hd), cd = d + Math.cos(T * 0.11) * 0.45, cr = (+this.q.get('mmc') || 0.3) - clamp(1.6 - innerWidth / innerHeight, 0, 0.6) * 2.2 + Math.sin(T * 0.13) * 0.4;
    cam.position.set(bx - fx_ * cd + rx_ * cr, by + hgt + Math.sin(T * 0.09) * 0.14, bz - fz_ * cd + rz_ * cr);
    const lf = 110, lr = -7 + Math.sin(T * 0.07) * 4; this.look.set(bx + fx_ * lf + rx_ * lr, by + (+this.q.get('mml') || 20) + Math.sin(T * 0.05) * 2.5, bz + fz_ * lf + rz_ * lr);
    cam.lookAt(this.look); cam.fov = (+this.q.get('mmf') || 52) + Math.sin(T * 0.06) * 1.1;
    const w = innerWidth, h = innerHeight, asp = w / h, shift = clamp((asp - 1.2) * 0.07, 0.0, 0.2) * w; cam.setViewOffset(w, h, -shift, 0, w, h); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true); this.cam.copy(cam.position);
    // the world's own visual updates
    c.lagoon.update(dt, cam, c.renderer); if (W.terrain) W.terrain.update(dt, cam.position); if (c.island) c.island.update(dt, cam.position);
    g.mothership.update(dt, cam); W.sky.position.copy(cam.position); W.followSun(ben.pos);
    if (!quick) this.fx(dt); const fx = g.fx; fx.shards.update(dt); fx.fire.update(dt, c.renderer, cam); fx.smoke.update(dt, c.renderer, cam); fx.glow.update(dt, c.renderer, cam); fx.dust.update(dt, c.renderer, cam); fx.surface.update(dt);
    if (this.watchGlow) { const k = 0.8 + 0.35 * Math.sin(T * 2.6); this.watchGlow.scale.setScalar(0.42 * k); this.watchGlow.material.opacity = 0.6 + 0.4 * Math.sin(T * 2.6 + 1); }
  }
  fx(dt) {
    const g = this.g, T = this.T, fire = g.fire, glow = g.fx.glow, cam = this.cam, sh = this.ship, V = (x, y, z) => new THREE.Vector3(x, y, z);
    // fires + smoke on the rooftops (round-robin: a few emitters a frame)
    const R = this.roofs; if (R.length) for (let k = 0; k < 5; k++) {
      const b = R[this.fi++ % R.length], top = b.topY ?? ((b.y0 || 0) + b.h), dist = Math.hypot(b.x - cam.x, b.z - cam.z), s = clamp(dist / 110, 1, 3.4), hw = (b.w || 12) * 0.32, hd = (b.d || 12) * 0.32;
      fire.flame(V(b.x + rand(-hw, hw), top + rand(0, 3), b.z + rand(-hd, hd)), V(rand(-0.6, 0.6), rand(3, 6), rand(-0.6, 0.6)), rand(6, 11) * s, rand(0.9, 1.4), 1.2);
      if (k < 2) g.fx.glow.emit({ pos: V(b.x + rand(-hw, hw), top + 4, b.z + rand(-hd, hd)), size: rand(30, 46) * s, life: 0.35, drag: 0, color: [1, 0.5, 0.14], alpha: rand(0.5, 0.85) });
      if (Math.random() < 0.33) fire.smoke(V(b.x + rand(-hw, hw), top + 2, b.z + rand(-hd, hd)), V(this.wind.x + rand(-1, 1), rand(5, 9), this.wind.z), rand(14, 26) * s * 0.75, rand(6, 9));
      if (Math.random() < 0.7) { const fy = (b.y0 || 0) + b.h * rand(0.2, 0.85), fp = V(b.x + rand(-hw * 1.5, hw * 1.5), fy, b.z + (b.d || 12) / 2 + 0.5); fire.flame(fp, V(0, rand(3, 6), 1.2), rand(6, 10) * s * 0.8, rand(0.7, 1.2), 1.1); if (Math.random() < 0.5) g.fx.glow.emit({ pos: fp, size: rand(24, 38) * s, life: 0.3, drag: 0, color: [1, 0.42, 0.1], alpha: rand(0.45, 0.8) }); }
    }
    // a distant explosion every few seconds (visual only: no damage, no physics, no real destruction)
    this.expT -= dt; if (this.expT <= 0 && R.length) {
      this.expT = rand(2.6, 5.2); const b = R[(Math.random() * R.length) | 0], y = (b.y0 || 0) + b.h * rand(0.5, 1), p = V(b.x + rand(-6, 6), y, b.z + (b.d || 12) / 2 + 1), s = clamp(Math.hypot(b.x - cam.x, b.z - cam.z) / 90, 1, 3.6);
      glow.emit({ pos: p, size: 26 * s, life: 0.5, drag: 0, color: [1, 0.62, 0.22], alpha: 1 }); glow.emit({ pos: p.clone(), size: 12 * s, life: 0.28, drag: 0, color: [1, 0.95, 0.7], alpha: 1 });
      fire.burst(p, 20, 12 * s, 3.4 * s, 1.1, 0.4); for (let i = 0; i < 7; i++) fire.smoke(p.clone(), V(rand(-4, 5), rand(4, 11), rand(-4, 4)), rand(10, 20) * s, rand(4, 7));
    }
    // atmosphere: embers and ash drifting through the shot
    for (let i = 0; i < 2; i++) {
      const f = V(rand(-24, 24), rand(-1, 16), -rand(8, 70)).applyQuaternion(g.cam3q || this.ctl.camera.quaternion).add(cam), ash = Math.random() < 0.4;
      glow.emit({ pos: f, vel: V(rand(1.2, 3.2), rand(0.5, 2.4), rand(-1, 0.5)), size: ash ? rand(0.1, 0.2) : rand(0.06, 0.16), life: rand(3, 6), drag: 0.1, color: ash ? [0.5, 0.48, 0.45] : [1, 0.55, 0.2], alpha: ash ? 0.5 : 0.9 });
    }
    // ship: bounding box (refreshed twice a second) -> beam origins and the red core glow
    this.boxT -= dt; if (this.boxT <= 0) { this.boxT = 0.5; this.shipBox.setFromObject(sh.root); }
    const bx = this.shipBox; if (!bx.isEmpty() && sh.loaded) {
      const cx = (bx.min.x + bx.max.x) / 2, cz = (bx.min.z + bx.max.z) / 2; this.coreGlow.position.set(cx, bx.min.y + 4, cz); const pulse = 0.55 + 0.45 * Math.max(0, Math.sin(T * 0.9)) ** 3; this.coreGlow.material.opacity = 0.18 + 0.32 * pulse; this.coreGlow.scale.setScalar(Math.max(50, (bx.max.x - bx.min.x) * 0.36) * (0.8 + 0.3 * pulse));
      for (const bm of this.beams) {
        bm.t -= dt;
        if (bm.st === 'idle') { if (bm.t <= 0 && R.length) { const b = R[(Math.random() * R.length) | 0]; bm.tgt.set(b.x + rand(-5, 5), b.topY ?? ((b.y0 || 0) + b.h), b.z + rand(-5, 5)); bm.from.set(bx.min.x + (bx.max.x - bx.min.x) * bm.fu, bx.min.y + 3, bx.min.z + (bx.max.z - bx.min.z) * bm.fv); bm.st = 'on'; bm.dur = rand(2.6, 5); bm.t = bm.dur; bm.m.visible = bm.core.visible = bm.hit.visible = true; } continue; }
        const k = bm.t / bm.dur, a = Math.min(1, (1 - k) * 5) * Math.min(1, k * 3.5), fl = 0.72 + 0.28 * Math.sin(T * 40 + bm.fu * 50) * Math.sin(T * 17);
        const dir = bm.tgt.clone().sub(bm.from), len = dir.length(); bm.m.position.copy(bm.from); bm.m.quaternion.setFromUnitVectors(V(0, 1, 0), dir.normalize()); const wd = 0.8 + len / 400; bm.m.scale.set(wd, len, wd); bm.m.material.opacity = 0.62 * a * fl; bm.core.position.copy(bm.from); bm.core.quaternion.copy(bm.m.quaternion); bm.core.scale.set(wd * 0.3, len, wd * 0.3); bm.core.material.opacity = 0.55 * a * fl;
        bm.hit.position.copy(bm.tgt); bm.hit.material.opacity = 0.9 * a * fl; bm.hit.scale.setScalar(26 + 8 * fl);
        if (Math.random() < 0.3) fire.burst(bm.tgt.clone(), 3, 8, 3, 0.8, 0.6);
        if (bm.t <= 0) { bm.st = 'idle'; bm.t = rand(1, 4); bm.m.visible = bm.core.visible = bm.hit.visible = false; }
      }
    }
    // drones: slow orbits around the city, red eye + spinning rotors
    for (const d of this.drones) { const a = d.ph + T * d.spd, x = d.cx + Math.cos(a) * d.rad, z = d.cz + Math.sin(a) * d.rad * 0.55, y = d.h + Math.sin(T * 0.7 + d.ph) * 4; const dx = -Math.sin(a) * Math.sign(d.spd), dz = Math.cos(a) * 0.55 * Math.sign(d.spd); d.gr.position.set(x, y, z); d.gr.rotation.y = Math.atan2(dx, dz); d.gr.rotation.z = Math.sin(T + d.ph) * 0.08; for (const r of d.rots) r.rotation.z += dt * 38; }
  }
}
