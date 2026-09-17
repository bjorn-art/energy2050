/**
 * Event and intervention message bodies come from the original template
 * import as raw HTML (pasted out of a rich-text editor when the game data
 * was first authored). Two things follow from that:
 *
 * 1. It needs to be rendered as HTML, not printed as text — otherwise the
 *    tags themselves show up on screen (e.g. "<p><span ...>...").
 * 2. That HTML carries inline styles (color, background-color) authored
 *    assuming a light page background. The facilitator console is dark-
 *    themed, so a raw `color: rgb(0, 0, 0)` would render as black text on
 *    a near-black background — invisible. Stripping inline `style`
 *    attributes lets this page's own (dark-theme-aware) CSS control color
 *    and background instead, while keeping the actual tags (p, span, br,
 *    strong, etc.) for paragraph breaks and basic formatting.
 *
 * This content is trusted (imported template/game data, not something a
 * player or facilitator types into a form), so rendering it as HTML here
 * is safe — the usual "never dangerouslySetInnerHTML on user input"
 * caution doesn't apply the same way it would to player-submitted text.
 */
export function stripInlineStyles(html: string): string {
  return html.replace(/\s*style="[^"]*"/gi, "");
}

/**
 * Interventions and asset_interventions store `photo_path` as
 * `photos/<id>.<ext>` — where the import script wrote the image on disk,
 * relative to content/seed/. Those same files are copied into
 * public/event-photos/ (see the Phase 5 delivery notes) so Next.js serves
 * them directly; this turns the stored path into the public URL. Returns
 * null for a missing/malformed path rather than throwing, since a broken
 * image shouldn't take down the page it's on.
 */
export function eventPhotoUrl(photoPath: string | null): string | null {
  if (!photoPath) return null;
  const fileName = photoPath.startsWith("photos/") ? photoPath.slice("photos/".length) : photoPath;
  if (!fileName) return null;
  return `/event-photos/${fileName}`;
}
