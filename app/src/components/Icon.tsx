import type { ReactElement, SVGProps } from "react";

export type IconName =
  | "plus"
  | "check"
  | "check-circle"
  | "star"
  | "bolt"
  | "trash"
  | "arrow"
  | "cloud"
  | "user"
  | "inbox"
  | "focus"
  | "plan"
  | "quick"
  | "later"
  | "important"
  | "list"
  | "grid"
  | "columns"
  | "close"
  | "mail"
  | "lock"
  | "google"
  | "download"
  | "refresh"
  | "calendar-check"
  | "search"
  | "sparkles"
  | "gear"
  | "chevron-left"
  | "chevron-right"
  | "chevron-down"
  | "microphone"
  | "stop"
  | "file-text"
  | "folder"
  | "file"
  | "heading"
  | "list-ordered"
  | "list-todo"
  | "quote"
  | "code"
  | "divider"
  | "link"
  | "tag"
  | "pencil"
  | "folder-plus"
  | "file-plus"
  | "palette"
  | "logout"
  | "menu"
  | "briefcase"
  | "target"
  | "rocket"
  | "home"
  | "book"
  | "flag"
  | "heart"
  | "coffee"
  | "globe"
  | "monitor"
  | "smartphone"
  | "camera"
  | "music"
  | "shield"
  | "award"
  | "zap"
  | "feather"
  | "gift"
  | "bookmark"
  | "bell"
  | "compass"
  | "map"
  | "map-pin"
  | "layers"
  | "database"
  | "terminal"
  | "cpu"
  | "anchor"
  | "shopping-bag"
  | "shopping-cart"
  | "sun"
  | "moon"
  | "umbrella"
  | "key"
  | "tool"
  | "send"
  | "flame"
  | "smile"
  | "activity"
  | "book-open"
  | "credit-card"
  | "dollar-sign"
  | "trending-up"
  | "bar-chart"
  | "clock"
  | "hourglass"
  | "archive"
  | "clipboard"
  | "building"
  | "wifi"
  | "sliders"
  | "eye";


