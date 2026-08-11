package operation_setting

import "github.com/Zer0Echo/tierflow-core/setting/config"

// 额度展示类型
const (
	QuotaDisplayTypeUSD    = "USD"
	QuotaDisplayTypeCNY    = "CNY"
	QuotaDisplayTypeTokens = "TOKENS"
	QuotaDisplayTypeCustom = "CUSTOM"
)

type GeneralSetting struct {
	DocsLink            string `json:"docs_link"`
	PingIntervalEnabled bool   `json:"ping_interval_enabled"`
	PingIntervalSeconds int    `json:"ping_interval_seconds"`
	// 当前站点额度展示类型：USD / CNY / TOKENS
	QuotaDisplayType string `json:"quota_display_type"`
	// 自定义货币符号，用于 CUSTOM 展示类型
	CustomCurrencySymbol string `json:"custom_currency_symbol"`
	// 自定义货币与美元汇率（1 USD = X Custom）
	CustomCurrencyExchangeRate float64 `json:"custom_currency_exchange_rate"`
}

// 默认配置
var generalSetting = GeneralSetting{
	DocsLink:                   "https://docs.newapi.pro",
	PingIntervalEnabled:        false,
	PingIntervalSeconds:        60,
	QuotaDisplayType:           QuotaDisplayTypeCNY,
	CustomCurrencySymbol:       "¤",
	CustomCurrencyExchangeRate: 1.0,
}

func init() {
	// 注册到全局配置管理器
	config.GlobalConfig.Register("general_setting", &generalSetting)
}

func GetGeneralSetting() *GeneralSetting {
	return &generalSetting
}

// ⚠️ 全站唯一货币:人民币(docs/subscription-gap-analysis.md D1)。
// 下列 getter 写死 CNY,存量 option 里的 quota_display_type / custom_currency_*
// 即使残留旧值也不再生效;struct 字段保留仅为兼容已注册的 GlobalConfig 反序列化。

// IsCurrencyDisplay 是否以货币形式展示 —— 恒为 true(人民币)
func IsCurrencyDisplay() bool {
	return true
}

// IsCNYDisplay 是否以人民币展示 —— 恒为 true
func IsCNYDisplay() bool {
	return true
}

// GetQuotaDisplayType 返回额度展示类型 —— 恒为 CNY
func GetQuotaDisplayType() string {
	return QuotaDisplayTypeCNY
}

// GetCurrencySymbol 返回货币符号 —— 恒为 ¥
func GetCurrencySymbol() string {
	return "¥"
}

// GetUsdToCurrencyRate 返回 1 USD = X 展示货币 —— 恒为美元兑人民币汇率
func GetUsdToCurrencyRate(usdToCny float64) float64 {
	return usdToCny
}
