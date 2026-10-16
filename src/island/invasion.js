// V32 VILGAX INVASION - the state machine that sits on top of the V31 mothership.
//   APPROACHING (world days 0-10)  ->  ARRIVING (ship stops above Main City, engines settle)  ->  INVASION_ACTIVE (robots deploy, missiles fall, fires; ~1 world day)
//   ->  VILGAX_DESCENDING (world day 11: a beam opens under the ship, the EXISTING Vilgax descends through it)  ->  VILGAX_ACTIVE (he hunts the player with his personal escort).
// Each transition fires once and only forwards. Milestones read the WORLD clock (DayNight.elapsed, so the 0.5x-100x time speeds move them); every gameplay interval (waves, missile cadence, AI) runs on gameplay time,
// so 100x never floods the map. State persists in localStorage (landed / dismissed) so a reload never replays the approach, the beam or a second Vilgax.
// Also here: the ship's soft ground shadow + a local light dimming under it (not map-wide), civilian panic hooks, the HUD status pill and the map markers.
import * as THREE from 'three';
import { clamp, rand, smoothstep } from '../util.js';
import { InvasionForce } from '../invasion_robots.js';
import { MissileSystem } from '../missiles.js';

export const IS = { APPROACHING: 'APPROACHING', ARRIVING: 'ARRIVING', INVASION_ACTIVE: 'INVASION_ACTIVE', VILGAX_DESCENDING: 'VILGAX_DESCENDING', VILGAX_ACTIVE: 'VILGAX_ACTIVE', VILGAX_RETREATING: 'VILGAX_RETREATING', VILGAX_ABOARD: 'VILGAX_ABOARD', MOTHERSHIP_GRABBED: 'MOTHERSHIP_GRABBED', MOTHERSHIP_THROWN: 'MOTHERSHIP_THROWN', MOTHERSHIP_CRASHED: 'MOTHERSHIP_CRASHED', INVASION_DEFEATED: 'INVASION_DEFEATED' };
export const IV = { retreatHp: 300, arriveDay: 10, vilgaxDay: 11, arriveT: 4, descendT: 9, descendH: 95, key: 'ben10.invasion.v32', centre: { x: -278, z: -22 }, landing: [[-278, -22], [-214, -22], [-342, -22], [-278, 42], [-278, -86]] };
const _a = new THREE.Vector3(), _b = new THREE.Vector3();

