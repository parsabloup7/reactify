/* Reactify: named reactions quiz (static, runs fully in the browser). */
(() => {
  "use strict";

  const DATA = window.REACTIFY_DATA;
  const RX = DATA.reactions;
  const MOLS = DATA.molecules;
  const byId = new Map(RX.map((r, i) => [r.id, i]));

  /* ---------------- Topics (broad groups of tags) ---------------- */
  const TOPICS = {
    "Oxidation": ["oxidation", "epoxidation", "dihydroxylation", "cleavage"],
    "Reduction": ["reduction", "hydrogenation", "deoxygenation"],
    "Rearrangements": ["rearrangement", "sigmatropic", "ring-expansion", "ring-contraction"],
    "Carbonyl & enolates": ["enolate", "carbonyl-addition", "condensation", "conjugate-addition", "acylation", "esterification", "umpolung"],
    "Alkenes & alkynes": ["olefination", "elimination", "alkyne", "cyclopropanation", "addition"],
    "Cross-coupling & organometallics": ["cross-coupling", "organometallic"],
    "Pericyclic & cycloadditions": ["pericyclic", "cycloaddition", "photochemical"],
    "Heterocycles": ["heterocycle"],
    "Aromatic substitution": ["EAS", "formylation"],
    "Nitrogen chemistry": ["amine", "diazo", "nitro", "isocyanide"],
    "Radical": ["radical"],
  };
  const LEVEL_HINTS = {
    adaptive: "Starts gentle and serves trickier look-alike choices as you master each reaction.",
    easy: "Wrong choices are picked from unrelated reactions.",
    medium: "One close look-alike plus two related reactions.",
    hard: "All three wrong choices are the most similar reactions (same class, reagents or substrate).",
  };
  const LEVEL_NAMES = { easy: "Easy", medium: "Medium", hard: "Hard" };

  /* ---------------- Persistent state (this device only) ---------------- */
  const KEY = "reactify:v2";
  const defaults = () => ({
    best: 0,
    day: { count: 0, last: "" },
    totals: { n: 0, c: 0 },
    stats: {},                                 // id -> {n, c, box, t}
    settings: { level: "adaptive", length: 10, topics: [] },
  });
  let S = load();
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = defaults(), v = JSON.parse(raw);
        return { ...d, ...v, settings: { ...d.settings, ...(v.settings || {}) } };
      }
    } catch (_) { /* storage unavailable */ }
    return defaults();
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (_) {} }
  const statOf = (id) => S.stats[id] || { n: 0, c: 0, box: -1, t: 0 };

  /* ---------------- Helpers ---------------- */
  const $ = (s) => document.querySelector(s);
  const el = (tag, attrs = {}, html) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") e.className = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
    }
    if (html != null) e.innerHTML = html;
    return e;
  };
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
  function weightedPick(items, weights) {
    const total = weights.reduce((a, b) => a + b, 0);
    let x = Math.random() * total;
    for (let i = 0; i < items.length; i++) { x -= weights[i]; if (x <= 0) return i; }
    return items.length - 1;
  }
  const today = () => new Date().toLocaleDateString("en-CA");
  const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toLocaleDateString("en-CA"); };
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 1800);
  }
  const inTopics = (rx, topics) => !topics.length || topics.some((tp) => TOPICS[tp].some((tag) => rx.tags.includes(tag)));

  /* ---------------- Reaction scheme rendering ---------------- */
  function molNode([mi, coef]) {
    const wrap = el("div", { class: "mol" });
    if (coef > 1) wrap.appendChild(el("span", { class: "coef" }, String(coef)));
    wrap.insertAdjacentHTML("beforeend", MOLS[mi]);
    return wrap;
  }
  function sideNode(list) {
    const s = el("div", { class: "side" });
    list.forEach((m, i) => {
      if (i) s.appendChild(el("span", { class: "plus" }, "+"));
      s.appendChild(molNode(m));
    });
    return s;
  }
  function schemeNode(rx) {
    const sc = el("div", { class: "scheme" });
    sc.appendChild(sideNode(rx.r));
    const ar = el("div", { class: "arrow" });
    ar.appendChild(el("div", { class: "cond above" }, rx.above.map((t) => `<div>${t}</div>`).join("")));
    ar.appendChild(el("div", { class: "shaft" }));
    ar.appendChild(el("div", { class: "cond below" }, rx.below.map((t) => `<div>${t}</div>`).join("")));
    sc.appendChild(ar);
    sc.appendChild(sideNode(rx.p));
    return sc;
  }
  /* Scale every molecule by the same factor so the scheme fits its box. */
  function fitScheme(host) {
    const svgs = host.querySelectorAll(".mol svg");
    const base = window.innerWidth < 640 ? 0.95 : 1.25;
    const apply = (k) => svgs.forEach((s) => {
      const w = parseFloat(s.getAttribute("width")), h = parseFloat(s.getAttribute("height"));
      s.style.width = (w * k) + "px"; s.style.height = (h * k) + "px";
    });
    apply(base);
    const sc = host.querySelector(".scheme");
    if (!sc) return;
    if (getComputedStyle(sc).flexDirection === "row") {
      let k = base;
      for (let i = 0; i < 3 && sc.scrollWidth > host.clientWidth + 1; i++) {
        k *= host.clientWidth / sc.scrollWidth; apply(Math.max(k, 0.4));
      }
    } else {
      // stacked layout: keep molecules from getting wider than the card
      svgs.forEach((s) => {
        const w = parseFloat(s.style.width);
        if (w > host.clientWidth) { const k = host.clientWidth / w; s.style.width = (w * k) + "px"; s.style.height = (parseFloat(s.style.height) * k) + "px"; }
      });
    }
  }
  function mountScheme(host, rx) {
    host.innerHTML = "";
    host.appendChild(schemeNode(rx));
    fitScheme(host);
  }
  let resizeT;
  window.addEventListener("resize", () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => document.querySelectorAll(".scheme-wrap").forEach((h) => h.firstChild && fitScheme(h)), 120);
  });

  /* ---------------- Question selection (light spaced repetition) ---------------- */
  // Leitner-style boxes: missed (0) and unseen reactions come up most often,
  // well-known ones (high box) rarely.
  const BOX_WEIGHT = { "-1": 3, 0: 6, 1: 3, 2: 1.5, 3: 0.7, 4: 0.35, 5: 0.2 };
  function nextQuestionIndex(pool, recent) {
    const avoid = new Set(recent.slice(-Math.min(8, Math.floor(pool.length / 2))));
    let cands = pool.filter((i) => !avoid.has(i));
    if (!cands.length) cands = pool;
    const w = cands.map((i) => BOX_WEIGHT[statOf(RX[i].id).box] ?? 1);
    return cands[weightedPick(cands, w)];
  }

  /* ---------------- Distractor engine ---------------- */
  // Each reaction carries a precomputed list rx.sim = [[index, score], ...]
  // ranked by "confusability" (class tags, reagents, name family, structure).
  function effectiveLevel(i) {
    const lvl = S.settings.level;
    if (lvl !== "adaptive") return lvl;
    const st = statOf(RX[i].id);
    if (st.box >= 2 || Q.run >= 6) return "hard";
    if (st.box >= 1 || Q.run >= 2 || S.totals.n >= 30) return "medium";
    return "easy";
  }
  function pickDistractors(i, level) {
    const rx = RX[i];
    const used = new Set([rx.name]);
    const out = [];
    const add = (j) => { if (!used.has(RX[j].name)) { used.add(RX[j].name); out.push(j); return true; } return false; };
    const sims = rx.sim.filter(([j]) => RX[j].name !== rx.name);
    const fromSims = (lo, hi, k, sharp) => {
      const pool = sims.slice(lo, hi).filter(([j]) => !used.has(RX[j].name));
      while (k > 0 && pool.length) {
        const idx = weightedPick(pool, pool.map(([, s]) => Math.pow(s, sharp)));
        add(pool[idx][0]); pool.splice(idx, 1); k--;
      }
    };
    if (level === "hard") {
      fromSims(0, 7, 3, 3);
    } else if (level === "medium") {
      fromSims(0, 4, 1, 2);
      fromSims(3, 15, 2, 1);
    }
    // easy (or fill-up): random reactions that are NOT close look-alikes
    const near = new Set(sims.slice(0, level === "easy" ? 10 : 0).map(([j]) => j));
    const rest = shuffle(RX.map((_, j) => j).filter((j) => j !== i && !near.has(j)));
    for (const j of rest) { if (out.length >= 3) break; add(j); }
    return out;
  }

  /* ---------------- Quiz flow ---------------- */
  const Q = { pool: [], recent: [], idx: -1, opts: [], answered: false, n: 0, c: 0, run: 0, len: 10, missed: [], review: false };

  function startRound(review = false) {
    let pool = RX.map((_, i) => i).filter((i) => inTopics(RX[i], S.settings.topics));
    if (review) {
      pool = RX.map((_, i) => i).filter((i) => { const s = statOf(RX[i].id); return s.n > 0 && s.box <= 1 && s.c < s.n; });
      if (!pool.length) { toast("No mistakes to review yet. Nice!"); return; }
    }
    if (pool.length < 1) { toast("No reactions in the selected topics"); return; }
    Object.assign(Q, { pool, recent: [], n: 0, c: 0, run: 0, missed: [], review,
      len: review ? Math.min(pool.length, 20) : S.settings.length });
    show("quiz");
    nextQuestion();
  }

  function nextQuestion() {
    if (Q.len && Q.n >= Q.len) return finishRound();
    const i = nextQuestionIndex(Q.pool, Q.recent);
    Q.recent.push(i);
    Q.idx = i;
    Q.answered = false;
    const level = effectiveLevel(i);
    Q.opts = shuffle([i, ...pickDistractors(i, level)]);

    $("#qCounter").textContent = Q.len ? `${Q.n + 1}/${Q.len}` : `#${Q.n + 1}`;
    $("#progBar").style.width = Q.len ? `${(Q.n / Q.len) * 100}%` : "0%";
    $("#levelBadge").textContent = (S.settings.level === "adaptive" ? "Adaptive · " : "") + LEVEL_NAMES[level];
    $("#runCount").textContent = Q.run;
    mountScheme($("#schemeHost"), RX[i]);

    const box = $("#options");
    box.innerHTML = "";
    Q.opts.forEach((j, k) => {
      const b = el("button", { class: "opt", "data-j": j }, `<span class="num">${k + 1}</span><span>${RX[j].name}</span>`);
      b.addEventListener("click", () => answer(j));
      box.appendChild(b);
    });
    $("#feedback").hidden = true;
    $("#nextRow").hidden = true;
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  }

  function answer(j) {
    if (Q.answered) return;
    Q.answered = true;
    const i = Q.idx, rx = RX[i], ok = j === i;

    // ---- update stats ----
    const st = statOf(rx.id);
    st.n++; if (ok) st.c++;
    st.box = ok ? Math.min((st.box < 0 ? 0 : st.box) + 1, 5) : 0;
    st.t = Date.now();
    S.stats[rx.id] = st;
    S.totals.n++; if (ok) S.totals.c++;
    if (S.day.last !== today()) { S.day.count = S.day.last === yesterday() ? S.day.count + 1 : 1; S.day.last = today(); }
    Q.n++;
    if (ok) { Q.c++; Q.run++; S.best = Math.max(S.best, Q.run); }
    else { Q.run = 0; Q.missed.push(i); }
    save();
    renderDay();

    // ---- UI ----
    document.querySelectorAll(".opt").forEach((b) => {
      const jj = +b.dataset.j;
      b.disabled = true;
      if (jj === i) b.classList.add("correct");
      else if (jj === j) b.classList.add("wrong");
      else b.classList.add("dim");
    });
    $("#runCount").textContent = Q.run;
    $("#progBar").style.width = Q.len ? `${(Q.n / Q.len) * 100}%` : "0%";
    const fb = $("#feedback");
    fb.className = "feedback " + (ok ? "ok" : "bad");
    fb.innerHTML =
      `<div class="verdict">${ok ? "Correct!" : "Not quite. It's the " + rx.name}</div>` +
      `<p>${rx.note}</p>` +
      `<div class="tags">${rx.tags.map((t) => `<span class="tag">${t}</span>`).join("")}</div>` +
      (ok ? "" : `<div class="also"><b>${RX[j].name}</b>, your pick: ${RX[j].note}</div>`);
    fb.hidden = false;
    $("#nextRow").hidden = false;
    $("#nextBtn").textContent = "";
    $("#nextBtn").insertAdjacentHTML("beforeend", (Q.len && Q.n >= Q.len ? "See results" : "Next") + " <kbd>Enter</kbd>");
    $("#nextBtn").focus({ preventScroll: true });
  }

  function finishRound() {
    show("results");
    const pct = Q.n ? Math.round((100 * Q.c) / Q.n) : 0;
    const msg = pct === 100 ? "Flawless! 🎉" : pct >= 80 ? "Great work!" : pct >= 50 ? "Good progress. Keep going!" : "Every miss is a lesson. Try again!";
    $("#resultCard").innerHTML =
      `<div class="big-score">${Q.c}/${Q.n}</div><div class="sub">${pct}% correct · ${msg}</div>`;
    const ml = $("#missedList");
    ml.innerHTML = "";
    const uniq = [...new Set(Q.missed)];
    if (uniq.length) {
      ml.appendChild(el("h3", { class: "section-title" }, `Review what you missed (${uniq.length})`));
      const list = el("div", { class: "browse-list" });
      uniq.forEach((i) => list.appendChild(rxItem(i, true)));
      ml.appendChild(list);
      list.querySelectorAll("details[open] .scheme-wrap").forEach((h) => fitScheme(h));
    }
  }

  /* ---------------- Browse / study ---------------- */
  function masteryDot(id) {
    const s = statOf(id);
    if (s.n === 0) return `<span class="dot"></span>new`;
    const cls = s.box <= 0 ? "m0" : s.box === 1 ? "m1" : s.box === 2 ? "m2" : "m3";
    return `<span class="dot ${cls}"></span>${s.c}/${s.n}`;
  }
  function rxItem(i, open = false) {
    const rx = RX[i];
    const d = el("details", { class: "card rx-item" });
    d.innerHTML = `<summary><span class="nm">${rx.name}</span><span class="mastery">${masteryDot(rx.id)}</span></summary>`;
    const body = el("div", { class: "body" });
    d.appendChild(body);
    const fill = () => {
      if (body.childElementCount) return;
      const host = el("div", { class: "scheme-wrap" });
      body.appendChild(host);
      body.appendChild(el("p", {}, rx.note));
      body.appendChild(el("div", { class: "tags" }, rx.tags.map((t) => `<span class="tag">${t}</span>`).join("")));
      mountScheme(host, rx);
    };
    d.addEventListener("toggle", () => d.open && fill());
    if (open) { d.open = true; requestAnimationFrame(fill); }
    return d;
  }
  function renderBrowse() {
    const q = $("#search").value.trim().toLowerCase();
    const list = $("#browseList");
    list.innerHTML = "";
    const hits = RX.map((_, i) => i)
      .filter((i) => {
        if (!q) return true;
        const rx = RX[i];
        const hay = (rx.name + " " + rx.tags.join(" ") + " " + rx.above.join(" ") + " " + rx.below.join(" ") + " " + rx.note)
          .replace(/<[^>]+>/g, "").toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => RX[a].name.localeCompare(RX[b].name));
    hits.forEach((i) => list.appendChild(rxItem(i)));
    $("#browseCount").textContent = `${hits.length} reaction${hits.length === 1 ? "" : "s"}`;
  }

  /* ---------------- Home ---------------- */
  function renderHome() {
    $("#rxCount").textContent = RX.length;
    const mastered = RX.filter((r) => statOf(r.id).box >= 3).length;
    const acc = S.totals.n ? Math.round((100 * S.totals.c) / S.totals.n) + "%" : "–";
    $("#homeStats").innerHTML = [
      ["🔥 " + S.day.count, "day streak"],
      [S.best, "best run"],
      [acc, "accuracy"],
      [`${mastered}<span class="muted" style="font-size:.9rem">/${RX.length}</span>`, "mastered"],
    ].map(([v, k]) => `<div class="card stat"><div class="v">${v}</div><div class="k">${k}</div></div>`).join("");

    setSeg("#levelSeg", S.settings.level);
    setSeg("#lengthSeg", String(S.settings.length));
    $("#levelHint").textContent = LEVEL_HINTS[S.settings.level];

    const chips = $("#topicChips");
    chips.innerHTML = "";
    const all = el("button", { "aria-pressed": String(!S.settings.topics.length) }, "All");
    all.addEventListener("click", () => { S.settings.topics = []; save(); renderHome(); });
    chips.appendChild(all);
    Object.keys(TOPICS).forEach((tp) => {
      const n = RX.filter((r) => inTopics(r, [tp])).length;
      const b = el("button", { "aria-pressed": String(S.settings.topics.includes(tp)) }, `${tp} <span class="muted">${n}</span>`);
      b.addEventListener("click", () => {
        const t = S.settings.topics;
        S.settings.topics = t.includes(tp) ? t.filter((x) => x !== tp) : [...t, tp];
        save(); renderHome();
      });
      chips.appendChild(b);
    });
    const n = RX.filter((r) => inTopics(r, S.settings.topics)).length;
    $("#topicCount").textContent = `· ${n} reactions`;

    const toReview = RX.filter((r) => { const s = statOf(r.id); return s.n > 0 && s.box <= 1 && s.c < s.n; }).length;
    $("#reviewBtn").textContent = toReview ? `Review mistakes (${toReview})` : "Review mistakes";
    $("#reviewBtn").disabled = !toReview;
    renderDay();
  }
  function renderDay() {
    const alive = S.day.last === today() || S.day.last === yesterday();
    $("#dayStreak").textContent = alive ? S.day.count : 0;
  }
  function setSeg(sel, v) {
    document.querySelectorAll(sel + " button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.v === v)));
  }
  $("#levelSeg").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    S.settings.level = b.dataset.v; save(); renderHome();
  });
  $("#lengthSeg").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    S.settings.length = +b.dataset.v; save(); renderHome();
  });

  /* ---------------- Views & navigation ---------------- */
  let current = "home";
  function show(v) {
    for (const id of ["home", "quiz", "results", "browse"]) $("#" + id).hidden = id !== v;
    current = v;
    if (v === "home") renderHome();
    try { if (location.hash !== "#" + v) history.replaceState(null, "", v === "home" ? location.pathname + location.search : "#" + v); } catch (_) {}
  }
  $("#homeBtn").addEventListener("click", () => show("home"));
  $("#startBtn").addEventListener("click", () => startRound(false));
  $("#reviewBtn").addEventListener("click", () => startRound(true));
  $("#browseBtn").addEventListener("click", () => { show("browse"); renderBrowse(); });
  $("#browseBack").addEventListener("click", () => show("home"));
  $("#search").addEventListener("input", renderBrowse);
  $("#quitBtn").addEventListener("click", () => (Q.n ? finishRound() : show("home")));
  $("#nextBtn").addEventListener("click", nextQuestion);
  $("#againBtn").addEventListener("click", () => startRound(Q.review));
  $("#resultsHomeBtn").addEventListener("click", () => show("home"));
  $("#resetBtn").addEventListener("click", () => {
    if (confirm("Reset all progress and statistics on this device?")) { const st = S.settings; S = defaults(); S.settings = st; save(); renderHome(); toast("Progress reset"); }
  });
  $("#shareBtn").addEventListener("click", async () => {
    const url = location.origin + location.pathname;
    try {
      if (navigator.share) await navigator.share({ title: "Reactify", text: "Can you name these reactions?", url });
      else { await navigator.clipboard.writeText(url); toast("Link copied"); }
    } catch (_) {}
  });

  document.addEventListener("keydown", (e) => {
    if (current !== "quiz" || e.altKey || e.ctrlKey || e.metaKey) return;
    if (!Q.answered && /^[1-4]$/.test(e.key)) { const j = Q.opts[+e.key - 1]; if (j != null) answer(j); }
    else if (Q.answered && (e.key === "Enter" || e.key === " " || e.key === "ArrowRight")) { e.preventDefault(); nextQuestion(); }
  });

  /* ---------------- Theme ---------------- */
  const THEME_KEY = "reactify:theme";
  function applyTheme(t) { if (t) document.documentElement.setAttribute("data-theme", t); else document.documentElement.removeAttribute("data-theme"); }
  try { applyTheme(localStorage.getItem(THEME_KEY)); } catch (_) {}
  $("#themeBtn").addEventListener("click", () => {
    const dark = document.documentElement.getAttribute("data-theme")
      ? document.documentElement.getAttribute("data-theme") === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    const t = dark ? "light" : "dark";
    applyTheme(t);
    try { localStorage.setItem(THEME_KEY, t); } catch (_) {}
  });

  /* ---------------- Boot ---------------- */
  show("home");
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  // expose for debugging in the console
  window.Reactify = { RX, pickDistractors, S: () => S };
})();
