import type { PrContext } from '../detect/pr-context'
import { ACTION_EDITOR_CSS, createActionEditor, type ActionEditor } from '../shared/action-editor'
import { ACTION_LINK_CSS, renderActionLink } from '../shared/action-link'
import type { CustomAction, OkSummary, PendingItem } from '../shared/types'
import type { SessionAction } from './session-link'
import { SESSION_ACTIONS, resolveFolder, sessionUrl } from './session-link'

const HOST_ID = 'pending-checks-banner-host'
const OFFSET_ID = 'pending-checks-banner-offset'
const ACTIVE_CLASS = 'pending-checks-banner-active'
const DETAILS_ID = 'items'
const POPOVER_ID = 'session-actions'
const HEIGHT_PX = 40

let host: HTMLElement | null = null
let shadow: ShadowRoot | null = null
/**
 * The bar is a plain wrapper, not the toggle.
 *
 * It used to be the <button> itself, which was simpler — but a button cannot
 * contain another button, and the bar now holds two: the expand toggle and the
 * popover trigger. The toggle still takes all the space the trigger doesn't, so
 * "click anywhere on the bar to expand" holds everywhere except the trigger, and
 * it remains a real <button> rather than a div with a click handler.
 */
let bar: HTMLElement | null = null
let toggle: HTMLButtonElement | null = null
let trigger: HTMLButtonElement | null = null
let popover: HTMLElement | null = null
let label: HTMLElement | null = null
let details: HTMLElement | null = null
let reassertObserver: MutationObserver | null = null

/**
 * Which overlay is open, as one value rather than two booleans.
 *
 * Both grow upward out of the same 40px bar, so showing them at once would stack
 * two panels over each other. Making it a single piece of state means they cannot
 * both be open — that is structural, not something each call site has to
 * remember. It also avoids reading state back off `.hidden`, whose DOM type is
 * `boolean | "until-found"` and so is not a clean boolean to negate.
 */
type Overlay = 'none' | 'details' | 'actions'
let open: Overlay = 'none'

/**
 * Editing is a mode of the popover, not a separate overlay: the links and the
 * editor occupy the same panel and never show together.
 */
let editing = false
let editor: ActionEditor | null = null
let editToggle: HTMLButtonElement | null = null
let saveActions: ((actions: CustomAction[]) => void | Promise<void>) | null = null
/** Latest custom list seen, so entering edit mode seeds from current storage. */
let latestCustom: readonly CustomAction[] = []

/**
 * Wire up editing. Called once at startup; until it is, the popover shows no edit
 * affordance at all, which is also what keeps the banner usable in tests and in
 * the dev harness without a storage stub.
 */
export function configureActionEditing(save: (actions: CustomAction[]) => void | Promise<void>): void {
  saveActions = save
}

/**
 * Show (or update) the banner.
 *
 * Anchored to the BOTTOM of the viewport. The top is GitHub's — a fixed bar up
 * there covers the global navbar and the sticky PR sub-header, both of which the
 * user needs while reviewing.
 *
 * The host element is a child of <html>, not <body>: GitHub's Turbo navigation
 * replaces body content wholesale and would take a body-mounted banner with it.
 * Everything visual lives in a shadow root so GitHub's stylesheet cannot reach
 * in and our styles cannot leak out.
 */
export function showBanner(
  summary: OkSummary,
  ctx?: PrContext | null,
  actions: readonly SessionAction[] = SESSION_ACTIONS,
  custom: readonly CustomAction[] = [],
): void {
  if (!host) mount()
  if (!label || !details) return

  latestCustom = custom
  label.textContent = bannerLabel(summary)
  renderDetails(details, summary)
  renderPopover(ctx ?? null, actions)
}

/**
 * Whether there is anything outstanding worth a banner.
 *
 * Unresolved conversations count even with nothing pending. A green PR with five
 * open threads is not ready to merge, and that is the moment the count is most
 * worth seeing — the banner used to disappear exactly then, leaving the review
 * guard as the only signal, and that fires when you request review rather than
 * while you are still working.
 *
 * `unresolvedThreads` is 0 whenever the timeline could not be read, so a document
 * we never scanned cannot raise the banner on a number we have not earned.
 */
