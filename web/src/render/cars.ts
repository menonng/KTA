// Procedural Korean street vehicles: sedan (mid-size), compact (경차), SUV,
// taxi, 1-ton truck (cab-over) and city bus.
//
// Passenger cars are lofted from superellipse cross-sections along the car
// (plan view rounded at both ends, hood/trunk profile, wheel arches cut into
// the sill line) with smooth normals, plus a glass greenhouse whose roof and
// pillars are separate painted strips. Lamps, grilles and plates follow the
// plan outline so they wrap around the corners. Everything is merged into
// four parts that share materials across types:
//   paint  (tinted per instance, clear-coated)   glass (dark, reflective)
//   trim   (tyres, rims, grilles, plates; vertex colours)
//   lights (lamps; vertex-coloured emission scaled at night)
// Cars face +Z, sit on y = 0 and are centred on x.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const CAR_TYPES = ['sedan', 'compact', 'suv', 'taxi', 'truck', 'bus'] as const;
export type CarType = (typeof CAR_TYPES)[number];

export interface CarPart {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  tint: boolean;
  shadow: boolean;
}

interface Spec {
  L: number;
  W: number;
  H: number;
  clear: number;
  belt: number;
  hoodY: number;
  noseY: number;
  trunkY: number;
  tailY: number;
  wr: number;
  wb: number;
  wbOff: number;
  wsBase: number; // windscreen base z
  roofF: number;
  roofR: number;
  rearBase: number; // rear glass base z
  hatch: boolean;
}

const SPECS: Record<'sedan' | 'compact' | 'suv', Spec> = {
  sedan: { L: 4.85, W: 1.86, H: 1.46, clear: 0.16, belt: 0.94, hoodY: 0.82, noseY: 0.6, trunkY: 0.97, tailY: 0.78, wr: 0.335, wb: 2.85, wbOff: 0.05, wsBase: 1.0, roofF: 0.2, roofR: -0.88, rearBase: -1.62, hatch: false },
  compact: { L: 3.6, W: 1.6, H: 1.52, clear: 0.15, belt: 0.93, hoodY: 0.86, noseY: 0.6, trunkY: 0.93, tailY: 0.84, wr: 0.29, wb: 2.4, wbOff: 0.02, wsBase: 0.92, roofF: 0.22, roofR: -1.3, rearBase: -1.68, hatch: true },
  suv: { L: 4.7, W: 1.9, H: 1.72, clear: 0.21, belt: 1.07, hoodY: 1.0, noseY: 0.76, trunkY: 1.07, tailY: 0.98, wr: 0.37, wb: 2.78, wbOff: 0.0, wsBase: 1.05, roofF: 0.3, roofR: -1.92, rearBase: -2.2, hatch: true },
};

type V = [number, number, number];

/** Level of detail being built: far cars use fewer segments and skip small parts. */
let LOW = false;
const q = (hi: number, lo: number) => (LOW ? lo : hi);

// ---------------------------------------------------------------- helpers
/**
 * Loft rings of equal length into a smooth-shaded surface. Faces are turned
 * to face away from the car's long axis (reference: x = 0, y = refY, z
 * clamped to ±refZ), so ring direction does not matter.
 */
