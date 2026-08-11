package model

import (
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ConversationIndex 会话索引。
//
// 文件布局解决存储，索引解决查找 —— 读取一律通过本表定位到具体文件，
// 业务代码不得拼接 data/messages/{user_id}/{date} 这类路径。
// 布局早晚要换(合并大文件/对象存储/Parquet)，有索引就只改写入端。
//
// 一个会话一天一行：会话跨天时同一个 ConversationId 会有多行，按 cid 聚合即可。
type ConversationIndex struct {
	Id int64 `json:"id" gorm:"primaryKey"`
	// ConversationId + Date 是**唯一键**：UpsertConversationIndex 的 ON CONFLICT 依赖它。
	// 唯一索引以 cid 打头，所以按 cid 单列查询(跨天重建会话)也能走这个索引，无需再建一个。
	ConversationId string `json:"conversation_id" gorm:"type:varchar(32);uniqueIndex:idx_conv_cid_date,priority:1"`
	// Uid 是对外用户标识(12 位数字字符串)，不是内部自增 id ——
	// 与落盘文件的目录名一致，见 service.MsgRecord.Uid 注释。
	Uid string `json:"uid" gorm:"type:varchar(12);index:idx_conv_uid_date,priority:1"`
	// Date 为 YYYY-MM-DD。用 varchar 而非各库的 date 类型 —— 三库兼容(CLAUDE.md Rule 2)。
	Date string `json:"date" gorm:"type:varchar(10);uniqueIndex:idx_conv_cid_date,priority:2;index:idx_conv_uid_date,priority:2"`
	StartedAt    int64  `json:"started_at" gorm:"bigint;index"`
	LastAt       int64  `json:"last_at" gorm:"bigint"`
	MessageCount int    `json:"message_count" gorm:"default:0"`
	// Models 本会话当天用过的模型，逗号分隔
	Models string `json:"models" gorm:"type:varchar(255);default:''"`
	// Truncated 因配额耗尽被截断 —— 避免把"配额用完了"误读成"用户聊了几轮就走了"
	Truncated bool `json:"truncated" gorm:"default:false"`
}

func (ConversationIndex) TableName() string {
	return "conversation_indexes"
}

// UpsertConversationIndex 累加式更新一个 (cid, date) 的索引行。
//
// 走 ON CONFLICT DO UPDATE(GORM clause.OnConflict 在三库上都会翻译成各自的
// upsert 语法)，避免"先查后写"的竞态。addCount 为本次新增的消息条数。
func UpsertConversationIndex(cid string, uid string, date string, ts int64, model string, addCount int, truncated bool) error {
	row := ConversationIndex{
		ConversationId: cid,
		Uid:            uid,
		Date:           date,
		StartedAt:      ts,
		LastAt:         ts,
		MessageCount:   addCount,
		Models:         model,
		Truncated:      truncated,
	}
	return LOG_DB.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "conversation_id"}, {Name: "date"}},
		DoUpdates: clause.Assignments(map[string]interface{}{
			"last_at":       ts,
			"message_count": gorm.Expr("conversation_indexes.message_count + ?", addCount),
			"truncated":     gorm.Expr("conversation_indexes.truncated OR ?", truncated),
		}),
	}).Create(&row).Error
}

// GetConversationDates 返回某个会话涉及的全部日期(升序)，供跨天重建会话使用。
func GetConversationDates(cid string) ([]ConversationIndex, error) {
	var rows []ConversationIndex
	err := LOG_DB.Where("conversation_id = ?", cid).Order("date asc").Find(&rows).Error
	return rows, err
}

// ListUserConversations 列出某用户某天的全部会话。uid 为对外用户标识。
func ListUserConversations(uid string, date string) ([]ConversationIndex, error) {
	var rows []ConversationIndex
	err := LOG_DB.Where("uid = ? AND date = ?", uid, date).
		Order("started_at asc").Find(&rows).Error
	return rows, err
}

// DateOf 把秒级时间戳格式化成索引/目录用的 YYYY-MM-DD(本地时区)。
func DateOf(ts int64) string {
	return time.Unix(ts, 0).Format("2006-01-02")
}
