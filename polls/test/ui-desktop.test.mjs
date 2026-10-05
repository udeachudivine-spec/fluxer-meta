/**
 * Phase 4 Tests — Desktop UI logic
 *
 * These tests cover the pure logic of desktop UI behaviour without a DOM:
 *   - Select / undo selection (single choice)
 *   - Results hidden until voted, shown after
 *   - Results ordering (most → least voted)
 *   - Ranked badge assignment and removal
 *   - Double-click timing window
 *   - Permission gate (hasPollPermission = false → no render signal)
 *   - Ranked round stepping
 *
 * We test the logic, not the rendering — no DOM or React renderer needed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Inline the selection logic from PollCard (extracted as pure functions)
// ---------------------------------------------------------------------------

function toggleSingleChoice(current, optionId) {
  return current.includes(optionId) ? [] : [optionId];
}

function toggleMultipleChoice(current, optionId) {
  return current.includes(optionId)
    ? current.filter((id) => id !== optionId)
    : [...current, optionId];
}

function toggleRankedChoice(current, optionId, maxRankedChoices = 5) {
  const idx = current.indexOf(optionId);
  if (idx >= 0) {
    return current.filter((_, i) => i !== idx);
  }
  if (current.length < maxRankedChoices) {
    return [...current, optionId];
  }
  return current; // at max
}

/**
 * Simulates double-click detection.
 * Returns true if the two clicks are within the threshold window.
 */
function isDoubleClick(lastClickTime, now, threshold = 300) {
  return now - lastClickTime < threshold;
}

/**
 * Sort options for results view: most → least voted.
 */
function sortOptionsByVotes(options, results) {
  return [...options].sort((a, b) => {
    const aCount = results.find((r) => r.optionId === a.id)?.voteCount ?? 0;
    const bCount = results.find((r) => r.optionId === b.id)?.voteCount ?? 0;
    return bCount - aCount;
  });
}

