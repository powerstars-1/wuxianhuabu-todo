export type ManualTextCaptureCandidate = {
  id: string;
  text: string;
  x: number;
  y: number;
};

export type ManualTextCaptureGroup = {
  elementIds: string[];
  text: string;
  position: {
    x: number;
    y: number;
  };
};

const MAX_GROUP_X_DELTA = 320;
const MAX_GROUP_Y_GAP = 160;

const sortByCanvasPosition = (
  left: ManualTextCaptureCandidate,
  right: ManualTextCaptureCandidate,
) => {
  if (left.y !== right.y) {
    return left.y - right.y;
  }

  return left.x - right.x;
};

const shouldMergeIntoCurrentGroup = (
  currentGroup: ManualTextCaptureCandidate[],
  candidate: ManualTextCaptureCandidate,
) => {
  const previous = currentGroup[currentGroup.length - 1];

  return (
    Math.abs(candidate.x - previous.x) <= MAX_GROUP_X_DELTA &&
    candidate.y >= previous.y &&
    candidate.y - previous.y <= MAX_GROUP_Y_GAP
  );
};

export const groupManualTextCaptureCandidates = (
  candidates: readonly ManualTextCaptureCandidate[],
): ManualTextCaptureGroup[] => {
  const sorted = [...candidates]
    .filter((candidate) => candidate.text.trim())
    .sort(sortByCanvasPosition);

  if (sorted.length === 0) {
    return [];
  }

  const groupedCandidates = sorted.reduce<ManualTextCaptureCandidate[][]>((groups, candidate) => {
    const currentGroup = groups[groups.length - 1];

    if (!currentGroup || !shouldMergeIntoCurrentGroup(currentGroup, candidate)) {
      groups.push([candidate]);
      return groups;
    }

    currentGroup.push(candidate);
    return groups;
  }, []);

  return groupedCandidates.map((group) => ({
    elementIds: group.map((candidate) => candidate.id),
    text: group.map((candidate) => candidate.text.trim()).join("\n\n"),
    position: {
      x: group[0].x,
      y: group[0].y,
    },
  }));
};
