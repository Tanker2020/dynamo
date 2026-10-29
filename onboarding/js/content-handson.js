/* Chapter 7: hands-on. Build it, run it without a GPU, test it, contribute. */
(function () {
  const { t, code, src } = GS;

  GS.checklists.build = [
    { title: "Install system packages", where: "Ubuntu / Debian (from building-from-source.md)",
      cmd: `sudo apt install -y build-essential libhwloc-dev libudev-dev pkg-config libclang-dev protobuf-compiler python3-dev cmake`,
      note: `On Fedora, the equivalent should be <code>sudo dnf install -y gcc gcc-c++ make hwloc-devel systemd-devel pkgconf-pkg-config clang-devel protobuf-compiler python3-devel cmake</code>. That's a package-name translation, not something the docs test, so expect to fix a name or two.` },
    { title: "Install Rust (the repo pins its own toolchain)", cmd: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh\nrustup show   # inside the repo: picks up rust-toolchain.toml`,
      note: `<code>rust-toolchain.toml</code> pins a specific stable channel, so rustup downloads the right version the first time you build in the repo.` },
    { title: "Install uv and create a virtualenv", cmd: `curl -LsSf https://astral.sh/uv/install.sh | sh\nuv venv .venv && source .venv/bin/activate` },
    { title: "Install maturin", cmd: `uv pip install pip 'maturin[patchelf]'` },
    { title: "Build the Rust bindings into the venv", cmd: `cd lib/bindings/python && maturin develop --uv && cd -`,
      note: "This compiles the Rust core into <code>dynamo._core</code>. The first build takes a while; later ones are incremental." },
    { title: "Install the Python packages (editable)", cmd: `uv pip install -e lib/gpu_memory_service\nuv pip install -e .` },
    { title: "Verify", cmd: `python3 -m dynamo.frontend --help\npython3 -m dynamo.mocker --help`, note: "If both print help text, you have a working dev install." },
    { title: "Build one Rust crate on its own", cmd: `cargo check -p dynamo-runtime     # fast type-check\ncargo build -p dynamo-llm        # full build of one crate`, note: "When you're only editing Rust, <code>cargo check -p &lt;crate&gt;</code> is your inner loop. Remember to re-run <code>maturin develop</code> before testing from Python." },
  ];

  GS.checklists.mocker = [
    { title: "Terminal 1: start the frontend with file-based discovery", cmd: `python3 -m dynamo.frontend --http-port 8000 --discovery-backend file`,
      note: "No etcd, no NATS. Processes find each other through files on this machine." },
    { title: "Terminal 2: start a simulated worker", cmd: `python3 -m dynamo.mocker \\\n  --model-path Qwen/Qwen3-0.6B \\\n  --discovery-backend file`,
      note: "The mocker downloads the tokenizer and config for the model, not the weights, then registers like a real vLLM worker would. Watch the frontend log the new model." },
    { title: "Terminal 3: send a chat request", cmd: `curl localhost:8000/v1/chat/completions \\\n  -H 'Content-Type: application/json' \\\n  -d '{\n    "model": "Qwen/Qwen3-0.6B",\n    "messages": [{"role": "user", "content": "Hello!"}],\n    "max_tokens": 32\n  }'`,
      note: "The text is gibberish (it's a simulator) but everything else is real: templating, tokenization, routing, streaming, detokenization." },
    { title: "Stream it, and watch tokens arrive", cmd: `curl -N localhost:8000/v1/chat/completions \\\n  -H 'Content-Type: application/json' \\\n  -d '{"model":"Qwen/Qwen3-0.6B","messages":[{"role":"user","content":"Hi"}],"max_tokens":32,"stream":true}'`,
      note: "Each <code>data:</code> line is one chunk from the pipeline's preprocessor backward edge." },
    { title: "Scale to four workers in one process", cmd: `python3 -m dynamo.mocker \\\n  --model-path Qwen/Qwen3-0.6B \\\n  --discovery-backend file \\\n  --num-workers 4`,
      note: "Stop the old mocker first. Send several requests and compare logs to see the router spreading load." },
    { title: "Turn on KV-aware routing", cmd: `python3 -m dynamo.frontend --http-port 8000 --discovery-backend file --router-mode kv`,
      note: "Restart the frontend with this. Now send the same long prompt repeatedly: it should keep landing on the worker that cached it. That's chapter 6.1, live." },
    { title: "Simulate disaggregated serving", cmd: `# prefill worker\npython3 -m dynamo.mocker --model-path Qwen/Qwen3-0.6B --discovery-backend file \\\n  --disaggregation-mode prefill --bootstrap-ports 50100\n\n# decode worker (another terminal)\npython3 -m dynamo.mocker --model-path Qwen/Qwen3-0.6B --discovery-backend file \\\n  --disaggregation-mode decode`,
      note: "Send a request and check both logs: prefill on one, decode on the other." },
  ];

  GS.checklists.tests = [
    { title: "Run the Python unit tests", cmd: `python3 -m pytest -m unit tests/ -x -q`, note: "Always <code>python3 -m pytest</code>, never bare <code>pytest</code>, so the venv's interpreter is used." },
    { title: "Run one Rust crate's tests", cmd: `cargo test -p dynamo-kv-router`, note: "Router and indexer tests run on a CPU. Try <code>cargo test -p dynamo-tokens</code> too." },
    { title: "Run the router's mocker-backed tests", cmd: `python3 -m pytest tests/router -m "gpu_0" -x -q`, note: "Many router tests use the mocker, so they need no GPU. Read the markers in a test file before running it." },
    { title: "Run the linters before you push", cmd: `pre-commit install\npre-commit run --all-files\ncargo fmt --all && cargo clippy --workspace` },
  ];

  GS.chapter({ id: "c7", num: "07", title: "Hands-on", blurb: "Build Dynamo from source, run a full deployment on your laptop with no GPU, write a properly marked test, and ship your first PR." });

  GS.lesson({
    id: "build", ch: "c7", title: "Build it from source", mins: 15, labs: 1,
    summary: "Get a development install: Rust core compiled into a Python extension, Python packages installed in editable mode. Tick the steps off as you go.",
    goals: ["Install prerequisites", "Build the PyO3 bindings with maturin", "Know the fast Rust inner loop"],
    body: () => `
<p>The canonical steps are in the repo's <code>AGENTS.md</code> and ${src("docs/fern/pages/developer-guide/advanced-customizations/building-from-source.md", "building-from-source.md")}. Run everything from the repo root.</p>
<div data-widget="checklist" data-list="build" data-title="Dev install checklist" data-award="Dev install complete"></div>
<h2>What just happened</h2>
<p>Two worlds got wired together. <code>maturin develop</code> compiled the Rust crates the bindings depend on (runtime, llm, kv-router…) into one shared library and dropped it into your venv as <code>dynamo._core</code>. The editable <code>uv pip install -e .</code> made <code>components/src/dynamo/*</code> importable, so edits to Python files take effect immediately. Edits to Rust need another <code>maturin develop</code>.</p>
<div class="callout warn"><b>If the build fails</b>Read the first error, not the last. Missing <code>protoc</code>, <code>libclang</code> or <code>hwloc</code> are the usual suspects. If you'd rather not fight your host, the repo has a VS Code devcontainer under <code>.devcontainer</code> and container builds under <code>container/</code>.</div>
`,
    quiz: [
      { q: "You changed a Rust file in lib/llm. What must you do before your Python test sees the change?", a: ["Nothing", "Re-run maturin develop to rebuild dynamo._core", "Restart your editor", "Reinstall uv"], c: 1, why: "Python imports the compiled extension; it needs rebuilding after Rust changes." },
    ],
  });

  GS.lesson({
    id: "run-mocker", ch: "c7", title: "Fly solo without a GPU", mins: 15, labs: 1,
    summary: "The mocker simulates an engine's scheduling, KV blocks and timing, but needs no GPU and no weights. Run a real frontend against it and you're exercising nearly all of Dynamo on a laptop.",
    goals: ["Run frontend + mocker with file discovery", "Watch routing, streaming and KV-aware placement live", "Simulate disaggregation"],
    body: () => `
<p>The ${t("mocker")} is a first-class tool, not a toy: CI uses it, the planner team uses it to replay traffic, and you'll use it to test any change to the frontend or router. Its live mode registers with the runtime like a real worker. The guide is ${src("docs/fern/pages/cli/operations/simulation-with-dynosim/mocker-live-simulation.mdx", "mocker-live-simulation.mdx")}.</p>
<div data-widget="checklist" data-list="mocker" data-title="Your first local deployment" data-hint="Three terminals. Tick each step once you've seen it work." data-award="First local deployment flown"></div>
<h2>Things to look for while it runs</h2>
<ul>
  <li><code>curl localhost:8000/v1/models</code> lists models the frontend discovered from worker cards.</li>
  <li><code>curl localhost:8000/health</code> is the health endpoint; the frontend also serves Prometheus metrics (see <code>lib/llm/src/http/service/metrics.rs</code>).</li>
  <li>Kill the mocker with Ctrl-C mid-stream and watch what the frontend logs. Then read the migration lesson again.</li>
  <li>Tune the simulation with <code>--speedup-ratio</code>, <code>--block-size</code>, <code>--num-gpu-blocks-override</code> and <code>--max-num-seqs</code> to provoke cache pressure.</li>
</ul>
<p class="margin-note">If you only do one lab in this course for real, make it this one.</p>
`,
    quiz: [
      { q: "Why does the mocker need the model path if it doesn't load weights?", a: ["It does load weights", "It needs the tokenizer, chat template and config to publish a realistic model card", "For licensing", "It doesn't need it"], c: 1, why: "The frontend builds its pipeline from the worker's Model Deployment Card, which needs the tokenizer and template." },
    ],
  });

  GS.lesson({
    id: "testing", ch: "c7", title: "Testing: markers, conftest and cargo", mins: 12, labs: 2,
    summary: "Dynamo's pytest setup is strict on purpose: every test declares when it runs, what kind it is, and what hardware it needs. The root conftest.py fills gaps and keeps engine imports sane.",
    goals: ["Explain the three required marker categories", "Explain what the root conftest.py does", "Write and run a properly marked unit test"],
    body: () => `
<p>CI runs thousands of tests on machines with zero to eight GPUs. Markers decide which tests run where. They're declared strictly (<code>--strict-markers</code>), so a typo is an error, not a silently skipped test.</p>
${code("python", `REQUIRED_CATEGORIES: dict[str, frozenset[str]] = {
    "Lifecycle": frozenset({"pre_merge", "post_merge", "nightly", "weekly", "release"}),
    "Test Type": frozenset({"unit", "integration", "e2e", "benchmark", "stress", "multimodal", "performance"}),
    "Hardware": frozenset({"gpu_0", "gpu_1", "gpu_2", "gpu_4", "gpu_8", "h100", "k8s", "xpu_1", "xpu_2"}),
}`, "tests/marker_categories.py")}

<h2>What the root conftest.py does</h2>
<p>You had this file open, so here's what it's up to. Two jobs:</p>
<p><strong>1. Default missing markers.</strong> Its <code>pytest_itemcollected</code> hook adds <code>pre_merge</code> to any test with no lifecycle marker and <code>gpu_0</code> to any test with no hardware marker, then tags it <code>defaulted</code> so CI routes it to the CPU parallel job. Demo trees (<code>examples/</code>, skills) are left alone.</p>
${code("python", `    defaulted = False
    if not any(item.get_closest_marker(marker) for marker in _SUITE_MARKERS):
        item.add_marker(pytest.mark.pre_merge)   #<<
        defaulted = True
    if not any(item.get_closest_marker(marker) for marker in _MACHINE_MARKERS):
        item.add_marker(pytest.mark.gpu_0)   #<<
        defaulted = True
    if defaulted:
        item.add_marker(pytest.mark.defaulted)`, "conftest.py")}
<p><strong>2. Stop name collisions with engines.</strong> Pytest puts <code>components/src/dynamo</code> on <code>sys.path</code>, which would make <code>import vllm</code> resolve to Dynamo's own <code>dynamo.vllm</code> package instead of the real vLLM. The conftest pre-imports the real engines, strips that path, and patches multiprocessing so spawned engine subprocesses don't inherit it either. It's a great example of the unglamorous plumbing a large polyglot repo needs.</p>
<p>The test-type category isn't defaulted: a separate report (<code>tests/report_pytest_markers.py</code>) fails when a test declares none. So pick one yourself.</p>

<div data-widget="markers"></div>
<div data-widget="checklist" data-list="tests" data-title="Run the suites" data-award="Test suites run"></div>
<p>Before writing tests, read ${src(".ai/pytest-guidelines.md")} and ${src(".ai/test-model-size-guardrails.md")}. They're short and they'll save you a review round.</p>
`,
    quiz: [
      { q: "You write a test with only <code>@pytest.mark.unit</code>. After conftest.py runs, which markers does it have?", a: ["Only unit", "unit, pre_merge, gpu_0, defaulted", "unit, nightly, gpu_1", "It fails collection"], c: 1, why: "Missing lifecycle → pre_merge; missing hardware → gpu_0; defaulted is added because something was filled in." },
      { q: "Why does the root conftest strip <code>components/src/dynamo</code> from sys.path?", a: ["To speed up imports", "So `import vllm` (and sglang, triton) finds the real engine packages instead of Dynamo's same-named packages", "To hide tests", "It's required by pytest"], c: 1, why: "dynamo.vllm on the path would shadow the real vllm, breaking engine subprocesses." },
    ],
  });

  GS.lesson({
    id: "contributing", ch: "c7", title: "Ship your first PR", mins: 12,
    summary: "Conventions, sign-offs, who reviews what, and a short list of first missions that will teach you the codebase faster than reading it.",
    goals: ["Format a PR the way Dynamo expects", "Sign commits correctly", "Pick a first task"],
    body: () => `
<h2>The rules</h2>
<ul>
  <li><strong>Title:</strong> ${t("conventional-commit", "Conventional Commits")}: <code>type(scope): summary</code>, e.g. <code>fix(router): skip inhibited workers in least-loaded mode</code>.</li>
  <li><strong>Description:</strong> must include <em>Summary</em> and <em>Validation</em> sections. Validation means what you actually ran.</li>
  <li><strong>Every commit signed off:</strong> <code>git commit -s</code> adds the ${t("dco", "DCO")} line. Fork PRs that want automatic CI also need cryptographically verified signatures.</li>
  <li><strong>CI:</strong> full CI runs after a maintainer comments <code>/ok to test &lt;sha&gt;</code>. Fix failures before asking for human review.</li>
  <li><strong>Generated files:</strong> never hand-edit <code>CODEOWNERS</code> or anything marked “do not edit”; change the source and regenerate.</li>
  <li><strong>Big changes:</strong> architecture changes need a Dynamo Enhancement Proposal (DEP) filed as a GitHub issue first.</li>
</ul>
${code("bash", `git switch -c fix/router-typo
# ...edit...
pre-commit run --all-files
git commit -s -m "fix(router): correct overlap credit doc comment"
python .github/codeowners/who_owns.py --codeowners CODEOWNERS --changed   # who will review this?`, null, { label: "the loop" })}
<p>Before reviewers do, run the repo's own review skills on your diff: <code>graham-code-review</code> for Rust and systems code, and the frontend/runtime review prompts in <code>.github/review-prompts/</code>.</p>

<h2>First missions</h2>
<p>Each one is small, safe on a laptop, and touches a different part of what you learned.</p>
<ol>
  <li><strong>Trace it.</strong> Put a <code>tracing::info!</code> in <code>OpenAIPreprocessor</code> that logs the token count, rebuild, send a request to the mocker, find your line. You now know the build-run-observe loop.</li>
  <li><strong>Test it.</strong> Add the block-hash test from the testing lab to the suite (pick a sensible location under <code>tests/</code> or a component's tests folder), with correct markers, and run it.</li>
  <li><strong>Break it.</strong> Run two mockers with <code>--router-mode kv</code>, send a long repeated prompt, then kill the worker it sticks to. Watch inhibition and migration in the logs.</li>
  <li><strong>Read it.</strong> Open ${src("lib/kv-router/src/indexer/radix_tree.rs")} and find the function that answers overlap queries. Compare it with what the indexer lab did.</li>
  <li><strong>Tune it.</strong> Use the router flags from 6.1 with the mocker and a repeated-prefix workload. Can you make TTFT better or worse on purpose?</li>
</ol>
<div class="callout good"><b>Where to go next</b>The docs' Developer Guide → Knowledge Base has a page for every component you met here. The <code>AGENTS.md</code> files scattered through the repo (scheduling, sequences, frontend…) are written for newcomers and agents alike; they're some of the best internal docs in the codebase.</div>
<p class="margin-note">end of course. the codebase is yours now.</p>
`,
    quiz: [
      { q: "Which PR title fits Dynamo's conventions?", a: ["Fixed the router bug", "fix(router): handle empty worker set in kv mode", "[ROUTER] fix", "router: Fix"], c: 1, why: "Conventional Commits: type(scope): summary, with an accepted type like fix." },
      { q: "What does <code>git commit -s</code> add?", a: ["A GPG signature", "A Signed-off-by line for the DCO", "A changelog entry", "A co-author"], c: 1, why: "-s adds the Developer Certificate of Origin sign-off. Verified signatures are a separate thing (-S)." },
    ],
  });
})();
