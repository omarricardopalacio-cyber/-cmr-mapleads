import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type FailedAiRequest = {
  id?: string;
  org_id: string;
  thread_id: string;
  chat_id: string;
  session_id: string;
  original_message: string;
  error_message: string;
  retry_count: number;
  max_retries: number;
  next_retry_at: Date;
  created_at?: Date;
  updated_at?: Date;
  status: 'pending' | 'retrying' | 'resolved' | 'failed';
  context_data?: Record<string, unknown>;
};

/**
 * Registra una solicitud de IA fallida para reintento automático
 */
export async function registerFailedAiRequest(
  orgId: string,
  threadId: string,
  chatId: string,
  sessionId: string,
  originalMessage: string,
  errorMessage: string,
  retryCount: number = 0,
  maxRetries: number = 3,
  contextData?: Record<string, unknown>
): Promise<string | null> {
  const now = new Date();
  const nextRetryAt = new Date(now.getTime() + 3 * 60 * 1000); // 3 minutos

  try {
    const { data, error } = await supabaseAdmin
      .from('failed_ai_requests')
      .insert({
        org_id: orgId,
        thread_id: threadId,
        chat_id: chatId,
        session_id: sessionId,
        original_message: originalMessage,
        error_message: errorMessage,
        retry_count: retryCount,
        max_retries: maxRetries,
        next_retry_at: nextRetryAt.toISOString(),
        status: 'pending',
        context_data: contextData || {},
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      console.error('[registerFailedAiRequest] Error inserting failed request:', error);
      return null;
    }

    return data?.id || null;
  } catch (err) {
    console.error('[registerFailedAiRequest] Exception:', err);
    return null;
  }
}

/**
 * Envía mensaje de apoyo (widget naranja) al usuario
 */
export async function sendSupportMessage(
  orgId: string,
  sessionId: string,
  chatId: string,
  requestId: string,
  threadId?: string
): Promise<void> {
  try {
    const supportWidgetText = `[SUPPORT_WIDGET:${requestId}:${threadId || 'unknown'}]`;
    
    await supabaseAdmin.from('engine_commands').insert({
      org_id: orgId,
      session_id: sessionId,
      type: 'SEND_MESSAGE',
      payload: {
        chatId,
        text: supportWidgetText,
      },
      status: 'pending',
    });
  } catch (err) {
    console.error('[sendSupportMessage] Error:', err);
  }
}

/**
 * Obtiene solicitudes de reintento pendientes
 */
export async function getPendingRetryRequests(): Promise<FailedAiRequest[]> {
  try {
    const now = new Date();
    const { data, error } = await supabaseAdmin
      .from('failed_ai_requests')
      .select('*')
      .eq('status', 'pending')
      .lte('next_retry_at', now.toISOString())
      .limit(10);

    if (error) {
      console.error('[getPendingRetryRequests] Query error:', error);
      return [];
    }

    return (data || []).map((row: any) => ({
      id: row.id,
      org_id: row.org_id,
      thread_id: row.thread_id,
      chat_id: row.chat_id,
      session_id: row.session_id,
      original_message: row.original_message,
      error_message: row.error_message,
      retry_count: row.retry_count,
      max_retries: row.max_retries,
      next_retry_at: new Date(row.next_retry_at),
      created_at: row.created_at ? new Date(row.created_at) : undefined,
      updated_at: row.updated_at ? new Date(row.updated_at) : undefined,
      status: row.status,
      context_data: row.context_data,
    }));
  } catch (err) {
    console.error('[getPendingRetryRequests] Exception:', err);
    return [];
  }
}

/**
 * Actualiza el estado de una solicitud fallida
 */
export async function updateFailedRequest(
  requestId: string,
  updates: Partial<FailedAiRequest>
): Promise<void> {
  try {
    await supabaseAdmin
      .from('failed_ai_requests')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestId);
  } catch (err) {
    console.error('[updateFailedRequest] Error:', err);
  }
}

/**
 * Limpia solicitudes resueltas (más de 1 hora)
 */
export async function cleanupOldResolvedRequests(): Promise<void> {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    await supabaseAdmin
      .from('failed_ai_requests')
      .delete()
      .eq('status', 'resolved')
      .lt('updated_at', oneHourAgo.toISOString());

    await supabaseAdmin
      .from('failed_ai_requests')
      .delete()
      .eq('status', 'failed')
      .lt('updated_at', oneHourAgo.toISOString());
  } catch (err) {
    console.error('[cleanupOldResolvedRequests] Error:', err);
  }
}
