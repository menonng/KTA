// People: Microsoft Rocketbox avatars (MIT) rendered with GPU skinning from
// baked animation textures.
//
// Bodies, texture atlases and CMU motion clips come from
// tools/asset-pipeline/people/build_people.mjs. At load time each clip frame
// is turned into 20 bone matrices (forward kinematics from the variant's rest
// joints) and stored in a float texture: one row per frame, three texels
// (matrix rows) per bone. Every person is an instance; the vertex shader
// fetches the two frames it needs and blends them, so each variant/LOD is one
// draw call. Atlases: colour (sRGB, hair alpha) and normal (RG) + specular (B).

import * as THREE from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

export type Clip = 'walk' | 'run' | 'idle';

interface VariantInfo {
  verts: number;
  sex: 'm' | 'f';
  pivots: number[];
  pos: number;
  nrm: number;
  uv: number;
  skin: number;
  weight: number;
  lods: { count: number; idx: number }[];
  colour: string;
  normal: string;
}
interface Header {
  bones: string[];
  parents: number[];
  fps: number;
  variants: Record<string, VariantInfo>;
  clips: Record<Clip, { frames: number; variants: Record<string, { data: number; speed: number }> }>;
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
  readonly sex: 'm' | 'f';

  constructor(h: Header, bin: ArrayBuffer, readonly variant: string, readonly colour: THREE.Texture, readonly normal: THREE.Texture) {
    const v = h.variants[variant];
    this.sex = v.sex;
    const nv = v.verts;
    const g0 = new THREE.BufferGeometry();
    g0.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bin, v.pos, nv * 3), 3));
    g0.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(bin, v.nrm, nv * 4), 4, true));
    g0.setAttribute('uv', new THREE.BufferAttribute(new Uint16Array(bin, v.uv, nv * 2), 2, true));
    g0.setAttribute('aBones', new THREE.BufferAttribute(new Uint8Array(bin, v.skin, nv * 4), 4, false));
    g0.setAttribute('aWeights', new THREE.BufferAttribute(new Uint8Array(bin, v.weight, nv * 4), 4, true));
    for (const l of v.lods) {
      const g = g0.clone();
      g.setIndex(new THREE.BufferAttribute(new Uint16Array(bin, l.idx, l.count), 1));
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.2);
      this.lods.push(g);
    }
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

