// Kevin 11 procedural animation. The GLB has no clips, so every state is synthesised on top of the generated rig (animations/kevinrig.js):
// FK euler deltas (model space) for torso / head / wings / tail / feet and two-bone IK for the four arms and two legs.
// Layers:  locomotion (idle / combat stance / walk / run / super-speed run / flight)  ->  action (punches, projectiles, goo, dodge, takeoff, landing)  ->  reaction (flinch, stagger, fall, lie, get up, defeat)
// Blend weights are smoothed every frame, so every transition is continuous (no pose pops, no frozen wings / tail / extra arms: the wings always breathe, the tail always trails).
import * as THREE from 'three';
import { KvPoser, KV_SCALE, KV_SIZE } from './kevinrig.js';

const S = KV_SCALE, V = (x, y, z) => new THREE.Vector3(x, y, z), mu = (x, y, z) => new THREE.Vector3(x * S, y * S, z * S);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x)), lerp = (a, b, t) => a + (b - a) * t, damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const sm = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }, eo = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3), ei = t => { t = clamp(t, 0, 1); return t * t * t; }, eio = t => { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };

// rest wrists, chest-relative (mu)
const REST = { BL: [0.92, -0.01, 0.45], BR: [-0.80, -0.04, 0.45], SL: [0.58, -0.44, 0.17], SR: [-0.58, -0.44, 0.17] };
const POLE = { BL: V(0.6, -0.6, -0.4), BR: V(-0.6, -0.6, -0.4), SL: V(0.5, -0.8, -0.3), SR: V(-0.5, -0.8, -0.3) };

/** attack definitions: which arm, where the fist is when wound up / at full extension, torso twist, lunge */
export const ATTACKS = {
  punch:   { arm: 'S', back: [0.42, -0.02, 0.02], out: [0.16, 0.0, 0.80], twist: 0.55, lunge: 0.16, lean: 0.20 },
  heavy:   { arm: 'SS', back: [0.22, 0.60, -0.02], out: [0.18, -0.22, 0.78], twist: 0.0, lunge: 0.28, lean: 0.55 },
  crystal: { arm: 'BR', back: [-0.62, 0.14, -0.10], out: [-0.20, 0.0, 0.86], twist: 0.5, lunge: 0.2, lean: 0.25 },
  fire:    { arm: 'BL', back: [0.62, 0.14, -0.10], out: [0.20, 0.0, 0.86], twist: 0.5, lunge: 0.2, lean: 0.25 },
  rush:    { arm: 'S', back: [0.48, -0.14, -0.10], out: [0.12, -0.02, 0.82], twist: 0.7, lunge: 0.34, lean: 0.62 },
};

