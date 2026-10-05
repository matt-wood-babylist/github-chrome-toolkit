import type { SessionAction } from '../content/session-link'
import { SESSION_ACTIONS, resolveFolder, sessionUrl } from '../content/session-link'
import { parsePrContext } from '../detect/pr-context'
import type { PrContext } from '../detect/pr-context'

/**
 * The toolbar popup shows the same session actions as the banner — built-ins plus
 * whatever custom ones are configured — so that they are reachable when the banner
 * is not, most importantly on a PR with nothing pending, where the banner removes
 * itself entirely.
 *
 * Everything here is pure so it can be tested without a browser: the popup script
 * is then a dozen lines of DOM.
 */
export type PopupLink = { id: string; label: string; command: string; title: string; url: string }

export type PopupState =
  | { kind: 'actions'; ctx: PrContext; ref: string; links: PopupLink[] }
  | { kind: 'empty'; reason: string }

/** Only github.com. The extension holds no other host permission. */
const GITHUB_HOST = 'github.com'

/**
 * Decide what the popup should show, from the active tab's URL.
 *
 * `undefined` is the normal case for any tab we hold no host permission for —
 * Chrome omits `tab.url` rather than erroring — so it is treated as "not a PR",
 * not as a failure.
 */
export function popupState(
  tabUrl: string | undefined,
  actions: readonly SessionAction[] = SESSION_ACTIONS,
): PopupState {
  if (!tabUrl) {
    return { kind: 'empty', reason: 'Open a GitHub pull request to start a session.' }
  }

  let url: URL
  try {
    url = new URL(tabUrl)
  } catch {
    return { kind: 'empty', reason: 'Open a GitHub pull request to start a session.' }
  }

  // The host check is not redundant with the path parse. `parsePrContext` only
  // sees a pathname, so `https://example.com/acme/web/pull/1` would parse as a
  // perfectly good pull request and put a foreign origin's path into a prompt.
  if (url.host !== GITHUB_HOST) {
    return { kind: 'empty', reason: 'Not a GitHub page.' }
  }

  const ctx = parsePrContext(url.pathname)
  if (!ctx) {
    return { kind: 'empty', reason: 'Not a pull request page.' }
  }

  const folder = resolveFolder(ctx)
  const links: PopupLink[] = []
  for (const action of actions) {
    const href = sessionUrl(action, ctx, folder)
    if (href) {
      links.push({
        id: action.id,
        label: action.label,
        command: action.command,
        title: action.title,
        url: href,
      })
    }
  }

  if (links.length === 0) {
    // sessionUrl refused every action, which means the owner/repo did not survive
    // validation. Say so rather than showing an empty panel.
    return { kind: 'empty', reason: 'This pull request URL could not be read safely.' }
  }

  return { kind: 'actions', ctx, ref: `${ctx.owner}/${ctx.repo} #${ctx.number}`, links }
}
