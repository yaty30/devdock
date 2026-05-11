import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { Modal } from "../../components/dialogs/Modal";

import {
  AlertCircle,
  ArrowLeftRight,
  Check,
  Copy,
  Download,
  Eraser,
  FileUp,
  Redo2,
  LoaderCircle,
  Plus,
  Save,
  Send,
  Settings,
  Sparkles,
  Trash2,
  X,
  BrushCleaning,
  Cookie,
} from "lucide-react";
import {
  AppSelect,
  type AppSelectOption,
} from "../../components/common/AppSelect";
import { ConfirmDialog } from "../../components/dialogs/ConfirmDialog";
import { Panel } from "../../components/common/Panel";
import type {
  ApiTesterRequest,
  ApiTesterResponse,
  ApiTesterResponseHeader,
} from "../../types";

type ApiMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

type ApiBuilderTab = "Params" | "Headers" | "Body" | "Auth";
type ApiBodyMode = "raw" | "media";
type ApiResponseTab = "Pretty" | "Raw" | "Headers" | "Cookies";
type ApiTesterView = "test" | "history";

type ApiPanelDragState = {
  startX: number;
  startBuilderWidth: number;
  minBuilderWidth: number;
  maxBuilderWidth: number;
};

type ApiHistoryColumnKey =
  | "time"
  | "method"
  | "url"
  | "status"
  | "duration"
  | "size"
  | "message"
  | "rerun";

type ApiHistoryColumn = {
  key: ApiHistoryColumnKey;
  label: string;
  width: number;
  minWidth: number;
};

type ApiHistoryColumnDragState = {
  key: ApiHistoryColumnKey;
  startX: number;
  startWidth: number;
  nextWidth: number;
};

type ApiKeyValueRow = {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
};

export type ApiTesterCookieEntry = {
  id: string;
  name: string;
  value: string;
};

type SavedApiTesterRequest = {
  method: ApiMethod;
  url: string;
  params: ApiKeyValueRow[];
  headers: ApiKeyValueRow[];
  body: string;
  bodyMode?: ApiBodyMode;
  mediaFieldName?: string;
  mediaFields?: ApiKeyValueRow[];
  bearerToken: string;
};

type ApiTesterRequestSnapshot = SavedApiTesterRequest & {
  mediaFile?: ApiTesterMediaFile | null;
};

type ApiTesterMediaFile = {
  name: string;
  type: string;
  size: number;
  base64: string;
};

type ApiTesterHistoryMetadata = {
  id: string;
  method: ApiMethod;
  url: string;
  status: number | null;
  durationMs: number | null;
  responseSizeBytes: number | null;
  message: string;
  createdAt: string;
};

type ApiTesterHistoryDetail = {
  id: string;
  requestHeaders: ApiTesterResponseHeader[];
  requestBodyPreview: string;
  responseHeaders: ApiTesterResponseHeader[];
  responseBodyPreview: string;
  responseBodyTruncated: boolean;
  binaryResponseBody: boolean;
};

const API_SPLITTER_WIDTH = 14;
const API_PANEL_MIN_WIDTH = 320;
const API_TESTER_STORAGE_KEY = "ivs-dashboard-api-tester-request";
const API_TESTER_HISTORY_METADATA_STORAGE_KEY =
  "ivs-dashboard-api-tester-history-metadata";
const API_TESTER_HISTORY_DETAIL_STORAGE_PREFIX =
  "ivs-dashboard-api-tester-history-detail:";
const API_TESTER_HISTORY_COLUMN_WIDTHS_STORAGE_KEY =
  "ivs-dashboard-api-tester-history-column-widths";
const API_TESTER_COOKIES_STORAGE_KEY = "ivs-dashboard-api-tester-cookies";
const API_TESTER_HISTORY_LIMIT = 250;
const API_TESTER_BODY_PREVIEW_LIMIT_BYTES = 100 * 1024;
const API_TESTER_SEND_EVENT = "api-tester:send";
const API_TESTER_SAVE_EVENT = "api-tester:save";
const API_METHODS: ApiMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
];

const getMethodColor = (method: ApiMethod): string => {
  switch (method) {
    case "GET":
      return "var(--accent)";
    case "POST":
      return "var(--success)";
    case "PUT":
      return "var(--warning)";
    case "PATCH":
      return "var(--info)";
    case "DELETE":
      return "var(--error)";
    case "HEAD":
      return "var(--mild)";
    case "OPTIONS":
      return "var(--command)";
  }
};

const API_METHOD_OPTIONS: Array<AppSelectOption<ApiMethod>> = API_METHODS.map(
  (value) => ({ value, label: value, dotColor: getMethodColor(value) }),
);

const API_HISTORY_COLUMNS: ApiHistoryColumn[] = [
  { key: "time", label: "Time", width: 150, minWidth: 122 },
  { key: "method", label: "Method", width: 104, minWidth: 88 },
  { key: "url", label: "URL", width: 320, minWidth: 180 },
  { key: "status", label: "Status", width: 104, minWidth: 92 },
  { key: "duration", label: "Duration", width: 118, minWidth: 98 },
  { key: "size", label: "Size", width: 104, minWidth: 86 },
  { key: "message", label: "Message", width: 280, minWidth: 160 },
  { key: "rerun", label: "Re-run", width: 88, minWidth: 76 },
];

const DEFAULT_PARAMS: ApiKeyValueRow[] = [
  createRow("expand", "profile", true),
  createRow("fields", "id,name,email,created_at", true),
];

const DEFAULT_HEADERS: ApiKeyValueRow[] = [
  createRow("Accept", "application/json", true),
];

const DEFAULT_MEDIA_FIELDS: ApiKeyValueRow[] = [createRow()];

