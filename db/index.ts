import { drizzle } from "drizzle-orm/d1";
import { getD1 } from "../lib/d1";
import * as schema from "./schema";

export async function getDb() {
  return drizzle(await getD1(), { schema });
}
