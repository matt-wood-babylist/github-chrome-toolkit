import type { GuardReason, GuardedControl } from './review-guard'

const HOST_ID = 'pending-checks-confirm-host'

let host: HTMLElement | null = null
let resolveCurrent: ((proceed: boolean) => void) | null = null

/** The dialog's own shadow host, so the guard works even if the banner is not up. */
export function confirmHost(): Element | null {
  return host
}

/**
 * Ask before letting a review request through. Resolves true to proceed.
 *
 * Deliberately dismissible, and "Wait" is the default focus: the goal is to stop
 * an accident, not to lock anyone out of their own pull request.
 */
export function confirmReviewRequest(control: GuardedControl, reasons: GuardReason[]): Promise<boolean> {
  // A second interception while one is open (double click, stray handler) should
  // not orphan the first promise.
  close(false)

  return new Promise<boolean>((resolve) => {
    resolveCurrent = resolve
    host = document.createElement('div')
    host.id = HOST_ID
    const shadow = host.attachShadow({ mode: 'open' })

    const style = document.createElement('style')
    style.textContent = CSS_TEXT

    const backdrop = document.createElement('div')
    backdrop.className = 'backdrop'
    backdrop.addEventListener('pointerdown', (event) => {
      if (event.target === backdrop) close(false)
    })

    const dialog = document.createElement('div')
    dialog.className = 'dialog'
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    dialog.setAttribute('aria-labelledby', 'title')

    const title = document.createElement('h2')
    title.id = 'title'
    title.className = 'title'
    title.textContent = headline(reasons)

    const lead = document.createElement('p')
    lead.className = 'lead'
    lead.textContent = `You clicked ${control.what}.`

    const list = document.createElement('ul')
    list.className = 'reasons'
    for (const reason of reasons) list.append(reasonRow(reason))

    const actions = document.createElement('div')
    actions.className = 'actions'

    const wait = document.createElement('button')
    wait.type = 'button'
    wait.className = 'primary'
    wait.textContent = 'Wait'
    wait.addEventListener('click', () => close(false))

    const anyway = document.createElement('button')
    anyway.type = 'button'
    anyway.className = 'secondary'
    anyway.textContent = 'Request anyway'
    anyway.addEventListener('click', () => close(true))

    actions.append(wait, anyway)
    dialog.append(title, lead, list, actions)
    backdrop.append(dialog)
    shadow.append(style, backdrop)
    document.documentElement.append(host)

    document.addEventListener('keydown', onKeyDown, true)
    wait.focus()
  })
}

function close(proceed: boolean): void {
  document.removeEventListener('keydown', onKeyDown, true)
  host?.remove()
  host = null
  const resolve = resolveCurrent
  resolveCurrent = null
  resolve?.(proceed)
}

function onKeyDown(event: Event): void {
  const key = (event as KeyboardEvent).key
  if (key === 'Escape') {
    // Escape means "no". Stop it here so GitHub does not also act on it.
    event.preventDefault()
    event.stopPropagation()
    close(false)
    return
  }
  if (key !== 'Tab') return

  // Minimal focus trap: two buttons, so wrap between them and keep focus from
  // wandering into the page behind a modal dialog.
  const buttons = host?.shadowRoot?.querySelectorAll<HTMLButtonElement>('button')
  if (!buttons || buttons.length === 0) return
  const first = buttons[0]!
  const last = buttons[buttons.length - 1]!
  const active = host?.shadowRoot?.activeElement
  event.preventDefault()
  if ((event as KeyboardEvent).shiftKey) (active === first ? last : first).focus()
  else (active === last ? first : last).focus()
}

function headline(reasons: GuardReason[]): string {
  const hasAi = reasons.some((r) => r.kind === 'ai_reviews')
  const hasUnresolved = reasons.some((r) => r.kind === 'unresolved')
  if (hasAi && hasUnresolved) return 'Bot review is not finished'
  if (hasAi) return 'Bot reviews still running'
  if (hasUnresolved) return 'Unread bot feedback'
  return 'Checks still running'
}

function reasonRow(reason: GuardReason): HTMLElement {
  const li = document.createElement('li')
  const strong = document.createElement('strong')
  strong.textContent = describe(reason)
  li.append(strong)

  if (reason.names.length > 0) {
    const names = document.createElement('span')
    names.className = 'names'
    // textContent only — these came out of scraped page HTML.
    names.textContent = ` ${reason.names.join(', ')}`
    li.append(names)
  }
  return li
}

function describe(reason: GuardReason): string {
  const n = reason.count
  switch (reason.kind) {
    case 'ai_reviews':
      return `${n} AI ${n === 1 ? 'reviewer is' : 'reviewers are'} still working:`
    case 'unresolved':
      return `${n} unresolved bot ${n === 1 ? 'comment' : 'comments'}:`
    case 'checks':
      return `${n} ${n === 1 ? 'check is' : 'checks are'} still running:`
    case 'unattributed':
      return `${n} requested ${n === 1 ? 'reviewer' : 'reviewers'} GitHub will not let us identify`
  }
}

const CSS_TEXT = `
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.5);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  }
  .dialog {
    max-width: 480px;
    margin: 16px;
    padding: 20px;
    border-radius: 10px;
    background: #fff;
    color: #1f2328;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
  }
  .title { margin: 0 0 6px; font-size: 16px; }
  .lead { margin: 0 0 12px; font-size: 13px; color: #59636e; }
  .reasons { margin: 0 0 18px; padding-left: 18px; font-size: 13px; line-height: 1.6; }
  .reasons .names { color: #59636e; }
  .actions { display: flex; gap: 8px; justify-content: flex-end; }
  button {
    font: inherit;
    font-size: 13px;
    padding: 6px 14px;
    border-radius: 6px;
    border: 1px solid rgba(0, 0, 0, 0.2);
    cursor: pointer;
  }
  button:focus-visible { outline: 2px solid #0969da; outline-offset: 2px; }
  .primary { background: #1f883d; border-color: #1f883d; color: #fff; font-weight: 600; }
  .secondary { background: #f6f8fa; color: #1f2328; }
  @media (prefers-color-scheme: dark) {
    .dialog { background: #161b22; color: #e6edf3; }
    .lead, .reasons .names { color: #9198a1; }
    .secondary { background: #21262d; color: #e6edf3; border-color: #30363d; }
  }
`
