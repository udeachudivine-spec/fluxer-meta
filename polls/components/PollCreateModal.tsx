/**
 * Fluxer Polls — PollCreateModal
 *
 * Creation menu spec:
 *   - Title (question), duration picker, option list with per-option image
 *     upload + text, toggle for ranked voting, toggle for anonymous votes,
 *     toggle for custom write-in responses, configurable max total answers.
 *   - Confirm button posts the poll into chat.
 *   - Hidden entirely when the user lacks the SEND_POLLS permission.
 *   - Accessible: labelled fields, focus management, keyboard operable.
 *   - Image uploads are sent to the parent via onImageUpload; the parent
 *     calls the existing attachment pipeline and returns the attachmentId.
 *     We do not handle upload directly — no parallel pipeline.
 */

import React, { useState, useRef, useEffect } from 'react';
import { CreatePollInput, PollType } from '../types';

export interface PollCreateModalProps {
  channelId:      string;
  /** Whether the current user has the SEND_POLLS permission. If false, render nothing. */
  hasPollPermission: boolean;
  isOpen:         boolean;
  onClose:        () => void;
  onSubmit:       (input: CreatePollInput) => void;
  /**
   * Called when the user selects an image for an option.
   * The parent should upload the file via the existing attachment pipeline
   * and resolve with the attachment's public URL and its ID.
   */
  onImageUpload:  (file: File, optionIndex: number) => Promise<{ url: string; attachmentId: string }>;
}

interface OptionDraft {
  text:           string;
  imageUrl:       string | null;
  attachmentId:   string | null;
  uploading:      boolean;
}

const DURATION_PRESETS = [
  { label: '1 hour',   minutes: 60 },
  { label: '6 hours',  minutes: 360 },
  { label: '1 day',    minutes: 1440 },
  { label: '3 days',   minutes: 4320 },
  { label: '7 days',   minutes: 10080 },
];

const DEFAULT_MAX_ANSWERS = 20;
const MIN_OPTIONS         = 2;
const MAX_OPTIONS_HARD    = 200; // hard cap from schema

