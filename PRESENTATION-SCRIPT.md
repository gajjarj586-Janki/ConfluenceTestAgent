# Presentation Script — How Claude Helped Us in Automation

*A slide-by-slide talk track. Each slide has **[ON SCREEN]** (what to show / bullets)
and **[SAY]** (what to narrate). Timing is a rough guide — full deck ≈ 12–15 min.
Cut the optional slides for a 7-minute version.*

---

## Slide 1 — Title  *(~30s)*

**[ON SCREEN]**
- **Confluence Test Agent — AI in Our Test Automation**
- Subtitle: *Tests that write themselves, and heal themselves*
- Your name / team / date

**[SAY]**
> "Today I want to walk through how we put AI — specifically Claude — into our
> automated test framework. Two outcomes I'll focus on: how it changed the *overall*
> experience of building and maintaining tests, and the part everyone asks about —
> how the tests actually *heal themselves* when the app changes underneath them."

---

## Slide 2 — The Problem  *(~1 min)*

**[ON SCREEN]**
- Writing step definitions by hand = slow
- Selectors are brittle — one DOM change → red build
- Flaky failures eat triage time
- Modals / dynamic content are painful to automate

**[SAY]**
> "Anyone who's owned a UI test suite knows the pain. You hand-code every step. You
> hunt for selectors in DevTools and pray they're stable. Then the front-end team
> renames an `id` or swaps a `<button>` for a `<div>`, and suddenly twenty tests are
> red — none of them for a *real* bug. We were spending more time keeping the suite
> alive than getting value from it."

---

## Slide 3 — The Big Idea  *(~1 min)*

**[ON SCREEN]**
- Confluence → Feature files → **AI generates steps** → Cucumber runs → Report → Confluence
- Two layers of AI:
  - **Generation** — build the tests for us
  - **Self-repair** — keep the tests passing

**[SAY]**
> "Our fix was to let AI do two jobs. First, *generation*: we write the test in plain
> English, point it at a page, and Claude plus a live DOM scan produce the actual
> Playwright code. Second, *self-repair*: when something breaks, the framework tries
> to fix itself before it ever bothers a human. Those are two separate layers and
> it's worth keeping them straight, because they solve different problems."

---

## Slide 4 — Before vs. After  *(~1.5 min)*

**[ON SCREEN]** *(build the table row by row)*

| Task | Before | With Claude |
|---|---|---|
| Writing steps | Hand-code everything | Auto-generated from the feature file |
| Finding selectors | DevTools + hope | DOM scan extracts a label→selector map |
| Selector breaks | Red build + manual edit | **Auto-heal** swaps in a working selector |
| Real break | Reproduce + debug + rewrite | **Claude fix loop** diagnoses + patches + retries |
| Modals | Manual clicking to find DOM | MCP live-browser inspection |
| Reporting | Assemble by hand | PDF auto-pushed to Confluence |

**[SAY]**
> "Here's the before-and-after. The row I want you to notice is 'selector breaks.'
> That used to be a red build and a manual edit — the single biggest source of
> maintenance toil. Now most of those never even surface as a failure. We'll see why
> in a minute."

---

## Slide 5 — Two Layers of AI  *(~1 min)*

**[ON SCREEN]**
```
Layer 1 — GENERATION
  Reads plain-English steps + scans live DOM → emits Playwright step code

Layer 2 — SELF-REPAIR
  2a. Auto-heal locator   → runtime, deterministic, instant
  2b. Claude fix loop     → on real failure: read, edit, re-run
```

**[SAY]**
> "Generation up top: plain-English in, runnable test code out. Self-repair below,
> and it has *two* sub-layers. 2a is fast and deterministic — it runs on every
> lookup. 2b is the smart, AI-driven one that only wakes up on a genuine failure.
> That split is the whole trick to keeping it fast and cheap."

---

## Slide 6 — The Day-to-Day Win  *(~1 min)*

**[ON SCREEN]**
- Onboard a feature: *add a Confluence row → set Run = Yes → `npm run agent:run`*
- Trivial DOM churn → absorbed silently, logged for review
- Hard failures → the framework debugs itself

