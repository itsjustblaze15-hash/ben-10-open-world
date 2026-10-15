// Ripjaws' physical attacks: Bite (LMB) and Claw swipe (E). Mixed into RjPlayer.
// Every hit is a real contact test - the bite lands only when the animated MOUTH / jaw-tip marker touches the enemy's body or a prop's box, the claw only when the
// swiping hand does. Nothing damages from a distance and nothing is a projectile, a shockwave or an energy effect. Works on land and in the water (3D lunge, no standing pose).
import * as THREE from 'three';
import { clamp, rand, lerp } from './util.js';

const $ = id => document.getElementById(id);
const sin = Math.sin, cos = Math.cos, atan2 = Math.atan2, PI = Math.PI;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3(), _m = new THREE.Vector3(), _n = new THREE.Vector3(), _s = new THREE.Vector3();
export const RJ_CD = { lmb: 0.55, e: 0.3 };
/** what Ripjaws can actually damage: material + how much of his damage the material takes. Anything not listed (walls, buildings, rocks, trees, lamp posts, vehicles, dumpsters, robots) is immune. */
const MAT = { crate: ['wood', 2.4], fence: ['wood', 2.6], bench: ['wood', 2.0], bush: ['plant', 3.5], trash: ['metal', 1.1], barrel: ['metal', 1.0], computer: ['plastic', 0.9] };
export const matOf = p => MAT[p.kind] || null;

