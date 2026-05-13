# Confluence Test Agent — Framework Documentation

## Overview

An AI-driven automated test orchestration system that connects Confluence as a source of truth for test data and feature files, auto-generates Playwright step definitions using DOM inspection, runs Cucumber BDD tests, and uploads results back to Confluence.

```
Confluence  ──→  Feature Files  ──→  Step Generation  ──→  Cucumber Tests  ──→  Reports  ──→  Confluence
  (data)       (downloaded)         (AI + DOM scan)        (Playwright)         (PDF)        (uploaded)
```

---

## Directory Structure

```
ConfluenceTestAgent/
├── scripts/                          # All orchestrator, generator, and fixer scripts
│   ├── agentOrchestrator.js          # Master pipeline — runs the full workflow end-to-end
│   ├── fetchFeatures.js              # Downloads feature files from Confluence
│   ├── generateStepDefs.js           # Auto-generates step definitions from .feature files
│   ├── domInspector.js               # Static DOM inspection (extracts selectors from live page)
│   ├── mcpDomInspector.js            # MCP-assisted modal inspection (dynamic DOM capture)
│   ├── stepPatternLibrary.js         # Curated step patterns for well-known test actions
│   ├── claudeFixLoop.js              # Static DOM pre-scan + Claude Code auto-fix loop
│   ├── mcpAutoFixer.js               # Live browser + Claude Code auto-fix loop
│   ├── generateReport.js             # Renders Cucumber JSON output to PDF via Chromium
│   ├── uploadReportToConfluence.js   # Uploads PDF reports, updates Confluence table
│   ├── uploadFeatureFile.js          # Uploads a local .feature file back to Confluence as attachment
│   ├── setFeatureRun.js              # Toggle Run column on Confluence Feature Selection table
│   ├── addRunColumn.js               # Add Run column to Feature Selection table
│   ├── addReportColumn.js            # Add Report column to Feature Selection table
│   ├── addAutomationStatusColumn.js  # Add Automation Status column to Feature Selection table
│   ├── debugRyiForm.js / debugRyiSubmit.js / debugRyiWithHelper.js   # Genesis RYI form debug utilities
│   ├── inspectBATDModal.js / inspectFAD.js / inspectResults.js       # DOM probe scripts (debug only)
│   ├── inspectSetLocation.js / inspect_ownership_popup.js            # Modal probe scripts (debug only)
│   └── _debugFuelType.js / _inspectOwnershipForm.mjs / _tempInspect.mjs / _tempOwnershipInspect.mjs  # Throwaway probes
│
├── features/cucumber/
│   ├── *.feature                     # Feature files (downloaded from Confluence at runtime)
│   ├── step_definitions/             # Step definition files (auto-generated + manual)
│   │   ├── *_auto.steps.js           # Auto-generated step definitions per feature
│   │   ├── common_steps.js           # Shared step implementations
│   │   ├── commonHelpers.js          # Shared helper functions (no Cucumber imports)
│   │   └── contact_a_dealer.steps.js # Hand-written CAD steps (non-auto)
│   └── support/
│       ├── world.js                  # Cucumber World — shared browser state & helpers
│       └── genesisFormHelpers.js     # Genesis CRM form selector maps and fill helpers
│
├── utils/
│   ├── confluenceReader.js           # Reads Confluence tables into JSON arrays
│   ├── confluenceConfig.js           # Confluence credentials and page IDs
│   └── autoHealLocator.js            # Selector healing engine — tries fallback selectors
│
├── .cache/                           # Runtime caches (auto-created)
│   ├── activeEnvironment.json        # Current environment config (URL map)
│   ├── selectedFeatures.json         # Feature paths selected for this run
│   ├── healed-locators.json          # Log of auto-healed selectors
│   ├── domMaps/                      # Static DOM field maps (24h TTL per URL)
│   └── mcpDomMaps/                   # Modal DOM field maps from MCP inspection
│
├── test-results/
│   └── cucumber-report.json          # Cucumber JSON output from last run
│
├── excel-reports/                    # Generated PDF and HTML test reports
├── screenshots/                      # Scenario screenshots and API payloads
│
├── package.json                      # Dependencies and npm scripts
├── cucumber.js                       # Cucumber config (reads selectedFeatures.json)
├── generate.config.json              # Feature allowlist for step generation
├── .vscode/mcp.json                  # MCP server registration (Playwright + filesystem)
└── .env                              # Confluence credentials (not committed)
```

