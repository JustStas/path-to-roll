const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './tests/browser',
    testMatch: '**/*.spec.js',
    workers: 1,
    fullyParallel: false,
    timeout: 30000,
    expect: { timeout: 5000 },
    reporter: [['list'], ['json', { outputFile: 'test-results/results.json' }]]
});
