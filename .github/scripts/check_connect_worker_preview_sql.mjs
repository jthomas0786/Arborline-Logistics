import fs from 'node:fs';

const source = fs.readFileSync('lib/connect-workers.ts', 'utf8');

for (const fn of ['previewEnrichment', 'previewQualification']) {
  const start = source.indexOf(`async function ${fn}`);
  if (start < 0) throw new Error(`${fn}: function not found`);
  const end = source.indexOf('\n}\n', start);
  if (end < 0) throw new Error(`${fn}: function boundary not found`);
  const block = source.slice(start, end + 3);

  if (!block.includes('$2::uuid')) throw new Error(`${fn}: segment parameter must be typed as $2::uuid`);
  if (block.includes('$3::uuid')) throw new Error(`${fn}: legacy $3 parameter hole returned`);
  if (!block.includes('[clientId, segmentId]')) throw new Error(`${fn}: query parameters must be [clientId, segmentId]`);
  if (block.includes('[clientId, limit, segmentId]')) throw new Error(`${fn}: unused limit parameter must not be sent to PostgreSQL`);
}

console.log('Connect worker preview SQL regression passed.');
