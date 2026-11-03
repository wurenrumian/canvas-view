;(async () => {
  const results = []
  const pass = (name, condition, detail) => {
    results.push((condition ? 'PASS ' : 'FAIL ') + name + (detail ? ' :: ' + detail : ''))
  }

  const stage = document.getElementById('stage')
  const viewport = document.getElementById('viewport')
  const image = document.getElementById('image')

  const read = () => {
    const match = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px, 0(?:px)?\) scale\(([\d.]+)\)/.exec(stage.style.transform)
    return match ? { x: Number(match[1]), y: Number(match[2]), s: Number(match[3]) } : null
  }

  const waitFor = async (predicate, timeout = 5000) => {
    const start = performance.now()
    while (performance.now() - start < timeout) {
      if (predicate()) return true
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    return false
  }

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

  const nw = image.naturalWidth
  const nh = image.naturalHeight
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

  const cx = Math.round(vw * 0.3)
  const cy = Math.round(vh * 0.35)
  const before = read()
  const imageX = (cx - before.x) / before.s
  const imageY = (cy - before.y) / before.s

  viewport.dispatchEvent(
    new WheelEvent('wheel', { deltaY: -100, deltaMode: 0, clientX: cx, clientY: cy, bubbles: true, cancelable: true })
  )
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
  viewport.dispatchEvent(
    new WheelEvent('wheel', { deltaY: -100, deltaMode: 0, ctrlKey: true, clientX: cx, clientY: cy, bubbles: true, cancelable: true })
  )
  const afterPinch = read()
  pass('ctrl+wheel (pinch) zooms', afterPinch.s > beforePinch.s, beforePinch.s.toFixed(3) + ' -> ' + afterPinch.s.toFixed(3))

  const beforeTrackpad = read()
  viewport.dispatchEvent(
    new WheelEvent('wheel', { deltaY: 12, deltaX: 4, deltaMode: 0, clientX: cx, clientY: cy, bubbles: true, cancelable: true })
  )
  const afterTrackpad = read()
  pass(
    'trackpad scroll pans instead of zooming',
    Math.abs(afterTrackpad.s - beforeTrackpad.s) < 1e-9 &&
      Math.abs(afterTrackpad.x - beforeTrackpad.x + 4) < 1 &&
      Math.abs(afterTrackpad.y - beforeTrackpad.y + 12) < 1,
    'scale ' + afterTrackpad.s.toFixed(3) + ' dx=' + (afterTrackpad.x - beforeTrackpad.x).toFixed(1) + ' dy=' + (afterTrackpad.y - beforeTrackpad.y).toFixed(1)
  )

  const beforeBurst = read()
  viewport.dispatchEvent(
    new WheelEvent('wheel', { deltaY: -30, deltaMode: 0, clientX: cx, clientY: cy, bubbles: true, cancelable: true })
  )
  const afterBurst = read()
  pass(
    'an ambiguous delta inside a trackpad burst pans',
    Math.abs(afterBurst.s - beforeBurst.s) < 1e-9 && Math.abs(afterBurst.y - beforeBurst.y - 30) < 1,
    'scale ' + afterBurst.s.toFixed(3) + ' dy=' + (afterBurst.y - beforeBurst.y).toFixed(1)
  )

  await new Promise((resolve) => setTimeout(resolve, 250))
  const beforeLone = read()
  viewport.dispatchEvent(
    new WheelEvent('wheel', { deltaY: -30, deltaMode: 0, clientX: cx, clientY: cy, bubbles: true, cancelable: true })
  )
  const afterLone = read()
  pass(
    'the same delta on its own zooms',
    afterLone.s > beforeLone.s,
    beforeLone.s.toFixed(3) + ' -> ' + afterLone.s.toFixed(3)
  )

  window.__setWheel('pan')
  await new Promise((resolve) => setTimeout(resolve, 50))
  const beforePinnedPan = read()
  viewport.dispatchEvent(
    new WheelEvent('wheel', { deltaY: -100, deltaMode: 0, clientX: cx, clientY: cy, bubbles: true, cancelable: true })
  )
  const afterPinnedPan = read()
  pass(
    'setting "Pan" pans a mouse wheel',
    Math.abs(afterPinnedPan.s - beforePinnedPan.s) < 1e-9 &&
      Math.abs(afterPinnedPan.y - beforePinnedPan.y - 100) < 1,
    'scale ' + afterPinnedPan.s.toFixed(3) + ' dy=' + (afterPinnedPan.y - beforePinnedPan.y).toFixed(1)
  )

  window.__setWheel('zoom')
  await new Promise((resolve) => setTimeout(resolve, 50))
  const beforePinnedZoom = read()
  viewport.dispatchEvent(
    new WheelEvent('wheel', { deltaY: -8, deltaX: 3, deltaMode: 0, clientX: cx, clientY: cy, bubbles: true, cancelable: true })
  )
  const afterPinnedZoom = read()
  pass(
    'setting "Zoom" zooms a trackpad-sized delta',
    afterPinnedZoom.s > beforePinnedZoom.s,
    beforePinnedZoom.s.toFixed(3) + ' -> ' + afterPinnedZoom.s.toFixed(3)
  )

  window.__setWheel('auto')
  await new Promise((resolve) => setTimeout(resolve, 50))

  const beforeAlt = read()
  viewport.dispatchEvent(
    new WheelEvent('wheel', { deltaY: 100, deltaMode: 0, altKey: true, clientX: cx, clientY: cy, bubbles: true, cancelable: true })
  )
  const afterAlt = read()
  pass(
    'alt+wheel forces pan even on a mouse',
    Math.abs(afterAlt.s - beforeAlt.s) < 1e-9 && Math.abs(afterAlt.y - beforeAlt.y + 100) < 1,
    'scale ' + afterAlt.s.toFixed(3) + ' dy=' + (afterAlt.y - beforeAlt.y).toFixed(1)
  )

  const beforeOut = read()
  viewport.dispatchEvent(
    new WheelEvent('wheel', { deltaY: 300, deltaMode: 0, clientX: cx, clientY: cy, bubbles: true, cancelable: true })
  )
  const zoomedOut = read()
  pass('wheel down zooms out', zoomedOut.s < beforeOut.s, beforeOut.s.toFixed(3) + ' -> ' + zoomedOut.s.toFixed(3))

  const panStart = read()
  viewport.dispatchEvent(
    new PointerEvent('pointerdown', {
      pointerId: 7,
      pointerType: 'mouse',
      button: 0,
      buttons: 1,
      clientX: 200,
      clientY: 200,
      bubbles: true
    })
  )
  viewport.dispatchEvent(
    new PointerEvent('pointermove', {
      pointerId: 7,
      pointerType: 'mouse',
      buttons: 1,
      clientX: 260,
      clientY: 240,
      bubbles: true
    })
  )
  viewport.dispatchEvent(
    new PointerEvent('pointerup', {
      pointerId: 7,
      pointerType: 'mouse',
      clientX: 260,
      clientY: 240,
      bubbles: true
    })
  )
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

  finish()
})()
