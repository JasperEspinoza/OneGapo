import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['pwa-icon.svg'],
      manifest: {
        name: 'OneGapo Resident',
        short_name: 'OneGapo',
        description: 'Citizen reporting mobile app for residents.',
        theme_color: '#0f172a',
        background_color: '#f8fafc',
        display: 'standalone',
        scope: '/',
        start_url: '/resident',
        orientation: 'portrait-primary',
        icons: [
          {
            src: 'pwa-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/reports'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'reports-api-cache',
              networkTimeoutSeconds: 5,
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 60 * 10,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^https:\/\/.+\/(tile\.openstreetmap\.org|basemaps\.cartocdn\.com)\/.+/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'map-tiles-cache',
              expiration: {
                maxEntries: 120,
                maxAgeSeconds: 60 * 60 * 24 * 7,
              },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    // Proxy /api calls to the Express backend during development,
    // avoiding CORS issues without changing frontend fetch URLs.
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
