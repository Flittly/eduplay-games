import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: "index"
    },
    outDir: "dist/web",
    emptyOutDir: true,
    rollupOptions: {
      external: ["react", "react-dom"]
    }
  }
});

