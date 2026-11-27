// Street-level views of the densest signage clusters, day and night.
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const out = path.join(__dirname, '..', 'test-output');
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto('http://localhost:4173/?time=14', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__kta);
  await page.evaluate(() => window.__kta.signsReady);
  const spots = await page.evaluate(() => {
    const L = window.__kta.signList();
    const hz = L.filter((s) => !s.v);
    const score = hz.map((s) => L.filter((o) => (o.x - s.x) ** 2 + (o.z - s.z) ** 2 < 900).length);
    const order = hz.map((_, i) => i).sort((a, b) => score[b] - score[a]);
    const picked = [];
    for (const i of order) {
      const s = hz[i];
      if (picked.every((p) => (p.x - s.x) ** 2 + (p.z - s.z) ** 2 > 120 ** 2)) picked.push(s);
      if (picked.length >= 4) break;
    }
    return picked;
  });
  for (const [i, s] of spots.entries()) {
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
    await page.evaluate(([x, z]) => window.__kta.teleport(x, z), [s.x + fx * 8, s.z + fz * 8]);
    for (const [tag, t] of [['day', 13.5], ['dusk', 19.2], ['night', 21.5]]) {
      await page.evaluate(([t, yaw]) => { window.__kta.setTime(t); window.__kta.setView(yaw, 0.2, 9.0); }, [t, s.yaw + Math.PI / 2 + 0.35]);
      await page.waitForTimeout(2000);
      await page.screenshot({ path: path.join(out, `street-${i}-${tag}.png`) });
    }
  }
  await browser.close();
})();
