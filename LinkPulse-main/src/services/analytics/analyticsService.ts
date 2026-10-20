import { DashboardAnalytics, AnalyticsSummary } from '../../types';
import { db } from '../../lib/api/mockDb';
import { httpClient } from '../../lib/api/httpClient';

export const analyticsService = {
  async getDashboardAnalytics(params: {
    range: string;
    campaignId?: string;
    userId?: string;
    isAdmin?: boolean;
  }): Promise<DashboardAnalytics> {
    try {
      const data = await httpClient.get<any>('/analytics/overview', {
        campaignId: params.campaignId,
        range: params.range,
      });

      if (data && typeof data.totalClicks === 'number') {
        const timeSeries = Array.isArray(data.timeSeries)
          ? data.timeSeries.map((t: any) => ({
              date: t.date,
              clicks: t.clicks || 0,
              uniqueVisitors: t.uniqueVisitors || t.clicks || 0,
              uniqueClicks: t.uniqueVisitors || t.clicks || 0,
            }))
          : [];

        const deviceBreakdown = Array.isArray(data.deviceBreakdown)
          ? data.deviceBreakdown.map((d: any) => ({
              name: d.name || 'Desktop',
              count: d.count || 0,
              percentage: d.percentage || 0,
              value: d.count || 0,
            }))
          : [];

        const topReferrers = Array.isArray(data.topReferrers)
          ? data.topReferrers.map((r: any) => ({
              name: r.name || 'Direct',
              count: r.count || 0,
              percentage: r.percentage || 0,
              value: r.count || 0,
            }))
          : [];

        const topLinks = Array.isArray(data.topLinks)
          ? data.topLinks.map((l: any) => ({
              linkId: String(l.id || l.linkId),
              shortCode: l.shortCode,
              title: l.title || l.shortCode,
              originalUrl: l.destinationUrl || l.originalUrl || '',
              clicks: l.clicksCount || l.clicks || 0,
            }))
          : [];

        return {
          totalLinks: data.totalLinks || 0,
          activeLinks: data.activeLinks || 0,
          expiredLinks: data.expiredLinks || 0,
          totalClicks: data.totalClicks || 0,
          uniqueVisitors: data.uniqueVisitors || 0,
          clicksOverTime: timeSeries,
          deviceBreakdown,
          topReferrers,
          topLinks,
          recentClicks: data.recentClicks || [],
        };
      }
    } catch {
      // Fallback
    }

    return db.getDashboardAnalytics(params as any);
  },

  async getRecentClicks(linkId: string, limit = 50): Promise<any[]> {
    try {
      const data = await httpClient.get<{ clicks: any[] }>(`/analytics/clicks/${linkId}`, { limit });
      if (Array.isArray(data?.clicks)) {
        return data.clicks;
      }
    } catch {
      // Fallback
    }
    return db.getClicksForLink(linkId, limit);
  },

  async getLinkClicks(linkId: string, range?: string): Promise<AnalyticsSummary> {
    try {
      const data = await httpClient.get<{ analytics: any }>(`/analytics/link/${linkId}`);
      if (data?.analytics) {
        const a = data.analytics;
        return {
          totalClicks: a.totalClicks || 0,
          uniqueClicks: a.uniqueVisitors || 0,
          qrScans: a.qrScans || 0,
          clicksOverTime: Array.isArray(a.timeSeries)
            ? a.timeSeries.map((t: any) => ({
                date: t.date,
                clicks: t.clicks || 0,
                uniqueClicks: t.uniqueVisitors || t.clicks || 0,
              }))
            : [],
          referrers: Array.isArray(a.referrers) ? a.referrers : [],
          devices: Array.isArray(a.devices) ? a.devices : [],
          countries: Array.isArray(a.countries) ? a.countries : [],
        };
      }
    } catch {
      // Fallback
    }

    return db.getAnalytics({ range: range as any, linkId });
  },

  async recordClick(linkId: string, details?: any): Promise<void> {
    try {
      await httpClient.post('/analytics/record', { linkId, details });
      return;
    } catch {
      // Fallback
    }
    await db.recordClick({ linkId, ...(details || {}) });
  },
};
