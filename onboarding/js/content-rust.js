/* Chapter 4: Rust, refreshed through Dynamo's own code. */
(function () {
  const { t, code, src } = GS;

  GS.chapter({ id: "c4", num: "04", title: "Rust, refreshed", blurb: "Ownership, traits, Arc, async streams, errors and types, each taught with real Dynamo code so the syntax sticks to something." });

  GS.lesson({
    id: "rust-ownership", ch: "c4", title: "Ownership and borrowing, again", mins: 12, labs: 1,
    summary: "One owner per value, borrows that can't outlive it, and either many readers or one writer. Five minutes of review, then a quiz that bites.",
    goals: ["Predict moves, borrows and drops", "Fix the three most common borrow-checker errors", "Read Option::take as an ownership move"],
    body: () => `
<h2>The three rules</h2>
<ol>
  <li>Every value has exactly one ${t("ownership", "owner")}. Assigning or passing it by value <strong>moves</strong> it; the old name is dead.</li>
  <li>You can ${t("borrowing", "borrow")} it instead: any number of shared references <code>&amp;T</code>, <em>or</em> exactly one mutable reference <code>&amp;mut T</code>, never both at once.</li>
  <li>A reference can't outlive the value it points to (that's what ${t("lifetime", "lifetimes")} track). When the owner goes out of scope, the value is dropped.</li>
</ol>
${code("rust", `fn consume(s: String) {}          // takes ownership
fn peek(s: &str) -> usize { s.len() }   // borrows, read-only
fn shout(s: &mut String) { s.push('!'); } // borrows, can modify

let mut msg = String::from("hello");
peek(&msg);          // fine, msg still ours
shout(&mut msg);     // fine, exclusive borrow ends here
consume(msg);        // moved //<<
// peek(&msg);       // error[E0382]: borrow of moved value: msg`, null, { label: "refresher" })}

<div data-widget="borrow"></div>

<h2>Ownership in Dynamo: taking a stream exactly once</h2>
<p>Here's a real type from the runtime. A request stream can only be consumed by one caller, but the wrapper has to be shareable across threads. The trick is <code>Option::take</code>, which <em>moves</em> the value out and leaves <code>None</code> behind:</p>
${code("rust", `pub struct RequestStream<T: Data> {
    inner: std::sync::Mutex<Option<DataStream<T>>>,
}

impl<T: Data> RequestStream<T> {
    /// Atomically move the inner stream out. Returns Some(stream) exactly
    /// once across all threads racing on the same RequestStream; every
    /// subsequent call (on any thread) returns None.
    pub fn take(&self) -> Option<DataStream<T>> {
        self.inner.lock().unwrap().take() //<<
    }
}`, "lib/runtime/src/pipeline.rs")}
<p>Read it slowly: <code>&amp;self</code> is a shared borrow, yet we move something out. That works because the <code>Mutex</code> gives temporary exclusive access to the <code>Option</code> inside, and <code>take()</code> swaps it for <code>None</code>. Ownership of the stream leaves the struct and goes to the caller. This pattern (interior mutability + <code>take</code>) appears all over async Rust.</p>
<p class="margin-note">Rule of thumb in reviews: a <code>.clone()</code> added just to silence the borrow checker will be questioned. The repo even has a skill for auditing hot-path clones.</p>
`,
    quiz: [
      { q: "After <code>let b = a;</code> where <code>a: Vec&lt;u32&gt;</code>, what is true?", a: ["a and b point to the same Vec", "a is moved and can no longer be used", "a is copied", "It doesn't compile"], c: 1, why: "Vec isn't Copy, so assignment moves ownership to b." },
      { q: "Why can <code>RequestStream::take(&self)</code> move the stream out through a shared reference?", a: ["It uses unsafe", "The Mutex provides interior mutability, and Option::take swaps the value for None", "Shared references allow moves", "It clones the stream"], c: 1, why: "Locking the Mutex yields a guard with mutable access to the Option; take() moves the value out and leaves None." },
    ],
  });

  GS.lesson({
    id: "rust-traits", ch: "c4", title: "Traits, generics and dyn: the AsyncEngine", mins: 13,
    summary: "Dynamo is built on one idea: everything is an engine that takes a request and returns a response. That idea is a trait, and you'll see it everywhere.",
    goals: ["Read a generic trait with bounds", "Explain blanket impls", "Explain when Dynamo uses dyn Trait and why"],
    body: () => `
<h2>Traits are interfaces</h2>
<p>A ${t("trait")} lists methods a type promises to have. Generic code says "give me any type that implements this trait." Here's the most important trait in the codebase:</p>
${code("rust", `#[async_trait]
pub trait AsyncEngine<Req: Send + 'static, Resp: AsyncEngineContextProvider, E: Data>:
    Send + Sync
{
    /// Generate a stream of completion responses.
    async fn generate(&self, request: Req) -> Result<Resp, E>; //<<
}`, "lib/runtime/src/engine.rs")}
<p>Decode it piece by piece:</p>
<ul>
  <li><code>AsyncEngine&lt;Req, Resp, E&gt;</code>: generic over the request type, response type and error type.</li>
  <li><code>Req: Send + 'static</code>: requests must be movable across threads (${t("sendsync", "Send")}) and own their data (<code>'static</code>, no borrowed references that could dangle).</li>
  <li><code>: Send + Sync</code> after the generics: every engine itself must be safe to share between threads, because many requests call it concurrently.</li>
  <li><code>#[async_trait]</code>: a macro that makes <code>async fn</code> in traits work with trait objects by boxing the returned future.</li>
</ul>
<p>The HTTP layer, the preprocessor, the router, a remote worker reached over TCP: each is "something with <code>generate</code>." That uniformity is what lets the pipeline in chapter 5 snap stages together.</p>

<h2>Blanket implementations</h2>
${code("rust", `/// All Send + Sync + 'static types can be used as AsyncEngine request and response types.
pub trait Data: Send + Sync + 'static {}
impl<T: Send + Sync + 'static> Data for T {} //<<`, "lib/runtime/src/engine.rs")}
<p>That second line implements <code>Data</code> for <em>every</em> type that meets the bounds. You never write <code>impl Data for MyStruct</code>; if your struct is thread-safe and owns its data, it already is <code>Data</code>. <code>Data</code> is really a short name for a bundle of bounds.</p>

<h2>dyn Trait: picking the type at runtime</h2>
<p>Generics are resolved at compile time. Sometimes you don't know the concrete type until runtime: which model was loaded? which backend registered? Then you use a ${t("trait-object", "trait object")}:</p>
${code("rust", `pub type Engine<Req, Resp, E> = Arc<dyn AsyncEngine<Req, Resp, E>>; //<<
pub type DataStream<T> = Pin<Box<dyn Stream<Item = T> + Send>>;`, "lib/runtime/src/engine.rs")}
<p><code>dyn AsyncEngine&lt;…&gt;</code> means "some type implementing this trait, decided at runtime, called through a vtable." It must live behind a pointer (<code>Arc</code>, <code>Box</code>) because its size isn't known at compile time. The file even documents how Dynamo goes one step further and erases the generic parameters too, so engines with different request types can share one <code>HashMap&lt;String, Arc&lt;dyn AnyAsyncEngine&gt;&gt;</code>.</p>

<h2>A trait with a default method</h2>
${code("rust", `pub trait Operator<UpIn: PipelineIO, UpOut: PipelineIO, DownIn: PipelineIO, DownOut: PipelineIO>:
    Data
{
    /// transform the upstream request UpIn to the downstream request DownIn,
    /// call the next AsyncEngine, then transform DownOut to UpOut.
    async fn generate(
        &self,
        req: UpIn,
        next: Arc<dyn AsyncEngine<DownIn, DownOut, Error>>, //<<
    ) -> Result<UpOut, Error>;

    fn into_operator(self: &Arc<Self>) -> Arc<PipelineOperator<UpIn, UpOut, DownIn, DownOut>>
    where
        Self: Sized,
    {
        PipelineOperator::new(self.clone())
    }
}`, "lib/runtime/src/pipeline/nodes.rs")}
<p>An ${t("operator")} is a middleware: it gets the request <em>and</em> the next engine in the chain. Four type parameters describe what comes in from above, what goes back up, what it sends down, and what comes back from below. <code>into_operator</code> is a provided method every implementor gets for free. Note <code>self: &amp;Arc&lt;Self&gt;</code>: the method can only be called on an <code>Arc</code>-wrapped operator, so cloning it just bumps a refcount.</p>
`,
    quiz: [
      { q: "What does <code>impl&lt;T: Send + Sync + 'static&gt; Data for T {}</code> do?", a: ["Declares Data as a struct", "Implements Data for every type satisfying those bounds", "Makes every type Send", "Nothing until you call it"], c: 1, why: "It's a blanket impl: any type meeting the bounds is Data automatically." },
      { q: "Why does Dynamo store engines as <code>Arc&lt;dyn AsyncEngine&lt;…&gt;&gt;</code> rather than a generic type parameter?", a: ["dyn is faster", "The concrete engine type is only known at runtime (which model/backend was loaded), and it must be shared across tasks", "Generics don't support async", "To avoid Send bounds"], c: 1, why: "Trait objects allow runtime choice of implementation; Arc allows cheap sharing across concurrent requests." },
      { q: "In <code>Operator&lt;UpIn, UpOut, DownIn, DownOut&gt;</code>, what is <code>DownIn</code>?", a: ["What the operator receives from upstream", "What it sends to the next engine downstream", "What it returns upstream", "The error type"], c: 1, why: "Down* types are the request/response for the next stage; Up* for the previous one." },
    ],
  });

  GS.lesson({
    id: "rust-arc", ch: "c4", title: "Arc, Send, Sync and locks", mins: 10,
    summary: "Dynamo is a big concurrent program. Shared state goes in an Arc, mutable shared state goes behind a lock, and Send/Sync are how the compiler checks you did it right.",
    goals: ["Explain what Arc::clone costs", "Pick between std, tokio and parking_lot mutexes", "Recognise the cheap-clone handle pattern"],
    body: () => `
<h2>Arc: shared ownership</h2>
<p>When many tasks need the same thing (a config, a client, a registry) nobody can be the single owner. ${t("arc", "Arc&lt;T&gt;")} (atomic reference count) solves it: each clone is another owner; the value is freed when the last one drops. Cloning an <code>Arc</code> copies one pointer and atomically increments a counter. It never copies <code>T</code>.</p>

<h2>The cheap-clone handle pattern</h2>
<p>Look at how the component registry is shaped:</p>
${code("rust", `#[derive(Default)]
pub struct RegistryInner {
    pub(crate) services: HashMap<String, Service>,
}

#[derive(Clone)] //<<
pub struct Registry {
    pub(crate) inner: Arc<tokio::sync::Mutex<RegistryInner>>, //<<
}`, "lib/runtime/src/component.rs")}
<p>The real data is in <code>RegistryInner</code>. The public <code>Registry</code> is just an <code>Arc</code> around a lock around it, and derives <code>Clone</code>. So you can hand a <code>Registry</code> to any number of tasks: each clone is a handle to the same shared state. <code>DistributedRuntime</code> follows the same idea with dozens of <code>Arc</code> fields:</p>
${code("rust", `pub struct DistributedRuntime {
    runtime: Runtime,
    network_manager: Arc<NetworkManager>,
    discovery_client: Arc<dyn discovery::Discovery>, //<<
    component_registry: component::Registry,
    system_health: Arc<parking_lot::Mutex<SystemHealth>>, //<<
    // ...
}`, "lib/runtime/src/distributed.rs")}

<h2>Three kinds of mutex</h2>
<div class="col3" style="max-width:var(--measure)">
  <div class="callout"><b>std::sync::Mutex</b>Blocking lock. Fine for tiny critical sections, but its guard isn't Send, so never hold it across <code>.await</code>.</div>
  <div class="callout"><b>tokio::sync::Mutex</b>Async lock: <code>.lock().await</code>. Safe to hold across awaits. Slower; use when you must await while holding it.</div>
  <div class="callout"><b>parking_lot::Mutex</b>A faster blocking lock without poisoning (no <code>.unwrap()</code>). Common in Dynamo for short, hot sections.</div>
</div>
<p>You'll also see <code>DashMap</code> (a concurrent hash map with sharded locks) and <code>OnceCell</code>/<code>OnceLock</code> (initialise once, read many times).</p>

<h2>Send and Sync, the compiler's checklist</h2>
<p>${t("sendsync", "Send")} means a value can move to another thread. Sync means <code>&amp;T</code> can be shared between threads. Tokio's multi-threaded runtime may move a task between threads at any <code>.await</code>, so everything a spawned future holds across an await must be Send. When you see an error like <em>"future cannot be sent between threads safely"</em>, look for an <code>Rc</code>, a <code>RefCell</code> or a std mutex guard living across an <code>.await</code>.</p>
<p class="margin-note">Fun fact: the indexer README notes the single-threaded RadixTree uses <code>Rc&lt;RefCell&lt;…&gt;&gt;</code> nodes, which is exactly why it runs on its own dedicated thread.</p>
`,
    quiz: [
      { q: "What does <code>Arc::clone(&a)</code> copy?", a: ["The whole value inside", "A pointer, plus an atomic increment of the refcount", "Nothing; it's a move", "A deep copy of nested Arcs"], c: 1, why: "Arc clones are cheap handles to the same allocation." },
      { q: "You need to hold a lock while awaiting a network call. Which do you use?", a: ["std::sync::Mutex", "parking_lot::Mutex", "tokio::sync::Mutex", "RefCell"], c: 2, why: "Only the async mutex's guard is designed to be held across .await in a Send future." },
    ],
  });

  GS.lesson({
    id: "rust-async", ch: "c4", title: "async, futures and token streams", mins: 14, labs: 1,
    summary: "Every response in Dynamo is a stream of tokens produced asynchronously. Learn how .await shares threads, what a Stream is, and why you keep seeing Pin<Box<dyn …>>.",
    goals: ["Explain what .await does on a Tokio thread", "Read DataStream and ResponseStream", "Read a stream::unfold state machine", "Know what a CancellationToken is for"],
    body: () => `
<h2>Futures are lazy</h2>
<p>An <code>async fn</code> returns a ${t("future")}: a value describing work that hasn't happened yet. Nothing runs until something <em>polls</em> it, which is what <code>.await</code> does. When the future can't make progress (waiting for bytes from a socket), it returns <code>Pending</code> and the thread is free to run other tasks. ${t("tokio", "Tokio")} is the executor that does the polling and wakes tasks when their I/O is ready.</p>

<div data-widget="asyncsim"></div>
<p>The lesson of the red bar: <mark>never block inside async code</mark>. A heavy computation or a blocking call on a Tokio thread stalls every other task scheduled on it. Use <code>tokio::task::spawn_blocking</code> or a dedicated thread instead. (That's why Dynamo's KV indexer runs its event processing on its own threads.)</p>

<h2>Streams: async iterators</h2>
<p>A ${t("stream")} yields many items over time. Generated tokens are the obvious example. Here's Dynamo's stream vocabulary:</p>
${code("rust", `pub type DataStream<T> = Pin<Box<dyn Stream<Item = T> + Send>>; //<<

pub struct ResponseStream<R: Data> {
    stream: DataStream<R>,
    ctx: Arc<dyn AsyncEngineContext>,   // id + stop/kill controls for this request //<<
}

impl<R: Data> Stream for ResponseStream<R> {
    type Item = R;

    fn poll_next(
        mut self: Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Self::Item>> {
        Pin::new(&mut self.stream).poll_next(cx)   // just delegate
    }
}`, "lib/runtime/src/engine.rs")}
<p>Read <code>Pin&lt;Box&lt;dyn Stream&lt;Item = T&gt; + Send&gt;&gt;</code> inside out: some stream type (decided at runtime) of <code>T</code> items, that can move between threads, on the heap, ${t("pin", "pinned")} so it won't move in memory (async state machines may hold pointers into themselves). You'll type this so often it'll stop looking scary.</p>
<p>A <code>ResponseStream</code> pairs a stream with its <strong>context</strong>: the request ID and controls like <code>stop_generating()</code> and <code>kill()</code>. When a client disconnects, the context is what tells the worker to stop burning GPU time.</p>

<h2>stream::unfold: a state machine that yields</h2>
<p>The <code>Backend</code> operator turns token IDs into text as they arrive. It's written with <code>stream::unfold</code>: start with some state, and on each poll produce <code>(item, new_state)</code> or <code>None</code> to finish.</p>
${code("rust", `let next_stream = next.generate(request).await?;
let context = next_stream.context();
let state = self.decoder(next_stream, decoder_params)?;

let processed_stream = stream::unfold(state, |mut state| async move { //<<
    // If we've already detected a local stop condition, end the stream
    if state.finished {
        return None;
    }
    // ...pull the next engine output, detokenize, check stop strings...
    let output = state.stream.next().await;
    // ...
});`, "lib/llm/src/backend.rs")}
<p><code>async move</code> moves the state into the closure's future; each iteration hands the updated state back. It's a tidy way to build a stream without hand-writing <code>poll_next</code>.</p>

<h2>Cancellation</h2>
<p>Dynamo re-exports tokio-util's ${t("cancellation-token", "CancellationToken")} from the runtime root. Background tasks hold a clone and <code>select!</code> on <code>token.cancelled()</code> alongside their real work; cancelling the parent stops them all cleanly on shutdown.</p>
${code("rust", `pub use tokio_util::sync::CancellationToken;`, "lib/runtime/src/lib.rs")}
`,
    quiz: [
      { q: "What happens on a Tokio worker thread when a task hits <code>.await</code> on a socket read that isn't ready?", a: ["The thread sleeps until data arrives", "The task returns Pending and the thread runs other ready tasks", "The program panics", "A new thread is spawned"], c: 1, why: "That's the whole point of async: waiting tasks give the thread back." },
      { q: "Why is a response type paired with an <code>AsyncEngineContext</code>?", a: ["For serialization", "So the request can be identified and stopped or killed (e.g. on client disconnect)", "To store the tokenizer", "It's required by serde"], c: 1, why: "The context carries the ID and stop/kill controls that propagate cancellation." },
      { q: "In <code>Pin&lt;Box&lt;dyn Stream&lt;Item = T&gt; + Send&gt;&gt;</code>, why Box?", a: ["To make it Send", "Because a dyn Stream has no compile-time size, so it must live behind a pointer", "For reference counting", "To make it Copy"], c: 1, why: "Trait objects are unsized; Box puts them on the heap behind a fixed-size pointer." },
    ],
  });

  GS.lesson({
    id: "rust-errors", ch: "c4", title: "Errors: Result, ?, and anyhow", mins: 9,
    summary: "No exceptions in Rust: fallible functions return Result, and ? propagates errors upward. Dynamo uses anyhow for application errors, with a couple of renamed re-exports to recognise.",
    goals: ["Read ? chains", "Recognise Dynamo's error re-exports", "Write errors reviewers will accept"],
    body: () => `
<p>A function that can fail returns <code>Result&lt;T, E&gt;</code>. The <code>?</code> operator says: if this is <code>Err</code>, return it from the current function right now; otherwise unwrap the <code>Ok</code> value. Remember this pipeline-building code? Every <code>?</code> is an early return if linking fails:</p>
${code("rust", `Ok(frontend
    .link(preprocessor.forward_edge())? //<<
    .link(backend.forward_edge())?
    .link(engine)?
    .link(backend.backward_edge())?
    .link(preprocessor.backward_edge())?
    .link_terminal(frontend)?)`, "lib/llm/src/entrypoint/input/common.rs")}

<h2>anyhow, and two surprise names</h2>
<p>Libraries often define precise error enums. Applications usually just want "an error with a good message." ${t("anyhow")} gives you <code>anyhow::Result&lt;T&gt;</code>, which can hold any error, plus <code>.context("…")</code> to add explanations as errors bubble up. The runtime crate re-exports it, with two renames worth knowing:</p>
${code("rust", `pub use anyhow::{
    Context as ErrorContext, Error, Ok as OK, Result, anyhow as error, bail as raise, //<<
};`, "lib/runtime/src/lib.rs")}
<p>So inside Dynamo crates, <code>error!("…")</code> may be anyhow's macro for creating an error and <code>raise!("…")</code> its macro for returning one early. Context matters when you read unfamiliar files: check the <code>use</code> lines.</p>

<h2>A typical parse with a helpful error</h2>
${code("rust", `impl std::str::FromStr for RequestPlaneMode {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> std::result::Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "nats" => Ok(Self::Nats),
            "tcp" => Ok(Self::Tcp),
            _ => Err(anyhow::anyhow!(
                "Invalid request plane mode: '{}'. Valid options are: 'nats', 'tcp'", //<<
                s
            )),
        }
    }
}`, "lib/runtime/src/distributed.rs")}
<p>Good errors say what was wrong <em>and</em> what would be right. That's the house style; reviewers ask for it.</p>

<h2>Habits that pass review</h2>
<ul>
  <li>Avoid <code>.unwrap()</code> in production paths. Use <code>?</code>, or <code>.expect("why this can't fail")</code> when it truly can't.</li>
  <li>Add <code>.context(…)</code> where an error crosses a boundary (file, network, config).</li>
  <li>Log at the level that matches the event; don't log an error and also return it (it gets logged twice).</li>
  <li>The <code>graham-code-review</code> skill in this repo encodes a senior reviewer's standards for exactly these things. Run it on your own diffs.</li>
</ul>
`,
    quiz: [
      { q: "What does <code>x?</code> do when <code>x</code> is <code>Err(e)</code>?", a: ["Panics", "Returns Err(e) (converted) from the enclosing function", "Replaces it with a default", "Logs and continues"], c: 1, why: "? propagates the error early, converting it with From if needed." },
      { q: "In a Dynamo runtime file you see <code>raise!(\"no workers\")</code>. What is it most likely?", a: ["A Python call", "anyhow::bail! re-exported as raise: return an error early", "A panic", "A tracing macro"], c: 1, why: "lib/runtime/src/lib.rs re-exports anyhow's bail as raise." },
    ],
  });

  GS.lesson({
    id: "rust-types", ch: "c4", title: "Enums, derives and zero-sized types", mins: 9,
    summary: "The type system carries a lot of weight in Dynamo: enums for every mode, derive macros for serialization, and zero-sized marker types that cost nothing at runtime.",
    goals: ["Read enums with attributes and match on them", "Know what common derives do", "Explain zero-sized marker types"],
    body: () => `
<h2>Enums for modes</h2>
${code("rust", `#[derive(Default, Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RouterMode {
    #[default] //<<
    RoundRobin,
    Random,
    PowerOfTwoChoices,
    KV,
    Direct,
    LeastLoaded,
    /// Device-aware weighted routing for heterogeneous workers.
    DeviceAwareWeighted,
}`, "lib/runtime/src/pipeline/network/egress/push_router.rs")}
<p><code>#[default]</code> marks which variant <code>RouterMode::default()</code> returns. A <code>match</code> on this enum must handle every variant, so adding a new mode makes the compiler point at every place that needs updating. That's a feature: it's why Rust codebases can grow without losing track of cases.</p>

<h2>Enums with data, and serde</h2>
${code("rust", `#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum TransportType {
    #[serde(rename = "nats_tcp")] //<<
    Nats(String),
    Tcp(String),
}

impl TransportType {
    pub fn address(&self) -> &str {
        match self {
            TransportType::Nats(address) | TransportType::Tcp(address) => address, //<<
        }
    }
}`, "lib/runtime/src/component.rs")}
<p>Each variant carries an address string. The <code>match</code> binds it with an or-pattern. The ${t("serde")} attributes control the JSON/msgpack names, which matter because these values travel between processes (and between versions during rolling upgrades).</p>
<p>Common derives you'll see constantly: <code>Debug</code> (printable with <code>{:?}</code>), <code>Clone</code>, <code>PartialEq/Eq/Hash</code> (usable as map keys), <code>Serialize/Deserialize</code>, <code>Builder</code> (from derive_builder, generates a builder), <code>Getters</code>.</p>

<h2>Zero-sized types: types as labels</h2>
<p>The KV block manager names its four storage tiers with structs that have no fields at all:</p>
${code("rust", `/// GPU/device tier -- HBM KV cache. Fastest access, smallest capacity.
pub struct G1;
/// CPU/host tier -- pinned DRAM cache.
pub struct G2;
/// Disk tier -- NVMe/SSD cache. Millisecond-latency persistent storage
pub struct G3;
/// Object store tier -- S3/MinIO. Highest latency but unlimited capacity
pub struct G4;`, "lib/kvbm-engine/src/lib.rs")}
<p>A ${t("zst", "zero-sized type")} takes no memory and does nothing at runtime. Its value is to the compiler: a function generic over <code>T</code> can be specialised per tier, and <code>Block&lt;G1&gt;</code> and <code>Block&lt;G3&gt;</code> become different types that can't be mixed up by accident. You'll meet these tiers properly in lesson 6.3.</p>
`,
    quiz: [
      { q: "You add a variant to <code>RouterMode</code>. What does the compiler do?", a: ["Nothing", "Flags every exhaustive match that doesn't handle the new variant", "Removes the default", "Changes serialization"], c: 1, why: "Exhaustive matching makes the compiler list every place that must handle the new case." },
      { q: "How much memory does a value of <code>struct G1;</code> take?", a: ["8 bytes", "1 byte", "0 bytes", "Depends on the platform"], c: 2, why: "It's a zero-sized type: a compile-time label only." },
    ],
  });
})();
