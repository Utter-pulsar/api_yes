export function DoodleCalendarIcon({ className = '' }: { className?: string }): JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4.2 5.3h11.5c.9 0 1.6.7 1.6 1.6v8c0 .9-.7 1.6-1.6 1.6H4.2c-.9 0-1.6-.7-1.6-1.6v-8c0-.9.7-1.6 1.6-1.6Z" />
      <path d="M5.4 3.6v3.1" />
      <path d="M14.8 3.4v3.4" />
      <path d="M3.3 8.4h13.2" />
      <path d="M6.1 11.2h.1" />
      <path d="M9.7 11h.1" />
      <path d="M13.3 11.4h.1" />
      <path d="M6 14.2h.1" />
      <path d="M9.8 14h.1" />
      <path d="M13.1 14.3h.1" />
    </svg>
  )
}
