const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../src/index.template.html'),'utf8');
const originalBuild="<details class=\"build-info\"><summary data-i18n=\"buildInfo\">ビルド情報</summary><div class=\"build-grid\"><div class=\"build-item\"><span data-i18n=\"appVersion\">アプリバージョン</span><strong id=\"buildVersion\">—</strong></div><div class=\"build-item\"><span data-i18n=\"builtAt\">生成日時</span><strong id=\"builtAt\">—</strong></div><div class=\"build-item\"><span data-i18n=\"runtimeNetwork\">アプリの外部通信</span><strong data-i18n=\"runtimeNetworkValue\">なし</strong></div></div></details>";
test('exact existing metadata is unique and final inside the actual Help scroll body',()=>{
 assert.doesNotMatch(html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/)[1],/id="buildVersion"/);
 const help=html.match(/<dialog[^>]*id="helpDialog"[^>]*>([\s\S]*?)<\/dialog>/)[1];const start=help.search(/<div class="dialog-body"[^>]*>/);let depth=0,end=-1;
 for(const m of help.slice(start).matchAll(/<div\b[^>]*>|<\/div>/g)){depth+=m[0].startsWith('</')?-1:1;if(depth===0){end=start+m.index;break;}}
 assert.ok(end>start);const body=help.slice(start,end);assert.ok(body.includes(originalBuild));assert.match(body.slice(body.indexOf(originalBuild)+originalBuild.length),/^\s*(?:<!--[^]*?-->\s*)?$/);
 for(const id of ["buildVersion", "builtAt"])assert.equal((html.match(new RegExp(`id="${id}"`,'g'))||[]).length,1);
});
test('only the informational footer hides at the existing workflow breakpoint',()=>{
 const css=html.match(/<style>([\s\S]*?)<\/style>/)[1];const start=css.search(/@media\s*\(max-width:\s*760px\)\s*\{/);assert.ok(start>=0);
 const open=css.indexOf('{',start);let depth=1,end=open+1;for(;end<css.length&&depth;end++){if(css[end]==='{')depth++;if(css[end]==='}')depth--;}
 assert.match(css.slice(open+1,end-1),/(?:^|})\s*footer\s*\{\s*display:\s*none\s*;?\s*\}/);
});
test('existing Help Close/Escape behavior is preserved without adding backdrop dismissal',()=>{
 assert.doesNotMatch(html,/helpDialog\.addEventListener\('click'/);
 assert.match(html,/helpDialog\.addEventListener\('cancel',event=>\{ event\.preventDefault\(\); closeHelp\(\); \}\)/);
});