---

## Configuration

### `.env`
```
CONFLUENCE_BASE_URL=https://orchardhome.atlassian.net/wiki
CONFLUENCE_EMAIL=janki.gajjar@orchard.com.au
CONFLUENCE_API_TOKEN=<token>
CONFLUENCE_TEST_DATA_PAGE_ID=1776353299
CONFLUENCE_FEATURE_FILE_PAGE_ID=1729724417
TARGET_ENVIRONMENT=Stage      # Stage | Production — selects URL map from Confluence
HEADLESS=true                 # set to false to watch the browser
```

Additional runtime env vars consumed by scripts:

| Variable | Read by | Effect |
|---|---|---|
| `MCP_DOM=1` | `generateStepDefs.js` | Force MCP modal inspection during generation (same as `--mcp`) |
| `UPDATE_STEPS=1` | `generateStepDefs.js`, `agentOrchestrator.js` | Force append-missing-steps on existing files (same as `--update-steps`) |

### `generate.config.json`
Controls which feature files the step generator processes by default. If `--all` flag is used or `--feature <name>` is passed, the allowlist is ignored.

```json
{
  "allow": [
    "FindADealer-FIFO",
    "talk-to-an-expert"
  ]
}
```

### `.vscode/mcp.json`
Registers the Playwright MCP server (used by `mcpAutoFixer.js` and `mcpDomInspector.js`) and a filesystem server scoped to the workspace.

```json
{
  "servers": {
    "playwright": {
      "type": "stdio",
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    },
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "@modelcontextprotocol/server-filesystem",
        "c:\\ConfluenceTestAgent"
      ]
    }
  }
}
```

### `cucumber.js`
Reads `.cache/selectedFeatures.json` to determine which feature files to run. Requires all step definition files from `features/cucumber/step_definitions/`.

---

## Full Pipeline

```
npm run agent:run
```

```
1. confluenceReader.readAllSheets()
   └── Fetch environment config (active env, page URLs) and all test data tables

2. fetchFeatures.js
   └── Read Feature Selection table on Confluence
   └── Download .feature files where Run column = "Yes"
   └── Write .cache/selectedFeatures.json

3. generateStepDefs.js
   └── For each .feature: check if `<feature>_auto.steps.js` already exists
       ├── EXISTS  → skip entirely (no DOM inspection, no MCP, no edits) — file is user-owned
       │                  Pass `--update-steps` to override and append missing steps
       └── MISSING → Run domInspector.js on target URL (static DOM field scan)
                          (Optional) Run mcpDomInspector.js for modal elements (--mcp flag)
                          Generate step code using stepPatternLibrary + auto-categorization
                          Write new *_auto.steps.js (never overwrites existing files)

4. npx cucumber-js
   └── Load world.js (launch Chromium, set up network capture)
   └── Run all selected feature scenarios
   └── Write test-results/cucumber-report.json

5. [If failures] claudeFixLoop.js or mcpAutoFixer.js
   └── Parse failures from cucumber-report.json
   └── Invoke Claude Code with failure context + DOM map
   └── Claude edits .steps.js files
   └── Re-run tests (up to 5 iterations)

6. generateReport.js
   └── Read cucumber-report.json
   └── Render HTML report → PDF via headless Chromium
   └── Write excel-reports/TestReport_<Feature>_<timestamp>.pdf

7. uploadReportToConfluence.js
   └── POST PDF to Confluence as attachment
   └── Update Report column in Feature Selection table with link
```

---

## npm Scripts Reference

