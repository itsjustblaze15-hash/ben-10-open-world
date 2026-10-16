// Diamondhead character test — bootstrap, input, HUD, main loop.
import { meleeAim } from './src/aimassist.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildRig, MODEL_SCALE } from './animations/rig.js';
import { buildXlr8Rig } from './animations/xlr8rig.js';
import { buildFourArmsRig } from './animations/fourarmsrig.js';
import { buildBipedRig, HB_CFG, UP_CFG } from './animations/bipedrig.js';
import { buildQuadRig } from './animations/quadrig.js';
import { buildGhostRig } from './animations/ghostrig.js';
import { buildRipjawsRig } from './animations/ripjawsrig.js';
import { buildStinkflyRig } from './animations/stinkflyrig.js';
import { buildCannonboltRig } from './animations/cannonboltrig.js';
import { buildGreyMatterRig } from './animations/greymatterrig.js';
import { GmPlayer } from './src/greymatter.js';
import { GmTech } from './src/gm_tech.js';
import { buildWayBigRig } from './animations/waybigrig.js';
import { WbPlayer } from './src/waybig.js';
import { WbDistrict } from './src/wb_world.js';
import { WbFx } from './src/wb_fx.js';
import { buildGmWorld } from './src/gm_world.js';
import { World } from './src/world.js';
import { ShardSystem, GlowSystem, SurfaceFX } from './src/effects.js';
import { CameraRig } from './src/camera.js';
import { Player } from './src/player.js';
import { CrystalProjectiles } from './src/powers.js';
import { PowerSet } from './src/powers2.js';
import { Turret, Enemies } from './src/turrets.js';
import { Dummy, Target } from './src/dummies.js';
import { clamp, damp, smoothstep } from './src/util.js';
import { XlrPlayer } from './src/xlr8.js';
import { FaPlayer } from './src/fourarms.js';
import { HbPlayer } from './src/heatblast.js';
import { FireSystem } from './src/fire.js';
import { UpPlayer } from './src/upgrade.js';
import { WmPlayer } from './src/wildmutt.js';
import { GfPlayer } from './src/ghostfreak.js';
import { RjPlayer } from './src/ripjaws.js';
import { SfPlayer } from './src/stinkfly.js';
import { CbPlayer } from './src/cannonbolt.js';
import { buildCbWorld } from './src/cb_world.js';
import { SlimeSystem } from './src/slime.js';
import { IslandWater } from './src/island/islandwater.js';
import { buildIsland } from './src/island/index.js';
import { Civilians } from './src/island/npcs.js';
import { SurfaceSwim } from './src/island/swim.js';
import { Traffic } from './src/island/traffic.js';
import { installChaos } from './src/island/chaos.js';
import { Minimap } from './src/island/minimap.js';
import { DayNight } from './src/island/daynight.js';
import { Destruct } from './src/island/destruct.js';
import { TrainBots } from './src/island/trainbots.js';
import { SeaBots } from './src/island/seabots.js';
import { Mothership } from './src/island/mothership.js';
import { Invasion } from './src/island/invasion.js';
import { Finale } from './src/island/finale.js';
import { Diver } from './src/diver.js';
import { Guard } from './src/guards.js';
import { Stealth } from './src/stealth.js';
import { TrackingSense } from './src/wm_senses.js';
import { TechSystem } from './src/tech.js';
import { buildTechWorld } from './src/techworld.js';
import { PropSystem } from './src/props.js';
import { CharacterManager } from './src/characters.js';
import { TimeSystem } from './src/timeslow.js';
import { Sfx } from './src/audio.js';
import { ImpactSystem } from './src/impact.js';
import { buildKevinRig } from './animations/kevinrig.js';
import { Kevin } from './src/kevin.js';
import { buildVilgaxRig } from './animations/vilgaxrig.js';
import { Vilgax } from './src/vilgax.js';
import { buildBenRig } from './animations/benrig.js';
import { BenPlayer } from './src/ben.js';
import { Omnitrix } from './src/omnitrix.js';
import { buildAlbedoRig } from './animations/albedorig.js';
import { AlbedoHuman } from './src/albedo_human.js';
import { BossManager } from './src/bossmgr.js';
import { Albedo } from './src/albedo.js';
import { GameMenu } from './src/menu.js';

const $ = id => document.getElementById(id);
let game_island_ref = null;
const loadbar = $('loadbar'), loadmsg = $('loadmsg');
const say = m => { loadmsg.textContent = m; };

// ------------------------------------------------------------------ renderer / scene
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.12, 3400);
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

// ------------------------------------------------------------------ HUD
const hud = {
  crosshair: $('crosshair'), hitmark: $('hitmark'), floats: [], toastT: 0, hitT: 0,
  hit(point, dmg, target) {
    this.hitmark.classList.add('show'); this.hitT = 0.12;
    if (target.kind === 'dummy' || target.kind === 'diver') {
      const el = document.createElement('div'); el.className = 'dmg'; el.textContent = dmg; $('hud').appendChild(el);
      this.floats.push({ el, p: point.clone().add(new THREE.Vector3((Math.random() - .5) * .6, .4, 0)), t: 0 });
    }
  },
  tag(point, text) {
    const el = document.createElement('div'); el.className = 'dmg tag'; el.textContent = text; $('hud').appendChild(el);
    this.floats.push({ el, p: point.clone().add(new THREE.Vector3(0, 0.9, 0)), t: -0.2 });
  },
  hurt() { $('hurt').classList.add('show'); this.hurtT = 0.22; },
  toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); this.toastT = 1.6; },
  update(dt) {
    if (this.hitT > 0 && (this.hitT -= dt) <= 0) this.hitmark.classList.remove('show');
    if (this.hurtT > 0 && (this.hurtT -= dt) <= 0) $('hurt').classList.remove('show');
    if (this.toastT > 0 && (this.toastT -= dt) <= 0) $('toast').classList.remove('show');
    const v = new THREE.Vector3();
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i]; f.t += dt; v.copy(f.p).project(camera);
      f.el.style.left = ((v.x * .5 + .5) * innerWidth) + 'px'; f.el.style.top = ((-v.y * .5 + .5) * innerHeight) + 'px';
      if (f.t > 0.8) { f.el.remove(); this.floats.splice(i, 1); }
    }
  },
};

// ------------------------------------------------------------------ load models (Diamondhead + XLR8, both untouched GLB files)
const loadGLB = (name) => new Promise((res, rej) => new GLTFLoader().load('assets/' + name + '.glb', res, e => { if (e.total) loadbar.style.width = (e.loaded / e.total * 11 + ({ diamondhead: 0, xlr8: 11, fourarms: 22, heatblast: 33, upgrade: 44, wildmutt: 55, ghostfreak: 66, ripjaws: 77, stinkfly: 88, cannonbolt: 93, cannonball: 96, greymatter: 98, waybig: 99, kevin11: 99.5, vilgax: 99.7, ben: 99.8, albedo: 99.85, ultimatewildmutt: 99.9 }[name] || 0)) + '%'; }, rej));
let gltf, gltfX, gltfF, gltfH, gltfU, gltfW, gltfG, gltfR, gltfS, gltfC, gltfB, gltfM, gltfWb, gltfK, gltfV, gltfBen, gltfAl, gltfUw;
try {
  say('Loading diamondhead.glb …'); gltf = await loadGLB('diamondhead');
  say('Loading xlr8.glb …'); gltfX = await loadGLB('xlr8');
  say('Loading fourarms.glb …'); gltfF = await loadGLB('fourarms');
  say('Loading heatblast.glb …'); gltfH = await loadGLB('heatblast');
  say('Loading upgrade.glb …'); gltfU = await loadGLB('upgrade');
  say('Loading wildmutt.glb …'); gltfW = await loadGLB('wildmutt');
  say('Loading ghostfreak.glb …'); gltfG = await loadGLB('ghostfreak');
  say('Loading ripjaws.glb …'); gltfR = await loadGLB('ripjaws');
  say('Loading stinkfly.glb …'); gltfS = await loadGLB('stinkfly');
  say('Loading cannonbolt.glb …'); gltfC = await loadGLB('cannonbolt');
  say('Loading cannonball.glb …'); gltfB = await loadGLB('cannonball');
  say('Loading greymatter.glb …'); gltfM = await loadGLB('greymatter');
  say('Loading waybig.glb …'); gltfWb = await loadGLB('waybig');
  say('Loading kevin11.glb …'); gltfK = await loadGLB('kevin11');
  say('Loading vilgax.glb …'); gltfV = await loadGLB('vilgax');
  say('Loading ben.glb …'); gltfBen = await loadGLB('ben');
  say('Loading albedo.glb …'); gltfAl = await loadGLB('albedo');
  say('Loading ultimatewildmutt.glb …'); gltfUw = await loadGLB('ultimatewildmutt');
} catch (e) {
  say('Could not load the GLB models in assets/ — ' + (e.message || e) + '. Start the local server (start.command) and reload.');
  throw e;
}
loadbar.style.width = '99%';

// ---- GLB inspection report (what the file really contains)
const report = (() => {
  const meshes = []; let verts = 0, skinnedCount = 0;
  gltf.scene.traverse(o => { if (o.isMesh) { meshes.push(o.name); verts += o.geometry.attributes.position.count; } if (o.isSkinnedMesh) skinnedCount++; });
  gltf.scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(gltf.scene), size = box.getSize(new THREE.Vector3());
  return { meshes, verts, skinned: skinnedCount, clips: gltf.animations.length, size, box };
})();
console.log('[Diamondhead GLB]', { meshes: report.meshes, vertices: report.verts, skinnedMeshes: report.skinned, animationClips: report.clips, size: report.size.toArray().map(v => +v.toFixed(2)), up: 'Y', forward: '+Z', feetY: +report.box.min.y.toFixed(3) });

say('Building rigs …');
const rig = buildRig(gltf.scene);
const reportX = (() => { const meshes = []; let verts = 0, sk = 0; gltfX.scene.traverse(o => { if (o.isMesh) { meshes.push(o.name); verts += o.geometry.attributes.position.count; } if (o.isSkinnedMesh) sk++; }); return { meshes, verts, skinned: sk, clips: gltfX.animations.length }; })();
console.log('[XLR8 GLB]', reportX);
const rigX = buildXlr8Rig(gltfX.scene);
const reportF = (() => { const meshes = []; let verts = 0, sk = 0, bones = 0; gltfF.scene.traverse(o => { if (o.isMesh) { meshes.push(o.name); verts += o.geometry.attributes.position.count; } if (o.isSkinnedMesh) sk++; if (o.isBone) bones++; }); return { meshes, verts, skinned: sk, bones, clips: gltfF.animations.length }; })();
console.log('[Four Arms GLB]', reportF);
const rigF = buildFourArmsRig(gltfF.scene);
const glbReport = (g) => { const meshes = []; let verts = 0, sk = 0, bones = 0; g.scene.traverse(o => { if (o.isMesh) { meshes.push(o.name); verts += o.geometry.attributes.position.count; } if (o.isSkinnedMesh) sk++; if (o.isBone) bones++; }); return { meshes, verts, skinned: sk, bones, clips: g.animations.length }; };
const reportH = glbReport(gltfH), reportU = glbReport(gltfU); console.log('[Heatblast GLB]', reportH); console.log('[Upgrade GLB]', reportU);
const rigH = buildBipedRig(gltfH.scene, HB_CFG), rigU = buildBipedRig(gltfU.scene, UP_CFG);
const reportW = glbReport(gltfW); console.log('[Wildmutt GLB]', reportW);
const rigW = buildQuadRig(gltfW.scene);
const reportG = glbReport(gltfG); console.log('[Ghostfreak GLB]', reportG);
const rigG = buildGhostRig(gltfG.scene);
const reportR = glbReport(gltfR); console.log('[Ripjaws GLB]', reportR);
const rigR = buildRipjawsRig(gltfR.scene); console.log('[Ripjaws rig]', rigR.report);
const reportS = glbReport(gltfS); console.log('[Stinkfly GLB]', reportS);
const rigS = buildStinkflyRig(gltfS.scene); console.log('[Stinkfly rig]', rigS.report);
const reportC = glbReport(gltfC), reportB = glbReport(gltfB); console.log('[Cannonbolt GLB]', reportC, '[Cannonball GLB]', reportB);
const rigC = buildCannonboltRig(gltfC.scene, gltfB.scene); console.log('[Cannonbolt rig]', rigC.report);
const rigM = buildGreyMatterRig(gltfM.scene); console.log('[Grey Matter rig]', rigM.report);
const reportWb = glbReport(gltfWb); console.log('[Way Big GLB]', reportWb);
const rigWb = buildWayBigRig(gltfWb.scene); console.log('[Way Big rig]', rigWb.report);
const reportK = glbReport(gltfK); console.log('[Kevin 11 GLB]', reportK);
const rigK = buildKevinRig(gltfK.scene); console.log('[Kevin 11 rig]', rigK.report);
const rigV = buildVilgaxRig(gltfV); console.log('[Vilgax rig]', rigV.report);
const reportBen = glbReport(gltfBen); console.log('[Ben GLB]', reportBen);
const rigBen = buildBenRig(gltfBen.scene); console.log('[Ben rig]', rigBen.report);
const reportAl = glbReport(gltfAl), reportUw = glbReport(gltfUw); console.log('[Albedo GLB]', reportAl, '[Ultimate Wildmutt GLB]', reportUw);

