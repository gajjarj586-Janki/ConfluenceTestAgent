/**
 * MCP-First Auto-Fixer
 *
 * Uses Playwright MCP (interactive browser) + Filesystem MCP to automatically
 * fix failing Cucumber step definitions — without pre-scraping the DOM.
 *
 * Unlike claudeFixLoop.js (which runs a static DOM scan before invoking Claude),
 * this script lets Claude navigate the live page interactively, open modals,
 * trigger forms, and inspect the DOM at the exact failure state. This makes it
 * far more accurate for dynamic forms, modals, and multi-step flows.
 *
 * How it works:
 *   1. Run Cucumber — collect failing scenarios from the JSON report
 *   2. For each failing scenario, extract the full step sequence + error details
 *   3. Build a focused MCP prompt that tells Claude:
 *       a. Navigate to the page URL
 *       b. Perform the passing steps to reach the failure state
 *       c. Use browser_snapshot to capture the live DOM
 *       d. Extract exact selectors from the snapshot
 *       e. Fix the step file
 *   4. Invoke Claude CLI with --mcp-config (Playwright + Filesystem MCPs)
 *   5. Re-run tests — loop until all pass or MAX_ITERATIONS reached
 *
 * Usage:
 *   node scripts/mcpAutoFixer.js
 *   node scripts/mcpAutoFixer.js --tags @smoke
 *   node scripts/mcpAutoFixer.js --max-iterations 5
 *   node scripts/mcpAutoFixer.js --no-rerun        # fix once, do not re-run tests
 */

import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RESULTS_JSON = path.join(ROOT, 'test-results', 'cucumber-report.json');
const STEP_DEFS_DIR = path.join(ROOT, 'features', 'cucumber', 'step_definitions');
const MCP_CONFIG = path.join(ROOT, '.vscode', 'mcp.json');

// ─── CLI Args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const tagsArg = args.find((_, i) => args[i - 1] === '--tags');
const maxIterArg = args.find((_, i) => args[i - 1] === '--max-iterations');
const MAX_ITERATIONS = maxIterArg ? parseInt(maxIterArg, 10) : 5;
const NO_RERUN = args.includes('--no-rerun');

// ─── Claude binary ────────────────────────────────────────────────────────────
const CLAUDE_CANDIDATES = [
  'C:\\Users\\janki.gajjar\\AppData\\Roaming\\npm\\claude.cmd',
  'C:\\Users\\janki.gajjar\\AppData\\Roaming\\npm\\claude',
  'claude',
];

function spawnClaude(candidate, spawnArgs, opts = {}) {
  const isCmd = candidate.endsWith('.cmd') || candidate.endsWith('.bat');
  return spawnSync(candidate, spawnArgs, { shell: isCmd, ...opts });
}

