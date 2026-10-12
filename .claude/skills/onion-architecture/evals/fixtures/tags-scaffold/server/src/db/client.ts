import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export function createDb(url: string) {
  return drizzle(postgres(url));
}

export type Db = ReturnType<typeof createDb>;