function loft(rings: V[][], closed: boolean, refY: number, refZ: number): THREE.BufferGeometry {
  const n = rings[0].length;
  const pos: number[] = [];
  for (const r of rings) for (const p of r) pos.push(p[0], p[1], p[2]);
  const idx: number[] = [];
  const kmax = closed ? n : n - 1;
  const face = (a: number, b: number, c: number) => {
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const ux = pos[b * 3] - ax, uy = pos[b * 3 + 1] - ay, uz = pos[b * 3 + 2] - az;
    const vx = pos[c * 3] - ax, vy = pos[c * 3 + 1] - ay, vz = pos[c * 3 + 2] - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz < 1e-14) return;
    const cx = (ax + pos[b * 3] + pos[c * 3]) / 3;
    const cy = (ay + pos[b * 3 + 1] + pos[c * 3 + 1]) / 3;
    const cz = (az + pos[b * 3 + 2] + pos[c * 3 + 2]) / 3;
    const oz = cz - Math.max(-refZ, Math.min(refZ, cz));
    if (nx * cx + ny * (cy - refY) + nz * oz >= 0) idx.push(a, b, c);
    else idx.push(a, c, b);
  };
  for (let s = 0; s + 1 < rings.length; s++) {
    for (let k = 0; k < kmax; k++) {
      const a = s * n + k;
      const b = s * n + ((k + 1) % n);
      const c = (s + 1) * n + k;
      const d = (s + 1) * n + ((k + 1) % n);
      face(a, c, b);
      face(b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

function box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, rx = 0, ry = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  g.translate(cx, cy, cz);
  return g;
}

function plain(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  if (ng.getAttribute('uv')) ng.deleteAttribute('uv');
  return ng;
}

function colored(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const ng = plain(g);
  const c = new THREE.Color(hex);
  const n = ng.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return ng;
}

/** Superellipse coordinate: sign(t)·|t|^(2/n). */
const se = (t: number, n: number) => Math.sign(t) * Math.pow(Math.abs(t), 2 / n);

const S = THREE.MathUtils.smoothstep;
const lerp = THREE.MathUtils.lerp;

function wheel(x: number, z: number, r: number, tw: number, side: number, trim: THREE.BufferGeometry[], spokes = 5) {
  // Tyre: lathe profile with rounded shoulders, axle along x.
  const prof = [
    [0.6, -0.5], [0.86, -0.5], [0.96, -0.42], [1.0, -0.22], [1.0, 0.22], [0.96, 0.42], [0.86, 0.5], [0.6, 0.5],
  ].map(([a, b]) => new THREE.Vector2(a * r, b * tw));
  const tyre = new THREE.LatheGeometry(prof, q(18, 8)).rotateZ(Math.PI / 2).translate(x, r, z);
  trim.push(colored(tyre, 0x151515));
  const face = x + side * (tw * 0.5 - 0.035);
  if (LOW) {
    trim.push(colored(new THREE.CylinderGeometry(r * 0.62, r * 0.62, 0.02, 8).rotateZ(Math.PI / 2).translate(face, r, z), 0x9a9ea4));
    return;
  }
  // Dark well behind the spokes, rim lip, spokes and hub cap.
  trim.push(colored(new THREE.CylinderGeometry(r * 0.6, r * 0.6, 0.02, 14).rotateZ(Math.PI / 2).translate(face - side * 0.03, r, z), 0x24262a));
  trim.push(colored(new THREE.CylinderGeometry(r * 0.64, r * 0.64, 0.05, 16, 1, true).rotateZ(Math.PI / 2).translate(face, r, z), 0xb4b8be));
  for (let k = 0; k < spokes; k++) {
    const a = (k / spokes) * Math.PI * 2;
    const sp = new THREE.BoxGeometry(0.03, r * 0.56, 0.055);
    sp.translate(0, r * 0.3, 0);
    sp.rotateX(a);
    sp.translate(face, r, z);
    trim.push(colored(sp, 0xaeb2b8));
  }
  trim.push(colored(new THREE.CylinderGeometry(r * 0.13, r * 0.13, 0.04, 10).rotateZ(Math.PI / 2).translate(face + side * 0.01, r, z), 0x8c9096));
}

/** Dark half-cylinder inside a wheel arch (hides the hollow body). */
function wellLiner(zc: number, r: number, yAxle: number, width: number): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r, r, width, q(14, 6), 1, true, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(Math.PI / 2).translate(0, yAxle, zc);
}

/** Quad strip through points (x, y0..y1, z) — a band on the body surface. */
function band(pts: [number, number][], y0: number, y1: number, refY: number, refZ: number): THREE.BufferGeometry {
  return loft(pts.map(([x, z]) => [[x, y0, z], [x, y1, z]] as V[]), false, refY, refZ);
}

// ---------------------------------------------------------------- passenger cars
function passenger(sp: Spec, taxi: boolean) {
  const { L, W, H, clear, belt, hoodY, noseY, trunkY, tailY, wr, wb, wbOff, wsBase, roofF, roofR, rearBase, hatch } = sp;
  const paint: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];
  const trim: THREE.BufferGeometry[] = [];
  const lights: THREE.BufferGeometry[] = [];
  const hw0 = W / 2;
  const PLAN = 7;
  const halfW = (z: number) => hw0 * Math.sqrt(Math.max(0, 1 - Math.pow(Math.min(1, Math.abs(z) / (L / 2)), PLAN)));
  /** z on the plan outline at lateral offset x (end = +1 front, -1 rear). */
  const outline = (x: number, end: number, out = 0.012) => end * ((L / 2) * Math.pow(Math.max(0, 1 - (x / hw0) ** 2), 1 / PLAN) + out);
  const frontZ = L / 2 - wsBase;
  const rearZ = rearBase + L / 2;
  const top = (z: number) => {
    if (z > wsBase) {
      const t = (z - wsBase) / frontZ;
      return lerp(belt + 0.01, hoodY, S(t, 0, 0.35) * 0.6 + t * 0.4) - (hoodY - noseY) * Math.pow(Math.max(0, (t - 0.8) / 0.2), 2);
    }
    if (z < rearBase) {
      const t = (rearBase - z) / rearZ;
      return lerp(belt + 0.01, trunkY, Math.min(1, t * 2.5)) - (trunkY - tailY) * Math.pow(Math.max(0, (t - 0.78) / 0.22), 2);
    }
    return belt + 0.01;
  };
  const bottom = (z: number) => {
    const zn = Math.abs(z) / (L / 2);
    let yb = clear + 0.16 * Math.pow(Math.max(0, (zn - 0.78) / 0.22), 2);
    for (const zc of [wb / 2 + wbOff, -wb / 2 + wbOff]) {
      const d = Math.abs(z - zc);
      const ar = wr + 0.075;
      if (d < ar) yb = Math.max(yb, wr + Math.sqrt(ar * ar - d * d));
    }
    return yb;
  };
  // Body. The lower part (sill to shoulder) is near-vertical and takes the
  // wheel arches; the shoulder line sits just above the arch crowns so the
  // upper section keeps the same shape the whole length (no ripples).
  const N = q(56, 20);
  const K = q(22, 14);
  const ys0 = 2 * wr + 0.095;
  const ring = (z: number): V[] => {
    const hw = Math.max(0.03, halfW(z));
    const yt = top(z);
    const ys = Math.min(ys0, yt - 0.07);
    const yb = Math.min(bottom(z), ys - 0.03);
    const r: V[] = [];
    for (let k = 0; k < K; k++) {
      const a = (k / K) * Math.PI * 2;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      if (sn > 0) {
        r.push([hw * se(c, 5) * (1 - 0.07 * sn * sn), ys + (yt - ys) * se(sn, 4), z]);
      } else {
        r.push([hw * se(c, 12) * (1 - 0.03 * sn * sn), ys + (ys - yb) * se(sn, 12), z]);
      }
    }
    return r;
  };
  /** Body side surface x at (z, y) on the near-vertical lower part. */
  const sideX = (z: number) => Math.max(0.03, halfW(z)) * 0.99;
  const rings: V[][] = [];
  for (let i = 0; i <= N; i++) rings.push(ring(-(L / 2) * Math.cos((Math.PI * i) / N) * 0.999));
  const refY = (clear + belt) / 2;
  paint.push(loft(rings, true, refY, L / 2 - 0.7));
  // Floor pan and sills (dark), so the arches read from the side.
  trim.push(colored(box(0, clear + 0.05, wbOff, W * 0.86, 0.1, wb + 0.4), 0x1a1a1a));
  for (const sx of [-1, 1]) trim.push(colored(box(sx * (hw0 - 0.035), clear + 0.07, wbOff, 0.07, 0.1, wb - 2 * (wr + 0.1)), 0x1d1e20));

  // Greenhouse.
  const ghTop = (z: number) => {
    if (z > roofF) return H - (H - belt) * Math.pow((z - roofF) / (wsBase - roofF), 1.12);
    if (z < roofR) return H - (H - belt) * Math.pow((roofR - z) / (roofR - rearBase), hatch ? 1.05 : 1.18);
    const m = (roofF + roofR) / 2;
    const h = (roofF - roofR) / 2;
    return H - 0.025 * ((z - m) / h) ** 2;
  };
  const ghRing = (z: number): V[] => {
    const t = Math.max(belt + 0.002, ghTop(z));
    const hb = halfW(z) * 0.96;
    const lean = (t - belt) * 0.34;
    const ht = hb - lean;
    const r = Math.min(0.09, (t - belt) * 0.4);
    return [
      [hb, belt - 0.015, z],
      [hb - lean * 0.5, belt + (t - belt) * 0.5, z],
      [ht, t - r, z],
      [ht - r * 0.35, t - r * 0.25, z],
      [ht - r, t, z],
      [-(ht - r), t, z],
      [-(ht - r * 0.35), t - r * 0.25, z],
      [-ht, t - r, z],
      [-(hb - lean * 0.5), belt + (t - belt) * 0.5, z],
      [-hb, belt - 0.015, z],
    ];
  };
  const zs = (z0: number, z1: number, n: number) => Array.from({ length: n + 1 }, (_, i) => z0 + ((z1 - z0) * i) / n);
  const ghRef = (belt + H) / 2 - 0.2;
  glass.push(loft(zs(rearBase, wsBase, q(22, 8)).map(ghRing), false, ghRef, 0.3));
  // Painted strips over the glass: offset outward a little.
  const lift = (r: V[], d: number): V[] => r.map(([x, y, z]) => {
    const dx = x;
    const dy = y - ghRef;
    const l = Math.hypot(dx, dy) || 1;
    return [x + (dx / l) * d, y + (dy / l) * d, z];
  });
  const sub = (z0: number, z1: number, n: number, i0: number, i1: number, d = 0.008) => zs(z0, z1, n).map((z) => lift(ghRing(z).slice(i0, i1 + 1), d));
  // Roof panel.
  paint.push(loft(sub(roofR - 0.04, roofF + 0.04, q(8, 3), 2, 7), false, ghRef, 0.3));
  // A pillars (windscreen edges) and rear pillars.
  const pillar = (z0: number, z1: number, i0: number, i1: number) => paint.push(loft(sub(z0, z1, q(8, 3), i0, i1), false, ghRef, 0.3));
  pillar(roofF, wsBase - 0.01, 2, 4);
  pillar(roofF, wsBase - 0.01, 5, 7);
  const cEnd = hatch ? rearBase + 0.32 : roofR + 0.12;
  pillar(rearBase + 0.01, cEnd, 0, 4);
  pillar(rearBase + 0.01, cEnd, 5, 9);
  // Blacked-out B pillar and the window rubber along the belt.
  const bz = lerp(wsBase, rearBase, hatch ? 0.42 : 0.47);
  for (const [i0, i1] of [[0, 3], [6, 9]]) {
    trim.push(colored(loft(sub(bz - 0.06, bz + 0.06, 1, i0, i1, 0.006), false, ghRef, 0.3), 0x111214));
  }
  for (const sx of LOW ? [] : [-1, 1]) {
    const pts = zs(rearBase + 0.05, wsBase - 0.05, 10).map((z) => [sx * (halfW(z) * 0.965 + 0.004), z] as [number, number]);
    trim.push(colored(band(pts, belt - 0.03, belt + 0.005, refY, 1), 0x151618));
  }

  // Mirrors on short stalks at the A-pillar base, door handles, door shut lines.
  const seamY0 = clear + 0.12;
  for (const sx of [-1, 1]) {
    const mz = wsBase - 0.2;
    const hb = halfW(mz) * 0.96;
    paint.push(plain(box(sx * (hb + 0.13), belt + 0.11, mz, 0.17, 0.11, 0.09, 0, sx * 0.22)));
    trim.push(colored(box(sx * (hb + 0.03), belt + 0.06, mz + 0.02, 0.1, 0.05, 0.06), 0x161616));
    if (LOW) continue;
    const doorEdges = hatch ? [wsBase - 0.1, bz - 0.04, rearBase + 0.36] : [wsBase - 0.1, bz - 0.04, roofR - 0.05];
    for (const hz of [doorEdges[0] - 0.5, doorEdges[1] - 0.45]) {
      trim.push(colored(box(sx * (sideX(hz) + 0.006), belt - 0.1, hz, 0.02, 0.025, 0.14), 0x9a9ea4));
    }
    for (const ez of doorEdges) {
      const x = sx * (sideX(ez) + 0.002);
      trim.push(colored(box(x, (seamY0 + belt) / 2, ez, 0.006, belt - seamY0 - 0.02, 0.008), 0x0c0c0d));
    }
    // Lower edge of the doors.
    trim.push(colored(box(sx * (sideX(0) + 0.002), seamY0, (doorEdges[0] + doorEdges[2]) / 2, 0.006, 0.006, doorEdges[0] - doorEdges[2]), 0x0c0c0d));
  }

  // Front: wrap-around headlamps, grilles, plate.
  const xs = (x0: number, x1: number, n: number) => Array.from({ length: n + 1 }, (_, i) => x0 + ((x1 - x0) * i) / n);
  const hy = hoodY - 0.06;
  for (const sx of [-1, 1]) {
    const pts = xs(0.5 * hw0, 0.94 * hw0, q(7, 3)).map((x) => [sx * x, outline(x, 1)] as [number, number]);
    lights.push(colored(band(pts, hy - 0.11, hy, refY, L / 2 - 0.7), 0xfff6e4));
    // Daytime running strip under the lamp.
    if (!LOW) lights.push(colored(band(pts.slice(1, 6), hy - 0.135, hy - 0.115, refY, L / 2 - 0.7), 0xe8f2ff));
    // Rear lamps: wrap around the corner.
    const rpts = xs(0.55 * hw0, 0.95 * hw0, q(6, 3)).map((x) => [sx * x, outline(x, -1)] as [number, number]);
    const ry = hatch ? belt - 0.02 : trunkY - 0.1;
    lights.push(colored(band(rpts, ry - 0.11, ry, refY, L / 2 - 0.7), 0xd8141c));
  }
  {
    const ry = hatch ? belt - 0.02 : trunkY - 0.1;
    // Full-width light bar between the rear lamps (current Korean styling).
    const bar = xs(-0.55 * hw0, 0.55 * hw0, q(8, 2)).map((x) => [x, outline(Math.abs(x), -1)] as [number, number]);
    lights.push(colored(band(bar, ry - 0.06, ry - 0.03, refY, L / 2 - 0.7), 0xb01018));
    const grille = xs(-0.48 * hw0, 0.48 * hw0, q(8, 2)).map((x) => [x, outline(Math.abs(x), 1, 0.008)] as [number, number]);
    trim.push(colored(band(grille, hy - 0.2, hy - 0.02, refY, L / 2 - 0.7), 0x1b1c1e));
    const lower = xs(-0.62 * hw0, 0.62 * hw0, q(8, 2)).map((x) => [x, outline(Math.abs(x), 1, 0.008)] as [number, number]);
    trim.push(colored(band(lower, clear + 0.1, clear + 0.27, refY, L / 2 - 0.7), 0x1e1f21));
    const plateF = xs(-0.26, 0.26, 2).map((x) => [x, outline(Math.abs(x), 1, 0.02)] as [number, number]);
    trim.push(colored(band(plateF, clear + 0.3, clear + 0.41, refY, L / 2 - 0.7), 0xf2f2ec));
    const py = hatch ? clear + 0.42 : trunkY - 0.42;
    const plateR = xs(-0.26, 0.26, 2).map((x) => [x, outline(Math.abs(x), -1, 0.02)] as [number, number]);
    trim.push(colored(band(plateR, py, py + 0.11, refY, L / 2 - 0.7), 0xf2f2ec));
    const diff = xs(-0.7 * hw0, 0.7 * hw0, q(8, 2)).map((x) => [x, outline(Math.abs(x), -1, 0.008)] as [number, number]);
    trim.push(colored(band(diff, clear + 0.12, clear + 0.2, refY, L / 2 - 0.7), 0x1e1f21));
  }

  for (const zc of [wb / 2 + wbOff, -wb / 2 + wbOff]) {
    for (const sx of [-1, 1]) wheel(sx * (hw0 - 0.14), zc, wr, 0.23, sx, trim);
    trim.push(colored(wellLiner(zc, wr + 0.07, wr, W * 0.92), 0x141516));
  }
  if (taxi) {
    const m = (roofF + roofR) / 2;
    trim.push(colored(box(0, H + 0.02, m, 0.5, 0.04, 0.2), 0x202020));
    lights.push(colored(box(0, H + 0.13, m, 0.46, 0.18, 0.17), 0xffe7a0));
  }
  return { paint, glass, trim, lights };
}

