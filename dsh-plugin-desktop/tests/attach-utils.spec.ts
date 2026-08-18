import { createServer } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  attachUrlFromMainArgv,
  autoStartCommand,
  DEFAULT_ATTACH_URL,
  DEFAULT_DSH_COMMAND,
  parseTargetUrl,
  probePort,
  shouldAutoStart,
} from '../src/attach-utils.ts'

describe('attach URL parsing', () => {
  it('defaults to the local dsh web port', () => {
    expect(DEFAULT_ATTACH_URL).toBe('http://127.0.0.1:3080')
    expect(attachUrlFromMainArgv([])).toBe(DEFAULT_ATTACH_URL)
  })

  it('reads --attach-url= from argv', () => {
    expect(attachUrlFromMainArgv(['--attach-url=http://127.0.0.1:9000'])).toBe('http://127.0.0.1:9000/')
  })

  it('rejects empty or non-http urls', () => {
    expect(() => attachUrlFromMainArgv(['--attach-url='])).toThrow('non-empty URL')
    expect(() => attachUrlFromMainArgv(['--attach-url=file:///tmp/x'])).toThrow('http(s) URL')
  })

  it('parses a target into host and port', () => {
    expect(parseTargetUrl('http://127.0.0.1:3080')).toEqual({ host: '127.0.0.1', port: 3080, url: 'http://127.0.0.1:3080/' })
    expect(parseTargetUrl('https://example.com')).toEqual({ host: 'example.com', port: 443, url: 'https://example.com/' })
    expect(() => parseTargetUrl('not a url')).toThrow('invalid attach url')
    expect(() => parseTargetUrl('http://127.0.0.1:99999')).toThrow()
  })
})

describe('port probing', () => {
  const server = createServer()
  let port = 0

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (address !== null && typeof address === 'object') port = address.port
        resolve()
      })
    })
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('reports reachable for a listening port', async () => {
    await expect(probePort('127.0.0.1', port)).resolves.toBe(true)
  })

  it('reports unreachable for a closed port', async () => {
    await expect(probePort('127.0.0.1', 1, 300)).resolves.toBe(false)
  })
})

describe('auto-start flags', () => {
  it('enables auto-start by default', () => {
    expect(shouldAutoStart([])).toBe(true)
    expect(shouldAutoStart(['--attach-url=http://127.0.0.1:3080'])).toBe(true)
  })

  it('honors --no-auto-start', () => {
    expect(shouldAutoStart(['--no-auto-start'])).toBe(false)
  })

  it('resolves the dsh command', () => {
    expect(autoStartCommand([])).toBe(DEFAULT_DSH_COMMAND)
    expect(autoStartCommand(['--attach-dsh-command=dsh.cmd'])).toBe('dsh.cmd')
    expect(autoStartCommand(['--attach-dsh-command='])).toBe(DEFAULT_DSH_COMMAND)
  })
})
