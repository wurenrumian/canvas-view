// Runs editor/viewer.html in headless Chrome with a mocked `orca.document`,
// drives wheel/drag/keyboard/pinch and checks the resulting transform.
// Usage: node test/run-harness.mjs
//
// Everything Chrome writes lives in a temporary folder, so the plugin folder
// stays clean (Orca hashes every file in it when the folder is loaded).
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Chromium/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium'
]

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return 'chrome'
}

const CHROME = findChrome()
const viewer = (await readFile(path.join(root, 'editor/viewer.html'), 'utf8')).replace(/\r\n/g, '\n')
const pngBase64 = (await readFile(path.join(root, 'test/sample.png'))).toString('base64')
const svgText = await readFile(path.join(root, 'test/sample.svg'), 'utf8')
const viewBoxSvgText = await readFile(path.join(root, 'test/sample-viewbox.svg'), 'utf8')

const appMarker = '    <script>\n      ;(() => {'
if (!viewer.includes(appMarker)) throw new Error('could not find the viewer script tag')

if (typeof WebSocket === 'undefined') {
  throw new Error('this harness drives Chrome over its DevTools socket, so it needs a Node with a global WebSocket (Node 22 or newer)')
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function mockFor(kind) {
  const documentSource =
    kind === 'png'
      ? `{ version: 1, readOnly: true, fileType: 'png', content: { kind: 'bytes', bytes: window.__pngBytes() } }`
      : `{ version: 1, readOnly: true, fileType: 'svg', content: { kind: 'text', text: ${
          kind === 'svg-viewbox' ? JSON.stringify(viewBoxSvgText) : JSON.stringify(svgText)
        } } }`

  return `window.__errors = []
window.__kind = '${kind}'
window.addEventListener('error', function (event) { window.__errors.push(String(event.message)) })
window.addEventListener('unhandledrejection', function (event) { window.__errors.push('rejection: ' + String(event.reason)) })
window.__version = 0
window.__pngBytes = function () {
  if (!window.__pngCache) {
    const binary = atob('${pngBase64}')
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    window.__pngCache = bytes.buffer
  }
  return window.__pngCache
}
window.orca = {
  document: {
    onDidChange(handler) {
      window.__handler = handler
      setTimeout(function () { window.__sendDocument() }, 10)
    }
  }
}
window.__sendDocument = function () {
  if (!window.__handler) return
  window.__version += 1
  const doc = ${documentSource}
  doc.version = window.__version
  window.__handler(doc)
}
window.__sendBroken = function () {
  if (!window.__handler) return
  window.__handler({
    version: 99,
    readOnly: true,
    fileType: 'png',
    content: { kind: 'bytes', bytes: new Uint8Array([0, 1, 2, 3]).buffer }
  })
}
`
}

async function devtoolsPort(profileDir) {
  const file = path.join(profileDir, 'DevToolsActivePort')
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      const port = Number((await readFile(file, 'utf8')).split(/\r?\n/)[0])
      if (Number.isInteger(port) && port > 0) return port
    } catch {
      /* not written yet */
    }
    await sleep(100)
  }
  throw new Error('Chrome never wrote DevToolsActivePort to ' + profileDir)
}

async function targetUrl(port, pageName) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      const targets = await response.json()
      const page = targets.find((target) => target.type === 'page' && target.url.includes(pageName))
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {
      /* not up yet */
    }
    await sleep(100)
  }
  throw new Error('Chrome DevTools endpoint never listed ' + pageName)
}

function evaluate(ws, expression) {
  return new Promise((resolve, reject) => {
    const id = 1
    const onMessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.id !== id) return
      ws.removeEventListener('message', onMessage)
      if (message.error) reject(new Error(message.error.message))
      else resolve(message.result && message.result.result && message.result.result.value)
    }
    ws.addEventListener('message', onMessage)
    ws.send(
      JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true }
      })
    )
  })
}

const expression = `new Promise((resolve) => {
  const started = Date.now()
  const tick = () => {
    const results = document.getElementById('results')
    if (results) return resolve(results.textContent)
    if (Date.now() - started > 15000) {
      const stage = document.getElementById('stage')
      return resolve('TIMEOUT\\ntransform=' + (stage ? stage.style.transform : 'n/a') + '\\nerrors=' + JSON.stringify(window.__errors || []))
    }
    setTimeout(tick, 50)
  }
  tick()
})`

async function stopChrome(chrome) {
  if (!chrome || chrome.exitCode !== null) return
  const exited = new Promise((resolve) => chrome.once('exit', resolve))
  chrome.kill()
  await Promise.race([exited, sleep(3000)])
  if (chrome.exitCode === null) chrome.kill('SIGKILL')
}

/* Chrome releases its profile a moment after the process exits, so give the
   handle a few chances before giving up. */
async function removeDir(dir, attempts = 15) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await rm(dir, { recursive: true, force: true })
      return true
    } catch {
      await sleep(200)
    }
  }
  return false
}

async function runCase(name, kind, workspace, index) {
  const dir = path.join(workspace, `case-${index}`)
  const profile = path.join(dir, 'chrome-profile')
  await mkdir(dir, { recursive: true })

  const mockPath = path.join(dir, 'orca-mock.js')
  await writeFile(mockPath, mockFor(kind))

  const pageName = `canvas-harness-${index}.html`
  const harness = path.join(dir, pageName)
  const html = viewer
    .replace(appMarker, `    <script src="${pathToFileURL(mockPath).href}"></script>\n` + appMarker)
    .replace(
      '</script>\n  </body>',
      `</script>\n    <script src="${pathToFileURL(path.join(root, 'test/harness-test.js')).href}"></script>\n  </body>`
    )
  await writeFile(harness, html)

  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--allow-file-access-from-files',
      '--disable-extensions',
      '--remote-debugging-port=0',
      '--user-data-dir=' + profile,
      '--window-size=1200,800',
      ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
      pathToFileURL(harness).href
    ],
    { stdio: 'ignore' }
  )

  let output = ''
  try {
    const port = await devtoolsPort(profile)
    const wsUrl = await targetUrl(port, pageName)
    const ws = new WebSocket(wsUrl)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', reject, { once: true })
    })
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        output = await evaluate(ws, expression)
        break
      } catch (error) {
        if (!/context was destroyed/i.test(String(error && error.message))) throw error
        await sleep(150)
      }
    }
    ws.close()
  } finally {
    await stopChrome(chrome)
    await removeDir(dir, 10)
  }

  console.log('\n' + name)
  console.log(output.trim())
  return !(output.includes('FAIL') || output.includes('TIMEOUT'))
}

const cases = [
  ['bytes document (PNG)', 'png'],
  ['text document (SVG)', 'svg'],
  ['viewBox-only SVG', 'svg-viewbox']
]

const workspace = await mkdtemp(path.join(os.tmpdir(), 'orca-canvas-harness-'))
let ok = true
try {
  for (let index = 0; index < cases.length; index += 1) {
    const [name, kind] = cases[index]
    const passed = await runCase(name, kind, workspace, index)
    ok = ok && passed
    await sleep(300)
  }
} finally {
  if (!(await removeDir(workspace))) {
    console.warn('\nleft the temporary folder behind: ' + workspace)
  }
}

console.log(ok ? '\nAll checks passed' : '\nFAILED')
process.exit(ok ? 0 : 1)
