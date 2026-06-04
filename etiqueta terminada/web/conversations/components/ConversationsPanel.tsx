// ============================================================
// ConversationsPanel — Componente principal que ensambla todo
// Layout: ChatList (izquierda) | ChatMessages + ChatInput (derecha)
// ============================================================

import React, { useState } from "react";
import { useConversations } from "../hooks/useConversations";
import { ChatList } from "./ChatList";
import { ChatMessages } from "./ChatMessages";
import { ChatInput } from "./ChatInput";
import { NewConversationModal } from "./NewConversationModal";
import type { Session } from "../types";

interface ConversationsPanelProps {
  sessionId?: string;
  sessions?: Session[];
}

export const ConversationsPanel: React.FC<ConversationsPanelProps> = ({
  sessionId,
  sessions = [],
}) => {
  const {
    conversations,
    activeConversation,
    activeConversationId,
    activeMessages,
    setActiveConversationId,
    sendMessage,
    createConversation,
    markAsRead,
  } = useConversations(sessionId);

  const [searchQuery, setSearchQuery] = useState("");
  const [showNewChat, setShowNewChat] = useState(false);
  const [mobileView, setMobileView] = useState<"list" | "chat">("list");

  const handleSelect = (id: string) => {
    setActiveConversationId(id);
    markAsRead(id);
    setMobileView("chat");
  };

  const handleBack = () => {
    setMobileView("list");
    setActiveConversationId(null);
  };

  const handleSend = async (text: string) => {
    if (!activeConversation || !sessionId) return;
    await sendMessage({
      sessionId,
      chatId: activeConversation.contactId,
      text,
    });
  };

  const handleNewChat = (phone: string, name: string, message: string) => {
    if (!sessionId) return;
    createConversation(phone, name, sessionId).then((conv) => {
      if (message.trim()) {
        sendMessage({
          sessionId,
          chatId: conv.contactId,
          text: message,
        });
      }
      setActiveConversationId(conv.id);
      setMobileView("chat");
    });
  };

  return (
    <div className="h-screen w-full bg-[#111b21] flex overflow-hidden text-[#e9edef]">
      {/* Left sidebar */}
      <div
        className={`${
          mobileView === "chat" ? "hidden lg:flex" : "flex"
        } w-full lg:w-auto h-full`}
      >
        <ChatList
          conversations={conversations}
          activeId={activeConversationId}
          onSelect={handleSelect}
          onNewChat={() => setShowNewChat(true)}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />
      </div>

      {/* Right panel */}
      <div
        className={`${
          mobileView === "list" ? "hidden lg:flex" : "flex"
        } flex-1 h-full flex-col`}
      >
        <ChatMessages
          conversation={activeConversation}
          messages={activeMessages}
          onBack={handleBack}
        />
        {activeConversation && (
          <ChatInput
            onSend={handleSend}
            disabled={!sessionId}
          />
        )}
      </div>

      {/* New conversation modal */}
      <NewConversationModal
        isOpen={showNewChat}
        onClose={() => setShowNewChat(false)}
        onSubmit={handleNewChat}
        sessions={sessions.map((s) => ({ id: s.id, name: s.profileName || s.phoneNumber || s.id }))}
      />
    </div>
  );
};
