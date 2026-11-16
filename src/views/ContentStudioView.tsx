import React, { useEffect, useState } from 'react';
import { Copy, FileText, Loader2, Save, Sparkles, Trash2 } from 'lucide-react';
import { EmptyState, StatusText } from '../components/ui/DataState';
import { useToast } from '../context/ToastContext';
import { apiFetch } from '../lib/apiClient';
import { ContentType, GeneratedContent, Website } from '../types';

interface ContentStudioViewProps {
  websites: Website[];
  contents: GeneratedContent[];
  selectedWebsiteId: string;
  prefillKeyword?: string;
  prefillTitle?: string;
  onSaveContent: (input: {
    websiteId?: string;
    contentType: ContentType;
    title: string;
    targetKeyword?: string;
    body: string;
    metaTitle?: string;
    metaDescription?: string;
    status: 'draft' | 'published';
  }) => Promise<string>;
  onUpdateContent: (
    id: string,
    updates: {
      title?: string;
      targetKeyword?: string;
      body?: string;
      metaTitle?: string;
      metaDescription?: string;
      status?: 'draft' | 'published';
    }
  ) => Promise<void>;
  onDeleteContent: (id: string) => Promise<void>;
}

const CONTENT_TYPES: Array<{ value: ContentType; label: string }> = [
  { value: 'blog', label: 'SEO Blog Article' },
  { value: 'meta_title', label: 'Meta Titles (5x)' },
  { value: 'meta_description', label: 'Meta Descriptions (5x)' },
  { value: 'product_description', label: 'Product Description' },
  { value: 'landing_page', label: 'Landing Page Copy' },
  { value: 'faq', label: 'SEO FAQ Block' },
];

