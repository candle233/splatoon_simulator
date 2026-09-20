---
name: multiplayer-game
description: "Multiplayer game networking, synchronization, and real-time gameplay systems. Use when implementing online multiplayer features, matchmaking, network protocols, client-server architecture, lag compensation, or when the user mentions PVP, real-time multiplayer, online matchmaking, or competitive gameplay."
---

# Multiplayer Game

Real-time multiplayer game systems including networking, synchronization, and competitive matchmaking.

## When to use this skill

- User wants to implement online multiplayer features
- User asks about matchmaking, lobby systems, or player pairing
- User mentions client-server, authoritative server, or peer-to-peer networking
- User needs lag compensation, prediction, or reconciliation
- User asks about real-time PVP or competitive gameplay systems
- Implementing game state synchronization across clients

## Core networking concepts

### Client-Server model (recommended for competitive games)
- Server is authoritative for game state
- Clients send input, receive state updates
- Prevents cheating through validation
- Handles disconnect/reconnect gracefully

### Network topology
- Dedicated server (best for competitive)
- Listen server (host = client, simpler)
- P2P (only for casual, needs NAT traversal)

### State synchronization
- **State sync**: server sends full state periodically (simple, high bandwidth)
- **Delta sync**: only send changed fields (efficient)
- **Input sync**: client sends inputs, server simulates (authoritative)

### Interpolation and Prediction
- Client stores history of received states
- Interpolate render position between last two received states
- Predict local player movement locally before server confirmation
- Reconcile when server correction arrives (rollback if needed)

### Lag compensation
- Server rewinds time to validate hits from lagging clients
- Hitbox position at time of client shot, not server time
- Fair play even with network variance

## Implementation patterns

### Authoritative movement
```
client: local input → predict position → render
server: receive input → simulate → send corrected state
client: receive → reconcile → adjust to server position
```

### Entity interpolation
```csharp
// Client-side: smooth over network jitter
Vector3 current = Vector3.Lerp(prevPos, nextPos, interpolationFactor);
float interp = (networkTime - prevTimestamp) / frameTime;
```

### Snapshot system
- Server sends fixed-rate snapshots (e.g., 20/tick)
- Each snapshot contains entity positions, states
- Delta compression between snapshots
- Client interpolation uses multiple snapshots

## Matchmaking considerations

- **Skill-based matching**: ELO, MMR, or custom rating
- **Region selection**: lowest latency
- **Queue time vs quality tradeoff**
- **Party support**: group matchmaking
- **Reconnect handling**: rejoin in-progress matches

## Reference files

- `references/protocols.md` — UDP vs TCP, custom protocols, ENet
- `references/prediction.md` — Client prediction, server reconciliation
- `references/security.md` — Anti-cheat, validation strategies
- `references/encoding.md` — State encoding, delta compression

## What goes wrong

- Rubber-hose effect: slow update rates make movement feel laggy
- Desync: floating point differences compound over time
- Hit validation: lag compensation not accounting for network delay
- Bandwidth overload: sending too much data per tick
- No reconciliation: clients see different game states

## Report

Network architecture diagram, sync strategy, prediction model, matchmaking algorithm, bandwidth estimates, and testing plan.
