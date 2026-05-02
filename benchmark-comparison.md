# Full Scan Benchmark Comparison

Use the extension settings button **Run Full Scan Benchmark** to run a fresh scan of all supported platforms and automatically download a JSON report.

## Current Working Tree

1. Build and load the extension from this working tree.
2. Open Commsfinder settings.
3. Press **Run Full Scan Benchmark**.
4. Keep the extension window open until the report downloads.
5. Save the downloaded `commsfinder-current-working-tree-*.json` report.

## Baseline Commit

The requested baseline commit is:

```text
83ac85a3aab6d73788ec5de42eda2be0ba77ac9a
```

That commit does not include `benchmark.js`, so run the same benchmark harness on top of the baseline code before comparing results.

Recommended workflow:

```powershell
git worktree add ..\commsfinder-benchmark-83ac85a 83ac85a3aab6d73788ec5de42eda2be0ba77ac9a
```

Then copy or apply only the benchmark harness changes into that worktree, build/load the baseline extension from `..\commsfinder-benchmark-83ac85a`, and press **Run Full Scan Benchmark** there. Use the same browser profile, extension settings, logged-in accounts, model cache state, and network connection for both runs.

## Comparing Reports

Compare these top-level fields first:

- `run.wallClockSeconds`: actual end-to-end scan time.
- `run.resultCount`: stored artist result count after duplicate merging.
- `run.totalProfileCount`: total profiles processed by platform scanners.
- `platformResults[*].totalTimeSeconds`: content-script scanner time per platform.
- `platformResults[*].steps`: detailed timing breakdown by scan step.

For a fair result, run each build at least three times and compare medians.
