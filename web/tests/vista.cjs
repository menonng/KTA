// Long views down a main street (sky, clouds, aerial perspective) across
// times of day and weather. SPOT env: sign text to start from.
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const out = path.join(__dirname, '..', 'test-output');
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto('http://localhost:4173/?time=14', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__kta);
  await page.evaluate(() => window.__kta.signsReady);
  const s = await page.evaluate((t) => window.__kta.findSign(t), process.env.SPOT || 'McRonald');
  const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
  await page.evaluate(([x, z]) => window.__kta.teleport(x, z), [s.x + fx * 9, s.z + fz * 9]);
  const shots = (process.env.SHOTS || 'clear@13.5,clear@16.8,clear@21.5,cloudy@12,rain@21,snow@14').split(',');
  for (const sh of shots) {
    const [w, t] = sh.split('@');
    await page.evaluate(([w, t, yaw]) => { window.__kta.setWeather(w); window.__kta.setTime(+t); window.__kta.setView(yaw, 0.06, 7.5); }, [w, t, s.yaw + Math.PI / 2 + 0.25]);
    await page.waitForTimeout(2600);
    await page.screenshot({ path: path.join(out, `vista-${w}-${t}.png`) });
  }
  console.log('done');
  await browser.close();
})();
