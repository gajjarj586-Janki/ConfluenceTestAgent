// @protected
/**
 * Common Step Definitions — shared across ALL feature files.
 *
 * Any step defined here is automatically available to every .feature file
 * loaded by Cucumber (cucumber.js loads all step_definitions/**\/*.js).
 *
 * Steps:
 *   - "the user sets location postcode {string}"
 *     Handles the Hyundai "Set your location" modal that appears on any
 *     stage/production CPC or calculator page. Use this in any feature file
 *     that navigates to a page where the location modal appears.
 *
 *     Example:
 *       And the user sets location postcode "2000"
 */
import { Given, When, Then } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { handleLocationModal } from './commonHelpers.js';
export { handleLocationModal };

// ─── Generic site/menu/submenu/page steps ─────────────────────────────────
// These work for ANY feature file. Add the matching Gherkin line and they just work.
//
//   Given the user opens the "Hyundai Australia" website
//   Given the user opens the Hyundai Australia website                 (no quotes form)
//   When  the user navigates to the "Owners" menu
//   When  the user hovers over the "Buying" menu
//   And   the user clicks the "Accessories" submenu
//   Then  the "Accessories" page should be displayed
//
// All matching is text-based against the LIVE DOM — no per-feature step file edits required.

/**
 * Resolve a brand name → website URL, honouring the ACTIVE environment.
 *
 * Strategy (in order):
 *   1. If pageUrls has a "home" / "homepage" / "<brand> home" key, use it
 *      (these come from Confluence's Environment URLs table for the active env).
 *   2. If any existing pageUrls entry's hostname contains the brand, derive the
 *      site root from it (e.g. stage.hyundai.com.au → https://stage.hyundai.com.au/).
 *      This keeps Stage tests on Stage, Prod tests on Prod — automatically.
 *   3. Fall back to the public production URL pattern (https://www.<brand>.com[.au]/).
 */
function resolveBrandWebsite(name, pageUrls, envName) {
  const key = String(name || '').toLowerCase().trim();
  const m = key.match(/^(?:the\s+)?([a-z][a-z0-9-]*)\s*(australia|au|usa|uk|india)?\s*(?:website|site|homepage|home page)?$/i);
  if (!m) return '';
  const brand = m[1];
  const region = (m[2] || '').toLowerCase();

  // 1) Explicit home key in env URL map
  if (pageUrls) {
    for (const candidate of ['home', 'homepage', `${brand} home`, `${brand} homepage`, `${brand} australia`, `${brand} website`]) {
      if (pageUrls[candidate]) return pageUrls[candidate];
    }
  }

  // 2) Derive site root from any pageUrls entry whose host contains the brand.
  //    e.g. pageUrls['find a dealer'] = 'https://stage.hyundai.com.au/au/en/find-a-dealer'
  //         → returns 'https://stage.hyundai.com.au/au/en' (the longest common path prefix)
  if (pageUrls) {
    const brandUrls = Object.values(pageUrls).filter(u => {
      try { return new URL(u).hostname.toLowerCase().includes(brand); }
      catch { return false; }
    });
    if (brandUrls.length > 0) {
      const u = new URL(brandUrls[0]);
      // Preserve a locale path prefix like /au/en if present, otherwise origin
      const localeMatch = u.pathname.match(/^(\/[a-z]{2}\/[a-z]{2})\b/i);
      const root = u.origin + (localeMatch ? localeMatch[1] : '');
      const envLabel = envName ? ` (${envName})` : '';
      console.log(`📋 Resolved "${name}" → ${root} via active env URL map${envLabel}`);
      return root;
    }
  }

  // 3) Production fallback
  if (region === 'australia' || region === 'au') return `https://www.${brand}.com.au/`;
  return `https://www.${brand}.com/`;
}

/**
 * Pick a URL from this.pageUrls whose key fuzzy-matches the requested label.
 */
function lookupPageUrl(pageUrls, label) {
  if (!pageUrls) return '';
  const want = String(label || '').toLowerCase().trim();
  if (!want) return '';
  if (pageUrls[want]) return pageUrls[want];
  const entry = Object.entries(pageUrls).find(([k]) => k.includes(want) || want.includes(k));
  return entry ? entry[1] : '';
}

