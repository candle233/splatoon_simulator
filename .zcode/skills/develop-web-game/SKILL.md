---
name: develop-web-game
description: "Build web-based games with HTML5, Canvas, WebGL, and JavaScript. Use when creating browser games, HTML5 games, web game prototypes, or when the user mentions web game development, browser game, Canvas game, or Codex web game."
---

# Develop Web Game

Build browser-based games using HTML5, Canvas, WebGL, and modern JavaScript.

## When to use this skill

- Creating browser-based games (HTML5, Canvas, WebGL)
- Building web game prototypes quickly
- User mentions "Codex" web game or browser game development
- Need cross-platform web game (desktop, mobile, tablet)
- Quick game ideas that need a single deployable file
- User asks about web game engines (Phaser, Kaboom, PlayCanvas)

## Technology choices

### Pure Canvas (simple 2D)
- Good for: arcade games, puzzles, retro-style
- No dependencies, single HTML file possible
- Draw API for sprites, shapes, text
- requestAnimationFrame for game loop

### Phaser (2D/3D framework)
- Full-featured: physics, audio, animation, scenes
- Good for: platformers, RPGs, puzzle games
- Handles input, scaling, mobile
- Scene management built-in

### Three.js (3D browser)
- Good for: 3D shooters, racing, exploration
- WebGL rendering with Three.js abstractions
- Custom shaders for game effects
- Collision detection needs custom implementation

### Kaboom.js (rapid prototyping)
- Minimal syntax, fast prototyping
- Built-in sprites, audio, physics
- Great for game jams and prototypes
- Small bundle size

## Web game architecture

### Game loop
```js
class Game {
  constructor() {
    this.lastTime = 0;
    this.state = {};
  }
  
  loop(timestamp) {
    const dt = (timestamp - this.lastTime) / 1000;
    this.lastTime = timestamp;
    
    this.update(dt);
    this.render();
    
    requestAnimationFrame((t) => this.loop(t));
  }
  
  update(dt) {
    // Input → state changes → physics
  }
  
  render() {
    // Draw current state to canvas
  }
}
```

### State management
- Use state machine for game phases (menu → playing → pause → gameover)
- Save state for resume/persistence
- State serialization for save/load

### Input handling
- Keyboard: track pressed keys each frame
- Mouse: position, clicks, wheel
- Touch: touchstart, touchmove, touchend
- Gamepad: nintendo switch, Xbox controllers

## Responsive design

### Viewport
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
```

### Canvas scaling
- Fixed aspect ratio design with CSS scaling
- `object-fit: contain` equivalent for canvas
- Responsive font sizes for UI overlays

### Touch controls
- Virtual joystick for movement
- Tap-to-interact buttons
- Gesture-based shortcuts (swipe to jump)
- Prevent default touch behaviors (scrolling, zooming)

## Deployment

### Single-file game
```html
<!DOCTYPE html>
<html>
<head><title>My Game</title></head>
<body>
<canvas id="game"></canvas>
<script src="game.js"></script>
</body>
</html>
```

### Sharing
- Static hosting (GitHub Pages, Netlify, CloudBase)
- No build step required for simple games
- Bundle with esbuild/rollup for complex ones

## Reference files

- `references/canvas-patterns.md` — Common Canvas game patterns
- `references/touch-controls.md` — Mobile touch UI design
- `references/sound.md` — Web Audio API for games
- `references/save-state.md` — LocalStorage and save systems

## What goes wrong

- Frame rate dependent physics (different speeds at different FPS)
- Mobile input not working (touch vs mouse)
- Canvas not responsive on resize
- Audio context blocked (needs user gesture to start)
- Memory leaks from unmanaged event listeners

## Report

Game architecture, feature list, controls, rendering approach, responsiveness status, deployment plan, and testing checklist.
