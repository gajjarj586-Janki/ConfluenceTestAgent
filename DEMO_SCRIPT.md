# Confluence Test Agent — Demo Script

> A speaker-friendly walkthrough of the framework: what it does, how the pieces fit, and what to say at each stage of the demo.

---

## 1. Opening (30 seconds)

**Say this:**

> "This is the **Confluence Test Agent** — an AI-driven test automation framework that turns Confluence into the single source of truth for our test suite. The business team owns the feature files and test data on Confluence. The agent fetches them, auto-generates Playwright step definitions, runs the tests, and uploads the PDF report straight back to Confluence. No code changes required to add or run a new test."

**One-line pitch:**
> *"Confluence in → tested in → Confluence report out."*

```
Confluence  ──►  Feature Files  ──►  Step Generation  ──►  Cucumber Tests  ──►  PDF Report  ──►  Confluence
   (data)         (downloaded)        (AI + DOM scan)        (Playwright)                          (uploaded)
```

---

## 2. The Big Picture — 7 Stages of the Pipeline

Run this single command to trigger the full flow:

```powershell
npm run agent:run
```

**Say this:**

> "Behind that one command, seven stages run in sequence. Let me walk through each."

| # | Stage | Script | What happens |
|---|---|---|---|
| 1 | **Read Confluence** | `confluenceReader.js` | Pulls environment config + all test data tables |
| 2 | **Fetch features** | `fetchFeatures.js` | Downloads `.feature` files where Run = Yes |
| 3 | **Generate steps** | `generateStepDefs.js` | Inspects the live DOM and writes Playwright step code |
| 4 | **Run Cucumber** | `cucumber.js` + `world.js` | Executes scenarios against Chromium |
| 5 | **Auto-fix on failure** | `claudeFixLoop.js` / `mcpAutoFixer.js` | Claude diagnoses + edits step files, re-runs |
| 6 | **Render PDF** | `generateReport.js` | Builds an HTML report, prints to PDF |
| 7 | **Upload to Confluence** | `uploadReportToConfluence.js` | Attaches PDF, updates Report + Status columns |

---

## 3. Stage-by-Stage Demo Script

### Stage 1 — Confluence is the Source of Truth

**Show:** The Confluence Test Data page and the Feature Selection page.

**Say this:**

> "We have two Confluence pages doing the work.
> - The **Test Data page** holds every form input — names, emails, locations, dealer codes — organised as tables per feature.
> - The **Feature File page** holds the actual `.feature` files as attachments, plus a control table with three columns: **Run**, **Report**, and **Automation Status**.
>
> The business sets Run = Yes on whatever they want tested today. That's the only switch they need to touch."

**Key file:** [utils/confluenceReader.js](utils/confluenceReader.js)

---

### Stage 2 — Fetching the Feature Files

**Say this:**

> "When the agent starts, it hits the Confluence REST API, parses the Feature Selection table with Cheerio, and downloads every feature where Run = Yes. It also auto-repairs common authoring mistakes — like a missing `Scenario:` keyword after a tag — so the business doesn't have to know Gherkin syntax perfectly."

**Result:** Files land in [features/cucumber/](features/cucumber/) and a manifest is written to `.cache/selectedFeatures.json`.

**Key file:** [scripts/fetchFeatures.js](scripts/fetchFeatures.js)

---

### Stage 3 — AI Step Generation (the magic part)

**Say this:**

> "This is where the AI does the heavy lifting. For each new feature file the agent:
> 1. Parses every Gherkin step.
> 2. Extracts the target page from natural-language phrasing — `'navigates to Contact Us'` becomes the `contact us` key, which is resolved against the **Environment URLs** table on Confluence for whichever environment we're pointing at — Stage or Production.
> 3. Launches headless Chromium and **inspects the live DOM** — it builds a map of every input, label, button, and error container on the page.
> 4. For modal-heavy pages, an MCP-powered inspector clicks the trigger, captures the modal DOM dynamically, and feeds that into the generator.
> 5. It then writes a Playwright + Cucumber step definition file — `<Feature>_auto.steps.js` — using a curated pattern library plus the DOM map for selectors.
>
> Critically, **the generator never overwrites an existing step file**. Once a step file exists, it's treated as user-owned. That guarantees hand-tuned code is safe."

**Guards to mention:**
- `// @locked` on line 1 → never touched
- `// @protected` on line 1 → existing steps preserved, new ones appended

