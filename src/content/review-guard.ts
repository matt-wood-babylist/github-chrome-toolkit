import { INTERACTIVE, REVIEW_REQUEST_CONTROLS } from '../detect/selectors'
import { log } from '../shared/log'
import type { Options, PendingSummary } from '../shared/types'

export type GuardedControl = {
  element: HTMLElement
  /** Human-readable description of what was clicked, quoted back in the dialog. */
  what: string
  id: string
}

export type GuardReason =
  | { kind: 'ai_reviews'; count: number; names: string[] }
  | { kind: 'unresolved'; count: number; names: string[] }
  | { kind: 'checks'; count: number; names: string[] }
  | { kind: 'unattributed'; count: number; names: string[] }

/**
 * Should clicking a review-request control be interrupted?
 *
 * Fails OPEN in every uncertain case. Two rules matter more than the logic:
 *
 *  - `status: 'unknown'` never blocks. We have already admitted we cannot read
 *    the page; interrupting someone on the strength of a number we do not trust
 *    is worse than missing the guard entirely.
 *  - CI alone never blocks by default. A dialog that fires for a trailing lint
 *    job gets click-through-dismissed within a week, and then it protects
 *    nothing. Precision is the whole value here.
 */
export function guardReasons(summary: PendingSummary | null, options: Options): GuardReason[] {
  if (!options.guardReviewRequests) return []
  if (!summary || summary.status !== 'ok') return []

  const reasons: GuardReason[] = []

  if (summary.pendingAiReviews > 0) {
    reasons.push({
      kind: 'ai_reviews',
      count: summary.pendingAiReviews,
      names: summary.items.filter((item) => item.kind === 'ai_review').map((item) => item.name),
    })
  }

  if (options.guardOnUnresolvedBotComments && summary.unresolvedBotThreads > 0) {
    reasons.push({
      kind: 'unresolved',
      count: summary.unresolvedBotThreads,
      names: summary.botThreadAuthors,
    })
  }

  if (options.guardOnAnyPending && summary.pendingChecks > 0) {
    reasons.push({
      kind: 'checks',
      count: summary.pendingChecks,
      names: summary.items.filter((item) => item.kind === 'ci').map((item) => item.name),
    })
  }

  // Never a reason on its own — we do not know it is a bot. Added as context
  // only once something else has already earned the interruption.
  if (reasons.length > 0 && summary.unattributedReviews > 0) {
    reasons.push({ kind: 'unattributed', count: summary.unattributedReviews, names: [] })
  }

  return reasons
}

/**
 * Find the review-request control this event is heading for, if any.
 *
 * `composedPath()` so a click on a label or icon inside the button still
 * resolves to the button, and so events from our own shadow tree can be ruled
 * out wholesale.
 */
export function findGuardedControl(event: Event, ourHosts: Array<Element | null>): GuardedControl | null {
  const path = event.composedPath()
  if (ourHosts.some((host) => host && path.includes(host))) return null

  for (const node of path) {
    if (!(node instanceof Element)) continue
    if (!node.matches(INTERACTIVE)) continue

    const name = accessibleName(node)
    if (!name) continue

    const control = REVIEW_REQUEST_CONTROLS.find((candidate) => candidate.match.test(name))
    if (control) return { element: node as HTMLElement, what: control.what, id: control.id }
  }
  return null
}

/**
 * Close enough to an accessible name for matching a primary action: the aria
 * label if present, otherwise the visible text.
 *
 * Decorative characters are stripped before matching. A button's textContent
 * collects whatever rides along inside it — chevrons, arrows, badge glyphs — so
 * "Ready for review▸" has to normalize to "Ready for review" or anchored
 * patterns silently stop matching. Letters, digits, spaces and hyphens survive;
 * hyphens because "Re-request review" needs one.
 */
function accessibleName(el: Element): string {
  const aria = el.getAttribute('aria-label')?.trim()
  const raw = aria || el.textContent || ''
  return raw
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export type InstallOptions = {
  getSummary: () => PendingSummary | null
  getOptions: () => Options
  /** Our own shadow hosts, so the guard never fires on the banner or the dialog. */
  getOurHosts: () => Array<Element | null>
  /** Resolves true when the user chooses to proceed anyway. */
  confirm: (control: GuardedControl, reasons: GuardReason[]) => Promise<boolean>
}

/**
 * Intercept review-request clicks. Returns a teardown function.
 *
 * Capture phase, because GitHub attaches its own handlers to these buttons and
 * we have to win before they run — hence `stopImmediatePropagation` too.
 */
export function installReviewGuard(install: InstallOptions): () => void {
  /** The one control allowed through next, after the user chose to proceed. */
  let bypass: Element | null = null

  const onClick = (event: Event): void => {
    const control = findGuardedControl(event, install.getOurHosts())
    if (!control) return

    if (bypass === control.element) {
      bypass = null
      log(`allowing ${control.id} through after confirmation`)
      return
    }

    const reasons = guardReasons(install.getSummary(), install.getOptions())
    if (reasons.length === 0) return

    log(`intercepted ${control.id}: ${reasons.map((r) => r.kind).join(', ')}`)
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()

    void install.confirm(control, reasons).then((proceed) => {
      if (!proceed) return
      // Re-dispatch on the element we matched, not the original event target, so
      // a click on an inner icon still triggers the button's own handler.
      bypass = control.element
      control.element.click()
    })
  }

  document.addEventListener('click', onClick, true)
  return () => {
    document.removeEventListener('click', onClick, true)
    bypass = null
  }
}
