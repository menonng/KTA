// Seoul street kit built in code: the street-tree species of the Seoul
// street-tree register (late-November state) and bus-stop furniture.
//
// Trees: a tapered trunk, scaffold limbs and side branches (bark atlas
// column per species), with alpha-tested twig/leaf cards hung on the branch
// tips (card atlas cell per species, painted by build_species.mjs). The card
// "up" follows the branch so twigs grow out of it; card normals are bent
// away from the crown centre for soft volume shading.
//
// Bus stops: the Seoul roadside shelter (charcoal steel frame, glass back
// wall, cantilever roof, bench, BIT arrival display, light-box advert), the
// Hongdae median 스마트쉘터 (enclosed glass box under a hanok-style roof with
// lifted eaves and solar panels, opened 2021-08-27), the pole sign, and a
// folded crossing shade parasol (접이식 그늘막, wrapped for winter).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface KitPart {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
}

let seed = 1;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const rr = (a: number, b: number) => a + (b - a) * rnd();

// ---------------------------------------------------------------- trees ---

interface TreeSpec {
  /** Overall height (m). */
  h: number;
  /** Clear trunk height before the first limbs. */
  trunk: number;
  r0: number;
  /** Trunk continues as a leader to near the top (ginkgo, pine). */
  leader: boolean;
  limbs: number;
  /** Limb angle from vertical (rad). */
  ang: [number, number];
  limbLen: [number, number];
  sub: number;
  /** Pollarded: limbs end in knuckles with a cluster of shoots (Seoul planes). */
  pollard?: boolean;
  crownR: number;
  cell: number;
  cards: number;
  card: [number, number];
  bark: number;
  /** Radial segments of the trunk. */
  seg?: number;
}

/** Species order = kta_core::data::species (ginkgo first). */
const SPECIES: TreeSpec[] = [
  // 은행나무: tall, narrow, excurrent; short spurs, last yellow leaves.
  { h: 11, trunk: 2.4, r0: 0.17, leader: true, limbs: 9, ang: [0.6, 0.95], limbLen: [1.4, 2.4], sub: 2, crownR: 2.2, cell: 0, cards: 44, card: [1.3, 1.9], bark: 3 },
  // 양버즘나무: thick trunk, pollarded scaffold limbs with knuckles, camouflage bark.
  { h: 11.5, trunk: 3.2, r0: 0.26, leader: false, limbs: 4, ang: [0.45, 0.7], limbLen: [3.4, 4.4], sub: 3, pollard: true, crownR: 3.2, cell: 1, cards: 46, card: [1.5, 2.2], bark: 0 },
  // 느티나무: short trunk, vase of many ascending limbs, fine twigs.
  { h: 10.5, trunk: 2.2, r0: 0.22, leader: false, limbs: 6, ang: [0.35, 0.6], limbLen: [3.6, 5.0], sub: 3, crownR: 3.8, cell: 2, cards: 56, card: [1.6, 2.4], bark: 3 },
  // 이팝나무: small, rounded.
  { h: 6.8, trunk: 1.9, r0: 0.13, leader: false, limbs: 5, ang: [0.6, 0.95], limbLen: [1.8, 2.6], sub: 2, crownR: 2.2, cell: 3, cards: 34, card: [1.2, 1.7], bark: 3 },
  // 벚나무: spreading, bare; lenticel bark.
  { h: 7.5, trunk: 1.8, r0: 0.16, leader: false, limbs: 4, ang: [0.8, 1.15], limbLen: [2.6, 3.6], sub: 3, crownR: 3.2, cell: 4, cards: 36, card: [1.3, 1.9], bark: 1 },
  // 회화나무: rounded, mostly bare.
  { h: 9, trunk: 2.3, r0: 0.18, leader: false, limbs: 5, ang: [0.6, 0.95], limbLen: [2.4, 3.4], sub: 3, crownR: 3.0, cell: 7, cards: 42, card: [1.4, 2.0], bark: 3 },
  // 소나무: leaning trunk, tiered limbs, needle tufts, red upper bark.
  { h: 7, trunk: 2.6, r0: 0.16, leader: true, limbs: 7, ang: [1.05, 1.35], limbLen: [1.2, 2.2], sub: 2, crownR: 2.4, cell: 5, cards: 40, card: [1.2, 1.7], bark: 2 },
  // 단풍나무류: small rounded, last red leaves.
  { h: 6, trunk: 1.6, r0: 0.12, leader: false, limbs: 5, ang: [0.6, 1.0], limbLen: [1.8, 2.5], sub: 2, crownR: 2.3, cell: 6, cards: 34, card: [1.2, 1.7], bark: 3 },
  // 기타: generic deciduous.
  { h: 6.5, trunk: 1.8, r0: 0.13, leader: false, limbs: 5, ang: [0.6, 0.95], limbLen: [1.8, 2.6], sub: 2, crownR: 2.2, cell: 7, cards: 32, card: [1.2, 1.7], bark: 3 },
];

