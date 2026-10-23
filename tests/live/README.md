# tests/live

The only suite in this repository that asks the real server an
access-control question.

## Why it is separate

Every suite in `tests/e2e` runs against `window.supabase`, a mock defined in
`tests/e2e/harness.js`. That mock has no row level security. `storage-isolation.test.js`
tests that the client scopes its `localStorage` keys by user id, which is a
real bug it caught and still guards. It does not test that the server refuses
one member's request for another member's data, because in that suite the
thing answering is a stub that always says yes.

Authorisation lives in database policies. Until this suite existed, those
policies were verified by reading them and by checking the dashboard by hand,
and no test in the repository had ever asked the database an authorisation
question. A policy review catches what the reviewer thinks to look at. A test
runs on every occasion somebody remembers to run it, which is a lower bar
worth having underneath the review rather than instead of it.

## Running it

```sh
BP_TEST_A_EMAIL=a@example.test BP_TEST_A_PASSWORD=... \
BP_TEST_B_EMAIL=b@example.test BP_TEST_B_PASSWORD=... \
npm run test:live
```

Two dedicated accounts, created through the normal sign-up flow, with
confirmed email addresses. **Not a customer's account.**

The project URL and the anon key are read out of `app/index.html` rather than
configured, so the suite necessarily targets the same project the deployed
app talks to. A security test pointed at the wrong project proves nothing and
reads as proof.

## Which project it talks to

The default is **production**, read from `app/index.html`, so the suite
provably targets the project the deployed app uses. A security test pointed
at the wrong project proves nothing and reads as proof.

A staging project is opted into with **both** variables:

```sh
BP_SUPABASE_URL=https://<staging>.supabase.co
BP_SUPABASE_ANON_KEY=<staging anon key>
```

Setting one alone is an error rather than a quiet fallback, because that
pairs a staging address with a production key or the reverse. Every run
prints one line naming its target and whether that target is production.

**`claimMembership.test.js` refuses to run against production** unless
`BP_ALLOW_PRODUCTION_WRITES=1` is set, and it fails rather than skips when
it refuses. It creates accounts and writes entitlement rows, and a staging
project answers the same question without touching the database holding the
paying customers. `crossAccount.test.js` carries no such gate: its writes
are confined to the two test accounts' own row and folder, which is what
any member does by using the app.

Staging wants the same schema, the same policies and the same auth
configuration, in particular the **Confirm email** setting, because the
confirmed-email scenario behaves differently with it off. **Do not copy
customer records or photos into it.** Both suites create everything they
need.

## Every write and delete, in full

Reviewed before enabling anything against production.

### `crossAccount.test.js`

| Operation | Target | Cleanup |
|---|---|---|
| `POST user_data` upsert | account B's own row, id only | left in place, there is no delete policy to remove it with |
| `POST` object | `<B uid>/__rls-probe-<ts>.jpg` | deleted by B in `afterAll` |
| `PATCH user_data` as A | aimed at B's row, **expected to affect nothing** | nothing to clean |
| `POST user_data` as A | carrying B's id, **expected to be refused** | nothing to clean |
| `POST` object as A | into B's folder, **expected to be refused** | deleted if the policy failed and it landed |
| `DELETE` object as A | B's probe object, **expected to be refused** | the object is asserted still present afterwards |

The last four are the negative probes. They are writes only in the sense
that they are attempted; each is asserted to have changed nothing.

### `claimMembership.test.js`

| Operation | Target | Cleanup |
|---|---|---|
| `POST admin/users` | throwaway accounts, `bp-claim-probe-…@example.com` | deleted in `afterAll` |
| `PUT admin/users/<id>` | moves one probe account's address to another probe address | account deleted in `afterAll` |
| `POST members` | one row per probe address | deleted in `afterAll` |
| `PATCH members` | attaches one probe row to its own probe account | row deleted in `afterAll` |
| `rpc claim_membership` | writes `user_id` and `claimed_at`, probe rows only | row deleted in `afterAll` |
| `DELETE members` | probe addresses only | this is the cleanup |
| `DELETE admin/users/<id>` | probe accounts only | this is the cleanup |

Six guards sit under that table:

1. `createUser`, `setUserEmail`, `seedMember`, `readMembers` and
   `deleteMembers` each throw unless the address begins `bp-claim-probe-`.
2. Addresses are minted by `probeEmail()` and never written by hand.
3. `beforeAll` records the total `members` row count and `afterAll` throws
   if it moved.
4. The storage probe name is asserted to carry `__rls-probe-` immediately
   before the delete that targets it.
5. The production gate above, which is a pure function in `gate.js` so that
   the unit suite can test the decision rather than read it.
6. The service key is never echoed into a returned result, because failing
   assertions get pasted into reports.

## What it touches

- Upserts a `user_data` row for account B, keyed to B's own id. This is what
  the app does on every save. The row is left in place, because `user_data`
  has no delete policy to clean it up with and the account is a test account.
- Uploads one object into B's own photo folder, named `__rls-probe-<ts>.jpg`,
  and deletes it afterwards.

Every write and every delete asserts the `__rls-probe-` prefix first, so an
edit that repointed a destructive step at a member's own photo fails the
assertion instead of running.

## Why a missing credential fails instead of skipping

A skipped security test reports green, and green gets read as verified. The
suite is excluded from both default include lists, so it never runs by
accident. Asking for it with `LIVE=1` and no credentials is a
misconfiguration, so it fails and names the variable.

## Why it is not in `test:all` and not in CI

It can fail because of production state rather than because of the code in
the checkout, so it would make a pull request red for a reason the pull
request did not cause. It also needs credentials that should not live in
repository secrets for a public repository.

Run it after any change to a policy, a bucket, an RPC, or the schema, and on
a schedule you keep by hand. Record the date of the last run in the security
report rather than assuming it still holds.

## The assertion shape, and why the naive version is worthless

Row level security does not reject a filtered read. It removes the rows and
returns HTTP 200 with `[]`. So "A asked for B's row and got nothing" is
equally satisfied by B having no row, by a typo in the id, and by an empty
table.

Every negative test is therefore paired with a positive one from the other
session in the same run: B reads its own row and the row is there. A's empty
result is evidence of filtering only because B's non-empty result proves
there was something to filter.

The destructive probes are paired the other way. After A is refused a delete,
B re-reads the object and it is still present, because a server that errored
after performing the delete would satisfy the refusal assertion on its own.