export class KevinAnim {
  constructor(rig) {
    this.rig = rig; this.poser = new KvPoser(rig); this.t = 0; this.ph = 0; this.gait = 0; this.run = 0; this.rush = 0; this.fly = 0; this.combat = 0; this.wing = 0; this.flap = 0; this.flapPh = 0;
    this.tailT = 0; this.flinch = 0; this.flinchDir = 1; this.turn = 0; this.reactW = 0; this.alt = 0; this.mouthOpen = 0; this.look = 0; this.lastPose = null; this.stepFlag = 0; this.lean = 0;
    this.sprintPose = 0; this.fall = 0; this.hurtT = 0; this.limp = 0; this.dead = 0;
  }
  /** s: { speed, run 0..1, rush 0..1, fly 0..1, flapRate, combat 0..1, act, react:{state,theta,tier,getT,getMax,downT,stateT,lean}, turn, vy, onGround, dead } */
  update(dt, s) {
    this.t += dt; const t = this.t, d = {}, ik = {}, legs = {}, off = [0, 0, 0];
    const add = (k, x, y, z, w = 1) => { const e = d[k] || (d[k] = [0, 0, 0]); e[0] += x * w; e[1] += y * w; e[2] += z * w; };
    const aim = (k, v, w) => { const cur = ik[k] || { p: mu(...REST[k]), pole: POLE[k].clone() }; if (!ik[k]) ik[k] = cur; cur.p.lerp(v, clamp(w, 0, 1)); };
    const aimMu = (k, a, w) => aim(k, mu(a[0], a[1], a[2]), w);
    // ---------------------------------------------------------------- smoothed blend values
    const speed = s.speed || 0; this.gait = damp(this.gait, clamp(speed / 1.2, 0, 1), 8, dt); this.run = damp(this.run, s.run || 0, 6, dt); this.rush = damp(this.rush, s.rush || 0, 9, dt);
    this.fly = damp(this.fly, s.fly || 0, 5, dt); this.combat = damp(this.combat, s.combat || 0, 4, dt); this.turn = damp(this.turn, s.turn || 0, 6, dt);
    const gm = this.gait * (1 - this.fly), run = this.run, rush = this.rush, fly = this.fly;
    const strideRate = lerp(lerp(speed / (1.7 * KV_SIZE), speed / (2.7 * KV_SIZE), run), speed / (3.4 * KV_SIZE), rush);       // a bigger body takes longer strides (same feet-on-ground rhythm)               // cycles per second ~ speed / metres per cycle
    this.ph += dt * Math.PI * 2 * strideRate; const ph = this.ph, sp = Math.sin(ph), cp = Math.cos(ph);
    const react = s.react || { state: 'ok', theta: 0 }, rs = react.state, down = rs === 'fall' || rs === 'down' || rs === 'getup' || rs === 'air' || s.dead;
    const act = s.act, atkW = act ? act.w : 0;                                                      // 0..1 action weight (set by the AI)
    // ---------------------------------------------------------------- locomotion: spine / head
    const breathe = Math.sin(t * 1.9) * 0.012, sway = Math.sin(t * 0.8);
    const lean = lerp(lerp(0.04, 0.16, run), 0.5, rush) * gm + 0.55 * fly + this.combat * 0.07;
    add('hips', lean * 0.2, 0, 0); add('spine', lean * 0.3 + breathe, -sp * 0.10 * gm * (1 + run), 0); add('chest', lean * 0.4 + breathe, sp * 0.14 * gm * (1 + run) - this.turn * 0.12, -this.turn * 0.1 * gm); add('neck', -lean * 0.4, -sp * 0.06 * gm, 0); add('head', -lean * 0.3 + Math.sin(t * 0.6) * 0.02, sway * 0.03 * (1 - this.combat), 0);
    off[1] = -Math.abs(sp) * 0.035 * gm * (1 + run) - this.combat * 0.04 - rush * 0.05; off[2] = lean * 0.14;
    // ---------------------------------------------------------------- locomotion: legs (IK feet)
    const amp = lerp(lerp(0.12, 0.26, run), 0.36, rush) * gm, lift = lerp(lerp(0.09, 0.15, run), 0.16, rush) * gm, wide = 0.255 * (1 + this.combat * 0.08);
    const foot = (side, phase) => {
      const sn = Math.sin(phase), cs = Math.cos(phase), swing = cs > 0 ? 1 : 0;
      const z = 0.04 + sn * amp * (cs > 0 ? 1 : 1), y = 0.17 + Math.max(0, cs) * lift;
      const idleShift = (1 - gm) * this.combat * (side > 0 ? 0.05 : -0.1);                          // combat stance: one foot forward
      const flyP = { x: wide * 0.85, y: 0.34 + 0.04 * Math.sin(t * 5 + side), z: -0.20 + 0.05 * Math.sin(t * 4 + side) };
      const gp = { x: wide, y, z: z + idleShift };
      return { p: mu(side * lerp(gp.x, flyP.x, fly), lerp(gp.y, flyP.y, fly), lerp(gp.z, flyP.z, fly)), pole: V(side * 0.15, 0, 1), pitch: lerp(swing * Math.max(0, cs) * 0.5 * gm, 0.55, fly), toe: swing * 0.25 * gm * Math.max(0, cs) };
    };
    legs.L = foot(1, ph); legs.R = foot(-1, ph + Math.PI);
    // ---------------------------------------------------------------- locomotion: arms
    // ordinary arms: swing when walking, fists up in combat; big arms: carried forward-out, a little sway; both raise to a guard in combat
    const gS = this.combat;
    const swingS = sp * 0.34 * gm * (1 + run * 0.8) * (1 - gS * 0.6);
    aimMu('SL', [lerp(REST.SL[0], 0.40, gS), lerp(REST.SL[1], -0.06, gS), lerp(REST.SL[2], 0.52, gS) + swingS * 0.6], 1); ik.SL.pole = V(0.5, -0.8, -0.3);
    aimMu('SR', [lerp(REST.SR[0], -0.40, gS), lerp(REST.SR[1], -0.06, gS), lerp(REST.SR[2], 0.52, gS) - swingS * 0.6], 1); ik.SR.pole = V(-0.5, -0.8, -0.3);
    aimMu('BL', [lerp(0.78, 0.68, gS) + sway * 0.015, lerp(-0.28, 0.02, gS) + breathe * 2, lerp(0.30, 0.46, gS) + (1 - gS) * cp * 0.03 * gm], 1);
    aimMu('BR', [lerp(-0.72, -0.64, gS) + sway * 0.015, lerp(-0.28, 0.02, gS) + breathe * 2, lerp(0.30, 0.46, gS) - (1 - gS) * cp * 0.03 * gm], 1);
    if (fly > 0.01) {                                                                                 // flight: big arms swept slightly back, ordinary arms tucked
      aimMu('BL', [0.62, -0.16, 0.30], fly * 0.7); aimMu('BR', [-0.58, -0.18, 0.30], fly * 0.7); aimMu('SL', [0.50, -0.30, 0.10], fly * 0.8); aimMu('SR', [-0.50, -0.30, 0.10], fly * 0.8);
    }
    if (run > 0.05 && gm > 0.05) { aimMu('BL', [0.66, -0.20, 0.0], run * gm * 0.7); aimMu('BR', [-0.62, -0.20, 0.0], run * gm * 0.7); }
    if (rush > 0.05) { aimMu('BL', [0.62, -0.12, -0.05], rush * 0.8); aimMu('BR', [-0.60, -0.12, -0.05], rush * 0.8); aimMu('SL', [0.40, -0.25, -0.15], rush * 0.7); }
    // ---------------------------------------------------------------- wings: folded on the ground (they breathe and shiver), flapping in the air
    this.flap = damp(this.flap, s.flapRate || (fly > 0.5 ? 6 : 0), 5, dt); this.flapPh += dt * this.flap * Math.PI * 2; const fl = Math.sin(this.flapPh), open = clamp(fly * 1.0 + (s.wingOpen || 0), 0, 1);
    for (const sg of [1, -1]) {
      const k = sg > 0 ? 'L' : 'R', fold = 1 - open, wob = Math.sin(t * 1.3 + sg) * 0.03, fa = this.flap > 0.5 ? fl : 0;
      add('wing0' + k, -0.95 * fold - 0.25 * open + 0.1 * fa * open, 0, sg * (0.5 * fold - (0.5 + 0.62 * fa) * open) + wob);
      add('wing1' + k, -0.45 * fold - 0.1 * open, 0, sg * (0.28 * fold - 0.28 * fa * open)); add('wing2' + k, -0.25 * fold - 0.25 * fa * open, 0, sg * (0.16 * fold - 0.22 * fa * open) + wob);
    }
    // ---------------------------------------------------------------- tail: always trails
    const tailLag = gm * 0.25 + rush * 0.4 + fly * 0.35;
    for (let i = 0; i < 4; i++) { const k = 'tail' + i; add(k, -0.10 * (i === 0 ? 1 : 0.4) * (1 + tailLag) - 0.05 * fly * i + Math.sin(t * 2.2 - i * 0.7) * 0.05, Math.sin(t * 1.5 - i * 0.9) * (0.10 + 0.16 * gm) - this.turn * 0.12, 0); }
    // ---------------------------------------------------------------- actions
    if (act && atkW > 0.001) this.actionPose(act, atkW, { add, aim, aimMu, off, ik, legs, d }, dt);
    // ---------------------------------------------------------------- reactions
    this.reactionPose(react, s, { add, aim, aimMu, off, ik, legs, d }, dt);
    const pose = { d, ik, legs, off }; this.lastPose = pose; this.poser.apply(pose);
    return pose;
  }
  actionPose(a, w, H, dt) {
    const { add, aimMu, off, legs } = H; const kind = a.kind, t = a.t, u0 = clamp(t / a.windup, 0, 1), u1 = clamp((t - a.windup) / a.strike, 0, 1), u2 = clamp((t - a.windup - a.strike) / a.rec, 0, 1);
    const inWind = t < a.windup, inStrike = !inWind && t < a.windup + a.strike;
    const ext = inWind ? -0.35 * eo(u0) : inStrike ? lerp(-0.35, 1, ei(u1) * 0.35 + u1 * 0.65) : lerp(1, 0, eio(u2));        // -0.35 pulled back .. 1 full extension .. 0 guard
    const pull = inWind ? eo(u0) : inStrike ? 1 - u1 : 0;                                                                  // wind-up amount
    const fwd = inStrike ? sm(u1) : t < a.windup ? 0 : 1 - eio(u2);                                                        // body committed forward
    if (ATTACKS[kind]) {
      const A = ATTACKS[kind], two = A.arm === 'SS';
      const arms = two ? [['SL', 1], ['SR', -1]] : A.arm === 'S' ? [[a.hand === 'L' ? 'SL' : 'SR', a.hand === 'L' ? 1 : -1]] : [[A.arm, A.arm === 'BL' ? 1 : -1]];
      for (const [arm, sgn] of arms) {
        const back = [Math.abs(A.back[0]) * sgn, A.back[1], A.back[2]], out = [Math.abs(A.out[0]) * sgn, A.out[1], A.out[2]], p = [0, 0, 0];
        for (let i = 0; i < 3; i++) p[i] = ext < 0 ? lerp(REST_G[arm][i], back[i], clamp(-ext / 0.35, 0, 1)) : lerp(REST_G[arm][i], out[i], clamp(ext, 0, 1));
        if (kind === 'heavy') { p[1] = ext < 0 ? lerp(REST_G[arm][1], 0.62, clamp(-ext / 0.35, 0, 1)) : p[1]; }
        aimMu(arm, p, w);
      }
      const sgT = two ? 0 : arms[0][1];
      add('chest', -0.25 * pull * w * (kind === 'heavy' ? 1.6 : 0.5) + A.lean * fwd * 0.55 * w, -sgT * A.twist * (fwd - pull * 0.9) * w, 0);
      add('spine', A.lean * fwd * 0.35 * w, sgT * A.twist * pull * 0.2 * w, 0); add('head', -A.lean * fwd * 0.4 * w, 0, 0);
      off[2] += A.lunge * fwd * w * 1.2; off[1] += -0.1 * fwd * w * (kind === 'heavy' ? 2 : 1);
      add('hips', 0, sgT * A.twist * 0.3 * (fwd - pull * 0.6) * w, 0);
      if (fwd > 0.05) { const f = fwd * w; const lf = two ? 0 : sgT; legs.L.p.z += (lf < 0 ? 0.22 : -0.10) * f * S; legs.R.p.z += (lf > 0 ? 0.22 : -0.10) * f * S; if (two) { legs.L.p.z += 0.15 * f * S; legs.R.p.z += 0.15 * f * S; } }
      if (kind === 'heavy') { add('wing0L', -0.4 * pull * w, 0, -0.25 * pull * w); add('wing0R', -0.4 * pull * w, 0, 0.25 * pull * w); }
    } else if (kind === 'crystalShot' || kind === 'fireBlast') {
      const arm = kind === 'crystalShot' ? 'BR' : 'BL', sg = arm === 'BL' ? 1 : -1, aimY = a.aimY ?? 0, recoil = a.recoil ?? 0;
      const rise = eo(u0); const reach = (inWind ? rise : 1) - recoil * 0.25;
      const REST_ = REST_G[arm], tg = [sg * 0.22, 0.04 + aimY * 0.5, 0.84 - recoil * 0.12];
      aimMu(arm, [lerp(REST_[0], tg[0], reach), lerp(REST_[1], tg[1], reach), lerp(REST_[2], tg[2], reach)], w);
      aimMu(arm === 'BL' ? 'BR' : 'BL', [-sg * 0.50, 0.08, 0.55], w * 0.7);
      add('chest', 0.1 * w - recoil * 0.2 * w, -sg * 0.3 * w, 0); add('head', -0.1 * w, -sg * 0.12 * w, 0); off[2] -= recoil * 0.06 * w; off[1] -= 0.05 * w;
    } else if (kind === 'grab') {
      // GRAB-AND-THROW (V6): big arm draws back (prep) -> reaches out (reach) -> [hit: lifts the held target (lift) -> winds over the shoulder (back) -> snaps forward (snap)] -> follow-through; a miss just retracts (whiff)
      const arm = a.arm || 'BL', sg = arm === 'BL' ? 1 : -1, R0 = REST_G[arm], u = clamp(a.gu ?? 0, 0, 1), ph = a.gph || 'prep';
      const low = a.low ? 1 : 0, K = { prep: [sg * 0.95, 0.05, 0.20], reach: [-sg * 0.45, 0.06 - 0.55 * low, 1.18 - 0.05 * low], lift: [sg * 0.26, 0.82, 0.78], back: [sg * 0.58, 1.12, -0.05], snap: a.slamMode ? [sg * 0.18, -0.55, 0.95] : [sg * 0.18, 0.12, 1.08] };
      const mix = (A, B, k) => [lerp(A[0], B[0], k), lerp(A[1], B[1], k), lerp(A[2], B[2], k)];
      let p, twist = 0, lean = 0;
      if (ph === 'prep') { p = mix(R0, K.prep, eo(u)); twist = sg * 0.45 * eo(u); lean = -0.12 * eo(u); }
      else if (ph === 'reach') { p = mix(K.prep, K.reach, ei(u) * 0.4 + u * 0.6); twist = sg * 0.45 * (1 - u) - sg * 0.35 * u; lean = -0.12 + 0.5 * u; }
      else if (ph === 'whiff') { p = mix(K.reach, R0, eio(u)); twist = -sg * 0.35 * (1 - u); lean = 0.38 * (1 - u); }
      else if (ph === 'lift') { p = mix(K.reach, K.lift, eio(u)); twist = -sg * 0.35 * (1 - u); lean = 0.38 * (1 - u) - 0.12 * u; }
      else if (ph === 'back') { p = mix(K.lift, K.back, eo(u)); twist = sg * 0.55 * eo(u); lean = -0.28 * eo(u); }
      else if (ph === 'snap') { p = mix(K.back, K.snap, ei(u) * 0.3 + u * 0.7); twist = sg * 0.55 * (1 - u) - sg * 0.5 * u; lean = -0.28 * (1 - u) + 0.6 * u; this.mouthOpen = 0.7; }
      else { p = mix(K.snap, R0, eio(u)); twist = -sg * 0.5 * (1 - u); lean = 0.6 * (1 - u); }
      if (low && (ph === 'reach' || ph === 'whiff' || ph === 'lift')) { const cr = ph === 'reach' ? eo(u) : 1 - eio(u); off[1] -= 0.22 * cr * w; add('hips', 0.3 * cr * w, 0, 0); add('spine', 0.2 * cr * w, 0, 0); legs.L.p.y += 0.0; }
      if (low && (ph === 'reach' || ph === 'whiff' || ph === 'lift')) lean += 0.45 * (ph === 'reach' ? u : ph === 'whiff' ? 1 - u : 1 - u);
      aimMu(arm, p, w); aimMu(arm === 'BL' ? 'BR' : 'BL', [-sg * 0.55, 0.05, 0.52], w * 0.6);
      aimMu('SL', [0.40, -0.08, 0.52], w * 0.5); aimMu('SR', [-0.40, -0.08, 0.52], w * 0.5);
      add('chest', lean * w, -twist * w, 0); add('spine', lean * 0.5 * w, -twist * 0.4 * w, 0); add('head', -lean * 0.5 * w, 0, 0); add('hips', 0, -twist * 0.25 * w, 0);
      off[2] += (ph === 'reach' ? 0.14 * u : ph === 'lift' ? 0.14 * (1 - u) : ph === 'snap' ? 0.12 * u : 0) * w; off[1] -= (ph === 'prep' ? 0.1 * eo(u) : 0.04) * w;
      legs.L.p.z += 0.14 * S * w; legs.R.p.z -= 0.10 * S * w;
    } else if (kind === 'smash' || kind === 'slam') {
      // FOUR ARMS STRENGTH MOVES: both big arms (and the small ones for the slam) go overhead while he crouches and leans back (the readable wind-up, wings flare), then drive down into the ground in front of him
      const slam = kind === 'slam', up = inWind ? eo(u0) : inStrike ? 1 - ei(u1) : 0, hit = inStrike ? ei(u1) : t > a.windup ? 1 - eio(u2) : 0, sg = a.def && a.def.seismic ? 1 : 0;
      const hi = [0.52, 1.12 + 0.12 * sg, 0.12], lo = slam ? [0.50, -0.50, 0.78] : [0.36, -0.42, 0.98];
      for (const [arm, sgn] of [['BL', 1], ['BR', -1]]) {
        const R0 = REST_G[arm], H = [hi[0] * sgn, hi[1], hi[2]], Lw = [lo[0] * sgn, lo[1], lo[2]];
        const pw = up > 0 && !inStrike && t < a.windup ? up : 0;       // raising
        let p; if (inWind) p = [lerp(R0[0], H[0], pw), lerp(R0[1], H[1], pw), lerp(R0[2], H[2], pw)]; else if (inStrike) p = [lerp(H[0], Lw[0], hit), lerp(H[1], Lw[1], hit), lerp(H[2], Lw[2], hit)]; else p = [lerp(Lw[0], R0[0], eio(u2)), lerp(Lw[1], R0[1], eio(u2)), lerp(Lw[2], R0[2], eio(u2))];
        aimMu(arm, p, w);
      }
      if (slam) { const hs = inWind ? 0.85 * eo(u0) : inStrike ? 0.85 * (1 - u1) : 0, ls = inStrike ? sm(u1) : t > a.windup ? 1 - eio(u2) : 0;
        aimMu('SL', [lerp(REST_G.SL[0], 0.46, hs), lerp(REST_G.SL[1], 0.70, hs), lerp(REST_G.SL[2], 0.20, hs)], w * Math.max(hs, 0.001)); aimMu('SR', [lerp(REST_G.SR[0], -0.46, hs), lerp(REST_G.SR[1], 0.70, hs), lerp(REST_G.SR[2], 0.20, hs)], w * Math.max(hs, 0.001)); void ls; }
      const lean = (inWind ? -0.35 * eo(u0) : inStrike ? -0.35 + 0.95 * ei(u1) : 0.6 * (1 - eio(u2))) * (slam ? 0.9 : 1), crouch = inWind ? eo(u0) * 0.6 : inStrike ? 0.6 * (1 - u1) + 0.25 * u1 : 0.25 * (1 - eio(u2));
      add('chest', lean * 0.7 * w, 0, 0); add('spine', lean * 0.4 * w, 0, 0); add('head', -lean * 0.35 * w, 0, 0); add('hips', 0.2 * crouch * w + lean * 0.15 * w, 0, 0);
      off[1] -= 0.16 * crouch * w; off[2] += 0.1 * (inStrike ? sm(u1) : 0) * w;
      const fl = inWind ? eo(u0) : inStrike ? 1 - u1 : 0; add('wing0L', -0.3 * fl * w, 0, -0.4 * fl * w); add('wing0R', -0.3 * fl * w, 0, 0.4 * fl * w);
      legs.L.p.z += 0.12 * S * w; legs.R.p.z -= 0.08 * S * w; this.mouthOpen = Math.max(this.mouthOpen, inStrike ? 0.8 : 0.4 * (inWind ? u0 : 0));
    } else if (kind === 'prop') {
      // HEAVY OBJECT: bend down to pick it up (reach), straighten with it overhead (lift / hold), then hurl it (throw)
      const ph = a.pph || 'reach', u = clamp(a.pu ?? 0, 0, 1), bend = ph === 'reach' ? sm(u) * 0.9 + 0.1 : ph === 'lift' ? 1 - sm(u) : 0;
      const up = ph === 'reach' ? 0 : ph === 'lift' ? sm(u) : ph === 'hold' ? 1 : ph === 'throw' ? 1 - ei(u) : 0, snap = ph === 'throw' ? ei(u) : 0, rec = ph === 'rec' ? 0.5 : 0;
      for (const [arm, sgn] of [['BL', 1], ['BR', -1]]) {
        const R0 = REST_G[arm], Dn = [0.46 * sgn, -0.62, 0.62], Hi = [0.50 * sgn, 1.10, 0.20], Th = [0.34 * sgn, 0.20, 1.0], base = [lerp(R0[0], Dn[0], bend), lerp(R0[1], Dn[1], bend), lerp(R0[2], Dn[2], bend)];
        const p = [lerp(base[0], Hi[0], up), lerp(base[1], Hi[1], up), lerp(base[2], Hi[2], up)]; const pp = [lerp(p[0], Th[0], snap), lerp(p[1], Th[1], snap), lerp(p[2], Th[2], snap)];
        aimMu(arm, pp, w * Math.max(0.001, 1 - rec * 0.6));
      }
      add('chest', (0.55 * bend - 0.3 * up + 0.7 * snap) * w, 0, 0); add('spine', (0.3 * bend - 0.15 * up + 0.3 * snap) * w, 0, 0); add('hips', 0.3 * bend * w, 0, 0); add('head', (-0.25 * bend + 0.1 * up) * w, 0, 0);
      off[1] -= (0.22 * bend) * w; legs.L.p.z += 0.10 * S * w; legs.R.p.z -= 0.08 * S * w;
    } else if (kind === 'block') {
      const g = inWind ? eo(u0) : inStrike ? 1 : 1 - eio(u2);
      aimMu('BL', [lerp(REST_G.BL[0], 0.22, g), lerp(REST_G.BL[1], 0.42, g), lerp(REST_G.BL[2], 0.70, g)], w); aimMu('BR', [lerp(REST_G.BR[0], -0.22, g), lerp(REST_G.BR[1], 0.42, g), lerp(REST_G.BR[2], 0.70, g)], w);
      aimMu('SL', [lerp(REST_G.SL[0], 0.12, g), lerp(REST_G.SL[1], 0.20, g), lerp(REST_G.SL[2], 0.62, g)], w); aimMu('SR', [lerp(REST_G.SR[0], -0.12, g), lerp(REST_G.SR[1], 0.20, g), lerp(REST_G.SR[2], 0.62, g)], w);
      add('chest', 0.3 * g * w, 0, 0); add('head', 0.1 * g * w, 0, 0); off[1] -= 0.08 * g * w; add('wing0L', -0.2 * g * w, 0, -0.2 * g * w); add('wing0R', -0.2 * g * w, 0, 0.2 * g * w);
    } else if (kind === 'goo') {
      const back = inWind ? eo(u0) : inStrike ? 1 - u1 : 0, thrust = inStrike ? ei(u1) : t > a.windup ? 1 - eio(u2) : 0; this.mouthOpen = clamp(back * 0.5 + thrust, 0, 1);
      add('neck', (-0.55 * back + 0.42 * thrust) * w, 0, 0); add('head', (-0.45 * back + 0.30 * thrust) * w, 0, 0); add('chest', (-0.30 * back + 0.30 * thrust) * w, 0, 0); add('spine', (-0.18 * back + 0.2 * thrust) * w, 0, 0);
      aimMu('SL', [0.36, -0.20, 0.38], w * 0.8); aimMu('SR', [-0.36, -0.20, 0.38], w * 0.8); off[2] += 0.05 * thrust * w;
    } else if (kind === 'takeoff') {
      const crouch = inWind ? eo(u0) : 0, jump = inStrike ? u1 : t > a.windup ? 1 : 0;
      off[1] += (-0.28 * crouch + 0.12 * jump) * w; add('hips', 0.3 * crouch * w, 0, 0); add('chest', 0.25 * crouch * w, 0, 0); legs.L.p.y += -0.05 * crouch * w * S; legs.R.p.y += -0.05 * crouch * w * S;
      aimMu('BL', [0.50, 0.55, 0.15], w * (inStrike ? u1 : crouch * 0.5)); aimMu('BR', [-0.50, 0.55, 0.15], w * (inStrike ? u1 : crouch * 0.5));
    } else if (kind === 'land') {
      const k = 1 - eio(t / a.dur), c = Math.sin(clamp(t / a.dur, 0, 1) * Math.PI);
      off[1] += -0.30 * c * w; add('hips', 0.35 * c * w, 0, 0); add('chest', 0.3 * c * w, 0, 0); add('head', -0.2 * c * w, 0, 0);
      add('wing0L', -0.2 * k * w, 0, -0.3 * k * w); add('wing0R', -0.2 * k * w, 0, 0.3 * k * w);
      aimMu('BL', [0.78, -0.1, 0.25], w * 0.7 * c); aimMu('BR', [-0.78, -0.1, 0.25], w * 0.7 * c);
    } else if (kind === 'dodge') {
      const sgd = a.dir || 1, c = Math.sin(clamp(t / a.dur, 0, 1) * Math.PI);
      add('chest', 0.2 * c * w, sgd * 0.3 * c * w, -sgd * 0.35 * c * w); add('hips', 0, 0, -sgd * 0.2 * c * w); off[0] += sgd * 0.1 * c * w; off[1] -= 0.08 * c * w;
      aimMu('SL', [0.36, -0.1, 0.45], w * c); aimMu('SR', [-0.36, -0.1, 0.45], w * c);
    } else if (kind === 'taunt' || kind === 'roar') {
      const c = Math.sin(clamp(t / a.dur, 0, 1) * Math.PI); add('chest', -0.3 * c * w, 0, 0); add('head', -0.25 * c * w, 0, 0);
      aimMu('BL', [0.9, 0.2, 0.3], w * c); aimMu('BR', [-0.85, 0.2, 0.3], w * c); this.mouthOpen = c;
    }
  }
  reactionPose(R, s, H, dt) {
    const { add, aimMu, off, legs } = H; const st = R.state;
    const lean = R.lean || 0, flinchK = clamp(lean / 0.5, 0, 1);
    this.dead = damp(this.dead, s.dead ? 1 : 0, s.dead ? 6 : 12, dt);
    if (flinchK > 0.02 && !s.dead) {                                                                   // flinch: head and chest snap back, arms jerk, wings flare
      add('chest', -0.45 * flinchK, 0, 0); add('spine', -0.25 * flinchK, 0, 0); add('neck', -0.3 * flinchK, 0, 0); add('head', -0.35 * flinchK, 0, 0);
      aimMu('BL', [0.9, 0.18, 0.12], flinchK * 0.7); aimMu('BR', [-0.85, 0.18, 0.12], flinchK * 0.7); aimMu('SL', [0.62, -0.1, -0.05], flinchK * 0.6); aimMu('SR', [-0.62, -0.1, -0.05], flinchK * 0.6);
      add('wing0L', -0.2 * flinchK, 0, -0.3 * flinchK); add('wing0R', -0.2 * flinchK, 0, 0.3 * flinchK); off[1] -= 0.05 * flinchK;
      for (const k of ['L', 'R']) { legs[k].p.z -= 0.1 * flinchK * S; }
    }
    if (st === 'air') {                                                                                // launched: arms and legs flail, wings flare
      const f = Math.sin(this.t * 14); add('head', -0.4, 0, 0); add('chest', -0.15, 0, 0);
      aimMu('BL', [0.95, 0.35 + f * 0.1, 0.05], 0.9); aimMu('BR', [-0.9, 0.35 - f * 0.1, 0.05], 0.9); aimMu('SL', [0.7, 0.0 + f * 0.1, -0.15], 0.9); aimMu('SR', [-0.7, 0.0 - f * 0.1, -0.15], 0.9);
      add('wing0L', 0, 0, -0.35); add('wing0R', 0, 0, 0.35);
      for (const [k, sg] of [['L', 1], ['R', -1]]) { legs[k].p.y = 0.34 * S; legs[k].p.z = (-0.12 + sg * f * 0.08) * S; legs[k].pitch = 0.5; }
    }
    if (st === 'fall') {
      const u = clamp(R.fallU ?? 0, 0, 1); add('chest', -0.3 * u, 0, 0); add('head', -0.35 * u, 0, 0);
      aimMu('BL', [0.95, 0.4, -0.05], 0.8 * u + 0.2); aimMu('BR', [-0.9, 0.4, -0.05], 0.8 * u + 0.2); aimMu('SL', [0.68, 0.1, -0.1], 0.8); aimMu('SR', [-0.68, 0.1, -0.1], 0.8);
      add('wing0L', 0, 0, -0.25 * u); add('wing0R', 0, 0, 0.25 * u);
    }
    if (st === 'down' || s.dead) {                                                                     // lying: limbs go slack, chest heaves
      const k = s.dead ? this.dead : 1, br = Math.sin(this.t * 2.6) * 0.03 * (s.dead ? 0 : 1);
      add('chest', br, 0, 0); add('head', -0.1, 0.25, 0); add('neck', 0, 0.15, 0);
      aimMu('BL', [0.86, -0.08, 0.1], k * 0.85); aimMu('BR', [-0.8, -0.1, 0.12], k * 0.85); aimMu('SL', [0.60, -0.40, 0.08], k * 0.85); aimMu('SR', [-0.60, -0.4, 0.1], k * 0.85);
      for (const [kk, sg] of [['L', 1], ['R', -1]]) { legs[kk].p.y = 0.2 * S; legs[kk].p.z = (0.02 + sg * 0.04) * S; legs[kk].p.x += sg * 0.06 * S * k; }
      add('wing0L', 0.1, 0, 0.1 * k); add('wing0R', 0.1, 0, -0.1 * k);
      if (s.dead) { add('wing0L', 1.4 * k, 0, 0); add('wing0R', 1.4 * k, 0, 0); }                    // defeated: wings fold flat along the body so he can lie on his back without them stabbing through the floor
    }
    if (st === 'getup') {
      const u = clamp((R.getT ?? 0) / (R.getMax || 0.75), 0, 1), push = Math.sin(clamp(u / 0.55, 0, 1) * Math.PI) * (u < 0.55 ? 1 : 0.0), crouch = u < 0.45 ? 1 : 1 - eio((u - 0.45) / 0.55);
      aimMu('SL', [0.46, -0.52 * push - 0.2 * (1 - push), 0.30 + 0.25 * push], 0.9); aimMu('SR', [-0.46, -0.52 * push - 0.2 * (1 - push), 0.30 + 0.25 * push], 0.9);
      aimMu('BL', [0.75, -0.20, 0.35], 0.6 * crouch); aimMu('BR', [-0.7, -0.22, 0.35], 0.6 * crouch);
      add('chest', 0.35 * crouch, 0, 0); add('head', -0.2 * crouch, 0, 0); off[1] -= 0.2 * crouch;
      for (const [kk, sg] of [['L', 1], ['R', -1]]) { legs[kk].p.z = (0.12 - sg * 0.06) * S; legs[kk].p.y = 0.17 * S; }
    }
  }
}
const REST_G = { BL: REST.BL, BR: REST.BR, SL: REST.SL, SR: REST.SR };
