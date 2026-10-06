'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Core = require('../../src/offline-web-packager-core.js');

module.exports = function loadApp({ sourcePath, language = 'en', anchorDownload = true, blobUrl = true } = {}) {
  const root = path.join(__dirname, '../..');
  const source = fs.readFileSync(sourcePath || path.join(root, 'src/index.template.html'), 'utf8');
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
  const document = { querySelector:node, querySelectorAll:()=>[], createElement:tag=>new Element(tag), documentElement:new Element(), body:new Element(), activeElement:null };
  let runtimeCore = { ...Core };
  if (sourcePath) {
    const embeddedCore=scripts.find(item => item[1].includes('global.OfflineWebPackagerCore = api;'));
    if (!embeddedCore) throw new Error('Generated HTML must contain its own analyzer');
    const coreContext={ TextEncoder, TextDecoder, Uint8Array, DataView, ArrayBuffer, Blob, Response, DecompressionStream, AbortController, setTimeout };
    vm.runInNewContext(embeddedCore[1],coreContext,{filename:'embedded-offline-web-packager-core.js'});
    runtimeCore={ ...coreContext.OfflineWebPackagerCore };
  }
  const context = { window:{OfflineWebPackagerCore:runtimeCore}, document, navigator:{language}, localStorage:{getItem:()=>null,setItem(){}}, HTMLElement:Element, Blob, File, AbortController, Uint8Array, TextEncoder, TextDecoder, Response, DecompressionStream, console, requestAnimationFrame:callback=>callback(), setTimeout:(callback, delay)=>{timers.push({callback,delay});return timers.length;}, clearTimeout(){}, URL:blobUrl ? {createObjectURL:blob=>{blobs.push(blob);return `blob:test-${blobs.length}`;},revokeObjectURL:url=>revoked.push(url)} : {}, fetch:()=>{throw new Error('Network must not be used');} };
  // Expose lexical app state only inside this test VM, never in production code.
  script = script.replace('      applyLanguage();\n', '      window.__test = { state, render, runAnalysis, commitEntries, loadHtmlFile, loadZipFile, createOperation, finishOperation, VirtualFileSystem, AppConfirm, findingCopy, findingDetail };\n      applyLanguage();\n');
  vm.runInNewContext(script, context, {filename:sourcePath || 'index.template.html'});
  return { ...context.window.__test, Core:runtimeCore, node, downloads, blobs, revoked, timers, source, config };
};
