# How Claude Helped Us in Automation

*A practical write-up of where AI fits into the Confluence Test Agent — the overall
experience, and specifically how it heals broken tests.*

---

## TL;DR

Claude turned this framework from a "write every selector by hand and babysit every
flake" workflow into one where:

- **Test code writes itself** from plain-English `.feature` files (no manual step coding).
- **Broken locators heal themselves at runtime** — a deterministic fallback engine
  swaps in a working selector without anyone touching the code.
- **Real failures fix themselves** — when a test genuinely breaks, Claude reads the
  failure, inspects the live page, and patches the step definition, then re-runs.

The net effect: far less time spent on selector plumbing and flake triage, and far
more of the suite staying green on its own.

---

## 1. The Overall Automation Experience

### Before vs. after

| Task | Before (manual) | With Claude in the loop |
|---|---|---|
| Writing step definitions | Hand-code every Gherkin step → Playwright call | Auto-generated from the `.feature` file + a live DOM scan |
| Finding selectors | Open DevTools, copy a selector, hope it's stable | DOM inspector extracts a label→selector map automatically |
| A selector breaks (minor DOM change) | Test fails red, someone edits the file | **Auto-heal** silently tries ranked fallbacks at runtime |
| A test genuinely breaks | Manually reproduce, debug, rewrite the step | **Claude fix loop** diagnoses + patches + re-runs (up to 5x) |
| Modal / dynamic content | Manually click around to find the hidden DOM | MCP-driven live browser inspection captures it for you |
| Reporting | Assemble results by hand | PDF generated and pushed back to Confluence automatically |

### Where Claude actually plugs in

There are **two distinct layers** of AI assistance, and it's worth keeping them
separate because they solve different problems:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 1 — GENERATION (build the tests for us)                        │
│  generateStepDefs.js + domInspector.js + mcpDomInspector.js           │
│  → Reads plain-English .feature steps, scans the live DOM, and emits  │
│    ready-to-run Playwright step definitions. No hand-coding.          │
├─────────────────────────────────────────────────────────────────────┤
│  Layer 2 — SELF-REPAIR (keep the tests passing)                       │
│  2a. autoHealLocator.js   → runtime, deterministic, instant           │
│  2b. claudeFixLoop.js /   → on real failure, AI reads + edits + retry │
│      mcpAutoFixer.js                                                   │
└─────────────────────────────────────────────────────────────────────┘
```

The big win in day-to-day use is that **most DOM churn never even surfaces as a
failure** — Layer 2a absorbs it. Only when a test breaks for a real reason does
Layer 2b (the AI fix loop) wake up. That keeps AI cost and run time down while still
giving us a safety net for the genuinely hard breaks.

### What this felt like in practice

- **Onboarding a new feature** went from "spend an afternoon writing steps" to
  "add a row in Confluence, set Run = Yes, run `npm run agent:run`."
- **Suite maintenance** dropped sharply. Trivial DOM changes (a renamed `id`, a
  reordered attribute, a "button" that's now a `<div>`) used to mean a red build and
  a manual edit. Now they're absorbed by auto-heal and logged for review instead of
  blocking the run.
- **Debugging hard failures** became a conversation the framework has with itself —
  Claude gets the failed step, the error, the stack trace, and a fresh DOM map, then
  proposes and applies a fix.

---

## 2. How the Healing Works

"Healing" in this framework happens at **two levels**. They're complementary: the
first is fast and deterministic, the second is smart and AI-driven.

### Level 1 — Auto-Heal Locator (runtime, deterministic)

**File:** [utils/autoHealLocator.js](utils/autoHealLocator.js)

This is the first line of defence and it runs on **every** element lookup, not just
on failure. When a step asks for an element by a human hint (e.g. `"email"`,
`"Submit"`, `"first name"`), the healer builds a **ranked list of candidate
selectors** and tries them in order until one resolves to a visible element.

#### How it decides what to try

It picks a strategy by element type:

- `buildFieldSelectors(hint)` — inputs / textareas
- `buildButtonSelectors(label)` — buttons, links, and React/AEM "fake buttons"
- `buildSelectSelectors(hint)` — dropdowns
- `buildCheckboxSelectors(hint)` — checkboxes

For well-known fields there are curated shortcut lists. For example, a hint of
`"email"` expands to:

```
1. input[type="email"]
2. input[name*="email" i]
3. input[id*="email" i]
4. input[placeholder*="email" i]
5. input[aria-label*="email" i]
```

Buttons are deliberately ordered from **most-specific to most-permissive**, because
modern AEM/React pages often render "buttons" as `<div>`/`<span>` with click
handlers and no `role` or `type`. So a label like `"Book a test drive"` is tried as
a native `<button>` first, then `[role=button]`, then an anchor, then aria-label,
then `data-testid`/`id` slugs, and finally any visible element whose text matches —
restricted to common interactive containers so it doesn't match a giant ancestor.

#### The heal itself

```js
for (let i = 0; i < selectors.length; i++) {
  const locator = page.locator(selectors[i]).first();
  await locator.waitFor({ state: 'visible', timeout: 3000 });
  if (await locator.count() === 0) continue;

  const healed = i > 0;          // anything past the primary selector = a heal
  if (healed) {
    console.log(`🔧 Auto-heal: "${hint}" — selector #${i + 1} worked: ${sel}`);
    saveHealedLocator({ hint, primary: selectors[0], healed: sel, stepContext });
  }
  return { locator, selector: sel, healed };
}
```

Key behaviours:

- **Selector #1 is the "primary."** If it works, nothing is logged — that's the
  happy path.
- **Any selector past #1 that works is a heal.** The test keeps running as if
  nothing happened — no red build, no human intervention.
- **Every heal is logged** to `.cache/healed-locators.json` with the hint, the
  primary that failed, the fallback that worked, the step it happened in, and a
  timestamp. Duplicate hint+primary entries are de-duplicated, so the log is a clean
  record of "selectors that are drifting and may want a permanent fix."
- **If the whole ranked list fails**, it throws a detailed error listing every
  selector it tried and the last underlying error — which is exactly the context the
  Level-2 AI fix loop then consumes.

> **Why this matters:** most "flaky selector" failures aren't real bugs — they're
> brittle selectors meeting a slightly-changed DOM. Level 1 makes those disappear
> instantly and deterministically (no AI call, no latency), while still leaving a
> breadcrumb trail so the originals can be hardened later.

### Level 2 — Claude Fix Loop (on real failure, AI-driven)

When a selector genuinely can't be found by any fallback — or a step fails for a
reason auto-heal can't paper over (wrong assertion, changed flow, new required
field, broken navigation) — the AI fix loop takes over.

**Files:** [scripts/claudeFixLoop.js](scripts/claudeFixLoop.js) (static DOM pre-scan)
and [scripts/mcpAutoFixer.js](scripts/mcpAutoFixer.js) (live browser via MCP).

#### The loop

```
1. Parse cucumber-report.json for failed scenarios
2. Extract: failed step text, error message, stack trace, feature file path
3. Pre-scan the failing page's DOM (claudeFixLoop)  OR
   give Claude live browser control via Playwright MCP (mcpAutoFixer)
