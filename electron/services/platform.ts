import { app } from 'electron'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { SystemInfo } from '../ipc/api'

/**
 * Platform-aware filesystem roots and capability detection.
 *
 * Replaces the old `get-system-drives`, which returned `['/']` on macOS and
 * Linux (it probed `/`, `/home`, `/usr` and broke on the first hit). Indexing
 * `/` crawls `/System`, `/private`, `/dev`, every mounted volume and every
 * TCC-protected directory -- slow, noisy, and mostly EPERM.
 */

/** Build number from a Windows NT release string like "10.0.22621". */
export function windowsBuildNumber(release: string): number {
  const build = Number(release.split('.')[2])
  return Number.isFinite(build) ? build : 0
}

/** Mica and rounded corners need Windows 11 (build 22000+). */
export function supportsMica(platform: NodeJS.Platform, release: string): boolean {
  return platform === 'win32' && windowsBuildNumber(release) >= 22000
}

export function getSystemInfo(): SystemInfo {
  const platform = process.platform
  return {
    platform,
    isMac: platform === 'darwin',
    isWindows: platform === 'win32',
    isLinux: platform === 'linux',
    supportsMica: supportsMica(platform, os.release()),
    appVersion: app.getVersion(),
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/**
 * Sensible starting roots. The user's own files, not the whole machine.
 * External volumes are offered separately and are opt-in.
 */
export async function getDefaultIndexRoots(): Promise<string[]> {
  const home = os.homedir()
  if (process.platform === 'win32') {
    // The user profile covers Desktop/Documents/Downloads without touching
    // C:\Windows or C:\Program Files.
    return [home]
  }
  return [home]
}

/**
 * Every root the user could plausibly choose to index, for the settings UI.
 */
export async function getSelectableRoots(): Promise<string[]> {
  const home = os.homedir()

  if (process.platform === 'win32') {
    // Skip A: and B: -- probing legacy floppy letters can block for seconds.
    const letters = Array.from({ length: 24 }, (_, i) => String.fromCharCode(67 + i))
    const found = await Promise.all(
      letters.map(async (letter) => {
        const root = `${letter}:\\`
        return (await exists(root)) ? root : null
      }),
    )
    return [home, ...found.filter((r): r is string => r !== null)]
  }

  if (process.platform === 'darwin') {
    const roots = [home]
    try {
      // /Volumes holds external and network mounts. The boot volume also
      // appears here as a symlink to /, which we do not want to offer twice.
      const bootReal = await fs.realpath('/')
      for (const entry of await fs.readdir('/Volumes')) {
        const full = path.join('/Volumes', entry)
        try {
          if ((await fs.realpath(full)) !== bootReal) roots.push(full)
        } catch {
          // unreadable mount, skip
        }
      }
    } catch {
      // /Volumes missing or unreadable
    }
    return roots
  }

  const roots = [home]
  for (const candidate of ['/media', '/mnt', `/run/media/${os.userInfo().username}`]) {
    if (await exists(candidate)) roots.push(candidate)
  }
  return roots
}
