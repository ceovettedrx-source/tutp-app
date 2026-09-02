// Deterministic SVG generator for triangle diagrams: structured input
// (three side lengths OR three angles) -> real trigonometry for vertex
// coordinates -> SVG string. No freehand/guessed coordinates — every point
// is placed by the law of cosines/sines from the given input, the same
// "structured input -> calculated coordinates -> SVG" principle used
// elsewhere for diagram generation in this codebase.

const VIEWBOX_WIDTH = 300;
const VIEWBOX_HEIGHT = 250;
const PADDING = 30;
const FIXED_BASE_LENGTH = 200;
const ANGLE_SUM_TOLERANCE = 0.01;
const RIGHT_ANGLE_TOLERANCE_DEG = 0.5;
const EQUAL_SIDE_TOLERANCE = 1e-6;
const RIGHT_ANGLE_MARKER_SIZE = 14;
const TICK_LENGTH = 8;

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

function toDegrees(rad) {
  return (rad * 180) / Math.PI;
}

function validateSides([a, b, c]) {
  const checks = [
    [a, b, c],
    [b, c, a],
    [c, a, b]
  ];
  for (const [x, y, z] of checks) {
    if (x + y <= z) {
      throw new Error(`${x} + ${y} = ${x + y}, which is not greater than ${z} — no triangle exists with these sides`);
    }
  }
}

function validateAngles([A, B, C]) {
  const sum = A + B + C;
  if (Math.abs(sum - 180) > ANGLE_SUM_TOLERANCE) {
    throw new Error(`Angles must sum to 180 degrees, but ${A} + ${B} + ${C} = ${sum}`);
  }
}

// Places A at the origin, B along the horizontal baseline at distance
// sideAB, and computes C via the law of cosines (angle at A) then
// trigonometry — real geometry, not a guessed layout.
function placeTriangle(sideAB, sideBC, sideCA) {
  const cosA = (sideAB ** 2 + sideCA ** 2 - sideBC ** 2) / (2 * sideAB * sideCA);
  const angleA = Math.acos(Math.min(1, Math.max(-1, cosA)));

  const A = { x: 0, y: 0 };
  const B = { x: sideAB, y: 0 };
  const C = { x: sideCA * Math.cos(angleA), y: sideCA * Math.sin(angleA) };
  return { A, B, C };
}

function angleAtVertex(vertex, p1, p2) {
  const v1 = { x: p1.x - vertex.x, y: p1.y - vertex.y };
  const v2 = { x: p2.x - vertex.x, y: p2.y - vertex.y };
  const dot = v1.x * v2.x + v1.y * v2.y;
  const mag = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  return toDegrees(Math.acos(Math.min(1, Math.max(-1, dot / mag))));
}

