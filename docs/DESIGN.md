# Design notes

Why the extension behaves the way it does, and what was learned from real GitHub
markup along the way. The [README](../README.md) covers install and use; read this
before changing detection, the review guard, or the session links.

## What counts as "pending"

Checks in the `in progress`, `queued`, and `pending` states.

Note what `pending` turns out to include. On a real PR, two rows reading
`Expected — Waiting for status to be reported` sat inside a group GitHub labelled
**"pending checks"** while the headline called them "2 expected". Only the group
word reaches the parser, so expected checks are counted — which agrees with
GitHub's own "Some checks haven't completed yet". The trade-off: a required check
that never reports holds the banner open. `denyList` handles that by name.

### Unresolved conversations

Separately from the pending count, the bar reports how many review conversations
are unresolved — the same figure GitHub shows as "N unresolved conversations".

They are counted but never added to `pending`, because the two are different
states: a check finishes on its own, a thread waits for somebody to act. That also
keeps a thread left open for a week from inflating a number that is supposed to
mean "still running". The wording follows the distinction — `PENDING: 8 CHECKS · 5
UNRESOLVED` while CI runs, but a bare `5 UNRESOLVED CONVERSATIONS` once everything
is green, since nothing is pending at that point.

**That green-but-not-ready state is the reason the banner now appears with nothing
pending.** It used to hide the moment the last check passed, which is exactly when
five open threads are the only thing standing between the PR and a premature merge.
The review guard still catches unread bot feedback, but only at the point you
request review; the banner says so while you are still working.

Zero is never shown, which also means an unreadable timeline stays quiet: threads
live in the discussion timeline, so a document without one reports 0 with
`threadsScanned: false`, and that 0 can neither be displayed nor raise the banner.

One exclusion is deliberate, to stop the banner getting stuck forever:

- **Reviewers that can't be identified as bots.** GitHub's Reviews section says
  "1 pending review" but, while that group is collapsed, gives no way to tell
  whether the reviewer is a bot or a person. Counting it would keep the banner up
  for the entire life of every PR awaiting approval. It's reported as
  `unattributedReviews` so the UI can admit the uncertainty, and there's an option
  to count it anyway.

**Bot reviewers always count.** Two sources: CodeRabbit, Devin, Warden and Claude
Code post into the Checks section, and any GitHub App sitting in the Reviews
section is identified by its `/apps/<slug>` link. Bot *comment* authors are
matched on four signals, because no single one is sufficient — GitHub renders
`github-actions` with a separate "Bot" badge rather than a `github-actions[bot]`
login, so suffix matching alone misses it entirely. The count is split into bot
reviews and CI, because a trailing lint job is harmless while a human reviewing
ahead of CodeRabbit is not — that split is what keeps the review guard precise
enough to be worth obeying.

## The review guard

Three things are guarded: **“Ready for review”** (draft → ready notifies every
requested reviewer at once — the biggest offender), the **reviewer picker**, and
**re-request review**. Always dismissible: the goal is stopping an accident, not
locking you out of your own PR.

It fires when an AI reviewer is still working, or — separately — when bots have
finished but left **unresolved comments**. That second case matters as much as
the first: requesting review over the top of eight unread CodeRabbit comments
wastes the reviewer's time in exactly the same way as requesting it too early.

The guard keys on the **bot-opened** subset only. The banner reports every
unresolved conversation, but a human's open thread is the reviewer's own business,
and blocking on it would make the guard something to click past.

Two rules it will not break:

- **It never fires when the page could not be read.** If detection returns
  `unknown`, there is no interruption. Interrupting on the strength of a number
  we have already admitted we do not trust is worse than missing the guard.
- **CI alone never fires it, by default.** A dialog that pops for a trailing lint
  job gets click-through-dismissed within a week, and then it protects nothing.
  `guardOnAnyPending` exists if you want it.

Controls are matched on their accessible **name**, not on structure — the
surrounding markup is hashed React, but a primary action's label is comparatively
stable, and it is also the phrase quoted back to you. An unmatched control is
never blocked, so label drift degrades into a missed guard rather than a
confusing one.

## Session buttons

Three actions, behind an **Actions** button on the right of the bar, and listed
directly in the toolbar popup:

| Button | Opens |
| --- | --- |
| **Start PR review** | A Claude Code session prefilled with `/pr-review <pr url>` |
| **Start PR response** | A Claude Code session prefilled with `/pr-respond <pr url>` |
| **Fix CI tests** | A Claude Code session prefilled with `/fix-ci-tests <pr url>` |