// ---------------------------------------------------------------- rounded box loft (cabs, bus)
function roundedBody(z0: number, z1: number, n: number, w: (z: number) => number, y0: number | ((z: number) => number), top: (z: number) => number, ex: number, refY: number) {
  const rings: V[][] = [];
  for (let i = 0; i <= n; i++) {
    const z = z0 + ((z1 - z0) * i) / n;
    const hw = w(z);
    const yt = top(z);
    const yb = typeof y0 === 'number' ? y0 : y0(z);
    const yc = (yt + yb) / 2;
    const hh = (yt - yb) / 2;
    const ring: V[] = [];
    const nk = q(20, 12);
    for (let k = 0; k < nk; k++) {
      const a = (k / nk) * Math.PI * 2;
      ring.push([hw * se(Math.cos(a), ex), yc + hh * se(Math.sin(a), ex), z]);
    }
    rings.push(ring);
  }
  return loft(rings, true, refY, Math.abs(z1 - z0) / 2 - 0.3);
}

// ---------------------------------------------------------------- truck (1-ton, cab-over)
function truck() {
  const paint: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];
  const trim: THREE.BufferGeometry[] = [];
  const lights: THREE.BufferGeometry[] = [];
  const W = 1.74;
  const L = 5.1;
  const hw = W / 2;
  const cabL = 1.62;
  const cabRear = L / 2 - cabL;
  const y0 = 0.66;
  const roof = 2.0;
  // Cab: lofted upwards through rounded-rectangle plan sections; the front
  // face leans back above the bonnet line (windscreen) and the top rounds off.
  const front = (y: number) => L / 2 - 0.02 - Math.max(0, y - 1.1) * 0.2 - Math.pow(Math.max(0, (y - 1.88) / 0.12), 2) * 0.12;
  const width = (y: number) => hw * (1 - Math.pow(Math.max(0, (y - 1.9) / 0.1), 2) * 0.1);
  const sec = (y: number) => ({ zc: (front(y) + cabRear) / 2, hl: (front(y) - cabRear) / 2, hw: width(y) });
  const rings: V[][] = [];
  const ysA = [y0, 0.8, 1.0, 1.1, 1.3, 1.5, 1.7, 1.82, 1.9, 1.95, 1.98, 2.0];
  for (const y of ysA) {
    const { zc, hl, hw: w } = sec(y);
    const r: V[] = [];
    const nk = q(32, 16);
    for (let k = 0; k < nk; k++) {
      const a = (k / nk) * Math.PI * 2;
      r.push([w * se(Math.cos(a), 10), y, zc + hl * se(Math.sin(a), 10)]);
    }
    rings.push(r);
  }
  // Close the roof.
  const capY = roof + 0.015;
  const { zc: czc, hl: chl } = sec(roof);
  rings.push(rings[rings.length - 1].map(([x, , z]) => [x * 0.9, capY, czc + (z - czc) * 0.94] as V));
  rings.push(rings[rings.length - 1].map(([x, , z]) => [x * 0.02, capY + 0.002, czc + (z - czc) * 0.02] as V));
  void chl;
  // Lofting along y: reference axis is vertical, so use a custom outward test.
  const cab = loftY(rings, czc, true);
  paint.push(cab);
  const frontAt = (x: number, y: number, out = 0.012) => {
    const { zc, hl, hw: w } = sec(y);
    return zc + hl * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(x) / w, 5)), 1 / 5) + out;
  };
  const sideAt = (z: number, y: number, out = 0.012) => {
    const { zc, hl, hw: w } = sec(y);
    return w * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(z - zc) / hl, 5)), 1 / 5) + out;
  };
  const yRange = (a: number, b: number, n: number) => Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
  const xRange = (a: number, b: number, n: number) => Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
  // Windscreen and side windows, following the cab surface.
  glass.push(loftY(yRange(1.16, 1.86, 5).map((y) => xRange(-0.84 * hw, 0.84 * hw, 10).map((x) => [x, y, frontAt(x, y)] as V)), czc));
  for (const sx of [-1, 1]) {
    glass.push(loftY(yRange(1.2, 1.82, 4).map((y) => xRange(cabRear + 0.75, front(y) - 0.22, 6).map((z) => [sx * sideAt(z, y), y, z] as V)), czc));
    // Door shut line and handle.
    const dz = cabRear + 0.68;
    trim.push(colored(box(sx * (sideAt(dz, 1.2) + 0.002), 1.26, dz, 0.006, 1.1, 0.008), 0x0c0c0d));
    trim.push(colored(box(sx * (sideAt(dz + 0.2, 1.12) + 0.006), 1.12, dz + 0.2, 0.02, 0.03, 0.15), 0x9a9ea4));
    // Mirror on a frame.
    trim.push(colored(box(sx * (hw + 0.2), 1.62, front(1.6) - 0.15, 0.05, 0.3, 0.14), 0x161616));
    trim.push(colored(box(sx * (hw + 0.1), 1.7, front(1.7) - 0.15, 0.2, 0.025, 0.025), 0x161616));
    // Headlamp and turn signal low on the front face.
    const lx0 = 0.55 * hw;
    const lx1 = 0.92 * hw;
    lights.push(colored(loftY(yRange(0.86, 0.98, 1).map((y) => xRange(sx * lx0, sx * lx1, 4).map((x) => [x, y, frontAt(x, y, 0.016)] as V)), czc), 0xfff6e4));
    lights.push(colored(loftY(yRange(0.8, 0.85, 1).map((y) => xRange(sx * 0.7 * hw, sx * lx1, 3).map((x) => [x, y, frontAt(x, y, 0.016)] as V)), czc), 0xffa030));
    lights.push(colored(box(sx * 0.72, 0.72, cabRear - 3.19, 0.22, 0.12, 0.04), 0xd8141c));
    // Step under the door.
    trim.push(colored(box(sx * (hw - 0.08), 0.56, cabRear + 0.55, 0.18, 0.05, 0.5), 0x1c1c1c));
  }
  // Grille band and bumper.
  trim.push(colored(loftY(yRange(0.86, 1.02, 1).map((y) => xRange(-0.5 * hw, 0.5 * hw, 6).map((x) => [x, y, frontAt(x, y, 0.014)] as V)), czc), 0x202224));
  trim.push(colored(box(0, 0.62, L / 2 + 0.04, W * 0.98, 0.18, 0.12), 0x2a2b2d));
  trim.push(colored(box(0, 0.62, L / 2 + 0.105, 0.52, 0.11, 0.01), 0xf2f2ec));
  // Chassis, flatbed with low drop-sides, headboard.
  trim.push(colored(box(0, 0.48, -0.6, W * 0.7, 0.16, L - 1.3), 0x1c1c1c));
  trim.push(colored(box(0, 0.78, cabRear - 1.62, W + 0.04, 0.08, 3.12), 0x8a8e93));
  for (const sx of [-1, 1]) trim.push(colored(box(sx * (W / 2 + 0.02), 0.99, cabRear - 1.62, 0.04, 0.38, 3.12), 0xa4aab0));
  trim.push(colored(box(0, 0.99, cabRear - 3.16, W + 0.08, 0.38, 0.04), 0xa4aab0));
  trim.push(colored(box(0, 1.3, cabRear - 0.08, W, 1.0, 0.05), 0x6c7076));
  for (const zc of [L / 2 - 0.62, -1.45]) for (const sx of [-1, 1]) wheel(sx * 0.73, zc, 0.31, 0.2, sx, trim, 6);
  return { paint, glass, trim, lights };
}

