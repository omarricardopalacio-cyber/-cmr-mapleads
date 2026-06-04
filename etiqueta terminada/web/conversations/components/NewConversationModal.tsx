// ============================================================
// NewConversationModal — Formulario para iniciar chat nuevo
// ============================================================

import React, { useState } from "react";

interface NewConversationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (phone: string, name: string, message: string) => void;
  sessions: { id: string; name: string }[];
}

export const NewConversationModal: React.FC<NewConversationModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  sessions,
}) => {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [sessionId, setSessionId] = useState(sessions[0]?.id || "");

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPhone = phone.replace(/\D/g, "");
    if (!cleanPhone) return;
    onSubmit(cleanPhone, name || cleanPhone, message);
    setPhone("");
    setName("");
    setMessage("");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[#1f2c34] rounded-lg w-full max-w-md p-6 shadow-2xl">
        <h3 className="text-[#e9edef] text-lg font-semibold mb-4">
          Iniciar conversación
        </h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Session selector */}
          <div>
            <label className="text-[#8696a0] text-sm block mb-1">Sesión WhatsApp</label>
            <select
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              className="w-full bg-[#2a3942] text-[#e9edef] rounded px-3 py-2 outline-none border border-[#2a3942] focus:border-[#00a884]"
            >
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {/* Phone */}
          <div>
            <label className="text-[#8696a0] text-sm block mb-1">
              Número con código país *
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="573003918780"
              required
              className="w-full bg-[#2a3942] text-[#e9edef] rounded px-3 py-2 outline-none border border-[#2a3942] focus:border-[#00a884] placeholder-[#8696a0]"
            />
            <p className="text-[#8696a0] text-[11px] mt-1">
              Sin "+". Sin espacios. Se agrega @c.us automáticamente.
            </p>
          </div>

          {/* Name */}
          <div>
            <label className="text-[#8696a0] text-sm block mb-1">Nombre (opcional)</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nombre del contacto"
              className="w-full bg-[#2a3942] text-[#e9edef] rounded px-3 py-2 outline-none border border-[#2a3942] focus:border-[#00a884] placeholder-[#8696a0]"
            />
          </div>

          {/* Message */}
          <div>
            <label className="text-[#8696a0] text-sm block mb-1">Mensaje inicial</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Hola! Mensaje de prueba desde el CRM."
              rows={3}
              className="w-full bg-[#2a3942] text-[#e9edef] rounded px-3 py-2 outline-none border border-[#2a3942] focus:border-[#00a884] placeholder-[#8696a0] resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded text-[#e9edef] bg-[#2a3942] hover:bg-[#3a4a54] transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex-1 py-2 rounded text-white bg-[#00a884] hover:bg-[#008f72] transition font-medium"
            >
              Enviar mensaje
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
