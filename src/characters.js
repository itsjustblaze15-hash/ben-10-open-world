// Playable-character manager + the Omnitrix-style green transformation.
// Controllers share one interface: { root, pos, vel, yaw, grounded, mode, activate?(from), deactivate?() }.
// Adding another alien later = register another definition (model, controller, camera profile, HUD panel); nothing else changes.
import * as THREE from 'three';
import { clamp, rand } from './util.js';

const UP = new THREE.Vector3(0, 1, 0);

export class CharacterManager {
  /** @param defs  { id: { name, subtitle, controller, cam:{height,shoulder,dist,fov}, panels:[element ids shown only for this alien], onEnter?, onLeave? } } */
  constructor(game, defs, startId) {
    this.g = game; this.defs = defs; this.order = Object.keys(defs); this.id = startId; this.fxT = -1; this.pending = null; this.switches = 0;
    const mat = new THREE.MeshBasicMaterial({ color: 0x18d84a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false });
    this.orb = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), mat); this.orb.visible = false; this.orb.renderOrder = 20; game.scene.add(this.orb);
    this.flashEl = document.getElementById('gflash');
    this.apply(startId, null, true);
  }
  get def() { return this.defs[this.id]; }
  get controller() { return this.defs[this.id].controller; }
  /** C key: cycle to the next playable alien (no cooldown, no timer, no menu) */
  cycle() { const next = this.order[(this.order.indexOf(this.id) + 1) % this.order.length]; this.switchTo(next); }
  switchTo(id) {
    if (id === this.id && !this.pending) return;
    if (this.pending) { this.finishSwap(); }           // a second press during the 0.1 s flash completes the first swap, then starts the next
    const from = this.controller; this.pending = id; this.fxT = 0; this.swapped = false;
    const p = from.pos, g = this.g;
    // step 1: Omnitrix energy at the chest + expanding ring + green particles
    const sc = from.fxScale || 1, c = new THREE.Vector3(p.x, p.y + 1.15 * sc, p.z); this.orb.position.copy(c); this.orb.visible = true;   // fxScale: the flash is drawn at the character's own size (Way Big 14x)
    g.fx.surface.ring(new THREE.Vector3(p.x, p.y + 0.08, p.z), UP, 6.5 * sc, 0.5, 0x4cff7a);
    g.fx.glow.emit({ pos: c, size: 3.2 * sc, life: 0.18, drag: 0, color: [0.4, 1, 0.5], alpha: 1 });
    for (let i = 0; i < 46; i++) g.fx.glow.emit({ pos: c, vel: new THREE.Vector3(rand(-1, 1), rand(-0.4, 1), rand(-1, 1)).normalize().multiplyScalar(rand(4, 12) * sc), size: rand(0.3, 0.9) * sc, life: rand(0.3, 0.6), drag: 2.2, color: [0.3, 1, 0.45] });
    g.camera.addTrauma(0.2); g.camera.kick(0.06); g.sfx.transform();
  }
  /** step 3-5: replace the character at the flash peak. Position / facing / velocity / camera orientation all carry over. */
  finishSwap() {
    if (!this.pending) return; const id = this.pending; this.pending = null; this.swapped = true; this.apply(id, this.controller, false);
  }
  apply(id, from, first) {
    const d = this.defs[id], g = this.g;
    if (from) { const fd = this.def; if (fd.onLeave) fd.onLeave(); if (from.deactivate) from.deactivate(); else from.root.visible = false; }
    const c = d.controller;
    if (first) for (const o of this.order) { const oc = this.defs[o].controller; if (oc !== c && oc.root) oc.root.visible = false; }      // the first character is the only visible one
    if (from) {
      if (c.activate) c.activate(from);
      else { c.pos.copy(from.pos); c.vel.copy(from.vel); c.yaw = from.yaw; c.grounded = from.grounded; c.mode = from.grounded ? 'ground' : 'air'; c.root.rotation.y = c.yaw; c.root.updateMatrixWorld(true); }
    }
    if (g.impact && g.impact.onSwitch) g.impact.onSwitch();      // the knockback body is shared: a new alien starts with a clean body (no inherited stagger / lean / sticky / grab)
    c.root.visible = true; this.id = id; g.player = c; if (from) this.switches++;
    const cam = g.camera, oldCs = cam.cs || 1; cam.heightGoal = d.cam.height; cam.shoulderGoal = d.cam.shoulder; cam.targetDist = d.cam.dist; cam.baseFov = d.cam.fov; cam.cs = d.cam.cs ?? 1; cam.minD = d.cam.minD ?? null; cam.cam.near = d.cam.near ?? 0.1; cam.cam.far = Math.max(d.cam.far ?? 700, g.world.island ? 3400 : 0); cam.cam.updateProjectionMatrix();   // a 13 cm alien gets a camera scaled to his size (close, low, near plane pulled in)
    if (from && (cam.cs > oldCs * 3 || cam.cs * 3 < oldCs)) { cam.distBonus = 0; cam.speedFov = 0; cam.roll = 0; cam.height = d.cam.height; cam.shoulder = d.cam.shoulder; cam.dist = cam.curDist = d.cam.dist + (cam.distBonus || 0); cam.focus.set(c.pos.x, c.pos.y + d.cam.height, c.pos.z); }   // a change of camera scale (human <-> giant) is hidden by the Omnitrix flash: the camera does not sweep through the new body or the city
    for (const o of this.order) for (const pid of this.defs[o].panels) { const el = document.getElementById(pid); if (el) el.hidden = o !== id; }
    const t = document.getElementById('title'); if (t) { t.querySelector('b').textContent = d.name; t.querySelector('span').textContent = d.subtitle; }
    document.documentElement.style.setProperty('--g', d.accent); document.documentElement.style.setProperty('--line', d.line);
    if (d.onEnter) d.onEnter();
    const ol = document.querySelector('#overlay .logo'); if (ol) ol.textContent = d.name;
    if (from) g.hud.toast(d.name);
  }
  update(dt) {
    if (this.fxT < 0) return; this.fxT += dt; const t = this.fxT, T_SWAP = 0.09, T_END = 0.5;
    if (!this.swapped && t >= T_SWAP) this.finishSwap();
    // the orb follows the character; bright flash peaks at the swap, then expands and fades
    const ctl = this.controller, sc = ctl.fxScale || 1; this.orb.position.set(ctl.pos.x, ctl.pos.y + 1.15 * sc, ctl.pos.z);
    const k = clamp(t / T_END, 0, 1), s = 0.7 + 3.4 * (1 - Math.pow(1 - k, 3));
    this.orb.scale.setScalar(s * sc); this.orb.material.opacity = t < T_SWAP ? 0.62 * t / T_SWAP : 0.62 * Math.pow(1 - clamp((t - T_SWAP) / (T_END - T_SWAP), 0, 1), 1.6);
    if (this.flashEl) { const o = t < T_SWAP ? 0.95 * t / T_SWAP : 0.95 * Math.pow(1 - clamp((t - T_SWAP) / 0.38, 0, 1), 2); this.flashEl.style.opacity = o.toFixed(3); }
    if (t < T_END) { const g = this.g; if (Math.random() < 0.9) g.fx.glow.emit({ pos: new THREE.Vector3(ctl.pos.x + rand(-0.6, 0.6) * sc, ctl.pos.y + rand(0.2, 2.1) * sc, ctl.pos.z + rand(-0.6, 0.6) * sc), vel: new THREE.Vector3(rand(-1, 1), rand(0.5, 3), rand(-1, 1)).multiplyScalar(sc), size: rand(0.2, 0.5) * sc, life: 0.4, drag: 2, color: [0.35, 1, 0.5] }); }
    if (t >= T_END) { this.fxT = -1; this.orb.visible = false; this.orb.material.opacity = 0; if (this.flashEl) this.flashEl.style.opacity = '0'; }
  }
}
