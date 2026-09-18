import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import "./CustomSelect.css";

export type CustomSelectOption<T extends string | number = string | number> = {
  value: T;
  label: ReactNode;
  icon?: IconName;
  color?: string;
  disabled?: boolean;
};

export type CustomSelectProps<T extends string | number = string | number> = {
  readonly id?: string;
  readonly name?: string;
  readonly value: T;
  readonly options: readonly CustomSelectOption<T>[];
  readonly onChange: (value: T) => void;
  readonly ariaLabel?: string;
  readonly disabled?: boolean;
  readonly placeholder?: string;
  readonly className?: string;
  readonly renderTriggerLabel?: (selected?: CustomSelectOption<T>) => ReactNode;
};

export function CustomSelect<T extends string | number = string | number>({
  id,
  name,
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
  placeholder,
  className = "",
  renderTriggerLabel,
}: CustomSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const generatedId = useId();
  const selectId = id ?? generatedId;

  const selectedOption = options.find((opt) => String(opt.value) === String(value));

  // Close when clicking outside
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function handleSelect(option: CustomSelectOption<T>) {
    if (option.disabled || disabled) return;
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const currentIndex = options.findIndex((opt) => String(opt.value) === String(value));
      const step = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex = (currentIndex + step + options.length) % options.length;
      const nextOption = options[nextIndex];
      if (nextOption && !nextOption.disabled) {
        onChange(nextOption.value);
      }
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen((prev) => !prev);
    }
  }

  return (
    <div className={`custom-select-wrap ${className}`.trim()} ref={containerRef}>
      <div
        ref={triggerRef}
        role="button"
        tabIndex={disabled ? -1 : 0}
        className={`custom-select-trigger ${open ? "open" : ""} ${disabled ? "disabled" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-disabled={disabled}
        onClick={() => { if (!disabled) setOpen((prev) => !prev); }}
        onKeyDown={handleKeyDown}
      >
        <span className="custom-select-trigger-content">
          {renderTriggerLabel ? (
            renderTriggerLabel(selectedOption)
          ) : selectedOption ? (
            <>
              {selectedOption.icon && <Icon name={selectedOption.icon} className="custom-select-icon" />}
              {selectedOption.color && (
                <span className="custom-select-color-dot" style={{ backgroundColor: selectedOption.color }} />
              )}
              <span className="custom-select-text">{selectedOption.label}</span>
            </>
          ) : (
            <span className="custom-select-placeholder">{placeholder ?? ""}</span>
          )}
        </span>
        <Icon name="chevron-down" className={`custom-select-chevron ${open ? "rotated" : ""}`} />
      </div>

      {open && (
        <div className="custom-select-menu" role="listbox" aria-label={ariaLabel}>
          {options.map((option) => {
            const isSelected = String(option.value) === String(value);
            return (
              <button
                key={String(option.value)}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={option.disabled}
                className={`custom-select-item ${isSelected ? "selected" : ""}`}
                onClick={() => handleSelect(option)}
              >
                {option.icon && <Icon name={option.icon} className="custom-select-icon" />}
                {option.color && (
                  <span className="custom-select-color-dot" style={{ backgroundColor: option.color }} />
                )}
                <span className="custom-select-item-label">{option.label}</span>
                {isSelected && <Icon name="check" className="custom-select-check" />}
              </button>
            );
          })}
        </div>
      )}

      {/* Visually-hidden native select for full accessibility, tests, and form parity */}
      <select
        id={selectId}
        name={name}
        aria-label={ariaLabel}
        value={String(value)}
        disabled={disabled}
        tabIndex={-1}
        className="custom-select-native-hidden"
        onChange={(event) => {
          const match = options.find((opt) => String(opt.value) === event.target.value);
          if (match) onChange(match.value);
        }}
      >
        {options.map((option) => (
          <option
            key={String(option.value)}
            value={String(option.value)}
            disabled={option.disabled}
            label={typeof option.label === "string" ? option.label : String(option.value)}
          />
        ))}
      </select>
    </div>
  );
}
