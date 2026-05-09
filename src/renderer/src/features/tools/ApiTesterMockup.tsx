import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import {
  AlertCircle,
  Check,
  Copy,
  Download,
  Eraser,
  Redo2,
  LoaderCircle,
  Plus,
  Save,
  Send,
  Settings,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  AppSelect,
  type AppSelectOption,
} from "../../components/common/AppSelect";
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
type ApiResponseTab = "Pretty" | "Raw" | "Headers" | "Cookies";
type ApiTesterView = "test" | "history";

type ApiPanelDragState = {
  startX: number;
  startBuilderWidth: number;
  minBuilderWidth: number;
  maxBuilderWidth: number;
};

type ApiKeyValueRow = {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
};

type SavedApiTesterRequest = {
  method: ApiMethod;
  url: string;
  params: ApiKeyValueRow[];
  headers: ApiKeyValueRow[];
  body: string;
  bearerToken: string;
};

type ApiTesterRequestSnapshot = SavedApiTesterRequest;

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
const API_METHOD_OPTIONS: Array<AppSelectOption<ApiMethod>> = API_METHODS.map(
  (value) => ({ value, label: value }),
);

const DEFAULT_PARAMS: ApiKeyValueRow[] = [
  createRow("expand", "profile", true),
  createRow("fields", "id,name,email,created_at", true),
];

