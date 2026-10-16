// Cannonbolt's BALL FORM: a custom rigid-sphere simulation (the project has no physics engine). One sphere (radius BALL_R) with a real velocity, rolled by sub-stepped integration against:
//   - the ground plane, every world box (walls, crates, barriers, cars, steps ...), and the triangle soup of the new ramps / mound (closest point -> contact normal),
// with
//   - acceleration / friction / braking on the contact plane (so slopes pull the ball back and a faster ball climbs steeper ones),
//   - impact response from the surface normal and the closing speed (restitution per material + Coulomb friction -> straight hits rebound, angled hits ricochet, ramp hits launch, falls bounce by height),
//   - "magnet-ball" obstacle traversal: a low edge / step / curb / debris / low barrier is rolled UP and over when height, closing speed, recent traction and passenger load allow it
//     (the speed is redirected along the surface, not teleported). Nothing here sticks to walls or climbs tall structures.
//   - a visual spin that is the rolling-without-slipping rotation of the ACTUAL motion (omega = n x v_t / R), kept while airborne.
import * as THREE from 'three';
import { BALL_R } from '../animations/cannonboltrig.js';
import { clamp, damp, lerp, rand, smoothstep } from './util.js';

const V3 = THREE.Vector3, Q4 = THREE.Quaternion, UP = new V3(0, 1, 0);
const _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3(), _q = new Q4();
export const BALL = { R: BALL_R, mass: 220, g: 26, top: 19.5, topBoost: 31.5, acc: 16.5, accBoost: 23, accAir: 3.2, coast: 2.0, brake: 30, jump: 9.6, maxSpeed: 40, bounceMin: 3.4 };
const E0 = { ground: 0.58, concrete: 0.7, wood: 0.46, metal: 0.55, ramp: 0.45 }       // V30: livelier bounce (was 0.42 / 0.5 / 0.3 / 0.36 / 0.3)
const MU = { ground: 0.35, concrete: 0.3, wood: 0.5, metal: 0.28, ramp: 0.4 };   // V31 FIX: this declaration had been swallowed by the comment above -> ReferenceError on every bounce -> the frame loop threw before render = the game 'froze'

const surfOf = (p) => /crate|wood|bench|fence/.test(p.name || p.kind || '') ? 'wood' : /car|truck|dumpster|barrel|trash|light|robot/.test(p.kind || '') ? 'metal' : 'concrete';