export function bannerShouldShow(summary: OkSummary): boolean {
  return summary.pending > 0 || summary.unresolvedThreads > 0
}

/**
 * Lead with bot reviews when there are any: a trailing lint job is harmless,
 * but a human reviewing before CodeRabbit reports is the mistake worth calling
 * out. Falls back to a plain total if nothing could be classified.
 */
export function bannerLabel(summary: OkSummary): string {
  const parts: string[] = []
  if (summary.pendingAiReviews > 0) parts.push(`${summary.pendingAiReviews} ${plural('BOT REVIEW', summary.pendingAiReviews)}`)
  if (summary.pendingChecks > 0) parts.push(`${summary.pendingChecks} ${plural('CHECK', summary.pendingChecks)}`)
  if (summary.pendingOtherReviews > 0) parts.push(`${summary.pendingOtherReviews} ${plural('REVIEW', summary.pendingOtherReviews)}`)
  // Something is pending but nothing could be classified — name the bare total
  // rather than falling through to the unresolved-only wording below.
  if (parts.length === 0 && summary.pending > 0) parts.push(String(summary.pending))

  const open = summary.unresolvedThreads

  // Nothing running, only discussion outstanding. "PENDING" would misdescribe it:
  // a check finishes on its own, a thread waits for somebody to act. This is the
  // green-but-not-ready state, which is the whole reason the banner shows here.
  if (parts.length === 0) {
    // `bannerShouldShow` keeps the zero case off screen; the fallback is here so
    // that calling this directly with an empty summary cannot produce the nonsense
    // label "0 UNRESOLVED CONVERSATIONS".
    return open > 0 ? `${open} UNRESOLVED ${plural('CONVERSATION', open)}` : `PENDING: ${summary.pending}`
  }

  // Alongside the pending counts otherwise. Never added to `summary.pending` — see
  // the note on the field. Omitted at zero, which also stops an unscanned timeline
  // (reported as 0) from claiming a clean page.
  if (open > 0) parts.push(`${open} UNRESOLVED`)
  return `PENDING: ${parts.join(' · ')}`
}

function plural(word: string, n: number): string {
  return n === 1 ? word : `${word}S`
}

/** The banner's shadow host, so the review guard never fires on our own UI. */
export function bannerHost(): Element | null {
  return host
}

export function hideBanner(): void {
  // Unconditional: the listeners are document-level, so they must come off even
  // if the banner was never fully mounted.
  removeDismissListeners()
  open = 'none'
  editing = false
  editor = null
  editToggle = null
  latestCtx = null
  latestActions = SESSION_ACTIONS

  reassertObserver?.disconnect()
  reassertObserver = null
  host?.remove()
  host = null
  shadow = null
  bar = null
  toggle = null
  trigger = null
  popover = null
  label = null
  details = null
  document.documentElement.classList.remove(ACTIVE_CLASS)
  document.getElementById(OFFSET_ID)?.remove()
}

