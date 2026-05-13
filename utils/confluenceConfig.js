/**
 * Confluence Configuration
 * Maps Confluence page IDs and table names for test data sections.
 */
import dotenv from 'dotenv';
dotenv.config();

const config = {
  baseUrl: process.env.CONFLUENCE_BASE_URL || 'https://orchardhome.atlassian.net/wiki',
  email: process.env.CONFLUENCE_EMAIL,
  apiToken: process.env.CONFLUENCE_API_TOKEN,

  // Page IDs
  testDataPageId: process.env.CONFLUENCE_TEST_DATA_PAGE_ID || '1776353299',
  featureFilePageId: process.env.CONFLUENCE_FEATURE_FILE_PAGE_ID || '1729724417',

  // Table section names (matched against <strong> headings in the page)
  tableNames: {
    environmentConfig: 'Environment Configuration',
    environmentUrls: 'Environment URLs',
    contactUsFormData: 'Contact Us Form – Test Data',
    testDriveFormData: 'Test Drive Form – Test Data',
    contactDealerFormData: 'Contact A Dealer Form – Test Data',
    calculatorData: 'Calculator – Vehicle Test Data',
    accessoriesUrls: 'Accessories URLs by Environment',
  },

  // Target environment (Dev / Stage / Production)
  targetEnvironment: process.env.TARGET_ENVIRONMENT || 'Production',
};

export default config;
