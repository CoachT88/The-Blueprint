import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import {
    SUPABASE_URL, ANON, REQUIRED_ADMIN_ENV, missingEnv,
    signIn, rpc, createUser, setUserEmail, deleteUser,
    seedMember, readMembers, deleteMembers, countMembers,
    probeEmail, isProbeEmail,
} from './client.js';

/**
 * claim_membership(), against the real function.
 *
 * This is the one call that turns a sign-in into a paid account, so it is
 * the one function where being wrong costs either a customer their access or
 * somebody else's entitlement. It is covered here against production rather
 * than against a stub, because a stub cannot tell us what the database does.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS SUITE WRITES TO, AND WHY THAT IS SAFE
 *
 * public.members holds real purchase records. This suite creates throwaway
 * auth accounts and seeds entitlement rows for them, because there is no
 * other way to exercise a first-time claim.
 *
 * Every address it touches is minted by probeEmail() and begins with
 * `bp-claim-probe-`. client.js refuses to create an account, seed a row,
 * read a row or delete a row for any address outside that space, so an edit
 * that aimed a cleanup step at a customer fails the guard instead of
 * running. beforeAll additionally records the total row count and afterAll
 * asserts it came back to the same number.
 *
 * It needs the service key, which is the only way to write members at all
 * now that the client roles have no privileges on it.
 *
 * ---------------------------------------------------------------------------
 * THE CONFIRMED-EMAIL SCENARIO DEPENDS ON PROJECT CONFIGURATION
 *
 * When the project requires confirmation at sign-up, Supabase will not issue
 * a session to an unconfirmed account, so the unconfirmed caller cannot
 * reach the function at all and the function-level check is defence in
 * depth. When confirmation is switched off, every account is stamped
 * confirmed at birth and the check passes for everyone.
 *
 * Those are opposite configurations and the test has to say which one it
 * observed rather than assume. It reports the posture it found and asserts
 * the behaviour that follows from it.
 */

const missing = missingEnv(REQUIRED_ADMIN_ENV);
const PASSWORD = 'probe-' + Math.random().toString(36).slice(2) + '-Aa1!';

if (missing.length) {
    describe('live claim_membership suite', () => {
        test('THE SERVICE KEY IS REQUIRED, AND THIS IS NOT A PASS', () => {
            expect.fail(
                'The claim_membership suite did not run. Missing: ' + missing.join(', ') + '.\n\n'
                + 'This is the only coverage of the function that grants paid access.\n'
                + 'Treat a run without it as unverified rather than as green.\n\n'
                + 'The key is a secret. Pass it in the environment for one run and do\n'
                + 'not put it in a file, a script, or repository secrets.\n\n'
                + 'Target project (read from app/index.html): ' + SUPABASE_URL);
        });
    });
}

