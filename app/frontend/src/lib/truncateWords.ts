/** First `max` whitespace-separated words of `text`, with an ellipsis when something was cut. */
export function truncateWords(text: string, max: number): string {
  const words = (text ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length <= max) return words.join(" ");
  return words.slice(0, max).join(" ") + "…";
}
