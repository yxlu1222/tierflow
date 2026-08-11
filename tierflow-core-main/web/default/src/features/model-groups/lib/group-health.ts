/*
Copyright (C) 2023-2026 TierFlow
*/
import type { ProviderHealth } from '@/features/route-monitor/types'
import type { Tone } from '@/features/route-monitor/state-meta'
import type { ModelGroup, ModelGroupMember } from '../types'

// 模型组健康状态：
// - empty    : 组内没有成员
// - down     : 没有一个成员渠道当前可用
// - degraded : 部分成员渠道不可用（禁用 / 冷却中）
// - healthy  : 全部成员渠道可用
export type GroupHealthState = 'healthy' | 'degraded' | 'down' | 'empty'

// 单个成员（渠道+模型）的实时状态。provider 缺失表示该渠道未启用
// （/api/route_monitor/health 只返回已启用渠道）。
export interface MemberHealth {
  member: ModelGroupMember
  channelName: string
  provider?: ProviderHealth
  available: boolean
}

// 成员按故障转移顺序排列：优先级降序，同级保持原始顺序。必须与后端
// GetOrderedModelGroupMembers 一致——列表接口 GetAllModelGroups 是裸 Find，
// 不带排序，直接展示会与请求期的实际尝试顺序不符。priority 可为 null（后端
// 是 *int64），视为 0。
function memberPriority(m: ModelGroupMember): number {
  return Number(m.priority ?? 0)
}

export function orderMembersByFailover(
  members: ModelGroupMember[]
): ModelGroupMember[] {
  return members
    .map((member, index) => ({ member, index }))
    .sort(
      (a, b) =>
        memberPriority(b.member) - memberPriority(a.member) || a.index - b.index
    )
    .map(({ member }) => member)
}

export interface GroupHealth {
  total: number // 成员总数（= 花名册行数）
  available: number // 当前可路由的成员数
  cooling: number // 冷却中的成员数
  state: GroupHealthState
  members: MemberHealth[]
}

export const GROUP_HEALTH_TONE: Record<GroupHealthState, Tone | 'muted'> = {
  healthy: 'ok',
  degraded: 'warn',
  down: 'bad',
  empty: 'muted',
}

export const GROUP_HEALTH_LABEL_KEY: Record<GroupHealthState, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  down: 'Down',
  empty: 'No members',
}

// 渠道可用 = 在健康列表中（即已启用）且不处于冷却态。probing/degraded 仍算可用
// （与路由侧 channelRoutable 一致：多 key 渠道只要有一个 key 可用即可路由）。
function isChannelAvailable(provider?: ProviderHealth): boolean {
  return !!provider && provider.state !== 'cooling'
}

export function buildChannelHealthMap(
  providers: ProviderHealth[]
): Map<number, ProviderHealth> {
  const map = new Map<number, ProviderHealth>()
  for (const p of providers) map.set(p.channel_id, p)
  return map
}

export function computeGroupHealth(
  group: ModelGroup,
  healthByChannel: Map<number, ProviderHealth>,
  channelNameById: Map<number, string>
): GroupHealth {
  const members = orderMembersByFailover(group.members ?? [])

  const memberHealth: MemberHealth[] = members.map((member) => {
    const provider = healthByChannel.get(member.channel_id)
    return {
      member,
      channelName:
        channelNameById.get(member.channel_id) ||
        provider?.channel_name ||
        `#${member.channel_id}`,
      provider,
      available: isChannelAvailable(provider),
    }
  })

  // 以「成员」为口径统计：故障转移是按成员逐个尝试的，「N/M 个成员可路由」
  // 正是与之对应的数字，也与花名册的行数一一对应。成员与上游渠道在正确配置下
  // 本就是 1:1（同一模型跨上游），同渠道多成员属配置问题，不应让计数与列表打架。
  const available = members.filter((m) =>
    isChannelAvailable(healthByChannel.get(m.channel_id))
  ).length
  const cooling = members.filter(
    (m) => healthByChannel.get(m.channel_id)?.state === 'cooling'
  ).length
  const total = members.length

  let state: GroupHealthState
  if (total === 0) state = 'empty'
  else if (available === 0) state = 'down'
  else if (available < total) state = 'degraded'
  else state = 'healthy'

  return { total, available, cooling, state, members: memberHealth }
}
