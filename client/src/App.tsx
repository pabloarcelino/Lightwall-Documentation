import { Switch, Route } from "wouter";
import { queryClient, getQueryFn } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/Dashboard";
import NewProject from "@/pages/NewProject";
import ProjectDetails from "@/pages/ProjectDetails";
import Settings from "@/pages/Settings";
import MetodologiaPage from "@/pages/MetodologiaPage";
import Catalogo from "@/pages/Catalogo";
import Calibracao from "@/pages/Calibracao";
import TakeoffPage from "@/pages/TakeoffPage";
import Login from "@/pages/Login";
import { Loader2 } from "lucide-react";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/new-project" component={NewProject} />
      <Route path="/project/:id" component={ProjectDetails} />
      <Route path="/project/:id/takeoff" component={TakeoffPage} />
      <Route path="/settings" component={Settings} />
      <Route path="/metodologia" component={MetodologiaPage} />
      <Route path="/catalogo" component={Catalogo} />
      <Route path="/calibracao" component={Calibracao} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthGate() {
  const { data: user, isLoading, refetch } = useQuery({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
    staleTime: Infinity,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen lw-gradient-bg flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin lw-text-accent" />
      </div>
    );
  }

  if (!user) {
    return <Login onLogin={() => refetch()} />;
  }

  return <Router />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <AuthGate />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
