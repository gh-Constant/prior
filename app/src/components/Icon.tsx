import type { ReactElement, SVGProps } from "react";

type IconName = "plus" | "check" | "star" | "bolt" | "trash" | "arrow" | "cloud" | "user";

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, ...props };
  const paths: Record<IconName, ReactElement> = {
    plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
    check: <path d="m5 12 4.5 4.5L19 7" />,
    star: <path d="m12 3 2.78 5.63 6.22.9-4.5 4.39 1.06 6.2L12 17.2l-5.56 2.92 1.06-6.2L3 9.53l6.22-.9L12 3Z" />,
    bolt: <path d="m13 2-9 12h7l-1 8 9-12h-7l1-8Z" />,
    trash: <><path d="M4 7h16" /><path d="M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
    arrow: <><path d="M5 12h13" /><path d="m13 6 6 6-6 6" /></>,
    cloud: <><path d="M7 18h10a4 4 0 0 0 .4-7.98A5.5 5.5 0 0 0 6.2 8.2 4 4 0 0 0 7 18Z" /></>,
    user: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.8-3.2 3.2-4.8 7-4.8s6.2 1.6 7 4.8" /></>,
  };
  return <svg aria-hidden="true" {...common}>{paths[name]}</svg>;
}
