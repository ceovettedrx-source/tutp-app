// Deterministic SVG generator for Singapore Math bar models: structured
// input (segment count, shaded count, optional label) -> calculated
// segment-boundary coordinates -> SVG string. No freehand/guessed
// coordinates — every divider and shaded rect is placed by dividing the
// fixed bar width by `parts`, the same "structured input -> calculated
// coordinates -> SVG" principle used in triangleSvgGenerator.js.

const VIEWBOX_WIDTH = 300;
const VIEWBOX_HEIGHT_NO_LABEL = 100;
const VIEWBOX_HEIGHT_WITH_LABEL = 130;
const BAR_WIDTH = 260;
const BAR_HEIGHT = 50;
const BAR_X = (VIEWBOX_WIDTH - BAR_WIDTH) / 2;
const BAR_Y = 25;
const OUTER_STROKE_WIDTH = 2;
const DIVIDER_STROKE_WIDTH = 1;
const HATCH_PATTERN_ID = 'barModelHatch';
const LABEL_FONT_SIZE = 14;
const LABEL_Y_OFFSET = 30;

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function validateParts(parts) {
  if (!Number.isInteger(parts) || parts < 1) {
    throw new Error(`parts must be a positive integer, got ${parts}`);
  }
}

function validateShaded(shaded, parts) {
  if (!Number.isInteger(shaded) || shaded < 0 || shaded > parts) {
    throw new Error(`shaded must be an integer in the range 0 to ${parts} (parts), got ${shaded}`);
  }
}

/**
 * @param {object} input
 *   parts  - positive integer, number of equal segments the bar is divided into
 *   shaded - integer, 0 <= shaded <= parts, how many segments (from the left) are shaded
 *   label  - optional string caption rendered below the bar
 * @returns {string} a standalone `<svg>...</svg>` string — viewBox set,
 *   no fixed width/height, so it scales responsively when embedded.
 */
export function generateBarModelSvg({ parts, shaded, label } = {}) {
  validateParts(parts);
  validateShaded(shaded, parts);

  const segmentWidth = BAR_WIDTH / parts;
  const hasLabel = label !== undefined && label !== null && label !== '';
  const viewBoxHeight = hasLabel ? VIEWBOX_HEIGHT_WITH_LABEL : VIEWBOX_HEIGHT_NO_LABEL;

  const shadedRects = [];
  for (let i = 0; i < shaded; i++) {
    const x = BAR_X + i * segmentWidth;
    shadedRects.push(
      `<rect x="${x.toFixed(2)}" y="${BAR_Y}" width="${segmentWidth.toFixed(2)}" height="${BAR_HEIGHT}" fill="url(#${HATCH_PATTERN_ID})"/>`
    );
  }

  const dividers = [];
  for (let i = 1; i < parts; i++) {
    const x = BAR_X + i * segmentWidth;
    dividers.push(
      `<line x1="${x.toFixed(2)}" y1="${BAR_Y}" x2="${x.toFixed(2)}" y2="${BAR_Y + BAR_HEIGHT}" stroke="black" stroke-width="${DIVIDER_STROKE_WIDTH}"/>`
    );
  }

  const labelText = hasLabel
    ? `<text x="${VIEWBOX_WIDTH / 2}" y="${BAR_Y + BAR_HEIGHT + LABEL_Y_OFFSET}" text-anchor="middle" font-size="${LABEL_FONT_SIZE}" font-family="sans-serif" fill="black">${escapeXml(label)}</text>`
    : '';

  return `<svg viewBox="0 0 ${VIEWBOX_WIDTH} ${viewBoxHeight}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <pattern id="${HATCH_PATTERN_ID}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="6" stroke="black" stroke-width="1"/>
    </pattern>
  </defs>
  ${shadedRects.join('\n  ')}
  <rect x="${BAR_X}" y="${BAR_Y}" width="${BAR_WIDTH}" height="${BAR_HEIGHT}" stroke="black" stroke-width="${OUTER_STROKE_WIDTH}" fill="none"/>
  ${dividers.join('\n  ')}
  ${labelText}
</svg>`;
}
