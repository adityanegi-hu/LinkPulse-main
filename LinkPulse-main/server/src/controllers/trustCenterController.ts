import { Request, Response } from 'express';
import { DomainBlocklist, AbuseReport, AuditLog, Link } from '../models/index.ts';
import { AuthRequest } from '../middleware/auth.ts';
import { SecurityService } from '../services/securityService.ts';

export class TrustCenterController {
  /**
   * Overall security posture and statistics
   */
  public static async getOverview(req: AuthRequest, res: Response) {
    try {
      const [blockedCount, pendingAbuseCount, resolvedAbuseCount, recentAudits] = await Promise.all([
        DomainBlocklist.countDocuments(),
        AbuseReport.countDocuments({ status: 'pending' }),
        AbuseReport.countDocuments({ status: 'resolved' }),
        AuditLog.find().sort({ createdAt: -1 }).limit(10).lean(),
      ]);

      return res.json({
        securityScore: 98,
        activeThreatProtection: true,
        stats: {
          blockedDomains: blockedCount,
          pendingReports: pendingAbuseCount,
          resolvedIncidents: resolvedAbuseCount,
        },
        recentAuditLogs: recentAudits.map((a) => ({
          id: String(a._id),
          action: a.action,
          resourceType: a.resourceType,
          resourceId: a.resourceId,
          userEmail: a.userEmail || 'System',
          details: a.details,
          createdAt: new Date(a.createdAt).toISOString(),
        })),
      });
    } catch (error) {
      console.error('Trust Center overview error:', error);
      return res.status(500).json({ error: 'Failed to fetch Trust Center data.' });
    }
  }

