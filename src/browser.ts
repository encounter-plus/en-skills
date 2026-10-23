/** Portable en-skills implementation. Browser hosts own credentials, UI and execution. */
export * from './core.ts';
export * from './http.ts';
export * from './google-public.ts';
export * from './ocr.ts';
export * from './image-model.ts';
export * from './image-bytes.ts';
export * from './math-check.ts';
export * from './routing.ts';

export function buildChecklist(catalog: { rules: Array<{ scope: string[] }> }, format = 'mixed') {
  if (!['field', 'virtual', 'mixed'].includes(format)) throw new Error('Invalid format');
  return { schemaVersion: 1, format, rules: catalog.rules.map(rule => ({ ...rule,
    status: format === 'virtual' && rule.scope.every(scope => scope === 'field') ? 'not-applicable' : 'not-checked', evidence: null,
  })) };
}

export * from './code-generator.ts';
