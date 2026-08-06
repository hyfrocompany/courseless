import type { ButtonHTMLAttributes, ReactNode } from 'react'

// ---------------------------------------------------------------- text atoms

export function Eyebrow({
  children,
  tone = 'ocean',
  className = ''
}: {
  children: ReactNode
  tone?: 'ocean' | 'muted' | 'onDark'
  className?: string
}) {
  const color =
    tone === 'ocean' ? 'text-ocean-700 dark:text-ocean-300' : tone === 'onDark' ? 'text-ocean-200' : 'text-ink-500'
  return (
    <div className={`font-mono text-[11px] font-medium uppercase tracking-[0.14em] ${color} ${className}`}>
      {children}
    </div>
  )
}

export function Mono({
  children,
  className = '',
  ...rest
}: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={`font-mono tabular ${className}`} {...rest}>
      {children}
    </span>
  )
}

/** Keyboard chip — the app is keyboard-first, so these are load-bearing, not decoration. */
export function Kbd({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={`inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-[5px] bg-surface px-1.5 font-mono text-[11px] font-medium text-ink-700 ring-hairline ${className}`}
    >
      {children}
    </kbd>
  )
}

export function Chip({
  children,
  tone = 'ocean',
  className = ''
}: {
  children: ReactNode
  tone?: 'ocean' | 'quiet' | 'warn'
  className?: string
}) {
  const tones = {
    ocean: 'bg-chip text-chip-ink',
    quiet: 'bg-sunken text-ink-500',
    warn: 'bg-warn-bg text-warn'
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[12px] font-medium ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  )
}

