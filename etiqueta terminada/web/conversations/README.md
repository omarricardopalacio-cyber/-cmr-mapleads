# Módulo de Conversaciones — MAPLE WA ENGINE

## Qué es

Un **panel de chat estilo WhatsApp Web** para tu CRM. Incluye:

- Lista de conversaciones a la izquierda (con búsqueda, badges de no leídos)
- Panel de mensajes a la derecha (con burbujas, fechas, checks de estado)
- Input para enviar mensajes
- Modal para iniciar conversación nueva
- Persistencia local + sincronización con backend

## Estructura

```
web/conversations/
├── types.ts                         # Tipos TypeScript
├── hooks/
│   └── useConversations.ts          # Hook de estado y lógica
├── components/
│   ├── ConversationsPanel.tsx       # Componente principal (layout)
│   ├── ChatList.tsx                 # Sidebar de chats
│   ├── ChatMessages.tsx             # Panel de mensajes
│   ├── ChatInput.tsx                # Barra de input
│   └── NewConversationModal.tsx     # Modal "Nueva conversación"
├── index.ts                         # Exportaciones
└── README.md                        # Este archivo
```

## Integración rápida

### 1. Copiar a tu proyecto

Copia toda la carpeta `conversations/` a tu proyecto React/Next.js.

### 2. Instalar dependencias (si no las tienes)

```bash
npm install react react-dom
# Tu proyecto ya debería tenerlas
```

### 3. Usar el componente

```tsx
import { ConversationsPanel } from "./conversations";

function ConversationsPage() {
  // Reemplazar con sesiones reales desde tu backend
  const sessions = [
    {
      id: "wa-573003918780-1717020000000",
      phoneNumber: "573003918780",
      profileName: "Auto (ventas)",
      status: "connected",
    },
  ];

  return (
    <ConversationsPanel
      sessionId={sessions[0]?.id}
      sessions={sessions}
    />
  );
}
```

## Conectar con el backend

Actualmente `useConversations` usa `localStorage` como demo. Para conectar con tu backend real, edita las funciones comentadas en `useConversations.ts`:

### Recibir mensajes (polling)

```typescript
// En el useEffect de polling:
const res = await fetch(`${BACKEND_URL}/api/conversations/messages?since=${lastSync}`);
const data = await res.json();
data.messages.forEach(addMessage);
```

### Enviar mensajes

```typescript
// En sendMessage:
await fetch(`${BACKEND_URL}/api/public/engine/commands`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-session-token": token },
  body: JSON.stringify({
    type: "SEND_MESSAGE",
    payload: { chatId: payload.chatId, text: payload.text }
  }),
});
```

## Esquema de base de datos (Supabase)

```sql
-- Conversaciones
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,        -- WhatsApp ID: 573003918780@c.us
  contact_name TEXT,
  contact_phone TEXT NOT NULL,
  profile_picture TEXT,
  is_group BOOLEAN DEFAULT false,
  labels TEXT[] DEFAULT '{}',
  unread_count INT DEFAULT 0,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Mensajes
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  whatsapp_msg_id TEXT,            -- ID único de WhatsApp
  direction TEXT CHECK (direction IN ('incoming','outgoing')),
  type TEXT DEFAULT 'chat',
  body TEXT NOT NULL,
  caption TEXT,
  media_url TEXT,
  from_me BOOLEAN DEFAULT false,
  author JSONB,                    -- { name, phone } para grupos
  ack INT DEFAULT 0,               -- 0=pending,1=sent,2=received,3=read
  timestamp BIGINT NOT NULL,       -- Unix ms de WhatsApp
  synced BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_messages_conversation ON messages(conversation_id, timestamp DESC);
CREATE INDEX idx_conversations_session ON conversations(session_id, updated_at DESC);
CREATE INDEX idx_messages_whatsapp_id ON messages(whatsapp_msg_id);

-- Políticas RLS (si usas Supabase Auth)
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
```

## Personalización

### Colores

Los colores usan las variables de Tailwind de WhatsApp Web oscuro:

- Fondo: `#111b21` / `#0b141a`
- Burbuja saliente: `#005c4b`
- Burbuja entrante: `#1f2c34`
- Texto: `#e9edef`
- Verde WhatsApp: `#00a884`

Puedes cambiarlos directamente en las clases Tailwind de los componentes.

## Responsive

En móvil (`< 1024px`):
- Solo se ve la lista de chats
- Al tocar un chat, se navega al panel de mensajes
- Botón "←" para volver a la lista

En desktop (`≥ 1024px`):
- Layout de 2 columnas tipo WhatsApp Web

## Roadmap

- [ ] Conectar polling real con backend
- [ ] WebSocket para mensajes en tiempo real
- [ ] Adjuntar imágenes/documentos
- [ ] Reacciones y respuestas citadas
- [ ] Búsqueda de mensajes dentro del chat
