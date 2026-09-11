import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  // Only these public application settings may enter browser/worker bundles.
  // In particular, historical local credentials must not ride along with a
  // dynamic import.meta.env read.
  envPrefix: [
    'VITE_CLOUDFLARE_API_BASE_URL', 'VITE_CLOUDFLARE_API_ENABLED',
    'VITE_MEDIA_PROVIDER_ORDER', 'VITE_MEDIA_GATEWAY_URL',
    'VITE_DEBUG_GENERATION', 'VITE_GENERATION_PROVIDER', 'VITE_DEFAULT_GENERATION_MODEL',
    'VITE_REMBG_MODEL_BASE_URL', 'VITE_REMBG_SILUETA_MODEL_URL',
    'VITE_REMBG_ISNET_GENERAL_USE_MODEL_URL', 'VITE_REMBG_CLOTH_SEG_MODEL_URL',
    'VITE_EFFICIENT_SAM_ENCODER_URL', 'VITE_EFFICIENT_SAM_DECODER_URL',
    'VITE_BEN2_ONNX_MODEL_URL', 'VITE_MODNET_ONNX_MODEL_URL',
  ],
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        // ファイル名にタイムスタンプを含めてキャッシュを無効化
        entryFileNames: `assets/[name].[hash].js`,
        chunkFileNames: `assets/[name].[hash].js`,
        assetFileNames: `assets/[name].[hash].[ext]`
      },
    },
    // Increase chunk size warning limit
    chunkSizeWarningLimit: 1000,
  },
  server: {
    port: 5173,
    host: true,
  },
  preview: {
    port: 4173,
    host: true,
    allowedHosts: ['heavy-chain-web.nichika2000823.workers.dev'],
  },
})
