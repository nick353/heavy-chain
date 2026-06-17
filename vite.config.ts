import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // Optimize chunk size
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.split(path.sep).join('/')
          const [, modulePath] = normalizedId.split('/node_modules/').slice(-2)
          if (!modulePath) return undefined

          const [firstSegment, secondSegment] = modulePath.split('/')
          const packageName = firstSegment.startsWith('@')
            ? `${firstSegment}/${secondSegment}`
            : firstSegment

          if (packageName === '@supabase/supabase-js') return 'supabase-vendor'
          if (['framer-motion', 'lucide-react'].includes(packageName)) return 'ui-vendor'
          if (['konva', 'react-konva', 'reactflow'].includes(packageName) || packageName.startsWith('@reactflow/')) return 'canvas-vendor'
          if (['react', 'react-dom', 'react-router', 'react-router-dom'].includes(packageName)) return 'react-vendor'
          return undefined
        },
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
  },
})
