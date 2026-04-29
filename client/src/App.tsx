import { useEffect, useMemo, useState } from "react";
import { QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import {
  Activity,
  Ban,
  Bot,
  ChevronRight,
  Clock3,
  Command,
  Eye,
  Flag,
  Gauge,
  History,
  Link as LinkIcon,
  MessageSquareWarning,
  Moon,
  PlugZap,
  Radio,
  Search,
  Shield,
  ShieldAlert,
  Sparkles,
  TerminalSquare,
  TimerReset,
  Trash2,
  UserRound,
  Zap,
} from "lucide-react";
import { queryClient, apiRequest } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type QueueItem = {
  id: string;
  user: string;
  risk: number;
  level: "critical" | "high" | "medium";
  message: string;
  reason: string;
  seenBefore: string;
  accountAge: string;
  badges: string[];
};

type ModerationEvent = {
  id: number;
  targetUser: string;
  action: string;
  reason: string;
  moderator: string;
  createdAt: string;
};

type ChatCommand = {
  id: number;
  name: string;
  response: string;
  cooldownSeconds: number;
  enabled: boolean;
};

type ModeratorIdentity = {
  id: string | null;
  login: string | null;
  displayName: string | null;
  scopes: string[];
};

type Broadcaster = {
  id: string | null;
  login: string | null;
  displayName: string | null;
};

type Status = {
  channel: string;
  mode: string;
  connected: boolean;
  viewers: number;
  chatters: number;
  pending: number;
  actionsToday: number;
  automod: string;
  eventSub: string;
  hasTwitchCredentials: boolean;
  oauthUrl: string | null;
  requiredEnv: string[];
  redirectUri: string;
  scopes: string[];
  moderator: ModeratorIdentity | null;
  broadcaster: Broadcaster | null;
  canModerate: boolean;
  note: string;
};

type TwitchStatus = {
  connected: boolean;
  hasCredentials: boolean;
  oauthUrl: string | null;
  redirectUri: string;
  scopes: string[];
  moderator: ModeratorIdentity | null;
  broadcaster: Broadcaster | null;
  canModerate: boolean;
  tokenUpdatedAt: string | null;
  error: string | null;
};

type ActiveSection = "overview" | "queue" | "commands" | "history" | "connect";

const navigation: Array<{ id: ActiveSection; label: string; icon: typeof Shield; badge?: string }> = [
  { id: "overview", label: "Command", icon: Gauge },
  { id: "queue", label: "Queue", icon: MessageSquareWarning, badge: "4" },
  { id: "commands", label: "Commands", icon: Command },
  { id: "history", label: "Action log", icon: History },
  { id: "connect", label: "Twitch OAuth", icon: PlugZap },
];

const actionLabels: Record<string, string> = {
  timeout_60: "Timeout 60s",
  timeout_600: "Timeout 10m",
  ban: "Ban",
  delete: "Delete message",
  warn: "Warning",
};

function RiskBadge({ level, risk }: { level: QueueItem["level"]; risk: number }) {
  const style = {
    critical: "border-red-400/30 bg-red-500/12 text-red-200",
    high: "border-amber-400/30 bg-amber-500/12 text-amber-100",
    medium: "border-cyan-400/30 bg-cyan-500/12 text-cyan-100",
  }[level];

  return (
    <Badge variant="outline" className={cn("gap-1.5", style)} data-testid={`badge-risk-${level}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {risk}
    </Badge>
  );
}

function BrandMark() {
  return (
    <div className="flex items-center gap-3">
      <div className="grid h-9 w-9 place-items-center rounded-lg border border-primary/30 bg-primary/15 text-primary">
        <svg aria-label="Mod Command logo" viewBox="0 0 32 32" className="h-5 w-5" fill="none">
          <path d="M7 8.5 16 4l9 4.5v7.2c0 5.5-3.5 9.8-9 12.3-5.5-2.5-9-6.8-9-12.3V8.5Z" stroke="currentColor" strokeWidth="2" />
          <path d="M11 16h10M16 11v10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-foreground">Mod Command</p>
        <p className="truncate text-xs text-muted-foreground">Twitch moderation</p>
      </div>
    </div>
  );
}

function AppSidebar({
  active,
  setActive,
}: {
  active: ActiveSection;
  setActive: (section: ActiveSection) => void;
}) {
  return (
    <Sidebar collapsible="icon" className="border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border p-4">
        <BrandMark />
      </SidebarHeader>
      <SidebarContent className="px-2 py-4">
        <SidebarGroup>
          <SidebarGroupLabel>Moderator workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigation.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    isActive={active === item.id}
                    onClick={() => setActive(item.id)}
                    tooltip={item.label}
                    data-testid={`nav-${item.id}`}
                  >
                    <item.icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                  {item.badge ? (
                    <SidebarMenuBadge className="bg-primary/20 text-primary">{item.badge}</SidebarMenuBadge>
                  ) : null}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border p-4">
        <div className="rounded-lg border border-sidebar-border bg-sidebar-accent/60 p-3">
          <div className="flex items-center gap-2 text-xs font-medium text-sidebar-foreground">
            <Radio className="h-3.5 w-3.5 text-green-400" />
            Demo stream live
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Ready for Twitch credentials</p>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

function Header({
  active,
  status,
}: {
  active: ActiveSection;
  status?: Status;
}) {
  const titles: Record<ActiveSection, string> = {
    overview: "Moderator command center",
    queue: "Suspicious message queue",
    commands: "Chat commands",
    history: "Moderator action log",
    connect: "Twitch API connection",
  };

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center justify-between gap-4 border-b border-border bg-background/92 px-5 backdrop-blur">
      <div className="flex items-center gap-3">
        <SidebarTrigger data-testid="button-sidebar-toggle" />
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{titles[active]}</h1>
          <p className="text-xs text-muted-foreground">
            {status?.canModerate
              ? `Live · ${status.broadcaster?.displayName ?? status.broadcaster?.login}`
              : status?.connected
                ? "Authorized · pick a channel to go live"
                : status?.hasTwitchCredentials
                  ? "Credentials present · authorize to enable live"
                  : "Demo mode with OAuth-ready backend"}
          </p>
        </div>
      </div>
      <div className="hidden items-center gap-2 md:flex">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="w-64 border-border/70 bg-card pl-9"
            placeholder="Search users or commands"
            data-testid="input-global-search"
          />
        </div>
        <Button variant="outline" size="sm" data-testid="button-theme-status">
          <Moon className="h-4 w-4" />
          Dark pro
        </Button>
      </div>
    </header>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Shield;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Card className="border-card-border bg-card/80 shadow-sm" data-testid={`card-stat-${label.toLowerCase().replace(/\s/g, "-")}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
            <p className="mt-2 text-xl font-semibold tabular-nums">{value}</p>
          </div>
          <div className="rounded-md border border-primary/20 bg-primary/10 p-2 text-primary">
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function Overview({
  status,
  queue,
  events,
  onSelect,
}: {
  status?: Status;
  queue: QueueItem[];
  events: ModerationEvent[];
  onSelect: (item: QueueItem) => void;
}) {
  return (
    <div className="space-y-5">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Eye} label="Viewers" value={String(status?.viewers ?? "—")} detail="Current CCU from active stream" />
        <StatCard icon={UserRound} label="Chatters" value={String(status?.chatters ?? "—")} detail="Unique chatters in live window" />
        <StatCard icon={Flag} label="Queue" value={String(queue.length)} detail="Open messages needing mod review" />
        <StatCard icon={Shield} label="Actions" value={String(status?.actionsToday ?? events.length)} detail="Moderator actions today" />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.45fr_0.85fr]">
        <Card className="glass-panel overflow-hidden border-card-border shadow-md">
          <CardHeader className="flex flex-row items-center justify-between gap-3 border-b border-border/70 pb-4">
            <div>
              <CardTitle className="text-base">Priority queue</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">High-risk messages are ranked by context, not just keywords.</p>
            </div>
            <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">Live simulation</Badge>
          </CardHeader>
          <CardContent className="space-y-3 p-4">
            {queue.slice(0, 3).map((item) => (
              <button
                key={item.id}
                onClick={() => onSelect(item)}
                className="flex w-full items-center justify-between gap-4 rounded-lg border border-border/70 bg-background/50 p-4 text-left hover:border-primary/40 hover:bg-primary/5"
                data-testid={`button-open-message-${item.id}`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{item.user}</p>
                    <RiskBadge level={item.level} risk={item.risk} />
                    <span className="text-xs text-muted-foreground">{item.reason}</span>
                  </div>
                  <p className="mt-2 truncate text-sm text-muted-foreground">{item.message}</p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </CardContent>
        </Card>

        <Card className="border-card-border bg-card/80 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Guard rails</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              ["Chat shield", "Auto-highlights spam, floods, and unsafe links", true],
              ["One-click actions", "Timeout, ban, delete, warn from one drawer", true],
              ["Real Twitch mode", status?.canModerate ? "Live Helix calls active" : "Authorize and pick a broadcaster", Boolean(status?.canModerate)],
            ].map(([title, description, enabled]) => (
              <div key={String(title)} className="flex items-center justify-between gap-4 rounded-lg border border-border/60 p-3">
                <div>
                  <p className="text-sm font-medium">{title}</p>
                  <p className="text-xs text-muted-foreground">{description}</p>
                </div>
                <Switch checked={Boolean(enabled)} aria-label={`${title} enabled`} data-testid={`switch-${String(title).toLowerCase().replace(/\s/g, "-")}`} />
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function QueueView({
  queue,
  onSelect,
  onAction,
}: {
  queue: QueueItem[];
  onSelect: (item: QueueItem) => void;
  onAction: (item: QueueItem, action: string) => void;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_19rem]">
      <div className="space-y-3">
        {queue.map((item) => (
          <article key={item.id} className="rounded-xl border border-card-border bg-card p-4 shadow-sm" data-testid={`card-queue-${item.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold">{item.user}</h2>
                  <RiskBadge level={item.level} risk={item.risk} />
                  {item.badges.map((badge) => (
                    <Badge key={badge} variant="outline" className="border-border/80 text-muted-foreground">
                      {badge}
                    </Badge>
                  ))}
                </div>
                <p className="mt-3 rounded-lg border border-border/70 bg-background/60 p-3 text-sm text-foreground">{item.message}</p>
                <p className="mt-2 text-xs text-muted-foreground">{item.reason} · {item.seenBefore} · account {item.accountAge}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => onSelect(item)} data-testid={`button-details-${item.id}`}>
                Details
              </Button>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => onAction(item, "timeout_60")} data-testid={`button-timeout60-${item.id}`}>
                <TimerReset className="h-4 w-4" />
                60s
              </Button>
              <Button size="sm" variant="secondary" onClick={() => onAction(item, "timeout_600")} data-testid={`button-timeout600-${item.id}`}>
                <Clock3 className="h-4 w-4" />
                10m
              </Button>
              <Button size="sm" variant="outline" onClick={() => onAction(item, "delete")} data-testid={`button-delete-${item.id}`}>
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
              <Button size="sm" variant="destructive" onClick={() => onAction(item, "ban")} data-testid={`button-ban-${item.id}`}>
                <Ban className="h-4 w-4" />
                Ban
              </Button>
            </div>
          </article>
        ))}
      </div>
      <aside className="rounded-xl border border-card-border bg-card p-4">
        <h2 className="text-sm font-semibold">Mod decision pattern</h2>
        <div className="mt-4 space-y-3 text-sm text-muted-foreground">
          <p><span className="text-foreground">60s timeout</span> for heat-of-moment toxicity.</p>
          <p><span className="text-foreground">10m timeout</span> for repeat flooding or baiting.</p>
          <p><span className="text-foreground">Ban</span> for spam links, hate, doxxing, or obvious bot behavior.</p>
        </div>
      </aside>
    </div>
  );
}

function CommandsView({ commands }: { commands: ChatCommand[] }) {
  const { toast } = useToast();
  const mutation = useMutation({
    mutationFn: async (command: ChatCommand) => {
      const res = await apiRequest("POST", "/api/commands", {
        name: command.name,
        response: command.response,
        cooldownSeconds: command.cooldownSeconds,
        enabled: !command.enabled,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/commands"] });
      toast({ title: "Command updated", description: "Demo command state was saved on the backend." });
    },
  });

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
      <Card className="border-card-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Command library</CardTitle>
          <p className="text-sm text-muted-foreground">Fast templates that reduce repeated typing during intense chat moments.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {commands.map((command) => (
            <div key={command.id} className="rounded-lg border border-border/70 bg-background/45 p-4" data-testid={`card-command-${command.id}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="rounded-md bg-primary/10 p-2 text-primary">
                    <TerminalSquare className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-medium">{command.name}</p>
                    <p className="text-xs text-muted-foreground">{command.cooldownSeconds}s cooldown</p>
                  </div>
                </div>
                <Switch
                  checked={command.enabled}
                  onCheckedChange={() => mutation.mutate(command)}
                  aria-label={`Toggle ${command.name}`}
                  data-testid={`switch-command-${command.id}`}
                />
              </div>
              <p className="mt-3 text-sm text-muted-foreground">{command.response}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="border-card-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">New command draft</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input defaultValue="!discord" data-testid="input-command-name" />
          <Textarea defaultValue="Join the community Discord after stream. Mods will drop the link." data-testid="textarea-command-response" />
          <Button className="w-full" data-testid="button-save-command">
            <Zap className="h-4 w-4" />
            Save command
          </Button>
          <p className="text-xs text-muted-foreground">In live mode, commands can be sent through Twitch chat APIs after bot authorization.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function HistoryView({ events }: { events: ModerationEvent[] }) {
  return (
    <Card className="border-card-border bg-card">
      <CardHeader>
        <CardTitle className="text-base">Action log</CardTitle>
        <p className="text-sm text-muted-foreground">Every moderator action is captured for review and accountability.</p>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <div className="grid place-items-center rounded-xl border border-dashed border-border py-16 text-center">
            <div className="rounded-full border border-border bg-background p-4 text-muted-foreground">
              <History className="h-6 w-6" />
            </div>
            <h2 className="mt-4 text-base font-semibold">No actions yet</h2>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">Use timeout, delete, warning, or ban from the queue to create an auditable log.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {events.map((event) => (
              <div key={event.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 p-3" data-testid={`row-event-${event.id}`}>
                <div>
                  <p className="text-sm font-medium">{actionLabels[event.action] ?? event.action} · {event.targetUser}</p>
                  <p className="text-xs text-muted-foreground">{event.reason}</p>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <p>{event.moderator}</p>
                  <p>{new Date(event.createdAt).toLocaleTimeString()}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ChecklistRow({ ok, label, hint }: { ok: boolean; label: string; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border/70 bg-background/50 p-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      <Badge
        variant="outline"
        className={cn(
          "gap-1.5",
          ok
            ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
            : "border-amber-400/30 bg-amber-500/10 text-amber-100",
        )}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
        {ok ? "Ready" : "Pending"}
      </Badge>
    </div>
  );
}

function ConnectView({ status, twitch }: { status?: Status; twitch?: TwitchStatus }) {
  const { toast } = useToast();
  const [channelInput, setChannelInput] = useState("");

  useEffect(() => {
    if (twitch?.broadcaster?.login) setChannelInput(twitch.broadcaster.login);
  }, [twitch?.broadcaster?.login]);

  const channelMutation = useMutation({
    mutationFn: async (channelLogin: string) => {
      const res = await apiRequest("POST", "/api/twitch/channel", { channelLogin });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/twitch/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/status"] });
      toast({
        title: "Channel configured",
        description: `Broadcaster set to ${data.broadcaster?.displayName ?? data.broadcaster?.login}.`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Channel config failed", description: err.message, variant: "destructive" });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/twitch/disconnect");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/twitch/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/status"] });
      toast({ title: "Disconnected", description: "Stored Twitch token was cleared." });
    },
  });

  const hasCredentials = twitch?.hasCredentials ?? status?.hasTwitchCredentials ?? false;
  const isConnected = twitch?.connected ?? false;
  const moderator = twitch?.moderator ?? status?.moderator ?? null;
  const broadcaster = twitch?.broadcaster ?? status?.broadcaster ?? null;
  const canModerate = twitch?.canModerate ?? status?.canModerate ?? false;
  const oauthUrl = twitch?.oauthUrl ?? status?.oauthUrl ?? null;
  const scopes = twitch?.scopes ?? status?.scopes ?? [];
  const redirectUri = twitch?.redirectUri ?? status?.redirectUri ?? "";

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_24rem]">
      <Card className="border-card-border bg-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <PlugZap className="h-4 w-4 text-primary" />
            Twitch OAuth & moderation
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Authorize a moderator account, then point it at the broadcaster channel you mod.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-border bg-background/50 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Connection</p>
            <p className="mt-2 text-lg font-semibold" data-testid="text-connection-state">
              {isConnected
                ? `Connected as ${moderator?.displayName ?? moderator?.login ?? "moderator"}`
                : hasCredentials
                  ? "Credentials present — authorize next"
                  : "Server credentials missing"}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">{status?.note}</p>
            {twitch?.error ? (
              <p className="mt-2 text-sm text-red-300" data-testid="text-twitch-error">{twitch.error}</p>
            ) : null}
          </div>

          <div className="grid gap-2">
            <ChecklistRow
              ok={hasCredentials}
              label="Server credentials"
              hint="TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET set in the server environment."
            />
            <ChecklistRow
              ok={Boolean(moderator?.id)}
              label="Moderator authorized"
              hint={
                moderator?.login
                  ? `Logged in as ${moderator.displayName ?? moderator.login} (id ${moderator.id}).`
                  : "Click Start Twitch OAuth to authorize a moderator account."
              }
            />
            <ChecklistRow
              ok={Boolean(broadcaster?.id)}
              label="Broadcaster channel selected"
              hint={
                broadcaster?.login
                  ? `Moderating ${broadcaster.displayName ?? broadcaster.login} (id ${broadcaster.id}).`
                  : "Set the channel login below — Helix calls need a broadcaster_id."
              }
            />
            <ChecklistRow
              ok={canModerate}
              label="Live Helix actions ready"
              hint="When all three rows above are ready, timeout and ban call the real Twitch API."
            />
          </div>

          <div className="rounded-lg border border-border bg-background/50 p-4">
            <p className="text-sm font-medium">Broadcaster channel</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Enter the Twitch channel login you moderate (e.g. <code>yourresistt</code>).
            </p>
            <form
              className="mt-3 flex flex-wrap gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!channelInput.trim()) return;
                channelMutation.mutate(channelInput.trim().toLowerCase());
              }}
            >
              <Input
                value={channelInput}
                onChange={(event) => setChannelInput(event.target.value)}
                placeholder="channel_login"
                className="min-w-[14rem] flex-1"
                data-testid="input-broadcaster-login"
              />
              <Button type="submit" disabled={!isConnected || channelMutation.isPending} data-testid="button-set-channel">
                {channelMutation.isPending ? "Saving…" : "Save channel"}
              </Button>
            </form>
            {!isConnected ? (
              <p className="mt-2 text-xs text-muted-foreground">Authorize first, then save the channel.</p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            {oauthUrl ? (
              <Button asChild data-testid="link-twitch-oauth">
                <a href={oauthUrl}>
                  <LinkIcon className="h-4 w-4" />
                  {isConnected ? "Re-authorize Twitch" : "Start Twitch OAuth"}
                </a>
              </Button>
            ) : (
              <Button disabled data-testid="button-oauth-disabled">
                <LinkIcon className="h-4 w-4" />
                Add credentials first
              </Button>
            )}
            {isConnected ? (
              <Button
                variant="outline"
                onClick={() => disconnectMutation.mutate()}
                disabled={disconnectMutation.isPending}
                data-testid="button-disconnect"
              >
                Disconnect
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card className="border-card-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Redirect URI</p>
            <p className="mt-1 break-all font-mono text-xs text-foreground" data-testid="text-redirect-uri">
              {redirectUri || "—"}
            </p>
            <p className="mt-1 text-xs">Add this exact URL in the Twitch Developer Console.</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Scopes requested</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {scopes.map((scope) => (
                <Badge key={scope} variant="outline" className="border-border/70 font-mono text-[10px] text-muted-foreground">
                  {scope}
                </Badge>
              ))}
            </div>
          </div>
          <div className="space-y-1.5 border-t border-border/60 pt-3">
            <p><span className="text-foreground">moderator:manage:banned_users</span> — timeout and ban.</p>
            <p><span className="text-foreground">moderator:manage:chat_messages</span> — delete messages (requires real EventSub message id).</p>
            <p><span className="text-foreground">user:read/write:chat</span> — bot-style command responses.</p>
          </div>
          <p className="text-xs">
            Delete needs a real Twitch <code>message_id</code> from EventSub or live chat. The demo queue uses placeholder ids and will return a clear error until EventSub ingestion lands.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function UserDrawer({
  selected,
  setSelected,
  onAction,
}: {
  selected: QueueItem | null;
  setSelected: (item: QueueItem | null) => void;
  onAction: (item: QueueItem, action: string) => void;
}) {
  return (
    <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
      <SheetContent className="w-full overflow-y-auto border-border bg-card sm:max-w-xl">
        {selected ? (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-primary" />
                {selected.user}
              </SheetTitle>
              <SheetDescription>{selected.reason}</SheetDescription>
            </SheetHeader>
            <div className="mt-6 space-y-5">
              <div className="rounded-xl border border-border bg-background/50 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Risk score</p>
                  <RiskBadge level={selected.level} risk={selected.risk} />
                </div>
                <p className="mt-3 text-sm text-muted-foreground">{selected.message}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground">History</p>
                  <p className="mt-1 text-sm font-medium">{selected.seenBefore}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground">Account age</p>
                  <p className="mt-1 text-sm font-medium">{selected.accountAge}</p>
                </div>
              </div>
              <div>
                <h3 className="text-sm font-semibold">Quick actions</h3>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <Button variant="secondary" onClick={() => onAction(selected, "timeout_60")} data-testid="drawer-timeout-60">
                    <TimerReset className="h-4 w-4" />
                    Timeout 60s
                  </Button>
                  <Button variant="secondary" onClick={() => onAction(selected, "timeout_600")} data-testid="drawer-timeout-600">
                    <Clock3 className="h-4 w-4" />
                    Timeout 10m
                  </Button>
                  <Button variant="outline" onClick={() => onAction(selected, "delete")} data-testid="drawer-delete">
                    <Trash2 className="h-4 w-4" />
                    Delete message
                  </Button>
                  <Button variant="destructive" onClick={() => onAction(selected, "ban")} data-testid="drawer-ban">
                    <Ban className="h-4 w-4" />
                    Ban user
                  </Button>
                </div>
              </div>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Dashboard() {
  const [active, setActive] = useState<ActiveSection>("overview");
  const [selected, setSelected] = useState<QueueItem | null>(null);
  const [resolvedIds, setResolvedIds] = useState<string[]>([]);
  const { toast } = useToast();

  const { data: status } = useQuery<Status>({ queryKey: ["/api/status"], refetchInterval: 8000 });
  const { data: twitchStatus } = useQuery<TwitchStatus>({ queryKey: ["/api/twitch/status"], refetchInterval: 12000 });
  const { data: queueData = [] } = useQuery<QueueItem[]>({ queryKey: ["/api/moderation/queue"], refetchInterval: 6000 });
  const { data: events = [] } = useQuery<ModerationEvent[]>({ queryKey: ["/api/moderation/events"] });
  const { data: commands = [] } = useQuery<ChatCommand[]>({ queryKey: ["/api/commands"] });

  const queue = useMemo(() => queueData.filter((item) => !resolvedIds.includes(item.id)), [queueData, resolvedIds]);

  const actionMutation = useMutation({
    mutationFn: async ({ item, action }: { item: QueueItem; action: string }) => {
      const response = await fetch("/api/moderation/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUser: item.user,
          action,
          reason: item.reason,
          messageId: item.id,
        }),
      });
      const body = await response.json().catch(() => ({}));
      return { ok: response.ok, status: response.status, body } as const;
    },
    onSuccess: ({ ok, body }, variables) => {
      const label = actionLabels[variables.action] ?? variables.action;
      const mode = (body as any)?.twitchMode as string | undefined;
      const summary = (body as any)?.twitchSummary as string | null;
      const errMsg = (body as any)?.twitchError as string | null;
      if (ok) {
        setResolvedIds((current) => Array.from(new Set([...current, variables.item.id])));
        setSelected(null);
        queryClient.invalidateQueries({ queryKey: ["/api/moderation/events"] });
        toast({
          title: `${label} ${mode === "live" ? "applied via Twitch" : "logged (demo)"}`,
          description:
            summary ??
            (mode === "live"
              ? `${variables.item.user} was handled live.`
              : `${variables.item.user} recorded in demo mode. Authorize and pick a channel for live calls.`),
        });
      } else {
        toast({
          title: `${label} failed`,
          description: errMsg ?? "Twitch API rejected this action.",
          variant: "destructive",
        });
        queryClient.invalidateQueries({ queryKey: ["/api/moderation/events"] });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Action failed", description: err.message, variant: "destructive" });
    },
  });

  const onAction = (item: QueueItem, action: string) => actionMutation.mutate({ item, action });

  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "17rem",
          "--sidebar-width-icon": "4rem",
        } as React.CSSProperties
      }
    >
      <div className="flex h-screen w-full bg-background command-grid">
        <AppSidebar active={active} setActive={setActive} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header active={active} status={status} />
          <main className="min-h-0 flex-1 overflow-y-auto p-5">
            {active === "overview" ? <Overview status={status} queue={queue} events={events} onSelect={setSelected} /> : null}
            {active === "queue" ? <QueueView queue={queue} onSelect={setSelected} onAction={onAction} /> : null}
            {active === "commands" ? <CommandsView commands={commands} /> : null}
            {active === "history" ? <HistoryView events={events} /> : null}
            {active === "connect" ? <ConnectView status={status} twitch={twitchStatus} /> : null}
          </main>
        </div>
        <UserDrawer selected={selected} setSelected={setSelected} onAction={onAction} />
      </div>
    </SidebarProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Dashboard />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
