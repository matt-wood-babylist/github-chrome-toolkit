export type PrTab = 'conversation' | 'files' | 'commits' | 'checks'

export type PrContext = {
  owner: string
  repo: string
  number: number
  tab: PrTab
}

/**
 * /owner/repo/pull/123            -> conversation
 * /owner/repo/pull/123/files      -> files
 * /owner/repo/pull/123/commits/ab -> commits  (trailing segments allowed)
 */
const PR_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/(files|commits|checks)(?:\/.*)?)?\/?$/

export function parsePrContext(pathname: string): PrContext | null {
  const match = PR_PATH.exec(pathname)
  if (!match) return null
  const [, owner, repo, number, tab] = match
  if (!owner || !repo || !number) return null
  return {
    owner,
    repo,
    number: Number(number),
    tab: (tab as PrTab | undefined) ?? 'conversation',
  }
}

export function conversationUrl(ctx: PrContext): string {
  return `https://github.com/${ctx.owner}/${ctx.repo}/pull/${ctx.number}`
}

/** Same pull request, ignoring which tab is open. */
export function samePr(a: PrContext | null, b: PrContext | null): boolean {
  if (!a || !b) return a === b
  return a.owner === b.owner && a.repo === b.repo && a.number === b.number
}
