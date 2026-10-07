const test = require('node:test');
const assert = require('node:assert/strict');
const loadApp = require('./helpers/app-harness.cjs');
const load = options => loadApp({ sourcePath: process.env.APP_TEST_HTML, ...options });
function assertHeader(app, language) {
  const japanese = language === 'ja', button = app.node('#languageButton');
  assert.equal(app.state.language, language);
  assert.equal(button.textContent, japanese ? 'EN' : 'JA');
  assert.equal(button['aria-label'], japanese ? '英語に切り替え' : 'Switch to Japanese');
  assert.equal(button.title, japanese ? '英語に切り替え' : 'Switch to Japanese');
  assert.ok(app.i18nElements.some(el => el.dataset.i18n === 'localBadge' && el.textContent === (japanese ? '完全ローカル処理' : 'Fully local processing')));
}
for (const language of ['ja', 'en']) test(`header target and privacy on fresh ${language} load and repeated switches`, async () => {
  const app = load({ language }); assertHeader(app, language);
  for (let n = 0; n < 4; n++) { await app.node('#languageButton').click(); assertHeader(app, n % 2 ? language : language === 'ja' ? 'en' : 'ja'); }
});
test('header honors saved language and tolerates unavailable storage', () => {
  assertHeader(load({ language: 'en', savedLanguage: 'ja' }), 'ja');
  assertHeader(load({ language: 'ja', storageThrows: true }), 'ja');
});
test('static and runtime version badges follow canonical config', () => {
  const app = load(); assert.match(app.config.version, /^\d+\.\d+\.\d+$/);
  assert.equal(app.node('#versionBadge').textContent, `v${app.config.version}`);
  assert.ok(app.source.includes(`id="versionBadge">v${app.config.version}</span>`));
});
test('language switches preserve loaded files, analysis and edited report filename', async () => {
  const app = load(); await app.commitEntries([{ path:'index.html', text:'<h1>Local fixture</h1>' }], 'html');
  app.finishOperation(); app.render();
  app.node('#reportFilename').value = 'edited report.txt'; await app.node('#reportFilename').fire('input');
  const files = app.state.files, analysis = app.state.analysis;
  for (let n = 0; n < 4; n++) { await app.node('#languageButton').click(); assertHeader(app, n % 2 ? 'en' : 'ja'); }
  assert.equal(app.state.files, files); assert.equal(app.state.analysis, analysis);
  assert.equal(app.node('#reportFilename').value, 'edited report.txt'); assert.equal(app.node('#saveReportButton').disabled, false);
});
