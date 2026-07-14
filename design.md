# Design System: Synítheia

## Core Philosophy
Synítheia is a premium habit tracker designed to foster a sense of **calm productivity**. The design language is rooted in **warm minimalism**, prioritizing emotional well-being and clarity over cluttered data. It aims to make habit tracking feel like a mindful ritual rather than a chore.

---

## Visual Language

### 1. Color Palette
The palette is dominated by soft neutrals and muted tones, punctuated by a signature sage green accent that symbolizes growth and tranquility.

- **Primary (Sage):** `#7D927D` - Used for primary actions, completion states, and progress indicators.
- **Surface (Bone):** `#FBF9F6` - The primary background color, providing a warm, paper-like feel.
- **Surface Dim:** `#DBDAD7` - Used for secondary backgrounds and subtle depth.
- **On-Surface (Stone):** `#2D2D2D` - The primary text color, ensuring high readability with a soft contrast.
- **Accent (Sand):** `#EFECEA` - Used for secondary buttons and container backgrounds.

### 2. Typography
Synítheia uses **Manrope**, a modern geometric sans-serif that balances functional clarity with a friendly, organic personality.

- **Headlines:** SemiBold, tight tracking, used for page titles and large numbers.
- **Subheadings:** Medium, all-caps with wide tracking for section headers.
- **Body:** Regular, generous line height for maximum readability.
- **Captions:** Medium, smaller scale for metadata and labels.

### 3. Layering & Depth
- **Soft Shadows:** Elevation is communicated through broad, low-opacity shadows (`blur: 30px`, `y: 10px`) rather than harsh borders.
- **Glassmorphism:** Semi-transparent, blurred surfaces are used for modals, nav bars, and widgets to create a sense of breathability and continuity.
- **Roundness:** A consistent corner radius of `32px` for large cards and `16px` for smaller elements reinforces the soft, approachable aesthetic.

---

## Components

### 1. Habit Cards
- **Structure:** Left-aligned icon chip, habit name, and streak count. Right-aligned interaction area (checkbox or plus button).
- **Style:** Subtle background shift on completion; soft depth when inactive.

### 2. Progress Rings
- **Visuals:** A thick, track-based ring. The active segment uses the primary sage color with a soft glow.
- **Context:** Used on the dashboard to represent "Daily Flow" and in habit details for success rates.

### 3. Bottom Navigation
- **Design:** A floating, blurred container with clear icon-and-label pairings.
- **States:** Active items are highlighted with a soft background pill and the primary accent color.

### 4. Form Elements
- **Inputs:** Large, soft-filled containers with centered icons and clear placeholder text.
- **CTAs:** Full-width buttons with deep shadows and semi-bold typography.

---

## Interaction Principles
- **Clarity over Complexity:** Only show the most relevant information at any given time.
- **Gentle Feedback:** Use soft transitions and subtle scale changes for interactions.
- **Low Cognitive Load:** Maintain generous whitespace to prevent the user from feeling overwhelmed.
