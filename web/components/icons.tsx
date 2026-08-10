// The app's icon family: 1.5px stroke on a 20px box (src/renderer/src/components/ui.tsx).

type P = { size?: number; className?: string }

function Svg({ size = 18, className = '', children }: P & { children: React.ReactNode }) {
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

export const DownloadIcon = (p: P) => (
  <Svg {...p}>
    <path d="M10 3.4v9.2M6.8 9.4l3.2 3.2 3.2-3.2" />
    <path d="M4.4 15.4v.4c0 .4.34.7.75.7h9.7c.41 0 .75-.3.75-.7v-.4" />
  </Svg>
)

export const ChatIcon = (p: P) => (
  <Svg {...p}>
    <path d="M17 9.5c0 3.3-3.13 6-7 6-.72 0-1.42-.09-2.07-.27L3.5 16.5l1.15-3.02A5.7 5.7 0 013 9.5c0-3.3 3.13-6 7-6s7 2.7 7 6z" />
  </Svg>
)

export const ExpandIcon = (p: P) => (
  <Svg {...p}>
    <path d="M11.5 3.5h5v5M16.5 3.5L11 9" />
    <path d="M8.5 16.5h-5v-5M3.5 16.5L9 11" />
  </Svg>
)

export const PointerIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4.2 2.8 L14.6 11.4 L9.9 12 L12.5 17.4 L10.1 18.5 L7.6 13 L4.2 15.9 Z" />
  </Svg>
)

export const SearchIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="8.8" cy="8.8" r="5" />
    <path d="M12.6 12.6l4 4" />
  </Svg>
)

export const ShareIcon = (p: P) => (
  <Svg {...p}>
    <path d="M10 12.6V3.4M6.8 6.6L10 3.4l3.2 3.2" />
    <path d="M4.4 11.2v4.2c0 .66.54 1.2 1.2 1.2h8.8c.66 0 1.2-.54 1.2-1.2v-4.2" />
  </Svg>
)

export const CheckIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 10.5l4 4 8-9" />
  </Svg>
)
