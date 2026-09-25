# Changelog

## [1.0.0] - 2026-09-25

### Changed

- Restored the simple heading treatment and removed the extra hero chips introduced during the v0.8.2 UX refresh.
- Removed all UI gradients; the release UI uses solid surfaces, borders, spacing, and the Browser Kitty brand color instead.
- Kept the clearer input guidance, clickable Drag & Drop area, refined result actions, and other v0.8.2 usability improvements.
- Updated Japanese / English release copy, README screenshots, and formal-release metadata.

### Verified

- Ran Foundation, Analyzer, Packager, Resolver, Verification, UX, Performance, Cross-browser, Drag & Drop, and i18n regression suites.
- Rebuilt and checked readable standalone HTML and self-extracting HTML with `connect-src 'none'`.
- Confirmed favicon / header icon consistency, no unresolved build placeholders, no UI gradients, and no horizontal overflow at a 390 px mobile viewport.

## v0.8.2

- UX refresh: friendlier input flow, cleaner summary cards, improved helper guidance, and a more polished generated-result screen.
- Visual refresh: warmer hero card, refined panels, and more consistent button/card styling without becoming overly flashy.

## v0.8.1

- Fixed direct HTML/ZIP drag & drop when the standalone app is opened via `file://` by preferring the dropped `File` object instead of `FileSystemFileEntry.file()`.
- Made the drag & drop area clickable and keyboard-operable for choosing HTML or ZIP files.
- Added a clear fallback message for folder drag & drop when the browser blocks legacy entry traversal under `file://`.
- Fixed the generated-result verification icon/layout so the success check can never expand to fill the panel.

## [0.8.0] - 2026-09-25

### Added

- Added browser capability detection for folder selection, directory Drag & Drop, DEFLATE ZIP extraction, Blob URL saving, and the anchor `download` attribute.
- Added support for both `DataTransferItem.getAsEntry()` and `webkitGetAsEntry()` directory-drop paths.
- Added a new-tab save fallback when the browser cannot use the anchor `download` attribute.
- Added `tests/browser-smoke.html` for direct `file://` browser checks and an in-memory analyze → package → verify smoke test.
- Added `tests/cross-browser.test.cjs` and required it in CI / repository checks.
- Added `docs/CROSS_BROWSER_LAB.md` with a reproducible Chrome / Edge / Safari / Firefox / Android / iOS manual regression matrix.

### Changed

- Folder input is disabled when the browser cannot preserve folder-relative paths; the UI recommends ZIP instead of silently flattening the hierarchy.
- DEFLATE ZIP support now probes `DecompressionStream('deflate-raw')`, `Blob.stream()`, and `Response` before extraction.
- Help now reports browser-specific availability for folder selection, compressed ZIP extraction, and generated-HTML saving.

## [0.7.0] - 2026-09-25

### Added

- Added v0.7.0 large-input safeguards: 50 MB per file, 100 MB total input, and 2,000 files.
- Added ZIP preflight limits for uncompressed size, file count, and suspicious compression ratios before extraction.
- Added progress reporting for ZIP inspection/extraction, analysis, asset embedding, and post-build verification.
- Added cancellation for ZIP extraction and HTML creation.
- Added a generated-result discard action so the output HTML string can be released while keeping inputs loaded.
- Added `tests/performance.test.cjs` and required it in GitHub Actions / repository checks.

### Changed

- Kept the refreshed ZIP icon shape but restored the same Browser Kitty brand-color treatment used by the other input icons.
- Help and release metadata now describe the v0.7.0 Performance / Large Inputs stage.

All notable changes to this project are documented in this file.

## [0.6.0] - 2026-09-25

### Added

- Four-step workflow indicator for **Add files → Check → Create HTML → Save**.
- Mobile bottom action bar that keeps the current primary action reachable without covering page content.
- Dedicated `aria-live` status announcements for analysis results, output completion, errors, and save actions.
- UX regression checks for responsive actions, focus targets, touch targets, and the refreshed HTML / ZIP input icons.

### Changed

- Refreshed the HTML and ZIP input icons with clearer file / code and archive / zipper metaphors.
- Improved mobile spacing, 44 px header touch targets, dialog scrolling, safe-area handling, and long-content behavior.
- Improved focus management after analysis, errors, output creation, help dialog use, and mobile result navigation.
- The Drag & Drop surface is no longer exposed as a keyboard button; keyboard users use the explicit HTML / ZIP / Folder buttons instead.
- Help copy and release metadata now describe the v0.6.0 Mobile / UX / Accessibility stage.

