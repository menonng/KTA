// Vehicles: parked cars in an alley and traffic on a main road, by day and
// at night. SHOTS env: comma list of hours (default 14,21).
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const out = path.join(__dirname, '..', 'test-output');
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.error('[page]', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error('[page]', m.text()); });
  await page.goto('http://localhost:4173/?time=14', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__kta);
  await page.evaluate(() => window.__kta.signsReady);
  const parked = await page.evaluate(() => window.__kta.parkedSpots());
  console.log('parked', parked.length, 'by type', [0, 1, 2, 3, 4, 5].map((t) => parked.filter((p) => p.t === t).length).join(','));
  // A spot with several parked cars nearby (an alley row), near the SPOT sign.
  const sg = await page.evaluate((t) => window.__kta.findSign(t), process.env.SPOT || 'McRonald');
  let best = parked[0], bestN = 0;
  for (const p of parked.filter((q) => Math.hypot(q.x - sg.x, q.z - sg.z) < 160)) {
    const n = parked.filter((q) => Math.hypot(q.x - p.x, q.z - p.z) < 22).length;
    if (n > bestN) { bestN = n; best = p; }
  }
  const hours = (process.env.SHOTS || '14,21').split(',');
  const shoot = async (name, x, z, yaw, pitch, dist) => {
    await page.evaluate(([x, z]) => window.__kta.teleport(x, z), [x, z]);
    for (const h of hours) {
      await page.evaluate(([h, yaw, pitch, dist]) => { window.__kta.setTime(+h); window.__kta.setView(yaw, pitch, dist); }, [h, yaw, pitch, dist]);
      await page.waitForTimeout(3000);
      await page.screenshot({ path: path.join(out, `cars-${name}-${h}.png`) });
    }
  };
  // Stand beside the row, looking along it.
  const nx = Math.cos(best.yaw), nz = -Math.sin(best.yaw);
  await shoot('alley', best.x + nx * 2.2, best.z + nz * 2.2, best.yaw + 0.5, 0.2, 6);
  // Main road: follow a moving car for a moment.
  await page.waitForTimeout(1000);
  const moving = await page.evaluate(() => window.__kta.movingCars());
  console.log('moving', moving.length, 'avg speed', (moving.reduce((s, c) => s + c.v, 0) / moving.length).toFixed(1));
  const m = moving.filter((c) => c.t !== 5).sort((a, b) => Math.hypot(a.x - sg.x, a.z - sg.z) - Math.hypot(b.x - sg.x, b.z - sg.z))[0];
  const sx = Math.cos(m.yaw) * 7, sz = -Math.sin(m.yaw) * 7;
  await page.evaluate(() => window.__kta.freezeTraffic && window.__kta.freezeTraffic(true));
  await shoot('road', m.x + sx, m.z + sz, m.yaw + Math.PI * 0.75, 0.15, 9);
  await page.evaluate(() => window.__kta.freezeTraffic && window.__kta.freezeTraffic(false));
  const after = await page.evaluate(() => window.__kta.movingCars());
  const st = await page.evaluate(() => window.__kta.stats && window.__kta.stats());
  console.log('moving after', after.length, 'stuck', after.filter((c) => c.v < 0.2).length, st ? JSON.stringify(st) : '');
  await browser.close();
})();
