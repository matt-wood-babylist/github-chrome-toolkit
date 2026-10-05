let enabled = false

export function setDebug(value: boolean): void {
  enabled = value
}

export function log(...args: unknown[]): void {
  if (enabled) console.log('[pending-checks]', ...args)
}

/** Always shown: something the user may need to act on (auth, selector drift). */
export function warn(...args: unknown[]): void {
  console.warn('[pending-checks]', ...args)
}
