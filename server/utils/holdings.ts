/* eslint-disable no-console */
import BigNumber from 'bignumber.js'
import { and, desc, eq, gte, lte } from 'drizzle-orm'
import { holdings, navHistory } from '~~/server/database/schemas'
import { fetchFundHistory } from '~~/server/utils/dataFetcher' // 确保 fetchFundHistory 已导入
import { useDb } from '~~/server/utils/db'

// 自定义错误类型
export class HoldingExistsError extends Error {
  constructor(code: string) {
    super(`基金代码 '${code}' 已存在。`)
    this.name = 'HoldingExistsError'
  }
}

export class HoldingNotFoundError extends Error {
  constructor(code: string) {
    super(`未找到基金代码为 '${code}' 的持仓记录。`)
    this.name = 'HoldingNotFoundError'
  }
}

interface HoldingCreateData {
  code: string
  name?: string
  holdingAmount: number
  holdingProfitRate?: number | null
}

/**
 * 创建新的基金持仓
 */
export async function createNewHolding(data: HoldingCreateData) {
  const db = useDb()
  const existing = await db.query.holdings.findFirst({
    where: eq(holdings.code, data.code),
  })
  if (existing)
    throw new HoldingExistsError(data.code)

  const realtimeData = await fetchFundRealtimeEstimate(data.code)
  if (!realtimeData)
    throw new Error(`无法获取基金 ${data.code} 的实时信息。`)

  const finalName = data.name || realtimeData.name
  const yesterdayNav = Number(realtimeData.dwjz)
  if (Number.isNaN(yesterdayNav) || yesterdayNav <= 0)
    throw new Error(`无法为基金 ${data.code} 获取有效的初始净值。`)

  const shares = data.holdingAmount / yesterdayNav

  let profitAmount: number | null = null
  if (data.holdingProfitRate !== null && data.holdingProfitRate !== undefined) {
    // 根据公式: 成本 = 市值 / (1 + 收益率)
    // 收益 = 市值 - 成本
    const cost = data.holdingAmount / (1 + data.holdingProfitRate / 100)
    profitAmount = data.holdingAmount - cost
  }

  const newHolding = {
    code: data.code,
    name: finalName,
    shares: shares.toFixed(4),
    yesterdayNav: yesterdayNav.toFixed(4),
    holdingAmount: data.holdingAmount.toFixed(2),
    holdingProfitAmount: profitAmount ? profitAmount.toFixed(2) : null,
    holdingProfitRate: data.holdingProfitRate ?? null,
    todayEstimateNav: Number(realtimeData.gsz) || null,
    todayEstimateAmount: (shares * Number(realtimeData.gsz)).toFixed(2) || null,
    percentageChange: Number(realtimeData.gszzl) || null,
    todayEstimateUpdateTime: new Date(realtimeData.gztime) || null,
  }

  const [result] = await db.insert(holdings).values(newHolding).returning()
  return result
}

/**
 * [修改] 更新持仓记录，函数名和参数都已修改
 */
export async function updateHolding(code: string, data: { holdingAmount: number, holdingProfitRate?: number | null }) {
  const db = useDb()
  const holding = await db.query.holdings.findFirst({ where: eq(holdings.code, code) })
  if (!holding)
    throw new HoldingNotFoundError(code)

  const yesterdayNav = Number(holding.yesterdayNav)
  if (yesterdayNav <= 0)
    throw new Error(`基金 ${code} 的昨日净值为零或无效，无法重新计算份额。`)

  const newShares = data.holdingAmount / yesterdayNav

  // [新增] 重新计算收益金额
  let profitAmount: number | null = null
  if (data.holdingProfitRate !== null && data.holdingProfitRate !== undefined) {
    const cost = data.holdingAmount / (1 + data.holdingProfitRate / 100)
    profitAmount = data.holdingAmount - cost
  }

  // eslint-disable-next-line unused-imports/no-unused-vars
  const [updatedHolding] = await db.update(holdings)
    .set({
      holdingAmount: data.holdingAmount.toFixed(2),
      shares: newShares.toFixed(4),
      holdingProfitRate: data.holdingProfitRate ?? null,
      holdingProfitAmount: profitAmount ? profitAmount.toFixed(2) : null,
    })
    .where(eq(holdings.code, code))
    .returning()

  // 顺便更新一下实时估值
  await syncSingleFundEstimate(code)

  return await db.query.holdings.findFirst({ where: eq(holdings.code, code) })
}

