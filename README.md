# V30 — Ultimate World & Gameplay Expansion

New in V30 (all added to the existing game; GLB models untouched):
- **Destructible, regenerating buildings** (src/island/destruct.js): every city/suburb/industrial building takes damage from alien attacks (stages: cracks, breach, collapse -> rubble), then rebuilds after 2-4 min. `?regen=min,max` (seconds), `?nodestruct=1` disables.
- **Training robots** (src/island/trainbots.js): hostile patrol/chase/attack/block/counter robots at ~14 training posts, pool of 8, respawn 2-4 min (`?botres=min,max`). Way Big can grab & throw them.
- **Hostile underwater enemies** (src/island/seabots.js): "Reef Hunters" in deep water, max 5, respawn 2-4 min (`?seares=min,max`); Ripjaws bites/claws them. Separate from the Boss Manager.
- **Swimming** (src/island/swim.js): all aliens swim on the surface; only Ripjaws (and Vilgax/Albedo forms) dive. XLR8 runs on water above ~22 m/s. Way Big wades with splashes.
- **Climbing**: Wildmutt wall climb + wall jumps, Four Arms wall climb/jump (src/fa_wall.js), Heatblast rock-platform flight (src/hb_rock.js), Heatblast alternating punches, Cannonbolt bounce/knockback, Way Big grab & throw, Diamondhead crystal wall.
- **Dynamic day/night** (src/island/daynight.js) with automatic lighting + a clock under the minimap. `?time=HH`, `?day=minutes` set the clock.
- Roads hug the terrain (no floating/buried ribbons); traffic increased, parking reduced.

## (previous) V29 — Omnitrix FREEDOM + CYCLE, faster aliens, bigger crowds
- **Omnitrix modes** (pause card, same selector): CUSTOM · RANDOM · FREEDOM · CYCLE. Custom / Random are unchanged (2:00 / 1:00, hold C reverts).
  FREEDOM: tap C opens the selector (also while transformed), picks switch alien-to-alien directly, no timer / cooldown, health is carried over (not refilled), hold C (~1 s) = Ben.
  CYCLE: tap C = instantly the next alien (Diamondhead → XLR8 → Four Arms → Heatblast → Upgrade → Wildmutt → Ghostfreak → Ripjaws → Stinkfly → Cannonbolt → Grey Matter → Way Big → Diamondhead), from Ben the first tap is Diamondhead, hold C = Ben (cycle restarts). No Ultimate Wildmutt / Feedback.
  Tap vs hold is decided on key release (tap) or at the hold time (hold); key auto-repeat is ignored.
- **Speeds**: XLR8 run 9→16, sprint 24→44 m/s; Cannonbolt roll 13→19.5, boost 21→31.5 (max 27→40); Stinkfly flight cruise 13→19.5, boost 24→36; Heatblast cruise 15→22, boost 38→57; Ripjaws swim 6.4→10.9, fast 12→20.4, vertical 5→8.5 / 8.5→14.5. Stinkfly / Heatblast ceiling now 180 m above the ground. Collision sub-steps and camera / FX ranges retuned; walking speeds unchanged.
- **Wildmutt climbs everything** (any height, any surface, no grip loss; island buildings included — climbs are stepwise: press E again on the next wall).
- **Crowds**: up to 140 pooled pedestrians, density by region (city > beach > suburb > industrial > labs > forest > mountains / desert), groups, regional outfits, plazas / promenades / trailheads where people linger, separation, distance LOD, everybody flees Kevin / Vilgax / Albedo and explosions.
- **Debug overlay** (FPS / coordinates / states) is hidden by default (F3 shows it); diagnostic state words (IDLE…) are gone.

# Ben 10 Open World (V28) — Ben · 12 aliens · Kevin 11 · Vilgax · Albedo

**V28 replaces the old test arena with one connected cartoon island** (about 2.3 × 2.0 km). Everything from V27 (all 12 aliens incl. Ultimate Wildmutt, the Omnitrix, Kevin 11, Vilgax, Albedo, the Boss Manager, boss combat) is kept and runs on the island.
The sections further down describe the older character-test builds: wherever they mention *training dummies, targets, divers* or "J = dummies chase", that no longer applies — **the open world has no training dummies.**

## The island (regions)
| Region | Where | What is there |
|---|---|---|
| **Omnitrix Labs** | centre | walled lab compound (the old test courses: tech bay, Upgrade machines, Grey Matter micro district, Cannonbolt roll course, climb building), main lab building, dome, dish, research tower |
| **Main City** | centre-west | 4×4 blocks of towers / offices / apartments / shops, a plaza, two parks, parking lots, streets with lane lines, crosswalks, stop lines, sidewalks, traffic lights, street lights, benches, bins, hydrants, parked cars, **moving traffic and pedestrians** |
| **Suburbs** | south-west | curvy streets and cul-de-sacs, varied houses (each faces its street) with roofs, garages, driveways, mailboxes, yard trees, fences, a park with playground, gas station, local shops |
| **Forest** | west / north-west | broadleaf + pine forest, hills, a lake, a river with a waterfall, a stream, logs, bridges |
| **Mountains** | north | real elevation (peaks up to ~190 m) with snow caps, a mountain road, a mountain lake |
| **Desert** | east / south-east | mesas, canyon ground, arch, cacti, dry brush, abandoned shacks |
| **Beach / coast** | south | sand, palms, promenade shops, umbrellas + chairs, lifeguard towers, pier with a ferris wheel, lighthouse on the cape, small islands, water that gets deeper and darker away from shore |
| **Industrial port** | north-east | quay, container stacks, 3 gantry cranes, cargo ship, warehouses, factory + chimneys, tanks, pipe racks, trucks, forklifts, crates, barrels |

Roads and highways connect all regions (they follow the terrain; bridges cross the river and the bay). Sea, bay, river and forest lake are one swimmable water body (Ripjaws dives everywhere it is deep; Vilgax swims there too; everybody else can wade ~1 m deep and is pushed back to shore beyond that).

## New / changed controls
* **Tab** — full island map (again to close). The **minimap** (top right) rotates with the camera, shows roads, buildings, water, terrain, the player arrow and boss markers (K / V / A, clamped to the rim when far).
* **0** (or T for aliens without a T ability) — reset the world: props, cars, bosses, effects, traffic signals. **J** does nothing now (no dummies).
* **B / button** — Boss Manager (unchanged). Bosses start despawned; **Spawn** and **Respawn** pick a random *valid* spot (dry, flat enough, not inside a building or prop, ≥ 40 m from you, ≥ 90 m from the other bosses) in the city, suburb, port, desert, beach, forest or foothills.
* **H** — the controls list starts folded in the open world; H opens it.
* Upgrade: a **CITY TRAFFIC CONTROL** cabinet stands on a downtown sidewalk — merge (LMB), control (F), A/D select, Space run: *all signals red* (traffic stops), *all signals green* (Lv 1, enhance with E), *normal cycle*.

## What lives in the world
* **Civilians** (max 36 around you): walk the sidewalks, cross at crosswalks, flee with raised arms from explosions, fights and bosses, come back when it is calm.
* **Traffic** (max 16 cars around you in the city): right-hand lanes, turns at intersections, obey the traffic lights, brake for people / aliens / props. A car that ends up next to a fight stops and becomes a normal physical prop (Four Arms can lift it, Upgrade can take it over, blasts throw it).
* **Interactive props** (~710 placed, streamed in around you and around every boss): cars, trucks, forklifts, containers, crates, barrels, dumpsters, bins, benches, street lights, fences, rocks. Weight classes decide who can lift what (Four Arms lifts cars; containers need Rage). Broken props respawn a minute later when you come back.
* **Bosses cause chaos** when you are not fighting them: Kevin and Vilgax walk to cars / lights / benches and smash them with their own attacks, Albedo does the same with whatever alien he is; civilians run. When you come close they fight you exactly as in V27.

## Not in V28 (honest list)
* Buildings are solid colliders but **not destructible** and have **no interiors** (props, cars, walls of the Labs courses still break).
* No tunnels (the mountain road goes over the pass), no day/night cycle, no weather.
* Way Big's old destructible lattice city is retired (it overlapped the island); Way Big uses the island itself.
* Four Arms **Q (Grab & Slam)** and **F (Multi-Grab)** only grab ordinary enemies — with the dummies removed and the bosses ungrabbable they have no targets in the open world.
* Civilians and traffic are deliberately lightweight (no voices, no cars outside the city grid).

# (older) Ben 10 Character Test — Ben · Diamondhead · XLR8 · Four Arms · Heatblast · Upgrade · Wildmutt · Ghostfreak · Ripjaws · Stinkfly · Cannonbolt · Grey Matter · Way Big

