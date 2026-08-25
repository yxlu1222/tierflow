package model

import (
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/Zer0Echo/tierflow-core/common"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// 工单状态。工单为一问一答、无多轮对话，只有两态：
// 用户新建后为 open（待处理），管理员回复后即 resolved（已解决）。
const (
	TicketStatusOpen     = "open"     // 待处理：用户新建，等待管理员处理
	TicketStatusResolved = "resolved" // 已解决：管理员已回复
)

const (
	TicketPriorityLow    = "low"
	TicketPriorityMedium = "medium"
	TicketPriorityHigh   = "high"
	TicketPriorityUrgent = "urgent"
)

const (
	TicketCategoryTechnical = "technical" // 渠道/模型报错
	TicketCategoryBilling   = "billing"   // 计费/扣费
	TicketCategoryFinance   = "finance"   // 充值/订单
	TicketCategoryAccount   = "account"   // 账号/密钥/限流
	TicketCategoryFeature   = "feature"   // 功能建议/加模型
	TicketCategoryOther     = "other"
)

// 消息作者角色（写入时快照，决定气泡左右与通知对象）。
const (
	TicketRoleUser  = "user"
	TicketRoleAdmin = "admin"
)

// Ticket 工单主体。用户创建、所有管理员共享处理。
type Ticket struct {
	Id            int    `json:"id" gorm:"primaryKey"`
	TicketNo      string `json:"ticket_no" gorm:"type:varchar(64);index"` // 工单号,格式 TK000042,创建时派生自 id
	UserId        int    `json:"user_id" gorm:"index;index:idx_ticket_user_status,priority:1"`
	Title         string `json:"title" gorm:"type:varchar(255)"`
	Category      string `json:"category" gorm:"type:varchar(32);index;default:'other'"`
	Priority      string `json:"priority" gorm:"type:varchar(16);index;default:'medium'"`
	Status        string `json:"status" gorm:"type:varchar(32);index;index:idx_ticket_user_status,priority:2;default:'open'"`
	AssigneeId    int    `json:"assignee_id" gorm:"default:0;index"` // 0 = 未认领
	LastReplyAt   int64  `json:"last_reply_at" gorm:"bigint;index"`  // = 最后一条消息的 CreatedAt
	LastReplyRole string `json:"last_reply_role" gorm:"type:varchar(16);default:''"`
	CreatedAt     int64  `json:"created_at" gorm:"bigint;index"`
	UpdatedAt     int64  `json:"updated_at" gorm:"bigint"`

	// Username 不落库，供列表/详情装配显示。
	Username string `json:"username,omitempty" gorm:"-"`
}

func (t *Ticket) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	if t.CreatedAt == 0 {
		t.CreatedAt = now
	}
	t.UpdatedAt = now
	return nil
}

func (t *Ticket) BeforeUpdate(tx *gorm.DB) error {
	t.UpdatedAt = common.GetTimestamp()
	return nil
}

// TicketMessage 工单中的一条消息（用户回复 / 管理员回复）。
type TicketMessage struct {
	Id         int    `json:"id" gorm:"primaryKey"`
	TicketId   int    `json:"ticket_id" gorm:"index;index:idx_msg_ticket_created,priority:1"`
	AuthorId   int    `json:"author_id" gorm:"index"`
	AuthorRole string `json:"author_role" gorm:"type:varchar(16)"` // user | admin（写入时快照）
	Content    string `json:"content" gorm:"type:text"`
	// Retained for databases upgraded from the earlier ticket schema. Internal
	// notes are no longer exposed by the product, but the compatibility flag
	// lets detail queries safely hide any historical rows that used it.
	IsInternalNote bool `json:"-" gorm:"column:is_internal_note;default:false;index"`
	// Attachments 一期不启用，预留可空列以便二期实现附件而无需再迁移。
	Attachments *string `json:"attachments,omitempty" gorm:"type:text"`
	CreatedAt   int64   `json:"created_at" gorm:"bigint;index:idx_msg_ticket_created,priority:2"`

	// AuthorName 不落库，供展示装配。
	AuthorName string `json:"author_name,omitempty" gorm:"-"`
}

func (m *TicketMessage) BeforeCreate(tx *gorm.DB) error {
	if m.CreatedAt == 0 {
		m.CreatedAt = common.GetTimestamp()
	}
	return nil
}

// ---------- 枚举校验 / 归一化 ----------

func IsValidTicketPriority(p string) bool {
	switch p {
	case TicketPriorityLow, TicketPriorityMedium, TicketPriorityHigh, TicketPriorityUrgent:
		return true
	}
	return false
}

func IsValidTicketCategory(c string) bool {
	switch c {
	case TicketCategoryTechnical, TicketCategoryBilling, TicketCategoryFinance,
		TicketCategoryAccount, TicketCategoryFeature, TicketCategoryOther:
		return true
	}
	return false
}

func IsValidTicketStatus(s string) bool {
	switch s {
	case TicketStatusOpen, TicketStatusResolved:
		return true
	}
	return false
}

