import { Prisma } from "@campux/db";
import { prisma } from "./prisma";
import { normalizeImageMaxSizeMb } from "./image-upload-policy";

type MetadataClient = typeof prisma | Prisma.TransactionClient;

export const defaultPendingPostLimit = 1;
export const maxPendingPostLimit = 50;
export const pendingPostLimitMetadataKey = "pending_post_limit";
export const publishRateLimitMetadataKey = "publish_rate_limit";
export const publishRateLimitDefaults = { hourly: 0, daily: 0 } as const;
export const publishRateLimitMaximum = 10_000;

export type PublishRateLimits = { hourly: number; daily: number };

export function normalizePublishRateLimits(value: unknown): PublishRateLimits {
  if (!value || typeof value !== "object") return { ...publishRateLimitDefaults };
  const record = value as Record<string, unknown>;
  const normalize = (item: unknown) => {
    const numeric = typeof item === "number" ? item : typeof item === "string" && item.trim() !== "" ? Number(item) : NaN;
    return Number.isInteger(numeric) && numeric >= 0 && numeric <= publishRateLimitMaximum ? numeric : 0;
  };
  const limits = { hourly: normalize(record.hourly), daily: normalize(record.daily) };
  return isValidPublishRateLimits(limits) ? limits : { ...publishRateLimitDefaults };
}

export function isValidPublishRateLimits(limits: PublishRateLimits) {
  return (limits.hourly === 0 || limits.daily === 0 || limits.hourly * 12 <= limits.daily);
}

export function publishRateLimitWindowStart(now: Date, period: "hour" | "day") {
  const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
  const HOUR_MS = 60 * 60 * 1000;
  const DAY_MS = 24 * HOUR_MS;
  const localTimestamp = now.getTime() + SHANGHAI_OFFSET_MS;
  const boundary = period === "hour"
    ? Math.floor(localTimestamp / HOUR_MS) * HOUR_MS
    : Math.floor(localTimestamp / DAY_MS) * DAY_MS;
  return new Date(boundary - SHANGHAI_OFFSET_MS);
}

export function nextPublishRateLimitWindowEnd(now: Date, period: "hour" | "day") {
  const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
  const HOUR_MS = 60 * 60 * 1000;
  const DAY_MS = 24 * HOUR_MS;
  const localTimestamp = now.getTime() + SHANGHAI_OFFSET_MS;
  const localBoundary = period === "hour"
    ? (Math.floor(localTimestamp / HOUR_MS) + 1) * HOUR_MS
    : (Math.floor(localTimestamp / DAY_MS) + 1) * DAY_MS;
  return new Date(localBoundary - SHANGHAI_OFFSET_MS);
}

export async function readTenantPublishRateLimits(client: MetadataClient, tenantId: string): Promise<PublishRateLimits> {
  const entry = await client.tenantMetadata.findUnique({ where: { tenantId_key: { tenantId, key: publishRateLimitMetadataKey } }, select: { value: true } });
  return normalizePublishRateLimits(entry?.value);
}

export async function listTenantSuccessfulPublishPostIds(client: MetadataClient, tenantId: string, since: Date, before: Date) {
  const rows = await client.postLog.findMany({
    where: { tenantId, newStatus: "published", createdAt: { gte: since, lt: before } },
    select: { postId: true },
    distinct: ["postId"],
  });
  return [...new Set(rows.map((row) => row.postId))];
}

export async function countTenantSuccessfulPublishes(client: MetadataClient, tenantId: string, since: Date, before: Date) {
  return (await listTenantSuccessfulPublishPostIds(client, tenantId, since, before)).length;
}


export const imageCompressionEnabledKey = "image_compression_enabled";
export const imageCompressionQualityKey = "image_compression_quality";
export const imageCompressionMaxDimensionKey = "image_compression_max_dimension";
export const imageMaxSizeMetadataKey = "image_max_size_mb";

export const imageCompressionDefaults = {
  enabled: true,
  quality: 80,
  maxDimension: 2048,
};

export function normalizePendingPostLimit(value: unknown) {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : defaultPendingPostLimit;
  if (!Number.isFinite(numeric)) {
    return defaultPendingPostLimit;
  }
  return Math.max(0, Math.min(maxPendingPostLimit, Math.floor(numeric)));
}

export function normalizeImageCompressionEnabled(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true" || value === "1";
  return imageCompressionDefaults.enabled;
}

export function normalizeImageCompressionQuality(value: unknown) {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : imageCompressionDefaults.quality;
  if (!Number.isFinite(numeric)) {
    return imageCompressionDefaults.quality;
  }
  return Math.max(40, Math.min(95, Math.floor(numeric)));
}

