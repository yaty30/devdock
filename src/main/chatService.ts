import DatabaseConstructor, { type Database } from "better-sqlite3";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import type {
  ChatAttachment,
  ChatConversation,
  ChatEvent,
  ChatMessage,
  ChatMessagePage,
  ChatUser,
  ChatUserProfile,
} from "../shared/chatTypes";

type ChatServiceOptions = {
  host: string;
  port: number;
  databasePath: string;
  uploadsPath: string;
  publicHttpUrl: string;
};

type ChatUserRow = {
  id: string;
  display_name: string;
  machine_name: string | null;
  created_at: string;
  last_seen_at: string;
};

type ChatConversationRow = {
  id: string;
  type: "direct" | "group";
  title: string | null;
  created_at: string;
  updated_at: string;
};

type ChatMessageRow = {
  id: number;
  conversation_id: string;
  sender_user_id: string;
  sender_display_name: string | null;
  type: "text" | "image" | "system";
  body: string | null;
  attachment_id: string | null;
  created_at: string;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
};

type AttachmentRow = {
  id: string;
  message_id: number | null;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  created_at: string;
};

const JSON_LIMIT_BYTES = 1024 * 1024;
const IMAGE_LIMIT_BYTES = 10 * 1024 * 1024;
const MESSAGE_LIMIT = 4000;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export class ChatService {
  private readonly db: Database;
  private readonly server = createServer((request, response) => {
    void this.handleRequest(request, response);
  });
  private readonly sockets = new Map<string, Set<WebSocket>>();
  private readonly wss: WebSocketServer;

  constructor(private readonly options: ChatServiceOptions) {
    mkdirSync(dirname(options.databasePath), { recursive: true });
    mkdirSync(options.uploadsPath, { recursive: true });
    this.db = new DatabaseConstructor(options.databasePath);
    this.db.pragma("journal_mode = WAL");
    this.initializeSchema();
    this.wss = new WebSocketServer({ server: this.server, path: "/ws" });
    this.wss.on("connection", (socket, request) => {
      const url = new URL(request.url ?? "/", this.options.publicHttpUrl);
      const userId = url.searchParams.get("userId")?.trim();
      if (!userId) {
        socket.close(1008, "Missing userId");
        return;
      }
      this.addSocket(userId, socket);
    });
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.options.port, this.options.host, () => {
        this.server.off("error", reject);
        resolve();
      });
    });
  }

  stop(): void {
    this.wss.close();
    this.server.close();
    this.db.close();
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        machine_name TEXT,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('direct', 'group')),
        title TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversation_members (
        conversation_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        joined_at TEXT NOT NULL,
        last_read_message_id INTEGER,
        last_read_at TEXT,
        PRIMARY KEY(conversation_id, user_id),
        FOREIGN KEY(conversation_id) REFERENCES conversations(id),
        FOREIGN KEY(user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY,
        message_id INTEGER,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        storage_path TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        sender_user_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('text', 'image', 'system')),
        body TEXT,
        attachment_id TEXT,
        created_at TEXT NOT NULL,
        edited_at TEXT,
        deleted_at TEXT,
        FOREIGN KEY(conversation_id) REFERENCES conversations(id),
        FOREIGN KEY(sender_user_id) REFERENCES users(id),
        FOREIGN KEY(attachment_id) REFERENCES attachments(id)
      );

      CREATE TABLE IF NOT EXISTS read_receipts (
        message_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        read_at TEXT NOT NULL,
        PRIMARY KEY(message_id, user_id)
      );

      CREATE INDEX IF NOT EXISTS conversation_members_user_idx
        ON conversation_members(user_id);
      CREATE INDEX IF NOT EXISTS messages_conversation_id_idx
        ON messages(conversation_id, id DESC);
    `);
  }

  private async handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    this.applyCommonHeaders(response);
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const url = new URL(request.url ?? "/", this.options.publicHttpUrl);
    const path = url.pathname;

    try {
      if (request.method === "GET" && path === "/health") {
        this.writeJson(response, 200, { ok: true });
        return;
      }
      if (request.method === "POST" && path === "/users") {
        const body = await readJson<ChatUserProfile>(request, JSON_LIMIT_BYTES);
        const user = this.upsertUser(body);
        this.broadcast({ type: "user_presence_updated", user });
        this.writeJson(response, 200, user);
        return;
      }
      if (request.method === "GET" && path === "/users") {
        this.writeJson(response, 200, this.listUsers());
        return;
      }
      if (request.method === "GET" && path === "/conversations") {
        this.writeJson(
          response,
          200,
          this.listConversations(this.userId(request, url)),
        );
        return;
      }
      if (request.method === "POST" && path === "/conversations/direct") {
        const body = await readJson<{
          currentUserId: string;
          otherUserId: string;
        }>(request, JSON_LIMIT_BYTES);
        const conversation = this.createDirectConversation(
          body.currentUserId,
          body.otherUserId,
        );
        this.sendToMembers(conversation.id, {
          type: "conversation_updated",
          conversation,
        });
        this.writeJson(response, 200, conversation);
        return;
      }
      if (request.method === "POST" && path === "/conversations/group") {
        const body = await readJson<{
          currentUserId: string;
          title: string;
          memberIds: string[];
        }>(request, JSON_LIMIT_BYTES);
        const conversation = this.createGroupConversation(
          body.currentUserId,
          body.title,
          body.memberIds,
        );
        this.sendToMembers(conversation.id, {
          type: "conversation_updated",
          conversation,
        });
        this.writeJson(response, 201, conversation);
        return;
      }

      const messagesMatch = path.match(/^\/conversations\/([^/]+)\/messages$/);
      if (messagesMatch && request.method === "GET") {
        const conversationId = decodeURIComponent(messagesMatch[1]);
        const userId = this.userId(request, url);
        const before = Number(url.searchParams.get("before") ?? "0") || null;
        const limit = clamp(
          Number(url.searchParams.get("limit") ?? "50"),
          1,
          50,
        );
        this.ensureMember(conversationId, userId);
        this.writeJson(
          response,
          200,
          this.getMessages(conversationId, before, limit),
        );
        return;
      }
      if (messagesMatch && request.method === "POST") {
        const conversationId = decodeURIComponent(messagesMatch[1]);
        const body = await readJson<{ senderUserId: string; body: string }>(
          request,
          JSON_LIMIT_BYTES,
        );
        const message = this.createTextMessage(
          conversationId,
          body.senderUserId,
          body.body,
        );
        this.sendToMembers(conversationId, {
          type: "message_created",
          conversationId,
          message,
        });
        this.sendConversationUpdate(conversationId);
        this.writeJson(response, 201, message);
        return;
      }

      const imagesMatch = path.match(/^\/conversations\/([^/]+)\/images$/);
      if (imagesMatch && request.method === "POST") {
        const conversationId = decodeURIComponent(imagesMatch[1]);
        const senderUserId = this.userId(request, url);
        const message = await this.createImageMessage(
          conversationId,
          senderUserId,
          request,
          url,
        );
        this.sendToMembers(conversationId, {
          type: "message_created",
          conversationId,
          message,
        });
        this.sendConversationUpdate(conversationId);
        this.writeJson(response, 201, message);
        return;
      }

      const readMatch = path.match(/^\/conversations\/([^/]+)\/read$/);
      if (readMatch && request.method === "POST") {
        const conversationId = decodeURIComponent(readMatch[1]);
        const body = await readJson<{ userId: string; messageId?: number }>(
          request,
          JSON_LIMIT_BYTES,
        );
        const unreadCount = this.markRead(
          conversationId,
          body.userId,
          body.messageId,
        );
        this.sendToMembers(conversationId, {
          type: "read_state_updated",
          conversationId,
          userId: body.userId,
          unreadCount,
        });
        this.writeJson(response, 200, { unreadCount });
        return;
      }

      const attachmentMatch = path.match(/^\/attachments\/([^/]+)$/);
      if (attachmentMatch && request.method === "GET") {
        this.writeAttachment(response, decodeURIComponent(attachmentMatch[1]));
        return;
      }

      this.writeJson(response, 404, { error: "Not found" });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Chat request failed.";
      const status = message.includes("not found")
        ? 404
        : message.includes("required")
          ? 400
          : 500;
      this.writeJson(response, status, { error: message });
    }
  }

  private applyCommonHeaders(response: ServerResponse): void {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    response.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, X-User-Id, X-File-Name, X-Message-Body",
    );
    response.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  }

  private writeJson(
    response: ServerResponse,
    status: number,
    value: unknown,
  ): void {
    response.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify(value));
  }

  private writeAttachment(
    response: ServerResponse,
    attachmentId: string,
  ): void {
    const row = this.db
      .prepare("SELECT * FROM attachments WHERE id = ?")
      .get(attachmentId) as AttachmentRow | undefined;
    if (!row) {
      throw new Error("Attachment not found.");
    }
    const stats = statSync(row.storage_path);
    response.writeHead(200, {
      "Content-Type": row.mime_type,
      "Content-Length": stats.size,
      "Cache-Control": "private, max-age=86400",
    });
    response.end(readFileSync(row.storage_path));
  }

  private userId(request: IncomingMessage, url: URL): string {
    const header = request.headers["x-user-id"];
    const value = Array.isArray(header) ? header[0] : header;
    const userId = (value ?? url.searchParams.get("userId") ?? "").trim();
    if (!userId) {
      throw new Error("User id is required.");
    }
    return userId;
  }

  private upsertUser(profile: ChatUserProfile): ChatUser {
    const userId = profile.userId?.trim();
    const displayName = profile.displayName?.trim();
    if (!userId || !displayName) {
      throw new Error("User id and display name are required.");
    }
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO users (id, display_name, machine_name, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           display_name = excluded.display_name,
           machine_name = excluded.machine_name,
           last_seen_at = excluded.last_seen_at`,
      )
      .run(userId, displayName, profile.machineName ?? null, now, now);
    return this.getUser(userId);
  }

  private getUser(userId: string): ChatUser {
    const row = this.db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(userId) as ChatUserRow | undefined;
    if (!row) {
      throw new Error("User not found.");
    }
    return this.mapUser(row);
  }

  private listUsers(): ChatUser[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM users ORDER BY lower(display_name), machine_name",
        )
        .all() as ChatUserRow[]
    ).map((row) => this.mapUser(row));
  }

  private mapUser(row: ChatUserRow): ChatUser {
    return {
      id: row.id,
      displayName: row.display_name,
      machineName: row.machine_name,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
    };
  }

  private listConversations(userId: string): ChatConversation[] {
    const rows = this.db
      .prepare(
        `SELECT c.*
         FROM conversations c
         INNER JOIN conversation_members cm ON cm.conversation_id = c.id
         WHERE cm.user_id = ?
         ORDER BY datetime(c.updated_at) DESC`,
      )
      .all(userId) as ChatConversationRow[];
    return rows.map((row) => this.mapConversation(row, userId));
  }

  private createDirectConversation(
    currentUserId: string,
    otherUserId: string,
  ): ChatConversation {
    if (!currentUserId || !otherUserId || currentUserId === otherUserId) {
      throw new Error("Select another user for a direct chat.");
    }
    this.getUser(currentUserId);
    this.getUser(otherUserId);
    const existing = this.db
      .prepare(
        `SELECT c.*
         FROM conversations c
         INNER JOIN conversation_members a ON a.conversation_id = c.id AND a.user_id = ?
         INNER JOIN conversation_members b ON b.conversation_id = c.id AND b.user_id = ?
         WHERE c.type = 'direct'
         LIMIT 1`,
      )
      .get(currentUserId, otherUserId) as ChatConversationRow | undefined;
    if (existing) {
      return this.mapConversation(existing, currentUserId);
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO conversations (id, type, title, created_at, updated_at) VALUES (?, 'direct', NULL, ?, ?)",
        )
        .run(id, now, now);
      this.addMember(id, currentUserId, now);
      this.addMember(id, otherUserId, now);
    });
    transaction();
    return this.mapConversation(this.getConversationRow(id), currentUserId);
  }

  private createGroupConversation(
    currentUserId: string,
    title: string,
    memberIds: string[],
  ): ChatConversation {
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      throw new Error("Group title is required.");
    }
    const uniqueMemberIds = Array.from(
      new Set([currentUserId, ...memberIds]),
    ).filter(Boolean);
    if (uniqueMemberIds.length < 2) {
      throw new Error("Select at least one other group member.");
    }
    uniqueMemberIds.forEach((id) => this.getUser(id));
    const id = randomUUID();
    const now = new Date().toISOString();
    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO conversations (id, type, title, created_at, updated_at) VALUES (?, 'group', ?, ?, ?)",
        )
        .run(id, cleanTitle.slice(0, 80), now, now);
      uniqueMemberIds.forEach((memberId) => this.addMember(id, memberId, now));
    });
    transaction();
    return this.mapConversation(this.getConversationRow(id), currentUserId);
  }

  private addMember(conversationId: string, userId: string, now: string): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO conversation_members
         (conversation_id, user_id, joined_at, last_read_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(conversationId, userId, now, now);
  }

  private getConversationRow(conversationId: string): ChatConversationRow {
    const row = this.db
      .prepare("SELECT * FROM conversations WHERE id = ?")
      .get(conversationId) as ChatConversationRow | undefined;
    if (!row) {
      throw new Error("Conversation not found.");
    }
    return row;
  }

  private ensureMember(conversationId: string, userId: string): void {
    const exists = this.db
      .prepare(
        "SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?",
      )
      .get(conversationId, userId);
    if (!exists) {
      throw new Error("Conversation not found.");
    }
  }

  private getMembers(conversationId: string): ChatUser[] {
    return (
      this.db
        .prepare(
          `SELECT u.*
         FROM users u
         INNER JOIN conversation_members cm ON cm.user_id = u.id
         WHERE cm.conversation_id = ?
         ORDER BY lower(u.display_name)`,
        )
        .all(conversationId) as ChatUserRow[]
    ).map((row) => this.mapUser(row));
  }

  private mapConversation(
    row: ChatConversationRow,
    currentUserId: string,
  ): ChatConversation {
    const members = this.getMembers(row.id);
    const memberNames = members.map((member) => member.displayName);
    const title =
      row.type === "group"
        ? row.title
        : (members.find((member) => member.id !== currentUserId)?.displayName ??
          "Direct chat");
    return {
      id: row.id,
      type: row.type,
      title,
      memberIds: members.map((member) => member.id),
      memberNames,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastMessage: this.getLastMessage(row.id),
      unreadCount: this.getUnreadCount(row.id, currentUserId),
    };
  }

  private getMessages(
    conversationId: string,
    before: number | null,
    limit: number,
  ): ChatMessagePage {
    const rows = this.db
      .prepare(
        `SELECT m.*, u.display_name AS sender_display_name,
                a.file_name, a.mime_type, a.size_bytes
         FROM messages m
         INNER JOIN users u ON u.id = m.sender_user_id
         LEFT JOIN attachments a ON a.id = m.attachment_id
         WHERE m.conversation_id = ?
           AND (? IS NULL OR m.id < ?)
         ORDER BY m.id DESC
         LIMIT ?`,
      )
      .all(conversationId, before, before, limit + 1) as ChatMessageRow[];
    const pageRows = rows.slice(0, limit).reverse();
    return {
      messages: pageRows.map((row) => this.mapMessage(row)),
      hasMore: rows.length > limit,
    };
  }

  private getLastMessage(conversationId: string): ChatMessage | null {
    const row = this.db
      .prepare(
        `SELECT m.*, u.display_name AS sender_display_name,
                a.file_name, a.mime_type, a.size_bytes
         FROM messages m
         INNER JOIN users u ON u.id = m.sender_user_id
         LEFT JOIN attachments a ON a.id = m.attachment_id
         WHERE m.conversation_id = ?
         ORDER BY m.id DESC
         LIMIT 1`,
      )
      .get(conversationId) as ChatMessageRow | undefined;
    return row ? this.mapMessage(row) : null;
  }

  private createTextMessage(
    conversationId: string,
    senderUserId: string,
    body: string,
  ): ChatMessage {
    this.ensureMember(conversationId, senderUserId);
    const cleanBody = body.trim();
    if (!cleanBody) {
      throw new Error("Message text is required.");
    }
    if (cleanBody.length > MESSAGE_LIMIT) {
      throw new Error("Message is too long.");
    }
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO messages (conversation_id, sender_user_id, type, body, created_at)
         VALUES (?, ?, 'text', ?, ?)`,
      )
      .run(conversationId, senderUserId, cleanBody, now);
    this.touchConversation(conversationId, now);
    return this.getMessage(Number(result.lastInsertRowid));
  }

  private async createImageMessage(
    conversationId: string,
    senderUserId: string,
    request: IncomingMessage,
    url: URL,
  ): Promise<ChatMessage> {
    this.ensureMember(conversationId, senderUserId);
    const mimeType = (request.headers["content-type"] ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
      throw new Error("Only PNG, JPG, GIF, and WebP images can be sent.");
    }
    const body = await readBuffer(request, IMAGE_LIMIT_BYTES);
    if (body.length === 0) {
      throw new Error("Image is required.");
    }
    const originalNameHeader = request.headers["x-file-name"];
    const originalName = decodeURIComponent(
      (Array.isArray(originalNameHeader)
        ? originalNameHeader[0]
        : originalNameHeader) ?? "image",
    );
    const safeName = sanitizeFileName(originalName, mimeType);
    const attachmentId = randomUUID();
    const storagePath = join(
      this.options.uploadsPath,
      `${attachmentId}-${safeName}`,
    );
    const captionHeader = request.headers["x-message-body"];
    const caption = decodeURIComponent(
      Array.isArray(captionHeader)
        ? captionHeader[0]
        : (captionHeader ?? url.searchParams.get("body") ?? ""),
    )
      .toString()
      .trim()
      .slice(0, MESSAGE_LIMIT);
    const now = new Date().toISOString();

    writeFileSync(storagePath, body);
    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO attachments
           (id, message_id, file_name, mime_type, size_bytes, storage_path, created_at)
           VALUES (?, NULL, ?, ?, ?, ?, ?)`,
        )
        .run(attachmentId, safeName, mimeType, body.length, storagePath, now);
      const result = this.db
        .prepare(
          `INSERT INTO messages
           (conversation_id, sender_user_id, type, body, attachment_id, created_at)
           VALUES (?, ?, 'image', ?, ?, ?)`,
        )
        .run(conversationId, senderUserId, caption, attachmentId, now);
      this.db
        .prepare("UPDATE attachments SET message_id = ? WHERE id = ?")
        .run(Number(result.lastInsertRowid), attachmentId);
      this.touchConversation(conversationId, now);
      return Number(result.lastInsertRowid);
    });
    return this.getMessage(transaction());
  }

  private getMessage(messageId: number): ChatMessage {
    const row = this.db
      .prepare(
        `SELECT m.*, u.display_name AS sender_display_name,
                a.file_name, a.mime_type, a.size_bytes
         FROM messages m
         INNER JOIN users u ON u.id = m.sender_user_id
         LEFT JOIN attachments a ON a.id = m.attachment_id
         WHERE m.id = ?`,
      )
      .get(messageId) as ChatMessageRow | undefined;
    if (!row) {
      throw new Error("Message not found.");
    }
    return this.mapMessage(row);
  }

  private mapMessage(row: ChatMessageRow): ChatMessage {
    const attachment: ChatAttachment | null = row.attachment_id
      ? {
          id: row.attachment_id,
          messageId: row.id,
          fileName: row.file_name ?? "image",
          mimeType: row.mime_type ?? "application/octet-stream",
          sizeBytes: row.size_bytes ?? 0,
          url: `${this.options.publicHttpUrl}/attachments/${encodeURIComponent(row.attachment_id)}`,
          createdAt: row.created_at,
        }
      : null;
    return {
      id: row.id,
      conversationId: row.conversation_id,
      senderUserId: row.sender_user_id,
      senderDisplayName: row.sender_display_name ?? "Unknown",
      type: row.type,
      body: row.body ?? "",
      attachment,
      createdAt: row.created_at,
    };
  }

  private markRead(
    conversationId: string,
    userId: string,
    messageId?: number,
  ): number {
    this.ensureMember(conversationId, userId);
    const latest =
      messageId ??
      (
        this.db
          .prepare(
            "SELECT MAX(id) AS id FROM messages WHERE conversation_id = ?",
          )
          .get(conversationId) as { id: number | null }
      ).id ??
      null;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE conversation_members
         SET last_read_message_id = ?, last_read_at = ?
         WHERE conversation_id = ? AND user_id = ?`,
      )
      .run(latest, now, conversationId, userId);
    if (latest !== null) {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO read_receipts (message_id, user_id, read_at)
           VALUES (?, ?, ?)`,
        )
        .run(latest, userId, now);
    }
    return this.getUnreadCount(conversationId, userId);
  }

  private getUnreadCount(conversationId: string, userId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM messages m
         INNER JOIN conversation_members cm
           ON cm.conversation_id = m.conversation_id AND cm.user_id = ?
         WHERE m.conversation_id = ?
           AND m.sender_user_id <> ?
           AND (cm.last_read_message_id IS NULL OR m.id > cm.last_read_message_id)`,
      )
      .get(userId, conversationId, userId) as { count: number };
    return row.count;
  }

  private touchConversation(conversationId: string, now: string): void {
    this.db
      .prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
      .run(now, conversationId);
  }

  private sendConversationUpdate(conversationId: string): void {
    const row = this.getConversationRow(conversationId);
    for (const member of this.getMembers(conversationId)) {
      this.send(member.id, {
        type: "conversation_updated",
        conversation: this.mapConversation(row, member.id),
      });
    }
  }

  private sendToMembers(conversationId: string, event: ChatEvent): void {
    this.getMembers(conversationId).forEach((member) =>
      this.send(member.id, event),
    );
  }

  private broadcast(event: ChatEvent): void {
    for (const userId of this.sockets.keys()) {
      this.send(userId, event);
    }
  }

  private send(userId: string, event: ChatEvent): void {
    const payload = JSON.stringify(event);
    this.sockets.get(userId)?.forEach((socket) => {
      if (socket.readyState === 1) {
        socket.send(payload);
      }
    });
  }

  private addSocket(userId: string, socket: WebSocket): void {
    const sockets = this.sockets.get(userId) ?? new Set<WebSocket>();
    sockets.add(socket);
    this.sockets.set(userId, sockets);
    socket.on("close", () => {
      const current = this.sockets.get(userId);
      current?.delete(socket);
      if (current?.size === 0) {
        this.sockets.delete(userId);
      }
    });
  }
}

async function readJson<T>(
  request: IncomingMessage,
  limit: number,
): Promise<T> {
  const body = await readBuffer(request, limit);
  if (body.length === 0) {
    return {} as T;
  }
  return JSON.parse(body.toString("utf8")) as T;
}

function readBuffer(request: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Request body is too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function sanitizeFileName(fileName: string, mimeType: string): string {
  const fallbackExt =
    mimeType === "image/png"
      ? ".png"
      : mimeType === "image/gif"
        ? ".gif"
        : mimeType === "image/webp"
          ? ".webp"
          : ".jpg";
  const cleanBase = basename(fileName)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const currentExt = extname(cleanBase);
  const safe = cleanBase || `image${fallbackExt}`;
  return currentExt ? safe : `${safe}${fallbackExt}`;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
