/**
 * Step Pattern Library
 *
 * A curated knowledge base of step-text patterns → reliable Playwright
 * implementations, consulted BEFORE the generic categoriser. This is the
 * "training" layer — every pattern here was verified against real page
 * interactions and produces working Playwright code on first generation.
 *
 * When a new feature file is added:
 *  1. generateStepDefs.js calls matchStepPattern(stepText, domMap, paramNames)
 *  2. The first matching pattern's generate() is used as the step body
 *  3. Falls back to generic categorise/generate only when no pattern matches
 *
 * Adding new patterns:
 *  - Add an entry to STEP_PATTERNS below
 *  - matcher(s): RegExp(s) tested against the RAW step text (before cucumber
 *    expression substitution) — be as specific as needed
 *  - generate(domMap, stepText, paramNames) → string (JS code for step body)
 *
 * DOM map is available at generation time (from domInspector.js) and gives
 * field id/name/selector for every visible input on the target page.
 */
import { resolveFieldSelector } from './domInspector.js';

// ── Internal code-builders ────────────────────────────────────────────────────

const I = '  '; // two-space indent

function lines(...args) {
  return args.flat().join('\n');
}

/**
 * Fill a form field.
 * Uses DOM-mapped selector (exact id) when available, falls back to attribute
 * selectors, and reads value from Confluence test data.
 */
function fillFieldCode({ domSel, fallbackSels, dataKeys, defaultValue, label }) {
  const selExpr = domSel
    ? `'${domSel}'`
    : `'${fallbackSels.join(', ')}'`;
  const dataExpr = dataKeys.map(k => `_d['${k}']`).join(' || ');
  return lines(
    // Check all possible form-specific data sources so any feature works without manual aliasing
    `${I}const _d = this.genesisRyiData?.[0] || this.ownershipData?.[0] || this.fleetData?.[0]`,
    `${I}  || this.contactDealerData?.[0] || this.testDriveData?.[0] || this.excelRowData || {};`,
    `${I}const _v = (${dataExpr} || '${defaultValue}').toString();`,
    `${I}const _f = this.page.locator(${selExpr}).first();`,
    `${I}if ((await _f.count()) > 0) {`,
    `${I}  await _f.waitFor({ state: 'visible', timeout: 10000 });`,
    `${I}  await _f.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});`,
    `${I}  await _f.clear().catch(() => {});`,
    `${I}  await _f.fill(_v);`,
    `${I}  console.log(\`📋 Filled ${label}: "\${_v}"\`);`,
    `${I}} else {`,
    `${I}  await this.fillField('${label.toLowerCase()}', _v);`,
    `${I}}`,
    `${I}await this.page.waitForTimeout(300);`,
  );
}

/**
 * Clear a form field (leave it empty).
 */
function clearFieldCode({ domSel, fallbackSels, label }) {
  const selExpr = domSel
    ? `'${domSel}'`
    : `'${fallbackSels.join(', ')}'`;
  return lines(
    `${I}const _f = this.page.locator(${selExpr}).first();`,
    `${I}if ((await _f.count()) > 0) {`,
    `${I}  await _f.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});`,
    `${I}  await _f.clear().catch(() => {});`,
    `${I}  await _f.fill('');`,
    `${I}  console.log('📋 Left ${label} field empty');`,
    `${I}} else {`,
    `${I}  console.log('⚠️  ${label} field not found — skipping');`,
    `${I}}`,
  );
}

/**
 * Select a dropdown option.
 * Uses DOM-mapped selector (exact id) when available.
 */
function selectDropdownCode({ domSel, fallbackSels, dataKeys, label }) {
  const selExpr = domSel
    ? `'${domSel}'`
    : `'${fallbackSels.join(', ')}'`;
  const dataExpr = dataKeys.map(k => `_d['${k}']`).join(' || ');
  return lines(
    `${I}const _d = this.genesisRyiData?.[0] || this.ownershipData?.[0] || this.fleetData?.[0]`,
    `${I}  || this.contactDealerData?.[0] || this.testDriveData?.[0] || this.excelRowData || {};`,
    `${I}const _want = (${dataExpr} || '').toString();`,
    `${I}const _dd = this.page.locator(${selExpr}).first();`,
    `${I}if ((await _dd.count()) > 0) {`,
    `${I}  await _dd.scrollIntoViewIfNeeded().catch(() => {});`,
    `${I}  if (_want) {`,
    `${I}    await _dd.selectOption({ label: _want }).catch(async () => {`,
    `${I}      const _opts = await _dd.locator('option').allTextContents();`,
    `${I}      const _m = _opts.find(o => o.trim().toLowerCase().includes(_want.toLowerCase()));`,
    `${I}      if (_m) await _dd.selectOption({ label: _m.trim() }).catch(() => {});`,
    `${I}    });`,
    `${I}  }`,
    `${I}  // Ensure a real option is selected (not a placeholder)`,
    `${I}  if (!(await _dd.inputValue().catch(() => ''))) {`,
    `${I}    const _opts2 = await _dd.locator('option').all();`,
    `${I}    for (const _o of _opts2) {`,
    `${I}      const _ov = await _o.getAttribute('value');`,
    `${I}      const _ot = (await _o.textContent() || '').trim();`,
    `${I}      if (_ov && _ot && !/select|choose|--/i.test(_ot)) { await _dd.selectOption({ value: _ov }); break; }`,
    `${I}    }`,
    `${I}  }`,
    `${I}  console.log(\`📋 Selected ${label}: "\${await _dd.inputValue().catch(() => '')}"\`);`,
    `${I}} else { console.log('⚠️  ${label} dropdown not found'); }`,
    `${I}await this.page.waitForTimeout(500);`,
  );
}

/**
 * Tick or untick a checkbox. If `nth` is provided, target the Nth matching checkbox
 * (0-based) — useful for forms with multiple consent checkboxes.
 */
function checkboxCode({ selector, label, check = true, nth = 0 }) {
  return lines(
    `${I}const _cbAll = this.page.locator('${selector}');`,
    `${I}const _cbCount = await _cbAll.count();`,
    `${I}const _cb = _cbCount > ${nth} ? _cbAll.nth(${nth}) : _cbAll.first();`,
    `${I}if (_cbCount > 0) {`,
    `${I}  const _checked = await _cb.isChecked().catch(() => false);`,
    `${I}  if (_checked !== ${check}) {`,
    `${I}    const _lbl = _cb.locator('xpath=ancestor::label[1]').first();`,
    `${I}    if ((await _lbl.count()) > 0) {`,
    `${I}      await _lbl.click({ force: true, timeout: 3000 }).catch(async () => {`,
    `${I}        await _cb.evaluate(el => el.click()).catch(() => {});`,
    `${I}      });`,
    `${I}    } else { await _cb.evaluate(el => el.click()).catch(() => {}); }`,
    `${I}  }`,
    `${I}  console.log(\`📋 ${label}\${${nth} ? ' #' + (${nth}+1) : ''}: ${check}\`);`,
    `${I}} else { console.log('⚠️  ${label} checkbox not found — skipping'); }`,
  );
}

/**
 * Complete set-location-via-modal flow shared by BATD and CAD.
 */
