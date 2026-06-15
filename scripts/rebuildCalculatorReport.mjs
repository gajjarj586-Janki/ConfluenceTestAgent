// Regenerate latest CalculatorPricing HTML + PDF from JSON, using current layout.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const dir = path.resolve('excel-reports');
const jsons = fs.readdirSync(dir).filter(f => /^CalculatorPricing_.*\.json$/.test(f)).sort();
if (!jsons.length) { console.error('No CalculatorPricing JSON found'); process.exit(1); }
const jsonPath = path.join(dir, jsons.at(-1));
const payload = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
const results = payload.results || [];
const timestamp = path.basename(jsonPath).replace(/^CalculatorPricing_|\.json$/g, '');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Skip combos where the option simply isn't available for that configuration.
const isUnavailable = (v) => v && v.error && /^Cannot select\b/i.test(v.error);
const flatRows = [];
for (const r of results) {
  const applicableVariants = (r.variants || []).filter(v => !isUnavailable(v));
  const variants = applicableVariants.length ? applicableVariants : [{ label: '(no variants)', price: null }];
  variants.forEach((v, idx) => {
    const variantPriced = !!v.price;
    const passed = !r.comingSoon && !r.error && !v.error && !v.pricingComingSoon && variantPriced;
    const testStatus = passed
      ? '<span style="color:#fff;background:#2e7d32;padding:3px 12px;border-radius:4px;font-weight:600">PASS</span>'
      : '<span style="color:#fff;background:#c62828;padding:3px 12px;border-radius:4px;font-weight:600">FAIL</span>';
    const driveAway = v.price
      ? `<strong style="color:#1b5e20">${esc(v.price)}</strong>`
      : v.pricingComingSoon
        ? '<span style="color:#c62828">Pricing coming soon</span>'
        : '<span style="color:#999">—</span>';
    let failureReason = '';
    if (!passed) {
      if (r.comingSoon) failureReason = 'CPC page is not loading';
      else if (r.error) failureReason = `CPC page failed to load: ${r.error}`;
      else if (v.error) failureReason = `Unable to select variant "${v.label}": ${v.error}`;
      else if (v.pricingComingSoon) failureReason = `Drive Away price shows "Pricing coming soon" for variant "${v.label}"`;
      else if (!variantPriced) failureReason = `Drive Away price not displayed for variant "${v.label}"`;
    }
    const modelCell = idx === 0 ? `<a href="${esc(r.url)}" target="_blank">${esc(r.displayName || r.slug)}</a>` : '';
    flatRows.push(`<tr>
      <td>${modelCell}</td>
      <td style="font-size:12px;line-height:1.5">${esc(v.label).replace(/ \| /g, '<br>').replace(/^([^:]+:)/gm, '<strong>$1</strong>').replace(/(<br>)([^:]+:)/g, '$1<strong>$2</strong>')}</td>
      <td>${driveAway}</td>
      <td>${testStatus}</td>
      <td style="color:#a33">${esc(failureReason)}</td>
    </tr>`);
  });
}
const rows = flatRows.join('\n');
const totalVariants = flatRows.length;
const passVariants = results.reduce((n, r) => n + (r.variants || []).filter(v => !r.comingSoon && !r.error && !v.error && v.price).length, 0);
const skippedVariants = results.reduce((n, r) => n + (r.variants || []).filter(isUnavailable).length, 0);

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Calculator Pricing Report — ${timestamp}</title>
<style>
  body{font-family:Segoe UI,Arial,sans-serif;margin:24px;color:#222}
  h1{margin:0 0 4px} .meta{color:#666;margin-bottom:16px}
  table{border-collapse:collapse;width:100%;font-size:14px}
  th,td{border:1px solid #ddd;padding:8px;vertical-align:top;text-align:left}
  th{background:#f5f5f5}
  tr:nth-child(even){background:#fafafa}
  .summary{display:flex;gap:12px;margin:12px 0 20px}
  .card{flex:1;border:1px solid #ddd;border-radius:6px;padding:12px;background:#fff}
  .card b{font-size:22px;display:block}
</style></head><body>
<h1>Hyundai Calculator — Pricing Report</h1>
<div class="meta">Generated ${esc(payload.generatedAt || new Date().toISOString())} · Landing: <a href="${esc(payload.landingUrl || '')}" target="_blank">${esc(payload.landingUrl || '')}</a></div>
<div class="summary">
  <div class="card">Total models<b>${results.length}</b></div>
  <div class="card">Total variants<b>${totalVariants}</b></div>
  <div class="card" style="background:#e8f5e9">Variants priced<b>${passVariants}</b></div>
  <div class="card" style="background:#ffebee">Coming soon<b>${results.filter(r => r.comingSoon).length}</b></div>
  <div class="card" style="background:#fff3e0">Failed<b>${totalVariants - passVariants}</b></div>
  <div class="card" style="background:#eceff1;color:#555">N/A combos<b>${skippedVariants}</b></div>
</div>
<table>
  <thead><tr><th>Model</th><th>Configuration</th><th>Drive Away</th><th>Test Status</th><th>Failure Reason</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
</body></html>`;

const htmlPath = path.join(dir, `CalculatorPricing_${timestamp}.html`);
fs.writeFileSync(htmlPath, html);

const pdfPath = path.join(dir, `CalculatorPricing_${timestamp}.pdf`);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
await page.pdf({ path: pdfPath, format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } });
await browser.close();

console.log('HTML →', htmlPath);
console.log('PDF  →', pdfPath);
