// People from the Microsoft Rocketbox avatar library (MIT): photo-textured,
// dressed game characters on a shared 3ds Max Biped skeleton (one skeleton
// for all men, one for all women), driven by CMU motion capture.
//
//   node people/build_people.mjs <extract.json> <Rocketbox root> <models out> <textures out>
//
// extract.json comes from people/extract_fbx.mjs. Every output "variant" is
// made from a base avatar plus optional edits:
//   head:     replace the head + hair with another avatar's (same skeleton,
//             same bind pose, so no fitting is needed) -- used to give the
//             Seoul crowd East Asian faces and the protagonist his own head.
//   skin:     move the body texture's skin (hands, bare arms/legs) to the
//             head donor's skin tone (Lab mean/deviation transfer).
//   recolor:  repaint garments matched by hue (e.g. a blue tank top to white),
//             keeping the photo texture's folds and weave.
// Textures are packed per variant into one atlas (body 2:1 over head + hair),
// colour sRGB with hair alpha, normal map RG + specular in B. Bones collapse
// to the 20-bone game skeleton; LODs come from meshoptimizer.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { MeshoptSimplifier } from 'meshoptimizer';
import { NodeBasisEncoder } from 'ktx2-encoder';
import { BONES, BI, PARENT } from '../humans/skeleton.mjs';
import { loadClip, findLoop, retarget } from '../humans/motion.mjs';
import { rasterUV, dilate } from '../humans/bake.mjs';

const [EXTRACT, RB, OUT, TEX] = process.argv.slice(2);
if (!TEX) throw new Error('usage: node people/build_people.mjs <extract.json> <Rocketbox root> <models out> <textures out>');
const HERE = dirname(new URL(import.meta.url).pathname);
const WORK = join(dirname(EXTRACT), 'people-work');
const CMU = process.env.CMU || join(dirname(EXTRACT), 'cmu/repo/data');
mkdirSync(WORK, { recursive: true });
mkdirSync(OUT, { recursive: true });
mkdirSync(TEX, { recursive: true });
await MeshoptSimplifier.ready;
const basis = await new NodeBasisEncoder().init();
const FAST = !!process.env.FAST;

// ------------------------------------------------------------------ variants
// Crowd: Seoul in late November -- office workers in suits, hoodies and jackets,
// with East Asian faces (Male_Adult_09 for men; women keep dark-haired heads
// with their skin moved towards East Asian tones).
const ASIAN_M = 'Adults/Male_Adult_09';
const ASIAN_F_YOUNG = 'Professions/Sports_Female_02';
const ASIAN_F_MID = 'Professions/Business_Female_03';
// tone: keep the avatar's own head but move skin to the reference avatar's skin, darken irises and hair.
const VARIANTS = {
  hero: { base: 'Professions/Sports_Male_04', head: 'Adults/Male_Adult_12', skin: true, recolor: [{ hue: [190, 250], minSat: 0.2, to: [236, 233, 226] }], tex: 2048 },
  m_suit1: { base: 'Professions/Business_Male_01', head: ASIAN_M, skin: true, tex: 1024, sex: 'm' },
  m_suit2: { base: 'Professions/Business_Male_02', tone: ASIAN_M, tex: 1024, sex: 'm' },
  m_shirt: { base: 'Professions/Business_Male_06', tone: ASIAN_M, tex: 1024, sex: 'm' },
  m_hood1: { base: 'Adults/Male_Adult_04', head: ASIAN_M, skin: true, tex: 1024, sex: 'm' },
  m_blazer: { base: 'Adults/Male_Adult_07', tone: ASIAN_M, tex: 1024, sex: 'm' },
  m_casual: { base: 'Adults/Male_Adult_09', tex: 1024, sex: 'm' },
  f_jacket: { base: 'Adults/Female_Adult_05', head: ASIAN_F_YOUNG, skin: true, tex: 1024, sex: 'f' },
  f_hood: { base: 'Adults/Female_Adult_12', head: ASIAN_F_YOUNG, skin: true, tex: 1024, sex: 'f' },
  f_coat1: { base: 'Adults/Female_Adult_07', head: ASIAN_F_MID, skin: true, tex: 1024, sex: 'f' },
  f_coat2: { base: 'Adults/Female_Adult_11', tone: ASIAN_F_YOUNG, tex: 1024, sex: 'f' },
  f_suit: { base: 'Professions/Business_Female_04', head: ASIAN_F_YOUNG, skin: true, tex: 1024, sex: 'f' },
  f_cardigan: { base: 'Adults/Female_Adult_14', head: ASIAN_F_MID, skin: true, tex: 1024, sex: 'f' },
  f_mid: { base: 'Professions/Business_Female_03', tex: 1024, sex: 'f' },
};
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;

