// People: skinned, textured bodies from the MakeHuman base mesh (CC0) with
// CMU motion capture (free for any use) on a 20-bone game skeleton.
//
//   node build_humans.mjs <makehuman/data dir> <cmu-mocap/data dir> <models out> <textures out>
//
// Body: base mesh "hm08" + macro targets (gender, ethnicity, muscle, height),
// relaxed fingers, MakeHuman's own eyeballs and iris texture (fitted with the
// eyes' .mhclo). Clothes are smooth coverage functions of the body point
// (humans/paint.mjs): the surface is pushed out by each layer's thickness
// (ramping smoothly at edges, so no stepped hems), cloth areas are smoothed
// and draped, and the same functions paint the texture per texel in the body
// UV layout, so edges, seams, eyebrows and lips are clean at texture
// resolution. Ambient occlusion is ray-traced per vertex.
//
// Output: humans.bin + humans.json (models) and human_*.ktx2 (textures).
// FAST=1 halves texture sizes and AO rays for quick previews.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { MeshoptSimplifier } from 'meshoptimizer';
import { NodeBasisEncoder } from 'ktx2-encoder';
import { v3, m3 } from './humans/math.mjs';
import { BONES, BI, PARENT, gameBoneOf, boneDefs } from './humans/skeleton.mjs';
import { loadClip, findLoop, retarget } from './humans/motion.mjs';
import { buildBVH, bakeAO, rasterUV, dilate } from './humans/bake.mjs';
import { coverage, thickness, paintHero, paintCrowd, paintHairCard, detailHero, detailCrowd, sstep } from './humans/paint.mjs';

const [MH, CMU, OUT, TEX] = process.argv.slice(2);
if (!TEX) throw new Error('usage: node build_humans.mjs <makehuman/data> <cmu-mocap/data> <models out> <textures out>');
await MeshoptSimplifier.ready;
const basis = await new NodeBasisEncoder().init();
mkdirSync(OUT, { recursive: true });
mkdirSync(TEX, { recursive: true });
const FAST = !!process.env.FAST;

// ------------------------------------------------------------------ MakeHuman data
function parseObj(text, group) {
  const v = [];
  const vt = [];
  const faces = [];
  let g = '';
  for (const line of text.split('\n')) {
    if (line.startsWith('v ')) {
      const p = line.split(/\s+/);
      v.push([+p[1], +p[2], +p[3]]);
    } else if (line.startsWith('vt ')) {
      const p = line.split(/\s+/);
      vt.push([+p[1], +p[2]]);
    } else if (line.startsWith('g ')) g = line.slice(2).trim();
    else if (line.startsWith('f ') && (!group || g === group)) {
      faces.push(line.trim().split(/\s+/).slice(1).map((t) => t.split('/').map((x) => parseInt(x, 10) - 1)));
    }
  }
  return { v, vt, faces };
}
const base = parseObj(readFileSync(join(MH, '3dobjs/base.obj'), 'utf8'), 'body');
const skel = JSON.parse(readFileSync(join(MH, 'rigs/default.mhskel'), 'utf8'));
const mhw = JSON.parse(readFileSync(join(MH, 'rigs/default_weights.mhw'), 'utf8')).weights;
const eyeObj = parseObj(readFileSync(join(MH, 'eyes/high-poly/high-poly.obj'), 'utf8'));
const eyeClo = (() => {
  const t = readFileSync(join(MH, 'eyes/high-poly/high-poly.mhclo'), 'utf8').split('\n');
  const scale = {};
  const refs = [];
  let inVerts = false;
  for (const line of t) {
    const p = line.trim().split(/\s+/);
    if (/^[xyz]_scale$/.test(p[0])) scale[p[0][0]] = [+p[1], +p[2], +p[3]];
    if (p[0] === 'verts') {
      inVerts = true;
      continue;
    }
    if (inVerts) {
      if (p.length === 9) refs.push(p.map(Number));
      else if (p.length === 1 && p[0] !== '') refs.push([+p[0], 0, 0, 1, 0, 0, 0, 0, 0]);
      else if (refs.length) inVerts = false;
    }
  }
  return { scale, refs };
})();
const targetCache = new Map();
function target(name) {
  if (targetCache.has(name)) return targetCache.get(name);
  const t = [];
  for (const line of readFileSync(join(MH, 'targets', name + '.target'), 'utf8').split('\n')) {
    if (!line || line[0] === '#') continue;
    const p = line.trim().split(/\s+/);
    if (p.length >= 4) t.push([+p[0], +p[1], +p[2], +p[3]]);
  }
  targetCache.set(name, t);
  return t;
}

// Skin-weight fields (sums of MakeHuman bone weights) used by the outfit and face rules.
const FIELDS = ['torso', 'arm', 'head', 'neck', 'wrist', 'foot', 'lips', 'lidU', 'lidL', 'jaw', 'breast'];
function fieldsOf(bone) {
  const out = [];
  const g = gameBoneOf(skel, bone);
  if (/^(root|pelvis|spine|breast|clavicle)/.test(bone)) out.push('torso');
  if (/^(upperarm|lowerarm|shoulder01)/.test(bone)) out.push('arm');
  if (g === 'head') out.push('head');
  if (/^neck/.test(bone)) out.push('neck');
  if (g.startsWith('wrist')) out.push('wrist');
  if (g.startsWith('foot')) out.push('foot');
  if (/^oris/.test(bone)) out.push('lips');
  if (/^orbicularis03/.test(bone)) out.push('lidU');
  if (/^orbicularis04/.test(bone)) out.push('lidL');
  if (/^(jaw|risorius)/.test(bone)) out.push('jaw');
  if (/^breast/.test(bone)) out.push('breast');
  return out;
}

// ------------------------------------------------------------------ bodies
const VARIANTS = {
  hero: { targets: [['macrodetails/universal-male-young-averagemuscle-averageweight', 0.85], ['macrodetails/universal-male-young-maxmuscle-averageweight', 0.15], ['macrodetails/african-male-young', 1], ['macrodetails/height/male-young-averagemuscle-averageweight-maxheight', 0.06], ['breast/breast-point-decr', 1]], outfit: 'hero', tex: 2048 },
  man: { targets: [['macrodetails/universal-male-young-averagemuscle-averageweight', 1], ['macrodetails/asian-male-young', 1], ['macrodetails/height/male-young-averagemuscle-averageweight-maxheight', 0.1], ['breast/breast-point-decr', 1]], outfit: 'man', tex: 1024 },
  woman: { targets: [['macrodetails/universal-female-young-averagemuscle-averageweight', 1], ['macrodetails/asian-female-young', 1], ['macrodetails/height/female-young-averagemuscle-averageweight-maxheight', 0.08], ['breast/breast-point-decr', 0.8]], outfit: 'woman', tex: 1024 },
};

