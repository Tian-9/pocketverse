import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  base: './',
  resolve: {
    alias: {
      $kernel: fileURLToPath(new URL('./src/kernel', import.meta.url)),
      $plugins: fileURLToPath(new URL('./src/plugins', import.meta.url)),
    },
  },
  plugins: [
    tailwindcss(),
    svelte(),
    VitePWA({
      registerType: 'prompt',
      manifest: {
        name: 'Pocketverse',
        short_name: 'Pocketverse',
        description: '插件化的角色扮演小手机',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#000000',
        theme_color: '#000000',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'] },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test-setup.ts'],
  },
});
