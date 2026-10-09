const PATHS = {
  today:
    "M12 7.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9z M12 2.5v2 M12 19.5v2 M2.5 12h2 M19.5 12h2 M5.3 5.3l1.4 1.4 M17.3 17.3l1.4 1.4 M5.3 18.7l1.4-1.4 M17.3 6.7l1.4-1.4",
  sessions: "M4 5.5h16v10.5H10l-6 4z",
  library: "M4 4.5h5.5A2.5 2.5 0 0 1 12 7v13a2 2 0 0 0-2-2H4z M20 4.5h-5.5A2.5 2.5 0 0 0 12 7v13a2 2 0 0 1 2-2h6z",
  course: "M6 4.5a2 2 0 1 1 0 .01 M6 6.5v3.5a2 2 0 0 0 2 2h8a2 2 0 0 1 2 2v2.5 M18 19.5a2 2 0 1 1 0 .01",
  grammar: "M12 3 3 8l9 5 9-5z M3 13l9 5 9-5",
  review: "M20 12a8 8 0 1 1-2.3-5.6 M20 4v4.5h-4.5 M8.5 12l2.5 2.5 4.5-5",
  progress: "M5 20v-8 M12 20V5 M19 20v-5",
  customize: "M4 20 14 10 M15 3l1.2 2.8L19 7l-2.8 1.2L15 11l-1.2-2.8L11 7l2.8-1.2z",
  settings: "M4 7h9 M17 7h3 M4 17h3 M11 17h9 M15 5v4 M9 15v4",
  mic: "M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z M5.5 11a6.5 6.5 0 0 0 13 0 M12 17.5V21",
  send: "M5 12h14 M13 6l6 6-6 6",
  stop: "M7 7h10v10H7z",
  check: "M5 12.5l4.5 4.5L19 7.5",
  copy: "M9 9h11v11H9z M15 9V4H4v11h5",
  typo: "M5 6.5h14 M12 6.5V17 M9 17h6 M4 21c1.5-1.5 2.5-1.5 4 0s2.5 1.5 4 0 2.5-1.5 4 0 2.5 1.5 4 0",
  pen: "M4 20l4-1 11-11-3-3L5 16z M14 6l3 3",
  plus: "M12 5v14 M5 12h14",
  chev: "M6 9l6 6 6-6",
  chevUp: "M6 15l6-6 6 6",
  chevR: "M9 6l6 6-6 6",
  arrow: "M5 12h14 M13 6l6 6-6 6",
  alert: "M12 8v5 M12 16.5v.01 M10.3 4.3 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z",
  lock: "M6 11h12v9H6z M8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  key: "M14.5 4a5.5 5.5 0 1 1-4.9 8L4 17.6V20h2.4v-1.8h1.8v-1.8h1.8l1.6-1.6A5.5 5.5 0 0 1 14.5 4z M16 8v.01",
  external: "M14 4h6v6 M20 4l-9 9 M18 14v6H4V6h6",
  translate: "M4 5h9 M8.5 3v2 M6 5c.6 3 2.6 5.6 5.5 7 M11 5c-.8 3.6-3 6.5-6.5 8.5 M13 21l4-10 4 10 M14.3 18h5.4",
  speaker: "M4 9.5h3.5L12 5.5v13l-4.5-4H4z M15.5 9a4 4 0 0 1 0 6 M18 6.5a7.5 7.5 0 0 1 0 11",
  cards: "M4 7.5h12v12H4z M8 4.5h12v12",
  hint: "M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6 M12 17.5v.01",
  clock: "M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17z M12 7.5V12l3 2",
  x: "M6 6l12 12 M18 6 6 18",
  panel: "M4 5h16v14H4z M15 5v14",
  spark: "M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z M18.5 16.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z",
  image: "M4 5h16v14H4z M4 16l5-5 4 4 3-3 4 4 M15 9.5v.01",
  refresh: "M20 12a8 8 0 1 1-2.3-5.6 M20 4v4.5h-4.5",
  flag: "M5 21V4 M5 4h11l-2 4 2 4H5",
  tool: "M14.5 6.5a4 4 0 0 0-5 5L4 17l3 3 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2.5-.5-.5-2.5z",
  download: "M12 4v11 M7 10l5 5 5-5 M5 20h14",
  bookmark: "M6 4h12v16l-6-4-6 4z",
  compass: "M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17z M15.5 8.5l-2 5-5 2 2-5z",
  quote: "M7 7h4v4c0 3-1.5 5-4 6 M14 7h4v4c0 3-1.5 5-4 6",
  search: "M11 4.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13z M20 20l-4.3-4.3",
  trash: "M4.5 7h15 M9.5 7V4.5h5V7 M6.5 7l1 12.5h9l1-12.5",
  more: "M6 12h.01 M12 12h.01 M18 12h.01",
  folder: "M3.5 6.5h6l2 2h9v10h-17z",
  file: "M6 3.5h8l4 4v13H6z M14 3.5v4h4",
  user: "M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8z M4.5 20a7.5 7.5 0 0 1 15 0",
  puzzle: "M9 4.5h3.5v2a1.5 1.5 0 0 0 3 0v-2H19v5h-2a1.5 1.5 0 0 0 0 3h2v5.5h-5v-2a1.5 1.5 0 0 0-3 0v2H5.5V13h2a1.5 1.5 0 0 0 0-3h-2V4.5z",
  globe: "M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17z M3.5 12h17 M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5 M12 3.5C9.5 6 8.5 9 8.5 12s1 6 3.5 8.5",
  database: "M5 6c0-1.4 3.1-2.5 7-2.5s7 1.1 7 2.5-3.1 2.5-7 2.5S5 7.4 5 6z M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6 M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5",
  back: "M15 6l-6 6 6 6",
  // role-play scenarios (src/shared/scenarios.ts)
  utensils: "M7 3v18 M4.5 3v5a2.5 2.5 0 0 0 5 0V3 M17 21V3c-2.2 1.4-3.5 3.8-3.5 7v3H17",
  cup: "M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z M16 10h1.5a2.5 2.5 0 0 1 0 5H16 M9 3.5v2.5 M12.5 3.5v2.5",
  bag: "M5 8h14l-1 12.5H6z M9 10V7a3 3 0 0 1 6 0v3",
  cart: "M3 4h2.5l2.2 11h10.6L20.5 7H6.5 M9.5 19.5v.01 M17 19.5v.01",
  pin: "M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z M12 7.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z",
  bed: "M3 18.5V6 M3 14h18v4.5 M3 11h7v3 M10 10h8a3 3 0 0 1 3 3v1 M6.5 10.5v.01",
  train: "M6 4.5h12v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z M6 11h12 M9 14.5v.01 M15 14.5v.01 M8 17.5 6 20.5 M16 17.5l2 3",
  heart: "M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z",
  phone: "M5 4.5h3.5l1.7 4.3-2.2 1.4a11 11 0 0 0 5.8 5.8l1.4-2.2 4.3 1.7V19a1.5 1.5 0 0 1-1.5 1.5A15.5 15.5 0 0 1 3.5 6 1.5 1.5 0 0 1 5 4.5z",
  receipt: "M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z M9 8h6 M9 11.5h6 M9 15h3.5",
  briefcase: "M3.5 8h17v11h-17z M9 8V5.5h6V8 M3.5 13h17",
  home: "M4 11 12 4l8 7 M6 9.5V20h12V9.5 M10 20v-5.5h4V20",
  plane: "M16 10h4a2 2 0 0 1 0 4h-4l-4 7H9l2-7H7l-2 2H2l2-4-2-4h3l2 2h4L9 3h3z",
  pill: "M10.6 4.9a4.5 4.5 0 0 1 6.4 6.4l-5.7 5.7a4.5 4.5 0 0 1-6.4-6.4z M7.8 7.7l6.4 6.4",
  door: "M6 20.5V4h12v16.5 M3.5 20.5h17 M14.5 12.5v.01",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, stroke = 1.6 }: { name: IconName; size?: number; stroke?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Fern({ size = 26, color = "var(--fern)" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" style={{ stroke: color }} strokeWidth={1.9} strokeLinecap="round" aria-hidden="true">
      <path d="M7 29C11 20 16 12 25 3" />
      <path d="M10.5 22.5c-3-.6-5.2-2.6-6.2-5.6 M10.5 22.5c3 .2 5.8-.8 8-2.8 M13.6 16.6c-2.2-1-3.8-3-4.2-5.8 M13.6 16.6c2.8 0 5.2-1 7-2.8 M17.4 10.6c-1.2-1.2-1.8-3-1.6-5 M17.4 10.6c2 0 3.8-.8 5.2-2" />
    </svg>
  );
}