// ---------- 创建 ----------

// AddTicket 在一个事务内创建工单及其首条消息，并回填 last_reply_*。
// 校验并归一化 title/content/category/priority。t.UserId 必须已设置。
func AddTicket(t *Ticket, firstMessageContent string) error {
	t.Title = strings.TrimSpace(t.Title)
	firstMessageContent = strings.TrimSpace(firstMessageContent)
	if t.Title == "" {
		return errors.New("工单标题不能为空")
	}
	if utf8.RuneCountInString(t.Title) > 255 {
		return errors.New("工单标题过长")
	}
	if firstMessageContent == "" {
		return errors.New("工单内容不能为空")
	}
	if t.UserId <= 0 {
		return errors.New("无效的用户")
	}
	if !IsValidTicketCategory(t.Category) {
		t.Category = TicketCategoryOther
	}
	if !IsValidTicketPriority(t.Priority) {
		t.Priority = TicketPriorityMedium
	}
	t.Status = TicketStatusOpen
	t.AssigneeId = 0

	now := common.GetTimestamp()
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(t).Error; err != nil {
			return err
		}
		msg := &TicketMessage{
			TicketId:   t.Id,
			AuthorId:   t.UserId,
			AuthorRole: TicketRoleUser,
			Content:    firstMessageContent,
			CreatedAt:  now,
		}
		if err := tx.Create(msg).Error; err != nil {
			return err
		}
		// 工单号派生自自增 id(此时已分配),与历史回填公式一致,全局唯一。
		ticketNo := fmt.Sprintf("TK%06d", t.Id)
		if err := tx.Model(&Ticket{}).Where("id = ?", t.Id).Updates(map[string]interface{}{
			"last_reply_at":   now,
			"last_reply_role": TicketRoleUser,
			"ticket_no":       ticketNo,
		}).Error; err != nil {
			return err
		}
		t.TicketNo = ticketNo
		t.LastReplyAt = now
		t.LastReplyRole = TicketRoleUser
		return nil
	})
}

// ---------- 查询 ----------

