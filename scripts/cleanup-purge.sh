#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Sovereign — one-shot repo purge
# ---------------------------------------------------------------------------
#
# WHAT THIS DOES:
#   1. Removes committed secrets (files cleared to empty by an earlier pass
#      but still tracked — disk + git).
#   2. Removes ~100 MB of test/benchmark/artifact junk.
#   3. Removes the `AGENT/d:` Windows-path accident.
#   4. Removes corrupt SQLite rotation files.
#   5. Collapses AGENT/.gitignore into the root .gitignore.
#
# WHAT THIS DOES NOT DO:
#   - Rotate API keys or tokens that were previously committed. If anything
#     ever reached `origin`, rotate them. Period.
#   - Rewrite git history. For that: `git filter-repo --invert-paths ...`
#     per file. Coordinate with your team before force-pushing.
#
# USAGE:
#   bash scripts/cleanup-purge.sh                   # dry-run (default)
#   bash scripts/cleanup-purge.sh --apply           # actually delete
#   bash scripts/cleanup-purge.sh --apply --commit  # delete + git commit
#
# ---------------------------------------------------------------------------
set -euo pipefail

APPLY=0
COMMIT=0
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    --commit) COMMIT=1 ;;
    *) echo "unknown arg: $arg"; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "[cleanup] repo root: $ROOT"
[ $APPLY -eq 0 ] && echo "[cleanup] DRY RUN — no files will be deleted"

# ---------------------------------------------------------------------------
# 1. Secret fixtures + accidents
# ---------------------------------------------------------------------------
SECRET_PATHS=(
  "AGENT/temp_secret.txt"
  "AGENT/temp_encoded_exec.ts"
  "AGENT/temp_env_placeholder.env"
  "AGENT/temp_safe.txt"
  "AGENT/.tmp"
  "AGENT/.tmp_deep_test_secrets"
  "AGENT/test-workspace-forensic"
  "AGENT/test-workspace-stress"
)

# ---------------------------------------------------------------------------
# 2. Repo junk
# ---------------------------------------------------------------------------
JUNK_PATHS=(
  "AGENT/d:"
  "AGENT/.ai-company"
  "AGENT/sovereign-benchmark-api"
  "AGENT/ultimate-integrity-benchmark"
  "AGENT/rollup-rollup-linux-x64-gnu-4.59.0.tgz"
  "AGENT/.tmp_stress_test"
  "AGENT/.tmp_stress_test_final"
  "AGENT/.tmp_stress_test_final_v2"
  "AGENT/.tmp_stress_test_new"
  "AGENT/test_e2e_pipeline.ts"
  "AGENT/test-results.txt"
  "AGENT/final_test_report.txt"
  "AGENT/node_modules"
  "AGENT/script"
)

# Glob-based (corrupt DB rotations)
GLOB_PATHS=(
  "AGENT/*.db.corrupt.*"
  "AGENT/test-missions-forensic.db"
)

# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------
remove() {
  local p="$1"
  if [ ! -e "$p" ] && ! compgen -G "$p" > /dev/null; then
    return 0
  fi
  echo "[cleanup] rm -rf $p"
  if [ $APPLY -eq 1 ]; then
    if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      # Use git rm -rf when tracked; otherwise plain rm
      git rm -rf --ignore-unmatch --cached -- $p >/dev/null 2>&1 || true
    fi
    rm -rf -- $p
  fi
}

echo
echo "── Secret fixtures ────────────────────────────────────────────────"
for p in "${SECRET_PATHS[@]}"; do remove "$p"; done

echo
echo "── Repo junk ──────────────────────────────────────────────────────"
for p in "${JUNK_PATHS[@]}"; do remove "$p"; done

echo
echo "── Corrupt DB rotations ──────────────────────────────────────────"
for p in "${GLOB_PATHS[@]}"; do remove "$p"; done

# ---------------------------------------------------------------------------
# 3. Collapse AGENT/.gitignore → root .gitignore
# ---------------------------------------------------------------------------
echo
echo "── .gitignore consolidation ──────────────────────────────────────"
if [ -f "AGENT/.gitignore" ]; then
  echo "[cleanup] consolidate AGENT/.gitignore into root .gitignore"
  if [ $APPLY -eq 1 ]; then
    echo "" >> .gitignore
    echo "# --- Merged from AGENT/.gitignore (consolidated $(date +%Y-%m-%d)) ---" >> .gitignore
    grep -v '^\s*#' AGENT/.gitignore | grep -v '^\s*$' | sort -u | \
      awk '{print "AGENT/" $0}' >> .gitignore
    if command -v git >/dev/null 2>&1; then
      git rm -f --ignore-unmatch AGENT/.gitignore >/dev/null 2>&1 || true
    fi
    rm -f AGENT/.gitignore
  fi
fi

# ---------------------------------------------------------------------------
# 4. Deduplicate root .gitignore
# ---------------------------------------------------------------------------
if [ $APPLY -eq 1 ] && [ -f .gitignore ]; then
  echo "[cleanup] dedupe root .gitignore"
  awk '!seen[$0]++' .gitignore > .gitignore.tmp && mv .gitignore.tmp .gitignore
fi

# ---------------------------------------------------------------------------
# 5. Verify
# ---------------------------------------------------------------------------
echo
echo "── Verification ───────────────────────────────────────────────────"
remaining=0
for p in "${SECRET_PATHS[@]}" "${JUNK_PATHS[@]}"; do
  if [ -e "$p" ]; then
    echo "[verify] STILL PRESENT: $p"
    remaining=$((remaining + 1))
  fi
done

if [ $APPLY -eq 0 ]; then
  echo
  echo "[cleanup] Dry run finished. Re-run with --apply to delete."
  exit 0
fi

if [ $remaining -gt 0 ]; then
  echo "[cleanup] $remaining path(s) still present. Investigate."
  exit 1
fi

echo "[cleanup] All target paths removed."

# ---------------------------------------------------------------------------
# 6. Commit (optional)
# ---------------------------------------------------------------------------
if [ $COMMIT -eq 1 ]; then
  echo
  echo "── git commit ────────────────────────────────────────────────────"
  if command -v git >/dev/null 2>&1; then
    git add -A
    git commit -m "chore(repo): purge committed secrets, 100MB junk, consolidate .gitignore

- rm secret fixtures (temp_*, .tmp, .tmp_deep_test_secrets, test-workspace-*)
- rm 100+ MB of .tmp_stress_test*, .ai-company, benchmarks, rollup tgz
- rm AGENT/d:/PROJECT Windows-path accident
- rm 16 *.db.corrupt.* rotations
- collapse AGENT/.gitignore into root .gitignore"
  fi
fi

echo
echo "[cleanup] Done. Next: rotate any API keys that may have hit origin."
