package model

import (
	"fmt"
	"sync"
	"time"

	"github.com/Zer0Echo/tierflow-core/common"
	"gorm.io/gorm"
)

// QuotaData 柱状图数据
type QuotaData struct {
	Id       int    `json:"id"`
	UserID   int    `json:"user_id,omitempty" gorm:"index"`
	Username string `json:"username" gorm:"index:idx_qdt_model_user_name,priority:2;size:64;default:''"`
	// Strategy 是**请求方案名**(链路第 ① 层),语义与命名边界见 model.Log.Strategy。
	// 物理列名保持 model_name 不变,索引与裸 SQL 不受影响。
	Strategy string `json:"strategy" gorm:"column:model_name;index:idx_qdt_model_user_name,priority:1;size:64;default:''"`
	// ModelGroup 路由命中的模型组名快照(链路第 ② 层,看板按组聚合展示)。
	// 直连请求与非组路由(档位直配/多模态兜底/降级)本列为空——本列用户可见,
	// 不得写入真实上游模型名(抽象承诺,真实上游见 other.auto_route_upstream)。
	// size 与 ModelGroup.Name 的 varchar(128) 对齐，杜绝截断分裂。
	ModelGroup string `json:"model_group" gorm:"size:128;default:''"`
	// BillingSource 计费来源快照("wallet"/"subscription";历史行为空=未知,
	// 查询侧把空值归入钱包口径)。与 logs.billing_source 语义一致,用于套餐页
	// 与用量信息页的口径隔离:套餐页只取 subscription,用量页排除 subscription。
	BillingSource string `json:"billing_source" gorm:"size:16;default:''"`
	// SubscriptionBucket 订阅扣费命中的桶("premium"/"basic";非订阅为空)。
	// 落账前归一化:subscription+空 => premium,wallet => 空,避免同桶分裂成两行。
	SubscriptionBucket string `json:"subscription_bucket" gorm:"size:16;default:''"`
	CreatedAt          int64  `json:"created_at" gorm:"bigint;index:idx_qdt_created_at,priority:2"`
	TokenUsed          int    `json:"token_used" gorm:"default:0"`
	Count              int    `json:"count" gorm:"default:0"`
	Quota              int    `json:"quota" gorm:"default:0"`
}

func UpdateQuotaData() {
	for {
		if common.DataExportEnabled {
			common.SysLog("正在更新数据看板数据...")
			SaveQuotaDataCache()
		}
		time.Sleep(time.Duration(common.DataExportInterval) * time.Minute)
	}
}

var CacheQuotaData = make(map[string]*QuotaData)
var CacheQuotaDataLock = sync.Mutex{}

// normalizeBillingDims 归一化计费维度,保证同一逻辑桶不会因空值写法分裂成多行:
// subscription 且未标桶 => premium(与 relayInfo.SubscriptionBucket 零值语义一致);
// 非 subscription 一律清空桶。
func normalizeBillingDims(billingSource string, subscriptionBucket string) (string, string) {
	if billingSource == "subscription" {
		if subscriptionBucket == "" {
			subscriptionBucket = "premium"
		}
	} else {
		subscriptionBucket = ""
	}
	return billingSource, subscriptionBucket
}

func logQuotaDataCache(userId int, username string, modelName string, modelGroup string, billingSource string, subscriptionBucket string, quota int, createdAt int64, tokenUsed int) {
	// key 必须含 modelGroup：同一别名可能命中不同模型组(不同 tier)，不区分会互相覆盖
	// billingSource/bucket 同理:同一小时内钱包与套餐(双桶)的调用要分行落账
	key := fmt.Sprintf("%d-%s-%s-%s-%s-%s-%d", userId, username, modelName, modelGroup, billingSource, subscriptionBucket, createdAt)
	quotaData, ok := CacheQuotaData[key]
	if ok {
		quotaData.Count += 1
		quotaData.Quota += quota
		quotaData.TokenUsed += tokenUsed
	} else {
		quotaData = &QuotaData{
			UserID:             userId,
			Username:           username,
			Strategy:           modelName,
			ModelGroup:         modelGroup,
			BillingSource:      billingSource,
			SubscriptionBucket: subscriptionBucket,
			CreatedAt:          createdAt,
			Count:              1,
			Quota:              quota,
			TokenUsed:          tokenUsed,
		}
	}
	CacheQuotaData[key] = quotaData
}

func LogQuotaData(userId int, username string, modelName string, modelGroup string, billingSource string, subscriptionBucket string, quota int, createdAt int64, tokenUsed int) {
	// 只精确到小时
	createdAt = createdAt - (createdAt % 3600)
	billingSource, subscriptionBucket = normalizeBillingDims(billingSource, subscriptionBucket)

	CacheQuotaDataLock.Lock()
	defer CacheQuotaDataLock.Unlock()
	logQuotaDataCache(userId, username, modelName, modelGroup, billingSource, subscriptionBucket, quota, createdAt, tokenUsed)
}

