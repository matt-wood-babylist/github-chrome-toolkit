import { afterEach, describe, expect, it, vi } from 'vitest'
import { findGuardedControl, guardReasons, installReviewGuard } from '../src/content/review-guard'
import { DEFAULT_OPTIONS, type OkSummary, type Options, type PendingSummary } from '../src/shared/types'

function opts(overrides: Partial<Options> = {}): Options {
  return { ...DEFAULT_OPTIONS, ...overrides }
}

function summary(overrides: Partial<OkSummary> = {}): OkSummary {
  return {
    status: 'ok',
    pending: 0,
    pendingAiReviews: 0,
    pendingChecks: 0,
    pendingOtherReviews: 0,
    unattributedReviews: 0,
    items: [],
    groups: [],
    unresolvedThreads: 0,
  unresolvedBotThreads: 0,
    botThreadAuthors: [],
    threadsScanned: true,
    ...overrides,
  }
}

const aiPending = () =>
  summary({
    pending: 1,
    pendingAiReviews: 1,
    items: [{ name: 'CodeRabbit', via: 'external', isApp: true, appId: '347564', kind: 'ai_review' }],
  })

afterEach(() => {
  document.body.replaceChildren()
})

/**
 * Click `target` and report what the guard matched. Returned rather than
 * assigned to an outer variable: TypeScript cannot see the callback assignment
 * and narrows such a variable to `never`.
 */
function captureControl(target: HTMLElement, ourHosts: Array<Element | null> = []) {
  let found: ReturnType<typeof findGuardedControl> = null
  const listener = (event: Event) => {
    found = findGuardedControl(event, ourHosts)
  }
  document.addEventListener('click', listener, true)
  target.click()
  document.removeEventListener('click', listener, true)
  return found as ReturnType<typeof findGuardedControl>
}

describe('guardReasons', () => {
  it('blocks when an AI reviewer is still working', () => {
    const reasons = guardReasons(aiPending(), opts())
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toMatchObject({ kind: 'ai_reviews', count: 1, names: ['CodeRabbit'] })
  })

  it('never blocks when the page could not be read', () => {
    // We have already admitted we cannot trust a number here. Interrupting on
    // the strength of it would be worse than missing the guard entirely.
    const unknown: PendingSummary = { status: 'unknown', reason: 'no merge box in document' }
    expect(guardReasons(unknown, opts())).toEqual([])
    expect(guardReasons(null, opts())).toEqual([])
  })

  it('does not block for CI alone by default', () => {
    // A dialog that fires for a trailing lint job gets dismissed reflexively,
    // and then it protects nothing.
    const ci = summary({ pending: 4, pendingChecks: 4 })
    expect(guardReasons(ci, opts())).toEqual([])
  })

  it('blocks for CI when explicitly asked to', () => {
    const ci = summary({ pending: 4, pendingChecks: 4 })
    const reasons = guardReasons(ci, opts({ guardOnAnyPending: true }))
    expect(reasons.map((r) => r.kind)).toEqual(['checks'])
  })

  it('blocks on unresolved bot comments even with nothing pending', () => {
    // Bots finishing is not the same as their feedback being read.
    const done = summary({ unresolvedBotThreads: 6, botThreadAuthors: ['coderabbitai'] })
    const reasons = guardReasons(done, opts())
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toMatchObject({ kind: 'unresolved', count: 6, names: ['coderabbitai'] })
  })

  it('does not block on a human’s open thread, however many there are', () => {
    // The banner reports every unresolved conversation, but only the bot subset
    // gates a review request: a human's open thread is the reviewer's own
    // business, and blocking on it would make the guard something to click past.
    const human = summary({ unresolvedThreads: 9, unresolvedBotThreads: 0, botThreadAuthors: [] })
    expect(guardReasons(human, opts())).toEqual([])
  })

  it('can be told to ignore unresolved comments', () => {
    const done = summary({ unresolvedBotThreads: 6 })
    expect(guardReasons(done, opts({ guardOnUnresolvedBotComments: false }))).toEqual([])
  })

  it('never blocks on unattributed reviewers alone', () => {
    // We do not know it is a bot, so it cannot earn an interruption by itself.
    const only = summary({ unattributedReviews: 2 })
    expect(guardReasons(only, opts())).toEqual([])
  })

  it('adds unattributed reviewers as context once something else blocks', () => {
    const both = { ...aiPending(), unattributedReviews: 2 }
    expect(guardReasons(both, opts()).map((r) => r.kind)).toEqual(['ai_reviews', 'unattributed'])
  })

  it('goes quiet entirely when the guard is disabled', () => {
    expect(guardReasons(aiPending(), opts({ guardReviewRequests: false }))).toEqual([])
  })
})

