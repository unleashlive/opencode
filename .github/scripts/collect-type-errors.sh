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
TURBO_FORCE=true bun run typecheck > "$raw" 2>&1 || true

# tsgo lines:  path/to/file.ts(12,34): error TS2741: Property 'x' is missing ...
# turbo prefixes them with "pkg:typecheck: "; the -oE match starts at the path,
# dropping the prefix, so signatures compare cleanly across the two checkouts.
# Strip the (line,col) so a signature is { file + TS code + message }.
grep -oE '[^ ]+\.(ts|tsx)\([0-9]+,[0-9]+\): error TS[0-9]+:.*' "$raw" \
  | sed -E 's/\([0-9]+,[0-9]+\)//' \
  | sort -u
