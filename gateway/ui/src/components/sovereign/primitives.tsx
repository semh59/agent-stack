/**
 * Alloy design-system primitives.
 *
 * These are the low-level building blocks the console is composed from.
 * Everything here is presentation-only — no data fetching, no routing, no
 * Zustand. Feel free to reuse across Settings, Chat, Missions.
 *
 * Design principles:
 *   - Dark-first. Light theme is a flip of the tokens in index.css.
 *   - One knob for spacing density via the `density` prop on containers.
 *   - All inputs forward `ref` and accept native HTML attrs (no footguns).
 *   - Accent color is `--color-alloy-accent` today; we plan to rename the
 *     tokens to `--color-sov-*` in a follow-up CSS sweep without touching
 *     these components.
 */
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import clsx from "clsx";

// ─────────────────────────────────────────────────────────────────────────────
// Card — the canonical "group of settings" container
// ─────────────────────────────────────────────────────────────────────────────

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  density?: "compact" | "comfortable";
  tone?: "neutral" | "accent" | "warning" | "danger";
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, density = "comfortable", tone = "neutral", children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={clsx(
        "rounded-2xl border bg-[var(--color-alloy-surface)] shadow-[0_20px_80px_-40px_rgba(0,0,0,0.9)]",
        density === "comfortable" ? "p-6" : "p-4",
        tone === "neutral" && "border-[var(--color-alloy-border)]",
        tone === "accent" && "border-[var(--color-alloy-accent)]/30",
        tone === "warning" && "border-amber-500/40",
        tone === "danger" && "border-red-500/40",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
});

export interface SectionProps extends HTMLAttributes<HTMLElement> {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}

export function Section({
  title,
  description,
  action,
  icon,
  className,
  children,
  ...rest
}: SectionProps) {
  return (
    <section className={clsx("space-y-4", className)} {...rest}>
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {icon ? (
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--color-alloy-border)] bg-[var(--color-alloy-bg)] text-[var(--color-alloy-accent)]">
              {icon}
            </div>
          ) : null}
          <div>
            <h2 className="font-display text-base tracking-wide text-white">
              {title}
            </h2>
            {description ? (
              <p className="mt-1 max-w-prose text-xs text-[var(--color-alloy-text-sec)]">
                {description}
              </p>
            ) : null}
          </div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      <div>{children}</div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Button
// ─────────────────────────────────────────────────────────────────────────────

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, loading, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-ui font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-alloy-accent)]/60 disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" && "px-3 py-1.5 text-xs",
        size === "md" && "px-4 py-2 text-sm",
        size === "lg" && "px-5 py-2.5 text-sm",
        variant === "primary" &&
          "bg-[var(--color-alloy-accent)] text-black hover:bg-[var(--color-alloy-accent)]/90",
        variant === "secondary" &&
          "border border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)] text-white hover:border-[var(--color-alloy-accent)]/40 hover:bg-[var(--color-alloy-surface-hover)]",
        variant === "ghost" &&
          "text-[var(--color-alloy-text-sec)] hover:bg-[var(--color-alloy-border)] hover:text-white",
        variant === "danger" &&
          "border border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20",
        className,
      )}
      {...rest}
    >
      {loading ? (
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : icon ? (
        <span className="inline-flex items-center">{icon}</span>
      ) : null}
      {children}
    </button>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Form field wrapper
// ─────────────────────────────────────────────────────────────────────────────

export interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
  trailing?: ReactNode;
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
  trailing,
}: FieldProps) {
  return (
    <div className={clsx("space-y-1.5", className)}>
      <div className="flex items-center justify-between">
        <Label htmlFor={htmlFor}>
          {label}
          {required ? <span className="ml-1 text-red-400">*</span> : null}
        </Label>
        {trailing ? <div className="text-xs text-[var(--color-alloy-text-sec)]">{trailing}</div> : null}
      </div>
      {children}
      {hint && !error ? (
        <p className="text-xs text-[var(--color-alloy-text-sec)]">{hint}</p>
      ) : null}
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
    </div>
  );
}

