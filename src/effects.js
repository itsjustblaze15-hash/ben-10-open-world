// Crystal geometry + pooled particle systems (shards, glow sprites, shock rings, decals).
import * as THREE from 'three';
import { mulberry32, rand, clamp } from './util.js';

/** Faceted crystal pointing along +Z, base at z=0, tip at z=length. Flat-shaded, jittered so no two look alike. */
export function makeCrystalGeometry({ length = 1, radius = 0.12, sides = 6, tip = 0.38, jitter = 0.14, seed = 1 } = {}) {
  const rnd = mulberry32(seed * 7919 + 13);
  const rings = [
    { z: 0, r: radius * 0.55 },
    { z: length * 0.22, r: radius },
    { z: length * (1 - tip), r: radius * 0.92 },
  ];
  const ang0 = rnd() * Math.PI;
  const ringPts = rings.map(rg => {
    const pts = [];
    for (let i = 0; i < sides; i++) {
      const a = ang0 + (i / sides) * Math.PI * 2 + (rnd() - 0.5) * 0.25;
      const rr = rg.r * (1 + (rnd() - 0.5) * 2 * jitter);
      pts.push(new THREE.Vector3(Math.cos(a) * rr, Math.sin(a) * rr, rg.z + (rnd() - 0.5) * length * 0.03));
    }
    return pts;
  });
  const apex = new THREE.Vector3((rnd() - 0.5) * radius * 0.5, (rnd() - 0.5) * radius * 0.5, length);
  const base = new THREE.Vector3(0, 0, -length * 0.02);
  const tris = [];
  const quad = (a, b, c, d) => tris.push(a, b, c, a, c, d);
  for (let k = 0; k < rings.length - 1; k++) {
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      quad(ringPts[k][i], ringPts[k][j], ringPts[k + 1][j], ringPts[k + 1][i]);
    }
  }
  const last = ringPts[ringPts.length - 1];
  for (let i = 0; i < sides; i++) tris.push(last[i], last[(i + 1) % sides], apex);
  const first = ringPts[0];
  for (let i = 0; i < sides; i++) tris.push(first[(i + 1) % sides], first[i], base);
  const pos = new Float32Array(tris.length * 3);
  tris.forEach((v, i) => { pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z; });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals(); // non-indexed => flat facets
  g.computeBoundingSphere();
  return g;
}

export function crystalMaterial({ color = 0x39e58c, emissive = 0x16c866, emissiveIntensity = 0.9, opacity = 0.88 } = {}) {
  return new THREE.MeshPhysicalMaterial({
    color, emissive, emissiveIntensity, roughness: 0.06, metalness: 0.25, transparent: true, opacity,
    flatShading: true, envMapIntensity: 2.2, clearcoat: 1, clearcoatRoughness: 0.05,
  });
}

