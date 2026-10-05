/**
 * Fluxer Polls — Audit Logging
 *
 * Produces structured audit log entries for all poll lifecycle events.
 *
 * Format conventions (matching existing Fluxer audit events so bots can
 * ingest them with the same parser):
 *   - action:   namespaced string, "poll.<event>" (matches schema CHECK)
 *   - details:  JSONB with typed fields; keys are camelCase strings
 *   - actor_id + actor_username: always present, even for anonymous polls
 *   - ip_address: from the HTTP request, for moderation traces
 *
 * Bot-ingestible contract:
 *   A bot reading the poll_audit_logs table (or the /api/v1/audit-logs?type=poll.*
 *   endpoint) can rely on these stable keys in `details`:
 *     poll.create          → { question, pollType, isAnonymous, maxTotalAnswers, expiresAt }
 *     poll.close           → { closedEarly: boolean }
 *     poll.delete          → { deletedByAdmin?: boolean }
 *     poll.vote            → { optionIds?, rankedOptionIds? }
 *     poll.vote_retract    → { optionIds }
 *     poll.custom_option_add → { text, optionId }
 *     poll.image_review    → { attachmentId, action: 'approve'|'remove', reason? }
 *     poll.permission_grant  → { targetUserId, targetUsername }
 *     poll.permission_revoke → { targetUserId, targetUsername, reason? }
 */

import { PollAuditAction, PollAuditLogEntry } from './types';

// ---------------------------------------------------------------------------
// Builder helpers — one per audit event type
// ---------------------------------------------------------------------------

type OmitIdAndTimestamp = Omit<PollAuditLogEntry, 'id' | 'createdAt'>;

export function buildCreatePollAudit(params: {
  pollId:        string;
  channelId:     string;
  communityId:   string | null;
  actorId:       string;
  actorUsername: string;
  ipAddress:     string | null;
  question:      string;
  pollType:      string;
  isAnonymous:   boolean;
  maxTotalAnswers: number;
  expiresAt:     string;
}): OmitIdAndTimestamp {
  return {
    action:         'poll.create',
    pollId:         params.pollId,
    channelId:      params.channelId,
    communityId:    params.communityId,
    actorId:        params.actorId,
    actorUsername:  params.actorUsername,
    targetOptionId: null,
    details: {
      question:        params.question,
      pollType:        params.pollType,
      isAnonymous:     params.isAnonymous,
      maxTotalAnswers: params.maxTotalAnswers,
      expiresAt:       params.expiresAt,
    },
    ipAddress: params.ipAddress,
  };
}

export function buildClosePollAudit(params: {
  pollId:        string;
  channelId:     string;
  communityId:   string | null;
  actorId:       string;
  actorUsername: string;
  ipAddress:     string | null;
  closedEarly:   boolean;
}): OmitIdAndTimestamp {
  return {
    action:         'poll.close',
    pollId:         params.pollId,
    channelId:      params.channelId,
    communityId:    params.communityId,
    actorId:        params.actorId,
    actorUsername:  params.actorUsername,
    targetOptionId: null,
    details: { closedEarly: params.closedEarly },
    ipAddress: params.ipAddress,
  };
}

export function buildDeletePollAudit(params: {
  pollId:          string;
  channelId:       string;
  communityId:     string | null;
  actorId:         string;
  actorUsername:   string;
  ipAddress:       string | null;
  deletedByAdmin?: boolean;
}): OmitIdAndTimestamp {
  return {
    action:         'poll.delete',
    pollId:         params.pollId,
    channelId:      params.channelId,
    communityId:    params.communityId,
    actorId:        params.actorId,
    actorUsername:  params.actorUsername,
    targetOptionId: null,
    details: params.deletedByAdmin ? { deletedByAdmin: true } : null,
    ipAddress: params.ipAddress,
  };
}

export function buildVoteAudit(params: {
  pollId:          string;
  channelId:       string;
  communityId:     string | null;
  actorId:         string;
  actorUsername:   string;
  ipAddress:       string | null;
  optionIds?:      string[];
  rankedOptionIds?: string[];
}): OmitIdAndTimestamp {
  const details: Record<string, unknown> = {};
  if (params.optionIds)       details['optionIds']       = params.optionIds;
  if (params.rankedOptionIds) details['rankedOptionIds'] = params.rankedOptionIds;

  return {
    action:         'poll.vote',
    pollId:         params.pollId,
    channelId:      params.channelId,
    communityId:    params.communityId,
    actorId:        params.actorId,
    actorUsername:  params.actorUsername,
    targetOptionId: params.optionIds?.[0] ?? null,
    details,
    ipAddress: params.ipAddress,
  };
}

export function buildVoteRetractAudit(params: {
  pollId:        string;
  channelId:     string;
  communityId:   string | null;
  actorId:       string;
  actorUsername: string;
  ipAddress:     string | null;
  optionIds:     string[];
}): OmitIdAndTimestamp {
  return {
    action:         'poll.vote_retract',
    pollId:         params.pollId,
    channelId:      params.channelId,
    communityId:    params.communityId,
    actorId:        params.actorId,
    actorUsername:  params.actorUsername,
    targetOptionId: params.optionIds[0] ?? null,
    details: { optionIds: params.optionIds },
    ipAddress: params.ipAddress,
  };
}

