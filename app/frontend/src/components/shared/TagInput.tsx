/**
 * TagInput — display and edit a list of tags/keywords with add/remove affordances.
 */

import { useCallback, useRef, useState } from "react";

export interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  label?: string;
  hint?: string;
  disabled?: boolean;
  maxTags?: number;
}

export default function TagInput({
  tags,
  onChange,
  placeholder = "Add a keyword and press Enter…",
  label,
  hint,
  disabled = false,
  maxTags,
}: TagInputProps) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleAdd = useCallback(() => {
    const trimmed = input.trim().toLowerCase();
    if (!trimmed) return;
    if (tags.includes(trimmed)) {
      setInput("");
      return;
    }
    if (maxTags && tags.length >= maxTags) {
      return;
    }
    onChange([...tags, trimmed]);
    setInput("");
    inputRef.current?.focus();
  }, [input, tags, onChange, maxTags]);

  const handleRemove = useCallback(
    (tagToRemove: string) => {
      onChange(tags.filter((tag) => tag !== tagToRemove));
    },
    [tags, onChange]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  };

  const isFull = maxTags && tags.length >= maxTags;

  return (
    <div className="space-y-2">
      {label && (
        <label className="block text-sm font-medium text-gray-900">{label}</label>
      )}
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <div
            key={tag}
            className="inline-flex items-center gap-2 bg-indigo-100 text-indigo-900 px-3 py-1 rounded-full text-sm"
          >
            <span>{tag}</span>
            <button
              type="button"
              onClick={() => handleRemove(tag)}
              disabled={disabled}
              className="hover:text-indigo-600 disabled:opacity-50"
              aria-label={`Remove ${tag}`}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <input
        ref={inputRef}
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled || (!!isFull)}
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 focus:border-indigo-500 focus:outline-none disabled:bg-gray-50 disabled:text-gray-500"
      />
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
      {isFull && (
        <p className="text-xs text-amber-600">
          Maximum {maxTags} keywords reached.
        </p>
      )}
    </div>
  );
}
