#!/usr/bin/env tsx

  /**
   * Script de Validação do Sistema Lightwall Budget
   * 
   * Verifica se todos os componentes estão corretamente configurados
   */

  import { access } from "fs/promises";
  import { db, pool } from './db';
  import { products, projects } from '@shared/schema';
  import { eq } from 'drizzle-orm';

  async function validate() {
    console.log('🔍 Iniciando validação do sistema...\n');
    
    let errors = 0;
    let warnings = 0;
    
    // 1. Verificar variáveis de ambiente
    console.log('1️⃣  Verificando variáveis de ambiente...');
    const requiredEnvVars = [
      'DATABASE_URL',
      'AI_INTEGRATIONS_GEMINI_API_KEY',
      'AI_INTEGRATIONS_GEMINI_BASE_URL'
    ];
    
    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        console.error(`   ❌ ${envVar} não configurada`);
        errors++;
      } else {
        console.log(`   ✅ ${envVar} OK`);
      }
    }
    
    // 2. Verificar conexão com banco de dados
    console.log('\n2️⃣  Verificando conexão com PostgreSQL...');
    try {
      const result = await pool.query('SELECT NOW()');
      console.log(`   ✅ Conexão OK - ${result.rows[0].now}`);
    } catch (error) {
      console.error(`   ❌ Erro na conexão: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
      errors++;
    }
    
    // 3. Verificar tabelas
    console.log('\n3️⃣  Verificando tabelas do banco...');
    const tables = ['products', 'projects', 'project_files', 'extracted_data', 'budgets'];
    
    for (const table of tables) {
      try {
        const result = await pool.query(`SELECT COUNT(*) FROM ${table}`);
        console.log(`   ✅ Tabela '${table}' existe (${result.rows[0].count} registros)`);
      } catch (error) {
        console.error(`   ❌ Tabela '${table}' não encontrada`);
        errors++;
      }
    }
    
    // 4. Verificar catálogo de produtos
    console.log('\n4️⃣  Verificando catálogo de produtos...');
    try {
      const productCount = await db.select().from(products);
      if (productCount.length === 0) {
        console.warn('   ⚠️  Catálogo vazio - execute a seed para popular');
        warnings++;
      } else {
        console.log(`   ✅ ${productCount.length} produtos cadastrados`);
      }
    } catch (error) {
      console.error(`   ❌ Erro ao consultar produtos: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
      errors++;
    }
    
    // 5. Verificar diretórios de upload
    console.log('\n5️⃣  Verificando diretórios de upload...');
    const uploadDirs = ['server/uploads', 'server/uploads/projects'];
    
    for (const dir of uploadDirs) {
      try {
        await access(dir);
        console.log(`   ✅ Diretório '${dir}' existe`);
      } catch (error) {
        console.warn(`   ⚠️  Diretório '${dir}' não existe - será criado automaticamente`);
        warnings++;
      }
    }
    
    // 6. Verificar integração Gemini
    console.log('\n6️⃣  Verificando integração com Gemini AI...');
    try {
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({
        apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY!,
        httpOptions: {
          apiVersion: 'v1beta',
          baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL!,
        },
      });
      console.log('   ✅ Cliente Gemini inicializado');
      console.log('   ℹ️  Modelo: gemini-2.0-flash-exp');
    } catch (error) {
      console.error(`   ❌ Erro ao inicializar Gemini: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
      errors++;
    }
    
    // Resumo
    console.log('\n' + '='.repeat(60));
    console.log('📊 RESUMO DA VALIDAÇÃO');
    console.log('='.repeat(60));
    
    if (errors === 0 && warnings === 0) {
      console.log('✅ Sistema 100% operacional!');
      console.log('\n🚀 Você pode iniciar o servidor com: npm run dev');
    } else {
      if (errors > 0) {
        console.error(`\n❌ ${errors} erro(s) crítico(s) encontrado(s)`);
      }
      if (warnings > 0) {
        console.warn(`⚠️  ${warnings} aviso(s) encontrado(s)`);
      }
      
      if (errors > 0) {
        console.log('\n🔧 Corrija os erros antes de iniciar o sistema.');
        process.exit(1);
      }
    }
    
    await pool.end();
  }

  validate().catch((error) => {
    console.error('\n💥 Erro fatal durante validação:', error);
    process.exit(1);
  });
  
