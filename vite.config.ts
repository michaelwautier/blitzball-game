import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    /**
     * Well above Vitest's five seconds, because a lot of this suite plays real
     * matches: the balance tests simulate two dozen, and a match runs five
     * minutes of game time at sixty ticks a second.
     *
     * The default was tight enough that a test taking 1.4s locally timed out on
     * CI, which is several times slower — and it did so the moment `HALF_SECONDS`
     * went from three minutes to five, having nothing to do with the change
     * being tested. Raised here rather than annotated test by test, since match
     * length is a property of the whole project and the next such change would
     * find a different set of tests.
     */
    testTimeout: 30_000,
  },
})