export const cbBall = {
  initBall() {
    this.c = new V3(); this.v = new V3(); this.rollQ = new Q4(); this.omega = new V3(); this.sq = { k: 0, axis: new V3(0, 1, 0) }; this.gN = new V3(0, 1, 0);
    this.groundT = 9; this.wallT = 9; this.climbBox = null; this.climbT = 0; this._cl = []; this.imp = { speed: 0, t: 9 }; this.hitCd = new Map(); this.rollFx = { dust: 0, snd: 0, rumble: 0 };
    this.bs = { bounces: 0, ricochets: 0, climbs: 0, hops: 0, topSpeed: 0, impacts: 0, smashed: 0, enemiesHit: 0, maxAir: 0, wallHits: 0, jumps: 0, rolled: 0 };
    this.airPeak = 0; this.lastSpeedHit = 0;
  },
  /** current ball mass: the shell + everything inside it */
  ballMass() { let m = BALL.mass; for (const p of this.passengers) m += p.mass * 0.8; return m; },
  /** 0..1: how much of the carrying capacity is used (passengers make the ball slower to start, harder to bounce, harder to climb with) */
  passFrac() { let u = 0; for (const p of this.passengers) u += p.vol; return clamp(u / this.capacity, 0, 1); },
  get ballSpeed() { return this.v.length(); },
  get rolling() { return this.form === 'ball'; },

  // ============================================================================================== contacts
  surfaceE(s) { return E0[s] ?? 0.45; },
  /** all contacts of the sphere (centre c) with the world -> out [{ n, pen, surface, box?, ramp? }] */
  gather(c, R, out) {
    const w = this.g.world;
    const T = w.island && w.terrain;
    if (T) {                                       // V28 island: the ground is the terrain heightfield (contact normal from its slope)
      const e = 0.5, f = T.height(c.x, c.z); if (c.y - R < f + 0.6) { const gx = (T.height(c.x + e, c.z) - T.height(c.x - e, c.z)) / (2 * e), gz = (T.height(c.x, c.z + e) - T.height(c.x, c.z - e)) / (2 * e), iy = 1 / Math.sqrt(1 + gx * gx + gz * gz), d = (c.y - f) * iy;
        if (d < R) out.push({ n: iy > 0.999 ? UP : new V3(-gx * iy, iy, -gz * iy), pen: R - d, surface: 'ground', floor: true }); }
    } else if (c.y - R < 0) out.push({ n: UP, pen: R - c.y, surface: 'ground', floor: true });
    for (const b of w.boxes) {
      if (c.x < b.min.x - R || c.x > b.max.x + R || c.y < b.min.y - R || c.y > b.max.y + R || c.z < b.min.z - R || c.z > b.max.z + R) continue;
      const dx = c.x - clamp(c.x, b.min.x, b.max.x), dy = c.y - clamp(c.y, b.min.y, b.max.y), dz = c.z - clamp(c.z, b.min.z, b.max.z), d2 = dx * dx + dy * dy + dz * dz; if (d2 >= R * R) continue;
      let n, pen;
      if (d2 > 1e-9) { const d = Math.sqrt(d2); n = new V3(dx / d, dy / d, dz / d); pen = R - d; }
      else { const fs = [[c.x - b.min.x, -1, 0, 0], [b.max.x - c.x, 1, 0, 0], [c.y - b.min.y, 0, -1, 0], [b.max.y - c.y, 0, 1, 0], [c.z - b.min.z, 0, 0, -1], [b.max.z - c.z, 0, 0, 1]]; let f = fs[0]; for (const q of fs) if (q[0] < f[0]) f = q; n = new V3(f[1], f[2], f[3]); pen = f[0] + R; }
      out.push({ n, pen, box: b, surface: b.prop ? surfOf(b.prop) : 'concrete', edge: (dx !== 0) + (dy !== 0) + (dz !== 0) });
    }
    for (const rp of w.ramps) rp.sphereHits(c, R, out);
    for (const ct of out) if (ct.ramp) ct.surface = 'ramp';
  },
  /** height of the ball's lowest point above the ground / platform directly below it (for the spawn + unroll checks) */
  // ============================================================================================== one frame of ball physics
  ballStep(dt, input, want, hasInput) {
    const R = BALL.R, w = this.g.world, M = this.ballMass(), pf = this.passFrac(), v = this.v, c = this.c;
    const sp0 = v.length(), n = clamp(Math.ceil(sp0 * dt / (0.35 * R)), 1, 12), h = dt / n;
    this.climbT = Math.max(0, this.climbT - dt); this.groundT += dt; this.wallT += dt; this.imp.t += dt;
    let touchedGround = false;
    for (let i = 0; i < n; i++) {
      this.driveStep(h, input, want, hasInput, pf, M);
      v.y -= BALL.g * h; c.addScaledVector(v, h);
      if (this.collide(h, pf, M)) touchedGround = true;
      if (this.climbT > 0 && this.climbVy && v.y > this.climbVy && !this.jumpedT) v.y = this.climbVy;       // a climb never launches the ball more than the obstacle needs
      const lg = w.lagoon; if (lg && lg.inRect(c.x, c.z, R + 0.2) && c.y - R < 1.2) { _a.copy(c); lg.keepOut(_a, R); const dx = _a.x - c.x, dz = _a.z - c.z; if (dx || dz) { _b.set(dx, 0, dz).normalize(); const vn = v.dot(_b); if (vn < 0) v.addScaledVector(_b, -vn * 1.3); c.x = _a.x; c.z = _a.z; } }
    }
    if (touchedGround) this.groundT = 0;
    { const T = w.island && w.terrain, f = T ? T.height(c.x, c.z) : 0; if (c.y < f - 4) { c.y = f + BALL.R + 0.1; v.set(0, 0, 0); } }                                           // safety net: never fall out of the world
    if (!(isFinite(v.x + v.y + v.z + c.x + c.y + c.z))) { const T0 = w.island && w.terrain; v.set(0, 0, 0); if (!isFinite(c.x + c.y + c.z)) c.set(this.pos.x, (T0 ? T0.height(this.pos.x, this.pos.z) : 0) + BALL.R + 0.3, this.pos.z); }   // V31: never let NaN / Infinity poison the sim
    if (v.y < -60) v.y = -60;
    const sp = v.length(); if (sp > BALL.maxSpeed) v.multiplyScalar(BALL.maxSpeed / sp);
    this.bs.topSpeed = Math.max(this.bs.topSpeed, sp); this.bs.rolled += sp * dt;
    this.grounded = this.groundT < 0.05; this.airPeak = this.grounded ? 0 : Math.max(this.airPeak, c.y - R); this.bs.maxAir = Math.max(this.bs.maxAir, this.airPeak);
    // Space: rolling jump (needs the ground under the ball: no double jump, no hover; the horizontal momentum is kept)
    if (input.jump && this.groundT < 0.1 && this.form === 'ball') {
      const jv = BALL.jump / Math.sqrt(1 + 0.5 * pf); const vn = v.dot(this.gN); if (this.gN.y > 0.4) { v.addScaledVector(this.gN, Math.max(0, jv - Math.max(0, vn))); if (v.y < jv * 0.8) v.y = jv * 0.8 + Math.max(0, v.y); }
      this.groundT = 9; this.grounded = false; this.bs.jumps++; this.sq.k = Math.max(this.sq.k, -0.12); this.sq.axis.copy(this.gN); this.g.sfx.whoosh && this.g.sfx.whoosh(); this.puffAt(_a.set(c.x, c.y - R, c.z), 6, 3);
    }
  },
  /** acceleration, rolling resistance, braking, air control */
  driveStep(h, input, want, hasInput, pf, M) {
    const v = this.v, sprint = input.run, top = sprint ? BALL.topBoost : BALL.top, mf = 1 / (1 + 0.8 * pf), gN = this.groundT < 0.07 ? this.gN : null;
    if (gN) {
      const t = _a.copy(v).addScaledVector(gN, -v.dot(gN)), hs = t.length();
      if (hasInput && !input.down) {
        const d = _b.copy(want).addScaledVector(gN, -want.dot(gN)); if (d.lengthSq() > 1e-6) d.normalize();
        const vd = hs > 0.2 ? t.dot(want) : 0, aMax = (sprint ? BALL.accBoost : BALL.acc) * mf * clamp(gN.y, 0.25, 1);
        if (vd < top) { const f = 1 - 0.65 * clamp(vd / top, 0, 1) ** 2; v.addScaledVector(d, aMax * Math.max(0.2, f) * h); }
        if (hs > 1) { _c.copy(d).addScaledVector(t, -d.dot(t) / (hs * hs)); v.addScaledVector(_c, aMax * 0.9 * h); }               // steering: sideways thrust, so the turn radius grows with speed
      }
      let dec = hasInput ? 0.5 : BALL.coast; if (hs > top * 1.03) dec += 2.2 * (hs / top - 1) * 4;
      if (input.down) dec = BALL.brake * (1 + 0.4 * pf);
      if (hs > 1e-4) { const nh = Math.max(0, hs - dec * h) / hs; _c.copy(t).multiplyScalar(nh - 1); v.add(_c); }
      if (!hasInput && !input.down && hs < 0.05 && gN.y > 0.9) { v.x = v.z = 0; }
    } else {
      if (hasInput) { const hs = Math.hypot(v.x, v.z); if (hs < top) { v.x += want.x * BALL.accAir * h; v.z += want.z * BALL.accAir * h; } }
      const k = Math.exp(-0.04 * h); v.x *= k; v.z *= k;
    }
  },
  /** resolve penetrations + velocity. Returns true when the ball is resting on / rolling over something walkable. */
  collide(h, pf, M) {
    const R = BALL.R, c = this.c, list = this._cl; let ground = false;
    for (let pass = 0; pass < 3; pass++) {
      list.length = 0; this.gather(c, R, list); if (!list.length) break;
      let ct = list[0]; for (const q of list) if (q.pen > ct.pen) ct = q;
      if (ct.pen < 1e-5) break;
      if (this.resolve(ct, h, pf, M)) ground = true;
    }
    return ground;
  },
  resolve(ct, h, pf, M) {
    const v = this.v, c = this.c, n = ct.n, R = BALL.R; let closing = -v.dot(n);
    if (ct.box && this.climbT > 0 && this.climbBox === ct.box && n.y < 0.6 && (c.y - R) < ct.box.max.y - 0.02) return false;      // hopping onto this box: its side face does not stop the hop
    // ---- things that break / move / take damage
    if (ct.box && closing > 0.4) {
      if (ct.box.prop) { const r = this.hitProp(ct, closing, pf, M); if (r === 'pass') return false; }
      else if (ct.box.wall) this.hitWall(ct, closing);
    }
    // ---- magnet-ball traversal
    if (ct.box && closing > 0.4) { const t = this.tryClimb(ct, closing, pf); if (t === 'hop') return false; if (t === 'edge') { c.addScaledVector(n, ct.pen); if (this.climbVy && v.y > this.climbVy) v.y = this.climbVy; this.groundT = 0.04; this.gN.copy(UP); return true; } }
    c.addScaledVector(n, ct.pen);
    closing = -v.dot(n);
    if (closing > 0) {
      if (closing > BALL.bounceMin) {
        const sp = v.length(), e0 = this.surfaceE(ct.surface), e = e0 * (1 - 0.25 * smoothstep(8, 24, closing)) * (1 - 0.3 * pf),
          mu = MU[ct.surface] ?? 0.3;
        v.addScaledVector(n, closing * (1 + e));
        const vn = v.dot(n); _a.copy(v).addScaledVector(n, -vn); const tl = _a.length();
        if (tl > 1e-3) { const k = Math.max(0.4, 1 - mu * (1 + e) * closing / tl); v.copy(_b.copy(n).multiplyScalar(vn)).addScaledVector(_a, k); }
        this.registerImpact(ct, closing, e, sp);
      } else v.addScaledVector(n, closing);
    }
    if (n.y > 0.45) { this.gN.copy(n); return v.dot(n) < 2.2; }
    this.wallT = 0; return false;
  },
  registerImpact(ct, closing, e, spBefore) {
    const g = this.g, R = BALL.R, p = _d.copy(this.c).addScaledVector(ct.n, -R), floor = ct.n.y > 0.7, ang = Math.acos(clamp(closing / Math.max(spBefore, 1e-3), 0, 1));
    this.imp.speed = closing; this.imp.t = 0; this.bs.impacts++; this.lastSpeedHit = spBefore;
    if (floor) this.bs.bounces++; else { this.bs.wallHits++; if (ang > 0.5 && spBefore > 8) this.bs.ricochets++; }
    this.sq.k = Math.max(this.sq.k, clamp(closing / 26, 0.04, 0.3)); this.sq.axis.copy(ct.n);
    g.camera.addTrauma(clamp((closing - 6) / 40, 0, 0.2) * (floor ? 0.6 : 1));
    if (closing > 5) g.sfx.thud(clamp(closing / 24, 0.15, 0.8));
    this.puffAt(p, clamp(closing * 0.8, 3, 14) | 0, clamp(closing * 0.3, 2, 6));
    if (closing > 9) g.props.debris.burst(p.clone(), Math.round(clamp(closing * 0.5, 3, 10)), 4 + closing * 0.25, 0.08, 0x9a968c);
    this.ricochetDir = ang > 0.5 ? 1 : 0;
  },
  puffAt(p, n, sp) { const fx = this.g.fx.dust; for (let i = 0; i < n; i++) { const a = rand(0, 6.28); fx.emit({ pos: p, vel: _c.set(Math.cos(a) * rand(0.4, 1) * sp, rand(0.3, 1.4), Math.sin(a) * rand(0.4, 1) * sp), size: rand(0.25, 0.6), life: rand(0.4, 0.8), drag: 2.2, grav: 0.4, color: [0.7, 0.67, 0.6], alpha: 0.5 }); } },

  // ============================================================================================== traversal ("magnet-ball feel": physical, speed-based, no teleport)
  /** a box face / edge in front of the rolling ball: roll up over it if the height, closing speed, traction and load allow. 'hop' = tall face (ballistic hop, no push-back), 'edge' = low edge (velocity redirected along the surface) */
  tryClimb(ct, closing, pf) {
    const b = ct.box, v = this.v, c = this.c, R = BALL.R, n = ct.n;
    if (this.form !== 'ball' || n.y > 0.9) return false;
    if (this.climbT > 0 && this.climbBox === b) return n.y < 0.45 ? 'hop' : 'edge';       // already climbing this one: no second kick
    if (this.groundT > 0.3) return false;
    const rise = b.max.y - (c.y - R); if (rise < 0.03) return false;
    const nh = Math.hypot(n.x, n.z); if (nh < 0.2) return false;
    const vin = -(v.x * n.x + v.z * n.z) / nh, hs = Math.hypot(v.x, v.z); if (vin < 2.0 || vin < 0.35 * hs) return false;
    const maxRise = R * (0.25 + 0.85 * clamp((vin - 3) / 11, 0, 1)) / (1 + 0.35 * pf);
    if (rise > maxRise) return false;
    this.bs.climbs++; this.climbBox = b; this.climbT = 0.22;
    if (n.y < 0.45) {                       // a face taller than the centre line: hop up it, keep most of the forward speed
      const vyReq = Math.sqrt(2 * BALL.g * (rise + 0.14 * R)); if ((0.9 * hs) ** 2 + vyReq * vyReq > (1.12 * hs) ** 2) return false;
      v.y = Math.max(v.y, vyReq); this.climbVy = vyReq * 1.05; v.x *= 0.92; v.z *= 0.92; this.bs.hops++; this.sq.k = Math.max(this.sq.k, 0.06); this.sq.axis.copy(n); return 'hop';
    }
    // a low edge / kerb: the ball rolls up over it - it keeps ~95% of its forward speed and gets only the lift needed to clear the edge (no launch off a kerb)
    const vyReq = Math.sqrt(2 * BALL.g * rise * 0.9); v.x *= 0.95; v.z *= 0.95; if (v.y < vyReq) v.y = vyReq; this.climbVy = vyReq; this.bs.edges = (this.bs.edges || 0) + 1; return 'edge';
  },

  // ============================================================================================== props + walls under the ball
  hitProp(ct, closing, pf, M) {
    const p = ct.box.prop, g = this.g, P = g.props, sp = this.v.length(); if (p.dead || p.held) return 'pass';
    const KE = 0.5 * M * closing * closing, fragile = p.hp <= 120 && p.mass < 120 && p.cat !== 'vehicle';
    const dir = _a.set(-ct.n.x, 0, -ct.n.z); if (dir.lengthSq() > 1e-4) dir.normalize();
    if (fragile && closing > 3 && sp > 7.5) {                                              // wooden crates, fences, benches, bins, barrels: the ball smashes through them
      P.hurt(p, KE / 120, dir); this.stats.smashed++; this.bs.smashed++; if (p.dead) { this.v.multiplyScalar(0.94); g.sfx.crash(0.35); g.camera.addTrauma(0.08); return 'pass'; }
    }
    if (p.planted) { P.hurt(p, KE / 400, dir); return false; }
    if (p.cat !== 'vehicle' && p.mass < 0.12 * M && sp > 4.5) return false;           // a pebble / bit of debris: rolled over by the climb logic, not pushed
    // momentum exchange along the contact normal
    const mp = p.mass, e = 0.2, j = (1 + e) * closing / (1 / M + 1 / mp);
    if (closing > 1.5) {
      P.removeBox(p); p.state = 'fly'; p.vel.x -= ct.n.x * j / mp; p.vel.z -= ct.n.z * j / mp; p.vel.y = Math.max(p.vel.y, Math.min(4, j / mp * 0.2)); p.hit.clear(); p.dmgMul = 0.5; p.spin.set(rand(-2, 2), rand(-2, 2), rand(-2, 2));
      this.v.x += ct.n.x * (j / M); this.v.z += ct.n.z * (j / M);              // the ball gives up momentum
      if (closing > 5) { P.hurt(p, KE / 700 * (p.cat === 'vehicle' ? 0.8 : 1.4), dir); P.impactFX(ct.n.clone().multiplyScalar(-BALL.R).add(this.c), clamp(closing / 14, 0.4, 1.4), p.debris); g.sfx.hit(false); }
    }
    return false;
  },
  hitWall(ct, closing) {
    const w = ct.box.wall; if (!w || !w.alive || closing < 6.5) return; const P = this.g.props, M = this.ballMass(), KE = 0.5 * M * closing * closing;
    P.damageWall(w, KE / 250, _a.copy(this.c).addScaledVector(ct.n, -BALL.R).clone(), _b.set(-ct.n.x, 0, -ct.n.z).normalize().clone()); this.bs.smashed++;
  },

  // ============================================================================================== visuals: rolling spin, squash, dust
  updateBallVisual(dt, input) {
    const R = BALL.R, v = this.v, grounded = this.groundT < 0.08, g = this.g;
    // rolling without slipping on whatever the ball touches: omega = n x v_t / R. Airborne: the spin is kept (angular momentum), a wall contact adds a little.
    if (grounded) {
      const n = this.gN; _a.copy(v).addScaledVector(n, -v.dot(n)); _b.copy(n).cross(_a).multiplyScalar(1 / R); if (input.down) _b.multiplyScalar(0.35);
      this.omega.lerp(_b, 1 - Math.exp(-(input.down ? 6 : 16) * dt));
    } else this.omega.multiplyScalar(Math.exp(-0.12 * dt));
    const ang = this.omega.length() * dt; if (ang > 1e-6) { _q.setFromAxisAngle(_a.copy(this.omega).normalize(), ang); this.rollQ.premultiply(_q).normalize(); }
    this.spinG.quaternion.copy(this.rollQ);
    // squash on impacts, a little stretch along the travel at speed, a gulp when capturing
    this.sq.k = this.sq.k > 0 ? damp(this.sq.k, 0, 11, dt) : damp(this.sq.k, 0, 9, dt);
    const sp = v.length(); let k = this.sq.k, axis = this.sq.axis;
    if (Math.abs(k) < 0.02 && sp > 6) { k = -0.05 * smoothstep(6, 21, sp); axis = _a.copy(v).normalize(); }
    this.squashG.quaternion.setFromUnitVectors(UP, axis); const cap = this.capK ? 0.1 * Math.sin(Math.PI * this.capK) : 0, ls = 1 + cap;
    this.squashG.scale.set((1 + k * 0.5) * ls, (1 - k) * ls, (1 + k * 0.5) * ls);
    const pn = this.passengers.length; this.carryT = (this.carryT || 0) + dt * (2 + sp * 0.2); this.rig.ball.inner.position.set(Math.sin(this.carryT * 1.3) * 0.025 * pn, Math.sin(this.carryT) * 0.03 * pn, Math.cos(this.carryT * 0.9) * 0.025 * pn);
    // ground particles + trail + speed sounds
    const F = this.rollFx;
    if (grounded && sp > 5) {
      F.dust -= dt; if (F.dust <= 0) { F.dust = clamp(0.09 - sp * 0.003, 0.025, 0.09); const k2 = smoothstep(5, 22, sp), back = _c.copy(v).normalize().multiplyScalar(-1);
        g.fx.dust.emit({ pos: _a.set(this.c.x, this.c.y - R + 0.1, this.c.z).addScaledVector(back, 0.4), vel: _b.copy(back).multiplyScalar(rand(0.5, 2.5) * (0.4 + k2)).add(_d.set(rand(-0.5, 0.5), rand(0.3, 1.2), rand(-0.5, 0.5))), size: rand(0.2, 0.45) * (0.7 + k2), life: rand(0.4, 0.8), drag: 2.4, grav: 0.2, color: [0.72, 0.69, 0.62], alpha: 0.35 + 0.25 * k2 });
        if (input.down && sp > 6) for (let i = 0; i < 3; i++) g.fx.glow.emit({ pos: _a, vel: _b.set(rand(-1, 1), rand(0.5, 2), rand(-1, 1)), size: rand(0.05, 0.1), life: 0.22, drag: 1.5, color: [1, 0.85, 0.5] }); }
      F.rumble -= dt; if (F.rumble <= 0) { F.rumble = 0.16; g.sfx.engine && g.sfx.engine(0.012 + 0.03 * smoothstep(5, 22, sp), 38 + sp * 3); }
    }
  },
};
