// V33 ULTIMATE WAY BIG + THE MOTHERSHIP FINALE.
//  * evolve(): regular Way Big -> Ultimate Way Big (UWB). A 3.4 s transformation (growing silhouette, energy, cross-fade to the supplied GLB, camera pull-back). Size comes from the ship: the chest ends up at the mother ship's main-body height.
//    The supplied GLB has its own (MMD-style) skeleton, so the hidden Way Big rig keeps driving all gameplay / IK and the UWB bones copy its world-space bone rotations (rotation-delta retarget). Nothing in the GLB is edited.
//  * the finale: only UWB, near the ship, after Vilgax has retreated aboard: reach -> connect (ship shakes) -> pull it out of its hover and lift it overhead -> (manual) wind-up -> throw on an animated arc to the southern ocean ->
//    huge splash / waves / explosion -> the ship settles, PARTIALLY SUNK, as a permanent saved wreck -> Vilgax is defeated and the invasion ends. The ship is a scripted body here, never an unrestricted rigid body.
import * as THREE from 'three';
import { clamp, rand } from '../util.js';
import { SEA } from './layout.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), Q = () => new THREE.Quaternion();
const ease = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const FN = { key: 'ben10.finale.v33', Vf: 1.5, pwr: 2, evolveT: 3.4, reachT: 1.7, pullT: 2.6, windT: 1.5, flyT: 5.6, sinkT: 7, apex: 260, grabRange: 360, target: { x: -150, z: 430 }, wreckY: -28, wreckPitch: -0.3, wreckRoll: 0.1, hairH: 80 };
// the supplied GLB's skeleton, depth-first (node ids) -> which hidden Way Big bone drives it
const UW_MAP = (rig) => {
  const B = rig.bones, A = rig.arms, L = rig.legs;
  return [[18, B.hips], [36, B.spine], [37, B.spine2], [90, B.neck], [91, B.head],
    [40, A.R.sh], [41, A.R.a], [43, A.R.e], [45, A.R.w], [66, A.L.sh], [67, A.L.a], [69, A.L.e], [71, A.L.w],
    [19, L.R.hip], [20, L.R.knee], [21, L.R.ankle], [22, L.R.toe], [31, L.L.hip], [32, L.L.knee], [33, L.L.ankle], [34, L.L.toe]];
};

