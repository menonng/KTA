// Offline sign artwork generator.
// node tools/signgen/gen.mjs <signreq.json> <web/public> [maxPages]
// -> <public>/textures/signs.ktx2 (UASTC RGBA 2D array, mipmapped, sRGB)
//    <public>/data/<name>.signs.json (per-sign atlas rect, style, box)
// Fonts (SIL OFL, via @fontsource) are used at build time only.
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, rmSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import http from 'node:http';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const [reqPath, pubDir, maxPagesArg] = process.argv.slice(2);
const maxPages = +(maxPagesArg || 8);
const name = basename(reqPath).replace('.signreq.json', '');
const req = JSON.parse(readFileSync(reqPath, 'utf8'));

// fonts.css: one @import per family/weight the designs may use.
const { FONTS, EMOJI } = await import('./design.mjs');
const specs = new Set([...Object.values(FONTS).flat(), '400 Do Hyeon', '400 Noto Sans KR', '900 Noto Sans KR', '700 Noto Sans KR', '500 Noto Sans KR', '700 Gothic A1', '500 Montserrat', '300 Oswald', '400 Playfair Display', '900 Montserrat']);
const imports = new Set();
for (const s of specs) {
  const m = s.match(/^(\d{3}) (.*)$/);
  const w = m ? m[1] : '400';
  const fam = (m ? m[2] : s).toLowerCase().replace(/ /g, '-');
  const css = join(here, 'node_modules/@fontsource', fam, `${w}.css`);
  if (!existsSync(css)) throw new Error('missing font css ' + css);
  imports.add(`@import url("node_modules/@fontsource/${fam}/${w}.css");`);
}
imports.add(`@import url("node_modules/@fontsource/${EMOJI.toLowerCase().replace(/ /g, '-')}/400.css");`);
writeFileSync(join(here, 'fonts.css'), [...imports].join('\n') + '\n');

const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = http.createServer((q, s) => {
  const p = join(here, decodeURIComponent(q.url.split('?')[0]));
  if (!p.startsWith(here) || !existsSync(p)) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
  s.end(readFileSync(p));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.error('[page]', m.text()); });
page.on('pageerror', (e) => console.error('[page]', e.message));
await page.goto(`http://127.0.0.1:${port}/page.html`);
await page.waitForFunction(() => window.signgenReady === true);
const t0 = Date.now();
const res = await page.evaluate(([r, mp]) => window.signgen(r, mp), [req.signs, maxPages]);
console.log(`rendered ${res.meta.length} signs into ${res.pages.length} pages (density scale ${res.scale.toFixed(3)}) in ${Date.now() - t0} ms`);
await browser.close();
server.close();

const S = res.size;
for (const f of readdirSync(join(pubDir, 'textures'))) if (/^signs(_\d+)?\.ktx2$/.test(f)) rmSync(join(pubDir, 'textures', f));
const raws = res.pages.map((b) => new Uint8Array(Buffer.from(b, 'base64')));
// Debug previews (not shipped).
const prevDir = join(here, 'work');
mkdirSync(prevDir, { recursive: true });
raws.forEach((r, i) => writeFileSync(join(prevDir, `page${i}.rgba`), r));

// Encode pages in parallel child processes (one KTX2 per page; the client
// merges them into one texture array, and per-page files allow streaming).
mkdirSync(join(pubDir, 'textures'), { recursive: true });
const jobs = raws.map((_, i) => () => new Promise((resolve, reject) => {
  const p = spawn(process.execPath, [join(here, 'enc_page.mjs'), join(prevDir, `page${i}.rgba`), String(S), join(pubDir, 'textures', `signs_${i}.ktx2`)], { stdio: ['ignore', 'ignore', 'inherit'] });
  p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error('page ' + i + ' failed'))));
}));
const t1 = Date.now();
let next = 0;
await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, async () => { while (next < jobs.length) await jobs[next++](); }));
let total = 0;
raws.forEach((_, i) => (total += statSync(join(pubDir, 'textures', `signs_${i}.ktx2`)).size));
console.log(`encoded ${raws.length} pages, ${(total / 1048576).toFixed(2)} MB in ${((Date.now() - t1) / 1000).toFixed(0)} s`);
mkdirSync(join(pubDir, 'data'), { recursive: true });
writeFileSync(join(pubDir, 'data', `${name}.signs.json`), JSON.stringify({ attribution: req.attribution, pages: raws.length, size: S, signs: res.meta }));
console.log(`${name}.signs.json written`);
