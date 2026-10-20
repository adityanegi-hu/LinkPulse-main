/**
 * LinkPulse Frontend API Layer
 * Connects frontend UI to modular client-side service adapters and local persistence.
 */

import {
  Link,
  User,
  Campaign,
  Tag,
  BlocklistEntry,
  DashboardAnalytics,
  AnalyticsSummary,
  ClickEvent,
  BioPage,
  AbuseReport,
} from '../../types';
import { db } from './mockDb';
import {
  authService,
  linkService,
  analyticsService,
  campaignService,
  tagService,
  trustService,
  bioService,
  lifecycleService,
  policyLabService,
  importsService,
} from '../../services';
import { httpClient } from './httpClient';

export { LocalStore } from './localStore';
export { db } from './mockDb';
export { httpClient } from './httpClient';

// 1. Authentication API
export const authApi = {
  getUserCount: () => authService.getUserCount(),
  getCurrentUser: () => authService.getCurrentUser(),
  login: (email: string, pass: string) => authService.login(email, pass),
  register: (name: string, email: string, pass: string) => authService.register(name, email, pass),
  logout: () => authService.logout(),
  bootstrapAdmin: (data: { name: string; email: string; passwordPlain: string }) =>
    authService.bootstrapAdmin(data),
};

// 2. Links API
export const linksApi = {
  getLinks: (params?: {
    userId?: string;
    campaignId?: string;
    tag?: string;
    search?: string;
    status?: 'all' | 'active' | 'expired' | 'disabled' | 'expiring';
    page?: number;
    limit?: number;
  }) => linkService.getLinks(params),
  getLink: (id: string) => linkService.getLink(id),
  getLinkById: (id: string) => linkService.getLink(id),
  getLinkByCode: (code: string) => linkService.getLinkByCode(code),
  checkAliasAvailable: async (code: string): Promise<{ available: boolean; error?: string }> => {
    try {
      const data = await httpClient.get<{ available: boolean; reason?: string }>(
        '/links/check-alias',
        { alias: code }
      );
      if (data && typeof data.available === 'boolean') {
        return { available: data.available, error: data.reason };
      }
    } catch {}
    const existing = await linkService.getLinkByCode(code);
    return { available: !existing, error: existing ? 'Alias already taken' : undefined };
  },
  createLink: (data: {
    userId: string;
    originalUrl: string;
    shortCode?: string;
    title?: string;
    campaignId?: string;
    tags?: string[];
    rules?: any;
  }) => linkService.createLink(data),
  updateLink: (id: string, updates: Partial<Link>) => linkService.updateLink(id, updates),
  deleteLink: (id: string) => linkService.deleteLink(id),
  bulkDeleteLinks: (ids: string[]) => linkService.bulkDeleteLinks(ids),
  bulkSetStatus: (ids: string[], isActive: boolean) => linkService.bulkSetStatus(ids, isActive),
  verifyPassword: (id: string, pass: string) => linkService.verifyPassword(id, pass),
};

// 3. Clicks & Analytics API
export const clicksApi = {
  getDashboardAnalytics: (params: {
    range: string;
    campaignId?: string;
    userId?: string;
    isAdmin?: boolean;
  }) => analyticsService.getDashboardAnalytics(params),
  getAnalytics: (options: { range?: string; linkId?: string; userId?: string }) =>
    db.getAnalytics(options),
  getLinkClicks: (linkId: string, limit?: number) => analyticsService.getRecentClicks(linkId, limit),
  recordClick: (linkId: string, details?: any) => analyticsService.recordClick(linkId, details),
};

// 4. Campaigns API
export const campaignsApi = {
  getCampaigns: (userId?: string) => campaignService.getCampaigns(userId),
  getCampaign: (id: string) => campaignService.getCampaign(id),
  createCampaign: (data: { userId: string; name: string; description?: string; color: string }) =>
    campaignService.createCampaign(data),
  updateCampaign: (id: string, updates: Partial<Campaign>) =>
    campaignService.updateCampaign(id, updates),
  deleteCampaign: (id: string) => campaignService.deleteCampaign(id),
};

// 5. Tags API
export const tagsApi = {
  getTags: (userId?: string) => tagService.getTags(userId),
  createTag: (name: string, userId: string, color?: string) =>
    tagService.createTag(name, userId, color),
  deleteTag: (id: string) => tagService.deleteTag(id),
};

