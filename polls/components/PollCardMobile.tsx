/**
 * Fluxer Polls — PollCardMobile
 *
 * Mobile-specific behaviour per spec:
 *   - If options have images: tapping an option opens an image carousel
 *     that can be swiped through (touch swipe left/right).
 *   - Press-and-hold (long press, 500ms) on an option SELECTS it.
 *     Press-and-hold again on a selected option UNDOES the selection.
 *   - Non-gesture alternative: a visible "Select" / "Deselect" button
 *     inside the carousel (accessibility requirement).
 *   - Same results behaviour and closing behaviour as desktop.
 *   - Ranked choice: same ranked badge logic; carousel shows rank number.
 *
 * Implementation notes:
 *   - Long-press uses onTouchStart + onTouchEnd + a setTimeout.
 *     Cancels if the finger moves (onTouchMove).
 *   - Swipe detection: track touchstart X, compare to touchend X,
 *     threshold 50px.
 *   - No new dependencies — gesture detection is inline.
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Poll, PollOption, PollResults } from '../types';
import { VoterAvatarInfo } from './PollImageModal';

export interface PollCardMobileProps {
  poll:           Poll;
  currentUserId:  string;
  isModerator:    boolean;
  results:        PollResults | null;
  onVote:         (optionIds: string[])       => void;
  onRankedVote:   (rankedOptionIds: string[]) => void;
  onClosePoll?:   (pollId: string)            => void;
  canManagePoll?: boolean;
}

const LONG_PRESS_MS = 500;
const SWIPE_THRESHOLD_PX = 50;

export const PollCardMobile: React.FC<PollCardMobileProps> = ({
  poll,
  currentUserId,
  isModerator,
  results,
  onVote,
  onRankedVote,
  onClosePoll,
  canManagePoll = false,
}) => {
  const isRanked = poll.pollType === 'ranked_choice';
  const isClosed = poll.status === 'closed';

  const [selectedIds,   setSelectedIds]   = useState<string[]>(poll.userVotes       ?? []);
  const [rankedChoices, setRankedChoices] = useState<string[]>(poll.userRankedBallot ?? []);
  const [showResults,   setShowResults]   = useState(Boolean(poll.hasVoted || isClosed));

  // Carousel state: which option is currently shown
  const [carouselOpen,  setCarouselOpen]  = useState(false);
  const [carouselIndex, setCarouselIndex] = useState(0);

  // Long-press timer ref per option
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchMoved     = useRef(false);

  // Swipe tracking
  const swipeStartX = useRef<number | null>(null);

  const optionsWithImages = poll.options.filter((o) => o.imageUrl);
  const hasImages = optionsWithImages.length > 0;

  // Build votersByOption (same as desktop)
  const votersByOption: Record<string, VoterAvatarInfo[]> = {};
  if (results && (showResults || isClosed)) {
    for (const r of results.options) {
      if (r.voters) votersByOption[r.option.id] = r.voters;
    }
  }

  const handleSelect = useCallback((optionId: string) => {
    if (isClosed) return;

    if (isRanked) {
      setRankedChoices((current) => {
        const idx = current.indexOf(optionId);
        if (idx >= 0) return current.filter((_, i) => i !== idx);
        if (current.length < (poll.maxRankedChoices ?? 5)) return [...current, optionId];
        return current;
      });
    } else if (poll.pollType === 'single_choice') {
      setSelectedIds((current) => current.includes(optionId) ? [] : [optionId]);
    } else {
      setSelectedIds((current) =>
        current.includes(optionId)
          ? current.filter((id) => id !== optionId)
          : [...current, optionId]
      );
    }
  }, [isClosed, isRanked, poll.pollType, poll.maxRankedChoices]);

  // Long-press handlers
  const handleTouchStart = useCallback((optionId: string, e: React.TouchEvent) => {
    touchMoved.current = false;
    longPressTimer.current = setTimeout(() => {
      if (!touchMoved.current) {
        handleSelect(optionId);
      }
    }, LONG_PRESS_MS);
  }, [handleSelect]);

  const handleTouchMove = useCallback(() => {
    touchMoved.current = true;
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
    }
  }, []);

  // Tap on option — opens carousel if images exist, otherwise selects
  const handleTap = useCallback((opt: PollOption) => {
    if (isClosed) return;

    if (hasImages && opt.imageUrl) {
      const idx = optionsWithImages.findIndex((o) => o.id === opt.id);
      setCarouselIndex(idx >= 0 ? idx : 0);
      setCarouselOpen(true);
    }
    // For text-only options, tap opens nothing (long-press is the select gesture)
    // But we still provide a "Select" button in the row for accessibility
  }, [isClosed, hasImages, optionsWithImages]);

  const handleSubmit = () => {
    if (isRanked) {
      if (rankedChoices.length > 0) { onRankedVote(rankedChoices); setShowResults(true); }
    } else {
      if (selectedIds.length > 0)   { onVote(selectedIds);        setShowResults(true); }
    }
  };

  // Results sort
  const displayOptions = showResults && results
    ? [...poll.options].sort((a, b) => {
        const aVotes = results.options.find((r) => r.option.id === a.id)?.voteCount ?? 0;
        const bVotes = results.options.find((r) => r.option.id === b.id)?.voteCount ?? 0;
        return bVotes - aVotes;
      })
    : poll.options;

  // Carousel navigation
  const carouselNext = () => setCarouselIndex((i) => (i + 1) % optionsWithImages.length);
  const carouselPrev = () => setCarouselIndex((i) => (i - 1 + optionsWithImages.length) % optionsWithImages.length);

  // Carousel swipe handlers
  const handleCarouselTouchStart = (e: React.TouchEvent) => {
    swipeStartX.current = e.touches[0].clientX;
  };

  const handleCarouselTouchEnd = (e: React.TouchEvent) => {
    if (swipeStartX.current === null) return;
    const delta = e.changedTouches[0].clientX - swipeStartX.current;
    swipeStartX.current = null;
    if (delta < -SWIPE_THRESHOLD_PX) carouselNext();
    else if (delta > SWIPE_THRESHOLD_PX) carouselPrev();
  };

  const currentCarouselOption = optionsWithImages[carouselIndex];
  const carouselOptionIsSelected =
    selectedIds.includes(currentCarouselOption?.id ?? '') ||
    rankedChoices.includes(currentCarouselOption?.id ?? '');

  return (
    <article
      className="fluxer-poll-card-mobile border border-primary/20 rounded-xl p-3 bg-background-secondary shadow-sm"
      aria-label={`Poll: ${poll.question}`}
    >
      {/* Header */}
      <header className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {poll.creatorAvatarUrl && (
            <img
              src={poll.creatorAvatarUrl}
              alt={`${poll.creatorUsername}'s profile picture`}
              className="w-6 h-6 rounded-full"
            />
          )}
          <span className="font-semibold text-xs">{poll.creatorUsername}</span>
          <span className="text-xs text-muted">
            {isRanked ? '· Ranked' : '· Poll'}
            {poll.isAnonymous && ' · Anon'}
          </span>
        </div>
        {canManagePoll && !isClosed && onClosePoll && (
          <button
            onClick={() => onClosePoll(poll.id)}
            className="text-xs text-danger focus:outline-none focus:ring-2 focus:ring-danger rounded"
          >
            End
          </button>
        )}
      </header>

      <h3 className="font-bold text-sm mb-3">{poll.question}</h3>

      {/* Options */}
      <ul className="space-y-2 mb-3" role="listbox" aria-label="Poll options">
        {displayOptions.map((opt) => {
          const isSelected  = selectedIds.includes(opt.id);
          const rankIndex   = rankedChoices.indexOf(opt.id);
          const isActive    = isSelected || rankIndex >= 0;

          const resultData  = results?.options.find((r) => r.option.id === opt.id);
          const voteCount   = resultData?.voteCount ?? 0;
          const pct         = results && results.totalVoters > 0
            ? Math.round((voteCount / results.totalVoters) * 100) : 0;
          const voters      = resultData?.voters ?? [];

          return (
            <li
              key={opt.id}
              role="option"
              aria-selected={isActive}
              className={`relative overflow-hidden rounded-lg border p-2.5 transition-all ${
                isActive ? 'border-primary bg-primary/10' : 'border-border'
              }`}
              onTouchStart={(e) => handleTouchStart(opt.id, e)}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onClick={() => handleTap(opt)}
            >
              {/* Progress bar */}
              {showResults && results && (
                <div
                  className="absolute left-0 top-0 bottom-0 bg-primary/20 transition-[width] duration-500"
                  style={{ width: `${pct}%` }}
                  aria-hidden="true"
                />
              )}

              <div className="relative flex items-center justify-between z-10">
                <div className="flex items-center gap-2">
                  {/* Ranked badge */}
                  {isRanked && (
                    <span
                      className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                        rankIndex >= 0 ? 'bg-primary text-primary-foreground' : 'bg-border text-muted'
                      }`}
                      aria-label={rankIndex >= 0 ? `Ranked ${rankIndex + 1}` : undefined}
                    >
                      {rankIndex >= 0 ? rankIndex + 1 : '·'}
                    </span>
                  )}

                  {/* Thumbnail */}
                  {opt.imageUrl && (
                    <img
                      src={opt.imageThumbnailUrl ?? opt.imageUrl}
                      alt={opt.text}
                      className="w-8 h-8 rounded object-cover flex-shrink-0"
                    />
                  )}

                  <span className="text-sm">{opt.text}</span>
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {showResults && results && (
                    <span className="text-xs text-muted">{pct}%</span>
                  )}

                  {/* Voter pfps */}
                  {showResults && voters.length > 0 && (
                    <div className="flex -space-x-1" aria-label={`${voters.length} voters`}>
                      {voters.slice(0, 3).map((v) =>
                        v.avatarUrl ? (
                          <img key={v.userId} src={v.avatarUrl} alt={v.username} title={v.username}
                            className="w-4 h-4 rounded-full border border-background-secondary" />
                        ) : (
                          <span key={v.userId} title={v.username} aria-label={v.username}
                            className="w-4 h-4 rounded-full bg-primary/30 flex items-center justify-center text-xs font-bold border border-background-secondary">
                            {v.username[0]?.toUpperCase()}
                          </span>
                        )
                      )}
                    </div>
                  )}

                  {/* Non-gesture fallback select button (accessibility) */}
                  {!isClosed && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleSelect(opt.id); }}
                      aria-label={isActive ? `Deselect ${opt.text}` : `Select ${opt.text}`}
                      aria-pressed={isActive}
                      className={`text-xs px-2 py-0.5 rounded border focus:outline-none focus:ring-2 focus:ring-primary ${
                        isActive
                          ? 'border-primary text-primary bg-primary/10'
                          : 'border-border text-muted'
                      }`}
                    >
                      {isActive ? 'Deselect' : 'Select'}
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Footer */}
      <footer className="flex items-center justify-between text-xs text-muted pt-2 border-t border-border">
        <span>{poll.totalVoters} {poll.totalVoters === 1 ? 'vote' : 'votes'} · {isClosed ? 'Closed' : 'Active'}</span>
        <div className="flex gap-2">
          {!isClosed && !poll.hasVoted && (
            <button
              onClick={handleSubmit}
              disabled={isRanked ? rankedChoices.length === 0 : selectedIds.length === 0}
              className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground font-semibold disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary text-xs"
            >
              Submit
            </button>
          )}
          {(poll.hasVoted || selectedIds.length > 0 || rankedChoices.length > 0 || isClosed) && (
            <button
              onClick={() => setShowResults((s) => !s)}
              aria-pressed={showResults}
              className="px-2 py-1.5 rounded-lg border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {showResults ? 'Hide' : 'Results'}
            </button>
          )}
        </div>
      </footer>

      {/* Image Carousel Modal */}
      {carouselOpen && hasImages && currentCarouselOption && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85"
          onClick={(e) => { if (e.target === e.currentTarget) setCarouselOpen(false); }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Image carousel: ${currentCarouselOption.text}`}
            className="relative w-full max-w-sm flex flex-col"
            onTouchStart={handleCarouselTouchStart}
            onTouchEnd={handleCarouselTouchEnd}
          >
            {/* Close */}
            <button
              onClick={() => setCarouselOpen(false)}
              aria-label="Close carousel"
              className="absolute top-2 right-2 z-10 w-9 h-9 flex items-center justify-center rounded-full bg-black/60 text-white focus:outline-none focus:ring-2 focus:ring-white"
            >
              <span aria-hidden="true">✕</span>
            </button>

            {/* Image */}
            <div className="flex items-center justify-center bg-black min-h-48 relative">
              {currentCarouselOption.imageUrl ? (
                <img
                  src={currentCarouselOption.imageUrl}
                  alt={currentCarouselOption.text}
                  className="max-h-[60vh] max-w-full object-contain"
                />
              ) : (
                <div className="text-muted text-sm p-8" role="img" aria-label="Image unavailable">
                  Image unavailable
                </div>
              )}

              {/* Arrow nav buttons (also keyboard accessible) */}
              {optionsWithImages.length > 1 && (
                <>
                  <button onClick={carouselPrev} aria-label="Previous"
                    className="absolute left-2 w-9 h-9 rounded-full bg-black/50 text-white flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-white">
                    <span aria-hidden="true">‹</span>
                  </button>
                  <button onClick={carouselNext} aria-label="Next"
                    className="absolute right-2 w-9 h-9 rounded-full bg-black/50 text-white flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-white">
                    <span aria-hidden="true">›</span>
                  </button>
                </>
              )}

              {/* Rank badge in carousel (ranked polls) */}
              {isRanked && rankedChoices.includes(currentCarouselOption.id) && (
                <div className="absolute top-2 left-2 bg-primary text-primary-foreground text-xs font-bold rounded-full px-2 py-0.5"
                  aria-label={`Ranked ${rankedChoices.indexOf(currentCarouselOption.id) + 1}`}>
                  #{rankedChoices.indexOf(currentCarouselOption.id) + 1}
                </div>
              )}
            </div>

            {/* Caption + counter */}
            <div className="bg-background-secondary px-4 py-3">
              <p className="text-sm font-medium">{currentCarouselOption.text}</p>
              <p className="text-xs text-muted mt-0.5" aria-live="polite">
                {carouselIndex + 1} / {optionsWithImages.length}
              </p>
            </div>

            {/* Non-gesture select button — always visible inside carousel */}
            {!isClosed && (
              <div className="bg-background-secondary px-4 pb-4">
                <button
                  onClick={() => handleSelect(currentCarouselOption.id)}
                  aria-pressed={carouselOptionIsSelected}
                  aria-label={carouselOptionIsSelected
                    ? `Deselect ${currentCarouselOption.text}`
                    : `Select ${currentCarouselOption.text}`}
                  className={`w-full py-2 rounded-lg border text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary ${
                    carouselOptionIsSelected
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-foreground hover:bg-background-tertiary'
                  }`}
                >
                  {carouselOptionIsSelected ? 'Deselect' : 'Select this option'}
                </button>
              </div>
            )}

            {/* Voter pfps in bottom corner (in carousel, after voting) */}
            {!poll.isAnonymous || isModerator
              ? (votersByOption[currentCarouselOption.id] ?? []).length > 0 && (
                <div className="bg-background-secondary px-4 pb-3 flex items-center gap-1"
                  aria-label="Voters for this option">
                  <span className="text-xs text-muted mr-1">Voters:</span>
                  {(votersByOption[currentCarouselOption.id] ?? []).slice(0, 8).map((v) =>
                    v.avatarUrl ? (
                      <img key={v.userId} src={v.avatarUrl} alt={v.username} title={v.username}
                        className="w-5 h-5 rounded-full" />
                    ) : (
                      <span key={v.userId} title={v.username} aria-label={v.username}
                        className="w-5 h-5 rounded-full bg-primary/30 flex items-center justify-center text-xs font-bold">
                        {v.username[0]?.toUpperCase()}
                      </span>
                    )
                  )}
                </div>
              )
              : null
            }
          </div>
        </div>
      )}
    </article>
  );
};
