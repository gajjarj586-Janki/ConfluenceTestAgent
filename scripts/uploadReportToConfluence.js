/**
 * Upload PDF Report to Confluence
 *
 * 1. Uploads the generated PDF as an attachment to the Feature File Confluence page.
 * 2. Updates the "Report" column cell for each matching feature row with an
 *    ac:link macro pointing to the uploaded attachment.
 *
 * Exported function signature:
 *   uploadReportToConfluence(pdfPath, testedFeatureFiles)
 *     pdfPath            – absolute path to the PDF file to upload
 *     testedFeatureFiles – array of .feature filenames that were run (e.g. ['contact_us.feature'])
 *
 * CLI usage:
 *   node scripts/uploadReportToConfluence.js <path/to/report.pdf> [feature1.feature ...]
 */
import dotenv from 'dotenv';
dotenv.config();

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import config from '../utils/confluenceConfig.js';

const pageId = config.featureFilePageId;
const baseUrl = config.baseUrl;

function authHeader() {
  const pair = `${config.email}:${config.apiToken}`;
  return 'Basic ' + Buffer.from(pair).toString('base64');
}

// ─── Step 1: Upload PDF as Attachment ────────────────────────

async function uploadAttachment(pdfPath) {
  const filename = path.basename(pdfPath);
  const fileBuffer = fs.readFileSync(pdfPath);

  // Build a FormData-compatible multipart payload using Buffer
  const boundary = `----ConfluenceUpload${Date.now()}`;
  const CRLF = '\r\n';

  const header =
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"${CRLF}` +
    `Content-Type: application/pdf${CRLF}${CRLF}`;
  const footer = `${CRLF}--${boundary}--${CRLF}`;

  const body = Buffer.concat([
    Buffer.from(header, 'utf-8'),
    fileBuffer,
    Buffer.from(footer, 'utf-8'),
  ]);

  const attachUrl = `${baseUrl}/rest/api/content/${pageId}/child/attachment`;

  // Check if attachment with the same name already exists; if so, update it
  const listRes = await fetch(`${attachUrl}?filename=${encodeURIComponent(filename)}`, {
    headers: {
      Authorization: authHeader(),
      Accept: 'application/json',
      'X-Atlassian-Token': 'no-check',
    },
  });
  const listJson = await listRes.json();
  const existing = listJson.results?.[0];

  let uploadUrl = attachUrl;
  let method = 'POST';
  if (existing) {
    uploadUrl = `${attachUrl}/${existing.id}/data`;
    method = 'POST'; // Confluence attachment update also uses POST on /data endpoint
    console.log(`♻️  Updating existing attachment: ${filename} (id: ${existing.id})`);
  } else {
    console.log(`📎 Uploading new attachment: ${filename}`);
  }

  const uploadRes = await fetch(uploadUrl, {
    method,
    headers: {
      Authorization: authHeader(),
      'X-Atlassian-Token': 'no-check',
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      Accept: 'application/json',
    },
    body,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`Attachment upload failed (${uploadRes.status}): ${errText.substring(0, 300)}`);
  }

  const uploadJson = await uploadRes.json();
  // The API returns { results: [...] } for new uploads, or a single object for updates
  const attachment = uploadJson.results?.[0] || uploadJson;
  console.log(`✅ Attachment uploaded: ${filename}`);
  return filename; // We use the filename in the ac:link macro
}

// ─── Step 2: Update the Report column in the Confluence table ─

