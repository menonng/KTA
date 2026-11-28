// People rendered with GPU skinning from baked animation textures.
//
// Bodies, textures and CMU motion clips come from
// tools/asset-pipeline/build_humans.mjs (MakeHuman CC0 base mesh). At load
// time each clip frame is turned into 20 bone matrices (forward kinematics
// from the body's rest joints) and stored in a float texture: one row per
// frame, three texels (matrix rows) per bone. Every person is an instance;
// the vertex shader fetches the two frames it needs and blends them, so a
// whole crowd variant/LOD is one draw call.
//
// The protagonist's texture holds final colours (sRGB) and roughness. Crowd
// textures hold luminance detail plus masks (top, bottom, shoes/hair) that
// mix per-person palette colours, so one body gives many outfits. Eyes use
// MakeHuman's iris texture; long hair is alpha-tested strand cards.

import * as THREE from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

export type Variant = 'hero' | 'man' | 'woman';
export type Clip = 'walk' | 'run' | 'idle';

interface Header {
  bones: string[];
  parents: number[];
  fps: number;
  variants: Record<Variant, { verts: number; pivots: number[]; pos: number; nrm: number; uv: number; skin: number; weight: number; info: number; lods: { count: number; idx: number }[]; texture: string; detail: string; tinted: boolean }>;
  clips: Record<Clip, { frames: number; variants: Record<Variant, { data: number; speed: number }> }>;
}

export interface Palette {
  skin: number;
  top: number;
  bottom: number;
  shoes: number;
  hair: number;
  /** Roughness of the top (nylon padding is glossy, wool is not). */
  topRough: number;
}

/** Per-variant GPU data: geometry per LOD, textures, animation texture, clip offsets. */
export class HumanKind {
  readonly lods: THREE.BufferGeometry[] = [];
  readonly anim: THREE.DataTexture;
  readonly clipRow: Record<Clip, number> = { walk: 0, run: 0, idle: 0 };
  readonly clipFrames: Record<Clip, number> = { walk: 0, run: 0, idle: 0 };
  /** Natural travel speed (m/s) and stride length (m per cycle) of each clip. */
  readonly speed: Record<Clip, number> = { walk: 0, run: 0, idle: 0 };
  readonly stride: Record<Clip, number> = { walk: 1, run: 1, idle: 1 };
  readonly tinted: boolean;

  constructor(h: Header, bin: ArrayBuffer, readonly variant: Variant, readonly body: THREE.Texture, readonly detail: THREE.Texture, readonly misc: THREE.Texture) {
    const v = h.variants[variant];
    this.tinted = v.tinted;
    const nv = v.verts;
    const g0 = new THREE.BufferGeometry();
    g0.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bin, v.pos, nv * 3), 3));
    g0.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(bin, v.nrm, nv * 4), 4, true));
    g0.setAttribute('aUv', new THREE.BufferAttribute(new Uint16Array(bin, v.uv, nv * 2), 2, true));
    g0.setAttribute('aBones', new THREE.BufferAttribute(new Uint8Array(bin, v.skin, nv * 4), 4, false));
    g0.setAttribute('aWeights', new THREE.BufferAttribute(new Uint8Array(bin, v.weight, nv * 4), 4, true));
    g0.setAttribute('aInfo', new THREE.BufferAttribute(new Uint8Array(bin, v.info, nv * 4), 4, true));
    for (const l of v.lods) {
      const g = g0.clone();
      g.setIndex(new THREE.BufferAttribute(new Uint16Array(bin, l.idx, l.count), 1));
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.2);
      this.lods.push(g);
    }
    // Animation texture.
    const nb = h.bones.length;
    const clips = Object.keys(h.clips) as Clip[];
    const rows = clips.reduce((s, c) => s + h.clips[c].frames, 0);
    const tex = new Float32Array(rows * nb * 3 * 4);
    const piv = v.pivots;
    const W: THREE.Matrix4[] = new Array(nb);
    const P: THREE.Vector3[] = new Array(nb);
    const q = new THREE.Quaternion();
    let row = 0;
    for (const c of clips) {
      const cl = h.clips[c];
      const cv = cl.variants[variant];
      this.clipRow[c] = row;
      this.clipFrames[c] = cl.frames;
      this.speed[c] = cv.speed;
      this.stride[c] = Math.max(0.1, cv.speed * (cl.frames / h.fps));
      const data = new Float32Array(bin, cv.data, cl.frames * (3 + nb * 4));
      for (let f = 0; f < cl.frames; f++, row++) {
        const o = f * (3 + nb * 4);
        for (let b = 0; b < nb; b++) {
          q.set(data[o + 3 + b * 4], data[o + 4 + b * 4], data[o + 5 + b * 4], data[o + 6 + b * 4]);
          W[b] = new THREE.Matrix4().makeRotationFromQuaternion(q);
          const p = h.parents[b];
          const rest = new THREE.Vector3(piv[b * 3], piv[b * 3 + 1], piv[b * 3 + 2]);
          if (p < 0) P[b] = rest.clone().add(new THREE.Vector3(data[o], data[o + 1], data[o + 2]));
          else P[b] = rest.clone().sub(new THREE.Vector3(piv[p * 3], piv[p * 3 + 1], piv[p * 3 + 2])).applyMatrix4(W[p]).add(P[p]);
          // M = [W | P - W * rest]
          const t = rest.clone().applyMatrix4(W[b]);
          const e = W[b].elements; // column-major
          const k = (row * nb * 3 + b * 3) * 4;
          tex.set([e[0], e[4], e[8], P[b].x - t.x], k);
          tex.set([e[1], e[5], e[9], P[b].y - t.y], k + 4);
          tex.set([e[2], e[6], e[10], P[b].z - t.z], k + 8);
        }
      }
    }
    this.anim = new THREE.DataTexture(tex, nb * 3, rows, THREE.RGBAFormat, THREE.FloatType);
    this.anim.needsUpdate = true;
  }
}