## [0.5.0] - 2026-09-25

### Added

- Post-build verification that re-analyzes generated HTML before it is offered for saving.
- Embedded CSS verification for unresolved local / external `@import` and `url(...)` references.
- Dependency coverage verification that compares source-analysis dependencies with the files actually embedded.
- Completion-state verification message that reports factual post-build checks without claiming the generated HTML is safe.
- Dedicated verification regression tests required by GitHub Actions and repository checks.
- New Offline Web Packager favicon / header icon artwork supplied for this app.
- Detection for links to separate local files that would otherwise remain outside the one-file output.

### Fixed

- Rewrite same-page links such as `index.html#details` to `#details` so they remain valid after the output filename changes.

### Changed

- Header descriptor now says `Webページを1つのHTMLへ` / `Web pages into one HTML`; the existing fully-local badge is unchanged.
- Packaging progress now includes the post-build verification step.
- Blocking verification findings prevent the normal Save HTML output path.

## [0.4.0] - 2026-09-25

### Added

- End-to-end packaging regression for fixture 03 with nested CSS imports / URLs, parent and root-relative paths, URL-encoded and Japanese filenames, query / fragment suffixes, and `srcset`.
- Dedicated resolver regression tests for deep paths, local `<base>` resolution, out-of-root rejection, SVG fragments, and `srcset` containing existing data URLs.

### Fixed

- Preserve resource fragments such as SVG `#view` / `#paint` after local assets are converted to data URLs.
- Parse `srcset` candidates without splitting commas that belong to an existing data URL.

### Changed

- CI and repository checks now include the Path & CSS Resolver regression suite.
- Updated help, README, product specification, and release metadata for v0.4.0.

## [0.3.0] - 2026-09-24

### Added

- Core single-HTML packager for analyzer-approved static pages.
- Data-URI embedding for local classic JavaScript, images, favicon, fonts, and supported static media.
- CSS packaging that embeds local `url(...)` assets before the stylesheet is embedded.
- Create → complete → Save HTML UI with generated filename, output size, embedded-file count, and runtime-behavior notice.
- Packager regression tests for fixtures 01 / 02 and a guard that refuses blocked input.

### Changed

- Enabled **Create HTML** only when the analyzer result is `convertible`.
- Updated help, README, product specification, and CI regression steps for the Core Packager stage.

## [0.2.0] - 2026-09-24

### Added

- Static dependency analyzer that follows the selected start HTML through local CSS, classic JavaScript, images, fonts, favicon, media, `srcset`, CSS `@import`, and CSS `url()` references.
- Path resolution for `../`, root-relative URLs, URL-encoded filenames, query / fragment suffixes, nested CSS paths, and Japanese filenames.
- Three-state diagnostics UI: can be combined, review needed, or cannot be made into one file as-is.
- Missing-file, case-mismatch, external-resource, external-link, ES Modules, dynamic import, `import.meta`, fetch/XHR, Worker, WASM, Service Worker/PWA, local iframe, multi-page, CSP, and dynamic-resource detection.
- Plain-language Japanese / English explanations with expandable technical details.
- Analyzer regression tests: fixtures 01–03 convertible and 04–10 blocked with concrete reasons.

### Changed

- Updated the main UI and help content from input-only foundation wording to analyzer / diagnostics wording.
- Kept Create HTML disabled until v0.3.0 so unsupported or incomplete output is never presented as successful.

## [0.1.0] - 2026-09-24

### Added

- HTML, ZIP, and folder input with Drag & Drop.
- In-memory virtual file system with normalized relative paths.
- ZIP central-directory parsing, STORE / DEFLATE extraction, CRC32 verification, and common-root stripping.
- ZIP path traversal, absolute path, symlink, encryption, ZIP64, multi-disk, unsupported-method, malformed-data, and duplicate-path rejection.
- Start HTML auto-detection with manual candidate selection.
- Japanese / English responsive UI and help content.
- Fully local app runtime with `connect-src 'none'`; loaded HTML / JavaScript is not executed.
- Foundation regression fixtures 01–10 and malicious ZIP traversal fixture.
