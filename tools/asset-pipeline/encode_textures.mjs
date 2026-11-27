// Encode raw RGBA slices into KTX2 2D-array textures (Basis Universal).
// Albedo: ETC1S (sRGB). Normals: UASTC + Zstd (linear, normal-map preset).
// Usage: node encode_textures.mjs <work_dir> <out_dir>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeBasisEncoder } from 'ktx2-encoder';
const nodeEncoder = new NodeBasisEncoder();

const here = dirname(fileURLToPath(import.meta.url));
const [work, out] = process.argv.slice(2);
const spec = JSON.parse(readFileSync(join(here, 'textures.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(work, 'manifest.json'), 'utf8'));
mkdirSync(out, { recursive: true });
const mod = await nodeEncoder.init();

function encodeArray(ids, kind) {
  const enc = new mod.BasisEncoder();
  try {
    enc.setTexType(1); // cBASISTexType2DArray
    let texels = 0;
    ids.forEach((id, i) => {
      const m = manifest[`${id}_${kind}`];
      const raw = new Uint8Array(readFileSync(join(work, `${id}_${kind}.rgba`)));
      enc.setSliceSourceImage(i, raw, m.w, m.h, 0);
      texels += m.w * m.h;
    });
    enc.setCreateKTX2File(true);
    enc.setMipGen(true);
    if (kind === 'diff') {
      enc.setUASTC(false);
      enc.setPerceptual(true);
      (enc.setKTX2AndBasisSRGBTransferFunc ?? enc.setKTX2SRGBTransferFunc).call(enc, true);
      enc.setQualityLevel?.(200);
    } else {
      enc.setUASTC(true);
      enc.setPerceptual(false);
      (enc.setKTX2AndBasisSRGBTransferFunc ?? enc.setKTX2SRGBTransferFunc).call(enc, false);
      (enc.setNormalMapPreset ?? enc.setNormalMap).call(enc);
      enc.setKTX2UASTCSupercompression(true);
      enc.setRDOUASTC(true);
      enc.setRDOUASTCQualityScalar(1.5);
    }
    const buf = new Uint8Array(Math.ceil(texels * 4 * 1.4) + 65536);
    const n = enc.encode(buf);
    if (!n) throw new Error(`encode failed: ${kind} ${ids}`);
    return buf.slice(0, n);
  } finally {
    enc.delete();
  }
}

for (const [name, a] of Object.entries(spec.arrays)) {
  const ids = a.layers.map((l) => l.id);
  for (const kind of ['diff', 'nor']) {
    const data = encodeArray(ids, kind);
    const file = join(out, `${name}_${kind === 'diff' ? 'albedo' : 'normal'}.ktx2`);
    writeFileSync(file, data);
    console.log(file, (data.length / 1024).toFixed(0) + ' KB', ids.length + ' layers');
  }
}
