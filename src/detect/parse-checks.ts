import { log } from '../shared/log'
import type { CheckGroup, CheckVia, ItemKind, Options, PendingItem, PendingSummary } from '../shared/types'
import { DEFAULT_OPTIONS } from '../shared/types'
import { parseThreads } from './parse-threads'
import {
  ACTIONS_URL,
  AI_REVIEWER_APP_IDS,
  APP_AVATAR,
  AVATAR,
  CHECKS_SECTION,
  CHECK_GROUP,
  CHECK_LINK,
  CHECK_ROW,
  CHECK_TITLE,
  MERGE_BOX,
  PENDING_STATES,
  REVIEWER_ANY_LINK,
  REVIEWER_APP_LINK,
  REVIEWS_SECTION,
  STATE_WORDS,
} from './selectors'

/** Anything with querySelector — a live Document, a fetched one, or a fixture element. */
type Root = Document | Element | DocumentFragment

/**
 * Read the pending-check state out of a PR page.
 *
 * Pure: no globals, no network, no live-DOM assumptions. Give it a Document
 * from the page, a Document from DOMParser, or the merge-box element itself.
 *
 * Returns `unknown` rather than a count whenever it cannot be sure. A
 * confident "PENDING CHECKS: 0" on a PR where CI is still running is the one
 * failure mode that makes the banner worse than nothing.
 */
export function parseChecks(root: Root, options: Options = DEFAULT_OPTIONS): PendingSummary {
  const box = findMergeBox(root)
  if (!box) return { status: 'unknown', reason: 'no merge box in document' }

  const checksSection = box.querySelector(CHECKS_SECTION)
  const reviewsSection = box.querySelector(REVIEWS_SECTION)

  if (!checksSection && !reviewsSection) {
    // A merge box with neither section is a half-rendered React tree, not a
    // repo without CI. Guessing 0 here would flash the banner off mid-load.
    return { status: 'unknown', reason: 'merge box present but no Checks or Reviews section' }
  }

  const groups: CheckGroup[] = []
  if (checksSection) {
    for (const groupEl of checksSection.querySelectorAll(CHECK_GROUP)) {
      const label = groupEl.getAttribute('aria-label')?.trim() ?? ''
      const word = label.replace(/\s+checks$/i, '').trim().toLowerCase()
      const state = STATE_WORDS[word]
      if (!state) {
        return { status: 'unknown', reason: `unrecognized check group: "${label}"` }
      }

      const items = Array.from(groupEl.querySelectorAll(CHECK_ROW), (li) => parseRow(li, options))
      // The header count is authoritative: a collapsed group renders zero rows,
      // so items.length would silently undercount.
      const count = headerCount(box, groupEl) ?? items.length
      groups.push({ state, count, label, items })
    }
  } else {
    log('no Checks section; treating as a repo with no CI configured')
  }

  const denied = (item: PendingItem) =>
    options.denyList.some((needle) => item.name.toLowerCase().includes(needle.toLowerCase()))

  let pendingAiReviews = 0
  let pendingChecks = 0
  const items: PendingItem[] = []

  for (const group of groups.filter((g) => PENDING_STATES.has(g.state))) {
    const kept = group.items.filter((item) => !denied(item))
    items.push(...kept)

    // The header count stays authoritative for the TOTAL; rows only decide how
    // that total splits. Summing rows instead would drift whenever the two
    // disagree — and they do, transiently, because React updates a header's
    // aria-label and adds/removes its rows in separate mutations.
    const total = Math.max(0, group.count - (group.items.length - kept.length))
    const ai = Math.min(kept.filter((item) => item.kind === 'ai_review').length, total)

    pendingAiReviews += ai
    // Everything unaccounted for lands on CI, including rows GitHub collapsed
    // and never rendered. Over-reporting AI reviews is what would make the
    // review guard cry wolf, so that is the safer direction to err in.
    pendingChecks += total - ai

    const unnamed = group.count - group.items.length
    if (unnamed > 0) log(`${group.label}: ${unnamed} of ${group.count} rows not rendered, counted as CI`)
  }

  const reviews = parseReviews(reviewsSection)
  // Bot reviewers always count — a human reviewing before CodeRabbit reports is
  // exactly the mistake this is here to prevent.
  pendingAiReviews += reviews.bots
  const pendingOtherReviews = options.includeOtherReviews ? reviews.others : 0

  // Scanned from the same root. Absent when we were handed only a merge box.
  const threads = parseThreads(root)

  return {
    status: 'ok',
    pending: pendingAiReviews + pendingChecks + pendingOtherReviews,
    pendingAiReviews,
    pendingChecks,
    pendingOtherReviews,
    unattributedReviews: reviews.unattributed,
    items,
    groups,
    unresolvedThreads: threads.status === 'ok' ? threads.unresolvedTotal : 0,
    unresolvedBotThreads: threads.status === 'ok' ? threads.unresolvedBot : 0,
    botThreadAuthors: threads.status === 'ok' ? threads.authors : [],
    threadsScanned: threads.status === 'ok',
  }
}

