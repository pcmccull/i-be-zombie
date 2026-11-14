import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './', // relative asset paths so the build works under GitHub Pages' /<repo>/ subpath
  server: {
    port: 5173,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
