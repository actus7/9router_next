# ModelHub design system

## Direction

The interface is a dense operational dashboard: calm neutral surfaces, clear hierarchy, restrained motion and semantic status. Remediation preserves the existing identity and landing page while consolidating primitives and accessibility behavior.

## Canonical UI layer

- `src/components/ui` owns shadcn Base UI primitives and reusable field/media compositions.
- Domain components may compose primitives but must not recreate Button or Input primitives.
- Runtime blob/data/provider images use `DynamicMedia`; static local assets use `next/image`.
- Destructive confirmations use `AlertDialog`, with an explicit consequence and action label.

## Tokens and Tailwind

- Tailwind v4 remains CSS-first through `src/app/globals.css`; no JavaScript Tailwind config.
- Use semantic tokens such as `background`, `foreground`, `muted`, `primary` and `destructive` for functional state.
- Prefer parent `gap-*` layout over sibling `space-y-*` utilities in new or modified components.
- Dark mode comes from tokens and component variants; avoid per-element raw dark color overrides.

## Interaction and accessibility

- Every input has a stable ID, associated label and `aria-describedby` links to hint/error text.
- Invalid fields expose `aria-invalid`; errors use a live alert role where appropriate.
- Buttons retain a visible focus ring and at least a 44×44 CSS-pixel pointer target.
- Icon-only controls require an accessible name. Expandable card headers are real buttons with `aria-expanded`.
- Status cannot rely on color alone; pair semantic color with text or an icon.

## Intentional exceptions

- Dynamic media has unknown dimensions and may be a data/blob URL, so it bypasses the Next optimizer through the documented native boundary.
- Dense data visualization canvases may use compact visible glyphs, but their interactive controls retain the minimum pointer target.
- Provider brand imagery and landing accents may use brand colors; functional success, warning and failure states use semantic variants.
