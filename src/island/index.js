// Builds the whole island scenery on top of the terrain: roads + bridges, the city, suburbs, nature, beach, industrial port, Omnitrix Labs.
// Returns the interactive-prop spawn list (handed to the prop streamer) and the data other systems need (NPC paths, traffic lanes, the minimap).
import { buildRoads } from './roads.js';
import { Decor, Buildings } from './scatter.js';
import { buildCity } from './city.js';
import { buildNature } from './nature.js';
import { buildSuburb } from './suburb.js';
import { buildIndustrial } from './industrial.js';
import { buildBeach, buildLabs } from './beach.js';

export function buildIsland(world, extra = {}) {
  const T = world.terrain.T;
  const roads = buildRoads(world, T);
  const B = new Buildings(world), D = new Decor(world);
  const city = buildCity(world, B, D, T);
  const spawns = [...city.spawns];
  const mods = extra.modules || [buildLabs, buildSuburb, buildIndustrial, buildBeach, buildNature];
  const out = { roads, B, D, city, spawns, T };
  for (const fn of mods) { const r = fn(world, B, D, T, out); if (r && r.spawns) spawns.push(...r.spawns); }
  B.build(); D.build();
  // spawn hygiene: a prop never starts inside a building / static collider or inside another prop (nudged up to 6 m, otherwise dropped)
  { const R = { car: 2.3, truck: 3.6, container: 3.2, forklift: 1.6, dumpster: 1.3, bench: 1.0, fence: 0.3, light: 0.2 }, kept = [];
    const blocked = (x, z, r) => { const y = world.terrain.height(x, z); return world.staticsIn(x - r, z - r, x + r, z + r).some(b => b.max.y > y + 0.5 && b.min.y < y + 1.5); };
    const clash = (x, z, r) => kept.some(k => Math.abs(k.x - x) < r + (R[k.kind] || 0.6) - 0.2 && Math.abs(k.z - z) < r + (R[k.kind] || 0.6) - 0.2);
    let moved = 0, dropped = 0;
    for (const s of spawns.sort((a, b) => (R[b.kind] || 0.6) - (R[a.kind] || 0.6))) {
      const r = (R[s.kind] || 0.6) * 0.8; if (s.kind === 'light' || s.kind === 'fence') { kept.push(s); continue; }
      if (!blocked(s.x, s.z, r) && !clash(s.x, s.z, r)) { kept.push(s); continue; }
      let ok = false; for (let d = 1.5; d <= 6 && !ok; d += 1.5) for (let k = 0; k < 8 && !ok; k++) { const x = s.x + Math.cos(k * Math.PI / 4) * d, z = s.z + Math.sin(k * Math.PI / 4) * d; if (!blocked(x, z, r) && !clash(x, z, r) && world.terrain.dl(x, z) > 3) { s.x = x; s.z = z; ok = true; } }
      if (ok) { kept.push(s); moved++; } else dropped++;
    }
    spawns.length = 0; spawns.push(...kept); out.spawnFix = { moved, dropped }; }
  out.update = (dt, cam) => { D.update(cam); if (world.animated) for (const f of world.animated) f(dt); };
  return out;
}