// Bump from the detail texture's height (cloth weave, ribs, quilting, folds, pores).
const BUMP_FS = /* glsl */ `
if (vKind < 0.5) {
  vec2 dx = dFdx(vKUv);
  vec2 dy = dFdy(vKUv);
  float h0 = texture2D(uDetail, vKUv).r;
  vec2 dh = vec2(texture2D(uDetail, vKUv + dx).r - h0, texture2D(uDetail, vKUv + dy).r - h0);
  normal = kPerturb(-vViewPosition, normal, dh * uBump * (1.0 - 0.6 * kSkinMask), faceDirection);
}
`;

// Skin: light scattered under the surface comes back reddish and softens the shading.
const SSS_FS = /* glsl */ `
reflectedLight.indirectDiffuse += kSkinMask * (reflectedLight.directDiffuse * vec3(0.16, 0.05, 0.025) + reflectedLight.indirectDiffuse * vec3(0.12, 0.035, 0.02));
reflectedLight.indirectDiffuse *= vAO;
reflectedLight.indirectSpecular *= vAO;
`;

const SKIN_VS_PARS = /* glsl */ `
uniform sampler2D uAnim;
attribute vec4 aBones;
attribute vec4 aWeights;
attribute vec4 aInfo;    // kind (0 body, 1 eye, 2 hair card) / 255, ambient occlusion, head flag
attribute vec2 aUv;
attribute vec4 aAnimI;   // frame A row, frame B row, blend, top roughness
attribute vec4 aColA;    // skin, top, bottom, shoes (packed RGB)
attribute vec4 aColB;    // hair, -, -, -
mat4 kBone(float row, float bone) {
  ivec2 c = ivec2(int(bone) * 3, int(row));
  vec4 r0 = texelFetch(uAnim, c, 0);
  vec4 r1 = texelFetch(uAnim, c + ivec2(1, 0), 0);
  vec4 r2 = texelFetch(uAnim, c + ivec2(2, 0), 0);
  return mat4(vec4(r0.x, r1.x, r2.x, 0.0), vec4(r0.y, r1.y, r2.y, 0.0), vec4(r0.z, r1.z, r2.z, 0.0), vec4(r0.w, r1.w, r2.w, 1.0));
}
mat4 kSkin() {
  mat4 m = mat4(0.0);
  for (int i = 0; i < 4; i++) {
    float w = aWeights[i];
    if (w <= 0.0) continue;
    m += w * ((1.0 - aAnimI.z) * kBone(aAnimI.x, aBones[i]) + aAnimI.z * kBone(aAnimI.y, aBones[i]));
  }
  return m;
}
`;

const COLOR_VS = /* glsl */ `
varying vec2 vKUv;
varying float vKind;
varying float vAO;
varying float vHead;
varying float vTopRough;
varying vec3 vSkinC;
varying vec3 vTopC;
varying vec3 vBotC;
varying vec3 vShoeC;
varying vec3 vHairC;
vec3 kUnpack(float f) {
  float r = floor(f / 65536.0);
  float g = floor((f - r * 65536.0) / 256.0);
  float b = f - r * 65536.0 - g * 256.0;
  return pow(vec3(r, g, b) / 255.0, vec3(2.2));
}
`;

