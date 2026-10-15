// Fire for Heatblast: pooled flame / smoke / ember particles, temporary ground fires, burning objects (props, dummies), explosions and a tiny pool of
// dynamic point lights. Everything has a lifetime and a hard cap, so fire can never accumulate without limit.
// Runs on WORLD time (burning slows down with Time Slow like everything else the player did not directly control).
import * as THREE from 'three';
import { clamp, rand, lerp } from './util.js';
import { Dummy } from './dummies.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
const HOT = [1, 0.96, 0.62], MID = [1, 0.62, 0.16], RED = [1, 0.3, 0.06], SMK = [0.17, 0.16, 0.16];
const pick = (heat = 1) => { const r = Math.random() / Math.max(0.3, heat); return r < 0.25 ? HOT : r < 0.62 ? MID : RED; };

/** what can burn: wood / vegetation catch fire from heat; vehicles only after they are damaged; barrels explode; metal and stone never burn */
export const FLAM = {
  crate:  { ignite: 26, dur: 11, dps: 0.09, spread: 3.2, label: 'WOODEN CRATE' },
  bench:  { ignite: 20, dur: 8,  dps: 0.13, spread: 2.4, label: 'BENCH' },
  fence:  { ignite: 16, dur: 9,  dps: 0.11, spread: 3.0, label: 'WOODEN FENCE' },
  bush:   { ignite: 10, dur: 6,  dps: 0.2,  spread: 3.6, label: 'VEGETATION' },
  tree:   { ignite: 18, dur: 12, dps: 0.07, spread: 4.0, label: 'TREE' },
  barrel: { ignite: 30, dur: 3.2, dps: 0.0, spread: 1.0, label: 'FUEL BARREL', explode: true },
  car:    { ignite: 1e9, dur: 9, dps: 0.0, spread: 0, label: 'VEHICLE', vehicle: true },
  truck:  { ignite: 1e9, dur: 9, dps: 0.0, spread: 0, label: 'VEHICLE', vehicle: true },
};

class LightPool {
  constructor(scene, n = 5) {
    this.items = []; for (let i = 0; i < n; i++) { const l = new THREE.PointLight(0xff7a2a, 0, 14, 1.6); l.castShadow = false; scene.add(l); this.items.push({ l, life: 0, max: 1, base: 0, hold: 0 }); }
  }
  /** transient flash: takes a free slot, else the dimmest transient (slot 0 is reserved for the player's own light) */
  flash(pos, color, intensity, life, dist = 16) {
    let best = null; for (let i = 3; i < this.items.length; i++) { const it = this.items[i]; if (it.life <= 0) { best = it; break; } if (!best || it.base * it.life / it.max < best.base * best.life / best.max) best = it; }
    best.l.position.copy(pos); best.l.color.setRGB(color[0], color[1], color[2]); best.l.distance = dist; best.base = intensity; best.life = best.max = life;
  }
  update(dt) { for (let i = 3; i < this.items.length; i++) { const it = this.items[i]; if (it.life > 0) { it.life -= dt; const k = Math.max(0, it.life / it.max); it.l.intensity = it.base * k * k; } else it.l.intensity = 0; } }
}