// ------------------------------------------------------------------ input
const extract = JSON.parse(readFileSync(EXTRACT, 'utf8'));
const dec = (a) => {
  const b = Buffer.from(a.data, 'base64');
  const T = globalThis[a.type];
  return new T(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};
const KIND = { body: 0, head: 1, hair: 2 };

/** Biped bone -> game bone. */
function gameBone(name) {
  const n = name.replace(/^Bip01_?/, '');
  const side = /(^|_)L(_|$)/.test(n) ? 'L' : /(^|_)R(_|$)/.test(n) ? 'R' : '';
  if (n === '' || n === 'Pelvis') return 'root';
  if (n === 'Spine') return 'spineLow';
  if (n === 'Spine1') return 'spineMid';
  if (n === 'Spine2' || n === 'Spine3') return 'chest';
  if (n === 'Neck') return 'neck';
  if (/Clavicle/.test(n)) return `clavicle.${side}`;
  if (/UpperArm/.test(n)) return `upperarm.${side}`;
  if (/Forearm|ForeTwist/.test(n)) return `lowerarm.${side}`;
  if (/Hand|Finger/.test(n)) return `wrist.${side}`;
  if (/Thigh/.test(n)) return `upperleg.${side}`;
  if (/Calf/.test(n)) return `lowerleg.${side}`;
  if (/Foot|Toe/.test(n)) return `foot.${side}`;
  return 'head'; // head, face rig, ponytail
}

function loadAvatar(rel) {
  const name = basename(rel);
  const key = Object.keys(extract).find((k) => k.endsWith(`/${rel}/Export/${name}.fbx`));
  if (!key) throw new Error('not extracted: ' + rel);
  const r = extract[key];
  const m = r.meshes[0];
  const M = m.matrixWorld;
  const P = dec(m.position), N = dec(m.normal), UV = dec(m.uv), SI = dec(m.skinIndex), SW = dec(m.skinWeight);
  const nC = P.length / 3;
  const mat = new Uint8Array(nC);
  for (const g of m.groups) {
    const n = m.materials[g.materialIndex].name;
    const k = n.endsWith('head') ? KIND.head : n.endsWith('opacity') ? KIND.hair : KIND.body;
    mat.fill(k, g.start, g.start + g.count);
  }
  const bones = r.skeleton.bones;
  const gOf = bones.map((b) => BI[gameBone(b.name)]);
  const eyeBone = bones.map((b) => /_[LR]Eye$/.test(b.name));
  const bpos = Object.fromEntries(bones.map((b) => [b.name, [b.world[12] * 0.01, b.world[13] * 0.01, b.world[14] * 0.01]]));
  // Corners -> welded vertices (position + uv + normal + material).
  const verts = [];
  const tri = [];
  const triKind = [];
  const map = new Map();
  for (let c = 0; c < nC; c++) {
    const x = P[c * 3], y = P[c * 3 + 1], z = P[c * 3 + 2];
    const p = [(M[0] * x + M[4] * y + M[8] * z + M[12]) * 0.01, (M[1] * x + M[5] * y + M[9] * z + M[13]) * 0.01, (M[2] * x + M[6] * y + M[10] * z + M[14]) * 0.01];
    const nx = N[c * 3], ny = N[c * 3 + 1], nz = N[c * 3 + 2];
    let n = [M[0] * nx + M[4] * ny + M[8] * nz, M[1] * nx + M[5] * ny + M[9] * nz, M[2] * nx + M[6] * ny + M[10] * nz];
    const nl = Math.hypot(n[0], n[1], n[2]) || 1;
    n = n.map((v) => v / nl);
    const u = UV[c * 2], v = UV[c * 2 + 1];
    const k = `${mat[c]}|${p.map((q) => Math.round(q * 2e4)).join(',')}|${Math.round(u * 4096)},${Math.round(v * 4096)}|${n.map((q) => Math.round(q * 50)).join(',')}`;
    let id = map.get(k);
    if (id === undefined) {
      id = verts.length;
      const w = new Float64Array(BONES.length);
      for (let j = 0; j < 4; j++) if (SW[c * 4 + j] > 0) w[gOf[SI[c * 4 + j]]] += SW[c * 4 + j];
      const pairs = [...w].map((ww, b) => [b, ww]).filter((q) => q[1] > 0.002).sort((a, b) => b[1] - a[1]).slice(0, 4);
      const t = pairs.reduce((s, q) => s + q[1], 0) || 1;
      let eye = 0;
      for (let j = 0; j < 4; j++) if (eyeBone[SI[c * 4 + j]]) eye += SW[c * 4 + j];
      verts.push({ p, n, uv: [u, v], kind: mat[c], eye: eye > 0.5, skin: pairs.length ? pairs.map(([b, ww]) => [b, ww / t]) : [[0, 1]] });
      map.set(k, id);
    }
    tri.push(id);
    if (c % 3 === 2) triKind.push(mat[c]);
  }
  const prefix = readTexPrefix(rel);
  return { rel, name, verts, tri, triKind, bpos, prefix };
}

/** Texture files of an avatar by role (names vary: f110_head_color_a.tga, m007_head_color.tga, ...). */
function readTexPrefix(rel) {
  const dir = join(RB, 'Assets/Avatars', rel, 'Textures');
  const files = execFileSync('ls', [dir], { encoding: 'utf8' }).split('\n').filter(Boolean);
  const pick = (re) => {
    const f = files.find((x) => re.test(x));
    return f ? join(dir, f) : null;
  };
  return {
    bodyC: pick(/_body_color/), bodyN: pick(/_body_normal/), bodyS: pick(/_body_spec/),
    headC: pick(/_head_color/), headN: pick(/_head_normal/), headS: pick(/_head_spec/),
    op: pick(/_opacity_color/),
  };
}

/** Which game bone dominates a vertex. */
const dom = (v) => v.skin[0][0];
const HEADISH = new Set([BI.head, BI.neck]);

// ------------------------------------------------------------------ images
function loadImg(file, w, h) {
  const out = join(WORK, basename(file) + `.${w}x${h}.raw`);
  if (!existsSync(out)) execFileSync('python3', ['-I', join(HERE, 'img.py'), 'load', file, out, String(w), String(h)]);
  return { w, h, d: new Uint8Array(readFileSync(out)) };
}
function blankImg(w, h, rgba) {
  const d = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) d.set(rgba, i * 4);
  return { w, h, d };
}

