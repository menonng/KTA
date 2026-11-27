// Prints renderer / memory stats at a busy street spot (day and night).
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto('http://localhost:4173/?time=14', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__kta);
  await page.evaluate(() => window.__kta.signsReady);
  for (const t of [14, 21.5]) {
    await page.evaluate((t) => window.__kta.setTime(t), t);
    await page.waitForTimeout(2500);
    const st = await page.evaluate(() => window.__kta.stats());
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('HeapProfiler.collectGarbage');
    const hu = await cdp.send('Runtime.getHeapUsage');
    const heap = +(hu.usedSize / 1048576).toFixed(1);
    const ab = +((hu.embedderHeapUsedSize || 0) / 1048576).toFixed(1);
    console.log(t, JSON.stringify({ calls: st.calls, triangles: st.triangles, signAtlasMB: st.signAtlasMB, texMB: st.texMB, wasmMB: st.wasmMB, jsHeapMB: heap, embedderMB: ab, backingMB: +((hu.backingStorageSize || 0) / 1048576).toFixed(1) }));
  }
  await browser.close();
})();
