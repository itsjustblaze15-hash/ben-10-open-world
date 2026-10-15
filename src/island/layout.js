// ISLAND LAYOUT (pure data + pure functions, no THREE): the single source of truth for geography.
// Terrain, water, roads, scenery placement, NPC paths, boss spawn points and the MINIMAP are all generated from this file, so the minimap can never disagree with the world.
// Frame: metres, +X = east, -Z = north (the minimap draws north up). Sea level = SEA (the same water line the old lagoon used).
// The Omnitrix Labs compound sits on the old 72 m test arena at the origin, so every alien test system that was built there keeps working.

export const SEA = -0.12;
export const BOUNDS = { x0: -1240, x1: 1040, z0: -1080, z1: 960 };          // playable square (open ocean beyond the coast; clamps keep everybody inside)
export const GRID = { cell: 4, x0: BOUNDS.x0, z0: BOUNDS.z0, nx: Math.round((BOUNDS.x1 - BOUNDS.x0) / 4) + 1, nz: Math.round((BOUNDS.z1 - BOUNDS.z0) / 4) + 1 };

// ------------------------------------------------------------------------------------------------ coastline (outer island, clockwise, north = -z)
export const COAST = [
  [-560, -770], [-420, -805], [-280, -820], [-120, -810], [20, -790], [140, -755], [250, -722], [360, -712], [470, -700], [570, -668], [640, -612], [672, -520],
  [668, -420], [690, -330], [730, -230], [756, -110], [762, 20], [748, 150], [716, 270], [660, 368], [590, 440], [510, 500], [470, 560], [452, 610], [400, 628],
  [320, 616], [220, 622], [120, 628], [20, 618], [-80, 610], [-170, 640], [-290, 668], [-420, 666], [-540, 646], [-650, 606], [-740, 548], [-820, 470],
  [-880, 380], [-920, 270], [-948, 140], [-962, 10], [-958, -120], [-936, -250], [-896, -380], [-836, -500], [-760, -610], [-670, -706],
];
// the bay: open sea reaching north to the city's south shore, with a channel running west between the city and the suburbs
export const BAY = [
  [-238, 720], [-60, 720], [-74, 600], [-66, 520], [-50, 440], [-40, 360], [-46, 290], [-70, 246], [-120, 222], [-200, 214], [-300, 216], [-400, 222],
  [-470, 228], [-540, 236], [-596, 250], [-612, 270], [-590, 290], [-530, 292], [-470, 290], [-400, 292], [-330, 300], [-280, 318], [-250, 360],
  [-236, 430], [-232, 520], [-226, 600],
];
// small offshore islets (rock + a few trees): x, z, radius, height
export const ISLETS = [[-1010, -330, 40, 14], [-1040, 180, 28, 9], [-200, -900, 34, 16], [820, -420, 30, 10], [840, 160, 44, 12], [560, 700, 36, 11], [-60, 760, 26, 8], [-760, 700, 40, 13], [700, -780, 26, 9]];
// sea-level fresh water (swimmable like the sea): the forest lake and the river that runs from it into the channel
export const LAKES = [{ x: -712, z: -96, r: 74, depth: 9, name: 'FOREST LAKE' }];
export const RIVERS = [{ pts: [[-690, -40], [-668, 30], [-640, 100], [-626, 170], [-612, 232], [-604, 262]], w: 30, depth: 5, name: 'GREEN RIVER' }];
// elevated decorative water (mountain tarn + stream + waterfall): visual and wadeable, not part of the sea-level swim volume
export const TARN = { x: -150, z: -540, r: 46, level: 58.5, name: 'MOUNTAIN LAKE' };
export const STREAM = { pts: [[-196, -510], [-260, -470], [-330, -430], [-420, -380], [-500, -330], [-560, -270], [-610, -214], [-640, -182]], w: 7 };
export const FALLS = { x: -652, z: -176, top: 22, name: 'WATERFALL' };

