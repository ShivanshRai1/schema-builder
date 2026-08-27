import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Builds to static assets so this can be hosted alongside the other SimulAI
// demos (e.g. fet.discoveree.io) and call sim_api.php same-origin.
export default defineConfig({
  plugins: [react()],
  base: "./", // relative asset paths -> host-agnostic, like the existing demos
  server: {
    // Local: `npm run sim:php` serves php-sim/ on :8080.
    // Browser stays on :5173 and posts to ./sim_api.php (proxied below).
    proxy: {
      "/sim_api.php": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
      },
    },
  },
});
