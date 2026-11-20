/**
 * Page Connecteurs : serveurs MCP (Model Context Protocol) qui donnent de nouveaux
 * outils à l'agent — documentation à jour, navigateur, GitHub, ou tout serveur MCP.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Plug, Plus, X, Trash2, RotateCw, ChevronRight, ExternalLink, Loader2, Terminal, Globe, ShieldCheck, Eye,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { openExternalUrl } from '@/services/infra/externalLinks';
import { useConfirmModal } from '@/components/ui/ConfirmModal';
import {
  MCP_PRESETS, PROJECT_MCP_FILES, mask, parsePairs, parseProjectMcp, slugifyServerId, splitCommandLine,
  type McpPreset, type McpServerConfig, type ProjectServerProposal,
} from '@/services/mcp/config';
import { useProjectStore } from '@/stores/projectStore';
import { fileSystemService } from '@/services/filesystem/fileSystem';
import {
  loadMcpConfig, removeServer, restartServer, startServer, upsertServer, useMcpStore, type McpRuntime,
} from '@/services/mcp/manager';

const btn = 'flex items-center gap-1.5 h-8 px-3 rounded-lg text-ui-base font-medium';
const btnPrimary = `${btn} bg-primary-btn text-primary-btn-fg hover:opacity-90 disabled:opacity-50`;
const btnGhost = `${btn} text-text-secondary hover:bg-hover-fill disabled:opacity-50`;
const iconBtn = 'p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-hover-fill disabled:opacity-40';
const input = 'mt-1 w-full h-9 px-3 rounded-lg bg-input border border-input-border text-ui-base text-text-primary outline-none focus:border-input-border-hover';

const STATUS: Record<McpRuntime['status'], { label: string; dot: string }> = {
  off: { label: 'Arrêté', dot: 'bg-text-muted' },
  starting: { label: 'Démarrage…', dot: 'bg-accent-warning animate-pulse' },
  ready: { label: 'Connecté', dot: 'bg-accent-success' },
  error: { label: 'Erreur', dot: 'bg-accent-error' },
};

export default function ConnectorsPage() {
  const servers = useMcpStore((s) => s.servers);
  const runtime = useMcpStore((s) => s.runtime);
  const loaded = useMcpStore((s) => s.loaded);
  const [adding, setAdding] = useState<McpPreset | 'custom' | null>(null);
  const [prefill, setPrefill] = useState<ProjectServerProposal | null>(null);
  const activeProject = useProjectStore((s) => s.projects.find((p) => p.id === s.activeProjectId));
  const projectPath = (activeProject?.metadata?.localPath as string | undefined) || null;
  const [proposals, setProposals] = useState<ProjectServerProposal[]>([]);
  useEffect(() => {
    if (!projectPath) { setProposals([]); return; }
    let alive = true;
    void (async () => {
      const found: ProjectServerProposal[] = [];
      for (const file of PROJECT_MCP_FILES) {
        const text = await fileSystemService.readFile(`${projectPath.replace(/[\\/]+$/, '')}/${file}`).catch(() => null);
        if (text) found.push(...parseProjectMcp(text, file));
      }
      if (alive) setProposals(found);
    })();
    return () => { alive = false; };
  }, [projectPath]);
  const [open, setOpen] = useState<string | null>(null);
  const { confirm, ConfirmDialog } = useConfirmModal();

  useEffect(() => { void loadMcpConfig(); }, []);

  const available = MCP_PRESETS.filter((p) => !servers.some((s) => s.id === p.id));

  const toggle = async (s: McpServerConfig) => {
    await upsertServer({ ...s, enabled: !s.enabled });
  };

  const remove = async (s: McpServerConfig) => {
    const ok = await confirm({
      title: 'Retirer le connecteur',
      message: `Retirer « ${s.name} » ? L'agent n'aura plus ses outils. Ses réglages et jetons seront effacés.`,
      confirmLabel: 'Retirer',
      variant: 'danger',
    });
    if (ok) await removeServer(s.id);
  };

  return (
    <div className="h-full overflow-y-auto">
      {ConfirmDialog}
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="flex items-start gap-3 mb-2">
          <Plug size={22} className="mt-1 text-text-secondary" />
          <div className="flex-1">
            <h1 className="text-ui-xl font-semibold text-text-primary">Connecteurs</h1>
            <p className="text-ui-base text-text-secondary mt-1">
              Des outils en plus pour l'agent, au standard MCP : documentation à jour, navigateur, GitHub… Tout serveur MCP
              fonctionne (les mêmes que dans Claude, Cursor ou VS Code).
            </p>
          </div>
          {!adding && (
            <button onClick={() => setAdding('custom')} className={cn(btnGhost, 'flex-shrink-0')}><Plus size={14} /> Personnalisé</button>
          )}
        </div>

        {adding && (
          <AddForm
            preset={adding === 'custom' ? null : adding}
            prefill={adding === 'custom' ? prefill : null}
            takenIds={servers.map((s) => s.id)}
            onCancel={() => { setAdding(null); setPrefill(null); }}
            onSaved={(id) => { setAdding(null); setPrefill(null); setOpen(id); }}
          />
        )}

        {!adding && proposals.some((p) => !servers.some((s) => s.id === slugifyServerId(p.name))) && (
          <section className="mt-6 rounded-xl border border-border-medium bg-surface-default p-4">
            <h2 className="text-ui-base font-semibold text-text-primary">Proposés par le projet {activeProject?.name}</h2>
            <p className="text-ui-sm text-text-muted mt-1 mb-3">
              Déclarés dans le dépôt (fichiers de Claude Code, Cursor ou VS Code). Rien n'est lancé sans toi : l'import ouvre le formulaire pour que tu relises la commande et complètes les clés.
            </p>
            <div className="space-y-2">
              {proposals.filter((p) => !servers.some((s) => s.id === slugifyServerId(p.name))).map((p) => (
                <div key={`${p.file}:${p.name}`} className="flex items-center gap-3 rounded-lg border border-border-subtle px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block text-ui-sm font-medium text-text-primary">{p.name} <span className="font-normal text-text-muted font-mono text-ui-caption">· {p.file}</span></span>
                    <span className="block font-mono text-ui-caption text-text-muted truncate">{p.transport === 'http' ? p.url : [p.command, ...(p.args || [])].join(' ')}</span>
                    {p.unsupported ? <span className="block text-ui-caption text-accent-error">Non pris en charge : {p.unsupported}</span>
                      : p.needsSetup ? <span className="block text-ui-caption text-accent-warning">Des valeurs sont à compléter (clés, variables)</span> : null}
                  </span>
                  <button disabled={!!p.unsupported} onClick={() => { setPrefill(p); setAdding('custom'); }} className={btnGhost}><Plus size={14} /> Importer</button>
                </div>
              ))}
            </div>
          </section>
        )}

        {!adding && available.length > 0 && (
          <section className="mt-6">
            <h2 className="text-ui-base font-semibold text-text-primary mb-3">Ajouter en un clic</h2>
            <div className="grid gap-2 sm:grid-cols-3">
              {available.map((p) => (
                <button key={p.id} onClick={() => setAdding(p)}
                  className="text-left rounded-xl border border-border-medium bg-surface-default p-3 hover:bg-hover-fill">
                  <span className="block text-ui-base font-medium text-text-primary">{p.name}</span>
                  <span className="block text-ui-sm text-text-secondary mt-1">{p.description}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="mt-8">
          <h2 className="text-ui-base font-semibold text-text-primary mb-1">Mes connecteurs</h2>
          <p className="text-ui-sm text-text-muted mb-3">
            Les actions qui ne font que lire passent sans demander. Les autres suivent ton mode de permission, ou demandent
            toujours ton accord si tu l'as choisi pour ce connecteur.
          </p>
          {!loaded ? <p className="text-ui-sm text-text-muted">Chargement…</p> : servers.length === 0 ? (
            <p className="text-ui-sm text-text-muted">Aucun connecteur pour l'instant.</p>
          ) : (
            <div className="space-y-2">
              {servers.map((s) => (
                <ServerRow key={s.id} server={s} rt={runtime[s.id]} open={open === s.id}
                  onToggleOpen={() => setOpen(open === s.id ? null : s.id)}
                  onToggle={() => void toggle(s)} onRemove={() => void remove(s)} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ServerRow({ server, rt, open, onToggleOpen, onToggle, onRemove }: {
  server: McpServerConfig; rt?: McpRuntime; open: boolean; onToggleOpen: () => void; onToggle: () => void; onRemove: () => void;
}) {
  const status = server.enabled ? (rt?.status ?? 'off') : 'off';
  const s = STATUS[status];
  const readOnly = rt?.tools.filter((t) => t.annotations?.readOnlyHint).length ?? 0;
  const where = server.transport === 'http' ? server.url : [server.command, ...(server.args || [])].join(' ');

  return (
    <div className="rounded-xl border border-border-medium bg-surface-default overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <button onClick={onToggleOpen} className="flex items-center gap-3 flex-1 min-w-0 text-left">
          <ChevronRight size={16} className={cn('flex-shrink-0 text-text-muted transition-transform', open && 'rotate-90')} />
          <span className={cn('h-2 w-2 rounded-full flex-shrink-0', s.dot)} />
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="text-ui-base font-medium text-text-primary">{server.name}</span>
              <span className="text-ui-caption text-text-muted">{server.enabled ? s.label : 'Désactivé'}</span>
              {status === 'ready' && <span className="text-ui-caption text-text-muted">· {rt!.tools.length} outils</span>}
            </span>
            <span className="flex items-center gap-1 text-ui-caption font-mono text-text-muted truncate">
              {server.transport === 'http' ? <Globe size={11} /> : <Terminal size={11} />} {where}
            </span>
          </span>
        </button>
        <span className="flex items-center gap-1 flex-shrink-0">
          {server.enabled && (
            <button onClick={() => void restartServer(server.id)} disabled={status === 'starting'} className={iconBtn} title="Redémarrer">
              {status === 'starting' ? <Loader2 size={14} className="animate-spin" /> : <RotateCw size={14} />}
            </button>
          )}
          <label className="flex items-center gap-1.5 px-2 cursor-pointer text-ui-sm text-text-secondary" title={server.enabled ? 'Désactiver' : 'Activer'}>
            <input type="checkbox" checked={server.enabled} onChange={onToggle} className="accent-current" />
            Actif
          </label>
          <button onClick={onRemove} className={cn(iconBtn, 'hover:text-accent-error')} title="Retirer"><Trash2 size={14} /></button>
        </span>
      </div>

      {server.enabled && status === 'error' && rt?.error && (
        <p className="px-4 pb-3 -mt-1 text-ui-sm text-accent-error break-words">{rt.error}</p>
      )}

      {open && (
        <div className="border-t border-border-medium px-5 py-4 space-y-4 text-ui-sm">
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={!!server.alwaysAsk}
              onChange={(e) => void upsertServer({ ...server, alwaysAsk: e.target.checked }, { restart: false })} />
            <span>
              <span className="flex items-center gap-1 text-text-primary"><ShieldCheck size={13} /> Toujours demander mon accord avant une action</span>
              <span className="block text-text-muted">Même en « Accès complet ». Sinon, les actions MCP demandent un accord hors Full.</span>
            </span>
          </label>

          {server.transport === 'http' && server.headers && Object.keys(server.headers).length > 0 && (
            <div>
              <p className="text-text-secondary mb-1">En-têtes envoyés</p>
              <ul className="font-mono text-ui-caption text-text-muted space-y-0.5">
                {Object.entries(server.headers).map(([k, v]) => (
                  <li key={k}>{k}: {/authorization|key|token|secret/i.test(k) ? mask(v) : v}</li>
                ))}
              </ul>
            </div>
          )}

          {status === 'ready' && rt && (
            <div>
              <p className="text-text-secondary mb-1">
                {rt.info?.name}{rt.info?.version ? ` ${rt.info.version}` : ''} — {rt.tools.length} outils dont {readOnly} en lecture seule{rt.info?.protocolVersion ? ` · MCP ${rt.info.protocolVersion}` : ''}
              </p>
              <ul className="max-h-64 overflow-y-auto rounded-lg border border-border-subtle divide-y divide-border-subtle">
                {rt.tools.map((t) => (
                  <li key={t.name} className="px-3 py-1.5">
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-ui-caption text-text-primary">{t.name}</span>
                      {t.annotations?.readOnlyHint
                        ? <span className="flex items-center gap-0.5 text-ui-caption text-accent-success"><Eye size={11} /> lecture</span>
                        : <span className="text-ui-caption text-accent-warning">action</span>}
                    </span>
                    {t.description && <span className="block text-ui-caption text-text-muted line-clamp-2">{t.description}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {server.enabled && status === 'off' && (
            <button onClick={() => void startServer(server.id)} className={btnGhost}><RotateCw size={14} /> Démarrer</button>
          )}

          {rt?.logs.length ? (
            <details>
              <summary className="cursor-pointer text-text-secondary">Journal du serveur ({rt.logs.length} lignes)</summary>
              <pre className="mt-1 max-h-48 overflow-auto rounded bg-input p-2 text-ui-caption text-text-muted whitespace-pre-wrap">{rt.logs.join('\n')}</pre>
            </details>
          ) : null}
        </div>
      )}
    </div>
  );
}

function AddForm({ preset, prefill, takenIds, onCancel, onSaved }: {
  preset: McpPreset | null; prefill?: ProjectServerProposal | null; takenIds: string[]; onCancel: () => void; onSaved: (id: string) => void;
}) {
  const initial = useMemo(() => Object.fromEntries((preset?.fields || []).map((f) => [f.key, f.default ?? (f.kind === 'checkbox' ? false : '')])), [preset]);
  const [values, setValues] = useState<Record<string, string | boolean>>(initial);
  // Personnalisé
  const quote = (a: string) => (/\s/.test(a) ? `"${a}"` : a);
  const [name, setName] = useState(prefill?.name || '');
  const [kind, setKind] = useState<'stdio' | 'http'>(prefill?.transport || 'stdio');
  const [commandLine, setCommandLine] = useState(prefill?.command ? [prefill.command, ...(prefill.args || [])].map(quote).join(' ') : '');
  const [url, setUrl] = useState(prefill?.url || '');
  const [pairs, setPairs] = useState(prefill
    ? Object.entries(prefill.transport === 'http' ? prefill.headers || {} : prefill.env || {}).map(([k, v]) => `${k}${prefill.transport === 'http' ? ': ' : '='}${v}`).join('\n')
    : '');
  const [alwaysAsk, setAlwaysAsk] = useState(true);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    let config: McpServerConfig;
    if (preset) {
      const missing = preset.fields.find((f) => f.required && !String(values[f.key] || '').trim());
      if (missing) { toast.error(`${missing.label} : obligatoire.`); return; }
      config = { ...preset.build(values), enabled: true };
    } else {
      const id = slugifyServerId(name);
      if (!id) { toast.error('Donne un nom au connecteur.'); return; }
      if (takenIds.includes(id)) { toast.error(`Un connecteur « ${id} » existe déjà.`); return; }
      if (kind === 'stdio') {
        const [command, ...args] = splitCommandLine(commandLine.trim());
        if (!command) { toast.error('Indique la commande de lancement, par exemple : npx -y @upstash/context7-mcp'); return; }
        config = { id, name: name.trim(), transport: 'stdio', command, args, env: parsePairs(pairs, '='), enabled: true, alwaysAsk };
      } else {
        if (!/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)/.test(url.trim())) { toast.error('Adresse https:// attendue.'); return; }
        config = { id, name: name.trim(), transport: 'http', url: url.trim(), headers: parsePairs(pairs, ':'), enabled: true, alwaysAsk };
      }
    }
    setSaving(true);
    try {
      await upsertServer(config);
      toast.success(`${config.name} ajouté — démarrage en cours`);
      onSaved(config.id);
    } catch (e: any) {
      toast.error(`Enregistrement impossible — ${e?.message || e}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-6 rounded-xl border border-border-medium bg-surface-default p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-ui-lg font-semibold text-text-primary">{preset ? `Ajouter ${preset.name}` : prefill ? `Importer ${prefill.name} (${prefill.file})` : 'Connecteur personnalisé'}</h2>
        <button onClick={onCancel} className="p-1 rounded-md text-text-muted hover:text-text-primary" title="Annuler"><X size={16} /></button>
      </div>

      {preset ? (
        <>
          <p className="text-ui-sm text-text-secondary">{preset.description}</p>
          {preset.requirement && <p className="text-ui-sm text-text-muted">Prérequis : {preset.requirement}</p>}
          <button onClick={() => { void openExternalUrl(preset.link).catch(() => toast.error('Lien impossible à ouvrir.')); }} className="flex items-center gap-1 text-ui-sm text-text-secondary hover:text-text-primary">
            <ExternalLink size={12} /> Documentation
          </button>
          {preset.fields.map((f) => f.kind === 'checkbox' ? (
            <label key={f.key} className="flex items-center gap-2 text-ui-sm text-text-primary cursor-pointer">
              <input type="checkbox" checked={!!values[f.key]} onChange={(e) => setValues({ ...values, [f.key]: e.target.checked })} />
              {f.label}
            </label>
          ) : (
            <label key={f.key} className="block">
              <span className="text-ui-sm text-text-secondary">{f.label}</span>
              <input type={f.secret ? 'password' : 'text'} value={String(values[f.key] ?? '')} placeholder={f.placeholder}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} className={cn(input, 'font-mono')} autoComplete="off" />
              {f.help && <span className="block mt-1 text-ui-caption text-text-muted">{f.help}</span>}
            </label>
          ))}
        </>
      ) : (
        <>
          <label className="block">
            <span className="text-ui-sm text-text-secondary">Nom</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Supabase" className={input} />
          </label>
          <div className="flex gap-2">
            {(['stdio', 'http'] as const).map((k) => (
              <button key={k} onClick={() => setKind(k)}
                className={cn('flex-1 rounded-lg border px-3 py-2 text-left text-ui-sm', kind === k ? 'border-input-border-hover bg-hover-fill' : 'border-border-medium')}>
                <span className="flex items-center gap-1.5 font-medium text-text-primary">{k === 'stdio' ? <Terminal size={13} /> : <Globe size={13} />}{k === 'stdio' ? 'Local' : 'Distant (HTTP)'}</span>
                <span className="block text-ui-caption text-text-muted">{k === 'stdio' ? 'Lancé sur cet ordinateur (npx, uvx, docker…)' : 'Une adresse https://…/mcp'}</span>
              </button>
            ))}
          </div>
          {kind === 'stdio' ? (
            <label className="block">
              <span className="text-ui-sm text-text-secondary">Commande de lancement</span>
              <input value={commandLine} onChange={(e) => setCommandLine(e.target.value)} placeholder="npx -y @supabase/mcp-server-supabase@latest --read-only"
                className={cn(input, 'font-mono text-ui-sm')} />
              <span className="block mt-1 text-ui-caption text-text-muted">Lanceurs acceptés : npx, node, bunx, deno, uvx, uv, pipx, python, docker. N'ajoute que des serveurs dont tu connais l'auteur : ils tournent sur ton ordinateur.</span>
            </label>
          ) : (
            <label className="block">
              <span className="text-ui-sm text-text-secondary">Adresse du serveur</span>
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://exemple.com/mcp" className={cn(input, 'font-mono text-ui-sm')} />
            </label>
          )}
          <label className="block">
            <span className="text-ui-sm text-text-secondary">
              {kind === 'stdio' ? 'Variables d\'environnement (une par ligne : CLÉ=valeur)' : 'En-têtes (un par ligne : Nom: valeur)'}
            </span>
            <textarea value={pairs} onChange={(e) => setPairs(e.target.value)} rows={3}
              placeholder={kind === 'stdio' ? 'SUPABASE_ACCESS_TOKEN=sbp_…' : 'Authorization: Bearer …'}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-input border border-input-border font-mono text-ui-caption text-text-primary outline-none focus:border-input-border-hover resize-y" />
          </label>
          <label className="flex items-center gap-2 text-ui-sm text-text-primary cursor-pointer">
            <input type="checkbox" checked={alwaysAsk} onChange={(e) => setAlwaysAsk(e.target.checked)} />
            Toujours demander mon accord avant une action (recommandé)
          </label>
        </>
      )}

      <p className="text-ui-caption text-text-muted">Les jetons restent sur cet ordinateur et ne sont jamais envoyés au modèle.</p>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className={btnGhost}>Annuler</button>
        <button onClick={() => void save()} disabled={saving} className={btnPrimary}>{saving ? 'Ajout…' : 'Ajouter'}</button>
      </div>
    </div>
  );
}
