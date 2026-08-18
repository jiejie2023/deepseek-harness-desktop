/**
 * Attach-mode helpers: target parsing, port probing, and the optional
 * auto-start of the local `dsh web` instance. Kept free of Electron imports so
 * the logic is unit-testable in plain Node.
 */

import { spawn } from 'node:child_process'
import { connect } from 'node:net'

/** Default target for `--attach` when no URL is provided. */
export const DEFAULT_ATTACH_URL = 'http://127.0.0.1:3080'

/** Default command used to start the local DSH Web instance. */
export const DEFAULT_DSH_COMMAND = 'dsh'

const PORT_PROBE_TIMEOUT_MS = 2_000
const AUTO_START_TIMEOUT_MS = 90_000
const POLL_INTERVAL_MS = 500

export interface AttachTarget {
  host: string
  port: number
  url: string
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

/** Parse a validated URL into a connectable host/port pair. */
export function parseTargetUrl(url: string): AttachTarget {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch (cause) {
    throw new Error(`dsh-plugin-desktop: invalid attach url ${JSON.stringify(url)}: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`dsh-plugin-desktop: attach url must be an http(s) URL, got ${parsed.protocol}`)
  }
  const port = parsed.port === '' ? (parsed.protocol === 'https:' ? 443 : 80) : Number(parsed.port)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`dsh-plugin-desktop: invalid attach port ${JSON.stringify(parsed.port)}`)
  }
  return { host: parsed.hostname, port, url: parsed.toString() }
}

/** True when the target accepts TCP connections within the timeout. */
export function probePort(host: string, port: number, timeoutMs = PORT_PROBE_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port })
    let settled = false
    const finish = (reachable: boolean): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(reachable)
    }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(timeoutMs, () => finish(false))
  })
}

/** True unless the caller explicitly disabled auto-start. */
export function shouldAutoStart(argv: readonly string[]): boolean {
  return !argv.includes('--no-auto-start')
}

/** The command used to start the local DSH Web instance. */
export function autoStartCommand(argv: readonly string[]): string {
  for (const argument of argv) {
    if (!argument.startsWith('--attach-dsh-command=')) continue
    const value = argument.slice('--attach-dsh-command='.length)
    if (value.length > 0) return value
  }
  return DEFAULT_DSH_COMMAND
}

export interface ReachabilityResult {
  /** True when this call started the local DSH Web instance. */
  started: boolean
  /** True when the target is (or became) reachable. */
  reachable: boolean
}

/**
 * Ensure the target is reachable: probe it, and when it is down and
 * auto-start is enabled, start the local `dsh web` and wait for the port.
 * The spawned process is hidden and unref'd, so no console window appears and
 * it keeps running after this app exits.
 */
export async function ensureTargetReachable(
  target: AttachTarget,
  argv: readonly string[],
  signal?: AbortSignal,
): Promise<ReachabilityResult> {
  if (await probePort(target.host, target.port)) return { started: false, reachable: true }
  if (!shouldAutoStart(argv)) return { started: false, reachable: false }

  const command = autoStartCommand(argv)
  const child = spawn(command, ['web'], {
    stdio: 'ignore',
    windowsHide: true,
    shell: process.platform === 'win32',
  })
  child.unref()

  const deadline = Date.now() + AUTO_START_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (signal?.aborted) return { started: true, reachable: false }
    if (await probePort(target.host, target.port)) return { started: true, reachable: true }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  return { started: true, reachable: false }
}
