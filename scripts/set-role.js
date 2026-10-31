/**
 * Change a user's GLOBAL role (user | admin).
 * Usage: npm run set-role -- <email> <role>
 */
import { MongoClient } from 'mongodb';
import { GlobalRole } from '../src/config/constants.js';
import { env } from '../src/config/env.js';

const [email, role] = process.argv.slice(2);
const roles = Object.values(GlobalRole);

if (!email || !roles.includes(role)) {
  console.error(`Usage: npm run set-role -- <email> <${roles.join('|')}>`);
  process.exit(1);
}

const client = new MongoClient(env.MONGODB_URI);
try {
  const users = client.db(env.DB_NAME).collection('user');
  const result = await users.updateOne({ email: email.toLowerCase() }, { $set: { role } });
  if (!result.matchedCount) {
    console.error(`No user with email "${email}" in database "${env.DB_NAME}".`);
    process.exitCode = 1;
  } else {
    console.log(`Set role of ${email} to "${role}" in database "${env.DB_NAME}".`);
  }
} finally {
  await client.close();
}
