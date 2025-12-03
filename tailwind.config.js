/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // 大人っぽいライトモードカラーパレット
        primary: {
          50: '#f8f7f4',
          100: '#f0ede6',
          200: '#e0d9cc',
          300: '#cdc2ad',
          400: '#b8a78c',
          500: '#a89272',
          600: '#9a8164',
          700: '#806a54',
          800: '#695748',
          900: '#57493d',
          950: '#2e261f',
        },
        accent: {
          50: '#faf5f2',
          100: '#f4e9e1',
          200: '#e9d2c2',
          300: '#dab49a',
          400: '#c99170',
          500: '#bd7652',
          600: '#af6347',
          700: '#924f3c',
          800: '#764236',
          900: '#60382e',
          950: '#331b17',
        },
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
        sans: ['Inter', 'Noto Sans JP', 'sans-serif'],
        display: ['Playfair Display', 'Noto Serif JP', 'serif'],
      },
      boxShadow: {
        'soft': '0 2px 15px -3px rgba(0, 0, 0, 0.07), 0 10px 20px -2px rgba(0, 0, 0, 0.04)',
        'elegant': '0 4px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 30px -5px rgba(0, 0, 0, 0.05)',
      },
    },
  },
  plugins: [],
}