/** Pooled debris shards (InstancedMesh). */
export class ShardSystem {
  constructor(scene, capacity = 700) {
    this.cap = capacity;
    const geo = makeCrystalGeometry({ length: 1, radius: 0.28, sides: 5, tip: 0.5, jitter: 0.2, seed: 5 });
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.08, metalness: 0.3, flatShading: true, envMapIntensity: 2.4,
      emissive: 0x0a7a3a, emissiveIntensity: 0.6, transparent: true, opacity: 0.92,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    scene.add(this.mesh);
    this.p = new Array(capacity).fill(0).map(() => ({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), q: new THREE.Quaternion(), axis: new THREE.Vector3(), spin: 0, size: 1, life: 0, max: 1, grav: 1, bounce: 0 }));
    this.next = 0;
    this._m = new THREE.Matrix4(); this._s = new THREE.Vector3(); this._dq = new THREE.Quaternion();
    this._c = new THREE.Color();
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < capacity; i++) { this.mesh.setMatrixAt(i, zero); this.mesh.setColorAt(i, this._c.set(0x66ffaa)); }
    this.mesh.instanceColor.needsUpdate = true;
    this.active = 0;
  }
  emit({ pos, vel, size = 0.2, life = 1.2, grav = 1, spin = 8, color }) {
    const p = this.p[this.next]; const i = this.next; this.next = (this.next + 1) % this.cap;
    p.alive = true; p.pos.copy(pos); p.vel.copy(vel); p.size = size; p.life = p.max = life * rand(0.8, 1.2); p.grav = grav; p.spin = spin * rand(0.5, 1.5);
    p.axis.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
    p.q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize());
    p.bounce = 0;
    const g = rand(0, 1);
    this.mesh.setColorAt(i, this._c.setRGB(lerpN(0.45, 0.85, g), 1, lerpN(0.7, 0.95, g)));
    this.mesh.instanceColor.needsUpdate = true;
  }
  update(dt) {
    const m = this._m;
    let any = false;
    for (let i = 0; i < this.cap; i++) {
      const p = this.p[i];
      if (!p.alive) continue;
      any = true;
      p.life -= dt;
      if (p.life <= 0) { p.alive = false; m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, m); continue; }
      p.vel.y -= 22 * p.grav * dt;
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < p.size * 0.15) {
        p.pos.y = p.size * 0.15;
        if (p.vel.y < 0) { p.vel.y *= -0.32; p.vel.x *= 0.7; p.vel.z *= 0.7; p.spin *= 0.6; p.bounce++; }
        if (p.bounce > 3) { p.vel.set(0, 0, 0); p.spin = 0; }
      }
      this._dq.setFromAxisAngle(p.axis, p.spin * dt); p.q.premultiply(this._dq);
      const k = clamp(p.life / (p.max * 0.35), 0, 1); // shrink away over the last 35% of life
      const s = p.size * (0.4 + 0.6 * k);
      m.compose(p.pos, p.q, this._s.set(s, s, s));
      this.mesh.setMatrixAt(i, m);
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
const lerpN = (a, b, t) => a + (b - a) * t;

