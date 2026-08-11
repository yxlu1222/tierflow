package service

import (
	"fmt"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/dto"
	"github.com/Zer0Echo/tierflow-core/model"
)

// NotifyAdminsNewTicket 新工单创建后，通知所有启用的管理员（跳过 excludeAdminId，
// 即创建者本身是管理员时不给自己发）。
func NotifyAdminsNewTicket(ticketNo string, title, creatorName string, excludeAdminId int) {
	subject := fmt.Sprintf("新工单 %s：%s", ticketNo, title)
	content := fmt.Sprintf("用户 %s 提交了新工单 %s「%s」，请及时处理。", creatorName, ticketNo, title)
	notification := dto.NewNotify(dto.NotifyTypeTicketCreated, subject, content, nil)
	notifyAdmins(notification, excludeAdminId)
}

// NotifyAdminsTicketUserReply 用户在已有工单上回复后，通知管理员：
// 若已指派受理人则只通知受理人，否则广播全部管理员。
func NotifyAdminsTicketUserReply(ticketNo string, assigneeId int, title, replierName string) {
	subject := fmt.Sprintf("工单 %s 有用户回复", ticketNo)
	content := fmt.Sprintf("用户 %s 在工单 %s「%s」中追加了回复。", replierName, ticketNo, title)
	notification := dto.NewNotify(dto.NotifyTypeTicketReply, subject, content, nil)
	if assigneeId > 0 {
		if user, err := model.GetUserById(assigneeId, false); err == nil {
			if err := NotifyUser(user.Id, user.Email, user.GetSetting(), notification); err != nil {
				common.SysLog(fmt.Sprintf("failed to notify assignee %d for ticket reply: %s", assigneeId, err.Error()))
			}
		}
		return
	}
	notifyAdmins(notification, 0)
}

// NotifyTicketOwnerReply 管理员非内部回复后，通知工单所有者（owner.Id==excludeUserId 时抑制自通知）。
func NotifyTicketOwnerReply(ownerId int, ticketNo string, title string, excludeUserId int) {
	if ownerId == excludeUserId {
		return
	}
	user, err := model.GetUserById(ownerId, false)
	if err != nil {
		return
	}
	subject := fmt.Sprintf("工单 %s 有新回复", ticketNo)
	content := fmt.Sprintf("您的工单 %s「%s」收到了管理员回复，请前往查看。", ticketNo, title)
	notification := dto.NewNotify(dto.NotifyTypeTicketReply, subject, content, nil)
	if err := NotifyUser(user.Id, user.Email, user.GetSetting(), notification); err != nil {
		common.SysLog(fmt.Sprintf("failed to notify ticket owner %d: %s", ownerId, err.Error()))
	}
}

// notifyAdmins 向所有启用的管理员/超管发送通知（跳过 excludeId）。
func notifyAdmins(notification dto.Notify, excludeId int) {
	var users []model.User
	if err := model.DB.
		Select("id", "email", "role", "status", "setting").
		Where("status = ? AND role >= ?", common.UserStatusEnabled, common.RoleAdminUser).
		Find(&users).Error; err != nil {
		common.SysLog(fmt.Sprintf("failed to query admin users for ticket notify: %s", err.Error()))
		return
	}
	for _, user := range users {
		if user.Id == excludeId {
			continue
		}
		if err := NotifyUser(user.Id, user.Email, user.GetSetting(), notification); err != nil {
			common.SysLog(fmt.Sprintf("failed to notify admin %d for ticket: %s", user.Id, err.Error()))
		}
	}
}
