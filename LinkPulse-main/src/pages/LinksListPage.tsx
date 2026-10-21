import React, { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Plus,
  Search,
  Copy,
  Check,
  QrCode,
  Edit,
  Trash2,
  Power,
  CheckSquare,
  Square,
  FileSpreadsheet,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useAuthStore } from '../store/useAuthStore';
import { useToastStore } from '../store/useToastStore';
import { linksApi, campaignsApi, tagsApi } from '../lib/api';
import { Link as LinkType, Campaign } from '../types';
import { formatCompactNumber, cn, getBaseShortUrl } from '../lib/utils';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Badge } from '../components/ui/Badge';
import { Modal, ConfirmDialog } from '../components/ui/Modal';
import { EmptyState } from '../components/ui/EmptyState';
import { TableRowSkeleton } from '../components/ui/Skeleton';

function LinkStatusBadge({ link }: { link: LinkType }) {
  const isExpired = link.rules.expiresAt && new Date(link.rules.expiresAt) <= new Date();
  if (!link.isActive || link.abuseStatus === 'disabled') {
    return <Badge variant="danger" size="sm">Disabled</Badge>;
  }
  if (isExpired) {
    return <Badge variant="warning" size="sm">Expired</Badge>;
  }
  if (link.rules.clickLimit && link.clicksCount >= link.rules.clickLimit) {
    return <Badge variant="warning" size="sm">Limit reached</Badge>;
  }
  return <Badge variant="success" size="sm">Active</Badge>;
}

