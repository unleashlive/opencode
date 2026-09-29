#!/bin/sh
# Container entrypoint for the collab fork.
#
# Claude credentials lifecycle (two-tier storage):
#
#   PERSISTENT path (preferred): /home/opencode/.local/share/opencode/claude-credentials.json
#       Lives on the EFS SQLite volume.  Survives container replacement, so
#       plugin token-refresh writes stay valid across ECS task rollouts.
#       Requires the EFS access point to be configured with posix_user 10001
#       (ADR-0003 migration).
#
#   LOCAL fallback: /home/opencode/.claude/.credentials.json
#       Container's local filesystem.  Used when the persistent path is
#       NOT writable (EFS not yet chowned to uid 10001).  Doesn't survive
#       container replacement — operator has to re-upload via /collab/new
#       after every task rollout — but at least the server BOOTS.
#
#   The opencode-claude-auth plugin reads the LOCAL path.  When persistent
#   is writable, LOCAL is a symlink to PERSISTENT.  When persistent fails,
#   LOCAL is a regular file.  Either way, the plugin's read works.
#
# This script MUST NOT crash the container on credential-setup failure.
# A crashed container puts ECS in a restart loop that fails the "service
# stable" gate in the deploy workflow.  We deliberately use `set -u` only
# (no -e) and wrap every credential operation so a permission denied on EFS
# logs a WARN and continues.
#
# Operator credential rotation:
#   1. Use the in-app UI (any unleashlive org member can paste their Mac's
#      credentials JSON at /collab/new).  Atomic-writes to the canonical
#      path (persistent if EFS is writable, local fallback otherwise).
#   2. OR update the Secrets Manager entry + delete the persistent file
#      so the next task boot re-seeds from Secrets Manager.

set -u

HOME_DIR="${HOME:-/home/opencode}"
CANONICAL="$HOME_DIR/.claude/.credentials.json"
EFS_CREDS="$HOME_DIR/.local/share/opencode/claude-credentials.json"

# Always create the LOCAL .claude dir (container FS, owned by uid 10001
# via the Dockerfile chown — this is guaranteed writable).
mkdir -p "$HOME_DIR/.claude" 2>/dev/null || \
  echo "[entrypoint] WARN: could not create $HOME_DIR/.claude (permissions?)"

# Probe whether the EFS path is writable.  EFS access points mount as
# uid 0/gid 0 today; uid 10001 can read but not write.  ADR-0003 calls
# for fixing the access point's posix_user to 10001 — until that lands,
# fall back to the LOCAL path.
EFS_DIR="$(dirname "$EFS_CREDS")"
if mkdir -p "$EFS_DIR" 2>/dev/null && touch "$EFS_DIR/.write-probe" 2>/dev/null; then
  rm -f "$EFS_DIR/.write-probe" 2>/dev/null || true
  EFS_WRITABLE=1
  echo "[entrypoint] EFS path $EFS_DIR is writable — credentials will persist across container restarts"
else
  EFS_WRITABLE=0
  echo "[entrypoint] WARN: $EFS_DIR is not writable as uid $(id -u) — falling back to LOCAL credentials at $CANONICAL.  See ADR-0003 (EFS access point posix_user) for the proper fix; until then, credentials reset on every container restart."
fi