describe('findGuardedControl', () => {
  function clickOn(html: string): { control: ReturnType<typeof findGuardedControl>; el: Element } {
    const wrapper = document.createElement('div')
    wrapper.innerHTML = html // trusted: authored right here, not scraped
    document.body.append(wrapper)
    const el = wrapper.firstElementChild!
    let control: ReturnType<typeof findGuardedControl> = null
    const target = (el.querySelector('[data-click]') ?? el) as HTMLElement
    document.addEventListener('click', (e) => (control = findGuardedControl(e, [])), { capture: true, once: true })
    target.click()
    return { control, el }
  }

  it.each([
    ['<button>Ready for review</button>', 'ready-for-review'],
    ['<button>Reviewers</button>', 'request-reviewers'],
    ['<button>Request reviewers</button>', 'request-reviewers'],
    ['<button aria-label="Re-request review from octocat">↻</button>', 're-request-review'],
  ])('matches %s', (html, id) => {
    expect(clickOn(html).control?.id).toBe(id)
  })

  it('resolves a click on an icon inside the button to the button', () => {
    // composedPath, not event.target — otherwise clicking the label misses.
    const { control } = clickOn('<button>Ready for review<span data-click>▸</span></button>')
    expect(control?.id).toBe('ready-for-review')
    expect(control?.element.tagName).toBe('BUTTON')
  })

  it('tolerates a trailing reviewer count', () => {
    expect(clickOn('<button>Reviewers 2</button>').control?.id).toBe('request-reviewers')
  })

  it('ignores non-interactive elements that happen to read "Reviewers"', () => {
    expect(clickOn('<h3>Reviewers</h3>').control).toBeNull()
  })

  it('ignores unrelated buttons', () => {
    expect(clickOn('<button>Merge when ready</button>').control).toBeNull()
    expect(clickOn('<button>Close pull request</button>').control).toBeNull()
  })

  it('never fires on our own shadow hosts', () => {
    const ours = document.createElement('div')
    ours.attachShadow({ mode: 'open' })
    const button = document.createElement('button')
    button.textContent = 'Ready for review'
    ours.shadowRoot!.append(button)
    document.body.append(ours)

    let control: ReturnType<typeof findGuardedControl> = null
    document.addEventListener('click', (e) => (control = findGuardedControl(e, [ours])), {
      capture: true,
      once: true,
    })
    button.click()
    expect(control).toBeNull()
  })
})

