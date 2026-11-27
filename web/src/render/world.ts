// Buildings, roads, ground and subway entrances from the Rust core.
// Building facades (windows, shopfronts, colors, lit windows at night) are
// computed in the fragment shader, so the city uses no textures at all.

import * as THREE from 'three';
import type { Game } from '../wasm/kta_wasm.js';

const HASH = /* glsl */ `
// Sine-free hashes (stable for large inputs on all GPUs).
float kH1(float n) { n = fract(n * 0.1031); n *= n + 33.33; n *= n + n; return fract(n); }
float kH2(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
// Box-filtered periodic pulse (1 inside [a,b] of each unit period): kills
// aliasing of procedural windows at distance without textures or mipmaps.
float kPI(float x, float a, float b) { return floor(x) * (b - a) + clamp(fract(x), a, b) - a; }
float kPulse(float x, float a, float b, float w) {
  w = max(w, 1e-4);
  return clamp((kPI(x + 0.5 * w, a, b) - kPI(x - 0.5 * w, a, b)) / w, 0.0, 1.0);
}
`;

const FACADE = /* glsl */ `
float fU = vFacade.x * 0.01;
float fV = vFacade.y * 0.01;
float fSeed = floor(vFacadeId.x + 0.5);
float fKf = floor(vFacadeId.y + 0.5);
float fKind = mod(fKf, 16.0);
float fRoof = mod(floor(fKf / 16.0), 2.0);
float fH = floor(fKf / 32.0) * 0.5;
float floorH = 3.3;
float colW = 2.2 + kH1(fSeed * 2.1) * 1.8;
vec2 gp = vec2(fU / colW, fV / floorH);
vec2 gw = fwidth(gp);
float mw = 1.5 + kH1(fSeed * 7.7) * 1.5;
float mx = fU / mw;
float mwid = fwidth(mx);
float farF = smoothstep(0.22, 0.65, max(gw.x, gw.y));
float fRough = 0.88;
vec3 fEmis = vec3(0.0);
vec3 fCol;
if (fRoof > 0.5) {
  fCol = vec3(0.47, 0.47, 0.45) * (0.9 + 0.1 * kH1(fSeed * 1.9));
  if (kH1(fSeed * 3.7) > 0.86) fCol = vec3(0.28, 0.42, 0.30);
  else if (kH1(fSeed * 5.3) > 0.82) fCol = vec3(0.30, 0.45, 0.42);
} else {
  float r = kH1(fSeed * 1.37 + 3.1);
  vec3 wall;
  if (r < 0.18) wall = vec3(0.50, 0.26, 0.19);
  else if (r < 0.34) wall = vec3(0.80, 0.74, 0.62);
  else if (r < 0.50) wall = vec3(0.86, 0.86, 0.83);
  else if (r < 0.63) wall = vec3(0.58, 0.58, 0.56);
  else if (r < 0.72) wall = vec3(0.33, 0.34, 0.36);
  else if (r < 0.82) wall = vec3(0.82, 0.68, 0.61);
  else if (r < 0.91) wall = vec3(0.62, 0.53, 0.43);
  else wall = vec3(0.38, 0.48, 0.55);
  wall *= 0.92 + 0.08 * kH1(fSeed * 6.1);
  float winW = 0.40 + kH1(fSeed * 4.3) * 0.32;
  float winH = 0.40 + kH1(fSeed * 5.9) * 0.22;
  float band = kPulse(gp.y, 0.0, 0.035, gw.y);
  fCol = wall * (1.0 - 0.12 * band);
  bool shop = fKind != 1.0 || kH1(fSeed * 9.1) > 0.55;
  if (fV < 2.95 && shop) {
    float glass = (1.0 - kPulse(mx, 0.0, 0.035, mwid)) * step(0.22, fV) * step(fV, 2.78);
    vec3 g = vec3(0.09, 0.11, 0.13) + 0.05 * fV;
    fCol = mix(vec3(0.2, 0.2, 0.21), g, glass);
    fRough = mix(0.6, 0.12, glass);
    float lit = mix(step(0.2, kH1(floor(mx) + fSeed)), 0.8, farF);
    fEmis = vec3(1.0, 0.86, 0.64) * 0.6 * uNight * lit * glass;
  } else if (fV < floorH && shop) {
    fCol = wall * 0.72;
  } else if (fV >= floorH) {
    float cov = kPulse(gp.x, 0.5 - winW * 0.5, 0.5 + winW * 0.5, gw.x)
              * kPulse(gp.y, 0.3, 0.3 + winH, gw.y)
              * step(0.9, fH - fV);
    vec3 glassC = vec3(0.1, 0.12, 0.16);
    // Thin light frame only when windows are large on screen.
    float frame = (1.0 - farF) * (1.0 - kPulse(gp.x, 0.5 - winW * 0.42, 0.5 + winW * 0.42, gw.x)) * cov;
    fCol = mix(fCol, glassC, cov);
    fCol = mix(fCol, vec3(0.7), frame);
    fRough = mix(0.88, 0.12, cov);
    float wr = kH2(floor(gp) + fSeed * 0.37);
    vec3 warm = mix(vec3(1.0, 0.78, 0.5), vec3(0.72, 0.84, 1.0), step(0.86, wr));
    warm = mix(warm, vec3(0.95, 0.82, 0.62), farF);
    float lit = mix(step(0.52, wr) * (0.7 + 0.6 * kH1(wr * 10.0)), 0.45, farF);
    fEmis = warm * 0.5 * uNight * lit * (cov - frame);
  }
  if (fH - fV < 0.35) fCol = wall * 0.66;
  fCol *= mix(0.6, 1.0, smoothstep(0.0, 1.4, fV));
}
diffuseColor.rgb = fCol;
`;