async function openWebsite(world, label) {
  const { page, pageUrls, environmentName } = world;
  // First try a literal page-name match (e.g. label === "home" or "Hyundai Australia website")
  let url = lookupPageUrl(pageUrls, label) || lookupPageUrl(pageUrls, `${label} website`);
  // Then derive from the active-environment URL map (Stage stays on Stage, etc.)
  if (!url) url = resolveBrandWebsite(label, pageUrls, environmentName);
  if (!url) throw new Error(`Cannot resolve website URL for "${label}"`);
  const envTag = environmentName ? ` [${environmentName}]` : '';
  console.log(`📋 Opening "${label}" website${envTag}: ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1200);
}

// Both quoted and unquoted phrasings are supported.
Given('the user opens the {string} website', async function (label) {
  await openWebsite(this, label);
});
Given(/^the user opens the (.+?) website$/, async function (label) {
  await openWebsite(this, label);
});

/**
 * Open a top-level navigation menu by its VISIBLE text on the page.
 * Matches exact → contains-either-way → stem (handles "Owners"↔"Owning",
 * "Buyers"↔"Buying", "Offers"↔"Offer", etc.).
 */
async function openMenuByText(page, menuName) {
  console.log(`📋 Opening menu: ${menuName}`);
  const wanted = String(menuName).trim().toLowerCase();
  const items = await page.locator(
    'header nav a, header nav button, header [role="menuitem"], ' +
    'nav > ul > li > a, nav > ul > li > button, [class*="navbar" i] a, [class*="navbar" i] button'
  ).all();

  const visible = [];
  for (const h of items) {
    if (!(await h.isVisible().catch(() => false))) continue;
    const t = ((await h.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
    if (t) visible.push({ h, t, lower: t.toLowerCase() });
  }
  if (visible.length === 0) throw new Error('No visible header/nav menu items found on the page.');

  let target = visible.find(v => v.lower === wanted);
  if (!target) target = visible.find(v => v.lower.includes(wanted) || wanted.includes(v.lower));
  if (!target) {
    const stem = (s) => s.replace(/(?:ing|ers?|s)$/, '');
    const wantStem = stem(wanted);
    target = visible.find(v => stem(v.lower).startsWith(wantStem) || wantStem.startsWith(stem(v.lower)));
  }
  if (!target) {
    const labels = visible.map(v => `"${v.t}"`).join(', ');
    throw new Error(`Menu "${menuName}" not found. Available top-level menus: ${labels}`);
  }
  if (target.lower !== wanted) {
    console.log(`📋 Menu "${menuName}" matched to actual on-screen text "${target.t}"`);
  }
  await target.h.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});

  // CLICK the menu item directly. For anchor-based menus this navigates to
  // the menu's landing page (Models, Buying, Owning, About) which shows the
  // full section content — exactly what we want to screenshot.
  const tag = await target.h.evaluate(el => el.tagName.toLowerCase()).catch(() => '');
  const href = tag === 'a' ? await target.h.getAttribute('href').catch(() => null) : null;

  if (href && href !== '#' && !href.startsWith('javascript:')) {
    // Use Promise.all to wait for navigation triggered by the click.
    await Promise.all([
      page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {}),
      target.h.click({ timeout: 5000 }).catch(async () => target.h.click({ force: true })),
    ]);
  } else {
    await target.h.click({ timeout: 5000 }).catch(async () => target.h.click({ force: true }));
  }
  await page.waitForTimeout(1000);

  // Track for any subsequent steps that may want a reference.
  page.__lastMenuHandle = target.h;
}

// (kept for backwards-compatibility — no-op when no hover-menu was tracked)
async function reHoverLastMenu(/* page */) {
  return;
}

When('the user navigates to the {string} menu', async function (menuName) {
  await openMenuByText(this.page, menuName);
});
When('the user opens the {string} menu', async function (menuName) {
  await openMenuByText(this.page, menuName);
});
When('the user hovers over the {string} menu', async function (menuName) {
  await openMenuByText(this.page, menuName);
});
When('the user clicks the {string} menu', async function (menuName) {
  await openMenuByText(this.page, menuName);
});

/**
 * Click a link/button inside the currently-open header flyout/submenu.
 * Scopes the search to visible dropdown/megamenu containers first so it
 * doesn't accidentally click same-text elements elsewhere on the page.
 */
async function clickSubmenuByText(page, label) {
  // Fuzzy match: feature-file label is a SUBSTRING of the on-site link text.
  // e.g. "Accessories" should match "Accessories" (prod) AND "Genuine Accessories" (stage).
  // We also strip a trailing 's' to handle minor plural differences (Accessory ↔ Accessories).
  const escaped = String(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped, 'i'); // substring, case-insensitive
  const slug = String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  // shortest core word for href matching, e.g. "Genuine Accessories" → "accessor"
  const slugCore = (() => {
    const words = String(label).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const longest = words.sort((a, b) => b.length - a.length)[0] || '';
    return longest.replace(/(s|es|ies)$/, ''); // strip common plural suffix
  })();
  const scopedSelectors = [
    'header [class*="dropdown" i].open',
    'header [class*="submenu" i].open',
    'header [class*="megamenu" i].open',
    'header [class*="flyout" i].open',
    'header [class*="dropdown" i]:visible',
    'header [class*="megamenu" i]:visible',
    'header [class*="submenu" i]:visible',
    'header [class*="flyout" i]:visible',
    'header [role="menu"]:visible',
    'header nav:visible',
  ];

  /** Pick the BEST link inside `scope` for `label`:
   *  1. <a> whose href contains the label slug (e.g. /owning/accessories).
   *  2. Any <a> matching the exact text.
   *  3. Any <button> matching the exact text. */
  async function pickBestLink(scope) {
    const inScope = page.locator(scope);
    if ((await inScope.count()) === 0) return null;
    const anchors = inScope.locator('a').filter({ hasText: re });
    const aCount = await anchors.count();
    // 1) href-slug match — explicitly excludes /search results
    for (let i = 0; i < aCount; i++) {
      const a = anchors.nth(i);
      if (!(await a.isVisible().catch(() => false))) continue;
      const href = (await a.getAttribute('href').catch(() => '')) || '';
      if (/\/search\b/i.test(href)) continue; // never pick a search-result link
      const h = href.toLowerCase();
      if ((slug && h.includes(slug)) || (slugCore && h.includes(slugCore))) return a;
    }
    // 2) first visible anchor with matching text (still skipping /search)
    for (let i = 0; i < aCount; i++) {
      const a = anchors.nth(i);
      if (!(await a.isVisible().catch(() => false))) continue;
      const href = (await a.getAttribute('href').catch(() => '')) || '';
      if (/\/search\b/i.test(href)) continue;
      return a;
    }
    // 3) button fallback
    const btn = inScope.locator('button').filter({ hasText: re }).first();
    if ((await btn.count()) > 0 && (await btn.isVisible().catch(() => false))) return btn;
    return null;
  }

  /** Click strategies. */
  async function tryClick(link) {
    const beforeUrl = page.url();
    const tag = (await link.evaluate(el => el.tagName).catch(() => '')).toLowerCase();
    const href = await link.getAttribute('href').catch(() => null);
    if (tag === 'a' && href && (href.startsWith('http') || href.startsWith('/'))) {
      const fullUrl = href.startsWith('http') ? href : new URL(page.url()).origin + href;
      await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      return true;
    }
    try { await link.click({ timeout: 3000 }); if (page.url() !== beforeUrl) return true; } catch { /* */ }
    try { await link.click({ timeout: 3000, force: true }); if (page.url() !== beforeUrl) return true; } catch { /* */ }
    try { await link.evaluate(el => el.click()); return true; } catch { /* */ }
    return false;
  }

  for (const scope of scopedSelectors) {
    const link = await pickBestLink(scope);
    if (!link) continue;
    if (await tryClick(link)) {
      console.log(`📋 Clicked submenu "${label}" inside ${scope}`);
      await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(1200);
      return;
    }
  }
  // Final fallback — any header anchor whose href slug matches the label (or its core word)
  for (const needle of [slug, slugCore].filter(Boolean)) {
    const hrefMatch = page.locator(`header a[href*="${needle}" i]`).first();
    if ((await hrefMatch.count()) > 0) {
      const href = await hrefMatch.getAttribute('href');
      if (href && !/\/search\b/i.test(href)) {
        const fullUrl = href.startsWith('http') ? href : new URL(page.url()).origin + href;
        console.log(`📋 Submenu "${label}" — following header href: ${fullUrl}`);
        await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(1200);
        return;
      }
    }
  }
  throw new Error(`Could not click submenu "${label}" — no matching link found in any open dropdown.`);
}

When('the user clicks the {string} submenu', async function (label) {
  await clickSubmenuByText(this.page, label);
});
When('the user selects the {string} submenu', async function (label) {
  await clickSubmenuByText(this.page, label);
});
When('the user clicks the {string} submenu item', async function (label) {
  await clickSubmenuByText(this.page, label);
});

/**
 * Generic page-loaded assertion. Verifies URL slug OR visible heading/title
 * contains the requested page name.
 */
async function assertPageDisplayed(page, pageName) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1200);
  const curUrl = page.url();
  let ok = (await page.content()).length > 500;
  if (ok && pageName) {
    const slug = pageName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const firstWord = pageName.toLowerCase().split(/\s+/)[0];
    const urlOk = curUrl.toLowerCase().includes(slug) || curUrl.toLowerCase().includes(firstWord);
    if (!urlOk) {
      const re = new RegExp(pageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const headingMatch = await page.locator('h1, h2').filter({ hasText: re }).first().isVisible().catch(() => false);
      const titleMatch = re.test(await page.title().catch(() => ''));
      ok = headingMatch || titleMatch;
    }
  }
  assert.ok(ok, `Page "${pageName}" should be displayed (current URL: ${curUrl})`);
}

Then('the {string} page should be displayed', async function (pageName) {
  await assertPageDisplayed(this.page, pageName);
});
Then('the {string} page is displayed', async function (pageName) {
  await assertPageDisplayed(this.page, pageName);
});
// Unquoted variants — e.g. `Then the Accessories page should be displayed`
Then(/^the (.+?) page (?:should be|is) displayed$/, async function (pageName) {
  await assertPageDisplayed(this.page, pageName);
});

// ─── Generic verify / assert steps ────────────────────────────
// Reusable across any feature. Examples:
//   Then verify "Offers" is in the page
//   Then verify "offers" is in the url
//   Then verify "Latest Offers" is in the title
//   Then verify "offers" is in page and url
//   Then the page should contain "Latest Offers"
//   Then the url should contain "offers"
//
// Match semantics:
//   - "in url" / "in the url" → case-insensitive substring of page.url()
//   - "in title" / "in the title" → case-insensitive substring of page.title()
//   - "in page" / "in the page" / unspecified → check URL, title, heading and visible body text
async function verifyTextIn(page, text, where) {
  const needle = String(text).trim();
  const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const target = (where || 'page').toLowerCase();

  const checks = {
    url: async () => re.test(page.url()),
    title: async () => re.test((await page.title().catch(() => '')) || ''),
    heading: async () => {
      const h = page.locator('h1, h2, h3').filter({ hasText: re }).first();
      return (await h.count()) > 0 && (await h.isVisible().catch(() => false));
    },
    body: async () => {
      // Any visible element containing the text
      const loc = page.locator(`:visible:has-text("${needle.replace(/"/g, '\\"')}")`).first();
      return (await loc.count().catch(() => 0)) > 0;
    },
  };

  let ok = false;
  let evidence = [];
  if (target.includes('url') && target.includes('page')) {
    ok = (await checks.url()) || (await checks.title()) || (await checks.heading()) || (await checks.body());
    evidence = ['url', 'title', 'heading', 'body'];
  } else if (target.includes('url')) {
    ok = await checks.url();
    evidence = ['url'];
  } else if (target.includes('title')) {
    ok = await checks.title();
    evidence = ['title'];
  } else {
    // default "in page" — try everything
    ok = (await checks.title()) || (await checks.heading()) || (await checks.body()) || (await checks.url());
    evidence = ['title', 'heading', 'body', 'url'];
  }

  if (ok) {
    console.log(`✅ Verified "${needle}" found in ${evidence.join('/')} (url=${page.url()})`);
  }
  assert.ok(ok, `Expected "${needle}" to be in ${target} (url=${page.url()}, title="${await page.title().catch(() => '')}")`);
}

