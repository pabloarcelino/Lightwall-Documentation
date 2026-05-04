import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ArrowLeft, FileUp, Settings, Play, BarChart3, Download, AlertTriangle, CheckCircle, HelpCircle } from "lucide-react";
import { Link } from "wouter";
import { LightwallBrand } from "@/components/LightwallLogo";

export default function GuiaExterno() {
  return (
    <div className="min-h-screen lw-gradient-bg">
      <header className="glass-header border-b border-white/20 dark:border-white/5 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <LightwallBrand />
            <Link href="/">
              <Button variant="ghost" size="sm" className="gap-2" data-testid="button-back-dashboard">
                <ArrowLeft className="h-4 w-4" />
                Voltar
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl flex items-center gap-2">
              <HelpCircle className="h-6 w-6 lw-text-accent" />
              Guia de Utilizacao para Externos
            </CardTitle>
            <p className="text-muted-foreground">
              Passo a passo para gerar orcamentos automaticos de paineis Lightwall a partir de plantas arquitetonicas.
            </p>
          </CardHeader>
          <CardContent>
            <Accordion type="multiple" defaultValue={["passo1", "passo2", "passo3", "dicas"]} className="space-y-2">

              <AccordionItem value="passo1">
                <AccordionTrigger className="text-base font-semibold">
                  <span className="flex items-center gap-2">
                    <FileUp className="h-4 w-4 lw-text-accent" />
                    Passo 1 — Criar Projeto e Enviar Arquivos
                  </span>
                </AccordionTrigger>
                <AccordionContent className="space-y-3 text-sm">
                  <ol className="list-decimal list-inside space-y-2 ml-2">
                    <li>No Dashboard, clique no botao <strong>"Novo Projeto"</strong>.</li>
                    <li>Preencha o <strong>nome do projeto</strong> (obrigatorio), o <strong>nome do cliente</strong> e o <strong>email do cliente</strong>.</li>
                    <li>Selecione o <strong>tipo de edificacao</strong> (residencial, comercial, etc.) — se nao souber, deixe em branco e a IA detecta automaticamente.</li>
                    <li>Arraste ou selecione os <strong>arquivos das plantas</strong> (PDF, PNG, JPG).</li>
                    <li>Clique em <strong>"Criar Projeto"</strong>.</li>
                  </ol>
                  <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3 mt-2">
                    <p className="font-medium text-blue-700 dark:text-blue-300 flex items-center gap-1">
                      <CheckCircle className="h-4 w-4" /> Formatos aceitos
                    </p>
                    <p className="text-blue-600 dark:text-blue-400 mt-1">PDF (recomendado), PNG, JPG, WEBP, BMP, TIFF. Para melhores resultados, envie o PDF original do projeto arquitetonico.</p>
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="passo2">
                <AccordionTrigger className="text-base font-semibold">
                  <span className="flex items-center gap-2">
                    <Play className="h-4 w-4 lw-text-accent" />
                    Passo 2 — Processar o Projeto
                  </span>
                </AccordionTrigger>
                <AccordionContent className="space-y-3 text-sm">
                  <ol className="list-decimal list-inside space-y-2 ml-2">
                    <li>Apos criar o projeto, voce sera redirecionado para a pagina de detalhes.</li>
                    <li>Verifique se os arquivos foram carregados corretamente na aba <strong>"Arquivos"</strong>.</li>
                    <li>Clique no botao <strong>"Processar Projeto"</strong> no topo da pagina.</li>
                    <li>Aguarde o processamento (pode levar de 1 a 5 minutos dependendo do tamanho do projeto).</li>
                    <li>O progresso e exibido em tempo real com barras de status para cada etapa.</li>
                  </ol>
                  <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 mt-2">
                    <p className="font-medium text-amber-700 dark:text-amber-300 flex items-center gap-1">
                      <AlertTriangle className="h-4 w-4" /> Importante
                    </p>
                    <p className="text-amber-600 dark:text-amber-400 mt-1">Nao feche o navegador durante o processamento. Se houver erro, voce pode reprocessar clicando no botao novamente.</p>
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="passo3">
                <AccordionTrigger className="text-base font-semibold">
                  <span className="flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 lw-text-accent" />
                    Passo 3 — Consultar o Orcamento
                  </span>
                </AccordionTrigger>
                <AccordionContent className="space-y-3 text-sm">
                  <p>Apos o processamento, o orcamento sera gerado automaticamente. Voce pode consultar:</p>
                  <ul className="list-disc list-inside space-y-2 ml-2">
                    <li><strong>Aba "Orcamento"</strong> — Proposta comercial completa com tabela de itens, totais por tipo de painel (SKU), paginacao e valor total.</li>
                    <li><strong>Aba "Quantitativos"</strong> — Detalhamento de paredes, lajes e cantos extraidos. Voce pode editar manualmente e recalcular.</li>
                    <li><strong>Aba "Etapas"</strong> — Resultado detalhado de cada etapa do pipeline de analise (classificacao, geometria, calculo, validacao).</li>
                    <li><strong>Aba "Analise IA"</strong> — Descricao tecnica gerada pela IA sobre o projeto.</li>
                  </ul>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="passo4">
                <AccordionTrigger className="text-base font-semibold">
                  <span className="flex items-center gap-2">
                    <Download className="h-4 w-4 lw-text-accent" />
                    Passo 4 — Exportar
                  </span>
                </AccordionTrigger>
                <AccordionContent className="space-y-3 text-sm">
                  <p>Na aba <strong>"Exportar"</strong>, voce pode baixar o orcamento nos seguintes formatos:</p>
                  <ul className="list-disc list-inside space-y-2 ml-2">
                    <li><strong>PDF</strong> — Proposta comercial formatada para impressao e envio ao cliente.</li>
                    <li><strong>Excel</strong> — Planilha editavel com todos os dados do orcamento.</li>
                    <li><strong>JSON</strong> — Dados brutos para integracao com outros sistemas.</li>
                  </ul>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="passo5">
                <AccordionTrigger className="text-base font-semibold">
                  <span className="flex items-center gap-2">
                    <Settings className="h-4 w-4 lw-text-accent" />
                    Passo 5 — Ajustar Quantitativos (Opcional)
                  </span>
                </AccordionTrigger>
                <AccordionContent className="space-y-3 text-sm">
                  <p>Se os quantitativos extraidos pela IA nao estiverem corretos, voce pode ajusta-los manualmente:</p>
                  <ol className="list-decimal list-inside space-y-2 ml-2">
                    <li>Va na aba <strong>"Quantitativos"</strong>.</li>
                    <li>Edite comprimentos, alturas ou desabilite paredes/lajes que nao se aplicam.</li>
                    <li>Clique em <strong>"Recalcular"</strong> para gerar um novo orcamento com os valores ajustados.</li>
                  </ol>
                  <p className="text-muted-foreground mt-2">Os dados originais sao preservados automaticamente. Voce pode sempre reprocessar para voltar ao resultado da IA.</p>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="dicas">
                <AccordionTrigger className="text-base font-semibold">
                  <span className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    Dicas para Melhores Resultados
                  </span>
                </AccordionTrigger>
                <AccordionContent className="space-y-3 text-sm">
                  <ul className="list-disc list-inside space-y-2 ml-2">
                    <li><strong>Use PDF original</strong> — PDFs vetoriais (do AutoCAD/Revit) dao resultados muito superiores a fotos ou scans.</li>
                    <li><strong>Inclua planta baixa completa</strong> — A planta deve ter cotas (dimensoes), nomes de comodos e indicacao de portas/janelas.</li>
                    <li><strong>Inclua cortes</strong> — Se disponivel, envie paginas de corte/fachada para melhor deteccao do pe-direito.</li>
                    <li><strong>Evite plantas com mobilia</strong> — Plantas limpas (sem moveis desenhados) facilitam a leitura da IA. O sistema ignora mobilias automaticamente, mas plantas limpas dao mais precisao.</li>
                    <li><strong>Uma planta por pagina</strong> — Se o PDF tem multiplas plantas, o sistema processa cada pagina separadamente.</li>
                    <li><strong>Resolucao minima</strong> — Para imagens (PNG/JPG), use pelo menos 150 DPI. Imagens muito pequenas podem perder detalhes das cotas.</li>
                    <li><strong>Nao envie projetos duplicados</strong> — O sistema detecta automaticamente se o mesmo projeto ja foi processado. Se detectado, voce sera redirecionado para o orcamento existente.</li>
                  </ul>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="alertas">
                <AccordionTrigger className="text-base font-semibold">
                  <span className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    Alertas e Validacao
                  </span>
                </AccordionTrigger>
                <AccordionContent className="space-y-3 text-sm">
                  <p>Apos o processamento, o sistema pode gerar alertas de validacao em 3 niveis:</p>
                  <div className="space-y-2 ml-2">
                    <div className="flex items-start gap-2">
                      <span className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-xs font-bold px-2 py-0.5 rounded">CRITICA</span>
                      <span>Inconsistencias graves que podem invalidar o orcamento (ex: parede sem comprimento).</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-xs font-bold px-2 py-0.5 rounded">MEDIA</span>
                      <span>Valores suspeitos que devem ser revisados (ex: parede muito longa).</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-bold px-2 py-0.5 rounded">BAIXA</span>
                      <span>Observacoes informativas (ex: premissa utilizada por falta de dados).</span>
                    </div>
                  </div>
                  <p className="text-muted-foreground mt-2">Revise os alertas na aba "Etapas" (Etapa 7 - Validacao) antes de enviar o orcamento ao cliente.</p>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="glossario">
                <AccordionTrigger className="text-base font-semibold">
                  <span className="flex items-center gap-2">
                    <HelpCircle className="h-4 w-4 lw-text-accent" />
                    Glossario de Termos
                  </span>
                </AccordionTrigger>
                <AccordionContent className="space-y-3 text-sm">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
                      <p className="font-medium">Parede Externa</p>
                      <p className="text-xs text-muted-foreground">Parede que separa o interior da casa do exterior (jardim, rua).</p>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
                      <p className="font-medium">Parede Interna</p>
                      <p className="text-xs text-muted-foreground">Divisoria entre comodos internos da casa.</p>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
                      <p className="font-medium">Muro</p>
                      <p className="text-xs text-muted-foreground">Vedacao perimetral do lote/terreno, fora da edificacao.</p>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
                      <p className="font-medium">Laje de Piso</p>
                      <p className="text-xs text-muted-foreground">Area horizontal na base dos comodos. Terreo = radier (fundacao).</p>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
                      <p className="font-medium">Laje Coberta</p>
                      <p className="text-xs text-muted-foreground">Projecao da cobertura da edificacao (ultimo pavimento).</p>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
                      <p className="font-medium">SKU</p>
                      <p className="text-xs text-muted-foreground">Codigo do produto no catalogo Lightwall (ex: LW-2P-090).</p>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
                      <p className="font-medium">Paginacao</p>
                      <p className="text-xs text-muted-foreground">Projeto tecnico de encaixe/posicionamento dos paineis (BIM).</p>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
                      <p className="font-medium">Pe-direito</p>
                      <p className="text-xs text-muted-foreground">Altura do piso ao teto de cada pavimento (padrao: 3,00m).</p>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>

            </Accordion>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
