import { afterEach, describe, expect, it } from "vitest";
import { QueryClient, focusManager } from "@tanstack/react-query";

/**
 * M195 — why a failing query can sit at `pending` forever, and which fix
 * actually reaches it.
 *
 * Three people measured this screen and got three different answers, because
 * every instrument we own opens tabs that report `visibilityState: "hidden"`.
 * So this file stops measuring the symptom and pins the mechanism instead:
 * it constructs the pause deliberately, in node, with no browser in the way.
 *
 * The mechanism, read out of `@tanstack/query-core/src/retryer.ts`:
 *
 *     const canContinue = () =>
 *       focusManager.isFocused() &&
 *       (config.networkMode === 'always' || onlineManager.isOnline()) &&
 *       config.canRun()
 *
 * A first attempt is **not** focus-gated (`canStart` checks only the network),
 * so one request goes out and fails. The *retry* is gated, and an unfocused
 * document never satisfies it — the query parks at
 * `status: "pending", fetchStatus: "paused"` and the `isError` branch is
 * never reached.
 *
 * Two consequences follow, and both were guessed wrong before they were run.
 */
describe("a retry that cannot continue", () => {
  afterEach(() => {
    // The focus manager is a module singleton. Left forced, it would leak
    // into every other test in the run.
    focusManager.setFocused(undefined);
  });

  /** A query client whose retries are fast enough to watch. */
  function clientWith(networkMode: "online" | "always") {
    return new QueryClient({
      defaultOptions: { queries: { retry: 1, retryDelay: 1, networkMode } },
    });
  }

  const failing = () => Promise.reject(new Error("Not found"));
  const settle = () => new Promise((r) => setTimeout(r, 60));

  /**
   * The correction that matters most, because a fix was already proposed on
   * the opposite belief: **`networkMode: 'always'` does not reach this.**
   *
   * It removes the `onlineManager.isOnline()` term and nothing else. The
   * `focusManager.isFocused()` term is unconditional — no option turns it
   * off — so a hidden tab pauses exactly as hard under `always` as under
   * `online`. Setting it here would have looked like a fix only because the
   * trigger is so hard to reproduce that nobody would have caught it not
   * working.
   */
  it("stays paused under networkMode: 'always', which only removes the online term", async () => {
    const client = clientWith("always");
    client.mount();
    focusManager.setFocused(false);

    void client.prefetchQuery({ queryKey: ["hidden"], queryFn: failing });
    await settle();

    const state = client.getQueryState(["hidden"]);
    expect(state?.fetchStatus).toBe("paused");
    expect(state?.status).toBe("pending");
    // One attempt did go out and did fail — the request layer is fine.
    expect(state?.fetchFailureCount).toBe(1);

    client.unmount();
  });

  /**
   * The severity question: is a carer who switches apps and comes back
   * stranded, or does the screen heal itself?
   *
   * It heals. `queryClient.mount()` subscribes to the focus manager, and
   * `query.onFocus()` calls `retryer.continue()` on every cached query — the
   * paused retry resumes, exhausts, and the error finally lands. So the
   * window in which `isError` is unreachable closes the moment somebody
   * looks at the tab.
   *
   * This is why it is a hidden-tab bug and not the app-wide one it was
   * briefly feared to be — and why the honest fix is the words on screen,
   * not a change to how the whole app retries.
   */
  it("resumes and reaches its error state when the tab is looked at again", async () => {
    const client = clientWith("online");
    client.mount();
    focusManager.setFocused(false);

    void client.prefetchQuery({ queryKey: ["returns"], queryFn: failing });
    await settle();
    expect(client.getQueryState(["returns"])?.status).toBe("pending");

    focusManager.setFocused(true);
    await settle();

    const state = client.getQueryState(["returns"]);
    expect(state?.status).toBe("error");
    expect(state?.fetchStatus).toBe("idle");

    client.unmount();
  });

  /**
   * The reconciliation: my reading and Feedback's disagreed, and both were
   * right about what they measured.
   *
   * I called `focusManager.setFocused(true)` and the screen resolved.
   * Feedback dispatched browser events at a hidden tab and nothing resumed.
   * The difference is the route, not the behaviour, and it decomposes into
   * three links that can be checked separately:
   *
   *  1. Does a real `visibilitychange` reach the focus manager?
   *     **Yes** — measured in the running app: `focusManager.hasListeners()`
   *     is true with one subscriber (that is `queryClient.mount()`), and a
   *     `new Event('visibilitychange', {bubbles: true})` on `document`
   *     notified it. A **non-bubbling** one did **not** — the manager
   *     listens on `window`, so a synthetic event dispatched on `document`
   *     without `bubbles: true` never arrives. That alone accounts for
   *     Feedback's result.
   *
   *  2. Does the notification resume a paused retry? **This test.**
   *
   *  3. Does a real foreground make `visibilityState` "visible"? A browser
   *     guarantee, not a Recall behaviour — and **not observable from any
   *     pane we own**, since every one of them reports itself hidden. Said
   *     as an expectation, not a measurement.
   *
   * Feedback's other observation — that a genuine offline→online through
   * `onlineManager` did not resume it either — is correct and expected:
   * `canContinue` ANDs the focus term unconditionally, so the online route
   * cannot lift a focus pause. That reading was never in conflict.
   *
   * This test drives link 2 through the library's **own event seam**
   * (`setEventListener`, the hook React Native uses) rather than calling
   * `setFocused` directly, so what it exercises is the handler a browser
   * event lands in, not the API a test calls.
   */
  it("resumes when the platform's own focus handler fires, not just when a test calls it", async () => {
    const client = clientWith("online");
    client.mount();

    // Stand where the browser stands: capture the callback the focus
    // manager hands its platform setup, and fire that.
    let platformSaysFocused: ((focused?: boolean) => void) | undefined;
    focusManager.setEventListener((onFocus) => {
      platformSaysFocused = onFocus;
      return () => {};
    });
    expect(platformSaysFocused).toBeTypeOf("function");

    focusManager.setFocused(false);
    void client.prefetchQuery({ queryKey: ["seam"], queryFn: failing });
    await settle();
    expect(client.getQueryState(["seam"])?.fetchStatus).toBe("paused");

    platformSaysFocused!(true);
    await settle();

    expect(client.getQueryState(["seam"])?.status).toBe("error");
    client.unmount();
  });

  /**
   * The control. Without it the two tests above prove only that this query
   * never succeeds — they would pass identically if the pause were imaginary
   * and the request simply hung. A focused tab must reach `error` promptly,
   * or the difference the other tests measure is not the one they name.
   */
  it("reaches its error state promptly when the tab was visible all along", async () => {
    const client = clientWith("online");
    client.mount();
    focusManager.setFocused(true);

    void client.prefetchQuery({ queryKey: ["visible"], queryFn: failing });
    await settle();

    expect(client.getQueryState(["visible"])?.status).toBe("error");

    client.unmount();
  });
});
