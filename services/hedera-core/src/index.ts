/**
 * @agent-market/hedera-core
 *
 * The ONLY package allowed to touch Hedera. Exposes:
 *   - HederaClient  : the interface Abdellah's real wrapper implements.
 *   - InMemoryHederaClient : a working stub for local end-to-end runs.
 *   - InMemoryHcsLog : local HCS topic + mirror-node stand-in.
 */
export * from './client.js';
export * from './in-memory-client.js';
export * from './hcs-log.js';
