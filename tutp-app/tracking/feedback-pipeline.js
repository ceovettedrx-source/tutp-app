// Requires an already-configured Anthropic client and Resend client,
// passed in — this module has no direct SDK setup of its own.

export async function classifyFeedback(anthropic, { feature, sentiment, explanationClear, freeText, originalExplanation }) {
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

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 200,
    messages: [{ role: 'user', content: prompt }],
  });
  return JSON.parse(response.content[0].text);
}

export async function autoResolveTooComplex(anthropic, originalExplanation) {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 500,
    messages: [{ role: 'user', content: `Rewrite this explanation in much simpler language for a young child, keep the same facts: ${originalExplanation}` }],
  });
  return response.content[0].text;
}

export async function escalateToFounder(resend, { familyId, studentId, feature, category, note }) {
  await resend.emails.send({
    from: 'alerts@tutp.online',
    to: process.env.FOUNDER_ALERT_EMAIL || 'ceo.vettedrx@gmail.com',
    subject: `[Tut-P] Feedback needs review — ${category}`,
    text: `Family ${familyId}, child ${studentId}, feature ${feature}\nCategory: ${category}\nNote: ${note || '(none)'}`,
  });
}