// ------------------------------------------------------------------ game
const world = new World(scene, renderer);
say('Building the island …');
const island = world.island ? buildIsland(world) : null; game_island_ref = island;
const fx = {
  shards: new ShardSystem(scene, 800),
  glow: new GlowSystem(scene, { capacity: 1800, additive: true }),
  dust: new GlowSystem(scene, { capacity: 500, additive: false }),
  surface: new SurfaceFX(scene),
  fire: new GlowSystem(scene, { capacity: 2600, additive: true }),
  smoke: new GlowSystem(scene, { capacity: 600, additive: false }),
};
const camRig = new CameraRig(camera, world);
const game = { scene, renderer, world, fx, camera: camRig, hud, cam3: camera, guards: [] };
game.dh = game.player = new Player(game, rig);
game.sfx = new Sfx(); game.time = new TimeSystem(game);
game.kTime = new TimeSystem(game, { dur: 10, cd: 20, scale: 0.25 });   // KEVIN's time slow: the SAME two-domain system as XLR8's, but the PLAYER is the one in slow time (10 s, 20 s cooldown, both in real time)
game.power = new CrystalProjectiles(game);
game.p2 = new PowerSet(game);
game.enemies = new Enemies(game);
const combat = { get busy() { return game.power.busy || game.p2.busy; }, get lockFacing() { return game.power.lockFacing || game.p2.lockFacing; }, get faceYaw() { return game.p2.act && game.p2.act.kind === 'melee' ? game.p2.act.face : undefined; }, get speedMul() { return game.p2.busy ? game.p2.speedMul : undefined; }, get noDash() { return game.p2.noDash; } };
camRig.yaw = 0; camRig.update(0.016, game.player.pos, true);

// ---- playable characters (shared world, one active controller at a time)
game.xlr = new XlrPlayer(game, rigX); game.xlr.initPowers(gltfX.scene);
// ---- physical props for Four Arms (cars, dumpsters, benches, streetlights, rocks, crates, barriers) + breakable walls
const props = game.props = new PropSystem(game);
{
  const mat = (c, r = 0.9) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
  const find = (x, y, z, w, h, d) => world.boxes.find(b => Math.abs((b.min.x + b.max.x) / 2 - x) < 0.05 && Math.abs(b.min.y - y) < 0.05 && Math.abs((b.min.z + b.max.z) / 2 - z) < 0.05 && Math.abs(b.max.x - b.min.x - w) < 0.05 && Math.abs(b.max.y - b.min.y - h) < 0.05 && Math.abs(b.max.z - b.min.z - d) < 0.05);
  for (const [x, y, z, sz] of [[22, 0, 8, 2.2], [22, 2.2, 8, 2.2], [24.4, 0, 9.4, 2.2], [20, 0, 11, 1.6], [-26, 0, 6, 2.2], [-26, 2.2, 6.4, 1.8]]) { const e = find(x, y, z, sz, sz, sz); if (e) props.wrap(e, sz > 2 ? 'heavy' : 'medium', sz > 2 ? 420 : 170, 160, 'crate', 0x8a6a3a); }
  for (const [x, z] of [[-6, 4], [6, 5], [-2, -10], [3, -17]]) { const e = find(x, 0, z, 3.4, 1, 0.8); if (e) props.wrap(e, 'heavy', 900, 380, 'barrier', 0xbdbdb5); }
  for (const [x, y, z, w, h, d, n, hp] of [[-14, 0, -6, 10, 3, 0.9, 'COVER WALL', 320], [14, 0, -8, 0.9, 3, 9, 'COVER WALL', 320], [10, 0, -12.5, 8, 3, 0.9, 'COVER WALL', 320], [-24, 0, -18, 0.9, 3.4, 12, 'COVER WALL', 340], [0, 0, -29, 40, 1.4, 1.2, 'LOW WALL', 260]]) { const e = find(x, y, z, w, h, d); if (e) props.addWall(e, hp, n); }
  // a small brick building (walls are breakable panels; the doorway is wide enough to walk through)
  const brick = new THREE.MeshStandardMaterial({ color: 0xb5745a, roughness: 0.95 });
  for (const [x, z, w, d] of [[27, -27.6, 9, 0.7], [23.9, -20.4, 4.2, 0.7], [30.1, -20.4, 4.2, 0.7], [22.65, -24, 0.7, 7.2], [31.35, -24, 0.7, 7.2]]) { world.addBox(x, 0, z, w, 4, d, brick); props.addWall(world.boxes[world.boxes.length - 1], 300, 'BRICK WALL'); }
  // flammable scenery (Heatblast): fences, bushes, trees, fuel barrels and a box truck
  for (const [x, z, yaw] of [[-30, 17, Math.PI / 2], [-30, 20, Math.PI / 2], [-30, 23, Math.PI / 2], [-8, 35, 0], [-5, 35, 0], [-2, 35, 0]]) props.add('fence', x, z, { yaw });
  for (const [x, z] of [[-33.2, -26], [-31.8, -26.9], [25, 17], [27, 19.5], [12, -24], [-21, 28], [-31, 30]]) props.add('bush', x, z);
  for (const [x, z] of [[-31, -12], [31, -6], [-31, 8]]) props.add('tree', x, z);
  for (const [x, z] of [[-20, -14], [-20.9, -13.2], [-20.2, -12.3], [27, 8]]) props.add('barrel', x, z);
  props.add('truck', 30, 27, { yaw: 0 });
  props.add('car', -22, 8.5, { yaw: 0.4 }); props.add('car', 12, 14, { yaw: -0.5, color: 0x2f6fb0 });
  props.add('dumpster', -17, 14, { yaw: 0.2 }); props.add('dumpster', 19, 0, { yaw: Math.PI / 2 });
  for (const [x, z] of [[-3, 17.2], [4, 20], [-8, -3], [8, -3], [26, -22]]) props.add('trash', x, z);
  props.add('bench', 7, 17, { yaw: Math.PI / 2 }); props.add('bench', -13, 17, { yaw: 0 });
  for (const [x, z] of [[-9, 1], [9, 1], [-17, -4]]) props.add('light', x, z);
  props.add('rock', 30, 2, { r: 0.9 }); props.add('rock', -30, -3, { r: 0.9 }); props.add('rock', 28, -12, { r: 1.45 }); props.add('pebble', -28, 12, { r: 0.45 }); props.add('pebble', 30, 12, { r: 0.5 });
}
// ---- the lagoon (Ripjaws' water): replaces the old decorative pool with a real basin, swim volume, rocks, sunken props
if (island) props.setSpawns(island.spawns);
if (island) { game.civ = new Civilians(game, island, 200); game.swim = new SurfaceSwim(game); }
if (island) game.traffic = new Traffic(game, island, 44);
if (island) { game.trainBots = new TrainBots(game, island); window.__bots = game.trainBots; }
if (island) { game.destruct = new Destruct(game, island); window.__destruct = game.destruct; }
if (island) { game.minimap = new Minimap(game, island); game.dayNight = new DayNight(game, island); window.__dayNight = game.dayNight; document.body.classList.add('island'); const cp = document.getElementById('controls'); if (cp) cp.classList.add('hide'); }   // the open world starts with the controls list folded (H opens it)
const lagoon = game.lagoon = new IslandWater(game); lagoon.populate(props);   // V28: the whole island's sea / bay / river / lake (same API as the old lagoon)
if (island) { game.seaBots = new SeaBots(game); window.__sea = game.seaBots; game.mothership = new Mothership(game, island, loadGLB); window.__ship = game.mothership; game.invasion = new Invasion(game); window.__inv = game.invasion; game.finale = new Finale(game, loadGLB); window.__fin = game.finale; game.destruct.holdFn = null; }   // V30 hostile underwater enemies
game.fa = new FaPlayer(game, rigF);
game.fire = new FireSystem(game);
game.hb = new HbPlayer(game, rigH);
game.tech = new TechSystem(game);
game.up = new UpPlayer(game, rigU, game.tech);
game.sense = new TrackingSense(game);
game.wm = new WmPlayer(game, rigW);
game.stealth = new Stealth(game);
game.gf = new GfPlayer(game, rigG);
game.rj = new RjPlayer(game, rigR);
game.slime = new SlimeSystem(game);
// Stinkfly's slime status also works on the player: the player is wrapped in a proxy "target" (hit spheres + root) so the existing SlimeSystem can coat / slow / trap it
game.gooProxy = { dead: false, name: 'you', spheres: [{ local: new THREE.Vector3(0, 1, 0), r: 0.5 }], root: null, slimeMul: undefined, noWobble: true };        // V6: the player's root is NEVER wobbled by the slime coat (that `rotation.x/z +=` accumulated on the player's root = the goo twisting bug)
game.gooTarget = () => { const P = game.player, gp = game.gooProxy; if (gp.root !== P.root) { game.slime.clear(gp); gp.root = P.root; } const sc = P.root ? (P.root.getWorldScale(new THREE.Vector3()).y || 1) : 1, hs = P.hitSphere || { y: 1.2, r: 0.9 }; gp.spheres[0].local.set(0, hs.y / sc, 0); gp.spheres[0].r = hs.r / sc; return gp; };
game.sf = new SfPlayer(game, rigS);
game.ben = new BenPlayer(game, rigBen);
game.cb = new CbPlayer(game, rigC);
game.gmt = new GmTech(game);
game.gm = new GmPlayer(game, rigM);
// Way Big: an 80 m giant. His district (buildings, props, enemies) lives OUTSIDE the arena and only exists while he is the active alien.
const wbFx = game.wbfx = new WbFx(game), district = game.district = new WbDistrict(game); district.fx = wbFx; district.disabled = world.island; if (!world.island) district.populate(props);
game.wb = new WbPlayer(game, rigWb, district, wbFx); district.wb = game.wb;
{ const rs0 = world.raySolid.bind(world); world.raySolid = (o, d, maxT, noGround) => { let h = rs0(o, d, maxT, noGround); if (district.active) { const dh = district.ray(o, d, h ? h.t : maxT); if (dh && (!h || dh.t < h.t)) h = { t: dh.t, normal: dh.normal, point: dh.point }; } return h; }; }   // rays (camera, aim, sight) also see the live building lattice
const HB_PANELS = ['abilities-hb', 'ctl-hb', 'hb-bars'], UP_PANELS = ['abilities-up', 'ctl-up', 'up-bars'], WM_PANELS = ['abilities-wm', 'ctl-wm', 'wm-bars', 'wmhint'], GF_PANELS = ['abilities-gf', 'ctl-gf', 'gf-bars', 'gfhint'], RJ_PANELS = ['abilities-rj', 'ctl-rj', 'rj-bars', 'rjhint'], SF_PANELS = ['abilities-sf', 'ctl-sf', 'sf-bars', 'sfhint'], CB_PANELS = ['abilities-cb', 'ctl-cb', 'cb-bars', 'cbhint'], GM_PANELS = ['abilities-gm', 'ctl-gm', 'gm-bars', 'gmhint'], WB_PANELS = ['abilities-wb', 'ctl-wb', 'wb-bars', 'wbhint'];
const BEN_PANELS = ['abilities-ben', 'ctl-ben', 'ben-bars'];
const DH_PANELS = ['abilities', 'ctl-dh', 'shieldbar', 'conbar'], X_PANELS = ['abilities-x', 'ctl-x', 'timebar'], F_PANELS = ['abilities-fa', 'ctl-fa', 'fa-bars'];
game.chars = new CharacterManager(game, {
  ben: {
    name: 'BEN TENNYSON', subtitle: 'HUMAN · OMNITRIX', movementType: 'human', abilities: 'ben', model: 'assets/ben.glb',
    controller: game.ben, accent: '#8dff3a', line: 'rgba(141, 255, 58, .38)', panels: BEN_PANELS, cam: { height: 1.45, shoulder: 0.6, dist: 4.6, fov: 60 },
    onLeave() { game.ben.cancelAll(); game.ben.omni.raise = 0; game.ben.omni.press = 0; },
  },
  diamondhead: {
    name: 'DIAMONDHEAD', subtitle: 'CHARACTER TEST · ALL POWERS', movementType: 'heavy', abilities: 'diamondhead', model: 'assets/diamondhead.glb',
    controller: game.dh, accent: '#39ffa0', line: 'rgba(57, 255, 160, .35)', panels: DH_PANELS, cam: { height: 2.15, shoulder: 0.95, dist: 7.2, fov: 60 },
    onLeave() { game.power.release(); game.p2.releaseAll(); game.p2.act = null; game.p2.noDash = false; game.p2.layer.w = 0; game.power.state = 'idle'; game.power.queue.length = 0; game.power.held = false; },
  },
  xlr8: {
    name: 'XLR8', subtitle: 'SPEED TEST · ALL POWERS', movementType: 'speed', abilities: 'xlr8', model: 'assets/xlr8.glb',
    controller: game.xlr, accent: '#4db8ff', line: 'rgba(77, 184, 255, .38)', panels: X_PANELS, cam: { height: 1.75, shoulder: 0.8, dist: 6.4, fov: 62 },
    onLeave() { game.time.end(); game.xlr.combo = null; game.xlr.cancelAct(); game.xlr.layer.w = 0; },
  },
  fourarms: {
    name: 'FOUR ARMS', subtitle: 'STRENGTH TEST · ALL POWERS', movementType: 'strength', abilities: 'fourarms', model: 'assets/fourarms.glb',
    controller: game.fa, accent: '#ff7a3a', line: 'rgba(255, 122, 58, .4)', panels: F_PANELS, cam: { height: 2.7, shoulder: 1.2, dist: 10.5, fov: 62 },
    onLeave() { game.fa.cancelAll(); },
  },
  heatblast: {
    name: 'HEATBLAST', subtitle: 'FIRE TEST · ALL POWERS', movementType: 'fire', abilities: 'heatblast', model: 'assets/heatblast.glb',
    controller: game.hb, accent: '#ff7a1a', line: 'rgba(255, 122, 26, .42)', panels: HB_PANELS, cam: { height: 2.4, shoulder: 1.05, dist: 8.4, fov: 62 },
    onLeave() { game.hb.cancelAll(); },
  },
  upgrade: {
    name: 'UPGRADE', subtitle: 'TECHNOLOGY TEST · ALL POWERS', movementType: 'liquid', abilities: 'upgrade', model: 'assets/upgrade.glb',
    controller: game.up, accent: '#2dff7a', line: 'rgba(45, 255, 122, .4)', panels: UP_PANELS, cam: { height: 2.0, shoulder: 0.9, dist: 6.8, fov: 60 },
    onLeave() { game.up.leave(); game.up.cancelAll(); },
  },
  wildmutt: {
    name: 'WILDMUTT', subtitle: 'TRACKING TEST · ALL POWERS', movementType: 'beast', abilities: 'wildmutt', model: 'assets/wildmutt.glb',
    controller: game.wm, accent: '#ffb02e', line: 'rgba(255, 176, 46, .4)', panels: WM_PANELS, cam: { height: 1.9, shoulder: 0.8, dist: 7.4, fov: 62 },
    onLeave() { game.sense.setOn(false, true); game.wm.cancelAll(); },     // Tracking Sense never leaks into another alien: grade, outlines and marks are gone in the same frame
  },
  ghostfreak: {
    name: 'GHOSTFREAK', subtitle: 'STEALTH TEST · ALL POWERS', movementType: 'ghost', abilities: 'ghostfreak', model: 'assets/ghostfreak.glb',
    controller: game.gf, accent: '#b48cff', line: 'rgba(170, 130, 255, .42)', panels: GF_PANELS, cam: { height: 2.3, shoulder: 0.9, dist: 7.6, fov: 62 },
    onLeave() { game.gf.leave(); camRig.noClip = false; },     // possession ends, phasing ejects him from any wall, invisibility / tentacles / grabs are dropped BEFORE the next alien appears
  },
  ripjaws: {
    name: 'RIPJAWS', subtitle: 'AQUATIC TEST · ALL POWERS', movementType: 'aquatic', abilities: 'ripjaws', model: 'assets/ripjaws.glb',
    controller: game.rj, accent: '#2ec8d8', line: 'rgba(46, 200, 216, .42)', panels: RJ_PANELS, cam: { height: 2.3, shoulder: 0.9, dist: 7.2, fov: 62 },
    onLeave() { game.rj.leave(); },     // attacks / bubbles / swim camera are dropped BEFORE the next alien appears; only Ripjaws can be in deep water (others are put at the surface)
  },
  stinkfly: {
    name: 'STINKFLY', subtitle: 'FLIGHT TEST · ALL POWERS', movementType: 'flyer', abilities: 'stinkfly', model: 'assets/stinkfly.glb',
    controller: game.sf, accent: '#9be030', line: 'rgba(155, 224, 48, .42)', panels: SF_PANELS, cam: { height: 2.3, shoulder: 0.9, dist: 7.6, fov: 62 },
    onLeave() { game.sf.leave(); camRig.pitchMin = -0.28; camRig.pitchMax = 1.25; },     // flight state, held button, slime in the air, wing blur are dropped BEFORE the next alien appears (the new alien's own physics take over)
  },
  cannonbolt: {
    name: 'CANNONBOLT', subtitle: 'ROLL TEST · ALL POWERS', movementType: 'ball', abilities: 'cannonbolt', model: 'assets/cannonbolt.glb',
    controller: game.cb, accent: '#ffd21e', line: 'rgba(255, 210, 30, .42)', panels: CB_PANELS, cam: { height: 2.5, shoulder: 0.9, dist: 8.2, fov: 62 },
    onLeave() { game.cb.leave(); camRig.pitchMin = -0.28; camRig.pitchMax = 1.25; },     // passengers are released, rolling physics switched off and he is put on his feet at a valid spot BEFORE the next alien appears
  },
  greymatter: {
    name: 'GREY MATTER', subtitle: 'TINY TECH TEST · ALL POWERS', movementType: 'tiny', abilities: 'greymatter', model: 'assets/greymatter.glb',
    controller: game.gm, accent: '#9fd0ff', line: 'rgba(150, 200, 255, .42)', panels: GM_PANELS, cam: { height: 0.11, shoulder: 0.035, dist: 0.5, fov: 62, cs: 0.1, near: 0.02, minD: 0.2 },
    onLeave() { game.gm.leave(); camRig.pitchMin = -0.28; camRig.pitchMax = 1.25; },     // interactions end, turret control is released, and he is NOT left in a vent / gap: the next alien gets a nearby spot where it really fits (never inside geometry, never a far teleport)
  },
  waybig: {
    name: 'WAY BIG', subtitle: 'GIANT TEST · ALL POWERS', movementType: 'giant', abilities: 'waybig', model: 'assets/waybig.glb',
    controller: game.wb, accent: '#ff6a4a', line: 'rgba(255, 106, 74, .42)', panels: WB_PANELS, cam: { height: 62, shoulder: 14, dist: 125, fov: 58, cs: 12, near: 2, far: 3000, minD: 24 },
    onLeave() { if (game.finale) game.finale.deevolve(); game.wb.leave(); camRig.pitchMin = -0.28; camRig.pitchMax = 1.25; camRig.fix = null; },     // held objects are dropped, attacks end, the district is hidden and he is put on a legal arena spot BEFORE the next (human-sized) alien appears; the city keeps its state
    onEnter() { camRig.fix = (pos) => { if (!district.active) return; const id = district.cellAtPoint(pos.x, pos.y, pos.z); if (id >= 0) pos.y = district.topAt(pos.x, pos.z) + 3; pos.y = Math.max(pos.y, 4.2); }; },
  },
}, 'ben');
game.dh.root.visible = false; game.ben.root.visible = true; game.player = game.ben;
camRig.height = 1.45; camRig.heightGoal = 1.45; camRig.shoulder = camRig.shoulderGoal = 0.6; camRig.dist = camRig.curDist = camRig.targetDist = 4.6; camRig.yaw = 0; camRig.update(0.016, game.ben.pos, true);
const isBen = () => game.chars.id === 'ben', isX = () => game.chars.id === 'xlr8', isFA = () => game.chars.id === 'fourarms', isHB = () => game.chars.id === 'heatblast', isUP = () => game.chars.id === 'upgrade', isWM = () => game.chars.id === 'wildmutt', isGF = () => game.chars.id === 'ghostfreak', isRJ = () => game.chars.id === 'ripjaws', isSF = () => game.chars.id === 'stinkfly', isCB = () => game.chars.id === 'cannonbolt', isGM = () => game.chars.id === 'greymatter', isWB = () => game.chars.id === 'waybig';

