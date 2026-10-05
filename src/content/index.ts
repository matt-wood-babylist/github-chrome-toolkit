import { parseChecks } from '../detect/parse-checks'
import { parsePrContext, samePr, type PrContext } from '../detect/pr-context'
import { MERGE_BOX } from '../detect/selectors'
import { fetchConversationDoc } from '../detect/session-fetch'
import { watchMergeBox } from '../detect/watch'
import { debounce } from '../shared/debounce'
import { log, setDebug } from '../shared/log'
import { loadOptions, saveOptions, watchOptions } from '../shared/options-store'
import { DEFAULT_OPTIONS, type Options, type PendingSummary } from '../shared/types'
import { bannerHost, bannerShouldShow, configureActionEditing, hideBanner, showBanner } from './banner'
import { sessionActions } from './session-link'
import { confirmHost, confirmReviewRequest } from './confirm-dialog'
import { installReviewGuard } from './review-guard'

/** GitHub's own soft-navigation events. All are dispatched on `document`. */
const NAV_EVENTS = ['soft-nav:end', 'turbo:load', 'turbo:render', 'pjax:end'] as const

/**
 * How long to keep watching for the merge box to stream in before giving up.
 * Watching all of <body> is expensive on GitHub, so this window is strictly
 * bounded — a merged or closed PR has no merge box and never will.
 */
const MERGE_BOX_WAIT_MS = 20_000

/** Coalesce event-driven refreshes that would each cost a network fetch. */
const MIN_FETCH_GAP_MS = 2_000

let options: Options = DEFAULT_OPTIONS
let ctx: PrContext | null = null
let lastHref = ''

let navObserver: MutationObserver | null = null
let checkObserver: MutationObserver | null = null
let waitObserver: MutationObserver | null = null
let waitTimer: ReturnType<typeof setTimeout> | undefined
let backstopTimer: ReturnType<typeof setTimeout> | undefined

let refreshing = false
/** A refresh was requested while one was in flight; run it once that finishes. */
let rerunQueued = false
let lastRefreshAt = 0
/** Latest reading, so the review guard can decide without re-parsing. */
let latest: PendingSummary | null = null

void start()

