import type { ViewProps } from "react-native";

const STYLE_ELEMENT_ID = "beautiful-chat-turn-fold";

/**
 * Marks a row whose turn is folded.
 *
 * A folded renderer can draw nothing, but the host still wraps it in its own
 * row with a bottom margin (`gapBelow`), so a folded turn of forty steps left
 * forty margins stacked into a page of blank space. The plugin cannot reach
 * that wrapper, so the marker lets a stylesheet remove the host's whole row.
 */
export const foldedRowMarker = {
  dataSet: { bcFold: "hidden" },
} as unknown as ViewProps;

/**
 * Hides every host row holding a folded marker. The row's inline `display`
 * needs `!important` to override. Hiding it also gives the list's virtualizer
 * a zero height to measure, so it stops reserving the row's old height.
 *
 * Off web there is no stylesheet, so the host's row margins stay.
 */
export function installFoldStyle(): () => void {
  if (typeof document === "undefined") return () => {};
  if (document.getElementById(STYLE_ELEMENT_ID)) return () => {};

  const style = document.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  style.textContent = `[data-history-row-id]:has([data-bc-fold="hidden"]) { display: none !important; }`;
  document.head.appendChild(style);

  return () => {
    style.remove();
  };
}