| Script | Description |
|---|---|
| `npm run agent:run` | Full pipeline |
| `npm run agent:run:no-gen` | Pipeline without fetching or generating (`--skip-fetch --skip-generate`) |
| `npm run agent:claude-fix` | Pipeline + Claude auto-fix loop |
| `npm run agent:mcp-fix` | Pipeline + MCP live-browser auto-fix |
| `npm run agent:fetch-and-test` | Fetch features then run Cucumber (no report) |
| `npm run agent:full` | Fetch + Cucumber + PDF report (no upload, no fix loop) |
| `npm run fetch:features` | Download feature files from Confluence only |
| `npm run test:cucumber` | Run Cucumber tests only |
| `npm run test:contactus` | Run Cucumber tests tagged `@contact-us` only |
| `npm run steps:generate` | Generate steps for features in allowlist |
| `npm run steps:generate:fad` | Generate steps for FindADealer-FIFO only |
| `npm run steps:generate:fad:mcp` | Generate FindADealer-FIFO steps with MCP modal inspection |
| `npm run steps:generate:mcp` | Generate steps with MCP modal inspection |
| `npm run steps:generate:all` | Generate steps for all feature files |
| `npm run fix:loop` | Claude fix loop without full pipeline |
| `npm run fix:loop:smoke` | Claude fix loop scoped to `@smoke` |
| `npm run fix:loop:footer` | Claude fix loop scoped to `@footerSubscribe` |
| `npm run fix:mcp` | MCP fix loop without full pipeline |
| `npm run fix:mcp:smoke` | MCP fix loop scoped to `@smoke` |
| `npm run fix:mcp:once` | MCP fix loop — single pass, no re-run |
| `npm run report:pdf` | Generate PDF from last test run |
| `npm run report:upload` | Upload PDF to Confluence |
| `npm run feature:enable` | Toggle Run column on Confluence (`setFeatureRun.js`) |
| `npm run feature:add-run-column` | One-time: add Run column to Feature Selection table |
| `npm run feature:add-report-column` | One-time: add Report column to Feature Selection table |

---

## Key Scripts — How They Work

### `agentOrchestrator.js`
Master entry point. Chains all pipeline steps. Accepts CLI flags:
- `--skip-fetch` — Reuse cached data (skip Confluence fetch)
- `--skip-generate` — Skip step definition generation entirely
- `--update-steps` — Re-run generation against features whose step file already exists (default behaviour preserves them)
- `--report-only` — Generate and upload report from existing results
- `--claude-fix` — After test run, start Claude auto-fix loop on failures
- `--mcp-fix` — After test run, start MCP live-browser fix loop
- `--tags "..."` — Filter scenarios by Cucumber tag

---

### `fetchFeatures.js`
1. Calls Confluence REST API for Feature File page (page ID from `.env`)
2. Parses the HTML body using Cheerio to find the Feature Selection table
3. Reads the "Run" column — keeps rows where value is `Yes`, `✅`, or `✓`
4. Downloads the `.feature` file attachment for each selected row
5. Auto-repairs common issues (missing `Scenario:` keyword after `@tags`)
6. Writes downloaded files to `features/cucumber/`
7. Writes `selectedFeatures.json` listing paths for `cucumber.js`

---

### `generateStepDefs.js`
The core AI step generator. Never overwrites existing implementations.

**Guards:**
- `// @locked` on line 1 → skip the file entirely, no changes
- `// @protected` on line 1 → lock existing steps, but still append new ones

**Generation Pipeline per feature file:**
```
1. parseFeatureSteps()         — extract all step texts + target URL
2. scanExistingSteps()         — read all .steps.js files, build pattern registry
3. findMatchingDef()           — check each step against existing patterns
4. domInspector.inspectPage()  — navigate target URL, extract field label → selector map
5. mcpDomInspector (optional)  — click modal triggers, extract dynamic DOM state
6. For each undefined step:
   a. matchStepPattern()       — check curated pattern library for exact match
   b. categorizeStep()         — classify step type (navigate, click, fill, select, ...)
   c. generateStepBody()       — write Playwright code using DOM map selectors
7. Append new steps to *_auto.steps.js
```

**Feature filter flags:**
```bash
node scripts/generateStepDefs.js                        # uses generate.config.json allowlist
node scripts/generateStepDefs.js --feature FindADealer  # one specific feature
node scripts/generateStepDefs.js --all                  # all feature files
node scripts/generateStepDefs.js --mcp                  # with MCP modal inspection
```