const srgb2lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const lin2srgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
function rgb2lab(r, g, b) {
  const R = srgb2lin(r / 255), G = srgb2lin(g / 255), B = srgb2lin(b / 255);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
function lab2rgb(L, a, b) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const fi = (t) => (t * t * t > 0.008856 ? t * t * t : (t - 16 / 116) / 7.787);
  const X = fi(fx) * 0.95047, Y = fi(fy), Z = fi(fz) * 1.08883;
  const R = 3.2406 * X - 1.5372 * Y - 0.4986 * Z, G = -0.9689 * X + 1.8758 * Y + 0.0415 * Z, B = 0.0557 * X - 0.204 * Y + 1.057 * Z;
  return [R, G, B].map((c) => Math.max(0, Math.min(255, Math.round(lin2srgb(Math.max(0, c)) * 255))));
}
function rgb2hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 0) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, mx > 0 ? d / mx : 0, mx / 255];
}

/** Coverage mask (texel -> 1) of the given triangles in an image's UV space (top-down rows). */
function triMask(av, tris, img) {
  const uvs = new Float32Array(tris.length * 6);
  tris.forEach((t, k) => {
    for (let c = 0; c < 3; c++) {
      const v = av.verts[av.tri[t * 3 + c]];
      uvs[k * 6 + c * 2] = v.uv[0] * (img.w / img.w);
      uvs[k * 6 + c * 2 + 1] = 1 - v.uv[1];
    }
  });
  const S = img.w;
  if (img.w !== img.h) throw new Error('triMask expects a square image');
  const m = new Uint8Array(S * S);
  rasterUV(tris.length, uvs, S, (ti) => (m[ti] = 1));
  return m;
}

/** Lab statistics of masked pixels. */
function labStats(img, mask) {
  let n = 0;
  const s = [0, 0, 0], q = [0, 0, 0];
  for (let i = 0; i < img.w * img.h; i++) {
    if (!mask[i]) continue;
    const l = rgb2lab(img.d[i * 4], img.d[i * 4 + 1], img.d[i * 4 + 2]);
    for (let k = 0; k < 3; k++) {
      s[k] += l[k];
      q[k] += l[k] * l[k];
    }
    n++;
  }
  const mu = s.map((v) => v / Math.max(1, n));
  return { n, mu, sd: q.map((v, k) => Math.sqrt(Math.max(1e-6, v / Math.max(1, n) - mu[k] * mu[k]))) };
}