export const rjPowers = {
  initPowers(game) {
    this.act = null; this.lmbHeld = false; this.clawIdx = 0; this.toastT = 0; this.hintEl = $('rjhint'); this.cd = { lmb: 0, e: 0 }; this.cdMax = RJ_CD; this.hintTxt = null;
  },
  // ============================================================================================== helpers
  beginAct(kind, extra) {
    const sw = this.mode === 'swim';
    this.act = Object.assign({ kind, stage: 'wind', t: 0, st: 0, speedMul: sw ? 0.7 : 0.7, lockMove: false, moveVel: null, moveVel3: null, faceYaw: this.aimYaw(), faceK: 18, tiltTo: undefined, hit: new Set(), clinked: false, target: null }, extra);
    return this.act;
  },
  setStage(a, s, extra) { a.stage = s; a.st = 0; if (extra) Object.assign(a, extra); },
  stageTime(a, dt) { a.t += dt; a.st += dt; },
  endAct(cdKey = null, cd = 0) { if (!this.act) return; if (cdKey) this.cd[cdKey] = cd || RJ_CD[cdKey]; this.act = null; },
  /** drop the running attack (mode change, hit by a switch, water entry) - the pose layers relax on their own */
  cancelAct() { this.act = null; },
  cancelAll() {
    this.act = null; this.lmbHeld = false; const S = this.anim && this.anim.s;
    if (S) { const B = S.bk; B.jaw = B.nk = B.hd = B.sp = B.oz = B.hy = B.arm = B.dp = 0; S.ck.w = 0; }
    if (this.hintEl) this.hintEl.hidden = true; this.hintTxt = null;
  },
  toast(m) { if (this.toastT <= 0) { this.g.hud.toast(m); this.toastT = 1.2; } },
  jawPos(out) { return this.rig.markers.jawTip.getWorldPosition(out); },
  clawPos(side, out) { return (side > 0 ? this.rig.markers.clawL : this.rig.markers.clawR).getWorldPosition(out); },
  /** closest point of a living enemy's body to `from` -> written to `out`; returns the surface distance (0 when inside). Dummies/guards/turrets: vertical capsule; divers: their body spheres. */
  foeBody(h, from, out) {
    if (h.kind === 'diver') {
      let best = 1e9; for (const s of h.spheres) { _s.copy(s.local); h.root.localToWorld(_s); const dx = from.x - _s.x, dy = from.y - _s.y, dz = from.z - _s.z, l = Math.hypot(dx, dy, dz), d = l - s.r; if (d < best) { best = d; if (l > 1e-5) out.set(_s.x + dx / l * s.r, _s.y + dy / l * s.r, _s.z + dz / l * s.r); else out.copy(_s); } }
      return Math.max(0, best);
    }
    const hp = h.root.position, col = h.collider, r = col ? col.r : 0.62, hh = col ? col.h : 2.4, cy = clamp(from.y, hp.y + 0.25, hp.y + hh - 0.25), dx = from.x - hp.x, dy = from.y - cy, dz = from.z - hp.z, l = Math.hypot(dx, dy, dz);
    if (l > 1e-5) out.set(hp.x + dx / l * r, cy + dy / l * r, hp.z + dz / l * r); else out.set(hp.x, cy, hp.z);
    return Math.max(0, l - r);
  },
  foeCentre(h, out) { if (h.kind === 'diver') return out.copy(h.pos); const hp = h.root.position, col = h.collider; return out.set(hp.x, hp.y + (col ? col.h : 2.4) * 0.5, hp.z); },
  /** closest point of a prop's box to `from` -> `out` (props are axis-aligned boxes); returns the distance */
  propPoint(p, from, out) { const hh = p.half; out.set(clamp(from.x, p.pos.x - hh.x, p.pos.x + hh.x), clamp(from.y, p.pos.y, p.pos.y + p.size.h), clamp(from.z, p.pos.z - hh.z, p.pos.z + hh.z)); return out.distanceTo(from); },
  /** a biteable prop (wood / plant / small metal / plastic) just in front of the mouth: the lunge steers to it like it does to an enemy (immune things never pull the lunge) */
  pickProp(origin, range, flat) {
    const ad = flat ? _c.set(sin(this.aimYaw()), 0, cos(this.aimYaw())) : this.aimDir3(_c); let best = null, bs = 1e9;
    for (const p of this.g.props.props) {
      if (p.dead || p.held || p.temp || !matOf(p)) continue; const d = this.propPoint(p, origin, _d); if (d > range) continue;
      _e.copy(_d).sub(origin); if (flat) _e.y = 0; const l = _e.length(), dot = l > 0.05 ? _e.dot(ad) / l : 1; if (dot < 0.35 && d > 0.9) continue; const sc = d - dot * 1.5; if (sc < bs) { bs = sc; best = p; }
    }
    return best;
  },
  /** best enemy for an attack that starts at `origin`: nearest surface within `range` inside a cone around the aim (3D in the water, flat on land) */
  pickTarget(origin, range, cosMin, flat) {
    const sw = !flat, ad = sw ? this.aimDir3(_c) : _c.set(sin(this.aimYaw()), 0, cos(this.aimYaw())); let best = null, bs = 1e9;
    for (const h of this.g.world.hittables) {
      if (h.dead || h.held || h.possessed || (h.kind !== 'dummy' && h.kind !== 'diver')) continue;
      const d = this.foeBody(h, origin, _d); if (d > range) continue; if (flat && Math.abs(_d.y - origin.y) > 2.6 && h.kind !== 'diver') continue;
      _e.copy(_d).sub(origin); if (flat) _e.y = 0; const l = _e.length(), dot = l > 0.05 ? _e.dot(ad) / l : 1;
      if (dot < cosMin && d > 1.1) continue; const sc = d - dot * 2.5; if (sc < bs) { bs = sc; best = h; }
    }
    return best;
  },
  touchProp(p, c, r) {
    const hh = p.half, qx = clamp(c.x, p.pos.x - hh.x, p.pos.x + hh.x), qz = clamp(c.z, p.pos.z - hh.z, p.pos.z + hh.z), qy = clamp(c.y, p.pos.y, p.pos.y + p.size.h);
    return (qx - c.x) ** 2 + (qy - c.y) ** 2 + (qz - c.z) ** 2 <= r * r;
  },
  boxAt(pt, pad = 0.15) { for (const b of this.g.world.boxes) if (pt.x > b.min.x - pad && pt.x < b.max.x + pad && pt.y > b.min.y - pad && pt.y < b.max.y + pad && pt.z > b.min.z - pad && pt.z < b.max.z + pad) return b; return null; },
  isWet(pt) { const L = this.L; return L.inRect(pt.x, pt.z, 0.2) && pt.y < L.waterY + 0.05; },
  hurtFoe(h, pt, dir, dmg, kb, o = {}) {
    const g = this.g; h.applyHit(pt, dir.clone(), dmg); if (h.shove && kb) h.shove(dir, kb); if (o.launch && h.launch) h.launch(o.launch); if (o.tilt && h.tiltV) { h.tiltV.x += dir.z * o.tilt; h.tiltV.y -= dir.x * o.tilt; }
    g.hud.hit(pt, Math.round(dmg), h); this.stats.hits++;
  },
  /** damage a prop if its material allows it (wooden crates / fences / benches, bushes, small metal and plastic things); everything else only clinks */
  chompProp(p, dmg, pt, dir, wet) {
    const g = this.g, m = matOf(p); if (!m) return false;
    g.props.hurt(p, dmg * m[1], dir); const dead = p.dead; this.stats.chomped++;
    if (!dead) { p.tumble.x += rand(-0.07, 0.07); p.tumble.z += rand(-0.07, 0.07); g.props.syncRoot(p); }
    if (wet) { this.L.bubbleBurst(pt, dead ? 12 : 6, 0.3, 0.9, 0.05); if (pt.y - this.L.floorAt(pt.x, pt.z) < 1.2) this.L.silt(pt, 2, 0.8); if (!dead) g.sfx.crash(0.16); }
    else if (!dead) g.props.impactFX(pt, clamp(g.props.fxScale(p) * 0.9, 0.6, 1.5), p.debris, false);
    if (m[0] === 'wood' || m[0] === 'plant') for (let i = 0; i < (dead ? 6 : 3); i++) g.fx.shards.emit({ pos: pt.clone(), vel: _e.set(rand(-1, 1), rand(0.2, 1.2), rand(-1, 1)).normalize().multiplyScalar(rand(wet ? 1 : 2, wet ? 3 : 6)).clone(), size: rand(0.06, 0.16), life: wet ? 1.8 : 1.1, grav: wet ? 0.25 : 1 });
    if (dead) g.camera.addTrauma(0.08); return true;
  },
  /** walls and the like: show it did nothing (a short clink + one line) */
  clink(pt, wet) {
    const g = this.g; if (wet) this.L.bubbleBurst(pt, 3, 0.2, 0.6, 0.04); else for (let i = 0; i < 4; i++) g.fx.glow.emit({ pos: pt.clone(), vel: _e.set(rand(-1, 1), rand(0, 1), rand(-1, 1)).normalize().multiplyScalar(rand(3, 7)).clone(), size: rand(0.08, 0.18), life: 0.22, drag: 2, color: [1, 0.85, 0.5], alpha: 1 });
    g.sfx.hit(false); this.toast('TOO HARD TO BITE THROUGH');
  },
  hitFX(pt, k, wet) {
    const g = this.g;
    if (wet) { this.L.bubbleBurst(pt, Math.round(7 + 5 * k), 0.3, 1.0, 0.055); if (pt.y - this.L.floorAt(pt.x, pt.z) < 1.4) this.L.silt(pt, 2, 0.8); g.camera.addTrauma(0.06 * k); g.camera.kick(0.008 * k); g.sfx.hit(false); return; }
    g.fx.glow.emit({ pos: pt.clone(), size: 1.5 * k, life: 0.12, drag: 0, color: [1, 0.9, 0.75], alpha: 1 });
    for (let i = 0; i < 6 * k; i++) g.fx.dust.emit({ pos: pt.clone(), vel: _e.set(rand(-1, 1), rand(0, 1), rand(-1, 1)).normalize().multiplyScalar(rand(2, 5)).clone(), size: rand(0.3, 0.7), grow: 1.3, life: rand(0.3, 0.6), drag: 2.2, color: [0.8, 0.75, 0.68], alpha: 0.4 });
    g.camera.addTrauma(0.1 * k); g.camera.kick(0.012 * k); g.sfx.hit(k > 1.3);
  },

  // ============================================================================================== input
  keyDown(code) { if (code === 'KeyE') this.startClaw(); },
  keyUp() {},
  mouseDown() { this.lmbHeld = true; this.tryBite(); },
  mouseUp() { this.lmbHeld = false; },

  // ============================================================================================== LMB: bite
  /** point the body at the target: yaw always, and in the water the pitch of the body too (a diving / climbing lunge) */
  trackTarget(a, origin) {
    const sw = this.mode === 'swim', t = a.target && !a.target.dead && !a.target.held ? a.target : null;
    if (t) {
      this.foeBody(t, origin, _n); const dx = _n.x - this.pos.x, dz = _n.z - this.pos.z, hd = Math.hypot(dx, dz); if (hd > 0.12) a.faceYaw = atan2(dx, dz);
      if (sw) { const c = this.centre, el = atan2(_n.y - c.y, Math.max(hd, 0.25)); a.tiltTo = clamp(PI / 2 - el, 0.25, 2.9); }
    } else if (a.prop && !a.prop.dead && !a.prop.held) {
      this.propPoint(a.prop, origin, _n); const dx = _n.x - this.pos.x, dz = _n.z - this.pos.z, hd = Math.hypot(dx, dz); if (hd > 0.12) a.faceYaw = atan2(dx, dz);
      if (sw) { const c = this.centre, el = atan2(_n.y - c.y, Math.max(hd, 0.25)); a.tiltTo = clamp(PI / 2 - el, 0.25, 2.9); }
    } else {
      a.faceYaw = this.aimYaw(); if (sw) { const ad = this.aimDir3(_c); a.tiltTo = clamp(PI / 2 - Math.asin(clamp(ad.y, -1, 1)), 0.25, 2.9); }
    }
  },
  tryBite() {
    if (this.cd.lmb > 0 || this.mode === 'crouch') return; const cur = this.act; if (cur && !(cur.kind === 'claw' && cur.stage === 'recover')) return;
    if (cur) this.endAct(); const sw = this.mode === 'swim', a = this.beginAct('bite', { speedMul: sw ? 0.55 : 0.55 }); this.cd.lmb = RJ_CD.lmb; this.stats.bites++;
    const mouth = this.mouthPos(_m); a.target = this.pickTarget(mouth, 3.7, 0.15, !sw);
    a.dip = 0; if (!a.target) { a.prop = this.pickProp(mouth, sw ? 3.4 : 3.0, !sw); if (a.prop && !sw) { const top = a.prop.pos.y + a.prop.size.h; a.dip = clamp((mouth.y - 0.1 - (top + 0.45)) / 0.75, 0, 1); } }
    a.windT = 0.11; a.lungeT = 0.16; a.snapT = 0.09; a.recT = 0.30; a.faceK = sw ? 20 : 24; this.trackTarget(a, mouth); this.g.sfx._tone && this.g.sfx._tone('sawtooth', 200, 120, 0.12, 0.12);
  },
  /** the lunge velocity that carries the mouth to the target's surface by the end of the lunge (capped: a lunge is short - a far target is simply missed) */
  lungeVec(a, out, left) {
    const sw = this.mode === 'swim', cap = sw ? 11.5 : 10.5, m = this.mouthPos(_m), t = a.target && !a.target.dead && !a.target.held ? a.target : null;
    if (t) { this.foeBody(t, m, _n); out.copy(_n).sub(m); if (!sw) out.y = 0; const L = out.length(); if (L > 1e-4) out.multiplyScalar(Math.min(cap, Math.max(0, L - 0.4) / Math.max(left, 0.05)) / L); else out.set(0, 0, 0); }
    else if (a.prop && !a.prop.dead && !a.prop.held) { this.propPoint(a.prop, m, _n); out.copy(_n).sub(m); if (!sw) out.y = 0; const L = out.length(); if (L > 1e-4) out.multiplyScalar(Math.min(cap, Math.max(0, L - 0.3) / Math.max(left, 0.05)) / L); else out.set(0, 0, 0); }
    else { if (sw) this.aimDir3(out); else out.set(sin(a.faceYaw), 0, cos(a.faceYaw)); out.multiplyScalar(sw ? 7 : 8); }
    return out;
  },
  updateBite(dt, a) {
    this.stageTime(a, dt); const g = this.g, sw = this.mode === 'swim', mouth = this.mouthPos(_m);
    if (a.stage === 'wind' || a.stage === 'lunge') this.trackTarget(a, mouth);
    if (a.stage === 'wind') {
      if (a.st >= a.windT) { this.setStage(a, 'lunge'); if (sw) a.moveVel3 = new THREE.Vector3(); else a.moveVel = { x: 0, z: 0 }; this.steer(a); sw ? g.sfx.swish(0.12) : g.sfx.whoosh(); }
    } else if (a.stage === 'lunge') {
      this.steer(a); if (a.st >= a.lungeT * 0.45) this.biteContacts(a);
      if (a.st >= a.lungeT) { this.setStage(a, 'snap'); this.stopLunge(a); g.sfx.chomp(sw ? 0.3 : 0.45); this.biteContacts(a); }
    } else if (a.stage === 'snap') {
      this.biteContacts(a); if (a.st >= a.snapT) { if (!a.hit.size) this.biteWhiff(a); this.setStage(a, 'recover'); }
    } else if (a.st >= a.recT * (a.hit.size ? 1 : 1.25)) this.endAct();
  },
  steer(a) { const v = this.lungeVec(a, _b, a.lungeT - a.st); if (a.moveVel3) a.moveVel3.copy(v); else if (a.moveVel) { a.moveVel.x = v.x; a.moveVel.z = v.z; } },
  stopLunge(a) { a.moveVel = null; if (a.moveVel3) { this.vel.copy(a.moveVel3).multiplyScalar(0.3); a.moveVel3 = null; } else { this.vel.x *= 0.2; this.vel.z *= 0.2; } },
  /** the jaws close on whatever is inside the mouth spheres: enemies first, then props (chomp), nothing else */
  biteContacts(a) {
    const g = this.g, m = this.mouthPos(_a).clone(), j = this.jawPos(_b).clone(), sw = this.mode === 'swim', wet = this.isWet(m); let n = 0;
    for (const h of g.world.hittables) {
      if (h.dead || h.held || h.possessed || a.hit.has(h) || (h.kind !== 'dummy' && h.kind !== 'diver')) continue;
      const d1 = this.foeBody(h, m, _d) - 0.58; let pt = null; if (d1 <= 0) pt = _d.clone(); else { const d2 = this.foeBody(h, j, _e) - 0.45; if (d2 <= 0) pt = _e.clone(); }
      if (!pt) continue; a.hit.add(h); n++;
      const dir = this.foeCentre(h, _c).sub(this.centre); if (!sw) dir.y = 0; if (dir.lengthSq() < 1e-4) dir.set(sin(a.faceYaw), 0, cos(a.faceYaw)); dir.normalize();
      this.hurtFoe(h, pt, dir, 34 * (sw ? 1.1 : 0.85), sw ? 3.2 : 6.5, sw ? {} : { launch: 0.7, tilt: 2 }); this.hitFX(pt, 1.1, wet);
    }
    for (const p of g.props.props) {
      if (p.dead || p.held || p.temp || a.hit.has(p) || !(this.touchProp(p, m, 0.6) || this.touchProp(p, j, 0.45))) continue; a.hit.add(p);
      const dir = _c.set(p.pos.x - this.pos.x, 0, p.pos.z - this.pos.z); if (dir.lengthSq() < 1e-4) dir.set(sin(a.faceYaw), 0, cos(a.faceYaw)); dir.normalize();
      if (this.chompProp(p, 34 * (sw ? 1.1 : 0.85), m.clone(), dir.clone(), wet)) n++; else if (!a.clinked) { a.clinked = true; this.clink(m.clone(), wet); }
    }
    if (!n && !a.clinked) { const w = g.props.nearestWall(this.pos, a.faceYaw, 2.6); if (w && this.boxAt(m, 0.45)) { a.clinked = true; this.clink(m.clone(), wet); } }
    return n;
  },
  biteWhiff() { this.mode === 'swim' ? this.g.sfx.swish(0.08) : this.g.sfx.whoosh(); },

  // ============================================================================================== E: claw swipe (alternating left / right arm)
  startClaw() {
    if (this.mode === 'crouch') return; const cur = this.act;
    if (cur && cur.kind === 'claw') { cur.queued = true; return; }
    if (cur && !(cur.kind === 'bite' && cur.stage === 'recover')) return; if (this.cd.e > 0) return;
    if (cur) this.endAct(); const a = this.beginAct('claw', { speedMul: 0.6 }); this.startSwipe(a, false);
  },
  startSwipe(a, chain) {
    a.side = this.clawIdx++ % 2 ? -1 : 1; a.limb = a.side > 0 ? 'UL' : 'UR'; a.windT = chain ? 0.07 : 0.11; a.swipeT = 0.12; a.recT = 0.22; a.queued = false; a.hit = new Set(); a.stage = 'start'; a.st = 0; a.clinked = false; a.prev = null;
    const sw = this.mode === 'swim', c = this.centre; a.target = this.pickTarget(c, 2.1, 0.1, !sw); a.faceK = 22; this.trackTarget(a, c); this.stats.claws++; sw ? this.g.sfx.swish(0.1) : this.g.sfx.whoosh();
  },
  updateClaw(dt, a) {
    this.stageTime(a, dt); const g = this.g, sw = this.mode === 'swim';
    if (a.stage === 'start' || a.stage === 'swipe') this.trackTarget(a, this.centre);
    if (a.stage === 'start') {
      if (a.st >= a.windT) {
        this.setStage(a, 'swipe'); const t = a.target && !a.target.dead && !a.target.held ? a.target : null; let sp = 3.0;
        if (t) { const hand = this.clawPos(a.side, _m); const d = this.foeBody(t, hand, _n); sp = clamp((d - 0.15) / a.swipeT, 0, 5.5); }
        const dir = sw ? this.aimDir3(_b) : _b.set(sin(a.faceYaw), 0, cos(a.faceYaw)); if (t) { this.foeCentre(t, _b).sub(this.centre); if (!sw) _b.y = 0; _b.normalize(); }
        if (sw) { a.moveVel3 = new THREE.Vector3().copy(_b).multiplyScalar(sp); } else a.moveVel = { x: _b.x * sp, z: _b.z * sp }; void dir;
      }
    } else if (a.stage === 'swipe') {
      this.clawContacts(a); if (a.st >= a.swipeT) { this.setStage(a, 'recover'); if (a.moveVel3) { this.vel.copy(a.moveVel3).multiplyScalar(0.3); a.moveVel3 = null; } a.moveVel = null; this.vel.x *= sw ? 1 : 0.3; this.vel.z *= sw ? 1 : 0.3; if (!a.hit.size) (sw ? g.sfx.swish(0.06) : g.sfx.whoosh()); }
    } else if (a.stage === 'recover') {
      if (a.queued && a.st > 0.05) { this.startSwipe(a, true); return; } if (a.st >= a.recT) this.endAct('e', a.hit.size ? 0.05 : 0.14);
    }
  },
  /** the swiping hand (and the stretch it swept since the last frame) physically touches an enemy / a weak prop */
  clawContacts(a) {
    const g = this.g, h0 = this.clawPos(a.side, _a).clone(), sw = this.mode === 'swim', wet = this.isWet(h0), mid = a.prev ? _b.copy(a.prev).add(h0).multiplyScalar(0.5).clone() : h0.clone(); a.prev = h0; let n = 0;
    for (const h of g.world.hittables) {
      if (h.dead || h.held || h.possessed || a.hit.has(h) || (h.kind !== 'dummy' && h.kind !== 'diver')) continue;
      let pt = null; if (this.foeBody(h, h0, _d) - 0.55 <= 0) pt = _d.clone(); else if (this.foeBody(h, mid, _e) - 0.5 <= 0) pt = _e.clone(); if (!pt) continue; a.hit.add(h); n++;
      const dir = this.foeCentre(h, _c).sub(this.centre); if (!sw) dir.y = 0; if (dir.lengthSq() < 1e-4) dir.set(sin(a.faceYaw), 0, cos(a.faceYaw)); dir.normalize();
      dir.addScaledVector(_e.set(cos(a.faceYaw), 0, -sin(a.faceYaw)), -a.side * 0.35).normalize();                  // the swipe carries the target sideways across the body
      this.hurtFoe(h, pt, dir, 16 * (sw ? 1.1 : 0.9), sw ? 1.8 : 4.5, sw ? {} : { launch: 0.35, tilt: 1.4 }); this.hitFX(pt, 0.8, wet); this.stats.clawHits++;
    }
    for (const p of g.props.props) {
      if (p.dead || p.held || p.temp || a.hit.has(p) || !(this.touchProp(p, h0, 0.5) || this.touchProp(p, mid, 0.45))) continue; a.hit.add(p);
      const dir = _c.set(p.pos.x - this.pos.x, 0, p.pos.z - this.pos.z); if (dir.lengthSq() < 1e-4) dir.set(sin(a.faceYaw), 0, cos(a.faceYaw)); dir.normalize();
      if (this.chompProp(p, 16, h0.clone(), dir.clone(), wet)) n++; else if (!a.clinked) { a.clinked = true; this.clink(h0.clone(), wet); }
    }
    return n;
  },

  // ============================================================================================== per frame
  updatePowers(dt, aimPoint) {
    for (const k in this.cd) if (this.cd[k] > 0) this.cd[k] = Math.max(0, this.cd[k] - dt); if (this.toastT > 0) this.toastT -= dt;
    const a = this.act; if (a) (a.kind === 'bite' ? this.updateBite : this.updateClaw).call(this, dt, a);
    if (!this.act && this.lmbHeld) this.tryBite();
    if (this.hintEl) {
      let txt = ''; if (this.mode === 'swim' && !this.act && this.L.waterY - (this.pos.y + 1.15) < 0.7 && this.vel.length() < 4) txt = 'SPACE — LEAP OUT OF THE WATER';
      if (txt !== this.hintTxt) { this.hintTxt = txt; this.hintEl.textContent = txt; this.hintEl.hidden = !txt; }
    }
    void aimPoint; void lerp;
  },
};