const V = THREE.Vector3;

/** Tapered tube along a polyline (bark UVs into one atlas column). */
function tube(path: THREE.Vector3[], r0: number, r1: number, seg: number, col: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const n = path.length;
  let along = 0;
  const up = new V(0, 1, 0);
  const t = new V();
  const a = new V();
  const b = new V();
  for (let i = 0; i < n; i++) {
    if (i > 0) along += path[i].distanceTo(path[i - 1]);
    t.copy(path[Math.min(i + 1, n - 1)]).sub(path[Math.max(i - 1, 0)]).normalize();
    a.copy(Math.abs(t.dot(up)) > 0.95 ? new V(1, 0, 0) : up).cross(t).normalize();
    b.copy(t).cross(a).normalize();
    const r = r0 + (r1 - r0) * (i / (n - 1));
    for (let k = 0; k <= seg; k++) {
      const th = (k / seg) * Math.PI * 2;
      const dx = a.x * Math.cos(th) + b.x * Math.sin(th);
      const dy = a.y * Math.cos(th) + b.y * Math.sin(th);
      const dz = a.z * Math.cos(th) + b.z * Math.sin(th);
      pos.push(path[i].x + dx * r, path[i].y + dy * r, path[i].z + dz * r);
      nrm.push(dx, dy, dz);
      uv.push((col + 0.02 + (k / seg) * 0.96) / 4, along / 1.6);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < seg; k++) {
      const p = i * (seg + 1) + k;
      const q = p + seg + 1;
      idx.push(p, q, p + 1, p + 1, q, q + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Bent branch path from p along dir (unit), with a little droop/curl. */
function branchPath(p: THREE.Vector3, dir: THREE.Vector3, len: number, steps: number, curl: number): THREE.Vector3[] {
  const out = [p.clone()];
  const d = dir.clone();
  const cur = p.clone();
  for (let i = 1; i <= steps; i++) {
    d.x += (rnd() - 0.5) * curl;
    d.z += (rnd() - 0.5) * curl;
    d.y += (rnd() - 0.5) * curl * 0.5;
    d.normalize();
    cur.addScaledVector(d, len / steps);
    out.push(cur.clone());
  }
  return out;
}

function card(at: THREE.Vector3, up: THREE.Vector3, size: number, cell: number, centre: THREE.Vector3): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(size, size);
  // Atlas UVs (4 x 2 cells, KTX2 is not flipped: row 0 at v = 0).
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const cx = cell % 4;
  const cy = Math.floor(cell / 4);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (cx + uv.getX(i)) / 4, (cy + 1 - uv.getY(i)) / 2);
  // Bottom centre of the card at the tip; card up along the branch, random roll.
  g.translate(0, size / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new V(0, 1, 0), up);
  const roll = new THREE.Quaternion().setFromAxisAngle(new V(0, 1, 0), rnd() * Math.PI);
  g.applyQuaternion(roll).applyQuaternion(q);
  g.translate(at.x, at.y, at.z);
  // Normals bent outward from the crown centre.
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  const v = new V();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i)).sub(centre);
    v.y *= 0.6;
    v.normalize();
    n.setXYZ(i, v.x, v.y * 0.8 + 0.25, v.z);
  }
  return g;
}

