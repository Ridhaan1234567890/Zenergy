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

const colors = {
  light: {
    text: '#17212B',
    tint: '#EF816D',
    background: '#F5F1E9',
    foreground: '#17212B',
    card: '#FFFCF6',
    cardForeground: '#17212B',
    primary: '#EF816D',
    primaryForeground: '#FFFDF9',
    secondary: '#E5EDE8',
    secondaryForeground: '#27544C',
    muted: '#EAE6DC',
    mutedForeground: '#69756F',
    accent: '#F6D6B8',
    accentForeground: '#734B3D',
    destructive: '#BE5A5A',
    destructiveForeground: '#FFFDF9',
    border: '#D9D7CF',
    input: '#D0D5CF',
    navy: '#17212B',
    sage: '#B6CFC4',
    cream: '#FFF9EF',
    yellow: '#F2C46D',
  },
  radius: 18,
};

export default colors;
