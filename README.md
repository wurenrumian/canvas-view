# Canvas View (Orca plugin)

An alternative image viewer for the Orca editor tab with **inverted gestures**:

| Gesture | Orca's built-in viewer | This plugin |
| --- | --- | --- |
| Wheel / two-finger scroll | pan | **zoom** (anchored at the pointer) |
| Drag (left button) | nothing (Alt+drag pans) | **pan** |
| Drag with Alt | pan | pan |
| Two-finger pinch / touch drag | zoom / pan | pan + pinch zoom |
| Double-click | fit ↔ 100% | fit ↔ 100% |
| `+` / `-` | — | zoom in / out |
| `0` or `F` | — | fit to view |
| `1` | — | actual size (100%) |
| Arrow keys | — | pan (Shift for a bigger step) |

## Coverage

- Raster images: `.png` `.apng` `.jpg` `.jpeg` `.gif` `.webp` `.bmp` `.ico` `.avif`
- SVG: registered twice (text and bytes) because Orca may hand an SVG to a custom
  editor either way; only the matching contribution is ever eligible.

It takes over the **editor tab** viewer. It does not apply to images opened inside
markdown previews, the chat lightbox, image diffs, artifacts, or terminal images —
Orca has no extension point for those surfaces.

## How the hand-off works

`contributes.customEditors` with `priority: "default"` replaces Orca's built-in viewer
for the listed extensions. The built-in viewer stays available in the editor's view
toggle (the choice is remembered per file), so one click switches back for the file
you are looking at.

The editor frame receives the document through `orca.document.onDidChange`:

- `content.kind === "bytes"` → raw `ArrayBuffer` + `fileType`, turned into a `blob:` URL
- `content.kind === "text"` → SVG markup, turned into an `image/svg+xml` blob

No file path or filesystem access is requested, and nothing is ever written back.

## Develop / install

```bash
# validate the manifest and contributions
orca plugin validate . --json

# what it contributes and what access it asks for
orca plugin inspect . --json

# live reload while editing editor/viewer.html
orca plugin dev watch . --json
```

Installing is a `sandboxed-ui` plugin, so Orca asks for approval: the editor reads
every file it opens. Approve only this plugin.

## Verify the gestures

`test/run-harness.mjs` loads the real `editor/viewer.html` in headless Chrome with a
mocked `orca.document`, then drives wheel, drag and double-click and asserts the
resulting transform. It runs twice: once with a `bytes` document (PNG) and once with
a `text` document (SVG).

```bash
node test/run-harness.mjs
```

Set `CHROME_PATH` if Chrome is installed somewhere else.

## Notes

- Zoom is clamped to 2% – 6400% of the natural size.
- The image is kept partially on screen (at least ~64 px in each axis) while panning,
  so it cannot be dragged completely out of view.
- Transparent images get a subtle checkerboard background.
- Colors follow Orca's theme through `--orca-background`, `--orca-foreground` and
  `--orca-border`.

## License

MIT — see [LICENSE](LICENSE).
