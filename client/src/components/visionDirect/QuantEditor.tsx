import { useState, useEffect } from "react";
import { Edit2, Save, RotateCcw, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { fmtM2, type PageResult } from "./types";

interface Props {
  projectId: number;
  pages: PageResult[];
  onSaved?: () => void;
}

interface EditableValues {
  paredes_externas: number;
  paredes_internas: number;
  muros: number;
  laje_piso: number;
  laje_coberta: number;
}

function pageToValues(p: PageResult): EditableValues {
  return {
    paredes_externas: p.paredes_externas.area_liquida_m2,
    paredes_internas: p.paredes_internas.area_liquida_m2,
    muros: p.muros.area_bruta_m2,
    laje_piso: p.laje_piso_m2,
    laje_coberta: p.laje_coberta_m2,
  };
}

export function VisionDirectQuantEditor({ projectId, pages, onSaved }: Props) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState<Record<number, EditableValues>>({});

  useEffect(() => {
    const init: Record<number, EditableValues> = {};
    pages.forEach((p) => (init[p.pageIndex] = pageToValues(p)));
    setValues(init);
  }, [pages]);

  const handleChange = (pageIndex: number, key: keyof EditableValues, raw: string) => {
    const v = parseFloat(raw.replace(",", "."));
    setValues((prev) => ({
      ...prev,
      [pageIndex]: {
        ...prev[pageIndex],
        [key]: Number.isFinite(v) ? v : 0,
      },
    }));
  };

  const handleReset = () => {
    const init: Record<number, EditableValues> = {};
    pages.forEach((p) => (init[p.pageIndex] = pageToValues(p)));
    setValues(init);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        pages: pages.map((p) => ({
          pageIndex: p.pageIndex,
          ...values[p.pageIndex],
        })),
      };
      const res = await fetch(`/api/projects/${projectId}/vision-direct/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      toast({ title: "Quantitativos atualizados", description: "Orçamento recalculado." });
      setEditing(false);
      onSaved?.();
    } catch (err: any) {
      toast({
        title: "Erro ao salvar",
        description: err?.message || "Falha desconhecida",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <div className="p-3 border-b border-border flex items-center gap-2">
        <Edit2 className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold flex-1">
          {editing ? "Editar quantitativos por página" : "Quantitativos editáveis"}
        </h2>
        {editing ? (
          <>
            <Button variant="outline" size="sm" onClick={handleReset} disabled={saving}>
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              Descartar
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5 mr-1" />
              )}
              Salvar
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Edit2 className="h-3.5 w-3.5 mr-1" />
            Editar
          </Button>
        )}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Pag</TableHead>
            <TableHead>Pavimento</TableHead>
            <TableHead className="text-right">Ext (m²)</TableHead>
            <TableHead className="text-right">Int (m²)</TableHead>
            <TableHead className="text-right">Muros (m²)</TableHead>
            <TableHead className="text-right">Piso (m²)</TableHead>
            <TableHead className="text-right">Coberta (m²)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pages.map((p) => {
            const v = values[p.pageIndex] || pageToValues(p);
            return (
              <TableRow key={p.pageIndex}>
                <TableCell className="font-mono text-xs">{p.pageIndex}</TableCell>
                <TableCell className="text-sm">{p.pavimento}</TableCell>
                {(["paredes_externas", "paredes_internas", "muros", "laje_piso", "laje_coberta"] as const).map((k) => (
                  <TableCell key={k} className="text-right tabular-nums">
                    {editing ? (
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        value={v[k]}
                        onChange={(e) => handleChange(p.pageIndex, k, e.target.value)}
                        className="w-20 text-right bg-background border border-border rounded px-1 py-0.5 text-xs"
                        data-testid={`quant-${p.pageIndex}-${k}`}
                      />
                    ) : (
                      fmtM2(v[k])
                    )}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
