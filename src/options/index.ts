import { MAX_CUSTOM_ACTIONS, validateCustomAction } from '../content/session-link'
import { loadOptions, saveOptions, watchOptions } from '../shared/options-store'
import { DEFAULT_OPTIONS, type CustomAction, type Options } from '../shared/types'

const status = must<HTMLDivElement>('status')
const custom = {
  list: must<HTMLUListElement>('customList'),
  empty: must<HTMLParagraphElement>('customEmpty'),
  label: must<HTMLInputElement>('customLabel'),
  command: must<HTMLInputElement>('customCommand'),
  add: must<HTMLButtonElement>('customAdd'),
  error: must<HTMLParagraphElement>('customError'),
}

/**
 * The page's copy of the list, and the source of truth while it is open.
 *
 * Kept here rather than read back out of the rendered rows: the DOM would then be
 * both the display and the model, and every edit would need to parse its own
 * markup back into data.
 */
let customActions: CustomAction[] = []
const fields = {
  pendingRefreshSeconds: must<HTMLInputElement>('pendingRefreshSeconds'),
  includeOtherReviews: must<HTMLInputElement>('includeOtherReviews'),
  aiReviewers: must<HTMLInputElement>('aiReviewers'),
  guardReviewRequests: must<HTMLInputElement>('guardReviewRequests'),
  guardOnUnresolvedBotComments: must<HTMLInputElement>('guardOnUnresolvedBotComments'),
  guardOnAnyPending: must<HTMLInputElement>('guardOnAnyPending'),
  denyList: must<HTMLInputElement>('denyList'),
  debug: must<HTMLInputElement>('debug'),
}

void init()

async function init(): Promise<void> {
  const options = await loadOptions()
  fields.pendingRefreshSeconds.value = String(options.pendingRefreshSeconds)
  fields.includeOtherReviews.checked = options.includeOtherReviews
  fields.aiReviewers.value = options.aiReviewers.join(', ')
  fields.guardReviewRequests.checked = options.guardReviewRequests
  fields.guardOnUnresolvedBotComments.checked = options.guardOnUnresolvedBotComments
  fields.guardOnAnyPending.checked = options.guardOnAnyPending
  fields.denyList.value = options.denyList.join(', ')
  fields.debug.checked = options.debug
  customActions = options.customActions
  renderCustom()

  // The banner popover and the toolbar popup edit this list too. Without this, the
  // next checkbox change here would save the list as it stood when the page opened.
  watchOptions((next) => {
    customActions = next.customActions
    renderCustom()
  })

  for (const field of Object.values(fields)) {
    field.addEventListener('change', () => void persist())
  }

  custom.add.addEventListener('click', () => void addCustom())
  // Enter in either field adds, so the form behaves like a form without being one
  // — a real <form> inside the options page would try to navigate on submit.
  for (const input of [custom.label, custom.command]) {
    input.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter') {
        event.preventDefault()
        void addCustom()
      }
    })
    // Clear a stale complaint as soon as the user starts fixing it.
    input.addEventListener('input', () => (custom.error.textContent = ''))
  }
}

// ---------------------------------------------------------------------------
// Custom actions
// ---------------------------------------------------------------------------

async function addCustom(): Promise<void> {
  if (customActions.length >= MAX_CUSTOM_ACTIONS) {
    custom.error.textContent = `That's the limit of ${MAX_CUSTOM_ACTIONS}. Remove one first.`
    return
  }

  // Validated by the same function the banner and popup use on read, so the page
  // cannot accept something those two would then quietly drop.
  const result = validateCustomAction({ label: custom.label.value, command: custom.command.value })
  if (!result.ok) {
    custom.error.textContent = result.message
    return
  }

  const { label, command } = result.action
  if (customActions.some((entry) => entry.command === command && entry.label === label)) {
    custom.error.textContent = 'That action is already in the list.'
    return
  }

  customActions = [...customActions, { label, command }]
  custom.error.textContent = ''
  custom.label.value = ''
  custom.command.value = ''
  renderCustom()
  await persist()
  custom.label.focus()
}

async function removeCustom(index: number): Promise<void> {
  customActions = customActions.filter((_, i) => i !== index)
  custom.error.textContent = ''
  renderCustom()
  await persist()
}

function renderCustom(): void {
  custom.list.replaceChildren()
  custom.empty.hidden = customActions.length > 0

  for (const [index, action] of customActions.entries()) {
    const row = document.createElement('li')

    const name = document.createElement('span')
    name.className = 'name'
    // textContent, not innerHTML — this is typed-in text being echoed back.
    name.textContent = action.label

    const cmd = document.createElement('code')
    cmd.textContent = action.command

    const remove = document.createElement('button')
    remove.type = 'button'
    remove.textContent = 'Remove'
    remove.setAttribute('aria-label', `Remove ${action.label}`)
    remove.addEventListener('click', () => void removeCustom(index))

    row.append(name, cmd, remove)
    custom.list.append(row)
  }
}

async function persist(): Promise<void> {
  const options: Options = {
    pendingRefreshSeconds: clamp(fields.pendingRefreshSeconds.value, 10, 600, DEFAULT_OPTIONS.pendingRefreshSeconds),
    includeOtherReviews: fields.includeOtherReviews.checked,
    aiReviewers: csv(fields.aiReviewers.value),
    guardReviewRequests: fields.guardReviewRequests.checked,
    guardOnUnresolvedBotComments: fields.guardOnUnresolvedBotComments.checked,
    guardOnAnyPending: fields.guardOnAnyPending.checked,
    denyList: csv(fields.denyList.value),
    customActions,
    debug: fields.debug.checked,
  }

  // chrome.storage.sync rejects an item over 8KB, and it used to be impossible to
  // get near that with fixed fields. Now that the page stores a list the user
  // grows, a failed save has to be visible — silently keeping edits that were
  // never written is the worst version of this.
  try {
    await saveOptions(options)
  } catch (error) {
    status.textContent = ''
    custom.error.textContent =
      error instanceof Error ? `Could not save: ${error.message}` : 'Could not save your settings.'
    return
  }

  status.textContent = 'Saved.'
  setTimeout(() => (status.textContent = ''), 1500)
}

function csv(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function clamp(raw: string, min: number, max: number, fallback: number): number {
  // Number('') is 0, which would clamp to `min` instead of falling back.
  if (!raw.trim()) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

function must<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id)
  if (!el) throw new Error(`missing #${id} in options.html`)
  return el as T
}
