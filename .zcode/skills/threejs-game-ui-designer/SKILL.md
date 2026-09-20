---
name: threejs-game-ui-designer
description: "Premium Three.js game UI design: HUDs, menus, overlays, touch controls, responsive layout, and UI/world cohesion. Use when designing or improving Three.js game interfaces, 3D UI, or when the user mentions Three.js UI, web game interface, or game HUD."
---

# Three.js Game UI Designer

Design premium Three.js game UI that is intentional, readable, responsive, and cohesive with the 3D world.

## When to use this skill

- Designing HUD elements for Three.js games
- Building menus and overlays in a Three.js context
- Creating responsive UI that works on desktop and mobile
- Integrating 2D UI with 3D world space
- Touch control design for browser games
- User mentions Three.js UI, web game interface, or game HUD design

## Reference

Read `references/ui-patterns.md` before designing HUDs, menus, overlays, touch controls, or responsive layout. This covers hierarchy and required states, HUD zones, menus, touch controls, responsive constraints, style cohesion, and state wiring.

Load `threejs-image-generator` for logos, icons, GUI art, faction marks, menu backgrounds, or 2D HUD assets. Use `threejs-3d-generator` only for genuine 3D menu objects and diegetic props, not flat HUD elements.

## Workflow

1. **Capture screenshots** — desktop and mobile views of existing UI
2. **Inventory states** — gameplay, pause, settings, fail/retry, win/milestone, loading, touch controls
3. **Set hierarchy** — survival/status → objective → feedback → flavor
4. **Replace generic cards** — use authored clusters, meters, badges, icons, alerts, modal states
5. **Apply stable dimensions** — safe-area padding, text-fit constraints, hover/pressed/focus/disabled states
6. **Wire to game state** — UI follows game state, don't duplicate game rules in UI code
7. **Validate** — text fit with longest values, safe areas, touch targets, state changes on both viewports

## Mobile input

Required when mobile is a target platform, not optional. Design touch controls, safe areas, and viewport constraints as first-class concerns.

## Three.js-specific considerations

- CSS2DRenderer / CSS3DRenderer for DOM-based UI overlays
- Sprite-based UI for world-space elements
- Raycasting for 3D interactive elements
- Resize handler for responsive viewport
- Mobile viewport: `viewport-fit=cover`, touch-action manipulation

## What goes wrong

- Generic stat-card dashboard instead of authored HUD clusters
- UI covering player, threats, or important decisions
- Text clips or shifts on mobile viewports
- Decorative panels reduce readability
- Touch controls that look right but emit no intents
- 2D UI not accounting for 3D world occlusion

## Report

UI intent and states covered, files changed, target-viewport screenshots, text-fit and overlap findings, safe-area and touch-target evidence, and remaining risks. Feed results into the lead's consolidated pass rather than rerunning unchanged game-wide checks.
