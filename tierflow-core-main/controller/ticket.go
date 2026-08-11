package controller

import (
	"strconv"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/model"
	"github.com/Zer0Echo/tierflow-core/service"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"
)

// ---------- 请求体 ----------

type createTicketReq struct {
	Title    string `json:"title"`
	Category string `json:"category"`
	Priority string `json:"priority"`
	Content  string `json:"content"`
}

type ticketReplyReq struct {
	Content string `json:"content"`
}

type adminUpdateTicketReq struct {
	Status     *string `json:"status"`
	Priority   *string `json:"priority"`
	Category   *string `json:"category"`
	AssigneeId *int    `json:"assignee_id"`
}

// ======================================================================
// 用户组（UserAuth）
// ======================================================================

// CreateTicket 用户创建工单（工单 + 首条消息），并异步通知所有管理员。
func CreateTicket(c *gin.Context) {
	userId := c.GetInt("id")
	role := c.GetInt("role")
	var req createTicketReq
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	t := &model.Ticket{
		UserId:   userId,
		Title:    req.Title,
		Category: req.Category,
		Priority: req.Priority,
	}
	if err := model.AddTicket(t, req.Content); err != nil {
		common.ApiError(c, err)
		return
	}
	// 异步扇出通知，避免阻塞响应；创建者本身是管理员时不通知自己。
	creatorName, _ := model.GetUsernameById(userId, false)
	ticketNo := t.TicketNo
	title := t.Title
	excludeAdminId := 0
	if role >= common.RoleAdminUser {
		excludeAdminId = userId
	}
	gopool.Go(func() {
		service.NotifyAdminsNewTicket(ticketNo, title, creatorName, excludeAdminId)
	})
	common.ApiSuccess(c, toUserTicketView(t))
}

// userTicketView 是工单的用户侧视图,只列出用户该看到的字段。
//
// 这里用独立结构体而非在 model 上打 omitempty + 逐个 handler 清零:
//   - assignee_id 的 0 表示「未认领」,是有业务含义的合法值(管理端的
//     UpdateTicket 就靠 0 取消认领),用 omitempty 会把这个语义从管理端
//     响应里一并抹掉;
//   - 清零式脱敏的默认行为是「泄漏」,新增用户侧 handler 时必须记得调用
//     才安全 —— 本次改造就曾漏掉工单的创建与回复两个接口。用视图结构体
//     后,不含内部 id 成为类型层面的默认。
type userTicketView struct {
	Id            int    `json:"id"`
	TicketNo      string `json:"ticket_no"`
	Title         string `json:"title"`
	Category      string `json:"category"`
	Priority      string `json:"priority"`
	Status        string `json:"status"`
	LastReplyAt   int64  `json:"last_reply_at"`
	LastReplyRole string `json:"last_reply_role"`
	CreatedAt     int64  `json:"created_at"`
	UpdatedAt     int64  `json:"updated_at"`
}

// userTicketMessageView 是工单消息的用户侧视图。author_role 保留(用于区分
// 是自己还是客服的发言),author_id 这个内部自增 id 不下发。
type userTicketMessageView struct {
	Id          int     `json:"id"`
	TicketId    int     `json:"ticket_id"`
	AuthorRole  string  `json:"author_role"`
	AuthorName  string  `json:"author_name,omitempty"`
	Content     string  `json:"content"`
	Attachments *string `json:"attachments,omitempty"`
	CreatedAt   int64   `json:"created_at"`
}

func toUserTicketView(t *model.Ticket) *userTicketView {
	if t == nil {
		return nil
	}
	return &userTicketView{
		Id:            t.Id,
		TicketNo:      t.TicketNo,
		Title:         t.Title,
		Category:      t.Category,
		Priority:      t.Priority,
		Status:        t.Status,
		LastReplyAt:   t.LastReplyAt,
		LastReplyRole: t.LastReplyRole,
		CreatedAt:     t.CreatedAt,
		UpdatedAt:     t.UpdatedAt,
	}
}