const ROAD = /* glsl */ `
float rA = vRoad.x;
float rX = vRoad.y;
float rOne = step(15.5, vRoad.z);
float rK = mod(vRoad.z, 16.0);
float rHw = vRoad.w;
vec3 rc = vec3(0.15, 0.15, 0.16) * (0.94 + 0.06 * kH2(floor(vec2(rA, rX) * 0.25)));
if (rK > 8.5) {
  vec2 t = vec2(rA, rX) / 0.55;
  vec2 tw = fwidth(t);
  float jo = max(kPulse(t.x, 0.9, 1.0, tw.x), kPulse(t.y, 0.9, 1.0, tw.y));
  rc = mix(vec3(0.6, 0.58, 0.54), vec3(0.42, 0.41, 0.39), jo);
} else if (rK > 5.5 && rK < 6.5) {
  vec2 t = vec2(rA / 0.9, rX / 0.45);
  float ox = t.x + floor(t.y) * 0.5;
  vec2 tw = fwidth(t);
  float jo = max(kPulse(ox, 0.9, 1.0, tw.x), kPulse(t.y, 0.86, 1.0, tw.y));
  float far = smoothstep(0.3, 0.8, max(tw.x, tw.y));
  vec3 base = mix(vec3(0.52, 0.35, 0.29), vec3(0.62, 0.55, 0.47), mix(step(0.55, kH2(vec2(floor(ox), floor(t.y)))), 0.45, far));
  rc = mix(base, vec3(0.32, 0.28, 0.26), jo);
} else if (rK > 6.5 && rK < 7.5) {
  vec2 t = vec2(rA, rX) / 0.5;
  vec2 tw = fwidth(t);
  float jo = max(kPulse(t.x, 0.9, 1.0, tw.x), kPulse(t.y, 0.9, 1.0, tw.y));
  rc = mix(vec3(0.56, 0.55, 0.52), vec3(0.4, 0.4, 0.38), jo);
} else if (rK < 3.5 || rK > 7.5) {
  float ax = abs(rX);
  float edge = rHw - ax;
  vec3 yel = vec3(0.86, 0.64, 0.08);
  if (rOne < 0.5) {
    if (rK < 2.5 && ax > 0.08 && ax < 0.26) rc = yel;
    if (rK >= 2.5 && ax < 0.08 && fract(rA / 8.0) < 0.5) rc = yel;
    float lane = ax / 3.25;
    float lf = min(fract(lane), 1.0 - fract(lane));
    if (rK < 2.5 && ax > 1.2 && edge > 1.0 && lf < 0.035 && fract(rA / 9.0) < 0.5) rc = vec3(0.82);
  } else {
    float fromL = rX + rHw;
    float lane = fromL / 3.25;
    float lf = min(fract(lane), 1.0 - fract(lane));
    if (fromL > 1.0 && edge > 1.0 && lf < 0.035 && fract(rA / 9.0) < 0.5) rc = vec3(0.82);
    if (rHw - rX > 0.15 && rHw - rX < 0.3) rc = yel; // median-side edge
  }
  if (edge > 0.3 && edge < 0.45) rc = vec3(0.78);
}
diffuseColor.rgb = rc;
`;

