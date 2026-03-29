import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "ui",
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      "/api": "http://localhost:1998",
      "/proxy": "http://localhost:1998",
    },
  },
  build: {
    outDir: "../ui-dist",
    emptyOutDir: true,
  },
});