function mount(): void {
  host = document.createElement('div')
  host.id = HOST_ID
  shadow = host.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = CSS_TEXT + ACTION_LINK_CSS + ACTION_EDITOR_CSS

  details = document.createElement('ul')
  details.className = 'details'
  details.id = DETAILS_ID
  details.hidden = true

  bar = document.createElement('div')
  bar.className = 'bar'

  toggle = document.createElement('button')
  toggle.className = 'toggle'
  toggle.type = 'button'
  toggle.setAttribute('aria-expanded', 'false')
  toggle.setAttribute('aria-controls', DETAILS_ID)
  toggle.addEventListener('click', () => setOpen(open === 'details' ? 'none' : 'details'))

  label = document.createElement('span')
  label.className = 'label'
  // The live region is the text itself, so the count is announced when it
  // changes without the button re-announcing its whole label.
  label.setAttribute('role', 'status')
  label.setAttribute('aria-live', 'polite')

  // A disclosure button, not a menu: `aria-expanded` + `aria-controls` describes
  // exactly what this does. `aria-haspopup` would promise menu keyboard
  // semantics — arrow keys, typeahead — that this does not implement, and the
  // popover holds plain links that Tab already walks correctly.
  trigger = document.createElement('button')
  trigger.className = 'trigger'
  trigger.type = 'button'
  trigger.textContent = 'Actions'
  trigger.setAttribute('aria-expanded', 'false')
  trigger.setAttribute('aria-controls', POPOVER_ID)
  trigger.hidden = true
  trigger.addEventListener('click', () => setOpen(open === 'actions' ? 'none' : 'actions'))

  popover = document.createElement('div')
  popover.className = 'popover'
  popover.id = POPOVER_ID
  popover.setAttribute('aria-label', 'Claude Code session actions')
  popover.hidden = true

  toggle.append(label)
  bar.append(toggle, trigger)
  // Details BEFORE the bar: the host is pinned to the bottom and grows upward,
  // so this is what makes the list expand up over the page instead of off the
  // bottom of the screen.
  //
  // The popover comes AFTER the bar, which looks wrong for something that renders
  // above it — but it is positioned absolutely, so DOM order costs nothing
  // visually and buys the correct tab order: Tab from the trigger moves forward
  // into the popover's links. Placing it before the bar would put its contents
  // behind the trigger in sequence, so Tab would walk away from the thing that
  // had just opened.
  shadow.append(style, details, bar, popover)
  document.documentElement.append(host)

  // Keep the bar from covering the last of the page content. A separate <style>
  // in the light DOM because it targets body, which the shadow root cannot reach.
  const offset = document.createElement('style')
  offset.id = OFFSET_ID
  offset.textContent = `html.${ACTIVE_CLASS} body { padding-bottom: ${HEIGHT_PX}px !important; }`
  document.head.append(offset)
  document.documentElement.classList.add(ACTIVE_CLASS)

  // Turbo can still remove our node during a full body swap; put it back.
  reassertObserver = new MutationObserver(() => {
    if (host && !host.isConnected) document.documentElement.append(host)
  })
  reassertObserver.observe(document.documentElement, { childList: true })
}

// ---------------------------------------------------------------------------
// Expand / collapse
// ---------------------------------------------------------------------------

function setOpen(next: Overlay): void {
  if (!toggle || !details || !trigger || !popover) return
  const was = open
  open = next

  details.hidden = next !== 'details'
  popover.hidden = next !== 'actions'
  toggle.setAttribute('aria-expanded', String(next === 'details'))
  trigger.setAttribute('aria-expanded', String(next === 'actions'))

  // Only listen while something is open. A permanently attached document-level
  // handler on every GitHub page would be rude, and this way there is nothing to
  // leak. Guarded on the transition rather than the new value, so swapping one
  // overlay for the other does not detach and reattach for no reason.
  if (next === 'none' && was !== 'none') removeDismissListeners()
  else if (next !== 'none' && was === 'none') addDismissListeners()
}

function addDismissListeners(): void {
  document.addEventListener('pointerdown', onOutsidePointerDown, true)
  document.addEventListener('keydown', onDismissKey, true)
}

function removeDismissListeners(): void {
  document.removeEventListener('pointerdown', onOutsidePointerDown, true)
  document.removeEventListener('keydown', onDismissKey, true)
}

/**
 * Collapse on any click that did not land on the banner.
 *
 * `composedPath()` rather than `host.contains(event.target)`: events originating
 * inside a shadow tree are retargeted to the host when seen from the document,
 * so naive containment checks get confusing fast. The composed path is the
 * honest answer to "did this start inside our tree", and it keeps links in the
 * expanded list working — they are inside the host, so they never collapse it.
 *
 * Capture phase, so GitHub stopping propagation somewhere cannot trap the panel
 * open.
 */
function onOutsidePointerDown(event: Event): void {
  if (host && !event.composedPath().includes(host)) setOpen('none')
}

