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
  description: text("description"),
  status: varchar("status", { length: 50 }).default("draft"),
  projectType: varchar("project_type", { length: 20 }).default("real"),
  buildingType: varchar("building_type", { length: 30 }),
  realCost: decimal("real_cost", { precision: 15, scale: 2 }),
  realAreaExt: decimal("real_area_ext", { precision: 10, scale: 2 }),
  realAreaInt: decimal("real_area_int", { precision: 10, scale: 2 }),
  realAreaPiso: decimal("real_area_piso", { precision: 10, scale: 2 }),
  realAreaMuros: decimal("real_area_muros", { precision: 10, scale: 2 }),
  realAreaCoberta: decimal("real_area_coberta", { precision: 10, scale: 2 }),
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
