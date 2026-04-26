const SOURCE_CARD_WIDTH = 260;
const SOURCE_CARD_HEIGHT = 164;

export type RecentlyDeletedSourceEntry = {
  normalizedText: string;
  position: {
    x: number;
    y: number;
  };
  expiresAt: number;
};

const SUPPRESSION_WINDOW_MS = 4000;

export const normalizeSuppressedSourceText = (value: string) =>
  value.replace(/\s+/g, "");

export const rememberRecentlyDeletedSource = (
  entries: RecentlyDeletedSourceEntry[],
  source: {
    title: string;
    position: {
      x: number;
      y: number;
    };
  },
  now = Date.now(),
) => {
  const normalizedText = normalizeSuppressedSourceText(source.title);

  if (!normalizedText) {
    return pruneRecentlyDeletedSources(entries, now);
  }

  return [
    ...pruneRecentlyDeletedSources(entries, now),
    {
      normalizedText,
      position: {
        x: source.position.x,
        y: source.position.y,
      },
      expiresAt: now + SUPPRESSION_WINDOW_MS,
    },
  ];
};

export const pruneRecentlyDeletedSources = (
  entries: RecentlyDeletedSourceEntry[],
  now = Date.now(),
) => entries.filter((entry) => entry.expiresAt > now);

export const shouldSuppressRecentlyDeletedSourceText = (
  candidate: {
    text: string;
    x: number;
    y: number;
  },
  entries: RecentlyDeletedSourceEntry[],
  now = Date.now(),
) => {
  const normalizedText = normalizeSuppressedSourceText(candidate.text);

  if (!normalizedText) {
    return false;
  }

  return pruneRecentlyDeletedSources(entries, now).some((entry) => {
    if (entry.normalizedText !== normalizedText) {
      return false;
    }

    return (
      Math.abs(candidate.x - entry.position.x) <= SOURCE_CARD_WIDTH &&
      Math.abs(candidate.y - entry.position.y) <= SOURCE_CARD_HEIGHT
    );
  });
};