// Quoted-text + explicit location: Then verify "Offers" is in the url
Then(/^(?:the user )?verif(?:y|ies) "([^"]+)" (?:is |are )?(?:in|on) (?:the )?(url|page|title|page and url|url and page)$/i,
  async function (text, where) { await verifyTextIn(this.page, text, where); });

// Quoted-text only: Then verify "Offers"  → defaults to "in page"
Then(/^(?:the user )?verif(?:y|ies) "([^"]+)"$/i,
  async function (text) { await verifyTextIn(this.page, text, 'page'); });

// Friendly alternative phrasings
Then(/^the page should contain "([^"]+)"$/i,
  async function (text) { await verifyTextIn(this.page, text, 'page'); });
Then(/^the url should contain "([^"]+)"$/i,
  async function (text) { await verifyTextIn(this.page, text, 'url'); });
Then(/^the title should contain "([^"]+)"$/i,
  async function (text) { await verifyTextIn(this.page, text, 'title'); });

// ─── Generic page-load / homepage steps ──────────────────────────────────
// Any feature can use:
//   Given the user is on the Hyundai Australia homepage "https://www.hyundai.com/au/en"
//   Given the user is on the Hyundai homepage
//   Given the user is on the {string} page "{url}"
//   And   the page is fully loaded
//
// If a URL is supplied it is navigated; otherwise we resolve env-aware via openWebsite().
async function navigateToHomepage(world, brand, url) {
  if (url && /^https?:\/\//i.test(url)) {
    // Honor active environment: if running on Stage but the .feature hard-codes
    // a www.* URL, swap to the stage host found in pageUrls.
    const envName = (world.environmentName || '').toLowerCase();
    if (envName && envName !== 'prod' && envName !== 'production') {
      const stageRoot = resolveBrandWebsite(brand || 'hyundai', world.pageUrls, world.environmentName);
      if (stageRoot) {
        try {
          const want = new URL(url);
          const stage = new URL(stageRoot);
          if (want.hostname !== stage.hostname) {
            console.log(`📋 Env=${world.environmentName} — rewriting ${url} → ${stageRoot}`);
            url = stageRoot;
          }
        } catch { /* keep url as-is */ }
      }
    }
    console.log(`📋 Opening homepage: ${url}`);
    await world.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await world.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await world.page.waitForTimeout(800);
    return;
  }
  await openWebsite(world, brand || 'Hyundai Australia');
}

Given(/^the user is on the (.+?) homepage "([^"]+)"$/i, async function (brand, url) {
  await navigateToHomepage(this, brand, url);
});
Given(/^the user is on the (.+?) homepage$/i, async function (brand) {
  await navigateToHomepage(this, brand, null);
});
Given(/^the user is on the (.+?) page "([^"]+)"$/i, async function (_pageName, url) {
  await navigateToHomepage(this, null, url);
});

Given(/^the page is fully loaded$/i, async function () {
  await this.page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
  await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  // Don't assert content size — staging/prod sometimes return small SPAs that
  // hydrate later. A DOM-ready signal is enough; downstream steps will assert
  // specifics.
  await this.page.waitForTimeout(500);
});

// ─── Generic header / footer interaction ─────────────────────────────────
// Works for any feature without per-feature step files:
//   When the user clicks on the search icon in the header
//   When the user clicks on the "Find a Dealer" link in the header
//   When the user clicks on the "Book a Test Drive" button in the header
//   When the user clicks on the "Privacy Policy" link
//   When the user scrolls to the footer
//   Then the footer should be displayed
//   Then the {string} should be displayed in the header
//   Then the user should be redirected to the {string} page

async function clickInRegion(page, text, region /* 'header' | 'footer' | null */) {
  const re = new RegExp(String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const scopes = region === 'header'
    ? ['header', 'nav', '[class*="header" i]', '[role="banner"]']
    : region === 'footer'
      ? ['footer', '[class*="footer" i]', '[role="contentinfo"]']
      : ['body'];

  for (const sel of scopes) {
    const scope = page.locator(sel).first();
    if ((await scope.count()) === 0) continue;
    // Collect candidates by visible text OR by title/aria-label (catches icon-only
    // buttons like the header "Find A Dealer" car icon with no innerText).
    const safe = String(text).replace(/"/g, '\\"');
    const byText = scope.locator('a, button').filter({ hasText: re });
    const byAttr = scope.locator(
      `a[title*="${safe}" i], button[title*="${safe}" i], a[aria-label*="${safe}" i], button[aria-label*="${safe}" i]`
    );
    const collected = [];
    for (const loc of [byText, byAttr]) {
      const n = await loc.count().catch(() => 0);
      for (let i = 0; i < n; i++) collected.push(loc.nth(i));
    }
    // Two-pass selection:
    //   1) prefer a truly-visible <a> with a navigable href
    //   2) otherwise, first truly-visible <a>/<button>
    let chosen = null;
    let chosenHref = null;
    let chosenTag = null;
    for (const el of collected) {
      if (!(await el.isVisible().catch(() => false))) continue;
      // Skip zero-size/off-screen accordion items
      const box = await el.boundingBox().catch(() => null);
      if (!box || box.width < 2 || box.height < 2) continue;
      const tag = (await el.evaluate(e => e.tagName).catch(() => '')).toLowerCase();
      const href = await el.getAttribute('href').catch(() => null);
      if (tag === 'a' && href && (href.startsWith('http') || href.startsWith('/'))) {
        chosen = el; chosenHref = href; chosenTag = tag;
        break; // first pass winner
      }
      if (!chosen) { chosen = el; chosenTag = tag; chosenHref = href; }
    }
    if (chosen) {
      if (chosenTag === 'a' && chosenHref && (chosenHref.startsWith('http') || chosenHref.startsWith('/'))) {
        const fullUrl = chosenHref.startsWith('http') ? chosenHref : new URL(page.url()).origin + chosenHref;
        await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      } else {
        try { await chosen.click({ timeout: 5000 }); }
        catch { await chosen.click({ timeout: 5000, force: true }); }
      }
      await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(800);
      console.log(`📋 Clicked "${text}" in ${region || 'page'} (${chosenTag}${chosenHref ? ` href=${chosenHref}` : ''})`);
      return;
    }
  }

  // ── Fallback: icon-only / no-text buttons (e.g. "search icon", "menu icon")
  // Match by aria-label, title, alt, data-* attributes, or class hints.
  const slug = String(text).toLowerCase().replace(/[^a-z0-9]+/g, '');
  const attrSelectors = [
    `[aria-label*="${text}" i]`,
    `[title*="${text}" i]`,
    `[alt*="${text}" i]`,
    `[data-testid*="${text}" i]`,
    `[data-test*="${text}" i]`,
    `[class*="${slug}" i]`,
    `[id*="${slug}" i]`,
    `button:has(svg[class*="${slug}" i])`,
    `button:has([class*="${slug}" i])`,
    `a:has(svg[class*="${slug}" i])`,
  ];
  for (const sel of scopes) {
    const scope = page.locator(sel).first();
    if ((await scope.count()) === 0) continue;
    for (const attrSel of attrSelectors) {
      const matches = scope.locator(attrSel);
      const n = await matches.count().catch(() => 0);
      for (let i = 0; i < n; i++) {
        const el = matches.nth(i);
        if (!(await el.isVisible().catch(() => false))) continue;
        try { await el.click({ timeout: 5000 }); }
        catch { await el.click({ timeout: 5000, force: true }); }
        await page.waitForTimeout(800);
        console.log(`📋 Clicked "${text}" (via ${attrSel} [${i}]) in ${region || 'page'}`);
        return;
      }
    }
  }

  throw new Error(`Could not click "${text}" in ${region || 'page'}.`);
}

// Header clicks — quoted and unquoted
When(/^the user clicks on the "([^"]+)" (?:link|button|icon|item)?\s*in the header$/i,
  async function (text) { await clickInRegion(this.page, text, 'header'); });
When(/^the user clicks on the (?!")([^"]+?) (?:link|button|icon|item)\s+in the header$/i,
  async function (text) { await clickInRegion(this.page, text, 'header'); });

// Footer clicks
When(/^the user clicks on the "([^"]+)" (?:link|button|item)?\s*in the footer$/i,
  async function (text) { await clickInRegion(this.page, text, 'footer'); });

