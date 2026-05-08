export type ChatConversationType = "direct" | "group";
export type ChatMessageType = "text" | "image" | "system";

export type ChatUserProfile = {
  userId: string;
  displayName: string;
  machineName?: string;
};

export type ChatUser = {
  id: string;
  displayName: string;
  machineName: string | null;
  createdAt: string;
  lastSeenAt: string;
};

export type ChatAttachment = {
  id: string;
  messageId: number | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  createdAt: string;
};

export type ChatMessage = {
  id: number;
  conversationId: string;
  senderUserId: string;
  senderDisplayName: string;
  type: ChatMessageType;
  body: string;
  attachment: ChatAttachment | null;
  createdAt: string;
};

export type ChatConversation = {
  id: string;
  type: ChatConversationType;
  title: string | null;
  memberIds: string[];
  memberNames: string[];
  createdAt: string;
  updatedAt: string;
  lastMessage: ChatMessage | null;
  unreadCount: number;
};

export type ChatMessagePage = {
  messages: ChatMessage[];
  hasMore: boolean;
};

export type ChatServiceConfig = {
  httpUrl: string;
  wsUrl: string;
  profile: ChatUserProfile;
};

export type ChatNativeNotification = {
  conversationId: string;
  title: string;
  body: string;
};

export type ChatEvent =
  | { type: "message_created"; conversationId: string; message: ChatMessage }
  | { type: "conversation_updated"; conversation: ChatConversation }
  | {
      type: "read_state_updated";
      conversationId: string;
      userId: string;
      unreadCount: number;
    }
  | { type: "user_presence_updated"; user: ChatUser };