export function normalizeImageCompressionMaxDimension(value: unknown) {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : imageCompressionDefaults.maxDimension;
  if (!Number.isFinite(numeric)) {
    return imageCompressionDefaults.maxDimension;
  }
  return Math.max(512, Math.min(4096, Math.floor(numeric)));
}

export async function readTenantPendingPostLimit(client: MetadataClient, tenantId: string) {
  const entry = await client.tenantMetadata.findUnique({
    where: {
      tenantId_key: {
        tenantId,
        key: pendingPostLimitMetadataKey,
      },
    },
    select: {
      value: true,
    },
  });

  return normalizePendingPostLimit(entry?.value);
}

export async function readTenantImageCompression(client: MetadataClient, tenantId: string) {
  const entries = await client.tenantMetadata.findMany({
    where: {
      tenantId,
      key: {
        in: [imageCompressionEnabledKey, imageCompressionQualityKey, imageCompressionMaxDimensionKey, imageMaxSizeMetadataKey],
      },
    },
    select: {
      key: true,
      value: true,
    },
  });

  const record = Object.fromEntries(entries.map((e) => [e.key, e.value]));

  return {
    enabled: normalizeImageCompressionEnabled(record[imageCompressionEnabledKey]),
    quality: normalizeImageCompressionQuality(record[imageCompressionQualityKey]),
    maxDimension: normalizeImageCompressionMaxDimension(record[imageCompressionMaxDimensionKey]),
    maxSizeMb: normalizeImageMaxSizeMb(record[imageMaxSizeMetadataKey]),
  };
}

// 运营模式：bot 由墙号机器人自动发布到 QQ 空间；manual（无 Bot）由管理员在网页端
// 渲染稿件、手动保存发布后点「确认已发布」，审核通过不再自动入队。
export type OperateMode = "bot" | "manual";

export const operateModeKey = "operate_mode";
export const operateModeDefault: OperateMode = "bot";

export function normalizeOperateMode(value: unknown): OperateMode {
  return value === "manual" || (typeof value === "string" && value.toLowerCase() === "manual") ? "manual" : "bot";
}

/**
 * 重置密码的渠道由当前运营模式决定（与是否切换过模式无关）：
 * - bot 模式：私聊墙号 `#重置密码`
 * - manual 模式：网页「忘记密码」+ 邮箱验证码
 */
export type PasswordResetChannel = "bot-private-message" | "web-email";

export function resolvePasswordResetChannel(mode: OperateMode): PasswordResetChannel {
  return mode === "manual" ? "web-email" : "bot-private-message";
}

export async function readTenantOperateMode(client: MetadataClient, tenantId: string): Promise<OperateMode> {
  const entry = await client.tenantMetadata.findUnique({
    where: {
      tenantId_key: {
        tenantId,
        key: operateModeKey,
      },
    },
    select: {
      value: true,
    },
  });

  return normalizeOperateMode(entry?.value);
}

// 粘性标记：这堵墙是否**曾经**处于无 Bot 模式。
// 「绑定之前的账号」提示只对经历过模式切换的墙有意义——一直用机器人运营的墙里
// 根本不存在「无 Bot 期网页注册的旧账号」，弹窗只会让用户困惑（输 QQ 号必然查不到）。
// 用粘性标记而不是当前模式：切回 bot 后历史事实仍在，提示口径保持一致。
export const operateEverManualKey = "operate_ever_manual";

/**
 * 读取粘性标记，并在标记缺失时从可靠历史自愈：
 *
 * 标记是本 PR 新增的，存量数据里没有这一行。两类墙确实经历过无 Bot 模式：
 * 1. 当前仍在 manual 的墙（operate_mode=manual 就是直接证据）；
 * 2. 已经切回 bot、但审计日志里有 `tenant.operate_mode.update` 且
 *    `operateMode: "manual"` 的墙（切换动作都会留审计）。
 * 缺行时按这两条推断并**回写**标记——否则这些墙的用户永远看不到合并入口，
 * 且切回 bot 后审计证据会被当前模式掩盖。回写让后续读取不再重复推断。
 */
