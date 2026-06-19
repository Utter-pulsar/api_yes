import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// API-YES uses three build targets:
//   main     -> Electron main process (windows, persistence, OAuth, the reverse-proxy server)
//   preload  -> the contextBridge API exposed to the renderer
//   renderer -> a single html entry: the hand-drawn `app` window
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    },
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    },
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@app': resolve('src/renderer/app'),
        '@assets': resolve('assets')
      }
    },
    server: { fs: { allow: [resolve('.')] } },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          app: resolve('src/renderer/app/index.html')
        }
      }
    }
  }
})