# Seed credentials from env if provided.
#
# When EFS is writable: write to EFS, then symlink CANONICAL → EFS.
# When EFS is NOT writable: write directly to CANONICAL (local).
if [ -n "${CLAUDE_CREDENTIALS_JSON:-}" ]; then
  if [ "$EFS_WRITABLE" = "1" ] && [ ! -s "$EFS_CREDS" ]; then
    if printf '%s' "$CLAUDE_CREDENTIALS_JSON" > "$EFS_CREDS" 2>/dev/null; then
      chmod 0600 "$EFS_CREDS" 2>/dev/null || true
      echo "[entrypoint] seeded EFS path ($(wc -c < "$EFS_CREDS" 2>/dev/null || echo "?") bytes)"
    else
      echo "[entrypoint] WARN: EFS probe passed but write failed; falling back to LOCAL"
      EFS_WRITABLE=0
    fi
  elif [ "$EFS_WRITABLE" = "1" ] && [ -s "$EFS_CREDS" ]; then
    echo "[entrypoint] $EFS_CREDS already present — keeping existing"
  fi

  # Local-fallback seed: write directly to CANONICAL if EFS path isn't usable.
  if [ "$EFS_WRITABLE" != "1" ] && [ ! -s "$CANONICAL" ]; then
    if printf '%s' "$CLAUDE_CREDENTIALS_JSON" > "$CANONICAL" 2>/dev/null; then
      chmod 0600 "$CANONICAL" 2>/dev/null || true
      echo "[entrypoint] seeded LOCAL path ($(wc -c < "$CANONICAL" 2>/dev/null || echo "?") bytes) — will reset on next container restart"
    else
      echo "[entrypoint] WARN: could not write $CANONICAL either; server will boot without Claude creds"
    fi
  fi
fi

# Symlink CANONICAL → EFS so plugin reads + token-refresh writes land on the
# persistent file.  Only do this when EFS is actually usable; otherwise leave
# CANONICAL as a regular file (the local fallback above).
if [ "$EFS_WRITABLE" = "1" ] && [ -e "$EFS_CREDS" ]; then
  # Tolerate: a stale symlink from a prior boot, a regular file from an older
  # entrypoint version, or nothing.  Never the literal file we're about to
  # link to.
  rm -f "$CANONICAL" 2>/dev/null || true
  if ln -s "$EFS_CREDS" "$CANONICAL" 2>/dev/null; then
    echo "[entrypoint] linked $CANONICAL -> $EFS_CREDS"
  else
    echo "[entrypoint] WARN: could not symlink $CANONICAL -> $EFS_CREDS"
  fi
fi

# Export the resolved writable path for the server.  The Node side reads this
# in claude-credentials.ts to decide where to atomic-write UI uploads, so the
# server and entrypoint agree on the file's location.
if [ "$EFS_WRITABLE" = "1" ]; then
  export CLAUDE_CREDENTIALS_PATH="$EFS_CREDS"
else
  export CLAUDE_CREDENTIALS_PATH="$CANONICAL"
fi
echo "[entrypoint] CLAUDE_CREDENTIALS_PATH=$CLAUDE_CREDENTIALS_PATH"

# Git "dubious ownership" workaround.  EFS access points (terraform/opencode-
# collab/efs.tf) currently mount with uid=0/gid=0, while the container runs
# as uid 10001 (ADR-0003).  Git 2.35+ refuses operations on a repo whose
# .git directory isn't owned by the current uid — clone works because git
# creates the .git dir itself, but subsequent push/log/diff calls fail with
# "fatal: detected dubious ownership".  Wildcard '*' tells git to trust any
# directory; safe enough on this single-tenant container.
# Proper fix is to align the EFS access point posix_user.uid with the
# container uid; tracked separately.
git config --global --add safe.directory '*' 2>/dev/null || true

