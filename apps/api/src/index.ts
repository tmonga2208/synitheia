import mongoose from 'mongoose';
import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { XpAwardModel } from './db/models.js';

async function main(): Promise<void> {
  // Throws and exits if anything is missing or malformed. This is the last moment a
  // human is watching, so it fails here rather than at 3am on the first request.
  const env = loadEnv();

  await mongoose.connect(env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
  });

  const app = await buildApp(env);

  /**
   * The one index this process builds and WAITS for, in every environment.
   *
   * Mongoose's default `autoIndex` already builds every index — but it does it in the
   * background, unawaited, and nothing listens for the `'index'` event it resolves on.
   * For most collections that is fine: their indexes are for speed, and a slow query
   * during the build window is the whole cost.
   *
   * `{ userId, key }` on XpAward is different. It is not an optimisation — it IS the
   * entire idempotence guarantee of the XP ledger; nothing in the award path checks
   * before inserting, because that races. If a duplicate lands while the unique build
   * is still in flight, the build fails with 11000 and the collection is left
   * PERMANENTLY unprotected, silently, for the rest of its life. And a double award
   * has no user-visible symptom — nobody notices they got 20 XP instead of 10 — so
   * nothing downstream would ever report it.
   *
   * Awaiting `init()` guarantees no traffic precedes the build and turns that silent,
   * permanent failure into a loud boot failure. On a new or empty collection it is
   * instant; on an existing one it is a no-op once the index is there.
   */
  await XpAwardModel.init();

  /**
   * Build indexes at boot in development only.
   *
   * In production this is a migration step, not a startup step — `syncIndexes` can
   * block for minutes on a large collection and would turn a routine deploy into an
   * outage. The unique indexes here are load-bearing (they are the dedupe and
   * idempotency guarantees), so they must exist before traffic arrives, but that is
   * the deploy pipeline's job.
   *
   * XpAward's is the exception, and it is handled above rather than here — see the
   * reason it is singled out. This gate is unchanged: `syncIndexes` also DROPS indexes
   * no longer declared, which is a genuine migration and not something to do on boot.
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
