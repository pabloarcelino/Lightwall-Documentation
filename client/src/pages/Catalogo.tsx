import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowLeft, Plus, Pencil, Trash2, Package } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import type { Product } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { LightwallDots } from "@/components/LightwallLogo";

interface ProductForm {
  name: string;
  panelType: string;
  unitPrice: string;
}

const emptyForm: ProductForm = { name: "", panelType: "2P", unitPrice: "" };

export default function Catalogo() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showDialog, setShowDialog] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [filterType, setFilterType] = useState<string>("all");

  const { data: products, isLoading } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: ProductForm) => {
      return apiRequest("POST", "/api/products", {
        name: data.name,
        panelType: data.panelType,
        unitPrice: parseFloat(data.unitPrice),
        category: "painel",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({ title: "Produto adicionado", description: "Novo painel adicionado ao catalogo" });
      setShowDialog(false);
      setForm(emptyForm);
    },
    onError: () => {
      toast({ title: "Erro", description: "Erro ao adicionar produto", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: ProductForm }) => {
      return apiRequest("PUT", `/api/products/${id}`, {
        name: data.name,
        panelType: data.panelType,
        unitPrice: parseFloat(data.unitPrice),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({ title: "Produto atualizado", description: "Dados do painel atualizados" });
      setShowDialog(false);
      setEditingProduct(null);
      setForm(emptyForm);
    },
    onError: () => {
      toast({ title: "Erro", description: "Erro ao atualizar produto", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/products/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({ title: "Produto removido", description: "Painel removido do catalogo" });
      setDeleteConfirmId(null);
    },
    onError: () => {
      toast({ title: "Erro", description: "Erro ao remover produto", variant: "destructive" });
    },
  });

  const handleEdit = (product: Product) => {
    setEditingProduct(product);
    setForm({
      name: product.name,
      panelType: product.panelType || "2P",
      unitPrice: product.unitPrice,
    });
    setShowDialog(true);
  };

  const handleSubmit = () => {
    if (!form.name.trim() || !form.unitPrice.trim()) {
      toast({ title: "Campos obrigatorios", description: "Preencha descricao e preco", variant: "destructive" });
      return;
    }
    if (editingProduct) {
      updateMutation.mutate({ id: editingProduct.id, data: form });
    } else {
      createMutation.mutate(form);
    }
  };

  const handleNewProduct = () => {
    setEditingProduct(null);
    setForm(emptyForm);
    setShowDialog(true);
  };

  const panels = (products || []).filter(p => p.category === "painel");
  const services = (products || []).filter(p => p.category !== "painel");

  const filteredPanels = filterType === "all"
    ? panels
    : panels.filter(p => p.panelType === filterType);

  const panelTypes = [...new Set(panels.map(p => p.panelType).filter(Boolean))].sort();

  return (
    <div className="min-h-screen lw-gradient-bg">
      <header className="glass-header border-b border-white/20 dark:border-white/5 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/">
                <Button variant="ghost" size="sm" data-testid="button-back-dashboard">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Voltar
                </Button>
              </Link>
              <div className="flex items-center gap-2">
                <LightwallDots className="h-5 w-5 lw-text-accent" />
                <div>
                  <h1 className="text-lg font-bold" data-testid="text-page-title">
                    Catalogo de Paineis
                  </h1>
                  <p className="text-xs text-muted-foreground">
                    Gerencie tipos e precos dos paineis Lightwall
                  </p>
                </div>
              </div>
            </div>
            <Button onClick={handleNewProduct} className="gap-2" size="sm" data-testid="button-add-product">
              <Plus className="h-4 w-4" />
              Novo Painel
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-5xl">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total de Paineis</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-total-panels">{panels.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Tipos</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-total-types">{panelTypes.length}</div>
              <p className="text-xs text-muted-foreground">{panelTypes.join(", ")}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Faixa de Preco</CardTitle>
            </CardHeader>
            <CardContent>
              {panels.length > 0 ? (
                <div className="text-2xl font-bold" data-testid="text-price-range">
                  R$ {Math.min(...panels.map(p => parseFloat(p.unitPrice))).toFixed(0)} - {Math.max(...panels.map(p => parseFloat(p.unitPrice))).toFixed(0)}
                </div>
              ) : (
                <div className="text-2xl font-bold">--</div>
              )}
              <p className="text-xs text-muted-foreground">por m2</p>
            </CardContent>
          </Card>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Paineis Lightwall</CardTitle>
                <CardDescription>Paineis disponiveis para orcamento</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-sm">Filtrar tipo:</Label>
                <Select value={filterType} onValueChange={setFilterType}>
                  <SelectTrigger className="w-[120px]" data-testid="select-filter-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {panelTypes.map(t => (
                      <SelectItem key={t} value={t!}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8">Carregando catalogo...</div>
            ) : filteredPanels.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                Nenhum painel encontrado
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="table-products">
                  <thead>
                    <tr className="border-b-2">
                      <th className="text-left p-3 font-semibold">Descricao do Produto</th>
                      <th className="text-center p-3 font-semibold w-20">Tipo</th>
                      <th className="text-right p-3 font-semibold w-32">Preco (R$/m2)</th>
                      <th className="text-center p-3 font-semibold w-24">Acoes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPanels.map((product) => (
                      <tr key={product.id} className="border-b hover:bg-slate-50 dark:hover:bg-slate-800/50" data-testid={`row-product-${product.id}`}>
                        <td className="p-3">
                          <span className="font-medium">{product.name}</span>
                        </td>
                        <td className="p-3 text-center">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            product.panelType === "2P"
                              ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                              : "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
                          }`}>
                            {product.panelType || "-"}
                          </span>
                        </td>
                        <td className="p-3 text-right font-mono font-medium" data-testid={`text-price-${product.id}`}>
                          R$ {parseFloat(product.unitPrice).toFixed(2)}
                        </td>
                        <td className="p-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEdit(product)}
                              data-testid={`button-edit-${product.id}`}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            {deleteConfirmId === product.id ? (
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => deleteMutation.mutate(product.id)}
                                  disabled={deleteMutation.isPending}
                                  data-testid={`button-confirm-delete-${product.id}`}
                                >
                                  Sim
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setDeleteConfirmId(null)}
                                >
                                  Nao
                                </Button>
                              </div>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-red-500 hover:text-red-700"
                                onClick={() => setDeleteConfirmId(product.id)}
                                data-testid={`button-delete-${product.id}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
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

        {services.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Servicos</CardTitle>
              <CardDescription>Servicos complementares (paginacao, etc.)</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b-2">
                      <th className="text-left p-3 font-semibold">Descricao</th>
                      <th className="text-right p-3 font-semibold w-32">Preco (R$/m2)</th>
                      <th className="text-center p-3 font-semibold w-24">Acoes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {services.map((svc) => (
                      <tr key={svc.id} className="border-b" data-testid={`row-service-${svc.id}`}>
                        <td className="p-3 font-medium">{svc.name}</td>
                        <td className="p-3 text-right font-mono font-medium">R$ {parseFloat(svc.unitPrice).toFixed(2)}</td>
                        <td className="p-3 text-center">
                          <Button variant="ghost" size="sm" onClick={() => handleEdit(svc)} data-testid={`button-edit-service-${svc.id}`}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </main>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingProduct ? "Editar Painel" : "Novo Painel"}</DialogTitle>
            <DialogDescription>
              {editingProduct ? "Altere os dados do painel" : "Adicione um novo painel ao catalogo"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="product-name">Descricao do Produto</Label>
              <Input
                id="product-name"
                placeholder="Ex: PAINEL DE CONCRETO LEVE 3000X610X90MM 2P"
                value={form.name}
                onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                data-testid="input-product-name"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="product-type">Tipo</Label>
                <Select
                  value={form.panelType}
                  onValueChange={(v) => setForm(prev => ({ ...prev, panelType: v }))}
                >
                  <SelectTrigger data-testid="select-product-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="2P">2P</SelectItem>
                    <SelectItem value="SP">SP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="product-price">Preco (R$/m2)</Label>
                <Input
                  id="product-price"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="275.00"
                  value={form.unitPrice}
                  onChange={(e) => setForm(prev => ({ ...prev, unitPrice: e.target.value }))}
                  data-testid="input-product-price"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)} data-testid="button-cancel-dialog">
              Cancelar
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
              data-testid="button-save-product"
            >
              {createMutation.isPending || updateMutation.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
