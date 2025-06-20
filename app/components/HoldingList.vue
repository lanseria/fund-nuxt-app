<!-- File: app/components/HoldingList.vue -->
<script setup lang="ts">
import type { Holding } from '~/types/holding'

const props = defineProps<{
  holdings: Holding[]
}>()

const emit = defineEmits(['edit', 'delete'])

// [修改] 简化 SortableKey，因为排序逻辑被合并了
type SortableKey = 'holdingAmount' | 'percentageChange' | 'holdingProfitRate'

const sortKey = ref<SortableKey | null>('holdingAmount') // [修改] 默认按持有金额排序
const sortOrder = ref<'asc' | 'desc'>('desc')

function setSort(key: SortableKey) {
  if (sortKey.value === key) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
  }
  else {
    sortKey.value = key
    sortOrder.value = 'desc'
  }
}

const sortedHoldings = computed(() => {
  if (!sortKey.value)
    return props.holdings

  return [...props.holdings].sort((a, b) => {
    const key = sortKey.value!
    const valA = a[key] ?? -Infinity
    const valB = b[key] ?? -Infinity

    if (sortOrder.value === 'asc')
      return Number(valA) - Number(valB)
    else
      return Number(valB) - Number(valA)
  })
})

function getProfitClass(holding: Holding) {
  if (holding.holdingProfitAmount === null || holding.holdingProfitAmount === undefined)
    return 'text-gray-500'
  if (holding.holdingProfitAmount > 0)
    return 'text-red-500 dark:text-red-400'
  if (holding.holdingProfitAmount < 0)
    return 'text-green-500 dark:text-green-400'
  return 'text-gray-500'
}

function getChangeClass(holding: Holding) {
  if (holding.percentageChange === null || holding.percentageChange === undefined)
    return 'text-gray-500'
  if (holding.percentageChange > 0)
    return 'text-red-500 dark:text-red-400'
  if (holding.percentageChange < 0)
    return 'text-green-500 dark:text-green-400'
  return 'text-gray-500'
}

function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined)
    return '-'
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(value)
}

// [新增] 获取信号标签样式的辅助函数
function getSignalTagClass(signal: string) {
  if (signal.includes('买入'))
    return 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300'
  if (signal.includes('卖出'))
    return 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300'
  // 默认为持有/观望/平仓等中性信号
  return 'bg-gray-100 text-gray-800 dark:bg-gray-700/50 dark:text-gray-300'
}

// [新增] 定义要显示的策略及其简称
const strategiesForTags = {
  rsi: 'RSI',
  bollinger_bands: '布林',
  ma_cross: '均线',
  macd: 'MACD',
}
</script>

<template>
  <div class="card overflow-hidden">
    <div class="overflow-x-auto">
      <table class="text-left w-full table-auto">
        <thead class="border-b bg-gray-50 dark:border-gray-700 dark:bg-gray-700/50">
          <tr>
            <th class="text-sm text-gray-600 font-semibold p-4 dark:text-gray-300">
              基金名称 / 策略信号
            </th>

            <!-- [修改] 合并 "持有金额" 和 "持有份额" 的表头，排序按 holdingAmount -->
            <th class="text-sm text-gray-600 font-semibold p-4 text-right cursor-pointer select-none dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700" @click="setSort('holdingAmount')">
              持有市值 / 份额
              <span v-if="sortKey === 'holdingAmount'" class="ml-1 align-middle inline-block">
                <div v-if="sortOrder === 'asc'" i-carbon-arrow-up />
                <div v-else i-carbon-arrow-down />
              </span>
            </th>

            <th class="text-sm text-gray-600 font-semibold p-4 text-right cursor-pointer select-none dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700" @click="setSort('holdingProfitRate')">
              持有收益 / 收益率
              <span v-if="sortKey === 'holdingProfitRate'" class="ml-1 align-middle inline-block">
                <div v-if="sortOrder === 'asc'" i-carbon-arrow-up /><div v-else i-carbon-arrow-down />
              </span>
            </th>

            <!-- [修改] 合并 "估算涨跌" 和 "估算金额" 的表头，排序按 percentageChange -->
            <th class="text-sm text-gray-600 font-semibold p-4 text-right cursor-pointer select-none dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700" @click="setSort('percentageChange')">
              估算涨跌 / 收益
              <span v-if="sortKey === 'percentageChange'" class="ml-1 align-middle inline-block">
                <div v-if="sortOrder === 'asc'" i-carbon-arrow-up />
                <div v-else i-carbon-arrow-down />
              </span>
            </th>

            <th class="text-sm text-gray-600 font-semibold p-4 text-right dark:text-gray-300">
              更新时间
            </th>
            <th class="text-sm text-gray-600 font-semibold p-4 text-right dark:text-gray-300">
              操作
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="h in sortedHoldings" :key="h.code" class="border-b transition-colors dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-800/50">
            <!-- 基金名称 -->
            <td class="font-semibold p-4">
              <NuxtLink :to="`/fund/${h.code}`" class="transition-colors hover:text-teal-500">
                {{ h.name }}
                <div class="text-xs text-gray-400 font-normal dark:text-gray-500">
                  {{ h.code }}
                </div>
              </NuxtLink>
              <!-- [新增] 策略信号标签容器 -->
              <div v-if="h.signals" class="mt-2 flex flex-wrap gap-1.5">
                <span
                  v-for="(name, key) in strategiesForTags"
                  :key="key"
                  class="text-xs font-medium px-2 py-0.5 rounded-full"
                  :class="getSignalTagClass(h.signals[key] || '无信号')"
                >
                  {{ name }}: {{ h.signals[key] ? h.signals[key].slice(0, 1) : '-' }}
                </span>
              </div>
            </td>

            <!-- [修改] 持有市值和份额合并在一个单元格 -->
            <td class="font-mono p-4 text-right">
              <div class="font-semibold">
                {{ formatCurrency(h.holdingAmount) }}
              </div>
              <div class="text-xs text-gray-500 dark:text-gray-400">
                {{ h.shares.toFixed(2) }} 份
              </div>
            </td>

            <!-- [新增] 持有收益和收益率 -->
            <td class="font-mono p-4 text-right" :class="getProfitClass(h)">
              <div class="font-semibold">
                {{ formatCurrency(h.holdingProfitAmount) }}
              </div>
              <div class="text-xs">
                {{ h.holdingProfitRate !== null ? `${h.holdingProfitRate > 0 ? '+' : ''}${h.holdingProfitRate.toFixed(2)}%` : '-' }}
              </div>
            </td>

            <!-- [修改] 估算涨跌和市值合并在一个单元格 -->
            <td class="font-mono p-4 text-right" :class="getChangeClass(h)">
              <div class="font-semibold">
                {{ h.percentageChange !== null ? `${h.percentageChange > 0 ? '+' : ''}${h.percentageChange.toFixed(2)}%` : '-' }}
              </div>
              <div class="text-xs">
                {{ formatCurrency(h.todayEstimateAmount ?? 0 - h.holdingAmount) }}
              </div>
            </td>

            <!-- 更新时间 -->
            <td class="text-sm text-gray-500 p-4 text-right">
              {{ h.todayEstimateUpdateTime ? useDayjs()(h.todayEstimateUpdateTime).format('HH:mm:ss') : '-' }}
            </td>

            <!-- 操作 -->
            <td class="p-4 text-right">
              <div class="flex gap-2 justify-end">
                <button class="icon-btn" title="修改" @click="emit('edit', h)">
                  <div i-carbon-edit />
                </button>
                <button class="icon-btn hover:text-red-500" title="删除" @click="emit('delete', h)">
                  <div i-carbon-trash-can />
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
