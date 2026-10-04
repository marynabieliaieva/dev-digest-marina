import { z } from 'zod';

/** devdigest_list_agents takes no arguments. */
export const listAgentsInput = z.object({});
export type ListAgentsInput = z.infer<typeof listAgentsInput>;
