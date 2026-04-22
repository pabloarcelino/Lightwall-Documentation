#!/usr/bin/env tsx
/**
 * Script de Seed - Popula o banco com o catalogo de produtos Lightwall
 * Baseado no catalogo real Lightwall
 */

import { db } from './db';
import { products } from '@shared/schema';

const lightwallProducts = [
  { sku: 'LW-2P-090', name: 'PAINEL DE CONCRETO LEVE 3000X610X90MM 2P', category: 'painel', panelType: '2P', thickness: 90, unitPrice: '275.00', unit: 'm²', description: 'Painel padrao 2P 90mm' },
  { sku: 'LW-SP-090', name: 'PAINEL DE CONCRETO LEVE 3000X610X90MM SP', category: 'painel', panelType: 'SP', thickness: 90, unitPrice: '180.00', unit: 'm²', description: 'Painel simples SP 90mm' },
  { sku: 'LW-2P-075', name: 'PAINEL DE CONCRETO LEVE 3000X610X75MM 2P', category: 'painel', panelType: '2P', thickness: 75, unitPrice: '259.00', unit: 'm²', description: 'Painel 2P 75mm' },
  { sku: 'LW-2P-120', name: 'PAINEL DE CONCRETO LEVE 3000X610X120MM 2P', category: 'painel', panelType: '2P', thickness: 120, unitPrice: '317.00', unit: 'm²', description: 'Painel 2P 120mm' },
  { sku: 'LW-SP-120', name: 'PAINEL DE CONCRETO LEVE 3000X610X120MM SP', category: 'painel', panelType: 'SP', thickness: 120, unitPrice: '207.00', unit: 'm²', description: 'Painel simples SP 120mm' },
  { sku: 'LW-2P-090-1T', name: 'PAINEL DE CONCRETO LEVE 3000X610X90MM 2P ELETRICO 1T', category: 'painel', panelType: '2P', thickness: 90, unitPrice: '305.00', unit: 'm²', description: 'Painel 2P 90mm com eletroduto 1 tomada' },
  { sku: 'LW-2P-090-3T', name: 'PAINEL DE CONCRETO LEVE 3000X610X90MM 2P ELETRICO 3T', category: 'painel', panelType: '2P', thickness: 90, unitPrice: '355.00', unit: 'm²', description: 'Painel 2P 90mm com eletroduto 3 tomadas' },
  { sku: 'LW-2P-075-1T', name: 'PAINEL DE CONCRETO LEVE 3000X610X75MM 2P ELETRICO 1T', category: 'painel', panelType: '2P', thickness: 75, unitPrice: '289.00', unit: 'm²', description: 'Painel 2P 75mm com eletroduto 1 tomada' },
  { sku: 'LW-2P-075-3T', name: 'PAINEL DE CONCRETO LEVE 3000X610X75MM 2P ELETRICO 3T', category: 'painel', panelType: '2P', thickness: 75, unitPrice: '339.00', unit: 'm²', description: 'Painel 2P 75mm com eletroduto 3 tomadas' },
  { sku: 'LW-2P-120-1T', name: 'PAINEL DE CONCRETO LEVE 3000X610X120MM 2P ELETRICO 1T', category: 'painel', panelType: '2P', thickness: 120, unitPrice: '347.00', unit: 'm²', description: 'Painel 2P 120mm com eletroduto 1 tomada' },
  { sku: 'LW-2P-120-3T', name: 'PAINEL DE CONCRETO LEVE 3000X610X120MM 2P ELETRICO 3T', category: 'painel', panelType: '2P', thickness: 120, unitPrice: '397.00', unit: 'm²', description: 'Painel 2P 120mm com eletroduto 3 tomadas' },
  { sku: 'LW-2P-L-090', name: 'PAINEL DE CONCRETO LEVE 3000X280X90MM 2P - TIPO "L"', category: 'painel', panelType: '2P', thickness: 90, unitPrice: '358.00', unit: 'm²', description: 'Painel L 2P 90mm para cantos' },
  { sku: 'LW-SP-L-090', name: 'PAINEL DE CONCRETO LEVE 3000X280X90MM SP - TIPO "L"', category: 'painel', panelType: 'SP', thickness: 90, unitPrice: '234.00', unit: 'm²', description: 'Painel L SP 90mm para cantos' },
  { sku: 'LW-2P-L-075', name: 'PAINEL DE CONCRETO LEVE 3000X280X75MM 2P - TIPO "L"', category: 'painel', panelType: '2P', thickness: 75, unitPrice: '337.00', unit: 'm²', description: 'Painel L 2P 75mm para cantos' },
  { sku: 'LW-2P-L-120', name: 'PAINEL DE CONCRETO LEVE 3000X280X120MM 2P - TIPO "L"', category: 'painel', panelType: '2P', thickness: 120, unitPrice: '413.00', unit: 'm²', description: 'Painel L 2P 120mm para cantos' },
  { sku: 'LW-SP-L-120', name: 'PAINEL DE CONCRETO LEVE 3000X280X120MM SP - TIPO "L"', category: 'painel', panelType: 'SP', thickness: 120, unitPrice: '270.00', unit: 'm²', description: 'Painel L SP 120mm para cantos' },
  { sku: 'LW-2P-095', name: 'PAINEL DE CONCRETO LEVE 3000X610X95MM 2P', category: 'painel', panelType: '2P', thickness: 95, unitPrice: '317.00', unit: 'm²', description: 'Painel 2P 95mm' },
  { sku: 'LW-2P-2500-090', name: 'PAINEL DE CONCRETO LEVE 2500X610X90MM 2P', category: 'painel', panelType: '2P', thickness: 90, unitPrice: '305.00', unit: 'm²', description: 'Painel 2P 2500mm 90mm' },
  { sku: 'LW-SP-2500-090', name: 'PAINEL DE CONCRETO LEVE 2500X610X90MM SP', category: 'painel', panelType: 'SP', thickness: 90, unitPrice: '210.00', unit: 'm²', description: 'Painel SP 2500mm 90mm' },
  { sku: 'LW-2P-2500-075', name: 'PAINEL DE CONCRETO LEVE 2500X610X75MM 2P', category: 'painel', panelType: '2P', thickness: 75, unitPrice: '289.00', unit: 'm²', description: 'Painel 2P 2500mm 75mm' },
  { sku: 'LW-2P-2500-120', name: 'PAINEL DE CONCRETO LEVE 2500X610X120MM 2P', category: 'painel', panelType: '2P', thickness: 120, unitPrice: '347.00', unit: 'm²', description: 'Painel 2P 2500mm 120mm' },
  { sku: 'LW-SP-2500-120', name: 'PAINEL DE CONCRETO LEVE 2500X610X120MM SP', category: 'painel', panelType: 'SP', thickness: 120, unitPrice: '237.00', unit: 'm²', description: 'Painel SP 2500mm 120mm' },
  { sku: 'PROJ-PAG', name: 'Projeto de Paginacao', category: 'servico_paginacao', panelType: null, thickness: 0, unitPrice: '11.00', unit: 'm²', description: 'Projeto de paginacao BIM' },
];

async function seed() {
  console.log('Iniciando seed do banco de dados...\n');

  try {
    const existing = await db.select().from(products);

    if (existing.length > 0) {
      console.log(`Ja existem ${existing.length} produtos no banco. Removendo...`);
      await db.delete(products);
    }

    console.log(`Inserindo ${lightwallProducts.length} produtos...\n`);

    let inserted = 0;
    for (const product of lightwallProducts) {
      await db.insert(products).values(product);
      inserted++;
      console.log(`   [${inserted.toString().padStart(2, '0')}/${lightwallProducts.length}] ${product.sku} - ${product.name} - R$ ${product.unitPrice}/m2`);
    }

    console.log(`\nSeed concluido! ${inserted} produtos cadastrados\n`);
  } catch (error) {
    console.error('\nErro durante seed:', error);
    process.exit(1);
  }

  process.exit(0);
}

seed();
