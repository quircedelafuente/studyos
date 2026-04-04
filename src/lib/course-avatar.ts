const ACCENTS = ["#e4e4e7", "#d4d4d8", "#f4f4f5", "#a1a1aa", "#e7e5e4"];

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return h;
}

export function courseAccentFromId(id: string): string {
  return ACCENTS[Math.abs(hashId(id)) % ACCENTS.length] ?? ACCENTS[0];
}

/** Índice estable en la lista de iconos de curso (sal para no coincidir siempre con el color). */
export function courseIconIndexFromId(id: string, iconCount: number): number {
  return Math.abs(hashId(`${id}\0glyph`)) % iconCount;
}
