// Vehicles in the street: parked cars (placed by the Rust core, solid for
// the player) and moving traffic on the main roads.
//
// Traffic drives on the right along lanes offset from the road centre lines
// (minimap_roads). Lanes are trimmed short of their ends and joined to a
// following lane with a cubic curve through the junction. Each car keeps a
// gap to whatever is ahead in its path (other cars, the player, pedestrians),
// with a tie-break so two cars blocking each other at a junction cannot both
// wait forever.

import * as THREE from 'three';
import { carParts, CAR_TYPES, paintFor } from './cars';

/** Footprint half-extents (width, length); same as CAR_HALF in props.rs. */
export const CAR_HALF: [number, number][] = [
  [0.93, 2.42],
  [0.81, 1.82],
  [0.95, 2.34],
  [0.93, 2.42],
  [0.88, 2.56],
  [1.26, 5.5],
];

const T = { sedan: 0, compact: 1, suv: 2, taxi: 3, truck: 4, bus: 5 };
const PARK_RANGE = 175;
const MAX_MOVING = 72;
const LIVE_RANGE = 300;
/** Beyond this distance from the camera cars use the low-detail mesh. */
const NEAR_RANGE = 42;

interface Lane {
  pts: Float32Array; // x, z
  cum: Float32Array;
  len: number;
  vmax: number;
  next: number[];
  bus: boolean;
}

interface Mover {
  t: number;
  color: number;
  lane: number;
  s: number;
  v: number;
  // Junction curve (when lane < 0 the car is on it).
  curve: THREE.CubicBezierCurve | null;
  cu: number;
  clen: number;
  nextLane: number;
  x: number;
  z: number;
  yaw: number;
  stuck: number;
  ghost: number;
  blockedBy: number;
}

export interface CarInst {
  t: number;
  x: number;
  z: number;
  yaw: number;
  color: number;
}

// ------------------------------------------------------------------ lanes
const KIND_PRIMARY = 1;
const KIND_SECONDARY = 2;
const KIND_TERTIARY = 3;
const KIND_LINK = 8;
const ONEWAY = 0x80;

function offsetLine(src: number[], off: number, reverse: boolean): number[] {
  const p = reverse ? reversePts(src) : src;
  const n = p.length / 2;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const ax = i > 0 ? p[i * 2] - p[i * 2 - 2] : p[i * 2 + 2] - p[i * 2];
    const az = i > 0 ? p[i * 2 + 1] - p[i * 2 - 1] : p[i * 2 + 3] - p[i * 2 + 1];
    const bx = i < n - 1 ? p[i * 2 + 2] - p[i * 2] : ax;
    const bz = i < n - 1 ? p[i * 2 + 3] - p[i * 2 + 1] : az;
    const la = Math.hypot(ax, az) || 1;
    const lb = Math.hypot(bx, bz) || 1;
    // Right-hand normal of each segment: (-dz, dx).
    const nax = -az / la;
    const naz = ax / la;
    const nbx = -bz / lb;
    const nbz = bx / lb;
    let mx = nax + nbx;
    let mz = naz + nbz;
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml;
    mz /= ml;
    const k = off / Math.max(0.5, mx * nax + mz * naz);
    out.push(p[i * 2] + mx * k, p[i * 2 + 1] + mz * k);
  }
  return out;
}

function reversePts(p: number[]): number[] {
  const o: number[] = [];
  for (let i = p.length / 2 - 1; i >= 0; i--) o.push(p[i * 2], p[i * 2 + 1]);
  return o;
}

/** Cut `a` meters from the start and `b` from the end of a polyline. */
function trim(p: number[], a: number, b: number): number[] | null {
  const n = p.length / 2;
  let len = 0;
  for (let i = 1; i < n; i++) len += Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]);
  if (len < a + b + 6) return null;
  const at = (s: number) => {
    let acc = 0;
    for (let i = 1; i < n; i++) {
      const l = Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]);
      if (acc + l >= s) {
        const t = (s - acc) / (l || 1);
        return { i, x: p[i * 2 - 2] + (p[i * 2] - p[i * 2 - 2]) * t, z: p[i * 2 - 1] + (p[i * 2 + 1] - p[i * 2 - 1]) * t };
      }
      acc += l;
    }
    return { i: n - 1, x: p[n * 2 - 2], z: p[n * 2 - 1] };
  };
  const s0 = at(a);
  const s1 = at(len - b);
  const out = [s0.x, s0.z];
  for (let i = s0.i; i < s1.i; i++) out.push(p[i * 2], p[i * 2 + 1]);
  out.push(s1.x, s1.z);
  return out;
}