// ------------------------------------------------------------------ variant
function buildVariant(name, spec) {
  const base = loadAvatar(spec.base);
  const donor = spec.head ? loadAvatar(spec.head) : null;
  const S = FAST ? spec.tex / 2 : spec.tex;
  const T = 2048; // working resolution for edits
  // Triangles by part.
  const nT = base.tri.length / 3;
  const isHeadTri = (av, t) => av.triKind[t] === KIND.head || (av.triKind[t] === KIND.hair && HEADISH.has(dom(av.verts[av.tri[t * 3]])));
  const bodyTris = [];
  for (let t = 0; t < nT; t++) if (!(donor && isHeadTri(base, t))) bodyTris.push(t);
  // Textures (2048 working copies).
  const bodyC = loadImg(base.prefix.bodyC, T, T);
  const bodyN = loadImg(base.prefix.bodyN, T, T);
  const bodyS = loadImg(base.prefix.bodyS, T, T);
  const headSrc = donor ?? base;
  const headC = loadImg(headSrc.prefix.headC, T, T);
  const headN = loadImg(headSrc.prefix.headN, T, T);
  const headS = loadImg(headSrc.prefix.headS, T, T);
  const hairC = headSrc.prefix.op ? loadImg(headSrc.prefix.op, T, T / 2) : blankImg(T, T / 2, [0, 0, 0, 0]);
  // Body opacity parts (if the base keeps hair-material pieces below the neck, e.g. lace) share the hair page:
  // only allowed when the base is also the head source.
  const bodyHasOpacity = bodyTris.some((t) => base.triKind[t] === KIND.hair);
  if (bodyHasOpacity && donor) {
    // drop them: their texture page belongs to the base
    for (let i = bodyTris.length - 1; i >= 0; i--) if (base.triKind[bodyTris[i]] === KIND.hair) bodyTris.splice(i, 1);
  }

  // ---------------------------------------------------------------- garment recolour (before skin: a recoloured garment is no longer skin-like)
  const bodyMaskAll = triMask(base, bodyTris.filter((t) => base.triKind[t] === KIND.body), bodyC);
  for (const rc of spec.recolor ?? []) {
    const sel = [];
    for (let i = 0; i < T * T; i++) {
      if (!bodyMaskAll[i]) continue;
      const [h, sat] = rgb2hsv(bodyC.d[i * 4], bodyC.d[i * 4 + 1], bodyC.d[i * 4 + 2]);
      if (h >= rc.hue[0] && h <= rc.hue[1] && sat >= rc.minSat) sel.push(i);
    }
    const Y = sel.map((i) => 0.2126 * bodyC.d[i * 4] + 0.7152 * bodyC.d[i * 4 + 1] + 0.0722 * bodyC.d[i * 4 + 2]).sort((x, y) => x - y);
    const hi = Y[Math.floor(Y.length * 0.9)] || 1;
    for (const i of sel) {
      const y = 0.2126 * bodyC.d[i * 4] + 0.7152 * bodyC.d[i * 4 + 1] + 0.0722 * bodyC.d[i * 4 + 2];
      const k = Math.min(1.04, Math.pow(y / hi, 0.65));
      for (let c = 0; c < 3; c++) bodyC.d[i * 4 + c] = Math.min(255, Math.round(rc.to[c] * k));
    }
    console.log(`  ${name}: recolour ${(sel.length / 1e3).toFixed(0)}k texels`);
  }

  // ---------------------------------------------------------------- skin tone
  const handTris = (av) => {
    const out = [];
    for (let t = 0; t < av.tri.length / 3; t++) {
      if (av.triKind[t] !== KIND.body) continue;
      const b = dom(av.verts[av.tri[t * 3]]);
      if (b === BI['wrist.L'] || b === BI['wrist.R']) out.push(t);
    }
    return out;
  };
  /** Robust skin statistics (median, MAD) of the warm-coloured texels on the hands. */
  const skinStats = (av, img) => {
    const m = triMask(av, handTris(av), img);
    const L = [], A = [], B = [];
    for (let i = 0; i < img.w * img.h; i++) {
      if (!m[i]) continue;
      const l = rgb2lab(img.d[i * 4], img.d[i * 4 + 1], img.d[i * 4 + 2]);
      if (l[1] < 3 || l[2] < 5 || l[0] < 12 || l[0] > 92) continue;
      L.push(l[0]); A.push(l[1]); B.push(l[2]);
    }
    const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
    const mad = (a, m0) => 1.4826 * med(a.map((v) => Math.abs(v - m0)));
    const mu = [med(L), med(A), med(B)];
    return { mu, sd: [mad(L, mu[0]) + 1, mad(A, mu[1]) + 0.5, mad(B, mu[2]) + 0.5], n: L.length };
  };
  /** Binary morphology on a T x T mask. */
  const morph = (m, r, grow) => {
    const out = new Uint8Array(T * T);
    const tmp = new Uint8Array(T * T);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      let v = grow ? 0 : 1;
      for (let k = -r; k <= r && (grow ? !v : v); k++) {
        const xx = x + k;
        const q = xx >= 0 && xx < T ? m[y * T + xx] : 0;
        if (grow ? q : !q) v = grow ? 1 : 0;
      }
      tmp[y * T + x] = v;
    }
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      let v = grow ? 0 : 1;
      for (let k = -r; k <= r && (grow ? !v : v); k++) {
        const yy = y + k;
        const q = yy >= 0 && yy < T ? tmp[yy * T + x] : 0;
        if (grow ? q : !q) v = grow ? 1 : 0;
      }
      out[y * T + x] = v;
    }
    return out;
  };
  /** Move skin texels (close to `src` in chroma) of a region to the `dst` skin colour. */
  const moveSkin = (img, region, src, dst, label) => {
    let m = new Uint8Array(T * T);
    for (let i = 0; i < T * T; i++) {
      if (!region[i]) continue;
      const l = rgb2lab(img.d[i * 4], img.d[i * 4 + 1], img.d[i * 4 + 2]);
      const da = (l[1] - src.mu[1]) / (src.sd[1] + 2), db = (l[2] - src.mu[2]) / (src.sd[2] + 2);
      const okL = l[0] > src.mu[0] - 4 * src.sd[0] - 18 && l[0] < src.mu[0] + 3 * src.sd[0] + 12;
      if (okL && da * da + db * db < 9) m[i] = 1;
    }
    // Closing fills hair and freckles; opening removes specks on garments.
    m = morph(morph(m, 3, true), 3, false);
    m = morph(morph(m, 1, false), 1, true);
    let moved = 0;
    for (let i = 0; i < T * T; i++) {
      if (!m[i] || !region[i]) continue;
      const l = rgb2lab(img.d[i * 4], img.d[i * 4 + 1], img.d[i * 4 + 2]);
      const o = [0, 1, 2].map((c) => (l[c] - src.mu[c]) * Math.min(1.6, dst.sd[c] / src.sd[c]) + dst.mu[c]);
      img.d.set(lab2rgb(o[0], o[1], o[2]), i * 4);
      moved++;
    }
    console.log(`  ${name}: ${label} skin ${src.mu.map((v) => v.toFixed(0))}±${src.sd.map((v) => v.toFixed(0))} -> ${dst.mu.map((v) => v.toFixed(0))}, ${(moved / 1e3).toFixed(0)}k texels`);
  };
  const toneRef = spec.tone ? loadAvatar(spec.tone) : null;
  const skinRef = donor && spec.skin ? donor : toneRef;
  if (skinRef) {
    const src = skinStats(base, bodyC);
    const dst = skinStats(skinRef, loadImg(skinRef.prefix.bodyC, T, T));
    moveSkin(bodyC, bodyMaskAll, src, dst, 'body');
    if (toneRef) {
      // Same head, East Asian colouring: skin, dark brown irises, black hair.
      const headTris = [];
      for (let t = 0; t < nT; t++) if (base.triKind[t] === KIND.head) headTris.push(t);
      moveSkin(headC, triMask(base, headTris, headC), src, dst, 'head');
      const eyeTris = headTris.filter((t) => base.verts[base.tri[t * 3]].eye);
      const eyeMask = triMask(base, eyeTris, headC);
      let iris = 0;
      for (let i = 0; i < T * T; i++) {
        if (!eyeMask[i]) continue;
        const [h, sat, val] = rgb2hsv(headC.d[i * 4], headC.d[i * 4 + 1], headC.d[i * 4 + 2]);
        if (sat < 0.12 || val > 0.92) continue; // sclera and highlights stay
        const y = 0.2126 * headC.d[i * 4] + 0.7152 * headC.d[i * 4 + 1] + 0.0722 * headC.d[i * 4 + 2];
        const k = Math.min(1, y / 140);
        headC.d.set([Math.round(70 * k + 12), Math.round(44 * k + 8), Math.round(28 * k + 6)], i * 4);
        iris++;
        void h;
      }
      // Hair cards: near-black, keeping strand contrast.
      for (let i = 0; i < hairC.w * hairC.h; i++) {
        if (hairC.d[i * 4 + 3] < 8) continue;
        const y = 0.2126 * hairC.d[i * 4] + 0.7152 * hairC.d[i * 4 + 1] + 0.0722 * hairC.d[i * 4 + 2];
        const k = Math.pow(y / 255, 0.8) * 0.45;
        hairC.d.set([Math.round(255 * k * 0.55 + 6), Math.round(255 * k * 0.5 + 5), Math.round(255 * k * 0.46 + 5)], i * 4);
      }
      console.log(`  ${name}: irises ${(iris / 1e3).toFixed(1)}k texels, hair darkened`);
    }
  }

  // ---------------------------------------------------------------- geometry
  const verts = [];
  const tris = [];
  const remap = (av, part) => {
    const m = new Map();
    return (vi) => {
      let id = m.get(vi);
      if (id === undefined) {
        id = verts.length;
        const v = av.verts[vi];
        verts.push({ ...v, part });
        m.set(vi, id);
      }
      return id;
    };
  };
  const rb = remap(base, 'base');
  for (const t of bodyTris) tris.push(rb(base.tri[t * 3]), rb(base.tri[t * 3 + 1]), rb(base.tri[t * 3 + 2]));
  if (donor) {
    const rd = remap(donor, 'donor');
    for (let t = 0; t < donor.tri.length / 3; t++) if (isHeadTri(donor, t)) tris.push(rd(donor.tri[t * 3]), rd(donor.tri[t * 3 + 1]), rd(donor.tri[t * 3 + 2]));
  }
  // Atlas UVs: body page (v 1/3..1), head page (u 0..1/2, v 0..1/3), hair page (u 1/2..1, v 0..1/3).
  for (const v of verts) {
    const u = Math.min(1, Math.max(0, v.uv[0]));
    const w = Math.min(1, Math.max(0, v.uv[1]));
    v.auv = v.kind === KIND.body ? [u, 1 / 3 + (w * 2) / 3] : v.kind === KIND.head ? [u / 2, w / 3] : [0.5 + u / 2, w / 3];
  }
  // Feet on y = 0.
  let minY = Infinity;
  for (const v of verts) minY = Math.min(minY, v.p[1]);
  for (const v of verts) v.p = [v.p[0], v.p[1] - minY, v.p[2]];

  // ---------------------------------------------------------------- skeleton defs
  const bp = (n) => {
    const p = base.bpos['Bip01_' + n];
    return [p[0], p[1] - minY, p[2]];
  };
  const up = (p, d) => [p[0], p[1] + d, p[2]];
  const defs = {
    root: [bp('Pelvis'), bp('Pelvis'), bp('Spine1')],
    spineLow: [bp('Spine'), bp('Spine'), bp('Spine1')],
    spineMid: [bp('Spine1'), bp('Spine1'), bp('Spine2')],
    chest: [bp('Spine2'), bp('Spine2'), bp('Neck')],
    // Upright reference for the neck (the Biped neck leans forward; CMU's is near vertical).
    neck: [bp('Neck'), bp('Neck'), up(bp('Neck'), 0.1)],
    head: [bp('Head'), bp('Head'), up(bp('Head'), 0.2)],
  };
  for (const s of ['L', 'R']) {
    defs[`clavicle.${s}`] = [bp(`${s}_Clavicle`), bp(`${s}_Clavicle`), bp(`${s}_UpperArm`)];
    defs[`upperarm.${s}`] = [bp(`${s}_UpperArm`), bp(`${s}_UpperArm`), bp(`${s}_Forearm`)];
    defs[`lowerarm.${s}`] = [bp(`${s}_Forearm`), bp(`${s}_Forearm`), bp(`${s}_Hand`)];
    defs[`wrist.${s}`] = [bp(`${s}_Hand`), bp(`${s}_Hand`), bp(`${s}_Finger2`)];
    defs[`upperleg.${s}`] = [bp(`${s}_Thigh`), bp(`${s}_Thigh`), bp(`${s}_Calf`)];
    defs[`lowerleg.${s}`] = [bp(`${s}_Calf`), bp(`${s}_Calf`), bp(`${s}_Foot`)];
    defs[`foot.${s}`] = [bp(`${s}_Foot`), bp(`${s}_Foot`), bp(`${s}_Toe0`)];
  }
  const pivot = BONES.map((b) => defs[b][0]);

  // ---------------------------------------------------------------- atlas
  const W = S, H = (S * 3) / 2;
  const colour = new Uint8Array(W * H * 4);
  const normal = new Uint8Array(W * H * 4);
  const put = (dst, src, x0, y0, w, h, fn) => {
    // Nearest-neighbour downsample by box filter of the source.
    const sx = src.w / w, sy = src.h / h;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const acc = [0, 0, 0, 0];
      let n = 0;
      for (let yy = Math.floor(y * sy); yy < Math.floor((y + 1) * sy); yy++) for (let xx = Math.floor(x * sx); xx < Math.floor((x + 1) * sx); xx++) {
        const o = (yy * src.w + xx) * 4;
        for (let k = 0; k < 4; k++) acc[k] += src.d[o + k];
        n++;
      }
      const px = fn(acc.map((a) => a / n), x, y);
      dst.set(px, ((y0 + y) * W + x0 + x) * 4);
    }
  };
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  // Colour: body (top 2/3), head and hair (bottom third).
  put(colour, bodyC, 0, 0, W, S, (c) => [c[0], c[1], c[2], 255]);
  put(colour, headC, 0, S, W / 2, S / 2, (c) => [c[0], c[1], c[2], 255]);
  put(colour, hairC, W / 2, S, W / 2, S / 2, (c) => c);
  // Normal (RG) + specular (B).
  const specOf = (img) => (x, y, w, h) => {
    const o = (Math.floor((y / h) * img.h) * img.w + Math.floor((x / w) * img.w)) * 4;
    return lum([img.d[o], img.d[o + 1], img.d[o + 2]]);
  };
  const bS = specOf(bodyS), hS = specOf(headS);
  put(normal, bodyN, 0, 0, W, S, (c, x, y) => [c[0], c[1], bS(x, y, W, S), 255]);
  put(normal, headN, 0, S, W / 2, S / 2, (c, x, y) => [c[0], c[1], hS(x, y, W / 2, S / 2), 255]);
  put(normal, blankImg(4, 4, [128, 128, 40, 255]), W / 2, S, W / 2, S / 2, (c) => c);
  // Flip rows (KTX2 first row = v 0).
  const flip = (d) => {
    const o = new Uint8Array(d.length);
    for (let y = 0; y < H; y++) o.set(d.subarray(y * W * 4, (y + 1) * W * 4), (H - 1 - y) * W * 4);
    return o;
  };
  return { name, verts, tris, pivot, defs, colour: flip(colour), normal: flip(normal), W, H, sex: spec.sex ?? 'm' };
}

