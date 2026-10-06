'use strict';
const assert = require('node:assert/strict');
const Core = require('../src/offline-web-packager-core.js');

async function checkLocations() {
  const fixtures = [
    ['multiline body', '<!doctype html>\n<html>\n<head></head>\n<body>\n<script>\n// not executed\n\nfetch("data.json");\n</script>\n</body>', [['runtime-fetch', 8]]],
    ['multiple blocks', '<html>\n<script>\nfetch("a");\n</script>\n<p>Static</p>\n<script>\n// comment\nnew Worker("b.js");\n</script>', [['runtime-fetch', 3], ['web-worker', 8]]],
    ['same line', '<html>\n<script>fetch("a");</script>', [['runtime-fetch', 2]]],
    ['multiline opening tag', '<html>\n<script\n type="text/javascript"\n>\nfetch("a");\n</script>', [['runtime-fetch', 5]]],
    ['module prefix', '<html>\n<script>\n// comment\n\n  import value from "./a.js";\n</script>', [['es-module-syntax', 5]]],
    ['export prefix', '<html>\n<script>\n// comment\n  export const value = 1;\n</script>', [['es-module-syntax', 4]]]
  ];
  for (const [name, html, expected] of fixtures) {
    for (const newline of ['\n', '\r\n']) {
      const records = [{ path:'index.html', text:html.replace(/\n/g, newline) }];
      const result = await Core.analyzeProject(records, 'index.html');
      assert.equal(result.status, 'blocked', name);
      for (const [code, line] of expected) {
        const finding = result.findings.find(item => item.code === code);
        assert.ok(finding, `${name}: ${code}`);
        assert.equal(finding.path, 'index.html');
        assert.equal(finding.line, line, `${name} (${JSON.stringify(newline)}): ${code} must point to the statement`);
      }
      await assert.rejects(Core.packageProject(records, 'index.html'), error => error.code === 'package-not-convertible');
    }
  }
  const external = await Core.analyzeProject([
    { path:'index.html', text:'<script src="app.js"></script>' },
    { path:'app.js', text:'// not executed\n\n// still static\nfetch("data.json");' }
  ], 'index.html');
  assert.equal(external.findings.find(item => item.code === 'runtime-fetch').line, 4);
  assert.equal(external.findings.find(item => item.code === 'runtime-fetch').path, 'app.js');
  const plain = await Core.analyzeProject([{ path:'index.html', text:'<p>Static page</p>' }], 'index.html');
  assert.equal(plain.status, 'convertible');
  assert.deepEqual(plain.findings, []);
  console.log('[OK] Diagnostic locations: LF/CRLF, multiple blocks, same-line and multiline tags, module prefixes, external scripts, and refusal controls.');
}
module.exports = checkLocations;
if (require.main === module) checkLocations().catch(error => { console.error(error); process.exitCode = 1; });
