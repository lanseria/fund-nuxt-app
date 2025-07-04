/* eslint-disable no-console */
import { ofetch } from 'ofetch'

// 天天基金网实时估值返回的类型
interface RealtimeEstimateResponse {
  fundcode: string
  name: string
  jzrq: string // 净值日期
  dwjz: string // 单位净值
  gsz: string // 估算值
  gszzl: string // 估算涨跌率
  gztime: string // 估值时间
}

// 天天基金网历史净值API返回的类型
interface HistoryAPIResponse {
  Data: {
    LSJZList: HistoryRecord[]
  }
  TotalCount: number
}

interface HistoryRecord {
  FSRQ: string // 净值日期
  DWJZ: string // 单位净值
  JZZZL: string // 净值增长率
}

export async function fetchFundRealtimeEstimate(fundCode: string): Promise<RealtimeEstimateResponse | null> {
  const url = `http://fundgz.1234567.com.cn/js/${fundCode}.js`
  console.log(`[DEBUG] Preparing to fetch: ${url}`)

  try {
    // [关键修正] 添加 `responseType: 'text'` 选项
    // 这会强制 ofetch 将响应体作为纯文本字符串返回，无论 Content-Type 是什么。
    const responseText = await ofetch<string>(url, {
      responseType: 'json',
      headers: { Referer: 'http://fund.eastmoney.com/' },
    })

    console.log(`[DEBUG] Raw response for ${fundCode}:`, responseText)

    // 现在 responseText 保证是一个字符串，可以安全地调用 .replace()
    const jsonStr = responseText.replace('jsonpgz(', '').replace(');', '')
    const parsedData = JSON.parse(jsonStr)

    console.log(`[DEBUG] Parsed data for ${fundCode}:`, parsedData)
    return parsedData
  }
  catch (error: any) {
    // ... catch 块的日志记录保持不变，它们依然非常有用 ...
    console.error(`[DEBUG] !!! ERROR fetching fund ${fundCode} !!!`)
    if (error.response) {
      console.error('[DEBUG] Error Response Status:', error.response.status)
      console.error('[DEBUG] Error Response Status Text:', error.response.statusText)
      console.error('[DEBUG] Error Response Body:', error.response._data)
    }
    else {
      console.error('[DEBUG] Generic Error:', error.message)
      console.error('[DEBUG] Full Error Object:', error)
    }
    return null
  }
}

/**
 * 获取基金的历史净值数据
 * @param fundCode 基金代码
 * @param startDate 开始日期 'YYYY-MM-DD'
 * @param endDate 结束日期 'YYYY-MM-DD'
 */
export async function fetchFundHistory(fundCode: string, startDate?: string, endDate?: string): Promise<HistoryRecord[]> {
  const url = 'http://api.fund.eastmoney.com/f10/lsjz'
  const allData: HistoryRecord[] = []
  let pageIndex = 1
  const pageSize = 50

  while (true) {
    try {
      const response = await ofetch<HistoryAPIResponse>(url, {
        params: {
          fundCode,
          pageIndex,
          pageSize,
          startDate: startDate || '',
          endDate: endDate || '',
          _: Date.now(),
        },
        headers: {
          Referer: `http://fundf10.eastmoney.com/jjjz_${fundCode}.html`,
        },
      })

      const records = response.Data.LSJZList
      if (!records || records.length === 0)
        break

      allData.push(...records)

      if (allData.length >= response.TotalCount)
        break

      pageIndex++
      await new Promise(resolve => setTimeout(resolve, 200)) // 避免请求过于频繁
    }
    catch (error) {
      console.error(`获取基金 ${fundCode} 历史数据失败 (Page ${pageIndex}):`, error)
      break // 出错则停止获取
    }
  }
  return allData
}
