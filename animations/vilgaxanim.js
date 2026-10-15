// VILGAX animation driver.  Layer 1: the GLB's OWN clips (stand / ready / walk / run / wound / dodge) blended by the game state - root motion is removed in the rig, physics owns the position.
// Layer 2 (after the mixer): procedural attack poses - spine lean + twist (world-axis rotations), two-bone analytic IK for both arms (so a punch really reaches the point the hit test sweeps),
// head pitch, SWIM stroke / kick (he is aquatic; he does not fly), and the four facial tentacles (aimed + stretched for the whip / grab).  Nothing here touches the root transform: that stays with the physics (kevin.js finish()).
import * as THREE from 'three';
import { clamp, damp } from '../src/util.js';

const sm = u => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
const eo = u => { u = clamp(u, 0, 1); return 1 - (1 - u) * (1 - u); };
const UPV = new THREE.Vector3(0, 1, 0), RIGHT = new THREE.Vector3(1, 0, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const lerp = (a, b, u) => a + (b - a) * u;
const lk = (k0, k1, u) => [lerp(k0[0], k1[0], u), lerp(k0[1], k1[1], u), lerp(k0[2], k1[2], u)];

/** rotate `bone` by the WORLD-space delta quaternion q (independent of the bone's own axis conventions) */
function rotWorld(bone, q) {
  bone.updateWorldMatrix(true, false); bone.getWorldQuaternion(_q2); _q2.premultiply(q);
  if (bone.parent) { bone.parent.getWorldQuaternion(_q3).invert(); bone.quaternion.copy(_q3.multiply(_q2)); } else bone.quaternion.copy(_q2);
  bone.updateMatrixWorld(true);
}

export class VilgaxAnim {
  constructor(rig) {
    this.rig = rig; this.b = rig.bones; this.root = null;
    this.mixer = new THREE.AnimationMixer(rig.scene); this.act = {};
    const mk = (n, loop = true) => { const c = rig.clips[n]; if (!c) return null; const a = this.mixer.clipAction(c); a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); a.clampWhenFinished = true; a.play(); a.setEffectiveWeight(0); return a; };
    for (const n of ['stand1', 'stand3', 'ready', 'walk', 'run']) this.act[n] = mk(n); for (const n of ['wound', 'dodge']) this.act[n] = mk(n, false);
    this.phase = 0; this.ph = 0; this.t = 0; this.idleT = 0; this.woundT = 9; this.woundPrev = 0; this.dodgeT = 9; this.lastAct = null;
    this.WALK_V = 3.6; this.RUN_V = 7.8; this.footD = 0; this.toeRef = 0;
    this.wArm = { L: 0, R: 0 }; this.tgt = { L: new THREE.Vector3(), R: new THREE.Vector3() }; this.lean = 0; this.twist = 0; this.headP = 0; this.sw = 0; this.tentExt = 0; this.deadK = 0; this.leanF = 0;
    this.owner = null; this.setup = false; this.tentAim = [0, 1, 2, 3].map(() => new THREE.Vector3(0, 0, 1)); this.fl = rig.feelers.map(ch => ({ rest: ch.map(b => b.quaternion.clone()), len: 1 }));
    this.dbg = {};
  }
  /** measure the rest pose once (shoulder positions, arm length, side signs) */
  measure() {
    const b = this.b, root = this.root; root.updateMatrixWorld(true);
    this.mix(0, 0, 0, 0, 1, 0, 0, 0); this.mixer.update(0); root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), loc = (o) => o.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
    const sL = loc(b.LUpper), sR = loc(b.RUpper), eL = loc(b.LFore), hL = loc(b.LHand);
    this.Lsign = Math.sign(sL.x) || 1; this.shY = (sL.y + sR.y) / 2; this.shLat = Math.abs(sL.x - sR.x) / 2; this.armLen = sL.distanceTo(eL) + eL.distanceTo(hL);
    this.hipY = loc(b.pelvis).y; this.toeRef = Math.min(loc(b.LToe).y, loc(b.RToe).y);
    this.fl.forEach((f, i) => { const ch = this.rig.feelers[i]; if (!ch.length) return; const p0 = ch[0].getWorldPosition(_a), p1 = this.rig.markers['tip' + i].getWorldPosition(_b); f.len = Math.max(0.05, p0.distanceTo(p1)); });
    this.setup = true;
  }
  /** key (lat, up, fwd) -> root-local target for one side. lat is outward from the centre line, up is relative to the shoulder, fwd is metres in front of the root */
  keyPos(side, k, out) { const sg = (side === 'L' ? 1 : -1) * this.Lsign; return out.set(sg * (this.shLat + k[0]), this.shY + k[1], k[2]); }
  // ---- clip blending -------------------------------------------------------------------------------------------------------------------------------------------------------------
  mix(sp, combat, flinch, dodge, idleOnly, dt, rate, tsc) {
    const A = this.act, wk = smooth(sp, 0.25, 1.9), rn = smooth(sp, 4.6, 6.6);
    let wIdle = 1 - wk, wWalk = wk * (1 - rn), wRun = wk * rn;
    const idleC = combat, wReady = wIdle * idleC, wStand = wIdle * (1 - idleC);
    let wWound = clamp(flinch * 1.15, 0, 0.85), wDodge = dodge;
    const sc = (1 - wWound) * (1 - wDodge);
    if (A.stand1) A.stand1.setEffectiveWeight(wStand * sc); if (A.ready) A.ready.setEffectiveWeight(wReady * sc); if (A.walk) A.walk.setEffectiveWeight(wWalk * sc); if (A.run) A.run.setEffectiveWeight(wRun * sc);
    if (A.wound) A.wound.setEffectiveWeight(wWound * (1 - wDodge)); if (A.dodge) A.dodge.setEffectiveWeight(wDodge);
    if (A.stand3) A.stand3.setEffectiveWeight(0);
  }
  update(dt, s) {
    const rig = this.rig, b = this.b, o = this.owner; if (!this.root) this.root = rig.modelGroup.parent; const root = this.root;
    root.updateMatrixWorld(true); if (!this.setup) { this.measure(); root.updateMatrixWorld(true); }
    this.t += dt; const a = s.act, kind = a ? a.kind : null, A = this.act;
    // ---- locomotion phase
    const sp = s.speed; const rate = sp < 3.6 ? sp / this.WALK_V / 1.6 : sp / this.RUN_V / 0.9;      // cycles per second
    const run = smooth(sp, 4.6, 6.6); const cyc = lerp(sp / this.WALK_V / 1.6, sp / this.RUN_V / 0.9, run);
    this.phase = (this.phase + cyc * dt) % 1; this.ph = this.phase * Math.PI * 2 + (this.stepBase || 0); this.idleT += dt;
    // damage flinch -> the GLB's wound clip
    const fl = s.react ? Math.max(s.react.lean || 0, 0) : 0; if (fl > 0.25 && this.woundPrev <= 0.25) this.woundT = 0; this.woundPrev = fl; this.woundT += dt;
    const flW = this.woundT < 0.7 ? Math.sin(Math.min(this.woundT / 0.7, 1) * Math.PI) * clamp(fl * 1.4, 0, 1) : 0;
    // dodge clip
    if (kind === 'dodge') { if (this.lastAct !== a) this.dodgeT = 0; this.dodgeT += dt; } else this.dodgeT = 9; this.lastAct = a;
    const dodgeW = kind === 'dodge' ? sm(Math.min(this.dodgeT / 0.1, 1)) * sm(Math.min((a.dur - this.dodgeT) / 0.12, 1)) : 0;
    this.sw = (this.sw + dt * (0.35 + 0.9 * clamp((s.swimSp || 0) / 8, 0, 1))) % 1000;
    this.mix(sp, s.combat ? 1 : 0, flW, dodgeW);
    if (A.walk) A.walk.time = this.phase * A.walk.getClip().duration; if (A.run) A.run.time = this.phase * A.run.getClip().duration;
    if (A.stand1) A.stand1.time = this.idleT % A.stand1.getClip().duration; if (A.ready) A.ready.time = this.idleT % A.ready.getClip().duration;
    if (A.wound) A.wound.time = Math.min(this.woundT, A.wound.getClip().duration - 0.001); if (A.dodge) A.dodge.time = Math.min(this.dodgeT * (A.dodge.getClip().duration / Math.max(0.3, a && kind === 'dodge' ? a.dur : 0.42)), A.dodge.getClip().duration - 0.001);
    if (this.base) for (const [bone, q] of this.base) bone.quaternion.copy(q);            // bones the clips do not animate must not accumulate last frame's procedural offsets
    this.mixer.update(0); root.updateMatrixWorld(true);
    if (!this.base) { this.base = new Map(); const bb = this.b; for (const k of ['pelvis', 'spine', 'spine1', 'head', 'LUpper', 'LFore', 'RUpper', 'RFore']) this.base.set(bb[k], bb[k].quaternion.clone()); for (const ch of this.rig.feelers) for (const f of ch) this.base.set(f, f.quaternion.clone()); }
    for (const [bone, q] of this.base) q.copy(bone.quaternion);
    // ---- procedural layer
    const P = this.pose(s, a, kind, o); this.applyPose(dt, P, s);
  }
  // ---- the pose table ---------------------------------------------------------------------------------------------------------------------------------------------------------------
  pose(s, a, kind, o) {
    const P = { L: null, R: null, lean: 0, twist: 0, head: 0, w: 1, dead: !!s.dead, tent: null };
    if (s.dead) { P.L = { k: [0.9, -1.8, 0.1], w: 1 }; P.R = { k: [0.9, -1.8, 0.1], w: 1 }; P.head = 0.25; return P; }
    if (!a) { if ((s.swim || 0) > 0.02) this.swimArms(P, s); return P; }
    const t = a.t, W = a.windup, S = a.strike, R = Math.max(a.dur - W - S, 1e-3);
    const ph = t < W ? 'w' : t < W + S ? 's' : 'r', u = ph === 'w' ? clamp(t / Math.max(W, 1e-3), 0, 1) : ph === 's' ? clamp((t - W) / Math.max(S, 1e-3), 0, 1) : clamp((t - W - S) / R, 0, 1);
    const wIn = ph === 'w' ? sm(u) : 1, wOut = ph === 'r' ? 1 - sm(u) : 1, w = wIn * wOut * (kind === 'block' ? 1 : 1);
    const arm = (side, k, ww = w) => { P[side] = { k, w: ww }; };
    const sh = (hand) => (hand === 'L' ? 1 : -1) * this.Lsign;                                           // +1: that hand is on the +X side of the root
    switch (kind) {
      case 'punch': case 'counterPunch': {
        const h = a.hand || 'R', o2 = h === 'L' ? 'R' : 'L', s1 = sh(h);
        const Wk = [0.55, -0.5, -0.4], Sk = [0.05, a.hy ?? -0.15, a.hf ?? 2.5];
        arm(h, ph === 'w' ? lk([0.3, -0.4, 0.9], Wk, eo(u)) : lk(Wk, Sk, eo(Math.min(u * 1.8, 1))), ph === 'w' ? sm(Math.min(u * 1.6, 1)) : wOut); arm(o2, [0.25, -0.5, 1.2], 0.5 * w);
        P.twist = ph === 'w' ? 0.5 * s1 * sm(u) : ph === 's' ? lerp(0.5, -0.5, eo(u)) * s1 : -0.5 * s1 * (1 - sm(u)); const lo = clamp(-(a.hy ?? 0) * 0.16, 0, 0.45); P.lean = ph === 'w' ? -0.12 * sm(u) : ph === 's' ? lerp(-0.12, 0.28 + lo, eo(u)) : (0.28 + lo) * (1 - sm(u)); break;
      }
      case 'backhand': {
        const h = a.hand || 'R', s1 = sh(h);
        arm(h, ph === 'w' ? lk([0.3, -0.3, 0.8], [-0.9, -0.1, 1.5], eo(u)) : lk([-0.9, -0.1, 1.5], [2.4, (a.hy ?? -0.3) + 0.1, (a.hf ?? 1.6) - 0.2], eo(u)), ph === 'r' ? wOut : 1); arm(h === 'L' ? 'R' : 'L', [0.25, -0.5, 1.0], 0.5 * w);
        P.twist = ph === 'w' ? -0.7 * s1 * sm(u) : ph === 's' ? lerp(-0.7, 0.8, eo(u)) * s1 : 0.8 * s1 * (1 - sm(u)); P.lean = 0.12; break;
      }
      case 'heavy': case 'slam': {
        const Wk = [0.45, 2.3, 0.1], Sk = kind === 'slam' ? [0.3, -2.9, 1.9] : [0.3, Math.min(a.hy ?? -2.5, -1.2) - 0.2, a.hf ?? 2.2];
        const k = ph === 'w' ? lk([0.5, 0.4, 0.5], Wk, eo(u)) : lk(Wk, Sk, eo(Math.min(u * 1.5, 1))), ww = ph === 'w' ? sm(Math.min(u * 1.4, 1)) : wOut; arm('L', k, ww); arm('R', k, ww);
        P.lean = ph === 'w' ? -0.34 * sm(u) : ph === 's' ? lerp(-0.34, kind === 'slam' ? 1.0 : 0.8, eo(u)) : (kind === 'slam' ? 1.0 : 0.8) * (1 - sm(u)); P.head = ph === 'w' ? -0.1 : 0.1; break;
      }
      case 'tentWhip': {
        arm('L', [0.35, 0.8, 0.9], 0.55 * w); arm('R', [0.35, 0.8, 0.9], 0.55 * w); P.lean = ph === 'w' ? -0.1 * sm(u) : ph === 's' ? lerp(-0.1, 0.22, eo(u)) : 0.22 * (1 - sm(u)); P.head = ph === 'w' ? -0.25 : 0.15; break;
      }
      case 'blast': {
        const cannon = 'R'; arm(cannon, ph === 'w' ? lk([0.4, -0.3, 0.9], [0.2, 0.0, 1.5], eo(u)) : lk([0.2, 0.0, 1.5], [0.1, (a.aimY || 0) * 2.4 + 0.15, 3.4], eo(Math.min(u * 3, 1))), ph === 'w' ? sm(Math.min(u * 2, 1)) : wOut);
        arm('L', [0.3, -0.5, 1.0], 0.5 * w); P.lean = -0.04 + (ph === 's' ? 0.08 : 0); P.twist = 0.18 * this.Lsign * -1 * w; break;
      }
      case 'charged': {
        arm('R', ph === 'w' ? lk([0.5, -0.3, 0.8], [0.45, 2.1, 0.55], eo(Math.min(u * 1.4, 1))) : lk([0.45, 2.1, 0.55], [0.1, 0.3 + (a.aimY || 0) * 2.4, 3.6], eo(Math.min(u * 2.5, 1))), ph === 'w' ? sm(Math.min(u * 1.5, 1)) : wOut);
        arm('L', [0.45, -0.7, 0.5], 0.7 * w); P.lean = ph === 'w' ? -0.28 * sm(u) : ph === 's' ? lerp(-0.28, 0.22, eo(u)) : 0.22 * (1 - sm(u)); P.head = ph === 'w' ? -0.25 : 0; break;
      }
      case 'block': {
        const k = [-0.25, 0.45, 1.55], ww = sm(Math.min(t / 0.16, 1)) * sm(Math.min((a.dur - t) / 0.2, 1)); arm('L', k, ww); arm('R', k, ww); P.lean = -0.12 * ww; P.head = 0.28 * ww; P.twist = 0; break;
      }
      case 'charge': {
        const ww = ph === 'r' ? wOut : sm(Math.min(t / 0.5, 1)); arm('L', [0.9, -0.2, -0.9], ww); arm('R', [0.9, -0.2, -0.9], ww); P.lean = ph === 'w' ? 0.3 * sm(u) : ph === 's' ? 0.52 : 0.52 * (1 - sm(u)); P.head = -0.2; break;
      }
      case 'jump': {
        const air = a.air || 0, land = a.landT || 0; const kd = [0.7, -0.5, -0.8], ku = [1.3, 1.2, 0.5], kl = [0.5, -1.4, 1.2];
        const k = a.jph === 'air' ? lk(kd, ku, sm(air)) : a.jph === 'land' ? kl : kd; arm('L', k, 0.9 * w); arm('R', k, 0.9 * w); P.lean = a.jph === 'air' ? lerp(0.35, -0.1, sm(air)) : a.jph === 'land' ? 0.5 : 0.32; break;
      }
      case 'prop': {
        const q = a.pph || 'reach', gu = a.pu || 0; let k;
        if (q === 'reach') { k = [0.3, -2.3, 2.5]; P.lean = 0.55 * sm(gu); } else if (q === 'lift') { k = lk([0.3, -2.3, 2.3], [0.2, 2.1, 0.7], eo(gu)); P.lean = lerp(0.55, -0.22, sm(gu)); } else if (q === 'hold') { k = [0.2, 2.1, 0.7]; P.lean = -0.25; } else if (q === 'throw') { k = lk([0.2, 2.1, 0.5], [0.2, 0.3, 3.3], eo(gu)); P.lean = lerp(-0.3, 0.5, eo(gu)); } else { k = [0.3, -0.6, 1.0]; P.lean = 0.1; }
        arm('L', k, 1); arm('R', k, 1); break;
      }
      case 'grab': {
        const side = a.arm === 'BL' ? 'L' : 'R', other = side === 'L' ? 'R' : 'L', g = a.gph, gu = a.gu || 0; const tent = a.tent;
        if (tent) { arm('L', [0.3, 0.0, 1.0], 0.6); arm('R', [0.3, 0.0, 1.0], 0.6); P.lean = g === 'reach' ? 0.1 : -0.05; P.head = -0.2; if (g === 'lift' || g === 'back' || g === 'snap' || g === 'follow' || g === 'whiff') { /* hand takes over after the pull */ } }
        if (!tent || g === 'lift' || g === 'back' || g === 'snap' || g === 'follow') {
          const ww = a.fade ? sm(Math.min((a.dur - t) / 0.25, 1)) : 1;
          if (g === 'prep') { arm(side, lk([0.4, -0.1, 0.5], [0.5, 0.2, 0.9], eo(gu)), ww); P.lean = -0.08 * gu; }
          else if (g === 'reach') { arm(side, lk([0.5, 0.2, 0.9], [0.0, (a.hy ?? -0.3), (a.hf ?? 3.0) + 0.3], eo(gu)), ww); arm(other, [0.25, -0.2, 1.3], 0.6 * ww); P.lean = 0.28 * gu; }
          else if (g === 'lift') { arm(side, lk([0.0, -0.3, 2.4], [0.25, 1.7, 1.2], eo(gu)), ww); arm(other, [0.3, 0.2, 1.0], 0.5 * ww); P.lean = lerp(0.2, -0.2, sm(gu)); }
          else if (g === 'back') { arm(side, lk([0.25, 1.7, 1.2], [0.5, 1.4, -0.5], eo(gu)), ww); P.lean = lerp(-0.2, -0.38, sm(gu)); P.twist = 0.35 * sh(side) * sm(gu); }
          else if (g === 'snap') { arm(side, lk([0.5, 1.4, -0.5], [0.1, 0.5, 3.3], eo(Math.min(gu * 1.6, 1))), ww); P.lean = lerp(-0.38, 0.45, eo(gu)); P.twist = lerp(0.35, -0.4, eo(gu)) * sh(side); }
          else if (g === 'follow' || g === 'whiff') { arm(side, [0.1, 0.4, 3.0], ww * 0.9); P.lean = 0.3 * ww; }
        }
        break;
      }
      case 'roar': { const ww = sm(Math.min(t / 0.25, 1)) * sm(Math.min((a.dur - t) / 0.4, 1)); arm('L', [1.5, 1.5, 0.3], ww); arm('R', [1.5, 1.5, 0.3], ww); P.lean = -0.3 * ww; P.head = -0.35 * ww; break; }
      case 'swimCharge': { const ww = ph === 'r' ? wOut : sm(Math.min(t / 0.45, 1)); arm('L', [0.35, -1.3, -0.25], ww); arm('R', [0.35, -1.3, -0.25], ww); P.head = -0.25; break; }
      case 'land': { const ww = sm(Math.min((a.dur - t) / 0.4, 1)); arm('L', [0.5, -1.3, 1.1], ww); arm('R', [0.5, -1.3, 1.1], ww); P.lean = 0.4 * ww; break; }
      case 'dodge': break;
      default: break;
    }
    return P;
  }
  /** swimming arms: breaststroke (pull / recover) that streamlines into a glide at speed, scull at rest, thrown up when plunging in, down when wading out */
  swimArms(P, s) {
    const k = s.swim || 0, sp = clamp((s.swimSp || 0) / 8, 0, 1), glide = smooth(sp, 0.55, 0.9), u = this.sw % 1;
    const front = [1.15, 0.05, 2.1], pull = [0.95, -1.05, 0.15], back = [0.4, -1.3, -0.25], rest = [0.75, -0.95, 0.45]; let key;
    if (sp < 0.12) key = lk(rest, [0.95, -0.7, 0.9], Math.sin(this.sw * 6.283) * 0.5 + 0.5);
    else { key = u < 0.5 ? lk(front, pull, sm(u * 2)) : lk(pull, front, sm(u * 2 - 1)); key = lk(key, back, glide); }
    if ((s.enter || 0) > 0.02) key = lk(key, [0.9, 1.4, 0.4], sm(s.enter)); if ((s.exit || 0) > 0.02) key = lk(key, [0.5, -0.4, 1.3], sm(s.exit));
    P.L = { k: key, w: k * 0.9 }; P.R = { k: key, w: k * 0.9 };
  }
  applyPose(dt, P, s) {
    const b = this.b, root = this.root, o = this.owner;
    // smooth the parameters (poses change instantly between acts; the body must not pop)
    this.lean = damp(this.lean, P.lean, 16, dt); this.twist = damp(this.twist, P.twist, 18, dt); this.headP = damp(this.headP, P.head, 10, dt); this.deadK = damp(this.deadK, P.dead ? 1 : 0, 6, dt);
    // spine: pitch about the root's lateral axis, twist about the vertical (both applied in WORLD axes, 3 joints share the angle)
    root.getWorldQuaternion(_q); const ax = _a.set(1, 0, 0).applyQuaternion(_q).clone(), ay = _b.set(0, 1, 0).applyQuaternion(_q).clone();
    const lean = this.lean, tw = this.twist;
    if (Math.abs(lean) > 0.002 || Math.abs(tw) > 0.002) {
      const parts = [[b.spine, 0.45], [b.spine1, 0.6]]; for (const [bone, k] of parts) { if (Math.abs(lean) > 0.002) rotWorld(bone, new THREE.Quaternion().setFromAxisAngle(ax, lean * k)); if (Math.abs(tw) > 0.002) rotWorld(bone, new THREE.Quaternion().setFromAxisAngle(ay, tw * k)); }
    }
    if (Math.abs(this.headP) > 0.01) rotWorld(b.head, new THREE.Quaternion().setFromAxisAngle(ax, this.headP));
    root.updateMatrixWorld(true);
    // arms
    for (const side of ['L', 'R']) {
      const want = P[side] ? P[side].w : 0; this.wArm[side] = damp(this.wArm[side], want, want > this.wArm[side] ? 22 : 14, dt);
      if (P[side]) this.keyPos(side, P[side].k, _c), this.tgt[side].lerp(_c, this.tgt[side].lengthSq() < 1e-6 ? 1 : 1 - Math.exp(-30 * dt));
      if (this.wArm[side] > 0.01) this.armIK(side, this.tgt[side], this.wArm[side]);
    }
    this.swimLegs(dt, s); this.tentacles(dt, s); this.plantFeet(dt, s);
  }
  /** flutter kick while swimming: thighs swing, calves trail (rotations about the root's lateral axis, so they follow the body's pitch) */
  swimLegs(dt, s) {
    const k = s.swim || 0; if (k < 0.02) return; const b = this.b, root = this.root; root.getWorldQuaternion(_q); const ax = _a.set(1, 0, 0).applyQuaternion(_q).clone();
    const sp = clamp((s.swimSp || 0) / 8, 0, 1), amp = (0.22 + 0.5 * sp) * k, ph = this.sw * 6.283 * 2;
    for (const [side, off] of [['L', 0], ['R', Math.PI]]) {
      const th = Math.sin(ph + off) * amp + 0.12 * k, ca = (0.5 + 0.5 * Math.sin(ph + off - 0.9)) * (0.3 + 0.6 * sp) * k;
      rotWorld(b[side + 'Thigh'], new THREE.Quaternion().setFromAxisAngle(ax, th)); rotWorld(b[side + 'Calf'], new THREE.Quaternion().setFromAxisAngle(ax, ca));
    }
    root.updateMatrixWorld(true);
  }
  /** keeps the lowest foot on the floor: the clips' own bob / the frozen pelvis would otherwise float or sink him by up to 30 cm */
  plantFeet(dt, s) {
    const rig = this.rig, root = this.root, b = this.b, mg = rig.modelGroup; mg.position.y = rig.groundY; root.updateMatrixWorld(true);
    const a = s.act, air = (s.swim || 0) > 0.3 || s.dead || (a && (a.name === 'jump' && a.jph === 'air'));
    const inv = _q3.identity(); const m = this._inv || (this._inv = new THREE.Matrix4()); m.copy(root.matrixWorld).invert();
    const yL = _a.setFromMatrixPosition(b.LToe.matrixWorld).applyMatrix4(m).y, yR = _b.setFromMatrixPosition(b.RToe.matrixWorld).applyMatrix4(m).y; void inv;
    const want = air ? 0 : clamp(this.toeRef - Math.min(yL, yR), -0.4, 0.4); this.footD = damp(this.footD, want, 28, dt); mg.position.y = rig.groundY + this.footD; root.updateMatrixWorld(true);
  }
  /** two-bone analytic IK toward a root-local target; bones are rotated by shortest-arc world deltas so the clip's own twist / hand pose survive */
  armIK(side, tgtLocal, w) {
    const b = this.b, root = this.root, U = b[side + 'Upper'], F = b[side + 'Fore'], H = b[side + 'Hand'];
    const pS = U.getWorldPosition(_a).clone(), pE = F.getWorldPosition(_b).clone(), pH = H.getWorldPosition(_c).clone();
    const l1 = pS.distanceTo(pE), l2 = pE.distanceTo(pH); const T = _d.copy(tgtLocal).applyMatrix4(root.matrixWorld).clone();
    const dv = T.clone().sub(pS); let dist = dv.length(); const maxD = (l1 + l2) * 0.985, minD = Math.abs(l1 - l2) + 0.05; dist = clamp(dist, minD, maxD); dv.normalize(); const Tc = pS.clone().addScaledVector(dv, dist);
    const sg = (side === 'L' ? 1 : -1) * this.Lsign; const poleL = _e.set(sg * 1.0, -0.55, -0.55); const pole = poleL.clone().transformDirection(root.matrixWorld);
    const perp = pole.addScaledVector(dv, -pole.dot(dv)); if (perp.lengthSq() < 1e-6) perp.set(0, -1, 0); perp.normalize();
    const aa = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist), hh = Math.sqrt(Math.max(l1 * l1 - aa * aa, 0)); const elbow = pS.clone().addScaledVector(dv, aa).addScaledVector(perp, hh);
    const q0U = U.quaternion.clone(), q0F = F.quaternion.clone();
    const q1 = new THREE.Quaternion().setFromUnitVectors(pE.clone().sub(pS).normalize(), elbow.clone().sub(pS).normalize()); rotWorld(U, q1);
    const pE2 = F.getWorldPosition(new THREE.Vector3()), pH2 = H.getWorldPosition(new THREE.Vector3());
    const q2 = new THREE.Quaternion().setFromUnitVectors(pH2.clone().sub(pE2).normalize(), Tc.clone().sub(pE2).normalize()); rotWorld(F, q2);
    if (w < 0.999) { U.quaternion.copy(q0U).slerp(U.quaternion, w); F.quaternion.copy(q0F).slerp(F.quaternion, w); U.updateMatrixWorld(true); }
  }
  // ---- the four facial tentacles ----------------------------------------------------------------------------------------------------------------------------------------------
  tentacles(dt, s) {
    const rig = this.rig, o = this.owner, T = o && o.tent; const chains = rig.feelers;
    for (let i = 0; i < chains.length; i++) {
      const ch = chains[i]; if (!ch.length) continue; const f = this.fl[i];
      // idle sway: tiny local rotations on top of the clip
      const swA = 1 + 2.2 * (s.swim || 0); for (let k = 0; k < ch.length; k++) { const ph = this.t * (1.1 + i * 0.13) + k * 0.8 + i; ch[k].rotateY(Math.sin(ph) * 0.05 * swA); ch[k].rotateX(Math.cos(ph * 0.9) * 0.04 * swA); }
      if ((s.swim || 0) > 0.05 && s.sv && !(T && T.ext > 0.01)) {                                                  // underwater the tentacles trail behind the swimming direction
        const spd = s.sv.length(), w = smooth(spd, 0.5, 6) * 0.7 * s.swim; if (w > 0.01) { ch[0].updateMatrixWorld(true); const p0 = ch[0].getWorldPosition(_a).clone(), p1 = rig.markers['tip' + i].getWorldPosition(_b).clone(), cur = p1.sub(p0).normalize(), want = _c.copy(s.sv).multiplyScalar(-1 / spd); const q = new THREE.Quaternion().setFromUnitVectors(cur, want); q.slerp(new THREE.Quaternion(), 1 - w); rotWorld(ch[0], q); }
      }
      ch[0].scale.z = 1; ch[0].scale.x = 1; ch[0].scale.y = 1;
      if (T && T.ext > 0.01) {
        const ext = T.ext; ch[0].updateMatrixWorld(true); const p0 = ch[0].getWorldPosition(_a).clone(), p1 = rig.markers['tip' + i].getWorldPosition(_b).clone();
        const cur = p1.clone().sub(p0).normalize();
        const spread = (i - 1.5) * (T.spread ?? 0.1); const want = T.dir.clone().add(_c.set(-T.dir.z, 0, T.dir.x).multiplyScalar(spread)).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(cur, want); q.slerp(new THREE.Quaternion(), 1 - ext); rotWorld(ch[0], q);
        const need = Math.max(T.reach, f.len); ch[0].scale.z = lerp(1, need / f.len, ext); ch[0].scale.x = ch[0].scale.y = 1 + 2.2 * ext;
        ch[0].updateMatrixWorld(true);
      }
    }
  }
}

function smooth(x, a, b) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
