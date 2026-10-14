# Explain speed: three changes (spec, 2026-10-14)

Status: spec only, nothing built. Founder approval needed before any code.

## What was measured

A 14-page, 1.4 MB SCERT Class 9 Social PDF, Telugu, father dashboard, 2026-10-14 16:56 UTC.
Everything the parent waited for took about 63 s:

| Stage | Seconds | Note |
|---|---|---|
| `/api/homework` (read the PDF, answer) | 29.8 | auth 0.5, student 0.4, limit 2.1, model 26.8 |
| gap, page starts Explain | 1.7 | |
| 4 x `/api/explain-please` in parallel | 33.6 | each call 22-30 s of model time, 1.4k tokens in, 1.5-1.9k Telugu tokens out |
| pictures | 0 on the critical path | run while the explanations are written |

Cost of that one request: about $0.26 (answers $0.17, explanations $0.09). Telugu output runs at
about 64 tokens per second, so the length of the explanation, not the network, sets the time.

Competitive check (EdTech, "explain this question"): Google Lens/Gemini and Photomath show a first
line in 1-3 s and keep writing; Byju's and Doubtnut serve a stored video or text answer for common
textbook questions in under 2 s (Doubtnut's pitch is its pre-matched question bank). Nobody
makes a parent wait a minute with a blank page. Streaming and a stored bank are the market norm.

## (a) Pre-filled explain_cache for SCERT Telangana / AP in-text questions, Class 1-10

Fill `explain_cache` ahead of time for every in-text question of the Telangana and AP State Board
textbooks, in Telugu and English, so Explain on a textbook question is a database read.

- **Source.** SCERT textbooks are public. Extract each in-text/boxed question with its page,
  class, subject and chapter; one batch job per textbook, run offline, never in a request.
  Rough size: 10 classes x about 6 subjects x about 150 questions = about 9,000 questions, x2
  languages = about 18,000 explanations.
- **Matching.** The cache key today is `questionKey(question, classBand)`, an exact hash of the
  text. A photo or PDF read by the model differs from the stored text by OCR noise (a dropped
  Telugu vowel sign, a split word, `l` vs `1`, extra spaces). Matching in three steps:
  1. normalise both sides: Unicode NFC, strip zero-width characters, collapse whitespace, drop
     punctuation and numbering ("3.", "(ii)"), lowercase Latin letters;
  2. exact hash of the normalised text, scoped by class band and language;
  3. if no hit: character 3-gram Jaccard similarity against the stored questions of the same
     class and subject (a few hundred rows, in memory); accept at 0.85 or higher, only when the
     best hit is clearly ahead of the second best (gap 0.05 or more).
  A match below 0.85 is a miss and goes to the model as today.
- **Seconds saved:** about 30 s per matched question (the model call), and the user sees it in
  under 1 s. For a textbook page the whole Explain stage drops from 33 s to about 1-2 s.
- **Cost:** one-off generation about 18,000 x $0.023 = about $420 at today's prices (about $210
  with the batch API), plus about 3 days of work; then $0 per hit. Storage is trivial
  (about 20 MB).
