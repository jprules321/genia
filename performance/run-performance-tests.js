const lighthouse = require('lighthouse');
const chromeLauncher = require('chrome-launcher');
const fs = require('fs');
const path = require('path');
const config = require('./lighthouse-config');

/**
 * Runs Lighthouse performance tests on the application
 * @param {string} url - The URL to test (typically http://localhost:4201 for dev)
 * @param {object} options - Test options
 * @returns {Promise<object>} - The Lighthouse results
 */
async function runLighthouse(url, options = {}) {
  // Launch Chrome
  const chrome = await chromeLauncher.launch({
    chromeFlags: ['--headless', '--disable-gpu', '--no-sandbox']
  });

  try {
    // Run Lighthouse
    const { lhr } = await lighthouse(url, {
      port: chrome.port,
      output: 'json',
      logLevel: 'info',
      ...options
    }, config);

    return lhr;
  } finally {
    // Always close Chrome
    await chrome.kill();
  }
}

/**
 * Saves the Lighthouse results to a file
 * @param {object} results - The Lighthouse results
 * @param {string} outputPath - The path to save the results to
 */
function saveResults(results, outputPath) {
  const dir = path.dirname(outputPath);

  // Create directory if it doesn't exist
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Save the results
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));

  console.log(`Results saved to ${outputPath}`);
}

/**
 * Analyzes the Lighthouse results and logs performance metrics
 * @param {object} results - The Lighthouse results
 * @returns {boolean} - Whether the performance meets the thresholds
 */
function analyzeResults(results) {
  const { categories } = results;

  console.log('\n=== Performance Test Results ===\n');

  // Define performance thresholds
  const thresholds = {
    performance: 0.8,
    accessibility: 0.9,
    'best-practices': 0.9,
    seo: 0.8
  };

  let allPassed = true;

  // Log each category score and check against thresholds
  Object.entries(categories).forEach(([key, category]) => {
    const score = category.score;
    const threshold = thresholds[key] || 0;
    const passed = score >= threshold;

    if (!passed) {
      allPassed = false;
    }

    console.log(`${category.title}: ${Math.round(score * 100)} / 100 ${passed ? '✓' : '✗'}`);
  });

  // Log detailed performance metrics
  console.log('\n=== Detailed Performance Metrics ===\n');

  const performanceMetrics = [
    'first-contentful-paint',
    'largest-contentful-paint',
    'total-blocking-time',
    'cumulative-layout-shift',
    'speed-index'
  ];

  performanceMetrics.forEach(metricId => {
    const metric = results.audits[metricId];
    if (metric) {
      console.log(`${metric.title}: ${metric.displayValue}`);
    }
  });

  return allPassed;
}

/**
 * Main function to run the performance tests
 */
async function main() {
  const url = process.env.TEST_URL || 'http://localhost:4201';
  const outputPath = path.join(__dirname, '../performance-results', `lighthouse-${new Date().toISOString().replace(/:/g, '-')}.json`);

  console.log(`Running performance tests on ${url}...`);

  try {
    const results = await runLighthouse(url);
    saveResults(results, outputPath);
    const passed = analyzeResults(results);

    if (!passed) {
      console.log('\n⚠️ Some performance metrics did not meet the thresholds.');
      process.exit(1);
    } else {
      console.log('\n✅ All performance metrics meet the thresholds!');
    }
  } catch (error) {
    console.error('Error running performance tests:', error);
    process.exit(1);
  }
}

// Run the tests
if (require.main === module) {
  main();
}

module.exports = {
  runLighthouse,
  saveResults,
  analyzeResults
};
