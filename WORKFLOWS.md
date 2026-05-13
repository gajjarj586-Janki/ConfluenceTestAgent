# Confluence Test Agent — Day-to-Day Workflows

This document explains what actually happens, end-to-end, in three common situations:

1. **A new field is added to a form on the live page** (existing feature file).
2. **A brand-new `.feature` file is added** (no step definitions yet).
3. **A test fails** — how Claude diagnoses and fixes it.

> All paths are relative to the repo root. See [FRAMEWORK.md](FRAMEWORK.md) for the higher-level architecture.

---

## 1. Workflow — A new field is added to an existing form

### 1.1 The situation

The web page now has a new input (e.g. the BATD form just gained a **"Preferred contact time"** dropdown). The existing `<feature>_auto.steps.js` file has no step or selector for it.

There are two sub-cases:

| Case | Did the `.feature` file gain a new Gherkin step for the new field? |
|---|---|
| **A** | YES — Confluence has been updated and the feature file now has e.g. `And the user selects "Morning" as preferred contact time` |
| **B** | NO — the `.feature` file is unchanged; the page just has an extra field that the scenario doesn't exercise |

In **Case B** there is nothing to do — the test doesn't touch the new field, so no code change is needed.
**Case A** is what the rest of this section covers.

### 1.2 What the framework does (and what you do)

By default, once `<feature>_auto.steps.js` exists, the generator **skips it**. So adding a new step to the `.feature` file alone is not enough — you have to explicitly ask the generator to update the existing file.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  npm run fetch:features                                                  │
│      └─ pulls the updated .feature from Confluence into features/cucumber│
│                                                                          │
│  node scripts/generateStepDefs.js --feature <Name> --update-steps        │
│      ├─ parses the .feature, lists every step                            │
│      ├─ scans every existing *.steps.js and builds a regex registry      │
│      ├─ flags steps with no match as "undefined"                         │
│      ├─ runs domInspector.inspectPage(<page URL>)                        │
│      │     • caches result in .cache/domMaps/<urlHash>.json (24h TTL)    │
│      │     • returns a label → CSS-selector map for every input/select  │
│      ├─ (optional, --mcp) opens modals via Playwright MCP and merges     │
│      │     additional fields from the modal DOM                          │
│      ├─ for each undefined step:                                         │
│      │     1. tries stepPatternLibrary.matchStepPattern() (curated)      │
│      │     2. falls back to categorizeStep() (fill / select / click ...) │
│      │     3. resolveFieldSelector(label) returns the live selector      │
│      │        from the freshly-inspected DOM map                         │
│      │     4. writes a Playwright body using this.fillField /            │
│      │        this.selectDropdown / this.clickButton                     │
│      └─ APPENDS new steps to the existing _auto.steps.js (never deletes) │
│                                                                          │
│  npm run test:cucumber       # validate                                  │
└──────────────────────────────────────────────────────────────────────────┘
```

### 1.3 Quick recipes

```powershell
# Most common: refresh one feature's step file after a UI change
node scripts/generateStepDefs.js --feature BATD-smoke --update-steps

# Modal-heavy page (selectors live inside a dialog)
node scripts/generateStepDefs.js --feature BATD-smoke --update-steps --mcp

# Run via the orchestrator instead (fetch + generate + test in one go)
node scripts/agentOrchestrator.js --update-steps