# Start Ollama local inference server.
# Models are stored on EFS so they survive container restarts.
# Model pulls run in the background so opencode (and the ECS /healthz endpoint)
# start immediately — the first LLM request will block until the model is ready.
if command -v ollama >/dev/null 2>&1; then
  export OLLAMA_MODELS="${HOME_DIR}/.local/share/opencode/ollama"
  export OLLAMA_HOST=127.0.0.1:11434
  export OLLAMA_NUM_PARALLEL=2
  # Pin thread count to the task's vCPU allocation.  Without this, llama.cpp
  # auto-detects physical cores which may under-count in a Fargate cgroup.
  export OLLAMA_NUM_THREAD=4

  mkdir -p "$OLLAMA_MODELS" 2>/dev/null || true

  echo "[ollama] starting server…"
  ollama serve &

  # Wait up to 30s for the Ollama API to accept connections.
  _OLLAMA_READY=0
  for _i in $(seq 1 30); do
    if curl -sf http://127.0.0.1:11434/v1/models >/dev/null 2>&1; then
      _OLLAMA_READY=1
      break
    fi
    sleep 1
  done

  if [ "$_OLLAMA_READY" = "1" ]; then
    # Pull models then pre-warm — all in background so ECS health check isn't
    # delayed.  On first boot this downloads ~4.5 GB per model to EFS; subsequent
    # boots detect the cached files and skip straight to the pre-warm step.
    # Pre-warming loads the default model (qwen3:8b-q4_K_M) into RAM by running a
    # trivial 1-token generation.  Without this, the first real user request would
    # block for 90–120 s while the 5.2 GB weights are paged in from EFS.  After
    # the pre-warm the model stays resident (keep_alive is Ollama's default 5 min
    # extended by any subsequent request) so chat responses start immediately.
    (
      for _MODEL in "qwen3:8b-q4_K_M" "qwen2.5-coder:7b-instruct-q4_K_M"; do
        _SHORT="${_MODEL%%:*}"
        if ! ollama list 2>/dev/null | grep -q "$_SHORT"; then
          echo "[ollama] pulling $_MODEL (first boot, ~4.5 GB — will complete in background)…"
          ollama pull "$_MODEL" \
            && echo "[ollama] $_MODEL ready" \
            || echo "[ollama] WARNING: pull failed for $_MODEL — retry on next boot"
        else
          echo "[ollama] $_MODEL already cached on EFS"
        fi
      done

      # Create a no-think variant of qwen3 so the default model responds
      # immediately without generating hidden reasoning tokens.  think=false
      # is a Qwen3-specific Ollama parameter; without it the model runs
      # chain-of-thought internally before producing any visible output,
      # which adds latency proportional to reasoning complexity.
      _MODELFILE="$OLLAMA_MODELS/.qwen3-fast.Modelfile"
      printf 'FROM qwen3:8b-q4_K_M\nPARAMETER think false\nPARAMETER num_thread 4\n' \
        > "$_MODELFILE" 2>/dev/null || true
      if [ -s "$_MODELFILE" ]; then
        if ollama create qwen3-fast:8b -f "$_MODELFILE" >/dev/null 2>&1; then
          echo "[ollama] qwen3-fast:8b created (thinking disabled)"
          # Promote qwen3-fast to the active default so new sessions use it.
          # The baked opencode.json ships with qwen3:8b-q4_K_M as a safe
          # fallback; once the fast variant exists we swap the "model" field.
          _CFG=/home/opencode/.config/opencode/opencode.json
          if command -v python3 >/dev/null 2>&1 && [ -s "$_CFG" ]; then
            python3 -c "
import json, sys
with open('$_CFG') as f: cfg = json.load(f)
cfg['model'] = 'collab-local/qwen3-fast:8b'
with open('$_CFG', 'w') as f: json.dump(cfg, f)
" 2>/dev/null && echo "[ollama] opencode.json default updated to qwen3-fast:8b" \
              || echo "[ollama] WARNING: could not patch opencode.json — keeping qwen3 base as default"
          fi
        else
          echo "[ollama] WARNING: could not create qwen3-fast:8b — using qwen3 base"
        fi
      fi

      # Pre-warm the active default into RAM.  keep_alive:-1 loads weights
      # without running inference — avoids the 90–120 s EFS page-fault
      # penalty on first real user request.
      _WARM_MODEL="qwen3:8b-q4_K_M"
      if ollama list 2>/dev/null | grep -q "qwen3-fast"; then
        _WARM_MODEL="qwen3-fast:8b"
      fi
      echo "[ollama] pre-warming $_WARM_MODEL into RAM…"
      curl -sf http://127.0.0.1:11434/api/generate \
        -d "{\"model\":\"$_WARM_MODEL\",\"keep_alive\":-1}" \
        >/dev/null 2>&1 \
        && echo "[ollama] model warm — first user request will be fast" \
        || echo "[ollama] WARNING: pre-warm failed — first request may be slow"
    ) &
  else
    echo "[ollama] WARNING: server did not respond within 30s — local models unavailable"
  fi
fi

# Hand off to the real server.  $@ propagates whatever args ECS / CMD passed.
exec bun run --cwd packages/opencode src/index.ts serve \
  --port 4096 --hostname 0.0.0.0 --print-logs "$@"
