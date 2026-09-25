'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../src/offline-web-packager-core.js');

async function main() {
  assert.equal(Core.normalizeVirtualPath('a\\b/./c.html'), 'a/b/c.html');
  assert.throws(() => Core.normalizeVirtualPath('../escape.txt'), error => error.code === 'path-traversal');
  assert.throws(() => Core.assertSafeArchivePath('/absolute.txt'), error => error.code === 'zip-path-absolute');
  assert.throws(() => Core.assertSafeArchivePath('C:\\escape.txt'), error => error.code === 'zip-path-absolute');
  assert.throws(() => Core.assertSafeArchivePath('%2e%2e/escape.txt'), error => error.code === 'zip-path-traversal');

  const detection = Core.detectStartHtml(['pages/help.html', 'index.html', 'pages/index.html']);
  assert.equal(detection.selected, 'index.html');
  assert.equal(detection.reason, 'root-index');

  const zipRoot = path.join(__dirname, 'fixture-zips');
  const fixtureNames = fs.readdirSync(zipRoot).filter(name => /^\d\d-.*\.zip$/.test(name) && !name.startsWith('99-')).sort();
  assert.equal(fixtureNames.length, 10, 'Expected fixture ZIPs 01–10');

  for (const name of fixtureNames) {
    const bytes = new Uint8Array(fs.readFileSync(path.join(zipRoot, name)));
    const files = await Core.readZip(bytes);
    assert.ok(files.length >= 1, `${name} should contain files`);
    assert.ok(files.every(file => !file.path.startsWith(name.replace(/\.zip$/, '') + '/')), `${name} common root should be stripped`);
    const start = Core.detectStartHtml(files.map(file => file.path));
    assert.ok(start.selected, `${name} should have a start HTML candidate`);
    assert.ok(start.candidates.includes('index.html'), `${name} should expose index.html at virtual root`);
  }

  const malicious = new Uint8Array(fs.readFileSync(path.join(zipRoot, '99-path-traversal.zip')));
  await assert.rejects(() => Core.readZip(malicious), error => error && error.code === 'zip-path-traversal');

  const sample = new TextEncoder().encode('123456789');
  assert.equal(Core.crc32(sample), 0xcbf43926);

  console.log('[OK] Foundation tests passed: path normalization, fixtures 01–10, ZIP traversal rejection, CRC32.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