function morph(spec) {
  const V = base.v.map((p) => p.slice());
  for (const [name, w] of spec.targets) for (const [i, dx, dy, dz] of target(name)) {
    V[i][0] += dx * w;
    V[i][1] += dy * w;
    V[i][2] += dz * w;
  }
  let minY = Infinity;
  for (const f of base.faces) for (const [vi] of f) minY = Math.min(minY, V[vi][1]);
  return V.map(([x, y, z]) => [x * 0.1, (y - minY) * 0.1, z * 0.1]);
}

/** Relaxed hands: bend the finger joints towards the palm. Returns the posed vertices and palm normals. */
function curlFingers(V, J) {
  const M = {};
  const palms = {};
  for (const [s, sign] of [['L', 1], ['R', -1]]) {
    const across = v3.norm(v3.sub(J(skel.bones[`finger2-1.${s}`].head), J(skel.bones[`finger5-1.${s}`].head)));
    const handDir = v3.norm(v3.sub(J(skel.bones[`finger3-1.${s}`].head), J(skel.bones[`wrist.${s}`].head)));
    const palm = v3.scale(v3.norm(v3.cross(handDir, across)), sign);
    palms[s] = palm;
    for (let f = 1; f <= 5; f++) {
      const ang = f === 1 ? [4, 10, 8] : [12 + f * 3, 22 + f * 2, 14];
      let par = { R: m3.I(), t: [0, 0, 0] };
      for (let k = 1; k <= 3; k++) {
        const b = skel.bones[`finger${f}-${k}.${s}`];
        const head = J(b.head);
        const dir = v3.norm(v3.sub(J(b.tail), head));
        const axis = v3.norm(v3.cross(dir, palm));
        const h = v3.add(m3.apply(par.R, head), par.t);
        const ax = v3.norm(m3.apply(par.R, axis));
        const a = (ang[k - 1] * Math.PI) / 180;
        const c = Math.cos(a), sn = Math.sin(a), t1 = 1 - c;
        const [x, y, z] = ax;
        const Rk = [c + x * x * t1, x * y * t1 - z * sn, x * z * t1 + y * sn, y * x * t1 + z * sn, c + y * y * t1, y * z * t1 - x * sn, z * x * t1 - y * sn, z * y * t1 + x * sn, c + z * z * t1];
        par = { R: m3.mul(Rk, par.R), t: v3.add(m3.apply(Rk, v3.sub(par.t, h)), h) };
        M[`finger${f}-${k}.${s}`] = par;
      }
    }
  }
  const out = V.map((p) => p.slice());
  for (const [bn, tr] of Object.entries(M)) {
    for (const [vi, w] of mhw[bn] ?? []) {
      const q = v3.add(m3.apply(tr.R, V[vi]), tr.t);
      for (let k = 0; k < 3; k++) out[vi][k] += w * (q[k] - V[vi][k]);
    }
  }
  return { V: out, palms };
}

function smoothNormals(P, tris) {
  const N = P.map(() => [0, 0, 0]);
  for (const [a, b, c] of tris) {
    const n = v3.cross(v3.sub(P[b], P[a]), v3.sub(P[c], P[a]));
    for (const i of [a, b, c]) for (let k = 0; k < 3; k++) N[i][k] += n[k];
  }
  return N.map((n) => (v3.len(n) > 0 ? v3.norm(n) : [0, 1, 0]));
}

