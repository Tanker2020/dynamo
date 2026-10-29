/* Chapters 5–6: Dynamo's architecture and the deep dives. */
(function () {
  const { t, code, src } = GS;

  /* ================= Chapter 5 ================= */
  GS.chapter({ id: "c5", num: "05", title: "Dynamo architecture", blurb: "The components, the three communication planes, a request's full journey, the pipeline that carries it, and the bridge between Python and Rust." });

  GS.lesson({
    id: "arch-map", ch: "c5", title: "The map: components and planes", mins: 11, labs: 1,
    summary: "A handful of process types talk over three separate planes: discovery, requests and events. Once you can draw this from memory, every file in the repo has a place to hang.",
    goals: ["Name each component and its job", "Explain the discovery, request and event planes and their default transports", "Know which process runs what"],
    body: () => `
<p>Every Dynamo deployment, from a laptop demo to a thousand-GPU cluster, is some arrangement of the same few process types:</p>
<ul>
  <li><strong>${t("frontend", "Frontend")}</strong>: the OpenAI-compatible HTTP server. Templates, tokenizes, routes, streams. Usually hosts the router too.</li>
  <li><strong>${t("router", "Router")}</strong>: picks a worker per request. Embedded in the frontend by default; can also run standalone.</li>
  <li><strong>${t("worker", "Workers")}</strong>: one engine (vLLM, SGLang, TensorRT-LLM, or the mocker) each. Aggregated, or split into prefill and decode.</li>
  <li><strong>${t("planner", "Planner")}</strong>: optional autoscaler.</li>
  <li><strong>${t("kvbm", "KVBM")}</strong>: optional KV offloading, running inside workers.</li>
</ul>

<div data-widget="arch"></div>

<h2>Three planes, three transports</h2>
<p>The single most useful architectural fact: <mark>discovery, requests and events travel separately, and each can use a different transport.</mark></p>
<div class="scroll-x"><table style="border-collapse:collapse;min-width:560px;font-size:15px">
<thead><tr style="text-align:left;border-bottom:1.5px solid var(--ink)"><th style="padding:6px 8px">Plane</th><th>Carries</th><th>Default</th><th>Alternatives</th><th>Env var</th></tr></thead>
<tbody>
<tr style="border-bottom:1px solid var(--rule)"><td style="padding:6px 8px"><b>${t("discovery", "Discovery")}</b></td><td>who exists, where, serving what model</td><td>etcd (local)</td><td>kubernetes, file, mem</td><td><code>DYN_DISCOVERY_BACKEND</code></td></tr>
<tr style="border-bottom:1px solid var(--rule)"><td style="padding:6px 8px"><b>${t("request-plane", "Request")}</b></td><td>RPCs and their streamed responses</td><td>tcp</td><td>nats</td><td><code>DYN_REQUEST_PLANE</code></td></tr>
<tr style="border-bottom:1px solid var(--rule)"><td style="padding:6px 8px"><b>${t("event-plane", "Event")}</b></td><td>KV events, worker load metrics</td><td>zmq</td><td>nats</td><td><code>DYN_EVENT_PLANE</code></td></tr>
</tbody></table></div>
<p>The defaults are written right in the code:</p>
${code("rust", `pub enum RequestPlaneMode {
    /// Use NATS for request plane
    Nats,
    /// Use raw TCP for request plane with msgpack support
    #[default] //<<
    Tcp,
}

pub enum EventTransportKind {
    /// NATS Core pub/sub
    Nats,
    /// ZMQ pub/sub
    #[default] //<<
    Zmq,
}`, "lib/runtime/src/distributed.rs")}
<p>On Kubernetes, the operator sets <code>DYN_DISCOVERY_BACKEND=kubernetes</code> and no etcd or NATS is needed at all. Locally, <code>--discovery-backend file</code> gets you running with zero infrastructure, which is what you'll do in chapter 7.</p>
<p class="margin-note">Older docs and blog posts say “etcd + NATS are required.” Not anymore. Trust the code.</p>
`,
    quiz: [
      { q: "Which plane carries “worker 0x1a just stored these KV blocks”?", a: ["Discovery", "Request", "Event", "HTTP"], c: 2, why: "KV events are fire-and-forget pub/sub on the event plane (ZMQ by default)." },
      { q: "What's the default request-plane transport?", a: ["NATS", "TCP", "HTTP/2", "ZMQ"], c: 1, why: "RequestPlaneMode marks Tcp as #[default]." },
      { q: "Where does the KV router run by default?", a: ["Inside each worker", "Inside the frontend process", "Inside etcd", "In the planner"], c: 1, why: "It's embedded in the frontend unless you deploy a standalone router." },
    ],
  });

  GS.lesson({
    id: "request-journey", ch: "c5", title: "A request's journey, stop by stop", mins: 14, labs: 1,
    summary: "Follow one chat completion from curl to the GPU and back. At each stop: what the data looks like, which code handles it.",
    goals: ["Trace a request through HTTP, preprocessing, routing, the network and a worker", "Name the struct at each stage", "Know where cancellation and KV events fit in"],
    body: () => `
<p>This is the lesson to come back to whenever you're lost in the codebase. Almost every file you'll touch sits somewhere along this path.</p>

<div data-widget="journey"></div>

<h2>Three things the stepper glosses over</h2>
<h3>The context travels with the request</h3>
<p>The request ID and its stop/kill controls are created in the HTTP layer and carried across every hop, including the network. When the client hangs up, cancellation flows all the way down to the engine, so the GPU stops generating tokens nobody will read. The design doc for this lives at ${src("docs/fern/pages/developer-guide/knowledge-base/concepts/fault-tolerance/request-cancellation-architecture.md", "request-cancellation-architecture.md")}.</p>
<h3>Model Deployment Cards</h3>
<p>How does the frontend know which chat template and tokenizer to use, or the block size? Each worker publishes a ${t("mdc", "Model Deployment Card")} through discovery when it registers its model. The frontend watches for cards and builds a pipeline per model as workers appear. That's why you start the frontend first and workers later, and the model just shows up.</p>
<h3>Disaggregated requests take a detour</h3>
<p>With prefill/decode split, step 5 becomes two routing decisions: the <code>PrefillRouter</code> sends the prompt to a prefill worker first, then routes the decode request (now carrying KV transfer metadata) to a decode worker. Everything else is the same.</p>
`,
    quiz: [
      { q: "In which component are chat templates applied?", a: ["The worker", "The frontend's preprocessor", "The router", "etcd"], c: 1, why: "OpenAIPreprocessor in lib/llm renders the template and tokenizes." },
      { q: "How does the frontend learn a new model's tokenizer and block size?", a: ["From a config file you edit", "From the Model Deployment Card the worker publishes via discovery", "By asking Hugging Face on every request", "From the HTTP request"], c: 1, why: "Workers register an MDC; the frontend watches discovery and builds pipelines from it." },
    ],
  });

  GS.lesson({
    id: "runtime", ch: "c5", title: "The distributed runtime", mins: 13, labs: 1,
    summary: "Every Dynamo process creates a DistributedRuntime and addresses services as namespace.component.endpoint. Discovery keeps the list of live instances honest using leases.",
    goals: ["Explain DistributedRuntime → Namespace → Component → Endpoint → Instance", "Explain how leases remove dead workers", "Know what local inhibition does after a failed request"],
    body: () => `
<h2>Four levels of naming</h2>
${code("text", `DistributedRuntime     one per process: connections, background tasks, cancellation
└─ Namespace           "dynamo"        one logical deployment
   └─ Component        "backend"       workers with the same role
      └─ Endpoint      "generate"      a callable function
         └─ Instance   0x1a2b…         one running copy, by instance_id`, null, { label: "the hierarchy" })}
<p>From Python you address an endpoint with a dotted path, as the hello-world example does: <code>runtime.endpoint("hello_world.backend.generate")</code>. A server calls <code>serve_endpoint(handler)</code> on it; a client calls <code>.client()</code>, waits for instances, and sends requests. The runtime picks an ${t("instance")} (round-robin, random, or a specific one) unless a smarter router like the KV router chooses for it.</p>
${code("rust", `pub struct Instance {
    pub component: String,
    pub endpoint: String,
    pub namespace: String,
    pub instance_id: u64, //<<
    pub transport: TransportType,       // how to reach it: Tcp(addr) or Nats(subject)
    pub device_type: Option<DeviceType>, // Cpu or Cuda
    pub request_plane_codec: Option<RequestPlanePayloadCodec>,
}`, "lib/runtime/src/component.rs")}

<h2>Leases: how dead workers disappear</h2>
<p>In etcd mode, a worker's registration key is attached to a ${t("lease", "lease")}. The worker sends keep-alive heartbeats; if the process dies, heartbeats stop, the lease expires, and etcd deletes the key. Every client watching that prefix sees the deletion and stops routing there. The key format comes from ${src("lib/runtime/src/discovery/kv_store.rs", "kv_store.rs")}: <code>v1/instances/{namespace}/{component}/{endpoint}/{instance_id as hex}</code>.</p>
<p>There's a gap, though: between the crash and the lease expiring, the key still exists. The runtime covers it with <strong>local inhibition</strong>: when a request to an instance fails, that client stops sending to it for <code>DYN_RUNTIME_INHIBITED_DURATION_SECS</code> (5 s by default) while discovery catches up. Try it:</p>

<div data-widget="discovery"></div>

<h2>The Discovery trait</h2>
<p>All backends (etcd, Kubernetes, file, memory) implement one trait, so the rest of the runtime doesn't care which is active:</p>
${code("rust", `#[async_trait]
pub trait Discovery: Send + Sync {
    /// Returns a unique identifier for this worker (e.g lease id if using etcd
    /// or generated id for memory store)
    fn instance_id(&self) -> u64;

    /// Registers an object in the discovery plane with the instance id
    async fn register(&self, spec: DiscoverySpec) -> Result<DiscoveryInstance>;
    // ... list, watch, unregister ...
}`, "lib/runtime/src/discovery/mod.rs")}
<p>And the runtime chooses one from the environment:</p>
${code("rust", `// Valid values for DYN_DISCOVERY_BACKEND: "kubernetes", "etcd" (default), "file", "mem"`, "lib/runtime/src/distributed.rs")}
<p class="margin-note">Mocking discovery in tests? There's a <code>MockDiscovery</code> in the same module.</p>
`,
    quiz: [
      { q: "A worker is killed with SIGKILL. In etcd mode, what eventually removes its instance key?", a: ["The worker's shutdown hook", "Lease expiry after heartbeats stop", "The frontend deletes it", "Nothing; it stays forever"], c: 1, why: "SIGKILL skips cleanup. The lease stops being renewed and etcd deletes the key when it expires." },
      { q: "What is local inhibition for?", a: ["Rate-limiting clients", "Avoiding a known-bad instance during the window before discovery removes it", "Preventing duplicate registrations", "Pausing the planner"], c: 1, why: "After a failed request, the client skips that instance for a few seconds while the lease expires." },
    ],
  });

  GS.lesson({
    id: "pipelines", ch: "c5", title: "Pipelines: operators all the way down", mins: 12, labs: 1,
    summary: "The frontend's request handling is a chain of operators snapped together with .link(). Each one transforms the request going down and the stream coming back up.",
    goals: ["Read the build_pipeline link chain", "Explain forward and backward edges", "Know where to add a new pre- or post-processing step"],
    body: () => `
<p>Remember the ${t("operator")} trait from chapter 4: it receives a request plus the next engine, and returns a response. Chain enough of them and you get a ${t("pipeline")}, like middleware in a web framework, except that the response is a stream that flows back up through every layer.</p>
<p>Each operator contributes two edges: a <strong>forward edge</strong> (request on the way down) and a <strong>backward edge</strong> (response stream on the way up). The chain is written in the order data flows, so it reads like an onion: down through the layers, through the core, then back out in reverse order.</p>

<div data-widget="pipeline"></div>

<h2>Why build it this way?</h2>
<ul>
  <li><strong>Separation:</strong> templating, migration, detokenization, multimodal encoding and disaggregation are independent, testable pieces.</li>
  <li><strong>Types catch mistakes:</strong> each <code>.link()</code> checks that one stage's output type matches the next stage's input type. Plug the wrong things together and it won't compile.</li>
  <li><strong>Variations are cheap:</strong> the same file builds a simpler pipeline when an engine runs in-process, and a different one when the frontend delegates pre/post-processing to vLLM or SGLang (<code>--dyn-chat-processor</code>).</li>
</ul>

<h2>Request migration, in one paragraph</h2>
<p>The <code>Migration</code> operator is worth knowing because it's a Dynamo signature feature. It sits above the token backend, so it sees every generated token. If the stream from a worker breaks mid-generation, it reissues the request (prompt plus everything generated so far) to another worker, up to <code>migration_limit</code> times. The user sees a brief pause, not an error. Design doc: ${src("docs/fern/pages/developer-guide/knowledge-base/concepts/fault-tolerance/request-migration-architecture.md", "request-migration-architecture.md")}.</p>
`,
    quiz: [
      { q: "In the link chain, why does <code>token_backend.backward_edge()</code> appear after <code>prefill_op.backward_edge()</code>?", a: ["Alphabetical order", "Backward edges are linked in reverse order, because the response climbs back up through the layers", "It's a bug", "Backward edges run in parallel"], c: 1, why: "Down: preprocessor → … → backend. Up: the reverse, so the response passes the innermost operator first." },
      { q: "Where would detokenization (token IDs → text) naturally live?", a: ["Preprocessor forward edge", "Backend (token_backend) backward edge", "Migration forward edge", "The HTTP handler"], c: 1, why: "The Backend operator wraps the response stream with an incremental decoder on the way up." },
    ],
  });

  GS.lesson({
    id: "python-bridge", ch: "c5", title: "The Python ↔ Rust bridge", mins: 11,
    summary: "The processes you launch are Python, but the runtime underneath is Rust. PyO3 glues them together, and the hello-world example shows the whole contract in 40 lines.",
    goals: ["Read the hello-world worker and client", "Explain what @dynamo_worker does", "Know how the frontend hands control to Rust"],
    body: () => `
<p>The Rust crate in ${src("lib/bindings/python")} is built with ${t("pyo3", "PyO3 and maturin")} into a native Python module called <code>dynamo._core</code>. Python packages like <code>dynamo.runtime</code> and <code>dynamo.llm</code> re-export its classes and add thin Pythonic wrappers.</p>
${code("rust", `#[pymodule]
fn _core(m: &Bound<'_, PyModule>) -> PyResult<()> {
    register_core(m)   // adds DistributedRuntime, Endpoint, Client, make_engine, run_input, ...
}`, "lib/bindings/python/rust/lib.rs")}

<h2>A complete worker</h2>
<p>This is the entire hello-world backend. It's the best 40 lines in the repo for understanding the runtime contract:</p>
${code("python", `from dynamo.runtime import DistributedRuntime, dynamo_endpoint, dynamo_worker


@dynamo_endpoint(str, str)
async def content_generator(request: str):
    logger.info(f"Received request: {request}")
    for word in request.split(","):
        await asyncio.sleep(1)
        yield f"Hello {word}!"   #<<


@dynamo_worker()
async def worker(runtime: DistributedRuntime):
    namespace_name = "hello_world"
    component_name = "backend"
    endpoint_name = "generate"

    endpoint = runtime.endpoint(f"{namespace_name}.{component_name}.{endpoint_name}")

    logger.info(f"Serving endpoint {namespace_name}/{component_name}/{endpoint_name}")
    await endpoint.serve_endpoint(content_generator)   #<<`, "examples/custom_backend/hello_world/hello_world.py")}
<ul>
  <li>The handler is an <strong>async generator</strong>: every <code>yield</code> becomes one item in the response stream, which Rust ships back over the request plane. Real engine handlers (like <code>generate</code> in the vLLM handlers) are the same shape, yielding token chunks.</li>
  <li><code>serve_endpoint</code> registers the endpoint in discovery and starts accepting requests. It runs until shutdown.</li>
</ul>
<p>And the client side:</p>
${code("python", `endpoint = runtime.endpoint("hello_world.backend.generate")
client = await endpoint.client()
await client.wait_for_instances()          # block until discovery shows a worker

stream = await client.generate("world,sun,moon,star")
async for response in stream:
    print(response.data())`, "examples/custom_backend/hello_world/client.py")}

<h2>What @dynamo_worker does</h2>
${code("python", `def dynamo_worker(enable_nats: Optional[bool] = None):
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            loop = asyncio.get_running_loop()
            request_plane = os.environ.get("DYN_REQUEST_PLANE", "tcp")
            discovery_backend = os.environ.get("DYN_DISCOVERY_BACKEND", "etcd")
            runtime = DistributedRuntime(loop, discovery_backend, request_plane) #<<

            await func(runtime, *args, **kwargs)
        return wrapper
    return decorator`, "lib/bindings/python/src/dynamo/runtime/__init__.py")}
<p>It builds the Rust <code>DistributedRuntime</code>, handing it Python's running event loop so Rust can call back into your async generators, and reads the same env vars you met in the planes table.</p>

<h2>The frontend is mostly Rust</h2>
<p><code>python -m dynamo.frontend</code> parses flags in Python, then gives control to Rust:</p>
${code("python", `e = EntrypointArgs(EngineType.Dynamic, **kwargs)
engine = await make_engine(runtime, e)
# ...
await run_input(runtime, "http", engine, frontend_route_extensions) #<<`, "components/src/dynamo/frontend/main.py")}
<p><code>EngineType.Dynamic</code> means "discover models from workers as they appear." <code>run_input(…, "http", …)</code> starts the Rust HTTP server, and from then on your request never touches Python in the frontend.</p>
`,
    quiz: [
      { q: "In a Dynamo Python handler, what does each <code>yield</code> become?", a: ["A log line", "One item of the response stream sent back to the caller", "A new request", "A KV event"], c: 1, why: "Handlers are async generators; yields are streamed back over the request plane." },
      { q: "Why does <code>DistributedRuntime</code> receive Python's event loop?", a: ["To print logs", "So the Rust runtime can schedule and drive Python coroutines (your handlers)", "To read env vars", "It doesn't"], c: 1, why: "Rust needs the loop to call into async Python code from its own tasks." },
    ],
  });

  /* ================= Chapter 6 ================= */
  GS.chapter({ id: "c6", num: "06", title: "Deep dives", blurb: "The KV router's cost function, the indexer that feeds it, KV offloading across memory tiers, the planner, and the Kubernetes layer." });

  GS.lesson({
    id: "kv-router", ch: "c6", title: "KV-aware routing", mins: 15, labs: 1,
    summary: "Send each request to the worker that already caches most of its prompt, unless that worker is drowning. One cost formula balances the two, and you can tune it from the command line.",
    goals: ["Compute the router's cost by hand", "Explain what overlap credit, prefill load scale and temperature trade off", "Find the router's code and flags"],
    body: () => `
<p>Round-robin routing ignores the cache: a returning chat user lands on a random worker and pays full prefill again. The ${t("kv-router", "KV-aware router")} looks at which workers already hold the request's blocks (from the ${t("indexer")}, next lesson) and at how loaded each one is.</p>
<p>A small but telling comment on the main struct:</p>
${code("rust", `/// A KvRouter only decides which worker you should use. It doesn't send you there.
/// TODO: Rename this to indicate it only selects a worker, it does not route.
pub struct KvRouter {
    indexer: Indexer,
    selection: embedded::EmbeddedSelection,
    block_size: u32,
    kv_router_config: KvRouterConfig,
    // ...
}`, "lib/llm/src/kv_router.rs")}

<h2>The cost function</h2>
<p>For every candidate worker:</p>
<ul>
  <li><strong>prefill blocks</strong> = prompt work already queued on that worker + this request's blocks.</li>
  <li>Subtract a credit for blocks it already caches: <code>overlap_score_credit × overlap</code> (default credit 1.0).</li>
  <li>Add <strong>potential decode blocks</strong>: what it'll be holding while decoding, including this request.</li>
  <li>Lowest total wins. With <code>router_temperature &gt; 0</code>, costs become softmax probabilities instead (chapter 1's trick).</li>
</ul>

<div data-widget="router"></div>

<h2>Turning the knobs</h2>
<ul>
  <li><strong>Higher overlap credit</strong> → chase cache hits harder → better TTFT, risk of hot spots.</li>
  <li><strong>Higher prefill load scale</strong> → penalise queued prompt work → spreads prefill, protects TTFT under bursts.</li>
  <li><strong>Temperature</strong> → a little randomness so near-ties don't all pile onto one worker.</li>
</ul>
${code("bash", `python3 -m dynamo.frontend --router-mode kv \\
  --router-kv-overlap-score-credit 1.5 \\
  --router-prefill-load-scale 1.0 \\
  --router-temperature 0.2`, null, { label: "frontend flags" })}
<p>The full formula also credits blocks found in host memory, on disk, and in a shared cache pool (with weights like 0.75 for host hits and 0.25 for disk by default), so KVBM offloading makes the router smarter too. Read the details in ${src("docs/fern/pages/developer-guide/knowledge-base/modular-components/router/router-design.md", "router-design.md")}; the scheduling code lives in ${src("lib/kv-router/src/scheduling")} (its <code>AGENTS.md</code> explains the queue hierarchy).</p>
<p class="margin-note">Other modes: round-robin, random, power-of-two, least-loaded, direct, device-aware-weighted. KV mode is the one that makes Dynamo Dynamo.</p>
`,
    quiz: [
      { q: "Worker A: 10 request blocks, 6 cached, decode 4. Worker B: 10 request blocks, 0 cached, decode 1. Credit 1.0, scale 1.0, nothing queued. Which wins?", a: ["A (cost 8)", "B (cost 11)", "Tie", "Can't tell"], c: 0, why: "A = (10 − 6) + 4 = 8. B = (10 − 0) + 1 = 11. Lower cost wins: A." },
      { q: "You see one worker getting hammered because everyone shares a giant system prompt. Which change helps spread load?", a: ["Raise overlap_score_credit", "Lower overlap_score_credit or add a little router_temperature", "Lower prefill_load_scale to 0", "Switch discovery to file"], c: 1, why: "Less credit for overlap (or some randomness) lets load terms win more often." },
    ],
  });

  GS.lesson({
    id: "indexer", ch: "c6", title: "The indexer and KV events", mins: 12, labs: 1,
    summary: "The router's knowledge of every worker's cache comes from a stream of tiny events folded into a prefix tree. It has to sustain millions of operations per second.",
    goals: ["Explain Stored, Removed and Cleared events", "Explain how a prefix tree answers overlap queries", "Know how routers recover from missed events"],
    body: () => `
<p>When an engine stores or evicts KV blocks, a publisher in the worker emits a ${t("kv-events", "KV event")}:</p>
${code("rust", `pub enum KvCacheEventData {
    Stored(KvCacheStoreData),
    Removed(KvCacheRemoveData),
    /// Remove all KV ownership for the emitting (worker_id, dp_rank).
    Cleared,
}

pub struct KvCacheStoreData {
    /// The optional hash of the parent block.
    pub parent_hash: Option<ExternalSequenceBlockHash>, //<<
    pub start_position: Option<u32>,
    pub blocks: Vec<KvCacheStoredBlockData>,
}`, "lib/kv-router/src/protocols.rs")}
<p>The ${t("indexer")} folds all these events into one ${t("radix-tree", "prefix tree")}, where each node is a block and carries the set of workers holding it. To score a request, walk down the tree along its block hashes; for each worker, count how far the path goes before that worker drops out. That count is the "overlap" the cost function used.</p>

<div data-widget="radix"></div>

<h2>Fast, because it has to be</h2>
<p>Every request triggers a lookup and every engine step can emit events. The indexer README (it calls itself FlashIndexer) reports the concurrent implementations sustaining over 10 million events + requests per second with p99 under 10 µs. Variants live side by side in ${src("lib/kv-router/src/indexer")}:</p>
<ul>
  <li><code>RadixTree</code>: single-threaded, <code>Rc&lt;RefCell&gt;</code> nodes, on a dedicated thread.</li>
  <li><code>ConcurrentRadixTreeCompressed</code>: the default; thread-safe, reads run concurrently with writes, a pool of event threads (<code>--router-event-threads</code>).</li>
  <li><code>PositionalIndexer</code>: a flat <code>DashMap</code> keyed by (position, hash).</li>
</ul>

<h2>Missing events</h2>
<p>Events are fire-and-forget, so some get lost. Each worker keeps its own local indexer and numbers its events. A router that sees a gap in the sequence asks that worker's local indexer to replay what it missed. New routers rebuild their tree the same way on startup. And with <code>--no-router-kv-events</code>, the router skips events entirely and approximates cache contents from its own routing decisions.</p>
`,
    quiz: [
      { q: "Request blocks [a, b, c, d]. Worker 1 holds a, b, c. Worker 2 holds a, c, d. What overlaps does the indexer report?", a: ["W1: 3, W2: 3", "W1: 3, W2: 1", "W1: 3, W2: 0", "W1: 4, W2: 2"], c: 1, why: "Overlap is the matching prefix. W2 has a but not b, so it stops at 1; c and d don't count without b." },
      { q: "How does a router recover after missing some KV events from a worker?", a: ["It can't; state is wrong forever", "It detects a gap in the worker's event IDs and queries the worker's local indexer", "It restarts the worker", "It asks etcd"], c: 1, why: "Monotonic event IDs reveal gaps; the worker's local indexer can replay." },
    ],
  });

  GS.lesson({
    id: "kvbm", ch: "c6", title: "KVBM: memory tiers for the cache", mins: 11, labs: 1,
    summary: "GPU memory is tiny next to the amount of KV worth keeping. The KV Block Manager spills blocks down a hierarchy of cheaper memory and pulls them back on a hit.",
    goals: ["Name the four tiers and their trade-offs", "Explain offload and onboard", "Explain when offloading beats recomputing"],
    body: () => `
<p>When GPU memory fills, engines evict KV blocks, and a returning user pays full prefill again. But a server usually has far more CPU RAM than GPU memory, plus fast local SSDs, plus network storage. ${t("kvbm", "KVBM")} turns those into extra cache tiers:</p>
${code("rust", `/// GPU/device tier -- HBM KV cache. Fastest access, smallest capacity.
pub struct G1;
/// CPU/host tier -- pinned DRAM cache. Microsecond-latency staging area
/// for RDMA transfers and G3/G4 promotion.
pub struct G2;
/// Disk tier -- NVMe/SSD cache. Millisecond-latency persistent storage
/// for warm blocks.
pub struct G3;
/// Object store tier -- S3/MinIO. Highest latency but unlimited capacity
/// for cold/archival blocks.
pub struct G4;`, "lib/kvbm-engine/src/lib.rs")}
<p><strong>Offload</strong> copies blocks down a tier when they're evicted from above. <strong>Onboard</strong> copies them back up to the GPU when a request needs them. Both are block transfers, which is why NIXL shows up here too.</p>

<div data-widget="kvbm"></div>

<h2>When is it worth it?</h2>
<p>Recomputing a block means running prefill math for its tokens. Onboarding means moving its bytes. For long shared contexts (multi-turn chat, agents re-reading a repo, RAG documents), moving bytes from CPU memory is far cheaper than recomputing, and even SSD can win. For short, unique prompts it doesn't matter much. That's why agentic workloads are the poster child for KVBM.</p>
<p>The router knows about tiers too: remember the host and disk hit weights in the cost formula. A block in G2 is worth less than one in G1, but much more than nothing.</p>
<p>The code is split into several crates: ${src("lib/kvbm-logical")} (block lifecycle, pools, registry), ${src("lib/kvbm-physical")} (memory layouts and transfers), ${src("lib/kvbm-engine")} (leader/worker runtime and offload policies), and ${src("lib/kvbm-kernels")} (CUDA kernels for fast copies).</p>
`,
    quiz: [
      { q: "A long conversation's blocks were evicted from GPU but kept in CPU memory (G2). The user sends another turn. What happens?", a: ["Full prefill from scratch", "The blocks are onboarded from G2 back to GPU, skipping that prefill", "The request fails", "The blocks are read directly from CPU during attention"], c: 1, why: "Onboarding copies blocks up to G1, which is much cheaper than recomputing them." },
    ],
  });

  GS.lesson({
    id: "planner", ch: "c6", title: "The planner: scaling to SLAs", mins: 10, labs: 1,
    summary: "LLM load isn't proportional to request count, and GPUs take minutes to start. Dynamo's planner scales prefill and decode separately, aiming at TTFT and ITL rather than CPU percentages.",
    goals: ["Explain why CPU-based autoscalers fail for LLMs", "Explain reactive vs predictive scaling", "Know the planner's optimisation targets"],
    body: () => `
<p>The planner overview makes the case well: a request with a 32K-token prompt costs orders of magnitude more than a short one, prefill and decode scale differently, and spinning up a GPU worker takes minutes. A generic autoscaler watching CPU or request rate gets all of that wrong.</p>

<div data-widget="planner"></div>

<p>The real ${t("planner")} works at the level of prefill and decode replicas and offers four optimisation targets:</p>
<div class="scroll-x"><table style="border-collapse:collapse;min-width:520px;font-size:15px">
<thead><tr style="text-align:left;border-bottom:1.5px solid var(--ink)"><th style="padding:6px 8px">Target</th><th>Idea</th></tr></thead><tbody>
<tr style="border-bottom:1px solid var(--rule)"><td style="padding:6px 8px"><code>throughput</code> (default)</td><td>Scale on queue depth and KV cache utilisation.</td></tr>
<tr style="border-bottom:1px solid var(--rule)"><td style="padding:6px 8px"><code>latency</code></td><td>Scale more aggressively to keep queues short.</td></tr>
<tr style="border-bottom:1px solid var(--rule)"><td style="padding:6px 8px"><code>load</code></td><td>Your own thresholds for prefill queue tokens and decode KV utilisation.</td></tr>
<tr style="border-bottom:1px solid var(--rule)"><td style="padding:6px 8px"><code>sla</code></td><td>Hit explicit TTFT/ITL targets using performance models and traffic prediction.</td></tr>
</tbody></table></div>
<p>Throughput-based scaling can forecast traffic with predictors (ARIMA, Prophet, Kalman, constant); load-based scaling reads engine forward-pass metrics live over the event plane. A <code>KubernetesConnector</code> applies decisions to a cluster; a <code>VirtualConnector</code> lets you test without one. Code: ${src("components/src/dynamo/planner")}.</p>
`,
    quiz: [
      { q: "Why can't you just autoscale LLM workers on request rate?", a: ["Request rate is hard to measure", "Cost per request varies hugely with prompt/output length, and prefill and decode scale differently", "Kubernetes forbids it", "GPUs don't report metrics"], c: 1, why: "Two requests/second can mean wildly different GPU load depending on sequence lengths." },
      { q: "In the lab, why does predictive scaling handle the spike better?", a: ["It has more GPUs", "It starts replicas before demand arrives, hiding the spin-up delay", "It ignores the SLA", "It scales down faster"], c: 1, why: "With minutes of spin-up, reacting after the fact is too late; forecasting buys that time back." },
    ],
  });

  GS.lesson({
    id: "kubernetes", ch: "c6", title: "The Kubernetes layer", mins: 9,
    summary: "In production, a single YAML resource describes the whole deployment and a Go operator makes the cluster match it. You can ignore this layer until you need it, but you should recognise it.",
    goals: ["Read a DynamoGraphDeployment", "Know what the operator does", "Know where the Go code lives"],
    body: () => `
<p>On Kubernetes you don't launch processes by hand. You apply a ${t("dgd", "DynamoGraphDeployment")} and the ${t("operator_k8s", "Dynamo operator")} creates and manages the pods. Here's the start of the mocker example (no GPUs needed even on a cluster):</p>
${code("yaml", `apiVersion: nvidia.com/v1beta1
kind: DynamoGraphDeployment
metadata:
  name: mocker-agg
spec:
  components:
  - name: Frontend
    type: frontend
    replicas: 1
    podTemplate:
      spec:
        containers:
        - image: nvcr.io/nvidia/ai-dynamo/dynamo-planner:my-tag
          name: main
  - name: decode
    podTemplate:
      spec:
        containers:
        - command: [python3, -m, dynamo.mocker]
          args:
          - --model-path
          - nvidia/Llama-3.1-8B-Instruct-FP8
          # ...`, "examples/backends/mocker/deploy/agg.yaml")}
<ul>
  <li>The operator (Go, controller-runtime) lives in ${src("deploy/operator")}. The CRD types are in <code>deploy/operator/api/</code>, e.g. <code>dynamographdeployment_types.go</code>.</li>
  <li>It sets <code>DYN_DISCOVERY_BACKEND=kubernetes</code>, so discovery uses Kubernetes resources instead of etcd.</li>
  <li>${t("grove", "Grove")} handles topology-aware gang scheduling for multi-node workers.</li>
  <li>A <strong>DynamoGraphDeploymentRequest</strong> (DGDR) goes one level higher: describe the model and SLA, and the profiler/planner tooling helps pick a configuration.</li>
  <li>Ready-made deployments live in <code>recipes/</code>; the docs' Kubernetes tab walks through installation.</li>
</ul>
<p class="margin-note">This layer is Go. If you're here to learn Rust and inference, park it until a task needs it.</p>
`,
    quiz: [
      { q: "What does the Dynamo operator do with a DynamoGraphDeployment?", a: ["Runs inference itself", "Creates and reconciles the pods and services it describes", "Tokenizes requests", "Replaces etcd with NATS"], c: 1, why: "Operators watch custom resources and make the cluster match them." },
    ],
  });
})();
