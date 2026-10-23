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
