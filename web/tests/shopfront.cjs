// Shop fronts up close: chain stores (cladding, logos), awnings, window
// lettering and standing boards, by day and by night.
// SHOTS env: comma list of sign texts to visit (default: a few chains).
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const out = path.join(__dirname, '..', 'test-output');
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto('http://localhost:4173/?time=14', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__kta);
  await page.evaluate(() => window.__kta.signsReady);
  const names = (process.env.SHOTS || 'GG24,STARDUCKS,OLIVE OLD,CUZ').split(',');
  const spots = [];
  for (const n of names) {
    const s = await page.evaluate((t) => window.__kta.findSign(t), n);
    if (s && !s.vertical) spots.push({ tag: n.replace(/\W+/g, ''), ...s });
    else console.log('not found', n);
  }
  // Densest awning cluster.
  const aw = await page.evaluate(() => {
    const L = window.__kta.signList();
    const a = L.filter((s) => s.st === 'awning');
    let best = null, bs = -1;
    for (const s of a) {
      const n = a.filter((o) => (o.x - s.x) ** 2 + (o.z - s.z) ** 2 < 400).length;
      if (n > bs) { bs = n; best = s; }
    }
    return best;
  });
  if (aw) spots.push({ tag: 'awning', ...aw });
  const times = (process.env.TIMES || '13.5,21.5').split(',').map(Number);
  for (const s of spots) {
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
    const d = +(process.env.DIST || 6);
    await page.evaluate(([x, z]) => window.__kta.teleport(x, z), [s.x + fx * d, s.z + fz * d]);
    for (const t of times) {
      await page.evaluate(([t, yaw, dist, PITCH]) => { window.__kta.setTime(t); window.__kta.setView(yaw, PITCH, dist); }, [t, s.yaw + (+(process.env.YAWOFF ?? 0.35)), d, +(process.env.PITCH ?? 0.12)]);
      await page.waitForTimeout(2200);
      await page.screenshot({ path: path.join(out, `shop-${s.tag}-${t < 18 ? 'day' : 'night'}.png`) });
    }
  }
  console.log('shots', spots.map((s) => s.tag).join(' '));
  await browser.close();
})();
