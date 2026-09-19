export const BOARD_WIZARD_PASTE_MAX_LENGTH = 30_000;

export type NumberedBoardSourceItem = {
  rank: number;
  heading: string;
  title: string;
  subtitle: string;
  body: string;
};

export type NumberedBoardSource = {
  title: string;
  description: string;
  items: NumberedBoardSourceItem[];
};

export function detectBoardWizardSourceUrl(
  mode: string,
  prompt: string,
  explicitUrl: string,
): string {
  if (mode !== 'describe' && mode !== 'url') return '';
  // A pasted script may contain reference links. Its numbered sections are the
  // source; an incidental URL inside the script must not switch the wizard to
  // webpage-import mode.
  if (mode === 'describe' && parseNumberedBoardSource(prompt)) return '';
  const value = mode === 'url' ? explicitUrl : prompt;
  const markdownTarget = value.match(/\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/i)?.[1];
  const candidate = markdownTarget ?? value.match(/https?:\/\/[^\s<>"'\]]+/i)?.[0] ?? '';
  return trimBoardWizardUrlPunctuation(candidate);
}

function trimBoardWizardUrlPunctuation(value: string): string {
  let trimmed = value.replace(/[.,;!?]+$/, '');
  while (
    trimmed.endsWith(')')
    && (trimmed.match(/\)/g)?.length ?? 0) > (trimmed.match(/\(/g)?.length ?? 0)
  ) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed;
}

export function parseNumberedBoardSource(value: string): NumberedBoardSource | null {
  const lines = value.replace(/\r\n?/g, '\n').split('\n');
  const preamble: string[] = [];
  const items: NumberedBoardSourceItem[] = [];
  let current: NumberedBoardSourceItem | null = null;
  let genericPreamble = false;

  const finishCurrent = () => {
    if (!current) {
      return;
    }
    current.body = stripTrailingGenerationCommentary(cleanSourceMarkdown(current.body));
    items.push(current);
    current = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (items.length && /^if you want(?:,?\s+i can)?\s*:/i.test(cleanSourceMarkdown(line))) {
      finishCurrent();
      break;
    }
    if (isSourceSectionHeading(line) || isNonNarratedSourceReference(line)) {
      continue;
    }
    const numberedMarker = line.match(/^(\d{1,3})[.)]\s+(.+)$/);
    const sceneMarker = line.match(/^(?:#{1,6}\s*)?scene\s+(\d{1,3})(?:\s*[:.)\-–—]\s*(.+))?$/i);
    const marker = numberedMarker ?? sceneMarker;
    if (marker?.[1] && (numberedMarker?.[2] || sceneMarker)) {
      finishCurrent();
      const rank = Number.parseInt(marker[1], 10);
      const explicitSceneTitle = sceneMarker?.[2] ? cleanSourceMarkdown(sceneMarker[2]) : '';
      const heading = numberedMarker
        ? cleanSourceMarkdown(numberedMarker[2])
        : explicitSceneTitle || `Scene ${rank}`;
      const headingParts = heading.match(/^(.+?)\s+(?:—|–|-)\s+(.+)$/);
      current = {
        rank,
        heading,
        title: (headingParts?.[1] ?? heading).trim(),
        subtitle: (headingParts?.[2] ?? '').trim(),
        body: '',
      };
      continue;
    }

    if (current) {
      if (line) {
        current.body = `${current.body} ${line}`.trim();
      }
    } else if (line) {
      preamble.push(line);
      if (preamble.length === 1) genericPreamble = isGenericSourcePreamble(line);
    }
  }
  finishCurrent();

  if (items.length < 3 || items.some((item, index) => item.rank !== index + 1)) {
    return null;
  }

  const preambleTitle = cleanSourceMarkdown(preamble[0] ?? '');
  return {
    title: genericPreamble ? inferNumberedSourceTitle(items) : preambleTitle,
    description: genericPreamble ? '' : cleanSourceMarkdown(preamble.slice(1).join(' ')),
    items,
  };
}

export function estimateNumberedBoardSourceNarrationSeconds(
  source: NumberedBoardSource | null,
  wordsPerSecond = 2.35,
): number {
  if (!source?.items.length || !Number.isFinite(wordsPerSecond) || wordsPerSecond <= 0) return 0;
  const wordCount = source.items.reduce(
    (total, item) => total + (item.body.match(/\S+/g)?.length ?? 0),
    0,
  );
  return wordCount / source.items.length / wordsPerSecond;
}

function isSourceSectionHeading(value: string): boolean {
  const text = cleanSourceMarkdown(value);
  return /^(?:set|section|module|part)\s+\d{1,3}\b(?:\s*[:\-–—].*)?$/i.test(text);
}

function isNonNarratedSourceReference(value: string): boolean {
  return /^(?:instructor|editor|producer)\s+(?:reference|note),?\s+not spoken\s*:/i.test(cleanSourceMarkdown(value));
}

function isGenericSourcePreamble(value: string): boolean {
  return /^(?:below|here (?:are|is)|the following|i(?:'ve| have))\b/i.test(cleanSourceMarkdown(value));
}

function inferNumberedSourceTitle(items: NumberedBoardSourceItem[]): string {
  const first = items[0];
  const headingMatch = first?.title.match(/^welcome to\s+(.+)$/i)?.[1];
  const narrationMatch = first?.body.match(/\bwelcome to\s+([^.!?]{2,90})(?:[.!?]|$)/i)?.[1];
  return cleanSourceMarkdown(headingMatch ?? narrationMatch ?? '');
}

function cleanSourceMarkdown(value: string): string {
  return value
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/^[#>*_`~\s-]+|[*_`~]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTrailingGenerationCommentary(value: string): string {
  return value
    .replace(/\s+This (?:version|script|board) should (?:run|take|last) approximately [^.]{1,120}\.\s*$/i, '')
    .trim();
}