const SKIN_VS_PARS = /* glsl */ `
uniform sampler2D uAnim;
attribute vec4 aBones;
attribute vec4 aWeights;
attribute vec4 aAnimI;   // frame A row, frame B row, blend, brightness
varying float vShade;
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

function skinnedMaterial(kind: HumanKind): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ map: kind.colour, normalMap: kind.normal, roughness: 1, metalness: 0, alphaTest: 0.45, side: THREE.DoubleSide });
  mat.normalScale.set(1, 1);
  mat.defines = { USE_PACKED_NORMALMAP: '' };
  mat.onBeforeCompile = (s) => {
    s.uniforms.uAnim = { value: kind.anim };
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\n' + SKIN_VS_PARS)
      .replace('#include <beginnormal_vertex>', 'mat4 kM = kSkin();\nvShade = aAnimI.w;\nvec3 objectNormal = normalize(mat3(kM) * normal.xyz);\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3(tangent.xyz);\n#endif')
      .replace('#include <begin_vertex>', 'vec3 transformed = (kM * vec4(position, 1.0)).xyz;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vShade;')
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= vShade;')
      // Specular map (normal atlas blue) -> roughness.
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(0.9, 0.38, texture2D(normalMap, vNormalMapUv).b);');
  };
  mat.customProgramCacheKey = () => 'kta-person-1';
  return mat;
}

function skinnedDepth(kind: HumanKind): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: kind.colour, alphaTest: 0.45 });
  mat.onBeforeCompile = (s) => {
    s.uniforms.uAnim = { value: kind.anim };
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\n' + SKIN_VS_PARS)
      .replace('#include <begin_vertex>', 'mat4 kM = kSkin();\nvShade = aAnimI.w;\nvec3 transformed = (kM * vec4(position, 1.0)).xyz;');
  };
  mat.customProgramCacheKey = () => 'kta-person-depth-1';
  return mat;
}

/** One InstancedMesh per LOD for a variant; instances are written each frame. */
export class HumanLayer {
  readonly meshes: THREE.InstancedMesh[] = [];
  private anim: THREE.InstancedBufferAttribute[] = [];
  private n: number[];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3(1, 1, 1);
  private up = new THREE.Vector3(0, 1, 0);

  constructor(readonly kind: HumanKind, readonly cap: number, shadowLods = 2) {
    const mat = skinnedMaterial(kind);
    const depth = skinnedDepth(kind);
    kind.lods.forEach((g, li) => {
      const geo = g.clone();
      const anim = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aAnimI', anim);
      const mesh = new THREE.InstancedMesh(geo, mat, cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.castShadow = li < shadowLods;
      mesh.receiveShadow = true;
      mesh.customDepthMaterial = depth;
      this.meshes.push(mesh);
      this.anim.push(anim);
    });
    this.n = kind.lods.map(() => 0);
  }

  begin() {
    this.n.fill(0);
  }

  /** Add one person. rowA/rowB are animation texture rows, blend between them; scale = body size, shade = colour multiplier. */
  add(lod: number, x: number, y: number, z: number, yaw: number, rowA: number, rowB: number, blend: number, scale = 1, shade = 1) {
    const i = this.n[lod];
    if (i >= this.cap) return;
    this.n[lod] = i + 1;
    this.q.setFromAxisAngle(this.up, yaw);
    this.v.set(x, y, z);
    this.s.set(scale, scale, scale);
    this.m.compose(this.v, this.q, this.s);
    this.meshes[lod].setMatrixAt(i, this.m);
    this.anim[lod].setXYZW(i, rowA, rowB, blend, shade);
  }

  end() {
    this.meshes.forEach((mesh, l) => {
      mesh.count = this.n[l];
      mesh.visible = this.n[l] > 0;
      mesh.instanceMatrix.needsUpdate = true;
      this.anim[l].needsUpdate = true;
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

export interface PeopleKinds {
  hero: HumanKind;
  crowd: HumanKind[];
}

export async function loadHumans(renderer: THREE.WebGLRenderer): Promise<PeopleKinds> {
  const ktx2 = new KTX2Loader().setTranscoderPath('basis/').detectSupport(renderer);
  const [h, bin] = await Promise.all([fetch('models/people.json').then((r) => r.json() as Promise<Header>), fetch('models/people.bin').then((r) => r.arrayBuffer())]);
  const load = async (file: string) => {
    const t = await ktx2.loadAsync('textures/' + file);
    t.anisotropy = 4;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  };
  const names = Object.keys(h.variants);
  const tex = await Promise.all(names.flatMap((n) => [load(h.variants[n].colour), load(h.variants[n].normal)]));
  ktx2.dispose();
  const kinds = names.map((n, i) => new HumanKind(h, bin, n, tex[i * 2], tex[i * 2 + 1]));
  const hero = kinds.find((k) => k.variant === 'hero') ?? kinds[0];
  return { hero, crowd: kinds.filter((k) => k !== hero) };
}

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
  private kindOf: Uint8Array;
  private scaleOf: Float32Array;
  private shadeOf: Float32Array;
  private heroU = 0;
  private idleU = 0;
  private frustum = new THREE.Frustum();
  private pm = new THREE.Matrix4();
  private sphere = new THREE.Sphere();
  visible = 0;

  constructor(kinds: PeopleKinds, readonly count: number) {
    this.hero = new HumanLayer(kinds.hero, 1, 3);
    this.layers = kinds.crowd.map((k) => new HumanLayer(k, count));
    for (const l of [this.hero, ...this.layers]) for (const m of l.meshes) this.group.add(m);
    this.kindOf = new Uint8Array(count);
    this.scaleOf = new Float32Array(count);
    this.shadeOf = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const h = (k: number) => (Math.imul(i + 1 + k * 7919, 2654435761) >>> 0) / 4294967296;
      this.kindOf[i] = Math.floor(h(0) * this.layers.length) % this.layers.length;
      // Korean adults are a little shorter than the source avatars (1.80 m men, 1.74 m women).
      const female = kinds.crowd[this.kindOf[i]].sex === 'f';
      this.scaleOf[i] = (female ? 0.93 : 0.95) * (0.96 + 0.08 * h(1));
      this.shadeOf[i] = 0.9 + 0.2 * h(2);
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
    this.hero.add(0, px, 0, pz, yaw, a, b, bl);
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
      const lod = d < 14 ? 0 : d < 40 ? 1 : 2;
      const layer = this.layers[this.kindOf[i]];
      const u = crowd[o + 3] / (1.9 * layer.kind.stride.walk);
      const [ra, rb, f] = layer.rows('walk', u);
      layer.add(lod, x, 0, z, crowd[o + 2], ra, rb, f, this.scaleOf[i], this.shadeOf[i]);
      vis++;
    }
    for (const l of this.layers) l.end();
    this.visible = vis;
  }
}
