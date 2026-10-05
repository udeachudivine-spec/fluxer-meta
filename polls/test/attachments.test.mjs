/**
 * Phase 2 Tests — Attachment Integration
 *
 * Tests: registration delegation, URL resolution, expired attachments,
 * deleted attachments, and bulk enrichment of options.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Inline the attachment helpers (same pattern as other test files)
// ---------------------------------------------------------------------------

async function registerPollOptionImage(attachmentService, params) {
  return attachmentService.registerAttachment(params);
}

async function resolvePollOptionImageUrls(attachmentService, attachmentId) {
  const attachment = await attachmentService.getAttachment(attachmentId);
  if (!attachment) return null;

  if (attachment.expiresAt !== null && new Date() >= new Date(attachment.expiresAt)) {
    return null;
  }

  const url          = await attachmentService.resolveUrl(attachmentId);
  const thumbnailUrl = await attachmentService.resolveThumbnailUrl(attachmentId);
  if (!url) return null;

  return { url, thumbnailUrl };
}

async function enrichOptionsWithImageUrls(attachmentService, options) {
  return Promise.all(
    options.map(async (opt) => {
      if (!opt.imageAttachmentId) return opt;
      const resolved = await resolvePollOptionImageUrls(attachmentService, opt.imageAttachmentId);
      return {
        ...opt,
        imageUrl:          resolved?.url          ?? null,
        imageThumbnailUrl: resolved?.thumbnailUrl ?? null,
      };
    })
  );
}

// ---------------------------------------------------------------------------
// Helpers / mock factory
// ---------------------------------------------------------------------------

function makeFutureIso(ms = 60 * 60 * 1000) {
  return new Date(Date.now() + ms).toISOString();
}

function makePastIso(ms = 1000) {
  return new Date(Date.now() - ms).toISOString();
}

/**
 * Creates a mock AttachmentService.
 * @param {object} overrides – override specific method implementations
 */
