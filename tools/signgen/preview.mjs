// Contact sheets of sign designs for review (not part of the build).
// node tools/signgen/preview.mjs <out_dir> [set]
//   set: brands | shops | extras | boards | all (default all)
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import http from 'node:http';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const [outDir = join(here, 'work'), set = 'all'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
if (!existsSync(join(here, 'fonts.css'))) throw new Error('run gen.mjs once first (writes fonts.css)');

const brands = ['GG24', 'CUZ', '식스텐', '스타덕스', '기가커피', '빡다방', '올리브올드', '다사소', '라떼리아', '기겁떡볶이', '인생여덟컷', '너희은행', 'SQ텔레콤', 'QT', '뭐신사 스탠다드', '라떼마트'];
const shopCats = ['cafe', 'korean', 'bbq', 'chicken', 'snack', 'hair', 'clinic', 'pharmacy', 'realestate', 'clothes', 'bar', 'hof', 'karaoke', 'pc', 'bakery', 'dessert', 'cosmetics', 'nail', 'academy', 'restaurant', 'izakaya', 'chinese', 'italian', 'phone'];
const sets = {
  brands: [
    ...brands.map((t, i) => ({ k: 'fascia', c: 'brand', t, fg: '#FFFFFF', bg: '#DA291C', w: 7, h: 1.15, s: 11 + i, f: 0, ten: [], i })),
    { k: 'disc', c: 'brand', t: '스타덕스', fg: '#FFFFFF', bg: '#00704A', w: 0.9, h: 0.9, s: 5, f: 0, ten: [], i: 99 },
    ...['식스텐', 'GG24', 'CUZ'].map((t, i) => ({ k: 'band', c: 'brand', t, fg: '', bg: '', w: 6, h: 0.4, s: 40 + i, f: 0, ten: [], i: 100 + i })),
    { k: 'upper', c: 'church', t: '', fg: '', bg: '', w: 5, h: 0.95, s: 77, f: 4, ten: [], i: 120 },
    { k: 'vert', c: 'church', t: '', fg: '', bg: '', w: 0.72, h: 3.2, s: 78, f: 0, ten: [], i: 121 },
    { k: 'cross', c: 'church', t: '', fg: '', bg: '', w: 1.1, h: 2.0, s: 7, f: 0, ten: [], i: 122 },
  ],
  shops: shopCats.flatMap((c, j) => [0, 1].map((v) => ({ k: 'fascia', c, t: '', fg: '', bg: '', w: 6.5, h: 1.15, s: 1000 + j * 31 + v * 7, f: 0, ten: [], i: j * 2 + v }))),
  extras: [
    ...['cafe', 'food', 'bar', 'retail', 'service'].flatMap((c, j) => [0, 1, 2].map((v) => ({ k: 'decal', c, t: '', fg: '', bg: '', w: 1.7, h: 0.55, s: 300 + j * 17 + v * 5, f: 0, ten: [], i: j * 3 + v }))),
    ...['cafe', 'food', 'bar', 'service'].flatMap((c, j) => [0, 1].map((v) => ({ k: 'stand', c, t: '', fg: '', bg: '', w: 0.58, h: 1.05, s: 500 + j * 13 + v * 3, f: 0, ten: [], i: j * 2 + v }))),
    ...['cafe', 'food', 'retail'].flatMap((c, j) => [0, 1].map((v) => ({ k: 'awning', c, t: '', fg: '', bg: '', w: 1.2, h: 0.62, s: 700 + j * 11 + v * 3, f: 0, ten: [], i: j * 2 + v }))),
  ],
  boards: ['심송', '기가커피', '참아슬', '농담식품 매운라면', '코코아T', '꾸팡'].map((t, i) => ({ k: 'board', c: 'brand', t, fg: '#FFFFFF', bg: ['#1428A0', '#FFD400', '#0B6E4F', '#C8102E', '#FFE000', '#E8501E'][i], w: 10, h: 3.2, s: 900 + i, f: 0, ten: [], i })),
};
sets.boards[1].fg = '#3A2416';
sets.boards[4].fg = '#1A1A1A';

const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = http.createServer((q, s) => {
  const p = join(here, decodeURIComponent(q.url.split('?')[0]));
  if (!p.startsWith(here) || !existsSync(p)) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
  s.end(readFileSync(p));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('[page]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.error('[page]', m.text()); });
await page.goto(`http://127.0.0.1:${server.address().port}/page.html`);
await page.waitForFunction(() => window.signgenReady === true);
for (const [name, reqs] of Object.entries(sets)) {
  if (set !== 'all' && set !== name) continue;
  const cols = name === 'extras' ? 6 : name === 'boards' ? 2 : 2;
  const px = name === 'boards' ? 60 : name === 'extras' ? 150 : 110;
  const url = await page.evaluate(([r, c, p]) => window.signSheet(r, c, p), [reqs, cols, px]);
  const file = join(outDir, `sheet-${name}.png`);
  writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
  console.log('wrote', file);
}
await browser.close();
server.close();
