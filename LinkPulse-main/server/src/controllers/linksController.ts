import type { Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { Link, QrCode, ClickEvent, AuditLog, ILink } from '../models/index.ts';
import { AuthRequest } from '../middleware/auth.ts';
import { SecurityService } from '../services/securityService.ts';

function generateShortCode(length = 6): string {
  const chars = '23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  let result = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

export class LinksController {
  public static async getLinks(req: AuthRequest, res: Response) {
    const userId = req.user!._id;
    const {
      search,
      campaignId,
      status,
      tag,
      sort = 'createdAt',
      order = 'desc',
      page = '1',
      limit = '50',
    } = req.query;

    const query: any = {};
    if (req.user!.role !== 'admin') {
      query.userId = userId;
    }

    if (campaignId) {
      query.campaignId = new mongoose.Types.ObjectId(campaignId as string);
    }

    if (status && status !== 'all') {
      query.status = status;
    }

    if (tag) {
      query.tags = tag;
    }

    if (search) {
      const s = String(search).trim();
      query.$or = [
        { shortCode: { $regex: s, $options: 'i' } },
        { title: { $regex: s, $options: 'i' } },
        { destinationUrl: { $regex: s, $options: 'i' } },
      ];
    }

    const sortOptions: any = {};
    sortOptions[sort as string] = order === 'asc' ? 1 : -1;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    try {
      const [items, total] = await Promise.all([
        Link.find(query).sort(sortOptions).skip(skip).limit(limitNum).lean(),
        Link.countDocuments(query),
      ]);

      return res.json({
        items: items.map((l) => ({
          id: String(l._id),
          shortCode: l.shortCode,
          destinationUrl: l.destinationUrl,
          originalUrl: l.destinationUrl,
          title: l.title || l.shortCode,
          clicksCount: l.clicksCount || 0,
          isActive: l.isActive,
          status: l.status,
          expiresAt: l.expiresAt ? new Date(l.expiresAt).toISOString() : undefined,
          clickLimit: l.clickLimit,
          hasPassword: !!l.passwordHash,
          tags: l.tags || [],
          campaignId: l.campaignId ? String(l.campaignId) : undefined,
          folderId: l.folderId ? String(l.folderId) : undefined,
          deviceTargeting: l.deviceTargeting,
          aBTesting: l.aBTesting,
          createdAt: new Date(l.createdAt).toISOString(),
        })),
        total,
        page: pageNum,
        totalPages: Math.ceil(total / limitNum),
      });
    } catch (error) {
      console.error('Fetch links error:', error);
      return res.status(500).json({ error: 'Failed to retrieve links.' });
    }
  }

  public static async checkAlias(req: AuthRequest, res: Response) {
    const { alias } = req.query;
    if (!alias) {
      return res.status(400).json({ error: 'Alias is required.' });
    }

    const clean = String(alias).trim().toLowerCase();
    const reserved = ['login', 'register', 'admin', 'app', 'api', 'r', 'trust-center', 'settings'];

    if (reserved.includes(clean)) {
      return res.json({ available: false, reason: 'Reserved system keyword' });
    }

    const existing = await Link.findOne({ shortCode: clean });
    return res.json({
      available: !existing,
      alias: clean,
    });
  }

  public static async createLink(req: AuthRequest, res: Response) {
    const userId = req.user!._id;
    const {
      destinationUrl,
      title,
      customAlias,
      campaignId,
      folderId,
      expiresAt,
      clickLimit,
      password,
      deviceTargeting,
      countryTargeting,
      aBTesting,
      tags = [],
    } = req.body;

    if (!destinationUrl) {
      return res.status(400).json({ error: 'Destination URL is required.' });
    }

    // 1. Security & SSRF check
    const secEval = await SecurityService.evaluateUrl(destinationUrl);
    if (!secEval.valid) {
      return res.status(400).json({
        error: secEval.error || 'Destination URL failed security validation.',
        triggers: secEval.triggers,
      });
    }

    // 2. Resolve short code or custom alias
    let shortCode = '';
    if (customAlias && customAlias.trim()) {
      shortCode = customAlias.trim().toLowerCase();
      const existing = await Link.findOne({ shortCode });
      if (existing) {
        return res.status(409).json({ error: `Custom alias "/${shortCode}" is already taken.` });
      }
    } else {
      let attempts = 0;
      while (attempts < 10) {
        const candidate = generateShortCode(6);
        const exists = await Link.findOne({ shortCode: candidate });
        if (!exists) {
          shortCode = candidate;
          break;
        }
        attempts++;
      }
      if (!shortCode) {
        shortCode = generateShortCode(8);
      }
    }

    // 3. Optional password hashing
    let passwordHash: string | undefined;
    if (password && password.trim()) {
      passwordHash = await bcrypt.hash(password.trim(), 10);
    }

    try {
      const newLink = await Link.create({
        shortCode,
        destinationUrl: destinationUrl.trim(),
        title: title?.trim() || secEval.hostname || shortCode,
        userId,
        campaignId: campaignId ? new mongoose.Types.ObjectId(campaignId) : undefined,
        folderId: folderId ? new mongoose.Types.ObjectId(folderId) : undefined,
        passwordHash,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
        clickLimit: clickLimit ? parseInt(clickLimit, 10) : undefined,
        deviceTargeting: deviceTargeting || undefined,
        countryTargeting: countryTargeting || undefined,
        aBTesting: aBTesting || undefined,
        tags: Array.isArray(tags) ? tags : [],
        isActive: true,
        status: 'active',
      });

      // Automatically provision QR code configuration
      await QrCode.create({
        linkId: newLink._id,
        foregroundColor: '#171717',
        backgroundColor: '#FFFFFF',
        style: 'squares',
      });

      // Record audit log
      AuditLog.create({
        userId,
        userEmail: req.user!.email,
        action: 'link.created',
        resourceType: 'link',
        resourceId: String(newLink._id),
        details: { shortCode, destinationUrl },
      }).catch(() => {});

      return res.status(201).json({
        link: {
          id: String(newLink._id),
          shortCode: newLink.shortCode,
          destinationUrl: newLink.destinationUrl,
          originalUrl: newLink.destinationUrl,
          title: newLink.title,
          clicksCount: 0,
          isActive: true,
          status: newLink.status,
          hasPassword: !!passwordHash,
          tags: newLink.tags,
          createdAt: new Date(newLink.createdAt).toISOString(),
        },
        shortUrl: `/r/${newLink.shortCode}`,
      });
    } catch (error: any) {
      console.error('Create link error:', error);
      return res.status(500).json({ error: 'Failed to create short link.' });
    }
  }

  public static async getLink(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const userId = req.user!._id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid link identifier.' });
    }

    try {
      const link = await Link.findById(id).lean();
      if (!link) {
        return res.status(404).json({ error: 'Link not found.' });
      }

      if (req.user!.role !== 'admin' && String(link.userId) !== String(userId)) {
        return res.status(403).json({ error: 'Access denied.' });
      }

      const qr = await QrCode.findOne({ linkId: link._id }).lean();

      return res.json({
        link: {
          id: String(link._id),
          shortCode: link.shortCode,
          destinationUrl: link.destinationUrl,
          originalUrl: link.destinationUrl,
          title: link.title,
          clicksCount: link.clicksCount,
          isActive: link.isActive,
          status: link.status,
          expiresAt: link.expiresAt ? new Date(link.expiresAt).toISOString() : undefined,
          clickLimit: link.clickLimit,
          hasPassword: !!link.passwordHash,
          campaignId: link.campaignId ? String(link.campaignId) : undefined,
          folderId: link.folderId ? String(link.folderId) : undefined,
          tags: link.tags || [],
          deviceTargeting: link.deviceTargeting,
          countryTargeting: link.countryTargeting,
          aBTesting: link.aBTesting,
          createdAt: new Date(link.createdAt).toISOString(),
        },
        qrCode: qr
          ? {
              foregroundColor: qr.foregroundColor,
              backgroundColor: qr.backgroundColor,
              style: qr.style,
              scansCount: qr.scansCount,
            }
          : undefined,
      });
    } catch (error) {
      console.error('Get link error:', error);
      return res.status(500).json({ error: 'Failed to retrieve link.' });
    }
  }

  public static async updateLink(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const userId = req.user!._id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid link identifier.' });
    }

    const {
      destinationUrl,
      title,
      campaignId,
      folderId,
      expiresAt,
      clickLimit,
      password,
      isActive,
      tags,
      deviceTargeting,
      aBTesting,
    } = req.body;

    try {
      const link = await Link.findById(id);
      if (!link) {
        return res.status(404).json({ error: 'Link not found.' });
      }

      if (req.user!.role !== 'admin' && String(link.userId) !== String(userId)) {
        return res.status(403).json({ error: 'Access denied.' });
      }

      if (destinationUrl) {
        const secEval = await SecurityService.evaluateUrl(destinationUrl);
        if (!secEval.valid) {
          return res.status(400).json({ error: secEval.error || 'Destination failed security check.' });
        }
        link.destinationUrl = destinationUrl.trim();
      }

      if (title !== undefined) link.title = title.trim();
      if (campaignId !== undefined) {
        link.campaignId = campaignId ? new mongoose.Types.ObjectId(campaignId) : undefined;
      }
      if (folderId !== undefined) {
        link.folderId = folderId ? new mongoose.Types.ObjectId(folderId) : undefined;
      }
      if (expiresAt !== undefined) {
        link.expiresAt = expiresAt ? new Date(expiresAt) : undefined;
      }
      if (clickLimit !== undefined) {
        link.clickLimit = clickLimit ? parseInt(clickLimit, 10) : undefined;
      }
      if (password !== undefined) {
        link.passwordHash = password ? await bcrypt.hash(password.trim(), 10) : undefined;
      }
      if (isActive !== undefined) {
        link.isActive = Boolean(isActive);
        link.status = link.isActive ? 'active' : 'disabled';
      }
      if (Array.isArray(tags)) link.tags = tags;
      if (deviceTargeting !== undefined) link.deviceTargeting = deviceTargeting;
      if (aBTesting !== undefined) link.aBTesting = aBTesting;

      await link.save();

      AuditLog.create({
        userId,
        userEmail: req.user!.email,
        action: 'link.updated',
        resourceType: 'link',
        resourceId: String(link._id),
      }).catch(() => {});

      return res.json({
        link: {
          id: String(link._id),
          shortCode: link.shortCode,
          destinationUrl: link.destinationUrl,
          title: link.title,
          clicksCount: link.clicksCount,
          isActive: link.isActive,
          status: link.status,
          tags: link.tags,
          hasPassword: !!link.passwordHash,
          updatedAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error('Update link error:', error);
      return res.status(500).json({ error: 'Failed to update link.' });
    }
  }

  public static async deleteLink(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const userId = req.user!._id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid link identifier.' });
    }

    try {
      const link = await Link.findById(id);
      if (!link) {
        return res.status(404).json({ error: 'Link not found.' });
      }

      if (req.user!.role !== 'admin' && String(link.userId) !== String(userId)) {
        return res.status(403).json({ error: 'Access denied.' });
      }

      await Promise.all([
        Link.deleteOne({ _id: link._id }),
        QrCode.deleteOne({ linkId: link._id }),
        ClickEvent.deleteMany({ linkId: link._id }),
      ]);

      AuditLog.create({
        userId,
        userEmail: req.user!.email,
        action: 'link.deleted',
        resourceType: 'link',
        resourceId: String(link._id),
        details: { shortCode: link.shortCode },
      }).catch(() => {});

      return res.json({ message: 'Link and associated telemetry purged successfully.' });
    } catch (error) {
      console.error('Delete link error:', error);
      return res.status(500).json({ error: 'Failed to delete link.' });
    }
  }

  public static async getLinkByCode(req: AuthRequest, res: Response) {
    const { code } = req.params;
    if (!code) {
      return res.status(400).json({ error: 'Short code is required.' });
    }

    try {
      const link = await Link.findOne({ shortCode: code.toLowerCase().trim() }).lean();
      if (!link) {
        return res.status(404).json({ error: 'Link not found.' });
      }

      return res.json({
        link: {
          id: String(link._id),
          shortCode: link.shortCode,
          destinationUrl: link.destinationUrl,
          originalUrl: link.destinationUrl,
          title: link.title || link.shortCode,
          clicksCount: link.clicksCount || 0,
          isActive: link.isActive,
          status: link.status,
          expiresAt: link.expiresAt ? new Date(link.expiresAt).toISOString() : undefined,
          clickLimit: link.clickLimit,
          hasPassword: !!link.passwordHash,
          tags: link.tags || [],
          campaignId: link.campaignId ? String(link.campaignId) : undefined,
          folderId: link.folderId ? String(link.folderId) : undefined,
          deviceTargeting: link.deviceTargeting,
          aBTesting: link.aBTesting,
          createdAt: new Date(link.createdAt).toISOString(),
        },
      });
    } catch (error) {
      console.error('Get link by code error:', error);
      return res.status(500).json({ error: 'Failed to retrieve link by code.' });
    }
  }

  public static async bulkDeleteLinks(req: AuthRequest, res: Response) {
    const { ids } = req.body;
    const userId = req.user!._id;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Array of link IDs is required.' });
    }

    try {
      const query: any = { _id: { $in: ids } };
      if (req.user!.role !== 'admin') {
        query.userId = userId;
      }

      const matchingLinks = await Link.find(query).select('_id');
      const matchingIds = matchingLinks.map((l) => l._id);

      await Promise.all([
        Link.deleteMany({ _id: { $in: matchingIds } }),
        QrCode.deleteMany({ linkId: { $in: matchingIds } }),
        ClickEvent.deleteMany({ linkId: { $in: matchingIds } }),
      ]);

      AuditLog.create({
        userId,
        userEmail: req.user!.email,
        action: 'link.bulk_deleted',
        resourceType: 'link',
        details: { count: matchingIds.length, ids: matchingIds.map(String) },
      }).catch(() => {});

      return res.json({
        message: `${matchingIds.length} links deleted successfully.`,
        deletedCount: matchingIds.length,
      });
    } catch (error) {
      console.error('Bulk delete links error:', error);
      return res.status(500).json({ error: 'Failed to delete links.' });
    }
  }

  public static async bulkSetStatus(req: AuthRequest, res: Response) {
    const { ids, isActive } = req.body;
    const userId = req.user!._id;

    if (!Array.isArray(ids) || ids.length === 0 || isActive === undefined) {
      return res.status(400).json({ error: 'ids array and isActive boolean are required.' });
    }

    try {
      const query: any = { _id: { $in: ids } };
      if (req.user!.role !== 'admin') {
        query.userId = userId;
      }

      const activeBool = Boolean(isActive);
      const result = await Link.updateMany(query, {
        $set: {
          isActive: activeBool,
          status: activeBool ? 'active' : 'disabled',
        },
      });

      return res.json({
        message: `Updated ${result.modifiedCount} links to ${activeBool ? 'active' : 'disabled'}.`,
        modifiedCount: result.modifiedCount,
      });
    } catch (error) {
      console.error('Bulk set status error:', error);
      return res.status(500).json({ error: 'Failed to update link status in bulk.' });
    }
  }
}
