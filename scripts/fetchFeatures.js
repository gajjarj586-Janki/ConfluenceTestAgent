/**
 * Feature File Fetcher
 *
 * Reads the Feature Selection table from the Confluence feature file page.
 * Only features with Run = "Yes" (or checked ✅) are downloaded.
 * The selected feature paths are written to .cache/selectedFeatures.json
 * so cucumber.js can pick them up dynamically.
 *
 * Confluence page should have a table with columns:
 *   | Feature File           | Run  |
 *   | contact_us__1_.feature | Yes  |
 *   | homepage.feature       | No   |
 *
 * Run: node scripts/fetchFeatures.js
 */
import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';
import config from '../utils/confluenceConfig.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, '..', 'features', 'cucumber');
const CACHE_DIR = path.join(__dirname, '..', '.cache');
// Local source-of-truth folder for .feature files. When Confluence attachment
// downloads are blocked (e.g. scoped API tokens cannot use the legacy
// /download/attachments/ endpoint), the script falls back to copies kept here.
const LOCAL_SOURCE_DIR = path.join(__dirname, '..', 'features', 'source');

function authHeader() {
  // Allow overriding credentials for fetch only (e.g. when the feature file
  // page lives in another user's personal space and the default token lacks
  // download permission). Falls back to the default Confluence credentials.
  const email = process.env.CONFLUENCE_FETCH_EMAIL || config.email;
  const apiToken = process.env.CONFLUENCE_FETCH_TOKEN || config.apiToken;
  const pair = `${email}:${apiToken}`;
  return 'Basic ' + Buffer.from(pair).toString('base64');
}

// ─── Read Feature Selection Table from Confluence Page Body ──

// Cached parsed page body so we can reuse it for inline-code-block fallback
let _pageBody$ = null;

async function fetchFeatureSelection() {
  const url = `${config.baseUrl}/rest/api/content/${config.featureFilePageId}?expand=body.storage`;
  const res = await fetch(url, {
    headers: { Authorization: authHeader(), Accept: 'application/json' },
  });
  if (!res.ok) {
    console.log(`⚠️  Could not read page body (${res.status}) — will download all features`);
    return null;
  }
  const json = await res.json();
  const html = json.body.storage.value;
  const $ = cheerio.load(html, { xmlMode: true, decodeEntities: false });
  _pageBody$ = $;

  // Look for ALL tables that have a "Run" column header — the page may
  // contain multiple sections (e.g. "Feature Selection" + "HIGH TRAFFIC
  // PAGES"). We merge the selected rows from every qualifying table so a
  // Yes anywhere on the page gets picked up.
  const tables = $('table');
  const merged = { run: [], skip: [] };
  let foundAny = false;
  for (let t = 0; t < tables.length; t++) {
    const table = $(tables[t]);
    const headerCells = table.find('tbody > tr:first-child th, tbody > tr:first-child td, thead > tr:first-child th');
    const headers = [];
    headerCells.each((_, cell) => {
      if ($(cell).hasClass('numberingColumn')) return; // skip numbering column
      headers.push($(cell).text().trim().toLowerCase());
    });

    // Find the "run" column and "feature" column
    const runIdx = headers.findIndex(h => h === 'run' || h === 'execute' || h === 'select');
    const featureIdx = headers.findIndex(h =>
      h.includes('feature') || h.includes('file')
    );
    // Also find an "In page forms" / name column as fallback identifier
    const nameIdx = headers.findIndex(h =>
      h.includes('form') || h.includes('page') || h.includes('name')
    );

    if (runIdx === -1) continue;
    foundAny = true;

    console.log(`📋 Found Feature Selection table (columns: ${headers.join(', ')})\n`);

    // Parse data rows
    const selection = { run: [], skip: [] };
    const dataRows = table.find('tbody > tr').slice(1);
    dataRows.each((_, tr) => {
      const cells = [];
      $(tr).find('td, th').each((__, cell) => {
        if ($(cell).hasClass('numberingColumn')) return;
        cells.push(cell);
      });

      // Get feature filename: prefer ri:filename from attachment macro, else text
      let featureName = '';
      if (featureIdx !== -1 && cells[featureIdx]) {
        const attachment = $(cells[featureIdx]).find('ri\\:attachment, attachment');
        if (attachment.length > 0) {
          featureName = attachment.attr('ri:filename') || '';
        }
        if (!featureName) {
          featureName = $(cells[featureIdx]).text().trim();
        }
      }
      // Fallback: use the display name column
      const displayName = nameIdx !== -1 && cells[nameIdx] ? $(cells[nameIdx]).text().trim() : '';

      // Stronger fallback — if the Feature file cell is empty, search EVERY
      // cell in the row for any <ri:attachment ri:filename="*.feature"> macro.
      // This handles the common authoring mistake where the .feature is
      // attached to the wrong cell (e.g. the In page forms column).
      if (!featureName) {
        for (const c of cells) {
          const a = $(c).find('ri\\:attachment, attachment');
          if (a.length) {
            const fname = a.attr('ri:filename') || '';
            if (fname.toLowerCase().endsWith('.feature')) {
              featureName = fname;
              break;
            }
          }
        }
      }

      // Last resort — derive a .feature filename from the display name column
      // (e.g. "PIM" → "PIM.feature"). Downstream lookup will then try the
      // local features/source/ folder and global Confluence search.
      if (!featureName && displayName) {
        const slug = displayName.replace(/\s+/g, '');
        if (slug) featureName = slug.endsWith('.feature') ? slug : `${slug}.feature`;
      }

      const runValue = cells[runIdx] ? $(cells[runIdx]).text().trim().toLowerCase() : '';

      // Skip rows with no feature attachment
      if (!featureName) return;

      // Check for Yes / ✅ / ✓ / true / checked / x
      const isSelected = ['yes', 'true', '✅', '✓', 'x', '☑'].includes(runValue);
      if (isSelected) {
        selection.run.push(featureName);
        console.log(`   ✅ Run: ${featureName}${displayName && displayName !== featureName ? `  (from "${displayName}")` : ''}`);
      } else {
        selection.skip.push(featureName);
      }
    });

    // Merge this table's results into the global selection
    for (const f of selection.run) if (!merged.run.includes(f)) merged.run.push(f);
    for (const f of selection.skip) if (!merged.skip.includes(f) && !merged.run.includes(f)) merged.skip.push(f);
  }

  if (foundAny) return merged;

  console.log('⚠️  No Feature Selection table found on page — will download all features');
  return null;
}

