import { conversationReducer } from "@application/conversations/conversationReducer";
import { createConversationState, SEEN_INBOUND_LIMIT } from "@application/conversations/conversationState";
import type { ChatId } from "@domain/chatId";

const alice = "10000001" as ChatId;
const bob = "10000002" as ChatId;
const networkError = { kind: "network", safeMessage: "Нет соединения.", retryable: true } as const;

const create = (state: ReturnType<typeof createConversationState>, chatId: ChatId, label = "Contact") =>
  conversationReducer(state, { type: "conversation-created", chatId, label });

const incoming = (state: ReturnType<typeof createConversationState>, chatId: ChatId, idMessage: string, localId = `local-${idMessage}`) =>
  conversationReducer(state, { type: "notification-classified", localId, notification: { kind: "direct-text", chatId, idMessage, text: idMessage, receivedAt: 1 } });

describe("conversationReducer", () => {
  test("creating a duplicate conversation activates the existing record without duplicating order", () => {
    let state = create(create(createConversationState(), alice), bob);
    state = create(state, alice, "Renamed");
    expect(state.conversationOrder).toEqual([alice, bob]);
    expect(state.activeChatId).toBe(alice);
    expect(state.conversationsById[alice]?.label).toBe("Contact");
  });

  test("incoming messages increment only inactive unread and activation clears only that chat", () => {
    let state = create(create(createConversationState(), alice), bob);
    state = incoming(state, alice, "a-1");
    state = incoming(state, bob, "b-1");
    expect(state.conversationsById[alice]?.unreadCount).toBe(1);
    expect(state.conversationsById[bob]?.unreadCount).toBe(0);
    state = conversationReducer(state, { type: "conversation-activated", chatId: alice });
    expect(state.conversationsById[alice]?.unreadCount).toBe(0);
    expect(state.conversationsById[bob]?.unreadCount).toBe(0);
  });

  test("unknown direct sender creates a labeled conversation without stealing active chat", () => {
    let state = create(createConversationState(), alice, "Alice");
    state = incoming(state, bob, "b-1");
    expect(state.activeChatId).toBe(alice);
    expect(state.conversationsById[bob]).toMatchObject({ label: `Чат ${bob}`, unreadCount: 1 });
  });

  test("ignored group sender does not create a conversation", () => {
    const state = conversationReducer(createConversationState(), { type: "notification-classified", notification: { kind: "ignored", reason: "unsupported-sender" } });
    expect(state.conversationOrder).toEqual([]);
    expect(state.diagnostics.ignoredNotifications).toBe(1);
  });

  test("deduplicates by chat and remote message id rather than remote id alone", () => {
    let state = incoming(createConversationState(), alice, "same", "a-1");
    state = incoming(state, alice, "same", "a-duplicate");
    state = incoming(state, bob, "same", "b-1");
    expect(Object.keys(state.messagesById)).toEqual(["a-1", "b-1"]);
  });

  test("evicts oldest dedupe keys at the bounded-memory limit", () => {
    let state = createConversationState();
    for (let index = 0; index <= SEEN_INBOUND_LIMIT; index += 1) state = incoming(state, alice, `id-${String(index)}`);
    expect(state.seenInboundOrder).toHaveLength(SEEN_INBOUND_LIMIT);
    expect(state.seenInboundIds[`${alice}:id-0`]).toBeUndefined();
    state = incoming(state, alice, "id-0", "replayed-oldest");
    expect(state.messagesById["replayed-oldest"]).toBeDefined();
  });

  test("concurrent sends and completions remain attached to their original chats after switching", () => {
    let state = create(create(createConversationState(), alice), bob);
    state = conversationReducer(state, { type: "outgoing-created", chatId: alice, localId: "local-a", attemptId: "attempt-a", text: "A", createdAt: 1 });
    state = conversationReducer(state, { type: "outgoing-created", chatId: bob, localId: "local-b", attemptId: "attempt-b", text: "B", createdAt: 2 });
    state = conversationReducer(state, { type: "conversation-activated", chatId: bob });
    state = conversationReducer(state, { type: "outgoing-sent", chatId: alice, localId: "local-a", attemptId: "attempt-a", idMessage: "remote-a" });
    expect(state.messagesById["local-a"]).toMatchObject({ chatId: alice, status: "sent", idMessage: "remote-a" });
    expect(state.messagesById["local-b"]).toMatchObject({ chatId: bob, status: "pending" });
  });

  test("retry replaces the attempt and ignores a late result from the stale attempt", () => {
    let state = create(createConversationState(), alice);
    state = conversationReducer(state, { type: "outgoing-created", chatId: alice, localId: "local", attemptId: "attempt-1", text: "Hi", createdAt: 1 });
    state = conversationReducer(state, { type: "outgoing-failed", chatId: alice, localId: "local", attemptId: "attempt-1", error: networkError });
    state = conversationReducer(state, { type: "outgoing-retried", chatId: alice, localId: "local", attemptId: "attempt-2" });
    const beforeLateResult = state;
    state = conversationReducer(state, { type: "outgoing-sent", chatId: alice, localId: "local", attemptId: "attempt-1", idMessage: "stale" });
    expect(state).toBe(beforeLateResult);
    state = conversationReducer(state, { type: "outgoing-sent", chatId: alice, localId: "local", attemptId: "attempt-2", idMessage: "fresh" });
    expect(state.messagesById["local"]).toMatchObject({ status: "sent", idMessage: "fresh", attemptId: "attempt-2" });
  });

  test("applying a new session atomically clears chats, messages, dedupe and diagnostics", () => {
    let state = incoming(createConversationState("old"), alice, "a-1");
    state = conversationReducer(state, { type: "notification-classified", notification: { kind: "malformed", reason: "missing-text" } });
    state = conversationReducer(state, { type: "session-applied", sessionId: "new" });
    expect(state).toEqual(createConversationState("new"));
  });
});