---

### `domInspector.js`
Navigates the target URL in headless Chromium and extracts the form field structure.

1. Launches Playwright Chromium (headless)
2. Visits homepage first (AEM staging warm-up to establish session cookie)
3. Navigates to target URL, waits for networkidle
4. Runs client-side JS to:
   - Build `labelForMap`: element id → associated label text
   - Extract all `<input>`, `<textarea>`, `<select>` elements
   - Compute CSS selector per field (by id, name, placeholder, aria-label, parent label)
   - Collect button labels and API request patterns
5. Caches result to `.cache/domMaps/<urlHash>.json` (24-hour TTL)
6. Returns `{ fields, buttons, errorContainers, apiPatterns }`

---

### `mcpDomInspector.js`
Extends DOM inspection to capture elements inside dynamically opened modals.

1. Connects to Playwright MCP server via `@modelcontextprotocol/sdk` stdio transport
2. Spawns `npx @playwright/mcp --headless` as a subprocess
3. Navigates to the target URL via MCP `browser_navigate` tool
4. Replays click sequence (e.g. clicks "Book a test drive" button) to open modal
5. Runs same DOM extraction JS as `domInspector.js` via `browser_evaluate`
6. Captures accessibility tree snapshot via `browser_snapshot`
7. Caches to `.cache/mcpDomMaps/<hash>.json`

The `generateStepDefs.js` calls `detectModalTriggers(parsedFeature)` to identify which steps trigger modals (e.g. "user clicks on Book a test drive"), then passes those as the click sequence.

---

### `world.js` (Cucumber World)
Initialized once per scenario. Provides shared browser state and reusable helpers to all step definitions.

**Browser Setup (Before hook):**
- Launches Chromium with realistic user-agent (avoids bot detection)
- Viewport: 1920×1080
- Geolocation: Sydney (lat -33.8688, lng 151.2093)
- Disables webdriver detection flags
- Sets up CDP session for network request capture

**Properties available in every step (`this.`):**
| Property | Description |
|---|---|
| `this.page` | Playwright Page instance |
| `this.browser` | Playwright Browser instance |
| `this.testDriveData` | Test data rows from Confluence (BATD) |
| `this.contactDealerData` | Test data rows (CAD) |
| `this.allConfluenceData` | All Confluence table data (keyed by table name) |
| `this.pageUrls` | Environment page URL map |
| `this.networkRequests` | Captured network requests |
| `this.networkResponses` | Captured network responses |

**Helper methods available in every step (`this.`):**
| Method | Description |
|---|---|
| `findElement(hint, type)` | Auto-heal locator by label/name/id |
| `fillField(hint, value)` | Fill input with auto-heal fallbacks |
| `selectDropdown(hint, option)` | Select dropdown option with fallbacks |
| `clickButton(label)` | Click button by text with fallbacks |
| `setCheckbox(hint, checked)` | Check or uncheck checkbox |
| `isVisible(hint)` | Test element visibility |

---

### `autoHealLocator.js`
When a selector fails, the auto-healer tries progressively broader alternatives.

For a field hint like `"email"`:
```
1. [id="email"]
2. [name="email"]
3. input[placeholder*="email" i]
4. input[aria-label*="email" i]
5. label:has-text("email") + input
6. [class*="email"] input
7. ... (10+ variants)
```

All healed selectors are logged to `.cache/healed-locators.json` for review.

---

### `claudeFixLoop.js`
Runs when tests fail and `--claude-fix` flag is used.

1. Parses `cucumber-report.json` for failed scenarios
2. Extracts: failed step text, error message, stack trace, feature file path
3. Runs `domInspector.inspectPage()` on the failing feature's URL (pre-scan)
4. Builds a prompt containing:
   - Full step sequence (which passed, which failed)
   - Error messages
   - DOM field map (ready-to-use selectors from live page)
   - Path to the step definition file to fix
5. Invokes `claude` CLI with the prompt
6. Claude reads the file, diagnoses the failure, edits the step definition
7. Re-runs Cucumber
8. Repeats up to `MAX_ITERATIONS = 5` times

---

