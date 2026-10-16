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
      includeAssets: ['favicon.png', 'apple-touch-icon.png', 'logo-simbolo.png', 'logo-nome.webp', 'logo-completa.webp'],
      manifest: {
        name: 'Euforia Confeitaria',
        short_name: 'Euforia',
        description: 'Receitas, custos, produção, estoque e financeiro da Confeitaria Euforia.',
        lang: 'pt-BR',
        start_url: '/',
        display: 'standalone',
        background_color: '#FEF6F0',
        theme_color: '#FEF6F0',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: { navigateFallback: '/index.html' },
    }),
  ],
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
