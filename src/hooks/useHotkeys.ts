import { useEffect, useCallback } from 'react';

interface HotkeyConfig {
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
  callback: () => void;
  description?: string;
}

export function useHotkeys(hotkeys: HotkeyConfig[]) {
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    for (const hotkey of hotkeys) {
      const keyMatches = event.key.toLowerCase() === hotkey.key.toLowerCase();
      const ctrlMatches = !!hotkey.ctrl === event.ctrlKey;
      const altMatches = !!hotkey.alt === event.altKey;
      const shiftMatches = !!hotkey.shift === event.shiftKey;
      const metaMatches = !!hotkey.meta === event.metaKey;

      if (keyMatches && ctrlMatches && altMatches && shiftMatches && metaMatches) {
        event.preventDefault();
        event.stopPropagation();
        hotkey.callback();
        break;
      }
    }
  }, [hotkeys]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);
}

// Global hotkey hook for the entire application
export function useGlobalHotkeys() {
  const hotkeys: HotkeyConfig[] = [
    {
      key: 'k',
      ctrl: true,
      callback: () => {
        // Focus search input
        const searchInput = document.querySelector('input[type="text"]') as HTMLInputElement;
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
      },
      description: 'Focus search'
    },
    {
      key: 'Escape',
      callback: () => {
        // Clear search or close modals
        const searchInput = document.querySelector('input[type="text"]') as HTMLInputElement;
        if (searchInput && searchInput.value) {
          searchInput.value = '';
          searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      },
      description: 'Clear search'
    },
    {
      key: 'f',
      ctrl: true,
      callback: () => {
        // Focus search input (alternative)
        const searchInput = document.querySelector('input[type="text"]') as HTMLInputElement;
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
      },
      description: 'Focus search (alternative)'
    },
    {
      key: 'n',
      ctrl: true,
      callback: () => {
        // Start new indexing
        const startButton = document.querySelector('[data-action="start-indexing"]') as HTMLButtonElement;
        if (startButton) {
          startButton.click();
        }
      },
      description: 'Start indexing'
    }
  ];

  useHotkeys(hotkeys);

  return hotkeys;
}
