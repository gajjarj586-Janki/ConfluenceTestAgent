/**
 * CPC page-load step definitions.
 *
 * Opens the CPC (calculator) page for every model discovered on the calculator
 * landing page and verifies that each page actually LOADS — as opposed to the
 * sibling calculator_pricing feature, which drills into pricing/variants.
 *
 * For each model it records:
 *   - HTTP status of the main document navigation (200 = OK)
 *   - whether the page rendered real content (not blank)
 *   - whether the network/DOM settled within 30s (not "loading forever")
 *
 * Reuses the landing-page steps from calculator_pricing.steps.js:
 *   When the user navigates to the calculator landing page
 *   Then the calculator landing page should list at least 1 model
 * which populate `this._calculatorModels` and `this._calculatorLandingUrl`.
 *
 * Generates artefacts at the end of the scenario:
 *   - excel-reports/CpcPageLoad_<env>_<timestamp>.{html,json,pdf}
 * and attaches the JSON payload to the Cucumber report.
 */
import { When, Then } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { handleLocationModal } from './commonHelpers.js';

// Budget for the calculator UI to actually render. The Hyundai pages keep a
// steady stream of background/analytics requests so they NEVER reach
// 'networkidle' — using that as a load signal flags every page as stuck.
// Instead we wait (like calculator_pricing.steps.js) for real rendered content
// to appear; if it never does within this budget the page is "loading forever".
const RENDER_TIMEOUT_MS = 30000;

// Mirror calculator_pricing's site-root resolution: prefer a hyundai entry from
// the resolved pageUrls map, else fall back to production.
function resolveSiteRoot(world) {
  for (const u of Object.values(world.pageUrls || {})) {
    try {
      const url = new URL(u);
      if (/hyundai/i.test(url.hostname)) return `${url.protocol}//${url.host}`;
    } catch { /* ignore */ }
  }
  return 'https://www.hyundai.com';
}

// Read the Drive Away price currently shown on a CPC page. Mirrors the
// candidate-scoring logic from calculator_pricing.steps.js: prefer the
// "Estimated Drive Away" footer, skip finance/lease panels. When no drive-away
// element is found, fall back to the LARGEST price on the page — the drive-away
// is the headline figure, whereas weekly/monthly repayments are small numbers
// that the first-price-found fallback used to grab by mistake. Returns null when
// no price is present.
async function readDriveAwayPrice(page) {
  return page.evaluate(() => {
    const priceRe = /\$\s*\d{1,3}(?:,\d{3})+(?:\.\d{2})?/g;
    const toNum = (s) => parseFloat(String(s).replace(/[^0-9.]/g, '')) || 0;
    const candidates = [];
    for (const el of document.querySelectorAll('div, section, footer, span, p, strong, b')) {
      if (el.offsetParent === null) continue;
      if (el.children.length > 8) continue;
      const t = (el.innerText || '').trim();
      if (!t || t.length > 400) continue;
      if (!/drive[\s-]?away/i.test(t)) continue;
      if (/(hyundai\s+finance|novated\s+lease|weekly|monthly|per\s+week|per\s+month|repayment|finance\s+from|pricing\s+coming\s+soon)/i.test(t)) continue;
      const mm = t.match(priceRe);
      if (!mm) continue;
      const isFooter = /estimated\s+drive[\s-]?away/i.test(t);
      candidates.push({ price: mm[mm.length - 1], len: t.length, isFooter });
    }
    if (candidates.length) {
      candidates.sort((a, b) => (b.isFooter - a.isFooter) || (a.len - b.len));
      return candidates[0].price;
    }
    // Fall back to the largest price on the page (a real drive-away figure, not
    // a small repayment amount). Prefer prices >= $10,000.
    const all = (document.body && document.body.innerText || '').match(priceRe) || [];
    if (!all.length) return null;
    const big = all.filter((s) => toNum(s) >= 10000);
    const pool = big.length ? big : all;
    return pool.sort((a, b) => toNum(b) - toNum(a))[0];
  });
}

