module.exports = {
  extends: 'lighthouse:default',
  settings: {
    onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
    skipAudits: [
      // Skip audits that don't apply to Electron apps
      'is-on-https',
      'redirects-http',
      'service-worker',
      'works-offline',
      'installable-manifest',
    ],
    formFactor: 'desktop',
    throttling: {
      // Simulated throttling settings
      rttMs: 40,
      throughputKbps: 10240,
      cpuSlowdownMultiplier: 1,
      requestLatencyMs: 0,
      downloadThroughputKbps: 0,
      uploadThroughputKbps: 0
    },
    // Set a longer timeout for Lighthouse
    maxWaitForLoad: 45000
  }
};
