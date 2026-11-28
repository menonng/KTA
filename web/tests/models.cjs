// Views of the CC0 street models (covered cars, cabinets, AC units) and a
// raised view down a main road (curtain-wall blocks). Day and night.
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const out = path.join(__dirname, '..', 'test-output');
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto('http://localhost:4173/?time=14', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__kta);
  await page.evaluate(() => window.__kta.signsReady);
  const pick = async (m, k) => page.evaluate(([m, k]) => window.__kta.modelSpots(m)[k] ?? null, [m, k]);
  // model ids: 1 powerbox, 6 covered car
  const shots = [];
  const car = await pick(6, 3);
  if (car) shots.push({ tag: 'coveredcar', x: car.x, z: car.z, yaw: car.yaw + Math.PI / 2, d: 5, pitch: 0.25, off: 3.5 });
  const box = await pick(1, 5);
  if (box) shots.push({ tag: 'powerbox', x: box.x, z: box.z, yaw: box.yaw, d: 4.5, pitch: 0.2, off: 3.0 });
  for (const s of shots) {
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
    await page.evaluate(([x, z]) => window.__kta.teleport(x, z), [s.x + fx * s.off, s.z + fz * s.off]);
    for (const [tag, t] of [['day', 13.5], ['night', 21.5]]) {
      await page.evaluate(([t, yaw, p, d]) => { window.__kta.setTime(t); window.__kta.setView(yaw, p, d); }, [t, s.yaw, s.pitch, s.d]);
      await page.waitForTimeout(2200);
      await page.screenshot({ path: path.join(out, `model-${s.tag}-${tag}.png`) });
    }
  }
  console.log('shots', shots.map((s) => s.tag).join(' '));
  await browser.close();
})();