function buildBody(name, spec) {
  const V0 = morph(spec);
  const J0 = (jn) => {
    const idx = skel.joints[jn];
    const s = [0, 0, 0];
    for (const i of idx) for (let k = 0; k < 3; k++) s[k] += V0[i][k];
    return s.map((x) => x / idx.length);
  };
  const { V, palms } = curlFingers(V0, J0);
  const defs = boneDefs(skel, J0);
  const pivot = BONES.map((b) => defs[b][0]);
  const P_ = (b) => pivot[BI[b]];

  // Skin weights collapsed to game bones (top 4) and the outfit fields.
  const nV = V.length;
  const wsum = Array.from({ length: nV }, () => new Float64Array(BONES.length));
  const F = Array.from({ length: nV }, () => Object.fromEntries(FIELDS.map((k) => [k, 0])));
  for (const [mb, list] of Object.entries(mhw)) {
    const g = BI[gameBoneOf(skel, mb)];
    const fl = fieldsOf(mb);
    for (const [vi, w] of list) {
      wsum[vi][g] += w;
      for (const k of fl) F[vi][k] += w;
    }
  }
  // A few vertices (e.g. the nipple tips) have no weights in MakeHuman's file: fill them from their
  // neighbours, otherwise they stay pinned to the root bone and miss every outfit rule.
  {
    const adj = Array.from({ length: nV }, () => new Set());
    for (const f of base.faces) for (let k = 0; k < f.length; k++) {
      const a = f[k][0], b = f[(k + 1) % f.length][0];
      adj[a].add(b);
      adj[b].add(a);
    }
    const empty = (i) => wsum[i].every((w) => w === 0);
    let missing = [...new Set(base.faces.flat().map((c) => c[0]))].filter(empty);
    if (process.env.DEBUG) console.log(`  unweighted vertices: ${missing.length}`);
    for (let pass = 0; pass < 20 && missing.length; pass++) {
      const next = [];
      const fills = [];
      for (const i of missing) {
        const src = [...adj[i]].filter((j) => !empty(j));
        if (!src.length) {
          next.push(i);
          continue;
        }
        const w = new Float64Array(BONES.length);
        const fl = Object.fromEntries(FIELDS.map((k) => [k, 0]));
        for (const j of src) {
          for (let b = 0; b < BONES.length; b++) w[b] += wsum[j][b] / src.length;
          for (const k of FIELDS) fl[k] += F[j][k] / src.length;
        }
        fills.push([i, w, fl]);
      }
      for (const [i, w, fl] of fills) {
        wsum[i] = w;
        F[i] = fl;
      }
      missing = next;
    }
  }
  const skin = wsum.map((ws) => {
    const pairs = [...ws].map((w, b) => [w, b]).filter((p) => p[0] > 0).sort((a, b) => b[0] - a[0]).slice(0, 4);
    if (!pairs.length) pairs.push([1, 0]);
    const t = pairs.reduce((s, p) => s + p[0], 0);
    return pairs.map(([w, b]) => [b, w / t]);
  });

  // Body triangles (base vertex ids) and their corner UVs.
  const tris = [];
  const triUV = [];
  for (const f of base.faces) for (let k = 1; k + 1 < f.length; k++) {
    tris.push([f[0][0], f[k][0], f[k + 1][0]]);
    triUV.push([f[0][1], f[k][1], f[k + 1][1]]);
  }
  const N = smoothNormals(V, tris);

  // Eyes, fitted to the body's eye helper geometry.
  const sc = (ax) => {
    const [a, b, den] = eyeClo.scale[ax];
    const k = 'xyz'.indexOf(ax);
    return Math.abs(V[a][k] - V[b][k]) / den;
  };
  const sx = sc('x'), sy = sc('y'), sz = sc('z');
  const eyeP = eyeClo.refs.map(([a, b, c, wa, wb, wc, dx, dy, dz]) => [
    wa * V[a][0] + wb * V[b][0] + wc * V[c][0] + dx * sx,
    wa * V[a][1] + wb * V[b][1] + wc * V[c][1] + dy * sy,
    wa * V[a][2] + wb * V[b][2] + wc * V[c][2] + dz * sz,
  ]);
  const eyeSide = (sgn) => {
    const pts = eyeP.filter((p) => Math.sign(p[0]) === sgn);
    const c = [0, 1, 2].map((k) => pts.reduce((s, p) => s + p[k], 0) / pts.length);
    const r = pts.reduce((s, p) => s + v3.len(v3.sub(p, c)), 0) / pts.length;
    return { c, r };
  };

  // Landmarks for the outfit and face rules.
  const spineCh = ['root', 'spineLow', 'spineMid', 'chest', 'neck', 'head'].map(P_);
  const L = {
    eyeL: eyeSide(1),
    eyeR: eyeSide(-1),
    headC: P_('head'),
    neckBase: P_('neck')[1],
    chestTop: P_('neck')[1] - 0.005,
    hipY: P_('upperleg.L')[1],
    kneeY: P_('lowerleg.L')[1],
    ankleY: P_('foot.L')[1],
    armpitY: P_('upperarm.L')[1] - 0.07,
    shoulderW: Math.abs(P_('upperarm.L')[0]),
    pocketX: 0.13,
    zAxis: (y) => {
      if (y <= spineCh[0][1]) return spineCh[0][2];
      for (let k = 1; k < spineCh.length; k++) if (y <= spineCh[k][1]) return spineCh[k - 1][2] + ((spineCh[k][2] - spineCh[k - 1][2]) * (y - spineCh[k - 1][1])) / (spineCh[k][1] - spineCh[k - 1][1]);
      return spineCh[spineCh.length - 1][2];
    },
    legAxis: (side, y) => {
      const s = side > 0 ? 'L' : 'R';
      const ch = [P_(`foot.${s}`), P_(`lowerleg.${s}`), P_(`upperleg.${s}`)];
      if (y <= ch[0][1]) return [ch[0][0], ch[0][2]];
      for (let k = 1; k < ch.length; k++) if (y <= ch[k][1]) {
        const t = (y - ch[k - 1][1]) / (ch[k][1] - ch[k - 1][1]);
        return [ch[k - 1][0] + (ch[k][0] - ch[k - 1][0]) * t, ch[k - 1][2] + (ch[k][2] - ch[k - 1][2]) * t];
      }
      return [ch[2][0], ch[2][2]];
    },
    palmSign: (x) => Math.sign((x > 0 ? palms.L : palms.R)[0]) || 1,
    footX: (x) => P_(x > 0 ? 'foot.L' : 'foot.R')[0],
  };
  L.eyeY = (L.eyeL.c[1] + L.eyeR.c[1]) / 2;
  L.eyeZ = (L.eyeL.c[2] + L.eyeR.c[2]) / 2;
  L.waistY = L.hipY + 0.1;
  L.strapOut = L.shoulderW * 0.6;
  const o = spec.outfit;

  // ---------------------------------------------------------------- clothes geometry
  const used = new Set(tris.flat());
  const usedList = [...used];
  const cov = V.map((p, i) => (used.has(i) ? coverage(o, { p, n: N[i], f: F[i] }, L) : null));
  const P = V.map((p, i) => (cov[i] ? v3.add(p, v3.scale(N[i], thickness(o, { p, n: N[i], f: F[i] }, cov[i], L))) : p.slice()));
  const nb = V.map(() => new Set());
  for (const t of tris) for (let k = 0; k < 3; k++) {
    nb[t[k]].add(t[(k + 1) % 3]);
    nb[t[k]].add(t[(k + 2) % 3]);
  }
  /** Taubin smoothing where w(i) > 0 (the weight scales the step, so edges blend). */
  const smooth = (iters, w) => {
    const ids = usedList.filter((i) => w(i) > 0.01);
    for (let it = 0; it < iters * 2; it++) {
      const f = it % 2 === 0 ? 0.5 : -0.53;
      const upd = [];
      for (const i of ids) {
        const a = [0, 0, 0];
        for (const j of nb[i]) for (let k = 0; k < 3; k++) a[k] += P[j][k] / nb[i].size;
        upd.push([i, [0, 1, 2].map((k) => P[i][k] + f * w(i) * (a[k] - P[i][k]))]);
      }
      for (const [i, p] of upd) P[i] = p;
    }
  };
  /** Plain Laplacian (shrinks small bumps) where w(i) > 0. */
  const flatten = (iters, w) => {
    const ids = usedList.filter((i) => w(i) > 0.01);
    for (let it = 0; it < iters; it++) {
      const upd = [];
      for (const i of ids) {
        const a = [0, 0, 0];
        for (const j of nb[i]) for (let k = 0; k < 3; k++) a[k] += P[j][k] / nb[i].size;
        upd.push([i, [0, 1, 2].map((k) => P[i][k] + 0.6 * w(i) * (a[k] - P[i][k]))]);
      }
      for (const [i, p] of upd) P[i] = p;
    }
  };
  // Shoes: convex outlines per height (no toes), then smooth.
  convexFeet(P, usedList.filter((i) => (cov[i]?.shoes ?? 0) > 0.5), L);
  smooth(36, (i) => sstep(0.3, 0.9, cov[i]?.shoes ?? 0));
  // Under cloth the chest is smooth (no nipples).
  // Chest region: within 7 cm of each nipple, found as the most protruding point on the front of the
  // chest (relative to the surface 1.2..2.5 cm around it). MakeHuman's breast weights do not cover it.
  // Chest region (front of the ribcage, soft box): MakeHuman's breast weights miss the nipples, so a
  // region in space is used instead.
  const chestW = (i) => {
    const [x, y, z] = V[i];
    const fz = z - L.zAxis(y);
    return (cov[i]?.top ?? 0) * sstep(0.17, 0.13, Math.abs(x)) * sstep(L.neckBase - 0.42, L.neckBase - 0.36, y) * sstep(L.neckBase - 0.03, L.neckBase - 0.09, y) * sstep(0.0, 0.04, fz);
  };
  flatten(45, chestW);
  // Chest under cloth: blend towards a membrane spanned by the surrounding surface (harmonic fill),
  // which removes nipples and softens the pectorals' lower edge.
  {
    const w = chestW;
    const ids = usedList.filter((i) => w(i) > 0.01);
    const H = new Map(ids.map((i) => [i, P[i].slice()]));
    for (let it = 0; it < 400; it++) {
      for (const i of ids) {
        const a = [0, 0, 0];
        for (const j of nb[i]) {
          const q = H.get(j) ?? P[j];
          for (let k = 0; k < 3; k++) a[k] += q[k] / nb[i].size;
        }
        H.set(i, a);
      }
    }
    for (const i of ids) {
      const h = H.get(i);
      const t = w(i) * 0.8;
      // Never move inward past the original surface by more than a few mm (keeps the chest's volume).
      const d = v3.dot(v3.sub(h, P[i]), N[i]);
      const step = v3.add(v3.scale(v3.sub(h, P[i]), t), v3.scale(N[i], Math.max(0, -d - 0.004) * t));
      P[i] = v3.add(P[i], step);
    }
  }
  // Crotch height: lowest trouser point on the centre line. Above it the pelvis is one section, below it two legs.
  let crotchY = L.hipY;
  for (const i of usedList) if ((cov[i]?.bottom ?? 0) > 0.5 && Math.abs(V[i][0]) < 0.012) crotchY = Math.min(crotchY, V[i][1]);
  L.crotchY = crotchY;
  const torsoCloth = usedList.filter((i) => (cov[i]?.top ?? 0) > 0.2 && F[i].arm + F[i].wrist < 0.25 && V[i][1] < L.neckBase - 0.01 && V[i][1] > L.hipY - 0.12);
  const legIds = usedList.filter((i) => (cov[i]?.bottom ?? 0) > 0.5 && F[i].arm + F[i].wrist < 0.3);
  if (o === 'hero') {
    polarSmooth(P, torsoCloth, L, 0.03, 3, (i) => cov[i]?.top ?? 0);
    smooth(5, (i) => cov[i]?.top ?? 0);
    convexLegs(P, legIds, L, nb);
    smooth(16, (i) => cov[i]?.bottom ?? 0);
    smooth(6, chestW);
  } else {
    if (o === 'man') convexLegs(P, legIds, L, nb);
    polarSmooth(P, torsoCloth, L, 0.06, 3, (i) => cov[i]?.top ?? 0);
    smooth(30, (i) => cov[i]?.top ?? 0);
    smooth(10, (i) => cov[i]?.bottom ?? 0);
    smooth(8, (i) => cov[i]?.hair ?? 0);
    drape(P, usedList.filter((i) => (cov[i]?.top ?? 0) > 0.5 && F[i].arm < 0.5 && V[i][1] < L.neckBase), L, P_, o, nb);
    polarSmooth(P, torsoCloth, L, 0.035, 2, (i) => cov[i]?.top ?? 0);
  }
  // Flat soles.
  for (const i of usedList) if ((cov[i]?.shoes ?? 0) > 0.3 && P[i][1] < 0.012) P[i][1] = Math.max(0, P[i][1]) * 0.3;
  let NN = smoothNormals(P, tris);
  // Fine relief along the new normals: quilting (padding), stacked folds at the trouser hem.
  for (const i of usedList) {
    const c = cov[i];
    if (!c) continue;
    const y = V[i][1];
    let d = 0;
    if (o !== 'hero' && c.top > 0) {
      const band = F[i].arm > 0.5 ? (y * 0.4 + Math.abs(V[i][0]) * 0.9) / 0.1 : y / 0.11;
      d += c.top * 0.006 * Math.sin((band - Math.floor(band)) * Math.PI);
    }
    if (c.bottom > 0) d += c.bottom * sstep(L.ankleY + 0.12, L.ankleY + 0.02, y) * 0.0025 * Math.sin(y * 260);
    if (d) P[i] = v3.add(P[i], v3.scale(NN[i], d));
  }
  NN = smoothNormals(P, tris);
  // ---------------------------------------------------------------- vertex buffer
  const verts = []; // { base, p, n, uv, skin, kind, ao, head }
  const key = new Map();
  const corner = (vi, ti) => {
    const k = vi * 65536 + ti;
    let id = key.get(k);
    if (id === undefined) {
      id = verts.length;
      verts.push({ base: vi, p: P[vi], n: NN[vi], uv: base.vt[ti], skin: skin[vi], kind: 0, head: F[vi].head > 0.5 });
      key.set(k, id);
    }
    return id;
  };
  const bodyIdx = [];
  tris.forEach((t, f) => bodyIdx.push(corner(t[0], triUV[f][0]), corner(t[1], triUV[f][1]), corner(t[2], triUV[f][2])));
  const eyeIdx = [];
  {
    const eyeTris = [];
    for (const f of eyeObj.faces) for (let k = 1; k + 1 < f.length; k++) eyeTris.push([f[0], f[k], f[k + 1]]);
    const eN = smoothNormals(eyeP, eyeTris.map((t) => t.map((c) => c[0])));
    const ek = new Map();
    for (const t of eyeTris) for (const [vi, ti] of t) {
      const k = vi * 65536 + ti;
      let id = ek.get(k);
      if (id === undefined) {
        id = verts.length;
        verts.push({ p: eyeP[vi], n: eN[vi], uv: eyeObj.vt[ti], skin: [[BI.head, 1]], kind: 1, head: true });
        ek.set(k, id);
      }
      eyeIdx.push(id);
    }
  }
  // Long hair (women): layered strand cards from the crown down past the shoulders.
  const hairIdx = [];
  if (o === 'woman') {
    const hc = L.headC;
    for (let layer = 0; layer < 3; layer++) {
      const b0 = verts.length;
      const rows = 8;
      const cols = 12;
      const top = L.eyeY + 0.06 - layer * 0.012;
      const bottom = L.neckBase - 0.15 + layer * 0.03;
      for (let i = 0; i <= rows; i++) {
        const t = i / rows;
        const y = top + (bottom - top) * t;
        const rx = 0.084 + 0.012 * layer + 0.035 * t;
        const rz = 0.098 + 0.01 * layer + 0.02 * t;
        for (let j = 0; j <= cols; j++) {
          const a = Math.PI * (0.12 + 0.76 * (j / cols));
          const x = -Math.cos(a) * rx;
          const z = hc[2] - 0.012 - Math.sin(a) * rz;
          const wHead = Math.max(0, 1 - t * 1.25);
          verts.push({
            p: [x, y, z],
            n: v3.norm([x, 0.25 * (1 - t), z - hc[2]]),
            uv: [j / cols, t],
            skin: wHead > 0.99 ? [[BI.head, 1]] : [[BI.head, wHead], [BI.neck, (1 - wHead) * 0.6], [BI.chest, (1 - wHead) * 0.4]],
            kind: 2,
            head: true,
          });
        }
      }
      const row = cols + 1;
      for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
        const a = b0 + i * row + j;
        hairIdx.push(a, a + row, a + 1, a + 1, a + row, a + row + 1, a, a + 1, a + row, a + 1, a + row + 1, a + row);
      }
    }
  }

  // ---------------------------------------------------------------- ambient occlusion
  const bvh = buildBVH(new Float32Array(P.flat()), new Uint32Array(tris.flat()));
  const aoBase = new Float32Array(nV).fill(1);
  const aoVals = bakeAO(bvh, usedList.map((i) => P[i]), usedList.map((i) => NN[i]), FAST ? 12 : 40, 0.22);
  usedList.forEach((i, k) => (aoBase[i] = aoVals[k]));
  for (let it = 0; it < 2; it++) {
    const nx = aoBase.slice();
    for (const i of usedList) {
      let s = aoBase[i];
      for (const j of nb[i]) s += aoBase[j];
      nx[i] = s / (nb[i].size + 1);
    }
    aoBase.set(nx);
  }
  const eyes = verts.filter((v) => v.kind === 1);
  const eyeAO = bakeAO(bvh, eyes.map((v) => v.p), eyes.map((v) => v.n), FAST ? 8 : 24, 0.03);
  eyes.forEach((v, k) => (v.ao = 0.55 + 0.45 * eyeAO[k]));
  for (const v of verts) {
    if (v.kind === 0) v.ao = aoBase[v.base];
    else if (v.kind === 2) v.ao = 0.85;
  }

  // ---------------------------------------------------------------- texture
  const S = FAST ? spec.tex / 2 : spec.tex;
  const rgba = new Uint8Array(S * S * 4);
  const SD = S / 2; // detail (height + skin mask) at half resolution
  const det = new Uint8Array(SD * SD * 4);
  const uvs = new Float32Array(tris.length * 6);
  triUV.forEach((t, f) => t.forEach((ti, c) => {
    uvs[f * 6 + c * 2] = base.vt[ti][0];
    uvs[f * 6 + c * 2 + 1] = base.vt[ti][1];
  }));
  const lerp3 = (a, b, c, w0, w1, w2) => [a[0] * w0 + b[0] * w1 + c[0] * w2, a[1] * w0 + b[1] * w1 + c[1] * w2, a[2] * w0 + b[2] * w1 + c[2] * w2];
  const covered = rasterUV(tris.length, uvs, S, (ti, f, w0, w1, w2) => {
    const [a, b, c] = tris[f];
    const s = {
      p: lerp3(V[a], V[b], V[c], w0, w1, w2),
      n: v3.norm(lerp3(N[a], N[b], N[c], w0, w1, w2)),
      f: Object.fromEntries(FIELDS.map((k) => [k, F[a][k] * w0 + F[b][k] * w1 + F[c][k] * w2])),
      ao: aoBase[a] * w0 + aoBase[b] * w1 + aoBase[c] * w2,
    };
    const px = o === 'hero' ? paintHero(s, L) : paintCrowd(o, s, L);
    for (let k = 0; k < 4; k++) rgba[ti * 4 + k] = Math.max(0, Math.min(255, Math.round(px[k])));
  });
  dilate(rgba, covered, S, 10);
  const coveredD = rasterUV(tris.length, uvs, SD, (ti, f, w0, w1, w2) => {
    const [a, b, c] = tris[f];
    const s = {
      p: lerp3(V[a], V[b], V[c], w0, w1, w2),
      n: v3.norm(lerp3(N[a], N[b], N[c], w0, w1, w2)),
      f: Object.fromEntries(FIELDS.map((k) => [k, F[a][k] * w0 + F[b][k] * w1 + F[c][k] * w2])),
      ao: 1,
    };
    const px = o === 'hero' ? detailHero(s, L) : detailCrowd(o, s, L);
    for (let k = 0; k < 4; k++) det[ti * 4 + k] = Math.max(0, Math.min(255, Math.round(px[k])));
  });
  dilate(det, coveredD, SD, 8);

  const height = Math.max(...verts.filter((v) => v.kind === 0).map((v) => v.p[1]));
  console.log(`${name}: ${verts.length} verts, ${bodyIdx.length / 3} body tris, eyes ${eyeIdx.length / 3}, hair ${hairIdx.length / 3}, height ${height.toFixed(2)} m, texture ${S}`);
  return { verts, bodyIdx, eyeIdx, hairIdx, pivot, defs, rgba, texSize: S, det, detSize: SD, linear: o !== 'hero' };
}

