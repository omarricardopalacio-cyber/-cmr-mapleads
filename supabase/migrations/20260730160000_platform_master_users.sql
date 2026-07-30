-- Master / control de usuarios de plataforma
-- 1) Flag activo/inactivo en profiles
-- 2) Asegurar SUPER_ADMIN al dueño (omarricardopalacio@gmail.com)

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.profiles.is_active IS
  'Si false, el usuario no puede usar la plataforma (control master).';

CREATE INDEX IF NOT EXISTS idx_profiles_is_active ON public.profiles (is_active);

-- Promover a master (SUPER_ADMIN) el usuario seed de la plataforma
INSERT INTO public.platform_roles (user_id, role)
SELECT u.id, 'SUPER_ADMIN'::public.platform_role
FROM auth.users u
WHERE lower(u.email) = lower('omarricardopalacio@gmail.com')
ON CONFLICT (user_id, role) DO NOTHING;

-- Perfil activo para el master
UPDATE public.profiles p
SET is_active = true
FROM auth.users u
WHERE p.id = u.id
  AND lower(u.email) = lower('omarricardopalacio@gmail.com');
