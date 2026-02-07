import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'ndr-logo.svg'],
        manifest: {
          name: 'Nigeria Diaspora Radio',
          short_name: 'NDR',
          description: 'The Voice of Nigerians Abroad',
          theme_color: '#008751',
          background_color: '#f0fff4',
          display: 'standalone',
          icons: [
            {
              src: 'ndr-logo.svg',
              sizes: '192x192',
              type: 'image/svg+xml'
            },
            {
              src: 'ndr-logo.svg',
              sizes: '512x512',
              type: 'image/svg+xml'
            },
            {
              src: 'ndr-logo.svg',
              sizes: '512x512',
              type: 'image/svg+xml',
              purpose: 'any maskable'
            }
          ]
        }
      })
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});