export function LinksListPage() {
  const { user } = useAuthStore();
  const { success, error: toastError } = useToastStore();
  const navigate = useNavigate();

  // Search & Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'expired' | 'disabled'>('all');
  const [campaignFilter, setCampaignFilter] = useState('');
  const [sortBy, setSortBy] = useState<'latest' | 'clicks' | 'title'>('latest');

  // Pagination & Selection
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Data
  const [links, setLinks] = useState<LinkType[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Modals state
  const [qrLink, setQrLink] = useState<LinkType | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [editLink, setEditLink] = useState<{ id: string; shortCode: string; title: string; originalUrl: string } | null>(null);

  useEffect(() => {
    async function loadData() {
      if (!user) return;
      setIsLoading(true);
      try {
        const userFilter = user.role === 'admin' ? undefined : user.id;
        const [allLinks, camps] = await Promise.all([
          linksApi.getLinks({ userId: userFilter }),
          campaignsApi.getCampaigns(userFilter),
        ]);
        setLinks(allLinks);
        setCampaigns(camps);
      } catch (e) {
        console.error('Failed to load links', e);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, [user]);

  // Filter & Sort
  const filteredLinks = useMemo(() => {
    let result = [...links];
    const now = new Date();

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (l) => l.title.toLowerCase().includes(q) || l.shortCode.toLowerCase().includes(q) || l.originalUrl.toLowerCase().includes(q)
      );
    }

    if (statusFilter === 'active') {
      result = result.filter((l) => l.isActive && l.abuseStatus === 'clean' && (!l.rules.expiresAt || new Date(l.rules.expiresAt) > now));
    } else if (statusFilter === 'expired') {
      result = result.filter((l) => l.rules.expiresAt && new Date(l.rules.expiresAt) <= now);
    } else if (statusFilter === 'disabled') {
      result = result.filter((l) => !l.isActive || l.abuseStatus === 'disabled');
    }

    if (campaignFilter) {
      result = result.filter((l) => l.campaignId === campaignFilter);
    }

    if (sortBy === 'latest') {
      result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } else if (sortBy === 'clicks') {
      result.sort((a, b) => b.clicksCount - a.clicksCount);
    } else if (sortBy === 'title') {
      result.sort((a, b) => a.title.localeCompare(b.title));
    }

    return result;
  }, [links, search, statusFilter, campaignFilter, sortBy]);

  const totalPages = Math.ceil(filteredLinks.length / pageSize) || 1;
  const paginatedLinks = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredLinks.slice(start, start + pageSize);
  }, [filteredLinks, page]);

  const handleCopy = (id: string, code: string) => {
    navigator.clipboard.writeText(`${getBaseShortUrl()}/r/${code}`);
    setCopiedId(id);
    success('Copied short URL to clipboard!');
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleToggleStatus = async (link: LinkType) => {
    try {
      const updated = await linksApi.updateLink(link.id, { isActive: !link.isActive });
      setLinks((prev) => prev.map((l) => (l.id === link.id ? updated : l)));
      success(updated.isActive ? 'Link enabled' : 'Link disabled');
    } catch {
      toastError('Failed to update status');
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteId) return;
    try {
      await linksApi.deleteLink(deleteId);
      setLinks((prev) => prev.filter((l) => l.id !== deleteId));
      setSelectedIds((prev) => prev.filter((id) => id !== deleteId));
      setDeleteId(null);
      success('Link deleted successfully');
    } catch {
      toastError('Failed to delete link');
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    try {
      await linksApi.bulkDeleteLinks(selectedIds);
      setLinks((prev) => prev.filter((l) => !selectedIds.includes(l.id)));
      setSelectedIds([]);
      setBulkDeleteOpen(false);
      success(`Deleted ${selectedIds.length} links`);
    } catch {
      toastError('Failed to delete selected links');
    }
  };

  const handleBulkToggleStatus = async (isActive: boolean) => {
    if (selectedIds.length === 0) return;
    try {
      await linksApi.bulkSetStatus(selectedIds, isActive);
      setLinks((prev) => prev.map((l) => (selectedIds.includes(l.id) ? { ...l, isActive } : l)));
      success(`${isActive ? 'Enabled' : 'Disabled'} ${selectedIds.length} links`);
    } catch {
      toastError('Failed to update selected links');
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  };

  const handleSelectAll = () => {
    if (selectedIds.length === paginatedLinks.length && paginatedLinks.length > 0) {
      setSelectedIds([]);
    } else {
      setSelectedIds(paginatedLinks.map((l) => l.id));
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editLink) return;
    try {
      const updated = await linksApi.updateLink(editLink.id, {
        title: editLink.title.trim(),
        originalUrl: editLink.originalUrl.trim(),
      });
      setLinks((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
      setEditLink(null);
      success('Link updated successfully');
    } catch {
      toastError('Failed to save changes');
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Short Links Directory</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Manage destinations, vanity aliases, rule conditions, and QR assets
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link to="/app/links/import">
            <Button variant="outline" size="sm" className="text-xs">
              <FileSpreadsheet className="w-3.5 h-3.5 mr-1" />
              <span>Import CSV</span>
            </Button>
          </Link>
          <Link to="/app/links/new">
            <Button variant="primary" size="sm" className="text-xs">
              <Plus className="w-3.5 h-3.5 mr-1" />
              <span>Create Link</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <Card className="p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="lg:col-span-2">
            <Input
              placeholder="Search by title, short code, or URL..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              leftIcon={<Search className="w-4 h-4" />}
            />
          </div>

          <Select
            options={[
              { value: 'all', label: 'All Statuses' },
              { value: 'active', label: 'Active only' },
              { value: 'expired', label: 'Expired' },
              { value: 'disabled', label: 'Disabled' },
            ]}
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as 'all' | 'active' | 'expired' | 'disabled');
              setPage(1);
            }}
          />

          <Select
            options={[{ value: '', label: 'All Campaigns' }, ...campaigns.map((c) => ({ value: c.id, label: c.name }))]}
            value={campaignFilter}
            onChange={(e) => {
              setCampaignFilter(e.target.value);
              setPage(1);
            }}
          />

          <Select
            options={[
              { value: 'latest', label: 'Sort: Most Recent' },
              { value: 'clicks', label: 'Sort: Most Clicks' },
              { value: 'title', label: 'Sort: Alphabetical' },
            ]}
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'latest' | 'clicks' | 'title')}
          />
        </div>

        {/* Bulk Action Bar */}
        {selectedIds.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-xl text-xs animate-in fade-in duration-150">
            <span className="font-semibold text-neutral-900 dark:text-neutral-100">
              {selectedIds.length} link{selectedIds.length > 1 ? 's' : ''} selected
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => handleBulkToggleStatus(true)} className="text-xs bg-white dark:bg-slate-900">
                Enable
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleBulkToggleStatus(false)} className="text-xs bg-white dark:bg-slate-900">
                Disable
              </Button>
              <Button variant="danger" size="sm" onClick={() => setBulkDeleteOpen(true)} className="text-xs">
                Delete Selected
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Links Presentation */}
      {isLoading ? (
        <Card className="divide-y divide-slate-100 dark:divide-slate-800">
          {Array.from({ length: 6 }).map((_, i) => (
            <TableRowSkeleton key={i} />
          ))}
        </Card>
      ) : filteredLinks.length === 0 ? (
        <EmptyState
          title="No Short Links Found"
          description={
            search || statusFilter !== 'all' || campaignFilter
              ? 'No links match your current search and filter criteria.'
              : 'You have not created any short links in this workspace yet.'
          }
          actionLabel="Create Short Link"
          onAction={() => navigate('/app/links/new')}
        />
      ) : (
        <Card className="overflow-hidden p-0 border border-slate-200 dark:border-slate-800">
          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider border-b border-slate-200 dark:border-slate-800 select-none">
                <tr>
                  <th className="py-3 px-4 w-10">
                    <button onClick={handleSelectAll} className="cursor-pointer text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" aria-label="Select all">
                      {selectedIds.length === paginatedLinks.length && paginatedLinks.length > 0 ? (
                        <CheckSquare className="w-4 h-4 text-neutral-900 dark:text-white" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                    </button>
                  </th>
                  <th className="py-3 px-4">Short Link</th>
                  <th className="py-3 px-4">Destination Target</th>
                  <th className="py-3 px-4 text-right">Clicks</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Created</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800 text-neutral-700 dark:text-neutral-300">
                {paginatedLinks.map((link) => {
                  const isSelected = selectedIds.includes(link.id);

                  return (
                    <tr
                      key={link.id}
                      className={cn(
                        'hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors',
                        isSelected && 'bg-neutral-100/70 dark:bg-neutral-800/60'
                      )}
                    >
                      <td className="py-3 px-4">
                        <button onClick={() => toggleSelect(link.id)} className="cursor-pointer text-neutral-400" aria-label={`Select ${link.shortCode}`}>
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-neutral-900 dark:text-white" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      </td>

                      <td className="py-3 px-4 font-mono font-medium">
                        <div className="flex items-center gap-1.5">
                          <Link
                            to={`/app/links/${link.id}`}
                            className="text-neutral-900 dark:text-neutral-100 underline decoration-neutral-300 hover:decoration-neutral-900 font-medium"
                          >
                            /{link.shortCode}
                          </Link>
                          {link.rules.password && <span className="text-[10px] text-slate-400" title="Password protected">🔒</span>}
                        </div>
                        <p className="text-[11px] font-sans text-slate-500 font-normal truncate max-w-xs mt-0.5">{link.title}</p>
                      </td>

                      <td className="py-3 px-4 max-w-xs truncate font-mono text-[11px] text-slate-500">{link.originalUrl}</td>

                      <td className="py-3 px-4 text-right font-mono font-bold tabular-nums text-slate-900 dark:text-white">
                        {formatCompactNumber(link.clicksCount)}
                      </td>

                      <td className="py-3 px-4">
                        <LinkStatusBadge link={link} />
                      </td>

                      <td className="py-3 px-4 text-slate-400 text-[11px] font-mono">
                        {new Date(link.createdAt).toLocaleDateString()}
                      </td>

                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleCopy(link.id, link.shortCode)}
                            className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 cursor-pointer"
                            title="Copy short link"
                          >
                            {copiedId === link.id ? <Check className="w-4 h-4 text-neutral-900 dark:text-white" /> : <Copy className="w-4 h-4" />}
                          </button>

                          <button
                            onClick={() => setQrLink(link)}
                            className="p-1.5 rounded hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-500 cursor-pointer"
                            title="Quick QR Preview"
                          >
                            <QrCode className="w-4 h-4" />
                          </button>

                          <button
                            onClick={() => setEditLink({ id: link.id, shortCode: link.shortCode, title: link.title, originalUrl: link.originalUrl })}
                            className="p-1.5 rounded hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-500 cursor-pointer"
                            title="Edit link title/URL"
                          >
                            <Edit className="w-4 h-4" />
                          </button>

                          <button
                            onClick={() => handleToggleStatus(link)}
                            className={cn(
                              'p-1.5 rounded hover:bg-neutral-200 dark:hover:bg-neutral-800 cursor-pointer',
                              link.isActive ? 'text-neutral-900 dark:text-white' : 'text-neutral-400'
                            )}
                            title={link.isActive ? 'Disable link' : 'Enable link'}
                          >
                            <Power className="w-4 h-4" />
                          </button>

                          <button
                            onClick={() => setDeleteId(link.id)}
                            className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-950/40 text-neutral-400 hover:text-red-600 cursor-pointer"
                            title="Delete link"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Stacked Cards View */}
          <div className="md:hidden divide-y divide-neutral-100 dark:divide-neutral-800">
            {paginatedLinks.map((link) => (
              <div key={link.id} className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      to={`/app/links/${link.id}`}
                      className="font-mono text-sm font-medium text-neutral-900 dark:text-neutral-100 underline decoration-neutral-300 hover:decoration-neutral-900"
                    >
                      /{link.shortCode}
                    </Link>
                    <h4 className="text-xs font-semibold text-slate-900 dark:text-white truncate mt-0.5">{link.title}</h4>
                  </div>
                  <div className="shrink-0">
                    <LinkStatusBadge link={link} />
                  </div>
                </div>

                <p className="font-mono text-[11px] text-slate-500 truncate">{link.originalUrl}</p>

                <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100 dark:border-slate-800 text-slate-500">
                  <span className="font-mono font-bold text-slate-900 dark:text-white">
                    {formatCompactNumber(link.clicksCount)} clicks
                  </span>

                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleCopy(link.id, link.shortCode)} className="h-8 px-2">
                      {copiedId === link.id ? 'Copied' : 'Copy'}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setQrLink(link)} className="h-8 px-2">
                      QR
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setDeleteId(link.id)} className="h-8 px-2 text-rose-600">
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination Footer */}
          <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500">
            <span>
              Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filteredLinks.length)} of {filteredLinks.length} links
            </span>

            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <span className="px-2 font-mono">
                {page} / {totalPages}
              </span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                Next
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* QR Code Modal */}
      {qrLink && (
        <Modal
          isOpen={!!qrLink}
          onClose={() => setQrLink(null)}
          title={`QR Code: /${qrLink.shortCode}`}
          description="Vector QR asset configured for print and mobile scanning"
        >
          <div className="flex flex-col items-center justify-center p-6 space-y-4">
            <div className="p-4 bg-white rounded-xl shadow-xs border border-slate-200">
              <QRCodeSVG value={`${getBaseShortUrl()}/r/${qrLink.shortCode}?src=qr`} size={180} />
            </div>
            <p className="text-xs text-slate-500 text-center font-mono">Scans automatically track with source=qr</p>
            <Button variant="outline" size="sm" onClick={() => navigate(`/app/qr?linkId=${qrLink.id}`)}>
              Open in QR Studio
            </Button>
          </div>
        </Modal>
      )}

      {/* Edit Link Modal */}
      {editLink && (
        <Modal
          isOpen={!!editLink}
          onClose={() => setEditLink(null)}
          title="Edit Link Configuration"
          description={`Updating settings for /${editLink.shortCode}`}
          footer={
            <>
              <Button variant="outline" size="sm" onClick={() => setEditLink(null)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={handleSaveEdit}>
                Save Changes
              </Button>
            </>
          }
        >
          <form onSubmit={handleSaveEdit} className="space-y-4">
            <Input
              label="Title / Display Label"
              value={editLink.title}
              onChange={(e) => setEditLink({ ...editLink, title: e.target.value })}
              required
            />
            <Input
              label="Destination Target URL"
              value={editLink.originalUrl}
              onChange={(e) => setEditLink({ ...editLink, originalUrl: e.target.value })}
              required
            />
          </form>
        </Modal>
      )}

      {/* Single Delete Confirm Dialog */}
      <ConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDeleteConfirm}
        title="Delete Short Link"
        message="Are you sure you want to permanently delete this short link? All associated redirect routes and telemetry will be removed."
        confirmLabel="Delete Link"
        isDestructive
      />

      {/* Bulk Delete Confirm Dialog */}
      <ConfirmDialog
        isOpen={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        onConfirm={handleBulkDelete}
        title="Delete Selected Links"
        message={`Are you sure you want to delete ${selectedIds.length} links? This action is permanent and cannot be undone.`}
        confirmLabel={`Delete ${selectedIds.length} Links`}
        isDestructive
      />
    </div>
  );
}
