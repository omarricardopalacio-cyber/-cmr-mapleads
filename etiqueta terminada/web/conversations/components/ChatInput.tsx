// ============================================================
// ChatInput — Barra inferior para escribir/enviar mensajes
// ============================================================

import React, { useState } from "react";

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSend,
  disabled,
  placeholder = "Escribe un mensaje...",
}) => {
  const [text, setText] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || disabled) return;
    onSend(text.trim());
    setText("");
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="h-[62px] bg-[#1f2c34] border-t border-[#222e35] flex items-center px-4 gap-3 shrink-0"
    >
      {/* Emoji button */}
      <button type="button" className="text-[#8696a0] hover:text-[#aebac1] transition">
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </button>

      {/* Text input */}
      <div className="flex-1 bg-[#2a3942] rounded-lg px-3 py-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={disabled ? "Conectando..." : placeholder}
          disabled={disabled}
          className="w-full bg-transparent text-[#e9edef] text-[15px] outline-none placeholder-[#8696a0]"
        />
      </div>

      {/* Send button */}
      <button
        type="submit"
        disabled={!text.trim() || disabled}
        className={`text-[#8696a0] transition ${
          text.trim() ? "text-[#00a884] hover:text-[#00c89e]" : "opacity-50"
        }`}
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
        </svg>
      </button>
    </form>
  );
};