export async function readTenantEverManual(client: MetadataClient, tenantId: string): Promise<boolean> {
  const entry = await client.tenantMetadata.findUnique({
    where: {
      tenantId_key: {
        tenantId,
        key: operateEverManualKey,
      },
    },
    select: {
      value: true,
    },
  });
  if (entry) {
    return entry.value === true;
  }

  // 证据 1：当前就是 manual 模式。
  const operateMode = await readTenantOperateMode(client, tenantId);
  if (operateMode === "manual") {
    await backfillEverManual(client, tenantId);
    return true;
  }

  // 证据 2：审计日志里有切到 manual 的记录（写入用 prisma；client 可能是事务客户端）。
  // 不用 JSON path 过滤：Prisma 只在 PostgreSQL/MySQL 上支持，SQLite 会直接报错；
  // 模式切换审计每墙只有几条，全量拉回在 JS 里判断即可。
  const modeAudits = await prisma.auditLog.findMany({
    where: { tenantId, action: "tenant.operate_mode.update" },
    select: { detail: true },
    orderBy: { createdAt: "desc" },
  });
  const hasManualAudit = modeAudits.some((row) => {
    const detail = row.detail as { operateMode?: unknown } | null;
    return detail?.operateMode === "manual"
      || (typeof detail?.operateMode === "string" && detail.operateMode.toLowerCase() === "manual");
  });
  if (hasManualAudit) {
    await backfillEverManual(prisma, tenantId);
    return true;
  }
  return false;
}

/** 把推断出的「曾经历过 manual」补写回标记，避免每次读取都查审计。 */
async function backfillEverManual(client: MetadataClient, tenantId: string): Promise<void> {
  try {
    await client.tenantMetadata.upsert({
      where: { tenantId_key: { tenantId, key: operateEverManualKey } },
      update: { value: true },
      create: { tenantId, key: operateEverManualKey, value: true },
    });
  } catch {
    // 回写失败（例如 client 是事务内只读快照）不影响读取结果，下次读取再试。
  }
}

// 无 Bot 模式专属：管理员手动发说说时用来拼配文的模板，以及配置进站/渲染用的墙号 QQ。
// 机器人模式沿用 BotAccount.publishTextTemplate，这里只在 system_operator/无 bot 场景生效。
export const manualPublishTemplateKey = "manual_publish_template";
export const manualWallQqKey = "manual_wall_qq";

export type ManualPublishTemplate = {
  customText: string;
  suffixText: string;
  includePostId: boolean;
  includeAuthorQq: boolean;
};

export const manualPublishTemplateDefaults: ManualPublishTemplate = {
  customText: "",
  suffixText: "",
  includePostId: true,
  includeAuthorQq: false,
};

export function normalizeManualPublishTemplate(value: unknown): ManualPublishTemplate {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...manualPublishTemplateDefaults };
  }
  const record = value as Record<string, unknown>;
  return {
    customText: typeof record.customText === "string" ? record.customText.slice(0, 200) : "",
    suffixText: typeof record.suffixText === "string" ? record.suffixText.slice(0, 200) : "",
    includePostId: typeof record.includePostId === "boolean" ? record.includePostId : manualPublishTemplateDefaults.includePostId,
    includeAuthorQq: typeof record.includeAuthorQq === "boolean" ? record.includeAuthorQq : manualPublishTemplateDefaults.includeAuthorQq,
  };
}

/** 墙号 QQ：只接受 5 位以上数字，其余情况返回空串（表示未配置）。 */
export function normalizeManualWallQq(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
  return /^\d{5,}$/.test(raw) ? raw : "";
}

export async function readTenantManualPublishSettings(client: MetadataClient, tenantId: string) {
  const entries = await client.tenantMetadata.findMany({
    where: {
      tenantId,
      key: { in: [manualPublishTemplateKey, manualWallQqKey] },
    },
    select: { key: true, value: true },
  });
  const record = Object.fromEntries(entries.map((entry) => [entry.key, entry.value]));
  return {
    template: normalizeManualPublishTemplate(record[manualPublishTemplateKey]),
    wallQq: normalizeManualWallQq(record[manualWallQqKey]),
  };
}

export type PublishMode = "single" | "accumulate";

export const publishModeKey = "publish_mode";
export const publishAccumulateMinImagesKey = "publish_accumulate_min_images";
export const publishAccumulateMaxImagesKey = "publish_accumulate_max_images";
export const publishAccumulateStaleMinutesKey = "publish_accumulate_stale_minutes";

export const publishModeDefaults = {
  mode: "single" as PublishMode,
  minImages: 6,
  maxImages: 9,
  staleMinutes: 30,
};

// QQ 空间单条说说图片上限约 9 张，min/max 都钳制在 1..9。
export const publishAccumulateImageHardMax = 9;

