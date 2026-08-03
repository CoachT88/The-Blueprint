import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The edge function runs on Deno, against a live database, on a cron. Nothing
 * in this repo can execute it, so the decision logic was deliberately pushed
 * into _shared/notifyRules.js where it is properly tested.
 *
 * What is left here is plumbing, and these are the properties of that plumbing
 * worth failing a build over. Reading the source is a blunt instrument, but the
 * alternative is finding out from a member that the app messaged them sixteen
 * times, and each of these guards a mistake that was actually present in the
 * version this replaced.
 */
const ROOT = path.resolve(import.meta.dirname, '..');
const src = readFileSync(path.join(ROOT, 'supabase/functions/send-notifications/index.ts'), 'utf8');

describe('the sender', () => {
    test('refuses a request without the shared secret', () => {
        // Without this the URL is a public button that notifies every member.
        expect(src).toMatch(/CRON_SECRET/);
        expect(src).toMatch(/status:\s*401/);
        // And the check has to come before any work, not after.
        expect(src.indexOf('CRON_SECRET')).toBeLessThan(src.indexOf('push_subscriptions'));
    });

    test('delegates the decision rather than reimplementing it', () => {
        expect(src).toMatch(/from '\.\.\/_shared\/notifyRules\.js'/);
        expect(src).toMatch(/decideNotification\(/);
    });

    test('carries no message text of its own', () => {
        // Every string a member can see belongs in notifyRules.js, where the
        // discretion tests can reach it. The previous version had sixteen
        // hard-coded bodies here, several of them explicit.
        const forbidden = /erection|pelvic|kegel|blood flow|testosterone|hydrat/i;
        expect(src.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(forbidden);
    });

    test('reads only the columns it needs, never a whole row', () => {
        // session_log is large and there may be thousands of rows.
        expect(src).not.toMatch(/from\('user_data'\)[\s\S]{0,40}select\('\*'\)/);
        expect(src).not.toMatch(/from\('push_subscriptions'\)[\s\S]{0,60}select\('\*'\)/);
    });

    test('pages through subscriptions instead of loading all of them', () => {
        expect(src).toMatch(/\.range\(/);
    });

    test('records that it sent, so nobody is messaged twice in a day', () => {
        expect(src).toMatch(/last_notified_date/);
    });

    test('drops dead subscriptions rather than retrying them hourly forever', () => {
        expect(src).toMatch(/410/);
        expect(src).toMatch(/404/);
    });

    test('declines to send when it cannot tell who has trained', () => {
        // A failed read looks identical to "nobody trained today". Guessing
        // means messaging people who already did the session.
        expect(src).toMatch(/failed/);
        expect(src).toMatch(/Skipping page/);
    });
});

describe('the setup SQL', () => {
    const sql = readFileSync(path.join(ROOT, 'supabase/notifications.sql'), 'utf8');

    test('adds the column the sender writes to', () => {
        expect(sql).toMatch(/add column if not exists last_notified_date/i);
    });

    test('schedules the run hourly', () => {
        expect(sql).toMatch(/cron\.schedule/);
        expect(sql).toMatch(/'0 \* \* \* \*'/);
    });

    test('passes the secret, and does not ship a real one', () => {
        expect(sql).toMatch(/Authorization/);
        expect(sql).toMatch(/<CRON-SECRET>/);
        expect(sql).toMatch(/<PROJECT-REF>/);
    });
});