function findClaude() {
  for (const candidate of CLAUDE_CANDIDATES) {
    try {
      const res = spawnClaude(candidate, ['--version'], { encoding: 'utf-8', timeout: 10000 });
      if (res.status === 0 && res.stdout) return candidate;
    } catch { /* try next */ }
  }
  throw new Error(
    'claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code\n' +
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

function runTests(tags) {
  const tagFlag = tags ? `--tags "${tags}"` : '';
  const formatFlag = '--format json:test-results/cucumber-report.json';
  const cmd = `npx cucumber-js --config cucumber.js ${formatFlag} ${tagFlag}`.trim();

  const resultsDir = path.dirname(RESULTS_JSON);
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

  console.log(`▶ ${cmd}\n`);
  try {
    execSync(cmd, { stdio: 'inherit', cwd: ROOT });
    return true;
  } catch {
    return false;
  }
}

// ─── Parse failures WITH full step sequences ──────────────────────────────────
function parseFailures() {
  if (!fs.existsSync(RESULTS_JSON)) {
    console.warn('⚠️  No cucumber-report.json found.');
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
      const allSteps = (element.steps || []).filter(
        s => !['Before', 'After'].includes((s.keyword || '').trim())
      );
      const failedSteps = allSteps.filter(
        s => s.result?.status === 'failed' || s.result?.status === 'undefined'
      );
      if (failedSteps.length === 0) continue;

      // Find the first navigation step to extract the page URL
      const navStep = allSteps.find(s =>
        /navigat|go to|open|visit|launch/i.test(s.name)
      );

      failures.push({
        feature: feature.name,
        featureUri: feature.uri || '',
        scenario: element.name,
        tags: (element.tags || []).map(t => t.name).join(' '),
        navHint: navStep ? `${navStep.keyword.trim()} ${navStep.name}` : null,
        // Full step sequence with statuses (✅ passed, ❌ failed, ❓ undefined, ⏭ skipped)
        allSteps: allSteps.map(s => ({
          keyword: (s.keyword || '').trim(),
          name: s.name || '',
          status: s.result?.status || 'unknown',
        })),
        // Only the failing steps with full error messages
        failedSteps: failedSteps.map(s => ({
          keyword: (s.keyword || '').trim(),
          name: s.name || '',
          status: s.result?.status || 'unknown',
          error: (s.result?.error_message || '').substring(0, 2000),
        })),
      });
    }
  }
  return failures;
}

// ─── Resolve page URL for a feature ──────────────────────────────────────────
function resolvePageUrl(featureUri) {
  if (!featureUri) return null;
  try {
    const featurePath = path.isAbsolute(featureUri) ? featureUri : path.join(ROOT, featureUri);
    if (!fs.existsSync(featurePath)) return null;
    const content = fs.readFileSync(featurePath, 'utf-8');

    const directUrl = content.match(/navigate\s+to\s+["']?(https?:\/\/[^"'\s]+)["']?/i);
    if (directUrl) return directUrl[1];

    const namedPage = content.match(/navigates?\s+to\s+["']([^"']+)["']/i);
    if (namedPage) {
      const cachePath = path.join(ROOT, '.cache', 'activeEnvironment.json');
      if (fs.existsSync(cachePath)) {
        const env = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
        const key = namedPage[1].toLowerCase().trim();
        const match = Object.entries(env.pageUrls || {}).find(
          ([k]) => k.includes(key) || key.includes(k)
        );
        if (match) return match[1];
      }
    }
  } catch { /* ignore */ }
  return null;
}

// ─── Find matching step files ─────────────────────────────────────────────────
function findRelevantStepFiles(failures) {
  const allFiles = fs.existsSync(STEP_DEFS_DIR)
    ? fs.readdirSync(STEP_DEFS_DIR).filter(f => f.endsWith('.js')).map(f => path.join(STEP_DEFS_DIR, f))
    : [];

  const relevant = new Set();

  for (const failure of failures) {
    if (failure.featureUri) {
      const base = path.basename(failure.featureUri, '.feature');
      const match = allFiles.find(f => path.basename(f).startsWith(base));
      if (match) relevant.add(match);
    }
    for (const stepFile of allFiles) {
      const content = fs.readFileSync(stepFile, 'utf-8');
      for (const step of failure.failedSteps) {
        const partial = step.name.substring(0, 40).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp(partial, 'i').test(content)) relevant.add(stepFile);
      }
    }
  }

  return relevant.size > 0 ? [...relevant] : allFiles;
}