/** Trouser legs: convex sections per leg so cloth spans the hollows (knee, quads, crotch). */
function convexLegs(P, ids, L, nb) {
  // Pelvis bands (above the crotch): one convex section around the body axis.
  {
    const bands = new Map();
    for (const i of ids) {
      if (P[i][1] < L.crotchY + 0.025) continue;
      const b = Math.floor(P[i][1] / 0.015);
      if (!bands.has(b)) bands.set(b, []);
      bands.get(b).push(i);
    }
    for (const [, list] of bands) {
      if (list.length < 6) continue;
      const az = L.zAxis(P[list[0]][1]);
      const pts = list.map((i) => [P[i][0], P[i][2] - az]);
      convexify(pts, (n, r, th) => {
        const i = list[n];
        P[i][0] = Math.sin(th) * r;
        P[i][2] = az + Math.cos(th) * r;
      });
    }
  }
  // Just below the crotch the denim spans between the thighs (fading out downwards).
  {
    const bands = new Map();
    for (const i of ids) {
      const y = P[i][1];
      if (y < L.crotchY - 0.07 || y >= L.crotchY + 0.025) continue;
      const b = Math.floor(y / 0.012);
      if (!bands.has(b)) bands.set(b, []);
      bands.get(b).push(i);
    }
    for (const [, list] of bands) {
      if (list.length < 6) continue;
      const y = P[list[0]][1];
      const w = sstep(L.crotchY - 0.07, L.crotchY + 0.02, y) * 0.85;
      const az = L.zAxis(y);
      const pts = list.map((i) => [P[i][0], P[i][2] - az]);
      convexify(pts, (n, r, th) => {
        const i = list[n];
        const r0 = Math.hypot(P[i][0], P[i][2] - az);
        const rr = r0 + (r - r0) * w;
        P[i][0] = Math.sin(th) * rr;
        P[i][2] = az + Math.cos(th) * rr;
      });
    }
  }
  for (const side of [1, -1]) {
    const mine = ids.filter((i) => Math.sign(P[i][0]) === side && P[i][1] < L.crotchY + 0.01);
    const bands = new Map();
    for (const i of mine) {
      const b = Math.floor(P[i][1] / 0.015);
      if (!bands.has(b)) bands.set(b, []);
      bands.get(b).push(i);
    }
    for (const [, list] of bands) {
      if (list.length < 6) continue;
      const y = P[list[0]][1];
      const [ax, az] = L.legAxis(side, y);
      const pts = list.map((i) => [P[i][0] - ax, P[i][2] - az]);
      convexify(pts, (n, r, th) => {
        const i = list[n];
        P[i][0] = ax + Math.sin(th) * r;
        P[i][2] = az + Math.cos(th) * r;
      });
    }
  }
  void nb;
}

