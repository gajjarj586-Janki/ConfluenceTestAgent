/**
 * One-time script: Adds a "Run" column to the Feature file Confluence page.
 * Each row gets "No" by default. Change to "Yes" on Confluence to select features.
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

// 2. Check if Run column already exists
const headerRow = $('table tbody tr').first();
const headers = [];
headerRow.find('th').each((_, th) => headers.push($(th).text().trim().toLowerCase()));

if (headers.includes('run')) {
  console.log('Run column already exists - no changes needed');
  process.exit(0);
}

// 3. Add Run header
headerRow.append('<th><p><strong>Run</strong></p></th>');

// 4. Add "No" to each data row
$('table tbody tr').each((i, tr) => {
  if (i === 0) return;
  $(tr).append('<td><p>No</p></td>');
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
  console.log(`Run column added to Confluence page (version ${version + 1})`);
  console.log('Go to Confluence and change "No" to "Yes" for features you want to run.');
} else {
  const err = await updateRes.text();
  console.error(`Failed to update: ${updateRes.status} ${err.substring(0, 500)}`);
}