**[SAY]**
> "What did this feel like? Onboarding a new feature went from an afternoon of writing
> steps to: add a row in Confluence, flip a flag, run one command. Day-to-day
> maintenance dropped sharply, because the small DOM changes that used to break us are
> now absorbed automatically — and the genuinely hard failures turn into a conversation
> the framework has with itself."

---

## Slide 7 — How Healing Works: Two Levels  *(~45s)*

**[ON SCREEN]**
- **Level 1 — Auto-heal locator:** fast, deterministic, every lookup
- **Level 2 — Claude fix loop:** smart, AI-driven, only on real failure

**[SAY]**
> "Now the part everyone asks about — healing. There are two levels. Think of it as a
> cheap reflex and an expensive brain. The reflex handles the common case instantly;
> the brain handles the hard case. Let's take them one at a time."

---

## Slide 8 — Level 1: Auto-Heal Locator  *(~2 min)*

**[ON SCREEN]**
- Runs on **every** element lookup, not just on failure
- Builds a **ranked list of candidate selectors** by element type
- Tries them in order → first visible match wins
- Example for `"email"`:
```
1. input[type="email"]
2. input[name*="email" i]
3. input[id*="email" i]
4. input[placeholder*="email" i]
5. input[aria-label*="email" i]
```

**[SAY]**
> "Level 1 is deterministic — no AI call at all. Every time a step asks for an element
> by a human hint like 'email' or 'Submit', the healer builds a ranked list of ways
> that element *might* be identified, and tries them top to bottom. Here's the list for
> 'email' — type, then name, then id, then placeholder, then aria-label.
>
> Selector number one is the 'primary.' If it works, nothing happens — happy path.
> But if the primary fails and, say, number three works, that's a *heal*: the test
> just keeps running as if nothing went wrong. No red build. And — this is important —
> every heal gets logged, so we have a record of which selectors are drifting and
> might want a permanent fix."

**[OPTIONAL — show the code]**
```js
const healed = i > 0;                 // anything past the primary = a heal
if (healed) saveHealedLocator({ hint, primary: selectors[0], healed: sel });
return { locator, selector: sel, healed };
```

---

## Slide 9 — Level 1: Why Buttons Are Special  *(optional, ~45s)*

**[ON SCREEN]**
- Modern AEM/React pages render "buttons" as `<div>`/`<span>` — no `role`, no `type`
- So button selectors go **specific → permissive**:
  native `<button>` → `[role=button]` → anchor → aria-label → id slug → any text match

**[SAY]**
> "One detail worth calling out: on our AEM and React pages, half the 'buttons' aren't
> buttons at all — they're divs with a click handler. So the button strategy starts
> strict, with a real `<button>`, and gradually loosens until it finds *something*
> visible with the right text — but stays inside sensible containers so it never
> matches a giant wrapper by accident."

---

## Slide 10 — Level 2: Claude Fix Loop  *(~2 min)*

**[ON SCREEN]**
```
1. Parse the failure (step text, error, stack trace, file path)
2. Grab a fresh DOM map of the failing page
3. Prompt Claude: here's what failed, here's the live DOM, here's the file
4. Claude edits the step definition
5. Re-run Cucumber — repeat up to 5x
```

**[SAY]**
> "When auto-heal can't save it — the element truly isn't found, or it's a deeper
> problem like a changed flow or a new required field — Level 2 takes over. The
> framework hands Claude everything a human debugger would want: the failed step, the
> error and stack trace, a *fresh* scan of the live DOM with real selectors, and the
> file to edit. Claude diagnoses it, edits the step, and we re-run — up to five times.
> The suite is, in effect, debugging itself."

---

## Slide 11 — Level 2: Two Flavours  *(~1 min)*

**[ON SCREEN]**
- **Static pre-scan** (`claudeFixLoop.js`) — fast; DOM scraped just before the fix
- **Live browser via MCP** (`mcpAutoFixer.js`) — Claude drives real Chromium: navigate,
  click, type, read the *actual* DOM at the moment of failure
- Live browser wins for **modals & dynamic content**

**[SAY]**
> "Two flavours. The fast one hands Claude a snapshot of the DOM. The powerful one
> gives Claude a real browser through the Playwright MCP server — it can navigate,
> click, and read the actual DOM at the exact moment of failure. That second one is
> what we use for modals and dynamic content, where a static snapshot would miss the
> hidden elements entirely."

