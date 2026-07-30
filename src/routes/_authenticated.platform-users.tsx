import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  claimMasterAccess,
  getPlatformUsersStats,
  listPlatformUsers,
  setPlatformUserActive,
} from "@/lib/platform-users.functions";
import { useIsSuperAdmin } from "@/hooks/use-super-admin";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Crown, Loader2, RefreshCw, Search, Users } from "lucide-react";

export const Route = createFileRoute("/_authenticated/platform-users")({
  component: PlatformUsersPage,
});

function PlatformUsersPage() {
  const qc = useQueryClient();
  const { isSuperAdmin, isLoading: loadingRole } = useIsSuperAdmin();
  const claimFn = useServerFn(claimMasterAccess);
  const statsFn = useServerFn(getPlatformUsersStats);
  const listFn = useServerFn(listPlatformUsers);
  const setActiveFn = useServerFn(setPlatformUserActive);

  const [search, setSearch] = useState("");
  const [onlyInactive, setOnlyInactive] = useState(false);
  const [page, setPage] = useState(1);

  const claimMut = useMutation({
    mutationFn: () => claimFn({}),
    onSuccess: (r) => {
      toast.success(r.granted ? "Ahora eres master de la plataforma" : "Ya eres master");
      qc.invalidateQueries({ queryKey: ["is-super-admin"] });
      qc.invalidateQueries({ queryKey: ["saasAccess"] });
      qc.invalidateQueries({ queryKey: ["platformUsers"] });
      qc.invalidateQueries({ queryKey: ["platformUsersStats"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data: stats, isLoading: loadingStats } = useQuery({
    queryKey: ["platformUsersStats"],
    queryFn: () => statsFn({}),
    enabled: isSuperAdmin,
  });

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["platformUsers", page, search, onlyInactive],
    queryFn: () =>
      listFn({
        data: {
          page,
          pageSize: 50,
          search: search || undefined,
          onlyInactive: onlyInactive || undefined,
        },
      }),
    enabled: isSuperAdmin,
  });

  const setActiveMut = useMutation({
    mutationFn: (vars: { userId: string; isActive: boolean }) =>
      setActiveFn({ data: vars }),
    onSuccess: (_r, vars) => {
      toast.success(vars.isActive ? "Usuario activado" : "Usuario desactivado");
      qc.invalidateQueries({ queryKey: ["platformUsers"] });
      qc.invalidateQueries({ queryKey: ["platformUsersStats"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const users = data?.users ?? [];
  const total = data?.total ?? 0;

  const filteredHint = useMemo(() => {
    if (!search && !onlyInactive) return null;
    return `${users.length} en esta página (filtro activo)`;
  }, [users.length, search, onlyInactive]);

  if (loadingRole) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-6">
        <Loader2 className="h-4 w-4 animate-spin" /> Verificando acceso master…
      </div>
    );
  }

  if (!isSuperAdmin) {
    return (
      <div className="max-w-lg space-y-4 p-6">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Crown className="h-6 w-6" /> Control de usuarios
        </h1>
        <p className="text-sm text-muted-foreground">
          Esta sección es solo para el <b>master</b> de la plataforma. Si eres el dueño
          (cuenta autorizada), pulsa el botón para activar tu rol.
        </p>
        <Button
          disabled={claimMut.isPending}
          onClick={() => claimMut.mutate()}
        >
          {claimMut.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Crown className="h-4 w-4 mr-2" />
          )}
          Convertirme en master
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Users className="h-6 w-6" /> Usuarios de la plataforma
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Vista master: total de cuentas y activar / desactivar acceso a toda la plataforma.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={isFetching}
          onClick={() => void refetch()}
        >
          <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Registrados</p>
          <p className="text-2xl font-semibold tabular-nums">
            {loadingStats ? "…" : stats?.totalUsers ?? 0}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Activos</p>
          <p className="text-2xl font-semibold tabular-nums text-emerald-500">
            {loadingStats ? "…" : stats?.activeUsers ?? 0}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Desactivados</p>
          <p className="text-2xl font-semibold tabular-nums text-amber-500">
            {loadingStats ? "…" : stats?.inactiveUsers ?? 0}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Organizaciones</p>
          <p className="text-2xl font-semibold tabular-nums">
            {loadingStats ? "…" : stats?.organizations ?? 0}
          </p>
        </Card>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar email, nombre u organización…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground whitespace-nowrap">
          <Switch
            checked={onlyInactive}
            onCheckedChange={(v) => {
              setOnlyInactive(v);
              setPage(1);
            }}
          />
          Solo desactivados
        </label>
      </div>

      {filteredHint ? (
        <p className="text-xs text-muted-foreground">{filteredHint}</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {total} usuarios en Auth · página {page}
        </p>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuario</TableHead>
                <TableHead>Organización</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Último acceso</TableHead>
                <TableHead className="text-right">Activo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                    Cargando usuarios…
                  </TableCell>
                </TableRow>
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No hay usuarios con ese filtro
                  </TableCell>
                </TableRow>
              ) : (
                users.map((u) => {
                  const org = u.memberships[0];
                  return (
                    <TableRow key={u.id} className={!u.isActive ? "opacity-60" : undefined}>
                      <TableCell>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium truncate">{u.displayName}</span>
                            {u.isMaster ? (
                              <Badge className="text-[10px] bg-amber-600 hover:bg-amber-600">
                                Master
                              </Badge>
                            ) : null}
                            {!u.isActive ? (
                              <Badge variant="secondary" className="text-[10px]">
                                Off
                              </Badge>
                            ) : null}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {org?.orgName || "—"}
                        {org?.orgStatus ? (
                          <span className="block text-[10px] text-muted-foreground">
                            {org.orgStatus}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">
                          {org?.role || "—"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {u.lastSignInAt
                          ? new Date(u.lastSignInAt).toLocaleString("es-CO")
                          : "Nunca"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Switch
                          checked={u.isActive}
                          disabled={u.isMaster || setActiveMut.isPending}
                          onCheckedChange={(checked) =>
                            setActiveMut.mutate({ userId: u.id, isActive: checked })
                          }
                        />
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <div className="flex items-center justify-between gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          Anterior
        </Button>
        <span className="text-xs text-muted-foreground">Página {page}</span>
        <Button
          variant="outline"
          size="sm"
          disabled={users.length < 50}
          onClick={() => setPage((p) => p + 1)}
        >
          Siguiente
        </Button>
      </div>
    </div>
  );
}