/** Pooled soft sprites. additive=true -> energy glow; false -> dust. */
export class GlowSystem {
  constructor(scene, { capacity = 1400, additive = true, renderer } = {}) {
    this.cap = capacity; this.additive = additive;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(capacity * 3); this.size = new Float32Array(capacity); this.alpha = new Float32Array(capacity); this.col = new Float32Array(capacity * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    this.uniforms = { uScale: { value: 500 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: `attribute float aSize; attribute float aAlpha; attribute vec3 aColor; uniform float uScale; varying float vA; varying vec3 vC; varying float vF;
        void main(){ vA=aAlpha; vC=aColor; vec4 mv=modelViewMatrix*vec4(position,1.0); vF=clamp((-mv.z-0.7)/2.8,0.0,1.0); gl_PointSize=aSize*uScale/max(0.1,-mv.z); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `varying float vA; varying vec3 vC; varying float vF;
        void main(){ float d=length(gl_PointCoord-0.5)*2.0; if(d>1.0) discard; float a=pow(1.0-d,${additive ? '1.6' : '1.1'}); gl_FragColor=vec4(vC, a*vA*vF); }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.p = new Array(capacity).fill(0).map(() => ({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), size: 1, grow: 0, life: 0, max: 1, drag: 0, grav: 0, r: 1, g: 1, b: 1, a: 1 }));
    this.next = 0;
  }
  emit({ pos, vel = null, size = 0.3, grow = 0, life = 0.5, drag = 1.5, grav = 0, color = [0.4, 1, 0.65], alpha = 1 }) {
    const p = this.p[this.next]; this.next = (this.next + 1) % this.cap;
    p.alive = true; p.pos.copy(pos); if (vel) p.vel.copy(vel); else p.vel.set(0, 0, 0);
    p.size = size; p.grow = grow; p.life = p.max = life; p.drag = drag; p.grav = grav; p.r = color[0]; p.g = color[1]; p.b = color[2]; p.a = alpha;
  }
  update(dt, renderer, camera) {
    this.uniforms.uScale.value = renderer.domElement.height * 0.5 / Math.tan(camera.fov * Math.PI / 360);
    for (let i = 0; i < this.cap; i++) {
      const p = this.p[i];
      if (!p.alive) { this.alpha[i] = 0; continue; }
      p.life -= dt;
      if (p.life <= 0) { p.alive = false; this.alpha[i] = 0; continue; }
      p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt)); p.vel.y -= p.grav * dt;
      p.pos.addScaledVector(p.vel, dt); p.size = Math.max(0, p.size + p.grow * dt);
      const t = p.life / p.max;
      this.pos[i * 3] = p.pos.x; this.pos[i * 3 + 1] = p.pos.y; this.pos[i * 3 + 2] = p.pos.z;
      this.size[i] = p.size; this.alpha[i] = p.a * t * t * (this.additive ? 1 : 0.6);
      this.col[i * 3] = p.r; this.col[i * 3 + 1] = p.g; this.col[i * 3 + 2] = p.b;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = g.attributes.aSize.needsUpdate = g.attributes.aAlpha.needsUpdate = g.attributes.aColor.needsUpdate = true;
  }
}

/** Expanding shock rings + surface crack decals. */
export class SurfaceFX {
  constructor(scene) {
    this.scene = scene;
    this.rings = [];
    const rg = new THREE.RingGeometry(0.82, 1, 40);
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0x7dffc0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.visible = false; m.userData = { t: 0, dur: 0.35, size: 1 }; scene.add(m); this.rings.push(m);
    }
    this.rn = 0;
    // crack decal
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
    g.clearRect(0, 0, 256, 256); g.translate(128, 128);
    const rnd = mulberry32(42);
    g.strokeStyle = 'rgba(20,40,30,0.85)'; g.lineCap = 'round';
    for (let i = 0; i < 11; i++) {
      let a = (i / 11) * Math.PI * 2 + rnd() * 0.3, r = 6, x = 0, y = 0; g.lineWidth = 3.2; g.beginPath(); g.moveTo(0, 0);
      while (r < 120) { r += 14 + rnd() * 22; a += (rnd() - 0.5) * 0.5; x = Math.cos(a) * r; y = Math.sin(a) * r; g.lineTo(x, y); g.lineWidth = Math.max(0.8, g.lineWidth - 0.35); }
      g.stroke();
    }
    const rad = g.createRadialGradient(0, 0, 0, 0, 0, 60); rad.addColorStop(0, 'rgba(60,255,150,0.5)'); rad.addColorStop(1, 'rgba(60,255,150,0)');
    g.fillStyle = rad; g.beginPath(); g.arc(0, 0, 60, 0, 7); g.fill();
    this.decalTex = new THREE.CanvasTexture(c); this.decalTex.colorSpace = THREE.SRGBColorSpace;
    this.decals = []; this.dn = 0;
    const dg = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(dg, new THREE.MeshBasicMaterial({ map: this.decalTex, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
      m.visible = false; m.userData = { t: 0 }; scene.add(m); this.decals.push(m);
    }
    this._q = new THREE.Quaternion(); this._z = new THREE.Vector3(0, 0, 1);
  }
  ring(pos, normal, size = 1.6, dur = 0.35, color = 0x7dffc0) {
    const m = this.rings[this.rn]; this.rn = (this.rn + 1) % this.rings.length;
    m.position.copy(pos).addScaledVector(normal, 0.04); m.quaternion.setFromUnitVectors(this._z, normal);
    m.userData.t = 0; m.userData.dur = dur; m.userData.size = size; m.material.color.setHex(color); m.visible = true;
  }
  decal(pos, normal, size = 1.1) {
    const m = this.decals[this.dn]; this.dn = (this.dn + 1) % this.decals.length;
    m.position.copy(pos).addScaledVector(normal, 0.02); m.quaternion.setFromUnitVectors(this._z, normal); m.rotateZ(rand(0, 6.28));
    m.scale.setScalar(size); m.userData.t = 0; m.visible = true;
  }
  update(dt) {
    for (const m of this.rings) {
      if (!m.visible) continue;
      const u = m.userData; u.t += dt; const k = u.t / u.dur;
      if (k >= 1) { m.visible = false; continue; }
      m.scale.setScalar(u.size * (0.15 + 0.85 * (1 - Math.pow(1 - k, 3)))); m.material.opacity = 0.9 * (1 - k);
    }
    for (const m of this.decals) {
      if (!m.visible) continue;
      m.userData.t += dt; const t = m.userData.t;
      m.material.opacity = t < 3 ? 0.9 : Math.max(0, 0.9 * (1 - (t - 3) / 1.5));
      if (t > 4.5) m.visible = false;
    }
  }
}
