import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FileUp,
  X,
  ArrowLeft,
  ArrowRight,
  Check,
  FileText,
  ImageIcon,
  Loader2,
} from "lucide-react";
import { useDropzone, type FileRejection } from "react-dropzone";
import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/utils";

type Step = 1 | 2;

const ACCEPT = {
  "application/pdf": [".pdf"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/webp": [".webp"],
  "image/bmp": [".bmp"],
  "image/tiff": [".tif", ".tiff"],
  "application/octet-stream": [".ifc"],
};

const MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

function humanFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fileIconFor(file: File) {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return FileText;
  return ImageIcon;
}

interface StepDef {
  id: Step;
  label: string;
  description: string;
}

const STEPS: StepDef[] = [
  { id: 1, label: "Dados",   description: "Informações do projeto" },
  { id: 2, label: "Plantas", description: "Upload dos arquivos" },
];

function Stepper({ current }: { current: Step }) {
  return (
    <ol className="flex items-center gap-3">
      {STEPS.map((step, idx) => {
        const isDone = step.id < current;
        const isActive = step.id === current;
        return (
          <li key={step.id} className="flex items-center gap-3">
            <div
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold transition-colors",
                isDone && "bg-primary border-primary text-primary-foreground",
                isActive && "bg-primary/10 border-primary text-primary",
                !isDone && !isActive && "bg-muted border-border text-muted-foreground",
              )}
              data-testid={`stepper-${step.id}`}
            >
              {isDone ? <Check className="h-4 w-4" /> : step.id}
            </div>
            <div className="hidden sm:block">
              <div className={cn("text-sm font-medium", isActive ? "text-foreground" : "text-muted-foreground")}>
                {step.label}
              </div>
              <div className="text-[11px] text-muted-foreground">{step.description}</div>
            </div>
            {idx < STEPS.length - 1 && (
              <div className={cn("hidden sm:block h-px w-12 mx-2", isDone ? "bg-primary" : "bg-border")} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

export default function NewProject() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>(1);

  // Step 1: dados
  const [projectName, setProjectName] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [description, setDescription] = useState("");
  const [buildingType, setBuildingType] = useState("");

  // Step 2: arquivos
  const [files, setFiles] = useState<File[]>([]);
  const totalSize = useMemo(() => files.reduce((s, f) => s + f.size, 0), [files]);

  const createProjectMutation = useMutation({
    mutationFn: async (data: {
      name: string;
      clientName?: string;
      clientEmail?: string;
      description?: string;
      buildingType?: string;
    }) => {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Erro ao criar projeto");
      return res.json();
    },
    onSuccess: async (project) => {
      if (files.length > 0) {
        const formData = new FormData();
        files.forEach((file) => formData.append("files", file));
        const uploadRes = await fetch(`/api/projects/${project.id}/upload`, {
          method: "POST",
          body: formData,
        });
        if (!uploadRes.ok) {
          const errBody = await uploadRes.json().catch(() => ({} as any));
          toast({
            title: "Aviso",
            description:
              errBody?.message ||
              `Projeto criado, mas houve erro no upload (HTTP ${uploadRes.status})`,
            variant: "destructive",
          });
        }
      }

      toast({ title: "Projeto criado", description: "Redirecionando para análise..." });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setLocation(`/project/${project.id}`);
    },
    onError: () => {
      toast({ title: "Erro", description: "Erro ao criar projeto", variant: "destructive" });
    },
  });

  const onDropRejected = (rejected: FileRejection[]) => {
    if (rejected.length === 0) return;
    const first = rejected[0];
    const reason = first.errors[0]?.message || "Arquivo rejeitado";
    toast({ title: "Arquivo inválido", description: reason, variant: "destructive" });
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: ACCEPT,
    maxSize: MAX_SIZE_BYTES,
    onDropRejected,
    onDrop: (accepted) => setFiles(prev => [...prev, ...accepted]),
  });

  const removeFile = (index: number) =>
    setFiles(prev => prev.filter((_, i) => i !== index));

  const nameOk = projectName.trim().length > 0;
  const canGoStep2 = nameOk;
  const canSubmit = nameOk && files.length > 0 && !createProjectMutation.isPending;

  const handleSubmit = () => {
    if (!nameOk) {
      toast({ title: "Campo obrigatório", description: "Informe o nome do projeto", variant: "destructive" });
      setStep(1);
      return;
    }
    if (files.length === 0) {
      toast({ title: "Nenhum arquivo", description: "Adicione ao menos uma planta antes de criar", variant: "destructive" });
      return;
    }
    createProjectMutation.mutate({
      name: projectName.trim(),
      clientName: clientName.trim() || undefined,
      clientEmail: clientEmail.trim() || undefined,
      description: description.trim() || undefined,
      buildingType: buildingType || undefined,
    });
  };

  return (
    <div className="lw-gradient-bg min-h-full">
      <PageHeader
        title="Novo projeto"
        description="Crie um novo orçamento a partir de plantas arquitetônicas"
        actions={
          <Link href="/">
            <Button variant="outline" size="sm" className="gap-1.5" data-testid="button-back">
              <ArrowLeft className="h-4 w-4" /> Voltar
            </Button>
          </Link>
        }
      >
        <Stepper current={step} />
      </PageHeader>

      <div className="container py-8 max-w-3xl">
        {step === 1 && (
          <section className="rounded-xl border border-card-border bg-card shadow-xs animate-lw-fade-in">
            <div className="px-6 py-5 border-b border-border">
              <h2 className="text-lg font-semibold">Informações do projeto</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Esses dados aparecem no orçamento final e ajudam a IA a contextualizar a análise.
              </p>
            </div>
            <div className="p-6 space-y-5">
              <Field
                label="Nome do projeto"
                required
                htmlFor="projectName"
                hint="Aparece como título principal do orçamento."
              >
                <Input
                  id="projectName"
                  value={projectName}
                  onChange={e => setProjectName(e.target.value)}
                  placeholder="Ex: Residência Silva — Recife"
                  data-testid="input-project-name"
                  autoFocus
                />
              </Field>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <Field label="Nome do cliente" htmlFor="clientName">
                  <Input
                    id="clientName"
                    value={clientName}
                    onChange={e => setClientName(e.target.value)}
                    placeholder="Ex: João Silva"
                    data-testid="input-client-name"
                  />
                </Field>

                <Field label="E-mail do cliente" htmlFor="clientEmail" hint="Não será compartilhado.">
                  <Input
                    id="clientEmail"
                    type="email"
                    value={clientEmail}
                    onChange={e => setClientEmail(e.target.value)}
                    placeholder="cliente@email.com"
                    data-testid="input-client-email"
                  />
                </Field>
              </div>

              <Field
                label="Tipo de edificação"
                htmlFor="buildingType"
                hint="Opcional. A IA detecta automaticamente se ficar em branco."
              >
                <Select value={buildingType} onValueChange={setBuildingType}>
                  <SelectTrigger id="buildingType" data-testid="select-new-building-type">
                    <SelectValue placeholder="Auto-detectar com IA" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="residencial">Residencial</SelectItem>
                    <SelectItem value="comercial">Comercial</SelectItem>
                    <SelectItem value="institucional">Institucional</SelectItem>
                    <SelectItem value="industrial">Industrial</SelectItem>
                    <SelectItem value="outro">Outro</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Descrição" htmlFor="description" hint="Observações para você ou para a equipe.">
                <Textarea
                  id="description"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Notas sobre o projeto, restrições, escopo..."
                  rows={3}
                  data-testid="input-description"
                />
              </Field>
            </div>
            <div className="px-6 py-4 border-t border-border flex justify-between bg-muted/30 rounded-b-xl">
              <Link href="/">
                <Button variant="ghost" data-testid="button-cancel">Cancelar</Button>
              </Link>
              <Button
                onClick={() => setStep(2)}
                disabled={!canGoStep2}
                className="gap-1.5"
                data-testid="button-next-step"
              >
                Próximo <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="rounded-xl border border-card-border bg-card shadow-xs animate-lw-fade-in">
            <div className="px-6 py-5 border-b border-border">
              <h2 className="text-lg font-semibold">Plantas arquitetônicas</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Envie plantas baixas, cortes, fachadas ou quadros de esquadrias. Formatos aceitos: PDF e imagens.
              </p>
            </div>
            <div className="p-6 space-y-5">
              <div
                {...getRootProps()}
                data-testid="dropzone-files"
                className={cn(
                  "relative rounded-xl border-2 border-dashed p-10 text-center cursor-pointer transition-colors",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isDragActive
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40 hover:bg-accent/40",
                )}
              >
                <input {...getInputProps()} />
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary mb-3">
                  <FileUp className="h-6 w-6" />
                </div>
                {isDragActive ? (
                  <p className="text-foreground font-medium">Solte os arquivos para anexar</p>
                ) : (
                  <>
                    <p className="text-foreground font-medium">Arraste arquivos aqui ou clique para selecionar</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      PDF, PNG, JPG, WEBP, BMP, TIFF — até 50 MB por arquivo
                    </p>
                  </>
                )}
              </div>

              {files.length > 0 ? (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-semibold">
                      {files.length} arquivo{files.length > 1 ? "s" : ""} selecionado{files.length > 1 ? "s" : ""}
                    </h4>
                    <span className="text-xs text-muted-foreground">
                      Total: {humanFileSize(totalSize)}
                    </span>
                  </div>
                  <ul className="space-y-2">
                    {files.map((file, index) => {
                      const Icon = fileIconFor(file);
                      return (
                        <li
                          key={`${file.name}-${index}`}
                          data-testid={`file-item-${index}`}
                          className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2.5"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="h-9 w-9 shrink-0 flex items-center justify-center rounded-md bg-primary/10 text-primary">
                              <Icon className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{file.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {humanFileSize(file.size)} · {file.type || "tipo desconhecido"}
                              </p>
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-error hover:bg-error-soft"
                            onClick={() => removeFile(index)}
                            aria-label={`Remover ${file.name}`}
                            data-testid={`button-remove-file-${index}`}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground text-center">Nenhum arquivo anexado ainda.</p>
              )}
            </div>

            <div className="px-6 py-4 border-t border-border flex justify-between bg-muted/30 rounded-b-xl">
              <Button variant="ghost" onClick={() => setStep(1)} className="gap-1.5" data-testid="button-prev-step">
                <ArrowLeft className="h-4 w-4" /> Voltar
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="gap-1.5"
                data-testid="button-submit"
              >
                {createProjectMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Criando projeto...
                  </>
                ) : (
                  <>
                    Criar projeto <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

// ---------- Helper interno ----------

interface FieldProps {
  label: string;
  htmlFor: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}

function Field({ label, htmlFor, required, hint, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-sm font-medium">
        {label} {required && <span className="text-error">*</span>}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
