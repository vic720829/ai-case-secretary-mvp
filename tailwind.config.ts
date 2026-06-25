import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      boxShadow: {
        panel: "0 1px 2px rgba(20, 24, 31, 0.06), 0 12px 28px rgba(20, 24, 31, 0.06)"
      }
    }
  },
  plugins: []
};

export default config;
