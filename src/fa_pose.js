// Pose helpers for Four Arms: hand targets in the chest frame, keyframe interpolation and pose layering.
import * as THREE from 'three';
import { clamp, lerp } from './util.js';

export const ARMS = ['UL', 'UR', 'LL', 'LR'];
export const SIDE = { UL: 1, UR: -1, LL: 1, LR: -1 };
export const V = (x, y, z) => new THREE.Vector3(x, y, z);
/** chest-frame hand target. out = away from the body (mirrored for the right arms), up, fwd (meters, character scale) */
export const hand = (k, out, up, fwd) => V(SIDE[k] * out, up, fwd);
export const mkPose = () => ({ d: {}, off: [0, 0, 0], ik: {}, curl: {}, w: 1 });
export const arm = (P, k, p, pole = null, twist = 0, frame = 'c', w = 1) => { P.ik[k] = { p, pole, twist, frame, w }; };
export const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const easeOut = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const easeIn = t => { t = clamp(t, 0, 1); return t * t * t; };
const ZERO = [0, 0, 0];
/** smooth keyframes: keys = [[t, value|[values]], ...] */
export function K(t, keys) {
  if (t <= keys[0][0]) return keys[0][1]; const n = keys.length; if (t >= keys[n - 1][0]) return keys[n - 1][1];
  let i = 0; while (keys[i + 1][0] < t) i++; const a = keys[i], b = keys[i + 1], u = smooth((t - a[0]) / (b[0] - a[0]));
  return Array.isArray(a[1]) ? a[1].map((v, j) => lerp(v, b[1][j], u)) : lerp(a[1], b[1], u);
}
/** euler-delta shorthand */
export const D = (x = 0, y = 0, z = 0) => [x, y, z];
/** squat: knee bend that keeps the feet planted. theta = thigh angle; returns the hips drop in meters (scaled) */
export function squat(P, th, spread = 0.1) {
  P.d.thighL = D(-th, 0, spread); P.d.thighR = D(-th, 0, -spread); P.d.kneeL = D(2 * th); P.d.kneeR = D(2 * th); P.d.ankleL = D(-th); P.d.ankleR = D(-th);
  P.off[1] += -2 * 0.64 * (1 - Math.cos(th));
}
const _p = new THREE.Vector3();
/** blend layer A over pose P (A.w = layer weight; each arm in A.ik has its own weight) */
export function layer(P, A, poser) {
  const w = A.w ?? 1; if (w <= 0.001) return P;
  for (const key in A.d) { const a = P.d[key] || ZERO, b = A.d[key]; P.d[key] = [lerp(a[0], b[0], w), lerp(a[1], b[1], w), lerp(a[2], b[2], w)]; }
  if (A.off) for (let i = 0; i < 3; i++) P.off[i] = lerp(P.off[i], A.off[i], w);
  for (const k in A.ik) {
    const e = A.ik[k], wt = clamp((e.w ?? 1) * w, 0, 1), b = P.ik[k]; if (wt <= 0.001) continue;
    if (!b) { P.ik[k] = { ...e, w: 1 }; continue; }
    let bp = b.p, bpole = b.pole, ep = e.p, epole = e.pole, frame = b.frame;
    if (b.frame !== e.frame) {                                    // bring both into character space
      const toW = (p, pole, fr) => fr === 'w' ? [p, pole] : [p.clone().applyQuaternion(poser.Dtc).add(poser.cp), pole ? pole.clone().applyQuaternion(poser.Dtc) : null];
      [bp, bpole] = toW(b.p, b.pole, b.frame); [ep, epole] = toW(e.p, e.pole, e.frame); frame = 'w';
    }
    const np = bp.clone().lerp(ep, wt), npole = bpole && epole ? bpole.clone().lerp(epole, wt) : (epole || bpole);
    P.ik[k] = { p: np, pole: npole, twist: lerp(b.twist || 0, e.twist || 0, wt), frame, w: 1 };
  }
  if (A.curl) for (const k in A.curl) P.curl[k] = lerp(P.curl[k] ?? 0.25, A.curl[k], w);
  return P;
}