/**
 * 删除持仓
 */
export async function deleteHoldingByCode(code: string) {
  const db = useDb()
  const holding = await db.query.holdings.findFirst({ where: eq(holdings.code, code) })
  if (!holding)
    throw new HoldingNotFoundError(code)

  await db.delete(navHistory).where(eq(navHistory.code, code))
  await db.delete(holdings).where(eq(holdings.code, code))
}

/**
 * 获取带移动平均线的历史数据
 */
export async function getHistoryWithMA(code: string, startDate?: string, endDate?: string, maOptions: number[] = []) {
  const db = useDb()
  const query = db.select().from(navHistory).where(
    and(
      eq(navHistory.code, code),
      startDate ? gte(navHistory.navDate, startDate) : undefined,
      endDate ? lte(navHistory.navDate, endDate) : undefined,
    ),
  ).orderBy(desc(navHistory.navDate))

  const records = await query
  if (!records.length)
    return []

  // [重要修改] 1. 将数据库中的字符串净值直接转换为 BigNumber 对象，以保持完整精度
  const data = records.map(r => ({
    date: r.navDate,
    nav: new BigNumber(r.nav), // 使用 new BigNumber()
  })).reverse() // 按日期升序排列，以便计算MA

  for (const ma of maOptions) {
    if (ma > 0 && data.length >= ma) {
      for (let i = ma - 1; i < data.length; i++) {
        // 截取计算 MA 所需的数据窗口
        const window = data.slice(i - ma + 1, i + 1)

        // [重要修改] 2. 使用 BigNumber.sum() 进行精确求和，或者使用 reduce + plus
        const sum = window.reduce(
          (acc, val) => acc.plus(val.nav), // 使用 .plus() 方法
          new BigNumber(0), // 初始值也是 BigNumber 对象
        )

        // [重要修改] 3. 使用 .dividedBy() 进行精确除法
        const movingAverage = sum.dividedBy(ma)

        // [重要修改] 4. 将计算结果（BigNumber对象）转换回普通数字，并赋给新属性
        // ECharts 等前端库需要的是普通数字
        ;(data[i] as any)[`ma${ma}`] = movingAverage.toNumber()
      }
    }
  }

  // [重要修改] 5. 在最终返回前，将所有 nav 从 BigNumber 对象转换回普通数字
  // 这样可以确保返回给前端的接口数据是纯净的、可直接使用的 JSON
  return data.map(point => ({
    ...point,
    nav: point.nav.toNumber(),
  }))
}

/**
 * 导出持仓数据
 */
export async function exportHoldingsData() {
  const db = useDb()
  // [修改] 在 SELECT 中添加 holdingProfitRate 字段
  const allHoldings = await db.select({
    code: holdings.code,
    shares: holdings.shares,
    holdingProfitRate: holdings.holdingProfitRate,
  }).from(holdings)
  return allHoldings
}

/**
 * 导入持仓数据
 */
export async function importHoldingsData(dataToImport: { code: string, shares: number, holdingProfitRate?: number | null }[], overwrite: boolean) {
  const db = useDb()
  if (overwrite) {
    await db.delete(navHistory)
    await db.delete(holdings)
  }

  let importedCount = 0
  let skippedCount = 0

  for (const item of dataToImport) {
    if (!item.code || item.shares === undefined) {
      skippedCount++
      continue
    }
    item.shares = Number(item.shares)

    if (!overwrite) {
      const existing = await db.query.holdings.findFirst({ where: eq(holdings.code, item.code) })
      if (existing) {
        skippedCount++
        continue
      }
    }

    const realtimeData = await fetchFundRealtimeEstimate(item.code)
    if (!realtimeData || new BigNumber(realtimeData.dwjz).isLessThanOrEqualTo(0)) {
      skippedCount++
      continue
    }

    // [修改] 使用 BigNumber.js 进行计算
    const sharesBN = new BigNumber(item.shares)
    const navBN = new BigNumber(realtimeData.dwjz)
    const holdingAmountBN = sharesBN.times(navBN)

    // [修改] 根据导入的收益率计算收益金额
    let profitAmountBN: BigNumber | null = null
    if (item.holdingProfitRate !== null && item.holdingProfitRate !== undefined) {
      const profitRateBN = new BigNumber(item.holdingProfitRate).dividedBy(100)
      const costBasisBN = holdingAmountBN.dividedBy(profitRateBN.plus(1))
      profitAmountBN = holdingAmountBN.minus(costBasisBN)
    }

    const newHolding = {
      code: item.code,
      name: realtimeData.name,
      shares: sharesBN.toFixed(4),
      yesterdayNav: navBN.toFixed(4),
      holdingAmount: holdingAmountBN.toFixed(2),
      // [修改] 存储收益数据
      holdingProfitAmount: profitAmountBN ? profitAmountBN.toFixed(2) : null,
      holdingProfitRate: item.holdingProfitRate ?? null,
    }

    // 注意：这里没有使用 onConflictDoUpdate 是因为如果 overwrite=false，我们已经手动跳过了
    // 如果 overwrite=true，表已经是空的。
    await db.insert(holdings).values(newHolding)
    importedCount++
  }
  return { imported: importedCount, skipped: skippedCount }
}

