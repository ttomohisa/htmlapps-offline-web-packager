'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.template.html'), 'utf8');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app.config.json'), 'utf8'));
const favicon = fs.readFileSync(path.join(__dirname, '..', 'assets', 'favicon.svg'), 'utf8');

assert.match(config.version, /^\d+\.\d+\.\d+$/);
assert.match(favicon, /#16624f/);
assert.doesNotMatch(favicon, /#036a53/i);

for (let step = 1; step <= 4; step += 1) {
  assert.match(source, new RegExp(`id="workflowStep${step}"`), `workflow step ${step} missing`);
}
assert.match(source, /id="mobileActionBar"/);
assert.match(source, /env\(safe-area-inset-bottom\)/);
assert.match(source, /id="statusAnnouncer"[^>]*aria-live="polite"/);
assert.match(source, /id="resultTitle" tabindex="-1"/);
assert.match(source, /id="outputTitle" tabindex="-1"/);
assert.match(source, /id="errorPanel"[^>]*tabindex="-1"/);
assert.match(source, /\.header-inner \{ width:min\(1180px,100%\);/);
assert.match(source, /\.brand-meta \{ display:none; \}/);
assert.match(source, /class="icon-button header-icon-button" id="helpButton"/);
assert.match(source, /dialog\[open\] \{ display:flex; flex-direction:column; \}/);
assert.match(source, /id="chooseHtmlButton" data-kind="html"/);
assert.match(source, /id="chooseZipButton" data-kind="zip"/);
assert.match(source, /viewBox="0 0 32 32"/);
assert.match(source, /data-kind="zip"[^>]*>[\s\S]*?currentColor/);
assert.doesNotMatch(source, /data-kind="zip"[^\n]*#6d5b2a/);
assert.match(source, /id="dropzone"[^>]*role="button"[^>]*tabindex="0"/);
assert.match(source, /class="quick-guide"/);
assert.doesNotMatch(source, /gradient/i);
assert.match(source, /id="quickInput"[^>]*accept="\.html,\.htm,\.zip/);
assert.match(source, /\.output-verification > svg \{ width:22px; height:22px;/);
assert.ok(source.includes(`helpVersionNote:"v${config.version}`), 'help version must match the app config');
assert.match(source, /mobileOutputTitle/);
assert.match(source, /mobilePackagingTitle/);
assert.match(source, /function renderWorkflow\(\)/);
assert.match(source, /function renderMobileAction\(\)/);

console.log('[OK] UX tests passed: workflow, mobile actions, focus/live regions, touch targets, dialog behavior, and refreshed input icons are present.');

require('./diagnostic-report.test.cjs')().catch(error => { console.error(error); process.exitCode = 1; });