export function ApiTesterMockup({
  view = "test",
  storageScopeId = "global",
  onViewChange,
  onFeedback,
}: {
  view?: ApiTesterView;
  storageScopeId?: string;
  onViewChange?: (view: ApiTesterView) => void;
  onFeedback?: (message: string, tone: "valid" | "invalid" | "warning") => void;
}): JSX.Element {
  const savedRequest = useMemo(readSavedRequest, []);
  const gridRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<ApiPanelDragState | null>(null);
  const [builderWidth, setBuilderWidth] = useState<number | null>(null);
  const [method, setMethod] = useState<ApiMethod>(
    savedRequest?.method ?? "GET",
  );
  const [url, setUrl] = useState(
    savedRequest?.url ?? "https://api.example.com/v1/users/123",
  );
  const [params, setParams] = useState<ApiKeyValueRow[]>(
    savedRequest?.params ?? DEFAULT_PARAMS,
  );
  const [headers, setHeaders] = useState<ApiKeyValueRow[]>(
    savedRequest?.headers ?? DEFAULT_HEADERS,
  );
  const [body, setBody] = useState(
    savedRequest?.body ?? '{\n  "name": "Alex Morgan"\n}',
  );
  const [bodyMode, setBodyMode] = useState<ApiBodyMode>(
    savedRequest?.bodyMode ?? "raw",
  );
  const [mediaFieldName, setMediaFieldName] = useState(
    savedRequest?.mediaFieldName ?? "file",
  );
  const [mediaFields, setMediaFields] = useState<ApiKeyValueRow[]>(
    savedRequest?.mediaFields ?? DEFAULT_MEDIA_FIELDS,
  );
  const [mediaFile, setMediaFile] = useState<ApiTesterMediaFile | null>(null);
  const [bearerToken, setBearerToken] = useState(
    savedRequest?.bearerToken ?? "",
  );
  const [activeBuilderTab, setActiveBuilderTab] =
    useState<ApiBuilderTab>("Params");
  const [activeResponseTab, setActiveResponseTab] =
    useState<ApiResponseTab>("Pretty");
  const [response, setResponse] = useState<ApiTesterResponse | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [history, setHistory] = useState<ApiTesterHistoryMetadata[]>(() =>
    readHistoryMetadata(storageScopeId),
  );

  const gridStyle =
    builderWidth === null
      ? undefined
      : ({ "--api-builder-column": `${builderWidth}px` } as CSSProperties);

  const preparedUrl = useMemo(() => {
    try {
      return buildRequestUrl(url, params);
    } catch {
      return url;
    }
  }, [params, url]);

  const displayBody = useMemo(
    () => getDisplayedResponseBody(response, activeResponseTab),
    [activeResponseTab, response],
  );
  const responseLines = displayBody.length > 0 ? displayBody.split("\n") : [];

  const saveRequest = useCallback((): void => {
    const nextRequest: SavedApiTesterRequest = {
      method,
      url,
      params,
      headers,
      body,
      bodyMode,
      mediaFieldName,
      mediaFields,
      bearerToken,
    };
    window.localStorage.setItem(
      API_TESTER_STORAGE_KEY,
      JSON.stringify(nextRequest),
    );
    setSavedAt(new Date().toLocaleTimeString());
  }, [
    bearerToken,
    body,
    bodyMode,
    headers,
    mediaFieldName,
    mediaFields,
    method,
    params,
    url,
  ]);

  const writeHistory = useCallback(
    (
      metadata: ApiTesterHistoryMetadata,
      detail: ApiTesterHistoryDetail,
    ): void => {
      saveHistoryDetail(storageScopeId, detail);
      setHistory((current) => {
        const next = [metadata, ...current].slice(0, API_TESTER_HISTORY_LIMIT);
        writeHistoryMetadata(storageScopeId, next);
        pruneHistoryDetails(storageScopeId, next);
        return next;
      });
    },
    [storageScopeId],
  );

  const executeRequest = useCallback(
    async (
      snapshot: ApiTesterRequestSnapshot,
    ): Promise<ApiTesterHistoryMetadata | null> => {
      setRequestError(null);
      setIsSending(true);

      let requestUrl = snapshot.url;
      const startedAt = performance.now();
      try {
        requestUrl = buildRequestUrl(snapshot.url, snapshot.params);
        const requestBody = canMethodSendBody(snapshot.method)
          ? buildRequestBody(snapshot)
          : undefined;
        const requestHeaders = buildRequestHeaders(
          snapshot.headers,
          snapshot.bearerToken,
          snapshot.method,
          requestBody?.textPreview ?? snapshot.body,
          requestBody?.contentType,
        );
        const historySnapshot = {
          ...snapshot,
          body: requestBody?.textPreview ?? snapshot.body,
        };
        const cookieEntries = readStoredCookies(storageScopeId);
        const activeCookieEntries = cookieEntries.filter((c) => c.name.trim());
        if (
          activeCookieEntries.length > 0 &&
          !Object.keys(requestHeaders).some((k) => k.toLowerCase() === "cookie")
        ) {
          requestHeaders.Cookie = activeCookieEntries
            .map((c) => `${c.name.trim()}=${c.value}`)
            .join("; ");
        }
        const nextResponse = await sendApiTesterRequest({
          method: snapshot.method,
          url: requestUrl,
          headers: requestHeaders,
          body: requestBody?.body,
          bodyBase64: requestBody?.bodyBase64,
          bodyEncoding: requestBody?.bodyEncoding,
          timeoutMs: 60000,
        });
        setResponse(nextResponse);
        setActiveResponseTab("Pretty");
        const historyId = createHistoryId();
        const metadata: ApiTesterHistoryMetadata = {
          id: historyId,
          method: snapshot.method,
          url: requestUrl,
          status: nextResponse.status,
          durationMs: nextResponse.durationMs,
          responseSizeBytes: nextResponse.sizeBytes,
          message: nextResponse.statusText,
          createdAt: new Date().toISOString(),
        };
        writeHistory(
          metadata,
          createHistoryDetail(
            historyId,
            requestHeaders,
            historySnapshot,
            nextResponse,
          ),
        );
        return metadata;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Request failed.";
        setResponse(null);
        setRequestError(message);
        const historyId = createHistoryId();
        const durationMs = Math.max(
          0,
          Math.round(performance.now() - startedAt),
        );
        writeHistory(
          {
            id: historyId,
            method: snapshot.method,
            url: requestUrl,
            status: null,
            durationMs,
            responseSizeBytes: null,
            message,
            createdAt: new Date().toISOString(),
          },
          createErrorHistoryDetail(historyId, snapshot, message),
        );
        return null;
      } finally {
        setIsSending(false);
      }
    },
    [storageScopeId, writeHistory],
  );

  const sendRequest = useCallback(async (): Promise<void> => {
    await executeRequest({
      method,
      url,
      params,
      headers,
      body,
      bodyMode,
      mediaFieldName,
      mediaFields,
      mediaFile,
      bearerToken,
    });
  }, [
    bearerToken,
    body,
    bodyMode,
    executeRequest,
    headers,
    mediaFieldName,
    mediaFields,
    mediaFile,
    method,
    params,
    url,
  ]);

  useEffect(() => {
    if (!canMethodSendBody(method) && activeBuilderTab === "Body") {
      setActiveBuilderTab("Params");
    }
  }, [activeBuilderTab, method]);

  function selectMethod(nextMethod: ApiMethod): void {
    setMethod(nextMethod);
    if (!canMethodSendBody(nextMethod) && activeBuilderTab === "Body") {
      setActiveBuilderTab("Params");
    }
  }

  async function rerunHistoryRecord(
    record: ApiTesterHistoryMetadata,
  ): Promise<ApiTesterHistoryMetadata | null> {
    if (!isSuccessfulApiHistoryRecord(record)) {
      return null;
    }

    const detail = readHistoryDetail(storageScopeId, record.id);
    const nextHeaders = detail
      ? detail.requestHeaders.map((header) =>
          createRow(header.name, header.value, true),
        )
      : DEFAULT_HEADERS;
    const nextBody = detail?.requestBodyPreview ?? "";

    setMethod(record.method);
    setUrl(record.url);
    setParams([createRow()]);
    setHeaders(nextHeaders);
    setBody(nextBody);
    setBodyMode("raw");
    setMediaFieldName("file");
    setMediaFields(DEFAULT_MEDIA_FIELDS);
    setMediaFile(null);
    setBearerToken("");
    if (!canMethodSendBody(record.method) && activeBuilderTab === "Body") {
      setActiveBuilderTab("Params");
    }
    return executeRequest({
      method: record.method,
      url: record.url,
      params: [],
      headers: nextHeaders,
      body: nextBody,
      bearerToken: "",
    });
  }

  function clearHistory(): void {
    clearStoredHistory(storageScopeId);
    setHistory([]);
    onFeedback?.("History cleared", "valid");
  }

  useEffect(() => {
    setHistory(readHistoryMetadata(storageScopeId));
  }, [storageScopeId]);

  async function copyCurrentResponse(): Promise<void> {
    const text = getResponseClipboardText(response, activeResponseTab);
    if (!text) {
      return;
    }
    try {
      await navigator.clipboard?.writeText(text);
      onFeedback?.("Copied", "valid");
    } catch {
      onFeedback?.("Copy failed", "invalid");
    }
  }

  useEffect(() => {
    const handleSend = (): void => {
      void sendRequest();
    };
    const handleSave = (): void => saveRequest();

    window.addEventListener(API_TESTER_SEND_EVENT, handleSend);
    window.addEventListener(API_TESTER_SAVE_EVENT, handleSave);
    return () => {
      window.removeEventListener(API_TESTER_SEND_EVENT, handleSend);
      window.removeEventListener(API_TESTER_SAVE_EVENT, handleSave);
    };
  }, [saveRequest, sendRequest]);

  const startResize = (event: PointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    const grid = gridRef.current;
    const gridWidth = grid?.clientWidth ?? API_PANEL_MIN_WIDTH * 2;
    const requestPanel = grid?.querySelector<HTMLElement>(
      ".api-request-builder",
    );
    const availableWidth = Math.max(0, gridWidth - API_SPLITTER_WIDTH);
    const maxBuilderWidth = Math.max(
      API_PANEL_MIN_WIDTH,
      availableWidth - API_PANEL_MIN_WIDTH,
    );
    const currentBuilderWidth =
      builderWidth ??
      requestPanel?.getBoundingClientRect().width ??
      availableWidth * 0.36;

    dragRef.current = {
      startX: event.clientX,
      startBuilderWidth: clamp(
        currentBuilderWidth,
        API_PANEL_MIN_WIDTH,
        maxBuilderWidth,
      ),
      minBuilderWidth: API_PANEL_MIN_WIDTH,
      maxBuilderWidth,
    };
  };

  const resizeLayout = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }

    setBuilderWidth(
      clamp(
        drag.startBuilderWidth + event.clientX - drag.startX,
        drag.minBuilderWidth,
        drag.maxBuilderWidth,
      ),
    );
  };

  const stopResize = (event: PointerEvent<HTMLDivElement>): void => {
    if (
      dragRef.current &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  };

  function clearRequest(): void {
    setUrl("");
    setParams([createRow()]);
    setHeaders(DEFAULT_HEADERS);
    setBody("");
    setBodyMode("raw");
    setMediaFieldName("file");
    setMediaFields(DEFAULT_MEDIA_FIELDS);
    setMediaFile(null);
    setBearerToken("");
    setResponse(null);
    setRequestError(null);
    setSavedAt(null);
  }

  async function selectMediaFile(file: File | null): Promise<void> {
    if (!file) {
      setMediaFile(null);
      return;
    }

    try {
      setMediaFile(await readMediaFile(file));
    } catch (error) {
      console.error(error);
      onFeedback?.("File could not be loaded", "invalid");
      setMediaFile(null);
    }
  }

  function downloadResponse(): void {
    if (!response) {
      return;
    }

    const text = getResponseClipboardText(response, activeResponseTab);
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `api-response-${Date.now()}.txt`;
    anchor.click();
    URL.revokeObjectURL(objectUrl);
  }

  if (view === "history") {
    return (
      <ApiTesterHistoryView
        history={history}
        storageScopeId={storageScopeId}
        onFeedback={onFeedback}
        onRerun={rerunHistoryRecord}
        onClearHistory={clearHistory}
      />
    );
  }

  return (
    <section className="api-tester-screen">
      <div className="api-request-bar panel">
        <AppSelect
          className="api-method-select"
          value={method}
          options={API_METHOD_OPTIONS}
          ariaLabel="HTTP method"
          onChange={selectMethod}
          showDots={true}
          minDropdownWidth={110}
        />
        <input
          type="url"
          value={url}
          placeholder="https://api.example.com/v1/resource"
          aria-label="Request URL"
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              void sendRequest();
            }
          }}
        />
        <button
          className="button primary compact"
          type="button"
          disabled={isSending || !url.trim()}
          onClick={() => void sendRequest()}
        >
          {isSending ? (
            <LoaderCircle className="button-spinner" size={15} />
          ) : (
            <Send size={15} />
          )}
          Send
        </button>
        <div className="api-request-utilities">
          <button
            className="icon-button secondary"
            type="button"
            title="Copy full URL"
            onClick={() => void navigator.clipboard?.writeText(preparedUrl)}
            disabled={!preparedUrl.trim() || isSending}
          >
            <Copy size={15} />
          </button>
          <button
            className="icon-button secondary"
            type="button"
            title="Clear"
            disabled={
              (isSending &&
                !url &&
                params.every((row) => !row.key && !row.value)) ||
              !url.trim()
            }
            onClick={clearRequest}
          >
            <Eraser size={15} />
          </button>
        </div>
      </div>

      <div
        className="api-builder-response-grid"
        ref={gridRef}
        style={gridStyle}
      >
        <section className="api-request-builder panel">
          <div className="api-tabs" role="tablist" aria-label="Request builder">
            {(["Params", "Headers", "Body", "Auth"] as const).map((tab) => (
              <button
                className={tab === activeBuilderTab ? "active" : undefined}
                type="button"
                role="tab"
                aria-selected={tab === activeBuilderTab}
                disabled={tab === "Body" && !canMethodSendBody(method)}
                title={
                  tab === "Body" && !canMethodSendBody(method)
                    ? `${method} requests do not send a body`
                    : undefined
                }
                key={tab}
                onClick={() => setActiveBuilderTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>
          <div className="api-builder-tab-body">
            {activeBuilderTab === "Params" ? (
              <ApiKeyValueEditor
                rows={params}
                keyLabel="Key"
                valueLabel="Value"
                emptyLabel="No query parameters"
                onRowsChange={setParams}
              />
            ) : null}
            {activeBuilderTab === "Headers" ? (
              <ApiKeyValueEditor
                rows={headers}
                keyLabel="Header"
                valueLabel="Value"
                emptyLabel="No headers"
                onRowsChange={setHeaders}
              />
            ) : null}
            {activeBuilderTab === "Body" ? (
              <div className="api-body-panel">
                <div className="api-body-mode-tabs" role="tablist">
                  <button
                    className={bodyMode === "raw" ? "active" : undefined}
                    type="button"
                    role="tab"
                    aria-selected={bodyMode === "raw"}
                    onClick={() => setBodyMode("raw")}
                  >
                    Raw
                  </button>
                  <button
                    className={bodyMode === "media" ? "active" : undefined}
                    type="button"
                    role="tab"
                    aria-selected={bodyMode === "media"}
                    onClick={() => setBodyMode("media")}
                  >
                    Media
                  </button>
                </div>
                {bodyMode === "raw" ? (
                  <textarea
                    className="api-body-editor"
                    value={body}
                    spellCheck={false}
                    aria-label="Request body"
                    placeholder="Request body"
                    onChange={(event) => setBody(event.target.value)}
                  />
                ) : (
                  <div className="api-media-upload-panel">
                    <div className="api-media-upload-card">
                      <FileUp size={18} />
                      <div>
                        <strong>
                          {mediaFile ? mediaFile.name : "No media selected"}
                        </strong>
                        <span>
                          {mediaFile
                            ? `${mediaFile.type || "application/octet-stream"} - ${formatBytes(mediaFile.size)}`
                            : "Choose an image, video, audio, or document to send as multipart/form-data."}
                        </span>
                      </div>
                      <label className="button secondary compact">
                        Choose File
                        <input
                          type="file"
                          onChange={(event) =>
                            void selectMediaFile(
                              event.target.files?.[0] ?? null,
                            )
                          }
                        />
                      </label>
                    </div>
                    <label className="api-media-field-name">
                      <span>File Field Name</span>
                      <input
                        value={mediaFieldName}
                        placeholder="file"
                        onChange={(event) =>
                          setMediaFieldName(event.target.value)
                        }
                      />
                    </label>
                    <div className="api-media-fields">
                      <div className="api-media-fields-title">
                        Additional Form Fields
                      </div>
                      <ApiKeyValueEditor
                        rows={mediaFields}
                        keyLabel="Field"
                        valueLabel="Value"
                        emptyLabel="No form fields"
                        onRowsChange={setMediaFields}
                      />
                    </div>
                  </div>
                )}
              </div>
            ) : null}
            {activeBuilderTab === "Auth" ? (
              <div className="api-auth-panel">
                <label>
                  <span>Bearer Token</span>
                  <input
                    type="password"
                    value={bearerToken}
                    placeholder="Paste token"
                    onChange={(event) => setBearerToken(event.target.value)}
                  />
                </label>
              </div>
            ) : null}
          </div>
          <div className="api-builder-footer">
            <span>{savedAt ? `Saved at ${savedAt}` : preparedUrl}</span>
          </div>
        </section>

        <div
          className="grid-splitter api-builder-response-splitter"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize API request builder and response panel"
          onPointerDown={startResize}
          onPointerMove={resizeLayout}
          onPointerUp={stopResize}
          onPointerCancel={stopResize}
        />

        <section className="api-response-panel panel">
          <header className="api-response-header">
            <div>
              <h2>Response</h2>
              <div className="api-response-badges">
                <span
                  className={response?.ok ? "success" : response ? "error" : ""}
                >
                  {isSending
                    ? "Sending"
                    : response
                      ? `${response.status} ${response.statusText}`
                      : "Ready"}
                </span>
                <span>{response ? `${response.durationMs} ms` : "-- ms"}</span>
                <span>{response ? formatBytes(response.sizeBytes) : "--"}</span>
              </div>
            </div>
            <div className="api-response-actions">
              <button
                className="icon-button secondary"
                type="button"
                disabled={!response}
                onClick={() => setActiveResponseTab("Pretty")}
              >
                <Sparkles size={14} />
              </button>
              <button
                className="icon-button secondary"
                type="button"
                disabled={!response}
                onClick={() => void copyCurrentResponse()}
              >
                <Copy size={14} />
              </button>
              <button
                className="icon-button secondary"
                type="button"
                disabled={!response}
                onClick={downloadResponse}
              >
                <Download size={14} />
              </button>
            </div>
          </header>

          <div className="api-response-tabs-row">
            <div className="api-tabs" role="tablist" aria-label="Response view">
              {(["Pretty", "Raw", "Headers", "Cookies"] as const).map((tab) => (
                <button
                  className={tab === activeResponseTab ? "active" : undefined}
                  type="button"
                  role="tab"
                  aria-selected={tab === activeResponseTab}
                  key={tab}
                  onClick={() => setActiveResponseTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          {activeResponseTab === "Headers" && response ? (
            <ResponseHeadersTable response={response} />
          ) : activeResponseTab === "Cookies" && response ? (
            <ResponseCookiesTable response={response} />
          ) : (
            <div className="api-code-editor" aria-label="Response body">
              {requestError ? (
                <div className="api-response-message invalid">
                  <AlertCircle size={16} />
                  <span>{requestError}</span>
                </div>
              ) : !response ? (
                <div className="api-response-placeholder">
                  Send a request to inspect the response.
                </div>
              ) : responseLines.length === 0 ? (
                <div className="api-response-placeholder">
                  No response body.
                </div>
              ) : (
                responseLines.map((line, index) => (
                  <div className="api-code-line" key={`${index}-${line}`}>
                    <span className="api-code-number">{index + 1}</span>
                    <code>{highlightJsonLine(line)}</code>
                  </div>
                ))
              )}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function ApiTesterHistoryView({
  history,
  storageScopeId,
  onFeedback,
  onRerun,
  onClearHistory,
}: {
  history: ApiTesterHistoryMetadata[];
  storageScopeId: string;
  onFeedback?: (message: string, tone: "valid" | "invalid" | "warning") => void;
  onRerun: (
    record: ApiTesterHistoryMetadata,
  ) => Promise<ApiTesterHistoryMetadata | null>;
  onClearHistory: () => void;
}): JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] =
    useState<ApiTesterHistoryDetail | null>(null);
  const [clearHistoryConfirmOpen, setClearHistoryConfirmOpen] = useState(false);
  const [historyColumnWidths, setHistoryColumnWidths] = useState<
    Partial<Record<ApiHistoryColumnKey, number>>
  >(() => readHistoryColumnWidths(storageScopeId));
  const historyScrollRef = useRef<HTMLDivElement>(null);
  const historyColumnDragRef = useRef<ApiHistoryColumnDragState | null>(null);
  const historyColumnResizeFrameRef = useRef<number | null>(null);
  const [historyScrollWidth, setHistoryScrollWidth] = useState(0);

  const resolvedHistoryColumns = useMemo(
    () => resolveHistoryColumns(historyColumnWidths, historyScrollWidth),
    [historyColumnWidths, historyScrollWidth],
  );
  const historyTableWidth = resolvedHistoryColumns.reduce(
    (total, column) => total + column.width,
    0,
  );

  useEffect(() => {
    if (!selectedId || history.some((entry) => entry.id === selectedId)) {
      return;
    }
    setSelectedId(null);
    setSelectedDetail(null);
  }, [history, selectedId, storageScopeId]);

  useEffect(() => {
    setHistoryColumnWidths(readHistoryColumnWidths(storageScopeId));
  }, [storageScopeId]);

  useEffect(() => {
    const element = historyScrollRef.current;
    if (!element) {
      return undefined;
    }

    const updateWidth = (): void => {
      setHistoryScrollWidth(Math.floor(element.clientWidth));
    };

    updateWidth();
    if (!window.ResizeObserver) {
      window.addEventListener("resize", updateWidth);
      return () => window.removeEventListener("resize", updateWidth);
    }

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      if (historyColumnResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(historyColumnResizeFrameRef.current);
      }
    };
  }, []);

  function selectHistoryEntry(entryId: string): void {
    setSelectedId(entryId);
    setSelectedDetail(readHistoryDetail(storageScopeId, entryId));
  }

  async function rerunHistoryEntry(
    entry: ApiTesterHistoryMetadata,
  ): Promise<void> {
    const nextMetadata = await onRerun(entry);
    if (!nextMetadata) {
      return;
    }

    setSelectedId(nextMetadata.id);
    setSelectedDetail(readHistoryDetail(storageScopeId, nextMetadata.id));
  }

  function startHistoryColumnResize(
    column: ApiHistoryColumn,
    event: PointerEvent<HTMLSpanElement>,
  ): void {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const currentWidth =
      resolvedHistoryColumns.find((item) => item.key === column.key)?.width ??
      column.width;
    historyColumnDragRef.current = {
      key: column.key,
      startX: event.clientX,
      startWidth: currentWidth,
      nextWidth: currentWidth,
    };
  }

  function resizeHistoryColumn(event: PointerEvent<HTMLSpanElement>): void {
    const drag = historyColumnDragRef.current;
    if (!drag) {
      return;
    }

    const column = API_HISTORY_COLUMNS.find((item) => item.key === drag.key);
    if (!column) {
      return;
    }

    drag.nextWidth = Math.max(
      column.minWidth,
      drag.startWidth + event.clientX - drag.startX,
    );

    if (historyColumnResizeFrameRef.current !== null) {
      return;
    }

    historyColumnResizeFrameRef.current = window.requestAnimationFrame(() => {
      historyColumnResizeFrameRef.current = null;
      const latestDrag = historyColumnDragRef.current;
      if (!latestDrag) {
        return;
      }
      setHistoryColumnWidths((current) => ({
        ...current,
        [latestDrag.key]: latestDrag.nextWidth,
      }));
    });
  }

  function stopHistoryColumnResize(event: PointerEvent<HTMLSpanElement>): void {
    if (
      historyColumnDragRef.current &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const drag = historyColumnDragRef.current;
    if (historyColumnResizeFrameRef.current !== null) {
      window.cancelAnimationFrame(historyColumnResizeFrameRef.current);
      historyColumnResizeFrameRef.current = null;
    }
    historyColumnDragRef.current = null;
    if (drag) {
      const next = {
        ...historyColumnWidths,
        [drag.key]: drag.nextWidth,
      };
      setHistoryColumnWidths(next);
      writeHistoryColumnWidths(storageScopeId, next);
    }
  }

  function resetHistoryColumnWidth(column: ApiHistoryColumn): void {
    const next = { ...historyColumnWidths };
    delete next[column.key];
    setHistoryColumnWidths(next);
    writeHistoryColumnWidths(storageScopeId, next);
  }

  const selectedMetadata =
    history.find((entry) => entry.id === selectedId) ?? null;

  return (
    <section
      className={`api-tester-history-screen${
        selectedMetadata ? " has-detail" : ""
      }`}
    >
      <Panel
        title="API Test History"
        className="database-history-panel api-history-panel"
        action={
          <button
            className="icon-button secondary compact"
            type="button"
            title="Clear API test history"
            aria-label="Clear API test history"
            disabled={history.length === 0}
            onClick={() => setClearHistoryConfirmOpen(true)}
          >
            <BrushCleaning size={14} />
          </button>
        }
      >
        <div className="database-history-scroll" ref={historyScrollRef}>
          <table
            className="recent-builds-table database-history-table api-history-table"
            style={{
              width: `${historyTableWidth}px`,
              minWidth: `${historyTableWidth}px`,
            }}
          >
            <colgroup>
              {resolvedHistoryColumns.map((column) => (
                <col key={column.key} style={{ width: `${column.width}px` }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {resolvedHistoryColumns.map((column) => (
                  <th key={column.key}>
                    <span className="database-result-th-content api-history-th-content">
                      <span className="database-result-column-label">
                        {column.label}
                      </span>
                      <span
                        className="database-column-resize-handle api-history-column-resize-handle"
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={`Resize ${column.label} column`}
                        onPointerDown={(event) =>
                          startHistoryColumnResize(column, event)
                        }
                        onPointerMove={resizeHistoryColumn}
                        onPointerUp={stopHistoryColumnResize}
                        onPointerCancel={stopHistoryColumnResize}
                        onDoubleClick={() => resetHistoryColumnWidth(column)}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <ArrowLeftRight size={13} />
                      </span>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.map((entry) => {
                const canRerun = isSuccessfulApiHistoryRecord(entry);

                return (
                  <tr
                    key={entry.id}
                    className={
                      entry.id === selectedId
                        ? "recent-build-row-active"
                        : undefined
                    }
                    onClick={() => selectHistoryEntry(entry.id)}
                  >
                    <td>{formatCompactDateTime(entry.createdAt)}</td>
                    <td>
                      <span
                        className={`api-history-method ${entry.method.toLowerCase()}`}
                      >
                        {entry.method}
                      </span>
                    </td>
                    <td className="api-history-url-cell" title={entry.url}>
                      {entry.url}
                    </td>
                    <td>
                      <span
                        className={`status-pill ${
                          entry.status !== null && entry.status < 400
                            ? "success"
                            : "failed"
                        }`}
                      >
                        {entry.status === null ? "Error" : entry.status}
                      </span>
                    </td>
                    <td>
                      {entry.durationMs === null
                        ? "--"
                        : `${entry.durationMs} ms`}
                    </td>
                    <td>
                      {entry.responseSizeBytes === null
                        ? "--"
                        : formatBytes(entry.responseSizeBytes)}
                    </td>
                    <td className="database-history-message-cell">
                      {entry.message}
                    </td>
                    <td>
                      <button
                        className="icon-button secondary database-history-rerun"
                        type="button"
                        aria-label={`Re-run API test from ${formatCompactDateTime(entry.createdAt)}`}
                        title={
                          canRerun
                            ? "Re-run API test"
                            : "Only successful API tests can be re-run"
                        }
                        disabled={!canRerun}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (!canRerun) {
                            return;
                          }
                          void rerunHistoryEntry(entry);
                        }}
                      >
                        <Redo2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {history.length === 0 ? (
            <p className="database-empty-state">No API tests yet.</p>
          ) : null}
        </div>
        <div className="table-footer">
          <span>Showing {history.length} API tests</span>
          <span>Newest first</span>
        </div>
      </Panel>
      {selectedMetadata ? (
        <ApiTesterHistoryDetailPanel
          key={selectedMetadata.id}
          metadata={selectedMetadata}
          detail={selectedDetail}
          onFeedback={onFeedback}
          onClose={() => {
            setSelectedId(null);
            setSelectedDetail(null);
          }}
        />
      ) : null}
      {clearHistoryConfirmOpen ? (
        <ConfirmDialog
          title="Clear API Test History?"
          message="Clearing API test history is irreversible and will remove every saved request and response detail."
          confirmLabel="Continue"
          onClose={() => setClearHistoryConfirmOpen(false)}
          onConfirm={() => {
            setSelectedId(null);
            setSelectedDetail(null);
            onClearHistory();
          }}
        />
      ) : null}
    </section>
  );
}

function ApiTesterHistoryDetailPanel({
  metadata,
  detail,
  onFeedback,
  onClose,
}: {
  metadata: ApiTesterHistoryMetadata | null;
  detail: ApiTesterHistoryDetail | null;
  onFeedback?: (message: string, tone: "valid" | "invalid" | "warning") => void;
  onClose: () => void;
}): JSX.Element {
  async function copyDetailText(text: string, label: string): Promise<void> {
    if (!text) {
      return;
    }
    try {
      await navigator.clipboard?.writeText(text);
      onFeedback?.(`${label} copied`, "valid");
    } catch {
      onFeedback?.("Copy failed", "invalid");
    }
  }

  return (
    <Panel
      title="History Detail"
      className="api-history-detail-panel"
      action={
        <button
          className="icon-button secondary"
          type="button"
          title="Close detail"
          aria-label="Close detail"
          onClick={onClose}
        >
          <X size={14} />
        </button>
      }
    >
      {!metadata ? (
        <p className="database-empty-state">
          Select an API test to inspect it.
        </p>
      ) : !detail ? (
        <p className="database-empty-state">Stored detail is not available.</p>
      ) : (
        <div className="api-history-detail-scroll">
          <Panel
            title="Request"
            className="api-history-detail-section api-history-request-section"
          >
            <div className="api-history-detail-headers-scroll">
              <table className="api-param-table api-history-detail-headers api-history-summary-table">
                <colgroup>
                  <col className="api-history-summary-method-col" />
                  <col />
                  <col className="api-history-summary-time-col" />
                </colgroup>
                <thead>
                  <tr>
                    <th>Method</th>
                    <th>URL</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <strong className="api-history-method">
                        {metadata.method}
                      </strong>
                    </td>
                    <td>
                      <code title={metadata.url}>{metadata.url}</code>
                    </td>
                    <td>{formatCompactDateTime(metadata.createdAt)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <HistoryDetailBlock
              title="Body"
              action={
                <CopyDetailButton
                  label="Copy request body"
                  disabled={!detail.requestBodyPreview}
                  onClick={() =>
                    void copyDetailText(
                      detail.requestBodyPreview,
                      "Request body",
                    )
                  }
                />
              }
            >
              <HistoryBodyTable
                value={detail.requestBodyPreview}
                emptyMessage="No request body was stored."
              />
            </HistoryDetailBlock>
            <HistoryDetailBlock
              title={`Headers (${detail.requestHeaders.length})`}
              action={
                <CopyDetailButton
                  label="Copy request headers"
                  disabled={detail.requestHeaders.length === 0}
                  onClick={() =>
                    void copyDetailText(
                      formatHeadersForClipboard(detail.requestHeaders),
                      "Request headers",
                    )
                  }
                />
              }
            >
              <HistoryHeaderList headers={detail.requestHeaders} />
            </HistoryDetailBlock>
          </Panel>
          <Panel
            title="Response"
            titleMeta={
              <div className="api-history-detail-meta">
                <span
                  className={`status-pill ${
                    metadata.status !== null && metadata.status < 400
                      ? "success"
                      : "failed"
                  }`}
                >
                  {metadata.status === null ? "Error" : metadata.status}
                </span>
                <span>
                  {metadata.responseSizeBytes === null
                    ? "--"
                    : formatBytes(metadata.responseSizeBytes)}
                </span>
                <span>
                  {metadata.durationMs === null
                    ? "--"
                    : `${metadata.durationMs} ms`}
                </span>
              </div>
            }
            className="api-history-detail-section api-history-response-section"
          >
            <HistoryDetailBlock
              title="Body"
              action={
                <CopyDetailButton
                  label="Copy response body"
                  disabled={
                    detail.binaryResponseBody || !detail.responseBodyPreview
                  }
                  onClick={() =>
                    void copyDetailText(
                      detail.responseBodyPreview,
                      "Response body",
                    )
                  }
                />
              }
            >
              <HistoryBodyTable
                value={
                  detail.binaryResponseBody ? "" : detail.responseBodyPreview
                }
                emptyMessage="No response body was stored."
              />
            </HistoryDetailBlock>
            {detail.binaryResponseBody ? (
              <p className="api-history-detail-notice">
                Binary response body was not stored.
              </p>
            ) : null}
            {detail.responseBodyTruncated ? (
              <p className="api-history-detail-notice">
                Response body preview was truncated at{" "}
                {formatBytes(API_TESTER_BODY_PREVIEW_LIMIT_BYTES)}.
              </p>
            ) : null}
            <HistoryDetailBlock
              title={`Headers (${detail.responseHeaders.length})`}
              action={
                <CopyDetailButton
                  label="Copy response headers"
                  disabled={detail.responseHeaders.length === 0}
                  onClick={() =>
                    void copyDetailText(
                      formatHeadersForClipboard(detail.responseHeaders),
                      "Response headers",
                    )
                  }
                />
              }
            >
              <HistoryHeaderList headers={detail.responseHeaders} />
            </HistoryDetailBlock>
          </Panel>
        </div>
      )}
    </Panel>
  );
}

function HistoryHeaderList({
  headers,
}: {
  headers: ApiTesterResponseHeader[];
}): JSX.Element {
  if (headers.length === 0) {
    return <p className="api-history-detail-empty">No headers stored.</p>;
  }

  return (
    <div className="api-history-detail-headers-scroll">
      <table className="api-param-table api-history-detail-headers">
        <colgroup>
          <col className="api-history-header-name-col" />
          <col className="api-history-header-value-col" />
        </colgroup>
        <thead>
          <tr>
            <th>Header</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {headers.map((header) => (
            <tr key={`${header.name}-${header.value}`}>
              <td>{header.name}</td>
              <td>{header.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HistoryDetailBlock({
  title,
  action,
  children,
}: {
  title: string;
  action?: JSX.Element;
  children: JSX.Element;
}): JSX.Element {
  return (
    <div className="api-history-detail-block">
      <div className="api-history-detail-block-header">
        <span>{title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

function HistoryBodyTable({
  value,
  emptyMessage,
}: {
  value: string;
  emptyMessage: string;
}): JSX.Element {
  const rows = createHistoryBodyRows(value);

  return (
    <div className="api-history-body-scroll">
      <table className="api-param-table api-history-body">
        <colgroup>
          <col className="api-history-body-key-col" />
          <col className="api-history-body-value-col" />
        </colgroup>
        <thead>
          <tr>
            <th>Key</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={2} className="api-history-body-empty">
                {emptyMessage}
              </td>
            </tr>
          ) : null}
          {rows.map((row) => (
            <tr key={`${row.key}-${row.value}`}>
              <td>{row.key}</td>
              <td>
                <div className="api-history-body-value-scroll">{row.value}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function createHistoryBodyRows(body: string): Array<{
  key: string;
  value: string;
}> {
  const trimmedBody = body.trim();
  if (!trimmedBody) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmedBody) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((value, index) => ({
        key: String(index),
        value: formatHistoryBodyValue(value),
      }));
    }

    if (parsed && typeof parsed === "object") {
      return Object.entries(parsed as Record<string, unknown>).map(
        ([key, value]) => ({
          key,
          value: formatHistoryBodyValue(value),
        }),
      );
    }

    return [{ key: "Body", value: formatHistoryBodyValue(parsed) }];
  } catch {
    return [{ key: "Body", value: body }];
  }
}

function formatHistoryBodyValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined) {
    return "";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function ApiKeyValueEditor({
  rows,
  keyLabel,
  valueLabel,
  emptyLabel,
  onRowsChange,
}: {
  rows: ApiKeyValueRow[];
  keyLabel: string;
  valueLabel: string;
  emptyLabel: string;
  onRowsChange: (rows: ApiKeyValueRow[]) => void;
}): JSX.Element {
  function updateRow(rowId: string, updates: Partial<ApiKeyValueRow>): void {
    onRowsChange(
      rows.map((row) => (row.id === rowId ? { ...row, ...updates } : row)),
    );
  }

  return (
    <div className="api-param-table-wrap">
      <table className="api-param-table api-key-value-table">
        <thead>
          <tr>
            <th>On</th>
            <th>{keyLabel}</th>
            <th>{valueLabel}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4}>{emptyLabel}</td>
            </tr>
          ) : null}
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <button
                  className={`api-row-enabled${row.enabled ? " checked" : ""}`}
                  type="button"
                  aria-label={row.enabled ? "Disable row" : "Enable row"}
                  onClick={() => updateRow(row.id, { enabled: !row.enabled })}
                >
                  {row.enabled ? <Check size={12} /> : null}
                </button>
              </td>
              <td>
                <input
                  className="api-cell-input"
                  value={row.key}
                  aria-label={keyLabel}
                  onChange={(event) =>
                    updateRow(row.id, { key: event.target.value })
                  }
                />
              </td>
              <td>
                <input
                  className="api-cell-input"
                  value={row.value}
                  aria-label={valueLabel}
                  onChange={(event) =>
                    updateRow(row.id, { value: event.target.value })
                  }
                />
              </td>
              <td>
                <button
                  className="icon-button secondary api-row-delete"
                  type="button"
                  aria-label="Remove row"
                  onClick={() =>
                    onRowsChange(rows.filter((item) => item.id !== row.id))
                  }
                >
                  <Trash2 size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        className="button secondary compact api-add-param"
        type="button"
        onClick={() => onRowsChange([...rows, createRow()])}
      >
        <Plus size={14} />
        Add Row
      </button>
    </div>
  );
}

function ResponseHeadersTable({
  response,
}: {
  response: ApiTesterResponse;
}): JSX.Element {
  return (
    <div className="api-param-table-wrap">
      <table className="api-param-table api-response-table">
        <thead>
          <tr>
            <th>Header</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {response.headers.map((header) => (
            <tr key={header.name}>
              <td>{header.name}</td>
              <td>{header.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResponseCookiesTable({
  response,
}: {
  response: ApiTesterResponse;
}): JSX.Element {
  const cookies = response.headers.filter((header) =>
    header.name.toLowerCase().includes("cookie"),
  );

  return (
    <div className="api-param-table-wrap">
      <table className="api-param-table api-response-table">
        <thead>
          <tr>
            <th>Cookie Header</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {cookies.length === 0 ? (
            <tr>
              <td colSpan={2}>No cookies returned.</td>
            </tr>
          ) : null}
          {cookies.map((header) => (
            <tr key={header.name}>
              <td>{header.name}</td>
              <td>{header.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ApiTesterCookieButton({
  storageScopeId,
  onClick,
}: {
  storageScopeId: string;
  onClick: () => void;
}): JSX.Element {
  const activeCookies = readStoredCookies(storageScopeId).filter((c) =>
    c.name.trim(),
  );

  return (
    <button
      className="icon-button secondary header-settings-button api-cookie-trigger"
      type="button"
      aria-label="Cookie settings"
      title={
        activeCookies.length > 0
          ? `Cookies (${activeCookies.length} active)`
          : "Cookie settings"
      }
      onClick={onClick}
    >
      <Cookie size={18} />
      {activeCookies.length > 0 ? (
        <span className="api-cookie-badge">{activeCookies.length}</span>
      ) : null}
    </button>
  );
}

export function ApiTesterCookieModal({
  open,
  storageScopeId,
  onClose,
}: {
  open: boolean;
  storageScopeId: string;
  onClose: () => void;
}): JSX.Element {
  const [cookies, setCookies] = useState<ApiTesterCookieEntry[]>(() =>
    readStoredCookies(storageScopeId),
  );

  useEffect(() => {
    if (open) {
      setCookies(readStoredCookies(storageScopeId));
    }
  }, [open, storageScopeId]);

  function save(): void {
    writeStoredCookies(storageScopeId, cookies);
    onClose();
  }

  function updateCookie(
    id: string,
    field: "name" | "value",
    value: string,
  ): void {
    setCookies((current) =>
      current.map((c) => (c.id === id ? { ...c, [field]: value } : c)),
    );
  }

  function removeCookie(id: string): void {
    setCookies((current) => current.filter((c) => c.id !== id));
  }

  function addCookie(): void {
    setCookies((current) => [
      ...current,
      { id: createCookieEntryId(), name: "", value: "" },
    ]);
  }

  return (
    <Modal
      open={open}
      title="Cookie Settings"
      subtitle="API Tester"
      size="md"
      className="api-cookie-modal"
      contentClassName="api-cookie-modal-content"
      closeLabel="Close cookie settings"
      onClose={onClose}
    >
      <div className="database-connection-form">
        <section className="database-connection-section">
          <Panel
            title="Request Cookies"
            titleMeta={
              <span className="api-cookie-count-badge">
                {cookies.length}
              </span>
            }
            action={
              <button
                className="icon-button primary"
                type="button"
                aria-label="Add cookie"
                title="Add cookie"
                onClick={addCookie}
              >
                <Plus size={16} />
              </button>
            }
            className="api-cookie-panel-section"
          >
            <div className="api-cookie-table-wrap">
              <table className="api-cookie-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Value</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>

                <tbody>
                  {cookies.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="api-cookie-table-empty">
                        No cookies yet. Use the + button to add one.
                      </td>
                    </tr>
                  ) : null}

                  {cookies.map((cookie) => (
                    <tr key={cookie.id}>
                      <td>
                        <input
                          type="text"
                          placeholder="session_id"
                          value={cookie.name}
                          aria-label="Cookie name"
                          onChange={(event) =>
                            updateCookie(cookie.id, "name", event.target.value)
                          }
                        />
                      </td>

                      <td>
                        <input
                          type="text"
                          placeholder="abc123"
                          value={cookie.value}
                          aria-label="Cookie value"
                          onChange={(event) =>
                            updateCookie(cookie.id, "value", event.target.value)
                          }
                        />
                      </td>

                      <td className="api-cookie-table-remove-col">
                        <button
                          className="icon-button danger"
                          type="button"
                          aria-label="Remove cookie"
                          title="Remove cookie"
                          onClick={() => removeCookie(cookie.id)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </section>

        <div className="dialog-actions">
          <button
            className="button secondary compact"
            type="button"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="button primary compact"
            type="button"
            onClick={save}
          >
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}

function createCookieEntryId(): string {
  return `api-cookie-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function cookiesStorageKey(scopeId: string): string {
  return `${API_TESTER_COOKIES_STORAGE_KEY}:${sanitizeStorageScope(scopeId)}`;
}

function readStoredCookies(scopeId: string): ApiTesterCookieEntry[] {
  try {
    const raw = window.localStorage.getItem(cookiesStorageKey(scopeId));
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isApiTesterCookieEntry);
  } catch {
    return [];
  }
}

function writeStoredCookies(
  scopeId: string,
  cookies: ApiTesterCookieEntry[],
): void {
  window.localStorage.setItem(
    cookiesStorageKey(scopeId),
    JSON.stringify(cookies),
  );
}

function isApiTesterCookieEntry(value: unknown): value is ApiTesterCookieEntry {
  if (!value || typeof value !== "object") {
    return false;
  }
  const entry = value as Partial<ApiTesterCookieEntry>;
  return (
    typeof entry.id === "string" &&
    typeof entry.name === "string" &&
    typeof entry.value === "string"
  );
}

function createRow(
  key = "",
  value = "",
  enabled = key.length > 0,
): ApiKeyValueRow {
  return {
    id: `api-row-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    key,
    value,
    enabled,
  };
}

function readSavedRequest(): SavedApiTesterRequest | null {
  try {
    const raw = window.localStorage.getItem(API_TESTER_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as SavedApiTesterRequest;
    if (!API_METHODS.includes(parsed.method)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function readHistoryMetadata(scopeId: string): ApiTesterHistoryMetadata[] {
  try {
    const raw = window.localStorage.getItem(historyMetadataStorageKey(scopeId));
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(isApiTesterHistoryMetadata)
      .slice(0, API_TESTER_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function writeHistoryMetadata(
  scopeId: string,
  metadata: ApiTesterHistoryMetadata[],
): void {
  window.localStorage.setItem(
    historyMetadataStorageKey(scopeId),
    JSON.stringify(metadata),
  );
}

function readHistoryColumnWidths(
  scopeId: string,
): Partial<Record<ApiHistoryColumnKey, number>> {
  try {
    const raw = window.localStorage.getItem(
      historyColumnWidthsStorageKey(scopeId),
    );
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    return API_HISTORY_COLUMNS.reduce<
      Partial<Record<ApiHistoryColumnKey, number>>
    >((widths, column) => {
      const width = (parsed as Partial<Record<ApiHistoryColumnKey, unknown>>)[
        column.key
      ];
      if (typeof width === "number" && Number.isFinite(width)) {
        widths[column.key] = normalizeHistoryColumnWidth(column, width);
      }
      return widths;
    }, {});
  } catch {
    return {};
  }
}

function writeHistoryColumnWidths(
  scopeId: string,
  widths: Partial<Record<ApiHistoryColumnKey, number>>,
): void {
  window.localStorage.setItem(
    historyColumnWidthsStorageKey(scopeId),
    JSON.stringify(widths),
  );
}

function normalizeHistoryColumnWidth(
  column: ApiHistoryColumn,
  width: number | undefined,
): number {
  return Math.max(column.minWidth, Math.round(width ?? column.width));
}

function resolveHistoryColumns(
  widths: Partial<Record<ApiHistoryColumnKey, number>>,
  availableWidth: number,
): ApiHistoryColumn[] {
  const columns = API_HISTORY_COLUMNS.map((column) => ({
    ...column,
    width: normalizeHistoryColumnWidth(column, widths[column.key]),
  }));
  const totalWidth = columns.reduce((total, column) => total + column.width, 0);
  const extraWidth = Math.max(0, availableWidth - totalWidth);
  if (extraWidth === 0) {
    return columns;
  }

  return columns.map((column) =>
    column.key === "url"
      ? { ...column, width: column.width + extraWidth }
      : column,
  );
}

function CopyDetailButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      className="icon-button secondary api-history-copy-button"
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Copy size={13} />
    </button>
  );
}

function saveHistoryDetail(
  scopeId: string,
  detail: ApiTesterHistoryDetail,
): void {
  window.localStorage.setItem(
    historyDetailStorageKey(scopeId, detail.id),
    JSON.stringify(detail),
  );
}

function readHistoryDetail(
  scopeId: string,
  id: string,
): ApiTesterHistoryDetail | null {
  try {
    const raw = window.localStorage.getItem(
      historyDetailStorageKey(scopeId, id),
    );
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return isApiTesterHistoryDetail(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function pruneHistoryDetails(
  scopeId: string,
  metadata: ApiTesterHistoryMetadata[],
): void {
  const retained = new Set(metadata.map((entry) => entry.id));
  const prefix = historyDetailStoragePrefix(scopeId);
  for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith(prefix) && !retained.has(key.slice(prefix.length))) {
      window.localStorage.removeItem(key);
    }
  }
}

function clearStoredHistory(scopeId: string): void {
  const prefix = historyDetailStoragePrefix(scopeId);
  for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith(prefix)) {
      window.localStorage.removeItem(key);
    }
  }
  window.localStorage.removeItem(historyMetadataStorageKey(scopeId));
}

function historyMetadataStorageKey(scopeId: string): string {
  return `${API_TESTER_HISTORY_METADATA_STORAGE_KEY}:${sanitizeStorageScope(scopeId)}`;
}

function historyColumnWidthsStorageKey(scopeId: string): string {
  return `${API_TESTER_HISTORY_COLUMN_WIDTHS_STORAGE_KEY}:${sanitizeStorageScope(scopeId)}`;
}

function historyDetailStoragePrefix(scopeId: string): string {
  return `${API_TESTER_HISTORY_DETAIL_STORAGE_PREFIX}${sanitizeStorageScope(scopeId)}:`;
}

function historyDetailStorageKey(scopeId: string, id: string): string {
  return `${historyDetailStoragePrefix(scopeId)}${id}`;
}

function sanitizeStorageScope(scopeId: string): string {
  return encodeURIComponent(scopeId || "global");
}

function isSuccessfulApiHistoryRecord(
  record: ApiTesterHistoryMetadata,
): boolean {
  return record.status !== null && record.status >= 200 && record.status < 300;
}

function isApiTesterHistoryMetadata(
  value: unknown,
): value is ApiTesterHistoryMetadata {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Partial<ApiTesterHistoryMetadata>;
  return (
    typeof record.id === "string" &&
    typeof record.createdAt === "string" &&
    typeof record.url === "string" &&
    typeof record.method === "string" &&
    API_METHODS.includes(record.method as ApiMethod) &&
    (typeof record.status === "number" || record.status === null) &&
    (typeof record.durationMs === "number" || record.durationMs === null) &&
    (typeof record.responseSizeBytes === "number" ||
      record.responseSizeBytes === null) &&
    typeof record.message === "string"
  );
}

function isApiTesterHistoryDetail(
  value: unknown,
): value is ApiTesterHistoryDetail {
  if (!value || typeof value !== "object") {
    return false;
  }
  const detail = value as Partial<ApiTesterHistoryDetail>;
  return (
    typeof detail.id === "string" &&
    Array.isArray(detail.requestHeaders) &&
    typeof detail.requestBodyPreview === "string" &&
    Array.isArray(detail.responseHeaders) &&
    typeof detail.responseBodyPreview === "string" &&
    typeof detail.responseBodyTruncated === "boolean" &&
    typeof detail.binaryResponseBody === "boolean"
  );
}

function createHistoryDetail(
  id: string,
  requestHeaders: Record<string, string>,
  request: ApiTesterRequestSnapshot,
  response: ApiTesterResponse,
): ApiTesterHistoryDetail {
  const binaryResponseBody = isBinaryResponse(response.headers);
  const responsePreview = binaryResponseBody
    ? { preview: "", truncated: false }
    : createBodyPreview(response.body);

  return {
    id,
    requestHeaders: maskHeaders(headersRecordToList(requestHeaders)),
    requestBodyPreview: canMethodSendBody(request.method)
      ? createBodyPreview(request.body).preview
      : "",
    responseHeaders: maskHeaders(response.headers),
    responseBodyPreview: responsePreview.preview,
    responseBodyTruncated: responsePreview.truncated,
    binaryResponseBody,
  };
}

function createErrorHistoryDetail(
  id: string,
  request: ApiTesterRequestSnapshot,
  message: string,
): ApiTesterHistoryDetail {
  return {
    id,
    requestHeaders: maskHeaders(
      headersRecordToList(
        buildRequestHeaders(
          request.headers,
          request.bearerToken,
          request.method,
          request.body,
        ),
      ),
    ),
    requestBodyPreview: canMethodSendBody(request.method)
      ? createBodyPreview(request.body).preview
      : "",
    responseHeaders: [],
    responseBodyPreview: message,
    responseBodyTruncated: false,
    binaryResponseBody: false,
  };
}

function createBodyPreview(body: string): {
  preview: string;
  truncated: boolean;
} {
  const bytes = new TextEncoder().encode(body);
  if (bytes.byteLength <= API_TESTER_BODY_PREVIEW_LIMIT_BYTES) {
    return { preview: body, truncated: false };
  }

  const truncatedBytes = bytes.slice(0, API_TESTER_BODY_PREVIEW_LIMIT_BYTES);
  return {
    preview: new TextDecoder().decode(truncatedBytes),
    truncated: true,
  };
}

function maskHeaders(
  headers: ApiTesterResponseHeader[],
): ApiTesterResponseHeader[] {
  return headers.map((header) => ({
    name: header.name,
    value: isSensitiveHeader(header.name)
      ? // "[masked]"
        header.value
      : header.value,
  }));
}

function isSensitiveHeader(name: string): boolean {
  return [
    "authorization",
    "cookie",
    "set-cookie",
    "x-api-key",
    "proxy-authorization",
  ].includes(name.trim().toLowerCase());
}

function headersRecordToList(
  headers: Record<string, string>,
): ApiTesterResponseHeader[] {
  return Object.entries(headers).map(([name, value]) => ({ name, value }));
}

function formatHeadersForClipboard(headers: ApiTesterResponseHeader[]): string {
  return headers.map((header) => `${header.name}: ${header.value}`).join("\n");
}

function isBinaryResponse(headers: ApiTesterResponseHeader[]): boolean {
  const contentType = headers
    .find((header) => header.name.toLowerCase() === "content-type")
    ?.value.toLowerCase();
  if (!contentType) {
    return false;
  }

  return !/^(text\/)|json|xml|javascript|x-www-form-urlencoded|graphql/.test(
    contentType,
  );
}

function createHistoryId(): string {
  return `api-history-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function sendApiTesterRequest(
  request: ApiTesterRequest,
): Promise<ApiTesterResponse> {
  const bridge = window.ivsDashboard as Partial<typeof window.ivsDashboard>;
  if (typeof bridge.sendApiTesterRequest === "function") {
    try {
      return await bridge.sendApiTesterRequest(request);
    } catch (error) {
      if (!isMissingApiTesterBridgeError(error)) {
        throw error;
      }
    }
  }

  return sendApiTesterRequestInRenderer(request);
}

async function sendApiTesterRequestInRenderer(
  request: ApiTesterRequest,
): Promise<ApiTesterResponse> {
  const method = request.method.trim().toUpperCase();
  const canHaveBody = method !== "GET" && method !== "HEAD";
  const requestBody =
    canHaveBody && request.bodyEncoding === "base64" && request.bodyBase64
      ? base64ToArrayBuffer(request.bodyBase64)
      : request.body;
  const startedAt = performance.now();
  const response = await fetch(request.url, {
    method,
    headers: request.headers,
    body: canHaveBody ? requestBody : undefined,
    redirect: "follow",
  });
  const body = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    url: response.url,
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    sizeBytes: new TextEncoder().encode(body).byteLength,
    headers: Array.from(response.headers.entries()).map(([name, value]) => ({
      name,
      value,
    })),
    body,
  };
}

function isMissingApiTesterBridgeError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /sendApiTesterRequest|apiTester:sendRequest|no handler registered/i.test(
    error.message,
  );
}

function buildRequestUrl(url: string, params: ApiKeyValueRow[]): string {
  const parsed = new URL(url.trim());
  params.forEach((param) => {
    const key = param.key.trim();
    if (param.enabled && key) {
      parsed.searchParams.set(key, param.value);
    }
  });
  return parsed.toString();
}

function buildRequestHeaders(
  rows: ApiKeyValueRow[],
  bearerToken: string,
  method: ApiMethod,
  body: string,
  contentType?: string,
): Record<string, string> {
  const headers: Record<string, string> = {};
  rows.forEach((row) => {
    const key = row.key.trim();
    if (row.enabled && key) {
      headers[key] = row.value;
    }
  });
  const trimmedToken = bearerToken.trim();
  if (trimmedToken) {
    headers.Authorization = `Bearer ${trimmedToken}`;
  }
  const hasContentType = Object.keys(headers).some(
    (key) => key.toLowerCase() === "content-type",
  );
  if (canMethodSendBody(method) && !hasContentType) {
    if (contentType) {
      headers["Content-Type"] = contentType;
    } else if (body.trim()) {
      headers["Content-Type"] = "application/json";
    }
  }
  return headers;
}

function buildRequestBody(request: ApiTesterRequestSnapshot):
  | {
      body?: string;
      bodyBase64?: string;
      bodyEncoding?: "utf8" | "base64";
      contentType?: string;
      textPreview: string;
    }
  | undefined {
  if (request.bodyMode === "media") {
    if (!request.mediaFile) {
      throw new Error("Choose a media file before sending this request.");
    }

    const boundary = `----ivs-dashboard-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;
    const fieldName = request.mediaFieldName?.trim() || "file";
    const parts: Uint8Array[] = [];
    const previewLines: string[] = [];

    (request.mediaFields ?? []).forEach((field) => {
      const key = field.key.trim();
      if (!field.enabled || !key) {
        return;
      }
      parts.push(
        utf8Bytes(
          `--${boundary}\r\nContent-Disposition: form-data; name="${escapeMultipartValue(
            key,
          )}"\r\n\r\n${field.value}\r\n`,
        ),
      );
      previewLines.push(`${key}: ${field.value}`);
    });

    parts.push(
      utf8Bytes(
        `--${boundary}\r\nContent-Disposition: form-data; name="${escapeMultipartValue(
          fieldName,
        )}"; filename="${escapeMultipartValue(
          request.mediaFile.name,
        )}"\r\nContent-Type: ${
          request.mediaFile.type || "application/octet-stream"
        }\r\n\r\n`,
      ),
      base64ToUint8Array(request.mediaFile.base64),
      utf8Bytes(`\r\n--${boundary}--\r\n`),
    );
    previewLines.push(
      `${fieldName}: ${request.mediaFile.name} (${request.mediaFile.type || "application/octet-stream"}, ${formatBytes(
        request.mediaFile.size,
      )})`,
    );

    return {
      bodyBase64: uint8ArrayToBase64(concatUint8Arrays(parts)),
      bodyEncoding: "base64",
      contentType: `multipart/form-data; boundary=${boundary}`,
      textPreview: [`multipart/form-data`, ...previewLines].join("\n"),
    };
  }

  return {
    body: request.body,
    textPreview: request.body,
  };
}

function canMethodSendBody(method: ApiMethod): boolean {
  return method !== "GET" && method !== "HEAD";
}

async function readMediaFile(file: File): Promise<ApiTesterMediaFile> {
  const buffer = await file.arrayBuffer();
  return {
    name: file.name,
    type: file.type,
    size: file.size,
    base64: uint8ArrayToBase64(new Uint8Array(buffer)),
  };
}

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function base64ToUint8Array(value: string): Uint8Array {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const bytes = base64ToUint8Array(value);
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  return window.btoa(binary);
}

function concatUint8Arrays(parts: Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((total, part) => total + part.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  parts.forEach((part) => {
    combined.set(part, offset);
    offset += part.length;
  });
  return combined;
}

function escapeMultipartValue(value: string): string {
  return value.replace(/["\r\n]/g, "_");
}

function getDisplayedResponseBody(
  response: ApiTesterResponse | null,
  tab: ApiResponseTab,
): string {
  if (!response || tab === "Headers" || tab === "Cookies") {
    return "";
  }
  if (tab === "Raw") {
    return response.body;
  }
  return formatPrettyResponseBody(response.body);
}

function formatPrettyResponseBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

function getResponseClipboardText(
  response: ApiTesterResponse | null,
  tab: ApiResponseTab,
): string {
  if (!response) {
    return "";
  }
  if (tab === "Headers") {
    return response.headers
      .map((header) => `${header.name}: ${header.value}`)
      .join("\n");
  }
  if (tab === "Cookies") {
    return response.headers
      .filter((header) => header.name.toLowerCase().includes("cookie"))
      .map((header) => `${header.name}: ${header.value}`)
      .join("\n");
  }
  return getDisplayedResponseBody(response, tab);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCompactDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function highlightJsonLine(line: string): JSX.Element {
  const keyMatch = line.match(/^(\s*)"([^"]+)"(.*)$/);
  if (!keyMatch) {
    return <>{line}</>;
  }

  const [, indent, key, rest] = keyMatch;
  return (
    <>
      {indent}
      <span className="json-key">"{key}"</span>
      {renderJsonRest(rest)}
    </>
  );
}

function renderJsonRest(rest: string): JSX.Element {
  const stringMatch = rest.match(/^(\s*:\s*)"([^"]*)"(.*)$/);
  if (stringMatch) {
    return (
      <>
        {stringMatch[1]}
        <span className="json-string">"{stringMatch[2]}"</span>
        {stringMatch[3]}
      </>
    );
  }

  const numberMatch = rest.match(/^(\s*:\s*)(\d+(?:\.\d+)?)(.*)$/);
  if (numberMatch) {
    return (
      <>
        {numberMatch[1]}
        <span className="json-number">{numberMatch[2]}</span>
        {numberMatch[3]}
      </>
    );
  }

  const booleanMatch = rest.match(/^(\s*:\s*)(true|false|null)(.*)$/);
  if (booleanMatch) {
    return (
      <>
        {booleanMatch[1]}
        <span className="json-boolean">{booleanMatch[2]}</span>
        {booleanMatch[3]}
      </>
    );
  }

  return <>{rest}</>;
}
