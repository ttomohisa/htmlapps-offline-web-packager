'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const loadApp = require('./helpers/app-harness.cjs');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/index.template.html'), 'utf8');
const style = source.match(/<style>([\s\S]*?)<\/style>/)[1];

function rulesFor(selector) {
  return [...style.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(match => match[1].split(',').some(item => item.trim() === selector))
    .map(match => Object.fromEntries(match[2].split(';').filter(item => item.trim()).map(item => {
      const colon = item.indexOf(':');
      return [item.slice(0, colon).trim(), item.slice(colon + 1).trim()];
    })));
}

test('only a modal dialog locks both background scroll containers', () => {
  for (const selector of ['html:has(dialog:modal)', 'body:has(dialog:modal)']) {
    const rule = rulesFor(selector)[0];
    assert.ok(rule, `${selector} must lock background scrolling while Help or confirmation is modal`);
    assert.equal(rule.overflow, 'hidden');
    assert.equal(rule['overscroll-behavior'], 'none');
  }
  assert.equal(rulesFor('html:has(dialog[open])').length, 0, 'nonmodal dialogs must not lock the background');
  assert.equal(rulesFor('body:has(dialog[open])').length, 0, 'nonmodal dialogs must not lock the background');
});

test('confirmation header keeps its height while the body owns overflow', () => {
  const header = rulesFor('.app-confirm-dialog .dialog-header')[0];
  assert.ok(header, 'confirmation header needs a fixed flex allocation');
  assert.equal(header.flex, '0 0 auto');
  const body = rulesFor('.app-confirm-body')[0];
  assert.equal(body.flex, '1 1 auto');
  assert.equal(body['min-height'], '0');
  assert.equal(body.overflow, 'auto', 'message and both actions must remain reachable by body scrolling');
  assert.equal(body['overscroll-behavior'], 'contain');
  assert.ok(rulesFor('.app-confirm-body').some(rule => /env\(safe-area-inset-bottom\)/.test(rule['padding-bottom'] || '')), 'mobile confirmation needs bottom safe-area space');
});

test('existing bounded dialog shell and independently scrolling Help are preserved', () => {
  assert.equal(rulesFor('dialog[open]')[0].display, 'flex');
  assert.equal(rulesFor('dialog[open]')[0]['flex-direction'], 'column');
  assert.ok(rulesFor('dialog').every(rule => /100dvh/.test(rule['max-height'])), 'desktop and mobile shells must remain viewport bounded');
  const help = rulesFor('.dialog-body')[0];
  assert.equal(help['min-height'], '0');
  assert.equal(help.overflow, 'auto');
  assert.equal(help['overscroll-behavior'], 'contain');
  const confirm = source.match(/<dialog class="app-confirm-dialog"[\s\S]*?<\/dialog>/)[0];
  assert.match(confirm, /class="app-confirm-body"[\s\S]*id="appConfirmMessage"[\s\S]*id="appConfirmCancel"[\s\S]*id="appConfirmOk"/);
});

test('local-processing badge retains its existing accessible decorative shield', () => {
  const badge = source.match(/<div class="local-badge">([\s\S]*?)<\/div>/)[1];
  assert.match(badge, /<svg[^>]*aria-hidden="true"/);
  assert.match(badge, /M12 3 5 6v5c0 4\.6 2\.8 8 7 10/);
  assert.match(badge, /data-i18n="localBadge"/);
});

test('canonical repository check runs the layout regression and fails closed', () => {
  const checker = fs.readFileSync(path.join(root, 'scripts/check-repository.ps1'), 'utf8');
  assert.match(checker, /"tests\\dialog-layout\.test\.cjs"/);
  assert.match(checker, /& node \(Join-Path \$Root "tests\\dialog-layout\.test\.cjs"\)/);
  assert.match(checker, /if \(\$LASTEXITCODE -ne 0\) \{ throw "Dialog layout regression failed\." \}/);
});

for (const language of ['ja', 'en']) {
  test(`${language}: shared confirmation keeps Cancel, Close, Escape, clear and discard behavior`, async () => {
    const app = loadApp({ language });
    await app.commitEntries([{ path:'index.html', text:'<h1>Local layout fixture</h1>' }], 'html');
    app.finishOperation(); app.render();
    const files = app.state.files;
    for (const action of ['cancel', 'close', 'escape']) {
      const pending = app.node('#clearButton').click();
      assert.equal(app.node('#appConfirmDialog').open, true);
      if (action === 'escape') await app.node('#appConfirmDialog').fire('cancel');
      else await app.node(action === 'cancel' ? '#appConfirmCancel' : '#appConfirmClose').click();
      await pending;
      assert.equal(app.node('#appConfirmDialog').open, false);
      assert.equal(app.state.files, files);
      assert.equal(app.state.files.size, 1);
    }
    await app.node('#createHtmlButton').click();
    const output = app.state.output;
    assert.ok(output?.html, 'actual local packaging still produces HTML');
    let pending = app.node('#releaseOutputButton').click();
    await app.node('#appConfirmCancel').click(); await pending;
    assert.equal(app.state.output, output, 'Cancel keeps the generated HTML');
    pending = app.node('#releaseOutputButton').click();
    await app.node('#appConfirmOk').click(); await pending;
    assert.equal(app.state.output, null);
    assert.equal(app.state.files, files, 'discard keeps the input loaded');
    pending = app.node('#clearButton').click();
    await app.node('#appConfirmOk').click(); await pending;
    assert.equal(app.state.files.size, 0);
    await app.node('#helpButton').click();
    assert.equal(app.node('#helpDialog').open, true);
    await app.node('#closeHelpButton').click();
    assert.equal(app.node('#helpDialog').open, false);
    await app.node('#helpButton').click();
    await app.node('#helpDialog').fire('cancel');
    assert.equal(app.node('#helpDialog').open, false);
  });
}
