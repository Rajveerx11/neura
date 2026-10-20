# Learn document runtime

Reviewed 2026-09-07. The nested `agent/neura/package.json` and lockfile contain
the document runtime; repository development dependencies remain separate.
Install with `npm ci --prefix agent/neura --ignore-scripts`. The Neura installer
must copy the manifest, lockfile, and worker alongside the TypeScript modules,
then run the same locked install in the generated `neura` directory. Do not copy
development `node_modules` or enable lifecycle scripts. Learn Mode requires Node 24.15+ for the SQLite authorizer;
the exercised Windows runtime is Node 24.16.0.

## Exact direct dependencies and source review

This review inspected the published packages installed from the lockfile. It is
a scoped review of the integration and entry points, not a complete audit of
PDF.js, Skia, or Tesseract's native/WASM implementations.

The 1.0.10 canvas refresh was source-reviewed on 2026-10-05 at upstream commit
`7d19abed029287e7c26b14eaa6e67d560a37d853`. The published `index.js`,
`js-binding.js`, and `load-image.js` are unchanged from 1.0.9, and neither the
wrapper nor the Windows x64 platform package has a consumer install hook.
The native refresh updates Skia and fixes saved-pattern lifetime handling and
deferred-recording memory retention. This is a scoped entry-point and upstream
change review, not a complete native-code audit. Registry integrity/signatures
and synthetic document tests must pass before merge. Rollback restores both
nested manifest and lockfile plus their release-manifest hashes before reinstall.

The 6.4.299 PDF.js refresh was reviewed on 2026-10-15 at published upstream
commit `d0991a0d53f3bb3a7307e3b83f279c1d117aafb3`. The published manifest has
no lifecycle scripts; its only dependency declaration change is the optional
canvas minimum from `^1.0.0` to `^1.0.10`, satisfied by the existing exact pin.
The scoped published-source review checked `legacy/build/pdf.mjs` document
options, Node binary-data factories, canvas integration, and local worker loading.
Captured document bytes, disabled system fonts and worker fetching, and local
font/CMap/WASM paths remain in use. The historical `isEvalSupported:false`
option is no longer consumed by either reviewed 6.3.289 or 6.4.299 and is not
an enforced security boundary. The 6.4.299 legacy bundles retain core-js's
`Function('return this')()` global-object fallback; that fixed fallback is
distinct from document-driven code generation. This entry-point review does
not establish a complete PDF.js/native/WASM audit or OS isolation.
Linux synthetic document validation passed all 43 assertions, including real
PDF rasterization, OCR, PPTX and malformed-input checks. The nested graph audit
reported no known vulnerabilities. Registry signatures verified all 21 installed packages and three attestations
after network access was restored; required CI and Windows validation remain
merge prerequisites. Rollback restores both nested dependency files, their
release-manifest hashes, and this version record before reinstalling.

The 1.0.11 canvas refresh was reviewed on 2026-10-20 against the official
`v1.0.10...v1.0.11` source comparison and installed manifest. Its runtime
Skia change uses append rather than extend for `Path2D.addPath`, preserving
separate subpaths. Upstream also changes build/SBOM tooling and adds platform
SBOM artifacts; this is not an exhaustive native/build provenance audit.
The published manifest has no consumer install hooks, and all optional native
platform packages remain exact-pinned at `1.0.11`. The existing byte-only inputs,
image limits and disabled font discovery remain required. The combined PDF.js
and canvas graph requires fresh document tests, audits/signatures and CI.
Rollback restores both nested dependency files and their release hashes together.

| Package | Version | License | Purpose and reviewed surface |
|---|---|---|---|
| `pdfjs-dist` | `6.4.299` | Apache-2.0 | Mozilla PDF.js parsing and raster operations. Reviewed `package.json`, `legacy/build/pdf.mjs` document options, Node resource factories, canvas integration, and worker loading. Use captured bytes, local fonts/CMaps/WASM, `isEvalSupported:false`, `useWorkerFetch:false`, and disabled system fonts. Never invoke document JavaScript, actions, attachments, or links. |
| `@napi-rs/canvas` | `1.0.11` | MIT | Skia-backed raster canvas. Reviewed `index.js`, `js-binding.js`, `load-image.js`, and platform package selection. Pass PNG/JPEG bytes, never paths or URLs. Filter image dimensions before decoding; disable automatic system/user font discovery in parser processes. Native bindings are still trusted executable dependencies. |
| `yauzl` | `3.4.0` | MIT | ZIP directory and streaming inflate. Reviewed `index.js` `fromBuffer`, lazy entry dispatch, filename validation, local entry reads, and size validation. Add aggregate/per-entry limits, CRC checks, duplicate/link/encryption rejection. Never extract ZIP entries to disk. |
| `saxes` | `6.0.0` | ISC | Namespace-aware XML. Reviewed `saxes.js` entry imports, SAX events, namespace handling, and entity errors. Its runtime dependency is `xmlchars`; no external entity resolver or network transport. Explicitly reject DTD/entity declarations before parsing; cap depth, nodes, XML bytes, and text. |
| `tesseract.js` | `7.0.0` | Apache-2.0 | Offline OCR. Reviewed `src/createWorker.js`, Node worker spawning, worker language loading, image input, and `worker-script/node/getCore.js`. Node loads the locked local `tesseract.js-core` WASM. Always supply an absolute installed language directory, `cacheMethod:'none'`, and image bytes. Default CDN and filesystem cache branches are not used. |
| `@tesseract.js-data/eng` | `1.0.0` | MIT | English trained data. Reviewed its `index.js`, package metadata, and local `4.0.0/eng.traineddata.gz` presence. Missing data produces an explicit warning and preserves previews; it never triggers a model download. |