### `mcpAutoFixer.js`
Same as `claudeFixLoop.js` but uses live browser instead of static DOM pre-scan.

- Claude is invoked with `--mcp-config` pointing to `.vscode/mcp.json`
- Claude can use Playwright MCP tools: navigate page, click elements, read DOM
- Claude replays the failing scenario steps, observes the actual DOM state at failure
- More accurate for modals and dynamic content — no pre-scan needed
- Slower: browser startup overhead per fix iteration

---

### `generateReport.js`
1. Reads `test-results/cucumber-report.json`
2. Filters results per feature (for per-feature reports)
3. Renders an HTML report:
   - Summary cards: scenarios passed / failed / pending
   - Per-scenario step list with status badges (✅ ❌ ⏭)
   - Embedded screenshots
   - API payload snapshots
4. Opens headless Chromium, loads the HTML, prints to PDF
5. Saves to `excel-reports/TestReport_<Feature>_<timestamp>.pdf`

---

### `uploadReportToConfluence.js`
1. POSTs the PDF file to Confluence as an attachment (REST API `/content/{pageId}/child/attachment`)
2. Detects if attachment already exists (updates instead of duplicating)
3. Updates the "Report" column in the Feature Selection table:
   - Parses the Confluence page HTML with Cheerio
   - Finds the row matching the feature file name
   - Inserts `<ac:link><ri:attachment ri:filename="X.pdf" /></ac:link>` macro
   - PUTs the updated page content back to Confluence

---

## Step Definition Files

### Naming Convention
```
features/cucumber/step_definitions/
├── <FeatureName>_auto.steps.js    # auto-generated (safe to regenerate with --feature flag)
├── common_steps.js                # shared steps used by multiple features
├── commonHelpers.js               # utility functions (no Cucumber imports)
└── genesisFormHelpers.js          # Genesis CRM form selector maps
```

### Guards (first line of file)
| Guard | Effect |
|---|---|
| `// @locked` | Generator skips this file entirely — no DOM scan, no append |
| `// @protected` | Generator locks existing steps but still appends new ones |
| _(no guard)_ | Generator may regenerate or append steps |

### Step-File Lifecycle (default behaviour)

Once a step file has been generated, it is treated as **user-owned** on every subsequent run:

| Scenario | What happens |
|---|---|
| `<feature>_auto.steps.js` does **not** exist | DOM inspection (+ optional MCP) runs and a fresh file is generated |
| `<feature>_auto.steps.js` **already** exists | File is skipped entirely on a clean run — no DOM inspection, no MCP, no edits |
| Tests fail at runtime | Claude / MCP fix loop runs and may patch step files (respects `// @locked` and `// @protected`) |
| User wants to refresh an existing file | Pass `--update-steps` (or set `UPDATE_STEPS=1`) to re-engage append-missing-steps |

This means **fetching new test data or re-running the agent will never overwrite hand-tuned step code**. Auto-fixes only happen in response to a real test failure.

### Regenerating a Specific Step File
```bash
# Force re-generation of an existing file (append missing steps only):
node scripts/agentOrchestrator.js --update-steps

# Or via the generator directly:
node scripts/generateStepDefs.js --feature FindADealer-FIFO --update-steps

# Full clean regeneration — delete the file first:
Remove-Item features/cucumber/step_definitions/FindADealer_FIFO_auto.steps.js
node scripts/generateStepDefs.js --feature FindADealer-FIFO
```

---

## Confluence Page Structure

### Test Data Page (ID: 1776353299)
Contains multiple tables read by `confluenceReader.js`:

| Table Name | Used For |
|---|---|
| Environment Configuration | Which environment is active (Stage/Prod) |
| Environment URLs | Page URLs per environment |
| Test Drive FIFO PCM2 - Test Data | BATD form field values |
| Contact a dealer FIFO PCM2- Test Data | CAD form field values |
| Book a Service - Test Data | BAS form field values |
| (other tables) | Feature-specific test data |

### Feature File Page (ID: 1729724417)
Contains a Feature Selection table:

| Feature File | Run | Report | Automation Status |
|---|---|---|---|
| FindADealer-FIFO.feature | Yes | [PDF link] | Pass |
| ContactUs.feature | No | | |

