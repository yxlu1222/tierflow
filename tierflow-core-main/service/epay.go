package service

import (
	"github.com/Zer0Echo/tierflow-core/setting/operation_setting"
	"github.com/Zer0Echo/tierflow-core/setting/system_setting"
)

func GetCallbackAddress() string {
	if operation_setting.CustomCallbackAddress == "" {
		return system_setting.ServerAddress
	}
	return operation_setting.CustomCallbackAddress
}