export interface WorldStats {
  chunks: number;
  buildings: number;
  buildingTris: number;
  roadTris: number;
  gpuBytes: number;
}

function disposeArray(this: THREE.BufferAttribute) {
  // Free the CPU copy once the GPU has it (memory budget, plan 4.5).
  (this as unknown as { array: unknown }).array = null;
}

export function createBuildingMaterial(night: { value: number }) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, metalness: 0.0 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uNight = night;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aFacade;\nvarying vec2 vFacade;\nflat varying vec2 vFacadeId;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFacade = aFacade.xy;\nvFacadeId = aFacade.zw;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uNight;\nvarying vec2 vFacade;\nflat varying vec2 vFacadeId;\n${HASH}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FACADE}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = fRough;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += fEmis;');
  };
  m.customProgramCacheKey = () => 'kta-facade-3';
  return m;
}

export function createRoadMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0.0 });
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aRoad;\nvarying vec4 vRoad;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoad = aRoad;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec4 vRoad;\n${HASH}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${ROAD}`);
  };
  m.customProgramCacheKey = () => 'kta-road-3';
  return m;
}

export function buildWorld(game: Game, memory: WebAssembly.Memory, scene: THREE.Scene, night: { value: number }): WorldStats {
  const stats: WorldStats = { chunks: 0, buildings: 0, buildingTris: 0, roadTris: 0, gpuBytes: 0 };
  const bmat = createBuildingMaterial(night);
  const n = game.chunk_count();
  for (let i = 0; i < n; i++) {
    const d = game.chunk_desc(i);
    const buf = memory.buffer;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(buf, d[0], d[1]).slice();
    const nrm = new Int8Array(buf, d[2], d[3]).slice();
    const att = new Uint16Array(buf, d[4], d[5]).slice();
    const idx = new Uint16Array(buf, d[6], d[7]).slice();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).onUpload(disposeArray));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3, true).onUpload(disposeArray));
    g.setAttribute('aFacade', new THREE.BufferAttribute(att, 4).onUpload(disposeArray));
    g.setIndex(new THREE.BufferAttribute(idx, 1).onUpload(disposeArray));
    const b = game.chunk_bounds(i);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(b[0], b[1], b[2]), b[3]);
    g.boundingBox = new THREE.Box3(
      new THREE.Vector3(b[0] - b[3], 0, b[2] - b[3]),
      new THREE.Vector3(b[0] + b[3], b[1] + b[3], b[2] + b[3]),
    );
    const mesh = new THREE.Mesh(g, bmat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    scene.add(mesh);
    stats.chunks++;
    stats.buildings += d[8];
    stats.buildingTris += d[7] / 3;
    stats.gpuBytes += pos.byteLength + nrm.byteLength + att.byteLength + idx.byteLength;
  }

  // Roads + sidewalks (one mesh).
  const r = game.roads_desc();
  const buf = memory.buffer;
  const rg = new THREE.BufferGeometry();
  const rpos = new Float32Array(buf, r[0], r[1]).slice();
  const ratt = new Float32Array(buf, r[2], r[3]).slice();
  const ridx = new Uint32Array(buf, r[4], r[5]).slice();
  rg.setAttribute('position', new THREE.BufferAttribute(rpos, 3));
  const up = new Int8Array((rpos.length / 3) * 3);
  for (let i = 1; i < up.length; i += 3) up[i] = 127;
  rg.setAttribute('normal', new THREE.BufferAttribute(up, 3, true).onUpload(disposeArray));
  rg.setAttribute('aRoad', new THREE.BufferAttribute(ratt, 4).onUpload(disposeArray));
  rg.setIndex(new THREE.BufferAttribute(ridx, 1).onUpload(disposeArray));
  rg.computeBoundingSphere();
  (rg.getAttribute('position') as THREE.BufferAttribute).onUpload(disposeArray);
  const roads = new THREE.Mesh(rg, createRoadMaterial());
  roads.receiveShadow = true;
  roads.matrixAutoUpdate = false;
  scene.add(roads);
  stats.roadTris = ridx.length / 3;
  stats.gpuBytes += rpos.byteLength + ratt.byteLength + ridx.byteLength + up.byteLength;

  game.free_meshes();

  // Ground.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(3200, 3200).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(0.34, 0.34, 0.33), roughness: 1 }),
  );
  ground.receiveShadow = true;
  ground.matrixAutoUpdate = false;
  scene.add(ground);

  scene.add(buildSkylineFiller(night));
  return stats;
}

/** Low-detail city ring beyond the data area so the horizon is not empty. */
function buildSkylineFiller(night: { value: number }): THREE.InstancedMesh {
  const count = 900;
  const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a8d92, roughness: 0.9 });
  mat.onBeforeCompile = (s) => {
    s.uniforms.uNight = night;
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(0.9, 0.75, 0.5) * 0.12 * uNight;');
  };
  const inst = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2;
    const d = 620 + rnd() * 520;
    const w = 18 + rnd() * 30;
    const h = 12 + Math.pow(rnd(), 2) * 70;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI);
    m.compose(new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d), q, new THREE.Vector3(w, h, w * (0.6 + rnd())));
    inst.setMatrixAt(i, m);
  }
  inst.frustumCulled = false;
  return inst;
}

/** Subway entrance canopies (instanced) — returns sign descriptors to add. */
export function buildEntrances(game: Game, scene: THREE.Scene): { x: number; z: number; yaw: number; no: number }[] {
  const e = game.entrances();
  const list: { x: number; z: number; yaw: number; no: number }[] = [];
  for (let i = 0; i < e.length; i += 4) list.push({ x: e[i], z: e[i + 1], yaw: e[i + 2], no: e[i + 3] });
  const steel = new THREE.MeshStandardMaterial({ color: 0xb8bfc4, roughness: 0.45, metalness: 0.4 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fc4d4, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.32, depthWrite: false });
  const stairs = new THREE.MeshStandardMaterial({ color: 0x3a3b3d, roughness: 0.9 });
  const parts: { geo: THREE.BufferGeometry; mat: THREE.Material; shadow: boolean }[] = [
    { geo: new THREE.BoxGeometry(2.9, 0.14, 4.7).translate(0, 2.75, 0), mat: steel, shadow: true },
    { geo: new THREE.BoxGeometry(0.1, 2.7, 0.1).translate(1.38, 1.35, -2.25), mat: steel, shadow: true },
    { geo: new THREE.BoxGeometry(0.1, 2.7, 0.1).translate(-1.38, 1.35, -2.25), mat: steel, shadow: true },
    { geo: new THREE.BoxGeometry(0.06, 2.6, 4.4).translate(1.38, 1.35, 0), mat: glass, shadow: false },
    { geo: new THREE.BoxGeometry(0.06, 2.6, 4.4).translate(-1.38, 1.35, 0), mat: glass, shadow: false },
    { geo: new THREE.BoxGeometry(2.8, 2.6, 0.06).translate(0, 1.35, 2.2), mat: glass, shadow: false },
    { geo: new THREE.BoxGeometry(2.6, 0.06, 4.3).translate(0, 0.09, 0), mat: stairs, shadow: false },
  ];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (const p of parts) {
    const inst = new THREE.InstancedMesh(p.geo, p.mat, list.length);
    list.forEach((en, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), en.yaw);
      m.compose(new THREE.Vector3(en.x, 0, en.z), q, new THREE.Vector3(1, 1, 1));
      inst.setMatrixAt(i, m);
    });
    inst.castShadow = p.shadow;
    inst.receiveShadow = true;
    scene.add(inst);
  }
  return list;
}
