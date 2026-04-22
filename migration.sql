
  -- Criar tabela de produtos
  CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    sku TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    thickness DECIMAL(5, 2),
    width DECIMAL(5, 2),
    height DECIMAL(5, 2),
    area DECIMAL(5, 2),
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  -- Criar tabela de projetos
  CREATE TABLE IF NOT EXISTS projects (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    client_name TEXT,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  -- Criar tabela de arquivos do projeto
  CREATE TABLE IF NOT EXISTS project_files (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    path TEXT NOT NULL,
    page_type TEXT,
    page_number INTEGER,
    uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  -- Criar tabela de dados extraídos
  CREATE TABLE IF NOT EXISTS extracted_data (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    element_type TEXT NOT NULL,
    element_id TEXT,
    data JSONB NOT NULL,
    source TEXT NOT NULL,
    confidence DECIMAL(3, 2),
    has_assumption BOOLEAN NOT NULL DEFAULT FALSE,
    inconsistency_level TEXT,
    inconsistency_message TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  -- Criar tabela de orçamentos
  CREATE TABLE IF NOT EXISTS budgets (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    version INTEGER NOT NULL DEFAULT 1,
    totals JSONB NOT NULL,
    quantitatives JSONB NOT NULL,
    materials JSONB NOT NULL,
    alerts JSONB NOT NULL,
    assumptions JSONB NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  -- Inserir produtos do catálogo Lightwall (22 SKUs conforme documentação)
  INSERT INTO products (sku, name, type, thickness, width, height, area, description) VALUES
    ('LW-SP-60', 'Painel Lightwall SP 60mm', 'SP', 60.00, 0.61, 3.00, 1.83, 'Painel estrutural autoportante 60mm'),
    ('LW-SP-80', 'Painel Lightwall SP 80mm', 'SP', 80.00, 0.61, 3.00, 1.83, 'Painel estrutural autoportante 80mm'),
    ('LW-SP-100', 'Painel Lightwall SP 100mm', 'SP', 100.00, 0.61, 3.00, 1.83, 'Painel estrutural autoportante 100mm'),
    ('LW-SP-120', 'Painel Lightwall SP 120mm', 'SP', 120.00, 0.61, 3.00, 1.83, 'Painel estrutural autoportante 120mm'),
    ('LW-SP-140', 'Painel Lightwall SP 140mm', 'SP', 140.00, 0.61, 3.00, 1.83, 'Painel estrutural autoportante 140mm'),
    ('LW-SP-160', 'Painel Lightwall SP 160mm', 'SP', 160.00, 0.61, 3.00, 1.83, 'Painel estrutural autoportante 160mm'),
    ('LW-2P-60', 'Painel Lightwall 2P 60mm', '2P', 60.00, 0.61, 3.00, 1.83, 'Painel dupla placa 60mm'),
    ('LW-2P-80', 'Painel Lightwall 2P 80mm', '2P', 80.00, 0.61, 3.00, 1.83, 'Painel dupla placa 80mm'),
    ('LW-2P-100', 'Painel Lightwall 2P 100mm', '2P', 100.00, 0.61, 3.00, 1.83, 'Painel dupla placa 100mm'),
    ('LW-2P-120', 'Painel Lightwall 2P 120mm', '2P', 120.00, 0.61, 3.00, 1.83, 'Painel dupla placa 120mm'),
    ('LW-2P-140', 'Painel Lightwall 2P 140mm', '2P', 140.00, 0.61, 3.00, 1.83, 'Painel dupla placa 140mm'),
    ('LW-2P-160', 'Painel Lightwall 2P 160mm', '2P', 160.00, 0.61, 3.00, 1.83, 'Painel dupla placa 160mm'),
    ('LW-EL1T-60', 'Painel Elétrico 1 Tomada 60mm', 'ELETRICO_1T', 60.00, 0.61, 3.00, 1.83, 'Painel com 1 tomada elétrica'),
    ('LW-EL1T-80', 'Painel Elétrico 1 Tomada 80mm', 'ELETRICO_1T', 80.00, 0.61, 3.00, 1.83, 'Painel com 1 tomada elétrica'),
    ('LW-EL3T-60', 'Painel Elétrico 3 Tomadas 60mm', 'ELETRICO_3T', 60.00, 0.61, 3.00, 1.83, 'Painel com 3 tomadas elétricas'),
    ('LW-EL3T-80', 'Painel Elétrico 3 Tomadas 80mm', 'ELETRICO_3T', 80.00, 0.61, 3.00, 1.83, 'Painel com 3 tomadas elétricas'),
    ('LW-L-60', 'Painel Tipo L 60mm', 'TIPO_L', 60.00, 0.61, 3.00, 1.83, 'Painel em L para cantos 90°'),
    ('LW-L-80', 'Painel Tipo L 80mm', 'TIPO_L', 80.00, 0.61, 3.00, 1.83, 'Painel em L para cantos 90°'),
    ('LW-L-100', 'Painel Tipo L 100mm', 'TIPO_L', 100.00, 0.61, 3.00, 1.83, 'Painel em L para cantos 90°'),
    ('LW-L-120', 'Painel Tipo L 120mm', 'TIPO_L', 120.00, 0.61, 3.00, 1.83, 'Painel em L para cantos 90°'),
    ('LW-L-140', 'Painel Tipo L 140mm', 'TIPO_L', 140.00, 0.61, 3.00, 1.83, 'Painel em L para cantos 90°'),
    ('LW-L-160', 'Painel Tipo L 160mm', 'TIPO_L', 160.00, 0.61, 3.00, 1.83, 'Painel em L para cantos 90°')
  ON CONFLICT (sku) DO NOTHING;
  