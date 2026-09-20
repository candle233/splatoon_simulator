---
name: game-feel
description: "Game feel, juice, tactile feedback, and player interaction quality. Use when improving game responsiveness, adding screen shake, hit feedback, haptic effects, or when the user mentions game feel, juice, tactile feedback, hit response, screen shake, or game feel improvement."
---

# Game Feel

The science and practice of making game interactions feel responsive, impactful, and satisfying.

## When to use this skill

- Improving game responsiveness and input feedback
- Adding screen shake, hit effects, particle bursts
- Tuning animation timing for player actions
- Implementing haptic feedback (rumble, vibration)
- Making interactions feel "good" even when simple
- User mentions game feel, juice, tactile feedback, hit response, or game feel improvement

## Principles of Game Feel

### Input-to-screen latency
- Target: under 50ms between input and visual feedback
- Buffer inputs, don't wait for animation
- Immediate visual response, then play catch-up animation
- Poll input at frame start, not deferred

### Hit feedback (3 layers)
1. **Visual**: impact flash, particle burst, hit marker, blood/debris
2. **Audio**: impact sound, damage noise, environmental response
3. **Physical**: screen shake, controller rumble, pause frame

### Animation principles
- **Anticipation**: wind-up before action (charged attack)
- **Follow-through**: movement continues after input stops
- **Squash and stretch**: overshoot target then settle
- **Screenshake**: only on impactful events, not every action

### Juice multipliers
- Screen shake × hit particles × sound × pause frame
- Not all events deserve all multipliers — tier by importance
- Minor damage: sound only
- Major hit: all 4
- Player death: + audio cue + full screen flash

## Practical implementations

### Hit stop (pause frame)
```js
// Brief freeze on impactful hit
const hitStopDuration = 0.08; // seconds
let hitStopRemaining = 0;

update(dt) {
  if (hitStopRemaining > 0) {
    hitStopRemaining -= dt;
    return; // Skip this update frame
  }
  // Normal update logic
}
```

### Screen shake
- Shake amount decays exponentially
- Horizontal shake dominates (less disorienting than vertical)
- Clamp maximum to prevent motion sickness
- Use different intensities per event type

### Impact particles
- Emit at contact point
- Use collision normal for direction
- Velocity-based count: faster = more particles
- Short-lived (0.2-0.5s), wide arc for dramatic effect

## Reference files

- `references/juice-catalog.md` — Comprehensive list of juice techniques
- `references/implementations.md` — Code examples for common feel improvements
- `references/diagnostics.md` — How to identify and fix feel problems

## What goes wrong

- Screen shake on every action → player fatigue
- Input lag from waiting for animation to finish
- Inconsistent feedback between similar actions
- Juice that contradicts game state (shake on non-damaging hit)
- Over-the-top effects in a game that needs precision

## Report

Feel assessment, recommended juice additions with priority, implementation approach, and testing plan.
