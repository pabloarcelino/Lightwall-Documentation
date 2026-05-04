import { db } from "./db";
import { eq, and, desc, asc } from "drizzle-orm";
import {
  products,
  projects,
  projectFiles,
  extractedData,
  budgets,
  settings,
  aiRuns,
  users,
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
  type AiRun,
  type InsertAiRun,
  type User,
  type InsertUser,
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

  // ===== AI audit =====
  createAiRun(run: InsertAiRun): Promise<AiRun>;
  getAiRuns(projectId: number): Promise<AiRun[]>;

  // ===== Users =====
  getUsers(): Promise<User[]>;
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, data: Partial<{ displayName: string; role: string; active: number; storeName: string | null }>): Promise<User | undefined>;
  updateUserPassword(id: number, hashedPassword: string): Promise<void>;
  updateUserLastLogin(id: number): Promise<void>;
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
    await db.delete(aiRuns).where(eq(aiRuns.projectId, id));
    await db.delete(projectFiles).where(eq(projectFiles.projectId, id));
    await db.delete(projects).where(eq(projects.id, id));
  }

  // ===== AI audit =====
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

  async getUsers(): Promise<User[]> {
    return db.select().from(users).orderBy(asc(users.username));
  }

  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(user: InsertUser): Promise<User> {
    const [created] = await db.insert(users).values(user).returning();
    return created;
  }

  async updateUser(id: number, data: Partial<{ displayName: string; role: string; active: number; storeName: string | null }>): Promise<User | undefined> {
    const [updated] = await db
      .update(users)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return updated;
  }

  async updateUserPassword(id: number, hashedPassword: string): Promise<void> {
    await db
      .update(users)
      .set({ password: hashedPassword, updatedAt: new Date() })
      .where(eq(users.id, id));
  }

  async updateUserLastLogin(id: number): Promise<void> {
    await db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, id));
  }
}

export const storage = new DatabaseStorage();
