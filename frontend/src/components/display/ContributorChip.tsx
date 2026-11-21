import { px } from "@/lib/designSpace";
import type { Author } from "@/types";

/**
 * Who added this — one fixed place on every channel screen.
 *
 * Owner-directed: the chip has a **fixed position now, and it is the same
 * position on every type**. It used to be placed per screen — flowing under
 * the description on the album, pinned at a y inside the column on the film —
 * so it landed somewhere slightly different on each, and on the film it
 * landed straight through the words.
 *
 * Anchored to the bottom-left of the content area rather than to the text
 * above it, so nothing an author writes can move it: a long description on a
 * display that never scrolls would otherwise push a person's face off the
 * panel. Her eye learns one place and finds it every time.
 *
 * Name and how she knows them. Never an email, never a phone number —
 * contact details reach an authenticated admin and nothing else.
 */
export function ContributorChip({ author }: { author: Author | null | undefined }) {
  if (!author) return null;

  return (
    <div
      className="absolute flex items-center"
      style={{ left: px(56), bottom: px(44), gap: px(16) }}
    >
      {author.profile_picture_url ? (
        <img
          src={author.profile_picture_url}
          alt={`Photo of ${author.name}`}
          className="flex-none rounded-full object-cover"
          style={{ width: px(60), height: px(60), border: "1px solid rgba(242,241,238,.3)" }}
        />
      ) : (
        <span
          aria-hidden
          className="flex flex-none items-center justify-center rounded-full bg-white/10"
          style={{ width: px(60), height: px(60), border: "1px solid rgba(242,241,238,.3)" }}
        >
          {author.name.charAt(0)}
        </span>
      )}

      {/*
        Name and relationship only. The mockups dropped the "Added by" label:
        who added it is already said in the eyebrow on the album, and a face
        beside a name does not need a caption explaining that it is a face.
      */}
      <span>
        <span
          className="block"
          style={{ font: `400 ${px(19)}/1.2 Roboto, sans-serif`, color: "#F2F1EE" }}
        >
          {author.name}
        </span>
        {author.relationship && (
          <span
            className="block"
            style={{
              font: `300 ${px(13)}/1.2 Roboto, sans-serif`,
              color: "rgba(242,241,238,.55)",
              marginTop: px(7),
            }}
          >
            {author.relationship}
          </span>
        )}
      </span>
    </div>
  );
}
