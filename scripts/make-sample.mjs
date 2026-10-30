// Writes a synthetic Colota-format CSV for development: npm run sample [-- days]
import { mkdirSync, writeFileSync } from 'node:fs';
import { synthColota } from './synth.mjs';

const days = Number(process.argv[2] ?? 3);
const csv = synthColota({ days });
mkdirSync('samples/generated', { recursive: true });
const file = `samples/generated/synthetic-colota-${days}d.csv`;
writeFileSync(file, csv);
console.log(`${file}: ${csv.split('\n').length - 2} rows, ${(csv.length / 1e6).toFixed(1)} MB (made-up locations)`);
