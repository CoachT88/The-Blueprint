import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, authSignIn } from './harness.js';

/**
 * Membership authority is the Supabase user UUID, not the email.
 *
 * The purchase email proves entitlement ONCE. claim_membership() attaches the
 * purchase row to auth.uid(), and from then on the UUID is the authority. That
 * is what lets a member later sign in through Apple with a private relay
 * address, or change the address on their account, without becoming a
 * different customer.
 *
 * The client passes NOTHING to the RPC. There is no email parameter to spoof
 * and no user id to choose: identity comes from the session. Several tests
 * below exist specifically to keep it that way.
 */

const MEMBER = 'buyer@example.com';

/** Ask the real checkMembership, with a chosen entitlement table. */
const check = (page, { id, email, members, inject = {} }) => page.evaluate(
    async ({ id, email, members, inject }) => {
        window.__members = members;
        window.__claimRpcCalls = 0;
        Object.assign(window, inject);
        window.__session = { user: { id, email }, access_token: 'stub' };
        try { localStorage.removeItem('bp_member_ok_' + id); } catch (e) {}
        const allowed = await checkMembership({ id, email });
        return {
            allowed,
            calls: window.__claimRpcCalls,
            rows: JSON.parse(JSON.stringify(window.__members)),
            cached: !!localStorage.getItem('bp_member_ok_' + id),
            authErr: document.getElementById('auth-error').textContent,
        };
    }, { id, email, members, inject });

