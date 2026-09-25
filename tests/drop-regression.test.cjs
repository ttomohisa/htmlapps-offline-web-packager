'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src', 'index.template.html'), 'utf8');
const config = JSON.parse(fs.readFileSync(path.join(root, 'app.config.json'), 'utf8'));

assert.equal(config.version, '1.0.0');
assert.match(source, /id="dropzone"[^>]*role="button"[^>]*tabindex="0"/);
assert.match(source, /id="quickInput"[^>]*accept="\.html,\.htm,\.zip/);
assert.match(source, /dropzone\.addEventListener\('click',[\s\S]*?quickInput\.click\(\)/);
assert.match(source, /dropzone\.addEventListener\('keydown',[\s\S]*?event\.key!=='Enter'[\s\S]*?event\.key!==' '/);
assert.match(source, /const hasDirectory=droppedEntries\.some\(entry=>entry\.isDirectory\);/);
assert.match(source, /if \(!hasDirectory\) \{[\s\S]*?const files=directDroppedFiles\(dataTransfer\);[\s\S]*?return loadHtmlFile\(normalized\[0\]\.file\);/);
assert.match(source, /FileSystemFileEntry\.file\(\) can fail when this standalone app is opened via file:\/\//);
assert.match(source, /\.output-verification > svg \{ width:22px; height:22px;/);
assert.match(source, /\.output-note \{ flex:1 1 430px;/);

console.log('[OK] Drop regression checks passed: direct files bypass legacy FileEntry.file(), dropzone click/keyboard selection is wired, and output verification SVG is constrained.');