- **Run column:** `Yes`/`No` controls which features are downloaded and executed (toggle with `npm run feature:enable`)
- **Report column:** Updated by `uploadReportToConfluence.js` after each run (PDF attachment link)
- **Automation Status column:** Set to `Pass`/`Fail` by `uploadReportToConfluence.js` based on the Cucumber result. Add the column once with `node scripts/addAutomationStatusColumn.js`.

---

## MCP Integration

Playwright MCP (`@playwright/mcp`) enables Claude to control a real browser during fix loops and step generation.

### Config: `.vscode/mcp.json`
```json
{
  "servers": {
    "playwright": {
      "type": "stdio",
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    },
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "@modelcontextprotocol/server-filesystem",
        "c:\\ConfluenceTestAgent"
      ]
    }
  }
}
```

### MCP Tools Used
| Tool | Used In | Purpose |
|---|---|---|
| `browser_navigate` | mcpDomInspector, mcpAutoFixer | Navigate to URL |
| `browser_evaluate` | mcpDomInspector | Run JS to extract DOM field map |
| `browser_snapshot` | mcpDomInspector | Capture accessibility tree |
| `browser_click` | mcpAutoFixer (via Claude) | Click elements on live page |
| `browser_type` | mcpAutoFixer (via Claude) | Fill form fields |

### When MCP Is Used
- **Step generation:** `npm run steps:generate:mcp` — inspects modals before generating steps
- **Auto-fix:** `npm run fix:mcp` — Claude navigates the live page to diagnose failures

---

## Caching

| Cache File | TTL | Purpose |
|---|---|---|
| `.cache/domMaps/<urlHash>.json` | 24 hours | Static DOM field map per URL |
| `.cache/mcpDomMaps/<key>.json` | 24 hours | Modal DOM field map per URL+clicks |
| `.cache/activeEnvironment.json` | Per run | Active environment config |
| `.cache/selectedFeatures.json` | Per run | Feature paths for cucumber.js |
| `.cache/healed-locators.json` | Persistent | History of auto-healed selectors |

Delete `.cache/domMaps/` or `.cache/mcpDomMaps/` to force a fresh DOM inspection.

---

## Adding a New Feature

1. Create the `.feature` file in Confluence as an attachment on the Feature File page
2. Add a row to the Feature Selection table with `Run = Yes`
3. Run `npm run agent:run` — the framework will:
   - Download the feature file
   - Inspect the target page DOM
   - Generate step definitions
   - Run the tests
   - Upload the report

To regenerate steps for a specific feature at any time:
```bash
node scripts/generateStepDefs.js --feature <FeatureName>
```

To prevent the generator from touching a step file:
```js
// @locked          ← add as the very first line of the .steps.js file
```

---

## Run Commands — When To Use Which

The orchestrator's behaviour depends on whether a step file already exists for the feature you're running.

### Scenario A — New feature (no step file yet)

You've added a brand new `.feature` file (locally or via Confluence) and there is **no** `<feature>_auto.steps.js` yet.

```powershell
# Full pipeline: fetch data + features, inspect DOM, generate step file, run tests, upload report
npm run agent:run

# Headed (watch the browser):
$env:HEADLESS="false"; node scripts/agentOrchestrator.js

# Generate the step file only (skip tests + report):
node scripts/generateStepDefs.js --feature <FeatureName>
# with MCP modal inspection (recommended for modal-heavy pages):
node scripts/generateStepDefs.js --feature <FeatureName> --mcp
```

The framework runs DOM inspection + (optionally) MCP, writes a fresh `<feature>_auto.steps.js`, then runs the tests.

#### How navigation URLs are resolved (no manual fixing required)

The generator reads each `.feature` file and identifies the target page from any of these phrasings:

| Gherkin phrasing | Page key extracted |
|---|---|
| `the user navigates to Contact Us` | `contact us` |
| `the user opens the Find a Dealer page` | `find a dealer` |
| `I am a user on the Customer Care page` | `customer care` |
| `user is on the Test Drive page` | `test drive` |
| `navigates to "https://..."` | (uses URL literally) |

