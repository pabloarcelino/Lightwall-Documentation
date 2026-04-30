import { db } from "./db";
import { eq, and, desc, asc } from "drizzle-orm";
import {
  products,
  projects,
  projectFiles,
  extractedData,
  budgets,
  settings,
  projectPages,
  takeoffSegments,
  takeoffSlabs,
  aiRuns,
  takeoffRevisions,
  takeoffExports,
  type Product,
  type InsertProduct,
  type Project,
  type InsertProject,
  type ProjectFile,
  type InsertProjectFile,
  type ExtractedData,
  type InsertExtractedData,
  type Budget,
  type InsertBudget,
  type Setting,
  type ProjectPage,
  type InsertProjectPage,
  type TakeoffSegment,
  type InsertTakeoffSegment,
  type TakeoffSlab,
  type InsertTakeoffSlab,
  type AiRun,
  type InsertAiRun,
  type TakeoffRevision,
  type InsertTakeoffRevision,
  type TakeoffExport,
  type InsertTakeoffExport,
} from "@shared/schema";

export interface IStorage {
  getProducts(): Promise<Product[]>;
  getProductBySku(sku: string): Promise<Product | undefined>;
  getProductsByCategory(category: string): Promise<Product[]>;
  createProduct(product: InsertProduct): Promise<Product>;
  updateProduct(id: number, data: Partial<InsertProduct>): Promise<Product | undefined>;
  deleteProduct(id: number): Promise<void>;

  createProject(project: InsertProject): Promise<Project>;
  getProjects(): Promise<Project[]>;
  getProject(id: number): Promise<Project | undefined>;
  updateProject(id: number, data: Partial<{ name: string; clientName: string; description: string; projectType: string; buildingType: string | null; realCost: string | null; realAreaExt: string | null; realAreaInt: string | null; realAreaPiso: string | null; realAreaCoberta: string | null }>): Promise<Project | undefined>;
  updateProjectStatus(id: number, status: string): Promise<Project | undefined>;

  addProjectFile(file: InsertProjectFile): Promise<ProjectFile>;
  getProjectFile(fileId: number): Promise<ProjectFile | undefined>;
  getProjectFiles(projectId: number): Promise<ProjectFile[]>;
  updateFilePageType(
    fileId: number,
    pageType: string,
  ): Promise<ProjectFile | undefined>;

  deleteProjectFile(fileId: number): Promise<void>;

  addExtractedData(data: InsertExtractedData): Promise<ExtractedData>;
  getExtractedData(projectId: number): Promise<ExtractedData[]>;
  getExtractedDataByType(projectId: number, elementType: string): Promise<ExtractedData | undefined>;
  updateExtractedDataByType(projectId: number, elementType: string, data: any): Promise<void>;
  clearExtractedData(projectId: number): Promise<void>;
  getAllBudgetsWithProjects(): Promise<Array<{ budget: Budget; project: Project }>>;

  createBudget(budget: InsertBudget): Promise<Budget>;
  getBudget(projectId: number): Promise<Budget | undefined>;
  deleteBudget(projectId: number): Promise<void>;

  deleteProject(id: number): Promise<void>;

  getSetting(key: string): Promise<string | undefined>;
  setSetting(key: string, value: string): Promise<void>;

  // ===== Takeoff =====
  createProjectPage(page: InsertProjectPage): Promise<ProjectPage>;
  getProjectPages(projectId: number): Promise<ProjectPage[]>;
  getProjectPage(pageId: number): Promise<ProjectPage | undefined>;
  updateProjectPage(pageId: number, data: Partial<InsertProjectPage>): Promise<ProjectPage | undefined>;
  deleteProjectPage(pageId: number): Promise<void>;
  deleteProjectPages(projectId: number): Promise<void>;

  createTakeoffSegment(segment: InsertTakeoffSegment): Promise<TakeoffSegment>;
  bulkCreateTakeoffSegments(segments: InsertTakeoffSegment[]): Promise<TakeoffSegment[]>;
  getTakeoffSegments(projectId: number): Promise<TakeoffSegment[]>;
  getTakeoffSegment(segmentId: number): Promise<TakeoffSegment | undefined>;
  updateTakeoffSegment(segmentId: number, data: Partial<InsertTakeoffSegment>): Promise<TakeoffSegment | undefined>;
  deleteTakeoffSegment(segmentId: number): Promise<void>;
  deleteTakeoffSegmentsByPage(pageId: number): Promise<void>;

