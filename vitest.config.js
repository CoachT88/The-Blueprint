import { defineConfig } from 'vitest/config';

// Two speeds of test:
//
//   npm test        unit + syntax. No browser, runs in seconds. This is the one
//                   to run constantly while working.
//   npm run test:e2e  the browser suites. Slower, drives the real index.html.
//
// harmonymap/ is a separate project with its own tests, so it is excluded here
// rather than being swept up by the root config.
const isE2E = process.env.E2E === '1';

export default defineConfig({
    test: {
        include: isE2E ? ['tests/e2e/**/*.test.js'] : ['tests/*.test.js'],
        exclude: ['**/node_modules/**', 'harmonymap/**'],
        // Each e2e suite launches its own browser and static server, so running
        // them concurrently would multiply memory and make timing assertions
        // flaky. Unit tests keep the default parallelism.
        fileParallelism: !isE2E,
        testTimeout: isE2E ? 120_000 : 5_000,
        hookTimeout: isE2E ? 60_000 : 10_000,
    },
});
