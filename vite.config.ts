/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Euforia Confeitaria',
        short_name: 'Euforia',
        description: 'Receitas, custos, produção, estoque e financeiro da Confeitaria Euforia.',
        lang: 'pt-BR',
        start_url: '/',
        display: 'standalone',
        background_color: '#FFF8F3',
        theme_color: '#B83A6B',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: { navigateFallback: '/index.html' },
    }),
  ],
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
