import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type UIEvent,
} from "react";
import {
  Image as ImageIcon,
  LoaderCircle,
  MessageCircle,
  Plus,
  Search,
  Send,
  Settings,
  Users,
  WifiOff,
  X,
} from "lucide-react";
import {
  AppSelect,
  type AppSelectOption,
} from "../../components/common/AppSelect";
import { Modal } from "../../components/dialogs/Modal";
import type {
  ChatConversation,
  ChatEvent,
  ChatMessage,
  ChatMessagePage,
  ChatServiceConfig,
  ChatUser,
  ChatUserProfile,
} from "../../types";

type ConnectionState = "setup" | "connecting" | "online" | "offline";
type ToastTone = "valid" | "invalid";

const MESSAGE_PAGE_SIZE = 50;
const RECONNECT_BASE_MS = 900;
const RECONNECT_MAX_MS = 10000;
const URL_PATTERN = /(https?:\/\/[^\s<]+[^\s<.,;:!?])/gi;

export function ChatFeature({
  onToast,
}: {
  onToast: (message: string, tone: ToastTone) => void;
}): JSX.Element {
  const [config, setConfig] = useState<ChatServiceConfig | null>(null);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("connecting");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [profileSettingsOpen, setProfileSettingsOpen] = useState(false);
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const [imagePreview, setImagePreview] = useState<ChatMessage | null>(null);
  const [users, setUsers] = useState<ChatUser[]>([]);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [conversationQuery, setConversationQuery] = useState("");
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [messagesByConversation, setMessagesByConversation] = useState<
    Record<string, ChatMessage[]>
  >({});
  const [hasMoreByConversation, setHasMoreByConversation] = useState<
    Record<string, boolean>
  >({});
  const [messageDrafts, setMessageDrafts] = useState<Record<string, string>>(
    {},
  );
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const activeConversationRef = useRef<string | null>(null);
  const drawerOpenRef = useRef(false);
  const configRef = useRef<ChatServiceConfig | null>(null);
  const conversationsRef = useRef<ChatConversation[]>([]);
  const chatButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    activeConversationRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    drawerOpenRef.current = drawerOpen;
  }, [drawerOpen]);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  const activeConversation = activeConversationId
    ? (conversations.find(
        (conversation) => conversation.id === activeConversationId,
      ) ?? null)
    : null;
  const activeMessages = activeConversationId
    ? (messagesByConversation[activeConversationId] ?? [])
    : [];
  const unreadTotal = conversations.reduce(
    (total, conversation) => total + conversation.unreadCount,
    0,
  );
  const filteredConversations = useMemo(() => {
    const query = conversationQuery.trim().toLowerCase();
    if (!query) return conversations;
    return conversations.filter((conversation) =>
      conversationLabel(conversation).toLowerCase().includes(query),
    );
  }, [conversationQuery, conversations]);

  useEffect(() => {
    let cancelled = false;
    async function bootChat(): Promise<void> {
      const nextConfig = await window.ivsDashboard.getChatConfig();
      if (cancelled) return;
      setConfig(nextConfig);
      configRef.current = nextConfig;
      if (hasChatProfileName(nextConfig.profile)) {
        await reconnectChat(nextConfig);
      } else {
        setConnectionState("setup");
      }
    }

    void bootChat().catch((error) => {
      console.error(error);
      if (!cancelled) {
        setConnectionState("offline");
      }
    });

    const unsubscribe = window.ivsDashboard.onChatOpenRequest(
      (conversationId) => {
        setDrawerOpen(true);
        setActiveConversationId(conversationId);
        const currentConfig = configRef.current;
        if (currentConfig && hasChatProfileName(currentConfig.profile)) {
          void loadMessages(currentConfig, conversationId);
          void markRead(currentConfig, conversationId);
        } else {
          setProfileSettingsOpen(true);
        }
      },
    );

    return () => {
      cancelled = true;
      unsubscribe();
      socketRef.current?.close();
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!drawerOpen || !activeConversationId || !config) return;
    if (!hasChatProfileName(config.profile)) return;
    if (!messagesByConversation[activeConversationId]) {
      void loadMessages(config, activeConversationId, undefined, true);
    }
    void markRead(config, activeConversationId);
  }, [drawerOpen, activeConversationId, config]);

  useEffect(() => {
    if (drawerOpen && config && !hasChatProfileName(config.profile)) {
      setProfileSettingsOpen(true);
    }
  }, [config, drawerOpen]);

  useEffect(() => {
    if (!drawerOpen || !activeConversationId) return;
    requestAnimationFrame(() => {
      const list = messageListRef.current;
      if (list) {
        list.scrollTop = list.scrollHeight;
      }
    });
  }, [drawerOpen, activeConversationId]);

  useEffect(() => {
    if (
      !drawerOpen ||
      profileSettingsOpen ||
      newConversationOpen ||
      imagePreview
    ) {
      return undefined;
    }

    function closeOnOutsidePointer(event: PointerEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (
        drawerRef.current?.contains(target) ||
        chatButtonRef.current?.contains(target)
      ) {
        return;
      }
      setDrawerOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [drawerOpen, imagePreview, newConversationOpen, profileSettingsOpen]);

  async function registerUser(nextConfig: ChatServiceConfig): Promise<void> {
    if (!hasChatProfileName(nextConfig.profile)) {
      throw new Error("Choose a chat username first.");
    }
    await chatJson<ChatUser>(nextConfig, "/users", {
      method: "POST",
      body: JSON.stringify(nextConfig.profile),
    });
  }

  async function loadUsers(nextConfig = config): Promise<void> {
    if (!nextConfig) return;
    const loadedUsers = await chatJson<ChatUser[]>(nextConfig, "/users");
    setUsers(loadedUsers);
  }

  async function loadConversations(nextConfig = config): Promise<void> {
    if (!nextConfig) return;
    const loadedConversations = await chatJson<ChatConversation[]>(
      nextConfig,
      `/conversations?userId=${encodeURIComponent(nextConfig.profile.userId)}`,
    );
    setConversations(sortConversations(loadedConversations));
    if (!activeConversationRef.current && loadedConversations.length > 0) {
      setActiveConversationId(loadedConversations[0].id);
    }
  }

  async function reconnectChat(nextConfig: ChatServiceConfig): Promise<void> {
    if (!hasChatProfileName(nextConfig.profile)) {
      setConnectionState("setup");
      setProfileSettingsOpen(true);
      return;
    }
    setConnectionState("connecting");
    try {
      await registerUser(nextConfig);
      await Promise.all([loadUsers(nextConfig), loadConversations(nextConfig)]);
      connect(nextConfig);
    } catch (error) {
      console.error(error);
      setConnectionState("offline");
    }
  }

  async function loadMessages(
    nextConfig: ChatServiceConfig,
    conversationId: string,
    before?: number,
    scrollToBottom = false,
  ): Promise<void> {
    const query = new URLSearchParams({
      userId: nextConfig.profile.userId,
      limit: String(MESSAGE_PAGE_SIZE),
    });
    if (before !== undefined) {
      query.set("before", String(before));
    }
    const page = await chatJson<ChatMessagePage>(
      nextConfig,
      `/conversations/${encodeURIComponent(conversationId)}/messages?${query}`,
    );
    setMessagesByConversation((current) => {
      const existing = before ? (current[conversationId] ?? []) : [];
      return {
        ...current,
        [conversationId]: mergeMessages([...page.messages, ...existing]),
      };
    });
    setHasMoreByConversation((current) => ({
      ...current,
      [conversationId]: page.hasMore,
    }));
    if (scrollToBottom) {
      requestAnimationFrame(() => {
        const list = messageListRef.current;
        if (list) list.scrollTop = list.scrollHeight;
      });
    }
  }

  async function loadOlderMessages(): Promise<void> {
    if (!config || !activeConversationId || loadingOlder) return;
    if (!hasMoreByConversation[activeConversationId]) return;
    const currentMessages = messagesByConversation[activeConversationId] ?? [];
    const firstMessage = currentMessages[0];
    if (!firstMessage) return;
    const list = messageListRef.current;
    const previousHeight = list?.scrollHeight ?? 0;
    setLoadingOlder(true);
    try {
      await loadMessages(config, activeConversationId, firstMessage.id);
      requestAnimationFrame(() => {
        const nextList = messageListRef.current;
        if (nextList) {
          nextList.scrollTop = nextList.scrollHeight - previousHeight;
        }
      });
    } finally {
      setLoadingOlder(false);
    }
  }

  async function markRead(
    nextConfig: ChatServiceConfig,
    conversationId: string,
  ): Promise<void> {
    await chatJson<{ unreadCount: number }>(
      nextConfig,
      `/conversations/${encodeURIComponent(conversationId)}/read`,
      {
        method: "POST",
        body: JSON.stringify({ userId: nextConfig.profile.userId }),
      },
    ).catch((error) => console.error(error));
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === conversationId
          ? { ...conversation, unreadCount: 0 }
          : conversation,
      ),
    );
  }

  function connect(nextConfig: ChatServiceConfig): void {
    socketRef.current?.close();
    setConnectionState("connecting");
    const socket = new WebSocket(
      `${nextConfig.wsUrl}?userId=${encodeURIComponent(nextConfig.profile.userId)}`,
    );
    socketRef.current = socket;
    socket.onopen = () => {
      reconnectAttemptRef.current = 0;
      setConnectionState("online");
      void loadUsers(nextConfig).catch((error) => console.error(error));
      void loadConversations(nextConfig).catch((error) => console.error(error));
    };
    socket.onmessage = (event) => {
      try {
        handleChatEvent(JSON.parse(event.data as string) as ChatEvent);
      } catch (error) {
        console.error(error);
      }
    };
    socket.onerror = () => {
      setConnectionState("offline");
    };
    socket.onclose = () => {
      if (socketRef.current !== socket) return;
      setConnectionState("offline");
      const attempt = reconnectAttemptRef.current + 1;
      reconnectAttemptRef.current = attempt;
      const delay = Math.min(
        RECONNECT_MAX_MS,
        RECONNECT_BASE_MS * Math.max(1, attempt),
      );
      reconnectTimerRef.current = window.setTimeout(
        () => connect(nextConfig),
        delay,
      );
    };
  }

  function handleChatEvent(event: ChatEvent): void {
    const nextConfig = configRef.current;
    if (!nextConfig) return;
    if (event.type === "user_presence_updated") {
      setUsers((current) =>
        sortUsers(upsertById(current, event.user, (user) => user.id)),
      );
      return;
    }
    if (event.type === "conversation_updated") {
      if (!event.conversation.memberIds.includes(nextConfig.profile.userId)) {
        return;
      }
      setConversations((current) =>
        sortConversations(
          upsertById(
            current,
            event.conversation,
            (conversation) => conversation.id,
          ),
        ),
      );
      return;
    }
    if (event.type === "read_state_updated") {
      if (event.userId === nextConfig.profile.userId) {
        setConversations((current) =>
          current.map((conversation) =>
            conversation.id === event.conversationId
              ? { ...conversation, unreadCount: event.unreadCount }
              : conversation,
          ),
        );
      }
      return;
    }
    if (event.type === "message_created") {
      const message = event.message;
      setMessagesByConversation((current) => ({
        ...current,
        [event.conversationId]: mergeMessages([
          ...(current[event.conversationId] ?? []),
          message,
        ]),
      }));
      const isOwn = message.senderUserId === nextConfig.profile.userId;
      const activeAndFocused =
        drawerOpenRef.current &&
        activeConversationRef.current === event.conversationId &&
        document.hasFocus();
      setConversations((current) =>
        sortConversations(
          current.map((conversation) =>
            conversation.id === event.conversationId
              ? {
                  ...conversation,
                  lastMessage: message,
                  updatedAt: message.createdAt,
                  unreadCount:
                    isOwn || activeAndFocused
                      ? conversation.unreadCount
                      : conversation.unreadCount + 1,
                }
              : conversation,
          ),
        ),
      );
      if (activeAndFocused) {
        void markRead(nextConfig, event.conversationId);
      }
      if (!isOwn && !activeAndFocused) {
        notifyIncomingMessage(event.conversationId, message);
      }
    }
  }

  function notifyIncomingMessage(
    conversationId: string,
    message: ChatMessage,
  ): void {
    const conversation = conversationsRef.current.find(
      (item) => item.id === conversationId,
    );
    const title = conversation ? conversationLabel(conversation) : "Chat";
    const body = messagePreview(message);
    if (document.hasFocus()) {
      if (!drawerOpenRef.current) {
        onToast(`${message.senderDisplayName}: ${body}`, "valid");
      }
      return;
    }
    void window.ivsDashboard.notifyChatMessage({
      conversationId,
      title,
      body: `${message.senderDisplayName}: ${body}`,
    });
  }

  async function sendMessage(event: FormEvent): Promise<void> {
    event.preventDefault();
    await submitActiveMessage();
  }

  async function submitActiveMessage(): Promise<void> {
    if (!config || !activeConversationId || sending) return;
    if (!requireChatProfile()) return;
    const body = (messageDrafts[activeConversationId] ?? "").trim();
    if (!body && !selectedImage) return;
    setSending(true);
    setSendError(null);
    try {
      let sent: ChatMessage;
      if (selectedImage) {
        sent = await chatImage(
          config,
          activeConversationId,
          selectedImage,
          body,
        );
      } else {
        sent = await chatJson<ChatMessage>(
          config,
          `/conversations/${encodeURIComponent(activeConversationId)}/messages`,
          {
            method: "POST",
            body: JSON.stringify({
              senderUserId: config.profile.userId,
              body,
            }),
          },
        );
      }
      setMessagesByConversation((current) => ({
        ...current,
        [activeConversationId]: mergeMessages([
          ...(current[activeConversationId] ?? []),
          sent,
        ]),
      }));
      setMessageDrafts((current) => ({
        ...current,
        [activeConversationId]: "",
      }));
      setSelectedImage(null);
      requestAnimationFrame(() => {
        const list = messageListRef.current;
        if (list) list.scrollTop = list.scrollHeight;
      });
      void loadConversations(config);
    } catch (error) {
      console.error(error);
      setSendError(
        error instanceof Error ? error.message : "Message could not be sent.",
      );
    } finally {
      setSending(false);
    }
  }

  function handleComposeKeyDown(
    event: KeyboardEvent<HTMLTextAreaElement>,
  ): void {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }

    event.preventDefault();
    void submitActiveMessage();
  }

  function handleMessageScroll(event: UIEvent<HTMLDivElement>): void {
    if (event.currentTarget.scrollTop < 80) {
      void loadOlderMessages();
    }
  }

  function handleImageChange(event: ChangeEvent<HTMLInputElement>): void {
    setSendError(null);
    if (!requireChatProfile()) {
      event.target.value = "";
      return;
    }
    const file = event.target.files?.[0] ?? null;
    if (!file) return;
    if (!isAllowedImage(file)) {
      setSendError("Only PNG, JPG, GIF, and WebP images can be sent.");
      event.target.value = "";
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setSendError("Images must be 10MB or smaller.");
      event.target.value = "";
      return;
    }
    setSelectedImage(file);
    event.target.value = "";
  }

  function openConversation(conversationId: string): void {
    if (!requireChatProfile()) return;
    setActiveConversationId(conversationId);
    if (config) {
      void loadMessages(config, conversationId, undefined, true);
      void markRead(config, conversationId);
    }
  }

  function openChatDrawer(): void {
    setDrawerOpen((current) => {
      const nextOpen = !current;
      if (nextOpen && config && !hasChatProfileName(config.profile)) {
        setProfileSettingsOpen(true);
      }
      return nextOpen;
    });
  }

  function requireChatProfile(): boolean {
    if (hasChatProfileName(config?.profile ?? null)) {
      return true;
    }
    setProfileSettingsOpen(true);
    onToast("Choose a chat username first.", "invalid");
    return false;
  }

  async function saveProfile(profile: ChatUserProfile): Promise<void> {
    const nextConfig = await window.ivsDashboard.saveChatProfile(profile);
    setConfig(nextConfig);
    configRef.current = nextConfig;
    setProfileSettingsOpen(false);
    await reconnectChat(nextConfig);
    onToast("Chat username saved", "valid");
  }

  const activeDraft = activeConversationId
    ? (messageDrafts[activeConversationId] ?? "")
    : "";

  return (
    <>
      <button
        className="icon-button secondary header-settings-button chat-header-button"
        type="button"
        ref={chatButtonRef}
        aria-label="Open chat"
        title="Chat"
        onClick={openChatDrawer}
      >
        <MessageCircle size={18} />
        {unreadTotal > 0 ? (
          <span className="chat-badge">{unreadTotal}</span>
        ) : null}
      </button>

      {drawerOpen ? (
        <button
          className="chat-backdrop"
          type="button"
          aria-label="Close chat"
          onClick={() => setDrawerOpen(false)}
        />
      ) : null}

      <aside
        className={`chat-drawer${drawerOpen ? " open" : ""}`}
        ref={drawerRef}
        aria-hidden={!drawerOpen}
      >
        <header className="chat-drawer-header">
          <div>
            <h2>Chat</h2>
            <span className={`chat-connection ${connectionState}`}>
              {connectionState === "online"
                ? "Online"
                : connectionState === "connecting"
                  ? "Connecting"
                  : connectionState === "setup"
                    ? "Set username"
                    : "Offline"}
            </span>
          </div>
          <div className="chat-drawer-actions">
            <button
              className="icon-button secondary"
              type="button"
              aria-label="Chat settings"
              title="Chat settings"
              onClick={() => setProfileSettingsOpen(true)}
            >
              <Settings size={17} />
            </button>
            <button
              className="icon-button secondary"
              type="button"
              aria-label="New conversation"
              title="New conversation"
              onClick={() => {
                if (requireChatProfile()) {
                  setNewConversationOpen(true);
                }
              }}
              disabled={!config || connectionState === "offline"}
            >
              <Plus size={17} />
            </button>
            <button
              className="icon-button secondary"
              type="button"
              aria-label="Close chat"
              title="Close chat"
              onClick={() => setDrawerOpen(false)}
            >
              <X size={18} />
            </button>
          </div>
        </header>

        {connectionState === "offline" ? (
          <div className="chat-offline-banner" role="status">
            <WifiOff size={15} />
            <span>Chat service unavailable. Dashboard remains usable.</span>
            {config ? (
              <button type="button" onClick={() => void reconnectChat(config)}>
                Retry
              </button>
            ) : null}
          </div>
        ) : null}

        {connectionState === "setup" ? (
          <div className="chat-setup-banner" role="status">
            <Settings size={15} />
            <span>Choose a username to start chatting.</span>
            <button type="button" onClick={() => setProfileSettingsOpen(true)}>
              Set username
            </button>
          </div>
        ) : null}

        <div className="chat-drawer-body">
          <section
            className="chat-conversation-list"
            aria-label="Conversations"
          >
            <label className="chat-search">
              <Search size={14} />
              <input
                type="search"
                placeholder="Search conversations"
                value={conversationQuery}
                onChange={(event) => setConversationQuery(event.target.value)}
              />
            </label>
            <div className="chat-conversation-scroll">
              {filteredConversations.length === 0 ? (
                <div className="chat-empty-state">No conversations yet.</div>
              ) : (
                filteredConversations.map((conversation) => (
                  <button
                    key={conversation.id}
                    className={`chat-conversation-item${
                      conversation.id === activeConversationId ? " active" : ""
                    }`}
                    type="button"
                    onClick={() => openConversation(conversation.id)}
                  >
                    <span className="chat-conversation-title-row">
                      <strong>{conversationLabel(conversation)}</strong>
                      <time>{formatChatTime(conversation.updatedAt)}</time>
                    </span>
                    <span className="chat-conversation-meta">
                      <span>{messagePreview(conversation.lastMessage)}</span>
                      {conversation.unreadCount > 0 ? (
                        <b>{conversation.unreadCount}</b>
                      ) : null}
                    </span>
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="chat-message-panel" aria-label="Messages">
            {activeConversation ? (
              <>
                <header className="chat-message-header">
                  <div>
                    <h3>{conversationLabel(activeConversation)}</h3>
                    <span>{activeConversation.memberNames.join(", ")}</span>
                  </div>
                </header>
                <div
                  className="chat-message-list"
                  ref={messageListRef}
                  onScroll={handleMessageScroll}
                >
                  {loadingOlder ? (
                    <div className="chat-loading-older">
                      <LoaderCircle size={14} className="button-spinner" />
                      Loading older messages
                    </div>
                  ) : null}
                  {activeMessages.map((message) => (
                    <ChatMessageBubble
                      key={message.id}
                      message={message}
                      own={message.senderUserId === config?.profile.userId}
                      onPreviewImage={() => setImagePreview(message)}
                    />
                  ))}
                </div>
                <form className="chat-compose" onSubmit={sendMessage}>
                  {selectedImage ? (
                    <div className="chat-selected-image">
                      <span>{selectedImage.name}</span>
                      <button
                        type="button"
                        aria-label="Remove image"
                        title="Remove image"
                        onClick={() => setSelectedImage(null)}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : null}
                  {sendError ? (
                    <p className="chat-send-error">{sendError}</p>
                  ) : null}
                  <div className="chat-compose-row">
                    <button
                      className="icon-button secondary"
                      type="button"
                      aria-label="Attach image"
                      title="Attach image"
                      onClick={() => imageInputRef.current?.click()}
                    >
                      <ImageIcon size={17} />
                    </button>
                    <input
                      ref={imageInputRef}
                      className="chat-file-input"
                      type="file"
                      accept="image/png,image/jpeg,image/gif,image/webp"
                      onChange={handleImageChange}
                    />
                    <textarea
                      value={activeDraft}
                      rows={1}
                      placeholder="Message"
                      onKeyDown={handleComposeKeyDown}
                      onChange={(event) =>
                        setMessageDrafts((current) => ({
                          ...current,
                          [activeConversation.id]: event.target.value,
                        }))
                      }
                    />
                    <button
                      className="icon-button primary"
                      type="submit"
                      aria-label="Send message"
                      title="Send"
                      disabled={
                        sending || (!activeDraft.trim() && !selectedImage)
                      }
                    >
                      {sending ? (
                        <LoaderCircle size={17} className="button-spinner" />
                      ) : (
                        <Send size={17} />
                      )}
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <div className="chat-empty-panel">
                <Users size={22} />
                <span>Select or create a conversation.</span>
              </div>
            )}
          </section>
        </div>
      </aside>

      {newConversationOpen && config ? (
        <NewConversationModal
          users={users.filter((user) => user.id !== config.profile.userId)}
          config={config}
          onCreated={(conversation) => {
            setConversations((current) =>
              sortConversations(
                upsertById(current, conversation, (item) => item.id),
              ),
            );
            setActiveConversationId(conversation.id);
            setNewConversationOpen(false);
          }}
          onClose={() => setNewConversationOpen(false)}
        />
      ) : null}

      {profileSettingsOpen && config ? (
        <ChatProfileSettingsModal
          profile={config.profile}
          onClose={() => setProfileSettingsOpen(false)}
          onSave={saveProfile}
        />
      ) : null}

      <Modal
        open={imagePreview !== null}
        title="Image Preview"
        size="lg"
        className="chat-image-modal"
        closeLabel="Close image preview"
        onClose={() => setImagePreview(null)}
      >
        {imagePreview?.attachment ? (
          <img
            src={imagePreview.attachment.url}
            alt={imagePreview.attachment.fileName}
          />
        ) : null}
      </Modal>
    </>
  );
}

function ChatProfileSettingsModal({
  profile,
  onSave,
  onClose,
}: {
  profile: ChatUserProfile;
  onSave: (profile: ChatUserProfile) => Promise<void>;
  onClose: () => void;
}): JSX.Element {
  const [displayName, setDisplayName] = useState(profile.displayName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const nextDisplayName = displayName.trim();
    if (!nextDisplayName) {
      setError("Username is required.");
      return;
    }
    if (nextDisplayName.length > 80) {
      setError("Username must be 80 characters or fewer.");
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await onSave({ ...profile, displayName: nextDisplayName });
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Username could not be saved.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      title="Chat Settings"
      subtitle="Choose the name shown in chat"
      size="sm"
      className="chat-profile-modal"
      contentClassName="chat-profile-modal-content"
      closeLabel="Close chat settings"
      onClose={onClose}
    >
      <form className="chat-profile-form" onSubmit={submit}>
        <label className="chat-create-field">
          <span>Username</span>
          <input
            autoFocus
            type="text"
            value={displayName}
            maxLength={80}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>
        {profile.machineName ? (
          <div className="chat-profile-device">
            <span>Device</span>
            <strong>{profile.machineName}</strong>
          </div>
        ) : null}
        {error ? <p className="form-error">{error}</p> : null}
        <footer className="settings-footer-row">
          <button
            className="button secondary compact"
            type="button"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="button primary compact"
            type="submit"
            disabled={submitting}
          >
            {submitting ? "Saving" : "Save"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

function ChatMessageBubble({
  message,
  own,
  onPreviewImage,
}: {
  message: ChatMessage;
  own: boolean;
  onPreviewImage: () => void;
}): JSX.Element {
  return (
    <article className={`chat-message${own ? " own" : ""}`}>
      <div className="chat-message-meta">
        <strong>{message.senderDisplayName}</strong>
        <time>{formatChatTime(message.createdAt)}</time>
      </div>
      {message.attachment ? (
        <button
          className="chat-message-image"
          type="button"
          onClick={onPreviewImage}
          aria-label="Preview image"
        >
          <img src={message.attachment.url} alt={message.attachment.fileName} />
        </button>
      ) : null}
      {message.body ? <p>{renderLinks(message.body)}</p> : null}
    </article>
  );
}

function NewConversationModal({
  users,
  config,
  onCreated,
  onClose,
}: {
  users: ChatUser[];
  config: ChatServiceConfig;
  onCreated: (conversation: ChatConversation) => void;
  onClose: () => void;
}): JSX.Element {
  const [mode, setMode] = useState<"direct" | "group">("direct");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [groupTitle, setGroupTitle] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const userOptions = useMemo<Array<AppSelectOption<string>>>(
    () => [
      { value: "", label: "Select user" },
      ...users.map((user) => ({
        value: user.id,
        label: formatUserOptionLabel(user),
      })),
    ],
    [users],
  );

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (mode === "direct" && !selectedUserId) {
      setError("Select a user.");
      return;
    }
    if (mode === "group" && !groupTitle.trim()) {
      setError("Group title is required.");
      return;
    }
    if (mode === "group" && selectedMemberIds.size === 0) {
      setError("Select at least one member.");
      return;
    }
    setSubmitting(true);
    try {
      const conversation = await chatJson<ChatConversation>(
        config,
        mode === "direct" ? "/conversations/direct" : "/conversations/group",
        {
          method: "POST",
          body: JSON.stringify(
            mode === "direct"
              ? {
                  currentUserId: config.profile.userId,
                  otherUserId: selectedUserId,
                }
              : {
                  currentUserId: config.profile.userId,
                  title: groupTitle,
                  memberIds: Array.from(selectedMemberIds),
                },
          ),
        },
      );
      onCreated(conversation);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Conversation could not be created.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      title="New Conversation"
      subtitle="Start a direct chat or group chat"
      size="md"
      className="chat-create-modal"
      contentClassName="chat-create-modal-content"
      closeLabel="Close new conversation"
      onClose={onClose}
    >
      <form className="chat-create-form" onSubmit={submit}>
        <div
          className="chat-create-mode"
          role="tablist"
          aria-label="Conversation type"
        >
          <button
            type="button"
            className={mode === "direct" ? "active" : undefined}
            onClick={() => setMode("direct")}
          >
            1-to-1
          </button>
          <button
            type="button"
            className={mode === "group" ? "active" : undefined}
            onClick={() => setMode("group")}
          >
            Group
          </button>
        </div>
        {mode === "direct" ? (
          <label className="chat-create-field">
            <span>User</span>
            <AppSelect
              className="chat-user-select"
              value={selectedUserId}
              options={userOptions}
              onChange={setSelectedUserId}
              ariaLabel="Select user"
              minDropdownWidth={260}
              showDots={false}
            />
          </label>
        ) : (
          <>
            <label className="chat-create-field">
              <span>Title</span>
              <input
                type="text"
                value={groupTitle}
                onChange={(event) => setGroupTitle(event.target.value)}
              />
            </label>
            <div className="chat-member-picker">
              {users.map((user) => (
                <label key={user.id}>
                  <input
                    type="checkbox"
                    checked={selectedMemberIds.has(user.id)}
                    onChange={(event) => {
                      setSelectedMemberIds((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(user.id);
                        else next.delete(user.id);
                        return next;
                      });
                    }}
                  />
                  <span className="chat-member-label">
                    <span
                      className={`chat-user-presence${user.online ? " online" : ""}`}
                    />
                    <span>{user.displayName}</span>
                    {user.machineName ? (
                      <small>{user.machineName}</small>
                    ) : null}
                  </span>
                </label>
              ))}
            </div>
          </>
        )}
        {error ? <p className="form-error">{error}</p> : null}
        <footer className="settings-footer-row">
          <button
            className="button secondary compact"
            type="button"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="button primary compact"
            type="submit"
            disabled={submitting}
          >
            {submitting ? "Creating" : "Create"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

async function chatJson<T>(
  config: ChatServiceConfig,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${config.httpUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-User-Id": config.profile.userId,
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(await responseError(response));
  }
  return (await response.json()) as T;
}

async function chatImage(
  config: ChatServiceConfig,
  conversationId: string,
  file: File,
  body: string,
): Promise<ChatMessage> {
  const response = await fetch(
    `${config.httpUrl}/conversations/${encodeURIComponent(conversationId)}/images`,
    {
      method: "POST",
      body: file,
      headers: {
        "Content-Type": file.type,
        "X-User-Id": config.profile.userId,
        "X-File-Name": encodeURIComponent(file.name),
        "X-Message-Body": encodeURIComponent(body),
      },
    },
  );
  if (!response.ok) {
    throw new Error(await responseError(response));
  }
  return (await response.json()) as ChatMessage;
}

async function responseError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? "Chat request failed.";
  } catch {
    return "Chat request failed.";
  }
}

function renderLinks(text: string): Array<string | JSX.Element> {
  const parts: Array<string | JSX.Element> = [];
  let lastIndex = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = match[0];
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push(text.slice(lastIndex, index));
    }
    parts.push(
      <a
        key={`${url}-${index}`}
        href={url}
        onClick={(event) => {
          event.preventDefault();
          void window.ivsDashboard.openExternalUrl(url);
        }}
      >
        {url}
      </a>,
    );
    lastIndex = index + url.length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

function mergeMessages(messages: ChatMessage[]): ChatMessage[] {
  const byId = new Map<number, ChatMessage>();
  messages.forEach((message) => byId.set(message.id, message));
  return Array.from(byId.values()).sort((left, right) => left.id - right.id);
}

function upsertById<T>(items: T[], item: T, getId: (value: T) => string): T[] {
  const id = getId(item);
  const exists = items.some((current) => getId(current) === id);
  return exists
    ? items.map((current) => (getId(current) === id ? item : current))
    : [item, ...items];
}

function sortConversations(items: ChatConversation[]): ChatConversation[] {
  return [...items].sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );
}

function sortUsers(items: ChatUser[]): ChatUser[] {
  return [...items].sort((left, right) =>
    left.displayName.localeCompare(right.displayName),
  );
}

function conversationLabel(conversation: ChatConversation): string {
  return conversation.title || conversation.memberNames.join(", ");
}

function hasChatProfileName(profile: ChatUserProfile | null): boolean {
  return Boolean(profile?.displayName?.trim());
}

function formatUserOptionLabel(user: ChatUser): string {
  const status = user.online ? "online" : "offline";
  return user.machineName
    ? `${user.displayName} (${status}, ${user.machineName})`
    : `${user.displayName} (${status})`;
}

function messagePreview(message: ChatMessage | null): string {
  if (!message) return "No messages yet";
  if (message.type === "image") return message.body || "Image";
  return message.body || "Message";
}

function formatChatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function isAllowedImage(file: File): boolean {
  return ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
    file.type,
  );
}
