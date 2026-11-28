// Street-tree species textures for the surveyed trees (서울시 가로수 위치정보):
// one alpha-tested card atlas with a late-November twig/leaf card per species
// and a bark atlas, both painted procedurally in a headless Chromium canvas
// (the generic bark column reuses the Poly Haven CC0 bark from build_trees.mjs).
//
// Cards (4 x 2 cells of 512 px):
//   0 ginkgo   - last yellow fans on short spurs (most have fallen by late Nov)
//   1 plane    - dry brown lobed leaves curled on the twigs, seed balls
//   2 zelkova  - dense fine twigs, a few russet leaves
//   3 fringe   - twigs with a few yellow-brown leaves
//   4 cherry   - bare dark twigs
//   5 pine     - needle tufts (evergreen)
//   6 maple    - twigs with the last red leaves
//   7 generic  - bare twigs, a few yellow-green leaves (회화나무, others)
// Bark (4 columns of 128 x 512): plane camouflage, cherry, pine, generic.
//
// Usage: node build_species.mjs <work_dir with bark.rgba, bark_n.rgba> <public/textures>
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { NodeBasisEncoder } from 'ktx2-encoder';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [work, out] = process.argv.slice(2);
if (!work || !out) throw new Error('usage: node build_species.mjs <work> <public/textures>');
const basis = await new NodeBasisEncoder().init();

function encode(rgba, w, h, kind) {
  const enc = new basis.BasisEncoder();
  try {
    enc.setSliceSourceImage(0, rgba, w, h, 0);
    enc.setCreateKTX2File(true);
    enc.setMipGen(true);
    (enc.setKTX2AndBasisSRGBTransferFunc ?? enc.setKTX2SRGBTransferFunc).call(enc, kind !== 'normal');
    enc.setUASTC(kind !== 'bark');
    if (kind === 'normal') (enc.setNormalMapPreset ?? enc.setNormalMap).call(enc);
    if (kind !== 'bark') {
      enc.setKTX2UASTCSupercompression(true);
      enc.setRDOUASTC(true);
      enc.setRDOUASTCQualityScalar(1.5);
    } else enc.setQualityLevel?.(190);
    const buf = new Uint8Array(w * h * 6 + 65536);
    const n = enc.encode(buf);
    if (!n) throw new Error('encode failed');
    return buf.slice(0, n);
  } finally {
    enc.delete();
  }
}

