import type { ReactElement, SVGProps } from "react";

/** Notes-only glyphs that the shared icon set does not carry. Same 24px grid and stroke as <Icon>. */
export type NoteGlyphName = "graph" | "more" | "sidebar-left" | "sidebar-right" | "hash";

const PATHS: Record<NoteGlyphName, ReactElement> = {
  graph: <><circle cx="6" cy="6" r="2.25" /><circle cx="18" cy="7.5" r="2.25" /><circle cx="12" cy="18" r="2.25" /><path d="m8.1 7 7.7 0.4M7.2 8 11 15.9M16.9 9.5 13 16" /></>,
  more: <><circle cx="6" cy="12" r="1.1" fill="currentColor" /><circle cx="12" cy="12" r="1.1" fill="currentColor" /><circle cx="18" cy="12" r="1.1" fill="currentColor" /></>,
  "sidebar-left": <><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="M9.5 4.5v15" /></>,
  "sidebar-right": <><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="M14.5 4.5v15" /></>,
  hash: <path d="M9.5 4 8 20M16 4l-1.5 16M4.5 9h15M4 15h15" />,
};

export function NoteGlyph({ name, ...props }: SVGProps<SVGSVGElement> & { name: NoteGlyphName }) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
      {PATHS[name]}
    </svg>
  );
}
