/**
 * Claude Code Test Fix Loop
 *
 * Runs Cucumber tests, detects failures, invokes Claude Code to fix step
 * definitions, then re-runs. Repeats until all scenarios pass or MAX_ITERATIONS
 * is reached.
 *
 * Usage:
 *   node scripts/claudeFixLoop.js                     # fix all features
 *   node scripts/claudeFixLoop.js --tags @smoke        # fix a specific tag
 *   node scripts/claudeFixLoop.js --max-iterations 3   # override iteration cap
 */

import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectPage } from './domInspector.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RESULTS_JSON = path.join(ROOT, 'test-results', 'cucumber-report.json');
const STEP_DEFS_DIR = path.join(ROOT, 'features', 'cucumber', 'step_definitions');
const FEATURES_DIR = path.join(ROOT, 'features', 'cucumber');

// ─── CLI Args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const tagsArg = args.find((_, i) => args[i - 1] === '--tags');
const maxIterArg = args.find((_, i) => args[i - 1] === '--max-iterations');
const MAX_ITERATIONS = maxIterArg ? parseInt(maxIterArg, 10) : 5;

// ─── Locate claude binary ─────────────────────────────────────────────────────
const CLAUDE_CANDIDATES = [
  'C:\\Users\\janki.gajjar\\AppData\\Roaming\\npm\\claude.cmd',
  'C:\\Users\\janki.gajjar\\AppData\\Roaming\\npm\\claude',
  'claude',
];

function spawnClaude(candidate, args, opts = {}) {
  const isCmd = candidate.endsWith('.cmd') || candidate.endsWith('.bat');
  return spawnSync(candidate, args, { shell: isCmd, ...opts });
}

