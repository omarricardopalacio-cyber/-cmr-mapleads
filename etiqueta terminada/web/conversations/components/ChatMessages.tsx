// ============================================================
// ChatMessages — Panel derecho de mensajes tipo WhatsApp
// ============================================================

import React, { useRef, useEffect } from "react";
import type { Conversation, Message } from "../types";

interface ChatMessagesProps {
  conversation: Conversation | null;
  messages: Message[];
  onBack?: () => void;
}

export const ChatMessages: React.FC<ChatMessagesProps> = ({
  conversation,
  messages,
  onBack,
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (!conversation) {
    return (
      <div className="flex-1 bg-[#0b141a] flex items-center justify-center text-[#8696a0]">
        <div className="text-center">
          <div className="text-6xl mb-4 opacity-20">💬</div>
          <p className="text-lg">Selecciona una conversación para comenzar</p>
          <p className="text-sm mt-2 opacity-70">
            O inicia una nueva desde el panel izquierdo
          </p>
        </div>
      </div>
    );
  }

  const formatDate = (timestamp: number) => {
    const d = new Date(timestamp);
    return d.toLocaleDateString([], { day: "numeric", month: "short" });
  };

  const formatTime = (timestamp: number) => {
    const d = new Date(timestamp);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  // Agrupar mensajes por fecha
  const groups: { date: string; items: Message[] }[] = [];
  messages.forEach((msg) => {
    const dateLabel = formatDate(msg.timestamp);
    const last = groups[groups.length - 1];
    if (last && last.date === dateLabel) {
      last.items.push(msg);
    } else {
      groups.push({ date: dateLabel, items: [msg] });
    }
  });

  return (
    <div className="flex-1 flex flex-col bg-[#0b141a] bg-[url('https://web.whatsapp.com/img/bg-chat-tile-dark_a4be451.png')] bg-repeat">
      {/* Header */}
      <div className="h-[60px] bg-[#1f2c34] border-l border-[#222e35] flex items-center px-4 shrink-0">
        {onBack && (
          <button onClick={onBack} className="mr-3 text-[#aebac1] lg:hidden">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        <div className="w-10 h-10 rounded-full bg-[#6b7c85] flex items-center justify-center text-white text-sm font-medium shrink-0 overflow-hidden">
          {conversation.profilePicture ? (
            <img src={conversation.profilePicture} alt="" className="w-full h-full object-cover" />
          ) : (
            (conversation.contactName || conversation.contactPhone || "?")[0].toUpperCase()
          )}
        </div>
        <div className="ml-3 flex-1 min-w-0">
          <div className="text-[#e9edef] text-[15px] font-medium truncate">
            {conversation.contactName || conversation.contactPhone}
          </div>
          <div className="text-[#8696a0] text-[13px]">
            {conversation.isGroup ? "Grupo" : "WhatsApp"}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-[5%] py-4">
        {messages.length === 0 && (
          <div className="text-center text-[#8696a0] mt-10 text-sm">
            No hay mensajes aún. Escribe el primer mensaje.
          </div>
        )}

        {groups.map((group) => (
          <div key={group.date}>
            {/* Date separator */}
            <div className="flex justify-center my-4">
              <span className="bg-[#1f2c34] text-[#8696a0] text-[12px] px-3 py-1 rounded-lg">
                {group.date}
              </span>
            </div>

            {group.items.map((msg) => {
              const isOutgoing = msg.direction === "outgoing" || msg.fromMe;
              return (
                <div
                  key={msg.id}
                  className={`flex mb-1 ${isOutgoing ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[75%] px-2 py-1.5 rounded-lg text-[14px] leading-[19px] relative ${
                      isOutgoing
                        ? "bg-[#005c4b] text-[#e9edef] rounded-tr-none"
                        : "bg-[#1f2c34] text-[#e9edef] rounded-tl-none"
                    }`}
                  >
                    {/* Author in groups */}
                    {msg.author && !msg.fromMe && (
                      <div className="text-[#53bdeb] text-[13px] font-medium mb-0.5">
                        {msg.author.name}
                      </div>
                    )}

                    {/* Body */}
                    <div className="break-words whitespace-pre-wrap">{msg.body}</div>

                    {/* Media caption */}
                    {msg.caption && (
                      <div className="text-[13px] opacity-80 mt-1">{msg.caption}</div>
                    )}

                    {/* Footer: time + check */}
                    <div className="flex items-center justify-end gap-1 mt-0.5">
                      <span className="text-[10px] opacity-60">
                        {formatTime(msg.timestamp)}
                      </span>
                      {isOutgoing && (
                        <span className="opacity-60">
                          {msg.ack >= 2 ? (
                            <svg className="w-3.5 h-3.5 text-[#53bdeb]" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M18 7l-8 8-4-4 1.41-1.41L10 12.17 16.59 5.59 18 7zM6.59 13.41L10 16.83l8-8L19.59 10 10 19.41 4.41 13.83 6.59 13.41z" />
                            </svg>
                          ) : msg.ack >= 1 ? (
                            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M18 7l-8 8-4-4 1.41-1.41L10 12.17 16.59 5.59 18 7z" />
                            </svg>
                          ) : (
                            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                            </svg>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        <div ref={bottomRef} />
      </div>
    </div>
  );
};
