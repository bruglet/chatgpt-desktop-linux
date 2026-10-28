const test = require("node:test");
const assert = require("node:assert/strict");
const verify = require("./upstream-acceptance.cjs");
const sha = "3f429798318eb09cec0ccc6ceb460ba6a9ac59f2";

function fixture() {
  const run = { head_sha: sha, conclusion: "success", head_branch: "main", event: "push",
    head_repository: { full_name: "ilysenko/codex-desktop-linux" }, html_url: "https://example.test/run" };
  const commit = { commit: { message: `Merge accepted upstream ${sha.slice(0, 12)}` },
    parents: [{ sha: "fork-base" }, { sha }] };
  const state = { run, commit, comparison: "identical", runs: [run] };
  const options = {
    context: { repo: { owner: "bruglet", repo: "chatgpt-desktop-linux" }, payload: {
      repository: { full_name: "bruglet/chatgpt-desktop-linux" },
      pull_request: { head: { ref: "automation/upstream-sync", sha: "merge-head",
        repo: { full_name: "bruglet/chatgpt-desktop-linux" } } },
    } },
    core: { info() {} },
    github: { rest: {
      repos: {
        async getCommit(args) { assert.equal(args.ref, "merge-head"); return { data: commit }; },
        async get() { return { data: { default_branch: "main" } }; },
        async compareCommitsWithBasehead(args) {
          assert.equal(args.basehead, `${sha}...main`); return { data: { status: state.comparison } };
        },
      }, actions: { listWorkflowRuns() {} },
    }, async paginate(method, args) {
      assert.equal(args.head_sha, sha);
      assert.equal(args.workflow_id, "upstream-build-app.yml");
      return state.runs;
    } },
  };
  return { options, state };
}

test("accepts the exact successful upstream default-branch build", async () => {
  const { options, state } = fixture();
  await verify(options);
  state.comparison = "ahead";
  await verify(options); // Later upstream commits do not invalidate prior acceptance.
});
test("ordinary fork PRs do not need upstream acceptance", async () => {
  const { options } = fixture();
  options.context.payload.pull_request.head.ref = "fix/homebrew";
  options.github = null;
  await verify(options);
});
test("rejects a sync branch from a different repository", async () => {
  const { options } = fixture();
  options.context.payload.pull_request.head.repo.full_name = "other/repo";
  await assert.rejects(verify(options), /must belong/);
});
for (const [name, change] of [
  ["non-merge head", s => s.commit.parents.pop()],
  ["incorrect merge subject", s => s.commit.commit.message = "Merge accepted upstream aaaaaaaaaaaa"],
  ["revision outside upstream main", s => s.comparison = "diverged"],
  ["no acceptance run", s => s.runs = []],
  ["different revision", s => s.run.head_sha = "another-sha"],
  ["failed build", s => s.run.conclusion = "failure"],
  ["PR-only build", s => s.run.event = "pull_request"],
  ["different branch", s => s.run.head_branch = "feature"],
  ["different repository", s => s.run.head_repository.full_name = "other/repo"],
]) {
  test(`rejects ${name}`, async () => {
    const { options, state } = fixture();
    change(state);
    await assert.rejects(verify(options));
  });
}
