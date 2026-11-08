// Describes the LOOK only. Never brand or studio names (plan: monetization guardrails).
export const STYLE_PROMPTS: Record<string, string> = {
  'disney-classic': 'classic hand-drawn feature-animation look, painted soft shading, expressive faces, warm storybook colours',
  'pixar-3d': 'soft 3D animated-film render, big expressive eyes, subsurface skin or fur detail, warm cinematic lighting',
  anime: 'Japanese anime style, clean line art, cel shading, large expressive eyes',
  'cartoon-2d': 'modern 2D cartoon, bold outlines, flat bright colours, simple shapes',
  realistic: 'photorealistic, natural fur or skin detail, cinematic soft lighting, shallow depth of field',
  storybook: 'watercolour picture-book illustration, soft textured paper feel, gentle colours',
  claymation: 'claymation stop-motion figure, visible clay texture and fingerprints, handmade felt props',
  comic: 'comic-book illustration, inked outlines, halftone shading, bold colours',
  documentary: 'photorealistic documentary photography, natural light, true colour',
  explainer: 'clean flat vector illustration, friendly rounded shapes, limited palette',
  kinetic: 'bold flat graphic mascot, simple vector shapes',
}
export const stylePrompt = (id: string) => STYLE_PROMPTS[id] ?? STYLE_PROMPTS['cartoon-2d']
