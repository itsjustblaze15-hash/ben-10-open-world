// V30 DESTRUCTIBLE + REGENERATING BUILDINGS. Every island building keeps its exact design (the same instanced facade); damage only changes how it is drawn and how tall it is:
//   stage 0 intact · 1 (<75% hp) soot + cracks + a few blown windows · 2 (<50%) breaches, many windows gone · 3 (<25%) the upper part has fallen in (lower, charred roof) · 4 destroyed: a rubble pile, no collider.
// Every building is registered as a PropSystem "wall" (entry.wall), so everything that already hurts walls - punches, slams, ground pounds, fireballs, Cannonbolt, Way Big's fists / stomps,
// Kevin / Vilgax strikes, thrown props, launched bodies - damages buildings through PropSystem.damageWall without any per-alien code. Damage grows with the strength of the hit; weak hits (< DCFG.min) do nothing.
// A destroyed building rebuilds itself after DCFG.regenMin..regenMax seconds - never while the player is near, nor with anything standing in its footprint - rising out of the ground with dust, staggered
// V31 STRUCTURAL SUPPORT: tiers that sit on other tiers (a tower stack: base / shaft / crown) know which sections carry them. When a supporting section falls in or is destroyed the sections above lose
// their support, drop under gravity, land on what is left (or the ground), shake the street and crumble to rubble - a chain reaction instead of floating floors; nothing else collapses. A tier only rebuilds once everything under it stands again.
// (at most one rebuild starts every 1.5 s), restoring the original instance, collider and rooftop details. Debris comes from the shared pooled DebrisSystem (no per-piece meshes).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, rand } from '../util.js';
import { toon } from './style.js';