function buildTreeGeo(s: TreeSpec, sd: number): { wood: THREE.BufferGeometry; cards: THREE.BufferGeometry } {
  seed = sd;
  const wood: THREE.BufferGeometry[] = [];
  const cards: THREE.BufferGeometry[] = [];
  const tips: { p: THREE.Vector3; d: THREE.Vector3 }[] = [];
  const lean = new V(rr(-0.06, 0.06), 1, rr(-0.06, 0.06)).normalize();
  if (s.cell === 5) lean.set(rr(-0.25, 0.25), 1, rr(-0.25, 0.25)).normalize();
  const topY = s.leader ? s.h * 0.88 : s.trunk + 0.4;
  const trunkPath = branchPath(new V(0, 0, 0), lean, topY, s.leader ? 6 : 3, 0.08);
  wood.push(tube(trunkPath, s.r0, s.leader ? s.r0 * 0.25 : s.r0 * 0.75, s.seg ?? 8, s.bark));
  const centre = new V(0, s.trunk + (s.h - s.trunk) * 0.55, 0);
  const at = (y: number) => {
    // Point on the trunk path at height y.
    for (let i = 1; i < trunkPath.length; i++) {
      if (trunkPath[i].y >= y) {
        const a = trunkPath[i - 1];
        const b = trunkPath[i];
        return a.clone().lerp(b, (y - a.y) / Math.max(1e-3, b.y - a.y));
      }
    }
    return trunkPath[trunkPath.length - 1].clone();
  };
  for (let i = 0; i < s.limbs; i++) {
    const y = s.leader ? s.trunk + (topY - s.trunk) * (i / s.limbs) * 0.92 + rr(-0.2, 0.2) : s.trunk + rr(0, 0.5);
    const az = i * 2.39996 + rr(-0.3, 0.3);
    const ang = rr(s.ang[0], s.ang[1]) * (s.leader ? 1 - 0.25 * (i / s.limbs) : 1);
    const dir = new V(Math.sin(ang) * Math.cos(az), Math.cos(ang), Math.sin(ang) * Math.sin(az)).normalize();
    // Leader trees: limbs shorten towards the top (conical crown).
    const len = rr(s.limbLen[0], s.limbLen[1]) * (s.leader ? 1 - 0.55 * (i / s.limbs) : 1);
    const base = at(y);
    const path = branchPath(base, dir, len, 3, s.cell === 5 ? 0.15 : 0.35);
    const lr = s.r0 * (s.leader ? 0.42 : 0.62);
    wood.push(tube(path, lr, lr * 0.35, 6, s.bark));
    const end = path[path.length - 1];
    const endDir = end.clone().sub(path[path.length - 2]).normalize();
    if (s.pollard) {
      // Knuckle and a crown of thin water shoots.
      wood.push(tube([end.clone().addScaledVector(endDir, -0.15), end.clone().addScaledVector(endDir, 0.12)], lr * 0.55, lr * 0.5, 6, s.bark));
      for (let k = 0; k < 6; k++) {
        const sdir = endDir.clone().add(new V(rr(-0.7, 0.7), rr(0.2, 0.9), rr(-0.7, 0.7))).normalize();
        const sp = branchPath(end, sdir, rr(0.9, 1.6), 2, 0.3);
        wood.push(tube(sp, 0.025, 0.01, 4, s.bark));
        tips.push({ p: sp[sp.length - 1], d: sdir });
      }
    } else {
      tips.push({ p: end, d: endDir });
    }
    for (let k = 0; k < s.sub; k++) {
      const t = rr(0.35, 0.85);
      const fi = Math.min(path.length - 2, Math.floor(t * (path.length - 1)));
      const p0 = path[fi].clone().lerp(path[fi + 1], t * (path.length - 1) - fi);
      const sdir = dir.clone().add(new V(rr(-0.9, 0.9), rr(-0.1, 0.6), rr(-0.9, 0.9))).normalize();
      const sp = branchPath(p0, sdir, len * rr(0.35, 0.55), 2, 0.4);
      wood.push(tube(sp, lr * 0.4, lr * 0.12, 5, s.bark));
      tips.push({ p: sp[sp.length - 1], d: sdir });
    }
  }
  if (s.leader) tips.push({ p: trunkPath[trunkPath.length - 1], d: new V(0, 1, 0) });
  // Cards on the tips first, the rest along random tips with jitter inside the crown.
  for (let i = 0; i < s.cards; i++) {
    const t = tips[i % tips.length];
    const p = t.p.clone();
    if (i >= tips.length) p.add(new V(rr(-0.6, 0.6), rr(-0.5, 0.4), rr(-0.6, 0.6)));
    const up = t.d.clone().add(new V(rr(-0.5, 0.5), rr(0.1, 0.6), rr(-0.5, 0.5))).normalize();
    p.addScaledVector(up, -0.35);
    cards.push(card(p, up, rr(s.card[0], s.card[1]), s.cell, centre));
  }
  const w = mergeGeometries(wood)!;
  const c = mergeGeometries(cards)!;
  w.computeBoundingSphere();
  c.computeBoundingSphere();
  return { wood: w, cards: c };
}

