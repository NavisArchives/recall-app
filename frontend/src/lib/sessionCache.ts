import type { QueryClient } from "@tanstack/react-query";

/** Remove requests and payloads that were created under the previous identity. */
export async function clearSessionCache(queryClient: QueryClient): Promise<void> {
  await queryClient.cancelQueries();
  queryClient.clear();
}
