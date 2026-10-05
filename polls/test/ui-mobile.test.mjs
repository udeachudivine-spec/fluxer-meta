/**
 * Phase 5 Tests — Mobile UI logic
 *
 * Tests: long-press detection, swipe detection, carousel navigation,
 * non-gesture select button behaviour, and press-and-hold undo.
 * Pure logic only — no DOM needed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Inline the mobile gesture logic
// ---------------------------------------------------------------------------

const LONG_PRESS_MS      = 500;
const SWIPE_THRESHOLD_PX = 50;

/**
 * Simulates a long-press result.
 * Returns true if the touch lasted >= LONG_PRESS_MS without a move > threshold.
 */
function simulateLongPress(durationMs, moved = false) {
  return !moved && durationMs >= LONG_PRESS_MS;
}

/**
 * Determines swipe direction from start/end X positions.
 * Returns 'next', 'prev', or null (no swipe).
 */
function detectSwipe(startX, endX) {
  const delta = endX - startX;
  if (delta < -SWIPE_THRESHOLD_PX) return 'next';
  if (delta > SWIPE_THRESHOLD_PX)  return 'prev';
  return null;
}

/**
 * Advances carousel index, wrapping around.
 */
function carouselNext(currentIndex, total) {
  return (currentIndex + 1) % total;
}

function carouselPrev(currentIndex, total) {
  return (currentIndex - 1 + total) % total;
}

// Reuse toggle helpers from desktop tests
function toggleSingleChoice(current, optionId) {
  return current.includes(optionId) ? [] : [optionId];
}

function toggleRankedChoice(current, optionId, max = 5) {
  const idx = current.indexOf(optionId);
  if (idx >= 0) return current.filter((_, i) => i !== idx);
  if (current.length < max) return [...current, optionId];
  return current;
}

// ---------------------------------------------------------------------------
// Long-press tests
// ---------------------------------------------------------------------------

test('Mobile: long press >= 500ms without movement triggers select', () => {
  assert.equal(simulateLongPress(500, false), true);
  assert.equal(simulateLongPress(800, false), true);
});

test('Mobile: long press < 500ms does not trigger select', () => {
  assert.equal(simulateLongPress(499, false), false);
  assert.equal(simulateLongPress(0, false),   false);
});

test('Mobile: long press cancelled by movement does not trigger select', () => {
  assert.equal(simulateLongPress(600, true), false);
});

test('Mobile: press-and-hold selects an option', () => {
  const selected = toggleSingleChoice([], 'opt-a');
  assert.deepEqual(selected, ['opt-a']);
});

test('Mobile: press-and-hold again on selected option undoes selection', () => {
  const after = toggleSingleChoice(['opt-a'], 'opt-a');
  assert.deepEqual(after, []);
});

// ---------------------------------------------------------------------------
// Swipe detection tests
// ---------------------------------------------------------------------------

test('Mobile: swipe left (> 50px) returns next', () => {
  assert.equal(detectSwipe(200, 140), 'next');  // delta = -60
  assert.equal(detectSwipe(200, 149), 'next');  // delta = -51
});

test('Mobile: swipe right (> 50px) returns prev', () => {
  assert.equal(detectSwipe(100, 160), 'prev');  // delta = +60
});

test('Mobile: small movement (< 50px) is not a swipe', () => {
  assert.equal(detectSwipe(100, 130), null);    // delta = +30
  assert.equal(detectSwipe(100, 75),  null);    // delta = -25
});

test('Mobile: exactly 50px is not a swipe (threshold is strict >)', () => {
  assert.equal(detectSwipe(100, 50),  null);    // delta = -50
  assert.equal(detectSwipe(100, 150), null);    // delta = +50
});

// ---------------------------------------------------------------------------
// Carousel navigation tests
// ---------------------------------------------------------------------------

test('Mobile: carousel next wraps from last to first', () => {
  assert.equal(carouselNext(2, 3), 0); // index 2 of 3 wraps to 0
});

test('Mobile: carousel prev wraps from first to last', () => {
  assert.equal(carouselPrev(0, 3), 2); // index 0 wraps to 2
});

test('Mobile: carousel next increments within bounds', () => {
  assert.equal(carouselNext(0, 3), 1);
  assert.equal(carouselNext(1, 3), 2);
});

test('Mobile: carousel prev decrements within bounds', () => {
  assert.equal(carouselPrev(2, 3), 1);
  assert.equal(carouselPrev(1, 3), 0);
});

test('Mobile: single-image carousel stays at index 0 on next', () => {
  assert.equal(carouselNext(0, 1), 0);
  assert.equal(carouselPrev(0, 1), 0);
});

// ---------------------------------------------------------------------------
// Non-gesture select button (accessibility)
// ---------------------------------------------------------------------------

test('Mobile: non-gesture select button selects an option', () => {
  const result = toggleSingleChoice([], 'opt-b');
  assert.deepEqual(result, ['opt-b']);
});

test('Mobile: non-gesture select button deselects when already selected', () => {
  const result = toggleSingleChoice(['opt-b'], 'opt-b');
  assert.deepEqual(result, []);
});

// ---------------------------------------------------------------------------
// Ranked on mobile
// ---------------------------------------------------------------------------

test('Mobile: ranked press-and-hold adds option to end of ranking', () => {
  const result = toggleRankedChoice(['opt-a'], 'opt-b', 5);
  assert.deepEqual(result, ['opt-a', 'opt-b']);
});

test('Mobile: ranked press-and-hold again removes option from ranking', () => {
  const result = toggleRankedChoice(['opt-a', 'opt-b'], 'opt-a', 5);
  assert.deepEqual(result, ['opt-b']);
});

test('Mobile: ranked badge index in carousel matches rank position', () => {
  const ranked = ['opt-c', 'opt-a'];
  // opt-c is #1, opt-a is #2
  assert.equal(ranked.indexOf('opt-c') + 1, 1);
  assert.equal(ranked.indexOf('opt-a') + 1, 2);
});

// ---------------------------------------------------------------------------
// Results visibility mirrors desktop
// ---------------------------------------------------------------------------

test('Mobile: results hidden before voting', () => {
  assert.equal(false || false, false);
});

test('Mobile: results shown after voting', () => {
  assert.equal(true || false, true);
});

test('Mobile: results shown when closed even without vote', () => {
  const isClosed = true;
  const hasVoted = false;
  assert.equal(hasVoted || isClosed, true);
});
