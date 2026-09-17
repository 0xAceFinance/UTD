import { MongoMemoryServer } from 'mongodb-memory-server';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Vitest's globalSetup runs once, in its own process, before any test file's
// module graph is evaluated -- it can't just set process.env and expect test
// workers to inherit it, so the real in-memory Mongo URI is handed off
// through a file on disk instead. test/setupEnv.ts (a `setupFiles` entry,
// which DOES run inside each test file's own worker, before that file's own
// imports) reads it back and sets MONGODB_URI before lib/mongoose.ts (which
// reads process.env.MONGODB_URI at module load time) is ever imported.
const uriFile = path.join(dirname, '.mongo-uri');

export default async function setup() {
  const mongod = await MongoMemoryServer.create({ instance: { dbName: 'utd-test' } });
  const uri = mongod.getUri('utd-test');
  fs.writeFileSync(uriFile, uri, 'utf-8');

  return async () => {
    await mongod.stop();
    fs.rmSync(uriFile, { force: true });
  };
}
