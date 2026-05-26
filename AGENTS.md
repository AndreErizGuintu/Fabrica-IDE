# Fabrica IDE — Agent Instructions

## Stack
- Electron + React + TypeScript (ERB boilerplate)
- Tailwind v4 (@import "tailwindcss" in App.css)
- PostCSS + postcss-loader wired into webpack (already configured)
- One Electron window — no multi-window setup

## File Structure
- App.tsx = traffic controller only (useState navigation)
- Each screen/component gets its own .tsx file eventually
- Each component can have its own .css for exceptions

## Styling Strategy
- Tailwind classes for: flex, grid, width, height, padding, margin, 
  gap, rounded, text size, font weight, shadows, backdrop-blur
- Inline style={{}} for: brand hex colors and custom fonts ONLY
- CSS file for EXCEPTIONS ONLY:
  - Pseudo-elements (::before, ::after)
  - Multi-layer radial gradients
  - Complex animations beyond keyframes
  - ::before accent color dots

## Brand Colors
- Background: #1a0a2e
- Panel: #2d1b4e  
- Accent: #a855f7
- Secondary: #7c3aed
- Text: #ffffff
- Muted text: use Tailwind text-gray-400

## Fonts
- Headings: Space Grotesk (import from Google Fonts)
- Body: IBM Plex Sans (import from Google Fonts)
- Code/Labels: Space Mono

## App.css Rules
ONLY allowed in App.css:
1. @import "tailwindcss"
2. Google Fonts @import
3. :root CSS variables for brand colors
4. body background radial gradient
5. Pseudo-element glow effects (::before, ::after)
6. Accent dot ::before styles
7. @keyframes animations
NEVER write layout, spacing, or component styles in App.css

## App.css Allowed Exceptions
- `* { box-sizing: border-box }` — universal reset
- `body { margin: 0; background: ...; font-family: ...; color: ... }` — global base styles that can't go in Tailwind or inline styles since they apply to the whole document root, not a component
The AGENTS.md rule "never write layout/spacing in App.css" applies to component-level styles only. Global document resets and body-level styles are always the exception — they belong in CSS, not in any component.

## Navigation
- Use useState<'splash' | 'main' | 'create' | 'editor'>
- Never use React Router
- Never add new npm packages without asking

## Screens
- Splash: logo + animated progress bar → auto advances to main
- MainMenu: navbar + 2 col grid + recent projects + quick actions
- CreateProject: 3 project type cards + name + location inputs
- Editor (coming later): Sidebar + TabBar + Monaco + Preview + PopAssistant

## Component Rules
- Keep all screens in App.tsx for now
- When splitting later: screens/ folder for full screens, components/ for reusable parts
- Never create separate Electron windows

## Changelog
- Added language detection helpers to Editor and made filename required.
- EditorLayout now uses state for filename/editor value and provides a language dropdown.