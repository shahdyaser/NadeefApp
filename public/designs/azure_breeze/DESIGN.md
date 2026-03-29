# Design System Strategy: Mediterranean Clarity

This document defines the visual language for a high-end cleaning experience. We are moving away from the "utility app" aesthetic and toward a "sanctuary management" feel. The goal is to evoke the breeze of a coastal villa—clean, sun-drenched, and effortless.

## 1. Creative North Star: "The Pristine Atrium"
The "Pristine Atrium" philosophy treats the UI as an open-air architectural space. We reject the cluttered "dashboard" look in favor of a **Bento-Box layout** that uses intentional asymmetry and varying card heights to create a rhythmic, editorial flow. 

To achieve this, we avoid rigid grids. Elements should feel like they have room to breathe, using wide margins and "quiet" zones to reduce cognitive load. This isn't just a house-cleaning app; it is a digital deep-breath for the user.

---

## 2. Color & Surface Philosophy
The palette transitions from the refreshing cool of `primary` (Teal) to the grounding warmth of `secondary` (Terracotta). 

### The "No-Line" Rule
**Strict Mandate:** Prohibit 1px solid borders for sectioning. 
Boundaries are defined solely through background color shifts. A `surface-container-low` section sitting on a `surface` background provides enough contrast to signal a change in context without the visual "noise" of a line.

### Surface Hierarchy & Nesting
Treat the UI as physical layers of fine paper or frosted glass.
*   **Base:** `surface` (#f7f9fb) – The foundation.
*   **Structural Sections:** `surface-container-low` (#f2f4f6) – Use for large background areas.
*   **Interactive Cards:** `surface-container-lowest` (#ffffff) – Use for the primary Bento units to make them "pop" against the off-white base.
*   **Nesting:** If a card requires an internal section (e.g., a booking summary inside a task card), use `surface-container-high` (#e6e8ea) for the inner element.

### The Glass & Gradient Rule
To prevent the UI from feeling "flat" or "cheap," use Glassmorphism for floating navigation bars or modal overlays.
*   **Token:** `surface` at 80% opacity with a `blur-xl` (24px) backdrop filter.
*   **Signature Gradients:** For primary CTAs (Book Now) or Progress Bars, use a linear gradient from `primary` (#006b5f) to `primary_container` (#2dd4bf) at a 135° angle. This adds "soul" and dimension.

---

## 3. Typography: Editorial Sans
We use **Inter** not as a system font, but as a brand serif-alternative. The hierarchy relies on extreme scale contrast.

*   **Display & Headline:** Use `display-md` or `headline-lg` for welcome states ("Your home is breathing easy"). Use `on_surface` (#191c1e) with a tracking of `-0.02em` to feel premium.
*   **Title:** `title-lg` is for Bento card headers. It should feel authoritative but approachable.
*   **Body:** `body-md` for descriptions. Ensure a line-height of at least 1.5 to maintain the "airy" feel.
*   **Label:** `label-sm` in `secondary` (#9d4300) for rewards or status badges to provide a warm, tactile punch against the cool mint backgrounds.

---

## 4. Elevation & Depth
Depth in this system is achieved through **Tonal Layering**, not structural scaffolding.

### The Layering Principle
Stacking tiers creates natural lift. 
*   **Example:** A `surface-container-lowest` (#ffffff) card placed on a `surface-container-low` (#f2f4f6) background creates a "lifted" effect that feels cleaner than a drop shadow.

### Ambient Shadows
When an element must float (e.g., a "Book Service" FAB), use an **Ambient Shadow**:
*   **Values:** `0 20px 40px -12px`
*   **Color:** `rgba(25, 28, 30, 0.06)` (A tinted version of `on-surface`). 
*   **Rule:** Never use pure black shadows. Shadows must feel like they are cast by soft, diffused sunlight.

### The "Ghost Border" Fallback
If a border is required for accessibility (e.g., in high-contrast modes), use a **Ghost Border**:
*   **Token:** `outline_variant` at 15% opacity. It should be felt, not seen.

---

## 5. Component Guidelines

### Bento Cards
*   **Radius:** Always `rounded-xl` (1.5rem).
*   **Layout:** Mix spans (1x1, 2x1, 2x2).
*   **Spacing:** Use `spacing-6` (2rem) between cards to allow the "Mediterranean Air" to circulate.

### Buttons (The "Soft-Touch" Action)
*   **Primary:** Gradient of `primary` to `primary_container`. White text. `rounded-full` for a friendly, pebble-like feel.
*   **Secondary (Sand/Terracotta):** Use `secondary_container` (#fd761a) for rewards-related actions. It acts as a "warm" interrupt to the cool mint.
*   **Tertiary:** Ghost style. No background, `on_surface_variant` text.

### Lists & Dividers
*   **Rule:** Forbidden use of divider lines. 
*   **Alternative:** Use vertical white space (`spacing-4`) or subtle background alternations between `surface-container-lowest` and `surface-container-low`.

### Progress Bars (The "Freshness" Indicator)
*   **Track:** `surface-container-highest` (#e0e3e5).
*   **Indicator:** `primary_container` (#2dd4bf) with a subtle pulse animation to signify "cleaning in progress."

### Custom Component: The "Scent Tag" (Badge)
Small, `rounded-full` badges using `tertiary_fixed` (#ffe24c) for high-priority alerts or "Cleanliness Score" updates.

---

## 6. Do’s and Don’ts

### Do
*   **Do** use asymmetrical Bento layouts to create visual interest.
*   **Do** use high-scale typography for titles (e.g., 2.25rem headlines next to 0.875rem body text).
*   **Do** embrace white space as a functional design element.

### Don’t
*   **Don't** use 1px solid lines to separate content. 
*   **Don't** use sharp corners. Everything must feel "tumbled" like a sea-glass pebble (`rounded-xl` or `rounded-full`).
*   **Don't** use high-opacity shadows. If the shadow is obvious, it’s too heavy.
*   **Don't** use more than three cards in a horizontal row on mobile; keep the "airy" feel.