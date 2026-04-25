import { clsx } from 'clsx';

interface SkeletonProps {
  className?: string;
  variant?: 'text' | 'rect' | 'circle';
}

export function Skeleton({ className, variant = 'rect' }: SkeletonProps) {
  return (
    <div 
      className={clsx(
        "animate-pulse bg-[var(--color-alloy-surface-bright,rgba(255,255,255,0.05))] relative overflow-hidden",
        variant === 'text' && "h-4 w-full rounded",
        variant === 'circle' && "rounded-full",
        variant === 'rect' && "rounded-md",
        "after:absolute after:inset-0 after:-translate-x-full after:animate-[shimmer_2s_infinite] after:bg-gradient-to-r after:from-transparent after:via-white/5 after:to-transparent",
        className
      )}
    />
  );
}
