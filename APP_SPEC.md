# Offline Web Packager — Product specification

## 1. Product identity

- **Name:** Offline Web Packager
- **Primary heading (Japanese):** Webページを1つのHTMLにまとめる
- **Purpose:** Inspect a local HTML file, ZIP, or web-page folder entirely in the browser, decide whether it can be packaged into one HTML file, explain blocking issues without pretending conversion succeeded, and package supported static pages.
- **Repository:** `ttomohisa/htmlapps-offline-web-packager`
- **Privacy model:** The app itself performs fully local processing. Input files are not uploaded. The runtime behavior of generated HTML remains dependent on the original HTML / JavaScript.
- **Release status:** v1.0.0 formal release

## 2. Product principles

- Do not execute loaded HTML or JavaScript during analysis.
- Do not open input automatically in an iframe.
- Do not evaluate scripts or register Service Workers.
- Do not call an input “safe”; this is not a malware scanner.
- Report only facts that static analysis can support.
- Keep technical terms such as ESM, CORS, Worker, and WASM under technical details where possible.
- Never generate a knowingly broken HTML and label it as successful.
- Runtime network access by this app is blocked with CSP (`connect-src 'none'`).

## 3. v1.0.0 inputs

- HTML file
- ZIP
- Folder
- Drag & Drop for the same inputs

## 4. v1.0.0 automatic packaging scope

Supported targets:

- HTML
- local external CSS
- classic local JavaScript
- CSS `@import`
- CSS `url(...)`
- HTML `srcset`
- PNG / JPEG / GIF / WebP / SVG and similar images
- WOFF / WOFF2 and similar fonts
- favicon
- static audio / video under size limits

Path resolution must cover relative paths, `../`, root-relative references, URL-encoded filenames, query / fragment suffixes, nested CSS references, and Japanese filenames.

## 5. v1.0.0 detected but not automatically converted

- runtime `fetch('./data.json')`
- ES Modules
- dynamic import
- `import.meta.url`
- Web Worker / SharedWorker
- WASM loader patterns
- Service Worker / PWA
- multi-page site integration
- local iframe
- React / Vue / Svelte source build
- npm package resolution
- automatic download of external URLs

## 6. Main result states

### Can be combined into one HTML file

All required local files are present and the page stays within the v1 supported scope. Enable **Create HTML**.

### Needs review

Examples: case mismatch, unusually large files, external links, or source that static analysis cannot classify with confidence.

### Cannot be made into one file as-is

Examples: missing required file, module script, runtime JSON fetch, Worker, or external CDN JavaScript. Explain the reason in ordinary language first and place technical details second.

## 7. Implemented development scopes

### v0.1.0 — Foundation / Input

Implemented in this version:

- Read one HTML file without executing it.
- Read one ZIP entirely in memory.
- Read a selected folder while preserving relative paths.
- Drag & Drop HTML / ZIP / folders where browser APIs allow it.
- Virtual file system backed by `File` / `Uint8Array` records.
- Normalize separators and dot segments.
- Reject ZIP path traversal, absolute paths, encrypted entries, symlinks, unsupported compression methods, malformed central-directory records, CRC mismatch, multi-disk ZIP, and ZIP64.
- Strip a single common top-level folder from folder / ZIP inputs.
- Detect a likely start HTML, preferring root `index.html`, while allowing the user to choose another candidate.
- Keep all file bytes in browser memory only; do not persist user files to localStorage.
- Japanese / English UI, keyboard focus, help dialog, replacement confirmation, error details, responsive mobile layout.

### v0.2.0 — Analyzer / Diagnostics

Implemented in v0.2.0:

- Follow supported local dependencies from the selected start HTML without executing page code.
- Resolve relative paths, parent segments, root-relative paths, URL encoding, query / fragment suffixes, nested CSS references, and `srcset`.
- Detect missing local files and case-only filename mismatches.
- Distinguish ordinary external links from required external subresources.
- Detect CSS `@import` / `url()` dependencies and classic external scripts.
- Detect ES Modules, dynamic import, `import.meta`, runtime `fetch`, XMLHttpRequest, Worker / SharedWorker, WASM loader patterns, Service Worker / PWA, local iframe, multi-page navigation, CSP, and dynamic resource assignment patterns.
- Present only three primary states: convertible, review, or blocked.
- Put technical detection codes and terms behind expandable details.
- Keep the Create HTML action disabled until the packager is implemented in v0.3.0.

