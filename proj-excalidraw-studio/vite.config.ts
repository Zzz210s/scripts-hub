import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 生产环境由 nginx 托管 dist/,并把 /api 反代给存储服务,所以这里不需要 proxy。
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", chunkSizeWarningLimit: 4096 },
});