// ------------------------------------------------------------------------------------------------ regions (soft polygons; terrain style + colour + content)
export const REGIONS = {
  city:       { name: 'MAIN CITY',      icon: 'city',     poly: [[-500, -246], [-56, -246], [-56, 214], [-500, 214]] },
  labs:       { name: 'OMNITRIX LABS',  icon: 'labs',     poly: [[-56, -64], [70, -64], [70, 64], [-56, 64]] },
  suburb:     { name: 'SUBURB',         icon: 'suburb',   poly: [[-860, 300], [-250, 300], [-226, 640], [-560, 660], [-800, 560], [-880, 400]] },
  forest:     { name: 'FOREST',         icon: 'forest',   poly: [[-980, -470], [-500, -470], [-500, 300], [-980, 300]] },
  foothills:  { name: 'FOREST',         icon: 'forest',   poly: [[-500, -400], [130, -400], [130, -250], [-500, -250]] },
  mountains:  { name: 'MOUNTAINS',      icon: 'mountain', poly: [[-760, -620], [-560, -840], [160, -840], [160, -400], [-560, -400]] },
  industrial: { name: 'INDUSTRIAL AREA',icon: 'industry', poly: [[130, -760], [700, -760], [700, -260], [130, -260]] },
  desert:     { name: 'DESERT',         icon: 'desert',   poly: [[70, -260], [800, -260], [800, 330], [70, 330], [70, 64]] },
  beach:      { name: 'BEACH',          icon: 'beach',    poly: [[-60, 300], [700, 330], [520, 660], [-60, 660]] },
};
export const REGION_ORDER = ['labs', 'city', 'industrial', 'beach', 'suburb', 'desert', 'mountains', 'foothills', 'forest'];

// flat pads: forced to height h (only on land), blended over `blend` metres
export const FLATS = [{ x0: -494, x1: -62, z0: -238, z1: 210, h: 0, blend: 34 }, { x0: -52, x1: 52, z0: -66, z1: 52, h: 0, blend: 28 }];

// ------------------------------------------------------------------------------------------------ city grid (axis-aligned blocks)
export const CITY = {
  ringX: [-470, -86], ringZ: [-214, 190],
  xs: [-406, -342, -278, -214, -150], zs: [-150, -86, -22, 42, 106], avenueX: -278, avenueZ: -22,
  core: { x: -246, z: -54 },                     // the skyline centre (tallest towers here, falling off outward)
  parks: [[-342, -86], [-150, 42]],              // block keys (west / north corner of the block)
  plaza: [-278, -22],
  lots: [[-406, 106], [-150, -150]],
};