const COLOR_ASSIGN = /* glsl */ `
vKUv = aUv;
vKind = aInfo.x * 255.0;
vAO = aInfo.y;
vHead = aInfo.z;
vTopRough = aAnimI.w;
vSkinC = kUnpack(aColA.x);
vTopC = kUnpack(aColA.y);
vBotC = kUnpack(aColA.z);
vShoeC = kUnpack(aColA.w);
vHairC = kUnpack(aColB.x);
`;

const COLOR_FS = /* glsl */ `
uniform sampler2D uBody;
uniform sampler2D uDetail;
uniform float uBump;
float kSkinMask = 0.0;
vec3 kPerturb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir) {
  vec3 vSigmaX = normalize(dFdx(surf_pos));
  vec3 vSigmaY = normalize(dFdy(surf_pos));
  vec3 R1 = cross(vSigmaY, surf_norm);
  vec3 R2 = cross(surf_norm, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDir;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}
uniform sampler2D uMisc;
uniform float uTinted;
varying vec2 vKUv;
varying float vKind;
varying float vAO;
varying float vHead;
varying float vTopRough;
varying vec3 vSkinC;
varying vec3 vTopC;
varying vec3 vBotC;
varying vec3 vShoeC;
varying vec3 vHairC;
float kRough = 0.5;
`;

const COLOR_PICK = /* glsl */ `
{
  vec3 kc;
  if (vKind < 0.5) {
    vec4 t = texture2D(uBody, vKUv);
    if (uTinted < 0.5) {
      kc = t.rgb;
      kRough = t.a;
    } else {
      vec3 tint = vSkinC;
      tint = mix(tint, vTopC, t.g);
      tint = mix(tint, vBotC, t.b);
      tint = mix(tint, vHead > 0.5 ? vHairC : vShoeC, t.a);
      kc = tint * t.r * 2.0;
      kRough = mix(mix(0.5, vTopRough, t.g), 0.85, t.b);
      kRough = mix(kRough, vHead > 0.5 ? 0.55 : 0.45, t.a);
    }
    kSkinMask = texture2D(uDetail, vKUv).g;
  } else if (vKind < 1.5) {
    kc = texture2D(uMisc, vec2(vKUv.x * 0.5, vKUv.y)).rgb * 0.85;
    kRough = 0.1;
  } else {
    vec4 t = texture2D(uMisc, vec2(0.5 + vKUv.x * 0.5, vKUv.y));
    if (t.a < 0.5) discard;
    kc = vHairC * t.r * 1.8;
    kRough = 0.5;
  }
  diffuseColor.rgb = kc * mix(1.0, vAO, 0.3);
}
`;

function skinnedMaterial(kind: HumanKind): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
  mat.onBeforeCompile = (s) => {
    s.uniforms.uAnim = { value: kind.anim };
    s.uniforms.uBody = { value: kind.body };
    s.uniforms.uMisc = { value: kind.misc };
    s.uniforms.uDetail = { value: kind.detail };
    s.uniforms.uBump = { value: kind.variant === 'hero' ? 2.4 : 2.0 };
    s.uniforms.uTinted = { value: kind.tinted ? 1 : 0 };
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\n' + SKIN_VS_PARS + COLOR_VS)
      .replace('#include <beginnormal_vertex>', 'mat4 kM = kSkin();\nvec3 objectNormal = normalize(mat3(kM) * normal.xyz);\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3(tangent.xyz);\n#endif\n' + COLOR_ASSIGN)
      .replace('#include <begin_vertex>', 'vec3 transformed = (kM * vec4(position, 1.0)).xyz;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\n' + COLOR_FS)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + COLOR_PICK)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = kRough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + BUMP_FS)
      .replace('#include <aomap_fragment>', SSS_FS);
  };
  mat.customProgramCacheKey = () => 'kta-human3-' + kind.variant;
  return mat;
}

function skinnedDepth(kind: HumanKind): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  mat.onBeforeCompile = (s) => {
    s.uniforms.uAnim = { value: kind.anim };
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\n' + SKIN_VS_PARS)
      .replace('#include <begin_vertex>', 'mat4 kM = kSkin();\nvec3 transformed = (kM * vec4(position, 1.0)).xyz;');
  };
  mat.customProgramCacheKey = () => 'kta-human2-depth-' + kind.variant;
  return mat;
}

