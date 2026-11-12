/**
 * The guards workers/badge/README.md lists under "What the workflows check"
 * (in its "Deploy order" section), pinned in the workflow files themselves
 * as fixtures/workflow-reader.mjs reads them, and the other checks that
 * list's last item names: the lockfile against tools/deploy/package.json,
 * and the runbook's commands and required check.
 *
 *   node --test workers/badge/deploy-guards.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { posix } from "node:path";
import { parseWorkflow, readWorkflow } from "./fixtures/workflow-reader.mjs";

const PAGES = ".github/workflows/deploy.yml";
const WORKER = ".github/workflows/deploy-worker.yml";
const PROBE = ".github/workflows/probe.yml";
const VALIDATE = ".github/workflows/validate.yml";
const DEPLOYS = [PAGES, WORKER];
const MAIN_ONLY = "github.ref != 'refs/heads/main'";
const ENVIRONMENT = "production";
// Each guarded workflow's one job, and the environment it runs in.
const GUARDED = {
  [PAGES]: { job: "deploy", environment: ENVIRONMENT },
  [WORKER]: { job: "deploy", environment: ENVIRONMENT },
  [PROBE]: { job: "probe", environment: undefined },
};
const TRIGGERS = { [PAGES]: ["push", "workflow_dispatch"], [WORKER]: ["workflow_dispatch"], [PROBE]: ["schedule", "workflow_dispatch"] };
// Each guarded workflow's token: a deploy reads the contents alone, and the
// probe pushes its commit and dispatches the Pages deploy.
const PERMISSIONS = { [PAGES]: { contents: "read" }, [WORKER]: { contents: "read" }, [PROBE]: { contents: "write", actions: "write" } };
// Each guarded workflow's concurrency: one group per ref, so a run on another
// ref can neither cancel a run from main nor take its place in the queue. In
// a deploy's group a later run cancels an earlier one; in the probe's it
// waits for the run in progress.
const CONCURRENCY = {
  [PAGES]: { group: "deploy-pages-${{ github.ref }}", "cancel-in-progress": "true" },
  [WORKER]: { group: "deploy-worker-${{ github.ref }}", "cancel-in-progress": "true" },
  [PROBE]: { group: "probe-live-${{ github.ref }}", "cancel-in-progress": "false" },
};
const LATER_RUN = { true: "cancels an earlier one", false: "waits for the run in progress" };
// Node 24, and no package-manager cache, which setup-node would otherwise
// turn on by itself once package.json names npm as its package manager.
const SETUP_NODE = "node-version: 24\npackage-manager-cache: false";
const RUNNER = "ubuntu-latest";
// Every key a deploy workflow sets, and every key its job sets. Other keys
// there can change every step or how the job runs: an env, a defaults (a
// shell or a working directory for every run step), a container or
// services, a timeout-minutes, a concurrency group of the job's own.
const WORKFLOW_KEYS = ["concurrency", "jobs", "name", "on", "permissions"];
const DEPLOY_JOB_KEYS = ["environment", "runs-on", "steps"];
// The files through which a run step sets the environment or the PATH of
// every step after it, the deploy step included, named as the shell
// variables GITHUB_ENV and GITHUB_PATH or as the github context's env and
// path, in any letter case.
const LATER_STEPS_FILE = /\bgithub[_.](?:env|path)\b/i;
const INSTALL = "npm ci --ignore-scripts --prefix tools/deploy";
// The runbook's lockfile rewrite, one command a line: the old lockfile goes
// first, since npm keeps any version it holds that satisfies its range, then
// npm resolves every package afresh among the releases published at least 14
// days before the command runs, without installing a package or running a
// script.
const LOCK_REWRITE = [
  "rm tools/deploy/package-lock.json",
  `npm install --package-lock-only --ignore-scripts --before "$(node -p 'new Date(Date.now() - 14 * 86400000).toISOString()')" --prefix tools/deploy`,
];
const WRANGLER_BIN = "tools/deploy/node_modules/.bin/wrangler";
// Each deploy step's working directory and the arguments it gives wrangler:
// what is deployed, and where to.
const DEPLOY_COMMAND = {
  [PAGES]: { directory: ".", args: ["pages", "deploy", "dist", "--project-name=kya-os-usergroup", "--branch=main"] },
  [WORKER]: { directory: "workers/badge", args: ["deploy"] },
};
// A command that installs packages, or fetches one and runs it.
const INSTALLS = /\b(?:npm\s+(?:ci|install|i|add|exec|x)|npx|pnpm|yarn|bunx?|corepack)\b/;
// A secret named on a line GitHub reads: secrets.X, secrets['X'],
// toJSON(secrets), secrets: inherit.
const NAMES_SECRETS = /\bsecrets\b/i;
// Every workflow in the repository, and the actions they run, each at a full
// commit SHA with its release named beside it: a tag can be moved to other
// code, a commit cannot.
const WORKFLOWS = readdirSync(new URL("../../.github/workflows/", import.meta.url))
  .filter((name) => /\.ya?ml$/.test(name))
  .sort()
  .map((name) => `.github/workflows/${name}`);
const ACTIONS = ["actions/checkout", "actions/setup-node"];
const PINNED_ACTION = /^([\w.-]+\/[\w.-]+)@([0-9a-f]{40}) # (v\d+\.\d+\.\d+)$/;

const readJson = (path) => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"));
// A workflow's raw lines, for checks that need no parse of its shape.
const readLines = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").split("\n");
const readRunbook = () => readFileSync(new URL("./README.md", import.meta.url), "utf8");

/** What a step is called in a failure message. */
const label = (step) => step.keys.name ?? step.keys.uses ?? `the step at line ${step.from + 1}`;

