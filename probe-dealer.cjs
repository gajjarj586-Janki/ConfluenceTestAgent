(async () => {
  const { chromium } = require('playwright');
  const b = await chromium.launch({ headless: true });
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.goto('https://stage.hyundai.com.au/au/en/find-a-dealer', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(3500);
  for (const sel of ['.type-input.js-type-input', '.js-type-input', '#dealer-type', '.dealer-type-dropdown', '.type-input']) {
    console.log('--- trying:', sel);
    await p.locator(sel).first().click({ force: true, timeout: 3000 }).catch(e => console.log('  click error:', e.message.split('\n')[0]));
    await p.waitForTimeout(700);
    const visibleItems = await p.evaluate(() => {
      const items = Array.from(document.querySelectorAll('li, [role=option], [class*=option]')).filter(el => {
        const t = (el.textContent||'').trim().toLowerCase();
        return (t === 'sales' || t === 'service') && el.offsetParent;
      });
      return items.map(el => ({ tag: el.tagName, cls: (el.className||'').toString().slice(0,100), text: el.textContent.trim() }));
    });
    console.log('  found Sales/Service options:', JSON.stringify(visibleItems));
    if (visibleItems.length) break;
  }
  const fullSearch = await p.evaluate(() => {
    const all = Array.from(document.querySelectorAll('*')).filter(el => {
      const t = (el.textContent||'').trim().toLowerCase();
      return t === 'service' && el.offsetParent && el.children.length === 0;
    });
    return all.slice(0,10).map(el => ({ tag: el.tagName, cls: (el.className||'').toString().slice(0,80), parentCls: (el.parentElement?.className||'').toString().slice(0,80) }));
  });
  console.log('=== ALL leaf elements with text equal to service ===');
  console.log(JSON.stringify(fullSearch, null, 2));
  await b.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
