import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";

const connectionString = `${process.env.DATABASE_URL}`;

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", "host.docker.internal"];

/**
 * Safety catch. Every suite importing this module wipes tables in `beforeEach`,
 * and `dotenv` never overrides a variable that is already exported — so a
 * DATABASE_URL left in the shell (e.g. the EC2/RDS one from a debugging
 * session) silently outranks `.env.test` and points those deletes at prod.
 * That happened once. Refuse to run unless the target is obviously local.
 */
function assertLocalDatabase(url: string): void {
  let host: string;

  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(
      "Refusing to run destructive integration tests: DATABASE_URL is missing or not a valid connection string.",
    );
  }

  if (!LOCAL_HOSTS.includes(host)) {
    throw new Error(
      `Refusing to run destructive integration tests: DATABASE_URL points at "${host}", not a local database.\n` +
        `These suites delete every row they touch. Run with the shell variable unset:\n` +
        `  env -u DATABASE_URL -u NODE_ENV npm run test:integration`,
    );
  }
}

assertLocalDatabase(connectionString);

const adapter = new PrismaPg({ connectionString });
const testDB = new PrismaClient({ adapter });

/**
 * Empties every table the suites seed, in an order that follows the foreign-key
 * graph: anything holding a RESTRICT reference to a row below it has to go
 * first, or the cleanup itself fails on a database that already has data
 * (Invoice -> Booking was exactly that failure).
 *
 * Kept in one place because per-suite copies of this list drifted out of date
 * the moment a new table was added.
 */
export async function resetTestDatabase(): Promise<void> {
  await testDB.invoice.deleteMany({});
  await testDB.reviews.deleteMany({});
  await testDB.idempotencyKey.deleteMany({});
  await testDB.refund.deleteMany({});
  await testDB.payment.deleteMany({});
  await testDB.booking.deleteMany({});
  await testDB.bed.deleteMany({});
  await testDB.room.deleteMany({});
  await testDB.roomTemplate.deleteMany({});
  await testDB.property.deleteMany({});
  await testDB.tenant.deleteMany({});
  await testDB.user.deleteMany({});
}

export default testDB;
