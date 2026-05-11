export type CopyFeedback = (message: string, tone: "valid" | "invalid") => void;

export async function copyTextToClipboard(
  value: string,
  onFeedback?: CopyFeedback,
): Promise<boolean> {
  const writeText = navigator.clipboard?.writeText;
  if (!writeText) {
    onFeedback?.("Clipboard is not available.", "invalid");
    return false;
  }

  try {
    await writeText.call(navigator.clipboard, value);
    onFeedback?.("Copied", "valid");
    return true;
  } catch (error) {
    console.error(error);
    onFeedback?.(
      error instanceof Error ? error.message : "Copy failed",
      "invalid",
    );
    return false;
  }
}
