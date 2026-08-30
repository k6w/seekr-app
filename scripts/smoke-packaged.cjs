#!/usr/bin/env node
/**
 * Packaged-app smoke test.
 *
 * Launches the BUILT binary and asserts it reaches a working state. This is the
 * check that would have caught the asar/native-module problem: `asar: true`
 * with no `asarUnpack` packs better_sqlite3.node inside the archive, where it
 * cannot be dlopen'd. Dev works, the packaged app crashes on launch, and CI's
 * `if-no-files-found: error` only ever proved a file was produced -- never that
 * it runs.
 *
 * Passes when the app emits SEEKR_SMOKE_OK on stdout, which main.ts does once
 * the database has opened. Fails on crash, on a nonzero exit, or on timeout.
 */
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const TIMEOUT_MS = 90_000

function findBinary() {
  const releaseDir = path.join(process.cwd(), 'release')
  if (!fs.existsSync(releaseDir)) {
    throw new Error('No release/ directory. Run a build first.')
  }

  const stack = [releaseDir]
  const candidates = []

  while (stack.length > 0) {
    const dir = stack.pop()
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)

      if (process.platform === 'darwin' && entry.isDirectory() && entry.name.endsWith('.app')) {
        const inner = path.join(full, 'Contents', 'MacOS')
        if (fs.existsSync(inner)) {
          const [binary] = fs.readdirSync(inner)
          if (binary) candidates.push(path.join(inner, binary))
        }
        continue
      }

      if (entry.isDirectory()) {
        stack.push(full)
        continue
      }

      if (process.platform === 'win32' && entry.name === 'Seekr.exe') candidates.push(full)
      if (process.platform === 'linux' && entry.name === 'seekr' && !entry.name.includes('.')) {
        candidates.push(full)
      }
    }
  }

  if (candidates.length === 0) throw new Error('No packaged binary found under release/')
  return candidates[0]
}

function run(binary) {
  return new Promise((resolve, reject) => {
    console.log(`[smoke] launching ${binary}`)

    /*
     * --no-sandbox on Linux only.
     *
     * Chrome refuses to start when its SUID helper is not root-owned with mode
     * 4755, which an unpacked build in CI never is. The sandbox is a property
     * of the installed package, not of the code under test, so disabling it
     * here does not weaken what this check actually proves.
     */
    const args = process.platform === 'linux' ? ['--no-sandbox'] : []

    const child = spawn(binary, args, {
      env: {
        ...process.env,
        SEEKR_SMOKE_TEST: '1',
        // Headless CI has no display server.
        ...(process.platform === 'linux' ? { DISPLAY: process.env.DISPLAY || ':99' } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let output = ''
    let settled = false

    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        child.kill('SIGTERM')
      } catch {
        /* already gone */
      }
      if (error) {
        console.error('[smoke] output:\n' + output)
        reject(error)
      } else {
        resolve()
      }
    }

    const timer = setTimeout(
      () => finish(new Error(`Timed out after ${TIMEOUT_MS}ms without SEEKR_SMOKE_OK`)),
      TIMEOUT_MS,
    )

    const onData = (chunk) => {
      output += chunk
      process.stdout.write(chunk)
      if (output.includes('SEEKR_SMOKE_OK')) {
        console.log('[smoke] app reported healthy startup')
        finish()
      }
    }

    child.stdout.on('data', onData)
    child.stderr.on('data', onData)

    child.on('error', (error) => finish(new Error(`Failed to spawn: ${error.message}`)))
    child.on('exit', (code, signal) => {
      if (settled) return
      finish(new Error(`Exited early with code ${code} signal ${signal} before reporting healthy`))
    })
  })
}

run(findBinary())
  .then(() => {
    console.log('[smoke] PASS')
    process.exit(0)
  })
  .catch((error) => {
    console.error(`[smoke] FAIL: ${error.message}`)
    process.exit(1)
  })
