# Bhumi Vikas Sahayak

**Team:** _<team name>_ · **Members:** _<name 1>, <name 2>, <name 3>, <name 4>_
**Track:** Track 1 – Bhumi Vikas Sahayak (Claude Impact Lab × Cerebras Café Compute, Bhopal, 11 Oct 2026)

**Built for one user:** the building-permission clerk at the Bhopal Municipal Corporation counter.
The clerk types the citizen's question in English or Hindi and gets, in under a minute:

- a short answer in the same language, plus a 1–3 line summary to read out
- the **rule number**, the **PDF page** (one click opens the official PDF at that page) and the **exact quote**
- a label: **Found in rules**, **Conflicting rules — check both** (all provisions shown side by side) or **Not in the rules**
- caveats, e.g. that the 28 Aug 2026 amendment to Rule 2(5)(c) is not in the March 2025 text

The tool points to the rule; the clerk decides. It is not legal advice.

## How to run (5 steps)

1. `git clone https://github.com/kumarranjankr06-spec/bhumi_vikas.git && cd bhumi_vikas`
2. `pip install -r requirements.txt`
3. Create a file `.env` containing `ANTHROPIC_API_KEY=sk-ant-...` (get a key at https://console.anthropic.com)
4. `set -a; source .env; set +a; uvicorn app:app`
5. Open http://localhost:8000 and type a question

Self-check (no API key needed): `python3 test_app.py`

## How it works

```
Browser chat (static/: HTML, CSS, JS)  →  FastAPI (app.py)  →  Claude (claude-opus-5)
                                              │
                                              ├─ saved answers (cache.json) checked first
                                              └─ full rules text (data/) sent with every question
```

- **Whole rulebook, no search step.** All 108 pages of the English text, with page markers, go to Claude with
  every question, so no rule is missed. The text is prompt-cached for an hour to keep cost and time down.
- **Quotes are checked in code.** Every quote Claude returns is matched against the real text of that PDF page.
  A quote that doesn't match is shown with a red "check the PDF" warning, so an invented rule cannot pass as real.
- **Repeated questions are instant.** Every answer is saved in `cache.json`. The same question, or a near-identical
  one, is answered from there without calling the model. A near match is only used when all the numbers are the
  same, so a "200 sq m" question never gets the "300 sq m" answer. `cache.json` can be edited by hand to correct
  or pre-approve answers.

## What works and what doesn't

**Works**
- English questions answered with rule number, page and verified quote (tested: front open space on a 9 m road →
  3.0 m, Rule 56(1)(a), page 77, all quotes verified)
- "Not in the rules", conflict display and amendment caveats, driven by the instructions given to Claude
- Saved answers for repeated questions

**Not yet / known limits**
- Not yet scored on the 17 sample questions (`resources/sample_questions.md` was not in our data folder)
- Hindi answers not yet checked by a Hindi reader
- The Hindi PDF is not used (its old font copies out as garbage); answers come from the English PDF
- A new question takes about 10–40 seconds; saved answers are instant
- The 28 Aug 2026 amendment to Rule 2(5)(c) is not in the data; the tool flags it instead of answering from it
- Saved answers are not checked again if they turn out wrong; edit `cache.json` to fix them

## Data used

Only the data from the event pack:

| Document | Link |
|---|---|
| MP Bhumi Vikas Rules 2012, English, consolidated to 6 Mar 2025 | https://mptownplan.gov.in/NewsPDF/bvn06032025E.pdf |
| MP Bhumi Vikas Rules 2012, Hindi, consolidated to 6 Mar 2025 | https://mptownplan.gov.in/NewsPDF/bvn06032025H.pdf |

No other data was added. The repo holds no personal data and no API keys (`.env` is git-ignored).

## License

MIT, see [LICENSE](LICENSE).
