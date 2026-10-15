// Grey Matter's technology layer. Only COMPATIBLE devices have an access port at their base, and every prompt comes from a real nearby device in a real state:
//   console / terminal  (existing TechSystem consoles + a security console)  E: hack (circuit puzzle) -> terminal interface -> functions really run (turrets, floodlights, bay door, cameras ...); Q: run the selected function
//   electronic door     (existing bay door + the vault door)                 E: hack / inspect, Q: open / close (once unlocked)
//   generator           E (hold): REPAIR (progress bar) -> Q: start / stop -> power really flows, lamps light, powered devices wake up
//   circuit panel       E: circuit puzzle (needs power) -> the vault door unlocks and opens
//   security camera     sweeping cone; spotting the player alerts the guards; a security console disables it (it then really stops detecting)
//   turret control box  E: hack, Q: take over the turret (it fires its own bolts at LMB), Q / C / E: release
// No telekinesis, no remote control of machines (that is Upgrade's), no invented power: he works the devices' real controls with his hands.
import * as THREE from 'three';
import { clamp, damp, angleDelta, rand } from './util.js';

const $ = id => document.getElementById(id);
const sin = Math.sin, cos = Math.cos;
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];                     // N E S W as (dc, dr)
const BASE = { I: [1, 0, 1, 0], L: [1, 1, 0, 0], T: [1, 1, 0, 1], X: [0, 0, 0, 0] };
const open = (t) => { const o = [0, 0, 0, 0], b = BASE[t.type]; for (let i = 0; i < 4; i++) o[(i + t.rot) % 4] = b[i]; return o; };

class Circuit {
  constructor(rows, cols, rng) {
    this.R = rows; this.C = cols; this.t = []; let r = 0, c = 0; const path = [[0, 0]], moves = [];
    while (r < rows - 1 || c < cols - 1) { const mv = (r === rows - 1) ? 'E' : (c === cols - 1) ? 'S' : (rng() < 0.5 ? 'E' : 'S'); moves.push(mv); if (mv === 'E') c++; else r++; path.push([r, c]); }
    for (let i = 0; i < rows; i++) { this.t.push([]); for (let j = 0; j < cols; j++) this.t[i].push({ type: ['I', 'L', 'T', 'X', 'L'][Math.floor(rng() * 5)], rot: Math.floor(rng() * 4), path: false }); }
    path.forEach(([pr, pc], i) => {
      const from = i === 0 ? 3 : (moves[i - 1] === 'E' ? 3 : 0), to = i === moves.length ? 1 : (moves[i] === 'E' ? 1 : 2), opp = Math.abs(from - to) === 2, tile = this.t[pr][pc];
      tile.type = opp ? 'I' : 'L'; tile.path = true; for (let rot = 0; rot < 4; rot++) { tile.rot = rot; const o = open(tile); if (o[from] && o[to]) break; }
      tile.solRot = tile.rot;
    });
    do { for (const row of this.t) for (const tile of row) tile.rot = Math.floor(rng() * 4); } while (this.flow().solved);
  }
  flow() {
    const seen = new Set(), q = []; const t0 = this.t[0][0]; if (!open(t0)[3]) return { seen, solved: false };
    q.push([0, 0]); seen.add('0,0'); let solved = false;
    while (q.length) {
      const [r, c] = q.pop(), o = open(this.t[r][c]); if (r === this.R - 1 && c === this.C - 1 && o[1]) solved = true;
      for (let d = 0; d < 4; d++) { if (!o[d]) continue; const nr = r + DIRS[d][1], nc = c + DIRS[d][0]; if (nr < 0 || nc < 0 || nr >= this.R || nc >= this.C || seen.has(nr + ',' + nc)) continue; if (open(this.t[nr][nc])[(d + 2) % 4]) { seen.add(nr + ',' + nc); q.push([nr, nc]); } }
    }
    return { seen, solved };
  }
}
const mulberry = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

