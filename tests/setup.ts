import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.ts";

const connectionString = `${process.env.APP_DATABASE_URL}`;

const adapter = new PrismaPg({ connectionString });
const testDB = new PrismaClient({ adapter });

export default testDB;