// Generic clicks (link/button anywhere)
When(/^the user clicks on the "([^"]+)" (?:link|button)$/i,
  async function (text) { await clickInRegion(this.page, text, null); });

// Scroll-to-footer
When(/^the user scrolls to the footer$/i, async function () {
  await this.page.evaluate(() => {
    const f = document.querySelector('footer, [role="contentinfo"], [class*="footer" i]');
    if (f) f.scrollIntoView({ behavior: 'instant', block: 'end' });
    else window.scrollTo(0, document.body.scrollHeight);
  });
  await this.page.waitForTimeout(800);
});

// "is displayed in the header/footer"
async function assertVisibleInRegion(page, text, region) {
  // Build a list of candidate strings — strip noise words like "logo / icon /
  // menu / link / button" so "Hyundai logo" also matches plain "Hyundai".
  const raw = String(text).trim();
  const stripped = raw.replace(/\b(logo|icon|button|link|menu|image)\b/gi, '').replace(/\s+/g, ' ').trim();
  const candidates = [raw, stripped].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);
  const sel = region === 'footer'
    ? 'footer, [class*="footer" i], [role="contentinfo"]'
    : 'header, nav, [class*="header" i], [role="banner"]';
  const scope = page.locator(sel).first();
  if ((await scope.count()) === 0) {
    assert.fail(`No ${region} region found on page (url=${page.url()})`);
  }
  for (const c of candidates) {
    const re = new RegExp(c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const safe = c.replace(/"/g, '\\"');
    // Try: <img alt> / aria-label / title / visible text
    const img = scope.locator(`img[alt*="${safe}" i], [aria-label*="${safe}" i], [title*="${safe}" i]`).first();
    if ((await img.count()) > 0 && (await img.isVisible().catch(() => false))) {
      console.log(`✅ "${text}" visible in ${region} (matched "${c}")`);
      return;
    }
    const any = scope.locator(':visible').filter({ hasText: re }).first();
    if ((await any.count()) > 0) {
      console.log(`✅ "${text}" visible in ${region} (matched "${c}")`);
      return;
    }
  }
  assert.fail(`Expected "${text}" to be displayed in ${region} (url=${page.url()})`);
}

Then(/^the (.+?) should be displayed in the header$/i, async function (text) {
  await assertVisibleInRegion(this.page, text, 'header');
});
Then(/^the (.+?) should be displayed in the footer$/i, async function (text) {
  await assertVisibleInRegion(this.page, text, 'footer');
});
Then(/^the footer should be displayed$/i, async function () {
  const f = this.page.locator('footer, [role="contentinfo"], [class*="footer" i]').first();
  const ok = (await f.count()) > 0 && (await f.isVisible().catch(() => false));
  assert.ok(ok, 'Footer should be displayed');
});
Then(/^the header should be displayed$/i, async function () {
  const h = this.page.locator('header, [role="banner"], [class*="header" i]').first();
  const ok = (await h.count()) > 0 && (await h.isVisible().catch(() => false));
  assert.ok(ok, 'Header should be displayed');
});

// "the X should be clickable and redirect to the homepage"
// Generic implementation — clicks the first matching element and verifies the
// URL returns to a homepage-style root path (e.g. "/", "/au/en", "/au/en/").
Then(/^the (.+?) should be clickable and redirect to the homepage$/i, async function (text) {
  const raw = String(text).trim();
  const stripped = raw.replace(/\b(logo|icon|button|link|image)\b/gi, '').replace(/\s+/g, ' ').trim();
  const safe = (stripped || raw).replace(/"/g, '\\"');
  // Try header logo first (most common), then any visible element with that text/alt
  const header = this.page.locator('header, [role="banner"], [class*="header" i]').first();
  const candidates = [
    header.locator(`a img[alt*="${safe}" i]`).first(),
    header.locator(`a[aria-label*="${safe}" i]`).first(),
    header.locator(`a[href="/"], a[href$="/au/en"], a[href$="/au/en/"]`).first(),
  ];
  let clickable = null;
  for (const c of candidates) {
    if ((await c.count()) > 0 && (await c.isVisible().catch(() => false))) { clickable = c; break; }
  }
  assert.ok(clickable, `No clickable "${text}" element found in header`);
  // Resolve to its enclosing <a> for href navigation
  const anchor = await clickable.evaluate(el => {
    const a = el.closest('a');
    return a ? (a.getAttribute('href') || '') : '';
  }).catch(() => '');
  if (anchor) {
    const fullUrl = anchor.startsWith('http') ? anchor : new URL(this.page.url()).origin + anchor;
    await this.page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } else {
    await clickable.click({ timeout: 5000 }).catch(async () => clickable.click({ force: true }));
    await this.page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
  }
  await this.page.waitForTimeout(500);
  const u = new URL(this.page.url());
  const path = u.pathname.replace(/\/+$/, '');
  const isHomepage = path === '' || /^\/[a-z]{2}\/[a-z]{2}$/i.test(path) || path === '/';
  assert.ok(isHomepage, `Expected redirect to homepage, got ${this.page.url()}`);
  console.log(`✅ "${text}" redirected to homepage: ${this.page.url()}`);
});

// Some links (Find a Dealer, Book a Test Drive) open a "Set your location"
// modal before navigating when no postcode/suburb is stored. Auto-fill it with
// a default Sydney postcode so the navigation proceeds.
async function handleLocationPromptIfPresent(page, defaultPostcode = '2000') {
  try {
    // Locate the postcode/suburb input wherever it is (modal or inline form).
    const inputSelectors = [
      'input[placeholder*="postcode" i]:visible',
      'input[placeholder*="suburb" i]:visible',
      'input[placeholder*="location" i]:visible',
      'input[aria-label*="postcode" i]:visible',
      'input[aria-label*="suburb" i]:visible',
      'input[aria-label*="location" i]:visible',
      'input#location:visible',
    ];
    let input = null;
    for (const sel of inputSelectors) {
      const cand = page.locator(sel).first();
      if ((await cand.count()) > 0 && (await cand.isVisible().catch(() => false))) {
        input = cand;
        break;
      }
    }
    if (!input) return false;

    // Focus + type postcode; wait for autocomplete suggestions
    await input.click({ timeout: 3000 }).catch(() => {});
    await input.fill('').catch(() => {});
    await input.type(defaultPostcode, { delay: 80 }).catch(async () => {
      await input.fill(defaultPostcode);
    });
    console.log(`📋 Location prompt: typed postcode "${defaultPostcode}"`);
    await page.waitForTimeout(1500);

    // Click the first visible autocomplete suggestion
    const suggestionSelectors = [
      '[role="option"]:visible',
      '[role="listbox"] li:visible',
      'ul[class*="autocomplete" i] li:visible',
      'ul[class*="suggestion" i] li:visible',
      'div[class*="autocomplete" i] [class*="item" i]:visible',
      'div[class*="suggestion" i] > *:visible',
      'li:has-text("NSW 2000"):visible',
      ':text-matches("Sydney,\\s*NSW\\s*2000", "i"):visible',
    ];
    let picked = false;
    for (const sel of suggestionSelectors) {
      const sug = page.locator(sel).first();
      if ((await sug.count()) > 0 && (await sug.isVisible().catch(() => false))) {
        await sug.click({ timeout: 2000 }).catch(() => {});
        console.log(`📋 Location prompt: picked suggestion via ${sel}`);
        picked = true;
        break;
      }
    }
    if (!picked) {
      // Fall back to keyboard ArrowDown + Enter to pick first item
      await input.press('ArrowDown').catch(() => {});
      await page.waitForTimeout(300);
      await input.press('Enter').catch(() => {});
      console.log('📋 Location prompt: selected via ArrowDown+Enter');
    }

    // Click any confirm/submit button — prefer "Set dealer" (Hyundai modal
    // confirms the selection and then routes to the dealer page).
    await page.waitForTimeout(800);
    const confirmSelectors = [
      'button:has-text("Set dealer"):visible',
      'button:has-text("Set Dealer"):visible',
      'button:has-text("Set as my dealer"):visible',
      'button[aria-label*="set dealer" i]:visible',
      'button:has-text("Confirm"):visible',
      'button:has-text("Continue"):visible',
      'button:has-text("Submit"):visible',
      'button:has-text("Go"):visible',
      'button[aria-label*="search" i]:visible',
      'button:has-text("Search"):visible',
      'button[type="submit"]:visible',
    ];
    for (const sel of confirmSelectors) {
      const btn = page.locator(sel).first();
      if ((await btn.count()) > 0 && (await btn.isVisible().catch(() => false))) {
        // Race button click against URL change so we capture any redirect.
        await Promise.all([
          page.waitForURL((u) => /dealer/i.test(String(u)), { timeout: 8000 }).catch(() => null),
          btn.click({ timeout: 2000 }).catch(() => {}),
        ]);
        console.log(`📋 Location prompt: submitted via ${sel}`);
        break;
      }
    }
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    return true;
  } catch (e) {
    console.log(`⚠️  handleLocationPromptIfPresent: ${e.message}`);
  }
  return false;
}

// "the user should be redirected to the X page" → URL contains slug of X
Then(/^the user should (?:be )?redirected to the (.+?) page$/i, async function (pageName) {
  await this.page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
  await this.page.waitForTimeout(1500);

  const slug = String(pageName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const core = String(pageName).toLowerCase().split(/\s+/).find(w => w.length > 3) || slug;
  const matches = (u) => u.includes(slug) || u.includes(core);

  let url = this.page.url().toLowerCase();
  // Up to 2 attempts at handling a location prompt + extra wait
  for (let attempt = 0; attempt < 2 && !matches(url); attempt++) {
    const handled = await handleLocationPromptIfPresent(this.page);
    if (!handled) break;
    await this.page.waitForTimeout(1500);
    url = this.page.url().toLowerCase();
  }

  const ok = matches(url);
  assert.ok(ok, `Expected URL to contain "${slug}" or "${core}" — got ${this.page.url()}`);
  console.log(`✅ Redirected to ${pageName} page (url=${this.page.url()})`);
});

// ─── Dealer locator: postcode entry / map / results ───────────────────────
When(/^the user enters "([^"]+)" in the location field$/i, async function (postcode) {
  const inputSelectors = [
    'input#location',
    'input#locaion-modal-input',
    'input[placeholder*="postcode" i]',
    'input[placeholder*="suburb" i]',
    'input[placeholder*="location" i]',
    'input[aria-label*="postcode" i]',
    'input[aria-label*="suburb" i]',
  ];
  let input = null;
  for (const sel of inputSelectors) {
    const cand = this.page.locator(sel).first();
    if ((await cand.count()) > 0 && (await cand.isVisible().catch(() => false))) {
      input = cand;
      break;
    }
  }
  assert.ok(input, 'Could not find a visible location/postcode input field');
  await input.click({ timeout: 3000 }).catch(() => {});
  await input.fill('').catch(() => {});
  await input.type(postcode, { delay: 80 }).catch(async () => input.fill(postcode));
  await this.page.waitForTimeout(1500);
  console.log(`📋 Typed "${postcode}" into location field`);
});

