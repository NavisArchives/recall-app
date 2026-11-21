/**
 * What her screen says when she walks up to it.
 *
 * Four bands, and the night one is the reason this is a function rather than
 * a ternary someone can "simplify". It was once `hour >= 18 ? evening :
 * morning`, which greeted her with "Good morning" at three in the morning —
 * confidently wrong at the exact hour a person with Alzheimer's is least
 * served by a confident machine.
 *
 * Night says her name and stops. Not "Good night": that instructs her to bed,
 * and it is not this screen's place to tell her what to do with her own night.
 *
 * Returned in two halves because 24ab puts the accent on her NAME — the lead
 * in cream, the name in lifted amber. The product greets her, not itself.
 */
export function greetingFor(
  hour: number,
  name: string | null | undefined
): { lead: string; name: string } {
  const trimmed = name?.trim() ?? "";

  const timeOfDay =
    hour >= 5 && hour < 12
      ? "Good morning"
      : hour >= 12 && hour < 18
        ? "Good afternoon"
        : hour >= 18 && hour < 22
          ? "Good evening"
          : null;

  // Her name is the only part that may be absent — while it loads, or if it
  // cannot be read. The greeting drops it rather than risk another family's.
  if (!timeOfDay) return { lead: "", name: trimmed };
  if (!trimmed) return { lead: timeOfDay, name: "" };
  return { lead: `${timeOfDay}, `, name: trimmed };
}
