---
name: game-design-theory
description: "Game design frameworks including MDA, flow theory, core loop design, and player psychology. Use when analyzing game mechanics, designing game systems, balancing difficulty, or when the user mentions MDA framework, flow theory, game design, core loop, difficulty scaling, or player motivation."
---

# Game Design Theory

Analytical frameworks for understanding and designing game systems.

## When to use this skill

- User asks to analyze game design or mechanics
- User wants to design a new game system
- Balancing difficulty, rewards, or progression
- Understanding player motivation and psychology
- Reviewing game design against established frameworks
- User mentions MDA, flow, core loop, or game mechanics

## Core Frameworks

### MDA (Mechanics, Dynamics, Aesthetics)
- **Mechanics**: rules, systems, code that drive gameplay
- **Dynamics**: how mechanics behave in practice with player input
- **Aesthetics**: the emotional response the game evokes
- Design backwards: target emotion → dynamics needed → mechanics to support

### Flow Theory
- Optimal challenge is slightly above skill level
- Too easy → boredom, too hard → frustration
- Gradual difficulty curve keeps engagement
- Clear goals and immediate feedback enable flow state

### Core Loop
- Repeated gameplay pattern that drives engagement
- **Action → Reward → Decision** (e.g., shoot → get XP → choose upgrade)
- **Gather → Build → Defend** (e.g., collect resources → create base → survive)
- **Move → Observe → Act** (e.g., explore → find objective → solve)

## Difficulty Design

### Rubber-banding (adaptive difficulty)
- Dynamic adjustment based on player skill
- Too easy → increase challenge, too hard → reduce
- Invisible to player: adjust spawn rates, enemy stats, item drops
- Track performance metrics: time-to-complete, death frequency

### Pacing
- Alternating tension and release
- **Boss → rest → exploration → mini-boss → boss** rhythm
- Short cycles for sessions, long cycles for progression
- Reward frequency: every 3-5 min small, every 15-30 min medium

### Player Motivation
- **Intrinsic**: fun of mastery, exploration, creativity
- **Extrinsic**: XP, rewards, ranking, progression
- **Social**: competition, cooperation, sharing
- **Creative freedom**: player expression and choice

## Reference files

- `references/mda-analysis.md` — How to apply MDA to existing games
- `references/difficulty-curves.md` — Graphs and examples of difficulty pacing
- `references/player-psychology.md` — What motivates players, common patterns
- `references/systems-design.md` — Designing interlocking game systems

## What goes wrong

- MDA analysis without actual playtesting
- Difficulty curve too steep or too flat
- Rewards not tied to player actions
- No clear player agency — feels like watching a demo
- Mechanics don't support the intended aesthetic

## Report

Framework applied (MDA/Flow), difficulty curve visualization, player motivation analysis, system interlocking diagram, and recommended changes with priority.
