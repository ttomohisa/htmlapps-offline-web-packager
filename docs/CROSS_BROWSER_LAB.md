# Offline Web Packager — Cross-browser Regression Lab

This lab is for v0.8.0 and later. It verifies the behavior that differs most often between desktop and mobile browsers without sending test files to a server.

## Target matrix

Run the same checks on current stable versions of:

| Platform | Browser | Direct app `file://` | Folder input | ZIP input | Generate / save | Generated HTML `file://` |
| --- | --- | --- | --- | --- | --- | --- |
| Windows | Chrome | ☐ | ☐ | ☐ | ☐ | ☐ |
| Windows | Edge | ☐ | ☐ | ☐ | ☐ | ☐ |
| Windows / macOS / Linux | Firefox | ☐ | ☐ | ☐ | ☐ | ☐ |
| macOS | Safari | ☐ | ☐ | ☐ | ☐ | ☐ |
| Android | Chrome | ☐ | ☐ | ☐ | ☐ | ☐ |
| iOS / iPadOS | Safari | ☐ | ☐ | ☐ | ☐ | ☐ |

Record the browser version, OS version, device, test date, and any deviation next to the checked result before v0.9.0 is released.

## 1. Browser smoke lab

Open `tests/browser-smoke.html` directly from local storage. It must run without a web server and without external network access.

Expected:

- Core script loaded → PASS
- Opened from `file://` → PASS
- Blob URL save capability → PASS on supported release targets
- AbortController → PASS
- TextEncoder / TextDecoder → PASS
- Generated HTML smoke check → PASS
- Folder picker / folder Drag & Drop / compressed ZIP / download support may be PASS or INFO depending on the browser; the application must provide the documented fallback rather than failing silently.

## 2. App `file://` flow

Open `dist/index.html` directly.

1. Switch Japanese ↔ English.
2. Open and close Help with keyboard only.
3. Load `tests/fixture-zips/01-inline-only.zip`.
4. Confirm **Can be combined into one HTML file**.
5. Create HTML.
6. Confirm post-build verification succeeds.
7. Save HTML.
8. Clear the input.

No page asset or runtime dependency should require HTTP(S).

## 3. Folder input

Use `tests/fixtures/03-path-css` with the Folder button.

Expected:

- nested folders and Japanese filenames retain their relative paths;
- fixture 03 is packageable;
- if the browser cannot preserve relative folder paths, the Folder button is disabled or the operation stops with a plain-language instruction to use ZIP instead;
- the app never flattens the folder silently.

## 4. Drag & Drop

Desktop only where OS/browser Drag & Drop is available.

Test:

- one HTML file;
- one ZIP;
- fixture 03 folder;
- ZIP mixed with another file.

Expected:

- directory drops use `getAsEntry()` when available or `webkitGetAsEntry()` otherwise;
- ordinary file drops still work when directory entries are unavailable;
- mixed ZIP input is rejected with an explanatory message.

## 5. ZIP behavior

Use fixtures 01–10 plus `99-path-traversal.zip`.

Expected:

- STORE entries work without a DEFLATE API;
- DEFLATE entries work when `DecompressionStream('deflate-raw')` is supported;
- a browser without DEFLATE support gets a normal error that recommends folder input or a STORE-only ZIP;
- path traversal remains rejected;
- progress / cancellation remain functional.

## 6. Generated HTML `file://`

Open the saved output from fixtures 01, 02, and 03 directly from local storage.

Expected:

- no missing local CSS / JS / image / font / favicon references;
- classic JavaScript from fixtures executes as expected;
- CSS `@import`, nested `url()`, root-relative paths, Japanese filenames, `srcset`, query suffixes, and SVG fragments remain resolved;
- no network request is required by the packaging operation itself.

## 7. Mobile checks

On Android Chrome and iOS Safari:

- no horizontal scrolling at phone width;
- header controls and bottom action do not overlap;
- Help and confirmation dialogs remain fully scrollable;
- long filenames do not break layout;
- Folder input either works with preserved paths or clearly redirects the user to ZIP;
- saving generated HTML results in a usable file or, on a browser without anchor-download support, opens the generated document in a new tab so the browser save/share action can be used.

## Automated regression

Run:

```bash
node tests/foundation.test.cjs
node tests/analyzer.test.cjs
node tests/packager.test.cjs
node tests/resolver.test.cjs
node tests/verification.test.cjs
node tests/ux.test.cjs
node tests/performance.test.cjs
node tests/cross-browser.test.cjs
```

The automated test verifies the browser-capability branches are present and prevents a future refactor from dropping the folder, Drag & Drop, ZIP, or save fallbacks. Actual Safari / iOS / Android UI behavior still requires a real browser/device run; do not mark those matrix cells complete based only on the Node test.
