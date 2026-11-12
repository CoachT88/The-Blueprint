import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

/* The staging entitlement package (supabase/staging). The behaviour is proved
   by tests/sql/staging-entitlement.test.sh on a throwaway PostgreSQL; this
   file holds the properties that must hold for the files as text. */
const read = f => readFileSync(`supabase/staging/${f}`, 'utf8');
const MIGRATION = readFileSync('supabase/migrations/20261024090000_purchase_ledger.sql', 'utf8');

describe('staging entitlement package', () => {
    test('01 applies the production purchase-ledger migration verbatim', () => {
        expect(read('01-setup.sql')).toContain(MIGRATION);
    });
    test('every file after 01 refuses to run without the staging marker', () => {
        for (const f of ['02-verify.sql', '03-simulate-purchase.sql', '99a-rollback-simulation.sql', '99b-rollback-everything.sql'])
            expect(read(f), f).toMatch(/to_regclass\('public\._staging_marker'\) is null/);
    });
    test('01 refuses an unmarked project that already has the ledger (production shape)', () => {
        expect(read('01-setup.sql')).toMatch(/purchases'\) is not null\s+and to_regclass\('public\._staging_marker'\) is null/);
    });
    test('the simulated purchase is labelled and cannot be mistaken for a payment', () => {
        const s = read('03-simulate-purchase.sql');
        expect(s).toContain("'simulated'");
        expect(s).not.toMatch(/'stripe'|pk_|sk_|whsec_/);
        expect(s).toMatch(/user_id stays null/);
    });
    test('nothing in the package carries a credential, a real address or a production identifier', () => {
        for (const f of readdirSync('supabase/staging').filter(x => x.endsWith('.sql'))) {
            const s = read(f);
            expect(s, f).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}|sb_secret|sb_publishable|service_role_key|@gmail\.|@(?!example\.invalid)[a-z0-9-]+\.(com|net|org|io)\b/i);
        }
    });
    test('the rollback of everything refuses to drop real purchases', () => {
        expect(read('99b-rollback-everything.sql')).toMatch(/provider <> 'simulated'/);
    });
});