### v0.3.0 — Core Packager

Implemented in this version:

- Generate one HTML file only when the current analyzer result is `convertible`.
- Embed local classic JavaScript as `data:` script sources.
- Embed local stylesheets as `data:` CSS after rewriting local CSS `url(...)` assets to `data:` URLs.
- Embed local images, favicon, fonts, and supported static media as `data:` URLs.
- Keep loaded HTML / JavaScript unexecuted during packaging; packaging is string / byte transformation only.
- Present an explicit completion state with filename, generated size, embedded-file count, and **Save HTML** action.
- Refuse packaging at the core API level when analyzer status is `review` or `blocked`.

### v0.4.0 — Path & CSS Resolver

Implemented in this version:

- Package fixture 03 end-to-end, including nested CSS `@import`, nested CSS `url(...)`, `../`, root-relative references, query / fragment suffixes, URL-encoded filenames, Japanese filenames, and `srcset`.
- Preserve URL fragments such as SVG `#view` / `#paint` after converting local resources to `data:` URLs.
- Parse `srcset` without breaking existing `data:` URL candidates that contain commas.
- Add dedicated path / CSS resolver regression coverage and require it in CI.

### v0.5.0 — Verification / Trust

Implemented in this version:

- Re-analyze the generated HTML as a one-file virtual project before normal output is returned.
- Treat links to separate local files as outside the one-file output unless a future version explicitly supports embedding them; preserve same-page HTML fragment links.
- Block output when generated markup still contains unresolved local references or another blocking analyzer finding.
- Decode embedded `data:text/css` stylesheets and reject remaining local / external `@import` or `url(...)` references.
- Compare source-analysis dependencies with the files actually embedded and block output if a required dependency was missed.
- Return a verification report with block / warning counts and show a factual post-build check in the completion UI.
- Do not describe the generated HTML as safe; runtime behavior still depends on the original HTML / JavaScript.
- Add verification regression tests and require them in CI.

### v0.6.0 — Mobile / UX / Accessibility

Implemented in this version:

- Show an explicit four-step workflow: Add files → Check → Create HTML → Save.
- Keep the current primary action reachable on narrow screens with a safe-area-aware bottom action bar.
- Do not let the bottom action bar cover the main content or footer.
- Use at least 44 px touch targets for header controls and 46 px for the mobile primary action.
- Restore focus after confirmation / help dialogs and move focus to the analysis result, error, or completion heading after state transitions where appropriate.
- Announce analysis result, errors, output completion, and save start through a dedicated `aria-live` region.
- Keep the explicit HTML / ZIP / Folder controls, and make the Drag & Drop surface keyboard-operable when it also acts as an HTML / ZIP file picker.
- Keep dialogs scrollable within the viewport on small screens.
- Refresh HTML / ZIP input icons so their purpose remains clear at mobile size.

### v0.7.0 — Performance / Large Inputs

Implemented in this version:

- Enforce a 2,000-file limit before a folder / virtual project is accepted.
- Enforce a 50 MB single-file limit and 100 MB total-input limit.
- Apply the same limits to ZIP input, including the ZIP file itself and its uncompressed contents.
- Inspect ZIP central-directory metadata before extraction and reject excessive file counts, expanded sizes, unsupported ZIP64, and suspicious expansion ratios.
- Report progress while indexing ZIP contents, extracting ZIP files, analyzing references, embedding assets, and verifying generated HTML.
- Allow ZIP extraction and HTML creation to be cancelled without presenting a partial output as successful.
- Let the user discard the generated HTML while keeping the input loaded, so the large generated string can be released from memory.
- Keep the loaded input unchanged when ZIP extraction is cancelled before commit.
- Add dedicated large-input / cancellation / progress regression coverage and require it in CI.