/** Small uppercase mono tag ("STARTER", "PRACTICE"). */
export function Tag({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-block rounded-[4px] px-1.5 py-px font-mono text-[10px] font-medium uppercase tracking-[0.12em] ${className}`}
    >
      {children}
    </span>
  )
}

// ---------------------------------------------------------------- buttons

type Variant = 'primary' | 'ocean' | 'outline' | 'ghost' | 'quiet'

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-cta text-cta-ink hover:bg-[var(--c-cta-hover)] active:translate-y-px disabled:opacity-35 disabled:hover:bg-cta',
  ocean:
    'bg-fill text-white hover:bg-[var(--c-fill-hover)] active:translate-y-px disabled:opacity-35 dark:text-[#04121d]',
  outline: 'bg-surface text-ink-900 ring-hairline hover:bg-sunken disabled:opacity-40',
  ghost: 'text-ink-700 hover:bg-sunken hover:text-ink-900 disabled:opacity-40',
  quiet: 'text-ink-500 hover:text-ink-900 underline underline-offset-4 decoration-line disabled:opacity-40'
}

const SIZES = {
  sm: 'h-7 px-2.5 text-[12.5px]',
  md: 'h-9 px-4 text-[13.5px]',
  lg: 'h-10 px-5 text-[14px]'
}

export function Button({
  variant = 'primary',
  size = 'md',
  pill = true,
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: keyof typeof SIZES
  pill?: boolean
}) {
  return (
    <button
      type="button"
      className={`inline-flex select-none items-center justify-center gap-2 font-medium transition-[background-color,color,opacity,transform] duration-150 ease-out disabled:cursor-not-allowed ${
        pill ? 'rounded-full' : 'rounded-sm'
      } ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}

export function IconButton({
  label,
  size = 'md',
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: 'sm' | 'md' }) {
  // the box is a prop, not a className override — two competing h-* utilities resolve by CSS
  // source order, not by the order they appear in the attribute
  const box = size === 'sm' ? 'h-7 w-7' : 'h-8 w-8'
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex ${box} items-center justify-center rounded-full text-ink-500 transition-colors duration-150 hover:bg-sunken hover:text-ink-900 ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------- surfaces

export function Card({
  children,
  className = '',
  as: As = 'div',
  ...rest
}: {
  children: ReactNode
  className?: string
  as?: 'div' | 'section' | 'article'
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <As className={`rounded-md bg-surface ring-hairline ${className}`} {...rest}>
      {children}
    </As>
  )
}

export function Section({
  eyebrow,
  title,
  meta,
  children,
  className = ''
}: {
  eyebrow: string
  title?: string
  meta?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={className}>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <Eyebrow>{eyebrow}</Eyebrow>
          {title && <h2 className="mt-1 font-display text-[21px] leading-tight tracking-[-0.02em]">{title}</h2>}
        </div>
        {meta}
      </div>
      {children}
    </section>
  )
}

// ---------------------------------------------------------------- icons (1.5px stroke, 20px box)

type IconProps = { className?: string; size?: number }

function svg(children: ReactNode, { className = '', size = 18 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export const Icon = {
  // settings: sliders, not a cog — a cog at 18px reads as a sun next to a status dot
  gear: (p: IconProps = {}) =>
    svg(
      <>
        <path d="M2.8 6.2h5.4M11.6 6.2h5.6M2.8 13.8h4.2M10.4 13.8h6.8" />
        <circle cx="9.9" cy="6.2" r="1.9" />
        <circle cx="8.7" cy="13.8" r="1.9" />
      </>,
      p
    ),
  arrowRight: (p: IconProps = {}) => svg(<path d="M3.5 10h13M11.5 5l5 5-5 5" />, p),
  arrowLeft: (p: IconProps = {}) => svg(<path d="M16.5 10h-13M8.5 5l-5 5 5 5" />, p),
  check: (p: IconProps = {}) => svg(<path d="M4 10.5l4 4 8-9" />, p),
  close: (p: IconProps = {}) => svg(<path d="M5 5l10 10M15 5L5 15" />, p),
  chat: (p: IconProps = {}) =>
    svg(<path d="M17 9.5c0 3.3-3.13 6-7 6-.72 0-1.42-.09-2.07-.27L3.5 16.5l1.15-3.02A5.7 5.7 0 013 9.5c0-3.3 3.13-6 7-6s7 2.7 7 6z" />, p),
  pin: (p: IconProps = {}) =>
    svg(
      <>
        <path d="M12.4 2.6l5 5-2.2 1.1-.7 3.6-5.9-5.9 3.6-.7 1.1-2.2z" />
        <path d="M8.6 11.4L3.5 16.5" />
      </>,
      p
    ),
  expand: (p: IconProps = {}) =>
    svg(
      <>
        <path d="M11.5 3.5h5v5M16.5 3.5L11 9" />
        <path d="M8.5 16.5h-5v-5M3.5 16.5L9 11" />
      </>,
      p
    ),
  chevronRight: (p: IconProps = {}) => svg(<path d="M7.5 4l6 6-6 6" />, p),
  chevronLeft: (p: IconProps = {}) => svg(<path d="M12.5 4l-6 6 6 6" />, p),
  sun: (p: IconProps = {}) =>
    svg(
      <>
        <circle cx="10" cy="10" r="3.4" />
        <path d="M10 1.8v2M10 16.2v2M18.2 10h-2M3.8 10h-2M15.8 4.2l-1.4 1.4M5.6 14.4l-1.4 1.4M15.8 15.8l-1.4-1.4M5.6 5.6L4.2 4.2" />
      </>,
      p
    ),
  moon: (p: IconProps = {}) => svg(<path d="M16.2 12.4A6.8 6.8 0 017.6 3.8a6.8 6.8 0 108.6 8.6z" />, p),
  folder: (p: IconProps = {}) =>
    svg(<path d="M2.8 5.4c0-.66.54-1.2 1.2-1.2h3l1.6 1.9h6.4c.66 0 1.2.54 1.2 1.2v7.1c0 .66-.54 1.2-1.2 1.2H4c-.66 0-1.2-.54-1.2-1.2V5.4z" />, p),
  trash: (p: IconProps = {}) =>
    svg(
      <>
        <path d="M3.8 5.4h12.4M8 5.4V3.8h4v1.6M5.4 5.4l.7 10c.03.6.53 1.06 1.13 1.06h5.54c.6 0 1.1-.46 1.13-1.06l.7-10" />
      </>,
      p
    ),
  refresh: (p: IconProps = {}) =>
    svg(
      <>
        <path d="M16.2 8.4A6.4 6.4 0 004.6 6.3M3.8 11.6a6.4 6.4 0 0011.6 2.1" />
        <path d="M16.4 4.2v4.2h-4.2M3.6 15.8v-4.2h4.2" />
      </>,
      p
    ),
  search: (p: IconProps = {}) =>
    svg(
      <>
        <circle cx="8.8" cy="8.8" r="5" />
        <path d="M12.6 12.6l4 4" />
      </>,
      p
    ),
  spark: (p: IconProps = {}) =>
    svg(<path d="M10 2.6l1.9 4.9 4.9 1.9-4.9 1.9L10 16.2l-1.9-4.9L3.2 9.4l4.9-1.9L10 2.6z" />, p),
  // guided pointing: the same arrow silhouette the overlay flies, so the button and the thing it
  // summons are visibly one object
  pointer: (p: IconProps = {}) =>
    svg(
      <>
        <path d="M4.2 2.8 L14.6 11.4 L9.9 12 L12.5 17.4 L10.1 18.5 L7.6 13 L4.2 15.9 Z" />
      </>,
      p
    ),
  // authoring: one drawn family, same 1.5px stroke as the rest
  pencil: (p: IconProps = {}) =>
    svg(
      <>
        <path d="M13.4 3.6l3 3-8.5 8.5-3.6.6.6-3.6 8.5-8.5z" />
        <path d="M11.9 5.1l3 3" />
      </>,
      p
    ),
  share: (p: IconProps = {}) =>
    svg(
      <>
        <path d="M10 12.6V3.4M6.8 6.6L10 3.4l3.2 3.2" />
        <path d="M4.4 11.2v4.2c0 .66.54 1.2 1.2 1.2h8.8c.66 0 1.2-.54 1.2-1.2v-4.2" />
      </>,
      p
    ),
  download: (p: IconProps = {}) =>
    svg(
      <>
        <path d="M10 3.4v9.2M6.8 9.4l3.2 3.2 3.2-3.2" />
        <path d="M4.4 15.4v.4c0 .4.34.7.75.7h9.7c.41 0 .75-.3.75-.7v-.4" />
      </>,
      p
    ),
  record: (p: IconProps = {}) =>
    svg(
      <>
        <circle cx="10" cy="10" r="7" />
        <circle cx="10" cy="10" r="3.1" fill="currentColor" stroke="none" />
      </>,
      p
    ),
  copy: (p: IconProps = {}) =>
    svg(
      <>
        <path d="M7.2 7.2v-2c0-.66.54-1.2 1.2-1.2h6.4c.66 0 1.2.54 1.2 1.2v6.4c0 .66-.54 1.2-1.2 1.2h-2" />
        <path d="M4 8.4c0-.66.54-1.2 1.2-1.2h6.4c.66 0 1.2.54 1.2 1.2v6.4c0 .66-.54 1.2-1.2 1.2H5.2c-.66 0-1.2-.54-1.2-1.2V8.4z" />
      </>,
      p
    ),
  speaker: (p: IconProps = {}) =>
    svg(
      <>
        <path d="M4 7.6h2.6L10 4.4v11.2L6.6 12.4H4a.8.8 0 01-.8-.8V8.4a.8.8 0 01.8-.8z" />
        <path d="M13 7.4a3.6 3.6 0 010 5.2M15.4 5.2a7 7 0 010 9.6" />
      </>,
      p
    )
}
