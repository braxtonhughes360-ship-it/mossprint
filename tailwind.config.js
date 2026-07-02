/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  safelist: [],
  theme: {
    extend: {
      colors: {
        canvas: {
          DEFAULT: '#e2e6e2',
          field: '#d8e0da',
          groove: '#c8d2ca',
          deep: '#bcc6be'
        },
        surface: {
          DEFAULT: '#f6f7f5',
          raised: '#fcfcfb',
          muted: '#eceee9',
          chassis: '#0a0e0c',
          'chassis-mid': '#121916'
        },
        ink: {
          DEFAULT: 'var(--moss-text-primary)',
          display: 'var(--moss-text-display)',
          secondary: 'var(--moss-text-secondary)',
          muted: 'var(--moss-text-muted)',
          faint: 'var(--moss-text-faint)',
          inverse: 'var(--moss-ink-inverse)'
        },
        moss: {
          field: '#d8e9de',
          celadon: '#b0d4be',
          sage: '#4f7a64',
          smoke: '#26362d',
          olive: '#1a2e24',
          pulse: '#c8f04a',
          'pulse-hot': '#deff63',
          mineral: '#101c16'
        },
        border: {
          DEFAULT: '#c8d1ca',
          strong: '#a8b5ac',
          hairline: '#dde4de',
          focus: '#c8f04a'
        },
        signal: {
          error: '#fdf0ee',
          'error-text': '#8f3d36',
          ok: '#eef5f0',
          'ok-text': '#2d5a42'
        }
      },
      fontFamily: {
        sans: ['Cabinet Grotesk', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        display: ['Cabinet Grotesk', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        body: ['Cabinet Grotesk', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        identity: ['Cabinet Grotesk', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']
      },
      boxShadow: {
        sculpt:
          '0 0 0 1px rgba(14,20,17,0.06), inset 0 1px 0 rgba(255,255,255,0.98), inset 0 -1px 0 rgba(14,20,17,0.08), 0 1px 2px rgba(14,20,17,0.05), 0 20px 48px rgba(14,20,17,0.12)',
        lift:
          '0 0 0 1px rgba(14,20,17,0.07), inset 0 1px 0 rgba(255,255,255,1), inset 0 -1px 0 rgba(14,20,17,0.06), 0 2px 4px rgba(14,20,17,0.06), 0 12px 28px rgba(14,20,17,0.1), 0 40px 80px rgba(14,20,17,0.14)',
        press:
          'inset 0 4px 14px rgba(14,20,17,0.18), inset 0 1px 0 rgba(255,255,255,0.3), 0 0 0 1px rgba(14,20,17,0.05)',
        depth:
          '0 1px 3px rgba(14,20,17,0.08), 0 16px 40px rgba(14,20,17,0.12), 0 48px 96px rgba(14,20,17,0.1)',
        rim: 'inset 0 1px 0 rgba(255,255,255,0.95), inset 0 -1px 0 rgba(14,20,17,0.08)',
        contact:
          '0 0 0 1px rgba(14,20,17,0.05), 0 1px 1px rgba(14,20,17,0.04), 0 6px 16px rgba(14,20,17,0.08)',
        ao: 'inset 0 -12px 24px rgba(14,20,17,0.06)',
        chassis:
          'inset 1px 0 0 rgba(255,255,255,0.08), inset -1px 0 0 rgba(0,0,0,0.35), 4px 0 24px rgba(0,0,0,0.2), 12px 0 64px rgba(0,0,0,0.22)',
        pulse:
          '0 0 0 1px rgba(200,240,74,0.4), inset 0 1px 0 rgba(255,255,255,0.08), 0 4px 20px rgba(200,240,74,0.14), 0 20px 48px rgba(200,240,74,0.06)',
        brand:
          '0 0 0 1px rgba(255,255,255,0.06), 0 4px 12px rgba(0,0,0,0.35), 0 20px 40px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.12)'
      },
      backgroundImage: {
        'moss-pulse': 'linear-gradient(180deg, #deff63 0%, #c8f04a 35%, #4f7a64 100%)',
        'moss-pulse-h': 'linear-gradient(90deg, #deff63 0%, #4f7a64 55%, #1a2e24 100%)',
        'chassis-slab':
          'linear-gradient(165deg, #1f3328 0%, #141c18 45%, #0a0e0c 100%)',
        'chassis-face':
          'linear-gradient(180deg, #121916 0%, #0a0e0c 100%)',
        'hero-field':
          'linear-gradient(155deg, #fdfefd 0%, #f6faf7 38%, #eaf2ec 72%, #dde8e2 100%)',
        'stage-canvas':
          'radial-gradient(ellipse 100% 80% at 18% -8%, rgba(255,255,255,0.85) 0%, transparent 52%), radial-gradient(ellipse 70% 50% at 95% 100%, rgba(14,20,17,0.07) 0%, transparent 50%), linear-gradient(180deg, #e2e6e2 0%, #d8ddd8 100%)',
        'stage-vignette':
          'radial-gradient(ellipse 120% 100% at 50% 50%, transparent 55%, rgba(14,20,17,0.06) 100%)',
        'panel-sheen':
          'linear-gradient(180deg, rgba(255,255,255,0.7) 0%, transparent 28%)',
        groove:
          'repeating-linear-gradient(90deg, transparent, transparent 4px, rgba(14,20,17,0.035) 4px, rgba(14,20,17,0.035) 5px)'
      },
      keyframes: {
        'route-enter': {
          '0%': { opacity: '0', transform: 'translateY(16px) scale(0.988)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' }
        },
        'tile-in': {
          '0%': { opacity: '0', transform: 'translateY(20px) scale(0.975)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' }
        },
        'emblem-breathe': {
          '0%, 100%': { opacity: '0.75' },
          '50%': { opacity: '1' }
        },
        'row-in': {
          '0%': { opacity: '0', transform: 'translateX(-8px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' }
        },
        'moss-drift-a': {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '50%': { transform: 'translate(-12px, 8px) scale(1.04)' }
        },
        'moss-drift-b': {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '50%': { transform: 'translate(16px, -10px) scale(0.96)' }
        },
        'moss-drift-c': {
          '0%, 100%': { transform: 'translate(0, 0)' },
          '50%': { transform: 'translate(-8px, -6px)' }
        },
        'moss-drift-d': {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '50%': { transform: 'translate(6px, 4px) scale(1.02)' }
        },
        'moss-strand': {
          '0%, 100%': { strokeOpacity: '0.12' },
          '50%': { strokeOpacity: '0.22' }
        }
      },
      animation: {
        'route-enter': 'route-enter 0.62s cubic-bezier(0.22, 1, 0.36, 1) both',
        'row-in': 'row-in 0.55s cubic-bezier(0.22, 1, 0.36, 1) both'
      },
      transitionTimingFunction: {
        tactile: 'cubic-bezier(0.22, 1, 0.36, 1)',
        spring: 'cubic-bezier(0.34, 1.45, 0.64, 1)',
        premium: 'cubic-bezier(0.16, 1, 0.3, 1)'
      },
      transitionDuration: {
        260: '260ms',
        320: '320ms',
        420: '420ms'
      }
    }
  },
  plugins: []
}
