import { useState } from "react";
import type { NotesView } from "../notes/NotesTab";
import type { ApiTesterDraftState } from "./ApiTesterMockup";
import type { CryptographicToolTab } from "./ConversionTools";
import type { ApiTesterView, CompareView } from "./ToolHeaderTabs";

export function useToolsController() {
  const [notesView, setNotesView] = useState<NotesView>("grid");
  const [notesAddRequestId, setNotesAddRequestId] = useState(0);
  const [notebookView, setNotebookView] = useState<NotesView>("grid");
  const [notebookAddRequestId, setNotebookAddRequestId] = useState(0);
  const [apiTesterView, setApiTesterView] = useState<ApiTesterView>("test");
  const [apiTesterDraftStateByScope, setApiTesterDraftStateByScope] = useState<
    Record<string, ApiTesterDraftState>
  >({});
  const [comparingView, setComparingView] = useState<CompareView>("compare");
  const [cryptoActiveTab, setCryptoActiveTab] =
    useState<CryptographicToolTab>("base64");
  const [cookieModalOpen, setCookieModalOpen] = useState(false);

  return {
    apiTesterDraftStateByScope,
    apiTesterView,
    comparingView,
    cookieModalOpen,
    cryptoActiveTab,
    notebookAddRequestId,
    notebookView,
    notesAddRequestId,
    notesView,
    setApiTesterDraftStateByScope,
    setApiTesterView,
    setComparingView,
    setCookieModalOpen,
    setCryptoActiveTab,
    setNotebookAddRequestId,
    setNotebookView,
    setNotesAddRequestId,
    setNotesView,
  };
}