func toUserTicketViews(tickets []*model.Ticket) []*userTicketView {
	views := make([]*userTicketView, 0, len(tickets))
	for _, t := range tickets {
		views = append(views, toUserTicketView(t))
	}
	return views
}

func toUserTicketMessageViews(messages []*model.TicketMessage) []*userTicketMessageView {
	views := make([]*userTicketMessageView, 0, len(messages))
	for _, m := range messages {
		if m == nil {
			continue
		}
		views = append(views, &userTicketMessageView{
			Id:          m.Id,
			TicketId:    m.TicketId,
			AuthorRole:  m.AuthorRole,
			AuthorName:  m.AuthorName,
			Content:     m.Content,
			Attachments: m.Attachments,
			CreatedAt:   m.CreatedAt,
		})
	}
	return views
}

// ListMyTickets 用户自己的工单分页列表。
func ListMyTickets(c *gin.Context) {
	userId := c.GetInt("id")
	pageInfo := common.GetPageQuery(c)
	status := c.Query("status")
	tickets, total, err := model.GetUserTickets(userId, status, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(toUserTicketViews(tickets))
	common.ApiSuccess(c, pageInfo)
}

// GetMyTicketDetail 用户查看自己的工单详情（剥离内部备注）。
func GetMyTicketDetail(c *gin.Context) {
	userId := c.GetInt("id")
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorMsg(c, "无效的 id")
		return
	}
	ticket, err := model.GetTicketByIdForUser(id, userId)
	if err != nil {
		common.ApiErrorMsg(c, "工单不存在")
		return
	}
	messages, err := model.GetTicketMessages(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"ticket":   toUserTicketView(ticket),
		"messages": toUserTicketMessageViews(messages),
	})
}

// ReplyMyTicket 用户在自己的工单上追加回复（服务端强制 role=user）。
func ReplyMyTicket(c *gin.Context) {
	userId := c.GetInt("id")
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorMsg(c, "无效的 id")
		return
	}
	var req ticketReplyReq
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	ticket, err := model.GetTicketByIdForUser(id, userId)
	if err != nil {
		common.ApiErrorMsg(c, "工单不存在")
		return
	}
	msg, err := model.AddTicketMessage(id, userId, model.TicketRoleUser, req.Content)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	replierName, _ := model.GetUsernameById(userId, false)
	assigneeId := ticket.AssigneeId
	title := ticket.Title
	ticketNo := ticket.TicketNo
	gopool.Go(func() {
		service.NotifyAdminsTicketUserReply(ticketNo, assigneeId, title, replierName)
	})
	views := toUserTicketMessageViews([]*model.TicketMessage{msg})
	if len(views) == 0 {
		common.ApiSuccess(c, nil)
		return
	}
	common.ApiSuccess(c, views[0])
}

// ======================================================================
// 管理组（AdminAuth）
// ======================================================================

// AdminListTickets 管理端全量工单分页列表，支持多维筛选。
func AdminListTickets(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	status := c.Query("status")
	priority := c.Query("priority")
	category := c.Query("category")
	assigneeId := parseFilterInt(c.Query("assignee_id"))
	userId := parseFilterInt(c.Query("user_id"))
	tickets, total, err := model.GetAllTicketsAdmin(status, priority, category, assigneeId, userId,
		pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(tickets)
	common.ApiSuccess(c, pageInfo)
}

// parseFilterInt 空串或非法 → -1（跳过该过滤）。
func parseFilterInt(s string) int {
	if s == "" {
		return -1
	}
	v, err := strconv.Atoi(s)
	if err != nil {
		return -1
	}
	return v
}

// AdminTicketStats 各状态工单计数（看板列头 + 侧栏 badge）。
func AdminTicketStats(c *gin.Context) {
	stats, err := model.GetTicketStatsByStatus()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, stats)
}

