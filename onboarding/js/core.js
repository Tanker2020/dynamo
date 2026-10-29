/* Dynamo Ground School: app core.
 * Routing (#lesson-id), progress + XP, quiz engine, glossary tooltips, tiny syntax highlighter.
 * Content files call GS.chapter(...) and GS.lesson(...); widget files fill GS.widgets.
 */
(function () {
  "use strict";

  const REPO = "https://github.com/ai-dynamo/dynamo/blob/main/";
  const STORE_KEY = "dgs-progress-v1";
  const RANKS = [
    [0, "Kepler"],
    [60, "Maxwell"],
    [160, "Pascal"],
    [300, "Volta"],
    [480, "Ampere"],
    [700, "Hopper"],
    [950, "Blackwell"],
  ];
  const XP_LESSON = 20;
  const XP_QUIZ = 5;

  const GS = {
    chapters: [],
    lessons: [],
    widgets: {},
    glossary: {},
    _cleanups: [],
  };
  window.GS = GS;

  /* ---------------- helpers ---------------- */
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  GS.esc = esc;

  GS.h = function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === "class") el.className = v;
        else if (k === "html") el.innerHTML = v;
        else if (k === "text") el.textContent = v;
        else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
        else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
        else el.setAttribute(k, v === true ? "" : v);
      }
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  };

  GS.svg = function svg(tag, attrs, ...kids) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "text") el.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid) el.append(kid);
    return el;
  };

  GS.fmt = function (n, digits = 1) {
    if (!isFinite(n)) return "∞";
    const a = Math.abs(n);
    if (a >= 1e12) return (n / 1e12).toFixed(digits) + "T";
    if (a >= 1e9) return (n / 1e9).toFixed(digits) + "B";
    if (a >= 1e6) return (n / 1e6).toFixed(digits) + "M";
    if (a >= 1e3) return (n / 1e3).toFixed(digits) + "k";
    return n.toFixed(a < 10 && digits ? digits : 0);
  };

  GS.onCleanup = (fn) => GS._cleanups.push(fn);

  /* term(id, label): glossary-linked inline term */
  GS.t = (id, label) => `<span class="term" tabindex="0" data-t="${id}">${label || (GS.glossary[id] && GS.glossary[id].t) || id}</span>`;
  /* repo link */
  GS.src = (path, label) => `<a href="${REPO}${path}" target="_blank" rel="noopener"><code>${esc(label || path)}</code></a>`;

  /* ---------------- tiny highlighter ---------------- */
  const KW = {
    rust: "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while Some None Ok Err",
    python: "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield",
    bash: "if then else fi for do done case esac export source cd echo function in",
    go: "package import func type struct interface return if else for range var const map chan go defer nil true false",
    yaml: "true false null",
    json: "true false null",
  };
  const kwSets = Object.fromEntries(Object.entries(KW).map(([k, v]) => [k, new Set(v.split(" "))]));
  const RX = {
    rust: /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*")|('[a-z_]+\b(?!'))|(\b\d[\d_]*(?:\.\d+)?(?:e\d+)?(?:u8|u16|u32|u64|usize|i32|i64|f32|f64)?\b)|(\b[a-z_][a-z0-9_]*!)|(#!?\[[^\]]*\])|(\b[A-Za-z_][A-Za-z0-9_]*\b)/g,
    python: /(#[^\n]*)|("""[\s\S]*?"""|'''[\s\S]*?'''|f?"(?:\\.|[^"\\])*"|f?'(?:\\.|[^'\\])*')|(@[A-Za-z_][\w.]*)|(\b\d[\d_]*(?:\.\d+)?\b)|(\b[A-Za-z_][A-Za-z0-9_]*\b)/g,
    bash: /((?:^|\s)#[^\n]*)|("(?:\\.|[^"\\])*"|'[^']*')|(\s--?[A-Za-z][\w-]*)|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_][A-Za-z0-9_.-]*\b)/g,
    yaml: /(#[^\n]*)|("(?:\\.|[^"\\])*"|'[^']*')|(^\s*-?\s*[\w./-]+(?=:))|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_][A-Za-z0-9_]*\b)/gm,
    go: /(\/\/[^\n]*)|("(?:\\.|[^"\\])*"|`[^`]*`)|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_][A-Za-z0-9_]*\b)/g,
  };
  function highlight(lang, src) {
    const rx = RX[lang];
    if (!rx) return esc(src);
    const kws = kwSets[lang] || new Set();
    let out = "", last = 0, m;
    rx.lastIndex = 0;
    while ((m = rx.exec(src))) {
      out += esc(src.slice(last, m.index));
      const s = m[0];
      let cls = null;
      if (lang === "rust") {
        if (m[1]) cls = "com"; else if (m[2]) cls = "str"; else if (m[3]) cls = "ty"; else if (m[4]) cls = "num";
        else if (m[5]) cls = "mac"; else if (m[6]) cls = "com";
        else if (m[7]) cls = kws.has(s) ? "kw" : /^[A-Z]/.test(s) ? "ty" : src[m.index + s.length] === "(" ? "fn" : null;
      } else if (lang === "python") {
        if (m[1]) cls = "com"; else if (m[2]) cls = "str"; else if (m[3]) cls = "mac"; else if (m[4]) cls = "num";
        else if (m[5]) cls = kws.has(s) ? "kw" : /^[A-Z]/.test(s) ? "ty" : src[m.index + s.length] === "(" ? "fn" : null;
      } else if (lang === "bash") {
        if (m[1]) cls = "com"; else if (m[2]) cls = "str"; else if (m[3]) cls = "ty"; else if (m[4]) cls = "num";
        else if (m[5]) cls = kws.has(s) ? "kw" : null;
      } else if (lang === "yaml") {
        if (m[1]) cls = "com"; else if (m[2]) cls = "str"; else if (m[3]) cls = "ty"; else if (m[4]) cls = "num";
        else if (m[5]) cls = kws.has(s) ? "kw" : null;
      } else if (lang === "go") {
        if (m[1]) cls = "com"; else if (m[2]) cls = "str"; else if (m[3]) cls = "num";
        else if (m[4]) cls = kws.has(s) ? "kw" : /^[A-Z]/.test(s) ? "ty" : null;
      }
      out += cls ? `<span class="tk-${cls}">${esc(s)}</span>` : esc(s);
      last = m.index + s.length;
      if (s.length === 0) rx.lastIndex++;
    }
    return out + esc(src.slice(last));
  }
  GS.highlight = highlight;

  /* code(lang, src, path?, opts?) → HTML string. Lines ending in "//<<" or "#<<" are highlighted. */
  GS.code = function (lang, src, path, opts = {}) {
    const raw = src.replace(/^\n+|\s+$/g, "");
    const lines = raw.split("\n");
    const marks = [];
    const clean = lines.map((ln, i) => {
      const mm = ln.match(/\s*(\/\/<<|#<<)\s*$/);
      if (mm) { marks.push(i); return ln.slice(0, ln.length - mm[0].length); }
      return ln;
    });
    let html;
    if (!marks.length) html = highlight(lang, clean.join("\n"));
    else {
      // Highlight line by line so a marked line can be wrapped in a block-level span.
      // ann spans are display:block, so they carry their own line break.
      html = clean.map((ln, i) => {
        const inner = highlight(lang, ln);
        if (marks.includes(i)) return `<span class="ann">${inner || " "}</span>`;
        return inner + (i < clean.length - 1 ? "\n" : "");
      }).join("");
    }
    const id = "c" + Math.random().toString(36).slice(2, 8);
    const head = `<div class="code-head"><span class="lang">${lang === "text" ? "out" : lang}</span>${
      path ? `<a href="${REPO}${path.split("#")[0]}" target="_blank" rel="noopener" title="Open on GitHub">${esc(path)}</a>` : opts.label ? `<span>${esc(opts.label)}</span>` : ""
    }<button class="copy" data-copy="${id}">copy</button></div>`;
    return `<div class="codeblock${opts.wide ? " wide" : ""}">${head}<pre id="${id}" data-raw="${esc(clean.join("\n"))}"><code>${html}</code></pre></div>`;
  };

  /* ---------------- persistence ---------------- */
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return Object.assign(blank(), JSON.parse(raw));
    } catch (e) { /* storage blocked: run in memory */ }
    return blank();
  }
  function blank() { return { done: {}, quiz: {}, awards: {}, notes: {}, checks: {}, last: null, theme: null }; }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(GS.state)); } catch (e) { /* ignore */ }
  }
  GS.save = save;

  function xp() {
    const s = GS.state;
    let total = Object.keys(s.done).length * XP_LESSON;
    for (const qs of Object.values(s.quiz)) for (const r of Object.values(qs)) if (r && r.ok) total += XP_QUIZ;
    for (const a of Object.values(s.awards)) total += a;
    return total;
  }
  function rankFor(points) {
    let idx = 0;
    RANKS.forEach(([min], i) => { if (points >= min) idx = i; });
    return { idx, name: RANKS[idx][1], next: RANKS[idx + 1] };
  }

  /* award(id, xp, message): one-time XP for doing something in a widget */
  GS.award = function (id, points, message) {
    if (GS.state.awards[id] != null) return false;
    const before = rankFor(xp()).idx;
    GS.state.awards[id] = points;
    save();
    updateChrome();
    const after = rankFor(xp());
    toast(message || "Nice work", points, after.idx > before ? after.name : null);
    return true;
  };
  GS.checks = {
    get: (k) => !!GS.state.checks[k],
    set: (k, v) => { GS.state.checks[k] = !!v; save(); },
  };

  /* ---------------- registration ---------------- */
  GS.chapter = (c) => GS.chapters.push(c);
  GS.lesson = (l) => GS.lessons.push(l);
  GS.glossaryAdd = (obj) => Object.assign(GS.glossary, obj);

  function lessonsOf(chId) { return GS.lessons.filter((l) => l.ch === chId); }
  function ordered() {
    const out = [];
    GS.chapters.forEach((c) => out.push(...lessonsOf(c.id)));
    return out;
  }

  /* ---------------- chrome ---------------- */
  const $ = (id) => document.getElementById(id);

  function updateChrome() {
    const all = ordered();
    const done = all.filter((l) => GS.state.done[l.id]).length;
    $("progFill").style.width = (all.length ? (done / all.length) * 100 : 0) + "%";
    $("progLabel").innerHTML = `${done}/${all.length}<span class="long"> lessons</span>`;
    const points = xp();
    const r = rankFor(points);
    $("xpVal").textContent = points + " XP";
    $("rankName").textContent = r.name;
    $("rankLevel").textContent = r.idx + 1;
    $("rankChip").title = r.next ? `${r.name} · ${r.next[0] - points} XP to ${r.next[1]}` : `${r.name} · top rank`;
    renderRail();
  }

  function renderRail() {
    const rail = $("rail");
    const cur = currentId();
    const parts = [`<a class="rail-home${cur === "home" ? " active" : ""}" href="#home">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>Course map</a>`];
    GS.chapters.forEach((c) => {
      const ls = lessonsOf(c.id);
      const d = ls.filter((l) => GS.state.done[l.id]).length;
      parts.push(`<div class="chapter"><div class="chapter-head"><span>${c.num}</span><span class="ch-title">${esc(c.title)}</span><span class="ch-count">${d}/${ls.length}</span></div>`);
      ls.forEach((l, i) => {
        const isDone = GS.state.done[l.id];
        parts.push(`<a class="lesson-link${l.id === cur ? " active" : ""}${isDone ? " done" : ""}" href="#${l.id}">
          <span class="dot" aria-hidden="true">${isDone ? "✓" : ""}</span><span>${esc(l.title)}</span><span class="mins">${l.mins}m</span></a>`);
      });
      parts.push(`</div>`);
    });
    rail.innerHTML = parts.join("");
  }

  let toastTimer = null;
  function toast(msg, points, newRank) {
    const el = $("toast");
    el.innerHTML = `${points ? `<span class="xp">+${points} XP</span>` : ""}<span>${esc(msg)}${newRank ? ` · Promoted to ${esc(newRank)}!` : ""}</span>`;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), newRank ? 4200 : 2600);
  }
  GS.toast = toast;

  /* ---------------- routing ---------------- */
  function currentId() {
    const h = (location.hash || "").replace(/^#/, "");
    return h && (h === "home" || GS.lessons.some((l) => l.id === h)) ? h : "home";
  }

  function runCleanups() {
    GS._cleanups.splice(0).forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
  }

  function render() {
    runCleanups();
    hideTip();
    document.body.classList.remove("rail-open");
    $("menuBtn").setAttribute("aria-expanded", "false");
    const id = currentId();
    if (id === "home") renderHome(); else renderLesson(id);
    renderRail();
    window.scrollTo(0, 0);
  }

  function renderHome() {
    const all = ordered();
    const doneCount = all.filter((l) => GS.state.done[l.id]).length;
    const next = all.find((l) => !GS.state.done[l.id]);
    const resume = GS.state.last && GS.lessons.find((l) => l.id === GS.state.last && !GS.state.done[l.id]);
    const target = resume || next || all[0];
    const totalMins = all.reduce((a, l) => a + l.mins, 0);
    const page = $("page");
    page.innerHTML = `
      <section class="hero">
        <div>
          <div class="prompt">you@bench:~/dynamo$ <b>./learn --from-zero</b></div>
          <h1>Learn <span class="swipe">Dynamo</span> from the first token up.<span class="cursor" aria-hidden="true"></span></h1>
          <p class="lede">A hands-on course for engineers who have never touched GPU or model-serving code. You start with what a token is and finish by running a distributed inference stack on your laptop, reading the Rust that powers it.</p>
          <div class="hero-actions">
            <a class="btn primary" href="#${target.id}">${doneCount ? "Continue" : "Start"}: ${esc(target.title)} →</a>
            <button class="btn ghost" id="openGloss" type="button">Browse the glossary</button>
          </div>
          <p class="kbd-hint" style="margin-top:14px">Shortcuts: <kbd>←</kbd> <kbd>→</kbd> previous / next lesson · <kbd>g</kbd> glossary · progress saves in this browser.</p>
        </div>
        <div class="hero-card" aria-label="The path through the course">
          <div class="term-bar"><span>trace · POST /v1/chat/completions</span><b>● live</b></div>
          ${heroDiagram()}
          <div class="hand" style="margin-top:6px">${doneCount ? `${doneCount}/${all.length} lessons done. keep going.` : "every request you will ever trace takes this path"}</div>
        </div>
      </section>
      <div class="stat-row" style="margin-bottom:8px">
        <div class="stat"><div class="k">Chapters</div><div class="v">${GS.chapters.length}</div></div>
        <div class="stat"><div class="k">Lessons</div><div class="v">${all.length}</div></div>
        <div class="stat"><div class="k">Interactive labs</div><div class="v">${countWidgets()}</div></div>
        <div class="stat"><div class="k">Reading time</div><div class="v">${Math.round(totalMins / 60 * 10) / 10}<small> hrs</small></div></div>
      </div>
      <div class="section-label">The route</div>
      <div class="route-map">
        ${GS.chapters.map((c) => {
          const ls = lessonsOf(c.id);
          const d = ls.filter((l) => GS.state.done[l.id]).length;
          const first = ls.find((l) => !GS.state.done[l.id]) || ls[0];
          return `<a class="route-stop" href="#${first.id}">
            <span class="num">CHAPTER ${c.num}</span>
            <h3>${esc(c.title)}</h3>
            <p>${esc(c.blurb)}</p>
            <div class="meter"><i style="width:${(d / ls.length) * 100}%"></i></div>
            <div class="meta"><span>${d}/${ls.length} lessons</span><span>${ls.reduce((a, l) => a + l.mins, 0)} min</span></div>
          </a>`;
        }).join("")}
      </div>
      <div class="section-label">Ranks you can earn</div>
      <div class="row">${RANKS.map(([min, name], i) => `<span class="pill${rankFor(xp()).idx >= i ? " acc" : ""}">${i + 1} · ${esc(name)} · ${min} XP</span>`).join("")}</div>
      <p class="muted" style="margin-top:14px;font-size:15px">You earn XP for finishing lessons (${XP_LESSON}), answering checks correctly on the first try (${XP_QUIZ} each), and hitting goals inside the labs.
      <button class="btn small ghost" id="resetAll" type="button" style="margin-left:6px">Reset my progress</button></p>
      <div id="resetConfirm" hidden class="callout warn" style="margin-top:10px">This clears completed lessons, quiz answers, XP and notes in this browser.
        <div class="row" style="margin-top:8px"><button class="btn small" id="resetYes" type="button">Yes, reset everything</button><button class="btn small ghost" id="resetNo" type="button">Keep my progress</button></div></div>
    `;
    $("openGloss").onclick = () => openDrawer();
    $("resetAll").onclick = () => ($("resetConfirm").hidden = false);
    $("resetNo").onclick = () => ($("resetConfirm").hidden = true);
    $("resetYes").onclick = () => {
      const theme = GS.state.theme;
      GS.state = blank(); GS.state.theme = theme; save(); updateChrome(); render(); toast("Progress reset");
    };
    document.title = "Dynamo Ground School";
  }

  function countWidgets() {
    let n = 0;
    GS.lessons.forEach((l) => { n += (l.labs || 0); });
    return n || Object.keys(GS.widgets).length;
  }

  function heroDiagram() {
    const boxes = [
      ["Client", "curl / app"], ["Frontend", "HTTP + tokenize"], ["Router", "pick a worker"], ["Worker", "GPU engine"],
    ];
    const w = 360, bw = 78, gap = (w - bw * 4) / 3;
    let s = `<svg viewBox="0 0 ${w} 170" role="img" aria-label="Client to Frontend to Router to Worker, with tokens streaming back">`;
    s += `<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--ink-soft)"/></marker></defs>`;
    boxes.forEach(([a, b], i) => {
      const x = i * (bw + gap);
      const fill = i === 3 ? "var(--accent)" : "var(--sheet-2)";
      const ink = i === 3 ? "var(--accent-ink)" : "var(--ink)";
      s += `<rect x="${x + 1}" y="30" width="${bw - 2}" height="58" rx="9" fill="${fill}" stroke="${i === 3 ? "var(--accent)" : "var(--rule-strong)"}" stroke-width="1.5"/>`;
      s += `<text x="${x + bw / 2}" y="56" text-anchor="middle" font-size="12.5" font-weight="700" fill="${ink}">${a}</text>`;
      s += `<text x="${x + bw / 2}" y="73" text-anchor="middle" font-size="9.5" fill="${i === 3 ? "var(--accent-ink)" : "var(--ink-soft)"}">${b}</text>`;
      if (i < 3) s += `<line x1="${x + bw + 3}" y1="50" x2="${x + bw + gap - 3}" y2="50" stroke="var(--ink-soft)" stroke-width="1.5" marker-end="url(#ah)"/>`;
    });
    s += `<path d="M ${w - bw / 2} 92 C ${w - bw / 2} 140, ${bw / 2} 140, ${bw / 2} 92" fill="none" stroke="var(--accent)" stroke-width="2" stroke-dasharray="5 5" marker-end="url(#ah)"><animate attributeName="stroke-dashoffset" from="20" to="0" dur="1s" repeatCount="indefinite"/></path>`;
    s += `<text x="${w / 2}" y="152" text-anchor="middle" font-size="11" fill="var(--accent)">tokens stream back, one at a time</text>`;
    s += `<text x="${w / 2}" y="16" text-anchor="middle" font-size="10.5" fill="var(--ink-faint)">discovery · request plane · event plane</text>`;
    return s + `</svg>`;
  }

  function renderLesson(id) {
    const all = ordered();
    const idx = all.findIndex((l) => l.id === id);
    const L = all[idx];
    const ch = GS.chapters.find((c) => c.id === L.ch);
    const posInCh = lessonsOf(ch.id).indexOf(L) + 1;
    const prev = all[idx - 1], next = all[idx + 1];
    GS.state.last = id; save();
    const body = typeof L.body === "function" ? L.body() : L.body;
    const page = $("page");
    page.innerHTML = `
      <article>
        <header class="lesson-head">
          <div class="crumbs"><span>CHAPTER ${ch.num}</span><span>·</span><b>${esc(ch.title.toUpperCase())}</b><span>·</span><span>LESSON ${posInCh} OF ${lessonsOf(ch.id).length}</span><span>·</span><span>${L.mins} MIN</span></div>
          <h1>${esc(L.title)}</h1>
          <p class="summary">${L.summary}</p>
          ${L.goals ? `<div class="objectives"><h4>By the end you can</h4><ul>${L.goals.map((g) => `<li>${g}</li>`).join("")}</ul></div>` : ""}
        </header>
        <div class="prose">${body}</div>
        ${L.quiz && L.quiz.length ? `<section class="quiz" id="quiz"><h2>Check yourself <span class="pill">${L.quiz.length} question${L.quiz.length > 1 ? "s" : ""}</span></h2><div id="quizBody"></div></section>` : ""}
        <details class="notes"${GS.state.notes[id] ? " open" : ""}><summary>Your field notes for this lesson</summary>
          <textarea id="notesBox" aria-label="Your notes for this lesson" placeholder="Write what clicked, what didn't, and what to look up later. Saved in this browser.">${esc(GS.state.notes[id] || "")}</textarea></details>
        <footer class="lesson-foot">
          ${prev ? `<a class="btn ghost" href="#${prev.id}">← ${esc(prev.title)}</a>` : `<a class="btn ghost" href="#home">← Course map</a>`}
          <button class="btn primary" id="completeBtn" type="button">${GS.state.done[id] ? (next ? `Next: ${esc(next.title)} →` : "Back to the course map") : (next ? "Complete & continue →" : "Complete the course")}</button>
        </footer>
      </article>`;
    document.title = `${L.title} · Dynamo Ground School`;

    // widgets
    page.querySelectorAll("[data-widget]").forEach((el) => {
      const fn = GS.widgets[el.dataset.widget];
      if (!fn) { el.innerHTML = `<p class="muted">Lab "${esc(el.dataset.widget)}" failed to load.</p>`; return; }
      try {
        const cleanup = fn(el, el.dataset);
        if (typeof cleanup === "function") GS.onCleanup(cleanup);
      } catch (e) {
        console.error(e);
        el.innerHTML = `<p class="muted">This lab hit an error: ${esc(e.message)}</p>`;
      }
    });
    if (L.quiz && L.quiz.length) renderQuiz(L);

    const nb = $("notesBox");
    let nt = null;
    nb.addEventListener("input", () => {
      clearTimeout(nt);
      nt = setTimeout(() => { GS.state.notes[id] = nb.value; save(); }, 300);
    });

    $("completeBtn").onclick = () => {
      if (!GS.state.done[id]) {
        const before = rankFor(xp()).idx;
        GS.state.done[id] = Date.now();
        save();
        const after = rankFor(xp());
        toast(next ? `Lesson complete: ${L.title}` : "Course complete. Blackwell-tier. Go ship something.", XP_LESSON, after.idx > before ? after.name : null);
        updateChrome();
      }
      location.hash = next ? next.id : "home";
    };
  }

  function renderQuiz(L) {
    const box = $("quizBody");
    const res = (GS.state.quiz[L.id] = GS.state.quiz[L.id] || {});
    box.innerHTML = "";
    L.quiz.forEach((q, qi) => {
      const r = res[qi];
      const wrap = GS.h("div", { class: "q" });
      wrap.append(GS.h("div", { class: "qtext", html: `${qi + 1}. ${q.q}` }));
      const opts = GS.h("div", { class: "opts", role: "group", "aria-label": `Question ${qi + 1} answers` });
      q.a.forEach((ans, ai) => {
        const b = GS.h("button", { class: "opt", type: "button", html: `<span class="key">${"ABCD"[ai]}</span><span>${ans}</span>` });
        if (r) {
          b.disabled = true;
          if (ai === q.c) b.classList.add("right");
          if (ai === r.picked && !r.ok) b.classList.add("wrong");
        }
        b.onclick = () => {
          const ok = ai === q.c;
          const before = rankFor(xp()).idx;
          res[qi] = { picked: ai, ok };
          save();
          if (ok) {
            const after = rankFor(xp());
            toast("Correct", XP_QUIZ, after.idx > before ? after.name : null);
          }
          updateChrome();
          renderQuiz(L);
        };
        opts.append(b);
      });
      wrap.append(opts);
      if (r) wrap.append(GS.h("div", { class: `why ${r.ok ? "ok" : "no"}`, html: `<b>${r.ok ? "Right." : "Not quite."}</b> ${q.why}` }));
      box.append(wrap);
    });
    const answered = Object.keys(res).length;
    if (answered) {
      const retry = GS.h("button", { class: "btn small ghost", type: "button", style: { marginTop: "12px" }, text: "Clear my answers and retry" });
      retry.onclick = () => { GS.state.quiz[L.id] = {}; save(); updateChrome(); renderQuiz(L); };
      box.append(retry);
    }
  }

  /* ---------------- glossary + tooltips ---------------- */
  function openDrawer(focusId) {
    $("drawer").hidden = false;
    $("drawerScrim").hidden = false;
    renderGloss($("glSearch").value);
    if (focusId) {
      const el = document.getElementById("gl-" + focusId);
      if (el) { el.scrollIntoView({ block: "center" }); el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1600); }
    } else $("glSearch").focus();
  }
  function closeDrawer() { $("drawer").hidden = true; $("drawerScrim").hidden = true; }
  function renderGloss(q) {
    q = (q || "").trim().toLowerCase();
    const items = Object.entries(GS.glossary)
      .filter(([k, v]) => !q || v.t.toLowerCase().includes(q) || v.d.toLowerCase().includes(q))
      .sort((a, b) => a[1].t.localeCompare(b[1].t));
    $("glList").innerHTML = items.length
      ? items.map(([k, v]) => `<div class="gl-item" id="gl-${k}"><dt>${esc(v.t)}</dt><dd>${v.d}</dd></div>`).join("")
      : `<p class="muted">No terms match “${esc(q)}”.</p>`;
  }

  const tip = () => $("tooltip");
  function showTip(el) {
    const g = GS.glossary[el.dataset.t];
    if (!g) return;
    const t = tip();
    t.innerHTML = `<b>${esc(g.t)}</b>${g.d}`;
    t.hidden = false;
    const r = el.getBoundingClientRect();
    const tw = t.offsetWidth, th = t.offsetHeight;
    let x = Math.min(Math.max(8, r.left + r.width / 2 - tw / 2), window.innerWidth - tw - 8);
    let y = r.top - th - 8;
    if (y < 70) y = r.bottom + 8;
    t.style.left = x + "px"; t.style.top = y + "px";
  }
  function hideTip() { const t = tip(); if (t) t.hidden = true; }

  /* ---------------- boot ---------------- */
  GS.boot = function () {
    GS.state = load();
    if (GS.state.theme) document.documentElement.setAttribute("data-theme", GS.state.theme);

    $("menuBtn").onclick = () => {
      const open = document.body.classList.toggle("rail-open");
      $("menuBtn").setAttribute("aria-expanded", String(open));
    };
    $("glossBtn").onclick = () => openDrawer();
    $("drawerClose").onclick = closeDrawer;
    $("drawerScrim").onclick = closeDrawer;
    $("glSearch").oninput = (e) => renderGloss(e.target.value);
    $("rankChip").onclick = () => { location.hash = "home"; };
    $("themeBtn").onclick = () => {
      const root = document.documentElement;
      const cur = root.getAttribute("data-theme") || "dark";
      const nextTheme = cur === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", nextTheme);
      GS.state.theme = nextTheme; save();
    };

    document.addEventListener("mouseover", (e) => { const el = e.target.closest && e.target.closest(".term"); if (el) showTip(el); });
    document.addEventListener("mouseout", (e) => { if (e.target.closest && e.target.closest(".term")) hideTip(); });
    document.addEventListener("focusin", (e) => { if (e.target.classList && e.target.classList.contains("term")) showTip(e.target); });
    document.addEventListener("focusout", (e) => { if (e.target.classList && e.target.classList.contains("term")) hideTip(); });
    document.addEventListener("click", (e) => {
      const term = e.target.closest(".term");
      if (term) { hideTip(); openDrawer(term.dataset.t); return; }
      const cp = e.target.closest("[data-copy]");
      if (cp) {
        const pre = document.getElementById(cp.dataset.copy);
        const text = pre ? pre.dataset.raw : "";
        const done = () => { cp.textContent = "copied"; setTimeout(() => (cp.textContent = "copy"), 1200); };
        try {
          navigator.clipboard.writeText(text).then(done, () => selectText(pre));
        } catch (err) { selectText(pre); }
      }
    });
    window.addEventListener("scroll", hideTip, { passive: true });
    document.addEventListener("keydown", (e) => {
      if (e.target.matches("input, textarea, select, [contenteditable]")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") { closeDrawer(); hideTip(); }
      if (e.key === "g") { e.preventDefault(); openDrawer(); }
      const id = currentId();
      const all = ordered();
      const idx = all.findIndex((l) => l.id === id);
      if (e.key === "ArrowRight") { const n = idx < 0 ? all[0] : all[idx + 1]; if (n) location.hash = n.id; }
      if (e.key === "ArrowLeft") { if (idx > 0) location.hash = all[idx - 1].id; else if (idx === 0) location.hash = "home"; }
    });
    window.addEventListener("hashchange", render);
    updateChrome();
    render();
  };

  function selectText(el) {
    if (!el) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(range);
  }
})();