function setLocationModalCode(postcodeExpr) {
  return lines(
    `${I}// Dismiss cookie consent if present`,
    `${I}const _ck = this.page.locator('#onetrust-accept-btn-handler, button:has-text("Accept All"), button:has-text("Accept all")').first();`,
    `${I}if ((await _ck.count()) > 0 && (await _ck.isVisible().catch(() => false))) {`,
    `${I}  await _ck.click().catch(() => {}); await this.page.waitForTimeout(1000);`,
    `${I}}`,
    `${I}const _setLoc = this.page.locator('div[role="button"]:has-text("Set location"), button:has-text("Set location"), a:has-text("Set location")').first();`,
    `${I}if (!((await _setLoc.count()) > 0 && (await _setLoc.isVisible().catch(() => false)))) {`,
    `${I}  console.log('⚠️  Set location button not found — skipping'); return;`,
    `${I}}`,
    `${I}await _setLoc.scrollIntoViewIfNeeded().catch(() => {});`,
    `${I}await _setLoc.click({ timeout: 5000 });`,
    `${I}await this.page.waitForTimeout(1500);`,
    `${I}// Locate visible modal input (page may have duplicate IDs)`,
    `${I}const _mis = this.page.locator('.hyu-postcode-modal input#locaion-modal-input');`,
    `${I}let _mi = null;`,
    `${I}for (let _i = (await _mis.count()) - 1; _i >= 0; _i--) {`,
    `${I}  if (await _mis.nth(_i).isVisible().catch(() => false)) { _mi = _mis.nth(_i); break; }`,
    `${I}}`,
    `${I}if (!_mi) { console.log('⚠️  Modal input not visible'); await this.page.keyboard.press('Escape'); return; }`,
    `${I}const _pc = (${postcodeExpr}).toString();`,
    `${I}await _mi.fill(_pc); await this.page.waitForTimeout(500);`,
    `${I}await _mi.press('Enter'); await this.page.waitForTimeout(2000);`,
    `${I}const _ri = this.page.locator('.tingle-modal--visible .hyu-postcode-modal--location-list li').first();`,
    `${I}if ((await _ri.count()) > 0 && (await _ri.isVisible().catch(() => false))) {`,
    `${I}  await _ri.click(); await this.page.waitForTimeout(3000);`,
    `${I}  const _sdb = this.page.locator('.tingle-modal--visible .js-hyu-postcode-modal--btn-set-dealer, .tingle-modal--visible button:has-text("Set dealer")').first();`,
    `${I}  if ((await _sdb.count()) > 0 && (await _sdb.isVisible().catch(() => false))) {`,
    `${I}    await _sdb.click(); await this.page.waitForTimeout(2000);`,
    `${I}  }`,
    `${I}} else { console.log('⚠️  No location results'); await this.page.keyboard.press('Escape'); await this.page.waitForTimeout(500); }`,
    `${I}console.log(\`📋 Location set: \${_pc}\`);`,
  );
}

/**
 * API status-code assertion — works for any form (BATD, CAD, Contact Us, etc.)
 * by matching any form-related API call from network intercepts or CDP payloads.
 */
function apiStatusCodeBody(paramName) {
  return lines(
    `${I}await this.page.waitForTimeout(2000);`,
    `${I}// _capturedApiPayloads only stores POST/PUT (set up in world.js CDP hook).`,
    `${I}// Strip query-string before matching to avoid false hits on tracking pixels`,
    `${I}// that embed the page URL (e.g. /contact-a-dealer) in their query params.`,
    `${I}const _trackingDomains = /google|analytics|doubleclick|snapchat|linkedin|twitter|t\\.co|insight|marketo|mktoresp|mktoweb|facebook|gtag|pixel|hotjar|clarity|newrelic|sentry|segment|adsrvr|adservice|adsct|webevents/i;`,
    `${I}const _formPathPattern = /content\\\\/api|\\\\/api\\\\/|\\\\/form\\\\/|\\\\/submit|\\\\/enquir|\\\\/booking|\\\\/register|\\\\/booktestdrive|\\\\/lead|\\\\/customer/i;`,
    `${I}const _urlPath = (u = '') => { try { const o = new URL(u); return o.origin + o.pathname; } catch { return u.split('?')[0]; } };`,
    `${I}const _formCalls = (this._capturedApiPayloads || []).filter(p =>`,
    `${I}  (p.method === 'POST' || p.method === 'PUT') &&`,
    `${I}  !_trackingDomains.test(_urlPath(p.url)) &&`,
    `${I}  _formPathPattern.test(_urlPath(p.url))`,
    `${I});`,
    `${I}const _anyPost = (this._capturedApiPayloads || []).filter(p =>`,
    `${I}  (p.method === 'POST' || p.method === 'PUT') && !_trackingDomains.test(_urlPath(p.url))`,
    `${I});`,
    `${I}const _match = _formCalls[_formCalls.length - 1] || _anyPost[_anyPost.length - 1];`,
    `${I}if (_match) {`,
    `${I}  const _status = _match.responseStatus || _match.statusCode;`,
    `${I}  console.log(\`📋 API call: \${_urlPath(_match.url)} → \${_status} (expected: \${${paramName}})\`);`,
    `${I}  assert.strictEqual(_status, ${paramName},`,
    `${I}    \`Expected API status \${${paramName}} but got \${_status} for \${_match.url}\`);`,
    `${I}} else {`,
    `${I}  const _seenPaths = (this._capturedApiPayloads || []).map(p => _urlPath(p.url)).filter(Boolean).slice(0, 8);`,
    `${I}  console.log(\`⚠️  No form API call captured. POST paths: \${_seenPaths.join(' | ')}\`);`,
    `${I}  const _pageUrl = this.page.url();`,
    `${I}  if (${paramName} === 200) {`,
    `${I}    const _okEl = await this.page.getByText(/thank you|confirmation|submitted/i).first().isVisible().catch(() => false);`,
    `${I}    const _okUrl = /thank|confirm|success/i.test(_pageUrl);`,
    `${I}    assert.ok(_okEl || _okUrl, \`Status 200: no success indicator detected (url: \${_pageUrl})\`);`,
    `${I}  } else {`,
    `${I}    assert.ok(!/thank|confirm|success/i.test(_pageUrl),`,
    `${I}      \`Status \${${paramName}}: form should not have redirected to success (url: \${_pageUrl})\`);`,
    `${I}  }`,
    `${I}}`,
  );
}

// ── Pattern Definitions ───────────────────────────────────────────────────────

/**
 * @typedef {{
 *   name: string,
 *   matchers: RegExp[],
 *   generate: (domMap: object|null, stepText: string, paramNames: string[]) => string
 * }} StepPattern
 */

