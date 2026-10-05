/**
 * Fluxer Polls — Server-Side Validation
 *
 * All rules that must be enforced server-side regardless of what the client
 * sends. Each function throws a typed PollError on failure so the API layer
 * can return a consistent error shape.
 *
 * The server (not the client clock) is authoritative for poll close timing.
 */

import {
  Poll,
  PollOption,
  PollPermission,
  CreatePollInput,
  SubmitVoteInput,
  SubmitRankedVoteInput,
  AddCustomOptionInput,
} from './types';

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export type PollErrorCode =
  | 'POLL_NOT_FOUND'
  | 'POLL_CLOSED'           // poll expired or was closed before this action
  | 'PERMISSION_DENIED'     // caller lacks SEND_POLLS permission
  | 'ANSWER_LIMIT_EXCEEDED' // adding option would exceed maxTotalAnswers
  | 'CUSTOM_RESPONSES_DISABLED'
  | 'ALREADY_VOTED'         // user already has a vote (for single_choice)
  | 'INVALID_OPTION'        // optionId does not belong to this poll
  | 'DUPLICATE_RANK'        // two options share a rank position
  | 'INVALID_RANKED_BALLOT' // ranked ballot has other structural problems
  | 'QUESTION_EMPTY'
  | 'TOO_FEW_OPTIONS'
  | 'INVALID_DURATION'
  | 'INVALID_ANSWER_LIMIT';

export class PollError extends Error {
  constructor(public code: PollErrorCode, message: string) {
    super(message);
    this.name = 'PollError';
  }
}

// ---------------------------------------------------------------------------
// Permission check
// ---------------------------------------------------------------------------

/**
 * Verifies the calling user has an active SEND_POLLS permission for the
 * community. Pass the raw DB row (or null if not found).
 */
export function assertHasPollPermission(
  userId: string,
  permission: PollPermission | null
): void {
  if (!permission || permission.revokedAt !== null) {
    throw new PollError(
      'PERMISSION_DENIED',
      `User ${userId} does not have the SEND_POLLS permission in this community.`
    );
  }
}

// ---------------------------------------------------------------------------
// Poll creation validation
// ---------------------------------------------------------------------------

export function validateCreatePollInput(input: CreatePollInput): void {
  if (!input.question || input.question.trim().length === 0) {
    throw new PollError('QUESTION_EMPTY', 'Poll question cannot be empty.');
  }

  if (!input.options || input.options.length < 2) {
    throw new PollError('TOO_FEW_OPTIONS', 'A poll must have at least 2 options.');
  }

  // Duration: minimum 1 minute, maximum 30 days
  if (
    !Number.isInteger(input.durationMinutes) ||
    input.durationMinutes < 1 ||
    input.durationMinutes > 43200
  ) {
    throw new PollError(
      'INVALID_DURATION',
      'Duration must be between 1 minute and 30 days (43 200 minutes).'
    );
  }

  const maxAnswers = input.maxTotalAnswers ?? 20;
  if (!Number.isInteger(maxAnswers) || maxAnswers < 2 || maxAnswers > 200) {
    throw new PollError(
      'INVALID_ANSWER_LIMIT',
      'maxTotalAnswers must be an integer between 2 and 200.'
    );
  }

  // The initial options themselves must not exceed the cap
  if (input.options.length > maxAnswers) {
    throw new PollError(
      'ANSWER_LIMIT_EXCEEDED',
      `Cannot create poll: ${input.options.length} options exceeds maxTotalAnswers (${maxAnswers}).`
    );
  }
}

// ---------------------------------------------------------------------------
// Poll open check — server clock is authoritative
// ---------------------------------------------------------------------------

/**
 * Throws if the poll is closed or expired at the current server time.
 * Call this before any vote or option-add operation.
 */
export function assertPollIsOpen(poll: Poll): void {
  if (poll.status !== 'active') {
    throw new PollError('POLL_CLOSED', `Poll ${poll.id} is closed.`);
  }
  if (new Date() >= new Date(poll.expiresAt)) {
    throw new PollError(
      'POLL_CLOSED',
      `Poll ${poll.id} has expired. Server time: ${new Date().toISOString()}, expiry: ${poll.expiresAt}.`
    );
  }
}

// ---------------------------------------------------------------------------
// Answer (option) limit enforcement
// ---------------------------------------------------------------------------

/**
 * Throws if adding one more option would exceed the poll's configured limit.
 * Call this before inserting any new poll_option row (creator or custom).
 *
 * @param currentOptionCount  number of options already in the DB for this poll
 * @param maxTotalAnswers      the poll's configured cap
 */
export function assertAnswerLimitNotExceeded(
  pollId: string,
  currentOptionCount: number,
  maxTotalAnswers: number
): void {
  if (currentOptionCount >= maxTotalAnswers) {
    throw new PollError(
      'ANSWER_LIMIT_EXCEEDED',
      `Poll ${pollId} has reached its answer limit of ${maxTotalAnswers}.`
    );
  }
}

// ---------------------------------------------------------------------------
// Vote validation — simple/multiple choice
// ---------------------------------------------------------------------------

