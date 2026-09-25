'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../src/offline-web-packager-core.js');

async function main() {
  assert.equal(Core.DEFAULT_LIMITS.maxFiles, 2000);
  assert.equal(Core.DEFAULT_LIMITS.maxTotalBytes, 100 * 1024 * 1024);
  assert.equal(Core.DEFAULT_LIMITS.maxSingleBytes, 50 * 1024 * 1024);

  const exactFifty = 50 * 1024 * 1024;
  Core.assertInputLimits([
    { path: 'a.bin', size: exactFifty },
    { path: 'b.bin', size: exactFifty }
  ]);

  assert.throws(
    () => Core.assertInputLimits([{ path: 'too-large.bin', size: exactFifty + 1 }]),
    error => error && error.code === 'file-too-large'
  );

  assert.throws(
    () => Core.assertInputLimits([
      { path: 'a.bin', size: exactFifty },
      { path: 'b.bin', size: exactFifty },
      { path: 'c.bin', size: 1 }
    ]),
    error => error && error.code === 'input-too-large'
  );

  const many = Array.from({ length: 2001 }, (_, index) => ({ path: `f-${index}.txt`, size: 0 }));
  assert.throws(
    () => Core.assertInputLimits(many),
    error => error && error.code === 'too-many-files'
  );

  const zipBytes = new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixture-zips', '02-static-assets.zip')));
  const progress = [];
  const files = await Core.readZip(zipBytes, { onProgress: info => progress.push(info.stage) });
  assert.ok(progress.includes('zip-index'));
  assert.ok(progress.includes('zip-extract'));
  assert.equal(files.length, 7);

  await assert.rejects(
    () => Core.readZip(zipBytes, { maxEntries: 3 }),
    error => error && error.code === 'zip-too-many-files'
  );

  await assert.rejects(
    () => Core.readZip(zipBytes, { maxSingleUncompressed: 100 }),
    error => error && error.code === 'zip-entry-too-large'
  );

  await assert.rejects(
    () => Core.readZip(zipBytes, { signal: { aborted: true } }),
    error => error && error.code === 'operation-cancelled'
  );

  const records = files.map(file => ({ path: file.path, bytes: file.bytes, size: file.size }));
  const analysisProgress = [];
  const analysis = await Core.analyzeProject(records, 'index.html', { onProgress: info => analysisProgress.push(info.stage) });
  assert.equal(analysis.status, 'convertible');
  assert.ok(analysisProgress.includes('analyze-scan'));

  await assert.rejects(
    () => Core.analyzeProject(records, 'index.html', { signal: { aborted: true } }),
    error => error && error.code === 'operation-cancelled'
  );

  const packageProgress = [];
  const output = await Core.packageProject(records, 'index.html', {
    analysis,
    onProgress: info => packageProgress.push(info.stage)
  });
  assert.ok(output.html.includes('data:'));
  assert.ok(packageProgress.includes('package-embed'));
  assert.ok(packageProgress.includes('package-verify'));
  assert.ok(packageProgress.includes('package-done'));

  await assert.rejects(
    () => Core.packageProject(records, 'index.html', { analysis, signal: { aborted: true } }),
    error => error && error.code === 'operation-cancelled'
  );

  console.log('[OK] Performance tests passed: input limits, ZIP guards, progress reporting, cancellation, and packaging progress.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
