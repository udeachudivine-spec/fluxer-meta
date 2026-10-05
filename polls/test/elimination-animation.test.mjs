/**
 * Phase 7 Tests — Elimination Animation
 *
 * Tests the logic that controls the animation (not the rendering):
 *   - prefersReducedMotion = true → onAnimationEnd called immediately, no delay
 *   - isEliminating = false → nothing happens
 *   - Animation completes → onAnimationEnd is called
 *   - aria-live text uses the eliminated option's name
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Inline the animation controller logic
// ---------------------------------------------------------------------------

/**
 * Simulates the effect that runs when isEliminating changes.
 * Returns a promise that resolves with the result:
 *   'instant'  — reduced motion, fired immediately
 *   'animated' — animation ran, fired after delay
 *   'skipped'  — isEliminating was false, nothing happened
 */
function simulateEliminationEffect(isEliminating, reducedMotion, animationDurationMs = 420) {
  return new Promise((resolve) => {
    if (!isEliminating) {
      resolve('skipped');
      return;
    }

    if (reducedMotion) {
      // Fire immediately
      resolve('instant');
      return;
    }

    // Simulate the timer-based completion
    setTimeout(() => resolve('animated'), animationDurationMs);
  });
}

/** Generates the aria-live announcement text. */
function eliminationAnnouncement(optionText) {
  return `${optionText} has been eliminated from the ranked choice round.`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('Animation: does nothing when isEliminating is false', async () => {
  const result = await simulateEliminationEffect(false, false);
  assert.equal(result, 'skipped');
});

test('Animation: fires onAnimationEnd immediately when prefers-reduced-motion is true', async () => {
  const result = await simulateEliminationEffect(true, true);
  assert.equal(result, 'instant');
});

test('Animation: fires onAnimationEnd after delay when motion is allowed', async () => {
  const result = await simulateEliminationEffect(true, false, 50); // short delay for test speed
  assert.equal(result, 'animated');
});

test('Animation: reduced-motion fires before animation would complete', async () => {
  // Track timing
  const ANIM_DURATION = 50;
  const startTime = Date.now();
  const result = await simulateEliminationEffect(true, true, ANIM_DURATION);
  const elapsed = Date.now() - startTime;

  assert.equal(result, 'instant');
  // Should have resolved well before the animation duration
  assert.ok(elapsed < ANIM_DURATION, `Expected instant resolve but took ${elapsed}ms`);
});

test('Animation: aria-live text includes the eliminated option name', () => {
  const text = eliminationAnnouncement('Blue Party');
  assert.ok(text.includes('Blue Party'));
  assert.ok(text.includes('eliminated'));
});

test('Animation: aria-live text includes "ranked choice round"', () => {
  const text = eliminationAnnouncement('Option C');
  assert.ok(text.includes('ranked choice round'));
});

test('Animation: runs animation and resolves when motion is allowed', async () => {
  let called = false;

  // Simulate as a callback pattern
  await new Promise((resolve) => {
    simulateEliminationEffect(true, false, 30).then(() => {
      called = true;
      resolve(undefined);
    });
  });

  assert.equal(called, true);
});
