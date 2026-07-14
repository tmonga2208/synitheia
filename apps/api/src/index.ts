import mongoose from 'mongoose';
import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';

async function main(): Promise<void> {
  // Throws and exits if anything is missing or malformed. This is the last moment a
  // human is watching, so it fails here rather than at 3am on the first request.
  const env = loadEnv();

  await mongoose.connect(env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
  });

  const app = await buildApp(env);

  /**
   * Build indexes at boot in development only.
   *
   * In production this is a migration step, not a startup step — `syncIndexes` can
   * block for minutes on a large collection and would turn a routine deploy into an
   * outage. The unique indexes here are load-bearing (they are the dedupe and
   * idempotency guarantees), so they must exist before traffic arrives, but that is
   * the deploy pipeline's job.
   */
  if (env.NODE_ENV === 'development') {
    await mongoose.syncIndexes();
    app.log.info('indexes synced');
  }

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await mongoose.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: env.PORT, host: env.HOST });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