// shared combat-impact system (knockback / stagger / knockdown / launch for the player's body; Kevin uses the same ImpactBody)
game.impact = new ImpactSystem(game);
game.impact.interrupt = (P, id) => {          // a heavy hit interrupts what the player was doing (never a rolling ball / giant)
  if (id === 'waybig' || P.form === 'ball') return;
  if (id === 'diamondhead') { game.power.release(); game.p2.releaseAll(); game.p2.act = null; game.p2.noDash = false; game.p2.layer.w = 0; game.power.state = 'idle'; game.power.queue.length = 0; game.power.held = false; }
  else if (id === 'xlr8') { game.xlr.combo = null; game.xlr.cancelAct(); }
  else if (typeof P.cancelAll === 'function') P.cancelAll();
};

// ---- THE OMNITRIX (Ben <-> alien state machine, selection dial, random mode, 120 s / 60 s timers, HUD + settings)
game.omni = new Omnitrix(game, game.ben);

// training props: enemy dummies in an arc + a row of bullseye targets
const dummies = [];
for (const [x, z] of [[-9, -12], [-4, -15], [2, -13], [8, -16], [13, -11], [-14, -18], [27, -24.4]]) {
  const d = new Dummy(scene, world, new THREE.Vector3(x, 0, z), Math.atan2(-x, 14 - z) * 0 + 0);
  d.root.rotation.y = Math.atan2(0 - x, 14 - z); dummies.push(d);
}
for (const [x, z, ph] of [[-18, -1, 0], [19, 2, 1.2]]) game.enemies.add(new Turret(scene, world, new THREE.Vector3(x, 0, z), game, ph));
// living sentries (Ghostfreak's stealth + possession targets): they stand a post, spot the player, shoot / baton him, and search where they last saw him
for (const [x, z, yaw, name] of [[22, -8, Math.PI * 0.75, 'GUARD A'], [-28, -9, Math.PI * 0.3, 'GUARD B'], [-24, 12, Math.PI * 0.6, 'GUARD C']]) game.guards.push(new Guard(scene, world, new THREE.Vector3(x, 0, z), yaw, game, name));
// ---- KEVIN 11: the boss villain (AI only, NOT in the Omnitrix / character list)
const kevin = game.kevin = new Kevin(scene, world, new THREE.Vector3(32, 0, -32), -Math.PI * 0.25, game, rigK);
// ---- VILGAX: the second boss (AI only, NOT in the Omnitrix). Own GLB, own AI / health / phases / respawn; HP = 1.75 x Kevin's
const vilgax = game.vilgax = new Vilgax(scene, world, new THREE.Vector3(-29, 0, -29), Math.PI * 0.25, game, rigV);
vilgax.maxHp = vilgax.hp = kevin.maxHp * 1.75;
// ---- BOSS MANAGER: every boss starts DESPAWNED (out of the world, not just hidden); the player decides which exist (B / BOSS MANAGER button)
// ---- ALBEDO: the third boss (AI only). Human form = assets/albedo.glb; 12 alien forms = second instances of the real controllers (cloned GLBs); Ultimate Wildmutt = assets/ultimatewildmutt.glb
const albedo = game.albedo = new Albedo(scene, world, new THREE.Vector3(30, 0, -17), -Math.PI * 0.6, game, { diamondhead: gltf, xlr8: gltfX, fourarms: gltfF, heatblast: gltfH, upgrade: gltfU, wildmutt: gltfW, ghostfreak: gltfG, ripjaws: gltfR, stinkfly: gltfS, cannonbolt: gltfC, cannonball: gltfB, greymatter: gltfM, waybig: gltfWb, ultimatewildmutt: gltfUw, albedo: gltfAl });
game.bossList = [kevin, vilgax, albedo];
game.bosses = new BossManager(game, [{ id: 'kevin', name: 'Kevin 11', boss: kevin }, { id: 'vilgax', name: 'Vilgax', boss: vilgax }, { id: 'albedo', name: 'ALBEDO', boss: albedo }]);
if (world.island) installChaos(game);   // V28: random valid spawn points + roaming / chaos while the player is not engaged
kevin.bossDespawn(); vilgax.bossDespawn(); albedo.bossDespawn(); game.bosses.updateUI();
buildTechWorld(game, game.tech);
// V28: city traffic control cabinet (Upgrade merges with it): the signals of every intersection -> normal cycle / all red (traffic stops) / all green
if (island && game.traffic) {
  const C = island.city, TR = game.traffic, x = C.xs[2] + C.xw[2] / 2 + 1.7, z = C.zs[2] - C.zw[2] / 2 - 5;
  const box = props.add('computer', x, z, { yaw: Math.PI / 2, planted: true, y: world.terrain.height(x, z) });
  game.tech.addConsole(box, 'CITY TRAFFIC CONTROL', [
    { name: 'ALL SIGNALS RED', lvl: 0, on: () => TR.mode === 'allred', run: () => { TR.mode = TR.mode === 'allred' ? 'normal' : 'allred'; } },
    { name: 'ALL SIGNALS GREEN', lvl: 1, on: () => TR.mode === 'green', run: () => { TR.mode = TR.mode === 'green' ? 'normal' : 'green'; } },
    { name: 'NORMAL CYCLE', lvl: 0, on: () => TR.mode === 'normal', run: () => { TR.mode = 'normal'; } },
  ]);
  TR.console = box;
}
const gmWorld = buildGmWorld(game, world, props, dummies, game.tech);   // Grey Matter's micro district: vent, gap tests, tech devices, cameras
const cbWorld = buildCbWorld(game, world, props, dummies);   // Cannonbolt roll course: ramps, kerb, stairs, crates, small enemies
// climb test building (Wildmutt): a low annex (2.7 m) that leads up to a tower (5.4 m), rough concrete, behind the low wall at the north edge
{ const cm = new THREE.MeshStandardMaterial({ color: 0xa6a094, roughness: 0.96 }), dk = new THREE.MeshStandardMaterial({ color: 0x20262c, roughness: 0.4, metalness: 0.2 });
  world.addBox(6, 0, -32.7, 6, 5.4, 5.4, cm); world.addBox(0.5, 0, -33.4, 5, 2.7, 4, cm);
  for (const x of [4.3, 7.7]) world.addBox(x, 2.7, -29.97, 1.1, 1.4, 0.1, dk, { collide: false, cast: false }); for (const x of [-0.6, 1.6]) world.addBox(x, 1.0, -31.37, 1.0, 1.0, 0.1, dk, { collide: false, cast: false }); for (const z of [-34, -31.7]) world.addBox(9.03, 2.9, z, 0.1, 1.5, 1.1, dk, { collide: false, cast: false }); }
