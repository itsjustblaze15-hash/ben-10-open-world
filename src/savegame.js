// V34 SAVE / LOAD. One save slot (localStorage 'ben10.save.v1'). Plain JSON only - scenes / meshes are never serialised; the world is rebuilt by the game and these few values are re-applied:
// the active character, position, yaw, Omnitrix state, world clock (day / time / speed), invasion progress, the mothership finale (wreck). Everything else resets to its normal start state (documented limitation).
import { clamp } from './util.js';

export const SAVE_KEY = 'ben10.save.v1';
const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);

export function readSave(game) {
  let s = null; try { s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { return null; }
  if (!s || s.v !== 1 || !s.player || !s.world) return null;
  const p = s.player, ids = game.chars ? Object.keys(game.chars.defs) : [];
  if (!ids.includes(p.id) && p.id !== 'ben') return null;
  for (const k of ['x', 'y', 'z']) if (!(typeof p[k] === 'number' && isFinite(p[k]) && Math.abs(p[k]) < 6000)) return null;
  if (!(typeof s.world.elapsed === 'number' && isFinite(s.world.elapsed) && s.world.elapsed >= 0 && s.world.elapsed < 1000)) return null;
  return s;
}

export function snapshot(game, ctl) {
  const P = game.player, dn = game.dayNight, iv = game.invasion, om = game.omni, fin = game.finale;
  return {
    v: 1, savedAt: Date.now(),
    player: { id: game.chars.id, x: P.pos.x, y: P.pos.y, z: P.pos.z, yaw: num(P.yaw), camYaw: num(ctl.camYaw()) },
    omni: om ? { state: om.state === 'alien' ? 'alien' : om.state === 'recharge' ? 'recharge' : 'ready', remaining: num(om.remaining), cd: num(om.cd), free: !!om.free } : null,
    world: dn ? { elapsed: dn.elapsed, t: dn.t, scale: dn.scale } : { elapsed: 0, t: 0.4, scale: 1 },
    invasion: iv ? { landed: !!iv.landed, dismissed: !!iv.dismissed, aboard: !!iv.aboard, defeated: !!iv.defeated, state: iv.state } : null,
    finale: fin ? { wreck: !!fin.wreck } : null,
  };
}

export function writeSave(game, ctl) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot(game, ctl))); return true; } catch { return false; }
}

export function describe(s) {
  if (!s) return '';
  const d = new Date(s.savedAt || 0), day = Math.min(11, Math.floor(s.world.elapsed) + 1), names = { ben: 'Ben' };
  return 'DAY ' + day + ' · ' + (names[s.player.id] || s.player.id.toUpperCase()) + ' · ' + (isFinite(d.getTime()) && s.savedAt ? d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
}

/** put a snapshot back into the running game (called while the menu is still covering the screen) */
export function applySave(game, ctl, s) {
  const dn = game.dayNight, iv = game.invasion, om = game.omni, fin = game.finale, p = s.player;
  // 1. the world clock + the invasion timeline (so the spaceship is exactly where it was)
  if (dn) { dn.elapsed = s.world.elapsed; dn.t = ((num(s.world.t, 0.4) % 1) + 1) % 1; if ([0.5, 1, 2, 5, 10, 50, 100].includes(s.world.scale)) dn.scale = s.world.scale; dn.apply(0); try { dn.regenEnv(); } catch { /* optional */ } dn.save(); dn.syncSettings && dn.syncSettings(); }
  if (iv) {
    iv.force.clear(); iv.missiles.clear(); iv.landed = !!(s.invasion && s.invasion.landed); iv.dismissed = !!(s.invasion && s.invasion.dismissed); iv.aboard = !!(s.invasion && s.invasion.aboard); iv.defeated = !!(s.invasion && s.invasion.defeated);
    iv.state = iv.defeated ? 'INVASION_DEFEATED' : iv.aboard ? 'VILGAX_ABOARD' : 'APPROACHING'; iv.stT = 0; iv.retreatT = 0; iv.vSpawned = false; iv.invVilgax = false; iv.beamA = 0; iv.beam.visible = false; iv.forceOk = false; iv.save();
    const v = game.vilgax; if (v && v.present) { try { v.bossDespawn(); game.bosses.updateUI(); } catch { /* ignore */ } }
  }
  if (fin) { fin.reset(); fin.wreck = !!(s.finale && s.finale.wreck) || (iv && iv.defeated); if (fin.wreck) { fin.F.mode = 'wreck'; fin.save(); } }
  // 2. the player: Ben first (he owns the position), then the alien through the normal character switch
  ctl.resetWorld();
  const ben = game.ben, W = game.world, gy = W.groundAt ? W.groundAt(p.x, p.z, p.y + 3, 60, 0.3) : p.y;
  const y = isFinite(gy) && gy > -50 ? Math.max(p.y, gy) : p.y;
  if (game.chars.id !== 'ben') { game.chars.switchTo('ben'); game.chars.finishSwap && game.chars.finishSwap(); }
  ben.pos.set(p.x, y + 0.05, p.z); ben.vel && ben.vel.set(0, 0, 0); ben.yaw = p.yaw; ben.root.position.copy(ben.pos); ben.root.rotation.y = p.yaw; ben.root.updateMatrixWorld(true);
  ctl.setCamYaw(clamp(num(p.camYaw), -20, 20));
  if (om && s.omni) {
    om.hold = null; om.state = 'ready'; om.cd = 0; om.remaining = 0; om.free = false;
    if (p.id !== 'ben') { om.state = 'alien'; om.free = !!s.omni.free; om.remaining = Math.max(5, num(s.omni.remaining, 60)); game.chars.switchTo(p.id); game.chars.finishSwap && game.chars.finishSwap(); }
    else if (s.omni.state === 'recharge') { om.state = 'recharge'; om.cd = Math.max(1, num(s.omni.cd, 30)); }
    om.renderHud && om.renderHud(true);
  }
  const P = game.player; P.pos.set(p.x, y + 0.05, p.z); P.root.position.copy(P.pos); P.root.updateMatrixWorld(true);
  return true;
}