// ─── Extract feature content from an inline code-block on the page ───

/**
 * Scoped Confluence API tokens cannot download attachments via the legacy
 * /download/attachments/ endpoint. As a workaround users can paste the
 * feature file content into a Confluence Code Block macro on the feature
 * file page and set the macro's Title to the .feature filename.
 *
 * This function scans the cached page body for a `<ac:structured-macro
 * ac:name="code">` whose `title` parameter (case-insensitive, with or
 * without the .feature extension) matches `filename`, and returns the
 * plain-text body. Returns null if no match.
 */
function extractInlineFeature(filename) {
  if (!_pageBody$) return null;
  const $ = _pageBody$;
  const want = filename.toLowerCase();
  const wantBase = want.replace(/\.feature$/, '');

  let match = null;
  $('ac\\:structured-macro, structured-macro').each((_, el) => {
    if (match) return;
    const $el = $(el);
    const name = ($el.attr('ac:name') || $el.attr('name') || '').toLowerCase();
    if (name !== 'code') return;
    let title = '';
    $el.find('ac\\:parameter, parameter').each((__, p) => {
      const pname = ($(p).attr('ac:name') || $(p).attr('name') || '').toLowerCase();
      if (pname === 'title') title = $(p).text().trim();
    });
    if (!title) return;
    const t = title.toLowerCase();
    if (t === want || t === wantBase || t === wantBase + '.feature') {
      const body = $el.find('ac\\:plain-text-body, plain-text-body').first();
      if (body.length) {
        // The body is wrapped in CDATA in storage format
        match = body.text();
      }
    }
  });
  return match;
}

// ─── Local source-of-truth fallback ──────────────────────────

/**
 * Look up a feature file in the local `features/source/` directory.
 * Matches by exact filename, case-insensitive, with/without the .feature
 * extension and with non-alphanum chars normalized to underscore (same rules
 * the rest of the script uses for attachment titles).
 * Returns the file contents as a string, or null if not found.
 */
function findLocalFeature(filename) {
  if (!fs.existsSync(LOCAL_SOURCE_DIR)) return null;
  const want = filename.toLowerCase();
  const wantNorm = want.replace(/[^a-z0-9_\-\.]/g, '_');
  const files = fs.readdirSync(LOCAL_SOURCE_DIR);
  for (const f of files) {
    const l = f.toLowerCase();
    if (l === want || l === wantNorm ||
        l === want + '.feature' || l === wantNorm + '.feature' ||
        l.replace(/[^a-z0-9_\-\.]/g, '_') === wantNorm) {
      try {
        return fs.readFileSync(path.join(LOCAL_SOURCE_DIR, f), 'utf-8');
      } catch {
        return null;
      }
    }
  }
  return null;
}

// ─── Find an attachment anywhere in Confluence by filename (CQL) ─

/**
 * Search Confluence for an attachment with the given title (filename) anywhere
 * in the instance the API token can see. Returns the first match (full content
 * object including `_links.download` and container) or null if none found.
 *
 * Used as a fallback when a feature file referenced in the selection table is
 * not directly attached to the configured Feature File page (e.g. the user
 * uploaded it to a different / sub-page).
 */
