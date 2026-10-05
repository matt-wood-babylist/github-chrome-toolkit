import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The parser runs against real GitHub markup, so it needs a DOM with
    // querySelector/DOMParser. jsdom's globals are injected for the tests.
    environment: 'jsdom',
    globals: false,
    include: ['test/**/*.test.ts'],
  },
})
