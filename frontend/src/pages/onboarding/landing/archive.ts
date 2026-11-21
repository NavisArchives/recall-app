/**
 * One family's archive, used by every section of the front page.
 *
 * THE PAGE USED TO SHOW THREE DIFFERENT CHANNEL 06s — "Our trip to Barcelona"
 * in the hero, "Holidays in Sicily" where Recall organises, "The wedding day"
 * in the family's workspace — and a postcard from 02. A reader who notices is
 * a reader who stops believing the screenshots, which is why the copy review
 * called it the page's biggest credibility problem.
 *
 * So the numbers live here, once. Every section reads from this and the design
 * cannot drift again: if 06 is Barcelona in the hero it is Barcelona in the
 * workspace, because they are the same object.
 *
 * These are a drawing of a product, not data. Nothing on the public site has
 * an archive to read from — a stranger has no family yet — so the front page
 * shows a plausible one and says nothing that is not true of the real thing.
 */

export interface DemoChannel {
  /** The two-digit number the card carries and the remote types. */
  n: string;
  /** What the family called it, in each language. */
  title: { fr: string; nl: string; en: string };
  /** The photograph standing in for its cover. */
  cover: string;
}

export const SICILY: DemoChannel = {
  n: "02",
  title: { fr: "Vacances en Sicile", nl: "Vakantie op Sicilië", en: "Holidays in Sicily" },
  cover: "/site/sicily.jpg",
};

export const GREECE: DemoChannel = {
  n: "03",
  title: { fr: "Voyage en Grèce", nl: "Reis naar Griekenland", en: "Family trip to Greece" },
  cover: "/site/sea-view.jpg",
};

/*
  EVERY COVER IS A DRAWING. The public site never shows a photograph of a
  real family: the pictures in public/site are drawn rooms and places, with
  nobody in them. This one is shown at 430px in the hero, and the hero's
  blurred ground is the same picture, the way a channel's photograph is the
  ground behind it on her screen.
*/
export const BARCELONA: DemoChannel = {
  n: "06",
  title: { fr: "Notre voyage à Barcelone", nl: "Onze reis naar Barcelona", en: "Our trip to Barcelona" },
  cover: "/site/sea-room.jpg",
};

/** The three the workspace lists, in the order the shelf shows them. */
export const SHELF = [SICILY, GREECE, BARCELONA];
