#!/usr/bin/env bash
#
# Collect TypeScript error "signatures" from the workspace typecheck, with the
# (line,column) stripped so a signature stays stable when unrelated edits shift
# line numbers.  Prints one signature per line, sorted + de-duped, to stdout.
#
# Used by .github/workflows/typecheck.yml as a RATCHET: the signature set on the
# PR head is diffed against the set on the base branch, and only signatures that
# are NEW on head fail the build.  That lets the fork's ~20 pre-existing TS
# errors (Drizzle drift, date/number mixups — see parse-smoke.yml) pass through
# while still catching any error a PR introduces (e.g. the TS2741 that slipped
# into PR #45 because parse-smoke only checks syntax, not types).
#
# This script never fails on type errors — it always exits 0.  The workflow
# does the pass/fail decision via the base-vs-head diff.  TURBO_FORCE bypasses
# turbo's cache so the task actually re-runs in each checkout.
set -uo pipefail

raw="$(mktemp)"
trap 'rm -f "$raw"' EXIT

# `bun run typecheck` → `bun turbo typecheck` → each package's `tsgo --noEmit`.
TURBO_FORCE=true bun run typecheck > "$raw" 2>&1
rc=$?

# Diagnostics to stderr (shows in the step log, never touches the stdout the
# workflow parses).  A non-zero rc is EXPECTED when there are type errors —
# tsgo exits non-zero on errors.  But if rc is non-zero AND the output carries
# no turbo task lines at all, the typecheck never actually ran (tooling/setup
# failure) and the caller is about to mistake "0 errors" for "didn't run" —
# make that loud.
if ! grep -qE ':typecheck:|Tasks:[[:space:]]+[0-9]' "$raw"; then
  echo "WARNING(collect-type-errors): typecheck output has no turbo task lines (rc=$rc) — the type checker likely did NOT run in this checkout." >&2
  echo "---- first 20 lines of raw typecheck output ----" >&2
  head -20 "$raw" >&2
  echo "------------------------------------------------" >&2
fi

# tsgo lines:  path/to/file.ts(12,34): error TS2741: Property 'x' is missing ...
# turbo prefixes them with "pkg:typecheck: "; the -oE match starts at the path,
# dropping the prefix, so signatures compare cleanly across the two checkouts.
# Strip the (line,col) so a signature is { file + TS code + message }.
#
# The trailing `|| true` keeps the script's "always exits 0" contract: grep
# exits 1 when it finds NO matching lines (a clean checkout, or a checkout where
# typecheck didn't run), and without the guard that non-zero — being the script's
# last command — would propagate out and fail the step under `bash -e`.
grep -oE '[^ ]+\.(ts|tsx)\([0-9]+,[0-9]+\): error TS[0-9]+:.*' "$raw" \
  | sed -E 's/\([0-9]+,[0-9]+\)//' \
  | sort -u \
  || true

exit 0
