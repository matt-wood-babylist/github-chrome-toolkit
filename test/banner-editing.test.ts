import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureActionEditing, hideBanner, showBanner } from '../src/content/banner'
import { SESSION_ACTIONS, sessionActions } from '../src/content/session-link'
import type { CustomAction, OkSummary } from '../src/shared/types'

/**
 * Edit mode inside the bar's Actions popover.
 *
 * Kept out of banner.test.ts on purpose: `configureActionEditing` writes
 * module-level state with no way to unset it, and vitest gives each test file its
 * own module registry. Sharing a file would mean every unrelated popover test ran
 * with an edit footer bolted on.
 */
const HOST_ID = 'pending-checks-banner-host'
const PR = { owner: 'acme', repo: 'web', number: 1234, tab: 'conversation' } as const

const SUMMARY: OkSummary = {
  status: 'ok',
  pending: 1,
  pendingAiReviews: 1,
  pendingChecks: 0,
  pendingOtherReviews: 0,
  unattributedReviews: 0,
  items: [{ name: 'CodeRabbit', via: 'external', isApp: true, appId: '347564', kind: 'ai_review' }],
  groups: [],
  unresolvedThreads: 0,
  unresolvedBotThreads: 0,
  botThreadAuthors: [],
  threadsScanned: true,
}

type Save = (actions: CustomAction[]) => void
let save: ReturnType<typeof vi.fn<Save>>

function shadow(): ShadowRoot {
  const root = document.getElementById(HOST_ID)?.shadowRoot
  if (!root) throw new Error('banner is not mounted')
  return root
}

const popover = () => shadow().querySelector('.popover') as HTMLElement
const trigger = () => shadow().querySelector('.trigger') as HTMLButtonElement
const editToggle = () => popover().querySelector('.edit-toggle') as HTMLButtonElement | null
const links = () => Array.from(popover().querySelectorAll('a.action'))
/** Each link renders its name and its command as separate spans. */
const linkLabels = () =>
  Array.from(popover().querySelectorAll('a.action .action-label')).map((el) => el.textContent)
const hasEditor = () => popover().querySelector('.ae') !== null

/** Open the popover and enter edit mode, the way a click sequence would. */
function openEditor(custom: readonly CustomAction[] = []): void {
  show(custom)
  trigger().click()
  editToggle()?.click()
}

function show(custom: readonly CustomAction[] = []): void {
  showBanner(SUMMARY, PR, sessionActions(custom), custom)
}

beforeEach(() => {
  save = vi.fn<Save>()
  configureActionEditing(save)
})

afterEach(() => {
  hideBanner()
})

describe('the edit affordance', () => {
  it('offers an edit footer once editing is configured', () => {
    show()
    trigger().click()
    expect(editToggle()?.textContent).toBe('Edit actions')
  })

  it('swaps the link list for the editor, rather than showing both', () => {
    show()
    trigger().click()
    expect(links().length).toBeGreaterThan(0)

    editToggle()!.click()
    expect(hasEditor()).toBe(true)
    expect(links()).toHaveLength(0)
    expect(editToggle()?.textContent).toBe('Done')
  })

  it('restores the links on Done, without closing the popover', () => {
    openEditor()
    editToggle()!.click()

    expect(hasEditor()).toBe(false)
    expect(links()).toHaveLength(SESSION_ACTIONS.length)
    expect(popover().hidden).toBe(false)
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
  })

  it('seeds the editor from the stored list', () => {
    openEditor([{ label: 'Triage', command: '/triage' }])

    const values = Array.from(popover().querySelectorAll<HTMLInputElement>('.ae-label')).map(
      (input) => input.value,
    )
    expect(values).toContain('Triage')
  })
})

describe('saving from the popover', () => {
  it('hands the new list to the configured save function', () => {
    openEditor()
    const row = popover().querySelector('.ae-new') as HTMLElement
    ;(row.querySelector('.ae-label') as HTMLInputElement).value = 'Triage'
    ;(row.querySelector('.ae-command') as HTMLInputElement).value = '/triage'
    ;(row.querySelector('.ae-add') as HTMLButtonElement).click()

    expect(save).toHaveBeenCalledWith([{ label: 'Triage', command: '/triage' }])
  })

  it('survives the storage round-trip that its own save provokes', () => {
    // Saving writes to sync storage, which notifies the content script, which
    // re-renders the banner. Before the `editing` guard that re-render replaced
    // the open form with the link list mid-edit.
    openEditor()
    const label = popover().querySelector('.ae-new .ae-label') as HTMLInputElement
    label.value = 'Half-typed'

    show([{ label: 'Triage', command: '/triage' }])

    expect(hasEditor()).toBe(true)
    expect((popover().querySelector('.ae-new .ae-label') as HTMLInputElement).value).toBe('Half-typed')
  })

  it('shows the newly saved action once editing is finished', () => {
    openEditor()
    // The refresh that a real save triggers, then Done.
    show([{ label: 'Triage', command: '/triage' }])
    editToggle()!.click()

    expect(linkLabels()).toContain('Triage')
    expect(linkLabels()).toHaveLength(SESSION_ACTIONS.length + 1)
  })
})

describe('leaving the PR', () => {
  it('drops edit mode when the banner goes away, so it does not reopen editing', () => {
    openEditor()
    expect(hasEditor()).toBe(true)

    hideBanner()
    show()
    trigger().click()

    expect(hasEditor()).toBe(false)
    expect(editToggle()?.textContent).toBe('Edit actions')
  })
})
