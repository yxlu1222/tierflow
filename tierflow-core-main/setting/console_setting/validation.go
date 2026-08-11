package console_setting

import (
	"encoding/json"
	"fmt"
	"sort"
	"time"
)

func parseJSONArray(jsonStr string, typeName string) ([]map[string]interface{}, error) {
	var list []map[string]interface{}
	if err := json.Unmarshal([]byte(jsonStr), &list); err != nil {
		return nil, fmt.Errorf("%s格式错误：%s", typeName, err.Error())
	}
	return list, nil
}

func getJSONList(jsonStr string) []map[string]interface{} {
	if jsonStr == "" {
		return []map[string]interface{}{}
	}
	var list []map[string]interface{}
	json.Unmarshal([]byte(jsonStr), &list)
	return list
}

func ValidateConsoleSettings(settingsStr string, settingType string) error {
	if settingsStr == "" {
		return nil
	}

	switch settingType {
	case "Announcements":
		return validateAnnouncements(settingsStr)
	default:
		return fmt.Errorf("未知的设置类型：%s", settingType)
	}
}

func validateAnnouncements(announcementsStr string) error {
	list, err := parseJSONArray(announcementsStr, "系统公告")
	if err != nil {
		return err
	}
	if len(list) > 100 {
		return fmt.Errorf("系统公告数量不能超过100个")
	}
	validStatus := map[string]bool{
		"draft": true, "published": true,
	}
	for i, ann := range list {
		content, ok := ann["content"].(string)
		if !ok || content == "" {
			return fmt.Errorf("第%d个公告缺少内容字段", i+1)
		}
		// title 可选(兼容旧数据);存在时须为字符串且不超过100字符。
		if v, exists := ann["title"]; exists && v != nil {
			titleStr, ok := v.(string)
			if !ok {
				return fmt.Errorf("第%d个公告的标题格式错误", i+1)
			}
			if len([]rune(titleStr)) > 100 {
				return fmt.Errorf("第%d个公告的标题长度不能超过100字符", i+1)
			}
		}
		// category 可选;存在时须为字符串且不超过20字符。
		if v, exists := ann["category"]; exists && v != nil {
			categoryStr, ok := v.(string)
			if !ok {
				return fmt.Errorf("第%d个公告的分类格式错误", i+1)
			}
			if len([]rune(categoryStr)) > 20 {
				return fmt.Errorf("第%d个公告的分类长度不能超过20字符", i+1)
			}
		}
		// pinned 可选;存在时须为布尔值。
		if v, exists := ann["pinned"]; exists && v != nil {
			if _, ok := v.(bool); !ok {
				return fmt.Errorf("第%d个公告的置顶标记格式错误", i+1)
			}
		}
		publishDateAny, exists := ann["publishDate"]
		if !exists {
			return fmt.Errorf("第%d个公告缺少发布日期字段", i+1)
		}
		publishDateStr, ok := publishDateAny.(string)
		if !ok || publishDateStr == "" {
			return fmt.Errorf("第%d个公告的发布日期不能为空", i+1)
		}
		if _, err := time.Parse(time.RFC3339, publishDateStr); err != nil {
			return fmt.Errorf("第%d个公告的发布日期格式错误", i+1)
		}
		// status 可选;缺失视为 published(兼容旧数据)。存在时必须合法。
		if s, exists := ann["status"]; exists {
			if statusStr, ok := s.(string); ok {
				if !validStatus[statusStr] {
					return fmt.Errorf("第%d个公告的状态值不合法", i+1)
				}
			}
		}
		if len([]rune(content)) > 2000 {
			return fmt.Errorf("第%d个公告的内容长度不能超过2000字符", i+1)
		}
	}
	return nil
}

func getPublishTime(item map[string]interface{}) time.Time {
	if v, ok := item["publishDate"]; ok {
		if s, ok2 := v.(string); ok2 {
			if t, err := time.Parse(time.RFC3339, s); err == nil {
				return t
			}
		}
	}
	return time.Time{}
}

func isPinned(item map[string]interface{}) bool {
	if v, ok := item["pinned"].(bool); ok {
		return v
	}
	return false
}

// GetAnnouncements 返回当前对用户可见的公告(已发布且已到发布时间),按发布时间倒序。
// 草稿(status==draft)与未到发布时间的定时公告不会下发给用户。
// 缺失 status 的旧数据视为已发布,保持向后兼容。
// 注:管理员后台经 /api/option/ 读取原始全量列表,不经过此函数。
func GetAnnouncements() []map[string]interface{} {
	list := getJSONList(GetConsoleSetting().Announcements)
	now := time.Now()
	visible := make([]map[string]interface{}, 0, len(list))
	for _, item := range list {
		if s, ok := item["status"].(string); ok && s == "draft" {
			continue
		}
		if getPublishTime(item).After(now) {
			continue
		}
		visible = append(visible, item)
	}
	// 置顶优先,再按发布时间倒序。
	sort.SliceStable(visible, func(i, j int) bool {
		pi, pj := isPinned(visible[i]), isPinned(visible[j])
		if pi != pj {
			return pi
		}
		return getPublishTime(visible[i]).After(getPublishTime(visible[j]))
	})
	return visible
}