// underwater training dummies for Ripjaws (they drift inside the lagoon; every alien's projectiles can hit them too)
const divers = [];
for (const [x, y, z] of [[-5.6, -2.3, 28.2], [-11.2, -2.0, 27.8], [-3.4, -2.6, 32.4], [-12.2, -2.3, 29.6]]) divers.push(new Diver(game, new THREE.Vector3(x, y, z)));
for (const d of dummies) d.onImpact = (dm, sp) => { hud.hit(dm.root.position.clone().setY(1.6), 12, dm); fx.glow.emit({ pos: dm.root.position.clone().setY(1.2), size: 2, life: 0.18, drag: 0, color: [0.9, 0.95, 1], alpha: 1 }); camRig.addTrauma(0.3); game.sfx.hit(false); game.xlr.pstats.impacts++; };
const targets = [];
for (let i = 0; i < 5; i++) { const t = new Target(scene, world, new THREE.Vector3(-14 + i * 7, 0, -26), 0); targets.push(t); }
// V28: the open world has NO training dummies / bullseye targets / drifting test divers (minions and micro dummies of the old courses included): retire them all
if (world.island) {
  const retire = (d) => { const hi = world.hittables.indexOf(d); if (hi >= 0) world.hittables.splice(hi, 1); if (d.collider) { const ci = world.cylinders.indexOf(d.collider); if (ci >= 0) world.cylinders.splice(ci, 1); d.collider.dead = true; } if (d.root) { d.root.visible = false; scene.remove(d.root); } d.dead = true; d.retired = true; };
  for (const d of dummies) retire(d); for (const t of targets) retire(t); for (const v of divers) retire(v); dummies.length = 0; targets.length = 0; divers.length = 0;
}
const resetDummies = () => { game.cb.releaseAll('RESET', null, true); if (isFA()) game.fa.dropAll(false); game.fire.clear(); game.tech.reset(); game.gmt.reset(); for (const d of dummies) { d.respawn(); } for (const gd of game.guards) gd.respawn(); for (const e of game.bosses.list) if (e.boss.present) e.boss.respawn(); game.impact.reset(); for (const dv of divers) dv.respawn(); if (isWB()) game.wb.cancelAll(); props.reset(); district.reset(); if (game.traffic) game.traffic.mode = 'normal'; lagoon.reset(); game.slime.reset(); hud.toast(world.island ? 'PROPS RESET' : 'DUMMIES + PROPS RESET'); };

// ------------------------------------------------------------------ input
// ---- Ordinary-enemy AI switch. Bosses (Kevin 11) are a separate category and are never touched by it.
game.enemyAI = {
  ordinaryEnemiesEnabled: true, bossesEnabled: true,
  setOrdinary(v) {
    this.ordinaryEnemiesEnabled = !!v; game.enemies.enabled = !!v;                       // turrets, guards, GM cameras read this flag
    if (!v) { for (let i = game.enemies.bolts.length - 1; i >= 0; i--) { const b = game.enemies.bolts[i]; if (b.owner === 'enemy') { scene.remove(b.mesh); game.enemies.bolts.splice(i, 1); } } }   // safely drop hostile bolts in flight
    for (const d of dummies) d.chase = v && chaseOn ? chaseRef : null; for (const d of divers) d.chase = v && chaseOn ? chaseRef : null;
    const b = document.getElementById('aibtn'); if (b) { b.textContent = 'OTHER AI: ' + (v ? 'ON' : 'OFF') + ' [Y]'; b.dataset.on = v ? '1' : '0'; }
  },
  toggleOrdinary() { this.setOrdinary(!this.ordinaryEnemiesEnabled); hud.toast('OTHER AI ' + (this.ordinaryEnemiesEnabled ? 'ON' : 'OFF') + (this.ordinaryEnemiesEnabled ? '' : ' — BOSSES STAY ACTIVE')); },
};
{ const b = document.getElementById('aibtn'); if (b) { b.addEventListener('mousedown', e => e.stopPropagation()); b.addEventListener('click', e => { e.stopPropagation(); game.enemyAI.toggleOrdinary(); b.blur(); }); } }
const keys = new Set(); let chaseOn = false; const chaseRef = { get pos() { return game.stealth.hidden ? game.stealth.lastSeen : game.player.pos; } }; let edgeJump = false, edgeDash = false, locked = false, started = false, paused = true, debugForce = false, freeMode = false, rightDown = false;
const active = () => (locked || debugForce || freeMode) && !paused;
// ---- BOSS MANAGER pop-up: one shared gameplay pause (game.bosses.open): the simulation does not run at all (bosses, NPCs, timers, recharges, Omnitrix), the world keeps rendering, the mouse is released
let relockT = -1e9;
function releaseHeldInput() { keys.clear(); game.omni.cancelHold(); game.ben.mouseUp(); game.wm.mouseUp(); game.gf.mouseUp(); game.rj.mouseUp(); game.sf.mouseUp(); game.cb.mouseUp(); game.gm.mouseUp(); game.wb.mouseUp(); game.power.release(); game.p2.releaseAll(); game.fa.setBlock(false); edgeJump = edgeDash = false; }
function setBossMenu(on) {
  const bm = game.bosses; if (bm.open === on) return; bm.setOpen(on);
  if (on) { releaseHeldInput(); paused = true; overlay.hidden = true; if (document.pointerLockElement) document.exitPointerLock(); }
  else if (freeMode) { paused = false; overlay.hidden = true; }
  else if (!started) { overlay.hidden = false; }
  else { relockT = performance.now(); lock(); setTimeout(() => { if (!locked && !bm.open && !freeMode) { paused = true; $('ovsub').textContent = 'PAUSED — CLICK TO RESUME'; overlay.hidden = false; } }, 350); }     // browsers may need a click to capture the mouse again: then the usual "click to resume" card appears
}
game.setBossMenu = setBossMenu; game.bosses.onClose = () => setBossMenu(false);
{ const b = document.getElementById('bmbtn'); if (b) { b.addEventListener('mousedown', e => e.stopPropagation()); b.addEventListener('click', e => { e.stopPropagation(); setBossMenu(!game.bosses.open); b.blur(); }); } }
addEventListener('keydown', e => {
  if (e.code === 'KeyB' || (e.code === 'Escape' && game.bosses.open)) { if (!e.repeat) setBossMenu(e.code === 'Escape' ? false : !game.bosses.open); e.preventDefault(); return; }
  if (game.bosses.open) { if (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Tab') e.preventDefault(); return; }       // the pop-up swallows every other key
  if (freeMode && e.code === 'Escape') { paused = !paused; keys.clear(); game.power.release(); $('ovsub').textContent = 'PAUSED — CLICK TO RESUME'; overlay.hidden = !paused; }
  if (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Tab') e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'Space') edgeJump = true;
  game.sfx.init();
  if (e.code === 'KeyV') edgeDash = true;
  if (active() && game.omni.key(e.code)) return;        // C = Omnitrix (menu / random / locked / recharging). While the selection interface is open it swallows every key (A / D rotate it, nothing moves Ben)
  if (e.code === 'KeyT' && isWB() && game.finale && game.finale.onKey('KeyT')) { /* V33: evolve to Ultimate Way Big */ } else if (e.code === 'KeyT') { if (isX()) { if (active()) startTimeSlow(); } else if (!isFA() && !isUP()) resetDummies(); }
  if (e.code === 'Digit0') resetDummies();
  if (e.code === 'KeyJ' && world.island) hud.toast('NO TRAINING DUMMIES IN THE OPEN WORLD'); else if (e.code === 'KeyJ') { chaseOn = !chaseOn; for (const d of dummies) d.chase = chaseOn && game.enemyAI.ordinaryEnemiesEnabled ? chaseRef : null; for (const d of divers) d.chase = chaseOn && game.enemyAI.ordinaryEnemiesEnabled ? chaseRef : null; hud.toast('DUMMIES CHASE ' + (chaseOn ? 'ON' : 'OFF')); }
  if (e.code === 'KeyN') { camRig.shakeLevel = ((camRig.shakeLevel ?? 2) + 2) % 3; hud.toast('CAMERA SHAKE ' + ['OFF', 'LOW', 'FULL'][camRig.shakeLevel]); }
  if (e.code === 'Tab' && game.minimap && !e.repeat) game.minimap.toggleBig();
  if (e.code === 'KeyM') { game.sfx.on = !game.sfx.on; hud.toast('SOUND ' + (game.sfx.on ? 'ON' : 'OFF')); }
  if (e.code === 'KeyH') $('controls').classList.toggle('hide');
  if (e.code === 'F3') { e.preventDefault(); dbgEl.classList.toggle('hide'); if (dbgEl.classList.contains('hide')) dbgEl.textContent = ''; else { dbgT = 0; debugPanel(0.1, true); } }
  if (e.code === 'KeyY') game.enemyAI.toggleOrdinary();
  if (active() && !game.impact.blocksAttack) { if (isX()) game.xlr.keyDown(e.code); else if (isFA()) game.fa.keyDown(e.code); else if (isHB()) game.hb.keyDown(e.code); else if (isUP()) game.up.keyDown(e.code); else if (isWM()) game.wm.keyDown(e.code); else if (isGF()) game.gf.keyDown(e.code); else if (isRJ()) game.rj.keyDown(e.code); else if (isSF()) game.sf.keyDown(e.code); else if (isCB()) game.cb.keyDown(e.code); else if (isGM()) game.gm.keyDown(e.code); else if (isWB()) { if (!(game.finale && game.finale.onKey(e.code))) game.wb.keyDown(e.code); } else game.p2.keyDown(e.code); }
});
addEventListener('keyup', e => { keys.delete(e.code); game.omni.keyUp(e.code); game.p2.keyUp(e.code); game.fa.keyUp(e.code); if (isHB()) game.hb.keyUp(e.code); if (isUP()) game.up.keyUp(e.code); if (isWM()) game.wm.keyUp(e.code); if (isGF()) game.gf.keyUp(e.code); if (isRJ()) game.rj.keyUp(e.code); if (isSF()) game.sf.keyUp(e.code); if (isCB()) game.cb.keyUp(e.code); if (isGM()) game.gm.keyUp(e.code); if (isWB()) game.wb.keyUp(e.code); });
addEventListener('blur', () => { keys.clear(); game.omni.cancelHold(); game.ben.mouseUp(); game.wm.mouseUp(); game.gf.mouseUp(); game.rj.mouseUp(); game.sf.mouseUp(); game.cb.mouseUp(); game.gm.mouseUp(); game.wb.mouseUp(); game.power.release(); game.p2.releaseAll(); game.fa.setBlock(false); });
canvas.addEventListener('mousedown', e => {
  if (e.button !== 0 || game.bosses.open) return;
  if (!active()) { if (freeMode) { paused = false; overlay.hidden = true; return; } lock(); return; }
  game.sfx.init(); if (game.impact.blocksAttack || game.omni.blocksInput) return;
  if (!isFA() && (isWM() || isRJ() || isGF() || isGM() || (isCB() && game.cb.form !== 'ball'))) { const P = game.player, a = meleeAim(game, P.pos, 5); if (a.target && P.root) { P.yaw = a.yaw; P.root.rotation.y = a.yaw; } }      // melee: face the crosshair target first
  if (isBen()) game.ben.mouseDown(); else if (isX()) game.xlr.mouseDown(); else if (isFA()) game.fa.mouseDown(); else if (isHB()) game.hb.mouseDown(); else if (isUP()) game.up.mouseDown(); else if (isWM()) game.wm.mouseDown(); else if (isGF()) game.gf.mouseDown(); else if (isRJ()) game.rj.mouseDown(); else if (isSF()) game.sf.mouseDown(); else if (isCB()) game.cb.mouseDown(); else if (isGM()) game.gm.mouseDown(); else if (isWB()) { if (!(game.finale && game.finale.onClick())) game.wb.mouseDown(); } else game.power.press();
});
addEventListener('mouseup', e => { if (e.button === 0) { game.ben.mouseUp(); game.power.release(); game.hb.mouseUp(); game.up.mouseUp(); game.wm.mouseUp(); game.gf.mouseUp(); game.rj.mouseUp(); game.sf.mouseUp(); game.cb.mouseUp(); game.gm.mouseUp(); game.wb.mouseUp(); } });
addEventListener('contextmenu', e => { if (freeMode) e.preventDefault(); });
addEventListener('mousedown', e => { if (e.button === 2) { rightDown = true; if (isFA() && active() && !freeMode) game.fa.setBlock(true); } });
addEventListener('mouseup', e => { if (e.button === 2) { rightDown = false; game.fa.setBlock(false); } });
addEventListener('mousemove', e => { if (locked || debugForce || (freeMode && rightDown && !paused)) camRig.addLook(clamp(e.movementX, -200, 200), clamp(e.movementY, -200, 200)); });
addEventListener('wheel', e => camRig.zoom(e.deltaY), { passive: true });
const overlay = $('overlay');
function lock() { if (!canvas.requestPointerLock) { document.dispatchEvent(new Event('pointerlockerror')); return; } try { const p = canvas.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => canvas.requestPointerLock()); } catch { canvas.requestPointerLock(); } }
overlay.addEventListener('click', lock);
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (locked) { started = true; paused = false; overlay.hidden = true; }
  else { paused = true; keys.clear(); game.omni.cancelHold(); game.wm.mouseUp(); game.gf.mouseUp(); game.rj.mouseUp(); game.sf.mouseUp(); game.cb.mouseUp(); game.gm.mouseUp(); game.wb.mouseUp(); game.power.release(); game.p2.releaseAll(); game.fa.setBlock(false); $('ovsub').textContent = started ? 'PAUSED — CLICK TO RESUME' : 'CLICK TO PLAY'; overlay.hidden = game.bosses.open; }
});
document.addEventListener('pointerlockerror', () => { if (performance.now() - relockT < 2000) { overlay.hidden = game.bosses.open; return; } freeMode = true; started = true; paused = false; overlay.hidden = true; hud.toast('Mouse capture unavailable: hold RIGHT mouse button (or use arrow keys) to look'); });

