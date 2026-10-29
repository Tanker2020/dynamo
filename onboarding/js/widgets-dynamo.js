/* Labs for the Dynamo chapters: architecture, runtime, pipelines, router, indexer, KVBM, planner, hands-on. */
(function () {
  "use strict";
  const { h, esc, fmt, svg, frame, slider, seg, stat, rng, hash32, hex } = GS;
  const W = GS.widgets;

  /* ===================== Architecture map ===================== */
  W.arch = function (el) {
    const body = frame(el, "The architecture map", "Click any box for what it does and where it lives. Use the flow buttons to light up one kind of traffic at a time.");
    const N = {
      client: { x: 14, y: 70, w: 104, h: 54, label: "Client", sub: "curl · SDK · agent", color: "var(--ink-soft)",
        d: "Anything that speaks the OpenAI (or Anthropic) HTTP API. Dynamo looks like a normal /v1/chat/completions server from the outside.", paths: [] },
      fe: { x: 160, y: 70, w: 150, h: 54, label: "Frontend", sub: "HTTP · template · tokenize", color: "var(--c1)",
        d: "python -m dynamo.frontend. An axum HTTP server in Rust that validates the request, applies the chat template, tokenizes, runs the pipeline, and streams detokenized chunks back as server-sent events. Port 8000 by default.",
        paths: ["components/src/dynamo/frontend/main.py", "lib/llm/src/http/service/openai.rs", "lib/llm/src/preprocessor.rs", "lib/llm/src/entrypoint/input/common.rs"] },
      router: { x: 352, y: 70, w: 150, h: 54, label: "Router", sub: "KV-aware worker choice", color: "var(--c2)",
        d: "Picks a worker for each request. In KV mode it hashes the prompt into blocks, asks the indexer which workers already cache them, and scores overlap against load. Runs inside the frontend process by default; it can also run standalone (python -m dynamo.router).",
        paths: ["lib/llm/src/kv_router.rs", "lib/kv-router/src/scheduling", "lib/kv-router/src/indexer", "lib/runtime/src/pipeline/network/egress/push_router.rs"] },
      prefill: { x: 560, y: 14, w: 176, h: 54, label: "Prefill workers", sub: "engine on GPU(s)", color: "var(--c5)",
        d: "In disaggregated mode, these run only the prompt pass, fill the KV cache, and hand it to a decode worker. Launched with an engine backend, e.g. python -m dynamo.vllm with a prefill disaggregation mode.",
        paths: ["components/src/dynamo/vllm/handlers.py", "lib/llm/src/kv_router/prefill_router/mod.rs"] },
      decode: { x: 560, y: 128, w: 176, h: 54, label: "Decode workers", sub: "engine on GPU(s)", color: "var(--c5)",
        d: "Generate output tokens one step at a time and stream them back. In aggregated mode a single worker type does both prefill and decode.",
        paths: ["components/src/dynamo/vllm/main.py", "components/src/dynamo/sglang", "components/src/dynamo/trtllm"] },
      disc: { x: 160, y: 262, w: 150, h: 54, label: "Discovery", sub: "etcd · Kubernetes · file", color: "var(--c6)",
        d: "Where every process registers its endpoints and model cards, and where clients watch for workers coming and going. etcd locally (leases expire when a process dies), Kubernetes resources in a cluster, file or memory for development.",
        paths: ["lib/runtime/src/discovery/mod.rs", "lib/runtime/src/discovery/kv_store.rs", "lib/runtime/src/discovery/kube.rs"] },
      events: { x: 352, y: 262, w: 150, h: 54, label: "Event plane", sub: "ZMQ (default) · NATS", color: "var(--c3)",
        d: "Fire-and-forget pub/sub for KV cache events (blocks stored or removed) and worker load metrics. The router's indexer is rebuilt entirely from these events.",
        paths: ["lib/runtime/src/transports/event_plane", "lib/kv-router/src/protocols.rs", "lib/llm/src/kv_router/publisher"] },
      planner: { x: 560, y: 262, w: 176, h: 54, label: "Planner", sub: "autoscaling to SLAs", color: "var(--c4)",
        d: "Watches traffic and engine metrics and changes how many prefill and decode workers run, targeting TTFT and ITL. On Kubernetes it adjusts replica counts the operator reconciles.",
        paths: ["components/src/dynamo/planner", "docs/fern/pages/developer-guide/knowledge-base/modular-components/planner/overview.md"] },
      kvbm: { x: 560, y: 352, w: 176, h: 54, label: "KVBM tiers", sub: "G2 CPU · G3 SSD · G4 object", color: "var(--c1)",
        d: "The KV Block Manager offloads blocks that fall out of GPU memory to CPU RAM, local disk and remote storage, then brings them back on a cache hit instead of recomputing prefill.",
        paths: ["lib/kvbm-engine/src/lib.rs", "lib/kvbm-logical", "lib/kvbm-physical"] },
    };
    const E = [
      ["client", "fe", ["req"]], ["fe", "router", ["req"]], ["router", "prefill", ["req"]], ["router", "decode", ["req"]],
      ["prefill", "decode", ["req", "nixl"], "NIXL"], ["decode", "fe", ["req"], null, "back"],
      ["prefill", "events", ["ev"]], ["decode", "events", ["ev"]], ["events", "router", ["ev"]],
      ["fe", "disc", ["disc"]], ["prefill", "disc", ["disc"]], ["decode", "disc", ["disc"]], ["planner", "disc", ["disc"]],
      ["events", "planner", ["scale"]], ["planner", "prefill", ["scale"]], ["planner", "decode", ["scale"]],
      ["decode", "kvbm", ["kv"]],
    ];
    const flows = { all: "Everything", req: "Request path", ev: "KV events", disc: "Discovery", scale: "Scaling", kv: "Offload" };
    const Wd = 750, Ht = 420;
    const s = svg("svg", { viewBox: `0 0 ${Wd} ${Ht}`, role: "img", "aria-label": "Dynamo architecture diagram", style: "min-width:600px" });
    s.append(svg("defs", {}, svg("marker", { id: "aa", viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "6", markerHeight: "6", orient: "auto-start-reverse" }, svg("path", { d: "M0 0L10 5L0 10z", fill: "var(--ink-soft)" }))));
    const c = (n) => [N[n].x + N[n].w / 2, N[n].y + N[n].h / 2];
    function edgePoint(n, tx, ty) {
      const b = N[n], [cx, cy] = c(n), dx = tx - cx, dy = ty - cy;
      const sx = dx ? (b.w / 2) / Math.abs(dx) : Infinity, sy = dy ? (b.h / 2) / Math.abs(dy) : Infinity;
      const k = Math.min(sx, sy);
      return [cx + dx * k, cy + dy * k];
    }
    const edgeEls = [];
    E.forEach(([a, b, kinds, label, back]) => {
      const [ax, ay] = c(a), [bx, by] = c(b);
      let p1 = edgePoint(a, bx, by), p2 = edgePoint(b, ax, ay);
      let d;
      if (back) d = `M${N.decode.x + 20},${N.decode.y + N.decode.h} C ${N.decode.x - 10},${236} ${N.fe.x + 110},${236} ${N.fe.x + 110},${N.fe.y + N.fe.h + 2}`;
      else d = `M${p1[0].toFixed(1)},${p1[1].toFixed(1)} L${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
      const path = svg("path", { d, fill: "none", stroke: "var(--ink-soft)", "stroke-width": 1.6, "marker-end": "url(#aa)", opacity: 0.8 });
      path.dataset.kinds = kinds.join(" ");
      s.append(path);
      edgeEls.push(path);
      if (label) s.append(svg("text", { x: (ax + bx) / 2 + 8, y: (ay + by) / 2 + 4, "font-size": 11, "font-weight": 700, fill: "var(--c3)", text: label }));
      if (back) s.append(svg("text", { x: 330, y: 230, "font-size": 10.5, fill: "var(--accent)", text: "token stream back" }));
    });
    const panel = h("div", { class: "detail-panel" });
    const gs = {};
    function select(k) {
      Object.entries(gs).forEach(([kk, g]) => g.classList.toggle("sel", kk === k));
      const n = N[k];
      panel.innerHTML = `<h4>${esc(n.label)}</h4><p>${esc(n.d)}</p>${n.paths.length ? `<div class="lbl" style="margin-top:8px">Where it lives</div><div class="paths">${n.paths.map((p) => GS.src(p)).join("")}</div>` : ""}`;
    }
    Object.entries(N).forEach(([k, n]) => {
      const g = svg("g", { class: "node", tabindex: "0", role: "button", "aria-label": n.label });
      g.append(svg("rect", { x: n.x, y: n.y, width: n.w, height: n.h, rx: 10, fill: "var(--sheet)", stroke: n.color, "stroke-width": 2 }));
      g.append(svg("text", { x: n.x + 12, y: n.y + 23, "font-size": 14, "font-weight": 700, fill: "var(--ink)", text: n.label }));
      g.append(svg("text", { x: n.x + 12, y: n.y + 41, "font-size": 10.5, fill: "var(--ink-soft)", text: n.sub }));
      g.addEventListener("click", () => select(k));
      g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(k); } });
      gs[k] = g;
      s.append(g);
    });
    s.append(svg("rect", { x: 140, y: 52, width: 380, height: 92, rx: 14, fill: "none", stroke: "var(--rule)", "stroke-dasharray": "6 5" }));
    s.append(svg("text", { x: 150, y: 160, "font-size": 10.5, fill: "var(--ink-faint)", text: "one frontend process (router embedded by default)" }));
    const seen = new Set();
    function flow(k) {
      edgeEls.forEach((p) => {
        const on = k === "all" || p.dataset.kinds.split(" ").includes(k);
        p.setAttribute("stroke", on && k !== "all" ? "var(--accent)" : "var(--ink-soft)");
        p.setAttribute("stroke-width", on && k !== "all" ? 3 : 1.6);
        p.setAttribute("opacity", on ? 1 : 0.15);
        p.setAttribute("stroke-dasharray", on && k !== "all" ? "8 5" : "");
      });
      seen.add(k);
      if (seen.size >= 6) GS.award("arch-flows", 5, "You traced every flow on the map");
    }
    body.append(h("div", { class: "row", style: { marginBottom: "12px" } }, seg(Object.entries(flows), "all", flow)),
      h("div", { class: "diagram-wrap" }, h("div", { class: "scroll-x" }, s), panel));
    select("fe");
  };

  /* ===================== Request journey ===================== */
  W.journey = function (el) {
    const body = frame(el, "Follow one request end to end", "Step through a single chat request in an aggregated deployment with KV-aware routing. Each stop shows the payload at that moment and the code that handles it.");
    const lanes = ["Client", "HTTP", "Preprocess", "Migration", "Backend", "Router", "Network", "Worker"];
    const steps = [
      { lane: 0, title: "The client sends a chat request", path: "lib/llm/src/http/service/openai.rs",
        text: "Nothing special: a normal OpenAI-style POST with stream: true. The frontend's HTTP server (axum) receives it in <code>handler_chat_completions</code>.",
        data: `POST /v1/chat/completions\n{\n  "model": "Qwen/Qwen3-0.6B",\n  "messages": [{"role": "user", "content": "What is a KV cache?"}],\n  "max_tokens": 64,\n  "stream": true\n}` },
      { lane: 1, title: "HTTP layer validates and hands off to the engine", path: "lib/llm/src/http/service/openai.rs",
        text: "The handler checks the model exists, creates a request context (an ID and a cancellation handle that follows the request everywhere), and calls the model's pipeline engine with <code>generate()</code>.",
        data: `SingleIn<NvCreateChatCompletionRequest>\n  context.id = "8f3c…"   // follows the request across processes\n  data       = { model, messages, max_tokens, stream }` },
      { lane: 2, title: "Preprocessor: template, then tokenize", path: "lib/llm/src/preprocessor.rs",
        text: "<code>OpenAIPreprocessor</code> renders the model's chat template (from its Model Deployment Card) into one prompt string, tokenizes it in Rust, and converts sampling options and stop conditions into an engine-neutral <code>PreprocessedRequest</code>.",
        data: `prompt = "<|im_start|>user\\nWhat is a KV cache?<|im_end|>\\n<|im_start|>assistant\\n"\n\nPreprocessedRequest {\n  token_ids: [151644, 872, 198, 3838, 374, 264, 84648, 6500, 30, ...],\n  stop_conditions: { max_tokens: 64, ... },\n  sampling_options: { temperature, top_p, ... },\n}` },
      { lane: 3, title: "Migration remembers the request", path: "lib/llm/src/migration.rs",
        text: "The <code>Migration</code> operator wraps the response stream. If the worker dies mid-generation, it re-sends the prompt plus the tokens already produced to a different worker, and the client never notices.",
        data: `Migration { migration_limit, ... }\n  keeps: original token_ids + tokens generated so far\n  on stream error → retry on another instance` },
      { lane: 4, title: "Backend prepares the detokenizer", path: "lib/llm/src/backend.rs",
        text: "On the way down, the <code>Backend</code> operator reads decoder parameters (stop strings, special-token handling). Its real work happens on the way back up, turning token IDs into text incrementally.",
        data: `DecoderParams::from_request(&request)\n  next.generate(request).await?  // call the next stage\n  wrap the returned stream with an incremental decoder` },
      { lane: 5, title: "KV router picks a worker", path: "lib/llm/src/kv_router.rs",
        text: "The router splits <code>token_ids</code> into 16-token blocks, hashes each one, and asks the indexer how many leading blocks each worker already caches. It combines that overlap with each worker's load into a cost and picks the lowest. You'll play with this formula in chapter 6.",
        data: `block hashes: [0x9a1f…, 0x22c4…, 0x7e0b…]\noverlap:  worker 0x1a → 2 blocks, worker 0x2b → 0 blocks\ncost:     0x1a = 3.0, 0x2b = 6.0\n→ selected instance 0x1a` },
      { lane: 6, title: "Request plane: over the wire", path: "lib/runtime/src/pipeline/network/egress/push_router.rs",
        text: "The request is serialized (msgpack by default) and sent over a pooled TCP connection straight to the chosen worker instance. The address came from discovery. A response stream is opened back to the frontend.",
        data: `DYN_REQUEST_PLANE=tcp (default) | nats\nendpoint: dynamo.backend.generate  instance 0x1a\npayload codec: msgpack` },
      { lane: 7, title: "Worker runs the engine and streams tokens", path: "components/src/dynamo/vllm/handlers.py",
        text: "The Python handler's <code>async def generate(self, request, context)</code> feeds the tokens to vLLM and yields output chunks as they appear. As vLLM stores new KV blocks, a publisher emits KV events, so the router learns this worker now caches this prompt.",
        data: `yield {"token_ids": [362], ...}\nyield {"token_ids": [84648], ...}\nyield {"token_ids": [6500], ...}\n...\nKV event → Stored { blocks: [...] }  (event plane)` },
      { lane: 4, title: "Back up: token IDs become text", path: "lib/llm/src/backend.rs",
        text: "Each <code>LLMEngineOutput</code> chunk flows back up through the same operators. The <code>Backend</code> runs the incremental detokenizer (some tokens are half a character) and watches for stop strings.",
        data: `LLMEngineOutput { token_ids: [84648] }\n  → BackendOutput { text: " KV" }` },
      { lane: 2, title: "Back up: text becomes OpenAI chunks", path: "lib/llm/src/preprocessor.rs",
        text: "The preprocessor's backward edge wraps text deltas into <code>chat.completion.chunk</code> objects, and can parse tool calls or reasoning sections for models that emit them.",
        data: `{"object":"chat.completion.chunk",\n "choices":[{"index":0,"delta":{"content":" KV"}}]}` },
      { lane: 0, title: "Server-sent events reach the client", path: "lib/llm/src/http/service/openai.rs",
        text: "The HTTP layer writes each chunk as an SSE line the instant it arrives, then <code>[DONE]</code>. If the client disconnects, the request context is cancelled and the cancellation travels all the way to the worker.",
        data: `data: {"choices":[{"delta":{"content":"A"}}]}\n\ndata: {"choices":[{"delta":{"content":" KV"}}]}\n\n...\ndata: [DONE]` },
    ];
    let i = 0;
    const laneEl = h("div", { class: "scroll-x" });
    const detail = h("div");
    function draw() {
      const st = steps[i];
      const Wd = 760, lw = Wd / lanes.length;
      let s = `<svg viewBox="0 0 ${Wd} 76" style="min-width:600px;width:100%" role="img" aria-label="Request position">`;
      lanes.forEach((ln, k) => {
        const on = k === st.lane;
        s += `<rect x="${k * lw + 3}" y="6" width="${lw - 6}" height="40" rx="8" fill="${on ? "var(--hl)" : "var(--paper)"}" stroke="${on ? "var(--ink)" : "var(--rule)"}" stroke-width="${on ? 2 : 1}"/>`;
        s += `<text x="${k * lw + lw / 2}" y="31" text-anchor="middle" font-size="12" font-weight="${on ? 700 : 400}" fill="${on ? "var(--hl-ink)" : "var(--ink-soft)"}">${ln}</text>`;
      });
      const dir = i >= 8 ? "← response stream" : "request →";
      s += `<text x="${Wd / 2}" y="66" text-anchor="middle" font-size="11" fill="var(--accent)">${dir}</text></svg>`;
      laneEl.innerHTML = s;
      detail.innerHTML = `<div class="row" style="justify-content:space-between;margin:12px 0 6px"><h4 style="font-size:18px">${i + 1}. ${esc(st.title)}</h4><span class="pill">${i + 1} / ${steps.length}</span></div>
        <p style="margin:0 0 10px">${st.text}</p>${GS.code("text", st.data, null, { label: "payload at this step (illustrative)", wide: true })}
        <p class="mono" style="font-size:12.5px;margin-top:8px">Code: ${GS.src(st.path)}</p>`;
      prev.disabled = i === 0; next.disabled = i === steps.length - 1;
      if (i === steps.length - 1) GS.award("journey", 8, "You followed a request end to end");
    }
    const prev = h("button", { class: "btn small ghost", type: "button", text: "← Back", onclick: () => { if (i > 0) { i--; draw(); } } });
    const next = h("button", { class: "btn small primary", type: "button", text: "Next stop →", onclick: () => { if (i < steps.length - 1) { i++; draw(); } } });
    body.append(laneEl, h("div", { class: "row", style: { marginTop: "8px" } }, prev, next), detail);
    draw();
  };

  /* ===================== Discovery + leases ===================== */
  W.discovery = function (el) {
    const body = frame(el, "Discovery, leases and a dying worker", "A toy etcd. Workers register an instance key tied to a lease and keep it alive with heartbeats. Kill one and see what the client experiences before and after the lease expires. 1 tick = 1 second.");
    const TTL = 6, INHIBIT = 5;
    let ns = "dynamo", comp = "backend", ep = "generate";
    let now = 0, timer = null, rr = 0, nextId = 0x1a2b;
    let workers = [], inhibited = {};
    const logLines = [];
    const keysEl = h("div", { class: "log", style: { maxHeight: "160px" } });
    const workersEl = h("div", { class: "row" });
    const logEl = h("div", { class: "log" });
    const clock = h("span", { class: "pill acc" });
    const log = (m) => { logLines.unshift(`t=${String(now).padStart(3)}  ${m}`); logLines.length = Math.min(logLines.length, 60); };
    function key(w) { return `v1/instances/${ns}/${comp}/${ep}/${w.id.toString(16)}`; }
    function start() { const w = { id: nextId, alive: true, lease: TTL }; nextId += 0x1111; workers.push(w); log(`worker ${w.id.toString(16)} starts → PUT ${key(w)} (lease TTL ${TTL}s)`); draw(); }
    function tick() {
      now++;
      workers.forEach((w) => {
        if (w.alive) w.lease = TTL;
        else if (w.lease > 0) { w.lease--; if (w.lease === 0) log(`lease for ${w.id.toString(16)} expired → key deleted, clients' watches fire`); }
      });
      workers = workers.filter((w) => w.alive || w.lease > 0);
      for (const k of Object.keys(inhibited)) if (inhibited[k] <= now) { delete inhibited[k]; log(`inhibition on ${(+k).toString(16)} lifted`); }
      draw();
    }
    function send() {
      const visible = workers.filter((w) => !inhibited[w.id]);
      if (!visible.length) { log(`client: request failed: no instances for ${ns}.${comp}.${ep}`); draw(); return; }
      const w = visible[rr++ % visible.length];
      if (w.alive) log(`client → ${w.id.toString(16)}: ok, tokens streaming`);
      else {
        inhibited[w.id] = now + INHIBIT;
        log(`client → ${w.id.toString(16)}: connection refused! inhibit locally for ${INHIBIT}s (key still in etcd)`);
        GS.award("disc-inhibit", 6, "You hit a dead worker before its lease expired");
      }
      draw();
    }
    function draw() {
      clock.textContent = `t = ${now}s`;
      keysEl.innerHTML = workers.length ? workers.map((w) => `<div>${esc(key(w))}  <span style="color:${w.alive ? "var(--good)" : "var(--pencil)"}">lease ${w.alive ? "♥ alive" : `expires in ${w.lease}s`}</span></div>`).join("") : `<div class="muted">(no keys under v1/instances/${esc(ns)}/${esc(comp)}/${esc(ep)}/)</div>`;
      workersEl.innerHTML = "";
      workers.forEach((w) => {
        const card = h("div", { style: { border: `1.5px solid ${w.alive ? "var(--good)" : "var(--pencil)"}`, borderRadius: "10px", padding: "8px 10px", background: "var(--paper)", minWidth: "150px" } },
          h("div", { class: "mono", style: { fontWeight: "700" }, text: "instance " + w.id.toString(16) }),
          h("div", { class: "mono muted", style: { fontSize: "12px" }, text: w.alive ? "running · heartbeating" : "dead · no heartbeats" + (inhibited[w.id] ? " · inhibited" : "") }));
        if (w.alive) card.append(h("button", { class: "btn small ghost", type: "button", style: { marginTop: "6px" }, text: "kill -9", onclick: () => { w.alive = false; log(`worker ${w.id.toString(16)} crashes (no graceful deregister)`); draw(); } }));
        workersEl.append(card);
      });
      logEl.innerHTML = logLines.map((l) => `<div>${esc(l)}</div>`).join("");
    }
    const inputs = [["Namespace", ns, (v) => (ns = v)], ["Component", comp, (v) => (comp = v)], ["Endpoint", ep, (v) => (ep = v)]].map(([lab, val, set], i) => {
      const id = "dsc" + i;
      const inp = h("input", { class: "txt", id, type: "text", value: val });
      inp.addEventListener("input", () => { set(inp.value.replace(/[^\w-]/g, "") || "x"); draw(); });
      return h("div", { class: "field" }, h("label", { for: id, text: lab }), inp);
    });
    const runBtn = h("button", { class: "btn small", type: "button", text: "⏸ Pause clock" });
    runBtn.onclick = () => { if (timer) { clearInterval(timer); timer = null; runBtn.textContent = "▶ Run clock"; } else { timer = setInterval(tick, 1000); runBtn.textContent = "⏸ Pause clock"; } };
    body.append(h("div", { class: "col3" }, ...inputs),
      h("p", { class: "mono", style: { fontSize: "13px", margin: "10px 0" }, html: `Python: <code>runtime.endpoint("${esc(ns)}.${esc(comp)}.${esc(ep)}")</code>` }),
      h("div", { class: "row", style: { marginBottom: "10px" } }, clock,
        h("button", { class: "btn small primary", type: "button", text: "+ Start worker", onclick: start }),
        h("button", { class: "btn small", type: "button", text: "Client: send request", onclick: send }), runBtn),
      workersEl, h("div", { class: "lbl", style: { margin: "12px 0 4px" }, text: "etcd keys" }), keysEl, h("div", { class: "lbl", style: { margin: "12px 0 4px" }, text: "log (newest first)" }), logEl);
    start(); start();
    timer = setInterval(tick, 1000);
    return () => timer && clearInterval(timer);
  };

  /* ===================== Pipeline onion ===================== */
  W.pipeline = function (el) {
    const body = frame(el, "Walk the .link() chain", "This is the real chain from build_pipeline in lib/llm/src/entrypoint/input/common.rs. Step through it: requests go down forward edges, the response stream climbs back up backward edges.");
    const lines = [
      "let engine = frontend",
      "    .link(preprocessor_op.forward_edge())?",
      "    .link(migration.forward_edge())?",
      "    .link(token_backend.forward_edge())?",
      "    .link(encoder_op.forward_edge())?",
      "    .link(prefill_op.forward_edge())?",
      "    .link(backend)?",
      "    .link(prefill_op.backward_edge())?",
      "    .link(encoder_op.backward_edge())?",
      "    .link(token_backend.backward_edge())?",
      "    .link(migration.backward_edge())?",
      "    .link(preprocessor_op.backward_edge())?",
      "    .link_terminal(frontend)?;",
    ];
    const stages = ["frontend", "preprocessor_op", "migration", "token_backend", "encoder_op", "prefill_op", "backend"];
    const info = [
      ["frontend", "SegmentSource: where the HTTP handler injects a request.", "SingleIn<NvCreateChatCompletionRequest>"],
      ["preprocessor_op", "OpenAIPreprocessor: chat template + tokenize.", "Context<PreprocessedRequest> { token_ids, … }"],
      ["migration", "Migration: keeps what it needs to replay on another worker.", "Context<PreprocessedRequest>"],
      ["token_backend", "Backend: reads decoder params for the return trip.", "Context<PreprocessedRequest>"],
      ["encoder_op", "Encoder router: sends images/video to an encode worker. Text passes straight through.", "Context<PreprocessedRequest>"],
      ["prefill_op", "PrefillRouter: in disaggregated mode, runs prefill on a prefill worker and attaches KV transfer metadata. Aggregated: pass-through.", "Context<PreprocessedRequest> (+ disaggregated_params)"],
      ["backend", "ServiceBackend around the routed engine: the router picks an instance, the request crosses the network, the worker streams back.", "ManyOut<Annotated<LLMEngineOutput>> { token_ids }"],
      ["prefill_op", "PrefillRouter backward edge: response passes through.", "ManyOut<Annotated<LLMEngineOutput>>"],
      ["encoder_op", "Encoder backward edge: pass-through.", "ManyOut<Annotated<LLMEngineOutput>>"],
      ["token_backend", "Backend backward edge: incremental detokenization and stop-string checks.", "ManyOut<Annotated<BackendOutput>> { text }"],
      ["migration", "Migration backward edge: if the stream breaks, re-issue with the tokens so far.", "ManyOut<Annotated<BackendOutput>>"],
      ["preprocessor_op", "Preprocessor backward edge: text → OpenAI chat.completion.chunk deltas.", "ManyOut<Annotated<NvCreateChatCompletionStreamResponse>>"],
      ["frontend", "link_terminal closes the loop: the HTTP handler receives the stream and writes SSE.", "ManyOut<Annotated<…StreamResponse>>"],
    ];
    let i = 0, timer = null;
    const codeEl = h("pre", { class: "mono", style: { margin: "0", fontSize: "13px", lineHeight: "1.65", overflowX: "auto", background: "var(--code-bg)", border: "1px solid var(--rule)", borderRadius: "10px", padding: "10px 0" } });
    const onion = h("div", { class: "scroll-x" });
    const panel = h("div", { class: "detail-panel", style: { minHeight: "auto", marginTop: "12px" } });
    function draw() {
      codeEl.innerHTML = lines.map((ln, k) => `<span style="display:block;padding:0 14px;${k === i ? "background:color-mix(in srgb, var(--hl) 45%, transparent);font-weight:600" : ""}">${GS.highlight("rust", ln)}</span>`).join("");
      const active = info[i][0];
      const goingDown = i <= 6;
      const Wd = 360, rowH = 34;
      let s = `<svg viewBox="0 0 ${Wd} ${stages.length * rowH + 16}" style="min-width:300px;width:100%" role="img" aria-label="Pipeline stages">`;
      stages.forEach((st, k) => {
        const y = 8 + k * rowH, on = st === active;
        const inset = k * 12;
        s += `<rect x="${inset}" y="${y}" width="${Wd - inset * 2}" height="${rowH - 6}" rx="8" fill="${on ? "var(--hl)" : "var(--paper)"}" stroke="${on ? "var(--ink)" : "var(--rule)"}" stroke-width="${on ? 2 : 1}"/>`;
        s += `<text x="${Wd / 2}" y="${y + 18}" text-anchor="middle" font-size="12" font-weight="${on ? 700 : 400}" fill="${on ? "var(--hl-ink)" : "var(--ink)"}">${st}</text>`;
        if (on) s += `<text x="${inset + 10}" y="${y + 18}" font-size="14" fill="${goingDown ? "var(--c2)" : "var(--accent)"}">${goingDown ? "↓" : "↑"}</text>`;
      });
      onion.innerHTML = s + `</svg>`;
      panel.innerHTML = `<div class="row" style="justify-content:space-between"><b>${esc(info[i][0])}${i === 0 || i === 12 ? "" : goingDown ? " · forward edge" : " · backward edge"}</b><span class="pill ${goingDown ? "bad" : "acc"}">${goingDown ? "request going down" : "stream coming up"}</span></div>
        <p style="margin:8px 0 6px">${esc(info[i][1])}</p><div class="mono" style="font-size:12.5px">type here: <b>${esc(info[i][2])}</b></div>`;
      if (i === lines.length - 1) GS.award("pipeline", 6, "You walked the whole pipeline");
    }
    const go = (d) => { i = Math.max(0, Math.min(lines.length - 1, i + d)); draw(); };
    const auto = h("button", { class: "btn small", type: "button", text: "Auto-play" });
    auto.onclick = () => {
      if (timer) { clearInterval(timer); timer = null; auto.textContent = "Auto-play"; return; }
      if (i === lines.length - 1) i = 0;
      timer = setInterval(() => { if (i >= lines.length - 1) { clearInterval(timer); timer = null; auto.textContent = "Auto-play"; } else go(1); }, 1300);
      auto.textContent = "Pause";
    };
    body.append(h("div", { class: "row", style: { marginBottom: "12px" } },
      h("button", { class: "btn small ghost", type: "button", text: "← Back", onclick: () => go(-1) }),
      h("button", { class: "btn small primary", type: "button", text: "Step →", onclick: () => go(1) }), auto),
      h("div", { class: "col2" }, codeEl, onion), panel);
    draw();
    return () => timer && clearInterval(timer);
  };

  /* ===================== KV router cost playground ===================== */
  W.router = function (el) {
    const body = frame(el, "The KV router's cost function", "Each worker gets a cost; lowest wins. Prefill cost is cut by cached overlap, decode cost reflects the blocks the worker will be holding. Defaults reproduce the worked example in the router design doc.");
    const docPreset = () => ({ req: 10, credit: 1.0, scale: 1.0, temp: 0, workers: [
      { name: "Worker 1", overlap: 2, queued: 0, decode: 10 },
      { name: "Worker 2", overlap: 5, queued: 0, decode: 5 },
      { name: "Worker 3", overlap: 8, queued: 0, decode: 9 },
    ] });
    const presets = {
      doc: docPreset,
      hot: () => ({ req: 20, credit: 1.0, scale: 1.0, temp: 0, workers: [
        { name: "Worker 1", overlap: 18, queued: 40, decode: 60 },
        { name: "Worker 2", overlap: 0, queued: 0, decode: 12 },
        { name: "Worker 3", overlap: 4, queued: 6, decode: 20 },
      ] }),
      cold: () => ({ req: 12, credit: 1.0, scale: 1.0, temp: 0.5, workers: [
        { name: "Worker 1", overlap: 0, queued: 0, decode: 8 },
        { name: "Worker 2", overlap: 0, queued: 0, decode: 9 },
        { name: "Worker 3", overlap: 0, queued: 0, decode: 10 },
      ] }),
    };
    let S = docPreset();
    const challenges = [
      { id: "rt-c1", text: "Doc example loaded: make <b>Worker 3</b> win by changing only <code>overlap_score_credit</code>.", check: (r) => r.best === 2 && S.req === 10 && S.scale === 1 && sameWorkers(docPreset().workers) },
      { id: "rt-c2", text: "Set a temperature where the best worker gets between 50% and 70% of traffic.", check: (r) => S.temp > 0 && r.probs[r.best] >= 0.5 && r.probs[r.best] <= 0.7 },
      { id: "rt-c3", text: "“Hot cache but busy” preset: find a <code>prefill_load_scale</code> that sends the request to the busy Worker 1 anyway.", check: (r) => r.best === 0 && S.workers[0].queued === 40 },
    ];
    function sameWorkers(ws) { return S.workers.every((w, i) => ws[i] && w.overlap === ws[i].overlap && w.queued === ws[i].queued && w.decode === ws[i].decode); }
    const controls = h("div");
    const table = h("div", { class: "scroll-x", style: { marginTop: "12px" } });
    const chart = h("div", { class: "scroll-x" });
    const formula = h("div");
    const chal = h("div", { style: { marginTop: "12px" } });
    const hist = h("div", { class: "mono", style: { fontSize: "13px", marginTop: "6px" } });
    function compute() {
      const rows = S.workers.map((w) => {
        const prefill = w.queued + S.req;
        const overlap = Math.min(w.overlap, S.req);
        const adjusted = Math.max(0, prefill - S.credit * overlap);
        const cost = S.scale * adjusted + w.decode;
        return { ...w, prefill, overlap, adjusted, cost };
      });
      const costs = rows.map((r) => r.cost);
      let best = costs.indexOf(Math.min(...costs));
      let probs = rows.map((_, i) => (i === best ? 1 : 0));
      if (S.temp > 0) {
        // Same normalization as softmax_sample_index in lib/kv-router/src/scheduling/selector/reference.rs
        const lo = Math.min(...costs), hi = Math.max(...costs);
        if (lo === hi) probs = rows.map(() => 1 / rows.length);
        else {
          const scale = -1 / ((hi - lo) * S.temp);
          const ex = costs.map((c) => Math.exp(c * scale - lo * scale));
          const sum = ex.reduce((a, b) => a + b, 0);
          probs = ex.map((e) => e / sum);
        }
      }
      return { rows, best, probs };
    }
    function draw() {
      const r = compute();
      table.innerHTML = `<table style="border-collapse:collapse;width:100%;min-width:560px;font-size:14px;font-variant-numeric:tabular-nums">
        <thead><tr style="text-align:left;border-bottom:1.5px solid var(--ink)">
          <th style="padding:6px">Worker</th><th>prefill blocks<br><span class="mono muted" style="font-size:11px;font-weight:400">queued + request</span></th><th>− credit × overlap</th><th>= adjusted</th><th>+ decode</th><th>cost</th><th>${S.temp > 0 ? "P(pick)" : ""}</th></tr></thead>
        <tbody>${r.rows.map((w, i) => `<tr style="border-bottom:1px solid var(--rule);${i === r.best ? "background:var(--good-soft)" : ""}">
          <td style="padding:6px;font-weight:700">${esc(w.name)} ${i === r.best ? '<span class="pill good">selected</span>' : ""}</td>
          <td>${w.queued} + ${S.req} = ${w.prefill}</td><td>${S.credit.toFixed(2)} × ${w.overlap}</td><td>${w.adjusted.toFixed(1)}</td><td>${w.decode}</td>
          <td><b>${(S.scale !== 1 ? S.scale.toFixed(2) + "×" : "")}${w.adjusted.toFixed(1)} + ${w.decode} = ${w.cost.toFixed(1)}</b></td>
          <td>${S.temp > 0 ? (r.probs[i] * 100).toFixed(1) + "%" : ""}</td></tr>`).join("")}</tbody></table>`;
      const maxC = Math.max(...r.rows.map((w) => w.cost), 1);
      chart.innerHTML = `<div style="margin-top:12px">${r.rows.map((w, i) => `
        <div style="display:grid;grid-template-columns:80px minmax(0,1fr) 60px;gap:10px;align-items:center;margin:4px 0">
          <span class="mono">${esc(w.name)}</span>
          <div style="display:flex;height:20px;border-radius:5px;overflow:hidden;background:var(--paper);border:1px solid var(--rule)">
            <div title="prefill (adjusted × scale)" style="width:${(S.scale * w.adjusted / maxC) * 100}%;background:var(--c2)"></div>
            <div title="decode" style="width:${(w.decode / maxC) * 100}%;background:var(--accent)"></div>
          </div><span class="mono" style="text-align:right;font-weight:${i === r.best ? 700 : 400}">${w.cost.toFixed(1)}</span></div>`).join("")}
        <div class="row" style="font-size:12.5px;margin-top:4px"><span class="pill" style="border-color:var(--c2)">■ prefill part</span><span class="pill acc">■ decode part</span></div></div>`;
      formula.innerHTML = GS.code("text",
        `cost = prefill_load_scale × max(0, prefill_blocks − overlap_score_credit × device_overlap_blocks)\n     + potential_decode_blocks\n     (+ decode_active_request_weight × active_requests, default weight 0)`, null, { label: "from router-design.md (simplified: host/disk/shared-cache credits omitted)", wide: true });
      chal.innerHTML = `<div class="lbl" style="margin-bottom:6px">Challenges</div>` + challenges.map((c) => {
        const ok = c.check(r);
        if (ok) GS.award(c.id, 8, "Router challenge solved");
        const solved = GS.state.awards[c.id] != null;
        return `<div style="display:flex;gap:8px;align-items:baseline;margin:4px 0"><span class="pill ${solved ? "good" : ""}">${solved ? "✓" : "○"}</span><span>${c.text}</span></div>`;
      }).join("");
    }
    function buildControls() {
      controls.innerHTML = "";
      controls.append(
        slider("Request blocks", 1, 40, 1, S.req, (v) => { S.req = v; draw(); }),
        slider("overlap_score_credit", 0, 3, 0.05, S.credit, (v) => { S.credit = v; draw(); }, (v) => v.toFixed(2)),
        slider("prefill_load_scale", 0, 3, 0.05, S.scale, (v) => { S.scale = v; draw(); }, (v) => v.toFixed(2)),
        slider("router_temperature", 0, 2, 0.05, S.temp, (v) => { S.temp = v; draw(); }, (v) => (v ? v.toFixed(2) : "0 (argmin)")));
      const grid = h("div", { class: "col3", style: { marginTop: "12px" } });
      S.workers.forEach((w) => {
        const box = h("div", { style: { border: "1px solid var(--rule)", borderRadius: "10px", padding: "10px", background: "var(--paper)" } }, h("b", { text: w.name }));
        const mini = (lab, key, max) => {
          const id = "rw" + Math.random().toString(36).slice(2, 7);
          const v = h("span", { class: "mono", text: String(w[key]) });
          const inp = h("input", { type: "range", id, min: 0, max, step: 1, value: w[key] });
          inp.oninput = () => { w[key] = +inp.value; v.textContent = inp.value; draw(); };
          return h("div", { style: { marginTop: "6px" } }, h("label", { class: "lbl", for: id, style: { display: "flex", justifyContent: "space-between" } }, lab, v), inp);
        };
        box.append(mini("cached overlap blocks", "overlap", 40), mini("queued prefill blocks", "queued", 60), mini("potential decode blocks", "decode", 80));
        grid.append(box);
      });
      controls.append(grid);
    }
    function simulate() {
      const r = compute();
      const counts = r.rows.map(() => 0);
      for (let k = 0; k < 1000; k++) {
        let x = Math.random(), pick = r.probs.length - 1;
        for (let j = 0; j < r.probs.length; j++) { x -= r.probs[j]; if (x <= 0) { pick = j; break; } }
        counts[pick]++;
      }
      hist.innerHTML = `1,000 routings: ` + r.rows.map((w, i) => `<span class="pill${i === r.best ? " good" : ""}">${esc(w.name)}: ${counts[i]}</span>`).join(" ") + (S.temp === 0 ? ` <span class="muted">(temperature 0 always picks the minimum)</span>` : "");
    }
    const pre = seg([["doc", "Doc example"], ["hot", "Hot cache but busy"], ["cold", "Cold cluster"]], "doc", (v) => { S = presets[v](); buildControls(); draw(); hist.innerHTML = ""; });
    body.append(h("div", { class: "row", style: { marginBottom: "12px" } }, pre), controls, table, chart,
      h("div", { class: "row", style: { marginTop: "10px" } }, h("button", { class: "btn small", type: "button", text: "Route 1,000 requests", onclick: simulate })), hist, chal,
      h("div", { style: { marginTop: "12px" } }, formula));
    buildControls(); draw();
  };

  /* ===================== Radix-tree indexer ===================== */
  W.radix = function (el) {
    const body = frame(el, "Inside the KV indexer", "Workers publish Stored / Removed / Cleared events. The indexer folds them into one prefix tree tagged with worker IDs, then answers: “for this prompt, how many leading blocks does each worker already have?”");
    const SEQS = {
      A: ["sys:helpful", "sys:gpu-expert", "user:what is KV?"],
      B: ["sys:helpful", "sys:gpu-expert", "user:why is decode slow?"],
      C: ["sys:helpful", "sys:pirate", "user:say hi"],
      D: ["doc:readme-1", "doc:readme-2", "doc:readme-3", "user:summarize"],
      E: ["sys:helpful", "sys:gpu-expert", "user:what is KV?", "asst:stores K and V", "user:and NIXL?"],
    };
    const WK = [["W1", "var(--c1)"], ["W2", "var(--c2)"], ["W3", "var(--c3)"]];
    let root, worker = "W1", seq = "B", query = "E";
    const logLines = [];
    function reset() {
      root = { kids: new Map(), workers: new Set(), label: "root" };
      logLines.length = 0;
      store("W1", "A", true); store("W2", "C", true); store("W3", "D", true);
    }
    const seqHash = (labels, n) => { let p = 0; for (let i = 0; i < n; i++) p = hash32(hex(p) + labels[i], 1337); return p; };
    function store(w, s, quiet) {
      let node = root; const labels = SEQS[s];
      labels.forEach((lab) => {
        if (!node.kids.has(lab)) node.kids.set(lab, { kids: new Map(), workers: new Set(), label: lab, parent: node });
        node = node.kids.get(lab);
        node.workers.add(w);
      });
      if (!quiet || true) logLines.unshift(`${w}: Stored { parent_hash: None, blocks: [${labels.map((l, i) => "0x" + hex(seqHash(labels, i + 1)).slice(0, 6)).join(", ")}] }`);
    }
    function evictLast(w, s) {
      let node = root, deepest = null;
      for (const lab of SEQS[s]) { node = node.kids.get(lab); if (!node) break; if (node.workers.has(w)) deepest = node; }
      if (!deepest) { logLines.unshift(`${w}: nothing from ${s} cached, no event`); return; }
      deepest.workers.delete(w);
      logLines.unshift(`${w}: Removed { block_hashes: [${deepest.label}] }`);
      prune(root);
    }
    function clear(w) {
      (function walk(n) { n.workers.delete(w); n.kids.forEach(walk); })(root);
      logLines.unshift(`${w}: Cleared`);
      prune(root);
    }
    function prune(n) {
      for (const [k, c] of [...n.kids]) { prune(c); if (!c.workers.size && !c.kids.size) n.kids.delete(k); }
    }
    function matches(labels) {
      const res = Object.fromEntries(WK.map(([w]) => [w, 0]));
      const alive = new Set(WK.map(([w]) => w));
      let node = root;
      for (const lab of labels) {
        node = node.kids.get(lab);
        if (!node) break;
        for (const w of [...alive]) { if (node.workers.has(w)) res[w]++; else alive.delete(w); }
        if (!alive.size) break;
      }
      return res;
    }
    const treeEl = h("div", { class: "log", style: { maxHeight: "300px", fontSize: "13px" } });
    const resEl = h("div");
    const logEl = h("div", { class: "log" });
    function draw() {
      const lines = [];
      (function walk(n, depth) {
        n.kids.forEach((c) => {
          const badges = WK.filter(([w]) => c.workers.has(w)).map(([w, col]) => `<span style="display:inline-block;padding:0 6px;border-radius:5px;margin-left:4px;background:${col};color:var(--sheet);font-size:11px;font-weight:700">${w}</span>`).join("");
          lines.push(`<div style="padding-left:${depth * 18}px">${depth ? "└ " : ""}${esc(c.label)}${badges}</div>`);
          walk(c, depth + 1);
        });
      })(root, 0);
      treeEl.innerHTML = lines.join("") || `<div class="muted">(empty tree)</div>`;
      const m = matches(SEQS[query]);
      const best = Object.entries(m).sort((a, b) => b[1] - a[1])[0];
      resEl.innerHTML = `<div class="mono" style="font-size:12.5px;margin-bottom:6px">find_matches([${SEQS[query].map(esc).join(", ")}])</div>
        <div class="stat-row">${WK.map(([w]) => stat(w + " overlap", `${m[w]}<small> / ${SEQS[query].length} blocks</small>`, best[1] && m[w] === best[1] ? "good" : "")).join("")}</div>`;
      logEl.innerHTML = logLines.slice(0, 30).map((l) => `<div>${esc(l)}</div>`).join("");
      if (m.W2 >= 3 && m.W1 >= 3) GS.award("radix-share", 6, "Two workers now share a hot prefix");
    }
    const sel = (id, opts, val, on) => { const s = h("select", { class: "txt", id }, ...opts.map(([v, t]) => h("option", { value: v, text: t }))); s.value = val; s.onchange = () => on(s.value); return s; };
    const seqOpts = Object.entries(SEQS).map(([k, v]) => [k, `${k}: ${v.join(" › ")}`]);
    body.append(
      h("div", { class: "col3" },
        h("div", { class: "field" }, h("label", { for: "rxW", text: "Worker" }), sel("rxW", WK.map(([w]) => [w, w]), worker, (v) => (worker = v))),
        h("div", { class: "field", style: { gridColumn: "span 2" } }, h("label", { for: "rxS", text: "Block sequence" }), sel("rxS", seqOpts, seq, (v) => (seq = v)))),
      h("div", { class: "row", style: { margin: "10px 0" } },
        h("button", { class: "btn small primary", type: "button", text: "Stored", onclick: () => { store(worker, seq); draw(); } }),
        h("button", { class: "btn small", type: "button", text: "Removed (evict last block)", onclick: () => { evictLast(worker, seq); draw(); } }),
        h("button", { class: "btn small", type: "button", text: "Cleared", onclick: () => { clear(worker); draw(); } }),
        h("button", { class: "btn small ghost", type: "button", text: "Reset", onclick: () => { reset(); draw(); } })),
      h("div", { class: "col2" },
        h("div", {}, h("div", { class: "lbl", style: { marginBottom: "4px" }, text: "Global prefix tree (the indexer)" }), treeEl),
        h("div", {}, h("div", { class: "field" }, h("label", { for: "rxQ", text: "Incoming request" }), sel("rxQ", seqOpts, query, (v) => { query = v; draw(); })), h("div", { style: { marginTop: "10px" } }, resEl))),
      h("div", { class: "lbl", style: { margin: "12px 0 4px" }, text: "KV event log (newest first; hashes are toy values)" }), logEl);
    reset(); draw();
  };

  /* ===================== KVBM tiers ===================== */
  W.kvbm = function (el) {
    const body = frame(el, "KVBM: a memory hierarchy for KV blocks", "Twelve users keep coming back to their conversations. GPU memory (G1) only holds 8 blocks. With offload on, evicted blocks fall to CPU (G2), then SSD (G3), then object storage (G4) instead of vanishing. Costs are toy units.");
    const CAP = { G1: 8, G2: 12, G3: 20, G4: Infinity };
    const COST = { G1: 0, G2: 1, G3: 4, G4: 12, miss: 25 };
    const TIERS = [["G1", "GPU HBM", "var(--c1)"], ["G2", "CPU DRAM", "var(--c6)"], ["G3", "Local NVMe", "var(--c5)"], ["G4", "Object store", "var(--c4)"]];
    const colors = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)", "var(--c6)"];
    let offload = true, seed = 3, r, tiers, stats, timer = null, turn;
    function reset() { r = rng(seed); tiers = { G1: [], G2: [], G3: [], G4: [] }; stats = { G1: 0, G2: 0, G3: 0, G4: 0, miss: 0, cost: 0, base: 0, reqs: 0 }; turn = {}; }
    function where(b) { for (const t of ["G1", "G2", "G3", "G4"]) { const i = tiers[t].indexOf(b); if (i >= 0) return [t, i]; } return null; }
    function placeG1(b) {
      tiers.G1.unshift(b);
      let spill = tiers.G1.length > CAP.G1 ? tiers.G1.pop() : null;
      for (const t of ["G2", "G3", "G4"]) {
        if (!spill) break;
        if (!offload) { spill = null; break; }
        tiers[t].unshift(spill);
        spill = tiers[t].length > CAP[t] ? tiers[t].pop() : null;
      }
    }
    function request() {
      const user = Math.floor(r() * 12);
      turn[user] = (turn[user] || 0) + 1;
      const blocks = [];
      for (let k = 0; k < Math.min(turn[user], 3); k++) blocks.push(`u${user}·${k}`);
      blocks.forEach((b) => {
        const w = where(b);
        if (w) { const [t, i] = w; tiers[t].splice(i, 1); stats[t]++; stats.cost += COST[t]; }
        else { stats.miss++; stats.cost += COST.miss; }
        stats.base += COST.miss;
        placeG1(b);
      });
      stats.reqs++;
      draw();
      if (offload && stats.reqs >= 40 && stats.cost < stats.base * 0.5) GS.award("kvbm-half", 8, "Offload cut prefill work in half");
    }
    const grid = h("div");
    const st = h("div", { class: "stat-row", style: { marginTop: "12px" } });
    function draw() {
      grid.innerHTML = TIERS.map(([t, name, col]) => {
        const cap = CAP[t] === Infinity ? Math.max(tiers[t].length, 6) : CAP[t];
        const cells = [];
        for (let i = 0; i < cap; i++) {
          const b = tiers[t][i];
          const u = b ? +b.slice(1).split("·")[0] : 0;
          cells.push(b ? `<span title="${b}" style="display:inline-grid;place-items:center;width:38px;height:26px;margin:2px;border-radius:5px;background:${colors[u % 6]};color:var(--sheet);font-size:10px;font-family:var(--f-mono);font-weight:700">${b.replace("·", ".")}</span>`
            : `<span style="display:inline-block;width:38px;height:26px;margin:2px;border-radius:5px;border:1px dashed var(--rule)"></span>`);
        }
        return `<div style="display:grid;grid-template-columns:120px minmax(0,1fr);gap:10px;align-items:center;margin:6px 0;${!offload && t !== "G1" ? "opacity:.35" : ""}">
          <div><b style="color:${col}">${t}</b> <span class="muted" style="font-size:13px">${name}</span><div class="mono muted" style="font-size:11px">hit cost ${COST[t]} · cap ${CAP[t] === Infinity ? "∞" : CAP[t]}</div></div>
          <div style="line-height:0">${cells.join("")}</div></div>`;
      }).join("");
      const saved = stats.base ? (1 - stats.cost / stats.base) * 100 : 0;
      st.innerHTML = stat("Requests", stats.reqs) + stat("G1 hits", stats.G1) + stat("G2+G3+G4 hits", stats.G2 + stats.G3 + stats.G4, "good") + stat("Recomputed", stats.miss, "bad") + stat("Work saved", `${saved.toFixed(0)}<small>%</small>`, saved > 40 ? "good" : "");
    }
    const auto = h("button", { class: "btn small", type: "button", text: "Auto-run" });
    auto.onclick = () => { if (timer) { clearInterval(timer); timer = null; auto.textContent = "Auto-run"; } else { timer = setInterval(request, 350); auto.textContent = "Pause"; } };
    body.append(h("div", { class: "row", style: { marginBottom: "10px" } },
      seg([["on", "Offload ON"], ["off", "Offload OFF (GPU only)"]], "on", (v) => { offload = v === "on"; reset(); draw(); }),
      h("button", { class: "btn small primary", type: "button", text: "Next user turn", onclick: request }), auto,
      h("button", { class: "btn small ghost", type: "button", text: "Reset", onclick: () => { seed++; reset(); draw(); } })), grid, st,
      h("p", { class: "mono muted", style: { fontSize: "12px" }, text: "Blocks are named user.turn. A returning user needs their earlier blocks again: a hit avoids recomputing that prefill." }));
    reset(); draw();
    return () => timer && clearInterval(timer);
  };

  /* ===================== Planner toy ===================== */
  W.planner = function (el) {
    const body = frame(el, "Autoscaling when GPUs take minutes to boot", "A day compressed into 90 ticks. Each replica serves 10 req/s. New replicas take a few ticks to become ready. Compare a fixed fleet, a reactive scaler and a predictive one.");
    let mode = "reactive", delay = 4, spike = true;
    const out = h("div", { class: "scroll-x" });
    const st = h("div", { class: "stat-row", style: { marginTop: "10px" } });
    function demand(t) { return 30 + 22 * Math.sin((t / 90) * Math.PI * 2 - 1.2) + (spike && t >= 55 && t < 63 ? 35 : 0) + 4 * Math.sin(t * 1.7); }
    function run() {
      const CAPR = 10, T = 90;
      let ready = mode === "fixed" ? 6 : 4;
      const pending = [];
      const series = [];
      for (let t = 0; t < T; t++) {
        for (let k = pending.length - 1; k >= 0; k--) if (pending[k].at <= t) { ready += pending[k].n; pending.splice(k, 1); }
        const d = demand(t);
        if (mode !== "fixed") {
          const look = mode === "predictive" ? demand(t + delay) * 1.05 : d * 1.15; // predictive peeks at a forecast
          const want = Math.max(1, Math.ceil(look / CAPR));
          const coming = pending.reduce((a, p) => a + p.n, 0);
          if (want > ready + coming) pending.push({ at: t + delay, n: want - ready - coming });
          else if (want < ready - 1 && !coming) ready = Math.max(want, ready - 1);
        }
        series.push({ t, d, cap: ready * CAPR, rep: ready + pending.reduce((a, p) => a + p.n, 0) });
      }
      return series;
    }
    function draw() {
      const s = run();
      const Wd = 640, Ht = 220, pl = 40, pb = 26;
      const maxY = Math.max(...s.map((p) => Math.max(p.d, p.cap))) * 1.1;
      const x = (t) => pl + (t / 89) * (Wd - pl - 10), y = (v) => 10 + (1 - v / maxY) * (Ht - 10 - pb);
      let g = `<svg viewBox="0 0 ${Wd} ${Ht}" style="min-width:520px;width:100%" role="img" aria-label="Demand versus capacity">`;
      [0, 0.5, 1].forEach((f) => { const v = maxY * f; g += `<line x1="${pl}" x2="${Wd - 10}" y1="${y(v)}" y2="${y(v)}" stroke="var(--rule)"/><text x="${pl - 5}" y="${y(v) + 3}" text-anchor="end" font-size="9.5" fill="var(--ink-soft)">${v.toFixed(0)}</text>`; });
      s.forEach((p) => { if (p.d > p.cap) g += `<rect x="${x(p.t) - 3}" y="${y(p.d)}" width="${(Wd - pl - 10) / 89}" height="${y(p.cap) - y(p.d)}" fill="var(--pencil)" opacity=".35"/>`; });
      g += `<path d="${s.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.cap).toFixed(1)}`).join("")}" fill="none" stroke="var(--accent)" stroke-width="2.5"/>`;
      g += `<path d="${s.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.d).toFixed(1)}`).join("")}" fill="none" stroke="var(--c5)" stroke-width="2"/>`;
      g += `<text x="${pl + 6}" y="22" font-size="10.5" fill="var(--c5)">— demand (req/s)</text><text x="${pl + 120}" y="22" font-size="10.5" fill="var(--accent)">— ready capacity</text><text x="${pl + 240}" y="22" font-size="10.5" fill="var(--pencil)">■ SLA violated</text>`;
      g += `<text x="${pl}" y="${Ht - 6}" font-size="9.5" fill="var(--ink-soft)">00:00</text><text x="${Wd - 10}" y="${Ht - 6}" text-anchor="end" font-size="9.5" fill="var(--ink-soft)">24:00</text></svg>`;
      out.innerHTML = g;
      const viol = s.filter((p) => p.d > p.cap).length;
      const gpuTicks = s.reduce((a, p) => a + p.rep, 0);
      st.innerHTML = stat("Ticks over capacity", viol, viol > 8 ? "bad" : "good") + stat("GPU-ticks paid", gpuTicks) + stat("Peak replicas", Math.max(...s.map((p) => p.rep)));
      if (mode === "predictive" && viol <= 2 && spike) GS.award("planner-pred", 8, "Prediction rode out the spike");
    }
    body.append(h("div", { class: "row", style: { marginBottom: "10px" } },
      seg([["fixed", "Fixed 6 replicas"], ["reactive", "Reactive"], ["predictive", "Predictive"]], mode, (v) => { mode = v; draw(); })),
      slider("Spin-up delay", 1, 10, 1, delay, (v) => { delay = v; draw(); }, (v) => v + " ticks"),
      h("label", { class: "row", style: { margin: "6px 0 8px", fontSize: "14px" } }, (() => { const c = h("input", { type: "checkbox", id: "plSpike", checked: true }); c.onchange = () => { spike = c.checked; draw(); }; return c; })(), "Include a traffic spike at ~15:00"),
      out, st);
    draw();
  };

  /* ===================== Command checklists ===================== */
  GS.checklists = GS.checklists || {};
  W.checklist = function (el, ds) {
    const items = GS.checklists[ds.list] || [];
    const body = frame(el, ds.title || "Checklist", ds.hint || "Tick each step as you run it. Your ticks are saved in this browser.");
    const prog = h("div", { class: "row", style: { marginBottom: "10px" } });
    const list = h("div", { style: { display: "grid", gap: "14px" } });
    function draw() {
      const done = items.filter((it, i) => GS.checks.get(`${ds.list}:${i}`)).length;
      prog.innerHTML = `<span class="pill ${done === items.length ? "good" : "acc"}">${done} / ${items.length} done</span>`;
      if (done === items.length && items.length) GS.award("check-" + ds.list, 10, ds.award || "Checklist complete");
    }
    items.forEach((it, i) => {
      const key = `${ds.list}:${i}`;
      const id = "ck-" + ds.list + "-" + i;
      const cb = h("input", { type: "checkbox", id, checked: GS.checks.get(key) });
      cb.onchange = () => { GS.checks.set(key, cb.checked); draw(); };
      const row = h("div", { style: { display: "grid", gridTemplateColumns: "24px minmax(0,1fr)", gap: "10px", alignItems: "start" } }, cb,
        h("div", { style: { minWidth: "0" } }, h("label", { for: id, style: { fontWeight: "700", cursor: "pointer" }, text: `${i + 1}. ${it.title}` }),
          it.note ? h("p", { style: { margin: "4px 0 8px", fontSize: "15px", color: "var(--ink-soft)" }, html: it.note }) : null,
          it.cmd ? h("div", { html: GS.code(it.lang || "bash", it.cmd, null, { label: it.where || "terminal", wide: true }) }) : null));
      list.append(row);
    });
    body.append(prog, list);
    draw();
  };

  /* ===================== pytest marker builder ===================== */
  W.markers = function (el) {
    const body = frame(el, "Build a correctly marked test", "Every test needs one marker from each category. Pick them and copy the result. Unmarked tests get pre_merge + gpu_0 added by conftest.py, plus a defaulted marker.");
    const cats = {
      Lifecycle: ["pre_merge", "post_merge", "nightly", "weekly", "release"],
      "Test type": ["unit", "integration", "e2e", "benchmark", "stress", "multimodal", "performance"],
      Hardware: ["gpu_0", "gpu_1", "gpu_2", "gpu_4", "gpu_8", "h100", "k8s", "xpu_1", "xpu_2"],
    };
    const pick = { Lifecycle: "pre_merge", "Test type": "unit", Hardware: "gpu_0" };
    const out = h("div");
    const why = h("p", { class: "muted", style: { fontSize: "14.5px" } });
    const groups = h("div", { style: { display: "grid", gap: "10px" } });
    Object.entries(cats).forEach(([cat, opts]) => {
      groups.append(h("div", {}, h("div", { class: "lbl", style: { marginBottom: "4px" }, text: cat }), seg(opts.map((o) => [o, o]), pick[cat], (v) => { pick[cat] = v; draw(); })));
    });
    function draw() {
      const ms = [pick.Lifecycle, pick["Test type"], pick.Hardware];
      out.innerHTML = GS.code("python", `import pytest

from dynamo.llm import compute_block_hash_for_seq

pytestmark = [
    pytest.mark.${ms[0]},
    pytest.mark.${ms[1]},
    pytest.mark.${ms[2]},
]


def test_shared_prefix_shares_first_block_hash():
    a = list(range(32))
    b = list(range(16)) + [999] * 16
    ha = compute_block_hash_for_seq(a, 16)
    hb = compute_block_hash_for_seq(b, 16)
    assert len(ha) == 2  # 32 tokens / 16 per block
    assert ha[0] == hb[0]  # same first 16 tokens
    assert ha[1] != hb[1]


def test_lora_name_changes_hash():
    tokens = list(range(16))
    base = compute_block_hash_for_seq(tokens, 16)
    lora = compute_block_hash_for_seq(tokens, 16, lora_name="my-adapter")
    assert base != lora`, null, { label: "tests/test_my_first.py (new file you create)", wide: true }) +
        GS.code("bash", `python3 -m pytest -m "${ms.join(" and ")}" tests/test_my_first.py -xvv`, null, { label: "run just this selection", wide: true });
      const notes = [];
      if (pick.Hardware !== "gpu_0" && pick["Test type"] === "unit") notes.push("Unit tests that need a GPU are unusual. Most unit tests should be gpu_0 so they run on the CPU CI job.");
      if (pick.Lifecycle === "pre_merge" && ["benchmark", "stress", "performance"].includes(pick["Test type"])) notes.push("Heavy test types usually belong in nightly or weekly, not pre_merge, so they don't slow every PR.");
      if (pick.Hardware === "gpu_8") notes.push("gpu_8 jobs are scarce. Read .ai/test-model-size-guardrails.md before writing one.");
      why.textContent = notes.join(" ") || "A sensible default: fast, CPU-only, runs on every PR.";
      if (pick.Lifecycle === "pre_merge" && pick["Test type"] === "unit" && pick.Hardware === "gpu_0") GS.award("markers", 4, "You built a properly marked unit test");
    }
    body.append(groups, why, out);
    draw();
  };
})();
