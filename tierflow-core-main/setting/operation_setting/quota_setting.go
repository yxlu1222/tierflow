package operation_setting

import "github.com/Zer0Echo/tierflow-core/setting/config"

type QuotaSetting struct {
	EnableFreeModelPreConsume bool `json:"enable_free_model_pre_consume"` // 是否对免费模型启用预消耗
	EnableInvitationReward    bool `json:"enable_invitation_reward"`      // 邀请奖励总开关(关闭后停止发放奖励并禁止返利转入)
}

// 默认配置
var quotaSetting = QuotaSetting{
	EnableFreeModelPreConsume: true,
	EnableInvitationReward:    true, // 默认开启,保持既有行为
}

func init() {
	// 注册到全局配置管理器
	config.GlobalConfig.Register("quota_setting", &quotaSetting)
}

func GetQuotaSetting() *QuotaSetting {
	return &quotaSetting
}
