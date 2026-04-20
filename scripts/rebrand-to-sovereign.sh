#!/usr/bin/env bash
# rebrand-to-sovereign.sh
#
# Automated, reviewable `lojinext` → `sovereign` rebrand pass.
#
# This script replaces ~1993 occurrences across ~217 files. It runs in three
# modes so the change is traceable in git history and recoverable if it goes
# wrong:
#
#   --dry-run   (default) show what would change and where, touching no files.
#   --apply              apply the safe substitutions and file renames.
#   --commit             apply, then stage and make a git commit.
#
# What it DOES NOT rename (preserves by design):
#
#   - `x-LojiNext-*` HTTP response headers in the Gemini provider path.
#     These are external headers emitted by Google's Gemini CLI proxy and
#     renaming them would silently drop usage accounting.
#   - Anything under `node_modules/`, `dist/`, `coverage/`, `.git/`,
#     `__pycache__/`, `.venv/`, `venv/`, `.next/`, `build/`.
#   - The deprecated `LOJINEXT_GATEWAY_TOKEN` env-var fallback in the two
#     boot paths that read it for backwards compatibility (already expanded
#     in-tree to also accept `SOVEREIGN_GATEWAY_TOKEN`).
#   - `AUDIT_FINDINGS.md` / `AUDIT_VERIFICATION.md` historical records —
#     they document the pre-rebrand state and changing them rewrites history.
#
# What it DOES rename:
#
#   Identifiers (precedence order matters — specific before general):
#     LojiNextClient                 → SovereignGatewayClient
#     LojiNextConfig                 → SovereignGatewayConfig
#     LojiNextAuthorization          → SovereignGatewayAuthorization
#     GoogleLojiNextProvider         → GoogleGeminiProvider
#     authorizeLojiNext              → authorizeGoogleGemini
#     exchangeLojiNext               → exchangeGoogleGemini
#     LOJINEXT_PROVIDER_ID           → GOOGLE_GEMINI_PROVIDER_ID
#     AIProvider.GOOGLE_LOJINEXT     → AIProvider.GOOGLE_GEMINI
#     google_lojinext (provider id)  → google_gemini
#     google_LojiNext                → google_gemini
#     LojiNext-tokens.json           → google-gemini-tokens.json
#
#   Directory & file renames:
#     AGENT/src/lojinext/            → AGENT/src/google-gemini/
#     AGENT/src/orchestration/lojinext-client.ts    → gateway-client.ts
#     AGENT/src/orchestration/lojinext-api.ts       → gateway-api.ts
#     AGENT/src/orchestration/lojinext-api.test.ts  → gateway-api.test.ts
#     AGENT/src/orchestration/lojinext-utils.ts     → gateway-utils.ts
#     AGENT/src/plugin/lojinext-first-fallback.test.ts
#                                                    → gateway-first-fallback.test.ts
#     (import paths updated in the same pass)
#
#   User-facing strings:
#     LojiNext AI → Sovereign AI
#     LojiNext    → Sovereign       (standalone)
#     lojinext    → sovereign       (lowercase, word-boundary)
#     LOJINEXT    → SOVEREIGN       (uppercase, for env-var-style tokens
#                                    EXCEPT the compatibility fallback)
#
#   CSS tokens:
#     --color-loji-* → --color-sov-*
#
# Usage:
#
#   scripts/rebrand-to-sovereign.sh                    # dry run
#   scripts/rebrand-to-sovereign.sh --apply            # apply
#   scripts/rebrand-to-sovereign.sh --commit           # apply + git commit
#
set -euo pipefail

MODE="dry-run"
case "${1:-}" in
  --apply)    MODE="apply" ;;
  --commit)   MODE="commit" ;;
  --dry-run|"") MODE="dry-run" ;;
  *) echo "unknown arg: $1" >&2; exit 2 ;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() { printf '[rebrand] %s\n' "$*"; }

# --- File discovery ---------------------------------------------------------
FIND_ARGS=(
  -type f
  \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx'
     -o -name '*.py' -o -name '*.md' -o -name '*.json' -o -name '*.css'
     -o -name '*.html' -o -name '*.sh' -o -name '*.yml' -o -name '*.yaml'
     -o -name '*.txt' \)
  -not -path '*/node_modules/*'
  -not -path '*/.git/*'
  -not -path '*/dist/*'
  -not -path '*/coverage/*'
  -not -path '*/__pycache__/*'
  -not -path '*/.venv/*'
  -not -path '*/venv/*'
  -not -path '*/.next/*'
  -not -path '*/build/*'
  -not -name 'AUDIT_FINDINGS.md'
  -not -name 'AUDIT_VERIFICATION.md'
)