/** One model (wood + cards part) per species, same order as kta_core species ids. */
export function speciesTrees(cardsTex: THREE.Texture, barkTex: THREE.Texture, barkN: THREE.Texture): KitPart[][] {
  cardsTex.colorSpace = THREE.SRGBColorSpace;
  barkTex.colorSpace = THREE.SRGBColorSpace;
  barkTex.wrapT = THREE.RepeatWrapping;
  barkN.wrapS = barkN.wrapT = THREE.RepeatWrapping;
  const woodMat = new THREE.MeshStandardMaterial({ map: barkTex, normalMap: barkN, roughness: 0.93 });
  const cardMat = new THREE.MeshStandardMaterial({ map: cardsTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.82 });
  return SPECIES.map((s, i) => {
    const g = buildTreeGeo(s, 101 + i * 977);
    return [
      { geo: g.wood, mat: woodMat },
      { geo: g.cards, mat: cardMat },
    ];
  });
}

// ------------------------------------------------------------ furniture ---

/** Collects coloured boxes / cylinders into one vertex-coloured geometry. */
class Kit {
  private parts: THREE.BufferGeometry[] = [];
  box(w: number, h: number, d: number, x: number, y: number, z: number, col = 0xffffff, ry = 0, rx = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rx) g.rotateX(rx);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    this.paint(g, col);
  }
  cyl(r0: number, r1: number, h: number, x: number, y: number, z: number, col: number, seg = 10) {
    const g = new THREE.CylinderGeometry(r1, r0, h, seg);
    g.translate(x, y + h / 2, z);
    this.paint(g, col);
  }
  geo(g: THREE.BufferGeometry, col: number) {
    this.paint(g, col);
  }
  private paint(g: THREE.BufferGeometry, col: number) {
    const c = new THREE.Color(col);
    const n = g.getAttribute('position').count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    if (g.index) g = g.toNonIndexed();
    g.deleteAttribute('uv');
    this.parts.push(g);
  }
  build(): THREE.BufferGeometry {
    const g = mergeGeometries(this.parts)!;
    g.computeBoundingSphere();
    return g;
  }
  get empty() {
    return this.parts.length === 0;
  }
}

export interface StreetKitMats {
  frame: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  light: THREE.MeshStandardMaterial;
  fabric: THREE.MeshStandardMaterial;
}

export function kitMaterials(): StreetKitMats {
  return {
    frame: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35 }),
    glass: new THREE.MeshStandardMaterial({ color: 0xbcd0d4, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.28, depthWrite: false }),
    light: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 0.25 }),
    fabric: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
  };
}

const STEEL = 0x3b3e42;
const STEEL_LIGHT = 0x6d7175;

/**
 * Seoul roadside shelter, 7.2 x 1.8 m, 2.75 m high, facing +z (the road).
 * Origin at the pavement under the middle of the front edge line of the bench.
 */
