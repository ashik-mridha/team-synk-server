/**
 * One-time, non-destructive copy of collections from another database into the app database.
 * Existing documents (same _id) in the target are left untouched; nothing is ever deleted.
 *
 * Usage: npm run migrate-db -- [sourceDb=test] [--dry-run]
 */
import { MongoClient } from 'mongodb';
import { env } from '../src/config/env.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const sourceName = args.find((a) => !a.startsWith('--')) ?? 'test';
const targetName = env.DB_NAME;

if (sourceName === targetName) {
  console.error(`Source and target are both "${targetName}". Nothing to do.`);
  process.exit(1);
}

const client = new MongoClient(env.MONGODB_URI);
try {
  const source = client.db(sourceName);
  const target = client.db(targetName);
  const collections = (await source.listCollections({}, { nameOnly: true }).toArray())
    .map((c) => c.name)
    .filter((name) => !name.startsWith('system.'));

  if (!collections.length) {
    console.log(`Database "${sourceName}" has no collections. Nothing to copy.`);
  }
  console.log(`${dryRun ? '[dry run] ' : ''}Copying "${sourceName}" -> "${targetName}"`);

  for (const name of collections) {
    const docs = await source.collection(name).find({}).toArray();
    let copied = 0;
    if (!dryRun && docs.length) {
      try {
        const res = await target.collection(name).insertMany(docs, { ordered: false });
        copied = res.insertedCount;
      } catch (err) {
        // Duplicate _ids already in the target are skipped; everything else is inserted.
        if (err?.result?.insertedCount === undefined && err?.insertedCount === undefined) throw err;
        copied = err.result?.insertedCount ?? err.insertedCount ?? 0;
      }
    }
    const skipped = dryRun ? 0 : docs.length - copied;
    console.log(
      `  ${name}: ${docs.length} found, ${dryRun ? 'would copy ' + docs.length : copied + ' copied'}${skipped ? `, ${skipped} already present` : ''}`,
    );
  }
  console.log('Done. The source database was not modified.');
} finally {
  await client.close();
}