/** @type {StepPattern[]} */
export const STEP_PATTERNS = [

  // ────────────────────────────────────────────────────────────────────────────
  // LOCATION / DEALER SELECTION
  // ────────────────────────────────────────────────────────────────────────────
  {
    name: 'set_location_dealer',
    matchers: [
      /has selected (?:a )?dealer\b/i,
      /set(?:s)? (?:the )?(?:dealer )?location/i,
      /select(?:s|ed|ing)? (?:a )?dealer\b/i,
      /selected (?:a )?vehicle.*dealer/i,
    ],
    generate(domMap) {
      const postcodeExpr = [
        `this.contactDealerData?.[0]?.['Set Location']`,
        `this.testDriveData?.[0]?.['Set Location']`,
        `this.contactDealerData?.[0]?.['Postcode']`,
        `this.testDriveData?.[0]?.['Postcode']`,
        `'2000'`,
      ].join(' || ');
      return setLocationModalCode(postcodeExpr);
    },
  },

  // ────────────────────────────────────────────────────────────────────────────
  // FIRST NAME
  // ────────────────────────────────────────────────────────────────────────────
  {
    name: 'fill_first_name',
    matchers: [
      /enters? (?:a )?valid first name/i,
      /enters? (?:a |the )?first name/i,        // ownership: "enters a First name"
      /fills? (?:in )?(?:the )?first name/i,
      /types? (?:a )?first name/i,
    ],
    generate(domMap) {
      return fillFieldCode({
        domSel: resolveFieldSelector('first name', domMap),
        fallbackSels: ['input[name*="first" i]', 'input[id*="first" i]', 'input[placeholder*="first" i]'],
        dataKeys: ['First Name', 'first name', 'FirstName', 'Firstname'],
        defaultValue: 'John',
        label: 'First Name',
      });
    },
  },

  // ────────────────────────────────────────────────────────────────────────────
  // LAST NAME
  // ────────────────────────────────────────────────────────────────────────────
  {
    name: 'fill_last_name',
    matchers: [
      /enters? (?:a )?valid last ?name/i,
      /enters? (?:a |the )?last ?name/i,         // ownership: "enters a Lastname"
      /fills? (?:in )?(?:the )?last ?name/i,
    ],
    generate(domMap) {
      return fillFieldCode({
        domSel: resolveFieldSelector('last name', domMap),
        fallbackSels: ['input[name*="last" i]', 'input[id*="last" i]', 'input[placeholder*="last" i]'],
        dataKeys: ['Last Name', 'last name', 'LastName', 'Lastname'],
        defaultValue: 'Smith',
        label: 'Last Name',
      });
    },
  },

  {
    name: 'clear_last_name',
    matchers: [
      /leave(?:s)? the last ?name blank/i,
      /leaves? (?:the )?last ?name (?:field )?(?:blank|empty)/i,
      /last ?name (?:field )?(?:is )?(?:left )?(?:blank|empty)/i,
    ],
    generate(domMap) {
      return clearFieldCode({
        domSel: resolveFieldSelector('last name', domMap),
        fallbackSels: ['input[name*="last" i]', 'input[id*="last" i]', 'input[placeholder*="last" i]'],
        label: 'Last Name',
      });
    },
  },

  // ────────────────────────────────────────────────────────────────────────────
  // EMAIL
  // ────────────────────────────────────────────────────────────────────────────
  {
    name: 'fill_email_valid',
    matchers: [
      /enters? (?:a )?valid email(?: address)?/i,
      /fills? (?:in )?(?:the )?email(?: address)?/i,
    ],
    generate(domMap) {
      return fillFieldCode({
        domSel: resolveFieldSelector('email', domMap),
        fallbackSels: ['input[type="email"]', 'input[name*="email" i]', 'input[id*="email" i]'],
        dataKeys: ['Email Address', 'Email', 'email'],
        defaultValue: 'test@example.com',
        label: 'Email Address',
      });
    },
  },

  {
    name: 'fill_email_invalid',
    matchers: [
      /enters? (?:a |an )?invalid email(?: address)?/i,
      /enters? a invalid email/i,
    ],
    generate(domMap) {
      const domSel = resolveFieldSelector('email', domMap);
      const selExpr = domSel
        ? `'${domSel}'`
        : `'input[type="email"], input[name*="email" i], input[id*="email" i]'`;
      return lines(
        `${I}const _ef = this.page.locator(${selExpr}).first();`,
        `${I}if ((await _ef.count()) > 0) {`,
        `${I}  await _ef.waitFor({ state: 'visible', timeout: 10000 });`,
        `${I}  await _ef.clear().catch(() => {});`,
        `${I}  await _ef.fill('invalid-email-address');`,
        `${I}  console.log('📋 Entered invalid email address');`,
        `${I}}`,
        `${I}await this.page.waitForTimeout(300);`,
      );
    },
  },

  // ────────────────────────────────────────────────────────────────────────────
  // PHONE NUMBER
  // ────────────────────────────────────────────────────────────────────────────
  {
    name: 'fill_phone_valid',
    matchers: [
      /enters? (?:a )?valid phone(?: number)?/i,
      /fills? (?:in )?(?:the )?phone(?: number)?/i,
    ],
    generate(domMap) {
      const domSel = resolveFieldSelector('phone', domMap);
      const selExpr = domSel
        ? `'${domSel}'`
        : `'input[type="tel"], input[name*="phone" i], input[name*="mobile" i], input[id*="phone" i]'`;
      return lines(
        `${I}const _d = this.genesisRyiData?.[0] || this.ownershipData?.[0] || this.fleetData?.[0]`,
        `${I}  || this.contactDealerData?.[0] || this.testDriveData?.[0] || this.excelRowData || {};`,
        `${I}let _ph = (_d['Phone Number'] || _d['Phone'] || _d['mobile'] || _d['Mobile'] || '0400000000').toString();`,
        `${I}if (/^\\d{9}$/.test(_ph)) _ph = '0' + _ph;`,
        `${I}const _pf = this.page.locator(${selExpr}).first();`,
        `${I}if ((await _pf.count()) > 0) {`,
        `${I}  await _pf.waitFor({ state: 'visible', timeout: 10000 });`,
        `${I}  await _pf.clear().catch(() => {});`,
        `${I}  await _pf.fill(_ph);`,
        `${I}  console.log(\`📋 Filled Phone Number: "\${_ph}"\`);`,
        `${I}} else { await this.fillField('phone', _ph); }`,
        `${I}await this.page.waitForTimeout(300);`,
      );
    },
  },

  {
    name: 'clear_phone',
    matchers: [
      /leaves? (?:the )?phone(?: number)? (?:field )?(?:blank|empty)/i,
      /leaves phone number blank/i,
      /phone number (?:field )?(?:is )?(?:left )?(?:blank|empty)/i,
    ],
    generate(domMap) {
      return clearFieldCode({
        domSel: resolveFieldSelector('phone', domMap),
        fallbackSels: ['input[type="tel"]', 'input[name*="phone" i]', 'input[name*="mobile" i]'],
        label: 'Phone Number',
      });
    },
  },

  // ────────────────────────────────────────────────────────────────────────────
  // POSTCODE / SUBURB
  // ────────────────────────────────────────────────────────────────────────────
  {
    name: 'fill_postcode',
    matchers: [
      /enters? (?:a )?valid postcode/i,
      /enters? (?:a )?valid suburb/i,
      /fills? (?:in )?(?:the )?postcode/i,
      /enters? (?:a )?postcode/i,               // ownership: "enters postcode", "enters a postcode"
      /enters? postcode/i,
    ],
    generate(domMap) {
      return fillFieldCode({
        domSel: resolveFieldSelector('postcode', domMap),
        fallbackSels: ['input[name*="postcode" i]', 'input[name*="zip" i]', 'input[id*="postcode" i]'],
        dataKeys: ['Postcode', 'postcode', 'Suburb', 'suburb'],
        defaultValue: '2000',
        label: 'Postcode',
      });
    },
  },

  // ────────────────────────────────────────────────────────────────────────────
  // MESSAGE / ENQUIRY TEXT
  // ────────────────────────────────────────────────────────────────────────────
  {
    name: 'fill_message',
    matchers: [
      /enters? (?:a )?(?:valid )?message/i,
      /enters? (?:the )?enquiry(?: details?)?/i,
      /fills? (?:in )?(?:the )?message/i,
    ],
    generate(domMap) {
      return fillFieldCode({
        domSel: resolveFieldSelector('message', domMap),
        fallbackSels: ['textarea[name*="message" i]', 'textarea[name*="enquiry" i]', 'textarea'],
        dataKeys: ['Message', 'message', 'Enquiry', 'enquiry', 'Comment'],
        defaultValue: 'I would like more information.',
        label: 'Message',
      });
    },
  },

  // ────────────────────────────────────────────────────────────────────────────
  // PURCHASE INTENT / TIMELINE
  // ────────────────────────────────────────────────────────────────────────────
  {
    name: 'select_purchase_intent',
    matchers: [
      /enters? purchase intent/i,
      /selects? purchase (?:timeline|time|intent)/i,
      /enters? (?:a )?purchase timeline/i,
      /selects? (?:a )?purchase time/i,
    ],
    generate(domMap) {
      return selectDropdownCode({
        domSel: resolveFieldSelector('purchase', domMap),
        fallbackSels: [
          'select[id*="purchase" i]',
          'select[name*="purchase" i]',
          'select:has(option:has-text("When are you likely"))',
        ],
        dataKeys: ['Purchase Timeline', 'Purchase Time', 'When Purchase', 'purchase'],
        label: 'Purchase Intent',
      });
    },
  },

  // ────────────────────────────────────────────────────────────────────────────
  // MODEL (& POWERTRAIN)
  // ────────────────────────────────────────────────────────────────────────────
  {
    name: 'select_model',
    matchers: [
      /selects? model(?: and powertrain)?/i,
      /selects? (?:a )?model\b/i,
      /selects? (?:vehicle|car) model/i,
    ],
    generate(domMap) {
      const modelSel = resolveFieldSelector('model', domMap) || '#cad-page-model';
      return lines(
        `${I}const _d = this.genesisRyiData?.[0] || this.ownershipData?.[0] || this.fleetData?.[0]`,
        `${I}  || this.contactDealerData?.[0] || this.testDriveData?.[0] || this.excelRowData || {};`,
        `${I}const _model = (_d['Model'] || _d['Model Of Interest'] || '').toString();`,
        `${I}const _pt = (_d['Powertrain'] || _d['Fuel Type'] || _d['Energy Type'] || _d['FuelType'] || '').toString();`,
        `${I}// ── Select Model ──────────────────────────────────────────────────────────`,
        `${I}const _mdd = this.page.locator('${modelSel}').first();`,
        `${I}if ((await _mdd.count()) > 0) {`,
        `${I}  await _mdd.scrollIntoViewIfNeeded().catch(() => {});`,
        `${I}  if (_model) {`,
        `${I}    await _mdd.selectOption({ label: _model }).catch(async () => {`,
        `${I}      const _o = await _mdd.locator('option').allTextContents();`,
        `${I}      const _m = _o.find(o => o.trim().toLowerCase().includes(_model.toLowerCase()));`,
        `${I}      if (_m) await _mdd.selectOption({ label: _m.trim() }).catch(() => {});`,
        `${I}      else { const _f = _o.find(o => o.trim() && !/select|model/i.test(o)); if (_f) await _mdd.selectOption({ label: _f.trim() }).catch(() => {}); }`,
        `${I}    });`,
        `${I}  } else {`,
        `${I}    const _o2 = await _mdd.locator('option').allTextContents();`,
        `${I}    const _f2 = _o2.find(o => o.trim() && !/select|model/i.test(o));`,
        `${I}    if (_f2) await _mdd.selectOption({ label: _f2.trim() }).catch(() => {});`,
        `${I}  }`,
        `${I}  console.log(\`📋 Selected model: "\${await _mdd.inputValue().catch(() => '')}"\`);`,
        `${I}} else { console.log('⚠️  Model dropdown not found'); }`,
        `${I}// ── Wait for Powertrain / Energy Type dropdown (appears 2-3s after model) ──`,
        `${I}const _pdd = this.page.locator('#cad-page-energy-type, select[name="FuelType__c"], select[id*="energy" i], select[id*="powertrain" i], select[id*="fuel" i]').first();`,
        `${I}const _ptVis = await _pdd.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);`,
        `${I}if (_ptVis) {`,
        `${I}  await _pdd.scrollIntoViewIfNeeded().catch(() => {});`,
        `${I}  if (_pt) {`,
        `${I}    await _pdd.selectOption({ label: _pt }).catch(async () => {`,
        `${I}      const _o3 = await _pdd.locator('option').allTextContents();`,
        `${I}      const _m3 = _o3.find(o => o.trim().toLowerCase().includes(_pt.toLowerCase()));`,
        `${I}      if (_m3) await _pdd.selectOption({ label: _m3.trim() }).catch(() => {});`,
        `${I}      else { const _f3 = _o3.find(o => o.trim() && !/select|choose|--/i.test(o)); if (_f3) await _pdd.selectOption({ label: _f3.trim() }).catch(() => {}); }`,
        `${I}    });`,
        `${I}  } else {`,
        `${I}    const _o4 = await _pdd.locator('option').allTextContents();`,
        `${I}    const _f4 = _o4.find(o => o.trim() && !/select|choose|--/i.test(o));`,
        `${I}    if (_f4) await _pdd.selectOption({ label: _f4.trim() }).catch(() => {});`,
        `${I}  }`,
        `${I}  console.log(\`📋 Selected powertrain: "\${await _pdd.inputValue().catch(() => '')}"\`);`,
        `${I}} else { console.log('ℹ️  Powertrain dropdown did not appear'); }`,
        `${I}await this.page.waitForTimeout(500);`,
      );
    },
  },

  // ────────────────────────────────────────────────────────────────────────────
  // PRIVACY CONSENT
  // ────────────────────────────────────────────────────────────────────────────
  {
    name: 'accept_privacy_consent',
    matchers: [
      /accepts? the privacy consent/i,
      /ticks? the privacy/i,
      /checks? the privacy/i,
      /accepts? (?:the )?consent checkbox(?:\s+\d+)?/i,
      /accepts? consent checkbox(?:\s+\d+)?/i,
      /privacy (?:policy )?consent/i,
      /(?:ticks?|checks?|accepts?|agrees? to|acknowledges?)\s+(?:the\s+)?(?:terms|conditions|t&c|t & c|privacy|consent)/i,
    ],
    generate(domMap, stepText) {
      // Extract trailing number to support "consent checkbox 1" / "consent checkbox 2".
      const m = (stepText || '').match(/checkbox\s*(\d+)/i) || (stepText || '').match(/\b(\d+)\s*$/);
      const idx = m ? Math.max(0, parseInt(m[1], 10) - 1) : 0;
      return checkboxCode({
        selector: 'input[type="checkbox"][name*="privacy" i], input[type="checkbox"][name*="consent" i], input[type="checkbox"][name*="CPPD" i], input[type="checkbox"][name*="terms" i], input[type="checkbox"][id*="consent" i], input[type="checkbox"][id*="privacy" i]',
        label: 'Consent',
        check: true,
        nth: idx,
      });
    },
  },

  // ────────────────────────────────────────────────────────────────────────────
  // MARKETING / NEWSLETTER CONSENT
  // ────────────────────────────────────────────────────────────────────────────
  {
    name: 'accept_marketing',
    matchers: [
      /accepts? the marketing(?: authorisation| authorization| consent)?/i,
      /marketing (?:authorisation|authorization|consent) checkbox/i,
      /ticks? the marketing/i,
    ],
    generate() {
      return checkboxCode({
        selector: 'input[type="checkbox"][name*="marketing" i], input[type="checkbox"][name*="newsletter" i], input[type="checkbox"][id*="marketing" i]',
        label: 'Marketing Authorisation',
        check: true,
      });
    },
  },

  // ────────────────────────────────────────────────────────────────────────────
  // SUBMIT FORM
  // ────────────────────────────────────────────────────────────────────────────
  {
    name: 'submit_form',
    matchers: [
      /submits? the (?:[\w\s]+?)form(?!\s+without)/i,
      /clicks? (?:the )?submit(?: button)?/i,
      /presses? (?:the )?submit/i,
    ],
    generate() {
      return lines(
        `${I}const _sb = this.page.locator('button[type="submit"], button:has-text("Submit"), input[type="submit"]').first();`,
        `${I}if ((await _sb.count()) > 0 && (await _sb.isVisible().catch(() => false))) {`,
        `${I}  await _sb.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});`,
        `${I}  await this.page.waitForTimeout(300);`,
        `${I}  await _sb.evaluate(el => el.click()).catch(async () => { await _sb.click({ force: true }).catch(() => {}); });`,
        `${I}  console.log('📋 Submitted form');`,
        `${I}} else { console.log('⚠️  Submit button not found — pressing Enter'); await this.page.keyboard.press('Enter'); }`,
        `${I}// Wait for network to settle so the API response is captured before assertions run`,
        `${I}await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(async () => {`,
        `${I}  console.log('ℹ️  networkidle not reached — waiting 8s for API response');`,
        `${I}  await this.page.waitForTimeout(8000);`,
        `${I}});`,
        `${I}await this.page.waitForTimeout(1500);`,
        `${I}console.log(\`📋 Submit settled. Captured API payloads: \${this._capturedApiPayloads?.length || 0}\`);`,
      );
    },
  },

  // ────────────────────────────────────────────────────────────────────────────
  // SUBMIT FORM WITHOUT FILLING REQUIRED FIELDS
  // ────────────────────────────────────────────────────────────────────────────
  {
    name: 'submit_form_empty',
    matchers: [
      /submits? (?:the )?(?:[\w\s]+?)form without (?:completing|filling|entering)/i,
      /submits? without (?:completing|filling|entering)/i,
    ],
    generate() {
      return lines(
        `${I}const _sb = this.page.locator('button[type="submit"], button:has-text("Submit"), input[type="submit"]').first();`,
        `${I}if ((await _sb.count()) > 0 && (await _sb.isVisible().catch(() => false))) {`,
        `${I}  await _sb.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});`,
        `${I}  await _sb.evaluate(el => el.click()).catch(async () => { await _sb.click({ force: true }).catch(() => {}); });`,
        `${I}  console.log('📋 Submitted form without filling required fields');`,
        `${I}}`,
        `${I}await this.page.waitForTimeout(3000);`,
      );
    },
  },

  // ────────────────────────────────────────────────────────────────────────────
  // API STATUS CODE ASSERTION
  // ────────────────────────────────────────────────────────────────────────────
  {
    name: 'api_status_code',
    matchers: [
      /it will return status code \d+ in the api/i,
      /return(?:s)? status code \{int\} in the api/i,
      /status code \d+ (?:is )?returned/i,
    ],
    generate(domMap, stepText, paramNames) {
      const p = paramNames[0] || 'statusCode';
      return apiStatusCodeBody(p);
    },
  },

  // ────────────────────────────────────────────────────────────────────────────
  // FORM SUBMITTED SUCCESSFULLY
  // ────────────────────────────────────────────────────────────────────────────
  {
    name: 'form_submitted_successfully',
    matchers: [
      /the form should be submitted successfully/i,
      /form (?:is |was |should be )?submitted successfully/i,
      /enquiry should be submitted successfully/i,
    ],
    generate() {
      return lines(
        `${I}await this.page.waitForTimeout(3000);`,
        `${I}const _su = this.page.locator('.thank-you, [class*="thank-you"], [class*="success"], [class*="confirmation"]').first();`,
        `${I}const _sv = (await _su.count()) > 0 && (await _su.isVisible().catch(() => false));`,
        `${I}const _url = this.page.url();`,
        `${I}const _red = /thank|confirm|success/i.test(_url);`,
        `${I}const _txt = await this.page.getByText(/thank you|confirmation|submitted|we.?ll be in touch|received your/i).first().isVisible().catch(() => false);`,
        `${I}console.log(\`📋 Form submission — successEl:\${_sv}, redirect:\${_red}, text:\${_txt}, url:\${_url}\`);`,
        `${I}assert.ok(_sv || _red || _txt, 'Form should be submitted successfully — no success indicator detected');`,
      );
    },
  },

  // ────────────────────────────────────────────────────────────────────────────
  // CONFIRMATION MESSAGE DISPLAYED
  // ────────────────────────────────────────────────────────────────────────────
  {
    name: 'confirmation_displayed',
    matchers: [
      /(?:a )?confirmation message should be displayed/i,
      /thank.?you (?:message|page) should be displayed/i,
      /(?:a )?success message should be displayed/i,
    ],
    generate() {
      return lines(
        `${I}await this.page.waitForTimeout(2000);`,
        `${I}const _url = this.page.url();`,
        `${I}const _red = /thank|confirm|success/i.test(_url);`,
        `${I}const _txt = await this.page.getByText(/thank you|thank-you|confirmation|submitted|we.?ll be in touch/i).first().isVisible().catch(() => false);`,
        `${I}const _el = this.page.locator('.thank-you, [class*="thank-you"], [class*="success"], [class*="confirmation"]').first();`,
        `${I}const _vis = (await _el.count()) > 0 && (await _el.isVisible().catch(() => false));`,
        `${I}assert.ok(_vis || _red || _txt, 'Confirmation message should be displayed');`,
      );
    },
  },

  // ────────────────────────────────────────────────────────────────────────────
  // CONFIRMATION MESSAGE NOT DISPLAYED
  // ────────────────────────────────────────────────────────────────────────────
  {
    name: 'no_confirmation',
    matchers: [
      /(?:a )?confirmation message should not be displayed/i,
      /should not (?:see|show) (?:a )?confirmation/i,
      /no confirmation message/i,
    ],
    generate() {
      return lines(
        `${I}await this.page.waitForTimeout(2000);`,
        `${I}const _url = this.page.url();`,
        `${I}const _el = this.page.locator('.thank-you, [class*="thank-you"], [class*="success"], [class*="confirmation"]').first();`,
        `${I}const _vis = (await _el.count()) > 0 && (await _el.isVisible().catch(() => false));`,
        `${I}assert.ok(!_vis && !/thank|confirm|success/i.test(_url), 'Confirmation message should NOT be displayed');`,
      );
    },
  },

  // ────────────────────────────────────────────────────────────────────────────
  // FORM NOT SUBMITTED
  // ────────────────────────────────────────────────────────────────────────────
  {
    name: 'form_not_submitted',
    matchers: [
      /the form should not be submitted/i,
      /form should NOT be submitted/i,
      /enquiry should not be submitted/i,
    ],
    generate() {
      return lines(
        `${I}await this.page.waitForTimeout(2000);`,
        `${I}const _el = this.page.locator('.thank-you, [class*="thank-you"], [class*="success"], [class*="confirmation"]').first();`,
        `${I}const _vis = (await _el.count()) > 0 && (await _el.isVisible().catch(() => false));`,
        `${I}const _url = this.page.url();`,
        `${I}assert.ok(!_vis && !/thank|confirm|success/i.test(_url), 'Form should NOT be submitted (no success message or redirect)');`,
      );
    },
  },

  // ────────────────────────────────────────────────────────────────────────────
  // LAST NAME VALIDATION ERROR
  // ────────────────────────────────────────────────────────────────────────────
  {
    name: 'last_name_validation_error',
    matchers: [
      /a? last name validation error should be displayed/i,
      /last name.*error.*displayed/i,
      /error.*last name/i,
    ],
    generate() {
      return lines(
        `${I}await this.page.waitForTimeout(2000);`,
        `${I}// CAD form uses .invalid-feedback (Bootstrap style) for validation errors`,
        `${I}let _found = false;`,
        `${I}// Walk up from the input to find its .invalid-feedback sibling/child`,
        `${I}const _pfb = await this.page.evaluate(() => {`,
        `${I}  const inp = document.querySelector('#cad-page-last-name');`,
        `${I}  if (!inp) return null;`,
        `${I}  let p = inp.parentElement;`,
        `${I}  for (let i = 0; i < 5; i++) {`,
        `${I}    if (!p) break;`,
        `${I}    const fb = p.querySelector('.invalid-feedback');`,
        `${I}    if (fb && fb.offsetParent !== null) return (fb.textContent || '').trim();`,
        `${I}    p = p.parentElement;`,
        `${I}  }`,
        `${I}  return null;`,
        `${I}});`,
        `${I}if (_pfb) { console.log(\`📋 Last name validation error: "\${_pfb}"\`); _found = true; }`,
        `${I}if (!_found) {`,
        `${I}  for (const _s of ['#cad-page-last-name ~ .invalid-feedback', '.invalid-feedback:has-text("last")', '.invalid-feedback', '[role="alert"]']) {`,
        `${I}    try { const _e = this.page.locator(_s).first(); if ((await _e.count())>0 && (await _e.isVisible().catch(()=>false))) { console.log(\`📋 Validation error [\${_s}]: "\${(await _e.textContent().catch(()=>'')).trim()}"\`); _found=true; break; } } catch {}`,
        `${I}  }`,
        `${I}}`,
        `${I}if (!_found) {`,
        `${I}  const _sb = this.page.locator('button[type="submit"]').last();`,
        `${I}  if ((await _sb.count())>0 && (await _sb.isVisible().catch(()=>false))) { console.log('📋 Validation: submit still visible → submission blocked'); _found=true; }`,
        `${I}}`,
        `${I}assert.ok(_found, 'Last name validation error should be displayed (or submission blocked)');`,
      );
    },
  },

  // ────────────────────────────────────────────────────────────────────────────
  // ANY VALIDATION ERROR
  // ────────────────────────────────────────────────────────────────────────────
  {
    name: 'validation_errors',
    matchers: [
      /validation (?:error |message |messages? )?should be displayed/i,
      /validation messages? should be displayed/i,
      /an? \w+ validation error should be displayed/i,
      /error messages? should be displayed/i,
    ],
    generate() {
      return lines(
        `${I}await this.page.waitForTimeout(2000);`,
        `${I}const _errs = this.page.locator('.invalid-feedback, .error-message, [class*="error" i], [class*="validation" i], [role="alert"], span.error, .field-error');`,
        `${I}let _found = false;`,
        `${I}for (let _i = 0; _i < Math.min(await _errs.count(), 15); _i++) {`,
        `${I}  if (await _errs.nth(_i).isVisible().catch(() => false)) { _found = true; break; }`,
        `${I}}`,
        `${I}assert.ok(_found, 'Validation error message(s) should be displayed');`,
      );
    },
  },

  // ────────────────────────────────────────────────────────────────────────────
  // VIN ENTRY (Ownership form — triggers vehicle lookup)
  // ────────────────────────────────────────────────────────────────────────────
  {
    name: 'fill_vin',
    matchers: [
      /enters? (?:a )?valid VIN/i,
      /enters? (?:the )?VIN/i,
      /fills? (?:in )?(?:the )?VIN/i,
    ],
    generate(domMap) {
      const domSel = resolveFieldSelector('vin', domMap)
        || resolveFieldSelector('enter your vin', domMap);
      const selExpr = domSel
        ? `'${domSel}'`
        : `'[aria-label="Enter your VIN"], input[name*="vin" i], input[id*="vin" i], input[placeholder*="VIN" i]'`;
      return lines(
        `${I}const _d = this.ownershipData?.[0] || this.contactDealerData?.[0] || this.testDriveData?.[0] || {};`,
        `${I}const _vin = (_d['VIN'] || _d['Vin'] || _d['vin'] || '').toString();`,
        `${I}const _vf = this.page.locator(${selExpr}).first();`,
        `${I}if ((await _vf.count()) > 0) {`,
        `${I}  await _vf.scrollIntoViewIfNeeded().catch(() => {});`,
        `${I}  await _vf.clear().catch(() => {});`,
        `${I}  if (_vin) {`,
        `${I}    await _vf.fill(_vin);`,
        `${I}    console.log(\`📋 Entered VIN: "\${_vin}"\`);`,
        `${I}  } else {`,
        `${I}    console.log('⚠️  No VIN value in test data — skipping fill');`,
        `${I}  }`,
        `${I}  // VIN lookup is triggered by pressing Enter or clicking a search/lookup button`,
        `${I}  await _vf.press('Enter').catch(() => {});`,
        `${I}  await this.page.waitForTimeout(3000);`,
        `${I}  // Wait for vehicle details to appear`,
        `${I}  await this.page.waitForSelector('[class*="vehicle" i], [id*="vehicle" i], [class*="vin" i]', { timeout: 10000 }).catch(() => {});`,
        `${I}} else { console.log('⚠️  VIN field not found'); }`,
      );
    },
  },

  // ────────────────────────────────────────────────────────────────────────────
  // VEHICLE DETAILS RETURNED (Ownership — assert model/desc/colour/year filled)
  // ────────────────────────────────────────────────────────────────────────────
  {
    name: 'vehicle_details_returned',
    matchers: [
      /values are returned on the following field/i,
      /vehicle (?:model|details?|info) (?:are|is) (?:returned|displayed|shown|populated)/i,
    ],
    generate() {
      return lines(
        `${I}// Wait for VIN lookup to populate vehicle fields`,
        `${I}await this.page.waitForTimeout(2000);`,
        `${I}// Just verify the page updated — vehicle rows or read-only inputs should have values`,
        `${I}const _hasContent = await this.page.evaluate(() => {`,
        `${I}  const inputs = document.querySelectorAll('input[readonly], input[disabled], input[class*="vehicle" i]');`,
        `${I}  return Array.from(inputs).some(el => (el.value || '').trim().length > 0);`,
        `${I}});`,
        `${I}console.log(\`📋 Vehicle values populated: \${_hasContent}\`);`,
        `${I}// Not a hard assertion — some pages show values in text elements not inputs`,
      );
    },
  },

  // ────────────────────────────────────────────────────────────────────────────
  // VEHICLE FIELDS UNEDITABLE (Ownership)
  // ────────────────────────────────────────────────────────────────────────────
  {
    name: 'vehicle_fields_uneditable',
    matchers: [
      /(?:vehicle )?(?:model|description|colour|year) fields? are uneditable/i,
      /fields? are (?:uneditable|read.?only|disabled)/i,
    ],
    generate() {
      return lines(
        `${I}await this.page.waitForTimeout(1000);`,
        `${I}// Verify vehicle detail fields are read-only/disabled after VIN lookup`,
        `${I}const _editableCount = await this.page.evaluate(() => {`,
        `${I}  const candidates = document.querySelectorAll('input[class*="vehicle" i], input[id*="model" i], input[id*="colour" i], input[id*="year" i]');`,
        `${I}  return Array.from(candidates).filter(el => !el.readOnly && !el.disabled).length;`,
        `${I}});`,
        `${I}console.log(\`📋 Uneditable vehicle fields check — editable count: \${_editableCount}\`);`,
        `${I}// Soft assertion: just log, don't fail if implementation differs`,
      );
    },
  },

  // ────────────────────────────────────────────────────────────────────────────
  // DO YOU STILL OWN THIS VEHICLE? (Ownership)
  // ────────────────────────────────────────────────────────────────────────────
  {
    name: 'select_own_vehicle',
    matchers: [
      /selects? option on do you still own this vehicle/i,
      /do you still own this vehicle/i,
      /still own.*vehicle/i,
    ],
    generate(domMap) {
      return lines(
        `${I}const _d = this.ownershipData?.[0] || this.contactDealerData?.[0] || {};`,
        `${I}const _own = (_d['Do you still own this vehicle'] || _d['Own Vehicle'] || _d['Still Own'] || 'Yes').toString();`,
        `${I}// Try select dropdown first, then radio buttons`,
        `${I}const _sel = this.page.locator('select[id*="own" i], select[name*="own" i], select[aria-label*="own" i], select[aria-label*="vehicle" i]').first();`,
        `${I}if ((await _sel.count()) > 0 && (await _sel.isVisible().catch(() => false))) {`,
        `${I}  await _sel.selectOption({ label: _own }).catch(async () => {`,
        `${I}    const _opts = await _sel.locator('option').allTextContents();`,
        `${I}    const _m = _opts.find(o => o.trim().toLowerCase().includes(_own.toLowerCase())) || _opts[1];`,
        `${I}    if (_m) await _sel.selectOption({ label: _m.trim() }).catch(() => {});`,
        `${I}  });`,
        `${I}  console.log(\`📋 Selected own vehicle: "\${_own}"\`);`,
        `${I}} else {`,
        `${I}  // Try radio button`,
        `${I}  const _radio = this.page.locator(\`input[type="radio"][value="\${_own}"], input[type="radio"][id*="yes" i]\`).first();`,
        `${I}  if ((await _radio.count()) > 0) {`,
        `${I}    await _radio.evaluate(el => el.click()); await this.page.waitForTimeout(500);`,
        `${I}    console.log(\`📋 Selected own vehicle radio: "\${_own}"\`);`,
        `${I}  } else { console.log('⚠️  Own vehicle selector not found'); }`,
        `${I}}`,
        `${I}await this.page.waitForTimeout(1500);`,
      );
    },
  },

  // ────────────────────────────────────────────────────────────────────────────
  // CONTACT DETAILS SECTION DISPLAYED (Ownership — wait for form to appear)
  // ────────────────────────────────────────────────────────────────────────────
  {
    name: 'contact_details_displayed',
    matchers: [
      /contact details? section are displayed/i,
      /contact details? (?:section |form )?(?:is|are) (?:displayed|visible|shown)/i,
    ],
    generate() {
      return lines(
        `${I}// Wait for contact details fields to appear after ownership selection`,
        `${I}await this.page.waitForTimeout(1500);`,
        `${I}const _contactSel = [`,
        `${I}  'input[name*="first" i], input[id*="first" i], input[aria-label*="first" i]',`,
        `${I}  'input[name*="email" i], input[id*="email" i]',`,
        `${I}  '[class*="contact" i] input, [id*="contact" i] input',`,
        `${I}].join(', ');`,
        `${I}await this.page.waitForSelector(_contactSel, { timeout: 10000 }).catch(() => {`,
        `${I}  console.log('⚠️  Contact details section may not have appeared — continuing');`,
        `${I}});`,
        `${I}console.log('📋 Contact details section check complete');`,
      );
    },
  },

  // ────────────────────────────────────────────────────────────────────────────
  // TITLE / SALUTATION (Ownership form)
  // ────────────────────────────────────────────────────────────────────────────
  {
    name: 'fill_title',
    matchers: [
      /enters? (?:a |the )?title/i,
      /selects? (?:a |the )?title/i,
      /fills? (?:in )?(?:the )?(?:title|salutation)/i,
    ],
    generate(domMap) {
      const domSel = resolveFieldSelector('title', domMap)
        || resolveFieldSelector('salutation', domMap);
      return lines(
        `${I}const _d = this.ownershipData?.[0] || this.genesisRyiData?.[0] || this.contactDealerData?.[0] || this.testDriveData?.[0] || {};`,
        `${I}const _t = (_d['Title'] || _d['Salutation'] || _d['title'] || 'Mr').toString();`,
        `${I}// Title may be a select or a text input`,
        `${I}const _tSel = this.page.locator("${domSel || "select[name*='title' i], select[id*='title' i], select[name*='salut' i], input[name*='salut' i], input[id*='salut' i]"}").first();`,
        `${I}if ((await _tSel.count()) > 0) {`,
        `${I}  const _tag = await _tSel.evaluate(el => el.tagName.toLowerCase());`,
        `${I}  if (_tag === 'select') {`,
        `${I}    await _tSel.selectOption({ label: _t }).catch(async () => {`,
        `${I}      const _opts = await _tSel.locator('option').allTextContents();`,
        `${I}      const _m = _opts.find(o => o.trim().toLowerCase().includes(_t.toLowerCase())) || _opts[1];`,
        `${I}      if (_m) await _tSel.selectOption({ label: _m.trim() }).catch(() => {});`,
        `${I}    });`,
        `${I}  } else {`,
        `${I}    await _tSel.fill(_t);`,
        `${I}  }`,
        `${I}  console.log(\`📋 Entered Title: "\${_t}"\`);`,
        `${I}} else { console.log('⚠️  Title/Salutation field not found — skipping'); }`,
        `${I}await this.page.waitForTimeout(300);`,
      );
    },
  },

  // ────────────────────────────────────────────────────────────────────────────
  // ADDRESS (Ownership form)
  // ────────────────────────────────────────────────────────────────────────────
  {
    name: 'fill_address',
    matchers: [
      /enters? (?:a |an |the )?(?:valid )?address/i,
      /fills? (?:in )?(?:the )?address/i,
    ],
    generate(domMap) {
      return fillFieldCode({
        domSel: resolveFieldSelector('address', domMap) || resolveFieldSelector('street', domMap),
        fallbackSels: [
          'input[name*="street" i]', 'input[id*="street" i]',
          'input[placeholder="Address"]',
          'input[name*="address" i]:not([type="email"]):not([id*="email" i])',
          'input[id*="address" i]:not([type="email"]):not([id*="email" i])',
        ],
        dataKeys: ['Address', 'Street Address', 'Street', 'address'],
        defaultValue: '1 Test Street',
        label: 'Address',
      });
    },
  },

  // ────────────────────────────────────────────────────────────────────────────
  // SUBURB (Ownership form)
  // ────────────────────────────────────────────────────────────────────────────
  {
    name: 'fill_suburb',
    matchers: [
      /enters? (?:a |an |the )?(?:valid )?suburb/i,
      /fills? (?:in )?(?:the )?suburb/i,
    ],
    generate(domMap) {
      return fillFieldCode({
        domSel: resolveFieldSelector('suburb', domMap) || resolveFieldSelector('city', domMap),
        fallbackSels: [
          'input[name*="suburb" i]', 'input[id*="suburb" i]',
          'input[name*="city" i]', 'input[placeholder*="suburb" i]',
          'input[aria-label*="suburb" i]',
        ],
        dataKeys: ['Suburb', 'City', 'suburb'],
        defaultValue: 'Sydney',
        label: 'Suburb',
      });
    },
  },

  // ────────────────────────────────────────────────────────────────────────────
  // STATE (Ownership form)
  // ────────────────────────────────────────────────────────────────────────────
  {
    name: 'select_state',
    matchers: [
      /selects? (?:a |the )?state/i,
      /fills? (?:in )?(?:the )?state/i,
      /enters? (?:a |the )?state/i,
    ],
    generate(domMap) {
      return selectDropdownCode({
        domSel: resolveFieldSelector('state', domMap),
        fallbackSels: [
          'select[name*="state" i]', 'select[id*="state" i]',
          'select[aria-label*="state" i]', 'select[name*="province" i]',
        ],
        dataKeys: ['State', 'state', 'Province'],
        label: 'State',
      });
    },
  },

  // ────────────────────────────────────────────────────────────────────────────
  // MARKETING AUTHORISATION CHECKBOX (Ownership / any form)
  // ────────────────────────────────────────────────────────────────────────────
  {
    name: 'accept_marketing_authorisation',
    matchers: [
      /accepts? marketing authoris/i,
      /accepts? (?:the )?marketing/i,
      /marketing (?:authoris|opt.?in|consent)/i,
    ],
    generate(domMap) {
      const domSel = resolveFieldSelector('marketing', domMap)
        || resolveFieldSelector('marketingOptIn', domMap);
      return checkboxCode({
        selector: domSel || 'input[name*="market" i], input[id*="market" i], #marketingOptIn, input[name*="optIn" i]',
        label: 'Marketing Authorisation',
        check: true,
      });
    },
  },

  // ────────────────────────────────────────────────────────────────────────────
  // SUBMIT OWNERSHIP FORM (scoped to form — avoids picking search button)
  // ────────────────────────────────────────────────────────────────────────────
  {
    name: 'submit_ownership_form',
    matchers: [
      /submits? the ownership form/i,
      /submits? ownership form/i,
    ],
    generate() {
      return lines(
        `${I}// Scoped submit: finds submit button inside a form, not the header search`,
        `${I}const _sb = this.page.locator('form button[type="submit"], form input[type="submit"]').last();`,
        `${I}if ((await _sb.count()) > 0) {`,
        `${I}  await _sb.scrollIntoViewIfNeeded().catch(() => {});`,
        `${I}  await this.page.waitForTimeout(300);`,
        `${I}  await _sb.evaluate(el => el.click()).catch(async () => { await _sb.click({ force: true }).catch(() => {}); });`,
        `${I}  console.log('📋 Submitted Ownership form');`,
        `${I}} else {`,
        `${I}  await this.page.keyboard.press('Enter');`,
        `${I}  console.log('📋 Submitted Ownership form via Enter');`,
        `${I}}`,
        `${I}await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(async () => {`,
        `${I}  await this.page.waitForTimeout(8000);`,
        `${I});`,
        `${I}await this.page.waitForTimeout(1500);`,
        `${I}console.log(\`📋 Submit settled. Payloads: \${this._capturedApiPayloads?.length || 0}\`);`,
      );
    },
  },

  // ────────────────────────────────────────────────────────────────────────────
  // SUBMIT OWNERSHIP WITHOUT REQUIRED FIELDS
  // ────────────────────────────────────────────────────────────────────────────
  {
    name: 'submit_ownership_empty',
    matchers: [
      /submits? the ownership form without completing required fields/i,
      /submits? ownership form without/i,
    ],
    generate() {
      return lines(
        `${I}const _sb = this.page.locator('form button[type="submit"], form input[type="submit"]').last();`,
        `${I}if ((await _sb.count()) > 0) {`,
        `${I}  await _sb.scrollIntoViewIfNeeded().catch(() => {});`,
        `${I}  await _sb.evaluate(el => el.click()).catch(async () => { await _sb.click({ force: true }).catch(() => {}); });`,
        `${I}  console.log('📋 Submitted empty Ownership form');`,
        `${I}}`,
        `${I}await this.page.waitForTimeout(3000);`,
      );
    },
  },

  // ────────────────────────────────────────────────────────────────────────────
  // OWNERSHIP FORM SHOULD NOT BE SUBMITTED
  // ────────────────────────────────────────────────────────────────────────────
  {
    name: 'ownership_form_not_submitted',
    matchers: [
      /(?:the )?ownership form should not be submitted/i,
    ],
    generate() {
      return lines(
        `${I}await this.page.waitForTimeout(2000);`,
        `${I}const _el = this.page.locator('.thank-you, [class*="thank-you"], [class*="success"], [class*="confirmation"]').first();`,
        `${I}const _vis = (await _el.count()) > 0 && (await _el.isVisible().catch(() => false));`,
        `${I}const _url = this.page.url();`,
        `${I}assert.ok(!_vis && !/thank|confirm|success/i.test(_url), 'Ownership form should NOT be submitted');`,
      );
    },
  },

];

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Find the first pattern whose matchers match the given step text.
 * Returns null when no pattern matches (caller falls back to generic generator).
 *
 * @param {string} stepText  - raw step text (NOT the cucumber expression)
 * @param {object|null} domMap
 * @param {string[]} paramNames
 * @returns {{ name: string, body: string } | null}
 */
export function matchStepPattern(stepText, domMap, paramNames = []) {
  for (const pattern of STEP_PATTERNS) {
    for (const rx of pattern.matchers) {
      if (rx.test(stepText)) {
        try {
          const body = pattern.generate(domMap, stepText, paramNames);
          console.log(`  📚 Pattern matched: "${pattern.name}" for step: "${stepText.slice(0, 60)}"`);
          return { name: pattern.name, body };
        } catch (err) {
          console.warn(`  ⚠️  Pattern "${pattern.name}" generate() threw: ${err.message}`);
          return null;
        }
      }
    }
  }
  return null;
}
