/**
 * Fluxer Polls — API Client and Server Route Handler Stubs
 *
 * Two exports:
 *   1. PollsApiClient  — thin HTTP client for use in web/mobile clients.
 *   2. PollsApiHandler — server-side handler logic (framework-agnostic).
 *      Wire it into your Express/Fastify/etc. router.
 */

import {
  Poll,
  PollResults,
  PollPermission,
  PollAuditLogEntry,
  AdminPollView,
  CreatePollInput,
  SubmitVoteInput,
  SubmitRankedVoteInput,
  AddCustomOptionInput,
} from './types';

import {
  PollError,
  assertHasPollPermission,
  validateCreatePollInput,
  assertPollIsOpen,
  assertAnswerLimitNotExceeded,
  validateVoteInput,
  validateRankedVoteInput,
  validateAddCustomOption,
  applyAnonymityFilter,
} from './server-validation';

// ---------------------------------------------------------------------------
// HTTP Client (browser / React Native)
// ---------------------------------------------------------------------------

export class PollsApiClient {
  private baseUrl: string;
  private token:   string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token   = token;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
        ...options.headers,
      },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  createPoll(input: CreatePollInput): Promise<Poll> {
    return this.request<Poll>('/api/v1/polls', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  getPoll(pollId: string): Promise<Poll> {
    return this.request<Poll>(`/api/v1/polls/${pollId}`);
  }

  /** Simple / multiple choice vote. Replaces any existing vote (see assumptions). */
  vote(pollId: string, input: SubmitVoteInput): Promise<PollResults> {
    return this.request<PollResults>(`/api/v1/polls/${pollId}/votes`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  /** Ranked choice ballot. Replaces any existing ballot. */
  submitRankedVote(pollId: string, input: SubmitRankedVoteInput): Promise<PollResults> {
    return this.request<PollResults>(`/api/v1/polls/${pollId}/ranked-votes`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  addCustomOption(pollId: string, input: AddCustomOptionInput): Promise<Poll> {
    return this.request<Poll>(`/api/v1/polls/${pollId}/options`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  closePoll(pollId: string): Promise<Poll> {
    return this.request<Poll>(`/api/v1/polls/${pollId}/close`, {
      method: 'POST',
    });
  }

  deletePoll(pollId: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/api/v1/polls/${pollId}`, {
      method: 'DELETE',
    });
  }

  getResults(pollId: string): Promise<PollResults> {
    return this.request<PollResults>(`/api/v1/polls/${pollId}/results`);
  }

  /** Admin only: full view including all voters, attachments, and audit log. */
  adminGetPoll(pollId: string): Promise<AdminPollView> {
    return this.request<AdminPollView>(`/api/v1/admin/polls/${pollId}`);
  }

  /** Admin only: delete a poll regardless of status. */
  adminDeletePoll(pollId: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/api/v1/admin/polls/${pollId}`, {
      method: 'DELETE',
    });
  }
}

// ---------------------------------------------------------------------------
// DB adapter interface
// Keeps handler logic testable without a real database.
// Implement this against your actual ORM / query builder.
// ---------------------------------------------------------------------------

export interface PollsDb {
  /** Returns the poll or null if not found. */
  findPoll(pollId: string): Promise<Poll | null>;

  /** Returns the active SEND_POLLS permission row, or null if absent/revoked. */
  findPollPermission(userId: string, communityId: string): Promise<PollPermission | null>;

  /** Count of options currently on the poll (for limit enforcement). */
  countOptions(pollId: string): Promise<number>;

  /** Inserts a new poll row and returns it. */
  insertPoll(input: CreatePollInput, creatorId: string, expiresAt: Date): Promise<Poll>;

  /**
   * Atomically replaces the user's vote.
   * Deletes existing vote rows for (pollId, userId) then inserts new ones.
   * The DB trigger enforces that the poll is still open (server clock).
   */
  replaceVote(pollId: string, userId: string, optionIds: string[]): Promise<void>;

  /**
   * Atomically replaces the user's ranked ballot.
   * Deletes existing ranked_ballot rows for (pollId, userId) then inserts new ones.
   */
  replaceRankedBallot(pollId: string, userId: string, rankedOptionIds: string[]): Promise<void>;

  /** Inserts a custom option row and returns the updated poll. */
  insertOption(pollId: string, input: AddCustomOptionInput, creatorId: string): Promise<Poll>;

  /** Marks the poll as closed. Returns the updated poll. */
  closePoll(pollId: string, closedByUserId: string): Promise<Poll>;

  /** Soft-deletes the poll (status = 'deleted'). */
  deletePoll(pollId: string): Promise<void>;

  /**
   * Fetches results. For anonymous polls the DB layer still returns voter IDs;
   * the handler applies applyAnonymityFilter before responding.
   */
  getResults(pollId: string): Promise<PollResults>;

  /** Appends an audit log entry. */
  insertAuditLog(entry: Omit<PollAuditLogEntry, 'id' | 'createdAt'>): Promise<void>;

  /** Admin: full poll view including all voter identities. */
  adminGetPoll(pollId: string): Promise<AdminPollView | null>;
}

// ---------------------------------------------------------------------------
// Request context passed to every handler method
// ---------------------------------------------------------------------------

export interface PollRequestContext {
  userId:      string;
  username:    string;
  communityId: string;
  isModerator: boolean; // community moderator or instance admin
  isAdmin:     boolean; // instance admin only
  ipAddress:   string;
}

// ---------------------------------------------------------------------------
// Server Handler (framework-agnostic logic)
// ---------------------------------------------------------------------------

export class PollsApiHandler {
  constructor(private db: PollsDb) {}

  // ---- Create ------------------------------------------------------------

  async createPoll(ctx: PollRequestContext, input: CreatePollInput): Promise<Poll> {
    // 1. Permission check
    const perm = await this.db.findPollPermission(ctx.userId, ctx.communityId);
    assertHasPollPermission(ctx.userId, perm);

    // 2. Input validation
    validateCreatePollInput(input);

    // 3. Compute expiry (server clock — not client-supplied)
    const expiresAt = new Date(Date.now() + input.durationMinutes * 60 * 1000);

    // 4. Persist
    const poll = await this.db.insertPoll(input, ctx.userId, expiresAt);

    // 5. Audit log
    await this.db.insertAuditLog({
      action:         'poll.create',
      pollId:         poll.id,
      channelId:      poll.channelId,
      communityId:    ctx.communityId,
      actorId:        ctx.userId,
      actorUsername:  ctx.username,
      targetOptionId: null,
      details: {
        question:   poll.question,
        pollType:   poll.pollType,
        isAnonymous: poll.isAnonymous,
        maxTotalAnswers: poll.maxTotalAnswers,
        expiresAt:  poll.expiresAt,
      },
      ipAddress: ctx.ipAddress,
    });

    return poll;
  }

  // ---- Vote (simple/multiple) --------------------------------------------

  async vote(
    ctx: PollRequestContext,
    pollId: string,
    input: SubmitVoteInput
  ): Promise<PollResults> {
    const poll = await this.db.findPoll(pollId);
    if (!poll) throw new PollError('POLL_NOT_FOUND', `Poll ${pollId} not found.`);

    // Build the set of valid optionIds for O(1) lookup
    const validOptionIds = new Set(poll.options.map((o) => o.id));

    validateVoteInput(poll, input, validOptionIds, poll.userVotes ?? []);

    // Replace vote atomically (DB trigger enforces server-clock close check)
    await this.db.replaceVote(pollId, ctx.userId, input.optionIds);

    // Audit each voted option
    for (const optionId of input.optionIds) {
      await this.db.insertAuditLog({
        action:         'poll.vote',
        pollId,
        channelId:      poll.channelId,
        communityId:    ctx.communityId,
        actorId:        ctx.userId,
        actorUsername:  ctx.username,
        targetOptionId: optionId,
        details:        { optionIds: input.optionIds },
        ipAddress:      ctx.ipAddress,
      });
    }

    const results = await this.db.getResults(pollId);
    return applyAnonymityFilter(results, poll.isAnonymous, ctx.isModerator);
  }

  // ---- Vote (ranked) -----------------------------------------------------

  async submitRankedVote(
    ctx: PollRequestContext,
    pollId: string,
    input: SubmitRankedVoteInput
  ): Promise<PollResults> {
    const poll = await this.db.findPoll(pollId);
    if (!poll) throw new PollError('POLL_NOT_FOUND', `Poll ${pollId} not found.`);

    const validOptionIds = new Set(poll.options.map((o) => o.id));
    validateRankedVoteInput(poll, input, validOptionIds);

    await this.db.replaceRankedBallot(pollId, ctx.userId, input.rankedOptionIds);

    await this.db.insertAuditLog({
      action:         'poll.vote',
      pollId,
      channelId:      poll.channelId,
      communityId:    ctx.communityId,
      actorId:        ctx.userId,
      actorUsername:  ctx.username,
      targetOptionId: null,
      details:        { rankedOptionIds: input.rankedOptionIds },
      ipAddress:      ctx.ipAddress,
    });

    const results = await this.db.getResults(pollId);
    return applyAnonymityFilter(results, poll.isAnonymous, ctx.isModerator);
  }

  // ---- Add custom option -------------------------------------------------

  async addCustomOption(
    ctx: PollRequestContext,
    pollId: string,
    input: AddCustomOptionInput
  ): Promise<Poll> {
    const poll = await this.db.findPoll(pollId);
    if (!poll) throw new PollError('POLL_NOT_FOUND', `Poll ${pollId} not found.`);

    const currentCount = await this.db.countOptions(pollId);
    validateAddCustomOption(poll, input, currentCount);

    const updatedPoll = await this.db.insertOption(pollId, input, ctx.userId);

    await this.db.insertAuditLog({
      action:         'poll.custom_option_add',
      pollId,
      channelId:      poll.channelId,
      communityId:    ctx.communityId,
      actorId:        ctx.userId,
      actorUsername:  ctx.username,
      targetOptionId: null, // set to the new option id after DB insert if needed
      details:        { text: input.text },
      ipAddress:      ctx.ipAddress,
    });

    return updatedPoll;
  }

  // ---- Close poll --------------------------------------------------------

  async closePoll(
    ctx: PollRequestContext,
    pollId: string
  ): Promise<Poll> {
    const poll = await this.db.findPoll(pollId);
    if (!poll) throw new PollError('POLL_NOT_FOUND', `Poll ${pollId} not found.`);

    // Only the creator or a moderator/admin can close early
    if (poll.creatorId !== ctx.userId && !ctx.isModerator) {
      throw new PollError('PERMISSION_DENIED', 'Only the poll creator or a moderator can close this poll.');
    }

    const closed = await this.db.closePoll(pollId, ctx.userId);

    await this.db.insertAuditLog({
      action:         'poll.close',
      pollId,
      channelId:      poll.channelId,
      communityId:    ctx.communityId,
      actorId:        ctx.userId,
      actorUsername:  ctx.username,
      targetOptionId: null,
      details:        { closedEarly: new Date() < new Date(poll.expiresAt) },
      ipAddress:      ctx.ipAddress,
    });

    return closed;
  }

  // ---- Delete poll -------------------------------------------------------

  async deletePoll(
    ctx: PollRequestContext,
    pollId: string
  ): Promise<{ success: boolean }> {
    const poll = await this.db.findPoll(pollId);
    if (!poll) throw new PollError('POLL_NOT_FOUND', `Poll ${pollId} not found.`);

    if (poll.creatorId !== ctx.userId && !ctx.isModerator) {
      throw new PollError('PERMISSION_DENIED', 'Only the poll creator or a moderator can delete this poll.');
    }

    await this.db.deletePoll(pollId);

    await this.db.insertAuditLog({
      action:         'poll.delete',
      pollId,
      channelId:      poll.channelId,
      communityId:    ctx.communityId,
      actorId:        ctx.userId,
      actorUsername:  ctx.username,
      targetOptionId: null,
      details:        null,
      ipAddress:      ctx.ipAddress,
    });

    return { success: true };
  }

  // ---- Get results -------------------------------------------------------

  async getResults(
    ctx: PollRequestContext,
    pollId: string
  ): Promise<PollResults> {
    const poll = await this.db.findPoll(pollId);
    if (!poll) throw new PollError('POLL_NOT_FOUND', `Poll ${pollId} not found.`);

    const results = await this.db.getResults(pollId);
    return applyAnonymityFilter(results, poll.isAnonymous, ctx.isModerator);
  }

  // ---- Admin: full poll view ---------------------------------------------

  async adminGetPoll(
    ctx: PollRequestContext,
    pollId: string
  ): Promise<AdminPollView> {
    if (!ctx.isAdmin) {
      throw new PollError('PERMISSION_DENIED', 'Instance admin access required.');
    }

    const view = await this.db.adminGetPoll(pollId);
    if (!view) throw new PollError('POLL_NOT_FOUND', `Poll ${pollId} not found.`);

    // Admins always see full voter data — do NOT apply anonymity filter
    return view;
  }

  // ---- Admin: delete poll ------------------------------------------------

  async adminDeletePoll(
    ctx: PollRequestContext,
    pollId: string
  ): Promise<{ success: boolean }> {
    if (!ctx.isAdmin) {
      throw new PollError('PERMISSION_DENIED', 'Instance admin access required.');
    }

    const poll = await this.db.findPoll(pollId);
    if (!poll) throw new PollError('POLL_NOT_FOUND', `Poll ${pollId} not found.`);

    await this.db.deletePoll(pollId);

    await this.db.insertAuditLog({
      action:         'poll.delete',
      pollId,
      channelId:      poll.channelId,
      communityId:    ctx.communityId,
      actorId:        ctx.userId,
      actorUsername:  ctx.username,
      targetOptionId: null,
      details:        { deletedByAdmin: true },
      ipAddress:      ctx.ipAddress,
    });

    return { success: true };
  }
}
