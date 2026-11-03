# Canvas View (Orca plugin)

An alternative image viewer for the Orca editor tab with **inverted gestures**:

| Gesture | Orca's built-in viewer | This plugin |
| --- | --- | --- |
| Mouse wheel | pan | **zoom** (anchored at the pointer) |
| Trackpad two-finger scroll | pan | pan (unchanged) |
| Pinch / Ctrl+wheel | zoom | zoom |
| Drag (left button) | nothing (Alt+drag pans) | **pan** |
| Drag with Alt | pan | pan |
| Alt+wheel | — | force pan (override) |
| Double-click | fit ↔ 100% | fit ↔ 100% |
| `+` / `-` | — | zoom in / out |
| `0` or `F` | — | fit to view |
| `1` | — | actual size (100%) |
| Arrow keys | — | pan (Shift for a bigger step) |

Mouse wheel and trackpad are told apart from the shape of the wheel event: a mouse
sends one large step on its own, a trackpad sends a burst of small or horizontal
ones. Between the two the last device wins, so a single odd value cannot flip the
gesture mid-scroll. If the guess is ever wrong, `Alt+wheel` always pans and
`Ctrl`/`Cmd`+wheel always zooms.

## Settings

**Settings → Plugins → Canvas View → Mouse wheel**

| Value | Effect |
| --- | --- |
| Auto-detect (default) | Mouse wheel zooms, trackpad scroll pans, pinch zooms |
| Zoom | Every wheel event zooms, trackpad included |
| Pan | Every wheel event pans, mouse wheel included |

The choice is stored by Orca (capability `settings:own`) and applies to open tabs as
soon as it changes.

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
every file it opens, and `settings:own` lets it read the one setting above. Approve
only this plugin.

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