/** Loft for rings stacked in y (cab shells): faces point away from (0, y, zc). */
function loftY(rings: V[][], zc: number, closed = false, yLo = 0.9, yHi = 1.7): THREE.BufferGeometry {
  // Swap y and z so the generic loft's long-axis test (about x = 0, y = refY,
  // z clamped) applies with the vertical as the long axis.
  const ym = (yLo + yHi) / 2;
  const sw = rings.map((r) => r.map(([x, y, z]) => [x, z, y - ym] as V));
  const g = loft(sw, closed, zc, (yHi - yLo) / 2);
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setY(i, p.getZ(i) + ym);
    p.setZ(i, y);
    const ny = n.getY(i);
    n.setY(i, n.getZ(i));
    n.setZ(i, ny);
  }
  // The swap mirrors the mesh: restore the winding.
  const pa = p.array as Float32Array;
  const na = n.array as Float32Array;
  for (let i = 0; i < p.count; i += 3) {
    for (let k = 0; k < 3; k++) {
      const t = pa[(i + 1) * 3 + k];
      pa[(i + 1) * 3 + k] = pa[(i + 2) * 3 + k];
      pa[(i + 2) * 3 + k] = t;
      const u = na[(i + 1) * 3 + k];
      na[(i + 1) * 3 + k] = na[(i + 2) * 3 + k];
      na[(i + 2) * 3 + k] = u;
    }
  }
  return g;
}

