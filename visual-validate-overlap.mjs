import { chromium } from 'playwright';

const VIEWPORTS = [
  { name: 'desktop-wide', width: 1440, height: 900 },
  { name: 'desktop-narrow', width: 900, height: 700 },
  { name: 'tablet-landscape', width: 899, height: 700 },
  { name: 'tablet-portrait', width: 700, height: 1024 },
  { name: 'mobile', width: 400, height: 800 },
];

async function navigateToEditor(page) {
  await page.goto('http://localhost:5173/');
  await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: /^new$/i }).click();
  await page.locator('dialog').getByRole('button', { name: /create/i }).waitFor({ timeout: 5000 });
  await page.locator('dialog').getByRole('button', { name: /create/i }).click();
  await page.locator('.layers-panel').waitFor({ timeout: 10000 });
  const welcomeClose = page.getByRole('dialog').getByRole('button', { name: /close|get started/i });
  if (await welcomeClose.first().isVisible({ timeout: 1000 }).catch(() => false)) {
    await welcomeClose.first().click();
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const results = [];

  for (const vp of VIEWPORTS) {
    console.log(`\n=== Testing ${vp.name} (${vp.width}x${vp.height}) ===`);
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();

    try {
      await navigateToEditor(page);
      await page.waitForTimeout(1000);

      // Screenshot 1: Default state
      const ss1 = `/tmp/opencode/overlap-${vp.name}-01-default.png`;
      await page.screenshot({ path: ss1, fullPage: false });
      console.log(`  [1] Default state saved: ${ss1}`);

      // Check if context control bar is visible
      const ccbVisible = await page.evaluate(() => {
        const el = document.querySelector('[class*="context-control-bar"], [class*="ContextControlBar"], .context-bar, [data-testid="context-control-bar"]');
        if (!el) return { found: false, details: 'element not found' };
        const rect = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const hidden = cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0' || rect.height === 0;
        return {
          found: true,
          hidden,
          rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, height: rect.height },
          display: cs.display,
          visibility: cs.visibility,
          opacity: cs.opacity,
        };
      });
      console.log(`  Context control bar:`, JSON.stringify(ccbVisible));

      // Check layers panel visibility
      const layersInfo = await page.evaluate(() => {
        const el = document.querySelector('.layers-panel');
        if (!el) return { found: false };
        const rect = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          found: true,
          rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, height: rect.height },
          position: cs.position,
          zIndex: cs.zIndex,
          transform: cs.transform,
        };
      });
      console.log(`  Layers panel:`, JSON.stringify(layersInfo));

      // Check menubar/toolbar visibility
      const menubarInfo = await page.evaluate(() => {
        const el = document.querySelector('.editor__menubar, [class*="menubar"], [class*="Menubar"]');
        if (!el) return { found: false };
        const rect = el.getBoundingClientRect();
        return {
          found: true,
          rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, height: rect.height },
        };
      });
      console.log(`  Menubar:`, JSON.stringify(menubarInfo));

      // Check inspector panel
      const inspectorInfo = await page.evaluate(() => {
        const el = document.querySelector('.editor__inspector-panel, [class*="inspector-panel"]');
        if (!el) return { found: false };
        const rect = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          found: true,
          rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, height: rect.height },
          position: cs.position,
          transform: cs.transform,
        };
      });
      console.log(`  Inspector panel:`, JSON.stringify(inspectorInfo));

      // Check for any overlap issues
      const overlapCheck = await page.evaluate(() => {
        const issues = [];
        const panels = document.querySelectorAll('[class*="panel"], [class*="Panel"]');
        const ccb = document.querySelector('[class*="context-control-bar"], [class*="ContextControlBar"], [class*="context-bar"]');
        if (ccb) {
          const ccbRect = ccb.getBoundingClientRect();
          panels.forEach(p => {
            const pRect = p.getBoundingClientRect();
            if (pRect.height > 0 && ccbRect.height > 0) {
              const overlaps = ccbRect.top < pRect.bottom && ccbRect.bottom > pRect.top &&
                              ccbRect.left < pRect.right && ccbRect.right > pRect.left;
              if (overlaps && p !== ccb && !ccb.contains(p) && !p.contains(ccb)) {
                issues.push({
                  panel: p.className.substring(0, 80),
                  overlapArea: Math.min(ccbRect.bottom, pRect.bottom) - Math.max(ccbRect.top, pRect.top),
                });
              }
            }
          });
        }
        return issues;
      });
      if (overlapCheck.length > 0) {
        console.log(`  OVERLAP ISSUES:`, JSON.stringify(overlapCheck));
      } else {
        console.log(`  No overlap issues detected`);
      }

      results.push({ viewport: vp.name, ccbVisible, layersInfo, menubarInfo, inspectorInfo, overlapCheck });
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
      results.push({ viewport: vp.name, error: err.message });
    } finally {
      await context.close();
    }
  }

  await browser.close();

  // Summary
  console.log('\n\n=== SUMMARY ===');
  for (const r of results) {
    const ccbStatus = r.ccbVisible?.found
      ? (r.ccbVisible.hidden ? 'HIDDEN' : 'VISIBLE')
      : 'NOT FOUND';
    const overlap = r.overlapCheck?.length > 0 ? `${r.overlapCheck.length} issues` : 'clean';
    console.log(`${r.viewport}: CCB=${ccbStatus}, Overlap=${overlap}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
