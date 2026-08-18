/** Headless-safe npm launcher for the DSH Desktop Electron executable. */

import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { posix, resolve, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import { exportDesktopDiagnostics } from './diagnostic-export.ts'

/** Parsed launcher action. */
export type DesktopCliAction = 'export-diagnostics' | 'help' | 'version' | 'launch' | 'attach'

/** Human-readable launcher help. */
export const DESKTOP_CLI_HELP = `Usage: dsh-plugin-desktop [options]

Launch DSH Desktop with the selected Web-capable profile.

Options:
  --attach [url]        open a thin native window attached to an externally
                        running DSH Web instance (default http://127.0.0.1:3080)
  --export-diagnostics  export logs and crash evidence without launching the app
  -h, --help            display help
  -V, --version         display version
`

/** Default --attach target, mirrored by src/attach-main.ts. */
export const DEFAULT_ATTACH_URL = 'http://127.0.0.1:3080'

/**
 * Parse the intentionally small npm-launcher argument set.
 * @param argv - arguments after the executable and script path.
 * @returns the requested action.
 */
export function parseDesktopCli(argv: readonly string[]): DesktopCliAction {
  if (argv.length === 0) return 'launch'
  if (argv[0] === '--attach' || argv[0]?.startsWith('--attach=')) return 'attach'
  if (argv.length === 1 && argv[0] === '--export-diagnostics') return 'export-diagnostics'
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) return 'help'
  if (argv.length === 1 && (argv[0] === '--version' || argv[0] === '-V')) return 'version'
  throw new Error(`unknown arguments: ${argv.join(' ')}`)
}

/**
 * Extract the --attach target URL from `--attach`, `--attach <url>` or
 * `--attach=<url>`. Returns undefined when the default URL should be used.
 * @param argv - arguments after the executable and script path.
 * @returns the requested target URL, if any.
 */
export function parseAttachUrl(argv: readonly string[]): string | undefined {
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index] ?? ''
    if (argument === '--attach') {
      const next = argv[index + 1]
      if (next !== undefined && !next.startsWith('-')) return next
      return undefined
    }
    if (argument.startsWith('--attach=')) {
      const value = argument.slice('--attach='.length)
      if (value.length === 0) throw new Error('--attach requires a non-empty URL')
      return value
    }
  }
  return undefined
}

/** Read the package version without importing Electron. */
function packageVersion(): string {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: unknown }
  if (typeof manifest.version !== 'string') throw new Error('package.json has no string version')
  return manifest.version
}

/** Resolve the Electron user-data location without importing Electron. */
export function defaultDesktopUserDataDirectory(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory: string = homedir(),
): string {
  const path = platform === 'win32' ? win32 : posix
  if (platform === 'win32') {
    const appData = environment.APPDATA
    if (appData === undefined || appData.length === 0) {
      throw new Error('APPDATA is unavailable; cannot locate DSH Desktop diagnostics')
    }
    return path.join(appData, 'DSH Desktop')
  }
  if (platform === 'darwin') return path.join(homeDirectory, 'Library', 'Application Support', 'DSH Desktop')
  const config = environment.XDG_CONFIG_HOME
  return path.join(config === undefined || config.length === 0 ? path.join(homeDirectory, '.config') : config, 'DSH Desktop')
}

export interface DesktopCliOptions {
  /** Override used by focused tests and recovery tooling with a non-default data root. */
  readonly userDataDir?: string
}

/** Launch Electron and mirror its terminal exit status. */
async function launchElectron(mainScript = 'main.js', extraArgs: readonly string[] = []): Promise<number> {
  let electronPath: string
  try {
    const imported = await import('electron') as { default?: unknown }
    const candidate = imported.default
    if (typeof candidate !== 'string') {
      throw new Error('electron package did not provide its executable path')
    }
    electronPath = candidate
  } catch {
    process.stderr.write(
      'dsh-plugin-desktop: electron is not available in this installation.\n'
      + 'Install the desktop launcher globally (npm installs the electron peer automatically):\n'
      + '  npm install -g dsh-plugin-desktop\n'
      + 'Or add electron to the profile before launching:\n'
      + '  dsh plugin --profile <name> add electron\n'
      + 'Or use the packaged DSH Desktop application.\n',
    )
    return 1
  }
  const mainPath = fileURLToPath(new URL(mainScript, import.meta.url))
  return new Promise<number>((resolveExit, reject) => {
    const child = spawn(electronPath, [mainPath, ...extraArgs], { stdio: 'inherit', env: process.env })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      resolveExit(code ?? (signal === null ? 1 : 128))
    })
  })
}

/**
 * Run the npm launcher.
 * @param argv - arguments after the executable and script path.
 * @returns process exit code.
 */
export async function runDesktopCli(
  argv: readonly string[],
  options: DesktopCliOptions = {},
): Promise<number> {
  let action: DesktopCliAction
  try {
    action = parseDesktopCli(argv)
  } catch (cause) {
    process.stderr.write(`dsh-plugin-desktop: ${cause instanceof Error ? cause.message : String(cause)}\n`)
    process.stderr.write(DESKTOP_CLI_HELP)
    return 1
  }
  if (action === 'help') {
    process.stdout.write(DESKTOP_CLI_HELP)
    return 0
  }
  if (action === 'version') {
    process.stdout.write(`${packageVersion()}\n`)
    return 0
  }
  if (action === 'export-diagnostics') {
    const path = await exportDesktopDiagnostics(
      options.userDataDir ?? defaultDesktopUserDataDirectory(),
      { appVersion: packageVersion() },
    )
    process.stdout.write(`${path}\n`)
    return 0
  }
  if (action === 'attach') {
    const url = parseAttachUrl(argv) ?? DEFAULT_ATTACH_URL
    return launchElectron('attach-main.js', [`--attach-url=${url}`])
  }
  return launchElectron()
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1])
if (invokedPath === fileURLToPath(import.meta.url)) {
  void runDesktopCli(process.argv.slice(2)).then(
    code => { process.exitCode = code },
    cause => {
      process.stderr.write(`dsh-plugin-desktop: ${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}\n`)
      process.exitCode = 1
    },
  )
}
