import { defineConfig } from "vite";
import { resolve } from "node:path";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [
    dts({
      include: ["src"],
      insertTypesEntry: true,
    }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "AlloyUI",
      fileName: "ui-core",
      formats: ["es", "cjs"],
    },
    rollupOptions: {
      external: ["react", "react-dom", "tailwindcss", "zustand"],
    },
  },
});