// ─── Build MCP-focused prompt ─────────────────────────────────────────────────
function buildMcpPrompt(failures, relevantStepFiles, allStepFiles) {
  const lines = [];

  lines.push('You are an expert Playwright/Cucumber test automation engineer.');
  lines.push('Fix failing Cucumber step definitions using Playwright MCP for live page inspection.');
  lines.push('');
  lines.push('## Project');
  lines.push(`Root: ${ROOT}`);
  lines.push(`Step definitions: ${STEP_DEFS_DIR}`);
  lines.push(`World: ${path.join(ROOT, 'features', 'cucumber', 'support', 'world.js')}`);
  lines.push('Framework: Cucumber.js + Playwright');
  lines.push('');

  lines.push('## MCP Tools Available');
  lines.push('');
  lines.push('**Playwright MCP** — use these for interactive live-page inspection:');
  lines.push('  - `mcp__playwright__browser_navigate`   → navigate to URL');
  lines.push('  - `mcp__playwright__browser_click`      → click button/link by role+text');
  lines.push('  - `mcp__playwright__browser_fill`       → fill an input field');
  lines.push('  - `mcp__playwright__browser_select_option` → select a dropdown option');
  lines.push('  - `mcp__playwright__browser_snapshot`   → ⭐ get live accessibility tree (DOM snapshot)');
  lines.push('  - `mcp__playwright__browser_screenshot` → take a screenshot for visual reference');
  lines.push('  - `mcp__playwright__browser_wait_for`   → wait for an element to appear');
  lines.push('  - `mcp__playwright__browser_handle_dialog` → handle alert/confirm/prompt dialogs');
  lines.push('  - `mcp__playwright__browser_evaluate`   → run JS in the browser');
  lines.push('  - `mcp__playwright__browser_network_requests` → inspect captured network requests');
  lines.push('');
  lines.push('**Filesystem MCP** — read/write project files:');
  lines.push('  - `mcp__filesystem__read_file`          → read any project file');
  lines.push('  - `mcp__filesystem__write_file`         → write/overwrite a file');
  lines.push('  - `mcp__filesystem__list_directory`     → list directory contents');
  lines.push('  - `mcp__filesystem__search_files`       → search files by pattern');
  lines.push('');
  lines.push('**Direct tools** — also available: Read, Edit, Write, Bash');
  lines.push('');

  lines.push('## MCP Workflow (follow this for EVERY failing scenario)');
  lines.push('');
  lines.push('1. `browser_navigate` → go to the page URL');
  lines.push('2. Reproduce the step sequence:');
  lines.push('   - For each ✅ PASSED step that involves a click/fill, replicate it via MCP');
  lines.push('   - Use `browser_click` for buttons, `browser_fill` for inputs, `browser_wait_for` for modals');
  lines.push('3. `browser_snapshot` → capture DOM at the exact state where the step FAILS');
  lines.push('   - This gives you real element roles, names, labels, and selectors');
  lines.push('4. `browser_screenshot` if you need visual confirmation');
  lines.push('5. Extract the correct selector from the snapshot');
  lines.push('6. Read the failing step file, update the broken locator, save with Edit tool');
  lines.push('7. For UNDEFINED steps: generate a proper implementation using the live DOM selectors');
  lines.push('');

  lines.push('## Failing Scenarios');
  lines.push('');

  for (const [i, failure] of failures.entries()) {
    const pageUrl = resolvePageUrl(failure.featureUri);
    lines.push(`### Scenario ${i + 1}: ${failure.scenario}`);
    lines.push(`**Feature:** ${failure.feature}`);
    if (failure.featureUri) lines.push(`**Feature file:** ${path.join(ROOT, failure.featureUri)}`);
    if (pageUrl) lines.push(`**Page URL:** ${pageUrl}  ← start MCP navigation here`);
    if (failure.tags) lines.push(`**Tags:** ${failure.tags}`);
    lines.push('');

    lines.push('**Full step sequence** (✅=passed, ❌=failed, ❓=undefined, ⏭=skipped):');
    lines.push('Reproduce the ✅ steps via MCP to reach the failure state, then inspect DOM:');
    for (const step of failure.allSteps) {
      const icon = step.status === 'passed' ? '✅' : step.status === 'failed' ? '❌' : step.status === 'undefined' ? '❓' : '⏭';
      lines.push(`  ${icon} ${step.keyword} ${step.name}`);
    }
    lines.push('');

    lines.push('**Failure details:**');
    for (const step of failure.failedSteps) {
      lines.push(`  ❌ [${step.status.toUpperCase()}] ${step.keyword} ${step.name}`);
      if (step.error) {
        lines.push('  Error:');
        for (const errLine of step.error.split('\n').slice(0, 15)) {
          lines.push(`    ${errLine}`);
        }
      }
      lines.push('');
    }
  }

  lines.push('## Files to Fix');
  lines.push('');
  lines.push('Fix ONLY these step files (read them first to understand current implementation):');
  for (const f of relevantStepFiles) lines.push(`  - ${f}`);
  lines.push('');

  if (allStepFiles.length > relevantStepFiles.length) {
    lines.push('Reference-only (do not modify unless a step is genuinely shared):');
    for (const f of allStepFiles.filter(f => !relevantStepFiles.includes(f))) {
      lines.push(`  - ${f}`);
    }
    lines.push('');
  }

  lines.push('## Fix Rules');
  lines.push('');
  lines.push('- Use `browser_snapshot` to get the REAL, current selectors — never guess');
  lines.push('- Prefer selectors in this order: id > name > aria-label > role+text > placeholder > CSS class');
  lines.push('- Use Playwright Locator API: `this.page.locator(sel)`, `getByRole()`, `getByLabel()`, `getByText()`');
  lines.push('- Use World helpers where possible: `this.findElement()`, `this.fillField()`, `this.clickButton()`');
  lines.push('- Do NOT remove or rename existing step regex patterns — only fix their body');
  lines.push('- For UNDEFINED steps: write a full implementation using MCP-discovered selectors');
  lines.push('- Add `await this.page.waitForTimeout(500)` after clicks that trigger animations/modals');
  lines.push('- Use `.first()` when a selector matches multiple elements');
  lines.push('- After all edits: briefly state which files changed and what the root cause was');

  return lines.join('\n');
}

