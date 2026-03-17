/**
 * Convertit du HTML en texte lisible (supprime style, script, balises, &nbsp;, espaces multiples).
 * Limite à ~1200 caractères.
 */
export function stripHtmlToText(html: string, maxLen = 1200): string {
  if (!html || typeof html !== "string") return "";

  let s = html;

  // Supprimer style, script, head, commentaires (Outlook injecte beaucoup de CSS)
  s = s.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  s = s.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/\/\*[\s\S]*?\*\//g, ""); // commentaires CSS

  // Convertir blocs en sauts de ligne
  s = s.replace(/<\s*br\s*\/?\s*>/gi, "\n");
  s = s.replace(/<\s*p\s*[^>]*>/gi, "\n");
  s = s.replace(/<\s*div\s*[^>]*>/gi, "\n");
  s = s.replace(/<\s*\/\s*(?:p|div)\s*>/gi, "\n");
  s = s.replace(/<\s*hr\s*[^>]*\/?\s*>/gi, "\n");
  s = s.replace(/<\s*li\s*[^>]*>/gi, "\n• ");
  s = s.replace(/<\s*tr\s*[^>]*>/gi, "\n");

  // Stripper toutes les balises restantes
  s = s.replace(/<[^>]+>/g, "");

  // Entités et espaces
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));

  // Normaliser espaces et sauts
  s = s
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n /g, "\n")
    .replace(/ \n/g, "\n")
    .trim();

  if (s.length <= maxLen) return s;
  const cut = s.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  const lastNewline = cut.lastIndexOf("\n");
  const breakAt = Math.max(lastSpace, lastNewline, maxLen - 80);
  return (breakAt > maxLen / 2 ? cut.slice(0, breakAt) : cut).trim() + "…";
}
