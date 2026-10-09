/** Extra provider instruction per Fashion Studio function; the saved prompt stays the user's own text. */
const STUDIO_FUNCTION_DIRECTIVES: Record<string, string> = {
  '3d': 'Output style: re-render the garment as a clean 3D CGI product render (like a Blender or Octane render), not a photograph. Show it as a free-standing ghost-mannequin form with clear volume and depth, rendered fabric material, soft studio lighting with ambient occlusion and a subtle contact shadow on a plain neutral background. Keep the exact colors, prints, logos and construction of the garment.',
};

export const studioProviderPrompt = (prompt: string, studioFunction: string) => {
  const directive = STUDIO_FUNCTION_DIRECTIVES[studioFunction];
  return directive ? `${prompt}\n${directive}` : prompt;
};