function makeLane(p: number[], vmax: number, bus: boolean): Lane {
  const n = p.length / 2;
  const cum = new Float32Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]);
  return { pts: new Float32Array(p), cum, len: cum[n - 1], vmax, next: [], bus };
}

export function buildLanes(roads: Float32Array): Lane[] {
  const lanes: Lane[] = [];
  for (let i = 0; i < roads.length; ) {
    const n = roads[i];
    const kind = roads[i + 1];
    const width = roads[i + 2];
    const pts = Array.from(roads.subarray(i + 3, i + 3 + n * 2));
    i += 3 + n * 2;
    const base = kind & ~ONEWAY;
    if (![KIND_PRIMARY, KIND_SECONDARY, KIND_TERTIARY, KIND_LINK].includes(base) || n < 2) continue;
    const oneway = (kind & ONEWAY) !== 0;
    const vmax = base === KIND_PRIMARY ? 13 : base === KIND_SECONDARY ? 11 : base === KIND_LINK ? 8 : 9;
    const end = Math.min(9, 3 + width * 0.45);
    if (oneway) {
      const nl = Math.max(1, Math.round(width / 3.3));
      for (let k = 0; k < nl; k++) {
        const off = -width / 2 + ((k + 0.5) * width) / nl;
        const t = trim(offsetLine(pts, off, false), end, end);
        if (t) lanes.push(makeLane(t, vmax, k === nl - 1 && base === KIND_PRIMARY));
      }
    } else {
      const nl = Math.max(1, Math.round(width / 2 / 3.3));
      for (const rev of [false, true]) {
        for (let k = 0; k < nl; k++) {
          const off = ((k + 0.5) * width) / 2 / nl;
          const t = trim(offsetLine(pts, off, rev), end, end);
          if (t) lanes.push(makeLane(t, vmax, k === nl - 1 && base !== KIND_TERTIARY));
        }
      }
    }
  }
  // Join lane ends to nearby lane starts heading roughly the same way (no U-turns).
  for (let a = 0; a < lanes.length; a++) {
    const A = lanes[a];
    const m = A.pts.length;
    const ex = A.pts[m - 2];
    const ez = A.pts[m - 1];
    let dx = ex - A.pts[m - 4];
    let dz = ez - A.pts[m - 3];
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl;
    dz /= dl;
    for (let b = 0; b < lanes.length; b++) {
      if (a === b) continue;
      const B = lanes[b];
      const sx = B.pts[0];
      const sz = B.pts[1];
      const d = Math.hypot(sx - ex, sz - ez);
      if (d > 30 || d < 1) continue;
      let bx = B.pts[2] - sx;
      let bz = B.pts[3] - sz;
      const bl = Math.hypot(bx, bz) || 1;
      bx /= bl;
      bz /= bl;
      const turn = dx * bx + dz * bz;
      if (turn < -0.3) continue;
      // The start must lie ahead of the end, not behind it.
      if ((sx - ex) * dx + (sz - ez) * dz < 0.5) continue;
      A.next.push(b);
    }
  }
  return lanes;
}

function laneAt(L: Lane, s: number, out: { x: number; z: number; dx: number; dz: number }) {
  const cum = L.cum;
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const seg = cum[hi] - cum[lo] || 1;
  const t = Math.min(1, Math.max(0, (s - cum[lo]) / seg));
  const x0 = L.pts[lo * 2];
  const z0 = L.pts[lo * 2 + 1];
  const x1 = L.pts[hi * 2];
  const z1 = L.pts[hi * 2 + 1];
  out.x = x0 + (x1 - x0) * t;
  out.z = z0 + (z1 - z0) * t;
  out.dx = (x1 - x0) / seg;
  out.dz = (z1 - z0) / seg;
}