/** One InstancedMesh per LOD for a body variant; instances are written each frame. */
export class HumanLayer {
  readonly meshes: THREE.InstancedMesh[] = [];
  private anim: THREE.InstancedBufferAttribute[] = [];
  private colA: THREE.InstancedBufferAttribute[] = [];
  private colB: THREE.InstancedBufferAttribute[] = [];
  private n: number[];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  private up = new THREE.Vector3(0, 1, 0);

  constructor(readonly kind: HumanKind, readonly cap: number, shadowLods = 2) {
    const mat = skinnedMaterial(kind);
    const depth = skinnedDepth(kind);
    kind.lods.forEach((g, li) => {
      const geo = g.clone();
      const anim = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
      const ca = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
      const cb = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aAnimI', anim);
      geo.setAttribute('aColA', ca);
      geo.setAttribute('aColB', cb);
      const mesh = new THREE.InstancedMesh(geo, mat, cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = li < shadowLods;
      mesh.receiveShadow = true;
      mesh.customDepthMaterial = depth;
      this.meshes.push(mesh);
      this.anim.push(anim);
      this.colA.push(ca);
      this.colB.push(cb);
    });
    this.n = kind.lods.map(() => 0);
  }

  begin() {
    this.n.fill(0);
  }

  /** Add one person. rowA/rowB are animation texture rows, blend between them. */
  add(lod: number, x: number, y: number, z: number, yaw: number, rowA: number, rowB: number, blend: number, pal: Palette) {
    const i = this.n[lod];
    if (i >= this.cap) return;
    this.n[lod] = i + 1;
    this.q.setFromAxisAngle(this.up, yaw);
    this.v.set(x, y, z);
    this.m.compose(this.v, this.q, this.one);
    this.meshes[lod].setMatrixAt(i, this.m);
    this.anim[lod].setXYZW(i, rowA, rowB, blend, pal.topRough);
    this.colA[lod].setXYZW(i, pal.skin, pal.top, pal.bottom, pal.shoes);
    this.colB[lod].setXYZW(i, pal.hair, 0, 0, 0);
  }

  end() {
    this.meshes.forEach((mesh, l) => {
      mesh.count = this.n[l];
      mesh.instanceMatrix.needsUpdate = true;
      this.anim[l].needsUpdate = true;
      this.colA[l].needsUpdate = true;
      this.colB[l].needsUpdate = true;
    });
  }

  /** Texture rows and blend for a looping clip at cycle position `u` (0..1). */
  rows(clip: Clip, u: number): [number, number, number] {
    const n = this.kind.clipFrames[clip];
    const f = (((u % 1) + 1) % 1) * n;
    const a = Math.floor(f) % n;
    return [this.kind.clipRow[clip] + a, this.kind.clipRow[clip] + ((a + 1) % n), f - Math.floor(f)];
  }
}

export async function loadHumans(renderer: THREE.WebGLRenderer): Promise<Record<Variant, HumanKind>> {
  const ktx2 = new KTX2Loader().setTranscoderPath('basis/').detectSupport(renderer);
  const [h, bin] = await Promise.all([fetch('models/humans.json').then((r) => r.json() as Promise<Header>), fetch('models/humans.bin').then((r) => r.arrayBuffer())]);
  const load = async (file: string) => {
    const t = await ktx2.loadAsync('textures/' + file);
    t.anisotropy = 4;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  };
  const vs: Variant[] = ['hero', 'man', 'woman'];
  const [misc, ...tex] = await Promise.all([load('human_misc.ktx2'), ...vs.flatMap((v) => [load(h.variants[v].texture), load(h.variants[v].detail)])]);
  ktx2.dispose();
  const kinds = {} as Record<Variant, HumanKind>;
  vs.forEach((v, i) => (kinds[v] = new HumanKind(h, bin, v, tex[i * 2], tex[i * 2 + 1], misc)));
  return kinds;
}

// ------------------------------------------------------------------ palettes
const SKINS_KR = [0xe7c3a5, 0xe0b694, 0xd9ad8b, 0xcfa07d, 0xc49372];
// Late-November Seoul: padded jackets, mostly black, then navy, grey, beige, white, khaki.
const PADDING = [0x17181b, 0x17181b, 0x17181b, 0x1c1e23, 0x262b3d, 0x34383f, 0xcdbb9f, 0xe6e4de, 0x4d4d3c, 0x5c3c37, 0x8b9097];
const BOTTOMS = [0x1d2534, 0x2b3651, 0x16171b, 0x3c3f46, 0x6e7074, 0x27282c, 0x4b5b79];
const SHOES = [0xf0f0ee, 0xf0f0ee, 0x16171b, 0x2b2521, 0x8b9097, 0xd9d3c5];
const HAIR = [0x0f0d0c, 0x161210, 0x1e1813, 0x2b2119, 0x3c2c20];

export function crowdPalette(seed: number): Palette {
  let s = (seed * 2654435761) >>> 0;
  const r = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const pick = (a: number[]) => a[Math.floor(r() * a.length)];
  return { skin: pick(SKINS_KR), top: pick(PADDING), bottom: pick(BOTTOMS), shoes: pick(SHOES), hair: pick(HAIR), topRough: 0.3 + r() * 0.2 };
}

/** The protagonist's colours are in his texture (white tank top, jeans, white trainers). */
export const HERO_PALETTE: Palette = { skin: 0x5c3a2a, top: 0xffffff, bottom: 0xffffff, shoes: 0xffffff, hair: 0x101010, topRough: 0.9 };

// ------------------------------------------------------------------ scene layer
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The protagonist plus the crowd (pedestrians from the Rust core), with distance LODs. */
export class People {
  readonly group = new THREE.Group();
  private hero: HumanLayer;
  private layers: HumanLayer[];
  private pal: Palette[] = [];
  private kindOf: Uint8Array;
  private heroU = 0;
  private idleU = 0;
  private frustum = new THREE.Frustum();
  private pm = new THREE.Matrix4();
  private sphere = new THREE.Sphere();
  visible = 0;

