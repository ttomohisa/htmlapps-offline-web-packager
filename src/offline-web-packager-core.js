(function (global) {
  'use strict';

  const HTML_EXTENSIONS = new Set(['html', 'htm']);
  const ZIP_LOCAL_FILE = 0x04034b50;
  const ZIP_CENTRAL_FILE = 0x02014b50;
  const ZIP_END = 0x06054b50;
  const DEFAULT_LIMITS = Object.freeze({
    maxFiles: 2000,
    maxTotalBytes: 100 * 1024 * 1024,
    maxSingleBytes: 50 * 1024 * 1024,
    largeFileWarningBytes: 50 * 1024 * 1024,
    maxZipCompressionRatio: 200
  });
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();

  class PackagerInputError extends Error {
    constructor(code, message, detail = '') {
      super(message);
      this.name = 'PackagerInputError';
      this.code = code;
      this.detail = detail;
    }
  }


  function abortError() {
    return new PackagerInputError('operation-cancelled', '処理をキャンセルしました。');
  }

  function throwIfAborted(signal) {
    if (signal && signal.aborted) throw abortError();
  }

  function reportProgress(options, stage, completed, total, detail = '') {
    throwIfAborted(options && options.signal);
    const callback = options && options.onProgress;
    if (typeof callback !== 'function') return;
    const safeTotal = Number.isFinite(total) && total > 0 ? total : 0;
    const safeCompleted = Number.isFinite(completed) ? Math.max(0, completed) : 0;
    callback({ stage, completed: safeCompleted, total: safeTotal, detail });
  }

  function inputLimits(options = {}) {
    return {
      maxFiles: Number.isFinite(options.maxFiles) ? options.maxFiles : DEFAULT_LIMITS.maxFiles,
      maxTotalBytes: Number.isFinite(options.maxTotalBytes) ? options.maxTotalBytes : DEFAULT_LIMITS.maxTotalBytes,
      maxSingleBytes: Number.isFinite(options.maxSingleBytes) ? options.maxSingleBytes : DEFAULT_LIMITS.maxSingleBytes,
      largeFileWarningBytes: Number.isFinite(options.largeFileWarningBytes) ? options.largeFileWarningBytes : DEFAULT_LIMITS.largeFileWarningBytes,
      maxZipCompressionRatio: Number.isFinite(options.maxZipCompressionRatio) ? options.maxZipCompressionRatio : DEFAULT_LIMITS.maxZipCompressionRatio
    };
  }

  function assertInputLimits(records, options = {}) {
    const files = Array.isArray(records) ? records : [];
    const limits = inputLimits(options);
    if (files.length > limits.maxFiles) {
      throw new PackagerInputError('too-many-files', 'ファイル数が上限を超えています。', `${files.length} / ${limits.maxFiles}`);
    }
    let totalBytes = 0;
    for (let index = 0; index < files.length; index += 1) {
      throwIfAborted(options.signal);
      const record = files[index] || {};
      const size = Number(record.size ?? record.bytes?.byteLength ?? record.file?.size ?? 0) || 0;
      const path = record.path || record.name || `file ${index + 1}`;
      if (size > limits.maxSingleBytes) {
        throw new PackagerInputError('file-too-large', '50 MBを超えるファイルは読み込めません。', `${path}: ${size} bytes`);
      }
      totalBytes += size;
      if (totalBytes > limits.maxTotalBytes) {
        throw new PackagerInputError('input-too-large', '入力全体が100 MBの上限を超えています。', `${totalBytes} bytes`);
      }
    }
    return { fileCount: files.length, totalBytes, limits };
  }

  function toUint8Array(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    throw new TypeError('Expected ArrayBuffer or Uint8Array.');
  }

  function safeDecodeURIComponent(value) {
    try { return decodeURIComponent(value); } catch { return value; }
  }

  function hasTraversalSegment(path) {
    const decoded = safeDecodeURIComponent(String(path).replace(/\\/g, '/'));
    return decoded.split('/').some(segment => segment === '..');
  }

  function assertSafeArchivePath(rawPath) {
    const value = String(rawPath || '');
    const slashPath = value.replace(/\\/g, '/');
    const decoded = safeDecodeURIComponent(slashPath);
    if (!value || /\0/.test(value)) throw new PackagerInputError('zip-path-invalid', 'ZIP内に無効なファイル名があります。', value);
    if (/^[a-zA-Z]:[\\/]/.test(value) || /^\\\\/.test(value) || slashPath.startsWith('/') || decoded.startsWith('/')) {
      throw new PackagerInputError('zip-path-absolute', 'ZIP内に端末上の絶対パスを示すファイル名があります。', value);
    }
    if (hasTraversalSegment(value)) {
      throw new PackagerInputError('zip-path-traversal', 'ZIP内にフォルダの外側を参照するファイル名があります。', value);
    }
  }

  function normalizeVirtualPath(rawPath, options = {}) {
    const rejectTraversal = options.rejectTraversal !== false;
    let value = String(rawPath || '').replace(/\\/g, '/').normalize('NFC');
    if (/\0/.test(value)) throw new PackagerInputError('path-invalid', 'ファイル名に無効な文字が含まれています。', rawPath);
    value = value.replace(/^\.\//, '');
    const parts = [];
    for (const part of value.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') {
        if (rejectTraversal) throw new PackagerInputError('path-traversal', 'フォルダの外側を参照するパスは読み込めません。', rawPath);
        if (parts.length) parts.pop();
        continue;
      }
      parts.push(part);
    }
    const normalized = parts.join('/');
    if (!normalized) throw new PackagerInputError('path-empty', '空のファイル名は読み込めません。', rawPath);
    return normalized;
  }

  function extensionOf(path) {
    const name = String(path).split('/').pop() || '';
    const dot = name.lastIndexOf('.');
    return dot > -1 ? name.slice(dot + 1).toLowerCase() : '';
  }

  function stripCommonRoot(entries) {
    const list = entries.map(entry => ({ ...entry, path: normalizeVirtualPath(entry.path) }));
    if (!list.length) return list;
    const split = list.map(entry => entry.path.split('/'));
    if (!split.every(parts => parts.length >= 2)) return list;
    const first = split[0][0];
    if (!split.every(parts => parts[0] === first)) return list;
    return list.map((entry, index) => ({ ...entry, path: split[index].slice(1).join('/') }));
  }

  function detectStartHtml(paths) {
    const candidates = paths
      .map(path => normalizeVirtualPath(path))
      .filter(path => HTML_EXTENSIONS.has(extensionOf(path)))
      .map(path => {
        const parts = path.split('/');
        const basename = parts[parts.length - 1].toLowerCase();
        const depth = parts.length - 1;
        let score = 0;
        if (basename === 'index.html') score += 1000;
        else if (basename === 'index.htm') score += 900;
        else if (basename === 'default.html' || basename === 'default.htm') score += 520;
        if (depth === 0) score += 500;
        score -= depth * 12;
        return { path, score, depth, basename };
      })
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path, 'en'));

    if (!candidates.length) return { selected: '', candidates: [], reason: 'none', ambiguous: false };
    const selected = candidates[0].path;
    const topScore = candidates[0].score;
    const ambiguous = candidates.length > 1 && candidates[1].score === topScore;
    const lower = selected.toLowerCase();
    const reason = lower === 'index.html' || lower === 'index.htm'
      ? 'root-index'
      : /(^|\/)index\.html?$/.test(lower)
        ? 'nested-index'
        : candidates.length === 1
          ? 'single-html'
          : 'best-candidate';
    return { selected, candidates: candidates.map(item => item.path), reason, ambiguous };
  }

  function crc32(input) {
    const bytes = toUint8Array(input);
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function findEndOfCentralDirectory(bytes) {
    const min = Math.max(0, bytes.length - 0xffff - 22);
    for (let offset = bytes.length - 22; offset >= min; offset -= 1) {
      if (bytes[offset] === 0x50 && bytes[offset + 1] === 0x4b && bytes[offset + 2] === 0x05 && bytes[offset + 3] === 0x06) return offset;
    }
    return -1;
  }

  function decodeZipName(bytes, utf8) {
    if (utf8) return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    try {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (!decoded.includes('\ufffd')) return decoded;
    } catch { /* fall through */ }
    let output = '';
    for (const byte of bytes) output += String.fromCharCode(byte);
    return output;
  }

  function supportsDeflateRaw() {
    if (typeof DecompressionStream !== 'function' || typeof Blob !== 'function' || typeof Blob.prototype.stream !== 'function' || typeof Response !== 'function') return false;
    try {
      new DecompressionStream('deflate-raw');
      return true;
    } catch {
      return false;
    }
  }

  async function inflateRaw(compressed) {
    if (!supportsDeflateRaw()) {
      throw new PackagerInputError('zip-deflate-unsupported', 'このブラウザでは圧縮されたZIPを展開できません。', 'DecompressionStream(\'deflate-raw\') is unavailable.');
    }
    let stream;
    try {
      stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    } catch (error) {
      throw new PackagerInputError('zip-deflate-unsupported', 'このブラウザではこのZIPの圧縮方式を展開できません。', String(error && error.message || error));
    }
    try {
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (error) {
      throw new PackagerInputError('zip-corrupt', 'ZIPの展開中にエラーが発生しました。', String(error && error.message || error));
    }
  }

  async function readZip(input, options = {}) {
    const bytes = toUint8Array(input);
    const limits = inputLimits(options);
    const maxEntries = Number.isFinite(options.maxEntries) ? options.maxEntries : limits.maxFiles;
    const maxTotalUncompressed = Number.isFinite(options.maxTotalUncompressed) ? options.maxTotalUncompressed : limits.maxTotalBytes;
    const maxSingleUncompressed = Number.isFinite(options.maxSingleUncompressed) ? options.maxSingleUncompressed : limits.maxSingleBytes;
    const maxCompressionRatio = Number.isFinite(options.maxCompressionRatio) ? options.maxCompressionRatio : limits.maxZipCompressionRatio;
    throwIfAborted(options.signal);
    if (bytes.byteLength > limits.maxSingleBytes) {
      throw new PackagerInputError('zip-input-too-large', '50 MBを超えるZIPは読み込めません。', `${bytes.byteLength} bytes`);
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eocd = findEndOfCentralDirectory(bytes);
    if (eocd < 0) throw new PackagerInputError('zip-invalid', 'ZIPとして読み込めませんでした。', 'End of central directory was not found.');
    if (view.getUint32(eocd, true) !== ZIP_END) throw new PackagerInputError('zip-invalid', 'ZIPとして読み込めませんでした。');

    const diskNumber = view.getUint16(eocd + 4, true);
    const centralDisk = view.getUint16(eocd + 6, true);
    const entriesOnDisk = view.getUint16(eocd + 8, true);
    const entryCount = view.getUint16(eocd + 10, true);
    const centralSize = view.getUint32(eocd + 12, true);
    const centralOffset = view.getUint32(eocd + 16, true);
    if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
      throw new PackagerInputError('zip-multidisk', '複数ファイルに分割されたZIPには対応していません。');
    }
    if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
      throw new PackagerInputError('zip64-unsupported', '非常に大きなZIP形式にはまだ対応していません。', 'ZIP64 is not supported.');
    }
    if (entryCount > Math.max(maxEntries * 2, maxEntries + 512)) throw new PackagerInputError('zip-too-many-entries', 'ZIP内の項目数が多すぎます。', `${entryCount} entries`);
    if (centralOffset + centralSize > bytes.length) throw new PackagerInputError('zip-corrupt', 'ZIPの管理情報が壊れています。');

    const metadata = [];
    let cursor = centralOffset;
    let totalUncompressed = 0;
    let fileEntryCount = 0;
    for (let index = 0; index < entryCount; index += 1) {
      reportProgress(options, 'zip-index', index, Math.max(entryCount, 1));
      if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== ZIP_CENTRAL_FILE) {
        throw new PackagerInputError('zip-corrupt', 'ZIPのファイル一覧が壊れています。', `Central entry ${index + 1}`);
      }
      const madeBy = view.getUint16(cursor + 4, true);
      const flags = view.getUint16(cursor + 8, true);
      const method = view.getUint16(cursor + 10, true);
      const expectedCrc = view.getUint32(cursor + 16, true);
      const compressedSize = view.getUint32(cursor + 20, true);
      const uncompressedSize = view.getUint32(cursor + 24, true);
      const nameLength = view.getUint16(cursor + 28, true);
      const extraLength = view.getUint16(cursor + 30, true);
      const commentLength = view.getUint16(cursor + 32, true);
      const diskStart = view.getUint16(cursor + 34, true);
      const externalAttributes = view.getUint32(cursor + 38, true);
      const localOffset = view.getUint32(cursor + 42, true);
      const next = cursor + 46 + nameLength + extraLength + commentLength;
      if (next > bytes.length) throw new PackagerInputError('zip-corrupt', 'ZIPのファイル名情報が壊れています。');
      const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
      const rawName = decodeZipName(nameBytes, Boolean(flags & 0x0800));
      assertSafeArchivePath(rawName);
      const path = normalizeVirtualPath(rawName);
      const isDirectory = rawName.endsWith('/');
      if (!isDirectory) {
        fileEntryCount += 1;
        if (fileEntryCount > maxEntries) throw new PackagerInputError('zip-too-many-files', 'ZIP内のファイル数が2,000件の上限を超えています。', `${fileEntryCount} files`);
      }
      const hostOs = madeBy >>> 8;
      const unixMode = (externalAttributes >>> 16) & 0xffff;
      const isSymlink = hostOs === 3 && (unixMode & 0xf000) === 0xa000;
      if (isSymlink) throw new PackagerInputError('zip-symlink', 'ZIP内のシンボリックリンクには対応していません。', rawName);
      if (flags & 0x0001) throw new PackagerInputError('zip-encrypted', 'パスワード付きZIPには対応していません。', rawName);
      if (!isDirectory && method !== 0 && method !== 8) {
        throw new PackagerInputError('zip-method-unsupported', 'このZIPで使われている圧縮方式には対応していません。', `${rawName}: method ${method}`);
      }
      if (diskStart !== 0) throw new PackagerInputError('zip-multidisk', '複数ファイルに分割されたZIPには対応していません。');
      if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
        throw new PackagerInputError('zip64-unsupported', '非常に大きなZIP形式にはまだ対応していません。', rawName);
      }
      if (!isDirectory && uncompressedSize > maxSingleUncompressed) {
        throw new PackagerInputError('zip-entry-too-large', 'ZIP内に大きすぎるファイルがあります。', `${rawName}: ${uncompressedSize} bytes`);
      }
      if (!isDirectory && compressedSize > 0 && uncompressedSize > 1024 * 1024 && (uncompressedSize / compressedSize) > maxCompressionRatio) {
        throw new PackagerInputError('zip-compression-ratio', 'ZIP内に展開後のサイズが急増するファイルがあります。', `${rawName}: ${Math.round(uncompressedSize / compressedSize)}x`);
      }
      if (!isDirectory) {
        totalUncompressed += uncompressedSize;
        if (totalUncompressed > maxTotalUncompressed) {
          throw new PackagerInputError('zip-expanded-too-large', 'ZIPを展開したときの合計サイズが大きすぎます。', `${totalUncompressed} bytes`);
        }
      }
      metadata.push({ path, rawName, isDirectory, method, flags, expectedCrc, compressedSize, uncompressedSize, localOffset });
      cursor = next;
    }

    reportProgress(options, 'zip-index', entryCount, Math.max(entryCount, 1));
    const files = [];
    const seen = new Set();
    let extractedCount = 0;
    const fileMetadataCount = metadata.filter(item => !item.isDirectory).length;
    for (const item of metadata) {
      throwIfAborted(options.signal);
      if (item.isDirectory) continue;
      if (seen.has(item.path)) throw new PackagerInputError('zip-duplicate-path', 'ZIP内に同じ場所を指すファイルが複数あります。', item.path);
      seen.add(item.path);
      const local = item.localOffset;
      if (local + 30 > bytes.length || view.getUint32(local, true) !== ZIP_LOCAL_FILE) {
        throw new PackagerInputError('zip-corrupt', 'ZIP内のファイル情報が壊れています。', item.rawName);
      }
      const localNameLength = view.getUint16(local + 26, true);
      const localExtraLength = view.getUint16(local + 28, true);
      const dataStart = local + 30 + localNameLength + localExtraLength;
      const dataEnd = dataStart + item.compressedSize;
      if (dataStart < 0 || dataEnd > bytes.length) throw new PackagerInputError('zip-corrupt', 'ZIP内のファイルデータが壊れています。', item.rawName);
      const compressed = bytes.subarray(dataStart, dataEnd);
      const data = item.method === 0 ? new Uint8Array(compressed) : await inflateRaw(compressed);
      if (data.byteLength !== item.uncompressedSize) {
        throw new PackagerInputError('zip-size-mismatch', 'ZIP内のファイルサイズが一致しません。', item.rawName);
      }
      if (crc32(data) !== item.expectedCrc) {
        throw new PackagerInputError('zip-crc-mismatch', 'ZIP内のファイルを正しく読み取れませんでした。', item.rawName);
      }
      files.push({ path: item.path, bytes: data, size: data.byteLength });
      extractedCount += 1;
      reportProgress(options, 'zip-extract', extractedCount, Math.max(fileMetadataCount, 1), item.path);
    }
    return stripCommonRoot(files);
  }


  function stripUrlSuffix(value) {
    const text = String(value || '').trim();
    const hash = text.indexOf('#');
    const query = text.indexOf('?');
    let end = text.length;
    if (hash >= 0) end = Math.min(end, hash);
    if (query >= 0) end = Math.min(end, query);
    return text.slice(0, end);
  }

  function directoryOf(path) {
    const normalized = String(path || '').replace(/\\/g, '/');
    const index = normalized.lastIndexOf('/');
    return index >= 0 ? normalized.slice(0, index + 1) : '';
  }

  function normalizeResolvedPath(value) {
    const decoded = safeDecodeURIComponent(String(value || '').replace(/\\/g, '/')).normalize('NFC');
    const parts = [];
    for (const segment of decoded.split('/')) {
      if (!segment || segment === '.') continue;
      if (segment === '..') {
        if (!parts.length) return { path: '', outsideRoot: true };
        parts.pop();
      } else {
        parts.push(segment);
      }
    }
    return { path: parts.join('/'), outsideRoot: false };
  }

  function classifyReference(rawValue) {
    const raw = String(rawValue || '').trim();
    if (!raw || raw.startsWith('#')) return { kind: 'ignored', raw };
    if (/^(?:data|blob|javascript|mailto|tel|about):/i.test(raw)) return { kind: 'ignored', raw };
    if (/^\/\//.test(raw)) return { kind: 'external', raw, url: raw };
    const scheme = raw.match(/^([a-z][a-z0-9+.-]*):/i);
    if (scheme) {
      if (/^https?$/i.test(scheme[1])) return { kind: 'external', raw, url: raw };
      return { kind: 'unsupported-scheme', raw, scheme: scheme[1].toLowerCase() };
    }
    return { kind: 'local', raw };
  }

  function resolveVirtualReference(fromPath, rawValue, baseHref = '') {
    const classified = classifyReference(rawValue);
    if (classified.kind !== 'local') return classified;
    const clean = stripUrlSuffix(classified.raw);
    if (!clean) return { kind: 'ignored', raw: classified.raw };

    let baseDirectory = directoryOf(fromPath);
    if (baseHref) {
      const baseClass = classifyReference(baseHref);
      if (baseClass.kind === 'external') return { kind: 'external-base', raw: classified.raw, baseHref };
      if (baseClass.kind === 'unsupported-scheme') return { kind: 'unsupported-base', raw: classified.raw, baseHref, scheme: baseClass.scheme };
      if (baseClass.kind === 'local') {
        const baseClean = stripUrlSuffix(baseHref);
        const baseJoined = baseClean.startsWith('/') ? baseClean.slice(1) : `${directoryOf(fromPath)}${baseClean}`;
        const normalizedBase = normalizeResolvedPath(baseJoined);
        if (normalizedBase.outsideRoot) return { kind: 'outside-root', raw: classified.raw, baseHref };
        baseDirectory = baseClean.endsWith('/') ? `${normalizedBase.path}${normalizedBase.path ? '/' : ''}` : directoryOf(normalizedBase.path);
      }
    }

    const joined = clean.startsWith('/') ? clean.slice(1) : `${baseDirectory}${clean}`;
    const normalized = normalizeResolvedPath(joined);
    if (normalized.outsideRoot || !normalized.path) return { kind: 'outside-root', raw: classified.raw };
    return { kind: 'local', raw: classified.raw, path: normalized.path };
  }

  function parseHtmlAttributes(tagSource) {
    const attrs = Object.create(null);
    const body = String(tagSource || '').replace(/^<\/?\s*[\w:-]+/i, '').replace(/\/?>\s*$/, '');
    const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let match;
    while ((match = re.exec(body))) {
      const name = match[1].toLowerCase();
      attrs[name] = match[2] ?? match[3] ?? match[4] ?? '';
    }
    return attrs;
  }

  function parseSrcset(value) {
    const source = String(value || '');
    const candidates = [];
    let index = 0;

    while (index < source.length) {
      while (index < source.length && /[\s,]/.test(source[index])) index += 1;
      if (index >= source.length) break;

      const urlStart = index;
      const isData = source.slice(index, index + 5).toLowerCase() === 'data:';
      if (isData) {
        while (index < source.length && !/\s/.test(source[index])) index += 1;
      } else {
        while (index < source.length && !/[\s,]/.test(source[index])) index += 1;
      }
      let url = source.slice(urlStart, index);
      if (!url) {
        index += 1;
        continue;
      }

      // srcset allows a candidate with no descriptor to end directly in a comma.
      // For data: URLs the separator comma is collected with the URL token, while
      // ordinary URLs stop before the comma. Handle both forms without splitting the
      // comma that belongs inside the data: URL itself.
      if (url.endsWith(',')) {
        url = url.replace(/,+$/, '');
        if (url) candidates.push({ url, descriptor: '' });
        continue;
      }
      if (index < source.length && source[index] === ',') {
        index += 1;
        candidates.push({ url, descriptor: '' });
        continue;
      }

      const descriptorStart = index;
      while (index < source.length && source[index] !== ',') index += 1;
      const descriptor = source.slice(descriptorStart, index).trim();
      if (index < source.length && source[index] === ',') index += 1;

      candidates.push({ url, descriptor });
    }
    return candidates;
  }

  function splitSrcset(value) {
    return parseSrcset(value).map(candidate => candidate.url);
  }

  function fragmentSuffix(value) {
    const raw = String(value || '').trim();
    const index = raw.indexOf('#');
    return index >= 0 ? raw.slice(index) : '';
  }

  function queryFragmentSuffix(value) {
    const raw = String(value || '').trim();
    const query = raw.indexOf('?');
    const fragment = raw.indexOf('#');
    const indexes = [query, fragment].filter(index => index >= 0);
    return indexes.length ? raw.slice(Math.min(...indexes)) : '';
  }

  function lineNumberFor(text, index) {
    if (!Number.isFinite(index) || index < 0) return 0;
    let line = 1;
    for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
    return line;
  }

  async function readRecordText(record) {
    if (!record) return '';
    if (typeof record.text === 'string') return record.text;
    if (record.bytes != null) return new TextDecoder('utf-8', { fatal: false }).decode(toUint8Array(record.bytes));
    if (record.file && typeof record.file.text === 'function') return record.file.text();
    if (typeof record.text === 'function') return record.text();
    return '';
  }

  async function analyzeProject(records, entryHtml, options = {}) {
    const files = Array.isArray(records) ? records : [];
    throwIfAborted(options.signal);
    if (options.enforceInputLimits !== false) assertInputLimits(files, options);
    const exact = new Map();
    const lower = new Map();
    for (const source of files) {
      const path = normalizeVirtualPath(source.path);
      const record = { ...source, path, size: Number(source.size ?? source.bytes?.byteLength ?? 0) || 0 };
      exact.set(path, record);
      const key = path.toLocaleLowerCase('en-US');
      if (!lower.has(key)) lower.set(key, []);
      lower.get(key).push(path);
    }

    const findings = [];
    const findingKeys = new Set();
    const dependencies = [];
    const dependencyKeys = new Set();
    const scanned = new Set();
    const queued = [];
    const largeFileWarningBytes = Number.isFinite(options.largeFileWarningBytes) ? options.largeFileWarningBytes : DEFAULT_LIMITS.largeFileWarningBytes;

    function addFinding(severity, code, data = {}) {
      const key = [severity, code, data.path || '', data.target || '', data.line || '', data.detail || ''].join('|');
      if (findingKeys.has(key)) return;
      findingKeys.add(key);
      findings.push({ severity, code, ...data });
    }

    function addDependency(from, requested, actual, kind) {
      const key = `${from}|${requested}|${actual || ''}|${kind}`;
      if (dependencyKeys.has(key)) return;
      dependencyKeys.add(key);
      dependencies.push({ from, requested, actual: actual || '', kind });
    }

    function locateLocal(requestedPath, fromPath, rawTarget, kind) {
      if (exact.has(requestedPath)) {
        addDependency(fromPath, rawTarget, requestedPath, kind);
        return requestedPath;
      }
      const alternatives = lower.get(requestedPath.toLocaleLowerCase('en-US')) || [];
      if (alternatives.length === 1) {
        addFinding('warning', 'case-mismatch', { path: fromPath, target: rawTarget, resolved: alternatives[0] });
        addDependency(fromPath, rawTarget, alternatives[0], kind);
        return alternatives[0];
      }
      if (alternatives.length > 1) {
        addFinding('block', 'case-ambiguous', { path: fromPath, target: rawTarget, detail: alternatives.join(', ') });
        return '';
      }
      addFinding('block', 'missing-local-file', { path: fromPath, target: rawTarget, resolved: requestedPath });
      return '';
    }

    function handleReference(fromPath, rawTarget, kind, baseHref = '', optionsRef = {}) {
      const resolved = resolveVirtualReference(fromPath, rawTarget, baseHref);
      if (resolved.kind === 'ignored') return '';
      if (resolved.kind === 'external') {
        addFinding(optionsRef.navigation ? 'warning' : 'block', optionsRef.navigation ? 'external-link' : 'external-resource', { path: fromPath, target: rawTarget, kind });
        return '';
      }
      if (resolved.kind === 'external-base') {
        addFinding('block', 'external-base-url', { path: fromPath, target: baseHref });
        return '';
      }
      if (resolved.kind === 'unsupported-base' || resolved.kind === 'unsupported-scheme') {
        addFinding('warning', 'unsupported-url-scheme', { path: fromPath, target: rawTarget, detail: resolved.scheme || '' });
        return '';
      }
      if (resolved.kind === 'outside-root') {
        addFinding('block', 'reference-outside-root', { path: fromPath, target: rawTarget });
        return '';
      }
      const actual = locateLocal(resolved.path, fromPath, rawTarget, kind);
      if (actual && optionsRef.scan) queued.push({ path: actual, kind: optionsRef.scan });
      return actual;
    }

    function scanJavaScript(text, path, inlineLine = 0) {
      const tests = [
        ['block', 'dynamic-import', /\bimport\s*\(/g],
        ['block', 'import-meta-url', /\bimport\.meta(?:\.url)?\b/g],
        ['block', 'es-module-syntax', /(^|[;\n\r]\s*)import\s+(?!\()|(^|[;\n\r]\s*)export\s+(?:default\s+|const\s+|let\s+|var\s+|function\s+|class\s+|\{)/gm],
        ['block', 'web-worker', /\b(?:new\s+)?(?:Worker|SharedWorker)\s*\(/g],
        ['block', 'service-worker', /\bnavigator\s*\.\s*serviceWorker\s*\.\s*register\s*\(/g],
        ['block', 'wasm-loader', /\bWebAssembly\s*\.|["'`]([^"'`]*\.wasm(?:[?#][^"'`]*)?)["'`]/g],
        ['block', 'runtime-fetch', /\bfetch\s*\(/g],
        ['block', 'runtime-xhr', /\bXMLHttpRequest\b/g],
        ['block', 'runtime-network-api', /\b(?:WebSocket|EventSource)\s*\(|\bnavigator\s*\.\s*sendBeacon\s*\(/g],
        ['warning', 'dynamic-resource-loading', /document\s*\.\s*createElement\s*\(\s*["'](?:script|link|img|iframe)["']\s*\)|\.setAttribute\s*\(\s*["'](?:src|href)["']|\.(?:src|href)\s*=/g]
      ];
      for (const [severity, code, re] of tests) {
        re.lastIndex = 0;
        const match = re.exec(text);
        if (match) addFinding(severity, code, { path, line: inlineLine || lineNumberFor(text, match.index) });
      }
    }

    function scanCss(text, path) {
      const importRe = /@import\s+(?:url\(\s*)?(?:"([^"]+)"|'([^']+)'|([^\s);]+))\s*\)?[^;]*;/gi;
      let match;
      while ((match = importRe.exec(text))) {
        const target = match[1] || match[2] || match[3] || '';
        handleReference(path, target, 'css-import', '', { scan: 'css' });
      }
      const urlRe = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s][^)]*))\s*\)/gi;
      while ((match = urlRe.exec(text))) {
        const target = (match[1] ?? match[2] ?? match[3] ?? '').trim();
        if (!target || target.startsWith('#')) continue;
        handleReference(path, target, 'css-url');
      }
    }

    function scanHtml(text, path) {
      let baseHref = '';
      const baseTag = text.match(/<base\b[^>]*>/i);
      if (baseTag) {
        const attrs = parseHtmlAttributes(baseTag[0]);
        baseHref = attrs.href || '';
        const classified = classifyReference(baseHref);
        if (classified.kind === 'external') addFinding('block', 'external-base-url', { path, target: baseHref });
        else if (classified.kind === 'unsupported-scheme') addFinding('warning', 'unsupported-url-scheme', { path, target: baseHref, detail: classified.scheme });
      }

      const metaRe = /<meta\b[^>]*>/gi;
      let tagMatch;
      while ((tagMatch = metaRe.exec(text))) {
        const attrs = parseHtmlAttributes(tagMatch[0]);
        if ((attrs['http-equiv'] || '').toLowerCase() === 'content-security-policy') {
          addFinding('warning', 'csp-present', { path, line: lineNumberFor(text, tagMatch.index), detail: attrs.content || '' });
        }
      }

      const linkRe = /<link\b[^>]*>/gi;
      while ((tagMatch = linkRe.exec(text))) {
        const attrs = parseHtmlAttributes(tagMatch[0]);
        const href = attrs.href;
        if (!href) continue;
        const rel = (attrs.rel || '').toLowerCase().split(/\s+/).filter(Boolean);
        if (rel.includes('manifest')) {
          addFinding('block', 'pwa-manifest', { path, target: href, line: lineNumberFor(text, tagMatch.index) });
          handleReference(path, href, 'manifest', baseHref);
        } else if (rel.includes('stylesheet')) {
          handleReference(path, href, 'stylesheet', baseHref, { scan: 'css' });
        } else if (rel.some(value => ['icon', 'shortcut', 'apple-touch-icon', 'mask-icon'].includes(value))) {
          handleReference(path, href, 'icon', baseHref);
        } else if (rel.some(value => ['preload', 'modulepreload'].includes(value))) {
          if (rel.includes('modulepreload')) addFinding('block', 'es-module', { path, target: href, line: lineNumberFor(text, tagMatch.index) });
          handleReference(path, href, rel.includes('modulepreload') ? 'modulepreload' : 'preload', baseHref);
        }
      }

      const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
      while ((tagMatch = scriptRe.exec(text))) {
        const attrs = parseHtmlAttributes(`<script${tagMatch[1]}>`);
        const moduleScript = (attrs.type || '').trim().toLowerCase() === 'module';
        if (moduleScript) addFinding('block', 'es-module', { path, target: attrs.src || '', line: lineNumberFor(text, tagMatch.index) });
        if (attrs.src) {
          const actual = handleReference(path, attrs.src, moduleScript ? 'module-script' : 'script', baseHref, { scan: 'javascript' });
          if (moduleScript && actual) queued.push({ path: actual, kind: 'javascript' });
        } else if (tagMatch[2]) {
          scanJavaScript(tagMatch[2], path, lineNumberFor(text, tagMatch.index));
        }
      }

      const resourceTags = [
        ['img', 'src', 'image'], ['source', 'src', 'media'], ['video', 'src', 'video'], ['video', 'poster', 'image'],
        ['audio', 'src', 'audio'], ['track', 'src', 'track'], ['input', 'src', 'image']
      ];
      for (const [tagName, attrName, kind] of resourceTags) {
        const re = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
        while ((tagMatch = re.exec(text))) {
          const attrs = parseHtmlAttributes(tagMatch[0]);
          if (attrs[attrName]) handleReference(path, attrs[attrName], kind, baseHref);
          if (attrs.srcset) for (const target of splitSrcset(attrs.srcset)) handleReference(path, target, 'srcset', baseHref);
        }
      }

      const iframeRe = /<iframe\b[^>]*>/gi;
      while ((tagMatch = iframeRe.exec(text))) {
        const attrs = parseHtmlAttributes(tagMatch[0]);
        if (!attrs.src) continue;
        const ref = resolveVirtualReference(path, attrs.src, baseHref);
        if (ref.kind === 'local') {
          addFinding('block', 'local-iframe', { path, target: attrs.src, line: lineNumberFor(text, tagMatch.index) });
          locateLocal(ref.path, path, attrs.src, 'iframe');
        } else if (ref.kind === 'external') {
          addFinding('block', 'external-resource', { path, target: attrs.src, kind: 'iframe' });
        }
      }

      const objectRe = /<(?:object|embed)\b[^>]*>/gi;
      while ((tagMatch = objectRe.exec(text))) {
        const attrs = parseHtmlAttributes(tagMatch[0]);
        const target = attrs.data || attrs.src || '';
        if (target) addFinding('warning', 'unsupported-embedded-object', { path, target, line: lineNumberFor(text, tagMatch.index) });
      }

      const anchorRe = /<a\b[^>]*>/gi;
      while ((tagMatch = anchorRe.exec(text))) {
        const attrs = parseHtmlAttributes(tagMatch[0]);
        const href = attrs.href || '';
        if (!href) continue;
        const classified = classifyReference(href);
        if (classified.kind === 'external') {
          addFinding('warning', 'external-link', { path, target: href, line: lineNumberFor(text, tagMatch.index) });
          continue;
        }
        if (classified.kind !== 'local') continue;
        const ref = resolveVirtualReference(path, href, baseHref);
        if (ref.kind !== 'local') continue;
        const linkKind = HTML_EXTENSIONS.has(extensionOf(ref.path)) ? 'html-navigation' : 'local-link';
        const actual = locateLocal(ref.path, path, href, linkKind);
        if (!actual || actual === path) continue;
        if (HTML_EXTENSIONS.has(extensionOf(actual))) {
          addFinding('block', 'multi-page-navigation', { path, target: href, resolved: actual, line: lineNumberFor(text, tagMatch.index) });
        } else {
          addFinding('block', 'local-file-link', { path, target: href, resolved: actual, line: lineNumberFor(text, tagMatch.index) });
        }
      }

      const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
      while ((tagMatch = styleRe.exec(text))) scanCss(tagMatch[1] || '', path);
      const styleAttrRe = /\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
      while ((tagMatch = styleAttrRe.exec(text))) scanCss(tagMatch[1] || tagMatch[2] || '', path);
    }

    let sizeIndex = 0;
    for (const record of exact.values()) {
      throwIfAborted(options.signal);
      sizeIndex += 1;
      reportProgress(options, 'analyze-index', sizeIndex, Math.max(exact.size, 1), record.path);
      if (record.size > largeFileWarningBytes) addFinding('warning', 'large-file', { path: record.path, size: record.size });
    }

    const htmlPaths = [...exact.keys()].filter(path => HTML_EXTENSIONS.has(extensionOf(path))).sort((a, b) => a.localeCompare(b, 'en'));
    const detection = detectStartHtml(htmlPaths);
    let selectedEntry = entryHtml ? normalizeVirtualPath(entryHtml) : detection.selected;
    if (!selectedEntry || !exact.has(selectedEntry) || !HTML_EXTENSIONS.has(extensionOf(selectedEntry))) {
      addFinding('block', 'entry-html-missing', { path: selectedEntry || '' });
      selectedEntry = '';
    }
    if (detection.ambiguous) addFinding('warning', 'entry-html-ambiguous', { path: selectedEntry });
    if (htmlPaths.length > 1) addFinding('warning', 'additional-html-files', { path: selectedEntry, count: htmlPaths.length - 1 });

    if (selectedEntry) queued.push({ path: selectedEntry, kind: 'html' });
    let scannedCount = 0;
    while (queued.length) {
      throwIfAborted(options.signal);
      const item = queued.shift();
      const scanKey = `${item.kind}:${item.path}`;
      if (scanned.has(scanKey)) continue;
      scanned.add(scanKey);
      const record = exact.get(item.path);
      if (!record) continue;
      const text = await readRecordText(record);
      if (item.kind === 'html') scanHtml(text, item.path);
      else if (item.kind === 'css') scanCss(text, item.path);
      else if (item.kind === 'javascript') scanJavaScript(text, item.path);
      scannedCount += 1;
      reportProgress(options, 'analyze-scan', scannedCount, Math.max(scannedCount + queued.length, 1), item.path);
      if (scannedCount % 25 === 0) await Promise.resolve();
    }

    const blocks = findings.filter(item => item.severity === 'block');
    const warnings = findings.filter(item => item.severity === 'warning');
    const status = blocks.length ? 'blocked' : warnings.length ? 'review' : 'convertible';
    reportProgress(options, 'analyze-done', 1, 1);
    return {
      status,
      entryHtml: selectedEntry,
      findings,
      dependencies,
      counts: { block: blocks.length, warning: warnings.length, dependencies: dependencies.length, scanned: scanned.size },
      analyzedAt: new Date().toISOString()
    };
  }


  function mimeTypeForPath(path) {
    const ext = extensionOf(path);
    const byExtension = {
      html: 'text/html;charset=utf-8', htm: 'text/html;charset=utf-8', css: 'text/css;charset=utf-8', js: 'text/javascript;charset=utf-8',
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon',
      woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
      mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac',
      mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/x-m4v', ogv: 'video/ogg',
      txt: 'text/plain;charset=utf-8', json: 'application/json;charset=utf-8'
    };
    return byExtension[ext] || 'application/octet-stream';
  }

  function bytesToBase64(input) {
    const bytes = toUint8Array(input);
    if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') return Buffer.from(bytes).toString('base64');
    let binary = '';
    const chunk = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunk) {
      const part = bytes.subarray(offset, Math.min(bytes.length, offset + chunk));
      binary += String.fromCharCode(...part);
    }
    return btoa(binary);
  }

  async function readRecordBytes(record) {
    if (!record) return new Uint8Array();
    if (record.bytes != null) return new Uint8Array(toUint8Array(record.bytes));
    if (record.file && typeof record.file.arrayBuffer === 'function') return new Uint8Array(await record.file.arrayBuffer());
    if (typeof record.text === 'string') return new TextEncoder().encode(record.text);
    if (typeof record.text === 'function') return new TextEncoder().encode(await record.text());
    return new Uint8Array();
  }

  async function dataUriForRecord(record, path) {
    const bytes = await readRecordBytes(record);
    return `data:${mimeTypeForPath(path)};base64,${bytesToBase64(bytes)}`;
  }

  async function replaceAsync(text, regex, replacer) {
    const source = String(text || '');
    const matches = [];
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(source))) {
      matches.push({ match, index: match.index });
      if (match[0] === '') regex.lastIndex += 1;
    }
    if (!matches.length) return source;
    const replacements = await Promise.all(matches.map(item => replacer(item.match, item.index)));
    let output = '';
    let cursor = 0;
    for (let index = 0; index < matches.length; index += 1) {
      const item = matches[index];
      output += source.slice(cursor, item.index) + replacements[index];
      cursor = item.index + item.match[0].length;
    }
    return output + source.slice(cursor);
  }

  function replaceTagAttribute(tagSource, attributeName, value) {
    const tag = String(tagSource || '');
    const escaped = String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const re = new RegExp(`(\\s${attributeName}\\s*=\\s*)(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'i');
    if (re.test(tag)) return tag.replace(re, `$1"${escaped}"`);
    const closeIndex = tag.lastIndexOf('>');
    if (closeIndex < 0) return tag;
    const insertAt = tag[closeIndex - 1] === '/' ? closeIndex - 1 : closeIndex;
    return `${tag.slice(0, insertAt)} ${attributeName}="${escaped}"${tag.slice(insertAt)}`;
  }

  function outputFilenameForEntry(entryHtml) {
    const base = (String(entryHtml || 'index.html').split('/').pop() || 'index.html').replace(/\.html?$/i, '');
    const safe = base.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/g, '').trim() || 'index';
    return `${safe}-offline.html`;
  }

  function decodeTextDataUri(value) {
    const uri = String(value || '');
    if (!/^data:/i.test(uri)) return null;
    const comma = uri.indexOf(',');
    if (comma < 0) return null;
    const meta = uri.slice(5, comma);
    const body = uri.slice(comma + 1);
    try {
      if (/;base64(?:;|$)/i.test(meta)) {
        if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') return Buffer.from(body, 'base64').toString('utf8');
        const binary = atob(body);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        return new TextDecoder().decode(bytes);
      }
      return decodeURIComponent(body);
    } catch (_) {
      return null;
    }
  }

  async function verifyPackagedHtml(html, filename = 'index-offline.html', options = {}) {
    const output = String(html || '');
    const outputName = normalizeVirtualPath(filename || 'index-offline.html');
    const bytes = new TextEncoder().encode(output).byteLength;
    const reanalysis = await analyzeProject([{ path: outputName, text: output, size: bytes }], outputName, { largeFileWarningBytes: Number.MAX_SAFE_INTEGER, enforceInputLimits: false });
    const findings = [];
    const findingKeys = new Set();

    function addFinding(severity, code, data = {}) {
      const key = [severity, code, data.path || '', data.target || '', data.detail || ''].join('|');
      if (findingKeys.has(key)) return;
      findingKeys.add(key);
      findings.push({ severity, code, ...data });
    }

    for (const item of reanalysis.findings) addFinding(item.severity, item.code, item);

    const embeddedFiles = new Set((options.embeddedFiles || []).map(value => normalizeVirtualPath(value)));
    const sourceAnalysis = options.sourceAnalysis || options.analysis || null;
    if (sourceAnalysis && Array.isArray(sourceAnalysis.dependencies)) {
      for (const dependency of sourceAnalysis.dependencies) {
        const actual = dependency && dependency.actual ? normalizeVirtualPath(dependency.actual) : '';
        if (!actual || actual === normalizeVirtualPath(sourceAnalysis.entryHtml || '')) continue;
        if (!embeddedFiles.has(actual)) {
          addFinding('block', 'generated-dependency-not-embedded', {
            path: dependency.from || sourceAnalysis.entryHtml || '',
            target: dependency.requested || actual,
            resolved: actual,
            detail: dependency.kind || ''
          });
        }
      }
    }

    let embeddedStylesheets = 0;
    const linkRe = /<link\b[^>]*>/gi;
    let match;
    while ((match = linkRe.exec(output))) {
      const attrs = parseHtmlAttributes(match[0]);
      const rel = (attrs.rel || '').toLowerCase().split(/\s+/).filter(Boolean);
      const href = attrs.href || '';
      if (!rel.includes('stylesheet') || !/^data:text\/css(?:[;,]|$)/i.test(href)) continue;
      embeddedStylesheets += 1;
      const css = decodeTextDataUri(href);
      if (css == null) {
        addFinding('block', 'generated-css-data-invalid', { path: outputName, target: 'embedded stylesheet' });
        continue;
      }
      const references = [];
      const importRe = /@import\s+(?:url\(\s*)?(?:"([^"]+)"|'([^']+)'|([^\s);]+))\s*\)?[^;]*;/gi;
      let cssMatch;
      while ((cssMatch = importRe.exec(css))) references.push({ target: cssMatch[1] || cssMatch[2] || cssMatch[3] || '', kind: 'css-import' });
      const urlRe = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s][^)]*))\s*\)/gi;
      while ((cssMatch = urlRe.exec(css))) references.push({ target: (cssMatch[1] ?? cssMatch[2] ?? cssMatch[3] ?? '').trim(), kind: 'css-url' });
      for (const reference of references) {
        const target = reference.target;
        if (!target || target.startsWith('#')) continue;
        const classified = classifyReference(target);
        if (classified.kind === 'ignored') continue;
        if (classified.kind === 'local') addFinding('block', 'generated-css-unresolved-reference', { path: outputName, target, detail: reference.kind });
        else if (classified.kind === 'external') addFinding('block', 'generated-css-external-reference', { path: outputName, target, detail: reference.kind });
        else addFinding('warning', 'generated-css-unsupported-reference', { path: outputName, target, detail: classified.scheme || reference.kind });
      }
    }

    const anchorRe = /<a\b[^>]*>/gi;
    while ((match = anchorRe.exec(output))) {
      const attrs = parseHtmlAttributes(match[0]);
      const href = attrs.href || '';
      if (!href) continue;
      const resolved = resolveVirtualReference(outputName, href);
      if (resolved.kind === 'local' && resolved.path !== outputName) {
        addFinding('block', 'generated-local-link-reference', { path: outputName, target: href, resolved: resolved.path });
      }
    }

    const blocks = findings.filter(item => item.severity === 'block');
    const warnings = findings.filter(item => item.severity === 'warning');
    return {
      status: blocks.length ? 'blocked' : warnings.length ? 'review' : 'verified',
      findings,
      reanalysis,
      counts: {
        block: blocks.length,
        warning: warnings.length,
        reanalyzedReferences: reanalysis.counts.dependencies,
        sourceDependencies: sourceAnalysis?.dependencies?.length || 0,
        embeddedFiles: embeddedFiles.size,
        embeddedStylesheets
      },
      verifiedAt: new Date().toISOString()
    };
  }

  async function packageProject(records, entryHtml, options = {}) {
    const files = Array.isArray(records) ? records : [];
    throwIfAborted(options.signal);
    assertInputLimits(files, options);
    reportProgress(options, 'package-prepare', 0, 1);
    const analysis = options.analysis || await analyzeProject(files, entryHtml, options);
    if (analysis.status !== 'convertible') {
      throw new PackagerInputError('package-not-convertible', '確認事項または変換できない理由が残っているため、HTMLを作成できません。', analysis.status);
    }

    const exact = new Map();
    for (const source of files) {
      const path = normalizeVirtualPath(source.path);
      exact.set(path, { ...source, path, size: Number(source.size ?? source.bytes?.byteLength ?? 0) || 0 });
    }
    const selectedEntry = normalizeVirtualPath(entryHtml || analysis.entryHtml);
    const entryRecord = exact.get(selectedEntry);
    if (!entryRecord) throw new PackagerInputError('entry-html-missing', '開始するHTMLが見つかりません。', selectedEntry);

    const embedded = new Set();
    const cssCache = new Map();
    const uriCache = new Map();
    const progressTargets = new Set((analysis.dependencies || []).map(item => item.actual).filter(Boolean).filter(path => path !== selectedEntry));
    const progressTotal = Math.max(progressTargets.size, 1);
    function markEmbedded(path) {
      if (!embedded.has(path)) {
        embedded.add(path);
        reportProgress(options, 'package-embed', embedded.size, progressTotal, path);
      }
    }

    function requireLocal(fromPath, rawTarget, baseHref = '') {
      const resolved = resolveVirtualReference(fromPath, rawTarget, baseHref);
      if (resolved.kind !== 'local' || !exact.has(resolved.path)) {
        throw new PackagerInputError('package-reference-unresolved', '単一HTMLへ取り込めないファイル参照があります。', `${fromPath} -> ${rawTarget}`);
      }
      return resolved.path;
    }

    async function assetDataUri(path) {
      throwIfAborted(options.signal);
      if (uriCache.has(path)) return uriCache.get(path);
      const record = exact.get(path);
      if (!record) throw new PackagerInputError('package-file-missing', '必要なファイルが見つかりません。', path);
      const uri = await dataUriForRecord(record, path);
      throwIfAborted(options.signal);
      uriCache.set(path, uri);
      markEmbedded(path);
      return uri;
    }

    async function rewriteCss(text, cssPath, stack = new Set()) {
      let output = String(text || '');
      const importRe = /@import\s+(?:url\(\s*)?(?:"([^"]+)"|'([^']+)'|([^\s);]+))\s*\)?\s*([^;]*);/gi;
      output = await replaceAsync(output, importRe, async match => {
        const target = match[1] || match[2] || match[3] || '';
        const media = (match[4] || '').trim();
        const resolved = resolveVirtualReference(cssPath, target);
        if (resolved.kind === 'ignored') return match[0];
        const importedPath = requireLocal(cssPath, target);
        if (stack.has(importedPath)) throw new PackagerInputError('css-import-cycle', 'CSSの読み込みが循環しています。', importedPath);
        const imported = await inlineCss(importedPath, new Set([...stack, cssPath]));
        markEmbedded(importedPath);
        return media ? `@media ${media}{\n${imported}\n}` : imported;
      });
      const urlRe = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s][^)]*))\s*\)/gi;
      output = await replaceAsync(output, urlRe, async match => {
        const target = (match[1] ?? match[2] ?? match[3] ?? '').trim();
        if (!target || target.startsWith('#')) return match[0];
        const classified = classifyReference(target);
        if (classified.kind === 'ignored') return match[0];
        const assetPath = requireLocal(cssPath, target);
        return `url("${await assetDataUri(assetPath)}${fragmentSuffix(target)}")`;
      });
      return output;
    }

    async function inlineCss(path, stack = new Set()) {
      if (cssCache.has(path)) return cssCache.get(path);
      if (stack.has(path)) throw new PackagerInputError('css-import-cycle', 'CSSの読み込みが循環しています。', path);
      const record = exact.get(path);
      const text = await readRecordText(record);
      const rewritten = await rewriteCss(text, path, new Set([...stack, path]));
      cssCache.set(path, rewritten);
      return rewritten;
    }

    let html = await readRecordText(entryRecord);
    throwIfAborted(options.signal);
    reportProgress(options, 'package-prepare', 1, 1, selectedEntry);
    let baseHref = '';
    const baseTag = html.match(/<base\b[^>]*>/i);
    if (baseTag) baseHref = parseHtmlAttributes(baseTag[0]).href || '';

    const linkRe = /<link\b[^>]*>/gi;
    html = await replaceAsync(html, linkRe, async match => {
      const tag = match[0];
      const attrs = parseHtmlAttributes(tag);
      const href = attrs.href || '';
      if (!href) return tag;
      const rel = (attrs.rel || '').toLowerCase().split(/\s+/).filter(Boolean);
      if (rel.includes('stylesheet')) {
        const cssPath = requireLocal(selectedEntry, href, baseHref);
        const css = await inlineCss(cssPath);
        const uri = `data:text/css;charset=utf-8;base64,${bytesToBase64(new TextEncoder().encode(css))}`;
        markEmbedded(cssPath);
        return replaceTagAttribute(tag, 'href', uri);
      }
      if (rel.some(value => ['icon', 'shortcut', 'apple-touch-icon', 'mask-icon', 'preload'].includes(value))) {
        const resolved = resolveVirtualReference(selectedEntry, href, baseHref);
        if (resolved.kind === 'local' && exact.has(resolved.path)) return replaceTagAttribute(tag, 'href', `${await assetDataUri(resolved.path)}${fragmentSuffix(href)}`);
      }
      return tag;
    });

    const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\s*\/\s*script\s*>/gi;
    html = await replaceAsync(html, scriptRe, async match => {
      const tag = match[0];
      const opening = tag.slice(0, tag.indexOf('>') + 1);
      const attrs = parseHtmlAttributes(opening);
      if (!attrs.src) return tag;
      const scriptPath = requireLocal(selectedEntry, attrs.src, baseHref);
      const uri = await assetDataUri(scriptPath);
      const rewrittenOpening = replaceTagAttribute(opening, 'src', uri);
      return `${rewrittenOpening}${match[2] || ''}<` + `/script>`;
    });

    const resourceSpecs = [
      ['img', ['src', 'srcset']], ['source', ['src', 'srcset']], ['video', ['src', 'poster']],
      ['audio', ['src']], ['track', ['src']], ['input', ['src']]
    ];
    for (const [tagName, attributes] of resourceSpecs) {
      const tagRe = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
      html = await replaceAsync(html, tagRe, async match => {
        let tag = match[0];
        let attrs = parseHtmlAttributes(tag);
        for (const attr of attributes) {
          const value = attrs[attr];
          if (!value) continue;
          if (attr === 'srcset') {
            const candidates = [];
            for (const candidate of parseSrcset(value)) {
              const ref = resolveVirtualReference(selectedEntry, candidate.url, baseHref);
              const descriptor = candidate.descriptor ? ` ${candidate.descriptor}` : '';
              if (ref.kind === 'local') {
                const uri = await assetDataUri(requireLocal(selectedEntry, candidate.url, baseHref));
                candidates.push(`${uri}${fragmentSuffix(candidate.url)}${descriptor}`);
              } else {
                candidates.push(`${candidate.url}${descriptor}`);
              }
            }
            tag = replaceTagAttribute(tag, attr, candidates.join(', '));
          } else {
            const ref = resolveVirtualReference(selectedEntry, value, baseHref);
            if (ref.kind === 'local') {
              const uri = await assetDataUri(requireLocal(selectedEntry, value, baseHref));
              tag = replaceTagAttribute(tag, attr, `${uri}${fragmentSuffix(value)}`);
            }
          }
          attrs = parseHtmlAttributes(tag);
        }
        return tag;
      });
    }

    const anchorRe = /<a\b[^>]*>/gi;
    html = await replaceAsync(html, anchorRe, async match => {
      const tag = match[0];
      const attrs = parseHtmlAttributes(tag);
      const href = attrs.href || '';
      if (!href) return tag;
      const resolved = resolveVirtualReference(selectedEntry, href, baseHref);
      if (resolved.kind === 'local' && resolved.path === selectedEntry) {
        return replaceTagAttribute(tag, 'href', queryFragmentSuffix(href) || '#');
      }
      return tag;
    });

    const styleRe = /<style\b([^>]*)>([\s\S]*?)<\s*\/\s*style\s*>/gi;
    html = await replaceAsync(html, styleRe, async match => {
      const opening = match[0].slice(0, match[0].indexOf('>') + 1);
      const css = await rewriteCss(match[2] || '', selectedEntry);
      return `${opening}${css}<` + `/style>`;
    });

    const styleAttrRe = /\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
    html = await replaceAsync(html, styleAttrRe, async match => {
      const css = await rewriteCss(match[1] || match[2] || '', selectedEntry);
      const escaped = css.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      return ` style="${escaped}"`;
    });

    if (!/^\s*<!doctype\b/i.test(html)) html = `<!doctype html>\n${html}`;
    const outputBytes = new TextEncoder().encode(html).byteLength;
    const embeddedFiles = [...embedded].sort((a, b) => a.localeCompare(b, 'en'));
    const filename = outputFilenameForEntry(selectedEntry);
    throwIfAborted(options.signal);
    reportProgress(options, 'package-verify', 0, 1);
    const verification = await verifyPackagedHtml(html, filename, { sourceAnalysis: analysis, embeddedFiles });
    throwIfAborted(options.signal);
    reportProgress(options, 'package-verify', 1, 1);
    if (verification.status === 'blocked') {
      const detail = verification.findings.filter(item => item.severity === 'block').slice(0, 8).map(item => `${item.code}${item.target ? `: ${item.target}` : ''}`).join('\n');
      throw new PackagerInputError('package-verification-failed', '作成したHTMLの確認で問題が見つかったため、保存用HTMLは作成しませんでした。', detail);
    }
    reportProgress(options, 'package-done', 1, 1);
    return {
      html,
      filename,
      mime: 'text/html;charset=utf-8',
      size: outputBytes,
      entryHtml: selectedEntry,
      embeddedFiles,
      analysis,
      verification
    };
  }

  function classifyPath(path) {
    const ext = extensionOf(path);
    if (HTML_EXTENSIONS.has(ext)) return 'html';
    if (ext === 'css') return 'css';
    if (['js', 'mjs', 'cjs'].includes(ext)) return 'javascript';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'ico'].includes(ext)) return 'image';
    if (['woff', 'woff2', 'ttf', 'otf'].includes(ext)) return 'font';
    if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'].includes(ext)) return 'audio';
    if (['mp4', 'webm', 'mov', 'm4v', 'ogv'].includes(ext)) return 'video';
    if (ext === 'json') return 'json';
    return 'other';
  }

  const api = Object.freeze({
    PackagerInputError,
    DEFAULT_LIMITS,
    assertInputLimits,
    normalizeVirtualPath,
    assertSafeArchivePath,
    stripCommonRoot,
    detectStartHtml,
    extensionOf,
    classifyPath,
    stripUrlSuffix,
    resolveVirtualReference,
    parseHtmlAttributes,
    parseSrcset,
    splitSrcset,
    fragmentSuffix,
    queryFragmentSuffix,
    analyzeProject,
    packageProject,
    verifyPackagedHtml,
    mimeTypeForPath,
    outputFilenameForEntry,
    crc32,
    supportsDeflateRaw,
    readZip
  });

  global.OfflineWebPackagerCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