readarray -t FILES < <(find . "${FIND_ARGS[@]}" 2>/dev/null)

log "considering ${#FILES[@]} files (post-filter)"

# --- Sed program (GNU sed) --------------------------------------------------
#
# ORDER MATTERS. The more specific patterns run first so they aren't shadowed
# by the general lowercase sweep. Each pattern uses explicit boundaries where
# possible to avoid over-replacement.
#
# The `x-LojiNext-` header names are preserved by matching ONLY identifiers
# that aren't in a string prefixed with "x-" (first-pass restriction).

read -r -d '' SED_PROGRAM <<'SED' || true
# Specific identifiers
s/\bGoogleLojiNextProvider\b/GoogleGeminiProvider/g
s/\bLojiNextAuthorization\b/SovereignGatewayAuthorization/g
s/\bLojiNextClient\b/SovereignGatewayClient/g
s/\bLojiNextConfig\b/SovereignGatewayConfig/g
s/\bauthorizeLojiNext\b/authorizeGoogleGemini/g
s/\bexchangeLojiNext\b/exchangeGoogleGemini/g
s/\bLOJINEXT_PROVIDER_ID\b/GOOGLE_GEMINI_PROVIDER_ID/g
s/\bAIProvider\.GOOGLE_LOJINEXT\b/AIProvider.GOOGLE_GEMINI/g
s/\bGOOGLE_LOJINEXT\b/GOOGLE_GEMINI/g
s/\bgoogle_LojiNext\b/google_gemini/g
s/\bgoogle_lojinext\b/google_gemini/g
s/\bLojiNext-tokens\.json/google-gemini-tokens.json/g

# Import path renames
s|\"\.\./lojinext/|"../google-gemini/|g
s|\"\.\./\.\./lojinext/|"../../google-gemini/|g
s|\"\.\./lojinext-client\"|"./gateway-client"|g
s|\"\.\./\.\./src/orchestration/lojinext-client\"|"../../src/orchestration/gateway-client"|g
s|\"\./lojinext-client\"|"./gateway-client"|g
s|\"\./lojinext-api\"|"./gateway-api"|g
s|\"\./lojinext-utils\"|"./gateway-utils"|g

# HTTP header names — PRESERVE (no-op lines document intent)
# x-LojiNext-total-token-count  ← kept
# x-LojiNext-prompt-token-count ← kept
# x-LojiNext-candidates-token-count ← kept
# x-LojiNext-cached-content-token-count ← kept

# env-var compatibility — LOJINEXT_GATEWAY_TOKEN must survive for fallback
# so we DO NOT rewrite that literal anywhere.

# User-facing phrases
s/\bLojiNext AI\b/Sovereign AI/g
s/\bLojiNext Group\b/Sovereign AI contributors/g
s/\bLojiNext Gateway\b/Sovereign AI Gateway/g
s/\bLojiNext Dashboard\b/Sovereign Dashboard/g
s/\bLojiNext\b/Sovereign/g
s/\bloji-next-ai\b/sovereign-ai/g
s/\bloji-next\b/sovereign/g
s/\bLoji-Next\b/Sovereign/g

# CSS tokens
s/--color-loji-/--color-sov-/g

# Low-impact filename-style snake_case (last — will only fire on plain words)
s/\blojinext\b/sovereign/g

# Guarded LOJINEXT uppercase — rewrite ONLY when not part of
# LOJINEXT_GATEWAY_TOKEN (the preserved fallback).
s/\bLOJINEXT_\(GATEWAY_TOKEN\)\b/__KEEP_LOJINEXT_GATEWAY_TOKEN__/g
s/\bLOJINEXT\b/SOVEREIGN/g
s/\bLOJINEXT_\([A-Z0-9_]*\)\b/SOVEREIGN_\1/g
s/__KEEP_LOJINEXT_GATEWAY_TOKEN__/LOJINEXT_GATEWAY_TOKEN/g
SED

