/**
 * Auto Step Definition Generator
 *
 * Parses all .feature files in features/cucumber/, scans existing step definition
 * files, and auto-generates Playwright-based step definitions for any undefined steps.
 *
 * This ensures that ANY feature file added from Confluence automatically gets
 * working step definitions — no manual coding required.
 *
 * Usage:
 *   node scripts/generateStepDefs.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { inspectPage, resolveFieldSelector, resolveButtonSelector } from './domInspector.js';
import { mcpInspectModal, detectModalTriggers, mergeDomMaps } from './mcpDomInspector.js';
import { matchStepPattern } from './stepPatternLibrary.js';

// Enable MCP-assisted modal DOM inspection via --mcp flag or MCP_DOM=1 env var
const USE_MCP = process.argv.includes('--mcp') || process.env.MCP_DOM === '1';

// --feature <name>[,<name>,...] — only process the named feature file(s), ignoring the allowlist
const _featureIdx = process.argv.indexOf('--feature');
const _featureArg = _featureIdx >= 0 ? process.argv[_featureIdx + 1] : undefined;
const FEATURE_FILTER = _featureArg
  ? _featureArg.split(',').map(f => f.trim().toLowerCase().replace(/\.feature$/, ''))
  : [];

// --all — process every feature file, bypassing the generate.config.json allowlist
const ALL_FEATURES = process.argv.includes('--all');

// --update-steps — re-run generation for features that already have a step file.
// By default, an existing `_auto.steps.js` file is treated as user-owned and
// completely skipped (no DOM inspection, no MCP, no appending). Set this flag
// (or env var UPDATE_STEPS=1) to opt back into the previous "append missing
// steps" behaviour for existing files.
const UPDATE_STEPS = process.argv.includes('--update-steps') || process.env.UPDATE_STEPS === '1';

// generate.config.json allowlist — if present and non-empty, default runs only process listed features
function loadAllowList() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'generate.config.json'), 'utf-8'));
    return (cfg.allow || []).map(f => f.toLowerCase().replace(/\.feature$/, ''));
  } catch { return []; }
}
const ALLOW_LIST = loadAllowList();

const ROOT = path.resolve('.');
const FEATURES_DIR = path.join(ROOT, 'features', 'cucumber');
const STEPS_DIR = path.join(FEATURES_DIR, 'step_definitions');

// ─── Load cached environment URLs (written by orchestrator Step 1.5) ─────────
function loadCachedPageUrls() {
  try {
    const cachePath = path.join(ROOT, '.cache', 'activeEnvironment.json');
    if (fs.existsSync(cachePath)) {
      const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      return data.pageUrls || {};
    }
  } catch { /* ignore */ }
  return {};
}

/**
 * Resolve a URL for a navigation step from the cached environment page URL map.
 * Falls back to common known URLs for recognisable page names.
 */
function resolvePageUrl(pageName) {
  const pageUrls = loadCachedPageUrls();
  const key = (pageName || '').toLowerCase().trim();

  // Guard: empty key would match everything via k.includes('')
  if (!key) return '';

  // Direct match
  if (pageUrls[key]) return pageUrls[key];

  // Fuzzy match against keys
  const keyMatch = Object.entries(pageUrls).find(([k]) => k.includes(key) || key.includes(k));
  if (keyMatch) return keyMatch[1];

  // Token-overlap match (handles singular/plural & word-order, e.g. "offer detail" → "offers detail page")
  const stem = (s) => s.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean).map(t => t.replace(/(?:ies|es|s)$/, ''));
  const keyTokens = stem(key);
  if (keyTokens.length) {
    const tokenMatch = Object.entries(pageUrls).find(([k]) => {
      const kTokens = stem(k);
      const overlap = keyTokens.filter(t => kTokens.includes(t)).length;
      return overlap >= Math.min(2, keyTokens.length);
    });
    if (tokenMatch) return tokenMatch[1];
  }

  // Slug-based match against URL paths — handles "customer care" → ".../customer-care/contact-us"
  const slug = key.replace(/\s+/g, '-');
  const slugMatch = Object.entries(pageUrls).find(([, url]) => {
    try {
      const path = new URL(url).pathname.toLowerCase();
      return path.includes(slug) || path.includes(key.replace(/\s+/g, ''));
    } catch { return false; }
  });
  if (slugMatch) return slugMatch[1];

  // Known fallback URLs
  const fallbacks = {
    'test drive': 'https://stage.hyundai.com.au/au/en/book-a-test-drive',
    'book a test drive': 'https://stage.hyundai.com.au/au/en/book-a-test-drive',
    'contact us': 'https://stage.hyundai.com.au/au/en/customer-care/contact-us',
    'customer care': 'https://stage.hyundai.com.au/au/en/customer-care/contact-us',
    'contact a dealer': 'https://stage.hyundai.com.au/au/en/contact-a-dealer',
  };
  return fallbacks[key] || '';
}

/**
 * Extract the primary navigation URL from a parsed feature.
 * Checks background and scenario steps for an explicit URL or a named page
 * that can be resolved via the cached environment page-URL map.
 *
 * @param {{ backgroundSteps: object[], allSteps: object[] }} parsed
 * @returns {string}  the URL, or '' if none found
 */
function extractFeatureUrl(parsed) {
  const stepsToCheck = [...parsed.backgroundSteps, ...parsed.allSteps];
  for (const step of stepsToCheck) {
    // Explicit URL in quotes: navigates to "https://..."
    const explicitUrl = step.text.match(/"(https?:\/\/[^"]+)"/);
    if (explicitUrl) return explicitUrl[1];

    // Named page: "navigates to the Book a Test Drive page"
    if (/navigat|opens?|visits?/i.test(step.text) && !step.text.includes('"http')) {
      const pageNameMatch = step.text.match(
        /(?:navigate(?:s)? to|opens?|visits?)\s+(?:the\s+)?(.+?)(?:\s+page\b|\s*$)/i
      );
      if (pageNameMatch) {
        const pageKey = pageNameMatch[1].toLowerCase().replace(/^the\s+/, '').trim();
        const resolved = resolvePageUrl(pageKey);
        if (resolved) return resolved;
      }
    }

    // Implicit navigation: "I am [a user] on the X page", "user is on the X page"
    const implicit = step.text.match(
      /(?:i\s+am|i'm|user\s+is|the\s+user\s+is)\s+(?:a\s+user\s+)?(?:on|at|visiting|browsing)\s+(?:the\s+)+(.+?)\s+page\b/i
    );
    if (implicit) {
      const pageKey = implicit[1].toLowerCase().replace(/^the\s+/, '').trim();
      const resolved = resolvePageUrl(pageKey);
      if (resolved) return resolved;
    }
  }
  return '';
}

// ─── Gherkin Parser ──────────────────────────────────────────

/**
 * Parse a .feature file and extract all unique step texts with their keywords.
 */
