const chat = document.getElementById("chat");
const form = document.getElementById("form");
const input = document.getElementById("q");
const button = form.querySelector("button");

const LABELS = { found: "Found in rules", conflict: "Conflicting rules — check both", not_found: "Not in the rules" };

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

function renderAnswer(r) {
  const box = el("div", "msg bot");
  box.append(el("span", "badge " + r.status, LABELS[r.status]));
  if (r.cached) box.append(el("span", "badge cached", "Saved answer"));
  box.append(el("div", "summary", r.clerk_summary), el("div", "", r.answer));

  for (const c of r.citations) {
    const cite = el("div", "cite");
    const link = el("a", "", `Rule ${c.rule} · PDF page ${c.page}`);
    link.href = `/pdf#page=${c.page}`;
    link.target = "_blank";
    cite.append(link, el("blockquote", "", c.quote),
      c.verified ? el("small", "ok", "✓ Quote matches the PDF text")
                 : el("small", "warn", "⚠ Quote not matched in PDF text — open the page and check"));
    box.append(cite);
  }
  if (r.notes) box.append(el("div", "notes", r.notes));
  return box;
}

async function ask(question) {
  add(el("div", "msg user", question));
  const waiting = add(el("div", "msg bot", "Searching the rules…"));
  button.disabled = true;
  try {
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Something went wrong");
    waiting.replaceWith(renderAnswer(data));
  } catch (err) {
    waiting.replaceWith(el("div", "msg bot error", "Error: " + err.message));
  } finally {
    button.disabled = false;
    input.focus();
    chat.scrollTop = chat.scrollHeight;
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = input.value.trim();
  if (!q || button.disabled) return;
  input.value = "";
  ask(q);
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});
