import { DEFAULT_OPTIONS, type Options } from './types'

const KEY = 'options'

export async function loadOptions(): Promise<Options> {
  const stored = await chrome.storage.sync.get(KEY)
  return { ...DEFAULT_OPTIONS, ...(stored[KEY] as Partial<Options> | undefined) }
}

export async function saveOptions(options: Options): Promise<void> {
  await chrome.storage.sync.set({ [KEY]: options })
}

export function watchOptions(onChange: (options: Options) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes[KEY]) return
    onChange({ ...DEFAULT_OPTIONS, ...(changes[KEY].newValue as Partial<Options> | undefined) })
  })
}
