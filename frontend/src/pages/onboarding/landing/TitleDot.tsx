/**
 * A heading with the red full stop tied to its last word.
 *
 * THE DOT USED TO BE ABLE TO WRAP ALONE. `.s-dot` is an inline-block, so a
 * heading that filled its line to the edge could push the dot onto a line of
 * its own — a single red pip sitting under the words, which is what the owner
 * photographed on the live site. Whether it happens depends on the language,
 * the font and the exact width, so no fixed `max-width` closes it: French and
 * Dutch break in different places from English, and the page is read in all
 * three.
 *
 * Binding the dot to the final word in a `nowrap` span closes it everywhere.
 * The last word and the dot now wrap together or not at all, which is what a
 * full stop does in every other piece of typography.
 */
export function TitleDot({ text, size }: { text: string; size?: string }) {
  const cut = text.lastIndexOf(" ");
  const head = cut === -1 ? "" : text.slice(0, cut + 1);
  const tail = cut === -1 ? text : text.slice(cut + 1);

  return (
    <>
      {head}
      <span style={{ whiteSpace: "nowrap" }}>
        {tail}
        <span
          className="s-dot"
          style={size ? { width: size, height: size, marginLeft: "0.1em" } : undefined}
        />
      </span>
    </>
  );
}
