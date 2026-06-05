import type { SnackbarTone } from "../../types/snackbar";

export function AppSnackbar({
  message,
  tone,
  closing,
  onClick,
}: {
  message: string;
  tone: SnackbarTone;
  closing: boolean;
  onClick?: () => void;
}): JSX.Element {
  return (
    <div
      className={`app-snackbar ${tone}${closing ? " closing" : ""}`}
      role="status"
      onClick={onClick}
    >
      {message}
    </div>
  );
}