// ------------------------------------------------------------------ LOD + encode
function lod(v, idx, ratio) {
  const pos = new Float32Array(v.length * 3);
  const att = new Float32Array(v.length * 2);
  v.forEach((q, i) => {
    pos.set(q.p, i * 3);
    att.set(q.auv, i * 2);
  });
  const I = new Uint32Array(idx);
  const want = Math.floor((I.length / 3) * ratio) * 3;
  const [s] = MeshoptSimplifier.simplifyWithAttributes(I, pos, 3, att, 2, [1, 1], null, want, 0.04, []);
  return Array.from(s);
}
function encode(rgba, w, h, srgb, uastc) {
  const enc = new basis.BasisEncoder();
  try {
    enc.setSliceSourceImage(0, rgba, w, h, 0);
    enc.setCreateKTX2File(true);
    enc.setMipGen(true);
    (enc.setKTX2AndBasisSRGBTransferFunc ?? enc.setKTX2SRGBTransferFunc).call(enc, srgb);
    enc.setUASTC(uastc);
    if (uastc) {
      enc.setKTX2UASTCSupercompression(true);
      enc.setRDOUASTC(true);
      enc.setRDOUASTCQualityScalar(1.0);
    } else enc.setQualityLevel?.(200);
    if (!srgb) (enc.setNormalMapPreset ?? enc.setNormalMap)?.call(enc);
    const buf = new Uint8Array(w * h * 6 + 65536);
    const n = enc.encode(buf);
    if (!n) throw new Error('encode failed');
    return buf.slice(0, n);
  } finally {
    enc.delete();
  }
}

