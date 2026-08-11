package system_setting

import "github.com/Zer0Echo/tierflow-core/setting/config"

// InferenceSettings —— TierFlow 推理服务(tierflow-infer)连接配置。
// 可在「系统设置 → 模型设置 → 推理服务」里修改，持久化为 option：
//
//	inference.url / inference.secret / inference.timeout_ms
//
// 留空则回退到环境变量 INFERENCE_SERVICE_URL / INFERENCE_SERVICE_SECRET / INFERENCE_SERVICE_TIMEOUT_MS。
type InferenceSettings struct {
	URL       string `json:"url"`
	Secret    string `json:"secret"`
	TimeoutMs int    `json:"timeout_ms"`
}

var inferenceSettings = InferenceSettings{
	TimeoutMs: 10000,
}

func init() {
	config.GlobalConfig.Register("inference", &inferenceSettings)
}

func GetInferenceSettings() *InferenceSettings {
	return &inferenceSettings
}