export class FireSystem {
  constructor(game, sharedLights = null) {
    this.g = game; this.fires = []; this.burners = new Map(); this.t = 0; this.cap = { fires: 16, burners: 22 };
    this.ownLights = !sharedLights; this.lights = sharedLights || new LightPool(game.scene, 5); this.stats = { ignited: 0, explosions: 0, groundFires: 0, burnedOut: 0, carsExploded: 0, dummyBurns: 0 };
    this.qCount = 0;
    // scorch decals (dark radial gradient, fade out)
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62); gr.addColorStop(0, 'rgba(8,6,5,0.85)'); gr.addColorStop(0.55, 'rgba(14,10,8,0.55)'); gr.addColorStop(1, 'rgba(14,10,8,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c); const geo = new THREE.PlaneGeometry(1, 1); this.scorch = [];
    for (let i = 0; i < 14; i++) { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })); m.rotation.x = -Math.PI / 2; m.visible = false; m.userData.t = 0; game.scene.add(m); this.scorch.push(m); }
    this.sn = 0;
  }
  // ---------------------------------------------------------------------------------------------- particles
  flame(pos, vel, size = 0.5, life = 0.5, heat = 1, grow = -0.4) { this.g.fx.fire.emit({ pos, vel, size, life, drag: 1.4, grav: -2.5, grow: grow * size, color: pick(heat), alpha: 0.95 }); }
  smoke(pos, vel, size = 1, life = 1.6) { this.g.fx.smoke.emit({ pos, vel, size, life, drag: 0.9, grav: -0.8, grow: 0.9 * size, color: SMK, alpha: 0.75 }); }
  spark(pos, vel, life = 0.6) { this.g.fx.fire.emit({ pos, vel, size: rand(0.08, 0.16), life, drag: 0.4, grav: 7, color: HOT, alpha: 1 }); }
  burst(pos, n, speed, size, life, up = 0.5) { for (let i = 0; i < n; i++) { _v.set(rand(-1, 1), rand(-0.2, 1) + up, rand(-1, 1)).normalize().multiplyScalar(rand(0.3, 1) * speed); this.flame(pos, _v, size * rand(0.6, 1.2), life * rand(0.6, 1.1), 1.2); } }
  scorchAt(x, y, z, r, life = 9) { const m = this.scorch[this.sn]; this.sn = (this.sn + 1) % this.scorch.length; m.position.set(x, y + 0.02, z); m.scale.setScalar(r * 2); m.userData.t = 0; m.userData.life = life; m.visible = true; m.material.opacity = 0.9; }

  // ---------------------------------------------------------------------------------------------- ground fires
  groundFire(x, z, r = 1.6, life = 5, y = 0, dps = 9) {
    const g = this.g.world.groundAt(x, z, y + 0.5, 1, 0.1);
    if (this.fires.length >= this.cap.fires) this.fires.shift();
    this.fires.push({ x, z, y: Math.max(y, g), r, life, max: life, dps, tick: 0 }); this.stats.groundFires++; this.scorchAt(x, Math.max(y, g), z, r * 1.25, life + 3);
  }
  // ---------------------------------------------------------------------------------------------- ignition
  flammable(p) { return !!FLAM[p.kind] && !p.dead && p.state !== 'held'; }
  /** add heat to a prop; it ignites past its threshold (vehicles catch fire once badly damaged) */
  heatProp(p, amount) {
    const F = FLAM[p.kind]; if (!F || p.dead) return; p.heat = (p.heat || 0) + amount; p.heatT = 0.6;
    if (p.burn) return;
    if (F.vehicle) { p.hp -= amount * 0.9; if (p.hp <= p.hpMax * 0.55 && p.hp > 0) this.igniteProp(p); else if (p.hp <= 0) this.carBlast(p); this.g.props.hurt(p, 0); return; }
    if (p.heat >= F.ignite) this.igniteProp(p);
  }
  igniteProp(p) {
    const F = FLAM[p.kind]; if (!F || p.dead || p.burn) return;
    if (this.burners.size >= this.cap.burners) { const first = this.burners.keys().next().value; this.extinguish(first); }
    p.burn = { t: 0, dur: F.dur * rand(0.9, 1.15), e: 0 }; this.burners.set(p, 'prop'); this.stats.ignited++;
    p.inner.traverse(o => { if (o.isMesh && o.material && o.material.color) { if (!o.userData.c0) o.userData.c0 = o.material.color.clone(); if (!o.userData.cl) { o.material = o.material.clone(); o.userData.cl = true; } } });
    if (this.g.hud && (p.kind === 'car' || p.kind === 'truck')) this.g.hud.toast('VEHICLE ON FIRE');
    this.burst(p.center, 8, 4, 0.8, 0.5);
  }
  igniteDummy(d, dur = 3.5) {
    if (!(d instanceof Dummy) || d.dead || d.isBoss) return; if (!d.burn) { this.burners.size < this.cap.burners + 6 && this.burners.set(d, 'dummy'); this.stats.dummyBurns++; }
    d.burn = Math.max(d.burn || 0, dur);
  }
  extinguish(o) { if (o.burn) { o.burn = null; if (o instanceof Dummy) o.burn = 0; } this.burners.delete(o); }
  carBlast(p) {
    if (p.dead) return; this.stats.carsExploded++; const c = p.center.clone(); this.g.props.destroy(p, null); this.explode(c, 7.5, 70, 15, { big: true, fuel: true });
  }

  // ---------------------------------------------------------------------------------------------- explosions
  /** area damage + shove + ignition + visuals. opts: owner (player, for stats), noRing, fuel, big, ignite (extra heat) */
  explode(c, R, dmg, kb, o = {}) {
    const g = this.g, fx = g.fx; this.stats.explosions++; if (g.world.danger) g.world.danger(c.x, c.z, Math.max(30, R * 4), 2);
    for (const h of g.world.hittables) {
      if (h.dead || (o.owner && h === o.owner)) continue; const hp = h.root.position, dx = hp.x - c.x, dz = hp.z - c.z, dy = hp.y + 1.2 - c.y, d = Math.hypot(dx, dz, dy * 0.6); if (d > R) continue;
      const f = 1 - d / R, dd = dmg * (0.35 + 0.65 * f) * (o.dmgMul || 1), dir = _w.set(dx, 0, dz); if (dir.lengthSq() < 1e-4) dir.set(rand(-1, 1), 0, rand(-1, 1)); dir.normalize();
      const pt = new THREE.Vector3(hp.x, hp.y + 1.3, hp.z); h.applyHit(pt, dir.clone(), dd); if (h.shove) h.shove(dir, kb * (0.4 + 0.6 * f) * (o.kbMul || 1)); if (h.launch) h.launch(2.5 + 5 * f);
      g.hud.hit(pt, Math.round(dd), h); if (h instanceof Dummy) this.igniteDummy(h, 2.5 + 3 * f);
    }
    if (o.owner) {                                   // fired by an AI owner (Kevin): the player is the target (a Heatblast player never hurts himself)
      const P = g.player, px = P.pos.x - c.x, pz = P.pos.z - c.z, py = P.pos.y + 1.0 - c.y, d = Math.hypot(px, pz, py * 0.6);
      if (d < R + (P.rad ?? 0.5) && !P.ignoreHits) {
        const f = clamp(1 - d / (R + 0.5), 0.2, 1), dir = _w.set(px, 0, pz); if (dir.lengthSq() < 1e-4) dir.set(rand(-1, 1), 0, rand(-1, 1)); dir.normalize();
        const base = o.imp || { damage: dmg, knockbackForce: kb, upwardForce: 1, staggerDuration: 0.4, knockdownThreshold: 9, launchThreshold: 17 };
        const res = g.impact.hitPlayer(Object.assign({}, base, { damage: base.damage * (0.55 + 0.45 * f), knockbackForce: base.knockbackForce * (0.6 + 0.4 * f), dir: dir.clone(), point: new THREE.Vector3(P.pos.x, P.pos.y + 1, P.pos.z), src: o.owner, color: [1, 0.55, 0.15] }));
        if (o.owner.onPlayerHit && !(res && res.passed)) o.owner.onPlayerHit('fireBlast', res);
      }
    }
    const P = g.props; if (P) {
      for (const p of P.props) { if (p.dead || p.held) continue; const d = Math.hypot(p.pos.x - c.x, p.pos.z - c.z); if (d > R * 1.1) continue; const f = 1 - d / (R * 1.1); if (FLAM[p.kind]) this.heatProp(p, (o.heat ?? 60) * (0.4 + f)); }
      P.shockwave(c, R, kb * 0.9, dmg * 1.1 * (o.wall ?? 0.35), dmg * 1.1 * (o.prop ?? 0.7));
    }
    // visuals
    const k = clamp(R / 5, 0.6, 3.6); this.burst(c, Math.round(46 * k), 11 * k, 1.5 * k, 0.8, 0.4);
    fx.fire.emit({ pos: c, size: 7 * k, life: 0.3, drag: 0, color: HOT, alpha: 1 }); fx.fire.emit({ pos: c, size: 11 * k, life: 0.45, drag: 0, color: MID, alpha: 0.7, grow: 5 * k });
    for (let i = 0; i < 7 * k; i++) this.smoke(c.clone().add(_v.set(rand(-1, 1), rand(0, 1.5), rand(-1, 1)).multiplyScalar(k)), _v.set(rand(-1, 1), rand(1, 3.5), rand(-1, 1)).clone(), rand(1.1, 2.1) * Math.min(k, 1.7), rand(1.4, 2.4));
    for (let i = 0; i < 18 * k; i++) this.spark(c, _v.set(rand(-1, 1), rand(0.2, 1), rand(-1, 1)).normalize().multiplyScalar(rand(6, 16) * k).clone(), rand(0.5, 1.1));
    if (!o.noRing) { fx.surface.ring(new THREE.Vector3(c.x, Math.max(c.y, 0) + 0.1, c.z), UP, R * 1.3, 0.5, 0xff8a2a); if (o.big) fx.surface.ring(new THREE.Vector3(c.x, Math.max(c.y, 0) + 0.15, c.z), UP, R * 0.8, 0.35, 0xffd27a); }
    this.lights.flash(c.clone().setY(c.y + 1.2), [1, 0.62, 0.22], 90 * k, 0.55, 26 + 8 * k); this.scorchAt(c.x, g.world.groundAt(c.x, c.z, c.y + 0.5, 1, 0.1), c.z, R * 0.45 * (o.scorch ?? 1), 12);
    const near = clamp(1.2 - c.distanceTo(g.player.pos) / 45, 0, 1); g.camera.addTrauma((o.big ? 0.9 : 0.5) * k * 0.5 * near + 0.05); g.sfx.boom(clamp(0.35 * k * near + 0.1, 0.1, 1));
    if (o.fuel) for (let i = 0; i < 4; i++) this.groundFire(c.x + rand(-R * 0.5, R * 0.5), c.z + rand(-R * 0.5, R * 0.5), rand(1.2, 2), rand(3, 5), c.y);
  }

  // ---------------------------------------------------------------------------------------------- per frame
  update(dt) {
    this.t += dt; const g = this.g, P = g.props, cam = g.cam3.position;
    if (this.ownLights) this.lights.update(dt);
    // scorch fade
    for (const m of this.scorch) { if (!m.visible) continue; m.userData.t += dt; const u = m.userData.t / m.userData.life; if (u >= 1) { m.visible = false; continue; } m.material.opacity = 0.9 * (u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3); }
    // ground fires
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i]; f.life -= dt; if (f.life <= 0) { this.fires.splice(i, 1); this.stats.burnedOut++; continue; }
      const k = Math.min(1, f.life / 0.8) * Math.min(1, (f.max - f.life) / 0.25 + 0.2), far = Math.hypot(f.x - cam.x, f.z - cam.z), lod = far > 60 ? 0 : far > 32 ? 0.4 : 1;
      const n = f.r * f.r * 7 * dt * lod * k + Math.random(); for (let j = 0; j < Math.floor(n); j++) { const a = rand(0, 6.283), rr = Math.sqrt(Math.random()) * f.r; this.flame(_v.set(f.x + Math.cos(a) * rr, f.y + 0.1, f.z + Math.sin(a) * rr), _w.set(rand(-0.3, 0.3), rand(1.4, 3.2), rand(-0.3, 0.3)), rand(0.45, 0.85) * (0.6 + 0.4 * k), rand(0.4, 0.75), 1); }
      if (Math.random() < 3 * dt * lod * f.r) this.smoke(_v.set(f.x + rand(-1, 1) * f.r * 0.5, f.y + 0.8, f.z + rand(-1, 1) * f.r * 0.5), _w.set(rand(-0.3, 0.3), 1.6, rand(-0.3, 0.3)), rand(0.8, 1.3), rand(1.4, 2.2));
      f.tick -= dt; if (f.tick <= 0) {
        f.tick = 0.25;
        for (const h of g.world.hittables) { if (h.dead || h.held) continue; const hp = h.root.position; if (Math.hypot(hp.x - f.x, hp.z - f.z) < f.r + 0.5 && hp.y < f.y + 1.2) { h.applyHit(_v.set(hp.x, hp.y + 1, hp.z), UP, f.dps * 0.25); g.hud.hit(_v, Math.round(f.dps * 0.25), h); if (h instanceof Dummy) this.igniteDummy(h, 2.5); } }
        if (P) for (const p of P.props) if (FLAM[p.kind] && !p.dead && !p.held && Math.hypot(p.pos.x - f.x, p.pos.z - f.z) < f.r + Math.max(p.half.x, p.half.z)) this.heatProp(p, 9);
      }
    }
    // burning objects
    let lit = 0;
    for (const [o, type] of [...this.burners]) {
      if (type === 'dummy') {
        if (o.dead || !(o.burn > 0)) { this.burners.delete(o); o.burn = 0; continue; }
        o.burn -= dt; const c = o.root.position; this.tickBurnDummy(o, dt, c, cam); if (o.burn <= 0) this.burners.delete(o); continue;
      }
      const p = o; if (p.dead) { this.burners.delete(p); p.burn = null; continue; }
      const F = FLAM[p.kind], b = p.burn; b.t += dt; if (!F.explode) { const ck = 1 - 0.72 * clamp(b.t / b.dur, 0, 1); p.inner.traverse(o => { if (o.isMesh && o.userData.c0) o.material.color.copy(o.userData.c0).multiplyScalar(ck); }); } const cen = p.center, far = cen.distanceTo(cam), lod = far > 70 ? 0 : far > 36 ? 0.45 : 1, sz = Math.cbrt(p.size.w * p.size.h * p.size.d);
      const n = (10 + 16 * sz) * dt * lod * (1 - 0.6 * clamp((b.t - b.dur * 0.7) / (b.dur * 0.3), 0, 1)) + Math.random();
      for (let j = 0; j < Math.floor(n); j++) { _v.set(p.pos.x + rand(-1, 1) * p.half.x, p.pos.y + rand(0.2, 1) * p.size.h, p.pos.z + rand(-1, 1) * p.half.z); this.flame(_v, _w.set(rand(-0.4, 0.4), rand(1.5, 3.6), rand(-0.4, 0.4)), rand(0.5, 1.0) * (0.6 + sz * 0.4), rand(0.4, 0.8), 1); }
      if (Math.random() < (4 + 3 * sz) * dt * lod) this.smoke(_v.set(p.pos.x + rand(-1, 1) * p.half.x, p.pos.y + p.size.h + 0.3, p.pos.z + rand(-1, 1) * p.half.z), _w.set(rand(-0.3, 0.3), rand(1.6, 2.6), rand(-0.3, 0.3)), rand(1, 1.8) * (0.7 + sz * 0.3), rand(1.6, 2.6));
      if (lit < 2 && far < 40) { const it = this.lights.items[1 + lit++]; it.l.position.set(cen.x, cen.y + 0.8, cen.z); it.l.color.setRGB(1, 0.55 + 0.1 * Math.sin(this.t * 17 + p.pos.x), 0.2); it.l.intensity = (7 + 5 * sz) * (0.85 + 0.15 * Math.sin(this.t * 23)) * (1 - 0.7 * clamp((b.t - b.dur * 0.8) / (b.dur * 0.2), 0, 1)); it.l.distance = 9 + 3 * sz; }
      if (F.explode) { if (b.t > F.dur) { this.burners.delete(p); p.burn = null; const c = p.center.clone(); g.props.destroy(p, null); this.explode(c, 6.5, 55, 13, { big: true, fuel: true }); continue; } }
      else if (F.vehicle) { p.hp -= p.hpMax * 0.035 * dt; if (p.hp <= 0 || b.t > b.dur + 2) { this.burners.delete(p); p.burn = null; this.carBlast(p); continue; } if (b.t > b.dur * 0.55 && Math.random() < 3 * dt) this.spark(cen, _w.set(rand(-1, 1), rand(2, 5), rand(-1, 1)).clone(), 0.9); }
      else { g.props.hurt(p, p.hpMax * F.dps * dt); if (p.dead) { this.burners.delete(p); p.burn = null; this.burst(cen, 10, 4, 0.8, 0.5); this.groundFire(p.pos.x, p.pos.z, Math.max(p.half.x, p.half.z) * 0.9 + 0.4, 3.2, p.pos.y, 5); continue; } }
      // fire spreads to nearby flammables
      b.e += dt; if (b.e > 0.4 && F.spread) { b.e = 0; for (const q of g.props.props) if (q !== p && FLAM[q.kind] && !q.dead && !q.burn && !FLAM[q.kind].vehicle && Math.hypot(q.pos.x - p.pos.x, q.pos.z - p.pos.z) < F.spread + Math.max(q.half.x, q.half.z)) this.heatProp(q, 7); }
      if (b.t > b.dur && !F.explode && !F.vehicle) { this.burners.delete(p); p.burn = null; this.stats.burnedOut++; }
      if (p.heatT > 0) { p.heatT -= dt; } else if (p.heat > 0) p.heat = Math.max(0, p.heat - 8 * dt);
    }
    // damaged vehicles smoke before they ignite
    if (P) for (const p of P.props) { const F = FLAM[p.kind]; if (F && F.vehicle && !p.dead && !p.burn && p.hp < p.hpMax * 0.8 && Math.random() < 5 * dt) this.smoke(_v.set(p.pos.x + Math.sin(p.yaw) * p.size.d * 0.35, p.pos.y + p.size.h * 0.7, p.pos.z + Math.cos(p.yaw) * p.size.d * 0.35), _w.set(rand(-0.3, 0.3), rand(1.2, 2.2), rand(-0.3, 0.3)), rand(0.6, 1.0), 1.8); }
    // heat on non-burning props cools down
    if (P) for (const p of P.props) if (p.heat > 0 && !p.burn) { if (p.heatT > 0) p.heatT -= dt; else p.heat = Math.max(0, p.heat - 8 * dt); }
  }
  tickBurnDummy(d, dt, c, cam) {
    const far = Math.hypot(c.x - cam.x, c.z - cam.z), lod = far > 55 ? 0 : 1; d.burnAcc = (d.burnAcc || 0) + dt;
    if (d.burnAcc > 0.5) { d.burnAcc = 0; d.applyHit(_v.set(c.x, c.y + 1.2, c.z), UP, 3.5); this.g.hud.hit(_v, 4, d); }
    const n = 22 * dt * lod + Math.random(); for (let j = 0; j < Math.floor(n); j++) this.flame(_v.set(c.x + rand(-0.4, 0.4), c.y + rand(0.3, 2.2), c.z + rand(-0.4, 0.4)), _w.set(rand(-0.3, 0.3), rand(1.6, 3), rand(-0.3, 0.3)), rand(0.4, 0.8), rand(0.3, 0.6), 1);
    if (Math.random() < 3 * dt * lod) this.smoke(_v.set(c.x, c.y + 2.3, c.z), _w.set(rand(-0.3, 0.3), 1.8, rand(-0.3, 0.3)), rand(0.7, 1.1), 1.6);
  }
  clear() {
    this.fires.length = 0; for (const [o, t] of this.burners) { if (t === 'prop') { o.burn = null; o.heat = 0; } else o.burn = 0; } this.burners.clear(); for (const m of this.scorch) m.visible = false;
    for (const it of this.lights.items) { it.life = 0; it.l.intensity = 0; } this.g.props.props.forEach(p => { p.heat = 0; });
  }
}
