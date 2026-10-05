import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseThreads } from '../src/detect/parse-threads'

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures')

function load(name: string): Document {
  const html = readFileSync(resolve(fixtures, name), 'utf8')
  return new DOMParser().parseFromString(html, 'text/html')
}

const parse = (html: string) => parseThreads(new DOMParser().parseFromString(html, 'text/html'))

describe('parseThreads against the real .js-discussion capture', () => {
  const doc = load('bot-threads.html')

  it('counts the one unresolved bot thread and ignores the four resolved ones', () => {
    const summary = parseThreads(doc)
    if (summary.status !== 'ok') throw new Error(summary.reason)
    expect(summary).toEqual({
      status: 'ok',
      unresolvedTotal: 1,
      unresolvedBot: 1,
      authors: ['devin-ai-integration'],
    })
  })

  it('ignores bot comments that are not resolvable threads', () => {
    // The capture opens with linear-code and coderabbitai issue comments — bot
    // authored, `js-comment-container`, but with no thread to resolve. Counting
    // them would hold the guard open permanently, since nothing can ever clear
    // them. The count above being 1 rather than 3 is the assertion; this test
    // exists to state why, and to fail loudly if the container selector ever
    // widens to catch them.
    const timeline = doc.querySelector('.js-discussion')!
    expect(timeline.querySelectorAll('.js-comment-container').length).toBeGreaterThan(
      timeline.querySelectorAll('.js-resolvable-timeline-thread-container').length,
    )
  })

  it('attributes a thread to the bot that opened it, not the human who replied', () => {
    // The unresolved thread holds two comments: devin's finding, then the PR
    // author's reply. Both are real. Naming the human here would put the wrong
    // name in the confirm dialog.
    const summary = parseThreads(doc)
    if (summary.status !== 'ok') throw new Error(summary.reason)
    expect(summary.authors).not.toContain('alex-dev')
  })
})