**Key files:**
- [scripts/generateStepDefs.js](scripts/generateStepDefs.js)
- [scripts/domInspector.js](scripts/domInspector.js)
- [scripts/mcpDomInspector.js](scripts/mcpDomInspector.js)
- [scripts/stepPatternLibrary.js](scripts/stepPatternLibrary.js)

---

### Stage 4 — Running the Tests

**Say this:**

> "Cucumber loads `world.js`, which boots Chromium with a realistic user-agent, sets geolocation to Sydney, and disables webdriver detection flags so we look like a real user. Every step has access to shared helpers via `this.` — `fillField`, `selectDropdown`, `clickButton`, `findElement` — all wired up to an **auto-healing locator engine**.
>
> If a selector breaks, the healer doesn't fail immediately. It walks through 10+ fallback strategies — ID, name, placeholder, aria-label, adjacent label, partial class match — and logs whichever one worked to `.cache/healed-locators.json`. So the suite is resilient to small DOM changes without any intervention."

**Key files:**
- [features/cucumber/support/world.js](features/cucumber/support/world.js)
- [utils/autoHealLocator.js](utils/autoHealLocator.js)

---

### Stage 5 — Self-Healing with Claude

**Say this:**

> "If a test still fails, the agent doesn't just give up. It triggers an auto-fix loop:
> 1. Parses the Cucumber JSON to extract failed step, error message, and stack trace.
> 2. Re-inspects the DOM at the failure point.
> 3. Hands all of that — plus the path to the step file — to Claude Code as a prompt.
> 4. Claude reads the file, diagnoses the issue, edits the step, and the agent re-runs.
> 5. Up to 5 iterations.
>
> We have two flavours:
> - **`claudeFixLoop.js`** — fast, uses a static DOM snapshot.
> - **`mcpAutoFixer.js`** — slower but smarter, gives Claude live browser control via Playwright MCP so it can actually click around the page while diagnosing."

**Key files:**
- [scripts/claudeFixLoop.js](scripts/claudeFixLoop.js)
- [scripts/mcpAutoFixer.js](scripts/mcpAutoFixer.js)

---

### Stage 6 — PDF Report Generation

**Say this:**

> "Once tests finish, `generateReport.js` reads the Cucumber JSON and renders an HTML report — summary cards for pass/fail/pending, per-scenario step breakdowns with status badges, embedded screenshots, and captured API payloads. Then it opens headless Chromium, loads the HTML, and prints it to PDF. The output lands in `excel-reports/` with a timestamped filename."

**Show:** Any file in [excel-reports/](excel-reports/) to demonstrate the format.

**Key file:** [scripts/generateReport.js](scripts/generateReport.js)

---

### Stage 7 — Closing the Loop Back to Confluence

**Say this:**

> "The final stage uploads the PDF back to the Confluence Feature File page as an attachment, then updates two columns in the Feature Selection table:
> - **Report** — gets an embedded link to the PDF.
> - **Automation Status** — set to Pass or Fail based on the Cucumber result.
>
> So the business team sees the result in the same place they kicked the test off. No emails, no Slack, no chasing logs."

**Key file:** [scripts/uploadReportToConfluence.js](scripts/uploadReportToConfluence.js)

---

## 4. Live Demo Commands

**Pick one of these to actually run during the demo:**

```powershell
# Full pipeline, headed so the audience can watch the browser:
$env:HEADLESS="false"; node scripts/agentOrchestrator.js

# Fastest re-run (reuses cached features + step files):
node scripts/agentOrchestrator.js --skip-fetch --skip-generate

# Show the auto-fix loop in action (intentionally break a selector first):
npm run agent:claude-fix
```

**While it runs, narrate:**
1. "Notice the browser launching with real user-agent and Sydney geolocation."
2. "Watch the form fill — every value comes straight from the Confluence test data table."
3. "Network requests are being captured in the background for the report."
4. "After the run, the PDF will appear in `excel-reports/` and within seconds the Confluence page will update."

---

## 5. Key Differentiators — What Makes This Framework Special

**Drop these into the Q&A:**