# Force-blast: nuclear refresh — delete the file and regenerate from scratch
Remove-Item features/cucumber/step_definitions/BATD_smoke_auto.steps.js
node scripts/generateStepDefs.js --feature BATD-smoke --mcp
```

### 1.4 How the correct locator gets picked

`domInspector.js` walks the live page and produces records like:

```jsonc
{
  "label": "Preferred contact time",
  "tag": "select",
  "type": null,
  "id": "preferredContactTime",
  "name": "preferredContactTime",
  "selector": "#preferredContactTime"
}
```

`resolveFieldSelector("preferred contact time")` then matches that record by:

1. exact `label` match (case-insensitive),
2. fuzzy `label` (whitespace / punctuation normalised),
3. `name`, then `id`, then `placeholder`, then `aria-label`,
4. nearest `<label>` text.

The first match wins, and its `selector` is baked into the generated step body. At runtime, `world.js` helpers (`this.fillField`, `this.selectDropdown`) wrap that selector with `autoHealLocator.js`, which retries 10+ broader variants if the primary fails — so a small DOM change later usually still works without regeneration.

### 1.5 Guarding hand-tuned code

If you've manually tuned a step file and want the generator to leave parts of it alone:

| First line of file | Effect |
|---|---|
| `// @locked` | Generator skips the file completely (even with `--update-steps`). Use this on heavily customised files. |
| `// @protected` | Existing step bodies are preserved, but new steps are still appended. Use this on partly-customised files. |
| _(none)_ | Default: file is user-owned but can have missing steps appended via `--update-steps`. |

---

## 2. Workflow — A brand-new feature file is added

### 2.1 The situation

A new feature has been authored on Confluence (e.g. `NewLeadForm.feature`) and the **Run** column on the Feature Selection table is set to `Yes`. There is **no** step file in the repo yet.

### 2.2 What the framework does

```
npm run agent:run
        │
        ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  Step 1 — confluenceReader.readAllSheets()                                  │
│      • pulls Environment Config + Environment URLs + all test-data tables  │
│      • writes .cache/activeEnvironment.json (pageUrls map keyed by name)   │
│                                                                            │
│  Step 2 — fetchFeatures.js                                                  │
│      • reads the Feature Selection table on Confluence                     │
│      • downloads every `.feature` attachment where Run = Yes               │
│      • writes them into features/cucumber/                                 │
│      • writes .cache/selectedFeatures.json so cucumber.js only runs these  │
│                                                                            │
│  Step 3 — generateStepDefs.js                                               │
│      For NewLeadForm.feature:                                              │
│        a. <NewLeadForm>_auto.steps.js does NOT exist  →  generate fresh    │
│        b. parseFeatureSteps()                                              │
│             • finds every Given/When/Then                                  │
│             • detects target URL from phrasing like                        │
│                 "user navigates to <PageName>"                             │
│                 "user is on the <PageName> page"                           │
│             • resolves <PageName> against pageUrls (Stage or Production)   │
│        c. domInspector.inspectPage(<resolved URL>)                         │
│             • warms up homepage, then navigates target URL                 │
│             • extracts fields + buttons + API patterns                     │
│             • caches into .cache/domMaps/<urlHash>.json                    │
│        d. detectModalTriggers() + (optional) mcpDomInspector               │
│             • when a step says "clicks on Book a test drive", the          │
│               generator opens the modal via Playwright MCP and merges      │
│               its fields into the DOM map                                  │
│        e. for every step:                                                  │
│             • try stepPatternLibrary (curated patterns first)              │
│             • else categorizeStep() → fill / select / click / navigate /   │
│               verify / wait                                                │
│             • emit Playwright body using this.* helpers from world.js      │
│        f. write a fresh features/cucumber/step_definitions/                │
│                 NewLeadForm_auto.steps.js                                  │
│                                                                            │
│  Step 4 — cucumber-js runs the new feature                                  │
│      • world.js launches Chromium, attaches network capture                │
│      • runs every scenario in NewLeadForm.feature                          │
│      • writes test-results/cucumber-report.json                            │
│                                                                            │
│  Step 5 — if any scenario fails  →  claudeFixLoop.js  (see section 3)       │
│                                                                            │
│  Step 6 — generateReport.js                                                 │
│      • renders cucumber-report.json into an HTML report, prints to PDF     │
│      • writes excel-reports/TestReport_NewLeadForm_<timestamp>.pdf         │
│                                                                            │
│  Step 7 — uploadReportToConfluence.js                                       │
│      • attaches the PDF to the Feature File page                           │
│      • updates the Report column with a Confluence attachment link         │
│      • sets the Automation Status column to Pass / Fail                    │
└────────────────────────────────────────────────────────────────────────────┘
```

