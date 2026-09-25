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
  for (const fixture of ['01-basic-inline', '02-static-assets', '03-paths-and-css']) {
    const packaged = await Core.packageProject(fixtureRecords(fixture), 'index.html');
    assert.equal(packaged.verification.status, 'verified', `${fixture}: ${JSON.stringify(packaged.verification.findings)}`);
    assert.equal(packaged.verification.counts.block, 0);
    assert.equal(packaged.verification.counts.warning, 0);
  }

  const fixtureTwo = await Core.packageProject(fixtureRecords('02-static-assets'), 'index.html');
  const corruptedHtml = fixtureTwo.html.replace(/data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+/, 'assets/missing-logo.svg');
  const corrupted = await Core.verifyPackagedHtml(corruptedHtml, fixtureTwo.filename, {
    sourceAnalysis: fixtureTwo.analysis,
    embeddedFiles: fixtureTwo.embeddedFiles
  });
  assert.equal(corrupted.status, 'blocked');
  assert.ok(corrupted.findings.some(item => item.code === 'missing-local-file'));

  const css = Buffer.from('.hero{background:url("../images/missing.png")}').toString('base64');
  const cssBroken = await Core.verifyPackagedHtml(
    `<!doctype html><link rel="stylesheet" href="data:text/css;charset=utf-8;base64,${css}"><main>Test</main>`,
    'index-offline.html'
  );
  assert.equal(cssBroken.status, 'blocked');
  assert.ok(cssBroken.findings.some(item => item.code === 'generated-css-unresolved-reference'));

  const linkedLocal = await Core.verifyPackagedHtml('<!doctype html><a href="manual.pdf">Manual</a>', 'index-offline.html');
  assert.equal(linkedLocal.status, 'blocked');
  assert.ok(linkedLocal.findings.some(item => item.code === 'generated-local-link-reference'));

  const samePageRecords = [{ path: 'index.html', text: '<!doctype html><a href="index.html#details">Details</a><section id="details">OK</section>', size: 90 }];
  const samePage = await Core.packageProject(samePageRecords, 'index.html');
  assert.match(samePage.html, /href="#details"/);
  assert.equal(samePage.verification.status, 'verified');

  const coverageBroken = await Core.verifyPackagedHtml('<!doctype html><main>Test</main>', 'index-offline.html', {
    sourceAnalysis: {
      entryHtml: 'index.html',
      dependencies: [{ from: 'index.html', requested: 'assets/app.js', actual: 'assets/app.js', kind: 'script' }]
    },
    embeddedFiles: []
  });
  assert.equal(coverageBroken.status, 'blocked');
  assert.ok(coverageBroken.findings.some(item => item.code === 'generated-dependency-not-embedded'));

  console.log('[OK] Verification tests passed: generated HTML is reanalyzed, embedded CSS is checked, and missed dependencies block output.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
