// Centralized step definitions for new Gherkin steps (data-driven)
Given('the user has loaded the test data from the Confluence page {string} and found the test data for {string}', async function (pageName, testDataName) {
  // This step should load and parse the test data from Confluence if not already loaded.
  // If your framework already loads this in the Background, you may leave this as a no-op or add a check.
  // For now, we assume the data is loaded by the Background step.
  console.log(`ℹ️ Test data loaded from Confluence page: ${pageName}, sheet: ${testDataName}`);
});

When('I fetch the Vehicle from the test data', async function () {
  // Click the vehicle tile on the PIM "All Models" page using the
  // Vehicle column from the test data.
  const vehicle = _pimVehicle(this);
  this.fetchedPimVehicle = vehicle;
  this.fetchedPimVariant = _pimVariant(this);
  console.log(`🖱️  Selecting Vehicle from All Models: ${vehicle}`);
  await clickModelTile(this.page, vehicle);
  console.log(`✅ Opened vehicle: ${vehicle}`);
});

When('I select the specific variant in PIM as per the test data', async function () {
  // Click the PIM Variant row in the Model Series table on the model
  // detail page.
  const variant = this.fetchedPimVariant || _pimVariant(this);
  console.log(`🖱️  Selecting PIM Variant: ${variant}`);
  await selectPimVariant(this.page, variant);
  console.log(`✅ Selected variant: ${variant}`);
});

Then(
  /^I capture the PIM Manufacturer List Price for the selected variant(?:\s+and\s+description)?$/i,
  async function () {
    const variant = this.fetchedPimVariant || _pimVariant(this);
    const description = _pimDescription(this);
    if (description) {
      console.log(`📋 Matching PIM row by Variant="${variant}" + Description="${description}"`);
    } else {
      console.log(`📋 Matching PIM row by Variant="${variant}" (no PIM_Description in test data)`);
    }
    await _captureVariantMlp.call(this, variant, description);
  }
);