/** The one step of `steps` that runs wrangler; fails unless there is exactly one. */
function deployStep(steps) {
  const deploys = steps.filter(({ keys }) => /wrangler/.test(`${keys.run ?? ""} ${keys.uses ?? ""}`));
  assert.equal(deploys.length, 1, `exactly one step runs wrangler, not: ${deploys.map(label).join("; ")}`);
  return deploys[0];
}

/**
 * The indexes of the lines of `workflow` that name a secret. A line that
 * starts with # outside every step is a YAML comment, which GitHub never
 * reads. Inside a step it may be a line of a block value, a run script or a
 * step's name among them, whose expressions GitHub substitutes, so there it
 * counts too.
 */
function secretLines({ lines, jobs }) {
  const steps = Object.values(jobs).flatMap((job) => job.steps);
  const inStep = (i) => steps.some(({ from, to }) => i >= from && i <= to);
  return lines.flatMap((line, i) => (NAMES_SECRETS.test(line) && (!line.trimStart().startsWith("#") || inStep(i)) ? [i] : []));
}

/** Each line of `workflow` that names a secret outside its deploy step, as `line <n>: <text>`. */
function secretsOutsideDeploy(workflow) {
  const deploy = deployStep(workflow.jobs.deploy.steps);
  return secretLines(workflow)
    .filter((i) => i < deploy.from || i > deploy.to)
    .map((i) => `line ${i + 1}: ${workflow.lines[i].trim()}`);
}

for (const [file, { job, environment }] of Object.entries(GUARDED)) {
  test(`${file} runs one job${environment ? ` in the ${environment} environment` : ""}, whose first step fails a run on any other ref, naming it; nothing runs past a failed step or shows it green`, () => {
    const { jobs } = readWorkflow(file);
    assert.deepEqual(Object.keys(jobs), [job], `one job, the ${job}`);
    const { keys, steps } = jobs[job];
    assert.equal(keys.environment, environment, environment && `the job runs in the ${environment} environment, whose branch policy holds it to main and which alone holds the Cloudflare secrets`);
    assert.equal(keys.if, undefined, "a job-level if would skip a run from another ref, and a skipped run looks green");
    assert.equal(keys["continue-on-error"], undefined, "a job-level continue-on-error would show a run that failed its guard as green");
    const [guard, ...rest] = steps;
    assert.deepEqual(Object.keys(guard.keys).sort(), ["if", "name", "run"], `the first step must be the guard alone: ${label(guard)}`);
    assert.equal(guard.keys.if, MAIN_ONLY);
    assert.match(guard.keys.run, /^echo "::error::[^"]*\$GITHUB_REF[^"]*"$/m, "the guard's error names the ref the run was given");
    assert.equal(guard.keys.run.split("\n").at(-1), "exit 1", "the guard fails the run");
    for (const step of rest) {
      assert.deepEqual(
        { if: step.keys.if, "continue-on-error": step.keys["continue-on-error"] },
        { if: undefined, "continue-on-error": undefined },
        `${label(step)}: an if or a continue-on-error could run a step past a failed guard`,
      );
    }
  });

  test(`${file} runs on ${TRIGGERS[file].join(" and ")} alone`, () => {
    const { on } = readWorkflow(file);
    assert.deepEqual(Object.keys(on ?? {}), TRIGGERS[file]);
    if ("push" in on) {
      const filters = on.push.split("\n").filter((line) => /^\S/.test(line));
      assert.deepEqual(filters, ["branches: [main]", "paths:"], "a push runs it on main alone, for the paths it lists");
    }
  });

  const grants = Object.entries(PERMISSIONS[file]).map(([scope, access]) => `${scope}: ${access}`);
  test(`${file} gives its token ${grants.join(" and ")} alone, and no job sets its own`, () => {
    const { permissions, jobs } = readWorkflow(file);
    assert.deepEqual(permissions, PERMISSIONS[file]);
    for (const [id, { keys }] of Object.entries(jobs)) assert.equal(keys.permissions, undefined, `job ${id} sets permissions of its own`);
  });

  test(`${file} scopes its concurrency group to the ref, so a run on another ref can neither cancel nor displace a run from main, and in it a later run ${LATER_RUN[CONCURRENCY[file]["cancel-in-progress"]]}`, () => {
    assert.deepEqual(readWorkflow(file).concurrency, CONCURRENCY[file]);
  });
}

