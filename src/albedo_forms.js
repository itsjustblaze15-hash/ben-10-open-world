// ALBEDO - the alien forms. Every entry builds ONE extra instance of the real player controller (same class, same GLB rig - cloned scene + cloned materials) on Albedo's puppet context
// (src/albedo_ctx.js), plus the small table the AI pilot needs: which keys / buttons are real attacks, from what distance they make sense, which of them are safe to interrupt, and what has to be
// undone when he switches away. Nothing here re-implements an alien: the animations, physics, hit tests and effects are the player's own code.
import * as THREE from 'three';
import { cloneScene } from './clone.js';
import { buildRig } from '../animations/rig.js';
import { buildXlr8Rig } from '../animations/xlr8rig.js';
import { buildFourArmsRig } from '../animations/fourarmsrig.js';
import { buildBipedRig, HB_CFG, UP_CFG } from '../animations/bipedrig.js';
import { buildQuadRig } from '../animations/quadrig.js';
import { buildGhostRig } from '../animations/ghostrig.js';
import { buildRipjawsRig } from '../animations/ripjawsrig.js';
import { buildStinkflyRig } from '../animations/stinkflyrig.js';
import { buildCannonboltRig } from '../animations/cannonboltrig.js';
import { buildGreyMatterRig } from '../animations/greymatterrig.js';
import { buildWayBigRig } from '../animations/waybigrig.js';
import { Player } from './player.js';
import { CrystalProjectiles } from './powers.js';
import { PowerSet } from './powers2.js';
import { XlrPlayer } from './xlr8.js';
import { FaPlayer } from './fourarms.js';
import { HbPlayer } from './heatblast.js';
import { UpPlayer } from './upgrade.js';
import { WmPlayer } from './wildmutt.js';
import { GfPlayer } from './ghostfreak.js';
import { RjPlayer } from './ripjaws.js';
import { SfPlayer } from './stinkfly.js';
import { CbPlayer } from './cannonbolt.js';
import { GmPlayer } from './greymatter.js';
import { WbPlayer } from './waybig.js';
import { FireSystem } from './fire.js';
import { SlimeSystem } from './slime.js';
import { inSink } from './albedo_ctx.js';
import { buildUwRig } from '../animations/uwrig.js';
import { UwPlayer } from './albedo_uw.js';

/** the 12 playable aliens (Feedback does not exist in this project). Ultimate Wildmutt is a 13th FORM of Albedo, never part of this pool. */
export const ALIENS = ['diamondhead', 'xlr8', 'fourarms', 'heatblast', 'upgrade', 'wildmutt', 'ghostfreak', 'ripjaws', 'stinkfly', 'cannonbolt', 'greymatter', 'waybig'];
export const UW = 'ultimatewildmutt';

const dummyLight = () => ({ intensity: 0, color: new THREE.Color(), position: new THREE.Vector3(), distance: 0, visible: false });

/** per-form build functions: (ctx, assets) -> controller. `ctx` is Albedo's puppet game. */
export const BUILD = {
  diamondhead(ctx, A) {
    const c = new Player(ctx, buildRig(cloneScene(A.diamondhead.scene))); ctx.dh = c; ctx.power = new CrystalProjectiles(ctx); ctx.p2 = new PowerSet(ctx); c.pw = ctx.power; c.p2 = ctx.p2;
    c.combat = { get busy() { return ctx.power.busy || ctx.p2.busy; }, get lockFacing() { return ctx.power.lockFacing || ctx.p2.lockFacing; }, get faceYaw() { return ctx.p2.act && ctx.p2.act.kind === 'melee' ? ctx.p2.act.face : undefined; }, get speedMul() { return ctx.p2.busy ? ctx.p2.speedMul : undefined; }, get noDash() { return ctx.p2.noDash; } };
    return c;
  },
  xlr8(ctx, A) { const sc = cloneScene(A.xlr8.scene); const c = new XlrPlayer(ctx, buildXlr8Rig(sc)); c.initPowers(sc); ctx.xlr = c; return c; },
  fourarms(ctx, A) { const c = new FaPlayer(ctx, buildFourArmsRig(cloneScene(A.fourarms.scene))); c.light = dummyLight(); ctx.fa = c; return c; },
  heatblast(ctx, A) { const c = new HbPlayer(ctx, buildBipedRig(cloneScene(A.heatblast.scene), HB_CFG)); ctx.hb = c; return c; },
  upgrade(ctx, A) { const c = new UpPlayer(ctx, buildBipedRig(cloneScene(A.upgrade.scene), UP_CFG), ctx.tech); ctx.up = c; return c; },
  wildmutt(ctx, A) { const c = new WmPlayer(ctx, buildQuadRig(cloneScene(A.wildmutt.scene))); ctx.wm = c; return c; },
  ghostfreak(ctx, A) { const c = new GfPlayer(ctx, buildGhostRig(cloneScene(A.ghostfreak.scene))); ctx.gf = c; return c; },
  ripjaws(ctx, A) { const c = new RjPlayer(ctx, buildRipjawsRig(cloneScene(A.ripjaws.scene))); ctx.rj = c; return c; },
  stinkfly(ctx, A) { const c = new SfPlayer(ctx, buildStinkflyRig(cloneScene(A.stinkfly.scene))); ctx.sf = c; return c; },
  cannonbolt(ctx, A) { const c = new CbPlayer(ctx, buildCannonboltRig(cloneScene(A.cannonbolt.scene), cloneScene(A.cannonball.scene))); ctx.cb = c; return c; },
  greymatter(ctx, A) { const c = new GmPlayer(ctx, buildGreyMatterRig(cloneScene(A.greymatter.scene))); ctx.gm = c; return c; },
  ultimatewildmutt(ctx, A) { const c = new UwPlayer(ctx, buildUwRig(A.wildmutt, A.ultimatewildmutt)); ctx.wm = ctx.wm || c; ctx.uw = c; return c; },
  waybig(ctx, A) { const c = new WbPlayer(ctx, buildWayBigRig(cloneScene(A.waybig.scene)), ctx.district, ctx.wbfx); ctx.wb = c; return c; },
};

/** the puppet context also needs its own fire / slime systems (they damage `world.hittables`, which for a puppet is the player and nobody else) */
export function ensureSystems(ctx, id) {
  if (id === 'heatblast' || id === 'upgrade' || id === 'xlr8' || id === 'waybig') { if (!ctx.fire) ctx.fire = new FireSystem(ctx, ctx.realFire.lights); }
  if (id === 'stinkfly') { if (!ctx.slime) ctx.slime = new SlimeSystem(ctx); }
}

/** build (or fetch) one alien controller for Albedo: its own cloned scene + materials, its own state, bound to the puppet context */
export function buildForm(ctx, A, id) {
  return inSink(() => { ensureSystems(ctx, id); const c = BUILD[id](ctx, A); c.root.visible = false; c.puppetOf = ctx.owner; return c; });
}
