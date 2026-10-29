/* Labs for the foundations chapters: LLMs, GPUs, serving, Rust. */
(function () {
  "use strict";
  const { h, esc, fmt } = GS;
  const W = GS.widgets;

  /* Shared frame for every lab. */
  function frame(el, title, hint) {
    el.classList.add("widget");
    el.innerHTML = "";
    el.append(h("div", { class: "widget-title" }, h("span", { class: "tag", text: "Lab" }), h("h3", { text: title })));
    if (hint) el.append(h("p", { class: "widget-hint", html: hint }));
    const body = h("div", { class: "wbody" });
    el.append(body);
    return body;
  }
  GS.frame = frame;

  function slider(label, min, max, step, value, onInput, fmtv) {
    const id = "s" + Math.random().toString(36).slice(2, 8);
    const val = h("span", { class: "val" });
    const inp = h("input", { type: "range", id, min, max, step, value });
    const show = () => (val.textContent = fmtv ? fmtv(+inp.value) : inp.value);
    inp.addEventListener("input", () => { show(); onInput(+inp.value); });
    show();
    const row = h("div", { class: "slider-row" }, h("label", { class: "lbl", for: id, text: label }), inp, val);
    row.input = inp;
    return row;
  }
  GS.slider = slider;

  function seg(options, value, onChange) {
    const wrap = h("div", { class: "seg", role: "group" });
    const set = (v) => {
      wrap.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === String(v))));
    };
    options.forEach(([v, label]) => {
      const b = h("button", { type: "button", "data-v": v, text: label });
      b.onclick = () => { set(v); onChange(v); };
      wrap.append(b);
    });
    set(value);
    wrap.set = set;
    return wrap;
  }
  GS.seg = seg;

  function stat(k, v, cls) { return `<div class="stat${cls ? " " + cls : ""}"><div class="k">${k}</div><div class="v">${v}</div></div>`; }
  GS.stat = stat;

  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }
  GS.rng = rng;

  /* FNV-1a 32-bit with a seed, used as a stand-in for XXH3 in the hashing labs. */
  function hash32(str, seed) {
    let x = (0x811c9dc5 ^ (seed || 0)) >>> 0;
    for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
    x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d) >>> 0; x ^= x >>> 12;
    return x >>> 0;
  }
  GS.hash32 = hash32;
  const hex = (n) => n.toString(16).padStart(8, "0");
  GS.hex = hex;

  /* ===================== The stack (orientation) ===================== */
  W.stack = function (el) {
    const body = frame(el, "The Dynamo stack, layer by layer", "Click a layer. Each one names the folders you'll find it in.");
    const layers = [
      { k: "k8s", name: "Kubernetes layer", sub: "operator · Helm · gateway", color: "var(--c4)",
        d: "Production deployments run on Kubernetes. A Go operator watches a DynamoGraphDeployment (DGD) resource and creates the frontend, worker and planner pods. You can ignore this layer until you deploy to a cluster.",
        paths: ["deploy/operator", "deploy/helm", "deploy/inference-gateway"] },
      { k: "py", name: "Python components", sub: "frontend · backends · planner · mocker", color: "var(--c1)",
        d: "The processes you launch: python -m dynamo.frontend, python -m dynamo.vllm, python -m dynamo.mocker, the planner and profiler. Mostly thin Python wrappers that configure and call the Rust core, plus engine-specific glue for vLLM, SGLang and TensorRT-LLM.",
        paths: ["components/src/dynamo/frontend", "components/src/dynamo/vllm", "components/src/dynamo/mocker", "components/src/dynamo/planner"] },
      { k: "bind", name: "Python ↔ Rust bindings", sub: "PyO3 · maturin · dynamo._core", color: "var(--c6)",
        d: "A Rust crate compiled into a Python extension module named dynamo._core. Python's DistributedRuntime, make_engine and run_input are Rust objects underneath.",
        paths: ["lib/bindings/python/rust/lib.rs", "lib/bindings/python/src/dynamo/runtime/__init__.py"] },
      { k: "rust", name: "Rust core", sub: "runtime · llm · kv-router · kvbm", color: "var(--c2)",
        d: "Where the heavy lifting lives: the distributed runtime (discovery, transports, pipelines), the LLM layer (HTTP server, tokenization, preprocessing, migration), the KV-aware router and indexer, and the KV block manager.",
        paths: ["lib/runtime", "lib/llm", "lib/kv-router", "lib/kvbm-engine", "lib/tokens", "lib/mocker"] },
      { k: "eng", name: "Inference engines", sub: "vLLM · SGLang · TensorRT-LLM", color: "var(--c5)",
        d: "Separate open-source projects that run the model math on GPUs. Dynamo sits above them: it decides which engine instance gets each request and moves KV cache between them.",
        paths: ["components/src/dynamo/vllm/handlers.py", "components/src/dynamo/sglang", "components/src/dynamo/trtllm"] },
      { k: "hw", name: "Transfer + hardware", sub: "NIXL · NVLink · RDMA · GPUs", color: "var(--c3)",
        d: "NIXL (a sibling repo) moves KV-cache bytes between GPUs, CPU memory and storage over NVLink, InfiniBand/RDMA or PCIe. Below that: the GPUs themselves.",
        paths: ["lib/memory", "lib/kvbm-physical"] },
    ];
    const W0 = 560, LH = 52;
    const svgEl = GS.svg("svg", { viewBox: `0 0 ${W0} ${layers.length * (LH + 8)}`, role: "img", "aria-label": "Stack of Dynamo layers" });
    const panel = h("div", { class: "detail-panel" });
    const nodes = [];
    function select(i) {
      const L = layers[i];
      nodes.forEach((n, j) => n.classList.toggle("sel", i === j));
      panel.innerHTML = `<h4>${esc(L.name)}</h4><p>${esc(L.d)}</p><div class="paths">${L.paths.map((p) => GS.src(p)).join("")}</div>`;
    }
    layers.forEach((L, i) => {
      const y = i * (LH + 8);
      const inset = i * 10;
      const g = GS.svg("g", { class: "node", tabindex: "0", role: "button", "aria-label": L.name });
      g.append(GS.svg("rect", { x: inset + 1, y: y + 1, width: W0 - inset * 2 - 2, height: LH, rx: 9, fill: "var(--paper)", stroke: L.color, "stroke-width": 2 }));
      g.append(GS.svg("rect", { x: inset + 1, y: y + 1, width: 8, height: LH, rx: 3, fill: L.color }));
      g.append(GS.svg("text", { x: inset + 22, y: y + 23, "font-size": 15, "font-weight": 700, fill: "var(--ink)", text: L.name }));
      g.append(GS.svg("text", { x: inset + 22, y: y + 41, "font-size": 11.5, fill: "var(--ink-soft)", text: L.sub }));
      g.addEventListener("click", () => select(i));
      g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(i); } });
      nodes.push(g);
      svgEl.append(g);
    });
    body.append(h("div", { class: "diagram-wrap" }, h("div", { class: "scroll-x" }, svgEl), panel));
    select(3);
  };

  /* ===================== Tokenizer ===================== */
  const VOCAB = (
    "Hello|hello| Hello|,|.|!|?|:|;| the| a| an| is| are| of| to| and| in| on| for| with| that| it| this| be| as| at| by|" +
    " Dyn|amo| Dynamo| GPU|GPU|s| GPUs| token|tok|en|ize|izer|izes| text| model| models| serve| serving| inference|" +
    " un|Un|believ|able| cache| KV| route| router| worker| workers| fast| faster| fastest| very| datacenter| data|center|" +
    " Rust| rust| learn| learning| ing|ing|ed| ed|er|est|ly| prompt| prompts| request| requests| I| you| we| love| my|" +
    " cat| sat| mat| Paris| France| capital| world| World| new| code| codebase| base| read| write| from| scratch| zero|" +
    " first| next| one| two| three| time| once| upon| at|ation| comput| compute| memory| decode| pre|fill| prefill|" +
    " gener|ate| generate| generation| stream| streams| of| what| how| why| does| do| not| can| will| A| The|The|I|" +
    "0|1|2|3|4|5|6|7|8|9| 1| 2| 3| 4| 8| 16| 100| 2026|\n| \n|  |   "
  ).split("|");
  const vocabSet = new Set(VOCAB);
  const maxLen = Math.max(...VOCAB.map((v) => v.length));
  function tokenize(text) {
    const out = [];
    let i = 0;
    while (i < text.length) {
      let piece = null;
      for (let L = Math.min(maxLen, text.length - i); L > 0; L--) {
        const s = text.substr(i, L);
        if (vocabSet.has(s)) { piece = s; break; }
      }
      if (!piece) piece = text[i];
      const known = vocabSet.has(piece);
      out.push({ piece, id: known ? (hash32(piece, 7) % 150000) + 1000 : 3 + piece.charCodeAt(0) % 250, known });
      i += piece.length;
    }
    return out;
  }
  GS.toyTokenize = tokenize;
  W.tokenizer = function (el) {
    const body = frame(el, "Turn text into tokens", "Type anything. Pieces in the toy vocabulary become one token; unknown text falls back to single characters, like a real byte-level tokenizer.");
    const ta = h("textarea", { class: "txt", id: "tokIn", rows: 3, "aria-label": "Text to tokenize" });
    ta.value = "Hello, Dynamo! Unbelievably fast GPUs tokenize text before inference.";
    const chips = h("div", { class: "out-box", "aria-live": "polite" });
    const ids = h("div", { class: "log", style: { marginTop: "10px" } });
    const stats = h("div", { class: "stat-row", style: { marginTop: "12px" } });
    const palette = ["var(--accent-soft)", "var(--good-soft)", "var(--warn-soft)", "var(--pencil-soft)"];
    let awarded = false;
    function run() {
      const toks = tokenize(ta.value);
      chips.innerHTML = toks.map((t, i) =>
        `<span class="chip" style="background:${t.known ? palette[i % 4] : "transparent"};border-color:${t.known ? "transparent" : "var(--pencil)"}">${esc(t.piece.replace(/\n/g, "↵").replace(/ /g, "·"))}<sub>${t.id}</sub></span>`).join("");
      ids.textContent = "[" + toks.map((t) => t.id).join(", ") + "]";
      const chars = ta.value.length;
      const unknown = toks.filter((t) => !t.known).length;
      stats.innerHTML = stat("Characters", chars) + stat("Tokens", toks.length) + stat("Chars / token", toks.length ? (chars / toks.length).toFixed(2) : "–") + stat("Fallback chars", unknown, unknown ? "bad" : "good");
      if (!awarded && toks.length >= 40) { awarded = GS.award("tok-40", 5, "You tokenized a 40-token prompt"); }
    }
    ta.addEventListener("input", run);
    body.append(h("div", { class: "field" }, h("label", { for: "tokIn", text: "Your text" }), ta),
      h("div", { class: "lbl", style: { margin: "12px 0 6px" }, text: "What the tokenizer sees (· = space, red outline = fallback character)" }), chips,
      h("div", { class: "lbl", style: { margin: "12px 0 0" }, text: "What the model actually receives: token IDs" }), ids, stats);
    run();
  };

  /* ===================== Next-token sampling ===================== */
  W.nexttoken = function (el) {
    const body = frame(el, "Predict the next token", "The model outputs a score (logit) for every token. Softmax with temperature turns scores into probabilities. Then we sample.");
    const prompts = {
      paris: { p: "The capital of France is", c: [[" Paris", 9.0], [" a", 5.6], [" the", 5.1], [" located", 4.3], [" not", 3.2], [" Lyon", 2.4]] },
      gpu: { p: "My favorite GPU is the", c: [[" H100", 6.4], [" RTX", 6.1], [" A100", 5.7], [" 4090", 5.5], [" B200", 5.2], [" one", 4.6]] },
      time: { p: "Once upon a", c: [[" time", 11.0], [" midnight", 5.2], [" hill", 4.1], [" star", 3.6]] },
    };
    let key = "paris", T = 1.0, out = "";
    const counts = {};
    const bars = h("div");
    const outBox = h("div", { class: "out-box mono" });
    const formula = h("p", { class: "mono muted", style: { fontSize: "12.5px", margin: "10px 0 0" } });
    let tried = new Set();
    function probs() {
      const cs = prompts[key].c;
      const m = Math.max(...cs.map((c) => c[1] / T));
      const ex = cs.map((c) => Math.exp(c[1] / T - m));
      const s = ex.reduce((a, b) => a + b, 0);
      return cs.map((c, i) => ({ tok: c[0], logit: c[1], p: ex[i] / s }));
    }
    function draw() {
      const ps = probs();
      bars.innerHTML = ps.map((x) => `
        <div style="display:grid;grid-template-columns:110px minmax(0,1fr) 60px 46px;gap:10px;align-items:center;margin:5px 0">
          <span class="mono">${esc(x.tok.replace(/ /g, "·"))}</span>
          <div style="height:16px;background:var(--rule);border-radius:4px;overflow:hidden"><div style="height:100%;width:${(x.p * 100).toFixed(1)}%;background:var(--accent);transition:width .25s"></div></div>
          <span class="mono" style="text-align:right">${(x.p * 100).toFixed(1)}%</span>
          <span class="mono muted" style="text-align:right" title="sampled this many times">${counts[x.tok] ? "×" + counts[x.tok] : ""}</span>
        </div>`).join("");
      outBox.innerHTML = `<span class="muted">${esc(prompts[key].p)}</span><b style="color:var(--accent)">${esc(out)}</b>`;
      formula.textContent = `p(token) = exp(logit / ${T.toFixed(2)}) / Σ exp(logits / ${T.toFixed(2)})`;
    }
    function sample(n) {
      for (let k = 0; k < n; k++) {
        const ps = probs();
        let r = Math.random(), pick = ps[ps.length - 1];
        for (const x of ps) { r -= x.p; if (r <= 0) { pick = x; break; } }
        counts[pick.tok] = (counts[pick.tok] || 0) + 1;
        if (k === n - 1) out = pick.tok;
      }
      draw();
    }
    const sel = h("select", { class: "txt", id: "ntPrompt", "aria-label": "Prompt" },
      ...Object.entries(prompts).map(([k, v]) => h("option", { value: k, text: v.p + " …" })));
    sel.onchange = () => { key = sel.value; out = ""; for (const k in counts) delete counts[k]; draw(); };
    const temp = slider("Temperature", 0.1, 3, 0.05, 1, (v) => {
      T = v; for (const k in counts) delete counts[k]; draw();
      if (v <= 0.2) tried.add("lo"); if (v >= 2.5) tried.add("hi");
      if (tried.size === 2) GS.award("temp-extremes", 5, "You felt both ends of temperature");
    }, (v) => v.toFixed(2));
    body.append(h("div", { class: "row", style: { marginBottom: "10px" } }, sel),
      temp, h("div", { style: { margin: "12px 0" } }, bars),
      h("div", { class: "row" },
        h("button", { class: "btn small primary", type: "button", text: "Sample once", onclick: () => sample(1) }),
        h("button", { class: "btn small", type: "button", text: "Sample ×50", onclick: () => sample(50) }),
        h("button", { class: "btn small ghost", type: "button", text: "Greedy (top-1)", onclick: () => { out = probs().reduce((a, b) => (b.p > a.p ? b : a)).tok; draw(); } })),
      h("div", { style: { marginTop: "12px" } }, outBox), formula);
    draw();
  };

  /* ===================== Autoregressive generation timeline ===================== */
  W.generate = function (el) {
    const body = frame(el, "Watch a request generate", "Press play. The prompt is processed all at once (prefill), then output tokens appear one per step (decode). Watch the two stopwatches.");
    const answer = " Dynamo routes each request to the GPU that already has most of its prompt cached , so it starts faster .".split(" ").filter(Boolean);
    let promptTokens = 2000, decodeMs = 25, prefillPerTok = 0.06, queueMs = 40;
    const tl = h("div", { class: "scroll-x" });
    const outBox = h("div", { class: "out-box", style: { minHeight: "70px" } });
    const stats = h("div", { class: "stat-row", style: { marginTop: "12px" } });
    let timer = null, t0 = 0, raf = null;
    function plan() {
      const prefill = promptTokens * prefillPerTok;
      return { queue: queueMs, prefill, ttft: queueMs + prefill + decodeMs, n: answer.length };
    }
    function drawStatic(elapsed) {
      const p = plan();
      const total = p.ttft + (p.n - 1) * decodeMs;
      const Wd = 640, sc = (Wd - 20) / total;
      const x = (ms) => 10 + ms * sc;
      let s = `<svg viewBox="0 0 ${Wd} 92" style="min-width:520px;width:100%" role="img" aria-label="Request timeline">`;
      s += `<rect x="${x(0)}" y="20" width="${p.queue * sc}" height="26" fill="var(--rule)"/><text x="${x(0) + 3}" y="62" font-size="10" fill="var(--ink-soft)">queue</text>`;
      s += `<rect x="${x(p.queue)}" y="20" width="${p.prefill * sc}" height="26" fill="var(--c2)" opacity=".85"/><text x="${x(p.queue) + 4}" y="37" font-size="11" fill="var(--sheet)" font-weight="700">prefill ${promptTokens} tokens</text>`;
      for (let i = 0; i < p.n; i++) {
        const st = p.queue + p.prefill + i * decodeMs;
        s += `<rect x="${x(st) + 0.5}" y="20" width="${Math.max(1, decodeMs * sc - 1)}" height="26" fill="var(--accent)" opacity="${(elapsed ?? total) >= st + decodeMs ? 0.9 : 0.25}"/>`;
      }
      s += `<line x1="${x(p.ttft)}" y1="10" x2="${x(p.ttft)}" y2="52" stroke="var(--pencil)" stroke-width="2"/><text x="${x(p.ttft) + 4}" y="14" font-size="10.5" fill="var(--pencil)">first token (TTFT ${p.ttft.toFixed(0)} ms)</text>`;
      if (elapsed != null) s += `<line x1="${x(Math.min(elapsed, total))}" y1="16" x2="${x(Math.min(elapsed, total))}" y2="50" stroke="var(--ink)" stroke-width="2"/>`;
      s += `<text x="${x(p.queue + p.prefill) + 4}" y="62" font-size="10" fill="var(--accent)">decode: 1 token / step (${decodeMs} ms)</text>`;
      s += `<text x="${Wd - 10}" y="84" text-anchor="end" font-size="10" fill="var(--ink-faint)">${total.toFixed(0)} ms total</text></svg>`;
      tl.innerHTML = s;
    }
    function frameAt(elapsed) {
      const p = plan();
      const shown = elapsed < p.ttft ? 0 : Math.min(p.n, 1 + Math.floor((elapsed - p.ttft) / decodeMs));
      outBox.innerHTML = `<span class="muted mono" style="font-size:12px">${elapsed < p.queue ? "waiting in queue…" : elapsed < p.queue + p.prefill ? "prefill: reading the whole prompt in one pass…" : ""}</span> ` +
        answer.slice(0, shown).map((w, i) => `<span class="chip" style="background:${i === shown - 1 ? "var(--hl)" : "var(--accent-soft)"};color:${i === shown - 1 ? "var(--hl-ink)" : "inherit"}">${esc(w)}</span>`).join("");
      stats.innerHTML = stat("Elapsed", `${Math.min(elapsed, p.ttft + (p.n - 1) * decodeMs).toFixed(0)}<small> ms</small>`) +
        stat("TTFT", shown ? `${p.ttft.toFixed(0)}<small> ms</small>` : "…", shown ? "good" : "") +
        stat("ITL", `${decodeMs}<small> ms</small>`) + stat("Tokens out", `${shown}/${p.n}`);
      drawStatic(elapsed);
      return shown >= p.n;
    }
    function play() {
      stop();
      t0 = performance.now();
      const speed = 0.35; // slow motion so you can see it
      const tick = () => {
        const done = frameAt((performance.now() - t0) * speed);
        if (!done) raf = requestAnimationFrame(tick);
        else GS.award("gen-watch", 5, "You watched prefill and decode happen");
      };
      raf = requestAnimationFrame(tick);
    }
    function stop() { if (raf) cancelAnimationFrame(raf); raf = null; clearTimeout(timer); }
    body.append(
      slider("Prompt length", 100, 8000, 100, promptTokens, (v) => { promptTokens = v; frameAt(1e9); }, (v) => v + " tok"),
      slider("Decode step", 5, 80, 1, decodeMs, (v) => { decodeMs = v; frameAt(1e9); }, (v) => v + " ms"),
      h("div", { class: "row", style: { margin: "12px 0" } },
        h("button", { class: "btn small primary", type: "button", text: "▶ Play in slow motion", onclick: play }),
        h("span", { class: "muted", style: { fontSize: "14px" }, text: "Longer prompts push out TTFT. Slower decode steps stretch ITL." })),
      tl, outBox, stats);
    frameAt(1e9);
    return stop;
  };

  /* ===================== KV cache: with vs without ===================== */
  W.kvcache = function (el) {
    const body = frame(el, "Why the KV cache exists", "Step the generator forward. Each token needs a Key and Value vector per layer. Toggle the cache and compare how much work each step costs.");
    const words = "The cat sat on the mat because it was warm and quiet".split(" ");
    let n = 4, cache = true, work = { on: 0, off: 0 };
    const vis = h("div", { class: "scroll-x" });
    const stats = h("div", { class: "stat-row", style: { marginTop: "12px" } });
    function costOf(step, withCache) { return withCache ? 1 : step; }
    function recompute() {
      work.on = 0; work.off = 0;
      for (let s = 1; s <= n; s++) { work.on += costOf(s, true); work.off += costOf(s, false); }
    }
    function draw() {
      recompute();
      const cw = 58, Wd = Math.max(560, words.length * cw + 20);
      let s = `<svg viewBox="0 0 ${Wd} 150" style="min-width:${Wd}px;width:100%" role="img" aria-label="Tokens with key and value cells">`;
      for (let i = 0; i < words.length; i++) {
        const x = 10 + i * cw;
        const present = i < n;
        const isNew = i === n - 1;
        const fresh = present && (isNew || !cache);
        s += `<rect x="${x}" y="8" width="${cw - 6}" height="28" rx="6" fill="${present ? (isNew ? "var(--hl)" : "var(--paper)") : "transparent"}" stroke="${present ? "var(--ink)" : "var(--rule)"}" stroke-dasharray="${present ? "" : "4 3"}"/>`;
        s += `<text x="${x + (cw - 6) / 2}" y="27" text-anchor="middle" font-size="11.5" fill="${present ? (isNew ? "var(--hl-ink)" : "var(--ink)") : "var(--ink-faint)"}">${esc(words[i])}</text>`;
        if (present) {
          ["K", "V"].forEach((lab, j) => {
            const y = 48 + j * 34;
            s += `<rect x="${x + 6}" y="${y}" width="${cw - 18}" height="26" rx="5" fill="${fresh ? "var(--pencil)" : "var(--good)"}" opacity="${fresh ? 0.85 : 0.75}"/>`;
            s += `<text x="${x + (cw - 6) / 2}" y="${y + 17}" text-anchor="middle" font-size="11" font-weight="700" fill="var(--sheet)">${lab}${fresh ? " ⟳" : ""}</text>`;
          });
        }
      }
      s += `<text x="10" y="142" font-size="10.5" fill="var(--ink-soft)">red ⟳ = computed this step · green = read from cache</text></svg>`;
      vis.innerHTML = s;
      const big = 4000;
      stats.innerHTML = stat("Tokens so far", n) + stat("This step computes", `${costOf(n, cache)}<small> K/V pairs</small>`, cache ? "good" : "bad") +
        stat("Total, no cache", work.off) + stat("Total, with cache", work.on, "good") +
        stat(`At ${big} tokens`, `${fmt(big * (big + 1) / 2, 1)}<small> vs ${fmt(big, 0)}</small>`);
    }
    const toggle = seg([["on", "KV cache ON"], ["off", "KV cache OFF"]], "on", (v) => { cache = v === "on"; draw(); });
    body.append(h("div", { class: "row", style: { marginBottom: "12px" } }, toggle,
      h("button", { class: "btn small primary", type: "button", text: "Next token →", onclick: () => { if (n < words.length) n++; draw(); if (n === words.length) GS.award("kv-step", 5, "You generated a whole sentence"); } }),
      h("button", { class: "btn small ghost", type: "button", text: "Reset", onclick: () => { n = 4; draw(); } })), vis, stats);
    draw();
  };

  /* ===================== CPU vs GPU paint race ===================== */
  W.cpugpu = function (el) {
    const body = frame(el, "CPU vs GPU: paint the grid", "Each cell is one small calculation. The CPU has 8 fast cores. The GPU has 1,024 slower cores. Press race.");
    const N = 32, cells = N * N;
    let mode = "parallel", raf = null;
    const mk = () => { const c = h("canvas", { width: 256, height: 256, style: { width: "100%", maxWidth: "256px", aspectRatio: "1", border: "1px solid var(--rule)", borderRadius: "8px", background: "var(--paper)" } }); return c; };
    const cpuC = mk(), gpuC = mk();
    const cpuT = h("div", { class: "mono" }), gpuT = h("div", { class: "mono" });
    const verdict = h("p", { class: "muted", style: { fontSize: "15px" } });
    const colorOf = (name) => getComputedStyle(el).getPropertyValue(name).trim() || "#2346d0";
    function paint(ctx, painted, col) {
      ctx.clearRect(0, 0, 256, 256);
      ctx.fillStyle = col;
      const s = 256 / N;
      for (let i = 0; i < painted; i++) ctx.fillRect((i % N) * s + 0.5, Math.floor(i / N) * s + 0.5, s - 1, s - 1);
    }
    // Times in "ticks": CPU core does 1 cell / tick. GPU core does 1 cell / 4 ticks.
    function totals() {
      if (mode === "parallel") return { cpu: cells / 8, gpu: 4 * Math.ceil(cells / 1024) };
      return { cpu: cells, gpu: cells * 4 }; // serial chain: each cell needs the previous one
    }
    function race() {
      if (raf) cancelAnimationFrame(raf);
      const T = totals(), start = performance.now(), tickMs = mode === "parallel" ? 18 : 2.2;
      const cctx = cpuC.getContext("2d"), gctx = gpuC.getContext("2d");
      const a = colorOf("--c2"), b = colorOf("--c1");
      const loop = () => {
        const ticks = (performance.now() - start) / tickMs;
        const cp = Math.min(cells, Math.floor(mode === "parallel" ? ticks * 8 : ticks));
        const gp = Math.min(cells, mode === "parallel" ? (ticks >= 4 ? cells : 0) : Math.floor(ticks / 4));
        paint(cctx, cp, a); paint(gctx, gp, b);
        cpuT.textContent = `CPU · ${cp === cells ? T.cpu + " ticks ✓" : Math.floor(Math.min(ticks, T.cpu)) + " ticks"}`;
        gpuT.textContent = `GPU · ${gp === cells ? T.gpu + " ticks ✓" : Math.floor(Math.min(ticks, T.gpu)) + " ticks"}`;
        if (cp < cells || gp < cells) raf = requestAnimationFrame(loop);
        else {
          verdict.innerHTML = mode === "parallel"
            ? `GPU wins by <b>${(T.cpu / T.gpu).toFixed(0)}×</b>. Every cell is independent, so 1,024 slow cores beat 8 fast ones. Matrix multiplication looks exactly like this.`
            : `CPU wins by <b>${(T.gpu / T.cpu).toFixed(0)}×</b>. Each cell needs the previous result, so only one core can work at a time and per-core speed is all that matters.`;
          GS.award("race-" + mode, 3, mode === "parallel" ? "GPU wins on parallel work" : "CPU wins on serial work");
        }
      };
      raf = requestAnimationFrame(loop);
    }
    const toggle = seg([["parallel", "Independent cells"], ["serial", "Each cell depends on the last"]], mode, (v) => { mode = v; verdict.textContent = ""; race(); });
    body.append(h("div", { class: "row", style: { marginBottom: "12px" } }, toggle, h("button", { class: "btn small primary", type: "button", text: "Race", onclick: race })),
      h("div", { class: "col2" }, h("div", {}, h("div", { class: "lbl", text: "CPU: 8 cores × fast" }), cpuC, cpuT), h("div", {}, h("div", { class: "lbl", text: "GPU: 1,024 cores × slow" }), gpuC, gpuT)), verdict);
    paint(cpuC.getContext("2d"), 0, "#000"); paint(gpuC.getContext("2d"), 0, "#000");
    return () => raf && cancelAnimationFrame(raf);
  };

  /* ===================== VRAM calculator ===================== */
  const MODELS = {
    "qwen3-0.6b": { name: "Qwen3-0.6B", p: 0.6e9, L: 28, kvh: 8, hd: 128 },
    "llama-8b": { name: "Llama-3.1-8B", p: 8.0e9, L: 32, kvh: 8, hd: 128 },
    "llama-70b": { name: "Llama-3.1-70B", p: 70.6e9, L: 80, kvh: 8, hd: 128 },
  };
  const GPUS = {
    "4090": { name: "RTX 4090", gb: 24, bw: 1.0 },
    a100: { name: "A100 80GB", gb: 80, bw: 2.0 },
    h100: { name: "H100 SXM", gb: 80, bw: 3.35 },
    h200: { name: "H200", gb: 141, bw: 4.8 },
    b200: { name: "B200", gb: 192, bw: 8.0 },
  };
  GS.MODELS = MODELS; GS.GPUS = GPUS;
  W.vram = function (el) {
    const body = frame(el, "Will it fit? The GPU memory budget", "Pick a model and a GPU. Weights take a fixed slice; the KV cache grows with context length × concurrent requests. Numbers are approximate and ignore activation and runtime overhead.");
    let m = "llama-8b", g = "h100", wb = 2, kb = 2, ctx = 8192, conc = 16, tp = 1;
    const out = h("div");
    const optSel = (id, opts, val, on) => { const s = h("select", { class: "txt", id }, ...opts.map(([v, t]) => h("option", { value: v, text: t }))); s.value = val; s.onchange = () => on(s.value); return s; };
    function draw() {
      const M = MODELS[m], G = GPUS[g];
      const weights = M.p * wb;
      const kvTok = 2 * M.L * M.kvh * M.hd * kb;
      const kvTotal = kvTok * ctx * conc;
      const cap = G.gb * 1e9 * tp;
      const used = weights + kvTotal;
      const usable = cap * 0.9;
      const fits = used <= usable;
      const maxConc = Math.max(0, Math.floor((usable - weights) / (kvTok * ctx)));
      const decodeCeil = (G.bw * 1e12 * tp) / (weights + kvTok * ctx);
      const pct = (x) => Math.min(100, (x / cap) * 100);
      out.innerHTML = `
        <div style="margin:14px 0 6px" class="lbl">GPU memory: ${tp}× ${esc(G.name)} = ${G.gb * tp} GB</div>
        <div style="position:relative;height:34px;border:1.5px solid var(--ink);border-radius:8px;overflow:hidden;background:var(--paper)">
          <div style="position:absolute;left:0;top:0;bottom:0;width:${pct(weights)}%;background:var(--c4);opacity:.85"></div>
          <div style="position:absolute;left:${pct(weights)}%;top:0;bottom:0;width:${Math.max(0, Math.min(100 - pct(weights), pct(kvTotal)))}%;background:var(--accent);opacity:.75"></div>
          <div style="position:absolute;left:90%;top:-2px;bottom:-2px;border-left:2px dashed var(--pencil)" title="90% usable"></div>
        </div>
        <div class="row" style="margin-top:6px;font-size:13px"><span class="pill" style="border-color:var(--c4)">■ weights ${fmt(weights / 1e9, 1)} GB</span><span class="pill acc">■ KV cache ${fmt(kvTotal / 1e9, 1)} GB</span><span class="pill bad">┆ 90% line</span></div>
        <div class="stat-row" style="margin-top:12px">
          ${stat("Fits?", fits ? "Yes" : "No", fits ? "good" : "bad")}
          ${stat("KV per token", `${fmt(kvTok / 1024, 0)}<small> KiB</small>`)}
          ${stat("KV per request", `${fmt(kvTok * ctx / 1e9, 2)}<small> GB</small>`)}
          ${stat("Max requests at this context", maxConc)}
          ${stat("Decode ceiling, 1 request", `${fmt(decodeCeil, 0)}<small> tok/s</small>`)}
        </div>
        <p class="mono muted" style="font-size:12px;margin-top:10px">KV/token = 2 (K and V) × ${M.L} layers × ${M.kvh} KV heads × ${M.hd} head dim × ${kb} bytes. Decode ceiling = bandwidth ÷ bytes read per step (weights + this request's KV).</p>`;
      if (m === "llama-70b" && fits && conc >= 8) GS.award("fit-70b", 10, "You fit a 70B model with 8+ users");
    }
    const ctxRow = slider("Context length", 9, 17, 1, Math.log2(ctx), (v) => { ctx = 2 ** v; draw(); }, (v) => fmt(2 ** v, 0) + " tok");
    const concRow = slider("Concurrent requests", 0, 8, 1, Math.log2(conc), (v) => { conc = 2 ** v; draw(); }, (v) => String(2 ** v));
    body.append(
      h("div", { class: "col3" },
        h("div", { class: "field" }, h("label", { for: "vrModel", text: "Model" }), optSel("vrModel", Object.entries(MODELS).map(([k, v]) => [k, v.name]), m, (v) => { m = v; draw(); })),
        h("div", { class: "field" }, h("label", { for: "vrGpu", text: "GPU" }), optSel("vrGpu", Object.entries(GPUS).map(([k, v]) => [k, `${v.name} · ${v.gb} GB · ${v.bw} TB/s`]), g, (v) => { g = v; draw(); })),
        h("div", { class: "field" }, h("label", { for: "vrTp", text: "GPUs (tensor parallel)" }), optSel("vrTp", [["1", "1"], ["2", "2"], ["4", "4"], ["8", "8"]], "1", (v) => { tp = +v; draw(); }))),
      h("div", { class: "col2", style: { marginTop: "10px" } },
        h("div", { class: "field" }, h("label", { for: "vrWb", text: "Weight precision" }), optSel("vrWb", [["2", "BF16 · 2 bytes"], ["1", "FP8 · 1 byte"], ["0.5", "FP4 · ½ byte"]], "2", (v) => { wb = +v; draw(); })),
        h("div", { class: "field" }, h("label", { for: "vrKb", text: "KV cache precision" }), optSel("vrKb", [["2", "BF16 · 2 bytes"], ["1", "FP8 · 1 byte"]], "2", (v) => { kb = +v; draw(); }))),
      h("div", { style: { marginTop: "12px" } }, ctxRow, concRow), out);
    draw();
  };

  /* ===================== Batching roofline ===================== */
  W.batching = function (el) {
    const body = frame(el, "Batching: one weight read, many users", "Toy model of Llama-3.1-8B (BF16) decoding on one H100. Each step must read every weight once, plus each request's KV cache. Move the batch size and watch throughput and latency.");
    const P = 8e9, Wb = 16e9, BW = 3.35e12, FL = 989e12, CAP = 80e9 * 0.9, kvTok = 131072;
    let B = 16, ctx = 2048, sla = 50;
    const chart = h("div", { class: "scroll-x" });
    const stats = h("div", { class: "stat-row", style: { marginTop: "10px" } });
    const step = (b) => {
      const mem = (Wb + b * kvTok * ctx) / BW;
      const cmp = (2 * P * b) / FL;
      return { t: Math.max(mem, cmp) * 1000, bound: mem >= cmp ? "memory" : "compute" };
    };
    function draw() {
      const maxB = Math.max(1, Math.floor((CAP - Wb) / (kvTok * ctx)));
      const Wd = 620, Ht = 230, pad = { l: 52, r: 52, t: 14, b: 36 };
      const xs = (b) => pad.l + (Math.log2(b) / 9) * (Wd - pad.l - pad.r);
      const pts = [];
      for (let i = 0; i <= 90; i++) { const b = 2 ** (i / 10); pts.push([b, step(b).t, b / (step(b).t / 1000)]); }
      const maxThr = Math.max(...pts.map((p) => p[2]));
      const maxT = Math.max(...pts.map((p) => p[1]), sla * 1.2);
      const yThr = (v) => pad.t + (1 - v / maxThr) * (Ht - pad.t - pad.b);
      const yT = (v) => pad.t + (1 - v / maxT) * (Ht - pad.t - pad.b);
      let s = `<svg viewBox="0 0 ${Wd} ${Ht}" style="min-width:520px;width:100%" role="img" aria-label="Throughput and latency versus batch size">`;
      for (let k = 0; k <= 9; k += 1) { const x = xs(2 ** k); s += `<line x1="${x}" y1="${pad.t}" x2="${x}" y2="${Ht - pad.b}" stroke="var(--rule)" stroke-width="1"/><text x="${x}" y="${Ht - pad.b + 14}" text-anchor="middle" font-size="10" fill="var(--ink-soft)">${2 ** k}</text>`; }
      s += `<text x="${(Wd) / 2}" y="${Ht - 4}" text-anchor="middle" font-size="10.5" fill="var(--ink-soft)">batch size (concurrent requests)</text>`;
      if (maxB < 512) s += `<rect x="${xs(Math.max(1, maxB))}" y="${pad.t}" width="${Wd - pad.r - xs(Math.max(1, maxB))}" height="${Ht - pad.t - pad.b}" fill="var(--pencil)" opacity=".1"/><text x="${xs(Math.max(1, maxB)) + 4}" y="${pad.t + 12}" font-size="10" fill="var(--pencil)">KV memory full past ${maxB}</text>`;
      s += `<line x1="${pad.l}" y1="${yT(sla)}" x2="${Wd - pad.r}" y2="${yT(sla)}" stroke="var(--pencil)" stroke-dasharray="5 4"/><text x="${Wd - pad.r - 4}" y="${yT(sla) - 4}" text-anchor="end" font-size="10" fill="var(--pencil)">ITL target ${sla} ms</text>`;
      s += `<path d="${pts.map((p, i) => `${i ? "L" : "M"}${xs(p[0]).toFixed(1)},${yThr(p[2]).toFixed(1)}`).join("")}" fill="none" stroke="var(--accent)" stroke-width="2.5"/>`;
      s += `<path d="${pts.map((p, i) => `${i ? "L" : "M"}${xs(p[0]).toFixed(1)},${yT(p[1]).toFixed(1)}`).join("")}" fill="none" stroke="var(--c5)" stroke-width="2.5" stroke-dasharray="1 0"/>`;
      const cur = step(B);
      s += `<circle cx="${xs(B)}" cy="${yThr(B / (cur.t / 1000))}" r="5" fill="var(--accent)"/><circle cx="${xs(B)}" cy="${yT(cur.t)}" r="5" fill="var(--c5)"/>`;
      s += `<text x="${pad.l - 6}" y="${pad.t + 8}" text-anchor="end" font-size="10" fill="var(--accent)">${fmt(maxThr, 0)}</text><text x="${pad.l - 6}" y="${Ht - pad.b}" text-anchor="end" font-size="10" fill="var(--accent)">0</text>`;
      s += `<text x="${Wd - pad.r + 6}" y="${pad.t + 8}" font-size="10" fill="var(--c5)">${maxT.toFixed(0)} ms</text><text x="${Wd - pad.r + 6}" y="${Ht - pad.b}" font-size="10" fill="var(--c5)">0</text>`;
      s += `<text x="${pad.l + 6}" y="${pad.t + 12}" font-size="10.5" fill="var(--accent)">— total tokens/s</text><text x="${pad.l + 6}" y="${pad.t + 26}" font-size="10.5" fill="var(--c5)">— step time (ITL)</text></svg>`;
      chart.innerHTML = s;
      const over = B > maxB, slow = cur.t > sla;
      stats.innerHTML = stat("Step time (ITL)", `${cur.t.toFixed(1)}<small> ms</small>`, slow ? "bad" : "good") +
        stat("Per user", `${fmt(1000 / cur.t, 0)}<small> tok/s</small>`) + stat("Total", `${fmt(B * 1000 / cur.t, 0)}<small> tok/s</small>`) +
        stat("Bound by", cur.bound) + stat("KV fits?", over ? "No" : "Yes", over ? "bad" : "good");
      if (!over && !slow && B >= 128) GS.award("batch-sweet", 8, "You found a big batch that still meets the ITL target");
    }
    body.append(slider("Batch size", 0, 9, 0.1, Math.log2(B), (v) => { B = Math.max(1, Math.round(2 ** v)); draw(); }, (v) => String(Math.max(1, Math.round(2 ** v)))),
      slider("Context per request", 8, 15, 1, Math.log2(ctx), (v) => { ctx = 2 ** v; draw(); }, (v) => fmt(2 ** v, 0) + " tok"),
      slider("ITL target", 10, 120, 5, sla, (v) => { sla = v; draw(); }, (v) => v + " ms"), chart, stats);
    draw();
  };

  /* ===================== Paged vs contiguous KV allocation ===================== */
  W.paged = function (el) {
    const body = frame(el, "Contiguous vs paged KV memory", "Both sides get the same 48 token slots and the same stream of requests. Left reserves the maximum length up front in one contiguous run. Right hands out 4-token blocks only when a request needs them.");
    const SLOTS = 48, MAXLEN = 12, BS = 4;
    let seed = 7, r = rng(seed), nextId = 1, timer = null;
    const colors = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)", "var(--c6)"];
    const mkSide = () => ({ mem: Array(SLOTS).fill(null), reqs: [], queue: [], done: 0 });
    let A = mkSide(), Pg = mkSide();
    const left = h("div"), right = h("div");
    function newReq() { return { id: nextId++, len: 2 + Math.floor(r() * 4), target: 5 + Math.floor(r() * 8), blocks: [] }; }
    function admitContig(S) {
      while (S.queue.length) {
        const q = S.queue[0];
        let start = -1;
        for (let i = 0; i + MAXLEN <= SLOTS; i++) { if (S.mem.slice(i, i + MAXLEN).every((x) => x == null)) { start = i; break; } }
        if (start < 0) break;
        S.queue.shift();
        q.start = start;
        for (let i = 0; i < MAXLEN; i++) S.mem[start + i] = { id: q.id, used: i < q.len };
        S.reqs.push(q);
      }
    }
    function ensureBlocks(S, q) {
      while (q.blocks.length * BS < q.len) {
        const free = [];
        for (let b = 0; b < SLOTS / BS; b++) if (S.mem[b * BS] == null) free.push(b);
        if (!free.length) return false;
        const b = free[Math.floor(r() * free.length)];
        q.blocks.push(b);
        for (let i = 0; i < BS; i++) S.mem[b * BS + i] = { id: q.id, used: false };
      }
      q.blocks.forEach((b, bi) => { for (let i = 0; i < BS; i++) S.mem[b * BS + i] = { id: q.id, used: bi * BS + i < q.len }; });
      return true;
    }
    function admitPaged(S) {
      while (S.queue.length) {
        const q = S.queue[0];
        const need = Math.ceil(q.len / BS);
        const free = S.mem.filter((x, i) => i % BS === 0 && x == null).length;
        if (free < need) break;
        S.queue.shift();
        ensureBlocks(S, q);
        S.reqs.push(q);
      }
    }
    function add() {
      const q = newReq();
      A.queue.push({ ...q, blocks: [] });
      Pg.queue.push({ ...q, blocks: [] });
      admitContig(A); admitPaged(Pg); draw();
    }
    function step() {
      // contiguous: grow inside the reservation
      A.reqs.forEach((q) => { if (q.len < q.target) { q.len++; A.mem[q.start + q.len - 1].used = true; } });
      A.reqs.filter((q) => q.len >= q.target).forEach((q) => { for (let i = 0; i < MAXLEN; i++) A.mem[q.start + i] = null; A.done++; });
      A.reqs = A.reqs.filter((q) => q.len < q.target);
      // paged: grow, allocating a fresh block when crossing a boundary
      Pg.reqs.forEach((q) => { if (q.len < q.target) { q.len++; if (!ensureBlocks(Pg, q)) q.len--; } });
      Pg.reqs.filter((q) => q.len >= q.target).forEach((q) => { q.blocks.forEach((b) => { for (let i = 0; i < BS; i++) Pg.mem[b * BS + i] = null; }); Pg.done++; });
      Pg.reqs = Pg.reqs.filter((q) => q.len < q.target);
      admitContig(A); admitPaged(Pg);
      if (r() < 0.55) add(); else draw();
      if (Pg.done >= 12) GS.award("paged-12", 5, "Paged attention served 12 requests");
    }
    function grid(S, paged) {
      const cell = (x, i) => {
        const brk = paged && i % BS === 0 && i ? "margin-left:4px;" : "";
        if (!x) return `<span style="${brk}display:inline-block;width:22px;height:22px;margin:2px;border-radius:4px;border:1px dashed var(--rule)"></span>`;
        const c = colors[x.id % colors.length];
        return `<span title="request ${x.id}" style="${brk}display:inline-block;width:22px;height:22px;margin:2px;border-radius:4px;background:${x.used ? c : "transparent"};border:2px solid ${c};${x.used ? "" : "opacity:.6;background-image:repeating-linear-gradient(45deg,transparent 0 3px,var(--rule) 3px 5px)"}"></span>`;
      };
      const used = S.mem.filter((x) => x && x.used).length;
      const reserved = S.mem.filter((x) => x && !x.used).length;
      return `<div style="line-height:0">${S.mem.map(cell).join("")}</div>
        <div class="stat-row" style="margin-top:10px">${stat("Running", S.reqs.length)}${stat("Waiting", S.queue.length, S.queue.length ? "bad" : "")}${stat("Wasted slots", reserved, reserved > 10 ? "bad" : "")}${stat("Finished", S.done)}</div>
        <p class="mono muted" style="font-size:12px">${used} slots hold real tokens</p>`;
    }
    function draw() {
      left.innerHTML = `<div class="lbl" style="margin-bottom:6px">CONTIGUOUS · reserve ${MAXLEN} slots per request</div>` + grid(A, false);
      right.innerHTML = `<div class="lbl" style="margin-bottom:6px">PAGED · ${BS}-slot blocks on demand</div>` + grid(Pg, true);
    }
    const auto = h("button", { class: "btn small", type: "button", text: "Auto-run" });
    auto.onclick = () => {
      if (timer) { clearInterval(timer); timer = null; auto.textContent = "Auto-run"; return; }
      timer = setInterval(step, 450); auto.textContent = "Pause";
    };
    body.append(h("div", { class: "row", style: { marginBottom: "12px" } },
      h("button", { class: "btn small primary", type: "button", text: "+ Request", onclick: add }),
      h("button", { class: "btn small", type: "button", text: "Step (every request +1 token)", onclick: step }), auto,
      h("button", { class: "btn small ghost", type: "button", text: "Reset", onclick: () => { A = mkSide(); Pg = mkSide(); r = rng(++seed); nextId = 1; for (let i = 0; i < 3; i++) add(); } })),
      h("div", { class: "col2" }, left, right),
      h("p", { class: "muted", style: { fontSize: "14px" }, html: "Striped cells are reserved but empty. That's memory the contiguous allocator can't give to anyone else." }));
    for (let i = 0; i < 4; i++) add();
    return () => timer && clearInterval(timer);
  };

  /* ===================== Block hashing and prefix reuse ===================== */
  W.blockhash = function (el) {
    const body = frame(el, "Hash blocks, find shared prefixes", "Each word is one token here. Tokens are cut into fixed-size blocks; each full block gets a local hash, chained with its parent into a sequence hash. Matching sequence hashes = reusable KV cache.");
    const presets = {
      shared: ["You are a helpful assistant for GPU questions . Explain what a KV cache is in one sentence .",
        "You are a helpful assistant for GPU questions . Explain why decode is memory bound please ."],
      shifted: ["You are a helpful assistant . Explain what a KV cache is in one sentence .",
        "Hi ! Explain what a KV cache is in one sentence . You are a helpful assistant ."],
      chat: ["system : be brief . user : what is Dynamo ? assistant : an inference orchestrator .",
        "system : be brief . user : what is Dynamo ? assistant : an inference orchestrator . user : and NIXL ?"],
    };
    let bs = 4;
    const ta1 = h("textarea", { class: "txt", id: "bh1", rows: 2, "aria-label": "Request A" });
    const ta2 = h("textarea", { class: "txt", id: "bh2", rows: 2, "aria-label": "Request B" });
    [ta1.value, ta2.value] = presets.shared;
    const out = h("div", { style: { marginTop: "12px" } });
    function blocks(text) {
      const toks = text.trim().split(/\s+/).filter(Boolean);
      const res = [];
      let parent = null;
      for (let i = 0; i + bs <= toks.length; i += bs) {
        const chunk = toks.slice(i, i + bs);
        const local = hash32(chunk.join("\u0001"), 1337);
        const seq = parent == null ? local : hash32(hex(parent) + ":" + hex(local), 1337);
        res.push({ chunk, local, seq });
        parent = seq;
      }
      const rest = toks.slice(res.length * bs);
      return { res, rest };
    }
    function row(label, B, otherSeqs, otherLocals) {
      let hits = 0, broken = false;
      const cards = B.res.map((b, i) => {
        const hit = !broken && otherSeqs.has(b.seq);
        if (hit) hits++; else broken = true;
        const trap = !hit && otherLocals.has(b.local);
        return `<div style="flex:none;width:168px;border:1.5px solid ${hit ? "var(--good)" : trap ? "var(--warn)" : "var(--rule)"};background:${hit ? "var(--good-soft)" : trap ? "var(--warn-soft)" : "var(--paper)"};border-radius:9px;padding:8px">
          <div class="mono" style="font-size:11px;color:var(--ink-faint)">block ${i}${hit ? " · <b style='color:var(--good)'>CACHE HIT</b>" : trap ? " · <b style='color:var(--warn)'>same words, new prefix</b>" : ""}</div>
          <div style="font-size:13.5px;margin:4px 0 6px;min-height:2.6em">${esc(b.chunk.join(" "))}</div>
          <div class="mono" style="font-size:11px">local ${hex(b.local)}</div>
          <div class="mono" style="font-size:11px;font-weight:600">seq&nbsp;&nbsp; ${hex(b.seq)}</div></div>`;
      }).join("");
      const tail = B.rest.length ? `<div style="flex:none;width:140px;border:1.5px dashed var(--rule);border-radius:9px;padding:8px"><div class="mono" style="font-size:11px;color:var(--ink-faint)">partial block</div><div style="font-size:13.5px;margin-top:4px">${esc(B.rest.join(" "))}</div><div class="mono muted" style="font-size:11px;margin-top:6px">not hashed until full</div></div>` : "";
      return { html: `<div class="lbl" style="margin:10px 0 6px">${label}</div><div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:6px">${cards}${tail}</div>`, hits };
    }
    function draw() {
      const A = blocks(ta1.value), B = blocks(ta2.value);
      const aSeq = new Set(A.res.map((b) => b.seq)), aLoc = new Set(A.res.map((b) => b.local));
      const rA = row("Request A (already cached on a worker)", A, new Set(), new Set());
      const rB = row("Request B (arriving now): blocks matched against A", B, aSeq, aLoc);
      const tot = B.res.length * bs + B.rest.length;
      out.innerHTML = rA.html + rB.html + `<div class="stat-row" style="margin-top:8px">${stat("Blocks reused", `${rB.hits}<small> / ${B.res.length}</small>`, rB.hits ? "good" : "")}${stat("Prefill skipped", `${rB.hits * bs}<small> of ${tot} tokens</small>`, rB.hits ? "good" : "")}${stat("Block size", bs)}</div>`;
      if (rB.hits >= 3) GS.award("hash-3", 5, "Three blocks reused from cache");
    }
    [ta1, ta2].forEach((t) => t.addEventListener("input", draw));
    const pre = seg([["shared", "Shared system prompt"], ["shifted", "Same words, shifted"], ["chat", "Multi-turn chat"]], "shared", (v) => { [ta1.value, ta2.value] = presets[v]; draw(); });
    body.append(h("div", { class: "row", style: { marginBottom: "10px" } }, pre),
      h("div", { class: "col2" }, h("div", { class: "field" }, h("label", { for: "bh1", text: "Request A" }), ta1), h("div", { class: "field" }, h("label", { for: "bh2", text: "Request B" }), ta2)),
      h("div", { style: { marginTop: "10px" } }, slider("Block size (tokens)", 2, 8, 1, bs, (v) => { bs = v; draw(); })), out,
      h("p", { class: "mono muted", style: { fontSize: "12px" }, text: "Toy 32-bit hash for display. Dynamo uses 64-bit XXH3 with seed 1337 (lib/kv-router/src/protocols.rs)." }));
    draw();
  };

  /* ===================== Aggregated vs disaggregated simulation ===================== */
  W.disagg = function (el) {
    const body = frame(el, "Aggregated vs disaggregated, same two GPUs", "A small discrete-time simulation. Left: two GPUs that each do prefill and decode. Right: one prefill GPU and one decode GPU, with a KV transfer between them. Watch the decode step times.");
    let rate = 3, plen = 3000, olen = 120, seed = 11;
    const PRE = 0.04, DEC0 = 14, DECB = 0.12, XFER = 6; // ms per prompt token, base decode step, per-seq decode cost, NIXL transfer
    const out = h("div");
    function arrivals() {
      const r = rng(seed), list = [];
      let t = 0;
      while (t < 20000) { t += -Math.log(1 - r()) / rate * 1000; list.push({ t, p: Math.round(plen * (0.5 + r())), o: olen }); }
      return list;
    }
    function simAgg(reqs) {
      const gpus = [0, 1].map(() => ({ t: 0, run: [], wait: [], steps: [] }));
      reqs.forEach((q, i) => gpus[i % 2].wait.push({ ...q }));
      const res = [];
      gpus.forEach((g) => {
        let guard = 0;
        while ((g.wait.length || g.run.length) && guard++ < 100000) {
          const arrived = g.wait.filter((q) => q.t <= g.t);
          if (!arrived.length && !g.run.length) { g.t = g.wait[0].t; continue; }
          g.wait = g.wait.filter((q) => q.t > g.t);
          const pf = arrived.reduce((a, q) => a + q.p, 0);
          const dur = DEC0 + DECB * g.run.length + pf * PRE;
          g.t += dur;
          if (g.run.length) g.steps.push([g.t, dur]);
          g.run.forEach((q) => { q.left--; });
          arrived.forEach((q) => { q.left = q.o - 1; q.ttft = g.t - q.t; res.push(q); });
          g.run = g.run.filter((q) => q.left > 0).concat(arrived);
        }
      });
      return { res, steps: gpus[0].steps.concat(gpus[1].steps).sort((a, b) => a[0] - b[0]) };
    }
    function simDis(reqs) {
      let pt = 0;
      const ready = [];
      reqs.forEach((q) => {
        const start = Math.max(pt, q.t);
        pt = start + q.p * PRE;
        ready.push({ ...q, readyAt: pt + XFER });
      });
      const d = { t: 0, run: [], steps: [] };
      const res = [];
      let i = 0, guard = 0;
      while ((i < ready.length || d.run.length) && guard++ < 200000) {
        if (!d.run.length && i < ready.length && ready[i].readyAt > d.t) d.t = ready[i].readyAt;
        const join = [];
        while (i < ready.length && ready[i].readyAt <= d.t) join.push(ready[i++]);
        const dur = DEC0 + DECB * (d.run.length + join.length);
        d.t += dur;
        if (d.run.length) d.steps.push([d.t, dur]);
        d.run.forEach((q) => q.left--);
        join.forEach((q) => { q.left = q.o - 1; q.ttft = d.t - q.t; res.push(q); });
        d.run = d.run.filter((q) => q.left > 0).concat(join);
      }
      return { res, steps: d.steps };
    }
    const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
    function chart(steps, maxY, color, title) {
      const Wd = 300, Ht = 150, pl = 34, pb = 20;
      const x = (t) => pl + (t / 20000) * (Wd - pl - 6), y = (v) => 8 + (1 - v / maxY) * (Ht - 8 - pb);
      let s = `<svg viewBox="0 0 ${Wd} ${Ht}" style="width:100%" role="img" aria-label="${esc(title)}">`;
      [0, 0.5, 1].forEach((f) => { const v = maxY * f; s += `<line x1="${pl}" x2="${Wd - 6}" y1="${y(v)}" y2="${y(v)}" stroke="var(--rule)"/><text x="${pl - 4}" y="${y(v) + 3}" text-anchor="end" font-size="9" fill="var(--ink-soft)">${v.toFixed(0)}</text>`; });
      s += `<text x="${pl}" y="${Ht - 4}" font-size="9" fill="var(--ink-soft)">0 s</text><text x="${Wd - 6}" y="${Ht - 4}" text-anchor="end" font-size="9" fill="var(--ink-soft)">20 s</text>`;
      steps.forEach(([t, d]) => { if (t <= 20000) s += `<line x1="${x(t).toFixed(1)}" x2="${x(t).toFixed(1)}" y1="${y(0)}" y2="${y(Math.min(d, maxY)).toFixed(1)}" stroke="${color}" stroke-width="1.2" opacity=".7"/>`; });
      return s + `</svg>`;
    }
    function draw() {
      const reqs = arrivals();
      const A = simAgg(reqs), D = simDis(reqs);
      const aI = A.steps.map((s) => s[1]), dI = D.steps.map((s) => s[1]);
      const aT = A.res.map((q) => q.ttft), dT = D.res.map((q) => q.ttft);
      const maxY = Math.max(pct(aI, 0.995), pct(dI, 0.995), 30);
      const box = (name, R, I, T, color, extra) => `
        <div><div class="lbl" style="margin-bottom:4px">${name}</div>
        ${chart(R.steps, maxY, color, name + " decode step durations")}
        <div class="lbl" style="margin:2px 0 8px;font-size:11px">each line = one decode step, height = how long every streaming user waited for their next token (ms)</div>
        <div class="stat-row">${stat("TTFT avg", `${fmt(T.reduce((a, b) => a + b, 0) / Math.max(1, T.length), 0)}<small> ms</small>`)}${stat("ITL p50", `${pct(I, 0.5).toFixed(0)}<small> ms</small>`)}${stat("ITL p99", `${pct(I, 0.99).toFixed(0)}<small> ms</small>`, pct(I, 0.99) > 60 ? "bad" : "good")}</div>${extra || ""}</div>`;
      out.innerHTML = `<div class="col2" style="margin-top:12px">${box("AGGREGATED · 2 × (prefill + decode)", A, aI, aT, "var(--c2)")}${box("DISAGGREGATED · 1 prefill + 1 decode", D, dI, dT, "var(--accent)")}</div>
        <p class="muted" style="font-size:14.5px;margin-top:10px">${reqs.length} requests in 20 s. ${pct(aI, 0.99) > pct(dI, 0.99) * 1.5 ? "Notice the tall spikes on the left: every time a long prompt lands, every user decoding on that GPU stalls." : "Try longer prompts or a higher arrival rate to see prefill interference."} ${
        (dT.reduce((a, b) => a + b, 0) / Math.max(1, dT.length)) > (aT.reduce((a, b) => a + b, 0) / Math.max(1, aT.length)) * 1.3 ? "Meanwhile disaggregated TTFT is higher: one prefill GPU is a queue. Real deployments pick the prefill:decode ratio to balance this, which is the Planner's job." : ""}</p>`;
      if (pct(aI, 0.99) > 3 * pct(dI, 0.99)) GS.award("disagg-spike", 8, "You caught prefill interference in the act");
    }
    body.append(slider("Arrival rate", 0.5, 8, 0.5, rate, (v) => { rate = v; draw(); }, (v) => v + " req/s"),
      slider("Prompt length", 200, 8000, 100, plen, (v) => { plen = v; draw(); }, (v) => "~" + fmt(v, 1) + " tok"),
      slider("Output length", 20, 400, 10, olen, (v) => { olen = v; draw(); }, (v) => v + " tok"),
      h("div", { class: "row", style: { marginTop: "8px" } }, h("button", { class: "btn small", type: "button", text: "New random traffic", onclick: () => { seed++; draw(); } }),
        h("span", { class: "mono muted", style: { fontSize: "12px" }, text: `toy costs: prefill ${PRE} ms/token · decode step ${DEC0} ms + ${DECB} ms/request · KV transfer ${XFER} ms` })), out);
    draw();
  };

  /* ===================== Will it compile? ===================== */
  W.borrow = function (el) {
    const body = frame(el, "Will it compile?", "Read each snippet and call it. Every one of these mistakes has a real cousin somewhere in a Dynamo PR review.");
    const cards = [
      { code: `let s = String::from("hi");\nlet t = s;\nprintln!("{}", s);`, ok: false, why: "<code>let t = s;</code> moves the String into <code>t</code>. <code>s</code> is no longer valid. Fix: <code>let t = s.clone();</code> or borrow with <code>&s</code>." },
      { code: `let s = String::from("hi");\nlet t = &s;\nprintln!("{} {}", s, t);`, ok: true, why: "Any number of shared borrows (<code>&T</code>) can coexist with the owner reading the value." },
      { code: `let mut v = vec![1, 2];\nlet first = &v[0];\nv.push(3);\nprintln!("{}", first);`, ok: false, why: "<code>push</code> needs <code>&mut v</code> while <code>first</code> still borrows it. Pushing might reallocate the Vec and leave <code>first</code> dangling. The borrow checker stops it." },
      { code: `let a = Arc::new(Config::default());\nlet b = a.clone();\nstd::thread::spawn(move || use_config(&b));\nuse_config(&a);`, ok: true, why: "<code>Arc::clone</code> copies a pointer and bumps an atomic counter. Each thread owns its own <code>Arc</code>. This is the pattern you'll see everywhere in Dynamo." },
      { code: `let r = Rc::new(5);\nstd::thread::spawn(move || println!("{}", r));`, ok: false, why: "<code>Rc</code> uses a non-atomic counter, so it isn't <code>Send</code>. Threads (and tokio tasks) need <code>Arc</code>." },
      { code: `fn longest(a: &str, b: &str) -> &str {\n    if a.len() > b.len() { a } else { b }\n}`, ok: false, why: "The compiler can't tell which input the returned reference borrows from. Fix: <code>fn longest<'a>(a: &'a str, b: &'a str) -> &'a str</code>." },
      { code: `tokio::spawn(async move {\n    let guard = std_mutex.lock().unwrap();\n    fetch_from_worker().await;\n    guard.push(1);\n});`, ok: false, why: "A <code>std::sync::MutexGuard</code> isn't <code>Send</code>, and holding it across <code>.await</code> makes the whole future non-Send, which <code>tokio::spawn</code> rejects. Drop the guard before awaiting, or use <code>tokio::sync::Mutex</code>. Dynamo uses both, plus <code>parking_lot</code> for short critical sections." },
      { code: `fn first_word(s: &String) -> &str {\n    s.split(' ').next().unwrap_or("")\n}`, ok: true, why: "One input reference, so lifetime elision ties the output to it. (Idiomatic Rust takes <code>&str</code> instead of <code>&String</code>; reviewers will mention it.)" },
    ];
    const answers = {};
    const list = h("div", { style: { display: "grid", gap: "12px" } });
    const score = h("div", { class: "row", style: { marginTop: "12px" } });
    function draw() {
      list.innerHTML = "";
      cards.forEach((c, i) => {
        const a = answers[i];
        const card = h("div", { style: { border: "1px solid var(--rule)", borderRadius: "10px", padding: "10px", background: "var(--paper)" } });
        card.innerHTML = `<pre class="mono" style="margin:0 0 8px;font-size:13px;overflow-x:auto;white-space:pre">${GS.highlight("rust", c.code)}</pre>`;
        const row = h("div", { class: "row" });
        [["Compiles", true], ["Error", false]].forEach(([lab, val]) => {
          const b = h("button", { class: "btn small" + (a != null && a === val ? (val === c.ok ? " primary" : "") : " ghost"), type: "button", text: lab, disabled: a != null });
          b.onclick = () => { answers[i] = val; draw(); };
          row.append(b);
        });
        if (a != null) row.append(h("span", { class: "pill " + (a === c.ok ? "good" : "bad"), text: a === c.ok ? "correct" : `it ${c.ok ? "compiles" : "fails"}` }));
        card.append(row);
        if (a != null) card.append(h("p", { style: { margin: "8px 0 0", fontSize: "14.5px" }, html: c.why }));
        list.append(card);
      });
      const n = Object.keys(answers).length, right = Object.entries(answers).filter(([i, v]) => cards[i].ok === v).length;
      score.innerHTML = `<span class="pill acc">${right} / ${n} right</span>${n === cards.length ? `<span class="muted">${right >= 7 ? "The borrow checker fears you." : right >= 5 ? "Solid. Re-read the ones you missed." : "Normal for a rusty start. The explanations are the lesson."}</span>` : ""}`;
      if (n === cards.length) GS.award("borrow-all", right >= 6 ? 10 : 5, `Borrow quiz: ${right}/${cards.length}`);
    }
    body.append(list, score);
    draw();
  };

  /* ===================== Async executor ===================== */
  W.asyncsim = function (el) {
    const body = frame(el, "One thread, many tasks: how .await shares a core", "A single Tokio worker thread runs three tasks. Purple = running on the thread, hatched = waiting on the network, pale = ready but the thread is busy. Toggle a blocking call and watch everyone suffer.");
    let blocking = false;
    const out = h("div", { class: "scroll-x" });
    const stats = h("div", { class: "stat-row", style: { marginTop: "10px" } });
    function tasks() {
      return [
        { name: "HTTP handler: parse request", steps: [["cpu", 1], ["io", 5], ["cpu", 2], ["io", 4], ["cpu", 1]] },
        { name: "Router: wait for indexer", steps: blocking ? [["cpu", 1], ["block", 6], ["cpu", 1]] : [["cpu", 1], ["io", 6], ["cpu", 1]] },
        { name: "Worker stream: forward tokens", steps: [["cpu", 1], ["io", 2], ["cpu", 1], ["io", 2], ["cpu", 1], ["io", 2], ["cpu", 1]] },
      ];
    }
    function simulate() {
      const T = tasks().map((t) => ({ ...t, i: 0, left: t.steps[0][1], wakeAt: 0, done: null, timeline: [] }));
      let t = 0, cur = null;
      const thread = [];
      while (T.some((x) => x.done == null) && t < 80) {
        // wake tasks whose IO finished
        T.forEach((x) => { if (x.done == null && x.steps[x.i][0] === "io" && x.wakeAt <= t && x.waiting) { x.waiting = false; x.i++; if (x.i >= x.steps.length) x.done = t; else x.left = x.steps[x.i][1]; } });
        if (!cur || cur.done != null || cur.waiting) cur = T.find((x) => x.done == null && !x.waiting) || null;
        T.forEach((x) => x.timeline[t] = x.done != null ? "done" : x.waiting ? "wait" : x === cur ? (x.steps[x.i][0] === "block" ? "block" : "run") : "ready");
        thread[t] = cur ? T.indexOf(cur) : -1;
        if (cur) {
          cur.left--; // "block" steps occupy the thread exactly like CPU work
          if (cur.left <= 0) {
            cur.i++;
            if (cur.i >= cur.steps.length) cur.done = t + 1;
            else {
              const [k2, d2] = cur.steps[cur.i];
              if (k2 === "io") { cur.waiting = true; cur.wakeAt = t + 1 + d2; cur = null; }
              else cur.left = d2;
            }
          }
        }
        t++;
      }
      return { T, end: Math.max(...T.map((x) => x.done || t)) };
    }
    function draw() {
      const { T, end } = simulate();
      const cw = 22, lw = 210, Wd = lw + end * cw + 10;
      let s = `<svg viewBox="0 0 ${Wd} ${T.length * 34 + 30}" style="min-width:${Math.min(Wd, 900)}px;width:100%" role="img" aria-label="Task timeline">`;
      s += `<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="var(--paper)"/><line x1="0" y1="0" x2="0" y2="6" stroke="var(--ink-faint)" stroke-width="2"/></pattern></defs>`;
      T.forEach((x, r) => {
        const y = 8 + r * 34;
        s += `<text x="0" y="${y + 16}" font-size="11" fill="var(--ink)">${esc(x.name)}</text>`;
        x.timeline.forEach((st, c) => {
          if (st === "done") return;
          const fill = st === "block" ? "var(--pencil)" : st === "run" ? "var(--c4)" : st === "wait" ? "url(#hatch)" : "var(--accent-soft)";
          s += `<rect x="${lw + c * cw}" y="${y}" width="${cw - 2}" height="24" rx="3" fill="${fill}" stroke="var(--rule)"/>`;
        });
        if (x.done != null) s += `<text x="${lw + x.done * cw + 3}" y="${y + 16}" font-size="11" fill="var(--good)">✓ t=${x.done}</text>`;
      });
      for (let c = 0; c < end; c += 5) s += `<text x="${lw + c * cw}" y="${T.length * 34 + 22}" font-size="9" fill="var(--ink-faint)">${c}</text>`;
      out.innerHTML = s + `</svg>`;
      const avg = T.reduce((a, x) => a + x.done, 0) / T.length;
      stats.innerHTML = stat("All done at", `t = ${end}`) + stat("Avg finish", avg.toFixed(1), blocking ? "bad" : "good") + stat("Thread mode", blocking ? "blocked 6 ticks" : "cooperative", blocking ? "bad" : "good");
      if (blocking) GS.award("async-block", 5, "You saw a blocking call starve the runtime");
    }
    body.append(h("div", { class: "row", style: { marginBottom: "10px" } }, seg([["0", "Router uses .await"], ["1", "Router makes a blocking call"]], "0", (v) => { blocking = v === "1"; draw(); })), out, stats);
    draw();
  };
})();