function readInput() {
  const on = active() && !game.omni.blocksInput;
  const k = c => on && keys.has(c);
  const inp = {
    moveX: (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0), moveY: (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0),
    run: k('ShiftLeft') || k('ShiftRight'), jump: on && edgeJump, jumpHeld: k('Space'), dash: on && edgeDash, down: k('ControlLeft') || k('ControlRight'),
  };
  edgeJump = edgeDash = false; return inp;
}

// ------------------------------------------------------------------ aim point (what the crosshair is over)
const _o = new THREE.Vector3(), _d = new THREE.Vector3(), aimPoint = new THREE.Vector3(); let aimOnTarget = false, aimHit = false;
function computeAim() {
  _o.copy(camRig.aimOrigin); _d.copy(camRig.aimDir); const max = isWB() ? 900 : 90;
  let t = max, onT = false;
  const s = world.raySolid(_o, _d, max); if (s) t = s.t;
  for (const h of world.hittables) { const r = h.intersect(_o, _d, t); if (r) { t = r.t; onT = true; } }
  aimPoint.copy(_o).addScaledVector(_d, t); game.aimPointRef = aimPoint; aimOnTarget = onT; aimHit = !!s || onT;
}

// ------------------------------------------------------------------ time slow (T)
function startTimeSlow() {
  const T = game.time;
  if (game.kTime.busy) { hud.toast('KEVIN IS CONTROLLING TIME'); return; }
  if (T.active) return;                                  // already running: pressing T again never restarts the timer
  if (!T.canStart()) { hud.toast(T.busy ? 'TIME SLOW ENDING' : 'TIME SLOW RECHARGING  ' + T.cd.toFixed(0) + 's'); return; }
  T.start(); game.sfx.slowIn(); hud.toast('TIME SLOW'); camRig.kick(0.1);
  fx.surface.ring(game.xlr.pos.clone().setY(0.08), new THREE.Vector3(0, 1, 0), 7, 0.6, 0x4db8ff);
}
let prevKPhase = 'idle', prevPhase = 'idle', moteT = 0;