/** Feet inside shoes: convex outline in each 1 cm height band (fills between the toes). */
function convexFeet(P, ids, L) {
  for (const side of [1, -1]) {
    const bands = new Map();
    for (const i of ids) {
      if (Math.sign(P[i][0]) !== side) continue;
      const b = Math.floor(P[i][1] / 0.01);
      if (!bands.has(b)) bands.set(b, []);
      bands.get(b).push(i);
    }
    for (const [, list] of bands) {
      if (list.length < 6) continue;
      const [ax, az] = L.legAxis(side, 0);
      const cz = list.reduce((s, i) => s + P[i][2], 0) / list.length;
      const pts = list.map((i) => [P[i][0] - ax, P[i][2] - cz]);
      convexify(pts, (n, r, th) => {
        const i = list[n];
        P[i][0] = ax + Math.sin(th) * r;
        P[i][2] = cz + Math.cos(th) * r;
      });
      void az;
    }
  }
}

/** Push 2D points (relative to an axis) out onto their convex hull; set(n, r, theta, w) applies a move. */
function convexify(pts, set) {
  const sorted = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (q, a, b) => (a[0] - q[0]) * (b[1] - q[1]) - (a[1] - q[1]) * (b[0] - q[0]);
  const lo = [];
  for (const p of sorted) {
    while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop();
    lo.push(p);
  }
  const up = [];
  for (let k = sorted.length - 1; k >= 0; k--) {
    while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], sorted[k]) <= 0) up.pop();
    up.push(sorted[k]);
  }
  const H = lo.slice(0, -1).concat(up.slice(0, -1));
  if (H.length < 3) return;
  pts.forEach(([x, z], n) => {
    const r = Math.hypot(x, z);
    if (r < 1e-4) return;
    const dx = x / r, dz = z / r;
    let best = r;
    for (let k = 0; k < H.length; k++) {
      const a = H[k], b = H[(k + 1) % H.length];
      const ex = b[0] - a[0], ez = b[1] - a[1];
      const den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = (a[0] * ez - a[1] * ex) / den;
      const u = (a[0] * dz - a[1] * dx) / den;
      if (t > 0 && u >= 0 && u <= 1 && t > best) best = t;
    }
    if (best > r) set(n, best, Math.atan2(x, z));
  });
}

