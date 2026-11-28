// Street-tree bark: a CC0 bark texture from Poly Haven (colour + normal).
// Output: <out>/tree_bark_n.ktx2 and <work>/bark*.rgba, which
// build_species.mjs packs into the species bark atlas next to the twig/leaf cards.
// Usage: node build_trees.mjs <work_dir> <public/textures>
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { NodeBasisEncoder } from 'ktx2-encoder';

const [work, out] = process.argv.slice(2);
mkdirSync(work, { recursive: true });
mkdirSync(out, { recursive: true });
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
writeFileSync(join(out, 'tree_bark_n.ktx2'), encode(new Uint8Array(readFileSync(join(work, 'bark_n.rgba'))), 256, 512, 'normal'));
console.log('tree textures written');