// ------------------------------------------------------------------ simulation step
// dt  = PLAYER time (real seconds, frame-capped): XLR8, camera, input, effects the player owns.
// rdt = REAL seconds (uncapped): the time-slow 10 s timer and 20 s cooldown.
// wdt = WORLD time = dt x timeScale: enemies, enemy AI/animation, turret bolts, knockback physics, debris.
function activeCenters() {
  const P = game.player, out = [{ x: P.pos.x, z: P.pos.z, r: isWB() ? 260 : 170, rs: isWB() ? 140 : 95 }];
  for (const b of game.bossList || []) if (b.present) { const p = b.home || b.pos; if (p) out.push({ x: p.x, z: p.z, r: 110, rs: 60 }); }
  return out;
}
function step(dt, rdt = dt) {
  if (game.bosses.open) return;                         // BOSS MANAGER open: shared gameplay pause (nothing simulates, no timer advances)
  if (freeMode && !paused) { const k = 1.9 * dt; if (keys.has('ArrowLeft')) camRig.yaw += k; if (keys.has('ArrowRight')) camRig.yaw -= k; if (keys.has('ArrowUp')) camRig.pitch = clamp(camRig.pitch - k * 0.6, -0.28, 1.25); if (keys.has('ArrowDown')) camRig.pitch = clamp(camRig.pitch + k * 0.6, -0.28, 1.25); }
  game.impact.pre();
  world.updateActive(dt, activeCenters());              // V28: island colliders near the player and every present boss
  const inp = readInput();
  game.time.update(rdt); game.kTime.update(rdt);
  if (prevPhase !== 'out' && game.time.phase === 'out') { game.sfx.slowOut(); hud.toast('TIME NORMAL'); camRig.kick(0.08); camRig.addTrauma(0.25); }
  prevPhase = game.time.phase;
  if (prevKPhase !== 'out' && game.kTime.phase === 'out') { game.sfx.slowOut(); hud.toast('TIME NORMAL'); }
  prevKPhase = game.kTime.phase;
  const ts = game.time.scale, wdt = dt * ts, pdt = dt * game.kTime.scale; game.kdt = wdt;        // pdt = PLAYER time (slowed while Kevin's time slow runs), wdt = WORLD time (Kevin, his shots, enemies), dt = real (camera, input)
  const X = isX(), F = isFA(), H = isHB(), U = isUP(), W = isWM(), G = isGF(), R = isRJ(), S = isSF(), C = isCB(), M = isGM(), B = isWB(), N = isBen(), P = game.player;
  game.chars.update(dt); game.omni.update(dt);
  game.impact.begin(inp); game.hb.updateShots(wdt, true); game.sf.updateShots(wdt, true);    // projectiles fired by Kevin (fire / goo) run in world time whatever alien is active
  lagoon.blockOn = !R; if (game.swim) game.swim.pre(game.chars.id, P);
  if (X || F || H || U || W || G || R || S || C || M || B || N) P.updatePhysics(pdt, inp, camRig.yaw); else P.updatePhysics(pdt, inp, camRig.yaw, combat);
  if (game.swim) game.swim.post(pdt, game.chars.id, P);
  computeAim();
  const aim = game.power.update(pdt, aimPoint);
  const layer = game.p2.update(pdt, aimPoint);
  if (F || H || U || W || G || R || S || C || M || B || N) P.updatePowers(pdt, aimPoint, aimHit);
  game.sense.update(dt); game.stealth.update(dt);
  game.enemies.update(wdt);
  props.stream(dt, activeCenters()); props.update(wdt); district.update(wdt);
  if (game.civ) { for (const b of game.bossList || []) if (b.present && !b.dead) { const bp = b.home || b.pos; if (bp && (b.st === 'combat' || b.chaosT > 0 || b.state === 'alien' || b.state === 'uw' || b.state === 'switching')) world.danger(bp.x, bp.z, 34, 2); } game.civ.update(dt); }
  if (game.traffic) game.traffic.update(wdt);
  if (game.destruct) game.destruct.update(wdt);
  if (game.trainBots) game.trainBots.update(wdt);
  if (game.invasion) game.invasion.step(wdt);
  if (game.finale) game.finale.step(wdt);
  if (game.seaBots) game.seaBots.update(wdt);
  game.fire.update(wdt);
  game.tech.update(dt); game.gmt.tick(dt);
  if (X || F || H || U || W || G || R || S || C || M || B || N) P.updateAnim(pdt); else P.updateAnim(pdt, aim, layer);
  game.impact.post(pdt);
  for (const h of world.hittables) h.update(wdt);
  game.slime.update(wdt);
  // camera: character-specific speed profile
  camRig.noClip = false;
  if (N) {
    // human camera: low and close; a little pull-back at a sprint; ranges and offsets reset every frame (nothing cached from a giant / swimmer / flyer)
    const f = smoothstep(5, 8.2, P.speed);
    camRig.speedFov = damp(camRig.speedFov, 6 * f, 5, dt); camRig.distBonus = damp(camRig.distBonus, 0.9 * f, 4, dt); camRig.heightGoal = damp(camRig.heightGoal, 1.45, 4, dt); camRig.shoulderGoal = damp(camRig.shoulderGoal, 0.6, 4, dt);
    camRig.pitchMin = damp(camRig.pitchMin, -0.28, 5, dt); camRig.pitchMax = damp(camRig.pitchMax, 1.25, 5, dt);
  } else if (X) {
    const f = smoothstep(16, 44, P.speed), slow = game.time.depth;
    camRig.speedFov = damp(camRig.speedFov, 14 * f + 5 * slow, 5, dt); camRig.distBonus = damp(camRig.distBonus, 2.4 * f + 0.6 * slow, 4, dt);
    if (P.animator.sprintW > 0.6) camRig.addTrauma(0.0 + dt * 0.12);
  } else if (F) {
    const big = P.holds.some(h => h.kind === 'prop' && h.arms.length === 4), a = P.act, wide = a && (a.kind === 'pound' || a.kind === 'seismic') ? 2.2 : 0;
    camRig.speedFov = damp(camRig.speedFov, 5 * smoothstep(4.5, 9, P.speed) + (P.rage.on ? 4 : 0), 5, dt);
    camRig.distBonus = damp(camRig.distBonus, (big ? 4 : P.holds.length ? 1.6 : 0) + 1.3 * smoothstep(4.5, 9, P.speed) + wide + (P.rage.on ? 0.8 : 0), 4, dt);
    camRig.heightGoal = 2.7 + (big ? 1.0 : 0) + wide * 0.3;
  } else if (H) {
    const hs = Math.hypot(P.vel.x, P.vel.z), f = P.flying ? smoothstep(18, 54, hs) : smoothstep(6, 10, hs) * 0.3, a = P.act, big = a && (a.kind === 'burst' || a.kind === 'wave') ? 1.8 : 0;
    camRig.speedFov = damp(camRig.speedFov, 12 * f + (a && a.kind === 'burst' ? 6 * a.charge : 0), 5, dt);
    camRig.distBonus = damp(camRig.distBonus, (P.flying ? 1.2 : 0) + 4.5 * f + big, 3.5, dt); camRig.heightGoal = 2.4 + (P.flying ? 0.35 : 0) + big * 0.4;
  } else if (U) {
    const T = P.merged, v = T && T.v ? Math.abs(T.v.speed) : 0, liq = P.liquid.k;
    camRig.speedFov = damp(camRig.speedFov, 9 * smoothstep(8, 26, v), 5, dt);
    camRig.distBonus = damp(camRig.distBonus, (T ? T.camBonus : 0) - 1.4 * liq + 1.2 * smoothstep(8, 20, v), 3, dt); camRig.heightGoal = damp(camRig.heightGoal, T ? T.camH : 2.0 - 0.7 * liq, 3, dt);
  } else if (W) {
    const hs = Math.hypot(P.vel.x, P.vel.z), f = smoothstep(7, 15, hs), a = P.act, cl = P.climb ? 1 : 0;
    camRig.speedFov = damp(camRig.speedFov, 7 * f + (a && a.kind === 'pounce' && a.stage === 'air' ? 5 : 0), 5, dt);
    camRig.distBonus = damp(camRig.distBonus, 1.3 * f + 1.1 * cl + (a && a.kind === 'pounce' ? 0.6 : 0), 3.5, dt); camRig.heightGoal = damp(camRig.heightGoal, 1.9 + 0.35 * cl, 4, dt);
  } else if (G) {
    const hs = Math.hypot(P.vel.x, P.vel.z), f = smoothstep(7, 17, hs), hosted = P.poss && P.poss.stage === 'active', a = P.act;
    camRig.speedFov = damp(camRig.speedFov, hosted ? 0 : 10 * f, 4, dt);
    camRig.distBonus = damp(camRig.distBonus, hosted ? -0.4 : 2.4 * f + (a && a.kind === 'tentacle' ? 1.3 : 0) + (P.phaseOn ? 0.4 : 0), 2.8, dt); camRig.heightGoal = damp(camRig.heightGoal, hosted ? 2.0 : 2.3 + 0.25 * f, 3, dt);
    camRig.noClip = P.phaseOn || P.phaseK > 0.05;
  } else if (R) {
    const sw = P.mode === 'swim', sp3 = P.vel.length(), f = smoothstep(7.5, 20, sp3), a = P.act;
    camRig.speedFov = damp(camRig.speedFov, (sw ? 8 : 4) * f + (a && a.kind === 'bite' && a.stage === 'lunge' ? 3 : 0), 4, dt);
    camRig.distBonus = damp(camRig.distBonus, (sw ? 0.9 : 0) + 1.6 * f, 3, dt); camRig.heightGoal = damp(camRig.heightGoal, sw ? 1.25 : 2.3, 3, dt);
    camRig.pitchMin = damp(camRig.pitchMin, sw ? -1.2 : -0.28, 5, dt); camRig.pitchMax = damp(camRig.pitchMax, sw ? 1.35 : 1.25, 5, dt);   // swimming: full look up / down; on land the usual range
  } else if (C) {
    const ball = P.form === 'ball', bs = ball ? P.v.length() : P.speed, f = ball ? smoothstep(10, 40, bs) : smoothstep(5, 7, bs) * 0.15;
    camRig.speedFov = damp(camRig.speedFov, 9 * f, 3.5, dt);
    camRig.distBonus = damp(camRig.distBonus, (ball ? 0.7 : 0) + 3.0 * f, 2.6, dt); camRig.heightGoal = damp(camRig.heightGoal, 2.3 + (ball ? -0.1 : 0) + 0.3 * f, 3, dt);
    camRig.pitchMin = damp(camRig.pitchMin, -0.28, 5, dt); camRig.pitchMax = damp(camRig.pitchMax, 1.25, 5, dt);
  } else if (M) {
    // tiny-scale camera: low, close, never inside a wall; in tight spaces (low ceiling / narrow duct) it comes in, loses the shoulder offset and levels out so it stays stable
    const f = smoothstep(0.5, 1.3, P.speed), roof = P.tight.up < 0.22, narrow = P.tight.side < 0.22, climb = P.mode === 'climb' || !!P.mant;
    camRig.speedFov = damp(camRig.speedFov, 6 * f, 4, dt);
    camRig.distBonus = damp(camRig.distBonus, 0.1 * f + (P.crouched ? -0.1 : 0) + (roof ? -0.12 : 0) + (narrow ? -0.08 : 0) + (climb ? 0.08 : 0), 4, dt);
    camRig.heightGoal = damp(camRig.heightGoal, P.crouched ? 0.07 : climb ? 0.1 : 0.11, 4, dt);
    camRig.shoulderGoal = damp(camRig.shoulderGoal, narrow ? 0 : 0.035, 5, dt);
    camRig.pitchMin = damp(camRig.pitchMin, -0.1, 5, dt); camRig.pitchMax = damp(camRig.pitchMax, roof ? 0.05 : 1.05, 5, dt);
  } else if (B) {
    // giant camera: far and high, eases back while he runs / acts, never clips (district rays + push-out above buildings), shake is capped by the N setting
    const hs = Math.hypot(P.vel.x, P.vel.z), f = smoothstep(8, 25, hs), a = P.act, k = a ? a.kind : '';
    camRig.speedFov = damp(camRig.speedFov, 5 * f + (k === 'blast' ? 3 : 0), 4, dt);
    camRig.distBonus = damp(camRig.distBonus, 26 * f + (a ? 12 : 0) + (P.hold ? 14 : 0) + (k === 'stomp' ? 10 : 0), 2.5, dt);
    camRig.heightGoal = damp(camRig.heightGoal, 62 + 8 * f + (P.guard ? -10 : 0) + (k === 'stomp' ? 6 : 0), 3, dt);
    camRig.pitchMin = damp(camRig.pitchMin, -0.2, 5, dt); camRig.pitchMax = damp(camRig.pitchMax, 1.2, 5, dt);
  } else if (S) {
    const hs = Math.hypot(P.vel.x, P.vel.z), fl = P.flying ? 1 : 0, f = fl ? smoothstep(15, 36, hs) : smoothstep(5, 8.6, hs) * 0.25, a = P.act;
    camRig.speedFov = damp(camRig.speedFov, 11 * f + (a && a.kind === 'tail' ? 2 : 0), 4, dt);
    camRig.distBonus = damp(camRig.distBonus, 0.8 * fl + 4.2 * f + (a ? 0.4 : 0), 3, dt); camRig.heightGoal = damp(camRig.heightGoal, 2.3 + 0.5 * fl + 0.5 * f, 3, dt);
    camRig.pitchMin = damp(camRig.pitchMin, fl ? -0.7 : -0.28, 5, dt); camRig.pitchMax = damp(camRig.pitchMax, fl ? 1.4 : 1.25, 5, dt);
  } else { camRig.speedFov = damp(camRig.speedFov, 0, 6, dt); camRig.distBonus = damp(camRig.distBonus, 0, 6, dt); }
  camRig.update(dt, P.pos);
  lagoon.update(dt, camera, renderer); if (world.terrain) world.terrain.update(dt, camera.position); if (game_island_ref) game_island_ref.update(dt, camera.position); if (game.minimap) game.minimap.update(dt);
  if (game.dayNight) game.dayNight.update(dt, camera);
  if (game.mothership) game.mothership.update(dt, camera);
  if (game.invasion) game.invasion.visual(dt);
  if (game.finale) game.finale.visual(dt);   // V31: spaceship approach (world clock only)
  world.sky.position.copy(camera.position); world.followSun(P.pos);
  fx.shards.update(wdt); fx.fire.update(wdt, renderer, camera); fx.smoke.update(wdt, renderer, camera); fx.glow.update(dt, renderer, camera); fx.dust.update(dt, renderer, camera); fx.surface.update(dt);
  hud.crosshair.classList.toggle('hot', aimOnTarget);
  hud.update(dt); game.bosses.update();
  timeFX(dt);
  // ---- HUD per alien
  if (F) {
    const set = (k, act, cd, mx) => { $('faslot-' + k).classList.toggle('active', !!act); const el = $('facd-' + k); if (el) el.style.width = (cd > 0 ? cd / mx * 100 : 0) + '%'; };
    const a = P.act ? P.act.kind : '';
    set('lmb', P.combo, 0, 1); set('q', a === 'slam', P.cd.q, P.cdMax.q); set('e', a === 'pound', P.cd.e, P.cdMax.e); set('f', a === 'multi', P.cd.f, P.cdMax.f); set('g', a === 'throw' || a === 'grab', P.cd.g, P.cdMax.g);
    set('t', P.rage.on, P.rage.on ? 0 : P.rage.cd, P.rage.cdDur); set('r', a === 'seismic', P.cd.r, P.cdMax.r); set('v', P.holds.length, 0, 1); set('z', a === 'shove', P.cd.z, P.cdMax.z); set('rmb', P.blocking, 0, 1);
    $('fa-hp').style.width = (P.hp / 400 * 100) + '%'; const R = P.rage, rb = $('fa-ragebar');
    rb.classList.toggle('cool', !R.on); $('fa-rage').style.width = (R.on ? R.t / R.dur * 100 : R.cd > 0 ? (1 - R.cd / R.cdDur) * 100 : 100) + '%'; $('fa-ragelabel').textContent = R.on ? 'RAGE ' + R.t.toFixed(1) + 's' : R.cd > 0 ? 'RAGE RECHARGING ' + R.cd.toFixed(0) + 's' : 'RAGE READY [T]';
  } else if (H) {
    const a = P.act ? P.act.kind : '', set = (k, act, cd, mx) => { $('hbslot-' + k).classList.toggle('active', !!act); const el = $('hbcd-' + k); if (el) el.style.width = (cd > 0 ? cd / mx * 100 : 0) + '%'; };
    set('lmb', a === 'blast', P.blastCd, 0.2); set('q', a === 'fireball', P.cd.q, P.cdMax.q); set('e', a === 'punch', P.cd.e, P.cdMax.e); set('f', a === 'wave', P.cd.f, P.cdMax.f); set('g', P.prot.on || a === 'guard', P.prot.on ? 0 : P.cd.g, P.cdMax.g); set('x', P.flying || P.softLand, 0, 1); set('r', a === 'burst', P.cd.r, P.cdMax.r);
    $('hb-hp').style.width = (P.hp / 300 * 100) + '%'; const PR = P.prot, pb = $('hb-protbar'); pb.classList.toggle('cool', !PR.on);
    $('hb-prot').style.width = (PR.on ? (1 - PR.t / PR.dur) * 100 : P.cd.g > 0 ? (1 - P.cd.g / P.cdMax.g) * 100 : 100) + '%'; $('hb-protlabel').textContent = PR.on ? 'FIRE PROTECTION ' + (PR.dur - PR.t).toFixed(1) + 's' : P.cd.g > 0 ? 'PROTECTION RECHARGING ' + P.cd.g.toFixed(0) + 's' : 'FIRE PROTECTION READY [G]';
  } else if (U) {
    const a = P.act ? P.act.kind : '', M = P.merged, set = (k, act, cd, mx) => { $('upslot-' + k).classList.toggle('active', !!act); const el = $('upcd-' + k); if (el) el.style.width = (cd > 0 ? cd / mx * 100 : 0) + '%'; };
    set('lmb', !!P.techAnim || (M && M.controlled), 0, 1); set('q', a === 'laser', P.cd.q, P.cdMax.q); set('e', P.cd.e > 0, P.cd.e, P.cdMax.e); set('f', M && M.controlled, 0, 1); set('g', P.liquid.on, 0, 1); set('t', P.techAnim && P.techAnim.kind === 'detach', 0, 1);
    $('up-hp').style.width = (P.hp / 260 * 100) + '%'; $('up-en').style.width = (P.energy / P.enMax * 100) + '%';
    $('up-mach').style.width = M ? (100 * (M.prop ? M.prop.hp / M.prop.hpMax : M.turret ? M.turret.hp / M.turret.maxHp : 1)) + '%' : '0%'; $('up-machlabel').textContent = M ? M.label + ' · LV ' + M.upgradeLevel + '/' + M.maxLevel : 'NO MACHINE';
  } else if (W) {
    const a = P.act ? P.act.kind : '', set = (k, act, cd, mx) => { $('wmslot-' + k).classList.toggle('active', !!act); const el = $('wmcd-' + k); if (el) el.style.width = (cd > 0 ? cd / mx * 100 : 0) + '%'; };
    set('lmb', a === 'bite', P.cd.lmb, P.cdMax.lmb); set('f', a === 'claw', P.cd.f, 0.3); set('r', a === 'pounce', P.cd.r, P.cdMax.r); set('q', game.sense.on, 0, 1); set('e', !!P.climb, P.cd.e, P.cdMax.e); set('sp', P.mode === 'crouch' || (!P.grounded && !P.climb), 0, 1);
    $('wm-hp').style.width = (P.hp / 380 * 100) + '%'; $('wm-sense').style.width = (game.sense.k * 100) + '%'; $('wm-sensebar').classList.toggle('on', game.sense.on);
  } else if (G || R || S || C || M || B || N) {
    P.hudUpdate();
  } else if (!X) {
    $('slot-lmb').classList.toggle('active', game.power.busy);
    for (const k of ['q', 'f', 'g', 'e', 'x']) { const s = $('slot-' + k); if (!s) continue; const on = game.p2.act && ({ q: 'melee', f: 'shield', g: 'spikes', e: 'build', x: 'cannon' })[k] === game.p2.act.kind; s.classList.toggle('active', !!on); const cd = game.p2.cd[k], mx = game.p2.cdMax[k]; $('cd-' + k).style.width = (cd > 0 && k !== 'q' ? cd / mx * 100 : 0) + '%'; }
    $('conmode').textContent = game.p2.modeNames[game.p2.buildMode];
    $('sh-hp').style.width = (game.p2.sh.hp / game.p2.sh.max * 100) + '%';
    $('dashcd').style.width = (P.dashCd > 0 ? P.dashCd / 0.85 * 100 : 0) + '%';
  } else {
    $('xslot-lmb').classList.toggle('active', !!P.combo);
    const T = game.time; $('xslot-t').classList.toggle('active', T.active);
    $('xcd-t').style.width = (T.cd > 0 ? T.cd / T.cdDur * 100 : 0) + '%';
    for (const k of ['q', 'e', 'f', 'g', 'x']) { $('xcd-' + k).style.width = (P.cd[k] > 0 ? P.cd[k] / P.cdMax[k] * 100 : 0) + '%'; $('xslot-' + k).classList.toggle('active', !!P.act && P.act.kind === ({ q: 'dash', e: 'spin', f: 'clones', g: 'throw', x: 'hyper' })[k]); }
    $('xslot-z').classList.toggle('active', P.mode === 'slide' || P.mode === 'wall' || P.waterRun);
  }
}