/**
 * Topology-free low-pass on torso cloth: each vertex's distance from the body axis becomes the
 * weighted average over the vertices within `rad` (arc length x height). Small bumps under the
 * cloth (nipples, navel, abs) vanish whatever the mesh's weights or edge layout.
 */
function polarSmooth(P, ids, L, rad, iters, wFn) {
  const R0 = 0.15;
  const nTh = Math.max(1, Math.ceil((2 * Math.PI * R0) / rad));
  for (let it = 0; it < iters; it++) {
    const pol = ids.map((i) => {
      const dz = P[i][2] - L.zAxis(P[i][1]);
      return [Math.atan2(P[i][0], dz), Math.hypot(P[i][0], dz), P[i][1]];
    });
    const grid = new Map();
    const cellOf = (th, y) => [Math.floor(((th + Math.PI) * R0) / rad) % nTh, Math.floor(y / rad)];
    pol.forEach(([th, , y], k) => {
      const [cx, cy] = cellOf(th, y);
      const key = cx * 100000 + cy;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(k);
    });
    const newR = pol.map(([th, , y]) => {
      const [cx, cy] = cellOf(th, y);
      let sum = 0, ws = 0;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const list = grid.get((((cx + dx) % nTh) + nTh) % nTh * 100000 + cy + dy);
        if (!list) continue;
        for (const k2 of list) {
          const [th2, r2, y2] = pol[k2];
          let dth = th2 - th;
          if (dth > Math.PI) dth -= 2 * Math.PI;
          if (dth < -Math.PI) dth += 2 * Math.PI;
          const d = Math.hypot(dth * R0, y2 - y);
          if (d >= rad) continue;
          const w = 1 - d / rad;
          sum += w * r2;
          ws += w;
        }
      }
      return ws > 0 ? sum / ws : 0;
    });
    ids.forEach((i, k) => {
      const w = wFn(i);
      const [th, r] = pol[k];
      const rr = r + (newR[k] - r) * w;
      P[i][0] = Math.sin(th) * rr;
      P[i][2] = L.zAxis(P[i][1]) + Math.cos(th) * rr;
    });
  }
}

