/**
 * One-time script: Adds an "Automation Status" column to the Feature File
 * Confluence page (next to the Report column).
 *
 * After each test run, uploadReportToConfluence.js populates the cell with
 * PASS or FAIL based on cucumber-report.json results.
 *
 * Run: node scripts/addAutomationStatusColumn.js
 */
import dotenv from 'dotenv';
dotenv.config();

import * as cheerio from 'cheerio';
import config from '../utils/confluenceConfig.js';

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

// 2. Check if Automation Status column already exists
const headerRow = $('table tbody tr').first();
const headers = [];
headerRow.find('th, td').each((_, cell) => {
  if (!$(cell).hasClass('numberingColumn')) {
    headers.push($(cell).text().trim().toLowerCase());
  }
});

if (headers.includes('automation status')) {
  console.log('Automation Status column already exists — no changes needed');
  process.exit(0);
}

// 3. Add Automation Status header
headerRow.append('<th><p><strong>Automation Status</strong></p></th>');

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
  console.log(`✅ Automation Status column added to Confluence page (version ${version + 1})`);
  console.log('   After each test run the cell will be auto-populated with PASS or FAIL.');
} else {
  const err = await updateRes.text();
  console.error(`Failed to update: ${updateRes.status} ${err.substring(0, 500)}`);
}
