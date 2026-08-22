/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        background: "var(--background)",
        foreground: "var(--foreground)",
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        sidebar: {
          DEFAULT: "var(--sidebar)",
          foreground: "var(--sidebar-foreground)",
          primary: "var(--sidebar-primary)",
          "primary-foreground": "var(--sidebar-primary-foreground)",
          accent: "var(--sidebar-accent)",
          "accent-foreground": "var(--sidebar-accent-foreground)",
          border: "var(--sidebar-border)",
          ring: "var(--sidebar-ring)",
        },
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
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        card: "32px"
      }
    },
  },
  plugins: [],
};
