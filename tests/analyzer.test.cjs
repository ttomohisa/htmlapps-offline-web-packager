'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../src/offline-web-packager-core.js');

function fixtureRecords(name) {
  const root = path.join(__dirname, 'fixtures', name);
  const records = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const relative = path.relative(root, full).replace(/\\/g, '/');
        const bytes = new Uint8Array(fs.readFileSync(full));
        records.push({ path: relative, bytes, size: bytes.byteLength });
      }
    }
  }
  walk(root);
  return records;
}

function codes(result, severity = '') {
  return result.findings.filter(item => !severity || item.severity === severity).map(item => item.code);
}

async function main() {
  const expected = new Map([
    ['01-basic-inline', 'convertible'],
    ['02-static-assets', 'convertible'],
    ['03-paths-and-css', 'convertible'],
    ['04-fetch-json', 'blocked'],
    ['05-es-modules', 'blocked'],
    ['06-worker', 'blocked'],
    ['07-wasm-loader', 'blocked'],
    ['08-service-worker-pwa', 'blocked'],
    ['09-multi-page', 'blocked'],
    ['10-external-cdn', 'blocked']
  ]);

  for (const [name, status] of expected) {
    const result = await Core.analyzeProject(fixtureRecords(name), 'index.html');
    assert.equal(result.status, status, `${name} should be ${status}: ${JSON.stringify(result.findings)}`);
  }

  assert.ok(codes(await Core.analyzeProject(fixtureRecords('04-fetch-json'), 'index.html'), 'block').includes('runtime-fetch'));
  assert.ok(codes(await Core.analyzeProject(fixtureRecords('05-es-modules'), 'index.html'), 'block').includes('es-module'));
  assert.ok(codes(await Core.analyzeProject(fixtureRecords('06-worker'), 'index.html'), 'block').includes('web-worker'));
  assert.ok(codes(await Core.analyzeProject(fixtureRecords('07-wasm-loader'), 'index.html'), 'block').includes('wasm-loader'));
  const pwaCodes = codes(await Core.analyzeProject(fixtureRecords('08-service-worker-pwa'), 'index.html'), 'block');
  assert.ok(pwaCodes.includes('pwa-manifest'));
  assert.ok(pwaCodes.includes('service-worker'));
  assert.ok(codes(await Core.analyzeProject(fixtureRecords('09-multi-page'), 'index.html'), 'block').includes('multi-page-navigation'));
  assert.ok(codes(await Core.analyzeProject(fixtureRecords('10-external-cdn'), 'index.html'), 'block').includes('external-resource'));

  const missing = await Core.analyzeProject([
    { path: 'index.html', text: '<img src="missing.png">', size: 23 }
  ], 'index.html');
  assert.equal(missing.status, 'blocked');
  assert.ok(codes(missing, 'block').includes('missing-local-file'));

  const caseMismatch = await Core.analyzeProject([
    { path: 'index.html', text: '<img src="Logo.PNG">', size: 20 },
    { path: 'logo.png', bytes: new Uint8Array([1]), size: 1 }
  ], 'index.html');
  assert.equal(caseMismatch.status, 'review');
  assert.ok(codes(caseMismatch, 'warning').includes('case-mismatch'));

  const externalLink = await Core.analyzeProject([
    { path: 'index.html', text: '<a href="https://example.com/">Example</a>', size: 46 }
  ], 'index.html');
  assert.equal(externalLink.status, 'review');
  assert.ok(codes(externalLink, 'warning').includes('external-link'));

  const rootPath = Core.resolveVirtualReference('css/pages/main.css', '../../images/%E8%83%8C%E6%99%AF.svg?x=1#paint');
  assert.deepEqual(rootPath, { kind: 'local', raw: '../../images/%E8%83%8C%E6%99%AF.svg?x=1#paint', path: 'images/背景.svg' });
  const rootRelative = Core.resolveVirtualReference('index.html', '/icons/site.svg');
  assert.equal(rootRelative.path, 'icons/site.svg');

  const localLink = await Core.analyzeProject([
    { path: 'index.html', text: '<!doctype html><a href="manual.pdf">Manual</a>', size: 48 },
    { path: 'manual.pdf', bytes: new Uint8Array([37, 80, 68, 70]), size: 4 }
  ], 'index.html');
  assert.equal(localLink.status, 'blocked');
  assert.ok(localLink.findings.some(item => item.code === 'local-file-link'));

  const samePageLink = await Core.analyzeProject([
    { path: 'index.html', text: '<!doctype html><a href="index.html#details">Details</a><section id="details"></section>', size: 90 }
  ], 'index.html');
  assert.equal(samePageLink.status, 'convertible', JSON.stringify(samePageLink.findings));

  console.log('[OK] Analyzer tests passed: fixtures 01–03 convertible, 04–10 blocked with reasons, warnings and path resolution.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
