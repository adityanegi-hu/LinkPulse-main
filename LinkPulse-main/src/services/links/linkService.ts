import { Link } from '../../types';
import { db } from '../../lib/api/mockDb';
import { httpClient } from '../../lib/api/httpClient';

function mapBackendLink(item: any): Link {
  if (!item) return item;
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
    campaignId: item.campaignId ? String(item.campaignId) : undefined,
    clicksCount: typeof item.clicksCount === 'number' ? item.clicksCount : 0,
    uniqueClicksCount: typeof item.uniqueClicksCount === 'number' ? item.uniqueClicksCount : item.clicksCount || 0,
    qrScansCount: typeof item.qrScansCount === 'number' ? item.qrScansCount : 0,
    abuseStatus: item.abuseStatus || (item.isActive ? 'clean' : 'disabled'),
    rules: {
      expiresAt: item.expiresAt,
      clickLimit: item.clickLimit,
      password: item.hasPassword ? '••••••••' : undefined,
      deviceTargeting: item.deviceTargeting
        ? {
            ios: item.deviceTargeting.iosUrl,
            android: item.deviceTargeting.androidUrl,
            desktop: item.deviceTargeting.desktopUrl,
          }
        : undefined,
    },
  };
}

export const linkService = {
  async getLinks(params?: {
    userId?: string;
    campaignId?: string;
    tag?: string;
    search?: string;
    status?: 'all' | 'active' | 'expired' | 'disabled' | 'expiring';
    page?: number;
    limit?: number;
  }): Promise<Link[]> {
    try {
      const data = await httpClient.get<{ items: any[]; total: number }>('/links', params);
      if (Array.isArray(data?.items)) {
        return data.items.map(mapBackendLink);
      }
    } catch {
      // Fallback to local store
    }
    return db.getLinks(params as any);
  },

  async getLink(id: string): Promise<Link> {
    try {
      const data = await httpClient.get<{ link: any }>(`/links/${id}`);
      if (data?.link) {
        return mapBackendLink(data.link);
      }
    } catch (err: any) {
      if (err.status === 404) throw err;
    }

    const link = await db.getLink(id);
    if (!link) throw new Error('Link not found');
    return link;
  },

  async getLinkByCode(code: string): Promise<Link | null> {
    try {
      const cleanCode = code.trim().toLowerCase();
      const data = await httpClient.get<{ link: any }>(`/links/code/${encodeURIComponent(cleanCode)}`);
      if (data?.link) {
        return mapBackendLink(data.link);
      }
    } catch {
      // Fallback
    }
    return db.getLinkByCode(code);
  },

  async createLink(data: {
    userId: string;
    originalUrl: string;
    shortCode?: string;
    title?: string;
    campaignId?: string;
    tags?: string[];
    rules?: any;
  }): Promise<Link> {
    try {
      const payload = {
        destinationUrl: data.originalUrl,
        customAlias: data.shortCode,
        title: data.title,
        campaignId: data.campaignId,
        tags: data.tags,
        expiresAt: data.rules?.expiresAt,
        clickLimit: data.rules?.clickLimit,
        password: data.rules?.password,
        deviceTargeting: data.rules?.deviceTargeting
          ? {
              iosUrl: data.rules.deviceTargeting.ios,
              androidUrl: data.rules.deviceTargeting.android,
              desktopUrl: data.rules.deviceTargeting.desktop,
            }
          : undefined,
      };

      const res = await httpClient.post<{ link: any }>('/links', payload);
      if (res?.link) {
        return mapBackendLink(res.link);
      }
    } catch (err: any) {
      if (err.status === 400 || err.status === 409) {
        throw err;
      }
    }

    return db.createLink({
      ...data,
      shortCode: data.shortCode || Math.random().toString(36).substring(2, 8),
      title: data.title || 'Untitled Link',
    });
  },

  async updateLink(id: string, updates: Partial<Link>): Promise<Link> {
    try {
      const payload: any = {};
      if (updates.originalUrl) payload.destinationUrl = updates.originalUrl;
      if (updates.title !== undefined) payload.title = updates.title;
      if (updates.campaignId !== undefined) payload.campaignId = updates.campaignId;
      if (updates.isActive !== undefined) payload.isActive = updates.isActive;
      if (updates.tags !== undefined) payload.tags = updates.tags;
      if (updates.rules) {
        if (updates.rules.expiresAt !== undefined) payload.expiresAt = updates.rules.expiresAt;
        if (updates.rules.clickLimit !== undefined) payload.clickLimit = updates.rules.clickLimit;
        if (updates.rules.password !== undefined) payload.password = updates.rules.password;
        if (updates.rules.deviceTargeting !== undefined) {
          payload.deviceTargeting = {
            iosUrl: updates.rules.deviceTargeting.ios,
            androidUrl: updates.rules.deviceTargeting.android,
            desktopUrl: updates.rules.deviceTargeting.desktop,
          };
        }
      }

      const res = await httpClient.patch<{ link: any }>(`/links/${id}`, payload);
      if (res?.link) {
        return mapBackendLink(res.link);
      }
    } catch (err: any) {
      if (err.status === 400 || err.status === 404) {
        throw err;
      }
    }

    return db.updateLink(id, updates);
  },

  async deleteLink(id: string): Promise<void> {
    try {
      await httpClient.delete(`/links/${id}`);
      return;
    } catch {
      // Fallback
    }
    await db.deleteLink(id);
  },

  async bulkDeleteLinks(ids: string[]): Promise<void> {
    try {
      await httpClient.post('/links/bulk-delete', { ids });
      return;
    } catch {
      // Fallback
    }
    return db.bulkDeleteLinks(ids);
  },

  async bulkSetStatus(ids: string[], isActive: boolean): Promise<void> {
    try {
      await httpClient.post('/links/bulk-status', { ids, isActive });
      return;
    } catch {
      // Fallback
    }
    return db.bulkSetStatus(ids, isActive);
  },

  async verifyPassword(id: string, passwordPlain: string): Promise<boolean> {
    try {
      // Try verifying against redirect endpoint
      const res = await httpClient.post<{ verified: boolean }>(
        `/redirect/${encodeURIComponent(id)}/verify-password`,
        { password: passwordPlain }
      );
      if (res && typeof res.verified === 'boolean') {
        return res.verified;
      }
    } catch {
      // Fallback
    }
    return db.verifyPassword(id, passwordPlain);
  },
};