// ------------------------------------------------------------------ build
const header = { bones: BONES, parents: BONES.map((b) => (PARENT[b] ? BI[PARENT[b]] : -1)), fps: 30, format: 'rocketbox-1', variants: {}, clips: {} };
const chunks = [];
let offset = 0;
const push = (arr) => {
  const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
  const pad = (4 - (buf.length % 4)) % 4;
  chunks.push(buf, Buffer.alloc(pad));
  const at = offset;
  offset += buf.length + pad;
  return at;
};
const built = {};
for (const [name, spec] of Object.entries(VARIANTS)) {
  if (ONLY && !ONLY.includes(name)) continue;
  const b = buildVariant(name, spec);
  built[name] = b;
  const nv = b.verts.length;
  if (nv > 65535) throw new Error(name + ': too many vertices');
  const pos = new Float32Array(nv * 3), nrm = new Int8Array(nv * 4), uv = new Uint16Array(nv * 2), sk = new Uint8Array(nv * 4), sw = new Uint8Array(nv * 4);
  b.verts.forEach((v, i) => {
    pos.set(v.p, i * 3);
    for (let k = 0; k < 3; k++) nrm[i * 4 + k] = Math.round(v.n[k] * 127);
    uv[i * 2] = Math.round(v.auv[0] * 65535);
    uv[i * 2 + 1] = Math.round(v.auv[1] * 65535);
    let tot = 0;
    for (let k = 0; k < 4; k++) {
      sk[i * 4 + k] = v.skin[k] ? v.skin[k][0] : 0;
      sw[i * 4 + k] = v.skin[k] ? Math.round(v.skin[k][1] * 255) : 0;
      tot += sw[i * 4 + k];
    }
    sw[i * 4] += 255 - tot;
  });
  const lods = [b.tris, lod(b.verts, b.tris, 0.3), lod(b.verts, b.tris, 0.1)];
  const hero = name === 'hero';
  const cName = `person_${name}_c.ktx2`, nName = `person_${name}_n.ktx2`;
  writeFileSync(join(TEX, cName), encode(b.colour, b.W, b.H, true, hero));
  writeFileSync(join(TEX, nName), encode(b.normal, b.W, b.H, false, true));
  header.variants[name] = {
    verts: nv, sex: b.sex, pivots: b.pivot.flat(),
    pos: push(pos), nrm: push(nrm), uv: push(uv), skin: push(sk), weight: push(sw),
    lods: lods.map((l) => ({ count: l.length, idx: push(new Uint16Array(l)) })),
    colour: cName, normal: nName,
  };
  const h = Math.max(...b.verts.map((v) => v.p[1]));
  console.log(`${name}: ${nv} verts, LOD tris ${lods.map((l) => l.length / 3).join('/')}, height ${h.toFixed(2)} m, atlas ${b.W}x${b.H}`);
}
const CLIPS = {
  walk: { file: '035/35_01.bvh', loop: [0.9, 1.3], inPlace: true },
  run: { file: '035/35_17.bvh', loop: [0.55, 0.85], inPlace: true },
  idle: { file: '077/77_02.bvh', loop: [3, 6], inPlace: false, from: 0.05, to: 0.95 },
};
for (const [cn, spec] of Object.entries(CLIPS)) {
  const clip = loadClip(join(CMU, spec.file));
  const nf = clip.frames.length;
  const lp = findLoop(clip, spec.loop[0], spec.loop[1], Math.floor((spec.from ?? 0) * nf), Math.floor((spec.to ?? 1) * nf));
  const c = { variants: {} };
  for (const [name, b] of Object.entries(built)) {
    const r = retarget(clip, lp.s, lp.p, b, 30, spec.inPlace);
    c.frames = r.frames;
    c.variants[name] = { data: push(r.data), speed: +r.speed.toFixed(3) };
  }
  header.clips[cn] = c;
}
header.byteLength = offset;
writeFileSync(join(OUT, 'people.bin'), Buffer.concat(chunks));
writeFileSync(join(OUT, 'people.json'), JSON.stringify(header));
console.log(`wrote ${(offset / 1024).toFixed(0)} KB`);
