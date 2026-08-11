package controller

import (
	"strconv"
	"strings"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/model"

	"github.com/gin-gonic/gin"
)

// GetAllRoutingProfiles 列出全部智能路由 profile。
func GetAllRoutingProfiles(c *gin.Context) {
	profiles, err := model.GetAllRoutingProfiles()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, profiles)
}

// GetRoutingProfile 按 id 取单个 profile。
func GetRoutingProfile(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorMsg(c, "无效的 id")
		return
	}
	p, err := model.GetRoutingProfileById(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, p)
}

// validateProfileTierRefs 校验 profile 的档位字段：非空时必须是模型组引用(mg:<id>)
// 且指向存在的组。裸模型名一律拒绝——设计约束是"一个 tier 对应一个模型组"，
// 混存裸模型名会让看板的组维度出现空洞(此前四层均无校验，历史上可混入)。
func validateProfileTierRefs(p *model.RoutingProfile) string {
	fields := []struct {
		label string
		value string
	}{
		{"tier1", p.Tier1Model},
		{"tier2", p.Tier2Model},
		{"tier3", p.Tier3Model},
		{"tier4", p.Tier4Model},
		{"tier5", p.Tier5Model},
		{"多模态模型", p.MultimodalModel},
	}
	for _, f := range fields {
		v := strings.TrimSpace(f.value)
		if v == "" {
			continue // 档位可不配
		}
		groupId, isRef := model.ParseModelGroupRef(v)
		if !isRef {
			return f.label + " 必须引用模型组(mg:<id>)，不允许配置单个模型：" + v
		}
		if _, err := model.GetModelGroupById(groupId); err != nil {
			return f.label + " 引用的模型组不存在：" + v
		}
	}
	return ""
}

// AddRoutingProfile 新建 profile。
func AddRoutingProfile(c *gin.Context) {
	var p model.RoutingProfile
	if err := c.ShouldBindJSON(&p); err != nil {
		common.ApiError(c, err)
		return
	}
	p.Slug = strings.TrimSpace(p.Slug)
	if p.Slug == "" {
		common.ApiErrorMsg(c, "slug 不能为空")
		return
	}
	if strings.TrimSpace(p.Aliases) == "" {
		common.ApiErrorMsg(c, "aliases 不能为空（用户请求的模型别名，如 auto）")
		return
	}
	if msg := validateProfileTierRefs(&p); msg != "" {
		common.ApiErrorMsg(c, msg)
		return
	}
	if err := p.Insert(); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, p)
}

// UpdateRoutingProfile 更新 profile（全量字段）。
func UpdateRoutingProfile(c *gin.Context) {
	var p model.RoutingProfile
	if err := c.ShouldBindJSON(&p); err != nil {
		common.ApiError(c, err)
		return
	}
	if p.Id == 0 {
		common.ApiErrorMsg(c, "无效的 id")
		return
	}
	p.Slug = strings.TrimSpace(p.Slug)
	if p.Slug == "" {
		common.ApiErrorMsg(c, "slug 不能为空")
		return
	}
	if msg := validateProfileTierRefs(&p); msg != "" {
		common.ApiErrorMsg(c, msg)
		return
	}
	if err := p.Update(); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, p)
}

// DeleteRoutingProfile 删除 profile。
func DeleteRoutingProfile(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorMsg(c, "无效的 id")
		return
	}
	if err := model.DeleteRoutingProfileById(id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"id": id})
}