export class Finale {
  constructor(game, loadGLB) {
    this.g = game; this.loadGLB = loadGLB; this.ult = false; this.phase = 'idle'; this.t = 0; this.gs = 'none'; this.gt = 0; this.U = 1; this.uTarget = 5; this.uwb = null; this.error = null; this.loaded = false;
    this.wreck = false; this.sunk = 0; this.fx = []; this.stats = { evolutions: 0, grabs: 0, throws: 0, impacts: 0 }; this.camBase = null; this.splashT = 0; this.smokeT = 0; this.prompt = null; this.shake = 0;
    const sh = game.mothership; sh.fin = { mode: 'hover', pos: V(), rx: 0, ry: 0, rz: 0 }; this.F = sh.fin;
    this.buildDom(); this.buildFx(); this.load();
    try { const rs = new URLSearchParams(location.search).get('ship') === 'reset', s = JSON.parse(localStorage.getItem(FN.key) || 'null'); if (s && s.wreck && !rs) this.wreck = true; else if (rs) this.save(); } catch { /* ignore */ }
  }
  get wb() { return this.g.wb; }
  get ship() { return this.g.mothership; }
  isWB() { return this.g.chars && this.g.chars.id === 'waybig'; }
  busy() { return this.phase === 'evolving' || (this.gs !== 'none' && this.gs !== 'done'); }
  save() { try { localStorage.setItem(FN.key, JSON.stringify({ wreck: this.wreck, x: this.F.pos.x, z: this.F.pos.z })); } catch { /* ignore */ } }
  reset() {
    this.wreck = false; this.gs = 'none'; this.F.mode = 'hover'; this.save(); this.sunk = 0; for (const w of this.fx) w.mesh.visible = false; this.splashT = 0;
    if (this.ult) this.deevolve(true); if (this.wb) { this.wb.frozen = false; this.wb.shipPose = null; }
  }
  // ---------------------------------------------------------------------------------------------------- DOM
  buildDom() {
    const b = document.createElement('button'); b.id = 'uwb-btn'; b.type = 'button'; b.hidden = true; b.innerHTML = 'ULTIMATE WAY BIG <i>T</i>'; document.body.appendChild(b);
    b.addEventListener('click', e => { e.preventDefault(); this.evolve(); b.blur(); }); this.btn = b;
    const p = document.createElement('div'); p.id = 'uwb-prompt'; p.hidden = true; document.body.appendChild(p); this.promptEl = p;
    const s = document.createElement('div'); s.id = 'uwb-badge'; s.hidden = true; s.textContent = 'ULTIMATE WAY BIG'; document.body.appendChild(s); this.badge = s;
    const m = document.createElement('div'); m.id = 'inv-won'; m.hidden = true; m.textContent = 'VILGAX INVASION DEFEATED'; document.body.appendChild(m); this.won = m;
  }
  setPrompt(t) { if (t === this.prompt) return; this.prompt = t; this.promptEl.hidden = !t; if (t) this.promptEl.innerHTML = t; }
  // ---------------------------------------------------------------------------------------------------- UWB model
  async load() {
    try {
      const gltf = await this.loadGLB('ultimate_waybig'), wb = this.wb, rig = wb.rig, scene = gltf.scene, G = new THREE.Group(); G.add(scene);
      const bones = []; scene.traverse(o => { if (o.isBone) bones.push(o); });
      const skinned = []; scene.traverse(o => { if (o.isSkinnedMesh) { o.frustumCulled = false; o.castShadow = true; o.receiveShadow = false; skinned.push(o); } else if (o.isMesh) o.frustumCulled = false; });
      const mats = []; for (const m of skinned) for (const x of (Array.isArray(m.material) ? m.material : [m.material])) { x.side = THREE.DoubleSide; mats.push(x); }
      G.updateMatrixWorld(true); const bx = new THREE.Box3().setFromObject(scene), size = bx.getSize(V());
      // feet on y = 0 and the hips centred (a pure translation of the file's scene)
      const byNode = id => bones[UW_ORDER.indexOf(id)];
      const hips = byNode(18), hp = V().setFromMatrixPosition(hips.matrixWorld); scene.position.set(-hp.x, -bx.min.y, -hp.z); G.updateMatrixWorld(true);
      const bx2 = new THREE.Box3().setFromObject(scene), h = bx2.getSize(V()).y, s2 = 80 / h;
      const chest = byNode(38), chestY = V().setFromMatrixPosition(chest.matrixWorld).y - bx2.min.y;
      this.chestRatio = chestY / h; this.uwbH = h;
      const map = UW_MAP(rig).map(([id, wbBone]) => { const ub = byNode(id); return { ub, wbBone, restQ: ub.getWorldQuaternion(Q()), parentRestLocal: ub.quaternion.clone(), wbRestQ: null, rest: id === 18 ? V().setFromMatrixPosition(ub.matrixWorld) : null }; });
      G.scale.setScalar(s2); G.position.set(0, -wb.PIV, 0); G.visible = false; wb.tiltG.add(G);
      for (const m of map) { const inf = rig.info.get(m.wbBone); m.wbRestModelQ = inf.restModelQ.clone(); m.wbRestModelP = inf.restModelP.clone(); }
      this.uwb = { G, scene, map, mats, skinned, s2, restHipsLocal: map[0].rest.clone() };
      this.loaded = true;
    } catch (e) { this.error = String(e && e.message || e); console.error('ULTIMATE WAY BIG GLB FAILED:', e); }
  }
  /** copy the hidden Way Big rig's world rotations onto the supplied model's bones (rotation delta transfer) + its hip travel */
  retarget() {
    const u = this.uwb, wb = this.wb, rig = wb.rig; if (!u || !u.G.visible) return;
    const mg = rig.modelGroup; mg.updateMatrixWorld(true); u.G.updateMatrixWorld(true);
    const mgq = mg.getWorldQuaternion(Q()), D = Q(), cur = Q(), rest = Q(), nw = Q(), pq = Q();
    for (let i = 0; i < u.map.length; i++) {
      const m = u.map[i], b = m.wbBone; b.getWorldQuaternion(cur); rest.copy(mgq).multiply(m.wbRestModelQ);
      D.copy(cur).multiply(rest.invert());                                       // world delta = cur * rest^-1
      const Gq = u.G.getWorldQuaternion(Q());
      nw.copy(D).multiply(Gq.multiply(m.restQ));                                  // D * (uwb rest in world)
      const par = m.ub.parent; par.updateWorldMatrix(true, false); par.getWorldQuaternion(pq);
      m.ub.quaternion.copy(pq.invert().multiply(nw)); m.ub.updateMatrixWorld(true);
      if (i === 0) {                                                              // hips travel (world offset of the Way Big hips from his rest)
        const wp = V().setFromMatrixPosition(b.matrixWorld), rp = mg.localToWorld(m.wbRestModelP.clone()), d = wp.sub(rp);
        const target = u.G.localToWorld(u.restHipsLocal.clone()).add(d), lp = par.worldToLocal(target); m.ub.position.copy(lp); m.ub.updateMatrixWorld(true);
      }
    }
  }
  // ---------------------------------------------------------------------------------------------------- evolve / revert
  canEvolve() { return this.isWB() && !this.ult && this.phase === 'idle' && this.wb.alive && !this.wb.act && !this.wb.hold; }
  evolve() {
    const g = this.g; if (!this.isWB() || this.ult || this.phase !== 'idle') return false;
    const wb = this.wb; if (wb.act || wb.hold) { g.hud.toast('FINISH YOUR MOVE FIRST'); return false; }
    const sh = this.ship, gy = g.world.groundAt(wb.pos.x, wb.pos.z, wb.pos.y + 40, 200, 0.3), chestY = (sh && sh.loaded ? sh.dest.y : 240) - Math.max(0, gy);
    this.uTarget = clamp(chestY / (this.chestRatio || 0.57) / 80, 3, 7.5);        // computed: chest height = the ship's main-body height
    this.phase = 'evolving'; this.t = 0; this.stats.evolutions++; wb.frozen = true; this.fl = 0; this.matFade = false; this.camK = 1;
    g.hud.toast('ULTIMATE WAY BIG — EVOLVING'); g.sfx.boom && g.sfx.boom(0.5); g.camera.addTrauma(0.5);
    return true;
  }
  applyCam(k) {
    const g = this.g, d = g.chars.defs.waybig.cam, c = g.camera; if (!this.camBase) this.camBase = { ...d };
    const B = this.camBase; d.height = B.height * (1 + (k - 1) * 1.15); d.shoulder = B.shoulder * k; d.dist = B.dist * (1 + (k - 1) * 1.4); d.cs = (B.cs || 1) * k; d.minD = B.minD * k; d.near = Math.max(B.near, B.near * k * 0.7); d.far = Math.max(B.far, 3400 * Math.max(1, k * 0.6));
    c.heightGoal = d.height; c.shoulderGoal = d.shoulder; c.targetDist = d.dist; c.cs = d.cs; c.minD = d.minD; c.cam.near = d.near; c.cam.far = d.far; c.cam.updateProjectionMatrix();
  }
  restoreCam() { const g = this.g; if (!this.camBase) return; Object.assign(g.chars.defs.waybig.cam, this.camBase); }
  /** back to ordinary Way Big (Omnitrix revert / switching alien / reset) */
  deevolve(silent = false) {
    const wb = this.wb; if (!this.ult && this.phase === 'idle' && wb.U === 1) return;
    this.ult = false; this.phase = 'idle'; wb.frozen = false; wb.shipPose = null; wb.setU(1, 1, 1); wb.rig.modelGroup.visible = true; this.fadeMats(1, true); if (this.uwb) this.uwb.G.visible = false; this.U = 1; this.restoreCam(); void silent;
    if (this.gs !== 'none' && this.gs !== 'done') this.gs = 'none';
    this.refreshUi();
  }
  fadeMats(k, restore) {
    const mats = this.wb.rig.mats; for (const m of mats) { if (restore) { m.opacity = 1; m.transparent = !!m.userData.wasT; } else { if (m.userData.wasT === undefined) m.userData.wasT = m.transparent; m.transparent = true; m.opacity = k; } m.needsUpdate = false; }
    const u = this.uwb; if (u) for (const m of u.mats) { if (restore) { m.opacity = 1; m.transparent = false; } else { m.transparent = true; m.opacity = 1 - k; } }
  }
  refreshUi() {
    const wbOn = this.isWB(), show = wbOn && !this.ult && this.phase === 'idle' && !this.wb.frozen;
    this.btn.hidden = !show; this.badge.hidden = !(wbOn && (this.ult || this.phase === 'evolving'));
  }
  stepEvolve(wdt) {
    const wb = this.wb, g = this.g, t = this.t += wdt, T = FN.evolveT, p = clamp(t / T, 0, 1);
    const gr = ease((t - 0.35) / 2.3), U = 1 + (this.uTarget - 1) * gr;
    wb.setU(U, 1, 1); this.U = U; this.applyCam(U);
    // energy: orbiting sparks + a ground ring pulse + chest glow, strongest while the model swaps
    const c = wb.pos; if (Math.random() < 0.9) { const a = rand(0, 6.283), r = rand(0.5, 1) * 22 * U; g.fx.glow.emit({ pos: V(c.x + Math.cos(a) * r, c.y + rand(0.05, 0.9) * 80 * U, c.z + Math.sin(a) * r), vel: V(0, rand(8, 22) * U, 0), size: rand(2, 6) * U, life: rand(0.5, 1), drag: 0.5, color: [1, rand(0.45, 0.8), 0.2], alpha: 0.9 }); }
    if (t < 0.1 || Math.abs(t - 1.2) < wdt || Math.abs(t - 2.4) < wdt) g.fx.surface.ring(V(c.x, c.y + 0.3, c.z), V(0, 1, 0), 30 * U, 0.9, 0xffa040);
    g.fx.glow.emit({ pos: V(c.x, c.y + 56 * U, c.z), size: (10 + 70 * Math.sin(p * Math.PI)) * U, life: 0.12, drag: 0, color: [1, 0.7, 0.3], alpha: 0.7 });
    g.camera.addTrauma && (t % 0.5 < wdt) && g.camera.addTrauma(0.25 + 0.2 * p);
    // model swap: Way Big fades out, the supplied UWB fades in (2.0 - 2.9 s)
    const sw = clamp((t - 2.0) / 0.9, 0, 1);
    if (sw > 0 && this.uwb) { this.uwb.G.visible = true; this.fadeMats(sw); } else if (sw > 0 && !this.uwb) { /* model missing: keep the scaled Way Big */ }
    if (t >= T) {
      this.phase = 'idle'; this.ult = true; wb.frozen = false; wb.setU(this.uTarget, FN.Vf, FN.pwr); this.U = this.uTarget; wb.hp = wb.maxHp;
      if (this.uwb) { wb.rig.modelGroup.visible = false; this.fadeMats(1, true); this.uwb.G.visible = true; }
      // safe placement: stand on the ground, out of any solid
      const gy = g.world.groundAt(wb.pos.x, wb.pos.z, wb.pos.y + 60, 300, 0.3); if (gy > -1) wb.pos.y = Math.max(wb.pos.y, gy);
      g.hud.toast('ULTIMATE WAY BIG'); this.refreshUi(); g.camera.addTrauma(0.7);
    }
  }
  // ---------------------------------------------------------------------------------------------------- the finale
  nearShip() { const sh = this.ship, w = this.wb; if (!sh || !sh.loaded) return false; return Math.hypot(w.pos.x - sh.pos.x, w.pos.z - sh.pos.z) < FN.grabRange; }
  canGrab() { const iv = this.g.invasion; return this.ult && this.gs === 'none' && !this.wreck && iv && iv.state === 'VILGAX_ABOARD' && this.nearShip() && this.phase === 'idle'; }
  onKey(code) {
    if (code === 'KeyT') { if (this.isWB() && !this.ult) { this.evolve(); return true; } return false; }
    if (!this.isWB() || !this.ult) return false;
    if (code === 'KeyE') { if (this.gs === 'held') { this.startThrow(); return true; } if (this.canGrab()) { this.startGrab(); return true; } return this.gs !== 'none' && this.gs !== 'done'; }
    return false;
  }
  onClick() { if (this.gs === 'held') { this.startThrow(); return true; } return this.gs !== 'none' && this.gs !== 'done'; }
  startGrab() {
    const g = this.g, wb = this.wb, sh = this.ship; this.gs = 'reach'; this.gt = 0; this.stats.grabs++; if (g.invasion) g.invasion.go('MOTHERSHIP_GRABBED'); wb.frozen = true; wb.cancelAll && wb.cancelAll();
    this.F.mode = 'grabbed'; this.F.pos.copy(sh.pos); this.F.rx = this.F.rz = 0; this.F.ry = 0; this.p0 = sh.pos.clone(); this.shake = 0;
    const dx = sh.pos.x - wb.pos.x, dz = sh.pos.z - wb.pos.z; this.faceYaw = Math.atan2(dx, dz); g.hud.toast('GRABBING THE MOTHERSHIP');
  }
  startThrow() {
    if (this.gs !== 'held') return; this.gs = 'wind'; this.gt = 0; this.stats.throws++; this.g.hud.toast('THROW!');
    const t = FN.target, wb = this.wb; this.faceYaw = Math.atan2(t.x - wb.pos.x, t.z - wb.pos.z);
  }
  holdPoint(out) { const wb = this.wb, U = this.U, Hu = 80 * U, f = V(Math.sin(wb.yaw), 0, Math.cos(wb.yaw)); return out.set(wb.pos.x + f.x * 0.1 * Hu, wb.pos.y + Hu * 1.22, wb.pos.z + f.z * 0.1 * Hu); }
  stepGrab(wdt) {
    const g = this.g, wb = this.wb, F = this.F, sh = this.ship, U = this.U, Hu = 80 * U; this.gt += wdt; const t = this.gt;
    // face the goal smoothly
    let dy = this.faceYaw - wb.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); wb.yaw += dy * Math.min(1, wdt * 3);
    const f = V(Math.sin(wb.yaw), 0, Math.cos(wb.yaw)), side = V(Math.cos(wb.yaw), 0, -Math.sin(wb.yaw));
    const grip = (c, y) => { wb.shipPose = { L: V(c.x + side.x * 0.2 * Hu, y, c.z + side.z * 0.2 * Hu), R: V(c.x - side.x * 0.2 * Hu, y, c.z - side.z * 0.2 * Hu), curl: 0.9, lean: -0.05 }; };
    const jit = (k) => V(rand(-1, 1) * k, rand(-1, 1) * k * 0.5, rand(-1, 1) * k);
    if (this.gs === 'reach') {
      const u = ease(t / FN.reachT), near = V(wb.pos.x + f.x * 0.55 * Hu, wb.pos.y + 0.78 * Hu, wb.pos.z + f.z * 0.55 * Hu);
      const hull = V(clamp(sh.pos.x, near.x - 60, near.x + 60), sh.pos.y - 30, clamp(sh.pos.z, near.z - 60, near.z + 60)); grip(wb.pos.clone().lerp(hull, 0.25 + 0.75 * u), (wb.pos.y + 0.5 * Hu) * (1 - u) + hull.y * u);
      if (t > FN.reachT * 0.85) { F.pos.copy(this.p0).add(jit(3 * (t - FN.reachT * 0.85))); this.fxShake(wdt, 0.5); }
      if (t >= FN.reachT) { this.gs = 'pull'; this.gt = 0; this.p1 = F.pos.clone(); g.hud.toast('MOTHERSHIP GRABBED'); g.camera.addTrauma(0.7); g.sfx.boom && g.sfx.boom(0.6); }
    } else if (this.gs === 'pull') {
      const u = ease(t / FN.pullT), hp = this.holdPoint(V()); F.pos.lerpVectors(this.p1, hp, u).add(jit(2.5 * (1 - u))); F.ry = (wb.yaw + Math.PI) * u + this.ry0 * (1 - u) * 0; F.rx = 0.06 * Math.sin(u * 3.14); F.rz = 0;
      grip(F.pos, F.pos.y - 52); this.fxShake(wdt, 0.35); this.shipDust(wdt, 0.8);
      if (t >= FN.pullT) { this.gs = 'held'; this.gt = 0; this.ry0 = F.ry; }
    } else if (this.gs === 'held') {
      const hp = this.holdPoint(V()); hp.y += Math.sin(g.clock ? g.clock.elapsedTime : t * 1.7) * 1.5; F.pos.copy(hp); F.ry = wb.yaw + Math.PI; grip(F.pos, F.pos.y - 52); this.setPrompt('<b>E</b> / <b>CLICK</b> — THROW THE MOTHERSHIP INTO THE SOUTHERN OCEAN'); this.ry0 = F.ry;
    } else if (this.gs === 'wind') {
      const u = ease(t / FN.windT), hp = this.holdPoint(V()); hp.addScaledVector(f, -0.45 * Hu * Math.sin(u * 1.57)); hp.y += 0.2 * Hu * Math.sin(u * 3.14 * 0.5); F.pos.copy(hp); F.ry = wb.yaw + Math.PI + 0.0; F.rx = 0.5 * u; F.rz = 0;
      grip(F.pos, F.pos.y - 52); wb.shipPose.lean = -0.25 * u; this.setPrompt(''); this.fxShake(wdt, 0.25);
      if (t >= FN.windT) { this.gs = 'fly'; this.gt = 0; if (g.invasion) g.invasion.go('MOTHERSHIP_THROWN'); this.pR = F.pos.clone(); this.rxR = F.rx; this.ryR = F.ry; wb.shipPose = { L: wb.W(3, 62, 38), R: wb.W(-3, 62, 38), curl: 0.2, lean: 0.25 }; F.mode = 'thrown'; g.camera.addTrauma(0.8); g.sfx.whoosh && g.sfx.whoosh(); this.chargeFlyCam(); }
    } else if (this.gs === 'fly') {
      const s = clamp(t / FN.flyT, 0, 1), T = FN.target, y1 = FN.wreckY + 70 + 30;
      F.pos.x = this.pR.x + (T.x - this.pR.x) * s; F.pos.z = this.pR.z + (T.z - this.pR.z) * s; F.pos.y = this.pR.y + (y1 - this.pR.y) * s + FN.apex * 4 * s * (1 - s);
      F.rx = this.rxR + (-0.55 - this.rxR) * ease(s * 1.2); F.ry = this.ryR + 0.5 * s; F.rz = 0.45 * Math.sin(s * 6.283);
      if (t > 0.5) wb.shipPose = null;
      this.flightTrail(wdt, s);
      if (wb.frozen && t > 1.2) wb.frozen = false;
      if (s >= 1) this.impact();
    } else if (this.gs === 'sink') {
      const u = ease(t / FN.sinkT), T = FN.target; this.sunk = u;
      F.pos.set(T.x + 14 * u, 30 + (FN.wreckY - 30) * u, T.z); F.rx = -0.55 + (FN.wreckPitch + 0.55) * u; F.ry = this.ryR + 0.5 + 0.12 * u; F.rz = 0.35 * (1 - u) + FN.wreckRoll * u;
      this.splashStep(wdt, t); this.burnStep(wdt, 1 - u * 0.7);
      if (t >= FN.sinkT) this.settle();
    }
  }
  chargeFlyCam() { /* the camera keeps following the player; the ship is huge and stays in frame */ }
  fxShake(wdt, k) { this.g.camera.addTrauma && Math.random() < wdt * 6 && this.g.camera.addTrauma(k * 0.25); }
  shipDust(wdt, k) { const g = this.g, sh = this.F.pos; if (Math.random() < wdt * 30 * k) g.fx.dust.emit({ pos: V(sh.x + rand(-230, 230), sh.y - 59, sh.z + rand(-230, 230)), vel: V(0, -rand(2, 6), 0), size: rand(6, 14), grow: 4, life: rand(1.2, 2.2), drag: 0.6, color: [0.5, 0.5, 0.5], alpha: 0.4 }); }
  flightTrail(wdt, s) {
    const g = this.g, p = this.F.pos; const n = Math.round(60 * wdt) + 1;
    for (let i = 0; i < n; i++) {
      const a = V(p.x + rand(-200, 200), p.y + rand(-50, 40), p.z + rand(-200, 200));
      g.fire.smoke(a, V(rand(-4, 4), rand(-2, 6), rand(-4, 4)), rand(14, 26), rand(2.5, 4));
      if (Math.random() < 0.5) g.fx.glow.emit({ pos: a.clone(), vel: V(rand(-8, 8), rand(-8, 2), rand(-8, 8)), size: rand(10, 24), life: rand(0.4, 0.9), drag: 0.5, color: [1, rand(0.3, 0.6), 0.1], alpha: 0.9 });
    }
    g.camera.addTrauma && Math.random() < wdt * 4 && g.camera.addTrauma(0.2); void s;
  }
  // ---- ocean impact
  buildFx() {
    const g = this.g, mk = (geo, color, op) => { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })); m.visible = false; m.frustumCulled = false; m.renderOrder = 14; g.scene.add(m); return { mesh: m, t: 0, life: 1, op, kind: 'wall', r0: 1, r1: 1, h0: 1, h1: 1 }; };
    const cyl = new THREE.CylinderGeometry(1, 1.15, 1, 40, 1, true); cyl.translate(0, 0.5, 0);
    this.fx = [mk(cyl, 0xcfe8ff, 0.5), mk(cyl, 0xe9f6ff, 0.35), mk(cyl, 0xbfdcff, 0.25), mk(cyl, 0xffffff, 0.3)];
  }
  wall(i, x, z, r0, r1, h0, h1, life, delay = 0) { const w = this.fx[i]; w.t = -delay; w.life = life; w.r0 = r0; w.r1 = r1; w.h0 = h0; w.h1 = h1; w.mesh.position.set(x, SEA, z); w.live = true; }
  impact() {
    const g = this.g, T = FN.target, F = this.F, wb = this.wb; this.gs = 'sink'; this.gt = 0; this.stats.impacts++; this.splashT = 0; this.burnT = 0;
    F.pos.set(T.x, 30, T.z); const c = V(T.x, SEA + 1, T.z);
    g.camera.addTrauma(1); g.sfx.boom && g.sfx.boom(1); g.sfx.crash && g.sfx.crash(0.9);
    // the wall of water + shock rings + fire + smoke (all pooled / bounded)
    this.wall(0, T.x, T.z, 60, 420, 140, 40, 3.2); this.wall(1, T.x, T.z, 30, 300, 220, 30, 2.6, 0.15); this.wall(2, T.x, T.z, 90, 640, 80, 14, 4.5, 0.5); this.wall(3, T.x, T.z, 20, 180, 320, 10, 1.8);
    for (let i = 0; i < 6; i++) g.fx.surface.ring(V(T.x, SEA + 0.4, T.z), V(0, 1, 0), 80 + i * 110, 3.5 + i * 0.4, i % 2 ? 0xbfe4ff : 0xffffff);
    g.fire.explode(V(T.x, 20, T.z), 120, 0, 40, { owner: { root: { position: c } }, big: true, fuel: false, wall: 0.5, skip: () => true, scorch: 0 });
    for (let i = 0; i < 70; i++) { const a = rand(0, 6.283), sp = rand(40, 140); g.fx.glow.emit({ pos: V(T.x + Math.cos(a) * rand(0, 120), SEA + rand(0, 40), T.z + Math.sin(a) * rand(0, 120)), vel: V(Math.cos(a) * sp * 0.5, rand(50, 160), Math.sin(a) * sp * 0.5), size: rand(8, 26), life: rand(1.6, 3.4), drag: 0.25, color: i % 3 ? [0.85, 0.93, 1] : [1, 0.55, 0.2], alpha: 0.85 }); }
    for (let i = 0; i < 26; i++) g.fire.smoke(V(T.x + rand(-170, 170), rand(10, 80), T.z + rand(-170, 170)), V(rand(-6, 6), rand(14, 36), rand(-6, 6)), rand(40, 90), rand(5, 9));
    const d = Math.hypot(wb.pos.x - T.x, wb.pos.z - T.z); void d;
    // Vilgax is on board: the invasion ends with the crash
    const iv = g.invasion; if (iv) iv.vilgaxDefeated();
  }
  splashStep(wdt, t) {
    const g = this.g, T = FN.target; this.splashT += wdt; if (t < 3.5) { const n = Math.round(30 * wdt) + 1; for (let i = 0; i < n; i++) { const a = rand(0, 6.283), r = rand(30, 260 + 60 * t); g.fx.dust.emit({ pos: V(T.x + Math.cos(a) * r, SEA + rand(0, 20), T.z + Math.sin(a) * r), vel: V(Math.cos(a) * 14, rand(30, 90), Math.sin(a) * 14), size: rand(16, 40), grow: 14, life: rand(1.6, 2.8), drag: 0.9, color: [0.88, 0.94, 1], alpha: 0.5 }); } }
    if (t < 6 && Math.random() < wdt * 1.5) g.fx.surface.ring(V(T.x, SEA + 0.4, T.z), V(0, 1, 0), 120 + 60 * t, 3.2, 0xcfe8ff);
  }
  burnStep(wdt, k) {
    const g = this.g, p = this.F.pos; this.burnT += wdt; if (this.burnT > 0.12) { this.burnT = 0; const a = V(p.x + rand(-200, 200), Math.max(SEA + 4, p.y + rand(20, 80)), p.z + rand(-110, 110)); g.fire.smoke(a, V(rand(-3, 3), rand(10, 26), rand(-3, 3)), rand(26, 60) * k, rand(5, 9)); if (Math.random() < 0.6) g.fx.glow.emit({ pos: a.clone(), vel: V(rand(-14, 14), rand(10, 50), rand(-14, 14)), size: rand(8, 20), life: rand(0.8, 1.8), drag: 0.4, color: [1, rand(0.35, 0.6), 0.12], alpha: 0.85 }); if (Math.random() < 0.3) g.fire.flame && g.fire.flame(a.clone(), V(0, 12, 0), rand(6, 12), 0.7, 1); }
  }
  settle() {
    const g = this.g, F = this.F; this.gs = 'done'; this.wreck = true; F.mode = 'wreck'; this.sunk = 1; this.save(); this.setPrompt(''); this.wb.frozen = false; this.wb.shipPose = null;
    for (const w of this.fx) w.live = false; g.hud.toast('THE MOTHERSHIP HAS CRASHED INTO THE OCEAN');
  }
  /** restore a saved wreck on load (no animation) */
  applyWreck() {
    const F = this.F, T = FN.target; F.mode = 'wreck'; F.pos.set(T.x + 14, FN.wreckY, T.z); F.rx = FN.wreckPitch; F.ry = Math.PI * 0.5 + 0.62 + 0.12; F.rz = FN.wreckRoll; this.sunk = 1; this.gs = 'done';
  }
  // ---------------------------------------------------------------------------------------------------- per-frame
  step(wdt) {
    const g = this.g, wb = this.wb; if (!wb) return;
    if (this.wreck && this.F.mode !== 'wreck' && this.gs !== 'sink') this.applyWreck();
    if (this.phase === 'evolving') this.stepEvolve(wdt);
    if (this.gs !== 'none' && this.gs !== 'done') this.stepGrab(wdt);
    // leaving Way Big (Omnitrix revert / swap) always returns the ordinary size
    if ((this.ult || wb.U !== 1) && !this.isWB() && this.phase !== 'evolving') this.deevolve();
    if (this.phase === 'evolving' && !this.isWB()) { this.phase = 'idle'; this.deevolve(); }
    // prompt / button
    let pr = ''; if (this.isWB() && this.ult && this.gs === 'none' && !this.wreck) { const iv = g.invasion; if (this.canGrab()) pr = '<b>E</b> — GRAB MOTHERSHIP'; else if (iv && iv.state === 'VILGAX_ABOARD' && this.phase === 'idle') pr = 'WALK UNDER THE MOTHERSHIP, THEN PRESS <b>E</b> TO GRAB IT'; }
    if (this.gs === 'held') pr = this.prompt; if (this.gs === 'none' || this.gs === 'done') this.setPrompt(pr);
    this.refreshUi(); void wdt;
  }
  visual(dt) {
    for (const w of this.fx) { if (!w.live) { if (w.mesh.visible && w.t >= w.life) w.mesh.visible = false; continue; } w.t += dt; if (w.t < 0) { w.mesh.visible = false; continue; } const u = clamp(w.t / w.life, 0, 1); if (u >= 1) { w.live = false; w.mesh.visible = false; continue; }
      const r = w.r0 + (w.r1 - w.r0) * (1 - (1 - u) * (1 - u)), h = w.h0 + (w.h1 - w.h0) * u; w.mesh.visible = true; w.mesh.scale.set(r, h, r); w.mesh.material.opacity = w.op * (1 - u) * Math.min(1, u * 8); }
    if (this.wreck && this.gs === 'done') { this.smokeT -= dt; if (this.smokeT <= 0) { this.smokeT = 0.5; const g = this.g, p = this.F.pos, cam = g.camera.camera; if (cam && cam.position.distanceTo(p) < 1800 && (this.wreckSmoke = (this.wreckSmoke || 0) + 1) < 400) g.fire.smoke(V(p.x + rand(-150, 150), p.y + 60 + rand(0, 40), p.z + rand(-80, 80)), V(rand(-2, 2), rand(8, 16), rand(-2, 2)), rand(30, 55), rand(6, 10)); } }
    this.retarget();
  }
  hud() { /* ui handled in step */ }
}
const UW_ORDER = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113];