export class Invasion {
  constructor(game) {
    this.g = game; this.ship = game.mothership; this.force = new InvasionForce(game); this.missiles = new MissileSystem(game); this.state = IS.APPROACHING; this.t = 0; this.stT = 0; this.landed = false; this.dismissed = false; this.aboard = false; this.defeated = false; this.retreatT = 0; this.vGuard = false;
    this.stats = { dronesDown: 0, robotsDown: 0, civHit: 0, transitions: [], vilgaxSpawns: 0 }; this.fireT = 0; this.huntT = 0; this.landPt = null; this.beamA = 0; this.pillT = 0; this.shadowK = 0; this.vSpawned = false; this.sunBase = null;
    try { const s = new URLSearchParams(location.search).get('ship') === 'reset' ? null : JSON.parse(localStorage.getItem(IV.key) || 'null'); if (s) { this.landed = !!s.landed; this.dismissed = !!s.dismissed; this.aboard = !!s.aboard; this.defeated = !!s.defeated; } } catch { /* ignore */ }
    if (this.defeated) this.state = IS.INVASION_DEFEATED; else if (this.aboard) this.state = IS.VILGAX_ABOARD;
    this.buildVisuals(); this.buildHud();
  }
  save() { try { localStorage.setItem(IV.key, JSON.stringify({ landed: this.landed, dismissed: this.dismissed, aboard: this.aboard, defeated: this.defeated })); } catch { /* ignore */ } }
  reset() {                                                                  // "restart the journey" button / ?ship=reset
    this.landed = false; this.dismissed = false; this.aboard = false; this.defeated = false; this.retreatT = 0; this.save(); if (this.g.finale) this.g.finale.reset(); this.force.clear(); this.missiles.clear(); this.state = IS.APPROACHING; this.stT = 0; this.beamA = 0; this.beam.visible = false; this.landPt = null; this.vSpawned = false;
    const v = this.g.vilgax; if (v && v.present && this.invVilgax) { this.invVilgax = false; try { v.bossDespawn(); this.g.bosses.updateUI(); } catch { /* ignore */ } }
  }
  // ---------------------------------------------------------------------------------------------------- visuals
  buildVisuals() {
    const g = this.g, c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'), gr = x.createRadialGradient(64, 64, 8, 64, 64, 62); gr.addColorStop(0, 'rgba(0,0,0,0.85)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    this.shadowM = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, opacity: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: false });
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.shadowM); this.shadow.rotation.x = -Math.PI / 2; this.shadow.renderOrder = 2; this.shadow.visible = false; this.shadow.frustumCulled = false; g.scene.add(this.shadow);
    const bg = new THREE.CylinderGeometry(9, 15, 1, 20, 1, true); this.beamM = new THREE.MeshBasicMaterial({ color: 0x9dffb4, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.beam = new THREE.Mesh(bg, this.beamM); this.beam.visible = false; this.beam.frustumCulled = false; g.scene.add(this.beam);
    this.beamCore = new THREE.Mesh(new THREE.CylinderGeometry(4, 7, 1, 14, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })); this.beam.add(this.beamCore);
  }
  buildHud() {
    let el = document.getElementById('inv-status'); if (!el) { el = document.createElement('div'); el.id = 'inv-status'; document.body.appendChild(el); } this.hud = el; this.hudTxt = '';
  }
  setHud(txt, hot) { if (txt === this.hudTxt) return; this.hudTxt = txt; this.hud.textContent = txt; this.hud.style.display = txt ? 'block' : 'none'; this.hud.classList.toggle('hot', !!hot); }
  // ---------------------------------------------------------------------------------------------------- state machine
  go(s) {
    if (this.state === s) return; this.state = s; this.stT = 0; this.stats.transitions.push(s); const g = this.g;
    if (s === IS.ARRIVING) { g.hud.toast('DAY 10 — THE SHIP HAS STOPPED OVER MAIN CITY'); g.camera.addTrauma && g.camera.addTrauma(0.25); }
    else if (s === IS.INVASION_ACTIVE) { this.force.build(); g.hud.toast('DAY 10 — INVASION ACTIVE'); }
    else if (s === IS.VILGAX_DESCENDING) g.hud.toast('DAY 11 — SOMETHING IS DESCENDING');
    else if (s === IS.VILGAX_ACTIVE) g.hud.toast('DAY 11 — VILGAX HAS ARRIVED');
    else if (s === IS.VILGAX_RETREATING) g.hud.toast('VILGAX RETREATS TO THE MOTHERSHIP');
    else if (s === IS.VILGAX_ABOARD) g.hud.toast('VILGAX IS ABOARD — THE SHIP STILL HOVERS OVER THE CITY');
  }
  step(wdt) {
    const g = this.g, dn = g.dayNight, sh = this.ship; if (!dn || !sh || !sh.loaded) return; this.t += wdt; this.stT += wdt; const e = dn.elapsed, P = g.player;
    if (g.vilgax && !this.vGuard) this.guardVilgax();
    // ---- transitions (forward only, each fires once)
    if (this.state === IS.APPROACHING && e >= IV.arriveDay && sh.arrived) { this.force.build(); this.go(IS.ARRIVING); if (e >= IV.arriveDay + 0.02) this.stT = IV.arriveT; }
    if (this.state === IS.ARRIVING && this.stT >= IV.arriveT) this.go(IS.INVASION_ACTIVE);
    if (this.state === IS.INVASION_ACTIVE && e >= IV.vilgaxDay) this.beginVilgax();
    if (this.state === IS.VILGAX_DESCENDING) this.descend(wdt);
    if (this.state === IS.VILGAX_ACTIVE) { this.hunt(wdt); this.watchVilgax(); }
    if (this.state === IS.VILGAX_RETREATING) this.retreat(wdt);
    if (!this.forceOk && (this.state === IS.VILGAX_ABOARD || this.state === IS.INVASION_DEFEATED) && !this.force.built && this.state === IS.VILGAX_ABOARD) { this.force.build(); }
    this.forceOk = true; if (this.state === IS.INVASION_DEFEATED) return;
    const fin = g.finale, still = fin && fin.gs !== 'none' && fin.gs !== 'done';
    // ---- the army + missiles (gameplay-time cadence, only once the ship has stopped)
    const on = this.state !== IS.APPROACHING, near = Math.hypot(P.pos.x - IV.centre.x, P.pos.z - IV.centre.z) < 700, v = g.vilgax, escort = this.state === IS.VILGAX_ACTIVE && v && v.present && !v.dead ? v.home : null;
    if (on) {
      this.force.update(wdt, { active: this.state !== IS.ARRIVING && this.state !== IS.VILGAX_DESCENDING && !still, centre: IV.centre, escortAt: escort });
      this.missiles.update(wdt, { enabled: !still && (this.state === IS.INVASION_ACTIVE || this.state === IS.VILGAX_DESCENDING || this.state === IS.VILGAX_ACTIVE || this.state === IS.VILGAX_RETREATING || this.state === IS.VILGAX_ABOARD), near });
      if (!escort) for (const b of this.force.all()) if (b.personal) b.personal = false;                              // no Vilgax -> nobody tracks the player island-wide
    }
    // fires make civilians run (a few at a time)
    this.fireT -= wdt; if (this.fireT <= 0 && g.world.danger && g.fire) { this.fireT = 1; let k = 0; for (const f of g.fire.fires) { if (Math.hypot(f.x - P.pos.x, f.z - P.pos.z) > 160) continue; g.world.danger(f.x, f.z, 16 + f.r * 3, 1); if (++k >= 6) break; } }
    // a manually despawned invasion Vilgax stays gone
    if (this.state === IS.VILGAX_ACTIVE && v && !v.present && this.vSpawned && !this.dismissed) { this.dismissed = true; this.save(); }
  }
  // ---------------------------------------------------------------------------------------------------- V33: Vilgax's retreat (once) -> aboard -> (finale) defeated
  guardVilgax() {                                                              // Vilgax cannot die before the retreat completes, and cannot be hurt during / after it
    const g = this.g, v = g.vilgax; if (!v || this.vGuard) return; this.vGuard = true; const orig = v.takeDamage.bind(v), me = this;
    v.takeDamage = function (dm, kind) {
      if (!me.invVilgax) return orig(dm, kind);
      if (me.state === IS.VILGAX_RETREATING || me.state === IS.VILGAX_ABOARD || me.aboard) return;
      if (v.hp - dm <= IV.retreatHp && me.state === IS.VILGAX_ACTIVE) { v.hp = IV.retreatHp; me.retreatReq = true; return; }
      return orig(dm, kind);
    };
    const bm = g.bosses, sp = bm.spawn.bind(bm); bm.spawn = id => { if (id === 'vilgax' && (me.aboard || me.state === IS.VILGAX_RETREATING || me.state === IS.MOTHERSHIP_GRABBED || me.state === IS.MOTHERSHIP_THROWN)) { g.hud.toast('VILGAX IS ABOARD THE MOTHERSHIP'); return false; } return sp(id); };
  }
  watchVilgax() {
    const v = this.g.vilgax; if (!this.invVilgax || !v || !v.present || v.dead) return;
    if (this.retreatReq || v.hp <= IV.retreatHp) this.beginRetreat();
  }
  beginRetreat() {
    const g = this.g, v = g.vilgax; if (this.state !== IS.VILGAX_ACTIVE || !v || !v.present) return; this.retreatReq = false; v.hp = Math.min(v.hp, IV.retreatHp);
    this.retreatT = 0; this.rY0 = v.home.y; this.landPt = { x: v.home.x, z: v.home.z, y: v.home.y }; try { v.cancelAct(); } catch { /* ignore */ }
    v.aiOn = false; v.collider.dead = true; v.fvy = 0; v.fallV = 0; this.go(IS.VILGAX_RETREATING);
  }
  retreat(wdt) {
    const g = this.g, v = g.vilgax, sh = this.ship; if (!v || !v.present) { this.finishRetreat(); return; }
    this.retreatT += wdt; const t = this.retreatT, L = this.landPt, top = sh.pos.y - 60;
    v.aiOn = false; v.collider.dead = true; v.fvy = 0; v.fallV = 0; v.hp = Math.min(v.hp, IV.retreatHp);
    const lift = clamp((t - 1.6) / 4.8, 0, 1), e2 = lift * lift * (3 - 2 * lift), y = this.rY0 + (top - this.rY0) * e2;
    v.home.set(L.x + Math.sin(t * 3) * 0.2 * (1 - lift), y, L.z); v.root.position.copy(v.home);
    if (Math.random() < wdt * 40) g.fx.glow.emit({ pos: _a.set(L.x + rand(-4, 4), y - 2, L.z + rand(-4, 4)).clone(), vel: _b.set(0, 8, 0).clone(), size: 2.4, life: 0.5, drag: 1, color: [0.5, 1, 0.6], alpha: 0.7 });
    if (t >= 6.4) this.finishRetreat();
  }
  finishRetreat() {
    const g = this.g, v = g.vilgax; this.aboard = true; this.dismissed = true; this.save();
    if (v && v.present) { try { v.bossDespawn(); g.bosses.updateUI(); } catch { /* ignore */ } }
    this.invVilgax = false; for (const b of this.force.all()) b.personal = false;
    this.go(IS.VILGAX_ABOARD);
  }
  vilgaxDefeated() {
    const g = this.g; if (this.state === IS.INVASION_DEFEATED) return; this.go(IS.MOTHERSHIP_CRASHED); this.defeated = true; this.aboard = false; this.save();
    this.missiles.clear(); for (const b of this.force.all()) { if (b.present && !b.dead) { try { this.force.defeatFX(b); } catch { /* ignore */ } } } this.force.clear(); this.force.built = true; this.force.waveT = 1e9;
    this.beam.visible = false; this.beamA = 0;
    this.go(IS.INVASION_DEFEATED); g.hud.toast('VILGAX INVASION DEFEATED'); if (g.finale) { g.finale.won.hidden = false; setTimeout(() => { g.finale.won.hidden = true; }, 9000); }
    if (g.world.danger) g.world.danger(IV.centre.x, IV.centre.z, 400, 0);
  }
  beginVilgax() {
    const g = this.g, v = g.vilgax; if (!v) { this.go(IS.VILGAX_ACTIVE); return; }
    if (this.landed || this.dismissed) { this.go(IS.VILGAX_ACTIVE); this.vSpawned = this.landed && !this.dismissed; return; }       // already happened in an earlier session: never replay, never auto-respawn
    if (v.present) { this.landed = true; this.vSpawned = true; this.save(); this.go(IS.VILGAX_ACTIVE); return; }                          // spawned manually: no second Vilgax, he just joins the invasion
    // choose a valid landing spot near the centre of Main City
    const w = g.world; let pt = null;
    for (const [x, z] of IV.landing) { const y = w.groundAt(x, z, 80, 120, 0.4); if (!(y > -1) || (w.lagoon && w.lagoon.depthAt && w.lagoon.depthAt(x, z) > 0.3)) continue; pt = { x, z, y }; break; }       // exact spot: Vilgax.placeAtSpawn() then moves him to the nearest open, non-building ground within 16 m
    pt = pt || { x: IV.landing[0][0], z: IV.landing[0][1], y: w.groundAt(IV.landing[0][0], IV.landing[0][1], 80, 120, 0.4) };
    this.landPt = pt; v.spawn.set(pt.x, pt.y, pt.z); if (!g.bosses.spawn('vilgax')) { if (!v.present) { this.go(IS.VILGAX_ACTIVE); return; } }
    this.vSpawned = true; this.invVilgax = true; this.stats.vilgaxSpawns++; this.landPt = { x: v.home.x, z: v.home.z, y: v.home.y }; this.dT = 0; this.v0y = this.landPt.y;
    v.aiOn = false; v.collider.dead = true; this.go(IS.VILGAX_DESCENDING);
  }
  descend(wdt) {
    const g = this.g, v = g.vilgax, sh = this.ship; if (!v || !v.present) { this.dismissed = true; this.save(); this.go(IS.VILGAX_ACTIVE); this.beamA = 0; return; }
    this.dT += wdt; const k = clamp(this.dT / IV.descendT, 0, 1), ease = k * k * (3 - 2 * k), off = IV.descendH * (1 - ease), L = this.landPt;
    v.aiOn = false; v.collider.dead = true; v.fvy = 0; v.fallV = 0; v.home.set(L.x, L.y + off, L.z); v.root.position.copy(v.home);
    if (Math.random() < wdt * 40) g.fx.glow.emit({ pos: _a.set(L.x + rand(-3, 3), L.y + off - 2, L.z + rand(-3, 3)).clone(), vel: _b.set(0, -6, 0).clone(), size: 2.2, life: 0.5, drag: 1, color: [0.5, 1, 0.6], alpha: 0.7 });
    if (k > 0.8 && Math.random() < wdt * 25) g.fx.dust.emit({ pos: _a.set(L.x + rand(-6, 6), L.y + 0.4, L.z + rand(-6, 6)).clone(), size: 4, grow: 3, life: 1, drag: 1.2, color: [0.6, 0.57, 0.52], alpha: 0.4 });
    if (k >= 1) {                                                                                           // touchdown
      v.home.y = L.y; v.root.position.copy(v.home); v.aiOn = true; v.collider.dead = false; this.landed = true; this.save(); this.landT = 0;
      g.fx.surface.ring(_a.set(L.x, L.y + 0.2, L.z).clone(), new THREE.Vector3(0, 1, 0), 22, 0.7, 0x9dffb4); g.fx.dust.emit({ pos: _a.set(L.x, L.y + 1, L.z).clone(), size: 18, grow: 8, life: 1.8, drag: 1.2, color: [0.6, 0.57, 0.52], alpha: 0.6 }); g.camera.addTrauma(clamp(0.8 - Math.hypot(g.player.pos.x - L.x, g.player.pos.z - L.z) / 120, 0.1, 0.8)); g.sfx.boom && g.sfx.boom(0.6);
      if (g.world.danger) g.world.danger(L.x, L.z, 60, 2); this.huntT = 0; this.go(IS.VILGAX_ACTIVE); this.force.personalT = 2;
      void sh;
    }
  }
  hunt(wdt) {
    const g = this.g, v = g.vilgax, P = g.player; this.huntT -= wdt; if (!v || !v.present || v.dead || this.huntT > 0) return; this.huntT = 1.5;
    if (v.st !== 'combat') v.st = 'combat'; v.alert = 1; v.lostT = 0; if (v.mem) v.mem.copy(P.pos); if (v.engageT !== undefined) v.engageT = Math.max(v.engageT, 4);
  }
  // ---------------------------------------------------------------------------------------------------- per-frame visuals (called after dayNight / mothership update)
  visual(dt) {
    const g = this.g, sh = this.ship, w = g.world; if (!sh || !sh.loaded) { this.setHud(''); return; }
    const e = g.dayNight ? g.dayNight.elapsed : 0, day = Math.floor(e) + 1;
    // ---- HUD pill
    let txt = '', hot = false;
    if (this.state === IS.APPROACHING) { if (e >= 5.5) txt = 'DAY ' + Math.min(day, 10) + ' — UNKNOWN SHIP APPROACHING'; }
    else if (this.state === IS.ARRIVING) txt = 'DAY 10 — SHIP OVER MAIN CITY', hot = true;
    else if (this.state === IS.INVASION_ACTIVE) txt = 'DAY 10 — INVASION ACTIVE', hot = true;
    else if (this.state === IS.VILGAX_DESCENDING) txt = 'DAY 11 — VILGAX DESCENDING', hot = true;
    else if (this.state === IS.VILGAX_RETREATING) txt = 'VILGAX RETREATING', hot = true;
    else if (this.state === IS.VILGAX_ABOARD) txt = 'VILGAX ABOARD — ROBOTS STILL ATTACKING', hot = true;
    else if (this.state === IS.MOTHERSHIP_GRABBED) txt = 'MOTHERSHIP GRABBED', hot = true;
    else if (this.state === IS.MOTHERSHIP_THROWN) txt = 'MOTHERSHIP THROWN', hot = true;
    else if (this.state === IS.MOTHERSHIP_CRASHED || this.state === IS.INVASION_DEFEATED) txt = '';
    else txt = 'DAY 11 — VILGAX HAS ARRIVED', hot = true;
    this.setHud(g.paused ? txt : txt, hot);
    // ---- ship shadow: a soft decal where the sun's rays put it + local light dimming (never map-wide)
    const sp = sh.pos, sd = w.sunDir, up = sd.y > 0.05, el = clamp(sd.y, 0.12, 1), off = Math.min(700, sp.y / Math.tan(Math.asin(el))), sx = up ? -sd.x : 0, sz = up ? -sd.z : 0, sl = Math.hypot(sx, sz) || 1;
    const cx = sp.x + sx / sl * off * (up ? 1 : 0), cz = sp.z + sz / sl * off * (up ? 1 : 0), dayK = up ? smoothstep(0.05, 0.4, sd.y) : 0, camP = g.camera.camera ? g.camera.camera.position : g.cam3 ? g.cam3.position : null;
    const near = camP ? Math.hypot(camP.x - cx, camP.z - cz) < 1500 : true; this.shadow.visible = sh.loaded && near && dayK > 0.01 && sp.y < 700;
    let cov = 0;
    if (this.shadow.visible) {
      const len = sh.len || 460, span = (sh.span || 80), gy = w.groundAt(cx, cz, sp.y, sp.y + 60, 1) || 0;
      this.shadow.position.set(cx, gy + 0.5, cz); this.shadow.rotation.z = 0; this.shadow.scale.set(span * 1.9 + off * 0.15, len * 1.25, 1); this.shadow.rotation.set(-Math.PI / 2, 0, 0); this.shadowM.opacity = 0.62 * dayK * clamp((700 - sp.y) / 300, 0, 1) * (this.state === IS.APPROACHING && e < 9.5 ? 0.6 : 1);
      if (camP) { const u = (camP.x - cx) / (span * 0.95 + off * 0.07), v2 = (camP.z - cz) / (len * 0.62); cov = 1 - smoothstep(0.55, 1.45, u * u + v2 * v2); }
    }
    this.shadowK += (cov * dayK - this.shadowK) * Math.min(1, dt * 3);
    if (this.shadowK > 0.002) { w.sun.intensity *= 1 - 0.5 * this.shadowK; w.hemi.intensity *= 1 - 0.16 * this.shadowK; }
    // ---- beam
    const want = this.state === IS.VILGAX_DESCENDING ? 1 : this.state === IS.VILGAX_RETREATING ? (this.retreatT < 5.6 ? 1 : 0) : this.state === IS.VILGAX_ACTIVE && this.landT !== undefined && this.landT < 3 ? Math.max(0, 1 - this.landT / 3) : 0; if (this.state === IS.VILGAX_ACTIVE && this.landT !== undefined) this.landT += dt;
    this.beamA += (want - this.beamA) * Math.min(1, dt * (want > this.beamA ? 1.6 : 1.4));
    if (this.beamA > 0.01 && this.landPt) {
      const top = sp.y - 30, bot = this.landPt.y, hgt = Math.max(1, top - bot); this.beam.visible = true; this.beam.position.set(this.landPt.x, bot + hgt / 2, this.landPt.z); this.beam.scale.set(1, hgt, 1); const fl = 0.85 + 0.15 * Math.sin(this.t * 17);
      this.beamM.opacity = 0.34 * this.beamA * fl; this.beamCore.material.opacity = 0.5 * this.beamA * fl; this.beam.rotation.y += dt * 0.6;
    } else this.beam.visible = false;
  }
  // ---------------------------------------------------------------------------------------------------- hooks used by the army / destruction / map
  /** after Vilgax has arrived every invasion robot knows where the player is */
  knowsPlayer() { return this.state === IS.VILGAX_ACTIVE || this.state === IS.VILGAX_RETREATING || this.state === IS.VILGAX_ABOARD || this.state === IS.MOTHERSHIP_GRABBED || this.state === IS.MOTHERSHIP_THROWN; }
  blocksRegen(b) { return this.missiles.nearRecent(b); }
  nearestCivilian(x, z, r) {
    const L = this.g.civ && this.g.civ.list; if (!L) return null; let best = null, bd = r * r;
    for (const c of L) { if (c.dead) continue; const d = (c.x - x) ** 2 + (c.z - z) ** 2; if (d < bd) { bd = d; best = c; } } return best;
  }
  hitCivilian(c, sev) {
    const g = this.g; if (!c || c.dead) return; this.stats.civHit++; if (g.world.danger) g.world.danger(c.x, c.z, 22, 2);
    if (sev >= 1 && Math.random() < 0.35 && g.civ) { c.dead = true; const i = g.civ.list.indexOf(c); if (i >= 0) g.civ.list.splice(i, 1); g.civ.render(); g.fx.glow.emit({ pos: new THREE.Vector3(c.x, c.y + 1, c.z), size: 1.4, life: 0.2, drag: 0, color: [1, 0.4, 0.2] }); }
  }
  alarmNear(x, z, r) { for (const b of this.force.all()) { if (!b.present) continue; const p = b.isDrone ? b.pos : b.home; if (Math.hypot(p.x - x, p.z - z) < r) b.alarm = 4; } }
  onRobotDown(b) { this.stats.robotsDown++; }
  /** live positions for the full map */
  markers() {
    const o = [], sh = this.ship; if (!sh || !sh.loaded) return o;
    if (this.state !== IS.APPROACHING) {
      for (const b of this.force.all()) { if (!b.present) continue; const p = b.isDrone ? b.pos : b.home; o.push({ x: p.x, z: p.z, kind: b.cls === 'drone' ? 'drone' : b.cls === 'std' ? 'robot' : b.cls === 'heavy' ? 'heavy' : 'giant', label: b.cls === 'drone' ? 'd' : b.cls === 'std' ? 'R' : b.cls === 'heavy' ? 'H' : 'G' }); }
      for (const m of this.missiles.recent) if (this.missiles.t - m.t < 25) o.push({ x: m.x, z: m.z, kind: 'loc', label: '✹' });
      if (this.landPt && this.state !== IS.APPROACHING && this.landed) o.push({ x: this.landPt.x, z: this.landPt.z, kind: 'loc', label: '▼' });
    }
    return o;
  }
}
