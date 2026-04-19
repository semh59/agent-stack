import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ScopedToolExecutionEngine } from "./autonomy-scope-engine";

const tempRoots: string[] = [];

async function createTempProject(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "autonomy-scope-"));
  tempRoots.push(dir);
  await fs.mkdir(path.join(dir, "src"), { recursive: true });
  await fs.mkdir(path.join(dir, "ui"), { recursive: true });
  await fs.writeFile(path.join(dir, "src", "file.txt"), "hello", "utf-8");
  return dir;
}

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (!root) continue;
    await fs.rm(root, { recursive: true, force: true });
  }
});

describe("ScopedToolExecutionEngine", () => {
  it("allows file operations inside selected scope", async () => {
    const projectRoot = await createTempProject();
    const engine = new ScopedToolExecutionEngine(projectRoot, {
      mode: "selected_only",
      paths: ["src"],
    });

    const readResult = await engine.readFile("src/file.txt");
    expect(readResult.success).toBe(true);
    expect(readResult.output).toBe("hello");

    const writeResult = await engine.writeFile("src/new.txt", "ok");
    expect(writeResult.success).toBe(true);
  });

  it("blocks operations outside selected scope", async () => {
    const projectRoot = await createTempProject();
    const engine = new ScopedToolExecutionEngine(projectRoot, {
      mode: "selected_only",
      paths: ["src"],
    });

    const readResult = await engine.readFile("ui/other.txt");
    expect(readResult.success).toBe(false);
    expect(readResult.output).toContain("SCOPE_VIOLATION");
  });
});
