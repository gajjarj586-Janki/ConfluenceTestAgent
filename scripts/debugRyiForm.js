import { chromium } from 'playwright';

const url = 'https://stage.genesis-motors.com.au/au/en/models/gv60-magma-teaser.html';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 2200 } });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(2000);

const result = await page.evaluate(() => {
  const isVisible = (el) => {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };

  const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();

  const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,legend,label,div,p,span'))
    .filter(isVisible)
    .map((el) => ({ tag: el.tagName, text: text(el).slice(0, 120) }))
    .filter((x) => /register your interest|first name|last name|email|postcode|phone|contact|submit/i.test(x.text))
    .slice(0, 50);

  const inputs = Array.from(document.querySelectorAll('input, textarea, select'))
    .filter(isVisible)
    .map((el) => ({
      tag: el.tagName,
      type: el.getAttribute('type') || '',
      name: el.getAttribute('name') || '',
      id: el.getAttribute('id') || '',
      placeholder: el.getAttribute('placeholder') || '',
      ariaLabel: el.getAttribute('aria-label') || '',
      required: el.required,
      value: el.value || '',
    }));

  const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], a'))
    .filter(isVisible)
    .map((el) => ({
      tag: el.tagName,
      type: el.getAttribute('type') || '',
      text: text(el).slice(0, 120),
      id: el.getAttribute('id') || '',
      cls: el.className || '',
    }))
    .filter((x) => /submit|interest|register|enquiry|search|send/i.test(x.text) || /submit/i.test(x.type))
    .slice(0, 50);

  const forms = Array.from(document.querySelectorAll('form')).map((form, idx) => ({
    idx,
    visible: isVisible(form),
    cls: form.className || '',
    id: form.id || '',
    action: form.getAttribute('action') || '',
    text: text(form).slice(0, 300),
    fieldCount: form.querySelectorAll('input, textarea, select').length,
    submitCount: form.querySelectorAll('button, input[type="submit"]').length,
  }));

  return { headings, inputs, buttons, forms, title: document.title, url: location.href };
});

console.log(JSON.stringify(result, null, 2));
await browser.close();