Playable Three.js test with **your nine supplied models** (`assets/diamondhead.glb`, `xlr8.glb`, `fourarms.glb`, `heatblast.glb`, `upgrade.glb`, `wildmutt.glb`, `ghostfreak.glb`, `ripjaws.glb`, `stinkfly.glb` — all untouched; the Ripjaws file is byte-identical to `ripjaws_ben_10 (1).glb`).
(Older build: **C** cycled freely. Now **C is the Omnitrix** — see "Ben 10 (2005) Omnitrix update" at the end. The switch itself still runs the same path: Diamondhead → XLR8 → Four Arms → Heatblast → Upgrade → Wildmutt → Ghostfreak → Ripjaws → Stinkfly → Cannonbolt → Grey Matter → Way Big → Diamondhead in the same arena (green Omnitrix flash, no cooldown, position/facing/camera/world kept;
anything Four Arms is holding is released, a merged Upgrade is detached safely, Heatblast's flight/fire is switched off, Wildmutt's Tracking Sense is switched off with no filter or outlines left behind; Ghostfreak's phasing, invisibility, possession and tentacles are resolved first — he is never left inside a wall, and a possessed guard is released; Ripjaws' bite / claw are cancelled and he is never left in deep water — the next alien is moved to the shore, and only Ripjaws can dive).

## Run it (Mac)
Browsers block 3D models when a page is opened straight from disk, so use the launcher:
1. Double-click **`start.command`** (first time: right-click → Open → Open).
2. Your browser opens `http://localhost:8000/index.html`. Click the page to start; **Esc** pauses.

Manual alternative: open Terminal in this folder, run `python3 -m http.server 8000`, visit http://localhost:8000.
Needs WebGL2. Three.js r160 is bundled in `vendor/` (no internet needed). `start.command` picks the first free port from 8000 upwards.

## Controls
**Shared:** WASD move · Mouse camera (wheel = zoom) · Shift sprint/run · Space jump · **C Omnitrix** (Ben: tap = dial / random; alien: HOLD C 1 s = revert early) · 0 reset dummies + guards · J dummies chase you · Y turrets + guards on/off · M sound · H hide controls · F3 debug · Esc pause.
The on-screen controls and ability bar change automatically with the active alien.

**XLR8:**
| Key | Ability |
|---|---|
| WASD | accelerate: walk → run (9 m/s) |
| Shift (hold) | super sprint (ramps up to 24 m/s) |
| Space | jump; at speed it becomes a long jump |
| Left Click | **Speed Combo** — dash in, 5 rapid claw strikes, knockback finisher |
| T | **Time Slow** — 10 s real time, then a 20 s cooldown |
| Q | **Speed Dash** — 0.34 s steerable burst at 46 m/s, 14 dmg to whatever it passes through, 2 s cooldown |
| E | **Spin Attack** — whirlwind with 3 shock pulses (radius 3.8 m, 10 dmg each + knockback/launch), 3 s cooldown |
| F | **Speed Clones** — confuses nearby dummies (they stop chasing), XLR8 blurs around the nearest dummy leaving blue afterimages, 4 strikes (9 dmg each), 6 s cooldown |
| G | **Speed Throw** — dashes to the dummy in front, grabs it, carries it at up to 34 m/s and hurls it (18 dmg + big knockback; extra 12 dmg if it slams into a wall), 4 s cooldown |
| X | **Hyper Drive** (ultimate) — charge, then a 62 m/s rush through up to 6 dummies (4 hits each) ending in a 7.5 m blast (32 dmg, launch), 12 s cooldown |
| Z | **Slide** while running (≥ 8 m/s); Space cancels. Keeps you low under low ceilings |
| Wall run | Jump toward a tall wall while holding Shift + steering into it (≥ 12 m/s): runs along it up to 1.7 s; Space kicks off |
| Water run | Sprint (≥ 15.5 m/s) across the blue pool (south-west) to run on the surface (~3 s budget); slower = wade at half speed, sinking in |


**Four Arms** (all four arms animate through the model's real arm/hand bones; heavy: walk 4.4 m/s, run 8.8 m/s, high jump with crouch, heavy landing = camera shake + dust + nearby props jolt):
| Key | Ability |
|---|---|
| Left Click | **Heavy Punch Combo** — 4 clicks (alternating upper/lower fists, 4th = overhead smash with shockwave). Clicking with all arms full throws the first held thing |
| Right Click / B (hold) | **Block** — crossed arms, big damage reduction |
| V | **Grab / carry** the highlighted target (cars, dumpsters, bins, benches, signs, streetlights, barriers, crates, rocks, debris, furniture, enemies). Upper pair = small/medium, all four arms = heavy/vehicles. V again with nothing in reach = drop |
| G | **Environmental Attack** — lift the nearest big object; G again = aimed throw (arc preview + landing ring) |
| Q | **Grab & Slam** — grab an enemy, overhead slam, shock |
| E | **Double-Fist Ground Pound** — jump-free shockwave, radius 11 m, damages/launches enemies, jolts props |
| F | **Multi-Grab** — two enemies at once (one per arm pair), slam together / spin / throw apart |
| T | **Rage Mode** — 10 s, then 20 s cooldown after it ends: red aura, ×1.8 damage, ×1.6 knockback, faster attacks, lifting capacity 1700 → 5200 (lets you lift the boulder), half damage taken |
| R | **Seismic Slam** (ultimate, 16 s cooldown) — leap, slam, 24 m radius, 62 dmg, cracks/breaks designated walls |
| Z | **Heavy Shove** |
| X | Drop everything held |
| Walk/run into things | Pushes loose props (cars slowly); running into a *breakable wall* (the brick buildings) charges through it |
| Space at a ledge | Vault (waist-high) / climb / ledge grab |

**Diamondhead:** unchanged (LMB projectiles, Q weapons, F shield, G spikes, 1-4 + E constructs, X cannon, T reset dummies) except that
his crystal **dash moved from C to V** because C is now the switch key.


**Heatblast** (flame head/hands, fire light that follows him; ground run 9.8 m/s):
| Key | Ability |
|---|---|
| WASD / Shift / Space | move / sprint / jump (+ one double-jump thruster puff) |
| X | **Flight on/off** — take-off, hover, 6-way flight; **Space** ascend, **Ctrl** descend, **Shift** boost (38 m/s); building/roof collision, camera follows and pulls back with speed; X again = soft landing. Every attack works while flying |
| Left Click (hold) | **Fire Blast** — fast hand jets aimed by the crosshair (15 dmg, ignites what they hit) |
| Q | **Fireball** — gather, ballistic throw, explodes (radius 5.8 m, 40+ dmg, ground fire) |
| E | **Flame Punch** — 3-hit combo, the fist really has to connect (aim assist), last hit launches |
| F | **Fire Wave** — crouch, ground-hugging wave in a 130° arc up to 13 m that leaves burning patches |
| G | **Fire Protection** — 10 s fire aura, burns anything touching him, halves incoming bolt damage (it does **not** reflect lasers) |
| R | **Large Fire Burst** — 1.2 s charge, radius-12 m explosion (85 dmg) + ring of fires |
Fire **ignites** crates, fences, bushes, trees and fuel barrels (they burn, darken, and can collapse); **cars/trucks** smoke, ignite and explode (the blast hurts everything near). Fires have lifetimes and hard caps (16 ground fires, 22 burning props, 5 pooled fire lights).

**Upgrade** (Galvanic Mechamorph — black/white body, green circuitry, single eye; slow, flexible, stretchy movement 3.4 / 7.2 m/s; no flight, no teleport, no phasing):
| Key | Ability |
|---|---|
| WASD / Shift / Space | move / sprint / jump — **while controlling a machine the same keys drive it** (Shift boost, Space brake/jump) |
| Left Click | **Merge** with the technology in front of you (marker ring + hint). While merged it is the machine's main action (fire cannon / turret, run console function, toggle door) |
| Q | **Eye Laser** — 0.42 s charge at the eye, 0.42 s beam from the eye to the crosshair, 30 energy, 3.2 s cooldown; damages dummies, props, walls |
| E | **Enhance** the merged machine (25 energy, 3 levels). Only improves what it can already do — car: faster/handling/tougher + glowing tech; robot: stronger, faster fire, lvl 2 shoulder cannons; turret: faster fire/damage; console: unlocks more of its own functions; door: faster motor, stays open |
| F | **Control Machine** (take / release control; vehicles/robots/turrets start under control when merged) |
| G | **Liquid Body** — flatten to a 0.6 m puddle (energy drain): fits a 0.8 m slot and a 0.75 m crawl-gap, flows around things; no jumping; he reforms only where the full body fits (otherwise he flows ≤1 m to the nearest free spot) |
| T | **Detach** — circuitry retracts, body flows out and reforms at a safe spot outside the machine (never inside solid geometry); the machine stays |
Machines (all registered with a reusable technology record `{isTechnology, technologyType, canMerge, canControl, canEnhance, isMerged, upgradeLevel}`): 2 coupes + a box truck + a prototype coupe (drive with real collisions, they shove light props aside and run into dummies), 2 security robots (walk, jump, fire arm cannons), the 2 training turrets (aim with the camera, fire; linked turrets fight for you), 2 consoles (control console: TURRET LINK / TURRET OVERDRIVE (lvl 1) / FLOODLIGHTS; maintenance terminal in a pocket reachable only in liquid form: BAY DOOR / BAY LIGHTS / DIAGNOSTICS (lvl 1)) and an electronic door that locks the tech bay (north-west corner).
Liquid course (north-west): a 0.75 m crawl beam, then a wall with a 0.8 m slot, then the sealed pocket with the terminal.


**Wildmutt** (quadruped, low posture, fast but clearly slower than XLR8: walk 4.2 m/s, run 15 m/s; no speed trails — dust, paw-falls and a little camera pull instead). Your GLB is used exactly as supplied (84-bone skeleton, no clips):
| Key | Ability |
|---|---|
| WASD | walk → trot → gallop on all four legs (planted feet, gait blends by speed) |
| Shift | sprint (15 m/s, FOV/camera pull, dust) |
| Space | **high jump** — crouch, launch (about 4.3 m apex) that clears the cars and reaches reachable ledges; no double jump, no flight; landing absorbs with dust |
| Left Click | **Bite** — lunge + jaw snap; the damage is a real jaw-point contact test (30 dmg, knockback). Bites through wooden crates, fences, benches and bushes; metal props take little; concrete, stone, rocks, lamp posts and the brick buildings are immune ("TOO HARD TO BITE THROUGH") |
| F | **Claw swipe** — rapid left/right forepaw swipes (17 dmg each, alternating limb, 0.08 s between swipes), claw sphere contact test |
| R | **Pounce** — a ballistic leap along your aim (1.5–15 m, plain physics, no homing/teleport) that hits whatever is in front of the body on arrival (40 dmg, launch); 3.4 s cooldown |
| Q | **Tracking Sense** (toggle) — see below |
| E | **Climb / interact** — grab a suitable wall in front of you (see limits below); on a wall: W/S climb, A/D shimmy, Space push off, E let go. Reaching the top mantles over the edge |
| C | switch alien · Esc pause |

*Tracking Sense (Q).* Ordinary post-processing, nothing is cheated about the world: the scene is rendered into an off-screen target, and a second, half-resolution "enemy mask" pass renders **only enemies** (render-layer bit, `overrideMaterial` shader that writes silhouette + view-space depth). A full-screen composite then (1) grades the scene to yellow/amber with reduced saturation, a slight depth-weighted blur, a soft warp and vignette, and an expanding pulse ring when it is switched on, and (2) draws each enemy as a glowing outline + faint fill from the mask. Comparing the mask depth with the scene depth decides the colour: **orange** when the enemy is actually visible, **red** (thinner, hatched fill) when it is behind a wall or prop — so enemies behind brick are detected but never fully visible. Enemies come from a 10 Hz scan of the real enemy list (real positions, moving enemies are followed every frame) limited to **46 m** with a hysteresis band (+4 m) and a distance fade from ~25 m, so far enemies lose their outline instead of being highlighted for ever. Fading amber scent marks are left on the ground while it is on (128 instanced rings max, ~5 s life). The camera is never locked. Q again, or C, turns it all off: the filter, outlines, trails and layer bits are removed instantly (checked: `k=0`, no trails, no filter, layers back to default). HUD: `TRACKING SENSE: ACTIVE / OFF`.

*Climbing.* Kinematic hang 0.6 m off a vertical wall face: grab → climb → mantle (or drop/slip). Allowed only on suitable surfaces: the wall must be an axis-aligned box face, wide enough (poles and trees are "TOO NARROW"), have a grip rating (rough brick/stone/barriers up to ~5.8 m, wood crates/benches/fences ~6 m, smooth painted/sheet-metal things such as cars, dumpsters and the lab walls ~3.5 m, nothing on light poles, trees or bushes), have head-room and room on top. Messages: NOTHING TO CLIMB · TOO NARROW · NO GRIP HERE · TOO HIGH · TOO SMOOTH · NO WAY UP · NO ROOM · GRIP LOST. Walls can be chained (a lower annex to the taller tower in the south). This is limb-by-limb climbing, not a crawl-anywhere ability.

### Wildmutt — what is implemented
- **Model/rig** — `assets/wildmutt.glb` untouched. `animations/quadrig.js` finds the real bones and `QuadPoser` poses them: FK on the spine/neck/head/jaw/tail/ears, two-bone IK for all four limbs with paw orientation, digit curl and a ground-plant re-solve; the body is tilted about its centre for slopes, braking and lunges. `src/wildmutt.js` = controller (locomotion, high jump, landing, gait with planted feet, pose layers); `src/wm_powers.js` = bite / claw / pounce / tearing / Q toggle; `src/wm_climb.js` = climbing; `src/wm_senses.js` = Tracking Sense.
- **Animations created (all procedural, because the GLB has no clips)** — idle (breathing, weight shift, head/ear/tail), walk, trot, rotary gallop, sprint, turn lean, jump prep, jump rise, fall, landing absorb, bite (wind-up → snap → recover), claw swipe (left/right), pounce (crouch → launch → stretch → land), sniff / head-raise when Tracking Sense toggles, climb (diagonal paw gait planted on the wall), mantle, drop. **Reused:** nothing — there were no clips in the GLB to reuse; locomotion maths is shared with the other characters only in spirit (their own FK/IK code).
- **Performance** — the sense pipeline only exists while it is on (zero extra cost when off); enemy scanning is 10 Hz over the small enemy list, no per-frame world scans; trails are one `InstancedMesh`; effects are cleaned up on toggle/switch.

### Wildmutt — tested (scripted headless Chromium, state read back + screenshots)
Loading and model check, facing direction, gait frames (walk/trot/gallop show four-legged motion), speeds (Wildmutt walk 4.2 / sprint 15 vs XLR8 walk 9 / sprint ≈19–24 in 2 s), jump (apex ≈4.3 m, clears the car), landing, bite (30 dmg, nothing hurt at 6.5 m), claw (17 dmg, FL/FR alternation), pounce (40 dmg, travelled 9.6 m with no target — no homing), crate / fence / bush destruction, concrete barrier immune, climbing (ground → 2.7 m annex → mantle; annex → 5.4 m tower; light poles refused), Tracking Sense (amber grade fade 0.42 s on / 0.34 s off, red outline behind the brick wall, orange when visible, follows chasing dummies, works while sprinting / jumping / biting, only 1 of 9 enemies tracked from a far corner, nothing left after switching away), full C cycle through all six aliens with real key events, every earlier alien's abilities re-run (counters rise, no console errors), a 150 s random-input soak (never below the ground, never inside geometry, camera 1.44–9.98 m, no NaN, no errors), simulation cost per step (~0.66 ms Wildmutt vs 0.39–0.58 ms the others).

### Wildmutt — not done / limits
- Verified only in software-rendered headless Chromium: no real-GPU frame rates (SwiftShader render: 3.8 ms/frame with the sense off, 8.4 ms with it on at the test size), and feel/tuning (speeds, cooldowns, damage, grip numbers, camera) is a first pass.
- While Tracking Sense is on the scene is rendered without MSAA (needed for the depth read-back in three r160); a cheap FXAA-style pass replaces it. The whole screen, including Wildmutt, is graded amber — that is the effect.
- Climbing only works on axis-aligned box faces: no curved, sloped or round surfaces, no poles/trees/bushes. Grab/release use short kinematic stages, and a mantle can graze the ledge corner.
- The gait is procedural IK on a rigid-skinned model: elbows/shoulders and the long forelimbs can look soft or stretched in extreme poses. No hit-reaction animation for Wildmutt (HUD/camera feedback only).
- Enemies are still only the training dummies and turrets; scent trails are a visual only. The Omnitrix watch is part of your model. All audio is synthesized (no audio assets).
- The reference image shows "Super Speed" and only Q/E/Shift/Space/LMB; I followed the text spec instead (no XLR8-level speed; F claw and R pounce added).
- Time Slow, Upgrade merging etc. were not specifically tested with Wildmutt beyond the shared code paths.

**Ghostfreak** (floating biped with a tail instead of legs — no walking, no footsteps; hover 0.5 m above whatever is below him; glide 7 m/s near the ground, up to 17.5 m/s when flying high; no flame, rocket or wings). Your GLB is used exactly as supplied (45-bone skeleton, no clips):
| Key | Ability |
|---|---|
| WASD | float / fly relative to the camera (smooth acceleration, he leans into the motion, tail trails) |
| Space / Ctrl | **ascend / descend** (8.5 m/s, up to 46 m; Ctrl all the way down = low hover; flight is limited to the arena) |
| Shift (hold) | **Invisibility** — fades to a faint rim silhouette (only you can see it). Guards and turrets genuinely lose him (see below). Releasing it fades him back in |
| F | **Intangibility** on/off — nothing solid exists for him: walls, brick-building walls, low walls, crates, pillars, roofs, cars. The arena boundary and the ground still hold. Turning it off inside geometry slides him to the nearest open space first |
| Q | **Possess** the nearest living **Guard** in front of the camera (≤ 10 m). Q again = exit. Dummies, turrets and machines are refused with a message |
| Left Click | **Claw** — one arm swipes (alternating left / right); real hand-sphere contact test, 22 dmg + knockback; ~0.5 s cooldown. Blocked while intangible |
| E | **Tentacle attack** — raises both arms, they stretch toward the target (≤ 7 m, shortened by walls), strike / grab a dummy or guard, pull it in, hold ~1.3 s; **E again = throw**, otherwise a gentle release. Turrets are only struck. 3 s cooldown. Blocked while intangible |
| C | switch alien · **R** is unused · **Esc** pause |
HUD: `INVISIBILITY: ON / OFF`, `INTANGIBILITY: ON / OFF`, `POSSESSION: ACTIVE — <guard name> / INACTIVE`, plus a stealth line (`NOT DETECTED`, `SPOTTED · n GUARD ALERT`, `UNSEEN · n GUARD SEARCHING` …) and the ability bar.

### Ghostfreak — what is implemented
- **Model/rig** — `assets/ghostfreak.glb` untouched (author Fire Max, CC-BY-4.0). `animations/ghostrig.js` finds the real bones (`bip_*`, 8 tail bones as the lower body), wraps the scene so he faces +Z at a game scale of ≈2.3 m, re-parents the loose Omnitrix meshes to the chest bone and adds `GhostPoser`: FK on hips/spine/chest/neck/head/tail, two-bone IK with optional *stretch* for the arms. Geometry, UVs, textures and materials are unchanged; only a tiny shader patch (uniform-driven fade/shimmer) is added to the materials, and it is switched off — the original opaque rendering — whenever no effect is running.
- **Animations created (all procedural: the GLB has no clips)** — floating idle (sway, breathing, tail wave, slow arm drift), slow float, fast flight (forward lean, roll into turns, arms trail back), ascend (arms sweep down, body tips up), descend, invisibility on / off (arms gather, body fades), intangibility on / off (shimmer + arms spread), possession reach and entry (he glides to the host and pours into it), possession exit (reforms beside the host), claw swipe (wind-up → swipe → recover on alternating arms), tentacle raise / extend / grab-and-hold / throw / retract (the model's own arms, stretched up to 1.32× by IK — never separate objects, never from the ground).
- **Flight & movement** (`src/ghostfreak.js`) — camera-relative glide with separate accelerate / brake rates, a spring that holds a 0.5 m hover over ground / crate tops / roofs, Space / Ctrl for vertical speed, speed that rises with altitude. The existing camera rig is reused (extra FOV and distance when fast, higher camera while ascending).
- **Invisibility → AI** (`src/stealth.js`) — the single place that decides whether the player can be noticed. While Shift is held and the body has faded (≈0.4 s), `Stealth.hidden` is true: **Guards** (`src/guards.js`) only notice him from ≈1.7 m (practically touching), lose track, walk to the **last place they saw him** (not his live position), look around ("?"), then walk back to their post; **turrets** stop firing, keep aiming at the last-seen point and start sweeping after ~2.5 s. Chasing dummies (J) head for the last-seen point too. This is not invincibility: attacking (claw, tentacle) or being hit reveals him for ~1 s, and stepping next to a guard gets you noticed.
- **Intangibility** — a second collision state in his controller. Tangible: swept per-axis AABB + cylinder collision like the other aliens. Intangible: the move step skips all boxes and cylinders; only the arena bounds (±35.4 m), the ground (y ≥ 0.02) and the 46 m ceiling remain, so he can't fall out of the map. Turning it off inside geometry finds the nearest free spot (ring search, also above / below boxes) and slides him there over ~0.3 s before collision turns back on. The camera stops colliding while he is buried; inside geometry he is drawn as an x-ray silhouette so you can still see him. Attacks, possession and (for safety) switching resolve these states first.
- **Possession** (`src/gf_powers.js`, `src/guards.js`) — only the new living **Guards** (sentry with a stun baton and a blaster) qualify. Q: the host freezes, Ghostfreak glides in (0.5–0.95 s, eased), shrinks and pours into it with violet particles; his own body is hidden (no duplicate) and `game.player` stays the ghost controller, so the camera, HUD and input plumbing are unchanged: his position follows the host, WASD / Shift drive the host (walk 3, run 5.8 m/s), **LMB = baton, E = blaster** (buffered for 0.4 s), nothing else — no claw, tentacle, phasing or invisibility while possessed (F shows a hint). The host's AI is off while possessed; other guards treat a possessed guard that has attacked as hostile and attack it, while turrets ignore it. Q again (or the host being killed, a reset, or switching alien) reforms Ghostfreak at a valid free spot beside the host (never inside a wall, never underground), the host staggers for ~0.8 s and then resumes normal AI. Repeatable on any guard; cancelling during the approach works too.
- **Claw / tentacle** — see the table; both are real contact tests against the same `world.hittables` list every alien uses (dummies and guards get damage, knockback, launch and tilt; turrets are struck). A grabbed enemy is carried to ~2.3 m in front of him and its collider is disabled while held, then restored on release/throw.
- **Environment** — the existing map geometry is used as is: the cover walls, low walls, brick building (open-top walls with a doorway), pavilion roof, crates, climb-test towers and props can all be phased through; empty shells are safe to enter; nothing is generated.

### Guards (new enemy, needed for stealth and possession)
The training dummies have no senses and the turrets are machines, so Ghostfreak's stealth and possession had nothing to act on. Three **Guards** stand posts at (22,−8), (−28,−9) and (−24,12). They extend `Dummy`, so **every earlier alien can hit, shove, launch, grab and throw them exactly like a dummy** (130 hp; they respawn after 7 s; T / 0 resets them). When turrets are on (Y), guards are hostile to *any* alien: they spot you inside 20 m and a ±80° view cone (28 m once alerted), chase, shoot the same slow orange bolts the turrets use and swing the baton up close (16 dmg, with knockback). Each alien reacts the way it already does to turret hits (flash/shake/its own damage handling); Ghostfreak has 300 hp and gets a "second wind" at 0 instead of dying — the game has no death/respawn system. Press **Y** to turn guards and turrets off if you only want to test powers.

### Ghostfreak — tested (scripted headless Chromium, state read back + screenshots)
Checklist items 1–25 and 32–33 were run as scripted scenarios against the real game; every one passed on the final code:
- *Model:* the file in `assets/` is byte-identical to the upload; floating idle bob 0.12 m, no foot contact; 7.0 m/s float, 17.5 m/s flight, ascend 11.6 m in 1.5 s, descend back to the ground without going under it.
- *Invisibility:* a guard 11 m in front noticed a visible Ghostfreak, ignored him for 6 s while invisible; walked to the last-seen point (clamped to the arena), searched ~4 s, returned and went idle; guards notice him at ≈1.2 m; a claw swing reveals him for 0.8 s; turrets fired 6 bolts while he was visible and 0 while invisible (they sweep instead).
- *Intangibility:* tangible stops at the cover wall (z −5.05), intangible passes through it (z −18.3); under the pavilion roof tangible stops at y 2.9, intangible rises to 17; floor and ±35.4 / 46 m bounds hold; turning it off inside the wall / roof slab ends in open space (not solid); camera stays usable; combined sequence (invisible → phase through the brick building's wall → tangible inside → possess a guard without it noticing → exit → phase out through the east wall) works.
- *Possession:* Guard A/B/C each possessed, repeated 3× on the same guard; control, baton damage to a dummy (16 × 1.1), blaster bolt, 0 claws/tentacles while possessed; exit, host killed while possessed ("HOST DOWN"), reset (0) while possessed, switch (C) while possessed, cancel during approach; refusals for a dummy, turret, truck and "nothing in range"; no duplicate ghost or guard in the scene; AI resumes (stun → search/chase → return); turrets fired 0 bolts at a possessed guard standing next to a live turret for 8 s.
- *Combat:* claw 22 dmg + 3.2 m knockback, alternating arms, cooldown, hits guards too, blocked while intangible; tentacle raise → extend (≤ 7 m, stops at walls: tip stayed 0.3 m short of a wall) → grab → pull → hold → throw (5.4 m) / auto-release, retract; grab uses the dummy's real `held` flag and restores its collider; blocked while intangible.
- *Camera:* largest per-frame camera step 0.32 m during climb/flight, 0.12 m during approach + possession + walking, 0.34 m on exit; camera 7 m from the host.
- *Switching in special states:* inside a wall, inside the pavilion roof slab, while possessing, holding a dummy with a tentacle, and invisible — the next alien always appears in open space with no leftover effects; the full ring of seven switches via the real **C** key; Ghostfreak HUD hidden for other aliens.
- *Regression of the six earlier aliens:* each one's movement + signature powers re-run with the guards present (Diamondhead projectiles, XLR8 combo/dash/spin/time slow, Four Arms punches/pound, Heatblast blast/fireball/punch/wave, Upgrade laser/liquid, Wildmutt bite/claw/pounce/jump/sense) — all still register hits and damage; no console errors.
- *Soak / performance:* 4 minutes of random inputs (movement, flight, F, Shift, Q, E, LMB, C through all seven aliens, random teleports) with enemies on: 0 NaN, 0 samples stuck inside solid geometry while tangible, 0 out-of-arena positions, 0 duplicates, 0 console errors, scene object count steady, GPU geometry/texture counts plateau after the first lap of all aliens (no leak). Simulation costs 0.2–0.7 ms per step in every ability state. The ghost's shader variants are pre-compiled at load so the first Shift / F doesn't hitch (a ~700 ms first-use stall in software GL before the fix, ~6 ms after).

### Ghostfreak — not done / limits (honest list)
- Verified only in software-rendered headless Chromium by scripts and screenshots; nobody played it on a real GPU, so feel and tuning (speeds, cooldowns, damage, camera distances, how faint the invisible rim is) are a first pass.
- **Only the new Guards can be possessed.** Dummies (no mind), turrets, cars and every machine are refused (and machines are Upgrade's, not Ghostfreak's). Training dummies and turrets also have no senses to blind beyond what is described above.
- Possession gives the host nothing new: baton and blaster only. The host is a simple built-in humanoid made of primitives (not a Ben 10 model).
- The tentacles are the model's own arms stretched by two-bone IK (up to 1.32×) — there are no extra limbs and no separate tentacle meshes, so they look like long stretchy arms rather than tentacles. They only grab dummies and guards, only strike turrets, and are limited to 7 m.
- Exiting possession shows him again (invisibility off); the exit stagger is short, so a guard next to the exit point notices him almost immediately unless you hold Shift again.
- Phasing uses the game's box / cylinder collision data. Inside the existing brick building and pavilion that is exactly right; there are no real city interiors in this map, so none were created. While intangible, the shadow and x-ray look are approximate when he is partly inside a wall.
- Attacks are disabled while intangible (a deliberate rule so there's no free damage through walls); possession cannot start while intangible (it turns phasing off first).
- Guards are now hostile to every alien when enemies are on, which wasn't true of the earlier game; turn them off with Y. A possessed guard is attacked by other guards but not by turrets.
- No hit-reaction animation exists for Ghostfreak (screen / camera feedback only); the GLB has no clips, so all animation is procedural; fast flight can show soft skin bending at the shoulders. All audio is synthesized.

**Ripjaws** (amphibious — on land a slow, heavy-footed biped; in the lagoon a fast, agile swimmer who never needs air):
| Key | Ability |
|---|---|
| WASD | land: walk 3.0 / run 6.8 m/s · water: **swim along where the camera looks** (forward / back / strafe, up and down included); smooth turning, body pitches to the heading |
| Shift (hold) | land: run · water: **fast swim** (6.4 → 12 m/s, streamlined pose, bubble stream — no glow, no energy) |
| Space | land: jump (crouch → launch → land) · water: swim up (5 m/s, 8.5 m/s with Shift) · **tap near the surface = breach** (leaps out: his body centre rises ~1.3 m above the surface, ~0.6 s of air time under normal gravity, then he falls back in with a splash — no sustained flight) |
| Ctrl | dive down |
| Left Click | **Bite** — turns to the target, jaws open, lunge, snap shut, return to stance. The hit comes from the mouth / jaw-tip spheres (no damage from metres away); works on land and in water; hold to repeat |
| E | **Claw swipe** — short range, alternating arms, tap again to chain; works in the swimming posture underwater |
| C | switch alien (order: … Ghostfreak → Ripjaws → Diamondhead) · **Esc** pause |
HUD: title `RIPJAWS`, health bar, environment pill `LAND` / `SHALLOW WATER · 0.5 m` / `UNDERWATER · 1.7 m` (depth), ability bar. **No oxygen bar and no drowning.**

### Ripjaws — what is implemented
- **Your GLB, unchanged** (`assets/ripjaws.glb`, CC-BY, see credits): 5 meshes, 17,299 vertices, 2 textures, **no skeleton, no skin, no animation clips, no morph targets, no alternate tail/swim form** (checked). `animations/ripjawsrig.js` builds a 30-bone runtime skeleton (spine/neck/head, a separate jaw, shoulders-arms-hands with finger curl, legs, and a 3-bone chain for the black loincloth "tail") and skins the original vertices to it; `src/rj_pose.js` animates it procedurally. Geometry, UVs, textures and materials are never touched; the model is scaled (0.32) to the game's scale and aligned to the ground.
- **The jaw** is split off the head mesh by a plane through the mouth so the lower jaw really opens (idle jaw movement, bite, breach roar). **Claws** are rigid (they follow the hand bone); fingers curl as one piece per hand.
- **Animations (all procedural, all exercised in the game):** land idle (breathing, head look, weight shift, arm sway, occasional jaw open/close) · walk · run · turn · jump (crouch / rise / fall) · landing · water entry (plunge pose + splash) · underwater idle (hover tread) · normal swim (crawl-stroke arms + flutter kick + body undulation) · fast swim · swim turns (bank) · diving (head-down) · ascending (head-up) · surfacing (upright, head and shoulders above the surface) · breach (arms wide, jaws open) · re-entry · water exit (walks out; shakes off and drips on the beach) · bite (land + underwater) · claw swipe (land + underwater).
- **Water** (`src/water.js`): the arena's decorative pool is now a real basin — a 16 × 15 m lagoon carved into the training ground with a walkable beach ramp (0 → 3+ m deep), a sandy bed with dunes, rock pillars, a swim-through arch, a reef wall, a climbable rock island and sunken crates, fences, barrels, a trash can, a terminal and a car shell. Walls, rocks and props are real collision boxes; every obstacle in the shallows is lower than the step height, so a walker cannot get wedged. The lagoon walls are flush with the pavement, so you can also simply walk or leap out over the sides. Surface is a translucent animated shader with ripples and foam; everything below gets caustics and a depth tint. The map itself is unchanged.
- **Land ↔ water:** wading in the shallows is walking (legs dip under the surface, ripples). Where the water is deeper than ~1.35 m he starts swimming (smooth pose blend, splash, no teleport); walking back, he stands up at ~1.0 m. Leaping out and re-entering uses the same transition. Switching to Ripjaws over water enters swim mode immediately; switching away while swimming moves the next alien to the shore line (nobody else can dive).
- **Underwater look:** blue-green tint and distance fog while the camera is submerged (light enough to navigate), drifting marine snow, light rays, bubbles from the mouth / fast swimming, silt puffs at the bed. No full-screen post-processing pass — one CSS vignette plus scene fog.
- **Camera:** full vertical look while swimming (pitch −1.2 … +1.35), stable distance, lagoon bed is the camera floor, a shoulder-offset ray and an eased pull-in keep it out of rocks; it is pushed out of any solid it ends up in. Verified in a random-input soak (see below).
- **Combat:** bite 34 dmg (×1.1 swimming), claw 16 dmg, with real contact tests from the mouth / jaw / hand spheres. Targets: training dummies, and four new **Divers** (`src/diver.js`) that drift in the lagoon, react with water resistance (small push, short stagger, no explosions) and respawn. Props that break: wooden crates, fences, benches, bushes, small metal (trash can, barrels) and plastic (terminal) — each has a material factor, bigger ones take several bites. Cars, trucks, dumpsters, robots, rocks, trees, lamp posts and every wall give a clink and "TOO HARD TO BITE THROUGH". The lunge steers to the nearest biteable thing; low things (a trash can) are reached by a deeper lean.
- **Other aliens in the water:** they wade to ~1 m, then are stopped with "TOO DEEP — ONLY RIPJAWS CAN DIVE". Flyers/hoverers pass over it; XLR8's water-run still crosses the whole lagoon.

### Ripjaws — tested (scripted headless Chromium, state read back + screenshots)
GLB load and mesh/texture/vertex counts · land walk/run/jump/land · walk into the water, swim, fast swim, ascend, dive, surface, breach, re-entry, exit onto the beach · bite and claw on land and underwater (a bite from 6 m away does nothing; dummies and divers lose health and react) · chase and kill moving divers (first hit 0.2–1.4 s) · every biteable / immune prop type on land and underwater · switch away while swimming, switch in over deep water from each of the 7 other aliens · XLR8 water-run across the lagoon · each of the 7 original aliens against the previously delivered build with the same scripted inputs (same positions / damage / states) · random-input soak (3 × 150 s: no NaN, no falling through the map, no camera inside a solid or below the bed) · contact sheets of all the animations from in-game cameras · step cost ~1 ms per simulated frame, ~300 draw calls.

### Ripjaws — not done / limits (honest list)
- **No aquatic form.** The GLB has no tail mesh, morph targets or alternate swim form, so swimming is the same biped model posed prone with a crawl stroke, flutter kick and body undulation; the loincloth chain trails behind him. It reads as a swimmer, but it is not a fish-tail swim cycle.
- Everything is procedural animation on a rigid skinned mesh: fingers curl as one bone, claws are rigid, and skin blending can look soft at extreme bends (shoulders, hips). The jaw is cut from the head mesh by a plane, so the mouth interior is whatever the original mesh has.
- **There is no oxygen system in this game.** Ripjaws simply never loses air; the other aliens are not "drowning" — they are physically prevented from entering deep water (and flyers just pass above it).
- One contained lagoon with a single flat water level — no currents, no rivers, no waves that move bodies, and the water surface is not part of the city. Surfacing is a short jump under normal gravity, not flight.
- Verified only in software-rendered headless Chromium (no real-GPU frame rate; feel and tuning — speeds, camera distance, damage — are a first pass; nobody played it with a real mouse). Camera collision in the tight lagoon (pillars, arch) can still pull in quickly when you orbit right next to a rock.
- Divers are simple built-in figures (not a Ben 10 design) and never attack.
- No hit-reaction animation for Ripjaws himself. All audio is synthesized (bite / splash / bubbles are simple tones and noise).

### Stinkfly — controls
| Key | Action |
|---|---|
| W A S D | walk / run on the ground · fly when airborne |
| Mouse | free camera rotation · aim |
| Shift | run · fly faster |
| Space | take off (short crouch + wing wind-up) · ascend |
| Ctrl | descend (on the ground: nothing) |
| Left click | shoot sticky slime from the eyestalks |
| Q | claw attack (alternating left/right, works in the air) |
| E | tail strike (physical, small knockback) |
| C | switch alien · **Esc** pause |
HUD: title `STINKFLY`, health bar, `FLIGHT: ACTIVE / INACTIVE`, floating `SLOWED` / `RESTRICTED` / `TRAPPED` tags on slimed targets.

### Stinkfly — what is implemented
- **Your GLB, unchanged** (`assets/stinkfly.glb`): skinned mesh, 67 bones, **0 animation clips**. `animations/stinkflyrig.js` drives that skeleton procedurally (FK for body/neck/tail/wings, FABRIK IK with pole targets for the legs, claws and eyestalks). No wings or parts were replaced or redesigned.
- **Ground:** idle (eyestalks, head, claws, tail, occasional wing twitch), walk, run with world-planted feet (trot gait, stance foot moves at body speed, no sliding); run speed 8.6 m/s, below XLR8.
- **Flight:** Space → crouch + wing wind-up → takeoff → flight. Space ascends, Ctrl descends, WASD flies relative to the camera, Shift boosts (13 → 24 m/s cruise → boost, 7.5/11 m/s climb). Acceleration/braking give momentum; the body banks into turns and leans forward at speed; the hover has a gentle bob. The wings are the real wing bones flapping (rate and amplitude change per state) with a faint swept-arc blur mesh. No jets/trails; only small wing-gust dust near the ground and a subtle speed-streak at boost. Max altitude 42 m, arena-bounds clamped, can't pass through roofs or walls (swept collision), lands on streets, rooftops and platforms with a landing animation. Holding Ctrl or descending to the ground lands; there is no glide.
- **Switching:** away from Stinkfly mid-air the flight controller is released and the next alien's physics is restored (no teleport, no stuck flight mode); slime on the world, the camera, enemies and props stay.
- **Slime (LMB):** one pooled blob per shot, alternating between the four eyestalk tips, fired from the actual eyestalk to the crosshair aim point (gravity-compensated; 36 m/s, short arc, 1.9 s life, max 26 blobs). It collides with enemies, buildings/walls, the ground, props and vehicles and water; each hit makes a splash and a pooled decal (44, fade after 16 s). 
- **Sticky slime on enemies:** slime accumulates per target. 1st hit = SLOWED (speed ×0.55), 2nd = RESTRICTED (×0.2, attacks slowed), 3rd = TRAPPED (stuck ~3.4 s, cannot move or attack, only turn). It decays and expires. Dummies, guards, turrets and divers read the slime state (movement, turn rate, fire rate). Props and vehicles hit by slime get a coating that resists sliding.
- **E tail strike:** physical stinger swing with a small knockback. **Q claw:** alternating left/right sweep with a short lunge, usable in flight. Both have real contact tests from the animated tip bones. **Hit reaction:** flinch pose + red flash when damaged.

### Stinkfly — tested (scripted headless Chromium, state read back + screenshots)
GLB load/skeleton, ground idle/walk/run (foot planting checked), takeoff, hover, ascend/descend, normal/fast flight, banking, landing on street and rooftop, walking off a rooftop edge, slime on dummies (slowed → restricted → trapped → expiry), guards (state machine + speed multiplier), slime on solids/props/vehicles/ground, claw and tail at ground level and in flight, switching to/from each of the other 8 aliens (also mid-flight), random-input fuzz, camera never inside a building box during 3,600 sampled fast-flight frames, the 7 older aliens + Ripjaws against the earlier build with the same scripted inputs, contact sheets of the animation sets.

### Stinkfly — not done / limits (honest list)
- **No clips in the GLB** – all 17 requested animations are procedural poses on the original skeleton. The eyestalks, legs and claws use IK; very extreme poses can look stiff and skin blending is soft at the hips/shoulders.
- Wing blur is a faint swept-arc transparent mesh, not true motion blur; the flapping itself is real bone rotation.
- **No glide:** stopping the wings does not make him glide; when he is not flying he simply falls (or lands).
- No wall perching/clinging – only landing on ledges, rooftops and platforms.
- Slime "coating" of vehicle windows or moving parts is not modelled – props/vehicles get a decal and a slide-resist, nothing else. Turrets are slowed (turn and fire rate) but their trapped state was only exercised via the shared system, not played out in a fight.
- Guard slime was verified on the state/speed multiplier, not in a chase. The Stinkfly hit-reaction was only checked in single frames. Diamondhead's Z-ability damage in my regression script reads 28 or 45 depending on the build (seen before Stinkfly too); I did not chase the cause.
- Verified in software-rendered headless Chromium only (no real-GPU frame rate, nobody played with a real mouse); speeds, camera distance and damage are a first pass. Audio is synthesized (squelch, flap).

## Cannonbolt (10th alien) — controls, what is implemented, tested, limits
Models: `assets/cannonbolt.glb` (standing, 62-bone skinned rig) and `assets/cannonball.glb` (ball, 622 vertices) are used untouched (no recolour / re-proportion; only the hidden "Ultimate Spikes" mesh of the standing file is not drawn). The ball is scaled uniformly to the collision radius (0.95 m), so the visible ball and the physics sphere match.
**Controls:** WASD move/steer · Mouse camera · Shift run / roll faster · Space jump / rolling jump · Ctrl brake (ball) · **Q** curl / unroll · LMB punch combo (normal) / rolling impact (ball) · **E** heavy slam (normal) / unroll attack (ball) · **F** capture / release (ball) · C switch · Esc pause.
**Roll course** (free area x -8..10, z -4..17): launch ramp, mound, steep wedge (real sloped solids, `src/ramps.js`: walkable by every alien, camera-safe), kerb 0.18 m, low barrier 0.55 m, stairs 0.2/0.4/0.6 m, wooden crates, pebbles, 5 small "minion" dummies (capturable) and 2 mid-size dummies (push only). The car that stood at (-12, 9) was moved to (-22, 8.5).
- **Ball transformation:** Q plays a real procedural curl on the real skeleton (crouch, spine/chest fold, arms wrap, legs tuck, body sinks) for ~0.3 s; the ball model takes over while the tuck hides the swap (cross-scale), then rolling physics starts. Unroll: the ball brakes first, the standing model opens out of the tuck; if there is no room to stand it waits (no standing inside geometry).
- **Physics** (`src/cb_ball.js`, own rigid-sphere solver, not Rapier): acceleration, momentum, rolling resistance, braking, steering with sideways thrust (turn radius grows with speed), gravity, restitution + tangential friction per surface, slopes (gravity pulls him back on steep ones), spin = n×v/R (always from the real motion, kept in the air), substeps against tunnelling. Measured: 13 m/s normal, ~20-27 m/s with Shift (running is 6 m/s).
- **Obstacles:** small edges (kerb, steps, low barrier) are rolled over with ~95 % speed kept and only the needed lift; taller faces need speed (hop height grows with speed); a steep wedge stops a slow ball and a fast one goes over; fragile props (crates, bins, benches…) are smashed above ~7.5 m/s, heavy props / cars / walls bounce him (momentum exchange with mass), planted props take damage.
- **Bounce / ricochet:** angled hits ricochet along the wall, straight hits rebound with energy loss, ground bounces scale with fall speed, ramp exits launch him.
- **Combat:** punch combo with a haymaker, heavy slam (contact zone, dust, debris), roll impact (damage ∝ ½·m·v²), unroll attack. Ball armour reduces damage (≈30–80 % by hit strength), not invulnerable.
- **Capture / release:** F near a small enemy in contact (gap ≤ 0.6 m, line of sight, size + free volume check): 0.4 s pull-in, enemy hidden inside the ball (AI suspended, follows the ball position without inheriting the spin), capacity from volume (HUD shows MAX, 3 when empty); F releases at valid spots. Auto-release on alien switch, unroll, defeat, T reset. Large/medium targets are refused ("TOO LARGE / TOO BIG") and pushed by momentum instead.
### Cannonbolt — tested (scripted headless Chromium, state read back + screenshots)
Both models load; standing idle/walk/run/punch/heavy/jump frames checked; curl and unroll frame sequences checked (also unroll at 12 m/s); flat roll speeds, Shift boost, brake, wall ricochet; ramp launch + airtime; mound climb; steep wedge slow vs fast; kerb/barrier/stairs; rolling jump (momentum and spin kept); capture of 2 minions, release; refusal of a 2.4 m dummy; mid-size dummy pushed 7 m (not captured); switching while carrying (passengers released, standing at the ball position) and through all 10 aliens; T reset releases passengers; regression script on all other 9 aliens: identical numbers to the previous build (Diamondhead Z reads 28 or 45, seen before).
### Cannonbolt — not done / limits (honest list)
- Curl/unroll is a procedural tuck + scale cross-fade; the ball has no articulated plates, and spikes of the Ultimate form are not shown. No head bone in the model, so the "head turn" is a chest twist.
- Custom physics; cars are single boxes (cannot be climbed from the side, they bounce him); no ball-vs-mesh collision for the 3D props other than boxes/cylinders/ramps.
- Passengers are hidden inside the opaque ball (no visible sloshing). "Motion blur" is the existing speed overlay + stretch, not a real blur pass. Sounds reuse existing thud/crash effects.
- The arena has no "medium" enemy besides the 2 test dummies added for this; guards and normal dummies count as large. Not tested: very tight spaces for unroll beyond the code path, long play sessions, Safari.

## What is implemented
1. **Character switching** — `src/characters.js` registers each alien (model, controller, camera profile, HUD panels). C plays the green Omnitrix
   effect (energy orb at the chest, expanding ring, green particles, full-screen green flash, synthesized Omnitrix sound), swaps the model at the flash peak (~0.09 s)
   and keeps position, facing, velocity and camera orientation. No cooldown, menu or loading. Switching away cancels the old alien's actions
   (and ends Time Slow), and each alien only receives its own keys.
2. **XLR8 movement** — idle (breathing, weight shift, head look, tail sway), walk, run, super-sprint, acceleration/deceleration, drift turns
   (grip-limited steering gives curved arcs; body banks into the turn, tail swings out), quick-stop skid (leans back, dust, sparks), jump (crouch → rise tuck → fall → landing absorb),
   long jump. Speed trails are pooled camera-facing ribbons from the crest, tail tip, claws and feet; sprint adds wind particles, dust, FOV pull and speed lines.
3. **Time Slow** — two time domains in `src/timeslow.js` + `main.js`: *player time* (XLR8, camera, input, the ability's own timers) and *world time = real time × 0.07* (dummies and their walking AI,
   knockback physics, falling/airborne, turret bolts, debris). Lasts exactly 10.00 s of real time, eases out over 0.7 s, then a 20 s cooldown (HUD bar). Pressing T again never restarts it.
   Knockback impulses are real momentum that **accumulates** while slowed and carries on when normal time returns.
4. **Speed Combo** — locks onto the dummy you are looking at, dashes in (collision-checked), 5 strikes (8 dmg each, small shove), wind-up, finisher (20 dmg, big shove + launch, camera shake, shock ring).
   Real damage is applied on every hit; works in normal time and in Time Slow.
5. **Powers, slide, wall run, water run** — `src/xlr8powers.js` (+ the wall/slide/water physics in `src/xlr8.js`). Each power is a scripted "act" with its own stages, pose and damage;
   they run on player time while targets react on world time, so all of them also work during Time Slow. Dummies gained `confuse`, `held` (grabbed), thrown-impact damage and real momentum knockback.
   Blue translucent afterimages are 7 pooled copies of the XLR8 rig (same GLB geometry, additive blue material) — the real model's own materials are never touched.

## Four Arms — what is implemented (and verified)
Everything below was exercised by scripted scenarios in headless Chromium (numbers/state read back from the game, screenshots checked). Diamondhead and XLR8 were re-run afterwards and behave as before.
- **Model** — `assets/fourarms.glb` untouched: a real 99-bone skinned skeleton, no animation clips, T-pose. `animations/fourarmsrig.js` + `src/fa_pose.js` animate it procedurally (FK on spine/head/legs, two-bone IK for the four hands so grips land on the held object).
- **Movement** — idle breathing with all four arms, heavy walk, run with forward lean, crouch → high jump, heavy landing, vault / climb / ledge hang, wall-charge.
- **Grab system** (`src/fa_powers.js`, `src/props.js`) — categories Small / Medium / Heavy / Vehicle / Destructible / Static / Enemy; detection with an on-screen hint + ground marker; grab, carry (speed drops with weight), throw (ballistic solver, arc preview), drop, held objects follow a spring-smoothed carry point; held props leave collision while carried; multi-grab (two enemies; punch with one pair while holding with the other); arms-needed rule (heavy/vehicle need all four) and lifting capacity.
- **Props / destructibles** — cars, dumpsters, bins, benches, signs, streetlights, barriers, crates, boulder, furniture; own lightweight physics (gravity, friction, momentum, bump damage), 3 damage stages with cracks, instanced debris chunks; brick buildings with breakable wall sections.
- **Powers** — all of the table above with real damage, knockback, cooldown bars and HUD.
- **Camera** — distance/height bonus while carrying, collision-safe, shake on landings/slams/pounds.

## Not done / known limits (Four Arms)
- Tested in headless Chromium with software WebGL only — no real-GPU frame rates, and feel/tuning (weights, cooldowns, damage) is a first pass.
- Legs are FK-posed, not IK'd: feet can slide slightly while running or turning. Poses are procedural on a rigid skinned mesh, so elbows/shoulders can look soft at extremes and large held props may clip thin walls.
- Enemies are the same training dummies (no skeletal hit reactions); turrets are static and cannot be grabbed.
- The brick building has no roof; only the designated brick walls break. Rage visuals are an aura, light and screen overlay (no model change). All audio is synthesized.
- The grab hint can't tell objects apart through walls; very large props can partly block the view (camera pulls back and raises, but there is no fade-out).


## Heatblast / Upgrade — what is implemented, tested, and not done
**Models:** both GLBs are real skinned bipeds ("bip_*", ~70 bones, no clips). `animations/bipedrig.js` wraps them (rotates the cm-scale scene to face +Z, re-parents the loose flame/Omnitrix meshes to bones), `src/fa_pose.js` poses them procedurally. Geometry/textures/materials are used as shipped; a few materials are brightened/pulsed at runtime only (Heatblast flames, Upgrade circuitry).
**Tested (scripted headless Chromium, state read back + screenshots):** all five switches in a loop incl. 25 rapid presses, while merged, mid-merge and while liquid; Heatblast locomotion, flight (ascend/descend/boost/roof collision/soft landing), all six powers, attacks while flying, damage, ignition of every flammable prop type, car → smoke → explosion; Upgrade locomotion, liquid body through the crawl gap and the 0.8 m slot (and blocked in normal form), reform with and without headroom, Eye Laser damage to dummies/props, merge → control → enhance (all levels) → detach on cars, the truck, robots, turrets, consoles and the door, detach never ending inside a collider, vehicle crashes, safe detach beside walls.
**Not done / limits:**
- Verified only in software-rendered headless Chromium: no real-GPU frame rates, and feel/tuning (speeds, cooldowns, damage, energy costs) is a first pass. Everything else is procedural animation on rigid skinned meshes; flat unlit model colours, so lighting is only suggested by particles/lights.
- Fire Protection halves incoming bolt damage (a game-balance choice); it never reflects. Upgrade's merge only works on the registered machines; props that are not machines (crates, benches…) are not technology.
- Upgrade's body "liquid" effect is a squash/stretch of the model and green particles, not a fluid simulation; his eye laser origin is a fixed point on the head bone, calibrated by eye. Robots/turrets/cars are simple built-in props (not the Ben 10 designs). Computer functions are game-system toggles (turrets, floodlights, a door), not a networked world.
- Flight is limited to the arena (46 m ceiling). Enemies are still the same dummies and turrets.

## What the XLR8 GLB actually contains (inspected)
- 12 static meshes (face/eye details, body parts, Omnitrix), 26,387 vertices, flat colour materials (no textures/UVs), ~4.85 units tall with a 6.6 unit tail, Y-up, faces +Z.
- **No skeleton and no animation clips.** So, like Diamondhead, `animations/xlr8rig.js` adds a 21-bone runtime skeleton (spine, neck/head, 4-bone tail, arms, digitigrade legs) and computes skin weights
  from the original vertex positions; `animations/xlr8anim.js` drives it procedurally. Geometry and materials are unchanged.

## Not done / known limits
- Everything was tested in headless Chromium by scripted scenarios (positions, damage numbers, state changes, screenshots) — **not** by a person playing on a real GPU, so feel/tuning (speeds, camera, cooldowns) is a first pass.
- Powers only target training dummies; turrets are not affected by Clones/Throw, and the afterimages are visual only (enemies don't target them).
- Wall-run needs a wall at least ~1.2 m above your feet and a clean approach; it ends at corners. The pool is a flat visual plane + zone, not real fluid.
- Slide pose, wall-run pose and Throw hold are procedural poses on a rigid mesh and can look stiff or clip at extremes.
- XLR8 has no hit-reaction animation yet (turret bolts flash the screen and shake the camera only).
- Time Slow slows the enemy simulation (dummies, chasers, bolts, debris), but the dummies have no skeletal animation of their own, and no ambient audio exists to pitch-shift;
  the only sounds are the synthesized transform / slow-mo / hit effects. The 10 s uses real elapsed time (a frame hitch longer than 0.5 s is not counted).
- The only "enemies" are training dummies (J makes them walk toward you) and two turrets (Y).
- Procedural animation on a rigid mesh: skin blending can look soft at extreme bends (elbows, knees, tail root). Gait is foot-planted by a ground clamp, not IK, so feet slide slightly at speed.
- Tested in headless Chromium (software WebGL), not on a Mac GPU, so the frame rate there says nothing about Apple Silicon.

## Grey Matter (11th alien) — controls, what is implemented, tested, limits
Your `greymatter.glb` is used unchanged, scaled uniformly to 0.13 m tall (everything else is scaled to match: capsule r 0.035, step 0.03, camera scale 0.1, near plane 0.02, reach 0.15 m).
Controls: WASD, mouse, Shift sprint, Space jump (no double jump), Ctrl crouch/crawl, E interact/hack/repair, Q gadget, LMB shove-punch, C switch.
Small spaces: a 20 cm gap passes, a 5 cm gap does not; the 16 cm service vent only admits him crouched; cars (0.28 m) and benches (0.22 m) can be crawled under. Crates, cabinet and gripped pipes can be climbed/mantled; plain walls cannot.
Tech (MICRO DISTRICT, x -11..9, z -29..-20): generator repair + start, power panel circuit puzzle (opens vault door), security console (disables cameras), existing consoles and turret control boxes. Prompts only appear on compatible devices.
Tested in headless Chromium: height, gaps, vent, climb/mantle, tech chain, switching to/from all 11 aliens (incl. safe placement when leaving the duct).
Limits: puzzle is keyboard/click only; ADMIN-locked console functions still need Upgrade; animations are procedural IK on a rig with no clips; rotated props collide as their AABB; the angled console c1 was squared up; blink direction and some gesture poses not visually verified; not tested on a real GPU.
Credit: Grey Matter model supplied by you (check the original author/licence).

## Way Big (12th alien in this build) — controls, how it works, tested, limits
NOTE ON NUMBERING: the brief calls him the 13th alien (it counted Feedback). Feedback was removed from this game at your request, so Way Big is the **12th** playable alien: ... → Cannonbolt → Grey Matter → **Way Big** → Diamondhead.
Model: your `assets/waybig.glb` (5,021,740 bytes, untouched — Mixamo-style skinned T-pose model, 84 joints, 15 skinned meshes, 12 materials, no animation clips). It is recentred (feet on y=0) and scaled **uniformly** by 80 / 54.63 = 1.4644 so he is exactly **80.0 m tall** in world space (1 unit = 1 m). Materials/textures are the file's own (red/white as authored).
Controls: WASD move · mouse camera/aim · Shift run · Space jump (no double jump) · LMB punch · hold LMB charged heavy punch · Q chest energy blast · E grab / put down · LMB while holding = throw · R stomp · Ctrl defensive stance · C switch · N camera-shake OFF/LOW/FULL · Esc pause.
How it works (short): giant collision (r 7.5 m body, 10 m step height, separate foot contact rectangles, 9 body spheres for hits) · planted-foot gait with re-stepping (stance foot ground speed measured ~0) · footfalls crush only what is under the sole (7 × 11.6 m rectangle), dust + sound + light camera trauma · punches test the real fist position against building cells, ground, props, walls and enemies · the chest blast is a hit-scan from a dedicated chest emitter (on the Omnitrix) with a 40-energy cost and cooldown, 230 m max range, red-white, the only ranged attack · grab = reach (he walks/crouches to it, nothing teleports) → grip → lift → carry → throw/put down; mass limit 300 t; throws are ballistic props/enemies with real collisions · stomp = foot crush + distance-falloff physical shock, no glow rings · durability: hits are scaled by mass (impulse / 2.5e6 kg), guard x0.3, small arms ~0.25x — big enemies still flinch and push him.
World: a district outside the arena (x,z ±288 m): 10,062 destructible 6×5×6 m cells (InstancedMesh) with per-cell hp, supports + BFS collapse into a pool of 160 falling cells, 2 indestructible RESERVE TOWERS (impact flash only), low shop blocks, cars/trucks/lights/trees/barrels, troopers, tanks, a 34 m Titan (200 t) and a 62 m Colossus (800 t, too heavy to lift). Destroyed cells stop blocking immediately. The district exists only while Way Big is active; destroyed cells stay destroyed when you switch away and back (T / 0 resets them).
Tested (scripted headless Chromium, state read back + screenshots): exact height 80 m; walking 11 m/s / running 25 m/s; jump + heavy landing; planted foot ground speed p50 0.00 m/s (walk p95 0.00, run p95 1.9); footfall crushes a car under the foot while cars 40-60 m away are untouched; punch, heavy punch on a building (cells fall); chest blast from the chest damages a tank 200 m away and kills a trooper; grab trooper/car/Titan, mass limit message on Colossus; throws arc ballistically and a thrown car destroyed a tank; stomp kills enemies at the foot and 22 m away but not at 120 m; Titan walks up and punches him (HP, flinch, knockback ~mass based); guard x0.3; camera never inside a building cell, never below y 37 m in a 2700-sample walk; shake OFF = 0 displacement; C cycle order, HUD panels, fog/shadow/camera restore, destroyed buildings persist, safe placement on the next alien; regression: all 11 other aliens' keys still act on the dummies, no console errors; sim step ~4.5 ms (no rendering).
Limits (honest): Way Big is NOT available inside the 72 m arena as a meaningful playground — he stands on it like on a toy (its walls reach his ankle); the district only exists while he is active. When you switch away he is moved to the nearest legal arena spot (he cannot be carried across the map). Destruction is a cell-grid approximation (no windows/rooftop pieces; 6 m cells). Grab, throw and enemy AI values are first-pass tuning. Skin bending at the elbows/knees is procedural IK on a rig with no clips — looks soft in extreme poses. No real-GPU FPS was measured (software GL only). Rapid C taps during the 0.1 s flash complete the first swap first (existing behaviour).
Credit: "Gigante (Grandão) WayBig — Ben 10" by Nathan_zica (CC-BY-4.0, https://sketchfab.com/3d-models/gigante-grandao-waybig-ben-10-9f5c266107064aea8ffeba2ca31d4055).

Credits: "Ghostfreak" by Fire Max (CC-BY-4.0, https://sketchfab.com/3d-models/ghostfreak-7a9835af2cfd4b02bebd0c8fc89b0c24 — per the GLB's own metadata) · "Wildmutt" by zakariya6878 (CC-BY-4.0, https://sketchfab.com/3d-models/wildmutt-9329036424784304a0f6f9191b8a9c3c — per the GLB's own metadata) · "Heatblast" and "Upgrade – Ben 10 Classic" (supplied by you; author zakariya6878, CC-BY-4.0 — please verify on the original Sketchfab pages) · "Four Arms (Ben 10 OS)" by kimni88, CC-BY-4.0 · "Diamondhead (Classic) – Low Poly | Ben 10" by Raj (RajK3D), CC-BY-4.0 · "XLR8 -BEN10" by BenAissa_Karim, CC-BY-4.0
(https://sketchfab.com/3d-models/xlr8-ben10-cee2751660154cd4a3aaf68f2751fb33)
"Ripjaws (Ben 10)" by theamazingdonovan207 (CC-BY-4.0, https://sketchfab.com/3d-models/ripjaws-ben-10-4489444628a746d8a3a2eab1213eb965 — per the GLB's own metadata)

## Kevin 11 — boss villain V2 (AI enemy only: never playable, never in the Omnitrix)

NOTE ON NUMBERING: the brief says 13 playable aliens; this build has **12** (Diamondhead, XLR8, Four Arms, Heatblast, Upgrade, Wildmutt, Ghostfreak, Ripjaws, Stinkfly, Cannonbolt, Grey Matter, Way Big). Feedback was removed at your request. Kevin is not in the C-cycle.

Model: your `assets/kevin11.glb` (957,484 bytes, byte-identical to the upload). It is a **static mesh set: no skeleton, no skin, no animation clips**, so the rig was generated: `animations/kevinrig.js` skins the original vertices to a runtime skeleton (scale 1.5 → ≈3.7 m with markers for mouth, fire-arm tip, crystal-arm tip, both fists, chest) and `animations/kevinanim.js` animates it procedurally (24 states: idle, patrol walk, stalk, run, super-speed rush, dodge, three punch families + heavy, combo finisher, crystal punch/shot/spikes, fire punch/blast, goo spit, takeoff, hover, fly-chase, fly attack, landing, stagger, fall, down, get-up, roar, defeat). Geometry, UVs, textures and materials are untouched.

Where / controls: Kevin patrols the north-east corner of the arena (≈32, -32). He spots you by sight/noise, roars, then fights. **K** toggles his AI, **0** (reset dummies) respawns him with full HP. Boss bar at the top (name, phase, HP, notches at 70 % and 35 %, current state); an extra player HP bar is shown for aliens without their own.

Movement: walks when patrolling/searching/stalking/circling/recovering, runs to close distance, XLR8-style super-speed only tactically (far or fleeing target, surprise, dodge, rush-punch; cooldown `superSpeedCooldown 12 s`), slows before contact. Flight is intentional and temporary (`flightCooldown 8 s`, ≤ 9.5 m): takeoff → chase → air attack → descend → land with a shockwave; he never flies through buildings. Config block `KCFG` in `src/kevin.js` (aggression 0.65, dodgeChance 0.3, cooldowns…).

Shared impact system (`src/impact.js`, used by the player, guards, turrets and Kevin) — **V2: standing knockback only.** Every attack carries `{damage, knockbackForce, upwardForce, staggerDuration, ...}`; the target's mass/resistance scales it into a flinch → stagger lean → strong standing push (about 2–4 m, in the attack's world-space direction, never the camera) → smooth recovery. **No ragdoll, no falling, no lying down, no get-up animation.** Very strong hits can give a short controlled airborne reaction with a normal landing. Walls stop the push (impact damage; destructible walls break). Kevin's defeat is the only lying pose.

**V2 reuse:** Kevin's crystal arm fires Diamondhead's actual crystal projectiles + spikes, the fire arm Heatblast's fireballs/explosions, and the mouth Stinkfly's goo (it really sticks: the shared slime system slows/roots you). They run the original systems in an *owner mode* (Kevin's shots skip Kevin and damage you). **Time slow:** Kevin can cast his own XLR8-style time domain (`kTime`): ~10 s, ~20 s cooldown, wind-up telegraph; Kevin and the world run at normal speed while your movement, animations, projectiles and knockback run at 0.25×, camera/input stay responsive, smooth return; he is limited to a few hits while it is active. Fast left/right super-speed punch combos (flank attacks) are dodgeable, with real hit detection.

**Honest limits (V2):** Kevin's flight and super-speed use his own AI/trail code with the same look and rules as Stinkfly/XLR8, not the literal player controllers. Only the player/Kevin/guards use the full impact system; the training dummies keep their simple reactions. 12 aliens, not 13. The Kevin GLB had no rig, so the skeleton is generated procedurally; model credit kidomni367 (CC-BY-4.0).
Alien-specific: Grey Matter is launched farther (and takes ×0.55 damage so he is not one-shot), XLR8 dodges better, Diamondhead resists weak knockback, Four Arms resists ordinary punches, Cannonbolt's rolling ball exchanges momentum with Kevin, Ghostfreak's intangible form takes no physical hit and Kevin stops attacking him, Stinkfly is knocked off his flight path, Heatblast is knocked back grounded or airborne, Way Big is too massive for ordinary punches to launch (Kevin switches to ranged and flight tactics).

Kevin's attacks: normal, heavy, crystal punch (Diamondhead arm), fire punch (Heatblast arm), speed-rush punch, occasional combos; ranged: crystal shot, fire blast (Heatblast arm only), crystal spikes that unbalance, goo spat from the mouth (slows 62 % for 2.7 s, no ordinary knockback). Weighted selection by distance, your movement and alien, his HP, cooldowns, obstacles and recent actions; anti-spam (`lastAttack`, `repeatedAttackCount`). Visible wind-ups, recovery on strong attacks. Boss: 1500 HP, poise 55 (rapid light hits flinch him but cannot stun-lock; a poise break gives 1.7 s of armour), per-hit cap 15 % of max HP, ×1.2 damage in the recovery of a big attack. Phases: 100–70 % balanced · 70–35 % more combos and repositioning · < 35 % uses the same powers more often (no new abilities). He dodges (side-step i-frames) and dies with a fall + defeat state; respawns on reset.

Tested (scripted headless Chromium, software GL, state read back + screenshots): 40 s AI soak vs each of the 12 aliens (no NaN, no fall-through, patrol→spot→roar→walk→run→rush→slow→strike observed, flights and landings completed); each Kevin melee attack vs every alien (mass-based reactions); real-input attacks (LMB and Q/E/F/R/T/Z keys) from every alien onto Kevin — 12/12 can damage him; Kevin's own light/heavy/massive/Way-Big-class reactions, stun-lock, knockdown-loop, defeat; launched Kevin into destructible walls (walls destroyed, wall damage to him); Ghostfreak intangible 20 s (0 hits taken); dodge under sustained Heatblast/Diamondhead fire; long-range staging (77 m: walk → run → brief rush → slow); regression of all 12 aliens (move, jump, attack, powers; no console errors); sim cost with Kevin in combat is not measurable above noise (≈1.4–1.9 ms/step on the software renderer).
Fixed while testing: Kevin gets a wide low hit sphere (Grey Matter could not reach him), Cannonbolt's rolling ball no longer passes through him.

Not done / limits (honest list): the GLB has no rig, so the animation is procedural and approximate, not hand-keyed; the reference sheet's extras — crystal arm smashing walls, fire blasts setting objects alight, goo spreading as a ground puddle, flying over buildings — are **not** implemented (flight stays below 9.5 m and avoids buildings; goo is a slow only); the arena is cluttered so line of sight is rare and Kevin often approaches on memory/noise; combo frequency is low by design; Way Big, Grey Matter and Cannonbolt-ball branches were checked in scripted fights, not by long hand-played sessions; the older training dummies keep their previous hit reactions (only the player, guards, turrets and Kevin use the shared impact system); no GPU frame-rate was measured (headless software renderer only).

Credit: "Kevin 11" by kidomni367 (CC-BY-4.0, https://sketchfab.com/3d-models/kevin-11-e38ff28cf23b44568b9e6e98aa7c79b4).


## V3 update — aiming, OTHER AI switch, stronger Kevin, hit-glitch fix

- **Four Arms aims with the crosshair.** `src/aimassist.js` casts the camera ray, picks the living target under/near it (inside 8.5 m, not behind a wall), and Four Arms turns to it (world-Y only) as the punch starts and keeps tracking until the first strike. The hit cone is oriented along that aim, starts at his body, needs real reach, and walls block it. Diamondhead's Q melee and the Wildmutt / Ripjaws / Ghostfreak / Grey Matter / Cannonbolt (normal form) melee start with the same aim-facing. Kevin aims at his own AI target.
- **OTHER AI button** (top-left, or **Y**): turrets, guards, camera sensors and chasing dummies/divers go inactive, their bolts are removed, nothing is deleted or respawned; turning it back on resumes them (same objects, same HP). Kevin is a boss category (`game.enemyAI.bossesEnabled`) and is not affected (K still toggles him). The button is clickable on the pause screen / whenever the cursor is free; Y works during play.
- **Stronger Kevin:** 4000 HP (was 1500), damage x1.3 on all attacks, single-hit cap 5 % of max HP (Way Big still hits hard but cannot one-shot him), same weighted/cooldown attack selection.
- **Hit-glitch root cause fixed:** after a hit the impact system tipped the model and then restored only its quaternion. Three.js re-derived the Euler angles (for yaw = 180 deg that becomes (pi, 0, pi)), and the controller's next `rotation.y = yaw` flipped the model. The Euler is now restored exactly; the whole-body lean was also cut to at most 4 degrees on grounded characters and removed for flying/rolling/swimming ones. Knockback only moves the root.
- Limits: tested headlessly (no human play-testing); there are 12 aliens, not 13; melee aim-facing for non-Four-Arms aliens is a facing snap, not a rewritten hitbox.

## V5 update — Kevin super-speed burst, RESPAWN KEVIN, defeat fall

- **Kevin no longer slows time.** The time-slow attack is gone (never cast). His XLR8 power is an AI-only *speed burst* that changes only Kevin's own speed (26 m/s dash): wind-up, flank dash to the player's left/right punch, second punch from the other side, stronger finisher, then a short super-speed retreat, a 0.9 s recovery and a 12 s cooldown (65 % in phase III). Max 3 punches per burst. Player, camera, world and animation mixers stay at normal speed (measured: world and player scale 1.0 throughout). Hits use swept fist segments plus a swept body test, so a dash cannot tunnel through you; walls still block; each hit is controlled standing knockback with a recovery window.
- **RESPAWN KEVIN** button (next to OTHER AI) or **U**: resets the one existing boss (HP, AI, cooldowns, states, projectiles, animation, collision, boss bar) and places him at his spawn (checked: not in a wall, not below the map, not within 8 m of you, with ring fallbacks). Works alive or defeated; repeated presses never create a second Kevin. Works with OTHER AI off.
- **Defeat:** at 0 HP he stops everything, descends if airborne, recoils, falls backward onto his back (controlled rotation about the heels, wings folded flat, ground contact measured from his skeleton), thuds, and stays down until respawned. No ragdoll, player aliens unaffected. Boss state: `kevin.bossState` = active / defeated / respawning.
- Also fixed: the V3 OTHER AI button's CSS was missing from `style.css` (now added).

## V6 update — Diamondhead/goo twist fix, true sticky freeze, Kevin grab-and-throw

- **Root cause of the remaining twist/misalignment (Diamondhead and every alien): `src/slime.js` struggle wobble.** While slimed, the coat code did `root.rotation.x += …; root.rotation.z += …` every frame on the *player's* root. Nothing ever reset it, so the goo tilted the model more and more and left it permanently misaligned (it showed most on Diamondhead because his controller never re-levelled X/Z). The player's goo proxy now has `noWobble`; enemy dummies keep the wobble. Also fixed along the way: the shared knockback body kept stagger/tilt state across alien switches (`ImpactSystem.onSwitch()` resets it), and the small hit settle is now written straight into the root's Euler X/Z and restored there (no quaternion→Euler re-derivation, so yaw can never flip).
- **Way Big → Diamondhead camera:** re-measured camera distance/height/pitch/near/far/FOV 0.05–6 s after the switch; it lands exactly on the Diamondhead baseline (no change needed).
- **Sticky goo = a real freeze (`ImpactSystem.ctrl`).** First goo hit stores root x/z + yaw and starts one 3.2 s timer (`STICKY_T`); every frame the root is put back there (single writer, after controller+animation), movement/jump/dash/run input is zeroed, horizontal knockback/stagger/tilt are cancelled and refused (damage + flash still apply), yaw is held so the GLB never rotates to aim. Aiming, the camera, punches, crystals, fire and all non-movement powers still work. Repeat hits only refresh the timer. When it ends the lock is released with no snap. Giants (Way Big) are not stuck.
- **Kevin grab-and-throw** (`ATK.grab`, `Kevin.stepGrab`, new `grab` pose in `animations/kevinanim.js`): approach → prep (arm draws back, visible) → reach with the big arm on the player's side, with a short step-in lunge → hitbox = the hand's swept segment vs the player capsule (radius `grabReach`), blocked by walls, missed if the player moves away or Kevin is interrupted → the player is blended onto the hand over 0.2 s (no teleport) and hangs upright from it (offset scaled by his height) → lift → wind-up over the shoulder → snap → release into the shared air trajectory (14 m/s, vy 6.6; lighter for Grey Matter), ground collision, 34×1.3 damage, brief stagger on landing. Throw direction = Kevin's facing, turned away from walls. Goo is cleared on a throw. Control priority GRABBED > STICKY, one writer per frame. Not grabbable: Way Big / giants, flyers, rolling balls, intangible/ghost, anything over `grabMaxMass`/`grabMaxH`. `KCFG.grabCd` (15 s) + weighted AI choice (rarer than punches; likelier vs a still or goo-stuck player). Dropped cleanly on interrupt, alien switch, Kevin death and RESPAWN KEVIN.
- Config (all in `KCFG`): `grabCd, grabReach, grabMaxMass, grabMaxH, throwSpeed, throwSpeedTiny, throwVy, throwDmg, grabDmg`.
- Limits: tested headlessly (scripted input, state read-back, screenshots), no human play-testing; 12 aliens (not 13); Grey Matter is grabbed with a scoop-style reach (wider hitbox) because the arm cannot reach the floor; melee attacks fired while stuck still hit in the direction chosen by the attack but the body does not turn.

## Vilgax — final boss (AI only: never playable, never in the Omnitrix)
- Model: the supplied GLB (`assets/vilgax.glb`, "Fusionfall-Vilgax (OG Ben 10)" by Nexelecstar, CC-BY-4.0), unmodified: same geometry, textures, materials, colours. Its own skeleton and clips (stand/walk/run/ready/melee/dodge/wound) are used; the model root, physics and animation layers are kept separate (no rotation bug).
- Size 4.6 m (~15 ft; Four Arms is 3.0 m) with a matching collision capsule. HP 7000 (~1.75x Kevin), resists light hits, heavy hits hurt; not invincible. Knockback tiers: more than Four Arms, Grey Matter very vulnerable, Way Big resists.
- Moves: slow heavy walk, run, dodgeable charge, jump + shockwave, punches, tentacle whip, tentacle grab (pull + throw), hand grab + throw, ground slam, arm blast + charged blast (red build-up), prop throwing.
- AI: idle/patrol/detect/approach/chase/melee/ranged/grab/block/dodge/counter/jump/swim/stagger/recovery/defeated. Directional limited block that can be overwhelmed, then counter; adapts per alien (spam punches doesn't work). Phases at 70% and 30%.
- UI: large VILGAX boss bar; RESPAWN VILGAX button next to OTHER AI / RESPAWN KEVIN (no duplicates); OTHER AI keeps both bosses active. Defeat: falls backward and stays down, no ragdoll.
- Note: there are 12 playable aliens in this build.
- Limits: the "tentacles" are the GLB's short feeler bones stretched for whip/grab; hands can't reach the ground so Grey Matter is hit by a stomp fallback or tentacle grab; airborne players can't be grabbed (swimmers can); the death clip is unused (procedural backward fall); balance was tuned with scripted sims only.

### Vilgax V2 — no flight, signature charge, underwater combat
- **Flight removed.** No flight mode, hover, flight attacks, flight AI states, flight stamina or flight animations; he walks, runs, sprints, charges, jumps (normal gravity, lands with the shockwave) and swims. `startAct('takeoff'/'land')` is ignored; the debug line shows `flights 0`.
- **Charge is his signature.** Medium range (about 9-30 m, clear lane): detect -> turn -> ~0.85 s prep (stomps, dust, roar) -> forward-leaning sprint -> real capsule collision -> damage + strong directional knockback (existing stable knockback: no ragdoll, no spin; Diamondhead is carried several metres and stays upright) -> slow-down recovery. No damage unless the swept body hits the player. Steering is limited (0.35 rad/s, only for the first 0.5 s and only while the player is >7 m away, then the heading is locked), so a late sidestep makes him rush past ("MISSED", 1.4 s recovery). 6.5 s cooldown + anti-repeat weight; at close range he punches / grabs / throws / blocks / counters instead; far away he approaches, fires the occasional blast and looks for a charge lane.
- **Underwater.** Unlimited breath, no drowning, no submersion damage, never teleported out. He wades in, switches to swimming when the water is about 2.4 m deep (1.7 m when the player is diving), swims forward / back / left / right / up / down with drag and a gentle buoyant drift, turns, chases, surfaces and walks out when the water is under ~1.2 m and his feet are near the bed (or he leaves the basin). The same lagoon collision as the player's is used (bed, rocks, walls, surface ceiling) - there is no separate flying system - and a stuck detector nudges him free.
- **Underwater animation (procedural on top of the GLB):** enter-water plunge, breaststroke / gliding arms, sculling idle, flutter kick, pitch up / down and a small bank into turns (render-only tilt about the pelvis; physics stays upright), trailing feelers, torpedo pose for the swim-charge, exit pose. Tentacles are not distorted beyond the existing feeler stretch.
- **Underwater combat:** heavy punches, backhand, tentacle whip, tentacle grab (pull), hand grab-and-throw (water-resisted: the throw sets a swim velocity instead of a flying arc) and the swim-charge (swept path vs. the diver's capsule, ~12.5 m/s, limited steering, knockback through the water drag so the diver is not launched at unrealistic speed). He can hit a swimming player who is otherwise untouchable by ordinary enemies; bolts and shockwaves still do not hit submerged players.
- **AI by environment:** land - medium: charge, close: punch / grab / block / counter, far: approach / blast; underwater - medium: swim-charge, close: punch / grab / tentacles, far: swim toward the player; he follows a diver into the lagoon and a player who leaves the water out onto the beach. He never stands still underwater.
- Controls: unchanged (`I` AI on/off, `O` / button RESPAWN VILGAX, `Y` OTHER AI keeps both bosses).
- V2 limits: tested headlessly only (scripted sims, state read-back, screenshots); the lagoon is only 16 x 15 m with scattered rock pillars, so swim-charge lanes are short and he sometimes bumps a pillar (the charge then ends early and he recovers); he has no path-finding on land either (a building between him and the player can stall him); the GLB has no swim clips, so swimming is a procedural pose layer.


---

## Ben 10 (2005) Omnitrix update — Ben, the Omnitrix, HUD, settings (this build)

**You now start as Ben Tennyson** (his own GLB, `assets/ben.glb`, unmodified geometry / UVs / textures / materials). Every alien is reached through the Omnitrix. **Twelve** aliens, in this exact order: Diamondhead → XLR8 → Four Arms → Heatblast → Upgrade → Wildmutt → Ghostfreak → Ripjaws → Stinkfly → Cannonbolt → Grey Matter → Way Big (wraps both ways). *Feedback does not exist in this project*, so it is not in the list. **Kevin 11 and Vilgax are AI-only and are not in the Omnitrix.**

### How it plays
| | |
|---|---|
| Watch (top-left) | **Green** = ready (also while an alien is active and not yet in the warning). **Red** = recharging, or the warning blink. Only these two colours exist. |
| **C** (as Ben, Custom mode) | opens the selection dial in the centre of the screen. The opening key press never confirms. **D turns the watch 90° clockwise, A 90° counter-clockwise** (one alien per press, wraps Way Big ↔ Diamondhead); **C** or **Enter** transforms; **Q / Backspace** cancels. While it is open A / D never move Ben (every key is swallowed). |
| **C** (Random mode) | transforms at once. Weights: ten regular aliens 10 each, Grey Matter 3, Way Big 3 (total 106 → 9.43 % each / 2.83 % each; measured over 530 000 draws). |
| Sequence | Ben raises the watch and flips the dial → green light builds on the watch → the existing Omnitrix flash → the alien's own model (position / facing / velocity kept, camera re-fitted, HUD swapped). The alien starts at full HP / energy. |
| 120 s | exactly 2:00. A C **tap** does nothing (no menu, no switching). **Holding C ~1 s** (setting: 0.5 / 1 / 1.5 / 2 s) reverts to Ben early — see V8 below. Powers / movement / combat are untouched. |
| Last 15 s | the watch blinks red (3 times a second), the HUD turns red and a beep ticks every second. Only a warning — the alien keeps full control. |
| 0:00 | `CharacterManager.switchTo('ben')`: the alien's own `onLeave` stops its abilities (held objects dropped, flight / swim / roll / possession ended …), Ben appears **where the alien stands** (collisions resolved, never in a wall, never in deep water; from the air he falls, with no fall damage after a revert), the camera returns to human scale. |
| 60 s | red watch + countdown (also after a manual revert). Ben can walk / jump / punch; C is refused. At 0 the watch turns green and the timer disappears. |
| HUD | alien: **icon, name, HP / max HP, energy (Upgrade, Way Big), transformation timer, Omnitrix status**. Ben: name + HP + status, **never a portrait**. |
| Settings (pause card, Esc) | **Omnitrix mode** (Custom / Random), **Show alien HUD**, **Show transformation timer**. Saved in `localStorage`. The durations are fixed (no bypass option). Changing anything never resets or skips a running transformation or cooldown. |

### Ben
Walk 2.7 · run 5.6 · sprint 8.2 m/s (hold Shift ~1 s), jump 8.6 m/s, normal gravity; weak 3-hit punch combo (jab 5 / cross 6 / hook 9 damage, short lunge, crosshair-aimed); **HP 100** (own pool, regenerates slowly after 7 s; at 0 → "SECOND WIND" like the aliens); hit reactions run through the shared impact system (light mass: pushed, short flinch pose, never spun or tipped); no powers, no flight. Animation is procedural: the GLB is one static mesh, so `animations/benrig.js` builds a 17-bone tree and distance-weighted skin weights at load (the vertices themselves are only turned to face +Z and lifted so the soles sit on y = 0).

### Image pipeline (your 14 images)
`tools/process_omnitrix.py` — white background removal by **border-connected flood fill** (near-white = all channels ≥ 232, only regions that touch the image border), so the white inside the icons / watch is kept; a 3 px edge band gets alpha from darkness with white un-premultiplied (no halo), no interior holes. The untouched originals are copied to `assets/omnitrix/original/` and are never overwritten; the transparent copies are `assets/omnitrix/icon_<alien>.png` (12) + `watch_green.png` + `watch_red.png`. Each slot is matched by identity (not by position), and `python3 tools/process_omnitrix.py <slot> <image>` adds / replaces exactly one slot.

### Asset manifest / integration points (`src/omnitrix.js`)
`omnitrixAssets = { benModel, watch:{green,red}, alienIcons:{12}, watchAnimations:[], watchAnimationFps }`. **`watchAnimations` is empty — the watch-turn frames were not supplied.** Put the frame URLs in that array and they play on the dial on every A / D step; until then the dial simply rotates 30° per alien (CSS) with the hologram icon popping in. The activation uses a procedural watch raise + dial flip (`BenPlayer.omni.raise / press`), ready to be replaced by supplied animation clips.

### Other changes
Camera: cached offsets (`distBonus`, `speedFov`, roll) are reset when the camera scale changes by a factor ≥ 3, which fixed the Way Big / Grey Matter → human height. `#title` moved to the top-right and the test buttons (OTHER AI / respawns) to the bottom-right to free the top-left for the watch.

### Tested (headless Chromium, state read back + screenshots)
Start as Ben / green; C opens the dial without confirming; A / D order + wrap; no movement while the dial is open; confirm → raise → light → flash → Four Arms with 2:00 and the position kept; C and mode changes while transformed do nothing; red blink from 15 s; expiry → Ben at the same spot, red watch, 1:00; C refused during recharge; Ben moves and punches during recharge; setting toggles do not touch the cooldown; green after 60 s; Random mode; 530 000-draw probability check; all 12 aliens transform and revert (exactly one visible controller, no duplicates); revert while jumping, flying (12 m up), swimming in the lagoon, as Way Big (camera returns to human height), rolling as Cannonbolt, as Grey Matter; Ben punches dummies / Kevin / Vilgax; Kevin and Vilgax hit Ben (no tilt > 4°, no NaN); second wind; Kevin / Vilgax respawn buttons, OTHER AI toggle; 12-alien regression (move, attack, powers).

### Not done / limits
- No watch-turn animation frames were supplied (the procedural 90° turn is used), and no dedicated Omnitrix sound assets (existing beeps are used).
- Ben's hands are the GLB's open T-pose hands (no finger bones in the file), so punches are open-hand strikes.
- The dial does not pause the world: Kevin / Vilgax can still hit Ben while it is open (Q cancels).
- Alien HP is restored to full on each new transformation (decided, not specified); Ben's HP is kept separately.

## V8 update — Ben's arms, 90° Omnitrix dial, hold-C revert, Kevin 11 at Four Arms' height + Four Arms strength moves

**Ben's arms / idle (`src/ben.js` `pose()`, `ARM_REST`).** The GLB is a static T-pose model (4 meshes, no skeleton); `animations/benrig.js` builds the procedural 17-bone rig and skin weights and is *unchanged*, so his face, hair, clothes, watch, proportions, textures and materials are untouched (`assets/ben.glb` is byte-identical to your upload). The old idle abducted both arms (`out 0.10–0.14` rad, straight elbows, forearms facing forward), which read as an A-pose. Now every arm animation is *reference pose + offset*, recomputed from the animation numbers each frame (nothing accumulates, so no animation can leave an arm displaced): `ARM_REST = { f 0.05, e 0.30, o 0.025, yin 0.12 }` = arm hanging beside the body (≈ 3° out of vertical), 17° elbow bend, forearm turned slightly inward so the hands rest by the hips. Idle adds breathing, a slow weight shift (spine / hip roll) and a small head drift. Walk: arms swing opposite the same-side leg (correlation −0.97). Run: elbows ~80°, bigger / faster swing, forward lean. Punch: the striking arm extends along the cursor-aimed direction (`meleeAim` → `act.face`, plus a small vertical pitch toward the target), the torso turns into it, the other arm stays in front of the ribs, and the pose blends back to the reference. Limit: the hands are the GLB's open hands (no finger bones), so they cannot be curled.

**Omnitrix dial (`src/omnitrix.js`).** Every A / D press turns the watch exactly **90°** (D clockwise, A counter-clockwise, eased, 200–350 ms; setting *Dial turn speed*). The alien symbol is a separate layer (`#om-icon`) that is never rotated: it fades/shrinks out, the artwork changes at the half-way point of the turn, and fades back in, so it is always upright. Presses go into a queue (cap 6 waiting): one press = one alien, in order, no skipped or duplicated steps and no overlapping animations; a C pressed mid-turn waits for the dial to settle and then confirms the *last* selected alien. Order unchanged (Diamondhead, XLR8, Four Arms, Heatblast, Upgrade, Wildmutt, Ghostfreak, Ripjaws, Stinkfly, Cannonbolt, Grey Matter, Way Big, wrap-around). The supplied transparent icons are used as they were.

**Hold C to revert.** As an alien, `keydown C` starts a hold timer (auto-repeat ignored); `Omnitrix.update` counts it only while the state is `alien`; at `holdRevertS` (default 1 s) it calls the same `revert()` the 2:00 timer uses, so every alien's own `onLeave` runs (Way Big / flight / swimming / rolling cases are the already-tested safe-spot revert, with the camera reset to human scale), the watch turns red and the normal 60 s recharge starts — it cannot be bypassed. `keyup`, window blur or pause cancels the hold (a tap does nothing; a progress bar shows after 0.12 s). The C that opens the menu or confirms it is never a hold (a hold can only start from a C pressed while the alien is fully active), so one press can never confirm *and* revert; as Ben a hold does nothing extra. This replaces the old "locked for 2:00" rule.

**Kevin 11 height (`animations/kevinrig.js` `KV_SIZE`).** Measured in-game from skinned vertices in the idle pose with the feet on the floor: Four Arms' head top 2.924 m; Kevin's head top at the old scale 1.5 was 2.563 m → one uniform factor 1.141 (`KV_SCALE` 1.5 → 1.711) applied to the whole model, so legs, torso, arms, wings, tail and head scale together. Measured result: Kevin 2.925 m vs Four Arms 2.924 m, lowest vertex 0.000 m above the ground. Everything that depends on his size was scaled with the same factor: collision capsule (r 0.97, h 2.97 ≈ Four Arms' 3.0), hit spheres, ground alignment (`settleY`, `backDepth`), chest / eye heights (AI line of sight), melee reach / lunge / hit radii (`KATK_K`, a scaled *copy* of the attack table — Vilgax's table is untouched), grab reach and stand distances, flank-dash and landing distances, melee decision windows (`this.ks`), spike line start, stride length (`kevinanim.js`). Projectile origins follow his hand / mouth markers, so they scale automatically.

**Kevin now uses Four Arms' real strength moves through his own AI** (he is still AI-only, never in the Omnitrix; Diamondhead, Heatblast, Stinkfly and XLR8 powers, goo immobilisation, boss bar, respawn, defeat fall are unchanged):
| Four Arms move | Kevin version |
|---|---|
| Combo finisher (overhead smash) / strongest punch | **smash**: both big arms overhead (1.15 s readable charge with growing glow), fists drive into the ground ahead of him; direct hit only inside the fists' reach and a front cone with a clear line (44 dmg, heavy knockback), plus a small shockwave, cracks, debris and damage to props / destructible walls via `PropSystem`. Punishable recovery; also reachable as the last hit of a punch combo (`punch, punch, smash`, `heavy, smash`, `crystalPunch, smash`). |
| Ground pound | **slam**: both arms up (0.95 s), slam; a ring expands at 17 m/s to 9.5 m and hurts a target only if he is on the ground when it arrives (jump / fly over it) with distance falloff and radial knockback. |
| Seismic slam (R) | **seismic** (phase II+, 24 s cooldown, radius 15 m, longer charge with ground glow, fissure cracks). |
| Grab & Slam (Q) | the existing grab now has a second ending: 40 % of grabs bring the held player straight down in front of him (damage + small shockwave) instead of throwing. Real hand-reach hit test, no pulling from afar, never Way Big. |
| Environmental attack (G) | **propThrow**: he walks to a nearby vehicle / crate / barrel (60–1700 kg, < 3.6 m tall), lifts it overhead with both big arms and throws it at the player along a ballistic arc; the object hurts once if it is still fast when it reaches the player's capsule. |
| Block (B / RMB) | **block**: arms crossed, damage and knockback cut to ~30 % / 35 %, a very heavy blow breaks the guard, a blocked hit opens a counter window (his punches are weighted up). Chosen sometimes instead of a sidestep when a melee attack starts nearby. |
Four Arms has no separate "charged punch": his charged strong blow *is* the smash finisher, so Kevin's heavy / smash windups are that move. Not copied (not requested / no equivalent): Shove, Multi-Grab spin, Rage.
Selection (`Kevin.candidates`): close range → punches, heavy, crystal/fire punches, smash, grab; medium → slam, seismic, super-speed punches, projectiles; long → crystal, fire, goo, spikes, flight, super-speed approach, prop throw. Weights depend on distance, the player's movement (still / closing / fast / fleeing / airborne / tiny / giant), the selected alien, cooldowns, his own HP / phase and a repeat penalty (`spamMul`). Power moves have cooldowns (smash 6 s, slam 8 s, prop 12 s, seismic 24 s, block 5 s).

**Tested (headless Chromium, state read back):** `v8/o8.js` — dial angle 0→90 (D) / →−90 (A), monotonic, symbol rotation 0 in all 24 frames, icon swap at 54°, order of 12 presses, 5-instant-press and 40-press bursts, 200/350 ms durations, C mid-turn, tap / 0.9 s hold / 1 s hold, progress bar, recharge 60 s, no bypass, random mode, blur cancel, configurable hold, all 12 aliens manually reverted with valid Ben position and human camera; `v8/b8.js` — Ben idle / walk / run / punch geometry and recovery, feet planted; `v8/k1.js` — Kevin height / feet / capsule, slam (hit, jump-over, out of radius), smash (hit, step-away), seismic, prop throw phases, block, grab-slam, Way Big exclusion; `v8/k2.js` — 70 s of AI against six player forms (variety of moves, no errors); 12-alien regression; Vilgax AI 45 s unchanged.

**Limits.** Ben's open hands (no finger bones); the camera reset when reverting from Way Big is a snap hidden by the Omnitrix flash (not a slow glide); Kevin's lying defeat pose still lets his tail / wing tips pass below the floor plane (unchanged from before); the dial does not pause the world.

Credit: "Ben 10" by gaddiellartey2010 (CC-BY-4.0, Sketchfab) — `assets/ben.glb`.

## ALBEDO + BOSS MANAGER update (V26)
**Albedo** is a third AI-only boss (never playable, never in the Omnitrix). Spawn him from the **Boss Manager** (button or **B**).
- **Models:** human form = `albedo.glb` (Mixamo rig driven from Ben's animation tree; a runtime jacket-height correction is applied to the in-memory clone only — the GLB file is untouched). Special form = `ultimatewildmutt.glb`. Both are unmodified in `assets/`.
- **Aliens:** he can become all 12 playable aliens (same GLBs/rigs/controllers as the player, run as separate puppet instances with cloned materials), switching directly alien → alien with no return to human. Random starting alien, then weighted-random choice (distance, player flying/swimming/fast/big/tiny, own HP, water, Way Big room check, recency penalty). Interval 10–25 s (`ALBEDO_CFG` in `src/albedo.js`); grabs/throws/holds queue the switch until safe.
- **Timer:** ONE shared 120 s transformation timer; switching and Ultimate Wildmutt never reset it. At 0 he reverts to Albedo, then a 60 s recharge in which he cannot transform. Despawn clears all timers.
- **Ultimate Wildmutt:** reachable ONLY from regular Wildmutt (30 % roll), never from the random pool or other forms, cannot re-enter itself. Deals 2× Wildmutt's physical damage and knockback (measured 2.0×); same speed/attack speed/HP; more aggressive AI. The GLB is a static mesh, so it is auto-rigged at load (`animations/uwrig.js`): joints can look slightly soft in extreme poses.
- **HP:** one shared pool; transforming never heals. Defeat: attacks/AI/timers stop, the model returns to Albedo, a controlled backward fall plays, he stays down until respawn/despawn.
- **Switch safety:** no teleport on a switch; Way Big needs a space check + ground fix; Cannonbolt ball, fly, swim, phase, goo and fire state are cleaned up when leaving a form.
- **Boss Manager (B):** one pop-up listing Kevin 11, Vilgax and Albedo with status (DESPAWNED / ALIVE / DEFEATED) and a SPAWN / DESPAWN / RESPAWN button each; the game pauses its boss timers while it is open. The old separate Kevin/Vilgax buttons are replaced by it.
- **Known limits (honest list):** Albedo does not use Four Arms slam/grab, Ghostfreak possession, Upgrade merge, Grey Matter tech or Wildmutt Tracking Sense on the player (they need a player-side target). Way Big is skipped if the player is Way Big or there is no room. Move ranges were calibrated empirically and roughly; some moves (e.g. Four Arms F/R/Z, Heatblast burst, XLR8 hyper) were not seen to register hits in calibration. "Feedback" does not exist in this build (12 aliens). Kevin and Vilgax are AI-only.

## V27 — boss combat: bosses fight back (Kevin 11, Vilgax, Albedo)
**Problem:** repeated normal punches stun-locked Kevin and Vilgax (measured with a scripted 3-punches-per-second Four Arms spam: the old Kevin never completed a single attack in 20 s, 7 of 10 attacks were interrupted and he could not act for 10.6 s). 
**Fix — `src/boss_combat.js`** (Kevin and Vilgax; every number is configurable in `COMBAT`):
- **Diminishing hit-stun:** after 3 (Kevin) / 2 (Vilgax) non-strong hits within ~2 s the boss resists further stagger for 2.2 / 3.2 s; it resets after ~1.2 s without hits. Damage is never reduced by this — every punch still hurts.
- **Attack commitment:** while a heavy attack (Kevin) or any attack (Vilgax) is winding up / striking, non-strong hits cannot interrupt it (they push him only a little). "Strong" hits (Kevin ≥30 dmg or ≥15 knockback; Vilgax ≥62 dmg or ≥26 knockback — Way Big class) still stagger / launch / interrupt normally.
- **Random blocking:** a chance on each incoming hit (rises with the hit streak, capped, with a cooldown); a block lasts long enough to catch 1–2 punches, cuts damage to ~30 % (Kevin) / ~20 % (Vilgax) and is broken by strong hits.
- **Dodging:** Kevin side-steps with his speed, Vilgax takes a short back-step; low chance, 3 s / 5 s cooldown.
- **Counterattacks:** after a successful block or dodge, an occasional immediate heavy counter (Kevin: heavy / smash / crystal / fire punch; Vilgax: his existing counter table); cooldown 3.2 / 4.2 s; interruptible by strong hits.
- **Retaliation:** after taking a light hit in melee range the boss usually starts his own attack at once.
- **Vilgax:** removed a per-frame "guard after 3 hits" roll that made him block almost continuously under punch spam; his mass/resist were retuned so Ben barely moves him, Four Arms shoves him ~1 m and Way Big knocks him ~5 m.
- **Albedo** (`albedo_ai.js` / `albedo.js`): alien forms now sidestep / hop away (cooldown), Four Arms raises his real guard (key L), and a successful block or dodge can be followed by an immediate counter with the current alien's own moves. Alien switching and the shared timers are untouched.
- Knockback is still decided by each attacker (`shove`/`applyHit`) and the boss's mass: Ben < Four Arms < Way Big; no ragdoll, no spin (checked), bodies stay upright and recover.
**Honest limits:** Albedo's Diamondhead shield / Heatblast protection are not used defensively; blocking/dodging are probabilistic so single fights vary; numbers above come from a scripted "punch machine" (hits at fixed intervals) plus normal AI, not from a human playing.


## V31 — Cannonbolt fix, night glow, Four Arms, structures, world map, spaceship event, time speed
- **Cannonbolt freeze (root cause):** a `//` comment had swallowed the `const MU = {...}` friction table in `src/cb_ball.js`, so every bounce threw a ReferenceError and the frame loop aborted before rendering. Restored, added NaN / fall-speed guards, and the frame step is now wrapped in try/catch so one failing system can never freeze the render. 3 x 50 jump/land cycles were run with no errors.
- **Night glow:** Heatblast's body, hands, flames and fireballs light him and the ground around him (stronger at night). Ripjaws' small head lure glows blue-white (night / underwater) and nothing else on him changed.
- **Four Arms:** faster run (11.6 m/s, still well under XLR8's 16 / 44) and a charged ground super jump: hold Space to crouch and charge, release to leap (about 4 m short, 10 m mid, 18 m full charge in testing). Climbing and wall jumps were re-tested and still work.
- **Buildings:** support graph. A floor loses its support when the one below is destroyed, then drops and crumbles in a cascade; regeneration is kept.
- **World:** wider skyline (more tower blocks plus a third setback on the tallest), extra pocket park, playground and yard greenery in the suburbs, varied ground patches and props in the industrial area, scenic viewpoints along the mountain road, more pedestrians (200) and cars (44) with distance activation.
- **Heatblast rock platform:** compact flat-topped stone deck with glowing cracks, nozzle fire, a speed trail, orbiting pebbles and a gentle tilt (his GLB is untouched).
- **World map (Tab):** full-screen map with drag-pan, wheel / +/- zoom, C to centre, region and landmark labels, a scale bar, a layer legend (click to hide layers) and enemy markers (bosses, training-robot sites and active bots, underwater enemies, turrets), clustered with a count when zoomed out. The round minimap is unchanged.
- **Spaceship event:** the supplied ship model (decimated copy, `assets/mothership_game.glb`) starts far south and approaches over 10 in-game days, then hovers above the exact centre of Main City. It never attacks, spawns nothing and triggers no invasion. Progress is saved in the browser. URL options: `?shipday=N`, `?ship=reset`, `?time=`, `?timescale=`.
- **Time speed:** pause card, WORLD SETTINGS: 0.5x, 1x, 2x, 5x, 10x, 50x, 100x. Only the world clock accelerates (not characters, combat or physics). A "DAY n / 10" counter sits under the minimap clock.

## V32 — Vilgax invasion (on top of the V31 spaceship)
- **State machine (`src/island/invasion.js`):** APPROACHING (world days 0–10) → ARRIVING (ship stops over Main City) → INVASION_ACTIVE (robots + missiles, ~1 world day) → VILGAX_DESCENDING (world day 11, a beam opens under the ship) → VILGAX_ACTIVE. Every transition fires once and only forwards; `landed` / `dismissed` are saved (`ben10.invasion.v32`), so reloads never replay it or spawn a second Vilgax. Milestones use the WORLD clock (so 0.5x–100x move them); waves, missiles, AI and physics run on gameplay time, so 100x never floods the map.
- **Ship:** now 460 m long (about the length of Main City), parked at 330 m, engine glow + blinking underside lights, a soft ground shadow that follows the sun and a local light dimming under it (not map-wide). The GLB is unchanged.
- **Robots (`src/invasion_robots.js`, procedural, pooled, dark green / deep red / black, red sensors):** flying Attack Drone (fragile, hovers/strafes/shoots, dodges), Invasion Robot (shoots, punches, blocks, counters), Heavy Assault Robot (1.5x, telegraphed heavy punches, big knockback), Giant Enforcer (2.4x, far smaller than Way Big and weaker than Vilgax, telegraphed ground slam with a red floor ring, triple bolts). They detect by range + line of sight + field of view, search briefly, threaten civilians, and are pooled with population caps (8 / 6 / 3 / 2).
- **Missiles (`src/missiles.js`):** pooled (max 6), visible flight with trails and a red ground warning ring, cartoon explosion via the existing fire/destruction systems, buildings damaged (not all: strikes shift to open ground once ~22% of the city is in ruins), temporary fires (capped), civilians flee, regeneration is delayed near fresh impacts.
- **Vilgax:** the existing instance (Boss Manager unchanged). He descends through the beam, lands on valid ground near the centre, then hunts the player; his escort (heavy / standard / drone / giant) is the only force that tracks the player island-wide. A manually spawned Vilgax is never duplicated; a despawned one is not recreated.
- **HUD / map:** small status pill (top, clear of the health bar, Omnitrix and minimap); the full map shows ship, drones, robots, heavy, giants, impacts and the landing point, with an INVASION legend toggle.
- **Honest limits:** robots use the training-robot rig scaled/recoloured (no new GLBs); the ship does not cast a real shadow-map shadow (decal + dimming); missile and robot numbers are tuned by feel, not balanced against every alien.

## V33 — Ultimate Way Big & Vilgax invasion finale
- Robots: provoked robots retaliate at once (block / dodge / counter, poise against stun-lock); after Vilgax arrives every invasion robot knows where the player is (spaced slots around the player).
- Missiles: much bigger blasts (fireballs, shock rings, smoke, debris, scorch, cracked roads), more districts hit, some towers collapse / burn; the city is not erased.
- Vilgax retreats into the ship at 300 HP (beam lift), stays aboard; state machine extended (VILGAX_RETREATING, VILGAX_ABOARD, MOTHERSHIP_GRABBED, MOTHERSHIP_THROWN, MOTHERSHIP_CRASHED, INVASION_DEFEATED), saved.
- Way Big -> button / key **T** "ULTIMATE WAY BIG" (only while you control Way Big): 3.4 s transformation, supplied model `assets/ultimate_waybig.glb`, 2x damage / throw strength, size from the ship (chest = ship main-body height).
- Finale: Ultimate Way Big near the ship after Vilgax is aboard: **E** grab, **E / click** throw into the southern ocean, splash, partial sink, permanent wreck, "VILGAX INVASION DEFEATED".
