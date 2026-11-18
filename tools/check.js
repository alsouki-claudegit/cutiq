// Pre-deploy gate for the CutIQ page. Run before every upload to Netlify:
//   NODE_PATH=/c/dev/sourcing-demo/node_modules node tools/check.js index.html
// Fails (exit 1) on: sideways scroll, clipped text or script errors at phone, tablet and laptop sizes,
// or a fade animation that runs slower than a phone can show smoothly.
// Why: on 2026-11-18 a curl texture (about 5,000 strokes) went live and made the site slow. The only
// speed number checked was one redraw (68 ms), not the animation frame by frame.
const { chromium, devices } = require('playwright');
const path = require('path');
const FILE = 'file:///' + path.resolve(process.argv[2] || 'index.html').replace(/\\/g, '/');

const SIZES = [
  { name: 'iPhone 13', ...devices['iPhone 13'] },
  { name: 'small Android', viewport: { width: 360, height: 740 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  { name: 'iPad', viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: 'laptop', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
];
const CPU_SLOWDOWN = 4;          // a mid-range phone is roughly 4x slower than this laptop
const MAX_P90_FRAME_MS = 34;     // 90% of frames must draw within two screen refreshes (about 30 fps)
const MAX_SVG_ELEMENTS = 1500;   // a drawing that needs more than this is texture, not structure

(async () => {
  const browser = await chromium.launch();
  const fails = [];
  for (const s of SIZES) {
    const { name, ...opts } = s;
    const ctx = await browser.newContext(opts); const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(FILE, { waitUntil: 'load' }); await page.waitForTimeout(3600);
    const r = await page.evaluate(() => {
      const W = document.documentElement.clientWidth, over = [];
      document.querySelectorAll('body *').forEach(e => {
        if (e.closest('svg') && e.tagName !== 'svg') return;
        const b = e.getBoundingClientRect(); if (!b.width) return;
        if (b.right > W + 0.5 || b.left < -0.5) over.push(e.tagName);
      });
      return { sideways: document.documentElement.scrollWidth > W, over: over.length,
               svgEls: document.querySelectorAll('svg *').length };
    });
    const bad = [];
    if (r.sideways || r.over) bad.push(`content wider than the screen (${r.over} elements)`);
    if (errors.length) bad.push('script errors: ' + errors.join('; '));
    if (r.svgEls > MAX_SVG_ELEMENTS) bad.push(`${r.svgEls} drawing elements (limit ${MAX_SVG_ELEMENTS})`);
    console.log(`${bad.length ? 'FAIL' : 'ok  '} ${name}: ${r.svgEls} drawing elements${bad.length ? ' | ' + bad.join(' | ') : ''}`);
    if (bad.length) fails.push(name);
    await ctx.close();
  }

  // animation smoothness on a slowed-down CPU, phone size
  const ctx = await browser.newContext({ ...devices['iPhone 13'] }); const page = await ctx.newPage();
  await page.goto(FILE, { waitUntil: 'load' }); await page.waitForTimeout(3600);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });
  const frames = await page.evaluate(() => new Promise(res => {
    const t = []; document.getElementById('replay').click();
    const t0 = performance.now();
    (function tick(now) { t.push(now); if (now - t0 < 2400) requestAnimationFrame(tick); else res(t); })(t0);
  }));
  const gaps = frames.slice(1).map((v, i) => v - frames[i]).sort((a, b) => a - b);
  const p90 = gaps[Math.floor(gaps.length * 0.9)] || 999, med = gaps[Math.floor(gaps.length / 2)] || 999;
  const slow = p90 > MAX_P90_FRAME_MS;
  console.log(`${slow ? 'FAIL' : 'ok  '} animation at ${CPU_SLOWDOWN}x slower CPU: median ${med.toFixed(0)} ms, 90th percentile ${p90.toFixed(0)} ms per frame (limit ${MAX_P90_FRAME_MS})`);
  if (slow) fails.push('animation');
  await browser.close();
  console.log(fails.length ? `\nDO NOT DEPLOY: ${fails.join(', ')}` : '\nPASS: safe to deploy');
  process.exit(fails.length ? 1 : 0);
})();
