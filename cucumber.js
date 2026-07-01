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

// Cucumber-JS v10+ expects configuration at the top level of the exported
// object (not wrapped in a `default:` profile). Wrapping it in `default:`
// silently dropped `paths`, causing Cucumber to fall back to its default
// glob (features/**/*.feature) and run every feature in features/source/
// alongside the selected one. Top-level export keeps `paths` honoured.
export default {
  paths: selectedPaths,
  import: [
    'features/cucumber/support/world.js',
    'features/cucumber/step_definitions/**/*.js',
  ],
  format: [
    'progress-bar',
    'json:test-results/cucumber-report.json',
  ],
  publishQuiet: true,
  timeout: 120000,
};