func SaveQuotaDataCache() {
	CacheQuotaDataLock.Lock()
	defer CacheQuotaDataLock.Unlock()
	size := len(CacheQuotaData)
	// 如果缓存中有数据，就保存到数据库中
	// 1. 先查询数据库中是否有数据
	// 2. 如果有数据，就更新数据
	// 3. 如果没有数据，就插入数据
	for _, quotaData := range CacheQuotaData {
		quotaDataDB := &QuotaData{}
		DB.Table("quota_data").Where("user_id = ? and username = ? and model_name = ? and model_group = ? and billing_source = ? and subscription_bucket = ? and created_at = ?",
			quotaData.UserID, quotaData.Username, quotaData.Strategy, quotaData.ModelGroup, quotaData.BillingSource, quotaData.SubscriptionBucket, quotaData.CreatedAt).First(quotaDataDB)
		if quotaDataDB.Id > 0 {
			//quotaDataDB.Count += quotaData.Count
			//quotaDataDB.Quota += quotaData.Quota
			//DB.Table("quota_data").Save(quotaDataDB)
			increaseQuotaData(quotaData, quotaData.Count, quotaData.Quota, quotaData.TokenUsed)
		} else {
			DB.Table("quota_data").Create(quotaData)
		}
	}
	CacheQuotaData = make(map[string]*QuotaData)
	common.SysLog(fmt.Sprintf("保存数据看板数据成功，共保存%d条数据", size))
}

// increaseQuotaData 以 key 中的全部维度(含 billing_source/subscription_bucket)
// 定位行做增量更新;与 SaveQuotaDataCache 的查重 WHERE 必须保持一致,否则增量落错行。
func increaseQuotaData(key *QuotaData, count int, quota int, tokenUsed int) {
	err := DB.Table("quota_data").Where("user_id = ? and username = ? and model_name = ? and model_group = ? and billing_source = ? and subscription_bucket = ? and created_at = ?",
		key.UserID, key.Username, key.Strategy, key.ModelGroup, key.BillingSource, key.SubscriptionBucket, key.CreatedAt).Updates(map[string]interface{}{
		"count":      gorm.Expr("count + ?", count),
		"quota":      gorm.Expr("quota + ?", quota),
		"token_used": gorm.Expr("token_used + ?", tokenUsed),
	}).Error
	if err != nil {
		common.SysLog(fmt.Sprintf("increaseQuotaData error: %s", err))
	}
}

func GetQuotaDataByUsername(username string, startTime int64, endTime int64) (quotaData []*QuotaData, err error) {
	var quotaDatas []*QuotaData
	// 从quota_data表中查询数据
	err = DB.Table("quota_data").Where("username = ? and created_at >= ? and created_at <= ?", username, startTime, endTime).Find(&quotaDatas).Error
	return quotaDatas, err
}

// GetQuotaDataByUserId 查询用户的小时粒度用量。billingSource 限定口径:
// "subscription" 只取套餐扣费;"wallet" 取非套餐(含维度上线前的历史空值行,
// 归入钱包口径);"" 不过滤(全部)。
func GetQuotaDataByUserId(userId int, startTime int64, endTime int64, billingSource string) (quotaData []*QuotaData, err error) {
	var quotaDatas []*QuotaData
	// 从quota_data表中查询数据
	query := DB.Table("quota_data").Where("user_id = ? and created_at >= ? and created_at <= ?", userId, startTime, endTime)
	switch billingSource {
	case "subscription":
		query = query.Where("billing_source = ?", "subscription")
	case "wallet":
		query = query.Where("billing_source <> ?", "subscription")
	}
	err = query.Find(&quotaDatas).Error
	return quotaDatas, err
}

func GetQuotaDataGroupByUser(startTime int64, endTime int64) (quotaData []*QuotaData, err error) {
	var quotaDatas []*QuotaData
	err = DB.Table("quota_data").
		Select("username, model_name, model_group, created_at, sum(count) as count, sum(quota) as quota, sum(token_used) as token_used").
		Where("created_at >= ? and created_at <= ?", startTime, endTime).
		Group("username, model_name, model_group, created_at").
		Find(&quotaDatas).Error
	return quotaDatas, err
}

// GetAllQuotaDates 管理员全站聚合,按 (model_name, model_group) 原样分组下发两列。
//
// 此前这里把 ModelGroupFallbackCol(组名为空则回落 model_name)烤进 model_name
// 单列返回,前端因此**无法再区分**「走路由命中了模型组」与「直连未命中任何组」
// —— 两者被塌进同一个维度,模型占比图上就出现了「模型组名(空格形态)」与
// 「用户请求的对外模型名(连字符形态)」混排。
//
// 现改为原样返回两列,由前端按图表语义自行选择维度:
//   - 调用模型占比环图与模型调用明细表 → 只认 model_group,**空值整行丢弃**
//     (lib/hit-model-group.ts;未经模型组路由的流量按产品规则不展示);
//   - 消费趋势 / 调用趋势 / 调用次数排行 → 仍走 model_group || model_name 回落
//     (lib/charts.ts,理由见该处注释)。
//
// ⚠️ 前一种口径会**丢流量**:这两张图的合计不再等于 KPI 卡的全量合计。这是刻意的
// 产品取舍,不是聚合 bug —— 根治在落账侧(渠道测试探针不该写入 quota_data)。
// 行数比改动前多(同一小时内不同组各占一行),按时间分桶的图不受影响。
func GetAllQuotaDates(startTime int64, endTime int64, username string) (quotaData []*QuotaData, err error) {
	if username != "" {
		return GetQuotaDataByUsername(username, startTime, endTime)
	}
	var quotaDatas []*QuotaData
	err = DB.Table("quota_data").
		Select("model_name, model_group, sum(count) as count, sum(quota) as quota, sum(token_used) as token_used, created_at").
		Where("created_at >= ? and created_at <= ?", startTime, endTime).
		Group("model_name, model_group, created_at").
		Find(&quotaDatas).Error
	return quotaDatas, err
}
