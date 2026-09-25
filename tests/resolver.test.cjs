'use strict';

const assert = require('node:assert/strict');
const Core = require('../src/offline-web-packager-core.js');

async function main() {
  assert.deepEqual(
    Core.resolveVirtualReference('pages/deep/index.html', '../../images/%E7%8C%AB.png?cache=1#view'),
    { kind: 'local', raw: '../../images/%E7%8C%AB.png?cache=1#view', path: 'images/猫.png' }
  );
  assert.equal(Core.resolveVirtualReference('pages/deep/index.html', '/icons/site.svg').path, 'icons/site.svg');
  assert.equal(Core.resolveVirtualReference('pages/deep/index.html', '../assets/app.js', '../').path, 'assets/app.js');
  assert.equal(Core.resolveVirtualReference('pages/deep/index.html', '../../../../escape.png').kind, 'outside-root');
  assert.equal(Core.fragmentSuffix('images/icon.svg?v=2#symbol'), '#symbol');
  assert.equal(Core.fragmentSuffix('images/icon.svg?v=2'), '');

  const parsed = Core.parseSrcset('data:image/png;base64,AAAA 1x, images/%E7%8C%AB.png?x=1#pixel 2x');
  assert.deepEqual(parsed, [
    { url: 'data:image/png;base64,AAAA', descriptor: '1x' },
    { url: 'images/%E7%8C%AB.png?x=1#pixel', descriptor: '2x' }
  ]);
  assert.deepEqual(Core.splitSrcset('one.png 1x, two.png 2x'), ['one.png', 'two.png']);
  assert.deepEqual(Core.parseSrcset('data:image/png;base64,AAAA, two.png 2x'), [
    { url: 'data:image/png;base64,AAAA', descriptor: '' },
    { url: 'two.png', descriptor: '2x' }
  ]);

  const records = [
    {
      path: 'index.html',
      text: '<!doctype html><img src="icons/sprite.svg#cat" srcset="data:image/png;base64,AAAA 1x, images/%E7%8C%AB.png?x=1#pixel 2x"><style>.mark{background:url("icons/sprite.svg?v=1#paint")}</style>',
      size: 190
    },
    { path: 'icons/sprite.svg', text: '<svg xmlns="http://www.w3.org/2000/svg"><g id="cat"/><linearGradient id="paint"/></svg>', size: 90 },
    { path: 'images/猫.png', bytes: new Uint8Array([137, 80, 78, 71]), size: 4 }
  ];
  const analysis = await Core.analyzeProject(records, 'index.html');
  assert.equal(analysis.status, 'convertible', JSON.stringify(analysis.findings));
  const packaged = await Core.packageProject(records, 'index.html', { analysis });
  assert.match(packaged.html, /data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+#cat/);
  assert.match(packaged.html, /data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+#paint/);
  assert.match(packaged.html, /srcset="data:image\/png;base64,AAAA 1x, data:image\/png;base64,[A-Za-z0-9+/=]+#pixel 2x"/);

  console.log('[OK] Resolver tests passed: deep paths, root-relative paths, URL decoding, query/fragment handling, and srcset data URLs.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
