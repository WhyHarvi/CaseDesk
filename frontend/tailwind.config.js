/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f4f7fb",
          100: "#e7eef7",
          200: "#cddcec",
          300: "#a8c0dd",
          400: "#7f9fc9",
          500: "#5d82b2",
          600: "#496895",
          700: "#3d5578",
          800: "#364864",
          900: "#313d54"
        },
        chk: {
          DEFAULT: "#0067b8",
          light: "#3fa1e8"
        }
      },
      boxShadow: {
        panel: "0 18px 40px -24px rgba(28, 45, 74, 0.45)"
      },
      fontFamily: {
        heading: ["Instrument Serif", "serif"],
        body: ["Barlow", "sans-serif"],
        sans: ["Inter", "sans-serif"]
      },
      borderRadius: {
        card: "32px"
      }
    },
  },
  plugins: [],
};

