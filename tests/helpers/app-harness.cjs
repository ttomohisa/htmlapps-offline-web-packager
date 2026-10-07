'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { gunzipSync } = require('node:zlib');
const Core = require('../../src/offline-web-packager-core.js');

module.exports = function loadApp({ sourcePath, language = 'en', savedLanguage = null, storageThrows = false, anchorDownload = true, blobUrl = true } = {}) {
  const root = path.join(__dirname, '../..');
  let source = fs.readFileSync(sourcePath || path.join(root, 'src/index.template.html'), 'utf8');
  const payload = source.match(/<script id="self-extract-payload" type="application\/octet-stream">([\s\S]*?)<\/script>/);
  if (payload) source = gunzipSync(Buffer.from(payload[1].replace(/\s/g, ''), 'base64')).toString('utf8');
  const scripts = [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  let script = scripts.at(-1)[1];
  const config = JSON.parse(fs.readFileSync(path.join(root, 'app.config.json'), 'utf8'));
  script = script.replace('__APP_CONFIG_JSON__', JSON.stringify(config))
    .replace('__BUILD_MANIFEST_JSON__', '{}').replace('__EMBEDDED_ASSET_BUNDLE_JSON__', '{}');
  const nodes = new Map(), downloads = [], blobs = [], revoked = [], timers = [];
  class Element {
    constructor(tag = 'div') { this.tagName = tag; this.dataset = {}; this.value = ''; this.children = []; this.listeners = {}; this.textContent = ''; this.disabled = false; this.isConnected = true; this.classList = { toggle(){}, add(){}, remove(){} }; if (tag === 'a' && anchorDownload) this.download = ''; }
    set innerHTML(value) { this.html = value; this.children = []; }
    get innerHTML() { return this.html || ''; }
    append(...items) { this.children.push(...items); }
    addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
    async fire(name, event = {}) { for (const callback of this.listeners[name] || []) await callback({ preventDefault(){}, ...event }); }
    click() { if (this.tagName === 'a') downloads.push(this); else return this.fire('click'); }
    setAttribute(name, value) { this[name] = value; }
    removeAttribute(name) { delete this[name]; }
    remove() { this.isConnected = false; }
    scrollIntoView() {}
    focus() {}
    showModal() { this.open = true; }
    close() { this.open = false; }
    contains() { return false; }
    querySelector(selector) { return node(selector); }
  }
  function node(selector) { if (!nodes.has(selector)) nodes.set(selector, new Element()); return nodes.get(selector); }
  const i18nElements = [...source.matchAll(/data-i18n="([^"]+)"/g)].map(match => { const el = new Element(); el.dataset.i18n = match[1]; return el; });
  for (const match of source.matchAll(/<[a-z][a-z0-9]*\b[^>]*\bid="([^"]+)"[^>]*>/gi)) { const el = node(`#${match[1]}`); for (const attr of match[0].matchAll(/([\w-]+)="([^"]*)"/g)) el.setAttribute(attr[1], attr[2]); }
  const document = { querySelector:node, querySelectorAll:selector=>selector === '[data-i18n]' ? i18nElements : [], createElement:tag=>new Element(tag), documentElement:new Element(), body:new Element(), activeElement:null };
  let runtimeCore = { ...Core };
  if (sourcePath) {
    const embeddedCore=scripts.find(item => item[1].includes('global.OfflineWebPackagerCore = api;'));
    if (!embeddedCore) throw new Error('Generated HTML must contain its own analyzer');
    const coreContext={ TextEncoder, TextDecoder, Uint8Array, DataView, ArrayBuffer, Blob, Response, DecompressionStream, AbortController, setTimeout };
    vm.runInNewContext(embeddedCore[1],coreContext,{filename:'embedded-offline-web-packager-core.js'});
    runtimeCore={ ...coreContext.OfflineWebPackagerCore };
  }
  const context = { window:{OfflineWebPackagerCore:runtimeCore}, document, navigator:{language}, localStorage:{getItem(){if(storageThrows)throw new Error('storage unavailable');return savedLanguage;},setItem(){if(storageThrows)throw new Error('storage unavailable');}}, HTMLElement:Element, Blob, File, AbortController, Uint8Array, TextEncoder, TextDecoder, Response, DecompressionStream, console, requestAnimationFrame:callback=>callback(), setTimeout:(callback, delay)=>{timers.push({callback,delay});return timers.length;}, clearTimeout(){}, URL:blobUrl ? {createObjectURL:blob=>{blobs.push(blob);return `blob:test-${blobs.length}`;},revokeObjectURL:url=>revoked.push(url)} : {}, fetch:()=>{throw new Error('Network must not be used');} };
  // Expose lexical app state only inside this test VM, never in production code.
  script = script.replace('      applyLanguage();\n', '      window.__test = { state, render, runAnalysis, commitEntries, loadHtmlFile, loadZipFile, createOperation, finishOperation, VirtualFileSystem, AppConfirm, findingCopy, findingDetail };\n      applyLanguage();\n');
  vm.runInNewContext(script, context, {filename:sourcePath || 'index.template.html'});
  return { ...context.window.__test, Core:runtimeCore, node, downloads, blobs, revoked, timers, source, config, i18nElements };
};
