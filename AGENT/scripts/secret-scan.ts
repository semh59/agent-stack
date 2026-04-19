import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Dirent } from "node:fs";

const ROOT = path.resolve(process.cwd());
const INCLUDE_DIRS = ["src", "ui/src", "vscode-extension/src", "scripts", "script"];
const EXCLUDE_SEGMENTS = ["node_modules", "dist", "out", ".git", ".agent", ".ai-company"];

const SECRET_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: "AWS access key", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "OpenAI token", regex: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { name: "GitHub token", regex: /\bghp_[A-Za-z0-9]{30,}\b/g },
  { name: "Private key", regex: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  {
    name: "Hardcoded credential assignment",
    regex: /\b(api[_-]?key|secret|token|password)\b\s*[:=]\s*["'][^"'\r\n]{16,}["']/gi,
  },
];

async function walk(dir: string, output: string[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const normalized = full.replace(/\\/g, "/");
    if (EXCLUDE_SEGMENTS.some((segment) => normalized.includes(`/${segment}/`))) {
      continue;
    }
    if (entry.isDirectory()) {
      await walk(full, output);
      continue;
    }
    if (entry.isFile()) {
      output.push(full);
    }
  }
}

async function collectFiles(): Promise<string[]> {
  const files: string[] = [];
  for (const includeDir of INCLUDE_DIRS) {
    await walk(path.join(ROOT, includeDir), files);
  }
  return files;
}

async function main(): Promise<void> {
  const files = await collectFiles();
  const findings: string[] = [];

  for (const file of files) {
    const relativePath = path.relative(ROOT, file).replace(/\\/g, "/");
    if (relativePath.includes(".test.") || relativePath.includes(".spec.")) {
      continue;
    }
    let content: string;
    try {
      content = await fs.readFile(file, "utf-8");
    } catch {
      continue;
    }
    for (const pattern of SECRET_PATTERNS) {
      pattern.regex.lastIndex = 0;
      if (pattern.regex.test(content)) {
        findings.push(`${relativePath}: ${pattern.name}`);
        break;
      }
    }
  }

  if (findings.length === 0) {
    console.log("Secret scan passed.");
    return;
  }

  console.error("Secret scan failed. Potential secrets detected:");
  for (const finding of findings) {
    console.error(` - ${finding}`);
  }
  process.exitCode = 1;
}

void main();
