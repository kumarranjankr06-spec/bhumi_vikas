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

// The model sometimes writes "Rule 56(1)(a)" and sometimes just "56(1)(a)".
function ruleLabel(rule) {
  return /^\s*(rule|नियम)\b/i.test(rule) ? rule : "Rule " + rule;
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

function renderAnswer(r, question) {
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
      const link = el("button", "font-semibold text-gov-700 hover:underline", `${ruleLabel(c.rule)} · PDF page ${c.page} →`);
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

  const share = el("button", "inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-700", "📱 Send to Citizen");
  share.type = "button";
  share.onclick = () => openWaModal(question, r);
  box.append(share);
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
    waiting.replaceWith(renderAnswer(data, question));
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

/* ---------- Send to Citizen: PDF report + WhatsApp click-to-chat ---------- */

const waModal = document.getElementById("waModal");
const waForm = document.getElementById("waForm");
const waNumber = document.getElementById("waNumber");
const waError = document.getElementById("waError");
const waStatus = document.getElementById("waStatus");
const waSend = document.getElementById("waSend");
const waShare = document.getElementById("waShare");
const PDF_NAME = "BMC_Rule_Query.pdf";
let waItem = null; // { question, r, pdf: Promise<Blob> } of the answer being sent

// WhatsApp links can't carry files; only the OS share sheet (Web Share API) can hand a PDF to the WhatsApp app.
const canShareFiles = !!navigator.canShare &&
  navigator.canShare({ files: [new File(["x"], PDF_NAME, { type: "application/pdf" })] });
console.log("[wa] file sharing supported:", canShareFiles);

function makePdf(question, r) {
  if (!window.html2pdf) return Promise.reject(new Error("PDF library did not load (no internet?)"));
  return html2pdf().set({
    margin: [8, 8, 10, 8],
    image: { type: "jpeg", quality: 0.95 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
    pagebreak: { mode: ["css", "legacy"] },
  }).from(buildReport(question, r)).outputPdf("blob");
}

function downloadBlob(blob, name) {
  const a = el("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

function openWaModal(question, r) {
  // Build the PDF now, so the share sheet can open straight from the click (browsers need a fresh click to share).
  const pdf = makePdf(question, r);
  pdf.then((b) => console.log("[wa] PDF ready:", b.size, "bytes"), (err) => console.error("[wa] PDF failed:", err));
  waItem = { question, r, pdf };
  document.getElementById("waQuestion").textContent = "Q: " + question;
  waNumber.value = "";
  waError.classList.add("hidden");
  waStatus.classList.add("hidden");
  waSend.disabled = false;
  waShare.disabled = false;
  document.getElementById("waShareBox").classList.toggle("hidden", !canShareFiles);
  waModal.classList.replace("hidden", "flex");
  waNumber.focus();
  console.log("[wa] modal opened for:", question);
}

function closeWaModal() {
  waModal.classList.replace("flex", "hidden");
  waItem = null;
}

// Citation rules look like "Rule 56(1)(a) Table, row 1"; keep just "56(1)(a)", once each.
function ruleNumbers(r) {
  const ids = r.citations.map((c) => {
    const m = c.rule.match(/^\s*(?:Rule\s+)?(\d+[A-Z]?(?:\s*\([^)]+\))*)/i);
    return m ? m[1].replace(/\s+/g, "") : c.rule;
  });
  return [...new Set(ids)].map((n) => "Rule " + n).join(", ") || "—";
}

// Inline styles: the report is built off-screen, where Tailwind's CDN may not have generated classes yet.
function buildReport(question, r) {
  const today = new Date();
  const ref = "BMC/BP/" + today.toISOString().slice(0, 10).replaceAll("-", "") + "/" + String(today.getTime()).slice(-5);
  const doc = el("div");
  doc.style.cssText = "width:720px;padding:28px 32px;font:13px/1.55 Inter,system-ui,'Noto Sans Devanagari',sans-serif;color:#1e293b;background:#fff";

  const head = el("div");
  head.style.cssText = "display:flex;align-items:center;gap:14px;padding-bottom:12px;border-bottom:3px solid #0e2a45";
  head.innerHTML = `
    <svg width="58" height="58" viewBox="0 0 58 58"><circle cx="29" cy="29" r="27" fill="#0e2a45" stroke="#f59e0b" stroke-width="3"/>
      <path d="M17 38h24M19 38V26l10-7 10 7v12M26 38v-7h6v7" stroke="#fff" stroke-width="2.2" fill="none" stroke-linejoin="round"/>
      <text x="29" y="50" text-anchor="middle" font-size="7" font-weight="700" fill="#f59e0b">BMC</text></svg>
    <div style="flex:1">
      <div style="font-size:19px;font-weight:700;color:#0e2a45">Bhopal Municipal Corporation</div>
      <div style="font-size:12px;color:#475569">भोपाल नगर निगम · Building Permission Branch</div>
    </div>
    <div style="text-align:right;font-size:11px;color:#475569">Ref: ${ref}<br>Date: ${today.toLocaleDateString("en-IN")}</div>`;
  const strip = el("div");
  strip.style.cssText = "height:4px;margin:2px 0 16px;background:linear-gradient(90deg,#f97316 33%,#fff 33% 66%,#16a34a 66%)";
  const title = el("div", "", "Building Rule Query — Reference Report");
  title.style.cssText = "text-align:center;font-size:15px;font-weight:700;letter-spacing:.5px;margin-bottom:14px;text-transform:uppercase;color:#163b5e";
  doc.append(head, strip, title);

  const section = (label, node, accent = "#1f4e79", bg = "#f8fafc") => {
    const s = el("div");
    // Only short text blocks stay unbroken; a long answer kept whole gets pushed to the next page, leaving a gap.
    const keep = typeof node === "string" ? "page-break-inside:avoid" : "";
    s.style.cssText = `margin-bottom:12px;padding:10px 14px;border-left:4px solid ${accent};background:${bg};border-radius:4px;${keep}`;
    const l = el("div", "", label);
    l.style.cssText = `font-size:11px;font-weight:700;text-transform:uppercase;color:${accent};margin-bottom:4px`;
    const body = typeof node === "string" ? el("div", "", node) : node;
    body.style.whiteSpace = typeof node === "string" ? "pre-wrap" : "";
    s.append(l, body);
    return s;
  };
  if (r.amendment_alert) {
    doc.append(section("Amendment alert", "⚠️ Rule 2(5)(c) was amended on 28 Aug 2026. This answer is based on the older March 2025 rules.", "#b91c1c", "#fef2f2"));
  }
  doc.append(section("Citizen's question / आपका सवाल", question));
  doc.append(section("Summary", r.clerk_summary, "#0e2a45", "#eef4fa"));
  doc.append(section("Detailed answer", markdown(r.answer)));
  doc.append(section("Rule number(s)", ruleNumbers(r)));

  if (r.citations.length) {
    const list = el("div");
    for (const c of r.citations) {
      const item = el("div");
      item.style.cssText = "margin:4px 0 8px;page-break-inside:avoid";
      const t = el("div", "", `${ruleLabel(c.rule)} · PDF page ${c.page}`);
      t.style.fontWeight = "600";
      const q = el("div", "", "“" + c.quote + "”");
      q.style.cssText = "font-size:11.5px;color:#475569;font-style:italic";
      item.append(t, q);
      list.append(item);
    }
    doc.append(section("Citations — MP Bhumi Vikas Rules 2012 (consolidated to 6 Mar 2025)", list));
  }
  if (r.notes) doc.append(section("Notes", r.notes, "#a16207", "#fffbeb"));

  const foot = el("div", "", "Computer-generated reference from the MP Bhumi Vikas Rules 2012 (consolidated to 6 March 2025). " +
    "This is not legal advice or a permission; verify against the official rulebook and the local Development Plan.");
  foot.style.cssText = "margin-top:18px;padding-top:8px;border-top:1px solid #cbd5e1;font-size:10px;color:#64748b;text-align:center";
  doc.append(foot);
  return doc;
}

// Uses the short clerk summary: the full answer can contain Markdown tables, which WhatsApp can't show (they're in the PDF).
function waMessage(question, r) {
  return "🏢 *Bhopal Municipal Corporation* 🏢\n\n" +
    `*Aapka Sawal:* ${question}\n` +
    `*Jawab:* ${r.clerk_summary}\n` +
    `*Niyam (Rule):* ${ruleNumbers(r)}\n` +
    (r.amendment_alert ? "\n⚠️ _Rule 2(5)(c) ka 28 Aug 2026 ka sanshodhan is jawab mein shamil nahi hai._\n" : "") +
    "\n📄 _Iska official PDF document is message ke sath aapko bheja gaya hai._";
}

waNumber.addEventListener("input", () => {
  waNumber.value = waNumber.value.replace(/\D/g, "").slice(0, 10);
  waError.classList.add("hidden");
});

waForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!waItem || waSend.disabled) return;
  const number = waNumber.value;
  if (!/^[6-9]\d{9}$/.test(number)) {
    waError.textContent = number.length !== 10
      ? `Enter exactly 10 digits (you entered ${number.length}).`
      : "Indian mobile numbers start with 6, 7, 8 or 9.";
    waError.classList.remove("hidden");
    waNumber.focus();
    return;
  }
  const { question, r, pdf } = waItem;
  // Same click-to-chat API as wa.me, which redirects here; wa.me's redirect turns emojis into "�".
  const url = `https://api.whatsapp.com/send?phone=91${number}&text=${encodeURIComponent(waMessage(question, r))}`;
  console.log("[wa] sending to +91" + number, "url length:", url.length);

  // Open the tab now, while we still have the click; after the PDF await the browser would block the popup.
  const tab = window.open("about:blank", "_blank");
  if (tab) tab.opener = null;
  waSend.disabled = true;
  waStatus.textContent = "Generating PDF…";
  waStatus.classList.remove("hidden");

  try {
    downloadBlob(await pdf, PDF_NAME);
    console.log("[wa] PDF downloaded:", PDF_NAME);
  } catch (err) {
    console.error("[wa] PDF failed:", err);
    alert("PDF could not be generated: " + err.message + "\nThe WhatsApp message will still open.");
  }

  if (tab) {
    tab.location.href = url;
    console.log("[wa] WhatsApp opened");
    closeWaModal();
  } else {
    console.warn("[wa] popup blocked, showing link instead");
    waStatus.replaceChildren("Popup blocked by the browser. ");
    const link = el("a", "underline font-semibold", "Click here to open WhatsApp");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener";
    link.onclick = closeWaModal;
    waStatus.append(link);
  }
});

waShare.addEventListener("click", async () => {
  if (!waItem) return;
  const { question, r, pdf } = waItem;
  waShare.disabled = true;
  waStatus.textContent = "Preparing PDF…";
  waStatus.classList.remove("hidden");
  try {
    const file = new File([await pdf], PDF_NAME, { type: "application/pdf" });
    console.log("[wa] opening share sheet with", file.name);
    await navigator.share({ files: [file], title: "BMC Rule Query", text: waMessage(question, r) });
    console.log("[wa] shared");
    closeWaModal();
  } catch (err) {
    console.warn("[wa] share failed:", err.name, err.message);
    waShare.disabled = false;
    // AbortError = the clerk closed the share sheet; NotAllowedError = the click went stale while the PDF was building.
    waStatus.textContent = err.name === "AbortError" ? "Share cancelled."
      : err.name === "NotAllowedError" ? "PDF is ready — click the share button again."
      : "Could not share: " + err.message + ". Use Send via WhatsApp Web instead.";
  }
});

document.getElementById("waClose").onclick = closeWaModal;
document.getElementById("waCancel").onclick = closeWaModal;
waModal.addEventListener("click", (e) => { if (e.target === waModal) closeWaModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && waItem) closeWaModal(); });

loadPdf();
