import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "var(--ink)",
        panel: "var(--panel)",
        raised: "var(--raised)",
        line: "var(--line)",
        text: "var(--text)",
        muted: "var(--muted)",
        faint: "var(--faint)",
        amber: "var(--amber)",
        "amber-dim": "var(--amber-dim)",
        edge: "var(--edge)",
        risk: "var(--risk)",
        warn: "var(--warn)",
        cool: "var(--cool)",
      },
      fontFamily: {
        mono: [
          "ui-monospace",
          "JetBrains Mono",
          "SF Mono",
          "Menlo",
          "Consolas",
          "monospace",
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
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "0.9rem", letterSpacing: "0.04em" }],
      },
      borderRadius: {
        term: "10px",
      },
      boxShadow: {
        panel: "0 1px 0 0 rgba(255,255,255,0.02) inset, 0 8px 24px -12px rgba(0,0,0,0.6)",
        glow: "0 0 0 1px var(--amber-dim), 0 0 24px -8px var(--amber)",
      },
      keyframes: {
        "pulse-dot": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
        "meter-fill": {
          from: { transform: "scaleX(0)" },
          to: { transform: "scaleX(1)" },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "pulse-dot": "pulse-dot 1.8s ease-in-out infinite",
        "meter-fill": "meter-fill 0.7s cubic-bezier(0.22,1,0.36,1) both",
        "fade-up": "fade-up 0.4s ease both",
      },
    },
  },
  plugins: [],
};

export default config;