// GetTicketByIdForUser 归属限定：仅返回属于该用户的工单。
func GetTicketByIdForUser(id, userId int) (*Ticket, error) {
	var t Ticket
	err := DB.Where("id = ? AND user_id = ?", id, userId).First(&t).Error
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// GetTicketByIdAdmin 管理员：任意工单。
func GetTicketByIdAdmin(id int) (*Ticket, error) {
	var t Ticket
	err := DB.First(&t, "id = ?", id).Error
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// GetUserTickets 用户自己的工单分页列表，可按状态过滤。
func GetUserTickets(userId int, status string, startIdx, pageSize int) ([]*Ticket, int64, error) {
	tx := DB.Model(&Ticket{}).Where("user_id = ?", userId)
	if status != "" {
		tx = tx.Where("status = ?", status)
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var tickets []*Ticket
	err := tx.Order("last_reply_at desc, id desc").Limit(pageSize).Offset(startIdx).Find(&tickets).Error
	if err != nil {
		return nil, 0, err
	}
	return tickets, total, nil
}

// GetAllTicketsAdmin 管理端全量分页列表。字符串过滤为空即跳过；
// assigneeId/userId 传 -1 表示跳过，assigneeId 传 0 表示筛选未认领。
func GetAllTicketsAdmin(status, priority, category string, assigneeId, userId int, startIdx, pageSize int) ([]*Ticket, int64, error) {
	tx := DB.Model(&Ticket{})
	if status != "" {
		tx = tx.Where("status = ?", status)
	}
	if priority != "" {
		tx = tx.Where("priority = ?", priority)
	}
	if category != "" {
		tx = tx.Where("category = ?", category)
	}
	if assigneeId >= 0 {
		tx = tx.Where("assignee_id = ?", assigneeId)
	}
	if userId >= 0 {
		tx = tx.Where("user_id = ?", userId)
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var tickets []*Ticket
	err := tx.Order("last_reply_at desc, id desc").Limit(pageSize).Offset(startIdx).Find(&tickets).Error
	if err != nil {
		return nil, 0, err
	}
	hydrateTicketUsernames(tickets)
	return tickets, total, nil
}

// hydrateTicketUsernames 一次性批量装配 UserId -> Username，避免逐行查询。
// usernamesByIds resolves the given user ids to their usernames in a single
// query, returning an id→username map. On error (or empty input) it returns an
// empty map so callers degrade to blank names rather than failing.
func usernamesByIds(ids []int) map[int]string {
	if len(ids) == 0 {
		return map[int]string{}
	}
	type row struct {
		Id       int
		Username string
	}
	var rows []row
	if err := DB.Model(&User{}).Select("id", "username").Where("id IN ?", ids).Scan(&rows).Error; err != nil {
		return map[int]string{}
	}
	nameById := make(map[int]string, len(rows))
	for _, r := range rows {
		nameById[r.Id] = r.Username
	}
	return nameById
}

// distinctIDs 从任意行集合中按 pick 提取去重后的 id 切片,保持首次出现顺序。
// 管理端列表的用户名/套餐标题批量回填共用它,避免各处重复写「set 去重 + 转切片」。
func distinctIDs[T any](rows []T, pick func(T) int) []int {
	seen := make(map[int]struct{}, len(rows))
	ids := make([]int, 0, len(rows))
	for _, r := range rows {
		id := pick(r)
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	return ids
}

func hydrateTicketUsernames(tickets []*Ticket) {
	if len(tickets) == 0 {
		return
	}
	idSet := make(map[int]struct{}, len(tickets))
	for _, t := range tickets {
		idSet[t.UserId] = struct{}{}
	}
	ids := make([]int, 0, len(idSet))
	for id := range idSet {
		ids = append(ids, id)
	}
	nameById := usernamesByIds(ids)
	for _, t := range tickets {
		t.Username = nameById[t.UserId]
	}
}

// ---------- 消息 / 自动流转 ----------

// AddTicketMessage 追加一条消息并按规则自动流转工单状态（核心逻辑）。
//   - 用户回复：→ open（重新等待管理员处理）；
//   - 管理员回复：→ resolved（一问一答，回复即解决）。
func AddTicketMessage(ticketId, authorId int, authorRole, content string) (*TicketMessage, error) {
	content = strings.TrimSpace(content)
	if content == "" {
		return nil, errors.New("回复内容不能为空")
	}
	if authorRole != TicketRoleUser && authorRole != TicketRoleAdmin {
		return nil, errors.New("无效的作者角色")
	}

	now := common.GetTimestamp()
	msg := &TicketMessage{
		TicketId:   ticketId,
		AuthorId:   authorId,
		AuthorRole: authorRole,
		Content:    content,
		CreatedAt:  now,
	}

	err := DB.Transaction(func(tx *gorm.DB) error {
		var t Ticket
		// 行锁（SQLite 上为 no-op，MySQL/PG 上防止用户与管理员同时回复导致状态丢失）。
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&t, "id = ?", ticketId).Error; err != nil {
			return err
		}
		if err := tx.Create(msg).Error; err != nil {
			return err
		}

		newStatus := t.Status
		if authorRole == TicketRoleUser {
			newStatus = TicketStatusOpen
		} else {
			newStatus = TicketStatusResolved
		}

		updates := map[string]interface{}{
			"last_reply_at":   now,
			"last_reply_role": authorRole,
			"updated_at":      now,
		}
		if newStatus != t.Status {
			updates["status"] = newStatus
		}
		return tx.Model(&Ticket{}).Where("id = ?", ticketId).Updates(updates).Error
	})
	if err != nil {
		return nil, err
	}
	return msg, nil
}

// GetTicketMessages 返回工单消息（按时间正序）。
// 内部备注功能已下线；此处仍显式过滤历史遗留的 is_internal_note 行，避免旧数据泄露给用户。
func GetTicketMessages(ticketId int) ([]*TicketMessage, error) {
	tx := DB.Where("ticket_id = ?", ticketId).
		Where("is_internal_note = ?", false)
	var msgs []*TicketMessage
	err := tx.Order("created_at asc, id asc").Find(&msgs).Error
	if err != nil {
		return nil, err
	}
	hydrateMessageAuthorNames(msgs)
	return msgs, nil
}

// hydrateMessageAuthorNames 一次性批量装配 AuthorId -> AuthorName，避免逐行查询。
func hydrateMessageAuthorNames(msgs []*TicketMessage) {
	if len(msgs) == 0 {
		return
	}
	idSet := make(map[int]struct{}, len(msgs))
	for _, m := range msgs {
		idSet[m.AuthorId] = struct{}{}
	}
	ids := make([]int, 0, len(idSet))
	for id := range idSet {
		ids = append(ids, id)
	}
	nameById := usernamesByIds(ids)
	for _, m := range msgs {
		m.AuthorName = nameById[m.AuthorId]
	}
}

// ---------- 管理操作 ----------

// UpdateTicketFields 更新白名单字段（由控制器构造并校验过的 map）。
func UpdateTicketFields(id int, fields map[string]interface{}) error {
	if len(fields) == 0 {
		return nil
	}
	fields["updated_at"] = common.GetTimestamp()
	return DB.Model(&Ticket{}).Where("id = ?", id).Updates(fields).Error
}

// ---------- 统计 ----------

// GetTicketStatsByStatus 返回各状态的工单数量（补零 open/resolved 两态），供看板列头与侧栏 badge。
func GetTicketStatsByStatus() (map[string]int64, error) {
	type row struct {
		Status string
		C      int64
	}
	var rows []row
	err := DB.Model(&Ticket{}).Select("status, count(*) as c").Group("status").Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	stats := map[string]int64{
		TicketStatusOpen:     0,
		TicketStatusResolved: 0,
	}
	for _, r := range rows {
		stats[r.Status] = r.C
	}
	return stats, nil
}
