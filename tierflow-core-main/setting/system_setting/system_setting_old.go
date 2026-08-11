package system_setting

var ServerAddress = "http://localhost:3000"

// ApiRequestAddress 是密钥页展示给用户的 API 网关地址(Base URL)，
// 仅用于展示/复制；为空时前端回退显示 ServerAddress。不参与路由。
var ApiRequestAddress = ""
var WorkerUrl = ""
var WorkerValidKey = ""
var WorkerAllowHttpImageRequestEnabled = false

func EnableWorker() bool {
	return WorkerUrl != ""
}
