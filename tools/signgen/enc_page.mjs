// Encode one raw RGBA atlas page into a mipmapped sRGB UASTC KTX2 (RDO + Zstd).
// node enc_page.mjs <in.rgba> <size> <out.ktx2>
import { readFileSync, writeFileSync } from 'node:fs';
import { NodeBasisEncoder } from 'ktx2-encoder';
const [inp, size, out] = process.argv.slice(2);
const S = +size;
const mod = await new NodeBasisEncoder().init();
const enc = new mod.BasisEncoder();
enc.setTexType(0);
enc.setSliceSourceImage(0, new Uint8Array(readFileSync(inp)), S, S, 0);
enc.setCreateKTX2File(true);
enc.setMipGen(true);
enc.setUASTC(true);
enc.setPerceptual(true);
(enc.setKTX2AndBasisSRGBTransferFunc ?? enc.setKTX2SRGBTransferFunc).call(enc, true);
enc.setKTX2UASTCSupercompression(true);
enc.setRDOUASTC(true);
enc.setRDOUASTCQualityScalar(1.0);
enc.setDebug?.(false);
const buf = new Uint8Array(Math.ceil(S * S * 1.6) + 65536);
const n = enc.encode(buf);
enc.delete();
if (!n) throw new Error('encode failed ' + inp);
writeFileSync(out, buf.slice(0, n));
