;(async () => {
  const results = []
  const pass = (name, condition, detail) => {
    results.push((condition ? 'PASS ' : 'FAIL ') + name + (detail ? ' :: ' + detail : ''))
  }

  const stage = document.getElementById('stage')
  const viewport = document.getElementById('viewport')
  const image = document.getElementById('image')
  const overlay = document.getElementById('overlay')

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  const waitFor = async (predicate, timeout = 5000) => {
    const start = performance.now()
    while (performance.now() - start < timeout) {
      if (predicate()) return true
      await sleep(25)
    }
    return false
  }

  /* The size the viewer reports for the file: an SVG's viewBox size can differ
     from image.naturalWidth, so the viewer publishes what it uses. */
  const sourceSize = () => ({
    width: Number(image.dataset.sourceWidth) || image.naturalWidth,
    height: Number(image.dataset.sourceHeight) || image.naturalHeight
  })

  /* Rasters scale through the stage transform, vectors grow the img box, so the
     scale comes from whichever one the file type uses. */
  const read = () => {
    const match = /^translate3d\((-?[\d.]+)px, (-?[\d.]+)px, 0(?:px)?\)(?: scale\(([\d.]+)\))?$/.exec(
      stage.style.transform
    )
    if (!match) return null
    const base = sourceSize().width
    const scale = match[3] !== undefined ? Number(match[3]) : image.getBoundingClientRect().width / base
    return { x: Number(match[1]), y: Number(match[2]), s: scale }
  }

  const wheel = (init) =>
    viewport.dispatchEvent(
      new WheelEvent('wheel', Object.assign({ deltaMode: 0, bubbles: true, cancelable: true }, init))
    )

  const pointer = (type, init) =>
    viewport.dispatchEvent(
      new PointerEvent(type, Object.assign({ bubbles: true, cancelable: true }, init))
    )

  const press = (key, init) =>
    window.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key, bubbles: true, cancelable: true }, init)))

  const finish = () => {
    const failed = results.some((line) => line.startsWith('FAIL'))
    document.title = failed ? 'FAILED' : 'OK'
    const pre = document.createElement('pre')
    pre.id = 'results'
    pre.textContent = results.join('\n')
    document.body.appendChild(pre)
  }

  const loaded = await waitFor(() => read() !== null && image.naturalWidth > 0)
  pass('image loads and the view is applied', loaded)
  if (!loaded) {
    finish()
    return
  }

  const size = sourceSize()
  const nw = size.width
  const nh = size.height
  const initial = read()
  const vw = viewport.clientWidth
  const vh = viewport.clientHeight

  pass(
    'fit keeps the whole image inside the viewport',
    initial.s * nw <= vw + 0.5 && initial.s * nh <= vh + 0.5,
    nw + 'x' + nh + ' at ' + initial.s.toFixed(3) + ' in ' + vw + 'x' + vh
  )
  pass(
    'fit centers the image',
    Math.abs(initial.x - (vw - nw * initial.s) / 2) < 0.75 &&
      Math.abs(initial.y - (vh - nh * initial.s) / 2) < 0.75
  )
  pass(
    'the canvas announces the image size',
    String(viewport.getAttribute('aria-label') || '').includes(String(Math.round(nw))),
    viewport.getAttribute('aria-label')
  )

  const isVector = String(window.__kind).indexOf('svg') === 0
  if (window.__kind === 'svg-viewbox') {
    pass(
      'a viewBox-only SVG uses its viewBox size',
      Math.round(nw) === 400 && Math.round(nh) === 100,
      nw + 'x' + nh
    )
  }
  pass(
    isVector ? 'SVG is drawn at the zoomed size, not transform-scaled' : 'a raster keeps the transform scale',
    isVector ? !stage.style.transform.includes('scale(') : stage.style.transform.includes('scale('),
    stage.style.transform
  )

  const cx = Math.round(vw * 0.3)
  const cy = Math.round(vh * 0.35)
  const before = read()
  const imageX = (cx - before.x) / before.s
  const imageY = (cy - before.y) / before.s

  wheel({ deltaY: -100, clientX: cx, clientY: cy })
  const zoomed = read()
  pass('wheel up zooms in', zoomed.s > before.s, before.s.toFixed(3) + ' -> ' + zoomed.s.toFixed(3))

  const imageX2 = (cx - zoomed.x) / zoomed.s
  const imageY2 = (cy - zoomed.y) / zoomed.s
  pass(
    'zoom stays anchored under the pointer',
    Math.abs(imageX2 - imageX) < 0.75 && Math.abs(imageY2 - imageY) < 0.75,
    'dx=' + (imageX2 - imageX).toFixed(2) + ' dy=' + (imageY2 - imageY).toFixed(2)
  )

  const beforePinch = read()
  wheel({ deltaY: -100, ctrlKey: true, clientX: cx, clientY: cy })
  const afterPinch = read()
  pass('ctrl+wheel (pinch) zooms', afterPinch.s > beforePinch.s, beforePinch.s.toFixed(3) + ' -> ' + afterPinch.s.toFixed(3))

  const beforeTrackpad = read()
  wheel({ deltaY: 12, deltaX: 4, clientX: cx, clientY: cy })
  const afterTrackpad = read()
  pass(
    'trackpad scroll pans instead of zooming',
    Math.abs(afterTrackpad.s - beforeTrackpad.s) < 1e-9 &&
      Math.abs(afterTrackpad.x - beforeTrackpad.x + 4) < 1 &&
      Math.abs(afterTrackpad.y - beforeTrackpad.y + 12) < 1,
    'scale ' + afterTrackpad.s.toFixed(3) + ' dx=' + (afterTrackpad.x - beforeTrackpad.x).toFixed(1) + ' dy=' + (afterTrackpad.y - beforeTrackpad.y).toFixed(1)
  )

  const beforeBurst = read()
  wheel({ deltaY: -30, clientX: cx, clientY: cy })
  const afterBurst = read()
  pass(
    'an ambiguous delta inside a trackpad burst pans',
    Math.abs(afterBurst.s - beforeBurst.s) < 1e-9 && Math.abs(afterBurst.y - beforeBurst.y - 30) < 1,
    'scale ' + afterBurst.s.toFixed(3) + ' dy=' + (afterBurst.y - beforeBurst.y).toFixed(1)
  )

  await sleep(250)
  const beforeLone = read()
  wheel({ deltaY: -30, clientX: cx, clientY: cy })
  const afterLone = read()
  pass(
    'the same delta on its own zooms',
    afterLone.s > beforeLone.s,
    beforeLone.s.toFixed(3) + ' -> ' + afterLone.s.toFixed(3)
  )

  window.__setWheel('pan')
  await sleep(50)
  const beforePinnedPan = read()
  wheel({ deltaY: -100, clientX: cx, clientY: cy })
  const afterPinnedPan = read()
  pass(
    'setting "Pan" pans a mouse wheel',
    Math.abs(afterPinnedPan.s - beforePinnedPan.s) < 1e-9 &&
      Math.abs(afterPinnedPan.y - beforePinnedPan.y - 100) < 1,
    'scale ' + afterPinnedPan.s.toFixed(3) + ' dy=' + (afterPinnedPan.y - beforePinnedPan.y).toFixed(1)
  )

  window.__setWheel('zoom')
  await sleep(50)
  const beforePinnedZoom = read()
  wheel({ deltaY: -8, deltaX: 3, clientX: cx, clientY: cy })
  const afterPinnedZoom = read()
  pass(
    'setting "Zoom" zooms a trackpad-sized delta',
    afterPinnedZoom.s > beforePinnedZoom.s,
    beforePinnedZoom.s.toFixed(3) + ' -> ' + afterPinnedZoom.s.toFixed(3)
  )

  window.__setWheel('auto')
  await sleep(50)

  const beforeAlt = read()
  wheel({ deltaY: 100, altKey: true, clientX: cx, clientY: cy })
  const afterAlt = read()
  pass(
    'alt+wheel forces pan even on a mouse',
    Math.abs(afterAlt.s - beforeAlt.s) < 1e-9 && Math.abs(afterAlt.y - beforeAlt.y + 100) < 1,
    'scale ' + afterAlt.s.toFixed(3) + ' dy=' + (afterAlt.y - beforeAlt.y).toFixed(1)
  )

  const beforeOut = read()
  wheel({ deltaY: 300, clientX: cx, clientY: cy })
  const zoomedOut = read()
  pass('wheel down zooms out', zoomedOut.s < beforeOut.s, beforeOut.s.toFixed(3) + ' -> ' + zoomedOut.s.toFixed(3))

  const panStart = read()
  pointer('pointerdown', { pointerId: 7, pointerType: 'mouse', button: 0, buttons: 1, clientX: 200, clientY: 200 })
  pointer('pointermove', { pointerId: 7, pointerType: 'mouse', buttons: 1, clientX: 260, clientY: 240 })
  pointer('pointerup', { pointerId: 7, pointerType: 'mouse', clientX: 260, clientY: 240 })
  const panned = read()
  pass(
    'drag without a modifier pans',
    Math.abs(panned.x - panStart.x - 60) < 0.75 && Math.abs(panned.y - panStart.y - 40) < 0.75,
    'dx=' + (panned.x - panStart.x).toFixed(1) + ' dy=' + (panned.y - panStart.y).toFixed(1)
  )
  pass('pan keeps the zoom level', Math.abs(panned.s - panStart.s) < 1e-9)

  viewport.dispatchEvent(new MouseEvent('dblclick', { clientX: cx, clientY: cy, bubbles: true, cancelable: true }))
  const reset = read()
  pass('double-click returns to fit', Math.abs(reset.s - initial.s) < 1e-9, reset.s.toFixed(3))

  /* Keyboard: the frame listens on window, so the keys reach it wherever focus is. */
  const beforeKeyIn = read()
  press('+')
  const afterKeyIn = read()
  pass('"+" zooms in', afterKeyIn.s > beforeKeyIn.s, beforeKeyIn.s.toFixed(3) + ' -> ' + afterKeyIn.s.toFixed(3))

  press('-')
  pass('"-" zooms out', Math.abs(read().s - beforeKeyIn.s) < 1e-9, read().s.toFixed(3))

  press('1')
  pass('"1" shows the actual size', Math.abs(read().s - 1) < 1e-9, read().s.toFixed(3))

  press('0')
  pass('"0" fits the image', Math.abs(read().s - initial.s) < 1e-9, read().s.toFixed(3))

  const beforeArrow = read()
  press('ArrowRight')
  const afterArrow = read()
  pass(
    'arrow keys pan',
    Math.abs(afterArrow.x - beforeArrow.x - 48) < 0.75,
    'dx=' + (afterArrow.x - beforeArrow.x).toFixed(1)
  )

  press('ArrowRight', { shiftKey: true })
  const afterShiftArrow = read()
  pass(
    'shift+arrow pans further',
    Math.abs(afterShiftArrow.x - afterArrow.x - 160) < 0.75,
    'dx=' + (afterShiftArrow.x - afterArrow.x).toFixed(1)
  )
  press('f')
  pass('"f" fits too', Math.abs(read().s - initial.s) < 1e-9, read().s.toFixed(3))

  /* Two pointers pinch: 100px apart, then 200px. */
  const beforeSpread = read()
  pointer('pointerdown', { pointerId: 11, pointerType: 'touch', buttons: 1, clientX: 300, clientY: 300 })
  pointer('pointerdown', { pointerId: 12, pointerType: 'touch', buttons: 1, clientX: 400, clientY: 300 })
  pointer('pointermove', { pointerId: 12, pointerType: 'touch', buttons: 1, clientX: 500, clientY: 300 })
  const spread = read()
  pass(
    'two-finger pinch zooms',
    spread.s > beforeSpread.s * 1.5,
    beforeSpread.s.toFixed(3) + ' -> ' + spread.s.toFixed(3)
  )
  pointer('pointerup', { pointerId: 12, pointerType: 'touch', clientX: 500, clientY: 300 })
  pointer('pointerup', { pointerId: 11, pointerType: 'touch', clientX: 300, clientY: 300 })
  press('0')

  /* A document re-sent for an outside change keeps the view the person set up. */
  press('1')
  const beforeRedraw = read()
  const urlBefore = image.getAttribute('src')
  window.__sendDocument()
  const redrawn = await waitFor(() => image.getAttribute('src') !== urlBefore && image.complete)
  pass('a re-sent document loads', redrawn)
  const afterRedraw = read()
  pass(
    'a re-sent document keeps the zoom and pan',
    Math.abs(afterRedraw.s - beforeRedraw.s) < 1e-6 &&
      Math.abs(afterRedraw.x - beforeRedraw.x) < 0.75 &&
      Math.abs(afterRedraw.y - beforeRedraw.y) < 0.75,
    'scale ' + beforeRedraw.s.toFixed(3) + ' -> ' + afterRedraw.s.toFixed(3)
  )

  /* Last: a broken file leaves the viewer disabled, so nothing may come after. */
  window.__sendBroken()
  const broke = await waitFor(() => overlay.classList.contains('visible'))
  pass(
    'an unreadable file shows the message overlay',
    broke,
    document.getElementById('overlay-text').textContent
  )

  finish()
})()
