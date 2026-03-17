export function decodeUtf8Mojibake(input: string | null | undefined) {
    if (!input) return "";
    // détecte les patterns les plus fréquents
    const looksBroken = /Ã.|Â.|â€™|â€“|â€”|â€œ|â€/g.test(input);
    if (!looksBroken) return input;
  
    try {
      // “répare” une chaîne UTF-8 interprétée en latin1
      return Buffer.from(input, "latin1").toString("utf8");
    } catch {
      return input;
    }
  }
  