/** Jacket drape: hang from the chest (optional) and convex horizontal sections (no folds under the chest). */
function drape(P, ids, L, P_, o, nb, hang = true) {
  const relax = (iters, f0, f1) => {
    for (let it = 0; it < iters; it++) {
      const f = it % 2 === 0 ? f0 : f1;
      const upd = [];
      for (const i of ids) {
        const a = [0, 0, 0];
        for (const j of nb[i]) for (let k = 0; k < 3; k++) a[k] += P[j][k] / nb[i].size;
        upd.push([i, [0, 1, 2].map((k) => P[i][k] + f * (a[k] - P[i][k]))]);
      }
      for (const [i, p] of upd) P[i] = p;
    }
  };
  const polar = (p) => {
    const dz = p[2] - L.zAxis(p[1]);
    return [Math.atan2(p[0], dz), Math.hypot(p[0], dz)];
  };
  const setPolar = (i, th, r) => {
    P[i][0] = Math.sin(th) * r;
    P[i][2] = L.zAxis(P[i][1]) + Math.cos(th) * r;
  };
  relax(hang ? 12 : 10, 0.6, 0.6);
  const chestY = P_('chest')[1];
  const SECT = 36;
  const rc = new Array(SECT).fill(0);
  const yc = new Array(SECT).fill(chestY);
  for (const i of ids) {
    if (P[i][1] < chestY - 0.12 || P[i][1] > chestY + 0.12) continue;
    const [th, r] = polar(P[i]);
    const k = Math.floor(((th + Math.PI) / (2 * Math.PI)) * SECT) % SECT;
    if (r > rc[k]) {
      rc[k] = r;
      yc[k] = P[i][1];
    }
  }
  const taper = o === 'woman' ? 0.05 : 0.14;
  for (const i of hang ? ids : []) {
    const [th, r] = polar(P[i]);
    const k = Math.floor(((th + Math.PI) / (2 * Math.PI)) * SECT) % SECT;
    if (P[i][1] >= yc[k]) continue;
    const want = rc[k] * 0.94 - taper * (yc[k] - P[i][1]);
    if (want > r) setPolar(i, th, want);
  }
  const bands = new Map();
  for (const i of ids) {
    const b = Math.floor(P[i][1] / 0.015);
    if (!bands.has(b)) bands.set(b, []);
    bands.get(b).push(i);
  }
  const hull = (pts) => {
    pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (q, a, b) => (a[0] - q[0]) * (b[1] - q[1]) - (a[1] - q[1]) * (b[0] - q[0]);
    const lo = [];
    for (const p of pts) {
      while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop();
      lo.push(p);
    }
    const up = [];
    for (let k = pts.length - 1; k >= 0; k--) {
      while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], pts[k]) <= 0) up.pop();
      up.push(pts[k]);
    }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  };
  void hull;
  for (const [, list] of bands) {
    if (list.length < 6) continue;
    const pts = list.map((i) => [P[i][0], P[i][2] - L.zAxis(P[i][1])]);
    convexify(pts, (n, r, th) => setPolar(list[n], th, r));
    continue;
    const H = hull(pts);
    if (H.length < 3) continue;
    list.forEach((i, n) => {
      const [x, z] = pts[n];
      const r = Math.hypot(x, z);
      if (r < 1e-4) return;
      const dx = x / r, dz = z / r;
      let best = r;
      for (let k = 0; k < H.length; k++) {
        const a = H[k], b = H[(k + 1) % H.length];
        const ex = b[0] - a[0], ez = b[1] - a[1];
        const den = dx * ez - dz * ex;
        if (Math.abs(den) < 1e-9) continue;
        const t = (a[0] * ez - a[1] * ex) / den;
        const u = (a[0] * dz - a[1] * dx) / den;
        if (t > 0 && u >= 0 && u <= 1 && t > best) best = t;
      }
      if (best > r) setPolar(i, Math.atan2(x, z), best);
    });
  }
  relax(hang ? 24 : 8, 0.5, -0.53);
}

// ------------------------------------------------------------------ LODs
function simplifyBody(verts, idx, ratio) {
  const pos = new Float32Array(verts.length * 3);
  const att = new Float32Array(verts.length * 2);
  verts.forEach((v, i) => {
    pos.set(v.p, i * 3);
    att.set(v.uv, i * 2);
  });
  // Lock UV-seam copies so the two sides of a seam stay joined.
  const seen = new Map();
  const lock = new Uint8Array(verts.length);
  verts.forEach((v, i) => {
    if (v.kind !== 0) return;
    if (seen.has(v.base)) {
      lock[i] = 1;
      lock[seen.get(v.base)] = 1;
    } else seen.set(v.base, i);
  });
  const I = new Uint32Array(idx);
  const want = Math.floor((I.length / 3) * ratio) * 3;
  const [s] = MeshoptSimplifier.simplifyWithAttributes(I, pos, 3, att, 2, [0.6, 0.6], lock, want, 0.05, []);
  return Array.from(s);
}

// ------------------------------------------------------------------ textures
function encode(rgba, w, h, srgb) {
  const enc = new basis.BasisEncoder();
  try {
    enc.setSliceSourceImage(0, rgba, w, h, 0);
    enc.setCreateKTX2File(true);
    enc.setMipGen(true);
    (enc.setKTX2AndBasisSRGBTransferFunc ?? enc.setKTX2SRGBTransferFunc).call(enc, srgb);
    enc.setUASTC(true);
    enc.setKTX2UASTCSupercompression(true);
    enc.setRDOUASTC(true);
    enc.setRDOUASTCQualityScalar(1.0);
    const buf = new Uint8Array(w * h * 6 + 65536);
    const n = enc.encode(buf);
    if (!n) throw new Error('encode failed');
    return buf.slice(0, n);
  } finally {
    enc.delete();
  }
}

