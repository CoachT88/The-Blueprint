# Rolling back the Stripe launch

The launch moved four things at once: the headline price from $49 to $99,
Stripe from gated to live, Ko-fi from the only purchase path to none, and the
welcome page from claiming access to claiming nothing. They moved together
because any one of them alone leaves the site advertising a price nothing
honours.

**The rollback is a revert of the whole merge. It is not a flag flip.**

## Why the flag is not the rollback

`index.html` carries `var ON = true`. Setting it to `false` used to be the
rollback, because Ko-fi sat behind it and took over. That is no longer so:

- The price copy says **$99** in sixteen places. The Ko-fi product charges
  **$49**. A flag flip that brought the Ko-fi button back would put a $99
  label on a $49 charge — a customer paying half the advertised price for a
  product the ledger would then not recognise.
- With Ko-fi removed, a flag flip alone leaves the price block with no
  purchase path at all.

Both halves are held by tests. `ON = false` on this tree fails the suite, and
restoring the Ko-fi anchor fails it too, so neither half-rollback can be
shipped as a hand edit.

## The rollback, in full

```sh
git revert -m 1 <the merge commit of this PR>
git push origin main
# then deploy
npx wrangler deploy
```

Reverting the merge restores the pre-merge tree exactly: $49 copy, the Ko-fi
button, the old welcome page, the gated Stripe flag. Price label and charged
amount agree again, which is the property that matters.

### Reverting only the switch commit is not a rollback

The PR's last commit is the Stripe/Ko-fi switch; the fifteen before it are
the $49 → $99 sweep. Dropping the switch alone leaves $99 copy pointing at
the $49 Ko-fi product, which is the exact failure the revert exists to
avoid. It was measured, not assumed:

```
git revert 8efb474
grep -c ko-fi.com index.html   -> 1     the $49 product, back
grep -c '$99'      index.html  -> 7     the copy, untouched
grep -c '$49'      index.html  -> 0
npx vitest run tests/checkoutMount.test.js  -> 30 passed
```

Silently green, because that revert takes the tests with it:
`checkoutMount.test.js` was rewritten in the same commit, so undoing the
commit restores the version that permitted Ko-fi. **A test cannot guard the
commit it ships in.**

`tests/purchasePathCoherence.test.js` is the answer, and it is deliberately
in its own commit *after* the switch. A partial revert leaves it standing,
where it fails on the restored Ko-fi link and on the restored in-app Ko-fi
URL. A full revert of the merge removes it along with the $99 copy, which is
correct: $49 copy with a $49 Ko-fi button is coherent.

### What the revert does not undo, and need not

| | |
|---|---|
| `supabase/migrations/20261024090000_purchase_ledger.sql` | Additive. `purchases`, `pre_ledger` and `revoke_if_unpaid()` are inert with no Stripe events arriving. Ko-fi purchases keep recording as before. Do not reverse it: `pre_ledger` is what stops incomplete Ko-fi history costing a member their access. |
| The Worker routes for `/api/stripe-webhook` and `/api/create-checkout-session` | The revert removes them with everything else. Leave the webhook reachable for a few hours first if a payment may be in flight, by reverting `index.html` and the copy ahead of `src/worker.js`. A completed session that never reaches the webhook is money taken with nothing recorded. |
| Stripe secrets on the `the-blueprint` Worker | Harmless once no page creates a session. Remove them only when the decision is permanent. |
| Purchases already recorded | They stay. A Stripe-era buyer has a `purchases` row and a `members` row and keeps access; `claim_membership()` is unchanged by the revert. |

## The degraded state, which is not a rollback

If Stripe itself is the problem and the $99 price must stand, do not bring
Ko-fi back. Clear `PUBLISHABLE`, or unset `STRIPE_PRICE_ID` on the Worker.
The price block then renders

> Checkout could not start, and you have not been charged. **Checkout is not
> configured right now.** Try again, or email …

with the support address, instead of a dead button or a wrong price. That is
a deliberate closed shop with a way to reach a person, and it is the right
state to sit in while a Stripe problem is diagnosed.
