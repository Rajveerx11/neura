# Support

Neura is experimental, community-supported software. No service-level,
compatibility, response-time, or production-support commitment is provided.

## Get help

1. Read [README.md](README.md), [docs/STATUS.md](docs/STATUS.md), and
   [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
2. Run documented verification commands and remove sensitive data from output.
3. Search existing [issues](https://github.com/Rajveerx11/neura/issues).
4. Open a bug report only when you have a reproducible defect.

Include Neura version, Pi version, Windows version, relevant mode, minimal
reproduction, expected result, actual result, and redacted verification output.

Never post credentials, private repository content, memory, transcripts,
approval records, provider payloads, or personal paths. Report vulnerabilities
privately using [SECURITY.md](SECURITY.md).

Feature ideas may use feature-request form. General setup questions may be
closed when documentation already answers them or required evidence is missing.

## Common setup and learning problems

| Symptom | Check or next step |
|---|---|
| Work command or proof is unavailable | Verify WSL2/bubblewrap. Proof also needs its runner and packages available offline inside WSL. There is no automatic host fallback. |
| Learn reports a missing runtime | Check Node 24.10+ and the nested locked dependency install. Source development needs `npm ci --prefix agent/neura --ignore-scripts`; live provisioning is a separate intentional install. |
| Learn cannot create its store | First creation requires native Windows and an unlinked workspace. Existing unowned `.neura-learning` content is rejected; do not delete it blindly. |
| PPTX visuals or OCR are incomplete | Export the deck to PDF for full slide layouts. OCR supports English and can misread formulas or handwriting; inspect the preview. Legacy `.ppt` needs PDF/PPTX export. |
| Browser attempts do not appear in the terminal | Use the board's copy control and submit the command to Neura. Browser state does not auto-sync; stale lesson revisions are rejected. |
| Resumed citations say unverified | Reimport the original document. Snapshots preserve historical text, omit images, and do not prove current source contents. |
| Tools pause after session replacement | Earlier host work must drain before mode restoration. Do not bypass the mode gate; report a reproducible failure if it never completes. |
| A familiar command is unavailable | `/health`, `/undo`, memory, and skill scans are YOLO-only. `/ship` is Work/YOLO verification; it does not publish code. |

Start with the [documentation index](docs/README.md),
[Learn guide](docs/LEARN_MODE.md), or [verification guide](docs/VERIFICATION.md).
For a bug report, include the source commit as well as `VERSION`: unreleased
features share `2.5.1` with older source, so the version alone is insufficient.
