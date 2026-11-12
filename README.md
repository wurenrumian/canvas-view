# Canvas View (Orca plugin)

An alternative image viewer for the Orca editor tab with **inverted gestures**:

| Gesture | Orca's built-in viewer | This plugin |
| --- | --- | --- |
| Mouse wheel | pan | **zoom** (anchored at the pointer) |
| Trackpad two-finger scroll | pan | pan (unchanged) |
| Pinch / Ctrl+wheel | zoom | zoom |
| Drag (left button) | nothing (Alt+drag pans) | **pan** |
| Middle-drag | nothing | pan |
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

There is no preference to set: the plugin asks for no capabilities, so the editor
only ever reads the file you open.

## Coverage

- Raster images: `.png` `.apng` `.jpg` `.jpeg` `.gif` `.webp` `.bmp` `.ico` `.avif`
- SVG: one `text` contribution. Orca matches a custom editor by file name (extension
  or exact name) only, and `contentKind` decides how the file is handed over, not
  which editor is eligible — registering `.svg` twice only added a second, identical
  "Canvas" entry to the editor's view toggle.

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
npm run validate

# static checks for the editor entry (syntax, imports, refused code)
npm run check

# what it contributes and what access it asks for
orca plugin inspect . --json

# live reload while editing editor/viewer.html
orca plugin dev watch . --json

# the gesture harness (headless Chrome, no Orca needed)
npm test
```

Installing is a `sandboxed-ui` plugin, so Orca asks for approval: the editor reads
every file it opens. Approve only this plugin. It asks for no capabilities, so an
update never re-prompts for new access.

## Verify the gestures

`test/run-harness.mjs` loads the real `editor/viewer.html` in headless Chrome with a
mocked `orca.document`, then drives wheel, drag, keyboard, pinch, a re-sent document
and a broken file, and asserts the resulting transform. It runs twice: once with a
`bytes` document (PNG) and once with a `text` document (SVG).

```bash
node test/run-harness.mjs
```

Chrome is found at the usual install locations; set `CHROME_PATH` to override. The
Chrome profile and the generated pages live in a temporary folder and are removed
afterwards, so nothing is written into the plugin folder. Node 22 or newer is needed:
the harness talks to Chrome over its DevTools WebSocket.

## Notes

- Zoom is clamped to 2% – 6400% of the natural size.
- A trackpad pinch reaches the page as a burst of one- or two-pixel wheel steps, and
  the whole gesture travels far less than one mouse notch. The zoom gain therefore
  rises as the step gets smaller, so a pinch lands in one gesture instead of needing
  half a dozen, while a wheel notch keeps the speed it had.
- SVG is drawn at the zoomed size instead of being stretched by a CSS transform, so
  it stays sharp at every zoom, zooming out included: the stage is only a compositor
  layer while a drag is in flight, never while the zoom changes. Raster images keep
  the transform scale, which is cheap even at 6400%.
- An SVG's size comes from its `width`/`height` attributes, else its `viewBox`, so a
  drawing without explicit pixel size is not left at the browser's 300×150 default.
- When the file changes outside the editor, the viewer keeps the zoom and pan you set
  up (it only re-fits when the drawing itself changes size, or on the first load).
- The image is kept partially on screen (at least ~64 px in each axis) while panning,
  so it cannot be dragged completely out of view.
- Transparent images get a subtle checkerboard background.
- Colors follow Orca's theme through `--orca-background`, `--orca-foreground` and
  `--orca-border`.

## License

MIT — see [LICENSE](LICENSE).
