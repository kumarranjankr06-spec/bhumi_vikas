const chat = document.getElementById("chat");
const form = document.getElementById("form");
const input = document.getElementById("q");
const sendBtn = document.getElementById("send");
const micBtn = document.getElementById("mic");
const chips = document.querySelectorAll("#chips button");

const PDF_URL = "/static/rules.pdf";
const LABELS = { found: "Found in rules", conflict: "Conflicting rules — check both", not_found: "Not in the rules" };
const BADGE = {
  found: "bg-green-100 text-green-800 ring-green-200",
  conflict: "bg-amber-100 text-amber-800 ring-amber-200",
  not_found: "bg-red-100 text-red-800 ring-red-200",
};

// Builds an element; text goes in via textContent so model output can never inject HTML.
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function add(node) {
  chat.appendChild(node);
  chat.scrollTop = chat.scrollHeight;
  return node;
}

// Markdown (incl. tables) -> sanitized HTML. Falls back to plain text if a CDN failed to load.
function markdown(text) {
  const box = el("div", "md text-sm leading-relaxed");
  if (window.marked && window.DOMPurify) {
    box.innerHTML = DOMPurify.sanitize(marked.parse(text, { gfm: true, breaks: true }));
    box.querySelectorAll("table").forEach((t) => {
      const scroll = el("div", "overflow-x-auto");
      t.replaceWith(scroll);
      scroll.append(t);
    });
  } else {
    box.classList.add("whitespace-pre-wrap");
    box.textContent = text;
  }
  return box;
}

/* ---------- 1. PDF viewer ---------- */

const pdfState = { doc: null, page: 1, zoom: 1, rendering: false, pending: null };
const canvas = document.getElementById("pdfCanvas");
const pdfWrap = document.getElementById("pdfWrap");
const pdfStatus = document.getElementById("pdfStatus");
const pageInput = document.getElementById("pageInput");

async function renderPage(num) {
  pdfState.rendering = true;
  const page = await pdfState.doc.getPage(num);
  const fit = (pdfWrap.clientWidth - 32) / page.getViewport({ scale: 1 }).width;
  const viewport = page.getViewport({ scale: fit * pdfState.zoom });
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * ratio);
  canvas.height = Math.floor(viewport.height * ratio);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  await page.render({
    canvasContext: canvas.getContext("2d"),
    viewport,
    transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null,
  }).promise;
  pdfState.rendering = false;
  pageInput.value = num;
  if (pdfState.pending !== null) {
    const next = pdfState.pending;
    pdfState.pending = null;
    renderPage(next);
  }
}

function showPage(num, highlight = false) {
  if (!pdfState.doc) return console.warn("[pdf] not loaded yet, cannot show page", num);
  num = Math.min(Math.max(1, Number(num) || 1), pdfState.doc.numPages);
  console.log("[pdf] navigating to page", num);
  pdfState.page = num;
  if (pdfState.rendering) pdfState.pending = num;
  else renderPage(num);
  pdfWrap.scrollTop = 0;
  if (highlight) {
    canvas.classList.remove("flash");
    void canvas.offsetWidth; // restart the animation
    canvas.classList.add("flash");
  }
}

function showCitedPages(pages) {
  const bar = document.getElementById("citedPages");
  bar.replaceChildren();
  if (!pages.length) return bar.classList.add("hidden");
  bar.append(el("span", "font-semibold text-gov-800 mr-1", "Cited pages:"));
  for (const p of pages) {
    const b = el("button", "rounded-full bg-white px-2.5 py-0.5 ring-1 ring-gov-100 text-gov-800 hover:bg-gov-100", `p. ${p}`);
    b.type = "button";
    b.onclick = () => showPage(p, true);
    bar.append(b);
  }
  bar.classList.remove("hidden");
}

async function loadPdf() {
  if (!window.pdfjsLib) {
    pdfStatus.textContent = "PDF viewer could not load (no internet?). Use ↗ to open the rulebook.";
    return;
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  try {
    pdfState.doc = await pdfjsLib.getDocument(PDF_URL).promise;
    console.log("[pdf] loaded", PDF_URL, "pages:", pdfState.doc.numPages);
    document.getElementById("pageCount").textContent = pdfState.doc.numPages;
    pageInput.max = pdfState.doc.numPages;
    pdfStatus.remove();
    showPage(1);
  } catch (err) {
    console.error("[pdf] load failed", err);
    pdfStatus.textContent = "Could not load the rulebook PDF: " + err.message;
  }
}

document.getElementById("prev").onclick = () => showPage(pdfState.page - 1);
document.getElementById("next").onclick = () => showPage(pdfState.page + 1);
document.getElementById("zoomIn").onclick = () => { pdfState.zoom = Math.min(3, pdfState.zoom + 0.25); showPage(pdfState.page); };
document.getElementById("zoomOut").onclick = () => { pdfState.zoom = Math.max(0.5, pdfState.zoom - 0.25); showPage(pdfState.page); };
pageInput.onchange = () => showPage(pageInput.value);

let resizeTimer;
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => pdfState.doc && showPage(pdfState.page), 150);
}).observe(pdfWrap);

/* ---------- Answer rendering ---------- */

