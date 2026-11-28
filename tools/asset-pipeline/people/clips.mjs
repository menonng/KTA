// Animation clips for every people variant: CMU walks (several subjects, so
// the crowd does not march in step), a CMU run and the designed standing loop.
// Output goes to its own file (people_anim.bin) so motion can be rebuilt in
// seconds without touching meshes or textures (people/build_motion.mjs).

import { join } from 'node:path';
import { loadClip, findLoop, retarget, designedIdle } from '../humans/motion.mjs';

export const CLIP_SPECS = {
  walk0: { file: '035/35_01.bvh', loop: [0.9, 1.3], inPlace: true },
  walk1: { file: '007/07_01.bvh', loop: [0.9, 1.3], inPlace: true },
  walk2: { file: '008/08_01.bvh', loop: [0.9, 1.3], inPlace: true },
  walk3: { file: '002/02_01.bvh', loop: [0.9, 1.3], inPlace: true },
  run: { file: '035/35_17.bvh', loop: [0.55, 0.85], inPlace: true },
  idle: { designed: true, seconds: 12 },
};

/** variants: { name: { pivot: [[x,y,z]...20], defs: { bone: [pivot, from, to] } } }. Returns { clips, buffer }. */
export function buildClips(CMU, variants, fps = 30) {
  const chunks = [];
  let offset = 0;
  const push = (arr) => {
    const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    chunks.push(buf);
    const at = offset;
    offset += buf.length;
    return at;
  };
  const clips = {};
  for (const [cn, spec] of Object.entries(CLIP_SPECS)) {
    const c = { variants: {} };
    if (spec.designed) {
      for (const [name, b] of Object.entries(variants)) {
        const r = designedIdle(b, fps, spec.seconds);
        c.frames = r.frames;
        c.variants[name] = { data: push(r.data), speed: 0 };
      }
    } else {
      const clip = loadClip(join(CMU, spec.file));
      const nf = clip.frames.length;
      const lp = findLoop(clip, spec.loop[0], spec.loop[1], Math.floor((spec.from ?? 0) * nf), Math.floor((spec.to ?? 1) * nf));
      for (const [name, b] of Object.entries(variants)) {
        const r = retarget(clip, lp.s, lp.p, b, fps, spec.inPlace);
        c.frames = r.frames;
        c.variants[name] = { data: push(r.data), speed: +r.speed.toFixed(3) };
      }
      console.log(`clip ${cn}: ${spec.file} loop ${(lp.p / clip.fps).toFixed(2)} s, err ${lp.err.toFixed(2)}`);
    }
    clips[cn] = c;
  }
  return { clips, buffer: Buffer.concat(chunks) };
}
