ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.engine_commands REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.engine_commands;