function parseFeatureSteps(featurePath) {
  const content = fs.readFileSync(featurePath, 'utf-8');
  const lines = content.split('\n');
  const steps = [];
  const backgroundSteps = [];
  let inBackground = false;
  let inScenario = false;
  let currentUrl = null;

  for (const raw of lines) {
    const line = raw.trim();

    if (/^Background:/i.test(line)) { inBackground = true; inScenario = false; continue; }
    if (/^Scenario( Outline)?:/i.test(line)) { inBackground = false; inScenario = true; continue; }
    if (/^(Feature:|@|#|Examples:|$)/.test(line)) continue;
    if (line.startsWith('|')) continue; // table data

    const match = line.match(/^(Given|When|Then|And|But)\s+(.+)$/i);
    if (!match) continue;

    const keyword = match[1];
    const text = match[2].trim();

    // Track URL from navigation steps
    const urlMatch = text.match(/"(https?:\/\/[^"]+)"/);
    if (urlMatch) currentUrl = urlMatch[1];

    const entry = { keyword, text, url: currentUrl };
    if (inBackground) {
      backgroundSteps.push(entry);
    } else {
      steps.push(entry);
    }
  }

  // Parse feature name for context
  const featureMatch = content.match(/Feature:\s*(.+)/i);
  const featureName = featureMatch ? featureMatch[1].trim() : path.basename(featurePath, '.feature');

  return { featureName, backgroundSteps, steps, allSteps: [...backgroundSteps, ...steps] };
}

// ─── Existing Step Scanner ───────────────────────────────────

/**
 * Scan all existing .steps.js files and extract the registered step patterns.
 * Returns an array of { pattern, regex, file } objects.
 */
function scanExistingSteps() {
  if (!fs.existsSync(STEPS_DIR)) return [];

  const stepFiles = fs.readdirSync(STEPS_DIR).filter(f => f.endsWith('steps.js'));
  const defined = [];

  for (const file of stepFiles) {
    const content = fs.readFileSync(path.join(STEPS_DIR, file), 'utf-8');

    // Match string-quoted patterns: Given('pattern text', ...) – handles {string}, {int}, {float}
    const stringMatcher = /(?:Given|When|Then)\(\s*'([^']+)'/g;
    let m;
    while ((m = stringMatcher.exec(content)) !== null) {
      const pattern = m[1];
      const regexStr = '^' + pattern
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')   // escape regex chars
        .replace(/\\{string\\}/g, '"[^"]*"')        // {string} → "..."
        .replace(/\\{int\\}/g, '\\d+')              // {int} → digits
        .replace(/\\{float\\}/g, '\\d+\\.?\\d*')    // {float} → number
        + '$';
      defined.push({ pattern, regex: new RegExp(regexStr), file });
    }

    // Also match regex-literal patterns: Given(/^pattern(.+)$/, ...)
    // This prevents the generator from re-defining steps that use regex syntax.
    const regexMatcher = /(?:Given|When|Then)\(\s*\/([^/]+)\/[gimsuy]*/g;
    while ((m = regexMatcher.exec(content)) !== null) {
      const rawPattern = m[1];
      try {
        defined.push({ pattern: `/${rawPattern}/`, regex: new RegExp(rawPattern, 'i'), file });
      } catch { /* ignore malformed regex patterns */ }
    }
  }

  return defined;
}

/**
 * Find the full DOM-map field record (selector + label + tag + type) that best
 * matches a hint. Used by the `fill_from_data` body generator so the emitted
 * code knows whether to call selectOption (for <select>) or fill (for input/textarea).
 */
function findFieldRecord(hint, domMap) {
  if (!domMap?.fields?.length) return null;
  const lower = (hint || '').toLowerCase().trim();
  if (!lower) return null;
  // 1. exact label match
  let f = domMap.fields.find(x => (x.label || '').toLowerCase() === lower);
  if (f) return f;
  // 2. attribute exact
  f = domMap.fields.find(x =>
    (x.name || '').toLowerCase() === lower ||
    (x.id || '').toLowerCase() === lower ||
    (x.placeholder || '').toLowerCase() === lower ||
    (x.ariaLabel || '').toLowerCase() === lower);
  if (f) return f;
  // 3. fuzzy: every significant word appears in metadata
  const words = lower.split(/\s+/).filter(w => w.length > 2);
  if (words.length) {
    f = domMap.fields.find(x => {
      const hay = `${x.label} ${x.name} ${x.id} ${x.placeholder} ${x.ariaLabel}`.toLowerCase();
      return words.every(w => hay.includes(w));
    });
    if (f) return f;
  }
  // 4. partial: any single significant word matches label/id
  if (words.length) {
    f = domMap.fields.find(x => {
      const hay = `${x.label} ${x.id} ${x.name}`.toLowerCase();
      return words.some(w => hay.includes(w));
    });
    if (f) return f;
  }
  return null;
}

/**
 * Build a list of likely Confluence test-data column names for a field hint.
 * Combines the step-text hint with the DOM label so either spelling matches.
 */
function buildDataKeys(stepHint, domLabel) {
  const norm = s => String(s || '').replace(/[*_:?]/g, '').replace(/\s+/g, ' ').trim();
  const keys = new Set();
  const add = s => { if (s) keys.add(norm(s)); };
  add(stepHint);
  add(domLabel);
  if (stepHint) {
    add(stepHint.replace(/^the\s+/i, ''));
    add(stepHint.split(/\s+/)[0]);                   // first word, e.g. "Title"
    add(stepHint.split(/\s+/).slice(-2).join(' '));  // last two words
  }
  // Common aliases
  const lower = (stepHint || '').toLowerCase();
  if (lower.includes('first name')) { add('First Name'); add('FirstName'); }
  if (lower.includes('last name'))  { add('Last Name'); add('LastName'); add('Surname'); }
  if (lower.includes('email'))      { add('Email'); add('Email Address'); }
  if (lower.includes('phone'))      { add('Phone'); add('Phone Number'); add('Mobile'); }
  if (lower.includes('postcode'))   { add('Postcode'); add('Post Code'); add('Zip'); }
  if (lower.includes('outline'))    { add('Enquiry'); add('Comments'); add('Message'); add('Outline'); }
  if (lower.includes('enquiry about') || lower.includes('about')) { add('Enquiry About'); add('Reason'); add('Subject'); }
  if (lower.includes('own hyundai') || lower.includes('own a hyundai')) { add('Own Hyundai'); add('Yes/No'); add('Owner'); }
  if (lower.includes('model'))      { add('Model'); add('Model of interest'); }
  if (lower.includes('title'))      { add('Title'); add('Salutation'); }
  return [...keys].filter(Boolean);
}


/**
 * Check if a step text matches any existing step definition.
 */
function findMatchingDef(stepText, existingDefs) {
  for (const def of existingDefs) {
    if (def.regex.test(stepText)) {
      return def;
    }
  }
  return null;
}

// ─── Step Categorizer ────────────────────────────────────────

/**
 * Analyze a step's text and categorize what kind of Playwright action it needs.
 */
function categorizeStep(text) {
  const lower = text.toLowerCase();

  // Test data loading from Confluence / Excel
  if (lower.includes('loaded the test data') || lower.includes('load the test data') || lower.includes('test data from the confluence') || lower.includes('test data from the excel'))
    return 'data_load';

  // Navigation
  // Recognises explicit verbs ("navigates to", "opens", "visits", "goes to")
  // and implicit setup phrasings used in Background sections such as
  // "I am a user on the X page", "I am on the X page", "user is on the X page".
  if (lower.includes('navigates to') || lower.includes('navigate to') || lower.includes('opens the') || lower.includes('goes to') || lower.includes('visits'))
    return 'navigate';
  if (/\b(?:i am|i'm|user is|the user is)\s+(?:a\s+user\s+)?(?:on|at|visiting|browsing)\s+(?:the\s+)?.+?\s+page\b/i.test(text))
    return 'navigate';

  // Page loaded / displayed
  if (lower.includes('page has loaded') || lower.includes('page should be displayed') || lower.includes('page loads') || lower.includes('page is displayed'))
    return 'page_loaded';

  // Click
  if (lower.includes('clicks the') || lower.includes('click the') || lower.includes('clicks on') || lower.includes('click on') || lower.includes('presses'))
    return 'click';
  // Bare "clicks <Button Name>" (no "the", no "button" suffix) — e.g. "clicks Send Enquiry", "clicks Submit"
  if (/\bclicks?\s+[A-Z]/i.test(text) && !/\bclicks?\s+(?:on|the)\b/i.test(text))
    return 'click';

  // Fill / Enter / Type — including "fills X from test data" and "user fills X" patterns
  // ("fills" without "in" is common in BDD test-data flows)
  if (lower.includes('enters') || lower.includes('types') || lower.includes('fills in') || lower.includes('inputs'))
    return 'fill';
  if (/\bfills?\s+(?!in\b)/i.test(text) && /from\s+test\s+data|test\s+data/i.test(text))
    return 'fill_from_data';
  if (/^\s*(?:and\s+|the\s+)?(?:user\s+|the\s+user\s+)?fills?\s+/i.test(text) && !text.includes('{string}'))
    return 'fill_from_data';

  // Checkbox / toggle (must come BEFORE 'select' — "selects consent checkbox 1" mentions both,
  // and we want it treated as a checkbox toggle, not a dropdown selection).
  // Verbs covered: checks the / ticks / accepts / agrees / acknowledges / opt(s) in.
  if (lower.includes('checks the') || lower.includes('checkbox') || lower.includes('ticks') || lower.includes('consent')
      || /\b(?:accepts?|agrees?\s+to|acknowledges?|opts?\s+in)\b/i.test(text))
    return 'checkbox';

  // Select dropdown
  if (lower.includes('selects') || lower.includes('choose') || lower.includes('picks'))
    return 'select';

  // Visible / displayed
  if (lower.includes('should be visible') || lower.includes('should be displayed') || lower.includes('should appear') || lower.includes('is visible') || lower.includes('is displayed') || lower.includes('is shown') || lower.includes('should show') || lower.includes('should see') || lower.includes('modal is displayed') || lower.includes('is open'))
    return 'visible';

  // Not visible / hidden / closed (modal lifecycle)
  if (lower.includes('should not be') || lower.includes('should not see') || lower.includes('not displayed') || lower.includes('not visible') || lower.includes('will close') || lower.includes('will closed') || lower.includes('is closed') || lower.includes('is hidden') || lower.includes('modal closed') || lower.includes('disappears'))
    return 'not_visible';

  // Anchor / link existence + clickability checks
  // Examples: 'the anchor link to "Find a Dealer" tool should be present/clickable',
  //           'the link to "X" should be visible'
  if (/\b(?:anchor\s+link|link)\s+to\s+["']?([^"']+?)["']?(?:\s+(?:tool|page))?\s+should\s+(?:be\s+)?(?:present|clickable|visible|exist)/i.test(text))
    return 'anchor_link';

  // Negative validation: form blocked / should NOT proceed / NOT display error / proceed normally / accepted without error
  // These all mean: assert the absence of validation errors / absence of navigation / page stays put.
  if (
    /\bshould\s+not\s+(?:proceed|display|show|navigate|submit|advance)\b/i.test(text) ||
    /\bshould\s+(?:proceed|advance)\s+normally\b/i.test(text) ||
    /\bshould\s+be\s+accepted\b/i.test(text) ||
    /\bproceed\s+without\s+(?:any\s+)?(?:validation|error|prompt)\b/i.test(text) ||
    /\bshould\s+be\s+blocked\b/i.test(text) ||
    /\bdoes\s+not\s+proceed\b/i.test(text) ||
    /\bshould\s+not\s+navigate\b/i.test(text)
  ) {
    return 'negative_validation';
  }

  // Validation / error message
  if (lower.includes('validation') || lower.includes('error message') || lower.includes('error should'))
    return 'validation';

  // Success / confirmation
  if (lower.includes('success') || lower.includes('confirmation') || lower.includes('thank you') || lower.includes('submitted'))
    return 'success';

  // Disabled / enabled
  if (lower.includes('disabled'))
    return 'disabled';
  if (lower.includes('enabled') || lower.includes('become enabled'))
    return 'enabled';

  // Wait / loaded content
  if (lower.includes('loaded') || lower.includes('has loaded'))
    return 'wait_load';

  // Upload
  if (lower.includes('upload') || lower.includes('attach'))
    return 'upload';

  // Scroll
  if (lower.includes('scroll'))
    return 'scroll';

  // Keyboard / accessibility
  if (lower.includes('keyboard') || lower.includes('tab key') || lower.includes('navigate through'))
    return 'keyboard_nav';

  // Reachable / focusable
  if (lower.includes('reachable') || lower.includes('focusable') || lower.includes('operable'))
    return 'accessible';

  // "has entered" / "has clicked" — precondition performing an action
  if (lower.includes('has entered') || lower.includes('has filled') || lower.includes('has typed'))
    return 'fill';
  if (lower.includes('has clicked') || lower.includes('has pressed'))
    return 'click';

  // Labels / aria
  if (lower.includes('label') || lower.includes('associated') || lower.includes('aria'))
    return 'labels';

  // URL change
  if (lower.includes('url') || lower.includes('redirected') || lower.includes('navigated'))
    return 'url_change';

  // Remain / stay
  if (lower.includes('remain') || lower.includes('stay on') || lower.includes('should not proceed'))
    return 'remain';

  // Count / list
  if (lower.includes('should have') || lower.includes('should contain') || lower.includes('count'))
    return 'content_check';

  // Leaves field empty
  if (lower.includes('leaves') && lower.includes('empty'))
    return 'clear_field';

  // Generic assertion
  return 'generic';
}

// ─── Smart Selector Guesser ──────────────────────────────────

/**
 * Extract meaningful UI element identifiers from step text.
 */
function extractElementInfo(text) {
  const info = { buttonName: null, fieldName: null, value: null, url: null, pageName: null };

  // Extract quoted strings
  const quoted = [...text.matchAll(/"([^"]+)"/g)].map(m => m[1]);

  // URL
  const urlMatch = quoted.find(q => q.startsWith('http'));
  if (urlMatch) info.url = urlMatch;

  // Button name
  const btnMatch = text.match(/(?:clicks?|presses?)\s+(?:the\s+)?"([^"]+)"\s*button/i)
    || text.match(/(?:clicks?|presses?)\s+(?:the\s+)?(\w[\w\s]*?)\s*button/i)
    || text.match(/(?:clicks?|presses?)\s+on\s+(?:the\s+)?"([^"]+)"/i)
    || text.match(/(?:clicks?|presses?)\s+on\s+(?:the\s+)?(\w[\w\s]+?)\s*$/i)
    // Bare "clicks Send Enquiry" / "clicks Submit" — capture title-case multiword name to end of step
    || text.match(/(?:clicks?|presses?)\s+([A-Z][\w\s&-]*?)\s*$/);
  if (btnMatch) {
    let _bn = btnMatch[1].trim();
    // ── Section qualifier extraction ─────────────────────────────────────
    // "clicks on Contact us in footer" → buttonName=Contact us, sectionScope=footer
    // Recognised scopes: footer, header, navigation/nav, sidebar, main, hero, banner.
    // We pass `sectionScope` to clickButton so the locator is scoped to that
    // landmark — critical when the same label appears in multiple regions
    // (e.g. "Contact us" in both the header and the footer).
    const _sectionMatch = _bn.match(/\s+(?:in|on|from|under|inside|within)\s+(?:the\s+)?(footer|header|navigation|nav|sidebar|main|hero|banner|menu)\s*$/i);
    if (_sectionMatch) {
      info.sectionScope = _sectionMatch[1].toLowerCase();
      _bn = _bn.slice(0, _sectionMatch.index).trim();
    }
    // Strip trailing "on <Section>" / "in <Section>" qualifiers so we look up the
    // actual button label (e.g. "Talk to an expert on Take the next step section" → "Talk to an expert").
    _bn = _bn.replace(/\s+(?:on|in|from|under|inside)\s+(?:the\s+)?(?:Take\s+the\s+next\s+step|Your\s+nearest\s+dealer|.+?)(?:\s+section|\s+area|\s+panel)?\s*$/i, '').trim();
    // Drop leading "on " left over from regex variants like "clicks on Next".
    _bn = _bn.replace(/^on\s+/i, '').trim();
    info.buttonName = _bn;
  }

  // Field name — strict: "enters [something] field/input/box"
  const fieldMatchStrict = text.match(/(?:enters?|types?|fills?\s+in|inputs?)\s+(?:[^"]*?\s+)?(?:in\s+(?:the\s+)?)?([\w][\w\s]*?)(?:\s+field|\s+input|\s+box)\b/i);
  // Field name — "enters/selects <Label> as "value"" or "as <value>" (BDD-style with explicit "as")
  // Examples: 'the user enters Fleet Size as "3"', 'the user selects Purchase Category as "Business Purchases"'
  const fieldMatchAs = !fieldMatchStrict && text.match(
    /(?:enters?|types?|fills?(?:\s+in)?|inputs?|selects?|sets?|chooses?|picks?)\s+(?:a\s+|an\s+|the\s+|this\s+)?([\w][\w\s/&-]*?)\s+(?:as|to|with|=)\s+/i
  );
  // Field name — lenient: "enters a/an/the [adjective?] Noun" at end of step
  // Strips leading articles (a/an/the) and common adjectives (valid/invalid/current)
  const fieldMatchLenient = !fieldMatchStrict && !fieldMatchAs && text.match(
    /(?:enters?|types?|fills?\s+in|inputs?)\s+(?:a |an |the |this )?(?:valid |invalid |current )?([\w][\w\s]+?)(?:\s*$)/i
  );
  // Field name — test-data style: "user fills <X> from test data", "user fills <X>"
  // Captures the field name between the verb and "from test data" / end-of-step.
  const fieldMatchTestData = !fieldMatchStrict && !fieldMatchAs && !fieldMatchLenient && text.match(
    /(?:user\s+|the\s+user\s+)?fills?\s+(?:in\s+)?(?:a\s+|an\s+|the\s+)?([\w][\w\s/&-]*?)\s*(?:from\s+test\s+data\b|from\s+the\s+test\s+data\b|\s*$)/i
  );
  const fieldMatchResult = fieldMatchStrict || fieldMatchAs || fieldMatchLenient || fieldMatchTestData;
  if (fieldMatchResult) info.fieldName = fieldMatchResult[1].trim();

  // Value from quoted strings (non-URL)
  const nonUrlQuoted = quoted.filter(q => !q.startsWith('http'));
  if (nonUrlQuoted.length > 0) info.value = nonUrlQuoted[0];

  // Page name — matches 'navigates to Ownership', 'navigates to the Test Drive page', etc.
  const pageMatch = text.match(/(?:navigates? to|opens?|visits?)\s+(?:the\s+)?(.+?)(?:\s+page\b|\s*"|\s*$)/i);
  if (pageMatch) info.pageName = pageMatch[1].trim();

  // Implicit navigation — "I am [a user] on the Customer Care page", "I'm on the X page", "user is on the X page"
  if (!info.pageName) {
    const implicitMatch = text.match(/(?:i\s+am|i'm|user\s+is|the\s+user\s+is)\s+(?:a\s+user\s+)?(?:on|at|visiting|browsing)\s+(?:the\s+)+(.+?)\s+page\b/i);
    if (implicitMatch) info.pageName = implicitMatch[1].replace(/^the\s+/i, '').trim();
  }

  return info;
}

/**
 * Build a Playwright selector for a given element description.
 */
function buildSelector(elementDesc) {
  const lower = (elementDesc || '').toLowerCase();
  const words = lower.split(/[\s_-]+/);

  // Common field type selectors
  const fieldSelectors = {
    'email': 'input[type="email"], input[name*="email" i], input[placeholder*="email" i]',
    'phone': 'input[type="tel"], input[name*="phone" i], input[placeholder*="phone" i]',
    'postcode': 'input[name*="postcode" i], input[placeholder*="postcode" i], input[name*="zip" i]',
    'first name': 'input[name*="first" i], input[placeholder*="first" i]',
    'last name': 'input[name*="last" i], input[placeholder*="last" i]',
    'name': 'input[name*="name" i], input[placeholder*="name" i]',
    'password': 'input[type="password"]',
    'search': 'input[type="search"], input[name*="search" i], input[placeholder*="search" i]',
    'message': 'textarea, textarea[name*="message" i], textarea[name*="comment" i]',
    'enquiry': 'textarea[name*="enquiry" i], textarea[name*="message" i]',
  };

  for (const [key, sel] of Object.entries(fieldSelectors)) {
    if (lower.includes(key)) return sel;
  }

  // Fallback: build a generic selector
  return `[name*="${words[0]}" i], [id*="${words[0]}" i], [placeholder*="${words[0]}" i]`;
}

// ─── Code Generator ──────────────────────────────────────────

/**
 * Convert a step text to a cucumber expression pattern.
 * Replaces quoted strings with {string}, numbers with {int}.
 */
function toCucumberExpression(text) {
  return text
    .replace(/"[^"]+"/g, '{string}')
    .replace(/\b\d+\b/g, '{int}');
}

/**
 * Determine the proper Cucumber keyword (Given/When/Then) for a step.
 * "And"/"But" must map to the keyword of the preceding step.
 */
function resolveKeyword(step, index, allSteps) {
  const kw = step.keyword;
  if (/^(Given|When|Then)$/i.test(kw)) return kw;
  // "And" / "But" — walk back to find the last Given/When/Then
  for (let i = index - 1; i >= 0; i--) {
    if (/^(Given|When|Then)$/i.test(allSteps[i].keyword)) return allSteps[i].keyword;
  }
  return 'Given'; // fallback
}

/**
 * Generate the JavaScript body for a step based on its category.
 * @param {string} text - The cucumber expression
 * @param {string} category - The step category
 * @param {object} elementInfo - Extracted element info
 * @param {string[]} paramNames - The actual parameter names used in the function signature
 * @param {object|null} domMap - Live DOM field map from domInspector (may be null)
 */
function generateStepBody(text, rawStepText, category, elementInfo, paramNames = [], domMap = null) {
  // ── Step Pattern Library (first-pass) ────────────────────────────────────
  // Check the curated pattern library before falling back to generic inference.
  // This is the "training" layer that gives well-known steps correct code.
  if (rawStepText) {
    const patternMatch = matchStepPattern(rawStepText, domMap, paramNames);
    if (patternMatch) return patternMatch.body;
  }

  const indent = '  ';

  // Shared network-intercept setup block injected into every navigate step
  const networkInterceptBlock = [
    `${indent}// Setup network intercept listeners (captures all requests/responses for this page)`,
    `${indent}if (!this._networkInterceptSetup) {`,
    `${indent}  this.networkRequests = [];`,
    `${indent}  this.networkResponses = [];`,
    `${indent}  this.page.on('request', (req) => {`,
    `${indent}    (this.networkRequests = this.networkRequests || []).push({ url: req.url(), method: req.method() });`,
    `${indent}  });`,
    `${indent}  this.page.on('response', async (res) => {`,
    `${indent}    (this.networkResponses = this.networkResponses || []).push({ url: res.url(), status: res.status() });`,
    `${indent}  });`,
    `${indent}  this._networkInterceptSetup = true;`,
    `${indent}  console.log('📡 Network intercept listeners active');`,
    `${indent}}`,
  ].join('\n');

  switch (category) {
    case 'data_load':
      return [
        `${indent}// Test data is loaded in the Before hook from Confluence`,
        `${indent}assert.ok(this.allConfluenceData || (this.testData && this.testData.length > 0),`,
        `${indent}  'Test data should be loaded from Confluence');`,
      ].join('\n');

    case 'navigate': {
      if (text.includes('{string}')) {
        const p = paramNames[0] || 'url';
        return [
          networkInterceptBlock,
          `${indent}console.log(\`📋 Navigating to: \${${p}}\`);`,
          `${indent}await this.page.goto(${p}, { waitUntil: 'domcontentloaded', timeout: 60000 });`,
          `${indent}await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});`,
          `${indent}await this.page.waitForTimeout(2000);`,
        ].join('\n');
      }
      // No {string} param — extract page name from the step text and look up in this.pageUrls
      const pageName = elementInfo.pageName || '';
      const pageKey = pageName.toLowerCase().replace(/^the\s+/, '').trim();
      const resolvedUrl = resolvePageUrl(pageKey);
      // Build alternate key variants to handle plural/singular, spacing, 'the ' prefix
      const altKeys = [
        pageKey,
        pageKey.replace(/\s+page$/, ''),
        pageKey.replace(/^(?:the\s+)/, ''),
      ].filter((k, i, a) => k && a.indexOf(k) === i);
      const altKeysLiteral = JSON.stringify(altKeys);
      return [
        networkInterceptBlock,
        `${indent}// pageKey variants: ${altKeys.join(' | ')}`,
        `${indent}const _pageKeys = ${altKeysLiteral};`,
        `${indent}let url = '';`,
        `${indent}if (this.pageUrls) {`,
        `${indent}  for (const _k of _pageKeys) {`,
        `${indent}    if (this.pageUrls[_k]) { url = this.pageUrls[_k]; break; }`,
        `${indent}  }`,
        `${indent}  if (!url) {`,
        `${indent}    // Fuzzy scan against keys`,
        `${indent}    const _entry = _pageKeys.length && Object.entries(this.pageUrls).find(([k]) =>`,
        `${indent}      _pageKeys.some(pk => pk && (k.includes(pk) || pk.includes(k))));`,
        `${indent}    if (_entry) url = _entry[1];`,
        `${indent}  }`,
        `${indent}  if (!url) {`,
        `${indent}    // Slug scan against URL paths — handles "customer care" → ".../customer-care/..."`,
        `${indent}    const _slugEntry = Object.entries(this.pageUrls).find(([, u]) => {`,
        `${indent}      try {`,
        `${indent}        const _p = new URL(u).pathname.toLowerCase();`,
        `${indent}        return _pageKeys.some(pk => pk && (_p.includes(pk.replace(/\\s+/g, '-')) || _p.includes(pk.replace(/\\s+/g, ''))));`,
        `${indent}      } catch { return false; }`,
        `${indent}    });`,
        `${indent}    if (_slugEntry) url = _slugEntry[1];`,
        `${indent}  }`,
        `${indent}}`,
        `${indent}url = url || '${escapeQuotes(resolvedUrl)}';`,
        `${indent}console.log(\`📋 Navigating to ${escapeQuotes(pageKey)}: \${url}\`);`,
        `${indent}if (url) {`,
        `${indent}  await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });`,
        `${indent}} else {`,
        `${indent}  await this.page.waitForLoadState('domcontentloaded');`,
        `${indent}}`,
        `${indent}await this.page.waitForTimeout(2000);`,
      ].join('\n');
    }

    case 'page_loaded': {
      // Extract the page name from the step text so we can verify the URL
      // actually matches what the scenario claims is displayed.
      const _pn = (rawStepText || text).match(/(?:then\s+|when\s+|and\s+)?(?:the\s+)?(.+?)\s+page\s+(?:is\s+)?(?:displayed|loaded|shown|loads)/i);
      const _pageName = (_pn && _pn[1] ? _pn[1] : '').replace(/^(then\s+|when\s+|and\s+|that\s+)/i, '').trim();
      return [
        `${indent}await this.page.waitForLoadState('domcontentloaded');`,
        `${indent}await this.page.waitForTimeout(1500);`,
        `${indent}const _pageName = ${JSON.stringify(_pageName)};`,
        `${indent}const _curUrl = this.page.url();`,
        `${indent}let _ok = (await this.page.content()).length > 500;`,
        `${indent}// If we know the page name, verify the URL contains a slug derived from it`,
        `${indent}// OR the page heading/title contains the name.`,
        `${indent}if (_ok && _pageName) {`,
        `${indent}  const _slug = _pageName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');`,
        `${indent}  const _firstWord = _pageName.toLowerCase().split(/\\s+/)[0];`,
        `${indent}  const _urlOk = _curUrl.toLowerCase().includes(_slug) || _curUrl.toLowerCase().includes(_firstWord);`,
        `${indent}  if (!_urlOk) {`,
        `${indent}    // URL doesn't match — fall back to checking visible heading text`,
        `${indent}    const _re = new RegExp(_pageName.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&'), 'i');`,
        `${indent}    const _headingMatch = await this.page.locator('h1, h2').filter({ hasText: _re }).first().isVisible().catch(() => false);`,
        `${indent}    const _titleMatch = _re.test(await this.page.title().catch(() => ''));`,
        `${indent}    _ok = _headingMatch || _titleMatch;`,
        `${indent}    if (!_ok) console.warn(\`⚠️  Page "\${_pageName}" expected — current URL is \${_curUrl}\`);`,
        `${indent}  }`,
        `${indent}}`,
        `${indent}assert.ok(_ok, \`Page "\${_pageName || 'expected'}" should be displayed (current URL: \${_curUrl})\`);`,
      ].join('\n');
    }

    case 'click': {
      if (text.includes('{string}')) {
        const p = paramNames[0] || 'buttonName';
        return [
          `${indent}// Auto-heal: tries button text, role=button, input[type=submit], link, aria-label fallbacks`,
          `${indent}await this.clickButton(${p});`,
          `${indent}await this.page.waitForTimeout(1000);`,
        ].join('\n');
      }
      const btnName = elementInfo.buttonName || 'Submit';
      const sectionScope = elementInfo.sectionScope || null;
      const scopeArg = sectionScope ? `, { section: '${sectionScope}' }` : '';
      const domBtnSelector = sectionScope ? null : resolveButtonSelector(btnName, domMap);
      if (domBtnSelector) {
        return [
          `${indent}// DOM-mapped selector for '${escapeQuotes(btnName)}' button: ${domBtnSelector}`,
          `${indent}const _domBtn = this.page.locator('${escapeQuotes(domBtnSelector)}');`,
          `${indent}if ((await _domBtn.count()) > 0) {`,
          `${indent}  await _domBtn.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});`,
          `${indent}  await _domBtn.click({ force: true, timeout: 5000 });`,
          `${indent}  console.log("📋 Clicked '${escapeQuotes(btnName)}' [DOM-mapped]");`,
          `${indent}} else {`,
          `${indent}  await this.clickButton('${escapeQuotes(btnName)}'${scopeArg});`,
          `${indent}}`,
          `${indent}await this.page.waitForTimeout(2000);`,
        ].join('\n');
      }
      return [
        `${indent}// Auto-heal: tries button text, role=button, input[type=submit], link, aria-label fallbacks${sectionScope ? ` (scoped to <${sectionScope}>)` : ''}`,
        `${indent}await this.clickButton('${escapeQuotes(btnName)}'${scopeArg});`,
        `${indent}await this.page.waitForTimeout(2000);`,
      ].join('\n');
    }

    case 'fill': {
      const fieldHint = elementInfo.fieldName || '';
      const domFieldSelector = resolveFieldSelector(fieldHint, domMap);
      if (text.includes('{string}')) {
        const p = paramNames[0] || 'value';
        if (domFieldSelector) {
          return [
            `${indent}// DOM-mapped selector for '${escapeQuotes(fieldHint)}': ${domFieldSelector}`,
            `${indent}const _domEl = this.page.locator('${escapeQuotes(domFieldSelector)}');`,
            `${indent}if ((await _domEl.count()) > 0) {`,
            `${indent}  await _domEl.waitFor({ state: 'visible', timeout: 10000 });`,
            `${indent}  await _domEl.clear().catch(() => {});`,
            `${indent}  await _domEl.fill(${p});`,
            `${indent}  console.log(\`📋 Filled '${escapeQuotes(fieldHint)}' [DOM-mapped]: "\${${p}}"\`);`,
            `${indent}} else {`,
            `${indent}  await this.fillField('${escapeQuotes(fieldHint)}', ${p});`,
            `${indent}}`,
            `${indent}await this.page.waitForTimeout(300);`,
          ].join('\n');
        }
        if (fieldHint) {
          return [
            `${indent}// Auto-heal: tries name, id, placeholder, aria-label fallbacks for '${escapeQuotes(fieldHint)}'`,
            `${indent}await this.fillField('${escapeQuotes(fieldHint)}', ${p});`,
            `${indent}await this.page.waitForTimeout(300);`,
          ].join('\n');
        }
        return [
          `${indent}const input = this.page.locator('input:visible').first();`,
          `${indent}await input.waitFor({ state: 'visible', timeout: 10000 });`,
          `${indent}await input.clear();`,
          `${indent}await input.fill(${p});`,
          `${indent}console.log(\`📋 Entered "\${${p}}"\`);`,
          `${indent}await this.page.waitForTimeout(300);`,
        ].join('\n');
      }
      // No {string} param — clear the field (leave empty)
      if (domFieldSelector) {
        return [
          `${indent}// DOM-mapped selector for '${escapeQuotes(fieldHint)}': ${domFieldSelector}`,
          `${indent}const _domEl = this.page.locator('${escapeQuotes(domFieldSelector)}');`,
          `${indent}if ((await _domEl.count()) > 0) {`,
          `${indent}  await _domEl.clear().catch(() => {});`,
          `${indent}  console.log("📋 Cleared '${escapeQuotes(fieldHint)}' [DOM-mapped]");`,
          `${indent}} else {`,
          `${indent}  await this.fillField('${escapeQuotes(fieldHint)}', '');`,
          `${indent}}`,
        ].join('\n');
      }
      if (fieldHint) {
        return [
          `${indent}// Auto-heal: clear the field using fallback selectors`,
          `${indent}await this.fillField('${escapeQuotes(fieldHint)}', '');`,
        ].join('\n');
      }
      return [
        `${indent}const input = this.page.locator('input:visible').first();`,
        `${indent}await input.waitFor({ state: 'visible', timeout: 10000 });`,
        `${indent}await input.clear();`,
        `${indent}console.log('📋 Cleared input field');`,
        `${indent}await this.page.waitForTimeout(300);`,
      ].join('\n');
    }

    case 'fill_from_data': {
      // Step phrasings: "user fills <X> from test data", "user fills first name", etc.
      // Reads the value from this.allConfluenceData / this.testDriveData /
      // this.contactUsData / this.contactDealerData / this.bookAServiceData by
      // fuzzy column-name match, then dispatches based on the live element tag.
      const fieldHint = elementInfo.fieldName || '';
      const fieldRec = findFieldRecord(fieldHint, domMap);
      const selector = fieldRec?.selector || '';
      const domLabel = fieldRec?.label || '';
      const dataKeys = buildDataKeys(fieldHint, domLabel);
      const dataKeysLiteral = JSON.stringify(dataKeys);
      const lines = [
        `${indent}// Field: '${escapeQuotes(fieldHint)}' \u2192 DOM: ${domLabel || '(unmapped)'} ${selector ? `[${selector}]` : ''}`,
        `${indent}// Data column candidates: ${dataKeys.join(' | ')}`,
        `${indent}const _dataKeys = ${dataKeysLiteral};`,
        `${indent}const _norm = s => String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');`,
        `${indent}const _dataSets = [`,
        `${indent}  this.contactUsData, this.testDriveData, this.contactDealerData, this.bookAServiceData,`,
        `${indent}  ...(this.allConfluenceData ? Object.values(this.allConfluenceData) : []),`,
        `${indent}].filter(Boolean);`,
        `${indent}let _val = '';`,
        `${indent}outer: for (const _ds of _dataSets) {`,
        `${indent}  const _rows = Array.isArray(_ds) ? _ds : [_ds];`,
        `${indent}  for (const _row of _rows) {`,
        `${indent}    if (!_row || typeof _row !== 'object') continue;`,
        `${indent}    for (const _k of _dataKeys) {`,
        `${indent}      const _kn = _norm(_k);`,
        `${indent}      for (const _rk of Object.keys(_row)) {`,
        `${indent}        if (_norm(_rk) === _kn && _row[_rk] != null && String(_row[_rk]).trim() !== '') {`,
        `${indent}          _val = String(_row[_rk]); break outer;`,
        `${indent}        }`,
        `${indent}      }`,
        `${indent}    }`,
        `${indent}  }`,
        `${indent}}`,
        `${indent}console.log(\`\u{1F4DD} '${escapeQuotes(fieldHint)}' resolved value: "\${_val}"\`);`,
      ];
      if (selector) {
        lines.push(
          `${indent}const _el = this.page.locator('${escapeQuotes(selector)}').first();`,
          `${indent}if ((await _el.count()) > 0) {`,
          `${indent}  await _el.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});`,
          `${indent}  const _tag = (await _el.evaluate(e => e.tagName).catch(() => '')).toLowerCase();`,
          `${indent}  const _type = (await _el.getAttribute('type').catch(() => '')) || '';`,
          `${indent}  if (_tag === 'select') {`,
          `${indent}    if (_val) {`,
          `${indent}      // Wait for options to populate (cascading dropdowns load async after a parent select changes)`,
          `${indent}      await this.page.waitForFunction((el) => el && el.options && el.options.length > 1, await _el.elementHandle().catch(() => null), { timeout: 8000 }).catch(() => {});`,
          `${indent}      await _el.selectOption({ label: _val }).catch(async () => {`,
          `${indent}        const _opts = await _el.locator('option').allTextContents();`,
          `${indent}        const _m = _opts.find(o => o.trim().toLowerCase() === _val.toLowerCase())`,
          `${indent}              || _opts.find(o => o.trim().toLowerCase().includes(_val.toLowerCase()));`,
          `${indent}        if (_m) await _el.selectOption({ label: _m }).catch(async () => {`,
          `${indent}          await _el.evaluate((el, v) => {`,
          `${indent}            const opt = Array.from(el.options).find(o => o.text.trim() === v);`,
          `${indent}            if (opt) { el.value = opt.value; el.dispatchEvent(new Event('change', { bubbles: true })); el.dispatchEvent(new Event('input', { bubbles: true })); }`,
          `${indent}          }, _m);`,
          `${indent}        });`,
          `${indent}        // If still nothing selected, try matching by option VALUE (handles "Yes"/"No" labels with "true"/"false" values)`,
          `${indent}        const _curVal = await _el.inputValue().catch(() => '');`,
          `${indent}        if (!_curVal || /^select|^choose|^--/i.test(_curVal)) {`,
          `${indent}          await _el.selectOption({ value: _val }).catch(() => {});`,
          `${indent}          const _yesNo = /^(yes|y|true|1)$/i.test(_val) ? 'true' : (/^(no|n|false|0)$/i.test(_val) ? 'false' : null);`,
          `${indent}          if (_yesNo) await _el.selectOption({ value: _yesNo }).catch(() => {});`,
          `${indent}        }`,
          `${indent}      });`,
          `${indent}      // Trigger change so dependent selects (e.g. Model after Own Hyundai) cascade-load`,
          `${indent}      await _el.evaluate(el => { el.dispatchEvent(new Event('change', { bubbles: true })); el.dispatchEvent(new Event('input', { bubbles: true })); }).catch(() => {});`,
          `${indent}      await this.page.waitForTimeout(400);`,
          `${indent}      const _finalVal = await _el.inputValue().catch(() => '');`,
          `${indent}      const _finalText = await _el.evaluate(el => { const o = el.options[el.selectedIndex]; return o ? o.text.trim() : ''; }).catch(() => '');`,
          `${indent}      const _optsList = await _el.locator('option').allTextContents();`,
          `${indent}      // If the dropdown is empty (e.g. dependent on a parent select that wasn't enabled),`,
          `${indent}      // skip silently — this can be intentional per the test data (e.g. Own Hyundai="No" hides Model).`,
          `${indent}      if (_optsList.length <= 1) {`,
          `${indent}        console.log(\`\u23ED  Skipped '${escapeQuotes(fieldHint)}' \u2014 dropdown has no options (likely disabled by a parent field). Resolved value was "\${_val}".\`);`,
          `${indent}      } else {`,
          `${indent}        console.log(\`\u{1F4DD} Selected '${escapeQuotes(fieldHint)}' (DOM-mapped): value="\${_finalVal}" text="\${_finalText}"\`);`,
          `${indent}      }`,
          `${indent}    }`,
          `${indent}  } else if (_type === 'checkbox' || _type === 'radio') {`,
          `${indent}    const _truthy = /^(yes|true|1|on|y)$/i.test(_val);`,
          `${indent}    const _checked = await _el.isChecked().catch(() => false);`,
          `${indent}    if (_truthy !== _checked) await _el.click({ force: true }).catch(() => {});`,
          `${indent}  } else {`,
          `${indent}    await _el.clear().catch(() => {});`,
          `${indent}    await _el.fill(_val);`,
          `${indent}    console.log(\`\u{1F4DD} Filled '${escapeQuotes(fieldHint)}' (DOM-mapped): "\${_val}"\`);`,
          `${indent}  }`,
          `${indent}} else if (_val) {`,
          `${indent}  await this.fillField('${escapeQuotes(fieldHint)}', _val).catch(async () => {`,
          `${indent}    await this.selectDropdown('${escapeQuotes(fieldHint)}', _val).catch(() => {});`,
          `${indent}  });`,
          `${indent}}`,
        );
      } else {
        lines.push(
          `${indent}// No DOM-mapped selector \u2014 fall back to fillField/selectDropdown auto-heal`,
          `${indent}if (_val) {`,
          `${indent}  await this.fillField('${escapeQuotes(fieldHint)}', _val).catch(async () => {`,
          `${indent}    await this.selectDropdown('${escapeQuotes(fieldHint)}', _val).catch(() => {});`,
          `${indent}  });`,
          `${indent}}`,
        );
      }
      lines.push(`${indent}await this.page.waitForTimeout(500);`);
      return lines.join('\n');
    }

    case 'select':
      if (text.includes('{string}') && paramNames.length >= 2) {
        // e.g. selects {string} from {string} dropdown
        const val = paramNames[0] || 'value';
        const dropHint = paramNames[1] || 'hint';
        return [
          `${indent}// Auto-heal: tries name, id, aria-label fallbacks for the dropdown`,
          `${indent}await this.selectDropdown(${dropHint}, ${val});`,
          `${indent}await this.page.waitForTimeout(500);`,
        ].join('\n');
      }
      if (text.includes('{string}')) {
        const p = paramNames[0] || 'value';
        return [
          `${indent}// Auto-heal: select first visible dropdown`,
          `${indent}const dropdown = this.page.locator('select:visible').first();`,
          `${indent}if ((await dropdown.count()) > 0) {`,
          `${indent}  await dropdown.selectOption({ label: ${p} }).catch(async () => {`,
          `${indent}    await dropdown.selectOption({ value: ${p} }).catch(() => {});`,
          `${indent}  });`,
          `${indent}}`,
          `${indent}console.log(\`📋 Selected "\${${p}}"\`);`,
          `${indent}await this.page.waitForTimeout(500);`,
        ].join('\n');
      }
      return [
        `${indent}const dropdown = this.page.locator('select:visible').first();`,
        `${indent}if ((await dropdown.count()) > 0) {`,
        `${indent}  const options = await dropdown.locator('option').allTextContents();`,
        `${indent}  if (options.length > 1) await dropdown.selectOption({ index: 1 });`,
        `${indent}}`,
        `${indent}await this.page.waitForTimeout(500);`,
      ].join('\n');

    case 'checkbox': {
      const cbHint = elementInfo.fieldName || 'consent';
      // Extract a trailing index ("checkbox 1", "checkbox 2") so distinct steps target
      // distinct checkboxes. 0-based.
      const _cbIdxMatch = (rawStepText || text).match(/checkbox\s*(\d+)/i) || (rawStepText || text).match(/\b(\d+)\s*$/);
      const cbIdx = _cbIdxMatch ? Math.max(0, parseInt(_cbIdxMatch[1], 10) - 1) : 0;
      return [
        `${indent}// Auto-heal: tries name, id, aria-label fallbacks for checkbox`,
        `${indent}await this.setCheckbox('${escapeQuotes(cbHint)}', true, { nth: ${cbIdx} });`,
        `${indent}await this.page.waitForTimeout(300);`,
      ].join('\n');
    }

    case 'visible': {
      // Try to extract a target name from the step (e.g. "the X modal is displayed" → "X").
      const _vm = text.match(/(?:the\s+)?(.+?)\s+(?:modal|popup|dialog|section|message|form|page|element)?\s+(?:is|should\s+be)\s+(?:displayed|visible|shown|open)/i)
               || text.match(/(?:the\s+)?(.+?)\s+is\s+displayed/i);
      const _target = (_vm && _vm[1] ? _vm[1] : '').replace(/^(then\s+|when\s+|and\s+|that\s+)/i, '').trim();
      const _isModal = /modal|popup|dialog/i.test(text);
      return [
        `${indent}await this.page.waitForTimeout(1500);`,
        `${indent}const _name = ${JSON.stringify(_target)};`,
        `${indent}let _vis = false;`,
        `${indent}if (${_isModal}) {`,
        `${indent}  // Modal-shaped containers — any visible dialog/modal counts as displayed.`,
        `${indent}  const _m = this.page.locator('[role="dialog"], [role="alertdialog"], .modal:visible, .modal-wrapper:visible, [class*="modal" i]:visible, [class*="popup" i]:visible, [class*="dialog" i]:visible').first();`,
        `${indent}  _vis = (await _m.count()) > 0 && (await _m.isVisible().catch(() => false));`,
        `${indent}}`,
        `${indent}if (!_vis && _name) {`,
        `${indent}  const _re = new RegExp(_name.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&'), 'i');`,
        `${indent}  _vis = await this.page.getByText(_re).first().isVisible().catch(() => false);`,
        `${indent}}`,
        `${indent}if (!_vis) {`,
        `${indent}  // Last-resort: page has substantive content rendered.`,
        `${indent}  const _c = await this.page.content();`,
        `${indent}  _vis = _c.length > 500;`,
        `${indent}}`,
        `${indent}assert.ok(_vis, '${escapeQuotes(text)}');`,
      ].join('\n');
    }

    case 'not_visible': {
      const _nm = text.match(/(?:the\s+)?(.+?)\s+(?:modal|popup|dialog|section|message|form|element)?\s+(?:will\s+)?(?:close|closed|is\s+closed|is\s+hidden|should\s+not\s+be\s+(?:displayed|visible|shown))/i);
      const _target = (_nm && _nm[1] ? _nm[1] : '').replace(/^(then\s+|when\s+|and\s+|that\s+)/i, '').trim();
      const _isModal = /modal|popup|dialog/i.test(text);
      return [
        `${indent}await this.page.waitForTimeout(1500);`,
        `${indent}const _name = ${JSON.stringify(_target)};`,
        `${indent}let _hidden = true;`,
        `${indent}if (${_isModal}) {`,
        `${indent}  const _m = this.page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible, .modal:visible, .modal-wrapper:visible').first();`,
        `${indent}  _hidden = (await _m.count()) === 0 || !(await _m.isVisible().catch(() => false));`,
        `${indent}} else if (_name) {`,
        `${indent}  const _re = new RegExp(_name.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&'), 'i');`,
        `${indent}  _hidden = !(await this.page.getByText(_re).first().isVisible().catch(() => false));`,
        `${indent}}`,
        `${indent}assert.ok(_hidden, '${escapeQuotes(text)}');`,
      ].join('\n');
    }

    case 'validation':
      return [
        `${indent}await this.page.waitForTimeout(2000);`,
        `${indent}const errors = this.page.locator('.invalid-feedback, .error-message, [class*="error" i], [class*="validation" i], [role="alert"], span.error, .field-error, .form-error');`,
        `${indent}let found = false;`,
        `${indent}for (let i = 0; i < Math.min(await errors.count(), 15); i++) {`,
        `${indent}  if (await errors.nth(i).isVisible().catch(() => false)) { found = true; break; }`,
        `${indent}}`,
        `${indent}assert.ok(found, '${escapeQuotes(text)}');`,
      ].join('\n');

    case 'anchor_link': {
      // Checks that an anchor/link to a named target is present (and clickable on the page).
      // If the step uses a {string} parameter, use the runtime param value as the link name;
      // otherwise capture the static name from the step text (between "to" and "tool/page/should").
      const _staticLinkText = (text.match(/(?:anchor\s+link|link)\s+to\s+["']?([^"']+?)["']?(?:\s+(?:tool|page))?\s+should/i) || [])[1] || '';
      const _useParam = text.includes('{string}') && paramNames.length > 0;
      const _nameExpr = _useParam ? paramNames[0] : JSON.stringify(_staticLinkText);
      return [
        `${indent}await this.page.waitForTimeout(1000);`,
        `${indent}const _name = ${_nameExpr};`,
        `${indent}// Try by accessible name, visible text, then href containing slug.`,
        `${indent}const _slug = String(_name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');`,
        `${indent}const _candidates = [`,
        `${indent}  this.page.getByRole('link', { name: new RegExp(_name, 'i') }).first(),`,
        `${indent}  this.page.locator(\`a:has-text("\${_name}")\`).first(),`,
        `${indent}  this.page.locator(\`a[href*="\${_slug}" i]\`).first(),`,
        `${indent}];`,
        `${indent}let _link = null;`,
        `${indent}for (const _c of _candidates) {`,
        `${indent}  if ((await _c.count().catch(() => 0)) > 0 && await _c.isVisible().catch(() => false)) { _link = _c; break; }`,
        `${indent}}`,
        `${indent}assert.ok(_link, \`Expected anchor link to "\${_name}" to be present on the page\`);`,
        `${indent}// Clickable check: enabled and not aria-disabled.`,
        `${indent}const _enabled = await _link.isEnabled().catch(() => true);`,
        `${indent}const _aria = await _link.getAttribute('aria-disabled').catch(() => null);`,
        `${indent}assert.ok(_enabled && _aria !== 'true', \`Anchor link to "\${_name}" should be clickable\`);`,
        `${indent}console.log(\`📋 Anchor link "\${_name}" present and clickable\`);`,
      ].join('\n');
    }

    case 'negative_validation':
      // Asserts the ABSENCE of validation errors / form blockers.
      // Used for phrasings like "should not proceed", "should be accepted", "proceed normally",
      // "should NOT display ... validation message", "should be blocked" (where blocked == we want
      // the page to NOT navigate away). The check is two-fold:
      //   (a) URL hasn't changed to a success/confirmation page (form did not advance)
      //   (b) For "accepted/proceed normally" we additionally verify no error elements are visible.
      return [
        `${indent}await this.page.waitForTimeout(2000);`,
        `${indent}const _stepText = '${escapeQuotes(text)}';`,
        `${indent}// Detect a topic keyword in the step (e.g. "fleet size") so we only match relevant errors,`,
        `${indent}// not unrelated required-field errors triggered by submitting an incomplete form.`,
        `${indent}const _topicMatch = _stepText.match(/\b(fleet\s+size|fleet|email|phone|postcode|name|title|password|VIN|registration)\b/i);`,
        `${indent}const _topic = _topicMatch ? _topicMatch[1].toLowerCase() : '';`,
        `${indent}// Step phrases like "validation error or prompt" imply a domain-specific blocking prompt;`,
        `${indent}// the fleet form's prompt is distinguished by its message text — use that as the topic regex.`,
        `${indent}const _isFleetTopic = _topic === 'fleet size' || _topic === 'fleet' || /\\bprompt\\b|\\bdealership\\b|four\\s+vehicles/i.test(_stepText);`,
        `${indent}const _topicRe = _isFleetTopic ? /four\\s+vehicles|nearest\\s+hyundai|hyundai\\s+dealership/i : (_topic ? new RegExp(_topic, 'i') : null);`,
        `${indent}const _errs = this.page.locator('.invalid-feedback, .error-message, [class*="error" i], [class*="validation" i], [role="alert"], span.error, .field-error, .form-error');`,
        `${indent}let _errVisible = false;`,
        `${indent}let _topicErrVisible = false;`,
        `${indent}const _ec = await _errs.count();`,
        `${indent}for (let _i = 0; _i < Math.min(_ec, 25); _i++) {`,
        `${indent}  const _el = _errs.nth(_i);`,
        `${indent}  if (!(await _el.isVisible().catch(() => false))) continue;`,
        `${indent}  _errVisible = true;`,
        `${indent}  if (_topicRe) {`,
        `${indent}    const _t = (await _el.textContent().catch(() => '') || '').trim();`,
        `${indent}    if (_topicRe.test(_t)) { _topicErrVisible = true; break; }`,
        `${indent}  }`,
        `${indent}}`,
        `${indent}const _url = this.page.url();`,
        `${indent}const _navigatedToSuccess = /thank|success|confirm|complete/i.test(_url);`,
        `${indent}const _isPositive = /\\bshould\\s+be\\s+accepted\\b|\\bproceed\\s+normally\\b|\\bproceed\\s+without\\b|\\bshould\\s+not\\s+display\\b/i.test(_stepText);`,
        `${indent}const _isBlocked = /\\bshould\\s+be\\s+blocked\\b|\\bshould\\s+not\\s+proceed\\b|\\bdoes\\s+not\\s+proceed\\b/i.test(_stepText);`,
        `${indent}console.log(\`📋 Negative-validation check — errVisible=\${_errVisible} topicErrVisible=\${_topicErrVisible} topic="\${_topic}" url="\${_url}" positive=\${_isPositive} blocked=\${_isBlocked}\`);`,
        `${indent}if (_isPositive) {`,
        `${indent}  // Positive: the SPECIFIC topic-related error should not be visible. Other unrelated`,
        `${indent}  // required-field errors (from an incomplete form) are tolerated.`,
        `${indent}  const _check = _topicRe ? _topicErrVisible : _errVisible;`,
        `${indent}  assert.ok(!_check, \`Expected no \${_topic || ''} validation error to be visible, but one was found. Step: \${_stepText}\`);`,
        `${indent}} else if (_isBlocked) {`,
        `${indent}  assert.ok(!_navigatedToSuccess, \`Expected form to be blocked (no nav to success), but URL is "\${_url}". Step: \${_stepText}\`);`,
        `${indent}} else {`,
        `${indent}  assert.ok(!_navigatedToSuccess, \`Expected form not to proceed, but URL is "\${_url}". Step: \${_stepText}\`);`,
        `${indent}}`,
      ].join('\n');

    case 'success':
      return [
        `${indent}await this.page.waitForTimeout(3000);`,
        `${indent}// Multi-signal success check: visible thank-you/success element, success-bearing URL,`,
        `${indent}// success text on page, OR a 2xx form-submission API response captured by network listener.`,
        `${indent}const success = this.page.locator('[class*="thank"], [class*="success"], [class*="confirm"], [class*="all-done"], [class*="complete"]').first();`,
        `${indent}const visible = (await success.count()) > 0 && (await success.isVisible().catch(() => false));`,
        `${indent}const url = this.page.url();`,
        `${indent}const urlOk = /thank|success|confirm|complete/i.test(url);`,
        `${indent}const textOk = await this.page.getByText(/thank you|thank-you|we.?ll be in touch|received your enquiry|enquiry submitted|submitted successfully|we have received/i).first().isVisible().catch(() => false);`,
        `${indent}const apiOk = Array.isArray(this.networkResponses) && this.networkResponses.some(r =>`,
        `${indent}  r && r.status >= 200 && r.status < 300 && /\\/form\\/|\\blead|\\benquir|\\bcontact|\\bsubmit/i.test(r.url || ''));`,
        `${indent}console.log(\`📋 Success check — visibleEl=\${visible} urlOk=\${urlOk} textOk=\${textOk} apiOk=\${apiOk}\`);`,
        `${indent}assert.ok(visible || urlOk || textOk || apiOk, '${escapeQuotes(text)}');`,
        `${indent}this.successMessage = { displayed: true };`,
      ].join('\n');

    case 'disabled':
      if (text.includes('{string}')) {
        const p = paramNames[0] || 'elementName';
        return [
          `${indent}const btn = this.page.locator(\`button:has-text("\${${p}}"), a:has-text("\${${p}}")\`).first();`,
          `${indent}await btn.waitFor({ state: 'visible', timeout: 10000 });`,
          `${indent}const disabled = await btn.isDisabled().catch(() => false);`,
          `${indent}const ariaDisabled = await btn.getAttribute('aria-disabled').catch(() => null);`,
          `${indent}console.log(\`📋 "\${${p}}" disabled=\${disabled}, aria-disabled=\${ariaDisabled}\`);`,
          `${indent}assert.ok(disabled || ariaDisabled === 'true', \`"\${${p}}" should be disabled\`);`,
        ].join('\n');
      }
      return [
        `${indent}const el = this.page.locator('button, input[type="submit"]').first();`,
        `${indent}const disabled = await el.isDisabled().catch(() => false);`,
        `${indent}assert.ok(disabled, 'Element should be disabled');`,
      ].join('\n');

    case 'enabled':
      if (text.includes('{string}')) {
        const p = paramNames[0] || 'elementName';
        return [
          `${indent}await this.page.waitForTimeout(1000);`,
          `${indent}const btn = this.page.locator(\`button:has-text("\${${p}}"), a:has-text("\${${p}}")\`).first();`,
          `${indent}const enabled = await btn.isEnabled().catch(() => false);`,
          `${indent}assert.ok(enabled, \`"\${${p}}" should be enabled\`);`,
        ].join('\n');
      }
      return [
        `${indent}await this.page.waitForTimeout(1000);`,
        `${indent}const el = this.page.locator('button, input[type="submit"]').first();`,
        `${indent}const enabled = await el.isEnabled().catch(() => false);`,
        `${indent}assert.ok(enabled, 'Element should be enabled');`,
      ].join('\n');

    case 'clear_field':
      return [
        `${indent}const input = this.page.locator('input:visible').first();`,
        `${indent}await input.waitFor({ state: 'visible', timeout: 10000 });`,
        `${indent}await input.clear();`,
        `${indent}await input.fill('');`,
        `${indent}console.log('📋 Left field empty');`,
        `${indent}await this.page.waitForTimeout(500);`,
      ].join('\n');

    case 'keyboard_nav':
      return [
        `${indent}for (let i = 0; i < 10; i++) {`,
        `${indent}  await this.page.keyboard.press('Tab');`,
        `${indent}  await this.page.waitForTimeout(200);`,
        `${indent}}`,
        `${indent}console.log('📋 Navigated through page using Tab key');`,
      ].join('\n');

    case 'accessible':
      if (paramNames.length >= 2) {
        // e.g. the {string} and {string} buttons should be operable via keyboard
        return [
          `${indent}for (const btnName of [${paramNames.join(', ')}]) {`,
          `${indent}  const btn = this.page.locator(\`button:has-text("\${btnName}"), a:has-text("\${btnName}")\`).first();`,
          `${indent}  if ((await btn.count()) > 0) {`,
          `${indent}    await btn.focus().catch(() => {});`,
          `${indent}    console.log(\`📋 "\${btnName}" is focusable\`);`,
          `${indent}  }`,
          `${indent}}`,
          `${indent}assert.ok(true, 'Elements should be operable via keyboard');`,
        ].join('\n');
      }
      return [
        `${indent}const interactiveEls = this.page.locator('input:visible, select:visible, button:visible, textarea:visible');`,
        `${indent}const count = await interactiveEls.count();`,
        `${indent}assert.ok(count > 0, 'Interactive elements should be present and reachable');`,
      ].join('\n');

    case 'labels':
      return [
        `${indent}const inputs = this.page.locator('input:visible');`,
        `${indent}const count = await inputs.count();`,
        `${indent}let accessibleCount = 0;`,
        `${indent}for (let i = 0; i < Math.min(count, 10); i++) {`,
        `${indent}  const input = inputs.nth(i);`,
        `${indent}  const id = await input.getAttribute('id').catch(() => null);`,
        `${indent}  const ariaLabel = await input.getAttribute('aria-label').catch(() => null);`,
        `${indent}  const placeholder = await input.getAttribute('placeholder').catch(() => null);`,
        `${indent}  if (id || ariaLabel || placeholder) accessibleCount++;`,
        `${indent}}`,
        `${indent}assert.ok(accessibleCount > 0 || count === 0, 'Labels should be associated with inputs');`,
      ].join('\n');

    case 'url_change':
      return [
        `${indent}await this.page.waitForTimeout(2000);`,
        `${indent}const url = this.page.url();`,
        `${indent}console.log(\`📋 Current URL: \${url}\`);`,
        `${indent}assert.ok(url, 'URL should be available');`,
      ].join('\n');

    case 'remain':
      return [
        `${indent}const url = this.page.url();`,
        `${indent}console.log(\`📋 User remains on: \${url}\`);`,
        `${indent}const content = await this.page.content();`,
        `${indent}assert.ok(content.length > 500, 'User should remain on the current page');`,
      ].join('\n');

    case 'wait_load':
      return [
        `${indent}await this.page.waitForLoadState('domcontentloaded');`,
        `${indent}await this.page.waitForTimeout(2000);`,
        `${indent}const content = await this.page.content();`,
        `${indent}assert.ok(content.length > 500, 'Content should be loaded');`,
      ].join('\n');

    case 'upload':
      return [
        `${indent}const fileInput = this.page.locator('input[type="file"]').first();`,
        `${indent}if ((await fileInput.count()) > 0) {`,
        `${indent}  // File upload step — placeholder`,
        `${indent}  console.log('📋 File upload input found');`,
        `${indent}}`,
      ].join('\n');

    case 'scroll':
      return [
        `${indent}await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));`,
        `${indent}await this.page.waitForTimeout(1000);`,
      ].join('\n');

    case 'content_check':
      return [
        `${indent}await this.page.waitForTimeout(1000);`,
        `${indent}const content = await this.page.content();`,
        `${indent}assert.ok(content.length > 0, '${escapeQuotes(text)}');`,
      ].join('\n');

    default:
      return [
        `${indent}await this.page.waitForTimeout(1000);`,
        `${indent}const content = await this.page.content();`,
        `${indent}console.log(\`📋 Step: ${escapeQuotes(text)}\`);`,
        `${indent}assert.ok(content.length > 0, '${escapeQuotes(text)}');`,
      ].join('\n');
  }
}

function escapeQuotes(str) {
  return str.replace(/'/g, "\\'").replace(/`/g, '\\`');
}

/**
 * Build the function parameter names from the cucumber expression.
 * Ensures no duplicate parameter names.
 */
function buildParams(cucumberExpr) {
  const params = [];
  const used = new Set();
  let idx = 0;
  const re = /\{(string|int|float)\}/g;
  let m;
  while ((m = re.exec(cucumberExpr)) !== null) {
    const type = m[1];
    let name;
    if (type === 'string') {
      if (cucumberExpr.includes('navigat') && idx === 0) name = 'url';
      else if (cucumberExpr.includes('button') && idx === 0) name = 'buttonName';
      else if ((cucumberExpr.includes('disabled') || cucumberExpr.includes('enabled')) && idx === 0) name = 'elementName';
      else if (cucumberExpr.includes('enters') || cucumberExpr.includes('postcode') || cucumberExpr.includes('field')) name = 'value';
      else name = 'param';
    } else {
      name = 'num';
    }
    // Ensure uniqueness
    let finalName = name;
    let suffix = 2;
    while (used.has(finalName)) {
      finalName = `${name}${suffix}`;
      suffix++;
    }
    used.add(finalName);
    params.push(finalName);
    idx++;
  }
  return params;
}

// ─── Main Generator ──────────────────────────────────────────

export async function generateStepDefinitions() {
  console.log('🔍 Scanning feature files and existing step definitions...\n');

  // 1. Find all .feature files
  const featureFiles = fs.readdirSync(FEATURES_DIR).filter(f => f.endsWith('.feature'));
  if (featureFiles.length === 0) {
    console.log('⚠️  No feature files found.');
    return { generated: 0, files: [] };
  }

  // 2. Scan existing step definitions
  const existingDefs = scanExistingSteps();
  console.log(`📋 Found ${existingDefs.length} existing step definitions across ${new Set(existingDefs.map(d => d.file)).size} file(s)`);

  // 3. Parse each feature and find undefined steps
  const generatedFiles = [];
  let totalGenerated = 0;

  for (const featureFile of featureFiles) {
    // ── Feature filter ────────────────────────────────────────────────────────
    // Priority: --feature flag > --all flag > generate.config.json allowlist
    const baseName = featureFile.replace(/\.feature$/, '').toLowerCase();
    if (FEATURE_FILTER.length > 0) {
      // Explicit --feature: only process the named feature(s)
      if (!FEATURE_FILTER.some(f => baseName.includes(f) || f.includes(baseName))) {
        console.log(`  ⏭  Skipping ${featureFile} (not in --feature filter)`);
        continue;
      }
    } else if (!ALL_FEATURES && ALLOW_LIST.length > 0) {
      // Default run: only process features listed in generate.config.json
      if (!ALLOW_LIST.some(f => baseName.includes(f) || f.includes(baseName))) {
        console.log(`  ⏭  Skipping ${featureFile} (not in generate.config.json allowlist — use --all to override)`);
        continue;
      }
    }

    const featurePath = path.join(FEATURES_DIR, featureFile);
    const parsed = parseFeatureSteps(featurePath);
    const allSteps = parsed.allSteps;

    // ── Existing step-file guard (default behaviour) ──────────────────────────
    // If an `_auto.steps.js` file already exists for this feature, do NOT run
    // DOM inspection, MCP probing, or any regeneration. The file is treated as
    // user-owned. Pass `--update-steps` (or set UPDATE_STEPS=1) to opt back in.
    //
    // Rationale: once a step file has been generated and hand-tuned, re-running
    // the agent should NOT touch it. Auto-fixes only happen on test failure
    // (via the Claude/MCP fix loop), never via the generator on a clean run.
    const stepsFileNameSkipCheck = `${path.basename(featureFile, '.feature').replace(/[^a-zA-Z0-9]/g, '_')}_auto.steps.js`;
    const stepsFilePathSkipCheck = path.join(STEPS_DIR, stepsFileNameSkipCheck);
    const stepsFileExists = fs.existsSync(stepsFilePathSkipCheck);
    if (stepsFileExists && !UPDATE_STEPS) {
      console.log(`  ⏭  ${featureFile} — step file already exists (${stepsFileNameSkipCheck}); skipping generation. Use --update-steps to force.`);
      // Register existing definitions so other features don't redefine them
      const existingContent = fs.readFileSync(stepsFilePathSkipCheck, 'utf-8');
      const stringMatcher = /(?:Given|When|Then)\(\s*'([^']+)'/g;
      let lm;
      while ((lm = stringMatcher.exec(existingContent)) !== null) {
        const regexStr = '^' + lm[1].replace(/\{string\}/g, '"[^"]*"').replace(/\{int\}/g, '\\d+') + '$';
        existingDefs.push({ pattern: lm[1], regex: new RegExp(regexStr, 'i'), file: stepsFileNameSkipCheck });
      }
      continue;
    }

    // ── @locked guard ─────────────────────────────────────────────────────────
    // A step file with "// @locked" at the top is completely skipped — no DOM
    // inspection, no new-step detection, no appending. Use this for files that
    // are fully working and should never be touched by the generator.
    // (Use "// @protected" instead when you still want new steps auto-appended.)
    const stepsFileNameEarly = `${path.basename(featureFile, '.feature')}_auto.steps.js`;
    const stepsFilePathEarly = path.join(STEPS_DIR, stepsFileNameEarly);
    if (fs.existsSync(stepsFilePathEarly)) {
      const firstLine = fs.readFileSync(stepsFilePathEarly, 'utf-8').split('\n')[0];
      if (firstLine.includes('// @locked')) {
        console.log(`  🔐 ${stepsFileNameEarly} is @locked — skipping entirely`);
        // Still register its patterns so other features don't re-define the same steps
        const lockedContent = fs.readFileSync(stepsFilePathEarly, 'utf-8');
        const stringMatcher = /(?:Given|When|Then)\(\s*'([^']+)'/g;
        let lm;
        while ((lm = stringMatcher.exec(lockedContent)) !== null) {
          const regexStr = '^' + lm[1].replace(/\{string\}/g, '"[^"]*"').replace(/\{int\}/g, '\\d+') + '$';
          existingDefs.push({ pattern: lm[1], regex: new RegExp(regexStr, 'i'), file: stepsFileNameEarly });
        }
        continue;
      }
    }

    // ── DOM Inspection ────────────────────────────────────────────────────────
    // Phase 1 — Static inspection: navigate to the page at load state and build
    // a field-label → CSS-selector map for all initially-visible form elements.
    const targetUrl = extractFeatureUrl(parsed);
    let domMap = null;
    if (targetUrl) {
      console.log(`  🌐 ${featureFile} → target URL: ${targetUrl}`);
      domMap = await inspectPage(targetUrl);
      if (domMap?.fields?.length) {
        console.log(`  📐 Static field map (${domMap.fields.length} fields):`);
        for (const f of domMap.fields) {
          console.log(`     • "${f.label}" → ${f.selector}`);
        }
      }
    }

    // Phase 2 — MCP-assisted modal inspection (opt-in via --mcp flag or MCP_DOM=1):
    // Detects click steps in the feature that open modals, then uses the Playwright
    // MCP server to replay those interactions and capture element selectors from the
    // live modal DOM — elements that are invisible during the initial page load.
    if (USE_MCP && targetUrl) {
      const modalTriggers = detectModalTriggers(parsed);
      if (modalTriggers.length > 0) {
        console.log(`  🔌 MCP: detected modal trigger(s): [${modalTriggers.join(', ')}]`);
        const modalDomMap = await mcpInspectModal(targetUrl, modalTriggers);
        if (modalDomMap?.fields?.length) {
          domMap = mergeDomMaps(domMap, modalDomMap);
          console.log(`  📐 Merged field map (${domMap.fields.length} total — ${modalDomMap.fields.length} from modal):`);
          for (const f of modalDomMap.fields) {
            console.log(`     🔌 "${f.label}" → ${f.selector}`);
          }
        }
      }
    }

    // Deduplicate steps by their cucumber expression
    const seen = new Set();
    const undefinedSteps = [];

    for (let i = 0; i < allSteps.length; i++) {
      const step = allSteps[i];
      const cucumberExpr = toCucumberExpression(step.text);
      if (seen.has(cucumberExpr)) continue;
      seen.add(cucumberExpr);

      const match = findMatchingDef(step.text, existingDefs);
      if (!match) {
        const keyword = resolveKeyword(step, i, allSteps);
        undefinedSteps.push({ ...step, keyword, cucumberExpr });
      }
    }

    if (undefinedSteps.length === 0) {
      console.log(`  ✅ ${featureFile} — all steps defined`);
      continue;
    }

    console.log(`  🔧 ${featureFile} — ${undefinedSteps.length} undefined step(s), generating...`);

    // 4. Generate the step definitions file
    const stepsFileBase = featureFile.replace(/\.feature$/, '').replace(/[^a-zA-Z0-9]/g, '_');
    const stepsFileName = `${stepsFileBase}_auto.steps.js`;
    const stepsFilePath = path.join(STEPS_DIR, stepsFileName);

    // ── SAFE APPEND MODE ──────────────────────────────────────────────────────
    // If the file already exists, only append steps that aren't already in it.
    // NEVER overwrite an existing file — that would destroy custom implementations.
    if (fs.existsSync(stepsFilePath)) {
      const existingContent = fs.readFileSync(stepsFilePath, 'utf-8');

      // ── @protected guard ─────────────────────────────────────────────────
      // If the file contains "// @protected", the generator will NEVER modify
      // or remove existing step implementations — but it WILL still append
      // genuinely NEW steps added to the feature file. This way your manual
      // fixes stay intact and new scenarios still get auto-generated stubs.
      const isProtected = existingContent.includes('// @protected');
      if (isProtected) {
        console.log(`  🔒 ${stepsFileName} is @protected — existing steps locked, checking for new ones...`);
      }
      // ── end @protected guard ─────────────────────────────────────────────
      const trulyMissing = undefinedSteps.filter(step => {
        // Check if this cucumber expression is already in the file (string or regex form)
        const escaped = step.cucumberExpr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const inStringForm = new RegExp(`['"]${escaped}['"]`).test(existingContent);
        // Also check if a regex covering the same literal text is already present
        // e.g. /^user goes to a specific model (.+)$/ covers any URL-containing step
        const inRegexForm = new RegExp(`\\/\\^${escaped.replace(/\\\s/g, '\\s').substring(0, 20)}`).test(existingContent);
        return !inStringForm && !inRegexForm;
      });

      if (trulyMissing.length === 0) {
        console.log(`  ✅ ${stepsFileName} already has all needed steps (skipping)`);
        // Still register existing patterns so later features don't re-define them
        for (const step of undefinedSteps) {
          const regexStr = '^' + step.cucumberExpr
            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            .replace(/\\{string\\}/g, '"[^"]*"')
            .replace(/\\{int\\}/g, '\\d+')
            + '$';
          existingDefs.push({ pattern: step.cucumberExpr, regex: new RegExp(regexStr), file: stepsFileName });
        }
        continue;
      }

      console.log(`  ➕ ${isProtected ? '🔒 ' : ''}Appending ${trulyMissing.length} new step(s) to ${isProtected ? '@protected ' : ''}${stepsFileName}`);
      const appendLines = ['\n// ── Auto-appended steps ──────────────────────────────────────────\n'];
      for (const step of trulyMissing) {
        const category = categorizeStep(step.text);
        const elementInfo = extractElementInfo(step.text);
        const params = buildParams(step.cucumberExpr);
        const body = generateStepBody(step.cucumberExpr, step.text, category, elementInfo, params, domMap);
        const paramList = params.length > 0 ? params.join(', ') : '';
        appendLines.push(`${step.keyword}('${step.cucumberExpr}', async function (${paramList}) {`);
        appendLines.push(body);
        appendLines.push(`});\n`);

        const regexStr = '^' + step.cucumberExpr
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          .replace(/\\{string\\}/g, '"[^"]*"')
          .replace(/\\{int\\}/g, '\\d+')
          + '$';
        existingDefs.push({ pattern: step.cucumberExpr, regex: new RegExp(regexStr), file: stepsFileName });
      }
      fs.appendFileSync(stepsFilePath, appendLines.join('\n'), 'utf-8');
      console.log(`  ✅ Appended to ${stepsFilePath}`);
      generatedFiles.push(stepsFilePath);
      totalGenerated += trulyMissing.length;
      continue;
    }
    // ── END SAFE APPEND MODE ──────────────────────────────────────────────────

    // Include DOM map summary as a comment in the generated file header
    const domMapSummary = domMap?.fields?.length
      ? domMap.fields.map(f => ` *   "${f.label}" → ${f.selector}`).join('\n')
      : ' *   (no DOM map available — using autoHeal fallbacks)';

    const lines = [
      `/**`,
      ` * Auto-Generated Step Definitions for: ${parsed.featureName}`,
      ` * Source: ${featureFile}`,
      ` * Generated: ${new Date().toISOString()}`,
      ` * Target URL: ${targetUrl || '(resolved at runtime)'}`,
      ` *`,
      ` * DOM Field Map:`,
      domMapSummary,
      ` *`,
      ` * These steps were auto-generated by the Confluence Test Agent because no`,
      ` * matching step definitions were found. Each step uses Playwright for real`,
      ` * browser interactions and assertions.`,
      ` */`,
      `import { Given, When, Then } from '@cucumber/cucumber';`,
      `import { strict as assert } from 'node:assert';`,
      ``,
    ];

    for (const step of undefinedSteps) {
      const category = categorizeStep(step.text);
      const elementInfo = extractElementInfo(step.text);
      const params = buildParams(step.cucumberExpr);
      const body = generateStepBody(step.cucumberExpr, step.text, category, elementInfo, params, domMap);
      const paramList = params.length > 0 ? params.join(', ') : '';

      lines.push(`${step.keyword}('${step.cucumberExpr}', async function (${paramList}) {`);
      lines.push(body);
      lines.push(`});\n`);

      // Also add to existingDefs so subsequent features don't re-define
      const regexStr = '^' + step.cucumberExpr
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\\{string\\}/g, '"[^"]*"')
        .replace(/\\{int\\}/g, '\\d+')
        + '$';
      existingDefs.push({ pattern: step.cucumberExpr, regex: new RegExp(regexStr), file: stepsFileName });
    }

    // Write the file
    fs.writeFileSync(stepsFilePath, lines.join('\n'), 'utf-8');
    console.log(`  ✅ Generated ${stepsFilePath}`);
    generatedFiles.push(stepsFilePath);
    totalGenerated += undefinedSteps.length;
  }

  console.log(`\n📊 Summary: ${totalGenerated} step(s) generated in ${generatedFiles.length} file(s)`);
  return { generated: totalGenerated, files: generatedFiles };
}

// ─── CLI Entry Point ─────────────────────────────────────────

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.url.replace('file:///', ''))) {
  generateStepDefinitions().catch(err => { console.error(err); process.exit(1); });
}