export function shelter(m: StreetKitMats): KitPart[] {
  const f = new Kit();
  const glass = new Kit();
  const light = new Kit();
  const L = 7.2;
  const back = -0.75;
  for (const x of [-L / 2 + 0.15, 0, L / 2 - 0.15]) f.box(0.1, 2.62, 0.16, x, 1.31, back, STEEL);
  // Cantilever roof sloping slightly back, with a fascia.
  f.box(L + 0.3, 0.12, 1.95, 0, 2.72, back + 0.85, STEEL, 0, -0.04);
  f.box(L + 0.3, 0.22, 0.06, 0, 2.66, back + 1.82, STEEL_LIGHT);
  // Rails top and bottom of the glass.
  f.box(L, 0.06, 0.08, 0, 2.3, back, STEEL);
  f.box(L, 0.08, 0.08, 0, 0.22, back, STEEL);
  glass.box(L - 0.2, 2.06, 0.02, 0, 1.26, back);
  // Bench (perforated steel look) on two legs.
  f.box(3.2, 0.05, 0.42, -0.6, 0.46, back + 0.32, 0x8a8f94);
  for (const x of [-2.0, 0.8]) f.box(0.06, 0.44, 0.34, x, 0.22, back + 0.3, STEEL);
  // Light-box advert at the right end (double sided), BIT under the roof front.
  f.box(0.14, 2.0, 1.3, L / 2 - 0.08, 1.15, back + 0.72, STEEL);
  light.box(0.16, 1.72, 1.12, L / 2 - 0.08, 1.15, back + 0.72, 0xf2efe6);
  f.box(1.5, 0.42, 0.12, -1.6, 2.38, back + 1.55, 0x1a1c1e);
  light.box(1.36, 0.3, 0.13, -1.6, 2.38, back + 1.55, 0xffa21a);
  // Stop-name board on the roof end.
  f.box(1.6, 0.36, 0.08, -L / 2 + 1.0, 2.98, back + 0.2, 0xf0f0ea);
  light.box(1.5, 0.08, 0.09, -L / 2 + 1.0, 3.12, back + 0.2, 0x2a64c8);
  return [
    { geo: f.build(), mat: m.frame },
    { geo: glass.build(), mat: m.glass },
    { geo: light.build(), mat: m.light },
  ];
}

/**
 * Hongdae median 스마트쉘터: enclosed glass waiting room (12 m x 2.4 m) under a
 * hanok-style roof whose eaves lift at both ends, solar panels on top,
 * polycarbonate screen doors on the bus side (+z), screens and benches inside.
 */
export function smartShelter(m: StreetKitMats): KitPart[] {
  const f = new Kit();
  const glass = new Kit();
  const light = new Kit();
  const L = 12;
  const D = 2.4;
  const H = 3.1;
  // Corner and mullion posts.
  for (let i = 0; i <= 8; i++) {
    const x = -L / 2 + (i / 8) * L;
    f.box(0.08, H, 0.08, x, H / 2, -D / 2, STEEL);
    f.box(0.08, H, 0.08, x, H / 2, D / 2, STEEL);
  }
  for (const z of [-D / 2, D / 2]) {
    f.box(L, 0.1, 0.1, 0, H, z, STEEL);
    f.box(L, 0.12, 0.1, 0, 0.06, z, STEEL);
    glass.box(L - 0.1, H - 0.2, 0.02, 0, H / 2, z);
  }
  for (const x of [-L / 2, L / 2]) glass.box(0.02, H - 0.2, D - 0.1, x, H / 2, 0);
  // Screen doors (frosted strips) on the bus side, one per berth.
  for (const x of [-3.8, 0, 3.8]) f.box(1.6, 0.05, 0.05, x, 2.2, D / 2 + 0.03, 0x9aa4a8);
  // Hanok roof: thin curved slab, ends lifted, wide eaves.
  const RL = L + 1.6;
  const RD = D + 1.4;
  const nx = 24;
  const roof = new THREE.PlaneGeometry(RL, RD, nx, 1).rotateX(-Math.PI / 2);
  const rp = roof.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < rp.count; i++) {
    const x = rp.getX(i);
    const z = rp.getZ(i);
    const t = Math.abs(x) / (RL / 2);
    rp.setY(i, H + 0.35 + 0.5 * t ** 3 + 0.12 * (1 - Math.abs(z) / (RD / 2)));
  }
  roof.computeVertexNormals();
  f.geo(roof, 0x2f3236);
  // Underside: warm wood-tone soffit (faces down).
  const soffit = roof.clone().rotateZ(Math.PI).rotateY(Math.PI);
  const sp = soffit.getAttribute('position') as THREE.BufferAttribute;
  const rp2 = roof.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < sp.count; i++) sp.setY(i, rp2.getY(i) - 0.07);
  soffit.computeVertexNormals();
  f.geo(soffit, 0x8a6a4a);
  // Fascia band under the roof at the walls (AC units hidden in it).
  f.box(L + 0.2, 0.32, D + 0.2, 0, H + 0.18, 0, 0x3a3d40);
  // Solar panels.
  for (let i = -2; i <= 2; i++) f.box(1.9, 0.04, 1.6, i * 2.1, H + 0.5 + (Math.abs(i) > 1 ? 0.05 : 0), -0.2, 0x1c2433);
  // Inside: benches, screens, ceiling light strip.
  for (const x of [-3.8, 0, 3.8]) {
    f.box(2.4, 0.06, 0.45, x, 0.46, -D / 2 + 0.35, 0x9a7a58);
    f.box(0.9, 0.55, 0.06, x + 1.4, 1.75, -D / 2 + 0.08, 0x111214);
    light.box(0.82, 0.47, 0.065, x + 1.4, 1.75, -D / 2 + 0.085, 0x8ab8e8);
  }
  light.box(L - 0.6, 0.04, 0.3, 0, H - 0.08, 0, 0xfff4e0);
  // Platform number boards over the doors.
  for (const x of [-3.8, 0, 3.8]) {
    f.box(0.7, 0.3, 0.06, x, 2.55, D / 2 + 0.06, 0x1a1c1e);
    light.box(0.6, 0.2, 0.065, x, 2.55, D / 2 + 0.07, 0x4ac06a);
  }
  return [
    { geo: f.build(), mat: m.frame },
    { geo: glass.build(), mat: m.glass },
    { geo: light.build(), mat: m.light },
  ];
}