function findMergeBox(root: Root): Element | null {
  const self = root as Element
  if (typeof self.matches === 'function' && self.matches(MERGE_BOX)) return self
  return root.querySelector(MERGE_BOX)
}

/**
 * Pull the count from the button that controls this group.
 *
 * `aria-label` is "Collapse 20 skipped checks group" / "Expand 1 pending review
 * group"; the visible label is "20 skipped checks". Both survive collapse.
 */
function headerCount(scope: Element, groupEl: Element): number | null {
  const id = groupEl.getAttribute('id')
  if (!id) return null
  const button = scope.querySelector(`button[aria-controls="${cssEscape(id)}"]`)
  if (!button) return null
  return firstInt(button.getAttribute('aria-label')) ?? firstInt(button.textContent)
}

function parseRow(li: Element, options: Options): PendingItem {
  const link = li.querySelector(CHECK_LINK)
  const url = link?.getAttribute('href') ?? undefined

  // Row aria-labels are unreliable for names AND states: a commit status from
  // CodeRabbit renders as aria-label="CodeRabbit " — the trailing state word
  // that Actions rows carry is simply absent. Prefer the title element.
  const name =
    text(link) || text(li.querySelector(CHECK_TITLE)) || li.getAttribute('aria-label')?.trim() || '(unnamed check)'

  const avatar = li.querySelector(AVATAR)?.getAttribute('src') ?? ''
  const appId = APP_AVATAR.exec(avatar)?.[1]
  const via: CheckVia = url && ACTIONS_URL.test(url) ? 'actions' : 'external'

  return {
    name,
    url,
    via,
    isApp: Boolean(appId),
    ...(appId ? { appId } : {}),
    kind: classify(name, appId, options),
  }
}

/**
 * AI reviewer or ordinary CI?
 *
 * App id first where we have one — it survives a bot renaming its check. Name
 * matching is the fallback, and it is unavoidable: Warden and Claude Code run as
 * Actions jobs under the Actions app id, so nothing structural separates them
 * from a test suite.
 */
function classify(name: string, appId: string | undefined, options: Options): ItemKind {
  if (appId && AI_REVIEWER_APP_IDS.has(appId)) return 'ai_review'
  const haystack = name.toLowerCase()
  return options.aiReviewers.some((needle) => haystack.includes(needle.toLowerCase())) ? 'ai_review' : 'ci'
}

type ReviewCounts = {
  /** Requested reviewers that are GitHub Apps. */
  bots: number
  /** Requested reviewers that are not, plus any we could not attribute. */
  others: number
  /** Subset of `others` where the group was collapsed so attribution was impossible. */
  unattributed: number
}

/**
 * Count pending reviewers, split by bot vs everything else.
 *
 * When the group is expanded, `/apps/<slug>` links identify App reviewers
 * precisely. When it is collapsed — GitHub's default — there are no reviewer
 * rows at all, only the header's total, so nothing can be attributed. That
 * total is reported as `unattributed` rather than being guessed at either way.
 */
function parseReviews(reviewsSection: Element | null): ReviewCounts {
  const empty: ReviewCounts = { bots: 0, others: 0, unattributed: 0 }
  if (!reviewsSection) return empty

  const total = pendingReviewTotal(reviewsSection)
  if (total === 0) return empty

  const group = reviewsSection.querySelector(CHECK_GROUP)
  const appLinks = group?.querySelectorAll(REVIEWER_APP_LINK).length ?? 0
  const anyLinks = group?.querySelectorAll(REVIEWER_ANY_LINK).length ?? 0

  if (anyLinks === 0) {
    log(`Reviews group collapsed: ${total} pending reviewer(s), cannot tell bot from human`)
    return { bots: 0, others: total, unattributed: total }
  }

  const bots = Math.min(appLinks, total)
  return { bots, others: Math.max(0, total - bots), unattributed: 0 }
}

/** "Expand 1 pending review group" / "2 pending reviews" -> 1 / 2 */
function pendingReviewTotal(reviewsSection: Element): number {
  for (const el of reviewsSection.querySelectorAll('button, [role="group"]')) {
    const haystack = `${el.getAttribute('aria-label') ?? ''} ${el.textContent ?? ''}`
    const match = /(\d+)\s+pending review/i.exec(haystack)
    if (match) return Number(match[1])
  }
  return 0
}

function text(el: Element | null | undefined): string {
  return el?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
}

function firstInt(value: string | null | undefined): number | null {
  const match = /\d+/.exec(value ?? '')
  return match ? Number(match[0]) : null
}

/** GitHub's React ids look like `_r_c_`, but escape anyway — they are page data. */
function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&')
}
