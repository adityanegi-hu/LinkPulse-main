import { Campaign, Tag } from '../../types';
import { db } from '../../lib/api/mockDb';
import { httpClient } from '../../lib/api/httpClient';

function mapBackendCampaign(c: any): Campaign {
  return {
    id: String(c.id || c._id),
    userId: String(c.userId || ''),
    name: c.name || 'Untitled Campaign',
    description: c.description,
    color: c.color || '#18181B',
    createdAt: c.createdAt || new Date().toISOString(),
    linksCount: typeof c.linkCount === 'number' ? c.linkCount : c.linksCount || 0,
    clicksCount: typeof c.totalClicks === 'number' ? c.totalClicks : c.clicksCount || 0,
  };
}

function mapBackendTag(t: any): Tag {
  return {
    id: String(t.id || t._id),
    userId: String(t.userId || ''),
    name: t.name || '',
    color: t.color || '#18181B',
    createdAt: t.createdAt || new Date().toISOString(),
    linksCount: typeof t.linkCount === 'number' ? t.linkCount : t.linksCount || 0,
  };
}

export const campaignService = {
  async getCampaigns(userId?: string): Promise<Campaign[]> {
    try {
      const data = await httpClient.get<{ items: any[] }>('/campaigns');
      if (Array.isArray(data?.items)) {
        return data.items.map(mapBackendCampaign);
      }
    } catch {
      // Fallback
    }
    return db.getCampaigns(userId);
  },

  async getCampaign(id: string): Promise<Campaign> {
    try {
      const data = await httpClient.get<{ campaign: any }>(`/campaigns/${id}`);
      if (data?.campaign) {
        return mapBackendCampaign(data.campaign);
      }
    } catch {
      // Fallback
    }

    const campaigns = await db.getCampaigns();
    const found = campaigns.find((c) => c.id === id);
    if (!found) throw new Error('Campaign not found');
    return found;
  },

  async createCampaign(data: {
    userId: string;
    name: string;
    description?: string;
    color: string;
  }): Promise<Campaign> {
    try {
      const res = await httpClient.post<{ campaign: any }>('/campaigns', {
        name: data.name,
        description: data.description,
        color: data.color,
      });
      if (res?.campaign) {
        return mapBackendCampaign(res.campaign);
      }
    } catch (err: any) {
      if (err.status === 400) throw err;
    }

    return db.createCampaign(data);
  },

  async updateCampaign(id: string, updates: Partial<Campaign>): Promise<Campaign> {
    try {
      const res = await httpClient.patch<{ campaign: any }>(`/campaigns/${id}`, updates);
      if (res?.campaign) {
        return mapBackendCampaign(res.campaign);
      }
    } catch (err: any) {
      if (err.status === 400 || err.status === 404) throw err;
    }

    return db.updateCampaign(id, updates);
  },

  async deleteCampaign(id: string): Promise<void> {
    try {
      await httpClient.delete(`/campaigns/${id}`);
      return;
    } catch {
      // Fallback
    }
    return db.deleteCampaign(id);
  },
};

export const tagService = {
  async getTags(userId?: string): Promise<Tag[]> {
    try {
      const data = await httpClient.get<{ items: any[] }>('/tags');
      if (Array.isArray(data?.items)) {
        return data.items.map(mapBackendTag);
      }
    } catch {
      // Fallback
    }
    return db.getTags(userId);
  },

  async createTag(name: string, userId: string, color?: string): Promise<Tag> {
    try {
      const res = await httpClient.post<{ tag: any }>('/tags', {
        name,
        color: color || '#18181B',
      });
      if (res?.tag) {
        return mapBackendTag(res.tag);
      }
    } catch (err: any) {
      if (err.status === 400) throw err;
    }

    return db.createTag(name, color, userId);
  },

  async deleteTag(id: string): Promise<void> {
    try {
      await httpClient.delete(`/tags/${id}`);
      return;
    } catch {
      // Fallback
    }
    return db.deleteTag(id);
  },
};
