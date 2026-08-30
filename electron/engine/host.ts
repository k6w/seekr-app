import { app, MessageChannelMain, utilityProcess, type UtilityProcess } from 'electron'
import path from 'node:path'
import log from 'electron-log/main'

/**
 * Supervises the engine `utilityProcess` from the main process.
 *
 * `utilityProcess` rather than `child_process.fork` because forked children
 * cannot load native modules -- which is the documented reason Electron added
 * it, and better-sqlite3 is a native module.
 *
 * Main deliberately does not proxy search traffic. It mints a MessageChannel
 * and hands one end to the renderer, so queries and result batches travel
 * renderer <-> engine directly and cannot jank the window, the tray, or the
 * global shortcut.
 */
export class EngineHost {
  private child: UtilityProcess | null = null
  private ready = false
  private readyWaiters: Array<(ok: boolean) => void> = []
  private restarts = 0

  constructor(private readonly databasePath: string) {}

  start(): void {
    const entry = path.join(app.getAppPath(), 'dist-electron', 'engine.js')

    this.child = utilityProcess.fork(entry, [], {
      serviceName: 'seekr-engine',
      stdio: 'pipe',
    })

    this.child.stdout?.on('data', (chunk) => log.info('[engine]', String(chunk).trimEnd()))
    this.child.stderr?.on('data', (chunk) => log.error('[engine]', String(chunk).trimEnd()))

    this.child.on('message', (message: { type?: string }) => {
      if (message?.type === 'ready') {
        this.ready = true
        for (const resolve of this.readyWaiters.splice(0)) resolve(true)
      }
    })

    this.child.on('exit', (code) => {
      this.ready = false
      this.child = null
      if (this.stopping) return

      // A crashed engine leaves the app unable to search at all, so bring it
      // back -- but bounded, so a reproducible crash does not become a loop.
      if (this.restarts < 3) {
        this.restarts++
        log.warn(`Engine exited (code ${code}); restarting (attempt ${this.restarts})`)
        setTimeout(() => this.start(), 500 * this.restarts)
      } else {
        log.error(`Engine exited (code ${code}) and exceeded the restart limit`)
      }
    })

    this.child.postMessage({ type: 'init', databasePath: this.databasePath })
  }

  private stopping = false

  whenReady(timeoutMs = 10_000): Promise<boolean> {
    if (this.ready) return Promise.resolve(true)
    return new Promise((resolve) => {
      this.readyWaiters.push(resolve)
      setTimeout(() => resolve(this.ready), timeoutMs)
    })
  }

  /**
   * Gives a renderer its own direct channel to the engine.
   * Returns false if the engine is not running, so the caller can surface it
   * rather than leaving the renderer waiting on a port that never arrives.
   */
  attachRenderer(webContents: Electron.WebContents, channel: string): boolean {
    if (!this.child || !this.ready) return false

    const { port1, port2 } = new MessageChannelMain()
    this.child.postMessage({ type: 'attach-port' }, [port1])
    webContents.postMessage(channel, null, [port2])
    return true
  }

  async stop(): Promise<void> {
    this.stopping = true
    if (!this.child) return

    this.child.postMessage({ type: 'shutdown' })

    // Give it a moment to checkpoint the WAL, then insist.
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.child?.kill()
        resolve()
      }, 3_000)
      this.child?.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })

    this.child = null
  }

  get isRunning(): boolean {
    return this.child !== null && this.ready
  }
}
