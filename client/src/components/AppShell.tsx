import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Plus,
  Package,
  Sliders,
  ScrollText,
  BookOpen,
  HelpCircle,
  Users,
  Brain,
  Settings as SettingsIcon,
  LogOut,
  Menu,
  X,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { LightwallDots } from "@/components/LightwallLogo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

type CurrentUser = { username: string; displayName?: string | null; role?: string };

interface NavItem {
  to: string;
  label: string;
  Icon: typeof LayoutDashboard;
  adminOnly?: boolean;
  /** prefixos extras de URL que ainda contam como ativos */
  matches?: string[];
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    label: "Projetos",
    items: [
      { to: "/",            label: "Dashboard",       Icon: LayoutDashboard, matches: ["/project/"] },
      { to: "/new-project", label: "Novo projeto",    Icon: Plus },
    ],
  },
  {
    label: "Configuração",
    items: [
      { to: "/catalogo",      label: "Catálogo",       Icon: Package },
      { to: "/tabelas-preco", label: "Tabelas de preço", Icon: ScrollText },
      { to: "/calibracao",    label: "Calibração",     Icon: Sliders },
      { to: "/settings",      label: "Configurações",  Icon: SettingsIcon },
    ],
  },
  {
    label: "Conhecimento",
    items: [
      { to: "/metodologia", label: "Metodologia", Icon: BookOpen },
      { to: "/guia",        label: "Guia",        Icon: HelpCircle },
    ],
  },
  {
    label: "Administração",
    items: [
      { to: "/usuarios",       label: "Usuários",         Icon: Users, adminOnly: true },
      { to: "/aprendizado-ia", label: "Aprendizado da IA", Icon: Brain, adminOnly: true },
    ],
  },
];

const SIDEBAR_PREF_KEY = "lw-sidebar-collapsed";

function isActive(currentPath: string, item: NavItem): boolean {
  if (item.to === "/") return currentPath === "/";
  if (currentPath === item.to) return true;
  if (currentPath.startsWith(item.to + "/")) return true;
  if (item.matches?.some(prefix => currentPath.startsWith(prefix))) return true;
  return false;
}

function buildBreadcrumb(path: string): string {
  const map: Record<string, string> = {
    "/":             "Dashboard",
    "/new-project":  "Novo projeto",
    "/catalogo":     "Catálogo",
    "/tabelas-preco":"Tabelas de preço",
    "/calibracao":   "Calibração",
    "/settings":     "Configurações",
    "/metodologia":  "Metodologia",
    "/guia":         "Guia",
    "/usuarios":     "Usuários",
    "/aprendizado-ia": "Aprendizado da IA",
  };
  if (map[path]) return map[path];
  if (path.startsWith("/project/")) return "Detalhes do projeto";
  return "Lightwall";
}

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  currentPath: string;
  isAdmin: boolean;
  /** apenas em mobile: callback para fechar drawer apos clicar em item */
  onNavigate?: () => void;
}

