package com.ivs.dashboard.chat;

import jakarta.json.bind.Jsonb;
import jakarta.json.bind.JsonbBuilder;
import jakarta.websocket.CloseReason;
import jakarta.websocket.OnClose;
import jakarta.websocket.OnError;
import jakarta.websocket.OnMessage;
import jakarta.websocket.OnOpen;
import jakarta.websocket.Session;
import jakarta.websocket.server.PathParam;
import jakarta.websocket.server.ServerEndpoint;

import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@ServerEndpoint("/ws/chat/{userId}")
public class ChatSocket {
    private static final Jsonb JSON = JsonbBuilder.create();

    private static final Map<String, Session> sessionsByUser = new ConcurrentHashMap<>();
    private static final Map<String, ChatUser> users = new ConcurrentHashMap<>();
    private static final Map<String, ChatConversation> conversations = new ConcurrentHashMap<>();
    private static final Map<String, String> directConversationIds = new ConcurrentHashMap<>();
    private final WebsocketMapper websocketMapper = BeanLocator.getMapper(WebsocketMapper.class);

    @OnOpen
    public void onOpen(Session session, @PathParam("userId") String userId) {
        session.getUserProperties().put("userId", userId);
        sessionsByUser.put(userId, session);

        users.compute(userId, (id, existing) -> {
            ChatUser user = existing != null ? existing : new ChatUser();
            user.id = id;
            user.online = true;
            user.lastSeenAt = Instant.now().toString();
            return user;
        });

        broadcast(new Envelope("presence", users.get(userId)));
    }

    @OnMessage
    public void onMessage(String raw, Session session) {
        ClientCommand command = JSON.fromJson(raw, ClientCommand.class);
        String currentUserId = (String) session.getUserProperties().get("userId");

        switch (command.type) {
            case "register" -> registerUser(currentUserId, command);
            case "createDirect" -> createDirect(currentUserId, command.otherUserId);
            case "sendMessage" -> sendMessage(currentUserId, command.conversationId, command.body);
            case "listUsers" -> send(session, new Envelope("users", sortedUsers()));
            case "listConversations" -> send(session, new Envelope("conversations", conversationsFor(currentUserId)));
            default -> send(session, new Envelope("error", "Unknown command: " + command.type));
        }
    }

    @OnClose
    public void onClose(Session session, CloseReason reason) {
        String userId = (String) session.getUserProperties().get("userId");
        if (userId == null) return;

        sessionsByUser.remove(userId);

        ChatUser user = users.get(userId);
        if (user != null) {
            user.online = false;
            user.lastSeenAt = Instant.now().toString();
            broadcast(new Envelope("presence", user));
        }
    }

    @OnError
    public void onError(Session session, Throwable error) {
        send(session, new Envelope("error", error.getMessage()));
    }

    private void registerUser(String userId, ClientCommand command) {
        ChatUser user = users.computeIfAbsent(userId, id -> new ChatUser());
        user.id = userId;
        user.displayName = command.displayName;
        user.machineName = command.machineName;
        user.online = true;
        user.lastSeenAt = Instant.now().toString();

        broadcast(new Envelope("presence", user));
    }

    private void createDirect(String currentUserId, String otherUserId) {
        String key = canonicalPair(currentUserId, otherUserId);
        String conversationId = directConversationIds.computeIfAbsent(key, ignored -> {
            String id = "direct-" + UUID.randomUUID();

            ChatConversation conversation = new ChatConversation();
            conversation.id = id;
            conversation.type = "direct";
            conversation.memberIds = Set.of(currentUserId, otherUserId);
            conversation.createdAt = Instant.now().toString();
            conversation.updatedAt = conversation.createdAt;

            // ✅ load history from DB
            List<ChatMessage> history = websocketMapper.selectMessagesByConversationId(id, 50);
            conversation.messages.addAll(history);

            conversations.put(id, conversation);
            return id;
        });

        ChatConversation conversation = conversations.get(conversationId);
        sendToMembers(conversation, new Envelope("conversationUpdated", conversation));
    }

    private void sendMessage(String senderUserId, String conversationId, String body) {
        ChatConversation conversation = conversations.get(conversationId);
        if (conversation == null || !conversation.memberIds.contains(senderUserId)) {
            sendToUser(senderUserId, new Envelope("error", "Conversation not found."));
            return;
        }

        ChatMessage message = new ChatMessage();
        message.id = UUID.randomUUID().toString();
        message.conversationId = conversationId;
        message.senderUserId = senderUserId;
        message.senderDisplayName = users.getOrDefault(senderUserId, new ChatUser()).displayName;
        message.body = body;
        message.createdAt = Instant.now().toString();

        conversation.messages.add(message);
        conversation.updatedAt = message.createdAt;

        // ✅ persist to DB
        websocketMapper.insertMessage(message);

        sendToMembers(conversation, new Envelope("messageCreated", message));
        sendToMembers(conversation, new Envelope("conversationUpdated", conversation));
    }

    private List<ChatUser> sortedUsers() {
        return users.values().stream()
            .sorted(Comparator.comparing(user -> safe(user.displayName)))
            .toList();
    }

    private List<ChatConversation> conversationsFor(String userId) {
        return conversations.values().stream()
            .filter(conversation -> conversation.memberIds.contains(userId))
            .sorted(Comparator.comparing((ChatConversation c) -> c.updatedAt).reversed())
            .toList();
    }

    private void sendToMembers(ChatConversation conversation, Envelope envelope) {
        for (String memberId : conversation.memberIds) {
            sendToUser(memberId, envelope);
        }
    }

    private void sendToUser(String userId, Envelope envelope) {
        Session session = sessionsByUser.get(userId);
        if (session != null && session.isOpen()) {
            send(session, envelope);
        }
    }

    private void broadcast(Envelope envelope) {
        for (Session session : sessionsByUser.values()) {
            send(session, envelope);
        }
    }

    private void send(Session session, Envelope envelope) {
        if (session == null || !session.isOpen()) return;

        try {
            session.getBasicRemote().sendText(JSON.toJson(envelope));
        } catch (IOException ignored) {
            // Client will reconnect.
        }
    }

    private String canonicalPair(String a, String b) {
        return a.compareTo(b) <= 0 ? a + "|" + b : b + "|" + a;
    }

    private String safe(String value) {
        return value == null ? "" : value;
    }

    public static class ClientCommand {
        public String type;
        public String displayName;
        public String machineName;
        public String otherUserId;
        public String conversationId;
        public String body;
    }

    public static class Envelope {
        public String type;
        public Object payload;

        public Envelope() {}

        public Envelope(String type, Object payload) {
            this.type = type;
            this.payload = payload;
        }
    }

    public static class ChatUser {
        public String id;
        public String displayName;
        public String machineName;
        public boolean online;
        public String lastSeenAt;
    }

    public static class ChatConversation {
        public String id;
        public String type;
        public Set<String> memberIds;
        public String createdAt;
        public String updatedAt;
        public List<ChatMessage> messages = new ArrayList<>();
    }

    public static class ChatMessage {
        public String id;
        public String conversationId;
        public String senderUserId;
        public String senderDisplayName;
        public String body;
        public String createdAt;
    }
}
