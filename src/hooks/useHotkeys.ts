import { useEffect, useRef, type RefObject } from 'react'

export interface HotkeyConfig {
  key: string
  /**
   * Cmd on macOS, Ctrl elsewhere -- the platform-correct primary modifier.
   *
   * The old config had separate `ctrl` and `meta` booleans and every shortcut
   * was registered with `ctrl: true`. On macOS Cmd sets `metaKey`, not
   * `ctrlKey`, so NONE of the in-app shortcuts fired there at all.
   */
  mod?: boolean
  alt?: boolean
  shift?: boolean
  callback: (event: KeyboardEvent) => void
  description?: string
  /** Allow while a text field has focus. Default false. */
  allowInInput?: boolean
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

function primaryModifier(event: KeyboardEvent): boolean {
  return isMac ? event.metaKey : event.ctrlKey
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  )
}

export function useHotkeys(hotkeys: HotkeyConfig[]): void {
  // Held in a ref so callers can pass a fresh array literal each render without
  // the document listener being removed and re-added every single render, which
  // is what the previous implementation did.
  const latest = useRef(hotkeys)
  latest.current = hotkeys

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      for (const hotkey of latest.current) {
        if (event.key.toLowerCase() !== hotkey.key.toLowerCase()) continue
        if (!!hotkey.mod !== primaryModifier(event)) continue
        if (!!hotkey.alt !== event.altKey) continue
        if (!!hotkey.shift !== event.shiftKey) continue
        if (!hotkey.allowInInput && isTextEntry(event.target)) continue

        event.preventDefault()
        hotkey.callback(event)
        return
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])
}

export interface GlobalHotkeyOptions {
  searchInputRef: RefObject<HTMLInputElement>
  onStartIndexing?: () => void
}

/**
 * App-wide shortcuts.
 *
 * Focus targets come from a ref, not `document.querySelector('input[type="text"]')`.
 * That selector matched nothing: `ui/input.tsx` renders `type={type}` and no
 * call site ever passed a `type`, so React omitted the attribute entirely --
 * meaning Ctrl+K, the most important shortcut in a search app, silently did
 * nothing.
 */
export function useGlobalHotkeys({ searchInputRef, onStartIndexing }: GlobalHotkeyOptions): void {
  const focusSearch = () => {
    searchInputRef.current?.focus()
    searchInputRef.current?.select()
  }

  useHotkeys([
    { key: 'k', mod: true, callback: focusSearch, description: 'Focus search', allowInInput: true },
    { key: 'f', mod: true, callback: focusSearch, description: 'Focus search', allowInInput: true },
    {
      key: 'n',
      mod: true,
      callback: () => onStartIndexing?.(),
      description: 'Start indexing',
    },
  ])
}
