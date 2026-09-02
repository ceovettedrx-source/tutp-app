// Generates the structured lesson_json for a piece of teacher material by
// calling the Claude API, grounded in the subject's pedagogy reference note
// (server/references/<subject>.md) and whatever the knowledge graph could
// confirm for this grade/subject/state (server/services/knowledgeGraph.js).

import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REFERENCES_ROOT = path.join(__dirname, '..', 'references');

// Subject -> reference file basename. Only mathematics has a reviewed
// reference note right now (server/references/maths.md). Every other
// subject (ELA, science, social studies, ...) needs its own references/*.md
// — reviewed the same way maths.md was — before this function can support
// it properly. Until then we deliberately skip loading anything for those
// subjects rather than inventing pedagogy guidance on the fly.
const SUBJECT_REFERENCE_FILES = {
  mathematics: 'maths.md'
};

const RESPONSE_SHAPE_INSTRUCTION = `Respond with ONLY valid JSON matching this exact shape — no markdown code fences, no preamble, no text before or after the JSON:

{
  "teacher_notes": { "objective": string, "key_points": string[], "timing_minutes": number },
  "student_sections": [ { "title": string, "instructions": string, "items": string[] } ],
  "grounding": { "ncf_code": string|null, "state_chapter": string|null, "verification_status": string }
}

grounding.verification_status must be copied exactly from the value given to you in the knowledge graph context above — you must not decide or infer this value yourself.`;

function serializeKgContext(kgContext) {
  if (kgContext && kgContext.sourced) {
    const { learningComponent, learningOutcome, stateMapping, misconceptions = [] } = kgContext;
    const misconceptionLines = misconceptions.length
      ? misconceptions.map((m) => `- [${m.id}] ${m.error_pattern_en} — Teacher move: ${m.teacher_move}`).join('\n')
      : '(none documented)';

    return `KNOWLEDGE GRAPH CONTEXT (sourced — use this to ground the material):
Learning component: ${learningComponent.statement_en}
NCF curricular goal: ${learningOutcome.ncf_curricular_goal_id}
NCF competency code: ${learningOutcome.ncf_competency_code}
State textbook chapter: ${stateMapping.textbook_chapter}
Documented misconceptions:
${misconceptionLines}

grounding.verification_status in your response MUST be exactly: "${kgContext.verification_status}"`;
  }

  return `KNOWLEDGE GRAPH CONTEXT: No confirmed NCF/state standard match — generate from general teaching practice and the grounding note MUST say so plainly, do not imply a standard match exists.

grounding.verification_status in your response MUST be exactly: "ungrounded"`;
}

function buildUserMessage(teacherInput) {
  const { grade, subject, topic, chapter_or_topic, state, material_type } = teacherInput || {};
  const lines = [
    `Grade: ${grade}`,
    `Subject: ${subject}`,
    `Topic: ${topic || chapter_or_topic || ''}`
  ];
  if (state) lines.push(`State: ${state}`);
  if (material_type) lines.push(`Material type: ${material_type}`);
  lines.push('', 'Generate the lesson material as instructed in the system prompt.');
  return lines.join('\n');
}

/**
 * @param {object} args
 * @param {object|null} args.kgContext - output of knowledgeGraph.getLearningComponent,
 *   or null/{sourced:false,...} if nothing was sourced (including the ambiguous case).
 * @param {object} args.teacherInput - { grade, subject, topic (or chapter_or_topic), state, material_type }.
 * @returns {Promise<object>} lesson_json matching the shape documented in RESPONSE_SHAPE_INSTRUCTION.
 */
export async function generateLessonMaterial({ kgContext, teacherInput }) {
  const { subject } = teacherInput || {};

  let referenceNote = '';
  if (subject === 'mathematics') {
    const referencePath = path.join(REFERENCES_ROOT, SUBJECT_REFERENCE_FILES.mathematics);
    referenceNote = await readFile(referencePath, 'utf-8');
  }

  const systemPrompt = [referenceNote, serializeKgContext(kgContext), RESPONSE_SHAPE_INSTRUCTION]
    .filter(Boolean)
    .join('\n\n---\n\n');

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set');
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: buildUserMessage(teacherInput) }]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API returned an error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  let raw = data.content?.[0]?.text || '';
  // Defensive: strip markdown code fences even though the prompt says not
  // to include them — same defensive net as question-paper-generate in
  // server.js, since long/complex generations sometimes wrap the JSON
  // anyway.
  const fenceMatch = raw.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) raw = fenceMatch[1];

  let lessonJson;
  try {
    lessonJson = JSON.parse(raw);
  } catch (parseErr) {
    throw new Error(`Could not parse lesson material JSON from Claude's response: ${parseErr.message}. Raw response: ${raw}`);
  }

  return lessonJson;
}
