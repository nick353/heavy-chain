// New projects are named after what the user started with, so the project lists are not a row of identical "Untitled".

// eslint-disable-next-line no-control-regex -- control characters are exactly what is being stripped
const clean = (value: string) => value.replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim();

/** "tshirt.png" → "tshirt"; falls back to "Untitled" when there is no usable name. */
export function projectNameFromFile(name?: string | null) {
  const base = clean((name ?? '').replace(/\.[^.]+$/u, ''));
  // IDs (a project code standing in before the real file name loads) are not names.
  if (!base || /^[0-9a-f-]{20,}$/iu.test(base)) return 'Untitled';
  return base.slice(0, 60);
}

/** The first 24 characters of the first request, like the agent task titles. */
export function projectNameFromPrompt(prompt?: string | null) {
  const text = clean(prompt ?? '');
  if (!text) return 'Untitled';
  return text.length > 24 ? `${text.slice(0, 24)}…` : text;
}
