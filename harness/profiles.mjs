/** Snapshot identity is checked before importing or executing its renderer. */
export const runtimeProfiles = Object.freeze({
  'modern-enplus-kotlin': { framework: 'kotlin', engine: 'modern', directory: 'snapshot' },
  'legacy-enplus-react-native': { framework: 'react-native', engine: 'legacy', directory: 'snapshot-react-native' },
});
export function validateSnapshotManifest(manifest, profile) {
  const expected = runtimeProfiles[profile];
  if (!expected) throw new Error('Unsupported runtime profile: ' + profile);
  if (manifest?.distribution !== 'obfuscated' || manifest?.schemaVersion !== 1 || manifest.framework !== expected.framework || manifest.engine !== expected.engine || manifest.runtimeProfile !== profile || !/^[a-f0-9]{40}$/.test(manifest.source?.revision ?? '') || !manifest.hashes || !Array.isArray(manifest.outputs) || !['renderer.mjs','enplus-injected.js','enplus.css'].every(name=>manifest.outputs.includes(name)) || !manifest.outputs.every(name => /^[a-zA-Z0-9.-]+$/.test(name) && /^[a-f0-9]{64}$/.test(manifest.hashes[name] ?? ''))) {
    throw new Error('Snapshot provenance/profile mismatch; export a current ' + profile + ' snapshot');
  }
  return manifest;
}