// ---------------------------------------------------------------- city bus
function bus() {
  const paint: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];
  const trim: THREE.BufferGeometry[] = [];
  const lights: THREE.BufferGeometry[] = [];
  const W = 2.49;
  const L = 11.0;
  const H = 3.15;
  const halfW = (z: number) => (W / 2) * Math.sqrt(Math.max(0.02, 1 - Math.pow(Math.abs(z) / (L / 2), 14)));
  // Lower body in the route colour (wheel arches cut in), glazing band, white roof section.
  const axles = [L / 2 - 2.3, -L / 2 + 3.0];
  const sill = (z: number) => {
    let y = 0.3;
    for (const zc of axles) {
      const d = Math.abs(z - zc);
      if (d < 0.6) y = Math.max(y, 0.5 + Math.sqrt(0.36 - d * d));
    }
    return Math.min(y, 1.12);
  };
  paint.push(plain(roundedBody(-L / 2, L / 2, q(64, 24), halfW, sill, () => 1.2, 10, 0.75)));
  // Kerbside doors (right-hand traffic: the -x side), glass to the floor.
  for (const [dz, dw] of [[L / 2 - 0.95, 1.05], [-0.35, 1.25]]) {
    glass.push(plain(box(-(W / 2 + 0.008), 1.32, dz, 0.02, 2.05, dw)));
    trim.push(colored(box(-(W / 2 + 0.012), 1.32, dz, 0.012, 2.05, 0.035), 0x1b1c1e));
  }
  glass.push(plain(roundedBody(-L / 2 + 0.02, L / 2 - 0.02, q(30, 6), (z) => halfW(z) - 0.012, 1.15, () => 2.45, 12, 1.8)));
  trim.push(colored(roundedBody(-L / 2, L / 2, q(30, 8), halfW, 2.4, (z) => H - 0.12 * Math.pow(Math.abs(z) / (L / 2), 8), 8, 2.75), 0xf0f0ec));
  for (let k = 0; k < 6; k++) {
    const z = -L / 2 + 1.2 + k * 1.75;
    for (const sx of [-1, 1]) trim.push(colored(box(sx * (W / 2 + 0.004), 1.8, z, 0.02, 1.3, 0.09), 0x1b1c1e));
  }
  trim.push(colored(box(0, H + 0.05, -0.5, W * 0.7, 0.18, 3.2), 0xd8d8d4)); // roof unit
  trim.push(colored(box(0, 0.24, 0, W * 0.9, 0.12, L * 0.9), 0x1a1a1a));
  lights.push(colored(box(0, 2.62, L / 2 + 0.005, 1.5, 0.22, 0.03), 0xffa040)); // route display
  lights.push(colored(box(0, 2.62, -L / 2 - 0.005, 1.0, 0.2, 0.03), 0xffa040));
  for (const sx of [-1, 1]) {
    lights.push(colored(box(sx * 0.95, 0.62, L / 2 - 0.01, 0.34, 0.16, 0.04), 0xfff6e4));
    lights.push(colored(box(sx * 1.0, 0.75, -L / 2 + 0.01, 0.22, 0.34, 0.04), 0xd8141c));
  }
  for (const zc of axles) {
    for (const sx of [-1, 1]) wheel(sx * 1.02, zc, 0.5, 0.3, sx, trim, 8);
    trim.push(colored(wellLiner(zc, 0.6, 0.5, W * 0.95), 0x141516));
  }
  return { paint, glass, trim, lights };
}