export function buildCustomOptionAudit(params: {
  pollId:        string;
  channelId:     string;
  communityId:   string | null;
  actorId:       string;
  actorUsername: string;
  ipAddress:     string | null;
  optionId:      string;   // newly created option's ID
  text:          string;
}): OmitIdAndTimestamp {
  return {
    action:         'poll.custom_option_add',
    pollId:         params.pollId,
    channelId:      params.channelId,
    communityId:    params.communityId,
    actorId:        params.actorId,
    actorUsername:  params.actorUsername,
    targetOptionId: params.optionId,
    details: { text: params.text, optionId: params.optionId },
    ipAddress: params.ipAddress,
  };
}

export function buildImageReviewAudit(params: {
  pollId:        string;
  channelId:     string;
  communityId:   string | null;
  actorId:       string;
  actorUsername: string;
  ipAddress:     string | null;
  attachmentId:  string;
  action:        'approve' | 'remove';
  reason?:       string;
}): OmitIdAndTimestamp {
  return {
    action:         'poll.image_review',
    pollId:         params.pollId,
    channelId:      params.channelId,
    communityId:    params.communityId,
    actorId:        params.actorId,
    actorUsername:  params.actorUsername,
    targetOptionId: null,
    details: {
      attachmentId: params.attachmentId,
      action:       params.action,
      ...(params.reason ? { reason: params.reason } : {}),
    },
    ipAddress: params.ipAddress,
  };
}

export function buildPermissionGrantAudit(params: {
  pollId?:         string;   // optional — grant may happen outside a poll context
  channelId:       string;
  communityId:     string | null;
  actorId:         string;
  actorUsername:   string;
  ipAddress:       string | null;
  targetUserId:    string;
  targetUsername:  string;
}): OmitIdAndTimestamp {
  return {
    action:         'poll.permission_grant',
    pollId:         params.pollId ?? '',
    channelId:      params.channelId,
    communityId:    params.communityId,
    actorId:        params.actorId,
    actorUsername:  params.actorUsername,
    targetOptionId: null,
    details: {
      targetUserId:   params.targetUserId,
      targetUsername: params.targetUsername,
    },
    ipAddress: params.ipAddress,
  };
}

export function buildPermissionRevokeAudit(params: {
  pollId?:         string;
  channelId:       string;
  communityId:     string | null;
  actorId:         string;
  actorUsername:   string;
  ipAddress:       string | null;
  targetUserId:    string;
  targetUsername:  string;
  reason?:         string;
}): OmitIdAndTimestamp {
  return {
    action:         'poll.permission_revoke',
    pollId:         params.pollId ?? '',
    channelId:      params.channelId,
    communityId:    params.communityId,
    actorId:        params.actorId,
    actorUsername:  params.actorUsername,
    targetOptionId: null,
    details: {
      targetUserId:   params.targetUserId,
      targetUsername: params.targetUsername,
      ...(params.reason ? { reason: params.reason } : {}),
    },
    ipAddress: params.ipAddress,
  };
}

// ---------------------------------------------------------------------------
// Moderator audit log query helpers (types only — queries live in your ORM)
// ---------------------------------------------------------------------------

/**
 * Query parameters for fetching audit log entries.
 * Maps to WHERE clauses on poll_audit_logs.
 */
export interface AuditLogQuery {
  pollId?:     string;
  actorId?:    string;
  action?:     PollAuditAction;
  communityId?: string;
  /** ISO 8601. Entries at or after this time. */
  fromTime?:   string;
  /** ISO 8601. Entries before this time. */
  toTime?:     string;
  limit?:      number; // default 100
  offset?:     number; // for pagination
}

/**
 * Formats an audit log entry as a human-readable string for admin UI display.
 * Bot consumers should read the structured `details` field directly.
 */
export function formatAuditEntry(entry: PollAuditLogEntry): string {
  const time = new Date(entry.createdAt).toLocaleString();
  const base = `[${time}] ${entry.actorUsername} (${entry.actorId}) — ${entry.action} on poll ${entry.pollId}`;

  switch (entry.action) {
    case 'poll.create':
      return `${base}: "${entry.details?.['question']}" (${entry.details?.['pollType']}, anonymous=${entry.details?.['isAnonymous']})`;
    case 'poll.vote':
      return `${base}: options=${JSON.stringify(entry.details?.['optionIds'] ?? entry.details?.['rankedOptionIds'])}`;
    case 'poll.vote_retract':
      return `${base}: retracted options=${JSON.stringify(entry.details?.['optionIds'])}`;
    case 'poll.custom_option_add':
      return `${base}: added option "${entry.details?.['text']}" (id=${entry.targetOptionId})`;
    case 'poll.close':
      return `${base}: closedEarly=${entry.details?.['closedEarly']}`;
    case 'poll.delete':
      return `${base}${entry.details?.['deletedByAdmin'] ? ' (by admin)' : ''}`;
    case 'poll.image_review':
      return `${base}: attachment ${entry.details?.['attachmentId']} → ${entry.details?.['action']}`;
    case 'poll.permission_grant':
      return `${base}: granted to ${entry.details?.['targetUsername']} (${entry.details?.['targetUserId']})`;
    case 'poll.permission_revoke':
      return `${base}: revoked from ${entry.details?.['targetUsername']} (${entry.details?.['targetUserId']})`;
    default:
      return base;
  }
}
