import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseChecks } from '../src/detect/parse-checks'
import { DEFAULT_OPTIONS, type Options } from '../src/shared/types'

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures')

function load(name: string): Document {
  const html = readFileSync(resolve(fixtures, name), 'utf8')
  return new DOMParser().parseFromString(html, 'text/html')
}

function opts(overrides: Partial<Options> = {}): Options {
  return { ...DEFAULT_OPTIONS, ...overrides }
}

describe('settled PR with collapsed groups', () => {
  const doc = load('settled-collapsed-counts.html')

  it('reports nothing pending', () => {
    const summary = parseChecks(doc, opts())
    expect(summary).toMatchObject({ status: 'ok', pending: 0 })
  })

  it('reads counts from group headers, not rendered rows', () => {
    const summary = parseChecks(doc, opts())
    if (summary.status !== 'ok') throw new Error(summary.reason)

    // The fixture renders 2 skipped and 3 successful <li> rows but the headers
    // say 20 and 25. Row-counting would produce 2 and 3 here.
    expect(summary.groups.map((g) => [g.state, g.count])).toEqual([
      ['skipped', 20],
      ['successful', 25],
    ])
  })

  it('does not count unattributable reviewers by default', () => {
    const summary = parseChecks(doc, opts())
    if (summary.status !== 'ok') throw new Error(summary.reason)
    expect(summary.pendingOtherReviews).toBe(0)
    expect(summary.pending).toBe(0)
    // Still reported, so the UI can admit the uncertainty rather than implying
    // a clean zero.
    expect(summary.unattributedReviews).toBe(1)
  })

  it('folds in unattributable reviewers when asked', () => {
    const summary = parseChecks(doc, opts({ includeOtherReviews: true }))
    if (summary.status !== 'ok') throw new Error(summary.reason)
    expect(summary.pendingOtherReviews).toBe(1)
    expect(summary.pending).toBe(1)
  })

  it('names third-party review bots from the title, not the state-less aria-label', () => {
    const summary = parseChecks(doc, opts())
    if (summary.status !== 'ok') throw new Error(summary.reason)
    const successful = summary.groups.find((g) => g.state === 'successful')
    const names = successful?.items.map((i) => i.name) ?? []

    // aria-label is "CodeRabbit " (trailing space, no state word).
    expect(names).toContain('CodeRabbit')
    expect(names).toContain('Devin Review')
    expect(names.some((n) => n.includes('successful'))).toBe(false)
  })

  it('separates Actions jobs from externally-reported checks', () => {
    const summary = parseChecks(doc, opts())
    if (summary.status !== 'ok') throw new Error(summary.reason)
    const items = summary.groups.flatMap((g) => g.items)
    const by = (name: string) => items.find((i) => i.name.startsWith(name))

    expect(by('Label Check')?.via).toBe('actions')
    expect(by('CodeRabbit')?.via).toBe('external')
    expect(by('Devin Review')?.via).toBe('external')

    // Every row here is posted by a GitHub App — including Actions itself
    // (/in/15368) — which is exactly why `isApp` cannot stand in for
    // "is a review bot".
    expect(items.every((i) => i.isApp)).toBe(true)
    expect(by('Label Check')?.appId).toBe('15368')
    expect(by('CodeRabbit')?.appId).toBe('347564')
  })
})

describe('PR with checks in flight (synthetic fixture)', () => {
  const doc = load('in-progress.synthetic.html')

  it('sums every pending group, including collapsed ones', () => {
    const summary = parseChecks(doc, opts())
    if (summary.status !== 'ok') throw new Error(summary.reason)
    // 2 in progress + 1 queued. The queued group is collapsed with zero rows.
    expect(summary.pending).toBe(3)
  })

  it('exposes the pending items it can see', () => {
    const summary = parseChecks(doc, opts())
    if (summary.status !== 'ok') throw new Error(summary.reason)
    expect(summary.items.map((i) => i.name)).toEqual(['Tests / RSpec (pull_request)', 'CodeRabbit'])
  })

  it('excludes deny-listed checks from the count', () => {
    const summary = parseChecks(doc, opts({ denyList: ['coderabbit'] }))
    if (summary.status !== 'ok') throw new Error(summary.reason)
    expect(summary.pending).toBe(2)
    expect(summary.items.map((i) => i.name)).toEqual(['Tests / RSpec (pull_request)'])
  })
})