// ---------------------------------------------------------------- materials
function materials(night: { value: number }) {
  const paint = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.34, metalness: 0.45, clearcoat: 1, clearcoatRoughness: 0.04 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x080b0f, roughness: 0.04, metalness: 0.25, envMapIntensity: 2.0 });
  const trim = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.55, metalness: 0.3, side: THREE.DoubleSide });
  const lights = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.2, metalness: 0.1 });
  lights.onBeforeCompile = (s) => {
    s.uniforms.uNight = night;
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * mix(0.18, 3.0, uNight);');
  };
  lights.customProgramCacheKey = () => 'kta-carlights-1';
  return { paint, glass, trim, lights };
}

export interface CarLods {
  near: CarPart[];
  far: CarPart[];
}

let cache: Map<CarType, CarLods> | null = null;

/** Geometry + materials for every vehicle type, near and far detail (built once). */
export function carParts(night: { value: number }): Map<CarType, CarLods> {
  if (cache) return cache;
  const mats = materials(night);
  cache = new Map();
  for (const t of CAR_TYPES) {
    const near = build(t, mats, false);
    const far = build(t, mats, true);
    cache.set(t, { near, far });
  }
  return cache;
}

function build(t: CarType, mats: ReturnType<typeof materials>, low: boolean): CarPart[] {
  LOW = low;
  {
    const g = t === 'truck' ? truck() : t === 'bus' ? bus() : passenger(SPECS[t === 'taxi' ? 'sedan' : (t as 'sedan' | 'compact' | 'suv')], t === 'taxi');
    const parts: CarPart[] = [];
    const add = (list: THREE.BufferGeometry[], mat: THREE.Material, tint: boolean, shadow: boolean) => {
      if (!list.length) return;
      const m = mergeGeometries(list.map(plain))!;
      m.computeBoundingSphere();
      parts.push({ geo: m, mat, tint, shadow });
    };
    add(g.paint, mats.paint, true, true);
    add(g.glass, mats.glass, false, true);
    add(g.trim, mats.trim, false, true);
    add(g.lights, mats.lights, false, false);
    LOW = false;
    return parts;
  }
}

export const PAINTS = [0xf2f2f0, 0xf2f2f0, 0xe9e9e6, 0x1b1c1e, 0x2a2b2d, 0x9ba0a6, 0x8a8f95, 0x6f747a, 0x3b4048, 0x1f3556, 0x6a1e22, 0x2f4b3a, 0xc8c3b8];
export const TAXI_PAINT = [0xe8913a, 0xe8913a, 0xd9dcdf, 0xf2f2f0];
export const BUS_PAINT = [0x2f6bd8, 0x3aa34a, 0x3aa34a, 0xf2c230];

/** Paint colour for a vehicle from a stable hash. */
export function paintFor(type: CarType, h: number) {
  const pick = (arr: number[]) => arr[Math.abs(Math.floor(h)) % arr.length];
  if (type === 'taxi') return pick(TAXI_PAINT);
  if (type === 'bus') return pick(BUS_PAINT);
  if (type === 'truck') return pick([0x1f4fa0, 0xf2f2f0, 0x2a5fb8]);
  return pick(PAINTS);
}
