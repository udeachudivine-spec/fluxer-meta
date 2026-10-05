/**
 * PollImageModal — Accessible enlarged image viewer for poll options (desktop)
 *
 * Behaviour:
 *   - Opens when user single-clicks an option image (or presses Enter/Space on it).
 *   - Left/Right arrow keys AND on-screen buttons navigate between options.
 *   - Esc closes the modal.
 *   - Focus is trapped inside the modal while open; restored to the trigger on close.
 *   - When voter profile pictures are provided they appear in the bottom corner.
 *   - WCAG 2.1 AA: role="dialog", aria-modal, aria-label, visible focus ring,
 *     alt text on every image, sufficient contrast assumed from design tokens.
 */

import React, { useEffect, useRef, useCallback } from 'react';
import { PollOption } from '../types';

export interface VoterAvatarInfo {
  userId:    string;
  username:  string;
  avatarUrl: string | null;
}

export interface PollImageModalProps {
  /** All options that have images, in display order. */
  options:       PollOption[];
  /** Index into `options` that was clicked — modal opens here. */
  initialIndex:  number;
  /** Whether the calling user has already voted (controls voter tray visibility). */
  hasVoted:      boolean;
  /** Voter info per optionId — only passed when the user has voted and poll is non-anonymous (or caller is mod). */
  votersByOption: Record<string, VoterAvatarInfo[]>;
  isAnonymous:   boolean;
  onClose:       () => void;
}

export const PollImageModal: React.FC<PollImageModalProps> = ({
  options,
  initialIndex,
  hasVoted,
  votersByOption,
  isAnonymous,
  onClose,
}) => {
  const [currentIndex, setCurrentIndex] = React.useState(initialIndex);
  const dialogRef   = useRef<HTMLDivElement>(null);
  const closeRef    = useRef<HTMLButtonElement>(null);
  // We store the element that opened the modal so we can restore focus on close
  const triggerRef  = useRef<Element | null>(null);

  // Capture trigger on mount
  useEffect(() => {
    triggerRef.current = document.activeElement;
    // Move focus to close button immediately
    closeRef.current?.focus();
  }, []);

  // Restore focus on unmount
  useEffect(() => {
    return () => {
      if (triggerRef.current instanceof HTMLElement) {
        triggerRef.current.focus();
      }
    };
  }, []);

  const goNext = useCallback(() => {
    setCurrentIndex((i) => (i + 1) % options.length);
  }, [options.length]);

  const goPrev = useCallback(() => {
    setCurrentIndex((i) => (i - 1 + options.length) % options.length);
  }, [options.length]);

  // Keyboard navigation + focus trap
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape')      { onClose(); return; }
      if (e.key === 'ArrowRight')  { goNext();  return; }
      if (e.key === 'ArrowLeft')   { goPrev();  return; }

      // Focus trap: keep Tab/Shift+Tab inside the dialog
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const first = focusable[0];
        const last  = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [goNext, goPrev, onClose]);

  const current = options[currentIndex];
  if (!current) return null;

  const voters = (!isAnonymous && hasVoted) ? (votersByOption[current.id] ?? []) : [];
  // Alt text: use the option text as the caption/alt
  const altText = current.text || `Poll option ${currentIndex + 1}`;

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75"
      // Click outside the dialog box closes it
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      aria-hidden="false"
    >
      {/* Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Poll image viewer: ${altText}`}
        className="relative flex flex-col items-center max-w-3xl w-full mx-4 bg-background-secondary rounded-2xl shadow-2xl overflow-hidden"
      >
        {/* Close button */}
        <button
          ref={closeRef}
          onClick={onClose}
          aria-label="Close image viewer"
          className="absolute top-3 right-3 z-10 w-9 h-9 flex items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/75 focus:outline-none focus:ring-2 focus:ring-white"
        >
          {/* × character — screenreader uses aria-label above */}
          <span aria-hidden="true">✕</span>
        </button>

        {/* Image area */}
        <div className="relative w-full flex items-center justify-center bg-black min-h-64">
          {current.imageUrl ? (
            <img
              src={current.imageUrl}
              alt={altText}
              className="max-h-[70vh] max-w-full object-contain"
            />
          ) : (
            // Expired / deleted image placeholder
            <div
              className="flex items-center justify-center w-full h-64 text-muted text-sm"
              role="img"
              aria-label={`Image unavailable for: ${altText}`}
            >
              Image unavailable
            </div>
          )}

          {/* Navigation: prev */}
          {options.length > 1 && (
            <button
              onClick={goPrev}
              aria-label="Previous option image"
              className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/75 focus:outline-none focus:ring-2 focus:ring-white"
            >
              <span aria-hidden="true">‹</span>
            </button>
          )}

          {/* Navigation: next */}
          {options.length > 1 && (
            <button
              onClick={goNext}
              aria-label="Next option image"
              className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/75 focus:outline-none focus:ring-2 focus:ring-white"
            >
              <span aria-hidden="true">›</span>
            </button>
          )}
        </div>

        {/* Caption */}
        <div className="w-full px-6 py-3 flex items-center justify-between">
          <p className="text-sm font-medium text-foreground">{current.text}</p>
          {options.length > 1 && (
            <span className="text-xs text-muted" aria-live="polite">
              {currentIndex + 1} / {options.length}
            </span>
          )}
        </div>

        {/* Voter avatars — only shown when hasVoted and not anonymous */}
        {voters.length > 0 && (
          <div
            className="w-full px-6 pb-4 flex items-center gap-1.5"
            aria-label={`${voters.length} voter${voters.length !== 1 ? 's' : ''} chose this option`}
          >
            <span className="text-xs text-muted mr-1" aria-hidden="true">Voters:</span>
            {voters.slice(0, 12).map((v) => (
              v.avatarUrl ? (
                <img
                  key={v.userId}
                  src={v.avatarUrl}
                  alt={v.username}
                  title={v.username}
                  className="w-6 h-6 rounded-full border border-border"
                />
              ) : (
                <span
                  key={v.userId}
                  title={v.username}
                  aria-label={v.username}
                  className="w-6 h-6 rounded-full bg-primary/30 flex items-center justify-center text-xs font-bold"
                >
                  {v.username[0]?.toUpperCase()}
                </span>
              )
            ))}
            {voters.length > 12 && (
              <span className="text-xs text-muted">+{voters.length - 12} more</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