  createTakeoffSlab(slab: InsertTakeoffSlab): Promise<TakeoffSlab>;
  bulkCreateTakeoffSlabs(slabs: InsertTakeoffSlab[]): Promise<TakeoffSlab[]>;
  getTakeoffSlabs(projectId: number): Promise<TakeoffSlab[]>;
  getTakeoffSlab(slabId: number): Promise<TakeoffSlab | undefined>;
  updateTakeoffSlab(slabId: number, data: Partial<InsertTakeoffSlab>): Promise<TakeoffSlab | undefined>;
  deleteTakeoffSlab(slabId: number): Promise<void>;
  deleteTakeoffSlabsByPage(pageId: number): Promise<void>;

  createAiRun(run: InsertAiRun): Promise<AiRun>;
  getAiRuns(projectId: number): Promise<AiRun[]>;

  createTakeoffRevision(rev: InsertTakeoffRevision): Promise<TakeoffRevision>;
  getTakeoffRevisions(projectId: number): Promise<TakeoffRevision[]>;

  createTakeoffExport(exp: InsertTakeoffExport): Promise<TakeoffExport>;
  getTakeoffExports(projectId: number): Promise<TakeoffExport[]>;
}

export class DatabaseStorage implements IStorage {
  async getProducts(): Promise<Product[]> {
    return db.select().from(products);
  }

  async getProductBySku(sku: string): Promise<Product | undefined> {
    const [product] = await db
      .select()
      .from(products)
      .where(eq(products.sku, sku));
    return product;
  }

  async getProductsByCategory(category: string): Promise<Product[]> {
    return db
      .select()
      .from(products)
      .where(eq(products.category, category));
  }

  async createProduct(product: InsertProduct): Promise<Product> {
    const [created] = await db.insert(products).values(product).returning();
    return created;
  }

