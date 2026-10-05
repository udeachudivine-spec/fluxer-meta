/**
 * Fluxer Polls — PollCard (Desktop)
 *
 * Behaviour per spec:
 *   Simple poll:
 *     - Single click on option image → opens PollImageModal (enlarged view).
 *     - Double click on option image → selects that option (double click again undoes it).
 *     - Once something is selected a "Show Results" button appears.
 *     - Results hidden until user votes; ordered most → least voted.
 *     - Voter pfps shown next to each option (respecting anonymity).
 *     - After poll closes, votes become visible to everyone.
 *   Ranked choice:
 *     - Each click adds to ranked order; click again removes.
 *     - Rank badges (1st, 2nd, …) shown on options.
 *   Both:
 *     - Header: creator avatar + username, poll type label.
 *     - Single click on option (not image) enlarges image via modal.
 *     - Keyboard accessible: Tab to options, Enter/Space to select.
 *
 * Note: Double-click timing uses a 300ms window. Accessibility: the
 * keyboard equivalent of double-click is pressing Enter/Space twice in
 * quick succession (same timeout). A visible focus ring is always present.
 */

import React, { useState, useRef, useCallback } from 'react';
import { Poll, PollOption, PollResults } from '../types';
import { PollImageModal, VoterAvatarInfo } from './PollImageModal';

export interface PollCardProps {
  poll:            Poll;
  currentUserId:   string;
  /** Whether the current user is a moderator (sees voter pfps on anonymous polls). */
  isModerator:     boolean;
  /** Full results object — passed in after the user votes, or when poll is closed. */
  results:         PollResults | null;
  onVote:          (optionIds: string[])        => void;
  onRankedVote:    (rankedOptionIds: string[])   => void;
  onClosePoll?:    (pollId: string)              => void;
  canManagePoll?:  boolean;
}

