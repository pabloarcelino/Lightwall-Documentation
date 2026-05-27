import { useEffect } from "react";
import { X } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { AiTimeline } from "@/components/AiTimeline";
import { cn } from "@/lib/utils";

interface TechnicalDrawerProps {
  open: boolean;
  onClose: () => void;
  projectId: number | string;
  isProcessing: boolean;
  /** Tab inicial. Useful pra link de stepper -> Timeline filtrada. */
  initialTab?: "timeline" | "audit" | "cost" | "outras" | "logs";
  /** Conteudo extra das tabs auditoria, custos, outras vistas. Passado como children
   *  ate ser feita uma refatoracao mais profunda de extracao do legado. */
  auditContent?: React.ReactNode;
  costContent?: React.ReactNode;
  outrasContent?: React.ReactNode;
  logsContent?: React.ReactNode;
}

export function TechnicalDrawer({
  open,
  onClose,
  projectId,
  isProcessing,
  initialTab = "timeline",
  auditContent,
  costContent,
  outrasContent,
  logsContent,
}: TechnicalDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 lg:inset-x-0 lg:bottom-0 lg:top-auto" data-testid="technical-drawer">
      {/* Backdrop só em mobile/tablet */}
      <div
        className="absolute inset-0 bg-foreground/30 backdrop-blur-sm lg:hidden"
        onClick={onClose}
      />
      <div className={cn(
        "absolute inset-x-0 bottom-0",
        "bg-card border-t border-border shadow-2xl",
        "h-[60vh] lg:h-[40vh]",
        "flex flex-col"
      )}>
        <div className="flex items-center justify-between px-4 py-2 border-b border-border">
          <h3 className="text-sm font-semibold">Detalhes técnicos</h3>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} data-testid="close-drawer">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <Tabs defaultValue={initialTab} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="rounded-none border-b border-border bg-transparent justify-start px-2">
            <TabsTrigger value="timeline" className="text-xs">Timeline IA</TabsTrigger>
            <TabsTrigger value="audit" className="text-xs">Auditoria</TabsTrigger>
            <TabsTrigger value="cost" className="text-xs">Custos</TabsTrigger>
            <TabsTrigger value="outras" className="text-xs">Outras vistas</TabsTrigger>
            <TabsTrigger value="logs" className="text-xs">Logs</TabsTrigger>
          </TabsList>
          <div className="flex-1 overflow-y-auto p-3">
            <TabsContent value="timeline" className="m-0">
              <AiTimeline projectId={projectId} enabled={isProcessing} />
            </TabsContent>
            <TabsContent value="audit" className="m-0">
              {auditContent || <Empty msg="Sem notas de auditoria" />}
            </TabsContent>
            <TabsContent value="cost" className="m-0">
              {costContent || <Empty msg="Custos serão exibidos aqui" />}
            </TabsContent>
            <TabsContent value="outras" className="m-0">
              {outrasContent || <Empty msg="Sem vistas adicionais" />}
            </TabsContent>
            <TabsContent value="logs" className="m-0">
              {logsContent || <Empty msg="Logs em tempo real apenas durante processamento" />}
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div className="p-8 text-center text-xs text-muted-foreground">{msg}</div>;
}
