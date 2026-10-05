import type { CheckState } from '../shared/types'

/**
 * Every GitHub selector lives here.
 *
 * Hard rule: NOTHING in this file may reference a CSS-module class. GitHub's
 * merge box is React with content-hashed class names
 * (`MergeBoxSectionHeader-module__wrapper___70DU`) that change on any deploy
 * touching that file. The accessibility surface — data-testid, aria-label,
 * role, data-action, octicon-* — is semantic and survives refactors.
 */

export const MERGE_BOX = '[data-testid="mergebox-border-container"]'
export const CHECKS_SECTION = 'section[aria-label="Checks"]'
export const REVIEWS_SECTION = 'section[aria-label="Reviews"]'

/** One per state bucket ("20 skipped checks", "3 in progress checks"). */
export const CHECK_GROUP = 'div[role="group"]'
export const CHECK_ROW = 'li[aria-label]'
export const CHECK_LINK = 'a[data-action="view_check_details"]'
export const CHECK_TITLE = 'h4'

/**
 * Merge-box avatars only. The timeline is a different renderer and tags nothing
 * with `data-testid` — see THREAD_AVATAR.
 */
export const AVATAR = 'img[data-testid="github-avatar"]'

/** Actions job URLs look like /owner/repo/actions/runs/123/job/456. */
export const ACTIONS_URL = /\/actions\/runs\/\d+/

/** GitHub App avatars are /in/<app_id>; user avatars are /u/<user_id>. */
export const APP_AVATAR = /\/in\/(\d+)/

/**
 * In the Reviews section, GitHub App reviewers link to /apps/<slug> while human
 * reviewers link to /<login>. That is the cleanest bot-vs-human discriminator
 * available, and it only works when the group is expanded — a collapsed group
 * renders no reviewer rows at all.
 */
export const REVIEWER_APP_LINK = 'a[href^="/apps/"]'
export const REVIEWER_ANY_LINK = 'a[href]'

/**
 * App ids seen posting AI reviews on real PRs, read off the avatar URL. More
 * precise than a name match where available, since ids don't change when a bot
 * renames its check.
 */
export const AI_REVIEWER_APP_IDS: ReadonlySet<string> = new Set([
  '347564', // CodeRabbit
  '811515', // Devin Review
])

/**
 * GitHub's group wording -> normalized state.
 *
 * Keys are lowercased with a trailing " checks" already stripped. Add a line
 * here when GitHub introduces new wording; an unrecognized word deliberately
 * aborts the whole parse to `unknown` rather than being silently ignored,
 * because ignoring it would undercount.
 *
 * CONFIRMED against live merge boxes: "skipped", "successful", "in progress",
 * "pending". The rest are GitHub's vocabulary from the Checks tab and the REST
 * API, kept as a hedge but not yet observed as group wording.
 *
 * Note "expected" is almost certainly dead as a group word. On a real PR with
 * two `Expected — Waiting for status to be reported` rows, GitHub labelled the
 * group "pending checks" and the headline said "2 expected". The row-level
 * state and the group-level word disagree, and only the group word reaches
 * here.
 */
export const STATE_WORDS: Readonly<Record<string, CheckState>> = {
  'in progress': 'in_progress',
  running: 'in_progress',
  queued: 'queued',
  pending: 'pending',
  waiting: 'pending',
  'action required': 'pending',
  expected: 'expected',
  successful: 'successful',
  success: 'successful',
  passed: 'successful',
  failing: 'failed',
  failed: 'failed',
  'timed out': 'failed',
  skipped: 'skipped',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  neutral: 'neutral',
  stale: 'neutral',
}

// ---------------------------------------------------------------------------
// Review threads (unresolved bot feedback)
// ---------------------------------------------------------------------------

/**
 * These are `js-*` hooks, which may look like a violation of the no-classes
 * rule above — it isn't. The rule targets content-hashed CSS modules
 * (`Foo-module__bar__H4SH`) that change whenever styling is touched. GitHub's
 * `js-` classes are behavioural contracts for its own scripts and have survived
 * years of restyling.
 *
 * CONFIRMED against a real `.js-discussion` capture. The thread element is a
 * custom element — `<review-thread-collapsible class="… js-comment-container
 * js-resolvable-timeline-thread-container …" data-resolved="false">` — which is
 * why the container selector is class-based rather than tag-based, and
 * `data-resolved` carries the literal strings "true" and "false".
 */
export const DISCUSSION_TIMELINE = '.js-discussion, [data-testid="issue-viewer-container"]'
export const THREAD_CONTAINER = '.js-resolvable-timeline-thread-container'
export const THREAD_RESOLVED_ATTR = 'data-resolved'
export const COMMENT_AUTHOR = 'a.author, a[href^="/apps/"], a[data-hovercard-type="user"]'