// Enumerate EVERY model tile on the calculator landing page (heading name +
// href), WITHOUT deduping by slug. Several tiles (e.g. KONA / KONA Electric /
// KONA Hybrid, or i30 Sedan / i30 N Line / i30 Sedan Hybrid) point at the same
// CPC page but are distinct tiles the user expects to see listed. Dedupes only
// exact name+href duplicates. Returns [{ name, href }].
async function discoverCpcTiles(page, landingUrl) {
  await page.goto(landingUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const modal = await page.locator('.hyu-postcode-modal.tingle-modal--visible')
    .first().isVisible({ timeout: 2000 }).catch(() => false);
  if (modal) { try { await handleLocationModal(page, '2000'); } catch { /* ignore */ } }
  await page.waitForSelector('a[href*="/calculator/"]', { state: 'attached', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1000);
  return page.evaluate(() => {
    const norm = (s) => (s || '').trim().replace(/\s+/g, ' ');
    const out = []; const seen = new Set();
    for (const a of document.querySelectorAll('a[href*="/calculator/"]')) {
      const href = a.getAttribute('href') || '';
      if (!/\/calculator\/[a-z0-9-]+/i.test(href)) continue; // skip the bare landing link
      const card = a.closest('[class*="card" i],[class*="tile" i],li,article,div') || a;
      const h = card.querySelector('h1,h2,h3,h4,h5');
      const name = norm(((h && h.innerText) || a.innerText).split('\n')[0]).replace(/\.$/, '');
      if (!name) continue;
      const key = `${name.toLowerCase()}|${href}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, href });
    }
    return out;
  });
}

When(/^the user opens the CPC page for every model$/i, { timeout: 20 * 60 * 1000 }, async function () {
  const landingUrl = this._calculatorLandingUrl || `${resolveSiteRoot(this)}/au/en/shop/calculator`;
  const tiles = await discoverCpcTiles(this.page, landingUrl);
  assert.ok(tiles.length > 0, 'No model tiles found on the calculator landing page');
  console.log(`Calculator landing → ${tiles.length} model tile(s): ${tiles.map(t => t.name).join(', ')}`);

  const results = [];
  for (const tile of tiles) {
    const slug = ((tile.href || '').match(/\/calculator\/([a-z0-9-]+)/i) || [])[1] || tile.href;
    const entry = {
      name: tile.name,
      slug,
      displayName: tile.name,
      url: null,            // resolved after the click navigates
      httpStatus: null,
      loadMs: null,
      driveAwayPrice: null, // captured as evidence the calculator loaded
      blank: false,
      stillLoading: false,
      comingSoon: false,
      error: null,
    };

    const startedAt = Date.now();
    try {
      // 1. Return to the calculator landing page so we can CLICK this tile.
      await this.page.goto(landingUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      const landingModal = await this.page.locator('.hyu-postcode-modal.tingle-modal--visible')
        .first().isVisible({ timeout: 2000 }).catch(() => false);
      if (landingModal) { try { await handleLocationModal(this.page, '2000'); } catch { /* ignore */ } }
      await this.page.waitForSelector('a[href*="/calculator/"]', { state: 'attached', timeout: 30000 }).catch(() => {});

      // 2. Mark the anchor whose tile heading matches THIS tile's name (href is
      //    not unique across tiles, so we resolve by the visible name), then let
      //    Playwright dispatch a trusted click on the marked tile.
      const marked = await this.page.evaluate((targetName) => {
        document.querySelectorAll('[data-cpc-tile]').forEach(e => e.removeAttribute('data-cpc-tile'));
        const norm = (s) => (s || '').trim().replace(/\s+/g, ' ').replace(/\.$/, '').toLowerCase();
        for (const a of document.querySelectorAll('a[href*="/calculator/"]')) {
          const card = a.closest('[class*="card" i],[class*="tile" i],li,article,div') || a;
          const h = card.querySelector('h1,h2,h3,h4,h5');
          const name = norm(((h && h.innerText) || a.innerText).split('\n')[0]);
          if (name === norm(targetName)) { a.setAttribute('data-cpc-tile', '1'); return { ok: true }; }
        }
        return { ok: false };
      }, tile.name);
      if (!marked.ok) {
        entry.error = 'Model tile not found on calculator landing page';
        entry.loadMs = Date.now() - startedAt;
        console.log(`  • ${entry.name.padEnd(22)} → ERROR: ${entry.error}`);
        results.push(entry);
        continue;
      }
      const link = this.page.locator('[data-cpc-tile="1"]');
      await link.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {});

      // Click the tile and wait for the URL to become this model's CPC page.
      // Clicking is a client-side (SPA) navigation, so we wait on the URL rather
      // than a document response — the latter never arrives and would stall.
      await link.click({ timeout: 8000 }).catch(async () => {
        await link.click({ force: true, timeout: 8000 }).catch(() => {});
      });
      const slugRe = new RegExp(`/calculator/${slug}(?:[/?#]|$)`, 'i');
      await this.page.waitForURL(slugRe, { timeout: 30000 }).catch(() => {});
      entry.url = this.page.url();

      // Confirm the click actually opened the model's CPC page.
      if (!slugRe.test(entry.url)) {
        entry.error = `Clicking the tile did not open its CPC page (landed on ${entry.url})`;
      } else {
        // Confirm the CPC URL returns 200 with a lightweight direct request so
        // the report's HTTP column is meaningful (the SPA click yields no
        // document response of its own).
        try {
          const probe = await this.page.context().request.get(entry.url, { timeout: 15000 });
          entry.httpStatus = probe.status();
        } catch { /* leave null — render checks below still gate PASS/FAIL */ }
      }

      // 3. Dismiss the "Set your location" postcode modal if it pops — the
      //    calculator is hidden behind it.
      const cpcModal = await this.page.locator('.hyu-postcode-modal.tingle-modal--visible')
        .first().isVisible({ timeout: 2000 }).catch(() => false);
      if (cpcModal) { try { await handleLocationModal(this.page, '2000'); } catch { /* ignore */ } }

      // 4. Wait for the calculator to actually RENDER (mirrors
      //    calculator_pricing.steps.js). Positive signals: a Drive Away price, a
      //    calculator option heading, or a "coming soon" placeholder (the page
      //    DID finish loading, it just shows a placeholder). If none appear
      //    within the budget the page never finished loading.
      const rendered = await this.page.waitForFunction(() => {
        const priceRe = /\$\s*\d{1,3}(?:,\d{3})+(?:\.\d{2})?/;
        const body = document.body ? (document.body.innerText || '') : '';
        if (priceRe.test(body)) return true;
        if (/pricing\s+coming\s+soon|coming\s+soon\s+at\s+hyundai/i.test(body)) return true;
        for (const el of document.querySelectorAll('h2, h3, h4, p, span, div')) {
          if (el.offsetParent === null) continue;
          const t = (el.innerText || '').trim();
          if (/^(Select energy type|Select variant|Choose your powertrain|Transmission|Drive Away Price)\.?$/i.test(t)) return true;
        }
        return false;
      }, { timeout: RENDER_TIMEOUT_MS }).then(() => true).catch(() => false);
      entry.loadMs = Date.now() - startedAt;

      // Capture a price as evidence the calculator rendered. NOTE: this is the
      // price the page shows on load (often a pre-selected trim), NOT the model's
      // authoritative "from" price — exact per-variant pricing is the job of the
      // calculator_pricing test. Here it's only proof the page loaded.
      await this.page.waitForTimeout(rendered ? 1500 : 500);
      entry.driveAwayPrice = await readDriveAwayPrice(this.page).catch(() => null);

      // 5. Snapshot the final page state to classify the result.
      const snap = await this.page.evaluate(() => {
        const priceRe = /\$\s*\d{1,3}(?:,\d{3})+(?:\.\d{2})?/;
        const bodyText = (document.body && document.body.innerText || '').trim();
        const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4'))
          .filter(el => el.offsetParent !== null)
          .map(el => (el.innerText || '').trim())
          .filter(Boolean);
        const hasCalcUI = headings.some(t =>
          /^(Select energy type|Body Type|Select variant|Choose your powertrain|Transmission|Drive Away Price|Colour)\.?$/i.test(t)
        ) || !!document.querySelector('[class*="cpc" i], [class*="calculator" i]');
        return {
          textLen: bodyText.length,
          headingCount: headings.length,
          hasPrice: priceRe.test(bodyText),
          hasCalcUI,
          comingSoon: /pricing\s+coming\s+soon|coming\s+soon\s+at\s+hyundai/i.test(bodyText),
        };
      });

      // A page counts as LOADED if the calculator rendered, a price showed, or a
      // "coming soon" placeholder appeared (it finished loading either way).
      const loaded = rendered || snap.hasCalcUI || snap.hasPrice || snap.comingSoon;
      entry.comingSoon = snap.comingSoon && !snap.hasPrice && !snap.hasCalcUI;
      if (!loaded && !entry.error) {
        // Nothing meaningful rendered. Empty body → blank; otherwise the
        // calculator never finished loading → "loading forever".
        if (snap.headingCount === 0 && snap.textLen < 200) entry.blank = true;
        else entry.stillLoading = true;
      }
    } catch (err) {
      entry.error = (err.message || String(err)).split('\n')[0];
      if (entry.loadMs == null) entry.loadMs = Date.now() - startedAt;
      // A navigation timeout is itself a "still loading" symptom.
      if (/Timeout|timed out/i.test(entry.error)) entry.stillLoading = true;
    }

    const ok = isCpcPass(entry);
    const label = ok
      ? (entry.comingSoon
          ? `OK — coming soon (HTTP ${entry.httpStatus}, ${entry.loadMs}ms)`
          : `OK (HTTP ${entry.httpStatus}, ${entry.driveAwayPrice || 'rendered'}, ${entry.loadMs}ms)`)
      : entry.error
        ? `ERROR: ${entry.error}`
        : entry.httpStatus !== 200
          ? `HTTP ${entry.httpStatus}`
          : entry.blank
            ? 'BLANK'
            : 'STILL LOADING';
    console.log(`  • ${entry.name.padEnd(22)} → ${label}`);
    results.push(entry);
  }

  this._cpcLoadResults = results;
});

// A model PASSES when its CPC page opened (HTTP 200, or no doc response but the
// URL reached the page), rendered content, and isn't blank/stuck/errored.
function isCpcPass(r) {
  const statusOk = r.httpStatus === 200 || (r.httpStatus == null && !r.error);
  return statusOk && !r.blank && !r.stillLoading && !r.error;
}

// ── Assertion steps. Following the calculator_pricing pattern, these collect
//    failures WITHOUT throwing so every check runs and the report is always
//    generated; the report step performs the final assert.fail.
function recordCpcFailure(world, line) {
  if (!world._cpcLoadFailures) world._cpcLoadFailures = [];
  world._cpcLoadFailures.push(line);
}

Then(/^every model's CPC page should return HTTP status 200$/i, async function () {
  const results = this._cpcLoadResults || [];
  // Flag genuine non-200 responses (and click-navigation errors). A null status
  // means the click navigated client-side with no document response — fine as
  // long as the page actually reached and rendered (covered by later steps).
  const offenders = results.filter(r => (r.httpStatus != null && r.httpStatus !== 200) || r.error);
  for (const o of offenders) {
    recordCpcFailure(this, `${o.slug}: ${o.error ? o.error : `CPC page returned HTTP ${o.httpStatus}`}`);
  }
});

Then(/^no model's CPC page should be blank$/i, async function () {
  const results = this._cpcLoadResults || [];
  for (const o of results.filter(r => r.blank)) {
    recordCpcFailure(this, `${o.slug}: CPC page is blank (no calculator content rendered)`);
  }
});

Then(/^no model's CPC page should still be loading after (\d+) seconds$/i, async function (seconds) {
  const results = this._cpcLoadResults || [];
  for (const o of results.filter(r => r.stillLoading)) {
    recordCpcFailure(this, `${o.slug}: CPC page still loading after ${seconds}s (spinner / network never settled)`);
  }
});

Then(/^a CPC page-load report should be generated$/i, async function () {
  const results = this._cpcLoadResults || [];
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);

  // Embed environment name in filenames so Stage and Prod reports don't collide.
  let envTag = '';
  try {
    const envCachePath = path.resolve('.cache', 'activeEnvironment.json');
    if (fs.existsSync(envCachePath)) {
      const env = JSON.parse(fs.readFileSync(envCachePath, 'utf-8'));
      if (env.activeEnvironment) envTag = `_${env.activeEnvironment.replace(/[^a-zA-Z0-9]/g, '')}`;
    }
  } catch { /* ignore */ }
  const baseName = `CpcPageLoad${envTag}_${timestamp}`;
  const outDir = path.resolve('excel-reports');
  fs.mkdirSync(outDir, { recursive: true });

  // Build a human-readable failure reason per model (matches the feature file).
  const failureReason = (r) => {
    if (r.error) return r.error;
    if (r.httpStatus != null && r.httpStatus !== 200) return `CPC page returned HTTP ${r.httpStatus}`;
    if (r.blank) return 'CPC page is blank (no calculator content rendered)';
    if (r.stillLoading) return `CPC page never finished loading within ${RENDER_TIMEOUT_MS / 1000}s (calculator UI never rendered)`;
    // Loaded fine — a "coming soon" placeholder is a note, not a failure.
    if (r.comingSoon) return 'Note: page loaded but shows "Pricing coming soon" placeholder';
    return '';
  };
  const isPass = isCpcPass;

  // ── JSON
  const jsonPath = path.join(outDir, `${baseName}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    landingUrl: this._calculatorLandingUrl,
    totalModels: results.length,
    passCount: results.filter(isPass).length,
    failCount: results.filter(r => !isPass(r)).length,
    results,
  }, null, 2));

  // ── HTML — one row per model
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rows = results.map(r => {
    const passed = isPass(r);
    const statusBadge = passed
      ? '<span style="color:#fff;background:#2e7d32;padding:3px 12px;border-radius:4px;font-weight:600">PASS</span>'
      : '<span style="color:#fff;background:#c62828;padding:3px 12px;border-radius:4px;font-weight:600">FAIL</span>';
    const httpCell = r.httpStatus == null
      ? '<span style="color:#999" title="client-side navigation — no document response">—</span>'
      : `<span style="color:${r.httpStatus === 200 ? '#1b5e20' : '#c62828'}">${esc(r.httpStatus)}</span>`;
    const priceCell = r.driveAwayPrice
      ? `<strong style="color:#1b5e20">${esc(r.driveAwayPrice)}</strong>`
      : r.comingSoon
        ? '<span style="color:#c62828">Pricing coming soon</span>'
        : '<span style="color:#999">—</span>';
    // A non-failing "coming soon" note shouldn't be coloured like an error.
    const reasonColor = passed ? '#777' : '#a33';
    return `<tr>
      <td><a href="${esc(r.url)}" target="_blank">${esc(r.displayName || r.slug)}</a></td>
      <td style="font-size:12px;color:#555">${esc(r.url)}</td>
      <td>${httpCell}</td>
      <td>${priceCell}</td>
      <td>${r.loadMs == null ? '—' : esc(r.loadMs) + ' ms'}</td>
      <td>${statusBadge}</td>
      <td style="color:${reasonColor}">${esc(failureReason(r))}</td>
    </tr>`;
  }).join('\n');

  const passCount = results.filter(isPass).length;
  const failCount = results.length - passCount;
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>CPC Page-Load Report — ${timestamp}</title>
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
<h1>Hyundai CPC — Page-Load Report${envTag ? ` (${envTag.replace(/^_/, '')})` : ''}</h1>
<div class="meta">Environment: <strong>${esc(envTag.replace(/^_/, '') || 'Unknown')}</strong> · Generated ${esc(new Date().toISOString())} · Landing: <a href="${esc(this._calculatorLandingUrl || '')}" target="_blank">${esc(this._calculatorLandingUrl || '')}</a></div>
<div class="meta" style="font-size:12px">This report checks that each model's CPC page <strong>loads</strong> (opens, renders, isn't blank or stuck). The price is shown only as evidence the calculator rendered — it's the price on load (often a pre-selected trim), not the model's authoritative price. For exact per-variant pricing see the Calculator Pricing report.</div>
<div class="summary">
  <div class="card">Total models<b>${results.length}</b></div>
  <div class="card" style="background:#e8f5e9">Loaded OK<b>${passCount}</b></div>
  <div class="card" style="background:#ffebee">Failed<b>${failCount}</b></div>
</div>
<table>
  <thead><tr><th>Model</th><th>CPC URL</th><th>HTTP Status</th><th>Price (load evidence)</th><th>Load Time</th><th>Load Result</th><th>Failure Reason</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
</body></html>`;
  const htmlPath = path.join(outDir, `${baseName}.html`);
  fs.writeFileSync(htmlPath, html);

  // ── PDF (headless Chromium prints the HTML)
  const pdfPath = path.join(outDir, `${baseName}.pdf`);
  let pdfWritten = false;
  let pdfBrowser = null;
  try {
    pdfBrowser = await chromium.launch();
    const ctx = await pdfBrowser.newContext();
    const pdfPage = await ctx.newPage();
    await pdfPage.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
    await pdfPage.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' },
    });
    pdfWritten = true;
  } catch (err) {
    console.warn(`⚠  PDF generation failed: ${err.message}`);
  } finally {
    if (pdfBrowser) await pdfBrowser.close().catch(() => {});
  }

  console.log(`📊 CPC page-load report:`);
  console.log(`   HTML → ${htmlPath}`);
  console.log(`   JSON → ${jsonPath}`);
  if (pdfWritten) console.log(`   PDF  → ${pdfPath}`);

  // Attach to Cucumber report
  if (this.attach) {
    await this.attach(JSON.stringify({
      htmlReport: htmlPath,
      jsonReport: jsonPath,
      pdfReport: pdfWritten ? pdfPath : null,
      totalModels: results.length,
      passed: results.filter(isPass).map(r => r.slug),
      failed: results.filter(r => !isPass(r)).map(r => ({ slug: r.slug, reason: failureReason(r) })),
    }, null, 2), 'application/json');
  }

  // Data-content failure (CPC page not loading). The scenario is tagged
  // @no-autofix so the Claude/MCP fix loop skips it — these are real product
  // issues, not test-code bugs an LLM can repair.
  if (this._cpcLoadFailures && this._cpcLoadFailures.length) {
    assert.fail(`CPC page-load failures:\n  - ${this._cpcLoadFailures.join('\n  - ')}`);
  }
});
