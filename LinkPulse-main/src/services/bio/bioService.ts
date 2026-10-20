import { BioPage } from '../../types';
import { db } from '../../lib/api/mockDb';
import { httpClient } from '../../lib/api/httpClient';

function mapBackendBio(p: any): BioPage {
  return {
    id: String(p.id || p._id),
    userId: String(p.userId || ''),
    slug: p.slug || '',
    title: p.title || '',
    bio: p.bio,
    avatarUrl: p.avatarUrl || p.avatar,
    theme: (p.theme as any) || 'slate',
    socials: Array.isArray(p.socialLinks)
      ? p.socialLinks.map((s: any) => ({ platform: s.platform, url: s.url }))
      : Array.isArray(p.socials)
      ? p.socials
      : [],
    links: Array.isArray(p.links)
      ? p.links.map((l: any) => ({
          id: String(l.id || l._id),
          title: l.title || '',
          url: l.url || '',
          active: l.isActive !== undefined ? Boolean(l.isActive) : l.active !== false,
          clicks: l.clicksCount || l.clicks || 0,
        }))
      : [],
    updatedAt: p.updatedAt || new Date().toISOString(),
  };
}

export const bioService = {
  async getBioPage(userId: string): Promise<BioPage> {
    try {
      const data = await httpClient.get<{ page: any }>('/bio/me');
      if (data?.page) {
        return mapBackendBio(data.page);
      }
    } catch {
      // Fallback
    }
    return db.getBioByUserId(userId);
  },

  async getPublicBioPage(slug: string): Promise<BioPage> {
    try {
      const data = await httpClient.get<{ page: any }>(`/bio/p/${encodeURIComponent(slug)}`, undefined, { skipAuth: true });
      if (data?.page) {
        return mapBackendBio(data.page);
      }
    } catch (err: any) {
      if (err.status === 404) {
        // Try fallback
      }
    }

    const page = await db.getBioBySlug(slug);
    if (!page) throw new Error('Bio profile not found');
    return page;
  },

  async saveBioPage(userId: string, data: Partial<BioPage>): Promise<BioPage> {
    try {
      const payload: any = {
        title: data.title,
        bio: data.bio,
        slug: data.slug,
        avatar: data.avatarUrl,
        theme: data.theme,
      };

      if (data.socials) {
        payload.socialLinks = data.socials.map((s) => ({ platform: s.platform, url: s.url }));
      }

      if (data.links) {
        payload.links = data.links.map((l) => ({
          id: l.id,
          title: l.title,
          url: l.url,
          isActive: l.active,
          clicksCount: l.clicks,
        }));
      }

      const res = await httpClient.put<{ page: any }>('/bio/me', payload);
      if (res?.page) {
        return mapBackendBio(res.page);
      }
    } catch (err: any) {
      if (err.status === 400) throw err;
    }

    return db.saveBioPage(userId, data);
  },

  async trackBioClick(slug: string, linkId: string): Promise<void> {
    try {
      await httpClient.post(`/bio/p/${encodeURIComponent(slug)}/click`, { linkId }, { skipAuth: true });
      return;
    } catch {
      // Fallback
    }
    return db.trackBioClick(slug, linkId);
  },
};
