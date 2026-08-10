import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// GitHub Pages: CI builds with `vite build --base=/HairFormula/`
// (see .github/workflows/deploy.yml); local dev stays at /.
export default defineConfig({
  plugins: [react(), tailwindcss()],
});
