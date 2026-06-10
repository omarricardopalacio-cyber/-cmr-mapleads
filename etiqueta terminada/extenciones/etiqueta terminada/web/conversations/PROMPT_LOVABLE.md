# Prompt para Lovable — Módulo de Conversaciones WhatsApp

Copia y pega este prompt en el chat de Lovable (modo "Edit" o "Improve"):

---

## PROMPT (copiar desde aquí)

Quiero implementar un **módulo de conversaciones tipo WhatsApp Web** en mi CRM. Ya tengo el backend funcionando con una extensión de Chrome que se conecta a WhatsApp Web y envía/recibe mensajes.

### 1. Componente UI: Panel de Conversaciones

Crear una página `/conversations` con layout de 2 columnas estilo WhatsApp Web oscuro:

**Columna izquierda — Lista de chats:**
- Header "Conversaciones" con botón "+" para iniciar chat nuevo
- Barra de búsqueda de conversaciones
- Lista scrollable con: avatar (inicial si no hay foto), nombre, último mensaje preview, hora, badge de no leídos
- Fondo `#111b21`, items hover `#202c33`, activo `#2a3942`
- Texto `#e9edef`, secundario `#8696a0`

**Columna derecha — Panel de mensajes:**
- Header con avatar, nombre del contacto, estado
- Área de mensajes con fondo patrón `#0b141a`
- Burbujas: salientes `#005c4b`, entrantes `#1f2c34`
- Fechas separadoras, checks de estado (enviado ✓, recibido ✓✓, leído ✓✓ azul)
- Barra de input inferior con emoji button, campo de texto, botón enviar

**Modal "Nueva conversación":**
- Selector de sesión WhatsApp
- Input teléfono (con código país, sin +, sin espacios)
- Input nombre (opcional)
- Textarea mensaje inicial
- Botón "Enviar mensaje"

### 2. Hook de datos: useConversations

Crear hook que maneje:
- Estado de conversaciones y mensajes
- localStorage como cache offline
- Polling cada 3 segundos al backend para nuevos mensajes
- Optimistic update al enviar
- Deduplicación por message ID

Tipos:
```typescript
interface Conversation {
  id: string;
  sessionId: string;
  contactId: string;      // ej: "573003918780@c.us"
  contactName: string;
  contactPhone: string;
  profilePicture?: string;
  lastMessage?: Message;
  unreadCount: number;
  updatedAt: string;
}

interface Message {
  id: string;
  conversationId: string;
  direction: "incoming" | "outgoing";
  type: "chat" | "image" | "video" | "audio" | "document";
  body: string;
  fromMe: boolean;
  ack: number;            // 0=pending, 1=sent, 2=received, 3=read
  timestamp: number;
  createdAt: string;
}
```

### 3. Integración con Backend

**Enviar mensaje (desde CRM hacia WhatsApp):**
```
POST /api/public/engine/commands
Headers: { "Content-Type": "application/json", "x-session-token": "TOKEN" }
Body: {
  "type": "SEND_MESSAGE",
  "payload": {
    "chatId": "573003918780@c.us",
    "text": "Hola desde el CRM"
  }
}
```

**Recibir mensajes (la extensión envía al backend, el CRM hace polling):**
```
GET /api/public/engine/events?since=TIMESTAMP
Headers: { "x-session-token": "TOKEN" }
```

O usar Supabase Realtime (preferido) para escuchar nuevos mensajes en tiempo real.

### 4. Esquema Supabase

Crear tablas:

```sql
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
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

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  whatsapp_msg_id TEXT,
  direction TEXT CHECK (direction IN ('incoming','outgoing')),
  type TEXT DEFAULT 'chat',
  body TEXT NOT NULL,
  from_me BOOLEAN DEFAULT false,
  ack INT DEFAULT 0,
  timestamp BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id, timestamp DESC);
CREATE INDEX idx_conversations_session ON conversations(session_id, updated_at DESC);
```

### 5. Responsive

- Desktop: 2 columnas fijas (sidebar 380px, panel restante)
- Móvil: solo sidebar, al tocar chat navega a panel con botón "←" volver

### 6. Datos de ejemplo

Usar estos datos mock para mostrar la UI funcionando mientras conectamos el backend:

```typescript
const mockConversations = [
  {
    id: "conv-1",
    contactName: "Juan Pérez",
    contactPhone: "573003918780",
    lastMessage: { body: "Hola, ¿cómo estás?", timestamp: Date.now() - 300000 },
    unreadCount: 2,
  },
  {
    id: "conv-2", 
    contactName: "María García",
    contactPhone: "573004567890",
    lastMessage: { body: "Gracias por la info", timestamp: Date.now() - 3600000 },
    unreadCount: 0,
  },
];
```

**Por favor implementa todo esto en una sola página `/conversations` con los componentes separados.**

---

## FIN DEL PROMPT

---

## Notas adicionales para ti (no incluir en Lovable)

Si Lovable no entiende alguna parte, desglosa el prompt en secciones más pequeñas:

1. Primero pide: "Crea una página /conversations con layout de 2 columnas estilo WhatsApp Web"
2. Luego: "Agrega el hook useConversations con localStorage"
3. Luego: "Conecta con Supabase para persistencia real"
4. Luego: "Agrega el modal para iniciar conversación nueva"

Los componentes exactos que necesitas ya están creados en:
`maple-wa-engine/web/conversations/components/`

Puedes copiar/pegar los componentes a Lovable directamente si prefieres no usar el prompt.
