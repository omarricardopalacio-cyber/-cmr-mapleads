# Prompt Completo para Lovable — Módulo Conversaciones WhatsApp

Copia TODO el texto entre las líneas `---` y pégalo en el chat de Lovable (modo Edit).

---

## PROMPT (copiar desde aquí hasta el final)

Mi extensión de Chrome MAPLE WA Engine ya está conectada y funcionando con WhatsApp Web. La sesión "ventas" está activa y enviando eventos al backend. Necesito completar el módulo `/conversations` que ya empezaste con la lista de chats.

### Contexto de mi backend

Mi proyecto Lovable tiene estos endpoints activos:
- Backend URL: `https://project-289483ef-62cc-4bc6-91f6-2ef8e90b8d34.dev.lovable.app`
- Enviar mensaje: `POST /api/public/engine/commands`
- Recibir eventos: `POST /api/public/engine/events` (o polling)
- Las sesiones guardan `sessionToken` y `backendUrl` en la tabla `wa_sessions`

### Cambio 1: Panel derecho de mensajes (chat en vivo)

Cuando toco un chat de la lista izquierda, la columna derecha debe mostrar:

- **Header**: avatar con inicial del nombre, nombre del contacto, estado "WhatsApp"
- **Área de mensajes**: 
  - Burbujas entrantes (de ellos): fondo `#f0f0f0`, texto negro, alineadas izquierda, border-radius `8px 8px 8px 0`
  - Burbujas salientes (míos): fondo `#dcf8c6`, texto negro, alineadas derecha, border-radius `8px 8px 0 8px`
  - Metadatos debajo: hora (formato 2:30 p.m.) + checks: enviado `✓`, recibido `✓✓`, leído `✓✓` azul `#34b7f1`
  - Separadores de fecha centrados: "Hoy", "Ayer", fecha completa
- **Input inferior**: campo de texto + botón enviar (paper plane icon), fondo `#f0f0f0`

Si no hay chat seleccionado, mostrar placeholder centrado: "Selecciona una conversación para ver los mensajes" con icono 💬.

### Cambio 2: Enviar mensajes desde el CRM hacia WhatsApp

El botón "Enviar mensaje de prueba" del modal que ya existe debe conectar con mi endpoint real:

```typescript
async function sendMessage(phone: string, text: string) {
  const session = await getActiveSession(); // de tu tabla wa_sessions
  const res = await fetch(`${session.backendUrl}/api/public/engine/commands`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-session-token": session.sessionToken,
    },
    body: JSON.stringify({
      type: "SEND_MESSAGE",
      payload: {
        chatId: phone + "@c.us",
        text: text,
      }
    }),
  });
  return res.ok;
}
```

Después de enviar, hacer **optimistic update**: agregar el mensaje inmediatamente al chat con `direction: "outgoing"`, `ack: 0`, y marcarlo como "pendiente". Cuando el backend confirme, actualizar a `ack: 1`.

### Cambio 3: Recibir mensajes entrantes en tiempo real

Implementar **Supabase Realtime** en la tabla `messages`. Cuando la extensión envía un evento al backend, este inserta en `messages`, y el CRM debe recibirlo instantáneamente via suscripción.

Alternativa temporal: polling cada 3 segundos a un endpoint que devuelva mensajes nuevos.

### Esquema Supabase exacto

Crear estas tablas con sus políticas RLS:

```sql
-- Conversaciones
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  contact_name TEXT,
  contact_phone TEXT NOT NULL,
  unread_count INT DEFAULT 0,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Mensajes
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  direction TEXT CHECK (direction IN ('incoming','outgoing')),
  body TEXT NOT NULL,
  from_me BOOLEAN DEFAULT false,
  ack INT DEFAULT 0,
  timestamp BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_session ON conversations(session_id, updated_at DESC);

-- Políticas RLS básicas (autenticado puede leer/escribir)
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all" ON conversations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON messages FOR ALL USING (true) WITH CHECK (true);
```

### Datos mock para demo

Mientras conectamos todo, usa estos datos en el frontend:

```typescript
const mockConversations = [
  {
    id: "conv-1",
    session_id: "ventas",
    contact_id: "573003918780@c.us",
    contact_name: "Juan Pérez",
    contact_phone: "573003918780",
    unread_count: 2,
    last_message_at: new Date(Date.now() - 300000).toISOString(),
    messages: [
      { id: "m1", direction: "incoming", body: "Hola, ¿cómo estás?", from_me: false, ack: 2, timestamp: Date.now() - 300000, created_at: new Date(Date.now() - 300000).toISOString() },
      { id: "m2", direction: "outgoing", body: "Bien, gracias. ¿Y tú?", from_me: true, ack: 3, timestamp: Date.now() - 240000, created_at: new Date(Date.now() - 240000).toISOString() },
      { id: "m3", direction: "incoming", body: "Todo bien, quería preguntar por el servicio", from_me: false, ack: 2, timestamp: Date.now() - 180000, created_at: new Date(Date.now() - 180000).toISOString() },
    ]
  },
  {
    id: "conv-2",
    session_id: "ventas",
    contact_id: "573004567890@c.us",
    contact_name: "María García",
    contact_phone: "573004567890",
    unread_count: 0,
    last_message_at: new Date(Date.now() - 3600000).toISOString(),
    messages: [
      { id: "m4", direction: "outgoing", body: "Gracias por tu interés", from_me: true, ack: 3, timestamp: Date.now() - 4000000, created_at: new Date(Date.now() - 4000000).toISOString() },
      { id: "m5", direction: "incoming", body: "Gracias por la info, lo reviso y te aviso", from_me: false, ack: 2, timestamp: Date.now() - 3600000, created_at: new Date(Date.now() - 3600000).toISOString() },
    ]
  },
];
```

### Hook useConversations

Crear un hook `useConversations(sessionId: string)` que maneje:

```typescript
interface UseConversationsReturn {
  conversations: Conversation[];
  activeConversation: Conversation | null;
  activeMessages: Message[];
  isLoading: boolean;
  setActiveConversationId: (id: string) => void;
  sendMessage: (text: string) => Promise<boolean>;
  createConversation: (phone: string, name: string, message?: string) => Promise<void>;
  markAsRead: (conversationId: string) => void;
}
```

Lógica del hook:
1. Cargar conversaciones de Supabase (o mock inicialmente)
2. Cuando `setActiveConversationId` se llama, marcar `unread_count = 0` para esa conversación
3. `sendMessage` hace el POST al backend + optimistic update local
4. `createConversation` crea en Supabase (o local) y abre el chat
5. Escuchar nuevos mensajes via Supabase Realtime (o polling)

### Responsive

- **Desktop**: sidebar fijo 380px izquierda, panel derecho flexible
- **Móvil (< 768px)**: solo se ve la lista. Al tocar un chat, navega al panel con botón "← Volver" en el header

### Estado actual que ya tienes

Lovable ya construyó:
- ✅ Página `/conversations` con sidebar "Chats", búsqueda, botón "+"
- ✅ Modal "Iniciar conversación" con: selector sesión, input teléfono, input mensaje, botón "Enviar mensaje de prueba"
- ✅ Página `/sessions` con sesión "ventas" connected
- ✅ Dashboard con cards de resumen

**Lo que falta:** panel derecho de mensajes, conexión real al endpoint, y recepción de mensajes.

Por favor implementa los 3 cambios en la página `/conversations` existente usando los datos mock primero, y luego conectamos Supabase.

---

## FIN DEL PROMPT

---

## Instrucciones para usar

1. Copia TODO el texto entre `--- PROMPT (copiar desde aquí hasta el final)` y `--- FIN DEL PROMPT`
2. Ve a Lovable → chat de edición
3. Pega el prompt completo
4. Si es muy largo, pega las secciones 1 y 2 primero, luego 3, luego el esquema SQL

Si Lovable dice "too long", envíalo en 2 partes:
- **Parte 1:** Cambio 1 (panel derecho) + Cambio 2 (enviar mensaje) + datos mock
- **Parte 2:** Cambio 3 (recibir mensajes) + esquema Supabase + hook