// AdminGetTicketDetail 管理员工单详情：含内部备注 + 用户上下文。
func AdminGetTicketDetail(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorMsg(c, "无效的 id")
		return
	}
	ticket, err := model.GetTicketByIdAdmin(id)
	if err != nil {
		common.ApiErrorMsg(c, "工单不存在")
		return
	}
	messages, err := model.GetTicketMessages(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	// 用户上下文（工单所有者）。
	var owner gin.H
	if u, err := model.GetUserById(ticket.UserId, false); err == nil {
		owner = gin.H{
			"id":           u.Id,
			"username":     u.Username,
			"display_name": u.DisplayName,
			"email":        u.Email,
			"group":        u.Group,
			"status":       u.Status,
			"quota":        u.Quota,
			"used_quota":   u.UsedQuota,
			"created_at":   u.CreatedAt,
		}
	}

	common.ApiSuccess(c, gin.H{
		"ticket":   ticket,
		"messages": messages,
		"owner":    owner,
	})
}

// AdminReplyTicket 管理员回复，并通知工单所有者。
func AdminReplyTicket(c *gin.Context) {
	adminId := c.GetInt("id")
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorMsg(c, "无效的 id")
		return
	}
	var req ticketReplyReq
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	ticket, err := model.GetTicketByIdAdmin(id)
	if err != nil {
		common.ApiErrorMsg(c, "工单不存在")
		return
	}
	msg, err := model.AddTicketMessage(id, adminId, model.TicketRoleAdmin, req.Content)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	ownerId := ticket.UserId
	title := ticket.Title
	ticketNo := ticket.TicketNo
	gopool.Go(func() {
		service.NotifyTicketOwnerReply(ownerId, ticketNo, title, adminId)
	})
	common.ApiSuccess(c, msg)
}

// AdminUpdateTicket 手动更新工单字段（状态/优先级/分类/指派）。改派他人需超管。
func AdminUpdateTicket(c *gin.Context) {
	role := c.GetInt("role")
	adminId := c.GetInt("id")
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorMsg(c, "无效的 id")
		return
	}
	var req adminUpdateTicketReq
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	if _, err := model.GetTicketByIdAdmin(id); err != nil {
		common.ApiErrorMsg(c, "工单不存在")
		return
	}

	fields := map[string]interface{}{}
	if req.Status != nil {
		if !model.IsValidTicketStatus(*req.Status) {
			common.ApiErrorMsg(c, "无效的状态")
			return
		}
		fields["status"] = *req.Status
	}
	if req.Priority != nil {
		if !model.IsValidTicketPriority(*req.Priority) {
			common.ApiErrorMsg(c, "无效的优先级")
			return
		}
		fields["priority"] = *req.Priority
	}
	if req.Category != nil {
		if !model.IsValidTicketCategory(*req.Category) {
			common.ApiErrorMsg(c, "无效的分类")
			return
		}
		fields["category"] = *req.Category
	}
	if req.AssigneeId != nil {
		if *req.AssigneeId != 0 {
			// 改派给「他人」需要超管。
			if *req.AssigneeId != adminId && role < common.RoleRootUser {
				common.ApiErrorMsg(c, "无权重新指派工单")
				return
			}
			// 受理人必须是存在且启用的管理员。
			assignee, err := model.GetUserById(*req.AssigneeId, false)
			if err != nil || assignee.Role < common.RoleAdminUser {
				common.ApiErrorMsg(c, "指派对象必须是管理员")
				return
			}
		}
		fields["assignee_id"] = *req.AssigneeId
	}
	if len(fields) == 0 {
		common.ApiErrorMsg(c, "没有可更新的字段")
		return
	}
	if err := model.UpdateTicketFields(id, fields); err != nil {
		common.ApiError(c, err)
		return
	}
	ticket, err := model.GetTicketByIdAdmin(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, ticket)
}
