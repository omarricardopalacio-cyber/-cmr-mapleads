import { createFileRoute } from '@tanstack/react-router'
import { supabaseAdmin } from '@/integrations/supabase/client.server'
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })

export const Route = createFileRoute('/api/admin/engine/failed-requests')({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),

      // GET - Listar solicitudes fallidas
      GET: async ({ request }) => {
        try {
          // Validar autenticación
          const authHeader = request.headers.get('authorization');
          if (!authHeader?.startsWith('Bearer ')) {
            return json(401, { error: 'Missing authorization' });
          }

          const token = authHeader.slice(7);
          const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
          if (authError || !user) {
            return json(401, { error: 'Invalid token' });
          }

          // Obtener org_id del usuario
          const { data: role } = await supabaseAdmin
            .from('user_roles')
            .select('org_id')
            .eq('user_id', user.id)
            .limit(1)
            .maybeSingle();

          if (!role) {
            return json(403, { error: 'No organization found' });
          }

          // Obtener parámetros de query
          const url = new URL(request.url);
          const status = url.searchParams.get('status');
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 500);
          const offset = Math.max(parseInt(url.searchParams.get('offset') || '0'), 0);

          // Construir query
          let query = supabaseAdmin
            .from('failed_ai_requests')
            .select('*', { count: 'exact' })
            .eq('org_id', role.org_id)
            .order('created_at', { ascending: false });

          if (status) {
            query = query.eq('status', status);
          }

          const { data: requests, count, error } = await query
            .range(offset, offset + limit - 1);

          if (error) {
            return json(500, { error: error.message });
          }

          return json(200, {
            success: true,
            data: requests || [],
            count,
            limit,
            offset,
          });
        } catch (err) {
          console.error('[failed-requests] GET error:', err);
          return json(500, { error: String(err) });
        }
      },

      // POST - Forzar reintento inmediato
      POST: async ({ request }) => {
        try {
          const authHeader = request.headers.get('authorization');
          if (!authHeader?.startsWith('Bearer ')) {
            return json(401, { error: 'Missing authorization' });
          }

          const token = authHeader.slice(7);
          const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
          if (authError || !user) {
            return json(401, { error: 'Invalid token' });
          }

          const { data: role } = await supabaseAdmin
            .from('user_roles')
            .select('org_id')
            .eq('user_id', user.id)
            .limit(1)
            .maybeSingle();

          if (!role) {
            return json(403, { error: 'No organization found' });
          }

          const body: any = await request.json();
          const { requestId, forceReset } = body;

          if (!requestId) {
            return json(400, { error: 'Missing requestId' });
          }

          // Verificar que la solicitud pertenece a la org del usuario
          const { data: req } = await supabaseAdmin
            .from('failed_ai_requests')
            .select('*')
            .eq('id', requestId)
            .eq('org_id', role.org_id)
            .maybeSingle();

          if (!req) {
            return json(404, { error: 'Request not found' });
          }

          // Si forceReset, resetear para reintento inmediato
          if (forceReset) {
            await supabaseAdmin
              .from('failed_ai_requests')
              .update({
                status: 'pending',
                retry_count: 0,
                next_retry_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq('id', requestId);

            return json(200, {
              success: true,
              message: 'Request reset for immediate retry',
              data: req,
            });
          } else {
            // Solo marcarlo como pending para el siguiente ciclo de cron
            await supabaseAdmin
              .from('failed_ai_requests')
              .update({
                status: 'pending',
                next_retry_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq('id', requestId);

            return json(200, {
              success: true,
              message: 'Request marked for retry',
              data: req,
            });
          }
        } catch (err) {
          console.error('[failed-requests] POST error:', err);
          return json(500, { error: String(err) });
        }
      },

      // DELETE - Eliminar/resolver solicitud
      DELETE: async ({ request }) => {
        try {
          const authHeader = request.headers.get('authorization');
          if (!authHeader?.startsWith('Bearer ')) {
            return json(401, { error: 'Missing authorization' });
          }

          const token = authHeader.slice(7);
          const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
          if (authError || !user) {
            return json(401, { error: 'Invalid token' });
          }

          const { data: role } = await supabaseAdmin
            .from('user_roles')
            .select('org_id')
            .eq('user_id', user.id)
            .limit(1)
            .maybeSingle();

          if (!role) {
            return json(403, { error: 'No organization found' });
          }

          const url = new URL(request.url);
          const requestId = url.searchParams.get('id');

          if (!requestId) {
            return json(400, { error: 'Missing id parameter' });
          }

          // Marcar como resuelto
          await supabaseAdmin
            .from('failed_ai_requests')
            .update({
              status: 'resolved',
              updated_at: new Date().toISOString(),
            })
            .eq('id', requestId)
            .eq('org_id', role.org_id);

          return json(200, { success: true, message: 'Request marked as resolved' });
        } catch (err) {
          console.error('[failed-requests] DELETE error:', err);
          return json(500, { error: String(err) });
        }
      },
    },
  },
})