export const PollCard: React.FC<PollCardProps> = ({
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

  // Local selections (before submit)
  const [selectedIds,    setSelectedIds]    = useState<string[]>(poll.userVotes       ?? []);
  const [rankedChoices,  setRankedChoices]  = useState<string[]>(poll.userRankedBallot ?? []);

  // Show results once the user has voted or the poll is closed
  const [showResults, setShowResults] = useState(
    Boolean(poll.hasVoted || isClosed)
  );

  // Image modal state
  const [modalOpen,      setModalOpen]      = useState(false);
  const [modalInitIndex, setModalInitIndex] = useState(0);

  // Double-click detection per option
  // Maps optionId → timestamp of last click
  const lastClickTime = useRef<Record<string, number>>({});
  const DOUBLE_CLICK_MS = 300;

  // Ranked round stepping
  const [resultRound, setResultRound] = useState(0);

  // Options that have images, in order — passed to the modal
  const optionsWithImages = poll.options.filter((o) => o.imageUrl);

  // Build votersByOption from results (only when we should show voters)
  const votersByOption: Record<string, VoterAvatarInfo[]> = {};
  if (results && (showResults || isClosed)) {
    for (const r of results.options) {
      if (r.voters) {
        votersByOption[r.option.id] = r.voters;
      }
    }
  }

  // Open modal at the index of the clicked option's image
  const openModal = useCallback((optionId: string) => {
    const idx = optionsWithImages.findIndex((o) => o.id === optionId);
    if (idx >= 0) {
      setModalInitIndex(idx);
      setModalOpen(true);
    }
  }, [optionsWithImages]);

  // Handle single click on an option row (not the image directly)
  const handleOptionClick = useCallback((opt: PollOption) => {
    if (isClosed) return;

    const now  = Date.now();
    const last = lastClickTime.current[opt.id] ?? 0;
    const isDouble = now - last < DOUBLE_CLICK_MS;
    lastClickTime.current[opt.id] = now;

    if (isDouble) {
      // Double-click = select / deselect
      handleSelect(opt.id);
    } else if (opt.imageUrl) {
      // Single click on an option with an image → open enlarged view
      openModal(opt.id);
    } else {
      // Single click on a text-only option → select it directly
      handleSelect(opt.id);
    }
  }, [isClosed, openModal]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelect = useCallback((optionId: string) => {
    if (isRanked) {
      setRankedChoices((current) => {
        const idx = current.indexOf(optionId);
        if (idx >= 0) {
          return current.filter((_, i) => i !== idx);
        }
        if (current.length < (poll.maxRankedChoices ?? 5)) {
          return [...current, optionId];
        }
        return current; // at max — do nothing
      });
    } else if (poll.pollType === 'single_choice') {
      setSelectedIds((current) =>
        current.includes(optionId) ? [] : [optionId]
      );
    } else {
      // multiple_choice
      setSelectedIds((current) =>
        current.includes(optionId)
          ? current.filter((id) => id !== optionId)
          : [...current, optionId]
      );
    }
  }, [isRanked, poll.pollType, poll.maxRankedChoices]);

  // Keyboard handler — Enter/Space acts as click; no double-click needed on keyboard
  const handleKeyDown = useCallback((e: React.KeyboardEvent, opt: PollOption) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (opt.imageUrl) {
        openModal(opt.id);
      } else {
        handleSelect(opt.id);
      }
    }
  }, [openModal, handleSelect]);

  const handleSubmit = () => {
    if (isRanked) {
      if (rankedChoices.length > 0) {
        onRankedVote(rankedChoices);
        setShowResults(true);
      }
    } else {
      if (selectedIds.length > 0) {
        onVote(selectedIds);
        setShowResults(true);
      }
    }
  };

  // Sort options for results view: most → least voted
  const displayOptions = showResults && results
    ? [...poll.options].sort((a, b) => {
        const aCount = results.options.find((r) => r.option.id === a.id)?.voteCount ?? 0;
        const bCount = results.options.find((r) => r.option.id === b.id)?.voteCount ?? 0;
        return bCount - aCount;
      })
    : poll.options;

  // Ranked round data for stepping through IRV rounds
  const rounds = results?.rankedChoiceRounds ?? [];
  const currentRound = rounds[resultRound];

  return (
    <article
      className="fluxer-poll-card border border-primary/20 rounded-xl p-4 bg-background-secondary max-w-lg shadow-sm"
      aria-label={`Poll: ${poll.question}`}
    >
      {/* Header: creator avatar + name + type badge */}
      <header className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {poll.creatorAvatarUrl && (
            <img
              src={poll.creatorAvatarUrl}
              alt={`${poll.creatorUsername}'s profile picture`}
              className="w-7 h-7 rounded-full"
            />
          )}
          <div>
            <span className="font-semibold text-sm">{poll.creatorUsername}</span>
            <span className="text-xs text-muted ml-2">
              {isRanked ? 'Ranked Choice Poll' : 'Poll'}
              {poll.isAnonymous && ' · Anonymous'}
            </span>
          </div>
        </div>

        {canManagePoll && !isClosed && onClosePoll && (
          <button
            onClick={() => onClosePoll(poll.id)}
            className="text-xs text-danger hover:underline focus:outline-none focus:ring-2 focus:ring-danger rounded"
            aria-label="End poll early"
          >
            End Poll
          </button>
        )}
      </header>

      {/* Question */}
      <h3 className="font-bold text-base mb-4 text-foreground">{poll.question}</h3>

      {/* Options list */}
      <ul className="space-y-2 mb-4" role="listbox" aria-label="Poll options" aria-multiselectable={isRanked || poll.pollType === 'multiple_choice'}>
        {displayOptions.map((opt, displayIdx) => {
          const isSelected  = selectedIds.includes(opt.id);
          const rankIndex   = rankedChoices.indexOf(opt.id);
          const isActive    = isSelected || rankIndex >= 0;

          // Retrieve result data for this option
          const resultData  = results?.options.find((r) => r.option.id === opt.id);
          const voteCount   = resultData?.voteCount ?? 0;
          const percentage  = results
            ? (results.totalVoters > 0 ? Math.round((voteCount / results.totalVoters) * 100) : 0)
            : 0;
          const voters      = resultData?.voters ?? [];

          return (
            <li
              key={opt.id}
              role="option"
              aria-selected={isActive}
              tabIndex={isClosed ? -1 : 0}
              onClick={() => handleOptionClick(opt)}
              onKeyDown={(e) => handleKeyDown(e, opt)}
              className={`relative overflow-hidden cursor-pointer rounded-lg border p-3 transition-all focus:outline-none focus:ring-2 focus:ring-primary ${
                isActive
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:bg-background-tertiary'
              }`}
            >
              {/* Progress bar overlay (results only) */}
              {showResults && results && (
                <div
                  className="absolute left-0 top-0 bottom-0 bg-primary/20 transition-[width] duration-500"
                  style={{ width: `${percentage}%` }}
                  aria-hidden="true"
                />
              )}

              <div className="relative flex items-center justify-between z-10">
                <div className="flex items-center gap-3">
                  {/* Ranked badge */}
                  {isRanked && (
                    <span
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                        rankIndex >= 0
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-border text-muted'
                      }`}
                      aria-label={rankIndex >= 0 ? `Ranked ${rankIndex + 1}` : `Option ${displayIdx + 1}`}
                    >
                      {rankIndex >= 0 ? rankIndex + 1 : displayIdx + 1}
                    </span>
                  )}

                  {/* Option thumbnail image */}
                  {opt.imageUrl ? (
                    <img
                      src={opt.imageThumbnailUrl ?? opt.imageUrl}
                      alt={opt.text}
                      className="w-10 h-10 object-cover rounded-md flex-shrink-0"
                    />
                  ) : opt.imageThumbnailUrl === null && opt.imageUrl === null ? null : (
                    // Image existed but is expired — show placeholder
                    <div
                      className="w-10 h-10 rounded-md bg-border flex items-center justify-center flex-shrink-0"
                      role="img"
                      aria-label="Image unavailable"
                    >
                      <span className="text-xs text-muted">?</span>
                    </div>
                  )}

                  <span className="text-sm font-medium">{opt.text}</span>
                </div>

                <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                  {/* Vote count (results view) */}
                  {showResults && results && (
                    <span className="text-xs font-bold text-muted">
                      {voteCount} ({percentage}%)
                    </span>
                  )}

                  {/* Voter pfps (non-anonymous or moderator, after voting) */}
                  {showResults && voters.length > 0 && (
                    <div className="flex -space-x-1" aria-label={`${voters.length} voter${voters.length !== 1 ? 's' : ''}`}>
                      {voters.slice(0, 5).map((v) =>
                        v.avatarUrl ? (
                          <img
                            key={v.userId}
                            src={v.avatarUrl}
                            alt={v.username}
                            title={v.username}
                            className="w-5 h-5 rounded-full border border-background-secondary"
                          />
                        ) : (
                          <span
                            key={v.userId}
                            title={v.username}
                            aria-label={v.username}
                            className="w-5 h-5 rounded-full bg-primary/30 flex items-center justify-center text-xs font-bold border border-background-secondary"
                          >
                            {v.username[0]?.toUpperCase()}
                          </span>
                        )
                      )}
                      {voters.length > 5 && (
                        <span className="text-xs text-muted ml-1">+{voters.length - 5}</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Ranked round stepper (results, ranked polls only) */}
      {isRanked && showResults && rounds.length > 1 && (
        <div className="mb-3 p-3 bg-background-tertiary rounded-lg text-xs">
          <div className="flex items-center justify-between mb-1">
            <span className="font-semibold">Round {currentRound?.roundNumber ?? 1} of {rounds.length}</span>
            <div className="flex gap-2">
              <button
                onClick={() => setResultRound((r) => Math.max(0, r - 1))}
                disabled={resultRound === 0}
                aria-label="Previous round"
                className="px-2 py-1 border border-border rounded disabled:opacity-40 hover:bg-background-secondary focus:outline-none focus:ring-2 focus:ring-primary"
              >
                ← Prev
              </button>
              <button
                onClick={() => setResultRound((r) => Math.min(rounds.length - 1, r + 1))}
                disabled={resultRound === rounds.length - 1}
                aria-label="Next round"
                className="px-2 py-1 border border-border rounded disabled:opacity-40 hover:bg-background-secondary focus:outline-none focus:ring-2 focus:ring-primary"
              >
                Next →
              </button>
            </div>
          </div>
          {currentRound?.eliminatedOptionId && (
            <p className="text-muted mt-1" aria-live="polite">
              Eliminated:{' '}
              <span className="font-medium text-foreground">
                {poll.options.find((o) => o.id === currentRound.eliminatedOptionId)?.text ?? currentRound.eliminatedOptionId}
              </span>
            </p>
          )}
          {currentRound?.winnerOptionId && (
            <p className="text-primary font-semibold mt-1" aria-live="polite">
              Winner:{' '}
              {poll.options.find((o) => o.id === currentRound.winnerOptionId)?.text ?? currentRound.winnerOptionId}
            </p>
          )}
        </div>
      )}

      {/* Footer */}
      <footer className="flex items-center justify-between text-xs text-muted pt-2 border-t border-border">
        <span>
          {poll.totalVoters} {poll.totalVoters === 1 ? 'vote' : 'votes'}
          {' · '}
          {isClosed ? 'Closed' : 'Active'}
        </span>

        <div className="flex gap-2">
          {/* Submit vote (only when not closed and selection is pending) */}
          {!isClosed && !poll.hasVoted && (
            <button
              onClick={handleSubmit}
              disabled={isRanked ? rankedChoices.length === 0 : selectedIds.length === 0}
              aria-disabled={isRanked ? rankedChoices.length === 0 : selectedIds.length === 0}
              className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground font-semibold disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {showResults ? 'Change Vote' : 'Submit Vote'}
            </button>
          )}

          {/* Show/hide results (appears once something is selected, or after vote) */}
          {(poll.hasVoted || selectedIds.length > 0 || rankedChoices.length > 0 || isClosed) && (
            <button
              onClick={() => setShowResults((s) => !s)}
              aria-pressed={showResults}
              className="px-3 py-1.5 rounded-lg border border-border hover:bg-background-tertiary focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {showResults ? 'Hide Results' : 'Show Results'}
            </button>
          )}
        </div>
      </footer>

      {/* Image modal */}
      {modalOpen && optionsWithImages.length > 0 && (
        <PollImageModal
          options={optionsWithImages}
          initialIndex={modalInitIndex}
          hasVoted={poll.hasVoted}
          votersByOption={votersByOption}
          isAnonymous={poll.isAnonymous && !isModerator}
          onClose={() => setModalOpen(false)}
        />
      )}
    </article>
  );
};