  async updateProduct(id: number, data: Partial<InsertProduct>): Promise<Product | undefined> {
    const [updated] = await db
      .update(products)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(products.id, id))
      .returning();
    return updated;
  }

  async deleteProduct(id: number): Promise<void> {
    await db.delete(products).where(eq(products.id, id));
  }

  async createProject(project: InsertProject): Promise<Project> {
    const [created] = await db.insert(projects).values(project).returning();
    return created;
  }

  async getProjects(): Promise<Project[]> {
    return db.select().from(projects).orderBy(projects.createdAt);
  }

  async getProject(id: number): Promise<Project | undefined> {
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, id));
    return project;
  }

  async updateProject(
    id: number,
    data: Partial<{ name: string; clientName: string; description: string; projectType: string; buildingType: string | null; realCost: string | null; realAreaExt: string | null; realAreaInt: string | null; realAreaPiso: string | null; realAreaCoberta: string | null }>,
  ): Promise<Project | undefined> {
    const [updated] = await db
      .update(projects)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning();
    return updated;
  }

  async updateProjectStatus(
    id: number,
    status: string,
  ): Promise<Project | undefined> {
    const [updated] = await db
      .update(projects)
      .set({ status, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning();
    return updated;
  }

  async addProjectFile(file: InsertProjectFile): Promise<ProjectFile> {
    const [created] = await db.insert(projectFiles).values(file).returning();
    return created;
  }

  async getProjectFile(fileId: number): Promise<ProjectFile | undefined> {
    const [file] = await db
      .select()
      .from(projectFiles)
      .where(eq(projectFiles.id, fileId));
    return file;
  }

  async getProjectFiles(projectId: number): Promise<ProjectFile[]> {
    return db
      .select()
      .from(projectFiles)
      .where(eq(projectFiles.projectId, projectId));
  }

  async updateFilePageType(
    fileId: number,
    pageType: string,
  ): Promise<ProjectFile | undefined> {
    const [updated] = await db
      .update(projectFiles)
      .set({ pageType })
      .where(eq(projectFiles.id, fileId))
      .returning();
    return updated;
  }

  async deleteProjectFile(fileId: number): Promise<void> {
    await db.delete(projectFiles).where(eq(projectFiles.id, fileId));
  }

  async addExtractedData(data: InsertExtractedData): Promise<ExtractedData> {
    const [created] = await db.insert(extractedData).values(data).returning();
    return created;
  }

  async getExtractedData(projectId: number): Promise<ExtractedData[]> {
    return db
      .select()
      .from(extractedData)
      .where(eq(extractedData.projectId, projectId));
  }

  async getExtractedDataByType(projectId: number, elementType: string): Promise<ExtractedData | undefined> {
    const [record] = await db
      .select()
      .from(extractedData)
      .where(
        and(
          eq(extractedData.projectId, projectId),
          eq(extractedData.elementType, elementType),
        ),
      );
    return record;
  }

  async updateExtractedDataByType(projectId: number, elementType: string, data: any): Promise<void> {
    await db
      .update(extractedData)
      .set({ data })
      .where(
        and(
          eq(extractedData.projectId, projectId),
          eq(extractedData.elementType, elementType),
        ),
      );
  }

  async clearExtractedData(projectId: number): Promise<void> {
    await db
      .delete(extractedData)
      .where(eq(extractedData.projectId, projectId));
  }

  async createBudget(budget: InsertBudget): Promise<Budget> {
    const [created] = await db.insert(budgets).values(budget).returning();
    return created;
  }

  async getBudget(projectId: number): Promise<Budget | undefined> {
    const [budget] = await db
      .select()
      .from(budgets)
      .where(eq(budgets.projectId, projectId));
    return budget;
  }

  async deleteBudget(projectId: number): Promise<void> {
    await db.delete(budgets).where(eq(budgets.projectId, projectId));
  }

  async getAllBudgetsWithProjects(): Promise<Array<{ budget: Budget; project: Project }>> {
    const rows = await db
      .select({ budget: budgets, project: projects })
      .from(budgets)
      .innerJoin(projects, eq(budgets.projectId, projects.id));
    return rows;
  }

  async deleteProject(id: number): Promise<void> {
    await db.delete(budgets).where(eq(budgets.projectId, id));
    await db.delete(extractedData).where(eq(extractedData.projectId, id));
    await db.delete(takeoffExports).where(eq(takeoffExports.projectId, id));
    await db.delete(takeoffRevisions).where(eq(takeoffRevisions.projectId, id));
    await db.delete(aiRuns).where(eq(aiRuns.projectId, id));
    await db.delete(takeoffSegments).where(eq(takeoffSegments.projectId, id));
    await db.delete(takeoffSlabs).where(eq(takeoffSlabs.projectId, id));
    await db.delete(projectPages).where(eq(projectPages.projectId, id));
    await db.delete(projectFiles).where(eq(projectFiles.projectId, id));
    await db.delete(projects).where(eq(projects.id, id));
  }

  // ===== Takeoff =====
  async createProjectPage(page: InsertProjectPage): Promise<ProjectPage> {
    const [created] = await db.insert(projectPages).values(page).returning();
    return created;
  }

  async getProjectPages(projectId: number): Promise<ProjectPage[]> {
    return db
      .select()
      .from(projectPages)
      .where(eq(projectPages.projectId, projectId))
      .orderBy(asc(projectPages.pageNumber));
  }

  async getProjectPage(pageId: number): Promise<ProjectPage | undefined> {
    const [page] = await db.select().from(projectPages).where(eq(projectPages.id, pageId));
    return page;
  }

  async updateProjectPage(
    pageId: number,
    data: Partial<InsertProjectPage>,
  ): Promise<ProjectPage | undefined> {
    const [updated] = await db
      .update(projectPages)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(projectPages.id, pageId))
      .returning();
    return updated;
  }

  async deleteProjectPage(pageId: number): Promise<void> {
    await db.delete(projectPages).where(eq(projectPages.id, pageId));
  }

  async deleteProjectPages(projectId: number): Promise<void> {
    await db.delete(projectPages).where(eq(projectPages.projectId, projectId));
  }

  async createTakeoffSegment(segment: InsertTakeoffSegment): Promise<TakeoffSegment> {
    const [created] = await db.insert(takeoffSegments).values(segment).returning();
    return created;
  }

  async bulkCreateTakeoffSegments(segments: InsertTakeoffSegment[]): Promise<TakeoffSegment[]> {
    if (segments.length === 0) return [];
    return db.insert(takeoffSegments).values(segments).returning();
  }

  async getTakeoffSegments(projectId: number): Promise<TakeoffSegment[]> {
    return db
      .select()
      .from(takeoffSegments)
      .where(eq(takeoffSegments.projectId, projectId))
      .orderBy(asc(takeoffSegments.id));
  }

  async getTakeoffSegment(segmentId: number): Promise<TakeoffSegment | undefined> {
    const [s] = await db.select().from(takeoffSegments).where(eq(takeoffSegments.id, segmentId));
    return s;
  }

  async updateTakeoffSegment(
    segmentId: number,
    data: Partial<InsertTakeoffSegment>,
  ): Promise<TakeoffSegment | undefined> {
    const [updated] = await db
      .update(takeoffSegments)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(takeoffSegments.id, segmentId))
      .returning();
    return updated;
  }

  async deleteTakeoffSegment(segmentId: number): Promise<void> {
    await db.delete(takeoffSegments).where(eq(takeoffSegments.id, segmentId));
  }

  async deleteTakeoffSegmentsByPage(pageId: number): Promise<void> {
    await db.delete(takeoffSegments).where(eq(takeoffSegments.pageId, pageId));
  }

  async createTakeoffSlab(slab: InsertTakeoffSlab): Promise<TakeoffSlab> {
    const [created] = await db.insert(takeoffSlabs).values(slab).returning();
    return created;
  }

  async bulkCreateTakeoffSlabs(slabs: InsertTakeoffSlab[]): Promise<TakeoffSlab[]> {
    if (slabs.length === 0) return [];
    return db.insert(takeoffSlabs).values(slabs).returning();
  }

  async getTakeoffSlabs(projectId: number): Promise<TakeoffSlab[]> {
    return db
      .select()
      .from(takeoffSlabs)
      .where(eq(takeoffSlabs.projectId, projectId))
      .orderBy(asc(takeoffSlabs.id));
  }

  async getTakeoffSlab(slabId: number): Promise<TakeoffSlab | undefined> {
    const [s] = await db.select().from(takeoffSlabs).where(eq(takeoffSlabs.id, slabId));
    return s;
  }

  async updateTakeoffSlab(
    slabId: number,
    data: Partial<InsertTakeoffSlab>,
  ): Promise<TakeoffSlab | undefined> {
    const [updated] = await db
      .update(takeoffSlabs)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(takeoffSlabs.id, slabId))
      .returning();
    return updated;
  }

  async deleteTakeoffSlab(slabId: number): Promise<void> {
    await db.delete(takeoffSlabs).where(eq(takeoffSlabs.id, slabId));
  }

  async deleteTakeoffSlabsByPage(pageId: number): Promise<void> {
    await db.delete(takeoffSlabs).where(eq(takeoffSlabs.pageId, pageId));
  }

  async createAiRun(run: InsertAiRun): Promise<AiRun> {
    const [created] = await db.insert(aiRuns).values(run).returning();
    return created;
  }

  async getAiRuns(projectId: number): Promise<AiRun[]> {
    return db
      .select()
      .from(aiRuns)
      .where(eq(aiRuns.projectId, projectId))
      .orderBy(desc(aiRuns.createdAt));
  }

  async createTakeoffRevision(rev: InsertTakeoffRevision): Promise<TakeoffRevision> {
    const [created] = await db.insert(takeoffRevisions).values(rev).returning();
    return created;
  }

  async getTakeoffRevisions(projectId: number): Promise<TakeoffRevision[]> {
    return db
      .select()
      .from(takeoffRevisions)
      .where(eq(takeoffRevisions.projectId, projectId))
      .orderBy(desc(takeoffRevisions.createdAt));
  }

  async createTakeoffExport(exp: InsertTakeoffExport): Promise<TakeoffExport> {
    const [created] = await db.insert(takeoffExports).values(exp).returning();
    return created;
  }

  async getTakeoffExports(projectId: number): Promise<TakeoffExport[]> {
    return db
      .select()
      .from(takeoffExports)
      .where(eq(takeoffExports.projectId, projectId))
      .orderBy(desc(takeoffExports.createdAt));
  }

  async getSetting(key: string): Promise<string | undefined> {
    const [setting] = await db
      .select()
      .from(settings)
      .where(eq(settings.key, key));
    return setting?.value;
  }

  async setSetting(key: string, value: string): Promise<void> {
    const existing = await this.getSetting(key);
    if (existing !== undefined) {
      await db
        .update(settings)
        .set({ value, updatedAt: new Date() })
        .where(eq(settings.key, key));
    } else {
      await db.insert(settings).values({ key, value });
    }
  }
}

export const storage = new DatabaseStorage();