  /**
   * On-demand domain reputation & risk analysis
   */
  public static async checkDomain(req: AuthRequest, res: Response) {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'Target URL is required for reputation scan.' });
    }

    try {
      const analysis = await SecurityService.evaluateUrl(String(url));
      return res.json(analysis);
    } catch (error) {
      console.error('Domain check error:', error);
      return res.status(500).json({ error: 'Failed to inspect domain reputation.' });
    }
  }

  /**
   * Submit an abuse report on a short link
   */
  public static async submitAbuseReport(req: Request, res: Response) {
    const { shortCode, reason, reporterEmail } = req.body;

    if (!shortCode || !reason) {
      return res.status(400).json({ error: 'Short code and reason are required.' });
    }

    try {
      const link = await Link.findOne({ shortCode: shortCode.toLowerCase().trim() });
      const targetUrl = link ? link.destinationUrl : 'Unknown';

      const report = await AbuseReport.create({
        shortCode: shortCode.trim().toLowerCase(),
        targetUrl,
        reason: reason.trim(),
        reporterEmail: reporterEmail?.trim() || undefined,
        status: 'pending',
      });

      return res.status(201).json({
        message: 'Abuse report received. Our Trust & Safety team will review it shortly.',
        reportId: String(report._id),
        report: {
          id: String(report._id),
          shortCode: report.shortCode,
          targetUrl: report.targetUrl,
          reason: report.reason,
          status: report.status,
          createdAt: report.createdAt,
        },
      });
    } catch (error) {
      console.error('Submit abuse report error:', error);
      return res.status(500).json({ error: 'Failed to submit report.' });
    }
  }

  /**
   * List all abuse reports (Admin)
   */
  public static async getAbuseReports(req: AuthRequest, res: Response) {
    try {
      const reports = await AbuseReport.find().sort({ createdAt: -1 }).limit(50).lean();
      return res.json({
        items: reports.map((r) => ({
          id: String(r._id),
          shortCode: r.shortCode,
          targetUrl: r.targetUrl,
          reason: r.reason,
          reporterEmail: r.reporterEmail,
          status: r.status,
          createdAt: new Date(r.createdAt).toISOString(),
        })),
      });
    } catch (error) {
      console.error('Get abuse reports error:', error);
      return res.status(500).json({ error: 'Failed to fetch abuse reports.' });
    }
  }

  /**
   * Update abuse report status & optional link takedown
   */
  public static async resolveAbuseReport(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const { status, takeDownLink } = req.body;

    try {
      const report = await AbuseReport.findById(id);
      if (!report) {
        return res.status(404).json({ error: 'Report not found.' });
      }

      report.status = status || 'resolved';
      report.reviewedBy = req.user!._id;
      await report.save();

      if (takeDownLink) {
        await Link.updateOne(
          { shortCode: report.shortCode },
          { isActive: false, status: 'disabled' }
        );

        AuditLog.create({
          userId: req.user!._id,
          userEmail: req.user!.email,
          action: 'link.takedown',
          resourceType: 'link',
          resourceId: report.shortCode,
          details: { reason: report.reason, reportId: String(report._id) },
        }).catch(() => {});
      }

      return res.json({ message: 'Abuse report updated.', report });
    } catch (error) {
      console.error('Resolve abuse report error:', error);
      return res.status(500).json({ error: 'Failed to resolve report.' });
    }
  }

  /**
   * List audit logs
   */
  public static async getAuditLogs(req: AuthRequest, res: Response) {
    try {
      const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(100).lean();
      return res.json({
        items: logs.map((l) => ({
          id: String(l._id),
          action: l.action,
          resourceType: l.resourceType,
          resourceId: l.resourceId,
          userEmail: l.userEmail || 'System',
          details: l.details,
          createdAt: new Date(l.createdAt).toISOString(),
        })),
      });
    } catch (error) {
      console.error('Get audit logs error:', error);
      return res.status(500).json({ error: 'Failed to retrieve audit logs.' });
    }
  }

  /**
   * Get safety blocklist entries
   */
  public static async getBlocklist(_req: AuthRequest, res: Response) {
    try {
      const list = await DomainBlocklist.find().sort({ createdAt: -1 }).lean();
      return res.json({
        items: list.map((b) => ({
          id: String(b._id),
          domain: b.domain,
          reason: b.reason,
          createdAt: new Date(b.createdAt).toISOString(),
        })),
      });
    } catch (error) {
      console.error('Get blocklist error:', error);
      return res.status(500).json({ error: 'Failed to retrieve blocklist.' });
    }
  }

  /**
   * Add domain to blocklist
   */
  public static async addBlocklistDomain(req: AuthRequest, res: Response) {
    const { domain, reason } = req.body;
    if (!domain || !reason) {
      return res.status(400).json({ error: 'Domain and reason are required.' });
    }

    const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

    try {
      const existing = await DomainBlocklist.findOne({ domain: clean });
      if (existing) {
        return res.status(409).json({ error: `Domain "${clean}" is already blocklisted.` });
      }

      const blocked = await DomainBlocklist.create({
        domain: clean,
        reason: reason.trim(),
        blockedBy: req.user!._id,
      });

      return res.status(201).json({
        entry: {
          id: String(blocked._id),
          domain: blocked.domain,
          reason: blocked.reason,
          createdAt: new Date(blocked.createdAt).toISOString(),
        },
      });
    } catch (error) {
      console.error('Add blocklist error:', error);
      return res.status(500).json({ error: 'Failed to add blocklist domain.' });
    }
  }

  /**
   * Remove domain from blocklist
   */
  public static async removeBlocklistDomain(req: AuthRequest, res: Response) {
    const { id } = req.params;

    try {
      const item = await DomainBlocklist.findById(id);
      if (!item) {
        return res.status(404).json({ error: 'Blocklist record not found.' });
      }

      await DomainBlocklist.deleteOne({ _id: item._id });
      return res.json({ message: `Domain "${item.domain}" removed from blocklist.` });
    } catch (error) {
      console.error('Remove blocklist error:', error);
      return res.status(500).json({ error: 'Failed to remove blocklist domain.' });
    }
  }
}
