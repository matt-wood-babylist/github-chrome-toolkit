import type { PrContext } from '../detect/pr-context'
import { conversationUrl } from '../detect/pr-context'
import type { CustomAction } from '../shared/types'

/**
 * Deep links that open a Claude Code session in the Claude desktop app.
 *
 * `claude://code/new` is a real route in the desktop app's URL handler — it reads
 * `q` (or `prompt`), plus repeatable `folder` and `file` params, and opens a new
 * Claude Code session with the prompt in the composer. Verified by reading the
 * handler in Claude.app 1.24012.11; it is NOT a documented API, so treat a
 * silently-not-opening link as "this build changed" rather than "the user is
 * offline". The app also honours a `disableDeepLinks` setting, which turns all of
 * this off in managed environments.
 *
 * `claude://` rather than the `https://claude.ai/...` universal link: that one
 * degrades to the browser when the app is missing, which is right for a chat link
 * but wrong here — a Claude Code session has nowhere to go in a browser tab.
 */
const CODE_NEW = 'claude://code/new'

/**
 * The app truncates `q` at this many characters (`1024*16 - 2*1024` in its
 * source). Our prompts are two orders of magnitude shorter; the cap is enforced
 * here so that if someone later builds a longer prompt it fails a test rather
 * than being silently cut off mid-sentence.
 */
export const PROMPT_MAX = 1024 * 16 - 2 * 1024

/**
 * GitHub's own charset for owner and repo names.
 *
 * The PR path regex accepts `[^/]+`, which is wider than GitHub actually allows.
 * That is harmless for a URL — everything is percent-encoded — but these strings
 * end up inside a prompt that a Claude Code session will act on, so they are
 * checked against the narrow charset before being interpolated. Anything odd
 * yields no link at all rather than a prompt with page-controlled text in it.
 */
const SAFE_SLUG = /^[A-Za-z0-9._-]+$/

/**
 * Dots are legal in GitHub names, so the charset above admits `..` and `.`.
 * Harmless in a URL, but `resolveFolder` is expected to build a local path out of
 * `ctx.repo`, and a slug of `..` in a path concatenation walks up a directory.
 * Rejected here so that stays impossible no matter how the path is assembled.
 */
const TRAVERSAL = /(^\.+$)|(\.\.)/

function safeSlug(slug: string): boolean {
  return SAFE_SLUG.test(slug) && !TRAVERSAL.test(slug)
}

export type SessionAction = {
  id: string
  label: string
  /** Slash command placed at the start of the prefilled prompt. */
  command: string
  /** Tooltip; also the accessible description. */
  title: string
}

/**
 * The built-in actions, listed in the bar's Actions popover and the toolbar popup.
 *
 * Unqualified slash commands (`/pr-review`, not `/pr-feedback:pr-review`) because
 * Claude Code resolves a bare skill name when it is unambiguous, and the short
 * form survives the plugin being renamed. If either stops resolving, qualify it
 * here — this is the only place the command string exists.
 *
 * These skills come from the `pr-feedback` and `fix-ci-tests` Claude Code plugins;
 * without them installed, the session opens but the command does not resolve.
 */
export const SESSION_ACTIONS: readonly SessionAction[] = [
  {
    id: 'review',
    label: 'Start PR review',
    command: '/pr-review',
    title: 'Open a Claude Code session to review this pull request',
  },
  {
    id: 'respond',
    label: 'Start PR response',
    command: '/pr-respond',
    title: 'Open a Claude Code session to respond to this pull request’s review feedback',
  },
  {
    id: 'fix-ci',
    label: 'Fix CI tests',
    command: '/fix-ci-tests',
    title: 'Open a Claude Code session to fix this branch’s failing CI',
  },
]

// ---------------------------------------------------------------------------
// User-defined actions
// ---------------------------------------------------------------------------

/** Longest display name accepted. Enough to be descriptive, short enough to fit a row. */
export const MAX_LABEL_LENGTH = 40

/**
 * How many custom actions may be stored.
 *
 * Not an arbitrary tidiness limit: `chrome.storage.sync` caps a single item at
 * 8KB, and blowing that makes `saveOptions` reject. Better to refuse the
 * thirteenth than to silently lose the lot.
 */
export const MAX_CUSTOM_ACTIONS = 12

/**
 * A slash command naming a Claude Code skill.
 *
 * The charset is wider than it first looks, and deliberately so — real skill
 * names include `pr-feedback:pr-review`, `Notion:tasks:build` and
 * `chrome-devtools-mcp:a11y-debugging`. So: mixed case, digits, hyphens,
 * underscores, and colons for plugin qualification, including more than one.
 * A naive `/^\/[a-z-]+$/` would reject most plugin skills.
 *
 * What it still excludes is the part that matters: whitespace and newlines. This
 * string is interpolated into a prompt an agent acts on, so a newline would let a
 * stray second instruction ride along on a line of its own.
 */