These skills come from the `pr-feedback` and `fix-ci-tests` Claude Code plugins.
Without them installed, the session still opens but the slash command does not
resolve.

Every prompt identifies the work by **PR URL, not by branch name**. `fix-ci-tests`
accepts either, and the PR URL is both safe to build — see below — and enough for
the skill to resolve the branch, its checks and its runs. Putting the literal
branch name in would mean scraping it out of the page, which is
pull-request-author-controlled text going into a prompt an agent acts on: exactly
the input this design keeps out.

Both surfaces are built from one list — the three built into `SESSION_ACTIONS` in
`src/content/session-link.ts`, plus any you add in Options — so a label and its
slash command exist in exactly one place and the two surfaces cannot drift apart.

### Custom actions

Options → **Custom actions** takes a display name and a skill (`/name-of-skill`)
and appends it to both the popover and the toolbar dropdown. The prompt is built
exactly like the built-ins': `<your skill> <pr url>`.

The skill charset is wider than it first looks, and that is from evidence rather
than guesswork — real skills include `pr-feedback:pr-review`, `Notion:tasks:build`
and `chrome-devtools-mcp:a11y-debugging`. So mixed case, digits, hyphens,
underscores, and colons for plugin qualification including more than one. A naive
`/^\/[a-z-]+$/` would reject most plugin skills.

What it still refuses is whitespace and newlines. This string is interpolated into
a prompt an agent acts on, so a newline would let a second instruction ride along
on a line of its own — the same reason scraped check names never reach the prompt.

Three smaller decisions:

- **A missing leading slash is added, not rejected.** `standup` becomes
  `/standup`. Being strict about something the user can't see the point of just
  makes the form annoying.
- **The options page validates with the same function the read path uses**, so it
  cannot save an entry that the banner and popup would then quietly drop. Anything
  invalid arriving at render time came from a hand-edited or older-format store,
  and the useful response there is to show the other rows rather than break the
  popover.
- **Twelve maximum.** `chrome.storage.sync` caps one item at 8KB and rejects
  beyond it; refusing the thirteenth beats a save that silently fails. Save errors
  are surfaced in the page for the same reason.

#### What a row shows

Each row is the display name on the left and the slash command it runs on the right,
smaller and dimmer. A name need not resemble its command — "Fix CI tests" is
`/fix-ci-tests`, but a custom action can be called anything — and the command is the
part that decides what Claude actually does, so it is worth seeing before clicking.

The command is `aria-hidden`: the accessible name stays the label, and the anchor's
title already describes the action. Reading "slash p r hyphen review" after the name
would add noise, not information.

