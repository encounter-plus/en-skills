/** Versioned tenant registry. Engine selection never depends on a failed request. */
export interface EngineProfile {
  registryVersion: 1; domain: string; engine: 'modern' | 'legacy';
  client: 'kotlin' | 'react-native'; runtime: 'modern-enplus-kotlin' | 'legacy-enplus-react-native';
}
export function resolveEngineProfile(hostname: string): Readonly<EngineProfile> {
  if (typeof hostname !== 'string') throw new Error('Expected an Encounter tenant hostname');
  const domain = hostname.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.en\.cx$/.test(domain)) throw new Error('Unsupported Encounter tenant hostname');
  return Object.freeze(domain === 'demo.en.cx'
    ? {registryVersion: 1, domain, engine: 'modern', client: 'kotlin', runtime: 'modern-enplus-kotlin'}
    : {registryVersion: 1, domain, engine: 'legacy', client: 'react-native', runtime: 'legacy-enplus-react-native'});
}