async function updateReportColumn(pdfFilename, testedFeatureFiles, status) {
  const getUrl = `${baseUrl}/rest/api/content/${pageId}?expand=body.storage,version`;
  const getRes = await fetch(getUrl, {
    headers: { Authorization: authHeader(), Accept: 'application/json' },
  });
  if (!getRes.ok) {
    throw new Error(`Failed to fetch Confluence page: ${getRes.status}`);
  }
  const pageData = await getRes.json();
  const version = pageData.version.number;

  const $ = cheerio.load(pageData.body.storage.value, { xmlMode: true, decodeEntities: false });

  // Locate the column indexes in the table header
  const headerCells = [];
  $('table tbody tr:first-child th, table tbody tr:first-child td, table thead tr:first-child th').each((_, cell) => {
    if (!$(cell).hasClass('numberingColumn')) {
      headerCells.push($(cell).text().trim().toLowerCase());
    }
  });

  // Prefer an environment-specific Report column (e.g. "Stage Report", "Production Report")
  // when TARGET_ENVIRONMENT is set; fall back to a generic "Report" column.
  const env = (process.env.TARGET_ENVIRONMENT || '').trim().toLowerCase();
  const envReportLabel = env ? `${env} report` : '';
  let reportIdx = -1;
  let reportLabelUsed = '';
  if (envReportLabel) {
    reportIdx = headerCells.findIndex(h => h === envReportLabel);
    if (reportIdx !== -1) reportLabelUsed = envReportLabel;
  }
  if (reportIdx === -1) {
    reportIdx = headerCells.findIndex(h => h === 'report');
    if (reportIdx !== -1) reportLabelUsed = 'report';
  }
  const featureIdx = headerCells.findIndex(h => h.includes('feature') || h.includes('file'));
  const statusIdx = headerCells.findIndex(h => h === 'automation status' || h === 'test result' || h === 'status');

  if (reportIdx === -1) {
    const wanted = envReportLabel ? `"${envReportLabel}" or "Report"` : '"Report"';
    throw new Error(
      `No ${wanted} column found on the Confluence page. ` +
      `Run "node scripts/addEnvReportColumn.js" (env-specific) or "node scripts/addReportColumn.js" first to add it.`
    );
  }
  console.log(`   Target column: "${reportLabelUsed}"`);

  if (statusIdx === -1 && status) {
    console.warn('⚠️  No "Automation Status" column found on the Confluence page — skipping status update.');
    console.warn('    Run "node scripts/addAutomationStatusColumn.js" once to add it.');
  }

  // Confluence storage format link to an attachment on the same page:
  // <ac:link><ri:attachment ri:filename="X.pdf" /></ac:link>
  const reportCellHtml =
    `<p><ac:link><ri:attachment ri:filename="${pdfFilename}" /></ac:link></p>`;

  // Coloured PASS/FAIL pill via Confluence status macro (falls back gracefully).
  const statusCellHtml = status
    ? `<p><ac:structured-macro ac:name="status" ac:schema-version="1">` +
        `<ac:parameter ac:name="colour">${status === 'PASS' ? 'Green' : 'Red'}</ac:parameter>` +
        `<ac:parameter ac:name="title">${status}</ac:parameter>` +
      `</ac:structured-macro></p>`
    : '';

  let updatedCount = 0;
  $('table tbody tr').each((i, tr) => {
    if (i === 0) return; // skip header row

    // Get the feature filename from the row
    const cells = [];
    $(tr).find('td, th').each((_, c) => {
      if (!$(c).hasClass('numberingColumn')) cells.push(c);
    });

    let rowFeatureName = '';
    if (featureIdx !== -1 && cells[featureIdx]) {
      const attachment = $(cells[featureIdx]).find('ri\\:attachment, attachment');
      rowFeatureName = attachment.attr('ri:filename') || $(cells[featureIdx]).text().trim();
    }

    if (!rowFeatureName) return;

    // Normalize a filename the same way fetchFeatures.js does:
    // replace any non-alphanumeric/dash/dot chars with underscores
    const normalize = (name) => name.replace(/[^a-zA-Z0-9_\-\.]/g, '_').toLowerCase();

    const normalizedRow = normalize(rowFeatureName);

    // Check if this row's feature was tested in this run
    const wasRun = testedFeatureFiles.some(f => {
      const normalizedRun = normalize(f);
      return normalizedRun === normalizedRow ||
             normalizedRow.includes(normalizedRun.replace(/\.feature$/i, '')) ||
             normalizedRun.includes(normalizedRow.replace(/\.feature$/i, ''));
    });

    if (!wasRun) return;

    // Update the Report cell
    if (cells[reportIdx]) {
      $(cells[reportIdx]).html(reportCellHtml);
      console.log(`  📄 ${rowFeatureName} → Report column updated`);
      updatedCount++;
    }

    // Update the Automation Status cell (PASS / FAIL)
    if (status && statusIdx !== -1 && cells[statusIdx]) {
      $(cells[statusIdx]).html(statusCellHtml);
      console.log(`  ${status === 'PASS' ? '✅' : '❌'} ${rowFeatureName} → Automation Status: ${status}`);
    }
  });

  if (updatedCount === 0) {
    console.log('⚠️  No matching feature rows found on Confluence page — Report column not updated.');
    console.log(`    Tested features: ${testedFeatureFiles.join(', ')}`);
    return;
  }

  // Push the updated page back to Confluence
  const updateRes = await fetch(`${baseUrl}/rest/api/content/${pageId}`, {
    method: 'PUT',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      id: pageId,
      type: 'page',
      title: pageData.title,
      version: { number: version + 1 },
      body: { storage: { value: $.html(), representation: 'storage' } },
    }),
  });

  if (!updateRes.ok) {
    const err = await updateRes.text();
    throw new Error(`Page update failed (${updateRes.status}): ${err.substring(0, 300)}`);
  }

  console.log(`✅ Confluence page updated — ${updatedCount} row(s) now link to ${pdfFilename} (version ${version + 1})`);
}

