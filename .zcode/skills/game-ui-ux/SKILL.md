---
name: game-ui-ux
description: "Game UX design including accessibility, navigation, onboarding, and player communication. Use when improving player onboarding, menu accessibility, text readability, tutorial systems, or when the user mentions UX, accessibility, onboarding, tutorials, or player communication."
---

# Game UI/UX

Game user experience design covering accessibility, navigation, onboarding, and communication patterns.

## When to use this skill

- Improving player onboarding and first-time experience
- Making game menus accessible
- Improving text readability and size
- Designing tutorial and hint systems
- Player communication via UI (alerts, warnings, status)
- User mentions UX, accessibility, onboarding, tutorials, or player communication

## Core UX principles for games

### Readability first
- Minimum 14pt equivalent at target distance
- High contrast against background (4.5:1 minimum)
- Avoid placing text over busy areas
- Drop shadows or outlines behind text

### Navigation
- Every screen has a clear exit path
- Breadcrumbs for deep hierarchies
- Last selected option remembered
- Back/Menu button always available

### Feedback
- Confirm every player action visually
- No ambiguity about what happened
- Error messages explain and suggest fixes
- Progress indicators for anything taking >3 seconds

## Onboarding patterns

### First session
1. Quick start: immediate gameplay, learn by doing
2. Optional tutorial: skippable, not forced
3. Contextual hints: show when relevant, not upfront
4. Gradual feature reveal: don't overwhelm

### Tooltip best practices
- Position near relevant UI element
- Dismissible but not disappearing automatically
- Show key + action, not full instruction
- Progressive disclosure for complex features

## Accessibility

### Visual
- Colorblind modes (deuteranopia, protanopia, tritanopia)
- Customizable text size (up to 2x default)
- High contrast mode
- Subtitle options: speaker name, sound descriptions, background

### Motor
- Remappable controls (all actions, not just movement)
- Hold vs toggle options
- Input buffering
- Auto-aim or aim assist options
- Slow-down options for timed actions

### Cognitive
- Reduce UI density in settings
- Toggle-only mechanics (pause pressure)
- Minimap always available
- Clear objectives: where to go, what to do

## Reference files

- `references/onboarding-flow.md` — Tutorial design patterns
- `references/accessibility-checklist.md` — Comprehensive accessibility audit list
- `references/color-palettes.md` — Safe color palettes for colorblind users
- `references/mobile-ux.md` — Touch-specific UX patterns

## What goes wrong

- Tutorials interrupt at the wrong moment
- Font too small at 1080p+ on TV distance
- No colorblind consideration (red/green status)
- Menu depth hides features (3+ levels deep)
- Mobile touch targets too small (<44px)

## Report

UX audit findings, accessibility compliance status, onboarding flow diagram, and recommended changes with priority.
