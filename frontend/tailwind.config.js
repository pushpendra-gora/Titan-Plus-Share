export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      colors: {
        primary: {
          DEFAULT: '#5865E9',
          light: '#EEF1FF',
          dark: '#4752C4',
          50: '#f5f6ff',
          100: '#eef1ff',
          200: '#dce1ff',
          500: '#5865E9',
          600: '#4c57d8',
          700: '#3f47c0',
        },
        titan: {
          bg: '#F8F9FD',
          card: '#FFFFFF',
          text: '#151B2D',
          muted: '#788395',
          border: '#E8EBF3',
          success: '#16A05A',
          danger: '#F16B72',
          purple: '#8755E8',
          'purple-light': '#F4EFFF',
          'rose-light': '#FFF0F2',
          'emerald-light': '#E8FAF0',
          'amber-light': '#FFF8EB',
        },
        brand: {
          50: '#EEF1FF',
          100: '#dce1ff',
          500: '#5865E9',
          600: '#4c57d8',
          700: '#3f47c0',
          primary: '#5865E9',
          accent: '#8755E8'
        }
      },
      boxShadow: {
        'titan': '0 8px 24px rgba(21, 27, 45, 0.04)',
        'titan-md': '0 12px 32px rgba(21, 27, 45, 0.06)',
        'titan-lg': '0 18px 48px rgba(21, 27, 45, 0.08)',
        'titan-modal': '0 24px 64px rgba(21, 27, 45, 0.14)',
        'card': '0 8px 24px rgba(21, 27, 45, 0.04)',
        'card-hover': '0 14px 36px rgba(88, 101, 233, 0.10)',
        'modal': '0 24px 64px rgba(21, 27, 45, 0.14)'
      },
      borderRadius: {
        'card': '24px',
        'modal': '28px',
        '2xl': '20px',
        '3xl': '24px',
        '4xl': '28px',
        '5xl': '32px'
      }
    },
  },
  plugins: [],
}
