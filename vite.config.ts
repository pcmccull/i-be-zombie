import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './', // relative asset paths so the build works under GitHub Pages' /<repo>/ subpath
  server: {
    port: 5173,
    host: true, // listen on all interfaces so phones/other PCs on the LAN can connect
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
