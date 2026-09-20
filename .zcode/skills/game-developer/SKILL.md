---
name: game-developer
description: "Full-stack game development guidance from concept to shipped game. Use when planning game projects, writing game documentation, implementing core systems, or when the user mentions game development workflow, game design documents, game prototypes, or building a game from scratch."
---

# Game Developer

End-to-end game development guidance covering concept, implementation, testing, and shipping.

## When to use this skill

- User wants to plan or start a new game project
- User asks for game documentation or design docs
- User needs implementation guidance for game systems
- User mentions game prototypes, vertical slices, or MVPs
- Creating game documentation, TDDs, or GDDs
- Managing game development project scope and milestones

## Development phases

### 1. Concept & Design
- Game pitch: genre, hook, target audience
- Core loop: what the player does repeatedly
- Mechanics: what makes it fun and unique
- Art/audio style: visual direction and references
- Scope definition: minimum viable game

### 2. Prototype
- Implement core mechanic as quickly as possible
- Paper prototype first, then digital
- Playtest immediately — don't build too much
- Kill mechanics that don't feel good
- Document what works and what doesn't

### 3. Vertical Slice
- One complete level with all systems
- Polish the feel of interaction
- Validate art direction and audio
- Establish team/developer workflow
- Use as proof-of-concept for funding/publishing

### 4. Production
- Build remaining content (levels, enemies, items)
- Implement balancing systems
- Add UI, menus, save/load
- Optimize performance for target platform
- Test extensively

### 5. Polish & Ship
- QA bug fixing
- Playtesting feedback integration
- Accessibility and settings options
- Build for distribution platforms
- Launch and post-launch support

## Game Design Document (GDD) structure

```
1. Game Overview
   - Elevator pitch
   - Core gameplay loop
   - Target audience

2. Game Mechanics
   - Controls and input
   - Player abilities and progression
   - Enemy/AI behaviors
   - Rules and win/loss conditions

3. Game World
   - Setting and lore
   - Level design
   - Art style guide
   - Audio direction

4. UI/UX
   - HUD elements
   - Menus and navigation
   - Feedback systems

5. Technical
   - Engine and tools
   - Platform targets
   - Performance requirements
   - Network architecture (if multiplayer)

6. Production
   - Milestones and timeline
   - Asset requirements
   - Team structure
```

## Reference files

- `references/project-planning.md` — Milestone planning, scope management
- `references/game-docs.md` — GDD templates and best practices
- `references/playtesting.md` — How to run effective playtests
- `references/shipping.md` — Platform requirements, certification, launch checklist

## What goes wrong

- Scope creep: feature list grows without timeline adjustment
- No playtesting early: building features that don't work
- Perfection paralysis: prototype never leaves prototype phase
- No documentation: teammates don't share context
- Underestimated polish time: bugs and balancing take 50% of schedule

## Report

Project timeline, GDD summary, milestone status, risk assessment, and next action items.