describe('inconclusive documents', () => {
  it('returns unknown when there is no merge box at all', () => {
    const summary = parseChecks(load('files-tab.html'), opts())
    expect(summary).toEqual({ status: 'unknown', reason: 'no merge box in document' })
  })

  it('returns 0 — not unknown — when the repo simply has no CI', () => {
    const summary = parseChecks(load('no-ci.html'), opts())
    expect(summary).toMatchObject({ status: 'ok', pending: 0, groups: [] })
  })

  it('returns unknown for a half-rendered merge box', () => {
    const doc = new DOMParser().parseFromString(
      '<div data-testid="mergebox-border-container"></div>',
      'text/html',
    )
    const summary = parseChecks(doc, opts())
    expect(summary.status).toBe('unknown')
  })

  it('refuses to guess when GitHub introduces unfamiliar group wording', () => {
    const doc = new DOMParser().parseFromString(
      `<div data-testid="mergebox-border-container">
         <section aria-label="Checks">
           <button aria-controls="g" aria-label="Collapse 3 quantum checks group">3 quantum checks</button>
           <div id="g" aria-label="quantum checks" role="group"></div>
         </section>
       </div>`,
      'text/html',
    )
    const summary = parseChecks(doc, opts())
    expect(summary.status).toBe('unknown')
    if (summary.status !== 'unknown') return
    expect(summary.reason).toContain('quantum checks')
  })
})

describe('accepts the merge box element directly', () => {
  it('works when handed the container rather than a document', () => {
    const doc = load('settled-collapsed-counts.html')
    const box = doc.querySelector('[data-testid="mergebox-border-container"]')
    expect(box).not.toBeNull()
    expect(parseChecks(box!, opts())).toMatchObject({ status: 'ok', pending: 0 })
  })
})

describe('AI reviewer classification', () => {
  const doc = load('in-progress.synthetic.html')

  it('separates AI reviewers from CI in the pending split', () => {
    const summary = parseChecks(doc, opts())
    if (summary.status !== 'ok') throw new Error(summary.reason)

    // CodeRabbit is reviewing; RSpec is just a test suite. Both pending, but
    // only one of them makes requesting a human review premature.
    expect(summary.pendingAiReviews).toBe(1)
    // 1 visible CI row + 1 collapsed queued group that cannot be named.
    expect(summary.pendingChecks).toBe(2)
    expect(summary.pending).toBe(3)
  })

  it('classifies by app id even when the name would not match', () => {
    // Empty registry: only the CodeRabbit app id can identify it now.
    const summary = parseChecks(doc, opts({ aiReviewers: [] }))
    if (summary.status !== 'ok') throw new Error(summary.reason)
    expect(summary.items.find((i) => i.name === 'CodeRabbit')?.kind).toBe('ai_review')
  })

  it('classifies Actions jobs by name, since nothing structural marks them', () => {
    // Warden and Claude Code run under the Actions app id, exactly like the test
    // suites, so the name is the only available signal.
    const summary = parseChecks(doc, opts({ aiReviewers: ['rspec'] }))
    if (summary.status !== 'ok') throw new Error(summary.reason)
    const rspec = summary.items.find((i) => i.name.includes('RSpec'))
    expect(rspec?.via).toBe('actions')
    expect(rspec?.kind).toBe('ai_review')
    expect(summary.pendingAiReviews).toBe(2) // RSpec (by name) + CodeRabbit (by app id)
  })

  it('attributes unnamed rows from collapsed groups to CI, not to AI reviews', () => {
    const summary = parseChecks(doc, opts())
    if (summary.status !== 'ok') throw new Error(summary.reason)
    const queued = summary.groups.find((g) => g.state === 'queued')

    // The queued group is collapsed: a real count with no rows behind it.
    expect(queued?.count).toBe(1)
    expect(queued?.items).toHaveLength(0)
    // Over-reporting AI reviews is what would make the review guard cry wolf,
    // so an unnameable check is assumed to be CI.
    expect(summary.pendingAiReviews).toBe(1)
  })

  it('keeps the deny list working across the split', () => {
    const summary = parseChecks(doc, opts({ denyList: ['coderabbit'] }))
    if (summary.status !== 'ok') throw new Error(summary.reason)
    expect(summary.pendingAiReviews).toBe(0)
    expect(summary.pendingChecks).toBe(2)
    expect(summary.pending).toBe(2)
  })
})