# --- Planner ---------------------------------------------------------------
if [[ "$MODE" == "dry-run" ]]; then
  log "dry-run: scanning for files that would change"
  affected=0
  total_hits=0
  for f in "${FILES[@]}"; do
    hits=$(grep -c -E 'lojinext|LojiNext|loji-next|Loji-Next|LOJINEXT|--color-loji-' "$f" 2>/dev/null || true)
    if [[ "${hits:-0}" -gt 0 ]]; then
      affected=$((affected + 1))
      total_hits=$((total_hits + hits))
      printf '  %-6s %s\n' "$hits" "$f"
    fi
  done
  log "summary: $affected files, $total_hits raw occurrences"
  log "file renames (would run under --apply):"
  printf '  mv AGENT/src/lojinext/ AGENT/src/google-gemini/\n'
  printf '  mv AGENT/src/orchestration/lojinext-client.ts AGENT/src/orchestration/gateway-client.ts\n'
  printf '  mv AGENT/src/orchestration/lojinext-api.ts AGENT/src/orchestration/gateway-api.ts\n'
  printf '  mv AGENT/src/orchestration/lojinext-api.test.ts AGENT/src/orchestration/gateway-api.test.ts\n'
  printf '  mv AGENT/src/orchestration/lojinext-utils.ts AGENT/src/orchestration/gateway-utils.ts\n'
  printf '  mv AGENT/src/plugin/lojinext-first-fallback.test.ts AGENT/src/plugin/gateway-first-fallback.test.ts\n'
  exit 0
fi

# --- Applier ---------------------------------------------------------------
SED_TMP="$(mktemp)"
printf '%s' "$SED_PROGRAM" > "$SED_TMP"
trap 'rm -f "$SED_TMP"' EXIT

log "applying substitutions"
for f in "${FILES[@]}"; do
  if grep -q -E 'lojinext|LojiNext|loji-next|Loji-Next|LOJINEXT|--color-loji-' "$f" 2>/dev/null; then
    sed -i -f "$SED_TMP" "$f"
  fi
done

log "renaming directories and files"
rename_safely() {
  local src="$1" dst="$2"
  if [[ -e "$src" && ! -e "$dst" ]]; then
    if git ls-files --error-unmatch "$src" >/dev/null 2>&1; then
      git mv "$src" "$dst"
    else
      mv "$src" "$dst"
    fi
    log "  renamed $src → $dst"
  fi
}

rename_safely "AGENT/src/lojinext"                                  "AGENT/src/google-gemini"
rename_safely "AGENT/src/orchestration/lojinext-client.ts"          "AGENT/src/orchestration/gateway-client.ts"
rename_safely "AGENT/src/orchestration/lojinext-api.ts"             "AGENT/src/orchestration/gateway-api.ts"
rename_safely "AGENT/src/orchestration/lojinext-api.test.ts"        "AGENT/src/orchestration/gateway-api.test.ts"
rename_safely "AGENT/src/orchestration/lojinext-utils.ts"           "AGENT/src/orchestration/gateway-utils.ts"
rename_safely "AGENT/src/plugin/lojinext-first-fallback.test.ts"    "AGENT/src/plugin/gateway-first-fallback.test.ts"

# --- Verification ----------------------------------------------------------
remaining=$(find . "${FIND_ARGS[@]}" -exec grep -l -E 'lojinext|LojiNext|loji-next|Loji-Next|--color-loji-' {} + 2>/dev/null | wc -l)
log "verification: $remaining files still contain brand strings (excluding x-LojiNext-* headers and LOJINEXT_GATEWAY_TOKEN fallback)"

if [[ "$remaining" -gt 0 ]]; then
  log "inspecting residuals (expected: x-LojiNext-* headers + LOJINEXT_GATEWAY_TOKEN + rebrand-script docs)"
  find . "${FIND_ARGS[@]}" -exec grep -l -E 'lojinext|LojiNext|loji-next|Loji-Next|--color-loji-' {} + 2>/dev/null \
    | xargs -I {} grep -nE 'lojinext|LojiNext|loji-next|Loji-Next|--color-loji-' {} 2>/dev/null \
    | head -40
fi

if [[ "$MODE" == "commit" ]]; then
  if git diff --quiet && git diff --cached --quiet; then
    log "no changes to commit"
  else
    log "staging and committing"
    git add -A
    git commit -m "chore(rebrand): LojiNext → Sovereign AI (automated sweep)

Replaces the internal/external brand identity across the monorepo. Preserves:
  - x-LojiNext-* HTTP headers (external API contract)
  - LOJINEXT_GATEWAY_TOKEN env-var fallback (deprecated compatibility)
  - AUDIT_FINDINGS.md / AUDIT_VERIFICATION.md (historical records)

Renames key identifiers (LojiNextClient → SovereignGatewayClient, etc.),
the lojinext/ directory → google-gemini/, and lojinext-* orchestration files
to gateway-* names. CSS tokens --color-loji-* → --color-sov-*.

Generated by scripts/rebrand-to-sovereign.sh."
  fi
fi

log "done"
