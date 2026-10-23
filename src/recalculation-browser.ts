/** Browser entry: no filesystem, process, keyring, or Node imports. */
export { EncounterClient } from './encounter.ts';
export { EncounterTransport, EncounterTransportError, ENCOUNTER_API_ORIGIN } from './encounter-transport.ts';
export { RemoteError } from './http.ts';
export * from './engine-profile.ts';
export * from './authoring-api.ts';
export * from './recalculation-evidence.ts';
export * from './recalculation.ts';
export * from './recalculation-report.ts';
export * from './correction-plan.ts';
export * from './correction-executor.ts';

export * from './level-operation.ts';
export * from './game-settings.ts';



export * from './modern-game-files.ts';
