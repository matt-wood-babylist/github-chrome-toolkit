import { debounce } from '../shared/debounce'

/**
 * What to watch inside the merge box.
 *
 * `childList` + `subtree` catches React swapping rows and whole groups in and
 * out. The attribute filter matters just as much and is easy to miss: the
 * authoritative count lives in a group header's `aria-label`
 * ("Collapse 3 in progress checks group"), and React can rewrite that in place
 * without any node being added or removed. Without `attributes` here, a count
 * ticking from 3 to 2 could go unnoticed.
 *
 * The filter is deliberately narrow — the merge box churns through plenty of
 * unrelated attribute changes (hover styles, popover ids, anchor names) that we
 * have no reason to re-parse for.
 */
export const MERGE_BOX_OBSERVER_INIT: MutationObserverInit = {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['aria-label', 'aria-expanded'],
}

/**
 * Watch a merge box for check-state changes.
 *
 * GitHub keeps this subtree live-updated on its own, so observing it gives
 * instant updates with no polling and no network requests. Caller owns the
 * returned observer and must disconnect it on navigation.
 */
export function watchMergeBox(box: Element, onChange: () => void, debounceMs = 250): MutationObserver {
  const observer = new MutationObserver(debounce(onChange, debounceMs))
  observer.observe(box, MERGE_BOX_OBSERVER_INIT)
  return observer
}
