import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const uriFile = path.join(dirname, '.mongo-uri');

// Runs before this test file's own imports (lib/mongoose.ts reads
// MONGODB_URI at module load time and throws if it's missing), so this has
// to happen in a setupFiles entry, not inside a beforeAll in the test file
// itself -- by the time a test file's beforeAll runs, its top-level imports
// (including anything that transitively imports lib/mongoose.ts) have
// already executed.
process.env.MONGODB_URI = fs.readFileSync(uriFile, 'utf-8').trim();

// Same 0x59c69... key already used in backend/.env.local for local dev
// against Anvil -- one of Anvil's well-known, publicly documented test
// private keys, never a real secret. Only set here as a fallback so tests
// don't depend on .env.local being present/loaded (vitest doesn't load
// Next's .env files automatically).
process.env.ORACLE_SIGNER_PRIVATE_KEY =
  process.env.ORACLE_SIGNER_PRIVATE_KEY ?? '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

process.env.NEXT_PUBLIC_RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? 'http://127.0.0.1:8545';
process.env.NEXT_PUBLIC_CHAIN_ID = process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337';

// Matches test/helpers/chainFixtures.ts's ADDR.factory -- lib/chainVerify.ts
// filters decoded events by this address (CONTRACTS.battleEscrowFactory), so
// it needs a real, consistent value here rather than config/contracts.ts's
// '' fallback for an unset env var.
process.env.NEXT_PUBLIC_BATTLE_ESCROW_FACTORY_ADDRESS =
  process.env.NEXT_PUBLIC_BATTLE_ESCROW_FACTORY_ADDRESS ?? '0x4000000000000000000000000000000000000001';

// Test-only value for the internal admin routes' shared-secret gate (lib/adminAuth.ts).
process.env.ADMIN_API_SECRET = process.env.ADMIN_API_SECRET ?? 'test-admin-secret';