When('I open the Hyundai consumer calculator using the CPC URL from the test data', async function () {
  const url = _pimCpcUrl(this);
  let slug;
  if (url) {
    const m = url.match(/\/calculator\/([^/?#]+)/i);
    slug = m ? m[1] : _pimVehicle(this).toLowerCase();
  } else {
    slug = _pimVehicle(this).toLowerCase();
  }
  console.log(`🌐 Opening consumer calculator from test data (slug: ${slug})`);
  await _openConsumerCalculator.call(this, slug);
});

function _testDataField(row, ...keys) {
  for (const k of keys) {
    if (row[k] != null && String(row[k]).trim() !== '') return String(row[k]).trim();
  }
  return '';
}

function _isSkipValue(v) {
  if (!v) return true;
  const s = v.toString().trim().toLowerCase();
  return s === '' || s === 'na' || s === 'n/a' || s === '-';
}

When('I select Site_Variant from test data', async function () {
  const r = _pimRow(this);
  const variantLabel = _testDataField(r, 'Site_Variant', 'SiteVariant', 'site_variant');
  assert.ok(
    variantLabel,
    `Site_Variant missing in test data row. Got keys: ${Object.keys(r).join(', ')}`
  );
  console.log(`🖱️  Selecting Site_Variant from test data: ${variantLabel}`);
  await _selectConsumerVariant.call(this, variantLabel);
});

When('I select Site_Powertrain from test data', async function () {
  const r = _pimRow(this);
  const powertrain = _testDataField(r, 'Site_Powertrain', 'Powertrain', 'powertrain');
  if (_isSkipValue(powertrain)) {
    console.log('ℹ️  No Site_Powertrain to select (NA or missing)');
    return;
  }
  console.log(`🖱️  Selecting Site_Powertrain from test data: ${powertrain}`);
  await _selectConsumerOption.call(this, powertrain);
});

When('I select Extended Range Option pack from test data', async function () {
  const r = _pimRow(this);
  const option = _testDataField(r, 'Extended Range Option Pack', 'ExtendedRangeOptionPack', 'OptionPack');
  if (_isSkipValue(option)) {
    console.log('ℹ️  No Extended Range Option pack to select (NA or missing)');
    return;
  }
  console.log(`🖱️  Selecting Extended Range Option pack from test data: ${option}`);
  await _selectConsumerOption.call(this, option);
});

When('I select Roof Basket Option pack from test data', async function () {
  const r = _pimRow(this);
  const option = _testDataField(r, 'Roof Basket Option Pack', 'RoofBasketOptionPack');
  if (_isSkipValue(option)) {
    console.log('ℹ️  No Roof Basket Option pack to select (NA or missing)');
    return;
  }
  console.log(`🖱️  Selecting Roof Basket Option pack from test data: ${option}`);
  await _selectConsumerOption.call(this, option);
});

When('I select Site_Transmission from test data', async function () {
  const r = _pimRow(this);
  const transmission = _testDataField(r, 'Site_Transmission', 'Transmission', 'transmission');
  if (_isSkipValue(transmission)) {
    console.log('ℹ️  No Site_Transmission to select (NA or missing)');
    return;
  }
  console.log(`🖱️  Selecting Site_Transmission from test data: ${transmission}`);
  await _selectConsumerOption.call(this, transmission);
});
// @protected
/**
 * Step Definitions for: PIM
 * Source: PIM.feature
 *
 * Phrasings picked up in any .feature file (case-insensitive):
 *
 *   Given I log in to PIM Hyundai
 *   Given I log in to PIM Genesis
 *   Given the user logs in to PIM Hyundai
 *   Given I navigate to PIM Genesis
 *   Given I am on PIM Hyundai
 *
 *   # explicit override of the dropdown option
 *   Given I log in to PIM as "Hyundai"
 *   Given I log in to PIM as "Genesis"
 *
 *   # switch company once already logged in
 *   And the user selects PIM company "Genesis"
 *
 *   When I click the "VENUE" model
 *   When the user selects model "Kona"
 *
 *   Then I should be on the PIM Hyundai dashboard
 *
 * Flow performed by the login step:
 *   1. POST /api/authenticate with credentials from .env (PIM_USER / PIM_PASS).
 *   2. Seed the returned JWT into localStorage["user-token"].
 *   3. Navigate to https://stage-pim.hyundai.com.au/.
 *   4. Dismiss the "Attention!" popup.
 *   5. Pick the brand from the top-left dropdown (Hyundai or Genesis).
 */
import { Given, When, Then } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { authenticatePim, selectCompany } from '../../../utils/pimAuth.js';
import { handleLocationModal } from './commonHelpers.js';

// Login + auto-pick company by brand name embedded in the step.
//   "I log in to PIM Hyundai" -> Hyundai
//   "I log in to PIM Genesis" -> Genesis
const PIM_RE =
  /^(?:I|the user)\s+(?:log(?:s)? in to|navigate(?:s)? to|am(?: now)? logged in to|am(?: now)? on)\s+PIM\s+(Hyundai|Genesis)$/i;

Given(PIM_RE, async function (brand) {
  const company = brand[0].toUpperCase() + brand.slice(1).toLowerCase();
  console.log(`🔐 Logging in to PIM (${company})...`);
  await authenticatePim(this, { company });
  console.log(`✅ PIM authenticated — company "${company}" selected`);
});

// Explicit company name via quoted string (any value).
Given(
  /^(?:I|the user)\s+(?:log(?:s)? in to|navigate(?:s)? to)\s+PIM\s+as\s+"([^"]+)"$/i,
  async function (company) {
    console.log(`🔐 Logging in to PIM (company: ${company})...`);
    await authenticatePim(this, { company });
    console.log(`✅ PIM authenticated — company "${company}" selected`);
  }
);

// Standalone company-switch step (assumes already on PIM).
Given('the user selects PIM company {string}', async function (company) {
  await selectCompany(this.page, company);
});

// Click a model tile on the "All Models" page by name (case-insensitive).
// Matches phrasings like:
//   When I click the "VENUE" model
//   When the user clicks the "Kona" model
//   And I click "VENUE" model
//   When I select model "VENUE"
When(
  /^(?:I|the user)\s+(?:click(?:s)?|select(?:s)?|open(?:s)?)\s+(?:the\s+)?(?:"([^"]+)"\s+model|model\s+"([^"]+)")$/i,
  async function (a, b) {
    const modelName = (a || b).trim();
    console.log(`🖱️  Clicking model: ${modelName}`);
    await clickModelTile(this.page, modelName);
    console.log(`✅ Opened model: ${modelName}`);
  }
);

async function clickModelTile(page, modelName) {
  // Wait for the All Models grid shell to settle.
  await page.waitForLoadState('networkidle').catch(() => { });

  // The "All Models" grid renders 30+ tiles lazily; `networkidle` resolves
  // before every image+label has hydrated. Use Playwright's auto-waiting
  // locator and wait explicitly for the model-name label to become
  // visible. Match case-insensitively because tiles often render the
  // model name uppercased (e.g. "INSTER") while test data is in title
  // case ("Inster").
  const nameRe = new RegExp(`^\\s*${escapeRe(modelName)}\\s*$`, 'i');
  const label = page.getByText(nameRe).first();
  try {
    await label.waitFor({ state: 'visible', timeout: 20000 });
  } catch {
    // If the grid is virtualised, nudge a scroll-to-bottom and retry once.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    await label.waitFor({ state: 'visible', timeout: 10000 });
  }
  await label.scrollIntoViewIfNeeded().catch(() => { });

  // Walk up to the nearest clickable tile container (v-card / v-sheet / a /
  // button / role=button). Fall back to clicking the label itself if no
  // suitable ancestor is found — Vuetify often attaches click handlers via
  // event bubbling on the inner content as well.
  const cardSelector =
    'xpath=ancestor::*[contains(@class,"v-card") or contains(@class,"v-sheet") ' +
    'or @role="button" or @role="link" or self::a or self::button][1]';
  const card = label.locator(cardSelector);

  const target = (await card.count()) ? card.first() : label;
  await target.click({ timeout: 8000 });
  await page.waitForLoadState('networkidle').catch(() => { });
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Click the named variant in the PIM "Model Series" table on the model
// detail page. The Model Series table has a row per variant with the
// variant name in the leftmost data column; clicking the variant name
// drills into that variant's detail view.
async function selectPimVariant(page, variant) {
  await page.waitForLoadState('networkidle').catch(() => { });
  const escVariant = escapeRe(variant);
  const exactRe = new RegExp(`^\\s*${escVariant}\\s*$`, 'i');

  const candidates = [
    page.getByRole('link', { name: exactRe }),
    page.getByRole('button', { name: exactRe }),
    page.locator('table tbody tr').filter({ hasText: exactRe }).getByText(exactRe, { exact: false }),
    page.getByText(exactRe),
  ];

  let target = null;
  for (const loc of candidates) {
    const first = loc.first();
    try {
      await first.waitFor({ state: 'visible', timeout: 4000 });
      target = first;
      break;
    } catch { /* try next */ }
  }
  if (!target) {
    const samples = await page.evaluate(() => {
      const out = [];
      const seen = new Set();
      document.querySelectorAll('td, th, a, button, [role="button"], div, span').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        let t = '';
        for (const n of el.childNodes) if (n.nodeType === 3) t += n.nodeValue;
        t = t.trim();
        if (!t || t.length > 60 || seen.has(t)) return;
        seen.add(t);
        out.push(t);
      });
      return out.slice(0, 40);
    }).catch(() => []);
    throw new Error(
      `Could not find PIM variant "${variant}" in the Model Series table. Visible labels: ${JSON.stringify(samples)}`
    );
  }
  await target.scrollIntoViewIfNeeded().catch(() => { });
  await target.click({ timeout: 8000 });
  await page.waitForLoadState('networkidle').catch(() => { });
}