Whether a long name wraps is the host's decision, not the shared stylesheet's,
because it depends on whether the panel can grow. The bar's popover is `width:
max-content` so names stay on one line, capped at `calc(100vw - 16px)` so a 40-char
name cannot push it off screen — past that cap it wraps rather than overflowing. The
toolbar dropdown is pinned to 250px and wraps from the start. Neither truncates: the
name is the user's own text, and two lines beat an ellipsis that hides which action
this is. The command itself never wraps — it is one token.

#### Editing without leaving the page

Both surfaces edit their own list: **Edit actions** in the bar's popover and in the
toolbar dropdown swaps the links for a row-per-action form. Built-ins are fixed —
only custom actions can be renamed, repointed, or removed — and one hint in the
form says so rather than leaving you to discover it by clicking.

One module (`src/shared/action-editor.ts`) builds the form for both. It takes a
`save` callback instead of writing to storage itself, because the popover lives in a
content script and the dropdown is an extension page; and it exports its stylesheet
so the popover can fold it into a shadow root while the dropdown injects it into a
document, without either restating the rules.

Four things this design has to get right, each of which was a bug first:

- **A save re-renders the surface that saved it.** Writing to sync storage notifies
  the content script, which refreshes the banner, which repaints the popover — while
  the form is still open. Edit mode therefore owns the panel until it is closed, and
  the seed list is updated underneath instead.
- **Closing must show what was just saved.** The repaint above is exactly when the
  action list changes, so the popover records its render inputs *before* the
  edit-mode bail-out. Recording them only on a full render made **Done** restore the
  list as it stood before the save.
- **Rows commit on `change`, not on input.** Validating mid-word would flash an
  error at someone who has typed the first letter of a good skill name. Invalid
  input keeps the typed text so it can be corrected rather than retyped.
- **In-progress typing survives a repaint nobody asked for.** The add row is one
  node re-appended by each redraw, not rebuilt, so a check finishing on the PR
  cannot clear a half-typed name. Existing rows are covered differently: re-seeding
  is skipped outright while focus is inside the form.

Colours come from the host through `currentColor`, so the same form suits the bar's
dark popover and the toolbar's light one. That puts a real requirement on the hosts:
each must declare a foreground `color`, not just a background. The bar's dark rule
originally set only `background`, which was invisible until this editor inherited
from it — every input border and label would have been near-black on a dark panel.

### The bar's two panels

The bar opens two things that both grow upward out of it: the pending-item list
(click the status text) and the actions popover (click **Actions**). They are
mutually exclusive, held as one `Overlay` value rather than two booleans — with two
flags, "close the other one" is something every call site has to remember, and
forgetting it stacks two panels on top of each other.

Two details that are easy to get wrong:

- **The popover is hand-rolled, not the native Popover API.** `popover` +
  `popovertarget` would give light-dismiss, Escape and top-layer rendering for
  free, and Chrome has supported it since 114. But jsdom implements none of it —
  no `showPopover`, no attribute reflection — so the open/close behaviour would
  have shipped untested in a codebase where every other interaction is covered.
  The existing outside-click and Escape handling was already there and already
  tested, so the popover reuses it.
- **It comes after the bar in the DOM even though it renders above it.** It is
  absolutely positioned, so DOM order costs nothing visually, and putting it last
  is what makes Tab move from the trigger *into* the links. Ordering it before the
  bar — which reads more naturally for something that appears above — would put
  its contents behind the trigger in sequence, so Tab would walk away from the
  panel that had just opened.

On a narrow window the toggle gives up width before the Actions button does — the
status text ellipsises and, below roughly 420px, disappears entirely. That is the
right priority, but it does mean the expand toggle becomes unclickable at extreme
widths.

The toolbar popup matters because the banner removes itself when nothing is
pending — which is precisely when you are most likely to want to start a review.
It reads the active tab's URL, so it needs no `tabs` permission (the existing
`github.com` host permission is what makes `tab.url` visible) and no message
passing to the page. Off a pull request it says so rather than offering a button
that would act on the wrong thing, and it shows `owner/repo #number` above the
actions so the target is never a guess.

They are `<a href="claude://code/new?q=…">` links, not buttons with click
handlers. `claude://code/new` is a real route in the Claude desktop app's URL
handler — it reads `q` (or `prompt`) plus repeatable `folder` and `file` params —
and letting the browser navigate to it keeps the protocol-handler prompt,
middle-click and keyboard activation working without reimplementing any of it.

`claude://` rather than the `https://claude.ai/…` universal link, which would fall
back to a browser tab when the app is missing. That's the right behaviour for a
chat link and the wrong behaviour here, since a Claude Code session has nowhere to
go in a browser.

Three things to know:

- **The prompt is only the slash command and the canonical PR URL.** It is
  tempting to include the pending check names or the unresolved comment text,
  since the parser already has them. Don't: those strings are scraped out of the
  page and this prompt is handed to an agent that acts on it, so a check named
  `ignore previous instructions and …` would arrive as trusted session input. The
  URL is assembled from regex-validated path segments and carries no
  page-controlled text. There's a test asserting exactly this.
- **It's an undocumented route.** Read out of Claude.app 1.24012.11, not a public
  API, and the app honours a `disableDeepLinks` setting that turns it off in
  managed environments. A button that does nothing means the build changed, not
  that you're offline.
- **The prompt is prefilled, not submitted, and cannot be.** You press Enter. This
  was investigated properly rather than assumed — see below.

### Why the prompt can't auto-submit

Checked against Claude.app 1.24012.11, because it looks like it ought to be a
missing `&submit=1` and it isn't. Four routes, each failing on one of two axes:

| Route | Forwards extra params? | Can create a session? |
| --- | --- | --- |
| `claude://code/new` | no — rebuilds the query as `q`/`folder`/`src` | yes |
| `claude://code/<session-id>` | yes, all of them | no — needs an id we cannot know |
| `https://claude.ai/code/new` | yes, all of them | no — `new` is a reserved segment |
| `claude://cowork/new` | no — same allowlist | yes, but the task does not auto-run |

