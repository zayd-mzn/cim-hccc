/**
 * @agent-market/protocol — the shared message schema + HCS audit format.
 *
 * EVERY component (both agents, the MCP server, the dashboard, the reputation
 * engine) imports from here. Never redefine these types locally (PROTOCOL.md
 * § Rules everyone follows).
 *
 * Ownership: Youssef (per ROLES.md). This is a provisional implementation
 * authored by Zayd from PROTOCOL.md so the agent + MCP workstream is unblocked.
 */
export * from './messages.js';
export * from './canonical.js';
export * from './hcs.js';
export * from './handshake.js';
