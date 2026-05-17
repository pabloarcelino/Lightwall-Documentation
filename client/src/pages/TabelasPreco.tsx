import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Pencil, Trash2, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { LightwallBrand } from "@/components/LightwallLogo";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, ErrorState } from "@/components/ui/states";

interface PricingProfile {
  id: number;
  code: string;
  label: string;
  region: string | null;
  isDefault: number;
  active: number;
}

interface ProfilePrice {
  id: number;
  profileId: number;
  sku: string;
  unitPrice: string;
  updatedAt: string;
}

interface Product {
  id: number;
  sku: string;
  name: string;
  category: string;
  unitPrice: string;
  unit: string;
}

const REGIONS = ["Sudeste", "Sul", "Nordeste", "Centro-Oeste", "Norte", "Nacional"];

export default function TabelasPreco() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(null);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<PricingProfile | null>(null);
  const [pCode, setPCode] = useState("");
  const [pLabel, setPLabel] = useState("");
  const [pRegion, setPRegion] = useState<string>("none");
  const [pIsDefault, setPIsDefault] = useState(false);
  const [editingSku, setEditingSku] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<string>("");

  const { data: currentUser } = useQuery<{ role: string } | null>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const { data: profiles, isLoading, isError } = useQuery<PricingProfile[]>({
    queryKey: ["/api/pricing-profiles"],
    enabled: currentUser?.role === "admin",
  });

  const { data: products } = useQuery<Product[]>({
    queryKey: ["/api/products"],
    enabled: currentUser?.role === "admin",
  });

  const { data: profilePrices } = useQuery<ProfilePrice[]>({
    queryKey: ["/api/pricing-profiles", selectedProfileId, "prices"],
    enabled: !!selectedProfileId,
  });

  const createProfile = useMutation({
    mutationFn: async (data: any) => apiRequest("POST", "/api/pricing-profiles", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/pricing-profiles"] });
      setProfileDialogOpen(false);
      toast({ title: "Perfil criado" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e?.message, variant: "destructive" }),
  });

  const updateProfile = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => apiRequest("PUT", `/api/pricing-profiles/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/pricing-profiles"] });
      setProfileDialogOpen(false);
      toast({ title: "Perfil atualizado" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e?.message, variant: "destructive" }),
  });

  const deleteProfile = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/pricing-profiles/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/pricing-profiles"] });
      setSelectedProfileId(null);
      toast({ title: "Perfil removido" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e?.message, variant: "destructive" }),
  });

  const savePrice = useMutation({
    mutationFn: async ({ profileId, sku, unitPrice }: { profileId: number; sku: string; unitPrice: number }) =>
      apiRequest("PUT", `/api/pricing-profiles/${profileId}/prices/${encodeURIComponent(sku)}`, { unitPrice }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/pricing-profiles", selectedProfileId, "prices"] });
      setEditingSku(null);
      setEditingValue("");
      toast({ title: "Preço salvo" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e?.message, variant: "destructive" }),
  });

  const deletePrice = useMutation({
    mutationFn: async ({ profileId, sku }: { profileId: number; sku: string }) =>
      apiRequest("DELETE", `/api/pricing-profiles/${profileId}/prices/${encodeURIComponent(sku)}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/pricing-profiles", selectedProfileId, "prices"] });
      toast({ title: "Override removido (volta ao preço padrão)" });
    },
  });

  if (currentUser && currentUser.role !== "admin") {
    return (
      <div className="min-h-screen lw-gradient-bg flex items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <p className="text-muted-foreground">Apenas administradores podem acessar esta página.</p>
            <Link href="/"><Button className="mt-4">Voltar</Button></Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  function openCreateProfile() {
    setEditingProfile(null);
    setPCode("");
    setPLabel("");
    setPRegion("none");
    setPIsDefault(false);
    setProfileDialogOpen(true);
  }

  function openEditProfile(p: PricingProfile) {
    setEditingProfile(p);
    setPCode(p.code);
    setPLabel(p.label);
    setPRegion(p.region || "none");
    setPIsDefault(p.isDefault === 1);
    setProfileDialogOpen(true);
  }

  function submitProfile() {
    const data = {
      code: pCode,
      label: pLabel,
      region: pRegion === "none" ? null : pRegion,
      isDefault: pIsDefault ? 1 : 0,
      active: 1,
    };
    if (editingProfile) updateProfile.mutate({ id: editingProfile.id, data });
    else createProfile.mutate(data);
  }

  const priceMap = new Map((profilePrices || []).map(p => [p.sku, p]));
  const selectedProfile = profiles?.find(p => p.id === selectedProfileId);

  function startEditPrice(sku: string, current: string) {
    setEditingSku(sku);
    setEditingValue(current);
  }

  function commitEditPrice(sku: string) {
    if (!selectedProfileId) return;
    const n = parseFloat(editingValue.replace(",", "."));
    if (!Number.isFinite(n) || n < 0) {
      toast({ title: "Preço inválido", variant: "destructive" });
      return;
    }
    savePrice.mutate({ profileId: selectedProfileId, sku, unitPrice: n });
  }

  return (
    <div className="min-h-screen lw-gradient-bg">
      <PageHeader>
        <div className="flex items-center justify-between">
          <LightwallBrand />
          <div className="flex gap-2">
            <Link href="/usuarios">
              <Button variant="outline" size="sm" data-testid="button-go-users">Usuários</Button>
            </Link>
            <Link href="/">
              <Button variant="ghost" size="sm" className="gap-2" data-testid="button-back-dashboard">
                <ArrowLeft className="h-4 w-4" />Voltar
              </Button>
            </Link>
          </div>
        </div>
      </PageHeader>

      <main className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-1">Tabelas de Preço</h1>
          <p className="text-muted-foreground">Gerencie perfis comerciais (Lightwall, Leroy Merlin por região, etc.) e seus preços por SKU.</p>
        </div>

        {isLoading && <LoadingState message="Carregando perfis..." />}
        {isError && <ErrorState message="Erro ao carregar perfis" />}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-1">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Perfis</CardTitle>
              <Button size="sm" onClick={openCreateProfile} className="gap-1" data-testid="button-new-profile">
                <Plus className="h-4 w-4" />Novo
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {(profiles || []).map(p => (
                <div
                  key={p.id}
                  onClick={() => setSelectedProfileId(p.id)}
                  className={`p-3 rounded-md border cursor-pointer hover-elevate ${selectedProfileId === p.id ? "border-primary bg-primary/5" : "border-border"}`}
                  data-testid={`profile-row-${p.id}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-mono text-sm font-semibold truncate">{p.code}</div>
                      <div className="text-xs text-muted-foreground truncate">{p.label}</div>
                      {p.region && <Badge variant="secondary" className="mt-1 text-[10px]">{p.region}</Badge>}
                      {p.isDefault === 1 && <Badge variant="default" className="mt-1 ml-1 text-[10px]">Padrão</Badge>}
                    </div>
                    <div className="flex flex-col gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); openEditProfile(p); }} data-testid={`button-edit-profile-${p.id}`}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={(e) => { e.stopPropagation(); if (confirm(`Remover perfil ${p.code}?`)) deleteProfile.mutate(p.id); }} data-testid={`button-delete-profile-${p.id}`}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
              {profiles && profiles.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">Nenhum perfil cadastrado.</p>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>
                {selectedProfile ? `Preços — ${selectedProfile.code}` : "Selecione um perfil"}
              </CardTitle>
              {selectedProfile && (
                <CardDescription>
                  Defina preços específicos por SKU. SKUs sem override usam o preço padrão do catálogo.
                </CardDescription>
              )}
            </CardHeader>
            <CardContent>
              {!selectedProfile ? (
                <p className="text-sm text-muted-foreground text-center py-8">Clique em um perfil ao lado para editar seus preços.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="p-2 font-semibold">SKU</th>
                        <th className="p-2 font-semibold">PRODUTO</th>
                        <th className="p-2 text-right font-semibold">PADRÃO</th>
                        <th className="p-2 text-right font-semibold">PERFIL</th>
                        <th className="p-2 text-right font-semibold w-32">AÇÕES</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(products || []).map(prod => {
                        const override = priceMap.get(prod.sku);
                        const isEditing = editingSku === prod.sku;
                        return (
                          <tr key={prod.sku} className="border-b" data-testid={`price-row-${prod.sku}`}>
                            <td className="p-2 font-mono text-xs">{prod.sku}</td>
                            <td className="p-2 text-xs">{prod.name}</td>
                            <td className="p-2 text-right text-muted-foreground tabular-nums">R$ {parseFloat(prod.unitPrice).toFixed(2)}</td>
                            <td className="p-2 text-right">
                              {isEditing ? (
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={editingValue}
                                  onChange={(e) => setEditingValue(e.target.value)}
                                  className="h-8 text-right tabular-nums"
                                  autoFocus
                                  data-testid={`input-price-${prod.sku}`}
                                />
                              ) : override ? (
                                <span className="font-semibold tabular-nums" data-testid={`text-override-${prod.sku}`}>R$ {parseFloat(override.unitPrice).toFixed(2)}</span>
                              ) : (
                                <span className="text-muted-foreground text-xs italic">—</span>
                              )}
                            </td>
                            <td className="p-2 text-right">
                              {isEditing ? (
                                <div className="flex gap-1 justify-end">
                                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => commitEditPrice(prod.sku)} data-testid={`button-save-${prod.sku}`}>
                                    <Save className="h-3 w-3" />
                                  </Button>
                                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditingSku(null); setEditingValue(""); }}>
                                    <X className="h-3 w-3" />
                                  </Button>
                                </div>
                              ) : (
                                <div className="flex gap-1 justify-end">
                                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEditPrice(prod.sku, override?.unitPrice || prod.unitPrice)} data-testid={`button-edit-${prod.sku}`}>
                                    <Pencil className="h-3 w-3" />
                                  </Button>
                                  {override && (
                                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deletePrice.mutate({ profileId: selectedProfile.id, sku: prod.sku })} data-testid={`button-clear-${prod.sku}`}>
                                      <Trash2 className="h-3 w-3" />
                                    </Button>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Dialog open={profileDialogOpen} onOpenChange={setProfileDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingProfile ? "Editar perfil" : "Novo perfil"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Código</Label>
                <Input value={pCode} onChange={(e) => setPCode(e.target.value)} placeholder="LM-SUDESTE" data-testid="input-profile-code" />
              </div>
              <div>
                <Label>Nome</Label>
                <Input value={pLabel} onChange={(e) => setPLabel(e.target.value)} placeholder="Leroy Merlin — Sudeste" data-testid="input-profile-label" />
              </div>
              <div>
                <Label>Região</Label>
                <Select value={pRegion} onValueChange={setPRegion}>
                  <SelectTrigger data-testid="select-profile-region"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Sem região —</SelectItem>
                    {REGIONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="is-default" checked={pIsDefault} onChange={(e) => setPIsDefault(e.target.checked)} data-testid="checkbox-default" />
                <Label htmlFor="is-default" className="cursor-pointer">Definir como tabela padrão</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setProfileDialogOpen(false)}>Cancelar</Button>
              <Button onClick={submitProfile} disabled={!pCode || !pLabel} data-testid="button-save-profile">
                {editingProfile ? "Salvar" : "Criar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
