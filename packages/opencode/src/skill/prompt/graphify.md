# Graphify

Graphify (https://github.com/safishamsi/graphify) turns the current repository
into a queryable **knowledge graph** of code, docs, and their relationships.
This fork auto-initializes a code-only graph (offline, AST via tree-sitter, no
API key) in the background for every git repo opened through opencode. The graph
lives in `graphify-out/` at the project root.

```
graphify-out/
├── graph.json        the full graph — query it without re-reading files
├── GRAPH_REPORT.md   highlights: key concepts, surprising links, questions
└── graph.html        interactive viewer (if visualization was built)
```

## When to use this skill

Use Graphify FIRST for any question about how the codebase fits together:
"where is X handled", "what connects A to B", "what calls this", "what is the
architecture", "what would break if I change this". A scoped graph query is
faster and cheaper than grepping/globbing/reading many files one by one.

Only fall back to raw search (grep/glob/read) when:
- `graphify-out/graph.json` does not exist, or
- the question is a precise needle (an exact symbol/string in a known file).

## How to query the graph

Check the graph exists first (`graphify-out/graph.json`), then run:

```
graphify query "what connects auth to the database?"
graphify path "UserService" "DatabasePool"     # how two nodes relate
graphify explain "RateLimiter"                  # everything about one node
graphify affected "RateLimiter"                 # what breaks if you change it
```

For a broad architecture overview, read `graphify-out/GRAPH_REPORT.md` — it
lists the most-connected "god nodes", surprising cross-module links, and the
design "why" pulled from comments and docs.

If `graphify` is not on PATH, try `python3 -m graphify <args>`.

## Building / refreshing the graph

The graph is built automatically on first open (code-only, offline, no API
key). To rebuild manually:

```
graphify update .                  # re-extract code files, no LLM needed
graphify update . --force          # overwrite even if it shrinks
```

`graphify extract .` is the heavier path that ALSO does semantic LLM
extraction of docs/PDFs/images and needs an API backend (`--backend claude`
etc.). The offline default here intentionally uses `update`.

To install the git post-commit hook so the graph auto-rebuilds (AST only, no
API cost) after each commit:

```
graphify hook install
```

## Notes

- Code extraction is fully local. Docs/PDFs/images need an LLM backend and are
  skipped by the offline default.
- Auto-init can be turned off with `OPENCODE_GRAPHIFY_AUTO_INIT=0`, and the
  whole integration with `OPENCODE_GRAPHIFY_DISABLE=1`.
