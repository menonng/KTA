// Instanced CC0 models (Poly Haven, built by tools/asset-pipeline): outdoor
// AC units, street cabinets, plastic chairs, crates, manhole covers, roller
// shutters and covered cars. One InstancedMesh per model part; instances come
// in sets (a prop cell streamed by PropStreamer, or a static set such as the
// shop-front furniture) and the meshes are rebuilt only when a set changes.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { kitMaterials, parasol, shelter, smartShelter, speciesTrees, stopPole, type StreetKitMats } from './streetkit';

/** Same order as the M_* model ids in crates/kta-core/src/props.rs (trees: M_TREE + species). */
export const MODEL_NAMES = [
  'aircon', 'powerbox', 'chair', 'crate', 'manhole', 'shutter', 'coveredcar',
  'tree', 'tree_plane', 'tree_zelkova', 'tree_fringe', 'tree_cherry', 'tree_pagoda', 'tree_pine', 'tree_maple', 'tree_other',
  'shelter', 'smartshelter', 'stoppole', 'parasol',
] as const;
const TREES = 7;
const N_TREES = 9;
const isTree = (m: number) => m >= TREES && m < TREES + N_TREES;
export const MODEL = Object.fromEntries(MODEL_NAMES.map((n, i) => [n, i])) as Record<(typeof MODEL_NAMES)[number], number>;

// Only the larger pieces cast shadows; small ones would double their cost.
const CASTS = new Set<number>([MODEL.powerbox, MODEL.coveredcar, ...Array.from({ length: N_TREES }, (_, i) => TREES + i), MODEL.shelter, MODEL.smartshelter]);
/** Draw distance per model (m): small pieces are invisible beyond this anyway. */
const RANGE = [72, 170, 55, 50, 90, 140, 190, ...Array(N_TREES).fill(230), 160, 220, 90, 110];

export interface ModelInst {
  m: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  sx: number;
  sy: number;
  sz: number;
  color?: number;
}

interface Part {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  local: THREE.Matrix4;
  mesh: THREE.InstancedMesh | null;
}

export class ModelLayer {
  readonly group = new THREE.Group();
  private parts: Part[][] = MODEL_NAMES.map(() => []);
  private sets = new Map<string, ModelInst[]>();
  private dirty = new Set<number>();
  private full: ModelInst[][] = MODEL_NAMES.map(() => []);
  private cullAt = { x: 1e9, z: 1e9 };
  private recull = new Set<number>();
  private loaded = false;
  private kit: StreetKitMats = kitMaterials();
  texBytes = 0;
  instances = 0;

  constructor(private renderer: THREE.WebGLRenderer) {
    this.group.matrixAutoUpdate = false;
  }

