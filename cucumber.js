/**
 * Cucumber.js configuration
 *
 * Reads .cache/selectedFeatures.json (written by fetchFeatures.js)
 * to only run feature files that were checked ☑ on the Confluence page.
 * Falls back to all features if no selection file exists.
 */
import fs from 'fs';

function getSelectedPaths() {
  try {
    const raw = fs.readFileSync('.cache/selectedFeatures.json', 'utf-8');
    const paths = JSON.parse(raw);
    if (Array.isArray(paths) && paths.length > 0) {
      console.log(`📋 Running ${paths.length} selected feature(s) from Confluence`);
      return paths;
    }
  } catch {
    // No selection file — use all
  }
  return ['features/cucumber/**/*.feature'];
}

const selectedPaths = getSelectedPaths();

export default {
  default: {
    paths: selectedPaths,
    require: [
      'features/cucumber/support/world.js',
      'features/cucumber/step_definitions/**/*.js',
    ],
    format: [
      'progress-bar',
      'json:test-results/cucumber-report.json',
    ],
    publishQuiet: true,
    timeout: 120000,
  },
};
