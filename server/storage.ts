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
  pricingProfiles,
  profilePrices,
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
  type PricingProfile,
  type InsertPricingProfile,
  type ProfilePrice,
  type InsertProfilePrice,
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
  updateProject(id: number, data: Partial<{ name: string; clientName: string; clientEmail: string; description: string; projectType: string; buildingType: string | null; fileFingerprint: string; realCost: string | null; realAreaExt: string | null; realAreaInt: string | null; realAreaPiso: string | null; realAreaCoberta: string | null; realAreaMuros: string | null; discountPanelPct: string; freightCost: string; biomassCost: string; pricingProfileId: number | null }>): Promise<Project | undefined>;
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
  addExtractedDataBatch(items: InsertExtractedData[]): Promise<number>;
  getExtractedData(projectId: number): Promise<ExtractedData[]>;
  getExtractedDataByType(projectId: number, elementType: string): Promise<ExtractedData | undefined>;
  updateExtractedDataByType(projectId: number, elementType: string, data: any): Promise<void>;
  clearExtractedData(projectId: number): Promise<void>;
  getAllBudgetsWithProjects(): Promise<Array<{ budget: Budget; project: Project }>>;

  createBudget(budget: InsertBudget): Promise<Budget>;
  getBudget(projectId: number): Promise<Budget | undefined>;
  updateBudgetTotalCost(projectId: number, totalCost: string): Promise<void>;
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
  updateUser(id: number, data: Partial<{ displayName: string; role: string; active: number; storeName: string | null; pricingProfileId: number | null }>): Promise<User | undefined>;
  updateUserPassword(id: number, hashedPassword: string): Promise<void>;
  updateUserLastLogin(id: number): Promise<void>;

  // ===== Pricing Profiles =====
  getPricingProfiles(): Promise<PricingProfile[]>;
  getPricingProfile(id: number): Promise<PricingProfile | undefined>;
  getDefaultPricingProfile(): Promise<PricingProfile | undefined>;
  createPricingProfile(p: InsertPricingProfile): Promise<PricingProfile>;
  updatePricingProfile(id: number, data: Partial<InsertPricingProfile>): Promise<PricingProfile | undefined>;
  deletePricingProfile(id: number): Promise<void>;
  getProfilePrices(profileId: number): Promise<ProfilePrice[]>;
  getProfilePrice(profileId: number, sku: string): Promise<ProfilePrice | undefined>;
  upsertProfilePrice(profileId: number, sku: string, unitPrice: string): Promise<ProfilePrice>;
  deleteProfilePrice(profileId: number, sku: string): Promise<void>;
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
    data: Partial<{ name: string; clientName: string; clientEmail: string; description: string; projectType: string; buildingType: string | null; fileFingerprint: string; realCost: string | null; realAreaExt: string | null; realAreaInt: string | null; realAreaPiso: string | null; realAreaCoberta: string | null }>,
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

  async addExtractedDataBatch(items: InsertExtractedData[]): Promise<number> {
    if (items.length === 0) return 0;
    // Insert in chunks to avoid hitting parameter limits and to recover from
    // transient connection drops (Neon serverless sometimes terminates idle
    // connections mid-loop with code 57P01).
    const CHUNK = 50;
    const MAX_RETRIES = 3;
    let inserted = 0;
    for (let i = 0; i < items.length; i += CHUNK) {
      const slice = items.slice(i, i + CHUNK);
      let attempt = 0;
      while (true) {
        try {
          await db.insert(extractedData).values(slice);
          inserted += slice.length;
          break;
        } catch (err: any) {
          const code = err?.code || err?.cause?.code;
          const transient =
            code === "57P01" || code === "ECONNRESET" || code === "ETIMEDOUT" ||
            /terminating connection|connection terminated|Connection terminated/i.test(err?.message || "");
          attempt++;
          if (!transient || attempt >= MAX_RETRIES) throw err;
          const backoff = 250 * Math.pow(2, attempt - 1);
          console.warn(`[STORAGE] addExtractedDataBatch retry ${attempt}/${MAX_RETRIES} apos ${backoff}ms (code=${code || "?"})`);
          await new Promise((r) => setTimeout(r, backoff));
        }
      }
    }
    return inserted;
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

  async updateBudgetTotalCost(projectId: number, totalCost: string): Promise<void> {
    await db.update(budgets).set({ totalCost }).where(eq(budgets.projectId, projectId));
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

  async updateUser(id: number, data: Partial<{ displayName: string; role: string; active: number; storeName: string | null; pricingProfileId: number | null }>): Promise<User | undefined> {
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

  // ===== Pricing Profiles =====
  async getPricingProfiles(): Promise<PricingProfile[]> {
    return db.select().from(pricingProfiles).orderBy(asc(pricingProfiles.code));
  }
  async getPricingProfile(id: number): Promise<PricingProfile | undefined> {
    const [p] = await db.select().from(pricingProfiles).where(eq(pricingProfiles.id, id));
    return p;
  }
  async getDefaultPricingProfile(): Promise<PricingProfile | undefined> {
    const [p] = await db.select().from(pricingProfiles).where(eq(pricingProfiles.isDefault, 1));
    return p;
  }
  async createPricingProfile(p: InsertPricingProfile): Promise<PricingProfile> {
    const [created] = await db.insert(pricingProfiles).values(p).returning();
    return created;
  }
  async updatePricingProfile(id: number, data: Partial<InsertPricingProfile>): Promise<PricingProfile | undefined> {
    const [updated] = await db.update(pricingProfiles).set({ ...data, updatedAt: new Date() }).where(eq(pricingProfiles.id, id)).returning();
    return updated;
  }
  async deletePricingProfile(id: number): Promise<void> {
    await db.delete(pricingProfiles).where(eq(pricingProfiles.id, id));
  }
  async getProfilePrices(profileId: number): Promise<ProfilePrice[]> {
    return db.select().from(profilePrices).where(eq(profilePrices.profileId, profileId)).orderBy(asc(profilePrices.sku));
  }
  async getProfilePrice(profileId: number, sku: string): Promise<ProfilePrice | undefined> {
    const [pp] = await db.select().from(profilePrices).where(and(eq(profilePrices.profileId, profileId), eq(profilePrices.sku, sku)));
    return pp;
  }
  async upsertProfilePrice(profileId: number, sku: string, unitPrice: string): Promise<ProfilePrice> {
    const existing = await this.getProfilePrice(profileId, sku);
    if (existing) {
      const [updated] = await db.update(profilePrices).set({ unitPrice, updatedAt: new Date() }).where(eq(profilePrices.id, existing.id)).returning();
      return updated;
    }
    const [created] = await db.insert(profilePrices).values({ profileId, sku, unitPrice }).returning();
    return created;
  }
  async deleteProfilePrice(profileId: number, sku: string): Promise<void> {
    await db.delete(profilePrices).where(and(eq(profilePrices.profileId, profileId), eq(profilePrices.sku, sku)));
  }
}

export const storage = new DatabaseStorage();
