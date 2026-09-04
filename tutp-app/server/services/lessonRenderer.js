// Renders a lesson_json (see lessonMaterialGenerator.js for the shape) into
// a printable, black-and-white-friendly HTML page: single column, no
// background colors/images, Plus Jakarta Sans throughout (headings and body).

import { generateBarModelSvg } from './barModelSvgGenerator.js';
import { generateTriangleSvg } from './triangleSvgGenerator.js';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Renders grounding.verification_status as a row of small color-coded chips,
 * placed right under the h1 so a teacher sees grounding status before
 * reading anything else (design-notes point 12/18) — sourced/verified is
 * blue, placeholder is amber (still shows the real ncf_code/state_chapter,
 * just flagged as not fully verified), and ungrounded collapses to a single
 * amber chip since there's no ncf_code/state_chapter to show.
 */
function renderGroundingBadge(grounding) {
  const { ncf_code, state_chapter, verification_status } = grounding || {};
  if (!verification_status) return '';

  if (verification_status === 'ungrounded') {
    return `<div class="grounding-chips"><span class="chip chip-placeholder">⚠ Not matched to a specific NCF/state standard — based on general teaching practice</span></div>`;
  }

  const isSourced = verification_status === 'sourced' || verification_status === 'verified';
  const chipClass = isSourced ? 'chip-sourced' : 'chip-placeholder';
  const icon = isSourced ? '✓' : '⚠';

  const chips = [];
  if (ncf_code) chips.push(`<span class="chip ${chipClass}">${icon} NCF ${escapeHtml(ncf_code)}</span>`);
  if (state_chapter) chips.push(`<span class="chip ${chipClass}">${icon} ${escapeHtml(state_chapter)}</span>`);

  // Never silently hide an unrecognized status — surface it rather than
  // dropping the badge entirely.
  if (chips.length === 0) {
    chips.push(`<span class="chip ${chipClass}">${icon} ${escapeHtml(verification_status)}</span>`);
  }

  return `<div class="grounding-chips">${chips.join('')}</div>`;
}

/**
 * Renders an item's diagram (if any) to an SVG wrapped for spacing/styling.
 *
 * Failure handling here is deliberately per-item and non-fatal — this is
 * NOT the same policy as the KG-grounding rule elsewhere in this feature
 * (which fails loud/whole-response, because an ungrounded claim presented
 * as grounded is worse than no material at all). A single bad diagram
 * (e.g. Claude produced an invalid parts/shaded combination) doesn't make
 * the rest of an otherwise-good worksheet worthless, so we catch it, warn
 * in the console for debugging, and leave a small visible note in the
 * output so the failure is still surfaced to the teacher reviewing the
 * material rather than silently vanishing.
 */
function renderItemDiagram(diagram, itemText) {
  if (!diagram) return '';

  try {
    let svg;
    if (diagram.type === 'bar_model') {
      svg = generateBarModelSvg({ parts: diagram.parts, shaded: diagram.shaded, label: diagram.label });
    } else if (diagram.type === 'triangle') {
      svg = diagram.sides
        ? generateTriangleSvg({ sides: diagram.sides })
        : generateTriangleSvg({ angles: diagram.angles });
    } else {
      throw new Error(`Unknown diagram type: ${diagram.type}`);
    }
    return `<div class="item-diagram">${svg}</div>`;
  } catch (err) {
    console.warn(`Diagram generation failed for item "${itemText}": ${err.message}`);
    return `<div class="item-diagram item-diagram-error">(diagram could not be generated)</div>`;
  }
}

/**
 * @param {object} lesson_json - see lessonMaterialGenerator.js for the shape:
 *   { teacher_notes: { objective, key_points, timing_minutes },
 *     student_sections: [{ title, instructions, items }],
 *     grounding: { ncf_code, state_chapter, verification_status } }
 * @returns {string} a full standalone HTML document, ready to print or save.
 */
export function renderLessonHtml(lesson_json) {
  // TODO: this is a minimal starter template, not the final printable
  // design — revisit once generateLessonMaterial is producing real
  // (non-sample) lesson_json to design against. In particular:
  // - page-break / pagination rules for longer lessons
  const {
    teacher_notes = {},
    student_sections = [],
    grounding = {}
  } = lesson_json || {};

  const keyPointsHtml = (teacher_notes.key_points || [])
    .map(point => `<li>${escapeHtml(point)}</li>`)
    .join('\n');

  const sectionsHtml = student_sections.map(section => {
    const itemsHtml = (section.items || [])
      .map(item => `<li>${escapeHtml(item.text)}${renderItemDiagram(item.diagram, item.text)}</li>`)
      .join('\n');
    return `
      <section class="student-section">
        <h2>${escapeHtml(section.title)}</h2>
        <p class="instructions">${escapeHtml(section.instructions)}</p>
        <ul>${itemsHtml}</ul>
      </section>`;
  }).join('\n');

  const groundingBadgeHtml = renderGroundingBadge(grounding);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Lesson Material</title>
<!-- TODO: add Noto Sans Telugu (or equivalent) alongside Plus Jakarta Sans once
     Telugu-language student_sections are generated — Plus Jakarta Sans has no
     Telugu glyphs and will silently fall back to a mismatched system font. See
     the Curriculum Explorer demo (india-learning-commons repo) for the
     working font-pairing pattern already used there. -->
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet"/>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: 'Plus Jakarta Sans', sans-serif;
    color: #111;
    background: #fff;
    max-width: 720px;
    margin: 0 auto;
    padding: 32px 24px;
    line-height: 1.5;
  }
  h1, h2 {
    font-family: 'Plus Jakarta Sans', sans-serif;
    color: #005bbf;
  }
  h1 { font-size: 22px; margin-bottom: 4px; }
  h2 { font-size: 17px; margin-top: 28px; margin-bottom: 6px; }
  .meta { font-size: 13px; color: #444; margin-bottom: 20px; }
  .instructions { font-style: italic; margin: 4px 0 8px; }
  ul { margin: 0 0 8px 20px; padding: 0; }
  li { margin-bottom: 4px; }
  .student-section { break-inside: avoid; page-break-inside: avoid; }
  svg { width: 100%; height: auto; display: block; }
  .item-diagram { max-width: 260px; margin: 8px 0; }
  .item-diagram-error { font-style: italic; color: #8a5a00; }
  .grounding-chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0 20px; }
  .chip { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }
  .chip-sourced { background: #eaf2ff; color: #005bbf; border: 1px solid #b3d1ff; }
  .chip-placeholder { background: #fff4e0; color: #8a5a00; border: 1px solid #f0c987; }
  @media print {
    body { padding: 0; max-width: 100%; }
    .chip-sourced { background: #fff; border: 1px solid #005bbf; color: #005bbf; }
    .chip-placeholder { background: #fff; border: 1px solid #8a5a00; color: #8a5a00; }
  }
</style>
</head>
<body>
  <h1>${escapeHtml(teacher_notes.objective) || 'Lesson Material'}</h1>
  ${groundingBadgeHtml}
  <p class="meta">Timing: ${escapeHtml(teacher_notes.timing_minutes)} min</p>

  <h2>Key Points</h2>
  <ul>${keyPointsHtml}</ul>

  ${sectionsHtml}
</body>
</html>`;
}
