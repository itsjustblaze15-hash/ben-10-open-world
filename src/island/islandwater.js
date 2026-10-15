// ISLAND WATER: the sea, the bay, the channel, the river and the forest lake are ONE sea-level water body (the old lagoon's water line).
// It keeps the Lagoon API (floorAt, depthAt, inRect, groundFor, blockDeep, collideSphere, splash, bubbles, underwater look ...) so Ripjaws, Vilgax, props, fire, the camera and every
// alien that wades / water-runs / swims work unchanged - but the bed is the real terrain everywhere, so depth comes from the island's own seabed (shallow beaches -> deep offshore).
import * as THREE from 'three';
import { Lagoon } from '../water.js';
import { clamp, smoothstep, mulberry32, rand } from '../util.js';
import { SEA, BOUNDS, TARN } from './layout.js';

const _g = { x: 0, z: 0 };
export class IslandWater extends Lagoon {
  constructor(game) {
    super(game);                                   // builds FX + calls the overridden builders below
    this.x0 = BOUNDS.x0; this.x1 = BOUNDS.x1; this.z0 = BOUNDS.z0; this.z1 = BOUNDS.z1; this.rect = { x0: this.x0, x1: this.x1, z0: this.z0, z1: this.z1 }; this.world.water = null;
    this.island = true;
  }
  get terrain() { return this.world.terrain; }
  // ---- builders of the old basin: not used
  carve() {} buildFloor() {} buildWalls() {} buildRocks() { this.rocks = []; }
  populate() {}
  // ---------------------------------------------------------------------------------------------- queries (same contract as the lagoon)
  floorAt(x, z) { return this.terrain.height(x, z); }
  depthAt(x, z) { return Math.max(0, this.waterY - this.terrain.height(x, z)); }
  /** "is this point over the water body" (margin m widens it: any of 5 samples wet) */
  inRect(x, z, m = 0) {
    const T = this.terrain, y = this.waterY - 0.02; if (T.height(x, z) < y) return true; if (m <= 0) return false;
    return T.height(x + m, z) < y || T.height(x - m, z) < y || T.height(x, z + m) < y || T.height(x, z - m) < y;
  }
  floorRing(x, z, r) { const T = this.terrain; let g = T.height(x, z); if (r > 0) g = Math.max(g, T.height(x + r, z), T.height(x - r, z), T.height(x, z + r), T.height(x, z - r)); return g; }
  groundFor(x, z, y, step = 0.45, r = 0.3) {
    let g = this.floorRing(x, z, r * 0.6);
    for (const b of this.world.boxes) if (x > b.min.x - r && x < b.max.x + r && z > b.min.z - r && z < b.max.z + r && b.max.y <= y + step && b.max.y > g) g = b.max.y;
    return g;
  }
  bedAt(x, z) { return this.terrain.height(x, z); }
  sunkFloor(x, z, y) { return this.groundFor(x, z, y + 0.3, 0.3, 0.05); }
  camFloor(x, z) { return this.terrain.height(x, z) + 0.35; }
  /** land-bound walkers: out of water deeper than ~0.7 m, back up the slope toward the shore */
  keepOut(p, r) { this.pushShore(p, 0.7); }
  /** every ground walker except Ripjaws (and a water-running XLR8): may wade to ~1 m deep, then slides back toward the shore */
  blockDeep(p, r) {
    const d = this.depthAt(p.x, p.z); if (d <= 1.0) return; this.pushShore(p, 1.0);
    if (p === this.g.player.pos && this.blockT <= 0) { this.blockT = 2.5; this.g.hud.toast('TOO DEEP — ONLY RIPJAWS CAN DIVE'); }
  }
  pushShore(p, lim) {
    for (let k = 0; k < 6; k++) {
      const d = this.depthAt(p.x, p.z); if (d <= lim) return;
      this.terrain.gradient(p.x, p.z, _g); let L = Math.hypot(_g.x, _g.z);
      if (L < 0.02) { _g.x = -p.x; _g.z = -p.z; L = Math.hypot(_g.x, _g.z) || 1; }      // flat bed: head toward the island centre
      const s = Math.min(0.5, (d - lim) / Math.max(0.08, L) * 0.5); p.x += _g.x / L * s; p.z += _g.z / L * s;
    }
  }
  collideSphere(p, r, v = null, o = {}) {
    let hit = 0, nx = 0, ny = 0, nz = 0; const w = this.world;
    const into = () => { if (v) { const vn = v.x * nx + v.y * ny + v.z * nz; if (vn < 0) { v.x -= nx * vn; v.y -= ny * vn; v.z -= nz * vn; } } };
    for (const b of w.boxes) {
      if (b.max.y < p.y - r || b.min.y > p.y + r || p.x + r < b.min.x || p.x - r > b.max.x || p.z + r < b.min.z || p.z - r > b.max.z) continue;
      const cx = clamp(p.x, b.min.x, b.max.x), cy = clamp(p.y, b.min.y, b.max.y), cz = clamp(p.z, b.min.z, b.max.z), dx = p.x - cx, dy = p.y - cy, dz = p.z - cz, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) { const d = Math.sqrt(d2), k = (r - d) / d; p.x += dx * k; p.y += dy * k; p.z += dz * k; nx = dx / d; ny = dy / d; nz = dz / d; }
      else {
        const fx0 = p.x - b.min.x, fx1 = b.max.x - p.x, fy0 = p.y - b.min.y, fy1 = b.max.y - p.y, fz0 = p.z - b.min.z, fz1 = b.max.z - p.z, m = Math.min(fx0, fx1, fy0, fy1, fz0, fz1); nx = ny = nz = 0;
        if (m === fx0) { p.x = b.min.x - r; nx = -1; } else if (m === fx1) { p.x = b.max.x + r; nx = 1; } else if (m === fy0) { p.y = b.min.y - r; ny = -1; } else if (m === fy1) { p.y = b.max.y + r; ny = 1; } else if (m === fz0) { p.z = b.min.z - r; nz = -1; } else { p.z = b.max.z + r; nz = 1; }
      }
      into(); hit |= 1; if (o.onHit) o.onHit(b);
    }
    for (const c of w.cylinders) {
      if (c.dead || p.y + r < c.pos.y || p.y - r > c.pos.y + c.h) continue; const dx = p.x - c.pos.x, dz = p.z - c.pos.z, rr = r + c.r, d2 = dx * dx + dz * dz;
      if (d2 < rr * rr) { const d = Math.sqrt(d2) || 1e-4, k = (rr - d) / d; p.x += dx * k; p.z += dz * k; nx = dx / d; ny = 0; nz = dz / d; into(); hit |= 1; }
    }
    { const T = this.terrain, e = 0.5, f = T.height(p.x, p.z), gx = (T.height(p.x + e, p.z) - T.height(p.x - e, p.z)) / (2 * e), gz = (T.height(p.x, p.z + e) - T.height(p.x, p.z - e)) / (2 * e), iy = 1 / Math.sqrt(1 + gx * gx + gz * gz);
      if ((p.y - f) * iy < r) { p.y = f + r / iy; nx = -gx * iy; ny = iy; nz = -gz * iy; into(); hit |= 2; } }
    const B = BOUNDS; if (p.x < B.x0 + r) { p.x = B.x0 + r; if (v && v.x < 0) v.x = 0; } if (p.x > B.x1 - r) { p.x = B.x1 - r; if (v && v.x > 0) v.x = 0; } if (p.z < B.z0 + r) { p.z = B.z0 + r; if (v && v.z < 0) v.z = 0; } if (p.z > B.z1 - r) { p.z = B.z1 - r; if (v && v.z > 0) v.z = 0; }
    this.lastN = { x: nx, y: ny, z: nz }; return hit;
  }
  swimmable(x, z, d = 1.4) { return this.depthAt(x, z) >= d; }

  // ---------------------------------------------------------------------------------------------- the visible sea: one large surface, colour from the real depth (heightfield texture)
  buildSurface() {
    const T = this.world.terrain.T, waterY = this.waterY;
    const data = new Uint16Array(T.nx * T.nz); for (let i = 0; i < data.length; i++) data[i] = THREE.DataUtils.toHalfFloat(T.H[i]);
    const ht = new THREE.DataTexture(data, T.nx, T.nz, THREE.RedFormat, THREE.HalfFloatType); ht.magFilter = ht.minFilter = THREE.LinearFilter; ht.wrapS = ht.wrapT = THREE.ClampToEdgeWrapping; ht.needsUpdate = true; this.heightTex = ht;
    const S = 5200, geo = new THREE.PlaneGeometry(S, S, 260, 260); geo.rotateX(-Math.PI / 2); geo.translate((BOUNDS.x0 + BOUNDS.x1) / 2, waterY, (BOUNDS.z0 + BOUNDS.z1) / 2);
    this.surfU = { uTime: this.U.uTime, uRip: { value: this.rips }, uSun: { value: this.world.sunDir.clone() }, uK: { value: 0 }, uH: { value: ht }, uGrid: { value: new THREE.Vector4(T.x0, T.z0, (T.nx - 1) * T.cell, (T.nz - 1) * T.cell) }, uWaterY: { value: waterY } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.surfU, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      vertexShader: `uniform float uTime; uniform vec4 uRip[8]; varying vec3 vW; varying vec3 vN;
        float rip(vec2 p){ float h=0.0; for(int i=0;i<8;i++){ vec4 r=uRip[i]; if(r.w<=0.0) continue; float d=length(p-r.xy); float f=r.z*2.4; h+=sin((d-f)*7.0)*exp(-abs(d-f)*2.2)*exp(-r.z*1.1)*r.w*0.07; } return h; }
        float Hh(vec2 p){ return 0.05*sin(p.x*0.35+uTime*0.9)+0.04*sin(p.y*0.42-uTime*0.8+1.3)+0.02*sin((p.x+p.y)*1.1+uTime*1.6)+rip(p); }
        void main(){ vec3 p=position; float e=0.4; float h=Hh(p.xz); float hx=Hh(p.xz+vec2(e,0.0)); float hz=Hh(p.xz+vec2(0.0,e)); vN=normalize(vec3(-(hx-h)/e,1.0,-(hz-h)/e)); p.y+=h; vW=p; gl_Position=projectionMatrix*viewMatrix*vec4(p,1.0); }`,
      fragmentShader: `uniform float uTime; uniform vec3 uSun; uniform sampler2D uH; uniform vec4 uGrid; uniform float uWaterY; varying vec3 vW; varying vec3 vN;
        float th(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float tn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(th(i),th(i+vec2(1,0)),f.x),mix(th(i+vec2(0,1)),th(i+vec2(1,1)),f.x),f.y); }
        void main(){
          vec2 uv=(vW.xz-uGrid.xy)/uGrid.zw; float bed = (uv.x<0.0||uv.y<0.0||uv.x>1.0||uv.y>1.0) ? -40.0 : texture2D(uH, uv).r; float depth=max(0.0,uWaterY-bed);
          if(depth<0.005) discard;
          vec3 N=normalize(vN); vec3 V=normalize(cameraPosition-vW); vec2 q=vW.xz;
          N.xz += 0.05*vec2(sin(q.x*1.9+uTime*2.1+sin(q.y*1.4)), cos(q.y*1.7-uTime*1.9+sin(q.x*1.3))); N=normalize(N);
          bool top=gl_FrontFacing; if(!top) N=-N;
          float ndv=clamp(dot(N,V),0.0,1.0); float fres=pow(1.0-ndv,3.0);
          vec3 R=reflect(-V,N); float sk=clamp(R.y*0.5+0.5,0.0,1.0); vec3 skyC=mix(vec3(0.70,0.86,0.96),vec3(0.28,0.55,0.90),sk);
          float dk=smoothstep(0.0,14.0,depth); vec3 shallow=vec3(0.26,0.86,0.80), mid=vec3(0.08,0.62,0.78), deep=vec3(0.04,0.30,0.62);
          vec3 base = depth<3.0 ? mix(shallow, mid, smoothstep(0.0,3.0,depth)) : mix(mid, deep, dk);
          float foamN = tn(q*0.7+vec2(uTime*0.3,-uTime*0.2))*0.6+tn(q*2.3-vec2(uTime*0.4,uTime*0.1))*0.4;
          float foam = (1.0-smoothstep(0.0,0.75,depth))*smoothstep(0.35,0.7,foamN + 0.25*sin(depth*9.0-uTime*2.2));
          vec3 col; float a;
          if(top){ float spec=pow(max(dot(R,uSun),0.0),220.0)*2.2; float glit=step(0.985, tn(q*6.0+uTime*0.8))*0.35*(1.0-dk*0.5);
            col=mix(base,skyC,fres*0.6)+spec+glit; col=mix(col,vec3(1.0),foam*0.85);
            a=clamp(mix(0.38,0.97,smoothstep(0.0,5.0,depth))+fres*0.25+foam,0.0,1.0); }
          else { float k=pow(1.0-ndv,2.0); float glare=pow(max(dot(-V,uSun),0.0),10.0)*0.5; col=mix(vec3(0.07,0.46,0.54),vec3(0.38,0.82,0.86),k)+vec3(0.5,0.85,0.8)*glare; a=mix(0.5,0.9,k); }
          // distance haze toward the horizon so the sea meets the sky
          float dist=length(cameraPosition.xz-vW.xz); col=mix(col,vec3(0.72,0.86,0.95),smoothstep(700.0,2400.0,dist)*0.85*(top?1.0:0.0));
          gl_FragColor=vec4(col,a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.surface = new THREE.Mesh(geo, mat); this.surface.frustumCulled = false; this.surface.renderOrder = 3; this.scene.add(this.surface);
    // the elevated mountain lake (decorative, wadeable): a flat disc in the same style
    const tg = new THREE.CircleGeometry(TARN.r + 6, 48); tg.rotateX(-Math.PI / 2); tg.translate(TARN.x, TARN.level, TARN.z);
    const tm = new THREE.MeshToonMaterial({ color: 0x3fb7d6, transparent: true, opacity: 0.78 }); this.tarn = new THREE.Mesh(tg, tm); this.tarn.renderOrder = 3; this.scene.add(this.tarn);
  }
  buildFX() {
    super.buildFX();
    for (const m of this.rays) m.userData.off = { x: rand(-14, 14), z: rand(-14, 14) };
  }
  update(dt, cam, renderer) {
    super.update(dt, cam, renderer);
    if (this.uw > 0.05) for (const m of this.rays) { m.position.set(cam.position.x + m.userData.off.x, this.waterY, cam.position.z + m.userData.off.z); }
  }
}
