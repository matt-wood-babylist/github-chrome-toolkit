/** Normalized state of a single check, mapped from GitHub's display wording. */
export type CheckState =
  | 'in_progress'
  | 'queued'
  | 'pending'
  | 'expected'
  | 'successful'
  | 'failed'
  | 'skipped'
  | 'cancelled'
  | 'neutral'

/**
 * How a check reported in. Actions jobs link to /actions/runs/…; third-party
 * reviewers (CodeRabbit, Devin) post commit statuses with an external link or
 * no link at all. This is the distinction that actually separates "CI job"
 * from "review bot" — the avatar alone does not, because GitHub Actions is
 * itself a GitHub App.
 */
export type CheckVia = 'actions' | 'external'

/**
 * Why this item matters. `ai_review` is the one that makes requesting a human
 * review premature; `ci` finishing late is mostly harmless.
 *
 * This is NOT derivable from `via` — `Warden / warden / review` and
 * `Claude Code / claude` are Actions jobs doing AI review, while CodeRabbit is
 * an external commit status. Classification comes from a name/app-id registry.
 */
export type ItemKind = 'ai_review' | 'ci'

export type PendingItem = {
  name: string
  /** Absolute or GitHub-relative URL to the check's detail page, when it has one. */
  url?: string
  via: CheckVia
  /** True when posted by a GitHub App (includes Actions itself). */
  isApp: boolean
  /** Numeric App id from the avatar URL (`/in/<id>`), when present. */
  appId?: string
  kind: ItemKind
}

export type CheckGroup = {
  state: CheckState
  /** Authoritative count, read from the group's header button. */
  count: number
  /** Verbatim group wording, kept for debugging selector drift. */
  label: string
  /** Populated only when the group is expanded; may be shorter than `count`. */
  items: PendingItem[]
}

export type PendingSummary =
  | {
      status: 'ok'
      /** Total gated count — what the banner shows. */
      pending: number
      /**
       * AI reviewers still working: classified pending checks plus bot
       * reviewers awaiting in the Reviews section.
       */
      pendingAiReviews: number
      /**
       * Everything else pending. Includes any group whose rows GitHub collapsed,
       * since an unnamed check cannot be classified and CI is the safe guess.
       */
      pendingChecks: number
      /** Requested reviewers not identifiable as bots. Counted only on request. */
      pendingOtherReviews: number
      /**
       * Of `pendingOtherReviews`, how many we could not even attempt to
       * attribute because GitHub rendered the group collapsed. Lets the UI be
       * honest about uncertainty instead of implying a clean answer.
       */
      unattributedReviews: number
      /** Items belonging to pending groups, when those groups were expanded. */
      items: PendingItem[]
      groups: CheckGroup[]
      /**
       * Every unresolved review thread on the page, whoever opened it — the same
       * figure GitHub calls "unresolved conversations". Reported on the banner.
       */
      unresolvedThreads: number
      /**
       * The subset opened by a bot. Deliberately NOT part of `pending`: an
       * unresolved thread is not "running", and can legitimately sit open for
       * days, which would pin the banner up permanently. It feeds the review
       * guard, which is about unread bot feedback specifically — a human's open
       * thread is the reviewer's own business and must not block them.
       */
      unresolvedBotThreads: number
      /** Bot logins/slugs with unresolved threads, for naming them in the guard. */
      botThreadAuthors: string[]
      /**
       * False when the timeline was not in the document at all (a fetched merge
       * box, or GitHub markup drift) — so a 0 above cannot be mistaken for
       * "verified clean".
       */
      threadsScanned: boolean
    }
  | { status: 'unknown'; reason: string }

/** The successful shape, for consumers that have already narrowed on status. */
export type OkSummary = Extract<PendingSummary, { status: 'ok' }>

/**
 * A user-defined entry in the bar's actions popover.
 *
 * Stored rather than validated at rest — `chrome.storage.sync` can hold anything
 * an older or newer build wrote — so every read path runs it through
 * `validateCustomAction` before it reaches a prompt.
 */
export type CustomAction = {
  /** What the popover row says, e.g. "Write the changelog". */
  label: string
  /** The slash command, leading slash included, e.g. "/changelog". */
  command: string
}

export type Options = {
  /**
   * Seconds between re-checks while checks are pending on a tab that has no
   * merge box to observe (Files/Commits/Checks). Not used on the Conversation
   * tab, which is driven entirely by a MutationObserver, and not used at all
   * when the tab is hidden or nothing is pending.
   */
  pendingRefreshSeconds: number
  /**
   * Count requested reviewers that are NOT identifiable as bots — including any
   * GitHub renders collapsed, where attribution is impossible. Off by default:
   * a pending human review lasts the life of the PR, so counting it pins the
   * banner up permanently. Bot reviewers are always counted regardless.
   */
  includeOtherReviews: boolean
  /**
   * Case-insensitive name substrings marking a check as an AI reviewer rather
   * than CI. Needed because the distinction is not structural — see ItemKind.
   */
  aiReviewers: string[]
  /** Case-insensitive substrings; matching checks are excluded from the count. */
  denyList: string[]
  /**
   * Intercept clicks on the controls that request a human review, and confirm
   * first when a bot review is still outstanding.
   */
  guardReviewRequests: boolean
  /**
   * Also confirm when bots have finished but left unresolved comments. Requesting
   * review over the top of unread bot feedback wastes the reviewer's time in
   * exactly the same way as requesting it too early.
   */
  guardOnUnresolvedBotComments: boolean
  /**
   * Also confirm for ordinary CI. Off by default and deliberately so: a dialog
   * that fires for a trailing lint job trains you to dismiss it without reading,
   * which costs more than the occasional early request.
   */
  guardOnAnyPending: boolean
  /**
   * Extra actions in the bar's popover and the toolbar dropdown, on top of the
   * three built in. Order is preserved and they always come after the built-ins.
   */
  customActions: CustomAction[]
  debug: boolean
}

/**
 * Seeded from checks observed on real PRs. `warden` and `claude` are Actions
 * jobs; `coderabbit` and `devin` arrive as external commit statuses.
 */
export const DEFAULT_AI_REVIEWERS = [
  'coderabbit',
  'devin',
  'warden',
  'claude',
  'copilot',
  'cursor',
  'greptile',
  'bugbot',
]

export const DEFAULT_OPTIONS: Options = {
  pendingRefreshSeconds: 30,
  includeOtherReviews: false,
  aiReviewers: DEFAULT_AI_REVIEWERS,
  denyList: [],
  guardReviewRequests: true,
  guardOnUnresolvedBotComments: true,
  guardOnAnyPending: false,
  customActions: [],
  debug: false,
}