// ─── Invoke Claude with MCP config ────────────────────────────────────────────
function invokeClaude(claudePath, prompt) {
  if (!fs.existsSync(MCP_CONFIG)) {
    console.error(`❌ MCP config not found: ${MCP_CONFIG}`);
    console.error('   Create .vscode/mcp.json with playwright and filesystem server entries.');
    return false;
  }

  console.log(`  🔌 MCP config: ${MCP_CONFIG}`);
  console.log('  📡 Playwright MCP + Filesystem MCP active\n');

  // Playwright MCP tools (server name "playwright")
  const playwrightTools = [
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
  ];

  // Filesystem MCP tools (server name "filesystem")
  const fsTools = [
    'mcp__filesystem__read_file',
    'mcp__filesystem__write_file',
    'mcp__filesystem__list_directory',
    'mcp__filesystem__search_files',
  ];

  const allowedTools = ['Edit', 'Read', 'Write', 'Bash', ...playwrightTools, ...fsTools].join(',');

  const claudeArgs = [
    '-p', prompt,
    '--allowedTools', allowedTools,
    '--mcp-config', MCP_CONFIG,
    '--dangerously-skip-permissions',
  ];

  const isCmd = claudePath.endsWith('.cmd') || claudePath.endsWith('.bat');
  const result = spawnSync(claudePath, claudeArgs, {
    cwd: ROOT,
    shell: isCmd,
    encoding: 'utf-8',
    stdio: ['pipe', 'inherit', 'inherit'],
    timeout: 900000, // 15 minutes — MCP navigation takes longer than static analysis
    maxBuffer: 50 * 1024 * 1024,
  });

  if (result.error) {
    console.error('❌ Claude invocation error:', result.error.message);
    return false;
  }
  return result.status === 0;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  banner('MCP Auto-Fixer — Playwright MCP + Live Page Inspection');
  console.log(`Max iterations : ${MAX_ITERATIONS}`);
  console.log(`MCP config     : ${MCP_CONFIG}`);
  if (tagsArg) console.log(`Tags filter    : ${tagsArg}`);
  if (NO_RERUN) console.log('Mode           : fix-once (--no-rerun)');
  console.log('');

  if (!fs.existsSync(MCP_CONFIG)) {
    console.error(`❌ MCP config not found: ${MCP_CONFIG}`);
    console.error('   Ensure .vscode/mcp.json defines "playwright" and "filesystem" servers.');
    process.exit(1);
  }

  const claudePath = findClaude();
  console.log(`✅ Claude Code: ${claudePath}\n`);

  let iteration = 0;
  let prevFailCount = Infinity;

  while (iteration < MAX_ITERATIONS) {
    iteration++;
    banner(`Iteration ${iteration} / ${MAX_ITERATIONS}`);

    // Run tests (skip on first pass when --no-rerun and we already have a report)
    const shouldRunTests = !(NO_RERUN && iteration === 1 && fs.existsSync(RESULTS_JSON));
    let passed = false;
    if (shouldRunTests) {
      passed = runTests(tagsArg);
    } else {
      console.log('⏭  Skipping test run — using existing cucumber-report.json\n');
    }

    if (passed) {
      banner('✅ ALL SCENARIOS PASSED');
      process.exit(0);
    }

    const failures = parseFailures();

    if (failures.length === 0) {
      banner('✅ NO FAILURES IN REPORT');
      process.exit(0);
    }

    console.log(`❌ ${failures.length} scenario(s) failed:\n`);
    for (const f of failures) {
      console.log(`   • [${f.feature}] ${f.scenario}`);
      for (const s of f.failedSteps) {
        console.log(`     └─ [${s.status}] ${s.keyword} ${s.name}`);
      }
    }
    console.log('');

    if (failures.length >= prevFailCount && iteration > 1) {
      console.warn('⚠️  Failure count did not decrease — trying a different fix strategy.\n');
    }
    prevFailCount = failures.length;

    if (iteration === MAX_ITERATIONS) {
      console.log(`\n❌ Reached max iterations (${MAX_ITERATIONS}) without full pass.\n`);
      process.exit(1);
    }

    const allStepFiles = fs.existsSync(STEP_DEFS_DIR)
      ? fs.readdirSync(STEP_DEFS_DIR).filter(f => f.endsWith('.js')).map(f => path.join(STEP_DEFS_DIR, f))
      : [];
    const relevantFiles = findRelevantStepFiles(failures);

    console.log(`📂 Relevant step files:\n${relevantFiles.map(f => '   ' + f).join('\n')}\n`);

    banner(`Invoking Claude with Playwright MCP (iteration ${iteration})`);
    const prompt = buildMcpPrompt(failures, relevantFiles, allStepFiles);
    const ok = invokeClaude(claudePath, prompt);

    if (!ok) console.warn('⚠️  Claude returned non-zero — re-running tests anyway.\n');

    if (NO_RERUN) {
      console.log('✅ Fix applied (--no-rerun). Run tests manually to verify.\n');
      process.exit(0);
    }
  }
}

main().catch(err => {
  console.error('\n💥 Fatal error in MCP auto-fixer:', err.message);
  process.exit(1);
});