// ------------------------------------------------------------------ simulation
export class Traffic {
  readonly cars: Mover[] = [];
  private rnd = 1234567;
  private tmp = { x: 0, z: 0, dx: 0, dz: 0 };
  private weights: Float32Array;
  private total = 0;

  constructor(readonly lanes: Lane[]) {
    this.weights = new Float32Array(lanes.length);
    let acc = 0;
    lanes.forEach((l, i) => {
      acc += l.len;
      this.weights[i] = acc;
    });
    this.total = acc;
  }

  private rand() {
    this.rnd = (this.rnd * 1664525 + 1013904223) >>> 0;
    return this.rnd / 4294967296;
  }

  private pickType(bus: boolean): number {
    const r = this.rand();
    if (bus && r < 0.16) return T.bus;
    if (r < 0.3) return T.taxi;
    if (r < 0.58) return T.sedan;
    if (r < 0.76) return T.suv;
    if (r < 0.88) return T.compact;
    return T.truck;
  }

  /** Place a car on a random lane point, `minD`..`maxD` from (px, pz). */
  private spawn(car: Mover | null, px: number, pz: number, minD: number, maxD: number): Mover | null {
    for (let tries = 0; tries < 24; tries++) {
      const r = this.rand() * this.total;
      let li = 0;
      while (li < this.weights.length - 1 && this.weights[li] < r) li++;
      const L = this.lanes[li];
      const s = this.rand() * L.len;
      laneAt(L, s, this.tmp);
      const d = Math.hypot(this.tmp.x - px, this.tmp.z - pz);
      if (d < minD || d > maxD) continue;
      if (this.cars.some((c) => c !== car && Math.hypot(c.x - this.tmp.x, c.z - this.tmp.z) < 14)) continue;
      const t = this.pickType(L.bus);
      const c: Mover = car ?? ({} as Mover);
      Object.assign(c, {
        t,
        color: paintFor(CAR_TYPES[t], this.rand() * 1000),
        lane: li,
        s,
        v: L.vmax * 0.7,
        curve: null,
        cu: 0,
        clen: 0,
        nextLane: -1,
        x: this.tmp.x,
        z: this.tmp.z,
        yaw: Math.atan2(this.tmp.dx, this.tmp.dz),
        stuck: 0,
        ghost: 0,
        blockedBy: -1,
      });
      return c;
    }
    return null;
  }

