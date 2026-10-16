import { createSignal, For, Show } from "solid-js"
import { Dialog } from "@kobalte/core/dialog"
import { Button, Icon, IconButton, Tooltip } from "@/ui"
import { useLMStudio } from "@/context"

export interface LMStudioDialogProps {
  open: boolean
  onClose: () => void
}

export function LMStudioDialog(props: LMStudioDialogProps) {
  const lmstudio = useLMStudio()
  const [ipInput, setIpInput] = createSignal("")
  const [nameInput, setNameInput] = createSignal("")
  const [submitting, setSubmitting] = createSignal(false)
  const [feedback, setFeedback] = createSignal<{ type: "ok" | "err"; text: string } | undefined>(undefined)

  const handleAddServer = async (e: SubmitEvent) => {
    e.preventDefault()
    const rawIp = ipInput().trim()
    if (!rawIp) return

    setSubmitting(true)
    setFeedback(undefined)
    try {
      const res = await lmstudio.addServer(rawIp, nameInput().trim() || undefined)
      const srv = res.server
      if (res.ok && srv) {
        setFeedback({
          type: "ok",
          text: `Connected to ${srv.ip}:${srv.port} (${srv.models.length} model${srv.models.length === 1 ? "" : "s"} detected, ${srv.latencyMs ?? 0}ms)`,
        })
        setIpInput("")
        setNameInput("")
      } else {
        setFeedback({
          type: "err",
          text: `Added ${srv?.ip ?? rawIp}:${srv?.port ?? 1234}, but connection failed: ${res.error ?? "Server unreachable (check LM Studio Local Server & CORS)"}`,
        })
      }
    } catch (err) {
      setFeedback({
        type: "err",
        text: err instanceof Error ? err.message : "Invalid IP address",
      })
    } finally {
      setSubmitting(false)
    }
  }

  const quickConnect = async (ip: string, label: string) => {
    setIpInput(ip)
    setNameInput(label)
    setSubmitting(true)
    setFeedback(undefined)
    try {
      const res = await lmstudio.addServer(ip, label)
      const srv = res.server
      if (res.ok && srv) {
        setFeedback({
          type: "ok",
          text: `Connected to ${srv.name} (${srv.models.length} models, ${srv.latencyMs ?? 0}ms)`,
        })
        setIpInput("")
        setNameInput("")
      } else {
        setFeedback({
          type: "err",
          text: `Saved ${srv?.ip ?? ip}:${srv?.port ?? 1234} — currently offline (${res.error ?? "check port 1234"})`,
        })
      }
    } finally {
      setSubmitting(false)
    }
  }

  const topo = () => lmstudio.topology()

  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()} modal>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs" />
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
          <Dialog.Content
            class="w-full max-w-3xl max-h-[88vh] flex flex-col rounded-xl bg-background-panel
                   border border-border-subtle/60 shadow-2xl overflow-hidden text-text"
          >
            {/* Header */}
            <div class="flex items-center justify-between px-5 py-3.5 border-b border-border-subtle/50 bg-background/60">
              <div class="flex items-center gap-2.5">
                <div class="p-1.5 rounded-lg bg-primary/15 text-primary">
                  <Icon name="cpu" size={18} />
                </div>
                <div>
                  <Dialog.Title class="text-sm font-semibold text-text flex items-center gap-2">
                    LM Studio Multi-Server Cluster
                    <span class="px-2 py-0.5 text-[10px] font-mono uppercase rounded-full bg-accent/15 text-accent border border-accent/30">
                      Auto Master ⇄ Worker
                    </span>
                  </Dialog.Title>
                  <p class="text-xs text-text-muted">
                    Add one or more LM Studio IPs. Roles (Master Architect & Worker Agent) are profiled and assigned automatically.
                  </p>
                </div>
              </div>
              <div class="flex items-center gap-1.5">
                <Tooltip value="Refresh all servers" placement="bottom">
                  <IconButton
                    size="xs"
                    variant="ghost"
                    class="text-text-muted hover:text-text"
                    onClick={() => lmstudio.refreshAllServers()}
                  >
                    <Icon name="refresh" size={15} />
                  </IconButton>
                </Tooltip>
                <IconButton
                  size="xs"
                  variant="ghost"
                  class="text-text-muted hover:text-text"
                  onClick={props.onClose}
                >
                  <Icon name="close" size={16} />
                </IconButton>
              </div>
            </div>

            {/* Body */}
            <div class="flex-1 overflow-y-auto p-5 space-y-5">
              {/* 1. Direct IP Connect Form */}
              <form
                onSubmit={handleAddServer}
                class="p-3.5 rounded-lg bg-background border border-border-subtle/60 space-y-3"
              >
                <div class="flex items-center justify-between">
                  <label class="text-xs font-medium text-text flex items-center gap-1.5">
                    <Icon name="globe" size={14} class="text-primary" />
                    Direct IP Connection (Port defaults to 1234)
                  </label>
                  <div class="flex items-center gap-1.5 text-[11px] text-text-muted">
                    <span>Quick add:</span>
                    <button
                      type="button"
                      onClick={() => quickConnect("127.0.0.1:1234", "Local LM Studio")}
                      class="px-2 py-0.5 rounded bg-background-panel hover:bg-background-element text-text-muted hover:text-text border border-border-subtle/40 cursor-pointer transition-colors"
                    >
                      127.0.0.1
                    </button>
                    <button
                      type="button"
                      onClick={() => quickConnect("192.168.1.34:1234", "AsusOGY Node")}
                      class="px-2 py-0.5 rounded bg-background-panel hover:bg-background-element text-text-muted hover:text-text border border-border-subtle/40 cursor-pointer transition-colors"
                    >
                      192.168.1.34
                    </button>
                  </div>
                </div>

                <div class="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={ipInput()}
                    onInput={(e) => setIpInput(e.currentTarget.value)}
                    placeholder="IP Address (e.g. 192.168.0.25 or 192.168.1.34:1234)"
                    class="flex-1 px-3 py-1.5 rounded-md bg-background-panel border border-border-subtle/60
                           text-xs text-text placeholder-text-muted/50 focus:outline-none focus:border-primary font-mono"
                  />
                  <input
                    type="text"
                    value={nameInput()}
                    onInput={(e) => setNameInput(e.currentTarget.value)}
                    placeholder="Optional Label (e.g. GPU Rig 1)"
                    class="sm:w-44 px-3 py-1.5 rounded-md bg-background-panel border border-border-subtle/60
                           text-xs text-text placeholder-text-muted/50 focus:outline-none focus:border-primary"
                  />
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    disabled={submitting() || !ipInput().trim()}
                    class="shrink-0 px-4 cursor-pointer"
                  >
                    <Show when={submitting()} fallback={<Icon name="bolt" size={14} />}>
                      <Icon name="loading" size={14} class="animate-spin" />
                    </Show>
                    <span>{submitting() ? "Connecting..." : "Connect IP"}</span>
                  </Button>
                </div>

                <Show when={feedback()}>
                  {(msg) => (
                    <div
                      classList={{
                        "text-xs px-2.5 py-1.5 rounded flex items-center gap-2": true,
                        "bg-success/15 text-success border border-success/30": msg().type === "ok",
                        "bg-error/15 text-error border border-error/30": msg().type === "err",
                      }}
                    >
                      <Icon name={msg().type === "ok" ? "check-circle" : "warning"} size={14} />
                      <span>{msg().text}</span>
                    </div>
                  )}
                </Show>
              </form>

              {/* 2. Autonomous Master ⇄ Worker Topology Card */}
              <div class="p-4 rounded-lg bg-background border border-border-subtle/60 space-y-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="flex items-center gap-2">
                    <Icon name="sparkles" size={15} class="text-accent" />
                    <span class="text-xs font-semibold uppercase tracking-wider text-text">
                      Autonomous Orchestration Topology
                    </span>
                    <span
                      classList={{
                        "px-2 py-0.5 text-[10px] rounded-full font-mono uppercase": true,
                        "bg-success/15 text-success border border-success/30": topo().mode === "dual-multi-server",
                        "bg-primary/15 text-primary border border-primary/30": topo().mode === "dual-same-server",
                        "bg-text-muted/15 text-text-muted": topo().mode === "single" || topo().mode === "none",
                      }}
                    >
                      {topo().mode === "dual-multi-server"
                        ? "Multi-Server Parallel Cluster"
                        : topo().mode === "dual-same-server"
                          ? "Multi-Model Pipeline"
                          : topo().mode === "single"
                            ? "Single Node Direct"
                            : "Waiting for Online Server"}
                    </span>
                  </div>

                  {/* Autonomous Mode Toggles */}
                  <div class="flex items-center gap-3 text-xs">
                    <label class="flex items-center gap-1.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={lmstudio.store.autonomousMode}
                        onChange={(e) => lmstudio.setStore("autonomousMode", e.currentTarget.checked)}
                        class="accent-primary rounded cursor-pointer"
                      />
                      <span class="text-text-muted hover:text-text">Auto Master ⇄ Worker</span>
                    </label>
                    <label class="flex items-center gap-1.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={lmstudio.store.autoReview}
                        onChange={(e) => lmstudio.setStore("autoReview", e.currentTarget.checked)}
                        class="accent-primary rounded cursor-pointer"
                      />
                      <span class="text-text-muted hover:text-text">Master Final Synthesis</span>
                    </label>
                  </div>
                </div>

                <p class="text-xs text-text-muted/90">{topo().explanation}</p>

                <Show when={topo().master}>
                  {(master) => (
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                      {/* Master Card */}
                      <div class="p-3 rounded-lg bg-background-panel border border-accent/30 flex flex-col justify-between gap-2">
                        <div class="flex items-center justify-between">
                          <span class="text-[11px] font-semibold uppercase tracking-wide text-accent flex items-center gap-1.5">
                            <Icon name="brain" size={14} />
                            Master (Architect & Planner)
                          </span>
                          <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent/10 text-accent">
                            Score {master().model.masterScore}
                          </span>
                        </div>
                        <div>
                          <div class="text-xs font-medium text-text truncate">{master().model.name}</div>
                          <div class="text-[11px] text-text-muted font-mono flex items-center gap-2 mt-0.5">
                            <span>
                              {master().server.ip}:{master().server.port}
                            </span>
                            <span>•</span>
                            <span>{master().model.paramB}B params</span>
                            <Show when={master().model.isReasoning}>
                              <span class="text-accent">• Reasoning</span>
                            </Show>
                          </div>
                        </div>
                        <div class="text-[11px] text-text-muted/70 border-t border-border-subtle/30 pt-1.5">
                          Analyzes user request, designs architecture, decides subtasks automatically, and reviews final output.
                        </div>
                      </div>

                      {/* Worker Card */}
                      <div class="p-3 rounded-lg bg-background-panel border border-primary/30 flex flex-col justify-between gap-2">
                        <div class="flex items-center justify-between">
                          <span class="text-[11px] font-semibold uppercase tracking-wide text-primary flex items-center gap-1.5">
                            <Icon name="hammer" size={14} />
                            Agent Worker (Code & Execution)
                          </span>
                          <Show when={topo().worker}>
                            {(worker) => (
                              <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                                Score {worker().model.workerScore}
                              </span>
                            )}
                          </Show>
                        </div>
                        <Show
                          when={topo().worker}
                          fallback={
                            <div class="text-xs text-text-muted italic">
                              Add a second LM Studio server IP (or load a second model) to enable dedicated Worker offload.
                            </div>
                          }
                        >
                          {(worker) => (
                            <>
                              <div>
                                <div class="text-xs font-medium text-text truncate">{worker().model.name}</div>
                                <div class="text-[11px] text-text-muted font-mono flex items-center gap-2 mt-0.5">
                                  <span>
                                    {worker().server.ip}:{worker().server.port}
                                  </span>
                                  <span>•</span>
                                  <span>{worker().model.paramB}B params</span>
                                  <Show when={worker().model.isCoder}>
                                    <span class="text-primary">• Coder Spec</span>
                                  </Show>
                                </div>
                              </div>
                              <div class="text-[11px] text-text-muted/70 border-t border-border-subtle/30 pt-1.5">
                                Executes delegated coding & implementation tasks from Master in parallel across {topo().workerPool.length} worker node(s).
                              </div>
                            </>
                          )}
                        </Show>
                      </div>
                    </div>
                  )}
                </Show>
              </div>

              {/* 3. Connected Servers List */}
              <div class="space-y-2.5">
                <div class="flex items-center justify-between">
                  <h3 class="text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Configured LM Studio Nodes ({lmstudio.store.servers.length})
                  </h3>
                </div>

                <Show
                  when={lmstudio.store.servers.length > 0}
                  fallback={
                    <div class="p-8 rounded-lg border border-dashed border-border-subtle/60 text-center space-y-2">
                      <Icon name="devices" size={24} class="mx-auto text-text-muted/50" />
                      <div class="text-xs text-text-muted">
                        No LM Studio servers added yet. Enter an IP address above (e.g.{" "}
                        <code class="text-text font-mono">127.0.0.1</code> or{" "}
                        <code class="text-text font-mono">192.168.1.34</code>) to connect directly.
                      </div>
                    </div>
                  }
                >
                  <div class="space-y-2.5">
                    <For each={lmstudio.store.servers}>
                      {(server) => (
                        <div
                          classList={{
                            "p-3.5 rounded-lg border transition-colors": true,
                            "bg-background border-border-subtle/60": server.enabled,
                            "bg-background/40 border-border-subtle/30 opacity-60": !server.enabled,
                          }}
                        >
                          <div class="flex items-center justify-between gap-2">
                            <div class="flex items-center gap-2.5 min-w-0">
                              <span
                                classList={{
                                  "size-2.5 rounded-full shrink-0": true,
                                  "bg-success shadow-[0_0_8px_rgba(34,197,94,0.6)]": server.status === "online",
                                  "bg-error": server.status === "offline",
                                  "bg-accent animate-pulse": server.status === "checking",
                                }}
                              />
                              <span class="text-xs font-semibold text-text truncate">{server.name}</span>
                              <span class="text-xs font-mono text-text-muted px-2 py-0.5 rounded bg-background-panel border border-border-subtle/40">
                                {server.ip}:{server.port}
                              </span>
                              <Show when={server.status === "online" && server.latencyMs !== undefined}>
                                <span class="text-[11px] font-mono text-success/80">{server.latencyMs}ms</span>
                              </Show>
                              <Show when={server.status === "offline" && server.error}>
                                <span class="text-[11px] text-error truncate">({server.error})</span>
                              </Show>
                            </div>

                            <div class="flex items-center gap-1 shrink-0">
                              <Tooltip value={server.enabled ? "Disable node" : "Enable node"} placement="top">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => lmstudio.toggleServer(server.id)}
                                  class="text-[11px] cursor-pointer"
                                >
                                  {server.enabled ? "Enabled" : "Disabled"}
                                </Button>
                              </Tooltip>
                              <Tooltip value="Re-probe server" placement="top">
                                <IconButton
                                  size="xs"
                                  variant="ghost"
                                  onClick={() => lmstudio.probeServer(server.id)}
                                  class="text-text-muted hover:text-text"
                                >
                                  <Icon
                                    name="refresh"
                                    size={14}
                                    classList={{ "animate-spin": server.status === "checking" }}
                                  />
                                </IconButton>
                              </Tooltip>
                              <Tooltip value="Remove server" placement="top">
                                <IconButton
                                  size="xs"
                                  variant="ghost"
                                  onClick={() => lmstudio.removeServer(server.id)}
                                  class="text-text-muted hover:text-error"
                                >
                                  <Icon name="trash" size={14} />
                                </IconButton>
                              </Tooltip>
                            </div>
                          </div>

                          {/* Models inside this server */}
                          <Show when={server.models.length > 0}>
                            <div class="mt-3 pt-2.5 border-t border-border-subtle/30 flex flex-wrap gap-1.5">
                              <For each={server.models}>
                                {(m) => {
                                  const isMaster = () =>
                                    topo().master?.model.id === m.id && topo().master?.server.id === server.id
                                  const isWorker = () =>
                                    topo().worker?.model.id === m.id && topo().worker?.server.id === server.id
                                  return (
                                    <div
                                      classList={{
                                        "px-2.5 py-1 rounded-md text-xs flex items-center gap-1.5 border": true,
                                        "bg-accent/10 border-accent/40 text-text": isMaster(),
                                        "bg-primary/10 border-primary/40 text-text": !isMaster() && isWorker(),
                                        "bg-background-panel border-border-subtle/40 text-text-muted":
                                          !isMaster() && !isWorker(),
                                      }}
                                    >
                                      <Show when={isMaster()}>
                                        <span class="text-[10px] font-bold uppercase px-1 rounded bg-accent text-background">
                                          MASTER
                                        </span>
                                      </Show>
                                      <Show when={!isMaster() && isWorker()}>
                                        <span class="text-[10px] font-bold uppercase px-1 rounded bg-primary text-background">
                                          AGENT
                                        </span>
                                      </Show>
                                      <span class="font-mono text-[11px] text-text">{m.id}</span>
                                      <span class="text-[10px] text-text-muted/80">({m.paramB}B)</span>
                                      <Show when={m.isReasoning}>
                                        <span class="text-[10px] text-accent" title="Reasoning capability">
                                          🧠
                                        </span>
                                      </Show>
                                      <Show when={m.isCoder}>
                                        <span class="text-[10px] text-primary" title="Coding specialist">
                                          💻
                                        </span>
                                      </Show>
                                      <Show when={m.isLoaded}>
                                        <span
                                          class="size-1.5 rounded-full bg-success"
                                          title="Loaded in GPU VRAM"
                                        />
                                      </Show>
                                    </div>
                                  )
                                }}
                              </For>
                            </div>
                          </Show>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </div>

            {/* Footer */}
            <div class="px-5 py-3 border-t border-border-subtle/50 bg-background/60 flex items-center justify-between text-xs text-text-muted">
              <div class="flex items-center gap-2">
                <Icon name="info" size={14} class="text-primary" />
                <span>
                  Tip: Enable <strong class="text-text">CORS</strong> and{" "}
                  <strong class="text-text">Serve on Local Network (0.0.0.0)</strong> in LM Studio Developer tab.
                </span>
              </div>
              <Button variant="primary" size="sm" onClick={props.onClose} class="cursor-pointer">
                Done
              </Button>
            </div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog>
  )
}
