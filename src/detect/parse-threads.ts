import { log } from '../shared/log'
import {
  APP_PROFILE_URL,
  APP_AVATAR,
  BOT_BADGE,
  BOT_BADGE_TEXT,
  BOT_LOGIN,
  COMMENT_AUTHOR,
  DISCUSSION_TIMELINE,
  THREAD_AVATAR,
  THREAD_COMMENT,
  THREAD_CONTAINER,
  THREAD_RESOLVED_ATTR,
} from './selectors'

type Root = Document | Element | DocumentFragment

export type ThreadSummary =
  | {
      status: 'ok'
      /** Every unresolved thread, whoever opened it — what GitHub calls "unresolved conversations". */
      unresolvedTotal: number
      /** The subset opened by a bot. The review guard fires on this, not the total. */
      unresolvedBot: number
      /** Display names of the bots that opened those threads. */
      authors: string[]
    }
  | { status: 'unavailable'; reason: string }

/**
 * Count unresolved review threads: the total, and the bot-opened subset.
 *
 * The bot subset exists because "nothing is pending" is not the same as "ready
 * for a human". CodeRabbit finishing and leaving eight unread comments makes
 * requesting review just as premature as requesting it while CodeRabbit was
 * still working — the reviewer reads the code, the bot's points get addressed
 * afterwards, and they have to come back. Only that subset gates a review
 * request; a human's open thread is the reviewer's own business.
 *
 * The total is what the banner reports, matching the "N unresolved conversations"
 * GitHub shows in its own merge box.
 *
 * Reports `unavailable` rather than 0 when the timeline is not in the document.
 * A fetched merge box has no timeline, and neither does a drifted selector; in
 * both cases "0 unresolved" would be a claim we have not earned.
 */
export function parseThreads(root: Root): ThreadSummary {
  const timeline = root.querySelector(DISCUSSION_TIMELINE)
  if (!timeline) return { status: 'unavailable', reason: 'no discussion timeline in document' }

  const threads = timeline.querySelectorAll(THREAD_CONTAINER)
  if (threads.length === 0) {
    // A timeline with no resolvable threads is a genuine zero: the PR has no
    // review comments yet. Distinct from having no timeline at all.
    log('timeline present with no review threads')
    return { status: 'ok', unresolvedTotal: 0, unresolvedBot: 0, authors: [] }
  }

  let unresolvedTotal = 0
  let unresolvedBot = 0
  const authors = new Set<string>()

  for (const thread of threads) {
    // Explicit "true" only — an absent attribute means unresolved, and we must
    // not treat a missing attribute as resolved or we would under-report.
    if (thread.getAttribute(THREAD_RESOLVED_ATTR) === 'true') continue

    unresolvedTotal += 1

    const author = botAuthorOf(thread)
    if (!author) continue // a human's open thread does not gate a review request

    unresolvedBot += 1
    authors.add(author)
  }

  log(
    `${unresolvedTotal} unresolved thread(s), ${unresolvedBot} from bots` +
      ` (${[...authors].join(', ') || 'nobody'})`,
  )
  return { status: 'ok', unresolvedTotal, unresolvedBot, authors: [...authors] }
}

/**
 * Identify the bot that OPENED a thread, returning its display name.
 *
 * Scoped to the thread's first comment, not the thread as a whole. Threads mix
 * authors — a real PR had a bot's finding with the author's reply under it — so
 * "a bot appears somewhere in here" would also fire when a human opened the
 * thread and a bot replied, counting a human conversation as unread bot feedback.
 * Blocking a review request over that is worse than missing one: the guard only
 * works if the user trusts it.
 *
 * Falls back to the whole thread when no `.js-comment` is present, so a markup
 * change that renames the comment wrapper degrades to the old, looser behaviour
 * rather than to "no bots anywhere".
 *
 * Four signals, any one of which is enough:
 *
 *   1. An /apps/<slug> profile link — only GitHub Apps have one.
 *   2. A `[bot]` login suffix.
 *   3. A "Bot" badge beside the author. Needed because GitHub renders
 *      `github-actions` + a separate Bot label rather than `github-actions[bot]`.
 *   4. An /in/<id> avatar.
 */
function botAuthorOf(thread: Element): string | null {
  const opener = thread.querySelector(THREAD_COMMENT) ?? thread
  const links = Array.from(opener.querySelectorAll(COMMENT_AUTHOR))

  for (const link of links) {
    const href = link.getAttribute('href') ?? ''
    const slug = APP_PROFILE_URL.exec(href)?.[1]
    if (slug) return slug

    const login = link.textContent?.trim() ?? ''
    if (BOT_LOGIN.test(login)) return login.replace(BOT_LOGIN, '').trim() || login
  }

  // Scoped to Label components rather than any element reading "Bot", so a
  // comment body that happens to say "Bot" cannot trigger this.
  const badged = Array.from(opener.querySelectorAll(BOT_BADGE)).some((el) =>
    BOT_BADGE_TEXT.test(el.textContent?.trim() ?? ''),
  )
  if (badged) {
    const login = links[0]?.textContent?.trim()
    if (login) return login
  }

  // THREAD_AVATAR, not AVATAR: the timeline tags no avatar with a data-testid,
  // so the merge box's selector matched nothing here and this signal was dead.
  const avatar = Array.from(opener.querySelectorAll(THREAD_AVATAR)).find((img) =>
    APP_AVATAR.test(img.getAttribute('src') ?? ''),
  )
  if (avatar) return avatar.getAttribute('alt')?.replace(/^@/, '').trim() || 'a bot'

  return badged ? 'a bot' : null
}