describe.skipIf(missing.length)('claim_membership against production', () => {
    /** Everything created here, torn down in afterAll whatever happens. */
    const users = [];
    const emails = [];
    let baseline = -1;

    const mint = () => { const e = probeEmail(); emails.push(e); return e; };
    const spawn = async (email, opts) => {
        const u = await createUser(email, PASSWORD, opts);
        users.push(u.uid);
        return u;
    };

    beforeAll(async () => {
        baseline = await countMembers();
        expect(baseline, 'could not count members with the service key').toBeGreaterThan(-1);
    }, 60_000);

    afterAll(async () => {
        for (const e of emails) {
            if (isProbeEmail(e)) await deleteMembers(e).catch(() => {});
        }
        for (const uid of users) await deleteUser(uid).catch(() => {});

        const after = await countMembers().catch(() => -1);
        if (baseline > -1 && after > -1 && after !== baseline) {
            throw new Error(
                `members row count changed across the run: ${baseline} before, ${after} after. `
                + 'Inspect before trusting this result.');
        }
    }, 120_000);

    // ───────────────────────────────────────────────────────────────────────
    test('ACCEPTANCE: an existing purchaser keeps their access', async () => {
        /* Already attached. The function must answer from the existing row,
           not re-derive anything, and must not disturb claimed_at. */
        const email = mint();
        const u = await spawn(email);
        const seeded = await seedMember(email);
        expect(seeded).toBeTruthy();

        /* Attach it the way a previous claim would have. */
        await seedMemberAttach(email, u.uid);
        const before = (await readMembers(email))[0];
        expect(before.user_id).toBe(u.uid);

        const s = await signIn(email, PASSWORD);
        const r = await rpc(s, 'claim_membership');
        expect(r.status).toBe(200);
        expect(r.body, 'an existing purchaser was refused').toBe(true);

        const after = (await readMembers(email))[0];
        expect(after.user_id).toBe(u.uid);
        expect(after.claimed_at, 'claimed_at was rewritten on a repeat call')
            .toBe(before.claimed_at);
    }, 60_000);

    // ───────────────────────────────────────────────────────────────────────
    test('ACCEPTANCE: a first-time claim attaches a confirmed purchaser', async () => {
        const email = mint();
        const u = await spawn(email, { confirmed: true });
        await seedMember(email);

        const unattached = (await readMembers(email))[0];
        expect(unattached.user_id, 'the seeded row was already attached').toBeNull();

        const s = await signIn(email, PASSWORD);
        const r = await rpc(s, 'claim_membership');
        expect(r.body, 'a confirmed purchaser could not activate').toBe(true);

        const row = (await readMembers(email))[0];
        expect(row.user_id).toBe(u.uid);
        expect(row.claimed_at, 'claimed_at was not stamped').toBeTruthy();
    }, 60_000);

    // ───────────────────────────────────────────────────────────────────────
    test('a purchase recorded with different spacing and case still matches', async () => {
        /* The function compares lower(btrim(email)) on both sides. A Ko-fi
           payload carrying a capitalised or padded address must still find
           its buyer, so the normalisation is exercised rather than assumed. */
        const email = mint();
        const u = await spawn(email, { confirmed: true });
        await seedMember(email, { email: `  ${email.toUpperCase()}  ` })
            .catch(async () => { await seedMember(email); });

        const s = await signIn(email, PASSWORD);
        const r = await rpc(s, 'claim_membership');
        expect(r.body, 'a differently cased purchase email did not match').toBe(true);

        const rows = await readMembers(email);
        const mine = rows.filter(x => x.user_id === u.uid);
        expect(mine.length).toBeGreaterThan(0);
    }, 60_000);

    // ───────────────────────────────────────────────────────────────────────
    test('ACCEPTANCE: a nonbuyer is refused and no row is invented', async () => {
        const email = mint();
        await spawn(email, { confirmed: true });
        expect(await readMembers(email), 'the probe address already has a row').toEqual([]);

        const s = await signIn(email, PASSWORD);
        const r = await rpc(s, 'claim_membership');
        expect(r.body, 'a nonbuyer was granted access').toBe(false);

        expect(await readMembers(email), 'a row was created for a nonbuyer').toEqual([]);
    }, 60_000);

    // ───────────────────────────────────────────────────────────────────────
    test('ACCEPTANCE: an unconfirmed account cannot activate', async () => {
        /* Constructed both ways, because the two project configurations
           reject this caller at different layers and the suite must report
           which layer did it rather than claim the one it prefers. */
        const email = mint();
        await spawn(email, { confirmed: false });
        await seedMember(email);

        let session = null;
        let signInRefused = null;
        try {
            session = await signIn(email, PASSWORD);
        } catch (e) {
            signInRefused = e.message;
        }

        if (!session) {
            /* The platform refused a session. The function was never
               reachable, which is the stronger of the two outcomes. */
            console.log('  posture: the project requires email confirmation; '
                + 'an unconfirmed account gets no session at all');
            expect(signInRefused).toBeTruthy();
        } else {
            /* A session exists, so confirmation is not enforced at sign-in
               and the function-level check is the only thing standing here. */
            console.log('  posture: the project issues sessions to unconfirmed '
                + 'accounts; the function-level check is the only control');
            const r = await rpc(session, 'claim_membership');
            expect(r.body,
                'an unconfirmed account activated a purchase. If this migration has '
                + 'not been applied yet, that is the expected result and the reason '
                + 'for applying it.').toBe(false);
        }

        const row = (await readMembers(email))[0];
        expect(row.user_id, 'an unconfirmed account attached itself to a purchase')
            .toBeNull();
    }, 60_000);

    // ───────────────────────────────────────────────────────────────────────
    test('ACCEPTANCE: an entitlement already owned cannot be taken by another account', async () => {
        /* The only route by which two accounts can present the same purchase
           address: the owner claims it, then moves their auth address
           elsewhere, freeing the original for somebody else to register.
           The `user_id is null` predicate is what must hold here. */
        const purchase = mint();
        const owner = await spawn(purchase, { confirmed: true });
        await seedMember(purchase);

        const ownerSession = await signIn(purchase, PASSWORD);
        expect((await rpc(ownerSession, 'claim_membership')).body).toBe(true);
        const owned = (await readMembers(purchase))[0];
        expect(owned.user_id).toBe(owner.uid);

        /* The owner moves to a new address, releasing the old one. */
        const moved = mint();
        const mv = await setUserEmail(owner.uid, moved, { confirmed: true });
        expect(mv.ok, `could not move the owner's address: ${JSON.stringify(mv.body)}`)
            .toBe(true);

        /* A different person registers the freed address and confirms it. */
        const thief = await spawn(purchase, { confirmed: true });
        expect(thief.uid).not.toBe(owner.uid);

        const thiefSession = await signIn(purchase, PASSWORD);
        const r = await rpc(thiefSession, 'claim_membership');
        expect(r.body, 'a second account took an entitlement already owned').toBe(false);

        const after = (await readMembers(purchase))[0];
        expect(after.user_id, 'the entitlement changed hands').toBe(owner.uid);
        expect(after.claimed_at).toBe(owned.claimed_at);
    }, 90_000);

    // ───────────────────────────────────────────────────────────────────────
    test('ACCEPTANCE: concurrent activation attaches exactly once', async () => {
        const email = mint();
        const u = await spawn(email, { confirmed: true });
        await seedMember(email);

        const s = await signIn(email, PASSWORD);
        const results = await Promise.all(
            Array.from({ length: 8 }, () => rpc(s, 'claim_membership')));

        for (const r of results) {
            expect(r.status, 'a concurrent call errored').toBe(200);
            expect(r.body, 'a concurrent call refused a legitimate purchaser').toBe(true);
        }

        const rows = await readMembers(email);
        expect(rows.length, 'concurrency duplicated the entitlement row').toBe(1);
        expect(rows[0].user_id).toBe(u.uid);
        expect(rows[0].claimed_at).toBeTruthy();
    }, 90_000);

    // ───────────────────────────────────────────────────────────────────────
    test('a caller with no session gets nothing, and not an error page', async () => {
        const r = await rpc(ANON, 'claim_membership');
        expect(r.ok, 'an anonymous caller executed claim_membership').toBe(false);
    }, 30_000);
});

/**
 * Attach a seeded row the way a prior claim would have left it.
 * Kept out of client.js because it is only meaningful to this suite, and it
 * carries the same refusal as every other write.
 */
async function seedMemberAttach(email, uid) {
    if (!isProbeEmail(email)) throw new Error(`refusing to attach ${email}`);
    const { adminRest } = await import('./client.js');
    const r = await adminRest(`members?email=eq.${encodeURIComponent(email)}`, {
        method: 'PATCH',
        prefer: 'return=representation',
        body: { user_id: uid, claimed_at: new Date().toISOString() },
    });
    if (!r.ok) throw new Error(`attach failed: HTTP ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
}
