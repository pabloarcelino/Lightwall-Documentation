import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ArrowLeft, Plus, Pencil, UserCheck, UserX, Store, Shield, Eye, Clock, Users, ShieldAlert } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { LightwallBrand } from "@/components/LightwallLogo";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, ErrorState } from "@/components/ui/states";

interface UserRow {
  id: number;
  username: string;
  displayName: string | null;
  role: string;
  active: number;
  storeName: string | null;
  pricingProfileId: number | null;
  lastLoginAt: string | null;
  createdAt: string;
}

interface PricingProfileRow {
  id: number;
  code: string;
  label: string;
  region: string | null;
  isDefault: number;
  active: number;
}

export default function Usuarios() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);

  const [formUsername, setFormUsername] = useState("");
  const [formDisplayName, setFormDisplayName] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formRole, setFormRole] = useState("viewer");
  const [formStoreName, setFormStoreName] = useState("");
  const [formActive, setFormActive] = useState(true);
  const [formPricingProfileId, setFormPricingProfileId] = useState<string>("none");

  const { data: currentUser } = useQuery<{ role: string } | null>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const { data: allUsers, isLoading, isError } = useQuery<UserRow[]>({
    queryKey: ["/api/users"],
    enabled: currentUser?.role === "admin",
  });

  const { data: profiles } = useQuery<PricingProfileRow[]>({
    queryKey: ["/api/pricing-profiles"],
    enabled: currentUser?.role === "admin",
  });

  const profileLabel = (id: number | null) => {
    if (!id || !profiles) return "—";
    const p = profiles.find(x => x.id === id);
    return p ? `${p.code}` : "—";
  };

  if (currentUser && currentUser.role !== "admin") {
    return (
      <div className="min-h-screen lw-gradient-bg flex items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <ShieldAlert className="h-12 w-12 mx-auto mb-4 text-red-500" />
            <h2 className="text-xl font-bold mb-2">Acesso Restrito</h2>
            <p className="text-muted-foreground mb-4">Esta pagina e acessivel apenas para administradores.</p>
            <Button onClick={() => navigate("/")} data-testid="button-go-home">Voltar ao Dashboard</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/users", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Usuario criado", description: "O novo usuario foi criado com sucesso" });
      qc.invalidateQueries({ queryKey: ["/api/users"] });
      closeDialog();
    },
    onError: (err: any) => {
      const msg = err?.message?.includes(":") ? err.message.split(":").slice(1).join(":").trim() : err.message;
      let parsed = msg;
      try { parsed = JSON.parse(msg)?.message || msg; } catch {}
      toast({ title: "Erro", description: parsed, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const res = await apiRequest("PUT", `/api/users/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Usuario atualizado", description: "Os dados foram salvos com sucesso" });
      qc.invalidateQueries({ queryKey: ["/api/users"] });
      closeDialog();
    },
    onError: (err: any) => {
      const msg = err?.message?.includes(":") ? err.message.split(":").slice(1).join(":").trim() : err.message;
      let parsed = msg;
      try { parsed = JSON.parse(msg)?.message || msg; } catch {}
      toast({ title: "Erro", description: parsed, variant: "destructive" });
    },
  });

  function openNewDialog() {
    setEditingUser(null);
    setFormUsername("");
    setFormDisplayName("");
    setFormPassword("");
    setFormRole("viewer");
    setFormStoreName("");
    setFormActive(true);
    setFormPricingProfileId("none");
    setDialogOpen(true);
  }

  function openEditDialog(user: UserRow) {
    setEditingUser(user);
    setFormUsername(user.username);
    setFormDisplayName(user.displayName || "");
    setFormPassword("");
    setFormRole(user.role);
    setFormStoreName(user.storeName || "");
    setFormActive(user.active === 1);
    setFormPricingProfileId(user.pricingProfileId ? String(user.pricingProfileId) : "none");
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingUser(null);
  }

  function handleSubmit() {
    const profileVal = formPricingProfileId === "none" ? null : Number(formPricingProfileId);
    if (editingUser) {
      const data: any = {
        displayName: formDisplayName,
        role: formRole,
        active: formActive ? 1 : 0,
        storeName: formStoreName || null,
        pricingProfileId: profileVal,
      };
      if (formPassword.length > 0) data.password = formPassword;
      updateMutation.mutate({ id: editingUser.id, data });
    } else {
      createMutation.mutate({
        username: formUsername,
        password: formPassword,
        displayName: formDisplayName || formUsername,
        role: formRole,
        storeName: formStoreName || null,
        pricingProfileId: profileVal,
      });
    }
  }

  function toggleActive(user: UserRow) {
    updateMutation.mutate({
      id: user.id,
      data: { active: user.active === 1 ? 0 : 1 },
    });
  }

  const activeUsers = allUsers?.filter(u => u.active === 1) || [];
  const inactiveUsers = allUsers?.filter(u => u.active !== 1) || [];

  return (
    <div className="min-h-screen lw-gradient-bg">
      <PageHeader>
        <div className="flex items-center justify-between">
          <LightwallBrand />
          <div className="flex gap-2">
            <Link href="/tabelas-preco">
              <Button variant="outline" size="sm" className="gap-2" data-testid="button-go-pricing-tables">
                Tabelas de Preço
              </Button>
            </Link>
            <Link href="/">
              <Button variant="ghost" size="sm" className="gap-2" data-testid="button-back-dashboard">
                <ArrowLeft className="h-4 w-4" />
                Voltar
              </Button>
            </Link>
          </div>
        </div>
      </PageHeader>

      <main className="container mx-auto px-4 py-8 max-w-5xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Users className="h-6 w-6 lw-text-accent" />
              Gerenciamento de Usuarios
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Crie e gerencie acessos para lojas, representantes e outros usuarios
            </p>
          </div>
          <Button onClick={openNewDialog} className="gap-2" data-testid="button-new-user">
            <Plus className="h-4 w-4" />
            Novo Usuario
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="glass-stat rounded-xl p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-muted-foreground">Total</span>
              <Users className="h-4 w-4 lw-text-accent opacity-60" />
            </div>
            <div className="text-3xl font-bold" data-testid="text-total-users">{allUsers?.length || 0}</div>
          </div>
          <div className="glass-stat rounded-xl p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-muted-foreground">Ativos</span>
              <UserCheck className="h-4 w-4 text-green-500 opacity-60" />
            </div>
            <div className="text-3xl font-bold text-green-600" data-testid="text-active-users">{activeUsers.length}</div>
          </div>
          <div className="glass-stat rounded-xl p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-muted-foreground">Inativos</span>
              <UserX className="h-4 w-4 text-red-500 opacity-60" />
            </div>
            <div className="text-3xl font-bold text-red-600" data-testid="text-inactive-users">{inactiveUsers.length}</div>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Usuarios</CardTitle>
            <CardDescription>Lista de todos os usuarios do sistema com seus acessos e origens</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <LoadingState title="Carregando usuarios" message="" testId="state-loading-users" />
            ) : isError ? (
              <ErrorState
                title="Erro ao carregar usuarios"
                message="Verifique se voce tem permissao de administrador."
                testId="state-error-users"
              />
            ) : !allUsers || allUsers.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">Nenhum usuario encontrado</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="table-users">
                  <thead>
                    <tr className="border-b-2 border-slate-300 dark:border-slate-600">
                      <th className="text-left p-3 font-semibold">USUARIO</th>
                      <th className="text-left p-3 font-semibold">NOME</th>
                      <th className="text-left p-3 font-semibold">LOJA / ORIGEM</th>
                      <th className="text-center p-3 font-semibold">PERFIL</th>
                      <th className="text-center p-3 font-semibold">TABELA</th>
                      <th className="text-center p-3 font-semibold">STATUS</th>
                      <th className="text-left p-3 font-semibold">ULTIMO LOGIN</th>
                      <th className="text-right p-3 font-semibold">ACOES</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allUsers.map((user) => (
                      <tr key={user.id} className="border-b hover:bg-slate-50 dark:hover:bg-slate-800/50" data-testid={`row-user-${user.id}`}>
                        <td className="p-3 font-mono text-xs">{user.username}</td>
                        <td className="p-3">{user.displayName || "-"}</td>
                        <td className="p-3">
                          {user.storeName ? (
                            <span className="flex items-center gap-1 text-xs">
                              <Store className="h-3 w-3 text-blue-500" />
                              {user.storeName}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">-</span>
                          )}
                        </td>
                        <td className="p-3 text-center">
                          {user.role === "admin" ? (
                            <Badge variant="default" className="gap-1"><Shield className="h-3 w-3" />Admin</Badge>
                          ) : (
                            <Badge variant="secondary" className="gap-1"><Eye className="h-3 w-3" />Viewer</Badge>
                          )}
                        </td>
                        <td className="p-3 text-center" data-testid={`text-profile-${user.id}`}>
                          {user.pricingProfileId ? (
                            <Badge variant="outline" className="font-mono text-xs">{profileLabel(user.pricingProfileId)}</Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </td>
                        <td className="p-3 text-center">
                          {user.active === 1 ? (
                            <Badge variant="outline" className="text-green-600 border-green-300">Ativo</Badge>
                          ) : (
                            <Badge variant="outline" className="text-red-600 border-red-300">Inativo</Badge>
                          )}
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">
                          {user.lastLoginAt ? (
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {new Date(user.lastLoginAt).toLocaleString("pt-BR")}
                            </span>
                          ) : "Nunca"}
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex gap-1 justify-end">
                            <Button variant="ghost" size="sm" aria-label={`Editar usuario ${user.username}`} onClick={() => openEditDialog(user)} data-testid={`button-edit-user-${user.id}`}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={user.active === 1 ? `Desativar usuario ${user.username}` : `Ativar usuario ${user.username}`}
                              onClick={() => toggleActive(user)}
                              className={user.active === 1 ? "text-red-500 hover:text-red-700" : "text-green-500 hover:text-green-700"}
                              data-testid={`button-toggle-user-${user.id}`}
                            >
                              {user.active === 1 ? <UserX className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{editingUser ? "Editar Usuario" : "Novo Usuario"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div>
                <Label htmlFor="username">Nome de usuario (login)</Label>
                <Input
                  id="username"
                  value={formUsername}
                  onChange={(e) => setFormUsername(e.target.value)}
                  placeholder="ex: leroy_sp_centro"
                  disabled={!!editingUser}
                  data-testid="input-username"
                />
              </div>
              <div>
                <Label htmlFor="displayName">Nome de exibicao</Label>
                <Input
                  id="displayName"
                  value={formDisplayName}
                  onChange={(e) => setFormDisplayName(e.target.value)}
                  placeholder="ex: Leroy Merlin - SP Centro"
                  data-testid="input-display-name"
                />
              </div>
              <div>
                <Label htmlFor="storeName">Loja / Origem</Label>
                <Input
                  id="storeName"
                  value={formStoreName}
                  onChange={(e) => setFormStoreName(e.target.value)}
                  placeholder="ex: Leroy Merlin SP Centro"
                  data-testid="input-store-name"
                />
                <p className="text-xs text-muted-foreground mt-1">Identifique a loja, filial ou representante para rastreamento</p>
              </div>
              <div>
                <Label htmlFor="password">{editingUser ? "Nova senha (deixe vazio para manter)" : "Senha"}</Label>
                <Input
                  id="password"
                  type="password"
                  value={formPassword}
                  onChange={(e) => setFormPassword(e.target.value)}
                  placeholder={editingUser ? "••••••" : "Minimo 6 caracteres"}
                  data-testid="input-password"
                />
              </div>
              <div>
                <Label>Perfil de acesso</Label>
                <Select value={formRole} onValueChange={setFormRole}>
                  <SelectTrigger data-testid="select-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="viewer">Viewer (somente visualizar)</SelectItem>
                    <SelectItem value="admin">Admin (acesso total)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Tabela de preços (perfil comercial)</Label>
                <Select value={formPricingProfileId} onValueChange={setFormPricingProfileId}>
                  <SelectTrigger data-testid="select-pricing-profile">
                    <SelectValue placeholder="Selecione uma tabela" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Nenhuma (usa tabela padrão) —</SelectItem>
                    {profiles?.filter(p => p.active === 1).map(p => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.code} — {p.label}{p.region ? ` (${p.region})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">Define qual lista de preços será usada nos orçamentos deste usuário.</p>
              </div>
              {editingUser && (
                <div className="flex items-center gap-2">
                  <Label>Status:</Label>
                  <Badge variant={formActive ? "outline" : "destructive"} className="cursor-pointer" onClick={() => setFormActive(!formActive)}>
                    {formActive ? "Ativo" : "Inativo"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">(clique para alternar)</span>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={closeDialog} data-testid="button-cancel">Cancelar</Button>
              <Button
                onClick={handleSubmit}
                disabled={createMutation.isPending || updateMutation.isPending}
                data-testid="button-save-user"
              >
                {(createMutation.isPending || updateMutation.isPending) ? "Salvando..." : editingUser ? "Salvar" : "Criar Usuario"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