/**
 * 同步单个基金的最新估值
 */
export async function syncSingleFundEstimate(code: string) {
  const db = useDb()
  const holding = await db.query.holdings.findFirst({ where: eq(holdings.code, code) })
  if (!holding)
    return

  const realtimeData = await fetchFundRealtimeEstimate(code)
  if (realtimeData && realtimeData.gsz) {
    const estimateNav = Number(realtimeData.gsz)
    await db.update(holdings).set({
      todayEstimateNav: estimateNav,
      percentageChange: Number(realtimeData.gszzl),
      todayEstimateUpdateTime: new Date(realtimeData.gztime),
      todayEstimateAmount: (Number(holding.shares) * estimateNav).toFixed(2),
    }).where(eq(holdings.code, code))
  }
}

/**
 * [新增] 同步所有持仓基金的最新估值
 */
export async function syncAllHoldingsEstimates() {
  const db = useDb()
  const allHoldings = await db.query.holdings.findMany()

  if (allHoldings.length === 0)
    return { total: 0, success: 0, failed: 0 }

  // 使用 Promise.all 并发执行所有更新任务
  const results = await Promise.allSettled(
    allHoldings.map(holding => syncSingleFundEstimate(holding.code)),
  )

  const successCount = results.filter(r => r.status === 'fulfilled').length
  const failedCount = results.length - successCount

  console.log(`[Estimate Sync] Completed. Total: ${results.length}, Success: ${successCount}, Failed: ${failedCount}`)
  return { total: results.length, success: successCount, failed: failedCount }
}

/**
 * [新增] 同步单个基金的历史净值数据
 * @param code 基金代码
 * @returns 返回同步的记录数量
 */
export async function syncSingleFundHistory(code: string): Promise<number> {
  const db = useDb()
  const holding = await db.query.holdings.findFirst({ where: eq(holdings.code, code) })

  if (!holding)
    throw new HoldingNotFoundError(code)

  // 查找本地最新的历史记录
  const latestRecord = await db.query.navHistory.findFirst({
    where: eq(navHistory.code, code),
    orderBy: [desc(navHistory.navDate)],
  })

  // 从最新记录的后一天开始获取，如果没有记录则从头获取
  const startDate = latestRecord ? useDayjs()(latestRecord.navDate).add(1, 'day').format('YYYY-MM-DD') : undefined

  const historyData = await fetchFundHistory(code, startDate)
  if (!historyData.length)
    return 0 // 没有新数据需要同步

  const newRecords = historyData
    .map(r => ({
      code,
      navDate: r.FSRQ,
      nav: r.DWJZ,
    }))
    .filter(r => Number(r.nav) > 0)

  if (newRecords.length > 0) {
    await db.insert(navHistory).values(newRecords).onConflictDoNothing()

    // 更新持仓的最新净值和金额（以防万一）
    const latestNav = Number(newRecords[0]!.nav) // API返回是降序的
    const newAmount = Number(holding.shares) * latestNav

    await db.update(holdings).set({
      yesterdayNav: latestNav.toFixed(4),
      holdingAmount: newAmount.toFixed(2),
    }).where(eq(holdings.code, code))
  }

  return newRecords.length
}
