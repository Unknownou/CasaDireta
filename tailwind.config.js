/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './js/**/*.js'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#0F766E', light: '#10B981', dark: '#115E59' },
        ink: '#0F172A',
        app: '#F8FAFC'
      },
      fontFamily: { sans: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', 'sans-serif'] }
    }
  },
  plugins: []
};
