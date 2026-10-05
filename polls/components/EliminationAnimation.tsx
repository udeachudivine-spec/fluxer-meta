/**
 * EliminationAnimation — ranked choice round elimination drop animation
 *
 * Shown when the round stepper moves to the next round and an option is
 * eliminated. The eliminated option row briefly "drops" (slides down + fades
 * out) before disappearing.
 *
 * Accessibility:
 *   - Respects `prefers-reduced-motion`. When the media query is active,
 *     the element is removed instantly with no animation.
 *   - An aria-live="polite" region announces the elimination to screen
 *     readers whether or not animation plays.
 *
 * Usage:
 *   Render this component next to the eliminated option row in PollCard's
 *   ranked round stepper. The parent passes `isEliminating` which triggers
 *   the animation; on completion `onAnimationEnd` is called so the parent
 *   can advance the state.
 */

import React, { useEffect, useRef } from 'react';

/** Returns true if the user prefers reduced motion. */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface EliminationAnimationProps {
  /** Text label of the eliminated option (for aria-live announcement). */
  eliminatedOptionText: string;
  /** When true, the animation starts. */
  isEliminating:        boolean;
  /** Called when the animation (or instant removal) completes. */
  onAnimationEnd:       () => void;
  children:             React.ReactNode;
}

export const EliminationAnimation: React.FC<EliminationAnimationProps> = ({
  eliminatedOptionText,
  isEliminating,
  onAnimationEnd,
  children,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const reduced      = prefersReducedMotion();

  useEffect(() => {
    if (!isEliminating) return;

    if (reduced) {
      // No animation — remove immediately
      onAnimationEnd();
      return;
    }

    // Apply the drop animation via inline style transitions.
    // We use CSS transitions rather than a library to avoid new dependencies.
    const el = containerRef.current;
    if (!el) { onAnimationEnd(); return; }

    // Phase 1: slide down + fade out over 400ms
    el.style.transition   = 'transform 400ms ease-in, opacity 400ms ease-in';
    el.style.transform    = 'translateY(24px)';
    el.style.opacity      = '0';

    const timer = setTimeout(() => {
      onAnimationEnd();
    }, 420); // slightly after the transition ends

    return () => clearTimeout(timer);
  }, [isEliminating, reduced, onAnimationEnd]);

  return (
    <>
      {/* Screen-reader announcement — fires regardless of motion preference */}
      {isEliminating && (
        <span
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
        >
          {eliminatedOptionText} has been eliminated from the ranked choice round.
        </span>
      )}

      <div ref={containerRef} style={{ willChange: isEliminating && !reduced ? 'transform, opacity' : 'auto' }}>
        {children}
      </div>
    </>
  );
};
