# Command palette

⌘K on macOS/iOS, Ctrl+K on Windows, Linux and Android keyboards opens a search and command palette (`CommandPalette`); the same shortcut closes it. On a Mac, Ctrl+K is left alone because it deletes to the end of the line in text fields. No other shortcut uses K (the app uses ⌘/Ctrl N and J, and "/" in Notes), so it also works from inside text fields and the notes editor. On phones, a search button in `MobileTopBar` opens it.

- Search: `lib/fuzzy.ts` (accent- and case-insensitive; substrings first, then in-order characters with word-start and run bonuses) over tasks (title, description, checklist items), habits, notes (title and body), projects and commands. Results are grouped (Recent, Commands, Tasks, Habits, Notes, Projects), at most 8 per group, open tasks before completed ones.
- Recent: the last 8 picks (`prior.palette.recent.v1`) are shown first with an empty query, and matching recent items lead the results.
- Commands: new task, new habit, go to each view, open each settings tab, light/dark/system theme, turn the gamified mode on or off, sign out.
- Accessibility: the input is an ARIA combobox (`aria-controls`, `aria-activedescendant`) over a listbox of grouped options; ↑/↓ move, Ctrl+Home/End jump, Enter opens, Escape closes. The dialog is modal and follows both themes.
