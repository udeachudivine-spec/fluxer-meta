/**
 * Fluxer Polls — Attachment Integration
 *
 * Poll image uploads reuse the existing Fluxer attachment/upload pipeline.
 * This module defines:
 *   1. The adapter interface the existing pipeline must satisfy (so this code
 *      stays testable and doesn't duplicate the pipeline).
 *   2. Helper functions for registering poll images with the pipeline,
 *      resolving their URLs, and handling expired attachments gracefully.
 *
 * Design decision: we do NOT build a parallel upload pipeline. Every poll
 * image must go through the same AttachmentService that handles message
 * images, with the same expiry rules, the same IP/messageId logging, and
 * the same admin image tooling.
 */

// ---------------------------------------------------------------------------
// Adapter interface — implement against your real AttachmentService
// ---------------------------------------------------------------------------

/**
 * The minimum surface of the existing attachment pipeline that polls need.
 * Implement this wrapper around whatever attachment service is already in use.
 */
export interface AttachmentService {
  /**
   * Register an already-uploaded file as an attachment associated with a
   * specific message. Returns the canonical attachment record.
   *
   * Call this when a poll is created: pass the poll's messageId so the
   * attachment is associated the same way a regular message image would be.
   *
   * @param params.fileKey      storage key (S3 key, CDN path, etc.)
   * @param params.messageId    the poll's message_id
   * @param params.uploaderIp   request IP — logged for moderation
   * @param params.uploaderUserId  user who uploaded the image
   * @param params.mimeType     e.g. "image/jpeg"
   * @param params.sizeBytes    file size for quota tracking
   */
  registerAttachment(params: {
    fileKey:        string;
    messageId:      string;
    uploaderIp:     string;
    uploaderUserId: string;
    mimeType:       string;
    sizeBytes:      number;
  }): Promise<AttachmentRecord>;

  /**
   * Retrieve a single attachment by its ID.
   * Returns null if the attachment has been deleted or does not exist.
   */
  getAttachment(attachmentId: string): Promise<AttachmentRecord | null>;

  /**
   * Returns the public URL for an attachment. If the attachment uses signed
   * URLs (e.g. S3 presigned), this refreshes the signature.
   * Returns null if the attachment has expired or been removed.
   */
  resolveUrl(attachmentId: string): Promise<string | null>;

  /**
   * Returns the thumbnail URL, if the pipeline generates thumbnails.
   * Returns null when unavailable or expired.
   */
  resolveThumbnailUrl(attachmentId: string): Promise<string | null>;
}

/** Canonical attachment record as returned by the existing pipeline. */
export interface AttachmentRecord {
  id:             string;
  messageId:      string;
  uploaderUserId: string;
  uploaderIp:     string;
  mimeType:       string;
  sizeBytes:      number;
  url:            string;
  thumbnailUrl:   string | null;
  /** ISO 8601. Null means the attachment never expires (same rule as std images). */
  expiresAt:      string | null;
  createdAt:      string;
}

// ---------------------------------------------------------------------------
// Poll-specific helpers
// ---------------------------------------------------------------------------

/**
 * Associates a poll option's uploaded image with the poll's message via the
 * existing attachment pipeline. Call this for each option image when creating
 * a poll or when a user uploads an image for a custom write-in option.
 *
 * Returns the attachment record so the caller can store attachmentId on the
 * poll_options row (image_attachment_id column).
 */
export async function registerPollOptionImage(
  attachmentService: AttachmentService,
  params: {
    fileKey:        string;
    messageId:      string;    // poll's messageId — ties the image to the poll message
    uploaderIp:     string;
    uploaderUserId: string;
    mimeType:       string;
    sizeBytes:      number;
  }
): Promise<AttachmentRecord> {
  // Delegate entirely to the existing pipeline — no custom logic here.
  return attachmentService.registerAttachment(params);
}

/**
 * Resolves the current URL for a poll option image, handling expiry gracefully.
 *
 * Returns:
 *   { url, thumbnailUrl }  when the attachment is valid
 *   null                   when the attachment has expired or been deleted
 *
 * Callers should render a placeholder image when null is returned.
 */
export async function resolvePollOptionImageUrls(
  attachmentService: AttachmentService,
  attachmentId: string
): Promise<{ url: string; thumbnailUrl: string | null } | null> {
  const attachment = await attachmentService.getAttachment(attachmentId);

  if (!attachment) {
    // Deleted or never existed
    return null;
  }

  // Check expiry using the same rule the existing pipeline uses: compare
  // expiresAt to server time. A null expiresAt means the image does not expire.
  if (attachment.expiresAt !== null && new Date() >= new Date(attachment.expiresAt)) {
    return null; // expired — render placeholder
  }

  const url          = await attachmentService.resolveUrl(attachmentId);
  const thumbnailUrl = await attachmentService.resolveThumbnailUrl(attachmentId);

  if (!url) return null; // resolveUrl returning null means expired/removed

  return { url, thumbnailUrl };
}

/**
 * Enriches a list of poll options with their resolved image URLs.
 * Options whose images have expired get imageUrl/imageThumbnailUrl set to null
 * so the UI can render a placeholder without crashing.
 *
 * Designed to be called server-side before serialising the poll response.
 */
export async function enrichOptionsWithImageUrls<
  T extends { imageAttachmentId: string | null; imageUrl: string | null; imageThumbnailUrl: string | null }
>(
  attachmentService: AttachmentService,
  options: T[]
): Promise<T[]> {
  return Promise.all(
    options.map(async (opt) => {
      if (!opt.imageAttachmentId) {
        // No image on this option — leave as-is
        return opt;
      }

      const resolved = await resolvePollOptionImageUrls(attachmentService, opt.imageAttachmentId);

      return {
        ...opt,
        imageUrl:          resolved?.url          ?? null,
        imageThumbnailUrl: resolved?.thumbnailUrl ?? null,
      };
    })
  );
}
