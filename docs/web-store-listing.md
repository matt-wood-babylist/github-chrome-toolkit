# Chrome Web Store listing

Everything the developer dashboard asks for, for a private listing visible only to
babylist.com accounts. Items marked **TODO** still need doing before submission.

## Publisher and visibility

- Publisher: Babylist (dashboard `9d5fb853-d353-42e5-93d4-9884343636aa`), the same one
  that owns Add to Babylist Button. Access steps are in `babylist/web`
  `docs/chrome-extension.md`; first sign-in asks for the $5 developer verification,
  which is reimbursable.
- Distribution → Visibility: **Private**, restricted to the babylist.com domain. IT
  enabled domain-private publishing for Data Doula for Google Meet in September 2026;
  if the option is missing, that admin setting needs turning on again.
- Uncheck "publish automatically after review" so the first release goes out when
  we choose.

## Store listing tab

| Field | Value | Status |
| --- | --- | --- |
| Name | GitHub PR Helper, from `manifest.json` | Ready; if review flags it as implying GitHub affiliation, rename to "PR Helper for GitHub" |
| Summary | `manifest.json` `description`, 132 characters max | Ready (111 characters) |
| Description | Below | Ready |
| Category | Developer Tools | Ready |
| Language | English | Ready |
| Store icon | `icons/icon-128.png` (128×128) | Ready |
| Screenshots | 1 to 5 at 1280×800 or 640×400, square corners, no padding | **TODO** the ones in `docs/screenshots/` are 270–960 px wide |
| Small promo tile | 440×280 PNG or JPEG, required | **TODO** |
| Marquee | 1400×560, optional | Skip |
| Homepage URL | The GitHub repo | Ready |
| Support URL | The GitHub repo's issues page | Ready |

### Summary (111 characters)

> Shows pending checks and open conversations on GitHub pull requests, and opens
> Claude Code sessions for the PR.

### Description (draft)

> Keeps the state of a GitHub pull request in view while you work on it.
>
> - A bar at the top of every PR page lists checks that are still running and
>   review conversations that are still open, including bot reviews. It works on
>   the Files, Commits and Checks tabs, not only Conversation.
> - Requesting review while a bot review is still running asks you to confirm
>   first, so reviewers don't get pinged before the bot has finished.
> - Buttons open a Claude Code session in the Claude desktop app with a slash
>   command and the PR's URL already filled in: review the PR, respond to
>   feedback, fix failing CI, or any skill you add yourself.
>
> The extension only runs on github.com. It makes no requests anywhere else,
> collects nothing, and has no analytics. Session buttons need the Claude desktop
> app.

## Privacy practices tab

**Single purpose**

> Show the status of a GitHub pull request (pending checks, unresolved
> conversations, running bot reviews) on the PR page and let the user act on it,
> either by holding off on a review request or by opening a Claude Code session
> for that PR.

The three features are framed as one purpose on purpose: the 2026 policy treats
unrelated bundled features as a violation.

**Permission justifications**

- `storage`: Saves the user's settings and custom session actions in
  `chrome.storage.sync` so they follow the user between browsers.
- Host permission `https://github.com/*`: The content script reads the pull
  request page to find pending checks and unresolved conversations, and fetches
  the same PR's Conversation tab from github.com so the bar works on the other PR
  tabs. No other host is contacted.

**Remote code:** No. Everything is bundled by esbuild; there is no `eval` and no
remotely loaded script.

**Data usage.** The extension reads github.com page content and keeps it in the
tab; nothing goes to a server we run. The one case that needs a decision: clicking a
session button hands the PR's URL to the Claude desktop app, which sends it to
Anthropic once the user submits the prompt. Declaring **Website content** with
"transferred to a third party only when the user clicks a session action" costs
nothing and removes the argument with a reviewer. Then tick the three
certifications (no selling, no unrelated use, no creditworthiness use).

**Privacy policy URL:** required once any data type is declared. **TODO** publish
the text below somewhere stable, such as a `PRIVACY.md` in the repo, and link it.

> This extension runs only on github.com. It reads the pull request page you are
> viewing, and fetches that pull request's Conversation tab from github.com, to
> show its pending checks and open conversations. That information stays in your
> browser. Your settings are stored with Chrome's sync storage. When you click a
> session button, the extension opens the Claude desktop app with the pull
> request's URL and a slash command; what happens next is governed by Anthropic's
> terms. The extension has no analytics and sends nothing to its authors or anyone
> else.

## Each release

1. Bump `version` in `manifest.json` and `package.json`.
2. `npm run package`, then upload `release/<name>-<version>.zip` under Package →
   Upload new package.
3. Submit for review; publish by hand once it passes (about a day).
