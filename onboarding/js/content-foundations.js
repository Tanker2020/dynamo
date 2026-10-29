/* Chapters 0–3: orientation, LLMs from zero, GPUs from zero, the serving problem. */
(function () {
  const { t, code, src } = GS;

  /* ================= Chapter 0 ================= */
  GS.chapter({ id: "c0", num: "00", title: "Orientation", blurb: "What Dynamo is, what it is not, and how this course gets you from zero to reading its source." });

  GS.lesson({
    id: "welcome", ch: "c0", title: "Welcome to the hangar", mins: 8, labs: 1,
    summary: "Dynamo turns a room full of GPUs into one inference service. Before any math or Rust, here's the shape of the thing you're about to learn.",
    goals: ["Say in one sentence what Dynamo does", "Name the layers of the stack and where each lives in the repo", "Know how this course is organised"],
    body: () => `
<p>When you type a question into a chatbot, a ${t("gpu", "GPU")} somewhere runs a model that produces the answer one ${t("token")} at a time. That's easy with one user and one GPU. It gets hard fast with ten thousand users, a few hundred GPUs, prompts that range from ten words to a whole codebase, and a latency budget measured in milliseconds.</p>
<p><mark>Dynamo is the orchestration layer that makes many GPUs behave like one inference system.</mark> It decides which GPU should handle each request, moves cached work between GPUs, spills cache to cheaper memory, and adds or removes workers as traffic changes.</p>

<div class="callout analogy"><b>Analogy you'll reuse all course</b>
Think of a large restaurant. The <strong>${t("engine", "inference engines")}</strong> (vLLM, SGLang, TensorRT-LLM) are the chefs: they actually cook. The GPUs are the stoves. <strong>Dynamo</strong> is the front of house and the expediter: it seats guests, sends each order to the cook who already has the right ingredients prepped, splits prep work from plating, keeps leftovers in the walk-in fridge instead of throwing them out, and calls in extra cooks before the dinner rush.</div>

<h2>What Dynamo is not</h2>
<ul>
  <li><strong>Not a model.</strong> It ships no weights. You point it at a model like <code>Qwen/Qwen3-0.6B</code> on Hugging Face.</li>
  <li><strong>Not an inference engine.</strong> It doesn't implement attention kernels. It runs on top of engines and coordinates them.</li>
  <li><strong>Not Kubernetes-only.</strong> You can run every piece on a laptop, and with the ${t("mocker")} you don't even need a GPU. You'll do exactly that in chapter 7.</li>
</ul>

<div data-widget="stack"></div>

<h2>How the repo is laid out</h2>
<p>The code is deliberately layered. The hot paths (networking, tokenizing, routing, cache bookkeeping) are Rust. The pieces you launch and configure are Python. Production deployment is Go and YAML. A change that crosses layers is a big change.</p>
${code("text", `dynamo/
├── lib/                    Rust workspace (20+ crates)
│   ├── runtime/            distributed runtime: discovery, transports, pipelines
│   ├── llm/                HTTP server, preprocessor, KV router glue, migration
│   ├── kv-router/          routing policy, indexer (radix trees), scheduling
│   ├── kvbm-*/             KV block manager: GPU → CPU → disk → object store
│   ├── tokens/, kv-hashing/  block hashing
│   ├── mocker/             simulated engine for GPU-free testing
│   └── bindings/python/    PyO3 crate → dynamo._core
├── components/src/dynamo/  Python: frontend, vllm, sglang, trtllm, planner, mocker…
├── deploy/                 Kubernetes operator (Go), Helm, gateway
├── tests/                  top-level pytest suite (+ conftest.py at repo root)
└── docs/fern/              the docs site`, null, { label: "repo map" })}

<h2>How this course works</h2>
<p>There are eight chapters. Chapters 1 to 3 teach the inference ideas Dynamo exists to manage, with no code required. Chapter 4 refreshes the Rust you need, using real Dynamo code as examples. Chapters 5 and 6 tour the architecture and dig into the router, indexer, KV block manager and planner. Chapter 7 gets your hands on a terminal.</p>
<p>Every lesson has at least one <span class="pill" style="background:var(--hl);color:var(--hl-ink);border-color:transparent">LAB</span> to play with and a short check at the end. Dotted-underlined words like ${t("kv-cache", "KV cache")} are in the glossary: hover for a definition, click to open the full entry, or press <kbd>g</kbd> anytime.</p>
<p class="margin-note">Don't skip the labs. Each one encodes an idea you'll later see as a line of Rust.</p>
`,
    quiz: [
      { q: "Which statement best describes Dynamo?", a: ["A faster attention kernel for NVIDIA GPUs", "An orchestration layer that coordinates inference engines across many GPUs", "A large language model trained by NVIDIA", "A Kubernetes distribution for AI"], c: 1, why: "Dynamo sits above engines like vLLM, SGLang and TensorRT-LLM. It routes, moves cache, and scales; the engines do the math." },
      { q: "Where would you look for the code that decides which worker gets a request?", a: ["deploy/operator", "components/src/dynamo/vllm", "lib/kv-router and lib/llm/src/kv_router", "docs/fern"], c: 2, why: "The routing policy, indexer and scheduler live in the kv-router crate; the glue that plugs it into the request pipeline is in lib/llm/src/kv_router." },
    ],
  });

  /* ================= Chapter 1 ================= */
  GS.chapter({ id: "c1", num: "01", title: "LLMs from zero", blurb: "Tokens, next-token prediction, prefill vs decode, and the KV cache. The four ideas the whole stack is built around." });

  GS.lesson({
    id: "tokens", ch: "c1", title: "Text becomes numbers", mins: 9, labs: 1,
    summary: "Models never see letters. They see integer token IDs. The very first thing Dynamo does with your request is turn text into those integers.",
    goals: ["Explain what a token is and why it isn't a word", "Describe what a tokenizer and a chat template do", "Find where Dynamo tokenizes"],
    body: () => `
<p>A language model is a function over numbers. Before a prompt can go in, it has to be converted into a list of integers. The converter is a ${t("tokenizer")}, and each integer is a ${t("token")} ID.</p>
<p>Tokens are not words. Common words get one token each. Rare words are split into pieces. Spaces are usually glued onto the front of the next piece, which is why you'll see tokens like <code>" the"</code> with a leading space. Real tokenizers learn about 100,000 to 200,000 pieces from data. Qwen3's vocabulary has roughly 151,000.</p>

<div data-widget="tokenizer"></div>

<h2>Rules of thumb worth memorising</h2>
<ul>
  <li>English text averages about <strong>4 characters or ¾ of a word per token</strong>.</li>
  <li>Code, numbers and non-English text usually use more tokens per character.</li>
  <li>Everything downstream is measured in tokens: prompt length, output length, context window, cost, KV cache size.</li>
</ul>

<h2>Chat templates</h2>
<p>A chat request arrives as a list of messages with roles. The model was trained on one long string with special marker tokens between turns. A ${t("chat-template")} (a Jinja template that ships with the model) converts one into the other. For Qwen it looks roughly like this:</p>
${code("text", `<|im_start|>system
You are a helpful assistant.<|im_end|>
<|im_start|>user
What is a KV cache?<|im_end|>
<|im_start|>assistant
`, null, { label: "rendered prompt (Qwen-style)" })}
<p>That trailing <code>assistant</code> line is the cue: the model's job is now to continue the text.</p>

<h2>Where this happens in Dynamo</h2>
<p>In Dynamo, the ${t("frontend")} does both steps in Rust before a request ever leaves the frontend process. The struct that owns them is <code>OpenAIPreprocessor</code>:</p>
${code("rust", `pub struct OpenAIPreprocessor {
    mdcsum: String,
    formatter: Arc<dyn OAIPromptFormatter>,   // renders the chat template //<<
    tokenizer: Arc<dyn Tokenizer>,            // text → token IDs //<<
    model_info: Arc<dyn ModelInfo>,
    lora_name: Option<String>,
    /// KV cache block size published in the model deployment card.
    kv_cache_block_size: usize,
    tool_call_parser: Option<String>,
    // ...
}`, "lib/llm/src/preprocessor.rs")}
<p>Two things to notice even if your Rust is rusty. The template engine and the tokenizer are both stored as <code>Arc&lt;dyn Trait&gt;</code>, which means "a shared pointer to some type implementing this trait." That lets one preprocessor work with any model's tokenizer. And it knows the KV cache <em>block size</em>: tokens will soon be grouped into blocks for caching, which is lesson 1.4 and most of chapter 6.</p>
<p class="margin-note">Why tokenize in the frontend? Because the router needs the token IDs to work out which GPU already has them cached.</p>
`,
    quiz: [
      { q: "Roughly how many tokens is a 2,000-character English paragraph?", a: ["About 50", "About 500", "About 2,000", "About 8,000"], c: 1, why: "At about 4 characters per token, 2,000 characters ≈ 500 tokens." },
      { q: "Why does Dynamo tokenize in the frontend instead of leaving it to the GPU worker?", a: ["GPUs can't run tokenizers", "The router needs token IDs to compute cache overlap before choosing a worker", "It's required by the OpenAI API", "To save network bandwidth"], c: 1, why: "KV-aware routing hashes the token IDs into blocks and checks which worker caches them. That has to happen before a worker is picked." },
    ],
  });

  GS.lesson({
    id: "next-token", ch: "c1", title: "A model is a next-token guesser", mins: 9, labs: 1,
    summary: "Given some tokens, a model outputs a score for every token in its vocabulary. Turn scores into probabilities, pick one, repeat. That's all generation is.",
    goals: ["Explain logits, softmax and temperature", "Explain what model weights are and why their size matters", "Recognise the softmax-with-temperature idea when it reappears in the router"],
    body: () => `
<p>Inside the model are billions of numbers called ${t("weights")}. A ${t("forward-pass")} pushes your token IDs through dozens of layers of matrix multiplication using those weights. Out the other end comes one score per vocabulary entry: the ${t("logits")}.</p>
<p>Scores aren't probabilities. ${t("softmax")} converts them: raise <em>e</em> to each score, then divide by the total. Before that, divide every score by a ${t("temperature")}. Low temperature makes the top choice dominate. High temperature flattens everything.</p>

<div data-widget="nexttoken"></div>

<h2>Weights are the expensive part</h2>
<p>An 8-billion-parameter model has 8 billion weights. Stored in BF16 (2 bytes each) that's about <strong>16 GB</strong> that must sit in GPU memory and be read for every forward pass. Keep that number in mind; chapter 2 is mostly about its consequences.</p>

<h2>You'll meet softmax again</h2>
<p>Dynamo's router has a setting called <code>router_temperature</code>. With temperature 0 it always picks the cheapest worker. Above 0 it turns worker costs into probabilities with exactly this softmax trick, which spreads load a little. Here's the real normalisation, from the router's reference selector:</p>
${code("rust", `let range = max_cost - min_cost;
// ...
let scale = -1.0 / ((max_cost / magnitude - min_normalized) * temperature); //<<
let max_scaled = min_normalized * scale;
probabilities.extend(
    entries
        .iter()
        .map(|entry| (cost(entry) / magnitude * scale - max_scaled).exp()), //<<
);
// ...then divide each by the sum`, "lib/kv-router/src/scheduling/selector/reference.rs")}
<p>Costs are negated (lower cost → higher probability) and scaled by the cost range, so the temperature means the same thing whether costs are in the tens or the thousands.</p>
`,
    quiz: [
      { q: "You set temperature very close to 0. What happens?", a: ["Output becomes random", "The model almost always picks the highest-scoring token", "The model stops generating", "Logits become probabilities without softmax"], c: 1, why: "Dividing logits by a tiny temperature makes the largest one dominate after exponentiation: effectively greedy decoding." },
      { q: "Approximately how much memory do the weights of an 8B model take in BF16?", a: ["8 GB", "16 GB", "32 GB", "64 GB"], c: 1, why: "8 billion parameters × 2 bytes ≈ 16 GB." },
    ],
  });

  GS.lesson({
    id: "generation", ch: "c1", title: "Prefill, decode and the two clocks", mins: 10, labs: 1,
    summary: "Generation has two very different phases. Every latency number people care about, and half of Dynamo's design, comes from that split.",
    goals: ["Explain prefill and decode and why they differ", "Define TTFT and ITL", "Predict which phase a change will affect"],
    body: () => `
<p>Models are ${t("autoregressive")}: each new token is appended to the input and the model runs again to get the next one. But the first step is special.</p>
<ul>
  <li><strong>${t("prefill", "Prefill")}</strong> processes the entire prompt at once. All 2,000 prompt tokens go through the model in one big parallel pass. It's a lot of math, done efficiently.</li>
  <li><strong>${t("decode", "Decode")}</strong> then produces output tokens one per step. Each step handles a single new token per request, but still has to read every weight in the model.</li>
</ul>
<p>Two latency numbers fall straight out of this:</p>
<div class="stat-row" style="max-width:var(--measure)">
  <div class="stat"><div class="k">TTFT</div><div class="v" style="font-size:18px">time to first token</div><p style="margin:6px 0 0;font-size:14px">Queue wait + prefill. What users feel as “is it thinking?”</p></div>
  <div class="stat"><div class="k">ITL</div><div class="v" style="font-size:18px">inter-token latency</div><p style="margin:6px 0 0;font-size:14px">Gap between streamed tokens. What users feel as reading speed.</p></div>
</div>

<div data-widget="generate"></div>

<h2>Why the split matters for systems</h2>
<p>Prefill is ${t("compute-bound", "compute-bound")}: lots of math per byte of weights read. Decode is memory-bound: very little math per step, but the whole model has to stream from memory every time. They want different hardware settings, different batch sizes, sometimes different GPUs. Dynamo's headline feature, ${t("disagg", "disaggregated serving")}, runs them on separate GPU pools. That's lesson 3.3.</p>
<p>Service-level targets (${t("sla", "SLAs")}) are usually written in these terms: "p95 TTFT under 500 ms, ITL under 30 ms." Dynamo's ${t("planner")} can scale workers to hit exactly those targets.</p>
<p class="margin-note">Long prompt? Hurts TTFT. Many concurrent users? Hurts ITL. Keep that pair in your head.</p>
`,
    quiz: [
      { q: "A user pastes a 50-page document into the prompt. Which metric suffers most?", a: ["ITL", "TTFT", "Neither", "Only total throughput"], c: 1, why: "A huge prompt means a long prefill, which happens before the first token: TTFT goes up." },
      { q: "Which phase reads all the model weights once per generated token?", a: ["Prefill", "Decode", "Tokenization", "Detokenization"], c: 1, why: "Every decode step is a forward pass for one new token per request, so every step re-reads the weights." },
    ],
  });

  GS.lesson({
    id: "kv-cache", ch: "c1", title: "The KV cache: the thing Dynamo manages", mins: 12, labs: 1,
    summary: "Attention needs keys and values for every earlier token. Recomputing them each step is quadratic waste, so engines cache them in GPU memory. That cache is Dynamo's most precious resource.",
    goals: ["Explain attention in one paragraph without equations", "Explain why caching keys and values turns quadratic work into linear", "Explain why the KV cache, not the model, is what limits concurrency"],
    body: () => `
<h2>Attention in one paragraph</h2>
<p>At every layer, each token computes three vectors: a ${t("qkv", "query, a key and a value")}. To decide what it means in context, a token compares its query against the keys of every earlier token, turns the match scores into weights (softmax again), and takes a weighted sum of their values. "It" in "the cat sat because it was warm" learns to look at "cat". That's ${t("attention")}.</p>
<p>The important part for systems: <strong>a new token needs the keys and values of every token before it, at every layer.</strong></p>

<h2>Cache them</h2>
<p>A token's key and value never change once computed. So engines store them. The store is the ${t("kv-cache", "KV cache")}, and with it each decode step only computes K and V for the one new token.</p>

<div data-widget="kvcache"></div>

<h2>The catch: it's big</h2>
<p>The cache stores, for every token, a key and a value at every layer for every KV head. For Llama-3.1-8B:</p>
${code("text", `bytes per token = 2 (K and V) × 32 layers × 8 KV heads × 128 dims × 2 bytes (BF16)
                = 131,072 bytes = 128 KiB per token

one 8k-token conversation  ≈ 1 GiB of KV cache
100 such conversations      ≈ 100 GiB  (more than an entire 80 GB H100)`, null, { label: "the arithmetic" })}
<p><mark>On a busy server the KV cache, not the weights, decides how many users fit.</mark> Everything Dynamo does with KV (route requests to where their cache already is, move it between GPUs, spill it to CPU and disk) is about squeezing more value out of this one resource.</p>

<h2>Blocks</h2>
<p>Engines don't manage KV token by token. They group tokens into fixed-size ${t("kv-block", "blocks")} (Dynamo's default is 16 tokens per block) and allocate, share, evict and transfer whole blocks. You'll see <code>kv_cache_block_size</code> all over the codebase:</p>
${code("rust", `const DEFAULT_KV_CACHE_BLOCK_SIZE: u32 = 16;`, "lib/llm/src/local_model.rs")}
`,
    quiz: [
      { q: "Without a KV cache, generating token number n requires recomputing keys and values for how many tokens?", a: ["1", "n", "n²", "None"], c: 1, why: "All n tokens so far. Summed over the whole generation that's about n²/2: quadratic. With the cache it's 1 per step." },
      { q: "On a busy inference server, what usually limits how many concurrent requests fit on a GPU?", a: ["The tokenizer", "The size of the model weights alone", "The KV cache for all active requests", "The HTTP server"], c: 2, why: "Weights are a fixed cost. KV cache grows with every token of every active request and fills the remaining memory." },
      { q: "What's Dynamo's default KV block size?", a: ["1 token", "16 tokens", "256 tokens", "One block per request"], c: 1, why: "DEFAULT_KV_CACHE_BLOCK_SIZE is 16 in lib/llm/src/local_model.rs. Engines may publish their own." },
    ],
  });

  /* ================= Chapter 2 ================= */
  GS.chapter({ id: "c2", num: "02", title: "GPUs from zero", blurb: "Why GPUs, why memory bandwidth rules decode, how batching rescues throughput, and how GPUs talk to each other." });

  GS.lesson({
    id: "gpu-basics", ch: "c2", title: "What a GPU actually is", mins: 8, labs: 1,
    summary: "A CPU is a few brilliant generalists. A GPU is thousands of simple workers doing the same thing to different data. Model math is the second kind of job.",
    goals: ["Explain when a GPU beats a CPU and when it doesn't", "Explain why matrix multiplication suits GPUs", "Know the hardware vocabulary you'll see in docs"],
    body: () => `
<p>A modern CPU has maybe 8 to 128 cores, each very fast and very clever (branch prediction, big caches, out-of-order execution). A ${t("gpu")} has thousands of much simpler cores grouped into units that execute the same instruction on different data at the same time.</p>
<p>That trade only pays off when the work is <strong>wide</strong>: lots of independent calculations. Matrix multiplication is the ultimate wide job. Every output cell is its own dot product, independent of every other cell.</p>

<div data-widget="cpugpu"></div>

<h2>Where the work lives</h2>
<p>A forward pass is mostly matrix multiplications: token vectors times weight matrices, layer after layer. A rough rule: <strong>a forward pass costs about 2 × parameters FLOPs per token</strong>. An 8B model needs about 16 GFLOPs per token. An H100 does on the order of 1,000 TFLOPS of dense BF16 math, so in pure compute terms that's tiny. The problem, as the next lesson shows, is getting the weights to the math units fast enough.</p>

<h2>Vocabulary you'll see in Dynamo docs</h2>
<ul>
  <li><strong>H100, H200, B200, GB200</strong>: NVIDIA datacenter GPU generations. More memory and bandwidth each generation.</li>
  <li><strong>${t("hbm", "HBM")}</strong>: the GPU's on-package memory (VRAM). Fast but limited: 80 to 192 GB per GPU.</li>
  <li><strong>CUDA</strong>: NVIDIA's programming platform. Dynamo itself writes little CUDA (some lives in <code>lib/kvbm-kernels</code>); the engines write a lot.</li>
  <li><strong>FP8, FP4</strong>: ${t("quantization", "lower-precision number formats")} that halve or quarter weight size.</li>
</ul>
<p class="margin-note">You will not write GPU kernels to contribute to Dynamo. You do need to know what makes GPU time expensive.</p>
`,
    quiz: [
      { q: "Which task benefits most from a GPU?", a: ["Parsing one JSON request", "Multiplying two 8,192 × 8,192 matrices", "A loop where each step depends on the previous result", "Reading a config file"], c: 1, why: "Matrix multiplication has millions of independent dot products, exactly what thousands of parallel cores are for." },
    ],
  });

  GS.lesson({
    id: "gpu-memory", ch: "c2", title: "Memory: the real bottleneck", mins: 11, labs: 1,
    summary: "Decode speed is set by how fast the GPU can stream weights and KV cache from memory, not by how fast it can do math. Capacity sets how many users fit.",
    goals: ["Estimate weight and KV memory for a model", "Estimate a decode speed ceiling from memory bandwidth", "Explain why tensor parallelism exists"],
    body: () => `
<p>Two numbers describe GPU memory: <strong>capacity</strong> (how many GB) and ${t("bandwidth", "bandwidth")} (how many GB per second you can read). An H100 SXM has 80 GB at about 3.35 TB/s.</p>
<p>Each decode step reads every weight once. For an 8B model in BF16 that's 16 GB per step. So even with infinitely fast math:</p>
${code("text", `max decode steps per second ≈ bandwidth ÷ bytes read per step
                            ≈ 3,350 GB/s ÷ 16 GB
                            ≈ 210 steps/s  →  about 4.8 ms per token, for ONE request`, null, { label: "the ceiling" })}
<p>That's why decode is called <strong>memory-bound</strong>. The math units sit mostly idle, waiting on memory. Play with it:</p>

<div data-widget="vram"></div>

<h2>What you should take away</h2>
<ul>
  <li>Bigger model → more bytes per step → slower tokens and fewer free GB for KV.</li>
  <li>Longer contexts and more users → more KV cache → you run out of memory long before you run out of compute.</li>
  <li>Lower precision (FP8, FP4) helps on both fronts, which is why recipes use quantized models so often.</li>
  <li>When a model doesn't fit on one GPU, ${t("tensor-parallel", "tensor parallelism")} splits each layer across several GPUs, pooling their memory and bandwidth.</li>
</ul>
<p class="margin-note">Try Llama-3.1-70B on one H100. Then give it four.</p>
`,
    quiz: [
      { q: "Doubling a GPU's memory bandwidth (same compute) mostly speeds up which phase?", a: ["Prefill", "Decode", "Tokenization", "Neither"], c: 1, why: "Decode is limited by streaming weights and KV from memory, so more bandwidth helps it directly." },
      { q: "A model's weights take 140 GB in BF16. What's the smallest number of 80 GB GPUs that could hold just the weights?", a: ["1", "2", "4", "8"], c: 1, why: "140 GB doesn't fit in 80 but fits in 2 × 80 = 160 GB (barely, with little room left for KV cache, so in practice you'd use more or quantize)." },
    ],
  });

  GS.lesson({
    id: "batching", ch: "c2", title: "Batching: sharing one weight read", mins: 10, labs: 1,
    summary: "If every decode step reads all the weights anyway, run many users through the same step. Throughput soars. Per-user latency creeps up. Memory sets the ceiling.",
    goals: ["Explain continuous batching", "Explain the throughput vs latency trade-off", "Explain why KV memory caps batch size"],
    body: () => `
<p>Reading 16 GB of weights to produce one token for one user is wasteful. Read them once and produce one token for each of 64 users, and you've done 64× the useful work for barely more time. That's batching.</p>
<p>Engines use ${t("batching", "continuous batching")}: the batch isn't fixed. Requests join as soon as there's room and leave the moment they finish, between any two steps.</p>

<div data-widget="batching"></div>

<h2>Read the chart</h2>
<ul>
  <li>At small batch sizes, step time barely moves: the weight read dominates. Total throughput grows almost linearly. Free money.</li>
  <li>As the batch grows, each request's KV cache adds to the bytes read per step, so ITL rises.</li>
  <li>Eventually you hit either the ITL target or the KV memory wall. That point is your real capacity.</li>
</ul>
<p>This is the core tension of LLM serving: <mark>throughput wants big batches, latency wants small ones</mark>. Dynamo's job is to keep every GPU near the sweet spot: route requests so batches stay full but not overloaded, and scale the fleet before targets are missed.</p>
`,
    quiz: [
      { q: "Going from batch 1 to batch 8 on a memory-bound decode step mostly…", a: ["Multiplies step time by 8", "Barely changes step time but multiplies throughput by nearly 8", "Halves throughput", "Has no effect on throughput"], c: 1, why: "The weight read dominates step time and is shared by the whole batch." },
      { q: "What stops you growing the batch forever?", a: ["The tokenizer", "ITL targets and KV cache memory", "The HTTP server's thread count", "Nothing"], c: 1, why: "Each request adds KV bytes per step (raising ITL) and needs KV memory to exist at all." },
    ],
  });

  GS.lesson({
    id: "multi-gpu", ch: "c2", title: "When one GPU isn't enough", mins: 8,
    summary: "Big models and big traffic need many GPUs. There are a few ways to split the work, and a few fast wires to connect them. NIXL rides those wires for Dynamo.",
    goals: ["Tell TP, DP and EP apart", "Know what NVLink, InfiniBand and RDMA are for", "Know what NIXL does for Dynamo"],
    body: () => `
<h2>Ways to split the work</h2>
<div class="col2" style="max-width:var(--measure)">
  <div class="callout"><b>Tensor parallel (TP)</b>Split each layer's matrices across GPUs. They cooperate on every token, so they need very fast links. Used when a model is too big for one GPU.</div>
  <div class="callout"><b>Data parallel (DP)</b>Run several full copies of the model. Each serves different requests. This is where routing matters: <em>which copy</em> gets each request?</div>
  <div class="callout"><b>Expert parallel (EP)</b>For ${t("moe", "mixture-of-experts")} models (DeepSeek, Qwen3-MoE…): put different experts on different GPUs.</div>
  <div class="callout"><b>Pipeline parallel (PP)</b>Put different layers on different GPUs and pass activations along like an assembly line.</div>
</div>
<p>Engines implement TP, EP and PP inside one worker. Dynamo mostly works at the DP level: many workers, each possibly spanning several GPUs, and a router deciding between them.</p>

<h2>The wires</h2>
<ul>
  <li><strong>NVLink</strong>: very fast GPU-to-GPU links inside one server (and across a rack on NVL72 systems).</li>
  <li><strong>InfiniBand / RoCE</strong>: fast networks between servers.</li>
  <li><strong>RDMA</strong>: lets one machine read or write another machine's memory directly, without bothering its CPU.</li>
  <li><strong>PCIe</strong>: the slower general bus between GPU and CPU memory.</li>
</ul>
<p>${t("nixl", "NIXL")} (NVIDIA Inference Xfer Library) is a sibling repo of Dynamo that picks the best of these paths to move KV cache blocks between GPUs, CPU memory and storage. In Dynamo, it's what makes disaggregated serving and KV offloading fast enough to be worth doing. When you read <code>nixl</code> in the code, think "move KV bytes efficiently."</p>
${code("text", `GPU A (prefill) ──NVLink / RDMA via NIXL──▶ GPU B (decode)
      "here are the KV blocks for request 8f3c"`, null, { label: "what NIXL is for" })}
`,
    quiz: [
      { q: "Dynamo's router choosing between eight identical copies of a model is an example of…", a: ["Tensor parallelism", "Data parallelism", "Pipeline parallelism", "Quantization"], c: 1, why: "Full copies serving different requests = data parallel. The router picks the copy." },
      { q: "What does NIXL do for Dynamo?", a: ["Tokenizes text", "Moves KV cache bytes between GPUs, CPU memory and storage over fast interconnects", "Schedules Kubernetes pods", "Computes attention"], c: 1, why: "NIXL is the transfer library behind disaggregated serving and KV offloading." },
    ],
  });

  /* ================= Chapter 3 ================= */
  GS.chapter({ id: "c3", num: "03", title: "The serving problem", blurb: "Paged KV memory, prefix caching with block hashes, and disaggregated serving. The problems Dynamo was built to solve." });

  GS.lesson({
    id: "paged", ch: "c3", title: "Engines and paged KV memory", mins: 9, labs: 1,
    summary: "Engines like vLLM manage KV cache the way an OS manages RAM: in fixed-size pages that can live anywhere. It's why blocks exist and why Dynamo can reason about them.",
    goals: ["Explain the fragmentation problem with contiguous KV allocation", "Explain PagedAttention", "Connect engine blocks to Dynamo's block-level view"],
    body: () => `
<p>When a request starts, you don't know how long it will run. Early engines reserved the maximum possible length up front, in one contiguous chunk of GPU memory. Most of that reservation sat empty, and gaps between reservations couldn't be used by anyone.</p>
<p>vLLM's ${t("paged-attention", "PagedAttention")} fixed this by borrowing from operating systems: split KV memory into small fixed-size blocks, hand them out only as a request grows, and keep a per-request table of which blocks it owns. Blocks don't need to be next to each other.</p>

<div data-widget="paged"></div>

<p>Every major engine now works this way (SGLang's RadixAttention adds a prefix tree on top, TensorRT-LLM has its own block manager). This matters for Dynamo because <mark>blocks give everyone a shared unit of account</mark>. Workers can report "I stored these blocks" and "I evicted those blocks." The router can count blocks. NIXL can transfer blocks. KVBM can offload blocks.</p>
<p>The ${t("mocker")} reproduces this behaviour without a GPU. Its scheduler and block manager live in ${src("lib/mocker/src")}; it's worth a skim once you've finished chapter 6.</p>
`,
    quiz: [
      { q: "What problem does paged KV allocation solve?", a: ["Slow tokenization", "Memory reserved but unused (fragmentation), which limits how many requests fit", "Network latency", "Model accuracy"], c: 1, why: "Allocating fixed-size blocks on demand stops reservations from wasting memory." },
    ],
  });

  GS.lesson({
    id: "prefix-cache", ch: "c3", title: "Prefix caching and block hashes", mins: 12, labs: 1,
    summary: "If two requests start with the same tokens, their KV blocks are identical. Hash each block, chain the hashes, and you can detect and reuse shared prefixes instantly.",
    goals: ["Explain prefix caching and why chat apps benefit hugely", "Explain local block hashes vs sequence hashes", "Read Dynamo's block hashing code"],
    body: () => `
<p>Real traffic is repetitive. Every request to a coding assistant starts with the same system prompt. Every turn of a chat resends the whole conversation. An agent re-reads the same files over and over. If a block of tokens (and everything before it) is identical, its KV values are identical too. ${t("prefix-caching", "Prefix caching")} keeps those blocks around and skips recomputing them.</p>

<h2>How to recognise a shared prefix quickly</h2>
<p>Comparing token lists is slow. Instead, hash each full block. But a block's KV depends on <em>everything before it</em>, not just its own tokens. So Dynamo uses two hashes:</p>
<ul>
  <li><strong>Local block hash</strong>: hash of just this block's tokens (plus things like the LoRA adapter name).</li>
  <li><strong>${t("sequence-hash", "Sequence hash")}</strong>: this block's local hash chained with its parent's sequence hash. Equal sequence hashes mean equal prefixes.</li>
</ul>

<div data-widget="blockhash"></div>
<p>Try the <em>Same words, shifted</em> preset. The blocks contain identical words, so some local hashes match, but the sequence hashes don't, because the history before them differs. That KV is genuinely different. The chain prevents a false hit.</p>

<h2>The real code</h2>
${code("rust", `/// Seed for XXH3 hashing, consistent with indexer.rs
pub const XXH3_SEED: u64 = 1337;

/// Compute the hash of a local block.
pub fn compute_block_hash(data: &[u8]) -> LocalBlockHash {
    LocalBlockHash(compute_hash_v2(data, XXH3_SEED))
}

pub fn compute_block_hash_for_seq(
    tokens: &[u32],
    kv_block_size: u32,
    options: BlockHashOptions<'_>,   // multimodal info, LoRA name, cache namespace //<<
) -> Vec<LocalBlockHash> {
    compute_block_hash_for_seq_with_seed(tokens, kv_block_size, options, block_hash_seed(options))
}`, "lib/kv-router/src/protocols.rs")}
<p>And the chaining rule, documented in the tokens crate:</p>
${code("rust", `/// A 64-bit sequence-aware hash. Equals the [BlockHash] at position 0 and
/// compute_next_sequence_hash(prev_seq, block_hash) at every subsequent position.
pub type SequenceHash = u64;`, "lib/tokens/src/lib.rs")}
<p>Notice the options. A LoRA adapter changes the model's behaviour, so the same tokens under a different adapter must hash differently. Same for images in multimodal prompts. Forgetting one of these is a classic way to serve someone the wrong cache.</p>
<p class="margin-note">Why XXH3? It's one of the fastest non-cryptographic hashes around, and the router hashes every block of every prompt.</p>
`,
    quiz: [
      { q: "Two requests have an identical block at position 5, but different tokens in block 2. Can block 5's KV be reused?", a: ["Yes, the block tokens match", "No, the sequence hashes differ because the prefix differs", "Only if the block size is 16", "Only on the same GPU"], c: 1, why: "KV for block 5 depends on every earlier token. The chained sequence hash captures that, so it won't match." },
      { q: "Why is the LoRA adapter name mixed into the hash?", a: ["To make hashes longer", "Because the same tokens under a different adapter produce different KV values", "For logging", "It isn't"], c: 1, why: "An adapter changes the model's weights, so its KV cache differs. The seed derived from the adapter name keeps them apart." },
    ],
  });

  GS.lesson({
    id: "disagg", ch: "c3", title: "Disaggregated serving", mins: 12, labs: 1,
    summary: "Prefill and decode fight each other on the same GPU. Put them on separate GPUs, move the KV cache between them with NIXL, and tune each side on its own.",
    goals: ["Explain prefill interference", "Explain how disaggregation works and what it costs", "Know where Dynamo's disaggregation code lives"],
    body: () => `
<p>On an aggregated GPU, a long new prompt has to be prefilled somewhere in between decode steps. While that happens, every user who is mid-stream on that GPU waits. Their ITL spikes. Engines soften this with chunked prefill, but the two phases still compete for the same GPU.</p>
<p>${t("disagg", "Disaggregated serving")} splits them. <strong>Prefill workers</strong> only process prompts. <strong>Decode workers</strong> only generate. After prefill, the KV blocks are transferred to the decode worker, GPU to GPU, through ${t("nixl", "NIXL")}.</p>

<div data-widget="disagg"></div>

<h2>What you gain, what you pay</h2>
<ul>
  <li><strong>Gain:</strong> smooth, predictable ITL. Each pool can use different parallelism, batch sizes and even GPU types. You scale prefill and decode separately.</li>
  <li><strong>Pay:</strong> a KV transfer per request (small with NVLink/RDMA, painful without). Getting the prefill:decode ratio wrong creates a queue on one side. Choosing that ratio, and changing it as traffic shifts, is what the ${t("planner")} does.</li>
</ul>

<h2>How Dynamo wires it</h2>
<p>The architecture doc describes the flow: the frontend's <code>PrefillRouter</code> picks a prefill worker, the prefill worker returns transfer metadata (<code>disaggregated_params</code>), the router injects that into the decode request, and the decode worker pulls the KV directly from the prefill worker's GPU.</p>
${code("text", `S3  PrefillRouter selects a prefill worker (KV-aware or load-balanced)
S4  prefill worker computes the prompt's KV cache
S5  prefill worker returns disaggregated_params (backend-specific transfer metadata)
S6  PrefillRouter injects that into the decode request and routes it
S7  decode worker pulls KV blocks GPU-to-GPU via NIXL
S8  decode worker generates tokens`, "docs/fern/pages/developer-guide/knowledge-base/concepts/system-architecture/architecture.md")}
<p>Each engine coordinates the transfer differently (the doc notes SGLang uses bootstrap connections, TensorRT-LLM opaque state, vLLM block IDs), which is why each backend has its own glue under <code>components/src/dynamo/</code>. The router side lives in ${src("lib/llm/src/kv_router/prefill_router/mod.rs")}.</p>
`,
    quiz: [
      { q: "What is “prefill interference”?", a: ["Two prefill workers sharing a GPU", "Decode users' token stream stalling while a new prompt is prefilled on the same GPU", "KV transfer failing", "The tokenizer slowing down"], c: 1, why: "On an aggregated GPU, a long prefill delays the next decode step for everyone already streaming." },
      { q: "In Dynamo's disaggregated flow, how does the decode worker get the prompt's KV cache?", a: ["It recomputes it", "It reads it from etcd", "It pulls the blocks GPU-to-GPU from the prefill worker via NIXL, using metadata the router passed along", "The frontend sends it over HTTP"], c: 2, why: "The prefill worker returns disaggregated_params; the router injects them into the decode request; NIXL moves the blocks." },
    ],
  });
})();
