/**
 * Fluxer Polls — Type Definitions
 *
 * Covers: simple polls, ranked choice voting (IRV), anonymous ballots,
 * image attachments, permissions, audit logs, and admin views.
 */

// ---------------------------------------------------------------------------
// Core enums
// ---------------------------------------------------------------------------

export type PollType   = 'single_choice' | 'multiple_choice' | 'ranked_choice';
export type PollStatus = 'active' | 'closed' | 'deleted';

/**
 * Namespaced audit event types. Must match the CHECK constraint in schema.sql.
 * Bot-ingestible: action + details JSONB follow existing audit log conventions.
 */
export type PollAuditAction =
  | 'poll.create'
  | 'poll.close'
  | 'poll.delete'
  | 'poll.vote'
  | 'poll.vote_retract'
  | 'poll.custom_option_add'
  | 'poll.image_review'
  | 'poll.permission_grant'
  | 'poll.permission_revoke';

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

/**
 * Whether the current user has the SEND_POLLS permission for a given community.
 * Returned by the /permissions endpoint and used to gate the creation UI.
 */
export interface PollPermission {
  userId:      string;
  communityId: string;
  grantedBy:   string;
  grantedAt:   string; // ISO 8601
  revokedAt:   string | null; // null = active
}

// ---------------------------------------------------------------------------
// Image attachments
// ---------------------------------------------------------------------------

/**
 * Reuses the existing attachment pipeline fields: message_id and ip so the
 * upload is logged the same way as any other message attachment.
 */
export interface PollImageAttachment {
  attachmentId:   string;
  messageId:      string;   // the poll's message_id for association
  uploaderIp:     string;   // recorded at upload time for moderation
  url:            string;
  thumbnailUrl:   string | null;
  expiresAt:      string | null; // null = no expiry (follows standard attachment rules)
  isExpired:      boolean;
}

// ---------------------------------------------------------------------------
// Poll option
// ---------------------------------------------------------------------------

export interface PollOption {
  id:                 string;
  pollId:             string;
  text:               string;
  imageAttachmentId:  string | null; // links to shared attachments table
  imageUrl:           string | null;
  imageThumbnailUrl:  string | null;
  orderIndex:         number;
  creatorId:          string;  // always stored, even on anonymous polls (mod access)
  isCustom:           boolean;
  voteCount:          number;
}

// ---------------------------------------------------------------------------
// Votes
// ---------------------------------------------------------------------------

export interface PollVote {
  pollId:   string;
  optionId: string;
  userId:   string;
  rank:     number | null; // 1-based for ranked_choice; null for simple
  votedAt:  string;        // ISO 8601
}

export interface RankedChoiceBallot {
  userId:          string;
  rankedOptionIds: string[]; // [1st-choice optionId, 2nd-choice, ...]
  submittedAt:     string;
}

// ---------------------------------------------------------------------------
// Ranked choice results (IRV rounds)
// ---------------------------------------------------------------------------

export interface RankedChoiceRoundResult {
  roundNumber:       number;
  tallies:           Record<string, number>; // optionId -> vote count
  eliminatedOptionId: string | null;
  transferredVotes:  number | undefined;
  exhaustedVotes:    number;
  winnerOptionId:    string | null;
  isMajorityReached: boolean;
}

// ---------------------------------------------------------------------------
// Poll results
// ---------------------------------------------------------------------------

/**
 * Voter info shape. For anonymous polls the API omits this array entirely
 * unless the caller is a moderator or admin (enforced in the API layer).
 */
export interface VoterInfo {
  userId:    string;
  username:  string;
  avatarUrl: string | null;
}

export interface PollResults {
  pollId:       string;
  totalVoters:  number;
  totalVotesCast: number;
  isClosed:     boolean;
  options: Array<{
    option:      PollOption;
    voteCount:   number;
    percentage:  number;
    /**
     * Only populated when: poll is closed OR caller has voted, AND
     * either the poll is not anonymous OR the caller is a mod/admin.
     */
    voters:      VoterInfo[] | null;
  }>;
  rankedChoiceRounds: RankedChoiceRoundResult[] | null;
  winningOptionId:    string | null;
}

// ---------------------------------------------------------------------------
// Main poll object
// ---------------------------------------------------------------------------

export interface Poll {
  id:                   string;
  messageId:            string;
  channelId:            string;
  communityId:          string | null;
  creatorId:            string;
  creatorUsername:      string;
  creatorAvatarUrl:     string | null;
  question:             string;
  pollType:             PollType;
  isAnonymous:          boolean;
  allowCustomResponses: boolean;
  /** Combined cap on creator-supplied + custom write-in options. */
  maxTotalAnswers:      number;
  maxRankedChoices:     number | null;
  options:              PollOption[];
  status:               PollStatus;
  createdAt:            string;
  expiresAt:            string;
  closedAt:             string | null;
  closedBy:             string | null;
  totalVoters:          number;
  hasVoted:             boolean;
  userVotes:            string[];   // optionIds the current user voted for
  userRankedBallot:     string[];   // optionIds in rank order (ranked_choice only)
}

// ---------------------------------------------------------------------------
// Audit log entry
// ---------------------------------------------------------------------------

export interface PollAuditLogEntry {
  id:             string;
  action:         PollAuditAction;
  pollId:         string;
  channelId:      string;
  communityId:    string | null;
  actorId:        string;
  actorUsername:  string;
  targetOptionId: string | null;
  /**
   * Structured JSONB payload. Bots ingesting audit logs can read typed fields
   * here (e.g. { "question": "...", "pollType": "ranked_choice" } for poll.create).
   */
  details:        Record<string, unknown> | null;
  ipAddress:      string | null;
  createdAt:      string;
}

// ---------------------------------------------------------------------------
// API input types
// ---------------------------------------------------------------------------

export interface CreatePollInput {
  channelId:            string;
  question:             string;
  pollType:             PollType;
  options: Array<{
    text:              string;
    imageUrl?:         string;
    imageAttachmentId?: string; // provided after upload via existing attachment API
  }>;
  /** Duration in minutes. E.g. 60=1h, 1440=1d, 10080=7d. */
  durationMinutes:      number;
  isAnonymous?:         boolean;
  allowCustomResponses?: boolean;
  /**
   * Combined cap on total options including write-ins. 2–200. Default: 20.
   * Enforced server-side; UI shows a warning when limit is near.
   */
  maxTotalAnswers?:     number;
  maxRankedChoices?:    number;
}

export interface SubmitVoteInput {
  /** For simple/multiple choice: array of selected optionIds. */
  optionIds:        string[];
}

export interface SubmitRankedVoteInput {
  /** Ordered array of optionIds: index 0 = 1st choice. No duplicates. */
  rankedOptionIds:  string[];
}

export interface AddCustomOptionInput {
  text:              string;
  imageUrl?:         string;
  imageAttachmentId?: string;
}

// ---------------------------------------------------------------------------
// Admin view types
// ---------------------------------------------------------------------------

/**
 * Full admin view of a poll: includes voter identities regardless of
 * anonymity, all custom-answer authors, and the full image attachment list.
 */
export interface AdminPollView {
  poll:         Poll;
  results:      PollResults; // voters always populated for admins
  auditLog:     PollAuditLogEntry[];
  attachments:  PollImageAttachment[];
}
