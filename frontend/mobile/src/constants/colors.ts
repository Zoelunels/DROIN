import { createContext, useContext, useMemo } from 'react'
import { StyleSheet } from 'react-native'

/**
 * DROIN palettes, sampled from the brand artwork (assets/brand): the mascot's ink outline and the
 * wordmark (#2E1F17), its orange side (#F3943A) and shade (#C47028), and its cream face (#F8E8CC).
 *
 * Two palettes with the same names: light (warm paper) and dark (warm brown night). Screens never
 * import a palette; they read the active one with useColors() / makeStyles(), so the whole app
 * switches instantly. `charcoal` is the main text colour (ink in light, warm white in dark) and
 * `surface` the card colour. A few colours are the same in both: the mascot's ink and orange, and
 * the dark balance card, so the brand pieces look identical in either mode.
 *
 * Contrast: every text colour is at least 4.5:1 (WCAG AA) on the page, cards and tiles of its palette.
 */
const brand = {
  orange: '#F3943A',
  iconOrange: '#E8A04A', // the app icon background
  face: '#F8E8CC', // the mascot's face panel: text on the ink card
  ink: '#2E1F17', // the mascot's outline: borders on orange, text on orange, the + button
  onOrange: '#2E1F17',
  onColor: '#FFFFFF', // text and icons on coloured fills (red buttons, green chips, toasts)
} as const

export const lightColors = {
  ...brand,
  orangeDeep: '#9A5216', // orange text and icons on light backgrounds (5.5:1 on the page)
  orangeLedge: '#C47028', // the mascot's shaded side: the ledge under orange buttons
  orangeSoft: '#FCE3C8',
  orangeBorder: '#EFCFA6',
  softPeach: '#FAD7B7',
  cream: '#F4E8D4', // tiles, segmented controls, quiet fills
  charcoal: '#2E1F17', // main text
  inkSoft: '#46362B',
  secondaryGray: '#5C4E43', // 7.5:1 on the page
  muted: '#6E5F52', // small labels: 5.7:1 on the page
  placeholder: '#7D6F62',
  income: '#3A6B43',
  incomeSoft: '#E1EEDF',
  incomeBorder: '#BFD6BD',
  expense: '#A6431F',
  expenseSoft: '#F8E1D7',
  expenseBorder: '#E9BBA8',
  background: '#FBF7F0', // the page
  surface: '#FFFFFF', // cards, fields, sheets
  borderLight: '#E3CFB2',
  border: '#D2B994',
  disabledBg: '#F2E4D2',
  danger: '#A6431F',
  success: '#3A6B43',
  inkCard: '#2E1F17', // the balance card and dark badges
  inkLedge: '#140C07',
  backdrop: 'rgba(46,31,23,0.4)',
}

export type Palette = typeof lightColors

export const darkColors: Palette = {
  ...brand,
  orangeDeep: '#F6AC63', // orange text on dark: 9.9:1 on the page
  orangeLedge: '#A9591A',
  orangeSoft: '#3A2615',
  orangeBorder: '#5E3E1F',
  softPeach: '#4A321C',
  cream: '#2C2219',
  charcoal: '#F5E9DA',
  inkSoft: '#E4D4C1',
  secondaryGray: '#C9B8A6', // 9.8:1 on the page
  muted: '#B09F8F', // 7.4:1 on the page
  placeholder: '#968676',
  income: '#8BCB96',
  incomeSoft: '#1B2E20',
  incomeBorder: '#2F4D35',
  expense: '#F29470',
  expenseSoft: '#3A1F16',
  expenseBorder: '#5E3222',
  background: '#15100C',
  surface: '#211913',
  borderLight: '#3B2E24',
  border: '#4E3E31',
  disabledBg: '#2E241D',
  danger: '#F29470',
  success: '#8BCB96',
  inkCard: '#2B1F17',
  inkLedge: '#0A0604',
  backdrop: 'rgba(0,0,0,0.55)',
}

export type ColorScheme = 'light' | 'dark'
export type ThemePreference = 'system' | ColorScheme

export interface Theme {
  colors: Palette
  scheme: ColorScheme
  preference: ThemePreference
  setPreference: (preference: ThemePreference) => void
}

export const ThemeContext = createContext<Theme>({
  colors: lightColors,
  scheme: 'light',
  preference: 'system',
  setPreference: () => {},
})

export const useTheme = () => useContext(ThemeContext)
/** The active palette. */
export const useColors = () => useContext(ThemeContext).colors

/**
 * Styles that follow the theme: `const useStyles = makeStyles((Colors) => ({ ... }))` at file level,
 * `const styles = useStyles()` in the component. Each palette's styles are built once and reused.
 */
type StyleSheetInput = Parameters<typeof StyleSheet.create>[0]

export function makeStyles<S extends StyleSheetInput>(factory: (Colors: Palette) => S & StyleSheetInput) {
  const built = new Map<Palette, Readonly<S>>()
  return function useStyles(): Readonly<S> {
    const colors = useColors()
    return useMemo(() => {
      let styles = built.get(colors)
      if (!styles) {
        styles = StyleSheet.create(factory(colors))
        built.set(colors, styles)
      }
      return styles
    }, [colors])
  }
}

export const Fonts = {
  regular: 'Nunito_500Medium',
  semibold: 'Nunito_600SemiBold',
  bold: 'Nunito_700Bold',
  extrabold: 'Nunito_800ExtraBold',
  black: 'Nunito_900Black',
} as const

/**
 * The "drawer ledge": a thicker bottom edge, like the mascot's chunky 3D box. A border rather than a
 * shadow, so it looks the same on iOS, Android and web. Spread it after a 1.5 px border.
 */
export const ledge = (color: string, height = 3) => ({
  borderBottomWidth: height + 1.5,
  borderBottomColor: color,
})

/** Shared card look: a surface with a warm border and a ledge. */
export const card = (Colors: Palette) =>
  ({
    backgroundColor: Colors.surface,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.borderLight,
    ...ledge(Colors.borderLight, 2.5),
  }) as const
