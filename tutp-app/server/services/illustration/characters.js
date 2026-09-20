import { createAvatar } from '@dicebear/core';
import { openPeeps } from '@dicebear/collection';

// Same seed = same face every time, so a character like "Ramu" looks
// consistent across every problem — no AI call, no network call, zero cost.
// Returns a raw SVG string. `options` is spread into createAvatar, so never
// pass user-controlled values through it (DiceBear's `rotate` option is
// unescaped in the SVG output — GHSA-gcr2-9v8m-gq45).
export function getCharacterSVG(seed, options = {}) {
  const avatar = createAvatar(openPeeps, {
    seed,
    backgroundColor: ['transparent'],
    ...options
  });
  return avatar.toString();
}