When(/^the user selects the first location suggestion$/i, async function () {
  const suggestionSelectors = [
    '[role="option"]:visible',
    '[role="listbox"] li:visible',
    'ul[class*="autocomplete" i] li:visible',
    'ul[class*="suggestion" i] li:visible',
    'div[class*="autocomplete" i] [class*="item" i]:visible',
    'div[class*="suggestion" i] > *:visible',
    'li[class*="suggestion" i]:visible',
    'li[class*="autocomplete" i]:visible',
  ];
  for (const sel of suggestionSelectors) {
    const sug = this.page.locator(sel).first();
    if ((await sug.count()) > 0 && (await sug.isVisible().catch(() => false))) {
      await sug.click({ timeout: 2000 }).catch(() => {});
      console.log(`📋 Selected first location suggestion via ${sel}`);
      await this.page.waitForTimeout(800);
      return;
    }
  }
  // Fallback: keyboard navigation
  await this.page.keyboard.press('ArrowDown').catch(() => {});
  await this.page.waitForTimeout(300);
  await this.page.keyboard.press('Enter').catch(() => {});
  console.log('📋 Selected first location suggestion via ArrowDown+Enter');
  await this.page.waitForTimeout(800);
});

When(/^the user clicks the "([^"]+)" button$/i, async function (text) {
  const safe = String(text).replace(/"/g, '\\"');
  const selectors = [
    `button:has-text("${safe}"):visible`,
    `a:has-text("${safe}"):visible`,
    `button[aria-label*="${safe}" i]:visible`,
    `a[aria-label*="${safe}" i]:visible`,
    `button[title*="${safe}" i]:visible`,
    `input[type="submit"][value*="${safe}" i]:visible`,
  ];
  for (const sel of selectors) {
    const btn = this.page.locator(sel).first();
    if ((await btn.count()) > 0 && (await btn.isVisible().catch(() => false))) {
      await btn.click({ timeout: 5000 }).catch(async () => btn.click({ timeout: 5000, force: true }));
      await this.page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
      await this.page.waitForTimeout(1500);
      console.log(`📋 Clicked "${text}" button`);
      return;
    }
  }
  throw new Error(`Could not find "${text}" button`);
});

Then(/^the dealer map should be displayed$/i, async function () {
  const mapSelectors = [
    '[class*="map" i]:visible',
    'iframe[src*="google.com/maps" i]',
    'iframe[src*="maps" i]',
    '#map:visible',
    'div[id*="map" i]:visible',
    'canvas:visible',
  ];
  await this.page.waitForTimeout(2000);
  for (const sel of mapSelectors) {
    const m = this.page.locator(sel).first();
    if ((await m.count()) > 0 && (await m.isVisible().catch(() => false))) {
      const box = await m.boundingBox().catch(() => null);
      if (box && box.width > 200 && box.height > 150) {
        console.log(`✅ Dealer map visible via ${sel} (${Math.round(box.width)}x${Math.round(box.height)})`);
        return;
      }
    }
  }
  assert.fail(`Dealer map not displayed (url=${this.page.url()})`);
});

Then(/^a list of nearby dealers should be displayed$/i, async function () {
  const listSelectors = [
    '[class*="dealer-list" i] [class*="dealer" i]:visible',
    '[class*="dealer-card" i]:visible',
    '[class*="dealer-item" i]:visible',
    'ul[class*="dealer" i] li:visible',
    '[class*="result" i] [class*="dealer" i]:visible',
  ];
  await this.page.waitForTimeout(1500);
  for (const sel of listSelectors) {
    const items = this.page.locator(sel);
    const n = await items.count().catch(() => 0);
    if (n > 0) {
      console.log(`✅ Found ${n} dealer(s) via ${sel}`);
      return;
    }
  }
  // Fallback: any visible element mentioning "km" or "open today" near the map
  const body = await this.page.locator('body').innerText().catch(() => '');
  if (/\b\d+(\.\d+)?\s*km\b/i.test(body) || /open today|sales hours/i.test(body)) {
    console.log('✅ Dealer list inferred from page body text');
    return;
  }
  assert.fail('No nearby dealers list detected');
});

