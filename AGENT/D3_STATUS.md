# D3 — Critical Bug Remediation — Status

Phase D3 of `REMEDIATION_PLAN.md` closes out the six bugs recorded in
`BUG_REPORT.md`. Scope: fix each bug at the code level and add a pinned
regression test. This document is the final hand-off for the phase.

## Fixes in place

### Bug #1 — Token bucket fractional accumulation
No code change required. The public `TokenBucketTracker.getTokens()` in
`src/plugin/rotation.ts` already returns `Math.floor(state.tokens)`, so the
external API boundary is integer-safe. The internal `state.tokens`
intentionally keeps fractional accrual. Regression pinned by
`d3-regression.test.ts → "getTokens() floors the fractional internal state"`.

### Bug #2 — Negative health score
No code change required. `HealthScoreTracker.clampScore()` already wraps
`clampNumber(score, 0, maxScore)`, so every mutation floor-clips at zero.
Regression pinned by `d3-regression.test.ts → "recordFailure floors at zero
even under a long failure streak"`.

### Bug #3 — Account index OOB after removal (`?? 0` misses `-1`)
Fixed in `src/plugin/accounts.ts` around line 614. `removeAccount()` sets
`currentAccountIndexByFamily[family] = -1` when the family's last account
is gone; the nullish-coalescing default (`?? 0`) does NOT catch the `-1`
sentinel. When PID offset was enabled, `(-1 + pidOffset) % length` could
produce a negative `newIndex` (e.g. `pid % len === 0`), which then
dereferenced `accounts[-1]` as `undefined`. The fix normalizes `-1` /
out-of-range values to `0` before applying the PID offset. Regression
pinned by `d3-regression.test.ts → "handles '-1' current-index sentinel
without returning undefined"` and the specific `(-1 + 0) % len === -1`
case.

### Bug #4 — Queue shift without revalidation
No code change required (the defensive pattern was already in place in
`src/plugin/request.ts:1249`). The comment-encoding mojibake was cleaned up
during this phase for readability.

### Bug #5 — Recursive JSON auto-parsing infinite loop
No code change required. `recursivelyParseJsonStrings` in
`src/plugin/request-helpers.ts` already bounds recursion with
`MAX_RECURSIVE_DEPTH = 10` and uses a `WeakMap<object, unknown>` cache to
short-circuit cyclic graphs. Regression pinned by
`d3-regression.test.ts → "returns without stack-overflow on a deeply
nested JSON-encoded string"` and the cyclic-graph test.

### Bug #6 — File locking race / non-durable rename
Fixed in `src/plugin/storage.ts`:

1. **`writeFileAtomicDurable(path, tempPath, content)`** — new helper that
   runs `writeFile → fd.sync() → rename` plus a best-effort directory
   `fsync`. Prevents the classic "rename committed, bytes still in page
   cache" failure mode.
2. **`cleanupOrphanedTempFiles()` + `ensureTempCleanup()`** — memoized
   startup sweep that removes crashed-writer `.tmp` files older than a
   60-second grace window. Called from both `saveAccounts()` and
   `deleteAccount()` — every entrypoint into the write path.
3. **`LOCK_OPTIONS`** — `stale` bumped from 10 s → 30 s, `retries` from 5 →
   7, `minTimeout` from 100 ms → 150 ms, `maxTimeout` from 1 s → 2 s. Gives
   contended systems room to complete a legitimate write before the lock
   is forcibly broken.

Regression pinned by `d3-regression.test.ts → "removes orphaned .tmp
files older than the grace window on first save"`.

## Files touched in this phase

- `src/plugin/accounts.ts` — Bug #3 fix around the PID-offset block.
- `src/plugin/request.ts` — Bug #4 comment cleanup (no behavior change).
- `src/plugin/storage.ts` — Bug #6 fixes (durable writer, orphan sweep,
  tuned lock options).
- `src/plugin/d3-regression.test.ts` — NEW: pinned regressions for all six
  bugs.

## Blocking item discovered — NOT part of D3

`tsc --noEmit` reports parse errors in roughly sixty source files (the
same mid-token truncation pattern we saw and repaired in `auth-menu.ts`
and `cli.ts` during D2). A sample of the damage:

```
src/plugin/accounts.ts(1194,1):   // EOF after a dangling inline comment
src/plugin/storage.ts(917,14):    // ends at "// STRICT: ...<NL>conte"
src/plugin/rotation.ts(547,41):   // ends mid-JSDoc "Get the global heal"
src/plugin/request.ts(1693,79):   // ends mid "// Note: successful ... TransformStr"
src/plugin/key-manager.ts:        // trailing invalid/null bytes
```

These files are NOT part of BUG_REPORT.md. The damage predates the D3
phase and was inherited from the upstream source snapshot. It blocks
`npm run typecheck`, `npm run lint`, and `npm run build`, but the D3
regression tests themselves are syntactically valid — they will run the
moment the wider typecheck is unblocked.

## Recommended next phase — D3.5 "File-Truncation Repair"

Before D5 can run CI end-to-end, each truncated file needs to be
reconstructed. Suggested process per file:

1. Read the upstream git blob (or the file as it exists in the previous
   session's transcript) to recover the tail.
2. Confirm the recovery by running `tsc --noEmit -p tsconfig.json`
   filtering on the file.
3. If upstream state is unavailable, reconstruct the tail from its
   surrounding signatures and the places that call into it.

The list of affected files is available from the typecheck output above;
the truncation is consistent (always at EOF, always mid-token) so a bulk
automated repair pass driven by the TS parser would also be viable.

## Regression test wiring

`d3-regression.test.ts` uses only the public API of the modules it
exercises (`AccountManager`, `TokenBucketTracker`, `HealthScoreTracker`,
`recursivelyParseJsonStrings`, `saveAccounts`). It creates temp dirs under
`os.tmpdir()` for the storage test and honours the `OPENCODE_CONFIG_DIR`
override so it never touches the developer's real config. Each `describe`
block documents the exact BUG_REPORT.md entry it guards.
