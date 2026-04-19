import { describe, expect, it } from "vitest";
import { buildAutonomyBranchName, buildAutonomyCommitTitle } from "./autonomy-git-manager";

describe("autonomy git metadata helpers", () => {
  it("builds branch names with auto_branch prefix and session id", () => {
    const branch = buildAutonomyBranchName("aut_20260309_abcd");
    expect(branch.startsWith("auto_branch/")).toBe(true);
    expect(branch).toContain("aut_20260309_abcd");
  });

  it("builds commit title with expected format", () => {
    const title = buildAutonomyCommitTitle("Implement strict gate and model routing");
    expect(title.startsWith("feat(autonomy): ")).toBe(true);
    expect(title).toContain("Implement strict gate and model routing");
  });
});
