package console_setting

import "github.com/Zer0Echo/tierflow-core/setting/config"

type ConsoleSetting struct {
	Announcements string `json:"announcements"` // 系统公告 (JSON 数组字符串)
}

// 默认配置
var defaultConsoleSetting = ConsoleSetting{
	Announcements: "",
}

// 全局实例
var consoleSetting = defaultConsoleSetting

func init() {
	// 注册到全局配置管理器，键名为 console_setting
	config.GlobalConfig.Register("console_setting", &consoleSetting)
}

// GetConsoleSetting 获取 ConsoleSetting 配置实例
func GetConsoleSetting() *ConsoleSetting {
	return &consoleSetting
}
