/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx}',
    './src/components/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        'pastel-blue': '#AEC6CF',
        'pastel-green': '#7ca881',
        'soft-red': '#ff7c75',
        'deep-blue': '#09121b',
      },
      borderRadius: {
        '28': '28px',
      },
      backdropBlur: {
        xl: '20px',
      },
      boxShadow: {
        'glass-lg': '0 24px 70px rgba(0,0,0,0.5)',
      },
    },
  },
  plugins: [],
};