async function start(): Promise<void> {
  options = await loadOptions()
  setDebug(options.debug)
  watchOptions((next) => {
    options = next
    setDebug(next.debug)
    void refresh({ force: true })
  })

  // Editing writes straight to sync storage; watchOptions above then feeds the new
  // list back in, so the bar and the toolbar dropdown stay in step without either
  // knowing about the other.
  configureActionEditing((customActions) => saveOptions({ ...options, customActions }))

  observeNavigation()
  installReviewGuard({
    getSummary: () => latest,
    getOptions: () => options,
    // Never let the guard fire on our own UI.
    getOurHosts: () => [bannerHost(), confirmHost()],
    confirm: confirmReviewRequest,
  })
  document.addEventListener('visibilitychange', onWake)
  window.addEventListener('focus', onWake)
  onLocationChange()
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/**
 * Detect soft navigation without a timer.
 *
 * Content scripts run in an isolated world, so patching history.pushState would
 * only observe our own calls — never GitHub's. Three event-driven signals cover
 * it between them:
 *
 *   1. GitHub's own soft-nav / Turbo events, which cross the world boundary as
 *      ordinary DOM events.
 *   2. popstate, for back/forward.
 *   3. A MutationObserver on <head>, because GitHub rewrites <title> on every
 *      navigation. This is the backstop that replaces polling location.href:
 *      <head> is small and mutates rarely, and onLocationChange() exits
 *      immediately when the URL is unchanged, so spurious fires are ~free.
 *
 * Tab focus (onWake) checks the URL too, so even a missed navigation self-heals
 * the moment you look at the tab.
 */
function observeNavigation(): void {
  for (const event of NAV_EVENTS) document.addEventListener(event, () => onLocationChange())
  window.addEventListener('popstate', () => onLocationChange())

  navObserver = new MutationObserver(debounce(() => onLocationChange(), 100))
  navObserver.observe(document.head, { childList: true, subtree: true, characterData: true })
}

/** Returns true when this call detected a change and kicked off its own refresh. */
function onLocationChange(): boolean {
  if (location.href === lastHref) return false
  lastHref = location.href

  const next = parsePrContext(location.pathname)
  const changedPr = !samePr(ctx, next)
  ctx = next

  if (!ctx) {
    latest = null
    teardown()
    return true
  }

  // A different PR: nothing read from the previous one may stay on screen or feed
  // the guard while this one's first refresh is in flight.
  if (changedPr) {
    latest = null
    clearTimeout(backstopTimer)
    backstopTimer = undefined
    hideBanner()
  }

  log(`on PR ${ctx.owner}/${ctx.repo}#${ctx.number} (${ctx.tab})`)
  attachCheckObserver()
  void refresh({ force: true })
  return true
}

function onWake(): void {
  if (document.visibilityState !== 'visible') {
    // Never poll a tab nobody is looking at. Chrome would throttle the timer
    // anyway; clearing it means zero requests instead of one a minute.
    clearTimeout(backstopTimer)
    backstopTimer = undefined
    return
  }
  if (!onLocationChange()) void refresh()
}

// ---------------------------------------------------------------------------
// Change detection
// ---------------------------------------------------------------------------

/**
 * On the Conversation tab GitHub keeps the merge box live-updated itself, so
 * observing that subtree gives instant, network-free updates. Every other tab
 * has no merge box in the DOM at all, so there is nothing to observe and the
 * count has to come from a fetch.
 */
function attachCheckObserver(): void {
  disconnectCheckObservers()
  if (ctx?.tab !== 'conversation') return

  const box = document.querySelector(MERGE_BOX)
  if (!box) {
    waitForMergeBox()
    return
  }

  checkObserver = watchMergeBox(box, () => void refresh())
  log('watching merge box for changes')
}

function waitForMergeBox(): void {
  const stop = (): void => {
    waitObserver?.disconnect()
    waitObserver = null
    clearTimeout(waitTimer)
    waitTimer = undefined
  }

  waitObserver = new MutationObserver(
    debounce(() => {
      if (!document.querySelector(MERGE_BOX)) return
      stop()
      attachCheckObserver()
      void refresh({ force: true })
    }, 250),
  )
  waitObserver.observe(document.body, { childList: true, subtree: true })

  waitTimer = setTimeout(() => {
    stop()
    log('merge box never appeared — merged or closed PR, nothing to watch')
  }, MERGE_BOX_WAIT_MS)
}

function disconnectCheckObservers(): void {
  checkObserver?.disconnect()
  checkObserver = null
  waitObserver?.disconnect()
  waitObserver = null
  clearTimeout(waitTimer)
  waitTimer = undefined
}

function teardown(): void {
  latest = null
  disconnectCheckObservers()
  clearTimeout(backstopTimer)
  backstopTimer = undefined
  hideBanner()
}

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

async function refresh({ force = false } = {}): Promise<void> {
  if (!ctx) return
  if (refreshing) {
    // Dropping this would lose a navigation's refresh: the in-flight one then
    // fails the samePr check below and nothing reads the new PR.
    rerunQueued = true
    return
  }
  const forPr = ctx

  // Reading the live DOM is free, so the Conversation tab always refreshes.
  // Every other tab costs a PR-page fetch, so coalesce bursts — focus and
  // visibilitychange often fire together.
  const needsNetwork = forPr.tab !== 'conversation'
  if (needsNetwork && !force && Date.now() - lastRefreshAt < MIN_FETCH_GAP_MS) {
    log('skipping refresh: too soon after the last fetch')
    return
  }

  refreshing = true
  try {
    const summary = needsNetwork ? await fetchSummary(forPr) : parseChecks(document, options)
    lastRefreshAt = Date.now()

    // A slow fetch can land after the user navigated to another PR.
    if (!samePr(ctx, forPr)) return

    // The guard reads this, so it must reflect the current PR even when the
    // banner itself stays hidden (bots done but unresolved comments left).
    latest = summary

    if (summary.status === 'unknown') {
      log(`hiding banner: ${summary.reason}`)
      hideBanner()
    } else if (bannerShouldShow(summary)) {
      // forPr, not ctx: this is the PR the summary was actually read from, and a
      // slow fetch could otherwise put the previous PR's URL on the buttons.
      showBanner(summary, forPr, sessionActions(options.customActions), options.customActions)
    } else {
      hideBanner()
    }

    scheduleBackstop(summary)
  } finally {
    refreshing = false
    if (rerunQueued) {
      rerunQueued = false
      void refresh({ force: true })
    }
  }
}

async function fetchSummary(forPr: PrContext): Promise<PendingSummary> {
  const doc = await fetchConversationDoc(forPr)
  if (!doc) return { status: 'unknown', reason: 'session fetch unavailable' }
  return parseChecks(doc, options)
}

/**
 * The only timer in the extension, and it is armed only when all three of these
 * hold:
 *
 *   - we are NOT on the Conversation tab (there, the merge-box observer already
 *     reports changes the moment GitHub makes them);
 *   - the tab is visible (nobody is waiting on a count they cannot see);
 *   - something is actually pending (a settled PR has nothing to tick down).
 *
 * Outside that intersection there is no polling at all. Going from 0 pending to
 * some pending — a fresh push — is picked up on the next focus, navigation, or
 * visibility change instead of by asking github.com every 30 seconds forever.
 */
function scheduleBackstop(summary: PendingSummary): void {
  clearTimeout(backstopTimer)
  backstopTimer = undefined

  if (!ctx || ctx.tab === 'conversation') return
  if (document.visibilityState !== 'visible') return
  if (summary.status !== 'ok' || summary.pending === 0) return

  const seconds = options.pendingRefreshSeconds
  backstopTimer = setTimeout(() => void refresh(), seconds * 1000)
  log(`${summary.pending} pending on the ${ctx.tab} tab; re-checking in ${seconds}s`)
}
