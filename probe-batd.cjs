const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
  const p = await ctx.newPage();
  await p.goto('https://stage.hyundai.com.au/au/en/find-a-dealer', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(3000);
  await p.locator('.type-input.js-type-input').first().click();
  await p.waitForTimeout(700);
  await p.locator('li.added').filter({ hasText: /^Sales$/ }).first().click();
  await p.waitForTimeout(500);
  await p.locator('#location').first().click();
  await p.locator('#location').first().pressSequentially('2000', { delay: 120 });
  await p.waitForTimeout(2500);
  await p.locator('ul.js-location-input-form--location-list.active li').first().click();
  await p.waitForTimeout(800);
  await p.locator('button.js-btn-search').first().click();
  await p.waitForTimeout(5000);
  const batd = p.locator('.dealer-card').first().locator('a:has-text("Book a test drive"), a[class*="book-test-drive"]').first();
  await batd.scrollIntoViewIfNeeded(); await batd.click({ force: true });
  await p.waitForTimeout(3500);
  const dump = await p.evaluate(() => {
    const wrappers = Array.from(document.querySelectorAll('.modal-wrapper'));
    return wrappers.map((w, i) => {
      const cs = window.getComputedStyle(w);
      const parent = w.parentElement;
      const parentCs = parent ? window.getComputedStyle(parent) : null;
      return {
        i,
        opacity: cs.opacity,
        display: cs.display,
        visibility: cs.visibility,
        inlineStyle: w.getAttribute('style'),
        classes: w.className,
        ariaHidden: w.getAttribute('aria-hidden'),
        bbox: w.getBoundingClientRect ? (() => { const r = w.getBoundingClientRect(); return { w: r.width, h: r.height }; })() : null,
        parentTag: parent && parent.tagName,
        parentClasses: parent && parent.className,
        parentInlineStyle: parent && parent.getAttribute('style'),
        parentDisplay: parentCs && parentCs.display,
        parentOpacity: parentCs && parentCs.opacity,
        parentAriaHidden: parent && parent.getAttribute('aria-hidden'),
        header: (w.querySelector('.modal-header') || {}).textContent && w.querySelector('.modal-header').textContent.trim().slice(0, 40)
      };
    });
  });
  console.log('=== ALL .modal-wrapper after BATD click ===');
  console.log(JSON.stringify(dump, null, 2));
  await b.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
