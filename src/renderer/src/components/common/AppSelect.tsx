import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export type AppSelectOption<T extends string> = {
  value: T;
  label: string;
  dotColor?: string | null;
};

export function AppSelect<T extends string>({
  value,
  options,
  onChange,
  className,
  disabled = false,
  ariaLabel,
  minDropdownWidth = 0,
  showDots = true,
}: {
  value: T;
  options: ReadonlyArray<AppSelectOption<T>>;
  onChange: (value: T) => void;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
  minDropdownWidth?: number;
  showDots?: boolean;
}): JSX.Element {
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties>();
  const [selectWidth, setSelectWidth] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLUListElement>(null);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const current = options[selectedIndex] ?? options[0];

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function isOutsideSelect(target: EventTarget | null): boolean {
      if (!(target instanceof Node)) {
        return true;
      }

      return (
        !containerRef.current?.contains(target) &&
        !dropdownRef.current?.contains(target)
      );
    }

    function handlePointerOutside(event: PointerEvent): void {
      if (isOutsideSelect(event.target)) {
        setOpen(false);
      }
    }

    function handleFocusOutside(event: FocusEvent): void {
      if (isOutsideSelect(event.target)) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    function handleWindowBlur(): void {
      setOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerOutside, true);
    document.addEventListener("focusin", handleFocusOutside);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      document.removeEventListener("pointerdown", handlePointerOutside, true);
      document.removeEventListener("focusin", handleFocusOutside);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setFocusedIndex(selectedIndex);
    }
  }, [open, selectedIndex]);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    if (!trigger) {
      return;
    }

    const width = Math.max(
      minDropdownWidth,
      measureDropdownWidth(trigger, options, showDots),
    );
    setSelectWidth((currentWidth) =>
      currentWidth === width ? currentWidth : width,
    );
  }, [minDropdownWidth, options, showDots]);

  useLayoutEffect(() => {
    if (!open) {
      return undefined;
    }

    function positionDropdown(): void {
      const trigger = triggerRef.current;
      if (!trigger) {
        return;
      }

      const rect = trigger.getBoundingClientRect();
      const gap = 6;
      const rowHeight = 36;
      const maxDropdownHeight = Math.min(340, window.innerHeight - 24);
      const dropdownHeight = Math.min(
        options.length * rowHeight + 12,
        maxDropdownHeight,
      );
      const spaceBelow = window.innerHeight - rect.bottom - gap;
      const spaceAbove = rect.top - gap;
      const openUp = spaceBelow < dropdownHeight && spaceAbove > spaceBelow;
      const width = Math.min(
        Math.max(
          rect.width,
          minDropdownWidth,
          measureDropdownWidth(trigger, options, showDots),
        ),
        Math.max(rect.width, window.innerWidth - gap * 2),
      );
      const left = Math.min(
        Math.max(gap, rect.left),
        Math.max(gap, window.innerWidth - width - gap),
      );

      setDropdownStyle({
        position: "fixed",
        top: openUp
          ? Math.max(gap, rect.top - dropdownHeight - gap)
          : rect.bottom + gap,
        left,
        right: "auto",
        width,
        minWidth: width,
        zIndex: 1500,
      });
    }

    positionDropdown();
    window.addEventListener("resize", positionDropdown);
    window.addEventListener("scroll", positionDropdown, true);
    return () => {
      window.removeEventListener("resize", positionDropdown);
      window.removeEventListener("scroll", positionDropdown, true);
    };
  }, [minDropdownWidth, open, options, showDots]);

  function selectOption(option: AppSelectOption<T>): void {
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function handleTriggerKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
  ): void {
    if (disabled || options.length === 0) {
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setOpen(true);
      setFocusedIndex((currentIndex) =>
        wrapOptionIndex(currentIndex + direction, options.length),
      );
      return;
    }

    if (event.key === "Home" && open) {
      event.preventDefault();
      setFocusedIndex(0);
      return;
    }

    if (event.key === "End" && open) {
      event.preventDefault();
      setFocusedIndex(options.length - 1);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) {
        const option = options[focusedIndex] ?? current;
        if (option) {
          selectOption(option);
        }
      } else {
        setOpen(true);
      }
    }
  }

  const dropdown = open ? (
    <ul
      className="custom-select-dropdown custom-select-dropdown-portal"
      id={listboxId}
      role="listbox"
      ref={dropdownRef}
      style={dropdownStyle}
    >
      {options.map((option, index) => (
        <li
          className={`custom-select-option${
            option.value === value ? " selected" : ""
          }${index === focusedIndex ? " focused" : ""}`}
          id={`${listboxId}-${option.value}`}
          role="option"
          aria-selected={option.value === value}
          key={option.value}
          onMouseEnter={() => setFocusedIndex(index)}
          onClick={() => selectOption(option)}
        >
          {showDots ? (
            <span
              className="custom-select-dot"
              style={
                option.dotColor
                  ? { background: option.dotColor }
                  : {
                      background: "transparent",
                      border: "1.5px solid var(--muted)",
                    }
              }
            />
          ) : null}
          <span className="custom-select-option-label">{option.label}</span>
          {option.value === value ? (
            <Check size={13} className="custom-select-check" />
          ) : null}
        </li>
      ))}
    </ul>
  ) : null;
  const containerStyle =
    selectWidth === null
      ? undefined
      : ({
          "--custom-select-width": `${selectWidth}px`,
        } as CSSProperties);

  return (
    <div
      className={`custom-select${className ? ` ${className}` : ""}`}
      ref={containerRef}
      style={containerStyle}
    >
      <button
        className="custom-select-trigger"
        type="button"
        ref={triggerRef}
        onClick={() => setOpen((currentOpen) => !currentOpen)}
        onKeyDown={handleTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={
          open && options[focusedIndex]
            ? `${listboxId}-${options[focusedIndex].value}`
            : undefined
        }
        aria-label={ariaLabel}
        disabled={disabled}
      >
        {showDots && current?.dotColor ? (
          <span
            className="custom-select-dot"
            style={{ background: current.dotColor }}
          />
        ) : null}
        <span className="custom-select-value">{current?.label ?? ""}</span>
        <ChevronDown
          size={13}
          className={`custom-select-chevron${open ? " open" : ""}`}
        />
      </button>
      {dropdown ? createPortal(dropdown, document.body) : null}
    </div>
  );
}

function wrapOptionIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0;
  }

  return (index + length) % length;
}

function measureDropdownWidth<T extends string>(
  trigger: HTMLElement,
  options: ReadonlyArray<AppSelectOption<T>>,
  showDots: boolean,
): number {
  const style = window.getComputedStyle(trigger);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const fallbackWidth = Math.max(
    0,
    ...options.map((option) => option.label.length),
  ) * 8;

  const labelWidth = context
    ? Math.max(
        0,
        ...options.map((option) => {
          context.font = style.font;
          return context.measureText(option.label).width;
        }),
      )
    : fallbackWidth;

  const dropdownPadding = 12;
  const optionPadding = 22;
  const optionGap = showDots ? 20 : 10;
  const dotWidth = showDots ? 8 : 0;
  const checkWidth = 18;
  const borderAllowance = 2;
  return Math.ceil(
    labelWidth +
      dropdownPadding +
      optionPadding +
      optionGap +
      dotWidth +
      checkWidth +
      borderAllowance,
  );
}
