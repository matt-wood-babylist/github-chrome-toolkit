import { MAX_CUSTOM_ACTIONS, MAX_LABEL_LENGTH, validateCustomAction } from '../content/session-link'
import type { CustomAction } from './types'

/**
 * The custom-action editor, shared by the bar's popover and the toolbar dropdown.
 *
 * Only the DOM lives here. Validation is `validateCustomAction`, the same function
 * the options page and the render path use, and persistence is the caller's `save`
 * — the popover is inside a content script and the dropdown is an extension page,
 * so they reach storage by different routes and neither should be baked in.
 *
 * Styling is likewise the caller's, but from one stylesheet: `ACTION_EDITOR_CSS`
 * is exported so the popover can fold it into its shadow root and the dropdown can
 * inject it into its page, without either restating the rules.
 */
export type ActionEditor = {
  /** Append this where the editor should appear. */
  root: HTMLElement
  /** Re-seed from storage. Ignored while the user is mid-edit on that row. */
  setActions(actions: readonly CustomAction[]): void
}

export function createActionEditor(save: (actions: CustomAction[]) => void | Promise<void>): ActionEditor {
  let actions: CustomAction[] = []

  const root = document.createElement('div')
  root.className = 'ae'

  const list = document.createElement('div')
  list.className = 'ae-list'

  const error = document.createElement('p')
  error.className = 'ae-error'
  error.setAttribute('role', 'alert')

  const hint = document.createElement('p')
  hint.className = 'ae-hint'
  hint.textContent = 'Built-in actions can’t be changed.'

  root.append(list, error, hint)

  function commit(next: CustomAction[]): void {
    actions = next
    void save(next)
    draw()
  }

  /**
   * One row. Both fields commit on `change` — blur or Enter — rather than on every
   * keystroke: validating mid-word would flash an error at someone who has typed
   * the first letter of a perfectly good skill name.
   */
  function row(action: CustomAction, index: number): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'ae-row'

    const label = document.createElement('input')
    label.className = 'ae-label'
    label.type = 'text'
    label.value = action.label
    label.maxLength = MAX_LABEL_LENGTH
    label.setAttribute('aria-label', 'Action display name')

    const command = document.createElement('input')
    command.className = 'ae-command'
    command.type = 'text'
    command.value = action.command
    command.spellcheck = false
    command.setAttribute('aria-label', 'Claude skill')

    const edit = (): void => {
      const result = validateCustomAction({ label: label.value, command: command.value })
      if (!result.ok) {
        // Leave the typed text in place so it can be corrected rather than retyped.
        error.textContent = result.message
        return
      }
      error.textContent = ''
      const next = [...actions]
      next[index] = { label: result.action.label, command: result.action.command }
      commit(next)
    }

    for (const input of [label, command]) {
      input.addEventListener('change', edit)
      input.addEventListener('keydown', (event) => {
        if ((event as KeyboardEvent).key === 'Enter') {
          event.preventDefault()
          edit()
        }
      })
    }

    const remove = document.createElement('button')
    remove.className = 'ae-remove'
    remove.type = 'button'
    remove.textContent = '✕'
    remove.title = `Remove ${action.label}`
    remove.setAttribute('aria-label', `Remove ${action.label}`)
    remove.addEventListener('click', () => {
      error.textContent = ''
      commit(actions.filter((_, i) => i !== index))
    })

    wrap.append(label, command, remove)
    return wrap
  }

  /**
   * The add row, built once and re-appended by every `draw()` rather than rebuilt.
   *
   * Half-typed input here is the user's work in progress, and a redraw is not always
   * their doing — a check finishing on the PR refreshes the banner, which re-seeds
   * this editor. Reusing the node means that text survives; recreating it would
   * silently clear the field of anyone who typed a name and then looked away.
   */
  function buildAddRow(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'ae-row ae-new'

    const label = document.createElement('input')
    label.className = 'ae-label'
    label.type = 'text'
    label.placeholder = 'Action Display Name'
    label.maxLength = MAX_LABEL_LENGTH
    label.setAttribute('aria-label', 'New action display name')

    const command = document.createElement('input')
    command.className = 'ae-command'
    command.type = 'text'
    command.placeholder = '/name-of-skill'
    command.spellcheck = false
    command.setAttribute('aria-label', 'New action skill')

    const add = document.createElement('button')
    add.className = 'ae-add'
    add.type = 'button'
    add.textContent = 'Add'

    const submit = (): void => {
      if (actions.length >= MAX_CUSTOM_ACTIONS) {
        error.textContent = `That’s the limit of ${MAX_CUSTOM_ACTIONS}. Remove one first.`
        return
      }
      const result = validateCustomAction({ label: label.value, command: command.value })
      if (!result.ok) {
        error.textContent = result.message
        return
      }
      const entry = { label: result.action.label, command: result.action.command }
      if (actions.some((a) => a.label === entry.label && a.command === entry.command)) {
        error.textContent = 'That action is already in the list.'
        return
      }
      error.textContent = ''
      label.value = ''
      command.value = ''
      commit([...actions, entry])
      // This row is the same node after the redraw, so it can be focused directly.
      label.focus()
    }

    add.addEventListener('click', submit)
    for (const input of [label, command]) {
      input.addEventListener('keydown', (event) => {
        if ((event as KeyboardEvent).key === 'Enter') {
          event.preventDefault()
          submit()
        }
      })
      input.addEventListener('input', () => (error.textContent = ''))
    }

    wrap.append(label, command, add)
    return wrap
  }

  const newRow = buildAddRow()

  function draw(): void {
    list.replaceChildren(...actions.map(row), newRow)
  }

  draw()

  return {
    root,
    setActions(next) {
      // Skip while a field here has focus: a storage event landing mid-keystroke
      // would otherwise replace the input the user is typing into.
      if (root.contains(document.activeElement)) return
      actions = next.map((a) => ({ label: a.label, command: a.command }))
      draw()
    },
  }
}

/** Shared so neither surface restates it. Colours come from the host via currentColor. */
export const ACTION_EDITOR_CSS = `
  .ae { display: flex; flex-direction: column; gap: 4px; }
  .ae-list { display: flex; flex-direction: column; gap: 4px; }
  .ae-row { display: flex; align-items: center; gap: 4px; }
  .ae-row input {
    flex: 1 1 0;
    min-width: 0;
    box-sizing: border-box;
    padding: 4px 6px;
    border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
    border-radius: 4px;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 12px;
  }
  .ae-row input:focus-visible { outline: 2px solid currentColor; outline-offset: -1px; }
  .ae-remove, .ae-add {
    flex: 0 0 auto;
    padding: 4px 7px;
    border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
    border-radius: 4px;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 12px;
    line-height: 1.2;
    cursor: pointer;
  }
  .ae-remove:hover, .ae-add:hover { background: color-mix(in srgb, currentColor 12%, transparent); }
  .ae-error { margin: 0; font-size: 11px; color: #cf222e; min-height: 1em; }
  .ae-hint { margin: 0; font-size: 11px; opacity: 0.6; }
  @media (prefers-color-scheme: dark) { .ae-error { color: #ff8182; } }
`