export function ContentStudioView({
  websites,
  contents,
  selectedWebsiteId,
  prefillKeyword,
  prefillTitle,
  onSaveContent,
  onUpdateContent,
  onDeleteContent,
}: ContentStudioViewProps) {
  const { toast } = useToast();
  const [contentType, setContentType] = useState<ContentType>('blog');
  const [topic, setTopic] = useState(prefillTitle || '');
  const [targetKeyword, setTargetKeyword] = useState(prefillKeyword || '');
  const [tone, setTone] = useState('Authoritative & Clear');
  const [audience, setAudience] = useState('B2B Decision Makers');
  const [generating, setGenerating] = useState(false);

  // Active editor state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftMetaTitle, setDraftMetaTitle] = useState('');
  const [draftMetaDesc, setDraftMetaDesc] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [draftStatus, setDraftStatus] = useState<'draft' | 'published'>('draft');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (prefillKeyword) setTargetKeyword(prefillKeyword);
    if (prefillTitle) setTopic(prefillTitle);
  }, [prefillKeyword, prefillTitle]);

  const activeWebsite = websites.find((w) => w.id === selectedWebsiteId);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) return;
    setGenerating(true);
    try {
      const data = await apiFetch<{
        title: string;
        metaTitle?: string;
        metaDescription?: string;
        body: string;
      }>('/api/ai/content', {
        method: 'POST',
        body: JSON.stringify({
          contentType,
          topic: topic.trim(),
          targetKeyword: targetKeyword.trim(),
          tone,
          audience,
          websiteName: activeWebsite?.name || '',
        }),
      });
      setEditingId(null);
      setDraftTitle(data.title);
      setDraftMetaTitle(data.metaTitle || '');
      setDraftMetaDesc(data.metaDescription || '');
      setDraftBody(data.body);
      setDraftStatus('draft');
      toast({ title: 'Draft generated with Gemini AI', description: 'Review, edit, and save to your library.', variant: 'success' });
    } catch (err) {
      toast({
        title: 'Generation failed',
        description: err instanceof Error ? err.message : 'Unable to generate copy.',
        variant: 'error',
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!draftTitle.trim() || !draftBody.trim()) {
      toast({ title: 'Title and body are required', variant: 'error' });
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await onUpdateContent(editingId, {
          title: draftTitle,
          targetKeyword,
          metaTitle: draftMetaTitle,
          metaDescription: draftMetaDesc,
          body: draftBody,
          status: draftStatus,
        });
        toast({ title: 'Content updated', variant: 'success' });
      } else {
        const newId = await onSaveContent({
          websiteId: selectedWebsiteId,
          contentType,
          title: draftTitle,
          targetKeyword,
          metaTitle: draftMetaTitle,
          metaDescription: draftMetaDesc,
          body: draftBody,
          status: draftStatus,
        });
        setEditingId(newId);
        toast({ title: 'Saved to Content Library', variant: 'success' });
      }
    } catch (err) {
      toast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Could not save content.',
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const loadIntoEditor = (item: GeneratedContent) => {
    setEditingId(item.id);
    setContentType(item.contentType);
    setTargetKeyword(item.targetKeyword || '');
    setDraftTitle(item.title);
    setDraftMetaTitle(item.metaTitle || '');
    setDraftMetaDesc(item.metaDescription || '');
    setDraftBody(item.body);
    setDraftStatus(item.status);
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Left Column: Generator Controls & Saved Assets */}
      <div className="lg:col-span-4 space-y-6">
        <form
          onSubmit={handleGenerate}
          className="rounded-xl border border-slate-200 bg-white p-5 space-y-3.5 dark:border-slate-800 dark:bg-slate-900"
        >
          <h2 className="font-display text-sm font-semibold">AI Content Generator</h2>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Content Format
            </label>
            <select
              value={contentType}
              onChange={(e) => setContentType(e.target.value as ContentType)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
            >
              {CONTENT_TYPES.map((ct) => (
                <option key={ct.value} value={ct.value}>
                  {ct.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Topic or Product Brief
            </label>
            <textarea
              required
              rows={3}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Describe the article topic, product features, or landing page offer..."
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Target Keyword
            </label>
            <input
              type="text"
              value={targetKeyword}
              onChange={(e) => setTargetKeyword(e.target.value)}
              placeholder="e.g. automated invoice tracking"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
            />
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Tone</label>
              <input
                type="text"
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Audience</label>
              <input
                type="text"
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={generating}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            <span>{generating ? 'Writing Draft...' : 'Generate with Gemini'}</span>
          </button>
        </form>

        <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
          <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <h3 className="font-display text-xs font-semibold">Saved Content Library ({contents.length})</h3>
          </div>
          {contents.length === 0 ? (
            <div className="p-5 text-center text-xs text-slate-500">
              Saved blogs, meta tags, and landing copy appear here.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 max-h-[380px] overflow-y-auto dark:divide-slate-800">
              {contents.map((item) => (
                <div
                  key={item.id}
                  className={`flex items-start justify-between gap-2 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
                    editingId === item.id ? 'bg-indigo-50/60 dark:bg-indigo-950/30' : ''
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => loadIntoEditor(item)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate text-xs font-medium text-slate-900 dark:text-slate-100">
                      {item.title}
                    </p>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
                      <span>{CONTENT_TYPES.find((t) => t.value === item.contentType)?.label || item.contentType}</span>
                      <span aria-hidden="true">·</span>
                      <StatusText
                        label={item.status === 'published' ? 'Published' : 'Draft'}
                        tone={item.status === 'published' ? 'success' : 'neutral'}
                      />
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await onDeleteContent(item.id);
                      if (editingId === item.id) {
                        setEditingId(null);
                        setDraftTitle('');
                        setDraftBody('');
                      }
                      toast({ title: 'Content deleted', variant: 'info' });
                    }}
                    className="rounded p-1 text-slate-400 hover:text-red-600"
                    aria-label="Delete asset"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right Column: Editable Canvas */}
      <div className="lg:col-span-8">
        {!draftBody && !draftTitle ? (
          <EmptyState
            title="Generate or select content to edit"
            description="Choose a content format on the left to create SEO blog articles, meta titles, meta descriptions, product copy, landing page sections, or FAQs—then refine and save them directly to Firestore."
            actionLabel="Start Blank Draft"
            onAction={() => {
              setEditingId(null);
              setDraftTitle('New SEO Content Asset');
              setDraftBody('## Outline\n\nWrite or paste your SEO copy here...');
            }}
          />
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3.5 dark:border-slate-800">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">
                <FileText className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                <span>{editingId ? 'Editing Saved Asset' : 'Unsaved AI Draft'}</span>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={draftStatus}
                  onChange={(e) => setDraftStatus(e.target.value as 'draft' | 'published')}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium dark:border-slate-700 dark:bg-slate-800"
                >
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                </select>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(`${draftTitle}\n\n${draftBody}`);
                    toast({ title: 'Copied content to clipboard', variant: 'info' });
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                >
                  <Copy className="h-3.5 w-3.5" />
                  <span>Copy</span>
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  <Save className="h-3.5 w-3.5" />
                  <span>{saving ? 'Saving...' : editingId ? 'Update' : 'Save Asset'}</span>
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Asset Title</label>
              <input
                type="text"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-display text-sm font-semibold outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  SEO Meta Title ({draftMetaTitle.length}/60)
                </label>
                <input
                  type="text"
                  value={draftMetaTitle}
                  onChange={(e) => setDraftMetaTitle(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  SEO Meta Description ({draftMetaDesc.length}/155)
                </label>
                <input
                  type="text"
                  value={draftMetaDesc}
                  onChange={(e) => setDraftMetaDesc(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                Content Body (Editable Markdown / Copy)
              </label>
              <textarea
                rows={16}
                value={draftBody}
                onChange={(e) => setDraftBody(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white p-3.5 font-mono text-xs leading-relaxed outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