The app's only prompt-submitting function is `sendToChatWithPayload({chatId, text,
images})`, whose sole caller is the global-hotkey QuickEntry window. The deep-link
router has a `hotkey` host, but its whole body is `return true` — it focuses the
window and carries no text. So no URL reaches a submit.

(The two `autosubmit` strings in the bundle are red herrings: one is voice
hold-to-talk, the other is browser form autofill.)

The only route that would work is a local helper registered to a custom scheme,
shelling out to the `claude` CLI. Deliberately not built: it means installing
something that executes commands whenever a URL fires, and any page you visit can
fire a registered scheme. If it is ever revisited, it must take an action name and
a PR URL validated against an allowlist — never free-form prompt text — so the URL
keeps carrying identifiers rather than instructions. Pressing Enter is also a
useful beat before an agent starts committing to a branch.

### Local checkout mapping

`resolveFolder()` in `src/content/session-link.ts` decides which directory the
session opens in. It currently returns `undefined`, which is a working default,
not a stub — the session still opens, it just starts wherever Claude Code would
otherwise start and the skill can ask.

Filling it in is what makes the buttons land in the right repo. The trade-off:

| Approach | Cost |
| --- | --- |
| Leave it undefined | Nothing to configure; wrong directory every time |
| Convention, e.g. `~/code/<repo>` | One line; breaks for anyone whose directory name differs from the repo name |
| Explicit `owner/repo` → path map | Exact; needs a real entry per repo you review |

Note that `sessionUrl` rejects an owner or repo containing `..` before it ever
reaches this function, so a path built by concatenation cannot be walked upward.

## How it works

Two facts about GitHub drive the whole design.

**It's a soft-navigating SPA.** Conversation → Files fires no page load. Content
scripts run in an isolated JS world, so patching `history.pushState` would only
observe the extension's own calls, never GitHub's.

**The merge box only exists on the Conversation tab.** One pure parser, two
document sources: the live `document` on Conversation, and a same-origin
`fetch` + `DOMParser` of the Conversation URL on every other tab.

The banner mounts as a shadow-DOM host on `<html>` rather than `<body>`, because
Turbo replaces body content wholesale and would take a body-mounted banner with
it. It's anchored with `inset: auto 0 0 0` and `height: auto`, so the host grows
upward as the detail list opens; the list is placed *before* the bar in the
shadow tree so it stacks above it rather than running off the bottom of the
screen. A light-DOM `<style>` adds `padding-bottom` to `body` so the bar never
covers the last of the page content, and both it and the `<html>` class are
removed when the banner hides.

### Everything is observer-driven

There is no polling loop. Both kinds of change — you navigated, or a check
finished — are detected by `MutationObserver`.

**Navigation** comes from three event-driven signals: GitHub's own
`soft-nav:end` / `turbo:load` / `pjax:end` events, `popstate`, and a
`MutationObserver` on `<head>` (GitHub rewrites `<title>` on every soft
navigation). `<head>` is small and mutates rarely, and the handler exits
immediately when the URL is unchanged, so extra fires cost nothing.

**Check state** on the Conversation tab comes from a `MutationObserver` scoped
to the merge box. GitHub already keeps that subtree live-updated, so the count
tracks reality the instant it changes — no timers, no network. The observer
config is in [`src/detect/watch.ts`](../src/detect/watch.ts) and its non-obvious
part is `attributeFilter: ['aria-label', 'aria-expanded']`: the authoritative
count lives in a group header's `aria-label`, and React rewrites that **in
place** without adding or removing a single node. A `childList`-only observer
would watch a count go from 3 to 2 and never notice.

Until the merge box streams in, a temporary observer watches `<body>` — but
strictly bounded. It narrows to the merge box the moment it appears and gives up
after 20 seconds, so a merged or closed PR (which has no merge box and never
will) doesn't leave a full-subtree observer running for the life of the tab.

**The one timer.** Files/Commits/Checks tabs have no merge box in the DOM, so
there is nothing to observe and the count has to come from a fetch. That timer
is armed only when all three hold:

- not on the Conversation tab, and
- the tab is visible — a hidden tab is never polled at all, and
- something is actually pending.

Outside that intersection, zero requests. Going from nothing pending to
something pending — a fresh push — is picked up on the next focus, navigation,
or visibility change rather than by asking github.com every 30 seconds forever.
Focus and `visibilitychange` often fire together, so fetch-triggering refreshes
are coalesced within a 2-second window.

### Parsing rules worth knowing

These are the non-obvious ones, learned from real markup:

- **Counts come from group header buttons, never from counting rows.** A
  collapsed group renders zero `<li>` elements, so row-counting silently
  undercounts. `button[aria-label="Collapse 20 skipped checks group"]` is
  present either way.
- **No CSS-module classes, ever.** Every class in the merge box is
  content-hashed (`MergeBoxSectionHeader-module__wrapper___70DU`) and changes
  on any deploy touching that file. Only `data-testid`, `aria-label`, `role`,
  `data-action` and `octicon-*` are used. All of them live in
  [`src/detect/selectors.ts`](../src/detect/selectors.ts).
- **Row `aria-label`s do not reliably carry state.** An Actions row reads
  `"Tests / Jest (pull_request) skipped"`, but a third-party commit status reads
  `"CodeRabbit "` — name plus a trailing space, no state word. State comes from
  the enclosing group.
- **A GitHub App avatar (`/in/<id>`) does not mean "review bot".** GitHub
  Actions is itself an App (`/in/15368`), so nearly every check is
  "app-posted". The useful distinction is the link target: Actions jobs point at
  `/actions/runs/…`, third-party reviewers point elsewhere or nowhere. That's
  the `via: 'actions' | 'external'` field.
- **When in doubt, hide.** An unrecognized group state or a missing merge box
  returns `status: 'unknown'` and the banner disappears. A confident
  `PENDING CHECKS: 0` while CI is still running is the one failure mode that
  makes this worse than nothing.
- **An unnameable check counts as CI, never as an AI review.** Collapsed groups
  give a count with no rows behind it. Classification has to be wrong sometimes,
  so it errs in the direction that costs least: under-blocking degrades to a
  passive banner, over-blocking trains you to dismiss the guard.
- **The header count stays authoritative for totals; rows only decide the
  split.** React updates a group header's `aria-label` and adds/removes its rows
  in *separate* mutations, so summing rows drifts during a re-render.
- **`js-*` classes are fair game, `*-module__*` are not.** The thread parser uses
  `.js-resolvable-timeline-thread-container`. GitHub's `js-` classes are
  behavioural contracts for its own scripts; the hashed ones are styling and
  churn on every deploy.
- **A missing `data-resolved` means unresolved.** Erring the other way would
  under-report and silently fail to fire the guard.

## Known gaps

- **Check-group wording is confirmed** against real captures for `skipped`,
  `successful`, `in progress` and `pending` (`in-flight.html`). `queued` is still
  a hedge. Unfamiliar wording hides the banner rather than producing a number.
- **Expected checks are counted, despite what the exclusion list implies.** On a
  real PR, rows reading `Expected — Waiting for status to be reported` sat in a
  group GitHub labelled `"pending checks"`, and only the group word reaches the
  parser. This agrees with GitHub's own "Some checks haven't completed yet", so
  it's the right landing point — but a required check that never reports will
  hold the banner open. Use `denyList` if that bites.
- **The guard's control labels are confirmed.** A full label dump from a real
  draft PR showed `Ready for review` and `Reviewers` matching, and 29 other real
  labels correctly ignored — including `Update branch`, `Merge when ready`,
  `Close pull request`, `Resolve conversation`, `Review required` and
  `Awaiting requested review from <team>`. All are pinned by tests, with the two
  that must match called out as canaries: if GitHub renames either, the guard
  silently stops protecting anything.
  `Re-request review` is still unobserved — that PR had no submitted reviews yet.
- **Review-thread DOM structure is confirmed.** A real `.js-discussion` capture
  is checked in as `test/fixtures/bot-threads.html`, and it corrected two things
  inference had wrong. Timeline avatars carry no `data-testid`, so the merge box's
  avatar selector had matched nothing there and that bot signal was dead; and a
  thread can hold a bot comment plus a human reply, so scanning a whole thread for
  "any bot" also fired on the mirror shape — a human's thread that a bot replied
  to. Author detection is now scoped to a thread's opening comment. Both are
  pinned by tests that fail when the fix is reverted.
  Still unobserved: a thread opened by a bot whose only signal is a `[bot]` login
  suffix. The captured PR's threads were all `/apps/`-linked, so that path rests
  on the signal-matrix fixture rather than on real markup.
- **Resolving a thread does not update the count immediately.** The Conversation
  tab's live updates come from a `MutationObserver` scoped to the merge box, and
  review threads live in the timeline, which is not watched — deliberately, since
  observing that much of a GitHub page is the expense the whole design avoids. The
  count corrects itself on the next navigation, tab focus, or visibility change.
  This predates the banner reporting the number and applies equally to the review
  guard, but it is more visible now that the banner can be up on the strength of
  that count alone.
- **The deny list can't filter a collapsed group.** Its count is a single
  integer from the header; individual names aren't available to match against.
- **Session-fetch cookie behaviour is unverified against live GitHub.** In MV3
  the extension is the request initiator, so this is a host-permission-gated
  request that happens to be same-origin. It should carry cookies; if it comes
  back signed out, the console says so, and the fix is moving the fetch into a
  service worker.
