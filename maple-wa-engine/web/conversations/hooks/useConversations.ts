// ============================================================
// CONVERSATIONS MODULE — Data Hook
// Maneja estado local + sincronización con backend/Supabase
// ============================================================

import { useState, useEffect, useCallback, useRef } from "react";
import type { Conversation, Message, Session, SendMessagePayload } from "../types";

const STORAGE_KEY = "maple_conversations_v1";
const MESSAGES_KEY = "maple_messages_v1";

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveToStorage(key: string, value: any) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export function useConversations(sessionId?: string) {
  const [conversations, setConversations] = useState<Conversation[]>(() =>
    loadFromStorage(STORAGE_KEY, [])
  );
  const [messages, setMessages] = useState<Record<string, Message[]>>(() =>
    loadFromStorage(MESSAGES_KEY, {})
  );
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval>>();

  // Persistir en localStorage
  useEffect(() => {
    saveToStorage(STORAGE_KEY, conversations);
  }, [conversations]);

  useEffect(() => {
    saveToStorage(MESSAGES_KEY, messages);
  }, [messages]);

  // ============================================================
  // POLLING: Simular fetch del backend (reemplazar con Supabase/API real)
  // ============================================================
  useEffect(() => {
    if (!sessionId) return;

    const poll = async () => {
      try {
        // En producción: fetch a tu backend o Supabase
        // const res = await fetch(`${API_URL}/conversations?sessionId=${sessionId}`);
        // const data = await res.json();
        // mergeConversations(data);
      } catch {
        // Silencioso en dev
      }
    };

    poll();
    pollingRef.current = setInterval(poll, 3000);
    return () => clearInterval(pollingRef.current);
  }, [sessionId]);

  // ============================================================
  // ACTIONS
  // ============================================================

  const upsertConversation = useCallback((conv: Conversation) => {
    setConversations((prev) => {
      const idx = prev.findIndex((c) => c.id === conv.id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], ...conv };
        return updated.sort((a, b) =>
          (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt)
        );
      }
      return [conv, ...prev].sort((a, b) =>
        (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt)
      );
    });
  }, []);

  const addMessage = useCallback((msg: Message) => {
    setMessages((prev) => {
      const existing = prev[msg.conversationId] || [];
      if (existing.some((m) => m.id === msg.id)) return prev; // deduplicate
      return {
        ...prev,
        [msg.conversationId]: [...existing, msg].sort(
          (a, b) => a.timestamp - b.timestamp
        ),
      };
    });

    // Actualizar lastMessage de la conversación
    setConversations((prev) => {
      const idx = prev.findIndex((c) => c.id === msg.conversationId);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = {
          ...updated[idx],
          lastMessage: msg,
          updatedAt: new Date(msg.timestamp).toISOString(),
          unreadCount:
            msg.direction === "incoming" && !msg.fromMe
              ? updated[idx].unreadCount + 1
              : updated[idx].unreadCount,
        };
        return updated.sort((a, b) =>
          (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt)
        );
      }
      return prev;
    });
  }, []);

  const markAsRead = useCallback((conversationId: string) => {
    setConversations((prev) => {
      const idx = prev.findIndex((c) => c.id === conversationId);
      if (idx < 0) return prev;
      const updated = [...prev];
      updated[idx] = { ...updated[idx], unreadCount: 0 };
      return updated;
    });
  }, []);

  const sendMessage = useCallback(async (payload: SendMessagePayload): Promise<boolean> => {
    try {
      // En producción: enviar al backend de la extensión
      // await fetch(`${API_URL}/send-message`, { method: "POST", body: JSON.stringify(payload) });

      // Optimistic update para demo
      const msg: Message = {
        id: `msg-${Date.now()}`,
        conversationId: payload.chatId,
        chatId: payload.chatId,
        direction: "outgoing",
        type: "chat",
        body: payload.text,
        fromMe: true,
        ack: 0,
        timestamp: Date.now(),
        createdAt: new Date().toISOString(),
        synced: false,
      };
      addMessage(msg);
      return true;
    } catch {
      return false;
    }
  }, [addMessage]);

  const createConversation = useCallback(
    async (contactPhone: string, contactName: string, sessionId: string): Promise<Conversation> => {
      const id = `conv-${Date.now()}`;
      const chatId = contactPhone.includes("@") ? contactPhone : `${contactPhone}@c.us`;
      const conv: Conversation = {
        id,
        contactId: chatId,
        contactName,
        contactPhone,
        unreadCount: 0,
        isGroup: false,
        labels: [],
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      upsertConversation(conv);
      return conv;
    },
    [upsertConversation]
  );

  const activeConversation = activeConversationId
    ? conversations.find((c) => c.id === activeConversationId) || null
    : null;

  const activeMessages = activeConversationId ? messages[activeConversationId] || [] : [];

  return {
    conversations,
    messages,
    activeConversation,
    activeConversationId,
    activeMessages,
    isLoading,
    setActiveConversationId,
    upsertConversation,
    addMessage,
    markAsRead,
    sendMessage,
    createConversation,
  };
}