/**
 * One comment within a thread. The thread element itself carries
 * `js-comment-container`, never `js-comment`, so this cleanly selects children.
 *
 * Author detection is scoped to the thread's FIRST comment rather than the whole
 * thread, and that is load-bearing. On a real PR a bot's thread had the author's
 * reply beneath it — the human answered and deliberately left the thread open —
 * so a thread legitimately holds both a bot and a human. Asking "is there a bot
 * anywhere in here" gets that case right by luck and gets its mirror image (human
 * opens, bot replies) wrong, counting a human conversation as unread bot feedback.
 * That is the over-blocking direction, which trains the user to dismiss the guard.
 */
export const THREAD_COMMENT = '.js-comment'

/** Bot logins carry a `[bot]` suffix; App profile links live under /apps/. */
export const BOT_LOGIN = /\[bot\]\s*$/i
export const APP_PROFILE_URL = /^\/apps\/([^/?#]+)/

/**
 * A third bot signal, and the one that catches what the other two miss.
 *
 * On a real PR the timeline reads `edited by github-actions Bot` — the author
 * link text is the bare login with NO `[bot]` suffix, and "Bot" is a separate
 * Primer Label badge beside it. Relying on the suffix alone silently classifies
 * those threads as human, which means the guard never fires for them.
 *
 * CONFIRMED in the timeline as `<span class="Label Label--secondary">Bot</span>` —
 * note the plain `.Label`, with NO `data-component` attribute. The merge box
 * renders the same component as `<span class="prc-Label-Label-qG-Zu"
 * data-component="Label">Required</span>`. Two renderers, one component; the
 * selector has to cover both spellings.
 *
 * `/^bot$/i` and not a substring match: the timeline also renders a `Label`
 * reading "Author" beside the PR author, and "Outdated" on stale threads.
 */
export const BOT_BADGE = '[data-component="Label"], .Label, [class*="-Label-"]'
export const BOT_BADGE_TEXT = /^bot$/i

/**
 * Timeline avatars carry no `data-testid` — that is merge-box React only, so the
 * merge box's AVATAR selector silently never matched here and this signal was
 * dead until a real capture exposed it.
 *
 * CONFIRMED: `<img src="https://avatars.githubusercontent.com/in/811515?s=48&v=4"
 * alt="@devin-ai-integration" class="avatar mr-2 tmp-mr-2">`. Matching every
 * `img[src]` and testing for `/in/<id>` is safe because human avatars are `/u/<id>`
 * and inline comment images are absolute camo URLs.
 */
export const THREAD_AVATAR = 'img[src]'

// ---------------------------------------------------------------------------
// Review-request controls (the guard)
// ---------------------------------------------------------------------------

/**
 * The controls that put a PR in front of a human reviewer.
 *
 * Matched on accessible NAME rather than structure. That is deliberate: the
 * surrounding markup is hashed React, but a primary action's visible or aria
 * label is comparatively stable — and it is also the phrase we quote back to
 * the user, so a drifted label degrades into a missed guard rather than a
 * confusing one.
 *
 * CONFIRMED against a real draft PR's full label dump: "Ready for review" and
 * "Reviewers" both match, and 27 other real labels — including "Update branch",
 * "Merge when ready", "Close pull request", "Resolve conversation", "Review
 * required" and "Awaiting requested review from <team>" — correctly do not.
 * "Re-request review" is still unobserved (that PR had no submitted reviews yet).
 *
 * The guard fails OPEN regardless: anything not matched here is never blocked.
 */
export const REVIEW_REQUEST_CONTROLS: ReadonlyArray<{ id: string; what: string; match: RegExp }> = [
  // Draft -> ready notifies every requested reviewer at once. Biggest offender.
  { id: 'ready-for-review', what: '“Ready for review”', match: /^ready for review$/i },
  // Trailing digits tolerated: GitHub renders a reviewer count beside the label.
  { id: 'request-reviewers', what: 'the reviewer picker', match: /^(?:request|edit|add)?\s*reviewers?(?:\s+\d+)?$/i },
  { id: 're-request-review', what: 'a re-request', match: /^re-?request review/i },
]

/** A guarded control has to be something clickable, not a heading that reads "Reviewers". */
export const INTERACTIVE = 'button, summary, a[role="button"], [role="menuitem"]'

/**
 * States that make the banner appear.
 *
 * `expected` is listed as excluded, but be clear about what that does and does
 * not achieve. The intent was to skip required checks that have never reported —
 * a branch-protection rule for a path the PR didn't touch may never arrive, and
 * counting it would pin the banner up for the life of the PR.
 *
 * In practice GitHub puts those rows in a group labelled "pending checks", which
 * maps to `pending` and IS counted. So expected checks are counted after all,
 * and this exclusion only fires if GitHub ever labels a group "expected".
 *
 * That is the right outcome to land on regardless: GitHub's own headline for
 * that PR read "Some checks haven't completed yet", so counting them agrees with
 * what GitHub tells the user. The residual risk — a never-reporting required
 * check holding the banner open — is real but rare, and `denyList` handles it by
 * name when it bites.
 */
export const PENDING_STATES: ReadonlySet<CheckState> = new Set<CheckState>([
  'in_progress',
  'queued',
  'pending',
])