// Generic "click X" step — used for tabs / nav items / buttons inside the
// PIM model detail page (e.g. "Pricing", "Specifications", "Features").
// Matches phrasings like:
//   And I click "Pricing"
//   When the user clicks "Pricing"
//   And I click on "Pricing"
When(
  /^(?:I|the user)\s+click(?:s)?(?:\s+on)?\s+"([^"]+)"$/i,
  async function (label) {
    console.log(`🖱️  Clicking: ${label}`);
    const page = this.page;
    await page.waitForLoadState('networkidle').catch(() => { });

    // Try role-based locators first (tabs, buttons, links), then fall back
    // to any visible element with the exact text.
    const candidates = [
      page.getByRole('tab', { name: label, exact: true }),
      page.getByRole('button', { name: label, exact: true }),
      page.getByRole('link', { name: label, exact: true }),
      page.getByText(label, { exact: true }),
    ];

    let lastError;
    for (const loc of candidates) {
      try {
        const target = loc.first();
        await target.waitFor({ state: 'visible', timeout: 5000 });

        // If the matched element is a column header (<th>), the click would
        // be a no-op (or sort the table). Instead, navigate to the data
        // cell in the same column of the first body row and click whatever
        // actionable element is inside (icon button / link). This is how
        // the PIM "Model Series" table exposes per-column editors.
        const handled = await page.evaluate(({ name }) => {
          const labelText = name.trim().toLowerCase();
          // Find a <th> whose own text matches the label.
          const ths = Array.from(document.querySelectorAll('th'));
          const th = ths.find(
            (h) => (h.textContent || '').trim().toLowerCase() === labelText
          );
          if (!th) return false;
          const tr = th.parentElement;
          if (!tr) return false;
          const colIndex = Array.from(tr.children).indexOf(th);
          if (colIndex < 0) return false;
          const table = th.closest('table');
          if (!table) return false;
          const bodyRow = table.querySelector('tbody tr');
          if (!bodyRow) return false;
          const cell = bodyRow.children[colIndex];
          if (!cell) return false;
          // Tag the cell so Playwright can target it deterministically.
          cell.setAttribute('data-pim-column-cell', name);
          return true;
        }, { name: label });

        if (handled) {
          const cell = page.locator(`[data-pim-column-cell="${label}"]`).first();
          // Click the first interactive child (button / link / svg-wrapped
          // icon). If none found, click the cell itself.
          const actionable = cell.locator(
            'button, a, [role="button"], [role="link"], .v-btn, svg, i'
          ).first();
          const target = (await actionable.count()) ? actionable : cell;
          await target.scrollIntoViewIfNeeded().catch(() => { });
          await target.click({ timeout: 8000 });
          await page.waitForLoadState('networkidle').catch(() => { });
          console.log(`✅ Clicked "${label}" cell in Model Series row`);
          return;
        }

        await target.scrollIntoViewIfNeeded().catch(() => { });
        await target.click({ timeout: 5000 });
        await page.waitForLoadState('networkidle').catch(() => { });
        console.log(`✅ Clicked: ${label}`);
        return;
      } catch (err) {
        lastError = err;
      }
    }
    throw new Error(`Could not find a clickable "${label}" element. ${lastError?.message || ''}`);
  }
);

Then(/^I should be on the PIM (?:Hyundai|Genesis)?\s*dashboard$/i, async function () {
  const url = this.page.url();
  assert.ok(
    /stage-pim\.hyundai\.com\.au/i.test(url) && !/login|signin/i.test(url),
    `Expected to be on the authenticated PIM dashboard, got: ${url}`
  );
});

// ---------------------------------------------------------------------------
// PIM ⇄ Consumer site Manufacturer List Price comparison
// ---------------------------------------------------------------------------

function parsePrice(text) {
  if (!text) return NaN;
  const cleaned = String(text).replace(/[^0-9.]/g, '');
  if (!cleaned) return NaN;
  return Number.parseFloat(cleaned);
}

