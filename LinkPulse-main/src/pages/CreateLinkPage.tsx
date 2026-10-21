import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  ArrowLeft,
  Check,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  Copy,
  Plus,
  CheckCircle2,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useAuthStore } from '../store/useAuthStore';
import { useToastStore } from '../store/useToastStore';
import { linksApi, campaignsApi, tagsApi, adminApi } from '../lib/api';
import { generateShortCode, checkRateLimit, getBaseShortUrl } from '../lib/utils';
import { validateUrl, checkPasswordRules } from '../lib/validators';
import { Campaign, Tag } from '../types';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Card } from '../components/ui/Card';

const createInitialForm = (initialUrl = '') => ({
  originalUrl: initialUrl,
  title: '',
  shortCode: generateShortCode(6),
  campaignId: '',
  selectedTags: [] as string[],
  enableExpiry: false,
  expiresAt: '',
  enableLimit: false,
  clickLimit: '' as number | '',
  enablePassword: false,
  password: '',
  enableMobileUrl: false,
  mobileUrl: '',
});

interface RuleRowProps {
  label: string;
  enabled: boolean;
  onToggle: (checked: boolean) => void;
  children: React.ReactNode;
  borderTop?: boolean;
}

function RuleRow({ label, enabled, onToggle, children, borderTop = true }: RuleRowProps) {
  return (
    <div className={`space-y-2 ${borderTop ? 'pt-3 border-t border-neutral-100 dark:border-neutral-800' : ''}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">{label}</span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
          className="w-4 h-4 accent-neutral-900 rounded cursor-pointer"
        />
      </div>
      {enabled && children}
    </div>
  );
}

export function CreateLinkPage() {
  const { user } = useAuthStore();
  const { success, error: toastError } = useToastStore();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [form, setForm] = useState(() => createInitialForm(searchParams.get('url') || ''));
  const [newTagInput, setNewTagInput] = useState('');
  const [aliasAvailability, setAliasAvailability] = useState<{
    checking: boolean;
    available?: boolean;
    error?: string;
  }>({ checking: false, available: true });

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [blocklist, setBlocklist] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdLink, setCreatedLink] = useState<{ id: string; shortCode: string; fullUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const updateForm = (patch: Partial<ReturnType<typeof createInitialForm>>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  };

  useEffect(() => {
    if (user) {
      campaignsApi.getCampaigns(user.role === 'admin' ? undefined : user.id).then(setCampaigns);
      tagsApi.getTags(user.role === 'admin' ? undefined : user.id).then(setTags);
      adminApi.getBlocklist().then((list) => setBlocklist(list.map((b) => b.domain)));
    }
  }, [user]);

  // Pure derived URL validation
  const urlCheck = useMemo(() => {
    const url = form.originalUrl.trim();
    if (!url) return { valid: false };
    const candidate = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return validateUrl(candidate, blocklist);
  }, [form.originalUrl, blocklist]);

  // Debounced alias availability check
  useEffect(() => {
    const alias = form.shortCode.trim();
    if (!alias) {
      setAliasAvailability({ checking: false, available: false, error: 'Alias is required' });
      return;
    }
    setAliasAvailability({ checking: true });
    const timer = setTimeout(async () => {
      const res = await linksApi.checkAliasAvailable(alias);
      setAliasAvailability({ checking: false, available: res.available, error: res.error });
    }, 200);
    return () => clearTimeout(timer);
  }, [form.shortCode]);

  const passwordAnalysis = checkPasswordRules(form.password);

  // Validation errors & advisories
  const { errors, warnings } = useMemo(() => {
    const errs: string[] = [];
    const warns: string[] = [];

    if (!urlCheck.valid) {
      errs.push(urlCheck.error || 'Destination URL is invalid.');
    }
    if (!aliasAvailability.available) {
      errs.push(aliasAvailability.error || 'Alias is unavailable.');
    }
    if (form.enableExpiry && form.expiresAt && new Date(form.expiresAt).getTime() <= Date.now()) {
      errs.push('Expiration date cannot be in the past.');
    }
    if (form.enableLimit && (!form.clickLimit || Number(form.clickLimit) < 1)) {
      errs.push('Click limit must be at least 1.');
    }
    if (form.enablePassword) {
      if (!form.password) {
        errs.push('Password protection is enabled but no password was provided.');
      } else if (passwordAnalysis.strength === 'Weak') {
        warns.push('Password strength is Weak. We recommend meeting all 6 criteria.');
      }
    }
    if (form.enableMobileUrl && form.mobileUrl.trim()) {
      const mob = /^https?:\/\//i.test(form.mobileUrl.trim())
        ? form.mobileUrl.trim()
        : `https://${form.mobileUrl.trim()}`;
      const mobCheck = validateUrl(mob, blocklist);
      if (!mobCheck.valid) {
        errs.push(`Mobile URL error: ${mobCheck.error}`);
      }
    }

    return { errors: errs, warnings: warns };
  }, [urlCheck, aliasAvailability, form, passwordAnalysis.strength, blocklist]);

  const handleUrlChange = (val: string) => {
    let candidate = val.trim();
    if (candidate && !/^https?:\/\//i.test(candidate)) candidate = 'https://' + candidate;
    const res = validateUrl(candidate, blocklist);
    updateForm({
      originalUrl: val,
      title: !form.title && res.valid && res.hostname ? res.hostname : form.title,
    });
  };

  const toggleTag = (tagName: string) => {
    updateForm({
      selectedTags: form.selectedTags.includes(tagName)
        ? form.selectedTags.filter((t) => t !== tagName)
        : [...form.selectedTags, tagName],
    });
  };

  const handleAddTag = () => {
    const t = newTagInput.trim();
    if (t && !form.selectedTags.includes(t)) {
      updateForm({ selectedTags: [...form.selectedTags, t] });
    }
    setNewTagInput('');
  };

  const handlePublish = async () => {
    if (errors.length > 0 || !user) return;

    const rl = checkRateLimit(user.id, 10, 60000);
    if (!rl.allowed) {
      toastError('Rate limit exceeded', `Max 10 links per minute. Please wait ${rl.resetInSeconds} seconds.`);
      return;
    }

    setIsSubmitting(true);
    try {
      const finalDest = /^https?:\/\//i.test(form.originalUrl.trim())
        ? form.originalUrl.trim()
        : `https://${form.originalUrl.trim()}`;

      const created = await linksApi.createLink({
        userId: user.id,
        originalUrl: finalDest,
        shortCode: form.shortCode.trim(),
        title: form.title.trim() || urlCheck.hostname || 'Short Link',
        campaignId: form.campaignId || undefined,
        tags: form.selectedTags,
        rules: {
          expiresAt: form.enableExpiry && form.expiresAt ? new Date(form.expiresAt).toISOString() : undefined,
          clickLimit: form.enableLimit && typeof form.clickLimit === 'number' ? form.clickLimit : undefined,
          password: form.enablePassword && form.password ? form.password : undefined,
          mobileUrl: form.enableMobileUrl && form.mobileUrl.trim() ? form.mobileUrl.trim() : undefined,
        },
      });

      const fullUrl = `${getBaseShortUrl()}/r/${created.shortCode}`;
      setCreatedLink({ id: created.id, shortCode: created.shortCode, fullUrl });
      setStep(3);
      success('Link published successfully!');
    } catch (err: unknown) {
      toastError('Error', err instanceof Error ? err.message : 'Failed to publish');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopy = () => {
    if (!createdLink) return;
    navigator.clipboard.writeText(createdLink.fullUrl);
    setCopied(true);
    success('Copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReset = () => {
    setForm(createInitialForm());
    setCreatedLink(null);
    setStep(1);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Create Short Link</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Step {step} of 2: {step === 1 ? 'Destination & Alias' : step === 2 ? 'Options & Review' : 'Success'}
          </p>
        </div>

        {step < 3 && (
          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={() => setStep(1)}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
                step === 1 ? 'pearl-btn-dark' : 'text-neutral-500 hover:text-neutral-800'
              }`}
            >
              1. Destination
            </button>
            <span className="text-neutral-300 dark:text-neutral-700">/</span>
            <button
              onClick={() => {
                if (urlCheck.valid && aliasAvailability.available) setStep(2);
              }}
              disabled={!urlCheck.valid || !aliasAvailability.available}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-40 cursor-pointer ${
                step === 2 ? 'pearl-btn-dark' : 'text-neutral-500 hover:text-neutral-800'
              }`}
            >
              2. Options & Review
            </button>
          </div>
        )}
      </div>

      {/* STEP 1: Destination & Alias */}
      {step === 1 && (
        <Card className="p-6 space-y-6">
          <Input
            label="Destination URL *"
            placeholder="https://example.com/long-page-path"
            value={form.originalUrl}
            onChange={(e) => handleUrlChange(e.target.value)}
            error={form.originalUrl && !urlCheck.valid ? urlCheck.error : undefined}
            required
          />

          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Short Alias *
            </label>
            <div className="flex items-center gap-2">
              <div className="flex items-center flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm min-h-[44px]">
                <span className="font-mono text-xs text-slate-400 select-none mr-1.5">
                  {getBaseShortUrl().replace(/^https?:\/\//, '')}/r/
                </span>
                <input
                  type="text"
                  value={form.shortCode}
                  onChange={(e) => updateForm({ shortCode: e.target.value })}
                  className="flex-1 bg-transparent font-mono text-xs text-slate-900 dark:text-slate-100 focus:outline-none"
                  placeholder="alias"
                />
              </div>

              <Button
                type="button"
                variant="outline"
                size="md"
                onClick={() => updateForm({ shortCode: generateShortCode(6) })}
                className="shrink-0 text-xs min-h-[44px]"
              >
                <RefreshCw className="w-3.5 h-3.5 mr-1" />
                <span>Regenerate</span>
              </Button>
            </div>

            <div className="text-xs">
              {aliasAvailability.checking ? (
                <span className="text-neutral-400">Checking availability...</span>
              ) : aliasAvailability.available ? (
                <span className="text-neutral-900 dark:text-white flex items-center gap-1 font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Alias available</span>
                </span>
              ) : (
                <span className="text-red-600 flex items-center gap-1 font-medium">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>{aliasAvailability.error || 'Unavailable'}</span>
                </span>
              )}
            </div>
          </div>

          <Input
            label="Title / Display Label"
            placeholder="e.g. Documentation Portal"
            value={form.title}
            onChange={(e) => updateForm({ title: e.target.value })}
          />

          <Select
            label="Campaign (Optional)"
            options={[{ value: '', label: 'None' }, ...campaigns.map((c) => ({ value: c.id, label: c.name }))]}
            value={form.campaignId}
            onChange={(e) => updateForm({ campaignId: e.target.value })}
          />

          {/* Tags */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-700 dark:text-neutral-300">
              Tags
            </label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {tags.map((t) => {
                const isSelected = form.selectedTags.includes(t.name);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggleTag(t.name)}
                    className={`text-xs px-2.5 py-1 min-h-[36px] rounded-lg border transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-neutral-900 text-white border-neutral-900 font-medium'
                        : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700 hover:bg-neutral-200'
                    }`}
                  >
                    {t.name}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Add custom tag..."
                value={newTagInput}
                onChange={(e) => setNewTagInput(e.target.value)}
                className="flex-1 px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
              <Button type="button" variant="outline" size="sm" onClick={handleAddTag} className="min-h-[40px]">
                <Plus className="w-3.5 h-3.5 mr-1" />
                <span>Add</span>
              </Button>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-end">
            <Button
              type="button"
              variant="primary"
              disabled={!urlCheck.valid || !aliasAvailability.available}
              onClick={() => setStep(2)}
              className="min-h-[44px]"
            >
              <span>Next: Options & Review</span>
              <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </Card>
      )}

      {/* STEP 2: Options & Review */}
      {step === 2 && (
        <div className="space-y-6">
          <Card className="p-6 space-y-6">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white border-b border-slate-100 dark:border-slate-800 pb-3">
              Redirect & Expiry Rules
            </h3>

            {/* Expiration date */}
            <RuleRow
              label="Expiration Date"
              enabled={form.enableExpiry}
              onToggle={(checked) => updateForm({ enableExpiry: checked })}
              borderTop={false}
            >
              <Input
                type="datetime-local"
                value={form.expiresAt}
                onChange={(e) => updateForm({ expiresAt: e.target.value })}
              />
            </RuleRow>

            {/* Click limit */}
            <RuleRow
              label="Click Limit Cap"
              enabled={form.enableLimit}
              onToggle={(checked) => updateForm({ enableLimit: checked })}
            >
              <Input
                type="number"
                min="1"
                placeholder="e.g. 100"
                value={form.clickLimit}
                onChange={(e) => updateForm({ clickLimit: e.target.value === '' ? '' : Number(e.target.value) })}
              />
            </RuleRow>

            {/* Password protection */}
            <RuleRow
              label="Password Protection"
              enabled={form.enablePassword}
              onToggle={(checked) => updateForm({ enablePassword: checked })}
            >
              <div className="space-y-2">
                <Input
                  type="text"
                  placeholder="Enter access passphrase"
                  value={form.password}
                  onChange={(e) => updateForm({ password: e.target.value })}
                />
                <div className="p-3 bg-neutral-50 dark:bg-neutral-900/60 rounded-xl border border-neutral-200 dark:border-neutral-800 space-y-1 text-[11px]">
                  {passwordAnalysis.rules.map((r) => (
                    <div
                      key={r.id}
                      className={`flex items-center gap-1.5 ${
                        r.valid ? 'text-neutral-900 dark:text-white font-medium' : 'text-neutral-400'
                      }`}
                    >
                      {r.valid ? (
                        <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                      ) : (
                        <span className="w-3.5 h-3.5 rounded-full border border-neutral-300 dark:border-neutral-700" />
                      )}
                      <span>{r.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </RuleRow>

            {/* Mobile Destination */}
            <RuleRow
              label="Mobile Device Destination"
              enabled={form.enableMobileUrl}
              onToggle={(checked) => updateForm({ enableMobileUrl: checked })}
            >
              <Input
                placeholder="https://m.example.com or app deep link"
                value={form.mobileUrl}
                onChange={(e) => updateForm({ mobileUrl: e.target.value })}
              />
            </RuleRow>
          </Card>

          {/* Validation & Pre-publish review */}
          <Card className="p-6 space-y-4">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">Check before publishing</h3>

            {errors.length === 0 && warnings.length === 0 && (
              <div className="p-3 bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-xl text-xs text-neutral-800 dark:text-neutral-200 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-neutral-900 dark:text-white shrink-0" />
                <span>All checks passed. Ready to publish.</span>
              </div>
            )}

            {errors.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-rose-600">Blocking Errors:</p>
                {errors.map((err, i) => (
                  <div
                    key={i}
                    className="p-2 bg-rose-50 dark:bg-rose-950/40 rounded text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2"
                  >
                    <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                    <span>{err}</span>
                  </div>
                ))}
              </div>
            )}

            {warnings.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-amber-600">Advisories (Non-blocking):</p>
                {warnings.map((warn, i) => (
                  <div
                    key={i}
                    className="p-2 bg-amber-50 dark:bg-amber-950/40 rounded text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2"
                  >
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span>{warn}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="p-3.5 bg-slate-50 dark:bg-slate-900/60 rounded-lg border border-slate-200 dark:border-slate-800 text-xs space-y-1">
              <p className="font-semibold text-slate-800 dark:text-slate-200">Review Summary:</p>
              <p className="text-slate-600 dark:text-slate-400 font-mono">
                {getBaseShortUrl().replace(/^https?:\/\//, '')}/r/{form.shortCode} &rarr; {form.originalUrl}
              </p>
            </div>
          </Card>

          <div className="flex items-center justify-between">
            <Button variant="outline" size="md" onClick={() => setStep(1)} className="min-h-[44px]">
              <ArrowLeft className="w-4 h-4 mr-1" />
              <span>Back</span>
            </Button>
            <Button
              variant="primary"
              size="md"
              disabled={errors.length > 0}
              isLoading={isSubmitting}
              onClick={handlePublish}
              className="min-h-[44px]"
            >
              <span>Publish Short Link</span>
              <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* STEP 3: Success Screen */}
      {step === 3 && createdLink && (
        <Card className="p-8 text-center space-y-6">
          <div className="w-12 h-12 rounded-xl bg-neutral-900 text-white flex items-center justify-center mx-auto shadow-xs">
            <CheckCircle2 className="w-6 h-6 stroke-[2.2]" />
          </div>

          <div>
            <h2 className="font-display text-xl sm:text-2xl font-normal text-neutral-900 dark:text-white">
              Link Published!
            </h2>
            <p className="text-xs text-neutral-500 mt-1">Your link is active and ready to share.</p>
          </div>

          <div className="p-3 bg-neutral-50 dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-3 max-w-md mx-auto">
            <span className="font-mono text-sm font-medium text-neutral-900 dark:text-neutral-100 underline decoration-neutral-300 truncate">
              {createdLink.fullUrl}
            </span>
            <Button variant="primary" size="sm" onClick={handleCopy} className="shrink-0 min-h-[38px]">
              {copied ? <Check className="w-3.5 h-3.5 mr-1" /> : <Copy className="w-3.5 h-3.5 mr-1" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </Button>
          </div>

          <div className="p-4 bg-white rounded-xl shadow-xs border border-slate-200 inline-block">
            <QRCodeSVG value={createdLink.fullUrl} size={130} />
          </div>

          <div className="flex justify-center gap-3 pt-2">
            <Button variant="outline" size="sm" onClick={handleReset} className="min-h-[40px]">
              Create Another Link
            </Button>
            <Button variant="primary" size="sm" onClick={() => navigate('/app/links')} className="min-h-[40px]">
              View Links
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
