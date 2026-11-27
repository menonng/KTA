// Street-level "beauty" shots at a few spots, day / golden hour / night.
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const out = path.join(__dirname, '..', 'test-output');
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  await page.goto('http://localhost:4173/?time=14', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__kta);
  await page.evaluate(() => window.__kta.signsReady);
  const spots = (process.env.SPOTS || 'CUZ,포차,스타덕스,헤어').split(',');
  for (const [i, text] of spots.entries()) {
    const s = await page.evaluate((t) => window.__kta.findSign(t), text);
    if (!s) { console.log('missing', text); continue; }
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
    await page.evaluate(([x, z, yaw]) => { window.__kta.teleport(x, z); window.__kta.setView(yaw + 0.75, 0.1, 5.0); },
      [s.x + fx * 5, s.z + fz * 5, s.yaw]);
    for (const [tag, t] of [['day', 13.5], ['gold', 17.4], ['night', 21.5]]) {
      await page.evaluate((t) => window.__kta.setTime(t), t);
      await page.waitForTimeout(1800);
      await page.screenshot({ path: path.join(out, `beauty-${i}-${tag}.png`) });
    }
  }
  await browser.close();
})();