| Feature | Why it matters |
|---|---|
| **Confluence-driven** | Business owns the test data and feature toggles — zero git access needed |
| **AI step generation** | New feature files don't need a developer to write Playwright code |
| **Auto-healing locators** | Small DOM changes don't break the suite |
| **Self-fixing with Claude** | Real failures get diagnosed and patched automatically |
| **MCP integration** | Claude controls a real browser during fix loops — handles modals and dynamic content |
| **Environment-agnostic** | One `TARGET_ENVIRONMENT` flag switches between Stage and Production URLs |
| **Step file safety** | Hand-tuned code is never overwritten — `// @locked` and `// @protected` guards |
| **End-to-end traceability** | Test data → execution → PDF report all linked in one Confluence page |

---

## 6. Architecture Diagram for the Slide

```
                    ┌────────────────────────────────────┐
                    │         CONFLUENCE PAGES           │
                    │  • Test Data tables                │
                    │  • Feature Selection table         │
                    │  • Environment URLs                │
                    └────────────────┬───────────────────┘
                                     │
                       ┌─────────────▼─────────────┐
                       │   agentOrchestrator.js    │
                       └─────────────┬─────────────┘
                                     │
        ┌────────────┬───────────────┼───────────────┬────────────┐
        ▼            ▼               ▼               ▼            ▼
  fetchFeatures  generateStepDefs   cucumber-js   claudeFixLoop  generateReport
        │            │                  │              │              │
        │      ┌─────▼─────┐            │              │              │
        │      │domInspector│           │              │              │
        │      │  (+ MCP)   │           │              │              │
        │      └───────────┘            │              │              │
        │                          ┌────▼────┐         │              │
        │                          │ world.js │        │              │
        │                          │ + auto-  │        │              │
        │                          │  heal    │        │              │
        │                          └─────────┘         │              │
        │                                              ▼              ▼
        │                                       Claude Code      PDF in
        │                                       (via MCP)      excel-reports/
        │                                                            │
        └──────────────────────────────────────────────────────────► uploadReportToConfluence.js
                                                                     │
                                                                     ▼
                                                              CONFLUENCE PAGES
                                                          (Report + Status updated)
```

---

## 7. 60-Second Elevator Version

> "We built an agent that treats Confluence as a test management platform. Business teams maintain feature files and test data there. The agent fetches them, uses AI to inspect the live page DOM and generate Playwright step definitions automatically, runs the tests through Cucumber, and if anything fails, Claude reads the failure context and patches the step file. The final PDF report uploads straight back to Confluence with a pass/fail status. The whole loop — from updating a test data row to seeing a green tick on the Confluence page — runs with a single npm command."

---

## 8. Demo Checklist

Before the demo, verify:

- [ ] `.env` has a valid `CONFLUENCE_API_TOKEN`
- [ ] `TARGET_ENVIRONMENT` is set to **Stage** (safer than Production for live demo)
- [ ] At least one feature has **Run = Yes** on Confluence
- [ ] `.cache/` exists and is writeable
- [ ] `npm install` has been run recently
- [ ] Playwright browsers installed: `npx playwright install chromium`
- [ ] If demoing fix loop: Claude CLI is logged in (`claude` command available)

**Quick smoke test:**
```powershell
node scripts/agentOrchestrator.js --skip-fetch --skip-generate --tags "@smoke"
```

---

## 9. Likely Audience Questions

**Q: What if the page DOM changes overnight?**
A: The auto-healing locator engine handles small changes silently. Bigger changes trigger the Claude fix loop, which re-inspects the DOM and patches the affected steps.

**Q: Can non-developers add tests?**
A: Yes. They write a Gherkin `.feature` file, attach it to the Confluence Feature File page, add a row to the selection table with Run = Yes. The agent does the rest.

**Q: How do you stop the AI from breaking working code?**
A: Two guards — `// @locked` (never touched) and `// @protected` (steps preserved, only new ones appended). Plus the default behaviour skips any feature with an existing step file unless `--update-steps` is passed.

**Q: Stage vs Production?**
A: One env var — `TARGET_ENVIRONMENT=Stage` or `Production`. URLs come from the Environment URLs table on Confluence so no code change is needed.

**Q: How fast is it?**
A: New feature with DOM generation: minutes. Re-run on existing steps: as fast as the test itself plus a few seconds for upload.

**Q: What happens if Confluence is down?**
A: The `.cache/` directory holds the last successful fetch — pass `--skip-fetch` and the agent runs from cache.

---

*See also: [FRAMEWORK.md](FRAMEWORK.md) for the full technical reference, [AGENT_PIPELINE.md](AGENT_PIPELINE.md) for the orchestrator internals, and [WORKFLOWS.md](WORKFLOWS.md) for common task recipes.*
