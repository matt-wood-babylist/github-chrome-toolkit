import { describe, expect, it } from 'vitest'
import { popupState } from '../src/popup/model'
import { SESSION_ACTIONS, sessionActions, type SessionAction } from '../src/content/session-link'

const PR_URL = 'https://github.com/acme/web/pull/1234'

/** Narrowing helper: these tests assert on the actions branch a lot. */
function actions(url: string | undefined, list?: readonly SessionAction[]) {
  const state = list ? popupState(url, list) : popupState(url)
  if (state.kind !== 'actions') throw new Error(`expected actions, got: ${state.reason}`)
  return state
}

describe('popupState', () => {
  it('offers the same two actions as the banner, in the same order', () => {
    // Reading them off SESSION_ACTIONS rather than hardcoding: the point of the
    // shared module is that the toolbar and the banner cannot drift apart.
    expect(actions(PR_URL).links.map((l) => l.id)).toEqual(SESSION_ACTIONS.map((a) => a.id))
    expect(actions(PR_URL).links.map((l) => l.label)).toEqual(SESSION_ACTIONS.map((a) => a.label))
  })

  it('carries the command each action runs, which the popup shows beside the name', () => {
    expect(actions(PR_URL).links.map((l) => l.command)).toEqual(SESSION_ACTIONS.map((a) => a.command))
  })

  it('carries a custom action’s command too, not only the built-ins', () => {
    const custom = sessionActions([{ label: 'Write the changelog', command: '/changelog' }])
    expect(actions(PR_URL, custom).links.at(-1)).toMatchObject({
      label: 'Write the changelog',
      command: '/changelog',
    })
  })

  it('builds the same deep links the banner builds', () => {
    const q = (url: string) => new URL(url).searchParams.get('q')
    const links = actions(PR_URL).links
    expect(q(links[0]!.url)).toBe('/pr-review https://github.com/acme/web/pull/1234')
    expect(q(links[1]!.url)).toBe('/pr-respond https://github.com/acme/web/pull/1234')
    expect(q(links[2]!.url)).toBe('/fix-ci-tests https://github.com/acme/web/pull/1234')
  })

  it('names the pull request the actions will act on', () => {
    // Shown in the popup so it is never a guess which PR a session opens against.
    expect(actions(PR_URL).ref).toBe('acme/web #1234')
  })

  it('works from any tab of the pull request', () => {
    for (const tab of ['', '/files', '/commits', '/checks', '/commits/abc123']) {
      expect(actions(`${PR_URL}${tab}`).ref).toBe('acme/web #1234')
    }
  })

  it('ignores query strings and fragments', () => {
    expect(actions(`${PR_URL}/files?diff=split#r123`).ref).toBe('acme/web #1234')
  })

  it('offers configured custom actions too', () => {
    const state = popupState(PR_URL, sessionActions([{ label: 'Changelog', command: '/changelog' }]))
    if (state.kind !== 'actions') throw new Error(state.reason)
    expect(state.links.map((l) => l.label)).toEqual([
      ...SESSION_ACTIONS.map((a) => a.label),
      'Changelog',
    ])
    expect(new URL(state.links.at(-1)!.url).searchParams.get('q')).toBe(
      '/changelog https://github.com/acme/web/pull/1234',
    )
  })

  describe('empty states', () => {
    it('explains itself when no tab URL is readable', () => {
      // The normal case for a tab we hold no host permission for: Chrome omits
      // the URL rather than erroring, so this is not a failure path.
      expect(popupState(undefined)).toEqual({
        kind: 'empty',
        reason: 'Open a GitHub pull request to start a session.',
      })
    })

    it('rejects a look-alike host with a pull-request-shaped path', () => {
      // The host check is not redundant with the path parse: parsePrContext only
      // sees a pathname, so this would otherwise put a foreign origin's path
      // straight into a prompt.
      const state = popupState('https://example.com/acme/web/pull/1234')
      expect(state).toEqual({ kind: 'empty', reason: 'Not a GitHub page.' })
    })

    it.each([
      'https://github.com/acme/web',
      'https://github.com/acme/web/pulls',
      'https://github.com/acme/web/issues/5',
      'https://github.com/notifications',
      'https://github.com/',
    ])('says %s is not a pull request', (url) => {
      expect(popupState(url)).toEqual({ kind: 'empty', reason: 'Not a pull request page.' })
    })

    it('does not treat a subdomain as github.com', () => {
      expect(popupState('https://gist.github.com/acme/web/pull/1').kind).toBe('empty')
    })

    it('survives a URL it cannot parse', () => {
      expect(popupState('not a url').kind).toBe('empty')
    })

    it('cannot be given a traversal owner, because URL parsing removes it first', () => {
      // Worth pinning rather than assuming: `new URL()` applies dot-segment
      // removal, so `/../web/pull/1` normalises to `/web/pull/1` — three
      // segments, which is not a PR path. The traversal guard inside sessionUrl
      // is therefore unreachable from this surface, and stays as defence for
      // callers that build a PrContext some other way. Percent-encoding does not
      // get around it either: %2e is decoded before normalisation.
      for (const url of ['https://github.com/../web/pull/1', 'https://github.com/%2e%2e/web/pull/1']) {
        expect(popupState(url)).toEqual({ kind: 'empty', reason: 'Not a pull request page.' })
      }
    })
  })
})
