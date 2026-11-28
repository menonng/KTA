// Read Rocketbox FBX avatars with three.js' FBXLoader inside headless Chromium
// and dump their skinned meshes (positions, normals, UVs, skin, material
// groups) and skeleton (bone names, parents, bind-pose world matrices) to JSON.
//
//   node people/extract_fbx.mjs <out.json> <a.fbx> [b.fbx ...]
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [out, ...files] = process.argv.slice(2);
const THREE_DIR = resolve(new URL('.', import.meta.url).pathname, '../../../web/node_modules/three');
const fileMap = new Map(files.map((f, i) => [`/fbx/${i}.fbx`, resolve(f)]));
const page = `<!doctype html><script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
const b64 = (a) => { const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
window.extract = async (url) => {
  const mgr = new THREE.LoadingManager();
  mgr.setURLModifier((u) => (u.endsWith('.fbx') ? u : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='));
  const root = await new FBXLoader(mgr).loadAsync(url);
  root.updateMatrixWorld(true);
  const meshes = [];
  let skeleton = null;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    const attr = (n) => g.getAttribute(n) ? { size: g.getAttribute(n).itemSize, type: g.getAttribute(n).array.constructor.name, data: b64(g.getAttribute(n).array) } : null;
    const mats = (Array.isArray(o.material) ? o.material : [o.material]).map((m) => ({ name: m.name, map: m.map?.name || '', transparent: m.transparent, alphaMap: !!m.alphaMap }));
    meshes.push({ name: o.name, skinned: !!o.isSkinnedMesh, matrixWorld: o.matrixWorld.elements, bindMatrix: o.bindMatrix?.elements, groups: g.groups, materials: mats,
      index: g.index ? { type: g.index.array.constructor.name, data: b64(g.index.array) } : null,
      position: attr('position'), normal: attr('normal'), uv: attr('uv'), skinIndex: attr('skinIndex'), skinWeight: attr('skinWeight') });
    if (o.isSkinnedMesh && !skeleton) {
      const s = o.skeleton;
      skeleton = { bones: s.bones.map((b) => ({ name: b.name, parent: s.bones.indexOf(b.parent), world: b.matrixWorld.elements })), inverses: s.boneInverses.map((m) => m.elements) };
    }
  });
  return { meshes, skeleton };
};
window.ready = true;
</script>`;
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript' };
const server = createServer((q, s) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  if (u === '/' || u === '/index.html') { s.writeHead(200, { 'content-type': 'text/html' }); s.end(page); return; }
  if (fileMap.has(u)) { s.writeHead(200, { 'content-type': 'application/octet-stream' }); s.end(readFileSync(fileMap.get(u))); return; }
  if (u.startsWith('/three/')) {
    const p = join(THREE_DIR, u.slice(7));
    if (p.startsWith(THREE_DIR) && existsSync(p)) { s.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' }); s.end(readFileSync(p)); return; }
  }
  s.writeHead(404); s.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch();
const pg = await browser.newPage();
pg.on('pageerror', (e) => console.error('[page]', e.message));
await pg.goto(`http://127.0.0.1:${server.address().port}/`);
await pg.waitForFunction(() => window.ready === true);
const result = {};
for (const [url, path] of fileMap) {
  const r = await pg.evaluate((u) => window.extract(u), url);
  result[path] = r;
  console.log(path.split('/').pop(), r.meshes.map((m) => `${m.name}(${m.position ? Buffer.from(m.position.data, 'base64').length / 12 : 0}v, mats ${m.materials.map((x) => x.name).join('/')})`).join(' '), 'bones', r.skeleton?.bones.length);
}
writeFileSync(out, JSON.stringify(result));
await browser.close();
server.close();
