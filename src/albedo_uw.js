// ULTIMATE WILDMUTT controller = the real Wildmutt controller (same locomotion, bite / claw / pounce, hit tests, effects) driven on the auto-rigged Ultimate Wildmutt model (animations/uwrig.js).
// Differences are ONLY: a bigger body (model + collision + hit spheres) and the damage / knockback multiplier that Albedo applies while he is in this form (cfg.uwDamageMul = 2x Wildmutt's
// physical damage, strength, knockback, claw and bite). Speed, attack speed and HP are NOT doubled.
import * as THREE from 'three';
import { WmPlayer, WCFG } from './wildmutt.js';
import { WM_SCALE } from '../animations/quadrig.js';

export const UW_SIZE = 1.22;                         // body scale relative to Wildmutt (collision radius / height, hit spheres, reach follow it)
export class UwPlayer extends WmPlayer {
  constructor(game, rig) {
    super(game, rig); this.kind = 'ultimatewildmutt'; this.root.name = 'UltimateWildmutt'; this.size = UW_SIZE;
    this.rad = WCFG.radius * UW_SIZE; this.colH = WCFG.height * UW_SIZE; this.hitSphere = { y: 1.2, r: 1.5 };
    rig.modelGroup.scale.setScalar(WM_SCALE * UW_SIZE);
    this.poser.apply(this.finalize(this.locoPose(0.016)));
  }
}
