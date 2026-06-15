/**
 * Upload a local .feature file back to Confluence as an attachment,
 * replacing the existing attachment with the same name.
 *
 * Usage: node scripts/uploadFeatureFile.js <path/to/file.feature>
 */
import dotenv from 'dotenv';
dotenv.config();

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../utils/confluenceConfig.js';

const pageId = config.featureFilePageId;
const baseUrl = config.baseUrl;

function authHeader() {
  return 'Basic ' + Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');
}

async function uploadFeatureFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const filename = path.basename(filePath);
  const fileBuffer = fs.readFileSync(filePath);

  const boundary = `----ConfluenceUpload${Date.now()}`;
  const CRLF = '\r\n';
  const header =
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"${CRLF}` +
    `Content-Type: text/plain${CRLF}${CRLF}`;
  const footer = `${CRLF}--${boundary}--${CRLF}`;
  const body = Buffer.concat([Buffer.from(header), fileBuffer, Buffer.from(footer)]);

  const attachUrl = `${baseUrl}/rest/api/content/${pageId}/child/attachment`;

  // Check if attachment already exists
  const listRes = await fetch(`${attachUrl}?filename=${encodeURIComponent(filename)}`, {
    headers: { Authorization: authHeader(), Accept: 'application/json', 'X-Atlassian-Token': 'no-check' },
  });
  const listJson = await listRes.json();
  const existing = listJson.results?.[0];

  const uploadUrl = existing ? `${attachUrl}/${existing.id}/data` : attachUrl;
  const action = existing ? `Updating existing` : `Uploading new`;
  console.log(`${action} attachment: ${filename}${existing ? ` (id: ${existing.id})` : ''}`);

  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'X-Atlassian-Token': 'no-check',
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      Accept: 'application/json',
    },
    body,
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    throw new Error(`Upload failed (${uploadRes.status}): ${err.substring(0, 300)}`);
  }

  const resJson = await uploadRes.json(); const version = resJson.results?.[0]?.version?.number || resJson.version?.number; console.log(`? ${filename} uploaded to Confluence page ${pageId} (Version: ${version})`);
}

// CLI entry
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node scripts/uploadFeatureFile.js <path/to/file.feature>');
    process.exit(1);
  }
  uploadFeatureFile(path.resolve(filePath)).catch(err => {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  });
}

export { uploadFeatureFile };
