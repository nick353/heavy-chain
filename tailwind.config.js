/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 高級感のある背景色
        surface: {
          50: '#f9f9f7', // 陶磁器のような白
          100: '#f2f2ee',
          200: '#e6e6e0',
          300: '#d5d5cc',
          400: '#bcbcb0',
          500: '#a0a093',
          600: '#7f7f73',
          700: '#66665c',
          800: '#52524a',
          900: '#45453e',
          950: '#0f0f0d', // 漆黒に近いグレー
        },
        // プライマリ: シャンパンゴールド/ブロンズ系
        primary: {
          50: '#fbf8f3',
          100: '#f5eee2',
          200: '#eaddc3',
          300: '#dec299',
          400: '#d0a370',
          500: '#c58851', // メインのゴールド/ブロンズ
          600: '#b76e42',
          700: '#985437',
          800: '#7d4432',
          900: '#65392c',
          950: '#361c16',
        },
        // アクセント: 深みのあるバーガンディ/ワインレッド
        accent: {
          50: '#fcf4f4',
          100: '#f8e5e5',
          200: '#f2cfcf',
          300: '#e8adad',
          400: '#d97e7e',
          500: '#c85656',
          600: '#b03a3a',
          700: '#932b2b', // 深い赤
          800: '#7a2626',
          900: '#662424',
          950: '#380e0e',
        },
        // ゴールドアクセント（特別なハイライト用）
        gold: {
          light: '#F3E5AB',
          DEFAULT: '#D4AF37',
          dark: '#AA8C2C',
          metallic: '#C5B358',
        },
        // ニュートラル（文字色など）
        neutral: {
          50: '#fafafa',
          100: '#f5f5f5',
          200: '#e5e5e5',
          300: '#d4d4d4',
          400: '#a3a3a3',
          500: '#737373',
          600: '#525252',
          700: '#404040',
          800: '#262626',
          900: '#171717',
          950: '#0a0a0a',
        }
      },
      fontFamily: {
        sans: ['Inter', 'Montserrat', 'Noto Sans JP', 'sans-serif'],
        serif: ['Playfair Display', 'Cormorant Garamond', 'Noto Serif JP', 'serif'],
        display: ['Playfair Display', 'serif'], // 見出し用
      },
      letterSpacing: {
        'widest-plus': '0.2em', // 高級感を出すために文字間隔を広げる
      },
      boxShadow: {
        'soft': '0 4px 20px -2px rgba(0, 0, 0, 0.05)',
        'elegant': '0 10px 40px -10px rgba(0, 0, 0, 0.08)',
        'floating': '0 20px 60px -15px rgba(0, 0, 0, 0.12)',
        'glass': '0 8px 32px 0 rgba(31, 38, 135, 0.07)', // グラスモーフィズム用
        'glow': '0 0 15px rgba(212, 175, 55, 0.3)', // ゴールドの輝き
      },
      backgroundImage: {
        'luxury-gradient': 'linear-gradient(135deg, #fbf8f3 0%, #f5eee2 100%)',
        'gold-gradient': 'linear-gradient(135deg, #D4AF37 0%, #AA8C2C 100%)',
        'dark-luxury': 'linear-gradient(135deg, #1a1a1a 0%, #0a0a0a 100%)',
      },
      animation: {
        'fade-in': 'fadeIn 0.8s cubic-bezier(0.4, 0, 0.2, 1)',
        'fade-in-up': 'fadeInUp 0.8s cubic-bezier(0.4, 0, 0.2, 1)',
        'slide-in-right': 'slideInRight 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
        'scale-slow': 'scaleSlow 10s linear infinite alternate',
        'shimmer': 'shimmer 2.5s linear infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideInRight: {
          '0%': { opacity: '0', transform: 'translateX(20px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        scaleSlow: {
          '0%': { transform: 'scale(1)' },
          '100%': { transform: 'scale(1.05)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-1000px 0' },
          '100%': { backgroundPosition: '1000px 0' },
        },
      },
      backdropBlur: {
        'xs': '2px',
      }
    },
  },
  plugins: [],
}
