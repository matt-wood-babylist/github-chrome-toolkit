import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACTION_EDITOR_CSS, createActionEditor, type ActionEditor } from '../src/shared/action-editor'
import { MAX_CUSTOM_ACTIONS, MAX_LABEL_LENGTH } from '../src/content/session-link'
import type { CustomAction } from '../src/shared/types'

/**
 * The editor is shared by the bar's popover and the toolbar dropdown, so every
 * behaviour here is behaviour both surfaces get. It is driven through real DOM
 * events rather than by calling internals, because the parts most likely to break
 * — commit-on-change, the focus guard — only exist as event wiring.
 */
type Save = (actions: CustomAction[]) => void
let save: ReturnType<typeof vi.fn<Save>>
let editor: ActionEditor

beforeEach(() => {
  save = vi.fn<Save>()
  editor = createActionEditor(save)
  // Attached, because focus() is a no-op on a detached tree and the focus guard
  // is one of the things under test.
  document.body.append(editor.root)
})

afterEach(() => {
  editor.root.remove()
})

const errorText = () => editor.root.querySelector('.ae-error')?.textContent ?? ''
const rows = (): Element[] => Array.from(editor.root.querySelectorAll('.ae-row:not(.ae-new)'))
const newRow = () => must('.ae-new')

/** Indexed access, but loud: a missing row should fail here, not two lines later. */
function row(index: number): Element {
  const found = rows()[index]
  if (!found) throw new Error(`no row ${index}; the editor has ${rows().length}`)
  return found
}
const fields = (scope: Element) => ({
  label: scope.querySelector('.ae-label') as HTMLInputElement,
  command: scope.querySelector('.ae-command') as HTMLInputElement,
})

function must(selector: string): HTMLElement {
  const el = editor.root.querySelector(selector)
  if (!el) throw new Error(`no ${selector} in the editor`)
  return el as HTMLElement
}