function fmtPrice(n) {
  return Number.isFinite(n)
    ? `$${n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : String(n);
}

// Capture the Manufacturer List Price for a named variant on the PIM Pricing
// page. The Variant Pricing table has headers:
//   Id | Variant | Description | Dealer Price | Dealer Trading Margin |
//   List Price | GST | Luxury Car Tax | Manufacturer List Price | Dealer
//   Invoice Price
//
// We locate the column by header text (so this survives column reorders) and
// the row by the Variant cell text (e.g. "Active").
async function _captureVariantMlp(variant, description) {
    const page = this.page;
    await page.waitForLoadState('networkidle').catch(() => { });

    // Wait for the Variant Pricing section to render.
    await page.getByText('Variant Pricing', { exact: false })
      .first()
      .waitFor({ state: 'visible', timeout: 15000 });
    // Also wait for the actual header cell of the column we need.
    await page.getByText('Manufacturer List Price', { exact: true })
      .first()
      .waitFor({ state: 'visible', timeout: 10000 });
    // Don't hard-fail here if the exact variant text isn't found at the top
    // level — the in-page evaluate below does a scoped/fuzzy match and will
    // return a clear list of available variants on failure.
    await page.getByText(variant, { exact: false })
      .first()
      .waitFor({ state: 'visible', timeout: 10000 })
      .catch(() => { });

    // The PIM "Variant Pricing" grid is rendered with Vuetify divs, not a
    // semantic <table>. We need to scope strictly to the Variant Pricing
    // section because "Manufacturer List Price" appears in every Option
    // Pricing accordion as well, and "Active" appears in the sidebar /
    // section headings. Strategy: find the "Variant Pricing" heading, then
    // the next "Option Pricing" heading — everything between them is the
    // variant table. Within that vertical band, pick the header cell and
    // variant row by exact text and read the (colX, rowY) intersection.
    // When a description is supplied (PIM_Description from test data), we
    // disambiguate rows that share the same Variant name by also matching
    // the Description cell in the same row band.
    const result = await page.evaluate(({ variantName, header, descriptionText }) => {
      const wantVariant = variantName.trim().toLowerCase();
      const wantHeader = header.trim().toLowerCase();
      const wantDescription = (descriptionText || '').trim().toLowerCase();

      function ownText(el) {
        let s = '';
        for (const node of el.childNodes) {
          if (node.nodeType === 3) s += node.nodeValue;
        }
        return s.trim();
      }
      function visible(el) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const style = window.getComputedStyle(el);
        return style.visibility !== 'hidden' && style.display !== 'none';
      }
      function collectText(el) {
        const parts = [(el.textContent || '').trim()];
        el.querySelectorAll('input, textarea').forEach((i) => {
          const v = (i.value || '').trim();
          if (v) parts.push(v);
        });
        return parts.filter(Boolean).join(' ').trim();
      }

      const all = Array.from(document.querySelectorAll('body *')).filter(visible);

      // Anchor the Variant Pricing section by the "Variant Pricing" label
      // and the "Option Pricing" label that follows it.
      const variantPricingLabel = all.find(
        (el) => ownText(el).toLowerCase() === 'variant pricing'
      );
      const optionPricingLabel = all.find(
        (el) => ownText(el).toLowerCase() === 'option pricing'
      );
      if (!variantPricingLabel) {
        return { error: 'Could not find "Variant Pricing" section heading.' };
      }
      const sectionTop = variantPricingLabel.getBoundingClientRect().bottom;
      const sectionBottom = optionPricingLabel
        ? optionPricingLabel.getBoundingClientRect().top
        : Number.POSITIVE_INFINITY;

      function inSection(el) {
        const r = el.getBoundingClientRect();
        const yMid = r.top + r.height / 2;
        return yMid >= sectionTop && yMid <= sectionBottom;
      }

      // Variant cell match. Two passes:
      //  1) Exact match on the cell's full textContent (after trim/collapse).
      //     This is the correct match for the base "INSTER" row when
      //     other rows are "INSTER Cross w/Sunroof" etc.
      //  2) Word-boundary contains, preferring the shortest match.
      // We use textContent (not ownText) because PIM wraps cell text in
      // a child <span>, which makes ownText empty on the outer cell.
      // We also keep only leaf-ish elements (no child element that has
      // the same text) to avoid picking up wrappers.
      function cellText(el) {
        return (el.textContent || '').replace(/\s+/g, ' ').trim();
      }
      const sectionEls = all.filter((el) => inSection(el));

      // Build candidate cells: short text, and no descendant element has
      // the same trimmed text (i.e. it's the innermost wrapper).
      const variantCandidates = [];
      for (const el of sectionEls) {
        const t = cellText(el);
        if (!t || t.length > 80) continue;
        // Skip if any descendant element has exactly the same text — that
        // means this element is a wrapper around the real cell.
        let isWrapper = false;
        for (const child of el.querySelectorAll('*')) {
          if (cellText(child) === t) { isWrapper = true; break; }
        }
        if (isWrapper) continue;
        variantCandidates.push({ el, t, tl: t.toLowerCase() });
      }

      const headerEl = sectionEls.find(
        (el) => cellText(el).toLowerCase() === wantHeader && !Array.from(el.querySelectorAll('*')).some((c) => cellText(c).toLowerCase() === wantHeader)
      ) || all.find((el) => inSection(el) && ownText(el).toLowerCase() === wantHeader);

      // Build description candidates (allow longer text than variant cells).
      const descriptionCandidates = [];
      if (wantDescription) {
        for (const el of sectionEls) {
          const t = cellText(el);
          if (!t || t.length > 300) continue;
          let isWrapper = false;
          for (const child of el.querySelectorAll('*')) {
            if (cellText(child) === t) { isWrapper = true; break; }
          }
          if (isWrapper) continue;
          descriptionCandidates.push({ el, t, tl: t.toLowerCase() });
        }
      }

      // If a description is given, pick the variant cell whose row band
      // (similar Y) also contains a cell matching the description text.
      // This disambiguates rows that share the same Variant name.
      let variantMatch = null;
      let descriptionMatch = null;
      if (wantDescription) {
        const exactVariantCandidates = variantCandidates.filter(
          (c) => c.tl === wantVariant
        );
        // If exact-match variants exist, prefer those; otherwise fall back
        // to word-boundary contains.
        const escWantV = wantVariant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const wbVRe = new RegExp(`(^|[^a-z0-9])${escWantV}([^a-z0-9]|$)`, 'i');
        const considerV = exactVariantCandidates.length
          ? exactVariantCandidates
          : variantCandidates.filter((c) => wbVRe.test(c.t));

        for (const vc of considerV) {
          const vr = vc.el.getBoundingClientRect();
          const vy = vr.top + vr.height / 2;
          const tol = Math.max(vr.height, 30) + 10;
          const dc = descriptionCandidates.find((d) => {
            if (d.tl !== wantDescription && !d.tl.includes(wantDescription)) {
              return false;
            }
            const dr = d.el.getBoundingClientRect();
            const dy = dr.top + dr.height / 2;
            return Math.abs(dy - vy) < tol;
          });
          if (dc) {
            variantMatch = vc;
            descriptionMatch = dc;
            break;
          }
        }
      }
      // Fallback: variant-only matching (Pass 1: exact, Pass 2: word-boundary).
      if (!variantMatch) {
        variantMatch = variantCandidates.find((c) => c.tl === wantVariant);
      }
      if (!variantMatch) {
        const escWant = wantVariant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const wbRe = new RegExp(`(^|[^a-z0-9])${escWant}([^a-z0-9]|$)`, 'i');
        const wbMatches = variantCandidates
          .filter((c) => wbRe.test(c.t))
          .sort((a, b) => a.t.length - b.t.length);
        variantMatch = wbMatches[0];
      }
      const variantEl = variantMatch ? variantMatch.el : null;

      // If a description was supplied but no row matched both, fail with a
      // helpful list of available (variant, description) pairs in the table
      // so the user can correct the Confluence test data.
      if (wantDescription && !descriptionMatch) {
        const pairs = [];
        const seen = new Set();
        for (const vc of variantCandidates) {
          const vr = vc.el.getBoundingClientRect();
          const vy = vr.top + vr.height / 2;
          const tol = Math.max(vr.height, 30) + 10;
          const dc = descriptionCandidates.find((d) => {
            const dr = d.el.getBoundingClientRect();
            const dy = dr.top + dr.height / 2;
            return Math.abs(dy - vy) < tol && d.t.length > vc.t.length;
          });
          if (!dc) continue;
          const key = `${vc.t} | ${dc.t}`;
          if (seen.has(key)) continue;
          seen.add(key);
          pairs.push({ variant: vc.t, description: dc.t });
        }
        return {
          error: `No row matched Variant="${variantName}" + PIM_Description="${descriptionText}". Available pairs: ${JSON.stringify(pairs.slice(0, 30))}`,
        };
      }
      if (!headerEl || !variantEl) {
        // Build a list of available variant labels to help the user fix
        // their Confluence test data. Variant cells live in the leftmost
        // column of the Variant Pricing grid — collect short ownText
        // values from the section, dedup, and return.
        const labels = Array.from(new Set(
          variantCandidates
            .map((c) => c.t)
            .filter((t) => t && t.length <= 60 && !/^\$?[\d,.\s]+$/.test(t) && !/^(id|variant|description|dealer price|dealer trading margin|list price|gst|luxury car tax|manufacturer list price|dealer invoice price)$/i.test(t))
        ));
        return {
          error: `Anchors not found in Variant Pricing section — header:${!!headerEl} variant:${!!variantEl}. Available variant labels: ${JSON.stringify(labels.slice(0, 20))}`,
        };
      }

      const hRect = headerEl.getBoundingClientRect();
      const vRect = variantEl.getBoundingClientRect();
      const colCenterX = hRect.left + hRect.width / 2;
      const rowCenterY = vRect.top + vRect.height / 2;

      // Strategy: among all small visible elements in the section whose
      // text looks like a money amount ($X,XXX.XX, or a bare numeric like
      // 28,000.00), pick the one whose CENTER is closest to
      // (colCenterX, rowCenterY). This avoids picking the whole-section
      // container that also "contains" the intersection point.
      const moneyRe = /^\s*\$?\s*[\d,]+(?:\.\d{1,2})?\s*$/;

      const moneyCells = [];
      for (const el of all) {
        if (!inSection(el)) continue;
        const txt = collectText(el);
        if (!txt || txt.length > 20) continue;
        if (!moneyRe.test(txt)) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.width > 300 || r.height > 80) continue;
        // Each money cell will often have multiple wrapping <div>s with the
        // same text; pick the innermost (smallest) per location later by
        // dedup.
        moneyCells.push({ el, txt, r, area: r.width * r.height });
      }

      if (moneyCells.length === 0) {
        return { error: 'No money-shaped cells found in section.' };
      }

      // Deduplicate overlapping wrappers: prefer smallest at each location.
      moneyCells.sort((a, b) => a.area - b.area);
      const picked = [];
      for (const c of moneyCells) {
        const cx = c.r.left + c.r.width / 2;
        const cy = c.r.top + c.r.height / 2;
        const dup = picked.some((p) => {
          const px = p.r.left + p.r.width / 2;
          const py = p.r.top + p.r.height / 2;
          return Math.abs(px - cx) < 5 && Math.abs(py - cy) < 5 && p.txt === c.txt;
        });
        if (!dup) picked.push(c);
      }

      // Rank by distance to (colCenterX, rowCenterY).
      picked.sort((a, b) => {
        const da = Math.hypot(
          a.r.left + a.r.width / 2 - colCenterX,
          a.r.top + a.r.height / 2 - rowCenterY
        );
        const db = Math.hypot(
          b.r.left + b.r.width / 2 - colCenterX,
          b.r.top + b.r.height / 2 - rowCenterY
        );
        return da - db;
      });

      const best = picked[0];
      if (!best) {
        return { error: 'No best money cell after ranking.' };
      }

      // Sanity: ensure best is roughly in the same row band as the variant.
      const bestY = best.r.top + best.r.height / 2;
      if (Math.abs(bestY - rowCenterY) > vRect.height * 2 + 20) {
        return {
          error: `Closest money cell ("${best.txt}") is not in the variant row.`,
          debug: picked.slice(0, 5).map((p) => ({
            txt: p.txt,
            dx: Math.round(p.r.left + p.r.width / 2 - colCenterX),
            dy: Math.round(p.r.top + p.r.height / 2 - rowCenterY),
          })),
        };
      }

      return { text: best.txt };
    }, { variantName: variant, header: 'Manufacturer List Price', descriptionText: description || '' });

    if (!result || result.error) {
      const dbg = result && result.debug ? ` debug=${JSON.stringify(result.debug)}` : '';
      const tag = description ? `variant "${variant}" + description "${description}"` : `variant "${variant}"`;
      throw new Error(
        `Could not find Manufacturer List Price for ${tag} in the PIM Variant Pricing table. ${result?.error || ''}${dbg}`
      );
    }

    const price = parsePrice(result.text);
    if (!Number.isFinite(price)) {
      throw new Error(`Captured Manufacturer List Price text "${result.text}" is not a number.`);
    }

    this.pimManufacturerListPrice = price;
    this.pimManufacturerListPriceText = result.text;
    const matchTag = description ? `"${variant}" / "${description}"` : `"${variant}"`;
    console.log(`📌 Captured PIM Manufacturer List Price for ${matchTag}: ${fmtPrice(price)} (raw: "${result.text}")`);

    // Save a dedicated screenshot of the PIM Variant Pricing page so it
    // is included in the report alongside the consumer-site one.
    try {
      const dir = 'screenshots';
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const safeVariant = variant.replace(/[^a-zA-Z0-9]/g, '_');
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const file = path.join(dir, `pim-Variant_Pricing-${safeVariant}-${ts}.png`);
      const buf = await page.screenshot({ fullPage: true });
      fs.writeFileSync(file, buf);
      if (typeof this.attach === 'function') this.attach(buf, 'image/png');
      this.pimScreenshotPath = file;
      console.log(`📸 PIM Variant Pricing screenshot saved: ${file}`);
    } catch (err) {
      console.warn(`⚠️  Failed to save PIM Variant Pricing screenshot: ${err.message}`);
    }
}
Then(
  /^I capture the PIM Manufacturer List Price for variant "([^"]+)"$/i,
  async function (variant) { await _captureVariantMlp.call(this, variant); }
);

// Open the Hyundai consumer car price calculator for a given model slug.
//   When I open the Hyundai consumer calculator for "venue"
async function _openConsumerCalculator(modelSlug) {
    const slug = modelSlug.trim().toLowerCase();
    // Stage consumer calculator.
    const url = `https://stage.hyundai.com.au/au/en/shop/calculator/${slug}`;
    console.log(`🌐 Navigating to consumer calculator: ${url}`);

    // Start listening for variantpricecalc XHRs. Multiple fire over the
    // page lifecycle (default variant on load, then again on every variant
    // change). Keep updating `consumerMlpFromNetwork` so that by the time
    // we assert it reflects the user-selected variant.
    this.consumerMlpFromNetwork = null;
    this._mlpResponseHandler = async (resp) => {
      try {
        if (!/variantpricecalc/i.test(resp.url())) return;
        if (!resp.ok()) return;
        const bodyText = await resp.text().catch(() => '');
        let json = null;
        try { json = bodyText ? JSON.parse(bodyText) : null; } catch { /* not JSON */ }
        if (json && typeof json.mlp === 'number') {
          this.consumerMlpFromNetwork = json.mlp;
          // Captured silently — the assertion step logs the final value
          // after all option selections are complete.
        }
        // Surface this XHR in the report's API payload panel so the
        // captured MLP is visible in the per-feature report.
        try {
          const req = resp.request();
          const payload = {
            url: resp.url(),
            method: req.method(),
            requestBody: '',
            requestHeaders: req.headers() || {},
            statusCode: resp.status(),
            responseHeaders: resp.headers() || {},
            responseBody: bodyText,
            timestamp: new Date().toISOString(),
            source: 'pim-variantpricecalc',
          };
          if (Array.isArray(this._capturedApiPayloads)) {
            this._capturedApiPayloads.push(payload);
          }
        } catch { /* ignore */ }
      } catch { /* ignore */ }
    };
    this.page.on('response', this._mlpResponseHandler);

    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => { });

    // Best-effort cookie / consent dismissal.
    for (const sel of [
      'button:has-text("Accept All")',
      'button:has-text("Accept all")',
      'button:has-text("Accept")',
      'button:has-text("I Agree")',
      'button:has-text("Got it")',
    ]) {
      const btn = this.page.locator(sel).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click().catch(() => { });
        break;
      }
    }

    // Reuse the shared "Set your location" modal helper.
    await handleLocationModal(this.page, '2000');

    // Wait for the variant selector to render. Stage can be slow to hydrate.
    const variantHeading = this.page
      .locator(':is(h1,h2,h3,h4,div,span,p)')
      .filter({ hasText: /^\s*Select variant\.?\s*$/i })
      .first();
    try {
      await variantHeading.waitFor({ state: 'visible', timeout: 45000 });
    } catch {
      const currentUrl = this.page.url();
      throw new Error(
        `Calculator did not render the variant selector at ${url} (current URL: ${currentUrl}).`
      );
    }
}
When(
  /^(?:I|the user)\s+open(?:s)?\s+the\s+Hyundai\s+consumer\s+calculator\s+for\s+"([^"]+)"$/i,
  async function (modelSlug) { await _openConsumerCalculator.call(this, modelSlug); }
);

