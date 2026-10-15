// ALBEDO in his human form. Same controller interface as Ben (BenPlayer: walk / run / jump / weak punch combo / hit reactions on the shared impact system), driving Albedo's own Mixamo
// skeleton through animations/albedorig.js. Extra over Ben: a guard (block) pose, a quick evade lean, a controlled backward-fall defeat pose, and a longer stride (he is taller than Ben).
import * as THREE from 'three';
import { BenPlayer, BCFG } from './ben.js';
import { clamp, damp, lerp } from './util.js';

const AX = new THREE.Vector3(1, 0, 0), AZ = new THREE.Vector3(0, 0, 1), AY = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _t = new THREE.Quaternion(), _v = new THREE.Vector3(), _d = new THREE.Vector3();

export class AlbedoHuman extends BenPlayer {
  constructor(game, rig) {
    super(game, rig); this.kind = 'albedo'; this.root.name = 'AlbedoHuman'; this.strideMul = rig.strideMul || 1; this.guard = 0; this.guardW = 0; this.evade = 0; this.evadeDir = 0; this.fallK = 0; this.fallOn = false; this.blocking = false;
    this.hitSphere = { y: 0.85, r: 0.6 };
  }
  get cfg2() { return BCFG; }
  /** guard up / down (the AI decides) */
  setBlock(b) { this.blocking = !!b && !this.act; }
  startEvade(dirSign) { this.evade = 1; this.evadeDir = dirSign; }
  cancelAll() { super.cancelAll(); this.blocking = false; }
  // Ben's own regeneration / SECOND WIND logic belongs to Ben; Albedo's HP is the boss pool (Albedo.takeDamage). onHit is never reached (AlbedoImpact.damagePlayer replaces it) but stays inert for safety.
  onHit() {}
  /** model-space quaternion -> local quaternion of a proxy bone (same helper as Ben's pose) */
  setM(name, q) { const b = this.nodes[name]; b.quaternion.copy(this.parentModelQ(b, _q2).invert()).multiply(q); }
  blend(name, q, w) { const b = this.nodes[name]; this.parentModelQ(b, _q2).invert().multiply(q); b.quaternion.slerp(_q2, w); }
  pose(dt) {
    super.pose(dt);
    const rig = this.rig; if (!rig || !rig.sync) return;
    const A = this.an;
    this.guardW = damp(this.guardW, this.blocking ? 1 : 0, 16, dt || 0.016); this.evade = Math.max(0, this.evade - (dt || 0.016) * 3.2);
    if (this.guardW > 0.01) {
      for (const [sd, sg] of [['L', 1], ['R', -1]]) {
        const qU = new THREE.Quaternion().setFromUnitVectors(_v.set(sg, 0, 0), _d.set(sg * 0.22, -0.55, 0.78).normalize());
        const qF = new THREE.Quaternion().setFromUnitVectors(_v.set(sg, 0, 0), _d.set(-sg * 0.30, 0.72, 0.62).normalize());
        this.blend('uarm' + sd, qU, this.guardW); this.nodes['uarm' + sd].updateMatrix();
        this.blend('farm' + sd, qF, this.guardW); this.blend('hand' + sd, qF, this.guardW);
      }
      this.blend('chest', _t.setFromAxisAngle(AX, 0.22), this.guardW * 0.7); this.blend('head', _t.setFromAxisAngle(AX, 0.1), this.guardW * 0.6);
      const hp = this.nodes.hips.position; hp.y -= 0.05 * this.guardW;
    }
    if (this.evade > 0.01) {
      const k = Math.sin(this.evade * Math.PI) ; const s = this.evadeDir;
      this.blend('chest', _t.setFromAxisAngle(AZ, -s * 0.38 * k).multiply(_q.setFromAxisAngle(AX, 0.18 * k)), 0.85);
      this.blend('head', _t.setFromAxisAngle(AZ, s * 0.2 * k), 0.8);
      this.nodes.hips.position.y -= 0.08 * k;
    }
    if (this.fallOn) {
      this.fallK = Math.min(1, this.fallK + (dt || 0.016) / 0.85); const k = this.fallK, e = k * k * (3 - 2 * k);
      rig.modelGroup.rotation.x = -e * 1.5; rig.modelGroup.position.y = Math.sin(e * Math.PI * 0.5) * 0.12;
      for (const [sd, sg] of [['L', 1], ['R', -1]]) { this.blend('uarm' + sd, _t.setFromAxisAngle(AZ, sg * 0.5 * e).multiply(_q.setFromAxisAngle(AX, 0.1)), e); this.blend('farm' + sd, _t.identity(), e * 0.6); }
      this.blend('head', _t.setFromAxisAngle(AX, 0.25), e * 0.8);
    } else if (this.fallK !== 0) { this.fallK = 0; rig.modelGroup.rotation.x = 0; rig.modelGroup.position.y = 0; }
    rig.fist = clamp(0.35 + 0.65 * A.pw + 0.5 * this.guardW, 0, 1); rig.sync();
  }
  /** controlled backward-fall defeat pose (no ragdoll, no twisting) */
  setDown(on) { this.fallOn = on; if (!on) { this.fallK = 0; this.rig.modelGroup.rotation.x = 0; this.rig.modelGroup.position.y = 0; } }
  /** a transformation pulse: the model "pops" in */
  popScale(k) { this.root.scale.setScalar(k); }
}
