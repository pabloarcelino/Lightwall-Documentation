import { useState } from "react";
import { ProcessingHeader, type ProjectStatus } from "./ProcessingHeader";
import { PlantaWorkspace, type AnnotationError } from "./PlantaWorkspace";
import { InspectorPanel } from "./InspectorPanel";
import { TechnicalDrawer } from "./TechnicalDrawer";
import { ProjectActionBar } from "./ProjectActionBar";
import { useProcessingSync } from "./useProcessingSync";

interface WorkspaceLayoutProps {
  // Header
  status: ProjectStatus;
  costUsd?: number;
  elapsedMs?: number;
  hasFailures: boolean;
  steps: Array<{ step: number; label: string; status: "done" | "running" | "error" | "pending" }>;
  // Data
  projectId: number | string;
  walls: any[];
  slabs: any[];
  auditNotes: any[];
  floorImages: Array<{ pavimento: string; image: string; mimeType?: string; isClientSideFallback?: boolean }>;
  /** Erros do `etapa3_annotated_plan.data.annotationErrors`. Surface no PlantaWorkspace. */
  annotationErrors?: AnnotationError[];
  isProcessing: boolean;
  // Actions
  hasPendingChanges?: boolean;
  onSave?: () => void;
  onReprocess?: () => void;
  onRegenerateAnnotation?: () => void;
  onExport?: (format: "pdf" | "excel" | "json") => void;
  // Drawer content (legacy components passed in as React nodes)
  auditContent?: React.ReactNode;
  costContent?: React.ReactNode;
  outrasContent?: React.ReactNode;
  logsContent?: React.ReactNode;
  initialPavimento?: string;
}

export function WorkspaceLayout(props: WorkspaceLayoutProps) {
  const sync = useProcessingSync(props.initialPavimento || props.floorImages[0]?.pavimento || "all");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerInitialTab, setDrawerInitialTab] = useState<"timeline" | "audit" | "cost" | "outras" | "logs">("timeline");

  return (
    <div className="flex flex-col h-[calc(100vh-180px)] min-h-[600px] border border-border rounded-xl overflow-hidden bg-background">
      <ProcessingHeader
        status={props.status}
        costUsd={props.costUsd}
        elapsedMs={props.elapsedMs}
        wallCount={props.walls.filter(w => w.enabled !== false).length}
        slabCount={props.slabs.filter(s => s.enabled !== false).length}
        steps={props.steps}
        hasFailures={props.hasFailures}
        onStepClick={() => {
          setDrawerInitialTab("timeline");
          setDrawerOpen(true);
        }}
        onToggleDrawer={() => setDrawerOpen(v => !v)}
        drawerOpen={drawerOpen}
      />

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_400px] overflow-hidden">
        {/* Workspace planta */}
        <PlantaWorkspace
          floorImages={props.floorImages}
          walls={props.walls}
          sync={sync}
          annotationErrors={props.annotationErrors}
        />
        {/* Inspector */}
        <InspectorPanel
          walls={props.walls}
          slabs={props.slabs}
          auditNotes={props.auditNotes}
          sync={sync}
        />
      </div>

      <ProjectActionBar
        hasPendingChanges={props.hasPendingChanges}
        isProcessing={props.isProcessing}
        onSave={props.onSave}
        onReprocess={props.onReprocess}
        onRegenerateAnnotation={props.onRegenerateAnnotation}
        onExport={props.onExport}
      />

      <TechnicalDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        projectId={props.projectId}
        isProcessing={props.isProcessing}
        initialTab={drawerInitialTab}
        auditContent={props.auditContent}
        costContent={props.costContent}
        outrasContent={props.outrasContent}
        logsContent={props.logsContent}
      />
    </div>
  );
}