// 6. Admin API
export const adminApi = {
  getBlocklist: () => trustService.getBlocklist(),
  addToBlocklist: (domain: string, reason: string, addedBy?: string) =>
    trustService.addBlocklistEntry(domain, reason, addedBy),
  addBlocklistEntry: (domain: string, reason: string, addedBy?: string) =>
    trustService.addBlocklistEntry(domain, reason, addedBy),
  removeFromBlocklist: (id: string) => trustService.removeBlocklistEntry(id),
  removeBlocklistEntry: (id: string) => trustService.removeBlocklistEntry(id),
  checkDomain: (url: string) => trustService.checkDomain(url),
  getAllLinks: async (): Promise<Link[]> => {
    try {
      const data = await httpClient.get<{ items: any[] }>('/admin/links');
      if (Array.isArray(data?.items)) {
        return data.items.map((item: any) => {
          const originalUrl = item.originalUrl || item.destinationUrl || '';
          let domain = 'linkpulse.io';
          try {
            domain = new URL(originalUrl).hostname;
          } catch {}
          return {
            id: String(item.id || item._id),
            userId: String(item.userId || ''),
            userEmail: item.userEmail,
            userName: item.userName,
            originalUrl,
            shortCode: item.shortCode || '',
            title: item.title || item.shortCode || 'Untitled Link',
            domain,
            createdAt: item.createdAt || new Date().toISOString(),
            updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
            isActive: item.isActive !== undefined ? Boolean(item.isActive) : true,
            tags: Array.isArray(item.tags) ? item.tags : [],
            clicksCount: typeof item.clicksCount === 'number' ? item.clicksCount : 0,
            uniqueClicksCount: item.clicksCount || 0,
            qrScansCount: 0,
            abuseStatus: item.abuseStatus || (item.isActive ? 'clean' : 'disabled'),
            rules: {
              expiresAt: item.expiresAt,
              clickLimit: item.clickLimit,
              password: item.hasPassword ? '••••••••' : undefined,
            },
          };
        });
      }
    } catch {}
    return linkService.getLinks();
  },
  getPlatformStats: () => trustService.getOverview(),
  getOverview: () => trustService.getOverview(),
  getUsers: async (): Promise<User[]> => {
    try {
      const data = await httpClient.get<{ users: any[] }>('/admin/users');
      if (Array.isArray(data?.users)) {
        return data.users.map((u: any) => ({
          id: String(u.id || u._id),
          name: u.name,
          email: u.email,
          role: u.role,
          createdAt: u.createdAt || new Date().toISOString(),
          passwordHash: '',
          salt: '',
        }));
      }
    } catch {
      // Fallback
    }
    return db.getUsers();
  },
  updateUserRole: async (id: string, role: 'admin' | 'user') => {
    try {
      return await httpClient.patch(`/admin/users/${id}/role`, { role });
    } catch {
      return db.updateUserRole(id, role);
    }
  },
  toggleLink: async (id: string, isActive?: boolean) => {
    try {
      return await httpClient.post(`/admin/links/${id}/toggle`, { isActive });
    } catch {
      return linkService.updateLink(id, { isActive });
    }
  },
  getAbuseReports: () => trustService.getAbuseReports(),
  resolveAbuseReport: (id: string, resolution: 'resolved' | 'dismissed', action?: 'disable_link') =>
    trustService.resolveAbuseReport(id, resolution, action),
};

// 7. Trust Center API
export const trustCenterApi = {
  getHealth: () => trustService.getHealth(),
  getOverview: () => trustService.getHealth(),
  checkDomain: (url: string) => trustService.checkDomain(url),
  reportAbuse: (data: {
    linkId?: string;
    shortCode?: string;
    originalUrl?: string;
    reason: string;
    reporterEmail?: string;
  }) => trustService.reportAbuse(data),
};

// 8. Lifecycle API
export const lifecycleApi = {
  getSummary: () => lifecycleService.getSummary(),
  extendExpiry: (id: string, days: number) => lifecycleService.extendExpiry(id, days),
  increaseLimit: (id: string, count: number) => lifecycleService.increaseLimit(id, count),
  toggleStatus: (id: string) => lifecycleService.toggleStatus(id),
};

// 9. Policy Lab API
export const policyLabApi = {
  simulate: (payload: {
    linkId?: string;
    hypotheticalLink?: any;
    device?: string;
    country?: string;
    simulatedTime?: string;
    providedPassword?: string;
    simulatedClicksCount?: number;
    simulatedIsActive?: boolean;
  }) => policyLabService.simulate(payload),
};

// 10. Bio Profile API
export const bioApi = {
  getBioByUserId: (userId: string) => bioService.getBioPage(userId),
  getBioPage: (userId: string) => bioService.getBioPage(userId),
  getBioBySlug: (slug: string) => bioService.getPublicBioPage(slug),
  getPublicBioPage: (slug: string) => bioService.getPublicBioPage(slug),
  saveBioPage: (userId: string, data: Partial<BioPage>) => bioService.saveBioPage(userId, data),
  trackBioClick: (slug: string, linkId: string) => bioService.trackBioClick(slug, linkId),
};

// 11. Bulk Import API
export const importsApi = {
  importBulk: (rows: Array<{ url: string; alias?: string; title?: string; tags?: string }>) =>
    importsService.importBulk(rows),
};

// 12. Settings and System APIs
export const settingsApi = {
  resetUserData: (userId: string) => db.resetUserData(userId),
};

export const systemApi = {
  resetDemoData: () => db.resetDemoData(),
};
