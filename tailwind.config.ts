import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        paper: {
          DEFAULT: "#FAF7F0",
          soft: "#F3EEE2",
          line: "#E4DCC7",
        },
        ink: {
          DEFAULT: "#1E2233",
          soft: "#4A4F63",
          faint: "#83879A",
        },
        wine: {
          50: "#FBEEF1",
          100: "#F3D3DC",
          200: "#E4A6B7",
          300: "#D07994",
          400: "#B84D6E",
          500: "#9C2B4E",
          600: "#83203F",
          700: "#671832",
          800: "#4B1225",
          900: "#310B18",
        },
        brass: {
          50: "#FBF6E9",
          100: "#F3E6BF",
          200: "#E6CD8B",
          300: "#D8B462",
          400: "#C9A24B",
          500: "#AD8636",
          600: "#8A6A2A",
        },
        moss: {
          50: "#EBF3EE",
          100: "#CFE4D8",
          400: "#4C9270",
          500: "#3F7D58",
          600: "#2F6244",
        },
        clay: {
          500: "#B4472F",
          600: "#973A26",
        },
      },
      fontFamily: {
        serif: [
          "Iowan Old Style",
          "Palatino Linotype",
          "URW Palladio L",
          "P052",
          "Georgia",
          "serif",
        ],
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Inter",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      borderRadius: {
        sm: "3px",
        DEFAULT: "6px",
        md: "8px",
        lg: "14px",
        xl: "22px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(30,34,51,0.06), 0 1px 1px rgba(30,34,51,0.04)",
        lifted: "0 8px 24px rgba(30,34,51,0.10)",
      },
      backgroundImage: {
        "seal-ring": "radial-gradient(circle at 30% 30%, rgba(156,43,78,0.16), transparent 60%)",
      },
      maxWidth: {
        prose: "68ch",
      },
      keyframes: {
        "unfold": {
          "0%": { transform: "scaleY(0)", opacity: "0" },
          "100%": { transform: "scaleY(1)", opacity: "1" },
        },
        "rise": {
          "0%": { transform: "translateY(6px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
      },
      animation: {
        unfold: "unfold 420ms cubic-bezier(0.22,1,0.36,1)",
        rise: "rise 420ms cubic-bezier(0.22,1,0.36,1)",
      },
    },
  },
  plugins: [],
};

export default config;
