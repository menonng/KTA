// Turn the fetched CC0 glTF models into small game-ready GLBs:
//   keep the clean variant, bake transforms, normalise (metres, base at y=0,
//   centred, front = +Z), merge, simplify to a triangle budget, KTX2 textures
//   (albedo ETC1S sRGB, normal UASTC, ORM ETC1S linear), quantise + meshopt.
// Usage: node build_models.mjs <work_dir> <out_dir>
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, getBounds, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, join as joinPrims, weld, simplify, prune, quantize, transformMesh, listTextureSlots } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { NodeBasisEncoder } from 'ktx2-encoder';

const here = dirname(fileURLToPath(import.meta.url));
const [work, out] = process.argv.slice(2);
const spec = JSON.parse(readFileSync(join(here, 'models.json'), 'utf8'));
mkdirSync(out, { recursive: true });
await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const basis = await new NodeBasisEncoder().init();
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

function encodeKTX2(rgba, w, h, kind) {
  const enc = new basis.BasisEncoder();
  try {
    enc.setSliceSourceImage(0, rgba, w, h, 0);
    enc.setCreateKTX2File(true);
    enc.setMipGen(true);
    const srgb = kind === 'color';
    (enc.setKTX2AndBasisSRGBTransferFunc ?? enc.setKTX2SRGBTransferFunc).call(enc, srgb);
    if (kind === 'normal') {
      enc.setUASTC(true);
      enc.setPerceptual(false);
      (enc.setNormalMapPreset ?? enc.setNormalMap).call(enc);
      enc.setKTX2UASTCSupercompression(true);
      enc.setRDOUASTC(true);
      enc.setRDOUASTCQualityScalar(2.0);
    } else {
      enc.setUASTC(false);
      enc.setPerceptual(srgb);
      enc.setQualityLevel?.(srgb ? 190 : 150);
    }
    const buf = new Uint8Array(w * h * 6 + 65536);
    const n = enc.encode(buf);
    if (!n) throw new Error('KTX2 encode failed');
    return buf.slice(0, n);
  } finally {
    enc.delete();
  }
}

const triCount = (doc) => doc.getRoot().listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((t, p) => t + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3, 0), 0);

for (const [name, m] of Object.entries(spec.models)) {
  const dir = join(work, name);
  const gltfFile = readdirSync(dir).find((f) => f.endsWith('.gltf'));
  const texinfo = JSON.parse(readFileSync(join(dir, 'textures.json'), 'utf8'));
  // Images are replaced from the resized RGBA files later: give the reader
  // placeholders instead of the original JPEGs.
  const json = JSON.parse(readFileSync(join(dir, gltfFile), 'utf8'));
  const resources = {};
  for (const bf of json.buffers || []) resources[bf.uri] = new Uint8Array(readFileSync(join(dir, bf.uri)));
  for (const im of json.images || []) resources[im.uri] = new Uint8Array([0]);
  const doc = await io.readJSON({ json, resources });
  const root = doc.getRoot();
  const scene = root.getDefaultScene() || root.listScenes()[0];

  // Keep the clean variant only (drop rusted / graffiti duplicates).
  for (const node of root.listNodes()) {
    if (/rusted|graffiti/i.test(node.getName()) && node.getMesh()) node.dispose();
  }
  for (const mat of root.listMaterials()) if (/rusted|graffiti/i.test(mat.getName())) {
    for (const prim of root.listMeshes().flatMap((ms) => ms.listPrimitives())) if (prim.getMaterial() === mat) prim.dispose();
  }

  // Bake world transforms into the meshes, then parent everything to the scene.
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    transformMesh(mesh, node.getWorldMatrix());
    node.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    scene.addChild(node);
  }
  for (const node of root.listNodes()) if (!node.getMesh() && node.listChildren().length === 0) node.dispose();
  await doc.transform(prune());

  // Normalise: base at y = 0, centred in x/z, longest horizontal side = fit.
  const b = getBounds(scene);
  const sx = b.max[0] - b.min[0];
  const sz = b.max[2] - b.min[2];
  const k = m.fit / Math.max(sx, sz);
  const cx = (b.max[0] + b.min[0]) / 2;
  const cz = (b.max[2] + b.min[2]) / 2;
  const T = [k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0, -cx * k, -b.min[1] * k, -cz * k, 1];
  for (const mesh of root.listMeshes()) transformMesh(mesh, T);

  // Grille-type BLEND materials whose colour map is an opacity mask: dark
  // metal colour with the mask in alpha, alpha-tested (no sorting).
  const maskColor = new Set();
  for (const mat of root.listMaterials()) {
    if (mat.getAlphaMode() === 'BLEND') {
      mat.setAlphaMode('MASK').setAlphaCutoff(0.5);
      const t = mat.getBaseColorTexture();
      if (t && /opacity/.test(t.getURI())) maskColor.add(t);
    }
  }

  const before = triCount(doc);
  await doc.transform(dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH] }), joinPrims(), weld());
  let ratio = Math.min(1, m.tris / triCount(doc));
  for (const err of [0.01, 0.03, 0.08, 0.2, 0.5].filter((e) => e <= (m.maxErr ?? 0.08))) {
    if (triCount(doc) <= m.tris * 1.25) break;
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: err }));
    ratio = Math.min(1, m.tris / triCount(doc));
  }
  const after = triCount(doc);
  const nb = getBounds(scene);
  const dims = [0, 1, 2].map((i) => (nb.max[i] - nb.min[i]).toFixed(2)).join(' x ');

  // Textures -> KTX2.
  for (const tex of root.listTextures()) {
    const info = texinfo[tex.getURI()];
    if (!info) {
      tex.dispose();
      continue;
    }
    const slots = listTextureSlots(tex);
    const kind = slots.includes('normalTexture') ? 'normal' : slots.includes('baseColorTexture') ? 'color' : 'data';
    let rgba = new Uint8Array(readFileSync(join(dir, 'tex', info.file)));
    if (maskColor.has(tex)) {
      const o = new Uint8Array(rgba.length);
      for (let i = 0; i < rgba.length; i += 4) {
        o[i] = o[i + 1] = o[i + 2] = 46;
        o[i + 3] = rgba[i];
      }
      rgba = o;
    }
    tex.setImage(encodeKTX2(rgba, info.w, info.h, kind)).setMimeType('image/ktx2').setURI(`${name}_${basename(info.file, '.rgba')}.ktx2`);
  }
  doc.createExtension(KHRTextureBasisu).setRequired(true);
  await doc.transform(prune(), quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }));
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  const glb = await io.writeBinary(doc);
  const file = join(out, `${name}.glb`);
  writeFileSync(file, glb);
  console.log(`${name.padEnd(11)} ${before} -> ${after} tris, ${root.listTextures().length} tex, ${(glb.byteLength / 1024).toFixed(0)} KB, ${dims} m`);
}
