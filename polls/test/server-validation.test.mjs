/**
 * Phase 1 Tests — Server-Side Validation
 *
 * Tests: permissions, answer limit, close enforcement, vote validation,
 * ranked ballot validation, anonymity filter, and custom option gating.
 *
 * Uses Node's built-in test runner (node:test) — no extra dependencies.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Inline the validation functions so this file runs standalone with
// `node --test` without needing a TypeScript compile step.
// ---------------------------------------------------------------------------

// --- PollError ---
class PollError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'PollError';
  }
}

// --- assertHasPollPermission ---
function assertHasPollPermission(userId, permission) {
  if (!permission || permission.revokedAt !== null) {
    throw new PollError('PERMISSION_DENIED', `User ${userId} lacks SEND_POLLS permission.`);
  }
}

// --- validateCreatePollInput ---
function validateCreatePollInput(input) {
  if (!input.question || input.question.trim().length === 0) {
    throw new PollError('QUESTION_EMPTY', 'Poll question cannot be empty.');
  }
  if (!input.options || input.options.length < 2) {
    throw new PollError('TOO_FEW_OPTIONS', 'A poll must have at least 2 options.');
  }
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 1 || input.durationMinutes > 43200) {
    throw new PollError('INVALID_DURATION', 'Duration must be between 1 minute and 30 days.');
  }
  const maxAnswers = input.maxTotalAnswers ?? 20;
  if (!Number.isInteger(maxAnswers) || maxAnswers < 2 || maxAnswers > 200) {
    throw new PollError('INVALID_ANSWER_LIMIT', 'maxTotalAnswers must be between 2 and 200.');
  }
  if (input.options.length > maxAnswers) {
    throw new PollError('ANSWER_LIMIT_EXCEEDED', `${input.options.length} options exceeds maxTotalAnswers (${maxAnswers}).`);
  }
}

// --- assertPollIsOpen ---
function assertPollIsOpen(poll) {
  if (poll.status !== 'active') {
    throw new PollError('POLL_CLOSED', `Poll ${poll.id} is closed.`);
  }
  if (new Date() >= new Date(poll.expiresAt)) {
    throw new PollError('POLL_CLOSED', `Poll ${poll.id} has expired.`);
  }
}

// --- assertAnswerLimitNotExceeded ---
function assertAnswerLimitNotExceeded(pollId, currentOptionCount, maxTotalAnswers) {
  if (currentOptionCount >= maxTotalAnswers) {
    throw new PollError('ANSWER_LIMIT_EXCEEDED', `Poll ${pollId} has reached its answer limit of ${maxTotalAnswers}.`);
  }
}

// --- validateVoteInput ---
function validateVoteInput(poll, input, pollOptionIds) {
  assertPollIsOpen(poll);
  if (!input.optionIds || input.optionIds.length === 0) {
    throw new PollError('INVALID_OPTION', 'Must select at least one option.');
  }
  if (poll.pollType === 'single_choice' && input.optionIds.length > 1) {
    throw new PollError('INVALID_OPTION', 'Single choice polls accept exactly one selection.');
  }
  for (const id of input.optionIds) {
    if (!pollOptionIds.has(id)) {
      throw new PollError('INVALID_OPTION', `Option ${id} does not belong to poll ${poll.id}.`);
    }
  }
}

// --- validateRankedVoteInput ---
function validateRankedVoteInput(poll, input, pollOptionIds) {
  assertPollIsOpen(poll);
  if (!input.rankedOptionIds || input.rankedOptionIds.length === 0) {
    throw new PollError('INVALID_RANKED_BALLOT', 'Must rank at least one option.');
  }
  const seen = new Set();
  for (const id of input.rankedOptionIds) {
    if (seen.has(id)) {
      throw new PollError('DUPLICATE_RANK', `Option ${id} appears more than once.`);
    }
    seen.add(id);
  }
  for (const id of input.rankedOptionIds) {
    if (!pollOptionIds.has(id)) {
      throw new PollError('INVALID_OPTION', `Option ${id} does not belong to poll ${poll.id}.`);
    }
  }
  const max = poll.maxRankedChoices ?? 5;
  if (input.rankedOptionIds.length > max) {
    throw new PollError('INVALID_RANKED_BALLOT', `Cannot rank more than ${max} options.`);
  }
}

// --- validateAddCustomOption ---
function validateAddCustomOption(poll, input, currentOptionCount) {
  assertPollIsOpen(poll);
  if (!poll.allowCustomResponses) {
    throw new PollError('CUSTOM_RESPONSES_DISABLED', 'This poll does not allow custom responses.');
  }
  if (!input.text || input.text.trim().length === 0) {
    throw new PollError('QUESTION_EMPTY', 'Custom option text cannot be empty.');
  }
  assertAnswerLimitNotExceeded(poll.id, currentOptionCount, poll.maxTotalAnswers);
}

// --- applyAnonymityFilter ---
function applyAnonymityFilter(results, isAnonymous, isModerator) {
  if (!isAnonymous || isModerator) return results;
  return {
    ...results,
    options: results.options.map((opt) => ({ ...opt, voters: null })),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns an open poll with sane defaults. Override fields as needed. */