test(`every workflow runs only ${ACTIONS.join(" and ")}, each at one full commit SHA, its release named beside it`, () => {
  assert.ok(WORKFLOWS.includes(PAGES) && WORKFLOWS.includes(WORKER) && WORKFLOWS.includes(PROBE), "the deploy and probe workflows are among those read");
  const unpinned = [];
  const pins = Object.fromEntries(ACTIONS.map((action) => [action, new Set()]));
  for (const file of WORKFLOWS) {
    for (const [i, line] of readLines(file).entries()) {
      const uses = /^\s*(?:- )?uses:\s*(.*)$/.exec(line)?.[1];
      if (uses === undefined) continue;
      const [, action, commit, release] = PINNED_ACTION.exec(uses) ?? [];
      if (action in pins) pins[action].add(`${commit} # ${release}`);
      else unpinned.push(`${file}:${i + 1}: ${uses}`);
    }
  }
  assert.deepEqual(unpinned, [], `every uses: is one of ${ACTIONS.join(", ")} at a 40-hex commit SHA, its release named beside it`);
  for (const [action, commits] of Object.entries(pins)) assert.equal(commits.size, 1, `${action} at one commit in every file, not: ${[...commits].join("; ")}`);
});

for (const file of DEPLOYS) {
  test(`${file} sets ${WORKFLOW_KEYS.join(", ")} alone, and its job ${DEPLOY_JOB_KEYS.join(", ")} alone`, () => {
    const { topLevelKeys, jobs } = readWorkflow(file);
    assert.deepEqual(
      { workflow: [...topLevelKeys].sort(), job: Object.keys(jobs.deploy.keys).sort() },
      { workflow: WORKFLOW_KEYS, job: DEPLOY_JOB_KEYS },
      "a key not listed can change every step, the install and the build included, or how the job runs",
    );
  });

  test(`${file} sets an env in its deploy step alone, and names GITHUB_ENV or GITHUB_PATH, or github.env or github.path, in no run line`, () => {
    const { steps } = readWorkflow(file).jobs.deploy;
    assert.deepEqual(steps.filter((step) => step.keys.env !== undefined).map(label), [label(deployStep(steps))], "only the deploy step, which holds the token, sets an env");
    const named = steps.flatMap((step) => (step.keys.run ?? "").split("\n").flatMap((line) => (LATER_STEPS_FILE.test(line) ? [`${label(step)}: ${line.trim()}`] : [])));
    assert.deepEqual(named, [], "a step that writes either file sets the environment or the PATH of the steps after it, the deploy step's included");
  });

  test(`${file} runs its job on GitHub's ${RUNNER} runner`, () => {
    assert.equal(readWorkflow(file).jobs.deploy.keys["runs-on"], RUNNER, "every step, the deploy step included, runs on GitHub's runner image, not on a runner from elsewhere");
  });

  test(`${file} runs Node 24 with no package-manager cache, and checks out without keeping the job's token in the working copy`, () => {
    const { steps } = readWorkflow(file).jobs.deploy;
    const setups = steps.filter(({ keys }) => keys.uses?.startsWith("actions/setup-node@"));
    assert.deepEqual(setups.map(({ keys }) => keys.with), [SETUP_NODE], "one setup-node, on Node 24, an LTS line the locked wrangler supports, restoring no cache");
    const checkouts = steps.filter(({ keys }) => keys.uses?.startsWith("actions/checkout@"));
    assert.deepEqual(checkouts.map(({ keys }) => keys.with), ["persist-credentials: false"], "one checkout, keeping no token, since no later step needs one");
  });

  test(`${file} installs the locked toolchain in one step, with no secret and no install scripts, before the deploy`, () => {
    const workflow = readWorkflow(file);
    const { steps } = workflow.jobs.deploy;
    const installs = steps.filter(({ keys }) => INSTALLS.test(keys.run ?? ""));
    assert.deepEqual(installs.map(({ keys }) => keys.run), [INSTALL], "one install, from the lockfile, with install scripts off");
    const [install] = installs;
    assert.deepEqual(Object.keys(install.keys).sort(), ["name", "run"], "the install step sets no env, so no secret is in scope");
    assert.deepEqual(secretLines(workflow).filter((i) => i >= install.from && i <= install.to), [], "the install step names no secret");
    assert.ok(steps.indexOf(install) < steps.indexOf(deployStep(steps)), "the toolchain is installed before the deploy runs it");
  });

  test(`${file} deploys in exactly one step, the only one that names a secret, which runs the locked wrangler with exactly its arguments and installs nothing`, () => {
    const workflow = readWorkflow(file);
    const deploy = deployStep(workflow.jobs.deploy.steps);
    assert.ok(secretLines(workflow).length > 0, "the deploy step names its token");
    assert.deepEqual(secretsOutsideDeploy(workflow), [], `no line outside the deploy step (lines ${deploy.from + 1} to ${deploy.to + 1}) names a secret`);
    const { run, "working-directory": directory = "." } = deploy.keys;
    assert.doesNotMatch(run, /[\n;&|`$<>()]/, "the deploy step runs one command, with no shell operator to run another");
    assert.doesNotMatch(run, INSTALLS, "the deploy step installs nothing");
    const [command, ...args] = run.split(" ");
    assert.deepEqual(
      { wrangler: posix.join(directory, command), directory, args },
      { wrangler: WRANGLER_BIN, ...DEPLOY_COMMAND[file] },
      `the deploy step runs the locked wrangler, from its directory, with exactly its arguments, not: ${run}`,
    );
  });
}

test(`${WORKER} runs the preflight in the step right before the deploy`, () => {
  const { steps } = readWorkflow(WORKER).jobs.deploy;
  const deploy = deployStep(steps);
  assert.equal(steps[steps.indexOf(deploy) - 1]?.keys.run, "node workers/badge/preflight.mjs", "the step right before the deploy runs the preflight, exactly");
});

test(`${PROBE} pushes to main with the token its checkout keeps, and only after its main-only first step`, () => {
  const { steps } = readWorkflow(PROBE).jobs.probe;
  const pushes = steps.flatMap((step) => (step.keys.run ?? "").split("\n").filter((line) => /^\s*git push\b/.test(line)).map((line) => [step, line.trim()]));
  assert.deepEqual(pushes.map(([, line]) => line), ["git push origin HEAD:main"], "one push, of the run's commit to main");
  assert.ok(steps.indexOf(pushes[0][0]) > 0, "the push comes after the guard");
  const checkout = steps.find(({ keys }) => keys.uses?.startsWith("actions/checkout@"));
  assert.doesNotMatch(checkout.keys.with ?? "", /persist-credentials/, "the push needs the token the checkout keeps by default");
});

/** The lockfile entry that package `name`, required by the entry at `from`, resolves to, walking up as Node does; undefined when the lockfile holds none. */
function resolveLocked(packages, from, name) {
  for (let dir = from; ; dir = dir.slice(0, dir.lastIndexOf("node_modules/")).replace(/\/$/, "")) {
    const path = `${dir === "" ? "" : `${dir}/`}node_modules/${name}`;
    if (path in packages) return packages[path];
    if (dir === "") return undefined;
  }
}

test("tools/deploy's lockfile matches its package.json, and locks every package wrangler pulls in, for every platform, by integrity hash", () => {
  const manifest = readJson("tools/deploy/package.json");
  const lock = readJson("tools/deploy/package-lock.json");
  assert.deepEqual(Object.keys(manifest.dependencies), ["wrangler"], "the toolchain is wrangler alone");
  assert.match(manifest.dependencies.wrangler, /^\d+\.\d+\.\d+$/, "wrangler at one exact version");
  assert.equal(lock.lockfileVersion, 3);
  assert.deepEqual(lock.packages[""].dependencies, manifest.dependencies, "npm ci installs what package.json names");
  assert.equal(lock.packages["node_modules/wrangler"].version, manifest.dependencies.wrangler);
  const unlocked = [];
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (path === "") continue;
    if (!/^sha512-/.test(entry.integrity ?? "") || !entry.resolved?.startsWith("https://registry.npmjs.org/")) unlocked.push(`${path}: no sha512 integrity from registry.npmjs.org`);
    for (const name of Object.keys({ ...entry.dependencies, ...entry.optionalDependencies })) {
      if (resolveLocked(lock.packages, path, name) === undefined) unlocked.push(`${path} -> ${name}: not in the lockfile`);
    }
  }
  assert.deepEqual(unlocked, [], "every package, the Linux ones CI installs among them, is locked");
});

test("the runbook installs the locked toolchain, rewrites its lockfile afresh from releases two weeks old without installing, and runs its wrangler, at the version the lockfile holds", () => {
  const runbook = readRunbook();
  const { wrangler } = readJson("tools/deploy/package.json").dependencies;
  const installs = [...runbook.matchAll(/\bnpm (?:ci|install|i)\b[^`\n]*/g)].map(([command]) => command);
  assert.deepEqual([...new Set(installs)].sort(), [INSTALL, LOCK_REWRITE[1]], "every npm command the runbook names is the deploy jobs' install or the lockfile's rewrite");
  const lines = runbook.split("\n").map((line) => line.trim());
  assert.deepEqual(lines.slice(lines.indexOf(LOCK_REWRITE[0]), lines.indexOf(LOCK_REWRITE[0]) + 2), LOCK_REWRITE, "the rewrite deletes the lockfile, then writes it afresh");
  assert.doesNotMatch(runbook, /\bnpx\b[^\n]*\bwrangler\b|\bwrangler@/, "no runbook command fetches a wrangler of its own");
  for (const command of ["delete", "deploy --dry-run"]) {
    assert.ok(runbook.includes(`../../${WRANGLER_BIN} ${command}`), `the runbook runs the locked wrangler's ${command}`);
  }
  const named = [...runbook.matchAll(/\bwrangler `?(\d+\.\d+\.\d+)/g)].map(([, version]) => version);
  assert.ok(named.length > 0, "the runbook names the locked version");
  assert.deepEqual([...new Set(named)], [wrangler]);
});

test("the check the runbook's ruleset requires is the Validate workflow's one job, which runs on every pull request to main", () => {
  const { on, jobs } = readWorkflow(VALIDATE);
  assert.equal(on.pull_request, "branches: [main]");
  assert.deepEqual(Object.keys(jobs), ["validate"]);
  assert.equal(jobs.validate.keys.name, undefined, "a job name would rename the check");
  const required = /status checks to pass before merging with the check `([^`]+)`/.exec(readRunbook());
  assert.equal(required?.[1], "validate");
});

test("the line reader names the line of a workflow it cannot read, instead of passing it unread", () => {
  const steps = (...lines) => ["on:", "  workflow_dispatch:", "jobs:", "  deploy:", "    steps:", ...lines, ""].join("\n");
  const unreadable = {
    "no-jobs.yml": ["on:\n  workflow_dispatch:\n", /^Error: no-jobs\.yml:1: no top-level "jobs:" line; .*update its line reader/],
    "deeper.yml": [steps("        - name: Deploy from main only"), /^Error: deeper\.yml:6: a key at a depth this reader does not expect; /],
    "flow.yml": [steps(`      - { name: Deploy, run: ${WRANGLER_BIN} deploy }`), /^Error: flow\.yml:6: not a key and its value; /],
    "continued.yml": [steps("      - name: Deploy from main only", "        if: github.ref !=", "          'refs/heads/main'"), /^Error: continued\.yml:8: a value that continues on the next line; /],
    "ragged.yml": [steps("      - run: |", "            echo one", "          echo two"), /^Error: ragged\.yml:8: a line less indented than the block it belongs to; /],
    "inline-on.yml": [`on: [push, workflow_dispatch]\n${steps().split("\n").slice(2).join("\n")}`, /^Error: inline-on\.yml:1: a top-level "on" given inline; /],
    "inline-permissions.yml": [`permissions: read-all\n${steps()}`, /^Error: inline-permissions\.yml:1: a top-level "permissions" given inline; /],
    "quoted-key.yml": [`"env": { NODE_OPTIONS: --require ./x.js }\n${steps()}`, /^Error: quoted-key\.yml:1: not a top-level key and its value; /],
    "glued-key.yml": [`name:Deploy\n${steps()}`, /^Error: glued-key\.yml:1: not a top-level key and its value; /],
    "inline-group.yml": [`concurrency: deploy-pages\n${steps()}`, /^Error: inline-group\.yml:1: a top-level "concurrency" given inline; /],
    "ragged-group.yml": [`concurrency:\n   group: deploy-pages\n${steps()}`, /^Error: ragged-group\.yml:2: not a key and its value under "concurrency:"; /],
    "continued-group.yml": [`concurrency:\n  group: deploy-pages-\n    \${{ github.ref }}\n${steps()}`, /^Error: continued-group\.yml:3: not a key and its value under "concurrency:"; /],
  };
  for (const [file, [text, message]] of Object.entries(unreadable)) {
    assert.throws(() => parseWorkflow(text, file), message, file);
  }
});

test("the line reader lists every top-level key in order, past the jobs too, a repeated one each time", () => {
  const text = ["name: Deploy", "# a comment", "run-name: Deploy ${{ github.ref }}", "on:", "  workflow_dispatch:", "jobs:", "  deploy:", "    steps:", "      - run: echo deploy", "defaults:", "  run:", "    shell: bash", "name: Again", ""];
  assert.deepEqual(parseWorkflow(text.join("\n"), "keys.yml").topLevelKeys, ["name", "run-name", "on", "jobs", "defaults", "name"]);
});

// The secret checks above count a line as a step's when it falls in the
// step's span, and a # line there as one GitHub reads, so a step that ends in
// a block must span the block.
test("the line reader spans a step through the last line of the block that ends it", () => {
  const text = ["on:", "  workflow_dispatch:", "jobs:", "  deploy:", "    steps:", "      - run: echo deploy", "        env:", "          TOKEN: ${{ secrets.TOKEN }}", "      - run: echo done", ""];
  const [first, second] = parseWorkflow(text.join("\n"), "trailing-block.yml").jobs.deploy.steps;
  assert.deepEqual([first.from, first.to, first.keys.env], [5, 7, "TOKEN: ${{ secrets.TOKEN }}"]);
  assert.deepEqual([second.from, second.to], [8, 8]);
});

// The Pages deploy's build step, rewritten so that a # line inside it names
// the Cloudflare token: the first line of a run script that reads that line
// back, before the deploy step or after it, and the last line of a step's
// name. GitHub puts the token's value in each, so the scan counts it.
test("the secret scan counts a # line inside any step but the deploy step, which GitHub substitutes in a run script or a step's name, and passes over the YAML comments outside every step", () => {
  const { lines } = readWorkflow(PAGES);
  const build = ["      - name: Build Pages artifact", "        run: node site/build-pages.mjs"];
  const at = lines.indexOf(build[0]);
  assert.deepEqual(lines.slice(at, at + 2), build, "the Pages deploy builds in one step");
  assert.equal(lines.at(-1), "", "the file ends in a newline");
  const secret = "# ${{ secrets.CLOUDFLARE_API_TOKEN }}";
  const script = [build[0], "        run: |", `          ${secret}`, '          node site/build-pages.mjs "$(sed -n 1p "$0")"'];
  const rewritten = {
    "a run script": lines.toSpliced(at, 2, ...script),
    "a run script after the deploy step": [...lines.toSpliced(at, 2).slice(0, -1), ...script, ""],
    "a step's name": lines.toSpliced(at, 2, "      - run: node site/build-pages.mjs", "        name: |", "          Build Pages artifact", `          ${secret}`),
  };
  for (const [where, text] of Object.entries(rewritten)) {
    const line = text.indexOf(`          ${secret}`) + 1;
    const found = secretsOutsideDeploy(parseWorkflow(text.join("\n"), PAGES));
    assert.deepEqual(found, [`line ${line}: ${secret}`], `${where}: its # line, and none of the YAML comments, though they name secrets too`);
  }
});