// Select a variant on the consumer calculator (e.g. "VENUE Active").
async function _selectConsumerVariant(variant) {
    console.log(`🖱️  Selecting variant: ${variant}`);
    const page = this.page;
    const escRe = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const candidates = [
      page.getByText(variant, { exact: true }),
      page.getByText(new RegExp(`^\\s*${escRe}\\s*$`, 'i')),
      page.getByRole('button', { name: new RegExp(escRe, 'i') }),
      page.getByRole('link', { name: new RegExp(escRe, 'i') }),
      page.getByText(new RegExp(escRe, 'i')),
    ];
    let target = null;
    for (const loc of candidates) {
      const first = loc.first();
      try {
        await first.waitFor({ state: 'visible', timeout: 4000 });
        target = first;
        break;
      } catch { /* try next */ }
    }
    if (!target) {
      const samples = await page.evaluate(() => {
        const out = [];
        const seen = new Set();
        document.querySelectorAll('button, a, h2, h3, h4, [role="button"], div, span').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return;
          let t = '';
          for (const n of el.childNodes) if (n.nodeType === 3) t += n.nodeValue;
          t = t.trim();
          if (!t || t.length > 60 || seen.has(t)) return;
          seen.add(t);
          out.push(t);
        });
        return out.slice(0, 40);
      }).catch(() => []);
      throw new Error(
        `Could not find variant "${variant}" on the consumer calculator. Visible candidates: ${JSON.stringify(samples)}`
      );
    }
    await target.scrollIntoViewIfNeeded().catch(() => { });

    // Clear any earlier captured mlp so we know the value after selection
    // is genuinely for this variant.
    this.consumerMlpFromNetwork = null;

    // Click and wait for the variantpricecalc XHR triggered by the click.
    await Promise.all([
      page.waitForResponse(
        (resp) => /variantpricecalc/i.test(resp.url()) && resp.ok(),
        { timeout: 30000 }
      ).catch(() => null),
      target.click({ timeout: 8000 }),
    ]);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });
}
When(
  /^(?:I|the user)\s+select(?:s)?\s+variant\s+"([^"]+)"$/i,
  async function (variant) { await _selectConsumerVariant.call(this, variant); }
);

