// Headless smoke test: loads the built game, captures screenshots from a few
// viewpoints (day/night) and the benchmark stats. Software GL, so frame times
// are not representative; draw calls / memory counters are.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const url = process.argv[2] || 'http://localhost:4173/';
  const out = process.argv[3] || path.join(__dirname, '..', 'test-output');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(url + '?debug&time=14', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__kta, null, { timeout: 60000 });
  await page.waitForTimeout(2500);
  const shots = [
    ['day-street', 14, [0.6, 0.28, 7]],
    ['day-high', 14, [2.2, 0.75, 45]],
    ['night-street', 21.5, [0.6, 0.22, 7]],
    ['night-high', 21.5, [3.8, 0.55, 40]],
  ];
  for (const [name, t, v] of shots) {
    await page.evaluate(([t, v]) => { window.__kta.setTime(t); window.__kta.setView(v[0], v[1], v[2]); }, [t, v]);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(out, `${name}.png`) });
  }
  const stats = await page.evaluate(() => window.__kta.stats());
  fs.writeFileSync(path.join(out, 'stats.json'), JSON.stringify(stats, null, 2));
  fs.writeFileSync(path.join(out, 'console.log'), logs.join('\n'));
  console.log(JSON.stringify(stats));
  console.log(logs.filter((l) => /error|warn/i.test(l)).slice(0, 15).join('\n'));
  await browser.close();
})();
