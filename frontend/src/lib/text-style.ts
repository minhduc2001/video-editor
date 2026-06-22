export const TEXT_FONT_OPTIONS = [
  { label: 'Geist Sans', value: "'Geist Variable', sans-serif" },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Segoe UI', value: "'Segoe UI', sans-serif" },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
  { label: 'Tahoma', value: 'Tahoma, sans-serif' },
  { label: 'Trebuchet MS', value: "'Trebuchet MS', sans-serif" },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times New Roman', value: "'Times New Roman', serif" },
  { label: 'Impact', value: 'Impact, sans-serif' },
  { label: 'Courier New', value: "'Courier New', monospace" },
  { label: 'Comic Sans MS', value: "'Comic Sans MS', cursive" },
] as const

export const DEFAULT_TEXT_FONT = TEXT_FONT_OPTIONS[0].value
export const DEFAULT_TEXT_SIZE = 30
export const DEFAULT_TEXT_WEIGHT = 700
export const DEFAULT_TEXT_STYLE = 'normal' as const
export const DEFAULT_TEXT_COLOR = '#ffffff'
export const DEFAULT_TEXT_STROKE_COLOR = '#111111'
export const DEFAULT_TEXT_STROKE_WIDTH = 0
export const DEFAULT_TEXT_BACKGROUND_COLOR = '#000000'
export const DEFAULT_TEXT_BACKGROUND_OPACITY = 0
export const AUTO_CAPTION_TEXT_COLOR = '#111111'
export const AUTO_CAPTION_BACKGROUND_COLOR = '#ffd84d'
export const AUTO_CAPTION_BACKGROUND_OPACITY = 0.92
export const AUTO_CAPTION_COVER_COLOR = '#ffd84d'
export const AUTO_CAPTION_COVER_OPACITY = 0.86

export const hexToRgba = (hex: string, opacity: number) => {
  const normalizedHex = hex.replace('#', '');
  const safeHex = normalizedHex.length === 3
    ? normalizedHex.split('').map((char) => `${char}${char}`).join('')
    : normalizedHex.padEnd(6, '0').slice(0, 6);
  const red = parseInt(safeHex.slice(0, 2), 16);
  const green = parseInt(safeHex.slice(2, 4), 16);
  const blue = parseInt(safeHex.slice(4, 6), 16);
  const alpha = Math.max(0, Math.min(1, opacity));

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}
