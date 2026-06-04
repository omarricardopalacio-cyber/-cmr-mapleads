// ============================================================
// ChatList — Sidebar izquierdo tipo WhatsApp
// ============================================================

import React from "react";
import type { Conversation } from "../types";

interface ChatListProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
}

export const ChatList: React.FC<ChatListProps> = ({
  conversations,
  activeId,
  onSelect,
  onNewChat,
  searchQuery,
  onSearchChange,
}) => {
  const filtered = conversations.filter((c) =>
    (c.contactName || c.contactPhone)
      .toLowerCase()
      .includes(searchQuery.toLowerCase())
  );

  const formatTime = (iso?: string) => {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="flex flex-col h-full w-full max-w-[380px] bg-[#111b21] border-r border-[#222e35]">
      {/* Header */}
      <div className="p-4 bg-[#1f2c34] flex items-center justify-between">
        <h2 className="text-[#e9edef] font-semibold text-lg">Conversaciones</h2>
        <button
          onClick={onNewChat}
          className="w-9 h-9 rounded-full bg-[#00a884] text-white flex items-center justify-center hover:bg-[#008f72] transition"
          title="Nueva conversación"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2">
        <div className="bg-[#1f2c34] rounded-lg flex items-center px-3 py-2">
          <svg className="w-4 h-4 text-[#8696a0] mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Buscar conversación..."
            className="bg-transparent text-sm text-[#e9edef] placeholder-[#8696a0] outline-none w-full"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="text-[#8696a0] text-sm text-center mt-10 px-4">
            {searchQuery ? "No se encontraron resultados" : "Sin conversaciones. Inicia una nueva."}
          </div>
        )}

        {filtered.map((conv) => {
          const isActive = conv.id === activeId;
          return (
            <div
              key={conv.id}
              onClick={() => onSelect(conv.id)}
              className={`flex items-center px-3 py-3 cursor-pointer transition ${
                isActive ? "bg-[#2a3942]" : "hover:bg-[#202c33]"
              }`}
            >
              {/* Avatar */}
              <div className="w-12 h-12 rounded-full bg-[#6b7c85] flex items-center justify-center text-white font-medium text-sm shrink-0 overflow-hidden">
                {conv.profilePicture ? (
                  <img src={conv.profilePicture} alt="" className="w-full h-full object-cover" />
                ) : (
                  (conv.contactName || conv.contactPhone || "?")[0].toUpperCase()
                )}
              </div>

              {/* Info */}
              <div className="ml-3 flex-1 min-w-0">
                <div className="flex justify-between items-baseline">
                  <span className="text-[#e9edef] text-sm font-medium truncate">
                    {conv.contactName || conv.contactPhone}
                  </span>
                  {conv.lastMessage && (
                    <span className="text-[#8696a0] text-[11px] ml-1 shrink-0">
                      {formatTime(conv.lastMessage.createdAt)}
                    </span>
                  )}
                </div>
                <div className="flex items-center mt-0.5">
                  {conv.lastMessage?.fromMe && (
                    <svg className="w-3 h-3 text-[#53bdeb] mr-1 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                    </svg>
                  )}
                  <span className="text-[#8696a0] text-[13px] truncate">
                    {conv.lastMessage?.body || "Sin mensajes"}
                  </span>
                </div>
              </div>

              {/* Unread badge */}
              {conv.unreadCount > 0 && (
                <div className="ml-2 bg-[#00a884] text-[#111b21] text-[11px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                  {conv.unreadCount}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