describe('parseThreads', () => {
  const doc = load('bot-threads.synthetic.html')

  it('counts unresolved bot threads only', () => {
    const summary = parseThreads(doc)
    if (summary.status !== 'ok') throw new Error(summary.reason)
    // 4 unresolved bot threads; the resolved one and the human one are excluded.
    expect(summary.unresolvedBot).toBe(4)
  })

  it('names the bots so the guard can quote them', () => {
    const summary = parseThreads(doc)
    if (summary.status !== 'ok') throw new Error(summary.reason)
    expect(summary.authors).toEqual(['coderabbitai', 'cursor', 'github-actions', 'devin-ai-integration'])
  })

  it('ignores unresolved threads opened by humans', () => {
    const summary = parse(`
      <div class="js-discussion">
        <div class="js-resolvable-timeline-thread-container" data-resolved="false">
          <a class="author" data-hovercard-type="user" href="/octocat">octocat</a>
        </div>
      </div>`)
    expect(summary).toEqual({ status: 'ok', unresolvedTotal: 1, unresolvedBot: 0, authors: [] })
  })

  it('ignores a human thread that a bot merely replied to', () => {
    // The mirror image of the shape in the real capture, and the reason author
    // detection is scoped to the opener. Counting this would block a review
    // request over a conversation the author is already having — over-blocking,
    // which costs more than a miss because it teaches the user to click through.
    const summary = parse(`
      <div class="js-discussion">
        <review-thread-collapsible class="js-resolvable-timeline-thread-container" data-resolved="false">
          <div class="js-comments-holder">
            <div class="js-comment review-comment">
              <a class="author" data-hovercard-type="user" href="/alex-dev">alex-dev</a>
            </div>
            <div class="js-comment review-comment">
              <a class="author" href="/apps/coderabbitai">coderabbitai</a>
              <span class="Label Label--secondary">Bot</span>
            </div>
          </div>
        </review-thread-collapsible>
      </div>`)
    expect(summary).toEqual({ status: 'ok', unresolvedTotal: 1, unresolvedBot: 0, authors: [] })
  })

  it('reads a timeline avatar, which carries no data-testid', () => {
    // The merge box tags avatars `data-testid="github-avatar"`; the timeline does
    // not tag them at all. Scoping this signal to the merge box's selector left
    // it dead for every real thread.
    const summary = parse(`
      <div class="js-discussion">
        <review-thread-collapsible class="js-resolvable-timeline-thread-container" data-resolved="false">
          <div class="js-comment review-comment">
            <img src="https://avatars.githubusercontent.com/in/811515?s=48&v=4"
                 alt="@devin-ai-integration" class="avatar mr-2">
          </div>
        </review-thread-collapsible>
      </div>`)
    expect(summary).toEqual({
      status: 'ok',
      unresolvedTotal: 1,
      unresolvedBot: 1,
      authors: ['devin-ai-integration'],
    })
  })

  it('does not mistake a human avatar for a bot', () => {
    // Humans are /u/<id>, apps are /in/<id>. One character apart.
    const summary = parse(`
      <div class="js-discussion">
        <review-thread-collapsible class="js-resolvable-timeline-thread-container" data-resolved="false">
          <div class="js-comment review-comment">
            <img src="https://avatars.githubusercontent.com/u/100000001?s=48&v=4"
                 alt="@alex-dev" class="avatar circle mr-2">
          </div>
        </review-thread-collapsible>
      </div>`)
    expect(summary).toEqual({ status: 'ok', unresolvedTotal: 1, unresolvedBot: 0, authors: [] })
  })

  it('does not treat the "Author" label as a bot badge', () => {
    // Real markup renders `<span class="Label ml-1">Author</span>` beside the PR
    // author on every one of their comments. A substring match on "Bot" is fine,
    // but a looser badge match would make every author reply bot feedback.
    const summary = parse(`
      <div class="js-discussion">
        <review-thread-collapsible class="js-resolvable-timeline-thread-container" data-resolved="false">
          <div class="js-comment review-comment">
            <a class="author" data-hovercard-type="user" href="/alex-dev">alex-dev</a>
            <span class="Label ml-1">Author</span>
          </div>
        </review-thread-collapsible>
      </div>`)
    expect(summary).toEqual({ status: 'ok', unresolvedTotal: 1, unresolvedBot: 0, authors: [] })
  })

  it('treats a missing data-resolved as unresolved, not resolved', () => {
    // Erring the other way would silently under-report, which is the direction
    // that makes the guard fail to fire when it should.
    const summary = parse(`
      <div class="js-discussion">
        <div class="js-resolvable-timeline-thread-container">
          <a class="author" href="/apps/coderabbitai">coderabbitai</a>
        </div>
      </div>`)
    if (summary.status !== 'ok') throw new Error(summary.reason)
    expect(summary.unresolvedBot).toBe(1)
  })

  it('detects a bot from its "Bot" badge when the login has no [bot] suffix', () => {
    // Real rendering: `edited by github-actions Bot`. Neither the /apps/ link nor
    // the [bot] suffix is present, so without the badge signal this thread reads
    // as human and the guard never fires for it.
    const summary = parse(`
      <div class="js-discussion">
        <div class="js-resolvable-timeline-thread-container" data-resolved="false">
          <a class="author" data-hovercard-type="user" href="/github-actions">github-actions</a>
          <span class="prc-Label-Label-qG-Zu" data-component="Label">Bot</span>
        </div>
      </div>`)
    if (summary.status !== 'ok') throw new Error(summary.reason)
    expect(summary.unresolvedBot).toBe(1)
    expect(summary.authors).toEqual(['github-actions'])
  })

  it('does not treat a comment body saying "Bot" as a bot author', () => {
    // The badge signal is scoped to Label components precisely so prose cannot
    // trigger it — otherwise any thread discussing bots counts as bot feedback.
    const summary = parse(`
      <div class="js-discussion">
        <div class="js-resolvable-timeline-thread-container" data-resolved="false">
          <a class="author" data-hovercard-type="user" href="/octocat">octocat</a>
          <p>Bot</p>
        </div>
      </div>`)
    expect(summary).toEqual({ status: 'ok', unresolvedTotal: 1, unresolvedBot: 0, authors: [] })
  })

  it('reports unavailable when there is no timeline at all', () => {
    // A fetched merge box, or drifted selectors. "0 unresolved" here would be a
    // claim we have not earned.
    const summary = parseThreads(load('settled-collapsed-counts.html'))
    expect(summary.status).toBe('unavailable')
  })

  it('distinguishes an empty timeline from a missing one', () => {
    // A PR with no review comments is a genuine zero.
    expect(parse('<div class="js-discussion"></div>')).toEqual({
      status: 'ok',
      unresolvedTotal: 0,
      unresolvedBot: 0,
      authors: [],
    })
  })

  it('counts humans and bots in the total, but only bots in the guard subset', () => {
    // The two figures are used for different things — the total is reported on the
    // banner, the subset gates a review request — so a page with both must not
    // conflate them.
    const summary = parse(`
      <div class="js-discussion">
        <div class="js-resolvable-timeline-thread-container" data-resolved="false">
          <a class="author" href="/apps/coderabbitai">coderabbitai</a>
        </div>
        <div class="js-resolvable-timeline-thread-container" data-resolved="false">
          <a class="author" data-hovercard-type="user" href="/alex-dev">alex-dev</a>
        </div>
        <div class="js-resolvable-timeline-thread-container" data-resolved="false">
          <a class="author" data-hovercard-type="user" href="/octocat">octocat</a>
        </div>
        <div class="js-resolvable-timeline-thread-container" data-resolved="true">
          <a class="author" data-hovercard-type="user" href="/alex-dev">alex-dev</a>
        </div>
      </div>`)
    expect(summary).toEqual({
      status: 'ok',
      unresolvedTotal: 3,
      unresolvedBot: 1,
      authors: ['coderabbitai'],
    })
  })

  it('leaves resolved threads out of the total, not just out of the bot subset', () => {
    const summary = parse(`
      <div class="js-discussion">
        <div class="js-resolvable-timeline-thread-container" data-resolved="true">
          <a class="author" data-hovercard-type="user" href="/alex-dev">alex-dev</a>
        </div>
        <div class="js-resolvable-timeline-thread-container" data-resolved="true">
          <a class="author" href="/apps/coderabbitai">coderabbitai</a>
        </div>
      </div>`)
    expect(summary).toEqual({ status: 'ok', unresolvedTotal: 0, unresolvedBot: 0, authors: [] })
  })

  it('deduplicates authors across multiple threads', () => {
    const summary = parse(`
      <div class="js-discussion">
        <div class="js-resolvable-timeline-thread-container" data-resolved="false">
          <a class="author" href="/apps/coderabbitai">coderabbitai</a>
        </div>
        <div class="js-resolvable-timeline-thread-container" data-resolved="false">
          <a class="author" href="/apps/coderabbitai">coderabbitai</a>
        </div>
      </div>`)
    if (summary.status !== 'ok') throw new Error(summary.reason)
    expect(summary.unresolvedBot).toBe(2)
    expect(summary.authors).toEqual(['coderabbitai'])
  })
})

describe('threads folded into the check summary', () => {
  it('marks threads unscanned when only a merge box was available', async () => {
    const { parseChecks } = await import('../src/detect/parse-checks')
    const summary = parseChecks(load('settled-collapsed-counts.html'))
    if (summary.status !== 'ok') throw new Error(summary.reason)

    // The distinction that matters: 0 with threadsScanned false is "we did not
    // look", not "verified clean".
    expect(summary.threadsScanned).toBe(false)
    expect(summary.unresolvedBotThreads).toBe(0)
  })
})
