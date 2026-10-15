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
    const big = document.createElement('div'); big.id = 'bigmap'; big.hidden = true; big.innerHTML = '<canvas></canvas><div class="bm-title">BEN 10 · OPEN WORLD</div><div class="bm-help">TAB — CLOSE MAP</div>'; document.body.appendChild(big); this.bigEl = big; this.bigCv = big.querySelector('canvas');
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
  toggleBig(on = !this.big) { this.big = on; this.bigEl.hidden = !on; if (on) this.drawBig(true); }
  drawBig(full = false) {
    const cv = this.bigCv, s = Math.min(innerWidth * 0.9, innerHeight * 0.86) / Math.max(this.W, this.H); if (full || cv.width !== Math.round(this.W * s)) { cv.width = Math.round(this.W * s); cv.height = Math.round(this.H * s); }
    const g = cv.getContext('2d'); g.drawImage(this.base, 0, 0, cv.width, cv.height);
    g.font = 'bold 13px sans-serif'; g.textAlign = 'center'; const done = new Set();
    const label = (name, x, z) => { if (done.has(name)) return; done.add(name); const [px, py] = this.P(x, z); g.fillStyle = 'rgba(15,20,26,.78)'; const w = g.measureText(name).width + 14; g.fillRect(px * s - w / 2, py * s - 11, w, 20); g.fillStyle = '#fff'; g.fillText(name, px * s, py * s + 4); };
    label('MAIN CITY', -246, -110); label('OMNITRIX LABS', 0, 70); label('SUBURB', -560, 520); label('FOREST', -800, -280); label('MOUNTAINS', -300, -560); label('DESERT', 470, 230); label('BEACH', 220, 470); label('INDUSTRIAL AREA', 420, -420);
    for (const p of POI) { const [px, py] = this.P(p.x, p.z); g.fillStyle = '#ffd23a'; g.beginPath(); g.arc(px * s, py * s, 3, 0, 7); g.fill(); }
    const P = this.g.player, [px, py] = this.P(P.pos.x, P.pos.z); g.save(); g.translate(px * s, py * s); g.rotate(-(P.yaw ?? 0) + Math.PI); g.fillStyle = '#7dff3a'; g.strokeStyle = '#0b2a05'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, -12); g.lineTo(9, 10); g.lineTo(0, 5); g.lineTo(-9, 10); g.closePath(); g.fill(); g.stroke(); g.restore();
    for (const b of this.g.bossList || []) { if (!b.present) continue; const p = b.home || b.pos, [bx, by] = this.P(p.x, p.z); g.fillStyle = '#ff3a2a'; g.beginPath(); g.arc(bx * s, by * s, 7, 0, 7); g.fill(); g.fillStyle = '#fff'; g.fillText(b.isKevin ? 'K' : b.curId !== undefined ? 'A' : 'V', bx * s, by * s + 4); }
  }
}
