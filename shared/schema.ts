import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  text,
  varchar,
  integer,
  decimal,
  timestamp,
  jsonb,
  boolean,
  real,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 100 }).notNull().unique(),
  password: varchar("password", { length: 255 }).notNull(),
  displayName: varchar("display_name", { length: 255 }),
  role: varchar("role", { length: 50 }).notNull().default("viewer"),
  active: integer("active").notNull().default(1),
  storeName: varchar("store_name", { length: 255 }),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  sku: varchar("sku", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  category: varchar("category", { length: 100 }).notNull(),
  panelType: varchar("panel_type", { length: 20 }),
  thickness: integer("thickness").notNull().default(0),
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }).notNull(),
  unit: varchar("unit", { length: 20 }).notNull().default("m²"),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const BUILDING_TYPES = ["residencial", "comercial", "institucional", "industrial", "outro"] as const;
export type BuildingType = (typeof BUILDING_TYPES)[number];

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  clientName: varchar("client_name", { length: 255 }),
  clientEmail: varchar("client_email", { length: 255 }),
  description: text("description"),
  status: varchar("status", { length: 50 }).default("draft"),
  projectType: varchar("project_type", { length: 20 }).default("real"),
  buildingType: varchar("building_type", { length: 30 }),
  fileFingerprint: varchar("file_fingerprint", { length: 128 }),
  realCost: decimal("real_cost", { precision: 15, scale: 2 }),
  realAreaExt: decimal("real_area_ext", { precision: 10, scale: 2 }),
  realAreaInt: decimal("real_area_int", { precision: 10, scale: 2 }),
  realAreaPiso: decimal("real_area_piso", { precision: 10, scale: 2 }),
  realAreaMuros: decimal("real_area_muros", { precision: 10, scale: 2 }),
  realAreaCoberta: decimal("real_area_coberta", { precision: 10, scale: 2 }),
  discountPanelPct: decimal("discount_panel_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  freightCost: decimal("freight_cost", { precision: 15, scale: 2 }).notNull().default("0"),
  biomassCost: decimal("biomass_cost", { precision: 15, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const projectFiles = pgTable("project_files", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  originalName: varchar("original_name", { length: 255 }).notNull(),
  filePath: varchar("file_path", { length: 500 }).notNull(),
  fileType: varchar("file_type", { length: 50 }).notNull(),
  fileSize: integer("file_size"),
  pageType: varchar("page_type", { length: 100 }),
  uploadDate: timestamp("upload_date").defaultNow(),
});

export const extractedData = pgTable("extracted_data", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  fileId: integer("file_id").references(() => projectFiles.id, {
    onDelete: "set null",
  }),
  elementType: varchar("element_type", { length: 100 }).notNull(),
  data: jsonb("data").notNull(),
  hasAssumption: integer("has_assumption").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const budgets = pgTable("budgets", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  budgetData: jsonb("budget_data").notNull(),
  totalArea: decimal("total_area", { precision: 10, scale: 2 }),
  totalCost: decimal("total_cost", { precision: 15, scale: 2 }),
  status: varchar("status", { length: 50 }).default("draft"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  key: varchar("key", { length: 100 }).notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ===== OpenAI Vision Takeoff: type constants used by AiTakeoffService prompts =====
export const TAKEOFF_SEGMENT_CATEGORY = ["parede_externa", "parede_interna", "muro"] as const;
export type TakeoffSegmentCategory = (typeof TAKEOFF_SEGMENT_CATEGORY)[number];

export const TAKEOFF_LEVEL = [
  "1_pavimento",
  "subsolo",
  "caixa_dagua",
  "situacao",
  "cobertura",
  "outro",
] as const;
export type TakeoffLevel = (typeof TAKEOFF_LEVEL)[number];

export const TAKEOFF_GEOMETRY = ["line", "polyline", "arc"] as const;
export type TakeoffGeometryType = (typeof TAKEOFF_GEOMETRY)[number];

export const TAKEOFF_SLAB_CATEGORY = ["laje_piso", "laje_cobertura"] as const;
export type TakeoffSlabCategory = (typeof TAKEOFF_SLAB_CATEGORY)[number];

// Audit table for AI runs (raw input, raw output, token usage)
export const aiRuns = pgTable("ai_runs", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  pageId: integer("page_id"),
  promptVersion: varchar("prompt_version", { length: 50 }).notNull(),
  model: varchar("model", { length: 100 }).notNull(),
  inputFileId: varchar("input_file_id", { length: 100 }),
  inputSummary: text("input_summary"),
  outputJson: jsonb("output_json"),
  tokenUsage: jsonb("token_usage"),
  durationMs: integer("duration_ms"),
  status: varchar("status", { length: 30 }).notNull(),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertProductSchema = createInsertSchema(products).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertProjectSchema = createInsertSchema(projects).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertProjectFileSchema = createInsertSchema(projectFiles).omit({
  id: true,
  uploadDate: true,
});

export const insertExtractedDataSchema = createInsertSchema(extractedData).omit(
  {
    id: true,
    createdAt: true,
  },
);

export const insertBudgetSchema = createInsertSchema(budgets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAiRunSchema = createInsertSchema(aiRuns).omit({
  id: true,
  createdAt: true,
});

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type Setting = typeof settings.$inferSelect;

export type Product = typeof products.$inferSelect;
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Project = typeof projects.$inferSelect;
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type ProjectFile = typeof projectFiles.$inferSelect;
export type InsertProjectFile = z.infer<typeof insertProjectFileSchema>;
export type ExtractedData = typeof extractedData.$inferSelect;
export type InsertExtractedData = z.infer<typeof insertExtractedDataSchema>;
export type Budget = typeof budgets.$inferSelect;
export type InsertBudget = z.infer<typeof insertBudgetSchema>;

export type AiRun = typeof aiRuns.$inferSelect;
export type InsertAiRun = z.infer<typeof insertAiRunSchema>;

// ===== Strict structured-output schema for OpenAI Responses API =====
// Mirror of the JSON Schema used in the Responses call for runtime validation.
export const TakeoffPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

export const TakeoffAiSegmentSchema = z.object({
  id: z.string(),
  category: z.enum(TAKEOFF_SEGMENT_CATEGORY),
  level: z.enum(TAKEOFF_LEVEL),
  geometry_type: z.enum(TAKEOFF_GEOMETRY),
  points: z.array(TakeoffPointSchema).min(2),
  length_m_ai: z.number().nullable(),
  length_m_calculated: z.number().nullable(),
  height_m: z.number().nullable(),
  area_m2_one_face: z.number().nullable(),
  area_m2_two_faces: z.number().nullable(),
  openings_detected: z.boolean(),
  gross_or_net: z.enum(["bruta", "liquida", "nao_aplicavel"]),
  confidence: z.number().min(0).max(1),
  evidence: z.string(),
  needs_review: z.boolean(),
});

export const TakeoffAiSlabSchema = z.object({
  id: z.string(),
  category: z.enum(TAKEOFF_SLAB_CATEGORY),
  level: z.string(),
  polygon: z.array(TakeoffPointSchema).min(3),
  area_m2_ai: z.number().nullable(),
  area_m2_declared: z.number().nullable(),
  area_m2_calculated: z.number().nullable(),
  confidence: z.number().min(0).max(1),
  evidence: z.string(),
  needs_review: z.boolean(),
});

export const TakeoffAiSheetSchema = z.object({
  sheet_id: z.string(),
  sheet_name: z.string(),
  page_number: z.number(),
  scale_detected: z.string().nullable(),
  image_width_px: z.number(),
  image_height_px: z.number(),
  segments: z.array(TakeoffAiSegmentSchema),
  slabs: z.array(TakeoffAiSlabSchema),
});

export const TakeoffAiResponseSchema = z.object({
  project_name: z.string(),
  assumptions: z.string(),
  sheets: z.array(TakeoffAiSheetSchema),
  totals: z
    .object({
      parede_externa_m: z.number().nullable().optional(),
      parede_interna_m: z.number().nullable().optional(),
      muro_m: z.number().nullable().optional(),
      laje_piso_m2: z.number().nullable().optional(),
      laje_cobertura_m2: z.number().nullable().optional(),
    })
    .nullable()
    .optional(),
});

export type TakeoffAiResponse = z.infer<typeof TakeoffAiResponseSchema>;
export type TakeoffAiSheet = z.infer<typeof TakeoffAiSheetSchema>;
export type TakeoffAiSegment = z.infer<typeof TakeoffAiSegmentSchema>;
export type TakeoffAiSlab = z.infer<typeof TakeoffAiSlabSchema>;
export type TakeoffPoint = z.infer<typeof TakeoffPointSchema>;