export class GmTech {
  constructor(game) {
    this.g = game; this.devs = []; this.cams = []; this.pz = null; this.term = null; this.power = false; this.t = 0; this.cand = null; this.holdDev = null; this.gen = null; this.vault = null;
    this.ctrlDev = null; this.stats = { hacks: 0, repairs: 0, panels: 0, doors: 0, camsDisabled: 0, turretShots: 0, alerts: 0, gadget: 0, terminals: 0 };
    this.portMat = new THREE.MeshStandardMaterial({ color: 0x0c1a14, emissive: 0x18e0a0, emissiveIntensity: 0.8, roughness: 0.4 });
    this.seed = 11;
  }
  get puzzle() { return this.pz || this.term; }
  // ------------------------------------------------------------------------------------------------ device creation
  /** a small access port (an actual mesh on the device) at world (x,y,z) facing out along yaw (direction of the outward normal = (sin yaw, cos yaw)) */
  port(x, y, z, yaw, parent = null, mat = null) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.034, 0.01), mat || this.portMat.clone()); m.position.set(x, y, z); m.rotation.y = yaw; m.userData.noOverlay = true; (parent || this.g.scene).add(m); return m;
  }
  reg(d) { d.reach = d.reach ?? 0.15; d.face = Math.atan2(-sin(d.yaw), -cos(d.yaw)); this.devs.push(d); return d; }
  /** in front of the port (where he stands), as a ground point */
  stand(d) { return _a.set(d.port.x + sin(d.yaw) * 0.04, 0, d.port.z + cos(d.yaw) * 0.04); }
  addConsole(T, opts = {}) {
    const p = T.prop; const snap = Math.round(p.yaw / (Math.PI / 2)) * (Math.PI / 2);
    if (Math.abs(p.yaw - snap) > 1e-3) { p.yaw = snap; if (p.home) p.home.yaw = snap; this.g.props.syncRoot(p); this.g.props.syncBox(p); }     // collision is an axis-aligned box: an angled console would keep its port out of reach, so it is squared up
    const yaw = p.yaw, off = p.size.d / 2 + 0.014, px = p.pos.x + sin(yaw) * off, pz = p.pos.z + cos(yaw) * off, y = 0.1;
    const mesh = this.port(px, y, pz, yaw); const d = this.reg({ kind: 'console', label: T.label, T, port: new THREE.Vector3(px, y, pz), yaw, mesh, unlocked: false, needsPower: !!opts.needsPower, seed: this.seed++, rows: 3, cols: 3 });
    return d;
  }
  addDoorPort(door, x, z, yaw, opts = {}) {
    const y = 0.09, mesh = this.port(x, y, z, yaw); return this.reg({ kind: 'door', label: opts.label || door.label, door, port: new THREE.Vector3(x, y, z), yaw, mesh, unlocked: !!opts.unlocked, needsPower: false, lockedMsg: opts.lockedMsg, seed: this.seed++, rows: 3, cols: 3, vault: !!opts.vault });
  }
  addGenerator(x, z, yaw, world) {
    const g = this.g, root = new THREE.Group(); root.position.set(x, 0, z); root.rotation.y = yaw; g.scene.add(root);
    const metal = new THREE.MeshStandardMaterial({ color: 0x59636b, roughness: 0.5, metalness: 0.6 }), warn = new THREE.MeshStandardMaterial({ color: 0xd9a21c, roughness: 0.6 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.46, 0.4), metal); body.position.y = 0.23; body.castShadow = body.receiveShadow = true; root.add(body);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.05, 0.42), warn); cap.position.y = 0.48; root.add(cap);
    const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.03, 16), new THREE.MeshStandardMaterial({ color: 0x242a30, roughness: 0.5, metalness: 0.7 })); fan.rotation.x = Math.PI / 2; fan.position.set(-0.16, 0.26, 0.205); root.add(fan);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.025, 0.012), warn); blade.position.set(-0.16, 0.26, 0.225); root.add(blade);
    const led = new THREE.MeshStandardMaterial({ color: 0x200000, emissive: 0xff2a1a, emissiveIntensity: 1.6 }); const lm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.02), led); lm.position.set(0.2, 0.34, 0.205); root.add(lm);
    const box = { min: new THREE.Vector3(x - 0.31, 0, z - 0.2), max: new THREE.Vector3(x + 0.31, 0.5, z + 0.2), mesh: body, grip: true }; world.boxes.push(box);        // collision for the generator (yaw 0 only)
    const px = x + sin(yaw) * 0.215, pz = z + cos(yaw) * 0.215, mesh = this.port(px, 0.1, pz, yaw);
    const d = this.reg({ kind: 'generator', label: 'GENERATOR', port: new THREE.Vector3(px, 0.1, pz), yaw, mesh, state: 'broken', prog: 0, fan: blade, led, root, fanPivot: fan });
    this.gen = d; this.setLed(d); return d;
  }
  addPanel(x, z, yaw, parentBox, unlockDoor) {
    const g = this.g, metal = new THREE.MeshStandardMaterial({ color: 0x3d464e, roughness: 0.5, metalness: 0.5 }), led = new THREE.MeshStandardMaterial({ color: 0x200000, emissive: 0xff2a1a, emissiveIntensity: 1.6 });
    const unit = g.world.addBox(x, 0, z, 0.12, 0.24, 0.3, metal, { cast: false }); const b = g.world.boxes[g.world.boxes.length - 1]; b.grip = true; void unit; void parentBox;
    const px = x + sin(yaw) * 0.07, pz = z + cos(yaw) * 0.07, lm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.02), led); lm.position.set(px + sin(yaw) * 0.0, 0.2, pz + cos(yaw) * 0.0); lm.rotation.y = yaw; g.scene.add(lm);
    const mesh = this.port(px, 0.1, pz, yaw); return this.reg({ kind: 'panel', label: 'SECURITY CIRCUIT PANEL', port: new THREE.Vector3(px, 0.1, pz), yaw, mesh, state: 'damaged', led, unlockDoor, seed: this.seed++, rows: 3, cols: 4, needsPower: true });
  }
  addTurretBox(turret, T, x, z, yaw) {
    const g = this.g, metal = new THREE.MeshStandardMaterial({ color: 0x3d464e, roughness: 0.5, metalness: 0.5 }), led = new THREE.MeshStandardMaterial({ color: 0x200000, emissive: 0xff7a1a, emissiveIntensity: 1.4 });
    g.world.addBox(x, 0, z, 0.55, 0.7, 0.34, metal, { cast: true }); const b = g.world.boxes[g.world.boxes.length - 1]; b.grip = true;
    const lm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.02), led); lm.position.set(x + sin(yaw) * 0.175, 0.55, z + cos(yaw) * 0.175); lm.rotation.y = yaw; g.scene.add(lm);
    const px = x + sin(yaw) * 0.18, pz = z + cos(yaw) * 0.18, mesh = this.port(px, 0.1, pz, yaw);
    return this.reg({ kind: 'turretbox', label: 'TURRET CONTROL BOX', turret, T, port: new THREE.Vector3(px, 0.1, pz), yaw, mesh, unlocked: false, seed: this.seed++, rows: 3, cols: 3, led });
  }
  addCamera(x, z, yaw0, sweep, label) {
    const g = this.g, root = new THREE.Group(); root.position.set(x, 0, z); g.scene.add(root);
    const metal = new THREE.MeshStandardMaterial({ color: 0x3a4148, roughness: 0.5, metalness: 0.6 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 2.3, 8), metal); pole.position.y = 1.15; pole.castShadow = true; root.add(pole);
    const head = new THREE.Group(); head.position.y = 2.35; root.add(head);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.42), metal); body.castShadow = true; head.add(body);
    const eye = new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff2020, emissiveIntensity: 2 }); const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 12), eye); lens.rotation.x = Math.PI / 2; lens.position.z = 0.22; head.add(lens);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    cone.userData.noOverlay = true; const range = 9, half = 0.5; cone.geometry.translate(0, -0.5, 0); cone.rotation.x = -Math.PI / 2 - 0.22; cone.scale.set(range * Math.tan(half), range, range * Math.tan(half)); head.add(cone);
    const cam = { root, head, eye, cone, x, z, yaw0, sweep, label, enabled: true, t: rand(0, 6), yaw: yaw0, range, half, seenT: 0, cd: 0, y: 2.35 }; this.cams.push(cam); return cam;
  }
  setLed(d) { if (!d.led) return; const c = d.state === 'broken' ? [1, 0.16, 0.1] : d.state === 'repaired' ? [1, 0.7, 0.1] : [0.1, 1, 0.4]; d.led.emissive.setRGB(c[0], c[1], c[2]); }

  // ------------------------------------------------------------------------------------------------ prompts (only for a real, nearby, compatible device in a state that supports an action)
  ePrompt(d) {
    const k = d.kind;
    if (k === 'generator') return d.state === 'broken' ? 'REPAIR' : 'INTERACT';
    if (k === 'panel') return d.state === 'damaged' ? (this.power ? 'ACCESS PANEL' : 'INTERACT') : 'INTERACT';
    if (k === 'console') return d.unlocked ? 'ACCESS PANEL' : (d.needsPower && !this.power ? 'INTERACT' : 'ACCESS PANEL');
    if (k === 'door') return d.unlocked ? 'INTERACT' : (d.lockedMsg ? 'INTERACT' : 'ACCESS PANEL');
    if (k === 'turretbox') return 'ACCESS PANEL';
    return null;
  }
  qPrompt(d) {
    const k = d.kind;
    if (k === 'generator') return d.state === 'repaired' ? 'START GENERATOR' : d.state === 'running' ? 'STOP GENERATOR' : null;
    if (k === 'door') return d.unlocked ? (d.door.target ? 'CLOSE DOOR' : 'OPEN DOOR') : null;
    if (k === 'console') return d.unlocked ? 'RUN ' + d.T.fns[d.T.sel].name : null;
    if (k === 'turretbox') return d.unlocked ? (this.ctrlDev === d ? 'RELEASE TURRET' : 'CONTROL TURRET') : null;
    return null;
  }
  candidate(P) {
    let best = null, bd = 1e9; if (P.mode === 'climb' || P.mant) return null;
    for (const d of this.devs) {
      const dx = P.pos.x - d.port.x, dz = P.pos.z - d.port.z, dist = Math.hypot(dx, dz), dy = d.port.y - P.pos.y; if (dist > d.reach || dy < -0.03 || dy > 0.22) continue;
      if (!this.ePrompt(d) && !this.qPrompt(d)) continue; if (dist < bd) { bd = dist; best = d; }
    } return best;
  }
  promptHTML(P) {
    if (this.puzzle || !P.root.visible) return ''; const d = this.cand; if (!d || P.tech && !P.tech.hold) return P.tech ? '' : '';
    let h = '<b>' + d.label + '</b>'; const e = this.ePrompt(d), q = this.qPrompt(d);
    if (P.tech && P.tech.hold && this.holdDev === d) return h + '<br>REPAIRING… <span class="gmbar"><i style="width:' + Math.round(d.prog * 100) + '%"></i></span>';
    if (d.kind === 'generator' && d.state === 'broken' && d.prog > 0) h += ' <span class="gmbar"><i style="width:' + Math.round(d.prog * 100) + '%"></i></span>';
    if (e) h += '<br>PRESS E — ' + e; if (q) h += '<br>PRESS Q — ' + q; return h;
  }

  // ------------------------------------------------------------------------------------------------ input
  face(P, d) { return Math.atan2(d.port.x - P.pos.x, d.port.z - P.pos.z); }
  pressE(P) {
    const d = this.cand; if (!d || P.tech || P.mode !== 'ground' && P.mode !== 'landing' || !P.grounded) return; const e = this.ePrompt(d); if (!e) return; const g = this.g, face = this.face(P, d);
    if (d.kind === 'generator' && d.state === 'broken') { d.prog0 = d.prog; if (P.startTech('repair', d.port, face, 3.4 * (1 - d.prog), true, () => this.repaired(d))) this.holdDev = d; return; }
    if (d.kind === 'generator') { P.startTech('inspect', d.port, face, 0.9, false, () => g.hud.toast('GENERATOR · ' + (d.state === 'running' ? 'RUNNING — POWER ONLINE' : 'REPAIRED — PRESS Q TO START'))); P.stats.techUses++; return; }
    if (d.kind === 'panel') {
      if (d.state !== 'damaged') { P.startTech('inspect', d.port, face, 0.8, false, () => g.hud.toast('PANEL REPAIRED — VAULT DOOR UNLOCKED')); return; }
      if (!this.power) { P.startTech('inspect', d.port, face, 1.0, false, () => { g.hud.toast('PANEL DEAD — NO POWER. RESTORE POWER FIRST'); g.sfx.beep(false); }); return; }
      P.startTech('computer', d.port, face, 0.9, false, () => this.openPuzzle(d, 'REPAIR PANEL — RECONNECT THE CIRCUIT', () => this.panelFixed(d))); P.stats.techUses++; return;
    }
    if (d.kind === 'console') {
      if (!d.unlocked && d.needsPower && !this.power) { P.startTech('inspect', d.port, face, 1.0, false, () => { g.hud.toast('TERMINAL DEAD — NO POWER. RESTORE POWER FIRST'); g.sfx.beep(false); }); return; }
      P.startTech('computer', d.port, face, d.unlocked ? 0.6 : 1.0, false, () => d.unlocked ? this.openTerm(d) : this.openPuzzle(d, 'HACK ' + d.label + ' — RECONNECT THE CIRCUIT', () => { d.unlocked = true; this.stats.hacks++; this.openTerm(d); })); P.stats.techUses++; return;
    }
    if (d.kind === 'door') {
      if (d.unlocked) { P.startTech('inspect', d.port, face, 0.7, false, () => this.toggleDoor(d)); P.stats.techUses++; return; }
      if (d.lockedMsg) { P.startTech('inspect', d.port, face, 1.0, false, () => { g.hud.toast(d.lockedMsg()); g.sfx.beep(false); }); return; }
      P.startTech('computer', d.port, face, 1.0, false, () => this.openPuzzle(d, 'UNLOCK ' + d.label + ' — RECONNECT THE CIRCUIT', () => { d.unlocked = true; this.stats.hacks++; this.toggleDoor(d, true); })); P.stats.techUses++; return;
    }
    if (d.kind === 'turretbox') { P.startTech('computer', d.port, face, d.unlocked ? 0.5 : 1.0, false, () => d.unlocked ? g.hud.toast('TURRET LINK READY — PRESS Q TO CONTROL') : this.openPuzzle(d, 'HACK TURRET CONTROL — RECONNECT THE CIRCUIT', () => { d.unlocked = true; this.stats.hacks++; g.hud.toast('TURRET LINK UNLOCKED — PRESS Q TO CONTROL'); })); P.stats.techUses++; }
  }
  releaseE(P) { if (P.tech && P.tech.hold && this.holdDev) { this.holdDev = null; P.endTech(false); } }
  pressQ(P) {
    const g = this.g; if (this.ctrlDev) { this.releaseTurret(P); return; }
    const d = this.cand; if (!d || P.tech) return; const q = this.qPrompt(d); if (!q) return; const face = this.face(P, d); if (P.mode !== 'ground' || !P.grounded) return;
    if (d.kind === 'generator') { P.startTech('gadget', d.port, face, 0.9, false, () => { d.state = d.state === 'running' ? 'repaired' : 'running'; this.power = d.state === 'running'; this.setLed(d); g.tech.setGroup('gm', this.power); g.hud.toast(this.power ? 'GENERATOR RUNNING — POWER RESTORED' : 'GENERATOR STOPPED — POWER OFF'); g.sfx.servo(0.3); }); P.stats.gadgetUses++; this.stats.gadget++; return; }
    if (d.kind === 'door') { P.startTech('gadget', d.port, face, 0.7, false, () => this.toggleDoor(d)); P.stats.gadgetUses++; this.stats.gadget++; return; }
    if (d.kind === 'console') { P.startTech('gadget', d.port, face, 0.7, false, () => { this.runFn(d.T); d.T.sel = (d.T.sel + 1) % d.T.fns.length; d.T.dirty = true; }); P.stats.gadgetUses++; this.stats.gadget++; return; }
    if (d.kind === 'turretbox') { P.startTech('gadget', d.port, face, 0.8, false, () => this.takeTurret(P, d)); P.stats.gadgetUses++; this.stats.gadget++; }
  }
  cancel(P) { this.holdDev = null; if (P.tech) P.tech = null; this.closeAll(P); }
  closeAll(P) { this.pz = null; this.term = null; this.modalEl(false); if (this.ctrlDev) this.releaseTurret(P); }
  repaired(d) { d.state = 'repaired'; d.prog = 1; this.holdDev = null; this.setLed(d); this.stats.repairs++; this.g.hud.toast('GENERATOR REPAIRED — PRESS Q TO START IT'); this.g.sfx.servo(0.35); }
  panelFixed(d) { d.state = 'repaired'; d.led.emissive.setRGB(0.1, 1, 0.4); this.stats.panels++; this.g.hud.toast('PANEL REPAIRED — VAULT DOOR UNLOCKED'); if (d.unlockDoor) { d.unlockDoor.unlocked = true; this.toggleDoor(d.unlockDoor, true); } }
  toggleDoor(d, forceOpen = false) {
    const door = d.door, g = this.g; door.holdOpen = forceOpen ? true : !door.holdOpen; door.keepOpen = door.holdOpen; door.target = door.holdOpen ? 1 : 0; this.stats.doors++; g.sfx.servo(0.3); g.hud.toast(d.label + ' ' + (door.holdOpen ? 'OPEN' : 'CLOSED'));
  }
  runFn(T) {
    const f = T.fns[T.sel], g = this.g; if (f.lvl > T.upgradeLevel) { g.hud.toast(f.name + ' — ADMIN LOCKED (needs Upgrade)'); g.sfx.beep(false); return; }
    f.run(); T.dirty = true; g.sfx.beep(true); g.hud.toast(f.name + ': ' + (f.on() ? 'ON' : 'OFF'));
  }
  // ---- turret takeover: the turret fires its OWN bolts; GM only aims and pulls the trigger
  takeTurret(P, d) {
    const T = d.T; if (!T || T.turret.dead || T.isMerged) { this.g.hud.toast('TURRET UNAVAILABLE'); return; } this.ctrlDev = d; P.ctrlTurret = T; T.turret.override = true; this.g.hud.toast('CONTROLLING TURRET — AIM WITH THE MOUSE, LMB FIRES, Q RELEASES');
  }
  releaseTurret(P) { const d = this.ctrlDev; if (!d) return; this.ctrlDev = null; if (P) P.ctrlTurret = null; if (d.T) d.T.turret.override = this.g.tech.grid.turrets; this.g.hud.toast('TURRET RELEASED'); }
  tickTurret(dt, P, aim) {
    const d = this.ctrlDev; if (!d) return; const T = d.T, t = T.turret, tr = T.tr; if (t.dead) { this.releaseTurret(P); return; }
    const camYaw = P.camYaw, want = Math.atan2(-sin(camYaw), -cos(camYaw)); tr.yaw += angleDelta(tr.yaw, want) * (1 - Math.exp(-10 * dt)); t.yaw = tr.yaw; t.head.rotation.y = tr.yaw;
    t.head.rotation.x = damp(t.head.rotation.x, -clamp(Math.asin(clamp(this.g.camera.aimDir.y, -0.7, 0.7)), -0.4, 0.5) * 0.6, 8, dt); t.root.updateMatrixWorld(true); tr.cool = Math.max(0, tr.cool - dt);
    if (P.lmbHeld && tr.cool <= 0) { tr.cool = 0.6; t.muzzle.getWorldPosition(_a); const origin = _a.clone(), dir = _b.copy(aim).sub(origin).normalize(); this.g.tech.playerBolt(origin, dir, 24, true); this.stats.turretShots++; this.g.camera.addTrauma(0.04); this.g.sfx.zap(0.3); }
    if (Math.hypot(P.pos.x - d.port.x, P.pos.z - d.port.z) > 0.6) this.releaseTurret(P);
  }

  // ------------------------------------------------------------------------------------------------ modal UI (circuit puzzle / terminal)
  modalEl(on) { const e = $('gm-modal'); if (e) e.hidden = !on; if (on && document.pointerLockElement) { /* keyboard driven; the cursor stays locked */ } }
  openPuzzle(d, title, onSolve) {
    const rng = mulberry(d.seed * 7919 + (++this.stats.terminals) * 31); this.pz = { dev: d, title, onSolve, c: new Circuit(d.rows, d.cols, rng), sel: [0, 0], solvedT: 0 };
    const e = $('gm-modal'); if (!e) return; e.innerHTML = '<div class="gmm-title"></div><canvas id="gm-cv" width="' + (d.cols * 84 + 60) + '" height="' + (d.rows * 84 + 20) + '"></canvas><div class="gmm-help">WASD / ARROWS select · SPACE / ENTER rotate · E / BACKSPACE cancel</div>';
    e.querySelector('.gmm-title').textContent = title; this.modalEl(true); const cv = $('gm-cv'); cv.onclick = (ev) => { if (!this.pz) return; const r = cv.getBoundingClientRect(), x = (ev.clientX - r.left) * cv.width / r.width - 30, y = (ev.clientY - r.top) * cv.height / r.height - 10, c = Math.floor(x / 84), rr = Math.floor(y / 84); if (c >= 0 && rr >= 0 && c < this.pz.c.C && rr < this.pz.c.R) { this.pz.sel = [rr, c]; this.rotate(); } };
    this.drawPuzzle(); this.g.sfx.beep(true);
  }
  rotate() { const p = this.pz; if (!p || p.solvedT) return; const t = p.c.t[p.sel[0]][p.sel[1]]; t.rot = (t.rot + 1) % 4; this.g.sfx.beep(true); if (p.c.flow().solved) { p.solvedT = 0.9; this.g.sfx.merge && this.g.sfx.merge(true); } this.drawPuzzle(); }
  drawPuzzle() {
    const p = this.pz, cv = $('gm-cv'); if (!p || !cv) return; const g = cv.getContext('2d'), C = p.c, fl = C.flow(); g.clearRect(0, 0, cv.width, cv.height); g.fillStyle = '#07121c'; g.fillRect(0, 0, cv.width, cv.height);
    const ox = 30, oy = 10, S = 84; g.lineCap = 'round';
    g.strokeStyle = '#3aff9a'; g.lineWidth = 8; g.beginPath(); g.moveTo(2, oy + S / 2); g.lineTo(ox + 2, oy + S / 2); g.stroke(); g.beginPath(); g.moveTo(ox + C.C * S - 2, oy + (C.R - 1) * S + S / 2); g.lineTo(cv.width - 2, oy + (C.R - 1) * S + S / 2); g.strokeStyle = fl.solved ? '#3aff9a' : '#6a7a88'; g.stroke();
    for (let r = 0; r < C.R; r++) for (let c = 0; c < C.C; c++) {
      const t = C.t[r][c], x = ox + c * S, y = oy + r * S, on = fl.seen.has(r + ',' + c), sel = p.sel[0] === r && p.sel[1] === c;
      g.fillStyle = sel ? '#12303f' : '#0c1c28'; g.fillRect(x + 3, y + 3, S - 6, S - 6); g.strokeStyle = sel ? '#6fe0ff' : '#23404f'; g.lineWidth = 2; g.strokeRect(x + 3, y + 3, S - 6, S - 6);
      const o = open(t); g.strokeStyle = on ? '#3aff9a' : '#7f93a3'; g.lineWidth = 9;
      for (let d = 0; d < 4; d++) if (o[d]) { g.beginPath(); g.moveTo(x + S / 2, y + S / 2); g.lineTo(x + S / 2 + DIRS[d][0] * (S / 2 - 3), y + S / 2 + DIRS[d][1] * (S / 2 - 3)); g.stroke(); }
      g.fillStyle = on ? '#3aff9a' : '#7f93a3'; g.beginPath(); g.arc(x + S / 2, y + S / 2, 7, 0, 7); g.fill();
    }
    if (p.solvedT) { g.fillStyle = 'rgba(58,255,154,.18)'; g.fillRect(0, 0, cv.width, cv.height); g.fillStyle = '#9dffd0'; g.font = 'bold 22px monospace'; g.fillText('CIRCUIT RESTORED', cv.width / 2 - 100, cv.height / 2); }
  }
  openTerm(d) {
    this.term = { dev: d, sel: 0 }; this.stats.terminals++; this.drawTerm(); this.modalEl(true);
  }
  drawTerm() {
    const t = this.term, e = $('gm-modal'); if (!t || !e) return; const T = t.dev.T, tech = this.g.tech; let h = '<div class="gmm-title">' + T.label + ' · TERMINAL</div><div class="gmm-info">';
    h += 'POWER: ' + (t.dev.needsPower ? (this.power ? 'GENERATOR ONLINE' : 'OFFLINE') : 'MAINS') + '<br>TURRET NET: ' + (tech.grid.turrets ? 'LINKED' : 'STANDALONE') + ' · FLOODLIGHTS: ' + (tech.grid.floods ? 'ON' : 'OFF') + '<br>';
    h += 'CAMERAS: ' + (this.cams.map(c => c.label + ' ' + (c.enabled ? 'ACTIVE' : 'DISABLED')).join(' · ') || 'NONE') + '</div>';
    T.fns.forEach((f, i) => { const locked = f.lvl > T.upgradeLevel; h += '<div class="gmm-row' + (i === t.sel ? ' sel' : '') + (locked ? ' lock' : '') + '">' + (i === t.sel ? '▶ ' : '  ') + f.name + '<span>' + (locked ? 'ADMIN LOCKED' : f.on() ? 'ON' : 'OFF') + '</span></div>'; });
    h += '<div class="gmm-help">W / S select · ENTER / SPACE run · E / BACKSPACE close</div>'; e.innerHTML = h;
  }
  puzzleKey(code, P) {
    if (this.pz) {
      const p = this.pz, [r, c] = p.sel; if (p.solvedT) return;
      if (code === 'KeyW' || code === 'ArrowUp') p.sel = [Math.max(0, r - 1), c]; else if (code === 'KeyS' || code === 'ArrowDown') p.sel = [Math.min(p.c.R - 1, r + 1), c]; else if (code === 'KeyA' || code === 'ArrowLeft') p.sel = [r, Math.max(0, c - 1)]; else if (code === 'KeyD' || code === 'ArrowRight') p.sel = [r, Math.min(p.c.C - 1, c + 1)];
      else if (code === 'Space' || code === 'Enter' || code === 'KeyR') { this.rotate(); return; } else if (code === 'KeyE' || code === 'Backspace' || code === 'KeyQ') { this.pz = null; this.modalEl(false); return; }
      this.drawPuzzle(); return;
    }
    const t = this.term; if (!t) return; const T = t.dev.T;
    if (code === 'KeyW' || code === 'ArrowUp') t.sel = (t.sel + T.fns.length - 1) % T.fns.length; else if (code === 'KeyS' || code === 'ArrowDown') t.sel = (t.sel + 1) % T.fns.length;
    else if (code === 'Space' || code === 'Enter') { T.sel = t.sel; this.runFn(T); } else if (code === 'KeyE' || code === 'Backspace' || code === 'KeyQ') { this.term = null; this.modalEl(false); return; }
    this.drawTerm();
  }

  // ------------------------------------------------------------------------------------------------ per-frame
  /** always running: cameras, generator, vault exit sensor, modal timers */
  tick(dt) {
    this.t += dt; const g = this.g, P = g.player;
    if (this.pz && this.pz.solvedT) { this.pz.solvedT -= dt; this.drawPuzzle(); if (this.pz.solvedT <= 0) { const p = this.pz; this.pz = null; this.modalEl(false); p.onSolve && p.onSolve(); } }
    if (this.term && this.term.dev.T.dirty) { this.drawTerm(); }
    const gen = this.gen; if (gen) { if (gen.state === 'running') { gen.fan.rotation.z += dt * 24; gen.led.emissiveIntensity = 1.4 + 0.3 * sin(this.t * 6); } else gen.led.emissiveIntensity = 1.2 + 0.6 * sin(this.t * (gen.state === 'broken' ? 3 : 1.5)); }
    for (const d of this.devs) { if (d.mesh && d.mesh.material) d.mesh.material.emissiveIntensity = d === this.cand && g.player === g.gm ? 2.0 + 0.6 * sin(this.t * 8) : 0.8; }
    // vault exit sensor: anything bigger than Grey Matter standing inside the closed vault opens the door from inside (nobody can be trapped by switching aliens)
    const v = this.vault; if (v && P !== g.gm && v.door.open < 0.2 && P.pos.x > v.x0 && P.pos.x < v.x1 && Math.abs(P.pos.z - v.z) < v.hz) { v.door.holdOpen = true; v.door.target = 1; v.dev.unlocked = true; }
    if (this.coreMat) this.coreMat.emissiveIntensity = damp(this.coreMat.emissiveIntensity, this.power ? 1.8 : 0.1, 3, dt);
    for (const cam of this.cams) this.tickCamera(cam, dt, P);
  }
  tickCamera(cam, dt, P) {
    cam.t += dt; if (cam.enabled) { cam.yaw = cam.yaw0 + sin(cam.t * 0.5) * cam.sweep; } cam.head.rotation.y = cam.yaw; cam.cone.visible = cam.enabled; cam.eye.emissive.setRGB(cam.enabled ? 1 : 0.05, cam.enabled ? (cam.seenT > 0 ? 0.05 : 0.12) : 0.05, cam.enabled ? 0.1 : 0.05); cam.eye.emissiveIntensity = cam.enabled ? 2 : 0.1;
    cam.cone.material.opacity = cam.seenT > 0 ? 0.16 : 0.06; cam.cd = Math.max(0, cam.cd - dt); if (!cam.enabled || !this.g.enemies.enabled || (this.g.stealth && this.g.stealth.hidden)) { cam.seenT = 0; return; }
    const dx = P.pos.x - cam.x, dz = P.pos.z - cam.z, dist = Math.hypot(dx, dz), range = cam.range * (P.stealthSize ?? 1) + 0.2; let seen = false;
    if (dist < range) { const ang = Math.abs(angleDelta(cam.yaw, Math.atan2(dx, dz))); if (ang < cam.half) { _a.set(cam.x, cam.y, cam.z); _b.set(P.pos.x - cam.x, P.pos.y + (P.sightY ?? 1.2) - cam.y, P.pos.z - cam.z); const L = _b.length(); _b.multiplyScalar(1 / L); seen = !this.g.world.raySolid(_a, _b, L - 0.05); } }
    cam.seenT = seen ? cam.seenT + dt : 0;
    if (cam.seenT > 0.6 && cam.cd <= 0) { cam.cd = 8; this.stats.alerts++; this.g.hud.toast('SECURITY CAMERA ' + cam.label + ' — INTRUDER SPOTTED'); this.g.sfx.beep(false); for (const gd of this.g.guards) { if (gd.dead || gd.possessed) continue; if (gd.st === 'idle' || gd.st === 'search' || gd.st === 'return') { gd.st = 'chase'; gd.stT = 0; gd.alert = 0.5; } gd.mem.copy(P.pos); } }
  }
  /** Grey Matter active: find the nearest device, hold-E progress, turret control */
  update(dt, P, aim) {
    this.cand = this.puzzle ? null : this.candidate(P);
    if (P.tech && P.tech.hold && this.holdDev) { const d = this.holdDev; d.prog = d.prog0 + (1 - d.prog0) * P.tech.prog; if (P.tech.prog >= 1) { this.holdDev = null; P.endTech(true); } }
    if (this.ctrlDev) this.tickTurret(dt, P, aim);
  }
  reset() {
    this.pz = null; this.term = null; this.modalEl(false); this.power = false; this.holdDev = null; this.ctrlDev = null; this.g.tech.setGroup('gm', false);
    for (const d of this.devs) { if (d.kind === 'generator') { d.state = 'broken'; d.prog = 0; this.setLed(d); } if (d.kind === 'panel') { d.state = 'damaged'; d.led.emissive.setRGB(1, 0.16, 0.1); } if (d.kind === 'console' || d.kind === 'turretbox') d.unlocked = false; if (d.kind === 'door') { d.unlocked = !!d.vaultFree; } }
    for (const c of this.cams) c.enabled = true;
  }
}
