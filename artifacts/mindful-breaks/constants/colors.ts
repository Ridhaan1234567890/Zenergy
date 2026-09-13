/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const darkPalette = {
  text: '#F4F0FF',
  tint: '#D99AE9',
  background: '#071426',
  foreground: '#F4F0FF',
  card: '#10243A',
  cardForeground: '#F4F0FF',
  primary: '#D99AE9',
  primaryForeground: '#20152D',
  secondary: '#172C47',
  secondaryForeground: '#DCCFF5',
  muted: '#122640',
  mutedForeground: '#A9B1C7',
  accent: '#655AA6',
  accentForeground: '#F8F4FF',
  destructive: '#D96F86',
  destructiveForeground: '#FFF7FA',
  border: '#2C405D',
  input: '#3A5271',
  navy: '#061B35',
  sage: '#B9C4E6',
  cream: '#F8F3FF',
  yellow: '#F2CD8A',
};

const colors = {
  // Zenergy uses the same intentionally dark palette regardless of device appearance.
  light: darkPalette,
  dark: darkPalette,
  radius: 18,
};

export default colors;
