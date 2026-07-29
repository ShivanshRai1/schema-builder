import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Builds to static assets so this can be hosted alongside the other SimulAI
// demos (e.g. fet.discoveree.io) and call sim_api.php same-origin.
export default defineConfig({
  plugins: [react()],
  base: "./", // relative asset paths -> host-agnostic, like the existing demos
});
