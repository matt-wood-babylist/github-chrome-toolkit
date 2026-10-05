import { describe, expect, it } from 'vitest'
import { conversationUrl, parsePrContext, samePr } from '../src/detect/pr-context'

describe('parsePrContext', () => {
  it('recognizes the conversation tab', () => {
    expect(parsePrContext('/acme/web/pull/1200')).toEqual({
      owner: 'acme',
      repo: 'web',
      number: 1200,
      tab: 'conversation',
    })
  })

  it.each([
    ['/acme/web/pull/1/files', 'files'],
    ['/acme/web/pull/1/commits', 'commits'],
    ['/acme/web/pull/1/checks', 'checks'],
  ])('recognizes %s', (path, tab) => {
    expect(parsePrContext(path)?.tab).toBe(tab)
  })

  it('tolerates trailing segments like a commit sha or diff range', () => {
    expect(parsePrContext('/acme/web/pull/1/commits/abc123')?.tab).toBe('commits')
    expect(parsePrContext('/acme/web/pull/1/files/abc123..def456')?.tab).toBe('files')
  })

  it.each([
    '/acme/web/pulls',
    '/acme/web/pull/notanumber',
    '/acme/web/issues/1',
    '/acme/web',
    '/',
    '/acme/web/pull/1/unknown-tab',
  ])('rejects %s', (path) => {
    expect(parsePrContext(path)).toBeNull()
  })

  it('builds the conversation URL for the session fetch', () => {
    const ctx = parsePrContext('/acme/web/pull/1200/files')
    expect(ctx && conversationUrl(ctx)).toBe('https://github.com/acme/web/pull/1200')
  })
})

describe('samePr', () => {
  it('ignores which tab is open', () => {
    expect(samePr(parsePrContext('/a/b/pull/1'), parsePrContext('/a/b/pull/1/files'))).toBe(true)
  })

  it('distinguishes different PRs and null', () => {
    expect(samePr(parsePrContext('/a/b/pull/1'), parsePrContext('/a/b/pull/2'))).toBe(false)
    expect(samePr(parsePrContext('/a/b/pull/1'), null)).toBe(false)
    expect(samePr(null, null)).toBe(true)
  })
})
