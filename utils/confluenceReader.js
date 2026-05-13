/**
 * Confluence Reader Utility
 * Fetches and parses Confluence page tables into JSON arrays.
 * Drop-in replacement for ExcelReader — produces the same row-object shape.
 */
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import config from './confluenceConfig.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '..', '.cache');

class ConfluenceReader {

  // ── Core API Helpers ──────────────────────────────────────

  /**
   * Build Basic Auth header from email + API token
   */
  static _authHeader() {
    const pair = `${config.email}:${config.apiToken}`;
    return 'Basic ' + Buffer.from(pair).toString('base64');
  }

  /**
   * Fetch a Confluence page's storage-format HTML body
   * @param {string} pageId
   * @returns {string} raw HTML body
   */
  static async fetchPageBody(pageId) {
    const url = `${config.baseUrl}/rest/api/content/${pageId}?expand=body.storage`;
    const res = await fetch(url, {
      headers: { Authorization: this._authHeader(), Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Confluence API ${res.status}: ${res.statusText}`);
    const json = await res.json();
    return json.body.storage.value;
  }

  // ── HTML Table Parser ─────────────────────────────────────

  /**
   * Parse ALL tables from a Confluence storage-format HTML body.
   * Returns an array of { name, rows } where each row is a key→value object
   * whose keys come from the first <tr> (header row).
   *
   * @param {string} html – raw storage-format HTML
   * @returns {Array<{ name: string, rows: object[] }>}
   */
  static parseTables(html) {
    const $ = cheerio.load(html);
    const sections = [];

    // Build a DOM-proximity map: find headings that precede tables.
    // Handles multiple Confluence page styles:
    //   1. ol > li > p > strong  (Hyundai numbered list style)
    //   2. h2, h3 headings
    //   3. Standalone p > strong or p containing bold text
    const headingTablePairs = [];
    const _addedTables = new Set();

    const _findNextTable = (startEl) => {
      let sibling = $(startEl).next();
      let steps = 0;
      while (sibling.length && !sibling.is('table') && steps < 5) {
        sibling = sibling.next();
        steps++;
      }
      return sibling.is('table') ? sibling[0] : null;
    };

    // Style 1: ol > li > p > strong  (original Hyundai style)
    // Falls back to plain `ol > li > p` text when no <strong> is present (some
    // sections — e.g. "13. Talk to an expert - Test Data" — omit bold).
    $('ol').each((_, olEl) => {
      const strongEl = $(olEl).find('li > p > strong').first();
      let heading = strongEl.length ? strongEl.text().trim() : '';
      if (!heading) {
        const pEl = $(olEl).find('li > p').first();
        heading = pEl.length ? pEl.text().trim() : '';
      }
      if (!heading) return;
      const tableEl = _findNextTable(olEl);
      if (tableEl && !_addedTables.has(tableEl)) {
        headingTablePairs.push({ name: heading, tableEl });
        _addedTables.add(tableEl);
      }
    });

    // Style 2: h2, h3 headings followed by a table
    $('h2, h3').each((_, hEl) => {
      const heading = $(hEl).text().trim();
      if (!heading) return;
      const tableEl = _findNextTable(hEl);
      if (tableEl && !_addedTables.has(tableEl)) {
        headingTablePairs.push({ name: heading, tableEl });
        _addedTables.add(tableEl);
      }
    });

    // Style 3: standalone p > strong (not inside ol/li) followed by a table
    $('p > strong').each((_, strongEl) => {
      // Skip if already inside an ol/li (handled above)
      if ($(strongEl).closest('ol, li').length) return;
      const heading = $(strongEl).text().trim();
      if (!heading) return;
      const tableEl = _findNextTable($(strongEl).closest('p'));
      if (tableEl && !_addedTables.has(tableEl)) {
        headingTablePairs.push({ name: heading, tableEl });
        _addedTables.add(tableEl);
      }
    });

    // Parse rows from each located table
    for (const { name: sectionName, tableEl } of headingTablePairs) {
      const trs = $(tableEl).find('tbody > tr');
      if (trs.length === 0) continue;

      // First row = headers (th or td)
      const headers = [];
      $(trs[0]).find('th, td').each((_, cell) => {
        let text = $(cell).text().trim();
        // Skip numbering columns
        if ($(cell).hasClass('numberingColumn')) return;
        headers.push(text);
      });

      if (headers.length === 0) continue;

      // Remaining rows = data
      const rows = [];
      trs.each((rowIdx, tr) => {
        if (rowIdx === 0) return; // skip header
        const cells = [];
        $(tr).find('th, td').each((_, cell) => {
          if ($(cell).hasClass('numberingColumn')) return;

          // Prefer href from <a> tags for URL/email columns
          const anchor = $(cell).find('a').first();
          let value;
          if (anchor.length > 0) {
            const href = anchor.attr('href') || '';
            const text = $(cell).text().trim();
            // Use href for URLs and mailto, plain text otherwise
            if (href.startsWith('http') || href.startsWith('mailto:')) {
              value = href.startsWith('mailto:') ? href.replace('mailto:', '') : href;
            } else {
              value = text;
            }
          } else {
            value = $(cell).text().trim();
          }
          cells.push(value);
        });

        if (cells.length === 0) return;

        const row = {};
        headers.forEach((h, i) => {
          row[h] = cells[i] !== undefined ? cells[i] : '';
        });
        rows.push(row);
      });

      sections.push({ name: sectionName, rows });
    }

    return sections;
  }

  // ── Public API (mirrors ExcelReader) ──────────────────────

  /**
   * Search for a Confluence page by title and return its page ID
   * @param {string} title – exact or partial page title
   * @returns {string|null} page ID or null if not found
   */
  static async findPageIdByTitle(title) {
    const searchUrl = `${config.baseUrl}/rest/api/content?title=${encodeURIComponent(title)}&expand=body.storage&limit=1`;
    const res = await fetch(searchUrl, {
      headers: { Authorization: this._authHeader(), Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json.results && json.results.length > 0) {
      return json.results[0].id;
    }
    return null;
  }

  /**
   * Fetch all tables from a Confluence page by title
   * @param {string} title – page title to search for
   * @returns {Object} keyed by section name → array of row objects
   */
  static async readAllSheetsByTitle(title) {
    const pageId = await this.findPageIdByTitle(title);
    if (!pageId) throw new Error(`Confluence page not found: "${title}"`);
    const html = await this.fetchPageBody(pageId);
    const tables = this.parseTables(html);
    const result = {};
    for (const t of tables) {
      result[t.name] = t.rows;
    }
    return result;
  }

  /**
   * Fetch all tables from the test data Confluence page
   * @returns {Object} keyed by section name → array of row objects
   */
  static async readAllSheets() {
    const html = await this.fetchPageBody(config.testDataPageId);
    const tables = this.parseTables(html);
    const result = {};
    for (const t of tables) {
      result[t.name] = t.rows;
    }
    return result;
  }

  /**
   * Fetch a specific named table from the test data page
   * @param {string} sectionName – heading text above the table
   * @returns {Array<object>} rows
   */
  static async readSheet(sectionName) {
    const all = await this.readAllSheets();

    // Try exact match first
    if (all[sectionName]) return all[sectionName];

    // Fuzzy match: find section whose name contains the search string
    const key = Object.keys(all).find(k =>
      k.toLowerCase().includes(sectionName.toLowerCase())
    );
    if (key) return all[key];

    throw new Error(`Section "${sectionName}" not found in Confluence page. Available: ${Object.keys(all).join(', ')}`);
  }

  /**
   * Get a single row from a section
   * @param {string} sectionName
   * @param {number} rowIndex – 0-based
   * @returns {object}
   */
  static async readRow(sectionName, rowIndex) {
    const rows = await this.readSheet(sectionName);
    if (rowIndex < 0 || rowIndex >= rows.length) {
      throw new Error(`Row ${rowIndex} out of bounds (${rows.length} rows)`);
    }
    return rows[rowIndex];
  }

  /**
   * Get the environment configuration table
   * @returns {Array<object>}
   */
  static async getEnvironmentConfig() {
    return this.readSheet('Environment Configuration');
  }

  /**
   * Get the environment URLs table
   * @returns {Array<object>}
   */
  static async getEnvironmentUrls() {
    return this.readSheet('Environment URLs');
  }

  /**
   * Get the Contact Us form test data
   * @returns {Array<object>}
   */
  static async getContactUsData() {
    return this.readSheet('Contact Us');
  }

  /**
   * Get the Test Drive form test data
   * @returns {Array<object>}
   */
  static async getTestDriveData() {
    return this.readSheet('Test Drive');
  }

  /**
   * Get the Contact A Dealer form test data
   * @returns {Array<object>}
   */
  static async getContactDealerData() {
    return this.readSheet('Contact A Dealer');
  }

  /**
   * Resolve a URL for a specific page from the environment URLs table.
   * @param {string} pageName – e.g. 'Contact Us', 'Home', 'Test Drive'
   * @param {string} environment – 'Dev', 'Stage', or 'Production'
   * @returns {string} URL
   */
  static async resolveUrl(pageName, environment) {
    const urls = await this.getEnvironmentUrls();
    const row = urls.find(r => r.Page && r.Page.toLowerCase().includes(pageName.toLowerCase()));
    if (!row) throw new Error(`URL for "${pageName}" not found in Environment URLs table`);

    const envKey = Object.keys(row).find(k => k.toLowerCase() === environment.toLowerCase());
    if (!envKey || !row[envKey]) throw new Error(`No ${environment} URL for "${pageName}"`);

    return row[envKey];
  }

  // ── Caching ───────────────────────────────────────────────

  /**
   * Fetch and cache all test data to local JSON.
   * Subsequent reads can use the cache to avoid hitting the API.
   */
  static async cacheAll() {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    const all = await this.readAllSheets();
    const cachePath = path.join(CACHE_DIR, 'testdata.json');
    fs.writeFileSync(cachePath, JSON.stringify(all, null, 2));
    console.log(`✅ Test data cached to ${cachePath}`);
    return all;
  }

  /**
   * Read from local cache (no API call).
   * @param {string} sectionName
   * @returns {Array<object>}
   */
  static readFromCache(sectionName) {
    const cachePath = path.join(CACHE_DIR, 'testdata.json');
    if (!fs.existsSync(cachePath)) {
      throw new Error('No local cache found. Run `cacheAll()` first or fetch from Confluence.');
    }
    const all = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    if (sectionName) {
      const key = Object.keys(all).find(k =>
        k.toLowerCase().includes(sectionName.toLowerCase())
      );
      if (!key) throw new Error(`Section "${sectionName}" not in cache`);
      return all[key];
    }
    return all;
  }
}

export default ConfluenceReader;
