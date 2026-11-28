// Street-tree textures: a ginkgo leaf-cluster card painted procedurally in a
// headless Chromium canvas (late-November yellow), plus a CC0 bark texture
// from Poly Haven. Output: <out>/tree_leaves.ktx2, tree_bark.ktx2, tree_bark_n.ktx2
// Usage: node build_trees.mjs <work_dir> <public/textures>
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { NodeBasisEncoder } from 'ktx2-encoder';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [work, out] = process.argv.slice(2);
mkdirSync(work, { recursive: true });
mkdirSync(out, { recursive: true });
const basis = await new NodeBasisEncoder().init();
const S = 512;

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

// ---- leaf card ----------------------------------------------------------
const browser = await chromium.launch();
const page = await browser.newPage();
const leaves = await page.evaluate((S) => {
  let seed = 7;
  const r = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  // Twigs from the lower centre.
  g.strokeStyle = '#4a3b2c';
  g.lineCap = 'round';
  for (let i = 0; i < 9; i++) {
    const a = -Math.PI / 2 + (r() - 0.5) * 2.4;
    g.lineWidth = 2 + r() * 3;
    g.beginPath();
    g.moveTo(S / 2, S * 0.92);
    g.quadraticCurveTo(S / 2 + Math.cos(a) * S * 0.2, S * 0.7, S / 2 + Math.cos(a) * S * 0.42, S / 2 + Math.sin(a) * S * 0.4);
    g.stroke();
  }
  // Ginkgo leaves: fan blades with a central notch on short petioles.
  const leaf = (x, y, s, rot, col) => {
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.strokeStyle = '#6b5a2a';
    g.lineWidth = Math.max(1, s * 0.06);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(0, s * 0.55);
    g.stroke();
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
    // Veins and a darker edge for depth.
    g.strokeStyle = 'rgba(120,80,10,0.35)';
    g.lineWidth = 0.8;
    for (let k = -3; k <= 3; k++) {
      g.beginPath();
      g.moveTo(0, -s * 0.02);
      g.lineTo(k * s * 0.17, -s * 0.85);
      g.stroke();
    }
    g.restore();
  };
  const cols = ['#e8c22e', '#f0cf3a', '#ddb021', '#d29a1c', '#e9cc4a', '#c9b33a', '#f3d65c', '#b99a24'];
  for (let i = 0; i < 520; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * S * 0.46;
    const x = S / 2 + Math.cos(a) * d;
    const y = S / 2 + Math.sin(a) * d * 0.92;
    const shade = 0.8 + 0.25 * (1 - d / (S * 0.46));
    g.globalAlpha = 1;
    g.filter = `brightness(${shade.toFixed(2)})`;
    leaf(x, y, S * (0.045 + r() * 0.03), r() * Math.PI * 2, cols[Math.floor(r() * cols.length)]);
  }
  g.filter = 'none';
  const d = g.getImageData(0, 0, S, S).data;
  // Hard alpha (alpha-tested) and colour bleed into the gaps.
  for (let i = 0; i < d.length; i += 4) d[i + 3] = d[i + 3] > 110 ? 255 : 0;
  for (let i = 0; i < d.length; i += 4) if (!d[i + 3]) { d[i] = 200; d[i + 1] = 160; d[i + 2] = 40; }
  return Array.from(d);
}, S);
await browser.close();
writeFileSync(join(out, 'tree_leaves.ktx2'), encode(new Uint8Array(leaves), S, S, 'leaves'));

// ---- bark (Poly Haven CC0) ----------------------------------------------
const py = `
import json, subprocess, sys
from io import BytesIO
from PIL import Image
UA = "kta-asset-pipeline/0.1"
get = lambda u: subprocess.run(["curl", "-sSfL", "-A", UA, u], check=True, capture_output=True).stdout
f = json.loads(get("https://api.polyhaven.com/files/bark_brown_02"))
for key, name in (("Diffuse", "bark"), ("nor_gl", "bark_n")):
    img = Image.open(BytesIO(get(f[key]["1k"]["jpg"]["url"]))).convert("RGBA").resize((256, 512), Image.LANCZOS)
    open(sys.argv[1] + "/" + name + ".rgba", "wb").write(img.tobytes())
`;
execFileSync('python3', ['-c', py, work]);
const { readFileSync } = await import('node:fs');
writeFileSync(join(out, 'tree_bark.ktx2'), encode(new Uint8Array(readFileSync(join(work, 'bark.rgba'))), 256, 512, 'bark'));
writeFileSync(join(out, 'tree_bark_n.ktx2'), encode(new Uint8Array(readFileSync(join(work, 'bark_n.rgba'))), 256, 512, 'normal'));
console.log('tree textures written');
