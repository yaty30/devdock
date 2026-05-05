import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import type { Ref } from "react";

export function formatFindCount(
  activeIndex: number,
  matchCount: number,
  searching = false,
): string {
  if (searching || matchCount <= 0) {
    return "0/0";
  }

  return `${Math.min(activeIndex + 1, matchCount)}/${matchCount}`;
}

export function FindControls({
  id,
  value,
  activeIndex,
  matchCount,
  onChange,
  onPrevious,
  onNext,
  onClear,
  ariaLabel = "Find",
  className = "log-find-row",
  inputRef,
  searching = false,
}: {
  id?: string;
  value: string;
  activeIndex: number;
  matchCount: number;
  onChange: (value: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  onClear: () => void;
  ariaLabel?: string;
  className?: string;
  inputRef?: Ref<HTMLInputElement>;
  searching?: boolean;
}): JSX.Element {
  const hasMatches = matchCount > 0 && !searching;

  return (
    <div className={className}>
      <div className="find-input-shell">
        <Search size={14} />
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={value}
          aria-label={ariaLabel}
          placeholder="Find"
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      <span className="log-find-count">
        {formatFindCount(activeIndex, matchCount, searching)}
      </span>
      <button
        className="find-icon-button"
        type="button"
        aria-label="Previous match"
        title="Previous match"
        disabled={!hasMatches}
        onClick={onPrevious}
      >
        <ChevronUp size={13} />
      </button>
      <button
        className="find-icon-button"
        type="button"
        aria-label="Next match"
        title="Next match"
        disabled={!hasMatches}
        onClick={onNext}
      >
        <ChevronDown size={13} />
      </button>
      <button
        className="find-icon-button"
        type="button"
        aria-label="Clear find"
        title="Clear find"
        disabled={!value}
        onClick={onClear}
      >
        <X size={13} />
      </button>
    </div>
  );
}
