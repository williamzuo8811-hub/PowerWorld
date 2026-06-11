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
    sourcemap: true, // 线上报错可定位源码
    rollupOptions: {
      output: {
        // 把 pixi.js（约 1MB）拆出主包：游戏逻辑迭代时用户只需重新下载小的主 chunk
        manualChunks: { pixi: ['pixi.js'] },
      },
    },
  },
});