export const PollCreateModal: React.FC<PollCreateModalProps> = ({
  channelId,
  hasPollPermission,
  isOpen,
  onClose,
  onSubmit,
  onImageUpload,
}) => {
  const [question,       setQuestion]       = useState('');
  const [pollType,       setPollType]       = useState<PollType>('single_choice');
  const [durationMinutes, setDurationMinutes] = useState(1440); // default: 1 day
  const [isAnonymous,    setIsAnonymous]    = useState(false);
  const [allowCustom,    setAllowCustom]    = useState(false);
  const [maxAnswers,     setMaxAnswers]     = useState(DEFAULT_MAX_ANSWERS);
  const [options,        setOptions]        = useState<OptionDraft[]>([
    { text: '', imageUrl: null, attachmentId: null, uploading: false },
    { text: '', imageUrl: null, attachmentId: null, uploading: false },
  ]);
  const [errors,         setErrors]         = useState<string[]>([]);

  const firstFieldRef = useRef<HTMLInputElement>(null);
  const triggerRef    = useRef<Element | null>(null);

  // Capture trigger, focus first field, restore on close
  useEffect(() => {
    if (isOpen) {
      triggerRef.current = document.activeElement;
      setTimeout(() => firstFieldRef.current?.focus(), 50);
    } else if (triggerRef.current instanceof HTMLElement) {
      triggerRef.current.focus();
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // If user lacks permission, render nothing (creation UI is hidden)
  if (!hasPollPermission) return null;

  const handleAddOption = () => {
    if (options.length >= Math.min(maxAnswers, MAX_OPTIONS_HARD)) return;
    setOptions([...options, { text: '', imageUrl: null, attachmentId: null, uploading: false }]);
  };

  const handleRemoveOption = (idx: number) => {
    if (options.length <= MIN_OPTIONS) return;
    setOptions(options.filter((_, i) => i !== idx));
  };

  const handleOptionTextChange = (idx: number, text: string) => {
    const next = [...options];
    next[idx] = { ...next[idx], text };
    setOptions(next);
  };

  const handleImageSelect = async (idx: number, file: File) => {
    // Mark uploading
    setOptions((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], uploading: true };
      return next;
    });

    try {
      const { url, attachmentId } = await onImageUpload(file, idx);
      setOptions((prev) => {
        const next = [...prev];
        next[idx] = { ...next[idx], imageUrl: url, attachmentId, uploading: false };
        return next;
      });
    } catch {
      // Upload failed — leave imageUrl null, stop spinner
      setOptions((prev) => {
        const next = [...prev];
        next[idx] = { ...next[idx], uploading: false };
        return next;
      });
      setErrors((e) => [...e, `Image upload for option ${idx + 1} failed.`]);
    }
  };

  const validate = (): boolean => {
    const errs: string[] = [];
    if (!question.trim()) errs.push('Question cannot be empty.');

    const validOptions = options.filter((o) => o.text.trim().length > 0);
    if (validOptions.length < MIN_OPTIONS) errs.push('At least 2 options are required.');
    if (validOptions.length > maxAnswers)  errs.push(`Number of options exceeds the max answer limit (${maxAnswers}).`);

    const invalidMax = !Number.isInteger(maxAnswers) || maxAnswers < 2 || maxAnswers > MAX_OPTIONS_HARD;
    if (invalidMax) errs.push('Max answers must be between 2 and 200.');

    setErrors(errs);
    return errs.length === 0;
  };

  const handleCreate = () => {
    if (!validate()) return;

    const validOptions = options.filter((o) => o.text.trim().length > 0);

    onSubmit({
      channelId,
      question: question.trim(),
      pollType,
      options: validOptions.map((o) => ({
        text:             o.text.trim(),
        imageUrl:         o.imageUrl  ?? undefined,
        imageAttachmentId: o.attachmentId ?? undefined,
      })),
      durationMinutes,
      isAnonymous,
      allowCustomResponses: allowCustom,
      maxTotalAnswers:  maxAnswers,
    });

    onClose();
  };

  const canAdd = options.length < Math.min(maxAnswers, MAX_OPTIONS_HARD);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Create a poll"
        className="bg-background-secondary border border-border rounded-2xl p-6 w-full max-w-lg shadow-2xl overflow-y-auto max-h-[90vh]"
      >
        <h2 className="text-lg font-bold mb-4" id="poll-modal-title">Create a Poll</h2>

        {/* Validation errors */}
        {errors.length > 0 && (
          <ul role="alert" className="mb-3 p-3 bg-danger/10 border border-danger rounded-lg text-xs text-danger space-y-1">
            {errors.map((err, i) => <li key={i}>{err}</li>)}
          </ul>
        )}

        {/* Question */}
        <div className="mb-4">
          <label htmlFor="poll-question" className="block text-xs font-semibold uppercase text-muted mb-1">
            Question <span aria-hidden="true">*</span>
          </label>
          <input
            id="poll-question"
            ref={firstFieldRef}
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask a question…"
            maxLength={500}
            aria-required="true"
            className="w-full p-2.5 rounded-lg bg-background-tertiary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        {/* Poll type (ranked toggle) */}
        <div className="mb-4">
          <label htmlFor="poll-type" className="block text-xs font-semibold uppercase text-muted mb-1">
            Voting Mode
          </label>
          <select
            id="poll-type"
            value={pollType}
            onChange={(e) => setPollType(e.target.value as PollType)}
            className="w-full p-2.5 rounded-lg bg-background-tertiary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="single_choice">Single Choice</option>
            <option value="multiple_choice">Multiple Choice</option>
            <option value="ranked_choice">Ranked Choice (Instant-Runoff)</option>
          </select>
        </div>

        {/* Duration */}
        <div className="mb-4">
          <label htmlFor="poll-duration" className="block text-xs font-semibold uppercase text-muted mb-1">
            Duration
          </label>
          <select
            id="poll-duration"
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(Number(e.target.value))}
            className="w-full p-2.5 rounded-lg bg-background-tertiary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {DURATION_PRESETS.map((d) => (
              <option key={d.minutes} value={d.minutes}>{d.label}</option>
            ))}
          </select>
        </div>

        {/* Max total answers */}
        <div className="mb-4">
          <label htmlFor="poll-max-answers" className="block text-xs font-semibold uppercase text-muted mb-1">
            Max total answers (creator + write-ins)
          </label>
          <input
            id="poll-max-answers"
            type="number"
            value={maxAnswers}
            min={2}
            max={MAX_OPTIONS_HARD}
            onChange={(e) => setMaxAnswers(Number(e.target.value))}
            className="w-full p-2.5 rounded-lg bg-background-tertiary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <p className="text-xs text-muted mt-1">Enforced server-side. Includes custom write-in answers.</p>
        </div>

        {/* Options */}
        <fieldset className="mb-4">
          <legend className="block text-xs font-semibold uppercase text-muted mb-2">
            Options <span className="font-normal normal-case">(min 2)</span>
          </legend>
          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {options.map((opt, i) => (
              <div key={i} className="flex items-center gap-2">
                {/* Image upload for this option */}
                <label
                  htmlFor={`poll-opt-img-${i}`}
                  className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-background-tertiary border border-border cursor-pointer hover:bg-border focus-within:ring-2 focus-within:ring-primary"
                  title="Upload image for this option"
                  aria-label={`Upload image for option ${i + 1}`}
                >
                  {opt.uploading ? (
                    <span className="text-xs animate-spin" aria-hidden="true">⟳</span>
                  ) : opt.imageUrl ? (
                    <img
                      src={opt.imageUrl}
                      alt={`Uploaded image for option ${i + 1}`}
                      className="w-full h-full object-cover rounded-lg"
                    />
                  ) : (
                    <span className="text-lg text-muted" aria-hidden="true">🖼</span>
                  )}
                  <input
                    id={`poll-opt-img-${i}`}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleImageSelect(i, file);
                    }}
                  />
                </label>

                {/* Option text */}
                <input
                  type="text"
                  value={opt.text}
                  onChange={(e) => handleOptionTextChange(i, e.target.value)}
                  placeholder={`Option ${i + 1}`}
                  aria-label={`Option ${i + 1} text`}
                  maxLength={200}
                  className="flex-1 p-2 rounded-lg bg-background-tertiary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />

                {/* Remove button (disabled when at minimum) */}
                {options.length > MIN_OPTIONS && (
                  <button
                    type="button"
                    onClick={() => handleRemoveOption(i)}
                    aria-label={`Remove option ${i + 1}`}
                    className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-muted hover:text-danger hover:bg-danger/10 focus:outline-none focus:ring-2 focus:ring-danger"
                  >
                    <span aria-hidden="true">✕</span>
                  </button>
                )}
              </div>
            ))}
          </div>

          {canAdd && (
            <button
              type="button"
              onClick={handleAddOption}
              className="text-xs text-primary font-semibold mt-2 hover:underline focus:outline-none focus:ring-2 focus:ring-primary rounded"
            >
              + Add Option
            </button>
          )}
          {!canAdd && (
            <p className="text-xs text-muted mt-1">Max options reached ({Math.min(maxAnswers, MAX_OPTIONS_HARD)}).</p>
          )}
        </fieldset>

        {/* Toggles */}
        <div className="space-y-3 mb-6 text-sm">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={isAnonymous}
              onChange={(e) => setIsAnonymous(e.target.checked)}
              className="rounded focus:ring-primary"
              aria-describedby="anon-hint"
            />
            <span>Anonymous Voting</span>
          </label>
          <p id="anon-hint" className="text-xs text-muted ml-6 -mt-2">
            Community members won't see who voted. Moderators still can.
          </p>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={allowCustom}
              onChange={(e) => setAllowCustom(e.target.checked)}
              className="rounded focus:ring-primary"
            />
            <span>Allow write-in (custom) answers</span>
          </label>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-border text-sm font-semibold hover:bg-background-tertiary focus:outline-none focus:ring-2 focus:ring-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            className="px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
};