function makeAttachmentService(overrides = {}) {
  return {
    registerAttachment: async (params) => ({
      id:             'att-1',
      messageId:      params.messageId,
      uploaderUserId: params.uploaderUserId,
      uploaderIp:     params.uploaderIp,
      mimeType:       params.mimeType,
      sizeBytes:      params.sizeBytes,
      url:            'https://cdn.fluxer.app/images/att-1.jpg',
      thumbnailUrl:   'https://cdn.fluxer.app/images/att-1_thumb.jpg',
      expiresAt:      null,
      createdAt:      new Date().toISOString(),
    }),
    getAttachment: async (id) => ({
      id,
      messageId:      'msg-1',
      uploaderUserId: 'user-1',
      uploaderIp:     '127.0.0.1',
      mimeType:       'image/jpeg',
      sizeBytes:      102400,
      url:            `https://cdn.fluxer.app/images/${id}.jpg`,
      thumbnailUrl:   `https://cdn.fluxer.app/images/${id}_thumb.jpg`,
      expiresAt:      null,
      createdAt:      new Date().toISOString(),
    }),
    resolveUrl:          async (id) => `https://cdn.fluxer.app/images/${id}.jpg`,
    resolveThumbnailUrl: async (id) => `https://cdn.fluxer.app/images/${id}_thumb.jpg`,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// registerPollOptionImage
// ---------------------------------------------------------------------------

test('Attachments: registerPollOptionImage delegates to the attachment service', async () => {
  let capturedParams = null;
  const service = makeAttachmentService({
    registerAttachment: async (params) => {
      capturedParams = params;
      return {
        id: 'att-new',
        messageId: params.messageId,
        uploaderUserId: params.uploaderUserId,
        uploaderIp: params.uploaderIp,
        mimeType: params.mimeType,
        sizeBytes: params.sizeBytes,
        url: 'https://cdn.fluxer.app/images/att-new.jpg',
        thumbnailUrl: null,
        expiresAt: null,
        createdAt: new Date().toISOString(),
      };
    },
  });

  const result = await registerPollOptionImage(service, {
    fileKey:        'uploads/poll-abc/option-1.jpg',
    messageId:      'msg-poll-123',
    uploaderIp:     '192.168.1.10',
    uploaderUserId: 'user-creator',
    mimeType:       'image/jpeg',
    sizeBytes:      51200,
  });

  // The returned record must include the messageId so it's linked correctly
  assert.equal(result.messageId, 'msg-poll-123');
  // Confirms our params were passed through without modification
  assert.equal(capturedParams.uploaderIp, '192.168.1.10');
  assert.equal(capturedParams.uploaderUserId, 'user-creator');
  assert.equal(capturedParams.messageId, 'msg-poll-123');
});

// ---------------------------------------------------------------------------
// resolvePollOptionImageUrls
// ---------------------------------------------------------------------------

test('Attachments: resolves valid non-expiring attachment URLs', async () => {
  const service = makeAttachmentService();
  const result = await resolvePollOptionImageUrls(service, 'att-1');
  assert.ok(result);
  assert.ok(result.url.includes('att-1'));
  assert.ok(result.thumbnailUrl?.includes('att-1'));
});

test('Attachments: returns null for deleted/missing attachment', async () => {
  const service = makeAttachmentService({
    getAttachment: async () => null,
  });
  const result = await resolvePollOptionImageUrls(service, 'att-gone');
  assert.equal(result, null);
});

test('Attachments: returns null for expired attachment (server clock check)', async () => {
  const service = makeAttachmentService({
    getAttachment: async (id) => ({
      id,
      messageId: 'msg-1',
      uploaderUserId: 'user-1',
      uploaderIp: '127.0.0.1',
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
      url: 'https://cdn.fluxer.app/images/old.jpg',
      thumbnailUrl: null,
      // Set expiresAt in the past so this attachment is considered expired
      expiresAt: makePastIso(5000),
      createdAt: new Date().toISOString(),
    }),
  });
  const result = await resolvePollOptionImageUrls(service, 'att-expired');
  assert.equal(result, null);
});

test('Attachments: treats null expiresAt as never-expiring (standard attachment rule)', async () => {
  // expiresAt: null → should always resolve successfully
  const service = makeAttachmentService({
    getAttachment: async (id) => ({
      id,
      messageId: 'msg-1',
      uploaderUserId: 'user-1',
      uploaderIp: '127.0.0.1',
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
      url: 'https://cdn.fluxer.app/images/forever.jpg',
      thumbnailUrl: null,
      expiresAt: null,
      createdAt: new Date().toISOString(),
    }),
    resolveUrl: async () => 'https://cdn.fluxer.app/images/forever.jpg',
    resolveThumbnailUrl: async () => null,
  });
  const result = await resolvePollOptionImageUrls(service, 'att-forever');
  assert.ok(result);
  assert.equal(result.thumbnailUrl, null);
});

test('Attachments: returns null when resolveUrl returns null (signed URL expired)', async () => {
  const service = makeAttachmentService({
    resolveUrl: async () => null,
  });
  const result = await resolvePollOptionImageUrls(service, 'att-signed');
  assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// enrichOptionsWithImageUrls
// ---------------------------------------------------------------------------

test('Attachments: enrichOptionsWithImageUrls fills URLs for options with attachments', async () => {
  const service = makeAttachmentService();
  const options = [
    { id: 'opt-1', text: 'Red',  imageAttachmentId: 'att-1', imageUrl: null, imageThumbnailUrl: null },
    { id: 'opt-2', text: 'Blue', imageAttachmentId: null,    imageUrl: null, imageThumbnailUrl: null },
  ];

  const enriched = await enrichOptionsWithImageUrls(service, options);

  // opt-1 should now have URLs
  assert.ok(enriched[0].imageUrl?.includes('att-1'));
  assert.ok(enriched[0].imageThumbnailUrl?.includes('att-1'));

  // opt-2 has no attachment — stays null
  assert.equal(enriched[1].imageUrl, null);
  assert.equal(enriched[1].imageThumbnailUrl, null);
});

test('Attachments: enrichOptionsWithImageUrls sets URL to null for expired option image', async () => {
  const service = makeAttachmentService({
    getAttachment: async (id) => ({
      id,
      messageId: 'msg-1',
      uploaderUserId: 'user-1',
      uploaderIp: '127.0.0.1',
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
      url: 'old-url',
      thumbnailUrl: null,
      expiresAt: makePastIso(1000), // expired
      createdAt: new Date().toISOString(),
    }),
  });

  const options = [
    { id: 'opt-1', text: 'Expired Image', imageAttachmentId: 'att-expired', imageUrl: null, imageThumbnailUrl: null },
  ];

  const enriched = await enrichOptionsWithImageUrls(service, options);
  // URL should be null — UI renders placeholder
  assert.equal(enriched[0].imageUrl, null);
});

test('Attachments: enrichOptionsWithImageUrls does not mutate original options array', async () => {
  const service = makeAttachmentService();
  const original = [
    { id: 'opt-1', text: 'Test', imageAttachmentId: 'att-1', imageUrl: null, imageThumbnailUrl: null },
  ];
  const originalUrl = original[0].imageUrl;

  await enrichOptionsWithImageUrls(service, original);

  // Original must not have been mutated
  assert.equal(original[0].imageUrl, originalUrl);
});
