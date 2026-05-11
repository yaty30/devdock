import {
  Clipboard,
  Copy,
  Download,
  Eraser,
  File as FileIcon,
  FileUp,
  Hash,
  Image,
  Type,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import {
  AppSelect,
  type AppSelectOption,
} from "../../components/common/AppSelect";

type Base64Mode = "encode" | "decode";
type Base64Payload = "string" | "media";
export type CryptographicToolTab = "base64" | "hashing" | "unicode";
type UnicodeMode = "value-to-unicode" | "unicode-to-value";
type HashAlgorithm = "SHA-1" | "SHA-128" | "SHA-256" | "SHA-384" | "SHA-512";
type Base64MediaMetadata = {
  fileName: string;
  sourceSize: number;
  dimensions: string | null;
};
type Base64MediaPreviewDetails = {
  dataUrl: string;
  mimeType: string;
  fileName: string | null;
  size: number | null;
};
type ParsedDataUrl = {
  mimeType: string;
  base64: string;
  fileName: string | null;
};

const UNICODE_DIRECTION_OPTIONS: Array<AppSelectOption<UnicodeMode>> = [
  { value: "value-to-unicode", label: "Text to Unicode" },
  { value: "unicode-to-value", label: "Unicode to Text" },
];

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();
const HASH_OPTIONS: Array<AppSelectOption<HashAlgorithm>> = [
  { value: "SHA-128", label: "SHA-128" },
  { value: "SHA-256", label: "SHA-256" },
  { value: "SHA-384", label: "SHA-384" },
  { value: "SHA-512", label: "SHA-512" },
  { value: "SHA-1", label: "SHA-1" },
];
const B64_OPTIONS: Array<AppSelectOption<Base64Mode>> = [
  { value: "encode", label: "Encode" },
  { value: "decode", label: "Decode" },
];

export function CryptographicTool({
  activeTab,
}: {
  activeTab: CryptographicToolTab;
}): JSX.Element {
  return (
    <section className="tools-screen cryptographic-tool-screen">
      <div className="cryptographic-tool-body">
        {activeTab === "base64" ? (
          <Base64Tool />
        ) : activeTab === "hashing" ? (
          <HashTool />
        ) : (
          <UnicodeTool />
        )}
      </div>
    </section>
  );
}

function Base64Tool(): JSX.Element {
  const [mode, setMode] = useState<Base64Mode>("encode");
  const [payload, setPayload] = useState<Base64Payload>("string");
  const [input, setInput] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [mediaMimeType, setMediaMimeType] = useState(
    "application/octet-stream",
  );
  const [mediaMetadata, setMediaMetadata] =
    useState<Base64MediaMetadata | null>(null);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const result = useMemo(
    () => convertBase64(mode, payload, input, mediaMimeType),
    [input, mediaMimeType, mode, payload],
  );
  const parsedInputDataUrl = useMemo(() => parseDataUrl(input), [input]);
  const resultMimeType = result.ok
    ? (parseDataUrl(result.value)?.mimeType ?? mediaMimeType)
    : mediaMimeType;
  const mediaInputPreviewDetails =
    payload === "media" && mode === "encode" && result.ok
      ? getBase64MediaPreviewDetails(
          result.value,
          resultMimeType,
          parsedInputDataUrl?.fileName ?? fileName,
          mediaMetadata?.sourceSize ?? null,
        )
      : null;
  const decodedFileName = getFileNameWithMimeExtension(
    parsedInputDataUrl?.fileName ?? fileName,
    resultMimeType,
  );
  const decodedMediaPreviewDetails =
    payload === "media" && mode === "decode" && result.ok
      ? getBase64MediaPreviewDetails(
          result.value,
          resultMimeType,
          decodedFileName,
          null,
        )
      : null;
  const canDownload =
    payload === "media" &&
    mode === "decode" &&
    result.ok &&
    Boolean(result.value);

  function clear(): void {
    setInput("");
    setFileName(null);
    setMediaMimeType("application/octet-stream");
    setMediaMetadata(null);
    setCopied(false);
  }

  async function pasteFromClipboard(): Promise<void> {
    const text = await navigator.clipboard?.readText();
    if (text !== undefined) {
      setInput(text);
      setFileName(null);
      setMediaMetadata(null);
      const parsed = parseDataUrl(text);
      if (parsed?.mimeType) {
        setMediaMimeType(parsed.mimeType);
      } else {
        setMediaMimeType("application/octet-stream");
      }
    }
  }

  async function copyOutput(): Promise<void> {
    if (!result.ok) {
      return;
    }
    await navigator.clipboard?.writeText(result.value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  function importFile(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    const mimeType = inferFileMimeType(file);
    setFileName(file.name);
    setMediaMimeType(mimeType);
    setMediaMetadata({
      fileName: file.name,
      sourceSize: file.size,
      dimensions: null,
    });
    if (payload === "media" && mode === "encode") {
      void readFileAsDataUrl(file).then((dataUrl) => {
        setInput(dataUrl);
        void readImageDimensions(dataUrl).then((dimensions) => {
          setMediaMetadata({
            fileName: file.name,
            sourceSize: file.size,
            dimensions,
          });
        });
      });
      return;
    }
    void readFileAsText(file).then(setInput);
  }

  function downloadMedia(): void {
    if (!canDownload) {
      return;
    }
    const anchor = document.createElement("a");
    anchor.href = result.value;
    anchor.download = getDecodedDownloadFileName(
      decodedMediaPreviewDetails?.fileName ?? fileName,
      resultMimeType,
    );
    anchor.click();
  }

  return (
    <div className="cryptographic-tool-pane">
      <ToolControls className="base64-controls-panel">
        <ControlGroup label="Mode">
          <AppSelect
            className="base64-mode-select"
            value={mode}
            options={B64_OPTIONS}
            onChange={setMode}
            ariaLabel="Base64 mode"
            minDropdownWidth={160}
            showDots={false}
          />
        </ControlGroup>
        <ControlGroup label="Input type">
          <SegmentedButton
            active={payload === "string"}
            label="String"
            icon={<Type size={14} />}
            onClick={() => setPayload("string")}
          />
          <SegmentedButton
            active={payload === "media"}
            label="Media"
            icon={<Image size={14} />}
            onClick={() => setPayload("media")}
          />
          <Base64MediaMetadataView
            visible={payload === "media"}
            fileName={fileName}
            mimeType={resultMimeType}
            input={input}
            output={result.ok ? result.value : ""}
            metadata={mediaMetadata}
          />
        </ControlGroup>
      </ToolControls>

      <div className="conversion-grid">
        {payload === "media" && mode === "encode" ? (
          <ToolMediaInputPane
            title={fileName ?? "Media"}
            details={mediaInputPreviewDetails}
            onImport={() =>
              mode === "encode" && payload === "media"
                ? fileInputRef.current?.click()
                : undefined
            }
            onPaste={() => void pasteFromClipboard()}
            onClear={clear}
          />
        ) : (
          <ToolTextPane
            title={fileName ?? (mode === "encode" ? "Source" : "Base64")}
            value={input}
            placeholder={getBase64Placeholder(mode, payload)}
            onChange={setInput}
            onImport={() =>
              mode === "encode" && payload === "media"
                ? fileInputRef.current?.click()
                : undefined
            }
            onPaste={() => void pasteFromClipboard()}
            onClear={clear}
          />
        )}
        <ResultPane
          title={mode === "encode" ? "Base64" : "Decoded"}
          value={result.ok ? result.value : ""}
          error={result.ok ? null : result.error}
          copied={copied}
          onCopy={() => void copyOutput()}
          action={
            canDownload ? (
              <button
                className="icon-button secondary"
                type="button"
                aria-label="Save decoded media as"
                title="Save As"
                onClick={downloadMedia}
              >
                <Download size={15} />
              </button>
            ) : null
          }
        >
          {payload === "media" && mode === "decode" && result.ok ? (
            <Base64MediaPreview
              details={decodedMediaPreviewDetails}
              emptyLabel="Decoded file preview"
            />
          ) : null}
        </ResultPane>
      </div>
      <input
        ref={fileInputRef}
        className="compare-file-input"
        type="file"
        onChange={importFile}
      />
    </div>
  );
}

function UnicodeTool(): JSX.Element {
  const [mode, setMode] = useState<UnicodeMode>("value-to-unicode");
  const [input, setInput] = useState("");
  const [copied, setCopied] = useState(false);
  const result = useMemo(() => convertUnicode(mode, input), [input, mode]);

  async function copyOutput(): Promise<void> {
    if (!result.ok) {
      return;
    }
    await navigator.clipboard?.writeText(result.value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="cryptographic-tool-pane">
      <ToolControls>
        <ControlGroup label="Direction">
          <AppSelect
            className="unicode-direction-select"
            value={mode}
            options={UNICODE_DIRECTION_OPTIONS}
            onChange={setMode}
            ariaLabel="Unicode conversion direction"
            minDropdownWidth={180}
            showDots={false}
          />
        </ControlGroup>
      </ToolControls>
      <div className="conversion-grid">
        <ToolTextPane
          title={mode === "value-to-unicode" ? "Text" : "Unicode"}
          value={input}
          placeholder={
            mode === "value-to-unicode" ? "Paste text" : "Paste Unicode values"
          }
          onChange={setInput}
          onPaste={() => void navigator.clipboard?.readText().then(setInput)}
          onClear={() => setInput("")}
        />
        <ResultPane
          title={mode === "value-to-unicode" ? "Unicode" : "Text"}
          value={result.ok ? result.value : ""}
          error={result.ok ? null : result.error}
          copied={copied}
          onCopy={() => void copyOutput()}
        />
      </div>
    </div>
  );
}

function HashTool(): JSX.Element {
  const [input, setInput] = useState("");
  const [algorithm, setAlgorithm] = useState<HashAlgorithm>("SHA-256");
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!input) {
      setOutput("");
      setError(null);
      return undefined;
    }
    void hashValue(input, algorithm)
      .then((value) => {
        if (!cancelled) {
          setOutput(value);
          setError(null);
        }
      })
      .catch((hashError) => {
        if (!cancelled) {
          setOutput("");
          setError(
            hashError instanceof Error ? hashError.message : "Hash failed",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [algorithm, input]);

  async function copyOutput(): Promise<void> {
    if (!output) {
      return;
    }
    await navigator.clipboard?.writeText(output);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="cryptographic-tool-pane">
      <ToolControls>
        <ControlGroup label="Algorithm">
          <Hash size={15} />
          <AppSelect
            className="hash-algorithm-select"
            value={algorithm}
            options={HASH_OPTIONS}
            onChange={setAlgorithm}
            ariaLabel="Hash algorithm"
            minDropdownWidth={160}
            showDots={false}
          />
        </ControlGroup>
      </ToolControls>
      <div className="conversion-grid">
        <ToolTextPane
          title="Value"
          value={input}
          placeholder="Paste a value to hash"
          onChange={setInput}
          onPaste={() => void navigator.clipboard?.readText().then(setInput)}
          onClear={() => setInput("")}
        />
        <ResultPane
          title={algorithm}
          value={output}
          error={error}
          copied={copied}
          onCopy={() => void copyOutput()}
        />
      </div>
    </div>
  );
}

function ToolIntro({
  title,
  description,
}: {
  title: string;
  description: string;
}): JSX.Element {
  return (
    <header className="crypto-tool-intro">
      <h2>{title}</h2>
      <p>{description}</p>
    </header>
  );
}

function ToolControls({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div
      className={`crypto-controls-panel panel${className ? ` ${className}` : ""}`}
    >
      {children}
    </div>
  );
}

function ControlGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="crypto-control-group">
      <span className="crypto-control-label">{label}</span>
      <div className="crypto-control-fields">{children}</div>
    </div>
  );
}

function SegmentedButton({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon?: ReactNode;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      className={`tool-segment-button${active ? " active" : ""}`}
      type="button"
      aria-pressed={active}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function Base64MediaMetadataView({
  visible,
  fileName,
  mimeType,
  input,
  output,
  metadata,
}: {
  visible: boolean;
  fileName: string | null;
  mimeType: string;
  input: string;
  output: string;
  metadata: Base64MediaMetadata | null;
}): JSX.Element | null {
  const sourceSize = metadata?.sourceSize ?? getDataUriPayloadSize(input);
  const dataUriSize = output ? TEXT_ENCODER.encode(output).byteLength : null;
  const label =
    fileName ?? metadata?.fileName ?? getMediaMetadataLabel(mimeType);
  const details = [
    sourceSize === null ? null : formatByteCount(sourceSize),
    dataUriSize === null ? null : `${formatByteCount(dataUriSize)} URI`,
    metadata?.dimensions,
    mimeType && mimeType !== "application/octet-stream" ? mimeType : null,
  ].filter((detail): detail is string => Boolean(detail));
  const hasDetails = Boolean(input || output || fileName);

  return (
    <div
      className={`base64-media-metadata${visible && hasDetails ? "" : " empty"}`}
      title={details.join(" | ")}
      aria-hidden={!visible || !hasDetails}
    >
      <span className="base64-media-name">{label}</span>
      {details.map((detail) => (
        <span className="base64-media-detail" key={detail}>
          {detail}
        </span>
      ))}
    </div>
  );
}

function ToolTextPane({
  title,
  value,
  placeholder,
  onChange,
  onImport,
  onPaste,
  onClear,
}: {
  title: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onImport?: () => void;
  onPaste: () => void;
  onClear: () => void;
}): JSX.Element {
  return (
    <div className="conversion-pane panel">
      <div className="compare-pane-actions">
        <div className="compare-pane-title">
          <span>Input</span>
          <strong>{title}</strong>
        </div>
        <div>
          {onImport ? (
            <button
              className="icon-button secondary"
              type="button"
              aria-label="Import file"
              title="Import file"
              onClick={onImport}
            >
              <FileUp size={15} />
            </button>
          ) : null}
          <button
            className="icon-button secondary"
            type="button"
            aria-label="Paste"
            title="Paste"
            onClick={onPaste}
          >
            <Clipboard size={15} />
          </button>
          <button
            className="icon-button secondary"
            type="button"
            aria-label="Clear"
            title="Clear"
            onClick={onClear}
          >
            <Eraser size={15} />
          </button>
        </div>
      </div>
      <textarea
        className="conversion-pane-body conversion-textarea"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function ToolMediaInputPane({
  title,
  details,
  onImport,
  onPaste,
  onClear,
}: {
  title: string;
  details: Base64MediaPreviewDetails | null;
  onImport: () => void;
  onPaste: () => void;
  onClear: () => void;
}): JSX.Element {
  return (
    <div className="conversion-pane panel">
      <div className="compare-pane-actions">
        <div className="compare-pane-title">
          <span>Input</span>
          <strong>{title}</strong>
        </div>
        <div>
          <button
            className="icon-button secondary"
            type="button"
            aria-label="Import file"
            title="Import file"
            onClick={onImport}
          >
            <FileUp size={15} />
          </button>
          <button
            className="icon-button secondary"
            type="button"
            aria-label="Paste"
            title="Paste"
            onClick={onPaste}
          >
            <Clipboard size={15} />
          </button>
          <button
            className="icon-button secondary"
            type="button"
            aria-label="Clear"
            title="Clear"
            onClick={onClear}
          >
            <Eraser size={15} />
          </button>
        </div>
      </div>
      <div className="conversion-pane-body conversion-preview-body">
        <Base64MediaPreview
          details={details}
          emptyLabel="Import or paste media"
          genericLabel="Media source"
        />
      </div>
    </div>
  );
}

function ResultPane({
  title,
  value,
  error,
  copied,
  onCopy,
  action,
  children,
}: {
  title: string;
  value: string;
  error: string | null;
  copied: boolean;
  onCopy: () => void;
  action?: ReactNode;
  children?: ReactNode;
}): JSX.Element {
  return (
    <div className="conversion-pane panel">
      <div className="compare-pane-actions">
        <div className="compare-pane-title">
          <span>Output</span>
          <strong>{title}</strong>
        </div>
        <div>
          {action}
          <button
            className="icon-button secondary"
            type="button"
            aria-label="Copy output"
            title={copied ? "Copied" : "Copy output"}
            disabled={!value || Boolean(error)}
            onClick={onCopy}
          >
            <Copy size={15} />
          </button>
        </div>
      </div>
      {error ? (
        <div className="conversion-pane-body conversion-error">{error}</div>
      ) : children ? (
        <div className="conversion-pane-body conversion-preview-body">
          {children}
        </div>
      ) : (
        <pre className="conversion-pane-body conversion-result-text">
          {value}
        </pre>
      )}
    </div>
  );
}

function Base64MediaPreview({
  details,
  emptyLabel,
  genericLabel = "Decoded file",
}: {
  details: Base64MediaPreviewDetails | null;
  emptyLabel: string;
  genericLabel?: string;
}): JSX.Element {
  if (!details) {
    return <div className="conversion-media-placeholder">{emptyLabel}</div>;
  }
  const { dataUrl, mimeType, fileName, size } = details;
  if (mimeType.startsWith("image/")) {
    return <img className="conversion-media-preview" src={dataUrl} alt="" />;
  }
  if (mimeType.startsWith("video/")) {
    return (
      <video className="conversion-media-preview" src={dataUrl} controls />
    );
  }
  if (mimeType.startsWith("audio/")) {
    return (
      <audio className="conversion-audio-preview" src={dataUrl} controls />
    );
  }
  return (
    <GenericFilePreview
      fileName={fileName ?? genericLabel}
      mimeType={mimeType}
      size={size}
    />
  );
}

function GenericFilePreview({
  fileName,
  mimeType,
  size,
}: {
  fileName: string | null;
  mimeType: string;
  size: number | null;
}): JSX.Element {
  return (
    <div className="conversion-file-preview">
      <FileIcon size={34} />
      <strong>{fileName ?? "Decoded file"}</strong>
      <span>{mimeType || "application/octet-stream"}</span>
      {size === null ? null : <span>{formatByteCount(size)}</span>}
    </div>
  );
}

function convertBase64(
  mode: Base64Mode,
  payload: Base64Payload,
  input: string,
  fallbackMimeType: string,
): { ok: true; value: string } | { ok: false; error: string } {
  if (!input.trim()) {
    return { ok: true, value: "" };
  }
  try {
    if (mode === "encode") {
      if (payload === "media") {
        const parsed = parseDataUrl(input);
        const base64 = parsed?.base64 ?? input.trim();
        const bytes = base64ToBytes(base64);
        const mimeType = getBestMimeType(
          parsed?.mimeType,
          bytes,
          fallbackMimeType,
        );
        return { ok: true, value: buildDataUri(mimeType, base64) };
      }
      return { ok: true, value: bytesToBase64(TEXT_ENCODER.encode(input)) };
    }

    const parsed = parseDataUrl(input);
    const bytes = base64ToBytes(parsed?.base64 ?? input);
    if (payload === "media") {
      const mimeType = getBestMimeType(
        parsed?.mimeType,
        bytes,
        fallbackMimeType,
      );
      return {
        ok: true,
        value: `data:${mimeType};base64,${bytesToBase64(bytes)}`,
      };
    }
    return { ok: true, value: TEXT_DECODER.decode(bytes) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Conversion failed",
    };
  }
}

function buildDataUri(mimeType: string, base64: string): string {
  return `data:${mimeType || "application/octet-stream"};base64,${base64.replace(/\s+/g, "")}`;
}

function convertUnicode(
  mode: UnicodeMode,
  input: string,
): { ok: true; value: string } | { ok: false; error: string } {
  if (!input) {
    return { ok: true, value: "" };
  }
  try {
    if (mode === "value-to-unicode") {
      return {
        ok: true,
        value: Array.from(input)
          .map(
            (character) =>
              `U+${character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0")}`,
          )
          .join(" "),
      };
    }
    return { ok: true, value: unicodeTokensToValue(input) };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Unicode conversion failed",
    };
  }
}

function unicodeTokensToValue(input: string): string {
  const normalized = input
    .replace(/\\u\{([0-9a-fA-F]+)\}/g, " U+$1 ")
    .replace(/\\u([0-9a-fA-F]{4})/g, " U+$1 ")
    .replace(/0x([0-9a-fA-F]+)/g, " U+$1 ")
    .replace(/U\+([0-9a-fA-F]+)/gi, " U+$1 ");
  const tokens = normalized.split(/[\s,;]+/).filter(Boolean);
  return tokens
    .map((token) => {
      const hex = token.replace(/^U\+/i, "");
      if (!/^[0-9a-fA-F]+$/.test(hex)) {
        throw new Error(`Invalid Unicode value: ${token}`);
      }
      return String.fromCodePoint(Number.parseInt(hex, 16));
    })
    .join("");
}

async function hashValue(
  value: string,
  algorithm: HashAlgorithm,
): Promise<string> {
  const digestAlgorithm = algorithm === "SHA-128" ? "SHA-256" : algorithm;
  const digest = await crypto.subtle.digest(
    digestAlgorithm,
    TEXT_ENCODER.encode(value),
  );
  const bytes = new Uint8Array(digest);
  const selectedBytes = algorithm === "SHA-128" ? bytes.slice(0, 16) : bytes;
  return Array.from(selectedBytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function parseDataUrl(value: string): ParsedDataUrl | null {
  const trimmed = value.trim();
  if (!trimmed.toLowerCase().startsWith("data:")) {
    return null;
  }
  const commaIndex = trimmed.indexOf(",");
  if (commaIndex < 0) {
    return null;
  }
  const header = trimmed.slice(5, commaIndex);
  const base64 = trimmed.slice(commaIndex + 1);
  const parameters = header.split(";").filter(Boolean);
  const hasBase64Marker = parameters.some(
    (parameter) => parameter.toLowerCase() === "base64",
  );
  if (!hasBase64Marker) {
    return null;
  }
  const mimeCandidate = parameters.find(
    (parameter) =>
      !parameter.includes("=") &&
      parameter.toLowerCase() !== "base64" &&
      parameter.includes("/"),
  );
  const fileNameParameter = parameters.find((parameter) =>
    /^(?:file)?name=/i.test(parameter),
  );
  return {
    mimeType: mimeCandidate || "application/octet-stream",
    base64,
    fileName: fileNameParameter
      ? decodeDataUrlParameter(fileNameParameter.split("=").slice(1).join("="))
      : null,
  };
}

function decodeDataUrlParameter(value: string): string {
  const unquoted = value.replace(/^"|"$/g, "");
  try {
    return decodeURIComponent(unquoted);
  } catch {
    return unquoted;
  }
}

function inferFileMimeType(file: File): string {
  if (file.type) {
    return file.type;
  }
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "ico") {
    return "image/x-icon";
  }
  if (extension === "svg") {
    return "image/svg+xml";
  }
  if (extension === "webp") {
    return "image/webp";
  }
  if (extension === "png") {
    return "image/png";
  }
  if (extension === "jpg" || extension === "jpeg") {
    return "image/jpeg";
  }
  if (extension === "gif") {
    return "image/gif";
  }
  if (extension === "mp4") {
    return "video/mp4";
  }
  if (extension === "webm") {
    return "video/webm";
  }
  if (extension === "mp3") {
    return "audio/mpeg";
  }
  if (extension === "wav") {
    return "audio/wav";
  }
  return "application/octet-stream";
}

function getDataUriPayloadSize(value: string): number | null {
  const parsed = parseDataUrl(value);
  if (!parsed) {
    return null;
  }
  return getBase64PayloadSize(parsed.base64);
}

function getBase64PayloadSize(value: string): number | null {
  try {
    return base64ToBytes(value).byteLength;
  } catch {
    return null;
  }
}

function getBase64MediaPreviewDetails(
  value: string,
  fallbackMimeType: string,
  fileName: string | null,
  fallbackSize: number | null,
): Base64MediaPreviewDetails | null {
  if (!value.trim()) {
    return null;
  }
  const parsed = parseDataUrl(value);
  const base64 = parsed?.base64 ?? value;
  const size = fallbackSize ?? getBase64PayloadSize(base64);
  const mimeType = parsed?.mimeType ?? fallbackMimeType;
  return {
    dataUrl: buildDataUri(mimeType, base64),
    mimeType,
    fileName: parsed?.fileName ?? fileName,
    size,
  };
}

function getBestMimeType(
  explicitMimeType: string | undefined,
  bytes: Uint8Array,
  fallbackMimeType: string,
): string {
  if (explicitMimeType && explicitMimeType !== "application/octet-stream") {
    return explicitMimeType;
  }
  return (
    inferMimeTypeFromBytes(bytes) ??
    explicitMimeType ??
    (fallbackMimeType === "application/octet-stream"
      ? fallbackMimeType
      : "application/octet-stream")
  );
}

function inferMimeTypeFromBytes(bytes: Uint8Array): string | null {
  if (bytes.length >= 4) {
    if (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    ) {
      return "image/png";
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return "image/jpeg";
    }
    if (bytesToAscii(bytes, 0, 4) === "GIF8") {
      return "image/gif";
    }
    if (bytesToAscii(bytes, 0, 4) === "%PDF") {
      return "application/pdf";
    }
    if (bytesToAscii(bytes, 0, 4) === "OggS") {
      return "audio/ogg";
    }
  }
  if (bytes.length >= 12) {
    const riffType = bytesToAscii(bytes, 8, 12);
    if (bytesToAscii(bytes, 0, 4) === "RIFF" && riffType === "WEBP") {
      return "image/webp";
    }
    if (bytesToAscii(bytes, 0, 4) === "RIFF" && riffType === "WAVE") {
      return "audio/wav";
    }
    if (bytesToAscii(bytes, 4, 8) === "ftyp") {
      return "video/mp4";
    }
  }
  if (bytes.length >= 3 && bytesToAscii(bytes, 0, 3) === "ID3") {
    return "audio/mpeg";
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    return "audio/mpeg";
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return "video/webm";
  }
  const decodedStart = TEXT_DECODER.decode(bytes.slice(0, 256)).trimStart();
  if (decodedStart.startsWith("<svg") || decodedStart.startsWith("<?xml")) {
    return "image/svg+xml";
  }
  return null;
}

function bytesToAscii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

function getFileNameWithMimeExtension(
  fileName: string | null,
  mimeType: string,
): string | null {
  if (!fileName) {
    return null;
  }
  const extension = getFileExtensionForMimeType(mimeType);
  const sanitized = sanitizeFileName(fileName);
  const stem = sanitized.replace(/\.[a-zA-Z0-9]{1,12}$/, "");
  return `${stem || "decoded-file"}.${extension}`;
}

function getDecodedDownloadFileName(
  fileName: string | null,
  mimeType: string,
): string {
  const normalizedFileName = getFileNameWithMimeExtension(fileName, mimeType);
  if (normalizedFileName) {
    return `decoded-${normalizedFileName}`;
  }
  const extension = getFileExtensionForMimeType(mimeType);
  const stem =
    mimeType.startsWith("image/") ||
    mimeType.startsWith("video/") ||
    mimeType.startsWith("audio/")
      ? "decoded-media"
      : "decoded-file";
  return `${stem}.${extension}`;
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[\\/:*?"<>|]+/g, "-").trim();
}

function getFileExtensionForMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  const extensionMap: Record<string, string> = {
    "application/json": "json",
    "application/octet-stream": "bin",
    "application/pdf": "pdf",
    "audio/mpeg": "mp3",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/svg+xml": "svg",
    "image/webp": "webp",
    "image/x-icon": "ico",
    "text/plain": "txt",
    "video/mp4": "mp4",
    "video/webm": "webm",
  };
  if (extensionMap[normalized]) {
    return extensionMap[normalized];
  }
  const subtype = normalized.split("/")[1]?.split("+").pop();
  return subtype?.replace(/[^a-z0-9]/g, "") || "bin";
}

function getMediaMetadataLabel(mimeType: string): string {
  if (mimeType.startsWith("image/")) {
    return "Image media";
  }
  if (mimeType.startsWith("video/")) {
    return "Video media";
  }
  if (mimeType.startsWith("audio/")) {
    return "Audio media";
  }
  return "Media source";
}

function formatByteCount(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function readImageDimensions(dataUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const image = new window.Image();
    image.onload = () => {
      if (image.naturalWidth && image.naturalHeight) {
        resolve(`${image.naturalWidth}x${image.naturalHeight}`);
        return;
      }
      resolve(null);
    };
    image.onerror = () => resolve(null);
    image.src = dataUrl;
  });
}

function base64ToBytes(value: string): Uint8Array {
  const cleaned = value.replace(/\s+/g, "");
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () =>
      reject(reader.error ?? new Error("File read failed"));
    reader.readAsText(file);
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () =>
      reject(reader.error ?? new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}

function getBase64Placeholder(
  mode: Base64Mode,
  payload: Base64Payload,
): string {
  if (mode === "encode") {
    return payload === "media"
      ? "Import a media file or paste a data URL"
      : "Paste a string";
  }
  return payload === "media"
    ? "Paste base64 or a data URL"
    : "Paste base64 text";
}
