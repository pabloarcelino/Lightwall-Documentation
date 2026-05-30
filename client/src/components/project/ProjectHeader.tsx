import { useState } from "react";
import { ArrowLeft, Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ProjectHeaderProps {
  projectName: string;
  clientName?: string;
  status: "draft" | "processing" | "completed" | "error";
  projectType?: "teste" | "real";
  buildingType?: string;
  onBack: () => void;
  onRenameProject?: (name: string) => Promise<void> | void;
  onProjectTypeChange?: (t: "teste" | "real") => void;
  onBuildingTypeChange?: (t: string) => void;
  menu?: React.ReactNode;
}

const STATUS_LABELS = {
  draft: "Rascunho",
  processing: "Processando",
  completed: "Processado",
  error: "Erro",
};
const STATUS_TONES: Record<ProjectHeaderProps["status"], string> = {
  draft: "bg-warning/15 text-warning border-warning/30",
  processing: "bg-primary/15 text-primary border-primary/30 animate-pulse",
  completed: "bg-success/15 text-success border-success/30",
  error: "bg-error/15 text-error border-error/30",
};

const BUILDING_TYPES = ["residencial", "comercial", "industrial", "misto"] as const;

export function ProjectHeader({
  projectName,
  clientName,
  status,
  projectType = "real",
  buildingType = "residencial",
  onBack,
  onRenameProject,
  onProjectTypeChange,
  onBuildingTypeChange,
  menu,
}: ProjectHeaderProps) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(projectName);
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setDraftName(projectName);
    setEditing(true);
  };
  const save = async () => {
    if (!onRenameProject || draftName.trim() === "") {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onRenameProject(draftName.trim());
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
      <div className="container mx-auto px-4 py-3 flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="shrink-0" data-testid="header-back">
          <ArrowLeft className="h-4 w-4 mr-1" />
          <span className="hidden sm:inline">Voltar</span>
        </Button>

        <div className="flex-1 min-w-0 flex items-center gap-2">
          {editing ? (
            <>
              <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                className="text-base font-semibold bg-background border border-border rounded px-2 py-0.5 flex-1 min-w-0"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") save();
                  if (e.key === "Escape") setEditing(false);
                }}
                data-testid="header-name-input"
              />
              <button onClick={save} disabled={saving} className="p-1.5 rounded hover:bg-success/15 text-success">
                <Check className="h-4 w-4" />
              </button>
              <button onClick={() => setEditing(false)} className="p-1.5 rounded hover:bg-error/15 text-error">
                <X className="h-4 w-4" />
              </button>
            </>
          ) : (
            <>
              <div className="min-w-0 flex-1">
                <div className="text-base font-bold truncate flex items-center gap-1.5">
                  {projectName}
                  {onRenameProject && (
                    <button onClick={startEdit} className="text-muted-foreground hover:text-foreground p-0.5" data-testid="header-edit">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {clientName && (
                  <div className="text-[11px] text-muted-foreground truncate">Cliente: {clientName}</div>
                )}
              </div>
            </>
          )}
        </div>

        <span
          className={cn(
            "inline-flex items-center text-[11px] font-medium uppercase tracking-wider px-2 py-1 rounded-full border whitespace-nowrap",
            STATUS_TONES[status],
          )}
          data-testid={`header-status-${status}`}
        >
          {STATUS_LABELS[status]}
        </span>

        {onProjectTypeChange && (
          <div className="hidden md:flex rounded-md overflow-hidden border border-border text-xs shrink-0">
            <button
              type="button"
              onClick={() => onProjectTypeChange("teste")}
              className={cn(
                "px-2 py-1 transition",
                projectType === "teste" ? "bg-warning text-warning-foreground" : "bg-background hover:bg-accent",
              )}
              data-testid="header-type-teste"
            >
              Teste
            </button>
            <button
              type="button"
              onClick={() => onProjectTypeChange("real")}
              className={cn(
                "px-2 py-1 transition",
                projectType === "real" ? "bg-success text-success-foreground" : "bg-background hover:bg-accent",
              )}
              data-testid="header-type-real"
            >
              Real
            </button>
          </div>
        )}

        {onBuildingTypeChange && (
          <select
            value={buildingType}
            onChange={(e) => onBuildingTypeChange(e.target.value)}
            className="hidden md:block text-xs bg-background border border-border rounded px-2 py-1 shrink-0"
            data-testid="header-building-type"
          >
            {BUILDING_TYPES.map((t) => (
              <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
            ))}
          </select>
        )}

        {menu && <div className="shrink-0">{menu}</div>}
      </div>
    </header>
  );
}