---

## Slide 12 — Safety Rails  *(~1 min)*

**[ON SCREEN]**
- AI edits code — so there are guard rails:
  - `// @locked` → never touched
  - `// @protected` → existing steps preserved, only new ones appended
- **Auto-fix runs ONLY on a real failure — never on a green run**

**[SAY]**
> "Letting AI edit your test code rightly makes people nervous, so there are hard
> rails. Mark a file `@locked` and nothing — generator or fixer — ever touches it.
> Mark it `@protected` and your hand-tuned steps are frozen; only genuinely new steps
> get appended. And the fix loop *only* ever runs in response to a real failure —
> re-running a green suite will never silently rewrite your working code."

---

## Slide 13 — The Escalation Ladder  *(~1.5 min)*

**[ON SCREEN]**
```
Step asks for an element
   │
   ▼
[L1] Auto-heal tries ranked selectors ──► works ──► ✅ continue (heal logged)
   │ all fail
   ▼
Cucumber records a real failure
   │
   ▼
[L2] Claude reads failure + live DOM ──► edits step ──► re-run (5x) ──► ✅
   │ still failing
   ▼
Surfaced to a human — with full selector + error trace
```

**[SAY]**
> "Put it together and you get an escalation ladder. Cheap, instant healing handles
> the common case. Expensive, intelligent healing handles the hard case. And anything
> *neither* can solve is escalated to a human — but with a complete diagnostic trail,
> never silently swallowed. That last point matters: the system fails loudly and
> usefully, it doesn't hide problems."

---

## Slide 14 — Results / Impact  *(~1 min)*

**[ON SCREEN]** *(fill in with your real numbers if you have them)*
- ⬇️ Maintenance time on selector breaks
- ⬇️ Manual step-writing — features onboarded in minutes
- ⬆️ Suite stays green through routine DOM churn
- 🧾 Every heal & fix is logged and auditable

**[SAY]**
> "The bottom line: we spend far less time on selector plumbing and flake triage, we
> onboard features in minutes instead of an afternoon, and the suite stays green
> through the routine churn that used to break it — all while keeping a full audit
> trail of what the AI changed and why."

*(If you have before/after metrics — flaky-rerun counts, maintenance hours, time-to-
onboard — drop them here. Real numbers land harder than adjectives.)*

---

## Slide 15 — Close & Q&A  *(~30s)*

**[ON SCREEN]**
- **Generation + self-repair = tests that write and heal themselves**
- Code: `autoHealLocator.js`, `claudeFixLoop.js`, `mcpAutoFixer.js`
- Docs: `CLAUDE-IN-AUTOMATION.md`, `FRAMEWORK.md`
- *Questions?*

**[SAY]**
> "So that's the story — AI that both writes the tests and keeps them alive, with
> humans in the loop only for the things that genuinely need a human. Happy to go
> deeper on any layer. Questions?"

---

## Appendix — Likely Questions & Crisp Answers

**Q: Doesn't auto-heal hide real bugs by always finding *something*?**
> No — heals are logged every time, and the fallback lists are constrained (e.g.
> buttons stay inside interactive containers). If nothing matches, it fails loudly
> with the full list it tried.

**Q: How much does the AI fix loop cost / how slow is it?**
> It only runs on real failures, not green runs, and Level 1 absorbs most churn before
> it ever gets there — so the AI is invoked rarely. The live-browser flavour is slower
> (browser startup per iteration) and we reserve it for modal/dynamic cases.

**Q: What stops it from rewriting code we've carefully tuned?**
> `// @locked` (never touched) and `// @protected` (existing steps frozen, only new
> ones appended), plus the rule that auto-fix never runs on a passing suite.

**Q: What if Claude can't fix it in 5 tries?**
> It's surfaced to a human in the report with the full selector list and error trace —
> nothing is silently swallowed.

**Q: Does this lock us into one front-end?**
> No — selectors are derived semantically from hints and the live DOM, and navigation
> URLs resolve from a Confluence environment table, so the same tests run against
> Stage or Production by changing one setting.