That key is then resolved against the **Environment URLs** table on Confluence (cached in `.cache/activeEnvironment.json`) for the active environment (`TARGET_ENVIRONMENT` in `.env`, e.g. Stage):

```jsonc
// .cache/activeEnvironment.json
{
  "activeEnvironment": "Stage",
  "pageUrls": {
    "contact us": "https://stage.hyundai.com.au/au/en/customer-care/contact-us",
    "find a dealer": "https://stage.hyundai.com.au/au/en/find-a-dealer",
    ...
  }
}
```

The generated step uses `this.pageUrls[<key>]` at runtime, so switching `TARGET_ENVIRONMENT` to `Production` will automatically navigate to the prod URL — no step-file edits needed.

If a page key isn't in Confluence yet, the generator embeds a hardcoded fallback URL based on the active environment so the test can still run; you can add the key to the **Environment URLs** Confluence table afterwards.

### Scenario B — Existing step file (already generated and tuned)

The step file exists and you've fixed it. You don't want it touched again.

```powershell
# Default run — existing step files are PRESERVED automatically:
npm run agent:run

# Reuse cached Confluence data + features (no re-fetch):
node scripts/agentOrchestrator.js --skip-fetch

# Skip generation entirely (fastest — go straight to running tests):
node scripts/agentOrchestrator.js --skip-fetch --skip-generate

# Headed mode for debugging:
$env:HEADLESS="false"; node scripts/agentOrchestrator.js --skip-fetch --skip-generate
```

On a clean run the generator will print:
```
⏭  <Feature>.feature — step file already exists; skipping generation. Use --update-steps to force.
```

### Scenario C — You explicitly want to refresh an existing step file

Only do this when the page has changed and you actually want the generator to inspect the DOM and append newly-detected steps.

```powershell
# Append missing steps into the existing file (respects // @protected and // @locked):
node scripts/agentOrchestrator.js --update-steps

# Generator only:
node scripts/generateStepDefs.js --feature <FeatureName> --update-steps

# Full clean regeneration (delete first, then generate):
Remove-Item features/cucumber/step_definitions/<Feature>_auto.steps.js
node scripts/generateStepDefs.js --feature <FeatureName>
```

### Scenario D — Tests fail and you want auto-fix

Auto-fix runs **only on test failure** — never on a clean run.

```powershell
# Default: orchestrator auto-invokes the Claude fix loop on failure
npm run agent:run

# Force the Claude fix loop even on partial failures:
node scripts/agentOrchestrator.js --claude-fix

# MCP-driven live-browser fix loop (interactive DOM inspection):
node scripts/agentOrchestrator.js --mcp-fix
```

The fix loop edits step files in place and re-runs tests up to 5 iterations. Files marked `// @locked` are never modified; `// @protected` files have their existing step bodies preserved but new steps may be appended.

### Quick Reference

| Situation | Command |
|---|---|
| New feature, full pipeline | `npm run agent:run` |
| Existing feature, fastest re-run | `node scripts/agentOrchestrator.js --skip-fetch --skip-generate` |
| Refresh an existing step file | `node scripts/agentOrchestrator.js --update-steps` |
| Generate one feature's steps only | `node scripts/generateStepDefs.js --feature <Name>` |
| Headed debug | `$env:HEADLESS="false"; <any command above>` |
| Manual fix loop | `npm run agent:claude-fix` or `npm run agent:mcp-fix` |
| Report only (re-render last run) | `node scripts/agentOrchestrator.js --report-only` |

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| Steps are `undefined` | Step text doesn't match any definition | Run `steps:generate:fad` to append new steps |
| Ambiguous step error | Same step defined in two `.steps.js` files | Remove duplicate from one file |
| Selector timeout | DOM changed on live page | Run `fix:mcp` to let Claude inspect and fix |
| 404 after location search | Autocomplete not selecting a valid suggestion | Check `_fillLocation` helper in step file |
| Feature not running | Run column is `No` on Confluence | Run `npm run feature:enable` |
| Old DOM map used | Cache not expired | Delete `.cache/domMaps/` and regenerate |
| Report not uploading | API token expired | Update `CONFLUENCE_API_TOKEN` in `.env` |
