'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../src/offline-web-packager-core.js');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src', 'index.template.html'), 'utf8');
const config = JSON.parse(fs.readFileSync(path.join(root, 'app.config.json'), 'utf8'));
const smoke = fs.readFileSync(path.join(root, 'tests', 'browser-smoke.html'), 'utf8');

assert.equal(config.version, '1.0.0');
assert.equal(typeof Core.supportsDeflateRaw, 'function');
assert.equal(Core.supportsDeflateRaw(), true, 'current Node runtime should support deflate-raw for the ZIP regression fixture');
const originalDecompressionStream = globalThis.DecompressionStream;
try {
  globalThis.DecompressionStream = undefined;
  assert.equal(Core.supportsDeflateRaw(), false, 'missing DecompressionStream must be detected without throwing');
} finally {
  globalThis.DecompressionStream = originalDecompressionStream;
}

assert.match(source, /typeof item\.getAsEntry==='function'/, 'future getAsEntry() path is missing');
assert.match(source, /typeof item\.webkitGetAsEntry==='function'/, 'webkitGetAsEntry() fallback is missing');
assert.match(source, /function directDroppedFiles\(dataTransfer\)/, 'direct File fallback for dropped files is missing');
assert.match(source, /if \(!hasDirectory\) \{[\s\S]*?directDroppedFiles\(dataTransfer\)/, 'plain dropped files must bypass FileSystemFileEntry.file()');
assert.match(source, /folder-drop-file-protocol-unsupported/, 'file:// folder drop fallback is missing');
assert.match(source, /'webkitdirectory' in folderInput/, 'folder picker capability detection is missing');
assert.match(source, /'webkitRelativePath' in File\.prototype/, 'relative folder path capability detection is missing');
assert.match(source, /Core\.supportsDeflateRaw\(\)/, 'deflate-raw capability detection is missing');
assert.match(source, /'download' in anchor/, 'download-attribute feature detection is missing');
assert.match(source, /a\.target='_blank'/, 'save fallback for browsers without download attribute is missing');
assert.match(source, /folder-relative-path-unsupported/, 'folder relative-path guard is missing');
assert.match(source, /id="folderSupportStatus"/);
assert.match(source, /id="zipSupportStatus"/);
assert.match(source, /id="saveSupportStatus"/);
assert.match(source, /helpVersionNote:"v1\.0\.0/);

assert.match(smoke, /Offline Web Packager Browser Smoke Lab/);
assert.match(smoke, /file:\/\//);
assert.match(smoke, /supportsDeflateRaw/);
assert.match(smoke, /packageProject/);
assert.match(smoke, /webkitdirectory/);
assert.match(smoke, /webkitGetAsEntry|getAsEntry/);

console.log('[OK] Cross-browser regression checks passed: capability detection, folder/drop fallbacks, ZIP support probe, save fallback, and browser smoke lab are present.');
