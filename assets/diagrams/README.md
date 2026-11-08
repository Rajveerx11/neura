# Architecture image

[architecture.png](architecture.png) is the documentation-facing 2000 × 2000 PNG.
[architecture.svg](architecture.svg) is its editable source. This is an explanatory
source-architecture diagram, **not a screenshot** of Neura or T3 Code.

The diagram was checked against the active Mastra Work/Learn source on 2026-11-08.
Colors reuse `agent/neura/palette.ts`; no stock imagery, generated product mockup,
external font, script or remote asset is included. Runtime and data boundaries are
explained in the [architecture guide](../../docs/ARCHITECTURE.md).

## Refresh

Update the source and corresponding guide together. On native Windows, use the
existing `playwright-core` package and Microsoft Edge to open the SVG's `file:` URL
in an offline context with a 1000 × 1000 viewport and `deviceScaleFactor: 2`.
Wait for `document.fonts.ready`, check every text element's `getBBox()` against its
card and canvas, then capture the page to PNG. Inspect the actual result before
replacing the published image; keep the text alternative in Markdown synchronized.
No browser download or new dependency is required.
