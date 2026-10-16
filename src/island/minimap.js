// MINIMAP (top right, circular): drawn from the SAME data the world is built from - the terrain heightfield colours + hill shading, the real water depth,
// every road ribbon at its real width, the city street grid, every building footprint, bridges, the pier, and the landmarks - baked once into a 1 px = 2 m map
// in world coordinates. Each frame the map turns with the camera (view direction = up), the player arrow shows the character's facing, a north marker rides the rim,
// boss markers show present bosses (clamped to the rim when off the map), and the region name underneath changes as you cross region borders.
// TAB toggles a full-island map with region labels.
import { BOUNDS, SEA, POI, REGIONS, CITY } from './layout.js';
import { REGION_IDS } from './terrain_gen.js';

const PX = 2;                                   // metres per map pixel
export class Minimap {
  constructor(game, island) {
    this.g = game; this.island = island; this.T = island.T; this.zoom = 1; this.t = 0; this.big = false;
    this.W = Math.ceil((BOUNDS.x1 - BOUNDS.x0) / PX); this.H = Math.ceil((BOUNDS.z1 - BOUNDS.z0) / PX);
    this.base = this.bake();
    const wrap = document.createElement('div'); wrap.id = 'minimap'; wrap.innerHTML = '<canvas width="220" height="220"></canvas><div id="mm-region"></div>';
    (document.getElementById('hud') || document.body).appendChild(wrap); this.el = wrap; this.cv = wrap.querySelector('canvas'); this.cx = this.cv.getContext('2d'); this.regionEl = wrap.querySelector('#mm-region');
    const big = document.createElement('div'); big.id = 'bigmap'; big.hidden = true; big.innerHTML = '<canvas></canvas><div class="bm-title">BEN 10 · OPEN WORLD</div><div class="bm-legend"><b data-l="zin">＋</b><b data-l="zout">－</b><b data-l="ctr">◎ CENTRE</b><span data-l="boss"><i style="background:#ff3a2a"></i>BOSS</span><span data-l="train"><i style="background:#ff9a2a;border-radius:2px"></i>TRAIN BOTS</span><span data-l="sea"><i style="background:#2ad0ff;transform:rotate(45deg)"></i>UNDERWATER</span><span data-l="other"><i style="background:#c46aff"></i>OTHER</span><span data-l="inv"><i style="background:#ff4a3a;border:2px solid #1d4a2a"></i>INVASION</span><span data-l="poi"><i style="background:#ffd23a"></i>PLACES</span></div><div class="bm-help">DRAG PAN · WHEEL / +/- ZOOM · C CENTRE · TAB CLOSE</div>'; document.body.appendChild(big); this.bigEl = big; this.bigCv = big.querySelector('canvas');
    this.region = '';
  }
  // ------------------------------------------------------------------------------------------------ bake
  bake() {
    const T = this.T, c = document.createElement('canvas'); c.width = this.W; c.height = this.H; const g = c.getContext('2d');
    const img = g.createImageData(this.W, this.H), d = img.data, cols = this.g.world.terrain.colors;
    const hAt = (x, z) => this.g.world.terrain.height(x, z);
    for (let py = 0; py < this.H; py++) for (let px = 0; px < this.W; px++) {
      const x = BOUNDS.x0 + px * PX, z = BOUNDS.z0 + py * PX, i = Math.max(0, Math.min(T.nx - 1, Math.round((x - T.x0) / T.cell))), j = Math.max(0, Math.min(T.nz - 1, Math.round((z - T.z0) / T.cell))), k = j * T.nx + i;
      const h = T.H[k], o = (py * this.W + px) * 4; let r, gg, b;
      if (h < SEA) { const dep = Math.min(1, (SEA - h) / 18); r = 70 + (1 - dep) * 70; gg = 160 + (1 - dep) * 60; b = 210 + (1 - dep) * 30; if (SEA - h < 0.9) { r += 40; gg += 25; b += 10; } }
      else { const sh = Math.max(0.55, Math.min(1.25, 0.92 + (hAt(x - 3, z - 3) - hAt(x + 3, z + 3)) * 0.06)); r = Math.min(255, Math.pow(cols[k * 3], 1 / 2.2) * 255 * sh); gg = Math.min(255, Math.pow(cols[k * 3 + 1], 1 / 2.2) * 255 * sh); b = Math.min(255, Math.pow(cols[k * 3 + 2], 1 / 2.2) * 255 * sh); }
      d[o] = r; d[o + 1] = gg; d[o + 2] = b; d[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const P = (x, z) => [(x - BOUNDS.x0) / PX, (z - BOUNDS.z0) / PX];
    // city ground (sidewalk blocks) + streets
    const C = this.island.city; g.fillStyle = '#c9cbcf'; { const [a, b] = P(CITY.ringX[0] - 12, CITY.ringZ[0] - 12), [e, f] = P(CITY.ringX[1] + 12, CITY.ringZ[1] + 12); g.fillRect(a, b, e - a, f - b); }
    g.strokeStyle = '#4a4d55'; g.lineCap = 'butt';
    C.xs.forEach((x, i) => { g.lineWidth = C.xw[i] / PX; g.beginPath(); g.moveTo(...P(x, CITY.ringZ[0])); g.lineTo(...P(x, CITY.ringZ[1])); g.stroke(); });
    C.zs.forEach((z, i) => { g.lineWidth = C.zw[i] / PX; g.beginPath(); g.moveTo(...P(CITY.ringX[0], z)); g.lineTo(...P(CITY.ringX[1], z)); g.stroke(); });
    // roads (real ribbons)
    g.lineJoin = 'round'; g.lineCap = 'round';
    for (const R of this.T.roads) { if (R.city) continue; g.strokeStyle = R.type === 'dirt' ? '#b49468' : R.bridge ? '#e7e2d8' : '#4a4d55'; g.lineWidth = Math.max(1.4, R.w / PX); g.beginPath(); R.pts.forEach((p, i) => i ? g.lineTo(...P(p.x, p.z)) : g.moveTo(...P(p.x, p.z))); g.stroke(); }
    for (const R of this.T.roads) { if (R.city || R.type === 'dirt' || R.type === 'lane') continue; g.strokeStyle = 'rgba(255,220,90,.55)'; g.lineWidth = 0.6; g.beginPath(); R.pts.forEach((p, i) => i ? g.lineTo(...P(p.x, p.z)) : g.moveTo(...P(p.x, p.z))); g.stroke(); }
    // buildings (every footprint) + the pier
    for (const b of this.island.B.list) { if (b.w < 0.5) continue; const [a, c2] = P(b.x - b.w / 2, b.z - b.d / 2); g.fillStyle = b.style === 4 || b.style === 6 && b.h < 6 ? '#e8d6c0' : b.style === 3 ? '#b8c0c8' : b.style === 5 ? '#e4f4ef' : b.style === 0 ? '#9cb6d4' : '#d9d2c6'; g.fillRect(a, c2, b.w / PX, b.d / PX); g.strokeStyle = 'rgba(40,40,55,.75)'; g.lineWidth = 0.6; g.strokeRect(a, c2, b.w / PX, b.d / PX); }
    const pier = POI.find(p => p.id === 'pier'); if (pier && pier.deck) { const D = pier.deck, [a, b2] = P(D.x0, D.z0); g.fillStyle = '#b08454'; g.fillRect(a, b2, (D.x1 - D.x0) / PX, (D.z1 - D.z0) / PX); }
    for (const br of this.island.roads.bridges) { const [a, b2] = P(br.x0, br.z0); g.fillStyle = '#e7e2d8'; g.fillRect(a, b2, (br.x1 - br.x0) / PX, (br.z1 - br.z0) / PX); g.strokeStyle = '#6a7f9a'; g.lineWidth = 0.8; g.strokeRect(a, b2, (br.x1 - br.x0) / PX, (br.z1 - br.z0) / PX); }
    this.P = P; return c;
  }
  regionAt(x, z) { const T = this.T, i = Math.round((x - T.x0) / T.cell), j = Math.round((z - T.z0) / T.cell); if (i < 0 || j < 0 || i >= T.nx || j >= T.nz) return 'OPEN SEA'; const k = j * T.nx + i; if (T.DL[k] < 0) return T.H[k] < SEA - 6 && !(x > -260 && x < -40 && z > 200 && z < 720) ? 'OPEN SEA' : 'WATER'; const r = REGION_IDS[T.RG[k]]; if (Math.abs(x) < 50 && z > -66 && z < 52) return 'OMNITRIX LABS'; return REGIONS[r].name; }
  // ------------------------------------------------------------------------------------------------ per frame
  update(dt) {
    this.t += dt; this.acc = (this.acc || 0) + dt; if (this.acc < 1 / 30) return; this.acc = 0;      // redrawn at 30 Hz (it is a canvas 2D blit)
    const g = this.g, P = g.player, cam = g.camera, ctx = this.cx, S = this.cv.width, R = S / 2;
    const giant = g.chars.id === 'waybig', flyHigh = P.pos.y - Math.max(g.world.terrain.height(P.pos.x, P.pos.z), -0.12) > 30, mPerPx = (giant ? 5.5 : flyHigh ? 2.4 : 1.2) * this.zoom;           // view radius: ~130 m on foot, ~260 m high up, ~600 m as Way Big
    const rot = cam.yaw;                                                                                                                       // camera heading -> up
    ctx.save(); ctx.clearRect(0, 0, S, S); ctx.beginPath(); ctx.arc(R, R, R - 3, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#4aa0d8'; ctx.fillRect(0, 0, S, S);
    ctx.translate(R, R); ctx.rotate(rot); const k = PX / mPerPx; ctx.scale(k, k); const [mx, mz] = this.P(P.pos.x, P.pos.z); ctx.translate(-mx, -mz);
    ctx.imageSmoothingEnabled = true; ctx.drawImage(this.base, 0, 0);
    ctx.restore();
    // bosses
    const toScreen = (x, z) => { const dx = (x - P.pos.x) / mPerPx, dz = (z - P.pos.z) / mPerPx, c = Math.cos(rot), s = Math.sin(rot); return [R + dx * c - dz * s, R + dx * s + dz * c]; };
    for (const b of g.bossList || []) { if (!b.present) continue; const p = b.home || b.pos; let [sx, sy] = toScreen(p.x, p.z); const dd = Math.hypot(sx - R, sy - R), lim = R - 12; let edge = false; if (dd > lim) { sx = R + (sx - R) / dd * lim; sy = R + (sy - R) / dd * lim; edge = true; }
      const pulse = 0.75 + 0.25 * Math.sin(this.t * 6); ctx.fillStyle = b.dead ? '#8a8a8a' : `rgba(255,${edge ? 90 : 50},40,${pulse})`; ctx.strokeStyle = '#1a0000'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sx, sy, edge ? 7 : 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(b.isKevin ? 'K' : b.curId !== undefined ? 'A' : 'V', sx, sy + 0.5); }
    // player arrow (character facing relative to the map)
    const face = (P.yaw ?? 0); ctx.save(); ctx.translate(R, R); ctx.rotate(rot - face + Math.PI); ctx.fillStyle = '#7dff3a'; ctx.strokeStyle = '#0b2a05'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(8, 9); ctx.lineTo(0, 4); ctx.lineTo(-8, 9); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    // rim + north marker
    ctx.lineWidth = 6; ctx.strokeStyle = '#1b2024'; ctx.beginPath(); ctx.arc(R, R, R - 3, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 2; ctx.strokeStyle = '#7dff3a'; ctx.beginPath(); ctx.arc(R, R, R - 6.5, 0, Math.PI * 2); ctx.stroke();
    const [nx, ny] = (() => { const a = rot - Math.PI / 2; return [R + Math.cos(a) * (R - 12), R + Math.sin(a) * (R - 12)]; })();
    ctx.fillStyle = '#1b2024'; ctx.beginPath(); ctx.arc(nx, ny, 9, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('N', nx, ny + 0.5);
    const reg = this.regionAt(P.pos.x, P.pos.z); if (reg !== this.region) { this.region = reg; this.regionEl.textContent = reg; this.regionEl.classList.remove('flash'); void this.regionEl.offsetWidth; this.regionEl.classList.add('flash'); if (this.started && reg !== 'WATER' && reg !== 'OPEN SEA') g.hud.toast(reg); this.started = true; }
    if (this.big) this.drawBig();
  }
  // ------------------------------------------------------------------------------------------------ V31 full-screen world map
  // Drag = pan, wheel / + / - = zoom, C = centre on the player, Tab / Esc = close. Same baked terrain as the minimap. Enemy markers cluster when zoomed out.
  toggleBig(on = !this.big) {
    this.big = on; this.bigEl.hidden = !on;
    if (!this.bv) { this.bv = { cx: 0, cz: 0, mpp: 3.2, drag: null, layers: { boss: 1, train: 1, sea: 1, other: 1, poi: 1, inv: 1 } }; this.bindBig(); }
    if (on) { const P = this.g.player; this.bv.cx = P.pos.x; this.bv.cz = P.pos.z; this.bv.mpp = 3.2; this.resizeBig(); document.exitPointerLock && document.exitPointerLock(); this.drawBig(true); }
  }
  resizeBig() { const cv = this.bigCv, w = Math.round(innerWidth * 0.94), h = Math.round(innerHeight * 0.84); if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; } }
  bindBig() {
    const cv = this.bigCv, v = this.bv; this.bigEl.style.pointerEvents = 'auto';
    const clampV = () => { v.mpp = Math.max(0.6, Math.min(9, v.mpp)); v.cx = Math.max(BOUNDS.x0, Math.min(BOUNDS.x1, v.cx)); v.cz = Math.max(BOUNDS.z0, Math.min(BOUNDS.z1, v.cz)); };
    const zoomAt = (f, mx, my) => { const wx = v.cx + (mx - cv.width / 2) * v.mpp, wz = v.cz + (my - cv.height / 2) * v.mpp; v.mpp *= f; clampV(); v.cx = wx - (mx - cv.width / 2) * v.mpp; v.cz = wz - (my - cv.height / 2) * v.mpp; clampV(); this.drawBig(); };
    const pos = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
    cv.addEventListener('wheel', e => { e.preventDefault(); const [mx, my] = pos(e); zoomAt(e.deltaY > 0 ? 1.18 : 1 / 1.18, mx, my); }, { passive: false });
    cv.addEventListener('pointerdown', e => { v.drag = { x: e.clientX, y: e.clientY, cx: v.cx, cz: v.cz }; cv.setPointerCapture && cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing'; });
    cv.addEventListener('pointermove', e => { if (!v.drag) return; const r = cv.getBoundingClientRect(), k = cv.width / r.width; v.cx = v.drag.cx - (e.clientX - v.drag.x) * k * v.mpp; v.cz = v.drag.cz - (e.clientY - v.drag.y) * k * v.mpp; clampV(); this.drawBig(); });
    const up = () => { v.drag = null; cv.style.cursor = 'grab'; }; cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up); cv.style.cursor = 'grab';
    addEventListener('keydown', e => { if (!this.big) return; if (e.code === 'Equal' || e.code === 'NumpadAdd') zoomAt(1 / 1.3, cv.width / 2, cv.height / 2); else if (e.code === 'Minus' || e.code === 'NumpadSubtract') zoomAt(1.3, cv.width / 2, cv.height / 2); else if (e.code === 'KeyC') { const P = this.g.player; v.cx = P.pos.x; v.cz = P.pos.z; this.drawBig(); } else if (e.code === 'Escape') this.toggleBig(false); });
    this.bigEl.querySelector('.bm-legend').addEventListener('click', e => { const k = e.target.closest('[data-l]'); if (!k) return; const l = k.dataset.l; if (l === 'zin') zoomAt(1 / 1.3, cv.width / 2, cv.height / 2); else if (l === 'zout') zoomAt(1.3, cv.width / 2, cv.height / 2); else if (l === 'ctr') { const P = this.g.player; v.cx = P.pos.x; v.cz = P.pos.z; this.drawBig(); } else { v.layers[l] = v.layers[l] ? 0 : 1; k.classList.toggle('off', !v.layers[l]); this.drawBig(); } });
  }
  // every live / known hostile as {x,z,kind,label}
  enemyList() {
    const g = this.g, o = [], L = this.bv.layers;
    if (L.boss) for (const b of g.bossList || []) { if (!b.present) continue; const p = b.home || b.pos; o.push({ x: p.x, z: p.z, kind: 'boss', label: b.isKevin ? 'K' : b.curId !== undefined ? 'A' : 'V', dead: b.dead }); }
    if (L.train && g.trainBots) { for (const s of g.trainBots.sites) o.push({ x: s.x, z: s.z, kind: 'train', label: 'T', site: true }); for (const b of g.trainBots.list) if (!b.parked && !b.dead) o.push({ x: b.pos ? b.pos.x : b.home.x, z: b.pos ? b.pos.z : b.home.z, kind: 'train', label: 'T', live: true }); }
    if (L.sea && g.seaBots) for (const b of g.seaBots.list) if (!b.parked && !b.dead) o.push({ x: b.pos.x, z: b.pos.z, kind: 'sea', label: '≈' });
    if (L.other && g.enemies) for (const t of g.enemies.turrets) { const p = t.pos || (t.root && t.root.position); if (p && !t.dead) o.push({ x: p.x, z: p.z, kind: 'other', label: '!' }); }
    if (L.inv && g.invasion) for (const m of g.invasion.markers()) o.push(m);
    return o;
  }
  drawBig(full = false) {
    this.resizeBig(); const cv = this.bigCv, v = this.bv, g = cv.getContext('2d'), W = cv.width, H = cv.height, P = this.g.player;
    const k = PX / v.mpp, sx = wx => (wx - v.cx) / v.mpp + W / 2, sy = wz => (wz - v.cz) / v.mpp + H / 2;
    g.fillStyle = '#2f7fb8'; g.fillRect(0, 0, W, H);
    g.save(); g.imageSmoothingEnabled = true; g.translate(W / 2, H / 2); g.scale(k, k); const [bx, bz] = this.P(v.cx, v.cz); g.translate(-bx, -bz); g.drawImage(this.base, 0, 0); g.restore();
    // grid every 200 m
    g.strokeStyle = 'rgba(255,255,255,.10)'; g.lineWidth = 1; g.beginPath(); for (let x = Math.ceil(BOUNDS.x0 / 200) * 200; x < BOUNDS.x1; x += 200) { g.moveTo(sx(x), 0); g.lineTo(sx(x), H); } for (let z = Math.ceil(BOUNDS.z0 / 200) * 200; z < BOUNDS.z1; z += 200) { g.moveTo(0, sy(z)); g.lineTo(W, sy(z)); } g.stroke();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const pill = (txt, x, y, font, bg, fg) => { g.font = font; const w = g.measureText(txt).width + 12; g.fillStyle = bg; g.beginPath(); g.roundRect ? g.roundRect(x - w / 2, y - 10, w, 20, 6) : g.rect(x - w / 2, y - 10, w, 20); g.fill(); g.fillStyle = fg; g.fillText(txt, x, y + 1); };
    // region labels (always), landmark labels when zoomed in
    const reg = [['MAIN CITY', -246, -110], ['OMNITRIX LABS', 0, 70], ['SUBURBS', -560, 520], ['FOREST', -800, -280], ['MOUNTAINS', -300, -560], ['DESERT', 470, 230], ['BEACH', 220, 470], ['INDUSTRIAL AREA', 420, -420]];
    for (const [n, x, z] of reg) pill(n, sx(x), sy(z), 'bold 13px sans-serif', 'rgba(12,18,24,.8)', '#fff');
    if (v.layers.poi) for (const p of POI) { const x = sx(p.x), y = sy(p.z); if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue; g.fillStyle = '#ffd23a'; g.strokeStyle = '#3a2a00'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); g.stroke(); if (v.mpp < 2.6) pill(p.name, x, y - 16, '600 11px sans-serif', 'rgba(40,30,0,.78)', '#ffe9a0'); }
    // enemy markers, clustered on a screen grid
    const list = this.enemyList(), cell = v.mpp > 4.2 ? 46 : v.mpp > 2.2 ? 28 : 0, col = { boss: '#ff3a2a', train: '#ff9a2a', sea: '#2ad0ff', other: '#c46aff', drone: '#ff5a4a', robot: '#d8402f', heavy: '#a8201f', giant: '#7a0f14', loc: '#ffb020' };
    const draw1 = (e, x, y) => { const pulse = e.kind === 'boss' ? 0.8 + 0.2 * Math.sin(this.t * 6) : 1; g.globalAlpha = e.site && !e.live ? 0.55 : pulse; g.fillStyle = e.dead ? '#888' : col[e.kind]; g.strokeStyle = '#150a0a'; g.lineWidth = 2; g.beginPath(); if (e.kind === 'train') g.rect(x - 6, y - 6, 12, 12); else if (e.kind === 'sea') { g.moveTo(x, y - 8); g.lineTo(x + 7, y); g.lineTo(x, y + 8); g.lineTo(x - 7, y); g.closePath(); } else g.arc(x, y, e.kind === 'boss' ? 9 : e.kind === 'giant' ? 9 : e.kind === 'heavy' ? 7.5 : e.kind === 'drone' ? 4.5 : 6, 0, 7); g.fill(); g.stroke(); g.globalAlpha = 1; g.fillStyle = '#fff'; g.font = 'bold 10px sans-serif'; g.fillText(e.label, x, y + 1); };
    if (!cell) for (const e of list) draw1(e, sx(e.x), sy(e.z));
    else { const cl = new Map(); for (const e of list) { const x = sx(e.x), y = sy(e.z), key = e.kind + ':' + Math.floor(x / cell) + ',' + Math.floor(y / cell); let c = cl.get(key); if (!c) cl.set(key, c = { n: 0, x: 0, y: 0, e }); c.n++; c.x += x; c.y += y; } for (const c of cl.values()) { const x = c.x / c.n, y = c.y / c.n; if (c.n === 1) draw1(c.e, x, y); else { g.fillStyle = col[c.e.kind]; g.strokeStyle = '#150a0a'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 11, 0, 7); g.fill(); g.stroke(); g.fillStyle = '#fff'; g.font = 'bold 12px sans-serif'; g.fillText(String(c.n), x, y + 1); } } }
    // the ship (if it is flying) and the player
    const sh = this.g.mothership; if (sh && sh.loaded && sh.pos) { const x = sx(sh.pos.x), y = sy(sh.pos.z); if (x > -40 && y > -40 && x < W + 40 && y < H + 40) { g.fillStyle = 'rgba(190,200,255,.9)'; g.strokeStyle = '#223'; g.lineWidth = 2; g.beginPath(); g.ellipse(x, y, 14, 6, 0, 0, 7); g.fill(); g.stroke(); } }
    const px = sx(P.pos.x), py = sy(P.pos.z); g.save(); g.translate(px, py); g.rotate(-(P.yaw ?? 0) + Math.PI); g.fillStyle = '#7dff3a'; g.strokeStyle = '#0b2a05'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(0, -13); g.lineTo(10, 11); g.lineTo(0, 5); g.lineTo(-10, 11); g.closePath(); g.fill(); g.stroke(); g.restore();
    // north arrow + scale bar
    g.fillStyle = 'rgba(12,18,24,.8)'; g.beginPath(); g.arc(W - 34, 34, 18, 0, 7); g.fill(); g.fillStyle = '#fff'; g.font = 'bold 13px sans-serif'; g.fillText('N', W - 34, 35); g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(W - 34, 14); g.lineTo(W - 34, 20); g.stroke();
    const bar = v.mpp > 3 ? 500 : v.mpp > 1.5 ? 200 : 100, bw = bar / v.mpp; g.fillStyle = 'rgba(12,18,24,.8)'; g.fillRect(14, H - 38, bw + 20, 26); g.fillStyle = '#fff'; g.fillRect(24, H - 22, bw, 3); g.font = '11px sans-serif'; g.textAlign = 'left'; g.fillText(bar + ' m', 24, H - 29); g.textAlign = 'center';
  }
}