// Click a non-variant option on the consumer calculator (powertrain,
// transmission, option pack value, etc.). Unlike `_selectConsumerVariant`
// this does NOT clear the captured network MLP — some options (e.g. the
// sole available transmission) don't trigger a variantpricecalc XHR, and
// we want the latest MLP from any prior click to remain valid.
async function _selectConsumerOption(label) {
  const page = this.page;
  const escRe = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exactRe = new RegExp(`^\\s*${escRe}\\s*$`, 'i');
  const candidates = [
    page.getByRole('button', { name: exactRe }),
    page.getByRole('radio', { name: exactRe }),
    page.getByRole('link', { name: exactRe }),
    page.getByText(label, { exact: true }),
    page.getByText(exactRe),
  ];
  let target = null;
  for (const loc of candidates) {
    const first = loc.first();
    try {
      await first.waitFor({ state: 'visible', timeout: 4000 });
      target = first;
      break;
    } catch { /* try next */ }
  }
  if (!target) {
    const samples = await page.evaluate(() => {
      const out = [];
      const seen = new Set();
      document.querySelectorAll('button, a, h2, h3, h4, [role="button"], [role="radio"], div, span').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        let t = '';
        for (const n of el.childNodes) if (n.nodeType === 3) t += n.nodeValue;
        t = t.trim();
        if (!t || t.length > 60 || seen.has(t)) return;
        seen.add(t);
        out.push(t);
      });
      return out.slice(0, 60);
    }).catch(() => []);
    throw new Error(
      `Could not find consumer option "${label}". Visible candidates: ${JSON.stringify(samples)}`
    );
  }
  await target.scrollIntoViewIfNeeded().catch(() => { });
  await Promise.all([
    page.waitForResponse(
      (resp) => /variantpricecalc/i.test(resp.url()) && resp.ok(),
      { timeout: 10000 }
    ).catch(() => null),
    target.click({ timeout: 8000 }),
  ]);
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { });
}

