import difflib
import json
import re
import sys
import threading
from pathlib import Path
from typing import Literal

import anthropic
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

ROOT = Path(__file__).parent
DATA = ROOT / "data"
PDF = DATA / "MP_Bhumi_Vikas_Rules_2012_upto_2025-03-06_EN.pdf"
CACHE_FILE = ROOT / "cache.json"
MODEL = "claude-opus-5"

# Windows consoles default to cp1252; without this, print() of a Hindi question crashes the request.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

FULLTEXT = (DATA / "bhumi_vikas_rules_fulltext_by_page.txt").read_text(encoding="utf-8")
PAGES = {int(n): t for n, t in re.findall(r"===== PDF page (\d+) =====\n(.*?)(?======|\Z)", FULLTEXT, re.S)}

SYSTEM = f"""You help a building-permission clerk at the Bhopal Municipal Corporation answer citizens' questions
using ONLY the Madhya Pradesh Bhumi Vikas Rules, 2012 (consolidated up to 6 March 2025), given below.
Each page starts with "===== PDF page N =====". Lines like "Rule 56  M.P. Bhumi Vikas Rules, 2012  78" are running
headers, not content; use the "PDF page N" marker for page numbers.

Rules:
- Answer only from the text below. Never use outside knowledge, never invent a rule, rule number or number.
- If the rules do not answer the question, set status "not_found", say clearly that the answer is not in the
  MP Bhumi Vikas Rules 2012, and give no citations.
- If two or more provisions apply and point different ways (e.g. a general rule vs. a special rule, a table vs. a
  proviso, or the Development Plan overriding a rule), set status "conflict" and cite ALL of them; explain the
  difference without picking a winner. The clerk decides.
- Each citation quote must be copied exactly, word for word, from the cited PDF page (one or two sentences or one
  table row is enough).
- Read table rows carefully; state the exact row (e.g. "road up to 9.0 m -> 3.0 m front open space").
- Do arithmetic (fees, areas, FAR x plot area) step by step and show it.
- "answer" is rendered as Markdown. If the retrieved context contains flattened tabular data (rows of a rule's
  table run together as plain lines), you MUST format that table in "answer" as a proper Markdown table with a
  header row, e.g. "| Road width | Front open space |". Use **bold** for the final figure the clerk needs.
- Write "answer" and "clerk_summary" in the same language as the question (English or Hindi).
  "clerk_summary" is 1-3 short lines the clerk can read out at the counter.
- Put caveats in "notes": e.g. this text is consolidated to 6 March 2025; the 28 August 2026 amendment to
  Rule 2(5)(c) (plots up to 500 sq m) is NOT included, so flag it whenever a question touches plots up to 500 sq m
  or Rule 2(5)(c). Also note when the local Development Plan may override (Rule 103, FAR footnote in Rule 61).
- This is not legal advice; the tool points to the rule.

<rules>
{FULLTEXT}
</rules>"""


class Citation(BaseModel):
    rule: str
    page: int
    quote: str


class Answer(BaseModel):
    status: Literal["found", "conflict", "not_found"]
    answer: str
    clerk_summary: str
    citations: list[Citation]
    notes: str


class Question(BaseModel):
    question: str


def normalize(text):
    return " ".join(re.sub(r"[^\w\s.]", " ", text.lower()).split())


def squash(text):
    return re.sub(r"\s+", "", text).lower()


def quote_on_page(quote, page):
    # Quotes may run onto the next page, so check the page and its neighbours.
    nearby = squash("".join(PAGES.get(p, "") for p in (page - 1, page, page + 1)))
    return bool(quote.strip()) and squash(quote) in nearby


# Rule 2(5)(c) (plots up to 500 sq m) was amended on 28 Aug 2026, after this consolidated text.
AMENDED_RULE = re.compile(r"2\s*\(\s*5\s*\)\s*\(\s*c\s*\)|500\s*(?:sq|वर्ग)", re.I)
PLOT_AREA = re.compile(r"(\d+(?:\.\d+)?)\s*(?:sq|वर्ग)", re.I)