### v0.8.0 — Cross-browser / Regression Lab

Implemented in this version:

- Detect folder-picker support before exposing folder selection and recommend ZIP input when relative folder paths cannot be preserved.
- Accept both future `DataTransferItem.getAsEntry()` and current `webkitGetAsEntry()` for dropped directories, with ordinary file-drop fallback when directory entries are unavailable.
- Probe `DecompressionStream('deflate-raw')`, `Blob.stream()`, and `Response` before attempting DEFLATE ZIP extraction; STORE-only ZIPs remain readable without that capability.
- Detect Blob URL and anchor `download` support before saving generated HTML; browsers without `download` use a new-tab fallback instead of silently failing.
- Show current browser capability results in Help without exposing implementation terms on the main workflow.
- Add `tests/browser-smoke.html`, a no-network `file://` smoke lab that checks runtime capabilities and an in-memory analyze → package → verify flow in the actual browser.
- Add dedicated cross-browser source regression checks and require them in CI.
- Document a reproducible Chrome / Edge / Safari / Firefox / Android / iOS manual regression matrix in `docs/CROSS_BROWSER_LAB.md`.

### v0.8.2 — Drag & Drop / output layout bugfix

- Prefer dropped `File` objects for ordinary HTML / ZIP files so direct `file://` use does not depend on `FileSystemFileEntry.file()`.
- Keep legacy entry traversal only for directory hierarchy, with a user-facing fallback when the browser blocks it under `file://`.
- Make the Drag & Drop surface click / Enter / Space selectable for HTML and ZIP.
- Constrain generated-result verification SVGs and copy layout so success-state artwork cannot expand to fill the panel.
- Add dedicated regression checks for these paths.

## 8. Roadmap acceptance criteria

### v0.1.0 — Foundation / Input

Fixtures 01–10 can all be loaded. Path traversal fixture is rejected. Start HTML is detected where present.

### v0.2.0 — Analyzer / Diagnostics

Detect missing files, external URLs, CSS dependencies, ES Modules, fetch, Worker, WASM, Service Worker, CSP, etc. Fixtures 01–03 are packageable and 04–10 are blocked with reasons.

### v0.3.0 — Core Packager

Inline CSS, classic JavaScript, images, favicon, fonts, and supported static assets. Fixture 01 / 02 output must work when opened directly with `file://`.

### v0.4.0 — Path & CSS Resolver

Handle `../`, root-relative paths, CSS imports / URLs, `srcset`, query / fragment, URL encoding, Japanese filenames, and nested CSS. Fixture 03 becomes packageable.

### v0.5.0 — Verification / Trust

Re-analyze generated HTML and block normal output when unresolved local references or conversion regressions remain.

### v0.6.0 — Mobile / UX / Accessibility

Polish empty, loading, success, review, unsupported, generating, complete, and error states. Verify Japanese / English, keyboard, focus, `aria-live`, and help dialog.

### v0.7.0 — Performance / Large Inputs

Initial policy: warn above 50 MB, total input limit 100 MB, single-file limit 50 MB, 2,000-file limit. Add progress, cancellation, memory release, and ZIP expansion limits.

### v0.8.0 — Cross-browser / Regression Lab

Verify Chrome, Edge, Safari, Firefox, Android, and iOS. Test app `file://` execution and generated HTML `file://` execution. Expand automated fixture regression.

### v0.9.0 — Release Candidate

Completed as the v1.0.0 release-validation pass: README / README.ja, favicon, Japanese and English screenshots, Third Party Notices, CHANGELOG, GitHub Actions / Pages, CSP, external-network checks, single-HTML generation, i18n coverage, and v1 acceptance regression.

### v1.0.0 — Formal Release

Released after the final regression and version / release asset updates. No new packaging scope was added after the release-candidate validation.

## 9. v1.0.0 quality bar

A user should be able to complete:

**Add files → Check whether they can be combined → Create HTML → Save**

without reading documentation. Unsupported pages must explain why rather than generating a broken result and presenting it as success.
