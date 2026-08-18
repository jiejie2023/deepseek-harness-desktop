import { describe, expect, it } from 'vitest'
import { parseTarget } from '../src/index.ts'

describe('dsh-desktop-attach target parsing', () => {
  it('accepts an explicit port', () => {
    expect(parseTarget('http://127.0.0.1:3080')).toEqual({ host: '127.0.0.1', port: 3080 })
  })

  it('defaults http to port 80 and https to 443', () => {
    expect(parseTarget('http://example.com')).toEqual({ host: 'example.com', port: 80 })
    expect(parseTarget('https://example.com')).toEqual({ host: 'example.com', port: 443 })
  })

  it('accepts a hostname without scheme only when a scheme is present', () => {
    expect(() => parseTarget('127.0.0.1:3080')).toThrow('invalid url')
  })

  it('rejects non-http schemes', () => {
    expect(() => parseTarget('file:///tmp/x')).toThrow('must be an http(s) URL')
  })

  it('rejects out-of-range ports', () => {
    expect(() => parseTarget('http://127.0.0.1:99999')).toThrow()
  })
})