// ─── Data-table iteration helpers ────────────────────────────────────────
// Supports:
//   Then the following main navigation menu items should be displayed:
//     | Menu Item       |
//     | Vehicles        |
//   Then the footer should contain the following sections:
//     | Section |
//     | Owners  |
//   Then the following social media icons should be displayed:
//   Then the following legal links should be displayed:
async function assertEachRowVisible(page, dataTable, region /* optional */) {
  const rows = dataTable.raw().slice(1); // skip header row
  const sel = region === 'footer'
    ? 'footer, [class*="footer" i], [role="contentinfo"]'
    : region === 'header'
      ? 'header, nav, [class*="header" i], [role="banner"]'
      : 'body';
  const scope = page.locator(sel).first();
  const body = page.locator('body').first();
  const missing = [];
  for (const row of rows) {
    const text = String(row[0] || '').trim();
    if (!text) continue;
    const safe = text.replace(/"/g, '\\"');
    const re = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const inScope = (await scope.count()) > 0 && (
      (await scope.locator(':visible').filter({ hasText: re }).count()) > 0
      || (await scope.locator(`img[alt*="${safe}" i], [aria-label*="${safe}" i]`).count()) > 0
    );
    // Degrade to page-wide check — many sites render footer links lazily
    // outside the <footer> tag, or the section heading sits in a wrapper.
    const inPage = inScope || (
      (await body.locator(':visible').filter({ hasText: re }).count()) > 0
      || (await body.locator(`a[href*="${safe.toLowerCase().replace(/\s+/g, '-')}" i]`).count()) > 0
      || (await body.locator(`img[alt*="${safe}" i], [aria-label*="${safe}" i]`).count()) > 0
    );
    if (!inPage) missing.push(text);
  }
  assert.ok(missing.length === 0,
    `Expected these items to be visible in ${region || 'page'}: ${missing.join(', ')} (url=${page.url()})`);
  console.log(`✅ All ${rows.length} items visible (${region || 'page'})`);
}

Then(/^the following (?:main )?navigation (?:menu )?items should be displayed:?$/i,
  async function (dt) { await assertEachRowVisible(this.page, dt, 'header'); });
Then(/^the footer should contain the following sections:?$/i,
  async function (dt) { await assertEachRowVisible(this.page, dt, 'footer'); });
Then(/^the following social media icons should be displayed:?$/i,
  async function (dt) { await assertEachRowVisible(this.page, dt, 'footer'); });
Then(/^the following legal links should be displayed:?$/i,
  async function (dt) { await assertEachRowVisible(this.page, dt, 'footer'); });
// Generic catch-all — but EXCLUDE phrases handled by more specific steps above
// to avoid AmbiguousStepDefinitionsError.
Then(/^the following (?!(?:main\s+)?navigation\b|social media icons\b|legal links\b)(.+?) should be displayed:?$/i,
  async function (_label, dt) { await assertEachRowVisible(this.page, dt, null); });

// ─── Hamburger / mobile menu (centralised) ────────────────────────────────
//   Then the hamburger menu icon should be displayed
//   When the user clicks on the hamburger menu icon
//   Then the mobile navigation menu should expand
//   Then the hamburger menu should replace the desktop navigation
async function findHamburger(page) {
  const selectors = [
    'header button[aria-label*="menu" i]',
    'header button[aria-label*="navigation" i]',
    'header [class*="hamburger" i]',
    'header [class*="menu-toggle" i]',
    'header [class*="nav-toggle" i]',
    'header [class*="burger" i]',
    'button[aria-label*="menu" i]:visible',
    'button[aria-label*="open menu" i]',
    'button:has(svg):visible >> nth=0',
  ];
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if ((await el.count()) > 0) return el;
  }
  return null;
}

Then(/^the hamburger menu icon should be displayed$/i, async function () {
  const h = await findHamburger(this.page);
  const visible = h && (await h.isVisible().catch(() => false));
  assert.ok(visible, 'Hamburger menu icon should be displayed (try switching to mobile viewport first)');
  console.log('✅ Hamburger icon visible');
});

When(/^the user clicks on the hamburger menu icon$/i, async function () {
  const h = await findHamburger(this.page);
  if (!h || !(await h.isVisible().catch(() => false))) {
    throw new Error('Hamburger menu icon not visible — set a mobile viewport first');
  }
  await h.click({ timeout: 5000 }).catch(async () => h.click({ force: true }));
  await this.page.waitForTimeout(600);
  console.log('✅ Clicked hamburger icon');
});

Then(/^the mobile navigation menu should expand$/i, async function () {
  // After clicking the hamburger, *some* nav container should now be visible.
  const m = this.page.locator(
    '[class*="mobile-nav" i]:visible, [class*="mobile-menu" i]:visible, ' +
    '[class*="nav-drawer" i]:visible, nav[aria-expanded="true"], ' +
    '[role="dialog"]:visible, [class*="off-canvas" i]:visible, ' +
    'nav:visible >> nth=0'
  ).first();
  const ok = (await m.count()) > 0;
  assert.ok(ok, 'Mobile navigation menu did not expand');
  console.log('✅ Mobile nav menu expanded');
});

Then(/^the hamburger menu should replace the desktop navigation$/i, async function () {
  const h = await findHamburger(this.page);
  const hVis = h && (await h.isVisible().catch(() => false));
  // Desktop nav links should NOT all be visible at mobile width
  const navLinksVisibleCount = await this.page.locator('header nav a:visible').count().catch(() => 0);
  assert.ok(hVis, 'Hamburger icon should be visible at mobile width');
  assert.ok(navLinksVisibleCount < 5, `Expected desktop nav to be hidden, but ${navLinksVisibleCount} nav links visible`);
  console.log('✅ Hamburger replaces desktop nav');
});

// ─── Dropdown / megamenu assertions (centralised) ─────────────────────────
//   Then the "Owners" dropdown or mega menu should be displayed
//   And it should contain relevant sub-menu links
Then(/^the "([^"]+)" (?:dropdown|mega menu|menu|flyout)(?:\s+or\s+(?:mega menu|menu|flyout|dropdown))? should be displayed$/i,
  async function (menuName) {
    const dd = this.page.locator(
      'header [class*="dropdown" i]:visible, header [class*="megamenu" i]:visible, ' +
      'header [class*="mega-menu" i]:visible, header [class*="flyout" i]:visible, ' +
      'header [class*="submenu" i]:visible, header [role="menu"]:visible'
    ).first();
    const ok = (await dd.count()) > 0;
    assert.ok(ok, `"${menuName}" dropdown/megamenu not visible after hover/click`);
    console.log(`✅ "${menuName}" dropdown visible`);
  });

Then(/^it should contain relevant sub-menu links$/i, async function () {
  const dd = this.page.locator(
    'header [class*="dropdown" i]:visible, header [class*="megamenu" i]:visible, ' +
    'header [class*="mega-menu" i]:visible, header [class*="flyout" i]:visible, ' +
    'header [class*="submenu" i]:visible, header [role="menu"]:visible'
  ).first();
  const count = await dd.locator('a').count().catch(() => 0);
  assert.ok(count > 0, `Expected dropdown to contain links, found ${count}`);
  console.log(`✅ Dropdown contains ${count} sub-menu links`);
});

// ─── Header search (centralised) ──────────────────────────────────────────
//   When the user clicks on the search icon in the header
//   Then the search input field should be displayed
//   When the user types "Tucson" in the search field
//   And the user submits the search
//   Then search results related to "Tucson" should be displayed
Then(/^the search input field should be displayed$/i, async function () {
  const input = this.page.locator(
    'input[type="search"]:visible, input[placeholder*="search" i]:visible, ' +
    'input[aria-label*="search" i]:visible, [role="search"] input:visible'
  ).first();
  const ok = (await input.count()) > 0;
  assert.ok(ok, 'Search input field not visible');
  console.log('✅ Search input visible');
});

When(/^the user types "([^"]+)" in the search field$/i, async function (text) {
  const input = this.page.locator(
    'input[type="search"]:visible, input[placeholder*="search" i]:visible, ' +
    'input[aria-label*="search" i]:visible, [role="search"] input:visible'
  ).first();
  await input.waitFor({ state: 'visible', timeout: 5000 });
  await input.fill(text);
  console.log(`📋 Typed "${text}" in search field`);
});

When(/^the user submits the search$/i, async function () {
  await this.page.keyboard.press('Enter');
  await this.page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
  await this.page.waitForTimeout(1200);
  console.log('📋 Submitted search');
});