// Open the Drive Away price summary popup on the consumer calculator.
When(/^(?:I|the user)\s+open(?:s)?\s+the\s+price\s+summary$/i, async function () {
  const page = this.page;
  const candidates = [
    page.getByText('View price summary', { exact: false }),
    page.getByRole('link', { name: /price summary/i }),
    page.getByRole('button', { name: /price summary/i }),
    page.getByText(/^DRIVE AWAY/i),
  ];

  let opened = false;
  for (const loc of candidates) {
    try {
      const t = loc.first();
      await t.waitFor({ state: 'visible', timeout: 5000 });
      await t.scrollIntoViewIfNeeded().catch(() => { });
      await t.click({ timeout: 5000 });
      opened = true;
      break;
    } catch { /* try next */ }
  }

  // If we already have the authoritative MLP from the variantpricecalc
  // network response, opening the popup is just a visual confirmation and
  // we don't need to block the run on it.
  if (Number.isFinite(this.consumerMlpFromNetwork)) {
    if (!opened) {
      console.log('ℹ️  Price summary popup not opened, but consumer MLP already captured from network — continuing.');
    }
    return;
  }

  if (!opened) throw new Error('Could not open price summary popup.');

  // Wait for a visible popup row (skip hidden duplicates in the DOM).
  await page.getByText(/Manufacturer List Price/i)
    .filter({ visible: true })
    .first()
    .waitFor({ state: 'visible', timeout: 10000 })
    .catch(() => { });
});