describe('installReviewGuard', () => {
  function setup(over: { summary?: PendingSummary | null; options?: Options; proceed?: boolean }) {
    const button = document.createElement('button')
    button.textContent = 'Ready for review'
    const clicked = vi.fn()
    button.addEventListener('click', clicked)
    document.body.append(button)

    const confirm = vi.fn().mockResolvedValue(over.proceed ?? false)
    const uninstall = installReviewGuard({
      getSummary: () => (over.summary === undefined ? aiPending() : over.summary),
      getOptions: () => over.options ?? opts(),
      getOurHosts: () => [],
      confirm,
    })
    return { button, clicked, confirm, uninstall }
  }

  it("swallows the click and asks first", () => {
    const { button, clicked, confirm, uninstall } = setup({})
    button.click()

    expect(confirm).toHaveBeenCalledOnce()
    // GitHub's own handler must not have run.
    expect(clicked).not.toHaveBeenCalled()
    uninstall()
  })

  it('lets the action through after the user chooses to proceed', async () => {
    const { button, clicked, uninstall } = setup({ proceed: true })
    button.click()
    await vi.waitFor(() => expect(clicked).toHaveBeenCalledOnce())
    uninstall()
  })

  it('does not let a second click through on the same bypass', async () => {
    // The bypass is single-use, so a later click is guarded again.
    const { button, clicked, confirm, uninstall } = setup({ proceed: true })
    button.click()
    await vi.waitFor(() => expect(clicked).toHaveBeenCalledOnce())

    button.click()
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(clicked).toHaveBeenCalledOnce()
    uninstall()
  })

  it('leaves the click alone when nothing is outstanding', () => {
    const { button, clicked, confirm, uninstall } = setup({ summary: summary() })
    button.click()
    expect(confirm).not.toHaveBeenCalled()
    expect(clicked).toHaveBeenCalledOnce()
    uninstall()
  })

  it('leaves the click alone when the page could not be read', () => {
    const { button, clicked, confirm, uninstall } = setup({
      summary: { status: 'unknown', reason: 'no merge box in document' },
    })
    button.click()
    expect(confirm).not.toHaveBeenCalled()
    expect(clicked).toHaveBeenCalledOnce()
    uninstall()
  })

  it('stops intercepting once uninstalled', () => {
    const { button, clicked, confirm, uninstall } = setup({})
    uninstall()
    button.click()
    expect(confirm).not.toHaveBeenCalled()
    expect(clicked).toHaveBeenCalledOnce()
  })
})

describe('real merge box labels', () => {
  // Every interactive label observed in a live merge box capture. None of these
  // request a review, so none may be intercepted — a false positive here means
  // blocking someone from updating their branch or merging.
  const REAL_LABELS = [
    'Merge when ready',
    'Update branch',
    'Update branch options',
    'Changes approved',
    'Collapse checks',
    'Expand 1 approval group',
    'Collapse 2 pending checks group',
    'Collapse 6 in progress checks group',
    'Checks settings',
    'More actions',
    'Review required',
    // From a real draft PR's full label dump.
    'Expand 2 pending reviews group',
    'Awaiting requested review from acme/platform-reviewers',
    'Awaiting requested review from acme/payments',
    'Expand checks',
    'Close pull request',
    'Resolve conversation',
    'Hide environments',
    'Show environments',
    'Assignees',
    'Labels',
    'Projects',
    'Milestone',
    'Close menu',
    'Unsubscribe',
    'Lock conversation',
    'Suggest changes',
    'Add files',
    'Comment',
    'Update comment',
    'Show comment',
    'Hide comment',
    'Quote reply',
    'Manage cookies',
  ]

  // The two that MUST match, both verbatim from that same dump. If GitHub
  // renames either, the guard silently stops protecting anything — so these are
  // the canaries.
  it.each(['Ready for review', 'Reviewers'])('intercepts the real label %s', (label) => {
    const button = document.createElement('button')
    button.textContent = label
    document.body.append(button)
    expect(captureControl(button)).not.toBeNull()
  })

  it.each(REAL_LABELS)('does not intercept %s', (label) => {
    const button = document.createElement('button')
    button.textContent = label
    document.body.append(button)
    expect(captureControl(button)).toBeNull()
  })

  it('still intercepts a review request rendered the way GitHub renders buttons', () => {
    // GitHub wraps the label in nested spans and adds a trailing visual.
    const button = document.createElement('button')
    button.setAttribute('data-component', 'Button')
    button.type = 'button'
    const content = document.createElement('span')
    content.setAttribute('data-component', 'buttonContent')
    const text = document.createElement('span')
    text.setAttribute('data-component', 'text')
    text.textContent = 'Ready for review'
    const visual = document.createElement('span')
    visual.setAttribute('data-component', 'trailingVisual')
    content.append(text, visual)
    button.append(content)
    document.body.append(button)
    expect(captureControl(text)?.id).toBe('ready-for-review')
  })
})