// ------------------------------------------------------------------------------------------------ roads
// type: highway 18 m | avenue 16 | street 12 | lane 9 (suburb) | dirt 5 | path 3.5.  pts are control points (curvy roads are smoothed); `bridge` marks an axis-aligned deck over water.
export const ROAD_W = { highway: 18, avenue: 16, street: 12, lane: 9, dirt: 6, path: 3.5 };
export function cityRoads() {
  const C = CITY, R = [], [x0, x1] = C.ringX, [z0, z1] = C.ringZ;
  R.push({ id: 'ringN', type: 'highway', pts: [[x0, z0], [x1, z0]], straight: true, city: true });
  R.push({ id: 'ringS', type: 'highway', pts: [[x0, z1], [x1, z1]], straight: true, city: true });
  R.push({ id: 'ringW', type: 'highway', pts: [[x0, z0], [x0, z1]], straight: true, city: true });
  R.push({ id: 'ringE', type: 'highway', pts: [[x1, z0], [x1, z1]], straight: true, city: true });
  for (const x of C.xs) R.push({ id: 'cx' + x, type: x === C.avenueX ? 'avenue' : 'street', pts: [[x, z0], [x, z1]], straight: true, city: true });
  for (const z of C.zs) R.push({ id: 'cz' + z, type: z === C.avenueZ ? 'avenue' : 'street', pts: [[x0, z], [x1, z]], straight: true, city: true });
  return R;
}
export const ROADS = [
  ...cityRoads(),
  // labs links
  { id: 'labsW', type: 'avenue', pts: [[-86, 4], [-38, 4]], straight: true },
  { id: 'labsS', type: 'street', pts: [[0, 38], [0, 150], [10, 240], [40, 316], [60, 352]] },
  { id: 'labsE', type: 'street', pts: [[38, 0], [110, 6]] },
  // desert highway (through the canyon) + spur
  { id: 'desert', type: 'highway', pts: [[110, 6], [190, 20], [280, 52], [370, 70], [450, 64], [540, 90], [630, 132], [690, 150]] },
  { id: 'desertN', type: 'dirt', pts: [[450, 64], [470, -40], [510, -150], [520, -270]] },
  { id: 'desertS', type: 'dirt', pts: [[280, 52], [300, 150], [330, 240], [380, 310]] },
  // industrial road from the city's north-east corner to the port
  { id: 'port', type: 'highway', pts: [[-86, -214], [-30, -262], [60, -300], [180, -330], [300, -380], [400, -440], [470, -520], [510, -600]] },
  { id: 'portE', type: 'street', pts: [[300, -380], [420, -350], [540, -330], [620, -360]] },
  { id: 'portW', type: 'street', pts: [[400, -440], [300, -520], [220, -600], [200, -680]] },
  // mountain road: north avenue out of the city, switchbacks up to the viewpoint, down to the tarn
  { id: 'mtn', type: 'street', pts: [[-278, -214], [-282, -290], [-270, -370], [-330, -420], [-420, -450], [-450, -500], [-380, -540], [-300, -560], [-270, -610], [-330, -650], [-380, -690], [-300, -716], [-220, -700], [-180, -650], [-160, -596]] },
  // west road: city -> forest (north of the lake) -> loop south through the woods -> suburb
  { id: 'west', type: 'avenue', pts: [[-470, -22], [-540, -60], [-600, -150], [-680, -196], [-780, -190], [-850, -120], [-880, 0], [-860, 120], [-800, 230], [-740, 320], [-680, 360]] },
  { id: 'forestPath', type: 'dirt', pts: [[-600, -150], [-610, -60], [-596, 30], [-560, 110], [-540, 200]] },
  // bridges (axis-aligned decks)
  { id: 'bridgeW', type: 'avenue', pts: [[-406, 190], [-406, 330]], straight: true, bridge: true },
  { id: 'bridgeE', type: 'highway', pts: [[-278, 190], [-278, 300], [-292, 360]], bridge: true },
  { id: 'bridgeBay', type: 'street', pts: [[-300, 440], [-20, 440]], straight: true, bridge: true },
  { id: 'riverBridge', type: 'dirt', pts: [[-662, 70], [-610, 70]], straight: true, bridge: true },
  // beach: promenade road + lighthouse road + link from the bay bridge
  { id: 'promenade', type: 'avenue', pts: [[-20, 440], [60, 380], [160, 372], [280, 380], [380, 400], [460, 440]] },
  { id: 'lighthouse', type: 'dirt', pts: [[460, 440], [474, 500], [460, 556]] },
  { id: 'beachLink', type: 'street', pts: [[60, 352], [60, 380]], straight: true },
  { id: 'beachDesert', type: 'street', pts: [[380, 400], [420, 340], [380, 310]] },
];
// suburb streets (curvy lanes + cul-de-sacs), generated from a few spines
export const SUBURB_ROADS = [
  { id: 'sMain', type: 'street', pts: [[-406, 330], [-470, 380], [-560, 400], [-650, 380], [-680, 360]] },
  { id: 'sEast', type: 'lane', pts: [[-292, 360], [-310, 420], [-300, 440]] },
  { id: 'sCross1', type: 'lane', pts: [[-470, 380], [-450, 460], [-420, 530], [-380, 580]], cul: true },
  { id: 'sCross2', type: 'lane', pts: [[-560, 400], [-560, 480], [-520, 560], [-470, 600]], cul: true },
  { id: 'sCross3', type: 'lane', pts: [[-650, 380], [-700, 450], [-710, 520]], cul: true },
  { id: 'sLoop', type: 'lane', pts: [[-406, 330], [-360, 380], [-330, 460], [-300, 440]] },
  { id: 'sInner', type: 'lane', pts: [[-450, 460], [-500, 470], [-560, 480], [-620, 470], [-700, 450]] },
];

// ------------------------------------------------------------------------------------------------ points of interest / landmarks (minimap icons, spawn validation, region labels)
export const POI = [
  { id: 'downtown', name: 'DOWNTOWN', x: -246, z: -40, icon: 'city' },
  { id: 'labs', name: 'OMNITRIX LABS', x: 0, z: 0, icon: 'labs' },
  { id: 'port', name: 'PORT', x: 470, z: -600, icon: 'industry' },
  { id: 'viewpoint', name: 'VIEWPOINT', x: -380, z: -690, icon: 'mountain' },
  { id: 'tarn', name: 'MOUNTAIN LAKE', x: TARN.x, z: TARN.z, icon: 'mountain' },
  { id: 'lake', name: 'FOREST LAKE', x: -712, z: -96, icon: 'forest' },
  { id: 'falls', name: 'WATERFALL', x: FALLS.x, z: FALLS.z, icon: 'forest' },
  { id: 'canyon', name: 'RED CANYON', x: 380, z: 66, icon: 'desert' },
  { id: 'arch', name: 'NATURAL ARCH', x: 560, z: 220, icon: 'desert' },
  { id: 'pier', name: 'PIER', x: 160, z: 520, icon: 'beach' },
  { id: 'lighthousePoi', name: 'LIGHTHOUSE', x: 452, z: 582, icon: 'beach' },
  { id: 'suburbPark', name: 'PARK', x: -520, z: 440, icon: 'suburb' },
];
// boss spawn candidates (validated at runtime: dry, flat enough, clear of boxes / player)
export const BOSS_SPAWNS = [
  { x: -342, z: -86, region: 'city' }, { x: -214, z: 42, region: 'city' }, { x: -278, z: 106, region: 'city' }, { x: -150, z: -150, region: 'city' }, { x: -406, z: -22, region: 'city' }, { x: -214, z: -150, region: 'city' },
  { x: 300, z: -380, region: 'industrial' }, { x: 470, z: -520, region: 'industrial' }, { x: 180, z: -330, region: 'industrial' },
  { x: -560, z: 400, region: 'suburb' }, { x: -470, z: 380, region: 'suburb' }, { x: -650, z: 380, region: 'suburb' },
  { x: 280, z: 52, region: 'desert' }, { x: 540, z: 90, region: 'desert' },
  { x: 160, z: 372, region: 'beach' }, { x: 280, z: 380, region: 'beach' },
  { x: -680, z: -196, region: 'forest' }, { x: 60, z: -300, region: 'foothills' },
];

