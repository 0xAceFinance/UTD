import mongoose from 'mongoose';
import { connectToDatabase } from '@/lib/mongoose';

/** Connects to the shared in-memory MongoDB (test/globalSetup.ts + test/setupEnv.ts). */
export async function ensureDbConnected() {
  await connectToDatabase();
}

/** Wipes every collection between tests so one test's data can't leak into another's. */
export async function clearDatabase() {
  await connectToDatabase();
  const collections = mongoose.connection.collections;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}
