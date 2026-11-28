// Rebuild only the animation clips (people_anim.bin + the clips section of
// people.json) from the rest skeletons stored in people.json.
//
//   CMU=<cmu-mocap/data> node people/build_motion.mjs <models dir>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BONES } from '../humans/skeleton.mjs';
import { buildClips } from './clips.mjs';

const [OUT] = process.argv.slice(2);
if (!OUT || !process.env.CMU) throw new Error('usage: CMU=<cmu-mocap/data> node people/build_motion.mjs <models dir>');
const header = JSON.parse(readFileSync(join(OUT, 'people.json'), 'utf8'));
const variants = {};
for (const [name, v] of Object.entries(header.variants)) {
  const pivot = BONES.map((_, i) => v.pivots.slice(i * 3, i * 3 + 3));
  const defs = Object.fromEntries(BONES.map((b, i) => [b, [pivot[i], v.defs.slice(i * 6, i * 6 + 3), v.defs.slice(i * 6 + 3, i * 6 + 6)]]));
  variants[name] = { pivot, defs };
}
const { clips, buffer } = buildClips(process.env.CMU, variants, header.fps);
header.clips = clips;
header.anim = 'people_anim.bin';
writeFileSync(join(OUT, 'people_anim.bin'), buffer);
writeFileSync(join(OUT, 'people.json'), JSON.stringify(header));
console.log(`wrote people_anim.bin ${(buffer.length / 1024).toFixed(0)} KB`);
