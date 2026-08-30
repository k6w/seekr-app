/** @type {import('tailwindcss').Config} */
export default {
  /**
   * Class-driven, not media-driven.
   *
   * This was missing entirely, which meant every `dark:` utility in the
   * codebase followed the OS setting while `useTheme` toggled a `.dark` class
   * nothing responded to — so the in-app theme switch silently did nothing for
   * any component that used a `dark:` variant.
   */
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',

        // Raised surfaces read as raised because they are lighter than the
        // ground. The old tokens set --card equal to --background, so cards
        // were invisible except for a 1px border.
        surface: {
          DEFAULT: 'hsl(var(--surface))',
          2: 'hsl(var(--surface-2))',
        },

        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },

        // The one non-neutral. Reserved for match marks and the keyboard
        // cursor; see the accent rule in index.css.
        signal: {
          DEFAULT: 'hsl(var(--signal))',
          mark: 'hsl(var(--signal-mark))',
        },

        // Kept so the remaining shadcn-derived primitives still resolve.
        card: {
          DEFAULT: 'hsl(var(--surface))',
          foreground: 'hsl(var(--foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--surface))',
          foreground: 'hsl(var(--foreground))',
        },
      },

      fontFamily: {
        sans: ['var(--font-ui)'],
        mono: ['var(--font-mono)'],
      },

      /**
       * A dense, instrument-like scale. The old UI had no font tokens at all
       * and ran on Tailwind's web defaults, which are far too loose for a list
       * that needs to show real result counts.
       */
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.02em' }], // 11px — status, labels
        xs: ['0.75rem', { lineHeight: '1.05rem' }], // 12px — paths, metrics
        sm: ['0.8125rem', { lineHeight: '1.15rem' }], // 13px — filenames
        base: ['0.9375rem', { lineHeight: '1.4rem' }], // 15px — overlay input
        lg: ['1.0625rem', { lineHeight: '1.5rem' }],
        xl: ['1.25rem', { lineHeight: '1.75rem' }],
      },

      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 3px)',
      },

      // Depth comes from surface lightness and hairlines, not soft drop
      // shadows — except for the overlay, which genuinely floats.
      boxShadow: {
        overlay: '0 16px 48px -12px rgb(0 0 0 / 0.45), 0 0 0 1px hsl(var(--border))',
      },
    },
  },
  plugins: [],
}
