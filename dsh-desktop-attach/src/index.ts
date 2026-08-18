/**
 * dsh-desktop-attach: opens the DSH Desktop attach window automatically once
 * this profile's Web surface is reachable.
 *
 * The plugin is intentionally dependency-free at runtime: it only type-imports
 * Cordis and spawns the configured launcher with the plain Node built-ins.
 * Configuration lives in the profile patch layer (see cordis.patch.yml).
 */

import type { Context } from '@deepseek-ai/cordis'
import { spawn } from 'node:child_process'
import { connect } from 'node:net'

export const name = 'dsh-desktop-attach'

export interface AttachConfig {
  /** Target DSH Web URL. Defaults to http://127.0.0.1:3080 */
  url?: string
  /** Launcher command: an absolute path to dsh-plugin-desktop's lib/bin.js, or a PATH command like dsh-desktop. Defaults to dsh-desktop */
  command?: string
  /** Give up waiting for the Web surface after this many milliseconds. Default 60000 */
  timeoutMs?: number
  /** Poll interval while waiting for the Web surface. Default 1000 */
  pollIntervalMs?: number
  /** Set false to keep the window closed. Default true */
  enabled?: boolean
}

const DEFAULT_URL = 'http://127.0.0.1:3080'
const DEFAULT_COMMAND = 'dsh-desktop'
const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_POLL_INTERVAL_MS = 1_000

/** Parse and validate the target URL into a connectable host/port pair. */
export function parseTarget(url: string): { host: string; port: number } {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch (cause) {
    throw new Error(`dsh-desktop-attach: invalid url ${JSON.stringify(url)}: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`dsh-desktop-attach: url must be an http(s) URL, got ${parsed.protocol}`)
  }
  const port = parsed.port === '' ? (parsed.protocol === 'https:' ? 443 : 80) : Number(parsed.port)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`dsh-desktop-attach: invalid port ${JSON.stringify(parsed.port)}`)
  }
  return { host: parsed.hostname, port }
}

function isNodeScript(command: string): boolean {
  return /\.(mjs|cjs|js)$/i.test(command)
}

/**
 * Mount the attach launcher. Waits for the Web surface to accept TCP
 * connections, then spawns the configured launcher once. All timers and the
 * child process are unref'd so they never keep the host alive.
 * @returns a disposer that stops the poll timer.
 */
export function apply(ctx: Context, config?: AttachConfig): () => void {
  if (config?.enabled === false) return () => {}

  let target: { host: string; port: number }
  try {
    target = parseTarget(config?.url ?? DEFAULT_URL)
  } catch (cause) {
    ctx.logger.warn(cause instanceof Error ? cause.message : String(cause))
    return () => {}
  }

  const command = config?.command ?? DEFAULT_COMMAND
  const timeoutMs = config?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const pollIntervalMs = config?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const url = config?.url ?? DEFAULT_URL
  const deadline = Date.now() + timeoutMs
  let launched = false

  const launch = (): void => {
    if (launched) return
    launched = true
    ctx.logger.info(`dsh-desktop-attach: opening ${url} via ${command}`)
    const child = isNodeScript(command)
      ? spawn(process.execPath, [command, '--attach', url], { stdio: 'ignore', windowsHide: true })
      : spawn(command, ['--attach', url], { stdio: 'ignore', windowsHide: true })
    child.on('error', (cause) => {
      ctx.logger.warn(`dsh-desktop-attach: failed to start ${command}: ${cause.message}`)
    })
    child.unref()
  }

  let timer: NodeJS.Timeout | undefined
  timer = setInterval(() => {
    const socket = connect({ host: target.host, port: target.port })
    let settled = false
    const finish = (reachable: boolean): void => {
      if (settled) return
      settled = true
      socket.destroy()
      if (timer !== undefined) {
        clearInterval(timer)
        timer = undefined
      }
      if (reachable) {
        launch()
      } else if (Date.now() >= deadline) {
        ctx.logger.warn(`dsh-desktop-attach: ${url} never became reachable within ${timeoutMs}ms; not opening the window`)
      }
    }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(2_000, () => finish(false))
  }, pollIntervalMs)
  timer.unref()

  return () => {
    if (timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }
  }
}
