# Product tour and navigation spaces

After the onboarding (`OnboardingFlow`) finishes, App opens the product tour (`components/tour/ProductTour.tsx`) once per account. It can be replayed from Settings → General → Navigation and from ⌘K ("Replay the Prior tour").

1. **Spaces.** Today, Tasks and Projects are always included. The optional spaces are Calendar, Focus, Eisenhower matrix, Habits, Notes, Mail inbox, Waiting and My tasks (`OPTIONAL_VIEWS` in `lib/navigation.ts`). The first time, the most used ones are pre-selected (`DEFAULT_ENABLED_VIEWS`: Calendar, Focus, Eisenhower, Habits, Notes); on a replay the current choice is.
2. **Slides.** Today, capture, organize, then one slide per chosen space (Eisenhower, Focus, Calendar, Habits, Notes, Inbox), then Prior AI and the command palette. Each slide has a themed mock-up (`TourArt.tsx`) and three tips; shortcuts and gestures differ between desktop and phone. Arrow keys and horizontal swipes move between slides.
3. **Done.** A summary of the spaces, then Today (or straight to Focus).

Skipping before confirming the spaces leaves the navigation unchanged; skipping later saves the spaces chosen so far.

The choice is stored as the hidden spaces in `prior.nav.hidden` and the tour version in `prior.tour.done`; both are UI preferences synced with the account (`preferences/ui`). Accounts that never chose keep every space. Hidden spaces disappear from the sidebar, the phone "More" screen and the palette's "Go to" commands, but their URLs still work, and the current page stays in the sidebar while it is open. Settings → General → Navigation turns each space on or off.
