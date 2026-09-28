import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/green-api/" : "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@domain": fileURLToPath(new URL("./src/domain", import.meta.url)),
      "@application": fileURLToPath(new URL("./src/application", import.meta.url)),
      "@infrastructure": fileURLToPath(
        new URL("./src/infrastructure", import.meta.url),
      ),
      "@presentation": fileURLToPath(
        new URL("./src/presentation", import.meta.url),
      ),
    },
  },
}));
