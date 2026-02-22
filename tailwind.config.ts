import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        void: '#06070b',
        deep: '#0c0e16',
        surface: '#131620',
        raised: '#1a1e2e',
        gold: {
          DEFAULT: '#c9a227',
          dim: '#a68520',
          glow: 'rgba(201, 162, 39, 0.15)',
        },
      },
      fontFamily: {
        sans: ['var(--font-outfit)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-dm-mono)', 'Courier New', 'monospace'],
      },
    },
  },
  plugins: [],
};
export default config;
