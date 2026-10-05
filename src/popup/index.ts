import { sessionActions } from '../content/session-link'
import { ACTION_EDITOR_CSS, createActionEditor } from '../shared/action-editor'
import { ACTION_LINK_CSS, renderActionLink } from '../shared/action-link'
import { loadOptions, saveOptions } from '../shared/options-store'
import type { CustomAction, Options } from '../shared/types'
import { popupState } from './model'

/**
 * Toolbar popup. All the decisions live in `popupState`; this is the DOM.
 *
 * The actions are plain anchors to `claude://…`, exactly as in the banner, so
 * clicking one carries a real user gesture into Chrome's external-protocol
 * handler. Building them here rather than relaying through the content script is
 * deliberate: a message would arrive in the page without that gesture, and it
 * would also make the popup useless on a PR tab loaded before the extension.
 */
const refEl = must('ref')
const actionsEl = must('actions')
const emptyEl = must('empty')
const editorEl = must('editor')
const editToggle = must<HTMLButtonElement>('editToggle')

let options: Options | null = null
let tabUrl: string | undefined
/** Explicit, because `HTMLElement.hidden` is typed `boolean | "until-found"`. */
let editing = false

// The link layout and the editor's styles come from the shared modules rather than
// this page's <style>, so the popup and the bar's popover cannot drift apart.
const sharedStyle = document.createElement('style')
sharedStyle.textContent = ACTION_LINK_CSS + ACTION_EDITOR_CSS
document.head.append(sharedStyle)

const editor = createActionEditor(async (customActions: CustomAction[]) => {
  if (!options) return
  options = { ...options, customActions }
  await saveOptions(options)
  // Repaint the link list underneath, so closing the editor shows the new set.
  renderLinks()
})
editorEl.append(editor.root)

editToggle.addEventListener('click', () => setEditing(!editing))

document.getElementById('settings')?.addEventListener('click', (event) => {
  event.preventDefault()
  chrome.runtime.openOptionsPage()
})

void init()

async function init(): Promise<void> {
  // `tab.url` is present because of the github.com host permission; no `tabs`
  // permission needed, and any tab we lack permission for simply reports no URL.
  const [tab, loaded] = await Promise.all([
    chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => tabs[0]),
    loadOptions(),
  ])
  options = loaded
  tabUrl = tab?.url
  editor.setActions(loaded.customActions)
  renderLinks()
}

/**
 * Fill in the link list. Visibility is deliberately left to `applyVisibility`:
 * saving from the editor calls this, and having it decide for itself is what used
 * to make the PR ref reappear over an open editor.
 */
function renderLinks(): void {
  const state = popupState(tabUrl, sessionActions(options?.customActions ?? []))

  actionsEl.replaceChildren()
  refEl.textContent = state.kind === 'empty' ? '' : state.ref
  // Editing still works off a PR — the list is configuration, not context — so the
  // reason is kept even while the editor covers it.
  emptyEl.textContent = state.kind === 'empty' ? state.reason : ''

  if (state.kind === 'actions') {
    for (const link of state.links) {
      const a = document.createElement('a')
      a.className = 'action'
      renderActionLink(a, link.label, link.command)
      a.title = link.title
      a.href = link.url
      actionsEl.append(a)
    }
  }

  applyVisibility()
}

/** Editing replaces the list rather than sitting beside it: the popup is 250px. */
function setEditing(next: boolean): void {
  editing = next
  editToggle.textContent = next ? 'Done' : 'Edit actions'
  applyVisibility()
  if (next) editorEl.querySelector<HTMLInputElement>('.ae-label')?.focus()
}

/**
 * The single place any of these four get shown or hidden.
 *
 * Both the edit toggle and a save-driven re-render want a say in what is on screen,
 * and they arrive in either order, so neither may set `hidden` itself.
 */
function applyVisibility(): void {
  editorEl.hidden = !editing
  actionsEl.hidden = editing
  refEl.hidden = editing || !refEl.textContent
  emptyEl.hidden = editing || !emptyEl.textContent
}

function must<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id)
  if (!el) throw new Error(`missing #${id} in popup.html`)
  return el as T
}