const browser = await chromium.launch();
const page = await browser.newPage();
const generic = Array.from(readFileSync(join(work, 'bark.rgba')));
const { cards, bark } = await page.evaluate((generic) => {
  let seed = 19;
  const r = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const C = 512;
  const cv = document.createElement('canvas');
  cv.width = C * 4;
  cv.height = C * 2;
  const g = cv.getContext('2d');
  g.lineCap = 'round';

  // Recursive twig spray from the bottom centre of a cell. Returns tip points.
  function twigs(ox, oy, opt) {
    const tips = [];
    const grow = (x, y, a, len, w, depth) => {
      const x2 = x + Math.cos(a) * len;
      const y2 = y + Math.sin(a) * len;
      g.strokeStyle = opt.col;
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo((x + x2) / 2 + (r() - 0.5) * len * 0.25, (y + y2) / 2 + (r() - 0.5) * len * 0.25, x2, y2);
      g.stroke();
      if (depth <= 0 || w < 0.6) {
        tips.push([x2, y2, a]);
        return;
      }
      const n = opt.fork + (r() < 0.4 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const da = (r() - 0.5) * opt.spread + (i - (n - 1) / 2) * opt.spread * 0.5;
        grow(x2, y2, a + da, len * (opt.decay + r() * 0.12), w * 0.66, depth - 1);
      }
      if (r() < 0.6) tips.push([x2, y2, a]);
    };
    for (let i = 0; i < opt.roots; i++) {
      const a = -Math.PI / 2 + (r() - 0.5) * opt.fan;
      grow(ox + C / 2 + (r() - 0.5) * C * 0.1, oy + C * 0.97, a, C * opt.len * (0.8 + r() * 0.4), opt.w, opt.depth);
    }
    return tips;
  }
  const inCell = (ox, oy, x, y) => x > ox + 4 && x < ox + C - 4 && y > oy + 4 && y < oy + C - 4;

  const ginkgoLeaf = (x, y, s, rot, col) => {
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(-s * 0.62, -s * 0.7);
    g.quadraticCurveTo(-s * 0.35, -s * 1.02, -s * 0.06, -s * 0.86);
    g.lineTo(0, -s * 0.66);
    g.lineTo(s * 0.06, -s * 0.86);
    g.quadraticCurveTo(s * 0.35, -s * 1.02, s * 0.62, -s * 0.7);
    g.closePath();
    g.fill();
    g.restore();
  };
  const lobed = (x, y, s, rot, col, lobes) => {
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.fillStyle = col;
    g.beginPath();
    for (let k = 0; k <= lobes * 2; k++) {
      const a = -Math.PI / 2 + ((k / (lobes * 2)) - 0.5) * Math.PI * 1.6;
      const rr = k % 2 === 0 ? s : s * 0.55;
      const px = Math.cos(a) * rr;
      const py = Math.sin(a) * rr * 0.9;
      if (k === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.lineTo(0, s * 0.15);
    g.closePath();
    g.fill();
    g.restore();
  };
  const ovate = (x, y, s, rot, col, ratio = 0.45) => {
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.fillStyle = col;
    g.beginPath();
    g.ellipse(0, -s * 0.5, s * ratio, s * 0.5, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  };
  const pick = (a) => a[Math.floor(r() * a.length)];

  const cell = (i) => [(i % 4) * C, Math.floor(i / 4) * C];
  // 0 ginkgo: short spurs, sparse fans.
  {
    const [ox, oy] = cell(0);
    const tips = twigs(ox, oy, { col: '#5a4a3a', roots: 6, fan: 1.6, len: 0.3, w: 5, depth: 3, fork: 2, spread: 0.9, decay: 0.66 });
    const cols = ['#e8c22e', '#f0cf3a', '#ddb021', '#d29a1c', '#c9a63a', '#b99a24'];
    for (const [x, y] of tips) for (let k = 0; k < 4; k++) if (r() < 0.55) {
      const lx = x + (r() - 0.5) * 26, ly = y + (r() - 0.5) * 26;
      if (inCell(ox, oy, lx, ly)) ginkgoLeaf(lx, ly, C * (0.04 + r() * 0.025), r() * 6.28, pick(cols));
    }
  }
  // 1 plane: big dry lobed leaves, seed balls on long stalks.
  {
    const [ox, oy] = cell(1);
    const tips = twigs(ox, oy, { col: '#6a5a48', roots: 5, fan: 1.8, len: 0.32, w: 6, depth: 3, fork: 2, spread: 1.0, decay: 0.68 });
    const cols = ['#9a6b32', '#a87a3c', '#7d5528', '#b48a4a', '#8a6a3a', '#6e4e2a'];
    for (const [x, y] of tips) {
      if (r() < 0.5) {
        const lx = x + (r() - 0.5) * 20, ly = y + (r() - 0.5) * 20;
        if (inCell(ox, oy, lx, ly)) lobed(lx, ly, C * (0.05 + r() * 0.035), r() * 6.28, pick(cols), 3);
      }
      if (r() < 0.12) {
        g.strokeStyle = '#4a3a2a';
        g.lineWidth = 1.2;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + 4, y + 22);
        g.stroke();
        g.fillStyle = '#6a5030';
        g.beginPath();
        g.arc(x + 4, y + 26, 6, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  // 2 zelkova: dense fine twigs, few russet leaves.
  {
    const [ox, oy] = cell(2);
    const tips = twigs(ox, oy, { col: '#4e4036', roots: 9, fan: 1.3, len: 0.26, w: 4, depth: 5, fork: 2, spread: 0.7, decay: 0.72 });
    const cols = ['#8a4a26', '#a0582c', '#7a4a2a', '#b06a34'];
    for (const [x, y] of tips) if (r() < 0.22 && inCell(ox, oy, x, y)) ovate(x, y, C * (0.022 + r() * 0.012), r() * 6.28, pick(cols));
  }
  // 3 fringe tree: twigs with a few yellow-brown leaves.
  {
    const [ox, oy] = cell(3);
    const tips = twigs(ox, oy, { col: '#5a4c40', roots: 7, fan: 1.7, len: 0.28, w: 4.5, depth: 4, fork: 2, spread: 0.85, decay: 0.7 });
    const cols = ['#b49a3a', '#9a8a3a', '#c2a24a', '#8a6a32'];
    for (const [x, y] of tips) if (r() < 0.35 && inCell(ox, oy, x, y)) ovate(x, y, C * (0.035 + r() * 0.015), r() * 6.28, pick(cols), 0.32);
  }
  // 4 cherry: bare, dark, spur-rich.
  {
    const [ox, oy] = cell(4);
    twigs(ox, oy, { col: '#3e302a', roots: 7, fan: 1.9, len: 0.3, w: 5, depth: 4, fork: 2, spread: 0.95, decay: 0.68 });
  }
  // 5 pine: needle tufts along twigs.
  {
    const [ox, oy] = cell(5);
    const tips = twigs(ox, oy, { col: '#5a3e2c', roots: 5, fan: 1.9, len: 0.3, w: 5, depth: 2, fork: 2, spread: 0.9, decay: 0.7 });
    for (const [x, y, a] of tips) {
      for (let k = 0; k < 70; k++) {
        const na = a + (r() - 0.5) * 2.4;
        const nl = 16 + r() * 22;
        g.strokeStyle = pick(['#2f4a2a', '#3a5a32', '#26402a', '#456a3a']);
        g.lineWidth = 1.4;
        const bx = x - Math.cos(a) * r() * 30, by = y - Math.sin(a) * r() * 30;
        g.beginPath();
        g.moveTo(bx, by);
        g.lineTo(bx + Math.cos(na) * nl, by + Math.sin(na) * nl);
        g.stroke();
      }
    }
  }
  // 6 maple: twigs, last red leaves.
  {
    const [ox, oy] = cell(6);
    const tips = twigs(ox, oy, { col: '#4e3e34', roots: 7, fan: 1.7, len: 0.28, w: 4.5, depth: 4, fork: 2, spread: 0.85, decay: 0.7 });
    const cols = ['#b02a1e', '#c8402a', '#8a2a1e', '#d0602a'];
    for (const [x, y] of tips) if (r() < 0.3 && inCell(ox, oy, x, y)) lobed(x, y, C * (0.03 + r() * 0.012), r() * 6.28, pick(cols), 2);
  }
  // 7 generic: bare twigs, a few yellow-green leaflets.
  {
    const [ox, oy] = cell(7);
    const tips = twigs(ox, oy, { col: '#4c4038', roots: 7, fan: 1.7, len: 0.28, w: 4.5, depth: 4, fork: 2, spread: 0.85, decay: 0.7 });
    const cols = ['#a8a040', '#b8a24a', '#8a8a3a'];
    for (const [x, y] of tips) if (r() < 0.2 && inCell(ox, oy, x, y)) ovate(x, y, C * (0.02 + r() * 0.01), r() * 6.28, pick(cols), 0.35);
  }
  const d = g.getImageData(0, 0, C * 4, C * 2).data;
  for (let i = 0; i < d.length; i += 4) d[i + 3] = d[i + 3] > 100 ? 255 : 0;
  // Bleed a neutral bark colour into transparent texels (mip filtering).
  for (let i = 0; i < d.length; i += 4) if (!d[i + 3]) { d[i] = 80; d[i + 1] = 68; d[i + 2] = 56; }

  // ---- bark atlas (128 x 512 per column) ----
  const B = document.createElement('canvas');
  B.width = 512;
  B.height = 512;
  const b = B.getContext('2d');
  // 0 plane: exfoliating camouflage patches (cream, olive, grey-brown).
  b.fillStyle = '#b9b19a';
  b.fillRect(0, 0, 128, 512);
  for (let i = 0; i < 260; i++) {
    b.fillStyle = pick(['#8c8a6a', '#a4a07c', '#cfc6a8', '#7a735c', '#9a9070', '#d8d0b6', '#6c6a52']);
    const x = r() * 128, y = r() * 512, w = 8 + r() * 26, h = 10 + r() * 34;
    b.beginPath();
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      const rr = 0.7 + r() * 0.5;
      const px = x + Math.cos(a) * w * 0.5 * rr, py = y + Math.sin(a) * h * 0.5 * rr;
      if (k === 0) b.moveTo(px, py);
      else b.lineTo(px, py);
    }
    b.closePath();
    b.fill();
  }
  // 1 cherry: dark reddish-brown, glossy horizontal lenticel bands.
  b.fillStyle = '#4a3430';
  b.fillRect(128, 0, 128, 512);
  for (let y = 0; y < 512; y += 3) {
    b.fillStyle = `rgba(${60 + r() * 30},${40 + r() * 20},${36 + r() * 16},0.5)`;
    b.fillRect(128, y, 128, 2);
  }
  for (let i = 0; i < 220; i++) {
    b.fillStyle = pick(['#8a7060', '#9a8270', '#6a5448']);
    b.fillRect(128 + r() * 120, r() * 512, 6 + r() * 14, 1.5 + r() * 1.5);
  }
  // 2 pine: reddish-orange plates with dark fissures (소나무 수피).
  b.fillStyle = '#5a3a2a';
  b.fillRect(256, 0, 128, 512);
  for (let i = 0; i < 200; i++) {
    b.fillStyle = pick(['#a0583a', '#b8683e', '#8a4a30', '#c47a4a', '#7a4430']);
    const x = 256 + r() * 120, y = r() * 512;
    b.fillRect(x, y, 10 + r() * 22, 18 + r() * 40);
  }
  // 3 generic: the Poly Haven bark (256 x 512) squeezed into the column.
  const gi = new ImageData(new Uint8ClampedArray(generic), 256, 512);
  const tmp = document.createElement('canvas');
  tmp.width = 256;
  tmp.height = 512;
  tmp.getContext('2d').putImageData(gi, 0, 0);
  b.drawImage(tmp, 0, 0, 256, 512, 384, 0, 128, 512);
  const bd = b.getImageData(0, 0, 512, 512).data;
  for (let i = 3; i < bd.length; i += 4) bd[i] = 255;
  return { cards: Array.from(d), bark: Array.from(bd) };
}, generic);
await browser.close();
writeFileSync(join(out, 'tree_cards.ktx2'), encode(new Uint8Array(cards), 2048, 1024, 'leaves'));
writeFileSync(join(out, 'tree_bark_sp.ktx2'), encode(new Uint8Array(bark), 512, 512, 'bark'));
console.log('species textures written');
