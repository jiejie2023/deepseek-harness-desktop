/**
 * DSH Desktop attach mode: a thin native window that attaches to an externally
 * running DeepSeek Harness Web profile (for example `dsh web` on
 * http://127.0.0.1:3080).
 *
 * The Harness runtime stays entirely outside this process: no Cordis boot, no
 * bundled dependencies, no profile preparation. Navigation is confined to the
 * attached origin, and closing the window exits the app (no tray).
 */

import { app, BrowserWindow, dialog, shell } from 'electron'
import { fileURLToPath } from 'node:url'

/** Default target for `--attach` when no URL is provided. */
export const DEFAULT_ATTACH_URL = 'http://127.0.0.1:3080'

/**
 * Resolve the attach window icon generated from the official DeepSeek Harness
 * whale favicon (build/dsh-whale.svg). Windows uses a multi-size ICO; other
 * platforms use the 256px PNG.
 * @returns an absolute icon path, or undefined when the asset is missing.
 */
export function attachWindowIconPath(): string | undefined {
  try {
    const name = process.platform === 'win32' ? 'attach-icon.ico' : 'attach-icon.png'
    return fileURLToPath(new URL(`../build/${name}`, import.meta.url))
  } catch {
    return undefined
  }
}

/**
 * Parse `--attach-url=<value>` from the Electron main process argv.
 * @param argv - the Electron main process argument list.
 * @returns the validated http(s) target URL.
 */
export function attachUrlFromMainArgv(argv: readonly string[]): string {
  for (const argument of argv) {
    if (!argument.startsWith('--attach-url=')) continue
    const value = argument.slice('--attach-url='.length)
    if (value.length === 0) throw new Error('--attach-url requires a non-empty URL')
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`--attach-url must be an http(s) URL: ${value}`)
    }
    return parsed.toString()
  }
  return DEFAULT_ATTACH_URL
}

let mainWindow: BrowserWindow | undefined

/** Create the attach window and keep navigation inside the attached origin. */
function createWindow(targetUrl: string): void {
  const origin = new URL(targetUrl).origin
  const icon = attachWindowIconPath()
  const window = new BrowserWindow({
    title: 'DSH Desktop (attach)',
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    ...(icon === undefined ? {} : { icon }),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  mainWindow = window

  const isInsideAttachedOrigin = (url: string): boolean => {
    try {
      return new URL(url).origin === origin
    } catch {
      return false
    }
  }
  window.webContents.on('will-navigate', (event, url) => {
    if (!event.isMainFrame) return
    if (!isInsideAttachedOrigin(url)) event.preventDefault()
  })
  window.webContents.on('will-redirect', (event, url) => {
    if (!event.isMainFrame) return
    if (!isInsideAttachedOrigin(url)) event.preventDefault()
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isInsideAttachedOrigin(url)) return { action: 'allow' }
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (isMainFrame && errorCode !== -3) {
      void dialog.showErrorBox(
        'DSH Desktop (attach)',
        `Failed to load ${validatedURL}\n(${errorCode}: ${errorDescription})\n\n`
        + 'Make sure the local DeepSeek Harness Web instance is running (for example `dsh web`).',
      )
    }
  })
  window.once('ready-to-show', () => { window.show() })
  window.on('closed', () => { mainWindow = undefined })
  void window.loadURL(targetUrl)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  if (process.platform === 'win32') {
    app.setAppUserModelId('ai.deepseek.dsh.desktop')
  }
  app.on('second-instance', () => {
    if (mainWindow === undefined) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  void app.whenReady().then(() => {
    try {
      createWindow(attachUrlFromMainArgv(process.argv))
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      void dialog.showErrorBox('DSH Desktop (attach)', message)
      app.quit()
    }
  })
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length !== 0) return
    try {
      createWindow(attachUrlFromMainArgv(process.argv))
    } catch {
      // The initial attach already reported an invalid URL; keep the app alive
      // on macOS only when the first window was created successfully.
    }
  })
  app.on('window-all-closed', () => {
    app.quit()
  })
}
