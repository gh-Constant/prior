import { useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./Icon";
import { useFloatingMenu } from "../hooks/useFloatingMenu";
import type { StatusTone } from "../lib/taskStatusAppearance";
import "./CustomSelect.css";

export type CustomSelectOption<T extends string | number = string | number> = {
  value: T;
  label: ReactNode;
  icon?: IconName;
  color?: string;
  tone?: StatusTone;
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
  const isPill = className.includes("custom-select-pill");

  const floating = useFloatingMenu(triggerRef, {
    open,
    onClose: () => setOpen(false),
    isPill,
    offset: 4,
    estimatedHeight: Math.min(options.length * 36 + 10, 260),
  });

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

  const menuContent = open ? (
    <div
      ref={floating.menuRef}
      className={`custom-select-menu ${floating.placement === "top" ? "open-top" : "open-bottom"} ${isPill ? "custom-select-menu-pill" : ""}`.trim()}
      role="listbox"
      aria-label={ariaLabel}
      style={floating.style}
    >
      {options.map((option) => {
        const isSelected = String(option.value) === String(value);
        return (
          <button
            key={String(option.value)}
            type="button"
            role="option"
            aria-selected={isSelected}
            disabled={option.disabled}
            className={`custom-select-item ${isSelected ? "selected" : ""} ${option.tone ? "has-tone" : ""}`}
            style={option.tone}
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
  ) : null;

  return (
    <div className={`custom-select-wrap ${className}`.trim()} ref={containerRef}>
      <div
        ref={triggerRef}
        role="button"
        tabIndex={disabled ? -1 : 0}
        className={`custom-select-trigger ${open ? "open" : ""} ${disabled ? "disabled" : ""} ${selectedOption?.tone ? "has-tone" : ""}`}
        style={selectedOption?.tone}
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

      {floating.portalTarget && menuContent ? createPortal(menuContent, floating.portalTarget) : menuContent}

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