describe('claiming an entitlement', () => {
    let app;
    beforeAll(async () => { app = await openApp({}); }, 90_000);
    afterAll(async () => { await app?.close(); });

    test('AN UNCLAIMED PURCHASE IS CLAIMED BY THE MATCHING EMAIL', async () => {
        const o = await check(app.page, { id: 'U1', email: MEMBER, members: [MEMBER] });
        expect(o.allowed).toBe(true);
        expect(o.rows[0].user_id).toBe('U1');      // now owned by the UUID
        expect(o.cached).toBe(true);
    }, 60_000);

    test('a UUID that already owns one is allowed without a second claim', async () => {
        /* Idempotent: repeated sign-in must not depend on the email still
           matching, and must not rewrite the row. */
        const o = await check(app.page, {
            id: 'U1', email: 'changed@example.com',
            members: [{ email: MEMBER, user_id: 'U1', claimed_at: '2026-01-01T00:00:00.000Z' }],
        });
        expect(o.allowed).toBe(true);
        expect(o.rows[0].claimed_at).toBe('2026-01-01T00:00:00.000Z');  // untouched
    }, 60_000);

    test('A LATER EMAIL CHANGE DOES NOT REVOKE MEMBERSHIP', async () => {
        /* The whole point of the cutover. Under the old email gate this
           member would have been denied. */
        const o = await check(app.page, {
            id: 'U1', email: 'brand-new-address@example.com',
            members: [{ email: MEMBER, user_id: 'U1' }],
        });
        expect(o.allowed).toBe(true);
    }, 60_000);

    test('AN APPLE RELAY ADDRESS KEEPS MEMBERSHIP ONCE THE UUID OWNS IT', async () => {
        /* Apple Private Relay gives a different address entirely. Identity is
           the UUID, so the relay address is irrelevant, and no second
           entitlement is created for it. */
        const o = await check(app.page, {
            id: 'U1', email: 'xyz123@privaterelay.appleid.com',
            members: [{ email: MEMBER, user_id: 'U1' }],
        });
        expect(o.allowed).toBe(true);
        expect(o.rows.length).toBe(1);
    }, 60_000);

    test('a phone-linked identity is the same UUID, so membership holds', async () => {
        /* A phone login that resolves to the existing user carries no email
           at all. The UUID still owns the entitlement. */
        const o = await check(app.page, {
            id: 'U1', email: '',
            members: [{ email: MEMBER, user_id: 'U1' }],
        });
        expect(o.allowed).toBe(true);
    }, 60_000);

    test('a non-buyer is refused, with the purchase messaging', async () => {
        const o = await check(app.page, {
            id: 'U9', email: 'nobody@example.com', members: [MEMBER],
        });
        expect(o.allowed).toBe(false);
        expect(o.cached).toBe(false);
        expect(o.authErr.toLowerCase()).toMatch(/purchas|email/);
    }, 60_000);

    test('AN ENTITLEMENT OWNED BY ANOTHER UUID CANNOT BE STOLEN', async () => {
        /* Same purchase email, different account. The row belongs to U1 and
           U2 must not acquire it, however they signed in. */
        const o = await check(app.page, {
            id: 'U2', email: MEMBER,
            members: [{ email: MEMBER, user_id: 'U1' }],
        });
        expect(o.allowed).toBe(false);
        expect(o.rows[0].user_id).toBe('U1');      // still U1's
    }, 60_000);

    test('email matching is case and whitespace insensitive', async () => {
        const o = await check(app.page, {
            id: 'U3', email: '  BUYER@Example.COM ', members: [MEMBER],
        });
        expect(o.allowed).toBe(true);
        expect(o.rows[0].user_id).toBe('U3');
    }, 60_000);

    test('a purchase made before any account exists stays claimable', async () => {
        /* The Ko-fi resting state: entitlement recorded, user_id null. It is
           not lost, it is waiting. */
        const members = [{ email: MEMBER, user_id: null }];
        const first = await check(app.page, { id: 'U4', email: 'other@example.com', members });
        expect(first.allowed).toBe(false);
        expect(first.rows[0].user_id).toBeNull();  // untouched by a non-match
        const second = await check(app.page, { id: 'U5', email: MEMBER, members: first.rows });
        expect(second.allowed).toBe(true);
        expect(second.rows[0].user_id).toBe('U5');
    }, 60_000);

    test('THE CLIENT SENDS NO ARGUMENTS TO THE RPC', async () => {
        /* Structural. If an email or a user id is ever passed, a caller can
           choose whose entitlement to claim. */
        const src = await app.page.evaluate(() => _claimMembership.toString());
        expect(src).toContain("sb.rpc('claim_membership')");
        expect(src).not.toMatch(/rpc\(\s*'claim_membership'\s*,/);
        const caller = await app.page.evaluate(() => checkMembership.toString());
        expect(caller).not.toContain('user.email');
    }, 60_000);
});

describe('verification failure is not denial', () => {
    let app;
    beforeAll(async () => { app = await openApp({}); }, 90_000);
    afterAll(async () => { await app?.close(); });

    test('A HUNG RPC FALLS BACK TO A PREVIOUSLY VERIFIED DEVICE', async () => {
        const o = await app.page.evaluate(async () => {
            window.__members = [{ email: 'buyer@example.com', user_id: 'U1' }];
            window.__session = { user: { id: 'U1', email: 'buyer@example.com' }, access_token: 's' };
            /* This device verified U1 before. */
            localStorage.setItem('bp_member_ok_U1', new Date().toISOString());
            window.__hangClaimRpc = true;
            const allowed = await checkMembership({ id: 'U1', email: 'buyer@example.com' });
            window.__hangClaimRpc = false;
            return { allowed, calls: window.__claimRpcCalls };
        });
        expect(o.allowed).toBe(true);              // not locked out by a timeout
        expect(o.calls).toBe(2);                   // tried, retried, then fell back
    }, 90_000);

    test('but an UNVERIFIED device is refused rather than trusted', async () => {
        const o = await app.page.evaluate(async () => {
            window.__members = [{ email: 'buyer@example.com', user_id: 'U7' }];
            window.__session = { user: { id: 'U7', email: 'buyer@example.com' }, access_token: 's' };
            try { localStorage.removeItem('bp_member_ok_U7'); } catch (e) {}
            window.__hangClaimRpc = true;
            const allowed = await checkMembership({ id: 'U7', email: 'buyer@example.com' });
            window.__hangClaimRpc = false;
            return { allowed, err: document.getElementById('auth-error').textContent };
        });
        expect(o.allowed).toBe(false);
        expect(o.err).toMatch(/verify your membership/i);
    }, 90_000);

    test('AN RPC ERROR IS A FAILED CHECK, NOT A DENIAL', async () => {
        /* A member whose request errors must not have their cached pass
           dropped: that is the difference between "we could not ask" and
           "you did not buy this". */
        const o = await app.page.evaluate(async () => {
            window.__members = [{ email: 'buyer@example.com', user_id: 'U8' }];
            window.__session = { user: { id: 'U8', email: 'buyer@example.com' }, access_token: 's' };
            localStorage.setItem('bp_member_ok_U8', new Date().toISOString());
            window.__claimRpcFails = true;
            const allowed = await checkMembership({ id: 'U8', email: 'buyer@example.com' });
            window.__claimRpcFails = false;
            return { allowed, stillCached: !!localStorage.getItem('bp_member_ok_U8') };
        });
        expect(o.allowed).toBe(true);
        expect(o.stillCached).toBe(true);
    }, 90_000);

    test('anonymous cannot claim: no session, no identity', async () => {
        const o = await app.page.evaluate(async () => {
            window.__members = [{ email: 'buyer@example.com', user_id: null }];
            window.__session = null;               // anon
            const r = await sb.rpc('claim_membership');
            return { data: r.data, err: r.error && r.error.message,
                     rows: JSON.parse(JSON.stringify(window.__members)) };
        });
        expect(o.data).not.toBe(true);
        expect(o.err).toMatch(/permission denied/i);
        expect(o.rows[0].user_id).toBeNull();      // nothing claimed
    }, 60_000);
});