async function findAttachmentAnywhere(filename) {
  // Try the exact title first, then a normalized variant (Confluence often
  // converts spaces to '+' but the API search uses the original title).
  const candidates = [filename];
  if (filename.endsWith('.feature')) {
    const base = filename.replace(/\.feature$/i, '');
    if (!candidates.includes(base)) candidates.push(base);
  }

  for (const title of candidates) {
    const cql = `type=attachment AND title="${title.replace(/"/g, '\\"')}"`;
    const searchUrl = `${config.baseUrl}/rest/api/content/search?cql=${encodeURIComponent(cql)}&limit=10&expand=container,version,_links`;
    let res;
    try {
      res = await fetch(searchUrl, {
        headers: { Authorization: authHeader(), Accept: 'application/json' },
      });
    } catch {
      continue;
    }
    if (!res.ok) continue;
    const json = await res.json();
    const hit = (json.results || []).find(r => r.title === filename) || json.results?.[0];
    if (hit) return hit;
  }
  return null;
}

// ─── Download Feature Files ──────────────────────────────────

async function fetchFeatureFiles() {
  console.log('\n🔄 Fetching feature files from Confluence...\n');

  // 1. Read the selection table to know which features to run
  const selection = await fetchFeatureSelection();

  // 2. List ALL attachments on the feature file page (paginate to get past PDF reports)
  const attachments = [];
  let start = 0;
  const pageSize = 50;
  while (true) {
    const listUrl = `${config.baseUrl}/rest/api/content/${config.featureFilePageId}/child/attachment?limit=${pageSize}&start=${start}`;
    const listRes = await fetch(listUrl, {
      headers: { Authorization: authHeader(), Accept: 'application/json' },
    });
    if (!listRes.ok) {
      throw new Error(`Failed to list attachments: ${listRes.status} ${listRes.statusText}`);
    }
    const listJson = await listRes.json();
    const page = listJson.results || [];
    attachments.push(...page);
    if (page.length < pageSize) break; // last page
    start += pageSize;
  }

  // Filter only .feature files
  const featureFiles = attachments.filter(a => a.title.endsWith('.feature'));

  if (featureFiles.length === 0) {
    console.log('⚠️  No .feature attachments found on the Confluence page.');
    return [];
  }

  // 3. Filter by selection table (if present)
  let toDownload = featureFiles;
  if (selection) {
    if (selection.run.length === 0) {
      console.log('⚠️  Feature Selection table found but no features are marked "Yes" to run.');
      console.log('   Go to Confluence and change the "Run" column to "Yes" for features you want to execute.\n');
      console.log('   Available features:');
      selection.skip.forEach(f => console.log(`     ☐ ${f}`));
      console.log('');

      // Write empty selection so cucumber knows nothing is selected
      if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(path.join(CACHE_DIR, 'selectedFeatures.json'), JSON.stringify([]));
      return [];
    }

    toDownload = featureFiles.filter(att => {
      const name = att.title.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
      return selection.run.some(sel => {
        const selNorm = sel.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
        return name === selNorm
          || name === selNorm + '.feature'
          || att.title === sel
          || att.title.replace('.feature', '') === sel.replace('.feature', '');
      });
    });

    // For any selected feature NOT found on the parent page, search Confluence
    // globally so users can upload feature files to any page they like.
    const foundTitles = new Set(toDownload.map(a => a.title.toLowerCase()));
    for (const sel of selection.run) {
      const selWithExt = sel.endsWith('.feature') ? sel : `${sel}.feature`;
      const alreadyFound = [...foundTitles].some(t =>
        t === selWithExt.toLowerCase() ||
        t.replace(/[^a-z0-9_\-\.]/gi, '_') === selWithExt.toLowerCase().replace(/[^a-z0-9_\-\.]/gi, '_')
      );
      if (alreadyFound) continue;

      console.log(`  🔎 "${selWithExt}" not on Feature File page — searching Confluence…`);
      const hit = await findAttachmentAnywhere(selWithExt);
      if (hit) {
        const container = hit.container || {};
        console.log(`     ↳ found on page "${container.title || container.id || '(unknown)'}" (id ${container.id || '?'})`);
        toDownload.push(hit);
        foundTitles.add(hit.title.toLowerCase());
      } else {
        // Last resort: inline code-block on the feature file page
        const inline = extractInlineFeature(selWithExt);
        if (inline) {
          console.log(`     ↳ using inline code-block from feature file page (no attachment needed)`);
          toDownload.push({ __inline: true, title: selWithExt, __content: inline });
          foundTitles.add(selWithExt.toLowerCase());
        } else {
          // Local source folder fallback
          const local = findLocalFeature(selWithExt);
          if (local) {
            console.log(`     ↳ using local copy from features/source/`);
            toDownload.push({ __inline: true, title: selWithExt, __content: local });
            foundTitles.add(selWithExt.toLowerCase());
          } else {
            console.log(`     ↳ not found anywhere — add it to features/source/${selWithExt} or attach to the Confluence page.`);
          }
        }
      }
    }

    console.log(`✅ Selected ${toDownload.length} of ${featureFiles.length} feature(s) to run:\n`);
    selection.run.forEach(f => console.log(`  ☑ ${f}`));
    if (selection.skip.length > 0) {
      console.log('');
      selection.skip.forEach(f => console.log(`  ☐ ${f} (skipped)`));
    }
    console.log('');
  } else {
    console.log(`📋 No selection table — downloading all ${featureFiles.length} feature file(s):\n`);
  }

  // 4. Ensure output directory exists, clear old features
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  // Remove old .feature files so only selected ones remain
  const oldFiles = fs.readdirSync(OUTPUT_DIR).filter(f => f.endsWith('.feature'));
  for (const old of oldFiles) {
    fs.unlinkSync(path.join(OUTPUT_DIR, old));
  }

  // 5. Download selected attachments
  const downloaded = [];
  for (const att of toDownload) {
    const safeName = att.title.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
    const outPath = path.join(OUTPUT_DIR, safeName);

    try {
      let content;

      if (att.__inline) {
        // Content came from a Confluence Code Block macro on the page body
        content = att.__content;
      } else {
        const downloadUrl = `${config.baseUrl}${att._links.download}`;
        const res = await fetch(downloadUrl, {
          headers: { Authorization: authHeader() },
        });

        if (!res.ok) {
          // Scoped API tokens can't hit /download/attachments/ — try the
          // inline code-block fallback on the feature file page, then a
          // local source copy.
          const inline = extractInlineFeature(att.title);
          if (inline) {
            console.log(`  ⚠️  Attachment download blocked (${res.status}) — using inline code-block for ${att.title}`);
            content = inline;
          } else {
            const local = findLocalFeature(att.title);
            if (local) {
              console.log(`  ⚠️  Attachment download blocked (${res.status}) — using local copy from features/source/ for ${att.title}`);
              content = local;
            } else {
              console.log(`  ❌ Failed: ${att.title} (${res.status}) — no inline code-block or local copy found`);
              if (res.status === 401 || res.status === 403) {
                console.log(`     ⚠️  Atlassian's /download/attachments/ endpoint rejects scoped API tokens.`);
                console.log(`        Fix one of:`);
                console.log(`          1) Regenerate CONFLUENCE_API_TOKEN as a CLASSIC (unscoped) token at`);
                console.log(`             https://id.atlassian.com/manage-profile/security/api-tokens`);
                console.log(`             (click "Create API token" — NOT "Create API token with scopes").`);
                console.log(`          2) Or paste the feature content into a Code Block macro on the`);
                console.log(`             Feature File page with the macro Title set to "${att.title}".`);
                console.log(`          3) Or drop a copy at features/source/${att.title}.`);
              }
              continue;
            }
          }
        } else {
          const buffer = Buffer.from(await res.arrayBuffer());
          content = buffer.toString('utf-8');
        }
      }

      // ── Auto-repair: insert missing Scenario: keyword after a tag line ──
      // Gherkin requires @Tag to be immediately followed by Scenario:/Feature:
      // Some Confluence feature files omit the Scenario: line.
      content = content.replace(
        /^( *@\w[^\n]*)\n( +)(Given|When|Then|And|But) /gm,
        '$1\n$2Scenario: $1\n$2$3 '
      );
      // Clean up the injected scenario name (remove leading spaces/@ from tag)
      content = content.replace(/Scenario: +@(\w+)/g, 'Scenario: $1');

      fs.writeFileSync(outPath, content, 'utf-8');
      console.log(`  ✅ ${safeName}`);
      downloaded.push(safeName);
    } catch (err) {
      console.log(`  ❌ Error downloading ${att.title}: ${err.message}`);
    }
  }

  // 6. Write selected feature paths to cache for cucumber.js
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  const featurePaths = downloaded.map(f => `features/cucumber/${f}`);
  fs.writeFileSync(
    path.join(CACHE_DIR, 'selectedFeatures.json'),
    JSON.stringify(featurePaths, null, 2)
  );

  console.log(`\n✅ Downloaded ${downloaded.length}/${toDownload.length} feature files to ${OUTPUT_DIR}`);
  console.log(`📝 Selection saved to .cache/selectedFeatures.json\n`);
  return downloaded;
}

// Run directly
fetchFeatureFiles().catch(err => {
  console.error('❌ Feature fetch failed:', err.message);
  process.exit(1);
});