def amendment_alert(question, result):
    # Notes are left out: the prompt makes the model mention the amendment there as a routine caveat.
    text = " ".join([question, result["answer"], result["clerk_summary"]]
                    + [f"{c['rule']} {c['quote']}" for c in result["citations"]])
    if AMENDED_RULE.search(text):
        return True
    # A plot of 500 sq m or less falls under the amended rule even if 2(5)(c) is never named.
    return any(float(a) <= 500 for a in PLOT_AREA.findall(question))


def with_extras(question, result, cached):
    pages = list(dict.fromkeys(c["page"] for c in result["citations"]))
    alert = amendment_alert(question, result)
    print(f"[ask] status={result['status']} pdf_pages={pages} amendment_alert={alert} cached={cached}", flush=True)
    return {**result, "pdf_pages": pages, "amendment_alert": alert, "cached": cached}


def find_cached(q, cache):
    if q in cache:
        return cache[q]
    # Fuzzy match only when the numbers are identical: "200 sq m" must never return the "300 sq m" answer.
    digits = re.findall(r"\d+(?:\.\d+)?", q)
    same_numbers = [k for k in cache if re.findall(r"\d+(?:\.\d+)?", k) == digits]
    match = difflib.get_close_matches(q, same_numbers, n=1, cutoff=0.9)
    return cache[match[0]] if match else None


# Skip brotli: older brotlicffi (e.g. Anaconda's 1.1) crashes inside the SDK's HTTP layer.
client = anthropic.Anthropic(default_headers={"Accept-Encoding": "gzip, deflate"})
cache_lock = threading.Lock()
cache = json.loads(CACHE_FILE.read_text(encoding="utf-8")) if CACHE_FILE.exists() else {}
app = FastAPI(title="Bhumi Vikas Sahayak")


@app.post("/api/ask")
def ask(body: Question):
    q = normalize(body.question)
    print(f"[ask] question={body.question!r}", flush=True)
    if not q:
        raise HTTPException(400, "Empty question")
    with cache_lock:
        hit = find_cached(q, cache)
    if hit:
        print("[ask] cache hit", flush=True)
        return with_extras(body.question, hit, True)

    print(f"[ask] cache miss, calling {MODEL}", flush=True)

    try:
        response = client.beta.messages.parse(
            model=MODEL,
            max_tokens=16000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            system=[{"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral", "ttl": "1h"}}],
            messages=[{"role": "user", "content": body.question}],
            output_format=Answer,
        )
    except TypeError:  # raised by the SDK when no credentials are configured
        raise HTTPException(500, "No Claude API key set. Start the server with ANTHROPIC_API_KEY set.")
    except anthropic.APIConnectionError:
        raise HTTPException(502, "Could not reach the AI service. Check the internet connection.")
    except anthropic.RateLimitError:
        raise HTTPException(429, "Too many requests. Wait a few seconds and try again.")
    except anthropic.APIStatusError as e:
        raise HTTPException(502, f"AI service error ({e.status_code}).")
    if response.stop_reason == "refusal" or response.parsed_output is None:
        raise HTTPException(502, "The AI could not answer this question. Please rephrase it.")

    result = response.parsed_output.model_dump()
    for c in result["citations"]:
        c["verified"] = quote_on_page(c["quote"], c["page"])
    result["version"] = "MP Bhumi Vikas Rules 2012, consolidated to 6 Mar 2025"
    with cache_lock:
        cache[q] = result
        CACHE_FILE.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
    return with_extras(body.question, result, False)


@app.get("/pdf")
@app.get("/static/rules.pdf")
def pdf():
    return FileResponse(PDF, media_type="application/pdf")


app.mount("/", StaticFiles(directory=ROOT / "static", html=True), name="static")
