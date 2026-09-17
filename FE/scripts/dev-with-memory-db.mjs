// Convenience for local dev when no persistent MongoDB is set up yet: spins
// up an in-memory MongoDB (data vanishes when this process exits), points
// MONGODB_URI at it via .env.local, and starts `next dev`.
//
// For anything beyond one dev session, point MONGODB_URI (in .env.local) at
// a real MongoDB instance (Atlas, Docker, or a local install) instead.
import { MongoMemoryServer } from 'mongodb-memory-server';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const mongod = await MongoMemoryServer.create({ instance: { dbName: 'mcapduel' } });
const uri = mongod.getUri('mcapduel');

fs.writeFileSync('.env.local', `MONGODB_URI=${uri}\n`);
console.log(`[dev:memory] in-memory MongoDB running at ${uri}`);
console.log('[dev:memory] .env.local written -- this is throwaway data, not for anything you need to keep.');

const child = spawn('npx', ['next', 'dev'], { stdio: 'inherit', shell: true });

let shuttingDown = false;
async function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  child.kill();
  await mongod.stop();
  process.exit(code ?? 0);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
child.on('exit', (code) => shutdown(code));
