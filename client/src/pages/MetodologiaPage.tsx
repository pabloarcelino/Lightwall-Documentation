import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import Metodologia from "@/components/Metodologia";
import { LightwallDots } from "@/components/LightwallLogo";

export default function MetodologiaPage() {
  return (
    <div className="min-h-screen lw-gradient-bg">
      <header className="glass-header border-b border-white/20 dark:border-white/5 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/">
                <Button variant="ghost" size="sm" data-testid="button-back-dashboard">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Voltar
                </Button>
              </Link>
              <div className="flex items-center gap-2">
                <LightwallDots className="h-5 w-5 lw-text-accent" />
                <div>
                  <h1 className="text-lg font-bold" data-testid="text-page-title">
                    Metodologia
                  </h1>
                  <p className="text-xs text-muted-foreground">
                    Processo, calculos, premissas e metodos
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <Metodologia />
      </main>
    </div>
  );
}
