import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { clearSessionCache } from "../sessionCache";

describe("session cache isolation", () => {
  it("removes protected payloads before another identity can observe them", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: 30_000 } },
    });
    client.setQueryData(["person", "same-route-id"], {
      name: "Previous administrator",
      email: "private@example.invalid",
    });

    await clearSessionCache(client);

    expect(client.getQueryData(["person", "same-route-id"])).toBeUndefined();
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });
});