/** Bus-stop pole sign (정류소 표지판): stop name board over a route panel. */
export function stopPole(m: StreetKitMats): KitPart[] {
  const f = new Kit();
  const light = new Kit();
  f.cyl(0.06, 0.05, 3.1, 0, 0, 0, STEEL);
  f.cyl(0.18, 0.18, 0.04, 0, 0, 0, STEEL);
  f.box(0.62, 0.34, 0.06, 0, 2.86, 0.06, 0x2a64c8);
  f.box(0.62, 0.9, 0.05, 0, 2.2, 0.06, 0xf2f2ee);
  // Route number bands (간선 blue, 지선 green, 마을 green-yellow).
  const bands = [0x2a64c8, 0x3a9a48, 0x2a64c8, 0x5aa83a, 0x3a9a48];
  bands.forEach((c, i) => f.box(0.5, 0.1, 0.055, 0, 2.52 - i * 0.15, 0.06, c));
  light.box(0.5, 0.06, 0.065, 0, 2.92, 0.06, 0xffffff);
  return [
    { geo: f.build(), mat: m.frame },
    { geo: light.build(), mat: m.light },
  ];
}

/** Folded crossing shade parasol (접이식 그늘막), wrapped for the winter. */
export function parasol(m: StreetKitMats): KitPart[] {
  const f = new Kit();
  const cloth = new Kit();
  f.cyl(0.42, 0.38, 0.1, 0, 0, 0, 0x55595e, 16);
  f.cyl(0.055, 0.05, 3.3, 0, 0.1, 0, 0x7a7e82);
  f.cyl(0.06, 0.03, 0.18, 0, 3.4, 0, 0x55595e);
  // Folded canopy bundle hanging around the pole, held by a cover band.
  const bundle = new THREE.CylinderGeometry(0.24, 0.11, 1.6, 12, 4, true);
  const bp = bundle.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < bp.count; i++) {
    const a = Math.atan2(bp.getZ(i), bp.getX(i));
    const k = 1 + 0.12 * Math.sin(a * 6);
    bp.setX(i, bp.getX(i) * k);
    bp.setZ(i, bp.getZ(i) * k);
  }
  bundle.translate(0, 2.55, 0);
  bundle.computeVertexNormals();
  cloth.geo(bundle, 0x3e6a4c);
  cloth.cyl(0.2, 0.2, 0.12, 0, 2.6, 0, 0xe8e6de, 12);
  cloth.cyl(0.25, 0.06, 0.12, 0, 3.35, 0, 0x3e6a4c, 12);
  return [
    { geo: f.build(), mat: m.frame },
    { geo: cloth.build(), mat: m.fabric },
  ];
}