/** Misc texture (1024 x 512): MakeHuman's brown eye (left), hair strands (right). Rows bottom-up (v = 0 first). */
function miscTexture() {
  const W = 1024, H = 512;
  const out = new Uint8Array(W * H * 4);
  const script = 'import sys;from PIL import Image;im=Image.open(sys.argv[1]).convert("RGBA").resize((512,512),Image.LANCZOS);sys.stdout.buffer.write(im.tobytes())';
  const raw = execFileSync('python3', ['-I', '-c', script, join(MH, 'eyes/materials/brown_eye.png')], { maxBuffer: 1 << 26 });
  for (let y = 0; y < H; y++) for (let x = 0; x < 512; x++) {
    const src = ((H - 1 - y) * 512 + x) * 4; // PNG rows are top-down
    const dst = (y * W + x) * 4;
    out[dst] = raw[src];
    out[dst + 1] = raw[src + 1];
    out[dst + 2] = raw[src + 2];
    out[dst + 3] = 255;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < 512; x++) {
    const px = paintHairCard(x / 512, y / H);
    out.set(px.map((v) => Math.round(v)), (y * W + 512 + x) * 4);
  }
  return encode(out, W, H, true);
}

// ------------------------------------------------------------------ build + export
const bodies = Object.fromEntries(Object.entries(VARIANTS).map(([k, v]) => [k, buildBody(k, v)]));
const CLIPS = {
  walk: { file: '035/35_01.bvh', loop: [0.9, 1.3], inPlace: true },
  run: { file: '035/35_17.bvh', loop: [0.55, 0.85], inPlace: true },
  idle: { file: '077/77_02.bvh', loop: [3, 6], inPlace: false, from: 0.05, to: 0.95 },
};
const FPS = 30;
const header = { bones: BONES, parents: BONES.map((b) => (PARENT[b] ? BI[PARENT[b]] : -1)), fps: FPS, variants: {}, clips: {} };
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
for (const [name, b] of Object.entries(bodies)) {
  const nv = b.verts.length;
  if (nv > 65535) throw new Error('too many vertices for 16-bit indices');
  const pos = new Float32Array(nv * 3);
  const nrm = new Int8Array(nv * 4);
  const uv = new Uint16Array(nv * 2);
  const sk = new Uint8Array(nv * 4);
  const sw = new Uint8Array(nv * 4);
  const info = new Uint8Array(nv * 4);
  b.verts.forEach((v, i) => {
    pos.set(v.p, i * 3);
    for (let k = 0; k < 3; k++) nrm[i * 4 + k] = Math.round(v.n[k] * 127);
    uv[i * 2] = Math.round(Math.min(1, Math.max(0, v.uv[0])) * 65535);
    uv[i * 2 + 1] = Math.round(Math.min(1, Math.max(0, v.uv[1])) * 65535);
    const s = v.skin;
    let tot = 0;
    for (let k = 0; k < 4; k++) {
      sk[i * 4 + k] = s[k] ? s[k][0] : 0;
      sw[i * 4 + k] = s[k] ? Math.round(s[k][1] * 255) : 0;
      tot += sw[i * 4 + k];
    }
    sw[i * 4] += 255 - tot;
    info[i * 4] = v.kind;
    info[i * 4 + 1] = Math.round(Math.min(1, Math.max(0, v.ao)) * 255);
    info[i * 4 + 2] = v.head ? 255 : 0;
  });
  const lod1 = simplifyBody(b.verts, b.bodyIdx, 0.25);
  const lod2 = simplifyBody(b.verts, b.bodyIdx, 0.065);
  const lods = [
    [...b.bodyIdx, ...b.eyeIdx, ...b.hairIdx],
    [...lod1, ...b.eyeIdx, ...b.hairIdx],
    [...lod2, ...b.hairIdx],
  ];
  const texName = `human_${name}.ktx2`;
  writeFileSync(join(TEX, texName), encode(b.rgba, b.texSize, b.texSize, !b.linear));
  const detName = `human_${name}_d.ktx2`;
  writeFileSync(join(TEX, detName), encode(b.det, b.detSize, b.detSize, false));
  header.variants[name] = {
    verts: nv,
    pivots: b.pivot.flat(),
    pos: push(pos), nrm: push(nrm), uv: push(uv), skin: push(sk), weight: push(sw), info: push(info),
    lods: lods.map((l) => ({ count: l.length, idx: push(new Uint16Array(l)) })),
    texture: texName,
    detail: detName,
    tinted: b.linear,
  };
  console.log(`  LOD tris: ${lods.map((l) => l.length / 3).join(' / ')}`);
}
writeFileSync(join(TEX, 'human_misc.ktx2'), miscTexture());
for (const [cn, spec] of Object.entries(CLIPS)) {
  const clip = loadClip(join(CMU, spec.file));
  const nf = clip.frames.length;
  const lp = findLoop(clip, spec.loop[0], spec.loop[1], Math.floor((spec.from ?? 0) * nf), Math.floor((spec.to ?? 1) * nf));
  const c = { start: lp.s, length: lp.p, variants: {} };
  for (const [name, b] of Object.entries(bodies)) {
    const r = retarget(clip, lp.s, lp.p, b, FPS, spec.inPlace);
    c.frames = r.frames;
    c.variants[name] = { data: push(r.data), speed: +r.speed.toFixed(3) };
  }
  header.clips[cn] = c;
  console.log(`clip ${cn}: ${(lp.p / clip.fps).toFixed(2)} s -> ${c.frames} frames, hero speed ${c.variants.hero.speed} m/s`);
}
header.byteLength = offset;
writeFileSync(join(OUT, 'humans.bin'), Buffer.concat(chunks));
writeFileSync(join(OUT, 'humans.json'), JSON.stringify(header));
console.log(`wrote ${(offset / 1024).toFixed(0)} KB`);

// Layout (offsets into humans.bin, little endian):
//   variants[name]: pos Float32x3, nrm Int8x4 (snorm), uv Uint16x2 (unorm),
//     skin Uint8x4 (bone ids), weight Uint8x4 (sum 255), info Uint8x4
//     (kind 0 body / 1 eye / 2 hair card, ambient occlusion, head flag),
//     pivots = rest joint positions (3 per bone), lods[i] = Uint16 indices,
//     texture = body texture file (sRGB colour + roughness in alpha, or for
//     tinted variants: luminance, top / bottom / shoes-or-hair masks).
//   clips[name].variants[v].data: frames x (root offset xyz + 20 quaternions xyzw).
