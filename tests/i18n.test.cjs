'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.template.html'), 'utf8');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app.config.json'), 'utf8'));
assert.equal(config.version, '1.0.0');

const match = source.match(/const translations = (\{[\s\S]*?\n      \});/);
assert.ok(match, 'translations object was not found');
const translations = vm.runInNewContext(`(${match[1]})`, Object.create(null));
assert.ok(translations.ja && translations.en, 'Japanese and English translations are required');

const keys = new Set();
for (const attribute of ['data-i18n', 'data-i18n-title', 'data-i18n-aria-label']) {
  const regex = new RegExp(`${attribute}="([^"]+)"`, 'g');
  let item;
  while ((item = regex.exec(source)) !== null) keys.add(item[1]);
}

for (const key of keys) {
  assert.ok(Object.hasOwn(translations.ja, key), `Japanese translation missing: ${key}`);
  assert.ok(Object.hasOwn(translations.en, key), `English translation missing: ${key}`);
  assert.notEqual(String(translations.ja[key]).trim(), '', `Japanese translation empty: ${key}`);
  assert.notEqual(String(translations.en[key]).trim(), '', `English translation empty: ${key}`);
}

assert.equal(source.toLowerCase().includes('gradient'), false, 'release UI must not contain gradients');
console.log(`[OK] i18n tests passed: ${keys.size} UI keys are available in Japanese and English; release UI has no gradients.`);