/**
 * Validates a simple/multiple-choice vote submission.
 *
 * @param poll          the poll being voted on
 * @param input         the vote payload from the client
 * @param pollOptionIds set of valid optionIds for this poll
 * @param existingVotes optionIds the user has already voted for
 */
export function validateVoteInput(
  poll: Poll,
  input: SubmitVoteInput,
  pollOptionIds: Set<string>,
  existingVotes: string[]
): void {
  assertPollIsOpen(poll);

  if (!input.optionIds || input.optionIds.length === 0) {
    throw new PollError('INVALID_OPTION', 'Must select at least one option.');
  }

  // For single_choice only one optionId is allowed
  if (poll.pollType === 'single_choice' && input.optionIds.length > 1) {
    throw new PollError('INVALID_OPTION', 'Single choice polls accept exactly one selection.');
  }

  // All submitted optionIds must belong to this poll
  for (const id of input.optionIds) {
    if (!pollOptionIds.has(id)) {
      throw new PollError('INVALID_OPTION', `Option ${id} does not belong to poll ${poll.id}.`);
    }
  }

  // Decision (documented assumption): votes CAN be changed before close.
  // A re-vote replaces the previous selection. "Already voted" is not an error;
  // the API layer deletes old votes and inserts the new ones within a transaction.
  // This is the simplest pattern consistent with the "undo by double-click" UX.
  // (No ALREADY_VOTED error thrown here; handled transactionally in the API.)
}

// ---------------------------------------------------------------------------
// Vote validation — ranked choice
// ---------------------------------------------------------------------------

/**
 * Validates a ranked-choice ballot.
 *
 * Rules enforced:
 *   1. Poll must be open (server clock).
 *   2. At least one choice must be submitted.
 *   3. No duplicate optionIds in the ballot.
 *   4. All optionIds must belong to this poll.
 *   5. Number of ranked choices must not exceed poll.maxRankedChoices.
 */
export function validateRankedVoteInput(
  poll: Poll,
  input: SubmitRankedVoteInput,
  pollOptionIds: Set<string>
): void {
  assertPollIsOpen(poll);

  if (!input.rankedOptionIds || input.rankedOptionIds.length === 0) {
    throw new PollError('INVALID_RANKED_BALLOT', 'Must rank at least one option.');
  }

  // Check for duplicates
  const seen = new Set<string>();
  for (const id of input.rankedOptionIds) {
    if (seen.has(id)) {
      throw new PollError('DUPLICATE_RANK', `Option ${id} appears more than once in the ballot.`);
    }
    seen.add(id);
  }

  // All options must belong to the poll
  for (const id of input.rankedOptionIds) {
    if (!pollOptionIds.has(id)) {
      throw new PollError(
        'INVALID_OPTION',
        `Option ${id} does not belong to poll ${poll.id}.`
      );
    }
  }

  // Respect the max ranked choices cap
  const max = poll.maxRankedChoices ?? 5;
  if (input.rankedOptionIds.length > max) {
    throw new PollError(
      'INVALID_RANKED_BALLOT',
      `Cannot rank more than ${max} options on this poll.`
    );
  }
}

// ---------------------------------------------------------------------------
// Custom option (write-in) validation
// ---------------------------------------------------------------------------

/**
 * Validates a request to add a custom write-in option.
 *
 * @param poll               the poll
 * @param input              the write-in payload
 * @param currentOptionCount how many options are already in the DB
 */
export function validateAddCustomOption(
  poll: Poll,
  input: AddCustomOptionInput,
  currentOptionCount: number
): void {
  assertPollIsOpen(poll);

  if (!poll.allowCustomResponses) {
    throw new PollError(
      'CUSTOM_RESPONSES_DISABLED',
      `Poll ${poll.id} does not allow custom responses.`
    );
  }

  if (!input.text || input.text.trim().length === 0) {
    throw new PollError('QUESTION_EMPTY', 'Custom option text cannot be empty.');
  }

  assertAnswerLimitNotExceeded(poll.id, currentOptionCount, poll.maxTotalAnswers);
}

// ---------------------------------------------------------------------------
// Anonymity filter
// ---------------------------------------------------------------------------

/**
 * Strips voter identity from results before sending to a non-moderator caller.
 *
 * Security contract:
 *   - For anonymous polls, normal users NEVER see who voted for what.
 *   - Voter IDs are always stored in the DB (moderators can query directly).
 *   - This function is the single place that enforces the API-level filter.
 *
 * @param results     the full results object (may contain voter arrays)
 * @param isAnonymous whether the poll is marked anonymous
 * @param isModerator whether the calling user has moderator/admin privileges
 */
export function applyAnonymityFilter<
  T extends { options: Array<{ voters: unknown[] | null }> }
>(results: T, isAnonymous: boolean, isModerator: boolean): T {
  if (!isAnonymous || isModerator) {
    // Nothing to strip
    return results;
  }

  // Return a shallow copy with voters nulled out on every option
  return {
    ...results,
    options: results.options.map((opt) => ({ ...opt, voters: null })),
  };
}
