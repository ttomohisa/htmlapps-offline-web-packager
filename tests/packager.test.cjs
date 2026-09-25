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

async function main() {
  const one = await Core.packageProject(fixtureRecords('01-basic-inline'), 'index.html');
  assert.equal(one.filename, 'index-offline.html');
  assert.match(one.html, /Fixture 01/);
  assert.match(one.html, /dataset\.ready='yes'/);
  assert.equal(one.analysis.status, 'convertible');

  const two = await Core.packageProject(fixtureRecords('02-static-assets'), 'index.html');
  assert.equal(two.analysis.status, 'convertible');
  assert.ok(two.embeddedFiles.includes('assets/style.css'));
  assert.ok(two.embeddedFiles.includes('assets/app.js'));
  assert.ok(two.embeddedFiles.includes('assets/logo.svg'));
  assert.ok(two.embeddedFiles.includes('assets/bg.svg'));
  assert.ok(two.embeddedFiles.includes('assets/fixture.woff2'));
  assert.ok(two.embeddedFiles.includes('assets/icon.svg'));
  assert.match(two.html, /data:text\/css;charset=utf-8;base64,/);
  assert.match(two.html, /data:text\/javascript;charset=utf-8;base64,/);
  assert.match(two.html, /data:image\/svg\+xml;base64,/);
  assert.doesNotMatch(two.html, /(?:src|href)=["']assets\//i);
  assert.doesNotMatch(two.html, /url\(["']?assets\//i);

  const three = await Core.packageProject(fixtureRecords('03-paths-and-css'), 'index.html');
  assert.equal(three.analysis.status, 'convertible');
  for (const expected of [
    'css/pages/main.css', 'css/theme/base.css', 'fonts/local.woff2', 'icons/site.svg',
    'images/猫.png', 'images/猫@2x.png', 'images/背景.svg', 'js/app.js'
  ]) assert.ok(three.embeddedFiles.includes(expected), `fixture 03 should embed ${expected}`);
  assert.doesNotMatch(three.html, /@import\b/i);
  assert.doesNotMatch(three.html, /(?:src|href)=["'](?:css|js|images|icons)\//i);
  assert.doesNotMatch(three.html, /url\(["']?(?:\.\.\/|\/|images\/|fonts\/|css\/)/i);
  const cssData = three.html.match(/href="data:text\/css;charset=utf-8;base64,([^"]+)"/i);
  assert.ok(cssData, 'fixture 03 should contain embedded CSS');
  const decodedCss = Buffer.from(cssData[1], 'base64').toString('utf8');
  assert.match(decodedCss, /data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+#paint/);
  assert.match(three.html, /data:image\/png;base64,[A-Za-z0-9+/=]+ 1x, data:image\/png;base64,[A-Za-z0-9+/=]+ 2x/);

  const media = await Core.packageProject([
    { path: 'index.html', text: '<!doctype html><video src=\"clip.mp4\" poster=\"poster.png\"></video><audio src=\"tone.mp3\"></audio>', size: 99 },
    { path: 'clip.mp4', bytes: new Uint8Array([0, 1, 2, 3]), size: 4 },
    { path: 'poster.png', bytes: new Uint8Array([137, 80, 78, 71]), size: 4 },
    { path: 'tone.mp3', bytes: new Uint8Array([73, 68, 51]), size: 3 }
  ], 'index.html');
  assert.match(media.html, /data:video\/mp4;base64,/);
  assert.match(media.html, /data:audio\/mpeg;base64,/);
  assert.match(media.html, /data:image\/png;base64,/);

  const blocked = fixtureRecords('04-fetch-json');
  await assert.rejects(() => Core.packageProject(blocked, 'index.html'), error => error && error.code === 'package-not-convertible');
  await assert.rejects(() => Core.packageProject([{ path: 'index.html', text: '<a href=\"https://example.com\">x</a>', size: 41 }], 'index.html'), error => error && error.code === 'package-not-convertible');

  const outDir = path.join(__dirname, 'generated');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'fixture-01.html'), one.html);
  fs.writeFileSync(path.join(outDir, 'fixture-02.html'), two.html);
  fs.writeFileSync(path.join(outDir, 'fixture-03.html'), three.html);

  console.log('[OK] Core packager tests passed: fixtures 01, 02 and 03 generated as self-contained HTML; blocked input refused.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
