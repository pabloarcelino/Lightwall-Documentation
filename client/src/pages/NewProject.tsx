import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Upload, ArrowLeft, FileUp, X } from "lucide-react";
import { Link } from "wouter";
import { useDropzone } from "react-dropzone";
import { LightwallDots } from "@/components/LightwallLogo";

export default function NewProject() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [projectName, setProjectName] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [description, setDescription] = useState("");
  const [buildingType, setBuildingType] = useState("");
  const [files, setFiles] = useState<File[]>([]);

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

        const uploadRes = await fetch(
          `/api/projects/${project.id}/upload`,
          {
            method: "POST",
            body: formData,
          },
        );

        if (!uploadRes.ok) {
          const errBody = await uploadRes.json().catch(() => ({} as any));
          toast({
            title: "Aviso",
            description:
              errBody?.message ||
              `Projeto criado, mas houve erro no upload dos arquivos (HTTP ${uploadRes.status})`,
            variant: "destructive",
          });
        }
      }

      toast({
        title: "Sucesso!",
        description: "Projeto criado com sucesso",
      });

      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setLocation(`/project/${project.id}`);
    },
    onError: () => {
      toast({
        title: "Erro",
        description: "Erro ao criar projeto",
        variant: "destructive",
      });
    },
  });

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      "application/pdf": [".pdf"],
      "image/png": [".png"],
      "image/jpeg": [".jpg", ".jpeg"],
      "image/webp": [".webp"],
      "image/bmp": [".bmp"],
      "image/tiff": [".tif", ".tiff"],
      "application/octet-stream": [".ifc"],
    },
    onDrop: (acceptedFiles) => {
      setFiles((prev) => [...prev, ...acceptedFiles]);
    },
  });

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!projectName.trim()) {
      toast({
        title: "Erro",
        description: "Nome do projeto e obrigatorio",
        variant: "destructive",
      });
      return;
    }

    createProjectMutation.mutate({
      name: projectName,
      clientName: clientName || undefined,
      clientEmail: clientEmail || undefined,
      description: description || undefined,
      buildingType: buildingType || undefined,
    });
  };

  return (
    <div className="min-h-screen lw-gradient-bg">
      <header className="glass-header border-b border-white/20 dark:border-white/5 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="sm" data-testid="button-back">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Voltar
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <LightwallDots className="h-5 w-5 lw-text-accent" />
              <div>
                <h1
                  className="text-lg font-bold"
                  data-testid="text-page-title"
                >
                  Novo Projeto
                </h1>
                <p className="text-xs text-muted-foreground">
                  Upload de plantas arquitetonicas
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <form onSubmit={handleSubmit} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Informacoes do Projeto</CardTitle>
              <CardDescription>
                Preencha os dados basicos do projeto
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="projectName">Nome do Projeto *</Label>
                <Input
                  id="projectName"
                  data-testid="input-project-name"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="Ex: Residencia Silva"
                  required
                />
              </div>

              <div>
                <Label htmlFor="clientName">Nome do Cliente</Label>
                <Input
                  id="clientName"
                  data-testid="input-client-name"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Ex: Joao Silva"
                />
              </div>

              <div>
                <Label htmlFor="clientEmail">Email do Cliente</Label>
                <Input
                  id="clientEmail"
                  type="email"
                  data-testid="input-client-email"
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  placeholder="Ex: joao@email.com"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Usado para identificacao do projeto. Nao sera compartilhado.
                </p>
              </div>

              <div>
                <Label htmlFor="description">Descricao</Label>
                <Textarea
                  id="description"
                  data-testid="input-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Descricao opcional do projeto..."
                  rows={3}
                />
              </div>

              <div>
                <Label htmlFor="buildingType">Tipo de Edificacao</Label>
                <Select value={buildingType} onValueChange={setBuildingType}>
                  <SelectTrigger id="buildingType" data-testid="select-new-building-type">
                    <SelectValue placeholder="Auto-detectar (IA detecta ao processar)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="residencial">Residencial</SelectItem>
                    <SelectItem value="comercial">Comercial</SelectItem>
                    <SelectItem value="institucional">Institucional</SelectItem>
                    <SelectItem value="industrial">Industrial</SelectItem>
                    <SelectItem value="outro">Outro</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Opcional. Se nao informado, a IA detecta automaticamente ao processar as plantas.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Plantas Arquitetonicas</CardTitle>
              <CardDescription>
                Faca upload dos arquivos PDF ou imagens das plantas
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div
                {...getRootProps()}
                data-testid="dropzone-files"
                className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                  isDragActive
                    ? "border-primary bg-primary/5"
                    : "border-slate-300 dark:border-slate-700 hover:border-primary/50"
                }`}
              >
                <input {...getInputProps()} />
                <FileUp className="h-12 w-12 mx-auto text-slate-400 mb-4" />
                {isDragActive ? (
                  <p className="text-slate-600 dark:text-slate-400">
                    Solte os arquivos aqui...
                  </p>
                ) : (
                  <>
                    <p className="text-slate-600 dark:text-slate-400 mb-2">
                      Arraste arquivos aqui ou clique para selecionar
                    </p>
                    <p className="text-sm text-slate-500">
                      PDF, PNG, JPG, WEBP, BMP, TIFF (ate 50MB cada)
                    </p>
                  </>
                )}
              </div>

              {files.length > 0 && (
                <div className="mt-6 space-y-2">
                  <h4 className="text-sm font-medium mb-2">
                    Arquivos selecionados ({files.length})
                  </h4>
                  {files.map((file, index) => (
                    <div
                      key={index}
                      data-testid={`file-item-${index}`}
                      className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <Upload className="h-4 w-4 text-slate-500" />
                        <div>
                          <p className="text-sm font-medium">{file.name}</p>
                          <p className="text-xs text-slate-500">
                            {(file.size / 1024 / 1024).toFixed(2)} MB
                          </p>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeFile(index)}
                        data-testid={`button-remove-file-${index}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex justify-end gap-4">
            <Link href="/">
              <Button type="button" variant="outline" data-testid="button-cancel">
                Cancelar
              </Button>
            </Link>
            <Button
              type="submit"
              disabled={createProjectMutation.isPending}
              data-testid="button-submit"
            >
              {createProjectMutation.isPending
                ? "Criando..."
                : "Criar Projeto"}
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}
