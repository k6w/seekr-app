import {
  BrowserWindow,
  app,
  clipboard,
  ipcMain,
  nativeImage,
  shell,
  type IpcMainInvokeEvent,
} from 'electron'
import path from 'node:path'
import log from 'electron-log/main'
import { SettingsStore } from './settings'
import { getSelectableRoots, getSystemInfo } from './platform'
import { PathGuard } from '../security/path-guard'
import { IpcChannel } from '../ipc/channels'
import type { IpcResult, SystemInfo } from '../ipc/api'

const ok = <T>(data: T): IpcResult<T> => ({ ok: true, data })
const fail = (error: unknown): IpcResult<never> => ({
  ok: false,
  error: error instanceof Error ? error.message : 'Unknown error',
})

/** macOS deep link to the exact settings pane. There is no API to request FDA. */
const FULL_DISK_ACCESS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'

/**
 * Everything main still owns after the engine split: the shell verbs, the
 * permission prompts, and the root allowlist the path guard reads.
 *
 * Search and indexing are deliberately absent -- they travel renderer to
 * engine over a MessagePort and never pass through here.
 */
export class IpcHandlers {
  private readonly pathGuard: PathGuard

  constructor(
    private readonly settings: SettingsStore,
    /** Asks the engine whether a path is present in the index. */
    isIndexed: (fullPath: string) => Promise<boolean>,
  ) {
    this.pathGuard = new PathGuard({
      getIndexedRoots: () => this.settings.get().indexedPaths,
      isIndexed,
    })
    this.register()
  }

  /**
   * Rejects invokes whose sender is not the main frame of one of our own
   * windows. Without this, any subframe the app ever loads inherits the full
   * API surface just by being in the same renderer.
   */
  private isTrustedSender(event: IpcMainInvokeEvent): boolean {
    if (BrowserWindow.fromWebContents(event.sender) === null) return false
    const frame = event.senderFrame
    return frame === null || frame.parent === null
  }

  private handle<T, Args extends unknown[]>(
    channel: string,
    fn: (event: IpcMainInvokeEvent, ...args: Args) => Promise<IpcResult<T>> | IpcResult<T>,
  ): void {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!this.isTrustedSender(event)) {
        return fail(new Error('Rejected IPC from an untrusted frame'))
      }
      try {
        return await fn(event, ...(args as Args))
      } catch (error) {
        log.error(`IPC handler failed on ${channel}:`, error)
        return fail(error)
      }
    })
  }

  private register(): void {
    // Every verb below hands a path to the OS, so every one goes through the
    // guard first. See electron/security/path-guard.ts for why.
    this.handle(IpcChannel.FileOpen, async (_e, filePath: unknown) => {
      const verdict = await this.pathGuard.validate(filePath)
      if (!verdict.ok) return fail(new Error(verdict.reason))

      // openPath resolves with a non-empty string on failure rather than rejecting.
      const message = await shell.openPath(verdict.path)
      return message ? fail(new Error(message)) : ok(undefined)
    })

    this.handle(IpcChannel.FileReveal, async (_e, filePath: unknown) => {
      const verdict = await this.pathGuard.validate(filePath)
      if (!verdict.ok) return fail(new Error(verdict.reason))
      shell.showItemInFolder(verdict.path)
      return ok(undefined)
    })

    this.handle(IpcChannel.FileCopyPath, async (_e, filePath: unknown) => {
      const verdict = await this.pathGuard.validate(filePath)
      if (!verdict.ok) return fail(new Error(verdict.reason))
      clipboard.writeText(verdict.path)
      return ok(undefined)
    })

    this.handle(IpcChannel.FileTrash, async (_e, filePath: unknown) => {
      const verdict = await this.pathGuard.validate(filePath)
      if (!verdict.ok) return fail(new Error(verdict.reason))
      // Unlike openPath, trashItem rejects on failure.
      await shell.trashItem(verdict.path)
      return ok(undefined)
    })

    this.handle(IpcChannel.FileStartDrag, async (event, filePath: unknown) => {
      const verdict = await this.pathGuard.validate(filePath)
      if (!verdict.ok) return fail(new Error(verdict.reason))

      // startDrag needs a real icon; passing an empty one throws.
      const icon = await app.getFileIcon(verdict.path, { size: 'normal' }).catch(() => null)
      event.sender.startDrag({ file: verdict.path, icon: icon ?? nativeImage.createEmpty() })
      return ok(undefined)
    })

    this.handle(IpcChannel.SystemRoots, async () => ok(await getSelectableRoots()))

    this.handle(IpcChannel.SystemInfo, () => ok<SystemInfo>(getSystemInfo()))

    this.handle(IpcChannel.SystemOpenFdaSettings, async () => {
      if (process.platform !== 'darwin') return fail(new Error('macOS only'))
      await shell.openExternal(FULL_DISK_ACCESS_URL)
      return ok(undefined)
    })

    /**
     * Records which roots are being indexed.
     *
     * This is the allowlist PathGuard consults, so main persists it before the
     * engine starts finding files there. Renderer localStorage -- where
     * settings used to live -- is the wrong owner for a security-relevant list.
     */
    this.handle(IpcChannel.IndexRootsChanged, (_e, roots: unknown, excludePaths: unknown) => {
      const paths = Array.isArray(roots)
        ? roots.filter((p): p is string => typeof p === 'string' && path.isAbsolute(p))
        : []
      if (paths.length === 0) return fail(new Error('No valid absolute roots supplied'))

      this.settings.update({
        indexedPaths: paths,
        excludedPaths: Array.isArray(excludePaths)
          ? excludePaths.filter((p): p is string => typeof p === 'string')
          : [],
      })
      return ok(undefined)
    })
  }

  dispose(): void {
    for (const channel of Object.values(IpcChannel)) ipcMain.removeHandler(channel)
  }
}
