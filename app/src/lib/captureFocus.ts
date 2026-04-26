export const buildCaptureEventKey = (
  captureId: string | null | undefined,
  capturedAt: string | null | undefined,
) => {
  if (!captureId) {
    return null;
  }

  if (!capturedAt) {
    return captureId;
  }

  return `${captureId}:${capturedAt}`;
};
