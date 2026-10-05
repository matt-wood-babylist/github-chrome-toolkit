import { log, warn } from '../shared/log'
import { conversationUrl, type PrContext } from './pr-context'

/**
 * Fetch the Conversation tab's HTML so the banner works on Files/Commits/Checks,
 * where the merge box is not in the DOM at all.
 *
 * In MV3 the *extension* is the request initiator, not the page — so this is a
 * host-permission-gated cross-origin request that happens to point at the
 * page's own origin. `credentials: 'include'` plus the github.com host
 * permission is what carries the session cookie, which is what makes private
 * repos work without a token.
 *
 * Note: <relative-time> uses declarative shadow DOM (<template
 * shadowrootmode>), which DOMParser does not attach. Timestamps are therefore
 * unreadable in the returned document. Nothing in the count needs them.
 */
export async function fetchConversationDoc(ctx: PrContext): Promise<Document | null> {
  const url = conversationUrl(ctx)
  try {
    const res = await fetch(url, {
      credentials: 'include',
      headers: { Accept: 'text/html' },
    })
    if (!res.ok) {
      warn(`session fetch of ${url} returned ${res.status}`)
      return null
    }
    const html = await res.text()
    const doc = new DOMParser().parseFromString(html, 'text/html')
    if (isSignedOut(doc)) {
      warn('session fetch came back signed out — cookies are not reaching github.com')
      return null
    }
    log(`session fetch ok (${html.length} bytes)`)
    return doc
  } catch (error) {
    warn(`session fetch of ${url} failed`, error)
    return null
  }
}

/**
 * If the cookie did not travel, GitHub serves the signed-out shell. Detecting
 * it explicitly turns a confusing "no merge box" into an actionable warning.
 */
function isSignedOut(doc: Document): boolean {
  return Boolean(doc.querySelector('form[action="/session"], a[href^="/login"]')) && !doc.querySelector('meta[name="user-login"][content]:not([content=""])')
}
