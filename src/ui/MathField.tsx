import { memo, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import katex from "katex";

export interface MathFieldProps {
  value: string;
  placeholder?: string;
  invalid?: boolean;
  ariaLabel: string;
  onChange: (value: string) => void;
  /** Enter and arrow navigation, so a row can be committed from the keyboard. */
  onSubmit?: (value: string) => void;
  onCancel?: () => void;
  onDelete?: () => void;
  onArrowDown?: () => void;
  onArrowUp?: () => void;
  /** Live latex for this source; falls back to the raw text when unparseable. */
  latex?: string;
  autoFocus?: boolean;
  spellCheck?: boolean;
}

/**
 * A single-line math input.
 *
 * The typed text is real — a textarea, so selection, undo and IME all behave —
 * but it is painted transparent on top of a KaTeX render of the same source.
 * The textarea uses KaTeX_Main so the caret lands close to the glyphs.
 */
export const MathField = memo(function MathField({
  value,
  placeholder,
  invalid = false,
  ariaLabel,
  onChange,
  onSubmit,
  onCancel,
  onDelete,
  onArrowDown,
  onArrowUp,
  latex,
  autoFocus = false,
  spellCheck = false,
}: MathFieldProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const html = useMemo(() => {
    // Without a latex rendering (the row has not been parsed yet) the typed
    // text is shown literally, in the same font KaTeX would have used.
    if (!latex) return `<span class="field-raw">${escapeHtml(value)}</span>`;
    try {
      return katex.renderToString(latex, {
        throwOnError: false,
        output: "html",
        displayMode: false,
        strict: false,
        trust: false,
      });
    } catch {
      return `<span class="field-raw">${escapeHtml(value)}</span>`;
    }
  }, [latex, value]);

  useLayoutEffect(() => {
    const preview = previewRef.current;
    const input = inputRef.current;
    if (preview && input) preview.style.transform = `translateX(${-input.scrollLeft}px)`;
  }, [html, value]);

  useEffect(() => {
    if (!autoFocus) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, [autoFocus]);

  return (
    <div className={`field${invalid ? " is-invalid" : ""}`}>
      <div className="field-preview" ref={previewRef} aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />
      <textarea
        ref={inputRef}
        className="field-input"
        rows={1}
        value={value}
        placeholder={placeholder}
        spellCheck={spellCheck}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        onScroll={(event) => {
          const preview = previewRef.current;
          if (preview) preview.style.transform = `translateX(${-event.currentTarget.scrollLeft}px)`;
        }}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          switch (event.key) {
            case "Enter":
              event.preventDefault();
              onSubmit?.(value);
              break;
            case "Escape":
              event.preventDefault();
              onCancel?.();
              break;
            case "Backspace":
              if (value.length === 0) {
                event.preventDefault();
                onDelete?.();
              }
              break;
            case "ArrowDown":
              if (!event.altKey) break;
              event.preventDefault();
              onArrowDown?.();
              break;
            case "ArrowUp":
              if (!event.altKey) break;
              event.preventDefault();
              onArrowUp?.();
              break;
            default:
              break;
          }
        }}
      />
    </div>
  );
});

function escapeHtml(text: string): string {
  const span = document.createElement("span");
  span.textContent = text;
  return span.innerHTML;
}