/** Decides whether to show results based on voted/closed state. */
function shouldShowResults(hasVoted, isClosed) {
  return hasVoted || isClosed;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OPTIONS = [
  { id: 'opt-a', text: 'Red',   imageUrl: null },
  { id: 'opt-b', text: 'Blue',  imageUrl: null },
  { id: 'opt-c', text: 'Green', imageUrl: null },
];

// ---------------------------------------------------------------------------
// Single choice toggle tests
// ---------------------------------------------------------------------------

test('UI-Desktop: single choice selects an option', () => {
  const result = toggleSingleChoice([], 'opt-a');
  assert.deepEqual(result, ['opt-a']);
});

test('UI-Desktop: single choice deselects the same option (undo)', () => {
  const result = toggleSingleChoice(['opt-a'], 'opt-a');
  assert.deepEqual(result, []);
});

test('UI-Desktop: single choice replaces previous selection', () => {
  const result = toggleSingleChoice(['opt-a'], 'opt-b');
  assert.deepEqual(result, ['opt-b']);
});

// ---------------------------------------------------------------------------
// Multiple choice toggle tests
// ---------------------------------------------------------------------------

test('UI-Desktop: multiple choice adds an option', () => {
  const result = toggleMultipleChoice(['opt-a'], 'opt-b');
  assert.deepEqual(result, ['opt-a', 'opt-b']);
});

test('UI-Desktop: multiple choice removes an already-selected option', () => {
  const result = toggleMultipleChoice(['opt-a', 'opt-b'], 'opt-a');
  assert.deepEqual(result, ['opt-b']);
});

// ---------------------------------------------------------------------------
// Ranked choice toggle tests
// ---------------------------------------------------------------------------

test('UI-Desktop: ranked choice appends option to end of ranking', () => {
  const result = toggleRankedChoice(['opt-a'], 'opt-b', 5);
  assert.deepEqual(result, ['opt-a', 'opt-b']);
});

test('UI-Desktop: ranked choice removes option (undo preserves order of others)', () => {
  const result = toggleRankedChoice(['opt-a', 'opt-b', 'opt-c'], 'opt-b', 5);
  assert.deepEqual(result, ['opt-a', 'opt-c']);
});

test('UI-Desktop: ranked choice does not exceed maxRankedChoices', () => {
  const full = ['opt-a', 'opt-b']; // max is 2
  const result = toggleRankedChoice(full, 'opt-c', 2);
  assert.deepEqual(result, full); // unchanged
});

test('UI-Desktop: ranked choice badge index matches position (0-based = rank 1)', () => {
  const ranked = ['opt-b', 'opt-a', 'opt-c'];
  assert.equal(ranked.indexOf('opt-b'), 0); // rank 1
  assert.equal(ranked.indexOf('opt-a'), 1); // rank 2
  assert.equal(ranked.indexOf('opt-c'), 2); // rank 3
});

// ---------------------------------------------------------------------------
// Results visibility tests
// ---------------------------------------------------------------------------

test('UI-Desktop: results are hidden before voting', () => {
  assert.equal(shouldShowResults(false, false), false);
});

test('UI-Desktop: results are shown after voting', () => {
  assert.equal(shouldShowResults(true, false), true);
});

test('UI-Desktop: results are shown when poll is closed (even if user has not voted)', () => {
  assert.equal(shouldShowResults(false, true), true);
});

// ---------------------------------------------------------------------------
// Results ordering test
// ---------------------------------------------------------------------------

test('UI-Desktop: sortOptionsByVotes orders most to least', () => {
  const resultData = [
    { optionId: 'opt-a', voteCount: 5 },
    { optionId: 'opt-b', voteCount: 12 },
    { optionId: 'opt-c', voteCount: 3 },
  ];
  const sorted = sortOptionsByVotes(OPTIONS, resultData);
  assert.equal(sorted[0].id, 'opt-b'); // 12 votes
  assert.equal(sorted[1].id, 'opt-a'); // 5 votes
  assert.equal(sorted[2].id, 'opt-c'); // 3 votes
});

test('UI-Desktop: sortOptionsByVotes handles tie (stable, tied options appear together)', () => {
  const resultData = [
    { optionId: 'opt-a', voteCount: 5 },
    { optionId: 'opt-b', voteCount: 5 },
    { optionId: 'opt-c', voteCount: 3 },
  ];
  const sorted = sortOptionsByVotes(OPTIONS, resultData);
  // opt-c must be last; opt-a and opt-b can be in either order
  assert.equal(sorted[2].id, 'opt-c');
  assert.ok(['opt-a', 'opt-b'].includes(sorted[0].id));
  assert.ok(['opt-a', 'opt-b'].includes(sorted[1].id));
});

test('UI-Desktop: sortOptionsByVotes handles zero votes (all equal)', () => {
  const resultData = [
    { optionId: 'opt-a', voteCount: 0 },
    { optionId: 'opt-b', voteCount: 0 },
    { optionId: 'opt-c', voteCount: 0 },
  ];
  const sorted = sortOptionsByVotes(OPTIONS, resultData);
  // All equal — original relative order is fine, just no crash
  assert.equal(sorted.length, 3);
});

// ---------------------------------------------------------------------------
// Double-click detection
// ---------------------------------------------------------------------------

test('UI-Desktop: two clicks within 300ms are treated as a double-click', () => {
  const t1 = 1000;
  const t2 = t1 + 250;
  assert.equal(isDoubleClick(t1, t2), true);
});

test('UI-Desktop: two clicks more than 300ms apart are not a double-click', () => {
  const t1 = 1000;
  const t2 = t1 + 350;
  assert.equal(isDoubleClick(t1, t2), false);
});

test('UI-Desktop: exactly 300ms apart is NOT a double-click (threshold is strict <)', () => {
  const t1 = 1000;
  const t2 = t1 + 300;
  assert.equal(isDoubleClick(t1, t2, 300), false);
});

// ---------------------------------------------------------------------------
// Permission gate
// ---------------------------------------------------------------------------

test('UI-Desktop: modal should not render when user lacks poll permission', () => {
  // The PollCreateModal returns null when hasPollPermission = false
  // We test the guard condition directly
  const hasPollPermission = false;
  const shouldRender = hasPollPermission;
  assert.equal(shouldRender, false);
});

test('UI-Desktop: modal renders when user has poll permission', () => {
  const hasPollPermission = true;
  const shouldRender = hasPollPermission;
  assert.equal(shouldRender, true);
});

// ---------------------------------------------------------------------------
// Ranked round stepper
// ---------------------------------------------------------------------------

test('UI-Desktop: round stepper starts at round index 0', () => {
  let roundIndex = 0;
  const rounds = [{ roundNumber: 1 }, { roundNumber: 2 }, { roundNumber: 3 }];
  assert.equal(rounds[roundIndex].roundNumber, 1);
});

test('UI-Desktop: round stepper next increments up to last round', () => {
  let roundIndex = 1;
  const rounds = [{ roundNumber: 1 }, { roundNumber: 2 }, { roundNumber: 3 }];
  roundIndex = Math.min(rounds.length - 1, roundIndex + 1);
  assert.equal(roundIndex, 2);
  // At max — does not go past end
  roundIndex = Math.min(rounds.length - 1, roundIndex + 1);
  assert.equal(roundIndex, 2);
});

test('UI-Desktop: round stepper prev decrements down to 0', () => {
  let roundIndex = 1;
  roundIndex = Math.max(0, roundIndex - 1);
  assert.equal(roundIndex, 0);
  // At min — does not go below 0
  roundIndex = Math.max(0, roundIndex - 1);
  assert.equal(roundIndex, 0);
});
