import { defineConfig } from 'vitest/config';

// Three speeds of test:
//
//   npm test        unit + syntax. No browser, runs in seconds. This is the one
//                   to run constantly while working.
//   npm run test:e2e  the browser suites. Slower, drives the real index.html.
//   npm run test:live the live access-control suite. Talks to the REAL
//                   database with two real sessions, so it needs credentials
//                   and it is never part of the other two runs.
//
// tests/live is deliberately absent from both default include lists. It is
// the only suite that can fail because of production state rather than
// because of the code in this checkout, so it is opt-in and it is never a
// gate on a pull request. See tests/live/README.md.
const isE2E = process.env.E2E === '1';
const isLive = process.env.LIVE === '1';

export default defineConfig({
    test: {
        include: isLive ? ['tests/live/**/*.test.js']
            : isE2E ? ['tests/e2e/**/*.test.js']
                : ['tests/*.test.js'],
        exclude: ['**/node_modules/**'],
        // Each e2e suite launches its own browser and static server, so running
        // them concurrently would multiply memory and make timing assertions
        // flaky. Unit tests keep the default parallelism.
        //
        // The live suite is serial for a different reason: its accounts are
        // shared state on a real server, and two files racing to upload and
        // delete the same probe object would produce failures that say
        // nothing about access control.
        fileParallelism: !isE2E && !isLive,
        // A live call crosses the network, and sign-in for two accounts
        // happens in beforeAll.
        testTimeout: isLive ? 30_000 : isE2E ? 120_000 : 5_000,
        hookTimeout: isLive ? 60_000 : isE2E ? 60_000 : 10_000,
    },
});
