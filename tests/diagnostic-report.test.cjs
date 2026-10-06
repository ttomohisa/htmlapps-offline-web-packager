'use strict';
const assert = require('node:assert/strict');
const loadApp = require('./helpers/app-harness.cjs');

async function checkReports() {
  const app = loadApp({sourcePath:process.env.APP_TEST_HTML});
  assert.match(app.source, /label for="reportFilename"/);
  assert.match(app.source, /id="saveReportButton"[^>]*disabled/);
  assert.equal(app.node('#saveReportButton').disabled, true, 'no analysis cannot export');
  assert.equal(app.blobs.length, 0);
  const marker = 'PRIVATE_SOURCE_BODY_DO_NOT_EXPORT';
  async function load(html, name = 'index.html') {
    await app.commitEntries([{ path:name, text:html }], 'html');
    app.finishOperation(); app.render();
  }
  await load(`<h1>${marker}</h1>\n<script>\nfetch("a.json");\n</script>`);
  assert.equal(app.state.analysis.status, 'blocked');
  assert.equal(app.node('#saveReportButton').disabled, false, 'blocked input can save report');
  assert.equal(app.node('#reportFilename').value, 'index-check-report.txt');
  app.node('#reportFilename').value = 'my custom report.txt';
  await app.node('#reportFilename').fire('input');
  await app.node('#languageButton').fire('click');
  assert.equal(app.node('#reportFilename').value, 'my custom report.txt', 'language changes preserve edits');
  await app.node('#saveReportButton').click();
  assert.equal(app.downloads.at(-1).download, 'my custom report.txt');
  assert.equal(app.blobs.at(-1).type, 'text/plain;charset=utf-8');
  const japanese = await app.blobs.at(-1).text();
  assert.match(japanese, /このままでは1ファイルにできません/);
  assert.match(japanese, /code: runtime-fetch/);
  assert.match(japanese, /file: index.html\nline: 3/);
  assert.match(japanese, /マルウェアスキャナー/);
  assert.doesNotMatch(japanese, new RegExp(marker));
  assert.doesNotMatch(japanese, /fetch\("a.json"\)/);
  const cleanup = app.timers.find(timer => timer.delay === 1500);
  assert.ok(cleanup); cleanup.callback();
  assert.ok(app.revoked.includes('blob:test-1'));

  await app.node('#languageButton').fire('click');
  await app.node('#saveReportButton').click();
  const english = await app.blobs.at(-1).text();
  assert.match(english, /Cannot be made into one file as-is/);
  assert.match(english, /Blocking reasons: 1/);
  assert.match(english, /Review items: 0/);
  assert.match(english, /not a malware scanner/);
  assert.match(english, /runtime-fetch/);
  assert.equal(app.state.savedOnce, false, 'report export does not complete HTML save workflow');

  await load('<h1>Local</h1>', 'folder/start.htm');
  assert.equal(app.node('#reportFilename').value, 'start-check-report.txt', 'new source resets name');
  await app.node('#saveReportButton').click();
  assert.match(await app.blobs.at(-1).text(), /Can be combined/);
  assert.match(await app.blobs.at(-1).text(), /Start HTML: folder\/start.htm/);
  assert.match(await app.blobs.at(-1).text(), /no unresolved local file reference/);

  await load('<a href="https://example.com/">Local</a>');
  assert.equal(app.state.analysis.status, 'review');
  await app.node('#saveReportButton').click();
  const review = await app.blobs.at(-1).text();
  assert.match(review, /Review needed/);
  assert.match(review, /target: https:\/\/example.com\//);
  assert.match(review, /Review items: 1/);

  await app.commitEntries([
    {path:'index.html',text:`<meta http-equiv="Content-Security-Policy" content="script-src 'none'">\n<img src="LOGO.PNG">\n<script>fetch("x");</script>\n<object data="missing.bin"></object>`},
    {path:'logo.png',bytes:new Uint8Array([1]),size:1}
  ], 'folder');
  app.finishOperation(); app.render();
  await app.node('#saveReportButton').click();
  const multiple = await app.blobs.at(-1).text();
  assert.ok(app.state.analysis.findings.length >= 4);
  for (const finding of app.state.analysis.findings) {
    assert.ok(multiple.includes(app.findingCopy(finding).title));
    assert.ok(multiple.includes(app.findingCopy(finding).body));
    assert.ok(multiple.includes(app.findingDetail(finding)), `all technical fields exported: ${finding.code}`);
  }
  assert.ok(multiple.indexOf('code: runtime-fetch') < multiple.indexOf('code: case-mismatch'), 'blocking findings precede review findings as in UI');

  await load('<img src="missing<script.png">');
  await app.node('#saveReportButton').click();
  assert.equal(app.blobs.at(-1).type, 'text/plain;charset=utf-8', 'source-like fields remain text');
  assert.match(await app.blobs.at(-1).text(), /missing-local-file/);
  assert.match(await app.blobs.at(-1).text(), /target: missing<script\.png/);
  assert.equal(app.downloads.at(-1).target, undefined);

  for (const [entered, expected] of [
    ['../bad\\name:<x>?*.TXT', 'badnamex.txt'], ['\u0000\r\n/\\:*?"<>|', 'index-check-report.txt'],
    ['notes.html', 'notes.html.txt'], [' .. ', 'index-check-report.txt'], ['CON.txt', '_CON.txt'], [' report... ', 'report.txt']
  ]) {
    app.node('#reportFilename').value = entered;
    await app.node('#reportFilename').fire('input');
    await app.node('#saveReportButton').click();
    assert.equal(app.downloads.at(-1).download, expected, `sanitize ${JSON.stringify(entered)}`);
  }

  for (const target of [
    `data:text/html,${marker}`, `DATA:application/octet-stream;base64,${Buffer.from(marker).toString('base64')}`,
    `javascript:console.log('${marker}')`, `vbscript:${marker}`,
    `data&#58;text/html,${marker}`, `&#x64;ata&colon;text/html,${marker}`,
    `d\tata:text/html,${marker}`, `java\nscript:${marker}`, `java&NewLine;script&colon;${marker}`,
    `d&#97;ta&#x3a;text/html,${marker}`, `d&Tab;ata:${marker}`
  ]) {
    await load(`<object data="${target}"></object>`);
    await app.node('#saveReportButton').click();
    const report = await app.blobs.at(-1).text();
    assert.doesNotMatch(report, new RegExp(marker));
    assert.doesNotMatch(report, new RegExp(Buffer.from(marker).toString('base64')));
    assert.match(report, /payload omitted/i, 'inline target payload must be explicitly redacted');
    assert.match(report, /unsupported-embedded-object/);
  }

  app.node('#reportFilename').value = '猫'.repeat(180);
  await app.node('#reportFilename').fire('input');
  await app.node('#saveReportButton').click();
  assert.ok(Buffer.byteLength(app.downloads.at(-1).download) <= 244, 'multibyte report names must fit common filesystem limits');
  assert.ok(!app.downloads.at(-1).download.includes('�'), 'Unicode code points must not be split');

  const beforeBusy = app.blobs.length;
  const controller = app.createOperation('Reading', 'reading', true);
  assert.equal(app.node('#saveReportButton').disabled, true);
  await app.node('#saveReportButton').click();
  assert.equal(app.blobs.length, beforeBusy);
  controller.abort(); app.finishOperation(controller); app.render();
  assert.equal(app.node('#saveReportButton').disabled, true, 'cancelled replacement must not revive old report');
  await app.node('#saveReportButton').click();
  assert.equal(app.blobs.length, beforeBusy);

  await load('<p>New report</p>');
  app.AppConfirm.ask = async () => true;
  await app.loadZipFile({name:'broken.zip',size:1,arrayBuffer:async()=>new ArrayBuffer(1)});
  assert.equal(app.node('#saveReportButton').disabled, true, 'failed replacement must not revive old report');
  assert.equal(app.state.files.size, 1, 'cancelled/failed ZIP retains original input');

  await load('<p>Clear me</p>');
  await app.node('#clearButton').click();
  assert.equal(app.node('#saveReportButton').disabled, true);
  assert.equal(app.node('#reportFilename').value, '');

  await app.commitEntries([{path:'index.html',text:'<p>A</p>'},{path:'other.html',text:'<script>\nfetch("b");\n</script>'}], 'folder');
  app.finishOperation(); app.render();
  const realAnalyze = app.Core.analyzeProject;
  let resolveOld;
  app.Core.analyzeProject = (...args) => new Promise(resolve => { resolveOld = async () => resolve(await realAnalyze(...args)); });
  app.node('#entryHtmlSelect').value = 'other.html';
  await app.node('#entryHtmlSelect').fire('change');
  assert.equal(app.node('#saveReportButton').disabled, true, 'entry change disables old analysis immediately');
  assert.equal(app.node('#reportFilename').value, 'other-check-report.txt');
  app.Core.analyzeProject = realAnalyze;
  await app.commitEntries([{path:'new.html',text:'<h1>Newer input</h1>'}], 'html');
  app.finishOperation(); app.render();
  await resolveOld(); await Promise.resolve();
  await app.node('#saveReportButton').click();
  assert.match(await app.blobs.at(-1).text(), /Start HTML: new.html/);
  assert.doesNotMatch(await app.blobs.at(-1).text(), /other.html/);

  const fallback = loadApp({anchorDownload:false});
  await fallback.commitEntries([{path:'index.html',text:'<p>Plain</p>'}], 'html');
  fallback.finishOperation(); fallback.render();
  await fallback.node('#saveReportButton').click();
  assert.equal(fallback.blobs[0].type, 'text/plain;charset=utf-8');
  assert.equal(fallback.downloads[0].target, '_blank');
  assert.equal(fallback.downloads[0].rel, 'noopener');
  fallback.timers.find(timer=>timer.delay===60000).callback();
  assert.equal(fallback.revoked.length, 1);

  const unsupported = loadApp({blobUrl:false});
  await unsupported.commitEntries([{path:'index.html',text:'<p>Plain</p>'}], 'html');
  unsupported.finishOperation(); unsupported.render();
  assert.equal(unsupported.node('#saveReportButton').disabled, true);
  await unsupported.node('#saveReportButton').click();
  assert.equal(unsupported.blobs.length, 0);
  console.log('[OK] Diagnostic reports: JA/EN, all statuses, text-only local downloads, filenames, revision guards, failed/cancelled replacement, clear, fallback, cleanup.');
}
module.exports = checkReports;
if (require.main === module) checkReports().catch(error => { console.error(error); process.exitCode = 1; });
