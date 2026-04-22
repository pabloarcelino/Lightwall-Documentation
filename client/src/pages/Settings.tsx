import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ArrowLeft, Key, CheckCircle, XCircle, Loader2, Eye, EyeOff, Trash2, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import { LightwallDots } from "@/components/LightwallLogo";

function ApiKeyCard({
  title,
  description,
  descriptionLink,
  descriptionLinkText,
  placeholder,
  settingsEndpoint,
  testEndpoint,
  queryKey,
  testIdPrefix,
}: {
  title: string;
  description: string;
  descriptionLink?: string;
  descriptionLinkText?: string;
  placeholder: string;
  settingsEndpoint: string;
  testEndpoint: string;
  queryKey: string;
  testIdPrefix: string;
}) {
  const { toast } = useToast();
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);

  const { data: keyStatus, isLoading } = useQuery<{ hasKey: boolean; maskedKey: string | null }>({
    queryKey: [queryKey],
  });

  const saveMutation = useMutation({
    mutationFn: async (key: string) => {
      const res = await apiRequest("POST", settingsEndpoint, { apiKey: key });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Sucesso", description: data.message });
      setApiKey("");
      queryClient.invalidateQueries({ queryKey: [queryKey] });
    },
    onError: (error: Error) => {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    },
  });

  const testMutation = useMutation({
    mutationFn: async (key: string) => {
      const res = await apiRequest("POST", testEndpoint, { apiKey: key });
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data.success) {
        toast({ title: "Conexao OK", description: data.message });
      } else {
        toast({ title: "Falha", description: data.message, variant: "destructive" });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Erro no teste", description: error.message, variant: "destructive" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", settingsEndpoint);
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Removido", description: data.message });
      queryClient.invalidateQueries({ queryKey: [queryKey] });
    },
    onError: (error: Error) => {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Key className="h-5 w-5" />
          {title}
        </CardTitle>
        <CardDescription>
          {description}
          {descriptionLink && (
            <>
              {" "}
              <a
                href={descriptionLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 underline"
                data-testid={`${testIdPrefix}-link`}
              >
                {descriptionLinkText}
              </a>.
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <div className="flex items-center gap-2 text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando...
          </div>
        ) : keyStatus?.hasKey ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 rounded-lg bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800">
              <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0" />
              <div>
                <p className="font-medium text-green-800 dark:text-green-200" data-testid={`${testIdPrefix}-status`}>
                  Chave configurada
                </p>
                <p className="text-sm text-green-600 dark:text-green-400" data-testid={`${testIdPrefix}-masked`}>
                  {keyStatus.maskedKey}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                onClick={() => removeMutation.mutate()}
                disabled={removeMutation.isPending}
                data-testid={`${testIdPrefix}-remove`}
              >
                {removeMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                Remover Chave
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 p-4 rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800">
            <XCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
            <div>
              <p className="font-medium text-amber-800 dark:text-amber-200" data-testid={`${testIdPrefix}-no-key`}>
                Nenhuma chave configurada
              </p>
              <p className="text-sm text-amber-600 dark:text-amber-400">
                {testIdPrefix === "gemini" ? "O sistema usara o servico integrado do Replit (pode ter limitacoes)" : "Verificacao cross-model desativada (Gemini verifica a si mesmo)"}
              </p>
            </div>
          </div>
        )}

        <div className="border-t pt-6">
          <Label htmlFor={`${testIdPrefix}-api-key`} className="text-base font-medium">
            {keyStatus?.hasKey ? "Atualizar chave de API" : "Nova chave de API"}
          </Label>
          <div className="flex gap-2 mt-3">
            <div className="relative flex-1">
              <Input
                id={`${testIdPrefix}-api-key`}
                type={showKey ? "text" : "password"}
                placeholder={placeholder}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                data-testid={`${testIdPrefix}-input`}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                onClick={() => setShowKey(!showKey)}
                data-testid={`${testIdPrefix}-toggle-visibility`}
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <Button
              onClick={() => testMutation.mutate(apiKey)}
              variant="outline"
              disabled={!apiKey || apiKey.length < 10 || testMutation.isPending}
              data-testid={`${testIdPrefix}-test`}
            >
              {testMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <CheckCircle className="h-4 w-4 mr-2" />
              )}
              Testar Conexao
            </Button>
            <Button
              onClick={() => saveMutation.mutate(apiKey)}
              disabled={!apiKey || apiKey.length < 10 || saveMutation.isPending}
              data-testid={`${testIdPrefix}-save`}
            >
              {saveMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Key className="h-4 w-4 mr-2" />
              )}
              Salvar Chave
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Settings() {
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
                <h1 className="text-lg font-bold" data-testid="text-page-title">
                  Configuracoes
                </h1>
                <p className="text-xs text-muted-foreground">
                  Chaves de API e verificacao multi-modelo
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-2xl space-y-6">
        <ApiKeyCard
          title="Chave de API do Google Gemini"
          description="Insira sua chave de API do Google Gemini para habilitar a analise de imagens de projetos arquitetonicos. A chave pode ser obtida em"
          descriptionLink="https://aistudio.google.com/apikey"
          descriptionLinkText="Google AI Studio"
          placeholder="AIzaSy..."
          settingsEndpoint="/api/settings/gemini-key"
          testEndpoint="/api/settings/test-gemini"
          queryKey="/api/settings/gemini-key"
          testIdPrefix="gemini"
        />

        <ApiKeyCard
          title="Chave de API da OpenAI (Verificacao Cross-Model)"
          description="Configure uma chave OpenAI para habilitar verificacao cross-model (GPT-4o). Quando configurada, a etapa de verificacao usa um modelo diferente do extrator, eliminando vies de auto-verificacao. A chave pode ser obtida em"
          descriptionLink="https://platform.openai.com/api-keys"
          descriptionLinkText="OpenAI Platform"
          placeholder="sk-..."
          settingsEndpoint="/api/settings/openai-key"
          testEndpoint="/api/settings/test-openai"
          queryKey="/api/settings/openai-key"
          testIdPrefix="openai"
        />

        <Card className="border-blue-200 dark:border-blue-800">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              Como funciona a verificacao multi-modelo
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 text-sm text-muted-foreground">
              <div className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-xs font-bold text-blue-700 dark:text-blue-300">1</span>
                <p><strong>Extracao (Gemini 2.5 Pro)</strong> — O Gemini analisa as plantas e extrai todos os elementos construtivos</p>
              </div>
              <div className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-xs font-bold text-blue-700 dark:text-blue-300">2</span>
                <p><strong>Verificacao (GPT-4o)</strong> — Um modelo diferente revisa os dados extraidos, comparando com a imagem original para detectar erros</p>
              </div>
              <div className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-xs font-bold text-blue-700 dark:text-blue-300">3</span>
                <p><strong>Fallback</strong> — Se a OpenAI falhar, o Gemini faz a verificacao automaticamente (registrado nas metricas)</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