  update(dt: number, px: number, pz: number, crowd: Float32Array | null) {
    if (!this.lanes.length) return;
    // Keep the population near the player.
    while (this.cars.length < MAX_MOVING) {
      const c = this.spawn(null, px, pz, 0, LIVE_RANGE * 0.8);
      if (!c) break;
      this.cars.push(c);
    }
    for (const c of this.cars) {
      if (Math.hypot(c.x - px, c.z - pz) > LIVE_RANGE) this.spawn(c, px, pz, 150, 260);
    }
    const cars = this.cars;
    const n = cars.length;
    // Gap ahead of each car.
    for (let i = 0; i < n; i++) {
      const c = cars[i];
      const hx = Math.sin(c.yaw);
      const hz = Math.cos(c.yaw);
      const [hwI, hlI] = CAR_HALF[c.t];
      const look = 10 + c.v * 2.2;
      let gap = 1e9;
      let by = -1;
      const test = (x: number, z: number, hw: number, hl: number, id: number) => {
        const rx = x - c.x;
        const rz = z - c.z;
        const along = rx * hx + rz * hz;
        if (along <= 0 || along > look + hl) return;
        const lat = Math.abs(rx * hz - rz * hx);
        if (lat > hwI + hw + 0.5) return;
        const g = along - hlI - hl;
        if (g < gap) {
          gap = g;
          by = id;
        }
      };
      if (c.ghost <= 0) {
        for (let j = 0; j < n; j++) {
          if (j === i) continue;
          const o = cars[j];
          if (Math.abs(o.x - c.x) > 40 || Math.abs(o.z - c.z) > 40) continue;
          test(o.x, o.z, CAR_HALF[o.t][0], CAR_HALF[o.t][1], j);
        }
      }
      test(px, pz, 0.4, 0.4, -2);
      if (crowd) {
        for (let k = 0; k < crowd.length; k += 4) {
          const x = crowd[k];
          const z = crowd[k + 1];
          if (Math.abs(x - c.x) > 30 || Math.abs(z - c.z) > 30) continue;
          test(x, z, 0.35, 0.35, -3);
        }
      }
      (c as Mover & { gap: number }).gap = gap;
      c.blockedBy = by;
    }
    for (let i = 0; i < n; i++) {
      const c = cars[i] as Mover & { gap: number };
      let gap = c.gap;
      // Mutual block (two cars nose to nose across a junction): the lower index goes.
      if (c.blockedBy >= 0 && cars[c.blockedBy].blockedBy === i && i < c.blockedBy) gap = 1e9;
      const L = c.lane >= 0 ? this.lanes[c.lane] : null;
      let vmax = L ? L.vmax : 5.5;
      // Slow down for the junction curve ahead.
      if (L && L.len - c.s < 18) vmax = Math.min(vmax, 5.5 + (L.len - c.s) * 0.4);
      const vGap = Math.sqrt(Math.max(0, 2 * 4.5 * (gap - 2.2)));
      const target = Math.min(vmax, vGap);
      c.v += Math.max(-9 * dt, Math.min(2.2 * dt, target - c.v));
      if (c.v < 0) c.v = 0;
      if (c.v < 0.2 && c.blockedBy >= 0) c.stuck += dt;
      else c.stuck = Math.max(0, c.stuck - dt);
      if (c.stuck > 6) {
        c.ghost = 2.5;
        c.stuck = 0;
      }
      c.ghost -= dt;
      this.advance(c, c.v * dt, px, pz);
    }
  }

  private advance(c: Mover, ds: number, px: number, pz: number) {
    if (c.lane >= 0) {
      const L = this.lanes[c.lane];
      c.s += ds;
      if (c.s >= L.len) {
        const over = c.s - L.len;
        if (!L.next.length) {
          this.spawn(c, px, pz, 150, 260);
          return;
        }
        const nl = L.next[Math.floor(this.rand() * L.next.length)];
        const N = this.lanes[nl];
        const m = L.pts.length;
        const ex = L.pts[m - 2];
        const ez = L.pts[m - 1];
        let dx = ex - L.pts[m - 4];
        let dz = ez - L.pts[m - 3];
        const dl = Math.hypot(dx, dz) || 1;
        dx /= dl;
        dz /= dl;
        const sx = N.pts[0];
        const sz = N.pts[1];
        let bx = N.pts[2] - sx;
        let bz = N.pts[3] - sz;
        const bl = Math.hypot(bx, bz) || 1;
        bx /= bl;
        bz /= bl;
        const k = Math.hypot(sx - ex, sz - ez) * 0.42;
        c.curve = new THREE.CubicBezierCurve(
          new THREE.Vector2(ex, ez),
          new THREE.Vector2(ex + dx * k, ez + dz * k),
          new THREE.Vector2(sx - bx * k, sz - bz * k),
          new THREE.Vector2(sx, sz),
        );
        c.clen = c.curve.getLength();
        c.cu = 0;
        c.nextLane = nl;
        c.lane = -1;
        this.advance(c, over, px, pz);
        return;
      }
      laneAt(L, c.s, this.tmp);
      c.x = this.tmp.x;
      c.z = this.tmp.z;
      this.steer(c, Math.atan2(this.tmp.dx, this.tmp.dz));
    } else if (c.curve) {
      c.cu += ds / Math.max(1, c.clen);
      if (c.cu >= 1) {
        const over = (c.cu - 1) * c.clen;
        c.lane = c.nextLane;
        c.s = 0;
        c.curve = null;
        this.advance(c, over, px, pz);
        return;
      }
      const p = c.curve.getPointAt(c.cu);
      const tg = c.curve.getTangentAt(c.cu);
      c.x = p.x;
      c.z = p.y;
      this.steer(c, Math.atan2(tg.x, tg.y));
    }
  }