function distance(p1, p2) {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

function unitVector(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

// Uniformly scales + centers the raw triangle into the fixed viewBox with
// padding, regardless of the input triangle's proportions.
function scaleAndCenter(points) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = maxX - minX || 1;
  const height = maxY - minY || 1;

  const availableWidth = VIEWBOX_WIDTH - 2 * PADDING;
  const availableHeight = VIEWBOX_HEIGHT - 2 * PADDING;
  const scale = Math.min(availableWidth / width, availableHeight / height);

  const scaledWidth = width * scale;
  const scaledHeight = height * scale;
  const offsetX = PADDING + (availableWidth - scaledWidth) / 2;
  const offsetY = PADDING + (availableHeight - scaledHeight) / 2;

  return points.map((p) => ({
    x: (p.x - minX) * scale + offsetX,
    y: (p.y - minY) * scale + offsetY
  }));
}

function rightAngleMarkerSvg(vertex, adjacent1, adjacent2) {
  const dir1 = unitVector(vertex, adjacent1);
  const dir2 = unitVector(vertex, adjacent2);
  const p1 = { x: vertex.x + dir1.x * RIGHT_ANGLE_MARKER_SIZE, y: vertex.y + dir1.y * RIGHT_ANGLE_MARKER_SIZE };
  const p2 = {
    x: p1.x + dir2.x * RIGHT_ANGLE_MARKER_SIZE,
    y: p1.y + dir2.y * RIGHT_ANGLE_MARKER_SIZE
  };
  const p3 = { x: vertex.x + dir2.x * RIGHT_ANGLE_MARKER_SIZE, y: vertex.y + dir2.y * RIGHT_ANGLE_MARKER_SIZE };
  return `<polyline points="${p1.x.toFixed(2)},${p1.y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)} ${p3.x.toFixed(2)},${p3.y.toFixed(2)}" stroke="black" stroke-width="1.5" fill="none"/>`;
}

function tickMarkSvg(p1, p2) {
  const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const dir = unitVector(p1, p2);
  const perp = { x: -dir.y, y: dir.x };
  const start = { x: mid.x - perp.x * (TICK_LENGTH / 2), y: mid.y - perp.y * (TICK_LENGTH / 2) };
  const end = { x: mid.x + perp.x * (TICK_LENGTH / 2), y: mid.y + perp.y * (TICK_LENGTH / 2) };
  return `<line x1="${start.x.toFixed(2)}" y1="${start.y.toFixed(2)}" x2="${end.x.toFixed(2)}" y2="${end.y.toFixed(2)}" stroke="black" stroke-width="1.5"/>`;
}

function nearlyEqual(x, y) {
  return Math.abs(x - y) < EQUAL_SIDE_TOLERANCE * Math.max(x, y, 1);
}

/**
 * @param {object} input - exactly one of:
 *   { sides: [a, b, c] } - three positive, unitless side lengths
 *   { angles: [A, B, C] } - three angles in degrees, summing to 180
 * @returns {string} a standalone `<svg>...</svg>` string — viewBox set,
 *   no fixed width/height, so it scales responsively when embedded.
 */
export function generateTriangleSvg(input) {
  const { sides, angles } = input || {};
  if (sides && angles) {
    throw new Error('Provide either sides or angles, not both');
  }
  if (!sides && !angles) {
    throw new Error('Provide either sides or angles');
  }

  let sideAB, sideBC, sideCA;

  if (sides) {
    if (!Array.isArray(sides) || sides.length !== 3 || sides.some((s) => !(s > 0))) {
      throw new Error('sides must be an array of three positive numbers');
    }
    validateSides(sides);
    [sideAB, sideBC, sideCA] = sides;
  } else {
    if (!Array.isArray(angles) || angles.length !== 3) {
      throw new Error('angles must be an array of three numbers');
    }
    validateAngles(angles);
    const [angleA, angleB, angleC] = angles;
    // Fixed base length (side AB, opposite angle C) — law of sines gives
    // the other two sides proportionally, producing a similar triangle.
    sideAB = FIXED_BASE_LENGTH;
    const circumDiameter = sideAB / Math.sin(toRadians(angleC));
    sideBC = circumDiameter * Math.sin(toRadians(angleA));
    sideCA = circumDiameter * Math.sin(toRadians(angleB));
    validateSides([sideAB, sideBC, sideCA]);
  }

  const { A, B, C } = placeTriangle(sideAB, sideBC, sideCA);

  const angleADeg = angleAtVertex(A, B, C);
  const angleBDeg = angleAtVertex(B, A, C);
  const angleCDeg = angleAtVertex(C, A, B);

  const [sA, sB, sC] = scaleAndCenter([A, B, C]);

  const lenAB = distance(A, B);
  const lenBC = distance(B, C);
  const lenCA = distance(C, A);

  const tickMarks = [];
  if (nearlyEqual(lenAB, lenBC) || nearlyEqual(lenAB, lenCA)) tickMarks.push(tickMarkSvg(sA, sB));
  if (nearlyEqual(lenBC, lenAB) || nearlyEqual(lenBC, lenCA)) tickMarks.push(tickMarkSvg(sB, sC));
  if (nearlyEqual(lenCA, lenAB) || nearlyEqual(lenCA, lenBC)) tickMarks.push(tickMarkSvg(sC, sA));

  let rightAngleMarker = '';
  if (Math.abs(angleADeg - 90) < RIGHT_ANGLE_TOLERANCE_DEG) {
    rightAngleMarker = rightAngleMarkerSvg(sA, sB, sC);
  } else if (Math.abs(angleBDeg - 90) < RIGHT_ANGLE_TOLERANCE_DEG) {
    rightAngleMarker = rightAngleMarkerSvg(sB, sA, sC);
  } else if (Math.abs(angleCDeg - 90) < RIGHT_ANGLE_TOLERANCE_DEG) {
    rightAngleMarker = rightAngleMarkerSvg(sC, sA, sB);
  }

  const points = [sA, sB, sC].map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');

  return `<svg viewBox="0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <polygon points="${points}" stroke="black" stroke-width="2" fill="none"/>
  ${rightAngleMarker}
  ${tickMarks.join('\n  ')}
</svg>`;
}
