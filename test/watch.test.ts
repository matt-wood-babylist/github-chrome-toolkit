import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { parseChecks } from '../src/detect/parse-checks'
import { MERGE_BOX } from '../src/detect/selectors'
import { watchMergeBox } from '../src/detect/watch'
import { DEFAULT_OPTIONS } from '../src/shared/types'

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures')

/**
 * Mount into the real document so MutationObserver has a live tree to watch.
 * Parsed and imported rather than assigned via innerHTML — the same discipline
 * the banner uses, since fixture markup is a stand-in for scraped HTML.
 */
function mount(name: string): Element {
  const html = readFileSync(resolve(fixtures, name), 'utf8')
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  const box = parsed.querySelector(MERGE_BOX)
  if (!box) throw new Error(`no merge box in ${name}`)
  document.body.replaceChildren(document.importNode(box, true))
  return document.querySelector(MERGE_BOX)!
}

/** Let the observer's microtask and the debounce timer both drain. */
const settle = () => new Promise((r) => setTimeout(r, 5))

const observers: MutationObserver[] = []
function watch(box: Element, onChange: () => void): void {
  observers.push(watchMergeBox(box, onChange, 0))
}

afterEach(() => {
  for (const observer of observers.splice(0)) observer.disconnect()
  document.body.replaceChildren()
})

describe('watchMergeBox', () => {
  it('fires when a group count is rewritten in place', async () => {
    const box = mount('in-progress.synthetic.html')
    let fired = 0
    watch(box, () => fired++)

    // React updates the header's aria-label without adding or removing nodes.
    // This is the case a childList-only observer would miss entirely.
    const header = box.querySelector('button[aria-controls="g_ip"]')
    header?.setAttribute('aria-label', 'Collapse 1 in progress checks group')
    await settle()

    expect(fired).toBe(1)

    const summary = parseChecks(document, DEFAULT_OPTIONS)
    if (summary.status !== 'ok') throw new Error(summary.reason)
    // 1 in progress + 1 queued. Note the button's visible text still reads
    // "2 in progress checks" — reading aria-label first is what makes this work.
    expect(summary.pending).toBe(2)
  })

  it('fires when a whole group is removed', async () => {
    const box = mount('in-progress.synthetic.html')
    let fired = 0
    watch(box, () => fired++)

    box.querySelector('button[aria-controls="g_q"]')?.remove()
    box.querySelector('div[aria-label="queued checks"]')?.remove()
    await settle()

    expect(fired).toBeGreaterThan(0)
    const summary = parseChecks(document, DEFAULT_OPTIONS)
    if (summary.status !== 'ok') throw new Error(summary.reason)
    expect(summary.pending).toBe(2)
  })

  it('fires when a check row disappears', async () => {
    const box = mount('in-progress.synthetic.html')
    let fired = 0
    watch(box, () => fired++)

    box.querySelector('div[aria-label="in progress checks"] li')?.remove()
    await settle()

    expect(fired).toBe(1)
  })

  it('coalesces mutations arriving in separate ticks into one refresh', async () => {
    const box = mount('in-progress.synthetic.html')
    let fired = 0
    // A real debounce window: MutationObserver already batches same-task
    // mutations by itself, so only separate ticks prove the debounce works.
    observers.push(watchMergeBox(box, () => fired++, 60))

    box.querySelector('button[aria-controls="g_ip"]')?.setAttribute('aria-label', 'Collapse 2 in progress checks group')
    await new Promise((r) => setTimeout(r, 15))
    box.querySelector('button[aria-controls="g_q"]')?.setAttribute('aria-label', 'Collapse 1 queued checks group')
    await new Promise((r) => setTimeout(r, 15))

    expect(fired).toBe(0) // still inside the window

    await new Promise((r) => setTimeout(r, 90))
    expect(fired).toBe(1) // both bursts, one refresh
  })

  it('ignores attribute churn we do not care about', async () => {
    const box = mount('in-progress.synthetic.html')
    let fired = 0
    watch(box, () => fired++)

    // The merge box constantly rewrites these; re-parsing for them is waste.
    const header = box.querySelector('button[aria-controls="g_ip"]') as HTMLElement | null
    header?.setAttribute('class', 'prc-Button-ButtonBase-9n-Xk hovered')
    header?.setAttribute('style', 'anchor-name: --anchored-overlay-anchor-x')
    header?.setAttribute('data-loading', 'true')
    await settle()

    expect(fired).toBe(0)
  })

  it('stops firing once disconnected', async () => {
    const box = mount('in-progress.synthetic.html')
    let fired = 0
    const observer = watchMergeBox(box, () => fired++, 0)
    observer.disconnect()

    box.querySelector('button[aria-controls="g_ip"]')?.setAttribute('aria-label', 'Collapse 1 in progress checks group')
    await settle()

    expect(fired).toBe(0)
  })
})
