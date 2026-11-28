// Outfits and texture painting. Every garment is a smooth coverage function
// of the rest-pose body point (position, normal and skin-weight fields), so
// the same function decides how far the surface is pushed out (geometry) and
// where colours change (texture, painted per texel). Edges are therefore
// clean curves at texture resolution instead of the mesh's face boundaries.

// ------------------------------------------------------------------ noise
function hash(x, y, z) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const fade = (t) => t * t * (3 - 2 * t);
export function noise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi);
  let r = 0;
  for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const w = (dx ? xf : 1 - xf) * (dy ? yf : 1 - yf) * (dz ? zf : 1 - zf);
    r += w * hash(xi + dx, yi + dy, zi + dz);
  }
  return r;
}
export function fbm(x, y, z, oct = 4) {
  let s = 0, a = 0.5, f = 1, t = 0;
  for (let i = 0; i < oct; i++) {
    s += a * noise(x * f, y * f, z * f);
    t += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / t;
}
export const sstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const mul3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
/** Soft inside test: 1 well inside (d > e), 0 outside. */
const inside = (d, e = 0.004) => sstep(-e, e, d);

// ------------------------------------------------------------------ garments
/**
 * Coverage of each layer at a body point. s = { p, n, f } with f the skin-weight
 * fields (torso, head, neck, wrist, foot, lips, lidU, lidL, jaw). L = landmarks.
 */
export function coverage(outfit, s, L) {
  const [x, y, z] = s.p;
  const f = s.f;
  const c = { top: 0, bottom: 0, belt: 0, shoes: 0, hair: 0 };
  const hands = sstep(0.25, 0.6, f.wrist);
  const limbs = sstep(0.15, 0.4, f.arm + f.wrist); // arms and hands never get trousers
  const feet = y < L.ankleY + 0.05 ? 1 : 0;
  // Hair cap (crowd): above a hairline that dips from the forehead to the temples and the nape.
  if (outfit !== 'hero') {
    const ang = Math.abs(Math.atan2(x, z - L.headC[2]));
    let hl = mix(L.eyeY + 0.056, L.eyeY + 0.03, sstep(0.45, 1.25, ang));
    hl = mix(hl, L.eyeY - (outfit === 'woman' ? 0.075 : 0.045), sstep(1.9, 2.6, ang));
    c.hair = inside(y - hl, 0.006) * sstep(0.5, 0.8, f.head + f.neck * 0.5);
  }
  // Shoes: everything below the ankle (higher for the women's ankle boots).
  const shoeTop = outfit === 'woman' ? L.ankleY + 0.07 : L.ankleY + 0.035;
  c.shoes = inside(shoeTop - y, 0.006);
  if (outfit === 'hero') {
    // White ribbed tank top: scoop neck, narrow straps, deep armholes; hem tucked under the jeans.
    const torso = sstep(0.3, 0.38, f.torso);
    const front = z > L.zAxis(y);
    const neckY = front ? L.chestTop - 0.085 + 5.5 * x * x : L.neckBase - 0.035 + 3.5 * x * x;
    const ax = Math.abs(x);
    const armholeOut = mix(L.shoulderW * 1.25, L.strapOut, sstep(L.armpitY - 0.045, L.armpitY + 0.05, y));
    c.top = torso * inside(neckY - y, 0.0025) * inside(armholeOut - ax, 0.0025) * inside(y - (L.hipY - 0.06), 0.004) * (1 - hands);
    // Jeans from the waist to just over the shoes, belt at the top.
    c.bottom = inside(L.waistY - y, 0.003) * inside(y - (L.ankleY + 0.005), 0.004) * (1 - limbs);
    c.belt = c.bottom * inside(y - (L.waistY - 0.038), 0.002);
  } else {
    // Hip-length padded jacket with a stand collar; sleeves to the wrist.
    const hem = outfit === 'woman' ? L.hipY - 0.07 : L.hipY - 0.05;
    const upper = 1 - sstep(0.4, 0.7, f.head);
    const collar = inside(L.neckBase + 0.05 - y, 0.004);
    c.top = upper * collar * inside(y - hem, 0.004) * (1 - hands) * (1 - feet);
    c.bottom = inside(L.waistY + 0.02 - y, 0.004) * inside(y - (L.ankleY - 0.005), 0.004) * (1 - c.top) * (1 - limbs);
  }
  c.bottom *= 1 - c.top * (outfit === 'hero' ? 0 : 1);
  c.shoes *= 1 - c.bottom;
  return c;
}

/** Outward offset (m) of the surface from the layers present. */
export function thickness(outfit, s, c, L) {
  const y = s.p[1];
  const knee = sstep(L.kneeY, L.ankleY + 0.05, y); // 0 at knee .. 1 at ankle
  let t = 0;
  if (outfit === 'hero') {
    t = Math.max(t, c.top * 0.0035);
    t = Math.max(t, c.bottom * (0.011 + 0.012 * knee) + c.belt * 0.004);
  } else {
    const arm = sstep(0.4, 0.7, s.f.arm);
    t = Math.max(t, c.top * mix(0.045, 0.032, arm));
    t = Math.max(t, c.bottom * (outfit === 'woman' ? 0.002 : 0.006 + 0.01 * knee));
    t = Math.max(t, c.hair * (outfit === 'woman' ? 0.011 : 0.009));
  }
  t = Math.max(t, c.shoes * 0.012);
  return t;
}

// ------------------------------------------------------------------ face details shared by all
function faceDetail(s, L) {
  const [x, y, z] = s.p;
  const f = s.f;
  const r = { brow: 0, lash: 0, lips: 0, lid: 0 };
  if (f.head < 0.5) return r;
  for (const e of [L.eyeL, L.eyeR]) {
    const sg = Math.sign(e.c[0]);
    const dx = (x - e.c[0]) * sg; // + lateral
    const dy = y - e.c[1];
    // Eyebrow: an arch above the eye, thick at the inner end, tapering outwards.
    if (z > e.c[2] - 0.012 && dx > -0.026 && dx < 0.03) {
      const t = (dx + 0.024) / 0.052; // 0 inner .. 1 outer
      const cy = 0.0165 + 0.006 * Math.sin(Math.min(1, t * 1.25) * Math.PI * 0.85) - 0.003 * t;
      const half = mix(0.0052, 0.0019, t);
      const d = Math.abs(dy - cy);
      let a = sstep(half + 0.0018, half - 0.0006, d) * sstep(-0.03, -0.02, dx) * sstep(0.031, 0.024, dx);
      // Hair strands: streaks along the brow (outwards and slightly up).
      const along = dx * 0.95 + (dy - cy) * 0.3;
      const across = (dy - cy) * 0.95 - dx * 0.3;
      a *= 0.65 + 0.35 * noise(along * 220, across * 2600, sg * 7.3);
      r.brow = Math.max(r.brow, a);
    }
    // Eyelid margins: lashes along the upper lid, a softer line below.
    const d = Math.hypot(x - e.c[0], y - e.c[1], z - e.c[2]) - e.r;
    if (d < 0.006 && z > e.c[2] + 0.002) {
      const upper = dy > -0.001;
      r.lash = Math.max(r.lash, sstep(0.0028, 0.0008, d) * (upper ? 0.7 : 0.18) * sstep(-0.004, 0.004, z - e.c[2] - 0.002));
      if (upper) r.lid = Math.max(r.lid, sstep(0.009, 0.004, d));
    }
  }
  r.lips = sstep(0.5, 0.78, f.lips);
  return r;
}

// ------------------------------------------------------------------ hero (absolute colours, sRGB)
const HERO_SKIN = [92, 58, 42];
const PALM = [150, 102, 78];
const LIPS = [84, 52, 44];
const TANK = [236, 233, 226];
const DENIM = [38, 52, 82];
const DENIM_FADE = [78, 98, 132];
const STITCH = [196, 132, 62];
const BELT = [38, 27, 21];
const SHOE = [238, 238, 234];
const SOLE = [214, 212, 206];

/** Returns [r, g, b, roughness] in 0..255 (sRGB colour). */
export function paintHero(s, L) {
  const [x, y, z] = s.p;
  const c = coverage('hero', s, L);
  const ao = s.ao;
  const cavity = 0.72 + 0.28 * ao;
  // Skin.
  let col = HERO_SKIN.slice();
  const m = fbm(x * 55, y * 55, z * 55, 4);
  col = mul3(col, 0.9 + 0.2 * m);
  const fd = faceDetail(s, L);
  const palmSide = s.f.wrist > 0.4 ? Math.max(0, s.n[0] * L.palmSign(x)) : 0;
  col = mix3(col, PALM, sstep(0.25, 0.75, palmSide) * 0.65);
  col = mix3(col, mul3(LIPS, 0.95 + 0.1 * noise(x * 900, y * 900, z * 900)), fd.lips * 0.4);
  // Shaved scalp: slightly cooler and darker, with fine stubble.
  const scalp = s.f.head > 0.6 ? sstep(L.eyeY + 0.04, L.eyeY + 0.065, y + 0.02 * Math.abs(Math.atan2(x, z - L.headC[2]))) : 0;
  const stub = noise(x * 1500, y * 1500, z * 1500) > 0.62 ? 0.82 : 1;
  col = mix3(col, mul3([60, 44, 38], stub), scalp * 0.55);
  // Light stubble on the jaw and upper lip.
  const beard = sstep(0.35, 0.7, s.f.jaw) * (1 - fd.lips) * (y < L.eyeY - 0.045 ? 1 : 0);
  col = mix3(col, mul3(col, stub * 0.78), beard * 0.5);
  col = mix3(col, mul3(col, 0.92), fd.lid * 0.3);
  col = mix3(col, [26, 18, 14], fd.brow * 0.92);
  col = mix3(col, [24, 16, 12], fd.lash);
  col = mul3(col, cavity);
  let rough = mix(0.52, 0.42, fd.lips);
  // Tank top: ribbed knit, slightly greyed in folds.
  if (c.top > 0) {
    const s2 = Math.atan2(x, z - L.zAxis(y)) * 0.14;
    const rib = 0.5 + 0.5 * Math.sin((2 * Math.PI * s2) / 0.0042);
    const fold = fbm(x * 9, y * 14, z * 9, 3);
    let k = TANK.slice();
    k = mul3(k, (0.95 + 0.05 * rib) * (0.9 + 0.1 * fold));
    k = mul3(k, 0.8 + 0.2 * ao);
    col = mix3(col, k, c.top);
    rough = mix(rough, 0.92, c.top);
  }
  // Jeans: twill, fading on the thighs and knees, seams with orange stitching, pockets.
  if (c.bottom > 0) {
    const side = x >= 0 ? 1 : -1;
    const la = L.legAxis(side, y);
    const phi = Math.atan2((x - la[0]) * side, z - la[1]); // 0 front, +pi/2 outside
    const twill = 0.5 + 0.5 * Math.sin(((y * 1.0 + phi * 0.06) / 0.0016) * Math.PI * 2);
    const fadeN = fbm(x * 3, y * 3, z * 3, 3);
    const frontness = Math.max(0, Math.cos(phi));
    const thigh = sstep(L.hipY - 0.05, L.kneeY + 0.05, y) * 0 + sstep(L.kneeY - 0.06, L.kneeY + 0.25, y) * (1 - sstep(L.hipY - 0.08, L.hipY + 0.02, y));
    let fadeAmt = 0.08 + 0.35 * frontness * (0.4 + 0.6 * fadeN) * (0.3 + 0.7 * thigh);
    const knee = Math.exp(-((y - L.kneeY) ** 2) / (2 * 0.05 * 0.05)) * frontness;
    fadeAmt += 0.15 * knee;
    let j = mix3(DENIM, DENIM_FADE, Math.min(0.85, fadeAmt));
    j = mul3(j, 0.93 + 0.07 * twill);
    // Creases behind the knee and stacked folds at the hem.
    const backKnee = Math.exp(-((y - L.kneeY) ** 2) / (2 * 0.04 * 0.04)) * Math.max(0, -Math.cos(phi));
    const stack = sstep(L.ankleY + 0.12, L.ankleY + 0.02, y);
    const creases = 0.5 + 0.5 * Math.sin(y * 260 + noise(x * 40, y * 10, z * 40) * 6);
    j = mul3(j, 1 - (backKnee * 0.5 + stack * 0.35) * (1 - creases) * 0.5);
    // Outer and inner side seams.
    const seamO = Math.abs(Math.abs(phi) - Math.PI / 2 - 0.12);
    const seamI = Math.abs(Math.abs(phi) - Math.PI / 2 - 1.7);
    const seam = Math.min(seamO, seamI);
    if (y < L.hipY - 0.02 && seam < 0.07) {
      j = mul3(j, 0.85);
      const dash = (Math.floor(y / 0.0045) % 2) === 0;
      if (dash && Math.abs(seam - 0.045) < 0.012) j = STITCH.slice();
    }
    // Front pockets (curved opening) and the fly.
    const fx = Math.abs(x);
    if (z > L.zAxis(y) && y > L.hipY - 0.07) {
      const pc = Math.hypot(fx - L.pocketX, (y - L.waistY) * 1.2) - 0.075;
      if (Math.abs(pc) < 0.003) j = mul3(j, 0.6);
      else if (Math.abs(pc - 0.006) < 0.0015 && (Math.floor((fx + y) / 0.004) % 2) === 0) j = STITCH.slice();
      const fly = Math.abs(fx - 0.022) < 0.0015 && y > L.hipY - 0.04 ? 1 : 0;
      if (fly && (Math.floor(y / 0.004) % 2) === 0) j = STITCH.slice();
    }
    // Back pockets.
    if (z < L.zAxis(y) - 0.02 && y > L.hipY - 0.13 && y < L.waistY - 0.05) {
      const px2 = Math.abs(fx - 0.085);
      const py2 = y - (L.waistY - 0.1);
      const box = Math.max(px2 / 0.065, Math.abs(py2) / 0.075);
      if (Math.abs(box - 1) < 0.05 && (Math.floor((x + y) / 0.004) % 2) === 0) j = STITCH.slice();
    }
    // Waistband.
    if (y > L.waistY - 0.042) j = mul3(j, 0.92);
    j = mul3(j, 0.78 + 0.22 * ao);
    col = mix3(col, j, c.bottom);
    rough = mix(rough, 0.95, c.bottom);
    if (c.belt > 0) {
      let b = BELT.slice();
      const buckle = z > L.zAxis(y) && Math.abs(x) < 0.02 && y > L.waistY - 0.034 && y < L.waistY - 0.004 ? 1 : 0;
      if (buckle) b = [138, 134, 126];
      b = mul3(b, 0.9 + 0.1 * noise(x * 300, y * 300, z * 300));
      col = mix3(col, b, c.belt);
      rough = mix(rough, buckle ? 0.3 : 0.55, c.belt);
    }
  }
  // White trainers: sole band, lace panel.
  if (c.shoes > 0) {
    let k = SHOE.slice();
    if (y < 0.028) k = SOLE.slice();
    if (Math.abs(y - 0.028) < 0.0025) k = [150, 150, 148];
    const top = s.n[1] > 0.35 && y > 0.05 && Math.abs(x - L.footX(x)) < 0.02;
    if (top && (Math.floor(z / 0.012) % 2) === 0) k = [210, 210, 206];
    k = mul3(k, 0.82 + 0.18 * ao);
    col = mix3(col, k, c.shoes);
    rough = mix(rough, 0.5, c.shoes);
  }
  return [col[0], col[1], col[2], rough * 255];
}

// ------------------------------------------------------------------ crowd (tint masks, linear)
/** Returns [L, topMask, bottomMask, shoesOrHairMask] in 0..255; colours come from per-person palettes. */
export function paintCrowd(outfit, s, L) {
  const [x, y, z] = s.p;
  const c = coverage(outfit, s, L);
  const ao = s.ao;
  const fd = faceDetail(s, L);
  let l = 0.5 * (0.93 + 0.14 * fbm(x * 55, y * 55, z * 55, 3)) * (0.75 + 0.25 * ao);
  l *= 1 - 0.12 * fd.lips;
  l *= 1 - 0.04 * fd.lid;
  l = mix(l, 0.09, fd.brow * 0.9);
  l = mix(l, 0.1, fd.lash);
  // Padded jacket: quilted bands (bulging between stitched seams), centre zip.
  if (c.top > 0) {
    const arm = sstep(0.4, 0.7, s.f.arm);
    const band = arm > 0.5 ? (s.p[1] * 0.4 + Math.abs(x) * 0.9) / 0.1 : y / 0.11;
    const ph = band - Math.floor(band);
    let k = 0.5 * (0.82 + 0.3 * Math.sin(ph * Math.PI));
    if (ph < 0.04 || ph > 0.96) k *= 0.45;
    const zip = z > L.zAxis(y) && Math.abs(x) < 0.006 && arm < 0.5 ? 1 : 0;
    if (zip) k *= 0.35;
    k *= 0.7 + 0.3 * ao;
    l = mix(l, k, c.top);
  }
  if (c.bottom > 0) {
    let k = 0.5 * (0.92 + 0.08 * noise(x * 600, y * 150, z * 600)) * (0.75 + 0.25 * ao);
    const stack = sstep(L.ankleY + 0.1, L.ankleY + 0.02, y);
    k *= 1 - stack * 0.15 * (0.5 + 0.5 * Math.sin(y * 240));
    l = mix(l, k, c.bottom);
  }
  if (c.shoes > 0) {
    let k = 0.5 * (0.8 + 0.2 * ao);
    if (y < 0.026) k = 0.85;
    l = mix(l, k, c.shoes);
  }
  if (c.hair > 0) {
    // Strands combed back and down.
    const ang = Math.atan2(x, z - L.headC[2]);
    const k = 0.5 * (0.6 + 0.6 * noise(ang * 60, y * 25, 3.1)) * (0.7 + 0.3 * ao);
    l = mix(l, k, c.hair);
  }
  const head = s.f.head > 0.5;
  return [Math.min(255, l * 255), c.top * 255, c.bottom * 255, (head ? c.hair : c.shoes) * 255];
}

// ------------------------------------------------------------------ misc texture: eye + hair strands
/** Hair strand card (right half of the misc texture): luminance in RGB, alpha with ragged tips. */
export function paintHairCard(u, v) {
  const n = noise(u * 160, v * 6, 1.7);
  const n2 = noise(u * 420, v * 14, 4.2);
  const tip = 0.82 + 0.16 * noise(u * 90, 0.5, 9.1);
  const a = v < tip ? 1 : 0;
  const gap = n2 < 0.18 ? 0 : 1;
  const lum = 0.35 + 0.5 * n * (0.7 + 0.3 * n2);
  return [lum * 255, lum * 255, lum * 255, a * gap * 255];
}

// ------------------------------------------------------------------ detail texture: height (bump) + skin mask
const pores = (x, y, z) => 0.03 * (noise(x * 700, y * 700, z * 700) - 0.5) + 0.03 * (fbm(x * 110, y * 110, z * 110, 3) - 0.5);

/** [height, skinMask, 0, 255] in 0..255 for the protagonist. Height 128 = surface. */
export function detailHero(s, L) {
  const [x, y, z] = s.p;
  const c = coverage('hero', s, L);
  let h = 0.5 + pores(x, y, z);
  if (s.f.head > 0.6 && y > L.eyeY + 0.04) h += 0.02 * (noise(x * 1500, y * 1500, z * 1500) - 0.5);
  if (c.top > 0) {
    const s2 = Math.atan2(x, z - L.zAxis(y)) * 0.14;
    const rib = 0.5 + 0.5 * Math.sin((2 * Math.PI * s2) / 0.0042);
    const fold = fbm(x * 9, y * 14, z * 9, 3);
    h = mix(h, 0.5 + 0.2 * (rib - 0.5) + 0.3 * (fold - 0.5), c.top);
  }
  if (c.bottom > 0) {
    const side = x >= 0 ? 1 : -1;
    const la = L.legAxis(side, y);
    const phi = Math.atan2((x - la[0]) * side, z - la[1]);
    const twill = 0.5 + 0.5 * Math.sin(((y + phi * 0.06) / 0.0016) * Math.PI * 2);
    const backKnee = Math.exp(-((y - L.kneeY) ** 2) / (2 * 0.04 * 0.04)) * Math.max(0, -Math.cos(phi));
    const stack = sstep(L.ankleY + 0.12, L.ankleY + 0.02, y);
    const creases = 0.5 + 0.5 * Math.sin(y * 260 + noise(x * 40, y * 10, z * 40) * 6);
    let j = 0.5 + 0.08 * (twill - 0.5) + (backKnee * 0.35 + stack * 0.25 + 0.03) * (creases - 0.5) + 0.12 * (fbm(x * 6, y * 9, z * 6, 3) - 0.5);
    const seam = Math.min(Math.abs(Math.abs(phi) - Math.PI / 2 - 0.12), Math.abs(Math.abs(phi) - Math.PI / 2 - 1.7));
    if (y < L.hipY - 0.02) j += 0.22 * sstep(0.06, 0.01, seam);
    const fx = Math.abs(x);
    if (z > L.zAxis(y) && y > L.hipY - 0.07) {
      const pc = Math.hypot(fx - L.pocketX, (y - L.waistY) * 1.2) - 0.075;
      j -= 0.25 * sstep(0.004, 0.0, Math.abs(pc));
    }
    if (y > L.waistY - 0.042) j += 0.08;
    h = mix(h, j, c.bottom);
    if (c.belt > 0) h = mix(h, 0.62 - 0.15 * sstep(0.003, 0.0, Math.min(Math.abs(y - L.waistY + 0.038), Math.abs(y - L.waistY))), c.belt);
  }
  if (c.shoes > 0) {
    let k = 0.55;
    if (Math.abs(y - 0.028) < 0.003) k = 0.3;
    if (s.n[1] > 0.35 && y > 0.05 && Math.abs(x - L.footX(x)) < 0.02) k += 0.12 * Math.sin(z / 0.012 * Math.PI);
    h = mix(h, k, c.shoes);
  }
  const skin = 1 - Math.max(c.top, c.bottom, c.shoes, c.belt);
  return [Math.max(0, Math.min(255, h * 255)), skin * 255, 0, 255];
}

/** [height, skinMask, 0, 255] for crowd bodies. */
export function detailCrowd(outfit, s, L) {
  const [x, y, z] = s.p;
  const c = coverage(outfit, s, L);
  let h = 0.5 + pores(x, y, z);
  if (c.top > 0) {
    const arm = sstep(0.4, 0.7, s.f.arm);
    const band = arm > 0.5 ? (y * 0.4 + Math.abs(x) * 0.9) / 0.1 : y / 0.11;
    const ph = band - Math.floor(band);
    let k = 0.25 + 0.55 * Math.sin(ph * Math.PI) + 0.08 * (noise(x * 60, y * 60, z * 60) - 0.5);
    if (ph < 0.035 || ph > 0.965) k = 0.08;
    if (z > L.zAxis(y) && Math.abs(x) < 0.008 && arm < 0.5) k = 0.2;
    h = mix(h, k, c.top);
  }
  if (c.bottom > 0) {
    const stack = sstep(L.ankleY + 0.1, L.ankleY + 0.02, y);
    const k = 0.5 + 0.06 * (noise(x * 600, y * 150, z * 600) - 0.5) + (0.03 + 0.25 * stack) * (Math.sin(y * 240 + noise(x * 40, y * 10, z * 40) * 6) * 0.5) + 0.1 * (fbm(x * 6, y * 9, z * 6, 3) - 0.5);
    h = mix(h, k, c.bottom);
  }
  if (c.shoes > 0) h = mix(h, Math.abs(y - 0.026) < 0.003 ? 0.3 : 0.55, c.shoes);
  if (c.hair > 0) {
    const ang = Math.atan2(x, z - L.headC[2]);
    h = mix(h, 0.5 + 0.3 * (noise(ang * 60, y * 25, 3.1) - 0.5), c.hair);
  }
  const skin = 1 - Math.max(c.top, c.bottom, c.shoes, c.hair);
  return [Math.max(0, Math.min(255, h * 255)), skin * 255, 0, 255];
}