### 2.3 Quick recipes

```powershell
# Standard run for a brand new feature (recommended)
npm run agent:run

# Watch the browser
$env:HEADLESS="false"; node scripts/agentOrchestrator.js

# Just generate steps, skip the test run
node scripts/generateStepDefs.js --feature NewLeadForm

# Generate for a modal-heavy page
node scripts/generateStepDefs.js --feature NewLeadForm --mcp
```

### 2.4 What happens if the page key isn't in Confluence yet?

The generator falls back to a hard-coded URL map for common Hyundai pages so the test can still run. After the run, add the page to the **Environment URLs** table on Confluence so the next run picks it up dynamically — no step-file edit needed.

---

## 3. Workflow — Tests fail and Claude auto-fixes them

The fix loop only runs when there is a real failure. It never edits files on a clean (passing) run.

There are two fix engines:

| Engine | Script | Best for |
|---|---|---|
| **Static** | `claudeFixLoop.js` (`npm run fix:loop` or `--claude-fix`) | Form-fill failures, selector drift on the initial page load |
| **Live (MCP)** | `mcpAutoFixer.js` (`npm run fix:mcp` or `--mcp-fix`) | Modals, drawers, multi-step UIs, anything that only exists after clicks |

### 3.1 What the static loop does (`claudeFixLoop.js`)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ 1. Load test-results/cucumber-report.json                                    │
│                                                                              │
│ 2. For each failed scenario, extract:                                        │
│      • featureUri, scenario name                                             │
│      • the entire step sequence (✅ passed, ❌ failed, ⏭ skipped)            │
│      • error message + stack trace for failed step(s)                        │
│      • path of the step file that owns the failing step                      │
│                                                                              │
│ 3. Pre-scan the failing feature's page URL with domInspector.inspectPage()  │
│      → produces a fresh static DOM field/button map for the prompt          │
│                                                                              │
│ 4. diagnoseError(errorText) classifies each failure:                         │
│      • "element not found"                                                  │
│      • "wrong element matched" (broad :has-text)                            │
│      • "intercepted click" (z-index overlay)                                │
│      • "navigation timeout" / "selector timeout" etc.                       │
│   Each diagnosis is appended to the prompt with a concrete fix template.    │
│                                                                              │
│ 5. buildPrompt() composes a single prompt containing:                        │
│      • the full scenario step sequence with status icons                    │
│      • the failing step text + error + pre-analysed diagnosis               │
│      • the live DOM locator map (fields, buttons, API patterns)             │
│      • the exact step file paths Claude is allowed to edit                  │
│      • instructions to use MCP (Playwright + filesystem) to verify          │
│      • coding rules: prefer id / aria-label / role+name selectors,          │
│        avoid broad :has-text(), use dispatchEvent fallback on overlays      │
│                                                                              │
│ 6. spawn `claude -p <prompt> --mcp-config .vscode/mcp.json`                  │
│      Claude:                                                                 │
│        • reads the step file (and the .feature file if useful)              │
│        • optionally drives the live browser via Playwright MCP              │
│        • edits the *_auto.steps.js file in place                            │
│      Respects // @locked (skips entirely) and // @protected (append-only).  │
│                                                                              │
│ 7. Re-run Cucumber, narrowed to ONLY the failing scenarios                   │
│      (--name "<escaped scenario title>" for each; positional feature paths) │
│   Merges the narrowed report back over the baseline so the final            │
│   cucumber-report.json keeps already-passing scenarios intact.              │
│                                                                              │
│ 8. If still failing and Claude made no changes / same errors repeat:        │
│      → next iteration uses an ESCALATED prompt that inlines the full        │
│        current contents of the step file (forces Claude to rewrite).        │
│                                                                              │
│ 9. Repeat up to MAX_ITERATIONS = 5 (override via --max-iterations N).        │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 What the MCP loop adds (`mcpAutoFixer.js`)