export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, ...props };
  const paths: Record<IconName, ReactElement> = {
    flag: <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7" />,
    plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
    check: <path d="m5 12 4.5 4.5L19 7" />,
    "check-circle": <><circle cx="12" cy="12" r="8.5" /><path d="m8.5 12 2.4 2.4 4.8-5" /></>,
    star: <path d="m12 3 2.78 5.63 6.22.9-4.5 4.39 1.06 6.2L12 17.2l-5.56 2.92 1.06-6.2L3 9.53l6.22-.9L12 3Z" />,
    bolt: <path d="m13 2-9 12h7l-1 8 9-12h-7l1-8Z" />,
    trash: <><path d="M4 7h16" /><path d="M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
    arrow: <><path d="M5 12h13" /><path d="m13 6 6 6-6 6" /></>,
    cloud: <path d="M7 18h10a4 4 0 0 0 .4-7.98A5.5 5.5 0 0 0 6.2 8.2 4 4 0 0 0 7 18Z" />,
    user: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.8-3.2 3.2-4.8 7-4.8s6.2 1.6 7 4.8" /></>,
    inbox: <><path d="M4 5.5h16v13H4z" /><path d="M4 14h4l1.5 2h5L16 14h4" /></>,
    focus: <><circle cx="12" cy="12" r="7.5" /><circle cx="12" cy="12" r="2" /></>,
    plan: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></>,
    quick: <path d="m13 2-9 12h7l-1 8 9-12h-7l1-8Z" />,
    later: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></>,
    important: <path d="m12 3 2.78 5.63 6.22.9-4.5 4.39 1.06 6.2L12 17.2l-5.56 2.92 1.06-6.2L3 9.53l6.22-.9L12 3Z" />,
    list: <><path d="M8 6h12M8 12h12M8 18h12" /><path d="M4 6h.01M4 12h.01M4 18h.01" /></>,
    grid: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
    columns: <><rect x="3" y="4" width="7" height="16" rx="2" /><rect x="14" y="4" width="7" height="12" rx="2" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    mail: <><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="m4.5 7 7.5 5.5L19.5 7" /></>,
    lock: <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    download: <><path d="M12 3v11" /><path d="m7.5 10 4.5 4.5 4.5-4.5" /><path d="M5 20h14" /></>,
    refresh: <><path d="M20 11a8 8 0 0 0-14.7-3L4 10" /><path d="M4 5v5h5" /><path d="M4 13a8 8 0 0 0 14.7 3L20 14" /><path d="M20 19v-5h-5" /></>,
    "calendar-check": <><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /><path d="m9.2 15 2 2 3.8-3.8" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.3" /><path d="m16 16 4.2 4.2" /></>,
    sparkles: <><path d="m12 3 1.9 4.8 4.8 1.9-4.8 1.9L12 16.5l-1.9-4.9-4.8-1.9 4.8-1.9L12 3Z" /><path d="M19 15l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1Z" /></>,
    gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></>,
    google: <><path d="M21 12.2c0-.7-.1-1.4-.2-2H12v3.8h5a4.3 4.3 0 0 1-1.9 2.8v2.4h3.1c1.8-1.7 2.8-4.1 2.8-7Z" fill="currentColor" stroke="none" /><path d="M12 21c2.5 0 4.6-.8 6.2-2.2l-3.1-2.4c-.8.5-1.8.8-3.1.8-2.4 0-4.4-1.6-5.1-3.8H3.7v2.5A9.4 9.4 0 0 0 12 21Z" fill="currentColor" stroke="none" opacity=".75" /><path d="M6.9 13.4a5.7 5.7 0 0 1 0-2.8V8.1H3.7a9.4 9.4 0 0 0 0 7.8l3.2-2.5Z" fill="currentColor" stroke="none" opacity=".55" /><path d="M12 6.8c1.4 0 2.6.5 3.6 1.5l2.7-2.7C16.6 4 14.5 3 12 3a9.4 9.4 0 0 0-8.3 5.1l3.2 2.5C7.6 8.4 9.6 6.8 12 6.8Z" fill="currentColor" stroke="none" opacity=".9" /></>,
    "chevron-left": <path d="m14.5 5-7 7 7 7" />,
    "chevron-right": <path d="m9.5 5 7 7-7 7" />,
    "chevron-down": <path d="m5 9 7 7 7-7" />,
    microphone: <><rect x="8" y="3" width="8" height="12" rx="4" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" /></>,
    stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
    "file-text": <><path d="M6 3.5h8l4 4V20.5H6z" /><path d="M14 3.5v4h4M9 12h6M9 16h6" /></>,
    folder: <path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h5l2 2.5h7A1.5 1.5 0 0 1 20.5 9v8.5a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 17.5Z" />,
    file: <><path d="M6.5 3.5h7l4 4v13h-11Z" /><path d="M13.5 3.5v4h4" /></>,
    heading: <><path d="M6 4v16M18 4v16M6 12h12" /></>,
    "list-ordered": <><path d="M10.5 6H20M10.5 12H20M10.5 18H20" /><path d="M4.5 5.2 5.6 6v2.6M4 12.4h2.6M4.6 12.4v-.2M4 18.4h2.6" /></>,
    "list-todo": <><rect x="3.5" y="3.5" width="6" height="6" rx="1.5" /><path d="m5.4 6.5 1.2 1.2 2.2-2.4" /><path d="M13 6.5H20M4.5 13.5H20M4.5 18.5H20" /></>,
    quote: <><path d="M10 7H6v5a4 4 0 0 0 4 4V7ZM20 7h-4v5a4 4 0 0 0 4 4V7Z" /></>,
    code: <><path d="m8.5 8-4 4 4 4M15.5 8l4 4-4 4" /></>,
    divider: <path d="M4 12h16" />,
    link: <><path d="M10 14a4 4 0 0 0 6 0l2.5-2.5a4 4 0 0 0-5.6-5.6L11.5 7.3" /><path d="M14 10a4 4 0 0 0-6 0l-2.5 2.5a4 4 0 0 0 5.6 5.6l1.4-1.4" /></>,
    tag: <><path d="M4 4h7l9 9-7 7-9-9Z" /><circle cx="9" cy="9" r="1.3" /></>,
    pencil: <><path d="M4 20l1-4.5L16.5 4a2.12 2.12 0 0 1 3 3L8 18.5Z" /><path d="m14.5 6 3 3" /></>,
    "folder-plus": <><path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h5l2 2.5h7A1.5 1.5 0 0 1 20.5 9v8.5a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 17.5Z" /><path d="M12 11v5M9.5 13.5h5" /></>,
    "file-plus": <><path d="M6.5 3.5h7l4 4v13h-11Z" /><path d="M13.5 3.5v4h4" /><path d="M12 11.5v5M9.5 14h5" /></>,
    palette: <><path d="M12 4a8 8 0 1 0 .5 15.97c1.4.12 2-.9 1.4-2-.7-1.2-.1-2.6 1.5-2.6h1.7a3.9 3.9 0 0 0 3.9-3.9C21 6.9 17 4 12 4Z" /><circle cx="8.3" cy="10.2" r=".9" /><circle cx="12" cy="7.6" r=".9" /><circle cx="15.7" cy="9.4" r=".9" /></>,
    logout: <><path d="M14 4H5v16h9" /><path d="M10 12h11" /><path d="m18 9 3 3-3 3" /></>,
    menu: <><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></>,
    briefcase: <><rect x="4" y="7" width="16" height="13" rx="2" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M4 12h16M10 12v2h4v-2" /></>,
    target: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" /></>,
    rocket: <><path d="M14.5 4.5c2.5-2.5 5.2-2.2 5.2-2.2s.3 2.7-2.2 5.2l-5.8 5.8-3.6-.8-.8-3.6Z" /><path d="m7.7 14.3-3.2 3.2M6.2 19.8l-2 .2.2-2M12.8 8.2l3 3M9.2 15.8c-1.7 1.7-3.1 2.1-4.7 2.1M8.2 16.8c0 1.7-.4 3.1-2.1 4.7" /></>,
    home: <><path d="m3.5 10.5 8.5-7 8.5 7" /><path d="M5.5 9v11h13V9M9.5 20v-6h5v6" /></>,
    book: <><path d="M4.5 5.5A2.5 2.5 0 0 1 7 3h12.5v17H7a2.5 2.5 0 0 0-2.5 2.5Z" /><path d="M4.5 5.5v17M7 20h12.5" /></>,
    heart: <path d="m12 20-1.4-1.3C5.5 14 2.5 11.3 2.5 8a5 5 0 0 1 9.5-2.1A5 5 0 0 1 21.5 8c0 3.3-3 6-8.1 10.7Z" />,
    coffee: <><path d="M18 8h1a4 4 0 0 1 0 8h-1" /><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" /><path d="M6 1v3M10 1v3M14 1v3" /></>,
    globe: <><circle cx="12" cy="12" r="10" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /><path d="M2 12h20" /></>,
    monitor: <><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></>,
    smartphone: <><rect x="5" y="2" width="14" height="20" rx="2" /><path d="M12 18h.01" /></>,
    camera: <><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" /><circle cx="12" cy="13" r="3" /></>,
    music: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>,
    shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
    award: <><circle cx="12" cy="8" r="6" /><path d="m15.5 12.9 1.5 9.1-5-3-5 3 1.5-9.1" /></>,
    zap: <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />,
    feather: <><path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" /><path d="M16 8 2 22M17.5 15H9" /></>,
    gift: <><rect x="3" y="8" width="18" height="12" rx="2" /><path d="M12 8v12M3 12h18M12 8H7.5a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8zM12 8h4.5a2.5 2.5 0 0 0 0-5C13 3 12 8 12 8z" /></>,
    bookmark: <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />,
    bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>,
    compass: <><circle cx="12" cy="12" r="10" /><polygon points="16.2 7.8 14.1 14.1 7.8 16.2 9.9 9.9 16.2 7.8" /></>,
    map: <><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" /><path d="M9 3v15M15 6v15" /></>,
    "map-pin": <><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></>,
    layers: <><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></>,
    database: <><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3" /></>,
    terminal: <><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></>,
    cpu: <><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" /></>,
    anchor: <><circle cx="12" cy="5" r="3" /><line x1="12" y1="22" x2="12" y2="8" /><path d="M5 12H2a10 10 0 0 0 20 0h-3" /></>,
    "shopping-bag": <><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" /><path d="M3 6h18M16 10a4 4 0 0 1-8 0" /></>,
    "shopping-cart": <><circle cx="8" cy="21" r="1" /><circle cx="19" cy="21" r="1" /><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></>,
    moon: <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />,
    umbrella: <><path d="M22 12a10.06 10.06 0 0 0-20 0Z" /><path d="M12 12v8a2 2 0 0 0 4 0M12 2v1" /></>,
    key: <><circle cx="7.5" cy="15.5" r="5.5" /><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3" /></>,
    tool: <path d="m14.7 6.3 1.6 1.6 3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />,
    send: <><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></>,
    flame: <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z" />,
    smile: <><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01" /></>,
    activity: <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />,
    "book-open": <><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></>,
    "credit-card": <><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /></>,
    "dollar-sign": <><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></>,
    "trending-up": <><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></>,
    "bar-chart": <><line x1="12" y1="20" x2="12" y2="10" /><line x1="18" y1="20" x2="18" y2="4" /><line x1="6" y1="20" x2="6" y2="16" /></>,
    clock: <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>,
    hourglass: <><path d="M5 22h14M5 2h14" /><path d="M17 22v-4.17a2 2 0 0 0-.59-1.41L12 12l-4.41 4.42A2 2 0 0 0 7 17.83V22M7 2v4.17a2 2 0 0 0 .59 1.41L12 12l4.41-4.42A2 2 0 0 0 17 6.17V2" /></>,
    archive: <><polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" /></>,
    clipboard: <><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" ry="1" /></>,
    building: <><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01" /></>,
    wifi: <><path d="M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01" /></>,
    sliders: <><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></>,
    eye: <><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>,
  };
  return <svg aria-hidden="true" {...common}>{paths[name]}</svg>;
}