  async load() {
    const ktx2 = new KTX2Loader().setTranscoderPath('basis/').detectSupport(this.renderer);
    const loader = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
    const seen = new Set<THREE.Texture>();
    const I = new THREE.Matrix4();
    const asParts = (kp: { geo: THREE.BufferGeometry; mat: THREE.Material }[]): Part[] => kp.map((k) => ({ geo: k.geo, mat: k.mat, local: I, mesh: null }));
    const kitBuilders: Record<string, (m: StreetKitMats) => { geo: THREE.BufferGeometry; mat: THREE.Material }[]> = {
      shelter,
      smartshelter: smartShelter,
      stoppole: stopPole,
      parasol,
    };
    const treeTex = Promise.all(['tree_cards', 'tree_bark_sp', 'tree_bark_n'].map((n) => ktx2.loadAsync(`textures/${n}.ktx2`))).then(([c, b, n]) => speciesTrees(c, b, n));
    await Promise.all(
      MODEL_NAMES.map(async (name, mi) => {
        if (isTree(mi)) {
          this.parts[mi] = asParts((await treeTex)[mi - TREES]);
          return;
        }
        if (kitBuilders[name]) {
          this.parts[mi] = asParts(kitBuilders[name](this.kit));
          return;
        }
        const gltf = await loader.loadAsync(`models/${name}.glb`);
        gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const mat = mesh.material as THREE.MeshStandardMaterial;
          for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap'] as const) {
            const t = mat[key] as THREE.Texture | null;
            if (!t || seen.has(t)) continue;
            seen.add(t);
            const mm = (t as THREE.CompressedTexture).mipmaps as unknown as { data: Uint8Array }[] | undefined;
            if (mm) this.texBytes += mm.reduce((s, m) => s + (m.data?.byteLength ?? 0), 0);
            // Free the CPU copy once the GPU has it.
            t.onUpdate = () => {
              if (mm) for (const m of mm) m.data = new Uint8Array(0);
            };
          }
          if (mat.alphaTest > 0) mat.side = THREE.DoubleSide;
          mesh.geometry.computeBoundingSphere();
          this.parts[mi].push({ geo: mesh.geometry, mat, local: mesh.matrixWorld.clone(), mesh: null });
        });
      }),
    );
    ktx2.dispose();
    this.loaded = true;
    for (let i = 0; i < MODEL_NAMES.length; i++) this.dirty.add(i);
    this.flush();
  }

  /** Night level 0..1: lights of shelters, displays and adverts. */
  setNight(v: number) {
    this.kit.light.emissiveIntensity = 0.25 + 1.5 * v;
  }

  /** Replace (or add) a named set of instances. */
  set(key: string, list: ModelInst[]) {
    const old = this.sets.get(key);
    if (old) for (const it of old) this.dirty.add(it.m);
    for (const it of list) this.dirty.add(it.m);
    if (list.length) this.sets.set(key, list);
    else this.sets.delete(key);
  }

  remove(key: string) {
    const old = this.sets.get(key);
    if (!old) return;
    for (const it of old) this.dirty.add(it.m);
    this.sets.delete(key);
  }

  /** All current instances of one model (debug / tests). */
  list(m: number): ModelInst[] {
    const out: ModelInst[] = [];
    for (const set of this.sets.values()) for (const it of set) if (it.m === m) out.push(it);
    return out;
  }

  /** Flattened Rust instances (model, x, y, z, yaw, sx, sy, sz). */
  static fromFlat(a: Float32Array | number[]): ModelInst[] {
    const out: ModelInst[] = [];
    const TREE_TINT = [0xffffff, 0xfff4dc, 0xf2f0c8, 0xffe9c0, 0xe4ecc0];
    for (let i = 0; i + 7 < a.length; i += 8) {
      const it: ModelInst = { m: a[i], x: a[i + 1], y: a[i + 2], z: a[i + 3], yaw: a[i + 4], sx: a[i + 5], sy: a[i + 6], sz: a[i + 7] };
      // Each tree turns at its own pace: vary the crown tint a little.
      if (isTree(it.m)) it.color = TREE_TINT[(Math.abs(Math.floor(it.x * 7.1 + it.z * 3.7)) % TREE_TINT.length)];
      out.push(it);
    }
    return out;
  }

  /** Collect the instance lists of models whose sets changed. */
  flush() {
    if (!this.loaded || !this.dirty.size) return;
    for (const mi of this.dirty) {
      const list: ModelInst[] = [];
      for (const set of this.sets.values()) for (const it of set) if (it.m === mi) list.push(it);
      this.full[mi] = list;
      this.recull.add(mi);
    }
    this.dirty.clear();
    this.instances = this.full.reduce((s, l) => s + l.length, 0);
    this.cull(this.cullAt.x, this.cullAt.z);
  }

  /** Keep only instances within each model's draw distance (re-run as the player moves). */
  update(x: number, z: number) {
    if (!this.loaded) return;
    if ((x - this.cullAt.x) ** 2 + (z - this.cullAt.z) ** 2 > 36) {
      for (let i = 0; i < MODEL_NAMES.length; i++) this.recull.add(i);
      this.cull(x, z);
    }
  }

  private cull(x: number, z: number) {
    this.cullAt = { x, z };
    const m4 = new THREE.Matrix4();
    const inst = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const c = new THREE.Color();
    for (const mi of this.recull) {
      const r2 = RANGE[mi] * RANGE[mi];
      const list = this.full[mi].filter((it) => (it.x - x) ** 2 + (it.z - z) ** 2 < r2);
      for (const part of this.parts[mi]) {
        if (part.mesh && part.mesh.instanceMatrix.count < list.length) {
          this.group.remove(part.mesh);
          part.mesh.dispose();
          part.mesh = null;
        }
        if (!part.mesh) {
          if (!list.length) continue;
          const cap = Math.max(16, 1 << Math.ceil(Math.log2(list.length * 1.5)));
          part.mesh = new THREE.InstancedMesh(part.geo, part.mat, cap);
          part.mesh.castShadow = CASTS.has(mi);
          part.mesh.receiveShadow = true;
          part.mesh.matrixAutoUpdate = false;
          part.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          this.group.add(part.mesh);
        }
        list.forEach((it, i) => {
          q.setFromAxisAngle(up, it.yaw);
          inst.compose(p.set(it.x, it.y, it.z), q, s.set(it.sx, it.sy, it.sz));
          part.mesh!.setMatrixAt(i, m4.multiplyMatrices(inst, part.local));
          part.mesh!.setColorAt(i, c.set(it.color ?? 0xffffff));
        });
        part.mesh.count = list.length;
        part.mesh.visible = list.length > 0;
        part.mesh.instanceMatrix.needsUpdate = true;
        if (part.mesh.instanceColor) part.mesh.instanceColor.needsUpdate = true;
        part.mesh.computeBoundingSphere();
      }
    }
    this.recull.clear();
  }
}

