// server/utils/strategies.ts
/* eslint-disable no-console */
import BigNumber from 'bignumber.js'
import dayjs from 'dayjs'
import { and, eq, gte } from 'drizzle-orm'
import { ofetch } from 'ofetch'
import { holdings, strategySignals } from '~~/server/database/schemas'
import { useDb } from '~~/server/utils/db'

const STRATEGIES_TO_RUN = ['rsi', 'bollinger_bands', 'ma_cross', 'macd']
const STRATEGIES_REQUIRING_HOLDING_STATUS = ['bollinger_bands', 'ma_cross', 'macd']

/**
 * 为所有持仓基金执行策略分析，并支持覆盖当天数据
 */
export async function runStrategiesForAllHoldings() {
  const db = useDb()
  const config = useRuntimeConfig()
  const strategyApiBaseUrl = config.strategyApiUrl

  if (!strategyApiBaseUrl) {
    console.error('策略 API 地址 (NUXT_STRATEGY_API_URL) 未配置，任务终止。')
    throw new Error('策略服务未配置')
  }

  // 1. 在执行前，先删除今天已经生成的所有策略信号，以实现覆盖
  const today = dayjs().toDate()
  await db.delete(strategySignals).where(gte(strategySignals.createdAt, today))
  console.log(`已清除 ${today} 的旧策略信号，准备重新生成...`)

  const allHoldings = await db.query.holdings.findMany()
  let successCount = 0
  let errorCount = 0

  for (const holding of allHoldings) {
    for (const strategyName of STRATEGIES_TO_RUN) {
      try {
        const url = `${strategyApiBaseUrl}/strategies/${strategyName}/${holding.code}`
        const params: Record<string, any> = {}

        if (STRATEGIES_REQUIRING_HOLDING_STATUS.includes(strategyName))
          params.is_holding = new BigNumber(holding.shares).isGreaterThan(0)

        const signalData = await ofetch(url, { params })

        await db.insert(strategySignals).values({
          fundCode: signalData.fund_code,
          strategyName: signalData.strategy_name,
          signal: signalData.signal,
          reason: signalData.reason,
          latestDate: signalData.latest_date,
          latestClose: signalData.latest_close,
          metrics: signalData.metrics,
        })
        successCount++
      }
      catch (e: any) {
        const errorMessage = e.data?.detail || e.message
        console.error(`获取基金 ${holding.code} 的 ${strategyName} 策略时出错:`, errorMessage)
        errorCount++
      }
    }
  }

  console.log(`基金策略分析完成。成功: ${successCount}, 失败: ${errorCount}`)
  return { success: successCount, failed: errorCount }
}

/**
 * [修改] 为单个基金执行策略分析，并支持覆盖当天数据
 * @param fundCode 要分析的基金代码
 */
export async function runStrategiesForFund(fundCode: string) {
  const db = useDb()
  const config = useRuntimeConfig()
  const strategyApiBaseUrl = config.strategyApiUrl

  if (!strategyApiBaseUrl) {
    console.error('策略 API 地址 (NUXT_STRATEGY_API_URL) 未配置，任务终止。')
    throw new Error('策略服务未配置')
  }

  // 1. 获取要分析的单个持仓
  const holding = await db.query.holdings.findFirst({
    where: eq(holdings.code, fundCode),
  })

  if (!holding)
    throw new Error(`未找到基金代码为 ${fundCode} 的持仓记录`)

  // 2. 在执行前，先删除该基金今天已经生成的所有策略信号
  const today = dayjs().startOf('day').toDate()
  await db.delete(strategySignals).where(and(
    eq(strategySignals.fundCode, fundCode),
    gte(strategySignals.createdAt, today),
  ))
  console.log(`已清除基金 ${fundCode} 在 ${today.toLocaleDateString()} 的旧策略信号...`)

  let successCount = 0
  let errorCount = 0

  for (const strategyName of STRATEGIES_TO_RUN) {
    try {
      const url = `${strategyApiBaseUrl}/strategies/${strategyName}/${holding.code}`
      const params: Record<string, any> = {}

      if (STRATEGIES_REQUIRING_HOLDING_STATUS.includes(strategyName))
        params.is_holding = new BigNumber(holding.shares).isGreaterThan(0)

      const signalData = await ofetch(url, { params })

      await db.insert(strategySignals).values({
        fundCode: signalData.fund_code,
        strategyName: signalData.strategy_name,
        signal: signalData.signal,
        reason: signalData.reason,
        latestDate: signalData.latest_date,
        latestClose: signalData.latest_close,
        metrics: signalData.metrics,
      })
      successCount++
    }
    catch (e: any) {
      const errorMessage = e.data?.detail || e.message
      console.error(`获取基金 ${holding.code} 的 ${strategyName} 策略时出错:`, errorMessage)
      errorCount++
    }
  }

  console.log(`基金 ${fundCode} 策略分析完成。成功: ${successCount}, 失败: ${errorCount}`)
  return { success: successCount, failed: errorCount }
}
