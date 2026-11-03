// Runs editor/viewer.html in headless Chrome with a mocked `orca.document`,
// drives wheel/drag/double-click and checks the resulting transform.
// Usage: node test/run-harness.mjs
import { readFile, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE_PORT = 9333

const viewer = await readFile(path.join(root, 'editor/viewer.html'), 'utf8')
const pngBase64 = (await readFile(path.join(root, 'test/sample.png'))).toString('base64')
const svgText = await readFile(path.join(root, 'test/sample.svg'), 'utf8')

const appMarker = '    <script>\n      ;(() => {'
if (!viewer.includes(appMarker)) throw new Error('could not find the viewer script tag')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function mockFor(kind) {
  const documentCall =
    kind === 'svg'
      ? `        handler({
          version: 1,
          readOnly: true,
          fileType: 'svg',
          content: { kind: 'text', text: ${JSON.stringify(svgText)} }
        })`
      : `        handler({
          version: 1,
          readOnly: true,
          fileType: 'png',
          content: { kind: 'bytes', bytes: bytes.buffer }
        })`

  return `window.__errors = []
window.addEventListener('error', function (event) { window.__errors.push(String(event.message)) })
window.addEventListener('unhandledrejection', function (event) { window.__errors.push('rejection: ' + String(event.reason)) })
window.orca = {
  document: {
    onDidChange(handler) {
      const binary = atob('${pngBase64}')
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
      setTimeout(function () {
${documentCall}
      }, 10)
    }
  }
}
`
}

async function targetUrl(port) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      const targets = await response.json()
      const page = targets.find((target) => target.type === 'page' && /\.harness-/.test(target.url))
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {
      /* not up yet */
    }
    await sleep(100)
  }
  throw new Error('Chrome DevTools endpoint never came up on port ' + port)
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
    if (Date.now() - started > 8000) {
      const stage = document.getElementById('stage')
      return resolve('TIMEOUT\\ntransform=' + (stage ? stage.style.transform : 'n/a') + '\\nerrors=' + JSON.stringify(window.__errors || []))
    }
    setTimeout(tick, 50)
  }
  tick()
})`

async function runCase(name, kind, port, index) {
  const mockFile = `test/.orca-mock-${index}.js`
  await writeFile(path.join(root, mockFile), mockFor(kind))

  const html = viewer
    .replace(appMarker, `    <script src="./.orca-mock-${index}.js"></script>\n` + appMarker)
    .replace('</script>\n  </body>', '</script>\n    <script src="./harness-test.js"></script>\n  </body>')

  const harness = path.join(root, `test/.harness-${index}.html`)
  await writeFile(harness, html)

  const url = 'file:///' + harness.replace(/\\/g, '/')
  const profile = path.join(root, `test/.chrome-profile-${index}`)

  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--allow-file-access-from-files',
      '--remote-debugging-port=' + port,
      '--user-data-dir=' + profile,
      '--window-size=1200,800',
      url
    ],
    { stdio: 'ignore' }
  )

  let output = ''
  try {
    const wsUrl = await targetUrl(port)
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
    chrome.kill()
  }

  console.log('\n' + name)
  console.log(output.trim())
  return !(output.includes('FAIL') || output.includes('TIMEOUT'))
}

const cases = [
  ['bytes document (PNG)', 'png'],
  ['text document (SVG)', 'svg']
]

let ok = true
for (let index = 0; index < cases.length; index += 1) {
  const [name, kind] = cases[index]
  const passed = await runCase(name, kind, BASE_PORT + index, index)
  ok = ok && passed
  await sleep(300)
}

console.log(ok ? '\nAll checks passed' : '\nFAILED')
process.exit(ok ? 0 : 1)

