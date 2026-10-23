import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import {
    SUPABASE_URL, ANON, ANON_KEY, REQUIRED_ENV, missingEnv, targetBanner,
    signIn, rest, rpc, storage, listFolder, probeName, PROBE_PREFIX, JPEG_1PX,
} from './client.js';

/**
 * CROSS-ACCOUNT ACCESS, AGAINST THE REAL DATABASE.
 *
 * WHY THIS SUITE EXISTS SEPARATELY FROM tests/e2e.
 *
 * Every browser suite runs against window.supabase, a mock defined in
 * tests/e2e/harness.js. That mock has no row level security of any kind. So
 * tests/e2e/storage-isolation.js, despite its name, proves that the client
 * puts a user id on its localStorage keys. It cannot prove that the SERVER
 * refuses one member's request for another member's row, because the thing
 * answering the request in that suite is a few dozen lines of JavaScript
 * that always says yes.
 *
 * Authorisation lives in database policies, and until this suite existed no
 * test in this repository had ever asked the database an authorisation
 * question. Policies were reviewed by reading them. This asks the server.
 *
 * ---------------------------------------------------------------------------
 * HOW TO RUN IT
 *
 *   BP_TEST_A_EMAIL=...    BP_TEST_A_PASSWORD=...
 *   BP_TEST_B_EMAIL=...    BP_TEST_B_PASSWORD=...
 *   npm run test:live
 *
 * Two dedicated accounts, created through the normal sign-up flow, with
 * confirmed email addresses. Not a real customer's account. The suite writes
 * only under its own accounts and deletes only objects whose names it
 * generated.
 *
 * ---------------------------------------------------------------------------
 * WHY A MISSING CREDENTIAL FAILS RATHER THAN SKIPS
 *
 * A skipped security test reports green. Somebody reads green and concludes
 * isolation is verified. This suite is excluded from the default vitest
 * include list, so it never runs by accident; asking for it with LIVE=1 and
 * not supplying credentials is a misconfiguration, and it fails saying which
 * variable is absent.
 *
 * ---------------------------------------------------------------------------
 * THE ASSERTION THAT MATTERS, AND WHY NAIVE VERSIONS OF IT ARE WORTHLESS
 *
 * Row level security does not reject a filtered SELECT. It removes the rows
 * and returns HTTP 200 with an empty array. So "A asked for B's row and got
 * nothing back" is satisfied just as well by B having no row at all, by a
 * typo in the id, or by the table being empty.
 *
 * Every negative test here is therefore paired with a positive one from the
 * other session: B reads its own row in the same run and the row is present.
 * A's empty result is evidence of filtering only because B's non-empty
 * result proves there was something to filter.
 *
 * The destructive probes are paired the other way round. After A is refused
 * a delete, B re-reads the object and it is still there. An error response
 * from a server that performed the write anyway would otherwise pass.
 */

const missing = missingEnv();

/* The one case that has to run whatever the environment holds: a bare
   statement of why nothing else did. */
if (missing.length) {
    describe('live cross-account suite', () => {
        test('CREDENTIALS ARE REQUIRED, AND THIS IS NOT A PASS', () => {
            expect.fail(
                'The live access-control suite did not run. Missing: '
                + missing.join(', ') + '.\n\n'
                + 'This suite is the only coverage of real server-side isolation in the\n'
                + 'repository. Treat a run without it as unverified rather than as green.\n\n'
                + 'Set all of: ' + REQUIRED_ENV.join(', ') + '\n'
                + 'using two dedicated test accounts with confirmed emails, then re-run\n'
                + '  npm run test:live\n\n'
                + targetBanner());
        });
    });
}

