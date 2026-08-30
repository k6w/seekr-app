/**
 * electron-builder `afterSign` hook.
 *
 * Notarization is skipped, loudly, when credentials are absent or when
 * SEEKR_SKIP_NOTARIZE=1 -- so a local `pnpm build:mac` works without an Apple
 * account, while CI fails visibly if the secrets go missing rather than
 * silently shipping an un-notarized build.
 */
exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context
  if (electronPlatformName !== 'darwin') return

  if (process.env.SEEKR_SKIP_NOTARIZE === '1') {
    console.log('[notarize] skipped: SEEKR_SKIP_NOTARIZE=1')
    return
  }

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    if (process.env.CI) {
      throw new Error(
        '[notarize] APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID are required in CI. ' +
          'Set SEEKR_SKIP_NOTARIZE=1 only for builds that are never distributed.',
      )
    }
    console.warn('[notarize] skipped: Apple credentials not set (local build)')
    return
  }

  const { notarize } = require('@electron/notarize')
  const appName = context.packager.appInfo.productFilename

  console.log(`[notarize] submitting ${appName}.app to Apple, this takes a few minutes...`)
  await notarize({
    tool: 'notarytool',
    appPath: `${appOutDir}/${appName}.app`,
    appleId: APPLE_ID,
    appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
    teamId: APPLE_TEAM_ID,
  })
  console.log('[notarize] done')
}