/**
 * Shop-front furniture in front of the convenience chains (as on the real
 * stores): stacks of plastic chairs and drink crates by the door.
 */
export function storefrontFurniture(fronts: { x: number; z: number; yaw: number; w: number; seed: number }[]): ModelInst[] {
  const out: ModelInst[] = [];
  const CHAIRS = [0x2e9c9a, 0x2a6fd1, 0x3f9e4d, 0xf2f2ee];
  const CRATES = [0x2a5fd0, 0x2f9a48, 0xe8c21e];
  for (const f of fronts) {
    let h = f.seed >>> 0 || 1;
    const rnd = () => ((h = (Math.imul(h, 1664525) + 1013904223) >>> 0) / 4294967296);
    const nx = Math.sin(f.yaw);
    const nz = Math.cos(f.yaw);
    const tx = Math.cos(f.yaw);
    const tz = -Math.sin(f.yaw);
    const at = (lat: number, out_: number) => [f.x + tx * lat + nx * out_, f.z + tz * lat + nz * out_];
    const half = f.w * 0.5;
    // Two stacks of chairs at one end.
    const ch = CHAIRS[Math.floor(rnd() * CHAIRS.length)];
    for (const [k, lat] of [[0, half - 0.45], [1, half - 1.05]] as const) {
      const [x, z] = at(lat, 0.35 + rnd() * 0.15);
      const n = 3 + Math.floor(rnd() * 4);
      const yaw = f.yaw + Math.PI + (rnd() - 0.5) * 0.25 + k * 0.05;
      for (let i = 0; i < n; i++) out.push({ m: MODEL.chair, x, y: 0.1 + i * 0.075, z, yaw, sx: 1, sy: 1, sz: 1, color: ch });
    }
    // Crates stacked at the other end.
    for (const lat of [-half + 0.4, -half + 0.95]) {
      const [x, z] = at(lat, 0.32);
      const col = CRATES[Math.floor(rnd() * CRATES.length)];
      const n = 2 + Math.floor(rnd() * 4);
      const yaw = f.yaw + Math.PI / 2 + (rnd() - 0.5) * 0.08;
      for (let i = 0; i < n; i++) out.push({ m: MODEL.crate, x, y: 0.1 + i * 0.255, z, yaw: yaw + (rnd() - 0.5) * 0.06, sx: 1, sy: 1, sz: 1, color: col });
    }
  }
  return out;
}
