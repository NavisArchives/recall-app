import { Overview } from "@/pages/Overview";

/**
 * A number that leads nowhere — 24g.
 *
 * The owner's merge call, drawn in the frame: there is no separate screen.
 * This IS the every-channel shelf (24c) with one extra headline naming the
 * number she typed, and a countdown home that any arrow press cancels. All
 * of that lives in `Overview` so the two cannot drift; this file only keeps
 * the name the router already knows.
 *
 * Landing here must not feel like a failure: no error language, and *yet* —
 * "there is nothing on channel 85 yet" — says the number could one day be
 * filled, which is true.
 */
export function ChannelNotFound({ number }: { number?: string }) {
  return <Overview missingNumber={number ?? ""} />;
}