4. Build a prompt:
     - the full step sequence (what passed, what failed)
     - the error + stack trace
     - a fresh DOM field map (real, ready-to-use selectors from the live page)
     - the path to the step file to edit
5. Claude reads the file, diagnoses the failure, and edits the step definition
6. Re-run Cucumber
7. Repeat up to MAX_ITERATIONS = 5
```

#### Two flavours

- **`claudeFixLoop.js` — static pre-scan.** Fast. Claude is handed a DOM map that was
  scraped just before the fix. Good for ordinary form/page failures.
- **`mcpAutoFixer.js` — live browser.** Claude drives a real Chromium through the
  Playwright MCP server: it can navigate, click, type, and read the *actual* DOM at
  the moment of failure. Slower (browser startup per iteration) but far more accurate
  for **modals and dynamic content**, where a static snapshot wouldn't capture the
  hidden elements.

#### Safety rails on self-editing

The fix loop is allowed to edit code, so there are guard rails so it can never run
away with hand-tuned files:

- `// @locked` on line 1 → Claude/​generator never touches the file at all.
- `// @protected` on line 1 → existing step bodies are preserved; only genuinely new
  steps may be appended.
- **Auto-fix only ever runs in response to a real test failure** — never on a clean
  green run. So fetching new data or re-running the suite will never silently rewrite
  your working steps.

---

## 3. Putting Both Levels Together

A single failing element walks through this escalation ladder:

```
Step asks for element "Book a test drive"
        │
        ▼
[L1] autoHeal tries ranked selectors  ──► one works ──►  ✅ test continues
        │                                                 (heal logged, no red build)
        │ all fallbacks fail
        ▼
   Cucumber records a real failure
        │
        ▼
[L2] Claude fix loop reads failure + live DOM
        │
        ├─► proposes & applies a step-file edit
        ▼
   Re-run (up to 5x)  ──► passes ──►  ✅
        │
        │ still failing after 5
        ▼
   Surfaced in the report for a human  (with full selector + error trace)
```

Cheap, deterministic healing handles the common case; expensive, intelligent healing
handles the hard case; and anything neither can solve is escalated to a human with a
complete diagnostic trail — never silently swallowed.

---

## 4. Where to Look in the Code

| Capability | File |
|---|---|
| Runtime selector healing | [utils/autoHealLocator.js](utils/autoHealLocator.js) |
| World helpers that call the healer (`findElement`, `fillField`, `clickButton`, …) | [features/cucumber/support/world.js](features/cucumber/support/world.js) |
| Step generation from `.feature` files | [scripts/generateStepDefs.js](scripts/generateStepDefs.js) |
| Static DOM inspection | [scripts/domInspector.js](scripts/domInspector.js) |
| MCP modal / dynamic DOM inspection | [scripts/mcpDomInspector.js](scripts/mcpDomInspector.js) |
| AI fix loop (static pre-scan) | [scripts/claudeFixLoop.js](scripts/claudeFixLoop.js) |
| AI fix loop (live browser) | [scripts/mcpAutoFixer.js](scripts/mcpAutoFixer.js) |
| Heal log (review what's drifting) | `.cache/healed-locators.json` |

See [FRAMEWORK.md](FRAMEWORK.md) for the full pipeline, npm scripts, and run-command
reference.