export const DCFG = { regenMin: 180, regenMax: 300, min: 6, enabled: true, safePlayer: 32, safeOther: 10, maxRubble: 160 };
const HP = [520, 640, 900, 1200, 340, 2400, 280];            // by BSTYLE: tower is index 0 -> see below (indexed by style id)
const STYLE_HP = { 0: 1500, 1: 800, 2: 520, 3: 900, 4: 300, 5: 2400, 6: 260 };
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler(), _c = new THREE.Color(), _v = new THREE.Vector3();
void HP;
export class Destruct {
  constructor(game, island) {
    this.g = game; this.world = game.world; this.B = island.B; this.D = island.D; this.im = this.B.mesh; this.list = this.B.list; const n = this.list.length;
    const q = new URLSearchParams(location.search); if (q.get('regen')) { const [a, b] = q.get('regen').split(',').map(Number); if (a > 0) { DCFG.regenMin = a; DCFG.regenMax = b > a ? b : a; } } if (q.get('nodestruct')) DCFG.enabled = false;
    this.dmgAttr = new THREE.InstancedBufferAttribute(new Float32Array(n), 1); this.im.geometry.setAttribute('aDmg', this.dmgAttr);
    this.active = []; this.pending = []; this.regenCd = 0; this.t = 0; this.stats = { destroyed: 0, regenerated: 0, damaged: 0 }; this.rubbleFree = [];
    this.buildRubble(); this.register(island);
  }
  // ------------------------------------------------------------------------------------------------ setup
  register(island) {
    const P = this.g.props, STUB = { visible: true, material: { color: { setScalar() { } } } };
    this.list.forEach((b, i) => {
      if (!b.col) return; const hp = (STYLE_HP[b.style] ?? 500) * (0.7 + 0.3 * clamp(b.h / 20, 0.5, 2.2)) * (b.name && /LAB|OMNITRIX/i.test(b.name) ? 1.4 : 1);
      b.i = i; b.dm = { hp, hpMax: hp, stage: 0, k: 1, kT: 1, state: 'ok', timer: 0, roof: [], dust: 0 };
      const w = { entry: b.col, hp, hpMax: hp, name: b.name || 'BUILDING', alive: true, mesh: STUB, mat0: null, stage: 0, isBld: true, b }; b.col.wall = w; b.dm.wall = w; P.walls.push(w);
    });
    // structural support graph: A rests on B when A's base meets B's roof and their footprints overlap
    const el = this.list.filter(b => b.dm), fp = (b) => { const rot = Math.abs(Math.sin(b.yaw)) > 0.5; return [b.x - (rot ? b.d : b.w) / 2, b.x + (rot ? b.d : b.w) / 2, b.z - (rot ? b.w : b.d) / 2, b.z + (rot ? b.w : b.d) / 2]; };
    for (const b of el) { b.dm.supports = []; b.dm.deps = []; b.dm.yOff = 0; }
    for (const b of el) { const fb = fp(b); for (const s of el) { if (s === b || Math.abs(s.y0 + s.h - b.y0) > 1.0 || s.h < 1) continue; const fs = fp(s), ox = Math.min(fb[1], fs[1]) - Math.max(fb[0], fs[0]), oz = Math.min(fb[3], fs[3]) - Math.max(fb[2], fs[2]); if (ox <= 0.5 || oz <= 0.5) continue; if (ox * oz < 0.2 * Math.min((fb[1] - fb[0]) * (fb[3] - fb[2]), (fs[1] - fs[0]) * (fs[3] - fs[2]))) continue; b.dm.supports.push(s); s.dm.deps.push(b); } }
    this.supportStats = { tiers: el.filter(b => b.dm.supports.length).length, supported: el.filter(b => b.dm.deps.length).length };
    this.drops = [];
    // rooftop details (AC units, tanks, antennas) belong to their building: they go with it
    if (this.D) for (const L of this.D.items.values()) { if (!/^(acUnit|waterTank|antenna|roof|dome|dish|chimney)$/.test(L.name) || !L.im) continue;
      L.list.forEach((it, k) => { for (const b of this.list) { if (!b.dm) continue; if (Math.abs(it.x - b.x) < b.w / 2 + 0.5 && Math.abs(it.z - b.z) < b.d / 2 + 0.5 && Math.abs(it.y - (b.y0 + b.h)) < 1.2) { b.dm.roof.push({ im: L.im, k }); break; } } }); }
  }
  buildRubble() {
    const parts = [], r = (a, b) => a + Math.random() * (b - a); let seed = 7; const rn = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let k = 0; k < 16; k++) { const g = new THREE.BoxGeometry(0.18 + rn() * 0.3, 0.1 + rn() * 0.25, 0.18 + rn() * 0.3).toNonIndexed(); const a = rn() * 6.28, d = Math.sqrt(rn()) * 0.48, h = (1 - d * 2) * 0.5 * rn() + 0.05;
      g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * d, h, Math.sin(a) * d), new THREE.Quaternion().setFromEuler(new THREE.Euler(rn() * 0.8, rn() * 6, rn() * 0.8)), new THREE.Vector3(1, 1, 1))); g.deleteAttribute('uv'); parts.push(g); }
    void r; const geo = mergeGeometries(parts, false); geo.computeVertexNormals();
    this.rubble = new THREE.InstancedMesh(geo, toon(0xffffff), DCFG.maxRubble); this.rubble.count = 0; this.rubble.castShadow = true; this.rubble.receiveShadow = true; this.rubble.frustumCulled = false; this.rubble.name = 'BuildingRubble'; this.world.scene.add(this.rubble);
    this.rubbleUsed = new Array(DCFG.maxRubble).fill(null);
  }
  setRegen(min, max) { DCFG.regenMin = Math.max(5, min); DCFG.regenMax = Math.max(DCFG.regenMin, max ?? min); }
  // ------------------------------------------------------------------------------------------------ damage
  damage(w, dmg, pt, dir) {
    const b = w.b, d = b.dm; if (!DCFG.enabled || !d || d.state !== 'ok' && d.state !== 'hurt' || dmg < DCFG.min) return;
    const g = this.g, P = g.props; d.hp = Math.max(0, d.hp - dmg); w.hp = d.hp; this.stats.damaged++;
    const at = pt ? _v.copy(pt) : _v.set(b.x, b.y0 + Math.min(b.h, 4), b.z); at.x = clamp(at.x, b.x - b.w / 2, b.x + b.w / 2); at.z = clamp(at.z, b.z - b.d / 2, b.z + b.d / 2); at.y = clamp(at.y, b.y0 + 1, b.y0 + b.h * d.k);
    const col = _c.set(b.color).getHex(), big = clamp(dmg / 120, 0.3, 2.5);
    P.debris.burst(at, Math.round(4 + 8 * big), 4 + 3 * big, 0.2 + 0.1 * big, col); g.fx.dust.emit({ pos: at.clone(), vel: new THREE.Vector3(rand(-1, 1), rand(0, 1), rand(-1, 1)), size: 1.4 + big, grow: 2, life: 0.8, drag: 2, color: [0.7, 0.68, 0.64], alpha: 0.55 });
    const r = d.hp / d.hpMax, stage = r <= 0 ? 4 : r < 0.25 ? 3 : r < 0.5 ? 2 : r < 0.75 ? 1 : 0, prev = d.stage;
    this.dmgAttr.array[b.i] = clamp((1 - r) * 4, 0, 4); this.dmgAttr.needsUpdate = true; d.state = 'hurt';
    if (stage > prev) { d.stage = stage; w.stage = Math.min(stage, 3); g.sfx.crash && g.sfx.crash(0.25 + 0.15 * stage); g.camera.addTrauma(clamp(0.5 - Math.hypot(b.x - g.player.pos.x, b.z - g.player.pos.z) / 150, 0, 0.5) * (0.4 + 0.2 * stage));
      P.debris.burst(at, 10 + 8 * stage, 7 + 2 * stage, 0.35, col); this.world.danger && this.world.danger(b.x, b.z, 30 + 8 * stage, 1);
      if (stage === 3) this.startFall(b, 0.62); else if (stage === 4) this.destroy(b); }
  }
  startFall(b, k) { const d = b.dm; d.kT = k; if (!this.active.includes(b)) this.active.push(b); d.anim = 'fall'; this.hideRoof(b, true); this.cascade(b); }
  destroy(b) {
    const d = b.dm; d.kT = 0; d.state = 'dying'; d.anim = 'fall'; d.wall.alive = false; this.cascade(b); if (!this.active.includes(b)) this.active.push(b); this.hideRoof(b, true); this.stats.destroyed++; this.g.sfx.boom && this.g.sfx.boom(0.5);
  }
  /** everything that rests on b loses its support: it will drop (small delay, then gravity) */
  cascade(b) {
    for (const u of b.dm.deps) { const d = u.dm; if (d.state !== 'ok' && d.state !== 'hurt') continue; d.state = 'drop'; d.vy = 0; d.dropT = rand(0.25, 0.7); d.wall.alive = false; this.hideRoof(u, true); u.col.off = true; const i = this.world.boxes.indexOf(u.col); if (i >= 0) this.world.boxes.splice(i, 1);
      this.drops.push(u); this.stats.cascaded = (this.stats.cascaded || 0) + 1; this.g.sfx.crash && this.g.sfx.crash(0.3); this.cascade(u); }
  }
  /** top of whatever now carries u (a surviving / half-fallen support or the ground) */
  baseFor(u) { let y = -1e9; for (const s of u.dm.supports) { if (s.dm.state === 'ruin' || s.dm.state === 'dying' || s.dm.state === 'drop') continue; y = Math.max(y, s.y0 + (s.dm.yOff || 0) + s.h * s.dm.k); }
    const T = this.world.terrain, w = u.w / 2, dd = u.d / 2; for (const [ox, oz] of [[0, 0], [-w, -dd], [w, -dd], [-w, dd], [w, dd]]) y = Math.max(y, T.height(u.x + ox * 0.8, u.z + oz * 0.8)); return y; }
  hideRoof(b, hide) { for (const r of b.dm.roof) { r.im.getMatrixAt(r.k, _m); if (hide) { if (!r.m0) r.m0 = _m.clone(); _m.makeScale(0, 0, 0).setPosition(_v.set(b.x, b.y0, b.z)); r.im.setMatrixAt(r.k, _m); } else if (r.m0) r.im.setMatrixAt(r.k, r.m0); r.im.instanceMatrix.needsUpdate = true; } }
  // ------------------------------------------------------------------------------------------------ per frame
  setInstance(b, k) {
    const rot = Math.abs(Math.sin(b.yaw)) > 0.5; _p.set(b.x, b.y0 + (b.dm.yOff || 0), b.z); _q.setFromEuler(_e.set(0, b.yaw, 0)); _s.set(rot ? b.d : b.w, Math.max(0.02, b.h * k), rot ? b.w : b.d); this.im.setMatrixAt(b.i, _m.compose(_p, _q, _s)); this.im.instanceMatrix.needsUpdate = true;
    if (b.col) b.col.max.y = b.y0 + (b.dm.yOff || 0) + b.h * k;
  }
  update(dt) {
    if (!DCFG.enabled || dt <= 0) return; this.t += dt; const g = this.g, P = g.props;
    for (let n = this.active.length - 1; n >= 0; n--) {
      const b = this.active[n], d = b.dm, up = d.anim === 'rise', sp = up ? 1 / 5 : (d.kT === 0 ? 1 / 2.4 : 1 / 1.6), dk = d.kT - d.k;
      d.k += Math.sign(dk) * Math.min(Math.abs(dk), sp * dt * (up ? 1 : Math.max(0.35, 1.2 * Math.abs(dk) + 0.3)));
      this.setInstance(b, d.k); d.dust -= dt; if (d.dust <= 0) { d.dust = up ? 0.2 : 0.1; const top = b.y0 + b.h * d.k, a = rand(0, 6.28), rx = rand(0.2, 0.5) * b.w, rz = rand(0.2, 0.5) * b.d;
        _v.set(b.x + Math.cos(a) * rx, up ? b.y0 + 1 : top, b.z + Math.sin(a) * rz); g.fx.dust.emit({ pos: _v.clone(), vel: new THREE.Vector3(rand(-2, 2), rand(0.5, 3), rand(-2, 2)), size: rand(2, 4), grow: 2.4, life: 1.4, drag: 1.6, color: [0.7, 0.68, 0.64], alpha: 0.5 });
        if (!up) P.debris.burst(_v, 6, 5, 0.4, _c.set(b.color).getHex()); }
      if (Math.abs(d.kT - d.k) < 0.003) {
        d.k = d.kT; d.anim = null; this.active.splice(n, 1); this.setInstance(b, d.k);
        if (d.kT === 0) this.ruin(b); else if (up) { d.state = 'ok'; d.stage = 0; d.hp = d.hpMax; d.wall.hp = d.hpMax; d.wall.alive = true; d.wall.stage = 0; this.dmgAttr.array[b.i] = 0; this.dmgAttr.needsUpdate = true; this.hideRoof(b, false); this.stats.regenerated++; g.sfx.thud && g.sfx.thud(0.6); }
      }
    }
    // dropping sections (lost their support): gravity, landing, crumble
    for (let n = this.drops.length - 1; n >= 0; n--) {
      const b = this.drops[n], d = b.dm; if (d.dropT > 0) { d.dropT -= dt; if (Math.random() < dt * 14) g.fx.dust.emit({ pos: _v.set(b.x + rand(-b.w / 2, b.w / 2), b.y0, b.z + rand(-b.d / 2, b.d / 2)).clone(), vel: new THREE.Vector3(rand(-1, 1), rand(-1, 0), rand(-1, 1)), size: rand(1.5, 3), grow: 2, life: 1, drag: 1.5, color: [0.7, 0.68, 0.64], alpha: 0.45 }); continue; }
      d.vy -= 24 * dt; d.yOff += d.vy * dt; this.setInstance(b, d.k); const base = this.baseFor(b);
      if (b.y0 + d.yOff <= base) {
        d.yOff = base - b.y0; this.setInstance(b, d.k); this.drops.splice(n, 1); const cy = base + 0.5, hit = Math.min(1.6, 0.4 + b.h / 40);
        P.debris.burst(_v.set(b.x, cy, b.z), 18, 8 + 5 * hit, 0.45, _c.set(b.color).getHex()); P.shockwave && P.shockwave(_v.set(b.x, cy, b.z), 5 + b.w * 0.4, 8 + 10 * hit, 0, 0);
        g.camera.addTrauma(clamp(0.6 - Math.hypot(b.x - g.player.pos.x, b.z - g.player.pos.z) / 160, 0, 0.5)); g.sfx.boom && g.sfx.boom(0.5); this.world.danger && this.world.danger(b.x, b.z, 35, 1);
        d.state = 'dying'; d.kT = 0; d.anim = 'fall'; if (!this.active.includes(b)) this.active.push(b);
      }
    }
    // regeneration queue (staggered, only when it is safe)
    this.regenCd -= dt; if (this.regenCd <= 0 && this.pending.length) {
      this.regenCd = 1.5; for (let i = 0; i < this.pending.length; i++) { const b = this.pending[i], d = b.dm; if (this.t < d.timer) continue; if (!this.safe(b)) { d.timer = this.t + 6; continue; } this.pending.splice(i, 1); this.regen(b); break; }
    }
  }
  ruin(b) {
    const d = b.dm; d.state = 'ruin'; d.timer = this.t + rand(DCFG.regenMin, DCFG.regenMax); this.pending.push(b); b.col.off = true; const bx = this.world.boxes, i = bx.indexOf(b.col); if (i >= 0) bx.splice(i, 1);
    this.im.setMatrixAt(b.i, _m.makeScale(0, 0, 0)); this.im.instanceMatrix.needsUpdate = true;
    let slot = this.rubbleUsed.indexOf(null); if (slot < 0) slot = 0; this.rubbleUsed[slot] = b; d.slot = slot; const rot = Math.abs(Math.sin(b.yaw)) > 0.5, T = this.world.terrain; let y = b.y0 + (d.yOff || 0); for (const [ox, oz] of [[0, 0], [-.4, -.4], [.4, -.4], [-.4, .4], [.4, .4]]) y = Math.max(y, T.height(b.x + ox * b.w, b.z + oz * b.d));
    _p.set(b.x, y - 0.15, b.z); _q.setFromEuler(_e.set(0, rand(0, 6.28), 0)); _s.set((rot ? b.d : b.w) * 0.96, clamp(b.h * 0.16, 2.2, 6), (rot ? b.w : b.d) * 0.96); this.rubble.setMatrixAt(slot, _m.compose(_p, _q, _s)); this.rubble.setColorAt(slot, _c.set(b.color).multiplyScalar(0.55));
    this.rubble.count = Math.max(this.rubble.count, slot + 1); this.rubble.instanceMatrix.needsUpdate = true; if (this.rubble.instanceColor) this.rubble.instanceColor.needsUpdate = true;
  }
  safe(b) {
    if (this.holdFn && this.holdFn(b)) return false;                                      // V32: no rebuilding while the area is under bombardment
    if (this.g.invasion && this.g.invasion.blocksRegen(b)) return false;                       // ... or while an invasion robot stands in the footprint
    if (b.dm.supports && b.dm.supports.some(sp => sp.dm.state !== 'ok')) return false;      // V31: a tier only rebuilds once everything under it stands again
    const g = this.g, P = g.player, m = DCFG.safeOther, mp = DCFG.safePlayer, x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2;
    const near = (x, z, r) => x > x0 - r && x < x1 + r && z > z0 - r && z < z1 + r;
    if (near(P.pos.x, P.pos.z, mp)) return false; if (g.camera && g.camera.camera && near(g.camera.camera.position.x, g.camera.camera.position.z, 10)) return false;
    for (const o of g.bossList || []) if (o.present && !o.dead) { const q = o.home || o.pos; if (q && near(q.x, q.z, m + 4)) return false; }
    if (g.civ) for (const c of g.civ.list) if (near(c.x, c.z, m)) return false;
    if (g.traffic) for (const c of g.traffic.cars) if (near(c.pos.x, c.pos.z, m)) return false;
    for (const p of g.props.props) if (!p.dead && !p.dormant && near(p.pos.x, p.pos.z, 0.6) && p.pos.y > b.y0 - 1) return false;
    if (g.trainBots) for (const r of g.trainBots.list) if (!r.dead && near(r.root.position.x, r.root.position.z, m)) return false;
    return true;
  }
  regen(b) {
    const d = b.dm; d.yOff = 0; if (d.slot !== undefined) { this.rubbleUsed[d.slot] = null; this.rubble.setMatrixAt(d.slot, _m.makeScale(0, 0, 0)); this.rubble.instanceMatrix.needsUpdate = true; d.slot = undefined; }
    b.col.off = false; this.world.boxes.push(b.col); d.state = 'rising'; d.k = 0.02; d.kT = 1; d.anim = 'rise'; this.dmgAttr.array[b.i] = 0; this.dmgAttr.needsUpdate = true; this.setInstance(b, d.k); this.active.push(b); this.g.sfx.thud && this.g.sfx.thud(0.4);
  }
  /** instantly repair everything (debug / reset) */
  repairAll() { for (const b of this.list) { const d = b.dm; if (!d || d.state === 'ok' && d.stage === 0) continue; if (d.slot !== undefined) { this.rubbleUsed[d.slot] = null; this.rubble.setMatrixAt(d.slot, _m.makeScale(0, 0, 0)); d.slot = undefined; } b.col.off = false; if (!this.world.boxes.includes(b.col)) this.world.boxes.push(b.col); d.k = d.kT = 1; d.yOff = 0; d.hp = d.hpMax; d.state = 'ok'; d.stage = 0; d.anim = null; d.wall.alive = true; d.wall.hp = d.hpMax; this.dmgAttr.array[b.i] = 0; this.setInstance(b, 1); this.hideRoof(b, false); } this.active.length = 0; this.pending.length = 0; this.drops.length = 0; this.dmgAttr.needsUpdate = true; this.rubble.instanceMatrix.needsUpdate = true; }
}
