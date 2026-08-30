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
  const supplied = [APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID].filter(Boolean).length

  // Unsigned is the intended default for this project: releases are published
  // on GitHub and users confirm the Gatekeeper prompt once, as documented in
  // the README. Setting the Apple secrets later turns notarization on with no
  // other change.
  if (supplied === 0) {
    console.log('[notarize] not configured; shipping unsigned (see README)')
    return
  }

  // Partially configured is a mistake worth failing on: it usually means a
  // secret was renamed or dropped, and silently shipping unsigned would hide it.
  if (supplied < 3) {
    throw new Error(
      '[notarize] Incomplete Apple credentials. Set all of APPLE_ID, ' +
        'APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID, or none of them.',
    )
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