// ─── Main exported function ───────────────────────────────────

/**
 * Upload the PDF report and update the Report column on the Confluence page.
 *
 * @param {string}   pdfPath            Absolute path to the PDF file.
 * @param {string[]} testedFeatureFiles Array of .feature filenames that were tested.
 */
export async function uploadReportToConfluence(pdfPath, testedFeatureFiles = [], status = '') {
  if (!fs.existsSync(pdfPath)) {
    console.warn(`⚠️  PDF not found at ${pdfPath} — skipping Confluence upload`);
    return;
  }

  // Normalize status input — accept boolean, stats object, or string.
  let normalizedStatus = '';
  if (typeof status === 'string') {
    const u = status.trim().toUpperCase();
    if (u === 'PASS' || u === 'PASSED') normalizedStatus = 'PASS';
    else if (u === 'FAIL' || u === 'FAILED') normalizedStatus = 'FAIL';
  } else if (typeof status === 'boolean') {
    normalizedStatus = status ? 'PASS' : 'FAIL';
  } else if (status && typeof status === 'object') {
    if (typeof status.fail === 'number') normalizedStatus = status.fail === 0 ? 'PASS' : 'FAIL';
  }

  console.log(`\n📤 Uploading report to Confluence…`);
  console.log(`   PDF: ${pdfPath}`);
  console.log(`   Features: ${testedFeatureFiles.join(', ') || '(all)'}`);
  if (normalizedStatus) console.log(`   Automation Status: ${normalizedStatus}`);

  const pdfFilename = await uploadAttachment(pdfPath);
  await updateReportColumn(pdfFilename, testedFeatureFiles, normalizedStatus);
}

// ─── CLI entry ────────────────────────────────────────────────

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const [, , pdfArg, ...rest] = process.argv;
  if (!pdfArg) {
    console.error('Usage: node scripts/uploadReportToConfluence.js <path/to/report.pdf> [feature1.feature ...] [--status PASS|FAIL]');
    process.exit(1);
  }
  // Allow a trailing --status PASS|FAIL flag
  let cliStatus = '';
  const featureArgs = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--status' && rest[i + 1]) { cliStatus = rest[i + 1]; i++; }
    else if (rest[i].startsWith('--status=')) { cliStatus = rest[i].split('=')[1]; }
    else featureArgs.push(rest[i]);
  }
  uploadReportToConfluence(path.resolve(pdfArg), featureArgs, cliStatus).catch(err => {
    console.error(`❌ Upload failed: ${err.message}`);
    process.exit(1);
  });
}
