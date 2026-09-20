---
name: game-ui-design
description: "Game UI/UX design for heads-up displays, menus, overlays, and player interfaces. Use when designing HUD elements, game menus, pause screens, settings panels, inventory systems, or when the user mentions UI/UX for games, interface design, or player experience."
---

# Game UI Design

Game user interface and experience design for interactive entertainment.

## When to use this skill

- User wants to design or improve game HUD (heads-up display)
- User needs menu systems (pause, options, inventory, save/load)
- User asks about in-game overlays or feedback systems
- Designing UI for different platforms (desktop, console, mobile)
- Creating accessible interfaces with good readability
- User mentions UI/UX for games, interface design, or player experience

## HUD Design Principles

### Information hierarchy
1. **Critical info** (health, ammo, immediate threats) — always visible, prominent
2. **Temporal info** (timer, cooldown) — show when relevant
3. **Contextual info** (objective, quest) — show when active
4. **Secondary info** (mini-map, score) — subtle, toggleable

### Visual design
- High contrast for readability at speed
- Consistent color coding (red = danger, green = health)
- Safe zone margins for console/mobile
- Animation: subtle, purposeful, not distracting
- Feedback: visual/sound/haptic for important events

### State management
- Pause menu: clear exit path, settings accessible
- Death screen: cause of death, restart options, stats
- Win/Lose: score summary, next steps
- Loading: progress indication, skip if possible

## Menu Design

### Navigation patterns
- Radial menus for quick selection (console)
- Grid/categorized for inventory-heavy games
- Modal flows: "Confirm" before destructive actions
- Keyboard shortcuts documented or discoverable

### Input mapping
- Support controller, keyboard, mouse, touch simultaneously
- Remappable controls with default presets
- On-screen prompts match active input method

## Reference files

- `references/hud-zones.md` — HUD placement zones and safe areas
- `references/input-mapping.md` — Controller/keyboard/touch design patterns  
- `references/accessibility.md` — Colorblind modes, text scaling, input options
- `references/style-guide.md` — Visual language, typography, iconography

## What goes wrong

- HUD covers important gameplay
- Menu navigation requires too many inputs
- Text unreadable at normal gameplay speed
- Mobile UI designed for mouse/keyboard
- No feedback when player interacts

## Report

HUD layout mockup, menu navigation flow, input mapping table, accessibility checklist, and implementation notes.
