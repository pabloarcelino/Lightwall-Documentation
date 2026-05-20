import { Switch, Route, Link } from "wouter";
import { queryClient, getQueryFn } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/Dashboard";
import NewProject from "@/pages/NewProject";
import ProjectDetails from "@/pages/ProjectDetails";
import Settings from "@/pages/Settings";
import MetodologiaPage from "@/pages/MetodologiaPage";
import Catalogo from "@/pages/Catalogo";
import Calibracao from "@/pages/Calibracao";
import Usuarios from "@/pages/Usuarios";
import TabelasPreco from "@/pages/TabelasPreco";
import GuiaExterno from "@/pages/GuiaExterno";
import AprendizadoIA from "@/pages/AprendizadoIA";
import Login from "@/pages/Login";
import { ThemeProvider } from "@/hooks/use-theme";
import { AppShell } from "@/components/AppShell";

function AdminGuard({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = useQuery<{ role?: string } | null>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: Infinity,
  });
  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
      </div>
    );
  }
  if (!user || user.role !== "admin") {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-lg font-medium">Acesso restrito</p>
        <p className="text-sm text-muted-foreground">Esta página é exclusiva para administradores.</p>
        <Link href="/">
          <Button variant="outline" data-testid="link-home">Voltar ao início</Button>
        </Link>
      </div>
    );
  }
  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/new-project" component={NewProject} />
      <Route path="/project/:id" component={ProjectDetails} />
      <Route path="/settings" component={Settings} />
      <Route path="/metodologia" component={MetodologiaPage} />
      <Route path="/catalogo" component={Catalogo} />
      <Route path="/calibracao" component={Calibracao} />
      <Route path="/usuarios" component={Usuarios} />
      <Route path="/tabelas-preco" component={TabelasPreco} />
      <Route path="/guia" component={GuiaExterno} />
      <Route path="/aprendizado-ia">
        {() => (
          <AdminGuard>
            <AprendizadoIA />
          </AdminGuard>
        )}
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthGate() {
  const { data: user, isLoading, refetch } = useQuery<{ username: string; displayName: string | null; role: string } | null>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
    staleTime: Infinity,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen lw-gradient-bg flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Login onLogin={() => refetch()} />;
  }

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    queryClient.setQueryData(["/api/auth/me"], null);
    queryClient.invalidateQueries();
  };

  return (
    <AppShell user={user} onLogout={handleLogout}>
      <Router />
    </AppShell>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider delayDuration={150}>
          <Toaster />
          <AuthGate />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