export function normalizePublishMode(value: unknown): PublishMode {
  if (value === "accumulate") return "accumulate";
  if (typeof value === "string" && value.toLowerCase() === "accumulate") return "accumulate";
  return "single";
}

function toFiniteInt(value: unknown, fallback: number): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : fallback;
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.floor(numeric);
}

export function normalizeAccumulateImages(min: unknown, max: unknown): { minImages: number; maxImages: number } {
  let minImages = toFiniteInt(min, publishModeDefaults.minImages);
  let maxImages = toFiniteInt(max, publishModeDefaults.maxImages);
  minImages = Math.max(1, Math.min(publishAccumulateImageHardMax, minImages));
  maxImages = Math.max(1, Math.min(publishAccumulateImageHardMax, maxImages));
  if (maxImages < minImages) {
    maxImages = minImages;
  }
  return { minImages, maxImages };
}

export function normalizeAccumulateStaleMinutes(value: unknown): number {
  const minutes = toFiniteInt(value, publishModeDefaults.staleMinutes);
  // 至少 1 分钟，最多 24 小时。
  return Math.max(1, Math.min(1440, minutes));
}

export async function readTenantPublishMode(client: MetadataClient, tenantId: string) {
  const entries = await client.tenantMetadata.findMany({
    where: {
      tenantId,
      key: {
        in: [publishModeKey, publishAccumulateMinImagesKey, publishAccumulateMaxImagesKey, publishAccumulateStaleMinutesKey],
      },
    },
    select: {
      key: true,
      value: true,
    },
  });

  const record = Object.fromEntries(entries.map((e) => [e.key, e.value]));
  const { minImages, maxImages } = normalizeAccumulateImages(record[publishAccumulateMinImagesKey], record[publishAccumulateMaxImagesKey]);

  return {
    mode: normalizePublishMode(record[publishModeKey]),
    minImages,
    maxImages,
    staleMinutes: normalizeAccumulateStaleMinutes(record[publishAccumulateStaleMinutesKey]),
  };
}

// 发布说说文字里追加一段极短 LLM 总结（≤16 字）的开关。需同时配置了 LLM 才会生效。
export const publishLlmSummaryEnabledKey = "publish_llm_summary_enabled";
export const publishLlmSummaryEnabledDefault = false;

export function normalizePublishLlmSummaryEnabled(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true" || value === "1";
  return publishLlmSummaryEnabledDefault;
}

export async function readTenantPublishLlmSummaryEnabled(client: MetadataClient, tenantId: string): Promise<boolean> {
  const entry = await client.tenantMetadata.findUnique({
    where: {
      tenantId_key: {
        tenantId,
        key: publishLlmSummaryEnabledKey,
      },
    },
    select: {
      value: true,
    },
  });

  return normalizePublishLlmSummaryEnabled(entry?.value);
}

// 多彩投稿、Markdown 渲染、字体选择、匿名头像选择都已是预设插件的配置项，
// 这里不再保留 tenant_metadata 里的 enable_* 旧键：两处各自为政时会出现
// "插件已关闭但旧键仍是 true"的幽灵开关。

// 关注稿件有新评论时是否私信推送摘要。默认开启，保持既有行为。
export const followedPostCommentNotifyEnabledKey = "followed_post_comment_notify_enabled";
export const followedPostCommentNotifyEnabledDefault = true;

export function normalizeFollowedPostCommentNotifyEnabled(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true" || value === "1";
  return followedPostCommentNotifyEnabledDefault;
}

export async function readTenantFollowedPostCommentNotifyEnabled(client: MetadataClient, tenantId: string): Promise<boolean> {
  const entry = await client.tenantMetadata.findUnique({
    where: {
      tenantId_key: {
        tenantId,
        key: followedPostCommentNotifyEnabledKey,
      },
    },
    select: {
      value: true,
    },
  });

  return normalizeFollowedPostCommentNotifyEnabled(entry?.value);
}

/** 返回关闭了「关注稿件评论通知」的租户 id 集合（未配置的租户视为开启）。 */
export async function readFollowedPostCommentNotifyDisabledTenantIds(client: MetadataClient): Promise<Set<string>> {
  const entries = await client.tenantMetadata.findMany({
    where: {
      key: followedPostCommentNotifyEnabledKey,
    },
    select: {
      tenantId: true,
      value: true,
    },
  });

  const disabled = new Set<string>();
  for (const entry of entries) {
    if (!normalizeFollowedPostCommentNotifyEnabled(entry.value)) {
      disabled.add(entry.tenantId);
    }
  }
  return disabled;
}

