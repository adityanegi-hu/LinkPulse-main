import type { Response } from 'express';
import { User, Link, DomainBlocklist, ClickEvent, AuditLog } from '../models/index.ts';
import type { AuthRequest } from '../middleware/auth.ts';

export class AdminController {
  public static async getOverview(req: AuthRequest, res: Response) {
    try {
      const [totalUsers, totalLinks, activeLinks, totalClicks, blockedDomains] = await Promise.all([
        User.countDocuments(),
        Link.countDocuments(),
        Link.countDocuments({ isActive: true }),
        ClickEvent.countDocuments(),
        DomainBlocklist.countDocuments(),
      ]);

      return res.json({
        stats: {
          totalUsers,
          totalLinks,
          activeLinks,
          totalClicks,
          blockedDomains,
        },
        totalUsers,
        totalLinks,
        activeLinks,
        totalClicks,
        blockedDomains,
      });
    } catch (error) {
      console.error('Admin overview error:', error);
      return res.status(500).json({ error: 'Failed to retrieve admin telemetry.' });
    }
  }

  public static async getUsers(req: AuthRequest, res: Response) {
    try {
      const users = await User.find().select('-passwordHash').sort({ createdAt: -1 }).lean();

      const userStats = await Promise.all(
        users.map(async (u) => {
          const linkCount = await Link.countDocuments({ userId: u._id });
          return {
            id: String(u._id),
            name: u.name,
            email: u.email,
            role: u.role,
            linkCount,
            createdAt: new Date(u.createdAt).toISOString(),
          };
        })
      );

      return res.json({ users: userStats });
    } catch (error) {
      console.error('Admin get users error:', error);
      return res.status(500).json({ error: 'Failed to retrieve user accounts.' });
    }
  }

  public static async getBlocklist(req: AuthRequest, res: Response) {
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

      AuditLog.create({
        userId: req.user!._id,
        userEmail: req.user!.email,
        action: 'blocklist.added',
        resourceType: 'domain',
        resourceId: clean,
        details: { reason },
      }).catch(() => {});

      return res.status(201).json({
        domain: {
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

  public static async removeBlocklistDomain(req: AuthRequest, res: Response) {
    const { id } = req.params;

    try {
      const item = await DomainBlocklist.findById(id);
      if (!item) {
        return res.status(404).json({ error: 'Blocklist record not found.' });
      }

      await DomainBlocklist.deleteOne({ _id: item._id });

      AuditLog.create({
        userId: req.user!._id,
        userEmail: req.user!.email,
        action: 'blocklist.removed',
        resourceType: 'domain',
        resourceId: item.domain,
      }).catch(() => {});

      return res.json({ message: `Domain "${item.domain}" removed from blocklist.` });
    } catch (error) {
      console.error('Remove blocklist error:', error);
      return res.status(500).json({ error: 'Failed to remove blocklist domain.' });
    }
  }

  public static async getAllLinks(req: AuthRequest, res: Response) {
    try {
      const links = await Link.find().sort({ createdAt: -1 }).lean();
      return res.json({
        items: links.map((l) => ({
          id: String(l._id),
          shortCode: l.shortCode,
          destinationUrl: l.destinationUrl,
          originalUrl: l.destinationUrl,
          title: l.title || l.shortCode,
          userId: String(l.userId),
          clicksCount: l.clicksCount || 0,
          isActive: l.isActive,
          status: l.status,
          abuseStatus: l.isActive ? 'clean' : 'disabled',
          expiresAt: l.expiresAt ? new Date(l.expiresAt).toISOString() : undefined,
          clickLimit: l.clickLimit,
          hasPassword: !!l.passwordHash,
          tags: l.tags || [],
          createdAt: new Date(l.createdAt).toISOString(),
        })),
      });
    } catch (error) {
      console.error('Admin get all links error:', error);
      return res.status(500).json({ error: 'Failed to fetch platform links.' });
    }
  }

  public static async toggleLink(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const { isActive } = req.body;

    try {
      const link = await Link.findById(id);
      if (!link) {
        return res.status(404).json({ error: 'Link not found' });
      }

      const nextActive = isActive !== undefined ? Boolean(isActive) : !link.isActive;
      link.isActive = nextActive;
      link.status = nextActive ? 'active' : 'disabled';
      await link.save();

      AuditLog.create({
        userId: req.user!._id,
        userEmail: req.user!.email,
        action: nextActive ? 'link.activated' : 'link.disabled',
        resourceType: 'link',
        resourceId: String(link._id),
        details: { shortCode: link.shortCode, by: 'admin' },
      }).catch(() => {});

      return res.json({
        message: `Link ${nextActive ? 'activated' : 'disabled'} successfully.`,
        link: {
          id: String(link._id),
          isActive: link.isActive,
          status: link.status,
          abuseStatus: link.isActive ? 'clean' : 'disabled',
        },
      });
    } catch (error) {
      console.error('Admin toggle link error:', error);
      return res.status(500).json({ error: 'Failed to toggle link status.' });
    }
  }

  public static async updateUserRole(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const { role } = req.body;

    if (!role || !['admin', 'user'].includes(role)) {
      return res.status(400).json({ error: 'Role must be "admin" or "user".' });
    }

    try {
      const targetUser = await User.findById(id);
      if (!targetUser) {
        return res.status(404).json({ error: 'User not found.' });
      }

      targetUser.role = role;
      await targetUser.save();

      AuditLog.create({
        userId: req.user!._id,
        userEmail: req.user!.email,
        action: 'user.role_changed',
        resourceType: 'user',
        resourceId: String(targetUser._id),
        details: { newRole: role, targetEmail: targetUser.email },
      }).catch(() => {});

      return res.json({
        message: `User role updated to ${role}.`,
        user: {
          id: String(targetUser._id),
          email: targetUser.email,
          role: targetUser.role,
        },
      });
    } catch (error) {
      console.error('Admin update user role error:', error);
      return res.status(500).json({ error: 'Failed to update user role.' });
    }
  }
}
