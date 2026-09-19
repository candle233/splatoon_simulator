export const PROTOCOL_EVENTS = {
  // Client to Server
  C2S_PLAYER_INPUT: 'c2s:player_input',
  C2S_PING: 'c2s:ping',
  C2S_LOBBY_UPDATE: 'c2s:lobby_update',
  C2S_LOBBY_START: 'c2s:lobby_start',
  C2S_LOBBY_ADD_BOT: 'c2s:lobby_add_bot',
  C2S_LOBBY_REMOVE_BOT: 'c2s:lobby_remove_bot',
  C2S_MATCH_CONFIG: 'c2s:match_config',

  // Server to Client
  S2C_WELCOME: 's2c:welcome',
  S2C_SNAPSHOT: 's2c:snapshot',
  S2C_PAINT_BATCH: 's2c:paint_batch',
  S2C_PAINT_HISTORY_CHUNK: 's2c:paint_history_chunk',
  S2C_PLAYER_JOINED: 's2c:player_joined',
  S2C_PLAYER_LEFT: 's2c:player_left',
  S2C_PLAYER_DIED: 's2c:player_died',
  S2C_PLAYER_RESPAWNED: 's2c:player_respawned',
  S2C_MATCH_STATE: 's2c:match_state',
  S2C_GAME_OVER: 's2c:game_over',
  S2C_PONG: 's2c:pong',
  S2C_HIT_FEEDBACK: 's2c:hit_feedback',
  S2C_SHOT_EVENT: 's2c:shot_event',
  S2C_LOBBY_STATE: 's2c:lobby_state',
  S2C_SUB_WEAPON_EVENT: 's2c:sub_weapon_event',
  S2C_SPECIAL_EVENT: 's2c:special_event'
} as const;

export type ProtocolEventName = typeof PROTOCOL_EVENTS[keyof typeof PROTOCOL_EVENTS];