describe.skipIf(missing.length)('real sessions, two accounts, one server', () => {
    let A, B;
    /** An object B owns, used as the target of A's attempts. */
    let bObject = null;

    beforeAll(async () => {
        console.log('  ' + targetBanner());
        A = await signIn(process.env.BP_TEST_A_EMAIL, process.env.BP_TEST_A_PASSWORD);
        B = await signIn(process.env.BP_TEST_B_EMAIL, process.env.BP_TEST_B_PASSWORD);
        expect(A.uid, 'the two test accounts resolved to the same user id')
            .not.toBe(B.uid);

        /* B needs a user_data row for the cross-account read to mean
           anything. An upsert of the account's own id is exactly what the
           app does on every save, so this exercises the owner-insert policy
           as a side effect. */
        const seed = await rest(B, 'user_data', {
            method: 'POST',
            prefer: 'resolution=merge-duplicates,return=representation',
            body: { id: B.uid },
        });
        expect([200, 201], `B could not seed its own row: ${JSON.stringify(seed.body)}`)
            .toContain(seed.status);
    }, 60_000);

    afterAll(async () => {
        /* Remove only what this suite created, and only by B, who owns it. */
        if (bObject && bObject.includes(PROBE_PREFIX)) {
            await storage(B, `object/progress-photos/${B.uid}/${bObject}`, { method: 'DELETE' })
                .catch(() => {});
        }
    });

    // ───────────────────────────────────────────────────────────────────────
    // Training records
    // ───────────────────────────────────────────────────────────────────────
    describe('training records in user_data', () => {
        test('B can read its own row, so there is a row to filter', async () => {
            const r = await rest(B, `user_data?id=eq.${B.uid}&select=id`);
            expect(r.status).toBe(200);
            expect(Array.isArray(r.body) && r.body.length,
                'B cannot read its own row, so every negative test below is vacuous')
                .toBe(1);
            expect(r.body[0].id).toBe(B.uid);
        });

        test("ACCEPTANCE: A asking for B's row by id gets nothing", async () => {
            const r = await rest(A, `user_data?id=eq.${B.uid}&select=*`);
            expect(r.body, `A read B's row: ${JSON.stringify(r.body)}`).toEqual([]);
        });

        test('ACCEPTANCE: A selecting the whole table gets at most its own row', async () => {
            /* An unfiltered select is what enumerates a table, so it is
               asked for directly rather than inferred from the single-row
               case. A policy can be right about one id and wrong in bulk. */
            const r = await rest(A, 'user_data?select=id');
            expect(r.status).toBe(200);
            const ids = Array.isArray(r.body) ? r.body.map(x => x.id) : [];
            expect(ids.filter(id => id !== A.uid),
                `A enumerated other members: ${JSON.stringify(ids)}`).toEqual([]);
        });

        test("ACCEPTANCE: A cannot update B's row", async () => {
            const r = await rest(A, `user_data?id=eq.${B.uid}`, {
                method: 'PATCH',
                prefer: 'return=representation',
                body: { id: B.uid },
            });
            /* Either refused outright, or allowed through to affect zero
               rows. Both are correct. A non-empty representation is not. */
            const affected = Array.isArray(r.body) ? r.body : [];
            expect(affected, `A updated B's row: ${JSON.stringify(r.body)}`).toEqual([]);
        });

        test("ACCEPTANCE: A cannot insert a row carrying B's id", async () => {
            const r = await rest(A, 'user_data', {
                method: 'POST',
                prefer: 'return=representation',
                body: { id: B.uid },
            });
            expect(r.ok, `A inserted a row owned by B: HTTP ${r.status}`).toBe(false);
            expect(r.status, 'expected a policy violation').toBeGreaterThanOrEqual(400);
        });

        test("and B's row survived every attempt above", async () => {
            const r = await rest(B, `user_data?id=eq.${B.uid}&select=id`);
            expect(r.body.length, "B's row was destroyed by a probe").toBe(1);
        });

        test('ACCEPTANCE: an anonymous caller reads nothing from user_data', async () => {
            const r = await rest(ANON, 'user_data?select=id');
            const rows = Array.isArray(r.body) ? r.body : [];
            expect(rows, `anon read user_data: ${JSON.stringify(r.body)}`).toEqual([]);
        });
    });

    // ───────────────────────────────────────────────────────────────────────
    // Progress photos
    // ───────────────────────────────────────────────────────────────────────
    describe('progress photos in the progress-photos bucket', () => {
        test('B can upload into its own folder, so there is an object to protect', async () => {
            const name = probeName();
            expect(name.startsWith(PROBE_PREFIX)).toBe(true);
            const r = await storage(B, `object/progress-photos/${B.uid}/${name}`, {
                method: 'POST', raw: JPEG_1PX, contentType: 'image/jpeg',
            });
            expect(r.ok, `B could not upload its own photo: HTTP ${r.status} `
                + JSON.stringify(r.body)).toBe(true);
            bObject = name;
        });

        test('and B can see it listed in its own folder', async () => {
            const r = await listFolder(B, `${B.uid}/`);
            expect(r.names, 'B cannot list its own photo, so the tests below are vacuous')
                .toContain(bObject);
        });

        test("ACCEPTANCE: A listing B's folder sees nothing", async () => {
            const r = await listFolder(A, `${B.uid}/`);
            expect(r.names, `A listed B's photos: ${JSON.stringify(r.names)}`).toEqual([]);
        });

        test("ACCEPTANCE: A cannot download B's photo", async () => {
            const r = await storage(A, `object/progress-photos/${B.uid}/${bObject}`);
            expect(r.ok, `A downloaded B's photo: HTTP ${r.status}`).toBe(false);
        });

        test("ACCEPTANCE: A cannot mint a signed URL for B's photo", async () => {
            /* The gallery reads through signed URLs, so the signing endpoint
               is a distinct permission from the object endpoint and gets its
               own test. A signed URL is bearer-only once issued. */
            const r = await storage(A, `object/sign/progress-photos/${B.uid}/${bObject}`, {
                method: 'POST', body: { expiresIn: 60 },
            });
            expect(r.ok, `A signed B's photo: HTTP ${r.status} ${JSON.stringify(r.body)}`)
                .toBe(false);
            expect(r.body && r.body.signedURL, 'a signed URL came back').toBeFalsy();
        });

        test("ACCEPTANCE: A cannot write into B's folder", async () => {
            const name = probeName();
            expect(name.startsWith(PROBE_PREFIX)).toBe(true);
            const r = await storage(A, `object/progress-photos/${B.uid}/${name}`, {
                method: 'POST', raw: JPEG_1PX, contentType: 'image/jpeg',
            });
            expect(r.ok, `A wrote into B's folder: HTTP ${r.status}`).toBe(false);
            if (r.ok) {
                /* Clean up a failure of the policy rather than leaving the
                   object behind for the next run to trip over. */
                await storage(A, `object/progress-photos/${B.uid}/${name}`, { method: 'DELETE' });
            }
        });

        test("ACCEPTANCE: A cannot delete B's photo, and the photo is still there", async () => {
            expect(bObject.startsWith(PROBE_PREFIX),
                'refusing to aim a delete probe at an object this suite did not create')
                .toBe(true);
            const del = await storage(A, `object/progress-photos/${B.uid}/${bObject}`, {
                method: 'DELETE',
            });
            expect(del.ok, `A deleted B's photo: HTTP ${del.status}`).toBe(false);

            /* The pairing that makes the assertion above worth having. A
               server that answered with an error after performing the delete
               would satisfy the first expectation on its own. */
            const after = await listFolder(B, `${B.uid}/`);
            expect(after.names, "B's photo is gone after A attempted a delete")
                .toContain(bObject);
        });

        test('ACCEPTANCE: an anonymous caller sees no photos at all', async () => {
            const list = await listFolder(ANON, `${B.uid}/`);
            expect(list.names, `anon listed photos: ${JSON.stringify(list.names)}`).toEqual([]);
            const get = await storage(ANON, `object/progress-photos/${B.uid}/${bObject}`);
            expect(get.ok, `anon downloaded a photo: HTTP ${get.status}`).toBe(false);
        });

        test('the bucket is not public', async () => {
            /* A public bucket serves every object to anyone who knows the
               path, which no object-level policy can undo. */
            const r = await fetch(
                `${SUPABASE_URL}/storage/v1/object/public/progress-photos/${B.uid}/${bObject}`);
            expect(r.ok, `progress-photos is serving objects publicly: HTTP ${r.status}`)
                .toBe(false);
        });
    });

    // ───────────────────────────────────────────────────────────────────────
    // The entitlement table. Members reach their own entitlement through
    // claim_membership() and never read this table directly, so no caller
    // holding the public key has any business reading it at all.
    // ───────────────────────────────────────────────────────────────────────
    describe('the entitlement table answers no client read', () => {
        test('ACCEPTANCE: an anonymous caller cannot enumerate members', async () => {
            const r = await rest(ANON, 'members?select=email');
            const rows = Array.isArray(r.body) ? r.body : [];
            expect(rows, `anon enumerated purchasers: ${rows.length} rows`).toEqual([]);
        });

        test('ACCEPTANCE: a signed-in member cannot read the members table directly', async () => {
            const r = await rest(A, 'members?select=email');
            const rows = Array.isArray(r.body) ? r.body : [];
            expect(rows, `an authenticated caller read purchasers: ${rows.length} rows`)
                .toEqual([]);
        });

        test("and cannot read another member's entitlement by email", async () => {
            const r = await rest(A, `members?email=eq.${encodeURIComponent(B.email)}&select=*`);
            const rows = Array.isArray(r.body) ? r.body : [];
            expect(rows, `A read B's entitlement: ${JSON.stringify(rows)}`).toEqual([]);
        });
    });

    // ───────────────────────────────────────────────────────────────────────
    // claim_membership
    // ───────────────────────────────────────────────────────────────────────
    describe('claim_membership is the only way in, and it reads the session', () => {
        test('ACCEPTANCE: a signed-in caller may execute it', async () => {
            const r = await rpc(A, 'claim_membership');
            expect(r.status, `execute denied for authenticated: ${JSON.stringify(r.body)}`)
                .toBe(200);
            /* The verdict itself depends on whether this account owns a
               purchase, so it is not asserted. Executability is. */
            expect(typeof r.body === 'boolean' || r.body === null,
                `unexpected return shape: ${JSON.stringify(r.body)}`).toBe(true);
        });

        test('ACCEPTANCE: an anonymous caller may not execute it', async () => {
            const r = await rpc(ANON, 'claim_membership');
            expect(r.ok, `anon executed claim_membership: ${JSON.stringify(r.body)}`)
                .toBe(false);
        });

        test('ACCEPTANCE: it takes no arguments, so no caller can name a victim', async () => {
            /* The client calls it with none, and the authority test asserts
               the call site stays argument-free. This asserts the other half:
               that the server has no overload accepting one. An overload
               taking an email or a uuid would let any signed-in member claim
               somebody else's purchase. */
            for (const args of [{ p_email: 'someone@example.com' },
                { email: 'someone@example.com' },
                { p_user_id: '00000000-0000-0000-0000-000000000000' },
                { user_id: '00000000-0000-0000-0000-000000000000' }]) {
                const r = await rpc(A, 'claim_membership', args);
                expect(r.ok,
                    `claim_membership accepted ${JSON.stringify(args)}, which means a `
                    + 'caller can target an account other than their own').toBe(false);
            }
        });
    });

    // ───────────────────────────────────────────────────────────────────────
    // Everything else reachable with the public key
    // ───────────────────────────────────────────────────────────────────────
    describe('no other table answers an anonymous read', () => {
        /* Named rather than discovered. PostgREST exposes an OpenAPI
           document at the root, and reading it would make this list
           self-maintaining, but a table absent from the document because of
           a missing grant is exactly the case this test should still cover.
           Add a row here whenever a table is added. */
        const TABLES = ['members', 'user_data', 'push_subscriptions',
            'analytics_events', 'coach_usage', 'notification_deliveries',
            'progress_checkins', 'day_plans'];

        for (const t of TABLES) {
            test(`${t} returns no rows to an anonymous caller`, async () => {
                const r = await rest(ANON, `${t}?select=*&limit=5`);
                const rows = Array.isArray(r.body) ? r.body : [];
                expect(rows, `anon read ${rows.length} rows from ${t}`).toEqual([]);
            });
        }

        for (const t of TABLES) {
            test(`${t} returns no other member's rows to A`, async () => {
                const r = await rest(A, `${t}?select=*&limit=50`);
                if (!Array.isArray(r.body)) return;      // denied outright, which is fine
                const foreign = r.body.filter((row) => {
                    const owner = row.id ?? row.user_id ?? null;
                    return owner !== null && owner !== A.uid;
                });
                expect(foreign, `A read ${foreign.length} foreign rows from ${t}`).toEqual([]);
            });
        }
    });

    test('the anon key really is the anon role, so these tests meant something', async () => {
        /* If the key in app/index.html were ever replaced with a service
           key, every test above would pass by having full access rather
           than by policy. The role is encoded in the key's payload. */
        const payload = JSON.parse(
            Buffer.from(ANON_KEY.split('.')[1], 'base64url').toString('utf8'));
        expect(payload.role, 'the key shipped in app/index.html is not the anon key')
            .toBe('anon');
    });
});
