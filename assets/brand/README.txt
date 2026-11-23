NEURA / PROMPT TO RESULT

Owner-approved artwork for the development harness.
A prompt chevron, then a lowercase n whose path jumps a small gap to land on a node:
you ask at the prompt, and Neura carries the signal through to a result. The n echoes
the wordmark. Replaces the earlier context-into-action arrow (2026-11-13).
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
neura-wordmark-pixel-dark.svg   Pixel wordmark, copper to bone, for dark surfaces (README).
neura-wordmark-pixel-light.svg  Pixel wordmark, copper to slate, for light surfaces (README).
terminal.txt              Half-block pixel wordmark used at terminal launch.
terminal-ascii.txt        >_ neura fallback for limited terminals.

TERMINAL INTEGRATION
src/brand.ts contains the pre-rendered launch wordmark: lowercase "neura" in
five-pixel half-block letters (owner choice, 2026-11-23). The two pixel SVGs use the
same grid. The other vector and PNG files show the earlier prompt-to-result mark. Startup does not load images,
discover fonts or add an image-rendering dependency. Normal interactive launch
shows the wordmark, colored copper to bone across its columns, with the version
on its baseline when it fits, then the status line and prompt, without a
readiness banner. NO_COLOR leaves it uncolored. Headless output stays clean.

Use --ascii for terminals with limited glyph support. TERM=dumb also selects ASCII.
If the full mark will not fit, the CLI uses the ASCII name instead. The last column
is reserved to avoid wrap-induced blank rows. The wordmark occupies three lines.
No emoji, Braille or private-use font glyph is needed.

Runtime tests were removed from the repository. If the mark changes, update
src/brand.ts, terminal.txt and both pixel SVGs together; they share one 29 x 5 grid.

HISTORICAL ARTWORK
agent/neura/launch-artwork.png retains its original bytes and provenance.
The retained Pi extension and old Windows Terminal configuration are not changed.
Artwork approval does not clear dependency licensing, distribution or production gates.
