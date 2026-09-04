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
  "teacher_notes": {
    "objective": string,
    "timing_minutes": number,
    "panchpadi_applicable": boolean,
    "panchpadi": null | {
      "aditi": { "instructions": string, "timing_minutes": number } | null,
      "bodha": { "instructions": string, "timing_minutes": number } | null,
      "abhyasa": { "instructions": string, "timing_minutes": number } | null,
      "prayoga": { "instructions": string, "timing_minutes": number } | null,
      "prasara": { "instructions": string, "timing_minutes": number } | null
    },
    "pedagogy_grounding_note": string
  },
  "student_sections": [
    {
      "title": string,
      "instructions": string,
      "items": [
        {
          "text": string,
          "diagram": null | { "type": "bar_model", "parts": number, "shaded": number, "label": string | null } | { "type": "triangle", "sides": [number, number, number] } | { "type": "triangle", "angles": [number, number, number] }
        }
      ]
    }
  ],
  "grounding": { "ncf_code": string|null, "state_chapter": string|null, "verification_status": string }
}

Rules for the "teacher_notes" field:
- panchpadi_applicable: true when the lesson's structure genuinely supports the 5-stage Panchpadi sequence (most content lessons do); false for things like a single quick practice worksheet where forcing all 5 stages would be artificial. When false, "panchpadi" must be null and the key content just goes in "objective"/"pedagogy_grounding_note" — do not force the structure onto material that doesn't fit it.
- When panchpadi_applicable is true, any individual stage can still be null if genuinely not applicable to this specific lesson (e.g. a very short lesson might skip prasara) — per pedagogy-nep-ncf.md's explicit "not every stage every time" rule. Never null out every stage while claiming panchpadi_applicable is true.
- pedagogy_grounding_note: one or two honest sentences stating which grounding sources (per pedagogy-nep-ncf.md's three sources) actually informed this lesson — e.g. "Structured using the Panchpadi 5-stage method." Never a fixed boilerplate sentence — state what's actually true for this generation, including saying so plainly if none of the three applied beyond basic content generation.
- When the knowledge graph context above includes teacher_training_refs pointing to a TeacherTrainingUnit, and that unit is genuinely relevant to this lesson's grade/subject, weave one specific, non-generic connection into pedagogy_grounding_note (e.g. referencing the actual course_name_en) — never fabricate this connection when no matching unit exists in the knowledge graph context.

Each item is an object, never a bare string. Rules for the "diagram" field:
- If the item's content is naturally a bar model (fraction representation, fraction comparison, fraction equivalence), set diagram to {"type":"bar_model","parts":N,"shaded":K,"label":...} and do NOT also describe the bar in prose — "text" must contain only the actual question/instruction (e.g. "What fraction does this show?" or "Shade the bar to show 3/4."), never a redundant restatement like "a bar split into N parts with K shaded".
- If the item is naturally a triangle (classification, angle-sum problems), set diagram to {"type":"triangle","sides":[...]} when the problem is built from side lengths, OR {"type":"triangle","angles":[...]} when it's built from angle measures — pick whichever the problem actually gives, never both, and never fabricate values not implied by the problem.
- If the item has no natural diagram (word problems, fill-in-the-blank, true/false, MCQ items with no figure), set diagram to null and put everything in "text" exactly as before.
- Numbers in a bar_model/triangle diagram must be mathematically consistent with what "text" says about the same figure — e.g. if text says "1/2 = ?/4" and the diagram depicts the starting fraction, the diagram must be {"type":"bar_model","parts":2,"shaded":1,...}, not some other parts/shaded pair. Never let text and diagram state contradictory numbers for the same figure.

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

  // Pedagogy grounding (Panchpadi/NEP-2020 structure) applies to every lesson
  // regardless of subject, unlike the subject-content reference files below.
  const pedagogyPath = path.join(REFERENCES_ROOT, 'pedagogy-nep-ncf.md');
  const pedagogyNote = await readFile(pedagogyPath, 'utf-8');

  let referenceNote = '';
  if (subject === 'mathematics') {
    const referencePath = path.join(REFERENCES_ROOT, SUBJECT_REFERENCE_FILES.mathematics);
    referenceNote = await readFile(referencePath, 'utf-8');
  }

  const systemPrompt = [pedagogyNote, referenceNote, serializeKgContext(kgContext), RESPONSE_SHAPE_INSTRUCTION]
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