function renderAnswer(r) {
  const box = el("div", "max-w-[95%] rounded-xl bg-white ring-1 ring-slate-200 px-4 py-3 shadow-sm space-y-3");

  // 4. Amendment alert
  if (r.amendment_alert) {
    box.append(el("div",
      "flex gap-2 rounded-lg border-l-4 border-red-600 bg-gradient-to-r from-red-50 to-amber-50 px-3 py-2 text-sm font-semibold text-red-800",
      "⚠️ Alert: Rule 2(5)(c) was amended on 28 Aug 2026. This answer is based on the older March 2025 rules."));
  }

  const badges = el("div", "flex flex-wrap gap-2");
  badges.append(el("span", `rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${BADGE[r.status]}`, LABELS[r.status]));
  if (r.cached) badges.append(el("span", "rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200", "Saved answer"));
  box.append(badges);

  box.append(el("div", "rounded-md border-l-4 border-gov-700 bg-gov-50 px-3 py-2 text-sm font-semibold text-gov-900 whitespace-pre-wrap", r.clerk_summary));
  box.append(markdown(r.answer)); // 3. tables rendered from Markdown

  if (r.citations.length) {
    const list = el("div", "space-y-2 border-t border-slate-100 pt-3");
    list.append(el("div", "text-xs font-semibold uppercase tracking-wide text-slate-500", "Citations"));
    for (const c of r.citations) {
      const cite = el("div", "rounded-lg bg-slate-50 ring-1 ring-slate-200 p-2.5 text-sm");
      const link = el("button", "font-semibold text-gov-700 hover:underline", `Rule ${c.rule} · PDF page ${c.page} →`);
      link.type = "button";
      link.title = "Show this page in the rulebook panel";
      link.onclick = () => showPage(c.page, true);
      cite.append(link,
        el("blockquote", "my-1.5 border-l-2 border-slate-300 pl-2 font-mono text-xs text-slate-700 whitespace-pre-wrap", c.quote),
        c.verified ? el("small", "text-green-700", "✓ Quote matches the PDF text")
                   : el("small", "text-red-700", "⚠ Quote not matched in PDF text — check the page"));
      list.append(cite);
    }
    box.append(list);
  }
  if (r.notes) box.append(el("div", "rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 whitespace-pre-wrap", r.notes));
  return box;
}

function setBusy(busy) {
  sendBtn.disabled = busy;
  chips.forEach((c) => (c.disabled = busy));
}

async function ask(question) {
  console.log("[ask] sending:", question);
  add(el("div", "ml-auto w-fit max-w-[85%] rounded-xl bg-gov-700 px-4 py-2.5 text-sm text-white shadow-sm whitespace-pre-wrap", question));
  const waiting = add(el("div", "w-fit rounded-xl bg-white ring-1 ring-slate-200 px-4 py-2.5 text-sm text-slate-500 animate-pulse", "Searching the rules…"));
  setBusy(true);
  try {
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Something went wrong");
    console.log("[ask] response:", data);
    console.log("[ask] pdf_pages:", data.pdf_pages, "amendment_alert:", data.amendment_alert, "cached:", data.cached);
    waiting.replaceWith(renderAnswer(data));
    showCitedPages(data.pdf_pages || []);
    if (data.pdf_pages && data.pdf_pages.length) showPage(data.pdf_pages[0], true);
  } catch (err) {
    console.error("[ask] failed:", err);
    waiting.replaceWith(el("div", "w-fit rounded-xl bg-red-50 ring-1 ring-red-200 px-4 py-2.5 text-sm text-red-700", "Error: " + err.message));
  } finally {
    setBusy(false);
    input.focus();
    chat.scrollTop = chat.scrollHeight;
  }
}

function submit(q) {
  q = q.trim();
  if (!q || sendBtn.disabled) return;
  input.value = "";
  ask(q);
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  submit(input.value);
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});

/* ---------- 5. Quick query chips ---------- */

chips.forEach((chip) => chip.addEventListener("click", () => {
  console.log("[chip] clicked:", chip.dataset.q);
  input.value = chip.dataset.q;
  submit(chip.dataset.q);
}));

/* ---------- 2. Hindi voice input ---------- */

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const listening = document.getElementById("listening");
let recognition = null;
let heard = "";

function setListening(on) {
  listening.classList.toggle("hidden", !on);
  listening.classList.toggle("flex", on);
  micBtn.classList.toggle("bg-red-600", on);
  micBtn.classList.toggle("text-white", on);
  micBtn.classList.toggle("shadow-[0_0_14px_rgba(220,38,38,.7)]", on);
  micBtn.textContent = on ? "⏹ Stop" : "🎤 Speak (Hindi)";
}

if (!SpeechRecognition) {
  micBtn.disabled = true;
  micBtn.title = "Voice input needs Google Chrome or Microsoft Edge";
  console.warn("[voice] webkitSpeechRecognition not supported in this browser");
} else {
  micBtn.addEventListener("click", () => {
    if (recognition) return recognition.stop();
    recognition = new SpeechRecognition();
    recognition.lang = "hi-IN";
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    heard = "";

    recognition.onstart = () => { console.log("[voice] listening (hi-IN)…"); setListening(true); };
    recognition.onresult = (e) => {
      const text = Array.from(e.results).map((r) => r[0].transcript).join("");
      input.value = text; // live transcript while speaking
      if (e.results[e.results.length - 1].isFinal) heard = text;
    };
    recognition.onerror = (e) => {
      console.error("[voice] error:", e.error);
      if (e.error === "not-allowed") alert("Microphone permission was denied. Allow the mic for this site and try again.");
    };
    recognition.onend = () => {
      console.log("[voice] stopped, transcript:", heard);
      setListening(false);
      recognition = null;
      if (heard) submit(heard);
    };
    recognition.start();
  });
}

loadPdf();
