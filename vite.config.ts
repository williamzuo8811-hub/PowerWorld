import { defineConfig } from 'vite';

// 网页优先：开发服务器 + 静态打包。base 用相对路径，方便部署到任意子目录 / 静态托管。
export default defineConfig({
  base: './',
  server: {
    port: 5173,
    open: false,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
});
