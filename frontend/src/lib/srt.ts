export interface ParsedSrtCue {
  start: number
  end: number
  text: string
}

const parseSrtTimestamp = (value: string) => {
  const match = value
    .trim()
    .match(/(?:(\d+):)?(\d{1,2}):(\d{2})(?:[,.](\d{1,3}))?/);

  if (!match) {
    return null;
  }

  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const milliseconds = Number((match[4] ?? '0').padEnd(3, '0').slice(0, 3));

  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
};

const decodeSubtitleEntities = (value: string) =>
  value.replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, entity: string) => {
    switch (entity) {
      case 'amp':
        return '&';
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
      case 'nbsp':
        return ' ';
      default:
        return _;
    }
  });

const cleanSubtitleText = (lines: string[]) =>
  decodeSubtitleEntities(
    lines
      .join('\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .trim()
  );

export const parseSrtFileText = (content: string): ParsedSrtCue[] => {
  const normalized = content
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  return normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n').map((line) => line.trimEnd());
      const timingLineIndex = lines.findIndex((line) => line.includes('-->'));

      if (timingLineIndex < 0) {
        return null;
      }

      const [startValue, endValue] = lines[timingLineIndex].split('-->');
      const start = parseSrtTimestamp(startValue ?? '');
      const end = parseSrtTimestamp(endValue ?? '');
      const text = cleanSubtitleText(lines.slice(timingLineIndex + 1));

      if (start === null || end === null || end <= start || !text) {
        return null;
      }

      return { start, end, text };
    })
    .filter((cue): cue is ParsedSrtCue => Boolean(cue))
    .sort((a, b) => a.start - b.start);
};