/** screen treatment for the slow-motion ability + speed lines (DOM overlays; the HUD itself is never filtered) */
function timeFX(dt) {
  const T = game.time, d = clamp(Math.max(T.depth, game.kTime.depth), 0, 1), X = isX();
  canvas.style.filter = d > 0.01 ? 'saturate(' + (1 - 0.5 * d).toFixed(3) + ') contrast(' + (1 + 0.08 * d).toFixed(3) + ') brightness(' + (1 - 0.05 * d).toFixed(3) + ')' : '';
  $('slowfx').style.opacity = (d * 0.9).toFixed(3);
  const CBr = isCB() && game.player.form === 'ball' ? smoothstep(22, 38, game.player.v.length()) * 0.5 : 0, SFf = isSF() && game.player.flying, sp = X ? smoothstep(26, 44, game.player.speed) : CBr ? CBr : SFf ? smoothstep(24, 36, game.player.speed) * 0.55 : 0; $('speedfx').style.opacity = (sp * 0.75).toFixed(3);
  const tb = $('timebar');
  if (X) {
    tb.hidden = !(T.busy || T.cd > 0); tb.classList.toggle('cool', !T.active);
    if (T.active) { $('tb-label').textContent = 'TIME SLOW'; $('tb-fill').style.width = (T.remaining / T.dur * 100) + '%'; $('tb-time').textContent = T.remaining.toFixed(1) + 's'; }
    else if (T.cd > 0) { $('tb-label').textContent = 'RECHARGING'; $('tb-fill').style.width = ((1 - T.cd / T.cdDur) * 100) + '%'; $('tb-time').textContent = T.cd.toFixed(0) + 's'; }
  }
  // slow, drifting blue motes: the visible "air is thick" cue while the world is slowed
  if (d > 0.3 && X) { moteT -= dt; if (moteT <= 0) { moteT = 0.03; const c = camRig.focus; fx.glow.emit({ pos: new THREE.Vector3(c.x + (Math.random() - .5) * 22, 0.3 + Math.random() * 5, c.z + (Math.random() - .5) * 22), vel: new THREE.Vector3((Math.random() - .5) * 0.25, (Math.random() - .5) * 0.2, (Math.random() - .5) * 0.25), size: 0.07 + Math.random() * 0.1, life: 3.5, drag: 0.2, color: [0.45, 0.75, 1], alpha: 0.7 }); } }
}

// ------------------------------------------------------------------ debug panel
let dbgT = 0, frames = 0, fps = 0, fpsT = 0; const dbgEl = $('debug'); dbgEl.classList.add('hide'); dbgEl.textContent = '';
function debugPanel(dt, force) {
  frames++; fpsT += dt; if (fpsT >= 0.5) { fps = frames / fpsT; frames = 0; fpsT = 0; }
  if (!force && dbgEl.classList.contains('hide')) return;       // developer overlay (F3) is OFF by default: nothing is built or shown
  dbgT -= dt; if (dbgT > 0 && !force) return; dbgT = 0.1; const P = game.player, A = P.animator, X = isX(), T = game.time;
  const F = isFA(), H = isHB(), U = isUP(), W = isWM(), G = isGF(), RJ = isRJ(), SFd = isSF(), CBd = isCB(), GMd = isGM(), WBd = isWB(), SS = game.sense;
  $('debug').textContent = isBen() ? P.debugText() : WBd ? P.debugText() : GMd ? P.debugText() : CBd ? P.debugText() : SFd ?
`FPS ${fps.toFixed(0)}   STINKFLY   state ${P.state}\nspeed ${P.speed.toFixed(1)} m/s (vy ${P.vel.y.toFixed(1)})   alt ${(P.alt || 0).toFixed(1)}   mode ${P.mode}   grounded ${P.grounded ? 'y' : 'n'}   FLIGHT ${P.flightActive ? 'ACTIVE' : 'inactive'}   hp ${P.hp.toFixed(0)}\npos ${P.pos.x.toFixed(1)}, ${P.pos.y.toFixed(1)}, ${P.pos.z.toFixed(1)}   wings: open ${P.an.wo.toFixed(2)} amp ${P.an.wa.toFixed(2)} ${P.an.wf.toFixed(1)} Hz\nslime shots ${P.stats.slimeShots}  blobs ${P.shots.length}  hits ${P.stats.slimeHits}  surface ${P.stats.surfaceHits}  claws ${P.stats.claws} (hits ${P.stats.clawHits})  tails ${P.stats.tails} (hits ${P.stats.tailHits})\nflights ${P.stats.flights}  takeoffs ${P.stats.takeoffs}  landings ${P.stats.landings}  flyTime ${P.stats.flyTime.toFixed(1)}s  max alt ${P.stats.maxAlt.toFixed(1)}\nslimed targets ${game.slime.map.size}  splats ${game.slime.liveDecals}/${game.slime.decals.length}  trapped ${game.slime.stats.trapped}  expired ${game.slime.stats.expired}\nGLB: ${reportS.meshes.length} meshes · ${reportS.verts} verts · skins ${reportS.skinned} · bones ${reportS.bones} · clips ${reportS.clips}\n→ GLB's own 67-bone skeleton driven procedurally (wing bones, 4-leg IK, claw IK, eyestalk aim)` : RJ ?
`FPS ${fps.toFixed(0)}   RIPJAWS   state ${P.state}\nspeed ${P.speed.toFixed(1)} m/s (3D ${P.vel.length().toFixed(1)})   mode ${P.mode}   env ${P.env}   depth ${P.depth.toFixed(1)} m   hp ${P.hp.toFixed(0)}   breathing: always\npos ${P.pos.x.toFixed(1)}, ${P.pos.y.toFixed(1)}, ${P.pos.z.toFixed(1)}   tilt ${P.tilt.toFixed(2)}   water y ${lagoon.waterY}   lagoon bubbles ${lagoon.bubbles.alive}   divers ${divers.map(d => d.dead ? 'x' : d.hp.toFixed(0)).join('/')}\nbites ${P.stats.bites}  hits ${P.stats.hits}  claws ${P.stats.claws} (hits ${P.stats.clawHits})  chomped ${P.stats.chomped}  entries ${P.stats.entries}  exits ${P.stats.exits}  breaches ${P.stats.breaches}  jumps ${P.stats.jumps}  swim ${P.stats.swimTime.toFixed(1)}s  max depth ${P.stats.maxDepth.toFixed(1)}\ncd bite ${P.cd.lmb.toFixed(1)} claw ${P.cd.e.toFixed(1)}   act ${P.act ? P.act.kind + ':' + P.act.stage : '-'}\nGLB: ${reportR.meshes.length} meshes · ${reportR.verts} verts · skins ${reportR.skinned} · bones ${reportR.bones} · clips ${reportR.clips}\n→ static GLB meshes auto-rigged at load (${rigR.report.bones} bones) + procedural land / swim / bite / claw animation` : G ?
`FPS ${fps.toFixed(0)}   GHOSTFREAK   state ${P.state}\nspeed ${P.speed.toFixed(1)} m/s   alt ${(P.alt || 0).toFixed(1)}   grounded ${P.grounded ? 'y' : 'n'}   hp ${P.hp.toFixed(0)}\npos ${P.pos.x.toFixed(1)}, ${P.pos.y.toFixed(1)}, ${P.pos.z.toFixed(1)}\nINVISIBILITY ${P.invis.toFixed(2)} (AI hidden: ${game.stealth.hidden ? 'yes' : 'no'}, reveal ${game.stealth.reveal.toFixed(1)}s)   INTANGIBLE ${P.phaseOn ? 'ON' : 'off'} k ${P.phaseK.toFixed(2)}   POSSESSION ${P.poss ? P.poss.stage + ' ' + P.poss.host.name : '-'}\nguards ${game.guards.map(o => o.name.slice(-1) + ':' + (o.dead ? 'down' : o.possessed ? 'HOST' : o.st)).join('  ')}   lost-track events ${game.stealth.stats.lostTrack}\nclaws ${P.stats.claws} (hits ${P.stats.clawHits})  tentacles ${P.stats.tentacles} (hits ${P.stats.tentHits}, grabs ${P.stats.grabs}, throws ${P.stats.throws})  phases ${P.stats.phases} (ejects ${P.stats.ejects})  possessions ${P.stats.possessions}\ncd claw ${P.cd.lmb.toFixed(1)} tentacle ${P.cd.e.toFixed(1)} possess ${P.cd.q.toFixed(1)}\nGLB: ${reportG.meshes.length} meshes · ${reportG.verts} verts · skins ${reportG.skinned} · bones ${reportG.bones} · clips ${reportG.clips}\n→ GLB's own 45-bone skeleton driven procedurally (FK + stretch IK arms, tail = lower body)` : W ?
`FPS ${fps.toFixed(0)}   WILDMUTT   state ${P.state}\nspeed ${P.speed.toFixed(1)} m/s   grounded ${P.grounded ? 'y' : 'n'}   mode ${P.mode}   hp ${P.hp.toFixed(0)}\npos ${P.pos.x.toFixed(1)}, ${P.pos.y.toFixed(1)}, ${P.pos.z.toFixed(1)}\nTRACKING SENSE ${SS.on ? 'ACTIVE' : 'off'}  k ${SS.k.toFixed(2)}  tracked ${SS.nTracked}  scent marks ${SS.trails.length}  toggles ${SS.stats.toggles}\nbites ${P.stats.bites}  claws ${P.stats.claws}  pounces ${P.stats.pounces} (hits ${P.stats.pounceHits})  hits ${P.stats.hits}  torn ${P.stats.torn}  climbs ${P.stats.climbs}  jumps ${P.stats.jumps}  landings ${P.stats.landings}\ncd bite ${P.cd.lmb.toFixed(1)} claw ${P.cd.f.toFixed(1)} pounce ${P.cd.r.toFixed(1)}   climb ${P.climb ? P.climb.stage + ' grip ' + (P.climb.grip * 100).toFixed(0) + '%' : P.nearClimb ? 'ledge in reach' : '-'}\nGLB: ${reportW.meshes.length} meshes · ${reportW.verts} verts · skins ${reportW.skinned} · bones ${reportW.bones} · clips ${reportW.clips}\n→ GLB's own 84-bone skeleton driven procedurally (4-leg IK + FK spine)` : U ?
`FPS ${fps.toFixed(0)}   UPGRADE   state ${P.state}\nspeed ${P.speed.toFixed(1)} m/s   grounded ${P.grounded ? 'y' : 'n'}   hp ${P.hp.toFixed(0)}   energy ${P.energy.toFixed(0)}   liquid ${P.liquid.on ? 'ON' : 'off'}\npos ${P.pos.x.toFixed(1)}, ${P.pos.y.toFixed(1)}, ${P.pos.z.toFixed(1)}\nmerged ${P.merged ? P.merged.label + ' LV' + P.merged.upgradeLevel + (P.merged.controlled ? ' CTRL' : '') : '-'}   machines ${game.tech.list.length}\nmerges ${game.tech.stats.merges} controls ${game.tech.stats.controls} enhances ${game.tech.stats.enhances} detaches ${game.tech.stats.detaches} lasers ${P.stats.lasers}\nGLB: ${reportU.meshes.length} meshes · ${reportU.verts} verts · skins ${reportU.skinned} · clips ${reportU.clips}\n→ procedural ${reportU.bones}-bone rig + procedural animation` : H ?
`FPS ${fps.toFixed(0)}   HEATBLAST   state ${P.state}\nspeed ${P.speed.toFixed(1)} m/s   alt ${(P.alt || 0).toFixed(1)}   mode ${P.mode}   grounded ${P.grounded ? 'y' : 'n'}   hp ${P.hp.toFixed(0)}\npos ${P.pos.x.toFixed(1)}, ${P.pos.y.toFixed(1)}, ${P.pos.z.toFixed(1)}\nblasts ${P.stats.blasts} hits ${P.stats.hits}  fireballs ${P.stats.fireballs}  punches ${P.stats.punches}  waves ${P.stats.waves}  prot ${P.stats.prot}  bursts ${P.stats.bursts}\nshots ${P.shots.length}  ground fires ${game.fire.fires.length}  burning ${game.fire.burners.size}  ignited ${game.fire.stats.ignited}  explosions ${game.fire.stats.explosions}  cars exploded ${game.fire.stats.carsExploded}\nflights ${P.stats.flights}  landings ${P.stats.landings}  flyTime ${P.stats.flyTime.toFixed(1)}s\nGLB: ${reportH.meshes.length} meshes · ${reportH.verts} verts · skins ${reportH.skinned} · bones ${reportH.bones} · clips ${reportH.clips}\n→ GLB skeleton driven procedurally (IK hands, flames/particles added on top)` : F ?
`FPS ${fps.toFixed(0)}   FOUR ARMS   state ${P.state}\nspeed ${P.speed.toFixed(1)} m/s   grounded ${P.grounded ? 'y' : 'n'}   hp ${P.hp.toFixed(0)}\npos ${P.pos.x.toFixed(1)}, ${P.pos.y.toFixed(1)}, ${P.pos.z.toFixed(1)}\nholding ${P.holds.map(h => (h.kind === 'prop' ? h.obj.kind : 'enemy') + (h.lift ? '(lift)' : '')).join(', ') || '-'}   rage ${P.rage.on ? P.rage.t.toFixed(1) + 's' : P.rage.cd > 0 ? 'cd ' + P.rage.cd.toFixed(0) + 's' : 'ready'}\npunches ${P.stats.punches} hits ${P.stats.hits} grabs ${P.stats.grabs} throws ${P.stats.throws} slams ${P.stats.slams} pounds ${P.stats.pounds} seismic ${P.stats.seismic}\nprops ${props.props.length}  impacts ${props.stats.impacts}  broken ${props.stats.broken}  walls broken ${props.stats.wallsBroken}\nGLB: ${reportF.meshes.length} meshes · ${reportF.verts} verts · skins ${reportF.skinned} · bones ${reportF.bones} · clips ${reportF.clips}\n→ GLB skeleton driven procedurally (IK for all four arms)` : X ?
`FPS ${fps.toFixed(0)}   XLR8   state ${P.state}
speed ${P.speed.toFixed(1)} m/s   grounded ${P.grounded ? 'y' : 'n'}   skid ${P.skid.toFixed(2)}
pos ${P.pos.x.toFixed(1)}, ${P.pos.y.toFixed(1)}, ${P.pos.z.toFixed(1)}
blend idle ${A.idleW.toFixed(2)} walk ${A.walkW.toFixed(2)} run ${A.runW.toFixed(2)} sprint ${A.sprintW.toFixed(2)}
world time x${T.scale.toFixed(3)}  slow ${T.phase}  left ${T.remaining.toFixed(1)}s  cd ${T.cd.toFixed(1)}s
combos ${P.stats.combos}  hits ${P.stats.hits}  finishers ${P.stats.finishers}  wall ${P.pstats.wall}  slide ${P.pstats.slide}  water ${P.pstats.water}\ncd Q${P.cd.q.toFixed(1)} E${P.cd.e.toFixed(1)} F${P.cd.f.toFixed(1)} G${P.cd.g.toFixed(1)} X${P.cd.x.toFixed(1)}
GLB: ${reportX.meshes.length} meshes · ${reportX.verts} verts · skins ${reportX.skinned} · clips ${reportX.clips}
→ procedural ${P.rig.skeleton.bones.length}-bone rig + procedural animation` :
`FPS ${fps.toFixed(0)}   state ${P.state}
speed ${P.speed.toFixed(1)} m/s   grounded ${P.grounded ? 'y' : 'n'}
pos ${P.pos.x.toFixed(1)}, ${P.pos.y.toFixed(1)}, ${P.pos.z.toFixed(1)}
blend idle ${A.idleW.toFixed(2)} walk ${A.walkW.toFixed(2)} run ${A.runW.toFixed(2)}
power ${game.power.state}   p2 ${game.p2.act ? game.p2.act.kind : '-'}   fired ${game.power.stats.fired}  hits ${game.power.stats.hits}
live projectiles ${game.power.projectiles.length}  bolts ${game.enemies.bolts.length}  blocked ${game.enemies.stats.blocked}
GLB: ${report.meshes.length} meshes · ${report.verts} verts
GLB skeleton: none → procedural ${rig.skeleton.bones.length}-bone rig
GLB clips: ${report.clips} → procedural animation`;
  $('debug').textContent += '\n' + game.omni.debugText() + '\n' + kevin.debugText() + '\n' + vilgax.debugText() + '\n' + albedo.debugText();
}

