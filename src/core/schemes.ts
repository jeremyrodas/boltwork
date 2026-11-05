/**
 * Color schemes: the vault door in different metals. Each sets the logo's colors here (shared by the
 * in-app mark, the window, taskbar and tray icons) and the matching accent tokens in styles.css
 * ([data-scheme='…'] for dark and light). Brass is the default and the installer's icon.
 */
export type ColorScheme = 'brass' | 'copper' | 'verdigris' | 'steel' | 'silver';

export interface MarkColors {
  /** The door's face. */
  body: string;
  /** Thin rim around the square, so the mark holds its edge on dark taskbars. */
  edge: string;
  /** The metal: rim, handwheel and hub. */
  metal: string;
  /** The metal greyed out, for the tray icon while locked. */
  locked: string;
}

export interface SchemeInfo { id: ColorScheme; label: string; blurb: string; mark: MarkColors }

export const SCHEMES: Record<ColorScheme, SchemeInfo> = {
  brass: {
    id: 'brass', label: 'Brass', blurb: 'Warm brass on graphite',
    mark: { body: '#1f2430', edge: '#485062', metal: '#c9a45c', locked: '#9aa0ab' },
  },
  copper: {
    id: 'copper', label: 'Copper', blurb: 'Red copper on dark umber',
    mark: { body: '#241b18', edge: '#4e3c35', metal: '#c8794f', locked: '#a39a96' },
  },
  verdigris: {
    id: 'verdigris', label: 'Verdigris', blurb: 'Copper’s green patina on slate',
    mark: { body: '#16201f', edge: '#35504b', metal: '#5fb8a3', locked: '#93a3a0' },
  },
  steel: {
    id: 'steel', label: 'Blued steel', blurb: 'Heat-blued steel on navy black',
    mark: { body: '#161b26', edge: '#3a4660', metal: '#8fb0e0', locked: '#98a1b1' },
  },
  silver: {
    id: 'silver', label: 'Silver', blurb: 'Polished nickel silver on charcoal',
    mark: { body: '#1c1e22', edge: '#4a4e57', metal: '#c3c8d1', locked: '#7d828c' },
  },
};

export const SCHEME_ORDER: ColorScheme[] = ['brass', 'copper', 'verdigris', 'steel', 'silver'];

export function schemeOf(value: unknown): ColorScheme {
  return typeof value === 'string' && value in SCHEMES ? (value as ColorScheme) : 'brass';
}
