export type SnackbarTone = "valid" | "invalid" | "warning";

export type SnackbarState = {
  message: string;
  tone: SnackbarTone;
};
