// People: the protagonist walking/standing and the crowd on a busy street.
// SPOT env: sign text to start near (default McRonald).
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const out = path.join(__dirname, '..', 'test-output');
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.error('[page]', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error('[page]', m.text().slice(0, 300)); });
  await page.goto('http://localhost:4173/?time=15', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__kta);
  await page.evaluate(() => window.__kta.signsReady);
  const s = await page.evaluate((t) => window.__kta.findSign(t), process.env.SPOT || 'McRonald');
  const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
  await page.evaluate(([x, z]) => window.__kta.teleport(x, z), [s.x + fx * 4, s.z + fz * 4]);
  // Close behind-the-shoulder view, then a wider street view.
  for (const [name, yaw, pitch, dist] of [['close', s.yaw + 2.6, 0.12, 3.2], ['street', s.yaw + Math.PI / 2 + 0.3, 0.1, 6.5]]) {
    await page.evaluate(([yaw, pitch, dist]) => window.__kta.setView(yaw, pitch, dist), [yaw, pitch, dist]);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(out, `people-${name}.png`) });
  }
  // A pedestrian close up: stand next to the nearest one and look at them.
  await page.evaluate(() => window.__kta.freezeTraffic && window.__kta.freezeTraffic(true));
  const ped = (await page.evaluate(() => window.__kta.nearestPeds(1)))[0];
  if (ped) {
    await page.evaluate(([x, z]) => window.__kta.teleport(x, z), [ped.x + Math.sin(ped.yaw) * 3.2, ped.z + Math.cos(ped.yaw) * 3.2]);
    await page.evaluate(([yaw]) => window.__kta.setView(yaw, 0.08, 2.6), [ped.yaw + 2.4]);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(out, 'people-ped.png') });
  }
  console.log(JSON.stringify(await page.evaluate(() => window.__kta.stats())));
  await browser.close();
})();