- **Risks.** See "What can go wrong" below: a near-match shows the wrong question's explanation
  (the TUT-19 failure again); numbers in a maths question differ by one digit; a textbook revision
  changes questions; wrong stored explanations are served to every parent; copyright of textbook
  text stored in our table (we store our own explanation plus a hash, not the book's text).
  The prompt version is part of the key, so a better prompt invalidates the bank by design.

## (b) Fast Haiku question extraction so Explain starts without waiting for answers

Today Explain waits for the full answer call (27 s) only to learn the question texts. A cheap
extraction call lists the questions first; the page then starts Explain for each one while the
answers are still being written.

- **Flow.** On upload, the page calls `POST /api/extract-questions` (claude-haiku-4-5, the file
  plus "list every question, numbered or not, in page order, as short JSON"). It returns
  `{ total, questions: [{ q_text, page, concept_hint }] }` in about 3-5 s for 14 pages. The page
  immediately fires `explain-please` for the first 8 and, in parallel, the existing
  `/api/homework` answers. The same list gives the batch split in advance (4 + 4, or one
  call when there are 4 or fewer), which also fixes the empty second batch that today re-sends the
  whole PDF for nothing.
- **Seconds saved:** Explain starts at about 5 s instead of 31 s. Total waiting is then
  max(answers 30 s, 5 s + explain 34 s) = about 39 s, so about 24 s saved on this request (63 s to 39 s).
  Combined with (a) on a textbook question: about 8 s.
- **Cost:** about $0.035 more per PDF request (33k input tokens at $1 per million, about 400 out).
  With two answer batches now decided up front, one batch call is skipped when there are 4 or fewer
  questions, which saves up to $0.07 on those requests, so it is cost-neutral for small pages.
- **Risks.** The extraction text differs from the text the answer call writes, so the question that
  Explain was asked about is not the question the answer card shows (keying by the extraction text
  and re-keying by position fixes it); Haiku misses or merges questions on a dense page; a second
  paid model call per upload; the page needs a new loading state.

## (c) Stream the explanation to the page

`explain-please` returns the whole JSON at the end. Streaming (server-sent events from the
Anthropic stream) lets the page show the title and first section after about 3 s while the rest
is written.

- **Seconds saved:** real time is unchanged (the last token still arrives at about 25 s), but the
  parent sees the first content after about 3-4 s instead of 25-34 s. Perceived wait drops by about
  20-25 s per card. It does not speed up the 63 s total; it removes the blank page.
- **Cost:** $0 in model spend. Work: the model must write the card in a streamable order (title,
  steps, then the picture prompt), the server needs a partial-JSON parser, and the page must render
  incomplete cards. About 3-4 days.
- **Risks.** The server checks each card today (`validateExplain`, the maths engine's
  `verifyCard`, one retry). A streamed card is shown before it is checked, so a wrong number can
  appear and then be corrected or withdrawn. Mitigation: stream only the plain-language parts and
  hold the checked mark, answer line and diagram until the end. Also: Cloud Run response buffering
  and compression middleware must not hold back chunks; flaky mobile connections drop streams
  (fall back to the plain JSON call); e2e replay recordings are whole replies and need a streamed
  form.

## Recommended order

1. (b) first: biggest real saving (about 24 s), small, no content risk.
2. (a) next, textbook pages only; start with Class 9 and 10 Telugu and English.
3. (c) last, after (a) and (b), only if the remaining waits still feel long.

## What can go wrong (and the test that catches it)

| Risk | How | Test |
|---|---|---|
| (a) wrong explanation shown for a near-miss question | similarity 0.85 matches a question with different numbers or a different word ("addition" vs "subtraction") | adversarial set: same question with one number changed, same text in Telugu and English, questions from two classes with the same wording; none may hit |
| (a) OCR noise causes a miss | vowel sign dropped, split word | 20 recorded OCR variants of 20 real questions must hit |
| (a) two languages share a key | same normalised text in two languages | key includes language; test a Telugu and an English question with identical numbers |
| (a) a free family gets the paid view | cache rows hold the full card | the cache stores the card only; `explainView` still gates by tier (existing test) |
| (a) stale bank after a prompt change | old card served | `prompt_version` in the key (existing, TUT-18) |
| (b) extraction text differs from the answer text | two keys for one question | integration test: answer card and explain card line up by position for the 9-question PDF |
| (b) Haiku finds 5 of 9 | silent drop again | the extraction `total` is compared with the answers' `total_questions`; any gap is shown to the parent (the same "N questions were not answered" message as the extraction fix) |
| (b) PDF sent three times | cost | log tokens per call; the batch split is decided from the extraction so no batch is sent to a PDF with no questions |
| (c) unchecked card shown | streamed before `verifyCard` | the checked mark, answer and diagram are only sent at the end; test that a card the maths engine rejects never shows an answer line |
| (c) stream cut midway | mobile network | page falls back to the plain call; test with a cut connection |
| All | a free and a paid family | run each path for one free and one paid family, as in the existing e2e |

## Decisions for the founder

1. Order of work (recommended: b, a, c).
2. For (a): Telangana and AP Class 9-10 first, or all Class 1-10 at once; the one-off generation cost is about $420.
3. For (b): accept about $0.035 extra per PDF upload.
