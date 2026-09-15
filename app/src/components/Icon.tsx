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
  | "close"
  | "mail"
  | "lock"
  | "google"
  | "apple"
  | "windows"
  | "android"
  | "linux"
  | "download"
  | "refresh"
  | "search";

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, ...props };
  const paths: Record<IconName, ReactElement> = {
    plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
    check: <path d="m5 12 4.5 4.5L19 7" />,
    "check-circle": <><circle cx="12" cy="12" r="8.5" /><path d="m8.5 12 2.4 2.4 4.8-5" /></>,
    star: <path d="m12 3 2.78 5.63 6.22.9-4.5 4.39 1.06 6.2L12 17.2l-5.56 2.92 1.06-6.2L3 9.53l6.22-.9L12 3Z" />,
    bolt: <path d="m13 2-9 12h7l-1 8 9-12h-7l1-8Z" />,
    trash: <><path d="M4 7h16" /><path d="M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
    arrow: <><path d="M5 12h13" /><path d="m13 6 6 6-6 6" /></>,
    cloud: <><path d="M7 18h10a4 4 0 0 0 .4-7.98A5.5 5.5 0 0 0 6.2 8.2 4 4 0 0 0 7 18Z" /></>,
    user: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.8-3.2 3.2-4.8 7-4.8s6.2 1.6 7 4.8" /></>,
    inbox: <><path d="M4 5.5h16v13H4z" /><path d="M4 14h4l1.5 2h5L16 14h4" /></>,
    focus: <><circle cx="12" cy="12" r="7.5" /><circle cx="12" cy="12" r="2" /></>,
    plan: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></>,
    quick: <path d="m13 2-9 12h7l-1 8 9-12h-7l1-8Z" />,
    later: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></>,
    important: <path d="m12 3 2.78 5.63 6.22.9-4.5 4.39 1.06 6.2L12 17.2l-5.56 2.92 1.06-6.2L3 9.53l6.22-.9L12 3Z" />,
    list: <><path d="M8 6h12M8 12h12M8 18h12" /><path d="M4 6h.01M4 12h.01M4 18h.01" /></>,
    grid: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    mail: <><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="m4.5 7 7.5 5.5L19.5 7" /></>,
    lock: <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    apple: <><path d="M15.5 7.4c-.8.8-1.8 1.2-2.8 1.1-.1-1 .3-2 1-2.7.7-.7 1.8-1.2 2.8-1.2.1 1-.3 2-1 2.8Z" fill="currentColor" stroke="none" /><path d="M17.5 12.7c0-2 1.6-3 1.7-3.1-.9-1.3-2.3-1.5-2.8-1.5-1.2-.1-2.3.7-2.9.7-.6 0-1.5-.7-2.5-.7-1.3 0-2.5.8-3.1 1.9-1.4 2.4-.4 6 1 8 .7 1 1.5 2 2.6 2 .9 0 1.4-.6 2.6-.6 1.2 0 1.6.6 2.6.6 1.1 0 1.8-1 2.5-2 .8-1.1 1.1-2.2 1.2-2.3-.1 0-2.9-1.1-2.9-3.1Z" /></>,
    windows: <><path d="M3.5 5.5 11 4.5v7H3.5v-6Z" fill="currentColor" stroke="none" /><path d="m13 4.2 7.5-1.1v8.4H13V4.2Z" fill="currentColor" stroke="none" opacity=".8" /><path d="M3.5 13H11v7l-7.5-1.1V13Z" fill="currentColor" stroke="none" opacity=".8" /><path d="M13 13h7.5v8.4L13 20.3V13Z" fill="currentColor" stroke="none" /></>,
    android: <><path d="M7.5 9.5h9a2 2 0 0 1 2 2v5.8a2 2 0 0 1-2 2H7.5a2 2 0 0 1-2-2v-5.8a2 2 0 0 1 2-2Z" fill="currentColor" stroke="none" /><path d="M5.5 11.5v5.8M18.5 11.5v5.8M8.2 9.2 6.7 6.8M15.8 9.2l1.5-2.4M8.3 6.8c1.1-1.1 2.3-1.6 3.7-1.6s2.6.5 3.7 1.6M8.3 19.3v2M15.7 19.3v2" /></>,
    linux: <><path d="M12 4c-2.4 0-3.5 2.1-3.5 4.2 0 1.4-.8 2.3-1.4 3.5-.8 1.5-1.3 3.1-.7 5.2.4 1.4 1.6 2.3 2.9 2.4h5.4c1.3-.1 2.5-1 2.9-2.4.6-2.1.1-3.7-.7-5.2-.6-1.2-1.4-2.1-1.4-3.5C15.5 6.1 14.4 4 12 4Z" fill="currentColor" stroke="none" /><path d="M8.7 16.1c1 .7 2.1 1 3.3 1s2.3-.3 3.3-1M9.7 10.2h.01M14.3 10.2h.01" stroke="#fffefa" /></>,
    download: <><path d="M12 3v11" /><path d="m7.5 10 4.5 4.5 4.5-4.5" /><path d="M5 20h14" /></>,
    refresh: <><path d="M20 11a8 8 0 0 0-14.7-3L4 10" /><path d="M4 5v5h5" /><path d="M4 13a8 8 0 0 0 14.7 3L20 14" /><path d="M20 19v-5h-5" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.3" /><path d="m16 16 4.2 4.2" /></>,
    google: <><path d="M21 12.2c0-.7-.1-1.4-.2-2H12v3.8h5a4.3 4.3 0 0 1-1.9 2.8v2.4h3.1c1.8-1.7 2.8-4.1 2.8-7Z" fill="currentColor" stroke="none" /><path d="M12 21c2.5 0 4.6-.8 6.2-2.2l-3.1-2.4c-.8.5-1.8.8-3.1.8-2.4 0-4.4-1.6-5.1-3.8H3.7v2.5A9.4 9.4 0 0 0 12 21Z" fill="currentColor" stroke="none" opacity=".75" /><path d="M6.9 13.4a5.7 5.7 0 0 1 0-2.8V8.1H3.7a9.4 9.4 0 0 0 0 7.8l3.2-2.5Z" fill="currentColor" stroke="none" opacity=".55" /><path d="M12 6.8c1.4 0 2.6.5 3.6 1.5l2.7-2.7C16.6 4 14.5 3 12 3a9.4 9.4 0 0 0-8.3 5.1l3.2 2.5C7.6 8.4 9.6 6.8 12 6.8Z" fill="currentColor" stroke="none" opacity=".9" /></>,
  };
  return <svg aria-hidden="true" {...common}>{paths[name]}</svg>;
}
