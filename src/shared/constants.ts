export const APP_NAME = 'API-YES'
export const APP_AUTHOR = 'Utter_pulsar'
export const DATA_FILE = 'api-yes.json'
export const MANAGEMENT_STATUS_FILE = 'api-yes-management.json'
export const CLI_SESSION_FILE = 'api-yes-cli-session.json'
export const DEFAULT_MANAGEMENT_PORT = 8789
export const DEV_MANAGEMENT_PORT = 18789

/** Hand-drawn marker palette. Referenced by UI accents. */
export const DOODLE_PALETTE: Record<string, string> = {
  'marker-yellow': '#FFD23F',
  'marker-coral': '#FF6B6B',
  'marker-sky': '#4ECDC4',
  'marker-blue': '#5B8DEF',
  'marker-violet': '#9B6DFF',
  'marker-green': '#7BC950',
  'marker-pink': '#FF9FF3',
  'marker-knot': '#D97757',
  'marker-ink': '#2B2B2B',
  paper: '#FBF7EF'
}

/** Default local reverse-proxy server bind. localhost only — never expose to the LAN by default. */
export const DEFAULT_PROXY_HOST = '127.0.0.1'
export const DEFAULT_PROXY_PORT = 8788
