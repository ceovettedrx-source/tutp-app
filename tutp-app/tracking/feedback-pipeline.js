// Raw fetch against the Anthropic API, mirroring server.js's /api/homework
// call exactly (same headers, same model) — no SDK client, matching how
// every other Claude call in this codebase is made.

async function callClaude(messages, maxTokens) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      messages
    })
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error: ${response.status} ${errText}`);
  }
  const data = await response.json();
  return data.content[0].text;
}

export async function classifyFeedback({ feature, sentiment, explanationClear, freeText, originalExplanation }) {
  const prompt = `A parent gave this feedback on a Tut-P ${feature} session:
Sentiment: ${sentiment}
Explanation was clear: ${explanationClear}
Parent's note: ${freeText || '(none)'}
${originalExplanation ? `Original explanation given: ${originalExplanation}` : ''}

Classify into exactly one category:
- too_complex: explanation used language above the child's level, but was factually correct
- content_error: the explanation itself may be factually wrong or misleading
- technical_bug: parent is describing a crash, load failure, or broken UI, not a content issue
- general_difficulty: child found the subject hard; not a product problem
- pattern_flag: use only if the note suggests this has happened before or repeatedly

Respond with JSON only: {"category": "...", "auto_resolvable": true|false}
auto_resolvable is true only for too_complex. Everything else requires a human.`;

  const text = await callClaude([{ role: 'user', content: prompt }], 200);
  return JSON.parse(text);
}

export async function autoResolveTooComplex(originalExplanation) {
  return callClaude([{ role: 'user', content: `Rewrite this explanation in much simpler language for a young child, keep the same facts: ${originalExplanation}` }], 500);
}

export async function escalateToFounder(sendEmail, { familyId, studentId, feature, category, note }) {
  const subject = `[Tut-P] Feedback needs review — ${category}`;
  const text = `Family ${familyId}, child ${studentId}, feature ${feature}\nCategory: ${category}\nNote: ${note || '(none)'}`;
  await sendEmail(process.env.FOUNDER_ALERT_EMAIL || 'ceo.vettedrx@gmail.com', subject, text);
}