Same shape as the static loop, but:

- The prompt instructs Claude to **drive the live browser** via Playwright MCP tools.
- Claude can `browser_navigate` to the failing URL, replay the prior ✅ steps (click "Book a test drive", etc.), then `browser_snapshot` the DOM **at the exact moment of failure**.
- This is essential for elements that don't exist on initial page load — modal inputs, drawer buttons, dynamic dropdowns.
- Trade-off: each iteration spins up a real browser, so it is slower than the static loop.

### 3.3 Quick recipes

```powershell
# Whole pipeline with auto-fix on failure
node scripts/agentOrchestrator.js --claude-fix
node scripts/agentOrchestrator.js --mcp-fix         # live-browser flavour

# Stand-alone fix loops (don't fetch / regenerate, just fix the last run)
npm run fix:loop
npm run fix:mcp

# Narrow the fix loop to specific scenarios
npm run fix:loop:smoke                              # only @smoke tagged
npm run fix:mcp:smoke
node scripts/claudeFixLoop.js --tags "@batd"
node scripts/claudeFixLoop.js --max-iterations 3

# Single shot — fix once, don't re-run
npm run fix:mcp:once
```

### 3.4 Safety rails

- `// @locked` step files are **never** touched, even by the fix loop.
- `// @protected` step bodies are preserved; the fix loop can still add new steps.
- The fix loop never deletes existing scenarios from `cucumber-report.json`; it merges the narrowed re-run with the baseline so the final PDF / Confluence upload still reflects every scenario.
- All locator healing (both at generation time and at runtime) is logged to `.cache/healed-locators.json` for audit.

---

## 4. End-to-end cheat sheet

| Situation | First-line command |
|---|---|
| New field in existing form (feature file updated) | `node scripts/generateStepDefs.js --feature <Name> --update-steps` |
| New field is in a modal | add `--mcp` to the above |
| Brand-new `.feature` file (Run = Yes on Confluence) | `npm run agent:run` |
| Just regenerate one step file from scratch | `Remove-Item features/cucumber/step_definitions/<X>_auto.steps.js`  then  `node scripts/generateStepDefs.js --feature <X>` |
| Tests failed — let Claude fix them (static) | `npm run fix:loop` |
| Tests failed — let Claude fix them (live browser) | `npm run fix:mcp` |
| Fastest re-run, nothing else | `node scripts/agentOrchestrator.js --skip-fetch --skip-generate` |
| Headed browser for debugging | `$env:HEADLESS="false"; <any of the above>` |

---

## 5. Where things live (quick map)

| Need to look at... | File |
|---|---|
| Step-generation rules & categorisation | [scripts/generateStepDefs.js](scripts/generateStepDefs.js) |
| Curated step patterns | [scripts/stepPatternLibrary.js](scripts/stepPatternLibrary.js) |
| Live DOM scan logic | [scripts/domInspector.js](scripts/domInspector.js) |
| Modal/MCP DOM scan | [scripts/mcpDomInspector.js](scripts/mcpDomInspector.js) |
| Static fix loop (prompt + iteration) | [scripts/claudeFixLoop.js](scripts/claudeFixLoop.js) |
| Live-browser fix loop | [scripts/mcpAutoFixer.js](scripts/mcpAutoFixer.js) |
| Runtime selector healing | [utils/autoHealLocator.js](utils/autoHealLocator.js) |
| Browser launch + shared helpers | [features/cucumber/support/world.js](features/cucumber/support/world.js) |
| Page-URL map (per environment) | `.cache/activeEnvironment.json` (auto-written) |
| Healed-selector audit log | `.cache/healed-locators.json` |
