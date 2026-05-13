/**
 * Helper: Set a feature's Run column to "Yes" on Confluence.
 * Usage: node scripts/setFeatureRun.js "contact_us" "Yes"
 */
import dotenv from 'dotenv';
dotenv.config();

import * as cheerio from 'cheerio';
import config from '../utils/confluenceConfig.js';

const searchTerm = process.argv[2];
const runValue = process.argv[3] || 'Yes';

if (!searchTerm) {
  console.log('Usage: node scripts/setFeatureRun.js <feature-name-substring> [Yes|No]');
  process.exit(1);
}

const pair = `${config.email}:${config.apiToken}`;
const auth = 'Basic ' + Buffer.from(pair).toString('base64');
const pageId = config.featureFilePageId;

const getUrl = `${config.baseUrl}/rest/api/content/${pageId}?expand=body.storage,version`;
const getRes = await fetch(getUrl, { headers: { Authorization: auth, Accept: 'application/json' } });
const page = await getRes.json();
const version = page.version.number;

const $ = cheerio.load(page.body.storage.value, { xmlMode: true, decodeEntities: false });

let updated = false;
$('table tbody tr').each((i, tr) => {
  if (i === 0) return;

  // Get attachment filename from raw HTML of the row
  const rowHtml = $.html(tr);
  const match = rowHtml.match(/ri:filename="([^"]+\.feature)"/);
  if (!match) return;
  const filename = match[1];

  if (!filename.toLowerCase().includes(searchTerm.toLowerCase())) return;

  // Find all non-numbering cells
  const cells = [];
  $(tr).find('td, th').each((_, c) => {
    if (!$(c).hasClass('numberingColumn')) cells.push(c);
  });

  // Last cell is the Run column
  const runCell = cells[cells.length - 1];
  $(runCell).html(`<p>${runValue}</p>`);
  console.log(`  ${runValue === 'Yes' ? '☑' : '☐'} ${filename} → ${runValue}`);
  updated = true;
});

if (!updated) {
  console.log(`No feature matching "${searchTerm}" found`);
  process.exit(1);
}

const updateUrl = `${config.baseUrl}/rest/api/content/${pageId}`;
const updateRes = await fetch(updateUrl, {
  method: 'PUT',
  headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify({
    id: pageId,
    type: 'page',
    title: page.title,
    version: { number: version + 1 },
    body: { storage: { value: $.html(), representation: 'storage' } },
  }),
});

if (updateRes.ok) {
  console.log(`\nPage updated (version ${version + 1})`);
} else {
  const err = await updateRes.text();
  console.error(`Failed: ${updateRes.status} ${err.substring(0, 300)}`);
}
