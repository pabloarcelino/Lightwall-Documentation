import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import Metodologia from "@/components/Metodologia";
import { LightwallDots } from "@/components/LightwallLogo";
import { PageHeader } from "@/components/PageHeader";

export default function MetodologiaPage() {
  return (
    <div className="min-h-screen lw-gradient-bg">
      <PageHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="sm" data-testid="button-back-dashboard">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Voltar
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <LightwallDots className="h-5 w-5 text-primary" />
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
      </PageHeader>

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <Metodologia />
      </main>
    </div>
  );
}