function makeActivePoll(overrides = {}) {
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1h from now
  return {
    id: 'poll-1',
    messageId: 'msg-1',
    channelId: 'ch-1',
    communityId: 'comm-1',
    creatorId: 'user-creator',
    creatorUsername: 'creator',
    creatorAvatarUrl: null,
    question: 'Favourite colour?',
    pollType: 'single_choice',
    isAnonymous: false,
    allowCustomResponses: false,
    maxTotalAnswers: 20,
    maxRankedChoices: 5,
    options: [
      { id: 'opt-a', pollId: 'poll-1', text: 'Red',  voteCount: 0, creatorId: 'user-creator', isCustom: false, orderIndex: 0, imageUrl: null, imageThumbnailUrl: null, imageAttachmentId: null },
      { id: 'opt-b', pollId: 'poll-1', text: 'Blue', voteCount: 0, creatorId: 'user-creator', isCustom: false, orderIndex: 1, imageUrl: null, imageThumbnailUrl: null, imageAttachmentId: null },
    ],
    status: 'active',
    createdAt: new Date().toISOString(),
    expiresAt: future,
    closedAt: null,
    closedBy: null,
    totalVoters: 0,
    hasVoted: false,
    userVotes: [],
    userRankedBallot: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Permission tests
// ---------------------------------------------------------------------------

test('Permission: grants access when permission row exists and is not revoked', () => {
  assert.doesNotThrow(() =>
    assertHasPollPermission('user-1', { userId: 'user-1', communityId: 'comm-1', revokedAt: null })
  );
});

test('Permission: throws PERMISSION_DENIED when permission is null', () => {
  assert.throws(
    () => assertHasPollPermission('user-1', null),
    (err) => err.code === 'PERMISSION_DENIED'
  );
});

test('Permission: throws PERMISSION_DENIED when permission is revoked', () => {
  assert.throws(
    () => assertHasPollPermission('user-1', { revokedAt: '2026-01-01T00:00:00Z' }),
    (err) => err.code === 'PERMISSION_DENIED'
  );
});

// ---------------------------------------------------------------------------
// Create poll validation tests
// ---------------------------------------------------------------------------

test('CreatePoll: valid input passes without throwing', () => {
  assert.doesNotThrow(() =>
    validateCreatePollInput({
      channelId: 'ch-1',
      question: 'Best fruit?',
      pollType: 'single_choice',
      options: [{ text: 'Apple' }, { text: 'Banana' }],
      durationMinutes: 60,
    })
  );
});

test('CreatePoll: throws QUESTION_EMPTY for blank question', () => {
  assert.throws(
    () => validateCreatePollInput({ question: '   ', options: [{text:'A'},{text:'B'}], durationMinutes: 60 }),
    (err) => err.code === 'QUESTION_EMPTY'
  );
});

test('CreatePoll: throws TOO_FEW_OPTIONS for fewer than 2 options', () => {
  assert.throws(
    () => validateCreatePollInput({ question: 'Q?', options: [{ text: 'A' }], durationMinutes: 60 }),
    (err) => err.code === 'TOO_FEW_OPTIONS'
  );
});

test('CreatePoll: throws INVALID_DURATION for 0-minute duration', () => {
  assert.throws(
    () => validateCreatePollInput({ question: 'Q?', options: [{text:'A'},{text:'B'}], durationMinutes: 0 }),
    (err) => err.code === 'INVALID_DURATION'
  );
});

test('CreatePoll: throws INVALID_DURATION for >30 days', () => {
  assert.throws(
    () => validateCreatePollInput({ question: 'Q?', options: [{text:'A'},{text:'B'}], durationMinutes: 43201 }),
    (err) => err.code === 'INVALID_DURATION'
  );
});

test('CreatePoll: throws INVALID_ANSWER_LIMIT for maxTotalAnswers < 2', () => {
  assert.throws(
    () => validateCreatePollInput({ question: 'Q?', options: [{text:'A'},{text:'B'}], durationMinutes: 60, maxTotalAnswers: 1 }),
    (err) => err.code === 'INVALID_ANSWER_LIMIT'
  );
});

test('CreatePoll: throws ANSWER_LIMIT_EXCEEDED when initial options exceed maxTotalAnswers', () => {
  assert.throws(
    () => validateCreatePollInput({
      question: 'Q?',
      options: [{text:'A'},{text:'B'},{text:'C'}],
      durationMinutes: 60,
      maxTotalAnswers: 2,
    }),
    (err) => err.code === 'ANSWER_LIMIT_EXCEEDED'
  );
});

// ---------------------------------------------------------------------------
// Poll open / close enforcement tests
// ---------------------------------------------------------------------------

test('PollOpen: does not throw for active future poll', () => {
  assert.doesNotThrow(() => assertPollIsOpen(makeActivePoll()));
});

test('PollOpen: throws POLL_CLOSED when status is closed', () => {
  const poll = makeActivePoll({ status: 'closed' });
  assert.throws(() => assertPollIsOpen(poll), (err) => err.code === 'POLL_CLOSED');
});

test('PollOpen: throws POLL_CLOSED when expiresAt is in the past (server clock)', () => {
  const past = new Date(Date.now() - 1000).toISOString();
  const poll = makeActivePoll({ expiresAt: past });
  assert.throws(() => assertPollIsOpen(poll), (err) => err.code === 'POLL_CLOSED');
});

// ---------------------------------------------------------------------------
// Answer limit tests
// ---------------------------------------------------------------------------

test('AnswerLimit: does not throw when under the limit', () => {
  assert.doesNotThrow(() => assertAnswerLimitNotExceeded('poll-1', 5, 20));
});

test('AnswerLimit: throws ANSWER_LIMIT_EXCEEDED when at the limit', () => {
  assert.throws(
    () => assertAnswerLimitNotExceeded('poll-1', 20, 20),
    (err) => err.code === 'ANSWER_LIMIT_EXCEEDED'
  );
});

// ---------------------------------------------------------------------------
// Vote validation tests
// ---------------------------------------------------------------------------

test('Vote: valid single choice passes', () => {
  const poll = makeActivePoll({ pollType: 'single_choice' });
  const optionIds = new Set(['opt-a', 'opt-b']);
  assert.doesNotThrow(() => validateVoteInput(poll, { optionIds: ['opt-a'] }, optionIds));
});

test('Vote: throws INVALID_OPTION for multiple selections on single_choice poll', () => {
  const poll = makeActivePoll({ pollType: 'single_choice' });
  const optionIds = new Set(['opt-a', 'opt-b']);
  assert.throws(
    () => validateVoteInput(poll, { optionIds: ['opt-a', 'opt-b'] }, optionIds),
    (err) => err.code === 'INVALID_OPTION'
  );
});

test('Vote: throws INVALID_OPTION for unknown optionId', () => {
  const poll = makeActivePoll({ pollType: 'single_choice' });
  const optionIds = new Set(['opt-a', 'opt-b']);
  assert.throws(
    () => validateVoteInput(poll, { optionIds: ['opt-UNKNOWN'] }, optionIds),
    (err) => err.code === 'INVALID_OPTION'
  );
});

test('Vote: throws POLL_CLOSED when poll is expired', () => {
  const past = new Date(Date.now() - 1000).toISOString();
  const poll = makeActivePoll({ expiresAt: past });
  const optionIds = new Set(['opt-a', 'opt-b']);
  assert.throws(
    () => validateVoteInput(poll, { optionIds: ['opt-a'] }, optionIds),
    (err) => err.code === 'POLL_CLOSED'
  );
});

// ---------------------------------------------------------------------------
// Ranked choice vote validation tests
// ---------------------------------------------------------------------------

test('RankedVote: valid ballot passes', () => {
  const poll = makeActivePoll({ pollType: 'ranked_choice', maxRankedChoices: 3 });
  const optionIds = new Set(['opt-a', 'opt-b']);
  assert.doesNotThrow(() =>
    validateRankedVoteInput(poll, { rankedOptionIds: ['opt-b', 'opt-a'] }, optionIds)
  );
});

test('RankedVote: throws DUPLICATE_RANK for repeated optionId in ballot', () => {
  const poll = makeActivePoll({ pollType: 'ranked_choice' });
  const optionIds = new Set(['opt-a', 'opt-b']);
  assert.throws(
    () => validateRankedVoteInput(poll, { rankedOptionIds: ['opt-a', 'opt-a'] }, optionIds),
    (err) => err.code === 'DUPLICATE_RANK'
  );
});

test('RankedVote: throws INVALID_RANKED_BALLOT when ranking too many options', () => {
  const poll = makeActivePoll({ pollType: 'ranked_choice', maxRankedChoices: 1 });
  const optionIds = new Set(['opt-a', 'opt-b']);
  assert.throws(
    () => validateRankedVoteInput(poll, { rankedOptionIds: ['opt-a', 'opt-b'] }, optionIds),
    (err) => err.code === 'INVALID_RANKED_BALLOT'
  );
});

test('RankedVote: throws INVALID_OPTION for unknown optionId in ballot', () => {
  const poll = makeActivePoll({ pollType: 'ranked_choice' });
  const optionIds = new Set(['opt-a', 'opt-b']);
  assert.throws(
    () => validateRankedVoteInput(poll, { rankedOptionIds: ['opt-a', 'opt-UNKNOWN'] }, optionIds),
    (err) => err.code === 'INVALID_OPTION'
  );
});

// ---------------------------------------------------------------------------
// Custom option tests
// ---------------------------------------------------------------------------

test('CustomOption: valid write-in passes', () => {
  const poll = makeActivePoll({ allowCustomResponses: true, maxTotalAnswers: 5 });
  assert.doesNotThrow(() => validateAddCustomOption(poll, { text: 'Green' }, 4));
});

test('CustomOption: throws CUSTOM_RESPONSES_DISABLED when not allowed', () => {
  const poll = makeActivePoll({ allowCustomResponses: false });
  assert.throws(
    () => validateAddCustomOption(poll, { text: 'Green' }, 2),
    (err) => err.code === 'CUSTOM_RESPONSES_DISABLED'
  );
});

test('CustomOption: throws QUESTION_EMPTY for blank text', () => {
  const poll = makeActivePoll({ allowCustomResponses: true });
  assert.throws(
    () => validateAddCustomOption(poll, { text: '   ' }, 2),
    (err) => err.code === 'QUESTION_EMPTY'
  );
});

test('CustomOption: throws ANSWER_LIMIT_EXCEEDED when poll is full', () => {
  const poll = makeActivePoll({ allowCustomResponses: true, maxTotalAnswers: 3 });
  assert.throws(
    () => validateAddCustomOption(poll, { text: 'Green' }, 3),
    (err) => err.code === 'ANSWER_LIMIT_EXCEEDED'
  );
});

// ---------------------------------------------------------------------------
// Anonymity filter tests
// ---------------------------------------------------------------------------

function makeResults(withVoters = true) {
  return {
    pollId: 'poll-1',
    totalVoters: 2,
    totalVotesCast: 2,
    isClosed: true,
    options: [
      {
        option: { id: 'opt-a', text: 'Red' },
        voteCount: 2,
        percentage: 100,
        voters: withVoters
          ? [{ userId: 'u1', username: 'alice', avatarUrl: null }]
          : null,
      },
    ],
    rankedChoiceRounds: null,
    winningOptionId: null,
  };
}

test('Anonymity: non-anonymous poll always shows voters', () => {
  const results = makeResults(true);
  const filtered = applyAnonymityFilter(results, false, false);
  assert.notEqual(filtered.options[0].voters, null);
});

test('Anonymity: anonymous poll strips voters for normal user', () => {
  const results = makeResults(true);
  const filtered = applyAnonymityFilter(results, true, false);
  assert.equal(filtered.options[0].voters, null);
});

test('Anonymity: anonymous poll keeps voters for moderator', () => {
  const results = makeResults(true);
  const filtered = applyAnonymityFilter(results, true, true);
  assert.notEqual(filtered.options[0].voters, null);
  assert.equal(filtered.options[0].voters.length, 1);
});

test('Anonymity: filter does not mutate the original results object', () => {
  const results = makeResults(true);
  applyAnonymityFilter(results, true, false);
  // Original must be unchanged
  assert.notEqual(results.options[0].voters, null);
});
