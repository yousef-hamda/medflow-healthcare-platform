"use client";

import { Input } from "@medflow/ui";
import { useId, useMemo, useState } from "react";

export interface CodeOption {
  code: string;
  display: string;
}

interface CodeAutocompleteProps {
  options: CodeOption[];
  placeholder: string;
  label: string;
  onSelect: (option: CodeOption) => void;
}

/**
 * Accessible combobox over a bundled value set. Native datalist would be
 * simpler but offers no display/code separation; this keeps full control while
 * remaining keyboard-navigable via the listbox pattern.
 */
export function CodeAutocomplete({
  options,
  placeholder,
  label,
  onSelect,
}: CodeAutocompleteProps): JSX.Element {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listId = useId();

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 8);
    return options
      .filter((o) => o.display.toLowerCase().includes(q) || o.code.includes(q))
      .slice(0, 8);
  }, [options, query]);

  const choose = (option: CodeOption): void => {
    onSelect(option);
    setQuery("");
    setOpen(false);
    setActiveIndex(-1);
  };

  return (
    <div className="relative">
      <Input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined}
        aria-label={label}
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActiveIndex((i) => Math.min(i + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter" && activeIndex >= 0) {
            e.preventDefault();
            const option = matches[activeIndex];
            if (option) choose(option);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && matches.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover p-1 shadow-lg"
        >
          {matches.map((option, index) => (
            <li
              key={option.code}
              id={`${listId}-opt-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className={`cursor-pointer rounded-sm px-2 py-1.5 text-sm ${
                index === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(option);
              }}
            >
              <span className="font-medium">{option.display}</span>{" "}
              <span className="font-mono text-xs text-muted-foreground">{option.code}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
