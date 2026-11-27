// Close-up screenshots of parody brand signs (day and night).
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const out = path.join(__dirname, '..', 'test-output');
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  await page.goto('http://localhost:4173/?time=14', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__kta);
  for (const [i, text] of ['스타덕스', 'CUZ', '올리브올드', '식스텐'].entries()) {
    const s = await page.evaluate((t) => window.__kta.findSign(t), text);
    if (!s) { console.log('missing', text); continue; }
    // Stand 6 m in front of the sign, camera behind the player looking at it.
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
    await page.evaluate(([x, z, yaw]) => { window.__kta.teleport(x, z); window.__kta.setView(yaw, 0.12, 4.5); },
      [s.x + fx * 7, s.z + fz * 7, s.yaw]);
    for (const [tag, t] of [['day', 14], ['night', 21.5]]) {
      await page.evaluate((t) => window.__kta.setTime(t), t);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(out, `sign-${i}-${tag}.png`) });
    }
    console.log('ok', text, JSON.stringify(s));
  }
  await browser.close();
})();
