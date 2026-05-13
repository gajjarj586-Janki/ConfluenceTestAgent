/**
 * Adds an environment-specific "<Env> Report" column (e.g. "Stage Report",
 * "Production Report") to the Feature Selection table on the Confluence page.
 *
 * The environment is taken from:
 *   1. CLI arg:     node scripts/addEnvReportColumn.js Stage
 *   2. .env:        TARGET_ENVIRONMENT=Stage
 *
 * After each test run, uploadReportToConfluence.js will populate the cell
 * with a link to the generated PDF attachment for that environment.
 */
import dotenv from 'dotenv';
dotenv.config();

import * as cheerio from 'cheerio';
import config from '../utils/confluenceConfig.js';

const envArg = process.argv[2];
const env = (envArg || process.env.TARGET_ENVIRONMENT || '').trim();
if (!env) {
  console.error('No environment provided. Pass it as a CLI arg or set TARGET_ENVIRONMENT in .env');
  console.error('Example: node scripts/addEnvReportColumn.js Stage');
  process.exit(1);
}
const columnLabel = `${env.charAt(0).toUpperCase()}${env.slice(1).toLowerCase()} Report`;

const pair = `${config.email}:${config.apiToken}`;
const auth = 'Basic ' + Buffer.from(pair).toString('base64');
const pageId = config.featureFilePageId;

// 1. Fetch current page
const getUrl = `${config.baseUrl}/rest/api/content/${pageId}?expand=body.storage,version`;
const getRes = await fetch(getUrl, {
  headers: { Authorization: auth, Accept: 'application/json' },
});
const page = await getRes.json();
const html = page.body.storage.value;
const version = page.version.number;

const $ = cheerio.load(html, { xmlMode: true, decodeEntities: false });

// 2. Check if column already exists
const headerRow = $('table tbody tr').first();
const headers = [];
headerRow.find('th, td').each((_, cell) => {
  if (!$(cell).hasClass('numberingColumn')) {
    headers.push($(cell).text().trim().toLowerCase());
  }
});

if (headers.includes(columnLabel.toLowerCase())) {
  console.log(`"${columnLabel}" column already exists — no changes needed`);
  process.exit(0);
}

// 3. Add header
headerRow.append(`<th><p><strong>${columnLabel}</strong></p></th>`);

// 4. Add empty cell to each data row
$('table tbody tr').each((i, tr) => {
  if (i === 0) return;
  $(tr).append('<td><p></p></td>');
});

const newHtml = $.html();

// 5. Update the page
const updateUrl = `${config.baseUrl}/rest/api/content/${pageId}`;
const updateRes = await fetch(updateUrl, {
  method: 'PUT',
  headers: {
    Authorization: auth,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
  body: JSON.stringify({
    id: pageId,
    type: 'page',
    title: page.title,
    version: { number: version + 1 },
    body: {
      storage: {
        value: newHtml,
        representation: 'storage',
      },
    },
  }),
});

if (updateRes.ok) {
  console.log(`✅ "${columnLabel}" column added to Confluence page (version ${version + 1})`);
  console.log('   After each test run the cell will be auto-populated with a PDF link.');
} else {
  const errBody = await updateRes.text();
  console.error(`❌ Failed to update page (${updateRes.status}): ${errBody.substring(0, 300)}`);
  process.exit(1);
}
