/** @type {import('tailwindcss').Config} */

/* ──────────────────────────────────────────────────────────────────────────
 * ClawX Tailwind design tokens
 * ──────────────────────────────────────────────────────────────────────────
 *
 * This config layers ClawX's own visual language on top of shadcn/ui:
 *
 *   1. fontFamily — All three stacks (sans / serif / mono) are pinned
 *      explicitly so we never silently inherit Tailwind's evolving defaults.
 *      This locks the rendering on macOS, Windows, and Linux to the same
 *      glyph sources we ship to designers.
 *
 *   2. fontSize — We only *add* missing rungs to Tailwind's default scale.
 *      All new tokens come from the orphan pixel values (10/11/13/17/40px)
 *      that occurred most often in the codebase. Naming is semantic
 *      (`meta`, `tiny`, `subtitle`, `2xs`, `stat`) so a future density
 *      change only touches this file.
 *
 *   3. colors — On top of shadcn's semantic tokens (primary / destructive /
 *      ...) we add three ClawX-private groups:
 *        - brand        : Apple-system blue used for primary CTAs
 *        - skill        : highlight blue for inline /skill chips in chat
 *        - surface.{modal,input,sidebar}: a 3-layer neutral background
 *                          system in light mode. In dark mode each layer
 *                          collapses to an existing shadcn token through
 *                          CSS variables, so callers don't need to write
 *                          `dark:bg-card` style double-declarations.
 *
 *   4. Naming — All ClawX-private tokens live under their own top-level
 *      key (`brand`, `skill`, `surface`) instead of being merged into
 *      the root `colors` namespace, so they're trivially distinguishable
 *      from shadcn semantic tokens.
 *
 * Usage references:
 *     - Sizes        : see fontSize block below
 *     - Colors       : see colors block below
 *     - CSS variables: src/styles/globals.css
 *
 * ────────────────────────────────────────────────────────────────────────── */

module.exports = {
  darkMode: ['class'],
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    './node_modules/streamdown/dist/*.js',
    './node_modules/@streamdown/code/dist/*.js',
    './node_modules/@streamdown/math/dist/*.js',
    './node_modules/@streamdown/cjk/dist/*.js',
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      // Desktop-density headings: shrink default Tailwind steps so existing
      // `text-2xl`…`text-6xl` classes stay in TSX without per-page refactors.
      fontSize: {
        '2xs': ['10px', { lineHeight: '14px' }],
        tiny: ['11px', { lineHeight: '16px' }],
        meta: ['13px', { lineHeight: '18px' }],
        subtitle: ['17px', { lineHeight: '24px' }],
        '2xl': ['1.3125rem', { lineHeight: '1.75rem' }],
        '3xl': ['1.5rem', { lineHeight: '2rem' }],
        '4xl': ['1.875rem', { lineHeight: '2.25rem' }],
        '5xl': ['2rem', { lineHeight: '2.5rem' }],
        '6xl': ['2.25rem', { lineHeight: '2.5rem' }],
        stat: ['40px', { lineHeight: '1' }],
      },
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          '"Noto Sans"',
          'sans-serif',
        ],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
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
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // Secondary warm accent (gold) — for gradient stops + small highlights
        'accent-gold': 'hsl(var(--accent-gold))',
        skill: {
          bg: '#2F6BFF',
          fg: '#1D4ED8',
          'fg-dark': '#2563EB',
        },

        // ── C. ClawX neutral surfaces ────────────────────────────────
        // We use `<alpha-value>` placeholders so Tailwind auto-emits
        // `bg-surface-xxx/{alpha}` rules. Concrete pixel values live in
        // globals.css; in dark mode the same CSS variables redirect to
        // shadcn's existing dark tokens to avoid maintaining a second
        // dark surface palette.
        surface: {
          modal: 'hsl(var(--surface-modal) / <alpha-value>)',
          input: 'hsl(var(--surface-input) / <alpha-value>)',
          sidebar: 'hsl(var(--surface-sidebar) / <alpha-value>)',
        },

        // ── D. ClawX usage accents ──────────────────────────────────
        // Semantic chart palette shared by the Models token-usage
        // visualisation and any future input/output/cache indicator.
        // Mirrors Cron's stat-tile palette (blue / green / yellow).
        // Values live in globals.css; dark mode brightens each one.
        usage: {
          input: 'hsl(var(--usage-input) / <alpha-value>)',
          output: 'hsl(var(--usage-output) / <alpha-value>)',
          cache: 'hsl(var(--usage-cache) / <alpha-value>)',
        },
      },
      backgroundImage: {
        // YYClaw brand gradient: coral primary → gold accent
        'brand-gradient':
          'linear-gradient(135deg, hsl(var(--primary)), hsl(var(--accent-gold)))',
      },
      boxShadow: {
        // Layered soft shadows to replace the flat default shadow-sm
        soft: '0 1px 2px rgb(0 0 0 / 0.04), 0 2px 8px rgb(0 0 0 / 0.04)',
        elevated: '0 2px 4px rgb(0 0 0 / 0.05), 0 8px 24px rgb(0 0 0 / 0.07)',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
