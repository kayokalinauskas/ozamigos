// Fumaça do app para Windows (npm test): abre o Electron de verdade, pelo teste/embrulho.js.
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'teste',
  testMatch: '*.e2e.js',
  timeout: 60_000,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
});