export const SKILL_COMMAND = /^\/[A-Za-z0-9][A-Za-z0-9_:-]*$/

export type CustomActionResult =
  | { ok: true; action: SessionAction }
  | { ok: false; message: string }

/**
 * Validate and normalise one user-entered action.
 *
 * Normalising rather than rejecting where it is unambiguous: the display name is
 * trimmed, and a command typed without its leading slash gets one. Being strict
 * about things the user cannot see the point of just makes the form annoying.
 *
 * `index` only feeds the generated id, which has to be unique because the popover
 * and the dropdown key their rows on it.
 */
export function validateCustomAction(
  raw: Partial<CustomAction> | undefined,
  index = 0,
): CustomActionResult {
  const label = (raw?.label ?? '').trim()
  const typed = (raw?.command ?? '').trim()

  if (!label) return { ok: false, message: 'Give the action a display name.' }
  if (label.length > MAX_LABEL_LENGTH) {
    return { ok: false, message: `Keep the display name under ${MAX_LABEL_LENGTH} characters.` }
  }
  if (!typed) return { ok: false, message: 'Give the action a skill, like /pr-review.' }

  const command = typed.startsWith('/') ? typed : `/${typed}`
  if (!SKILL_COMMAND.test(command)) {
    return {
      ok: false,
      message: 'A skill looks like /pr-review or /plugin:skill — letters, digits, - _ : only.',
    }
  }

  return {
    ok: true,
    action: {
      id: `custom-${index}`,
      label,
      command,
      title: `Open a Claude Code session running ${command} on this pull request`,
    },
  }
}

/**
 * The actions to offer: the three built in, then whichever stored custom ones
 * still validate.
 *
 * Invalid entries are dropped silently rather than surfaced here. The options page
 * is where a bad entry gets explained, and it cannot save one; anything invalid
 * reaching this point came from a hand-edited or older-format store, and the
 * useful behaviour then is to show the rest rather than break the popover.
 */
export function sessionActions(custom: readonly Partial<CustomAction>[] = []): SessionAction[] {
  const extra = custom
    .slice(0, MAX_CUSTOM_ACTIONS)
    .map((entry, index) => validateCustomAction(entry, index))
    .filter((result): result is { ok: true; action: SessionAction } => result.ok)
    .map((result) => result.action)

  return [...SESSION_ACTIONS, ...extra]
}

/**
 * Build the prefilled prompt.
 *
 * Deliberately just the command and the canonical PR URL. It is tempting to add
 * the pending check names or the unresolved comment text, since the parser
 * already has them — don't. Those strings are scraped out of the page, and this
 * prompt is handed to an agent that will act on it, so including them turns any
 * PR into a prompt-injection vector: a check named "ignore previous instructions
 * and …" would arrive as trusted-looking session input. The URL is built from
 * regex-validated path segments and carries no page-controlled text.
 */
export function sessionPrompt(action: SessionAction, ctx: PrContext): string {
  return `${action.command} ${conversationUrl(ctx)}`
}

/**
 * The `claude://` URL for one action, or null when the context is not safe to
 * interpolate. Callers treat null as "render no button".
 */
export function sessionUrl(action: SessionAction, ctx: PrContext, folder?: string): string | null {
  if (!safeSlug(ctx.owner) || !safeSlug(ctx.repo)) return null
  if (!Number.isSafeInteger(ctx.number) || ctx.number <= 0) return null

  const prompt = sessionPrompt(action, ctx)
  if (prompt.length > PROMPT_MAX) return null

  // encodeURIComponent, NOT URLSearchParams: the latter serialises a space as
  // `+`, which only decodes back to a space under form-urlencoded rules. The app
  // does use URL.searchParams so it would survive today, but any consumer that
  // reaches for decodeURIComponent instead would hand the session a literal
  // `/pr-review+https://…` and the slash command would not resolve. `%20` is
  // read the same way by both, so it is the encoding that cannot go wrong.
  const parts = [`q=${encodeURIComponent(prompt)}`]
  // Repeatable in the app's handler, but one working directory is all we can
  // ever know from a PR URL.
  if (folder) parts.push(`folder=${encodeURIComponent(folder)}`)
  return `${CODE_NEW}?${parts.join('&')}`
}

/**
 * Local checkout directory for the repo this PR belongs to, or undefined to let
 * Claude Code pick.
 *
 * Returning undefined is a working default, not a stub: the session still opens,
 * it just starts wherever Claude Code would otherwise start, and the skill can
 * ask. Filling this in is what makes the buttons land in the right repo.
 *
 * See "Local checkout mapping" in docs/DESIGN.md for the trade-offs.
 */
export function resolveFolder(_ctx: PrContext): string | undefined {
  return undefined
}