// ------------------------------------------------------------------------------------------------ geometry helpers (pure)
export function polyContains(poly, x, z) {
  let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) c = !c; } return c;
}
export function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz; let t = L > 0 ? ((px - ax) * dx + (pz - az) * dz) / L : 0; t = t < 0 ? 0 : t > 1 ? 1 : t; const qx = ax + dx * t - px, qz = az + dz * t - pz; return Math.sqrt(qx * qx + qz * qz);
}
export function polyEdgeDist(poly, x, z) { let d = 1e9; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) d = Math.min(d, segDist(x, z, poly[j][0], poly[j][1], poly[i][0], poly[i][1])); return d; }
/** signed distance to a polygon: + inside */
export function polySD(poly, x, z) { const d = polyEdgeDist(poly, x, z); return polyContains(poly, x, z) ? d : -d; }
export function polylineDist(pts, x, z) { let d = 1e9; for (let i = 1; i < pts.length; i++) d = Math.min(d, segDist(x, z, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1])); return d; }

/** Catmull-Rom resample of a control polyline (spacing in metres). Straight roads keep their exact corners. */
export function resample(pts, spacing = 4, straight = false) {
  const out = [];
  if (straight || pts.length < 3) {
    for (let i = 1; i < pts.length; i++) { const [ax, az] = pts[i - 1], [bx, bz] = pts[i], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / spacing)); for (let k = i === 1 ? 0 : 1; k <= n; k++) out.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]); }
    return out;
  }
  const P = [pts[0], ...pts, pts[pts.length - 1]];
  for (let i = 1; i < P.length - 2; i++) {
    const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2], L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), n = Math.max(2, Math.ceil(L / spacing));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t, f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ deterministic noise (value-gradient hybrid, seeded)
export function makeNoise(seed = 1337) {
  const perm = new Uint16Array(512); const p = new Uint16Array(256); for (let i = 0; i < 256; i++) p[i] = i;
  let s = seed >>> 0; const rnd = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; } for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const G = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
  const grad = (h, x, y) => { const g = G[h & 7]; return g[0] * x + g[1] * y; };
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  function n2(x, y) {
    const X = Math.floor(x), Y = Math.floor(y), xf = x - X, yf = y - Y, xi = X & 255, yi = Y & 255, u = fade(xf), v = fade(yf);
    const aa = perm[perm[xi] + yi], ab = perm[perm[xi] + yi + 1], ba = perm[perm[xi + 1] + yi], bb = perm[perm[xi + 1] + yi + 1];
    const x1 = grad(aa, xf, yf) + u * (grad(ba, xf - 1, yf) - grad(aa, xf, yf)), x2 = grad(ab, xf, yf - 1) + u * (grad(bb, xf - 1, yf - 1) - grad(ab, xf, yf - 1));
    return (x1 + v * (x2 - x1)) * 0.75;                                           // ~[-1, 1]
  }
  const fbm = (x, y, o = 5, lac = 2.03, g = 0.5) => { let a = 1, s2 = 0, n = 0; for (let i = 0; i < o; i++) { s2 += a * n2(x, y); n += a; x *= lac; y *= lac; a *= g; } return s2 / n; };
  const ridge = (x, y, o = 5) => { let a = 1, s2 = 0, n = 0; for (let i = 0; i < o; i++) { const r = 1 - Math.abs(n2(x, y)); s2 += a * r * r; n += a; x *= 2.01; y *= 2.01; a *= 0.5; } return s2 / n; };
  return { n2, fbm, ridge, rnd };
}
