export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
          primary: '#2563eb',
          accent: '#0284c7',
          cyan: '#06b6d4'
        }
      },
      boxShadow: {
        'card': '0 10px 30px rgba(37, 99, 235, 0.07)',
        'card-hover': '0 14px 36px rgba(37, 99, 235, 0.12)',
        'modal': '0 20px 50px rgba(15, 23, 42, 0.12)'
      },
      borderRadius: {
        'card': '20px',
        'modal': '24px'
      }
    },
  },
  plugins: [],
}