const DEFAULT_HEADERS: ApiKeyValueRow[] = [
  createRow("Accept", "application/json", true),
];

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
      bearerToken,
    };
    window.localStorage.setItem(
      API_TESTER_STORAGE_KEY,
      JSON.stringify(nextRequest),
    );
    setSavedAt(new Date().toLocaleTimeString());
  }, [bearerToken, body, headers, method, params, url]);

  const writeHistory = useCallback(
    (
      metadata: ApiTesterHistoryMetadata,
      detail: ApiTesterHistoryDetail,
    ): void => {
      setHistory((current) => {
        const next = [metadata, ...current].slice(0, API_TESTER_HISTORY_LIMIT);
        saveHistoryDetail(storageScopeId, detail);
        writeHistoryMetadata(storageScopeId, next);
        pruneHistoryDetails(storageScopeId, next);
        return next;
      });
    },
    [storageScopeId],
  );

  const executeRequest = useCallback(
    async (snapshot: ApiTesterRequestSnapshot): Promise<void> => {
      setRequestError(null);
      setIsSending(true);

      let requestUrl = snapshot.url;
      const startedAt = performance.now();
      try {
        requestUrl = buildRequestUrl(snapshot.url, snapshot.params);
        const requestHeaders = buildRequestHeaders(
          snapshot.headers,
          snapshot.bearerToken,
          snapshot.method,
          snapshot.body,
        );
        const nextResponse = await sendApiTesterRequest({
          method: snapshot.method,
          url: requestUrl,
          headers: requestHeaders,
          body: canMethodSendBody(snapshot.method) ? snapshot.body : undefined,
          timeoutMs: 60000,
        });
        setResponse(nextResponse);
        setActiveResponseTab("Pretty");
        const historyId = createHistoryId();
        writeHistory(
          {
            id: historyId,
            method: snapshot.method,
            url: requestUrl,
            status: nextResponse.status,
            durationMs: nextResponse.durationMs,
            responseSizeBytes: nextResponse.sizeBytes,
            message: nextResponse.statusText,
            createdAt: new Date().toISOString(),
          },
          createHistoryDetail(
            historyId,
            requestHeaders,
            snapshot,
            nextResponse,
          ),
        );
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
      } finally {
        setIsSending(false);
      }
    },
    [writeHistory],
  );

  const sendRequest = useCallback(async (): Promise<void> => {
    await executeRequest({
      method,
      url,
      params,
      headers,
      body,
      bearerToken,
    });
  }, [bearerToken, body, executeRequest, headers, method, params, url]);

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

  function rerunHistoryRecord(record: ApiTesterHistoryMetadata): void {
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
    setBearerToken("");
    if (!canMethodSendBody(record.method) && activeBuilderTab === "Body") {
      setActiveBuilderTab("Params");
    }
    onViewChange?.("test");
    void executeRequest({
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
    setBearerToken("");
    setResponse(null);
    setRequestError(null);
    setSavedAt(null);
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
          showDots={false}
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
          disabled={isSending}
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
          >
            <Copy size={15} />
          </button>
          <button
            className="icon-button secondary"
            type="button"
            title="Save request"
            onClick={saveRequest}
          >
            <Save size={15} />
          </button>
          <button
            className="icon-button secondary"
            type="button"
            title="Clear"
            onClick={clearRequest}
          >
            <Eraser size={15} />
          </button>
          <button
            className="icon-button secondary"
            type="button"
            title="Auth settings"
            onClick={() => setActiveBuilderTab("Auth")}
          >
            <Settings size={15} />
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
              <textarea
                className="api-body-editor"
                value={body}
                spellCheck={false}
                aria-label="Request body"
                placeholder="Request body"
                onChange={(event) => setBody(event.target.value)}
              />
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
  onRerun: (record: ApiTesterHistoryMetadata) => void;
  onClearHistory: () => void;
}): JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] =
    useState<ApiTesterHistoryDetail | null>(null);

  useEffect(() => {
    if (!selectedId || history.some((entry) => entry.id === selectedId)) {
      return;
    }
    setSelectedId(null);
    setSelectedDetail(null);
  }, [history, selectedId, storageScopeId]);

  function selectHistoryEntry(entryId: string): void {
    setSelectedId(entryId);
    setSelectedDetail(readHistoryDetail(storageScopeId, entryId));
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
            className="button secondary compact"
            type="button"
            disabled={history.length === 0}
            onClick={onClearHistory}
          >
            Clear History
          </button>
        }
      >
        <div className="database-history-scroll">
          <table className="recent-builds-table database-history-table api-history-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Method</th>
                <th>URL</th>
                <th>Status</th>
                <th>Duration</th>
                <th>Size</th>
                <th>Message</th>
                <th>Re-run</th>
              </tr>
            </thead>
            <tbody>
              {history.map((entry) => (
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
                    <span className="api-history-method">{entry.method}</span>
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
                      title="Re-run API test"
                      onClick={(event) => {
                        event.stopPropagation();
                        onRerun(entry);
                      }}
                    >
                      <Redo2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
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
          <section className="api-history-detail-section api-history-request-section">
            <div className="api-history-detail-section-header">
              <h3>Request</h3>
            </div>
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
          </section>
          <section className="api-history-detail-section api-history-response-section">
            <div className="api-history-detail-section-header">
              <h3>Response</h3>
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
            </div>

            <HistoryDetailBlock title={`Body`}>
              <HistoryBodyTable
                label="Body"
                value={
                  detail.binaryResponseBody ? "" : detail.responseBodyPreview
                }
                emptyMessage="No response body was stored."
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
          </section>
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
  label,
  value,
  emptyMessage,
  action,
}: {
  label: string;
  value: string;
  emptyMessage: string;
  action?: JSX.Element;
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
          {rows.map((row) => (
            <tr key={`${row.key}-${row.value}`}>
              <td>{row.key}</td>
              <td>{row.value}</td>
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

function historyDetailStoragePrefix(scopeId: string): string {
  return `${API_TESTER_HISTORY_DETAIL_STORAGE_PREFIX}${sanitizeStorageScope(scopeId)}:`;
}

function historyDetailStorageKey(scopeId: string, id: string): string {
  return `${historyDetailStoragePrefix(scopeId)}${id}`;
}

function sanitizeStorageScope(scopeId: string): string {
  return encodeURIComponent(scopeId || "global");
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
    value: isSensitiveHeader(header.name) ? "[masked]" : header.value,
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
  const startedAt = performance.now();
  const response = await fetch(request.url, {
    method,
    headers: request.headers,
    body: canHaveBody ? request.body : undefined,
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
  if (canMethodSendBody(method) && body.trim() && !hasContentType) {
    headers["Content-Type"] = "application/json";
  }
  return headers;
}

function canMethodSendBody(method: ApiMethod): boolean {
  return method !== "GET" && method !== "HEAD";
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
