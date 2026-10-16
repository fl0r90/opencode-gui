import { createContext, createEffect, createMemo, onCleanup, onMount, useContext, type ParentProps } from "solid-js"
import { createStore, produce } from "solid-js/store"
import type { Provider, Model, Part, Message } from "@opencode-ai/sdk"
import { useSync } from "./sync"

export interface LMStudioModelInfo {
  id: string
  name: string
  serverId: string
  serverIp: string
  serverPort: number
  paramB: number
  quantization?: string
  arch?: string
  contextLength: number
  isLoaded: boolean
  isReasoning: boolean
  isCoder: boolean
  masterScore: number
  workerScore: number
  autoRole: "master" | "worker" | "balanced"
}

export interface LMStudioServer {
  id: string
  name: string
  ip: string
  port: number
  baseUrl: string
  enabled: boolean
  status: "online" | "offline" | "checking"
  latencyMs?: number
  lastChecked?: number
  error?: string
  models: LMStudioModelInfo[]
}

export interface RoleAssignment {
  server: LMStudioServer
  model: LMStudioModelInfo
}

export interface DelegationStep {
  id: string
  phase: "master-plan" | "worker-exec" | "master-review" | "single-node"
  role: "master" | "worker"
  serverIp: string
  modelId: string
  title: string
  status: "running" | "completed" | "error"
  startedAt: number
  completedAt?: number
}

const STORAGE_KEY_SERVERS = "opencode_lmstudio_servers_v1"
const STORAGE_KEY_CONFIG = "opencode_lmstudio_orchestrator_v1"

