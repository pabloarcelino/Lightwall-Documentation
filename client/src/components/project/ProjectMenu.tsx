import { useState } from "react";
import {
  MoreVertical, Info, Layers, BookOpen, Download, Trash2, ChevronRight, FileText, Activity,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type ModalKey = null | "description" | "stages" | "methodology" | "export" | "files" | "live";

interface ProjectMenuProps {
  hasBudget: boolean;
  hasExtractedData: boolean;
  isProcessing: boolean;
  /** Conteúdo dos modais — caller passa renders prontos. */
  descriptionContent?: React.ReactNode;
  stagesContent?: React.ReactNode;
  methodologyContent?: React.ReactNode;
  exportContent?: React.ReactNode;
  filesContent?: React.ReactNode;
  liveContent?: React.ReactNode;
  onDelete?: () => void;
}

export function ProjectMenu(props: ProjectMenuProps) {
  const [open, setOpen] = useState<ModalKey>(null);

  const items: Array<{ key: Exclude<ModalKey, null>; label: string; icon: React.ComponentType<any>; disabled?: boolean; hidden?: boolean }> = [
    { key: "description", label: "Análise IA (descrição)", icon: Info, disabled: !props.hasBudget },
    { key: "stages", label: "Etapas (detalhes técnicos)", icon: Layers, disabled: !props.hasExtractedData },
    { key: "live", label: "Pipeline ao vivo", icon: Activity, hidden: !props.isProcessing },
    { key: "files", label: "Arquivos do projeto", icon: FileText },
    { key: "methodology", label: "Metodologia", icon: BookOpen },
    { key: "export", label: "Exportar (PDF/JSON)", icon: Download, disabled: !props.hasBudget },
  ];

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-9 w-9 p-0" data-testid="project-menu-trigger">
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Mais opções</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {items.filter(i => !i.hidden).map((item) => {
            const Icon = item.icon;
            return (
              <DropdownMenuItem
                key={item.key}
                disabled={item.disabled}
                onSelect={() => setOpen(item.key)}
                className="cursor-pointer"
                data-testid={`menu-${item.key}`}
              >
                <Icon className="h-4 w-4 mr-2" />
                <span className="flex-1">{item.label}</span>
                <ChevronRight className="h-3 w-3 opacity-50" />
              </DropdownMenuItem>
            );
          })}
          {props.onDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={props.onDelete}
                className="cursor-pointer text-error focus:text-error"
                data-testid="menu-delete"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Excluir projeto
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Modal title="Análise IA" open={open === "description"} onClose={() => setOpen(null)} maxWidth="max-w-2xl">
        {props.descriptionContent ?? <Empty msg="Descrição ainda não foi gerada." />}
      </Modal>
      <Modal title="Etapas (detalhes técnicos)" open={open === "stages"} onClose={() => setOpen(null)} maxWidth="max-w-5xl">
        {props.stagesContent ?? <Empty msg="Sem dados de etapas." />}
      </Modal>
      <Modal title="Pipeline ao vivo" open={open === "live"} onClose={() => setOpen(null)} maxWidth="max-w-5xl">
        {props.liveContent ?? <Empty msg="Sem dados ao vivo." />}
      </Modal>
      <Modal title="Arquivos do projeto" open={open === "files"} onClose={() => setOpen(null)} maxWidth="max-w-3xl">
        {props.filesContent ?? <Empty msg="Sem arquivos." />}
      </Modal>
      <Modal title="Metodologia" open={open === "methodology"} onClose={() => setOpen(null)} maxWidth="max-w-3xl">
        {props.methodologyContent ?? <Empty msg="Sem dados." />}
      </Modal>
      <Modal title="Exportar" open={open === "export"} onClose={() => setOpen(null)} maxWidth="max-w-md">
        {props.exportContent ?? <Empty msg="Exportações indisponíveis." />}
      </Modal>
    </>
  );
}

function Modal({
  title, open, onClose, children, maxWidth = "max-w-2xl",
}: { title: string; open: boolean; onClose: () => void; children: React.ReactNode; maxWidth?: string }) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className={`${maxWidth} max-h-[85vh] overflow-y-auto`}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">{title}</DialogDescription>
        </DialogHeader>
        <div className="mt-2">{children}</div>
      </DialogContent>
    </Dialog>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div className="py-12 text-center text-sm text-muted-foreground">{msg}</div>;
}