  constructor(kinds: Record<Variant, HumanKind>, readonly count: number) {
    this.hero = new HumanLayer(kinds.hero, 1, 3);
    this.layers = [new HumanLayer(kinds.man, count), new HumanLayer(kinds.woman, count)];
    for (const l of [this.hero, ...this.layers]) for (const m of l.meshes) this.group.add(m);
    this.kindOf = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      const h = (Math.imul(i + 1, 2654435761) >>> 0) / 4294967296;
      this.kindOf[i] = h < 0.52 ? 1 : 0;
      this.pal.push(crowdPalette(i + 11));
    }
  }

  update(dt: number, px: number, pz: number, yaw: number, speed: number, crowd: Float32Array, camera: THREE.Camera) {
    // Protagonist: idle / walk / run blended by speed, gait cycles kept in step.
    const k = this.hero.kind;
    const wMove = smooth(0.08, 0.6, speed);
    const wRun = smooth(2.2, 4.4, speed);
    const stride = k.stride.walk + (k.stride.run - k.stride.walk) * wRun;
    this.heroU = (this.heroU + (speed * dt) / stride) % 1;
    this.idleU = (this.idleU + dt / (k.clipFrames.idle / 30)) % 1;
    let a: number, b: number, bl: number;
    if (wRun > 0.999) [a, b, bl] = this.hero.rows('run', this.heroU);
    else if (wRun > 0.001) {
      [a] = this.hero.rows('walk', this.heroU);
      [b] = this.hero.rows('run', this.heroU);
      bl = wRun;
    } else if (wMove < 0.999) {
      [a] = this.hero.rows('idle', this.idleU);
      [b] = this.hero.rows('walk', this.heroU);
      bl = wMove;
    } else [a, b, bl] = this.hero.rows('walk', this.heroU);
    this.hero.begin();
    this.hero.add(0, px, 0, pz, yaw, a, b, bl, HERO_PALETTE);
    this.hero.end();

    // Crowd.
    this.pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pm);
    const cx = camera.position.x;
    const cz = camera.position.z;
    for (const l of this.layers) l.begin();
    let vis = 0;
    for (let i = 0; i < this.count; i++) {
      const o = i * 4;
      const x = crowd[o];
      const z = crowd[o + 1];
      this.sphere.center.set(x, 0.9, z);
      this.sphere.radius = 1.1;
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      const d = Math.hypot(x - cx, z - cz);
      if (d > 160) continue;
      const lod = d < 13 ? 0 : d < 38 ? 1 : 2;
      const layer = this.layers[this.kindOf[i]];
      const u = crowd[o + 3] / (1.9 * layer.kind.stride.walk);
      const [ra, rb, f] = layer.rows('walk', u);
      layer.add(lod, x, 0, z, crowd[o + 2], ra, rb, f, this.pal[i]);
      vis++;
    }
    for (const l of this.layers) l.end();
    this.visible = vis;
  }
}