export function parseEndpointInput(rawInput: string, defaultPort = 1234): { ip: string; port: number; baseUrl: string } {
  let cleaned = rawInput.trim()
  if (!cleaned) {
    return { ip: "127.0.0.1", port: defaultPort, baseUrl: `http://127.0.0.1:${defaultPort}` }
  }
  cleaned = cleaned.replace(/^https?:\/\//i, "").replace(/\/v1\/?.*$/i, "").replace(/\/+$/, "")

  let ip = cleaned
  let port = defaultPort

  if (cleaned.includes(":")) {
    const parts = cleaned.split(":")
    ip = parts[0] || "127.0.0.1"
    const parsedPort = parseInt(parts[1], 10)
    if (!Number.isNaN(parsedPort) && parsedPort > 0 && parsedPort <= 65535) {
      port = parsedPort
    }
  }

  return {
    ip,
    port,
    baseUrl: `http://${ip}:${port}`,
  }
}

export function profileModel(
  modelId: string,
  serverId: string,
  serverIp: string,
  serverPort: number,
  latencyMs = 50,
  rawMeta?: any,
): LMStudioModelInfo {
  const lower = modelId.toLowerCase()

  // Extract parameter count in billions (e.g. 70b, 32b, 27b, 14b, 8b, 7b, 4b, 3b, 1.5b)
  let paramB = 8
  const moeMatch = lower.match(/(\d+)x(\d+(?:\.\d+)?)b/)
  const stdMatch = lower.match(/(?:^|[-_/:\s])(\d+(?:\.\d+)?)b(?:[-_/\s:]|$)/)
  if (moeMatch) {
    paramB = parseFloat(moeMatch[1]) * parseFloat(moeMatch[2]) * 0.75
  } else if (stdMatch) {
    paramB = parseFloat(stdMatch[1])
  } else if (lower.includes("large")) {
    paramB = 32
  } else if (lower.includes("medium")) {
    paramB = 14
  } else if (lower.includes("small") || lower.includes("mini") || lower.includes("nano")) {
    paramB = 4
  }

  const isReasoning =
    /(\br1\b|qwq|think|reasoning|\bo1\b|\bo3\b|qwen3|deepseek-r1|sky-t1|nemotron|opus|sonnet|pro)/i.test(lower) ||
    paramB >= 27

  const isCoder =
    /(coder|codestral|starcoder|devstral|code|qwen2\.5-coder|deepseek-coder|granite.*code)/i.test(lower)

  const isLoaded = rawMeta?.state === "loaded" || rawMeta?.loaded === true
  const contextLength = Number(rawMeta?.max_context_length || rawMeta?.context_length || (paramB >= 14 ? 32768 : 16384))
  const quantization = rawMeta?.quantization || (lower.match(/(q[2-8]_[0-9a-z_]+|fp16|bf16|int[48]|awq|gptq)/i)?.[1]?.toUpperCase())
  const arch = rawMeta?.arch || rawMeta?.architecture || undefined

  // Compute autonomous suitability scores
  let masterScore = paramB * 10
  if (isReasoning) masterScore += 120
  if (paramB >= 20) masterScore += 60
  if (isCoder) masterScore += 25
  if (isLoaded) masterScore += 35
  masterScore += Math.min(40, Math.round(contextLength / 4096))

  let workerScore = isCoder ? 160 : 90
  if (paramB >= 4 && paramB <= 16) {
    workerScore += 75 // Sweet spot for high-speed code generation & tool execution
  } else if (paramB > 16 && paramB <= 32) {
    workerScore += 40
  } else if (paramB < 4) {
    workerScore += 20
  }
  if (isLoaded) workerScore += 45
  workerScore += Math.max(0, Math.round(50 - latencyMs / 10))

  const autoRole: "master" | "worker" | "balanced" =
    masterScore > workerScore + 40 ? "master" : workerScore > masterScore + 20 ? "worker" : "balanced"

  const friendlyName = modelId
    .split("/")
    .pop()!
    .replace(/[-_]/g, " ")

  return {
    id: modelId,
    name: friendlyName,
    serverId,
    serverIp,
    serverPort,
    paramB,
    quantization,
    arch,
    contextLength,
    isLoaded,
    isReasoning,
    isCoder,
    masterScore,
    workerScore,
    autoRole,
  }
}

function isEmbeddingModel(modelId: string, rawMeta?: any): boolean {
  if (rawMeta?.type === "embeddings" || rawMeta?.type === "embedding") return true
  return /(embed|embedding|bge-|nomic-embed|e5-|gte-)/i.test(modelId)
}

function init() {
  const sync = useSync()

  const [store, setStore] = createStore<{
    servers: LMStudioServer[]
    autonomousMode: boolean
    parallelWorkers: boolean
    autoReview: boolean
    preferredMasterServerId?: string
    preferredMasterModelId?: string
    preferredWorkerServerId?: string
    preferredWorkerModelId?: string
    activeSteps: Record<string, DelegationStep[]>
    dialogOpen: boolean
    isScanningSubnet: boolean
  }>({
    servers: [],
    autonomousMode: true,
    parallelWorkers: true,
    autoReview: true,
    activeSteps: {},
    dialogOpen: false,
    isScanningSubnet: false,
  })

  // Load saved servers & config from localStorage
  try {
    const savedServers = localStorage.getItem(STORAGE_KEY_SERVERS)
    if (savedServers) {
      const parsed = JSON.parse(savedServers) as LMStudioServer[]
      if (Array.isArray(parsed) && parsed.length > 0) {
        setStore("servers", parsed)
      }
    }
    const savedCfg = localStorage.getItem(STORAGE_KEY_CONFIG)
    if (savedCfg) {
      const cfg = JSON.parse(savedCfg)
      if (typeof cfg.autonomousMode === "boolean") setStore("autonomousMode", cfg.autonomousMode)
      if (typeof cfg.parallelWorkers === "boolean") setStore("parallelWorkers", cfg.parallelWorkers)
      if (typeof cfg.autoReview === "boolean") setStore("autoReview", cfg.autoReview)
      if (cfg.preferredMasterServerId) setStore("preferredMasterServerId", cfg.preferredMasterServerId)
      if (cfg.preferredMasterModelId) setStore("preferredMasterModelId", cfg.preferredMasterModelId)
      if (cfg.preferredWorkerServerId) setStore("preferredWorkerServerId", cfg.preferredWorkerServerId)
      if (cfg.preferredWorkerModelId) setStore("preferredWorkerModelId", cfg.preferredWorkerModelId)
    }
  } catch (e) {
    console.warn("Failed to load LM Studio settings from localStorage:", e)
  }

  // Persist changes
  createEffect(() => {
    const serialized = JSON.stringify(
      store.servers.map((s) => ({
        ...s,
        status: s.status === "checking" ? "offline" : s.status,
      })),
    )
    localStorage.setItem(STORAGE_KEY_SERVERS, serialized)
  })

  createEffect(() => {
    localStorage.setItem(
      STORAGE_KEY_CONFIG,
      JSON.stringify({
        autonomousMode: store.autonomousMode,
        parallelWorkers: store.parallelWorkers,
        autoReview: store.autoReview,
        preferredMasterServerId: store.preferredMasterServerId,
        preferredMasterModelId: store.preferredMasterModelId,
        preferredWorkerServerId: store.preferredWorkerServerId,
        preferredWorkerModelId: store.preferredWorkerModelId,
      }),
    )
  })

  // Sync discovered LM Studio servers into OpenCode's provider store so native model selectors also see them
  const syncProvidersToApp = () => {
    const lmProviders: Provider[] = store.servers
      .filter((s) => s.enabled && s.models.length > 0)
      .map((s) => {
        const modelsMap: { [key: string]: Model } = {}
        for (const m of s.models) {
          modelsMap[m.id] = {
            id: m.id,
            name: `${m.id} (${m.paramB}B · ${s.ip})`,
            release_date: "2025-01-01",
            attachment: false,
            reasoning: m.isReasoning,
            temperature: true,
            tool_call: true,
            cost: { input: 0, output: 0 },
            limit: { context: m.contextLength, output: 8192 },
            options: { baseURL: `${s.baseUrl}/v1` },
          }
        }
        return {
          id: s.id,
          name: `${s.name} (${s.ip}:${s.port})`,
          env: [],
          models: modelsMap,
        }
      })

    const existingNonLm = sync.data.provider.filter((p) => !p.id.startsWith("lms-"))
    sync.set("provider", [...lmProviders, ...existingNonLm])
  }

  createEffect(() => {
    // Trigger provider sync whenever servers or their models update
    store.servers.map((s) => s.models.length + (s.enabled ? 1 : 0) + (s.status === "online" ? 1 : 0))
    syncProvidersToApp()
  })

  const probeServer = async (serverId: string): Promise<boolean> => {
    const idx = store.servers.findIndex((s) => s.id === serverId)
    if (idx === -1) return false
    const srv = store.servers[idx]

    setStore("servers", idx, "status", "checking")
    setStore("servers", idx, "error", undefined)

    const t0 = performance.now()
    let rawModels: any[] = []
    let richMetaMap: Record<string, any> = {}

    try {
      // Try LM Studio native API v0 first for rich metadata (state, quantization, max_context_length)
      try {
        const ctrl0 = new AbortController()
        const timer0 = setTimeout(() => ctrl0.abort(), 3500)
        const r0 = await fetch(`${srv.baseUrl}/api/v0/models`, { signal: ctrl0.signal })
        clearTimeout(timer0)
        if (r0.ok) {
          const d0 = await r0.json()
          const list0 = Array.isArray(d0?.data) ? d0.data : Array.isArray(d0) ? d0 : []
          for (const item of list0) {
            if (item?.id) richMetaMap[item.id] = item
          }
          if (list0.length > 0) rawModels = list0
        }
      } catch {
        // Fallback to standard /v1/models
      }

      if (rawModels.length === 0) {
        const ctrl1 = new AbortController()
        const timer1 = setTimeout(() => ctrl1.abort(), 4500)
        const r1 = await fetch(`${srv.baseUrl}/v1/models`, { signal: ctrl1.signal })
        clearTimeout(timer1)
        if (!r1.ok) {
          throw new Error(`HTTP ${r1.status}: ${r1.statusText}`)
        }
        const d1 = await r1.json()
        rawModels = Array.isArray(d1?.data) ? d1.data : Array.isArray(d1) ? d1 : []
      }

      const latencyMs = Math.round(performance.now() - t0)
      const chatModels = rawModels
        .filter((m) => m?.id && !isEmbeddingModel(m.id, richMetaMap[m.id] ?? m))
        .map((m) => profileModel(m.id, srv.id, srv.ip, srv.port, latencyMs, richMetaMap[m.id] ?? m))
        .sort((a, b) => b.masterScore - a.masterScore)

      setStore(
        "servers",
        idx,
        produce((draft) => {
          draft.status = "online"
          draft.latencyMs = latencyMs
          draft.lastChecked = Date.now()
          draft.error = undefined
          draft.models = chatModels
        }),
      )
      syncProvidersToApp()
      return true
    } catch (err: any) {
      setStore(
        "servers",
        idx,
        produce((draft) => {
          draft.status = "offline"
          draft.lastChecked = Date.now()
          draft.error = err?.name === "AbortError" ? "Connection timeout (check IP & LM Studio CORS/Server)" : String(err?.message || err)
        }),
      )
      return false
    }
  }

  const addServer = async (rawAddress: string, customName?: string): Promise<{ ok: boolean; error?: string; server?: LMStudioServer }> => {
    const { ip, port, baseUrl } = parseEndpointInput(rawAddress)
    const id = `lms-${ip.replace(/[^a-zA-Z0-9]/g, "-")}-${port}`

    const existingIdx = store.servers.findIndex((s) => s.id === id)
    if (existingIdx !== -1) {
      const ok = await probeServer(id)
      return {
        ok,
        error: ok ? undefined : store.servers[existingIdx].error,
        server: store.servers[existingIdx],
      }
    }

    const newServer: LMStudioServer = {
      id,
      name: customName?.trim() || `LM Studio @ ${ip}`,
      ip,
      port,
      baseUrl,
      enabled: true,
      status: "checking",
      models: [],
    }

    setStore("servers", (prev) => [...prev, newServer])
    const ok = await probeServer(id)
    const updated = store.servers.find((s) => s.id === id)
    return {
      ok,
      error: ok ? undefined : updated?.error,
      server: updated,
    }
  }

  const removeServer = (serverId: string) => {
    setStore("servers", (prev) => prev.filter((s) => s.id !== serverId))
    syncProvidersToApp()
  }

  const toggleServer = (serverId: string) => {
    const idx = store.servers.findIndex((s) => s.id === serverId)
    if (idx === -1) return
    setStore("servers", idx, "enabled", (v) => !v)
    syncProvidersToApp()
  }

  const refreshAllServers = async () => {
    await Promise.all(store.servers.map((s) => probeServer(s.id)))
  }

  // Quick discovery for common local/LAN IPs if requested
  const scanQuickTargets = async (ips: string[]) => {
    setStore("isScanningSubnet", true)
    try {
      await Promise.all(
        ips.map(async (ip) => {
          const { baseUrl } = parseEndpointInput(ip)
          try {
            const ctrl = new AbortController()
            const timer = setTimeout(() => ctrl.abort(), 1500)
            const res = await fetch(`${baseUrl}/v1/models`, { signal: ctrl.signal })
            clearTimeout(timer)
            if (res.ok) {
              await addServer(ip)
            }
          } catch {
            // ignore unreachable host
          }
        }),
      )
    } finally {
      setStore("isScanningSubnet", false)
    }
  }

  // Online active servers & models
  const onlineServers = createMemo(() =>
    store.servers.filter((s) => s.enabled && s.status === "online" && s.models.length > 0),
  )

  const allOnlineModels = createMemo(() =>
    onlineServers().flatMap((s) => s.models.map((m) => ({ server: s, model: m }))),
  )

  // Autonomous Election of Master & Worker(s)
  const topology = createMemo<{
    mode: "none" | "single" | "dual-multi-server" | "dual-same-server"
    master?: RoleAssignment
    worker?: RoleAssignment
    workerPool: RoleAssignment[]
    explanation: string
  }>(() => {
    const candidates = allOnlineModels()
    if (candidates.length === 0) {
      return {
        mode: "none",
        workerPool: [],
        explanation: "No online LM Studio servers connected. Add an IP address to start.",
      }
    }

    // 1. Elect Master (Architect / Planner / Reviewer)
    let master = candidates.find(
      (c) =>
        store.preferredMasterServerId === c.server.id &&
        (!store.preferredMasterModelId || store.preferredMasterModelId === c.model.id),
    )

    if (!master) {
      const sortedForMaster = [...candidates].sort((a, b) => b.model.masterScore - a.model.masterScore)
      master = sortedForMaster[0]
    }

    // 2. Elect Worker (Coder / Executor)
    const serversCount = onlineServers().length

    // Check explicit preference first
    let worker = candidates.find(
      (c) =>
        store.preferredWorkerServerId === c.server.id &&
        (!store.preferredWorkerModelId || store.preferredWorkerModelId === c.model.id),
    )

    if (!worker) {
      if (serversCount >= 2) {
        // Strongly prefer a different physical LM Studio server so both GPUs execute in tandem
        const otherServerCandidates = candidates
          .filter((c) => c.server.id !== master!.server.id)
          .sort((a, b) => b.model.workerScore - a.model.workerScore)
        if (otherServerCandidates.length > 0) {
          worker = otherServerCandidates[0]
        }
      }

      if (!worker) {
        // Same server, different model if available
        const otherModelCandidates = candidates
          .filter((c) => c.model.id !== master!.model.id || c.server.id !== master!.server.id)
          .sort((a, b) => b.model.workerScore - a.model.workerScore)
        worker = otherModelCandidates[0] ?? master
      }
    }

    // Build pool of all worker nodes on secondary servers (or fallback to primary worker)
    const secondaryServerWorkers = candidates
      .filter((c) => c.server.id !== master!.server.id)
      .sort((a, b) => b.model.workerScore - a.model.workerScore)

    const workerPool = secondaryServerWorkers.length > 0 ? secondaryServerWorkers : [worker]

    if (master.server.id !== worker.server.id) {
      return {
        mode: "dual-multi-server",
        master,
        worker,
        workerPool,
        explanation: `Autonomous Multi-Server Active: Master [${master.model.name} @ ${master.server.ip}] orchestrates & reviews · Worker [${worker.model.name} @ ${worker.server.ip}] executes code & subtasks.`,
      }
    }

    if (master.model.id !== worker.model.id) {
      return {
        mode: "dual-same-server",
        master,
        worker,
        workerPool,
        explanation: `Autonomous Dual-Model on ${master.server.ip}: Master [${master.model.name}] plans & reviews · Worker [${worker.model.name}] implements.`,
      }
    }

    return {
      mode: "single",
      master,
      worker: master,
      workerPool: [master],
      explanation: `Single LM Studio Node Active [${master.model.name} @ ${master.server.ip}]. Add a second IP for multi-server Master ⇄ Worker parallel orchestration.`,
    }
  })

  // Low-level streaming call to an LM Studio OpenAI-compatible /v1/chat/completions endpoint
  const streamChatCompletion = async (options: {
    server: LMStudioServer
    modelId: string
    messages: { role: "system" | "user" | "assistant"; content: string }[]
    temperature?: number
    onDelta: (textDelta: string, reasoningDelta: string) => void
  }): Promise<{ content: string; reasoning: string }> => {
    const res = await fetch(`${options.server.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: options.modelId,
        messages: options.messages,
        temperature: options.temperature ?? 0.2,
        stream: true,
      }),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText)
      throw new Error(`LM Studio (${options.server.ip}) HTTP ${res.status}: ${errText}`)
    }

    if (!res.body) {
      const data = await res.json()
      const msg = data?.choices?.[0]?.message
      const content = msg?.content ?? ""
      const reasoning = msg?.reasoning_content ?? ""
      options.onDelta(content, reasoning)
      return { content, reasoning }
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let fullRaw = ""
    let fullReasoning = ""
    let inThinkTag = false

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line.startsWith("data:")) continue
        const payload = line.slice(5).trim()
        if (payload === "[DONE]") continue

        try {
          const parsed = JSON.parse(payload)
          const delta = parsed?.choices?.[0]?.delta
          if (!delta) continue

          const rChunk: string = delta.reasoning_content || delta.reasoning || ""
          let cChunk: string = delta.content || ""

          if (rChunk) {
            fullReasoning += rChunk
            options.onDelta("", rChunk)
          }

          if (cChunk) {
            // Automatically separate <think>...</think> blocks emitted by Qwen3 / DeepSeek R1 models
            fullRaw += cChunk
            if (cChunk.includes("<think>")) {
              inThinkTag = true
              cChunk = cChunk.replace("<think>", "")
            }
            if (inThinkTag) {
              if (cChunk.includes("</think>")) {
                const [thinkPart, restPart] = cChunk.split("</think>")
                if (thinkPart) {
                  fullReasoning += thinkPart
                  options.onDelta("", thinkPart)
                }
                inThinkTag = false
                if (restPart) {
                  options.onDelta(restPart, "")
                }
              } else {
                fullReasoning += cChunk
                options.onDelta("", cChunk)
              }
            } else {
              options.onDelta(cChunk, "")
            }
          }
        } catch {
          // ignore partial JSON line
        }
      }
    }

    // Clean <think> tags from final content
    const cleanedContent = fullRaw.replace(/<think>[\s\S]*?<\/think>/g, "").trim()
    return { content: cleanedContent, reasoning: fullReasoning.trim() }
  }

  // Helper to push/update synthetic messages and parts directly in OpenCode's Sync store so SessionTimeline renders them natively
  const ensureLocalSession = (sessionId?: string, title?: string): string => {
    if (sessionId) {
      const existing = sync.session.get(sessionId)
      if (existing) return existing.id
    }
    const id = sessionId || `ses_lms_${Date.now()}`
    const now = Date.now()
    const newSession = {
      id,
      title: title || "LM Studio Autonomous Session",
      version: "1.0",
      time: { created: now, updated: now },
    }
    sync.set(
      "session",
      produce((draft) => {
        draft.push(newSession as any)
        draft.sort((a, b) => a.id.localeCompare(b.id))
      }),
    )
    return id
  }

  const appendMessageToSync = (sessionID: string, msg: Message, initialParts: Part[] = []) => {
    sync.set(
      produce((draft) => {
        if (!draft.message[sessionID]) draft.message[sessionID] = []
        draft.message[sessionID].push(msg)
        draft.part[msg.id] = initialParts
      }),
    )
  }

  const upsertPartInSync = (messageID: string, part: Part) => {
    sync.set(
      produce((draft) => {
        if (!draft.part[messageID]) draft.part[messageID] = []
        const idx = draft.part[messageID].findIndex((p) => p.id === part.id)
        if (idx === -1) {
          draft.part[messageID].push(part)
        } else {
          draft.part[messageID][idx] = part
        }
      }),
    )
  }

  const markMessageComplete = (sessionID: string, messageID: string) => {
    sync.set(
      produce((draft) => {
        const list = draft.message[sessionID]
        if (!list) return
        const msg = list.find((m) => m.id === messageID)
        if (msg && "time" in msg && msg.time) {
          ;(msg.time as any).completed = Date.now()
        }
      }),
    )
  }

  // Parse <delegate_to_worker title="...">...</delegate_to_worker> blocks from Master output
  const extractWorkerDelegations = (text: string): { title: string; instructions: string }[] => {
    const tasks: { title: string; instructions: string }[] = []
    const regex = /<delegate_to_worker(?:\s+title="([^"]*)")?\s*>([\s\S]*?)<\/delegate_to_worker>/gi
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      const title = (match[1] || `Subtask #${tasks.length + 1}`).trim()
      const instructions = (match[2] || "").trim()
      if (instructions) {
        tasks.push({ title, instructions })
      }
    }
    return tasks
  }

  // Main Autonomous Master ⇄ Worker Execution Pipeline
  const executeAutonomousPrompt = async (params: {
    sessionId?: string
    prompt: string
    filesContext: { filename: string; path: string; content: string }[]
    onSessionCreated?: (sessionId: string) => void
  }): Promise<string> => {
    const topo = topology()
    if (!topo.master) {
      throw new Error("No online LM Studio server available. Please add your LM Studio IP first.")
    }

    const sessionID = ensureLocalSession(
      params.sessionId,
      params.prompt.slice(0, 48) + (params.prompt.length > 48 ? "..." : ""),
    )
    params.onSessionCreated?.(sessionID)

    const now = Date.now()
    const userMsgId = `msg-${now}-1-user`
    const userPartId = `part-${now}-1`

    // 1. Record User Message in timeline
    appendMessageToSync(
      sessionID,
      {
        id: userMsgId,
        sessionID,
        role: "user",
        time: { created: now },
      } as any,
      [
        {
          id: userPartId,
          sessionID,
          messageID: userMsgId,
          type: "text",
          text: params.prompt,
        } as any,
      ],
    )

    // Build prior conversation history for context continuity
    const priorHistory: { role: "user" | "assistant"; content: string }[] = []
    const existingMsgs = sync.data.message[sessionID] ?? []
    for (const m of existingMsgs.slice(-7, -1)) {
      const parts = sync.data.part[m.id] ?? []
      const textContent = parts
        .filter((p) => p.type === "text")
        .map((p: any) => p.text)
        .join("\n")
        .trim()
      if (textContent) {
        priorHistory.push({
          role: m.role === "user" ? "user" : "assistant",
          content: textContent.slice(0, 3000),
        })
      }
    }

    const filesBlock =
      params.filesContext.length > 0
        ? "\n\n=== OPEN WORKSPACE FILES ===\n" +
          params.filesContext
            .map((f) => `--- FILE: ${f.path} ---\n${f.content.slice(0, 12000)}`)
            .join("\n\n")
        : ""

    const isMultiAgent =
      store.autonomousMode &&
      topo.worker &&
      (topo.mode === "dual-multi-server" || topo.mode === "dual-same-server")

    // Create Assistant Message container
    const asstMsgId = `msg-${Date.now() + 1}-2-asst`
    appendMessageToSync(
      sessionID,
      {
        id: asstMsgId,
        sessionID,
        role: "assistant",
        time: { created: Date.now() },
      } as any,
      [],
    )

    setStore("activeSteps", sessionID, [])

    const addOrUpdateStep = (step: DelegationStep) => {
      setStore(
        "activeSteps",
        sessionID,
        produce((draft) => {
          if (!draft) return
          const i = draft.findIndex((s) => s.id === step.id)
          if (i === -1) draft.push(step)
          else draft[i] = step
        }),
      )
    }

    try {
      if (!isMultiAgent) {
        // SINGLE NODE EXECUTION
        const { server, model } = topo.master
        const stepId = `step-single-${Date.now()}`
        addOrUpdateStep({
          id: stepId,
          phase: "single-node",
          role: "master",
          serverIp: server.ip,
          modelId: model.id,
          title: `Executing on ${model.name} (${server.ip})`,
          status: "running",
          startedAt: Date.now(),
        })

        const reasoningPartId = `part-${Date.now()}-01-think`
        const textPartId = `part-${Date.now()}-02-text`
        let accText = ""
        let accThink = ""
        const tStart = Date.now()

        const headerBadge = `> 🖥️ **LM Studio Node** · \`${model.id}\` @ \`${server.ip}:${server.port}\`\n\n`

        await streamChatCompletion({
          server,
          modelId: model.id,
          messages: [
            {
              role: "system",
              content:
                "You are an expert Senior Software Engineer inside OpenCode GUI. Provide clean, complete, production-ready code and clear technical explanations.",
            },
            ...priorHistory,
            {
              role: "user",
              content: `${params.prompt}${filesBlock}`,
            },
          ],
          onDelta: (cDelta, rDelta) => {
            if (rDelta) {
              accThink += rDelta
              upsertPartInSync(asstMsgId, {
                id: reasoningPartId,
                sessionID,
                messageID: asstMsgId,
                type: "reasoning",
                text: accThink,
                time: { start: tStart },
              } as any)
            }
            if (cDelta) {
              accText += cDelta
              upsertPartInSync(asstMsgId, {
                id: textPartId,
                sessionID,
                messageID: asstMsgId,
                type: "text",
                text: headerBadge + accText,
              } as any)
            }
          },
        })

        if (accThink) {
          upsertPartInSync(asstMsgId, {
            id: reasoningPartId,
            sessionID,
            messageID: asstMsgId,
            type: "reasoning",
            text: accThink,
            time: { start: tStart, end: Date.now() },
          } as any)
        }

        addOrUpdateStep({
          id: stepId,
          phase: "single-node",
          role: "master",
          serverIp: server.ip,
          modelId: model.id,
          title: `Completed on ${model.name} (${server.ip})`,
          status: "completed",
          startedAt: tStart,
          completedAt: Date.now(),
        })

        markMessageComplete(sessionID, asstMsgId)
        return sessionID
      }

      // =========================================================================
      // AUTONOMOUS MULTI-AGENT PIPELINE: MASTER (ARCHITECT) ⇄ WORKER (EXECUTOR)
      // =========================================================================
      const masterNode = topo.master
      const workerNode = topo.worker!
      const workerPool = topo.workerPool

      // PHASE 1: Master Analyzes, Designs Architecture & Decides What to Delegate
      const step1Id = `step-master-plan-${Date.now()}`
      const tPhase1 = Date.now()
      addOrUpdateStep({
        id: step1Id,
        phase: "master-plan",
        role: "master",
        serverIp: masterNode.server.ip,
        modelId: masterNode.model.id,
        title: `Master (${masterNode.model.name} @ ${masterNode.server.ip}): Analyzing & delegating...`,
        status: "running",
        startedAt: tPhase1,
      })

      const p1ThinkId = `part-${tPhase1}-10-mthink`
      const p1TextId = `part-${tPhase1}-11-mtext`
      let mPlanText = ""
      let mPlanThink = ""

      const masterBadge = `> 👑 **MASTER ARCHITECT** · \`${masterNode.model.id}\` @ \`${masterNode.server.ip}:${masterNode.server.port}\` *(Autonomous Orchestrator)*\n\n`

      const masterSystemPrompt = `You are the MASTER ARCHITECT & ORCHESTRATOR in an autonomous multi-server AI coding system.
Your node: ${masterNode.model.id} (${masterNode.model.paramB}B params) on server ${masterNode.server.ip}:${masterNode.server.port}.
Available WORKER AGENT(S): ${workerPool.map((w) => `${w.model.id} (${w.model.paramB}B params) on server ${w.server.ip}:${w.server.port}`).join(", ")}.

AUTONOMOUS ORCHESTRATION RULES:
1. Analyze the user's request automatically. The user does NOT manually assign tasks — YOU decide how to split the work.
2. If the user's prompt is a simple question, greeting, or quick explanation that does NOT benefit from delegation, answer it directly and completely yourself without any <delegate_to_worker> tags.
3. If the prompt involves writing code, implementing features, refactoring, debugging, or multi-part work:
   - First, write your high-level Architectural Design, core interfaces, or Master part.
   - Delegate concrete implementation modules, functions, tests, or heavy coding chunks to the Worker Agent using one or more XML tags in this exact format:
     <delegate_to_worker title="Short descriptive title of subtask">
     Complete, self-contained instructions and context for the Worker Agent to implement this piece...
     </delegate_to_worker>
4. Match the language of the user (if the user writes in Romanian, respond in Romanian).`

      const formatMasterPlanDisplay = (raw: string) => {
        // Render <delegate_to_worker> tags cleanly as markdown callouts while streaming
        const formatted = raw
          .replace(
            /<delegate_to_worker(?:\s+title="([^"]*)")?\s*>/gi,
            (_, title) => `\n\n---\n📤 **Delegat automat către Worker Agent (${workerNode.model.name} @ ${workerNode.server.ip}):** *${title || "Subtask"}*\n> `,
          )
          .replace(/<\/delegate_to_worker>/gi, "\n---\n")
        return masterBadge + formatted
      }

      const masterPhase1 = await streamChatCompletion({
        server: masterNode.server,
        modelId: masterNode.model.id,
        messages: [
          { role: "system", content: masterSystemPrompt },
          ...priorHistory,
          { role: "user", content: `${params.prompt}${filesBlock}` },
        ],
        onDelta: (cDelta, rDelta) => {
          if (rDelta) {
            mPlanThink += rDelta
            upsertPartInSync(asstMsgId, {
              id: p1ThinkId,
              sessionID,
              messageID: asstMsgId,
              type: "reasoning",
              text: `[👑 Master ${masterNode.model.name}] ${mPlanThink}`,
              time: { start: tPhase1 },
            } as any)
          }
          if (cDelta) {
            mPlanText += cDelta
            upsertPartInSync(asstMsgId, {
              id: p1TextId,
              sessionID,
              messageID: asstMsgId,
              type: "text",
              text: formatMasterPlanDisplay(mPlanText),
            } as any)
          }
        },
      })

      if (mPlanThink) {
        upsertPartInSync(asstMsgId, {
          id: p1ThinkId,
          sessionID,
          messageID: asstMsgId,
          type: "reasoning",
          text: `[👑 Master ${masterNode.model.name}] ${mPlanThink}`,
          time: { start: tPhase1, end: Date.now() },
        } as any)
      }

      addOrUpdateStep({
        id: step1Id,
        phase: "master-plan",
        role: "master",
        serverIp: masterNode.server.ip,
        modelId: masterNode.model.id,
        title: `Master (${masterNode.model.name}): Plan & task split complete`,
        status: "completed",
        startedAt: tPhase1,
        completedAt: Date.now(),
      })

      // Check if Master delegated subtasks to Worker(s)
      const delegations = extractWorkerDelegations(masterPhase1.content)
      if (delegations.length === 0) {
        // Master handled it directly
        markMessageComplete(sessionID, asstMsgId)
        return sessionID
      }

      // PHASE 2: Worker Agent(s) Execute Delegated Subtasks
      const workerOutputs: { title: string; workerInfo: string; output: string }[] = new Array(delegations.length)

      const runSubtaskOnWorker = async (task: { title: string; instructions: string }, idx: number) => {
        const assignedWorker = workerPool[idx % workerPool.length] ?? workerNode
        const tWorkerStart = Date.now()
        const stepWId = `step-worker-${idx}-${tWorkerStart}`
        const partThinkId = `part-${tPhase1}-2${idx}-wthink`
        const partTextId = `part-${tPhase1}-2${idx}-wtext`

        addOrUpdateStep({
          id: stepWId,
          phase: "worker-exec",
          role: "worker",
          serverIp: assignedWorker.server.ip,
          modelId: assignedWorker.model.id,
          title: `Worker (${assignedWorker.model.name} @ ${assignedWorker.server.ip}): ${task.title}`,
          status: "running",
          startedAt: tWorkerStart,
        })

        let wText = ""
        let wThink = ""
        const workerBadge = `\n---\n> ⚡ **WORKER AGENT #${idx + 1}** · \`${assignedWorker.model.id}\` @ \`${assignedWorker.server.ip}:${assignedWorker.server.port}\`\n> **Task:** *${task.title}*\n\n`

        const wRes = await streamChatCompletion({
          server: assignedWorker.server,
          modelId: assignedWorker.model.id,
          messages: [
            {
              role: "system",
              content: `You are the specialized WORKER EXECUTION AGENT (${assignedWorker.model.id} on ${assignedWorker.server.ip}).
The Master Architect (${masterNode.model.id} on ${masterNode.server.ip}) has delegated a specific implementation task to you.
Focus 100% on executing this specific task with complete, working code and technical precision. Do not repeat the Master's high-level plan. Match the user's language.`,
            },
            {
              role: "user",
              content: `ORIGINAL USER GOAL:\n${params.prompt}${filesBlock}\n\nYOUR ASSIGNED SUBTASK (${task.title}):\n${task.instructions}`,
            },
          ],
          onDelta: (cDelta, rDelta) => {
            if (rDelta) {
              wThink += rDelta
              upsertPartInSync(asstMsgId, {
                id: partThinkId,
                sessionID,
                messageID: asstMsgId,
                type: "reasoning",
                text: `[⚡ Worker ${assignedWorker.model.name}] ${wThink}`,
                time: { start: tWorkerStart },
              } as any)
            }
            if (cDelta) {
              wText += cDelta
              upsertPartInSync(asstMsgId, {
                id: partTextId,
                sessionID,
                messageID: asstMsgId,
                type: "text",
                text: workerBadge + wText,
              } as any)
            }
          },
        })

        if (wThink) {
          upsertPartInSync(asstMsgId, {
            id: partThinkId,
            sessionID,
            messageID: asstMsgId,
            type: "reasoning",
            text: `[⚡ Worker ${assignedWorker.model.name}] ${wThink}`,
            time: { start: tWorkerStart, end: Date.now() },
          } as any)
        }

        addOrUpdateStep({
          id: stepWId,
          phase: "worker-exec",
          role: "worker",
          serverIp: assignedWorker.server.ip,
          modelId: assignedWorker.model.id,
          title: `Worker (${assignedWorker.model.name}): Completed "${task.title}"`,
          status: "completed",
          startedAt: tWorkerStart,
          completedAt: Date.now(),
        })

        workerOutputs[idx] = {
          title: task.title,
          workerInfo: `${assignedWorker.model.id} @ ${assignedWorker.server.ip}`,
          output: wRes.content,
        }
      }

      // If subtasks are on different servers (or parallelWorkers enabled), execute concurrently; otherwise sequentially
      if (store.parallelWorkers && workerPool.length > 1) {
        await Promise.all(delegations.map((task, idx) => runSubtaskOnWorker(task, idx)))
      } else {
        for (let i = 0; i < delegations.length; i++) {
          await runSubtaskOnWorker(delegations[i], i)
        }
      }

      // PHASE 3: Master Reviews & Integrates Worker Results
      if (store.autoReview) {
        const tReviewStart = Date.now()
        const step3Id = `step-master-review-${tReviewStart}`
        const p3ThinkId = `part-${tPhase1}-90-rthink`
        const p3TextId = `part-${tPhase1}-91-rtext`

        addOrUpdateStep({
          id: step3Id,
          phase: "master-review",
          role: "master",
          serverIp: masterNode.server.ip,
          modelId: masterNode.model.id,
          title: `Master (${masterNode.model.name} @ ${masterNode.server.ip}): Reviewing & integrating Worker output...`,
          status: "running",
          startedAt: tReviewStart,
        })

        let rText = ""
        let rThink = ""
        const reviewBadge = `\n---\n> 👑 **MASTER REVIEW & FINAL INTEGRATION** · \`${masterNode.model.id}\` @ \`${masterNode.server.ip}:${masterNode.server.port}\`\n\n`

        const compiledWorkerReport = workerOutputs
          .map((w, i) => `=== WORKER SUBTASK #${i + 1}: ${w.title} (Executed by ${w.workerInfo}) ===\n${w.output}`)
          .join("\n\n")

        await streamChatCompletion({
          server: masterNode.server,
          modelId: masterNode.model.id,
          messages: [
            {
              role: "system",
              content: `You are the MASTER ARCHITECT (${masterNode.model.id}). The Worker Agent has finished executing the delegated subtasks.
Review the Worker's code/output for correctness, fix any bugs or missing glue code if necessary, and provide a concise final integration summary to the user. Match the user's language.`,
            },
            {
              role: "user",
              content: `USER REQUEST:\n${params.prompt}\n\nYOUR INITIAL ARCHITECTURE:\n${masterPhase1.content}\n\nWORKER AGENT EXECUTION RESULTS:\n${compiledWorkerReport}`,
            },
          ],
          onDelta: (cDelta, rDelta) => {
            if (rDelta) {
              rThink += rDelta
              upsertPartInSync(asstMsgId, {
                id: p3ThinkId,
                sessionID,
                messageID: asstMsgId,
                type: "reasoning",
                text: `[👑 Master Review] ${rThink}`,
                time: { start: tReviewStart },
              } as any)
            }
            if (cDelta) {
              rText += cDelta
              upsertPartInSync(asstMsgId, {
                id: p3TextId,
                sessionID,
                messageID: asstMsgId,
                type: "text",
                text: reviewBadge + rText,
              } as any)
            }
          },
        })

        if (rThink) {
          upsertPartInSync(asstMsgId, {
            id: p3ThinkId,
            sessionID,
            messageID: asstMsgId,
            type: "reasoning",
            text: `[👑 Master Review] ${rThink}`,
            time: { start: tReviewStart, end: Date.now() },
          } as any)
        }

        addOrUpdateStep({
          id: step3Id,
          phase: "master-review",
          role: "master",
          serverIp: masterNode.server.ip,
          modelId: masterNode.model.id,
          title: `Master (${masterNode.model.name}): Final integration complete`,
          status: "completed",
          startedAt: tReviewStart,
          completedAt: Date.now(),
        })
      }

      markMessageComplete(sessionID, asstMsgId)
      return sessionID
    } catch (err: any) {
      const errPartId = `part-${Date.now()}-99-err`
      upsertPartInSync(asstMsgId, {
        id: errPartId,
        sessionID,
        messageID: asstMsgId,
        type: "text",
        text: `\n\n❌ **Orchestration Error:** \`${err?.message || String(err)}\``,
      } as any)
      markMessageComplete(sessionID, asstMsgId)
      throw err
    }
  }

  // Probe saved servers on startup and periodically every 25s
  onMount(() => {
    if (store.servers.length > 0) {
      refreshAllServers()
    }
    const interval = setInterval(() => {
      if (store.servers.length > 0) {
        refreshAllServers()
      }
    }, 25000)
    onCleanup(() => clearInterval(interval))
  })

  return {
    store,
    setStore,
    onlineServers,
    allOnlineModels,
    topology,
    addServer,
    removeServer,
    toggleServer,
    probeServer,
    refreshAllServers,
    scanQuickTargets,
    executeAutonomousPrompt,
    openDialog: () => setStore("dialogOpen", true),
    closeDialog: () => setStore("dialogOpen", false),
  }
}

export type LMStudioContext = ReturnType<typeof init>

const ctx = createContext<LMStudioContext>()

export function LMStudioProvider(props: ParentProps) {
  const value = init()
  return <ctx.Provider value={value}>{props.children}</ctx.Provider>
}

export function useLMStudio() {
  const value = useContext(ctx)
  if (!value) {
    throw new Error("useLMStudio must be used within an LMStudioProvider")
  }
  return value
}
