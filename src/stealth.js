// Stealth: the one place that decides whether the player can be noticed. Every enemy (Guards, training turrets, chasing dummies) asks this module instead of reading the
// player's position directly, so invisibility changes what the AI does, not just how the model looks.
//   hidden    -> true while Ghostfreak is invisible (Shift held, body faded) or is inside a possessed host, unless something just revealed him (he attacked / was hit).
//   lastSeen  -> where the player was the last time he was visible. Enemies that lose him head for THIS point, never for his live position.
//   CLOSE     -> a hidden player is only noticed by something that is practically touching him.
import * as THREE from 'three';

export const CLOSE = 1.7;

export class Stealth {
  constructor(game) {
    this.g = game; this.reveal = 0; this.lastSeen = new THREE.Vector3(0, 0, 14); this.lostT = 0;
    this.stats = { hiddenTime: 0, reveals: 0, lostTrack: 0 };
  }
  get gf() { const g = this.g; return g.gf && g.player === g.gf ? g.gf : null; }
  /** AI-level invisibility (not the visual fade): faded far enough, no recent reveal */
  get hidden() { const gf = this.gf; return !!gf && this.reveal <= 0 && (gf.possessing || gf.invis > 0.72); }
  /** the player gave himself away for a moment (attacks) */
  poke(t = 0.9) { if (this.hidden) this.stats.reveals++; this.reveal = Math.max(this.reveal, t); }
  /** where an enemy should aim / walk when it has no eyes on the player: the live position while visible, the last known one while hidden */
  target(out = new THREE.Vector3()) { return out.copy(this.hidden ? this.lastSeen : this.g.player.pos); }
  update(dt) {
    this.reveal = Math.max(0, this.reveal - dt);
    if (this.hidden) { this.lostT += dt; this.stats.hiddenTime += dt; } else { this.lostT = 0; this.lastSeen.copy(this.g.player.pos); }
  }
  reset() { this.reveal = 0; this.lostT = 0; }
}