/** Type into an input the way a person does: value, then the commit event. */
function fill(input: HTMLInputElement, value: string): void {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function add(label: string, command: string): void {
  const row = newRow()
  fill(fields(row).label, label)
  fill(fields(row).command, command)
  ;(row.querySelector('.ae-add') as HTMLButtonElement).click()
}

const stored = (): CustomAction[] => save.mock.calls.at(-1)?.[0] ?? []

describe('adding', () => {
  it('saves a valid action and shows it as a row', () => {
    add('Draft release notes', '/release-notes')

    expect(stored()).toEqual([{ label: 'Draft release notes', command: '/release-notes' }])
    expect(rows()).toHaveLength(1)
    expect(fields(row(0)).label.value).toBe('Draft release notes')
  })

  it('supplies the leading slash, so typing the bare skill name works', () => {
    add('Triage', 'triage-flakes')
    expect(stored()).toEqual([{ label: 'Triage', command: '/triage-flakes' }])
  })

  it('clears the add row and leaves focus there, ready for the next one', () => {
    add('Triage', '/triage')

    const row = newRow()
    expect(fields(row).label.value).toBe('')
    expect(fields(row).command.value).toBe('')
    expect(document.activeElement).toBe(fields(row).label)
  })

  it('commits on Enter from either field', () => {
    const row = newRow()
    fill(fields(row).label, 'Triage')
    fill(fields(row).command, '/triage')
    fields(row).command.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(stored()).toHaveLength(1)
  })
})

describe('rejecting', () => {
  it('explains a bad skill and saves nothing', () => {
    add('Deploy', '/not a skill')

    expect(save).not.toHaveBeenCalled()
    expect(errorText()).toMatch(/letters, digits/)
  })

  it('keeps the typed text so it can be corrected rather than retyped', () => {
    add('Deploy', '/not a skill')
    expect(fields(newRow()).command.value).toBe('/not a skill')
  })

  it('needs both a name and a skill', () => {
    add('', '/triage')
    expect(errorText()).toMatch(/display name/)

    add('Triage', '')
    expect(errorText()).toMatch(/skill/)
    expect(save).not.toHaveBeenCalled()
  })

  it('refuses a duplicate rather than listing it twice', () => {
    add('Triage', '/triage')
    add('Triage', '/triage')

    expect(stored()).toHaveLength(1)
    expect(errorText()).toMatch(/already in the list/)
  })

  it('stops at the cap and says so', () => {
    editor.setActions(
      Array.from({ length: MAX_CUSTOM_ACTIONS }, (_, i) => ({ label: `A${i}`, command: `/a${i}` })),
    )
    add('One more', '/one-more')

    expect(save).not.toHaveBeenCalled()
    expect(errorText()).toMatch(new RegExp(`limit of ${MAX_CUSTOM_ACTIONS}`))
  })

  it('caps the display name in the field itself, not just on submit', () => {
    expect(fields(newRow()).label.maxLength).toBe(MAX_LABEL_LENGTH)
  })

  it('clears a stale error as soon as the user types again', () => {
    add('Deploy', '/not a skill')
    expect(errorText()).not.toBe('')

    fill(fields(newRow()).command, '/deploy')
    expect(errorText()).toBe('')
  })
})

describe('editing an existing row', () => {
  beforeEach(() => {
    editor.setActions([
      { label: 'Triage', command: '/triage' },
      { label: 'Notes', command: '/notes' },
    ])
  })

  it('commits a change on blur, not on every keystroke', () => {
    const { label } = fields(row(0))
    label.value = 'Triage flakes'
    label.dispatchEvent(new Event('input', { bubbles: true }))
    expect(save).not.toHaveBeenCalled()

    label.dispatchEvent(new Event('change', { bubbles: true }))
    expect(stored()).toEqual([
      { label: 'Triage flakes', command: '/triage' },
      { label: 'Notes', command: '/notes' },
    ])
  })

  it('edits the row it was told to, not the first one', () => {
    const { command } = fields(row(1))
    command.value = '/release-notes'
    command.dispatchEvent(new Event('change', { bubbles: true }))

    expect(stored()[1]).toEqual({ label: 'Notes', command: '/release-notes' })
    expect(stored()[0]).toEqual({ label: 'Triage', command: '/triage' })
  })

  it('leaves the stored list alone when the edit is invalid', () => {
    const { command } = fields(row(0))
    command.value = '/nope nope'
    command.dispatchEvent(new Event('change', { bubbles: true }))

    expect(save).not.toHaveBeenCalled()
    expect(errorText()).toMatch(/letters, digits/)
  })

  it('removes the row the button belongs to', () => {
    ;(row(0).querySelector('.ae-remove') as HTMLButtonElement).click()

    expect(stored()).toEqual([{ label: 'Notes', command: '/notes' }])
    expect(rows()).toHaveLength(1)
  })

  it('names the action in the remove button, so it is not an anonymous ✕', () => {
    const remove = row(0).querySelector('.ae-remove') as HTMLButtonElement
    expect(remove.getAttribute('aria-label')).toBe('Remove Triage')
  })
})

describe('re-seeding from storage', () => {
  it('adopts the new list when nothing here has focus', () => {
    editor.setActions([{ label: 'Triage', command: '/triage' }])
    expect(rows()).toHaveLength(1)

    editor.setActions([])
    expect(rows()).toHaveLength(0)
  })

  it('keeps half-typed new-action text through a refresh nobody asked for', () => {
    // A check finishing on the PR re-seeds this editor. The focus guard does not
    // help here: the user may have typed a name and then looked away, so focus is
    // elsewhere while their text is still on screen and still wanted.
    fill(fields(newRow()).label, 'Draft release')

    editor.setActions([{ label: 'Triage', command: '/triage' }])

    expect(fields(newRow()).label.value).toBe('Draft release')
    expect(rows()).toHaveLength(1)
  })

  it('does not yank the field out from under someone mid-edit', () => {
    editor.setActions([{ label: 'Triage', command: '/triage' }])
    const { label } = fields(row(0))
    label.focus()
    label.value = 'Triage fl'

    // What a save from the *other* surface looks like arriving over storage.
    editor.setActions([{ label: 'Something else', command: '/other' }])

    expect(fields(row(0)).label.value).toBe('Triage fl')
    expect(document.activeElement).toBe(label)
  })

  it('copies the entries, so the caller mutating theirs afterwards changes nothing', () => {
    // The content script hands in `options.customActions` — a live object it keeps
    // and replaces on every storage event. If the editor aliased it, a mutation
    // over there would silently rewrite what the next save here persists.
    const first: CustomAction = { label: 'Triage', command: '/triage' }
    const source: CustomAction[] = [first, { label: 'Notes', command: '/notes' }]
    editor.setActions(source)

    first.label = 'Mutated'
    source.push({ label: 'Sneaked in', command: '/sneak' })
    ;(row(1).querySelector('.ae-remove') as HTMLButtonElement).click()

    expect(stored()).toEqual([{ label: 'Triage', command: '/triage' }])
  })
})

describe('the stylesheet', () => {
  it('inherits its colours, so each host supplies its own', () => {
    // The bar's popover and the toolbar dropdown have different backgrounds. Any
    // hard-coded neutral here would look wrong in one of them.
    expect(ACTION_EDITOR_CSS).toMatch(/currentColor/)
    expect(ACTION_EDITOR_CSS).not.toMatch(/background:\s*#(?!.*prefers)/)
  })
})