Upstream sources: [PDF.js](https://github.com/mozilla/pdf.js),
[canvas](https://github.com/Brooooooklyn/canvas),
[yauzl](https://github.com/thejoshwolfe/yauzl),
[saxes](https://github.com/lddubeau/saxes),
[Tesseract.js](https://github.com/naptha/tesseract.js),
[Tesseract data](https://github.com/naptha/tessdata).

The lockfile pins every transitive version and registry integrity hash, including
platform canvas binaries, `tesseract.js-core`, and `xmlchars`. `npm audit` reported
zero known vulnerabilities for this nested graph on the review date. Registry
audit results are not a guarantee of dependency safety.

## Input, output, and process boundary

- Local ordinary `.pdf` and `.pptx` files inside the canonical workspace only.
  Reject URLs, UNC/device paths, alternate streams, linked parent directories,
  symlinks, hardlinks, hidden components, dependencies, sessions, and approvals.
- Capture bytes once with bounded reads and change checks. SHA-256 identifies
  those exact bytes; each page/slide retains its original 1-based number.
- Maximum 25 MiB input, 100 pages/slides, 3,000 ZIP entries, 64 MiB expanded ZIP,
  16 MiB per ZIP entry, 4 MiB per XML part, 80 XML nesting levels, and 100,000 XML
  nodes per part. Text caps: 100,000 characters per page or notes and one million
  overall. Oversized documents fail explicitly; they are not silently truncated.
- Preview images are PNG, at most 1,400 pixels on their longest side. Embedded
  images over 16 million pixels are skipped before decoding. Retain at most
  eight images per slide, 1 MiB per preview, and 8 MiB total image bytes. Omitted
  previews generate warnings. Total returned JSON is capped at 16 MiB.
- Disposable child process, 384 MiB V8 heap limit, 120-second deadline, and abort
  cleanup. The child receives only required Windows/temp variables and the font
  suppression flag, not parent credentials, `NODE_OPTIONS`, or binding overrides.
  Native/WASM allocations are outside the V8 heap cap. This is crash/time
  containment, **not an operating-system security sandbox**; hostile concurrent
  filesystem replacement and native parser vulnerabilities need stronger OS
  isolation than this personal-workspace feature provides.
- No arbitrary process commands, document writes, archives on disk, Office
  automation, document-provided network requests, or OCR downloads. Parser logs
  are suppressed so private document fragments do not leak through diagnostics.
- `validateLearningCitation` checks exact ID/name, page-versus-slide, number,
  and a whitespace-normalized excerpt from body text or notes. It proves source
  location and quoted wording, not the tutor's interpretation of that wording.

## Supported behavior and limitations

PDFs have extracted text plus real raster page previews. Image-only PDF pages
fall back to offline English OCR. PDF extraction order may differ from visual
reading order in multicolumn layouts. Password-protected PDFs require an unlocked
export. OCR may misread handwriting, diagrams, formulas, and non-English text;
the result carries an OCR warning. PDF images with a small amount of surrounding
selectable text do not currently receive additional OCR automatically.

PPTX uses presentation relationships for actual slide order and speaker notes;
embedded PNG/JPEG images receive previews and optional OCR. It does **not** render
the whole slide layout, master slides, charts, SmartArt, formulas, animations,
SVG/EMF, or embedded objects. Export to PDF for faithful complete slide visuals.
External media and active content are ignored with warnings. Legacy `.ppt`
requires an explicit `.pptx` or PDF export; no converter is launched.

## Verification

`node scripts/verify-learn-materials.mjs` generates only synthetic fixtures in a
temporary directory. Covered: two-page text PDF and previews, scanned PDF and
real English OCR, missing-model fallback, PPTX order/notes/images/OCR, source ID
stability, valid and forged citations, disabled images/OCR, source and ZIP path
attacks, hidden directories, junctions/hardlinks, oversized files/images/archives,
bad XML/entities/checksums, legacy PPT diagnostics, and cancellation. Fixture
builders are exported from `scripts/learn-material-fixtures.mjs` for integrated
Learn tool tests. No private learning materials are committed.