function SidebarContent({ collapsed, onToggleCollapsed, currentPath, isAdmin, onNavigate }: SidebarProps) {
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* Header / brand */}
      <div className="flex items-center gap-3 px-4 py-4 border-b border-sidebar-border">
        <Link href="/" onClick={onNavigate} className="flex items-center gap-2.5 min-w-0">
          <LightwallDots className="h-7 w-7 text-primary shrink-0" />
          {!collapsed && (
            <div className="leading-tight min-w-0">
              <div className="text-sm font-bold tracking-tight text-foreground truncate">Lightwall</div>
              <div className="text-[10px] text-muted-foreground tracking-[0.18em] uppercase truncate">Orçamento</div>
            </div>
          )}
        </Link>
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expandir menu" : "Encolher menu"}
          title={collapsed ? "Expandir menu" : "Encolher menu"}
          className="ml-auto hidden lg:inline-flex h-7 w-7"
          data-testid="button-sidebar-toggle"
        >
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
        </Button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-4 space-y-5">
        {NAV.map(group => {
          const items = group.items.filter(i => (i.adminOnly ? isAdmin : true));
          if (items.length === 0) return null;
          return (
            <div key={group.label}>
              {!collapsed && (
                <div className="px-2 mb-1.5 text-[10px] font-semibold tracking-[0.18em] uppercase text-muted-foreground">
                  {group.label}
                </div>
              )}
              <ul className="space-y-0.5">
                {items.map(item => {
                  const active = isActive(currentPath, item);
                  const linkContent = (
                    <span
                      className={cn(
                        "group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
                        "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                        active
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-muted-foreground",
                        collapsed && "justify-center",
                      )}
                    >
                      <item.Icon className={cn("h-4 w-4 shrink-0", active && "text-primary")} />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                      {active && !collapsed && (
                        <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-primary" aria-hidden />
                      )}
                    </span>
                  );

                  return (
                    <li key={item.to}>
                      {collapsed ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Link href={item.to} onClick={onNavigate} data-testid={`nav-${item.to.replace(/\//g, "-") || "root"}`}>
                              {linkContent}
                            </Link>
                          </TooltipTrigger>
                          <TooltipContent side="right">{item.label}</TooltipContent>
                        </Tooltip>
                      ) : (
                        <Link href={item.to} onClick={onNavigate} data-testid={`nav-${item.to.replace(/\//g, "-") || "root"}`}>
                          {linkContent}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* Versao / status */}
      {!collapsed && (
        <div className="px-4 py-3 border-t border-sidebar-border">
          <div className="text-[10px] text-muted-foreground tracking-wide">
            v01 • Sistema paramétrico
          </div>
        </div>
      )}
    </div>
  );
}

interface AppShellProps {
  children: ReactNode;
  user: CurrentUser | null;
  onLogout: () => void;
}

export function AppShell({ children, user, onLogout }: AppShellProps) {
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try { return window.localStorage.getItem(SIDEBAR_PREF_KEY) === "1"; } catch { return false; }
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try { window.localStorage.setItem(SIDEBAR_PREF_KEY, collapsed ? "1" : "0"); } catch { /* ignore */ }
  }, [collapsed]);

  // Fecha drawer mobile ao trocar de rota
  useEffect(() => { setMobileOpen(false); }, [location]);

  const isAdmin = user?.role === "admin";
  const currentTitle = useMemo(() => buildBreadcrumb(location), [location]);

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      {/* Sidebar desktop */}
      <aside
        className={cn(
          "hidden lg:flex shrink-0 border-r border-sidebar-border transition-[width] duration-200",
          collapsed ? "w-[68px]" : "w-[244px]",
        )}
        data-testid="sidebar-desktop"
      >
        <SidebarContent
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed(v => !v)}
          currentPath={location}
          isAdmin={isAdmin}
        />
      </aside>

      {/* Drawer mobile */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden"
          role="dialog"
          aria-modal="true"
          data-testid="sidebar-mobile"
        >
          <div
            className="absolute inset-0 bg-foreground/30 backdrop-blur-sm animate-lw-fade-in"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full w-[260px] shadow-xl animate-lw-fade-in">
            <SidebarContent
              collapsed={false}
              onToggleCollapsed={() => setMobileOpen(false)}
              currentPath={location}
              isAdmin={isAdmin}
              onNavigate={() => setMobileOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Coluna conteudo */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="sticky top-0 z-40 glass-header border-b border-border">
          <div className="flex h-14 items-center gap-2 px-4 lg:px-6">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden -ml-2"
              onClick={() => setMobileOpen(true)}
              aria-label="Abrir menu"
              data-testid="button-mobile-menu"
            >
              <Menu className="h-5 w-5" />
            </Button>

            <div className="flex items-center gap-2 min-w-0">
              <h1 className="text-base font-semibold tracking-tight truncate" data-testid="topbar-title">
                {currentTitle}
              </h1>
            </div>

            <div className="ml-auto flex items-center gap-1">
              <Link href="/new-project">
                <Button size="sm" className="gap-1.5" data-testid="topbar-new-project">
                  <Plus className="h-4 w-4" />
                  <span className="hidden sm:inline">Novo projeto</span>
                </Button>
              </Link>

              <Separator orientation="vertical" className="mx-1 h-6 hidden sm:block" />

              <ThemeToggle variant="inline" />

              {user && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-2 pl-2 pr-2"
                      data-testid="topbar-user-menu"
                    >
                      <div className="h-7 w-7 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-semibold">
                        {(user.displayName || user.username || "?").slice(0, 1).toUpperCase()}
                      </div>
                      <span className="hidden md:inline text-sm text-foreground/90 max-w-[140px] truncate">
                        {user.displayName || user.username}
                      </span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuLabel className="text-xs text-muted-foreground">
                      Conectado como
                    </DropdownMenuLabel>
                    <div className="px-2 pb-2 text-sm font-medium">{user.displayName || user.username}</div>
                    {user.role && (
                      <div className="px-2 pb-2 text-[11px] text-muted-foreground uppercase tracking-wider">
                        {user.role}
                      </div>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={onLogout}
                      className="text-error focus:text-error cursor-pointer"
                      data-testid="topbar-logout"
                    >
                      <LogOut className="mr-2 h-4 w-4" />
                      Sair
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        </header>

        {/* Conteudo da pagina */}
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}