export const Label = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement>>(
  function Label({ className, children, ...rest }, ref) {
    return (
      <label
        ref={ref}
        className={clsx(
          "block font-ui text-[11px] font-bold uppercase tracking-widest text-[var(--color-alloy-text-sec)]",
          className,
        )}
        {...rest}
      >
        {children}
      </label>
    );
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Input, Textarea, Select
// ─────────────────────────────────────────────────────────────────────────────

const inputStyles =
  "w-full rounded-lg border bg-[var(--color-alloy-bg)] px-3 py-2 text-sm text-white placeholder:text-[var(--color-alloy-text-sec)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-alloy-accent)]/60 disabled:cursor-not-allowed disabled:opacity-50";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={clsx(
        inputStyles,
        invalid
          ? "border-red-500/60 focus-visible:ring-red-500/60"
          : "border-[var(--color-alloy-border)] hover:border-[var(--color-alloy-border-bright)]",
        className,
      )}
      {...rest}
    />
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ className, invalid, rows = 4, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        rows={rows}
        className={clsx(
          inputStyles,
          "resize-y font-body",
          invalid
            ? "border-red-500/60 focus-visible:ring-red-500/60"
            : "border-[var(--color-alloy-border)] hover:border-[var(--color-alloy-border-bright)]",
          className,
        )}
        {...rest}
      />
    );
  },
);

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, invalid, children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      className={clsx(
        inputStyles,
        "appearance-none bg-[var(--color-alloy-bg)] pr-9",
        invalid
          ? "border-red-500/60 focus-visible:ring-red-500/60"
          : "border-[var(--color-alloy-border)] hover:border-[var(--color-alloy-border-bright)]",
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Switch (boolean toggle)
// ─────────────────────────────────────────────────────────────────────────────

export interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
}

export function Switch({ checked, onChange, disabled, ariaLabel }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-alloy-accent)]/60 disabled:cursor-not-allowed disabled:opacity-50",
        checked
          ? "border-[var(--color-alloy-accent)]/50 bg-[var(--color-alloy-accent)]/30"
          : "border-[var(--color-alloy-border)] bg-[var(--color-alloy-bg)]",
      )}
    >
      <span
        className={clsx(
          "inline-block h-4 w-4 transform rounded-full shadow transition-transform",
          checked
            ? "translate-x-6 bg-[var(--color-alloy-accent)]"
            : "translate-x-1 bg-[var(--color-alloy-text-sec)]",
        )}
        style={{ marginTop: 3 }}
      />
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Badge, Pill
// ─────────────────────────────────────────────────────────────────────────────

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: "neutral" | "success" | "warning" | "danger" | "accent";
}

export function Badge({ tone = "neutral", className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-ui text-[10px] font-bold uppercase tracking-widest",
        tone === "neutral" &&
          "border-[var(--color-alloy-border)] bg-[var(--color-alloy-bg)] text-[var(--color-alloy-text-sec)]",
        tone === "success" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
        tone === "warning" && "border-amber-500/40 bg-amber-500/10 text-amber-200",
        tone === "danger" && "border-red-500/40 bg-red-500/10 text-red-300",
        tone === "accent" &&
          "border-[var(--color-alloy-accent)]/40 bg-[var(--color-alloy-accent)]/10 text-[var(--color-alloy-accent)]",
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SecretInput — shows mask state, "reveal" button, "clear" button
// ─────────────────────────────────────────────────────────────────────────────

export interface SecretInputProps {
  /** Whether a secret is currently set on the server. */
  isSet: boolean;
  /** When the server last updated this secret (epoch ms). */
  updatedAt?: number;
  /** Called with the new plaintext. */
  onChange: (next: string) => void;
  /** Called when the user clicks "clear". Passes empty string through onChange. */
  onClear?: () => void;
  placeholder?: string;
  name?: string;
  disabled?: boolean;
  autoComplete?: string;
}

export function SecretInput({
  isSet,
  updatedAt,
  onChange,
  onClear,
  placeholder,
  name,
  disabled,
  autoComplete = "off",
}: SecretInputProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <Input
          type="password"
          name={name}
          placeholder={isSet ? "••••••••••••••••  (leave blank to keep existing)" : placeholder ?? "Enter key"}
          autoComplete={autoComplete}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
        {isSet && onClear ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClear}
            disabled={disabled}
          >
            Clear
          </Button>
        ) : null}
      </div>
      <div className="flex items-center gap-2 text-[11px] text-[var(--color-alloy-text-sec)]">
        {isSet ? (
          <Badge tone="success">Stored</Badge>
        ) : (
          <Badge tone="warning">Not set</Badge>
        )}
        {updatedAt ? (
          <span>updated {new Date(updatedAt).toLocaleString()}</span>
        ) : null}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Row — a horizontal container with label on the left, input on the right
// ─────────────────────────────────────────────────────────────────────────────

export interface RowProps {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}

export function Row({ label, hint, children, className }: RowProps) {
  return (
    <div
      className={clsx(
        "grid grid-cols-1 gap-3 border-b border-[var(--color-alloy-border)] py-4 last:border-b-0 md:grid-cols-[240px_1fr] md:items-center md:gap-6",
        className,
      )}
    >
      <div className="space-y-1">
        <div className="font-ui text-sm font-medium text-white">{label}</div>
        {hint ? (
          <div className="text-xs text-[var(--color-alloy-text-sec)]">{hint}</div>
        ) : null}
      </div>
      <div>{children}</div>
    </div>
  );
}