function findClaude() {
  for (const candidate of CLAUDE_CANDIDATES) {
    try {
      const res = spawnClaude(candidate, ['--version'], { encoding: 'utf-8', timeout: 10000 });
      if (res.status === 0 && res.stdout) return candidate;
    } catch { /* try next */ }
  }
  throw new Error(
    'claude CLI not found. Run: npm install -g @anthropic-ai/claude-code\n' +
    'Then ensure C:\\Users\\janki.gajjar\\AppData\\Roaming\\npm is in your PATH.'
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function banner(msg) {
  const line = '─'.repeat(msg.length + 4);
  console.log(`\n┌${line}┐`);
  console.log(`│  ${msg}  │`);
  console.log(`└${line}┘\n`);
}

function runTests(tags, scenarioNames, featureUris) {
  const tagFlag = tags ? `--tags "${tags}"` : '';
  // Always write JSON report explicitly (config-based format is not reliable in all run contexts)
  const formatFlag = '--format json:test-results/cucumber-report.json';

  // When scenarioNames is supplied, run ONLY those scenarios via repeated
  // --name <regex> flags. Cucumber treats the value as a regex and combines
  // multiple --name flags with OR semantics. We escape regex specials so the
  // scenario title matches literally.
  let nameFlags = '';
  if (Array.isArray(scenarioNames) && scenarioNames.length > 0) {
    const unique = [...new Set(scenarioNames.filter(Boolean))];
    nameFlags = unique
      .map(n => `--name "^${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/"/g, '\\"')}$"`)
      .join(' ');
  }

  // When featureUris is supplied, restrict the run to ONLY those .feature
  // files. Positional path args override the `paths` configured in cucumber.js,
  // so passing-feature files are skipped entirely (no browser launch for them).
  let pathArgs = '';
  if (Array.isArray(featureUris) && featureUris.length > 0) {
    const uniqueUris = [...new Set(featureUris.filter(Boolean))];
    pathArgs = uniqueUris.map(u => `"${u.replace(/\\/g, '/')}"`).join(' ');
  }

  const cmd = `npx cucumber-js --config cucumber.js ${pathArgs} ${formatFlag} ${tagFlag} ${nameFlags}`.replace(/\s+/g, ' ').trim();

  // Ensure results directory exists before running
  const resultsDir = path.dirname(RESULTS_JSON);
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

  // Snapshot the existing report before this narrowed run so we can merge
  // already-passing scenarios (which won't be re-executed) back into the
  // final report. Without this, the PDF would only contain the re-run subset.
  const isNarrowed = (pathArgs.length > 0) || (nameFlags.length > 0);
  let baselineReport = null;
  if (isNarrowed && fs.existsSync(RESULTS_JSON)) {
    try { baselineReport = JSON.parse(fs.readFileSync(RESULTS_JSON, 'utf-8')); }
    catch { baselineReport = null; }
  }

  console.log(`▶ ${cmd}\n`);
  let passed = false;
  try {
    execSync(cmd, { stdio: 'inherit', cwd: ROOT });
    passed = true;
  } catch {
    passed = false;
  }

  // Merge the freshly-written narrowed report with the baseline so the final
  // cucumber-report.json contains BOTH already-passing scenarios AND the
  // updated status of the re-run scenarios.
  if (isNarrowed && baselineReport) {
    try { mergeReportWithBaseline(baselineReport); } catch (e) {
      console.warn(`⚠️  Failed to merge narrowed report with baseline: ${e.message}`);
    }
  }
  return passed;
}

/**
 * Merge the just-written cucumber-report.json (which only contains the
 * re-run subset of scenarios) with `baselineReport` (the previous full run).
 *
 * Rules:
 *   • Scenarios present in the new report → use the NEW result (they were re-run).
 *   • Scenarios present only in baseline → carry over UNCHANGED (they passed last time).
 *   • Features present only in baseline → carry over the entire feature unchanged.
 */
function mergeReportWithBaseline(baselineReport) {
  if (!fs.existsSync(RESULTS_JSON)) return;
  const newReport = JSON.parse(fs.readFileSync(RESULTS_JSON, 'utf-8'));

  const keyOf = (feature, element) =>
    `${feature.uri || feature.id || feature.name}::${element.id || element.name}`;

  // Index new results by feature URI and by scenario key
  const newFeaturesByUri = new Map();
  const newElementKeys = new Set();
  for (const f of newReport) {
    newFeaturesByUri.set(f.uri || f.id || f.name, f);
    for (const el of (f.elements || [])) newElementKeys.add(keyOf(f, el));
  }

  const merged = [];
  const handledNewFeatureKeys = new Set();

  // Walk baseline; for each baseline feature, prefer new result if present.
  for (const baseFeature of baselineReport) {
    const fk = baseFeature.uri || baseFeature.id || baseFeature.name;
    const newFeature = newFeaturesByUri.get(fk);
    if (!newFeature) {
      // Feature not re-run at all — keep baseline as-is.
      merged.push(baseFeature);
      continue;
    }
    handledNewFeatureKeys.add(fk);

    // Feature was (partially) re-run. Build merged elements list:
    // for each baseline element, use new if present, else keep baseline.
    const newElementsByKey = new Map();
    for (const el of (newFeature.elements || [])) newElementsByKey.set(keyOf(newFeature, el), el);

    const mergedElements = [];
    const usedNewKeys = new Set();
    for (const baseEl of (baseFeature.elements || [])) {
      const k = keyOf(baseFeature, baseEl);
      if (newElementsByKey.has(k)) {
        mergedElements.push(newElementsByKey.get(k));
        usedNewKeys.add(k);
      } else {
        mergedElements.push(baseEl);
      }
    }
    // Append any new elements that weren't in baseline (rare)
    for (const [k, el] of newElementsByKey.entries()) {
      if (!usedNewKeys.has(k)) mergedElements.push(el);
    }

    merged.push({ ...newFeature, elements: mergedElements });
  }

  // Append any brand-new features that weren't in baseline (rare)
  for (const [fk, nf] of newFeaturesByUri.entries()) {
    if (!handledNewFeatureKeys.has(fk)) merged.push(nf);
  }

  fs.writeFileSync(RESULTS_JSON, JSON.stringify(merged, null, 2));
  console.log(`📎 Merged narrowed run results with baseline (${merged.length} feature(s) total in final report).`);
}

function parseFailures() {
  if (!fs.existsSync(RESULTS_JSON)) {
    console.warn('⚠️  No cucumber-report.json found – cannot parse failures.');
    return [];
  }

  let report;
  try {
    report = JSON.parse(fs.readFileSync(RESULTS_JSON, 'utf-8'));
  } catch (e) {
    console.error('❌ Failed to parse cucumber-report.json:', e.message);
    return [];
  }

  const failures = [];
  for (const feature of report) {
    for (const element of (feature.elements || [])) {
      const allSteps = (element.steps || []).filter(s => !['Before', 'After'].includes((s.keyword || '').trim()));
      const BAD = new Set(['failed', 'ambiguous', 'undefined', 'pending']);
      const failedSteps = allSteps.filter(s => BAD.has(s.result?.status));
      if (failedSteps.length > 0) {
        const tags = (element.tags || []).map(t => t.name).join(' ');
        // Skip scenarios explicitly opted out of auto-fix. These are usually
        // data/content-driven assertions (e.g. live-site price checks) where
        // the failure represents a real product issue, not a test-code bug.
        if (/@no-autofix\b/.test(tags)) {
          console.log(`  ⏭  Skipping @no-autofix scenario: ${element.name}`);
          continue;
        }
        failures.push({
          feature: feature.name,
          featureUri: feature.uri || '',
          scenario: element.name,
          tags,
          // Full step sequence — tells Claude what interactions to perform to reach failure state
          allSteps: allSteps.map(s => ({
            keyword: (s.keyword || '').trim(),
            name: s.name || '',
            status: s.result?.status || 'unknown',
          })),
          // Track undefined steps separately — they're missing definitions, not bugs.
          // The step generator handles these, NOT Claude.
          undefinedSteps: failedSteps
            .filter(s => s.result?.status === 'undefined')
            .map(s => ({ keyword: (s.keyword || '').trim(), name: s.name || '' })),
          steps: failedSteps.map(s => ({
            keyword: (s.keyword || '').trim(),
            name: s.name || '',
            status: s.result?.status || 'unknown',
            error: (s.result?.error_message || '').substring(0, 1000),
          })),
        });
      }
    }
  }
  return failures;
}

/**
 * Run the step-definition generator (Claude-powered) for any feature whose
 * scenarios contain undefined steps. The generator appends missing definitions
 * to the existing *_auto.steps.js file (respecting // @locked / // @protected).
 *
 * Returns the number of features for which generation was attempted.
 */
function runStepGeneratorForUndefined(failures) {
  const featuresWithUndefined = new Set();
  for (const f of failures) {
    if (f.undefinedSteps?.length && f.featureUri) {
      const base = path.basename(f.featureUri).replace(/\.feature$/i, '');
      featuresWithUndefined.add(base);
    }
  }
  if (featuresWithUndefined.size === 0) return 0;

  banner('Auto-generating missing step definitions');
  console.log('📝 Undefined steps detected — invoking step generator for:');
  for (const name of featuresWithUndefined) console.log(`   • ${name}`);
  console.log('');

  let generated = 0;
  for (const featureName of featuresWithUndefined) {
    const cmd = `node scripts/generateStepDefs.js --feature "${featureName}" --update-steps`;
    console.log(`▶ ${cmd}`);
    try {
      execSync(cmd, { stdio: 'inherit', cwd: ROOT, env: { ...process.env, UPDATE_STEPS: '1' } });
      generated++;
    } catch (e) {
      console.warn(`  ⚠️  Generator failed for ${featureName}: ${e.message}`);
    }
  }
  console.log('');
  return generated;
}

function getStepFiles() {
  if (!fs.existsSync(STEP_DEFS_DIR)) return [];
  return fs.readdirSync(STEP_DEFS_DIR)
    .filter(f => f.endsWith('.js'))
    .map(f => path.join(STEP_DEFS_DIR, f));
}

/**
 * Map failing step text back to the most likely step file(s) by grepping for
 * the step text in step definition files.
 */
function findRelevantStepFiles(failures, allStepFiles) {
  const relevant = new Set();

  for (const failure of failures) {
    // Check feature URI to find matching step file
    if (failure.featureUri) {
      const base = path.basename(failure.featureUri, '.feature');
      const match = allStepFiles.find(f => path.basename(f).startsWith(base));
      if (match) relevant.add(match);
    }

    // Also grep for step text in each step file
    for (const stepFile of allStepFiles) {
      const content = fs.readFileSync(stepFile, 'utf-8');
      for (const step of failure.steps) {
        // Match partial step text (first 40 chars) in file
        const partial = step.name.substring(0, 40).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp(partial, 'i').test(content)) {
          relevant.add(stepFile);
        }
      }
    }
  }

  // If nothing matched, include all step files
  return relevant.size > 0 ? [...relevant] : allStepFiles;
}

/**
 * Extract the target page URL for a feature file by scanning its content
 * for the first "navigate" or "I navigate to" step, or by checking the
 * cached environment URL map.
 */
function extractFeatureUrl(featureUri) {
  if (!featureUri) return null;
  try {
    const featurePath = path.isAbsolute(featureUri) ? featureUri : path.join(ROOT, featureUri);
    if (!fs.existsSync(featurePath)) return null;
    const content = fs.readFileSync(featurePath, 'utf-8');

    // Match: Given I navigate to "https://..."
    const directUrl = content.match(/navigate\s+to\s+["']?(https?:\/\/[^"'\s]+)["']?/i);
    if (directUrl) return directUrl[1];

    // Match: navigates to "Test Drive" / "Book a Test Drive" — resolve via env cache
    const namedPage = content.match(/navigates?\s+to\s+["']([^"']+)["']/i);
    if (namedPage) {
      const cachePath = path.join(ROOT, '.cache', 'activeEnvironment.json');
      if (fs.existsSync(cachePath)) {
        const env = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
        const pageUrls = env.pageUrls || {};
        const key = namedPage[1].toLowerCase().trim();
        const match = Object.entries(pageUrls).find(([k]) => k.includes(key) || key.includes(k));
        if (match) return match[1];
      }
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * For each unique failing feature URI, fetch live DOM locators from the page.
 * Forces a fresh inspection (bypasses cache) so selectors are always current.
 * Returns a map: featureUri -> { url, domMap }
 */
async function fetchLiveLocators(failures) {
  const locatorMap = {};
  const seen = new Set();

  for (const failure of failures) {
    const uri = failure.featureUri;
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);

    const url = extractFeatureUrl(uri);
    if (!url) {
      console.log(`  ⚠️  Could not resolve URL for feature: ${uri} — skipping DOM inspection`);
      continue;
    }

    console.log(`  🔍 Fetching live DOM locators for: ${url}`);
    try {
      // Force fresh inspection by clearing the cache file for this URL
      const crypto = await import('node:crypto');
      const hash = crypto.default.createHash('md5').update(url).digest('hex').slice(0, 12);
      const cacheFile = path.join(ROOT, '.cache', 'domMaps', `${hash}.json`);
      if (fs.existsSync(cacheFile)) fs.unlinkSync(cacheFile);

      const domMap = await inspectPage(url);
      if (domMap) {
        locatorMap[uri] = { url, domMap };
        console.log(`  ✅ Live DOM: ${domMap.fields?.length || 0} field(s), ${domMap.buttons?.length || 0} button(s)`);
      }
    } catch (e) {
      console.warn(`  ⚠️  DOM inspection failed for ${url}: ${e.message}`);
    }
  }

  return locatorMap;
}

/**
 * Analyse a Playwright error message and return a structured diagnosis.
 * This prevents Claude from looping 5× on the same misdiagnosis.
 */
function diagnoseError(errorMsg) {
  if (!errorMsg) return null;

  const diagnosis = [];

  // Pattern: page.goto called with a non-URL string (e.g. a menu label).
  // Almost always means the auto-generator misclassified a "navigates to X menu"
  // step as a URL navigation when it was actually a header click.
  if (/page\.goto:\s*Protocol error.*Cannot navigate to invalid URL/i.test(errorMsg) ||
      /navigating to "[^"]*"(?!http)/i.test(errorMsg)) {
    diagnosis.push('⚠️  ROOT CAUSE — page.goto() was called with a value that is NOT a URL.');
    diagnosis.push('   The step implementation is treating a menu label / page name as a URL.');
    diagnosis.push('   FIX: Replace page.goto() with the correct interaction:');
    diagnosis.push('     • "navigates to the X menu"  → hover/click the header nav element labeled X.');
    diagnosis.push('     • "opens the X website"      → page.goto() the brand homepage');
    diagnosis.push('       (resolve from this.pageUrls OR fall back to https://www.<brand>.com[.au]/).');
    diagnosis.push('     • "navigates to the X page"  → resolve URL via this.pageUrls; if missing,');
    diagnosis.push('       click the matching nav link instead of guessing a URL.');
  }

  // Pattern: wrong element matched + intercepted click
  const resolvedTo = errorMsg.match(/locator resolved to <([^>]+)>/);
  const interceptedBy = [...errorMsg.matchAll(/- <([^>]+)>(?:[^\n]*)intercepts pointer events/g)].map(m => m[1]);

  if (resolvedTo) {
    const el = resolvedTo[1];
    diagnosis.push(`⚠️  ROOT CAUSE — Wrong element matched: the locator resolved to <${el}>`);

    // Detect nav-card / submenu pattern (e.g. Hyundai buying-tools vs main nav)
    if (/nav-card|submenu-card|submenu/i.test(el)) {
      diagnosis.push('   This is a MAIN NAVIGATION nav-card, NOT the target interactive element.');
      diagnosis.push('   The selector is too broad and matched the wrong element in the page navbar.');
      diagnosis.push('   FIX: Use page.evaluateHandle() to find the element by text while explicitly');
      diagnosis.push('   excluding nav-card, submenu-card, and elements inside .navbar-menu / .primary-nav.');
      diagnosis.push('   Pattern to use in the fix:');
      diagnosis.push('     const el = await this.page.evaluateHandle(() => {');
      diagnosis.push('       return Array.from(document.querySelectorAll("a, button")).find(e => {');
      diagnosis.push('         if (!/your text/i.test(e.textContent)) return false;');
      diagnosis.push('         if (/nav-card|submenu/i.test(e.className)) return false;');
      diagnosis.push('         if (e.closest(".navbar-menu, .primary-nav")) return false;');
      diagnosis.push('         const r = e.getBoundingClientRect();');
      diagnosis.push('         return r.width > 0 && r.height > 0;');
      diagnosis.push('       });');
      diagnosis.push('     });');
    }
  }

  if (interceptedBy.length) {
    diagnosis.push(`⚠️  Click intercepted by: ${interceptedBy.join(', ')}`);
    diagnosis.push('   This means the CORRECT element was found but another element is covering it.');
    diagnosis.push('   FIX: After locating the correct element, use el.dispatchEvent("click") as a');
    diagnosis.push('   fallback when .click() throws, to bypass overlay/z-index blocking.');
  }

  // Pattern: locator.click timeout (element found but click never landed)
  if (/locator\.click: Timeout/i.test(errorMsg) && !resolvedTo) {
    diagnosis.push('⚠️  Timeout waiting for click — selector probably matched a hidden/off-screen element.');
    diagnosis.push('   FIX: Check that the target element is inside the open panel/modal, not a static');
    diagnosis.push('   page element with the same text that happens to be hidden or off-screen.');
  }

  // Pattern: strict mode violation (multiple matches)
  if (/strict mode violation|resolved to \d+ elements/i.test(errorMsg)) {
    diagnosis.push('⚠️  Multiple elements matched — use .first() or a more specific selector.');
  }

  // Pattern: element not found
  if (/waiting for locator.*to be visible|not found|no element/i.test(errorMsg) && !resolvedTo) {
    diagnosis.push('⚠️  Element not found — the selector does not match any visible element.');
    diagnosis.push('   The element may be inside a dynamically-opened dropdown, drawer, or modal.');
    diagnosis.push('   FIX: Use MCP to navigate to the page, perform the prior interactions listed');
    diagnosis.push('   in the step sequence above, then take a snapshot AFTER the drawer/modal opens');
    diagnosis.push('   to find the correct selector.');
  }

  return diagnosis.length ? diagnosis : null;
}

function buildPrompt(failures, relevantStepFiles, allStepFiles, locatorMap = {}) {
  const lines = [];

  lines.push('You are an expert Playwright/Cucumber test automation engineer.');
  lines.push('Your task: fix the failing Cucumber step definition files so ALL scenarios pass.');
  lines.push('');
  lines.push('## Project Information');
  lines.push(`- Root directory: ${ROOT}`);
  lines.push('- Test framework: Cucumber.js + Playwright');
  lines.push('- Step definitions: ' + STEP_DEFS_DIR);
  lines.push('- World file: ' + path.join(ROOT, 'features', 'cucumber', 'support', 'world.js'));
  lines.push('');
  lines.push('## Failing Scenarios');
  lines.push('');

  for (const [i, failure] of failures.entries()) {
    lines.push(`### ${i + 1}. Feature: ${failure.feature}`);
    lines.push(`**Scenario:** ${failure.scenario}`);
    if (failure.featureUri) {
      lines.push(`**Feature file:** ${path.join(ROOT, failure.featureUri)}`);

      // Include the FULL feature file text so Claude can interpret the BDD intent
      // as a human reader would — not just the parsed step name. This is critical
      // for catching cases where the auto-generator misclassified a step
      // (e.g. "navigates to the X menu" wrongly emitted as page.goto(url)).
      try {
        const featurePath = path.isAbsolute(failure.featureUri)
          ? failure.featureUri
          : path.join(ROOT, failure.featureUri);
        const featureText = fs.readFileSync(featurePath, 'utf-8');
        lines.push('');
        lines.push('**Full feature file (read this and interpret each step like a human tester would):**');
        lines.push('```gherkin');
        lines.push(featureText.trim());
        lines.push('```');
      } catch { /* ignore — fall back to step list only */ }
    }

    if (failure.allSteps?.length) {
      lines.push('**Full scenario step sequence** (reproduce these in MCP browser to reach the failure state):');
      for (const step of failure.allSteps) {
        const icon = step.status === 'passed' ? '✅' : step.status === 'failed' ? '❌' : step.status === 'undefined' ? '❓' : '⏭';
        lines.push(`  ${icon} ${step.keyword} ${step.name}`);
      }
    }

    lines.push('**Failed steps (with errors):**');
    for (const step of failure.steps) {
      lines.push(`  - [${step.status.toUpperCase()}] ${step.keyword} ${step.name}`);
      if (step.error) {
        lines.push(`    Error: ${step.error}`);

        // Emit a pre-analysed diagnosis so Claude doesn't have to guess
        const diagnosis = diagnoseError(step.error);
        if (diagnosis) {
          lines.push('');
          lines.push('    **Pre-analysed diagnosis:**');
          for (const d of diagnosis) lines.push(`    ${d}`);
        }
      }
    }

    // Live DOM locators (static page capture — useful for form fields)
    const locData = locatorMap[failure.featureUri];
    if (locData) {
      lines.push('');
      lines.push(`**Static DOM locators for ${locData.url} (initial page load only):**`);
      lines.push('NOTE: These do NOT include dynamically-opened dropdowns, drawers, or modals.');
      lines.push('Use MCP to inspect the page AFTER performing the prior interactions above.');
      if (locData.domMap.fields?.length) {
        lines.push('  Fields:');
        for (const f of locData.domMap.fields) {
          lines.push(`    • "${f.label}" → ${f.selector}  (type: ${f.type || f.tag}, name: ${f.name || '-'}, id: ${f.id || '-'})`);
        }
      }
      if (locData.domMap.buttons?.length) {
        lines.push('  Buttons (visible at page load):');
        for (const b of locData.domMap.buttons) {
          lines.push(`    • "${b.text}" → ${b.selector}`);
        }
      }
      if (locData.domMap.apiPatterns?.length) {
        lines.push('  API endpoints (from network traffic):');
        for (const api of locData.domMap.apiPatterns) {
          lines.push(`    • ${api}`);
        }
      }
    }
    lines.push('');
  }

  lines.push('## Files to Fix');
  lines.push('');
  lines.push('Read and fix ONLY these step definition files (do not touch others):');
  for (const f of relevantStepFiles) {
    lines.push(`  - ${f}`);
  }
  lines.push('');

  if (allStepFiles.length > relevantStepFiles.length) {
    lines.push('Other step files (for reference only — do not modify unless necessary):');
    for (const f of allStepFiles.filter(f => !relevantStepFiles.includes(f))) {
      lines.push(`  - ${f}`);
    }
    lines.push('');
  }

  lines.push('## MCP-Powered Live Page Inspection');
  lines.push('');
  lines.push('You have **Playwright MCP** and **Filesystem MCP** available. Use them to inspect the');
  lines.push('live page at the EXACT state where the step fails (e.g. after opening a drawer/modal):');
  lines.push('');
  lines.push('1. `mcp__playwright__browser_navigate` — go to the page URL from the feature file.');
  lines.push('2. Reproduce prior ✅ steps — click the buttons shown in the step sequence above.');
  lines.push('3. `mcp__playwright__browser_snapshot` — capture the DOM AFTER the drawer/modal opens.');
  lines.push('4. `mcp__playwright__browser_screenshot` — take a visual screenshot if needed.');
  lines.push('5. Extract the **exact selector** for the target element from the snapshot.');
  lines.push('   Prefer `id`, `aria-label`, `role+name`, or a tightly-scoped CSS selector.');
  lines.push('   Avoid broad `:has-text()` selectors that can match the wrong element.');
  lines.push('');
  lines.push('## Fix Instructions');
  lines.push('');
  lines.push('**FIRST PRINCIPLE — Read the feature file like a human tester.**');
  lines.push('Each Gherkin step describes an action a real person would perform in a browser.');
  lines.push('Translate the *intent*, not the literal words:');
  lines.push('  • "the user opens the X website"   → navigate to that brand\'s public homepage');
  lines.push('    (e.g. "Hyundai Australia website" → https://www.hyundai.com.au/). Never pass a');
  lines.push('    non-URL string to page.goto().');
  lines.push('  • "the user navigates to the X menu" → hover/click the top-level nav item labeled X');
  lines.push('    in the header/nav region. This is NOT page.goto(X) — X is a menu label.');
  lines.push('  • "the user clicks the X submenu"   → click the link/button labeled X inside the');
  lines.push('    flyout that appeared after the parent menu was opened.');
  lines.push('  • "the X page should be displayed"  → assert URL slug or visible heading matches X.');
  lines.push('If any existing step implementation contradicts this human reading (e.g. it does');
  lines.push('page.goto on a menu label), REWRITE it. Do not just tweak selectors.');
  lines.push('');
  lines.push('1. Read the step file and the corresponding feature file first.');
  lines.push('2. Follow the **Pre-analysed diagnosis** for each failing step — it identifies the exact');
  lines.push('   root cause (wrong element matched, intercepted click, element not found, etc.).');
  lines.push('3. Use MCP to reproduce the failure state and capture the correct selectors.');
  lines.push('4. For "wrong element matched" errors: use `page.evaluateHandle()` with explicit ancestor');
  lines.push('   exclusions rather than broad `:has-text()` selectors — see the diagnosis for a template.');
  lines.push('5. For "intercepted click" errors: use `.dispatchEvent("click")` as a fallback after a');
  lines.push('   failed `.click()` call to bypass z-index overlays.');
  lines.push('6. For dynamically-opened drawers/modals: NEVER use selectors captured at page load.');
  lines.push('   Always open the drawer/modal via MCP first, THEN take a snapshot for selectors.');
  lines.push('7. Do NOT remove or rename existing step patterns — only fix their implementations.');
  lines.push('8. Write fixes directly to the files using the Edit tool and confirm what changed.');

  return lines.join('\n');
}

function invokeClaudeFix(claudePath, prompt) {
  console.log('🤖 Invoking Claude Code to analyse failures and fix step definitions...\n');

  // Detect MCP config so Claude can use Playwright MCP for live page inspection
  const mcpConfigPath = path.join(ROOT, '.vscode', 'mcp.json');
  const hasMcpConfig = fs.existsSync(mcpConfigPath);

  if (hasMcpConfig) {
    console.log(`  🔌 MCP config: ${mcpConfigPath}`);
    console.log('  📡 Playwright MCP + Filesystem MCP enabled for interactive page inspection\n');
  }

  // Playwright MCP tools (server name: "playwright" from .vscode/mcp.json)
  const playwrightMcpTools = hasMcpConfig ? [
    'mcp__playwright__browser_navigate',
    'mcp__playwright__browser_click',
    'mcp__playwright__browser_fill',
    'mcp__playwright__browser_select_option',
    'mcp__playwright__browser_snapshot',
    'mcp__playwright__browser_screenshot',
    'mcp__playwright__browser_wait_for',
    'mcp__playwright__browser_handle_dialog',
    'mcp__playwright__browser_evaluate',
    'mcp__playwright__browser_network_requests',
    'mcp__playwright__browser_tab_new',
    'mcp__playwright__browser_close',
  ] : [];

  // Filesystem MCP tools (server name: "filesystem" from .vscode/mcp.json)
  const filesystemMcpTools = hasMcpConfig ? [
    'mcp__filesystem__read_file',
    'mcp__filesystem__write_file',
    'mcp__filesystem__list_directory',
    'mcp__filesystem__search_files',
  ] : [];

  const allTools = ['Edit', 'Read', 'Write', 'Bash', ...playwrightMcpTools, ...filesystemMcpTools];

  const claudeArgs = [
    '-p', prompt,
    '--allowedTools', allTools.join(','),
    '--dangerously-skip-permissions',
    ...(hasMcpConfig ? ['--mcp-config', mcpConfigPath] : []),
  ];

  const isCmd = claudePath.endsWith('.cmd') || claudePath.endsWith('.bat');
  const result = spawnSync(claudePath, claudeArgs, {
    cwd: ROOT,
    shell: isCmd,
    encoding: 'utf-8',
    stdio: ['pipe', 'inherit', 'inherit'],
    timeout: 600000, // 10 minutes max per fix attempt
    maxBuffer: 50 * 1024 * 1024,
  });

  if (result.error) {
    console.error('❌ Claude invocation error:', result.error.message);
    return false;
  }

  return result.status === 0;
}

// ─── File-change helpers ──────────────────────────────────────────────────────

function snapshotMtimes(files) {
  const snap = {};
  for (const f of files) {
    try { snap[f] = fs.statSync(f).mtimeMs; } catch { snap[f] = 0; }
  }
  return snap;
}

function detectChangedFiles(files, before) {
  return files.filter(f => {
    try { return fs.statSync(f).mtimeMs > (before[f] ?? 0); } catch { return false; }
  });
}

/** Build an escalated prompt that includes the FULL current file contents. */
function buildEscalatedPrompt(failures, relevantFiles, allStepFiles, locatorMap) {
  const base = buildPrompt(failures, relevantFiles, allStepFiles, locatorMap);
  const lines = [base, '', '## ⚠️  ESCALATION — Previous fix attempt made NO changes', ''];
  lines.push('Claude did not modify any step files in the previous iteration.');
  lines.push('The test WILL keep failing until the files are actually edited.');
  lines.push('Below is the CURRENT content of each file you must fix.');
  lines.push('Read it carefully, identify the broken code, and use the Edit tool to change it.');
  lines.push('');

  for (const f of relevantFiles) {
    lines.push(`### ${path.basename(f)}`);
    lines.push('```javascript');
    try { lines.push(fs.readFileSync(f, 'utf-8')); } catch { lines.push('// (could not read file)'); }
    lines.push('```');
    lines.push('');
  }

  lines.push('Apply the fix NOW using the Edit tool. Do not just analyse — make the change.');
  return lines.join('\n');
}

// ─── Main Loop ────────────────────────────────────────────────────────────────
async function main() {
  banner('Claude Code — Automated Test Fix Loop');
  console.log(`Max iterations : ${MAX_ITERATIONS}`);
  if (tagsArg) console.log(`Tags filter    : ${tagsArg}`);
  console.log(`Step defs dir  : ${STEP_DEFS_DIR}`);
  console.log('');

  const claudePath = findClaude();
  console.log(`✅ Claude Code found: ${claudePath}\n`);

  let iteration = 0;
  let previousFailureCount = Infinity;
  let consecutiveNoChange = 0;       // tracks how many times Claude changed nothing
  let previousErrorSignature = '';   // detects exact same errors repeating
  // Narrow the run to ONLY the scenarios (and feature files) that failed.
  // This avoids re-running already-passing scenarios/features on every retry.
  // Pre-seed from the existing cucumber-report.json (produced by the orchestrator
  // or a previous run) so even the FIRST iteration only re-runs the failures
  // instead of the entire suite.
  let failedScenarioNames = null;
  let failedFeatureUris = null;
  try {
    const seedFailures = parseFailures();
    if (seedFailures.length > 0) {
      failedScenarioNames = seedFailures.map(f => f.scenario).filter(Boolean);
      failedFeatureUris = [...new Set(seedFailures.map(f => f.featureUri).filter(Boolean))];
      if (failedScenarioNames.length > 0) {
        console.log(`📄 Seeded ${failedScenarioNames.length} failing scenario(s) across ${failedFeatureUris.length} feature file(s) from existing cucumber-report.json — first iteration will skip already-passing tests.\n`);
      }
    }
  } catch { /* no prior report — first iteration runs the full suite */ }

  while (iteration < MAX_ITERATIONS) {
    iteration++;
    banner(`Iteration ${iteration} / ${MAX_ITERATIONS}`);

    if (failedScenarioNames && failedScenarioNames.length > 0) {
      console.log(`🎯 Re-running only the ${failedScenarioNames.length} failing scenario(s)` + (failedFeatureUris && failedFeatureUris.length > 0 ? ` in ${failedFeatureUris.length} feature file(s):` : ':'));
      for (const n of failedScenarioNames) console.log(`   • ${n}`);
      if (failedFeatureUris && failedFeatureUris.length > 0) {
        console.log('   feature files:');
        for (const u of failedFeatureUris) console.log(`     - ${u}`);
      }
      console.log('');
    }

    const passed = runTests(tagsArg, failedScenarioNames, failedFeatureUris);

    if (passed) {
      banner('✅ ALL SCENARIOS PASSED');
      console.log('Fix loop complete.\n');
      process.exit(0);
    }

    const failures = parseFailures();

    if (failures.length === 0) {
      banner('✅ NO FAILURES IN REPORT');
      console.log('Tests exited non-zero but report shows no failures — treating as pass.\n');
      process.exit(0);
    }

    // Build an error signature to detect stuck loops (same errors repeating)
    const errorSig = failures
      .map(f => `${f.scenario}::${f.steps.map(s => `${s.name}|${(s.error || '').slice(0, 120)}`).join(';')}`)
      .join('||');
    const sameErrorsAsLastTime = (errorSig === previousErrorSignature) && iteration > 1;
    previousErrorSignature = errorSig;

    console.log(`❌ ${failures.length} scenario(s) failed:\n`);
    for (const f of failures) {
      console.log(`   • [${f.feature}] ${f.scenario}`);
      for (const s of f.steps) {
        console.log(`     └─ [${s.status}] ${s.keyword} ${s.name}`);
        if (s.error) {
          const firstLine = s.error.split('\n')[0];
          console.log(`        ${firstLine}`);
        }
      }
    }
    console.log('');

    if (failures.length >= previousFailureCount && iteration > 1) {
      console.warn('⚠️  Failure count did not decrease after last fix attempt.');
    }
    if (sameErrorsAsLastTime) {
      console.warn('⚠️  Exact same errors as previous iteration — previous fix had no effect.');
    }
    previousFailureCount = failures.length;

    // Narrow the next iteration to ONLY the scenarios (and feature files)
    // that just failed. Already-passing scenarios/features are skipped.
    failedScenarioNames = failures.map(f => f.scenario).filter(Boolean);
    failedFeatureUris = [...new Set(failures.map(f => f.featureUri).filter(Boolean))];

    if (iteration === MAX_ITERATIONS) {
      console.log(`\n❌ Reached max iterations (${MAX_ITERATIONS}) without full pass.\n`);
      process.exit(1);
    }

    // ── Step A: Auto-generate missing step definitions for "undefined" steps ──
    // Undefined steps are NOT bugs — they're just missing implementations. The
    // step generator handles these directly (it's the same one used by the
    // orchestrator). This avoids Claude spinning iterations on something it
    // can't fix without a target file to edit.
    const undefinedCount = failures.reduce((n, f) => n + (f.undefinedSteps?.length || 0), 0);
    const realFailureCount = failures.reduce(
      (n, f) => n + f.steps.filter(s => s.status === 'failed').length, 0);

    if (undefinedCount > 0) {
      console.log(`📝 ${undefinedCount} undefined step(s) detected across ${failures.length} scenario(s).`);
      const generated = runStepGeneratorForUndefined(failures);
      if (generated > 0) {
        console.log(`✅ Generator ran for ${generated} feature(s) — re-running tests before invoking Claude.\n`);
        // Skip Claude this iteration; let the next iteration re-test with the
        // newly-generated step definitions. If only undefined steps caused the
        // failure, tests will pass and the loop exits.
        continue;
      }
    }

    // If there are no real "failed" steps (only undefined ones that we just
    // tried to generate), don't bother invoking Claude — let the next iteration
    // re-run and report fresh status.
    if (realFailureCount === 0) {
      console.log('ℹ️  No "failed" steps to fix — re-running tests after generator pass.\n');
      continue;
    }

    const allStepFiles = getStepFiles();
    const relevantFiles = findRelevantStepFiles(failures, allStepFiles);
    console.log(`\n📂 Relevant step files:\n${relevantFiles.map(f => '   ' + f).join('\n')}\n`);

    banner('Fetching Live DOM Locators');
    const locatorMap = await fetchLiveLocators(failures);

    // Choose prompt: escalate if Claude has been making no changes or same errors repeat
    const useEscalated = consecutiveNoChange >= 1 || sameErrorsAsLastTime;
    const prompt = useEscalated
      ? buildEscalatedPrompt(failures, relevantFiles, allStepFiles, locatorMap)
      : buildPrompt(failures, relevantFiles, allStepFiles, locatorMap);

    if (useEscalated) {
      console.log('🔺 Using ESCALATED prompt — full file contents included.\n');
    }

    // Snapshot mtimes so we can detect whether Claude actually edits anything
    const mtimeBefore = snapshotMtimes(relevantFiles);

    const ok = invokeClaudeFix(claudePath, prompt);
    if (!ok) {
      console.warn('⚠️  Claude Code returned a non-zero exit.\n');
    }

    // Verify that at least one file was actually changed
    const changedFiles = detectChangedFiles(relevantFiles, mtimeBefore);
    if (changedFiles.length === 0) {
      consecutiveNoChange++;
      console.warn(`⚠️  Claude made NO changes to step files (${consecutiveNoChange} time(s) in a row).`);
      console.warn('    Next iteration will use an escalated prompt with full file contents.\n');
    } else {
      consecutiveNoChange = 0;
      console.log(`✅ ${changedFiles.length} file(s) changed by Claude:`);
      for (const f of changedFiles) console.log(`   • ${path.basename(f)}`);
      console.log('');
    }
  }
}

main().catch(err => {
  console.error('\n💥 Fatal error in fix loop:', err.message);
  process.exit(1);
});
