import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // @agent-market/protocol hashes with node:crypto (it's shared with the
      // Node services and must not change). In the browser we back it with the
      // same SHA-256 from @noble/hashes so content hashes match byte-for-byte.
      "node:crypto": fileURLToPath(new URL("./src/lib/node-crypto-shim.ts", import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
});
