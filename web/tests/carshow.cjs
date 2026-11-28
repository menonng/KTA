// Every vehicle type in a column on the longest main-road lane, for close
// inspection (debug __kta.carShow). Shots: side of the column, then 3/4
// views of single cars (FOCUS env: type indices, default 0,2,4).
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const out = path.join(__dirname, '..', 'test-output');
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.error('[page]', e.message));
  await page.goto(`http://localhost:4173/?notraffic&time=${process.env.TIME || 15}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__kta);
  await page.evaluate(() => window.__kta.signsReady);
  const L = await page.evaluate(() => window.__kta.laneSpot());
  const gap = 7.5;
  await page.evaluate(([x, z, yaw, gap]) => window.__kta.carShow(x, z, yaw, gap), [L.x, L.z, L.yaw, gap]);
  const shot = async (name, x, z, yaw, pitch, dist) => {
    await page.evaluate(([x, z, yaw, pitch, dist]) => { window.__kta.teleport(x, z); window.__kta.setView(yaw, pitch, dist); }, [x, z, yaw, pitch, dist]);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(out, `carshow-${name}.png`) });
  };
  // Side of the column: stand 7 m to the right of the lane.
  const rx = Math.cos(L.yaw), rz = -Math.sin(L.yaw);
  await shot('side', L.x + rx * 6, L.z + rz * 6, L.yaw - Math.PI / 2, 0.12, 16);
  for (const t of (process.env.FOCUS || '0,2,4').split(',').map(Number)) {
    const off = (t - 2.5) * gap;
    const cx = L.x + Math.sin(L.yaw) * off, cz = L.z + Math.cos(L.yaw) * off;
    await shot(`t${t}-front`, cx + rx * 2.2, cz + rz * 2.2, L.yaw + 0.75 - Math.PI / 2 + Math.PI / 2, 0.15, 6.5);
    await shot(`t${t}-rear`, cx + rx * 2.2, cz + rz * 2.2, L.yaw + Math.PI - 0.75, 0.15, 6.5);
  }
  await browser.close();
})();
