/**
 * @agent-market/protocol — the shared message schema + HCS audit format.
 *
 * EVERY component (both agents, the MCP server, the dashboard, the reputation
 * engine) imports from here. Never redefine these types locally (PROTOCOL.md
 * § Rules everyone follows).
 *
 * Ownership: Youssef (per ROLES.md). First drafted by Zayd from PROTOCOL.md;
 * reviewed and signed off by Youssef — this is now the locked v1 schema.
 * Any field change is a breaking change: announce to the team before merging.
 */
export * from './messages.js';
export * from './canonical.js';
export * from './hcs.js';
export * from './handshake.js';
export * from './refs.js';
