/**
 * Phase 3 Tests — Audit Logging
 *
 * Tests: each builder produces the correct action, required fields, and
 * stable details shape. Also tests the formatAuditEntry display helper.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Inline builder functions (mirrors audit.ts)
// ---------------------------------------------------------------------------

function buildCreatePollAudit(p) {
  return {
    action: 'poll.create', pollId: p.pollId, channelId: p.channelId,
    communityId: p.communityId, actorId: p.actorId, actorUsername: p.actorUsername,
    targetOptionId: null,
    details: { question: p.question, pollType: p.pollType, isAnonymous: p.isAnonymous, maxTotalAnswers: p.maxTotalAnswers, expiresAt: p.expiresAt },
    ipAddress: p.ipAddress,
  };
}

function buildClosePollAudit(p) {
  return {
    action: 'poll.close', pollId: p.pollId, channelId: p.channelId,
    communityId: p.communityId, actorId: p.actorId, actorUsername: p.actorUsername,
    targetOptionId: null, details: { closedEarly: p.closedEarly }, ipAddress: p.ipAddress,
  };
}

function buildDeletePollAudit(p) {
  return {
    action: 'poll.delete', pollId: p.pollId, channelId: p.channelId,
    communityId: p.communityId, actorId: p.actorId, actorUsername: p.actorUsername,
    targetOptionId: null, details: p.deletedByAdmin ? { deletedByAdmin: true } : null,
    ipAddress: p.ipAddress,
  };
}

function buildVoteAudit(p) {
  const details = {};
  if (p.optionIds)       details.optionIds       = p.optionIds;
  if (p.rankedOptionIds) details.rankedOptionIds = p.rankedOptionIds;
  return {
    action: 'poll.vote', pollId: p.pollId, channelId: p.channelId,
    communityId: p.communityId, actorId: p.actorId, actorUsername: p.actorUsername,
    targetOptionId: p.optionIds?.[0] ?? null, details, ipAddress: p.ipAddress,
  };
}

function buildVoteRetractAudit(p) {
  return {
    action: 'poll.vote_retract', pollId: p.pollId, channelId: p.channelId,
    communityId: p.communityId, actorId: p.actorId, actorUsername: p.actorUsername,
    targetOptionId: p.optionIds[0] ?? null, details: { optionIds: p.optionIds },
    ipAddress: p.ipAddress,
  };
}

function buildCustomOptionAudit(p) {
  return {
    action: 'poll.custom_option_add', pollId: p.pollId, channelId: p.channelId,
    communityId: p.communityId, actorId: p.actorId, actorUsername: p.actorUsername,
    targetOptionId: p.optionId, details: { text: p.text, optionId: p.optionId },
    ipAddress: p.ipAddress,
  };
}

function buildImageReviewAudit(p) {
  return {
    action: 'poll.image_review', pollId: p.pollId, channelId: p.channelId,
    communityId: p.communityId, actorId: p.actorId, actorUsername: p.actorUsername,
    targetOptionId: null,
    details: { attachmentId: p.attachmentId, action: p.action, ...(p.reason ? { reason: p.reason } : {}) },
    ipAddress: p.ipAddress,
  };
}

function buildPermissionGrantAudit(p) {
  return {
    action: 'poll.permission_grant', pollId: p.pollId ?? '', channelId: p.channelId,
    communityId: p.communityId, actorId: p.actorId, actorUsername: p.actorUsername,
    targetOptionId: null, details: { targetUserId: p.targetUserId, targetUsername: p.targetUsername },
    ipAddress: p.ipAddress,
  };
}

function buildPermissionRevokeAudit(p) {
  return {
    action: 'poll.permission_revoke', pollId: p.pollId ?? '', channelId: p.channelId,
    communityId: p.communityId, actorId: p.actorId, actorUsername: p.actorUsername,
    targetOptionId: null,
    details: { targetUserId: p.targetUserId, targetUsername: p.targetUsername, ...(p.reason ? { reason: p.reason } : {}) },
    ipAddress: p.ipAddress,
  };
}

function formatAuditEntry(entry) {
  const time = new Date(entry.createdAt).toLocaleString();
  const base = `[${time}] ${entry.actorUsername} (${entry.actorId}) — ${entry.action} on poll ${entry.pollId}`;
  switch (entry.action) {
    case 'poll.create':         return `${base}: "${entry.details?.question}" (${entry.details?.pollType}, anonymous=${entry.details?.isAnonymous})`;
    case 'poll.vote':           return `${base}: options=${JSON.stringify(entry.details?.optionIds ?? entry.details?.rankedOptionIds)}`;
    case 'poll.vote_retract':   return `${base}: retracted options=${JSON.stringify(entry.details?.optionIds)}`;
    case 'poll.custom_option_add': return `${base}: added option "${entry.details?.text}" (id=${entry.targetOptionId})`;
    case 'poll.close':          return `${base}: closedEarly=${entry.details?.closedEarly}`;
    case 'poll.delete':         return `${base}${entry.details?.deletedByAdmin ? ' (by admin)' : ''}`;
    case 'poll.image_review':   return `${base}: attachment ${entry.details?.attachmentId} → ${entry.details?.action}`;
    case 'poll.permission_grant': return `${base}: granted to ${entry.details?.targetUsername} (${entry.details?.targetUserId})`;
    case 'poll.permission_revoke': return `${base}: revoked from ${entry.details?.targetUsername} (${entry.details?.targetUserId})`;
    default: return base;
  }
}

// ---------------------------------------------------------------------------
// Shared test params
// ---------------------------------------------------------------------------

const BASE = {
  pollId: 'poll-1', channelId: 'ch-1', communityId: 'comm-1',
  actorId: 'mod-1', actorUsername: 'riley', ipAddress: '10.0.0.1',
};

// ---------------------------------------------------------------------------
// Builder tests
// ---------------------------------------------------------------------------

test('Audit: buildCreatePollAudit sets action and stable detail keys', () => {
  const entry = buildCreatePollAudit({
    ...BASE,
    question: 'Best OS?', pollType: 'single_choice', isAnonymous: false,
    maxTotalAnswers: 10, expiresAt: '2026-10-06T00:00:00Z',
  });
  assert.equal(entry.action, 'poll.create');
  assert.equal(entry.details.question, 'Best OS?');
  assert.equal(entry.details.pollType, 'single_choice');
  assert.equal(entry.details.isAnonymous, false);
  assert.equal(entry.details.maxTotalAnswers, 10);
  assert.equal(entry.details.expiresAt, '2026-10-06T00:00:00Z');
  assert.equal(entry.targetOptionId, null);
});

test('Audit: buildClosePollAudit records closedEarly boolean', () => {
  const early = buildClosePollAudit({ ...BASE, closedEarly: true });
  assert.equal(early.action, 'poll.close');
  assert.equal(early.details.closedEarly, true);

  const natural = buildClosePollAudit({ ...BASE, closedEarly: false });
  assert.equal(natural.details.closedEarly, false);
});

test('Audit: buildDeletePollAudit sets deletedByAdmin only when true', () => {
  const byAdmin = buildDeletePollAudit({ ...BASE, deletedByAdmin: true });
  assert.equal(byAdmin.action, 'poll.delete');
  assert.equal(byAdmin.details.deletedByAdmin, true);

  const byCommunity = buildDeletePollAudit({ ...BASE, deletedByAdmin: false });
  assert.equal(byCommunity.details, null);
});

test('Audit: buildVoteAudit records optionIds for simple vote', () => {
  const entry = buildVoteAudit({ ...BASE, optionIds: ['opt-a'] });
  assert.equal(entry.action, 'poll.vote');
  assert.deepEqual(entry.details.optionIds, ['opt-a']);
  assert.equal(entry.targetOptionId, 'opt-a');
});

test('Audit: buildVoteAudit records rankedOptionIds for ranked vote', () => {
  const entry = buildVoteAudit({ ...BASE, rankedOptionIds: ['opt-b', 'opt-a'] });
  assert.equal(entry.action, 'poll.vote');
  assert.deepEqual(entry.details.rankedOptionIds, ['opt-b', 'opt-a']);
  assert.equal(entry.targetOptionId, null); // no plain optionIds
});

test('Audit: buildVoteRetractAudit records retracted optionIds', () => {
  const entry = buildVoteRetractAudit({ ...BASE, optionIds: ['opt-a'] });
  assert.equal(entry.action, 'poll.vote_retract');
  assert.deepEqual(entry.details.optionIds, ['opt-a']);
  assert.equal(entry.targetOptionId, 'opt-a');
});

test('Audit: buildCustomOptionAudit links option id and text', () => {
  const entry = buildCustomOptionAudit({ ...BASE, optionId: 'opt-custom-1', text: 'Purple' });
  assert.equal(entry.action, 'poll.custom_option_add');
  assert.equal(entry.targetOptionId, 'opt-custom-1');
  assert.equal(entry.details.text, 'Purple');
  assert.equal(entry.details.optionId, 'opt-custom-1');
});

test('Audit: buildImageReviewAudit includes attachmentId and action', () => {
  const approve = buildImageReviewAudit({ ...BASE, attachmentId: 'att-1', action: 'approve' });
  assert.equal(approve.action, 'poll.image_review');
  assert.equal(approve.details.attachmentId, 'att-1');
  assert.equal(approve.details.action, 'approve');
  assert.equal(approve.details.reason, undefined);

  const remove = buildImageReviewAudit({ ...BASE, attachmentId: 'att-2', action: 'remove', reason: 'NSFW' });
  assert.equal(remove.details.reason, 'NSFW');
});

test('Audit: buildPermissionGrantAudit includes target user info', () => {
  const entry = buildPermissionGrantAudit({ ...BASE, targetUserId: 'user-2', targetUsername: 'alex' });
  assert.equal(entry.action, 'poll.permission_grant');
  assert.equal(entry.details.targetUserId, 'user-2');
  assert.equal(entry.details.targetUsername, 'alex');
});

test('Audit: buildPermissionRevokeAudit includes optional reason', () => {
  const withReason = buildPermissionRevokeAudit({
    ...BASE, targetUserId: 'user-2', targetUsername: 'alex', reason: 'abuse',
  });
  assert.equal(withReason.action, 'poll.permission_revoke');
  assert.equal(withReason.details.reason, 'abuse');

  const withoutReason = buildPermissionRevokeAudit({
    ...BASE, targetUserId: 'user-2', targetUsername: 'alex',
  });
  assert.equal(withoutReason.details.reason, undefined);
});

test('Audit: all builders include actor info and ipAddress', () => {
  const builders = [
    buildCreatePollAudit({ ...BASE, question: 'Q', pollType: 'single_choice', isAnonymous: false, maxTotalAnswers: 5, expiresAt: '2026-10-06T00:00:00Z' }),
    buildClosePollAudit({ ...BASE, closedEarly: false }),
    buildDeletePollAudit({ ...BASE }),
    buildVoteAudit({ ...BASE, optionIds: ['opt-a'] }),
    buildVoteRetractAudit({ ...BASE, optionIds: ['opt-a'] }),
    buildCustomOptionAudit({ ...BASE, optionId: 'opt-x', text: 'New' }),
    buildImageReviewAudit({ ...BASE, attachmentId: 'att-1', action: 'approve' }),
    buildPermissionGrantAudit({ ...BASE, targetUserId: 'u2', targetUsername: 'bob' }),
    buildPermissionRevokeAudit({ ...BASE, targetUserId: 'u2', targetUsername: 'bob' }),
  ];

  for (const entry of builders) {
    assert.equal(entry.actorId, 'mod-1', `actorId missing on ${entry.action}`);
    assert.equal(entry.actorUsername, 'riley', `actorUsername missing on ${entry.action}`);
    assert.equal(entry.ipAddress, '10.0.0.1', `ipAddress missing on ${entry.action}`);
    assert.equal(entry.channelId, 'ch-1', `channelId missing on ${entry.action}`);
  }
});

// ---------------------------------------------------------------------------
// formatAuditEntry tests
// ---------------------------------------------------------------------------

function makeEntry(overrides) {
  return {
    id: '1', pollId: 'poll-1', channelId: 'ch-1', communityId: 'comm-1',
    actorId: 'mod-1', actorUsername: 'riley', targetOptionId: null,
    ipAddress: '10.0.0.1', createdAt: '2026-10-05T12:00:00Z', details: null,
    ...overrides,
  };
}

test('Audit: formatAuditEntry renders create event with question and type', () => {
  const entry = makeEntry({
    action: 'poll.create',
    details: { question: 'Best fruit?', pollType: 'ranked_choice', isAnonymous: true },
  });
  const formatted = formatAuditEntry(entry);
  assert.ok(formatted.includes('Best fruit?'));
  assert.ok(formatted.includes('ranked_choice'));
  assert.ok(formatted.includes('anonymous=true'));
});

test('Audit: formatAuditEntry renders vote event with optionIds', () => {
  const entry = makeEntry({ action: 'poll.vote', details: { optionIds: ['opt-a', 'opt-b'] } });
  const formatted = formatAuditEntry(entry);
  assert.ok(formatted.includes('opt-a'));
});

test('Audit: formatAuditEntry renders delete-by-admin indicator', () => {
  const entry = makeEntry({ action: 'poll.delete', details: { deletedByAdmin: true } });
  assert.ok(formatAuditEntry(entry).includes('by admin'));
});

test('Audit: formatAuditEntry renders image review with attachment id', () => {
  const entry = makeEntry({ action: 'poll.image_review', details: { attachmentId: 'att-99', action: 'remove' } });
  assert.ok(formatAuditEntry(entry).includes('att-99'));
  assert.ok(formatAuditEntry(entry).includes('remove'));
});
