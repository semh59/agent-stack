/**
 * Secret scan — fails CI if a known credential pattern lands in the tree.
 *
 * Covers the whole repo root (`ROOT`, two levels up from this file) so no
 * artifact outside `AGENT/` can hide a token. `.test.*` / `.spec.*` files are
 * scanned too because they are a favourite hiding place for "dummy" keys
 * that turn out to be real.
 *
 * Exit codes:
 *   0 — clean
 *   1 — at least one finding; list printed to stderr
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Dirent } from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "../../..");
const INCLUDE_DIRS = ["."];
const EXCLUDE_DIRS = [
  "node_modules",
  "dist",
  "out",
  ".git",
  ".agent",
  ".ai-company",
  "env",
  ".venv",
  "venv",
  "artifacts",
  "brain",
  ".cursor",
  ".next",
  ".pytest_cache",
  "__pycache__",
  "coverage",
];
const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".pdf",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".zip",
  ".gz",
  ".tar",
  ".tgz",
  ".vsix",
  ".db",
]);

const SECRET_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: "AWS access key", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "OpenAI token", regex: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { name: "GitHub token", regex: /\b(ghp_|gho_|ghs_|ghr_)[A-Za-z0-9]{30,}\b/g },
  { name: "Stripe live key", regex: /\b(sk_live_|pk_live_|rk_live_)[A-Za-z0-9]{20,}\b/g },
  { name: "Google API key", regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: "Private key", regex: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { name: "Alloy gateway token", regex: /\b(alloy|alloy)_[A-Za-z0-9_-]{20,}\b/g },
  {
    name: "Hardcoded credential assignment",
    regex: /\b(api[_-]?key|secret|token|password)\b\s*[:=]\s*["'][^"'\r\n]{16,}["']/gi,
  },
  {
    name: "Env-var leak via console.log",
    regex: /console\.log\s*\(\s*process\.env\.(?:[A-Z_]*KEY|[A-Z_]*SECRET|[A-Z_]*TOKEN|[A-Z_]*PASSWORD)\s*\)/g,
  },
];

// Self-allowlist — these files legitimately contain the regex patterns as
// detection fixtures, not actual secrets.
const ALLOWLIST = [
  "core/gateway/scripts/secret-scan.ts",
];

async function walk(dir: string, output: string[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (EXCLUDE_DIRS.includes(entry.name)) {
      continue;
    }

    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, output);
      continue;
    }

    if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext)) {
        continue;
      }
      output.push(full);
    }
  }
}

async function collectFiles(): Promise<string[]> {
  const files: string[] = [];
  for (const includeDir of INCLUDE_DIRS) {
    const target = path.resolve(ROOT, includeDir);
    await walk(target, files);
  }
  return files;
}

interface Finding {
  file: string;
  pattern: string;
  lineNumber: number;
  snippet: string;
}

async function main(): Promise<void> {
  const files = await collectFiles();
  const findings: Finding[] = [];

  for (const file of files) {
    const relativePath = path.relative(ROOT, file).replace(/\\/g, "/");
    if (ALLOWLIST.includes(relativePath)) continue;

    let content: string;
    try {
      content = await fs.readFile(file, "utf-8");
    } catch {
      continue;
    }

    for (const pattern of SECRET_PATTERNS) {
      pattern.regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.regex.exec(content)) !== null) {
        const before = content.slice(0, match.index);
        const lineNumber = before.split(/\r?\n/).length;
        const lineStart = before.lastIndexOf("\n") + 1;
        const lineEnd = content.indexOf("\n", match.index);
        const snippet = content
          .slice(lineStart, lineEnd === -1 ? undefined : lineEnd)
          .trim()
          .slice(0, 160);
        findings.push({ file: relativePath, pattern: pattern.name, lineNumber, snippet });
        if (!pattern.regex.global) break;
      }
    }
  }

  if (findings.length === 0) {
    // Green path — silent success is fine for CI.
    console.log("[secret-scan] clean: no findings across", files.length, "files");
    return;
  }

  console.error(`[secret-scan] ${findings.length} finding(s):\n`);
  for (const f of findings) {
    console.error(`  ${f.file}:${f.lineNumber}  [${f.pattern}]`);
    console.error(`     ${f.snippet}`);
  }
  process.exitCode = 1;
}

main().catch((err) => {
  console.error("[secret-scan] fatal", err);
  process.exit(2);
});
