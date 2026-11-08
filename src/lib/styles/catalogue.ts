export const STYLE_CATALOGUE = [
  { id: 'disney-classic', name: 'Disney-style classic cartoon', look: 'Hand-drawn feature-animation look, expressive faces', engineFit: 4 },
  { id: 'pixar-3d', name: '3D Pixar-like', look: 'Soft 3D render, big eyes, warm light', engineFit: 4 },
  { id: 'anime', name: 'Anime', look: 'Speed lines, dramatic lighting', engineFit: 5 },
  { id: 'cartoon-2d', name: 'Modern 2D cartoon', look: 'Bold outlines, flat colours', engineFit: 4 },
  { id: 'realistic', name: 'Realistic / cinematic', look: 'Photoreal, film-like', engineFit: 3 },
  { id: 'storybook', name: 'Storybook / watercolour', look: 'Illustrated picture book', engineFit: 5 },
  { id: 'claymation', name: 'Claymation', look: 'Clay or felt figures, stop-motion feel', engineFit: 5 },
  { id: 'comic', name: 'Comic / motion comic', look: 'Panels and halftone', engineFit: 5 },
  { id: 'documentary', name: 'Documentary', look: 'Photoreal stills with 2.5D camera', engineFit: 4 },
  { id: 'explainer', name: 'Animated explainer', look: 'Icons, charts and characters', engineFit: 5 },
  { id: 'kinetic', name: 'Kinetic typography', look: 'Animated text-led visuals', engineFit: 5 },
] as const

export const STYLE_IDS = STYLE_CATALOGUE.map((s) => s.id) as [string, ...string[]]