// Assert the consumer-site Manufacturer List Price equals the captured PIM
// value. Locates the row labelled "Manufacturer List Price[ inc GST]" inside
// the popup and reads the sibling price cell.
Then(
  /^the consumer Manufacturer List Price should match the PIM value$/i,
  async function () {
    const page = this.page;
    const pimPrice = this.pimManufacturerListPrice;
    assert.ok(
      Number.isFinite(pimPrice),
      'PIM Manufacturer List Price was not captured earlier — capture step must run first.'
    );

    console.log('🔎 Checking variantpricecalc.mlp after all options selected…');

    // After all option selections, the authoritative consumer MLP is the
    // value from the most recent variantpricecalc XHR. Give any in-flight
    // request a brief window to land before falling back to popup DOM
    // scraping.
    if (!Number.isFinite(this.consumerMlpFromNetwork)) {
      await page
        .waitForResponse(
          (resp) => /variantpricecalc/i.test(resp.url()) && resp.ok(),
          { timeout: 8000 }
        )
        .catch(() => null);
    }
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => { });

    if (Number.isFinite(this.consumerMlpFromNetwork)) {
      console.log(`📡 Final variantpricecalc.mlp = ${this.consumerMlpFromNetwork}`);
    }

    let consumerPrice = null;
    let source = '';
    if (Number.isFinite(this.consumerMlpFromNetwork)) {
      consumerPrice = this.consumerMlpFromNetwork;
      source = 'network (variantpricecalc.mlp)';
    } else {
      const raw = await page.evaluate(() => {
      const labelRe = /manufacturer\s+list\s+price/i;
      // Walk every element; for any whose own text matches the label, find
      // the nearest sibling/cell containing a $ amount.
      const all = Array.from(document.querySelectorAll('body *'));
      for (const el of all) {
        const own = (el.textContent || '').trim();
        if (!labelRe.test(own)) continue;
        // Skip large containers — we want the row that contains the label.
        if (own.length > 200) continue;

        // Look at the row containing this label: walk up until a parent has
        // a $ amount in a different child.
        let row = el;
        for (let i = 0; i < 6 && row; i++) {
          const text = row.textContent || '';
          const m = text.match(/\$\s*[\d,]+(?:\.\d{2})?/);
          if (m && text.replace(m[0], '').match(labelRe)) {
            return { row: text.trim().replace(/\s+/g, ' '), price: m[0] };
          }
          row = row.parentElement;
        }
      }
      return null;
      });

      if (!raw) {
        throw new Error('Could not locate the Manufacturer List Price row in the price summary popup.');
      }
      consumerPrice = parsePrice(raw.price);
      source = `popup DOM ("${raw.row}")`;
    }

    this.consumerManufacturerListPrice = consumerPrice;
    console.log(`📌 Consumer Manufacturer List Price: ${fmtPrice(consumerPrice)} [source: ${source}]`);
    console.log(`📊 Comparison — PIM: ${fmtPrice(pimPrice)}  |  Consumer: ${fmtPrice(consumerPrice)}`);

    // Compare whole-dollar amounts only — ignore sub-dollar (cent) rounding
    // differences between PIM and consumer-site calculations.
    const pimWhole = Math.trunc(pimPrice);
    const consumerWhole = Math.trunc(consumerPrice);
    assert.strictEqual(
      consumerWhole,
      pimWhole,
      `Manufacturer List Price mismatch — PIM ${fmtPrice(pimPrice)} vs Consumer ${fmtPrice(consumerPrice)}`
    );
    console.log('✅ Manufacturer List Price values match (whole-dollar).');
  }
);



// ─── Centralised test-data variants ─────────────────────────────────────────
// These wrappers pull Vehicle / Variant / CPC URL from the
// "PIM and CPC for MLP - Test Data" sheet on the Confluence
// "Automation Test Data" page (loaded via the shared Background step).
// They allow PIM.feature to be data-driven instead of hard-coding values.

function _pimRow(world) {
  const rows = world.pimTestData || [];
  assert.ok(rows.length > 0, 'PIM test data not loaded — ensure the Background step ran and matched the "PIM and CPC for MLP - Test Data" sheet.');
  return rows[0];
}
function _pimVehicle(world) {
  const r = _pimRow(world);
  const v = r.Vehicle || r.vehicle || r.Model || r.model;
  assert.ok(v, `PIM test data row is missing a Vehicle/Model column. Got keys: ${Object.keys(r).join(', ')}`);
  return String(v).trim();
}
function _pimVariant(world) {
  const r = _pimRow(world);
  const v = r['PIM Variant'] || r['PIM_Variant'] || r.PIMVariant || r.Variant || r.variant;
  assert.ok(v, `PIM test data row is missing a Variant column. Got keys: ${Object.keys(r).join(', ')}`);
  return String(v).trim();
}
function _pimDescription(world) {
  // Optional disambiguator for PIM rows where the same Variant name
  // appears multiple times with different descriptions/prices.
  const r = _pimRow(world);
  const v = r['PIM_Description'] || r['PIM Description'] || r.PIMDescription || r.Description || r.description;
  return v ? String(v).trim() : '';
}
function _pimCpcUrl(world) {
  const r = _pimRow(world);
  return (r['CPC URL'] || r.CPCURL || r.cpcUrl || r.CpcUrl || r.URL || r.Url || r.url || '').toString().trim();
}

// When I click the model from test data
When(
  /^(?:I|the user)\s+click(?:s)?\s+the\s+model\s+from\s+test\s+data$/i,
  async function () {
    const modelName = _pimVehicle(this);
    console.log(`🖱️  Clicking model from test data: ${modelName}`);
    await clickModelTile(this.page, modelName);
    console.log(`✅ Opened model: ${modelName}`);
  }
);

// Then I capture the PIM Manufacturer List Price for variant from test data
Then(
  /^I capture the PIM Manufacturer List Price for variant from test data$/i,
  async function () {
    const variant = _pimVariant(this);
    const description = _pimDescription(this);
    const tag = description ? `${variant} / ${description}` : variant;
    console.log(`📋 Capturing PIM MLP for variant from test data: ${tag}`);
    await _captureVariantMlp.call(this, variant, description);
  }
);

// When I open the Hyundai consumer calculator from test data
When(
  /^(?:I|the user)\s+open(?:s)?\s+the\s+Hyundai\s+consumer\s+calculator\s+from\s+test\s+data$/i,
  async function () {
    const url = _pimCpcUrl(this);
    let slug;
    if (url) {
      const m = url.match(/\/calculator\/([^/?#]+)/i);
      slug = m ? m[1] : _pimVehicle(this).toLowerCase();
    } else {
      slug = _pimVehicle(this).toLowerCase();
    }
    console.log(`🌐 Opening consumer calculator from test data (slug: ${slug})`);
    await _openConsumerCalculator.call(this, slug);
  }
);