function onDismissKey(event: Event): void {
  if ((event as KeyboardEvent).key === 'Escape') setOpen('none')
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderDetails(list: HTMLElement, summary: OkSummary): void {
  list.replaceChildren()

  const bots = summary.items.filter((item) => item.kind === 'ai_review')
  const checks = summary.items.filter((item) => item.kind === 'ci')

  // Bot reviews first — they are the reason to hold off on requesting review.
  if (bots.length > 0) list.append(sectionHeader('AI reviewers still working'), ...bots.map(row))
  if (checks.length > 0) list.append(sectionHeader('Checks still running'), ...checks.map(row))

  // Real cases, not defensive padding: GitHub renders no rows for a collapsed
  // group, so a count can have nothing behind it to name.
  const unnamed = summary.pending - summary.items.length - summary.pendingOtherReviews
  if (unnamed > 0) list.append(note(`${unnamed} more — GitHub has these collapsed, so they have no names here.`))
  // Never part of `pending`: an unresolved thread is not "running" and can sit
  // open for days. The review guard is where the bot subset has teeth.
  if (summary.unresolvedThreads > 0) {
    const who = summary.botThreadAuthors.join(', ')
    const bots = summary.unresolvedBotThreads
    // The bot subset is named inside the total rather than reported on its own,
    // so this and the "N UNRESOLVED" on the bar can never read as two unrelated
    // numbers that happen to disagree.
    const from = bots > 0 ? ` — ${bots} from ${who || 'a bot'}, worth reading before asking for review` : ''
    list.append(note(`${summary.unresolvedThreads} unresolved conversation(s)${from}.`))
  }
  if (summary.unattributedReviews > 0) {
    list.append(
      note(
        `${summary.unattributedReviews} requested reviewer(s) — GitHub collapsed the Reviews section, so bot and human cannot be told apart.`,
      ),
    )
  }
  if (list.children.length === 0) list.append(note('Nothing to name.'))
}

/**
 * The Actions popover: one link per session action, built-in and custom.
 *
 * Anchors, not buttons with click handlers. The whole job is navigating to a
 * `claude://` URL, and letting the browser do that keeps the protocol-handler
 * prompt, middle-click and keyboard activation working for free — a button would
 * mean reimplementing all of it around `location.href =`.
 *
 * Rebuilt on every update rather than diffed: it is a handful of links, and the
 * PR can change under us on a soft navigation.
 */
function renderPopover(ctx: PrContext | null, actions: readonly SessionAction[]): void {
  if (!popover || !trigger) return

  // Recorded before the edit-mode bail-out, not after: closing the editor repaints
  // from these, and the refresh that a save provokes is exactly when they change.
  // Capturing them only on a non-editing render would make Done restore the list as
  // it was before the save — without the action just added.
  latestCtx = ctx
  latestActions = actions

  // Saving from the editor writes to storage, storage notifies the content script,
  // and the content script refreshes — which lands back here. Rebuilding then would
  // destroy the form the user is still typing in, so edit mode owns the panel until
  // it is closed. The seed list is kept current underneath via `latestCustom`.
  if (editing) {
    editor?.setActions(latestCustom)
    return
  }

  popover.replaceChildren()

  if (!ctx) {
    // No PR context means no trustworthy URL to put in a prompt. Better to offer
    // nothing than a session pointed at the wrong pull request.
    hidePopover()
    return
  }

  const folder = resolveFolder(ctx)
  let links = 0
  for (const action of actions) {
    const url = sessionUrl(action, ctx, folder)
    if (!url) continue
    const link = document.createElement('a')
    link.className = 'action'
    renderActionLink(link, action.label, action.command)
    link.href = url
    link.title = action.title
    popover.append(link)
    links += 1
  }

  if (links === 0) {
    hidePopover()
    return
  }

  if (saveActions) popover.append(editFooter())
  trigger.hidden = false
}

/**
 * The "Edit actions" footer, and the button that closes edit mode again.
 *
 * Only rendered when `configureActionEditing` has supplied a save function, so the
 * dev harness and the tests get the plain popover unless they ask for more.
 */
function editFooter(): HTMLElement {
  const footer = document.createElement('div')
  footer.className = 'popover-footer'

  editToggle = document.createElement('button')
  editToggle.className = 'edit-toggle'
  editToggle.type = 'button'
  editToggle.textContent = editing ? 'Done' : 'Edit actions'
  editToggle.addEventListener('click', () => setEditing(!editing))

  footer.append(editToggle)
  return footer
}

function setEditing(next: boolean): void {
  if (!popover || !saveActions) return
  editing = next

  if (!next) {
    editor = null
    // Fall back out to the link list. The popover stays open; only its contents
    // change, so this is not a dismissal.
    renderPopover(latestCtx, latestActions)
    return
  }

  editor = createActionEditor(saveActions)
  editor.setActions(latestCustom)
  popover.replaceChildren(editor.root, editFooter())
}

/**
 * The last inputs `renderPopover` was given.
 *
 * Closing the editor has to restore the links and has no PR context or action list
 * of its own — both arrive as arguments to `renderPopover`. Keeping the values
 * rather than a closure over them means a refresh that lands *during* editing still
 * updates what Done will paint.
 */
let latestCtx: PrContext | null = null
let latestActions: readonly SessionAction[] = SESSION_ACTIONS

/**
 * Withdraw the trigger, and close the popover if it happened to be the thing on
 * screen — a soft navigation to a PR we cannot read must not leave an open panel
 * of links pointing at the previous one.
 */
function hidePopover(): void {
  if (trigger) trigger.hidden = true
  if (open === 'actions') setOpen('none')
}

function sectionHeader(text: string): HTMLElement {
  const li = document.createElement('li')
  li.className = 'group'
  li.textContent = text
  return li
}

function note(text: string): HTMLElement {
  const li = document.createElement('li')
  li.className = 'empty'
  li.textContent = text
  return li
}

function row(item: PendingItem): HTMLElement {
  const li = document.createElement('li')
  if (item.url) {
    const link = document.createElement('a')
    // textContent, never innerHTML: these strings came out of scraped HTML.
    link.textContent = item.name
    link.href = new URL(item.url, 'https://github.com').toString()
    li.append(link)
  } else {
    li.textContent = item.name
  }
  return li
}

const CSS_TEXT = `
  :host {
    position: fixed;
    /* Pinned to the bottom; height is auto so expanding the list grows upward. */
    inset: auto 0 0 0;
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  }
  /* Wrapper only. The toggle and the actions are its children because a
     <button> may not contain a <button> or an <a>. */
  .bar {
    display: flex;
    align-items: stretch;
    box-sizing: border-box;
    width: 100%;
    height: ${HEIGHT_PX}px;
    background: #bf8700;
    color: #fff;
    box-shadow: 0 -1px 4px rgba(0, 0, 0, 0.35);
  }
  /* Takes every pixel the actions leave, so "click the bar to expand" still
     holds for all of it except the actions. A real <button>, so it stays
     keyboard focusable and correctly announced. */
  .toggle {
    display: flex;
    flex: 1 1 auto;
    min-width: 0;
    align-items: center;
    justify-content: center;
    margin: 0;
    padding: 0;
    border: 0;
    appearance: none;
    -webkit-appearance: none;
    font: inherit;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  .toggle:hover { background: rgba(0, 0, 0, 0.12); }
  /* Inset offset so the focus ring is not clipped by the viewport edge. */
  .toggle:focus-visible { outline: 2px solid #fff; outline-offset: -5px; }
  .label {
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.08em;
    /* The bar can run out of room in a narrow window. The Actions button is
       fixed-width and the toggle absorbs the shortfall, so clip the status text
       rather than let the button overflow off-screen. */
    padding: 0 8px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  /* The Actions button, which opens the session-actions popover. */
  .trigger {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    margin: 0;
    padding: 0 14px;
    border: 0;
    border-left: 1px solid rgba(255, 255, 255, 0.35);
    appearance: none;
    -webkit-appearance: none;
    background: rgba(0, 0, 0, 0.16);
    color: #fff;
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.02em;
    white-space: nowrap;
    cursor: pointer;
  }
  .trigger[hidden] { display: none; }
  .trigger:hover { background: rgba(0, 0, 0, 0.3); }
  .trigger:focus-visible { outline: 2px solid #fff; outline-offset: -4px; }
  /* A caret that flips when open, so the button's state is visible and not only
     announced. Generated content, so it is never selectable or read as text. */
  .trigger::after {
    content: "";
    margin-left: 7px;
    border: 4px solid transparent;
    border-bottom-color: currentColor;
    border-top-width: 0;
  }
  .trigger[aria-expanded="false"]::after {
    border-top: 4px solid currentColor;
    border-bottom-width: 0;
  }
  /* Absolutely positioned, so its place in the DOM is free to be whatever the tab
     order needs. Sits directly on the bar at the right, where the trigger is. */
  .popover {
    position: absolute;
    right: 0;
    bottom: ${HEIGHT_PX}px;
    display: flex;
    flex-direction: column;
    /* Size to the widest row so labels stay on one line, but never past the
       viewport. Being a column flex container, the popover would otherwise resolve
       to min-width and wrap every row; and with only a min-width, a long custom
       label would push it off the left edge on a narrow window. The cap is what
       lets the label wrap as a fallback instead of overflowing. */
    width: max-content;
    min-width: 210px;
    max-width: calc(100vw - 16px);
    padding: 5px;
    box-sizing: border-box;
    background: #fff;
    border: 1px solid rgba(0, 0, 0, 0.18);
    border-bottom: 0;
    border-radius: 8px 8px 0 0;
    box-shadow: 0 -6px 20px rgba(0, 0, 0, 0.28);
  }
  .popover[hidden] { display: none; }
  .action {
    padding: 8px 10px;
    border-radius: 5px;
    /* Explicit, not inherited: these are real anchors, and the UA stylesheet's
       link colour beats an inherited value. Deferring to .popover keeps each
       scheme's foreground colour stated in exactly one place. */
    color: inherit;
    font-size: 13px;
    font-weight: 500;
    text-decoration: none;
    cursor: pointer;
  }
  .action:hover { background: rgba(0, 0, 0, 0.07); }
  .action:focus-visible { outline: 2px solid #0969da; outline-offset: -2px; }
  .popover-footer {
    display: flex;
    justify-content: flex-end;
    margin-top: 4px;
    padding-top: 5px;
    border-top: 1px solid color-mix(in srgb, currentColor 15%, transparent);
  }
  .edit-toggle {
    padding: 3px 6px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 11px;
    opacity: 0.7;
    cursor: pointer;
  }
  .edit-toggle:hover { opacity: 1; background: color-mix(in srgb, currentColor 10%, transparent); }
  /* The editor needs more room than the link list does. */
  .popover:has(.ae) { min-width: 320px; }
  .popover { color: #1f2328; }
  .details {
    margin: 0;
    padding: 8px 16px;
    max-height: 40vh;
    overflow-y: auto;
    list-style: none;
    background: #fff;
    color: #1f2328;
    border-top: 1px solid rgba(0, 0, 0, 0.15);
    font-size: 12px;
    line-height: 1.8;
  }
  .details a { color: #0969da; text-decoration: none; }
  .details a:hover { text-decoration: underline; }
  .details .empty { color: #59636e; font-style: italic; }
  .details .group {
    margin-top: 6px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #59636e;
  }
  .details .group:first-child { margin-top: 0; }
  @media (prefers-color-scheme: dark) {
    .bar { background: #9e6a03; }
    .details { background: #0d1117; color: #e6edf3; border-top-color: #30363d; }
    .details a { color: #4493f8; }
    .details .empty, .details .group { color: #9198a1; }
    /* The color declaration is load-bearing, not decoration: the action editor styles itself
       entirely from currentColor so that it suits both this popover and the toolbar
       dropdown. Setting only the background would leave every input border and label
       in the editor at the light-mode near-black, on a dark panel. */
    .popover { background: #161b22; color: #e6edf3; border-color: #30363d; }
    .action:hover { background: rgba(255, 255, 255, 0.09); }
    .action:focus-visible { outline-color: #4493f8; }
  }
  @media (prefers-reduced-motion: no-preference) {
    /* Pulse the status half only. Fading the Actions button in and out would
       read as "disabled, wait", the opposite of what it invites. */
    .toggle { animation: pulse 2.4s ease-in-out infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.82; } }
  }
`