describe('real capture: checks in flight', () => {
  const doc = load('in-flight.html')

  it('counts in-progress and pending groups, ignoring settled ones', () => {
    const summary = parseChecks(doc, opts())
    if (summary.status !== 'ok') throw new Error(summary.reason)

    // 6 in progress + 2 pending. 13 skipped and 12 successful are settled.
    expect(summary.pending).toBe(8)
    expect(summary.groups.map((g) => [g.label, g.state, g.count])).toEqual([
      ['pending checks', 'pending', 2],
      ['in progress checks', 'in_progress', 6],
      ['skipped checks', 'skipped', 13],
      ['successful checks', 'successful', 12],
    ])
  })

  it('counts the "expected" rows GitHub files under a "pending checks" group', () => {
    const summary = parseChecks(doc, opts())
    if (summary.status !== 'ok') throw new Error(summary.reason)

    // The rows read "Expected — Waiting for status to be reported" and the
    // headline says "2 expected", but the group word is "pending". Only the
    // group word reaches the parser, so these are counted — which matches
    // GitHub's own "Some checks haven't completed yet".
    const group = summary.groups.find((g) => g.label === 'pending checks')
    expect(group?.items.map((i) => i.name)).toEqual(['Jest', 'E2E Tests'])
  })

  it('reports no AI reviewers pending when the bots have all reported', () => {
    const summary = parseChecks(doc, opts())
    if (summary.status !== 'ok') throw new Error(summary.reason)

    // CodeRabbit, Devin and Warden are successful; Claude Code was skipped.
    // Nothing here should make requesting a human review premature.
    expect(summary.pendingAiReviews).toBe(0)
    expect(summary.pendingChecks).toBe(8)
  })

  it('does not mistake an approval for a pending review', () => {
    const summary = parseChecks(doc, opts({ includeOtherReviews: true }))
    if (summary.status !== 'ok') throw new Error(summary.reason)

    // The Reviews group reads "1 approval", not "1 pending review". Matching it
    // would add a phantom reviewer to an already-approved PR.
    expect(summary.pendingOtherReviews).toBe(0)
    expect(summary.unattributedReviews).toBe(0)
  })

  it('still reads counts from headers when rows are trimmed away', () => {
    const summary = parseChecks(doc, opts())
    if (summary.status !== 'ok') throw new Error(summary.reason)
    const inProgress = summary.groups.find((g) => g.state === 'in_progress')

    // 6 in the header, 2 rows rendered. Rows only split the total.
    expect(inProgress?.count).toBe(6)
    expect(inProgress?.items).toHaveLength(2)
  })

  it('cross-checks cleanly against the section headline', () => {
    const summary = parseChecks(doc, opts())
    if (summary.status !== 'ok') throw new Error(summary.reason)
    // Headline "6 in progress, 13 skipped, 2 expected, 12 successful" = 33.
    expect(summary.groups.reduce((n, g) => n + g.count, 0)).toBe(33)
  })
})
