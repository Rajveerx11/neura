NEURA / CONTEXT INTO ACTION

Owner-approved artwork for the development harness.
Two curved incoming paths join one forward arrow: understand context, then act.
The lowercase wordmark uses original vector paths, not an external font.
The blue follows the existing owner-supplied artwork. No gradients are required.
Trademark clearance has not been performed.

FILES
neura-mark.svg             Transparent monochrome symbol.
neura-lockup.svg           Blue symbol and dark wordmark for light surfaces.
neura-lockup-mono.svg      Single-color lockup.
neura-wordmark.svg         Custom lowercase lettering, paths only.
neura-logo-dark.png        Logo on a dark surface.
neura-logo-light.png       Logo on a light surface.
terminal.txt              Half-block rendering of the vector mark.
terminal-ascii.txt        >_ neura fallback for limited terminals.

TERMINAL INTEGRATION
src/brand.ts contains the pre-rendered launch mark. Startup does not load images,
discover fonts or add an image-rendering dependency. Normal interactive launch
shows the uncolored logo, then the status line and prompt, without a readiness
banner. Headless output stays clean.

Use --ascii for terminals with limited glyph support. TERM=dumb also selects ASCII.
If the full mark will not fit, the CLI uses the ASCII name instead. The last column
is reserved to avoid wrap-induced blank rows. The mark occupies at most ten lines.
No color, emoji, Braille or private-use font glyph is needed.

The CLI tests compare src/brand.ts against both text assets and a test-only raster
of neura-mark.svg. That raster uses the existing locked Learn canvas package.
There is no runtime canvas import. Text assets must match exactly; the raster
check allows up to six cells of anti-aliasing noise because canvas releases render
edges differently (1.0.11 and 1.0.13 differ by four cells). Update the approved vector, text and launch
snapshot together if the mark changes.

HISTORICAL ARTWORK
agent/neura/launch-artwork.png retains its original bytes and provenance.
The retained Pi extension and old Windows Terminal configuration are not changed.
Artwork approval does not clear dependency licensing, distribution or production gates.
