import { storage } from "../../storage";

/**
 * Aplica os precos do perfil ao catalogo de produtos. Cria copia dos produtos
 * sobrescrevendo `unitPrice` quando o SKU tem entrada em `profile_prices`.
 * Produtos sem override mantem o preco do catalogo (fallback).
 *
 * Extraido de server/routes.ts:110 para que tanto a pipeline antiga quanto o
 * motor Vision Direta possam reusar.
 */
export async function applyProfilePrices<T extends { sku: string; unitPrice: string }>(
  products: T[],
  profileId: number | null | undefined,
): Promise<T[]> {
  if (!profileId) return products;
  try {
    const overrides = await storage.getProfilePrices(profileId);
    if (overrides.length === 0) return products;
    const map = new Map(overrides.map((o) => [o.sku, o.unitPrice]));
    return products.map((p) =>
      map.has(p.sku) ? { ...p, unitPrice: map.get(p.sku)! } : p,
    );
  } catch (e) {
    console.warn("[PROFILE_PRICES] Falha ao aplicar perfil", profileId, e);
    return products;
  }
}