// ------------------------------------------------------------------ run
/** normal render, or - only while Tracking Sense is on / fading - the graded composite path (src/wm_senses.js) */
/** the other aliens stand on the virtual y = 0 ground: in the lagoon's shallows their model is lowered onto the visible bed for the render only (Ripjaws and XLR8 have their own wading) */
function lagoonSink() {
  const P = game.player; if (isRJ() || isX() || isWB() || !P.root.visible || P.pos.y > 0.9 || !lagoon.inRect(P.pos.x, P.pos.z)) return 0;
  return clamp(-lagoon.floorAt(P.pos.x, P.pos.z), 0, 1.15) * (1 - smoothstep(0.1, 0.9, P.pos.y));
}
function renderFrame() {
  const P = game.player, sk = lagoonSink(); if (sk > 0.001) P.root.position.y -= sk;
  if (!game.sense.render(renderer, scene, camera)) renderer.render(scene, camera);
  if (sk > 0.001) P.root.position.y += sk;
}
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const raw = (now - last) / 1000, dt = Math.min(raw, 1 / 20); last = now;
  if (menu && menu.on) { if (!menu.busy) { try { menu.frame(dt); } catch (e) { if (!window.__menuErrs) window.__menuErrs = 0; if (window.__menuErrs++ < 5) console.error('menu frame error (contained):', e); } } if (!window.__DH_NORENDER) renderFrame(); return; }     // V34: the main menu runs ONLY its own light scene update: no step(), no AI, no invasion, no combat
  if (window.__DH_MANUAL) { debugPanel(dt); if (!window.__DH_NORENDER) renderFrame(); return; }     // automated tests step the simulation themselves
  if (!paused || debugForce) { try { step(paused ? 0 : dt, paused ? 0 : Math.min(raw, 0.5)); } catch (e) { if (!window.__stepErrs) window.__stepErrs = 0; if (window.__stepErrs++ < 5) console.error('step error (contained, frame still renders):', e); } } else { camRig.update(0, game.player.pos); }   // V31: one failing system can no longer freeze the screen
  debugPanel(dt);
  renderFrame();
}
// ---- V34: cinematic startup screen / main menu / pause menu (src/menu.js). Automated tests (__DH_MANUAL) skip it unless ?menu=1. Everything it needs from this file goes through `ctl`.
let menu = null;
if (!window.__DH_MANUAL || new URLSearchParams(location.search).get('menu') === '1') {
  const startPos = game.ben.pos.clone(), startYaw = game.ben.yaw;
  const quiet = fn => { const t = hud.toast; hud.toast = () => {}; try { return fn(); } finally { hud.toast = t; } };
  const ctl = {
    camera, camRig, renderer, world, lagoon, island: game_island_ref, releaseHeldInput,
    started: () => started, playing: () => (locked || freeMode) && !paused,
    resume() { if (freeMode) { paused = false; overlay.hidden = true; } else { relockT = performance.now(); lock(); } },       // the click that pressed RESUME / PLAY / CONTINUE captures the mouse
    beginPlay() { relockT = -1e9; if (freeMode) { paused = false; overlay.hidden = true; } else lock(); },
    sfxInit() { game.sfx.init(); }, camYaw: () => camRig.yaw, setCamYaw(v) { camRig.yaw = v; },
    useBen() { if (game.chars.id !== 'ben') { game.chars.switchTo('ben'); game.chars.finishSwap(); } },
    setRenderScale(s) { renderer.setPixelRatio(Math.min(window.devicePixelRatio * s, 2)); resize(); },
    stream(n, useCam) { if (!useCam) camRig.update(0, game.player.pos, true); world.updateActive(0.1, activeCenters()); for (let i = 0; i < n; i++) { if (world.terrain) world.terrain.update(0.1, camera.position); if (game_island_ref) game_island_ref.update(0.1, camera.position); } renderFrame(); },
    snapCamera() { camRig.update(0, game.player.pos, true); },
    resetWorld() { releaseHeldInput(); quiet(resetDummies); },
    newPlayer() {       // a NEW game: Ben at the normal start, Omnitrix ready, nothing carried over
      ctl.useBen(); const B = game.ben, om = game.omni; om.hold = null; om.state = 'ready'; om.cd = 0; om.remaining = 0; om.free = false; om.renderHud && om.renderHud(true);
      B.pos.copy(startPos); B.vel && B.vel.set(0, 0, 0); B.yaw = startYaw; B.root.position.copy(startPos); B.root.rotation.y = startYaw; B.root.updateMatrixWorld(true);
      camRig.yaw = 0; camRig.pitch = 0.22; releaseHeldInput(); camRig.update(0, B.pos, true);
    },
  };
  menu = new GameMenu(game, ctl); game.menu = menu;
}
$('loading').hidden = true; $('hud').hidden = false; overlay.hidden = !!menu;
try { game.gf.prewarm(renderer, scene, camera); } catch (e) { console.warn('ghost prewarm skipped', e); }
try { game.rj.prewarm(renderer, scene, camera); const rv = lagoon.rays.map(m => m.visible), mv = lagoon.motes.points.visible; lagoon.rays.forEach(m => { m.visible = true; }); lagoon.motes.points.visible = true; renderer.render(scene, camera); lagoon.rays.forEach((m, i) => { m.visible = rv[i]; }); lagoon.motes.points.visible = mv; } catch (e) { console.warn('ripjaws prewarm skipped', e); }
try { game.sf.prewarm(renderer, scene, camera); } catch (e) { console.warn('stinkfly prewarm skipped', e); }
try { game.cb.prewarm(renderer, scene, camera); } catch (e) { console.warn('cannonbolt prewarm skipped', e); }
try { game.gm.prewarm(renderer, scene, camera); } catch (e) { console.warn('greymatter prewarm skipped', e); }
try { game.wb.prewarm(renderer, scene, camera); } catch (e) { console.warn('waybig prewarm skipped', e); }
if (menu) menu.open();
window.__DH_READY = true;
requestAnimationFrame(frame);

// ------------------------------------------------------------------ test hook (used by the automated checks; harmless in play)
window.DH = {
  al: { gltfWm: gltfW, gltfAl, gltfUw, buildAlbedoRig, AlbedoHuman },
  THREE, game, combat, world, island, rig, report, camRig, dummies, targets, fx, keys, hud,
  setForce(v) { debugForce = v; paused = !v; if (v) overlay.hidden = true; },
  press(code) { keys.add(code); if (code === 'Space') edgeJump = true; if (code === 'KeyV') edgeDash = true; },
  release(code) { keys.delete(code); },
  /** advance the simulation deterministically (seconds), rendering once at the end */
  advance(sec, dt = 1 / 60) { debugForce = true; paused = false; for (let t = 0; t < sec - 1e-9; t += dt) step(dt, dt); renderFrame(); },
  /** step without rendering; cb(t) after each step (used by the timing checks) */
  tick(sec, dt = 1 / 60, cb = null) { debugForce = true; paused = false; let t = 0; for (let i = 0; i < Math.round(sec / dt); i++) { step(dt, dt); t += dt; if (cb && cb(t) === false) break; } return t; },
  startTimeSlow, resetDummies, debugText() { dbgT = 0; debugPanel(0.2, true); return $('debug').textContent; }, reportX, rigX, reportF, rigF, props, reportH, rigH, reportU, rigU,
  render() { renderFrame(); }, menu, kevin, vilgax, albedo, bosses: game.bosses, setBossMenu, rigV, rigK, reportK, reportW, rigW, sense: game.sense, gf: game.gf, guards: game.guards, stealth: game.stealth, reportG, rigG, isGF,
  ben: game.ben, omni: game.omni, rigBen, reportBen, isBen, rj: game.rj, lagoon, divers, reportR, rigR, isRJ, renderer, sf: game.sf, slime: game.slime, reportS, rigS, isSF, cb: game.cb, reportC, reportB, rigC, isCB, cbWorld, gm: game.gm, gmt: game.gmt, rigM, isGM, gmWorld, wb: game.wb, district, wbFx, rigWb, reportWb, isWB,
};
