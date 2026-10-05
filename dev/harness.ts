import {
  bannerHost,
  bannerShouldShow,
  configureActionEditing,
  hideBanner,
  showBanner,
} from '../src/content/banner'
import { sessionActions } from '../src/content/session-link'
import type { CustomAction } from '../src/shared/types'
import { confirmHost, confirmReviewRequest } from '../src/content/confirm-dialog'
import { installReviewGuard } from '../src/content/review-guard'
import { parseChecks } from '../src/detect/parse-checks'
import type { PendingSummary } from '../src/shared/types'
import { setDebug } from '../src/shared/log'
import { DEFAULT_OPTIONS, type Options } from '../src/shared/types'

// esbuild inlines these at build time, so the harness needs no fetch and no server.
import filesTab from '../test/fixtures/files-tab.html'
import inProgress from '../test/fixtures/in-progress.synthetic.html'
import inFlight from '../test/fixtures/in-flight.html'
import noCi from '../test/fixtures/no-ci.html'
import settled from '../test/fixtures/settled-collapsed-counts.html'
import botThreads from '../test/fixtures/bot-threads.synthetic.html'

/** Points at a real public PR, so the opened session has something to look at. */
const HARNESS_PR = { owner: 'anthropics', repo: 'claude-code', number: 1, tab: 'conversation' } as const

const FIXTURES: Array<{ name: string; html: string; options?: Partial<Options> }> = [
  // Real capture: 6 in progress + 2 pending, all bots already reported.
  { name: 'real: 8 checks, no bots', html: inFlight },
  { name: 'real + bot comments', html: inFlight + botThreads },
  { name: 'checks in flight', html: inProgress },
  // Synthetic throughout, so it is the one the README screenshots are taken from.
  { name: 'in flight + bot comments', html: inProgress + botThreads },
  { name: 'in flight, CodeRabbit denied', html: inProgress, options: { denyList: ['coderabbit'] } },
  { name: 'in flight, no AI registry', html: inProgress, options: { aiReviewers: [] } },
  { name: 'settled', html: settled },
  // Nothing pending, but conversations still open: green yet not ready to merge.
  // The banner shows the unresolved count alone here, and the review guard fires
  // on the bot-opened subset if you then request review.
  { name: 'settled, bots left comments', html: settled + botThreads },
  { name: 'settled + count reviews', html: settled, options: { includeOtherReviews: true } },
  { name: 'no CI configured', html: noCi },
  { name: 'files tab (no merge box)', html: filesTab },
]

const controls = document.getElementById('controls')!
const clicksLog = document.getElementById('clicks')!
let latest: PendingSummary | null = null
const clicks: string[] = []

// Same wiring as the content script, so the harness exercises the real guard.
installReviewGuard({
  getSummary: () => latest,
  getOptions: () => currentOptions,
  getOurHosts: () => [bannerHost(), confirmHost()],
  confirm: confirmReviewRequest,
})

for (const id of ['ready', 'reviewers', 'rerequest', 'unrelated']) {
  document.getElementById(id)?.addEventListener('click', () => {
    clicks.push(`${new Date().toISOString().slice(11, 19)} — ${id} action ran`)
    clicksLog.textContent = clicks.join('\n')
  })
}
const output = document.getElementById('output')!
const mount = document.getElementById('mount')!

setDebug(true)
let currentOptions: Options = DEFAULT_OPTIONS

/**
 * Custom actions, kept in localStorage so they survive a reload the way sync storage
 * would.
 *
 * Saving here re-renders the banner, mirroring the real loop: the content script
 * writes to storage, storage notifies it back, and the refresh lands in
 * `renderPopover` while the editor is still open. That round trip is the reason the
 * popover needs an edit-mode guard at all, so the harness had better reproduce it.
 */
const CUSTOM_KEY = 'ghpb-harness-custom-actions'
let customActions: CustomAction[] = readCustom()

configureActionEditing((next) => {
  customActions = next
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(next))
  render()
})

function readCustom(): CustomAction[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

FIXTURES.forEach((fixture, index) => {
  const button = document.createElement('button')
  button.textContent = fixture.name
  button.setAttribute('aria-pressed', 'false')
  button.addEventListener('click', () => select(index))
  controls.append(button)
})

function select(index: number): void {
  const fixture = FIXTURES[index]
  if (!fixture) return

  for (const [i, button] of Array.from(controls.children).entries()) {
    button.setAttribute('aria-pressed', String(i === index))
  }

  // Parse from a detached document, exactly like the session-fetch path does.
  const doc = new DOMParser().parseFromString(fixture.html, 'text/html')
  const options: Options = { ...DEFAULT_OPTIONS, ...fixture.options }
  currentOptions = options
  const summary = parseChecks(doc, options)
  latest = summary

  render({ remount: true })

  mount.replaceChildren()
  output.textContent = JSON.stringify({ fixture: fixture.name, options, summary }, null, 2)
}

/**
 * Paint the banner for the current fixture.
 *
 * `remount` tears the banner down first, which also drops edit mode — right when
 * switching fixtures, wrong after a save. A save must reach `showBanner` on the
 * live banner, because updating in place while the editor is open is precisely the
 * case that used to wipe the form.
 */
function render({ remount = false } = {}): void {
  if (remount) hideBanner()

  // The same predicate the content script uses, imported rather than restated, so
  // the harness cannot show or hide the banner in a case the extension would not.
  if (latest?.status === 'ok' && bannerShouldShow(latest)) {
    // A stand-in PR so the session buttons render with real deep links. Clicking
    // one here really does try to open Claude Code — that is the point, since the
    // protocol handoff is the part no unit test can cover.
    showBanner(latest, HARNESS_PR, sessionActions(customActions), customActions)
  } else {
    hideBanner()
  }
}

select(0)