  private steer(c: Mover, yaw: number) {
    let d = yaw - c.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    c.yaw += d * Math.min(1, 0.35 + c.v * 0.05);
  }
}

// ------------------------------------------------------------------ rendering
function blobTexture(): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 128;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(64, 128);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 64; x++) {
      const u = (x + 0.5) / 32 - 1;
      const v = (y + 0.5) / 64 - 1;
      // Rounded-rectangle falloff.
      const d = Math.pow(Math.pow(Math.abs(u), 4) + Math.pow(Math.abs(v), 4), 0.25);
      const a = Math.max(0, Math.min(1, (1 - d) / 0.35));
      img.data[(y * 64 + x) * 4 + 3] = Math.round(a * a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function beamTexture(): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 128;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(64, 128);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 64; x++) {
      const v = (y + 0.5) / 128; // 0 at the car, 1 far
      const u = ((x + 0.5) / 64 - 0.5) * 2;
      // Two soft lamp pools merging into one cone; gaussian edges, no hard outline.
      const spread = 0.28 + v * 0.7;
      const lat = Math.exp(-Math.pow(u / spread, 2) * 2.2);
      const pools = 0.55 + 0.45 * Math.exp(-Math.pow((Math.abs(u) - 0.35 * (1 - v)) / 0.18, 2));
      const a = lat * pools * Math.pow(1 - v, 2.2) * Math.min(1, v * 5);
      const o = (y * 64 + x) * 4;
      img.data[o] = 255;
      img.data[o + 1] = 236;
      img.data[o + 2] = 200;
      img.data[o + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface TypeMeshes {
  meshes: THREE.InstancedMesh[];
  tinted: THREE.InstancedMesh[];
  cap: number;
}

export class CarLayer {
  readonly group = new THREE.Group();
  private types: TypeMeshes[] = [];
  private blob: THREE.InstancedMesh;
  private beam: THREE.InstancedMesh;
  private beamMat: THREE.MeshBasicMaterial;
  private parked: CarInst[] = [];
  private parkedVis: CarInst[][] = CAR_TYPES.map(() => []);
  private cullAt = { x: 1e9, z: 1e9 };
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3(1, 1, 1);
  private col = new THREE.Color();
  private up = new THREE.Vector3(0, 1, 0);
  private frustum = new THREE.Frustum();
  private pm = new THREE.Matrix4();
  private sphere = new THREE.Sphere();
  visible = 0;

  constructor(night: { value: number }, parkedFlat: Float32Array) {
    this.group.matrixAutoUpdate = false;
    for (let i = 0; i + 4 < parkedFlat.length; i += 5) {
      const t = parkedFlat[i + 3];
      this.parked.push({ x: parkedFlat[i], z: parkedFlat[i + 1], yaw: parkedFlat[i + 2], t, color: paintFor(CAR_TYPES[t], parkedFlat[i + 4]) });
    }
    const counts = CAR_TYPES.map((_, t) => this.parked.filter((p) => p.t === t).length);
    const parts = carParts(night);
    // Two meshes sets per type: index t * 2 (near detail) and t * 2 + 1 (far).
    CAR_TYPES.forEach((name, t) => [parts.get(name)!.near, parts.get(name)!.far].forEach((lodParts, lod) => {
      const cap = counts[t] + (t === T.bus ? 12 : MAX_MOVING);
      const tm: TypeMeshes = { meshes: [], tinted: [], cap };
      for (const p of lodParts) {
        const mesh = new THREE.InstancedMesh(p.geo, p.mat, cap);
        mesh.count = 0;
        mesh.frustumCulled = false;
        // Far cars are beyond the sun's shadow cascade anyway.
        mesh.castShadow = p.shadow && lod === 0;
        mesh.receiveShadow = true;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        if (p.tint) {
          mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
          mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
          tm.tinted.push(mesh);
        }
        tm.meshes.push(mesh);
        this.group.add(mesh);
      }
      this.types.push(tm);
    }));
    const total = this.parked.length + MAX_MOVING + 12;
    const blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, map: blobTexture(), transparent: true, opacity: 0.62, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    // Alpha only: the texture's colour is ignored by using it as alphaMap.
    blobMat.alphaMap = blobMat.map;
    blobMat.map = null;
    this.blob = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), blobMat, total);
    this.blob.count = 0;
    this.blob.frustumCulled = false;
    this.blob.renderOrder = 1;
    this.group.add(this.blob);
    this.beamMat = new THREE.MeshBasicMaterial({ map: beamTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const beamGeo = new THREE.PlaneGeometry(4.2, 14).rotateX(-Math.PI / 2).translate(0, 0.03, 7);
    // Flip v so the texture's near edge (v = 0) sits at the car.
    const uv = beamGeo.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    this.beam = new THREE.InstancedMesh(beamGeo, this.beamMat, MAX_MOVING);
    this.beam.count = 0;
    this.beam.frustumCulled = false;
    this.beam.renderOrder = 2;
    this.group.add(this.beam);
  }

  get parkedCars(): readonly CarInst[] {
    return this.parked;
  }

  update(px: number, pz: number, moving: readonly CarInst[], night: number, camera?: THREE.Camera) {
    if (Math.hypot(px - this.cullAt.x, pz - this.cullAt.z) > 12) {
      this.cullAt = { x: px, z: pz };
      for (const l of this.parkedVis) l.length = 0;
      for (const p of this.parked) {
        if (Math.abs(p.x - px) < PARK_RANGE && Math.abs(p.z - pz) < PARK_RANGE && Math.hypot(p.x - px, p.z - pz) < PARK_RANGE) this.parkedVis[p.t].push(p);
      }
    }
    if (camera) {
      this.pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(this.pm);
    }
    const cx = camera ? camera.position.x : px;
    const cz = camera ? camera.position.z : pz;
    let blobs = 0;
    let beams = 0;
    this.visible = 0;
    this.beamMat.opacity = Math.min(1, night * 1.2) * 0.3;
    this.beam.visible = night > 0.05;
    const fill = new Array(this.types.length).fill(0);
    const put = (c: CarInst, isMoving: boolean) => {
      const [hw, hl] = CAR_HALF[c.t];
      if (camera) {
        this.sphere.center.set(c.x, 1.2, c.z);
        this.sphere.radius = hl + 2.5;
        if (!this.frustum.intersectsSphere(this.sphere)) return;
      }
      const far = Math.hypot(c.x - cx, c.z - cz) > NEAR_RANGE ? 1 : 0;
      const ti = c.t * 2 + far;
      const tm = this.types[ti];
      const k = fill[ti];
      if (k >= tm.cap) return;
      this.q.setFromAxisAngle(this.up, c.yaw);
      this.v.set(c.x, 0, c.z);
      this.s.set(1, 1, 1);
      this.m.compose(this.v, this.q, this.s);
      for (const mesh of tm.meshes) mesh.setMatrixAt(k, this.m);
      this.col.setHex(c.color);
      for (const mesh of tm.tinted) mesh.setColorAt(k, this.col);
      this.s.set(hw * 2 + 0.5, 1, hl * 2 + 0.6);
      this.m.compose(this.v, this.q, this.s);
      this.blob.setMatrixAt(blobs++, this.m);
      if (isMoving && beams < MAX_MOVING) {
        this.v.set(c.x + Math.sin(c.yaw) * hl, 0, c.z + Math.cos(c.yaw) * hl);
        this.s.set(1, 1, 1);
        this.m.compose(this.v, this.q, this.s);
        this.beam.setMatrixAt(beams++, this.m);
      }
      fill[ti] = k + 1;
    };
    for (let t = 0; t < CAR_TYPES.length; t++) for (const c of this.parkedVis[t]) put(c, false);
    for (const c of moving) put(c, true);
    for (let ti = 0; ti < this.types.length; ti++) {
      for (const mesh of this.types[ti].meshes) {
        mesh.count = fill[ti];
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
      this.visible += fill[ti];
    }
    this.blob.count = blobs;
    this.blob.instanceMatrix.needsUpdate = true;
    this.beam.count = beams;
    this.beam.instanceMatrix.needsUpdate = true;
  }
}