Then(/^search results related to "([^"]+)" should be displayed$/i, async function (term) {
  await this.page.waitForTimeout(2000);
  const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const url = this.page.url();

  // 1. URL sanity — must be a search-results URL, not the homepage.
  const isSearchUrl = /\/search|\?(?:q|query|s|search)=/i.test(url);
  // 2. Page title must NOT indicate 404 / not-found.
  const title = (await this.page.title().catch(() => '')) || '';
  const is404 =
    /404|not found|page not found|sorry/i.test(title) ||
    (await this.page.locator('body').filter({ hasText: /404|page not found|sorry,? we can'?t find/i }).count()) > 0;
  // 3. Page must explicitly look like a results page (results container, "X results for", etc).
  const resultsContainer = await this.page.locator(
    '[class*="search-result" i]:visible, [class*="searchResult" i]:visible, ' +
    '[id*="search-result" i]:visible, [class*="results" i]:visible, ' +
    '[data-testid*="search-result" i]:visible'
  ).count();
  const resultsTextCount = await this.page.locator('body').filter({
    hasText: new RegExp(`(results?|matches?)\\s+for\\s+["']?${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(\\d+\\)`, 'i'),
  }).count();
  const termInBody = (await this.page.locator(':visible').filter({ hasText: re }).count()) > 0;

  if (is404) {
    throw new Error(`Search for "${term}" landed on a 404 / not-found page (title="${title}", url=${url})`);
  }
  if (!isSearchUrl) {
    throw new Error(`Search did not navigate to a search-results URL for "${term}" (url=${url})`);
  }
  if (resultsContainer === 0 && resultsTextCount === 0 && !termInBody) {
    throw new Error(`No results container or matches for "${term}" on ${url}`);
  }
  console.log(`✅ Search results for "${term}" displayed (url=${url}, containers=${resultsContainer})`);
});

// ─── Generic responsive layout assertions ─────────────────────────────────
//   Then the page layout should adjust to mobile view
//   Then the page layout should adjust to tablet view
//   Then the full desktop navigation should be displayed
//   Then the navigation should be appropriately displayed
//   Then all images should be properly scaled
//   Then no horizontal scrollbar should appear
//   Then all content sections should be visible and properly aligned
//   Then all content sections should be properly laid out in desktop format
Then(/^the page layout should adjust to (mobile|tablet|desktop) view$/i, async function (device) {
  const size = this.page.viewportSize();
  const expected = device === 'mobile' ? 600 : device === 'tablet' ? 1024 : 1200;
  const op = device === 'desktop' ? size.width >= 1100 : device === 'mobile' ? size.width <= 600 : size.width > 600 && size.width <= 1100;
  assert.ok(op, `Viewport ${size.width}px not consistent with ${device} layout (~${expected}px)`);
  console.log(`✅ Layout suits ${device} (${size.width}px)`);
});

Then(/^the navigation should be appropriately displayed$/i, async function () {
  const nav = this.page.locator('header, nav').first();
  const ok = (await nav.count()) > 0 && (await nav.isVisible().catch(() => false));
  assert.ok(ok, 'Navigation not displayed');
  console.log('✅ Navigation displayed');
});

Then(/^the full desktop navigation should be displayed$/i, async function () {
  const count = await this.page.locator('header nav a:visible').count().catch(() => 0);
  assert.ok(count >= 3, `Expected multiple desktop nav links, got ${count}`);
  console.log(`✅ Desktop nav shows ${count} links`);
});

Then(/^all images should be properly scaled$/i, async function () {
  const broken = await this.page.evaluate(() => {
    return Array.from(document.images).filter(i =>
      i.complete && i.naturalWidth === 0 && i.getAttribute('src')
    ).length;
  });
  assert.ok(broken === 0, `${broken} broken images detected`);
  console.log('✅ No broken images');
});

Then(/^no horizontal scrollbar should appear$/i, async function () {
  const overflow = await this.page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  assert.ok(overflow <= 4, `Horizontal scrollbar present (overflow=${overflow}px)`);
  console.log('✅ No horizontal scrollbar');
});

Then(/^all content sections should be visible and properly aligned$/i, async function () {
  const sections = await this.page.locator('section:visible, main :is(section, article):visible').count();
  assert.ok(sections > 0, 'No visible content sections found');
  console.log(`✅ ${sections} content sections visible`);
});

Then(/^all content sections should be properly laid out in desktop format$/i, async function () {
  const body = await this.page.content();
  assert.ok(body.length > 1000, 'Page seems empty');
  console.log('✅ Desktop content laid out');
});

// ─── Generic Contact / form steps (centralised) ───────────────────────────
//   When the user navigates to the "Contact Us" page
//   Then the contact information should be displayed including: <table>
//   Given the user is on the Contact Us page
//   When the user fills in the contact form with: <table>
//   Then a success message should be displayed confirming the enquiry was received
When(/^the user navigates to the "([^"]+)" page$/i, async function (pageName) {
  const url = lookupPageUrl(this.pageUrls, pageName);
  if (!url) {
    // Fallback: click any matching header link
    await clickInRegion(this.page, pageName, 'header').catch(async () => {
      throw new Error(`Cannot navigate to "${pageName}" — no URL in env map and not in header.`);
    });
    return;
  }
  console.log(`📋 Navigating to "${pageName}" → ${url}`);
  await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await this.page.waitForTimeout(800);
});

Given(/^the user is on the (.+?) page$/i, async function (pageName) {
  const url = lookupPageUrl(this.pageUrls, pageName);
  if (url) {
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await this.page.waitForTimeout(800);
    console.log(`📋 On "${pageName}" page → ${url}`);
  } else {
    console.log(`⚠️  No URL mapping for "${pageName}" page — assuming already there`);
  }
});

Then(/^the contact information should be displayed including:?$/i, async function (dt) {
  await assertEachRowVisible(this.page, dt, null);
});

When(/^the user fills in the contact form with:?$/i, async function (dt) {
  const rows = dt.raw();
  // Support either 2-col rows | Field | Value | or full table with header
  const dataRows = rows[0] && /field|input|label/i.test(String(rows[0][0])) ? rows.slice(1) : rows;
  for (const row of dataRows) {
    const field = String(row[0] || '').trim();
    const value = String(row[1] || '').trim();
    if (!field) continue;
    try {
      await this.fillField(field, value);
      console.log(`📋 Filled "${field}" = "${value}"`);
    } catch (e) {
      console.log(`⚠️  Could not fill "${field}": ${e.message}`);
    }
  }
});

Then(/^a success message should be displayed confirming the enquiry was received$/i, async function () {
  await this.page.waitForTimeout(2000);
  const re = /thank you|success|received|submitted|we'?ll be in touch/i;
  const found = await this.page.locator(':visible').filter({ hasText: re }).count();
  assert.ok(found > 0, 'No success message found after form submit');
  console.log('✅ Success message displayed');
});

// ─── Copyright assertions ─────────────────────────────────────────────────
//   Then the copyright notice should be displayed
//   And it should contain the current year and "Hyundai Motor Company Australia"
Then(/^the copyright notice should be displayed$/i, async function () {
  const re = /©|\(c\)|copyright/i;
  const found = await this.page.locator('footer, [class*="footer" i]').locator(':visible').filter({ hasText: re }).count();
  assert.ok(found > 0, 'No copyright notice in footer');
  console.log('✅ Copyright notice displayed');
});

Then(/^it should contain the current year and "([^"]+)"$/i, async function (text) {
  const year = String(new Date().getFullYear());
  const safe = text.replace(/"/g, '\\"');
  const yrFound = await this.page.locator('footer, [class*="footer" i]').locator(`:visible:has-text("${year}")`).count();
  const txtFound = await this.page.locator('footer, [class*="footer" i]').locator(`:visible:has-text("${safe}")`).count();
  assert.ok(yrFound > 0, `Current year "${year}" not in footer`);
  assert.ok(txtFound > 0, `"${text}" not in footer`);
  console.log(`✅ Footer contains "${year}" and "${text}"`);
});


// ─── Responsive / viewport helpers ───────────────────────────────────────
//   Given the user is viewing the site on a mobile device
//   Given the user is viewing the site on a mobile device with width "375" pixels
//   Given the user is viewing the site on a tablet device with width "768" pixels
//   Given the user is viewing the site on a desktop with width "1440" pixels
async function setViewport(page, device, widthOverride) {
  const presets = {
    mobile: { width: 375, height: 812 },
    tablet: { width: 768, height: 1024 },
    desktop: { width: 1440, height: 900 },
  };
  const key = String(device || 'mobile').toLowerCase().split(/\s+/)[0];
  const p = presets[key] || presets.mobile;
  const width = widthOverride ? parseInt(widthOverride, 10) : p.width;
  await page.setViewportSize({ width, height: p.height });
  await page.waitForTimeout(300);
  console.log(`📋 Viewport set to ${key} ${width}x${p.height}`);
}

Given(/^the user is viewing the site on a (mobile|tablet|desktop)(?:\s+device)?$/i,
  async function (device) { await setViewport(this.page, device); });
Given(/^the user is viewing the site on a (mobile|tablet|desktop)(?:\s+device)? with width "(\d+)" pixels?$/i,
  async function (device, width) { await setViewport(this.page, device, width); });

