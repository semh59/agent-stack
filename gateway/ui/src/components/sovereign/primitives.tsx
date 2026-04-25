/**
 * Alloy design-system primitives — light-first.
 * Presentation-only: no data fetching, no routing, no Zustand.
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

// ── Card ──────────────────────────────────────────────────────────────────────

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
        "rounded-xl border bg-[var(--color-alloy-surface)]",
        density === "comfortable" ? "p-6" : "p-4",
        tone === "neutral"  && "border-[var(--color-alloy-border)]",
        tone === "accent"   && "border-[var(--color-alloy-accent)] bg-[var(--color-alloy-accent-dim)]",
        tone === "warning"  && "border-amber-200 bg-amber-50",
        tone === "danger"   && "border-red-200 bg-red-50",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
});

// ── Section ───────────────────────────────────────────────────────────────────

export interface SectionProps extends HTMLAttributes<HTMLElement> {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}

export function Section({ title, description, action, icon, className, children, ...rest }: SectionProps) {
  return (
    <section className={clsx("space-y-4", className)} {...rest}>
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {icon && (
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface-hover)] text-[var(--color-alloy-accent)]">
              {icon}
            </div>
          )}
          <div>
            <h2 className="text-base font-semibold text-[var(--color-alloy-text)]">{title}</h2>
            {description && (
              <p className="mt-0.5 max-w-prose text-sm text-[var(--color-alloy-text-sec)]">{description}</p>
            )}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      <div>{children}</div>
    </section>
  );
}

// ── Button ────────────────────────────────────────────────────────────────────

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
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-alloy-accent-ring)] disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" && "px-3 py-1.5 text-xs",
        size === "md" && "px-4 py-2 text-sm",
        size === "lg" && "px-5 py-2.5 text-sm",
        variant === "primary"   && "bg-[var(--color-alloy-accent)] text-white hover:bg-[var(--color-alloy-accent-hover)]",
        variant === "secondary" && "border border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)] text-[var(--color-alloy-text)] hover:bg-[var(--color-alloy-surface-hover)]",
        variant === "ghost"     && "text-[var(--color-alloy-text-sec)] hover:bg-[var(--color-alloy-surface-hover)] hover:text-[var(--color-alloy-text)]",
        variant === "danger"    && "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100",
        className,
      )}
      {...rest}
    >
      {loading
        ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
        : icon ? <span className="inline-flex">{icon}</span> : null}
      {children}
    </button>
  );
});

// ── Field + Label ─────────────────────────────────────────────────────────────

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

export function Field({ label, htmlFor, hint, error, required, children, className, trailing }: FieldProps) {
  return (
    <div className={clsx("space-y-1.5", className)}>
      <div className="flex items-center justify-between">
        <Label htmlFor={htmlFor}>
          {label}
          {required && <span className="ml-1 text-red-500">*</span>}
        </Label>
        {trailing && <div className="text-xs text-[var(--color-alloy-text-sec)]">{trailing}</div>}
      </div>
      {children}
      {hint && !error && <p className="text-xs text-[var(--color-alloy-text-sec)]">{hint}</p>}
      {error         && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

export const Label = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement>>(
  function Label({ className, children, ...rest }, ref) {
    return (
      <label
        ref={ref}
        className={clsx("block text-sm font-medium text-[var(--color-alloy-text)]", className)}
        {...rest}
      >
        {children}
      </label>
    );
  },
);

// ── Input / Textarea / Select ─────────────────────────────────────────────────

const inputBase =
  "w-full rounded-lg border bg-[var(--color-alloy-surface)] px-3 py-2 text-sm text-[var(--color-alloy-text)] placeholder:text-[var(--color-alloy-text-dim)] transition-shadow focus:outline-none focus-visible:border-[var(--color-alloy-accent)] focus-visible:shadow-[var(--shadow-alloy-focus)] disabled:cursor-not-allowed disabled:opacity-50";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> { invalid?: boolean; }

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, invalid, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={clsx(
        inputBase,
        invalid ? "border-red-400 focus-visible:border-red-500" : "border-[var(--color-alloy-border)]",
        className,
      )}
      {...rest}
    />
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> { invalid?: boolean; }

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ className, invalid, rows = 4, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        rows={rows}
        className={clsx(
          inputBase,
          "alloy-scroll resize-y",
          invalid ? "border-red-400 focus-visible:border-red-500" : "border-[var(--color-alloy-border)]",
          className,
        )}
        {...rest}
      />
    );
  },
);

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> { invalid?: boolean; }

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, invalid, children, ...rest }, ref,
) {
  return (
    <select
      ref={ref}
      className={clsx(
        inputBase,
        "appearance-none pr-8",
        invalid ? "border-red-400" : "border-[var(--color-alloy-border)]",
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
});

// ── Switch ────────────────────────────────────────────────────────────────────

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
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors focus:outline-none focus-visible:shadow-[var(--shadow-alloy-focus)] disabled:cursor-not-allowed disabled:opacity-50",
        checked
          ? "border-[var(--color-alloy-accent)] bg-[var(--color-alloy-accent)]"
          : "border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface-hover)]",
      )}
    >
      <span className={clsx(
        "h-3.5 w-3.5 rounded-full bg-white shadow transition-transform",
        checked ? "translate-x-4" : "translate-x-0.5",
      )} />
    </button>
  );
}

// ── Badge ─────────────────────────────────────────────────────────────────────

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: "neutral" | "success" | "warning" | "danger" | "accent";
}

export function Badge({ tone = "neutral", className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        tone === "neutral" && "bg-[var(--color-alloy-surface-hover)] text-[var(--color-alloy-text-sec)]",
        tone === "success" && "bg-emerald-50 text-emerald-700",
        tone === "warning" && "bg-amber-50 text-amber-700",
        tone === "danger"  && "bg-red-50 text-red-700",
        tone === "accent"  && "bg-[var(--color-alloy-accent-dim)] text-[var(--color-alloy-accent)]",
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}

// ── SecretInput ───────────────────────────────────────────────────────────────

export interface SecretInputProps {
  isSet: boolean;
  updatedAt?: number;
  onChange: (next: string) => void;
  onClear?: () => void;
  placeholder?: string;
  name?: string;
  disabled?: boolean;
  autoComplete?: string;
}

export function SecretInput({ isSet, updatedAt, onChange, onClear, placeholder, name, disabled, autoComplete = "off" }: SecretInputProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <Input
          type="password"
          name={name}
          placeholder={isSet ? "••••••••  (mevcut anahtarı korumak için boş bırakın)" : (placeholder ?? "Anahtar girin")}
          autoComplete={autoComplete}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
        {isSet && onClear && (
          <Button type="button" variant="ghost" size="sm" onClick={onClear} disabled={disabled}>
            Temizle
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2 text-xs text-[var(--color-alloy-text-sec)]">
        {isSet ? <Badge tone="success">Kayıtlı</Badge> : <Badge tone="warning">Ayarlanmamış</Badge>}
        {updatedAt && <span>güncelleme: {new Date(updatedAt).toLocaleString("tr-TR")}</span>}
      </div>
    </div>
  );
}

// ── Row ───────────────────────────────────────────────────────────────────────

export interface RowProps {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}

export function Row({ label, hint, children, className }: RowProps) {
  return (
    <div className={clsx(
      "grid grid-cols-1 gap-3 border-b border-[var(--color-alloy-border)] py-4 last:border-b-0 md:grid-cols-[240px_1fr] md:items-center md:gap-8",
      className,
    )}>
      <div>
        <div className="text-sm font-medium text-[var(--color-alloy-text)]">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-[var(--color-alloy-text-sec)]">{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}
