const UPSTREAM = "ilysenko/codex-desktop-linux";

module.exports = async function verifyUpstream({ github, context, core }) {
  const pr = context.payload.pull_request;
  if (pr.head.ref !== "automation/upstream-sync") {
    core.info("Not an automated upstream sync; normal fork checks apply.");
    return;
  }
  if (pr.head.repo.full_name !== context.payload.repository.full_name) {
    throw new Error("The upstream sync branch must belong to this fork.");
  }
  const { data: commit } = await github.rest.repos.getCommit({
    ...context.repo, ref: pr.head.sha,
  });
  const match = /^Merge accepted upstream ([0-9a-f]{12})\n/.exec(commit.commit.message + "\n");
  const sha = commit.parents[1]?.sha;
  if (commit.parents.length !== 2 || !match || !sha?.startsWith(match[1])) {
    throw new Error("Sync head must be the automation's merge of an upstream revision.");
  }
  const [owner, repo] = UPSTREAM.split("/");
  const { data: upstream } = await github.rest.repos.get({ owner, repo });
  const { data: comparison } = await github.rest.repos.compareCommitsWithBasehead({
    owner, repo, basehead: `${sha}...${upstream.default_branch}`,
  });
  if (!["ahead", "identical"].includes(comparison.status)) {
    throw new Error("The accepted revision is not on upstream's default branch.");
  }
  const runs = await github.paginate(github.rest.actions.listWorkflowRuns, {
    owner, repo, workflow_id: "upstream-build-app.yml", head_sha: sha,
    status: "completed", per_page: 100,
  });
  const accepted = runs.find(run =>
    run.head_sha === sha && run.conclusion === "success" &&
    run.head_branch === upstream.default_branch &&
    ["push", "workflow_dispatch"].includes(run.event) &&
    run.head_repository?.full_name === UPSTREAM
  );
  if (!accepted) {
    throw new Error("The exact upstream revision has no successful official Linux build.");
  }
  core.info(`Accepted upstream ${sha}: ${accepted.html_url}`);
};