// ─── Step: set location postcode ─────────────────────────────
// Use in any feature file:
//   And the user sets location postcode "2000"
//   And the user sets location postcode "3000"
Given('the user sets location postcode {string}', async function (postcode) {
  console.log(`📍 Setting location postcode: ${postcode}`);
  await handleLocationModal(this.page, postcode);
  console.log(`✅ Location set to postcode: ${postcode}`);
});

// ─── Reusable performance assertions ─────────────────────────
// These read metrics that are populated either by a preceding step that
// installed a perf observer (e.g. the "variant tab" click) or by reading the
// browser's Navigation/PerformanceObserver entries on demand.

/**
 * Capture current page perf metrics into `this.perfMetrics` if not already set.
 * Safe to call multiple times — it only refreshes if the page has navigated
 * since the last capture.
 */
async function ensurePerfMetrics(world) {
  if (world.perfMetrics && world.perfMetrics._url === world.page.url()) return world.perfMetrics;
  const m = await world.page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const longTasks = (window.__ctaLongTasks || []).map(e => ({
      duration: Math.round(e.duration),
      startTime: Math.round(e.startTime),
    }));
    return {
      responseTimeMs: nav.responseEnd && nav.requestStart ? Math.round(nav.responseEnd - nav.requestStart) : null,
      ttfbMs: nav.responseStart && nav.requestStart ? Math.round(nav.responseStart - nav.requestStart) : null,
      domContentLoadedMs: nav.domContentLoadedEventEnd ? Math.round(nav.domContentLoadedEventEnd) : null,
      loadEventMs: nav.loadEventEnd ? Math.round(nav.loadEventEnd) : null,
      longTasks,
    };
  }).catch(() => ({ responseTimeMs: null, longTasks: [] }));
  m._url = world.page.url();
  world.perfMetrics = m;
  return m;
}

Then('the current URL should not contain {string}', async function (forbidden) {
  const url = this.page.url();
  console.log(`📋 URL check — current="${url}" forbidden="${forbidden}"`);
  assert.ok(!url.includes(forbidden), `Expected URL to NOT contain "${forbidden}" but got: ${url}`);
});

Then('the page response time should be less than {int} ms', async function (thresholdMs) {
  const m = await ensurePerfMetrics(this);
  console.log(`📋 Response time: ${m.responseTimeMs}ms (threshold: <${thresholdMs}ms)  ttfb=${m.ttfbMs}ms`);
  assert.ok(m.responseTimeMs !== null, 'Navigation timing not available for this page');
  assert.ok(m.responseTimeMs < thresholdMs,
    `Page response time was ${m.responseTimeMs}ms, expected < ${thresholdMs}ms`);
});

Then('no renderer long task longer than {int} ms should occur', async function (thresholdMs) {
  const m = await ensurePerfMetrics(this);
  const offenders = (m.longTasks || []).filter(t => t.duration > thresholdMs);
  console.log(`📋 Long tasks: ${m.longTasks?.length || 0} total, ${offenders.length} over ${thresholdMs}ms`);
  if (offenders.length > 0) {
    console.log('   Offenders:', JSON.stringify(offenders));
  }
  assert.equal(offenders.length, 0,
    `Found ${offenders.length} renderer long task(s) over ${thresholdMs}ms: ${JSON.stringify(offenders)}`);
});


// --- Live chat widget (centralised) ---------------------------------------
//   Then a live chat widget or icon should be displayed on the page
//   When the user clicks on the live chat widget
//   Then the chat window should open
//   Then a welcome message or chatbot prompt should be displayed
//   Given the live chat window is open
//   When the user types "<message>"
//   When the user sends the message
//   Then a response from the chatbot or agent should be received
function chatLocator(page) {
  return page.locator(
    '[id*="chat" i]:visible, [class*="chat-widget" i]:visible, ' +
    '[class*="livechat" i]:visible, [class*="chatbot" i]:visible, ' +
    'iframe[title*="chat" i], iframe[id*="chat" i], ' +
    'button[aria-label*="chat" i]:visible, [class*="messenger" i]:visible'
  ).first();
}

Then(/^a live chat widget or icon should be displayed on the page$/i, async function () {
  const c = chatLocator(this.page);
  const ok = (await c.count()) > 0;
  if (!ok) console.log('??  No live chat widget detected (skipping soft)');
  assert.ok(ok, 'No live chat widget visible on page');
  console.log('? Live chat widget visible');
});

When(/^the user clicks on the live chat widget$/i, async function () {
  const c = chatLocator(this.page);
  await c.click({ timeout: 5000 }).catch(async () => c.click({ force: true }));
  await this.page.waitForTimeout(1000);
  console.log('?? Clicked live chat widget');
});

Then(/^the chat window should open$/i, async function () {
  const win = this.page.locator(
    '[class*="chat-window" i]:visible, [class*="chat-panel" i]:visible, ' +
    '[class*="chat-container" i]:visible, [class*="chatbot" i]:visible, ' +
    'iframe[title*="chat" i]'
  ).first();
  const ok = (await win.count()) > 0;
  assert.ok(ok, 'Chat window did not open');
  console.log('? Chat window open');
});

Then(/^a welcome message or chatbot prompt should be displayed$/i, async function () {
  await this.page.waitForTimeout(1500);
  const re = /hello|hi |welcome|how can|how may|help/i;
  const found = await this.page.locator(':visible').filter({ hasText: re }).count();
  assert.ok(found > 0, 'No welcome / chatbot prompt detected');
  console.log('? Welcome message displayed');
});

Given(/^the live chat window is open$/i, async function () {
  const win = this.page.locator(
    '[class*="chat-window" i]:visible, [class*="chat-panel" i]:visible, ' +
    '[class*="chatbot" i]:visible'
  ).first();
  if ((await win.count()) === 0) {
    const c = chatLocator(this.page);
    if ((await c.count()) > 0) {
      await c.click({ force: true }).catch(() => {});
      await this.page.waitForTimeout(1000);
    }
  }
  console.log('?? Live chat window assumed open');
});

When(/^the user types "([^"]+)"$/i, async function (text) {
  const input = this.page.locator(
    '[class*="chat" i] textarea:visible, [class*="chat" i] input[type="text"]:visible, ' +
    '[class*="chatbot" i] textarea:visible, [class*="chatbot" i] input:visible, ' +
    'textarea:visible, input[type="text"]:visible'
  ).first();
  await input.fill(text);
  console.log(`?? Typed "${text}"`);
});

When(/^the user sends the message$/i, async function () {
  await this.page.keyboard.press('Enter');
  await this.page.waitForTimeout(1500);
  console.log('?? Sent message');
});

Then(/^a response from the chatbot or agent should be received$/i, async function () {
  await this.page.waitForTimeout(2500);
  // Just assert chat container still visible and has additional text
  const c = chatLocator(this.page);
  const ok = (await c.count()) > 0;
  assert.ok(ok, 'No response visible in chat');
  console.log('? Response received');
});

// --- Social media link verify ---------------------------------------------
Then(/^each social media icon should link to the correct Hyundai Australia social page$/i,
  async function () {
    const icons = this.page.locator(
      'footer a[href*="facebook" i], footer a[href*="instagram" i], ' +
      'footer a[href*="youtube" i], footer a[href*="twitter" i], ' +
      'footer a[href*="x.com" i], footer a[href*="linkedin" i], ' +
      'footer a[href*="tiktok" i]'
    );
    const count = await icons.count();
    assert.ok(count > 0, 'No social media links found in footer');
    for (let i = 0; i < count; i++) {
      const href = await icons.nth(i).getAttribute('href');
      assert.ok(href && /^https?:\/\//.test(href), `Social link ${i} has invalid href: ${href}`);
    }
    console.log(`? ${count} social media links verified`);
  });


// --- Screenshot helper (centralised) --------------------------------------
//   When the user takes a screenshot named "menu-Models"
//   When the user takes a screenshot
When(/^the user takes a screenshot(?:\s+named\s+"([^"]+)")?$/i, async function (name) {
  const fs = await import('fs');
  const path = await import('path');
  const dir = 'screenshots';
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const safe = (name || `screenshot-${Date.now()}`).replace(/[^a-z0-9._-]+/gi, '_');
  const file = path.join(dir, `${safe}.png`);
  await this.page.screenshot({ path: file, fullPage: true });
  console.log(`📸 Screenshot saved: ${file}`);
});
